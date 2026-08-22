// v6.26 / v8.95.5-deal: AI Cash Reserve Optimizer — optimizira denarno rezervo za max fleksibilnost
// Refaktoriran z withAiRoute helperjem (v8.95.5-deal) + enforceBudget guard.
//
// POST /api/ai/cash-reserve
// Body: {}
// Returns: { ok, reserve: { currentCash, optimalReserve, allocation, projections, recommendations } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface CashReserveInput {}

export const POST = withAiRoute<CashReserveInput>({
  endpoint: '/api/ai/cash-reserve',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {} as CashReserveInput;
  },

  // No validateInput — brez polj
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true } } },
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true,
        buyDate: true, sellDate: true, category: true },
      take: 200,
    });

    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return apiOk({ ok: true, reserve: null, message: 'Ni podatkov za optimizacijo rezerve.' });
    }

    // Izračunaj cash flow statove
    const stats = computeCashFlowStats(heldTrades, soldTrades);

    const prompt = buildPrompt(stats);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const reserve = transformReserve(parsed, stats.currentCash);

    return apiOk({ ok: true, reserve });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface HeldTradeRow {
  buyPrice: number;
  buyFees: number | null;
}

interface SoldTradeRow {
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  buyDate: Date;
  sellDate: Date | null;
}

interface CashFlowStats {
  totalInvestedHeld: number;
  totalRealized: number;
  currentCash: number;
  heldCount: number;
  avgSalesPerMonth: number;
  avgRevenuePerSale: number;
  avgCostPerBuy: number;
  avgDaysToSell: number;
}

const STRATEGIES = ['aggressive_growth', 'balanced', 'conservative', 'opportunity_fund'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

/**
 * Izračunaj cash flow statove iz held/sold trades.
 * Logika IDENTIČNA originalu v6.26.
 */
function computeCashFlowStats(heldTrades: HeldTradeRow[], soldTrades: SoldTradeRow[]): CashFlowStats {
  const totalInvestedHeld = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
  const totalRealized = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0), 0);
  const totalRevenue = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0), 0);
  const totalSpent = soldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0) + totalInvestedHeld;
  const currentCash = totalRevenue - totalSpent;

  // Avg sales per month
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const recentSales = soldTrades.filter(t => t.sellDate && t.sellDate >= threeMonthsAgo);
  const avgSalesPerMonth = recentSales.length / 3;
  const avgRevenuePerSale = recentSales.length > 0
    ? recentSales.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0), 0) / recentSales.length : 0;
  const avgCostPerBuy = recentSales.length > 0
    ? recentSales.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0) / recentSales.length : 0;
  const avgDaysToSell = recentSales.length > 0
    ? Math.round(recentSales.reduce((s, t) => {
        if (t.sellDate && t.buyDate) return s + (t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000);
        return s;
      }, 0) / recentSales.length) : 30;

  return {
    totalInvestedHeld,
    totalRealized,
    currentCash,
    heldCount: heldTrades.length,
    avgSalesPerMonth,
    avgRevenuePerSale,
    avgCostPerBuy,
    avgDaysToSell,
  };
}

/**
 * Build AI prompt za cash reserve optimization (besedilo IDENTIČNO originalu v6.26).
 */
function buildPrompt(stats: CashFlowStats): string {
  return `Si ekspert za treasury management in optimizacijo denarnih rezerv.
Optimiziraj denarno rezervo za max fleksibilnost in dobiček pri preprodaji.

TRENUTNO STANJE:
- Trenutni cash: ${Math.round(stats.currentCash)}€
- Vezano v inventarju: ${Math.round(stats.totalInvestedHeld)}€ (${stats.heldCount} itemov)
- Realizirani dobiček: ${Math.round(stats.totalRealized)}€
- Povp. prodaje/mesec: ${stats.avgSalesPerMonth.toFixed(1)}
- Povp. prihodek/prodaja: ${Math.round(stats.avgRevenuePerSale)}€
- Povp. investicija/nakup: ${Math.round(stats.avgCostPerBuy)}€
- Povp. čas do prodaje: ${stats.avgDaysToSell} dni

Pravila za cash reserve:
1. Optimalna rezerva = 2-3 mesece povprečne investicije (za nove priložnosti)
2. Rezerva mora pokriti vsaj 3-5 novih nakupov
3. Preveč rezerve = zamujen dobiček (opportunity cost)
4. Premalo rezerve = zamujene priložnosti (stockout)
5. Reinvesticijski cikel: koliko % prihodka reinvestirati vs. zadržati

Strategije:
- "aggressive_growth": 80% reinvest, 20% rezerva (hitra rast, visoko tveganje)
- "balanced": 50% reinvest, 50% rezerva (uravnoteženo)
- "conservative": 30% reinvest, 70% rezerva (počasna rast, varno)
- "opportunity_fund": 60% rezerva za "blue moon" priložnosti (>40% ROI)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "optimal_reserve_eur": <number>,
  "reserve_ratio_pct": <number>,
  "recommended_strategy": "<aggressive_growth|balanced|conservative|opportunity_fund>",
  "allocation": {
    "reinvest_pct": <number>,
    "reserve_pct": <number>,
    "profit_taking_pct": <number>,
    "reasoning": "<max 150 znakov>"
  },
  "projections": [
    {
      "month": <number>,
      "expected_inflow_eur": <number>,
      "expected_outflow_eur": <number>,
      "net_cash_eur": <number>,
      "cumulative_cash_eur": <number>,
      "invested_eur": <number>
    }
  ],
  "cash_flow_gaps": [
    {
      "month_range": "<max 30 znakov>",
      "expected_shortfall_eur": <number>,
      "mitigation": "<max 100 znakov>"
    }
  ],
  "recommendations": [
    {
      "action": "<max 100 znakov>",
      "priority": "<high|medium|low>",
      "impact_eur": <number>
    }
  ],
  "summary": {
    "current_cash_eur": <number>,
    "optimal_reserve_eur": <number>,
    "surplus_deficit_eur": <number>,
    "expected_monthly_growth_pct": <number>,
    "break_even_months": <number>
  }
}`;
}

/**
 * Transform AI JSON v reserve objekt. Clamp/slice logika IDENTIČNA originalu v6.26.
 */
function transformReserve(parsed: any, currentCash: number): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    optimalReserveEur: Math.max(0, Number(parsed?.optimal_reserve_eur ?? 0)),
    reserveRatioPct: Math.max(0, Math.min(100, Number(parsed?.reserve_ratio_pct ?? 30))),
    recommendedStrategy: includes(STRATEGIES, String(parsed?.recommended_strategy))
      ? String(parsed.recommended_strategy) : 'balanced',
    allocation: {
      reinvestPct: Math.max(0, Math.min(100, Number(parsed?.allocation?.reinvest_pct ?? 50))),
      reservePct: Math.max(0, Math.min(100, Number(parsed?.allocation?.reserve_pct ?? 30))),
      profitTakingPct: Math.max(0, Math.min(100, Number(parsed?.allocation?.profit_taking_pct ?? 20))),
      reasoning: String(parsed?.allocation?.reasoning ?? '').slice(0, 300),
    },
    projections: (parsed?.projections || []).slice(0, 6).map((p: any) => ({
      month: Math.max(1, Number(p?.month ?? 1)),
      expectedInflowEur: Math.round(Number(p?.expected_inflow_eur ?? 0)),
      expectedOutflowEur: Math.round(Number(p?.expected_outflow_eur ?? 0)),
      netCashEur: Math.round(Number(p?.net_cash_eur ?? 0)),
      cumulativeCashEur: Math.round(Number(p?.cumulative_cash_eur ?? 0)),
      investedEur: Math.round(Number(p?.invested_eur ?? 0)),
    })),
    cashFlowGaps: (parsed?.cash_flow_gaps || []).slice(0, 4).map((g: any) => ({
      monthRange: String(g?.month_range ?? '').slice(0, 50),
      expectedShortfallEur: Math.max(0, Number(g?.expected_shortfall_eur ?? 0)),
      mitigation: String(g?.mitigation ?? '').slice(0, 200),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 200),
      priority: includes(PRIORITIES, String(r?.priority)) ? String(r.priority) : 'medium',
      impactEur: Number(r?.impact_eur ?? 0),
    })),
    summary: {
      currentCashEur: Math.round(currentCash),
      optimalReserveEur: Math.max(0, Number(parsed?.summary?.optimal_reserve_eur ?? 0)),
      surplusDeficitEur: Math.round(Number(parsed?.summary?.surplus_deficit_eur ?? 0)),
      expectedMonthlyGrowthPct: Math.round(Number(parsed?.summary?.expected_monthly_growth_pct ?? 0)),
      breakEvenMonths: Math.max(0, Number(parsed?.summary?.break_even_months ?? 0)),
    },
  };
}
