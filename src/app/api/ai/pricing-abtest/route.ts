// v6.11 / v8.96.1-refactor: Smart Pricing A/B Testing — AI pripravi A/B testne cene in strategije za prodajo
// Refaktoriran z withAiRoute helperjem (v8.96.1) + enforceBudget guard.
//
// POST /api/ai/pricing-abtest
// Body: { tradeIds?: string[] } // če ni podan, uporabi vse held tradeove
// Returns: { ok, tests: Array<{ tradeId, title, currentPrice, variants: [{ name, price, positioning, expectedOutcome, timeToSellDays, projectedProfit }], recommendation, reasoning }>, summary }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface PricingAbTestInput {
  tradeIds?: string[];
}

export const POST = withAiRoute<PricingAbTestInput>({
  endpoint: '/api/ai/pricing-abtest',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const tradeIds: string[] = Array.isArray(body?.tradeIds) ? body.tradeIds.filter(Boolean) : [];
    return { tradeIds: tradeIds.length > 0 ? tradeIds : undefined };
  },

  // No validateInput — tradeIds je opcijski

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const requestedIds = input.tradeIds ?? [];

    // 1. Pridobi held tradeove
    const heldTrades = await db.trade.findMany({
      where: {
        status: 'held',
        ...(requestedIds.length > 0 ? { id: { in: requestedIds } } : {}),
      },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true,
        buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true, url: true } },
      },
      take: 25,
    });

    if (heldTrades.length === 0) {
      return apiOk({
        ok: true,
        tests: [],
        message: 'Ni itemov v skladišču za A/B testiranje cen.',
      });
    }

    // 2. Pridobi kategorijsko zgodovino za benchmark
    const categories = [...new Set(heldTrades.map(t => t.category || 'drugo'))];
    const soldByCategory = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, category: { in: categories } },
      select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 100,
    });
    const catStats = computeCatStats(soldByCategory);

    // 3. Compute items array
    const items = computeItems(heldTrades, catStats);

    // 4. AI A/B testiranje
    const prompt = buildPrompt(items);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const tests = transformTests(parsed, items);

    // Summary stats
    const summaryStats = computeSummaryStats(tests);

    return apiOk({
      ok: true,
      tests,
      summary: String(parsed?.summary ?? '').slice(0, 500),
      summaryStats,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface CatStat {
  count: number;
  avgDays: number;
  avgDiscountPct: number;
}

function computeCatStats(
  soldByCategory: Array<{ category: string | null; buyPrice: number; buyFees: number | null; sellPrice: number | null; sellFees: number | null; sellDate: Date | null; buyDate: Date }>
): Record<string, CatStat> {
  const catStats: Record<string, CatStat> = {};
  for (const t of soldByCategory) {
    const cat = t.category || 'drugo';
    if (!catStats[cat]) catStats[cat] = { count: 0, avgDays: 0, avgDiscountPct: 0 };
    catStats[cat].count++;
    if (t.sellDate && t.buyDate) {
      catStats[cat].avgDays += Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
    }
    if (t.buyPrice > 0) {
      catStats[cat].avgDiscountPct += ((t.sellPrice ?? 0) - t.buyPrice) / t.buyPrice * 100;
    }
  }
  for (const c of Object.keys(catStats)) {
    catStats[c].avgDays = catStats[c].count > 0 ? Math.round(catStats[c].avgDays / catStats[c].count) : 0;
    catStats[c].avgDiscountPct = catStats[c].count > 0 ? Math.round(catStats[c].avgDiscountPct / catStats[c].count) : 0;
  }
  return catStats;
}

interface PricingItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estimatedValue: number;
  daysHeld: number;
  dealScore: number;
  catAvgDays: number;
  catAvgDiscountPct: number;
}

function computeItems(
  heldTrades: Array<{
    id: string; title: string; category: string | null; buyPrice: number; buyFees: number | null;
    buyDate: Date; listing: { aiEstimatedValue: number | null; dealScore: number | null } | null;
  }>,
  catStats: Record<string, CatStat>
): PricingItem[] {
  return heldTrades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
    const cat = t.category || 'drugo';
    return {
      id: t.id, title: t.title, category: cat,
      cost: Math.round(cost), estimatedValue: Math.round(estValue),
      daysHeld, dealScore: t.listing?.dealScore ?? 0,
      catAvgDays: catStats[cat]?.avgDays ?? 30,
      catAvgDiscountPct: catStats[cat]?.avgDiscountPct ?? 25,
    };
  });
}

function buildPrompt(items: PricingItem[]): string {
  return `Si ekspert za pricing strategije pri preprodaji rabljenih dobrin.
Za vsak item v skladišču predlagaj 3 A/B testne variante cene z različno pozicioniranjem.

Itemi v skladišču:
${items.map(i => `- [${i.id}] ${i.title} | ${i.category} | nabavna: ${i.cost}€ | est. vrednost: ${i.estimatedValue}€ | v skladišču: ${i.daysHeld}d | povp. prodaja v kategoriji: ${i.catAvgDays}d | povp. dobiček v kategoriji: +${i.catAvgDiscountPct}%`).join('\n')}

A/B testne pozicioning strategije (3 variante na item):
- "premium": višja cena od est. vrednosti (premium quality, redkost, popolnost)
- "fair": cena pri est. vrednosti (tržno pošteno)
- "aggressive": nižja cena od est. vrednosti (hitra prodaja, volume)

Za vsako varianto podaj:
- price: konkretna cena v EUR
- positioning: razlaga pozicioniranja (max 80 znakov)
- expectedOutcome: ocena rezultata (fast_sale|medium_sale|slow_sale|no_sale)
- timeToSellDays: pričakovan čas do prodaje
- projectedProfit: pričakovan dobiček (cena - nabavna)
- probabilityPct: verjetnost prodaje v tem času (0-100)
- reasoning: zakaj ta cena (max 80 znakov)

Na koncu za vsak item daj "recommendation" (premium|fair|aggressive) glede na:
- Če je item stalled >30d → aggressive
- Če je kategorija z visokim povprašanjem (catAvgDays <14d) → premium
- Sicer → fair

Odgovori LE z JSON:
{
  "tests": [
    {
      "id": "<trade_id>",
      "current_estimated_price": <number>,
      "variants": [
        {
          "name": "premium",
          "price": <number>,
          "positioning": "<razlaga>",
          "expected_outcome": "<fast_sale|medium_sale|slow_sale|no_sale>",
          "time_to_sell_days": <number>,
          "projected_profit": <number>,
          "probability_pct": <number>,
          "reasoning": "<zakaj>"
        },
        { "name": "fair", ... },
        { "name": "aggressive", ... }
      ],
      "recommendation": "<premium|fair|aggressive>",
      "recommendation_reasoning": "<max 100 znakov>"
    }
  ],
  "summary": "<splošni povzetek pricing strategije, max 200 znakov>"
}`;
}

function transformTests(parsed: any, items: PricingItem[]): any[] {
  const validIds = new Set(items.map(i => i.id));
  const itemMap = new Map(items.map(i => [i.id, i]));

  return (parsed?.tests || [])
    .filter((t: any) => validIds.has(String(t?.id ?? '')))
    .map((t: any) => {
      const id = String(t.id);
      const orig = itemMap.get(id)!;
      const variants = (Array.isArray(t?.variants) ? t.variants : []).slice(0, 3).map((v: any) => ({
        name: ['premium', 'fair', 'aggressive'].includes(String(v?.name)) ? String(v.name) : 'fair',
        price: Math.max(0, Number(v?.price ?? orig.estimatedValue)),
        positioning: String(v?.positioning ?? '').slice(0, 150),
        expectedOutcome: ['fast_sale', 'medium_sale', 'slow_sale', 'no_sale'].includes(String(v?.expected_outcome))
          ? String(v.expected_outcome) : 'medium_sale',
        timeToSellDays: Math.max(1, Math.min(180, Number(v?.time_to_sell_days ?? 14))),
        projectedProfit: Math.round(Number(v?.projected_profit ?? 0)),
        probabilityPct: Math.max(0, Math.min(100, Number(v?.probability_pct ?? 50))),
        reasoning: String(v?.reasoning ?? '').slice(0, 200),
      }));
      const recommendation = ['premium', 'fair', 'aggressive'].includes(String(t?.recommendation))
        ? String(t.recommendation) : 'fair';

      return {
        tradeId: id,
        title: orig.title,
        category: orig.category,
        cost: orig.cost,
        estimatedValue: orig.estimatedValue,
        daysHeld: orig.daysHeld,
        currentEstimatedPrice: Number(t?.current_estimated_price ?? orig.estimatedValue),
        variants,
        recommendation,
        recommendationReasoning: String(t?.recommendation_reasoning ?? '').slice(0, 200),
      };
    });
}

function computeSummaryStats(tests: any[]): {
  totalItems: number;
  avgRecommendedProfit: number;
  avgRecommendedTimeToSell: number;
  recommendationBreakdown: { premium: number; fair: number; aggressive: number };
} {
  const totalItems = tests.length;
  const avgRecommendedProfit = tests.length > 0
    ? Math.round(tests.reduce((s, t) => {
        const rec = t.variants.find((v: any) => v.name === t.recommendation);
        return s + (rec?.projectedProfit ?? 0);
      }, 0) / tests.length)
    : 0;
  const avgRecommendedTimeToSell = tests.length > 0
    ? Math.round(tests.reduce((s, t) => {
        const rec = t.variants.find((v: any) => v.name === t.recommendation);
        return s + (rec?.timeToSellDays ?? 14);
      }, 0) / tests.length)
    : 0;
  const recommendationBreakdown = {
    premium: tests.filter(t => t.recommendation === 'premium').length,
    fair: tests.filter(t => t.recommendation === 'fair').length,
    aggressive: tests.filter(t => t.recommendation === 'aggressive').length,
  };
  return { totalItems, avgRecommendedProfit, avgRecommendedTimeToSell, recommendationBreakdown };
}
