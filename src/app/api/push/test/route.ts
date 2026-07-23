import { NextResponse } from 'next/server';
import { testPush } from '@/lib/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/push/test — sends a test push notification to all subscribers. */
export async function POST() {
  const result = await testPush();
  return NextResponse.json(result);
}
