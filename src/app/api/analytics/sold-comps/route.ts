// v7.37: Sold Comps — "za koliko so se podobni item-i PRODALI?"
//
// THE #1 feature Keepa charges $19/mo for. Without sold comps, you're
// guessing if a "deal" is real. With comps: "this iPhone 13 sold 5x on
// Bolha for avg 320€ — current listing at 250€ = real 70€ margin".
//
// Uses YOUR sold trade history + active listings as proxy for market price.
// AI estimates realistic selling price based on comparable sales.
//
// POST /api/analytics/sold-comps
// Body: { title: string, category?: string, askingPrice?: number }
// Returns: { ok, comps: [{ title, soldPrice, source, daysAgo, condition }],
//   marketStats: { avgPrice, minPrice, maxPrice, medianPrice, sampleSize },
//   recommendation: string, fairMarketValue: number, marginEur: number }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const title = String(body?.title || '').trim();
    const category = String(body?.category || '').trim();
    const askingPrice = body?.askingPrice ? Number(body.askingPrice) : null;

    if (!title) {
      return NextResponse.json({ error: 'title je obvezen' }, { status: 400 });
    }

    // 1. Find YOUR sold trades with similar title (keyword matching)
    const titleWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5);
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        sellDate: { not: null },
        OR: titleWords.map(w => ({ title: { contains: w, mode: 'insensitive' } })),
      },
      select: { title: true, category: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true, sellLocation: true },
      take: 30,
      orderBy: { sellDate: 'desc' },
    });

    // 2. Find active listings with similar title (market asking prices)
    const activeListings = await db.listing.findMany({
      where: {
        isHidden: false,
        price: { not: null, gt: 0 },
        OR: titleWords.map(w => ({ title: { contains: w, mode: 'insensitive' } })),
      },
      select: { title: true, price: true, priceText: true, location: true, firstSeenAt: true, monitor: { select: { source: true } } },
      take: 30,
      orderBy: { firstSeenAt: 'desc' },
    });

    // 3. AI-powered comps analysis
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const soldData = soldTrades.map(t => ({
      title: t.title,
      soldPrice: t.sellPrice,
      category: t.category,
      daysAgo: Math.floor((Date.now() - new Date(t.sellDate!).getTime()) / 86400000),
      buyPrice: t.buyPrice,
      profit: (t.sellPrice ?? 0) - t.buyPrice,
      platform: t.sellLocation || 'Bolha',
    }));

    const activeData = activeListings.map(l => ({
      title: l.title,
      askingPrice: l.price,
      source: l.monitor?.source || 'bolha',
      location: l.location,
      daysListed: Math.floor((Date.now() - new Date(l.firstSeenAt).getTime()) / 86400000),
    }));

    const prompt = `Si ekspert za vrednotenje rabljenih dobrin na slovenskem trgu.

Analiziraj to prodajno priložnost in določi realno tržno vrednost:

ISKANI ITEM:
- Naslov: ${title}
- Kategorija: ${category || 'neznan'}
- Trajena cena: ${askingPrice ?? 'neznan'}€

PODATKI O PRODANIH (tvoja zgodovina):
${soldData.length > 0 ? soldData.map(d => `- ${d.title} | PRODANO ${d.soldPrice}€ | ${d.daysAgo}d nazaj | ${d.platform} | profit: ${d.profit}€`).join('\n') : 'Ni prodanih podobnih itemov v zgodovini.'}

AKTIVNI OGLASI (konkurenca):
${activeData.length > 0 ? activeData.slice(0, 15).map(d => `- ${d.title} | ${d.askingPrice}€ | ${d.source} | ${d.daysListed}d na trgu`).join('\n') : 'Ni podobnih aktivnih oglasov.'}

NALOGA:
1. Oceni FAIR MARKET VALUE za iskani item (koliko se realno proda)
2. Primerjaj s trajeno ceno — ali je to res deal?
3. Daj margo znesek (expected profit = fairValue - askingPrice)
4. Opozori če so podatki nepopolni (malo sample-a)

Odgovori LE z JSON:
{
  "fair_market_value_eur": <number>,
  "confidence": <number 0-100>,
  "margin_eur": <number>,
  "margin_pct": <number>,
  "is_real_deal": <boolean>,
  "market_stats": {
    "avg_sold_price_eur": <number>,
    "min_sold_price_eur": <number>,
    "max_sold_price_eur": <number>,
    "sample_size": <number>,
    "avg_days_to_sell": <number>
  },
  "comps": [
    { "title": "<string>", "sold_price_eur": <number>, "days_ago": <number>, "similarity": <number 0-100>, "platform": "<string>" }
  ],
  "recommendation": "<1-2 stavka: ali kupiti in zakaj>",
  "risk_factors": ["<string>", "..."]
}`;

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
        // Fallback: compute without AI
        const prices = soldData.map(d => d.soldPrice!);
        const avg = prices.length > 0 ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length) : (askingPrice ?? 0);
        return NextResponse.json({
          ok: true,
          fairMarketValue: avg,
          confidence: prices.length > 3 ? 70 : prices.length > 0 ? 40 : 10,
          marginEur: askingPrice ? avg - askingPrice : 0,
          isRealDeal: askingPrice ? avg > askingPrice * 1.1 : false,
          comps: soldData.slice(0, 5),
          recommendation: askingPrice && avg > askingPrice * 1.1
            ? `Deal! Tržna vrednost ${avg}€, tiha cena ${askingPrice}€ — margin ${avg - askingPrice}€.`
            : askingPrice && avg < askingPrice
            ? `Ne kupi. Tržna vrednost ${avg}€ je NIŽJA od tihe cene ${askingPrice}€.`
            : 'Manj podatkov — preveri ročno.',
          note: 'AI ni na voljo — izračunano iz lokalne zgodovine.',
        });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);

    return NextResponse.json({
      ok: true,
      fairMarketValue: Math.round(Number(parsed?.fair_market_value_eur ?? 0)),
      confidence: Math.max(0, Math.min(100, Number(parsed?.confidence ?? 50))),
      marginEur: Math.round(Number(parsed?.margin_eur ?? 0)),
      marginPct: Math.round(Number(parsed?.margin_pct ?? 0) * 10) / 10,
      isRealDeal: Boolean(parsed?.is_real_deal ?? false),
      marketStats: {
        avgSoldPriceEur: Math.round(Number(parsed?.market_stats?.avg_sold_price_eur ?? 0)),
        minSoldPriceEur: Math.round(Number(parsed?.market_stats?.min_sold_price_eur ?? 0)),
        maxSoldPriceEur: Math.round(Number(parsed?.market_stats?.max_sold_price_eur ?? 0)),
        sampleSize: Number(parsed?.market_stats?.sample_size ?? soldData.length),
        avgDaysToSell: Math.round(Number(parsed?.market_stats?.avg_days_to_sell ?? 0)),
      },
      comps: (parsed?.comps || []).slice(0, 10).map((c: any) => ({
        title: String(c?.title ?? '').slice(0, 200),
        soldPriceEur: Math.round(Number(c?.sold_price_eur ?? 0)),
        daysAgo: Math.max(0, Number(c?.days_ago ?? 0)),
        similarity: Math.max(0, Math.min(100, Number(c?.similarity ?? 50))),
        platform: String(c?.platform ?? 'Bolha').slice(0, 30),
      })),
      activeListings: activeData.slice(0, 10),
      recommendation: String(parsed?.recommendation ?? '').slice(0, 300),
      riskFactors: (parsed?.risk_factors || []).slice(0, 5).map((r: any) => String(r).slice(0, 150)),
    });
  } catch (err: any) {
    logger.error('/api/analytics/sold-comps', 'POST handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
