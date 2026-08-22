// v6.11 / v8.95.9-refactor: AI Cross-Border Arbitrage — AI primerja cene med slovenskimi in tujimi trgi
// Refaktoriran z withAiRoute helperjem (v8.95.9) + enforceBudget guard.
//
// POST /api/ai/cross-border
// Body: { query?: string, category?: string, maxBudget?: number }
// Returns: { ok, opportunities: Array<{ item, slovenianPrice, foreignPrices: [{ country, marketplace, price, shipping, totalCost, url }], arbitrage: { buyIn, sellIn, grossMargin, netMargin, roi, fees }, feasibility, risk, action }>, insights }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// Tuji trgi, ki jih AI upošteva
const FOREIGN_MARKETS = [
  { country: 'DE', marketplace: 'Kleinanzeigen (eBay Kleinanzeigen)', currency: 'EUR', shippingEur: 15 },
  { country: 'IT', marketplace: 'Subito.it', currency: 'EUR', shippingEur: 20 },
  { country: 'HR', marketplace: 'Njuškalo', currency: 'EUR', shippingEur: 10 },
  { country: 'AT', marketplace: 'Willhaben', currency: 'EUR', shippingEur: 12 },
  { country: 'PL', marketplace: 'OLX.pl', currency: 'EUR', shippingEur: 18 },
  { country: 'FR', marketplace: 'Leboncoin', currency: 'EUR', shippingEur: 25 },
];

interface CrossBorderInput {
  query: string;
  category: string;
  maxBudget: number;
}

export const POST = withAiRoute<CrossBorderInput>({
  endpoint: '/api/ai/cross-border',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      query: String(body?.query || '').trim(),
      category: String(body?.category || '').trim(),
      maxBudget: Number(body?.maxBudget) || 0,
    };
  },

  // No validateInput — vsi input-i imajo defaults

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { query, categoryFilter, maxBudget } = {
      query: input.query,
      categoryFilter: input.category,
      maxBudget: input.maxBudget,
    };
    void maxBudget; // maxBudget je trenutno nespremenljiv v logiki (za backward compat)

    // 1. Pridobi nedavne PRILIKA oglase iz slovenskih virov
    const recentOpportunities = await db.listing.findMany({
      where: {
        isHidden: false,
        firstSeenAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        OR: [
          { aiVerdict: 'PRILIKA' },
          { dealScore: { gte: 70 } },
        ],
        ...(query ? { title: { contains: query } } : {}),
        price: { gt: 0 },
      },
      select: {
        id: true, title: true, price: true, location: true,
        aiVerdict: true, aiEstimatedValue: true, dealScore: true, firstSeenAt: true,
        monitor: { select: { source: true, name: true } },
      },
      take: 30,
      orderBy: { dealScore: 'desc' },
    });

    if (recentOpportunities.length === 0) {
      return apiOk({
        ok: true,
        opportunities: [],
        message: 'Ni dovolj priložnosti za cross-border analizo.',
      });
    }

    // 2. Pridobi prodajno zgodovino za kontekst (kaj se je dobro prodajalo)
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { title: true, category: true, buyPrice: true, sellPrice: true, buyLocation: true, sellLocation: true },
      take: 50,
    });

    const soldCategories = [...new Set(soldTrades.map(t => t.category || 'drugo'))];

    // 3. Pripravi kandidate za AI analizo
    const candidates = recentOpportunities.slice(0, 15).map(l => ({
      id: l.id,
      title: l.title,
      slovenianPrice: l.price ?? 0,
      estValue: l.aiEstimatedValue ?? l.price ?? 0,
      source: l.monitor?.source || 'bolha',
      location: l.location,
      dealScore: l.dealScore ?? 0,
      category: categoryFilter || '',
    }));

    // 4. AI cross-border analiza
    const prompt = buildPrompt(candidates, soldCategories);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const opportunities = transformOpportunities(parsed, candidates);

    // Summary
    const exportOps = opportunities.filter(o => o.arbitrage.strategy === 'export');
    const importOps = opportunities.filter(o => o.arbitrage.strategy === 'import');
    const totalNetMargin = opportunities.reduce((s, o) => s + o.arbitrage.netMargin, 0);
    const avgROI = opportunities.length > 0
      ? Math.round(opportunities.reduce((s, o) => s + o.arbitrage.roiPct, 0) / opportunities.length)
      : 0;

    return apiOk({
      ok: true,
      insights: String(parsed?.insights ?? '').slice(0, 600),
      opportunities,
      summary: {
        totalOpportunities: opportunities.length,
        exportOps: exportOps.length,
        importOps: importOps.length,
        totalNetMargin,
        avgROI,
        foreignMarkets: FOREIGN_MARKETS.length,
      },
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface Candidate {
  id: string;
  title: string;
  slovenianPrice: number;
  estValue: number;
  source: string;
  location: string | null;
  dealScore: number;
  category: string;
}

function buildPrompt(candidates: Candidate[], soldCategories: string[]): string {
  return `Si ekspert za cross-border arbitražo pri preprodaji rabljenih dobrin v Evropi.
Analiziraj te slovenske priložnosti in oceni, ali jih je vredno kupiti v Sloveniji ter prodati v tujini (ali obratno).

Slovenske priložnosti:
${candidates.map(c => `- [${c.id}] ${c.title} | cena SI: ${c.slovenianPrice}€ | est. vrednost: ${c.estValue}€ | vir: ${c.source} | deal score: ${c.dealScore}`).join('\n')}

Tuji trgi za primerjavo:
${FOREIGN_MARKETS.map(m => `- ${m.country}: ${m.marketplace} (približni shipping ${m.shippingEur}€)`).join('\n')}

Kategorije, ki si jih v preteklosti uspešno prodal:
${soldCategories.join(', ') || 'neznan'}

Pravila:
1. Za vsak item oceni realno tržno ceno v vsakem tujem trgu
2. Upoštevaj: shipping, carnet/ddv (za dragocene iteme), provizija platforme (10-15%)
3. Dobiček mora biti > 15% po odbitku vseh stroškov
4. Opozori na jezikovne/pravne ovire (npr. davčne obveznosti)
5. Predlagaj najboljši vir (buyIn) in najboljši trg (sellIn)
6. Risk oceni: 1-10 (1=varno, 10=visoko tvegano)

Strategije:
- "import": kupi v tujini (ceneje), prodaj v SI
- "export": kupi v SI (ceneje), prodaj v tujini
- "domestic_only": ni arbitraže, samo SI→SI
- "wait": počakaj na boljšo ceno

Odgovori LE z JSON:
{
  "insights": "<splošne ugotovitve o cross-border priložnostih, max 300 znakov>",
  "opportunities": [
    {
      "id": "<listing_id>",
      "title": "<naslov>",
      "slovenian_price": <number>,
      "estimated_value": <number>,
      "foreign_prices": [
        {
          "country": "DE",
          "marketplace": "<ime>",
          "price": <number>,
          "shipping": <number>,
          "total_cost": <number>,
          "estimated_sell_price": <number>
        }
      ],
      "arbitrage": {
        "strategy": "<import|export|domestic_only|wait>",
        "buy_in": "<SI|DE|HR|...>",
        "sell_in": "<SI|DE|HR|...>",
        "buy_price": <number>,
        "sell_price": <number>,
        "shipping_cost": <number>,
        "platform_fee": <number>,
        "gross_margin": <number>,
        "net_margin": <number>,
        "roi_pct": <number>
      },
      "feasibility": "<easy|medium|hard>",
      "risk": <number>,
      "action": "<konkretno dejanje, max 150 znakov>",
      "reasoning": "<zakaj, max 150 znakov>"
    }
  ]}`;
}

function transformOpportunities(parsed: any, candidates: Candidate[]): any[] {
  const validIds = new Set(candidates.map(c => c.id));
  const candidateMap = new Map(candidates.map(c => [c.id, c]));

  return (parsed?.opportunities || [])
    .filter((o: any) => validIds.has(String(o?.id ?? '')))
    .map((o: any) => {
      const id = String(o.id);
      const orig = candidateMap.get(id)!;
      const foreignPrices = (Array.isArray(o?.foreign_prices) ? o.foreign_prices : []).slice(0, 6).map((f: any) => ({
        country: String(f?.country ?? '').slice(0, 5),
        marketplace: String(f?.marketplace ?? '').slice(0, 50),
        price: Math.max(0, Number(f?.price ?? 0)),
        shipping: Math.max(0, Number(f?.shipping ?? 0)),
        totalCost: Math.max(0, Number(f?.total_cost ?? 0)),
        estimatedSellPrice: Math.max(0, Number(f?.estimated_sell_price ?? 0)),
      }));
      const arb = o?.arbitrage ?? {};
      return {
        id,
        title: orig.title,
        slovenianPrice: orig.slovenianPrice,
        estimatedValue: orig.estValue,
        dealScore: orig.dealScore,
        source: orig.source,
        foreignPrices,
        arbitrage: {
          strategy: ['import', 'export', 'domestic_only', 'wait'].includes(String(arb?.strategy))
            ? String(arb.strategy) : 'domestic_only',
          buyIn: String(arb?.buy_in ?? 'SI').slice(0, 5),
          sellIn: String(arb?.sell_in ?? 'SI').slice(0, 5),
          buyPrice: Math.max(0, Number(arb?.buy_price ?? 0)),
          sellPrice: Math.max(0, Number(arb?.sell_price ?? 0)),
          shippingCost: Math.max(0, Number(arb?.shipping_cost ?? 0)),
          platformFee: Math.max(0, Number(arb?.platform_fee ?? 0)),
          grossMargin: Math.round(Number(arb?.gross_margin ?? 0)),
          netMargin: Math.round(Number(arb?.net_margin ?? 0)),
          roiPct: Math.round(Number(arb?.roi_pct ?? 0)),
        },
        feasibility: ['easy', 'medium', 'hard'].includes(String(o?.feasibility))
          ? String(o.feasibility) : 'medium',
        risk: Math.max(1, Math.min(10, Number(o?.risk ?? 5))),
        action: String(o?.action ?? '').slice(0, 250),
        reasoning: String(o?.reasoning ?? '').slice(0, 250),
      };
    })
    .filter((o: any) => o.arbitrage.strategy !== 'wait' || o.arbitrage.netMargin > 0);
}
