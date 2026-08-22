// v8.25 / v8.94-refactor: Historical Accuracy API — returns Master Brain accuracy % + grade trends.
//
// GET ?days=30 (default 30, clamp [1, 400])
// → returns accuracy stats + grade trend array + summary (IMPROVING/STABLE/DECLINING).
//
// This endpoint is the CULMINATION of the Validation phase:
//   - v8.23 stored predictions (BrainSnapshot.projection30dEUR) and gave us
//     a way to compute ACTUAL profit (calculateActualProfit) — but they were
//     disconnected. No accuracy %.
//   - v8.24 made Master Brain personal (Risk Profile adjusts recommendations).
//   - v8.25 closes the loop: backfill cron fills actualProfit30d/90d on each
//     snapshot (>= 30/90 days old), and THIS endpoint exposes those numbers
//     so the UI can answer the question:
//
//         "Ali lahko zaupam Master Brain-u?"
//
//     Answer: "Master Brain accuracy: 89% (zadnjih 30 dni). Trend: ↗️ IMPROVING."
//
// Returns:
//   {
//     ok: true,
//     accuracy30d: number | null,  // average of accuracy30d across snapshots
//                                   // where accuracy30d is not null
//                                   // null if no snapshot has accuracy yet
//                                   //   (message: "Potrebno več podatkov...")
//     accuracy90d: number | null,  // same for 90d
//     gradeTrend: Array<{
//       date: string,
//       profitGrade, inventoryGrade, marketGrade, sourcingGrade,
//       riskGrade, buyerGrade, pricingGrade,
//       overallHealth: number,
//       healthGrade: string,
//     }>,
//     summary: {
//       totalSnapshots: number,
//       snapshotsWithAccuracy30d: number,
//       snapshotsWithAccuracy90d: number,
//       avgAccuracy30d: number | null,  // mirror of top-level accuracy30d
//       avgAccuracy90d: number | null,
//       trend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA'
//     }
//   }
//
// Trend detection:
//   - Take all snapshots with overallHealth values, split into two halves
//     (first half = oldest, second half = newest).
//   - Compute average overallHealth of each half.
//   - If secondHalf avg - firstHalf avg > +2 → 'IMPROVING'
//   - If diff < -2 → 'DECLINING'
//   - Else → 'STABLE'
//   - If fewer than 4 snapshots → 'INSUFFICIENT_DATA'
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=60.
//
// DETERMINISTIC (aiUsed: false): no external AI/LLM SDK is called.
// Reads BrainSnapshot rows via getSnapshots() from @/lib/brain/snapshots.
//
// Refaktoriran z withAiRoute helperjem (v8.95.0-a) + enforceBudget guard
// (non-breaking — endpoint ne kliče AI direktno, ampak je konsistentno z
// vsemi v8.94.x migracijami).

import type { NextRequest } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { getSnapshots, type BrainSnapshotRow } from '@/lib/brain/snapshots';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface BrainAccuracyInput {
  days: number;
}

// --- Pure helpers (čiste, testabilne) -------------------------------------

/**
 * Parse `days` query param — clamp to [1, 400]. Default 30.
 */
function parseDays(req: NextRequest): number {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get('days');
    if (!raw) return 30;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return 30;
    return Math.min(n, 400);
  } catch {
    return 30;
  }
}

type TrendLabel = 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';

/**
 * Determine trend by comparing first-half vs second-half of overallHealth scores.
 *
 * - Fewer than 4 snapshots → INSUFFICIENT_DATA (we need at least 2 in each half
 *   for a meaningful comparison).
 * - Else split into two halves. If odd count, first half has the extra.
 *   (Older snapshots in first half, newer in second.)
 * - Compare averages:
 *   - secondHalfAvg - firstHalfAvg > +2 → IMPROVING
 *   - < -2 → DECLINING
 *   - else → STABLE
 */
function computeTrend(snapshots: BrainSnapshotRow[]): {
  trend: TrendLabel;
  firstHalfAvg: number | null;
  secondHalfAvg: number | null;
} {
  if (snapshots.length < 4) {
    return { trend: 'INSUFFICIENT_DATA', firstHalfAvg: null, secondHalfAvg: null };
  }

  // snapshots are in ASCENDING date order (oldest first) from getSnapshots()
  const mid = Math.floor(snapshots.length / 2);
  const firstHalf = snapshots.slice(0, mid);
  const secondHalf = snapshots.slice(mid);

  const avg = (arr: BrainSnapshotRow[]) =>
    arr.reduce((sum, s) => sum + s.overallHealth, 0) / arr.length;

  const firstHalfAvg = avg(firstHalf);
  const secondHalfAvg = avg(secondHalf);
  const diff = secondHalfAvg - firstHalfAvg;

  let trend: TrendLabel;
  if (diff > 2) trend = 'IMPROVING';
  else if (diff < -2) trend = 'DECLINING';
  else trend = 'STABLE';

  return {
    trend,
    firstHalfAvg: Math.round(firstHalfAvg * 100) / 100,
    secondHalfAvg: Math.round(secondHalfAvg * 100) / 100,
  };
}

/**
 * Average of non-null accuracy values, rounded to 1 decimal.
 * Returns null if no snapshots have accuracy yet (insufficient data).
 */
function avgAccuracy(
  snapshots: BrainSnapshotRow[],
  key: 'accuracy30d' | 'accuracy90d',
): number | null {
  const withAccuracy = snapshots.filter(
    (s) => s[key] !== null && s[key] !== undefined,
  );
  if (withAccuracy.length === 0) return null;
  const sum = withAccuracy.reduce((acc, s) => acc + (s[key] as number), 0);
  return Math.round((sum / withAccuracy.length) * 10) / 10;
}

// --- Handler ---------------------------------------------------------------

export const GET = withAiRoute<BrainAccuracyInput>({
  endpoint: '/api/ai/brain/accuracy',
  maxDuration: 60,
  enforceBudget: true, // v8.95.0-a: budget guard + avtomatski recordAiCall
  method: 'GET',

  // GET — `days` iz query string-a, clamp [1, 400], default 30
  parseBody: async (req) => ({ days: parseDays(req) }),

  // Brez validateInput — parseDays vedno vrne valid število

  handler: async (input, _ctx: AiRouteContext) => {
    const { days } = input;

    const snapshots = await getSnapshots(days);

    // Compute accuracy averages (null if no snapshot has accuracy yet)
    const accuracy30d = avgAccuracy(snapshots, 'accuracy30d');
    const accuracy90d = avgAccuracy(snapshots, 'accuracy90d');

    // Build grade trend array — one entry per snapshot
    const gradeTrend = snapshots.map((s) => ({
      date: s.date,
      profitGrade: s.profitGrade,
      inventoryGrade: s.inventoryGrade,
      marketGrade: s.marketGrade,
      sourcingGrade: s.sourcingGrade,
      riskGrade: s.riskGrade,
      buyerGrade: s.buyerGrade,
      pricingGrade: s.pricingGrade,
      overallHealth: s.overallHealth,
      healthGrade: s.healthGrade,
      // Include accuracy if available (for tooltip / hover)
      accuracy30d: s.accuracy30d,
      accuracy90d: s.accuracy90d,
    }));

    // Compute trend + summary
    const { trend, firstHalfAvg, secondHalfAvg } = computeTrend(snapshots);

    const snapshotsWithAccuracy30d = snapshots.filter(
      (s) => s.accuracy30d !== null && s.accuracy30d !== undefined,
    ).length;
    const snapshotsWithAccuracy90d = snapshots.filter(
      (s) => s.accuracy90d !== null && s.accuracy90d !== undefined,
    ).length;

    const summary = {
      totalSnapshots: snapshots.length,
      snapshotsWithAccuracy30d,
      snapshotsWithAccuracy90d,
      avgAccuracy30d: accuracy30d,
      avgAccuracy90d: accuracy90d,
      trend,
      firstHalfAvg,
      secondHalfAvg,
      // Human-readable message when insufficient data
      message:
        accuracy30d === null
          ? 'Potrebno več podatkov — snemaj dneve 30+ za accuracy'
          : undefined,
    };

    return apiOk({
      ok: true,
      days,
      accuracy30d,
      accuracy90d,
      gradeTrend,
      summary,
    });
  },
});
