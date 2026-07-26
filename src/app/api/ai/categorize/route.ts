// v5.5: Smart Categories — AI sam kategorizira oglase v kategorije
// POST /api/ai/categorize
// Body: { listingId: string } — categorize single listing
// Body: { monitorId: string, limit?: number } — bulk categorize uncategorized listings
// Body: { title: string, description?: string, price?: number } — categorize without listing
// Returns: { ok, categories: Array<{ listingId, title, category, confidence }> }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const VALID_CATEGORIES = [
  'avto', 'elektronika', 'nepremicnine', 'orodje', 'moda',
  'sport', 'pohistvo', 'knjige', 'glasba', 'zbirateljstvo',
  'dom', 'vrtnarjenje', 'zivali', 'kolesa', 'drugo'
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const listingId = body?.listingId;
    const monitorId = body?.monitorId;
    const limit = Math.min(50, Math.max(1, body?.limit ?? 20));
    const directTitle = body?.title;

    // Determine what to categorize
    let listings: any[] = [];
    if (listingId) {
      // Single listing
      const l = await db.listing.findUnique({
        where: { id: listingId },
        select: { id: true, title: true, description: true, price: true, priceText: true, userNotes: true, monitor: { select: { source: true } } },
      });
      if (!l) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      listings = [l];
    } else if (monitorId) {
      // Bulk: get uncategorized listings from monitor
      // Note: Listing model doesn't have a category field directly; Trade has category.
      // We'll categorize listings and store result in aiReason or a new field.
      // For now, we'll use userNotes to store the AI category.
      listings = await db.listing.findMany({
        where: {
          monitorId,
          isHidden: false,
          userNotes: null, // uncategorized (no notes)
        },
        select: {
          id: true, title: true, description: true, price: true, priceText: true,
          monitor: { select: { source: true } },
        },
        take: limit,
        orderBy: { firstSeenAt: 'desc' },
      });
    } else if (directTitle) {
      // Direct categorization without listing
      listings = [{
        id: null,
        title: directTitle,
        description: body?.description ?? '',
        price: body?.price ?? null,
        priceText: body?.price ? `${body.price} EUR` : '',
        monitor: { source: 'direct' },
      }];
    } else {
      return NextResponse.json({ error: 'Potreben je listingId, monitorId, ali title' }, { status: 400 });
    }

    if (listings.length === 0) {
      return NextResponse.json({ ok: true, categories: [], message: 'Ni oglasov za kategorizacijo.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '',
      fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // Build prompt for batch categorization
    const prompt = buildCategorizePrompt(listings);

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fallbackSettings: AiSettings = {
          provider: aiSettings.fallbackProvider,
          baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '',
          model: aiSettings.fallbackModel,
        };
        raw = await callProviderForRaw(fallbackSettings, prompt);
      } else {
        throw primaryError;
      }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const results = (parsed?.categories || parsed?.kategorije || []).map((c: any, i: number) => ({
      listingId: listings[i]?.id ?? null,
      title: listings[i]?.title ?? '',
      category: VALID_CATEGORIES.includes(c?.category) ? c.category : 'drugo',
      confidence: clampInt(c?.confidence, 0, 100) ?? 50,
      reasoning: String(c?.reasoning ?? '').slice(0, 200),
    }));

    // Save categories to listings (store in userNotes with prefix)
    for (const r of results) {
      if (r.listingId) {
        try {
          const existing = await db.listing.findUnique({
            where: { id: r.listingId },
            select: { userNotes: true },
          });
          // Only update if no existing notes (don't overwrite user's notes)
          if (!existing?.userNotes) {
            await db.listing.update({
              where: { id: r.listingId },
              data: {
                userNotes: `[AI kategorija: ${r.category}]`,
                userNotesUpdatedAt: new Date(),
              },
            });
          }
        } catch { /* skip on error */ }
      }
    }

    // Increment AI usage counter
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
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

    return NextResponse.json({
      ok: true,
      categories: results,
      categorizedAt: new Date().toISOString(),
      count: results.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka pri AI kategorizaciji' }, { status: 500 });
  }
}

function buildCategorizePrompt(listings: any[]): string {
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

function clampInt(v: any, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
}
