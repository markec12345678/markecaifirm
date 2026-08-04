// v5.6: AI Anomaly Detection — AI sam zazna sumljive oglase (prevarantski vzorci)
// POST /api/ai/detect-anomalies
// Body: { listingId: string } — single listing
// Body: { monitorId: string, limit?: number } — bulk scan
// Body: { days?: number } — scan last N days (default 7)
// Returns: { ok, anomalies: Array<{ listingId, title, anomalyScore, flags, reasoning }> }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const listingId = body?.listingId;
    const monitorId = body?.monitorId;
    const daysRaw = typeof body?.days === 'number' ? body.days : Number(body?.days);
    const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, daysRaw)) : 7;
    const limit = Math.min(50, Math.max(1, body?.limit ?? 20));

    // Gather listings to analyze
    let listings: any[] = [];
    if (listingId) {
      const l = await db.listing.findUnique({
        where: { id: listingId },
        select: {
          id: true, title: true, price: true, priceText: true, url: true,
          location: true, description: true, detailDescription: true,
          imageUrl: true, firstSeenAt: true, aiVerdict: true, aiScore: true,
          aiRisk: true, aiEstimatedValue: true, dealScore: true,
          sellerName: true, sellerListingCount: true,
          monitor: { select: { name: true, source: true } },
        },
      });
      if (!l) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      listings = [l];
    } else {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const where: any = { firstSeenAt: { gte: since }, isHidden: false };
      if (monitorId) where.monitorId = monitorId;
      listings = await db.listing.findMany({
        where,
        select: {
          id: true, title: true, price: true, priceText: true, url: true,
          location: true, description: true, detailDescription: true,
          imageUrl: true, firstSeenAt: true, aiVerdict: true, aiScore: true,
          aiRisk: true, aiEstimatedValue: true, dealScore: true,
          sellerName: true, sellerListingCount: true,
          monitor: { select: { name: true, source: true } },
        },
        orderBy: { firstSeenAt: 'desc' },
        take: limit,
      });
    }

    if (listings.length === 0) {
      return NextResponse.json({ ok: true, anomalies: [], message: 'Ni oglasov za analizo.' });
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

    // Build prompt for batch anomaly detection
    const prompt = buildAnomalyPrompt(listings);

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
    const results = (parsed?.anomalies || []).map((a: any, i: number) => ({
      listingId: listings[i]?.id ?? null,
      title: listings[i]?.title ?? '',
      url: listings[i]?.url ?? '',
      price: listings[i]?.price ?? null,
      anomalyScore: clampInt(a?.anomaly_score ?? a?.anomalyScore, 0, 100) ?? 0,
      flags: Array.isArray(a?.flags) ? a.flags : [],
      reasoning: String(a?.reasoning ?? '').slice(0, 500),
      recommendation: String(a?.recommendation ?? '').slice(0, 200),
    }));

    // Sort by anomaly score descending
    results.sort((a, b) => b.anomalyScore - a.anomalyScore);

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
      anomalies: results,
      analyzedAt: new Date().toISOString(),
      analyzedCount: listings.length,
      suspiciousCount: results.filter(r => r.anomalyScore >= 50).length,
    });
  } catch (e: any) {
    logger.error("/api/ai/detect-anomalies", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka pri AI analizi anomalij' }, { status: 500 });
  }
}

function buildAnomalyPrompt(listings: any[]): string {
  const parts: string[] = [
    'Si ekspert za odkrivanje prevar in sumljivih oglasov na slovenskih spletnih oglasih.',
    'Za vsak oglas analiziraj sumljive vzorce in določi anomaly score (0-100, višje = bolj sumljivo).',
    '',
    'Sumljivi vzorci (flags):',
    '- price_too_low: cena bistveno pod tržno (>30% pod povprečjem)',
    '- new_seller_many: nov prodajalec z mnogo oglasov',
    '- stock_photo: stock fotografija namesto realne',
    '- generic_description: splošen opis brez detailov',
    '- urgent_sale: "nujna prodaja" brez utemeljitve',
    '- no_contact_info: ni kontaktnih podatkov',
    '- duplicate_listing: sumljivo podoben drugemu oglasu',
    '- price_inconsistent: cena v naslovu se ne ujema s ceno v opisu',
    '- too_good_to_be_true: preveč dobra ponudba',
    '- external_url: sumljive zunanje povezave',
    '- payment_upfront: zahteva predplačilo',
    '',
    'Oglasi za analizo:',
  ];

  listings.forEach((l, i) => {
    parts.push(`--- Oglas #${i + 1} ---`);
    parts.push(`Naslov: ${l.title}`);
    parts.push(`Cena: ${l.priceText}${l.price ? ` (${l.price}€)` : ''}`);
    if (l.aiEstimatedValue) parts.push(`AI tržna vrednost: ${l.aiEstimatedValue}€`);
    if (l.location) parts.push(`Lokacija: ${l.location}`);
    if (l.sellerName) parts.push(`Prodajalec: ${l.sellerName} (${l.sellerListingCount ?? '?'} oglasov)`);
    parts.push(`Vir: ${l.monitor?.source ?? '?'}`);
    parts.push(`Opis: ${(l.detailDescription || l.description || '(brez opisa)').slice(0, 400)}`);
    if (l.imageUrl) parts.push(`Slika: da`);
    else parts.push(`Slika: ne`);
    parts.push('');
  });

  parts.push('Odgovori LE z JSON:');
  parts.push('{');
  parts.push('  "anomalies": [');
  parts.push('    {');
  parts.push('      "anomaly_score": <0-100>,');
  parts.push('      "flags": ["<array of flags from list above>"],');
  parts.push('      "reasoning": "<kratek razlog v slovenščini, max 200 znakov>",');
  parts.push('      "recommendation": "<kaj naj uporabnik stori: ignore/proceed_cautiously/avoid>")');
  parts.push('    }');
  parts.push(`    ... (${listings.length} analiz, v istem vrstnem redu)`);
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
