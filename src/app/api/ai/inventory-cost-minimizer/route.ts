// v6.75 / v8.95.5: AI Inventory Cost Minimizer — minimizira skupne stroške z ML in cost decomposition
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-cost-minimizer
// Body: { tradeId?: string }
// Returns: { ok, minimizer: { current, costBreakdown, optimizations, mlModels, projections, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const COST_CATEGORIES = ['sourcing_cost', 'platform_fees', 'payment_fees', 'shipping_cost', 'storage_cost', 'holding_cost', 'renovation_cost', 'opportunity_cost', 'insurance_cost', 'return_cost'] as const;
const OPTIMIZATION_TYPES = ['fee_negotiation', 'platform_switch', 'bulk_shipping', 'faster_turnover', 'bundle_savings', 'supplier_renegotiation', 'storage_optimization', 'insurance_reduction', 'return_prevention', 'opportunity_cost_reduction'] as const;
const DIFFICULTIES = ['low', 'medium', 'high'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;
const COST_GRADES = ['A', 'B', 'C', 'D', 'F'] as const;
const COST_ML_MODELS = ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'] as const;
const COST_PREDICTION_TYPES = ['cost_forecast', 'optimal_cost', 'savings_potential', 'cost_attribution'] as const;

interface InventoryCostMinimizerInput {
  tradeId: string | null;
}

export const POST = withAiRoute<InventoryCostMinimizerInput>({
  endpoint: '/api/ai/inventory-cost-minimizer',
  maxDuration: 90,
  enforceBudget: true, // v8.94: budget guard + avtomatski recordAiCall

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : null,
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId } = input;

    const where: { status: 'held'; id?: string } = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades = await db.trade.findMany({
      where,
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, price: true } } },
      take: tradeId ? 1 : 50,
    });
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null, gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 300,
    });
    if (heldTrades.length === 0 && soldTrades.length === 0) return apiOk({ ok: true, minimizer: null, message: 'Ni podatkov za cost minimization.' });

    const stats = computeCostStats(soldTrades, heldTrades);

    const prompt = buildCostPrompt(stats);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const minimizer = transformMinimizer(parsed, stats);

    return apiOk({ ok: true, minimizer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface CostSoldRow {
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
}

interface CostHeldRow {
  buyPrice: number;
  buyFees: number | null;
}

interface CostStats {
  totalBuyCost: number;
  totalSellFees: number;
  totalRevenue: number;
  totalProfit: number;
  heldCapital: number;
}

function computeCostStats(soldTrades: CostSoldRow[], heldTrades: CostHeldRow[]): CostStats {
  const totalBuyCost = soldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
  const totalSellFees = soldTrades.reduce((s, t) => s + (t.sellFees ?? 0), 0);
  const totalRevenue = soldTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
  const totalProfit = totalRevenue - totalBuyCost;
  const heldCapital = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
  return { totalBuyCost, totalSellFees, totalRevenue, totalProfit, heldCapital };
}

function buildCostPrompt(stats: CostStats): string {
  return `Si AI inventory cost minimizer z ML in cost decomposition.
Minimizira skupne stroške inventarja z 10-kategorijsko analizo.

STATS:
- Total buy cost (90d): ${Math.round(stats.totalBuyCost)}€
- Total sell fees (90d): ${Math.round(stats.totalSellFees)}€
- Total revenue (90d): ${Math.round(stats.totalRevenue)}€
- Total profit (90d): ${Math.round(stats.totalProfit)}€
- Held capital: ${Math.round(stats.heldCapital)}€

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": { "total_cost_eur": <number>, "total_revenue_eur": <number>, "total_profit_eur": <number>, "cost_ratio_pct": <number>, "held_capital_eur": <number>, "cost_efficiency_pct": <number 0-100>, "cost_grade": "<A|B|C|D|F>" },
  "costBreakdown": [
    { "category": "<10 kategorij>", "current_cost_eur": <number>, "percentage_of_total": <number 0-100>, "optimized_cost_eur": <number>, "savings_eur": <number>, "savings_pct": <number>, "optimization_action": "<max 120 znakov>", "priority": "<high|medium|low>" }
  ],
  "optimizations": [
    { "optimization_type": "<fee_negotiation|platform_switch|bulk_shipping|faster_turnover|bundle_savings|supplier_renegotiation|storage_optimization|insurance_reduction|return_prevention|opportunity_cost_reduction>", "description": "<max 120 znakov>", "current_cost_eur": <number>, "optimized_cost_eur": <number>, "savings_eur": <number>, "implementation_difficulty": "<low|medium|high>", "timeframe_days": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<arima|lstm|prophet|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<cost_forecast|optimal_cost|savings_potential|cost_attribution>", "weight_in_ensemble": <number 0-100> }
  ],
  "projections": [
    { "month": <1-12>, "projected_total_cost_eur": <number>, "projected_total_savings_eur": <number>, "projected_net_cost_eur": <number>, "projected_profit_increase_eur": <number>, "confidence_pct": <number 0-100> }
  ],
  "summary": {
    "current_total_cost_eur": <number>, "optimized_total_cost_eur": <number>, "total_savings_eur": <number>,
    "total_savings_pct": <number>, "biggest_cost_category": "<max 80 znakov>",
    "biggest_savings_opportunity": "<max 100 znakov>", "quickest_cost_win": "<max 100 znakov>",
    "cost_minimization_score": <number 0-100>
  }
}`;
}

function transformMinimizer(parsed: any, stats: CostStats) {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    current: {
      totalCostEur: Math.round(Number(parsed?.current?.total_cost_eur ?? stats.totalBuyCost + stats.totalSellFees)),
      totalRevenueEur: Math.round(Number(parsed?.current?.total_revenue_eur ?? stats.totalRevenue)),
      totalProfitEur: Math.round(Number(parsed?.current?.total_profit_eur ?? stats.totalProfit)),
      costRatioPct: Math.round(Number(parsed?.current?.cost_ratio_pct ?? 0) * 10) / 10,
      heldCapitalEur: Math.round(Number(parsed?.current?.held_capital_eur ?? stats.heldCapital)),
      costEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.current?.cost_efficiency_pct ?? 60))),
      costGrade: (COST_GRADES as readonly string[]).includes(String(parsed?.current?.cost_grade)) ? String(parsed.current.cost_grade) : 'C',
    },
    costBreakdown: (parsed?.costBreakdown || []).slice(0, 10).map((c: any) => ({
      category: (COST_CATEGORIES as readonly string[]).includes(String(c?.category)) ? String(c.category) : 'sourcing_cost',
      currentCostEur: Math.round(Number(c?.current_cost_eur ?? 0)),
      percentageOfTotal: Math.max(0, Math.min(100, Number(c?.percentage_of_total ?? 0))),
      optimizedCostEur: Math.round(Number(c?.optimized_cost_eur ?? 0)),
      savingsEur: Math.round(Number(c?.savings_eur ?? 0)),
      savingsPct: Math.round(Number(c?.savings_pct ?? 0) * 10) / 10,
      optimizationAction: String(c?.optimization_action ?? '').slice(0, 250),
      priority: (PRIORITIES as readonly string[]).includes(String(c?.priority)) ? String(c.priority) : 'medium',
    })),
    optimizations: (parsed?.optimizations || []).slice(0, 10).map((o: any) => ({
      optimizationType: (OPTIMIZATION_TYPES as readonly string[]).includes(String(o?.optimization_type)) ? String(o.optimization_type) : 'fee_negotiation',
      description: String(o?.description ?? '').slice(0, 250),
      currentCostEur: Math.round(Number(o?.current_cost_eur ?? 0)),
      optimizedCostEur: Math.round(Number(o?.optimized_cost_eur ?? 0)),
      savingsEur: Math.round(Number(o?.savings_eur ?? 0)),
      implementationDifficulty: (DIFFICULTIES as readonly string[]).includes(String(o?.implementation_difficulty)) ? String(o.implementation_difficulty) : 'low',
      timeframeDays: Math.max(1, Number(o?.timeframe_days ?? 7)),
      priority: (PRIORITIES as readonly string[]).includes(String(o?.priority)) ? String(o.priority) : 'medium',
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: (COST_ML_MODELS as readonly string[]).includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))),
      predictionType: (COST_PREDICTION_TYPES as readonly string[]).includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'cost_forecast',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    projections: (parsed?.projections || []).slice(0, 12).map((p: any) => ({
      month: Math.max(1, Math.min(12, Number(p?.month ?? 1))),
      projectedTotalCostEur: Math.round(Number(p?.projected_total_cost_eur ?? 0)),
      projectedTotalSavingsEur: Math.round(Number(p?.projected_total_savings_eur ?? 0)),
      projectedNetCostEur: Math.round(Number(p?.projected_net_cost_eur ?? 0)),
      projectedProfitIncreaseEur: Math.round(Number(p?.projected_profit_increase_eur ?? 0)),
      confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 50))),
    })),
    summary: {
      currentTotalCostEur: Math.round(Number(parsed?.summary?.current_total_cost_eur ?? 0)),
      optimizedTotalCostEur: Math.round(Number(parsed?.summary?.optimized_total_cost_eur ?? 0)),
      totalSavingsEur: Math.round(Number(parsed?.summary?.total_savings_eur ?? 0)),
      totalSavingsPct: Math.round(Number(parsed?.summary?.total_savings_pct ?? 0) * 10) / 10,
      biggestCostCategory: (COST_CATEGORIES as readonly string[]).includes(String(parsed?.summary?.biggest_cost_category)) ? String(parsed.summary.biggest_cost_category) : 'sourcing_cost',
      biggestSavingsOpportunity: String(parsed?.summary?.biggest_savings_opportunity ?? '').slice(0, 200),
      quickestCostWin: String(parsed?.summary?.quickest_cost_win ?? '').slice(0, 200),
      costMinimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.cost_minimization_score ?? 60))),
    },
  };
}
