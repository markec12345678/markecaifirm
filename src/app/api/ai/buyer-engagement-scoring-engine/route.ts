// v6.73 / v8.95.4-batch1: AI Buyer Engagement Scoring Engine — ML scoring engine za engagement z real-time tracking
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-engagement-scoring-engine
// Body: { customerName?: string }
// Returns: { ok, engine: { buyers, scoringFactors, engagementLevels, interventions, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BuyerEngagementScoringEngineInput {
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

interface BuyerInfo {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrder: number;
  daysSinceLast: number;
  lastPurchase: Date | null;
  firstPurchase: Date | null;
  categories: Set<string>;
}

const SCORING_FACTORS = ['recency', 'frequency', 'monetary', 'engagement_depth', 'response_rate', 'social_engagement', 'referral_activity', 'content_interaction', 'purchase_consistency', 'platform_activity'] as const;
const ENGAGEMENT_LEVELS = ['super_engaged', 'highly_engaged', 'moderately_engaged', 'low_engaged', 'disengaged', 'churned'] as const;
const ENGAGEMENT_ML_MODELS = ['random_forest', 'gradient_boosting', 'neural_network', 'lstm', 'ensemble'] as const;
const ENGAGEMENT_PREDICTION_TYPES = ['engagement_score', 'engagement_trend', 'churn_probability', 'intervention_response'] as const;
const INTERVENTION_TYPES = ['maintain', 'nurture', 'activate', 'reactivate', 'escalate'] as const;
const TRENDS = ['improving', 'stable', 'declining'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;
const IMPROVEMENT_POTENTIALS = ['high', 'medium', 'low'] as const;

export const POST = withAiRoute<BuyerEngagementScoringEngineInput>({
  endpoint: '/api/ai/buyer-engagement-scoring-engine',
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
      return apiOk({ ok: true, engine: null, message: 'Ni prodaj za engagement scoring.' });
    }

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const buyerMap = buildBuyerMap(soldTrades, now, DAY);
    const buyers = Array.from(buyerMap.values());

    if (customerName) {
      const f = buyers.filter(b => b.name === customerName);
      if (f.length === 0) {
        return apiOk({ ok: true, engine: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const prompt = buildPrompt(targetBuyers);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const engine = transformEngine(parsed, targetBuyers);

    return apiOk({ ok: true, engine });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildBuyerMap(soldTrades: SoldTradeRow[], now: number, DAY: number): Map<string, BuyerInfo> {
  const buyerMap = new Map<string, BuyerInfo>();
  for (const t of soldTrades) {
    const name = (t.sellLocation || '').trim();
    if (!name || name.length < 2 || !t.sellDate) continue;
    const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    if (!buyerMap.has(name)) {
      buyerMap.set(name, {
        name, purchases: 0, totalSpent: 0, avgOrder: 0, daysSinceLast: 0,
        lastPurchase: t.sellDate, firstPurchase: t.sellDate, categories: new Set(),
      });
    }
    const b = buyerMap.get(name)!;
    b.purchases += 1;
    b.totalSpent += rev;
    if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate;
    if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
    if (t.category) b.categories.add(t.category);
  }
  for (const b of buyerMap.values()) {
    b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0;
    b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / DAY) : 999;
  }
  return buyerMap;
}

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function round1(n: number): number {
  return Math.round(Number(n) * 10) / 10;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function buildPrompt(targetBuyers: BuyerInfo[]): string {
  const buyersStr = targetBuyers.slice(0, 10).map(b =>
    `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d zadnji`
  ).join('\n');

  return `Si AI buyer engagement scoring engine z ML in real-time tracking.
Računa engagement score za ${targetBuyers.length} kupcev z 10-faktorsko analizo.

KUPCI:
${buyersStr}

10 scoring faktorjev:
1. RECENCY: koliko dni od zadnjega nakupa
2. FREQUENCY: pogostost nakupov
3. MONETARY: skupni znesek
4. ENGAGEMENT_DEPTH: globina engagement (povpraševanja, pregledi)
5. RESPONSE_RATE: odzivnost na outreach
6. SOCIAL_ENGAGEMENT: socialna aktivnost
7. REFERRAL_ACTIVITY: ali priporoča
8. CONTENT_INTERACTION: interakcija z vsebino
9. PURCHASE_CONSISTENCY: konsistentnost nakupov
10. PLATFORM_ACTIVITY: aktivnost na platformi

6 engagement nivojev:
1. SUPER_ENGAGED: najvišji engagement, pogosti kupci
2. HIGHLY_ENGAGED: visok engagement, redni
3. MODERATELY_ENGAGED: srednji, občasni
4. LOW_ENGAGED: nizki, redki
5. DISENGAGED: neaktivni >60d
6. CHURNED: neaktivni >180d

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    { "name": "<ime>", "engagement_score": <number 0-100>, "engagement_level": "<6 nivojev>", "scoring_factors": [{"factor": "<10 faktorjev>", "score": <number 0-100>, "weight": <number 0-100>, "trend": "<improving|stable|declining>"}], "engagement_trend": "<improving|stable|declining>", "engagement_velocity": <number -100 do 100>, "predicted_engagement_30d": <number 0-100>, "predicted_engagement_90d": <number 0-100>, "key_engagement_drivers": ["<max 80 znakov>"], "key_engagement_barriers": ["<max 80 znakov>"], "recommended_intervention": "<maintain|nurture|activate|reactivate|escalate>", "intervention_priority": "<high|medium|low>", "expected_engagement_uplift_pct": <number> }
  ],
  "scoringFactors": [
    { "factor": "<10 faktorjev>", "weight": <number 0-100>, "avg_score": <number 0-100>, "benchmark": <number 0-100>, "improvement_potential": "<high|medium|low>", "scoring_method": "<max 100 znakov>", "best_practice": "<max 120 znakov>" }
  ],
  "engagementLevels": [
    { "level": "<6 nivojev>", "buyer_count": <number>, "percentage": <number 0-100>, "avg_score": <number 0-100>, "avg_revenue_eur": <number>, "characteristics": "<max 100 znakov>", "strategy": "<max 120 znakov>" }
  ],
  "interventions": [
    { "intervention": "<maintain|nurture|activate|reactivate|escalate>", "target_level": "<6 nivojev>", "description": "<max 120 znakov>", "expected_engagement_lift_pct": <number>, "implementation_cost_eur": <number>, "expected_revenue_impact_eur": <number>, "timeframe_days": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<random_forest|gradient_boosting|neural_network|lstm|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<engagement_score|engagement_trend|churn_probability|intervention_response>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_buyers_scored": <number>, "avg_engagement_score": <number 0-100>, "super_engaged_count": <number>,
    "highly_engaged_count": <number>, "moderately_engaged_count": <number>, "low_engaged_count": <number>,
    "disengaged_count": <number>, "churned_count": <number>,
    "biggest_engagement_driver": "<max 100 znakov>", "biggest_engagement_barrier": "<max 100 znakov>",
    "quickest_engagement_win": "<max 100 znakov>", "engagement_scoring_score": <number 0-100>
  }
}`;
}

function transformEngine(parsed: any, targetBuyers: BuyerInfo[]): any {
  const validNames = new Set(targetBuyers.map(b => b.name));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    buyers: (parsed?.buyers || []).filter((b: any) => validNames.has(String(b?.name ?? ''))).slice(0, 25).map((b: any) => ({
      name: String(b?.name ?? '').slice(0, 100),
      engagementScore: clamp(Number(b?.engagement_score ?? 50), 0, 100),
      engagementLevel: includes(ENGAGEMENT_LEVELS, String(b?.engagement_level)) ? String(b.engagement_level) : 'moderately_engaged',
      scoringFactors: (b?.scoring_factors || []).slice(0, 10).map((f: any) => ({
        factor: includes(SCORING_FACTORS, String(f?.factor)) ? String(f.factor) : 'recency',
        score: clamp(Number(f?.score ?? 50), 0, 100),
        weight: clamp(Number(f?.weight ?? 10), 0, 100),
        trend: includes(TRENDS, String(f?.trend)) ? String(f.trend) : 'stable',
      })),
      engagementTrend: includes(TRENDS, String(b?.engagement_trend)) ? String(b.engagement_trend) : 'stable',
      engagementVelocity: Math.max(-100, Math.min(100, Number(b?.engagement_velocity ?? 0))),
      predictedEngagement30d: clamp(Number(b?.predicted_engagement_30d ?? 50), 0, 100),
      predictedEngagement90d: clamp(Number(b?.predicted_engagement_90d ?? 50), 0, 100),
      keyEngagementDrivers: (b?.key_engagement_drivers || []).slice(0, 4).map((d: any) => String(d).slice(0, 150)),
      keyEngagementBarriers: (b?.key_engagement_barriers || []).slice(0, 4).map((d: any) => String(d).slice(0, 150)),
      recommendedIntervention: includes(INTERVENTION_TYPES, String(b?.recommended_intervention)) ? String(b.recommended_intervention) : 'maintain',
      interventionPriority: includes(PRIORITIES, String(b?.intervention_priority)) ? String(b.intervention_priority) : 'medium',
      expectedEngagementUpliftPct: round1(b?.expected_engagement_uplift_pct ?? 0),
    })),
    scoringFactors: (parsed?.scoringFactors || []).slice(0, 10).map((f: any) => ({
      factor: includes(SCORING_FACTORS, String(f?.factor)) ? String(f.factor) : 'recency',
      weight: clamp(Number(f?.weight ?? 10), 0, 100),
      avgScore: clamp(Number(f?.avg_score ?? 50), 0, 100),
      benchmark: clamp(Number(f?.benchmark ?? 60), 0, 100),
      improvementPotential: includes(IMPROVEMENT_POTENTIALS, String(f?.improvement_potential)) ? String(f.improvement_potential) : 'medium',
      scoringMethod: String(f?.scoring_method ?? '').slice(0, 200),
      bestPractice: String(f?.best_practice ?? '').slice(0, 250),
    })),
    engagementLevels: (parsed?.engagementLevels || []).slice(0, 6).map((l: any) => ({
      level: includes(ENGAGEMENT_LEVELS, String(l?.level)) ? String(l.level) : 'moderately_engaged',
      buyerCount: Math.max(0, Number(l?.buyer_count ?? 0)),
      percentage: clamp(Number(l?.percentage ?? 17), 0, 100),
      avgScore: clamp(Number(l?.avg_score ?? 50), 0, 100),
      avgRevenueEur: Math.round(Number(l?.avg_revenue_eur ?? 0)),
      characteristics: String(l?.characteristics ?? '').slice(0, 200),
      strategy: String(l?.strategy ?? '').slice(0, 250),
    })),
    interventions: (parsed?.interventions || []).slice(0, 6).map((i: any) => ({
      intervention: includes(INTERVENTION_TYPES, String(i?.intervention)) ? String(i.intervention) : 'maintain',
      targetLevel: includes(ENGAGEMENT_LEVELS, String(i?.target_level)) ? String(i.target_level) : 'moderately_engaged',
      description: String(i?.description ?? '').slice(0, 250),
      expectedEngagementLiftPct: round1(i?.expected_engagement_lift_pct ?? 0),
      implementationCostEur: Math.round(Number(i?.implementation_cost_eur ?? 0)),
      expectedRevenueImpactEur: Math.round(Number(i?.expected_revenue_impact_eur ?? 0)),
      timeframeDays: Math.max(1, Number(i?.timeframe_days ?? 7)),
      priority: includes(PRIORITIES, String(i?.priority)) ? String(i.priority) : 'medium',
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: includes(ENGAGEMENT_ML_MODELS, String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: clamp(Number(m?.accuracy_pct ?? 75), 0, 100),
      predictionType: includes(ENGAGEMENT_PREDICTION_TYPES, String(m?.prediction_type)) ? String(m.prediction_type) : 'engagement_score',
      weightInEnsemble: clamp(Number(m?.weight_in_ensemble ?? 20), 0, 100),
    })),
    summary: {
      totalBuyersScored: targetBuyers.length,
      avgEngagementScore: clamp(Number(parsed?.summary?.avg_engagement_score ?? 50), 0, 100),
      superEngagedCount: Math.max(0, Number(parsed?.summary?.super_engaged_count ?? 0)),
      highlyEngagedCount: Math.max(0, Number(parsed?.summary?.highly_engaged_count ?? 0)),
      moderatelyEngagedCount: Math.max(0, Number(parsed?.summary?.moderately_engaged_count ?? 0)),
      lowEngagedCount: Math.max(0, Number(parsed?.summary?.low_engaged_count ?? 0)),
      disengagedCount: Math.max(0, Number(parsed?.summary?.disengaged_count ?? 0)),
      churnedCount: Math.max(0, Number(parsed?.summary?.churned_count ?? 0)),
      biggestEngagementDriver: String(parsed?.summary?.biggest_engagement_driver ?? '').slice(0, 200),
      biggestEngagementBarrier: String(parsed?.summary?.biggest_engagement_barrier ?? '').slice(0, 200),
      quickestEngagementWin: String(parsed?.summary?.quickest_engagement_win ?? '').slice(0, 200),
      engagementScoringScore: clamp(Number(parsed?.summary?.engagement_scoring_score ?? 60), 0, 100),
    },
  };
}
