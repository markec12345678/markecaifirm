// v6.5: Multi-Platform Listing Sync — sinhronizacija cen in statusov cross-platform
// POST /api/trades/sync-listing
// Body: { tradeId, platforms?: ['bolha', 'vinted', 'facebook'] }
// Generates optimized listings for multiple platforms with synced pricing
// Returns: { ok, listings: Array<{ platform, title, description, price, url, tips }> }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tradeId } = body;
    const platforms: string[] = body?.platforms || ['bolha', 'vinted'];

    if (!tradeId) return NextResponse.json({ error: 'tradeId je obvezen' }, { status: 400 });

    const trade = await db.trade.findUnique({
      where: { id: tradeId },
      select: {
        id: true, title: true, buyPrice: true, category: true, notes: true,
        imageUrl: true, url: true,
        listing: { select: { description: true, detailDescription: true, aiEstimatedValue: true } },
      },
    });
    if (!trade) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });

    // Get market data
    const minP = Math.floor(trade.buyPrice * 0.8);
    const maxP = Math.ceil(trade.buyPrice * 1.5);
    const similar = await db.listing.findMany({
      where: { price: { gte: minP, lte: maxP }, isHidden: false, title: { contains: trade.title.split(' ')[0] } },
      select: { price: true },
      take: 10,
    });
    const marketPrices = similar.map(l => l.price!).filter(Boolean);
    const marketAvg = marketPrices.length > 0 ? Math.round(marketPrices.reduce((a, b) => a + b, 0) / marketPrices.length) : Math.round(trade.buyPrice * 1.25);

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za pisanje oglasov na slovenskih platformah.
Generiraj optimized oglase za naslednje platforme: ${platforms.join(', ')}.

Izdelek: ${trade.title}
Kupna cena: ${trade.buyPrice}€
Kategorija: ${trade.category || 'drugo'}
${trade.notes ? `Opombe: ${trade.notes}` : ''}
${trade.listing?.detailDescription || trade.listing?.description ? `Original opis: ${(trade.listing?.detailDescription || trade.listing?.description || '').slice(0, 500)}` : ''}
Tržno povprečje: ${marketAvg}€

Pravila:
- Bolha: naslov max 80 znakov, opis podroben, cena tržno povprečje - 5%
- Vinted: naslov kratek in jedrnat, opis fokus na stanje/brend, cena tržno povprečje - 3%
- Facebook: naslov z emoji, opis sproščen in prijazen, cena malo višja (prostor za pogajanje)

Za vsako platformo generiraj: title, description, price, tips (3 nasveti za to platformo).

Odgovori LE z JSON:
{
  "listings": [
    {
      "platform": "bolha",
      "title": "<naslov>",
      "description": "<opis>",
      "price": <number>,
      "tips": ["<nasvet1>", "<nasvet2>", "<nasvet3>"]
    },
    ...
  ]
}`;

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
    const listings = (parsed?.listings || []).map((l: any) => ({
      platform: String(l?.platform ?? ''),
      title: String(l?.title ?? '').slice(0, 200),
      description: String(l?.description ?? '').slice(0, 2000),
      price: parseInt(l?.price, 10) || Math.round(marketAvg * 0.95),
      tips: Array.isArray(l?.tips) ? l.tips.slice(0, 5).map((t: any) => String(t).slice(0, 200)) : [],
      marginPct: trade.buyPrice > 0 ? Math.round(((parseInt(l?.price, 10) || marketAvg) - trade.buyPrice) / trade.buyPrice * 100) : 0,
    }));

    // Increment AI usage
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      listings,
      tradeId,
      buyPrice: trade.buyPrice,
      marketAvg,
    });
  } catch (e: any) {
    logger.error("/api/trades/sync-listing", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
