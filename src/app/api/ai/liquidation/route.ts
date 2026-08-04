// v6.10: AI Liquidation Strategy — AI predlaga kako hitro likvidirati stalled inventar
// POST /api/ai/liquidation
// Body: { tradeIds?: string[] } // če ni podan, uporabi vse held tradeove stare >30 dni
// Returns: { ok, items: Array<{ id, title, strategy, steps, expectedPrice, timeToSell, projectedLoss, urgency }>, summary }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const requestedIds: string[] = Array.isArray(body?.tradeIds) ? body.tradeIds.filter(Boolean) : [];

    // 1. Pridobi held tradeove — prioritiziraj stalled (>30 dni)
    const where: any = { status: 'held' };
    if (requestedIds.length > 0) {
      where.id = { in: requestedIds };
    } else {
      // privzeto vzemi tiste, ki so v skladišču >30 dni ALI vse, če je manj kot 5 held
      where.OR = [
        { buyDate: { lte: new Date(Date.now() - THIRTY_DAYS_MS) } },
      ];
    }

    let heldTrades = await db.trade.findMany({
      where,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true,
        buyDate: true, buyLocation: true, listing: { select: { aiEstimatedValue: true, dealScore: true, url: true } },
      },
      take: 30,
      orderBy: { buyDate: 'asc' },
    });

    // če ni dovolj stalled, vzemi vse held
    if (heldTrades.length < 3) {
      heldTrades = await db.trade.findMany({
        where: { status: 'held' },
        select: {
          id: true, title: true, category: true, buyPrice: true, buyFees: true,
          buyDate: true, buyLocation: true, listing: { select: { aiEstimatedValue: true, dealScore: true, url: true } },
        },
        take: 30,
        orderBy: { buyDate: 'asc' },
      });
    }

    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        items: [],
        message: 'Ni itemov v skladišču za likvidacijsko analizo.',
      });
    }

    // 2. Pridobi povprečne čase prodaje po kategorijah
    const categories = [...new Set(heldTrades.map(t => t.category || 'drugo'))];
    const soldByCategory = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        category: { in: categories },
      },
      select: { category: true, buyDate: true, sellDate: true, buyPrice: true, sellPrice: true },
      take: 100,
    });
    const catStats: Record<string, { avgDays: number; avgDiscount: number; count: number }> = {};
    for (const t of soldByCategory) {
      const cat = t.category || 'drugo';
      if (!catStats[cat]) catStats[cat] = { avgDays: 0, avgDiscount: 0, count: 0 };
      catStats[cat].count++;
      if (t.sellDate && t.buyDate) {
        catStats[cat].avgDays += Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      }
      if (t.buyPrice > 0) {
        catStats[cat].avgDiscount += ((t.sellPrice ?? 0) - t.buyPrice) / t.buyPrice * 100;
      }
    }
    for (const c of Object.keys(catStats)) {
      catStats[c].avgDays = catStats[c].count > 0 ? Math.round(catStats[c].avgDays / catStats[c].count) : 0;
      catStats[c].avgDiscount = catStats[c].count > 0 ? Math.round(catStats[c].avgDiscount / catStats[c].count) : 0;
    }

    // 3. Pripravi iteme za AI
    const items = heldTrades.map((t) => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      const cat = t.category || 'drugo';
      return {
        id: t.id,
        title: t.title,
        category: cat,
        cost: Math.round(cost),
        estimatedValue: Math.round(estValue),
        daysHeld,
        dealScore: t.listing?.dealScore ?? 0,
        catAvgDays: catStats[cat]?.avgDays ?? 30,
        catAvgDiscount: catStats[cat]?.avgDiscount ?? 0,
      };
    });

    const totalCost = items.reduce((s, i) => s + i.cost, 0);
    const totalEstValue = items.reduce((s, i) => s + i.estimatedValue, 0);
    const stalledCount = items.filter(i => i.daysHeld > 30).length;

    // 4. AI likvidacijska analiza
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za likvidacijo inventarja pri preprodaji.
Tvoj cilj: za vsak stalled item predlagaj najboljšo strategijo za hitro prodajo z minimalno izgubo.

Itemi v skladišču:
${items.map(i => `- [${i.id}] ${i.title} | ${i.category} | nabavna: ${i.cost}€ | est. vrednost: ${i.estimatedValue}€ | v skladišču: ${i.daysHeld}d | povp. prodaja v kategoriji: ${i.catAvgDays}d | povp. popust v kategoriji: ${i.catAvgDiscount}%`).join('\n')}

Skupaj: ${items.length} itemov (${stalledCount} stalled >30d), ${totalCost}€ nabavne vrednosti, ${totalEstValue}€ est. vrednosti.

Strategije likvidacije (ena na item):
- "discount_progressive": progresivno nižaj ceno vsak teden za 10%
- "auction_online": dražba na Bolha/FB (hitro, a tveganje nizke cene)
- "bundle_with_hot": bundle s hitro-prodajnim itemom
- "part_out": razstavi in prodajaj kot dele (za elektroniko, kolesa, avto)
- "flash_sale": 24-48h akcija z močnim popustom
- "trade_in": ponudi kot trade-in pri naslednjem nakupu
- "wait_seasonal": čakaj na sezonski vrh (npr. grelniki pozimi)
- "donation_tax": doniraj za davčno olajšavo (če izguba večja kot donacija)
- "relist_refresh": ponovno objavi z novimi slikami/opisom

Za vsak item:
1. Izberi optimalno strategijo glede na kategorijo, starost, est. vrednost
2. Podaj konkretno ceno za likvidacijo (naj bo ≥ nabavna če mogoče, < est. vrednost)
3. Oceni čas do prodaje
4. Izračunaj projekcijo izgube (negativno = dobiček)
5. Določi urgency (critical/high/medium/low)

Odgovori LE z JSON:
{
  "summary": "<povzetek likvidacijske strategije, max 300 znakov>",
  "items": [
    {
      "id": "<trade_id>",
      "strategy": "<ena od strategij zgoraj>",
      "expected_price": <number>,
      "time_to_sell_days": <number>,
      "projected_loss": <number>,
      "urgency": "<critical|high|medium|low>",
      "steps": ["<korak 1, max 80 znakov>", "<korak 2>", "<korak 3>"],
      "reasoning": "<zakaj ta strategija, max 150 znakov>"
    }
  ]
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
        return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const validIds = new Set(items.map(i => i.id));
    const itemMap = new Map(items.map(i => [i.id, i]));

    const liquidationItems = (parsed?.items || [])
      .filter((it: any) => validIds.has(String(it?.id ?? '')))
      .map((it: any) => {
        const id = String(it.id);
        const orig = itemMap.get(id)!;
        const expectedPrice = Math.max(0, Number(it?.expected_price ?? orig.estimatedValue * 0.8));
        const cost = orig.cost;
        const projectedLoss = Math.round(expectedPrice - cost);
        return {
          id,
          title: orig.title,
          category: orig.category,
          cost,
          estimatedValue: orig.estimatedValue,
          daysHeld: orig.daysHeld,
          strategy: String(it?.strategy ?? 'discount_progressive').slice(0, 30),
          expectedPrice,
          timeToSellDays: Math.max(1, Math.min(180, Number(it?.time_to_sell_days ?? 14))),
          projectedLoss,
          urgency: ['critical', 'high', 'medium', 'low'].includes(String(it?.urgency))
            ? String(it.urgency) : 'medium',
          steps: Array.isArray(it?.steps)
            ? it.steps.slice(0, 5).map((s: any) => String(s).slice(0, 150))
            : [],
          reasoning: String(it?.reasoning ?? '').slice(0, 250),
        };
      });

    const totalProjectedRevenue = liquidationItems.reduce((s, i) => s + i.expectedPrice, 0);
    const totalProjectedLoss = liquidationItems.reduce((s, i) => s + i.projectedLoss, 0);
    const totalDaysToSell = liquidationItems.reduce((s, i) => s + i.timeToSellDays, 0);
    const avgDaysToSell = liquidationItems.length > 0 ? Math.round(totalDaysToSell / liquidationItems.length) : 0;

    // Increment AI usage
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      summary: String(parsed?.summary ?? '').slice(0, 500),
      items: liquidationItems,
      totals: {
        itemCount: liquidationItems.length,
        stalledCount,
        totalCost,
        totalEstimatedValue: totalEstValue,
        totalProjectedRevenue,
        totalProjectedLoss, // negativno = dobiček
        avgDaysToSell,
        urgencyBreakdown: {
          critical: liquidationItems.filter(i => i.urgency === 'critical').length,
          high: liquidationItems.filter(i => i.urgency === 'high').length,
          medium: liquidationItems.filter(i => i.urgency === 'medium').length,
          low: liquidationItems.filter(i => i.urgency === 'low').length,
        },
      },
    });
  } catch (e: any) {
    logger.error("/api/ai/liquidation", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
