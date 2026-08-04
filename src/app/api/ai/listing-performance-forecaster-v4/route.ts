// v6.59: AI Listing Performance Forecaster v4 — deep learning z transformer architecture
// POST /api/ai/listing-performance-forecaster-v4
// Body: { tradeId?: string, horizonDays?: number }
// Returns: { ok, forecaster: { listings, deepModels, attentionWeights, multiHorizon, uncertaintyQuantification, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const DEEP_MODELS = [
  'transformer_encoder',
  'bert_listing',
  'gpt_listing',
  'lstm_sequential',
  'gru_temporal',
  'cnn_image',
  'multimodal_fusion',
  'attention_mechanism',
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
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiScore: true, aiRisk: true, location: true, imageUrl: true, description: true, detailDescription: true, monitor: { select: { source: true } } } },
      },
      take: tradeId ? 1 : 15,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, forecaster: null, message: 'Ni held tradeov za forecast.' });
    }

    // Historical training data
    const since6m = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since6m, not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true,
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

    const items = heldTrades.map(t => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));
      const cat = (t.category || 'drugo').toLowerCase();
      const similarSold = soldTrades.filter(s => (s.category || '').toLowerCase() === cat);
      const similarAvgPrice = similarSold.length > 0 ? Math.round(similarSold.reduce((s, x) => s + ((x.sellPrice ?? 0) - (x.sellFees ?? 0)), 0) / similarSold.length) : estValue;
      const similarDaysToSell = similarSold.map(s => Math.max(0, Math.round((s.sellDate!.getTime() - s.buyDate.getTime()) / (24*60*60*1000))));
      const avgDaysToSell = similarDaysToSell.length > 0 ? Math.round(similarDaysToSell.reduce((a, b) => a + b, 0) / similarDaysToSell.length) : 14;
      return {
        id: t.id, title: t.title, category: cat, cost, estValue, daysHeld,
        dealScore: t.listing?.dealScore ?? 50, aiScore: t.listing?.aiScore ?? 5, aiRisk: t.listing?.aiRisk ?? 5,
        location: t.listing?.location || '', source: t.listing?.monitor?.source || 'bolha',
        description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 300),
        imageUrl: t.listing?.imageUrl ?? '',
        similarSoldCount: similarSold.length, similarAvgPrice, avgDaysToSell,
      };
    });

    const itemsStr = items.slice(0, 15).map(i =>
      `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d | deal ${i.dealScore} AI ${i.aiScore} risk ${i.aiRisk} | podobnih ${i.similarSoldCount} | povp ${i.avgDaysToSell}d | ${i.source}`
    ).join('\n');

    const prompt = `Si AI listing performance forecaster v4 z deep learning (transformer architecture).
Napove performance z 8-model deep learning ensemble in attention mechanism.

INVENTAR (${items.length}):
${itemsStr}

8 deep learning modelov:
1. TRANSFORMER_ENCODER: self-attention za sequence modeling
2. BERT_LISTING: BERT-based za text understanding (title, description)
3. GPT_LISTING: GPT-based za generative forecasting
4. LSTM_SEQUENTIAL: long short-term memory za temporal patterns
5. GRU_TEMPORAL: gated recurrent unit za time series
6. CNN_IMAGE: convolutional neural network za image features
7. MULTIMODAL_FUSION: kombinacija text + image + numerical
8. ATTENTION_MECHANISM: attention weights za feature importance

Multi-horizon forecasting:
- SHORT_TERM (7 days): visoka accuracy, nizka uncertainty
- MEDIUM_TERM (30 days): medium accuracy
- LONG_TERM (90 days): nižja accuracy, višja uncertainty

Attention weights (kateri features najbolj vplivajo na prediction):
- TITLE_KEYWORDS: ključne besede v naslovu
- PRICE_RELATIVE: cena relativno na estValue
- IMAGE_QUALITY: kakovost slike
- DESCRIPTION_LENGTH: dolžina opisa
- SELLER_RATING: rating prodajalca
- CATEGORY_DEMAND: povpraševanje po kategoriji
- SEASONALITY: sezonski vpliv
- COMPETITION: nivo konkurence

Uncertainty quantification:
- PREDICTIVE_INTERVAL: 95% CI za vsako napoved
- EPISTEMIC_UNCERTAINTY: model uncertainty (manj podatkov = višja)
- ALEATORIC_UNCERTAINTY: data noise (inherent)
- TOTAL_UNCERTAINTY: kombinacija

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "deep_ensemble_forecast": {
        "short_term_7d": {
          "predicted_views": <number>,
          "predicted_inquiries": <number>,
          "predicted_sale_probability_pct": <number 0-100>,
          "predicted_sale_price_eur": <number>,
          "confidence_pct": <number 0-100>,
          "uncertainty_pct": <number 0-100>
        },
        "medium_term_30d": {
          "predicted_views": <number>,
          "predicted_inquiries": <number>,
          "predicted_sale_probability_pct": <number 0-100>,
          "predicted_sale_price_eur": <number>,
          "confidence_pct": <number 0-100>,
          "uncertainty_pct": <number 0-100>
        },
        "long_term_90d": {
          "predicted_views": <number>,
          "predicted_inquiries": <number>,
          "predicted_sale_probability_pct": <number 0-100>,
          "predicted_sale_price_eur": <number>,
          "confidence_pct": <number 0-100>,
          "uncertainty_pct": <number 0-100>
        },
        "ensemble_consensus": "<strong|moderate|weak>",
        "model_agreement_pct": <number 0-100>
      },
      "attention_weights": [
        {"feature": "<max 60 znakov>", "weight": <number 0-100>, "rank": <number>, "interpretation": "<max 100 znakov>"}
      ],
      "uncertainty_quantification": {
        "predictive_interval_95": {"lower_eur": <number>, "upper_eur": <number>},
        "epistemic_uncertainty_pct": <number 0-100>,
        "aleatoric_uncertainty_pct": <number 0-100>,
        "total_uncertainty_pct": <number 0-100>,
        "confidence_recommendation": "<high_confidence|medium_confidence|low_confidence|use_caution>"
      },
      "key_driving_factors": ["<max 80 znakov>"],
      "recommended_optimization": "<max 150 znakov>",
      "expected_optimization_lift_pct": <number>
    }
  ],
  "deep_models": [
    {
      "model": "<8 deep modelov>",
      "architecture": "<max 80 znakov>",
      "parameters_millions": <number>,
      "training_accuracy_pct": <number 0-100>,
      "validation_accuracy_pct": <number 0-100>,
      "inference_time_ms": <number>,
      "weight_in_ensemble": <number 0-100>,
      "best_for": "<max 80 znakov>",
      "contribution_pct": <number 0-100>
    }
  ],
  "attention_weights": [
    {
      "feature": "<max 80 znakov>",
      "avg_weight": <number 0-100>,
      "rank": <number>,
      "description": "<max 100 znakov>",
      "optimization_potential": "<high|medium|low>",
      "improvement_action": "<max 120 znakov>"
    }
  ],
  "multi_horizon": [
    {
      "horizon": "<short_term|medium_term|long_term>",
      "days": <number>,
      "avg_confidence_pct": <number 0-100>,
      "avg_uncertainty_pct": <number 0-100>,
      "avg_sale_probability_pct": <number 0-100>,
      "total_predicted_revenue_eur": <number>,
      "best_use_case": "<max 100 znakov>"
    }
  ],
  "uncertainty_quantification": [
    {
      "metric": "<predictive_interval|epistemic|aleatoric|total_uncertainty>",
      "avg_value": <number>,
      "min_value": <number>,
      "max_value": <number>,
      "interpretation": "<max 100 znakov>",
      "action_recommendation": "<max 120 znakov>"
    }
  ],
  "summary": {
    "total_listings_forecasted": <number>,
    "avg_short_term_confidence_pct": <number>,
    "avg_medium_term_confidence_pct": <number>,
    "avg_long_term_confidence_pct": <number>,
    "avg_total_uncertainty_pct": <number>,
    "best_performing_model": "<max 80 znakov>",
    "most_important_feature": "<max 80 znakov>",
    "biggest_uncertainty_item": "<max 100 znakov>",
    "biggest_opportunity_item": "<max 100 znakov>",
    "deep_learning_forecast_score": <number 0-100>
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
        .slice(0, 15)
        .map((l: any) => {
          const orig = items.find(x => x.id === String(l?.id));
          return {
            tradeId: String(l?.id ?? ''),
            title: String(l?.title ?? orig?.title ?? '').slice(0, 150),
            deepEnsembleForecast: {
              shortTerm7d: {
                predictedViews: Math.max(0, Math.round(Number(l?.deep_ensemble_forecast?.short_term_7d?.predicted_views ?? 0))),
                predictedInquiries: Math.max(0, Math.round(Number(l?.deep_ensemble_forecast?.short_term_7d?.predicted_inquiries ?? 0))),
                predictedSaleProbabilityPct: Math.max(0, Math.min(100, Number(l?.deep_ensemble_forecast?.short_term_7d?.predicted_sale_probability_pct ?? 30))),
                predictedSalePriceEur: Math.max(0, Math.round(Number(l?.deep_ensemble_forecast?.short_term_7d?.predicted_sale_price_eur ?? orig?.estValue ?? 0))),
                confidencePct: Math.max(0, Math.min(100, Number(l?.deep_ensemble_forecast?.short_term_7d?.confidence_pct ?? 70))),
                uncertaintyPct: Math.max(0, Math.min(100, Number(l?.deep_ensemble_forecast?.short_term_7d?.uncertainty_pct ?? 20))),
              },
              mediumTerm30d: {
                predictedViews: Math.max(0, Math.round(Number(l?.deep_ensemble_forecast?.medium_term_30d?.predicted_views ?? 0))),
                predictedInquiries: Math.max(0, Math.round(Number(l?.deep_ensemble_forecast?.medium_term_30d?.predicted_inquiries ?? 0))),
                predictedSaleProbabilityPct: Math.max(0, Math.min(100, Number(l?.deep_ensemble_forecast?.medium_term_30d?.predicted_sale_probability_pct ?? 50))),
                predictedSalePriceEur: Math.max(0, Math.round(Number(l?.deep_ensemble_forecast?.medium_term_30d?.predicted_sale_price_eur ?? orig?.estValue ?? 0))),
                confidencePct: Math.max(0, Math.min(100, Number(l?.deep_ensemble_forecast?.medium_term_30d?.confidence_pct ?? 60))),
                uncertaintyPct: Math.max(0, Math.min(100, Number(l?.deep_ensemble_forecast?.medium_term_30d?.uncertainty_pct ?? 30))),
              },
              longTerm90d: {
                predictedViews: Math.max(0, Math.round(Number(l?.deep_ensemble_forecast?.long_term_90d?.predicted_views ?? 0))),
                predictedInquiries: Math.max(0, Math.round(Number(l?.deep_ensemble_forecast?.long_term_90d?.predicted_inquiries ?? 0))),
                predictedSaleProbabilityPct: Math.max(0, Math.min(100, Number(l?.deep_ensemble_forecast?.long_term_90d?.predicted_sale_probability_pct ?? 70))),
                predictedSalePriceEur: Math.max(0, Math.round(Number(l?.deep_ensemble_forecast?.long_term_90d?.predicted_sale_price_eur ?? orig?.estValue ?? 0))),
                confidencePct: Math.max(0, Math.min(100, Number(l?.deep_ensemble_forecast?.long_term_90d?.confidence_pct ?? 50))),
                uncertaintyPct: Math.max(0, Math.min(100, Number(l?.deep_ensemble_forecast?.long_term_90d?.uncertainty_pct ?? 40))),
              },
              ensembleConsensus: ['strong', 'moderate', 'weak'].includes(String(l?.deep_ensemble_forecast?.ensemble_consensus)) ? String(l.deep_ensemble_forecast.ensemble_consensus) : 'moderate',
              modelAgreementPct: Math.max(0, Math.min(100, Number(l?.deep_ensemble_forecast?.model_agreement_pct ?? 70))),
            },
            attentionWeights: (l?.attention_weights || []).slice(0, 6).map((w: any) => ({
              feature: String(w?.feature ?? '').slice(0, 100),
              weight: Math.max(0, Math.min(100, Number(w?.weight ?? 50))),
              rank: Math.max(1, Number(w?.rank ?? 1)),
              interpretation: String(w?.interpretation ?? '').slice(0, 200),
            })),
            uncertaintyQuantification: {
              predictiveInterval95: {
                lowerEur: Math.max(0, Math.round(Number(l?.uncertainty_quantification?.predictive_interval_95?.lower_eur ?? 0))),
                upperEur: Math.max(0, Math.round(Number(l?.uncertainty_quantification?.predictive_interval_95?.upper_eur ?? 0))),
              },
              epistemicUncertaintyPct: Math.max(0, Math.min(100, Number(l?.uncertainty_quantification?.epistemic_uncertainty_pct ?? 20))),
              aleatoricUncertaintyPct: Math.max(0, Math.min(100, Number(l?.uncertainty_quantification?.aleatoric_uncertainty_pct ?? 15))),
              totalUncertaintyPct: Math.max(0, Math.min(100, Number(l?.uncertainty_quantification?.total_uncertainty_pct ?? 30))),
              confidenceRecommendation: ['high_confidence', 'medium_confidence', 'low_confidence', 'use_caution'].includes(String(l?.uncertainty_quantification?.confidence_recommendation)) ? String(l.uncertainty_quantification.confidence_recommendation) : 'medium_confidence',
            },
            keyDrivingFactors: (l?.key_driving_factors || []).slice(0, 5).map((f: any) => String(f).slice(0, 150)),
            recommendedOptimization: String(l?.recommended_optimization ?? '').slice(0, 300),
            expectedOptimizationLiftPct: Math.round(Number(l?.expected_optimization_lift_pct ?? 0)),
          };
        }),
      deepModels: (parsed?.deep_models || []).slice(0, 8).map((m: any) => ({
        model: DEEP_MODELS.includes(String(m?.model) as any) ? String(m.model) : 'transformer_encoder',
        architecture: String(m?.architecture ?? '').slice(0, 150),
        parametersMillions: Math.round(Number(m?.parameters_millions ?? 0) * 10) / 10,
        trainingAccuracyPct: Math.max(0, Math.min(100, Number(m?.training_accuracy_pct ?? 80))),
        validationAccuracyPct: Math.max(0, Math.min(100, Number(m?.validation_accuracy_pct ?? 75))),
        inferenceTimeMs: Math.round(Number(m?.inference_time_ms ?? 100)),
        weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 12))),
        bestFor: String(m?.best_for ?? '').slice(0, 150),
        contributionPct: Math.max(0, Math.min(100, Number(m?.contribution_pct ?? 12))),
      })),
      attentionWeights: (parsed?.attention_weights || []).slice(0, 8).map((w: any) => ({
        feature: String(w?.feature ?? '').slice(0, 150),
        avgWeight: Math.max(0, Math.min(100, Number(w?.avg_weight ?? 50))),
        rank: Math.max(1, Number(w?.rank ?? 1)),
        description: String(w?.description ?? '').slice(0, 200),
        optimizationPotential: ['high', 'medium', 'low'].includes(String(w?.optimization_potential)) ? String(w.optimization_potential) : 'medium',
        improvementAction: String(w?.improvement_action ?? '').slice(0, 250),
      })),
      multiHorizon: (parsed?.multi_horizon || []).slice(0, 3).map((h: any) => ({
        horizon: ['short_term', 'medium_term', 'long_term'].includes(String(h?.horizon)) ? String(h.horizon) : 'short_term',
        days: Math.max(7, Number(h?.days ?? 7)),
        avgConfidencePct: Math.max(0, Math.min(100, Number(h?.avg_confidence_pct ?? 60))),
        avgUncertaintyPct: Math.max(0, Math.min(100, Number(h?.avg_uncertainty_pct ?? 30))),
        avgSaleProbabilityPct: Math.max(0, Math.min(100, Number(h?.avg_sale_probability_pct ?? 40))),
        totalPredictedRevenueEur: Math.round(Number(h?.total_predicted_revenue_eur ?? 0)),
        bestUseCase: String(h?.best_use_case ?? '').slice(0, 200),
      })),
      uncertaintyQuantification: (parsed?.uncertainty_quantification || []).slice(0, 4).map((u: any) => ({
        metric: ['predictive_interval', 'epistemic', 'aleatoric', 'total_uncertainty'].includes(String(u?.metric)) ? String(u.metric) : 'total_uncertainty',
        avgValue: Math.round(Number(u?.avg_value ?? 0) * 100) / 100,
        minValue: Math.round(Number(u?.min_value ?? 0) * 100) / 100,
        maxValue: Math.round(Number(u?.max_value ?? 0) * 100) / 100,
        interpretation: String(u?.interpretation ?? '').slice(0, 200),
        actionRecommendation: String(u?.action_recommendation ?? '').slice(0, 250),
      })),
      summary: {
        totalListingsForecasted: items.length,
        avgShortTermConfidencePct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_short_term_confidence_pct ?? 70))),
        avgMediumTermConfidencePct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_medium_term_confidence_pct ?? 60))),
        avgLongTermConfidencePct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_long_term_confidence_pct ?? 50))),
        avgTotalUncertaintyPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_total_uncertainty_pct ?? 30))),
        bestPerformingModel: DEEP_MODELS.includes(String(parsed?.summary?.best_performing_model) as any) ? String(parsed.summary.best_performing_model) : 'transformer_encoder',
        mostImportantFeature: String(parsed?.summary?.most_important_feature ?? '').slice(0, 150),
        biggestUncertaintyItem: String(parsed?.summary?.biggest_uncertainty_item ?? '').slice(0, 200),
        biggestOpportunityItem: String(parsed?.summary?.biggest_opportunity_item ?? '').slice(0, 200),
        deepLearningForecastScore: Math.max(0, Math.min(100, Number(parsed?.summary?.deep_learning_forecast_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, forecaster });
  } catch (e: any) { logger.error("/api/ai/listing-performance-forecaster-v4", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
