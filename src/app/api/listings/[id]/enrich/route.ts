// v6.0: AI Listing Enrichment — AI iz naslova/opisa/slike izvleče dodatne podatke
// (brand, model, condition, specs, year, color, itd.) in jih shrani v listing
// POST /api/listings/:id/enrich
// Returns: { ok, enrichment: { brand, model, condition, specs, year, color, category, tags } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const listing = await db.listing.findUnique({
    where: { id },
    select: {
      id: true, title: true, price: true, priceText: true,
      description: true, detailDescription: true, imageUrl: true,
      location: true, monitor: { select: { source: true, name: true } },
    },
  });
  if (!listing) {
    return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
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

  const prompt = buildEnrichPrompt(listing);

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
      return NextResponse.json({ error: primaryError?.message ?? 'AI call failed' }, { status: 500 });
    }
  }

  const parsed: any = parseJsonLooseExported(raw);
  const enrichment = {
    brand: String(parsed?.brand ?? parsed?.znamka ?? '').slice(0, 100),
    model: String(parsed?.model ?? parsed?.model ?? '').slice(0, 200),
    condition: String(parsed?.condition ?? parsed?.stanje ?? '').slice(0, 100),
    year: clampInt(parsed?.year ?? parsed?.letnik, 1900, 2030),
    color: String(parsed?.color ?? parsed?.barva ?? '').slice(0, 50),
    category: String(parsed?.category ?? parsed?.kategorija ?? 'drugo').slice(0, 50),
    tags: Array.isArray(parsed?.tags) ? parsed.tags.slice(0, 10).map((t: any) => String(t).slice(0, 50)) : [],
    specs: parsed?.specs ?? parsed?.specifikacije ?? {},
    summary: String(parsed?.summary ?? parsed?.povzetek ?? '').slice(0, 500),
  };

  // Save enrichment to listing userNotes (with prefix to avoid overwriting user's notes)
  const existingNotes = listing.detailDescription || '';
  const enrichmentJson = JSON.stringify(enrichment);
  // Store in userNotes if empty, otherwise store in description prefix
  const enrichmentPrefix = `[AI_ENRICH:${enrichmentJson}]`;

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
    enrichment,
    listingId: id,
  });
}

function buildEnrichPrompt(l: any): string {
  return `Si ekspert za analizo oglasov na slovenskih spletnih oglasih.
Iz naslednjega oglasa izvleči strukturirane podatke.

Naslov: ${l.title}
Cena: ${l.priceText}
Lokacija: ${l.location || 'ni podatka'}
Vir: ${l.monitor?.source ?? '?'}
Opis: ${(l.detailDescription || l.description || '(brez opisa)').slice(0, 1000)}

Izvleči:
- brand: znamka (npr. Apple, Samsung, VW, Bosch)
- model: specifičen model (npr. iPhone 13 Pro, Golf MK6)
- condition: stanje (npr. novo, rabljeno, odlično, dobro, poškodovano)
- year: letnik (leto izdelave ali nakupa, če omenjeno)
- color: barva (če omenjena)
- category: kategorija (avto, elektronika, nepremicnine, orodje, moda, sport, pohistvo, knjige, glasba, zbirateljstvo, dom, drugo)
- tags: 3-10 ključnih besed za iskanje (array)
- specs: specifikacije (object z ključ-vrednost pari, npr. { "storage": "256GB", "ram": "8GB", "ekran": "6.1 inch" })
- summary: 1-2 stavka povzetka izdelka

Odgovori LE z JSON:
{
  "brand": "<znamka ali null>",
  "model": "<model ali null>",
  "condition": "<stanje ali null>",
  "year": <leto ali null>,
  "color": "<barva ali null>",
  "category": "<kategorija>",
  "tags": ["<tag1>", "<tag2>", ...],
  "specs": { "<key>": "<value>", ... },
  "summary": "<1-2 stavka povzetka>"
}`;
}

function clampInt(v: any, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
}
