import { NextRequest, NextResponse } from 'next/server';
import { runMonitor } from '@/lib/pipeline';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Manually trigger a monitor run by id (?id=...). */
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Manjka id' }, { status: 400 });
    const result = await runMonitor(id);
    return NextResponse.json(result);

  } catch (err) {
    logger.error("/api/run", "POST handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
