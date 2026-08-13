// v8.23: Daily Brain Snapshots — stores Master Brain output for historical accuracy tracking.
//
// Pure module that calls masterBrain(), stores the result in the BrainSnapshot
// Prisma table, and provides query helpers for fetching historical snapshots.
//
// Architectural role:
//   - This is the FOUNDATION for v8.25 (Historical Accuracy).
//   - Each day at 00:00 (cron), we call masterBrain() and SAVE the FULL result
//     so that 30 days later we can compare the prediction against ACTUAL profit
//     (from calculateActualProfit in src/lib/profit/actual.ts).
//   - Until v8.23, we had predictions (Master Brain 30d: 3133€) but no way to
//     measure accuracy — no historical record of what was predicted.
//
// Flow:
//   1. Cron @ 00:00 → saveDailySnapshot() → calls masterBrain() → upserts
//      BrainSnapshot row keyed by YYYY-MM-DD.
//   2. v8.25 backfill cron (later) → reads old BrainSnapshot rows older than
//      30d → fills actualProfit30d + accuracy30d columns from Trade table.
//   3. UI fetches /api/ai/brain/snapshots?days=30 → renders historical cards.
//
// IDEMPOTENT: if today's snapshot already exists, saveDailySnapshot() OVERWRITES
// it. This means re-running the cron (or manual trigger) replaces today's
// snapshot with the latest Master Brain output. This is intentional — we want
// the LATEST state of today, not a stale morning snapshot if the user re-runs
// the cron at 23:00 (e.g. after adding new trades that change inputs).

import { db } from '@/lib/db';
import { masterBrain, type MasterBrainResult } from './master';
import { logger } from '@/lib/logger';

export interface BrainSnapshotRow {
  id: string;
  date: string;
  overallHealth: number;
  healthGrade: string;
  riskLevel: string;
  topActionCount: number;
  conflictCount: number;
  bottleneckCount: number;
  strengthCount: number;
  projection30dEUR: number;
  projection90dEUR: number;
  projection12mEUR: number;
  profitGrade: string;
  inventoryGrade: string;
  marketGrade: string;
  sourcingGrade: string;
  riskGrade: string;
  buyerGrade: string;
  pricingGrade: string;
  masterResultJson: string;
  actualProfit30d: number | null;
  actualProfit90d: number | null;
  accuracy30d: number | null;
  accuracy90d: number | null;
  createdAt: Date;
}

/**
 * Save today's Master Brain snapshot to DB.
 *
 * Idempotent — if today's snapshot exists, overwrites it with the latest
 * Master Brain output. This ensures the snapshot always reflects the latest
 * system state (re-running the cron at 23:00 overwrites the morning 00:00 run).
 *
 * Called by:
 *   - Cron job @ 00:00 (src/app/api/cron/daily-brain-snapshot/route.ts)
 *   - Manual trigger via POST /api/ai/brain/snapshots (force=true)
 *
 * @returns { ok: true, date, snapshot } — the saved BrainSnapshot row.
 */
export async function saveDailySnapshot(): Promise<{
  ok: true;
  date: string;
  snapshot: BrainSnapshotRow;
}> {
  // 1. Call Master Brain (no input overrides — uses DB state injection
  //    internally via the individual Domain Brain route-side DB injection
  //    layer; when called directly here, Master Brain falls back to
  //    each Domain Brain's baked-in defaults which themselves read from DB
  //    at their own route level. For snapshot purposes this is fine —
  //    we want a consistent daily baseline.)
  const masterResult: MasterBrainResult = await masterBrain();

  // 2. Extract domain grades (domainSummary has all 7 — fewer only if skipped)
  const gradeByName = (name: string): string => {
    const d = masterResult.domainSummary.find((s) => s.name === name);
    return d?.grade ?? 'C';
  };

  // 3. Build snapshot row data
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD (UTC — consistent)
  const data = {
    date: today,
    overallHealth: masterResult.overallHealth.score,
    healthGrade: masterResult.overallHealth.grade,
    riskLevel: masterResult.overallHealth.riskLevel,
    topActionCount: masterResult.topActions.length,
    conflictCount: masterResult.conflicts.length,
    bottleneckCount: masterResult.overallHealth.bottlenecks.length,
    strengthCount: masterResult.overallHealth.strengths.length,
    projection30dEUR: masterResult.strategy.projection30d.profitEUR,
    projection90dEUR: masterResult.strategy.projection90d.profitEUR,
    projection12mEUR: masterResult.strategy.projection12m.profitEUR,
    profitGrade: gradeByName('profit'),
    inventoryGrade: gradeByName('inventory'),
    marketGrade: gradeByName('market'),
    sourcingGrade: gradeByName('sourcing'),
    riskGrade: gradeByName('risk'),
    buyerGrade: gradeByName('buyer'),
    pricingGrade: gradeByName('pricing'),
    masterResultJson: JSON.stringify(masterResult),
  };

  // 4. Upsert (insert or update if exists for today) — date is unique
  const snapshot = await db.brainSnapshot.upsert({
    where: { date: today },
    create: data,
    update: data,
  });

  logger.info('saveDailySnapshot', `saved snapshot for ${today}`, {
    health: masterResult.overallHealth.score,
    projection30d: masterResult.strategy.projection30d.profitEUR,
  });

  return { ok: true, date: today, snapshot: snapshot as BrainSnapshotRow };
}

/**
 * Fetch historical snapshots (last N days).
 *
 * Returns snapshots in ASCENDING date order (oldest first) — useful for charting.
 *
 * @param days - how many days of history to fetch (default 30)
 * @returns array of BrainSnapshotRow (may be empty if no snapshots saved yet)
 */
export async function getSnapshots(days = 30): Promise<BrainSnapshotRow[]> {
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);
  const sinceStr = sinceDate.toISOString().split('T')[0];

  const snapshots = await db.brainSnapshot.findMany({
    where: { date: { gte: sinceStr } },
    orderBy: { date: 'asc' },
    take: 400, // safety cap (over a year of daily snapshots)
  });

  return snapshots as BrainSnapshotRow[];
}

/**
 * Get the latest snapshot (most recent by date).
 *
 * Used by the UI "latest prediction" card — shows the most recent daily
 * snapshot instead of re-running masterBrain() (cheaper).
 *
 * @returns the latest BrainSnapshotRow, or null if none exists yet.
 */
export async function getLatestSnapshot(): Promise<BrainSnapshotRow | null> {
  const snapshot = await db.brainSnapshot.findFirst({
    orderBy: { date: 'desc' },
  });
  return (snapshot as BrainSnapshotRow) ?? null;
}

/**
 * Get a specific day's FULL Master Brain result (parsed from JSON).
 *
 * Used by drill-down UI — when user clicks a snapshot card in the history list,
 * we fetch the full masterResultJson for that date and display the complete
 * Master Brain output (TOP 5 actions, conflicts, bottlenecks, etc.).
 *
 * @param date - YYYY-MM-DD string
 * @returns the parsed MasterBrainResult, or null if snapshot doesn't exist or
 *          JSON is corrupt.
 */
export async function getSnapshotMasterResult(
  date: string,
): Promise<MasterBrainResult | null> {
  const snapshot = await db.brainSnapshot.findUnique({ where: { date } });
  if (!snapshot) return null;
  try {
    return JSON.parse(snapshot.masterResultJson) as MasterBrainResult;
  } catch {
    return null;
  }
}

// v8.25: Historical Accuracy backfill — fills actualProfit30d/90d + accuracy30d/90d
// for snapshots that are old enough to have actual data (>= 30d old for 30d, >= 90d
// for 90d).
//
// This function is the CULMINATION of the Validation phase:
//   v8.23 = DAILY SNAPSHOTS (predictions stored) + ACTUAL PROFIT TRACKER (ground truth)
//   v8.24 = USER RISK PROFILE (personalization)
//   v8.25 = HISTORICAL ACCURACY (closes the loop — predicted vs actual = accuracy %)
//
// For each snapshot where:
//   - actualProfit30d is null AND snapshot date + 30d <= today
//   → compute actualProfit30d = sum of (sellPrice - sellFees - buyPrice - buyFees)
//     for trades where status='sold' AND sellDate between snapshotDate AND snapshotDate+30d
//   → compute accuracy30d = projection30dEUR > 0 ? (actualProfit30d / projection30dEUR) × 100 : 0
//   → update BrainSnapshot row
//
// Same for 90d.
//
// Returns: { ok, backfilled30d, backfilled90d, totalSnapshots }
//
// Robustness: each snapshot update is wrapped in try/catch so one failure
// (e.g. transient DB error) doesn't abort the whole batch. Individual failures
// are logged but not thrown.
//
// Called by:
//   - Cron job @ 01:00 daily (src/app/api/cron/backfill-accuracy/route.ts)
//     — should run AFTER daily-brain-snapshot cron so today's snapshot exists.
//   - Manual trigger via POST /api/ai/brain/accuracy/backfill (for testing).

export async function backfillSnapshotAccuracy(): Promise<{
  ok: true;
  backfilled30d: number;
  backfilled90d: number;
  totalSnapshots: number;
}> {
  // Fetch all snapshots — we filter in JS for two reasons:
  //   (1) We need to check both "actualProfit30d is null" AND "date + 30d <= today".
  //       Prisma WHERE could express this, but JS keeps the logic transparent + debuggable.
  //   (2) Cap is high (400) since we want to backfill EVERY existing snapshot that's
  //       old enough — once backfilled, the WHERE filter on `actualProfit30d: null`
  //       would naturally shrink the set on subsequent runs (idempotent).
  const allSnapshots = await db.brainSnapshot.findMany({
    orderBy: { date: 'asc' },
    take: 400,
  });

  const totalSnapshots = allSnapshots.length;
  let backfilled30d = 0;
  let backfilled90d = 0;

  const now = new Date();

  for (const snap of allSnapshots) {
    // Parse snapshot date — stored as YYYY-MM-DD (UTC). Construct a Date at UTC midnight.
    // `new Date('YYYY-MM-DD')` parses as UTC midnight, which is what we want.
    const snapshotDate = new Date(`${snap.date}T00:00:00Z`);

    // --- 30d backfill ---
    // Only backfill if actualProfit30d is null AND enough time has passed
    // (snapshot date + 30 days <= now).
    if (snap.actualProfit30d === null) {
      const endDate30d = new Date(snapshotDate);
      endDate30d.setUTCDate(endDate30d.getUTCDate() + 30);

      if (endDate30d <= now) {
        try {
          // Inline query — see lib/profit/actual.ts for the canonical version.
          // We intentionally duplicate the query here (vs adding optional params
          // to calculateActualProfit) to keep that function self-contained + avoid
          // breaking its public contract.
          const trades30d = await db.trade.findMany({
            where: {
              status: 'sold',
              sellDate: { gte: snapshotDate, lte: endDate30d },
            },
            select: {
              buyPrice: true,
              buyFees: true,
              sellPrice: true,
              sellFees: true,
            },
          });

          // Sum per-trade profit = sellPrice - sellFees - buyPrice - buyFees
          // (matches calculateActualProfit formula exactly)
          const actualProfit30d = trades30d.reduce(
            (sum, t) =>
              sum +
              (t.sellPrice ?? 0) -
              (t.sellFees ?? 0) -
              t.buyPrice -
              (t.buyFees ?? 0),
            0,
          );

          const roundedActual30d = Math.round(actualProfit30d * 100) / 100;

          // accuracy30d = (actual / predicted) × 100
          // If prediction was 0 (rare edge case — Master Brain just started and
          // had no data), accuracy is 0 to avoid divide-by-zero. If actual is
          // negative (loss) and predicted was positive, accuracy will be
          // negative (correctly signals over-prediction).
          const accuracy30d =
            snap.projection30dEUR > 0
              ? Math.round(
                  ((actualProfit30d / snap.projection30dEUR) * 100) * 100,
                ) / 100
              : 0;

          await db.brainSnapshot.update({
            where: { id: snap.id },
            data: {
              actualProfit30d: roundedActual30d,
              accuracy30d,
            },
          });

          backfilled30d++;
        } catch (err) {
          // Log + continue — one snapshot failure shouldn't abort the batch.
          logger.error(
            'backfillSnapshotAccuracy',
            `failed to backfill 30d for snapshot ${snap.date}`,
            err,
          );
        }
      }
    }

    // --- 90d backfill ---
    if (snap.actualProfit90d === null) {
      const endDate90d = new Date(snapshotDate);
      endDate90d.setUTCDate(endDate90d.getUTCDate() + 90);

      if (endDate90d <= now) {
        try {
          const trades90d = await db.trade.findMany({
            where: {
              status: 'sold',
              sellDate: { gte: snapshotDate, lte: endDate90d },
            },
            select: {
              buyPrice: true,
              buyFees: true,
              sellPrice: true,
              sellFees: true,
            },
          });

          const actualProfit90d = trades90d.reduce(
            (sum, t) =>
              sum +
              (t.sellPrice ?? 0) -
              (t.sellFees ?? 0) -
              t.buyPrice -
              (t.buyFees ?? 0),
            0,
          );

          const roundedActual90d = Math.round(actualProfit90d * 100) / 100;

          const accuracy90d =
            snap.projection90dEUR > 0
              ? Math.round(
                  ((actualProfit90d / snap.projection90dEUR) * 100) * 100,
                ) / 100
              : 0;

          await db.brainSnapshot.update({
            where: { id: snap.id },
            data: {
              actualProfit90d: roundedActual90d,
              accuracy90d,
            },
          });

          backfilled90d++;
        } catch (err) {
          logger.error(
            'backfillSnapshotAccuracy',
            `failed to backfill 90d for snapshot ${snap.date}`,
            err,
          );
        }
      }
    }
  }

  logger.info('backfillSnapshotAccuracy', 'backfill complete', {
    totalSnapshots,
    backfilled30d,
    backfilled90d,
  });

  return {
    ok: true,
    backfilled30d,
    backfilled90d,
    totalSnapshots,
  };
}

