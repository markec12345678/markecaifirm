// v8.70: Decision Accuracy Analytics API
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getDecisionAccuracy } from '@/lib/trades/decision-accuracy';
import { withCache } from '@/lib/analytics-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET() {
  try {
    const result = await withCache('decision-accuracy', 120_000, () => getDecisionAccuracy());
    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/analytics/decision-accuracy', 'GET failed', err);
    return NextResponse.json({ ok: false, error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
