// v6.30 MILESTONE / v8.96.0-batch3: AI Profit Maximization Dashboard — agregira vse AI metrike v eno
// Refaktoriran z withAiRoute helperjem (v8.96) + enforceBudget guard.
//
// POST /api/ai/profit-dashboard
// Body: {}
// Returns: { ok, dashboard: { kpis, portfolio, opportunities, risks, actions, projections } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitDashboardInput {}

export const POST = withAiRoute<ProfitDashboardInput>({
  endpoint: '/api/ai/profit-dashboard',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {} as ProfitDashboardInput;
  },

  // No validateInput — body je ignored
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    // Pridobi VSE podatke za dashboard
    const [heldTrades, soldTrades, recentListings] = await Promise.all([
      db.trade.findMany({
        where: { status: 'held' },
        select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
          listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true } } },
        take: 100,
      }),
      db.trade.findMany({
        where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
        select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true,
          buyDate: true, sellDate: true, buyLocation: true },
        take: 500,
      }),
      db.listing.findMany({
        where: { isHidden: false, firstSeenAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        select: { price: true, aiVerdict: true, dealScore: true,
          monitor: { select: { source: true } } },
        take: 500,
      }),
    ]);

    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return apiOk({ ok: true, dashboard: null, message: 'Ni podatkov za dashboard.' });
    }

    // KPI izračuni
    const totalInvestedHeld = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalRealized = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0), 0);
    const totalRevenue = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0), 0);
    const avgRoi = soldTrades.length > 0
      ? Math.round(soldTrades.reduce((s, t) => {
          const cost = t.buyPrice + (t.buyFees ?? 0);
          return s + (cost > 0 ? (((t.sellPrice ?? 0) - (t.sellFees ?? 0) - cost) / cost) * 100 : 0);
        }, 0) / soldTrades.length) : 0;
    const avgDaysToSell = soldTrades.length > 0
      ? Math.round(soldTrades.reduce((s, t) => {
          if (t.sellDate && t.buyDate) return s + (t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000);
          return s;
        }, 0) / soldTrades.length) : 0;

    // Stalled items
    const stalled = heldTrades.filter(t => {
      const days = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));
      return days > 30;
    });

    // Recent opportunities
    const opportunities = recentListings.filter(l => l.aiVerdict === 'PRILIKA' || (l.dealScore ?? 0) >= 70);
    const opportunityRate = recentListings.length > 0 ? Math.round((opportunities.length / recentListings.length) * 100) : 0;

    // Category breakdown
    const catProfit = computeCategoryProfit(soldTrades);

    const catStr = Object.entries(catProfit).sort(([,a],[,b]) => b - a).slice(0, 8).map(([cat, profit]) => `- ${cat}: ${Math.round(profit)}€`).join('\n');
    const heldStr = heldTrades.slice(0, 15).map(t => `- ${t.title} | ${t.category} | ${Math.round((Date.now()-t.buyDate.getTime())/(24*60*60*1000))}d | ${t.buyPrice}€`).join('\n');

    const prompt = buildPrompt({
      totalRealized, totalInvestedHeld, heldCount: heldTrades.length,
      avgRoi, avgDaysToSell, stalledCount: stalled.length,
      opportunitiesCount: opportunities.length, recentListingsCount: recentListings.length,
      opportunityRate, totalRevenue, catStr, heldStr,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const dashboard = transformDashboard(parsed, {
      totalRealized, totalInvestedHeld, avgRoi, avgDaysToSell,
      stalledCount: stalled.length, opportunitiesCount: opportunities.length,
      opportunityRate, totalRevenue,
    });

    return apiOk({ ok: true, dashboard, version: 'v6.30.0 MILESTONE' });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface SoldTradeRow {
  category: string | null; buyPrice: number; buyFees: number | null;
  sellPrice: number | null; sellFees: number | null;
}

function computeCategoryProfit(soldTrades: SoldTradeRow[]): Record<string, number> {
  const catProfit: Record<string, number> = {};
  for (const t of soldTrades) {
    const cat = t.category || 'drugo';
    catProfit[cat] = (catProfit[cat] ?? 0) + (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
  }
  return catProfit;
}

interface PromptData {
  totalRealized: number;
  totalInvestedHeld: number;
  heldCount: number;
  avgRoi: number;
  avgDaysToSell: number;
  stalledCount: number;
  opportunitiesCount: number;
  recentListingsCount: number;
  opportunityRate: number;
  totalRevenue: number;
  catStr: string;
  heldStr: string;
}

function buildPrompt(d: PromptData): string {
  return `Si vrhovni AI poslovni svetovalec za preprodajo rabljenih dobrin.
Ustvari celovit profit maximization dashboard z vsemi ključnimi metrikami in priporočili.

KPI PODATKI:
- Realizirani dobiček: ${Math.round(d.totalRealized)}€
- Vezano v inventarju: ${Math.round(d.totalInvestedHeld)}€ (${d.heldCount} itemov)
- Povp. ROI: ${d.avgRoi}%
- Povp. čas do prodaje: ${d.avgDaysToSell}d
- Stalled itemi (>30d): ${d.stalledCount}
- Nove priložnosti (7d): ${d.opportunitiesCount} od ${d.recentListingsCount} (${d.opportunityRate}%)
- Skupni prihodek: ${Math.round(d.totalRevenue)}€

DOBIČEK PO KATEGORIJAH:
${d.catStr}

TRENUTNI INVENTAR:
${d.heldStr}

Ustvari dashboard z:
1. KPI summary (8 ključnih metrik)
2. Portfolio health score (0-100)
3. Top 5 priložnosti (kaj kupiti)
4. Top 5 tveganj (kaj prodati/likvidirati)
5. Priporočene akcije (prioritizirane)
6. 3-mesečna projekcija dobička

Odgovori LE z JSON:
{
  "kpis": {
    "realized_profit_eur": <number>,
    "invested_held_eur": <number>,
    "avg_roi_pct": <number>,
    "avg_days_to_sell": <number>,
    "stalled_count": <number>,
    "opportunity_count": <number>,
    "opportunity_rate_pct": <number>,
    "total_revenue_eur": <number>
  },
  "portfolio_health_score": <number 0-100>,
  "portfolio_health_grade": "<A+|A|B+|B|C|D|F>",
  "health_factors": [
    { "factor": "<ime>", "score": <number 0-100>, "status": "<good|warning|critical>", "note": "<max 80 znakov>" }
  ],
  "top_opportunities": [
    { "category": "<kat>", "action": "<kaj kupiti>", "expected_roi_pct": <number>, "urgency": "<high|medium|low>", "source": "<kje>", "reasoning": "<max 80 znakov>" }
  ],
  "top_risks": [
    { "item": "<naslov ali kategorija>", "risk_type": "<stalled|depreciation|low_demand|overconcentrated>", "severity": "<high|medium|low>", "action": "<max 80 znakov>", "potential_loss_eur": <number> }
  ],
  "recommended_actions": [
    { "action": "<max 100 znakov>", "priority": "<critical|high|medium|low>", "expected_impact_eur": <number>, "deadline_days": <number> }
  ],
  "projections": [
    { "month": <number>, "projected_revenue_eur": <number>, "projected_profit_eur": <number>, "projected_invested_eur": <number>, "cash_flow_eur": <number> }
  ],
  "overall_assessment": "<max 300 znakov>"
}`;
}

interface FallbackData {
  totalRealized: number;
  totalInvestedHeld: number;
  avgRoi: number;
  avgDaysToSell: number;
  stalledCount: number;
  opportunitiesCount: number;
  opportunityRate: number;
  totalRevenue: number;
}

function transformDashboard(parsed: any, f: FallbackData): {
  kpis: any;
  portfolioHealthScore: number;
  portfolioHealthGrade: string;
  healthFactors: any[];
  topOpportunities: any[];
  topRisks: any[];
  recommendedActions: any[];
  projections: any[];
  overallAssessment: string;
} {
  return {
    kpis: {
      realizedProfitEur: Math.round(Number(parsed?.kpis?.realized_profit_eur ?? f.totalRealized)),
      investedHeldEur: Math.round(Number(parsed?.kpis?.invested_held_eur ?? f.totalInvestedHeld)),
      avgRoiPct: Math.round(Number(parsed?.kpis?.avg_roi_pct ?? f.avgRoi)),
      avgDaysToSell: Math.round(Number(parsed?.kpis?.avg_days_to_sell ?? f.avgDaysToSell)),
      stalledCount: Math.max(0, Number(parsed?.kpis?.stalled_count ?? f.stalledCount)),
      opportunityCount: Math.max(0, Number(parsed?.kpis?.opportunity_count ?? f.opportunitiesCount)),
      opportunityRatePct: Math.round(Number(parsed?.kpis?.opportunity_rate_pct ?? f.opportunityRate)),
      totalRevenueEur: Math.round(Number(parsed?.kpis?.total_revenue_eur ?? f.totalRevenue)),
    },
    portfolioHealthScore: Math.max(0, Math.min(100, Number(parsed?.portfolio_health_score ?? 50))),
    portfolioHealthGrade: ['A+', 'A', 'B+', 'B', 'C', 'D', 'F'].includes(String(parsed?.portfolio_health_grade)) ? String(parsed.portfolio_health_grade) : 'C',
    healthFactors: (parsed?.health_factors || []).slice(0, 8).map((fa: any) => ({
      factor: String(fa?.factor ?? '').slice(0, 80),
      score: Math.max(0, Math.min(100, Number(fa?.score ?? 50))),
      status: ['good', 'warning', 'critical'].includes(String(fa?.status)) ? String(fa.status) : 'good',
      note: String(fa?.note ?? '').slice(0, 150),
    })),
    topOpportunities: (parsed?.top_opportunities || []).slice(0, 5).map((o: any) => ({
      category: String(o?.category ?? '').slice(0, 50),
      action: String(o?.action ?? '').slice(0, 200),
      expectedRoiPct: Math.round(Number(o?.expected_roi_pct ?? 0)),
      urgency: ['high', 'medium', 'low'].includes(String(o?.urgency)) ? String(o.urgency) : 'medium',
      source: String(o?.source ?? '').slice(0, 50),
      reasoning: String(o?.reasoning ?? '').slice(0, 150),
    })),
    topRisks: (parsed?.top_risks || []).slice(0, 5).map((r: any) => ({
      item: String(r?.item ?? '').slice(0, 100),
      riskType: String(r?.risk_type ?? '').slice(0, 50),
      severity: ['high', 'medium', 'low'].includes(String(r?.severity)) ? String(r.severity) : 'medium',
      action: String(r?.action ?? '').slice(0, 200),
      potentialLossEur: Math.round(Number(r?.potential_loss_eur ?? 0)),
    })),
    recommendedActions: (parsed?.recommended_actions || []).slice(0, 8).map((a: any) => ({
      action: String(a?.action ?? '').slice(0, 250),
      priority: ['critical', 'high', 'medium', 'low'].includes(String(a?.priority)) ? String(a.priority) : 'medium',
      expectedImpactEur: Math.round(Number(a?.expected_impact_eur ?? 0)),
      deadlineDays: Math.max(0, Number(a?.deadline_days ?? 7)),
    })),
    projections: (parsed?.projections || []).slice(0, 3).map((p: any) => ({
      month: Math.max(1, Number(p?.month ?? 1)),
      projectedRevenueEur: Math.round(Number(p?.projected_revenue_eur ?? 0)),
      projectedProfitEur: Math.round(Number(p?.projected_profit_eur ?? 0)),
      projectedInvestedEur: Math.round(Number(p?.projected_invested_eur ?? 0)),
      cashFlowEur: Math.round(Number(p?.cash_flow_eur ?? 0)),
    })),
    overallAssessment: String(parsed?.overall_assessment ?? '').slice(0, 600),
  };
}
