// v6.63: AI Listing Description Generator v3 — ML opisi z personalization in sentiment optimization
// POST /api/ai/listing-description-generator-v3
// Body: { tradeId?: string, listingId?: string, targetPersona?: string }
// Returns: { ok, generator: { listings, descriptions, mlScoring, personalization, abTestPlan, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const DESCRIPTION_STYLES = [
  'storytelling',
  'technical_specifications',
  'benefit_driven',
  'emotional_appeal',
  'urgency_focused',
  'social_proof',
  'comparison_oriented',
  'problem_solution',
  'luxury_premium',
  'minimalist_clean',
] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId } = body;
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const targetPersona = body?.targetPersona ? String(body.targetPersona) : null;

    let targetListings: Array<{
      id: string; title: string; category: string; price: number;
      description: string; estValue: number; location: string;
    }> = [];

    if (tradeId) {
      const t = await db.trade.findUnique({
        where: { id: tradeId },
        select: { id: true, title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, aiEstimatedValue: true, price: true, location: true } } },
      });
      if (!t) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
      targetListings = [{
        id: t.id, title: t.title, category: t.category || 'drugo',
        price: t.listing?.price ?? t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
        description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 500),
        location: t.listing?.location ?? '',
      }];
    } else if (listingId) {
      const l = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: { id: true, title: true, price: true, description: true, detailDescription: true, aiEstimatedValue: true, location: true },
      });
      if (!l) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      targetListings = [{
        id: l.id, title: l.title, category: '', price: l.price ?? 0, estValue: l.aiEstimatedValue ?? l.price ?? 0,
        description: (l.detailDescription || l.description || '').slice(0, 500), location: l.location ?? '',
      }];
    } else {
      const heldTrades = await db.trade.findMany({
        where: { status: 'held' },
        select: { id: true, title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, aiEstimatedValue: true, price: true, location: true } } },
        take: 8,
        orderBy: { buyDate: 'desc' },
      });
      targetListings = heldTrades.map(t => ({
        id: t.id, title: t.title, category: t.category || 'drugo',
        price: t.listing?.price ?? t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
        description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 500),
        location: t.listing?.location ?? '',
      }));
    }

    if (targetListings.length === 0) {
      return NextResponse.json({ ok: true, generator: null, message: 'Ni listingov za description generacijo.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const itemsStr = targetListings.slice(0, 8).map(i =>
      `- [${i.id}] "${i.title}" | ${i.category} | ${i.price}€ | ${i.location} | opis: ${i.description.slice(0, 100)}`
    ).join('\n');

    const prompt = `Si AI listing description generator v3 z ML personalization in sentiment optimization.
Generira 5 opisov per listing z ML scoring in persona-based personalization.

OGLASI (${targetListings.length}):
${itemsStr}

${targetPersona ? `TARGET PERSONA: ${targetPersona}\n` : ''}10 description stilov:
1. STORYTELLING: zgodba o itemu (zgodovina, izvor, emocije)
2. TECHNICAL_SPECIFICATIONS: specifikacije, dimenzije, material, stanje
3. BENEFIT_DRIVEN: koristi za kupca (kaj dobi, ne kaj je)
4. EMOTIONAL_APPEAL: čustven apel (darilo, spomin, družina)
5. URGENCY_FOCUSED: nujnost (danes, omejeno, zadnji)
6. SOCIAL_PROOF: socialno dokazilo (popularno, bestseller, top)
7. COMPARISON_ORIENTED: primerjava (boljše od, ceneje kot)
8. PROBLEM_SOLUTION: problem-rešitev (moraš imeti, reši X)
9. LUXURY_PREMIUM: prestiž, ekskluzivnost, premium feel
10. MINIMALIST_CLEAN: minimalen, jasen, concise

Description struktura (500-800 znakov):
1. HOOK: prva poved ki pridobi pozornost
2. SPECIFICATIONS: tehnične podrobnosti
3. CONDITION: stanje, starost, razlog prodaje
4. VALUE_PROPOSITION: zakaj ta item
5. TRUST: garancija, vračila, originalna embalaža
6. CTA: jasen poziv k akciji

ML scoring:
- SENTIMENT_SCORE: čustvena analiza (positive/neutral/negative)
- READABILITY_SCORE: berljivost (Flesch Reading Ease)
- KEYWORD_DENSITY: optimalna gostota ključnih besed
- ENGAGEMENT_PREDICTION: napoved engagement
- CONVERSION_PREDICTION: napoved konverzije

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "current_description_score": <number 0-100>,
      "description_variants": [
        {
          "variant_id": "<a|b|c|d|e>",
          "style": "<10 stilov>",
          "description": "<500-800 znakov>",
          "hook": "<prva poved, max 100 znakov>",
          "cta": "<call to action, max 80 znakov>",
          "ml_scores": {
            "sentiment_score": <number 0-100>,
            "readability_score": <number 0-100>,
            "keyword_density_pct": <number 0-100>,
            "engagement_prediction_pct": <number 0-100>,
            "conversion_prediction_pct": <number 0-100>,
            "overall_score": <number 0-100>
          },
          "keywords_included": ["<ključna beseda>"],
          "word_count": <number>,
          "character_count": <number>,
          "sentiment": "<very_positive|positive|neutral|negative>",
          "readability_level": "<easy|medium|hard>",
          "winner_probability_pct": <number 0-100>
        }
      ],
      "recommended_description": "<max 800 znakov>",
      "recommended_style": "<10 stilov>",
      "expected_engagement_increase_pct": <number>,
      "expected_conversion_increase_pct": <number>
    }
  ],
  "descriptions": [
    {
      "style": "<10 stilov>",
      "description": "<max 120 znakov>",
      "best_for_category": "<max 80 znakov>",
      "best_for_persona": "<max 80 znakov>",
      "avg_overall_score": <number 0-100>,
      "example_hook": "<max 100 znakov>"
    }
  ],
  "ml_scoring": [
    {
      "metric": "<sentiment_score|readability_score|keyword_density|engagement_prediction|conversion_prediction|overall_score>",
      "weight": <number 0-100>,
      "description": "<max 100 znakov>",
      "benchmark": <number 0-100>,
      "optimization_tip": "<max 120 znakov>"
    }
  ],
  "personalization": [
    {
      "persona": "<bargain_hunter|collector|parent_family|student_young|professional|hobbyist|gift_giver|reseller|tech_enthusiast|seasonal_buyer>",
      "best_style": "<10 stilov>",
      "best_hook": "<max 100 znakov>",
      "best_cta": "<max 80 znakov>",
      "keywords_to_include": ["<ključna beseda>"],
      "keywords_to_avoid": ["<ključna beseda>"],
      "expected_conversion_pct": <number 0-100>
    }
  ],
  "ab_test_plan": [
    {
      "listing_id": "<trade_id>",
      "variant_a_style": "<10 stilov>",
      "variant_b_style": "<10 stilov>",
      "test_duration_days": <number>,
      "primary_metric": "<engagement|conversion_rate|inquiries|time_to_sale>",
      "expected_winner": "<a|b>",
      "confidence_level_pct": <number 0-100>
    }
  ],
  "summary": {
    "total_listings_processed": <number>,
    "total_variants_generated": <number>,
    "avg_current_description_score": <number>,
    "avg_recommended_description_score": <number>,
    "avg_improvement_pct": <number>,
    "best_style_overall": "<max 80 znakov>",
    "biggest_description_issue": "<max 100 znakov>",
    "quickest_description_win": "<max 100 znakov>",
    "description_generation_score": <number 0-100>
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

    const generator = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      listings: (parsed?.listings || [])
        .filter((l: any) => validIds.has(String(l?.id ?? '')))
        .slice(0, 8)
        .map((l: any) => ({
          tradeId: String(l?.id ?? ''),
          title: String(l?.title ?? '').slice(0, 150),
          currentDescriptionScore: Math.max(0, Math.min(100, Number(l?.current_description_score ?? 50))),
          descriptionVariants: (l?.description_variants || []).slice(0, 5).map((v: any) => ({
            variantId: ['a', 'b', 'c', 'd', 'e'].includes(String(v?.variant_id)) ? String(v.variant_id) : 'a',
            style: DESCRIPTION_STYLES.includes(String(v?.style) as any) ? String(v.style) : 'storytelling',
            description: String(v?.description ?? '').slice(0, 1200),
            hook: String(v?.hook ?? '').slice(0, 200),
            cta: String(v?.cta ?? '').slice(0, 150),
            mlScores: {
              sentimentScore: Math.max(0, Math.min(100, Number(v?.ml_scores?.sentiment_score ?? 60))),
              readabilityScore: Math.max(0, Math.min(100, Number(v?.ml_scores?.readability_score ?? 60))),
              keywordDensityPct: Math.round(Number(v?.ml_scores?.keyword_density_pct ?? 50) * 10) / 10,
              engagementPredictionPct: Math.max(0, Math.min(100, Number(v?.ml_scores?.engagement_prediction_pct ?? 50))),
              conversionPredictionPct: Math.max(0, Math.min(100, Number(v?.ml_scores?.conversion_prediction_pct ?? 50))),
              overallScore: Math.max(0, Math.min(100, Number(v?.ml_scores?.overall_score ?? 50))),
            },
            keywordsIncluded: (v?.keywords_included || []).slice(0, 8).map((k: any) => String(k).slice(0, 60)),
            wordCount: Math.max(0, Number(v?.word_count ?? 0)),
            characterCount: Math.max(0, Number(v?.character_count ?? 0)),
            sentiment: ['very_positive', 'positive', 'neutral', 'negative'].includes(String(v?.sentiment)) ? String(v.sentiment) : 'positive',
            readabilityLevel: ['easy', 'medium', 'hard'].includes(String(v?.readability_level)) ? String(v.readability_level) : 'medium',
            winnerProbabilityPct: Math.max(0, Math.min(100, Number(v?.winner_probability_pct ?? 20))),
          })),
          recommendedDescription: String(l?.recommended_description ?? '').slice(0, 1200),
          recommendedStyle: DESCRIPTION_STYLES.includes(String(l?.recommended_style) as any) ? String(l.recommended_style) : 'storytelling',
          expectedEngagementIncreasePct: Math.round(Number(l?.expected_engagement_increase_pct ?? 0)),
          expectedConversionIncreasePct: Math.round(Number(l?.expected_conversion_increase_pct ?? 0)),
        })),
      descriptions: (parsed?.descriptions || []).slice(0, 10).map((d: any) => ({
        style: DESCRIPTION_STYLES.includes(String(d?.style) as any) ? String(d.style) : 'storytelling',
        description: String(d?.description ?? '').slice(0, 200),
        bestForCategory: String(d?.best_for_category ?? '').slice(0, 150),
        bestForPersona: String(d?.best_for_persona ?? '').slice(0, 150),
        avgOverallScore: Math.max(0, Math.min(100, Number(d?.avg_overall_score ?? 50))),
        exampleHook: String(d?.example_hook ?? '').slice(0, 200),
      })),
      mlScoring: (parsed?.ml_scoring || []).slice(0, 6).map((m: any) => ({
        metric: ['sentiment_score', 'readability_score', 'keyword_density', 'engagement_prediction', 'conversion_prediction', 'overall_score'].includes(String(m?.metric)) ? String(m.metric) : 'overall_score',
        weight: Math.max(0, Math.min(100, Number(m?.weight ?? 16))),
        description: String(m?.description ?? '').slice(0, 200),
        benchmark: Math.max(0, Math.min(100, Number(m?.benchmark ?? 50))),
        optimizationTip: String(m?.optimization_tip ?? '').slice(0, 250),
      })),
      personalization: (parsed?.personalization || []).slice(0, 10).map((p: any) => ({
        persona: ['bargain_hunter', 'collector', 'parent_family', 'student_young', 'professional', 'hobbyist', 'gift_giver', 'reseller', 'tech_enthusiast', 'seasonal_buyer'].includes(String(p?.persona)) ? String(p.persona) : 'bargain_hunter',
        bestStyle: DESCRIPTION_STYLES.includes(String(p?.best_style) as any) ? String(p.best_style) : 'storytelling',
        bestHook: String(p?.best_hook ?? '').slice(0, 200),
        bestCta: String(p?.best_cta ?? '').slice(0, 150),
        keywordsToInclude: (p?.keywords_to_include || []).slice(0, 6).map((k: any) => String(k).slice(0, 60)),
        keywordsToAvoid: (p?.keywords_to_avoid || []).slice(0, 4).map((k: any) => String(k).slice(0, 60)),
        expectedConversionPct: Math.max(0, Math.min(100, Number(p?.expected_conversion_pct ?? 30))),
      })),
      abTestPlan: (parsed?.ab_test_plan || [])
        .filter((t: any) => validIds.has(String(t?.listing_id ?? '')))
        .slice(0, 8)
        .map((t: any) => ({
          tradeId: String(t?.listing_id ?? '').slice(0, 50),
          variantAStyle: DESCRIPTION_STYLES.includes(String(t?.variant_a_style) as any) ? String(t.variant_a_style) : 'storytelling',
          variantBStyle: DESCRIPTION_STYLES.includes(String(t?.variant_b_style) as any) ? String(t.variant_b_style) : 'technical_specifications',
          testDurationDays: Math.max(3, Math.min(30, Number(t?.test_duration_days ?? 7))),
          primaryMetric: ['engagement', 'conversion_rate', 'inquiries', 'time_to_sale'].includes(String(t?.primary_metric)) ? String(t.primary_metric) : 'conversion_rate',
          expectedWinner: ['a', 'b'].includes(String(t?.expected_winner)) ? String(t.expected_winner) : 'b',
          confidenceLevelPct: Math.max(0, Math.min(100, Number(t?.confidence_level_pct ?? 95))),
        })),
      summary: {
        totalListingsProcessed: targetListings.length,
        totalVariantsGenerated: Math.max(0, Number(parsed?.summary?.total_variants_generated ?? targetListings.length * 5)),
        avgCurrentDescriptionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_current_description_score ?? 50))),
        avgRecommendedDescriptionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_recommended_description_score ?? 75))),
        avgImprovementPct: Math.round(Number(parsed?.summary?.avg_improvement_pct ?? 25) * 10) / 10,
        bestStyleOverall: DESCRIPTION_STYLES.includes(String(parsed?.summary?.best_style_overall) as any) ? String(parsed.summary.best_style_overall) : 'storytelling',
        biggestDescriptionIssue: String(parsed?.summary?.biggest_description_issue ?? '').slice(0, 200),
        quickestDescriptionWin: String(parsed?.summary?.quickest_description_win ?? '').slice(0, 200),
        descriptionGenerationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.description_generation_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, generator });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
