// v8.23: Actual Profit API — computes REAL EUR profit from Trade table.
//
// GET /api/ai/brain/actual-profit?days=30 (default 30)
//
// Returns ActualProfitResult — the GROUND TRUTH for validating Master Brain
// predictions. Until v8.23, the Brain architecture (v8.15-v8.22) made
// predictions ("30d: 3133€") but had no way to measure actual realized profit.
//
// Pure read endpoint — calls calculateActualProfit() in src/lib/profit/actual.ts
// which reads from the Trade table (status='sold', sellDate within last N days).
//
// Used by:
//   - UI card "📊 Dejanski profit (zadnjih 30 dni)" — top of Brain view
//     (ground truth first, above the Master Brain banner)
//   - GET /api/ai/brain/snapshots — combined with snapshots for predicted vs
//     actual comparison
//   - (v8.25 future) accuracy backfill cron — fills actualProfit30d/90d cols
//     on BrainSnapshot rows older than 30/90 days
//
// Per-trade profit formula:
//   profit = sellPrice - sellFees - buyPrice - buyFees
//
// Returns:
//   - totalProfitEUR — sum of all trade profits
//   - totalRevenueEUR — sum of sellPrice
//   - totalCostEUR — sum of (buyPrice + buyFees + sellFees)
//   - tradeCount — number of sold trades in period
//   - avgProfitPerTradeEUR — totalProfit / tradeCount
//   - avgMarginPct — totalProfit / totalRevenue × 100
//   - dailyAvgEUR — totalProfit / days
//   - bestTrade — trade with highest profit
//   - worstTrade — trade with lowest profit (may be negative)

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { calculateActualProfit } from '@/lib/profit/actual';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Parse `days` query param — clamp to [1, 730] (2 years max).
 * Default 30. Supports common presets: 7, 30, 90, 365.
 */
function parseDays(req: NextRequest): number {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get('days');
    if (!raw) return 30;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return 30;
    return Math.min(n, 730);
  } catch {
    return 30;
  }
}

export async function GET(req: NextRequest) {
  try {
    const days = parseDays(req);
    const result = await calculateActualProfit(days);

    logger.info('/api/ai/brain/actual-profit', `computed for ${days}d`, {
      tradeCount: result.tradeCount,
      totalProfit: result.totalProfitEUR,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/api/ai/brain/actual-profit', 'GET handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

// POST also supported — same handler (some UIs prefer POST for data fetches)
export async function POST(req: NextRequest) {
  return GET(req);
}
