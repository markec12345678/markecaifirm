// v8.29: Per-draft API — PATCH updates a draft's status.
// PATCH /api/ai/brain/drafts/{id} { status: 'executed'|'rejected'|'approved', feedbackNote?: string }
//
// Closed feedback loop:
//   - When status is 'executed' or 'rejected', ALSO calls recordActionFeedback()
//     from v8.28 (adaptive-weights.ts) → adaptive weights re-evaluate every 10
//     actions per domain → next Master Brain call has updated weights →
//     better ranking for the user's REVEALED preferences.
//
// Returns:
//   { ok: true, draft: ActionDraft, feedbackRecorded: boolean, feedbackResult?: WeightAdjustmentResult }
//
// Errors:
//   400 — invalid status (must be 'executed', 'rejected', or 'approved')
//   400 — cannot change a draft that already has a final status (executed/rejected)
//   404 — draft not found
//   500 — server error
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=60

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { updateDraftStatus } from '@/lib/brain/draft-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VALID_PATCH_STATUS = new Set<string>(['executed', 'rejected', 'approved']);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Missing draft id (expected /api/ai/brain/drafts/{id}).' },
        { status: 400 },
      );
    }

    let body: Record<string, unknown> = {};
    try {
      const ct = req.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        const cloned = req.clone();
        const parsed = (await cloned.json()) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          body = parsed;
        }
      }
    } catch {
      body = {};
    }

    const statusRaw = typeof body.status === 'string' ? body.status.toLowerCase().trim() : '';
    if (!VALID_PATCH_STATUS.has(statusRaw)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Invalid status: ${JSON.stringify(body.status)}. Must be 'executed', 'rejected', or 'approved'.`,
        },
        { status: 400 },
      );
    }

    const feedbackNote =
      typeof body.feedbackNote === 'string' && body.feedbackNote.trim() !== ''
        ? body.feedbackNote.trim().slice(0, 1000)
        : undefined;

    try {
      const result = await updateDraftStatus({ id, status: statusRaw as any, feedbackNote });
      return NextResponse.json(result);
    } catch (err: any) {
      const msg = err?.message ?? 'Napaka';
      // Distinguish "not found" from "bad request" via error message content
      if (msg.includes('not found')) {
        return NextResponse.json({ ok: false, error: msg }, { status: 404 });
      }
      if (msg.includes('already has final status') || msg.includes('Cannot set status')) {
        return NextResponse.json({ ok: false, error: msg }, { status: 400 });
      }
      throw err;
    }
  } catch (err: any) {
    logger.error('/api/ai/brain/drafts/[id]', 'PATCH handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

// Convenience GET so the endpoint is discoverable via AI Hub runner.
// Returns the single draft (raw SQL — bypass stale PrismaClient).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { ok: false, error: 'Missing draft id.' },
        { status: 400 },
      );
    }
    // Inline fetch — small enough not to warrant a library function.
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient({ log: ['error', 'warn'] });
    try {
      const rows = await db.$queryRaw<Array<any>>`
        SELECT * FROM ActionDraft WHERE id = ${id} LIMIT 1
      `;
      if (rows.length === 0) {
        return NextResponse.json(
          { ok: false, error: `Draft not found: ${id}` },
          { status: 404 },
        );
      }
      const row = rows[0];
      const draft = {
        id: String(row.id),
        rank: Number(row.rank),
        domain: row.domain,
        signal: String(row.signal),
        action: String(row.action),
        expectedUpliftEUR: Number(row.expectedUpliftEUR),
        confidence: row.confidence,
        status: row.status,
        feedbackNote: row.feedbackNote ?? null,
        executedAt: row.executedAt ?? null,
        rejectedAt: row.rejectedAt ?? null,
        snapshotDate: row.snapshotDate ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
      return NextResponse.json({ ok: true, draft, source: 'v8.29-draft-queue' });
    } finally {
      await db.$disconnect().catch(() => {});
    }
  } catch (err: any) {
    logger.error('/api/ai/brain/drafts/[id]', 'GET handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
