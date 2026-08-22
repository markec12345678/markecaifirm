// v6.64 / v8.95.7-inv2-refactor: AI Inventory Seasonal Planner v2 — advanced seasonal planning z ML in cross-category analysis
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-seasonal-planner-v2
// Body: { monthsAhead?: number }
// Returns: { ok, planner: { seasons, calendar, categories, mlPredictions, strategies, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const SEASONS = ['spring', 'summer', 'autumn', 'winter', 'christmas', 'easter', 'back_to_school', 'black_friday'] as const;

interface SeasonalPlannerInput {
  monthsAhead: number;
}

export const POST = withAiRoute<SeasonalPlannerInput>({
  endpoint: '/api/ai/inventory-seasonal-planner-v2',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget + avtomatsko recordAiCall po uspehu

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      monthsAhead: Math.max(1, Math.min(12, Number(body?.monthsAhead ?? 6))),
    };
  },

  // No validateInput — monthsAhead ima default z clamp

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { monthsAhead } = input;

    const since12m = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since12m, not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true } } },
      take: 100,
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, planner: null, message: 'Ni podatkov za seasonal planning.' });
    }

    // Category-month aggregation for seasonal patterns
    const catMonthMap = computeSeasonalCatMonthMap(soldTrades);

    const prompt = buildSeasonalPrompt({ monthsAhead, catMonthMap });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const validCats = new Set(Array.from(catMonthMap.keys()));
    const planner = transformSeasonalPlanner(parsed, catMonthMap, validCats);

    return apiOk({ ok: true, planner });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface SeasonalSoldRow {
  category: string | null;
  sellDate: Date | null;
}

function computeSeasonalCatMonthMap(soldTrades: SeasonalSoldRow[]): Map<string, number[]> {
  const catMonthMap = new Map<string, number[]>();
  for (const t of soldTrades) {
    const cat = (t.category || 'drugo').toLowerCase();
    const month = t.sellDate!.getMonth();
    if (!catMonthMap.has(cat)) catMonthMap.set(cat, new Array(12).fill(0));
    catMonthMap.get(cat)![month] += 1;
  }
  return catMonthMap;
}

interface SeasonalPromptInput {
  monthsAhead: number;
  catMonthMap: Map<string, number[]>;
}

function buildSeasonalPrompt(input: SeasonalPromptInput): string {
  const { monthsAhead, catMonthMap } = input;
  const catStr = Array.from(catMonthMap.entries()).slice(0, 8).map(([cat, months]) => {
    const total = months.reduce((a, b) => a + b, 0);
    const peakMonth = months.indexOf(Math.max(...months));
    return `- ${cat}: ${total} sold, peak mesec ${peakMonth + 1}, distribucija: ${months.join(',')}`;
  }).join('\n');

  return `Si AI inventory seasonal planner v2 z ML in cross-category seasonal analysis.
Načrtuje seasonal strategijo za naslednjih ${monthsAhead} mesecev.

KATEGORIJE Z MESEČNO DISTRIBUCIJO (12m):
${catStr}

8 sezon: spring, summer, autumn, winter, christmas, easter, back_to_school, black_friday

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "seasons": [
    { "season": "<8 sezon>", "months": [<number>], "description": "<max 100 znakov>", "hot_categories": ["<kategorija>"], "cold_categories": ["<kategorija>"], "premium_multiplier": <number>, "avg_demand_increase_pct": <number> }
  ],
  "calendar": [
    { "month": <1-12>, "season": "<8 sezon>", "recommended_actions": ["<max 100 znakov>"], "categories_to_stock": ["<kategorija>"], "categories_to_sell": ["<kategorija>"], "expected_revenue_eur": <number>, "priority": "<high|medium|low>" }
  ],
  "categories": [
    { "category": "<kategorija>", "peak_season": "<8 sezon>", "peak_months": [<number>], "seasonal_factor_pct": <number 0-100>, "current_held_count": <number>, "recommended_stock_level": <number>, "stock_action": "<build_up|maintain|reduce|liquidate>", "seasonal_strategy": "<max 120 znakov>" }
  ],
  "ml_predictions": [
    { "model": "<arima|lstm|prophet|xgboost|ensemble>", "seasonal_accuracy_pct": <number 0-100>, "best_for_season": "<8 sezon>", "weight_in_ensemble": <number 0-100> }
  ],
  "strategies": [
    { "strategy": "<pre_season_stocking|peak_season_pricing|post_season_clearance|off_season_storage|cross_seasonal_hedging>", "description": "<max 120 znakov>", "best_for_category": "<max 80 znakov>", "expected_revenue_impact_eur": <number>, "implementation_effort": "<low|medium|high>" }
  ],
  "summary": {
    "total_categories_analyzed": <number>,
    "current_season": "<8 sezon>",
    "peak_season_coming": "<8 sezon>",
    "total_expected_seasonal_revenue_eur": <number>,
    "biggest_seasonal_opportunity": "<max 100 znakov>",
    "biggest_seasonal_risk": "<max 100 znakov>",
    "seasonal_planning_score": <number 0-100>
  }
}`;
}

function transformSeasonalPlanner(parsed: any, catMonthMap: Map<string, number[]>, validCats: Set<string>) {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    seasons: (parsed?.seasons || []).slice(0, 8).map((s: any) => ({
      season: (SEASONS as readonly string[]).includes(String(s?.season)) ? String(s.season) : 'spring',
      months: (s?.months || []).slice(0, 12).map((m: any) => Math.max(1, Math.min(12, Number(m)))),
      description: String(s?.description ?? '').slice(0, 200),
      hotCategories: (s?.hot_categories || []).slice(0, 8).map((c: any) => String(c).slice(0, 50)),
      coldCategories: (s?.cold_categories || []).slice(0, 8).map((c: any) => String(c).slice(0, 50)),
      premiumMultiplier: Math.round(Number(s?.premium_multiplier ?? 1) * 100) / 100,
      avgDemandIncreasePct: Math.round(Number(s?.avg_demand_increase_pct ?? 0) * 10) / 10,
    })),
    calendar: (parsed?.calendar || []).slice(0, 12).map((c: any) => ({
      month: Math.max(1, Math.min(12, Number(c?.month ?? 1))),
      season: (SEASONS as readonly string[]).includes(String(c?.season)) ? String(c.season) : 'spring',
      recommendedActions: (c?.recommended_actions || []).slice(0, 5).map((a: any) => String(a).slice(0, 200)),
      categoriesToStock: (c?.categories_to_stock || []).slice(0, 6).map((cat: any) => String(cat).slice(0, 50)),
      categoriesToSell: (c?.categories_to_sell || []).slice(0, 6).map((cat: any) => String(cat).slice(0, 50)),
      expectedRevenueEur: Math.round(Number(c?.expected_revenue_eur ?? 0)),
      priority: ['high', 'medium', 'low'].includes(String(c?.priority)) ? String(c.priority) : 'medium',
    })),
    categories: (parsed?.categories || []).filter((c: any) => validCats.has(String(c?.category ?? ''))).slice(0, 12).map((c: any) => ({
      category: String(c?.category ?? '').slice(0, 50),
      peakSeason: (SEASONS as readonly string[]).includes(String(c?.peak_season)) ? String(c.peak_season) : 'summer',
      peakMonths: (c?.peak_months || []).slice(0, 6).map((m: any) => Math.max(1, Math.min(12, Number(m)))),
      seasonalFactorPct: Math.max(0, Math.min(100, Number(c?.seasonal_factor_pct ?? 50))),
      currentHeldCount: Math.max(0, Number(c?.current_held_count ?? 0)),
      recommendedStockLevel: Math.max(0, Number(c?.recommended_stock_level ?? 0)),
      stockAction: ['build_up', 'maintain', 'reduce', 'liquidate'].includes(String(c?.stock_action)) ? String(c.stock_action) : 'maintain',
      seasonalStrategy: String(c?.seasonal_strategy ?? '').slice(0, 250),
    })),
    mlPredictions: (parsed?.ml_predictions || []).slice(0, 5).map((m: any) => ({
      model: ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      seasonalAccuracyPct: Math.max(0, Math.min(100, Number(m?.seasonal_accuracy_pct ?? 70))),
      bestForSeason: (SEASONS as readonly string[]).includes(String(m?.best_for_season)) ? String(m.best_for_season) : 'summer',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    strategies: (parsed?.strategies || []).slice(0, 5).map((s: any) => ({
      strategy: ['pre_season_stocking', 'peak_season_pricing', 'post_season_clearance', 'off_season_storage', 'cross_seasonal_hedging'].includes(String(s?.strategy)) ? String(s.strategy) : 'pre_season_stocking',
      description: String(s?.description ?? '').slice(0, 250),
      bestForCategory: String(s?.best_for_category ?? '').slice(0, 150),
      expectedRevenueImpactEur: Math.round(Number(s?.expected_revenue_impact_eur ?? 0)),
      implementationEffort: ['low', 'medium', 'high'].includes(String(s?.implementation_effort)) ? String(s.implementation_effort) : 'medium',
    })),
    summary: {
      totalCategoriesAnalyzed: catMonthMap.size,
      currentSeason: (SEASONS as readonly string[]).includes(String(parsed?.summary?.current_season)) ? String(parsed.summary.current_season) : 'summer',
      peakSeasonComing: (SEASONS as readonly string[]).includes(String(parsed?.summary?.peak_season_coming)) ? String(parsed.summary.peak_season_coming) : 'christmas',
      totalExpectedSeasonalRevenueEur: Math.round(Number(parsed?.summary?.total_expected_seasonal_revenue_eur ?? 0)),
      biggestSeasonalOpportunity: String(parsed?.summary?.biggest_seasonal_opportunity ?? '').slice(0, 200),
      biggestSeasonalRisk: String(parsed?.summary?.biggest_seasonal_risk ?? '').slice(0, 200),
      seasonalPlanningScore: Math.max(0, Math.min(100, Number(parsed?.summary?.seasonal_planning_score ?? 60))),
    },
  };
}
