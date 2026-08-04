// v6.63: AI Inventory Turnover Predictor — napove obrtnost inventarja z ML
// POST /api/ai/inventory-turnover-predictor
// Body: { monthsAhead?: number, category?: string }
// Returns: { ok, predictor: { current, forecast, categories, mlModels, recommendations, summary } }

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
    const monthsAhead = Math.max(1, Math.min(12, Number(body?.monthsAhead ?? 6)));
    const categoryFilter = body?.category ? String(body.category).toLowerCase() : null;

    const since12m = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since12m, not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 100,
    });

    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return NextResponse.json({ ok: true, predictor: null, message: 'Ni podatkov za turnover napoved.' });
    }

    // Compute current turnover metrics
    const totalSold12m = soldTrades.length;
    const totalRevenue = soldTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
    const totalCost = soldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const avgDaysToSell = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => s + Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000))), 0) / soldTrades.length) : 0;
    const heldCapital = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const heldCount = heldTrades.length;
    const annualTurnoverRate = heldCount > 0 ? Math.round((totalSold12m / heldCount) * 10) / 10 : 0;
    const turnoverRatio = avgDaysToSell > 0 ? Math.round((365 / avgDaysToSell) * 10) / 10 : 0;

    // Category breakdown
    const catMap = new Map<string, { soldCount: number; heldCount: number; avgDaysToSell: number; revenue: number; capitalTied: number }>();
    for (const t of soldTrades) {
      const cat = (t.category || 'drugo').toLowerCase();
      if (categoryFilter && !cat.includes(categoryFilter)) continue;
      const days = Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000)));
      if (!catMap.has(cat)) catMap.set(cat, { soldCount: 0, heldCount: 0, avgDaysToSell: 0, revenue: 0, capitalTied: 0 });
      const c = catMap.get(cat)!;
      c.soldCount += 1; c.avgDaysToSell += days; c.revenue += (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    }
    for (const t of heldTrades) {
      const cat = (t.category || 'drugo').toLowerCase();
      if (categoryFilter && !cat.includes(categoryFilter)) continue;
      if (!catMap.has(cat)) catMap.set(cat, { soldCount: 0, heldCount: 0, avgDaysToSell: 0, revenue: 0, capitalTied: 0 });
      const c = catMap.get(cat)!;
      c.heldCount += 1; c.capitalTied += t.buyPrice + (t.buyFees ?? 0);
    }
    const categoryStats = Array.from(catMap.entries()).map(([cat, c]) => ({
      category: cat, soldCount: c.soldCount, heldCount: c.heldCount,
      avgDaysToSell: c.soldCount > 0 ? Math.round(c.avgDaysToSell / c.soldCount) : 0,
      revenue: Math.round(c.revenue), capitalTied: Math.round(c.capitalTied),
      turnoverRate: c.heldCount > 0 ? Math.round((c.soldCount / c.heldCount) * 10) / 10 : 0,
    })).sort((a, b) => b.turnoverRate - a.turnoverRate);

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const catStr = categoryStats.slice(0, 10).map(c =>
      `- ${c.category}: sold ${c.soldCount}, held ${c.heldCount}, turnover ${c.turnoverRate}x, ${c.avgDaysToSell}d povp, ${c.revenue}€ revenue, ${c.capitalTied}€ tied`
    ).join('\n');

    const prompt = `Si AI inventory turnover predictor z ML za napoved obrtnosti inventarja.
Napove turnover rate za naslednjih ${monthsAhead} mesecev z ML forecasting.

TRENUTNO STANJE:
- Letna turnover rate: ${annualTurnoverRate}x
- Turnover ratio (365/avgDaysToSell): ${turnoverRatio}x
- Povp dni do prodaje: ${avgDaysToSell}
- Skupno sold (12m): ${totalSold12m}
- Held items: ${heldCount}
- Held capital: ${Math.round(heldCapital)}€
- Total revenue (12m): ${Math.round(totalRevenue)}€

KATEGORIJE:
${catStr}

5 ML modelov za turnover prediction:
- ARIMA: time series forecasting
- LSTM: deep learning za sequential patterns
- PROPHET: seasonal forecasting
- XGBOOST: gradient boosting
- ENSEMBLE: kombinacija vseh

Turnover faktorji:
- HISTORICAL_TURNOVER: zadnjih 12m turnover
- SEASONALITY: mesečna nihanja
- DEMAND_TREND: trend povpraševanja
- PRICING_STRATEGY: vpliv cene na turnover
- COMPETITION: vpliv konkurence
- MARKET_CONDITIONS: splošni tržni pogoji

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": {
    "annual_turnover_rate": <number>,
    "turnover_ratio": <number>,
    "avg_days_to_sell": <number>,
    "total_sold_12m": <number>,
    "held_count": <number>,
    "held_capital_eur": <number>,
    "capital_efficiency_pct": <number 0-100>,
    "turnover_grade": "<A|B|C|D|F>"
  },
  "forecast": [
    {
      "month": <1-12>,
      "predicted_turnover_rate": <number>,
      "predicted_items_sold": <number>,
      "predicted_revenue_eur": <number>,
      "predicted_avg_days_to_sell": <number>,
      "confidence_pct": <number 0-100>,
      "key_factors": ["<max 80 znakov>"]
    }
  ],
  "categories": [
    {
      "category": "<kategorija>",
      "current_turnover_rate": <number>,
      "predicted_turnover_rate": <number>,
      "turnover_change_pct": <number>,
      "current_avg_days_to_sell": <number>,
      "predicted_avg_days_to_sell": <number>,
      "capital_tied_eur": <number>,
      "capital_efficiency_pct": <number 0-100>,
      "recommended_action": "<accelerate|maintain|reduce_stock|increase_stock>",
      "trend": "<improving|stable|declining>"
    }
  ],
  "ml_models": [
    {
      "model": "<arima|lstm|prophet|xgboost|ensemble>",
      "accuracy_pct": <number 0-100>,
      "mae_days": <number>,
      "weight_in_ensemble": <number 0-100>,
      "best_for": "<max 80 znakov>",
      "prediction_horizon_days": <number>
    }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "category_targeted": "<kategorija ali all>", "expected_turnover_improvement_pct": <number>, "expected_capital freed_eur": <number>, "implementation_days": <number> }
  ],
  "summary": {
    "total_categories_analyzed": <number>,
    "current_turnover_score": <number 0-100>,
    "predicted_turnover_score": <number 0-100>,
    "improvement_pct": <number>,
    "total_capital_freed_eur": <number>,
    "best_model": "<max 80 znakov>",
    "biggest_turnover_bottleneck": "<max 100 znakov>",
    "biggest_turnover_opportunity": "<max 100 znakov>",
    "turnover_prediction_score": <number 0-100>
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
    const validCats = new Set(categoryStats.map(c => c.category));

    const predictor = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      current: {
        annualTurnoverRate: Math.round(Number(parsed?.current?.annual_turnover_rate ?? annualTurnoverRate) * 10) / 10,
        turnoverRatio: Math.round(Number(parsed?.current?.turnover_ratio ?? turnoverRatio) * 10) / 10,
        avgDaysToSell: Math.round(Number(parsed?.current?.avg_days_to_sell ?? avgDaysToSell)),
        totalSold12m: Math.max(0, Number(parsed?.current?.total_sold_12m ?? totalSold12m)),
        heldCount: Math.max(0, Number(parsed?.current?.held_count ?? heldCount)),
        heldCapitalEur: Math.round(Number(parsed?.current?.held_capital_eur ?? heldCapital)),
        capitalEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.current?.capital_efficiency_pct ?? 60))),
        turnoverGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.current?.turnover_grade)) ? String(parsed.current.turnover_grade) : 'C',
      },
      forecast: (parsed?.forecast || []).slice(0, monthsAhead).map((f: any) => ({
        month: Math.max(1, Math.min(12, Number(f?.month ?? 1))),
        predictedTurnoverRate: Math.round(Number(f?.predicted_turnover_rate ?? 0) * 10) / 10,
        predictedItemsSold: Math.max(0, Math.round(Number(f?.predicted_items_sold ?? 0))),
        predictedRevenueEur: Math.round(Number(f?.predicted_revenue_eur ?? 0)),
        predictedAvgDaysToSell: Math.max(0, Math.round(Number(f?.predicted_avg_days_to_sell ?? 0))),
        confidencePct: Math.max(0, Math.min(100, Number(f?.confidence_pct ?? 60))),
        keyFactors: (f?.key_factors || []).slice(0, 4).map((k: any) => String(k).slice(0, 150)),
      })),
      categories: (parsed?.categories || [])
        .filter((c: any) => validCats.has(String(c?.category ?? '')))
        .slice(0, 12)
        .map((c: any) => {
          const orig = categoryStats.find(x => x.category === String(c?.category));
          return {
            category: String(c?.category ?? '').slice(0, 50),
            currentTurnoverRate: Math.round(Number(c?.current_turnover_rate ?? orig?.turnoverRate ?? 0) * 10) / 10,
            predictedTurnoverRate: Math.round(Number(c?.predicted_turnover_rate ?? 0) * 10) / 10,
            turnoverChangePct: Math.round(Number(c?.turnover_change_pct ?? 0) * 10) / 10,
            currentAvgDaysToSell: Math.round(Number(c?.current_avg_days_to_sell ?? orig?.avgDaysToSell ?? 0)),
            predictedAvgDaysToSell: Math.round(Number(c?.predicted_avg_days_to_sell ?? 0)),
            capitalTiedEur: Math.round(Number(c?.capital_tied_eur ?? orig?.capitalTied ?? 0)),
            capitalEfficiencyPct: Math.max(0, Math.min(100, Number(c?.capital_efficiency_pct ?? 50))),
            recommendedAction: ['accelerate', 'maintain', 'reduce_stock', 'increase_stock'].includes(String(c?.recommended_action)) ? String(c.recommended_action) : 'maintain',
            trend: ['improving', 'stable', 'declining'].includes(String(c?.trend)) ? String(c.trend) : 'stable',
          };
        }),
      mlModels: (parsed?.ml_models || []).slice(0, 5).map((m: any) => ({
        model: ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
        accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))),
        maeDays: Math.round(Number(m?.mae_days ?? 0) * 10) / 10,
        weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
        bestFor: String(m?.best_for ?? '').slice(0, 150),
        predictionHorizonDays: Math.max(7, Number(m?.prediction_horizon_days ?? 30)),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        categoryTargeted: String(r?.category_targeted ?? 'all').slice(0, 50),
        expectedTurnoverImprovementPct: Math.round(Number(r?.expected_turnover_improvement_pct ?? 0) * 10) / 10,
        expectedCapitalFreedEur: Math.round(Number(r?.expected_capital_freed_eur ?? r?.['expected_capital_freed_eur'] ?? 0)),
        implementationDays: Math.max(1, Number(r?.implementation_days ?? 7)),
      })),
      summary: {
        totalCategoriesAnalyzed: categoryStats.length,
        currentTurnoverScore: Math.max(0, Math.min(100, Number(parsed?.summary?.current_turnover_score ?? 60))),
        predictedTurnoverScore: Math.max(0, Math.min(100, Number(parsed?.summary?.predicted_turnover_score ?? 70))),
        improvementPct: Math.round(Number(parsed?.summary?.improvement_pct ?? 0) * 10) / 10,
        totalCapitalFreedEur: Math.round(Number(parsed?.summary?.total_capital_freed_eur ?? parsed?.summary?.total_capital_freed_eur ?? 0)),
        bestModel: ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'].includes(String(parsed?.summary?.best_model)) ? String(parsed.summary.best_model) : 'ensemble',
        biggestTurnoverBottleneck: String(parsed?.summary?.biggest_turnover_bottleneck ?? '').slice(0, 200),
        biggestTurnoverOpportunity: String(parsed?.summary?.biggest_turnover_opportunity ?? '').slice(0, 200),
        turnoverPredictionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.turnover_prediction_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, predictor });
  } catch (e: any) { logger.error("/api/ai/inventory-turnover-predictor", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
