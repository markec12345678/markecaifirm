// v6.39: AI Listing Performance Forecaster — napove uspešnost oglasa pred objavo
// POST /api/ai/performance-forecaster
// Body: { tradeId?: string, listingId?: string }
// Returns: { ok, forecast: { performance, timeline, scenarios, benchmarks, optimization } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { tradeId, listingId } = body;

    let title = '', category = '', price = 0, estValue = 0, dealScore = 0;
    if (tradeId) {
      const t = await db.trade.findUnique({ where: { id: String(tradeId) }, select: { title: true, category: true, buyPrice: true, listing: { select: { aiEstimatedValue: true, dealScore: true } } } });
      if (!t) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
      title = t.title; category = t.category || ''; price = t.buyPrice;
      estValue = t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25); dealScore = t.listing?.dealScore ?? 0;
    } else if (listingId) {
      const l = await db.listing.findUnique({ where: { id: String(listingId) }, select: { title: true, price: true, aiEstimatedValue: true, dealScore: true, monitor: { select: { source: true } } } });
      if (!l) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      title = l.title; category = l.monitor?.source || ''; price = l.price ?? 0; estValue = l.aiEstimatedValue ?? price; dealScore = l.dealScore ?? 0;
    } else { return NextResponse.json({ error: 'tradeId ali listingId je obvezen' }, { status: 400 }); }

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null }, sellPrice: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true },
      take: 200,
    });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const avgDays = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => { if (t.sellDate && t.buyDate) return s + (t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000); return s; }, 0) / soldTrades.length) : 30;
    const avgRoi = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => { const c = t.buyPrice; return s + (c > 0 ? (((t.sellPrice ?? 0) - c) / c) * 100 : 0); }, 0) / soldTrades.length) : 0;
    const successRate = soldTrades.length > 0 ? Math.round(soldTrades.filter(t => (t.sellPrice ?? 0) > t.buyPrice).length / soldTrades.length * 100) : 0;

    const prompt = `Si AI performance forecaster za napoved uspešnosti oglasa.
Napovej kako bo ta oglas performiral v naslednjih 30 dneh.

ITEM: ${title}
KATEGORIJA: ${category}
CENA: ${price}€
EST. VREDNOST: ${estValue}€
DEAL SCORE: ${dealScore}/100

ZGODOVINSKI BENCHMARKI:
- Povp. dni do prodaje: ${avgDays}
- Povp. ROI: ${avgRoi}%
- Success rate: ${successRate}%

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

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);

    const forecast = {
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

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, forecast });
  } catch (e: any) { logger.error("/api/ai/performance-forecaster", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
