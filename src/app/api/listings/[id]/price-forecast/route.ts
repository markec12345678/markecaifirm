// v5.5: AI Price Forecast — vizualizacija cene z AI napovedmi za naslednje mesece
// POST /api/listings/:id/price-forecast
// Body: { months?: number (default 3) }
// Returns: { ok, forecast: { history, projected, trend, seasonality, aiAnalysis, confidence } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface PricePoint {
  date: string;
  price: number;
  type: 'history' | 'projected';
  confidence?: number;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const monthsRaw = typeof body?.months === 'number' ? body.months : Number(body?.months);
  const months = Number.isFinite(monthsRaw) ? Math.min(6, Math.max(1, monthsRaw)) : 3;

  const listing = await db.listing.findUnique({
    where: { id },
    include: {
      monitor: { select: { name: true, source: true } },
      priceHistory: {
        orderBy: { seenAt: 'asc' },
        select: { id: true, price: true, priceText: true, seenAt: true },
      },
    },
  });
  if (!listing) {
    return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
  }
  if (listing.price == null) {
    return NextResponse.json({ error: 'Oglas nima znane cene' }, { status: 400 });
  }

  // Build history points
  const history: PricePoint[] = [];
  if (listing.priceHistory.length > 0) {
    for (const ph of listing.priceHistory) {
      if (ph.price != null) {
        history.push({
          date: ph.seenAt.toISOString().slice(0, 10),
          price: ph.price,
          type: 'history',
        });
      }
    }
  }
  // Always add current price as latest history point
  history.push({
    date: new Date().toISOString().slice(0, 10),
    price: listing.price,
    type: 'history',
  });

  // Get market data for context
  let marketData: any = null;
  const min = Math.floor(listing.price * 0.7);
  const max = Math.ceil(listing.price * 1.3);
  const similar = await db.listing.findMany({
    where: {
      monitorId: listing.monitorId,
      id: { not: listing.id },
      price: { gte: min, lte: max },
      isHidden: false,
    },
    select: { price: true, firstSeenAt: true, aiVerdict: true },
    take: 30,
  });
  if (similar.length > 0) {
    const prices = similar.map(s => s.price!).filter(Boolean);
    marketData = {
      count: similar.length,
      average: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      min: Math.min(...prices),
      max: Math.max(...prices),
      median: prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)],
    };
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

  const prompt = buildForecastPrompt(listing, history, marketData, months);

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

  // Build projected points
  const projected: PricePoint[] = [];
  const now = new Date();
  const projectedData = parsed?.projected_prices || parsed?.projekcija || [];
  if (Array.isArray(projectedData) && projectedData.length > 0) {
    projectedData.forEach((p: any, i: number) => {
      const date = p?.date ? String(p.date) : new Date(now.getFullYear(), now.getMonth() + i + 1, 1).toISOString().slice(0, 10);
      const price = typeof p?.price === 'number' ? p.price : parseInt(String(p?.price ?? 0), 10);
      projected.push({
        date,
        price,
        type: 'projected',
        confidence: clampInt(p?.confidence, 0, 100) ?? Math.max(20, 80 - i * 15),
      });
    });
  } else {
    // Fallback: linear projection based on trend
    const trend = String(parsed?.trend ?? parsed?.trend ?? 'stable');
    const avgDrop = history.length >= 2
      ? (history[0].price - history[history.length - 1].price) / Math.max(1, history.length - 1)
      : 0;
    for (let m = 1; m <= months; m++) {
      const date = new Date(now.getFullYear(), now.getMonth() + m, 1);
      let price = listing.price;
      if (trend === 'declining') price = listing.price - (avgDrop * m * 4);
      else if (trend === 'rising') price = listing.price + (Math.abs(avgDrop) * m * 4);
      projected.push({
        date: date.toISOString().slice(0, 10),
        price: Math.max(0, Math.round(price)),
        type: 'projected',
        confidence: Math.max(20, 80 - m * 15),
      });
    }
  }

  // Combine for chart
  const allPoints = [...history, ...projected];

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
    forecast: {
      history,
      projected,
      allPoints,
      trend: String(parsed?.trend ?? 'stable'),
      seasonality: String(parsed?.seasonality ?? parsed?.sezonskost ?? '').slice(0, 500),
      aiAnalysis: String(parsed?.analysis ?? parsed?.analiza ?? '').slice(0, 1500),
      confidence: clampInt(parsed?.overall_confidence ?? parsed?.confidence, 0, 100) ?? 50,
      expectedPrice3m: projected.length >= 3 ? projected[2].price : null,
      expectedPrice6m: projected.length >= 6 ? projected[5].price : null,
    },
    currentPrice: listing.price,
    marketData,
  });
}

function buildForecastPrompt(listing: any, history: PricePoint[], marketData: any, months: number): string {
  const parts: string[] = [
    'Si ekspert za napovedovanje cen na slovenskih spletnih oglasih.',
    `Na podlagi zgodovine cen in tržnih podatkov napovej ceno za naslednje ${months} mesecev.`,
    '',
    `Naslov: ${listing.title}`,
    `Trenutna cena: ${listing.price} EUR`,
    `Lokacija: ${listing.location || 'ni podatka'}`,
    `Vir: ${listing.monitor?.source ?? 'neznan'}`,
    `Starost oglasa: ${listing.firstSeenAt ? Math.round((Date.now() - listing.firstSeenAt.getTime()) / (24 * 60 * 60 * 1000)) : '?'} dni`,
  ];

  if (listing.aiEstimatedValue) {
    parts.push(`AI ocenjena tržna vrednost: ${listing.aiEstimatedValue} EUR`);
  }
  if (listing.dealScore != null) {
    parts.push(`Deal Score: ${listing.dealScore}/100`);
  }

  parts.push('', `Zgodovina cen (${history.length} točk):`);
  history.forEach((h, i) => {
    parts.push(`  ${h.date}: ${h.price}€`);
  });

  if (marketData) {
    parts.push('', `Tržni podatki (${marketData.count} podobnih):`);
    parts.push(`  Povprečje: ${marketData.average}€, Mediana: ${marketData.median}€`);
    parts.push(`  Min-Max: ${marketData.min}-${marketData.max}€`);
  }

  parts.push('', 'Analiziraj:');
  parts.push(`1. Trend (declining/stable/rising) na podlagi zgodovine`);
  parts.push(`2. Sezonskost (ali so cene višje/ja pozimi, poleti, itd.)`);
  parts.push(`3. Generiraj projected_prices za ${months} mesecev (mesečni intervali)`);
  parts.push(`4. Za vsako projekcijo daj confidence (0-100)`);
  parts.push(`5. Upoštevaj: stari oglasi padejo, novi ostanejo visoko`);
  parts.push(`6. Upoštevaj sezonskost če je vidna`);
  parts.push('', 'Odgovori LE z JSON:');
  parts.push('{');
  parts.push('  "trend": "<declining|stable|rising>",');
  parts.push('  "seasonality": "<kratek opis sezonskosti ali null>",');
  parts.push('  "analysis": "<1-3 stavki analize v slovenščini>",');
  parts.push('  "overall_confidence": <0-100>,');
  parts.push('  "projected_prices": [');
  parts.push(`    {"date": "YYYY-MM", "price": <number>, "confidence": <0-100>},`);
  parts.push(`    ... (${months} mesecev)`);
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
