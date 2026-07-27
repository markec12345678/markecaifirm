// v6.13: AI Cash Flow Optimizer — analiza in optimizacija denarnega toka
// POST /api/ai/cashflow
// Body: { forecastDays?: number } // default 30
// Returns: { ok, currentCash, forecast: [{ date, inflow, outflow, net, cumulative }], recommendations, bottlenecks, opportunities, summary }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const forecastDays = Math.max(7, Math.min(90, Number(body?.forecastDays) || 30));

    // 1. Pridobi vse sold tradeove za analizo cash flow vzorcev
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: {
        title: true, category: true, buyPrice: true, buyFees: true,
        sellPrice: true, sellFees: true, buyDate: true, sellDate: true,
        buyLocation: true, sellLocation: true,
      },
      take: 500,
    });

    // 2. Held trades — denar vezan v inventarju
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } },
      },
    });

    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        forecast: [],
        message: 'Ni dovolj podatkov za cash flow analizo.',
      });
    }

    // 3. Izračun trenutne likvidnosti
    const totalInvestedHeld = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalRealized = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0), 0);
    const totalSpent = soldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0) + totalInvestedHeld;
    const totalRevenue = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0), 0);

    // Trenutni cash = prihodek od prodaj - vse investicije
    // Predpostavimo, da je uporabnik začel z neko začetno vsoto (npr. 0)
    const currentCash = totalRevenue - totalSpent;

    // 4. Napovej prihodnje tokove na podlagi vzorcev
    // Povprečna prodaja na mesec
    const now = new Date();
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const recentSales = soldTrades.filter(t => t.sellDate && t.sellDate >= threeMonthsAgo);
    const avgSalesPerMonth = recentSales.length / 3;
    const avgRevenuePerSale = recentSales.length > 0
      ? recentSales.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0), 0) / recentSales.length
      : 0;
    const avgCostPerBuy = recentSales.length > 0
      ? recentSales.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0) / recentSales.length
      : 0;

    // Povprečni čas do prodaje
    const avgDaysToSell = recentSales.length > 0
      ? Math.round(recentSales.reduce((s, t) => {
          if (t.sellDate && t.buyDate) {
            return s + (t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000);
          }
          return s;
        }, 0) / recentSales.length)
      : 30;

    // 5. Napovej cash flow za naslednje forecastDays dni
    const forecast: Array<{ date: string; inflow: number; outflow: number; net: number; cumulative: number }> = [];
    let cumulative = currentCash;
    const expectedSales = Math.ceil((forecastDays / 30) * avgSalesPerMonth);
    const salesInterval = expectedSales > 0 ? Math.floor(forecastDays / expectedSales) : forecastDays;

    for (let d = 1; d <= forecastDays; d++) {
      const date = new Date(now);
      date.setDate(date.getDate() + d);
      let inflow = 0;
      let outflow = 0;

      // Pričakovana prodaja
      if (expectedSales > 0 && d % salesInterval === 0) {
        inflow = Math.round(avgRevenuePerSale);
        // Predpostavimo reinvesticijo dela prihodka
        outflow = Math.round(avgCostPerBuy * 0.7); // reinvestiramo 70% v nov inventar
      }

      cumulative += inflow - outflow;
      forecast.push({
        date: date.toISOString().slice(0, 10),
        inflow, outflow,
        net: inflow - outflow,
        cumulative: Math.round(cumulative),
      });
    }

    // 6. AI analiza in optimizacija
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const heldItemsStr = heldTrades.slice(0, 20).map(t => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      return `- ${t.title} | ${t.category} | nabavna: ${cost}€ | est. prodajna: ${estValue}€ | ${daysHeld}d v skladišču`;
    }).join('\n');

    const prompt = `Si ekspert za upravljanje denarnega toka pri preprodaji rabljenih dobrin.
Analiziraj trenutno stanje in predlagaj optimizacije.

TRENUTNO STANJE:
- Realiziran dobiček: ${totalRealized}€
- Vezan denar v inventarju: ${totalInvestedHeld}€ (${heldTrades.length} itemov)
- Trenutni cash (približno): ${currentCash}€
- Povprečna prodaja/mesec: ${avgSalesPerMonth.toFixed(1)}
- Povp. prihodek/prodaja: ${Math.round(avgRevenuePerSale)}€
- Povp. investicija/nakup: ${Math.round(avgCostPerBuy)}€
- Povp. čas do prodaje: ${avgDaysToSell} dni

INVENTAR V SKLADIŠČU:
${heldItemsStr || '- Ni inventarja'}

NAPOVED ZA ${forecastDays} DNI:
- Pričakovane prodaje: ${expectedSales}
- Pričakovan prihodek: ${expectedSales * avgRevenuePerSale}€
- Pričakovan izdatek (reinvesticija): ${expectedSales * avgCostPerBuy * 0.7}€
- Končni cash: ${Math.round(cumulative)}€

Pravila:
1. Identificiraj cash flow bottlenecks (kje denar obtiči)
2. Predlagaj kako sprostit vezan denar (hitra prodaja, bundle, popust)
3. Optimiziraj reinvesticijski ciklus (koliko reinvestirati, koliko zadržati)
4. Opozori na cash flow gap (kdaj bo denarja premalo za nove nakupe)
5. Predlagaj optimalno razmerje: investicija vs. rezerva

Strategije:
- "aggressive_reinvest": reinvestiraj 80% prihodka (hitra rast, visoko tveganje)
- "balanced": reinvestiraj 50%, zadrži 50% rezervo
- "conservative": reinvestiraj 30%, zadrži 70% (počasna rast, nizko tveganje)
- "liquidation_first": najprej prodaj stalled inventar preden investiraš

Odgovori LE z JSON:
{
  "summary": "<povzetek cash flow stanja, max 200 znakov>",
  "current_strategy": "<aggressive_reinvest|balanced|conservative|liquidation_first>",
  "recommended_strategy": "<ena od strategij>",
  "bottlenecks": [
    {
      "type": "<inventory_tied_up|slow_moving|high_fees|reinvestment_rate|category_concentration>",
      "description": "<opis, max 100 znakov>",
      "impact_eur": <number>,
      "fix": "<kako odpraviti, max 150 znakov>"
    }
  ],
  "recommendations": [
    {
      "action": "<konkretno dejanje, max 100 znakov>",
      "priority": "<high|medium|low>",
      "expected_impact_eur": <number>,
      "timeframe": "<short|medium|long>"
    }
  ],
  "cash_flow_gaps": [
    {
      "date_range": "<datumski razpon, max 30 znakov>",
      "expected_shortfall_eur": <number>,
      "mitigation": "<kaj narediti, max 100 znakov>"
    }
  ],
  "optimal_allocation": {
    "reinvest_pct": <number 0-100>,
    "reserve_pct": <number 0-100>,
    "reasoning": "<max 150 znakov>"
  }
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

    const result = {
      summary: String(parsed?.summary ?? '').slice(0, 500),
      currentStrategy: ['aggressive_reinvest', 'balanced', 'conservative', 'liquidation_first'].includes(String(parsed?.current_strategy))
        ? String(parsed.current_strategy) : 'balanced',
      recommendedStrategy: ['aggressive_reinvest', 'balanced', 'conservative', 'liquidation_first'].includes(String(parsed?.recommended_strategy))
        ? String(parsed.recommended_strategy) : 'balanced',
      bottlenecks: (parsed?.bottlenecks || []).slice(0, 6).map((b: any) => ({
        type: String(b?.type ?? '').slice(0, 50),
        description: String(b?.description ?? '').slice(0, 200),
        impactEur: Number(b?.impact_eur ?? 0) || 0,
        fix: String(b?.fix ?? '').slice(0, 250),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 8).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 200),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        expectedImpactEur: Number(r?.expected_impact_eur ?? 0) || 0,
        timeframe: ['short', 'medium', 'long'].includes(String(r?.timeframe)) ? String(r.timeframe) : 'medium',
      })),
      cashFlowGaps: (parsed?.cash_flow_gaps || []).slice(0, 4).map((g: any) => ({
        dateRange: String(g?.date_range ?? '').slice(0, 50),
        expectedShortfallEur: Number(g?.expected_shortfall_eur ?? 0) || 0,
        mitigation: String(g?.mitigation ?? '').slice(0, 200),
      })),
      optimalAllocation: {
        reinvestPct: Math.max(0, Math.min(100, Number(parsed?.optimal_allocation?.reinvest_pct ?? 50))),
        reservePct: Math.max(0, Math.min(100, Number(parsed?.optimal_allocation?.reserve_pct ?? 50))),
        reasoning: String(parsed?.optimal_allocation?.reasoning ?? '').slice(0, 300),
      },
    };

    // Increment AI usage
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      currentCash: Math.round(currentCash),
      totalInvestedHeld: Math.round(totalInvestedHeld),
      totalRealized: Math.round(totalRealized),
      forecast,
      analysis: result,
      summary: {
        forecastDays,
        expectedSales,
        expectedRevenue: Math.round(expectedSales * avgRevenuePerSale),
        expectedReinvestment: Math.round(expectedSales * avgCostPerBuy * 0.7),
        endingCash: Math.round(cumulative),
        avgSalesPerMonth: Number(avgSalesPerMonth.toFixed(1)),
        avgRevenuePerSale: Math.round(avgRevenuePerSale),
        avgDaysToSell,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
