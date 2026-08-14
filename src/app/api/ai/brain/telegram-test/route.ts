// v8.35: Telegram Brain Test API — lets user test Brain notifications.
//
// POST /api/ai/brain/telegram-test  { type: 'digest' | 'autopilot' | 'anomaly' }
//   - 'digest'    → sendBrainDigest() — sends real Master Brain digest
//   - 'autopilot' → sendAutoPilotAlert(mockDraft, ...) — sends a test alert
//   - 'anomaly'   → sendAnomalyAlert('Test anomaly — preverjamo Telegram povezavo')
//
// Returns { ok, sent, reason? } — same shape as the NotificationResult.
// If Telegram is not configured, returns { ok: true, sent: false, reason: '...' }
// (not an error — just a skipped notification).
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=30

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { sendBrainDigest, sendAutoPilotAlert, sendAnomalyAlert } from '@/lib/brain/telegram-notifications';
import type { ActionDraft } from '@/lib/brain/draft-queue';
import type { DomainName } from '@/lib/brain/master';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Build a mock ActionDraft for the 'autopilot' test alert.
 * Marked clearly as a TEST notification so the user can distinguish real
 * auto-pilot executions from test sends in their Telegram chat.
 */
function buildMockDraft(): ActionDraft {
  return {
    id: `test-${Date.now()}`,
    rank: 1,
    domain: 'profit' as DomainName,
    signal: 'TEST_SIGNAL — preverjamo Telegram povezavo',
    action: 'Test akcija — to je testno sporočilo avto-pilot alert-a',
    expectedUpliftEUR: 50,
    confidence: 'LOW',
    status: 'executed',
    feedbackNote: null,
    executedAt: new Date(),
    rejectedAt: null,
    snapshotDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const type = typeof body?.type === 'string' ? body.type : '';

    if (type === 'digest') {
      const result = await sendBrainDigest();
      logger.info('/api/ai/brain/telegram-test', 'digest test', result);
      return NextResponse.json({ ok: result.ok, sent: result.sent, reason: result.reason ?? null, type: 'digest' });
    }

    if (type === 'autopilot') {
      const mockDraft = buildMockDraft();
      const result = await sendAutoPilotAlert(mockDraft, 'Test notification — preverjamo Telegram povezavo');
      logger.info('/api/ai/brain/telegram-test', 'autopilot test', result);
      return NextResponse.json({ ok: result.ok, sent: result.sent, reason: result.reason ?? null, type: 'autopilot' });
    }

    if (type === 'anomaly') {
      const result = await sendAnomalyAlert('Test anomaly — preverjamo Telegram povezavo');
      logger.info('/api/ai/brain/telegram-test', 'anomaly test', result);
      return NextResponse.json({ ok: result.ok, sent: result.sent, reason: result.reason ?? null, type: 'anomaly' });
    }

    return NextResponse.json(
      { error: `Unknown type: '${type}'. Use 'digest', 'autopilot', or 'anomaly'.` },
      { status: 400 },
    );
  } catch (err: any) {
    logger.error('/api/ai/brain/telegram-test', 'POST handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
