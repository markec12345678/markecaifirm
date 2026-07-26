// v6.2: AI Flip Score — ocenjuje ali se splača kupiti za preprodajo
// Upošteva: tržna vrednost, hitrost prodaje, likvidnost, marža po stroških
// POST /api/listings/:id/flip-score
// Returns: { ok, flipScore, estimatedMargin, estimatedSellPrice, estimatedDaysToSell, liquidity, reasoning }

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
      id: true, title: true, price: true, priceText: true, url: true,
      description: true, detailDescription: true,
      aiVerdict: true, aiScore: true, aiRisk: true, aiEstimatedValue: true,
      dealScore: true, monitorId: true, monitor: { select: { source: true, name: true } },
    },
  });
  if (!listing) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
  if (!listing.price) return NextResponse.json({ error: 'Brez cene' }, { status: 400 });

  // Gather market data: similar listings + sold trades for liquidity
  const minP = Math.floor(listing.price * 0.6);
  const maxP = Math.ceil(listing.price * 1.5);
  const [similarListings, soldTrades] = await Promise.all([
    db.listing.findMany({
      where: { id: { not: id }, price: { gte: minP, lte: maxP }, isHidden: false, monitorId: listing.monitorId },
      select: { price: true, firstSeenAt: true, aiVerdict: true, dealScore: true },
      take: 30,
    }),
    db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, buyPrice: { gte: minP, lte: maxP } },
      select: { buyPrice: true, sellPrice: true, buyDate: true, sellDate: true, title: true },
      take: 20,
    }),
  ]);

  // Calculate liquidity stats
  const prices = similarListings.map(l => l.price!).filter(Boolean);
  const avgMarketPrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : listing.price;
  const minMarket = prices.length > 0 ? Math.min(...prices) : listing.price;
  const maxMarket = prices.length > 0 ? Math.max(...prices) : listing.price;

  // Sold trades stats (for speed estimation)
  const soldWithDates = soldTrades.filter(t => t.sellDate && t.buyDate);
  const avgDaysToSell = soldWithDates.length > 0
    ? Math.round(soldWithDates.reduce((s, t) => s + (t.sellDate!.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000), 0) / soldWithDates.length)
    : null;
  const avgSellMargin = soldWithDates.length > 0
    ? Math.round(soldWithDates.reduce((s, t) => s + ((t.sellPrice! - t.buyPrice) / t.buyPrice) * 100, 0) / soldWithDates.length)
    : null;

  // Bolha fee: 5% + 0.50€ (for items > 50€)
  const bolhaFee = listing.price > 50 ? listing.price * 0.05 + 0.5 : listing.price * 0.05;
  // Estimated shipping: 5€ (packet.si)
  const shipping = 5;
  // Total costs
  const totalCosts = listing.price + bolhaFee + shipping;
  // Estimated sell price (market average - 5% for faster sale)
  const estimatedSellPrice = Math.round(avgMarketPrice * 0.95);
  // Estimated profit
  const estimatedProfit = estimatedSellPrice - totalCosts - (estimatedSellPrice * 0.05 + 0.5) - 5; // sell fees too
  const estimatedMarginPct = Math.round((estimatedProfit / listing.price) * 100);

  // Liquidity score (0-100): how fast can you sell?
  const listingCount = similarListings.length;
  const liquidityScore = Math.min(100, Math.round(
    (listingCount > 20 ? 40 : listingCount * 2) + // more listings = more demand
    (avgDaysToSell != null ? Math.max(0, 40 - avgDaysToSell) : 20) + // faster = better
    (soldWithDates.length > 5 ? 20 : soldWithDates.length * 4) // sold history
  ));

  // Build AI prompt for flip analysis
  const settings = await getSettingsRow();
  const aiSettings: AiSettings = {
    provider: settings.aiProvider as AiProviderType,
    baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
    fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
    fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
    fallbackModel: settings.fallbackModel || '',
  };

  const prompt = `Si ekspert za preprodajo (flipping) na slovenskih spletnih oglasih.
Oceni ali se splača kupiti ta oglas za preprodajo.

Oglas: ${listing.title}
Cena: ${listing.price}€
AI tržna vrednost: ${listing.aiEstimatedValue ?? '?'}€
Deal Score: ${listing.dealScore ?? '?'}/100
Vir: ${listing.monitor?.source}

Tržni podatki:
- Povprečna tržna cena: ${avgMarketPrice}€ (min ${minMarket}€, max ${maxMarket}€)
- Št. podobnih oglasov: ${listingCount}
- Povprečni dni do prodaje: ${avgDaysToSell ?? '?'}
- Povprečna marža iz preteklih prodaj: ${avgSellMargin ?? '?'}%

Stroški:
- Kupna cena: ${listing.price}€
- Bolha provizija (nakup): ${bolhaFee.toFixed(2)}€
- Dostava: ${shipping}€
- Skupni stroški: ${totalCosts.toFixed(2)}€
- Predvidena prodajna cena: ${estimatedSellPrice}€
- Predvideni dobiček: ${estimatedProfit.toFixed(2)}€ (${estimatedMarginPct}% marže)

Oceni:
1. flip_score (0-100): 90+ = odlična priložnost, 70-89 = dobra, 50-69 = povprečna, <50 = ne
2. estimated_days_to_sell: koliko dni do prodaje
3. reasoning: kratek razlog (max 200 znakov)
4. recommendation: kupi / razmisli / ne

Odgovori LE z JSON:
{"flip_score": <0-100>, "estimated_days_to_sell": <number>, "reasoning": "<razlog>", "recommendation": "<kupi|razmisli|ne>"}`;

  let raw = '';
  try {
    raw = await callProviderForRaw(aiSettings, prompt);
  } catch (primaryError: any) {
    if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
      const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
      raw = await callProviderForRaw(fb, prompt);
    } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
  }

  const parsed: any = parseJsonLooseExported(raw);
  const flipScore = clampInt(parsed?.flip_score, 0, 100) ?? 50;

  // Increment AI usage
  const today = new Date().toISOString().slice(0, 10);
  if (settings.aiCallsDate !== today) {
    await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
  } else {
    await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
  }

  return NextResponse.json({
    ok: true,
    flipScore,
    estimatedMargin: estimatedMarginPct,
    estimatedProfit: Math.round(estimatedProfit),
    estimatedSellPrice,
    estimatedDaysToSell: clampInt(parsed?.estimated_days_to_sell, 1, 365) ?? avgDaysToSell ?? 14,
    liquidityScore,
    liquidityLabel: liquidityScore >= 70 ? 'Visoka' : liquidityScore >= 40 ? 'Srednja' : 'Nizka',
    marketAvgPrice: avgMarketPrice,
    marketMin: minMarket,
    marketMax: maxMarket,
    marketListingCount: listingCount,
    bolhaFee: Math.round(bolhaFee * 100) / 100,
    shipping,
    totalCosts: Math.round(totalCosts * 100) / 100,
    reasoning: String(parsed?.reasoning ?? '').slice(0, 300),
    recommendation: String(parsed?.recommendation ?? '').slice(0, 50),
  });
}

function clampInt(v: any, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
}
