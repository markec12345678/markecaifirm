/**
 * @deprecated v8.94 — uporabi `/api/ai/profit-maximizer-pro` namesto tega.
 * Ta endpoint bo odstranjen v v9.0. Glej ENDPOINTS_AUDIT.md za migracijski načrt.
 */
// v7.35 / v8.96.1-refactor: Profit Maximizer — optimal sell price for held inventory.
// Refaktoriran z withAiRoute helperjem (v8.96.1) + enforceBudget guard.
// logDeprecatedCall PRESERVED iz originala (Phase 2 deprecation logging — kliče ctx.req).
//
// For each held trade, AI calculates:
// - 3 pricing scenarios (fast / balanced / premium)
// - Sell probability per scenario (based on category history)
// - Expected profit (price × probability - holding cost)
// - Recommended price + listing strategy
//
// Body: { tradeId: string } — analyze single held trade
// Returns: { ok, analysis: { scenarios, recommendation, urgency } }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';
import { logDeprecatedCall } from '@/lib/deprecated-redirect';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface PricingScenario {
  strategy: 'fast' | 'balanced' | 'premium';
  priceEur: number;
  sellProbability7d: number;
  sellProbability30d: number;
  expectedProfitEur: number;
  holdingCostEur: number;
  netProfitEur: number;
  reasoning: string;
}

interface ProfitMaximizerInput {
  tradeId: string;
}

export const POST = withAiRoute<ProfitMaximizerInput>({
  endpoint: '/api/ai/profit-maximizer',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { tradeId: String(body?.tradeId ?? '') };
  },

  validateInput: (input) => (input.tradeId ? null : 'tradeId je obvezen'),

  handler: async (input, ctx: AiRouteContext) => {
    // PRESERVED iz originala — Phase 2 deprecation logging.
    logDeprecatedCall('/api/ai/profit-maximizer', ctx.req, '/api/ai/profit-maximizer-pro');

    const { db, callAi, parseAi } = ctx;
    const { tradeId } = input;

    const trade = await db.trade.findUnique({
      where: { id: String(tradeId) },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true,
        buyDate: true, status: true, imageUrl: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, description: true } },
      },
    });

    if (!trade) {
      throw new ApiRouteError('Trade ne obstaja', 404);
    }

    if (trade.status !== 'held') {
      return apiBadRequest('Trade ni v statusu "held" — ni potrebe po ceni prodaje');
    }

    // Days held
    const daysHeld = Math.floor((Date.now() - new Date(trade.buyDate).getTime()) / 86400000);
    const totalCost = trade.buyPrice + (trade.buyFees ?? 0);

    // Get category history for probability estimation
    const soldInCategory = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        sellDate: { not: null },
        category: trade.category || undefined,
      },
      select: { buyPrice: true, sellPrice: true, buyDate: true, sellDate: true },
      take: 50,
    });

    const categoryStats = computeCategoryStats(soldInCategory);

    const estValue = trade.listing?.aiEstimatedValue ?? Math.round(trade.buyPrice * 1.25);

    const prompt = buildPrompt({
      title: trade.title,
      category: trade.category || 'neznan',
      totalCost,
      estValue,
      daysHeld,
      dealScore: trade.listing?.dealScore ?? null,
      categoryStats,
    });
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const holdingCostEur = Math.round(0.50 * daysHeld * 100) / 100;

    let scenarios: PricingScenario[] = transformScenarios(parsed, totalCost, holdingCostEur);

    if (scenarios.length < 3) {
      // Fallback: generate 3 scenarios based on estValue
      scenarios = generateFallbackScenarios(estValue, totalCost, holdingCostEur);
    }

    const recommendedStrategy = ['fast', 'balanced', 'premium'].includes(String(parsed?.recommended_strategy))
      ? String(parsed.recommended_strategy) : 'balanced';
    const urgency = ['sell_fast', 'sell_balanced', 'hold', 'cut_losses'].includes(String(parsed?.urgency))
      ? String(parsed.urgency) : 'sell_balanced';

    return apiOk({
      ok: true,
      analysis: {
        trade: {
          id: trade.id,
          title: trade.title,
          category: trade.category,
          buyPrice: trade.buyPrice,
          totalCost,
          daysHeld,
          holdingCostEur,
          estValue,
        },
        scenarios,
        recommendedStrategy,
        urgency,
        summary: String(parsed?.summary ?? '').slice(0, 300),
      },
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface CategoryStats {
  count: number;
  avgMarkupPct: number;
  avgHoldDays: number;
  priceRange: { min: number; max: number };
}

function computeCategoryStats(
  soldInCategory: Array<{ buyPrice: number; sellPrice: number | null; buyDate: Date; sellDate: Date | null }>
): CategoryStats | null {
  if (soldInCategory.length === 0) return null;
  return {
    count: soldInCategory.length,
    avgMarkupPct: Math.round((soldInCategory.reduce((s, t) => s + ((t.sellPrice ?? 0) - t.buyPrice) / t.buyPrice, 0) / soldInCategory.length) * 100),
    avgHoldDays: Math.round(soldInCategory.reduce((s, t) => s + (new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / 86400000, 0) / soldInCategory.length),
    priceRange: {
      min: Math.min(...soldInCategory.map(t => t.sellPrice!)),
      max: Math.max(...soldInCategory.map(t => t.sellPrice!)),
    },
  };
}

interface PromptData {
  title: string;
  category: string;
  totalCost: number;
  estValue: number;
  daysHeld: number;
  dealScore: number | null;
  categoryStats: CategoryStats | null;
}

function buildPrompt(d: PromptData): string {
  return `Si ekspert za določanje optimalnih cen za prodajo rabljenih dobrin na slovenskih oglasnih platformah (Bolha, Vinted).

Analiziraj ta held item in določi 3 cenovne strategije:

ITEM:
- Naslov: ${d.title}
- Kategorija: ${d.category}
- Nabavna cena: ${d.totalCost}€ (vključno s fees)
- AI ocenjena vrednost: ${d.estValue}€
- Dni v inventarju: ${d.daysHeld}
- Deal score: ${d.dealScore ?? 'N/A'}

${d.categoryStats ? `ZGODOVINA KATEGORIJE (${d.categoryStats.count} prodaj):
- Povprečni markup: ${d.categoryStats.avgMarkupPct}%
- Povprečni hold čas: ${d.categoryStats.avgHoldDays} dni
- Razpon cen: ${d.categoryStats.priceRange.min}€ - ${d.categoryStats.priceRange.max}€
` : 'ZGODOVINA KATEGORIJE: Ni podatkov (prva prodaja v tej kategoriji).'}

CILJ: Maksimiziraj NET profit = (prodajna cena - nabavna cena - holding cost) × verjetnost prodaje

Holding cost = 0.50€/dan (capital cost + depreciation) × dni od nakupa

Tri strategije:
1. FAST: hitra prodaja v 7 dneh (nizka cena, visoka verjetnost)
2. BALANCED: prodaja v 14-21 dneh (srednja cena, srednja verjetnost)
3. PREMIUM: maksimalni profit, prodaja lahko traja 30+ dni (visoka cena, nižja verjetnost)

Za vsako strategijo določi:
- price_eur: predlagana cena (EUR)
- sell_probability_7d: verjetnost prodaje v 7 dneh (0-100%)
- sell_probability_30d: verjetnost prodaje v 30 dneh (0-100%)
- expected_profit_eur: (cena - nabavna - holding) × verjetnost_30d
- reasoning: 1 stavek zakaj ta cena

Nato določi:
- recommended_strategy: katera strategija maksimizira expected profit
- urgency: 'sell_fast' | 'sell_balanced' | 'hold' | 'cut_losses'

Odgovori LE z JSON:
{
  "scenarios": [
    { "strategy": "fast", "price_eur": <number>, "sell_probability_7d": <number>, "sell_probability_30d": <number>, "expected_profit_eur": <number>, "reasoning": "<string>" },
    { "strategy": "balanced", "price_eur": <number>, "sell_probability_7d": <number>, "sell_probability_30d": <number>, "expected_profit_eur": <number>, "reasoning": "<string>" },
    { "strategy": "premium", "price_eur": <number>, "sell_probability_7d": <number>, "sell_probability_30d": <number>, "expected_profit_eur": <number>, "reasoning": "<string>" }
  ],
  "recommended_strategy": "<fast|balanced|premium>",
  "urgency": "<sell_fast|sell_balanced|hold|cut_losses>",
  "summary": "<1-2 stavka povzetek>"
}`;
}

function transformScenarios(parsed: any, totalCost: number, holdingCostEur: number): PricingScenario[] {
  return (parsed?.scenarios || []).map((s: any) => {
    const priceEur = Math.max(1, Math.round(Number(s?.price_eur ?? 0)));
    const sellProb7d = Math.max(0, Math.min(100, Number(s?.sell_probability_7d ?? 50)));
    const sellProb30d = Math.max(0, Math.min(100, Number(s?.sell_probability_30d ?? 70)));
    const expectedProfitEur = Math.round((priceEur - totalCost - holdingCostEur) * (sellProb30d / 100) * 100) / 100;
    const netProfitEur = Math.round((priceEur - totalCost - holdingCostEur) * 100) / 100;

    return {
      strategy: s?.strategy === 'fast' ? 'fast' : s?.strategy === 'premium' ? 'premium' : 'balanced',
      priceEur,
      sellProbability7d: sellProb7d,
      sellProbability30d: sellProb30d,
      expectedProfitEur,
      holdingCostEur,
      netProfitEur,
      reasoning: String(s?.reasoning ?? '').slice(0, 200),
    };
  });
}

function generateFallbackScenarios(estValue: number, totalCost: number, holdingCostEur: number): PricingScenario[] {
  const fast = Math.round(estValue * 0.85);
  const balanced = Math.round(estValue * 1.00);
  const premium = Math.round(estValue * 1.15);
  const scenarios: PricingScenario[] = [];
  for (const [strat, price] of [['fast', fast], ['balanced', balanced], ['premium', premium]] as const) {
    const prob30 = strat === 'fast' ? 90 : strat === 'balanced' ? 65 : 35;
    scenarios.push({
      strategy: strat,
      priceEur: price,
      sellProbability7d: strat === 'fast' ? 70 : strat === 'balanced' ? 30 : 10,
      sellProbability30d: prob30,
      expectedProfitEur: Math.round((price - totalCost - holdingCostEur) * (prob30 / 100) * 100) / 100,
      holdingCostEur,
      netProfitEur: Math.round((price - totalCost - holdingCostEur) * 100) / 100,
      reasoning: `${strat === 'fast' ? 'Hitra prodaja' : strat === 'balanced' ? 'Balansirano' : 'Premium cena'} — ${price}€`,
    });
  }
  return scenarios;
}
