// v6.63 / v8.95.9-buyer-medium: AI Buyer Churn Prevention Strategist — preprečevanje odhoda kupcev z ML
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-churn-prevention-strategist
// Body: { customerName?: string }
// Returns: { ok, strategist: { buyers, riskFactors, preventionStrategies, interventions, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BuyerChurnPreventionInput {
  customerName: string | null;
}

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  sellLocation: string;
  buyDate: Date | null;
}

interface BuyerChurnInfo {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrderValue: number;
  firstPurchase: Date | null;
  lastPurchase: Date | null;
  daysAsCustomer: number;
  daysSinceLastPurchase: number;
  categories: Set<string>;
  purchaseDates: Date[];
  churnRisk: number;
  preventionPriority: string;
}

const PREVENTION_STRATEGIES = [
  'personal_outreach',
  'exclusive_offer',
  'loyalty_reward',
  'early_access',
  'bundle_deal',
  'price_lock',
  'birthday_bonus',
  'referral_incentive',
  'feedback_request',
  're_engagement_campaign',
] as const;

const RISK_FACTOR_KEYS = [
  'recency', 'frequency', 'monetary', 'engagement',
  'category_diversity', 'purchase_pattern', 'competition',
] as const;

const ML_MODELS = [
  'logistic_regression', 'random_forest', 'gradient_boosting',
  'neural_network', 'survival_analysis',
] as const;

const CHANNELS = ['email', 'sms', 'telegram', 'in_person', 'social'] as const;
const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;
const DAY = 24 * 60 * 60 * 1000;

export const POST = withAiRoute<BuyerChurnPreventionInput>({
  endpoint: '/api/ai/buyer-churn-prevention-strategist',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { customerName: body?.customerName ? String(body.customerName).trim() : null };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { customerName } = input;

    const soldTrades: SoldTradeRow[] = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, strategist: null, message: 'Ni prodaj za churn prevention analizo.' });
    }

    const now = Date.now();
    const buyers = buildBuyers(soldTrades, now, DAY);

    if (customerName) {
      const filtered = buyers.filter(b => b.name === customerName);
      if (filtered.length === 0) {
        return apiOk({ ok: true, strategist: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    const targetBuyers = customerName
      ? buyers.filter(b => b.name === customerName)
      : buyers.filter(b => b.churnRisk >= 20).slice(0, 25);

    const prompt = buildPrompt(targetBuyers);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const strategist = transformStrategist(parsed, targetBuyers);

    return apiOk({ ok: true, strategist });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildBuyers(soldTrades: SoldTradeRow[], now: number, DAY: number): BuyerChurnInfo[] {
  const buyerMap = new Map<string, BuyerChurnInfo>();
  for (const t of soldTrades) {
    const name = (t.sellLocation || '').trim();
    if (!name || name.length < 2 || !t.sellDate) continue;
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    if (!buyerMap.has(name)) {
      buyerMap.set(name, {
        name, purchases: 0, totalSpent: 0, avgOrderValue: 0,
        firstPurchase: t.sellDate, lastPurchase: t.sellDate,
        daysAsCustomer: 0, daysSinceLastPurchase: 0,
        categories: new Set(), purchaseDates: [], churnRisk: 0, preventionPriority: 'medium',
      });
    }
    const b = buyerMap.get(name)!;
    b.purchases += 1; b.totalSpent += revenue;
    if (t.sellDate < (b.firstPurchase as Date)) b.firstPurchase = t.sellDate;
    if (t.sellDate > b.lastPurchase!) b.lastPurchase = t.sellDate;
    if (t.category) b.categories.add(t.category);
    b.purchaseDates.push(t.sellDate);
  }

  return Array.from(buyerMap.values()).map(b => {
    b.avgOrderValue = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0;
    if (b.firstPurchase && b.lastPurchase) {
      b.daysAsCustomer = Math.max(1, Math.round((now - b.firstPurchase.getTime()) / DAY));
      b.daysSinceLastPurchase = Math.round((now - b.lastPurchase.getTime()) / DAY);
    }
    // Churn risk calculation
    let risk = 0;
    if (b.daysSinceLastPurchase > 180) risk += 50;
    else if (b.daysSinceLastPurchase > 90) risk += 30;
    else if (b.daysSinceLastPurchase > 60) risk += 20;
    else if (b.daysSinceLastPurchase > 30) risk += 10;
    if (b.purchases === 1) risk += 20;
    if (b.totalSpent < 100) risk += 10;
    b.churnRisk = Math.max(0, Math.min(100, risk));
    // Prevention priority
    if (b.churnRisk >= 60) b.preventionPriority = 'high';
    else if (b.churnRisk >= 30) b.preventionPriority = 'medium';
    else b.preventionPriority = 'low';
    return b;
  });
}

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function buildPrompt(targetBuyers: BuyerChurnInfo[]): string {
  const buyersStr = targetBuyers.slice(0, 15).map(b =>
    `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.daysAsCustomer}d | ${b.daysSinceLastPurchase}d zadnji | churn risk ${b.churnRisk}/100 | priority: ${b.preventionPriority}`
  ).join('\n');

  return `Si AI buyer churn prevention strategist z ML za preprečevanje odhoda kupcev.
Identificira kupce z visokim churn riskom in predlaga prevention strategije.

KUPCI ZA CHURN PREVENTION (${targetBuyers.length}):
${buyersStr}

10 prevention strategij:
1. PERSONAL_OUTREACH: osebno sporočilo z referenco preteklih nakupov
2. EXCLUSIVE_OFFER: ekskluziven popust za povratnika
3. LOYALTY_REWARD: zvestoba nagrada za multi-kupca
4. EARLY_ACCESS: predhodni dostop do novega inventarja
5. BUNDLE_DEAL: paket na podlagi preteklih kategorij
6. PRICE_LOCK: zakleni ceno za naslednji nakup
7. BIRTHDAY_BONUS: rojstni dan bonus
8. REFERRAL_INCENTIVE: priporočilo za nove kupce
9. FEEDBACK_REQUEST: prošnja za feedback (pokaže da ti mar)
10. RE_ENGAGEMENT_CAMPAIGN: multi-touch kampanja za dormant

Churn risk faktorji:
- RECENCY: koliko dni od zadnjega nakupa
- FREQUENCY: kako pogosto kupuje
- MONETARY: koliko porabi
- ENGAGEMENT: ali odgovarja na outreach
- CATEGORY_DIVERISTY: ali kupuje raznoliko
- PURCHASE_PATTERN: ali je pattern break
- COMPETITION: ali kupuje od drugih

ML modeli:
- LOGISTIC_REGRESSION: binary churn prediction
- RANDOM_FOREST: churn classification
- GRADIENT_BOOSTING: high accuracy churn
- NEURAL_NETWORK: complex patterns
- SURVIVAL_ANALYSIS: time-to-churn

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    {
      "name": "<ime>",
      "churn_risk_pct": <number 0-100>,
      "churn_risk_level": "<low|medium|high|critical>",
      "predicted_churn_date": "<YYYY-MM-DD ali null>",
      "days_until_churn": <number ali null>,
      "risk_factors": ["<max 80 znakov>"],
      "retention_probability_pct": <number 0-100>,
      "predicted_value_at_risk_eur": <number>,
      "recommended_strategy": "<10 strategij>",
      "strategy_reasoning": "<max 120 znakov>",
      "intervention_message": "<max 250 znakov>",
      "best_channel": "<email|sms|telegram|in_person|social>",
      "best_timing": "<max 80 znakov>",
      "expected_retention_probability_pct": <number 0-100>,
      "expected_value_saved_eur": <number>,
      "priority": "<high|medium|low>"
    }
  ],
  "risk_factors": [
    {
      "factor": "<recency|frequency|monetary|engagement|category_diversity|purchase_pattern|competition>",
      "weight": <number 0-100>,
      "description": "<max 100 znakov>",
      "threshold_critical": "<max 80 znakov>",
      "affected_buyers": <number>,
      "mitigation": "<max 120 znakov>"
    }
  ],
  "prevention_strategies": [
    {
      "strategy": "<10 strategij>",
      "description": "<max 120 znakov>",
      "best_for_risk_level": "<low|medium|high|critical>",
      "expected_success_rate_pct": <number 0-100>,
      "implementation_cost_eur": <number>,
      "expected_value_saved_eur": <number>,
      "roi_score": <number 0-100>,
      "timeframe_days": <number>
    }
  ],
  "interventions": [
    {
      "buyer_name": "<ime>",
      "day_offset": <0-30>,
      "action": "<max 100 znakov>",
      "channel": "<email|sms|telegram|in_person|social>",
      "message_template": "<max 200 znakov>",
      "expected_response_rate_pct": <number 0-100>
    }
  ],
  "ml_models": [
    {
      "model": "<logistic_regression|random_forest|gradient_boosting|neural_network|survival_analysis>",
      "accuracy_pct": <number 0-100>,
      "precision_pct": <number 0-100>,
      "recall_pct": <number 0-100>,
      "f1_score": <number 0-100>,
      "weight_in_ensemble": <number 0-100>,
      "best_for": "<max 80 znakov>"
    }
  ],
  "summary": {
    "total_buyers_analyzed": <number>,
    "high_risk_count": <number>,
    "medium_risk_count": <number>,
    "low_risk_count": <number>,
    "critical_risk_count": <number>,
    "total_value_at_risk_eur": <number>,
    "total_saveable_value_eur": <number>,
    "avg_churn_risk_pct": <number>,
    "best_prevention_strategy": "<max 80 znakov>",
    "biggest_churn_driver": "<max 100 znakov>",
    "churn_prevention_score": <number 0-100>
  }
}`;
}

function transformStrategist(parsed: any, targetBuyers: BuyerChurnInfo[]): any {
  const validNames = new Set(targetBuyers.map(b => b.name));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    buyers: (parsed?.buyers || [])
      .filter((b: any) => validNames.has(String(b?.name ?? '')))
      .slice(0, 25)
      .map((b: any) => ({
        name: String(b?.name ?? '').slice(0, 100),
        churnRiskPct: Math.max(0, Math.min(100, Number(b?.churn_risk_pct ?? 30))),
        churnRiskLevel: includes(RISK_LEVELS, String(b?.churn_risk_level)) ? String(b.churn_risk_level) : 'medium',
        predictedChurnDate: String(b?.predicted_churn_date ?? '').slice(0, 20),
        daysUntilChurn: b?.days_until_churn !== null && b?.days_until_churn !== undefined ? Math.max(0, Number(b.days_until_churn)) : null,
        riskFactors: (b?.risk_factors || []).slice(0, 5).map((r: any) => String(r).slice(0, 150)),
        retentionProbabilityPct: Math.max(0, Math.min(100, Number(b?.retention_probability_pct ?? 60))),
        predictedValueAtRiskEur: Math.round(Number(b?.predicted_value_at_risk_eur ?? 0)),
        recommendedStrategy: includes(PREVENTION_STRATEGIES, String(b?.recommended_strategy)) ? String(b.recommended_strategy) : 'personal_outreach',
        strategyReasoning: String(b?.strategy_reasoning ?? '').slice(0, 250),
        interventionMessage: String(b?.intervention_message ?? '').slice(0, 500),
        bestChannel: includes(CHANNELS, String(b?.best_channel)) ? String(b.best_channel) : 'email',
        bestTiming: String(b?.best_timing ?? '').slice(0, 150),
        expectedRetentionProbabilityPct: Math.max(0, Math.min(100, Number(b?.expected_retention_probability_pct ?? 50))),
        expectedValueSavedEur: Math.round(Number(b?.expected_value_saved_eur ?? 0)),
        priority: includes(PRIORITIES, String(b?.priority)) ? String(b.priority) : 'medium',
      })),
    riskFactors: (parsed?.risk_factors || []).slice(0, 7).map((r: any) => ({
      factor: includes(RISK_FACTOR_KEYS, String(r?.factor)) ? String(r.factor) : 'recency',
      weight: Math.max(0, Math.min(100, Number(r?.weight ?? 50))),
      description: String(r?.description ?? '').slice(0, 200),
      thresholdCritical: String(r?.threshold_critical ?? '').slice(0, 150),
      affectedBuyers: Math.max(0, Number(r?.affected_buyers ?? 0)),
      mitigation: String(r?.mitigation ?? '').slice(0, 250),
    })),
    preventionStrategies: (parsed?.prevention_strategies || []).slice(0, 10).map((s: any) => ({
      strategy: includes(PREVENTION_STRATEGIES, String(s?.strategy)) ? String(s.strategy) : 'personal_outreach',
      description: String(s?.description ?? '').slice(0, 250),
      bestForRiskLevel: includes(RISK_LEVELS, String(s?.best_for_risk_level)) ? String(s.best_for_risk_level) : 'medium',
      expectedSuccessRatePct: Math.max(0, Math.min(100, Number(s?.expected_success_rate_pct ?? 30))),
      implementationCostEur: Math.round(Number(s?.implementation_cost_eur ?? 0)),
      expectedValueSavedEur: Math.round(Number(s?.expected_value_saved_eur ?? 0)),
      roiScore: Math.max(0, Math.min(100, Number(s?.roi_score ?? 50))),
      timeframeDays: Math.max(1, Number(s?.timeframe_days ?? 7)),
    })),
    interventions: (parsed?.interventions || [])
      .filter((i: any) => validNames.has(String(i?.buyer_name ?? '')))
      .slice(0, 20)
      .map((i: any) => ({
        buyerName: String(i?.buyer_name ?? '').slice(0, 100),
        dayOffset: Math.max(0, Math.min(30, Number(i?.day_offset ?? 0))),
        action: String(i?.action ?? '').slice(0, 200),
        channel: includes(CHANNELS, String(i?.channel)) ? String(i.channel) : 'email',
        messageTemplate: String(i?.message_template ?? '').slice(0, 400),
        expectedResponseRatePct: Math.max(0, Math.min(100, Number(i?.expected_response_rate_pct ?? 30))),
      })),
    mlModels: (parsed?.ml_models || []).slice(0, 5).map((m: any) => ({
      model: includes(ML_MODELS, String(m?.model)) ? String(m.model) : 'logistic_regression',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      precisionPct: Math.max(0, Math.min(100, Number(m?.precision_pct ?? 70))),
      recallPct: Math.max(0, Math.min(100, Number(m?.recall_pct ?? 65))),
      f1Score: Math.max(0, Math.min(100, Number(m?.f1_score ?? 67))),
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
      bestFor: String(m?.best_for ?? '').slice(0, 150),
    })),
    summary: {
      totalBuyersAnalyzed: targetBuyers.length,
      highRiskCount: Math.max(0, Number(parsed?.summary?.high_risk_count ?? targetBuyers.filter(b => b.churnRisk >= 50).length)),
      mediumRiskCount: Math.max(0, Number(parsed?.summary?.medium_risk_count ?? targetBuyers.filter(b => b.churnRisk >= 30 && b.churnRisk < 50).length)),
      lowRiskCount: Math.max(0, Number(parsed?.summary?.low_risk_count ?? targetBuyers.filter(b => b.churnRisk < 30).length)),
      criticalRiskCount: Math.max(0, Number(parsed?.summary?.critical_risk_count ?? targetBuyers.filter(b => b.churnRisk >= 80).length)),
      totalValueAtRiskEur: Math.round(Number(parsed?.summary?.total_value_at_risk_eur ?? 0)),
      totalSaveableValueEur: Math.round(Number(parsed?.summary?.total_saveable_value_eur ?? 0)),
      avgChurnRiskPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_churn_risk_pct ?? Math.round(targetBuyers.reduce((s, b) => s + b.churnRisk, 0) / Math.max(1, targetBuyers.length))))),
      bestPreventionStrategy: includes(PREVENTION_STRATEGIES, String(parsed?.summary?.best_prevention_strategy)) ? String(parsed.summary.best_prevention_strategy) : 'personal_outreach',
      biggestChurnDriver: String(parsed?.summary?.biggest_churn_driver ?? '').slice(0, 200),
      churnPreventionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.churn_prevention_score ?? 60))),
    },
  };
}
