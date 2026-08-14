// v8.30: Auto-pilot Rollback API.
// POST /api/ai/brain/auto-pilot/rollback
//   Body: { draftId: string, reason?: string }
//   → calls rollbackAutoExecution(draftId, reason)
//   → returns RollbackResult { ok, draft, rolledBack: true, reason }
//
// Rollback an auto-executed action:
// - Sets rolledBack=true, rolledBackAt=now, rollbackReason=reason
// - Calls recordActionFeedback with 'rejected' (v8.28) to UNDO the learning
//   (the auto-execution had incremented the executed counter; we balance it
//   with a rejected signal)
// - Does NOT un-execute in the real world (we can't un-send a Telegram message)
// - Guard: only drafts with autoExecuted=true AND rolledBack=false can be rolled back
//
// 400 for invalid body / not-auto-executed / already-rolled-back.
// 404 for draft not found.
// 500 for server errors.
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=60.

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { rollbackAutoExecution } from '@/lib/brain/auto-pilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown> = {};
    try {
      const ct = req.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        const cloned = req.clone();
        body = (await cloned.json()) as Record<string, unknown>;
      }
    } catch {
      body = {};
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      body = {};
    }

    const draftId = typeof body.draftId === 'string' ? body.draftId.trim() : '';
    if (!draftId) {
      return NextResponse.json(
        {
          ok: false,
          error: `Missing 'draftId' in body. Expected: { draftId: string, reason?: string }.`,
        },
        { status: 400 },
      );
    }

    const reason =
      typeof body.reason === 'string'
        ? body.reason.slice(0, 1000)
        : `User rollback at ${new Date().toISOString()}`;

    const result = await rollbackAutoExecution(draftId, reason);
    return NextResponse.json(result);
  } catch (err: any) {
    const msg = String(err?.message ?? 'Napaka');
    logger.error('/api/ai/brain/auto-pilot/rollback', 'POST handler failed', err);

    // Map known error types to HTTP status codes
    if (msg.startsWith('Draft not found')) {
      return NextResponse.json({ ok: false, error: msg }, { status: 404 });
    }
    if (
      msg.includes('was not auto-executed') ||
      msg.includes('was already rolled back')
    ) {
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }

    return NextResponse.json(
      { error: msg },
      { status: 500 },
    );
  }
}
