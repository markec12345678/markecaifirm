// v7.51 / v8.95.6-other: AI Search Keyword Optimizer — optimiziraj Bolha naslov + tags za iskanje.
// Refaktoriran z withAiRoute helperjem (v8.95.6-other) + enforceBudget guard.
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

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface SearchKeywordOptimizerInput {
  title: string;
  description: string;
  category: string;
}

interface ListingRow {
  title: string;
  price: number | null;
  monitor: { source: string } | null;
}

interface OptimizedResult {
  optimizedTitle: string;
  tags: string[];
  keywordsAdded: string[];
  keywordsRemoved: string[];
  reasoning: string;
  expectedVisibilityPct: number;
  searchVariations: string[];
}

export const POST = withAiRoute<SearchKeywordOptimizerInput>({
  endpoint: '/api/ai/search-keyword-optimizer',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      title: String(body?.title ?? ''),
      description: String(body?.description ?? ''),
      category: String(body?.category ?? ''),
    };
  },

  validateInput: (input) => (input.title ? null : 'title je obvezen'),

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { title, description, category } = input;

    // 1. Get popular search terms from existing listings (what people post = what people search)
    const popularListings = await db.listing.findMany({
      where: { isHidden: false, aiVerdict: 'PRILIKA' },
      select: { title: true, price: true, monitor: { select: { source: true } } },
      take: 200,
    });

    const topTerms = computeTopTerms(popularListings);

    // 2. Build prompt + call AI (with fallback to default response on failure)
    const prompt = buildPrompt({ title, description, category, topTerms });
    let raw: string;
    try {
      raw = await callAi(prompt);
    } catch {
      // Fallback to default response when AI unavailable (preserves original behavior)
      return apiOk({
        ok: true,
        original: { title, description: description.slice(0, 200) },
        optimized: buildDefaultOptimized(title),
      });
    }

    const parsed: any = parseAi(raw);

    return apiOk({
      ok: true,
      original: { title, description: description.slice(0, 200) },
      optimized: transformOptimized(parsed, title),
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function computeTopTerms(popularListings: ListingRow[]): string[] {
  const popularTerms = new Map<string, number>();
  for (const l of popularListings) {
    const words = l.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    for (const w of words) popularTerms.set(w, (popularTerms.get(w) ?? 0) + 1);
  }
  return Array.from(popularTerms.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([term, count]) => `${term} (${count})`);
}

interface PromptData {
  title: string;
  description: string;
  category: string;
  topTerms: string[];
}

function buildPrompt(d: PromptData): string {
  return `Si ekspert za SEO optimizacijo naslovov na slovenskih oglasnih platformah (Bolha, Vinted).

ORIGINALNI NASLOV: ${d.title}
KATEGORIJA: ${d.category || 'splošno'}
OPIS: ${d.description.slice(0, 300) || 'Ni opisa'}

PRILJUBLJENE ISKALNE BESEDE (iz 200 priložnosti):
${d.topTerms.join(', ')}

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
}

function buildDefaultOptimized(title: string): OptimizedResult {
  return {
    optimizedTitle: title.slice(0, 80),
    tags: [],
    keywordsAdded: [],
    keywordsRemoved: [],
    reasoning: 'AI ni na voljo — originalni naslov ohranjen.',
    expectedVisibilityPct: 50,
    searchVariations: [],
  };
}

function transformOptimized(parsed: any, title: string): OptimizedResult {
  return {
    optimizedTitle: String(parsed?.optimized_title ?? title).slice(0, 80),
    tags: (parsed?.tags || []).slice(0, 10).map((t: any) => String(t).slice(0, 30)),
    keywordsAdded: (parsed?.keywords_added || []).slice(0, 10).map((k: any) => String(k).slice(0, 50)),
    keywordsRemoved: (parsed?.keywords_removed || []).slice(0, 5).map((k: any) => String(k).slice(0, 50)),
    reasoning: String(parsed?.reasoning ?? '').slice(0, 300),
    expectedVisibilityPct: Math.max(0, Math.min(100, Number(parsed?.expected_visibility_pct ?? 50))),
    searchVariations: (parsed?.search_variations || []).slice(0, 8).map((s: any) => String(s).slice(0, 80)),
  };
}
