// v6.8: AI Profit Forecast — AI napove pričakovani dobiček za naslednji mesec
// POST /api/ai/profit-forecast
// Body: { months?: number (default 1) }
// Returns: { ok, forecast: { expectedProfit, confidence, scenarios, factors, recommendation } }

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
    const body = await req.json().catch(() => ({}));
    const months = Math.min(3, Math.max(1, body?.months ?? 1));

    // Gather historical data
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);

    const [soldTrades, heldTrades, listings, monitors] = await Promise.all([
      db.trade.findMany({
        where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: sixMonthsAgo } },
        select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true, category: true, title: true },
      }),
      db.trade.findMany({
        where: { status: 'held' },
        select: { buyPrice: true, buyFees: true, title: true, category: true, buyDate: true, listing: { select: { aiEstimatedValue: true } } },
      }),
      db.listing.count({
        where: { firstSeenAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, aiVerdict: 'PRILIKA' },
      }),
      db.monitor.count({ where: { isActive: true } }),
    ]);

    // Monthly profit history
    const monthlyProfits: Array<{ month: string; profit: number; count: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const monthTrades = soldTrades.filter(t => t.sellDate! >= start && t.sellDate! < end);
      const profit = monthTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
      monthlyProfits.push({
        month: start.toISOString().slice(0, 7),
        profit: Math.round(profit),
        count: monthTrades.length,
      });
    }

    // Calculate trends
    const avgMonthlyProfit = monthlyProfits.reduce((s, m) => s + m.profit, 0) / Math.max(1, monthlyProfits.length);
    const lastMonth = monthlyProfits[monthlyProfits.length - 1];
    const prevMonth = monthlyProfits[monthlyProfits.length - 2];

    // Trend direction
    const trendPct = prevMonth && prevMonth.profit !== 0
      ? Math.round(((lastMonth.profit - prevMonth.profit) / Math.abs(prevMonth.profit)) * 100)
      : 0;

    // Held inventory potential
    const heldPotential = heldTrades.reduce((s, t) => {
      const estSell = t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.15);
      return s + (estSell - t.buyPrice - (t.buyFees ?? 0) - estSell * 0.1);
    }, 0);

    // Pipeline: active monitors × avg listings per monitor × avg conversion rate
    const avgListingsPerMonitor = monitors > 0 ? listings / monitors : 0;
    const conversionRate = soldTrades.length > 0 && listings > 0 ? soldTrades.length / (listings * 6) : 0.05;
    const expectedNewOpportunities = Math.round(avgListingsPerMonitor * conversionRate * months * 4);

    // AI forecast
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiSettings['fallbackProvider'] as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za napovedovanje dobička pri preprodaji na slovenskih oglasih.
Napovej pričakovani dobiček za naslednjih ${months} mesec(-ev).

Zgodovinski podatki (zadnjih 6 mesecev):
${monthlyProfits.map(m => `${m.month}: ${m.profit}€ (${m.count} prodaj)`).join('\n')}

Povprečni mesečni dobiček: ${Math.round(avgMonthlyProfit)}€
Trend (zadnji mesec vs prejšnji): ${trendPct > 0 ? '+' : ''}${trendPct}%
Trenutno v skladišču: ${heldTrades.length} itemov, potencialni dobiček: ${Math.round(heldPotential)}€
Aktivni monitorji: ${monitors}
PRILIKA oglasov v zadnjih 30 dneh: ${listings}
Pričakovane nove priložnosti: ${expectedNewOpportunities}

Generiraj:
1. expected_profit (EUR za ${months} mesec(-ev))
2. confidence (0-100)
3. Scenariji: optimistic, realistic, pessimistic (vsak z profit in probability)
4. Ključni faktorji ki vplivajo na napoved
5. Priporočilo za uporabnika

Odgovori LE z JSON:
{
  "expected_profit": <number>,
  "confidence": <0-100>,
  "scenarios": {
    "optimistic": { "profit": <number>, "probability": <0-100> },
    "realistic": { "profit": <number>, "probability": <0-100> },
    "pessimistic": { "profit": <number>, "probability": <0-100> }
  },
  "factors": ["<faktor1>", "<faktor2>", "<faktor3>"],
  "recommendation": "<priporočilo v slovenščini, max 200 znakov>"
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
      forecast: {
        expectedProfit: Number(parsed?.expected_profit ?? Math.round(avgMonthlyProfit * months)),
        confidence: Math.min(100, Math.max(0, parseInt(parsed?.confidence, 10) || 50)),
        scenarios: {
          optimistic: { profit: Number(parsed?.scenarios?.optimistic?.profit ?? Math.round(avgMonthlyProfit * months * 1.3)), probability: parseInt(parsed?.scenarios?.optimistic?.probability, 10) || 25 },
          realistic: { profit: Number(parsed?.scenarios?.realistic?.profit ?? Math.round(avgMonthlyProfit * months)), probability: parseInt(parsed?.scenarios?.realistic?.probability, 10) || 50 },
          pessimistic: { profit: Number(parsed?.scenarios?.pessimistic?.profit ?? Math.round(avgMonthlyProfit * months * 0.6)), probability: parseInt(parsed?.scenarios?.pessimistic?.probability, 10) || 25 },
        },
        factors: Array.isArray(parsed?.factors) ? parsed.factors.slice(0, 5).map((f: any) => String(f).slice(0, 200)) : [],
        recommendation: String(parsed?.recommendation ?? '').slice(0, 300),
      },
      historicalData: {
        monthlyProfits,
        avgMonthlyProfit: Math.round(avgMonthlyProfit),
        trendPct,
        heldPotential: Math.round(heldPotential),
        heldCount: heldTrades.length,
        activeMonitors: monitors,
        recentPrilikaCount: listings,
        expectedNewOpportunities,
        soldTradesCount: soldTrades.length,
      },
      months,
    });
  } catch (e: any) {
    logger.error("/api/ai/profit-forecast", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
