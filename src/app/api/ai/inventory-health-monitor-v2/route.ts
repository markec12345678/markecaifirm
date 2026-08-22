// v6.59 / v8.96.2-batch4: AI Inventory Health Monitor v2 — real-time health z ML anomaly detection in predictive alerts
// Refaktoriran z withAiRoute helperjem (v8.96.2) + enforceBudget guard.
//
// POST /api/ai/inventory-health-monitor-v2
// Body: { days?: number, includePredictions?: boolean }
// Returns: { ok, monitor: { overall, categories, items, alerts, predictiveWarnings, recommendations, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const HEALTH_METRICS = [
  'turnover_rate',
  'aging_score',
  'profitability',
  'liquidity',
  'diversification',
  'risk_exposure',
  'capital_efficiency',
  'market_alignment',
] as const;

const ALERT_SEVERITIES = ['info', 'warning', 'critical', 'emergency'] as const;

interface InventoryHealthMonitorInput {
  days: number;
  includePredictions: boolean;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: { aiEstimatedValue: number | null; dealScore: number | null; aiRisk: number | null; location: string | null } | null;
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

interface SoldTradePrevRow {
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  buyDate: Date;
}

interface CatAgg {
  heldCount: number;
  soldCount: number;
  revenue: number;
  profit: number;
}

interface HealthMetrics {
  totalInvested: number;
  totalValue: number;
  totalItems: number;
  avgDaysHeld: number;
  staleItems: number;
  criticalItems: number;
  deadItems: number;
  currentRevenue: number;
  currentCost: number;
  currentProfit: number;
  currentMarginPct: number;
  prevRevenue: number;
  catMap: Map<string, CatAgg>;
  soldTradesCurrentCount: number;
}

export const POST = withAiRoute<InventoryHealthMonitorInput>({
  endpoint: '/api/ai/inventory-health-monitor-v2',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      days: Math.max(7, Math.min(365, Number(body?.days ?? 30))),
      includePredictions: Boolean(body?.includePredictions ?? true),
    };
  },

  // No validateInput — days has clamping default
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { days, includePredictions } = input;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sincePrev = new Date(Date.now() - days * 2 * 24 * 60 * 60 * 1000);

    // Held inventory
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true, location: true } } },
      take: 100,
    });

    // Sold trades za metrics
    const soldTradesCurrent = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since, not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 300,
    });

    const soldTradesPrev = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: sincePrev, lt: since, not: null } },
      select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 300,
    });

    if (heldTrades.length === 0 && soldTradesCurrent.length === 0) {
      return apiOk({ ok: true, monitor: null, message: 'Ni podatkov za health monitoring.' });
    }

    const now = Date.now();
    const m = computeHealthMetrics(heldTrades, soldTradesCurrent, soldTradesPrev, now);

    const prompt = buildPrompt(m, days);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const monitor = transformMonitor(parsed, heldTrades, m, now, includePredictions);

    return apiOk({ ok: true, monitor });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function computeHealthMetrics(
  heldTrades: HeldTradeRow[],
  soldTradesCurrent: SoldTradeRow[],
  soldTradesPrev: SoldTradePrevRow[],
  now: number
): HealthMetrics {
  const totalInvested = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
  const totalValue = heldTrades.reduce((s, t) => s + (t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25)), 0);
  const totalItems = heldTrades.length;
  const avgDaysHeld = totalItems > 0 ? Math.round(heldTrades.reduce((s, t) => s + Math.round((now - t.buyDate.getTime()) / (24*60*60*1000)), 0) / totalItems) : 0;
  const staleItems = heldTrades.filter(t => Math.round((now - t.buyDate.getTime()) / (24*60*60*1000)) > 30).length;
  const criticalItems = heldTrades.filter(t => Math.round((now - t.buyDate.getTime()) / (24*60*60*1000)) > 90).length;
  const deadItems = heldTrades.filter(t => Math.round((now - t.buyDate.getTime()) / (24*60*60*1000)) > 180).length;

  // Sold metrics
  const currentRevenue = soldTradesCurrent.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
  const currentCost = soldTradesCurrent.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
  const currentProfit = currentRevenue - currentCost;
  const currentMarginPct = currentCost > 0 ? Math.round((currentProfit / currentCost) * 1000) / 10 : 0;
  const prevRevenue = soldTradesPrev.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);

  // Category breakdown
  const catMap = new Map<string, CatAgg>();
  for (const t of heldTrades) {
    const cat = (t.category || 'drugo').toLowerCase();
    if (!catMap.has(cat)) catMap.set(cat, { heldCount: 0, soldCount: 0, revenue: 0, profit: 0 });
    catMap.get(cat)!.heldCount += 1;
  }
  for (const t of soldTradesCurrent) {
    const cat = (t.category || 'drugo').toLowerCase();
    if (!catMap.has(cat)) catMap.set(cat, { heldCount: 0, soldCount: 0, revenue: 0, profit: 0 });
    const c = catMap.get(cat)!;
    c.soldCount += 1;
    c.revenue += (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    c.profit += ((t.sellPrice ?? 0) - (t.sellFees ?? 0)) - (t.buyPrice + (t.buyFees ?? 0));
  }

  return {
    totalInvested,
    totalValue,
    totalItems,
    avgDaysHeld,
    staleItems,
    criticalItems,
    deadItems,
    currentRevenue,
    currentCost,
    currentProfit,
    currentMarginPct,
    prevRevenue,
    catMap,
    soldTradesCurrentCount: soldTradesCurrent.length,
  };
}

function buildPrompt(m: HealthMetrics, days: number): string {
  const catStr = Array.from(m.catMap.entries()).slice(0, 8).map(([cat, c]) =>
    `- ${cat}: ${c.heldCount} held, ${c.soldCount} sold, ${Math.round(c.revenue)}€ revenue, ${Math.round(c.profit)}€ profit`
  ).join('\n');

  return `Si AI inventory health monitor v2 z ML anomaly detection in predictive alerts.
Real-time health monitoring z 8-metric scoring in predictive warnings.

TRENUTNO STANJE:
- Held items: ${m.totalItems} (skupna vrednost ${m.totalValue}€, investirano ${m.totalInvested}€)
- Povp dni v skladišču: ${m.avgDaysHeld}
- Stale (>30d): ${m.staleItems}, Critical (>90d): ${m.criticalItems}, Dead (>180d): ${m.deadItems}

PERFORMANCE (zadnji ${days} dni):
- Prodano: ${m.soldTradesCurrentCount} itemov
- Prihodek: ${Math.round(m.currentRevenue)}€
- Dobiček: ${Math.round(m.currentProfit)}€ (marža ${m.currentMarginPct}%)
- Prejšnje obdobje prihodek: ${Math.round(m.prevRevenue)}€

KATEGORIJE:
${catStr}

8 health metrik:
1. TURNOVER_RATE: kako hitro se zavrti inventar (sold/held ratio)
2. AGING_SCORE: kako svež je inventar (manj stale = višji score)
3. PROFITABILITY: marža in profitabilnost
4. LIQUIDITY: kako hitro se da pretvoriti v cash
5. DIVERSIFICATION: porazdelitev prek kategorij
6. RISK_EXPOSURE: tveganje izgube (dead inventory, low margin)
7. CAPITAL_EFFICIENCY: ROI na vložen kapital
8. MARKET_ALIGNMENT: ali inventar ustreza trenutnemu povpraševanju

Alert tipi:
- STALE_INVENTORY: items > 30d v skladišču
- DEAD_INVENTORY: items > 180d
- LOW_MARGIN: kategorija z margin < 10%
- OVER_CONCENTRATION: > 30% v eni kategoriji
- CAPITAL_TIED: preveč kapitala v nizko-likvidnem inventarju
- DEMAND_MISMATCH: items z nizkim povpraševanjem
- RISK_SPIKE: nenadno povečanje tveganja
- PERFORMANCE_DROP: padec profitabilnosti

Predictive warnings (ML):
- PREDICTED_STALE: items ki bodo postale stale v 14d
- PREDICTED_LOSS: items ki bodo povzročile izgubo
- PREDICTED_DEAD: items ki bodo dead v 30d
- PREDICTED_CASHFLOW_ISSUE: napoved cashflow problema
- PREDICTED_OVERSTOCK: preveč itemov v kategoriji

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overall": {
    "health_score": <number 0-100>,
    "health_grade": "<A|B|C|D|F>",
    "trend": "<improving|stable|declining>",
    "trend_change_pct": <number>,
    "critical_issues_count": <number>,
    "last_assessment": "<YYYY-MM-DD>",
    "next_checkup_recommended": "<YYYY-MM-DD>"
  },
  "categories": [
    {
      "metrics": {
        "turnover_rate": <number 0-100>,
        "aging_score": <number 0-100>,
        "profitability": <number 0-100>,
        "liquidity": <number 0-100>,
        "diversification": <number 0-100>,
        "risk_exposure": <number 0-100>,
        "capital_efficiency": <number 0-100>,
        "market_alignment": <number 0-100>
      },
      "metric_status": [
        {"metric": "<8 metrik>", "score": <number 0-100>, "status": "<excellent|good|average|poor|critical>", "trend": "<up|down|stable>", "benchmark": <number>, "gap_pct": <number>}
      ]
    }
  ],
  "categories": [
    {
      "category": "<kategorija>",
      "health_score": <number 0-100>,
      "held_count": <number>,
      "sold_count": <number>,
      "revenue_eur": <number>,
      "profit_eur": <number>,
      "margin_pct": <number>,
      "issues": ["<max 80 znakov>"],
      "recommended_action": "<max 120 znakov>"
    }
  ],
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "health_status": "<healthy|warning|critical|dead>",
      "days_held": <number>,
      "holding_cost_eur": <number>,
      "predicted_status_30d": "<sold|stale|critical|dead>",
      "recommended_action": "<hold|refresh|price_drop|bundle|liquidate|write_off>",
      "urgency_score": <number 0-100>
    }
  ],
  "alerts": [
    {
      "type": "<stale_inventory|dead_inventory|low_margin|over_concentration|capital_tied|demand_mismatch|risk_spike|performance_drop>",
      "severity": "<info|warning|critical|emergency>",
      "category": "<kategorija ali all>",
      "description": "<max 150 znakov>",
      "affected_items": <number>,
      "financial_impact_eur": <number>,
      "recommended_action": "<max 150 znakov>",
      "time_sensitivity": "<immediate|24h|7d|30d>"
    }
  ],
  "predictive_warnings": [
    {
      "warning_type": "<predicted_stale|predicted_loss|predicted_dead|predicted_cashflow_issue|predicted_overstock>",
      "probability_pct": <number 0-100>,
      "timeframe_days": <number>,
      "affected_items": <number>,
      "predicted_impact_eur": <number>,
      "prevention_action": "<max 150 znakov>",
      "ml_confidence_pct": <number 0-100>
    }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "metric_improved": "<8 metrik>", "expected_impact_eur": <number>, "implementation_days": <number> }
  ],
  "summary": {
    "total_items_monitored": <number>,
    "total_inventory_value_eur": <number>,
    "total_invested_eur": <number>,
    "total_unrealized_profit_eur": <number>,
    "healthy_items_count": <number>,
    "warning_items_count": <number>,
    "critical_items_count": <number>,
    "dead_items_count": <number>,
    "total_alerts": <number>,
    "critical_alerts": <number>,
    "total_predicted_warnings": <number>,
    "biggest_health_threat": "<max 100 znakov>",
    "biggest_improvement_opportunity": "<max 100 znakov>",
    "inventory_health_score": <number 0-100>
  }
}`;
}

function transformMonitor(
  parsed: any,
  heldTrades: HeldTradeRow[],
  m: HealthMetrics,
  now: number,
  includePredictions: boolean
): {
  insights: string;
  overall: any;
  categories: any[];
  items: any[];
  alerts: any[];
  predictiveWarnings: any[];
  recommendations: any[];
  summary: any;
} {
  const validIds = new Set(heldTrades.map(t => t.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    overall: {
      healthScore: Math.max(0, Math.min(100, Number(parsed?.overall?.health_score ?? 60))),
      healthGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overall?.health_grade)) ? String(parsed.overall.health_grade) : 'C',
      trend: ['improving', 'stable', 'declining'].includes(String(parsed?.overall?.trend)) ? String(parsed.overall.trend) : 'stable',
      trendChangePct: Math.round(Number(parsed?.overall?.trend_change_pct ?? 0) * 10) / 10,
      criticalIssuesCount: Math.max(0, Number(parsed?.overall?.critical_issues_count ?? 0)),
      lastAssessment: String(parsed?.overall?.last_assessment ?? new Date().toISOString().slice(0, 10)).slice(0, 20),
      nextCheckupRecommended: String(parsed?.overall?.next_checkup_recommended ?? '').slice(0, 20),
    },
    categories: (parsed?.categories || []).slice(0, 8).map((c: any) => {
      const orig = Array.from(m.catMap.entries()).find(([cat]) => cat === String(c?.category));
      return {
        category: String(c?.category ?? '').slice(0, 50),
        healthScore: Math.max(0, Math.min(100, Number(c?.health_score ?? 50))),
        heldCount: Math.max(0, Number(c?.held_count ?? orig?.[1].heldCount ?? 0)),
        soldCount: Math.max(0, Number(c?.sold_count ?? orig?.[1].soldCount ?? 0)),
        revenueEur: Math.round(Number(c?.revenue_eur ?? orig?.[1].revenue ?? 0)),
        profitEur: Math.round(Number(c?.profit_eur ?? orig?.[1].profit ?? 0)),
        marginPct: Math.round(Number(c?.margin_pct ?? 0) * 10) / 10,
        issues: (c?.issues || []).slice(0, 4).map((i: any) => String(i).slice(0, 150)),
        recommendedAction: String(c?.recommended_action ?? '').slice(0, 250),
      };
    }),
    items: (parsed?.items || [])
      .filter((it: any) => validIds.has(String(it?.id ?? '')))
      .slice(0, 30)
      .map((it: any) => {
        const orig = heldTrades.find(t => t.id === String(it?.id));
        const daysHeld = orig ? Math.round((now - orig.buyDate.getTime()) / (24*60*60*1000)) : 0;
        return {
          tradeId: String(it?.id ?? ''),
          title: String(it?.title ?? orig?.title ?? '').slice(0, 100),
          healthStatus: ['healthy', 'warning', 'critical', 'dead'].includes(String(it?.health_status)) ? String(it.health_status) : 'healthy',
          daysHeld: Math.max(0, Number(it?.days_held ?? daysHeld)),
          holdingCostEur: Math.round(Number(it?.holding_cost_eur ?? 0)),
          predictedStatus30d: ['sold', 'stale', 'critical', 'dead'].includes(String(it?.predicted_status_30d)) ? String(it.predicted_status_30d) : 'stale',
          recommendedAction: ['hold', 'refresh', 'price_drop', 'bundle', 'liquidate', 'write_off'].includes(String(it?.recommended_action)) ? String(it.recommended_action) : 'hold',
          urgencyScore: Math.max(0, Math.min(100, Number(it?.urgency_score ?? 30))),
        };
      }),
    alerts: (parsed?.alerts || []).slice(0, 8).map((a: any) => ({
      type: ['stale_inventory', 'dead_inventory', 'low_margin', 'over_concentration', 'capital_tied', 'demand_mismatch', 'risk_spike', 'performance_drop'].includes(String(a?.type)) ? String(a.type) : 'stale_inventory',
      severity: ALERT_SEVERITIES.includes(String(a?.severity) as any) ? String(a.severity) : 'warning',
      category: String(a?.category ?? 'all').slice(0, 50),
      description: String(a?.description ?? '').slice(0, 300),
      affectedItems: Math.max(0, Number(a?.affected_items ?? 0)),
      financialImpactEur: Math.round(Number(a?.financial_impact_eur ?? 0)),
      recommendedAction: String(a?.recommended_action ?? '').slice(0, 300),
      timeSensitivity: ['immediate', '24h', '7d', '30d'].includes(String(a?.time_sensitivity)) ? String(a.time_sensitivity) : '7d',
    })),
    predictiveWarnings: includePredictions ? (parsed?.predictive_warnings || []).slice(0, 6).map((w: any) => ({
      warningType: ['predicted_stale', 'predicted_loss', 'predicted_dead', 'predicted_cashflow_issue', 'predicted_overstock'].includes(String(w?.warning_type)) ? String(w.warning_type) : 'predicted_stale',
      probabilityPct: Math.max(0, Math.min(100, Number(w?.probability_pct ?? 50))),
      timeframeDays: Math.max(1, Number(w?.timeframe_days ?? 14)),
      affectedItems: Math.max(0, Number(w?.affected_items ?? 0)),
      predictedImpactEur: Math.round(Number(w?.predicted_impact_eur ?? 0)),
      preventionAction: String(w?.prevention_action ?? '').slice(0, 300),
      mlConfidencePct: Math.max(0, Math.min(100, Number(w?.ml_confidence_pct ?? 60))),
    })) : [],
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      metricImproved: HEALTH_METRICS.includes(String(r?.metric_improved) as any) ? String(r.metric_improved) : 'turnover_rate',
      expectedImpactEur: Math.round(Number(r?.expected_impact_eur ?? 0)),
      implementationDays: Math.max(1, Number(r?.implementation_days ?? 1)),
    })),
    summary: {
      totalItemsMonitored: m.totalItems,
      totalInventoryValueEur: Math.round(Number(parsed?.summary?.total_inventory_value_eur ?? m.totalValue)),
      totalInvestedEur: Math.round(Number(parsed?.summary?.total_invested_eur ?? m.totalInvested)),
      totalUnrealizedProfitEur: Math.round(Number(parsed?.summary?.total_unrealized_profit_eur ?? m.totalValue - m.totalInvested)),
      healthyItemsCount: Math.max(0, Number(parsed?.summary?.healthy_items_count ?? m.totalItems - m.staleItems)),
      warningItemsCount: Math.max(0, Number(parsed?.summary?.warning_items_count ?? m.staleItems - m.criticalItems)),
      criticalItemsCount: Math.max(0, Number(parsed?.summary?.critical_items_count ?? m.criticalItems - m.deadItems)),
      deadItemsCount: Math.max(0, Number(parsed?.summary?.dead_items_count ?? m.deadItems)),
      totalAlerts: Math.max(0, Number(parsed?.summary?.total_alerts ?? 0)),
      criticalAlerts: Math.max(0, Number(parsed?.summary?.critical_alerts ?? 0)),
      totalPredictedWarnings: Math.max(0, Number(parsed?.summary?.total_predicted_warnings ?? 0)),
      biggestHealthThreat: String(parsed?.summary?.biggest_health_threat ?? '').slice(0, 200),
      biggestImprovementOpportunity: String(parsed?.summary?.biggest_improvement_opportunity ?? '').slice(0, 200),
      inventoryHealthScore: Math.max(0, Math.min(100, Number(parsed?.summary?.inventory_health_score ?? 60))),
    },
  };
}
