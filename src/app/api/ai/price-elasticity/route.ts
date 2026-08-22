// v6.29 / v8.94-refactor: AI Price Elasticity Modeler — modelira občutljivost povpraševanja na spremembe cen
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/price-elasticity
// Body: { category?: string }
// Returns: { ok, elasticity: { curve, optimalPricePoint, elasticInelastic, recommendations } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface PriceElasticityInput {
  category: string;
}

export const POST = withAiRoute<PriceElasticityInput>({
  endpoint: '/api/ai/price-elasticity',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      category: String(body?.category || '').trim(),
    };
  },

  // No validateInput — category is optional (default empty string = vse kategorije)
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const categoryFilter = input.category;

    // 1. Pridobi prodane tradeove za analizo elasticnosti
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, ...(categoryFilter ? { category: categoryFilter } : {}) },
      select: { category: true, buyPrice: true, sellPrice: true, sellFees: true, buyFees: true,
        buyDate: true, sellDate: true },
      take: 300,
    });

    // 2. Pridobi held tradeove za pricing priporočila
    const heldTrades = await db.trade.findMany({
      where: { status: 'held', ...(categoryFilter ? { category: categoryFilter } : {}) },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true } } },
      take: 30,
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, elasticity: null, message: 'Ni prodaj za analizo elasticnosti.' });
    }

    // 3. Grupiraj po kategorijah in izračunaj price/volume relacijo
    const byCat = groupByCategory(soldTrades);

    // 4. Pripravi prompt sekciji
    const catStr = formatCategoryStr(byCat);
    const heldStr = formatHeldStr(heldTrades);
    const prompt = buildPrompt(catStr, heldStr);

    // 5. AI klic + parse
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const validIds = new Set(heldTrades.map(t => t.id));

    // 6. Transformacija rezultata
    const elasticity = transformElasticity(parsed, validIds);

    return apiOk({ ok: true, elasticity });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface CategoryStats {
  sales: Array<{ price: number; daysToSell: number }>;
  avgPrice: number;
  count: number;
}

function groupByCategory(
  soldTrades: Array<{
    category: string | null;
    sellPrice: number | null;
    sellFees: number | null;
    buyDate: Date | null;
    sellDate: Date | null;
  }>
): Record<string, CategoryStats> {
  const byCat: Record<string, CategoryStats> = {};
  for (const t of soldTrades) {
    const cat = t.category || 'drugo';
    if (!byCat[cat]) byCat[cat] = { sales: [], avgPrice: 0, count: 0 };
    const sellPrice = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    const days = t.sellDate && t.buyDate ? Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000)) : 30;
    byCat[cat].sales.push({ price: sellPrice, daysToSell: days });
    byCat[cat].avgPrice += sellPrice;
    byCat[cat].count++;
  }
  for (const cat of Object.keys(byCat)) {
    byCat[cat].avgPrice = byCat[cat].count > 0 ? Math.round(byCat[cat].avgPrice / byCat[cat].count) : 0;
  }
  return byCat;
}

function formatCategoryStr(byCat: Record<string, CategoryStats>): string {
  return Object.entries(byCat).sort(([,a],[,b]) => b.count - a.count).slice(0, 12).map(([cat, d]) => {
    const prices = d.sales.map(s => s.price).sort((a,b) => a-b);
    const low = prices[0] ?? 0, high = prices[prices.length-1] ?? 0, avg = d.avgPrice;
    const avgDays = Math.round(d.sales.reduce((s,x) => s + x.daysToSell, 0) / d.sales.length);
    return `- ${cat}: ${d.count} prodaj, cena ${low}-${high}€ (povp. ${avg}€), povp. ${avgDays}d prodaja`;
  }).join('\n');
}

function formatHeldStr(
  heldTrades: Array<{
    title: string;
    category: string | null;
    buyPrice: number;
    listing: { aiEstimatedValue: number | null } | null;
  }>
): string {
  return heldTrades.slice(0, 10).map(t =>
    `- ${t.title} | ${t.category} | nabavna ${t.buyPrice}€ | est. ${t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice*1.25)}€`
  ).join('\n');
}

function buildPrompt(catStr: string, heldStr: string): string {
  return `Si ekspert za cenovno elasticnost in dinamiko cen.
Modeliraj občutljivost povpraševanja na spremembe cen za preprodajo.

PODATKI PO KATEGORIJAH:
${catStr}

TRENUTNI INVENTAR:
${heldStr || '- Prazno'}

Elasticnost pravila:
- ELASTIC (|E| > 1): majhna sprememba cene → velika sprememba povpraševanja (elektronika, moda)
- INELASTIC (|E| < 1): velika sprememba cene → majhna sprememba povpraševanja (redki itemi, luxury)
- UNITARY (|E| = 1): sorazmerna sprememba

Za vsako kategorijo:
1. Oceni elasticity coefficient (E)
2. Določi optimalPricePoint (max profit = max (price × volume))
3. Ustvari price curve: 5-7 cenovnih točk z predvidenim volume in profitom
4. Identificiraj "sweet spot" (optimalno razmerje cena/volume)

Odgovori LE z JSON:
{
  "insights": "<max 250 znakov>",
  "categories": [
    {
      "category": "<kategorija>",
      "elasticity_coefficient": <number, lahko negativen>,
      "elasticity_type": "<elastic|inelastic|unitary>",
      "current_avg_price_eur": <number>,
      "optimal_price_eur": <number>,
      "price_change_pct": <number>,
      "expected_volume_change_pct": <number>,
      "expected_profit_change_pct": <number>,
      "price_curve": [
        { "price_eur": <number>, "expected_volume_pct": <number>, "expected_profit_eur": <number>, "days_to_sell": <number> }
      ],
      "sweet_spot_price_eur": <number>,
      "reasoning": "<max 100 znakov>"
    }
  ],
  "held_items_pricing": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "current_est_value_eur": <number>,
      "elasticity_based_price_eur": <number>,
      "expected_sell_time_days": <number>,
      "reasoning": "<max 80 znakov>"
    }
  ],
  "summary": {
    "most_elastic_category": "<kategorija>",
    "most_inelastic_category": "<kategorija>",
    "avg_elasticity": <number>,
    "total_profit_optimization_eur": <number>
  }
}`;
}

function transformElasticity(parsed: any, validIds: Set<string>): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 600),
    categories: (parsed?.categories || []).slice(0, 12).map((c: any) => ({
      category: String(c?.category ?? '').slice(0, 50),
      elasticityCoefficient: Math.round(Number(c?.elasticity_coefficient ?? 0) * 100) / 100,
      elasticityType: ['elastic', 'inelastic', 'unitary'].includes(String(c?.elasticity_type)) ? String(c.elasticity_type) : 'unitary',
      currentAvgPriceEur: Math.max(0, Number(c?.current_avg_price_eur ?? 0)),
      optimalPriceEur: Math.max(0, Number(c?.optimal_price_eur ?? 0)),
      priceChangePct: Math.round(Number(c?.price_change_pct ?? 0)),
      expectedVolumeChangePct: Math.round(Number(c?.expected_volume_change_pct ?? 0)),
      expectedProfitChangePct: Math.round(Number(c?.expected_profit_change_pct ?? 0)),
      priceCurve: (c?.price_curve || []).slice(0, 7).map((p: any) => ({
        priceEur: Math.max(0, Number(p?.price_eur ?? 0)),
        expectedVolumePct: Math.round(Number(p?.expected_volume_pct ?? 0)),
        expectedProfitEur: Math.round(Number(p?.expected_profit_eur ?? 0)),
        daysToSell: Math.max(0, Number(p?.days_to_sell ?? 0)),
      })),
      sweetSpotPriceEur: Math.max(0, Number(c?.sweet_spot_price_eur ?? 0)),
      reasoning: String(c?.reasoning ?? '').slice(0, 200),
    })),
    heldItemsPricing: (parsed?.held_items_pricing || []).filter((h: any) => validIds.has(String(h?.id ?? ''))).map((h: any) => ({
      id: String(h?.id ?? ''),
      title: String(h?.title ?? '').slice(0, 100),
      currentEstValueEur: Math.max(0, Number(h?.current_est_value_eur ?? 0)),
      elasticityBasedPriceEur: Math.max(0, Number(h?.elasticity_based_price_eur ?? 0)),
      expectedSellTimeDays: Math.max(0, Number(h?.expected_sell_time_days ?? 0)),
      reasoning: String(h?.reasoning ?? '').slice(0, 200),
    })),
    summary: {
      mostElasticCategory: String(parsed?.summary?.most_elastic_category ?? '').slice(0, 50),
      mostInelasticCategory: String(parsed?.summary?.most_inelastic_category ?? '').slice(0, 50),
      avgElasticity: Math.round(Number(parsed?.summary?.avg_elasticity ?? 0) * 100) / 100,
      totalProfitOptimizationEur: Math.round(Number(parsed?.summary?.total_profit_optimization_eur ?? 0)),
    },
  };
}
