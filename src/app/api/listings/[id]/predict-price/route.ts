// v5.1: Price prediction — AI napove kdaj bo cena padla na ciljno mejo
// POST /api/listings/:id/predict-price
// Body: { targetPrice: number }
// Returns: { ok, prediction: { willReachTarget, estimatedDays, predictedDate, confidence, reasoning, projectedPrices: [{ date, price }], trendAnalysis } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface PredictRequest {
  targetPrice: number;
}

interface PricePoint {
  date: string; // ISO date
  price: number;
}

interface Prediction {
  willReachTarget: boolean;
  estimatedDays: number | null;
  predictedDate: string | null;
  confidence: number;
  reasoning: string;
  projectedPrices: PricePoint[];
  trendAnalysis: string;
  averageDropPerWeek: number;
  currentTrend: string; // 'declining' | 'stable' | 'rising'
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body: PredictRequest = await req.json();
  const targetPrice = typeof body.targetPrice === 'number' ? body.targetPrice : parseInt(String(body.targetPrice), 10);

  if (Number.isNaN(targetPrice) || targetPrice <= 0) {
    return NextResponse.json({ error: 'Ciljna cena mora biti pozitivno število' }, { status: 400 });
  }

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

  // Compute statistics from price history
  const history = listing.priceHistory ?? [];
  let trend: 'declining' | 'stable' | 'rising' = 'stable';
  let avgDropPerWeek = 0;

  if (history.length >= 2) {
    const first = history[0];
    const last = history[history.length - 1];
    const daysDiff = Math.max(1, (last.seenAt.getTime() - first.seenAt.getTime()) / (24 * 60 * 60 * 1000));
    const priceDiff = (last.price ?? listing.price!) - (first.price ?? listing.price!);
    const weeklyRate = (priceDiff / daysDiff) * 7;

    avgDropPerWeek = Math.abs(weeklyRate);

    if (weeklyRate < -1) trend = 'declining';
    else if (weeklyRate > 1) trend = 'rising';
    else trend = 'stable';
  }

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

  const prompt = buildPredictionPrompt(listing, targetPrice, history, marketData, trend, avgDropPerWeek);

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

  // Build projected prices array (next 30 days, weekly)
  const projectedPrices: PricePoint[] = [];
  const currentPrice = listing.price;
  if (parsed?.projected_prices && Array.isArray(parsed.projected_prices)) {
    for (const p of parsed.projected_prices) {
      if (p?.date && p?.price != null) {
        projectedPrices.push({ date: String(p.date), price: Number(p.price) });
      }
    }
  } else {
    // Fallback: generate based on trend
    const now = new Date();
    for (let week = 1; week <= 4; week++) {
      const date = new Date(now.getTime() + week * 7 * 24 * 60 * 60 * 1000);
      let price = currentPrice;
      if (trend === 'declining') price = currentPrice - (avgDropPerWeek * week);
      else if (trend === 'rising') price = currentPrice + (avgDropPerWeek * week);
      projectedPrices.push({
        date: date.toISOString().slice(0, 10),
        price: Math.max(0, Math.round(price)),
      });
    }
  }

  const prediction: Prediction = {
    willReachTarget: Boolean(parsed?.will_reach_target ?? parsed?.willReachTarget ?? (targetPrice >= currentPrice)),
    estimatedDays: parsed?.estimated_days != null ? clampInt(parsed.estimated_days, 0, 365) : null,
    predictedDate: parsed?.predicted_date ? String(parsed.predicted_date) : null,
    confidence: clampInt(parsed?.confidence, 0, 100) ?? 50,
    reasoning: String(parsed?.reasoning ?? parsed?.razlog ?? '').slice(0, 1500),
    projectedPrices,
    trendAnalysis: String(parsed?.trend_analysis ?? parsed?.analiza_trenda ?? '').slice(0, 500),
    averageDropPerWeek: Math.round(avgDropPerWeek * 100) / 100,
    currentTrend: trend,
  };

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
    prediction,
    currentPrice: listing.price,
    targetPrice,
    historyCount: history.length,
    marketData,
  });
}

function buildPredictionPrompt(listing: any, targetPrice: number, history: any[], marketData: any, trend: string, avgDropPerWeek: number): string {
  const parts: string[] = [
    'Si ekspert za analizo cen na slovenskih spletnih oglasih.',
    'Na podlagi zgodovine cen in tržnih podatkov napovej kdaj bo cena tega oglasa padla na ciljno mejo.',
    '',
    `Naslov: ${listing.title}`,
    `Trenutna cena: ${listing.priceText} (${listing.price} EUR)`,
    `Ciljna cena: ${targetPrice} EUR`,
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

  if (history.length > 0) {
    parts.push('');
    parts.push(`Zgodovina cen (${history.length} zapisov):`);
    const recent = history.slice(-10);
    for (const h of recent) {
      parts.push(`  ${h.seenAt ? new Date(h.seenAt).toLocaleDateString('sl-SI') : '?'}: ${h.priceText} (${h.price ?? '?'} EUR)`);
    }
    parts.push('');
    parts.push(`Trend: ${trend}`);
    parts.push(`Povprečna sprememba na teden: ${avgDropPerWeek.toFixed(2)} EUR`);
  }

  if (marketData) {
    parts.push('');
    parts.push(`Tržni podatki (${marketData.count} podobnih oglasov):`);
    parts.push(`  Povprečje: ${marketData.average} EUR`);
    parts.push(`  Mediana: ${marketData.median} EUR`);
    parts.push(`  Min-Max: ${marketData.min}-${marketData.max} EUR`);
  }

  parts.push('', 'Analiziraj:');
  parts.push('1. Ali bo cena verjetno padla na ciljno mejo?');
  parts.push('2. Če da, v koliko dneh?');
  parts.push('3. Kakšen je trend (declining/stable/rising)?');
  parts.push('4. Generiraj projected_prices za naslednje 4 tedne (tedenski intervali)');
  parts.push('5. Upoštevaj: stari oglasi pogosto padejo, prodajalci pustijo ceno visoko in počakajo');
  parts.push('6. Sumljivo: če cena ne pade že dolgo, morda prodajalec ne bo pustil');
  parts.push('', 'Odgovori LE z JSON v tej obliki:');
  parts.push('{');
  parts.push('  "will_reach_target": <true|false>,');
  parts.push('  "estimated_days": <number|null>,');
  parts.push('  "predicted_date": "YYYY-MM-DD|null",');
  parts.push('  "confidence": <0-100>,');
  parts.push('  "reasoning": "<kratek razlog v slovenščini, max 400 znakov>",');
  parts.push('  "trend_analysis": "<1-2 stavka o trendu>",');
  parts.push('  "projected_prices": [');
  parts.push('    {"date": "YYYY-MM-DD", "price": <number>},');
  parts.push('    ...4 weeks...');
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
