// v6.21: AI Optimal Listing Time Predictor — napove kdaj objaviti oglas za max dobiček
// POST /api/ai/optimal-time
// Body: { tradeIds?: string[] } // če ni podan, uporabi vse held tradeove
// Returns: { ok, predictions: [{ tradeId, title, category, optimalDay, optimalHour, optimalPlatform, expectedTimeToSell, expectedPrice, reasoning }], insights, summary }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const DAYS_SL = ['ponedeljek', 'torek', 'sreda', 'četrtek', 'petek', 'sobota', 'nedelja'];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const requestedIds: string[] = Array.isArray(body?.tradeIds) ? body.tradeIds.filter(Boolean) : [];

    // 1. Pridobi held trades
    const heldTrades = await db.trade.findMany({
      where: {
        status: 'held',
        ...(requestedIds.length > 0 ? { id: { in: requestedIds } } : {}),
      },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } },
      },
      take: 25,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        predictions: [],
        message: 'Ni held tradeov za analizo optimalnega časa objave.',
      });
    }

    // 2. Pridobi sold trades za analizo časovnih vzorcev prodaje
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: {
        title: true, category: true, buyPrice: true, sellPrice: true,
        buyDate: true, sellDate: true, sellLocation: true,
      },
      take: 200,
    });

    // 3. Analiza prodaj po dnevih/urah (če imamo podatke)
    const salesByDay: Record<number, { count: number; avgProfit: number; avgDaysToSell: number }> = {};
    const salesByHour: Record<number, { count: number; avgProfit: number }> = {};
    for (let i = 0; i < 7; i++) salesByDay[i] = { count: 0, avgProfit: 0, avgDaysToSell: 0 };
    for (let i = 0; i < 24; i++) salesByHour[i] = { count: 0, avgProfit: 0 };

    for (const t of soldTrades) {
      if (t.sellDate) {
        const day = (t.sellDate.getDay() + 6) % 7; // ponedeljek=0, nedelja=6
        const hour = t.sellDate.getHours();
        const profit = (t.sellPrice ?? 0) - t.buyPrice;
        salesByDay[day].count++;
        salesByDay[day].avgProfit += profit;
        if (t.buyDate && t.sellDate) {
          salesByDay[day].avgDaysToSell += Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
        }
        salesByHour[hour].count++;
        salesByHour[hour].avgProfit += profit;
      }
    }
    // Average
    for (const d of Object.keys(salesByDay)) {
      const day = salesByDay[Number(d)];
      if (day.count > 0) {
        day.avgProfit = Math.round(day.avgProfit / day.count);
        day.avgDaysToSell = Math.round(day.avgDaysToSell / day.count);
      }
    }
    for (const h of Object.keys(salesByHour)) {
      const hour = salesByHour[Number(h)];
      if (hour.count > 0) hour.avgProfit = Math.round(hour.avgProfit / hour.count);
    }

    // 4. AI napoved optimalnega časa
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const items = heldTrades.map(t => {
      const cost = t.buyPrice;
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      return {
        id: t.id, title: t.title, category: t.category || 'drugo',
        cost, estValue, daysHeld,
      };
    });

    const itemsStr = items.map(i =>
      `- [${i.id}] ${i.title} | ${i.category} | nabavna: ${i.cost}€ | est. vrednost: ${i.estValue}€ | ${i.daysHeld}d v skladišču`
    ).join('\n');

    const salesByDayStr = Object.entries(salesByDay).map(([d, s]) =>
      `- ${DAYS_SL[Number(d)]}: ${s.count} prodaj, povp. ${s.avgProfit}€ dobička, povp. ${s.avgDaysToSell}d`
    ).join('\n');

    const topHours = Object.entries(salesByHour)
      .filter(([_, s]) => s.count > 0)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 5)
      .map(([h, s]) => `${h}:00 (${s.count} prodaj, ${s.avgProfit}€)`)
      .join(', ');

    const prompt = `Si ekspert za e-commerce timing in optimizacijo objav oglasov.
Za vsak held item predlagaj OPTIMALEN čas objave oglasa za maksimalni dobiček in hitro prodajo.

INVENTAR V SKLADIŠČU:
${itemsStr}

ZGODOVINSKI PODATKI PRODAJ PO DNEVIH:
${salesByDayStr || '- Ni podatkov'}

TOP 5 UR PRODAJ:
${topHours || '- Ni podatkov'}

Slovenski kontekst:
- Bolha: aktivnost višja ob 18-22h (po delu), vikendi dopoldne
- Vinted: nedelja zvečer (priprava na teden), sreda popoldne
- Facebook: 19-21h vsak dan, vikendi zjutraj
- Sezonskost: elektronika (december, avgust-pred šolo), pohištvo (pomlad/jesen), avto (pomlad), smuči (oktober-november, marec-april)

Pravila za optimalni čas:
1. Izberi DAN (ponedeljek-nedelja) glede na zgodovino prodaj v tej kategoriji
2. Izberi URO (0-23) ko je ciljna publika najbolj aktivna
3. Izberi PLATFORMO (bolha/vinted/facebook/avtonet) glede na kategorijo
4. Upoštevaj sezonskost inbližnje praznike
5. Če je item stalled (>30d), predlagaj agresivno strategijo (flash sale, dražba)
6. Določi expectedPrice in expectedTimeToSell

Strategije objave:
- "premium_time": objavi v najboljšem času (vikend zvečer)
- "off_peak": objavi off-peak (cenejši, manj konkurence)
- "flash_sale": 24-48h akcija z močnim popustom
- "staggered": več objav v različnih časih
- "wait_seasonal": čakaj na sezonski vrh (npr. božič)

Odgovori LE z JSON:
{
  "insights": "<splošne ugotovitve o timing strategiji, max 200 znakov>",
  "predictions": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "category": "<kategorija>",
      "optimal_day": "<ponedeljek|torek|sreda|četrtek|petek|sobota|nedelja>",
      "optimal_hour": <number 0-23>,
      "optimal_platform": "<bolha|vinted|facebook|avtonet>",
      "strategy": "<premium_time|off_peak|flash_sale|staggered|wait_seasonal>",
      "expected_price_eur": <number>,
      "expected_time_to_sell_days": <number>,
      "seasonality_note": "<max 80 znakov>",
      "reasoning": "<max 120 znakov>"
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

    const predictions = (parsed?.predictions || [])
      .filter((p: any) => validIds.has(String(p?.id ?? '')))
      .map((p: any) => {
        const id = String(p.id);
        const orig = itemMap.get(id)!;
        const dayNames = ['ponedeljek', 'torek', 'sreda', 'četrtek', 'petek', 'sobota', 'nedelja'];
        return {
          tradeId: id,
          title: orig.title,
          category: orig.category,
          cost: orig.cost,
          estimatedValue: orig.estValue,
          daysHeld: orig.daysHeld,
          optimalDay: dayNames.includes(String(p?.optimal_day)) ? String(p.optimal_day) : 'sobota',
          optimalHour: Math.max(0, Math.min(23, Number(p?.optimal_hour ?? 19))),
          optimalPlatform: ['bolha', 'vinted', 'facebook', 'avtonet'].includes(String(p?.optimal_platform))
            ? String(p.optimal_platform) : 'bolha',
          strategy: ['premium_time', 'off_peak', 'flash_sale', 'staggered', 'wait_seasonal'].includes(String(p?.strategy))
            ? String(p.strategy) : 'premium_time',
          expectedPriceEur: Math.max(0, Number(p?.expected_price_eur ?? orig.estValue)),
          expectedTimeToSellDays: Math.max(1, Math.min(120, Number(p?.expected_time_to_sell_days ?? 14))),
          seasonalityNote: String(p?.seasonality_note ?? '').slice(0, 200),
          reasoning: String(p?.reasoning ?? '').slice(0, 250),
        };
      });

    // Summary
    const strategyBreakdown: Record<string, number> = {};
    const platformBreakdown: Record<string, number> = {};
    for (const p of predictions) {
      strategyBreakdown[p.strategy] = (strategyBreakdown[p.strategy] ?? 0) + 1;
      platformBreakdown[p.optimalPlatform] = (platformBreakdown[p.optimalPlatform] ?? 0) + 1;
    }
    const avgExpectedPrice = predictions.length > 0
      ? Math.round(predictions.reduce((s, p) => s + p.expectedPriceEur, 0) / predictions.length) : 0;
    const avgTimeToSell = predictions.length > 0
      ? Math.round(predictions.reduce((s, p) => s + p.expectedTimeToSellDays, 0) / predictions.length) : 0;
    const totalExpectedRevenue = predictions.reduce((s, p) => s + p.expectedPriceEur, 0);

    // Increment AI usage
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      insights: String(parsed?.insights ?? '').slice(0, 500),
      predictions,
      summary: {
        totalItems: predictions.length,
        avgExpectedPrice,
        avgTimeToSell,
        totalExpectedRevenue,
        strategyBreakdown,
        platformBreakdown,
      },
      historicalData: {
        totalSoldAnalyzed: soldTrades.length,
        salesByDay: Object.entries(salesByDay).map(([d, s]) => ({
          day: DAYS_SL[Number(d)],
          count: s.count, avgProfit: s.avgProfit, avgDaysToSell: s.avgDaysToSell,
        })),
        topHours: topHours,
      },
    });
  } catch (e: any) {
    logger.error("/api/ai/optimal-time", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
