// v6.54: AI Listing Description A/B Test Optimizer — ML testiranje opisov z multi-variantami
// POST /api/ai/listing-description-abtest-optimizer
// Body: { tradeId?: string, variants?: number, platforms?: string[] }
// Returns: { ok, optimizer: { listings, variants, mlPredictions, testMatrix, statisticalAnalysis, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const VARIANT_TYPES = [
  'control',
  'emotional_appeal',
  'urgency_focused',
  'social_proof_heavy',
  'specification_rich',
  'story_driven',
  'benefit_oriented',
  'scarcity_emphasis',
  'price_anchored',
  'problem_solution',
] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const variants = Math.max(2, Math.min(5, Number(body?.variants ?? 3)));

    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;

    const heldTrades = await db.trade.findMany({
      where,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true, location: true } },
      },
      take: tradeId ? 1 : 8,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, optimizer: null, message: 'Ni held tradeov za A/B test.' });
    }

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
      return {
        id: t.id, title: t.title, category: t.category || 'drugo',
        cost, estValue, daysHeld,
        originalDescription: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 400),
        location: t.listing?.location || '',
      };
    });

    const itemsStr = items.map(i =>
      `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d | ${i.location}`
    ).join('\n');

    const prompt = `Si AI listing description A/B test optimizer za slovenske oglasne platforme.
Generiraj ${variants} A/B test variante opisov z ML predikcijo in statistično analizo.

INVENTAR (${items.length}):
${itemsStr}

A/B test variant tipi:
1. CONTROL: originalni opis (baseline)
2. EMOTIONAL_APPEAL: čustven apel (darilo, spomin, družina)
3. URGENCY_FOCUSED: nujnost (danes, omejeno, hitro)
4. SOCIAL_PROOF_HEAVY: socialno dokazilo (popularno, bestseller)
5. SPECIFICATION_RICH: tehnične specifikacije, dimenzije
6. STORY_DRIVEN: zgodba o itemu (kako je nastal, zgodovina)
7. BENEFIT_ORIENTED: koristi za kupca (kaj dobi, ne kaj je)
8. SCARCITY_EMPHASIS: redkost (limited, edinstveno, redko)
9. PRICE_ANCHORED: cena sidro (prej 350€, sedaj 199€)
10. PROBLEM_SOLUTION: problem-rešitev (moraš imeti, reši X)

ML predikcijski modeli za vsako varianto:
- EXPECTED_VIEWS: napoved ogledov v 7 dneh
- EXPECTED_INQUIRIES: napoved povpraševanj v 7 dneh
- EXPECTED_CONVERSION_RATE: napoved conversion rate (%)
- EXPECTED_TIME_TO_SALE: napoved dni do prodaje
- EXPECTED_FINAL_PRICE: napoved končne prodajne cene
- ENGAGEMENT_SCORE: kombiniran score (0-100)
- STATISTICAL_CONFIDENCE: confidence interval za napoved (0-100)

Statistična analiza:
- SAMPLE_SIZE_NEEDED: koliko ogledov potrebujemo za signifikantno testiranje
- MIN_TEST_DURATION_DAYS: minimalni dnevi testa
- STATISTICAL_POWER: moč testa (0-100)
- CONFIDENCE_LEVEL: 95% CI
- P_VALUE_THRESHOLD: 0.05

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "control_description": "<original opis, max 500 znakov>",
      "variants": [
        {
          "variant_id": "<a|b|c|d|e>",
          "variant_type": "<control|emotional_appeal|urgency_focused|social_proof_heavy|specification_rich|story_driven|benefit_oriented|scarcity_emphasis|price_anchored|problem_solution>",
          "description": "<variant opis, max 800 znakov>",
          "ml_predictions": {
            "expected_views_7d": <number>,
            "expected_inquiries_7d": <number>,
            "expected_conversion_rate_pct": <number 0-100>,
            "expected_time_to_sale_days": <number>,
            "expected_final_price_eur": <number>,
            "engagement_score": <number 0-100>,
            "statistical_confidence_pct": <number 0-100>
          },
          "key_changes_from_control": ["<max 80 znakov>"],
          "psychological_technique_used": "<max 80 znakov>",
          "expected_winner_probability_pct": <number 0-100>
        }
      ],
      "predicted_winner": "<a|b|c|d|e>",
      "winner_reasoning": "<max 150 znakov>"
    }
  ],
  "ml_predictions": [
    {
      "metric": "<views|inquiries|conversion_rate|time_to_sale|final_price|engagement>",
      "control_avg": <number>,
      "variant_a_avg": <number>,
      "variant_b_avg": <number>,
      "variant_c_avg": <number>,
      "best_variant": "<a|b|c>",
      "improvement_pct": <number>,
      "confidence_pct": <number 0-100>
    }
  ],
  "test_matrix": [
    {
      "listing_id": "<trade_id>",
      "variant_a_type": "<variant_type>",
      "variant_b_type": "<variant_type>",
      "variant_c_type": "<variant_type>",
      "test_duration_days": <number>,
      "sample_size_per_variant": <number>,
      "primary_metric": "<conversion_rate|views|inquiries|time_to_sale>",
      "secondary_metrics": ["<metric>"],
      "stopping_rule": "<max 100 znakov>"
    }
  ],
  "statistical_analysis": [
    {
      "comparison": "a_vs_control",
      "expected_lift_pct": <number>,
      "confidence_interval": {"lower": <number>, "upper": <number>},
      "p_value_estimate": <number>,
      "statistical_power": <number 0-100>,
      "sample_size_needed": <number>,
      "significant": <boolean>
    }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_conversion_lift_pct": <number>, "listings_affected": <number>, "implementation_effort": "<low|medium|high>" }
  ],
  "summary": {
    "total_listings_tested": <number>,
    "total_variants_generated": <number>,
    "avg_expected_conversion_lift_pct": <number>,
    "best_variant_type_overall": "<max 80 znakov>",
    "best_variant_avg_lift_pct": <number>,
    "total_test_duration_days": <number>,
    "total_sample_size_needed": <number>,
    "avg_statistical_confidence_pct": <number>,
    "ab_test_optimization_score": <number 0-100>
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

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      listings: (parsed?.listings || [])
        .filter((l: any) => validIds.has(String(l?.id ?? '')))
        .slice(0, 8)
        .map((l: any) => {
          const orig = items.find(x => x.id === String(l?.id));
          return {
            tradeId: String(l?.id ?? ''),
            title: String(l?.title ?? orig?.title ?? '').slice(0, 150),
            controlDescription: String(l?.control_description ?? orig?.originalDescription ?? '').slice(0, 800),
            variants: (l?.variants || [])
              .slice(0, variants)
              .map((v: any) => ({
                variantId: ['a', 'b', 'c', 'd', 'e'].includes(String(v?.variant_id)) ? String(v.variant_id) : 'a',
                variantType: VARIANT_TYPES.includes(String(v?.variant_type) as any) ? String(v.variant_type) : 'control',
                description: String(v?.description ?? '').slice(0, 1200),
                mlPredictions: {
                  expectedViews7d: Math.max(0, Math.round(Number(v?.ml_predictions?.expected_views_7d ?? 0))),
                  expectedInquiries7d: Math.max(0, Math.round(Number(v?.ml_predictions?.expected_inquiries_7d ?? 0))),
                  expectedConversionRatePct: Math.max(0, Math.min(100, Number(v?.ml_predictions?.expected_conversion_rate_pct ?? 30))),
                  expectedTimeToSaleDays: Math.max(1, Math.round(Number(v?.ml_predictions?.expected_time_to_sale_days ?? 14))),
                  expectedFinalPriceEur: Math.max(0, Math.round(Number(v?.ml_predictions?.expected_final_price_eur ?? orig?.estValue ?? 0))),
                  engagementScore: Math.max(0, Math.min(100, Number(v?.ml_predictions?.engagement_score ?? 50))),
                  statisticalConfidencePct: Math.max(0, Math.min(100, Number(v?.ml_predictions?.statistical_confidence_pct ?? 50))),
                },
                keyChangesFromControl: (v?.key_changes_from_control || []).slice(0, 5).map((c: any) => String(c).slice(0, 150)),
                psychologicalTechniqueUsed: String(v?.psychological_technique_used ?? '').slice(0, 150),
                expectedWinnerProbabilityPct: Math.max(0, Math.min(100, Number(v?.expected_winner_probability_pct ?? 25))),
              })),
            predictedWinner: ['a', 'b', 'c', 'd', 'e'].includes(String(l?.predicted_winner)) ? String(l.predicted_winner) : 'a',
            winnerReasoning: String(l?.winner_reasoning ?? '').slice(0, 300),
          };
        }),
      mlPredictions: (parsed?.ml_predictions || []).slice(0, 6).map((m: any) => ({
        metric: ['views', 'inquiries', 'conversion_rate', 'time_to_sale', 'final_price', 'engagement'].includes(String(m?.metric)) ? String(m.metric) : 'conversion_rate',
        controlAvg: Math.round(Number(m?.control_avg ?? 0) * 100) / 100,
        variantAAvg: Math.round(Number(m?.variant_a_avg ?? 0) * 100) / 100,
        variantBAvg: Math.round(Number(m?.variant_b_avg ?? 0) * 100) / 100,
        variantCAvg: Math.round(Number(m?.variant_c_avg ?? 0) * 100) / 100,
        bestVariant: ['a', 'b', 'c'].includes(String(m?.best_variant)) ? String(m.best_variant) : 'a',
        improvementPct: Math.round(Number(m?.improvement_pct ?? 0) * 10) / 10,
        confidencePct: Math.max(0, Math.min(100, Number(m?.confidence_pct ?? 50))),
      })),
      testMatrix: (parsed?.test_matrix || [])
        .filter((t: any) => validIds.has(String(t?.listing_id ?? '')))
        .slice(0, 8)
        .map((t: any) => ({
          tradeId: String(t?.listing_id ?? '').slice(0, 50),
          variantAType: VARIANT_TYPES.includes(String(t?.variant_a_type) as any) ? String(t.variant_a_type) : 'emotional_appeal',
          variantBType: VARIANT_TYPES.includes(String(t?.variant_b_type) as any) ? String(t.variant_b_type) : 'urgency_focused',
          variantCType: VARIANT_TYPES.includes(String(t?.variant_c_type) as any) ? String(t.variant_c_type) : 'social_proof_heavy',
          testDurationDays: Math.max(3, Math.min(30, Number(t?.test_duration_days ?? 7))),
          sampleSizePerVariant: Math.max(50, Number(t?.sample_size_per_variant ?? 100)),
          primaryMetric: ['conversion_rate', 'views', 'inquiries', 'time_to_sale'].includes(String(t?.primary_metric)) ? String(t.primary_metric) : 'conversion_rate',
          secondaryMetrics: (t?.secondary_metrics || []).slice(0, 4).map((m: any) => String(m).slice(0, 50)),
          stoppingRule: String(t?.stopping_rule ?? '').slice(0, 200),
        })),
      statisticalAnalysis: (parsed?.statistical_analysis || []).slice(0, 6).map((s: any) => ({
        comparison: ['a_vs_control', 'b_vs_control', 'c_vs_control', 'a_vs_b', 'a_vs_c', 'b_vs_c'].includes(String(s?.comparison)) ? String(s.comparison) : 'a_vs_control',
        expectedLiftPct: Math.round(Number(s?.expected_lift_pct ?? 0) * 10) / 10,
        confidenceInterval: {
          lower: Math.round(Number(s?.confidence_interval?.lower ?? 0) * 10) / 10,
          upper: Math.round(Number(s?.confidence_interval?.upper ?? 0) * 10) / 10,
        },
        pValueEstimate: Math.max(0, Math.min(1, Number(s?.p_value_estimate ?? 0.05))),
        statisticalPower: Math.max(0, Math.min(100, Number(s?.statistical_power ?? 80))),
        sampleSizeNeeded: Math.max(30, Number(s?.sample_size_needed ?? 100)),
        significant: Boolean(s?.significant ?? false),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        expectedConversionLiftPct: Math.round(Number(r?.expected_conversion_lift_pct ?? 0)),
        listingsAffected: Math.max(0, Number(r?.listings_affected ?? 0)),
        implementationEffort: ['low', 'medium', 'high'].includes(String(r?.implementation_effort)) ? String(r.implementation_effort) : 'medium',
      })),
      summary: {
        totalListingsTested: items.length,
        totalVariantsGenerated: Math.max(0, Number(parsed?.summary?.total_variants_generated ?? items.length * variants)),
        avgExpectedConversionLiftPct: Math.round(Number(parsed?.summary?.avg_expected_conversion_lift_pct ?? 0) * 10) / 10,
        bestVariantTypeOverall: VARIANT_TYPES.includes(String(parsed?.summary?.best_variant_type_overall) as any) ? String(parsed.summary.best_variant_type_overall) : 'emotional_appeal',
        bestVariantAvgLiftPct: Math.round(Number(parsed?.summary?.best_variant_avg_lift_pct ?? 0) * 10) / 10,
        totalTestDurationDays: Math.max(0, Number(parsed?.summary?.total_test_duration_days ?? 0)),
        totalSampleSizeNeeded: Math.max(0, Number(parsed?.summary?.total_sample_size_needed ?? 0)),
        avgStatisticalConfidencePct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_statistical_confidence_pct ?? 50))),
        abTestOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.ab_test_optimization_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
