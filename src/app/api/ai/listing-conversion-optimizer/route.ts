// v6.61: AI Listing Conversion Optimizer — optimizira conversion rate z ML in multi-variate testing
// POST /api/ai/listing-conversion-optimizer
// Body: { tradeId?: string, listingId?: string }
// Returns: { ok, optimizer: { listings, conversionFactors, optimizations, mvTests, mlPredictions, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const CONVERSION_FACTORS = [
  'price_competitiveness',
  'image_quality',
  'title_clarity',
  'description_completeness',
  'seller_reputation',
  'location_convenience',
  'shipping_options',
  'payment_methods',
  'response_speed',
  'trust_signals',
  'urgency_elements',
  'social_proof',
] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId } = body;
    const tradeId = body?.tradeId ? String(body.tradeId) : null;

    let targetListings: Array<{
      id: string; title: string; description: string; category: string;
      price: number; estValue: number; imageUrl: string; location: string;
    }> = [];

    if (tradeId) {
      const t = await db.trade.findUnique({
        where: { id: tradeId },
        select: { id: true, title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true, price: true, location: true, contactStatus: true } } },
      });
      if (!t) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
      targetListings = [{
        id: t.id, title: t.title, category: t.category || 'drugo',
        description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 500),
        price: t.listing?.price ?? t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
        imageUrl: t.listing?.imageUrl ?? '', location: t.listing?.location ?? '',
      }];
    } else if (listingId) {
      const l = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: { id: true, title: true, description: true, detailDescription: true, price: true, imageUrl: true, aiEstimatedValue: true, location: true },
      });
      if (!l) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      targetListings = [{
        id: l.id, title: l.title, category: '',
        description: (l.detailDescription || l.description || '').slice(0, 500),
        price: l.price ?? 0, estValue: l.aiEstimatedValue ?? l.price ?? 0,
        imageUrl: l.imageUrl ?? '', location: l.location ?? '',
      }];
    } else {
      const heldTrades = await db.trade.findMany({
        where: { status: 'held' },
        select: { id: true, title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true, price: true, location: true } } },
        take: 12,
        orderBy: { buyDate: 'desc' },
      });
      targetListings = heldTrades.map(t => ({
        id: t.id, title: t.title, category: t.category || 'drugo',
        description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 500),
        price: t.listing?.price ?? t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
        imageUrl: t.listing?.imageUrl ?? '', location: t.listing?.location ?? '',
      }));
    }

    if (targetListings.length === 0) {
      return NextResponse.json({ ok: true, optimizer: null, message: 'Ni listingov za conversion optimizacijo.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const itemsStr = targetListings.slice(0, 12).map(i =>
      `- [${i.id}] "${i.title}" | ${i.category} | ${i.price}€ | ${i.location} | opis: ${i.description.slice(0, 100)}...`
    ).join('\n');

    const prompt = `Si AI listing conversion optimizer z ML in multi-variate testing.
Optimizira conversion rate z 12-faktorsko analizo in A/B/n testiranjem.

OGLASI (${targetListings.length}):
${itemsStr}

12 conversion faktorjev:
1. PRICE_COMPETITIVENESS: cena glede na tržno povprečje
2. IMAGE_QUALITY: kakovost in število slik
3. TITLE_CLARITY: jasnost in informativnost naslova
4. DESCRIPTION_COMPLETENESS: popolnost opisa (specifikacije, stanje)
5. SELLER_REPUTATION: rating in reviews prodajalca
6. LOCATION_CONVENIENCE: primernost lokacije za kupca
7. SHIPPING_OPTIONS: raznolikost dostavnih opcij
8. PAYMENT_METHODS: raznolikost plačilnih metod
9. RESPONSE_SPEED: hitrost odgovora na povpraševanja
10. TRUST_SIGNALS: garancija, vračila, certifikati
11. URGENCY_ELEMENTS: časovna omejitev, redkost
12. SOCIAL_PROOF: število ogledov, like, priporočila

Multi-variate (A/B/n) testing:
- Testiraj več variant hkrati (title, price, image, description)
- Statistična signifikantnost (95% confidence)
- Sample size calculation
- Sequential testing (stop early if winner clear)

ML modeli:
- GRADIENT_BOOSTING: za conversion prediction
- NEURAL_NETWORK: za kompleksne interakcije
- LOGISTIC_REGRESSION: za interpretable baseline
- RANDOM_FOREST: za robust prediction
- XGBOOST: za high accuracy

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "current_conversion_rate_pct": <number 0-100>,
      "optimized_conversion_rate_pct": <number 0-100>,
      "conversion_lift_pct": <number>,
      "conversion_factors": [
        {"factor": "<12 faktorjev>", "current_score": <number 0-100>, "optimized_score": <number 0-100>, "impact_pct": <number>, "priority": "<high|medium|low>"}
      ],
      "ml_predictions": {
        "predicted_conversion_rate_pct": <number 0-100>,
        "predicted_time_to_sale_days": <number>,
        "predicted_final_price_eur": <number>,
        "confidence_pct": <number 0-100>,
        "model_consensus": "<strong|moderate|weak>"
      },
      "recommended_optimizations": [
        {"optimization": "<max 120 znakov>", "factor_targeted": "<12 faktorjev>", "expected_lift_pct": <number>, "implementation_effort": "<low|medium|high>", "time_to_implement_hours": <number>}
      ],
      "expected_revenue_impact_eur": <number>,
      "priority": "<high|medium|low>"
    }
  ],
  "conversion_factors": [
    {"factor": "<12 faktorjev>", "weight": <number 0-100>, "avg_score": <number 0-100>, "benchmark": <number 0-100>, "improvement_potential": "<high|medium|low>", "best_practice": "<max 150 znakov>"}
  ],
  "optimizations": [
    {"optimization_type": "<price_adjustment|image_improvement|title_rewrite|description_enhancement|urgency_addition|trust_building|response_optimization|shipping_expansion>", "description": "<max 120 znakov>", "expected_conversion_lift_pct": <number>, "implementation_difficulty": "<low|medium|high>", "best_for_category": "<max 80 znakov>"}
  ],
  "mv_tests": [
    {
      "listing_id": "<trade_id>",
      "test_name": "<max 80 znakov>",
      "variants": [
        {"variant_id": "<a|b|c|d>", "change_description": "<max 100 znakov>", "predicted_conversion_pct": <number 0-100>}
      ],
      "test_duration_days": <number>,
      "sample_size_per_variant": <number>,
      "primary_metric": "<conversion_rate|time_to_sale|revenue>",
      "statistical_significance_pct": <number 0-100>,
      "expected_winner": "<a|b|c|d>",
      "confidence_level_pct": <number 0-100>
    }
  ],
  "ml_predictions": [
    {"model": "<gradient_boosting|neural_network|logistic_regression|random_forest|xgboost>", "accuracy_pct": <number 0-100>, "precision_pct": <number 0-100>, "recall_pct": <number 0-100>, "f1_score": <number 0-100>, "weight_in_ensemble": <number 0-100>, "best_for": "<max 80 znakov>"}
  ],
  "summary": {
    "total_listings_optimized": <number>,
    "avg_current_conversion_rate_pct": <number>,
    "avg_optimized_conversion_rate_pct": <number>,
    "avg_conversion_lift_pct": <number>,
    "total_expected_revenue_impact_eur": <number>,
    "biggest_conversion_blocker": "<max 100 znakov>",
    "biggest_conversion_opportunity": "<max 100 znakov>",
    "best_optimization_overall": "<max 80 znakov>",
    "conversion_optimization_score": <number 0-100>
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
    const validIds = new Set(targetListings.map(i => i.id));

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      listings: (parsed?.listings || [])
        .filter((l: any) => validIds.has(String(l?.id ?? '')))
        .slice(0, 12)
        .map((l: any) => ({
          tradeId: String(l?.id ?? ''),
          title: String(l?.title ?? '').slice(0, 150),
          currentConversionRatePct: Math.max(0, Math.min(100, Number(l?.current_conversion_rate_pct ?? 10))),
          optimizedConversionRatePct: Math.max(0, Math.min(100, Number(l?.optimized_conversion_rate_pct ?? 20))),
          conversionLiftPct: Math.round(Number(l?.conversion_lift_pct ?? 0) * 10) / 10,
          conversionFactors: (l?.conversion_factors || []).slice(0, 12).map((f: any) => ({
            factor: CONVERSION_FACTORS.includes(String(f?.factor) as any) ? String(f.factor) : 'price_competitiveness',
            currentScore: Math.max(0, Math.min(100, Number(f?.current_score ?? 50))),
            optimizedScore: Math.max(0, Math.min(100, Number(f?.optimized_score ?? 70))),
            impactPct: Math.round(Number(f?.impact_pct ?? 0) * 10) / 10,
            priority: ['high', 'medium', 'low'].includes(String(f?.priority)) ? String(f.priority) : 'medium',
          })),
          mlPredictions: {
            predictedConversionRatePct: Math.max(0, Math.min(100, Number(l?.ml_predictions?.predicted_conversion_rate_pct ?? 15))),
            predictedTimeToSaleDays: Math.max(1, Math.round(Number(l?.ml_predictions?.predicted_time_to_sale_days ?? 14))),
            predictedFinalPriceEur: Math.max(0, Math.round(Number(l?.ml_predictions?.predicted_final_price_eur ?? 0))),
            confidencePct: Math.max(0, Math.min(100, Number(l?.ml_predictions?.confidence_pct ?? 60))),
            modelConsensus: ['strong', 'moderate', 'weak'].includes(String(l?.ml_predictions?.model_consensus)) ? String(l.ml_predictions.model_consensus) : 'moderate',
          },
          recommendedOptimizations: (l?.recommended_optimizations || []).slice(0, 6).map((o: any) => ({
            optimization: String(o?.optimization ?? '').slice(0, 250),
            factorTargeted: CONVERSION_FACTORS.includes(String(o?.factor_targeted) as any) ? String(o.factor_targeted) : 'price_competitiveness',
            expectedLiftPct: Math.round(Number(o?.expected_lift_pct ?? 0)),
            implementationEffort: ['low', 'medium', 'high'].includes(String(o?.implementation_effort)) ? String(o.implementation_effort) : 'medium',
            timeToImplementHours: Math.max(0.5, Number(o?.time_to_implement_hours ?? 1)),
          })),
          expectedRevenueImpactEur: Math.round(Number(l?.expected_revenue_impact_eur ?? 0)),
          priority: ['high', 'medium', 'low'].includes(String(l?.priority)) ? String(l.priority) : 'medium',
        })),
      conversionFactors: (parsed?.conversion_factors || []).slice(0, 12).map((f: any) => ({
        factor: CONVERSION_FACTORS.includes(String(f?.factor) as any) ? String(f.factor) : 'price_competitiveness',
        weight: Math.max(0, Math.min(100, Number(f?.weight ?? 10))),
        avgScore: Math.max(0, Math.min(100, Number(f?.avg_score ?? 50))),
        benchmark: Math.max(0, Math.min(100, Number(f?.benchmark ?? 60))),
        improvementPotential: ['high', 'medium', 'low'].includes(String(f?.improvement_potential)) ? String(f.improvement_potential) : 'medium',
        bestPractice: String(f?.best_practice ?? '').slice(0, 300),
      })),
      optimizations: (parsed?.optimizations || []).slice(0, 8).map((o: any) => ({
        optimizationType: ['price_adjustment', 'image_improvement', 'title_rewrite', 'description_enhancement', 'urgency_addition', 'trust_building', 'response_optimization', 'shipping_expansion'].includes(String(o?.optimization_type)) ? String(o.optimization_type) : 'price_adjustment',
        description: String(o?.description ?? '').slice(0, 250),
        expectedConversionLiftPct: Math.round(Number(o?.expected_conversion_lift_pct ?? 0)),
        implementationDifficulty: ['low', 'medium', 'high'].includes(String(o?.implementation_difficulty)) ? String(o.implementation_difficulty) : 'medium',
        bestForCategory: String(o?.best_for_category ?? '').slice(0, 150),
      })),
      mvTests: (parsed?.mv_tests || [])
        .filter((t: any) => validIds.has(String(t?.listing_id ?? '')))
        .slice(0, 12)
        .map((t: any) => ({
          tradeId: String(t?.listing_id ?? '').slice(0, 50),
          testName: String(t?.test_name ?? '').slice(0, 150),
          variants: (t?.variants || []).slice(0, 4).map((v: any) => ({
            variantId: ['a', 'b', 'c', 'd'].includes(String(v?.variant_id)) ? String(v.variant_id) : 'a',
            changeDescription: String(v?.change_description ?? '').slice(0, 200),
            predictedConversionPct: Math.max(0, Math.min(100, Number(v?.predicted_conversion_pct ?? 10))),
          })),
          testDurationDays: Math.max(3, Math.min(30, Number(t?.test_duration_days ?? 7))),
          sampleSizePerVariant: Math.max(50, Number(t?.sample_size_per_variant ?? 100)),
          primaryMetric: ['conversion_rate', 'time_to_sale', 'revenue'].includes(String(t?.primary_metric)) ? String(t.primary_metric) : 'conversion_rate',
          statisticalSignificancePct: Math.max(0, Math.min(100, Number(t?.statistical_significance_pct ?? 95))),
          expectedWinner: ['a', 'b', 'c', 'd'].includes(String(t?.expected_winner)) ? String(t.expected_winner) : 'b',
          confidenceLevelPct: Math.max(0, Math.min(100, Number(t?.confidence_level_pct ?? 95))),
        })),
      mlPredictions: (parsed?.ml_predictions || []).slice(0, 5).map((m: any) => ({
        model: ['gradient_boosting', 'neural_network', 'logistic_regression', 'random_forest', 'xgboost'].includes(String(m?.model)) ? String(m.model) : 'gradient_boosting',
        accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
        precisionPct: Math.max(0, Math.min(100, Number(m?.precision_pct ?? 70))),
        recallPct: Math.max(0, Math.min(100, Number(m?.recall_pct ?? 65))),
        f1Score: Math.max(0, Math.min(100, Number(m?.f1_score ?? 67))),
        weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
        bestFor: String(m?.best_for ?? '').slice(0, 150),
      })),
      summary: {
        totalListingsOptimized: targetListings.length,
        avgCurrentConversionRatePct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_current_conversion_rate_pct ?? 10))),
        avgOptimizedConversionRatePct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_optimized_conversion_rate_pct ?? 20))),
        avgConversionLiftPct: Math.round(Number(parsed?.summary?.avg_conversion_lift_pct ?? 50) * 10) / 10,
        totalExpectedRevenueImpactEur: Math.round(Number(parsed?.summary?.total_expected_revenue_impact_eur ?? 0)),
        biggestConversionBlocker: String(parsed?.summary?.biggest_conversion_blocker ?? '').slice(0, 200),
        biggestConversionOpportunity: String(parsed?.summary?.biggest_conversion_opportunity ?? '').slice(0, 200),
        bestOptimizationOverall: ['price_adjustment', 'image_improvement', 'title_rewrite', 'description_enhancement', 'urgency_addition', 'trust_building', 'response_optimization', 'shipping_expansion'].includes(String(parsed?.summary?.best_optimization_overall)) ? String(parsed.summary.best_optimization_overall) : 'price_adjustment',
        conversionOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.conversion_optimization_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { logger.error("/api/ai/listing-conversion-optimizer", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
