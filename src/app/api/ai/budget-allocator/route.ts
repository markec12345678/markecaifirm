// v6.6 / v8.95.3-batch1: AI Budget Allocator — AI predlaga razporeditev proračuna po kategorijah
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/budget-allocator
// Body: { totalBudget: number }
// Returns: { ok, allocation: Array<{ category, suggestedBudget, expectedROI, expectedProfit, reasoning }>, strategy }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BudgetAllocatorInput {
  totalBudget: number;
}

interface CategoryStats {
  sold: number;
  held: number;
  totalProfit: number;
  totalInvested: number;
  avgRoi: number;
  avgDays: number;
}

interface MarketStats {
  count: number;
  avgPrice: number;
  prilikaCount: number;
}

interface TradeRow {
  category: string | null;
  status: string;
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  buyDate: Date | null;
  sellDate: Date | null;
}

interface ListingRow {
  price: number | null;
  title: string;
  aiVerdict: string | null;
  dealScore: number | null;
}

export const POST = withAiRoute<BudgetAllocatorInput>({
  endpoint: '/api/ai/budget-allocator',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { totalBudget: Number(body?.totalBudget) || 0 };
  },

  validateInput: (input) => (input.totalBudget > 0 ? null : 'Proračun mora biti > 0'),

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { totalBudget } = input;

    // 1. Get niche profitability data
    const trades = await db.trade.findMany({
      where: { status: { in: ['held', 'sold'] } },
      select: {
        category: true, status: true, buyPrice: true, buyFees: true,
        sellPrice: true, sellFees: true, buyDate: true, sellDate: true,
      },
    });

    // 2. Get current listings by category for market analysis
    const listings = await db.listing.findMany({
      where: {
        price: { not: null },
        isHidden: false,
        firstSeenAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      select: { price: true, title: true, aiVerdict: true, dealScore: true },
      take: 500,
    });

    // 3. Calculate category stats from trades + market opportunities
    const catStats = computeCategoryStats(trades);
    const marketByCat = computeMarketOpportunities(listings);

    // 4. AI allocation
    const prompt = buildPrompt(totalBudget, catStats, marketByCat);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const allocation = (parsed?.allocation || []).map((a: any) => ({
      category: String(a?.category ?? ''),
      suggestedBudget: Number(a?.suggested_budget ?? 0),
      percentage: Number(a?.percentage ?? 0),
      expectedROI: Number(a?.expected_roi ?? 0),
      expectedProfit: Number(a?.expected_profit ?? 0),
      reasoning: String(a?.reasoning ?? '').slice(0, 200),
    }));

    return apiOk({
      ok: true,
      allocation,
      strategy: String(parsed?.strategy ?? '').slice(0, 500),
      reserveAmount: Number(parsed?.reserve_amount ?? 0),
      totalExpectedProfit: Number(parsed?.total_expected_profit ?? 0),
      totalBudget,
      categoryStats: Object.entries(catStats).map(([cat, s]) => ({ category: cat, ...s })),
      marketOpportunities: Object.entries(marketByCat).map(([cat, m]) => ({ category: cat, ...m })),
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function extractCat(title: string): string {
  const t = title.toLowerCase();
  if (/(iphone|samsung|telefon|laptop|macbook|pc|računalnik|konzola|ps5|xbox|tv)/.test(t)) return 'elektronika';
  if (/(avto|vozilo|golf|audi|bmw|toyota)/.test(t)) return 'avto';
  if (/(stanovanje|hiša|hisa|zemljišče)/.test(t)) return 'nepremicnine';
  if (/(orodje|bosch|makita|dewalt)/.test(t)) return 'orodje';
  if (/(hlače|majica|jakna|čevlji|nike|adidas)/.test(t)) return 'moda';
  if (/(smuči|kolo|fitnes|žoga)/.test(t)) return 'sport';
  if (/(miza|stol|omara|postelja)/.test(t)) return 'pohistvo';
  return 'drugo';
}

function computeCategoryStats(trades: TradeRow[]): Record<string, CategoryStats> {
  const catStats: Record<string, CategoryStats> = {};
  for (const t of trades) {
    const cat = t.category || 'drugo';
    if (!catStats[cat]) {
      catStats[cat] = { sold: 0, held: 0, totalProfit: 0, totalInvested: 0, avgRoi: 0, avgDays: 0 };
    }
    const buyCost = t.buyPrice + (t.buyFees ?? 0);
    if (t.status === 'sold') {
      catStats[cat].sold++;
      const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - buyCost;
      catStats[cat].totalProfit += profit;
      catStats[cat].totalInvested += buyCost;
      if (t.sellDate && t.buyDate) {
        catStats[cat].avgDays += Math.round(
          (t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000)
        );
      }
    } else {
      catStats[cat].held++;
      catStats[cat].totalInvested += buyCost;
    }
  }

  // Calculate ROI per category
  for (const cat of Object.keys(catStats)) {
    const s = catStats[cat];
    s.avgRoi = s.totalInvested > 0 ? Math.round((s.totalProfit / s.totalInvested) * 100) : 0;
    s.avgDays = s.sold > 0 ? Math.round(s.avgDays / s.sold) : 0;
  }
  return catStats;
}

function computeMarketOpportunities(listings: ListingRow[]): Record<string, MarketStats> {
  const marketByCat: Record<string, MarketStats> = {};
  for (const l of listings) {
    const cat = extractCat(l.title);
    if (!marketByCat[cat]) marketByCat[cat] = { count: 0, avgPrice: 0, prilikaCount: 0 };
    marketByCat[cat].count++;
    marketByCat[cat].avgPrice += l.price ?? 0;
    if (l.aiVerdict === 'PRILIKA') marketByCat[cat].prilikaCount++;
  }
  for (const cat of Object.keys(marketByCat)) {
    marketByCat[cat].avgPrice =
      marketByCat[cat].count > 0 ? Math.round(marketByCat[cat].avgPrice / marketByCat[cat].count) : 0;
  }
  return marketByCat;
}

function buildPrompt(
  totalBudget: number,
  catStats: Record<string, CategoryStats>,
  marketByCat: Record<string, MarketStats>
): string {
  return `Si ekspert za upravljanje proračuna za preprodajo na slovenskih oglasih.
Razporedi ${totalBudget}€ proračuna po kategorijah za maksimalni dobiček.

Zgodovinski podatki po kategorijah:
${Object.entries(catStats).map(([cat, s]) => `- ${cat}: ${s.sold} prodaj, ${s.held} v skladišču, ROI ${s.avgRoi}%, povp. ${s.avgDays}d do prodaje, dobiček ${Math.round(s.totalProfit)}€`).join('\n')}

Tržne priložnosti (zadnjih 30 dni):
${Object.entries(marketByCat).map(([cat, m]) => `- ${cat}: ${m.count} oglasov, povp. cena ${m.avgPrice}€, ${m.prilikaCount} PRILIKA`).join('\n')}

Pravila:
1. Kategorije z visokim ROI in hitro prodajo dobijo večji delež
2. Kategorije z veliko PRILIKA oglasov dobijo večji delež
3. Kategorije z negativnim ROI dobijo 0%
4. Rezerviraj 10% proračuna za nepričakovane priložnosti
5. Skupni znesek mora biti enak ${totalBudget}€

Odgovori LE z JSON:
{
  "strategy": "<splošna strategija v 1-2 stavkih>",
  "allocation": [
    {
      "category": "<kategorija>",
      "suggested_budget": <number EUR>,
      "percentage": <number %>,
      "expected_roi": <number %>,
      "expected_profit": <number EUR>,
      "reasoning": "<kratek razlog, max 100 znakov>"
    }
  ],
  "reserve_amount": <number EUR>,
  "total_expected_profit": <number EUR>
}`;
}
