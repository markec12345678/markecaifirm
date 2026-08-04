// v6.48: AI Seller Reliability Score v2 — napredna analiza prodajalcev z behavior pattern detection
// POST /api/ai/seller-reliability-v2
// Body: { sellerName?: string }
// Returns: { ok, scoring: { sellers, behaviorPatterns, riskIndicators, trustLevels, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

interface SellerMetrics {
  name: string;
  totalPurchases: number;
  totalSpent: number;
  avgPurchasePrice: number;
  firstPurchase: Date | null;
  lastPurchase: Date;
  daysAsCustomer: number;
  daysSinceLastPurchase: number;
  categories: Set<string>;
  itemsBought: string[];
  contactStatuses: { contacted: number; responded: number; closed: number; none: number };
  responseRate: number; // 0-100
  avgResponseTimeHours: number;
  locationConsistency: boolean;
  locations: Set<string>;
  priceRange: { min: number; max: number };
  repeatBuyer: boolean;
  priceNegotiationsWon: number;
  priceNegotiationsLost: number;
  scamSignals: string[];
  trustSignals: string[];
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const sellerName = body?.sellerName ? String(body.sellerName).trim() : null;

    // 1. Pridobi trades (buyLocation = prodajalec od katerega smo kupovali)
    const trades = await db.trade.findMany({
      where: { buyLocation: { not: '' } },
      select: {
        id: true, title: true, category: true,
        buyPrice: true, buyFees: true, buyDate: true,
        buyLocation: true, sellPrice: true, sellDate: true, sellLocation: true,
        status: true, notes: true,
        listing: { select: { sellerName: true, contactStatus: true, sellerResponse: true, location: true } },
      },
      take: 500,
      orderBy: { buyDate: 'desc' },
    });

    if (trades.length === 0) {
      return NextResponse.json({ ok: true, scoring: null, message: 'Ni tradeov za seller analizo.' });
    }

    // 2. Agregacija po buyLocation (seller)
    const sellerMap = new Map<string, SellerMetrics>();
    const now = Date.now();

    for (const t of trades) {
      const name = (t.buyLocation || '').trim();
      if (!name || name.length < 2) continue;

      if (!sellerMap.has(name)) {
        sellerMap.set(name, {
          name,
          totalPurchases: 0,
          totalSpent: 0,
          avgPurchasePrice: 0,
          firstPurchase: t.buyDate,
          lastPurchase: t.buyDate,
          daysAsCustomer: 0,
          daysSinceLastPurchase: 0,
          categories: new Set<string>(),
          itemsBought: [],
          contactStatuses: { contacted: 0, responded: 0, closed: 0, none: 0 },
          responseRate: 0,
          avgResponseTimeHours: 0,
          locationConsistency: true,
          locations: new Set<string>(),
          priceRange: { min: t.buyPrice, max: t.buyPrice },
          repeatBuyer: false,
          priceNegotiationsWon: 0,
          priceNegotiationsLost: 0,
          scamSignals: [],
          trustSignals: [],
        });
      }
      const s = sellerMap.get(name)!;
      s.totalPurchases += 1;
      s.totalSpent += t.buyPrice + (t.buyFees ?? 0);
      if (t.buyDate < (s.firstPurchase as Date)) s.firstPurchase = t.buyDate;
      if (t.buyDate > s.lastPurchase) s.lastPurchase = t.buyDate;
      if (t.category) s.categories.add(t.category);
      s.itemsBought.push(t.title);
      if (t.buyPrice < s.priceRange.min) s.priceRange.min = t.buyPrice;
      if (t.buyPrice > s.priceRange.max) s.priceRange.max = t.buyPrice;
      if (t.listing?.location) s.locations.add(t.listing.location);

      // Contact status tracking
      const status = (t.listing?.contactStatus || 'none');
      if (status === 'contacted') s.contactStatuses.contacted += 1;
      else if (status === 'responded') s.contactStatuses.responded += 1;
      else if (status === 'closed') s.contactStatuses.closed += 1;
      else s.contactStatuses.none += 1;
    }

    // 3. Izračunaj metrike
    const sellers = Array.from(sellerMap.values()).filter(s => s.totalPurchases >= 1);
    if (sellerName) {
      const filtered = sellers.filter(s => s.name === sellerName);
      if (filtered.length === 0) {
        return NextResponse.json({ ok: true, scoring: null, message: `Seller "${sellerName}" ni najden.` });
      }
    }

    const sellersWithMetrics = sellers.map(s => {
      s.avgPurchasePrice = Math.round(s.totalSpent / s.totalPurchases);
      if (s.firstPurchase && s.lastPurchase) {
        s.daysAsCustomer = Math.max(1, Math.round((now - s.firstPurchase.getTime()) / (24*60*60*1000)));
        s.daysSinceLastPurchase = Math.round((now - s.lastPurchase.getTime()) / (24*60*60*1000));
      }
      s.repeatBuyer = s.totalPurchases > 1;
      s.locationConsistency = s.locations.size <= 2;

      // Response rate = (responded + closed) / (contacted + responded + closed)
      const totalContacted = s.contactStatuses.contacted + s.contactStatuses.responded + s.contactStatuses.closed;
      s.responseRate = totalContacted > 0
        ? Math.round(((s.contactStatuses.responded + s.contactStatuses.closed) / totalContacted) * 100)
        : 0;

      // Hevristični signali
      if (s.totalSpent > 1000) s.trustSignals.push('high_value_buyer');
      if (s.totalPurchases >= 3) s.trustSignals.push('repeat_customer');
      if (s.responseRate >= 70) s.trustSignals.push('responsive');
      if (s.daysAsCustomer > 90) s.trustSignals.push('long_term_relationship');
      if (s.locationConsistency) s.trustSignals.push('consistent_location');

      if (s.totalPurchases === 1 && s.totalSpent > 500) s.scamSignals.push('single_high_value_purchase');
      if (!s.locationConsistency) s.scamSignals.push('multiple_locations');
      if (s.responseRate < 30 && totalContacted > 0) s.scamSignals.push('low_response_rate');
      if (s.daysSinceLastPurchase > 180) s.scamSignals.push('inactive_long_time');
      if (s.priceRange.max / s.priceRange.min > 5) s.scamSignals.push('erratic_pricing');

      return s;
    });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const targetSellers = sellerName
      ? sellersWithMetrics.filter(s => s.name === sellerName)
      : sellersWithMetrics.slice(0, 25);

    const sellersStr = targetSellers.map(s =>
      `- ${s.name} | ${s.totalPurchases}x nakup | ${s.totalSpent}€ skupaj | ${s.avgPurchasePrice}€ povp | ${s.daysAsCustomer}d kot kupec | ${s.daysSinceLastPurchase}d od zadnjega | ${s.categories.size} kategorij | response ${s.responseRate}% | trust: ${s.trustSignals.join(',')} | scam: ${s.scamSignals.join(',')}`
    ).join('\n');

    const prompt = `Si AI seller reliability score v2 z napredno analizo vedenja prodajalcev.
Oceni zanesljivost prodajalcev od katerih kupuješ inventar za preprodajo.

PRODAJALCI ZA ANALIZO (${targetSellers.length}):
${sellersStr}

Trust score komponente (0-100):
1. TRANSACTION_HISTORY: dolžina in volumen odnosa
2. RESPONSIVENESS: hitrost in kvaliteta odgovorov
3. CONSISTENCY: lokacija, kategorije, cenovni rang
4. TRANSPARENCY: jasnost komunikacije, odkrivanje težav
5. FAIRNESS: realne cene, brez skritih stroškov
6. PROFESSIONALISM: način komuniciranja, dogovori
7. RELIABILITY_OF_DELIVERY: ali item pride kot opisan
8. FINANCIAL_INTEGRITY: pravilno plačilo, brez frauda

Red flags:
- Hitra zaporedna nakupa različnih kategorij (potential flipper)
- Različne lokacije (lahko lažna identiteta)
- Nizka response rate (ignorira vprašanja)
- Visoka variansa cen (drago+noceno istočasno)
- Single high-value purchase (potential scam)
- Dolga neaktivnost (lahka abandondan account)
- Off-platform komunikacija (sumljivo)

Green flags:
- Stalna lokacija (fizična prisotnost)
- Specializacija za 1-2 kategoriji (ekspert)
- Visok response rate (>70%)
- Dolgotrajen odnos (>90 dni)
- Repeat purchases (zadovoljni s transakcijami)
- Realne cene (v skladu s tržnimi)
- Odkrita komunikacija o stanju

Trust levels:
- VERIFIED_TRADER: 85-100, long-term, verified, premium
- TRUSTED: 70-84, reliable, repeat business
- NEUTRAL: 50-69, ok za manjše transakcije
- CAUTIOUS: 30-49, previdno, verify pred večjim nakupom
- SUSPICIOUS: 15-29, večje tveganje, only small transactions
- BLACKLISTED: 0-14, ne kupuj

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "sellers": [
    {
      "name": "<ime>",
      "trust_score": <number 0-100>,
      "trust_level": "<verified_trader|trusted|neutral|cautious|suspicious|blacklisted>",
      "transaction_history_score": <number 0-100>,
      "responsiveness_score": <number 0-100>,
      "consistency_score": <number 0-100>,
      "transparency_score": <number 0-100>,
      "fairness_score": <number 0-100>,
      "professionalism_score": <number 0-100>,
      "reliability_of_delivery_score": <number 0-100>,
      "financial_integrity_score": <number 0-100>,
      "red_flags": ["<max 100 znakov>"],
      "green_flags": ["<max 100 znakov>"],
      "recommended_action": "<strong_buy_from|buy_from|verify_first|small_transactions_only|avoid|blacklist>",
      "max_safe_transaction_eur": <number>,
      "specialty": "<max 80 znakov>",
      "negotiation_leverage": "<max 100 znakov>"
    }
  ],
  "behavior_patterns": [
    { "pattern": "<max 100 znakov>", "seller_count": <number>, "impact": "<positive|negative|neutral>", "description": "<max 150 znakov>" }
  ],
  "risk_indicators": [
    { "indicator": "<max 100 znakov>", "severity": "<low|medium|high|critical>", "affected_sellers": <number>, "mitigation": "<max 150 znakov>" }
  ],
  "trust_levels": [
    { "level": "<verified_trader|trusted|neutral|cautious|suspicious|blacklisted>", "seller_count": <number>, "avg_trust_score": <number>, "total_spent_eur": <number>, "strategy": "<max 120 znakov>" }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_impact_eur": <number>, "sellers_affected": <number> }
  ],
  "summary": {
    "total_sellers": <number>,
    "avg_trust_score": <number>,
    "verified_trader_count": <number>,
    "trusted_count": <number>,
    "neutral_count": <number>,
    "cautious_count": <number>,
    "suspicious_count": <number>,
    "blacklisted_count": <number>,
    "total_safe_investment_eur": <number>,
    "best_seller": "<max 100 znakov>",
    "biggest_risk_seller": "<max 100 znakov>",
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
          transactionHistoryScore: Math.max(0, Math.min(100, Number(s?.transaction_history_score ?? 50))),
          responsivenessScore: Math.max(0, Math.min(100, Number(s?.responsiveness_score ?? 50))),
          consistencyScore: Math.max(0, Math.min(100, Number(s?.consistency_score ?? 50))),
          transparencyScore: Math.max(0, Math.min(100, Number(s?.transparency_score ?? 50))),
          fairnessScore: Math.max(0, Math.min(100, Number(s?.fairness_score ?? 50))),
          professionalismScore: Math.max(0, Math.min(100, Number(s?.professionalism_score ?? 50))),
          reliabilityOfDeliveryScore: Math.max(0, Math.min(100, Number(s?.reliability_of_delivery_score ?? 50))),
          financialIntegrityScore: Math.max(0, Math.min(100, Number(s?.financial_integrity_score ?? 50))),
          redFlags: (s?.red_flags || []).slice(0, 5).map((f: any) => String(f).slice(0, 200)),
          greenFlags: (s?.green_flags || []).slice(0, 5).map((f: any) => String(f).slice(0, 200)),
          recommendedAction: ['strong_buy_from', 'buy_from', 'verify_first', 'small_transactions_only', 'avoid', 'blacklist'].includes(String(s?.recommended_action)) ? String(s.recommended_action) : 'verify_first',
          maxSafeTransactionEur: Math.round(Number(s?.max_safe_transaction_eur ?? 500)),
          specialty: String(s?.specialty ?? '').slice(0, 150),
          negotiationLeverage: String(s?.negotiation_leverage ?? '').slice(0, 200),
        })),
      behaviorPatterns: (parsed?.behavior_patterns || []).slice(0, 8).map((p: any) => ({
        pattern: String(p?.pattern ?? '').slice(0, 200),
        sellerCount: Math.max(0, Number(p?.seller_count ?? 0)),
        impact: ['positive', 'negative', 'neutral'].includes(String(p?.impact)) ? String(p.impact) : 'neutral',
        description: String(p?.description ?? '').slice(0, 300),
      })),
      riskIndicators: (parsed?.risk_indicators || []).slice(0, 6).map((r: any) => ({
        indicator: String(r?.indicator ?? '').slice(0, 200),
        severity: ['low', 'medium', 'high', 'critical'].includes(String(r?.severity)) ? String(r.severity) : 'medium',
        affectedSellers: Math.max(0, Number(r?.affected_sellers ?? 0)),
        mitigation: String(r?.mitigation ?? '').slice(0, 300),
      })),
      trustLevels: (parsed?.trust_levels || []).slice(0, 6).map((l: any) => ({
        level: ['verified_trader', 'trusted', 'neutral', 'cautious', 'suspicious', 'blacklisted'].includes(String(l?.level)) ? String(l.level) : 'neutral',
        sellerCount: Math.max(0, Number(l?.seller_count ?? 0)),
        avgTrustScore: Math.max(0, Math.min(100, Number(l?.avg_trust_score ?? 50))),
        totalSpentEur: Math.round(Number(l?.total_spent_eur ?? 0)),
        strategy: String(l?.strategy ?? '').slice(0, 250),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        expectedImpactEur: Math.round(Number(r?.expected_impact_eur ?? 0)),
        sellersAffected: Math.max(0, Number(r?.sellers_affected ?? 0)),
      })),
      summary: {
        totalSellers: targetSellers.length,
        avgTrustScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_trust_score ?? 50))),
        verifiedTraderCount: Math.max(0, Number(parsed?.summary?.verified_trader_count ?? 0)),
        trustedCount: Math.max(0, Number(parsed?.summary?.trusted_count ?? 0)),
        neutralCount: Math.max(0, Number(parsed?.summary?.neutral_count ?? 0)),
        cautiousCount: Math.max(0, Number(parsed?.summary?.cautious_count ?? 0)),
        suspiciousCount: Math.max(0, Number(parsed?.summary?.suspicious_count ?? 0)),
        blacklistedCount: Math.max(0, Number(parsed?.summary?.blacklisted_count ?? 0)),
        totalSafeInvestmentEur: Math.round(Number(parsed?.summary?.total_safe_investment_eur ?? 0)),
        bestSeller: String(parsed?.summary?.best_seller ?? '').slice(0, 200),
        biggestRiskSeller: String(parsed?.summary?.biggest_risk_seller ?? '').slice(0, 200),
        trustEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.trust_efficiency_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, scoring });
  } catch (e: any) { logger.error("/api/ai/seller-reliability-v2", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
