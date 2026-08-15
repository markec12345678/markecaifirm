// v8.43: Annual Summary API.
//
// GET /api/trades/annual-summary?year=2026
//   → AnnualSummary {
//       ok, year, summary { totalTrades, soldTrades, heldTrades, grossProfit,
//                            estimatedTax, netProfitAfterTax, avgROI, winRate,
//                            avgHoldDays, bestMonth, worstMonth, bestCategory },
//       quarterly: [4] (Q1-Q4 with tradeCount + revenue + cost + profit + avgROI + winRate),
//       monthly: [12] (Jan-Dec with tradeCount + profit + cumulativeProfit),
//       topTrades: [5], worstTrades: [3] (if any losses),
//       categoryBreakdown: [...], sourceBreakdown: [...],
//       source: 'v8.43-annual-summary'
//     }
//
// Pure read — no mutations, no AI. Calls getAnnualSummary() from
// src/lib/trades/annual-summary.ts. Results cached for 10 minutes per year
// (yearly data rarely changes once sellDate is set).

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getAnnualSummary } from '@/lib/trades/annual-summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // aggregation over potentially many trades — allow up to 30s

// In-memory cache (10-min TTL per year). Yearly data rarely changes —
// once a sellDate is set, the totals don't move unless trades are deleted/edited.
interface CacheEntry {
  result: Awaited<ReturnType<typeof getAnnualSummary>>;
  ts: number;
}
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<number, CacheEntry>();

function parseYear(req: NextRequest): number {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get('year');
    if (!raw) return new Date().getFullYear();
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 2000 || n > 2100) {
      return new Date().getFullYear();
    }
    return n;
  } catch {
    return new Date().getFullYear();
  }
}

export async function GET(req: NextRequest) {
  try {
    const year = parseYear(req);

    const cached = cache.get(year);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json(cached.result);
    }

    const result = await getAnnualSummary(year);
    cache.set(year, { result, ts: Date.now() });

    logger.info('/api/trades/annual-summary', `computed annual summary for ${year}`, {
      soldTrades: result.summary.soldTrades,
      heldTrades: result.summary.heldTrades,
      grossProfit: result.summary.grossProfit,
      estimatedTax: result.summary.estimatedTax,
      sources: result.sourceBreakdown.length,
      categories: result.categoryBreakdown.length,
      cacheTtlMin: 10,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/api/trades/annual-summary', 'GET handler failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
