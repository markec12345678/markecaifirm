// v6.40 MILESTONE / v8.96.0-batch4: AI Master Dashboard — unified view vseh 160+ AI funkcij v eno
// Refaktoriran z withAiRoute helperjem (v8.96) + enforceBudget guard.
//
// POST /api/ai/master-dashboard
// Body: {}
// Returns: { ok, master: { executive, financial, inventory, market, risk, automation, ai, actions } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface MasterDashboardInput {}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: { aiEstimatedValue: number | null; dealScore: number | null; aiRisk: number | null } | null;
}

interface SoldTradeRow {
  category: string;
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  buyDate: Date;
  sellDate: Date | null;
  buyLocation: string | null;
  sellLocation: string | null;
}

interface RecentListingRow {
  price: number | null;
  aiVerdict: string | null;
  dealScore: number | null;
  monitor: { source: string | null } | null;
}

interface MonitorRow {
  id: string;
  name: string;
  source: string;
  intervalMinutes: number;
  lastStatus: string | null;
}

interface KpiData {
  totalRealized: number;
  totalRevenue: number;
  totalInvestedHeld: number;
  heldCount: number;
  currentCash: number;
  avgRoi: number;
  avgDaysToSell: number;
  successRate: number;
  stalled: number;
  highRisk: number;
  opportunities: number;
  monitorCount: number;
  categoryCount: number;
  recentListingsCount: number;
}

export const POST = withAiRoute<MasterDashboardInput>({
  endpoint: '/api/ai/master-dashboard',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — body je ignored
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    const [heldTrades, soldTrades, recentListings, monitors] = await Promise.all([
      db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true } } }, take: 100 }),
      db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } }, select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, buyDate: true, sellDate: true, buyLocation: true, sellLocation: true }, take: 500 }),
      db.listing.findMany({ where: { isHidden: false, firstSeenAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }, select: { price: true, aiVerdict: true, dealScore: true, monitor: { select: { source: true } } }, take: 500 }),
      db.monitor.findMany({ where: { isActive: true }, select: { id: true, name: true, source: true, intervalMinutes: true, lastStatus: true }, take: 30 }),
    ]);

    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return apiOk({ ok: true, master: null, message: 'Ni podatkov za master dashboard.' });
    }

    const kpi = computeKpi(heldTrades as HeldTradeRow[], soldTrades as SoldTradeRow[], recentListings as RecentListingRow[], monitors as MonitorRow[]);

    const prompt = buildPrompt(kpi);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const master = transformMaster(parsed, kpi);

    return apiOk({ ok: true, master, version: 'v6.40.0 MILESTONE' });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function computeKpi(
  heldTrades: HeldTradeRow[],
  soldTrades: SoldTradeRow[],
  recentListings: RecentListingRow[],
  monitors: MonitorRow[]
): KpiData {
  const totalInvestedHeld = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
  const totalRealized = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0), 0);
  const totalRevenue = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0), 0);
  const avgRoi = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => { const c = t.buyPrice + (t.buyFees ?? 0); return s + (c > 0 ? (((t.sellPrice ?? 0) - (t.sellFees ?? 0) - c) / c) * 100 : 0); }, 0) / soldTrades.length) : 0;
  const avgDaysToSell = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => { if (t.sellDate && t.buyDate) return s + (t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000); return s; }, 0) / soldTrades.length) : 0;
  const successRate = soldTrades.length > 0 ? Math.round(soldTrades.filter(t => (t.sellPrice ?? 0) - (t.sellFees ?? 0) > t.buyPrice + (t.buyFees ?? 0)).length / soldTrades.length * 100) : 0;
  const stalled = heldTrades.filter(t => Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)) > 30).length;
  const opportunities = recentListings.filter(l => l.aiVerdict === 'PRILIKA' || (l.dealScore ?? 0) >= 70).length;
  const highRisk = heldTrades.filter(t => (t.listing?.aiRisk ?? 0) >= 7).length;
  const categories = new Set(heldTrades.map(t => t.category || 'drugo')).size;
  const currentCash = totalRevenue - soldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0) - totalInvestedHeld;

  return {
    totalRealized,
    totalRevenue,
    totalInvestedHeld,
    heldCount: heldTrades.length,
    currentCash,
    avgRoi,
    avgDaysToSell,
    successRate,
    stalled,
    highRisk,
    opportunities,
    monitorCount: monitors.length,
    categoryCount: categories,
    recentListingsCount: recentListings.length,
  };
}

function buildPrompt(k: KpiData): string {
  return `Si vrhovni AI poslovni svetovalec — MASTER DASHBOARD za vso preprodajno operacijo.
Ustvari celovit executive summary z vsemi ključnimi metrikami, ki jih potrebuje lastnik za odločanje.

EXECUTIVE KPI-ji:
- Realizirani dobiček: ${Math.round(k.totalRealized)}€
- Vezano v inventarju: ${Math.round(k.totalInvestedHeld)}€ (${k.heldCount} itemov)
- Trenutni cash: ${Math.round(k.currentCash)}€
- Povp. ROI: ${k.avgRoi}%
- Povp. čas do prodaje: ${k.avgDaysToSell}d
- Success rate: ${k.successRate}%
- Stalled (>30d): ${k.stalled}
- High risk: ${k.highRisk}
- Nove priložnosti (7d): ${k.opportunities}
- Aktivni monitorji: ${k.monitorCount}
- Kategorij: ${k.categoryCount}

Ustvari dashboard z 8 sekcijami:
1. EXECUTIVE: one-glance summary (health score, trend, top priority)
2. FINANCIAL: profit, ROI, cash flow, margin, projections
3. INVENTORY: health, aging, turnover, stalled, dead
4. MARKET: opportunities, saturation, trends, competition
5. RISK: concentration, high-risk items, margin erosion, stockout
6. AUTOMATION: monitor status, alert efficiency, time saved
7. AI: model accuracy, learning progress, recommendation quality
8. ACTIONS: top 5 prioritized actions z impact

Odgovori LE z JSON:
{
  "executive": {
    "health_score": <number 0-100>,
    "health_grade": "<A+|A|B+|B|C|D|F>",
    "trend": "<improving|stable|declining>",
    "top_priority": "<max 100 znakov>",
    "one_line_summary": "<max 150 znakov>",
    "profit_trend": "<up|flat|down>"
  },
  "financial": {
    "realized_profit_eur": <number>,
    "unrealized_profit_eur": <number>,
    "total_revenue_eur": <number>,
    "avg_roi_pct": <number>,
    "avg_margin_pct": <number>,
    "cash_available_eur": <number>,
    "invested_eur": <number>,
    "projected_30d_profit_eur": <number>,
    "projected_90d_profit_eur": <number>
  },
  "inventory": {
    "total_items": <number>,
    "total_value_eur": <number>,
    "healthy_items": <number>,
    "stalled_items": <number>,
    "dead_items": <number>,
    "avg_age_days": <number>,
    "turnover_ratio": <number>,
    "diversification_score": <number 0-100>
  },
  "market": {
    "active_opportunities": <number>,
    "opportunity_rate_pct": <number>,
    "market_saturation": "<low|medium|high>",
    "hottest_category": "<max 50 znakov>",
    "best_source": "<max 50 znakov>",
    "competition_level": "<low|medium|high>"
  },
  "risk": {
    "risk_score": <number 0-100>,
    "concentration_risk": "<low|medium|high>",
    "high_risk_items": <number>,
    "margin_at_risk_eur": <number>,
    "stockout_risks": <number>,
    "biggest_threat": "<max 80 znakov>"
  },
  "automation": {
    "active_monitors": <number>,
    "automation_level": "<advisory|semi_auto|full_auto>",
    "alerts_per_week": <number>,
    "time_saved_hours_week": <number>,
    "missed_opportunities_pct": <number>
  },
  "ai": {
    "ai_score_accuracy_pct": <number>,
    "deal_score_accuracy_pct": <number>,
    "est_value_accuracy_pct": <number>,
    "overall_ai_accuracy_pct": <number>,
    "ai_learning_trend": "<improving|stable|declining>",
    "recommendations_followed_pct": <number>
  },
  "actions": [
    { "action": "<max 120 znakov>", "priority": "<critical|high|medium|low>", "impact_eur": <number>, "deadline_days": <number>, "category": "<financial|inventory|market|risk|automation>" }
  ],
  "master_summary": "<max 300 znakov — one paragraph executive summary>"
}`;
}

function transformMaster(parsed: any, k: KpiData) {
  return {
    executive: {
      healthScore: Math.max(0, Math.min(100, Number(parsed?.executive?.health_score ?? 50))),
      healthGrade: ['A+', 'A', 'B+', 'B', 'C', 'D', 'F'].includes(String(parsed?.executive?.health_grade)) ? String(parsed.executive.health_grade) : 'C',
      trend: ['improving', 'stable', 'declining'].includes(String(parsed?.executive?.trend)) ? String(parsed.executive.trend) : 'stable',
      topPriority: String(parsed?.executive?.top_priority ?? '').slice(0, 200),
      oneLineSummary: String(parsed?.executive?.one_line_summary ?? '').slice(0, 300),
      profitTrend: ['up', 'flat', 'down'].includes(String(parsed?.executive?.profit_trend)) ? String(parsed.executive.profit_trend) : 'flat',
    },
    financial: {
      realizedProfitEur: Math.round(Number(parsed?.financial?.realized_profit_eur ?? k.totalRealized)),
      unrealizedProfitEur: Math.round(Number(parsed?.financial?.unrealized_profit_eur ?? 0)),
      totalRevenueEur: Math.round(Number(parsed?.financial?.total_revenue_eur ?? k.totalRevenue)),
      avgRoiPct: Math.round(Number(parsed?.financial?.avg_roi_pct ?? k.avgRoi)),
      avgMarginPct: Math.round(Number(parsed?.financial?.avg_margin_pct ?? 0)),
      cashAvailableEur: Math.round(Number(parsed?.financial?.cash_available_eur ?? k.currentCash)),
      investedEur: Math.round(Number(parsed?.financial?.invested_eur ?? k.totalInvestedHeld)),
      projected30dProfitEur: Math.round(Number(parsed?.financial?.projected_30d_profit_eur ?? 0)),
      projected90dProfitEur: Math.round(Number(parsed?.financial?.projected_90d_profit_eur ?? 0)),
    },
    inventory: {
      totalItems: k.heldCount,
      totalValueEur: Math.round(k.totalInvestedHeld),
      healthyItems: Math.max(0, Number(parsed?.inventory?.healthy_items ?? 0)),
      stalledItems: k.stalled,
      deadItems: Math.max(0, Number(parsed?.inventory?.dead_items ?? 0)),
      avgAgeDays: Math.max(0, Number(parsed?.inventory?.avg_age_days ?? 0)),
      turnoverRatio: Math.round(Number(parsed?.inventory?.turnover_ratio ?? 0) * 100) / 100,
      diversificationScore: Math.max(0, Math.min(100, Number(parsed?.inventory?.diversification_score ?? 50))),
    },
    market: {
      activeOpportunities: k.opportunities,
      opportunityRatePct: k.recentListingsCount > 0 ? Math.round((k.opportunities / k.recentListingsCount) * 100) : 0,
      marketSaturation: ['low', 'medium', 'high'].includes(String(parsed?.market?.market_saturation)) ? String(parsed.market.market_saturation) : 'medium',
      hottestCategory: String(parsed?.market?.hottest_category ?? '').slice(0, 80),
      bestSource: String(parsed?.market?.best_source ?? '').slice(0, 80),
      competitionLevel: ['low', 'medium', 'high'].includes(String(parsed?.market?.competition_level)) ? String(parsed.market.competition_level) : 'medium',
    },
    risk: {
      riskScore: Math.max(0, Math.min(100, Number(parsed?.risk?.risk_score ?? 50))),
      concentrationRisk: ['low', 'medium', 'high'].includes(String(parsed?.risk?.concentration_risk)) ? String(parsed.risk.concentration_risk) : 'medium',
      highRiskItems: k.highRisk,
      marginAtRiskEur: Math.round(Number(parsed?.risk?.margin_at_risk_eur ?? 0)),
      stockoutRisks: Math.max(0, Number(parsed?.risk?.stockout_risks ?? 0)),
      biggestThreat: String(parsed?.risk?.biggest_threat ?? '').slice(0, 150),
    },
    automation: {
      activeMonitors: k.monitorCount,
      automationLevel: ['advisory', 'semi_auto', 'full_auto'].includes(String(parsed?.automation?.automation_level)) ? String(parsed.automation.automation_level) : 'advisory',
      alertsPerWeek: Math.max(0, Number(parsed?.automation?.alerts_per_week ?? 0)),
      timeSavedHoursWeek: Math.max(0, Number(parsed?.automation?.time_saved_hours_week ?? 0)),
      missedOpportunitiesPct: Math.max(0, Math.min(100, Number(parsed?.automation?.missed_opportunities_pct ?? 0))),
    },
    ai: {
      aiScoreAccuracyPct: Math.max(0, Math.min(100, Number(parsed?.ai?.ai_score_accuracy_pct ?? 0))),
      dealScoreAccuracyPct: Math.max(0, Math.min(100, Number(parsed?.ai?.deal_score_accuracy_pct ?? 0))),
      estValueAccuracyPct: Math.max(0, Math.min(100, Number(parsed?.ai?.est_value_accuracy_pct ?? 0))),
      overallAiAccuracyPct: Math.max(0, Math.min(100, Number(parsed?.ai?.overall_ai_accuracy_pct ?? 0))),
      aiLearningTrend: ['improving', 'stable', 'declining'].includes(String(parsed?.ai?.ai_learning_trend)) ? String(parsed.ai.ai_learning_trend) : 'stable',
      recommendationsFollowedPct: Math.max(0, Math.min(100, Number(parsed?.ai?.recommendations_followed_pct ?? 0))),
    },
    actions: (parsed?.actions || []).slice(0, 8).map((a: any) => ({
      action: String(a?.action ?? '').slice(0, 250),
      priority: ['critical', 'high', 'medium', 'low'].includes(String(a?.priority)) ? String(a.priority) : 'medium',
      impactEur: Math.round(Number(a?.impact_eur ?? 0)),
      deadlineDays: Math.max(0, Number(a?.deadline_days ?? 7)),
      category: ['financial', 'inventory', 'market', 'risk', 'automation'].includes(String(a?.category)) ? String(a.category) : 'inventory',
    })),
    masterSummary: String(parsed?.master_summary ?? '').slice(0, 600),
  };
}
