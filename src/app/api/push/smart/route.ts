// v5.3: Smart Push API — trigger smart batching + AI priority push
// POST /api/push/smart — check pending alerts, batch them, send
// GET /api/push/smart — get pending alert count + priority preview

import { NextRequest, NextResponse } from 'next/server';
import { getPendingAlertsForBatch, sendSmartPush, batchAlerts } from '@/lib/smart-push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const pending = await getPendingAlertsForBatch();
  const batch = batchAlerts(pending);
  return NextResponse.json({
    pendingCount: pending.length,
    batch: batch ? {
      title: batch.title,
      body: batch.body.slice(0, 200),
      priority: batch.priority,
      alertCount: batch.alertCount,
      categories: batch.categories,
    } : null,
    pendingByPriority: {
      critical: pending.filter(a => a.priority === 'critical').length,
      high: pending.filter(a => a.priority === 'high').length,
      medium: pending.filter(a => a.priority === 'medium').length,
      low: pending.filter(a => a.priority === 'low').length,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const immediate = body?.immediate === true;

    if (immediate) {
      // Send immediate push (bypass batching)
      const { sendImmediatePush } = await import('@/lib/smart-push');
      const result = await sendImmediatePush({
        title: body.title || '🚨 Nov alert',
        body: body.body || '',
        url: body.url || '/alerts',
        priority: body.priority || 'high',
      });
      return NextResponse.json(result);
    }

    // Smart batch push
    const result = await sendSmartPush();
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
