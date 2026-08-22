// v5.6 / v8.94-refactor: AI Anomaly Detection — AI sam zazna sumljive oglase
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/detect-anomalies
// Body: { listingId: string } — single listing
// Body: { monitorId: string, limit?: number } — bulk scan
// Body: { days?: number } — scan last N days (default 7)
// Returns: { ok, anomalies: Array<{ listingId, title, anomalyScore, flags, reasoning }> }

import { NextResponse } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 120;

interface DetectAnomaliesInput {
  listingId?: string;
  monitorId?: string;
  days: number;
  limit: number;
}

export const POST = withAiRoute<DetectAnomaliesInput>({
  endpoint: '/api/ai/detect-anomalies',
  maxDuration: 120,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const daysRaw = typeof body?.days === 'number' ? body.days : Number(body?.days);
    return {
      listingId: body?.listingId ? String(body.listingId) : undefined,
      monitorId: body?.monitorId ? String(body.monitorId) : undefined,
      days: Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, daysRaw)) : 7,
      limit: Math.min(50, Math.max(1, Number(body?.limit ?? 20))),
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    // 1. Pridobi listings za analizo
    const listings = await resolveListingsForAnomaly(input, db);
    if (listings.length === 0) {
      return apiOk({ anomalies: [], message: 'Ni oglasov za analizo.' });
    }

    // 2. AI klic
    const prompt = buildAnomalyPrompt(listings);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    // 3. Transformacija rezultatov
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

    // 4. Sort by anomaly score (highest first)
    results.sort((a, b) => b.anomalyScore - a.anomalyScore);

    return apiOk({
      anomalies: results,
      analyzedAt: new Date().toISOString(),
      analyzedCount: listings.length,
      suspiciousCount: results.filter(r => r.anomalyScore >= 50).length,
    });
  },
});

// --- Pomožne funkcije -----------------------------------------------------

async function resolveListingsForAnomaly(
  input: DetectAnomaliesInput,
  db: AiRouteContext['db']
): Promise<any[]> {
  if (input.listingId) {
    const l = await db.listing.findUnique({
      where: { id: input.listingId },
      select: {
        id: true, title: true, price: true, priceText: true, url: true,
        location: true, description: true, detailDescription: true,
        imageUrl: true, firstSeenAt: true, aiVerdict: true, aiScore: true,
        aiRisk: true, aiEstimatedValue: true, dealScore: true,
        sellerName: true, sellerListingCount: true,
        monitor: { select: { name: true, source: true } },
      },
    });
    if (!l) {
      throw new ApiRouteError('Listing ne obstaja', 404);
    }
    return [l];
  }

  const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
  const where: any = { firstSeenAt: { gte: since }, isHidden: false };
  if (input.monitorId) where.monitorId = input.monitorId;
  return await db.listing.findMany({
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
    take: input.limit,
  });
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
    parts.push(`Slika: ${l.imageUrl ? 'da' : 'ne'}`);
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

function clampInt(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
}
