// v6.77 / v8.95.4-batch2: AI Buyer Retention Score Calculator — ML kalkulator retention score z 12-faktorsko analizo
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-retention-score-calculator
// Body: { customerName?: string }
// Returns: { ok, calculator: { buyers, scoringFactors, retentionLevels, interventions, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BuyerRetentionScoreCalculatorInput {
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
  purchaseDates: Date[];
}

const RETENTION_FACTORS = ['recency', 'frequency', 'monetary', 'engagement', 'satisfaction', 'loyalty_program_participation', 'referral_activity', 'communication_responsiveness', 'category_diversity', 'seasonal_consistency', 'price_sensitivity', 'platform_loyalty'] as const;
const RETENTION_LEVELS = ['platinum', 'gold', 'silver', 'bronze', 'at_risk', 'churned'] as const;
const INTERVENTIONS = ['maintain', 'nurture', 'reward', 'win_back', 'reactivate'] as const;
const ML_MODELS = ['random_forest', 'gradient_boosting', 'neural_network', 'lstm', 'ensemble'] as const;
const ML_PREDICTION_TYPES = ['retention_score', 'retention_probability', 'churn_prediction', 'optimal_intervention'] as const;
const TRENDS = ['improving', 'stable', 'declining'] as const;
const IMPROVEMENT_POTENTIAL = ['high', 'medium', 'low'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;

export const POST = withAiRoute<BuyerRetentionScoreCalculatorInput>({
  endpoint: '/api/ai/buyer-retention-score-calculator',
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
      return apiOk({ ok: true, calculator: null, message: 'Ni prodaj za retention score kalkulacijo.' });
    }

    const buyers = buildBuyerMap(soldTrades);
    if (customerName) {
      const f = buyers.filter(b => b.name === customerName);
      if (f.length === 0) {
        return apiOk({ ok: true, calculator: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const prompt = buildPrompt(targetBuyers);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const calculator = transformCalculator(parsed, targetBuyers);
    return apiOk({ ok: true, calculator });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildBuyerMap(soldTrades: SoldTradeRow[]): BuyerInfo[] {
  const buyerMap = new Map<string, BuyerInfo>();
  const now = Date.now();
  for (const t of soldTrades) {
    const name = (t.sellLocation || '').trim();
    if (!name || name.length < 2 || !t.sellDate) continue;
    const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    if (!buyerMap.has(name)) {
      buyerMap.set(name, {
        name, purchases: 0, totalSpent: 0, avgOrder: 0, daysSinceLast: 0,
        lastPurchase: t.sellDate, firstPurchase: t.sellDate,
        categories: new Set(), purchaseDates: [],
      });
    }
    const b = buyerMap.get(name)!;
    b.purchases += 1;
    b.totalSpent += rev;
    if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate;
    if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
    if (t.category) b.categories.add(t.category);
    b.purchaseDates.push(t.sellDate);
  }
  return Array.from(buyerMap.values()).map(b => {
    b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0;
    b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / (24 * 60 * 60 * 1000)) : 999;
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

function buildPrompt(targetBuyers: BuyerInfo[]): string {
  const buyersStr = targetBuyers.slice(0, 10).map(b =>
    `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d | ${b.categories.size} kat`
  ).join('\n');

  return `Si AI buyer retention score calculator z ML in 12-faktorsko analizo.
Računa retention score za ${targetBuyers.length} kupcev.

KUPCI:
${buyersStr}

12 retention faktorjev:
1. RECENCY: koliko dni od zadnjega nakupa
2. FREQUENCY: pogostost nakupov
3. MONETARY: skupni znesek
4. ENGAGEMENT: aktivnost in interakcija
5. SATISFACTION: zadovoljstvo (težko izmeriti direktno)
6. LOYALTY_PROGRAM_PARTICIPATION: udeležba v loyalty programu
7. REFERRAL_ACTIVITY: ali priporoča
8. COMMUNICATION_RESPONSIVENESS: odzivnost na komunikacijo
9. CATEGORY_DIVERSITY: raznolikost kategorij
10. SEASONAL_CONSISTENCY: konsistentnost sezonskih nakupov
11. PRICE_SENSITIVITY: občutljivost na ceno
12. PLATFORM_LOYALTY: zvestoba platformi

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    { "name": "<ime>", "retention_score": <number 0-100>, "retention_level": "<platinum|gold|silver|bronze|at_risk|churned>", "retention_probability_6m_pct": <number 0-100>, "retention_probability_12m_pct": <number 0-100>, "scoring_factors": [{"factor": "<12 faktorjev>", "score": <number 0-100>, "weight": <number 0-100>, "trend": "<improving|stable|declining>"}], "retention_drivers": ["<max 80 znakov>"], "retention_risks": ["<max 80 znakov>"], "predicted_next_purchase_date": "<YYYY-MM-DD>", "recommended_intervention": "<maintain|nurture|reward|win_back|reactivate>", "intervention_priority": "<high|medium|low>", "expected_retention_uplift_pct": <number> }
  ],
  "scoringFactors": [
    { "factor": "<12 faktorjev>", "weight": <number 0-100>, "avg_score": <number 0-100>, "benchmark": <number 0-100>, "improvement_potential": "<high|medium|low>", "scoring_method": "<max 100 znakov>" }
  ],
  "retentionLevels": [
    { "level": "<6 nivojev>", "buyer_count": <number>, "percentage": <number 0-100>, "avg_score": <number 0-100>, "avg_revenue_eur": <number>, "avg_retention_probability_pct": <number 0-100>, "strategy": "<max 120 znakov>" }
  ],
  "interventions": [
    { "intervention": "<maintain|nurture|reward|win_back|reactivate>", "target_level": "<6 nivojev>", "description": "<max 120 znakov>", "expected_retention_lift_pct": <number>, "implementation_cost_eur": <number>, "expected_revenue_impact_eur": <number>, "timeframe_days": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<random_forest|gradient_boosting|neural_network|lstm|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<retention_score|retention_probability|churn_prediction|optimal_intervention>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_buyers_scored": <number>, "avg_retention_score": <number 0-100>, "platinum_count": <number>,
    "gold_count": <number>, "silver_count": <number>, "bronze_count": <number>,
    "at_risk_count": <number>, "churned_count": <number>,
    "biggest_retention_driver": "<max 100 znakov>", "biggest_retention_risk": "<max 100 znakov>",
    "quickest_retention_win": "<max 100 znakov>", "retention_scoring_score": <number 0-100>
  }
}`;
}

function transformCalculator(parsed: any, targetBuyers: BuyerInfo[]): any {
  const validNames = new Set(targetBuyers.map(b => b.name));
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    buyers: (parsed?.buyers || []).filter((b: any) => validNames.has(String(b?.name ?? ''))).slice(0, 25).map((b: any) => ({
      name: String(b?.name ?? '').slice(0, 100),
      retentionScore: clamp(Number(b?.retention_score ?? 50), 0, 100),
      retentionLevel: includes(RETENTION_LEVELS, String(b?.retention_level)) ? String(b.retention_level) : 'bronze',
      retentionProbability6mPct: clamp(Number(b?.retention_probability_6m_pct ?? 60), 0, 100),
      retentionProbability12mPct: clamp(Number(b?.retention_probability_12m_pct ?? 40), 0, 100),
      scoringFactors: (b?.scoring_factors || []).slice(0, 12).map((f: any) => ({
        factor: includes(RETENTION_FACTORS, String(f?.factor)) ? String(f.factor) : 'recency',
        score: clamp(Number(f?.score ?? 50), 0, 100),
        weight: clamp(Number(f?.weight ?? 8), 0, 100),
        trend: includes(TRENDS, String(f?.trend)) ? String(f.trend) : 'stable',
      })),
      retentionDrivers: (b?.retention_drivers || []).slice(0, 4).map((d: any) => String(d).slice(0, 150)),
      retentionRisks: (b?.retention_risks || []).slice(0, 4).map((r: any) => String(r).slice(0, 150)),
      predictedNextPurchaseDate: String(b?.predicted_next_purchase_date ?? '').slice(0, 20),
      recommendedIntervention: includes(INTERVENTIONS, String(b?.recommended_intervention)) ? String(b.recommended_intervention) : 'maintain',
      interventionPriority: includes(PRIORITIES, String(b?.intervention_priority)) ? String(b.intervention_priority) : 'medium',
      expectedRetentionUpliftPct: round1(b?.expected_retention_uplift_pct ?? 0),
    })),
    scoringFactors: (parsed?.scoringFactors || []).slice(0, 12).map((f: any) => ({
      factor: includes(RETENTION_FACTORS, String(f?.factor)) ? String(f.factor) : 'recency',
      weight: clamp(Number(f?.weight ?? 8), 0, 100),
      avgScore: clamp(Number(f?.avg_score ?? 50), 0, 100),
      benchmark: clamp(Number(f?.benchmark ?? 60), 0, 100),
      improvementPotential: includes(IMPROVEMENT_POTENTIAL, String(f?.improvement_potential)) ? String(f.improvement_potential) : 'medium',
      scoringMethod: String(f?.scoring_method ?? '').slice(0, 200),
    })),
    retentionLevels: (parsed?.retentionLevels || []).slice(0, 6).map((l: any) => ({
      level: includes(RETENTION_LEVELS, String(l?.level)) ? String(l.level) : 'bronze',
      buyerCount: Math.max(0, Number(l?.buyer_count ?? 0)),
      percentage: clamp(Number(l?.percentage ?? 17), 0, 100),
      avgScore: clamp(Number(l?.avg_score ?? 50), 0, 100),
      avgRevenueEur: Math.round(Number(l?.avg_revenue_eur ?? 0)),
      avgRetentionProbabilityPct: clamp(Number(l?.avg_retention_probability_pct ?? 50), 0, 100),
      strategy: String(l?.strategy ?? '').slice(0, 250),
    })),
    interventions: (parsed?.interventions || []).slice(0, 6).map((i: any) => ({
      intervention: includes(INTERVENTIONS, String(i?.intervention)) ? String(i.intervention) : 'maintain',
      targetLevel: includes(RETENTION_LEVELS, String(i?.target_level)) ? String(i.target_level) : 'bronze',
      description: String(i?.description ?? '').slice(0, 250),
      expectedRetentionLiftPct: round1(i?.expected_retention_lift_pct ?? 0),
      implementationCostEur: Math.round(Number(i?.implementation_cost_eur ?? 0)),
      expectedRevenueImpactEur: Math.round(Number(i?.expected_revenue_impact_eur ?? 0)),
      timeframeDays: Math.max(1, Number(i?.timeframe_days ?? 7)),
      priority: includes(PRIORITIES, String(i?.priority)) ? String(i.priority) : 'medium',
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: includes(ML_MODELS, String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: clamp(Number(m?.accuracy_pct ?? 75), 0, 100),
      predictionType: includes(ML_PREDICTION_TYPES, String(m?.prediction_type)) ? String(m.prediction_type) : 'retention_score',
      weightInEnsemble: clamp(Number(m?.weight_in_ensemble ?? 20), 0, 100),
    })),
    summary: {
      totalBuyersScored: targetBuyers.length,
      avgRetentionScore: clamp(Number(parsed?.summary?.avg_retention_score ?? 50), 0, 100),
      platinumCount: Math.max(0, Number(parsed?.summary?.platinum_count ?? 0)),
      goldCount: Math.max(0, Number(parsed?.summary?.gold_count ?? 0)),
      silverCount: Math.max(0, Number(parsed?.summary?.silver_count ?? 0)),
      bronzeCount: Math.max(0, Number(parsed?.summary?.bronze_count ?? 0)),
      atRiskCount: Math.max(0, Number(parsed?.summary?.at_risk_count ?? 0)),
      churnedCount: Math.max(0, Number(parsed?.summary?.churned_count ?? 0)),
      biggestRetentionDriver: String(parsed?.summary?.biggest_retention_driver ?? '').slice(0, 200),
      biggestRetentionRisk: String(parsed?.summary?.biggest_retention_risk ?? '').slice(0, 200),
      quickestRetentionWin: String(parsed?.summary?.quickest_retention_win ?? '').slice(0, 200),
      retentionScoringScore: clamp(Number(parsed?.summary?.retention_scoring_score ?? 60), 0, 100),
    },
  };
}
