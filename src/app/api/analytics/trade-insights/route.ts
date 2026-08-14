// v8.40: Trade Insights Deep Dive API.
//
// GET /api/analytics/trade-insights?days=365
//   → TradeInsights {
//       ok, summary,
//       dayOfWeekAnalysis: [7] (Sun-Sat, tradeCount + avgProfit + sellThroughRate),
//       sourcePlatformAnalysis: [...],      // Bolha/Vinted/Avtonet/mobile.de/etc
//       categoryAnalysis: [...],             // profit per category + trend
//       holdPeriodAnalysis: [5 buckets],     // 0-7d, 8-14d, 15-30d, 31-60d, 60+d
//       profitDistribution: [6 buckets],     // <-50€, -50-0€, 0-50€, 50-100€, 100-200€, 200+€
//       bestDayOfWeek, worstDayOfWeek, bestSource, bestCategory, optimalHoldDays,
//       actionableInsights: [...],           // Slovenian recommendations
//       source: 'v8.40-trade-insights'
//     }
//
// (v8.40.1: forced HMR refresh marker)
//
// Used by Dashboard TradeInsightsCard — 6 collapsible sections + 4 recharts charts.
//
// Pure read — no mutations, no AI. Calls getTradeInsights() from
// src/lib/trades/trade-insights.ts. Results cached for 5 minutes per `days`
// tuple to avoid recomputing on dashboard refresh.

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getTradeInsights } from '@/lib/trades/trade-insights';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // v8.40: deep aggregation over potentially many trades — allow up to 30s

// v7.32-style in-memory cache (5-min TTL, per-days key)
interface CacheEntry {
  result: Awaited<ReturnType<typeof getTradeInsights>>;
  ts: number;
}
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function parseDays(req: NextRequest): number {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get('days');
    if (!raw) return 365;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return 365;
    return Math.min(n, 1095); // 3-year max
  } catch {
    return 365;
  }
}

export async function GET(req: NextRequest) {
  try {
    const days = parseDays(req);
    const key = `${days}`;

    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json(cached.result);
    }

    const result = await getTradeInsights(days);
    cache.set(key, { result, ts: Date.now() });

    logger.info('/api/analytics/trade-insights', `computed insights for ${days}d`, {
      totalTrades: result.summary.totalTrades,
      soldTrades: result.summary.soldTrades,
      totalProfit: result.summary.totalProfit,
      sources: result.sourcePlatformAnalysis.length,
      categories: result.categoryAnalysis.length,
      insights: result.actionableInsights.length,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/api/analytics/trade-insights', 'GET handler failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
