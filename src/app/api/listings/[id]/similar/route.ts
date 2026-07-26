// v5.7: AI Listing Similarity — najdi podobne oglase preko AI analize
// GET /api/listings/:id/similar
// AI primerja naslov, ceno, opis in najde podobne oglase v bazi
// Returns: { ok, similar: Array<{ listingId, title, price, url, similarityScore, reason }> }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const listing = await db.listing.findUnique({
    where: { id },
    select: {
      id: true, title: true, price: true, priceText: true, url: true,
      description: true, detailDescription: true,
      aiVerdict: true, aiScore: true, aiEstimatedValue: true, dealScore: true,
      monitor: { select: { name: true, source: true } },
    },
  });
  if (!listing) {
    return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
  }

  // Get candidate listings (same or different monitors, recent, with price)
  const candidates = await db.listing.findMany({
    where: {
      id: { not: id },
      isHidden: false,
      price: { not: null },
      firstSeenAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    select: {
      id: true, title: true, price: true, priceText: true, url: true,
      location: true, aiVerdict: true, aiScore: true, dealScore: true,
      firstSeenAt: true, imageUrl: true,
      monitor: { select: { name: true, source: true } },
    },
    take: 50,
    orderBy: { firstSeenAt: 'desc' },
  });

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, similar: [], message: 'Ni kandidatov za primerjavo.' });
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

  const prompt = buildSimilarPrompt(listing, candidates.slice(0, 30));

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
  const similar = (parsed?.similar || []).map((s: any, i: number) => ({
    listingId: candidates[i]?.id ?? null,
    title: candidates[i]?.title ?? '',
    price: candidates[i]?.price ?? null,
    priceText: candidates[i]?.priceText ?? '',
    url: candidates[i]?.url ?? '',
    location: candidates[i]?.location ?? '',
    imageUrl: candidates[i]?.imageUrl ?? null,
    monitor: candidates[i]?.monitor ?? null,
    aiVerdict: candidates[i]?.aiVerdict ?? null,
    dealScore: candidates[i]?.dealScore ?? null,
    similarityScore: clampInt(s?.similarity_score ?? s?.similarityScore, 0, 100) ?? 0,
    reason: String(s?.reason ?? '').slice(0, 200),
  })).filter((s: any) => s.listingId && s.similarityScore >= 30)
    .sort((a: any, b: any) => b.similarityScore - a.similarityScore);

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
    similar,
    analyzedCount: candidates.length,
  });
}

function buildSimilarPrompt(target: any, candidates: any[]): string {
  const parts: string[] = [
    'Si ekspert za primerjavo oglasov na slovenskih spletnih oglasih.',
    'Za vsak kandidat določi similarity score (0-100) glede na referenčni oglas.',
    '',
    '*Referenčni oglas:*',
    `Naslov: ${target.title}`,
    `Cena: ${target.priceText} (${target.price}€)`,
    `Opis: ${(target.detailDescription || target.description || '').slice(0, 300)}`,
    `Vir: ${target.monitor?.source ?? '?'}`,
    '',
    '*Kandidati:*',
  ];

  candidates.forEach((c, i) => {
    parts.push(`${i + 1}. ${c.title} — ${c.priceText} (${c.monitor?.source ?? '?'})`);
  });

  parts.push('', 'Pravila za similarity:');
  parts.push('- 90-100: skoraj identičen izdelek (isti model, stanje, dodatki)');
  parts.push('- 70-89: zelo podoben (isti model, drugačno stanje/cena)');
  parts.push('- 50-69: podoben (ista kategorija, primerljiva specifikacija)');
  parts.push('- 30-49: delno podoben (ista kategorija, drugačen model)');
  parts.push('- 0-29: ni podoben');
  parts.push('', 'Odgovori LE z JSON:');
  parts.push('{');
  parts.push('  "similar": [');
  parts.push('    {');
  parts.push('      "similarity_score": <0-100>,');
  parts.push('      "reason": "<kratek razlog v slovenščini, max 50 znakov>"');
  parts.push('    }');
  parts.push(`    ... (${candidates.length} kandidatov, v istem vrstnem redu)`);
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
