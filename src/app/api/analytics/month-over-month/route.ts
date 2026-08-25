// v8.61: Month-over-Month Comparison API
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getMonthOverMonth } from '@/lib/trades/month-over-month';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET() {
  try {
    const result = await getMonthOverMonth();
    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/analytics/month-over-month', 'GET failed', err);
    return NextResponse.json({ ok: false, error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
