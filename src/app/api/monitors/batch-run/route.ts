import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runMonitor } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/monitors/batch-run
 * Body: { ids: string[] }
 * Runs multiple monitors sequentially.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Manjkajo ids' }, { status: 400 });
  }
  if (ids.length > 20) {
    return NextResponse.json({ error: 'Maksimalno 20 monitorjev naenkrat' }, { status: 400 });
  }

  const results: Array<Record<string, any>> = [];
  for (const id of ids) {
    try {
      const result = await runMonitor(id);
      results.push({ id, ...result });
    } catch (e: any) {
      results.push({ id, status: 'error', error: e?.message ?? 'Napaka' });
    }
  }

  return NextResponse.json({
    ok: true,
    ran: results.length,
    results,
  });
}
