// v6.70 / v8.95.8-listing: AI Listing Performance Dashboard — centralni dashboard z ML insights in KPI tracking
// Refaktoriran z withAiRoute helperjem (v8.95.8) + enforceBudget guard.
//
// POST /api/ai/listing-performance-dashboard
// Body: { days?: number }
// Returns: { ok, dashboard: { kpis, insights, trends, topPerformers, alerts, recommendations, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic, maxDuration } = AI_ROUTE_DEFAULTS;

interface DashboardInput {
  days: number;
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
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: {
    aiEstimatedValue: number | null;
    dealScore: number | null;
  } | null;
}

interface SoldStats {
  soldCount: number;
  heldCount: number;
  listingsCount: number;
  totalRevenue: number;
  totalProfit: number;
  avgMarginPct: number;
  avgDaysToSell: number;
}

export const POST = withAiRoute<DashboardInput>({
  endpoint: '/api/ai/listing-performance-dashboard',
  maxDuration: 90,
  enforceBudget: true,

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

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since, not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 500, orderBy: { sellDate: 'desc' },
    });
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 100,
    });
    const listings = await db.listing.findMany({
      where: { firstSeenAt: { gte: since }, isHidden: false },
      select: { id: true, title: true, price: true, aiScore: true, aiVerdict: true, dealScore: true },
      take: 500,
    });

    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return apiOk({ ok: true, dashboard: null, message: 'Ni podatkov za dashboard.' });
    }

    const stats = computeStats(soldTrades, heldTrades, listings);
    const prompt = buildPrompt(stats, days);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const dashboard = transformDashboard(parsed, stats);

    return apiOk({ ok: true, dashboard });
  },
});

// --- Pomožne funkcije (čiste, testabilne) ---------------------------------

function computeStats(soldTrades: SoldTradeRow[], heldTrades: HeldTradeRow[], listings: { id: string }[]): SoldStats {
  const totalRevenue = soldTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
  const totalCost = soldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
  const totalProfit = totalRevenue - totalCost;
  const avgMarginPct = totalCost > 0 ? Math.round((totalProfit / totalCost) * 1000) / 10 : 0;
  const avgDaysToSell = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => s + Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000))), 0) / soldTrades.length) : 0;
  return {
    soldCount: soldTrades.length,
    heldCount: heldTrades.length,
    listingsCount: listings.length,
    totalRevenue,
    totalProfit,
    avgMarginPct,
    avgDaysToSell,
  };
}

function buildPrompt(stats: SoldStats, days: number): string {
  return `Si AI listing performance dashboard z ML insights in KPI tracking.
Centralni dashboard za zadnje ${days} dni.

STATS:
- Prodano: ${stats.soldCount} itemov
- Prihodek: ${Math.round(stats.totalRevenue)}€
- Profit: ${Math.round(stats.totalProfit)}€
- Marža: ${stats.avgMarginPct}%
- Povp dni do prodaje: ${stats.avgDaysToSell}
- Held: ${stats.heldCount}
- Aktivni listingi: ${stats.listingsCount}

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "kpis": [
    { "name": "<revenue|profit|margin_pct|items_sold|avg_days_to_sell|conversion_rate|avg_sell_price|profit_per_item|holding_cost|roi>", "current_value": <number>, "previous_value": <number>, "change_pct": <number>, "trend": "<up|down|flat>", "target": <number>, "status": "<above_target|on_track|below_target|critical>", "description": "<max 100 znakov>" }
  ],
  "insights_list": [
    { "type": "<trend|anomaly|opportunity|warning|info>", "severity": "<high|medium|low>", "title": "<max 80 znakov>", "description": "<max 200 znakov>", "actionable": "<max 150 znakov>", "impact_eur": <number> }
  ],
  "trends": [
    { "metric": "<revenue|profit|margin|sales_volume|days_to_sell|conversion>", "trend_direction": "<rising|falling|stable|volatile>", "trend_strength": <number 0-100>, "prediction_30d": <number>, "confidence_pct": <number 0-100>, "drivers": ["<max 80 znakov>"] }
  ],
  "topPerformers": [
    { "rank": <number>, "trade_id": "<id>", "title": "<naslov>", "category": "<kategorija>", "profit_eur": <number>, "margin_pct": <number>, "days_to_sell": <number>, "performance_score": <number 0-100>, "key_success_factor": "<max 100 znakov>" }
  ],
  "alerts": [
    { "type": "<low_margin|slow_moving|overstocked|underperforming|price_drop|market_shift>", "severity": "<info|warning|critical>", "description": "<max 150 znakov>", "affected_count": <number>, "financial_impact_eur": <number>, "recommended_action": "<max 150 znakov>" }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "kpi_affected": "<kpi>", "expected_impact_eur": <number>, "implementation_effort": "<low|medium|high>", "timeframe_days": <number> }
  ],
  "summary": {
    "overall_health_score": <number 0-100>, "health_grade": "<A|B|C|D|F>", "trend": "<improving|stable|declining>",
    "total_revenue_eur": <number>, "total_profit_eur": <number>, "avg_margin_pct": <number>,
    "biggest_opportunity": "<max 100 znakov>", "biggest_threat": "<max 100 znakov>",
    "quickest_win": "<max 100 znakov>", "dashboard_score": <number 0-100>
  }
}`;
}

function transformDashboard(parsed: any, stats: SoldStats): any {
  const { totalRevenue, totalProfit, avgMarginPct } = stats;
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    kpis: (parsed?.kpis || []).slice(0, 10).map((k: any) => ({
      name: ['revenue', 'profit', 'margin_pct', 'items_sold', 'avg_days_to_sell', 'conversion_rate', 'avg_sell_price', 'profit_per_item', 'holding_cost', 'roi'].includes(String(k?.name)) ? String(k.name) : 'revenue',
      currentValue: Math.round(Number(k?.current_value ?? 0) * 100) / 100, previousValue: Math.round(Number(k?.previous_value ?? 0) * 100) / 100,
      changePct: Math.round(Number(k?.change_pct ?? 0) * 10) / 10, trend: ['up', 'down', 'flat'].includes(String(k?.trend)) ? String(k.trend) : 'flat',
      target: Math.round(Number(k?.target ?? 0) * 100) / 100, status: ['above_target', 'on_track', 'below_target', 'critical'].includes(String(k?.status)) ? String(k.status) : 'on_track',
      description: String(k?.description ?? '').slice(0, 200),
    })),
    insightsList: (parsed?.insights_list || []).slice(0, 8).map((i: any) => ({
      type: ['trend', 'anomaly', 'opportunity', 'warning', 'info'].includes(String(i?.type)) ? String(i.type) : 'info',
      severity: ['high', 'medium', 'low'].includes(String(i?.severity)) ? String(i.severity) : 'medium',
      title: String(i?.title ?? '').slice(0, 150), description: String(i?.description ?? '').slice(0, 400),
      actionable: String(i?.actionable ?? '').slice(0, 300), impactEur: Math.round(Number(i?.impact_eur ?? 0)),
    })),
    trends: (parsed?.trends || []).slice(0, 6).map((t: any) => ({
      metric: ['revenue', 'profit', 'margin', 'sales_volume', 'days_to_sell', 'conversion'].includes(String(t?.metric)) ? String(t.metric) : 'revenue',
      trendDirection: ['rising', 'falling', 'stable', 'volatile'].includes(String(t?.trend_direction)) ? String(t.trend_direction) : 'stable',
      trendStrength: Math.max(0, Math.min(100, Number(t?.trend_strength ?? 50))), prediction30d: Math.round(Number(t?.prediction_30d ?? 0) * 100) / 100,
      confidencePct: Math.max(0, Math.min(100, Number(t?.confidence_pct ?? 50))), drivers: (t?.drivers || []).slice(0, 4).map((d: any) => String(d).slice(0, 150)),
    })),
    topPerformers: (parsed?.topPerformers || []).slice(0, 10).map((p: any) => ({
      rank: Math.max(1, Number(p?.rank ?? 1)), tradeId: String(p?.trade_id ?? '').slice(0, 50), title: String(p?.title ?? '').slice(0, 100),
      category: String(p?.category ?? '').slice(0, 50), profitEur: Math.round(Number(p?.profit_eur ?? 0)),
      marginPct: Math.round(Number(p?.margin_pct ?? 0) * 10) / 10, daysToSell: Math.max(0, Number(p?.days_to_sell ?? 0)),
      performanceScore: Math.max(0, Math.min(100, Number(p?.performance_score ?? 50))), keySuccessFactor: String(p?.key_success_factor ?? '').slice(0, 200),
    })),
    alerts: (parsed?.alerts || []).slice(0, 6).map((a: any) => ({
      type: ['low_margin', 'slow_moving', 'overstocked', 'underperforming', 'price_drop', 'market_shift'].includes(String(a?.type)) ? String(a.type) : 'underperforming',
      severity: ['info', 'warning', 'critical'].includes(String(a?.severity)) ? String(a.severity) : 'warning',
      description: String(a?.description ?? '').slice(0, 300), affectedCount: Math.max(0, Number(a?.affected_count ?? 0)),
      financialImpactEur: Math.round(Number(a?.financial_impact_eur ?? 0)), recommendedAction: String(a?.recommended_action ?? '').slice(0, 300),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300), priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      kpiAffected: String(r?.kpi_affected ?? '').slice(0, 50), expectedImpactEur: Math.round(Number(r?.expected_impact_eur ?? 0)),
      implementationEffort: ['low', 'medium', 'high'].includes(String(r?.implementation_effort)) ? String(r.implementation_effort) : 'medium',
      timeframeDays: Math.max(1, Number(r?.timeframe_days ?? 7)),
    })),
    summary: {
      overallHealthScore: Math.max(0, Math.min(100, Number(parsed?.summary?.overall_health_score ?? 60))),
      healthGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.health_grade)) ? String(parsed.summary.health_grade) : 'C',
      trend: ['improving', 'stable', 'declining'].includes(String(parsed?.summary?.trend)) ? String(parsed.summary.trend) : 'stable',
      totalRevenueEur: Math.round(Number(parsed?.summary?.total_revenue_eur ?? totalRevenue)),
      totalProfitEur: Math.round(Number(parsed?.summary?.total_profit_eur ?? totalProfit)),
      avgMarginPct: Math.round(Number(parsed?.summary?.avg_margin_pct ?? avgMarginPct) * 10) / 10,
      biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 200),
      biggestThreat: String(parsed?.summary?.biggest_threat ?? '').slice(0, 200),
      quickestWin: String(parsed?.summary?.quickest_win ?? '').slice(0, 200),
      dashboardScore: Math.max(0, Math.min(100, Number(parsed?.summary?.dashboard_score ?? 60))),
    },
  };
}
