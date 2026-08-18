// v5.5 / v8.94-refactor: Smart Categories — AI sam kategorizira oglase
// Refaktoriran z withAiRoute helperjem (v8.94).
//
// POST /api/ai/categorize
// Body: { listingId: string } — categorize single listing
// Body: { monitorId: string, limit?: number } — bulk categorize uncategorized listings
// Body: { title: string, description?: string, price?: number } — categorize without listing
// Returns: { ok, categories: Array<{ listingId, title, category, confidence }> }

import { NextResponse } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest, apiNotFound } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 120;

const VALID_CATEGORIES = [
  'avto', 'elektronika', 'nepremicnine', 'orodje', 'moda',
  'sport', 'pohistvo', 'knjige', 'glasba', 'zbirateljstvo',
  'dom', 'vrtnarjenje', 'zivali', 'kolesa', 'drugo',
] as const;
type ValidCategory = typeof VALID_CATEGORIES[number];

interface CategorizeInput {
  listingId?: string;
  monitorId?: string;
  limit: number;
  title?: string;
  description?: string;
  price?: number;
}

export const POST = withAiRoute<CategorizeInput>({
  endpoint: '/api/ai/categorize',
  maxDuration: 120,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      listingId: body?.listingId ? String(body.listingId) : undefined,
      monitorId: body?.monitorId ? String(body.monitorId) : undefined,
      limit: Math.min(50, Math.max(1, Number(body?.limit ?? 20))),
      title: body?.title ? String(body.title) : undefined,
      description: body?.description ? String(body.description) : undefined,
      price: typeof body?.price === 'number' ? body.price : Number(body?.price) || undefined,
    };
  },

  validateInput: (input) => {
    if (!input.listingId && !input.monitorId && !input.title) {
      return 'Potreben je listingId, monitorId, ali title';
    }
    return null;
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    // 1. Določi kaj kategorizirati (3 načini)
    const listings = await resolveListings(input, db);
    if (listings.length === 0) {
      return apiOk({ categories: [], message: 'Ni oglasov za kategorizacijo.' });
    }

    // 2. AI klic
    const prompt = buildCategorizePrompt(listings);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    // 3. Transformacija rezultatov
    const results = (parsed?.categories || parsed?.kategorije || []).map((c: any, i: number) => ({
      listingId: listings[i]?.id ?? null,
      title: listings[i]?.title ?? '',
      category: (VALID_CATEGORIES as readonly string[]).includes(String(c?.category))
        ? String(c.category) as ValidCategory : 'drugo',
      confidence: clampInt(c?.confidence, 0, 100) ?? 50,
      reasoning: String(c?.reasoning ?? '').slice(0, 200),
    }));

    // 4. Side effect: shrani kategorije v listings (samo če ni user notes)
    await saveCategoriesToDb(results, db);

    // 5. Side effect: inkrementiraj AI counter
    await incrementAiCallCounter(db);

    return apiOk({
      categories: results,
      categorizedAt: new Date().toISOString(),
      count: results.length,
    });
  },
});

// --- Pomožne funkcije -----------------------------------------------------

/** Določi seznam listing-ov glede na input (3 načini). */
async function resolveListings(
  input: CategorizeInput,
  db: AiRouteContext['db']
): Promise<Array<{ id: string | null; title: string; description?: string; price: number | null; priceText: string; monitor?: { source: string } }>> {
  if (input.listingId) {
    const l = await db.listing.findUnique({
      where: { id: input.listingId },
      select: {
        id: true, title: true, description: true, price: true, priceText: true,
        userNotes: true, monitor: { select: { source: true } },
      },
    });
    if (!l) {
      throw new ApiRouteError('Listing ne obstaja', 404);
    }
    return [l];
  }

  if (input.monitorId) {
    return await db.listing.findMany({
      where: {
        monitorId: input.monitorId,
        isHidden: false,
        userNotes: null, // uncategorized
      },
      select: {
        id: true, title: true, description: true, price: true, priceText: true,
        monitor: { select: { source: true } },
      },
      take: input.limit,
      orderBy: { firstSeenAt: 'desc' },
    });
  }

  // Direct (brez listinga)
  return [{
    id: null,
    title: input.title ?? '',
    description: input.description ?? '',
    price: input.price ?? null,
    priceText: input.price ? `${input.price} EUR` : '',
    monitor: { source: 'direct' },
  }];
}

/** Shrani AI kategorije v listings.userNotes (samo če notes še ni nastavljen). */
async function saveCategoriesToDb(
  results: Array<{ listingId: string | null; category: string }>,
  db: AiRouteContext['db']
): Promise<void> {
  for (const r of results) {
    if (!r.listingId) continue;
    try {
      const existing = await db.listing.findUnique({
        where: { id: r.listingId },
        select: { userNotes: true },
      });
      if (!existing?.userNotes) {
        await db.listing.update({
          where: { id: r.listingId },
          data: {
            userNotes: `[AI kategorija: ${r.category}]`,
            userNotesUpdatedAt: new Date(),
          },
        });
      }
    } catch {
      // skip on error (non-fatal)
    }
  }
}

/** Build prompt za batch kategorizacijo. */
function buildCategorizePrompt(
  listings: Array<{ title: string; description?: string; priceText?: string; monitor?: { source: string } }>
): string {
  const parts: string[] = [
    'Si ekspert za kategorizacijo oglasov na slovenskih spletnih oglasih.',
    'Za vsak oglas določi pravo kategorijo iz naslednjega seznama:',
    '',
    ...VALID_CATEGORIES.map(c => `- ${c}`),
    '',
    'Pravila:',
    '- Avto: vsa motorna vozila, rezervni deli, pnevmatike za avto',
    '- Elektronika: telefoni, računalniki, TV, audio, konzole',
    '- Nepremičnine: stanovanja, hiše, zemljišča, garaže',
    '- Orodje: ročno in električno orodje, stroji',
    '- Moda: oblačila, obutev, modni dodatki',
    '- Sport: športna oprema, fitnes, prosti čas',
    '- Pohistvo: mize, stoli, omare, postelje',
    '- Knjige: knjige, revije, učbeniki',
    '- Glasba: instrumenti, oprema, vinilke',
    '- Zbirateljstvo: numizmatika, filatelija, umetnine, starine',
    '- Dom: gospodinjski aparati, dekoracija',
    '- Vrtnarjenje: rastline, semena, vrtna oprema',
    '- Živali: hišni ljubljenčki, hrana za živali',
    '- Kolesa: kolesa, e-bike, deleži',
    '- Drugo: vse kar ne spada zgoraj',
    '',
    'Oglasi za kategorizacijo:',
  ];

  listings.forEach((l, i) => {
    parts.push(`--- Oglas #${i + 1} ---`);
    parts.push(`Naslov: ${l.title}`);
    if (l.description) parts.push(`Opis: ${l.description.slice(0, 200)}`);
    if (l.priceText) parts.push(`Cena: ${l.priceText}`);
    if (l.monitor?.source) parts.push(`Vir: ${l.monitor.source}`);
    parts.push('');
  });

  parts.push('Odgovori LE z JSON:');
  parts.push('{');
  parts.push('  "categories": [');
  parts.push('    {');
  parts.push('      "category": "<ena izmed kategorij zgoraj>",');
  parts.push('      "confidence": <0-100>,');
  parts.push('      "reasoning": "<kratek razlog, max 50 znakov>"');
  parts.push('    }');
  parts.push(`    ... (${listings.length} kategorij, v istem vrstnem redu)`);
  parts.push('  ]');
  parts.push('}');

  return parts.join('\n');
}

function clampInt(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
}

/**
 * Side effect: inkrementiraj dnevni AI counter.
 * TODO (v8.95): razširi z token count + EUR tracking.
 */
async function incrementAiCallCounter(db: AiRouteContext['db']): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const settings = await db.settings.findUnique({
    where: { id: 'singleton' },
    select: { aiCallsDate: true },
  });
  if (settings?.aiCallsDate !== today) {
    await db.settings.update({
      where: { id: 'singleton' },
      data: { aiCallsDate: today, aiCallsToday: 1 },
    });
  } else {
    await db.settings.update({
      where: { id: 'singleton' },
      data: { aiCallsToday: { increment: 1 } },
    });
  }
}
