// v7.38 / v8.95.5-other: Deal Score Calibrator — preveri ali so AI deal score-i dejansko točni.
// Refaktoriran z withAiRoute helperjem (v8.95.5-other) + enforceBudget guard
// (konsistentno z vsemi v8.94.x / v8.95.x migracijami — endpoint ne kliče AI
// providerja, je deterministic; vendar ohranjamo guard za konsistentnost).
//
// THE meta-optimization: if AI deal scores are miscalibrated, everything suffers.
// - Too high → false positives → wasted time on bad deals
// - Too low → missed deals → lost profit
//
// POST /api/ai/deal-score-calibrator
// Body: {} (uses all historical data)
// Returns: {
//   ok,
//   accuracy: { overallPct, byScoreRange: [{ range, total, bought, profitable, accuracyPct }] },
//   calibration: { overrated: [{ score, actualOutcome }], underrated: [{ score, actualOutcome }] },
//   recommendation: string,
//   promptAdjustments: string[]
// }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Input {}

interface ListingRow {
  id: string;
  title: string;
  dealScore: number | null;
  aiScore: number | null;
  aiVerdict: string | null;
  aiEstimatedValue: number | null;
  price: number | null;
  trades: Array<{
    buyPrice: number;
    buyFees: number | null;
    sellPrice: number | null;
    sellFees: number | null;
    status: string;
    sellDate: Date | null;
  }>;
}

type ScoredItem = {
  dealScore: number;
  aiScore: number;
  aiVerdict: string;
  outcome: 'profitable' | 'loss' | 'held' | 'unsold';
  profit: number | null;
  buyPrice: number;
};

interface ByScoreRange {
  range: string;
  total: number;
  bought: number;
  profitable: number;
  accuracyPct: number;
  avgProfit: number;
}

const SCORE_RANGES: ReadonlyArray<{ label: string; min: number; max: number }> = [
  { label: '90-100', min: 90, max: 100 },
  { label: '80-89', min: 80, max: 89 },
  { label: '70-79', min: 70, max: 79 },
  { label: '50-69', min: 50, max: 69 },
  { label: '0-49', min: 0, max: 49 },
];

export const POST = withAiRoute<Input>({
  endpoint: '/api/ai/deal-score-calibrator',
  maxDuration: 90,
  enforceBudget: true, // v8.95.5-other: budget guard (konsistentno z vsemi AI route-i)

  parseBody: async () => ({}),

  // No validateInput — body ni uporabljen

  handler: async (_input, ctx: AiRouteContext) => {
    const { db } = ctx;

    // Get all listings that were bought (have a trade) with dealScore
    const listingsWithTrades = await db.listing.findMany({
      where: {
        dealScore: { not: null },
        isHidden: false,
        trades: { some: {} },
      },
      select: {
        id: true,
        title: true,
        dealScore: true,
        aiScore: true,
        aiVerdict: true,
        aiEstimatedValue: true,
        price: true,
        trades: {
          select: {
            buyPrice: true,
            buyFees: true,
            sellPrice: true,
            sellFees: true,
            status: true,
            sellDate: true,
          },
        },
      },
      take: 500,
    });

    if (listingsWithTrades.length < 3) {
      return apiOk({
        ok: true,
        accuracy: null,
        message: 'Potrebnih vsaj 3 kupljena oglasa z deal score za kalibracijo. Kupi več item-ov in ponovi.',
      });
    }

    // Compute outcome for each listing
    const scored = computeScored(listingsWithTrades);

    // Overall accuracy: of items scored 70+, what % were profitable?
    const highScore = scored.filter(s => s.dealScore >= 70);
    const highScoreSold = highScore.filter(s => s.outcome === 'profitable' || s.outcome === 'loss');
    const highScoreProfitable = highScoreSold.filter(s => s.outcome === 'profitable');
    const overallAccuracy = highScoreSold.length > 0 ? Math.round((highScoreProfitable.length / highScoreSold.length) * 100) : 0;

    // By score range
    const byScoreRange = computeByScoreRange(scored);

    // Overrated: high score but lost money
    const overrated = scored
      .filter(s => s.dealScore >= 70 && s.outcome === 'loss')
      .sort((a, b) => b.dealScore - a.dealScore)
      .slice(0, 5);

    // Underrated: low score but profitable
    const underrated = scored
      .filter(s => s.dealScore < 60 && s.outcome === 'profitable')
      .sort((a, b) => a.dealScore - b.dealScore)
      .slice(0, 5);

    // Generate recommendation + prompt adjustments
    const { recommendation, promptAdjustments } = buildRecommendation(
      overallAccuracy,
      overrated,
      underrated,
      byScoreRange,
    );

    return apiOk({
      ok: true,
      accuracy: {
        overallPct: overallAccuracy,
        sampleSize: highScoreSold.length,
        totalScored: scored.length,
        byScoreRange,
      },
      calibration: {
        overrated: overrated.map(s => ({ dealScore: s.dealScore, outcome: s.outcome, profit: s.profit })),
        underrated: underrated.map(s => ({ dealScore: s.dealScore, outcome: s.outcome, profit: s.profit })),
      },
      recommendation,
      promptAdjustments,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function computeScored(listings: ListingRow[]): ScoredItem[] {
  return listings.map(l => {
    const trade = l.trades[0];
    if (!trade) {
      return {
        dealScore: l.dealScore ?? 0,
        aiScore: l.aiScore ?? 0,
        aiVerdict: l.aiVerdict ?? '',
        outcome: 'unsold' as const,
        profit: null,
        buyPrice: l.price ?? 0,
      };
    }

    if (trade.status === 'sold' && trade.sellPrice != null) {
      const profit = trade.sellPrice - (trade.sellFees ?? 0) - trade.buyPrice - (trade.buyFees ?? 0);
      return {
        dealScore: l.dealScore ?? 0,
        aiScore: l.aiScore ?? 0,
        aiVerdict: l.aiVerdict ?? '',
        outcome: profit > 0 ? ('profitable' as const) : ('loss' as const),
        profit,
        buyPrice: trade.buyPrice,
      };
    }
    return {
      dealScore: l.dealScore ?? 0,
      aiScore: l.aiScore ?? 0,
      aiVerdict: l.aiVerdict ?? '',
      outcome: 'held' as const,
      profit: null,
      buyPrice: trade.buyPrice,
    };
  });
}

function computeByScoreRange(scored: ScoredItem[]): ByScoreRange[] {
  return SCORE_RANGES.map(r => {
    const inRange = scored.filter(s => s.dealScore >= r.min && s.dealScore <= r.max);
    const sold = inRange.filter(s => s.outcome === 'profitable' || s.outcome === 'loss');
    const profitable = sold.filter(s => s.outcome === 'profitable');
    return {
      range: r.label,
      total: inRange.length,
      bought: sold.length,
      profitable: profitable.length,
      accuracyPct: sold.length > 0 ? Math.round((profitable.length / sold.length) * 100) : 0,
      avgProfit: profitable.length > 0 ? Math.round(profitable.reduce((sum, s) => sum + (s.profit ?? 0), 0) / profitable.length) : 0,
    };
  });
}

function buildRecommendation(
  overallAccuracy: number,
  overrated: ScoredItem[],
  underrated: ScoredItem[],
  byScoreRange: ByScoreRange[],
): { recommendation: string; promptAdjustments: string[] } {
  let recommendation = '';
  const promptAdjustments: string[] = [];

  if (overallAccuracy >= 75) {
    recommendation = `✅ AI deal score je DOBRO kalibriran — ${overallAccuracy}% točnost pri 70+ score. Nadaljuj z trenutnim sistemom.`;
  } else if (overallAccuracy >= 50) {
    recommendation = `⚠️ AI deal score je POVPREČEN — ${overallAccuracy}% točnost. `;
    if (overrated.length > underrated.length) {
      recommendation += 'AI je preveč optimističen — daje visoke score-e slabim deal-om.';
      promptAdjustments.push('Dodaj v AI prompt: "Bodi bolj konservativen pri deal score. Povečaj weight na risk faktorje (slabe fotografije, kratek opis, nov prodajalec)."');
    } else {
      recommendation += 'AI je preveč konzervativen — zamudi dobre deal-e.';
      promptAdjustments.push('Dodaj v AI prompt: "Bodi bolj agresiven pri deal score. Znižaj weight na risk faktorje, povečaj weight na razliko med ceno in est. vrednostjo."');
    }
  } else {
    recommendation = `❌ AI deal score je SLABO kalibriran — samo ${overallAccuracy}% točnost. Potrebna takojšnja kalibracija!`;
    promptAdjustments.push('Predlagam ročni pregled AI prompt-a v src/lib/ai.ts. Preveri ali sistem pravilno tehta: cena vs. est. vrednost, risk, slike, opis.');
    if (overrated.length > 0) {
      promptAdjustments.push(`${overrated.length} item-ov s score 70+ je bilo izgubnih. Znižaj threshold za 5-10 točk (Settings → minOpportunityScore).`);
    }
  }

  // Score distribution insight
  const rangesWithBought = byScoreRange.filter(r => r.bought > 0);
  if (rangesWithBought.length > 0) {
    const bestAcc = Math.max(...rangesWithBought.map(r => r.accuracyPct));
    const bestRange = rangesWithBought.find(r => r.accuracyPct === bestAcc);
    if (bestRange) {
      const minScore = parseInt(bestRange.range.split('-')[0]);
      promptAdjustments.push(`Najboljša točnost je v range ${bestRange.range} (${bestRange.accuracyPct}%). Razmisli o dvigu threshold-a na ${minScore}.`);
    }
  }

  return { recommendation, promptAdjustments };
}
