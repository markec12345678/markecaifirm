// v8.97: Vinted Cross-Country Arbitrage Scanner
//
// Najdi donosne arbitražne priložnosti med Vinted trgi v 26 državah.
// Uporablja hevristično analizo + AI za oceno donosnosti.
//
// POST /api/ai/vinted-cross-country-arbitrage
// Body: { category?: string, minRoiPct?: number, maxBudget?: number, limit?: number }
// Returns: { ok, opportunities, summary, insights }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const VINTED_MARKETS = [
  { code: 'AT', country: 'Avstrija', currency: 'EUR', shippingEur: 8 },
  { code: 'BE', country: 'Belgija', currency: 'EUR', shippingEur: 10 },
  { code: 'CZ', country: 'Češka', currency: 'CZK', shippingEur: 12 },
  { code: 'HR', country: 'Hrvaška', currency: 'EUR', shippingEur: 8 },
  { code: 'DK', country: 'Danska', currency: 'DKK', shippingEur: 15 },
  { code: 'FI', country: 'Finska', currency: 'EUR', shippingEur: 12 },
  { code: 'FR', country: 'Francija', currency: 'EUR', shippingEur: 12 },
  { code: 'DE', country: 'Nemčija', currency: 'EUR', shippingEur: 8 },
  { code: 'HU', country: 'Madžarska', currency: 'HUF', shippingEur: 15 },
  { code: 'IT', country: 'Italija', currency: 'EUR', shippingEur: 10 },
  { code: 'LV', country: 'Latvija', currency: 'EUR', shippingEur: 12 },
  { code: 'LT', country: 'Litva', currency: 'EUR', shippingEur: 12 },
  { code: 'NL', country: 'Nizozemska', currency: 'EUR', shippingEur: 10 },
  { code: 'PL', country: 'Poljska', currency: 'PLN', shippingEur: 12 },
  { code: 'PT', country: 'Portugalska', currency: 'EUR', shippingEur: 15 },
  { code: 'RO', country: 'Romunija', currency: 'RON', shippingEur: 18 },
  { code: 'SK', country: 'Slovaška', currency: 'EUR', shippingEur: 12 },
  { code: 'SI', country: 'Slovenija', currency: 'EUR', shippingEur: 5 },
  { code: 'ES', country: 'Španija', currency: 'EUR', shippingEur: 15 },
  { code: 'SE', country: 'Švedska', currency: 'SEK', shippingEur: 15 },
  { code: 'UK', country: 'Združeno kraljestvo', currency: 'GBP', shippingEur: 18 },
] as const;

interface ArbitrageInput {
  category: string | null;
  minRoiPct: number;
  maxBudget: number;
  limit: number;
}

export const POST = withAiRoute<ArbitrageInput>({
  endpoint: '/api/ai/vinted-cross-country-arbitrage',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      category: body?.category ? String(body.category) : null,
      minRoiPct: Math.min(500, Math.max(10, Number(body?.minRoiPct ?? 30))),
      maxBudget: Math.min(10000, Math.max(10, Number(body?.maxBudget ?? 500))),
      limit: Math.min(50, Math.max(5, Number(body?.limit ?? 20))),
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { category, minRoiPct, maxBudget, limit } = input;

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const where: any = {
      price: { not: null },
      isHidden: false,
      firstSeenAt: { gte: since },
      OR: [{ aiVerdict: 'PRILIKA' }, { dealScore: { gte: 50 } }],
    };
    if (category) {
      where.OR = [
        { aiVerdict: 'PRILIKA', category: { contains: category, mode: 'insensitive' } },
        { dealScore: { gte: 50 }, category: { contains: category, mode: 'insensitive' } },
      ];
    }

    const listings = await db.listing.findMany({
      where,
      select: {
        id: true, title: true, price: true, priceText: true,
        aiEstimatedValue: true, aiScore: true, dealScore: true,
        imageUrl: true, userNotes: true,
        monitor: { select: { source: true, name: true } },
      },
      orderBy: { dealScore: 'desc' },
      take: limit,
    });

    if (listings.length === 0) {
      return apiOk({
        opportunities: [],
        summary: { totalScanned: 0, profitableCount: 0, avgRoiPct: 0, totalPotentialProfitEur: 0 },
        message: 'Ni oglasov za analizo.',
      });
    }

    const prompt = buildPrompt(listings, minRoiPct, maxBudget);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const opportunities = transformOpportunities(parsed, listings)
      .map(opp => ({ ...opp, ...calcNet(opp) }))
      .filter(o => o.netRoiPct >= minRoiPct && o.buyPriceEur <= maxBudget);

    const summary = {
      totalScanned: listings.length,
      profitableCount: opportunities.length,
      avgRoiPct: opportunities.length > 0
        ? Math.round(opportunities.reduce((s, o) => s + o.netRoiPct, 0) / opportunities.length)
        : 0,
      totalPotentialProfitEur: Math.round(opportunities.reduce((s, o) => s + (o.netProfitEur || 0), 0)),
      bestOpportunity: opportunities[0] || null,
      marketsAnalyzed: VINTED_MARKETS.length,
    };

    return apiOk({
      opportunities,
      summary,
      insights: String(parsed?.insights ?? '').slice(0, 500),
      markets: VINTED_MARKETS.map(m => ({ code: m.code, country: m.country, currency: m.currency })),
    });
  },
});

function buildPrompt(listings: any[], minRoiPct: number, maxBudget: number): string {
  const itemsStr = listings.slice(0, 20).map((l, i) =>
    `${i + 1}. ${l.title} | Cena: ${l.price ?? '?'}€ | Est: ${l.aiEstimatedValue ?? '?'}€ | Kat: ${l.category ?? 'neznan'}`
  ).join('\n');

  return `Si ekspert za Vinted cross-country arbitražo v Evropi.
Analiziraj naslednje izdelke in za vsak določi kje kupiti (najceneje) in kje prodati (najdražje).

IZDELKI:
${itemsStr}

VINTED TRGI (21 držav):
${VINTED_MARKETS.map(m => `- ${m.code} (${m.country}): ${m.currency}, pošiljanje ~${m.shippingEur}€`).join('\n')}

PRAVILA:
- Kupi v državi z najnižjo ceno + pošiljanje
- Prodaj v Sloveniji (SI)
- Vinted fee: 5% + 0.30€
- Min ROI: ${minRoiPct}% | Max budget: ${maxBudget}€

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "opportunities": [
    { "itemIndex": <1-20>, "title": "<naslov>", "buyCountry": "<2č>", "sellCountry": "SI",
      "buyPriceEur": <num>, "sellPriceEur": <num>, "shippingEur": <num>,
      "confidence": <0-100>, "reason": "<1 stavek>" }
  ]
}`;
}

function transformOpportunities(parsed: any, listings: any[]): any[] {
  if (!parsed?.opportunities) return [];
  return parsed.opportunities.map((opp: any) => {
    const idx = Math.max(0, Math.min(listings.length - 1, parseInt(opp?.itemIndex, 10) - 1));
    const listing = listings[idx];
    if (!listing) return null;

    const buyPriceEur = Math.max(1, Math.round(Number(opp?.buyPriceEur ?? listing.price ?? 0)));
    const sellPriceEur = Math.max(1, Math.round(Number(opp?.sellPriceEur ?? listing.aiEstimatedValue ?? buyPriceEur * 1.3)));
    const shippingEur = Math.max(0, Math.round(Number(opp?.shippingEur ?? 10)));
    const platformFeeEur = Math.round((sellPriceEur * 0.05 + 0.30) * 100) / 100;

    return {
      listingId: listing.id,
      title: String(opp?.title ?? listing.title).slice(0, 200),
      buyCountry: String(opp?.buyCountry ?? 'DE').slice(0, 2).toUpperCase(),
      sellCountry: 'SI',
      buyPriceEur, sellPriceEur, shippingEur, platformFeeEur,
      totalCostEur: Math.round((buyPriceEur + shippingEur + platformFeeEur) * 100) / 100,
      grossProfitEur: Math.round((sellPriceEur - buyPriceEur) * 100) / 100,
      confidence: Math.max(0, Math.min(100, parseInt(opp?.confidence ?? 50, 10) || 50)),
      reason: String(opp?.reason ?? '').slice(0, 300),
      category: listing.userNotes?.replace('[AI kategorija: ', '').replace(']', '') ?? null,
      imageUrl: listing.imageUrl,
      source: listing.monitor?.source ?? 'unknown',
      netProfitEur: 0, netRoiPct: 0,
    };
  }).filter(Boolean) as any[];
}

function calcNet(opp: any) {
  const netProfitEur = Math.round((opp.sellPriceEur - opp.totalCostEur) * 100) / 100;
  const netRoiPct = opp.totalCostEur > 0 ? Math.round((netProfitEur / opp.totalCostEur) * 100) : 0;
  return { netProfitEur, netRoiPct };
}
