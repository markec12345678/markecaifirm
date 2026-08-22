// v6.12 / v8.95.9-other-medium: AI Demand Forecast — napoved povpraševanja po kategorijah za naslednje 3 mesece
// (v7.60: premaknjeno na /api/ai/demand-forecast-v6 — novo v7.60 implementacija na /api/ai/demand-forecast)
// Refaktoriran z withAiRoute helperjem (v8.95.9) + enforceBudget guard.
//
// POST /api/ai/demand-forecast
// Body: { months?: number } // default 3
// Returns: { ok, forecasts: Array<{ category, currentDemand, forecastDemand, trend, seasonality, peakMonths, lowMonths, recommendation, opportunities }>, insights }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const MONTHS_SL = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Avg', 'Sep', 'Okt', 'Nov', 'Dec'];

interface DemandForecastInput {
  monthsAhead: number;
}

export const POST = withAiRoute<DemandForecastInput>({
  endpoint: '/api/ai/demand-forecast-v6',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const monthsAhead = Math.max(1, Math.min(6, Number(body?.months) || 3));
    return { monthsAhead };
  },

  // No validateInput — monthsAhead ima default 3 in clamp [1,6]
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { monthsAhead } = input;

    // 1. Pridobi vse sold tradeove z datumov prodaje za 12+ mesecev nazaj
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    oneYearAgo.setMonth(oneYearAgo.getMonth() - 3);

    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        sellDate: { gte: oneYearAgo },
      },
      select: {
        title: true, category: true, buyPrice: true, sellPrice: true,
        buyDate: true, sellDate: true, sellFees: true, buyFees: true,
      },
      take: 500,
    });

    // 2. Pridobi nedavne listinge za trend povpraševanja (koliko oglasov se pojavi)
    const recentListings = await db.listing.findMany({
      where: {
        isHidden: false,
        firstSeenAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
      },
      select: { firstSeenAt: true, aiVerdict: true, dealScore: true, monitor: { select: { source: true } } },
      take: 1000,
    });

    if (soldTrades.length === 0 && recentListings.length === 0) {
      return apiOk({
        ok: true,
        forecasts: [],
        message: 'Ni dovolj podatkov za napoved povpraševanja (potrebnih vsaj nekaj prodaj ali oglasov).',
      });
    }

    // 3. Analiza po kategorijah — zgodovinski patterni
    const byCategory = computeCategoryStats(soldTrades);

    // Trenutno število oglasov per kategorija (približno — iz monitor source)
    const listingsByMonth: Record<string, number> = {};
    for (const l of recentListings) {
      const monthKey = `${l.firstSeenAt.getFullYear()}-${String(l.firstSeenAt.getMonth() + 1).padStart(2, '0')}`;
      listingsByMonth[monthKey] = (listingsByMonth[monthKey] ?? 0) + 1;
    }

    // 4. AI napoved
    const categoriesData = Object.entries(byCategory).map(([cat, d]) => {
      const monthPattern = Object.entries(d.salesByMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([m, s]) => {
          const [y, mo] = m.split('-');
          return `${MONTHS_SL[parseInt(mo) - 1]} ${y.slice(2)}: ${s.count} prodaj, ${s.profit}€`;
        }).join('; ');
      return `- ${cat}: ${d.totalSales} prodaj (12m), ${d.totalProfit}€ dobička, povp. ${d.avgSellDays}d prodaja. Mesečni pattern: ${monthPattern}`;
    }).join('\n');

    const currentMonth = new Date().getMonth();
    const nextMonths: string[] = [];
    for (let i = 0; i < monthsAhead; i++) {
      const m = (currentMonth + i + 1) % 12;
      nextMonths.push(MONTHS_SL[m]);
    }

    const prompt = buildPrompt({
      monthsAhead,
      nextMonths,
      categoriesData,
      listingsByMonth,
      currentMonth,
    });

    const raw = await callAi(prompt);

    const parsed: any = parseAi(raw);
    const forecasts = (parsed?.forecasts || []).map((f: any) => ({
      category: String(f?.category ?? '').slice(0, 50),
      trend: ['growing', 'stable', 'declining'].includes(String(f?.trend)) ? String(f.trend) : 'stable',
      seasonality: ['high', 'medium', 'low'].includes(String(f?.seasonality)) ? String(f.seasonality) : 'medium',
      currentDemand: Math.max(0, Math.min(200, Number(f?.current_demand ?? 100))),
      forecastDemand: Math.max(0, Math.min(200, Number(f?.forecast_demand ?? 100))),
      peakMonths: Array.isArray(f?.peak_months) ? f.peak_months.slice(0, 4).map((m: any) => String(m).slice(0, 30)) : [],
      lowMonths: Array.isArray(f?.low_months) ? f.low_months.slice(0, 4).map((m: any) => String(m).slice(0, 30)) : [],
      recommendation: ['buy', 'hold', 'sell'].includes(String(f?.recommendation)) ? String(f.recommendation) : 'hold',
      expectedRoiPct: Math.max(-50, Math.min(300, Number(f?.expected_roi_pct ?? 0))),
      opportunities: Array.isArray(f?.opportunities) ? f.opportunities.slice(0, 6).map((o: any) => String(o).slice(0, 150)) : [],
      reasoning: String(f?.reasoning ?? '').slice(0, 200),
    }));

    // Summary
    const summary = computeSummary(forecasts, monthsAhead, nextMonths);

    return apiOk({
      ok: true,
      insights: String(parsed?.insights ?? '').slice(0, 600),
      forecasts,
      summary,
      historicalData: {
        totalSales: soldTrades.length,
        totalListings: recentListings.length,
        categoriesAnalyzed: Object.keys(byCategory).length,
      },
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface SoldTradeRow {
  title: string;
  category: string | null;
  buyPrice: number;
  sellPrice: number | null;
  buyDate: Date;
  sellDate: Date | null;
  sellFees: number | null;
  buyFees: number | null;
}

interface CategoryStats {
  salesByMonth: Record<string, { count: number; profit: number; avgDays: number }>;
  totalSales: number;
  totalProfit: number;
  avgSellDays: number;
  currentListings: number;
}

function computeCategoryStats(soldTrades: SoldTradeRow[]): Record<string, CategoryStats> {
  const byCategory: Record<string, CategoryStats> = {};

  for (const t of soldTrades) {
    const cat = t.category || 'drugo';
    if (!byCategory[cat]) {
      byCategory[cat] = {
        salesByMonth: {}, totalSales: 0, totalProfit: 0, avgSellDays: 0, currentListings: 0,
      };
    }
    byCategory[cat].totalSales++;
    const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
    byCategory[cat].totalProfit += profit;
    if (t.sellDate) {
      const monthKey = `${t.sellDate.getFullYear()}-${String(t.sellDate.getMonth() + 1).padStart(2, '0')}`;
      if (!byCategory[cat].salesByMonth[monthKey]) {
        byCategory[cat].salesByMonth[monthKey] = { count: 0, profit: 0, avgDays: 0 };
      }
      byCategory[cat].salesByMonth[monthKey].count++;
      byCategory[cat].salesByMonth[monthKey].profit += profit;
      if (t.buyDate && t.sellDate) {
        byCategory[cat].salesByMonth[monthKey].avgDays +=
          Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      }
    }
  }

  // Povprečni dnev do prodaje per kategorija
  for (const cat of Object.keys(byCategory)) {
    const sales = soldTrades.filter(t => (t.category || 'drugo') === cat && t.buyDate && t.sellDate);
    byCategory[cat].avgSellDays = sales.length > 0
      ? Math.round(sales.reduce((s, t) => s + (t.sellDate!.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000), 0) / sales.length)
      : 0;
  }

  return byCategory;
}

interface PromptData {
  monthsAhead: number;
  nextMonths: string[];
  categoriesData: string;
  listingsByMonth: Record<string, number>;
  currentMonth: number;
}

function buildPrompt(d: PromptData): string {
  return `Si ekspert za napovedovanje povpraševanja na slovenskem trgu rabljenih dobrin.
Analiziraj zgodovinske podatke in napovej povpraševanje za naslednje ${d.monthsAhead} mesecev (${d.nextMonths.join(', ')}).

Zgodovinski podatki po kategorijah (zadnjih 12 mesecev):
${d.categoriesData || '- Ni dovolj podatkov'}

Skupno število nedavnih oglasov (zadnjih 90 dni po mesecih):
${Object.entries(d.listingsByMonth).sort(([a], [b]) => a.localeCompare(b)).map(([m, c]) => {
  const [y, mo] = m.split('-');
  return `- ${MONTHS_SL[parseInt(mo) - 1]} ${y.slice(2)}: ${c} oglasov`;
}).join('\n') || '- Ni podatkov'}

Trenutni mesec: ${MONTHS_SL[d.currentMonth]}

Slovenska sezonska logika:
- Pozimi (Nov-Feb): visoko povpraševanje po grelnikih, zimskih gumah, smučarski opremi, pečeh
- Spomladi (Mar-Maj): visoko povpraševanje po kolesih, vrtni opremi, motokulturkah, kabrioletih
- Poleti (Jun-Avg): visoko povpraševanje po kamp opremi, čolnih, klimatskih napravah, avto opremi
- Jeseni (Sep-Nov): visoko povpraševanje po šolski opremi, športni opremi, ogrevanju, avto gumah

Za vsako kategorijo z dovolj podatki napovej:
1. trend: growing|stable|declining (glede na zadnje 3 mesece vs prejšnje 3)
2. seasonality: high|medium|low (ali ima izrazit sezonski vzorec)
3. peakMonths: kateri meseci v naslednjih ${d.monthsAhead} bodo imeli najvišje povpraševanje
4. lowMonths: kateri meseci bodo imeli najnižje povpraševanje
5. forecastDemand: indeks 0-200 (100 = povprečje)
6. recommendation: buy|hold|sell (kaj zdaj)
7. opportunities: konkretni itemi ki jih iskati (3-5)

Odgovori LE z JSON:
{
  "insights": "<splošne ugotovitve o trgu, max 300 znakov>",
  "forecasts": [
    {
      "category": "<kategorija>",
      "trend": "<growing|stable|declining>",
      "seasonality": "<high|medium|low>",
      "current_demand": <number 0-200>,
      "forecast_demand": <number 0-200>,
      "peak_months": ["<mesec>", "..."],
      "low_months": ["<mesec>", "..."],
      "recommendation": "<buy|hold|sell>",
      "expected_roi_pct": <number>,
      "opportunities": ["<konkreten item, max 80 znakov>", "..."],
      "reasoning": "<max 100 znakov>"
    }
  ]
}`;
}

function computeSummary(forecasts: any[], monthsAhead: number, nextMonths: string[]) {
  const growingCats = forecasts.filter(f => f.trend === 'growing').length;
  const decliningCats = forecasts.filter(f => f.trend === 'declining').length;
  const buyRecs = forecasts.filter(f => f.recommendation === 'buy').length;
  const sellRecs = forecasts.filter(f => f.recommendation === 'sell').length;
  const avgForecastDemand = forecasts.length > 0
    ? Math.round(forecasts.reduce((s, f) => s + f.forecastDemand, 0) / forecasts.length)
    : 100;

  return {
    totalCategories: forecasts.length,
    growingCats,
    decliningCats,
    buyRecs,
    sellRecs,
    avgForecastDemand,
    monthsAhead,
    nextMonths,
  };
}
