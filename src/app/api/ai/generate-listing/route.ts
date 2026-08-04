// v6.3: AI Auto-Listing Generator — generiraj optimized oglas za preprodajo
// POST /api/ai/generate-listing
// Body: { tradeId: string } — generate from held trade
// Body: { title, buyPrice, category, condition?, description? } — generate from scratch
// Returns: { ok, listing: { title, description, price, tags, category, tips } }

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
    const body = await req.json();
    let title: string, buyPrice: number, category: string, condition: string | null, description: string | null;

    if (body?.tradeId) {
      const trade = await db.trade.findUnique({
        where: { id: body.tradeId },
        select: { id: true, title: true, buyPrice: true, category: true, notes: true,
          listing: { select: { description: true, detailDescription: true, aiEstimatedValue: true } } },
      });
      if (!trade) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
      title = trade.title;
      buyPrice = trade.buyPrice;
      category = trade.category || 'drugo';
      condition = trade.notes?.includes('stanje') ? trade.notes : null;
      description = trade.listing?.detailDescription || trade.listing?.description || null;
    } else {
      title = body?.title || '';
      buyPrice = Number(body?.buyPrice) || 0;
      category = body?.category || 'drugo';
      condition = body?.condition || null;
      description = body?.description || null;
    }

    if (!title) return NextResponse.json({ error: 'Naslov je obvezen' }, { status: 400 });

    // Get market data for pricing
    const minP = Math.floor(buyPrice * 0.8);
    const maxP = Math.ceil(buyPrice * 1.5);
    const similar = await db.listing.findMany({
      where: { price: { gte: minP, lte: maxP }, isHidden: false, title: { contains: title.split(' ')[0] } },
      select: { price: true, title: true },
      take: 10,
    });
    const marketPrices = similar.map(l => l.price!).filter(Boolean);
    const marketAvg = marketPrices.length > 0 ? Math.round(marketPrices.reduce((a, b) => a + b, 0) / marketPrices.length) : Math.round(buyPrice * 1.25);

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za pisanje oglasov na slovenskih spletnih oglasih (Bolha, Vinted).
Generiraj optimiziran oglas za preprodajo naslednjega izdelka.

Izdelek: ${title}
Kupna cena: ${buyPrice}€
Kategorija: ${category}
${condition ? `Stanje: ${condition}` : ''}
${description ? `Originalni opis: ${description.slice(0, 500)}` : ''}
Tržno povprečje: ${marketAvg}€

Pravila za optimalen oglas:
1. Naslov naj vključuje ključne besede za iskanje (SEO za Bolha)
2. Opis naj bo podroben, profesionalen in privlačen
3. Omeni stanje, dodatke, garancijo če velja
4. Cena naj bo konkurenčna (tržno povprečje - 5% za hitro prodajo)
5. Dodaj 5-10 ključnih besed/tagov za iskanje
6. Vključi nasvete za hitro prodajo

Odgovori LE z JSON:
{
  "title": "<optimiziran naslov, max 80 znakov>",
  "description": "<poln opis, max 1000 znakov, markdown format>",
  "price": <number EUR>,
  "tags": ["<tag1>", "<tag2>", ...],
  "category": "<kategorija>",
  "tips": ["<nasvet1>", "<nasvet2>", "<nasvet3>"],
  "expected_sell_time_days": <number>,
  "profit_estimate": <number EUR>
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
    const listing = {
      title: String(parsed?.title ?? title).slice(0, 200),
      description: String(parsed?.description ?? '').slice(0, 2000),
      price: clampInt(parsed?.price, 0, 1_000_000) ?? Math.round(marketAvg * 0.95),
      tags: Array.isArray(parsed?.tags) ? parsed.tags.slice(0, 10).map((t: any) => String(t).slice(0, 50)) : [],
      category: String(parsed?.category ?? category).slice(0, 50),
      tips: Array.isArray(parsed?.tips) ? parsed.tips.slice(0, 5).map((t: any) => String(t).slice(0, 200)) : [],
      expectedSellTimeDays: clampInt(parsed?.expected_sell_time_days, 1, 365) ?? 7,
      profitEstimate: clampInt(parsed?.profit_estimate, -10000, 100000) ?? Math.round((marketAvg * 0.95) - buyPrice),
      marketAvg,
      buyPrice,
      marginPct: buyPrice > 0 ? Math.round(((clampInt(parsed?.price, 0, 1_000_000) ?? marketAvg) - buyPrice) / buyPrice * 100) : 0,
    };

    // Increment AI usage
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, listing });
  } catch (e: any) {
    logger.error("/api/ai/generate-listing", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}

function clampInt(v: any, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
}
