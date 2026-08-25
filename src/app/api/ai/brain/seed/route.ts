// v8.35: Seed Demo Data API — creates realistic Slovenian trade history.
//
// POST /api/ai/brain/seed  { action: 'seed' | 'clear' | 'reseed' }
//   - 'seed'    → seedDemoData() — idempotent (skips if trades already exist)
//   - 'clear'   → clearAllTrades() — deletes ALL trades (use with caution)
//   - 'reseed'  → clearAllTrades() + seedDemoData() — clean reset
//
// GET /api/ai/brain/seed — returns current Trade count + 25 demo template info.
//
// Without this endpoint, the Trade table is empty (0 trades) → Actual Profit
// Tracker shows 0€, accuracy can't be computed, and all brains use default
// inputs. v8.35 makes the system "alive" with real data.
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=60 (seeding 25 trades
// can take a few seconds in dev mode with Prisma).

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { seedDemoData, clearAllTrades, DEMO_TRADES } from '@/lib/seed/demo-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const count = await db.trade.count();
    const sold = await db.trade.count({ where: { status: 'sold' } });
    const held = await db.trade.count({ where: { status: 'held' } });
    const cancelled = await db.trade.count({ where: { status: 'cancelled' } });
    return NextResponse.json({
      ok: true,
      count,
      byStatus: { sold, held, cancelled },
      demoTemplateCount: DEMO_TRADES.length,
      source: 'v8.35-seed-demo-data',
    });
  } catch (err: any) {
    logger.error('/api/ai/brain/seed', 'GET handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === 'string' ? body.action : '';

    if (action === 'seed') {
      const result = await seedDemoData();
      logger.info('/api/ai/brain/seed', 'seed action complete', result);
      return NextResponse.json(result);
    }

    if (action === 'clear') {
      const result = await clearAllTrades();
      logger.info('/api/ai/brain/seed', 'clear action complete', result);
      return NextResponse.json({ ...result, source: 'v8.35-seed-demo-data' });
    }

    if (action === 'reseed') {
      const clearResult = await clearAllTrades();
      const seedResult = await seedDemoData();
      logger.info('/api/ai/brain/seed', 'reseed action complete', {
        cleared: clearResult.deleted,
        created: seedResult.created,
      });
      return NextResponse.json({
        ok: true,
        cleared: clearResult.deleted,
        created: seedResult.created,
        total: seedResult.total,
        source: 'v8.35-seed-demo-data',
      });
    }

    return NextResponse.json(
      { error: `Unknown action: '${action}'. Use 'seed', 'clear', or 'reseed'.` },
      { status: 400 },
    );
  } catch (err: any) {
    logger.error('/api/ai/brain/seed', 'POST handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
