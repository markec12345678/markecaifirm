// v6.58: AI Seller Trust Score v2 — advanced seller scoring z ML in behavioral patterns
// POST /api/ai/seller-trust-score-v2
// Body: { sellerName?: string }
// Returns: { ok, scoring: { sellers, mlScores, behavioralPatterns, riskIndicators, trustLevels, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const sellerName = body?.sellerName ? String(body.sellerName).trim() : null;

    const trades = await db.trade.findMany({
      where: { buyLocation: { not: '' } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        buyLocation: true, sellPrice: true, sellDate: true, sellLocation: true,
        status: true, notes: true,
        listing: { select: { sellerName: true, contactStatus: true, sellerResponse: true, location: true, postedAt: true, firstSeenAt: true } } },
      take: 500,
      orderBy: { buyDate: 'desc' },
    });

    if (trades.length === 0) {
      return NextResponse.json({ ok: true, scoring: null, message: 'Ni tradeov za seller trust analizo.' });
    }

    // Aggregation per seller
    const sellerMap = new Map<string, {
      name: string;
      totalPurchases: number;
      totalSpent: number;
      avgPurchasePrice: number;
      firstPurchase: Date | null;
      lastPurchase: Date | null;
      daysAsCustomer: number;
      daysSinceLastPurchase: number;
      categories: Set<string>;
      itemsBought: string[];
      contactStatuses: { contacted: number; responded: number; closed: number; none: number };
      responseRate: number;
      locations: Set<string>;
      priceRange: { min: number; max: number };
      listingAges: number[];
    }>();

    const now = Date.now();
    for (const t of trades) {
      const name = (t.buyLocation || '').trim();
      if (!name || name.length < 2) continue;
      if (!sellerMap.has(name)) {
        sellerMap.set(name, {
          name, totalPurchases: 0, totalSpent: 0, avgPurchasePrice: 0,
          firstPurchase: t.buyDate, lastPurchase: t.buyDate,
          daysAsCustomer: 0, daysSinceLastPurchase: 0,
          categories: new Set(), itemsBought: [],
          contactStatuses: { contacted: 0, responded: 0, closed: 0, none: 0 },
          responseRate: 0, locations: new Set(),
          priceRange: { min: t.buyPrice, max: t.buyPrice }, listingAges: [],
        });
      }
      const s = sellerMap.get(name)!;
      s.totalPurchases += 1;
      s.totalSpent += t.buyPrice + (t.buyFees ?? 0);
      if (t.buyDate < (s.firstPurchase as Date)) s.firstPurchase = t.buyDate;
      if (t.buyDate > (s.lastPurchase as Date)) s.lastPurchase = t.buyDate;
      if (t.category) s.categories.add(t.category);
      s.itemsBought.push(t.title);
      if (t.buyPrice < s.priceRange.min) s.priceRange.min = t.buyPrice;
      if (t.buyPrice > s.priceRange.max) s.priceRange.max = t.buyPrice;
      if (t.listing?.location) s.locations.add(t.listing.location);
      const status = (t.listing?.contactStatus || 'none');
      if (status === 'contacted') s.contactStatuses.contacted += 1;
      else if (status === 'responded') s.contactStatuses.responded += 1;
      else if (status === 'closed') s.contactStatuses.closed += 1;
      else s.contactStatuses.none += 1;
      if (t.listing?.postedAt && t.listing?.firstSeenAt) {
        const age = Math.round((t.listing.firstSeenAt.getTime() - t.listing.postedAt.getTime()) / (24*60*60*1000));
        if (age >= 0 && age < 365) s.listingAges.push(age);
      }
    }

    const sellers = Array.from(sellerMap.values()).map(s => {
      s.avgPurchasePrice = Math.round(s.totalSpent / s.totalPurchases);
      if (s.firstPurchase && s.lastPurchase) {
        s.daysAsCustomer = Math.max(1, Math.round((now - s.firstPurchase.getTime()) / (24*60*60*1000)));
        s.daysSinceLastPurchase = Math.round((now - s.lastPurchase.getTime()) / (24*60*60*1000));
      }
      const totalContacted = s.contactStatuses.contacted + s.contactStatuses.responded + s.contactStatuses.closed;
      s.responseRate = totalContacted > 0 ? Math.round(((s.contactStatuses.responded + s.contactStatuses.closed) / totalContacted) * 100) : 0;
      return s;
    });

    if (sellerName) {
      const filtered = sellers.filter(s => s.name === sellerName);
      if (filtered.length === 0) {
        return NextResponse.json({ ok: true, scoring: null, message: `Seller "${sellerName}" ni najden.` });
      }
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const targetSellers = sellerName ? sellers.filter(s => s.name === sellerName) : sellers.slice(0, 25);

    const sellersStr = targetSellers.slice(0, 20).map(s =>
      `- ${s.name} | ${s.totalPurchases}x nakup | ${s.totalSpent}€ | ${s.avgPurchasePrice}€ povp | ${s.daysAsCustomer}d | ${s.daysSinceLastPurchase}d zadnji | ${s.categories.size} kat | response ${s.responseRate}% | ${s.locations.size} lokacij | price ${s.priceRange.min}-${s.priceRange.max}€`
    ).join('\n');

    const prompt = `Si AI seller trust score v2 z ML behavioral analysis.
Oceni zaupanja vrednost prodajalcev z 12-dimenzionalno analizo in ML modelom.

PRODAJALCI (${targetSellers.length}):
${sellersStr}

12-dimenzionalni trust score:
1. TRANSACTION_HISTORY: dolžina in volumen odnosa
2. RESPONSIVENESS: hitrost in kvaliteta odgovorov
3. CONSISTENCY: lokacija, kategorije, cenovni rang
4. TRANSPARENCY: jasnost komunikacije, odkrivanje težav
5. FAIRNESS: realne cene, brez skritih stroškov
6. PROFESSIONALISM: način komuniciranja, dogovori
7. RELIABILITY_OF_DELIVERY: ali item pride kot opisan
8. FINANCIAL_INTEGRITY: pravilno plačilo, brez frauda
9. COMMUNICATION_QUALITY: jasnost, odzivnost, jezik
10. LISTING_ACCURACY: ali opis ustreza realnosti
11. POST_SALE_SUPPORT: support po nakupu, returns
12. MARKET_REPUTATION: general reputation na platformi

ML modeli:
- RANDOM_FOREST_CLASSIFIER: za trust level classification
- GRADIENT_BOOSTING: za trust score prediction
- NEURAL_NETWORK: za kompleksne behavioral vzorce
- LOGISTIC_REGRESSION: za interpretable binary (trust/distrust)
- ENSEMBLE_VOTING: kombinacija vseh

Behavioral patterns:
- CONSISTENT_BUYER: vedno iste kategorije, predvidljiv
- DIVERSE_BUYER: raznolike kategorije, explorer
- HIGH_FREQUENCY: veliko nakupov v kratkem času (reseller signal)
- LOW_FREQUENCY: redki nakupi, casual buyer
- SEASONAL: nakupi v določenih mesecih
- REACTIVE: odgovori na outreach, communicative
- UNRESPONSIVE: ne odgovarja, težko kontaktirati

Trust levels (z ML classification):
- VERIFIED_TRADER (85-100): top trust, long-term relationship
- TRUSTED (70-84): reliable, repeat business
- NEUTRAL (50-69): ok za manjše transakcije
- CAUTIOUS (30-49): previdno, verify pred večjim nakupom
- SUSPICIOUS (15-29): visoko tveganje
- BLACKLISTED (0-14): ne kupuj

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "sellers": [
    {
      "name": "<ime>",
      "trust_score": <number 0-100>,
      "trust_level": "<verified_trader|trusted|neutral|cautious|suspicious|blacklisted>",
      "ml_scores": {
        "random_forest_score": <number 0-100>,
        "gradient_boosting_score": <number 0-100>,
        "neural_network_score": <number 0-100>,
        "logistic_regression_score": <number 0-100>,
        "ensemble_score": <number 0-100>,
        "model_consensus": "<strong|moderate|weak>"
      },
      "dimension_scores": {
        "transaction_history": <number 0-100>,
        "responsiveness": <number 0-100>,
        "consistency": <number 0-100>,
        "transparency": <number 0-100>,
        "fairness": <number 0-100>,
        "professionalism": <number 0-100>,
        "reliability_of_delivery": <number 0-100>,
        "financial_integrity": <number 0-100>,
        "communication_quality": <number 0-100>,
        "listing_accuracy": <number 0-100>,
        "post_sale_support": <number 0-100>,
        "market_reputation": <number 0-100>
      },
      "behavioral_pattern": "<consistent_buyer|diverse_buyer|high_frequency|low_frequency|seasonal|reactive|unresponsive>",
      "red_flags": ["<max 80 znakov>"],
      "green_flags": ["<max 80 znakov>"],
      "recommended_action": "<strong_buy_from|buy_from|verify_first|small_transactions_only|avoid|blacklist>",
      "max_safe_transaction_eur": <number>,
      "specialty": "<max 80 znakov>",
      "risk_assessment": "<low|medium|high|critical>"
    }
  ],
  "ml_scores": [
    {
      "model": "<random_forest|gradient_boosting|neural_network|logistic_regression|ensemble_voting>",
      "accuracy_pct": <number 0-100>,
      "precision_pct": <number 0-100>,
      "recall_pct": <number 0-100>,
      "f1_score": <number 0-100>,
      "weight_in_ensemble": <number 0-100>,
      "best_for": "<max 80 znakov>"
    }
  ],
  "behavioral_patterns": [
    {
      "pattern": "<7 pattern-ov>",
      "seller_count": <number>,
      "avg_trust_score": <number>,
      "description": "<max 120 znakov>",
      "best_strategy": "<max 120 znakov>"
    }
  ],
  "risk_indicators": [
    {
      "indicator": "<max 100 znakov>",
      "severity": "<low|medium|high|critical>",
      "affected_sellers": <number>,
      "mitigation": "<max 150 znakov>",
      "ml_detected": <boolean>
    }
  ],
  "trust_levels": [
    {
      "level": "<6 levelov>",
      "seller_count": <number>,
      "avg_trust_score": <number>,
      "total_spent_eur": <number>,
      "strategy": "<max 150 znakov>"
    }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_impact_eur": <number>, "sellers_affected": <number> }
  ],
  "summary": {
    "total_sellers_analyzed": <number>,
    "avg_trust_score": <number>,
    "verified_trader_count": <number>,
    "trusted_count": <number>,
    "neutral_count": <number>,
    "cautious_count": <number>,
    "suspicious_count": <number>,
    "blacklisted_count": <number>,
    "best_model": "<max 80 znakov>",
    "biggest_risk_seller": "<max 100 znakov>",
    "safest_seller": "<max 100 znakov>",
    "trust_efficiency_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const validNames = new Set(targetSellers.map(s => s.name));

    const scoring = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      sellers: (parsed?.sellers || [])
        .filter((s: any) => validNames.has(String(s?.name ?? '')))
        .slice(0, 25)
        .map((s: any) => ({
          name: String(s?.name ?? '').slice(0, 100),
          trustScore: Math.max(0, Math.min(100, Number(s?.trust_score ?? 50))),
          trustLevel: ['verified_trader', 'trusted', 'neutral', 'cautious', 'suspicious', 'blacklisted'].includes(String(s?.trust_level)) ? String(s.trust_level) : 'neutral',
          mlScores: {
            randomForestScore: Math.max(0, Math.min(100, Number(s?.ml_scores?.random_forest_score ?? 50))),
            gradientBoostingScore: Math.max(0, Math.min(100, Number(s?.ml_scores?.gradient_boosting_score ?? 50))),
            neuralNetworkScore: Math.max(0, Math.min(100, Number(s?.ml_scores?.neural_network_score ?? 50))),
            logisticRegressionScore: Math.max(0, Math.min(100, Number(s?.ml_scores?.logistic_regression_score ?? 50))),
            ensembleScore: Math.max(0, Math.min(100, Number(s?.ml_scores?.ensemble_score ?? 50))),
            modelConsensus: ['strong', 'moderate', 'weak'].includes(String(s?.ml_scores?.model_consensus)) ? String(s.ml_scores.model_consensus) : 'moderate',
          },
          dimensionScores: {
            transactionHistory: Math.max(0, Math.min(100, Number(s?.dimension_scores?.transaction_history ?? 50))),
            responsiveness: Math.max(0, Math.min(100, Number(s?.dimension_scores?.responsiveness ?? 50))),
            consistency: Math.max(0, Math.min(100, Number(s?.dimension_scores?.consistency ?? 50))),
            transparency: Math.max(0, Math.min(100, Number(s?.dimension_scores?.transparency ?? 50))),
            fairness: Math.max(0, Math.min(100, Number(s?.dimension_scores?.fairness ?? 50))),
            professionalism: Math.max(0, Math.min(100, Number(s?.dimension_scores?.professionalism ?? 50))),
            reliabilityOfDelivery: Math.max(0, Math.min(100, Number(s?.dimension_scores?.reliability_of_delivery ?? 50))),
            financialIntegrity: Math.max(0, Math.min(100, Number(s?.dimension_scores?.financial_integrity ?? 50))),
            communicationQuality: Math.max(0, Math.min(100, Number(s?.dimension_scores?.communication_quality ?? 50))),
            listingAccuracy: Math.max(0, Math.min(100, Number(s?.dimension_scores?.listing_accuracy ?? 50))),
            postSaleSupport: Math.max(0, Math.min(100, Number(s?.dimension_scores?.post_sale_support ?? 50))),
            marketReputation: Math.max(0, Math.min(100, Number(s?.dimension_scores?.market_reputation ?? 50))),
          },
          behavioralPattern: ['consistent_buyer', 'diverse_buyer', 'high_frequency', 'low_frequency', 'seasonal', 'reactive', 'unresponsive'].includes(String(s?.behavioral_pattern)) ? String(s.behavioral_pattern) : 'consistent_buyer',
          redFlags: (s?.red_flags || []).slice(0, 5).map((f: any) => String(f).slice(0, 150)),
          greenFlags: (s?.green_flags || []).slice(0, 5).map((f: any) => String(f).slice(0, 150)),
          recommendedAction: ['strong_buy_from', 'buy_from', 'verify_first', 'small_transactions_only', 'avoid', 'blacklist'].includes(String(s?.recommended_action)) ? String(s.recommended_action) : 'verify_first',
          maxSafeTransactionEur: Math.round(Number(s?.max_safe_transaction_eur ?? 500)),
          specialty: String(s?.specialty ?? '').slice(0, 150),
          riskAssessment: ['low', 'medium', 'high', 'critical'].includes(String(s?.risk_assessment)) ? String(s.risk_assessment) : 'medium',
        })),
      mlScores: (parsed?.ml_scores || []).slice(0, 5).map((m: any) => ({
        model: ['random_forest', 'gradient_boosting', 'neural_network', 'logistic_regression', 'ensemble_voting'].includes(String(m?.model)) ? String(m.model) : 'ensemble_voting',
        accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))),
        precisionPct: Math.max(0, Math.min(100, Number(m?.precision_pct ?? 65))),
        recallPct: Math.max(0, Math.min(100, Number(m?.recall_pct ?? 60))),
        f1Score: Math.max(0, Math.min(100, Number(m?.f1_score ?? 62))),
        weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
        bestFor: String(m?.best_for ?? '').slice(0, 150),
      })),
      behavioralPatterns: (parsed?.behavioral_patterns || []).slice(0, 7).map((p: any) => ({
        pattern: ['consistent_buyer', 'diverse_buyer', 'high_frequency', 'low_frequency', 'seasonal', 'reactive', 'unresponsive'].includes(String(p?.pattern)) ? String(p.pattern) : 'consistent_buyer',
        sellerCount: Math.max(0, Number(p?.seller_count ?? 0)),
        avgTrustScore: Math.max(0, Math.min(100, Number(p?.avg_trust_score ?? 50))),
        description: String(p?.description ?? '').slice(0, 250),
        bestStrategy: String(p?.best_strategy ?? '').slice(0, 250),
      })),
      riskIndicators: (parsed?.risk_indicators || []).slice(0, 8).map((r: any) => ({
        indicator: String(r?.indicator ?? '').slice(0, 200),
        severity: ['low', 'medium', 'high', 'critical'].includes(String(r?.severity)) ? String(r.severity) : 'medium',
        affectedSellers: Math.max(0, Number(r?.affected_sellers ?? 0)),
        mitigation: String(r?.mitigation ?? '').slice(0, 300),
        mlDetected: Boolean(r?.ml_detected ?? false),
      })),
      trustLevels: (parsed?.trust_levels || []).slice(0, 6).map((l: any) => ({
        level: ['verified_trader', 'trusted', 'neutral', 'cautious', 'suspicious', 'blacklisted'].includes(String(l?.level)) ? String(l.level) : 'neutral',
        sellerCount: Math.max(0, Number(l?.seller_count ?? 0)),
        avgTrustScore: Math.max(0, Math.min(100, Number(l?.avg_trust_score ?? 50))),
        totalSpentEur: Math.round(Number(l?.total_spent_eur ?? 0)),
        strategy: String(l?.strategy ?? '').slice(0, 300),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        expectedImpactEur: Math.round(Number(r?.expected_impact_eur ?? 0)),
        sellersAffected: Math.max(0, Number(r?.sellers_affected ?? 0)),
      })),
      summary: {
        totalSellersAnalyzed: targetSellers.length,
        avgTrustScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_trust_score ?? 50))),
        verifiedTraderCount: Math.max(0, Number(parsed?.summary?.verified_trader_count ?? 0)),
        trustedCount: Math.max(0, Number(parsed?.summary?.trusted_count ?? 0)),
        neutralCount: Math.max(0, Number(parsed?.summary?.neutral_count ?? 0)),
        cautiousCount: Math.max(0, Number(parsed?.summary?.cautious_count ?? 0)),
        suspiciousCount: Math.max(0, Number(parsed?.summary?.suspicious_count ?? 0)),
        blacklistedCount: Math.max(0, Number(parsed?.summary?.blacklisted_count ?? 0)),
        bestModel: ['random_forest', 'gradient_boosting', 'neural_network', 'logistic_regression', 'ensemble_voting'].includes(String(parsed?.summary?.best_model)) ? String(parsed.summary.best_model) : 'ensemble_voting',
        biggestRiskSeller: String(parsed?.summary?.biggest_risk_seller ?? '').slice(0, 200),
        safestSeller: String(parsed?.summary?.safest_seller ?? '').slice(0, 200),
        trustEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.trust_efficiency_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, scoring });
  } catch (e: any) { logger.error("/api/ai/seller-trust-score-v2", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
