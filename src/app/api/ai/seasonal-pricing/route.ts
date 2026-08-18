// v6.33 / v8.94-refactor: AI Seasonal Price Optimizer — optimizira cene glede na sezono za max dobiček
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/seasonal-pricing
// Body: {}
// Returns: { ok, pricing: { items: [], seasonalFactors, recommendations }, insights, summary }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Avg', 'Sep', 'Okt', 'Nov', 'Dec'];
const SEASONS = ['Zima', 'Zima', 'Pomlad', 'Pomlad', 'Pomlad', 'Poletje', 'Poletje', 'Poletje', 'Jesen', 'Jesen', 'Zima', 'Zima'];

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface SeasonalPricingInput {}

export const POST = withAiRoute<SeasonalPricingInput>({
  endpoint: '/api/ai/seasonal-pricing',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async () => ({}),

  // No validateInput — endpoint nima input polj
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 40,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, pricing: null, message: 'Ni held tradeov za sezonsko ceno.' });
    }

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null }, sellPrice: { not: null } },
      select: { category: true, sellPrice: true, buyPrice: true, sellDate: true },
      take: 300,
    });

    // Analiza mesečnih cen per kategorija
    const monthlyPrices = computeMonthlyPrices(soldTrades);

    const currentMonth = new Date().getMonth();
    const items = heldTrades.map(t => ({
      id: t.id, title: t.title, category: t.category || 'drugo',
      cost: t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)),
    }));

    const itemsStr = buildItemsStr(items);
    const monthlyStr = buildMonthlyStr(monthlyPrices);
    const prompt = buildPrompt(itemsStr, monthlyStr, currentMonth);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const validIds = new Set(items.map(i => i.id));

    const pricing = transformPricing(parsed, currentMonth, validIds);

    return apiOk({ ok: true, pricing });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface MonthlyStats {
  avg: number;
  count: number;
}

function computeMonthlyPrices(
  soldTrades: Array<{ category: string | null; sellPrice: number | null; sellDate: Date | null }>
): Record<string, Record<number, MonthlyStats>> {
  const monthlyPrices: Record<string, Record<number, MonthlyStats>> = {};
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
  return monthlyPrices;
}

function buildItemsStr(
  items: Array<{ id: string; title: string; category: string; estValue: number; daysHeld: number }>
): string {
  return items.slice(0, 25).map(i => `- [${i.id}] ${i.title} | ${i.category} | est: ${i.estValue}€ | ${i.daysHeld}d`).join('\n');
}

function buildMonthlyStr(monthlyPrices: Record<string, Record<number, MonthlyStats>>): string {
  return Object.entries(monthlyPrices).slice(0, 8).map(([cat, months]) => {
    const monthData = Array.from({length: 12}, (_, m) => months[m]?.avg ?? 0);
    const peak = Math.max(...monthData);
    const low = Math.min(...monthData.filter(p => p > 0));
    return `- ${cat}: vrh ${MONTHS[monthData.indexOf(peak)]} (${peak}€), nizko ${MONTHS[monthData.indexOf(low)]} (${low}€)`;
  }).join('\n');
}

function buildPrompt(itemsStr: string, monthlyStr: string, currentMonth: number): string {
  return `Si ekspert za sezonsko optimizacijo cen.
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
}

function transformPricing(parsed: any, currentMonth: number, validIds: Set<string>): any {
  return {
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
}
