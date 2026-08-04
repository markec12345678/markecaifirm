import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/monitors/batch-toggle
 * Body: { ids: string[], active: boolean }
 * Bulk activate or deactivate monitors.
 * When activating, reset auto-pause state.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    const active: boolean = !!body?.active;

    if (ids.length === 0) {
      return NextResponse.json({ error: 'Manjkajo ids' }, { status: 400 });
    }
    if (ids.length > 50) {
      return NextResponse.json({ error: 'Maksimalno 50 monitorjev naenkrat' }, { status: 400 });
    }

    try {
      const data: any = { isActive: active };
      if (active) {
        // Reset auto-pause state when activating
        data.consecutiveErrors = 0;
        data.autoPausedAt = null;
      }

      const result = await db.monitor.updateMany({
        where: { id: { in: ids } },
        data,
      });

      return NextResponse.json({
        ok: true,
        active,
        affected: result.count,
      });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
    }

  } catch (err) {
    logger.error("/api/monitors/batch-toggle", "POST handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
