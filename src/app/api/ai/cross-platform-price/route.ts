// v6.23 / v8.95.9-refactor: AI Cross-Platform Price Comparison — primerja cene istega itema na vseh platformah
// Refaktoriran z withAiRoute helperjem (v8.95.9) + enforceBudget guard.
//
// POST /api/ai/cross-platform-price
// Body: { tradeId?: string, title?: string, category?: string, condition?: string }
// Returns: { ok, comparison: { itemTitle, prices: [], cheapest: [], mostExpensive: [], arbitrage: [], recommendation } }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const PLATFORMS = [
  { id: 'bolha', name: 'Bolha.com', country: 'SI', currency: 'EUR', feePct: 0, feeFixed: 0 },
  { id: 'vinted', name: 'Vinted.si', country: 'SI', currency: 'EUR', feePct: 5, feeFixed: 0.30 },
  { id: 'avtonet', name: 'Avtonet.si', country: 'SI', currency: 'EUR', feePct: 0, feeFixed: 5 },
  { id: 'facebook', name: 'Facebook Marketplace', country: 'SI', currency: 'EUR', feePct: 0, feeFixed: 0 },
  { id: 'mobile-de', name: 'Mobile.de', country: 'DE', currency: 'EUR', feePct: 0, feeFixed: 0 },
  { id: 'kleinanzeigen', name: 'Kleinanzeigen.de', country: 'DE', currency: 'EUR', feePct: 0, feeFixed: 0 },
  { id: 'subito', name: 'Subito.it', country: 'IT', currency: 'EUR', feePct: 0, feeFixed: 0 },
  { id: 'willhaben', name: 'Willhaben.at', country: 'AT', currency: 'EUR', feePct: 0, feeFixed: 0 },
  { id: 'ebay', name: 'eBay', country: 'US/Global', currency: 'EUR', feePct: 10, feeFixed: 0.30 },
  { id: 'olx', name: 'OLX.pl', country: 'PL', currency: 'EUR', feePct: 0, feeFixed: 0 },
];

interface CrossPlatformPriceInput {
  tradeId: string;
  title: string;
  category: string;
  condition: string;
}

export const POST = withAiRoute<CrossPlatformPriceInput>({
  endpoint: '/api/ai/cross-platform-price',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : '',
      title: body?.title ?? '',
      category: body?.category ?? '',
      condition: body?.condition ?? 'used',
    };
  },

  // No validateInput — title ali tradeId je obvezen, ampak logika je v handler-ju

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    let { tradeId, title, category, condition } = input;

    if (tradeId) {
      const trade = await db.trade.findUnique({
        where: { id: String(tradeId) },
        select: {
          title: true, category: true, buyPrice: true,
          listing: { select: { aiEstimatedValue: true } },
        },
      });
      if (!trade) throw new ApiRouteError('Trade ne obstaja', 404);
      title = title || trade.title;
      category = category || trade.category || '';
    }

    if (!title) {
      return apiBadRequest('title ali tradeId je obvezen');
    }

    // 1. Pridobi podobne listinge iz baze za referenco
    const similarListings = await db.listing.findMany({
      where: {
        title: { contains: title.split(' ').slice(0, 2).join(' ') },
        isHidden: false,
        price: { not: null },
      },
      select: { price: true, monitor: { select: { source: true } }, title: true },
      take: 50,
    });

    // Group by source za benchmark
    const bySource: Record<string, number[]> = {};
    for (const l of similarListings) {
      const source = l.monitor?.source || 'unknown';
      if (l.price) {
        if (!bySource[source]) bySource[source] = [];
        bySource[source].push(l.price);
      }
    }

    // 2. AI primerjava cen
    const prompt = buildPrompt(title, category, condition, bySource);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const { prices, cheapest, mostExpensive } = transformPrices(parsed);
    const arbitrageOpportunities = transformArbitrage(parsed);
    const recommendation = transformRecommendation(parsed);

    return apiOk({
      ok: true,
      comparison: {
        itemTitle: title,
        prices,
        cheapest,
        mostExpensive,
        arbitrageOpportunities,
        recommendation,
      },
      insights: String(parsed?.insights ?? '').slice(0, 500),
      benchmarkData: {
        totalSimilarListings: similarListings.length,
        bySource: Object.entries(bySource).map(([source, prices]) => ({
          source,
          count: prices.length,
          avgPrice: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
          minPrice: Math.min(...prices),
          maxPrice: Math.max(...prices),
        })),
      },
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildPrompt(title: string, category: string, condition: string, bySource: Record<string, number[]>): string {
  const benchmarkStr = Object.entries(bySource).map(([source, prices]) => {
    const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return `- ${source}: ${prices.length} oglasov, povp. ${avg}€ (range ${min}-${max}€)`;
  }).join('\n');

  return `Si ekspert za primerjavo cen na različnih platformah.
Za ta item oceni realne cene na vseh podprtih platformah in identificiraj arbitražne priložnosti.

NASLOV ITEM-A: ${title}
KATEGORIJA: ${category}
STANJE: ${condition}

PODATKI IZ NAŠE BAZE (similar listings):
${benchmarkStr || '- Ni podatkov'}

PODPRTE PLATFORME:
${PLATFORMS.map(p => `- ${p.name} (${p.country}, ${p.currency}, provizija ${p.feePct}% + ${p.feeFixed}€)`).join('\n')}

Pravila za oceno cen:
1. Za vsako platformo oceni realno ceno (EUR) glede na lokalni trg
2. Upoštevaj lokalne razlike (DE cenejši za avto, IT za modo, SI povprečje)
3. Izračunaj neto prihodek po odbitku provizije
4. Identificiraj ARBITRAŽO: kje kupiti (najceneje) in kje prodati (najdražje)
5. Opozori na shipping stroške in čas dostave
6. Upoštevaj trgovanje znotraj EU (carina)

Strategije arbitraže:
- "domestic_resale": kupi na eni SI platformi, prodaj na drugi SI platformi
- "import_eu": kupi v tujini (DE/IT/AT), prodaj v SI
- "export_eu": kupi v SI, prodaj v tujini
- "multi_platform": objavi na več platformah hkrati
- "wait": ne izkoristi zdaj, počakaj na boljšo priložnost

Odgovori LE z JSON:
{
  "item_title": "<naslov>",
  "prices": [
    {
      "platform": "<bolha|vinted|facebook|avtonet|mobile-de|kleinanzeigen|subito|willhaben|ebay|olx>",
      "platform_name": "<ime>",
      "country": "<država>",
      "estimated_price_eur": <number>,
      "min_price_eur": <number>,
      "max_price_eur": <number>,
      "fee_eur": <number>,
      "net_revenue_eur": <number>,
      "shipping_eur": <number>,
      "demand_level": "<high|medium|low>",
      "sell_time_days": <number>,
      "url_template": "<URL za iskanje na tej platformi>"
    }
  ],
  "cheapest": {
    "platform": "<kje kupiti>",
    "price_eur": <number>,
    "country": "<država>"
  },
  "most_expensive": {
    "platform": "<kje prodati>",
    "price_eur": <number>,
    "country": "<država>"
  },
  "arbitrage_opportunities": [
    {
      "strategy": "<domestic_resale|import_eu|export_eu|multi_platform|wait>",
      "buy_platform": "<platform>",
      "sell_platform": "<platform>",
      "buy_price_eur": <number>,
      "sell_price_eur": <number>,
      "shipping_eur": <number>,
      "fees_eur": <number>,
      "net_profit_eur": <number>,
      "roi_pct": <number>,
      "feasibility": "<easy|medium|hard>",
      "time_required_days": <number>,
      "reasoning": "<max 150 znakov>"
    }
  ],
  "recommendation": {
    "best_buy_platform": "<platform>",
    "best_sell_platform": "<platform>",
    "expected_profit_eur": <number>,
    "action": "<buy_now|wait|avoid|monitor>",
    "reasoning": "<max 200 znakov>"
  },
  "insights": "<splošne ugotovitve o trgu, max 200 znakov>"
}`;
}

function transformPrices(parsed: any): {
  prices: any[];
  cheapest: any | null;
  mostExpensive: any | null;
} {
  const validPlatformIds = new Set(PLATFORMS.map(p => p.id));
  const platformMap = new Map(PLATFORMS.map(p => [p.id, p]));

  const prices = (parsed?.prices || []).filter((p: any) => validPlatformIds.has(String(p?.platform))).map((p: any) => {
    const platform = platformMap.get(String(p.platform))!;
    return {
      platform: platform.id,
      platformName: platform.name,
      country: platform.country,
      currency: platform.currency,
      estimatedPriceEur: Math.max(0, Number(p?.estimated_price_eur ?? 0)),
      minPriceEur: Math.max(0, Number(p?.min_price_eur ?? 0)),
      maxPriceEur: Math.max(0, Number(p?.max_price_eur ?? 0)),
      feeEur: Math.max(0, Number(p?.fee_eur ?? 0)),
      netRevenueEur: Math.max(0, Number(p?.net_revenue_eur ?? 0)),
      shippingEur: Math.max(0, Number(p?.shipping_eur ?? 0)),
      demandLevel: ['high', 'medium', 'low'].includes(String(p?.demand_level)) ? String(p.demand_level) : 'medium',
      sellTimeDays: Math.max(0, Number(p?.sell_time_days ?? 0)),
      urlTemplate: String(p?.url_template ?? '').slice(0, 300),
    };
  }).sort((a, b) => a.estimatedPriceEur - b.estimatedPriceEur);

  const cheapest = prices.length > 0 ? prices[0] : null;
  const mostExpensive = prices.length > 0 ? prices[prices.length - 1] : null;

  return { prices, cheapest, mostExpensive };
}

function transformArbitrage(parsed: any): any[] {
  return (parsed?.arbitrage_opportunities || []).slice(0, 6).map((a: any) => ({
    strategy: ['domestic_resale', 'import_eu', 'export_eu', 'multi_platform', 'wait'].includes(String(a?.strategy))
      ? String(a.strategy) : 'domestic_resale',
    buyPlatform: String(a?.buy_platform ?? '').slice(0, 30),
    sellPlatform: String(a?.sell_platform ?? '').slice(0, 30),
    buyPriceEur: Math.max(0, Number(a?.buy_price_eur ?? 0)),
    sellPriceEur: Math.max(0, Number(a?.sell_price_eur ?? 0)),
    shippingEur: Math.max(0, Number(a?.shipping_eur ?? 0)),
    feesEur: Math.max(0, Number(a?.fees_eur ?? 0)),
    netProfitEur: Math.max(0, Number(a?.net_profit_eur ?? 0)),
    roiPct: Math.round(Number(a?.roi_pct ?? 0)),
    feasibility: ['easy', 'medium', 'hard'].includes(String(a?.feasibility)) ? String(a.feasibility) : 'medium',
    timeRequiredDays: Math.max(0, Number(a?.time_required_days ?? 0)),
    reasoning: String(a?.reasoning ?? '').slice(0, 250),
  }));
}

function transformRecommendation(parsed: any): {
  bestBuyPlatform: string;
  bestSellPlatform: string;
  expectedProfitEur: number;
  action: string;
  reasoning: string;
} {
  return {
    bestBuyPlatform: String(parsed?.recommendation?.best_buy_platform ?? '').slice(0, 30),
    bestSellPlatform: String(parsed?.recommendation?.best_sell_platform ?? '').slice(0, 30),
    expectedProfitEur: Math.max(0, Number(parsed?.recommendation?.expected_profit_eur ?? 0)),
    action: ['buy_now', 'wait', 'avoid', 'monitor'].includes(String(parsed?.recommendation?.action))
      ? String(parsed.recommendation.action) : 'monitor',
    reasoning: String(parsed?.recommendation?.reasoning ?? '').slice(0, 400),
  };
}
