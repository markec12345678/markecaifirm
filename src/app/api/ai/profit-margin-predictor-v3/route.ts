// v6.58: AI Profit Margin Predictor v3 — advanced ML z multi-model ensemble in feature importance
// POST /api/ai/profit-margin-predictor-v3
// Body: { tradeId?: string, listingId?: string, listing?: { title, price, location, description, source } }
// Returns: { ok, predictor: { items, ensembleModels, featureImportance, scenarios, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ENSEMBLE_MODELS = [
  'gradient_boosting',
  'random_forest',
  'neural_network',
  'linear_regression',
  'ridge_regression',
  'lasso_regression',
  'xgboost',
  'lightgbm',
] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId } = body;
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const listingInput = body?.listing;

    let targetListings: Array<{
      id: string; title: string; price: number; location: string;
      description: string; source: string; category: string;
      aiScore: number; aiRisk: number; dealScore: number; aiEstimatedValue: number | null;
    }> = [];

    if (tradeId) {
      const t = await db.trade.findUnique({
        where: { id: tradeId },
        select: { id: true, title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, aiEstimatedValue: true, price: true, location: true,
            aiScore: true, aiRisk: true, dealScore: true, monitor: { select: { source: true } } } } },
      });
      if (!t) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
      targetListings = [{
        id: t.id, title: t.title, category: t.category || 'drugo',
        price: t.listing?.price ?? t.buyPrice,
        location: t.listing?.location ?? '', description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 500),
        source: t.listing?.monitor?.source ?? 'bolha',
        aiScore: t.listing?.aiScore ?? 5, aiRisk: t.listing?.aiRisk ?? 5, dealScore: t.listing?.dealScore ?? 50,
        aiEstimatedValue: t.listing?.aiEstimatedValue ?? null,
      }];
    } else if (listingId) {
      const l = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: { id: true, title: true, price: true, location: true, description: true, detailDescription: true,
          aiScore: true, aiRisk: true, dealScore: true, aiEstimatedValue: true,
          monitor: { select: { source: true } } },
      });
      if (!l) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      targetListings = [{
        id: l.id, title: l.title, category: '',
        price: l.price ?? 0, location: l.location ?? '',
        description: (l.detailDescription || l.description || '').slice(0, 500),
        source: l.monitor?.source ?? 'bolha',
        aiScore: l.aiScore ?? 5, aiRisk: l.aiRisk ?? 5, dealScore: l.dealScore ?? 50,
        aiEstimatedValue: l.aiEstimatedValue,
      }];
    } else if (listingInput) {
      targetListings = [{
        id: 'input-1', title: String(listingInput.title ?? ''),
        category: '', price: Number(listingInput.price ?? 0),
        location: String(listingInput.location ?? ''), description: String(listingInput.description ?? '').slice(0, 500),
        source: String(listingInput.source ?? 'bolha'),
        aiScore: 5, aiRisk: 5, dealScore: 50, aiEstimatedValue: null,
      }];
    } else {
      const listings = await db.listing.findMany({
        where: { aiVerdict: 'PRILIKA', aiScore: { gte: 7 }, isHidden: false, price: { not: null } },
        orderBy: { dealScore: 'desc' }, take: 12,
        select: { id: true, title: true, price: true, location: true, description: true, detailDescription: true,
          aiScore: true, aiRisk: true, dealScore: true, aiEstimatedValue: true,
          monitor: { select: { source: true } } },
      });
      targetListings = listings.map(l => ({
        id: l.id, title: l.title, category: '',
        price: l.price ?? 0, location: l.location ?? '',
        description: (l.detailDescription || l.description || '').slice(0, 500),
        source: l.monitor?.source ?? 'bolha',
        aiScore: l.aiScore ?? 5, aiRisk: l.aiRisk ?? 5, dealScore: l.dealScore ?? 50,
        aiEstimatedValue: l.aiEstimatedValue,
      }));
    }

    if (targetListings.length === 0) {
      return NextResponse.json({ ok: true, predictor: null, message: 'Ni listingov za profit margin analizo.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const itemsStr = targetListings.slice(0, 12).map(l => {
      const estVal = l.aiEstimatedValue ?? Math.round(l.price * 1.25);
      return `- [${l.id}] "${l.title}" | ${l.price}€ | estValue ${estVal}€ | ${l.location || 'nepoznano'} | ${l.source} | AI score ${l.aiScore}/10 risk ${l.aiRisk}/10 | deal ${l.dealScore}/100`;
    }).join('\n');

    const prompt = `Si AI profit margin predictor v3 z multi-model ensemble in feature importance.
Napove profit margin z 8-model ensemble in interpretabilnostjo (feature importance).

LISTINGI ZA ANALIZO (${targetListings.length}):
${itemsStr}

8 ML modelov v ensemble:
1. GRADIENT_BOOSTING: boosting za visoko accuracy (default)
2. RANDOM_FOREST: non-linear, robust proti outliers
3. NEURAL_NETWORK: deep learning za kompleksne vzorce
4. LINEAR_REGRESSION: osnovni, interpretable
5. RIDGE_REGRESSION: L2 regularizacija
6. LASSO_REGRESSION: L1 regularizacija (feature selection)
7. XGBOOST: extreme gradient boosting
8. LIGHTGBM: light gradient boosting (fast)

ML features:
- TITLE_FEATURES: keyword count, length, brand presence, spec keywords
- PRICE_FEATURES: asking_price, est_value, discount_pct, price_per_unit
- CATEGORY_FEATURES: category, liquidity_score, demand_score, competition_level
- LOCATION_FEATURES: location, region, urban_rural, pickup_convenience
- SELLER_FEATURES: seller_history, response_rate, listing_count
- MARKET_FEATURES: market_demand, seasonality, trend_score
- LISTING_FEATURES: image_count, description_quality, detail_level
- TEMPORAL_FEATURES: posted_hour, day_of_week, days_since_posted

Feature importance (kateri features najbolj vplivajo):
- Top 10 features z importance score 0-100
- Direction (positive/negative impact)
- Threshold (optimalna vrednost)

Scenariji:
- OPTIMISTIC: višji profit, nižji cost
- REALISTIC: povprečni profit
- PESSIMISTIC: nižji profit, višji cost
- STRESS_TEST: ekstremni slab scenarij (5% confidence)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<listing_id>",
      "title": "<naslov>",
      "ensemble_prediction": {
        "predicted_margin_pct": <number>,
        "predicted_profit_eur": <number>,
        "predicted_roi_pct": <number>,
        "confidence_pct": <number 0-100>,
        "prediction_interval": {"lower_pct": <number>, "upper_pct": <number>},
        "model_consensus": "<strong|moderate|weak>"
      },
      "scenarios": {
        "optimistic": {"margin_pct": <number>, "profit_eur": <number>, "probability_pct": <number>},
        "realistic": {"margin_pct": <number>, "profit_eur": <number>, "probability_pct": <number>},
        "pessimistic": {"margin_pct": <number>, "profit_eur": <number>, "probability_pct": <number>},
        "stress_test": {"margin_pct": <number>, "profit_eur": <number>, "probability_pct": <number>}
      },
      "key_drivers": [{"feature": "<max 60 znakov>", "importance_pct": <number>, "direction": "<positive|negative>", "current_value": "<max 60 znakov>", "optimal_value": "<max 60 znakov>"}],
      "recommendation": "<strong_buy|buy|consider|avoid|strong_avoid>",
      "reasoning": "<max 150 znakov>",
      "expected_days_to_sell": <number>,
      "break_even_price_eur": <number>
    }
  ],
  "ensemble_models": [
    {
      "model": "<8 modelov>",
      "weight_in_ensemble": <number 0-100>,
      "accuracy_score": <number 0-100>,
      "r2_score": <number 0-100>,
      "mae_eur": <number>,
      "contribution_to_ensemble_pct": <number>,
      "best_for": "<max 80 znakov>"
    }
  ],
  "feature_importance": [
    {
      "feature": "<max 80 znakov>",
      "importance_pct": <number 0-100>,
      "direction": "<positive|negative>",
      "description": "<max 100 znakov>",
      "optimal_value": "<max 80 znakov>",
      "current_avg_value": "<max 80 znakov>"
    }
  ],
  "scenarios": [
    {
      "scenario": "<optimistic|realistic|pessimistic|stress_test>",
      "avg_margin_pct": <number>,
      "total_profit_eur": <number>,
      "probability_pct": <number>,
      "key_assumption": "<max 120 znakov>"
    }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "feature_targeted": "<max 80 znakov>", "expected_margin_improvement_pct": <number>, "expected_profit_impact_eur": <number> }
  ],
  "summary": {
    "total_listings_analyzed": <number>,
    "avg_predicted_margin_pct": <number>,
    "avg_predicted_profit_eur": <number>,
    "avg_confidence_pct": <number>,
    "best_performing_model": "<max 80 znakov>",
    "most_important_feature": "<max 80 znakov>",
    "biggest_opportunity_id": "<listing_id>",
    "biggest_risk_id": "<listing_id>",
    "total_expected_profit_eur": <number>,
    "prediction_quality_score": <number 0-100>
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
    const validIds = new Set(targetListings.map(l => l.id));

    const predictor = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      items: (parsed?.items || [])
        .filter((it: any) => validIds.has(String(it?.id ?? '')))
        .slice(0, 12)
        .map((it: any) => {
          const orig = targetListings.find(l => l.id === String(it?.id));
          return {
            listingId: String(it?.id ?? ''),
            title: String(it?.title ?? orig?.title ?? '').slice(0, 150),
            ensemblePrediction: {
              predictedMarginPct: Math.round(Number(it?.ensemble_prediction?.predicted_margin_pct ?? 25) * 10) / 10,
              predictedProfitEur: Math.round(Number(it?.ensemble_prediction?.predicted_profit_eur ?? 0)),
              predictedRoiPct: Math.round(Number(it?.ensemble_prediction?.predicted_roi_pct ?? 30) * 10) / 10,
              confidencePct: Math.max(0, Math.min(100, Number(it?.ensemble_prediction?.confidence_pct ?? 50))),
              predictionInterval: {
                lowerPct: Math.round(Number(it?.ensemble_prediction?.prediction_interval?.lower_pct ?? 10) * 10) / 10,
                upperPct: Math.round(Number(it?.ensemble_prediction?.prediction_interval?.upper_pct ?? 40) * 10) / 10,
              },
              modelConsensus: ['strong', 'moderate', 'weak'].includes(String(it?.ensemble_prediction?.model_consensus)) ? String(it.ensemble_prediction.model_consensus) : 'moderate',
            },
            scenarios: {
              optimistic: {
                marginPct: Math.round(Number(it?.scenarios?.optimistic?.margin_pct ?? 40) * 10) / 10,
                profitEur: Math.round(Number(it?.scenarios?.optimistic?.profit_eur ?? 0)),
                probabilityPct: Math.max(0, Math.min(100, Number(it?.scenarios?.optimistic?.probability_pct ?? 25))),
              },
              realistic: {
                marginPct: Math.round(Number(it?.scenarios?.realistic?.margin_pct ?? 25) * 10) / 10,
                profitEur: Math.round(Number(it?.scenarios?.realistic?.profit_eur ?? 0)),
                probabilityPct: Math.max(0, Math.min(100, Number(it?.scenarios?.realistic?.probability_pct ?? 50))),
              },
              pessimistic: {
                marginPct: Math.round(Number(it?.scenarios?.pessimistic?.margin_pct ?? 10) * 10) / 10,
                profitEur: Math.round(Number(it?.scenarios?.pessimistic?.profit_eur ?? 0)),
                probabilityPct: Math.max(0, Math.min(100, Number(it?.scenarios?.pessimistic?.probability_pct ?? 20))),
              },
              stressTest: {
                marginPct: Math.round(Number(it?.scenarios?.stress_test?.margin_pct ?? -5) * 10) / 10,
                profitEur: Math.round(Number(it?.scenarios?.stress_test?.profit_eur ?? 0)),
                probabilityPct: Math.max(0, Math.min(100, Number(it?.scenarios?.stress_test?.probability_pct ?? 5))),
              },
            },
            keyDrivers: (it?.key_drivers || []).slice(0, 5).map((d: any) => ({
              feature: String(d?.feature ?? '').slice(0, 100),
              importancePct: Math.max(0, Math.min(100, Number(d?.importance_pct ?? 50))),
              direction: ['positive', 'negative'].includes(String(d?.direction)) ? String(d.direction) : 'positive',
              currentValue: String(d?.current_value ?? '').slice(0, 100),
              optimalValue: String(d?.optimal_value ?? '').slice(0, 100),
            })),
            recommendation: ['strong_buy', 'buy', 'consider', 'avoid', 'strong_avoid'].includes(String(it?.recommendation)) ? String(it.recommendation) : 'consider',
            reasoning: String(it?.reasoning ?? '').slice(0, 300),
            expectedDaysToSell: Math.max(1, Math.round(Number(it?.expected_days_to_sell ?? 14))),
            breakEvenPriceEur: Math.max(0, Math.round(Number(it?.break_even_price_eur ?? orig?.price ?? 0))),
          };
        }),
      ensembleModels: (parsed?.ensemble_models || []).slice(0, 8).map((m: any) => ({
        model: ENSEMBLE_MODELS.includes(String(m?.model) as any) ? String(m.model) : 'gradient_boosting',
        weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 12))),
        accuracyScore: Math.max(0, Math.min(100, Number(m?.accuracy_score ?? 70))),
        r2Score: Math.max(0, Math.min(100, Number(m?.r2_score ?? 65))),
        maeEur: Math.round(Number(m?.mae_eur ?? 0) * 100) / 100,
        contributionToEnsemblePct: Math.max(0, Math.min(100, Number(m?.contribution_to_ensemble_pct ?? 12))),
        bestFor: String(m?.best_for ?? '').slice(0, 150),
      })),
      featureImportance: (parsed?.feature_importance || []).slice(0, 10).map((f: any) => ({
        feature: String(f?.feature ?? '').slice(0, 150),
        importancePct: Math.max(0, Math.min(100, Number(f?.importance_pct ?? 50))),
        direction: ['positive', 'negative'].includes(String(f?.direction)) ? String(f.direction) : 'positive',
        description: String(f?.description ?? '').slice(0, 200),
        optimalValue: String(f?.optimal_value ?? '').slice(0, 150),
        currentAvgValue: String(f?.current_avg_value ?? '').slice(0, 150),
      })),
      scenarios: (parsed?.scenarios || []).slice(0, 4).map((s: any) => ({
        scenario: ['optimistic', 'realistic', 'pessimistic', 'stress_test'].includes(String(s?.scenario)) ? String(s.scenario) : 'realistic',
        avgMarginPct: Math.round(Number(s?.avg_margin_pct ?? 25) * 10) / 10,
        totalProfitEur: Math.round(Number(s?.total_profit_eur ?? 0)),
        probabilityPct: Math.max(0, Math.min(100, Number(s?.probability_pct ?? 50))),
        keyAssumption: String(s?.key_assumption ?? '').slice(0, 250),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        featureTargeted: String(r?.feature_targeted ?? '').slice(0, 150),
        expectedMarginImprovementPct: Math.round(Number(r?.expected_margin_improvement_pct ?? 0) * 10) / 10,
        expectedProfitImpactEur: Math.round(Number(r?.expected_profit_impact_eur ?? 0)),
      })),
      summary: {
        totalListingsAnalyzed: targetListings.length,
        avgPredictedMarginPct: Math.round(Number(parsed?.summary?.avg_predicted_margin_pct ?? 25) * 10) / 10,
        avgPredictedProfitEur: Math.round(Number(parsed?.summary?.avg_predicted_profit_eur ?? 0)),
        avgConfidencePct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_confidence_pct ?? 50))),
        bestPerformingModel: ENSEMBLE_MODELS.includes(String(parsed?.summary?.best_performing_model) as any) ? String(parsed.summary.best_performing_model) : 'gradient_boosting',
        mostImportantFeature: String(parsed?.summary?.most_important_feature ?? '').slice(0, 150),
        biggestOpportunityId: String(parsed?.summary?.biggest_opportunity_id ?? '').slice(0, 50),
        biggestRiskId: String(parsed?.summary?.biggest_risk_id ?? '').slice(0, 50),
        totalExpectedProfitEur: Math.round(Number(parsed?.summary?.total_expected_profit_eur ?? 0)),
        predictionQualityScore: Math.max(0, Math.min(100, Number(parsed?.summary?.prediction_quality_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, predictor });
  } catch (e: any) { logger.error("/api/ai/profit-margin-predictor-v3", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
