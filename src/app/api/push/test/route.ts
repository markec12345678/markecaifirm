import { NextResponse } from 'next/server';
import { testPush } from '@/lib/push';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/push/test — sends a test push notification to all subscribers. */
export async function POST() {
  try {
    const result = await testPush();
    return NextResponse.json(result);

  } catch (err) {
    logger.error("/api/push/test", "POST handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
