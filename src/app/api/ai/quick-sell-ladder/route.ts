// v7.50 / v8.94-refactor: Quick Sell Price Ladder — 3 price tiers for instant listing.
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// Generira 3 cene za takojšnjo objavo:
// - FAST (7d, 75% sell prob) — hitra prodaja, manjši profit
// - BALANCED (14d, 50% sell prob) — optimalno
// - PATIENT (30d, 30% sell prob) — max profit, dlje čaka
//
// POST /api/ai/quick-sell-ladder
// Body: { tradeId: string }
// Returns: { ok, trade, ladder, recommendedTier, reason, categoryStats }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface QuickSellLadderInput {
  tradeId: string;
}

export const POST = withAiRoute<QuickSellLadderInput>({
  endpoint: '/api/ai/quick-sell-ladder',
  maxDuration: 60,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { tradeId: String(body?.tradeId ?? '') };
  },

  validateInput: (input) => (input.tradeId ? null : 'tradeId je obvezen'),

  handler: async (input, ctx: AiRouteContext) => {
    const { db } = ctx;

    const trade = await db.trade.findUnique({
      where: { id: input.tradeId },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, status: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } },
      },
    });
    if (!trade) throw new ApiRouteError('Trade ne obstaja', 404);
    if (trade.status !== 'held') throw new ApiRouteError('Trade ni held — ni za prodajo', 400);

    const totalCost = trade.buyPrice + (trade.buyFees ?? 0);
    const estValue = trade.listing?.aiEstimatedValue ?? Math.round(totalCost * 1.25);
    const daysHeld = Math.floor((Date.now() - new Date(trade.buyDate).getTime()) / 86400000);

    // Get category avg sell price + avg hold from history
    const soldInCategory = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null }, category: trade.category || undefined },
      select: { buyPrice: true, sellPrice: true, buyDate: true, sellDate: true },
      take: 30,
    });

    const { catAvgMarkup, catAvgHoldDays } = computeCategoryStats(soldInCategory);

    // Build 3-tier ladder
    const ladder = buildLadder(estValue, totalCost);

    // Recommendation based on days held + category
    const { recommendedTier, reason } = pickRecommendedTier({
      daysHeld,
      dealScore: trade.listing?.dealScore ?? 0,
      catAvgHoldDays,
      catAvgMarkup,
      fastPrice: ladder.fast.priceEur,
      balancedPrice: ladder.balanced.priceEur,
      patientPrice: ladder.patient.priceEur,
    });

    return apiOk({
      ok: true,
      trade: { id: trade.id, title: trade.title, buyPrice: totalCost, estValue, daysHeld, category: trade.category },
      ladder,
      recommendedTier,
      reason,
      categoryStats: { avgHoldDays: catAvgHoldDays, avgMarkupPct: Math.round(catAvgMarkup * 100), sampleSize: soldInCategory.length },
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface SoldInCategoryRow {
  buyPrice: number;
  sellPrice: number | null;
  buyDate: Date | null;
  sellDate: Date | null;
}

function computeCategoryStats(soldTrades: SoldInCategoryRow[]): { catAvgMarkup: number; catAvgHoldDays: number } {
  if (soldTrades.length === 0) {
    // default 25% markup, 21d hold
    return { catAvgMarkup: 0.25, catAvgHoldDays: 21 };
  }
  const catAvgMarkup =
    soldTrades.reduce((s, t) => s + ((t.sellPrice! - t.buyPrice) / t.buyPrice), 0) / soldTrades.length;
  const catAvgHoldDays = Math.round(
    soldTrades.reduce(
      (s, t) => s + ((new Date(t.sellDate!).getTime() - new Date(t.buyDate!).getTime()) / 86400000),
      0
    ) / soldTrades.length
  );
  return { catAvgMarkup, catAvgHoldDays };
}

interface LadderTier {
  priceEur: number;
  profitEur: number;
  profitPct: number;
  expectedDays: number;
  sellProbabilityPct: number;
  strategy: string;
  bestFor: string;
}

function buildLadder(estValue: number, totalCost: number): {
  fast: LadderTier;
  balanced: LadderTier;
  patient: LadderTier;
} {
  const fastPrice = Math.round(estValue * 0.85); // 15% under est
  const balancedPrice = Math.round(estValue * 0.95); // 5% under est
  const patientPrice = Math.round(estValue * 1.05); // 5% over est

  return {
    fast: {
      priceEur: fastPrice,
      profitEur: fastPrice - totalCost,
      profitPct: totalCost > 0 ? Math.round(((fastPrice - totalCost) / totalCost) * 100) : 0,
      expectedDays: 7,
      sellProbabilityPct: 75,
      strategy: 'Hitra prodaja — nizka cena, visoka verjetnost',
      bestFor: '急需 cash / zastara',
    },
    balanced: {
      priceEur: balancedPrice,
      profitEur: balancedPrice - totalCost,
      profitPct: totalCost > 0 ? Math.round(((balancedPrice - totalCost) / totalCost) * 100) : 0,
      expectedDays: 14,
      sellProbabilityPct: 50,
      strategy: 'Optimalno — ravnovesje cena/čas',
      bestFor: 'Default — večina item-ov',
    },
    patient: {
      priceEur: patientPrice,
      profitEur: patientPrice - totalCost,
      profitPct: totalCost > 0 ? Math.round(((patientPrice - totalCost) / totalCost) * 100) : 0,
      expectedDays: 30,
      sellProbabilityPct: 30,
      strategy: 'Maksimalni profit — daljši čakalni čas',
      bestFor: 'Redki item-i, visoka povpraševanja',
    },
  };
}

interface RecommendationParams {
  daysHeld: number;
  dealScore: number;
  catAvgHoldDays: number;
  catAvgMarkup: number;
  fastPrice: number;
  balancedPrice: number;
  patientPrice: number;
}

function pickRecommendedTier(params: RecommendationParams): {
  recommendedTier: 'fast' | 'balanced' | 'patient';
  reason: string;
} {
  const { daysHeld, dealScore, catAvgHoldDays, catAvgMarkup, fastPrice, balancedPrice, patientPrice } = params;

  if (daysHeld > 45) {
    return {
      recommendedTier: 'fast',
      reason: `${daysHeld}d v inventarju — prodajaj HITRO (FAST ${fastPrice}€) za sprostitev capital.`,
    };
  }
  if (daysHeld > 30) {
    return {
      recommendedTier: 'balanced',
      reason: `${daysHeld}d — BALANCED (${balancedPrice}€) je optimalno. Ne čakaj predolgo.`,
    };
  }
  if (daysHeld <= 7 && dealScore > 80) {
    return {
      recommendedTier: 'patient',
      reason: `Fresh + visok deal score — PATIENT (${patientPrice}€) za max profit. Lahko čakaš.`,
    };
  }
  return {
    recommendedTier: 'balanced',
    reason: `BALANCED (${balancedPrice}€) — optimalno za ${daysHeld}d hold. Avg kategorija: ${catAvgHoldDays}d, markup ${Math.round(catAvgMarkup * 100)}%.`,
  };
}
