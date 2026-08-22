// v6.81 / v8.95.6-inventory: AI Inventory Demand Forecaster — ML napoved povpraševanja za kategorije inventarja
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-demand-forecaster
// Body: { days?: number, horizonDays?: number }
// Returns: { ok, forecaster: { overview, categoryForecasts, trendAnalysis, recommendations, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const TREND_DIRECTIONS = ['rising', 'stable', 'declining', 'volatile', 'seasonal'] as const;
const DEMAND_TIERS = ['oversupply', 'balanced', 'undersupply', 'critical_shortage', 'no_supply'] as const;

interface InventoryDemandForecasterInput {
  days: number;
  horizonDays: number;
}

export const POST = withAiRoute<InventoryDemandForecasterInput>({
  endpoint: '/api/ai/inventory-demand-forecaster',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget + avtomatsko recordAiCall po uspehu

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      days: Math.max(7, Math.min(365, Number(body?.days ?? 90))),
      horizonDays: Math.max(7, Math.min(180, Number(body?.horizonDays ?? 30))),
    };
  },

  // No validateInput — days/horizonDays imata defaulta z clamp-i

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { days, horizonDays } = input;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since, not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellDate: true, buyDate: true }, take: 1000, orderBy: { sellDate: 'desc' } });
    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyDate: true }, take: 200 });
    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return apiOk({ ok: true, forecaster: null, message: 'Ni podatkov za demand forecast.' });
    }

    const stats = computeDemandStats(soldTrades, heldTrades);
    const catList = buildDemandCategoryList(stats.categoryStats);

    const prompt = buildDemandPrompt({ stats, days, horizonDays, catList });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const forecaster = transformDemandForecaster(parsed, stats, horizonDays);

    return apiOk({ ok: true, forecaster });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface DemandSoldRow {
  category: string;
  sellPrice: number | null;
}

interface DemandHeldRow {
  category: string;
}

interface DemandCategoryStat {
  sold: number;
  held: number;
  revenue: number;
  avgPrice: number;
}

interface DemandStats {
  categoryStats: Map<string, DemandCategoryStat>;
  totalSold: number;
  totalHeld: number;
  totalRevenue: number;
}

function computeDemandStats(soldTrades: DemandSoldRow[], heldTrades: DemandHeldRow[]): DemandStats {
  const categoryStats = new Map<string, DemandCategoryStat>();
  for (const t of soldTrades) {
    const cat = t.category || 'unknown';
    if (!categoryStats.has(cat)) categoryStats.set(cat, { sold: 0, held: 0, revenue: 0, avgPrice: 0 });
    const s = categoryStats.get(cat)!;
    s.sold += 1; s.revenue += (t.sellPrice ?? 0);
  }
  for (const t of heldTrades) {
    const cat = t.category || 'unknown';
    if (!categoryStats.has(cat)) categoryStats.set(cat, { sold: 0, held: 0, revenue: 0, avgPrice: 0 });
    categoryStats.get(cat)!.held += 1;
  }
  for (const s of categoryStats.values()) { s.avgPrice = s.sold > 0 ? Math.round(s.revenue / s.sold) : 0; }

  const totalSold = soldTrades.length;
  const totalHeld = heldTrades.length;
  const totalRevenue = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0), 0);
  return { categoryStats, totalSold, totalHeld, totalRevenue };
}

function buildDemandCategoryList(categoryStats: Map<string, DemandCategoryStat>): string {
  return Array.from(categoryStats.entries()).slice(0, 12).map(([cat, s]) => `- ${cat} | sold: ${s.sold} | held: ${s.held} | rev: ${Math.round(s.revenue)}€ | avg: ${s.avgPrice}€`).join('\n');
}

interface DemandPromptInput {
  stats: DemandStats;
  days: number;
  horizonDays: number;
  catList: string;
}

function buildDemandPrompt(input: DemandPromptInput): string {
  const { stats, days, horizonDays, catList } = input;
  return `Si AI inventory demand forecaster z ML in time series forecasting.
Napoveduje povpraševanje za kategorije inventarja na ${horizonDays} dni naprej.

STATS (zadnjih ${days} dni):
- Skupno prodano: ${stats.totalSold} | vrednost: ${Math.round(stats.totalRevenue)}€
- Skupno na zalogi: ${stats.totalHeld}

KATEGORIJE:
${catList}

5 trend smeri: rising, stable, declining, volatile, seasonal
5 demand tierjev: oversupply, balanced, undersupply, critical_shortage, no_supply

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_categories": <number>, "total_sold_items": <number>, "total_held_items": <number>, "total_revenue_eur": <number>, "avg_demand_score": <number 0-100>, "forecast_confidence_pct": <number 0-100>, "demand_forecast_grade": "<A|B|C|D|F>" },
  "categoryForecasts": [
    { "category": "<string>", "current_demand_score": <number 0-100>, "predicted_demand_30d": <number>, "predicted_demand_90d": <number>, "demand_trend": "<${TREND_DIRECTIONS.join('|')}>", "demand_tier": "<${DEMAND_TIERS.join('|')}>", "supply_vs_demand_ratio": <number 0-3>, "recommended_stock_level": <number>, "urgency": "<critical|high|medium|low>" }
  ],
  "trendAnalysis": [
    { "category": "<string>", "trend_direction": "<${TREND_DIRECTIONS.join('|')}>", "trend_strength_pct": <number 0-100>, "seasonality_factor": <number 0.5-2.0>, "anomaly_detected": <boolean>, "anomaly_description": "<max 100 znakov>", "forecast_horizon_days": <number> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "category": "<string>", "action_type": "<restock|liquidate|hold|source|diversify>", "expected_revenue_impact_eur": <number>, "implementation_days": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<prophet|arima|lstm|gradient_boosting|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<demand_forecast|trend_analysis|seasonality_detection|anomaly_detection>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "demand_forecast_score": <number 0-100>, "demand_forecast_grade": "<A|B|C|D|F>", "total_predicted_demand_30d": <number>,
    "critical_categories_count": <number>, "oversupply_categories_count": <number>,
    "biggest_demand_risk": "<max 100 znakov>", "biggest_demand_opportunity": "<max 100 znakov>",
    "quickest_demand_win": "<max 100 znakov>", "demand_forecast_analysis_score": <number 0-100>
  }
}`;
}

function transformDemandForecaster(parsed: any, stats: DemandStats, horizonDays: number) {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    overview: { totalCategories: Math.max(0, Number(parsed?.overview?.total_categories ?? stats.categoryStats.size)), totalSoldItems: Math.max(0, Number(parsed?.overview?.total_sold_items ?? stats.totalSold)), totalHeldItems: Math.max(0, Number(parsed?.overview?.total_held_items ?? stats.totalHeld)), totalRevenueEur: Math.round(Number(parsed?.overview?.total_revenue_eur ?? stats.totalRevenue)), avgDemandScore: Math.max(0, Math.min(100, Number(parsed?.overview?.avg_demand_score ?? 50))), forecastConfidencePct: Math.max(0, Math.min(100, Number(parsed?.overview?.forecast_confidence_pct ?? 70))), demandForecastGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.demand_forecast_grade)) ? String(parsed.overview.demand_forecast_grade) : 'C' },
    categoryForecasts: (parsed?.categoryForecasts || []).slice(0, 12).map((c: any) => ({ category: String(c?.category ?? '').slice(0, 50), currentDemandScore: Math.max(0, Math.min(100, Number(c?.current_demand_score ?? 50))), predictedDemand30d: Math.max(0, Number(c?.predicted_demand_30d ?? 0)), predictedDemand90d: Math.max(0, Number(c?.predicted_demand_90d ?? 0)), demandTrend: (TREND_DIRECTIONS as readonly string[]).includes(String(c?.demand_trend)) ? String(c.demand_trend) : 'stable', demandTier: (DEMAND_TIERS as readonly string[]).includes(String(c?.demand_tier)) ? String(c.demand_tier) : 'balanced', supplyVsDemandRatio: Math.max(0, Math.min(3, Number(c?.supply_vs_demand_ratio ?? 1))), recommendedStockLevel: Math.max(0, Number(c?.recommended_stock_level ?? 0)), urgency: ['critical', 'high', 'medium', 'low'].includes(String(c?.urgency)) ? String(c.urgency) : 'medium' })),
    trendAnalysis: (parsed?.trendAnalysis || []).slice(0, 12).map((t: any) => ({ category: String(t?.category ?? '').slice(0, 50), trendDirection: (TREND_DIRECTIONS as readonly string[]).includes(String(t?.trend_direction)) ? String(t.trend_direction) : 'stable', trendStrengthPct: Math.max(0, Math.min(100, Number(t?.trend_strength_pct ?? 50))), seasonalityFactor: Math.max(0.5, Math.min(2.0, Number(t?.seasonality_factor ?? 1.0))), anomalyDetected: Boolean(t?.anomaly_detected ?? false), anomalyDescription: String(t?.anomaly_description ?? '').slice(0, 200), forecastHorizonDays: Math.max(1, Number(t?.forecast_horizon_days ?? horizonDays)) })),
    recommendations: (parsed?.recommendations || []).slice(0, 8).map((r: any) => ({ action: String(r?.action ?? '').slice(0, 300), category: String(r?.category ?? '').slice(0, 50), actionType: ['restock', 'liquidate', 'hold', 'source', 'diversify'].includes(String(r?.action_type)) ? String(r.action_type) : 'hold', expectedRevenueImpactEur: Math.round(Number(r?.expected_revenue_impact_eur ?? 0)), implementationDays: Math.max(1, Number(r?.implementation_days ?? 7)), priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium' })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['prophet', 'arima', 'lstm', 'gradient_boosting', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['demand_forecast', 'trend_analysis', 'seasonality_detection', 'anomaly_detection'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'demand_forecast', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
    summary: { demandForecastScore: Math.max(0, Math.min(100, Number(parsed?.summary?.demand_forecast_score ?? 50))), demandForecastGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.demand_forecast_grade)) ? String(parsed.summary.demand_forecast_grade) : 'C', totalPredictedDemand30d: Math.max(0, Number(parsed?.summary?.total_predicted_demand_30d ?? 0)), criticalCategoriesCount: Math.max(0, Number(parsed?.summary?.critical_categories_count ?? 0)), oversupplyCategoriesCount: Math.max(0, Number(parsed?.summary?.oversupply_categories_count ?? 0)), biggestDemandRisk: String(parsed?.summary?.biggest_demand_risk ?? '').slice(0, 200), biggestDemandOpportunity: String(parsed?.summary?.biggest_demand_opportunity ?? '').slice(0, 200), quickestDemandWin: String(parsed?.summary?.quickest_demand_win ?? '').slice(0, 200), demandForecastAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.demand_forecast_analysis_score ?? 50))) },
  };
}
