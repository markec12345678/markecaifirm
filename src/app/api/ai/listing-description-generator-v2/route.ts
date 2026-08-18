/**
 * @deprecated v8.94 — uporabi `/api/ai/listing-description-generator-v3` namesto tega.
 * Zastareli v2 — v3 je najnovejši.
 * Ta endpoint bo odstranjen v v9.0. Glej ENDPOINTS_AUDIT.md za migracijski načrt.
 */
// v6.51: AI Listing Description Generator v2 — multi-platform, multi-tone opisi z A/B variantami
// POST /api/ai/listing-description-generator-v2
// Body: { tradeId?: string, platforms?: string[], tones?: string[], generateVariants?: number }
// Returns: { ok, generator: { listings, variants, platformOptimizations, abTestPlan, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';
import { logDeprecatedCall } from '@/lib/deprecated-redirect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PLATFORM_SPECS = {
  bolha: { maxLen: 4000, language: 'sl', style: 'technical', audience: 'slovenski kupci' },
  facebook: { maxLen: 5000, language: 'sl', style: 'emotional', audience: 'lokalna skupnost' },
  vinted: { maxLen: 1500, language: 'sl', style: 'trendy', audience: 'modno ozaveščeni' },
  ebay: { maxLen: 8000, language: 'en', style: 'detailed', audience: 'mednarodni collectorji' },
  kleinanzeigen: { maxLen: 4000, language: 'de', style: 'practical', audience: 'nemški kupci' },
} as const;

type Platform = keyof typeof PLATFORM_SPECS;

const TONES = ['professional', 'friendly', 'urgent', 'luxury', 'playful', 'technical'] as const;
type Tone = typeof TONES[number];

export async function POST(req: NextRequest) {
  logDeprecatedCall('/api/ai/listing-description-generator-v2', req, '/api/ai/listing-description-generator-v3');
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const platforms: Platform[] = Array.isArray(body?.platforms) && body.platforms.length > 0
      ? body.platforms.filter((p: string) => p in PLATFORM_SPECS)
      : ['bolha', 'facebook'];
    const tones: Tone[] = Array.isArray(body?.tones) && body.tones.length > 0
      ? body.tones.filter((t: string) => TONES.includes(t as Tone))
      : ['professional', 'friendly'];
    const variantCount = Math.max(1, Math.min(3, Number(body?.generateVariants ?? 2)));

    // 1. Pridobi held trade
    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;

    const heldTrades = await db.trade.findMany({
      where,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true, location: true, aiImageAnalysis: true } },
      },
      take: tradeId ? 1 : 10,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, generator: null, message: 'Ni held tradeov za opis generacijo.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // 2. Pripravi item podatke
    const items = heldTrades.map(t => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));
      return {
        id: t.id, title: t.title, category: t.category || 'drugo',
        cost, estValue, daysHeld,
        originalDescription: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 500),
        location: t.listing?.location || '',
        imageAnalysis: t.listing?.aiImageAnalysis ?? '',
      };
    });

    const itemsStr = items.map(i =>
      `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d | lokacija: ${i.location || 'nepoznano'}`
    ).join('\n');

    const platformStr = platforms.map(p => `${p} (${PLATFORM_SPECS[p].language}, ${PLATFORM_SPECS[p].style}, max ${PLATFORM_SPECS[p].maxLen}c)`).join(', ');
    const tonesStr = tones.join(', ');

    const prompt = `Si AI listing description generator v2 za slovenske in mednarodne oglasne platforme.
Generiraj optimizirane opise za vsak item na vsaki platformi v vsakem tonu z A/B variantami.

ITEMS (${items.length}):
${itemsStr}

PLATFORME (${platforms.length}): ${platformStr}

TONI (${tones.length}): ${tonesStr}
- PROFESSIONAL: posloven, dejanski, specifikacije
- FRIENDLY: prijateljski, osebni, topel
- URGENT: nujno, časovno omejeno, akcijsko
- LUXURY: premium, ekskluziven, prestižen
- PLAYFUL: igriv, zabaven, kreativen
- TECHNICAL: tehničen, podroben, specifikacije

Generacijska pravila per platforma:
- BOLHA: tehničen opis s specifikacijami, stanje, garancija, CTA
- FACEBOOK: čustven opis z osebnim pristopom, zgodba, CTA
- VINTED: moden, kreativen opis z emoji-ji in brand storytelling
- EBAY: angleški opis z mednarodnimi specifikacijami, shipping info
- KLEINANZEIGEN: nemški opis z praktičnimi informacijami

Opis struktura (500-800 znakov):
1. HOOK: prva poved ki pridobi pozornost (različno per ton)
2. SPECIFICATIONS: tehnične podrobnosti, dimenzije, material
3. CONDITION: stanje, starost, razlog prodaje
4. VALUE_PROPOSITION: zakaj ta item, kaj loči od konkurence
5. TRUST: garancija, vračila, originalna embalaža
6. CTA: jasen poziv k akciji

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "trade_id": "<trade_id>",
      "title": "<naslov>",
      "descriptions": [
        {
          "platform": "<bolha|facebook|vinted|ebay|kleinanzeigen>",
          "tone": "<professional|friendly|urgent|luxury|playful|technical>",
          "description": "<500-800 znakov optimiziran opis>",
          "word_count": <number>,
          "char_count": <number>,
          "hook": "<prva poved, max 100 znakov>",
          "cta": "<call to action, max 80 znakov>",
          "keywords_included": ["<5 ključnih besed>"],
          "emojis_used": <boolean>,
          "expected_engagement_score": <number 0-100>,
          "expected_conversion_pct": <number 0-100>,
          "language": "<sl|en|de>"
        }
      ]
    }
  ],
  "variants": [
    {
      "trade_id": "<trade_id>",
      "platform": "<platforma>",
      "variant_a": { "tone": "<tone>", "description": "<opis>", "expected_conversion_pct": <number> },
      "variant_b": { "tone": "<tone>", "description": "<opis>", "expected_conversion_pct": <number> },
      "variant_c": { "tone": "<tone>", "description": "<opis>", "expected_conversion_pct": <number> },
      "recommended_variant": "<a|b|c>",
      "reasoning": "<max 120 znakov>"
    }
  ],
  "platform_optimizations": [
    {
      "platform": "<bolha|facebook|vinted|ebay|kleinanzeigen>",
      "title_rule": "<max 80 znakov>",
      "description_structure": "<max 200 znakov>",
      "tone_recommendation": "<professional|friendly|urgent|luxury|playful|technical>",
      "language": "<sl|en|de>",
      "special_tips": ["<max 100 znakov>"],
      "word_count_target": <number>,
      "emoji_usage": "<recommended|optional|avoid>"
    }
  ],
  "ab_test_plan": [
    {
      "trade_id": "<trade_id>",
      "platform": "<platforma>",
      "variant_a_tone": "<tone>",
      "variant_b_tone": "<tone>",
      "test_duration_days": <number>,
      "primary_metric": "<views|inquiries|conversion_rate>",
      "success_threshold_pct": <number>,
      "winner_selection_criteria": "<max 120 znakov>"
    }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_conversion_lift_pct": <number>, "platforms_affected": <number> }
  ],
  "summary": {
    "total_items_processed": <number>,
    "total_descriptions_generated": <number>,
    "platforms_used": <number>,
    "tones_used": <number>,
    "avg_engagement_score": <number>,
    "avg_conversion_pct": <number>,
    "best_tone_overall": "<tone>",
    "best_platform_overall": "<platforma>",
    "best_combination": "<max 100 znakov>",
    "generator_efficiency_score": <number 0-100>
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

    const generator = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      listings: (parsed?.listings || [])
        .filter((l: any) => validIds.has(String(l?.trade_id ?? '')))
        .slice(0, 10)
        .map((l: any) => ({
          tradeId: String(l?.trade_id ?? '').slice(0, 50),
          title: String(l?.title ?? '').slice(0, 150),
          descriptions: (l?.descriptions || [])
            .filter((d: any) => platforms.includes(String(d?.platform) as Platform) && tones.includes(String(d?.tone) as Tone))
            .slice(0, platforms.length * tones.length)
            .map((d: any) => ({
              platform: platforms.includes(String(d?.platform) as Platform) ? String(d.platform) : 'bolha',
              tone: tones.includes(String(d?.tone) as Tone) ? String(d.tone) : 'professional',
              description: String(d?.description ?? '').slice(0, 1200),
              wordCount: Math.max(0, Number(d?.word_count ?? 0)),
              charCount: Math.max(0, Number(d?.char_count ?? 0)),
              hook: String(d?.hook ?? '').slice(0, 200),
              cta: String(d?.cta ?? '').slice(0, 150),
              keywordsIncluded: (d?.keywords_included || []).slice(0, 8).map((k: any) => String(k).slice(0, 50)),
              emojisUsed: Boolean(d?.emojis_used ?? false),
              expectedEngagementScore: Math.max(0, Math.min(100, Number(d?.expected_engagement_score ?? 50))),
              expectedConversionPct: Math.max(0, Math.min(100, Number(d?.expected_conversion_pct ?? 30))),
              language: ['sl', 'en', 'de'].includes(String(d?.language)) ? String(d.language) : 'sl',
            })),
        })),
      variants: (parsed?.variants || [])
        .filter((v: any) => validIds.has(String(v?.trade_id ?? '')))
        .slice(0, 10)
        .map((v: any) => ({
          tradeId: String(v?.trade_id ?? '').slice(0, 50),
          platform: platforms.includes(String(v?.platform) as Platform) ? String(v.platform) : 'bolha',
          variantA: {
            tone: tones.includes(String(v?.variant_a?.tone) as Tone) ? String(v.variant_a.tone) : 'professional',
            description: String(v?.variant_a?.description ?? '').slice(0, 1200),
            expectedConversionPct: Math.max(0, Math.min(100, Number(v?.variant_a?.expected_conversion_pct ?? 30))),
          },
          variantB: {
            tone: tones.includes(String(v?.variant_b?.tone) as Tone) ? String(v.variant_b.tone) : 'friendly',
            description: String(v?.variant_b?.description ?? '').slice(0, 1200),
            expectedConversionPct: Math.max(0, Math.min(100, Number(v?.variant_b?.expected_conversion_pct ?? 30))),
          },
          variantC: v?.variant_c ? {
            tone: tones.includes(String(v?.variant_c?.tone) as Tone) ? String(v.variant_c.tone) : 'urgent',
            description: String(v?.variant_c?.description ?? '').slice(0, 1200),
            expectedConversionPct: Math.max(0, Math.min(100, Number(v?.variant_c?.expected_conversion_pct ?? 30))),
          } : null,
          recommendedVariant: ['a', 'b', 'c'].includes(String(v?.recommended_variant)) ? String(v.recommended_variant) : 'a',
          reasoning: String(v?.reasoning ?? '').slice(0, 250),
        })),
      platformOptimizations: (parsed?.platform_optimizations || [])
        .filter((p: any) => platforms.includes(String(p?.platform) as Platform))
        .slice(0, 5)
        .map((p: any) => ({
          platform: platforms.includes(String(p?.platform) as Platform) ? String(p.platform) : 'bolha',
          titleRule: String(p?.title_rule ?? '').slice(0, 150),
          descriptionStructure: String(p?.description_structure ?? '').slice(0, 300),
          toneRecommendation: TONES.includes(String(p?.tone_recommendation) as Tone) ? String(p.tone_recommendation) : 'professional',
          language: ['sl', 'en', 'de'].includes(String(p?.language)) ? String(p.language) : 'sl',
          specialTips: (p?.special_tips || []).slice(0, 5).map((t: any) => String(t).slice(0, 150)),
          wordCountTarget: Math.max(0, Number(p?.word_count_target ?? 0)),
          emojiUsage: ['recommended', 'optional', 'avoid'].includes(String(p?.emoji_usage)) ? String(p.emoji_usage) : 'optional',
        })),
      abTestPlan: (parsed?.ab_test_plan || [])
        .filter((t: any) => validIds.has(String(t?.trade_id ?? '')))
        .slice(0, 10)
        .map((t: any) => ({
          tradeId: String(t?.trade_id ?? '').slice(0, 50),
          platform: platforms.includes(String(t?.platform) as Platform) ? String(t.platform) : 'bolha',
          variantATone: tones.includes(String(t?.variant_a_tone) as Tone) ? String(t.variant_a_tone) : 'professional',
          variantBTone: tones.includes(String(t?.variant_b_tone) as Tone) ? String(t.variant_b_tone) : 'friendly',
          testDurationDays: Math.max(1, Math.min(30, Number(t?.test_duration_days ?? 7))),
          primaryMetric: ['views', 'inquiries', 'conversion_rate'].includes(String(t?.primary_metric)) ? String(t.primary_metric) : 'conversion_rate',
          successThresholdPct: Math.round(Number(t?.success_threshold_pct ?? 5)),
          winnerSelectionCriteria: String(t?.winner_selection_criteria ?? '').slice(0, 250),
        })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        expectedConversionLiftPct: Math.round(Number(r?.expected_conversion_lift_pct ?? 0)),
        platformsAffected: Math.max(0, Number(r?.platforms_affected ?? 0)),
      })),
      summary: {
        totalItemsProcessed: items.length,
        totalDescriptionsGenerated: Math.max(0, Number(parsed?.summary?.total_descriptions_generated ?? items.length * platforms.length * tones.length)),
        platformsUsed: platforms.length,
        tonesUsed: tones.length,
        avgEngagementScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_engagement_score ?? 60))),
        avgConversionPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_conversion_pct ?? 30))),
        bestToneOverall: TONES.includes(String(parsed?.summary?.best_tone_overall) as Tone) ? String(parsed.summary.best_tone_overall) : 'professional',
        bestPlatformOverall: platforms.includes(String(parsed?.summary?.best_platform_overall) as Platform) ? String(parsed.summary.best_platform_overall) : 'bolha',
        bestCombination: String(parsed?.summary?.best_combination ?? '').slice(0, 200),
        generatorEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.generator_efficiency_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, generator });
  } catch (e: any) { logger.error("/api/ai/listing-description-generator-v2", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
