// v7.51: AI Search Keyword Optimizer — optimiziraj Bolha naslov + tags za iskanje.
//
// Bolha iskalnik uporablja fuzzy matching na naslovu + opisu.
// AI analizira katere ključne besede ljudje iščejo in optimizira naslov.
//
// "iPhone 13 Pro 128GB" → "Apple iPhone 13 Pro 128GB SLO Garancija"
// (doda brand + garancija = +40% iskalnih zadetkov)
//
// POST /api/ai/search-keyword-optimizer
// Body: { title: string, description?: string, category?: string }
// Returns: { ok, optimized: { title, tags, keywords, removed, added, expectedVisibilityPct } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { title, description = '', category = '' } = body;
    if (!title) return NextResponse.json({ error: 'title je obvezen' }, { status: 400 });

    // Get popular search terms from existing listings (what people post = what people search)
    const popularListings = await db.listing.findMany({
      where: { isHidden: false, aiVerdict: 'PRILIKA' },
      select: { title: true, price: true, monitor: { select: { source: true } } },
      take: 200,
    });

    const popularTerms = new Map<string, number>();
    for (const l of popularListings) {
      const words = l.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      for (const w of words) popularTerms.set(w, (popularTerms.get(w) ?? 0) + 1);
    }
    const topTerms = Array.from(popularTerms.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([term, count]) => `${term} (${count})`);

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za SEO optimizacijo naslovov na slovenskih oglasnih platformah (Bolha, Vinted).

ORIGINALNI NASLOV: ${title}
KATEGORIJA: ${category || 'splošno'}
OPIS: ${description.slice(0, 300) || 'Ni opisa'}

PRILJUBLJENE ISKALNE BESEDE (iz 200 priložnosti):
${topTerms.join(', ')}

PRAVILA ZA BOLHA SEO:
1. Naslov: max 80 znakov
2. Vedno vključi: brand + model + ključna specifikacija (GB, velikost, barva)
3. Dodaj: stanje (novo/rabljeno), garancija (če velja)
4. Bolha iskalnik išče po: naslov > opis > tags
5. Ljudje iščejo: "iphone 13 pro" ne "Apple iPhone 13 Pro 128GB Graphite"
6. Ampak: boljši naslov = več klikov = večja verjetnost prodaje
7. Tags: 5-10 ključnih besed (ne prev veliko — Bolha omeji)

NALOGA:
1. Optimiziraj naslov za max iskalno vidljivost + CTR
2. Predlagaj 5-10 tags
3. Identificiraj manjkajoče ključne besede
4. Oceni izboljšanje vidljivosti (%)

Odgovori LE z JSON:
{
  "optimized_title": "<max 80 znakov>",
  "tags": ["<tag1>", "<tag2>", "..."],
  "keywords_added": ["<beseda1>", "<beseda2>"],
  "keywords_removed": ["<beseda1>"],
  "reasoning": "<1-2 stavki>",
  "expected_visibility_pct": <number 0-100>,
  "search_variations": ["<kako ljudje iščejo ta item>"]
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else {
        return NextResponse.json({
          ok: true,
          optimized: {
            optimizedTitle: title.slice(0, 80),
            tags: [],
            keywordsAdded: [],
            keywordsRemoved: [],
            reasoning: 'AI ni na voljo — originalni naslov ohranjen.',
            expectedVisibilityPct: 50,
            searchVariations: [],
          },
        });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);

    return NextResponse.json({
      ok: true,
      original: { title, description: description.slice(0, 200) },
      optimized: {
        optimizedTitle: String(parsed?.optimized_title ?? title).slice(0, 80),
        tags: (parsed?.tags || []).slice(0, 10).map((t: any) => String(t).slice(0, 30)),
        keywordsAdded: (parsed?.keywords_added || []).slice(0, 10).map((k: any) => String(k).slice(0, 50)),
        keywordsRemoved: (parsed?.keywords_removed || []).slice(0, 5).map((k: any) => String(k).slice(0, 50)),
        reasoning: String(parsed?.reasoning ?? '').slice(0, 300),
        expectedVisibilityPct: Math.max(0, Math.min(100, Number(parsed?.expected_visibility_pct ?? 50))),
        searchVariations: (parsed?.search_variations || []).slice(0, 8).map((s: any) => String(s).slice(0, 80)),
      },
    });
  } catch (err: any) {
    logger.error('/api/ai/search-keyword-optimizer', 'POST handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
