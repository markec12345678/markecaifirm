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

