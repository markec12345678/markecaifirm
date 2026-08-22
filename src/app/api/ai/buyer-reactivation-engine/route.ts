// v6.91 / v8.95.4-batch2: AI Buyer Reactivation Engine — ML reaktivacija neaktivnih kupcev z win-back strategy
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-reactivation-engine
// Body: { customerName?: string, inactiveDays?: number }
// Returns: { ok, engine: { overview, inactiveBuyers, reactivationStrategies, campaignPlan, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BuyerReactivationEngineInput {
  customerName: string | null;
  inactiveDays: number;
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

interface BuyerInfo {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrder: number;
  firstPurchase: Date | null;
  lastPurchase: Date | null;
  categories: Set<string>;
  daysSinceLast: number;
  lifetimeDays: number;
}

const REACTIVATION_TIERS = ['highly_reactivatable', 'reactivatable', 'difficult_to_reactivate', 'hard_to_reactivate', 'unlikely_to_reactivate', 'lost'] as const;
const STRATEGY_TYPES = ['win_back_discount', 'personalized_outreach', 'new_product_alert', 'loyalty_reward', 'feedback_request', 'exclusive_offer', 'milestone_celebration', 're_engagement_campaign'] as const;
const ML_MODELS = ['random_forest', 'xgboost', 'neural_net', 'survival_analysis', 'ensemble'] as const;
const ML_PREDICTION_TYPES = ['reactivation_probability', 'churn_prediction', 'response_forecast', 'value_prediction'] as const;
const CAMPAIGN_PHASES = ['awareness', 'consideration', 'incentive', 'follow_up', 'retention'] as const;
const CAMPAIGN_CHANNELS = ['email', 'sms', 'whatsapp', 'push', 'social', 'phone'] as const;
const GRADES = ['A', 'B', 'C', 'D', 'F'] as const;

export const POST = withAiRoute<BuyerReactivationEngineInput>({
  endpoint: '/api/ai/buyer-reactivation-engine',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      customerName: body?.customerName ? String(body.customerName).trim() : null,
      inactiveDays: Math.max(30, Math.min(730, Number(body?.inactiveDays ?? 90))),
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { customerName, inactiveDays } = input;

    const soldTrades: SoldTradeRow[] = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, engine: null, message: 'Ni prodaj za reactivation analizo.' });
    }

    const allBuyers = buildBuyerMap(soldTrades);
    const inactiveBuyers = allBuyers.filter(b => b.daysSinceLast >= inactiveDays);

    if (customerName) {
      const f = allBuyers.filter(b => b.name === customerName);
      if (f.length === 0) {
        return apiOk({ ok: true, engine: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }
    if (inactiveBuyers.length === 0) {
      return apiOk({ ok: true, engine: null, message: `Ni neaktivnih kupcev (>${inactiveDays} dni).` });
    }

    const targetBuyers = customerName ? allBuyers.filter(b => b.name === customerName) : inactiveBuyers.slice(0, 25);
    const prompt = buildPrompt(targetBuyers, inactiveDays);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const engine = transformEngine(parsed, inactiveBuyers);
    return apiOk({ ok: true, engine });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildBuyerMap(soldTrades: SoldTradeRow[]): BuyerInfo[] {
  const buyerMap = new Map<string, BuyerInfo>();
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  for (const t of soldTrades) {
    const name = (t.sellLocation || '').trim();
    if (!name || name.length < 2 || !t.sellDate) continue;
    const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    if (!buyerMap.has(name)) {
      buyerMap.set(name, {
        name, purchases: 0, totalSpent: 0, avgOrder: 0,
        firstPurchase: t.sellDate, lastPurchase: t.sellDate,
        categories: new Set(), daysSinceLast: 0, lifetimeDays: 0,
      });
    }
    const b = buyerMap.get(name)!;
    b.purchases += 1;
    b.totalSpent += rev;
    if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate;
    if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
    if (t.category) b.categories.add(t.category);
  }
  return Array.from(buyerMap.values()).map(b => {
    b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0;
    b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / DAY) : 999;
    b.lifetimeDays = b.firstPurchase ? Math.round((now - b.firstPurchase.getTime()) / DAY) : 0;
    return b;
  });
}

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Math.round(Number(n) * 10) / 10;
}

function buildPrompt(targetBuyers: BuyerInfo[], inactiveDays: number): string {
  const buyersStr = targetBuyers.slice(0, 10).map(b =>
    `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d neaktiven | ${b.lifetimeDays}d lifetime`
  ).join('\n');

  return `Si AI buyer reactivation engine z ML in win-back strategy design.
Reaktivira neaktivne kupce (>${inactiveDays} dni) z 6 tierji in 8 strategijami.

NEAKTIVNI KUPCI (${targetBuyers.length}, >${inactiveDays} dni):
${buyersStr}

6 reactivation tierjev:
1. HIGHLY_REACTIVATABLE: 80-100% verjetnost reaktivacije
2. REACTIVATABLE: 60-79%
3. DIFFICULT_TO_REACTIVATE: 40-59%
4. HARD_TO_REACTIVATE: 20-39%
5. UNLIKELY_TO_REACTIVATE: 5-19%
6. LOST: <5%

8 strategij reaktivacije: win_back_discount, personalized_outreach, new_product_alert, loyalty_reward, feedback_request, exclusive_offer, milestone_celebration, re_engagement_campaign

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_inactive_buyers": <number>, "total_inactive_value_eur": <number>, "avg_inactive_days": <number>, "avg_reactivation_probability_pct": <number 0-100>, "highly_reactivatable_count": <number>, "reactivation_grade": "<A|B|C|D|F>" },
  "inactiveBuyers": [
    { "name": "<string>", "days_inactive": <number>, "lifetime_value_eur": <number>, "last_purchase_value_eur": <number>, "reactivation_probability_pct": <number 0-100>, "reactivation_tier": "<${REACTIVATION_TIERS.join('|')}>", "preferred_strategy": "<${STRATEGY_TYPES.join('|')}>" }
  ],
  "reactivationStrategies": [
    { "strategy_type": "<${STRATEGY_TYPES.join('|')}>", "target_buyer_count": <number>, "estimated_cost_eur": <number>, "expected_reactivations": <number>, "expected_revenue_eur": <number>, "roi_pct": <number>, "best_for_tier": "<${REACTIVATION_TIERS.join('|')}>" }
  ],
  "campaignPlan": [
    { "phase": "<awareness|consideration|incentive|follow_up|retention>", "channel": "<email|sms|whatsapp|push|social|phone>", "timing_days": <number>, "message_theme": "<max 100 znakov>", "estimated_cost_eur": <number>, "expected_response_rate_pct": <number 0-100> }
  ],
  "mlModels": [
    { "model": "<random_forest|xgboost|neural_net|survival_analysis|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<reactivation_probability|churn_prediction|response_forecast|value_prediction>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "reactivation_score": <number 0-100>, "reactivation_grade": "<A|B|C|D|F>", "total_reactivatable_value_eur": <number>,
    "expected_reactivation_count": <number>, "expected_revenue_recovery_eur": <number>,
    "biggest_reactivation_risk": "<max 100 znakov>", "biggest_reactivation_opportunity": "<max 100 znakov>",
    "quickest_reactivation_win": "<max 100 znakov>", "reactivation_analysis_score": <number 0-100>
  }
}`;
}

function transformEngine(parsed: any, inactiveBuyers: BuyerInfo[]): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    overview: {
      totalInactiveBuyers: Math.max(0, Number(parsed?.overview?.total_inactive_buyers ?? inactiveBuyers.length)),
      totalInactiveValueEur: Math.round(Number(parsed?.overview?.total_inactive_value_eur ?? inactiveBuyers.reduce((s, b) => s + b.totalSpent, 0))),
      avgInactiveDays: Math.max(0, Number(parsed?.overview?.avg_inactive_days ?? Math.round(inactiveBuyers.reduce((s, b) => s + b.daysSinceLast, 0) / Math.max(1, inactiveBuyers.length)))),
      avgReactivationProbabilityPct: clamp(Number(parsed?.overview?.avg_reactivation_probability_pct ?? 30), 0, 100),
      highlyReactivatableCount: Math.max(0, Number(parsed?.overview?.highly_reactivatable_count ?? 0)),
      reactivationGrade: includes(GRADES, String(parsed?.overview?.reactivation_grade)) ? String(parsed.overview.reactivation_grade) : 'C',
    },
    inactiveBuyers: (parsed?.inactiveBuyers || []).slice(0, 25).map((b: any) => ({
      name: String(b?.name ?? '').slice(0, 100),
      daysInactive: Math.max(0, Number(b?.days_inactive ?? 0)),
      lifetimeValueEur: Math.round(Number(b?.lifetime_value_eur ?? 0)),
      lastPurchaseValueEur: Math.round(Number(b?.last_purchase_value_eur ?? 0)),
      reactivationProbabilityPct: clamp(Number(b?.reactivation_probability_pct ?? 30), 0, 100),
      reactivationTier: includes(REACTIVATION_TIERS, String(b?.reactivation_tier)) ? String(b.reactivation_tier) : 'reactivatable',
      preferredStrategy: includes(STRATEGY_TYPES, String(b?.preferred_strategy)) ? String(b.preferred_strategy) : 'personalized_outreach',
    })),
    reactivationStrategies: (parsed?.reactivationStrategies || []).slice(0, 8).map((s: any) => ({
      strategyType: includes(STRATEGY_TYPES, String(s?.strategy_type)) ? String(s.strategy_type) : 'personalized_outreach',
      targetBuyerCount: Math.max(0, Number(s?.target_buyer_count ?? 0)),
      estimatedCostEur: Math.round(Number(s?.estimated_cost_eur ?? 0)),
      expectedReactivations: Math.max(0, Number(s?.expected_reactivations ?? 0)),
      expectedRevenueEur: Math.round(Number(s?.expected_revenue_eur ?? 0)),
      roiPct: round1(s?.roi_pct ?? 0),
      bestForTier: includes(REACTIVATION_TIERS, String(s?.best_for_tier)) ? String(s.best_for_tier) : 'reactivatable',
    })),
    campaignPlan: (parsed?.campaignPlan || []).slice(0, 5).map((c: any) => ({
      phase: includes(CAMPAIGN_PHASES, String(c?.phase)) ? String(c.phase) : 'awareness',
      channel: includes(CAMPAIGN_CHANNELS, String(c?.channel)) ? String(c.channel) : 'email',
      timingDays: Math.max(0, Number(c?.timing_days ?? 0)),
      messageTheme: String(c?.message_theme ?? '').slice(0, 200),
      estimatedCostEur: Math.round(Number(c?.estimated_cost_eur ?? 0)),
      expectedResponseRatePct: clamp(Number(c?.expected_response_rate_pct ?? 15), 0, 100),
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: includes(ML_MODELS, String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: clamp(Number(m?.accuracy_pct ?? 75), 0, 100),
      predictionType: includes(ML_PREDICTION_TYPES, String(m?.prediction_type)) ? String(m.prediction_type) : 'reactivation_probability',
      weightInEnsemble: clamp(Number(m?.weight_in_ensemble ?? 20), 0, 100),
    })),
    summary: {
      reactivationScore: clamp(Number(parsed?.summary?.reactivation_score ?? 50), 0, 100),
      reactivationGrade: includes(GRADES, String(parsed?.summary?.reactivation_grade)) ? String(parsed.summary.reactivation_grade) : 'C',
      totalReactivatableValueEur: Math.round(Number(parsed?.summary?.total_reactivatable_value_eur ?? 0)),
      expectedReactivationCount: Math.max(0, Number(parsed?.summary?.expected_reactivation_count ?? 0)),
      expectedRevenueRecoveryEur: Math.round(Number(parsed?.summary?.expected_revenue_recovery_eur ?? 0)),
      biggestReactivationRisk: String(parsed?.summary?.biggest_reactivation_risk ?? '').slice(0, 200),
      biggestReactivationOpportunity: String(parsed?.summary?.biggest_reactivation_opportunity ?? '').slice(0, 200),
      quickestReactivationWin: String(parsed?.summary?.quickest_reactivation_win ?? '').slice(0, 200),
      reactivationAnalysisScore: clamp(Number(parsed?.summary?.reactivation_analysis_score ?? 50), 0, 100),
    },
  };
}
