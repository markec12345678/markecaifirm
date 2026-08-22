// v6.39 / v8.94-refactor: AI Listing Performance Forecaster — napove uspešnost oglasa pred objavo
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/performance-forecaster
// Body: { tradeId?: string, listingId?: string }
// Returns: { ok, forecast: { performance, timeline, scenarios, benchmarks, optimization } }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface PerformanceForecasterInput {
  tradeId?: string;
  listingId?: string;
}

export const POST = withAiRoute<PerformanceForecasterInput>({
  endpoint: '/api/ai/performance-forecaster',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : undefined,
      listingId: body?.listingId ? String(body.listingId) : undefined,
    };
  },

  validateInput: (input) => ((input.tradeId || input.listingId) ? null : 'tradeId ali listingId je obvezen'),

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId, listingId } = input;

    let title = '', category = '', price = 0, estValue = 0, dealScore = 0;
    if (tradeId) {
      const t = await db.trade.findUnique({ where: { id: tradeId }, select: { title: true, category: true, buyPrice: true, listing: { select: { aiEstimatedValue: true, dealScore: true } } } });
      if (!t) throw new ApiRouteError('Trade ne obstaja', 404);
      title = t.title; category = t.category || ''; price = t.buyPrice;
      estValue = t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25); dealScore = t.listing?.dealScore ?? 0;
    } else if (listingId) {
      const l = await db.listing.findUnique({ where: { id: listingId }, select: { title: true, price: true, aiEstimatedValue: true, dealScore: true, monitor: { select: { source: true } } } });
      if (!l) throw new ApiRouteError('Listing ne obstaja', 404);
      title = l.title; category = l.monitor?.source || ''; price = l.price ?? 0; estValue = l.aiEstimatedValue ?? price; dealScore = l.dealScore ?? 0;
    }

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null }, sellPrice: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true },
      take: 200,
    });

    const avgDays = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => { if (t.sellDate && t.buyDate) return s + (t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000); return s; }, 0) / soldTrades.length) : 30;
    const avgRoi = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => { const c = t.buyPrice; return s + (c > 0 ? (((t.sellPrice ?? 0) - c) / c) * 100 : 0); }, 0) / soldTrades.length) : 0;
    const successRate = soldTrades.length > 0 ? Math.round(soldTrades.filter(t => (t.sellPrice ?? 0) > t.buyPrice).length / soldTrades.length * 100) : 0;

    const prompt = buildPrompt({
      title, category, price, estValue, dealScore, avgDays, avgRoi, successRate,
    });
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const forecast = transformForecast(parsed, { avgDays, avgRoi, estValue });

    return apiOk({ ok: true, forecast });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface PromptData {
  title: string;
  category: string;
  price: number;
  estValue: number;
  dealScore: number;
  avgDays: number;
  avgRoi: number;
  successRate: number;
}

function buildPrompt(d: PromptData): string {
  return `Si AI performance forecaster za napoved uspešnosti oglasa.
Napovej kako bo ta oglas performiral v naslednjih 30 dneh.

ITEM: ${d.title}
KATEGORIJA: ${d.category}
CENA: ${d.price}€
EST. VREDNOST: ${d.estValue}€
DEAL SCORE: ${d.dealScore}/100

ZGODOVINSKI BENCHMARKI:
- Povp. dni do prodaje: ${d.avgDays}
- Povp. ROI: ${d.avgRoi}%
- Success rate: ${d.successRate}%

Forecast modeli:
1. VIEWS: predvideno število ogledov v 7/14/30 dneh
2. INQUIRIES: predvidena povpraševanja
3. SELL_PROBABILITY: verjetnost prodaje v 7/14/30 dneh
4. FINAL_PRICE: predvidena končna prodajna cena (po pogajanjih)
5. DAYS_TO_SELL: predviden čas do prodaje

Scenariji:
- OPTIMISTIC: dobra slika, pravi čas, malo konkurence → višja cena, hitreje
- REALISTIC: normalni pogoji → povprečna cena, povprečen čas
- PESSIMISTIC: slaba slika, veliko konkurence, izven sezone → nižja cena, počasneje

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "performance": {
    "predicted_views_7d": <number>,
    "predicted_views_30d": <number>,
    "predicted_inquiries_7d": <number>,
    "predicted_inquiries_30d": <number>,
    "sell_probability_7d_pct": <number>,
    "sell_probability_14d_pct": <number>,
    "sell_probability_30d_pct": <number>,
    "predicted_final_price_eur": <number>,
    "predicted_days_to_sell": <number>,
    "predicted_profit_eur": <number>,
    "predicted_roi_pct": <number>,
    "confidence_pct": <number>
  },
  "timeline": [
    { "day": <number>, "cumulative_views": <number>, "cumulative_inquiries": <number>, "sell_probability_pct": <number>, "event": "<max 60 znakov>" }
  ],
  "scenarios": [
    {
      "name": "<optimistic|realistic|pessimistic>",
      "sell_probability_pct": <number>,
      "final_price_eur": <number>,
      "days_to_sell": <number>,
      "profit_eur": <number>,
      "probability_of_scenario_pct": <number>
    }
  ],
  "benchmarks": {
    "category_avg_days_to_sell": <number>,
    "category_avg_roi_pct": <number>,
    "your_predicted_vs_avg": "<above|at_par|below>",
    "percentile": <number 0-100>
  },
  "optimization": [
    { "action": "<max 100 znakov>", "impact": "<high|medium|low>", "metric_improved": "<views|inquiries|sell_probability|price|days>", "expected_improvement_pct": <number> }
  ],
  "summary": {
    "overall_forecast_score": <number 0-100>,
    "forecast_grade": "<A+|A|B+|B|C|D>",
    "best_case_profit_eur": <number>,
    "worst_case_profit_eur": <number>,
    "expected_profit_eur": <number>,
    "recommendation": "<list_now|improve_first|wait|avoid>"
  }
}`;
}

interface FallbackData {
  avgDays: number;
  avgRoi: number;
  estValue: number;
}

function transformForecast(parsed: any, fb: FallbackData) {
  const { avgDays, avgRoi, estValue } = fb;
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    performance: {
      predictedViews7d: Math.max(0, Number(parsed?.performance?.predicted_views_7d ?? 0)),
      predictedViews30d: Math.max(0, Number(parsed?.performance?.predicted_views_30d ?? 0)),
      predictedInquiries7d: Math.max(0, Number(parsed?.performance?.predicted_inquiries_7d ?? 0)),
      predictedInquiries30d: Math.max(0, Number(parsed?.performance?.predicted_inquiries_30d ?? 0)),
      sellProbability7dPct: Math.max(0, Math.min(100, Number(parsed?.performance?.sell_probability_7d_pct ?? 0))),
      sellProbability14dPct: Math.max(0, Math.min(100, Number(parsed?.performance?.sell_probability_14d_pct ?? 0))),
      sellProbability30dPct: Math.max(0, Math.min(100, Number(parsed?.performance?.sell_probability_30d_pct ?? 0))),
      predictedFinalPriceEur: Math.max(0, Number(parsed?.performance?.predicted_final_price_eur ?? estValue)),
      predictedDaysToSell: Math.max(0, Number(parsed?.performance?.predicted_days_to_sell ?? avgDays)),
      predictedProfitEur: Math.round(Number(parsed?.performance?.predicted_profit_eur ?? 0)),
      predictedRoiPct: Math.round(Number(parsed?.performance?.predicted_roi_pct ?? 0)),
      confidencePct: Math.max(0, Math.min(100, Number(parsed?.performance?.confidence_pct ?? 50))),
    },
    timeline: (parsed?.timeline || []).slice(0, 6).map((t: any) => ({
      day: Math.max(0, Number(t?.day ?? 0)), cumulativeViews: Math.max(0, Number(t?.cumulative_views ?? 0)),
      cumulativeInquiries: Math.max(0, Number(t?.cumulative_inquiries ?? 0)),
      sellProbabilityPct: Math.max(0, Math.min(100, Number(t?.sell_probability_pct ?? 0))),
      event: String(t?.event ?? '').slice(0, 100),
    })),
    scenarios: (parsed?.scenarios || []).slice(0, 3).map((s: any) => ({
      name: ['optimistic', 'realistic', 'pessimistic'].includes(String(s?.name)) ? String(s.name) : 'realistic',
      sellProbabilityPct: Math.max(0, Math.min(100, Number(s?.sell_probability_pct ?? 0))),
      finalPriceEur: Math.max(0, Number(s?.final_price_eur ?? 0)),
      daysToSell: Math.max(0, Number(s?.days_to_sell ?? 0)),
      profitEur: Math.round(Number(s?.profit_eur ?? 0)),
      probabilityOfScenarioPct: Math.max(0, Math.min(100, Number(s?.probability_of_scenario_pct ?? 33))),
    })),
    benchmarks: {
      categoryAvgDaysToSell: Math.max(0, Number(parsed?.benchmarks?.category_avg_days_to_sell ?? avgDays)),
      categoryAvgRoiPct: Math.round(Number(parsed?.benchmarks?.category_avg_roi_pct ?? avgRoi)),
      yourPredictedVsAvg: ['above', 'at_par', 'below'].includes(String(parsed?.benchmarks?.your_predicted_vs_avg)) ? String(parsed.benchmarks.your_predicted_vs_avg) : 'at_par',
      percentile: Math.max(0, Math.min(100, Number(parsed?.benchmarks?.percentile ?? 50))),
    },
    optimization: (parsed?.optimization || []).slice(0, 6).map((o: any) => ({
      action: String(o?.action ?? '').slice(0, 200), impact: ['high', 'medium', 'low'].includes(String(o?.impact)) ? String(o.impact) : 'medium',
      metricImproved: String(o?.metric_improved ?? '').slice(0, 50), expectedImprovementPct: Math.round(Number(o?.expected_improvement_pct ?? 0)),
    })),
    summary: {
      overallForecastScore: Math.max(0, Math.min(100, Number(parsed?.summary?.overall_forecast_score ?? 50))),
      forecastGrade: ['A+', 'A', 'B+', 'B', 'C', 'D'].includes(String(parsed?.summary?.forecast_grade)) ? String(parsed.summary.forecast_grade) : 'C',
      bestCaseProfitEur: Math.round(Number(parsed?.summary?.best_case_profit_eur ?? 0)),
      worstCaseProfitEur: Math.round(Number(parsed?.summary?.worst_case_profit_eur ?? 0)),
      expectedProfitEur: Math.round(Number(parsed?.summary?.expected_profit_eur ?? 0)),
      recommendation: ['list_now', 'improve_first', 'wait', 'avoid'].includes(String(parsed?.summary?.recommendation)) ? String(parsed.summary.recommendation) : 'list_now',
    },
  };
}
