// v6.33: AI Seasonal Price Optimizer — optimizira cene glede na sezono za max dobiček
// POST /api/ai/seasonal-pricing
// Body: {}
// Returns: { ok, pricing: { items: [], seasonalFactors, recommendations }, insights, summary }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Avg', 'Sep', 'Okt', 'Nov', 'Dec'];
const SEASONS = ['Zima', 'Zima', 'Pomlad', 'Pomlad', 'Pomlad', 'Poletje', 'Poletje', 'Poletje', 'Jesen', 'Jesen', 'Zima', 'Zima'];

export async function POST(req: NextRequest) {
  try {
    await req.json().catch(() => ({}));

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 40,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, pricing: null, message: 'Ni held tradeov za sezonsko ceno.' });
    }

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null }, sellPrice: { not: null } },
      select: { category: true, sellPrice: true, buyPrice: true, sellDate: true },
      take: 300,
    });

    // Analiza mesečnih cen per kategorija
    const monthlyPrices: Record<string, Record<number, { avg: number; count: number }>> = {};
    for (const t of soldTrades) {
      const cat = t.category || 'drugo';
      if (t.sellDate) {
        const m = t.sellDate.getMonth();
        if (!monthlyPrices[cat]) monthlyPrices[cat] = {};
        if (!monthlyPrices[cat][m]) monthlyPrices[cat][m] = { avg: 0, count: 0 };
        monthlyPrices[cat][m].avg += t.sellPrice ?? 0;
        monthlyPrices[cat][m].count++;
      }
    }
    for (const cat of Object.keys(monthlyPrices)) {
      for (const m of Object.keys(monthlyPrices[cat])) {
        const d = monthlyPrices[cat][Number(m)];
        d.avg = d.count > 0 ? Math.round(d.avg / d.count) : 0;
      }
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const currentMonth = new Date().getMonth();
    const items = heldTrades.map(t => ({
      id: t.id, title: t.title, category: t.category || 'drugo',
      cost: t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)),
    }));

    const itemsStr = items.slice(0, 25).map(i => `- [${i.id}] ${i.title} | ${i.category} | est: ${i.estValue}€ | ${i.daysHeld}d`).join('\n');
    const monthlyStr = Object.entries(monthlyPrices).slice(0, 8).map(([cat, months]) => {
      const monthData = Array.from({length: 12}, (_, m) => months[m]?.avg ?? 0);
      const peak = Math.max(...monthData);
      const low = Math.min(...monthData.filter(p => p > 0));
      return `- ${cat}: vrh ${MONTHS[monthData.indexOf(peak)]} (${peak}€), nizko ${MONTHS[monthData.indexOf(low)]} (${low}€)`;
    }).join('\n');

    const prompt = `Si ekspert za sezonsko optimizacijo cen.
Za vsak held item določi optimalno ceno glede na trenutno sezono in prihajajoče sezone.

TRENUTNI MESEC: ${MONTHS[currentMonth]} (${SEASONS[currentMonth]})

INVENTAR:
${itemsStr}

Mesečni cenovni vzorci po kategorijah:
${monthlyStr || '- Ni podatkov'}

Sezonska pravila (Slovenija):
- ZIMA (Dec-Feb): grelniki +20%, zimske gume +15%, smuči +25%, klima -15%
- POMLAD (Mar-Maj): kolesa +15%, vrtna oprema +20%, kabrioleti +10%
- POLETJE (Jun-Avg): kamp +30%, čolni +20%, klima +25%, smuči -30%
- JESEN (Sep-Nov): šola +15%, šport +10%, grelniki +5%, kolesa -10%

Strategije:
- "sell_peak": prodaj v sezonskem vrhu (max cena)
- "hold_for_peak": čakaj na prihajajoči vrh (npr. smuči v oktobru)
- "discount_offseason": znižaj izven sezone (hitra prodaja)
- "preseason_buy": kupuj pred sezono (ceneje)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "category": "<kategorija>",
      "current_est_value_eur": <number>,
      "seasonal_adjustment_pct": <number>,
      "seasonal_price_eur": <number>,
      "current_season": "<Zima|Pomlad|Poletje|Jesen>",
      "seasonal_demand": "<peak|high|medium|low|offseason>",
      "strategy": "<sell_peak|hold_for_peak|discount_offseason|preseason_buy>",
      "peak_month": "<mesec>",
      "peak_price_eur": <number>,
      "wait_for_peak_days": <number>,
      "expected_profit_now_eur": <number>,
      "expected_profit_at_peak_eur": <number>,
      "reasoning": "<max 100 znakov>"
    }
  ],
  "seasonal_factors": [
    { "season": "<Zima|Pomlad|Poletje|Jesen>", "hot_categories": ["<kat>"], "cold_categories": ["<kat>"], "avg_price_adjustment_pct": <number> }
  ],
  "summary": {
    "items_to_sell_now": <number>,
    "items_to_hold_for_peak": <number>,
    "items_to_discount": <number>,
    "total_expected_profit_now_eur": <number>,
    "total_expected_profit_optimized_eur": <number>,
    "seasonal_optimization_gain_eur": <number>
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
    const validIds = new Set(items.map(i => i.id));

    const pricing = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).map((it: any) => ({
        tradeId: String(it?.id ?? ''),
        title: String(it?.title ?? '').slice(0, 150),
        category: String(it?.category ?? '').slice(0, 50),
        currentEstValueEur: Math.max(0, Number(it?.current_est_value_eur ?? 0)),
        seasonalAdjustmentPct: Math.round(Number(it?.seasonal_adjustment_pct ?? 0)),
        seasonalPriceEur: Math.max(0, Number(it?.seasonal_price_eur ?? 0)),
        currentSeason: ['Zima', 'Pomlad', 'Poletje', 'Jesen'].includes(String(it?.current_season)) ? String(it.current_season) : SEASONS[currentMonth],
        seasonalDemand: ['peak', 'high', 'medium', 'low', 'offseason'].includes(String(it?.seasonal_demand)) ? String(it.seasonal_demand) : 'medium',
        strategy: ['sell_peak', 'hold_for_peak', 'discount_offseason', 'preseason_buy'].includes(String(it?.strategy)) ? String(it.strategy) : 'sell_peak',
        peakMonth: String(it?.peak_month ?? '').slice(0, 30),
        peakPriceEur: Math.max(0, Number(it?.peak_price_eur ?? 0)),
        waitForPeakDays: Math.max(0, Number(it?.wait_for_peak_days ?? 0)),
        expectedProfitNowEur: Math.round(Number(it?.expected_profit_now_eur ?? 0)),
        expectedProfitAtPeakEur: Math.round(Number(it?.expected_profit_at_peak_eur ?? 0)),
        reasoning: String(it?.reasoning ?? '').slice(0, 200),
      })),
      seasonalFactors: (parsed?.seasonal_factors || []).slice(0, 4).map((f: any) => ({
        season: ['Zima', 'Pomlad', 'Poletje', 'Jesen'].includes(String(f?.season)) ? String(f.season) : 'Zima',
        hotCategories: (f?.hot_categories || []).slice(0, 5).map((c: any) => String(c).slice(0, 50)),
        coldCategories: (f?.cold_categories || []).slice(0, 5).map((c: any) => String(c).slice(0, 50)),
        avgPriceAdjustmentPct: Math.round(Number(f?.avg_price_adjustment_pct ?? 0)),
      })),
      summary: {
        itemsToSellNow: Math.max(0, Number(parsed?.summary?.items_to_sell_now ?? 0)),
        itemsToHoldForPeak: Math.max(0, Number(parsed?.summary?.items_to_hold_for_peak ?? 0)),
        itemsToDiscount: Math.max(0, Number(parsed?.summary?.items_to_discount ?? 0)),
        totalExpectedProfitNowEur: Math.round(Number(parsed?.summary?.total_expected_profit_now_eur ?? 0)),
        totalExpectedProfitOptimizedEur: Math.round(Number(parsed?.summary?.total_expected_profit_optimized_eur ?? 0)),
        seasonalOptimizationGainEur: Math.round(Number(parsed?.summary?.seasonal_optimization_gain_eur ?? 0)),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, pricing });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
