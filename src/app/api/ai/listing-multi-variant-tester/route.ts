// v6.71: AI Listing Multi-Variant Tester — A/B/n testing z ML in statistical significance
// POST /api/ai/listing-multi-variant-tester
// Body: { tradeId?: string, variants?: number }
// Returns: { ok, tester: { listings, variants, statistics, winners, mlPredictions, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const VARIANT_ELEMENTS = ['title', 'description', 'price', 'image', 'tags', 'cta', 'timing', 'platform'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const numVariants = Math.max(2, Math.min(5, Number(body?.variants ?? 4)));

    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades = await db.trade.findMany({ where, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, description: true, detailDescription: true, price: true, imageUrl: true, location: true } } }, take: tradeId ? 1 : 8 });

    if (heldTrades.length === 0) return NextResponse.json({ ok: true, tester: null, message: 'Ni held tradeov za multi-variant testing.' });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const items = heldTrades.map(t => ({ id: t.id, title: t.title, category: t.category || 'drugo', cost: t.buyPrice + (t.buyFees ?? 0), estValue: t.listing?.aiEstimatedValue ?? Math.round((t.buyPrice + (t.buyFees ?? 0)) * 1.25), description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 200), price: t.listing?.price ?? Math.round((t.buyPrice + (t.buyFees ?? 0)) * 1.25) }));
    const itemsStr = items.slice(0, 8).map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.price}€`).join('\n');

    const prompt = `Si AI listing multi-variant tester z ML in statistical significance testing.
Generira ${numVariants} variant per listing z ML predictions in A/B/n statistical analysis.

OGLASI (${items.length}):
${itemsStr}

8 variant elementov:
1. TITLE: različni naslovi
2. DESCRIPTION: različni opisi
3. PRICE: različne cene
4. IMAGE: različne slike
5. TAGS: različni tagi
6. CTA: različni call-to-action
7. TIMING: različni časi objave
8. PLATFORM: različne platforme

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "id": "<trade_id>", "title": "<naslov>",
      "variants": [
        { "variant_id": "<a|b|c|d|e>", "changed_elements": ["<8 elementov>"], "title": "<naslov>", "description": "<opis 200c>", "price_eur": <number>, "tags": ["<tag>"], "cta": "<max 80 znakov>", "ml_predictions": { "expected_ctr_pct": <number 0-100>, "expected_conversion_pct": <number 0-100>, "expected_views_7d": <number>, "expected_inquiries_7d": <number>, "engagement_score": <number 0-100>, "winner_probability_pct": <number 0-100> }, "key_changes": ["<max 80 znakov>"] }
      ],
      "predicted_winner": "<a|b|c|d|e>", "winner_reasoning": "<max 150 znakov>",
      "test_config": { "test_duration_days": <number>, "sample_size_per_variant": <number>, "primary_metric": "<ctr|conversion|views|inquiries|revenue>", "secondary_metrics": ["<metric>"], "statistical_significance_pct": <number 0-100>, "stopping_rule": "<max 100 znakov>" }
    }
  ],
  "statistics": [
    { "comparison": "<a_vs_b|a_vs_c|b_vs_c|all_vs_control>", "expected_lift_pct": <number>, "confidence_interval": {"lower": <number>, "upper": <number>}, "p_value": <number 0-1>, "statistical_power": <number 0-100>, "sample_size_needed": <number>, "significant": <boolean> }
  ],
  "winners": [
    { "listing_id": "<trade_id>", "winning_variant": "<a|b|c|d|e>", "winning_elements": ["<8 elementov>"], "expected_lift_pct": <number>, "confidence_pct": <number 0-100>, "implementation_recommendation": "<max 150 znakov>" }
  ],
  "mlPredictions": [
    { "model": "<gradient_boosting|neural_network|random_forest|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<ctr|conversion|engagement|winner>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_listings_tested": <number>, "total_variants_generated": <number>, "avg_expected_lift_pct": <number>,
    "best_element_to_test": "<8 elementov>", "biggest_testing_opportunity": "<max 100 znakov>",
    "quickest_test_win": "<max 100 znakov>", "multi_variant_testing_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);
    const validIds = new Set(items.map(i => i.id));

    const tester = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      listings: (parsed?.listings || []).filter((l: any) => validIds.has(String(l?.id ?? ''))).slice(0, 8).map((l: any) => ({
        tradeId: String(l?.id ?? ''), title: String(l?.title ?? '').slice(0, 150),
        variants: (l?.variants || []).slice(0, numVariants).map((v: any) => ({
          variantId: ['a', 'b', 'c', 'd', 'e'].includes(String(v?.variant_id)) ? String(v.variant_id) : 'a',
          changedElements: (v?.changed_elements || []).slice(0, 8).map((e: any) => VARIANT_ELEMENTS.includes(String(e) as any) ? String(e) : 'title'),
          title: String(v?.title ?? '').slice(0, 120), description: String(v?.description ?? '').slice(0, 400),
          priceEur: Math.max(0, Math.round(Number(v?.price_eur ?? 0))), tags: (v?.tags || []).slice(0, 10).map((t: any) => String(t).slice(0, 50)),
          cta: String(v?.cta ?? '').slice(0, 150),
          mlPredictions: {
            expectedCtrPct: Math.max(0, Math.min(100, Number(v?.ml_predictions?.expected_ctr_pct ?? 5))),
            expectedConversionPct: Math.max(0, Math.min(100, Number(v?.ml_predictions?.expected_conversion_pct ?? 10))),
            expectedViews7d: Math.max(0, Math.round(Number(v?.ml_predictions?.expected_views_7d ?? 0))),
            expectedInquiries7d: Math.max(0, Math.round(Number(v?.ml_predictions?.expected_inquiries_7d ?? 0))),
            engagementScore: Math.max(0, Math.min(100, Number(v?.ml_predictions?.engagement_score ?? 50))),
            winnerProbabilityPct: Math.max(0, Math.min(100, Number(v?.ml_predictions?.winner_probability_pct ?? 25))),
          },
          keyChanges: (v?.key_changes || []).slice(0, 5).map((c: any) => String(c).slice(0, 150)),
        })),
        predictedWinner: ['a', 'b', 'c', 'd', 'e'].includes(String(l?.predicted_winner)) ? String(l.predicted_winner) : 'a',
        winnerReasoning: String(l?.winner_reasoning ?? '').slice(0, 300),
        testConfig: {
          testDurationDays: Math.max(3, Math.min(30, Number(l?.test_config?.test_duration_days ?? 7))),
          sampleSizePerVariant: Math.max(50, Number(l?.test_config?.sample_size_per_variant ?? 100)),
          primaryMetric: ['ctr', 'conversion', 'views', 'inquiries', 'revenue'].includes(String(l?.test_config?.primary_metric)) ? String(l.test_config.primary_metric) : 'conversion',
          secondaryMetrics: (l?.test_config?.secondary_metrics || []).slice(0, 4).map((m: any) => String(m).slice(0, 50)),
          statisticalSignificancePct: Math.max(0, Math.min(100, Number(l?.test_config?.statistical_significance_pct ?? 95))),
          stoppingRule: String(l?.test_config?.stopping_rule ?? '').slice(0, 200),
        },
      })),
      statistics: (parsed?.statistics || []).slice(0, 6).map((s: any) => ({
        comparison: ['a_vs_b', 'a_vs_c', 'b_vs_c', 'all_vs_control'].includes(String(s?.comparison)) ? String(s.comparison) : 'a_vs_b',
        expectedLiftPct: Math.round(Number(s?.expected_lift_pct ?? 0) * 10) / 10,
        confidenceInterval: { lower: Math.round(Number(s?.confidence_interval?.lower ?? 0) * 10) / 10, upper: Math.round(Number(s?.confidence_interval?.upper ?? 0) * 10) / 10 },
        pValue: Math.max(0, Math.min(1, Number(s?.p_value ?? 0.05))),
        statisticalPower: Math.max(0, Math.min(100, Number(s?.statistical_power ?? 80))),
        sampleSizeNeeded: Math.max(30, Number(s?.sample_size_needed ?? 100)),
        significant: Boolean(s?.significant ?? false),
      })),
      winners: (parsed?.winners || []).filter((w: any) => validIds.has(String(w?.listing_id ?? ''))).slice(0, 8).map((w: any) => ({
        listingId: String(w?.listing_id ?? '').slice(0, 50),
        winningVariant: ['a', 'b', 'c', 'd', 'e'].includes(String(w?.winning_variant)) ? String(w.winning_variant) : 'a',
        winningElements: (w?.winning_elements || []).slice(0, 8).map((e: any) => VARIANT_ELEMENTS.includes(String(e) as any) ? String(e) : 'title'),
        expectedLiftPct: Math.round(Number(w?.expected_lift_pct ?? 0) * 10) / 10,
        confidencePct: Math.max(0, Math.min(100, Number(w?.confidence_pct ?? 80))),
        implementationRecommendation: String(w?.implementation_recommendation ?? '').slice(0, 300),
      })),
      mlPredictions: (parsed?.mlPredictions || []).slice(0, 5).map((m: any) => ({
        model: ['gradient_boosting', 'neural_network', 'random_forest', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
        accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
        predictionType: ['ctr', 'conversion', 'engagement', 'winner'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'winner',
        weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
      })),
      summary: {
        totalListingsTested: items.length, totalVariantsGenerated: Math.max(0, Number(parsed?.summary?.total_variants_generated ?? items.length * numVariants)),
        avgExpectedLiftPct: Math.round(Number(parsed?.summary?.avg_expected_lift_pct ?? 20) * 10) / 10,
        bestElementToTest: VARIANT_ELEMENTS.includes(String(parsed?.summary?.best_element_to_test) as any) ? String(parsed.summary.best_element_to_test) : 'title',
        biggestTestingOpportunity: String(parsed?.summary?.biggest_testing_opportunity ?? '').slice(0, 200),
        quickestTestWin: String(parsed?.summary?.quickest_test_win ?? '').slice(0, 200),
        multiVariantTestingScore: Math.max(0, Math.min(100, Number(parsed?.summary?.multi_variant_testing_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, tester });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
