// v6.74 / v8.95.3-batch2: AI Buyer Lifetime Value Optimizer — optimizira LTV z ML in retention strategies
// Refaktoriran z withAiRoute helperjem (v8.95.3-batch2) + enforceBudget guard.
//
// POST /api/ai/buyer-lifetime-value-optimizer
// Body: { customerName?: string, monthsAhead?: number }
// Returns: { ok, optimizer: { buyers, ltvProjections, retentionStrategies, interventions, mlModels, summary } | null, message? }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BuyerLifetimeValueOptimizerInput {
  customerName: string | null;
  monthsAhead: number;
}

interface BuyerRow {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrder: number;
  daysSinceLast: number;
  lastPurchase: Date | null;
  firstPurchase: Date | null;
  categories: Set<string>;
}

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  sellLocation: string | null;
  buyDate: Date | null;
}

export const POST = withAiRoute<BuyerLifetimeValueOptimizerInput>({
  endpoint: '/api/ai/buyer-lifetime-value-optimizer',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      customerName: body?.customerName ? String(body.customerName).trim() : null,
      monthsAhead: Math.max(1, Math.min(36, Number(body?.monthsAhead ?? 24))),
    };
  },

  // No validateInput — vsi input-i imajo defaults (customerName=null, monthsAhead=24 clamped)

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { customerName, monthsAhead } = input;

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, optimizer: null, message: 'Ni prodaj za LTV optimizacijo.' });
    }

    const buyers = buildBuyers(soldTrades);

    if (customerName) {
      const filtered = buyers.filter(b => b.name === customerName);
      if (filtered.length === 0) {
        return apiOk({ ok: true, optimizer: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);

    const prompt = buildPrompt(targetBuyers, monthsAhead);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const optimizer = transformOptimizer(parsed, targetBuyers);

    return apiOk({ ok: true, optimizer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildBuyers(soldTrades: SoldTradeRow[]): BuyerRow[] {
  const buyerMap = new Map<string, BuyerRow>();
  const now = Date.now();
  for (const t of soldTrades) {
    const name = (t.sellLocation || '').trim();
    if (!name || name.length < 2 || !t.sellDate) continue;
    const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, daysSinceLast: 0, lastPurchase: t.sellDate, firstPurchase: t.sellDate, categories: new Set() });
    const b = buyerMap.get(name)!;
    b.purchases += 1; b.totalSpent += rev;
    if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate;
    if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
    if (t.category) b.categories.add(t.category);
  }
  return Array.from(buyerMap.values()).map(b => { b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0; b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / (24*60*60*1000)) : 999; return b; });
}

function buildPrompt(targetBuyers: BuyerRow[], monthsAhead: number): string {
  const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d zadnji`).join('\n');

  return `Si AI buyer lifetime value optimizer z ML in retention strategies.
Optimizira LTV za ${targetBuyers.length} kupcev v ${monthsAhead} mesecih.

KUPCI:
${buyersStr}

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    { "name": "<ime>", "current_ltv_eur": <number>, "optimized_ltv_eur": <number>, "ltv_increase_eur": <number>, "ltv_increase_pct": <number>, "retention_probability_pct": <number 0-100>, "churn_probability_pct": <number 0-100>, "predicted_remaining_purchases": <number>, "predicted_remaining_value_eur": <number>, "ltv_drivers": ["<max 80 znakov>"], "ltv_barriers": ["<max 80 znakov>"], "recommended_strategy": "<maintain|nurture|grow|maximize|salvage>", "strategy_reasoning": "<max 150 znakov>", "expected_ltv_uplift_eur": <number>, "priority": "<high|medium|low>" }
  ],
  "ltvProjections": [
    { "timeframe": "<6m|12m|24m|36m>", "total_projected_ltv_eur": <number>, "avg_ltv_per_buyer_eur": <number>, "retained_buyers": <number>, "churned_buyers": <number>, "total_revenue_projection_eur": <number>, "confidence_pct": <number 0-100> }
  ],
  "retentionStrategies": [
    { "strategy": "<loyalty_program|personal_outreach|exclusive_offers|early_access|bundle_incentives|birthday_rewards|referral_bonuses|feedback_loops|price_locks|priority_support>", "description": "<max 120 znakov>", "target_segment": "<champion|loyal|casual|at_risk|churning>", "expected_retention_improvement_pct": <number>, "expected_ltv_uplift_eur": <number>, "implementation_cost_eur": <number>, "roi_score": <number 0-100>, "timeframe_months": <number> }
  ],
  "interventions": [
    { "buyer_name": "<ime>", "intervention": "<maintain|nurture|grow|maximize|salvage>", "description": "<max 120 znakov>", "expected_ltv_impact_eur": <number>, "implementation_cost_eur": <number>, "timeframe_days": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<random_forest|gradient_boosting|lstm|neural_network|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<ltv_forecast|churn_probability|retention_probability|optimal_intervention>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_buyers_analyzed": <number>, "total_current_ltv_eur": <number>, "total_optimized_ltv_eur": <number>,
    "total_ltv_uplift_eur": <number>, "avg_ltv_uplift_pct": <number>,
    "best_retention_strategy": "<max 80 znakov>", "biggest_ltv_opportunity": "<max 100 znakov>",
    "quickest_ltv_win": "<max 100 znakov>", "ltv_optimization_score": <number 0-100>
  }
}`;
}

function transformOptimizer(parsed: any, targetBuyers: BuyerRow[]): any {
  const validNames = new Set(targetBuyers.map(b => b.name));
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    buyers: (parsed?.buyers || []).filter((b: any) => validNames.has(String(b?.name ?? ''))).slice(0, 25).map((b: any) => ({ name: String(b?.name ?? '').slice(0, 100), currentLtvEur: Math.round(Number(b?.current_ltv_eur ?? 0)), optimizedLtvEur: Math.round(Number(b?.optimized_ltv_eur ?? 0)), ltvIncreaseEur: Math.round(Number(b?.ltv_increase_eur ?? 0)), ltvIncreasePct: Math.round(Number(b?.ltv_increase_pct ?? 0) * 10) / 10, retentionProbabilityPct: Math.max(0, Math.min(100, Number(b?.retention_probability_pct ?? 60))), churnProbabilityPct: Math.max(0, Math.min(100, Number(b?.churn_probability_pct ?? 30))), predictedRemainingPurchases: Math.max(0, Number(b?.predicted_remaining_purchases ?? 0)), predictedRemainingValueEur: Math.round(Number(b?.predicted_remaining_value_eur ?? 0)), ltvDrivers: (b?.ltv_drivers || []).slice(0, 4).map((d: any) => String(d).slice(0, 150)), ltvBarriers: (b?.ltv_barriers || []).slice(0, 4).map((d: any) => String(d).slice(0, 150)), recommendedStrategy: ['maintain', 'nurture', 'grow', 'maximize', 'salvage'].includes(String(b?.recommended_strategy)) ? String(b.recommended_strategy) : 'maintain', strategyReasoning: String(b?.strategy_reasoning ?? '').slice(0, 300), expectedLtvUpliftEur: Math.round(Number(b?.expected_ltv_uplift_eur ?? 0)), priority: ['high', 'medium', 'low'].includes(String(b?.priority)) ? String(b.priority) : 'medium' })),
    ltvProjections: (parsed?.ltvProjections || []).slice(0, 4).map((p: any) => ({ timeframe: ['6m', '12m', '24m', '36m'].includes(String(p?.timeframe)) ? String(p.timeframe) : '12m', totalProjectedLtvEur: Math.round(Number(p?.total_projected_ltv_eur ?? 0)), avgLtvPerBuyerEur: Math.round(Number(p?.avg_ltv_per_buyer_eur ?? 0)), retainedBuyers: Math.max(0, Number(p?.retained_buyers ?? 0)), churnedBuyers: Math.max(0, Number(p?.churned_buyers ?? 0)), totalRevenueProjectionEur: Math.round(Number(p?.total_revenue_projection_eur ?? 0)), confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 50))) })),
    retentionStrategies: (parsed?.retentionStrategies || []).slice(0, 10).map((s: any) => ({ strategy: ['loyalty_program', 'personal_outreach', 'exclusive_offers', 'early_access', 'bundle_incentives', 'birthday_rewards', 'referral_bonuses', 'feedback_loops', 'price_locks', 'priority_support'].includes(String(s?.strategy)) ? String(s.strategy) : 'loyalty_program', description: String(s?.description ?? '').slice(0, 250), targetSegment: ['champion', 'loyal', 'casual', 'at_risk', 'churning'].includes(String(s?.target_segment)) ? String(s.target_segment) : 'loyal', expectedRetentionImprovementPct: Math.round(Number(s?.expected_retention_improvement_pct ?? 0) * 10) / 10, expectedLtvUpliftEur: Math.round(Number(s?.expected_ltv_uplift_eur ?? 0)), implementationCostEur: Math.round(Number(s?.implementation_cost_eur ?? 0)), roiScore: Math.max(0, Math.min(100, Number(s?.roi_score ?? 50))), timeframeMonths: Math.max(1, Number(s?.timeframe_months ?? 3)) })),
    interventions: (parsed?.interventions || []).filter((i: any) => validNames.has(String(i?.buyer_name ?? ''))).slice(0, 20).map((i: any) => ({ buyerName: String(i?.buyer_name ?? '').slice(0, 100), intervention: ['maintain', 'nurture', 'grow', 'maximize', 'salvage'].includes(String(i?.intervention)) ? String(i.intervention) : 'maintain', description: String(i?.description ?? '').slice(0, 250), expectedLtvImpactEur: Math.round(Number(i?.expected_ltv_impact_eur ?? 0)), implementationCostEur: Math.round(Number(i?.implementation_cost_eur ?? 0)), timeframeDays: Math.max(1, Number(i?.timeframe_days ?? 7)), priority: ['high', 'medium', 'low'].includes(String(i?.priority)) ? String(i.priority) : 'medium' })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['random_forest', 'gradient_boosting', 'lstm', 'neural_network', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['ltv_forecast', 'churn_probability', 'retention_probability', 'optimal_intervention'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'ltv_forecast', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
    summary: { totalBuyersAnalyzed: targetBuyers.length, totalCurrentLtvEur: Math.round(Number(parsed?.summary?.total_current_ltv_eur ?? 0)), totalOptimizedLtvEur: Math.round(Number(parsed?.summary?.total_optimized_ltv_eur ?? 0)), totalLtvUpliftEur: Math.round(Number(parsed?.summary?.total_ltv_uplift_eur ?? 0)), avgLtvUpliftPct: Math.round(Number(parsed?.summary?.avg_ltv_uplift_pct ?? 0) * 10) / 10, bestRetentionStrategy: ['loyalty_program', 'personal_outreach', 'exclusive_offers', 'early_access', 'bundle_incentives', 'birthday_rewards', 'referral_bonuses', 'feedback_loops', 'price_locks', 'priority_support'].includes(String(parsed?.summary?.best_retention_strategy)) ? String(parsed.summary.best_retention_strategy) : 'loyalty_program', biggestLtvOpportunity: String(parsed?.summary?.biggest_ltv_opportunity ?? '').slice(0, 200), quickestLtvWin: String(parsed?.summary?.quickest_ltv_win ?? '').slice(0, 200), ltvOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.ltv_optimization_score ?? 60))) },
  };
}
