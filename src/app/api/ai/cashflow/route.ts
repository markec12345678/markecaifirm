// v6.13 / v8.95.9-competitor: AI Cash Flow Optimizer — analiza in optimizacija denarnega toka
// Refaktoriran z withAiRoute helperjem (v8.95.9) + enforceBudget guard.
//
// POST /api/ai/cashflow
// Body: { forecastDays?: number } // default 30
// Returns: { ok, currentCash, forecast: [{ date, inflow, outflow, net, cumulative }], recommendations, bottlenecks, opportunities, summary }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface CashflowInput {
  forecastDays: number;
}

interface ForecastDay {
  date: string;
  inflow: number;
  outflow: number;
  net: number;
  cumulative: number;
}

interface CashflowContext {
  totalInvestedHeld: number;
  totalRealized: number;
  totalSpent: number;
  totalRevenue: number;
  currentCash: number;
  now: Date;
  threeMonthsAgo: Date;
  recentSales: number;
  avgSalesPerMonth: number;
  avgRevenuePerSale: number;
  avgCostPerBuy: number;
  avgDaysToSell: number;
  expectedSales: number;
  salesInterval: number;
  forecast: ForecastDay[];
  cumulative: number;
}

export const POST = withAiRoute<CashflowInput>({
  endpoint: '/api/ai/cashflow',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { forecastDays: Math.max(7, Math.min(90, Number(body?.forecastDays) || 30)) };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { forecastDays } = input;

    // 1. Pridobi vse sold tradeove za analizo cash flow vzorcev
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: {
        title: true, category: true, buyPrice: true, buyFees: true,
        sellPrice: true, sellFees: true, buyDate: true, sellDate: true,
        buyLocation: true, sellLocation: true,
      },
      take: 500,
    });

    // 2. Held trades — denar vezan v inventarju
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } },
      },
    });

    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return apiOk({
        ok: true,
        forecast: [],
        message: 'Ni dovolj podatkov za cash flow analizo.',
      });
    }

    // 3. Compute cash flow context + forecast
    const cctx = computeCashflowContext(soldTrades, heldTrades, forecastDays);

    // 4. AI analiza in optimizacija
    const prompt = buildPrompt(heldTrades, cctx, forecastDays);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const result = transformResult(parsed);

    return apiOk({
      ok: true,
      currentCash: Math.round(cctx.currentCash),
      totalInvestedHeld: Math.round(cctx.totalInvestedHeld),
      totalRealized: Math.round(cctx.totalRealized),
      forecast: cctx.forecast,
      analysis: result,
      summary: {
        forecastDays,
        expectedSales: cctx.expectedSales,
        expectedRevenue: Math.round(cctx.expectedSales * cctx.avgRevenuePerSale),
        expectedReinvestment: Math.round(cctx.expectedSales * cctx.avgCostPerBuy * 0.7),
        endingCash: Math.round(cctx.cumulative),
        avgSalesPerMonth: Number(cctx.avgSalesPerMonth.toFixed(1)),
        avgRevenuePerSale: Math.round(cctx.avgRevenuePerSale),
        avgDaysToSell: cctx.avgDaysToSell,
      },
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function computeCashflowContext(
  soldTrades: Array<{
    title: string; category: string | null; buyPrice: number; buyFees: number | null;
    sellPrice: number | null; sellFees: number | null; buyDate: Date | null; sellDate: Date | null;
    buyLocation: string | null; sellLocation: string | null;
  }>,
  heldTrades: Array<{
    title: string; category: string | null; buyPrice: number; buyFees: number | null; buyDate: Date;
    listing: { aiEstimatedValue: number | null; dealScore: number | null } | null;
  }>,
  forecastDays: number
): CashflowContext {
  const totalInvestedHeld = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
  const totalRealized = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0), 0);
  const totalSpent = soldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0) + totalInvestedHeld;
  const totalRevenue = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0), 0);
  const currentCash = totalRevenue - totalSpent;

  const now = new Date();
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const recentSales = soldTrades.filter(t => t.sellDate && t.sellDate >= threeMonthsAgo);
  const avgSalesPerMonth = recentSales.length / 3;
  const avgRevenuePerSale = recentSales.length > 0
    ? recentSales.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0), 0) / recentSales.length
    : 0;
  const avgCostPerBuy = recentSales.length > 0
    ? recentSales.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0) / recentSales.length
    : 0;

  const avgDaysToSell = recentSales.length > 0
    ? Math.round(recentSales.reduce((s, t) => {
        if (t.sellDate && t.buyDate) {
          return s + (t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000);
        }
        return s;
      }, 0) / recentSales.length)
    : 30;

  // Forecast
  const forecast: ForecastDay[] = [];
  let cumulative = currentCash;
  const expectedSales = Math.ceil((forecastDays / 30) * avgSalesPerMonth);
  const salesInterval = expectedSales > 0 ? Math.floor(forecastDays / expectedSales) : forecastDays;

  for (let d = 1; d <= forecastDays; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() + d);
    let inflow = 0;
    let outflow = 0;

    if (expectedSales > 0 && d % salesInterval === 0) {
      inflow = Math.round(avgRevenuePerSale);
      outflow = Math.round(avgCostPerBuy * 0.7);
    }

    cumulative += inflow - outflow;
    forecast.push({
      date: date.toISOString().slice(0, 10),
      inflow, outflow,
      net: inflow - outflow,
      cumulative: Math.round(cumulative),
    });
  }

  return {
    totalInvestedHeld, totalRealized, totalSpent, totalRevenue, currentCash,
    now, threeMonthsAgo, recentSales: recentSales.length,
    avgSalesPerMonth, avgRevenuePerSale, avgCostPerBuy, avgDaysToSell,
    expectedSales, salesInterval, forecast, cumulative,
  };
}

function buildPrompt(
  heldTrades: Array<{
    title: string; category: string | null; buyPrice: number; buyFees: number | null; buyDate: Date;
    listing: { aiEstimatedValue: number | null; dealScore: number | null } | null;
  }>,
  cctx: CashflowContext,
  forecastDays: number
): string {
  const heldItemsStr = heldTrades.slice(0, 20).map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
    return `- ${t.title} | ${t.category} | nabavna: ${cost}€ | est. prodajna: ${estValue}€ | ${daysHeld}d v skladišču`;
  }).join('\n');

  return `Si ekspert za upravljanje denarnega toka pri preprodaji rabljenih dobrin.
Analiziraj trenutno stanje in predlagaj optimizacije.

TRENUTNO STANJE:
- Realiziran dobiček: ${cctx.totalRealized}€
- Vezan denar v inventarju: ${cctx.totalInvestedHeld}€ (${heldTrades.length} itemov)
- Trenutni cash (približno): ${cctx.currentCash}€
- Povprečna prodaja/mesec: ${cctx.avgSalesPerMonth.toFixed(1)}
- Povp. prihodek/prodaja: ${Math.round(cctx.avgRevenuePerSale)}€
- Povp. investicija/nakup: ${Math.round(cctx.avgCostPerBuy)}€
- Povp. čas do prodaje: ${cctx.avgDaysToSell} dni

INVENTAR V SKLADIŠČU:
${heldItemsStr || '- Ni inventarja'}

NAPOVED ZA ${forecastDays} DNI:
- Pričakovane prodaje: ${cctx.expectedSales}
- Pričakovan prihodek: ${cctx.expectedSales * cctx.avgRevenuePerSale}€
- Pričakovan izdatek (reinvesticija): ${cctx.expectedSales * cctx.avgCostPerBuy * 0.7}€
- Končni cash: ${Math.round(cctx.cumulative)}€

Pravila:
1. Identificiraj cash flow bottlenecks (kje denar obtiči)
2. Predlagaj kako sprostit vezan denar (hitra prodaja, bundle, popust)
3. Optimiziraj reinvesticijski ciklus (koliko reinvestirati, koliko zadržati)
4. Opozori na cash flow gap (kdaj bo denarja premalo za nove nakupe)
5. Predlagaj optimalno razmerje: investicija vs. rezerva

Strategije:
- "aggressive_reinvest": reinvestiraj 80% prihodka (hitra rast, visoko tveganje)
- "balanced": reinvestiraj 50%, zadrži 50% rezervo
- "conservative": reinvestiraj 30%, zadrži 70% (počasna rast, nizko tveganje)
- "liquidation_first": najprej prodaj stalled inventar preden investiraš

Odgovori LE z JSON:
{
  "summary": "<povzetek cash flow stanja, max 200 znakov>",
  "current_strategy": "<aggressive_reinvest|balanced|conservative|liquidation_first>",
  "recommended_strategy": "<ena od strategij>",
  "bottlenecks": [
    {
      "type": "<inventory_tied_up|slow_moving|high_fees|reinvestment_rate|category_concentration>",
      "description": "<opis, max 100 znakov>",
      "impact_eur": <number>,
      "fix": "<kako odpraviti, max 150 znakov>"
    }
  ],
  "recommendations": [
    {
      "action": "<konkretno dejanje, max 100 znakov>",
      "priority": "<high|medium|low>",
      "expected_impact_eur": <number>,
      "timeframe": "<short|medium|long>"
    }
  ],
  "cash_flow_gaps": [
    {
      "date_range": "<datumski razpon, max 30 znakov>",
      "expected_shortfall_eur": <number>,
      "mitigation": "<kaj narediti, max 100 znakov>"
    }
  ],
  "optimal_allocation": {
    "reinvest_pct": <number 0-100>,
    "reserve_pct": <number 0-100>,
    "reasoning": "<max 150 znakov>"
  }
}`;
}

function transformResult(parsed: any): any {
  return {
    summary: String(parsed?.summary ?? '').slice(0, 500),
    currentStrategy: ['aggressive_reinvest', 'balanced', 'conservative', 'liquidation_first'].includes(String(parsed?.current_strategy))
      ? String(parsed.current_strategy) : 'balanced',
    recommendedStrategy: ['aggressive_reinvest', 'balanced', 'conservative', 'liquidation_first'].includes(String(parsed?.recommended_strategy))
      ? String(parsed.recommended_strategy) : 'balanced',
    bottlenecks: (parsed?.bottlenecks || []).slice(0, 6).map((b: any) => ({
      type: String(b?.type ?? '').slice(0, 50),
      description: String(b?.description ?? '').slice(0, 200),
      impactEur: Number(b?.impact_eur ?? 0) || 0,
      fix: String(b?.fix ?? '').slice(0, 250),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 8).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 200),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      expectedImpactEur: Number(r?.expected_impact_eur ?? 0) || 0,
      timeframe: ['short', 'medium', 'long'].includes(String(r?.timeframe)) ? String(r.timeframe) : 'medium',
    })),
    cashFlowGaps: (parsed?.cash_flow_gaps || []).slice(0, 4).map((g: any) => ({
      dateRange: String(g?.date_range ?? '').slice(0, 50),
      expectedShortfallEur: Number(g?.expected_shortfall_eur ?? 0) || 0,
      mitigation: String(g?.mitigation ?? '').slice(0, 200),
    })),
    optimalAllocation: {
      reinvestPct: Math.max(0, Math.min(100, Number(parsed?.optimal_allocation?.reinvest_pct ?? 50))),
      reservePct: Math.max(0, Math.min(100, Number(parsed?.optimal_allocation?.reserve_pct ?? 50))),
      reasoning: String(parsed?.optimal_allocation?.reasoning ?? '').slice(0, 300),
    },
  };
}
