// v6.77 / v8.95.5: AI Inventory Profit Margin Tracker — ML tracking profit marginov z trend analysis
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-profit-margin-tracker
// Body: { days?: number, category?: string }
// Returns: { ok, tracker: { current, trends, categories, items, alerts, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const MARGIN_GRADES = ['A', 'B', 'C', 'D', 'F'] as const;
const MARGIN_HEALTH = ['excellent', 'good', 'average', 'poor', 'critical'] as const;
const TREND_METRICS = ['margin_pct', 'profit', 'revenue', 'cost', 'roi'] as const;
const TREND_TYPES = ['improving', 'stable', 'declining', 'volatile'] as const;
const CATEGORY_TRENDS = ['improving', 'stable', 'declining'] as const;
const PERFORMANCE_TIERS = ['excellent', 'good', 'average', 'poor', 'loss'] as const;
const RECOMMENDED_ACTIONS = ['scale_up', 'maintain', 'reduce', 'exit'] as const;
const ITEM_MARGIN_STATUS = ['excellent', 'good', 'average', 'poor', 'loss'] as const;
const ALERT_TYPES = ['margin_decline', 'low_margin', 'cost_increase', 'price_too_low', 'category_underperforming'] as const;
const ALERT_SEVERITY = ['info', 'warning', 'critical'] as const;
const MARGIN_ML_MODELS = ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'] as const;
const MARGIN_PREDICTION_TYPES = ['margin_forecast', 'trend_prediction', 'anomaly_detection', 'optimal_pricing'] as const;
const OVERALL_TRENDS = ['improving', 'stable', 'declining'] as const;

interface InventoryProfitMarginTrackerInput {
  days: number;
}

export const POST = withAiRoute<InventoryProfitMarginTrackerInput>({
  endpoint: '/api/ai/inventory-profit-margin-tracker',
  maxDuration: 90,
  enforceBudget: true, // v8.94: budget guard + avtomatski recordAiCall

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      days: Math.max(7, Math.min(365, Number(body?.days ?? 30))),
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { days } = input;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sincePrev = new Date(Date.now() - days * 2 * 24 * 60 * 60 * 1000);

    const soldCurrent = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since, not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });
    const soldPrev = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: sincePrev, lt: since, not: null } },
      select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
      take: 500,
    });
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true } } },
      take: 100,
    });

    if (soldCurrent.length === 0) return apiOk({ ok: true, tracker: null, message: 'Ni prodaj za margin tracking.' });

    const current = calcMargin(soldCurrent);
    const previous = calcMargin(soldPrev);
    const catStats = buildCategoryStats(soldCurrent);

    const prompt = buildMarginPrompt(current, previous, catStats, days);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const tracker = transformTracker(parsed, current, catStats, heldTrades);

    return apiOk({ ok: true, tracker });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface MarginSoldRow {
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  category?: string | null;
}

interface MarginHeldRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: { aiEstimatedValue: number | null } | null;
}

interface MarginStats {
  marginPct: number;
  profit: number;
  revenue: number;
  cost: number;
}

function calcMargin(trades: MarginSoldRow[]): MarginStats {
  const cost = trades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
  const rev = trades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
  const profit = rev - cost;
  return {
    marginPct: cost > 0 ? Math.round((profit / cost) * 1000) / 10 : 0,
    profit: Math.round(profit),
    revenue: Math.round(rev),
    cost: Math.round(cost),
  };
}

interface CategoryStat {
  category: string;
  count: number;
  profit: number;
  cost: number;
  revenue: number;
  marginPct: number;
}

function buildCategoryStats(soldCurrent: MarginSoldRow[]): CategoryStat[] {
  const catMap = new Map<string, { count: number; profit: number; cost: number; revenue: number; marginPct: number }>();
  for (const t of soldCurrent) {
    const cat = (t.category || 'drugo').toLowerCase();
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    if (!catMap.has(cat)) catMap.set(cat, { count: 0, profit: 0, cost: 0, revenue: 0, marginPct: 0 });
    const c = catMap.get(cat)!;
    c.count += 1;
    c.cost += cost;
    c.revenue += rev;
    c.profit += rev - cost;
  }
  catMap.forEach(c => {
    c.marginPct = c.cost > 0 ? Math.round((c.profit / c.cost) * 1000) / 10 : 0;
    c.profit = Math.round(c.profit);
    c.cost = Math.round(c.cost);
    c.revenue = Math.round(c.revenue);
  });
  return Array.from(catMap.entries()).map(([cat, c]) => ({ category: cat, ...c })).sort((a, b) => b.profit - a.profit);
}

function buildMarginPrompt(current: MarginStats, previous: MarginStats, catStats: CategoryStat[], days: number): string {
  return `Si AI inventory profit margin tracker z ML in trend analysis.
Sledi profit marginom za zadnjih ${days} dni z ML trend detection.

CURRENT:
- Margin: ${current.marginPct}% | Profit: ${current.profit}€ | Revenue: ${current.revenue}€ | Cost: ${current.cost}€
PREVIOUS:
- Margin: ${previous.marginPct}% | Profit: ${previous.profit}€
CATEGORIES: ${catStats.slice(0, 8).map(c => `${c.category}: ${c.marginPct}%`).join(', ')}

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": { "margin_pct": <number>, "profit_eur": <number>, "revenue_eur": <number>, "cost_eur": <number>, "roi_pct": <number>, "margin_change_vs_prev_pct": <number>, "margin_grade": "<A|B|C|D|F>", "margin_health": "<excellent|good|average|poor|critical>" },
  "trends": [
    { "metric": "<margin_pct|profit|revenue|cost|roi>", "current_value": <number>, "previous_value": <number>, "change_pct": <number>, "trend": "<improving|stable|declining|volatile>", "trend_strength": <number 0-100>, "prediction_30d": <number>, "confidence_pct": <number 0-100> }
  ],
  "categories": [
    { "category": "<kategorija>", "margin_pct": <number>, "profit_eur": <number>, "revenue_eur": <number>, "cost_eur": <number>, "item_count": <number>, "margin_trend": "<improving|stable|declining>", "margin_vs_avg_pct": <number>, "performance_tier": "<excellent|good|average|poor|loss>", "recommended_action": "<scale_up|maintain|reduce|exit>" }
  ],
  "items": [
    { "id": "<trade_id>", "title": "<naslov>", "category": "<kategorija>", "buy_price_eur": <number>, "est_sell_price_eur": <number>, "est_margin_pct": <number>, "est_profit_eur": <number>, "margin_rank": <number>, "vs_category_avg_pct": <number>, "margin_status": "<excellent|good|average|poor|loss>" }
  ],
  "alerts": [
    { "alert_type": "<margin_decline|low_margin|cost_increase|price_too_low|category_underperforming>", "severity": "<info|warning|critical>", "description": "<max 150 znakov>", "affected_items": <number>, "financial_impact_eur": <number>, "recommended_action": "<max 150 znakov>" }
  ],
  "mlModels": [
    { "model": "<arima|lstm|prophet|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<margin_forecast|trend_prediction|anomaly_detection|optimal_pricing>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "overall_margin_pct": <number>, "overall_margin_trend": "<improving|stable|declining>",
    "total_profit_eur": <number>, "best_margin_category": "<max 80 znakov>", "worst_margin_category": "<max 80 znakov>",
    "biggest_margin_threat": "<max 100 znakov>", "quickest_margin_win": "<max 100 znakov>",
    "margin_tracking_score": <number 0-100>
  }
}`;
}

function transformTracker(parsed: any, current: MarginStats, catStats: CategoryStat[], heldTrades: MarginHeldRow[]) {
  const validIds = new Set(heldTrades.map(t => t.id));
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    current: {
      marginPct: Math.round(Number(parsed?.current?.margin_pct ?? current.marginPct) * 10) / 10,
      profitEur: Math.round(Number(parsed?.current?.profit_eur ?? current.profit)),
      revenueEur: Math.round(Number(parsed?.current?.revenue_eur ?? current.revenue)),
      costEur: Math.round(Number(parsed?.current?.cost_eur ?? current.cost)),
      roiPct: Math.round(Number(parsed?.current?.roi_pct ?? 0) * 10) / 10,
      marginChangeVsPrevPct: Math.round(Number(parsed?.current?.margin_change_vs_prev_pct ?? 0) * 10) / 10,
      marginGrade: (MARGIN_GRADES as readonly string[]).includes(String(parsed?.current?.margin_grade)) ? String(parsed.current.margin_grade) : 'C',
      marginHealth: (MARGIN_HEALTH as readonly string[]).includes(String(parsed?.current?.margin_health)) ? String(parsed.current.margin_health) : 'average',
    },
    trends: (parsed?.trends || []).slice(0, 5).map((t: any) => ({
      metric: (TREND_METRICS as readonly string[]).includes(String(t?.metric)) ? String(t.metric) : 'margin_pct',
      currentValue: Math.round(Number(t?.current_value ?? 0) * 100) / 100,
      previousValue: Math.round(Number(t?.previous_value ?? 0) * 100) / 100,
      changePct: Math.round(Number(t?.change_pct ?? 0) * 10) / 10,
      trend: (TREND_TYPES as readonly string[]).includes(String(t?.trend)) ? String(t.trend) : 'stable',
      trendStrength: Math.max(0, Math.min(100, Number(t?.trend_strength ?? 50))),
      prediction30d: Math.round(Number(t?.prediction_30d ?? 0) * 100) / 100,
      confidencePct: Math.max(0, Math.min(100, Number(t?.confidence_pct ?? 50))),
    })),
    categories: (parsed?.categories || []).slice(0, 12).map((c: any) => {
      const orig = catStats.find(x => x.category === String(c?.category));
      return {
        category: String(c?.category ?? '').slice(0, 50),
        marginPct: Math.round(Number(c?.margin_pct ?? orig?.marginPct ?? 0) * 10) / 10,
        profitEur: Math.round(Number(c?.profit_eur ?? orig?.profit ?? 0)),
        revenueEur: Math.round(Number(c?.revenue_eur ?? orig?.revenue ?? 0)),
        costEur: Math.round(Number(c?.cost_eur ?? orig?.cost ?? 0)),
        itemCount: Math.max(0, Number(c?.item_count ?? orig?.count ?? 0)),
        marginTrend: (CATEGORY_TRENDS as readonly string[]).includes(String(c?.margin_trend)) ? String(c.margin_trend) : 'stable',
        marginVsAvgPct: Math.round(Number(c?.margin_vs_avg_pct ?? 0) * 10) / 10,
        performanceTier: (PERFORMANCE_TIERS as readonly string[]).includes(String(c?.performance_tier)) ? String(c.performance_tier) : 'average',
        recommendedAction: (RECOMMENDED_ACTIONS as readonly string[]).includes(String(c?.recommended_action)) ? String(c.recommended_action) : 'maintain',
      };
    }),
    items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).slice(0, 30).map((it: any) => {
      const orig = heldTrades.find(t => t.id === String(it?.id));
      const cost = orig ? orig.buyPrice + (orig.buyFees ?? 0) : 0;
      const estSell = orig?.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      return {
        tradeId: String(it?.id ?? ''),
        title: String(it?.title ?? orig?.title ?? '').slice(0, 100),
        category: String(it?.category ?? orig?.category ?? '').slice(0, 50),
        buyPriceEur: Math.round(Number(it?.buy_price_eur ?? cost)),
        estSellPriceEur: Math.round(Number(it?.est_sell_price_eur ?? estSell)),
        estMarginPct: Math.round(Number(it?.est_margin_pct ?? (cost > 0 ? ((estSell - cost) / cost) * 100 : 0)) * 10) / 10,
        estProfitEur: Math.round(Number(it?.est_profit_eur ?? estSell - cost)),
        marginRank: Math.max(1, Number(it?.margin_rank ?? 1)),
        vsCategoryAvgPct: Math.round(Number(it?.vs_category_avg_pct ?? 0) * 10) / 10,
        marginStatus: (ITEM_MARGIN_STATUS as readonly string[]).includes(String(it?.margin_status)) ? String(it.margin_status) : 'average',
      };
    }),
    alerts: (parsed?.alerts || []).slice(0, 6).map((a: any) => ({
      alertType: (ALERT_TYPES as readonly string[]).includes(String(a?.alert_type)) ? String(a.alert_type) : 'low_margin',
      severity: (ALERT_SEVERITY as readonly string[]).includes(String(a?.severity)) ? String(a.severity) : 'warning',
      description: String(a?.description ?? '').slice(0, 300),
      affectedItems: Math.max(0, Number(a?.affected_items ?? 0)),
      financialImpactEur: Math.round(Number(a?.financial_impact_eur ?? 0)),
      recommendedAction: String(a?.recommended_action ?? '').slice(0, 300),
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: (MARGIN_ML_MODELS as readonly string[]).includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))),
      predictionType: (MARGIN_PREDICTION_TYPES as readonly string[]).includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'margin_forecast',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      overallMarginPct: Math.round(Number(parsed?.summary?.overall_margin_pct ?? current.marginPct) * 10) / 10,
      overallMarginTrend: (OVERALL_TRENDS as readonly string[]).includes(String(parsed?.summary?.overall_margin_trend)) ? String(parsed.summary.overall_margin_trend) : 'stable',
      totalProfitEur: Math.round(Number(parsed?.summary?.total_profit_eur ?? current.profit)),
      bestMarginCategory: String(parsed?.summary?.best_margin_category ?? '').slice(0, 150),
      worstMarginCategory: String(parsed?.summary?.worst_margin_category ?? '').slice(0, 150),
      biggestMarginThreat: String(parsed?.summary?.biggest_margin_threat ?? '').slice(0, 200),
      quickestMarginWin: String(parsed?.summary?.quickest_margin_win ?? '').slice(0, 200),
      marginTrackingScore: Math.max(0, Math.min(100, Number(parsed?.summary?.margin_tracking_score ?? 60))),
    },
  };
}
