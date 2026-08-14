// v8.37: Profit Timeline API — weekly/monthly profit aggregation from Trade table.
//
// GET /api/analytics/profit-timeline?granularity=weekly&days=90
//   → ProfitTimelineResult { ok, points: [...], totalProfit, totalTrades,
//      bestWeek, worstWeek, avgWeeklyProfit, trend, source }
//
// Used by Dashboard ProfitTimelineChart — recharts line chart showing weekly
// profit + cumulative profit trend over the last N days.
//
// Pure read — no mutations, no AI. Calls getProfitTimeline() from
// src/lib/trades/profit-timeline.ts. Results cached for 5 minutes per (granularity, days)
// tuple to avoid hammering the DB on dashboard refresh.

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getProfitTimeline } from '@/lib/trades/profit-timeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// v7.32-style in-memory cache (5-min TTL, per-tuple key)
interface CacheEntry {
  result: Awaited<ReturnType<typeof getProfitTimeline>>;
  ts: number;
}
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function parseGranularity(req: NextRequest): 'weekly' | 'monthly' {
  try {
    const url = new URL(req.url);
    const raw = (url.searchParams.get('granularity') ?? 'weekly').toLowerCase();
    return raw === 'monthly' ? 'monthly' : 'weekly';
  } catch {
    return 'weekly';
  }
}

function parseDays(req: NextRequest): number {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get('days');
    if (!raw) return 90;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return 90;
    return Math.min(n, 730);
  } catch {
    return 90;
  }
}

export async function GET(req: NextRequest) {
  try {
    const granularity = parseGranularity(req);
    const days = parseDays(req);
    const key = `${granularity}:${days}`;

    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json(cached.result);
    }

    const result = await getProfitTimeline(granularity, days);
    cache.set(key, { result, ts: Date.now() });

    logger.info('/api/analytics/profit-timeline', `computed ${granularity} for ${days}d`, {
      points: result.points.length,
      totalProfit: result.totalProfit,
      trend: result.trend,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/api/analytics/profit-timeline', 'GET handler failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
