// v6.24: AI Smart Restock Predictor — napove kdaj in kaj znova kupiti za max dobiček
// POST /api/ai/smart-restock
// Body: { budget?: number }
// Returns: { ok, predictions: [{ category, item, source, expectedBuyPrice, expectedSellPrice, expectedROI, expectedDaysToSell, urgency, action }], insights, budgetAllocation }

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
    const budget = Math.max(0, Number(body?.budget) || 0);

    // 1. Pridobi sold trades za analizo uspešnosti kategorij/virov
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { gte: sixMonthsAgo }, sellPrice: { not: null } },
      select: { title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true,
        sellFees: true, buyLocation: true, buyDate: true, sellDate: true },
      take: 200,
    });

    // 2. Pridovi held trades (trenutni stock per kategorija)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { category: true, buyPrice: true, buyDate: true },
    });

    // 3. Pridobi nedavne listinge za trend iskanja
    const recentListings = await db.listing.findMany({
      where: {
        isHidden: false,
        firstSeenAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        aiVerdict: 'PRILIKA',
      },
      select: { title: true, price: true,
        monitor: { select: { source: true, name: true } },
        dealScore: true, firstSeenAt: true },
      take: 100,
      orderBy: { dealScore: 'desc' },
    });

    if (soldTrades.length === 0 && recentListings.length === 0) {
      return NextResponse.json({
        ok: true,
        predictions: [],
        message: 'Ni dovolj podatkov za napoved restock.',
      });
    }

    // 4. Analiza uspešnosti per kategorija in vir
    const catPerformance: Record<string, { count: number; totalProfit: number; avgRoi: number; avgDays: number }> = {};
    const sourcePerformance: Record<string, { count: number; totalProfit: number; avgRoi: number }> = {};

    for (const t of soldTrades) {
      const cat = t.category || 'drugo';
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = revenue - cost;
      const roi = cost > 0 ? (profit / cost) * 100 : 0;
      const days = t.sellDate && t.buyDate
        ? Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000)) : 30;

      if (!catPerformance[cat]) catPerformance[cat] = { count: 0, totalProfit: 0, avgRoi: 0, avgDays: 0 };
      catPerformance[cat].count++;
      catPerformance[cat].totalProfit += profit;
      catPerformance[cat].avgRoi += roi;
      catPerformance[cat].avgDays += days;

      const src = t.buyLocation || 'neznan';
      if (!sourcePerformance[src]) sourcePerformance[src] = { count: 0, totalProfit: 0, avgRoi: 0 };
      sourcePerformance[src].count++;
      sourcePerformance[src].totalProfit += profit;
      sourcePerformance[src].avgRoi += roi;
    }

    for (const cat of Object.keys(catPerformance)) {
      const c = catPerformance[cat];
      c.avgRoi = c.count > 0 ? Math.round(c.avgRoi / c.count) : 0;
      c.avgDays = c.count > 0 ? Math.round(c.avgDays / c.count) : 30;
    }
    for (const src of Object.keys(sourcePerformance)) {
      const s = sourcePerformance[src];
      s.avgRoi = s.count > 0 ? Math.round(s.avgRoi / s.count) : 0;
    }

    // Trenutni stock per kategorija
    const currentStock: Record<string, { count: number; value: number }> = {};
    for (const t of heldTrades) {
      const cat = t.category || 'drugo';
      if (!currentStock[cat]) currentStock[cat] = { count: 0, value: 0 };
      currentStock[cat].count++;
      currentStock[cat].value += t.buyPrice;
    }

    // 5. AI napoved restock
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const catPerfStr = Object.entries(catPerformance)
      .sort(([, a], [, b]) => b.totalProfit - a.totalProfit)
      .map(([cat, p]) => `- ${cat}: ${p.count} prodaj, ${p.totalProfit}€ dobička, ${p.avgRoi}% ROI, ${p.avgDays}d prodaja`)
      .join('\n');

    const sourceStr = Object.entries(sourcePerformance)
      .sort(([, a], [, b]) => b.totalProfit - a.totalProfit)
      .map(([src, p]) => `- ${src}: ${p.count} nakupov, ${p.totalProfit}€ dobička, ${p.avgRoi}% ROI`)
      .join('\n');

    const stockStr = Object.entries(currentStock)
      .map(([cat, s]) => `- ${cat}: ${s.count} itemov (${s.value}€ vezano)`)
      .join('\n');

    const recentStr = recentListings.slice(0, 15).map(l =>
      `- ${l.title} | ${l.price}€ | deal: ${l.dealScore}/100 | ${l.monitor?.source || 'neznan'}`
    ).join('\n');

    const prompt = `Si ekspert za supply chain in restock strategije pri preprodaji.
Na podlagi zgodovine prodaj in trenutnega skladišča predlagaj KAJ, KJE in KDAJ kupovati za max dobiček.

ZGODOVINSKA USPEŠNOST PO KATEGORIJAH:
${catPerfStr || '- Ni podatkov'}

USPEŠNOST PO VIRIH NAKUPA:
${sourceStr || '- Ni podatkov'}

TRENUTNI STOCK:
${stockStr || '- Prazno skladišče'}

${budget > 0 ? `NA VOLJO BUDGET: ${budget}€` : 'BUDGET: ni omejen'}

NEDEAVNE PRILIŽNOSTI (zadnjih 14 dni):
${recentStr || '- Ni novih priložnosti'}

Pravila:
1. Kategorije z ROI > 30% in hitro prodajo → restock PREDNOST
2. Kategorije z 0 stockom in visokim ROI → URGENTNO
3. Kategorije z veliko stockom in nizkim ROI → NE restock
4. Upoštevaj sezonskost (zima: grelniki, poletje: kamp, jesen: šola)
5. Budget razporedi po kategorijah glede na ROI in turnover

Za vsako kategorijo podaj:
- item: konkreten tip itema za iskanje
- source: kje iskati (bolha/vinted/avtonet/mobile-de/kleinanzeigen/...)
- expectedBuyPrice: predvidena nabavna cena
- expectedSellPrice: predvidena prodajna cena
- expectedROI: pričakovan ROI %
- expectedDaysToSell: pričakovan čas do prodaje
- urgency: how quickly to act (critical/high/medium/low)
- quantity: koliko kupiti

Odgovori LE z JSON:
{
  "insights": "<splošne ugotovitve o restock strategiji, max 250 znakov>",
  "predictions": [
    {
      "category": "<kategorija>",
      "item": "<konkreten item za iskanje, max 80 znakov>",
      "source": "<bolha|vinted|avtonet|mobile-de|kleinanzeigen|subito|willhaben|facebook>",
      "expected_buy_price_eur": <number>,
      "expected_sell_price_eur": <number>,
      "expected_roi_pct": <number>,
      "expected_days_to_sell": <number>,
      "urgency": "<critical|high|medium|low>",
      "quantity": <number>,
      "budget_allocation_eur": <number>,
      "search_keywords": "<ključne besede za iskanje, max 80 znakov>",
      "reasoning": "<max 100 znakov>"
    }
  ],
  "budget_allocation": {
    "total_budget_eur": <number>,
    "allocation": [
      {
        "category": "<kategorija>",
        "amount_eur": <number>,
        "pct": <number>,
        "reasoning": "<max 80 znakov>"
      }
    ],
    "reserve_eur": <number>,
    "reserve_pct": <number>
  },
  "seasonal_alerts": [
    {
      "season": "<pomlad|poletje|jesen|zima>",
      "items_to_buy": ["<item, max 50 znakov>", "..."],
      "items_to_sell": ["<item, max 50 znakov>", "..."],
      "deadline": "<do kdaj ukrepati, max 50 znakov>"
    }
  ],
  "warnings": ["<opozorilo, max 100 znakov>", "..."]
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

    const predictions = (parsed?.predictions || []).slice(0, 12).map((p: any) => ({
      category: String(p?.category ?? '').slice(0, 50),
      item: String(p?.item ?? '').slice(0, 150),
      source: String(p?.source ?? 'bolha').slice(0, 30),
      expectedBuyPriceEur: Math.max(0, Number(p?.expected_buy_price_eur ?? 0)),
      expectedSellPriceEur: Math.max(0, Number(p?.expected_sell_price_eur ?? 0)),
      expectedRoiPct: Math.round(Number(p?.expected_roi_pct ?? 0)),
      expectedDaysToSell: Math.max(0, Number(p?.expected_days_to_sell ?? 0)),
      urgency: ['critical', 'high', 'medium', 'low'].includes(String(p?.urgency)) ? String(p.urgency) : 'medium',
      quantity: Math.max(1, Number(p?.quantity ?? 1)),
      budgetAllocationEur: Math.max(0, Number(p?.budget_allocation_eur ?? 0)),
      searchKeywords: String(p?.search_keywords ?? '').slice(0, 200),
      reasoning: String(p?.reasoning ?? '').slice(0, 200),
    }));

    const budgetAllocation = {
      totalBudgetEur: Math.max(0, Number(parsed?.budget_allocation?.total_budget_eur ?? budget)),
      allocation: (parsed?.budget_allocation?.allocation || []).slice(0, 8).map((a: any) => ({
        category: String(a?.category ?? '').slice(0, 50),
        amountEur: Math.max(0, Number(a?.amount_eur ?? 0)),
        pct: Math.max(0, Math.min(100, Number(a?.pct ?? 0))),
        reasoning: String(a?.reasoning ?? '').slice(0, 200),
      })),
      reserveEur: Math.max(0, Number(parsed?.budget_allocation?.reserve_eur ?? 0)),
      reservePct: Math.max(0, Math.min(100, Number(parsed?.budget_allocation?.reserve_pct ?? 0))),
    };

    const seasonalAlerts = (parsed?.seasonal_alerts || []).slice(0, 4).map((s: any) => ({
      season: ['pomlad', 'poletje', 'jesen', 'zima'].includes(String(s?.season)) ? String(s.season) : 'pomlad',
      itemsToBuy: (s?.items_to_buy || []).slice(0, 5).map((i: any) => String(i).slice(0, 100)),
      itemsToSell: (s?.items_to_sell || []).slice(0, 5).map((i: any) => String(i).slice(0, 100)),
      deadline: String(s?.deadline ?? '').slice(0, 100),
    }));

    const warnings = (parsed?.warnings || []).slice(0, 5).map((w: any) => String(w).slice(0, 200));

    // Increment AI usage
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      insights: String(parsed?.insights ?? '').slice(0, 600),
      predictions,
      budgetAllocation,
      seasonalAlerts,
      warnings,
      summary: {
        totalPredictions: predictions.length,
        totalBudgetAllocated: budgetAllocation.allocation.reduce((s: number, a: any) => s + a.amountEur, 0),
        criticalCount: predictions.filter(p => p.urgency === 'critical').length,
        highCount: predictions.filter(p => p.urgency === 'high').length,
        avgExpectedRoi: predictions.length > 0
          ? Math.round(predictions.reduce((s, p) => s + p.expectedRoiPct, 0) / predictions.length)
          : 0,
        budget,
      },
    });
  } catch (e: any) {
    logger.error("/api/ai/smart-restock", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
