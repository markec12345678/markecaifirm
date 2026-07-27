// v6.9: AI Exit Strategy — AI predlaga kdaj in kako prodati (postopna prodaja, bulk, čakanje)
// POST /api/ai/exit-strategy
// Body: { tradeId: string }
// Returns: { ok, strategy: { recommendation, timing, pricing, alternatives, reasoning } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tradeId } = body;
    if (!tradeId) return NextResponse.json({ error: 'tradeId je obvezen' }, { status: 400 });

    const trade = await db.trade.findUnique({
      where: { id: tradeId },
      include: { listing: { select: { aiEstimatedValue: true, dealScore: true, aiVerdict: true, title: true, url: true, priceDroppedAt: true } } },
    });
    if (!trade) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });

    const now = new Date();
    const daysHeld = Math.round((now.getTime() - trade.buyDate.getTime()) / (24 * 60 * 60 * 1000));
    const buyCost = trade.buyPrice + (trade.buyFees ?? 0);

    // Get market data
    const minP = Math.floor(trade.buyPrice * 0.7);
    const maxP = Math.ceil(trade.buyPrice * 1.4);
    const similar = await db.listing.findMany({
      where: { price: { gte: minP, lte: maxP }, isHidden: false, id: { not: trade.listingId ?? '' } },
      select: { price: true, firstSeenAt: true, title: true },
      take: 15,
    });
    const marketPrices = similar.map(l => l.price!).filter(Boolean);
    const marketAvg = marketPrices.length > 0 ? Math.round(marketPrices.reduce((a, b) => a + b, 0) / marketPrices.length) : Math.round(buyCost * 1.2);
    const marketMin = marketPrices.length > 0 ? Math.min(...marketPrices) : Math.round(buyCost * 0.9);
    const marketCount = marketPrices.length;

    // Get category historical sell speed
    const catSold = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, category: trade.category || '' },
      select: { buyDate: true, sellDate: true, buyPrice: true, sellPrice: true },
      take: 20,
    });
    const avgDaysToSell = catSold.length > 0
      ? Math.round(catSold.filter(t => t.sellDate && t.buyDate).reduce((s, t) => s + (t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000), 0) / Math.max(1, catSold.filter(t => t.sellDate).length))
      : 14;
    const avgCatROI = catSold.length > 0
      ? Math.round(catSold.reduce((s, t) => s + (((t.sellPrice ?? 0) - t.buyPrice) / t.buyPrice) * 100, 0) / catSold.length)
      : 20;

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za izhodne strategije pri preprodaji na slovenskih oglasih.
Predlagaj optimalno izhodno strategijo za naslednji trade.

Item: ${trade.title}
Kategorija: ${trade.category || 'drugo'}
Kupna cena: ${buyCost}€
Dni v skladišču: ${daysHeld}
AI tržna vrednost: ${trade.listing?.aiEstimatedValue ?? '?'}€
Deal score: ${trade.listing?.dealScore ?? '?'}

Tržni podatki:
- Povprečna tržna cena: ${marketAvg}€ (min: ${marketMin}€)
- Št. konkurenčnih oglasov: ${marketCount}
- Povp. dni do prodaje (kategorija): ${avgDaysToSell}d
- Povp. ROI (kategorija): ${avgCatROI}%

Predlagaj:
1. recommendation: sell_now / sell_soon / hold / bundle
2. timing: kdaj prodati (takoj / 1 teden / 2 tedna / počakaj na sezono)
3. pricing: optimalna prodajna cena in strategija (fiksna / pogajanje / dražba)
4. alternatives: alternative prodajne poti (Bolha, Vinted, Facebook, znanec)
5. reasoning: kratek razlog

Odgovori LE z JSON:
{
  "recommendation": "<sell_now|sell_soon|hold|bundle>",
  "timing": "<takoj|1_teden|2_tedna|počakaj_sezono>",
  "suggested_price": <number>,
  "pricing_strategy": "<fiksna|pogajanje|dražba>",
  "alternatives": ["<alt1>", "<alt2>"],
  "reasoning": "<max 200 znakov>",
  "confidence": <0-100>
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

    // Increment AI usage
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      strategy: {
        recommendation: String(parsed?.recommendation ?? 'hold'),
        timing: String(parsed?.timing ?? ''),
        suggestedPrice: parseInt(parsed?.suggested_price, 10) || Math.round(marketAvg * 0.95),
        pricingStrategy: String(parsed?.pricing_strategy ?? 'fiksna'),
        alternatives: Array.isArray(parsed?.alternatives) ? parsed.alternatives.slice(0, 5).map((a: any) => String(a).slice(0, 100)) : [],
        reasoning: String(parsed?.reasoning ?? '').slice(0, 300),
        confidence: Math.min(100, Math.max(0, parseInt(parsed?.confidence, 10) || 50)),
      },
      trade: {
        title: trade.title, buyCost, daysHeld,
        aiValue: trade.listing?.aiEstimatedValue ?? null,
        marketAvg, marketMin, marketCount, avgDaysToSell, avgCatROI,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
