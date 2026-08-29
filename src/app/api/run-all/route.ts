import { NextResponse } from 'next/server';
import { forceRunAll } from '@/lib/pipeline';
import { progressStart } from '@/lib/scraper-progress';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Force-run ALL active monitors immediately, ignoring intervals. */
export async function POST() {
  try {
    // Initialize progress for all active monitors BEFORE returning
    const monitors = await db.monitor.findMany({ where: { isActive: true }, select: { id: true, name: true } });
    for (const m of monitors) {
      progressStart(m.id, m.name);
    }

    // Return immediately so dashboard can start polling progress
    // Then run monitors in background after a small delay
    setTimeout(() => {
      forceRunAll().catch(() => {});
    }, 500);

    return NextResponse.json({ ran: monitors.length, started: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Napaka' },
      { status: 500 }
    );
  }
}
