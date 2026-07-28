// v6.25: AI Geographical Price Map — analiza cen in priložnosti po regijah
// POST /api/ai/geo-price-map
// Body: {}
// Returns: { ok, regions: [{ name, avgPrice, listingCount, opportunityCount, priceIndex, recommendation }], insights, arbitrage }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

// Slovenske regije z ključnimi mesti
const SI_REGIONS = [
  { name: 'Ljubljana', keywords: ['ljubljana', 'lj', 'vič', 'šiška', 'bežigrad', 'moste', 'center', 'rudnik'] },
  { name: 'Maribor', keywords: ['maribor', 'mb', 'ptuj', 'celje'] },
  { name: 'Primorska', keywords: ['koper', 'izola', 'piran', 'portorož', 'nova gorica', 'primorska'] },
  { name: 'Gorenjska', keywords: ['kranj', 'jesenice', 'radovljica', 'gorenjska', 'bled'] },
  { name: 'Dolenjska', keywords: ['novo mesto', 'dolenjska', 'kočevje', 'trebnje'] },
  { name: 'Štajerska', keywords: ['maribor', 'celje', 'štajerska', 'slovenj gradec', 'velenje'] },
  { name: 'Prekmurje', keywords: ['murska sobota', 'prekmurje', 'lendava', 'ptuj'] },
  { name: 'Notranjska', keywords: ['postojna', 'notranjska', 'cerknica', 'logatec'] },
];

// Tujina regije
const FOREIGN_REGIONS = [
  { name: 'Nemčija (DE)', keywords: ['deutschland', 'berlin', 'münchen', 'hamburg', 'köln', 'frankfurt', 'de'] },
  { name: 'Italija (IT)', keywords: ['italia', 'milano', 'roma', 'trieste', 'udine', 'gorizia', 'it'] },
  { name: 'Avstrija (AT)', keywords: ['österreich', 'wien', 'graz', 'linz', 'salzburg', 'at', 'celovec', 'koroška'] },
  { name: 'Hrvaška (HR)', keywords: ['hrvatska', 'zagreb', 'rijeka', 'split', 'hr'] },
];

function classifyRegion(location: string): string {
  const lower = (location || '').toLowerCase();
  for (const r of [...SI_REGIONS, ...FOREIGN_REGIONS]) {
    if (r.keywords.some(k => lower.includes(k))) return r.name;
  }
  return 'Ostalo';
}

export async function POST(req: NextRequest) {
  try {
    await req.json().catch(() => ({}));

    // 1. Pridobi vse listinge z lokacijo in ceno
    const listings = await db.listing.findMany({
      where: { isHidden: false, price: { gt: 0 } },
      select: { price: true, location: true, aiVerdict: true, dealScore: true,
        aiEstimatedValue: true, title: true, firstSeenAt: true,
        monitor: { select: { source: true } } },
      take: 1000,
    });

    // 2. Pridobi sold trades z buyLocation in sellLocation
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { buyLocation: true, sellLocation: true, buyPrice: true, sellPrice: true,
        buyFees: true, sellFees: true, category: true },
      take: 200,
    });

    if (listings.length === 0 && soldTrades.length === 0) {
      return NextResponse.json({ ok: true, regions: [], message: 'Ni podatkov o lokacijah.' });
    }

    // 3. Klasificiraj listinge po regijah
    const byRegion: Record<string, { listings: number; totalValue: number; avgPrice: number;
      minPrice: number; maxPrice: number; opportunities: number; avgDealScore: number; categories: Set<string> }> = {};

    for (const l of listings) {
      const region = classifyRegion(l.location || '');
      if (!byRegion[region]) {
        byRegion[region] = { listings: 0, totalValue: 0, avgPrice: 0, minPrice: Infinity,
          maxPrice: 0, opportunities: 0, avgDealScore: 0, categories: new Set() };
      }
      const r = byRegion[region];
      r.listings++;
      r.totalValue += l.price ?? 0;
      r.minPrice = Math.min(r.minPrice, l.price ?? 0);
      r.maxPrice = Math.max(r.maxPrice, l.price ?? 0);
      if (l.aiVerdict === 'PRILIKA' || (l.dealScore ?? 0) >= 70) r.opportunities++;
      r.avgDealScore += l.dealScore ?? 0;
    }

    // Izračunaj povprečja
    const allPrices = listings.map(l => l.price ?? 0).filter(p => p > 0);
    const globalAvg = allPrices.length > 0 ? allPrices.reduce((a, b) => a + b, 0) / allPrices.length : 0;

    for (const region of Object.keys(byRegion)) {
      const r = byRegion[region];
      r.avgPrice = r.listings > 0 ? Math.round(r.totalValue / r.listings) : 0;
      r.avgDealScore = r.listings > 0 ? Math.round(r.avgDealScore / r.listings) : 0;
      if (r.minPrice === Infinity) r.minPrice = 0;
    }

    // 4. Sold trades po regijah (buy in sell)
    const buyByRegion: Record<string, { count: number; totalCost: number; avgCost: number }> = {};
    const sellByRegion: Record<string, { count: number; totalRevenue: number; avgRevenue: number }> = {};
    for (const t of soldTrades) {
      const buyRegion = classifyRegion(t.buyLocation || '');
      const sellRegion = classifyRegion(t.sellLocation || '');
      if (!buyByRegion[buyRegion]) buyByRegion[buyRegion] = { count: 0, totalCost: 0, avgCost: 0 };
      buyByRegion[buyRegion].count++;
      buyByRegion[buyRegion].totalCost += t.buyPrice + (t.buyFees ?? 0);
      if (!sellByRegion[sellRegion]) sellByRegion[sellRegion] = { count: 0, totalRevenue: 0, avgRevenue: 0 };
      sellByRegion[sellRegion].count++;
      sellByRegion[sellRegion].totalRevenue += (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    }
    for (const r of Object.keys(buyByRegion)) buyByRegion[r].avgCost = buyByRegion[r].count > 0 ? Math.round(buyByRegion[r].totalCost / buyByRegion[r].count) : 0;
    for (const r of Object.keys(sellByRegion)) sellByRegion[r].avgRevenue = sellByRegion[r].count > 0 ? Math.round(sellByRegion[r].totalRevenue / sellByRegion[r].count) : 0;

    // 5. AI analiza
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const regionsStr = Object.entries(byRegion)
      .sort(([, a], [, b]) => a.avgPrice - b.avgPrice)
      .map(([region, r]) => `- ${region}: ${r.listings} oglasov, povp. ${r.avgPrice}€ (min ${r.minPrice}-max ${r.maxPrice}€), ${r.opportunities} priložnosti, deal score ${r.avgDealScore}/100`)
      .join('\n');

    const prompt = `Si ekspert za geografsko analizo trga in cenovnih razlik.
Analiziraj cene in priložnosti po regijah ter identificiraj geografsko arbitražo.

PODATKI PO REGIJAH:
${regionsStr || '- Ni podatkov'}

Globalno povprečje: ${Math.round(globalAvg)}€

Slovenski kontekst:
- Ljubljana: najvišje cene (bogatejši trg, več povprašanja)
- Maribor/Štajerska: nižje cene (manjše povprašanje)
- Primorska: premium cene (turistično območje)
- Tujina (DE/IT/AT): pogosto cenejše za določene kategorije

Geografska arbitraža:
- "domestic_arbitrage": kupi v cenejši SI regiji, prodaj v dražji
- "import_arbitrage": kupi v tujini, prodaj v SI
- "export_arbitrage": kupi v SI, prodaj v tujini
- "local_advantage": izkoristi lokalno poznavanje trga

Odgovori LE z JSON:
{
  "insights": "<splošne ugotovitve o geografski raznolikosti, max 250 znakov>",
  "regions": [
    {
      "name": "<regija>",
      "avg_price_eur": <number>,
      "price_index": <number, 100 = globalno povprečje>,
      "listing_count": <number>,
      "opportunity_count": <number>,
      "opportunity_rate_pct": <number>,
      "avg_deal_score": <number>,
      "price_range": "<min-max>",
      "recommendation": "<buy_here|sell_here|avoid|monitor>",
      "best_categories": ["<kategorija, max 50 znakov>", "..."],
      "reasoning": "<max 100 znakov>"
    }
  ],
  "arbitrage_routes": [
    {
      "strategy": "<domestic_arbitrage|import_arbitrage|export_arbitrage|local_advantage>",
      "buy_region": "<regija>",
      "sell_region": "<regija>",
      "avg_buy_price_eur": <number>,
      "avg_sell_price_eur": <number>,
      "potential_profit_eur": <number>,
      "potential_roi_pct": <number>,
      "shipping_eur": <number>,
      "feasibility": "<easy|medium|hard>",
      "reasoning": "<max 100 znakov>"
    }
  ],
  "summary": {
    "cheapest_region": "<regija>",
    "most_expensive_region": "<regija>",
    "best_opportunity_region": "<regija>",
    "total_arbitrage_potential_eur": <number>,
    "price_spread_pct": <number>
  }
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);

    const regions = (parsed?.regions || []).slice(0, 15).map((r: any) => ({
      name: String(r?.name ?? '').slice(0, 50),
      avgPriceEur: Math.max(0, Number(r?.avg_price_eur ?? 0)),
      priceIndex: Math.round(Number(r?.price_index ?? 100)),
      listingCount: Math.max(0, Number(r?.listing_count ?? 0)),
      opportunityCount: Math.max(0, Number(r?.opportunity_count ?? 0)),
      opportunityRatePct: Math.max(0, Math.min(100, Number(r?.opportunity_rate_pct ?? 0))),
      avgDealScore: Math.max(0, Math.min(100, Number(r?.avg_deal_score ?? 0))),
      priceRange: String(r?.price_range ?? '').slice(0, 50),
      recommendation: ['buy_here', 'sell_here', 'avoid', 'monitor'].includes(String(r?.recommendation))
        ? String(r.recommendation) : 'monitor',
      bestCategories: (r?.best_categories || []).slice(0, 3).map((c: any) => String(c).slice(0, 80)),
      reasoning: String(r?.reasoning ?? '').slice(0, 200),
    }));

    const arbitrageRoutes = (parsed?.arbitrage_routes || []).slice(0, 8).map((a: any) => ({
      strategy: ['domestic_arbitrage', 'import_arbitrage', 'export_arbitrage', 'local_advantage'].includes(String(a?.strategy))
        ? String(a.strategy) : 'domestic_arbitrage',
      buyRegion: String(a?.buy_region ?? '').slice(0, 50),
      sellRegion: String(a?.sell_region ?? '').slice(0, 50),
      avgBuyPriceEur: Math.max(0, Number(a?.avg_buy_price_eur ?? 0)),
      avgSellPriceEur: Math.max(0, Number(a?.avg_sell_price_eur ?? 0)),
      potentialProfitEur: Math.max(0, Number(a?.potential_profit_eur ?? 0)),
      potentialRoiPct: Math.round(Number(a?.potential_roi_pct ?? 0)),
      shippingEur: Math.max(0, Number(a?.shipping_eur ?? 0)),
      feasibility: ['easy', 'medium', 'hard'].includes(String(a?.feasibility)) ? String(a.feasibility) : 'medium',
      reasoning: String(a?.reasoning ?? '').slice(0, 200),
    }));

    const summary = {
      cheapestRegion: String(parsed?.summary?.cheapest_region ?? '').slice(0, 50),
      mostExpensiveRegion: String(parsed?.summary?.most_expensive_region ?? '').slice(0, 50),
      bestOpportunityRegion: String(parsed?.summary?.best_opportunity_region ?? '').slice(0, 50),
      totalArbitragePotentialEur: Math.max(0, Number(parsed?.summary?.total_arbitrage_potential_eur ?? 0)),
      priceSpreadPct: Math.round(Number(parsed?.summary?.price_spread_pct ?? 0)),
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      insights: String(parsed?.insights ?? '').slice(0, 600),
      regions,
      arbitrageRoutes,
      summary,
      globalAvgPrice: Math.round(globalAvg),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
