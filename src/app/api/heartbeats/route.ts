import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Get heartbeat history (last 30 entries). */
export async function GET() {
  const logs = await db.heartbeatLog.findMany({
    orderBy: { sentAt: 'desc' },
    take: 30,
  });
  return NextResponse.json(logs);
}

/** Manually trigger a heartbeat send (test button). */
export async function POST() {
  const { maybeSendHeartbeat, getSettingsRow } = await import('@/lib/pipeline');
  const settings = await getSettingsRow();

  // Force-send: temporarily mark last heartbeat as 24h+ ago if needed
  const now = new Date();
  if (settings.lastHeartbeatAt) {
    const fakeOld = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    await db.settings.update({
      where: { id: 'singleton' },
      data: { lastHeartbeatAt: fakeOld },
    });
  }

  const result = await maybeSendHeartbeat();
  return NextResponse.json(result);
}
