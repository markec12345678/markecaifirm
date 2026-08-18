// v6.1 / v8.94-refactor: AI Listing Deduplication — AI zazna duplicirane oglase
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/deduplicate
// Body: { monitorId?: string, days?: number, limit?: number }
// Returns: { ok, duplicates: Array<{ listings: [...], similarityScore, reason }> }

import { NextResponse } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 120;

interface DeduplicateInput {
  monitorId?: string;
  days: number;
  limit: number;
}

export const POST = withAiRoute<DeduplicateInput>({
  endpoint: '/api/ai/deduplicate',
  maxDuration: 120,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const daysRaw = typeof body?.days === 'number' ? body.days : Number(body?.days);
    return {
      days: Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, daysRaw)) : 14,
      limit: Math.min(100, Math.max(10, Number(body?.limit ?? 50))),
      monitorId: body?.monitorId ? String(body.monitorId) : undefined,
    };
  },

  // No validateInput — vsi input-i imajo defaults
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { days, limit, monitorId } = input;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // 1. Pridobi nedavne oglase
    const where: any = { firstSeenAt: { gte: since }, isHidden: false };
    if (monitorId) where.monitorId = monitorId;

    const listings = await db.listing.findMany({
      where,
      select: {
        id: true, title: true, price: true, priceText: true, url: true,
        location: true, externalId: true,
        monitor: { select: { name: true, source: true } },
      },
      orderBy: { firstSeenAt: 'desc' },
      take: limit * 2,
    });

    if (listings.length < 2) {
      return apiOk({ duplicates: [], message: 'Premalo oglasov za deduplikacijo.' });
    }

    // 2. Fast path: grupiraj po normaliziranem naslovu
    const candidateGroups = findExactTitleMatches(listings);
    if (candidateGroups.length > 0) {
      const duplicates = candidateGroups.map(group => buildExactDuplicate(group));
      return apiOk({
        duplicates,
        analyzedCount: listings.length,
        duplicateGroups: duplicates.length,
        totalDuplicates: duplicates.reduce((s, d) => s + d.listings.length, 0),
      });
    }

    // 3. Slow path: AI deduplikacija za top N listingov
    return await aiDeduplicate(listings.slice(0, Math.min(30, limit)), callAi, parseAi);
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '').trim().slice(0, 100);
}

interface ListingInfo {
  id: string; title: string; price: number | null; priceText: string;
  url: string; source?: string; monitorName?: string;
}

function findExactTitleMatches(listings: Array<{
  id: string; title: string; price: number | null; priceText: string;
  url: string; externalId: string | null; monitor: { name: string; source: string } | null;
}>): Array<typeof listings> {
  const titleGroups = new Map<string, typeof listings>();
  for (const l of listings) {
    const norm = normalizeTitle(l.title);
    if (norm.length < 5) continue;
    if (!titleGroups.has(norm)) titleGroups.set(norm, []);
    titleGroups.get(norm)!.push(l);
  }
  return Array.from(titleGroups.values()).filter(group => group.length >= 2);
}

function buildExactDuplicate(group: Array<{
  id: string; title: string; price: number | null; priceText: string;
  url: string; monitor: { name: string; source: string } | null;
}>): { listings: ListingInfo[]; similarityScore: number; reason: string } {
  const prices = group.map(l => l.price).filter(Boolean);
  const samePrice = prices.length > 1 && prices.every(p => p === prices[0]);
  const sources = Array.from(new Set(group.map(l => l.monitor?.source)));
  return {
    listings: group.map(l => ({
      id: l.id, title: l.title, price: l.price, priceText: l.priceText,
      url: l.url, source: l.monitor?.source, monitorName: l.monitor?.name,
    })),
    similarityScore: samePrice ? 100 : 85,
    reason: samePrice
      ? 'Identičen naslov in cena'
      : `Identičen naslov, različna cena (sources: ${sources.join(', ')})`,
  };
}

async function aiDeduplicate(
  listings: Array<{
    id: string; title: string; price: number | null; priceText: string;
    url: string; monitor: { name: string; source: string } | null;
  }>,
  callAi: AiRouteContext['callAi'],
  parseAi: AiRouteContext['parseAi']
): Promise<NextResponse> {
  const prompt = `Si ekspert za deduplikacijo oglasov na slovenskih spletnih oglasih.
Poišči duplicirane oglase med naslednjimi (isti izdelek, drugačen oglas).

Oglasi:
${listings.map((l, i) => `${i + 1}. ${l.title} — ${l.priceText} (${l.monitor?.source ?? '?'})`).join('\n')}

Za vsako grupo dupliciranih oglasov določi:
- similarityScore (0-100)
- reason (kratek razlog)

Odgovori LE z JSON:
{"duplicates": [{"indices": [0, 2, 5], "similarity_score": 90, "reason": "isti iPhone 13 Pro, različni cene"}]}`;

  let raw: string;
  try {
    raw = await callAi(prompt);
  } catch {
    return apiOk({ duplicates: [], message: 'AI ni na voljo za deduplikacijo.' });
  }

  const parsed: any = parseAi(raw);
  const duplicates = (parsed?.duplicates || []).map((d: any) => ({
    listings: (d?.indices || []).map((idx: number) => {
      const l = listings[idx];
      return l ? {
        id: l.id, title: l.title, price: l.price, priceText: l.priceText,
        url: l.url, source: l.monitor?.source, monitorName: l.monitor?.name,
      } : null;
    }).filter(Boolean),
    similarityScore: Math.min(100, Math.max(0, parseInt(d?.similarity_score ?? d?.similarityScore ?? 50, 10) || 50)),
    reason: String(d?.reason ?? '').slice(0, 200),
  })).filter((d: any) => d.listings.length >= 2);

  return apiOk({
    duplicates,
    analyzedCount: listings.length,
    duplicateGroups: duplicates.length,
    totalDuplicates: duplicates.reduce((s: number, d: any) => s + d.listings.length, 0),
  });
}
