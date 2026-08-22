// v6.73 / v8.95.8-refactor: AI Inventory Supply Chain Optimizer — optimizira supply chain z ML in sourcing strategy
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-supply-chain-optimizer
// Body: { monthsAhead?: number }
// Returns: { ok, optimizer: { current, sourcing, suppliers, logistics, mlModels, projections, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const SOURCING_TYPES = ['bulk_purchase', 'individual_sourcing', 'auction_buying', 'wholesale_lot', 'private_seller', 'estate_sale', 'retail_arbitrage', 'online_arbitrage', 'import', 'local_pickup'] as const;

interface SupplyChainOptimizerInput {
  monthsAhead: number;
}

interface SoldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  buyDate: Date;
  buyLocation: string | null;
}

interface Source {
  name: string;
  count: number;
  invested: number;
  profit: number;
  avgMarginPct: number;
}

export const POST = withAiRoute<SupplyChainOptimizerInput>({
  endpoint: '/api/ai/inventory-supply-chain-optimizer',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      monthsAhead: Math.max(1, Math.min(12, Number(body?.monthsAhead ?? 6))),
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { monthsAhead } = input;

    const since12m = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since12m, not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true, buyLocation: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, optimizer: null, message: 'Ni podatkov za supply chain optimizacijo.' });
    }

    const stats = computeSupplyChainStats(soldTrades);

    const prompt = buildPrompt({
      monthsAhead,
      totalCost: stats.totalCost,
      totalProfit: stats.totalProfit,
      avgBuyPrice: stats.avgBuyPrice,
      sources: stats.sources,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const optimizer = transformOptimizer(parsed, { ...stats, monthsAhead });

    return apiOk({ ok: true, optimizer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface SupplyChainStats {
  totalCost: number;
  totalRevenue: number;
  totalProfit: number;
  avgBuyPrice: number;
  sources: Source[];
}

function computeSupplyChainStats(soldTrades: SoldTradeRow[]): SupplyChainStats {
  const totalCost = soldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
  const totalRevenue = soldTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
  const totalProfit = totalRevenue - totalCost;
  const avgBuyPrice = Math.round(totalCost / soldTrades.length);

  // Sourcing locations
  const sourcingMap = new Map<string, { count: number; invested: number; profit: number }>();
  for (const t of soldTrades) {
    const loc = (t.buyLocation || 'unknown').trim();
    if (!loc) continue;
    if (!sourcingMap.has(loc)) sourcingMap.set(loc, { count: 0, invested: 0, profit: 0 });
    const s = sourcingMap.get(loc)!;
    s.count += 1;
    s.invested += t.buyPrice + (t.buyFees ?? 0);
    s.profit += ((t.sellPrice ?? 0) - (t.sellFees ?? 0)) - (t.buyPrice + (t.buyFees ?? 0));
  }
  const sources = Array.from(sourcingMap.entries()).map(([name, s]) => ({
    name,
    ...s,
    invested: Math.round(s.invested),
    profit: Math.round(s.profit),
    avgMarginPct: s.invested > 0 ? Math.round((s.profit / s.invested) * 1000) / 10 : 0,
  })).sort((a, b) => b.profit - a.profit);

  return { totalCost, totalRevenue, totalProfit, avgBuyPrice, sources };
}

interface SupplyChainPromptInput {
  monthsAhead: number;
  totalCost: number;
  totalProfit: number;
  avgBuyPrice: number;
  sources: Source[];
}

function buildPrompt(input: SupplyChainPromptInput): string {
  const { monthsAhead, totalCost, totalProfit, avgBuyPrice, sources } = input;
  return `Si AI inventory supply chain optimizer z ML in sourcing strategy.
Optimizira supply chain za ${monthsAhead} mesecev.

STATS:
- Letni cost: ${Math.round(totalCost)}€
- Letni profit: ${Math.round(totalProfit)}€
- Povp buy price: ${avgBuyPrice}€
- Sources: ${sources.length}

TOP SOURCES:
${sources.slice(0, 5).map(s => `- ${s.name}: ${s.count}x, invested ${s.invested}€, profit ${s.profit}€, margin ${s.avgMarginPct}%`).join('\n')}

10 sourcing tipov:
1. BULK_PURCHASE: bulk nakup za popust
2. INDIVIDUAL_SOURCING: individualni nakupi
3. AUCTION_BUYING: dražbe
4. WHOLESALE_LOT: wholesale lot
5. PRIVATE_SELLER: privatni prodajalci
6. ESTATE_SALE: dražbe nepremičnin/ostalin
7. RETAIL_ARBITRAGE: retail → resale
8. ONLINE_ARBITRAGE: online → resale
9. IMPORT: uvoz
10. LOCAL_PICKUP: lokalni prevzemi

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": { "total_sourcing_cost_eur": <number>, "total_profit_eur": <number>, "avg_sourcing_margin_pct": <number>, "active_sources": <number>, "supply_chain_efficiency_pct": <number 0-100>, "sourcing_diversification_score": <number 0-100> },
  "sourcing": [
    { "sourcing_type": "<10 tipov>", "description": "<max 100 znakov>", "avg_cost_eur": <number>, "avg_margin_pct": <number>, "reliability_score": <number 0-100>, "scalability_score": <number 0-100>, "recommended_volume_pct": <number 0-100>, "best_for_category": "<max 80 znakov>" }
  ],
  "suppliers": [
    { "supplier_name": "<max 80 znakov>", "category": "<kategorija>", "total_invested_eur": <number>, "total_profit_eur": <number>, "margin_pct": <number>, "reliability_score": <number 0-100>, "response_time_hours": <number>, "recommended_action": "<increase|maintain|reduce|exit>", "negotiation_leverage": "<max 100 znakov>" }
  ],
  "logistics": [
    { "component": "<transport|storage|packaging|shipping|insurance|handling>", "current_cost_eur": <number>, "optimized_cost_eur": <number>, "savings_eur": <number>, "optimization_action": "<max 120 znakov>", "implementation_difficulty": "<low|medium|high>" }
  ],
  "mlModels": [
    { "model": "<arima|lstm|prophet|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<demand_forecast|price_prediction|supplier_reliability|optimal_sourcing>", "weight_in_ensemble": <number 0-100> }
  ],
  "projections": [
    { "month": <1-12>, "projected_sourcing_cost_eur": <number>, "projected_revenue_eur": <number>, "projected_profit_eur": <number>, "projected_margin_pct": <number>, "confidence_pct": <number 0-100> }
  ],
  "summary": {
    "current_supply_chain_score": <number 0-100>, "optimized_supply_chain_score": <number 0-100>, "improvement_pct": <number>,
    "total_expected_cost_savings_eur": <number>, "total_expected_profit_increase_eur": <number>,
    "best_sourcing_type": "<10 tipov>", "biggest_supply_chain_bottleneck": "<max 100 znakov>",
    "quickest_supply_chain_win": "<max 100 znakov>", "supply_chain_optimization_score": <number 0-100>
  }
}`;
}

interface SupplyChainTransformStats extends SupplyChainStats {
  monthsAhead: number;
}

function transformOptimizer(parsed: any, stats: SupplyChainTransformStats) {
  const { totalCost, totalProfit, sources, monthsAhead } = stats;
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    current: {
      totalSourcingCostEur: Math.round(Number(parsed?.current?.total_sourcing_cost_eur ?? totalCost)),
      totalProfitEur: Math.round(Number(parsed?.current?.total_profit_eur ?? totalProfit)),
      avgSourcingMarginPct: Math.round(Number(parsed?.current?.avg_sourcing_margin_pct ?? 25) * 10) / 10,
      activeSources: Math.max(0, Number(parsed?.current?.active_sources ?? sources.length)),
      supplyChainEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.current?.supply_chain_efficiency_pct ?? 60))),
      sourcingDiversificationScore: Math.max(0, Math.min(100, Number(parsed?.current?.sourcing_diversification_score ?? 50))),
    },
    sourcing: (parsed?.sourcing || []).slice(0, 10).map((s: any) => ({
      sourcingType: SOURCING_TYPES.includes(String(s?.sourcing_type) as any) ? String(s.sourcing_type) : 'individual_sourcing',
      description: String(s?.description ?? '').slice(0, 200),
      avgCostEur: Math.round(Number(s?.avg_cost_eur ?? 0)),
      avgMarginPct: Math.round(Number(s?.avg_margin_pct ?? 0) * 10) / 10,
      reliabilityScore: Math.max(0, Math.min(100, Number(s?.reliability_score ?? 50))),
      scalabilityScore: Math.max(0, Math.min(100, Number(s?.scalability_score ?? 50))),
      recommendedVolumePct: Math.max(0, Math.min(100, Number(s?.recommended_volume_pct ?? 20))),
      bestForCategory: String(s?.best_for_category ?? '').slice(0, 150),
    })),
    suppliers: (parsed?.suppliers || []).slice(0, 10).map((s: any) => ({
      supplierName: String(s?.supplier_name ?? '').slice(0, 150),
      category: String(s?.category ?? '').slice(0, 50),
      totalInvestedEur: Math.round(Number(s?.total_invested_eur ?? 0)),
      totalProfitEur: Math.round(Number(s?.total_profit_eur ?? 0)),
      marginPct: Math.round(Number(s?.margin_pct ?? 0) * 10) / 10,
      reliabilityScore: Math.max(0, Math.min(100, Number(s?.reliability_score ?? 50))),
      responseTimeHours: Math.round(Number(s?.response_time_hours ?? 24)),
      recommendedAction: ['increase', 'maintain', 'reduce', 'exit'].includes(String(s?.recommended_action)) ? String(s.recommended_action) : 'maintain',
      negotiationLeverage: String(s?.negotiation_leverage ?? '').slice(0, 200),
    })),
    logistics: (parsed?.logistics || []).slice(0, 6).map((l: any) => ({
      component: ['transport', 'storage', 'packaging', 'shipping', 'insurance', 'handling'].includes(String(l?.component)) ? String(l.component) : 'transport',
      currentCostEur: Math.round(Number(l?.current_cost_eur ?? 0)),
      optimizedCostEur: Math.round(Number(l?.optimized_cost_eur ?? 0)),
      savingsEur: Math.round(Number(l?.savings_eur ?? 0)),
      optimizationAction: String(l?.optimization_action ?? '').slice(0, 250),
      implementationDifficulty: ['low', 'medium', 'high'].includes(String(l?.implementation_difficulty)) ? String(l.implementation_difficulty) : 'medium',
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))),
      predictionType: ['demand_forecast', 'price_prediction', 'supplier_reliability', 'optimal_sourcing'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'demand_forecast',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    projections: (parsed?.projections || []).slice(0, monthsAhead).map((p: any) => ({
      month: Math.max(1, Math.min(12, Number(p?.month ?? 1))),
      projectedSourcingCostEur: Math.round(Number(p?.projected_sourcing_cost_eur ?? 0)),
      projectedRevenueEur: Math.round(Number(p?.projected_revenue_eur ?? 0)),
      projectedProfitEur: Math.round(Number(p?.projected_profit_eur ?? 0)),
      projectedMarginPct: Math.round(Number(p?.projected_margin_pct ?? 0) * 10) / 10,
      confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 50))),
    })),
    summary: {
      currentSupplyChainScore: Math.max(0, Math.min(100, Number(parsed?.summary?.current_supply_chain_score ?? 60))),
      optimizedSupplyChainScore: Math.max(0, Math.min(100, Number(parsed?.summary?.optimized_supply_chain_score ?? 75))),
      improvementPct: Math.round(Number(parsed?.summary?.improvement_pct ?? 0) * 10) / 10,
      totalExpectedCostSavingsEur: Math.round(Number(parsed?.summary?.total_expected_cost_savings_eur ?? 0)),
      totalExpectedProfitIncreaseEur: Math.round(Number(parsed?.summary?.total_expected_profit_increase_eur ?? 0)),
      bestSourcingType: SOURCING_TYPES.includes(String(parsed?.summary?.best_sourcing_type) as any) ? String(parsed.summary.best_sourcing_type) : 'individual_sourcing',
      biggestSupplyChainBottleneck: String(parsed?.summary?.biggest_supply_chain_bottleneck ?? '').slice(0, 200),
      quickestSupplyChainWin: String(parsed?.summary?.quickest_supply_chain_win ?? '').slice(0, 200),
      supplyChainOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.supply_chain_optimization_score ?? 60))),
    },
  };
}
