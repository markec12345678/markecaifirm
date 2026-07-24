import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/monitors/:id/clone
 * Duplicates a monitor with "(kopija)" suffix and reset state.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const original = await db.monitor.findUnique({ where: { id } });
  if (!original) return NextResponse.json({ error: 'Monitor ne obstaja' }, { status: 404 });

  const cloned = await db.monitor.create({
    data: {
      name: `${original.name} (kopija)`,
      source: original.source,
      sourceUrl: original.sourceUrl,
      keywords: original.keywords,
      excludeKeywords: original.excludeKeywords,
      minPrice: original.minPrice,
      maxPrice: original.maxPrice,
      intervalMinutes: original.intervalMinutes,
      isActive: false, // Start paused — user activates manually
      runStartHour: original.runStartHour,
      runEndHour: original.runEndHour,
      autoPauseThreshold: original.autoPauseThreshold,
      notificationChannels: original.notificationChannels,
      customPrompt: original.customPrompt,
    },
  });
  return NextResponse.json(cloned, { status: 201 });
}
