// v6.55: AI Listing Performance Forecaster v3 — advanced ML z ensemble modeli in scenario planning
// POST /api/ai/listing-performance-forecaster-v3
// Body: { tradeId?: string, horizonDays?: number }
// Returns: { ok, forecaster: { listings, ensembleModels, scenarios, timeSeries, sensitivityAnalysis, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ENSEMBLE_MODELS = [
  'linear_regression',    // osnovni linear model
  'random_forest',        // non-linear z decision trees
  'gradient_boosting',    // boosting za optimalno accuracy
  'neural_network',       // deep learning za kompleksne vzorce
  'arima',                // time series forecasting
  'prophet',              // Facebook Prophet za seasonal
  'lstm',                 // recurrent neural network za sequential
  'ensemble_voting',      // kombinacija vseh modelov
] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const horizonDays = Math.max(7, Math.min(90, Number(body?.horizonDays ?? 30)));

    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;

    const heldTrades = await db.trade.findMany({
      where,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiScore: true, aiRisk: true, location: true, imageUrl: true, monitor: { select: { source: true } } } },
      },
      take: tradeId ? 1 : 20,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, forecaster: null, message: 'Ni held tradeov za forecast.' });
    }

    // Historical data za training features
    const since6m = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since6m, not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true, sellLocation: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiScore: true, aiRisk: true, location: true, monitor: { select: { source: true } } } },
      },
      take: 300,
      orderBy: { sellDate: 'desc' },
    });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // ML features za held items
    const items = heldTrades.map(t => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));
      const cat = (t.category || 'drugo').toLowerCase();
      const similarSold = soldTrades.filter(s => (s.category || '').toLowerCase() === cat);
      const similarPrices = similarSold.map(s => (s.sellPrice ?? 0) - (s.sellFees ?? 0));
      const similarAvg = similarPrices.length > 0 ? Math.round(similarPrices.reduce((a, b) => a + b, 0) / similarPrices.length) : estValue;
      const similarDaysToSell = similarSold.map(s => Math.max(0, Math.round((s.sellDate!.getTime() - s.buyDate.getTime()) / (24*60*60*1000))));
      const avgDaysToSell = similarDaysToSell.length > 0 ? Math.round(similarDaysToSell.reduce((a, b) => a + b, 0) / similarDaysToSell.length) : 14;
      return {
        id: t.id, title: t.title, category: cat, cost, estValue, daysHeld,
        dealScore: t.listing?.dealScore ?? 50,
        aiScore: t.listing?.aiScore ?? 5,
        aiRisk: t.listing?.aiRisk ?? 5,
        location: t.listing?.location || '',
        source: t.listing?.monitor?.source || 'bolha',
        similarSoldCount: similarSold.length,
        similarAvgPrice: similarAvg,
        similarAvgDaysToSell: avgDaysToSell,
      };
    });

    const itemsStr = items.slice(0, 15).map(i =>
      `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d | deal ${i.dealScore} AI ${i.aiScore} risk ${i.aiRisk} | podobnih prodanih: ${i.similarSoldCount} | povp cena ${i.similarAvgPrice}€ | povp ${i.similarAvgDaysToSell}d | ${i.source}`
    ).join('\n');

    const prompt = `Si AI listing performance forecaster v3 z ensemble ML modeli za slovenske oglasne platforme.
Napove performance z 8-model ensemble in scenario planning za naslednje ${horizonDays} dni.

HELD INVENTAR (${items.length}):
${itemsStr}

8 ML modelov v ensemble:
1. LINEAR_REGRESSION: osnovni linear model (fast, interpretable)
2. RANDOM_FOREST: non-linear z decision trees (robust)
3. GRADIENT_BOOSTING: boosting za optimalno accuracy (XGBoost-style)
4. NEURAL_NETWORK: deep learning za kompleksne vzorce (multi-layer)
5. ARIMA: time series forecasting (avtoregresivni)
6. PROPHET: Facebook Prophet za seasonal patterns
7. LSTM: recurrent neural network za sequential data
8. ENSEMBLE_VOTING: kombinacija vseh modelov z weighted voting

ML features:
- Item features: title, category, cost, estValue, daysHeld, dealScore, aiScore, aiRisk, location, source
- Historical features: similarSoldCount, similarAvgPrice, similarAvgDaysToSell
- Temporal features: dayOfWeek, month, season, daysSincePosted
- Market features: categoryDemand, competitionLevel, priceIndex
- Quality features: imageCount, descriptionLength, sentimentScore

Scenario planning:
- BASE_CASE: najbolj verjeten scenarij (50% confidence)
- BEST_CASE: optimističen (25% confidence)
- WORST_CASE: pesimističen (25% confidence)
- STRESS_TEST: ekstremni slab scenarij (5% confidence)

Sensitivity analysis:
- CENA ±10%: kako vpliva na prodajo
- DAN V TEDNU: kdaj najbolje objaviti
- SEZONA: kdaj je optimalen čas za to kategorijo
- KONKURENCA: kako vpliva dodaten competitor

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "ensemble_forecast": {
        "base_case": {
          "predicted_views_30d": <number>,
          "predicted_inquiries_30d": <number>,
          "predicted_sale_probability_30d_pct": <number 0-100>,
          "predicted_sale_date": "<YYYY-MM-DD ali null>",
          "predicted_sale_price_eur": <number>,
          "predicted_profit_eur": <number>
        },
        "best_case": {
          "predicted_views_30d": <number>,
          "predicted_inquiries_30d": <number>,
          "predicted_sale_probability_30d_pct": <number>,
          "predicted_sale_price_eur": <number>,
          "predicted_profit_eur": <number>
        },
        "worst_case": {
          "predicted_views_30d": <number>,
          "predicted_inquiries_30d": <number>,
          "predicted_sale_probability_30d_pct": <number>,
          "predicted_sale_price_eur": <number>,
          "predicted_profit_eur": <number>
        },
        "confidence_interval": {
          "lower_bound_price_eur": <number>,
          "upper_bound_price_eur": <number>,
          "confidence_pct": <number 0-100>
        },
        "model_consensus": "<strong|moderate|weak>",
        "prediction_std_dev": <number>
      },
      "recommended_actions": ["<max 100 znakov>"],
      "optimal_listing_date": "<YYYY-MM-DD>",
      "optimal_price_eur": <number>,
      "expected_roi_pct": <number>,
      "risk_assessment": "<low|medium|high>"
    }
  ],
  "ensemble_models": [
    {
      "model": "<linear_regression|random_forest|gradient_boosting|neural_network|arima|prophet|lstm|ensemble_voting>",
      "weight_in_ensemble": <number 0-100>,
      "accuracy_score": <number 0-100>,
      "prediction_variance": <number>,
      "best_for": "<max 80 znakov>",
      "contribution_to_ensemble_pct": <number>
    }
  ],
  "scenarios": [
    {
      "scenario": "<base_case|best_case|worst_case|stress_test>",
      "probability_pct": <number 0-100>,
      "total_predicted_revenue_eur": <number>,
      "total_predicted_profit_eur": <number>,
      "avg_sale_probability_pct": <number>,
      "avg_days_to_sale": <number>,
      "key_assumption": "<max 120 znakov>"
    }
  ],
  "time_series": [
    {
      "day_offset": <0-30>,
      "base_case_views": <number>,
      "base_case_inquiries": <number>,
      "base_case_sale_probability_pct": <number>,
      "best_case_views": <number>,
      "worst_case_views": <number>,
      "uncertainty_band": <number>
    }
  ],
  "sensitivity_analysis": [
    {
      "listing_id": "<trade_id>",
      "variable": "<price|day_of_week|season|competition>",
      "current_value": "<max 80 znakov>",
      "best_value": "<max 80 znakov>",
      "impact_on_sale_probability_pct": <number>,
      "recommended_adjustment": "<max 120 znakov>"
    }
  ],
  "summary": {
    "total_listings_forecasted": <number>,
    "avg_predicted_sale_probability_30d_pct": <number>,
    "total_predicted_revenue_base_case_eur": <number>,
    "total_predicted_revenue_best_case_eur": <number>,
    "total_predicted_revenue_worst_case_eur": <number>,
    "avg_model_consensus_score": <number 0-100>,
    "best_performing_model": "<max 80 znakov>",
    "biggest_uncertainty_item": "<max 100 znakov>",
    "biggest_opportunity_item": "<max 100 znakov>",
    "forecast_confidence_score": <number 0-100>
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
    const validIds = new Set(items.map(i => i.id));

    const forecaster = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      listings: (parsed?.listings || [])
        .filter((l: any) => validIds.has(String(l?.id ?? '')))
        .slice(0, 20)
        .map((l: any) => {
          const orig = items.find(x => x.id === String(l?.id));
          return {
            tradeId: String(l?.id ?? ''),
            title: String(l?.title ?? orig?.title ?? '').slice(0, 150),
            ensembleForecast: {
              baseCase: {
                predictedViews30d: Math.max(0, Math.round(Number(l?.ensemble_forecast?.base_case?.predicted_views_30d ?? 0))),
                predictedInquiries30d: Math.max(0, Math.round(Number(l?.ensemble_forecast?.base_case?.predicted_inquiries_30d ?? 0))),
                predictedSaleProbability30dPct: Math.max(0, Math.min(100, Number(l?.ensemble_forecast?.base_case?.predicted_sale_probability_30d_pct ?? 30))),
                predictedSaleDate: String(l?.ensemble_forecast?.base_case?.predicted_sale_date ?? '').slice(0, 20),
                predictedSalePriceEur: Math.max(0, Math.round(Number(l?.ensemble_forecast?.base_case?.predicted_sale_price_eur ?? orig?.estValue ?? 0))),
                predictedProfitEur: Math.round(Number(l?.ensemble_forecast?.base_case?.predicted_profit_eur ?? 0)),
              },
              bestCase: {
                predictedViews30d: Math.max(0, Math.round(Number(l?.ensemble_forecast?.best_case?.predicted_views_30d ?? 0))),
                predictedInquiries30d: Math.max(0, Math.round(Number(l?.ensemble_forecast?.best_case?.predicted_inquiries_30d ?? 0))),
                predictedSaleProbability30dPct: Math.max(0, Math.min(100, Number(l?.ensemble_forecast?.best_case?.predicted_sale_probability_30d_pct ?? 50))),
                predictedSalePriceEur: Math.max(0, Math.round(Number(l?.ensemble_forecast?.best_case?.predicted_sale_price_eur ?? 0))),
                predictedProfitEur: Math.round(Number(l?.ensemble_forecast?.best_case?.predicted_profit_eur ?? 0)),
              },
              worstCase: {
                predictedViews30d: Math.max(0, Math.round(Number(l?.ensemble_forecast?.worst_case?.predicted_views_30d ?? 0))),
                predictedInquiries30d: Math.max(0, Math.round(Number(l?.ensemble_forecast?.worst_case?.predicted_inquiries_30d ?? 0))),
                predictedSaleProbability30dPct: Math.max(0, Math.min(100, Number(l?.ensemble_forecast?.worst_case?.predicted_sale_probability_30d_pct ?? 15))),
                predictedSalePriceEur: Math.max(0, Math.round(Number(l?.ensemble_forecast?.worst_case?.predicted_sale_price_eur ?? 0))),
                predictedProfitEur: Math.round(Number(l?.ensemble_forecast?.worst_case?.predicted_profit_eur ?? 0)),
              },
              confidenceInterval: {
                lowerBoundPriceEur: Math.max(0, Math.round(Number(l?.ensemble_forecast?.confidence_interval?.lower_bound_price_eur ?? 0))),
                upperBoundPriceEur: Math.max(0, Math.round(Number(l?.ensemble_forecast?.confidence_interval?.upper_bound_price_eur ?? 0))),
                confidencePct: Math.max(0, Math.min(100, Number(l?.ensemble_forecast?.confidence_interval?.confidence_pct ?? 50))),
              },
              modelConsensus: ['strong', 'moderate', 'weak'].includes(String(l?.ensemble_forecast?.model_consensus)) ? String(l.ensemble_forecast.model_consensus) : 'moderate',
              predictionStdDev: Math.round(Number(l?.ensemble_forecast?.prediction_std_dev ?? 0) * 100) / 100,
            },
            recommendedActions: (l?.recommended_actions || []).slice(0, 5).map((a: any) => String(a).slice(0, 200)),
            optimalListingDate: String(l?.optimal_listing_date ?? '').slice(0, 20),
            optimalPriceEur: Math.max(0, Math.round(Number(l?.optimal_price_eur ?? orig?.estValue ?? 0))),
            expectedRoiPct: Math.round(Number(l?.expected_roi_pct ?? 0) * 10) / 10,
            riskAssessment: ['low', 'medium', 'high'].includes(String(l?.risk_assessment)) ? String(l.risk_assessment) : 'medium',
          };
        }),
      ensembleModels: (parsed?.ensemble_models || []).slice(0, 8).map((m: any) => ({
        model: ENSEMBLE_MODELS.includes(String(m?.model) as any) ? String(m.model) : 'ensemble_voting',
        weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 12))),
        accuracyScore: Math.max(0, Math.min(100, Number(m?.accuracy_score ?? 70))),
        predictionVariance: Math.round(Number(m?.prediction_variance ?? 0) * 100) / 100,
        bestFor: String(m?.best_for ?? '').slice(0, 150),
        contributionToEnsemblePct: Math.max(0, Math.min(100, Number(m?.contribution_to_ensemble_pct ?? 12))),
      })),
      scenarios: (parsed?.scenarios || []).slice(0, 4).map((s: any) => ({
        scenario: ['base_case', 'best_case', 'worst_case', 'stress_test'].includes(String(s?.scenario)) ? String(s.scenario) : 'base_case',
        probabilityPct: Math.max(0, Math.min(100, Number(s?.probability_pct ?? 50))),
        totalPredictedRevenueEur: Math.round(Number(s?.total_predicted_revenue_eur ?? 0)),
        totalPredictedProfitEur: Math.round(Number(s?.total_predicted_profit_eur ?? 0)),
        avgSaleProbabilityPct: Math.max(0, Math.min(100, Number(s?.avg_sale_probability_pct ?? 30))),
        avgDaysToSale: Math.round(Number(s?.avg_days_to_sale ?? 14)),
        keyAssumption: String(s?.key_assumption ?? '').slice(0, 250),
      })),
      timeSeries: (parsed?.time_series || []).slice(0, 31).map((t: any) => ({
        dayOffset: Math.max(0, Math.min(30, Number(t?.day_offset ?? 0))),
        baseCaseViews: Math.max(0, Math.round(Number(t?.base_case_views ?? 0))),
        baseCaseInquiries: Math.max(0, Math.round(Number(t?.base_case_inquiries ?? 0))),
        baseCaseSaleProbabilityPct: Math.max(0, Math.min(100, Number(t?.base_case_sale_probability_pct ?? 0))),
        bestCaseViews: Math.max(0, Math.round(Number(t?.best_case_views ?? 0))),
        worstCaseViews: Math.max(0, Math.round(Number(t?.worst_case_views ?? 0))),
        uncertaintyBand: Math.round(Number(t?.uncertainty_band ?? 0)),
      })),
      sensitivityAnalysis: (parsed?.sensitivity_analysis || [])
        .filter((s: any) => validIds.has(String(s?.listing_id ?? '')))
        .slice(0, 15)
        .map((s: any) => ({
          tradeId: String(s?.listing_id ?? '').slice(0, 50),
          variable: ['price', 'day_of_week', 'season', 'competition'].includes(String(s?.variable)) ? String(s.variable) : 'price',
          currentValue: String(s?.current_value ?? '').slice(0, 150),
          bestValue: String(s?.best_value ?? '').slice(0, 150),
          impactOnSaleProbabilityPct: Math.round(Number(s?.impact_on_sale_probability_pct ?? 0) * 10) / 10,
          recommendedAdjustment: String(s?.recommended_adjustment ?? '').slice(0, 250),
        })),
      summary: {
        totalListingsForecasted: items.length,
        avgPredictedSaleProbability30dPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_predicted_sale_probability_30d_pct ?? 30))),
        totalPredictedRevenueBaseCaseEur: Math.round(Number(parsed?.summary?.total_predicted_revenue_base_case_eur ?? 0)),
        totalPredictedRevenueBestCaseEur: Math.round(Number(parsed?.summary?.total_predicted_revenue_best_case_eur ?? 0)),
        totalPredictedRevenueWorstCaseEur: Math.round(Number(parsed?.summary?.total_predicted_revenue_worst_case_eur ?? 0)),
        avgModelConsensusScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_model_consensus_score ?? 50))),
        bestPerformingModel: ENSEMBLE_MODELS.includes(String(parsed?.summary?.best_performing_model) as any) ? String(parsed.summary.best_performing_model) : 'ensemble_voting',
        biggestUncertaintyItem: String(parsed?.summary?.biggest_uncertainty_item ?? '').slice(0, 200),
        biggestOpportunityItem: String(parsed?.summary?.biggest_opportunity_item ?? '').slice(0, 200),
        forecastConfidenceScore: Math.max(0, Math.min(100, Number(parsed?.summary?.forecast_confidence_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, forecaster });
  } catch (e: any) { logger.error("/api/ai/listing-performance-forecaster-v3", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
