// v6.1: AI Listing Deduplication — AI zazna duplicirane oglase in jih predlaga za merge
// POST /api/ai/deduplicate
// Body: { monitorId?: string, days?: number, limit?: number }
// Returns: { ok, duplicates: Array<{ listings: Array<{id, title, price, url}>, similarityScore, reason }> }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '').trim().slice(0, 100);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const daysRaw = typeof body?.days === 'number' ? body.days : Number(body?.days);
    const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, daysRaw)) : 14;
    const limit = Math.min(100, Math.max(10, body?.limit ?? 50));
    const monitorId = body?.monitorId;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get recent listings
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
      return NextResponse.json({ ok: true, duplicates: [], message: 'Premalo oglasov za deduplikacijo.' });
    }

    // Pre-filter: group by normalized title (fast check)
    const titleGroups = new Map<string, any[]>();
    for (const l of listings) {
      const norm = normalizeTitle(l.title);
      if (norm.length < 5) continue;
      if (!titleGroups.has(norm)) titleGroups.set(norm, []);
      titleGroups.get(norm)!.push(l);
    }

    // Find groups with 2+ listings from different sources or same source different externalId
    const candidateGroups = Array.from(titleGroups.values()).filter(group => {
      if (group.length < 2) return false;
      // Same source but different externalId = potential duplicate
      // Different sources = cross-portal duplicate
      const sources = new Set(group.map(l => l.monitor?.source));
      const externalIds = new Set(group.map(l => l.externalId));
      return sources.size >= 1 && group.length >= 2;
    });

    if (candidateGroups.length === 0) {
      // Try AI-based similarity for top listings
      return await aiDeduplicate(listings.slice(0, Math.min(30, limit)), days, monitorId);
    }

    // If we have exact title matches, use those (fast path)
    const duplicates = candidateGroups.map(group => {
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
    });

    return NextResponse.json({
      ok: true,
      duplicates,
      analyzedCount: listings.length,
      duplicateGroups: duplicates.length,
      totalDuplicates: duplicates.reduce((s, d) => s + d.listings.length, 0),
    });
  } catch (e: any) {
    logger.error("/api/ai/deduplicate", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}

async function aiDeduplicate(listings: any[], days: number, monitorId?: string) {
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

  const prompt = `Si ekspert za deduplikacijo oglasov na slovenskih spletnih oglasih.
Poišči duplicirane oglase med naslednjimi (isti izdelek, drugačen oglas).

Oglasi:
${listings.map((l, i) => `${i + 1}. ${l.title} — ${l.priceText} (${l.monitor?.source ?? '?'})`).join('\n')}

Za vsako grupo dupliciranih oglasov določi:
- similarityScore (0-100)
- reason (kratek razlog)

Odgovori LE z JSON:
{"duplicates": [{"indices": [0, 2, 5], "similarity_score": 90, "reason": "isti iPhone 13 Pro, različni cene"}]}`;

  let raw = '';
  try {
    raw = await callProviderForRaw(aiSettings, prompt);
  } catch (primaryError: any) {
    if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
      const fb: AiSettings = {
        provider: aiSettings.fallbackProvider,
        baseUrl: aiSettings.fallbackBaseUrl || '',
        apiKey: aiSettings.fallbackApiKey || '',
        model: aiSettings.fallbackModel,
      };
      raw = await callProviderForRaw(fb, prompt);
    } else {
      return NextResponse.json({ ok: true, duplicates: [], message: 'AI ni na voljo za deduplikacijo.' });
    }
  }

  const parsed: any = parseJsonLooseExported(raw);
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

  return NextResponse.json({
    ok: true,
    duplicates,
    analyzedCount: listings.length,
    duplicateGroups: duplicates.length,
    totalDuplicates: duplicates.reduce((s: number, d: any) => s + d.listings.length, 0),
  });
}
