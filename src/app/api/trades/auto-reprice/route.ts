// v6.3: AI Repricing Engine — predlagaj cene za neprodane tradee v skladišču
// POST /api/trades/auto-reprice
// Body: { tradeId?: string } — single trade, or {} for all held trades
// Returns: { ok, repricing: Array<{ tradeId, title, currentPrice, suggestedPrice, dropAmount, dropPct, daysHeld, reason }> }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId;

    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;

    const heldTrades = await db.trade.findMany({
      where,
      include: {
        listing: {
          select: { id: true, title: true, price: true, aiEstimatedValue: true, dealScore: true,
            monitor: { select: { source: true } } },
        },
      },
      orderBy: { buyDate: 'asc' },
      take: 50,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, repricing: [], message: 'Ni tradeov v skladišču.' });
    }

    const now = new Date();
    const repricing: any[] = [];

    for (const trade of heldTrades) {
      const daysHeld = Math.round((now.getTime() - trade.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      const currentPrice = trade.buyPrice;

      // Get market data: similar listings currently on market
      const minP = Math.floor(currentPrice * 0.6);
      const maxP = Math.ceil(currentPrice * 1.4);
      const similar = trade.listing
        ? await db.listing.findMany({
            where: { id: { not: trade.listing.id }, price: { gte: minP, lte: maxP }, isHidden: false, monitorId: trade.listing.monitor?.source ? undefined : undefined },
            select: { price: true, firstSeenAt: true },
            take: 20,
          })
        : [];

      const marketPrices = similar.map(l => l.price!).filter(Boolean);
      const marketAvg = marketPrices.length > 0 ? Math.round(marketPrices.reduce((a, b) => a + b, 0) / marketPrices.length) : currentPrice;
      const marketMin = marketPrices.length > 0 ? Math.min(...marketPrices) : currentPrice;

      // Heuristic repricing rules (no AI needed for speed):
      // 1. Held > 60 days → suggest 10% drop
      // 2. Held > 30 days → suggest 5% drop
      // 3. Market avg < buyPrice → suggest market avg
      // 4. Market min significantly lower → suggest competitive price
      let suggestedPrice = currentPrice;
      let reason = '';

      if (daysHeld > 60) {
        suggestedPrice = Math.round(currentPrice * 0.90);
        reason = `Več kot 60 dni v skladišču — predlagan 10% padec za hitro prodajo`;
      } else if (daysHeld > 30) {
        suggestedPrice = Math.round(currentPrice * 0.95);
        reason = `30+ dni v skladišču — predlagan 5% padec`;
      } else if (marketAvg < currentPrice) {
        suggestedPrice = marketAvg;
        reason = `Tržna povprečna cena (${marketAvg}€) je nižja od kupne — uskladi ceno`;
      } else if (marketMin < currentPrice * 0.85 && marketPrices.length > 0) {
        suggestedPrice = Math.round(marketMin * 1.05); // 5% above cheapest competitor
        reason = `Konkurenca prodaja ceneje (min ${marketMin}€) — postavi konkurenčno ceno`;
      } else {
        reason = `Cena je ustrezna — počakaj na prodajo`;
      }

      const dropAmount = currentPrice - suggestedPrice;
      const dropPct = currentPrice > 0 ? Math.round((dropAmount / currentPrice) * 100) : 0;
      const potentialLoss = dropAmount > 0 ? dropAmount : 0;

      repricing.push({
        tradeId: trade.id,
        title: trade.title,
        category: trade.category,
        currentPrice,
        suggestedPrice,
        dropAmount,
        dropPct,
        daysHeld,
        marketAvg,
        marketMin,
        marketListingCount: marketPrices.length,
        reason,
        needsReprice: dropAmount > 0,
        potentialLoss,
        aiEstimatedValue: trade.listing?.aiEstimatedValue ?? null,
      });
    }

    // If single trade, also get AI suggestion
    if (tradeId && heldTrades.length === 1) {
      try {
        const settings = await getSettingsRow();
        const aiSettings: AiSettings = {
          provider: settings.aiProvider as AiProviderType,
          baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
          fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
          fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
          fallbackModel: settings.fallbackModel || '',
        };

        const trade = heldTrades[0];
        const daysHeld = Math.round((now.getTime() - trade.buyDate.getTime()) / (24 * 60 * 60 * 1000));
        const prompt = `Si ekspert za določanje cen na slovenskih spletnih oglasih.
Predlagaj optimalno prodajno ceno za naslednji item v skladišču:

Item: ${trade.title}
Kupna cena: ${trade.buyPrice}€
Dni v skladišču: ${daysHeld}
Kategorija: ${trade.category}
AI tržna vrednost: ${trade.listing?.aiEstimatedValue ?? '?'}€
Tržno povprečje: ${repricing[0]?.marketAvg ?? '?'}€
Tržni minimum: ${repricing[0]?.marketMin ?? '?'}€

Pravila:
- Če je 30+ dni v skladišču, znižaj ceno za hitrejšo prodajo
- Če je tržno povprečje nižje, postavi konkurenčno ceno
- Cilj: prodaj v 7 dneh

Odgovori LE z JSON: {"suggested_price": <number>, "reasoning": "<max 150 znakov>", "confidence": <0-100>}`;

        const raw = await callProviderForRaw(aiSettings, prompt);
        const parsed: any = parseJsonLooseExported(raw);
        const aiPrice = parseInt(parsed?.suggested_price, 10);
        if (!isNaN(aiPrice) && aiPrice > 0) {
          repricing[0].aiSuggestedPrice = aiPrice;
          repricing[0].aiReasoning = String(parsed?.reasoning ?? '').slice(0, 200);
          repricing[0].aiConfidence = parseInt(parsed?.confidence, 10) || 50;
          // Use AI price if significantly different
          if (Math.abs(aiPrice - repricing[0].suggestedPrice) > repricing[0].currentPrice * 0.05) {
            repricing[0].suggestedPrice = aiPrice;
            repricing[0].dropAmount = repricing[0].currentPrice - aiPrice;
            repricing[0].dropPct = Math.round((repricing[0].dropAmount / repricing[0].currentPrice) * 100);
          }
        }

        // Increment AI usage
        const today = new Date().toISOString().slice(0, 10);
        if (settings.aiCallsDate !== today) {
          await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
        } else {
          await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
        }
      } catch { /* AI failure is non-critical */ }
    }

    return NextResponse.json({
      ok: true,
      repricing,
      totalHeld: heldTrades.length,
      needsReprice: repricing.filter(r => r.needsReprice).length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
