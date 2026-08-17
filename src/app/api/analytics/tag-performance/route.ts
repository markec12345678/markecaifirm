// v8.63: Tag Performance Analytics
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getTagPerformance } from '@/lib/trades/tag-performance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET() {
  try {
    const result = await getTagPerformance();
    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/analytics/tag-performance', 'GET failed', err);
    return NextResponse.json({ ok: false, error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
