// v6.51: AI Buyer Retention Predictor — napove churn in predlaga win-back strategije
// POST /api/ai/buyer-retention-predictor
// Body: { customerName?: string, daysAhead?: number }
// Returns: { ok, predictor: { buyers, churnFactors, winBackStrategies, retentionPlan, predictions, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

interface BuyerRetention {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrderValue: number;
  firstPurchase: Date | null;
  lastPurchase: Date | null;
  daysAsCustomer: number;
  daysSinceLastPurchase: number;
  categories: Set<string>;
  items: string[];
  purchaseFrequency: number; // purchases per month
  churnRiskScore: number; // 0-100
  retentionScore: number; // 0-100
  lifetimeValueEur: number;
  stage: 'new' | 'active' | 'at_risk' | 'churning' | 'churned';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;
    const daysAhead = Math.max(7, Math.min(365, Number(body?.daysAhead ?? 90)));

    // 1. Pridobi sold trades
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return NextResponse.json({ ok: true, predictor: null, message: 'Ni prodaj za retention analizo.' });
    }

    // 2. Buyer aggregation
    const buyerMap = new Map<string, BuyerRetention>();
    const now = Date.now();

    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2 || !t.sellDate) continue;
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);

      if (!buyerMap.has(name)) {
        buyerMap.set(name, {
          name, purchases: 0, totalSpent: 0, avgOrderValue: 0,
          firstPurchase: t.sellDate, lastPurchase: t.sellDate,
          daysAsCustomer: 0, daysSinceLastPurchase: 0,
          categories: new Set<string>(), items: [],
          purchaseFrequency: 0, churnRiskScore: 0, retentionScore: 0,
          lifetimeValueEur: 0, stage: 'new',
        });
      }
      const b = buyerMap.get(name)!;
      b.purchases += 1;
      b.totalSpent += revenue;
      if (t.sellDate < (b.firstPurchase as Date)) b.firstPurchase = t.sellDate;
      if (t.sellDate > (b.lastPurchase!)) b.lastPurchase = t.sellDate;
      if (t.category) b.categories.add(t.category);
      b.items.push(t.title);
    }

    // 3. Hevristika za churn in retention
    const buyers = Array.from(buyerMap.values()).map(b => {
      if (b.firstPurchase && b.lastPurchase) {
        b.daysAsCustomer = Math.max(1, Math.round((now - b.firstPurchase.getTime()) / (24*60*60*1000)));
        b.daysSinceLastPurchase = Math.round((now - b.lastPurchase.getTime()) / (24*60*60*1000));
      }
      b.avgOrderValue = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0;
      b.purchaseFrequency = b.daysAsCustomer > 0 ? Math.round((b.purchases / b.daysAsCustomer) * 30 * 10) / 10 : 0;

      // Churn risk (0-100, višji = večji risk)
      let churn = 0;
      if (b.daysSinceLastPurchase > 180) churn += 40;
      else if (b.daysSinceLastPurchase > 90) churn += 25;
      else if (b.daysSinceLastPurchase > 60) churn += 15;
      else if (b.daysSinceLastPurchase > 30) churn += 5;
      if (b.purchases === 1) churn += 20;
      if (b.purchaseFrequency < 0.5) churn += 15;
      else if (b.purchaseFrequency > 2) churn -= 10;
      if (b.categories.size === 1) churn += 5;
      b.churnRiskScore = Math.max(0, Math.min(100, churn));

      // Retention score (0-100, višji = boljši)
      let ret = 50;
      if (b.purchases >= 3) ret += 20;
      if (b.totalSpent > 500) ret += 15;
      if (b.daysAsCustomer > 90) ret += 10;
      if (b.daysSinceLastPurchase < 30) ret += 15;
      if (b.purchaseFrequency > 1) ret += 10;
      if (b.categories.size > 2) ret += 5;
      b.retentionScore = Math.max(0, Math.min(100, ret));

      // Stage
      if (b.daysSinceLastPurchase > 180) b.stage = 'churned';
      else if (b.daysSinceLastPurchase > 90) b.stage = 'churning';
      else if (b.daysSinceLastPurchase > 60 || b.churnRiskScore > 50) b.stage = 'at_risk';
      else if (b.daysAsCustomer < 30) b.stage = 'new';
      else b.stage = 'active';

      // LTV projection
      const recencyFactor = Math.max(0.1, 1 - b.daysSinceLastPurchase / 365);
      b.lifetimeValueEur = Math.round(b.totalSpent * recencyFactor * (b.retentionScore / 100 + 0.5));

      return b;
    });

    if (customerName) {
      const filtered = buyers.filter(b => b.name === customerName);
      if (filtered.length === 0) {
        return NextResponse.json({ ok: true, predictor: null, message: `Kupec "${customerName}" ni najden.` });
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

    const targetBuyers = customerName
      ? buyers.filter(b => b.name === customerName)
      : buyers.slice(0, 25);

    const buyersStr = targetBuyers.map(b =>
      `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.daysAsCustomer}d | ${b.daysSinceLastPurchase}d zadnji | freq ${b.purchaseFrequency}/mesec | churn risk ${b.churnRiskScore}/100 | retention ${b.retentionScore}/100 | stage: ${b.stage} | LTV ${b.lifetimeValueEur}€`
    ).join('\n');

    const prompt = `Si AI buyer retention predictor za slovenske oglasne platforme.
Napove churn in predlaga win-back strategije za vsakega kupca.

KUPCI ZA ANALIZO (${targetBuyers.length}):
${buyersStr}

Churn faktorji:
1. RECENCY: koliko dni od zadnjega nakupa (>180d = churned)
2. FREQUENCY: kako pogosto kupuje (1x = visok churn risk)
3. MONETARY: koliko je porabil (low value = lahko odide)
4. CATEGORIES: samo 1 kategorija = manj vezan
5. ENGAGEMENT: ali komunicira, clicka emaile
6. COMPETITION: ali kupuje od drugih (težko izmeriti)
7. SEASONALITY: ali je kupoval samo sezonsko

Stage-i:
- NEW: prvi nakup v zadnjih 30 dneh (ni še pattern)
- ACTIVE: redni kupci, nedavno aktivni
- AT_RISK: 60-90d od zadnjega, padajoča frekvenca
- CHURNING: 90-180d, verjetno izgubljen če ne ukrepamo
- CHURNED: >180d, težko reaktivirati

Win-back strategije:
1. PERSONAL_OUTREACH: osebno sporočilo z referenco preteklih nakupov
2. EXCLUSIVE_OFFER: ekskluziven popust za povratnika
3. EARLY_ACCESS: predhodni dostop do novega inventarja
4. BUNDLE_DEAL: paket na podlagi preteklih kategorij
5. LOYALTY_REWARD: zvestoba nagrada za multi-kupca
6. REACTIVATION_DISCOUNT: specifičen popust za dormant kupca
7. CHECK_IN_MESSAGE: preprosto vprašanje kako si, brez prodaje
8. REFERRAL_REQUEST: prošnja za priporočilo (lahko ponovno aktivira)

Retention taktike:
- PROACTIVE: kontaktiraj preden postane at_risk
- REACTIVE: kontaktiraj ko je at_risk
- EMERGENCY: kontaktiraj ko je churning
- RECOVERY: poskusi reaktivirati churned (nizka verjetnost)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    {
      "name": "<ime>",
      "churn_probability_pct": <number 0-100>,
      "retention_probability_pct": <number 0-100>,
      "stage": "<new|active|at_risk|churning|churned>",
      "days_until_churn": <number ali null>,
      "projected_ltv_eur": <number>,
      "at_risk_factors": ["<max 80 znakov>"],
      "retention_drivers": ["<max 80 znakov>"],
      "recommended_strategy": "<personal_outreach|exclusive_offer|early_access|bundle_deal|loyalty_reward|reactivation_discount|check_in_message|referral_request>",
      "expected_retention_probability_pct": <number>,
      "expected_ltv_uplift_eur": <number>,
      "best_contact_channel": "<email|sms|call|in_person|social>",
      "best_contact_time": "<max 80 znakov>"
    }
  ],
  "churn_factors": [
    { "factor": "<recency|frequency|monetary|categories|engagement|competition|seasonality>", "impact_weight": <number 0-100>, "description": "<max 100 znakov>", "threshold_critical": "<max 80 znakov>", "mitigation": "<max 120 znakov>" }
  ],
  "win_back_strategies": [
    { "strategy": "<personal_outreach|exclusive_offer|early_access|bundle_deal|loyalty_reward|reactivation_discount|check_in_message|referral_request>", "description": "<max 120 znakov>", "best_for_stage": "<stage>", "expected_success_rate_pct": <number>, "implementation_cost_eur": <number>, "expected_ltv_uplift_eur": <number>, "roi_score": <number 0-100> }
  ],
  "retention_plan": [
    { "buyer_name": "<ime>", "day_offset": <number 0-90>, "action": "<max 100 znakov>", "channel": "<email|sms|call|in_person>", "message_template": "<max 200 znakov>", "expected_response_rate_pct": <number> }
  ],
  "predictions": [
    { "timeframe_days": <number>, "active_buyers": <number>, "at_risk_buyers": <number>, "churned_buyers": <number>, "retained_revenue_eur": <number>, "lost_revenue_eur": <number> }
  ],
  "summary": {
    "total_buyers_analyzed": <number>,
    "new_count": <number>,
    "active_count": <number>,
    "at_risk_count": <number>,
    "churning_count": <number>,
    "churned_count": <number>,
    "avg_churn_probability_pct": <number>,
    "avg_retention_probability_pct": <number>,
    "total_projected_ltv_eur": <number>,
    "total_at_risk_revenue_eur": <number>,
    "biggest_churn_driver": "<max 100 znakov>",
    "best_win_back_strategy": "<max 100 znakov>",
    "retention_efficiency_score": <number 0-100>
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
    const validNames = new Set(targetBuyers.map(b => b.name));

    const predictor = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      buyers: (parsed?.buyers || [])
        .filter((b: any) => validNames.has(String(b?.name ?? '')))
        .slice(0, 25)
        .map((b: any) => {
          const orig = targetBuyers.find(x => x.name === String(b?.name));
          return {
            name: String(b?.name ?? '').slice(0, 100),
            churnProbabilityPct: Math.max(0, Math.min(100, Number(b?.churn_probability_pct ?? orig?.churnRiskScore ?? 50))),
            retentionProbabilityPct: Math.max(0, Math.min(100, Number(b?.retention_probability_pct ?? orig?.retentionScore ?? 50))),
            stage: ['new', 'active', 'at_risk', 'churning', 'churned'].includes(String(b?.stage)) ? String(b.stage) : (orig?.stage ?? 'active'),
            daysUntilChurn: b?.days_until_churn !== null && b?.days_until_churn !== undefined ? Math.max(0, Number(b.days_until_churn)) : null,
            projectedLtvEur: Math.round(Number(b?.projected_ltv_eur ?? orig?.lifetimeValueEur ?? 0)),
            atRiskFactors: (b?.at_risk_factors || []).slice(0, 5).map((f: any) => String(f).slice(0, 150)),
            retentionDrivers: (b?.retention_drivers || []).slice(0, 5).map((d: any) => String(d).slice(0, 150)),
            recommendedStrategy: ['personal_outreach', 'exclusive_offer', 'early_access', 'bundle_deal', 'loyalty_reward', 'reactivation_discount', 'check_in_message', 'referral_request'].includes(String(b?.recommended_strategy)) ? String(b.recommended_strategy) : 'personal_outreach',
            expectedRetentionProbabilityPct: Math.max(0, Math.min(100, Number(b?.expected_retention_probability_pct ?? 50))),
            expectedLtvUpliftEur: Math.round(Number(b?.expected_ltv_uplift_eur ?? 0)),
            bestContactChannel: ['email', 'sms', 'call', 'in_person', 'social'].includes(String(b?.best_contact_channel)) ? String(b.best_contact_channel) : 'email',
            bestContactTime: String(b?.best_contact_time ?? '').slice(0, 150),
          };
        }),
      churnFactors: (parsed?.churn_factors || []).slice(0, 7).map((f: any) => ({
        factor: ['recency', 'frequency', 'monetary', 'categories', 'engagement', 'competition', 'seasonality'].includes(String(f?.factor)) ? String(f.factor) : 'recency',
        impactWeight: Math.max(0, Math.min(100, Number(f?.impact_weight ?? 50))),
        description: String(f?.description ?? '').slice(0, 200),
        thresholdCritical: String(f?.threshold_critical ?? '').slice(0, 150),
        mitigation: String(f?.mitigation ?? '').slice(0, 250),
      })),
      winBackStrategies: (parsed?.win_back_strategies || []).slice(0, 8).map((s: any) => ({
        strategy: ['personal_outreach', 'exclusive_offer', 'early_access', 'bundle_deal', 'loyalty_reward', 'reactivation_discount', 'check_in_message', 'referral_request'].includes(String(s?.strategy)) ? String(s.strategy) : 'personal_outreach',
        description: String(s?.description ?? '').slice(0, 250),
        bestForStage: ['new', 'active', 'at_risk', 'churning', 'churned'].includes(String(s?.best_for_stage)) ? String(s.best_for_stage) : 'at_risk',
        expectedSuccessRatePct: Math.max(0, Math.min(100, Number(s?.expected_success_rate_pct ?? 30))),
        implementationCostEur: Math.round(Number(s?.implementation_cost_eur ?? 0)),
        expectedLtvUpliftEur: Math.round(Number(s?.expected_ltv_uplift_eur ?? 0)),
        roiScore: Math.max(0, Math.min(100, Number(s?.roi_score ?? 50))),
      })),
      retentionPlan: (parsed?.retention_plan || [])
        .filter((p: any) => validNames.has(String(p?.buyer_name ?? '')))
        .slice(0, 20)
        .map((p: any) => ({
          buyerName: String(p?.buyer_name ?? '').slice(0, 100),
          dayOffset: Math.max(0, Math.min(90, Number(p?.day_offset ?? 0))),
          action: String(p?.action ?? '').slice(0, 200),
          channel: ['email', 'sms', 'call', 'in_person'].includes(String(p?.channel)) ? String(p.channel) : 'email',
          messageTemplate: String(p?.message_template ?? '').slice(0, 400),
          expectedResponseRatePct: Math.max(0, Math.min(100, Number(p?.expected_response_rate_pct ?? 30))),
        })),
      predictions: (parsed?.predictions || []).slice(0, 4).map((p: any) => ({
        timeframeDays: Math.max(7, Number(p?.timeframe_days ?? 30)),
        activeBuyers: Math.max(0, Number(p?.active_buyers ?? 0)),
        atRiskBuyers: Math.max(0, Number(p?.at_risk_buyers ?? 0)),
        churnedBuyers: Math.max(0, Number(p?.churned_buyers ?? 0)),
        retainedRevenueEur: Math.round(Number(p?.retained_revenue_eur ?? 0)),
        lostRevenueEur: Math.round(Number(p?.lost_revenue_eur ?? 0)),
      })),
      summary: {
        totalBuyersAnalyzed: targetBuyers.length,
        newCount: Math.max(0, Number(parsed?.summary?.new_count ?? targetBuyers.filter(b => b.stage === 'new').length)),
        activeCount: Math.max(0, Number(parsed?.summary?.active_count ?? targetBuyers.filter(b => b.stage === 'active').length)),
        atRiskCount: Math.max(0, Number(parsed?.summary?.at_risk_count ?? targetBuyers.filter(b => b.stage === 'at_risk').length)),
        churningCount: Math.max(0, Number(parsed?.summary?.churning_count ?? targetBuyers.filter(b => b.stage === 'churning').length)),
        churnedCount: Math.max(0, Number(parsed?.summary?.churned_count ?? targetBuyers.filter(b => b.stage === 'churned').length)),
        avgChurnProbabilityPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_churn_probability_pct ?? Math.round(targetBuyers.reduce((s, b) => s + b.churnRiskScore, 0) / Math.max(1, targetBuyers.length))))),
        avgRetentionProbabilityPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_retention_probability_pct ?? Math.round(targetBuyers.reduce((s, b) => s + b.retentionScore, 0) / Math.max(1, targetBuyers.length))))),
        totalProjectedLtvEur: Math.round(Number(parsed?.summary?.total_projected_ltv_eur ?? targetBuyers.reduce((s, b) => s + b.lifetimeValueEur, 0))),
        totalAtRiskRevenueEur: Math.round(Number(parsed?.summary?.total_at_risk_revenue_eur ?? 0)),
        biggestChurnDriver: String(parsed?.summary?.biggest_churn_driver ?? '').slice(0, 200),
        bestWinBackStrategy: String(parsed?.summary?.best_win_back_strategy ?? '').slice(0, 200),
        retentionEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.retention_efficiency_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, predictor });
  } catch (e: any) { logger.error("/api/ai/buyer-retention-predictor", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
