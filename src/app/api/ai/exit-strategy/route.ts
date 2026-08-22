// v6.9 / v8.94-refactor: AI Exit Strategy — AI predlaga kdaj in kako prodati
// (postopna prodaja, bulk, čakanje)
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/exit-strategy
// Body: { tradeId: string }
// Returns: { ok, strategy: { recommendation, timing, pricing, alternatives, reasoning } }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface ExitStrategyInput {
  tradeId: string;
}

export const POST = withAiRoute<ExitStrategyInput>({
  endpoint: '/api/ai/exit-strategy',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { tradeId: String(body?.tradeId ?? '') };
  },

  validateInput: (input) => (input.tradeId ? null : 'tradeId je obvezen'),

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId } = input;

    // 1. Load trade
    const trade = await db.trade.findUnique({
      where: { id: tradeId },
      include: { listing: { select: { aiEstimatedValue: true, dealScore: true, aiVerdict: true, title: true, url: true, priceDroppedAt: true } } },
    });
    if (!trade) throw new ApiRouteError('Trade ne obstaja', 404);

    const now = new Date();
    const daysHeld = Math.round((now.getTime() - trade.buyDate.getTime()) / (24 * 60 * 60 * 1000));
    const buyCost = trade.buyPrice + (trade.buyFees ?? 0);

    // 2. Get market data
    const minP = Math.floor(trade.buyPrice * 0.7);
    const maxP = Math.ceil(trade.buyPrice * 1.4);
    const similar = await db.listing.findMany({
      where: { price: { gte: minP, lte: maxP }, isHidden: false, id: { not: trade.listingId ?? '' } },
      select: { price: true, firstSeenAt: true, title: true },
      take: 15,
    });
    const marketPrices = similar.map(l => l.price!).filter(Boolean);
    const marketAvg = marketPrices.length > 0 ? Math.round(marketPrices.reduce((a, b) => a + b, 0) / marketPrices.length) : Math.round(buyCost * 1.2);
    const marketMin = marketPrices.length > 0 ? Math.min(...marketPrices) : Math.round(buyCost * 0.9);
    const marketCount = marketPrices.length;

    // 3. Get category historical sell speed
    const catSold = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, category: trade.category || '' },
      select: { buyDate: true, sellDate: true, buyPrice: true, sellPrice: true },
      take: 20,
    });
    const avgDaysToSell = catSold.length > 0
      ? Math.round(catSold.filter(t => t.sellDate && t.buyDate).reduce((s, t) => s + (t.sellDate!.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000), 0) / Math.max(1, catSold.filter(t => t.sellDate).length))
      : 14;
    const avgCatROI = catSold.length > 0
      ? Math.round(catSold.reduce((s, t) => s + (((t.sellPrice ?? 0) - t.buyPrice) / t.buyPrice) * 100, 0) / catSold.length)
      : 20;

    // 4. Build prompt + call AI
    const prompt = buildPrompt({
      title: trade.title,
      category: trade.category || 'drugo',
      buyCost,
      daysHeld,
      aiEstimatedValue: trade.listing?.aiEstimatedValue ?? null,
      dealScore: trade.listing?.dealScore ?? null,
      marketAvg,
      marketMin,
      marketCount,
      avgDaysToSell,
      avgCatROI,
    });
    const raw = await callAi(prompt);

    // 5. Parse + transform
    const parsed: any = parseAi(raw);
    const strategy = transformStrategy(parsed, marketAvg);

    return apiOk({
      ok: true,
      strategy,
      trade: {
        title: trade.title, buyCost, daysHeld,
        aiValue: trade.listing?.aiEstimatedValue ?? null,
        marketAvg, marketMin, marketCount, avgDaysToSell, avgCatROI,
      },
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface PromptData {
  title: string;
  category: string;
  buyCost: number;
  daysHeld: number;
  aiEstimatedValue: number | null;
  dealScore: number | null;
  marketAvg: number;
  marketMin: number;
  marketCount: number;
  avgDaysToSell: number;
  avgCatROI: number;
}

function buildPrompt(d: PromptData): string {
  return `Si ekspert za izhodne strategije pri preprodaji na slovenskih oglasih.
Predlagaj optimalno izhodno strategijo za naslednji trade.

Item: ${d.title}
Kategorija: ${d.category}
Kupna cena: ${d.buyCost}€
Dni v skladišču: ${d.daysHeld}
AI tržna vrednost: ${d.aiEstimatedValue ?? '?'}€
Deal score: ${d.dealScore ?? '?'}

Tržni podatki:
- Povprečna tržna cena: ${d.marketAvg}€ (min: ${d.marketMin}€)
- Št. konkurenčnih oglasov: ${d.marketCount}
- Povp. dni do prodaje (kategorija): ${d.avgDaysToSell}d
- Povp. ROI (kategorija): ${d.avgCatROI}%

Predlagaj:
1. recommendation: sell_now / sell_soon / hold / bundle
2. timing: kdaj prodati (takoj / 1 teden / 2 tedna / počakaj na sezono)
3. pricing: optimalna prodajna cena in strategija (fiksna / pogajanje / dražba)
4. alternatives: alternative prodajne poti (Bolha, Vinted, Facebook, znanec)
5. reasoning: kratek razlog

Odgovori LE z JSON:
{
  "recommendation": "<sell_now|sell_soon|hold|bundle>",
  "timing": "<takoj|1_teden|2_tedna|počakaj_sezono>",
  "suggested_price": <number>,
  "pricing_strategy": "<fiksna|pogajanje|dražba>",
  "alternatives": ["<alt1>", "<alt2>"],
  "reasoning": "<max 200 znakov>",
  "confidence": <0-100>
}`;
}

function transformStrategy(parsed: any, marketAvg: number): {
  recommendation: string;
  timing: string;
  suggestedPrice: number;
  pricingStrategy: string;
  alternatives: string[];
  reasoning: string;
  confidence: number;
} {
  return {
    recommendation: String(parsed?.recommendation ?? 'hold'),
    timing: String(parsed?.timing ?? ''),
    suggestedPrice: parseInt(parsed?.suggested_price, 10) || Math.round(marketAvg * 0.95),
    pricingStrategy: String(parsed?.pricing_strategy ?? 'fiksna'),
    alternatives: Array.isArray(parsed?.alternatives) ? parsed.alternatives.slice(0, 5).map((a: any) => String(a).slice(0, 100)) : [],
    reasoning: String(parsed?.reasoning ?? '').slice(0, 300),
    confidence: Math.min(100, Math.max(0, parseInt(parsed?.confidence, 10) || 50)),
  };
}
