// v6.60 / v8.96.3-batch1: AI Inventory Profitability Analyzer — globoka analiza profitability z ML decomposition
// Refaktoriran z withAiRoute helperjem (v8.96.3-batch1) + enforceBudget guard.
//
// POST /api/ai/inventory-profitability-analyzer
// Body: { days?: number, category?: string }
// Returns: { ok, analyzer: { overall, categories, items, profitDrivers, mlDecomposition, scenarios, recommendations, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const PROFIT_DRIVERS = [
  'purchase_price_efficiency',
  'selling_price_optimization',
  'fee_minimization',
  'shipping_optimization',
  'holding_cost_minimization',
  'category_selection',
  'timing_optimization',
  'negotiation_effectiveness',
  'renovation_value_add',
  'bundle_strategy',
] as const;

interface ProfitabilityAnalyzerInput {
  days: number;
  category: string | null;
}

export const POST = withAiRoute<ProfitabilityAnalyzerInput>({
  endpoint: '/api/ai/inventory-profitability-analyzer',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      days: Math.max(7, Math.min(365, Number(body?.days ?? 90))),
      category: body?.category ? String(body.category).toLowerCase() : null,
    };
  },

  // No validateInput — vsi input-i imajo defaults

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { days, category: categoryFilter } = input;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since, not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true, sellLocation: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true } } },
      take: 100,
    });

    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return apiOk({ ok: true, analyzer: null, message: 'Ni podatkov za profitability analizo.' });
    }

    // Compute profitability metrics
    const filteredSold = categoryFilter
      ? soldTrades.filter(t => (t.category || '').toLowerCase().includes(categoryFilter))
      : soldTrades;

    const totalRevenue = filteredSold.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
    const totalCost = filteredSold.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalProfit = totalRevenue - totalCost;
    const totalFees = filteredSold.reduce((s, t) => s + (t.buyFees ?? 0) + (t.sellFees ?? 0), 0);
    const totalHoldingDays = filteredSold.reduce((s, t) => s + Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000))), 0);
    const avgDaysToSell = filteredSold.length > 0 ? Math.round(totalHoldingDays / filteredSold.length) : 0;
    const avgMarginPct = totalCost > 0 ? Math.round((totalProfit / totalCost) * 1000) / 10 : 0;
    const avgProfitPerItem = filteredSold.length > 0 ? Math.round(totalProfit / filteredSold.length) : 0;
    const dailyProfitRate = avgDaysToSell > 0 ? Math.round(totalProfit / avgDaysToSell) : 0;

    // Category breakdown
    const categoryStats = computeCategoryStats(filteredSold);

    const prompt = buildPrompt({
      days, filteredSold, totalRevenue, totalCost, totalProfit, totalFees,
      avgMarginPct, avgProfitPerItem, avgDaysToSell, dailyProfitRate, categoryStats,
    });
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const analyzer = transformAnalyzer(parsed, filteredSold, {
      totalRevenue, totalCost, totalProfit, totalFees, avgMarginPct, avgProfitPerItem, avgDaysToSell, dailyProfitRate, categoryStats,
    });

    return apiOk({ ok: true, analyzer });
  },
});

// --- Pomožne funkcive (čiste, testabilne) --------------------------------

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  buyDate: Date;
  sellLocation: string | null;
}

interface CategoryStat {
  category: string;
  count: number;
  revenue: number;
  cost: number;
  profit: number;
  fees: number;
  daysToSell: number;
  marginPct: number;
  profitPerDay: number;
  avgDaysToSell: number;
}

function computeCategoryStats(filteredSold: SoldTradeRow[]): CategoryStat[] {
  const catMap = new Map<string, { count: number; revenue: number; cost: number; profit: number; fees: number; daysToSell: number; marginPct: number; profitPerDay: number }>();
  for (const t of filteredSold) {
    const cat = (t.category || 'drugo').toLowerCase();
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const profit = revenue - cost;
    const fees = (t.buyFees ?? 0) + (t.sellFees ?? 0);
    const days = Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000)));
    if (!catMap.has(cat)) catMap.set(cat, { count: 0, revenue: 0, cost: 0, profit: 0, fees: 0, daysToSell: 0, marginPct: 0, profitPerDay: 0 });
    const c = catMap.get(cat)!;
    c.count += 1; c.revenue += revenue; c.cost += cost; c.profit += profit; c.fees += fees; c.daysToSell += days;
  }
  return Array.from(catMap.entries()).map(([cat, c]) => {
    c.marginPct = c.cost > 0 ? Math.round((c.profit / c.cost) * 1000) / 10 : 0;
    const avgDays = c.count > 0 ? Math.round(c.daysToSell / c.count) : 0;
    c.profitPerDay = avgDays > 0 ? Math.round(c.profit / avgDays) : 0;
    return { category: cat, ...c, avgDaysToSell: avgDays, revenue: Math.round(c.revenue), cost: Math.round(c.cost), profit: Math.round(c.profit), fees: Math.round(c.fees) };
  }).sort((a, b) => b.profit - a.profit);
}

interface PromptData {
  days: number;
  filteredSold: SoldTradeRow[];
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  totalFees: number;
  avgMarginPct: number;
  avgProfitPerItem: number;
  avgDaysToSell: number;
  dailyProfitRate: number;
  categoryStats: CategoryStat[];
}

function buildPrompt(d: PromptData): string {
  const catStr = d.categoryStats.slice(0, 10).map(c =>
    `- ${c.category}: ${c.count}x | revenue ${c.revenue}€ | profit ${c.profit}€ | margin ${c.marginPct}% | ${c.avgDaysToSell}d povp | ${c.profitPerDay}€/dan | fees ${c.fees}€`
  ).join('\n');

  return `Si AI inventory profitability analyzer z ML profit decomposition.
Globoka analiza profitability z 10-dimenzionalnim profit driver decomposition.

PERFORMANCE (zadnji ${d.days} dni):
- Skupno prodano: ${d.filteredSold.length} itemov
- Skupni prihodek: ${Math.round(d.totalRevenue)}€
- Skupni cost: ${Math.round(d.totalCost)}€
- Skupni profit: ${Math.round(d.totalProfit)}€
- Skupni fees: ${Math.round(d.totalFees)}€
- Povprečna marža: ${d.avgMarginPct}%
- Povp profit per item: ${d.avgProfitPerItem}€
- Povp dni do prodaje: ${d.avgDaysToSell}
- Daily profit rate: ${d.dailyProfitRate}€/dan

KATEGORIJE:
${catStr}

10 profit driverjev:
1. PURCHASE_PRICE_EFFICIENCY: kako dobro kupuješ (pod tržno ceno)
2. SELLING_PRICE_OPTIMIZATION: kako dobro prodajaš (nad tržno ceno)
3. FEE_MINIMIZATION: minimalne platform fees
4. SHIPPING_OPTIMIZATION: optimalne shipping costs
5. HOLDING_COST_MINIMIZATION: minimalni holding costs (hitra prodaja)
6. CATEGORY_SELECTION: izbor profitabilnih kategorij
7. TIMING_OPTIMIZATION: prodaja ob pravem času (sezona, demand)
8. NEGOTIATION_EFFECTIVENESS: uspešnost pogajanja
9. RENOVATION_VALUE_ADD: dodana vrednost obnove
10. BUNDLE_STRATEGY: paketna prodaja za višji profit

ML profit decomposition:
- Vsak driver ima contribution % (koliko prispeva k profitu)
- Optimization potential (koliko lahko izboljšamo)
- ROI of optimization (input effort vs output gain)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overall": {
    "total_revenue_eur": <number>,
    "total_cost_eur": <number>,
    "total_profit_eur": <number>,
    "total_fees_eur": <number>,
    "fee_percentage_of_revenue": <number>,
    "avg_margin_pct": <number>,
    "avg_roi_pct": <number>,
    "avg_profit_per_item_eur": <number>,
    "avg_days_to_sell": <number>,
    "daily_profit_rate_eur": <number>,
    "profitability_score": <number 0-100>,
    "profitability_grade": "<A|B|C|D|F>"
  },
  "categories": [
    {
      "category": "<kategorija>",
      "item_count": <number>,
      "revenue_eur": <number>,
      "cost_eur": <number>,
      "profit_eur": <number>,
      "fees_eur": <number>,
      "margin_pct": <number>,
      "avg_days_to_sell": <number>,
      "profit_per_day_eur": <number>,
      "roi_pct": <number>,
      "profitability_tier": "<excellent|good|average|poor|loss>",
      "optimization_potential_eur": <number>,
      "recommended_action": "<scale_up|maintain|reduce|exit>"
    }
  ],
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "category": "<kategorija>",
      "buy_price_eur": <number>,
      "sell_price_eur": <number>,
      "profit_eur": <number>,
      "margin_pct": <number>,
      "days_to_sell": <number>,
      "profit_per_day_eur": <number>,
      "profitability_rank": <number>,
      "performance_vs_category_avg_pct": <number>,
      "key_success_factor": "<max 100 znakov>"
    }
  ],
  "profit_drivers": [
    {
      "driver": "<10 driverjev>",
      "current_contribution_pct": <number 0-100>,
      "current_value_eur": <number>,
      "optimization_potential_pct": <number 0-100>,
      "optimization_value_eur": <number>,
      "implementation_difficulty": "<low|medium|high>",
      "roi_of_optimization": <number>,
      "priority": "<high|medium|low>",
      "recommended_action": "<max 150 znakov>"
    }
  ],
  "ml_decomposition": [
    {
      "metric": "<revenue|cost|profit|margin|roi|days_to_sell>",
      "driver_breakdown": [{"driver": "<10 driverjev>", "contribution_pct": <number 0-100>, "contribution_value": <number>}],
      "total_explained_pct": <number 0-100>,
      "unexplained_pct": <number 0-100>,
      "model_confidence_pct": <number 0-100>
    }
  ],
  "scenarios": [
    {
      "scenario": "<current|optimized|aggressive_optimization|conservative>",
      "total_profit_eur": <number>,
      "avg_margin_pct": <number>,
      "total_revenue_eur": <number>,
      "implementation_effort_eur": <number>,
      "net_gain_eur": <number>,
      "timeframe_months": <number>,
      "probability_pct": <number 0-100>
    }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "driver_targeted": "<10 driverjev>", "expected_profit_impact_eur": <number>, "implementation_months": <number> }
  ],
  "summary": {
    "total_items_analyzed": <number>,
    "total_profit_eur": <number>,
    "avg_profitability_score": <number>,
    "best_profit_driver": "<max 80 znakov>",
    "biggest_optimization_opportunity": "<max 100 znakov>",
    "best_performing_category": "<max 80 znakov>",
    "worst_performing_category": "<max 80 znakov>",
    "total_optimization_potential_eur": <number>,
    "profitability_efficiency_score": <number 0-100>
  }
}`;
}

interface TransformContext {
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  totalFees: number;
  avgMarginPct: number;
  avgProfitPerItem: number;
  avgDaysToSell: number;
  dailyProfitRate: number;
  categoryStats: CategoryStat[];
}

function transformAnalyzer(parsed: any, filteredSold: SoldTradeRow[], ctx: TransformContext) {
  const validIds = new Set(filteredSold.map(t => t.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    overall: {
      totalRevenueEur: Math.round(Number(parsed?.overall?.total_revenue_eur ?? ctx.totalRevenue)),
      totalCostEur: Math.round(Number(parsed?.overall?.total_cost_eur ?? ctx.totalCost)),
      totalProfitEur: Math.round(Number(parsed?.overall?.total_profit_eur ?? ctx.totalProfit)),
      totalFeesEur: Math.round(Number(parsed?.overall?.total_fees_eur ?? ctx.totalFees)),
      feePercentageOfRevenue: Math.round(Number(parsed?.overall?.fee_percentage_of_revenue ?? (ctx.totalRevenue > 0 ? (ctx.totalFees / ctx.totalRevenue) * 100 : 0)) * 10) / 10,
      avgMarginPct: Math.round(Number(parsed?.overall?.avg_margin_pct ?? ctx.avgMarginPct) * 10) / 10,
      avgRoiPct: Math.round(Number(parsed?.overall?.avg_roi_pct ?? (ctx.totalCost > 0 ? (ctx.totalProfit / ctx.totalCost) * 100 : 0)) * 10) / 10,
      avgProfitPerItemEur: Math.round(Number(parsed?.overall?.avg_profit_per_item_eur ?? ctx.avgProfitPerItem)),
      avgDaysToSell: Math.round(Number(parsed?.overall?.avg_days_to_sell ?? ctx.avgDaysToSell)),
      dailyProfitRateEur: Math.round(Number(parsed?.overall?.daily_profit_rate_eur ?? ctx.dailyProfitRate)),
      profitabilityScore: Math.max(0, Math.min(100, Number(parsed?.overall?.profitability_score ?? 60))),
      profitabilityGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overall?.profitability_grade)) ? String(parsed.overall.profitability_grade) : 'C',
    },
    categories: (parsed?.categories || []).slice(0, 10).map((c: any) => {
      const orig = ctx.categoryStats.find(x => x.category === String(c?.category));
      return {
        category: String(c?.category ?? '').slice(0, 50),
        itemCount: Math.max(0, Number(c?.item_count ?? orig?.count ?? 0)),
        revenueEur: Math.round(Number(c?.revenue_eur ?? orig?.revenue ?? 0)),
        costEur: Math.round(Number(c?.cost_eur ?? orig?.cost ?? 0)),
        profitEur: Math.round(Number(c?.profit_eur ?? orig?.profit ?? 0)),
        feesEur: Math.round(Number(c?.fees_eur ?? orig?.fees ?? 0)),
        marginPct: Math.round(Number(c?.margin_pct ?? orig?.marginPct ?? 0) * 10) / 10,
        avgDaysToSell: Math.round(Number(c?.avg_days_to_sell ?? orig?.avgDaysToSell ?? 0)),
        profitPerDayEur: Math.round(Number(c?.profit_per_day_eur ?? orig?.profitPerDay ?? 0)),
        roiPct: Math.round(Number(c?.roi_pct ?? 0) * 10) / 10,
        profitabilityTier: ['excellent', 'good', 'average', 'poor', 'loss'].includes(String(c?.profitability_tier)) ? String(c.profitability_tier) : 'average',
        optimizationPotentialEur: Math.round(Number(c?.optimization_potential_eur ?? 0)),
        recommendedAction: ['scale_up', 'maintain', 'reduce', 'exit'].includes(String(c?.recommended_action)) ? String(c.recommended_action) : 'maintain',
      };
    }),
    items: (parsed?.items || [])
      .filter((it: any) => validIds.has(String(it?.id ?? '')))
      .slice(0, 20)
      .map((it: any) => {
        const orig = filteredSold.find(t => t.id === String(it?.id));
        return {
          tradeId: String(it?.id ?? ''),
          title: String(it?.title ?? orig?.title ?? '').slice(0, 100),
          category: String(it?.category ?? orig?.category ?? '').slice(0, 50),
          buyPriceEur: Math.max(0, Math.round(Number(it?.buy_price_eur ?? orig?.buyPrice ?? 0))),
          sellPriceEur: Math.max(0, Math.round(Number(it?.sell_price_eur ?? orig?.sellPrice ?? 0))),
          profitEur: Math.round(Number(it?.profit_eur ?? 0)),
          marginPct: Math.round(Number(it?.margin_pct ?? 0) * 10) / 10,
          daysToSell: Math.max(0, Number(it?.days_to_sell ?? 0)),
          profitPerDayEur: Math.round(Number(it?.profit_per_day_eur ?? 0)),
          profitabilityRank: Math.max(1, Number(it?.profitability_rank ?? 1)),
          performanceVsCategoryAvgPct: Math.round(Number(it?.performance_vs_category_avg_pct ?? 0) * 10) / 10,
          keySuccessFactor: String(it?.key_success_factor ?? '').slice(0, 200),
        };
      }),
    profitDrivers: (parsed?.profit_drivers || []).slice(0, 10).map((d: any) => ({
      driver: PROFIT_DRIVERS.includes(String(d?.driver) as any) ? String(d.driver) : 'purchase_price_efficiency',
      currentContributionPct: Math.max(0, Math.min(100, Number(d?.current_contribution_pct ?? 10))),
      currentValueEur: Math.round(Number(d?.current_value_eur ?? 0)),
      optimizationPotentialPct: Math.max(0, Math.min(100, Number(d?.optimization_potential_pct ?? 20))),
      optimizationValueEur: Math.round(Number(d?.optimization_value_eur ?? 0)),
      implementationDifficulty: ['low', 'medium', 'high'].includes(String(d?.implementation_difficulty)) ? String(d.implementation_difficulty) : 'medium',
      roiOfOptimization: Math.round(Number(d?.roi_of_optimization ?? 0) * 10) / 10,
      priority: ['high', 'medium', 'low'].includes(String(d?.priority)) ? String(d.priority) : 'medium',
      recommendedAction: String(d?.recommended_action ?? '').slice(0, 300),
    })),
    mlDecomposition: (parsed?.ml_decomposition || []).slice(0, 6).map((m: any) => ({
      metric: ['revenue', 'cost', 'profit', 'margin', 'roi', 'days_to_sell'].includes(String(m?.metric)) ? String(m.metric) : 'profit',
      driverBreakdown: (m?.driver_breakdown || []).slice(0, 10).map((db: any) => ({
        driver: PROFIT_DRIVERS.includes(String(db?.driver) as any) ? String(db.driver) : 'purchase_price_efficiency',
        contributionPct: Math.max(0, Math.min(100, Number(db?.contribution_pct ?? 10))),
        contributionValue: Math.round(Number(db?.contribution_value ?? 0)),
      })),
      totalExplainedPct: Math.max(0, Math.min(100, Number(m?.total_explained_pct ?? 80))),
      unexplainedPct: Math.max(0, Math.min(100, Number(m?.unexplained_pct ?? 20))),
      modelConfidencePct: Math.max(0, Math.min(100, Number(m?.model_confidence_pct ?? 70))),
    })),
    scenarios: (parsed?.scenarios || []).slice(0, 4).map((s: any) => ({
      scenario: ['current', 'optimized', 'aggressive_optimization', 'conservative'].includes(String(s?.scenario)) ? String(s.scenario) : 'current',
      totalProfitEur: Math.round(Number(s?.total_profit_eur ?? 0)),
      avgMarginPct: Math.round(Number(s?.avg_margin_pct ?? 0) * 10) / 10,
      totalRevenueEur: Math.round(Number(s?.total_revenue_eur ?? 0)),
      implementationEffortEur: Math.round(Number(s?.implementation_effort_eur ?? 0)),
      netGainEur: Math.round(Number(s?.net_gain_eur ?? 0)),
      timeframeMonths: Math.max(1, Number(s?.timeframe_months ?? 3)),
      probabilityPct: Math.max(0, Math.min(100, Number(s?.probability_pct ?? 50))),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      driverTargeted: PROFIT_DRIVERS.includes(String(r?.driver_targeted) as any) ? String(r.driver_targeted) : 'purchase_price_efficiency',
      expectedProfitImpactEur: Math.round(Number(r?.expected_profit_impact_eur ?? 0)),
      implementationMonths: Math.max(1, Number(r?.implementation_months ?? 1)),
    })),
    summary: {
      totalItemsAnalyzed: filteredSold.length,
      totalProfitEur: Math.round(Number(parsed?.summary?.total_profit_eur ?? ctx.totalProfit)),
      avgProfitabilityScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_profitability_score ?? 60))),
      bestProfitDriver: PROFIT_DRIVERS.includes(String(parsed?.summary?.best_profit_driver) as any) ? String(parsed.summary.best_profit_driver) : 'purchase_price_efficiency',
      biggestOptimizationOpportunity: String(parsed?.summary?.biggest_optimization_opportunity ?? '').slice(0, 200),
      bestPerformingCategory: String(parsed?.summary?.best_performing_category ?? '').slice(0, 150),
      worstPerformingCategory: String(parsed?.summary?.worst_performing_category ?? '').slice(0, 150),
      totalOptimizationPotentialEur: Math.round(Number(parsed?.summary?.total_optimization_potential_eur ?? 0)),
      profitabilityEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.profitability_efficiency_score ?? 60))),
    },
  };
}
