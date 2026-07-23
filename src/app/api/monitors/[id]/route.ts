import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runMonitor } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const monitor = await db.monitor.findUnique({
    where: { id },
    include: {
      listings: {
        orderBy: { firstSeenAt: 'desc' },
        take: 50,
      },
      _count: { select: { alerts: true, listings: true, runLogs: true } },
    },
  });
  if (!monitor) return NextResponse.json({ error: 'Ne najdem' }, { status: 404 });
  return NextResponse.json(monitor);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const data: any = {};
  if (typeof body.name === 'string') data.name = body.name;
  if (typeof body.source === 'string') data.source = body.source;
  if (typeof body.sourceUrl === 'string') data.sourceUrl = body.sourceUrl;
  if (typeof body.keywords === 'string') data.keywords = body.keywords;
  if (typeof body.excludeKeywords === 'string') data.excludeKeywords = body.excludeKeywords;
  if (typeof body.minPrice === 'number' || body.minPrice === null) data.minPrice = body.minPrice;
  if (typeof body.maxPrice === 'number' || body.maxPrice === null) data.maxPrice = body.maxPrice;
  if (typeof body.intervalMinutes === 'number') data.intervalMinutes = body.intervalMinutes;
  if (typeof body.customPrompt === 'string') data.customPrompt = body.customPrompt;
  // v1.2: schedule window
  if (typeof body.runStartHour === 'number' || body.runStartHour === null) data.runStartHour = body.runStartHour;
  if (typeof body.runEndHour === 'number' || body.runEndHour === null) data.runEndHour = body.runEndHour;
  // v1.3: auto-pause threshold
  if (typeof body.autoPauseThreshold === 'number') data.autoPauseThreshold = body.autoPauseThreshold;
  // Handle isActive: when manually reactivating, reset auto-pause state
  if (body.isActive === true) {
    data.isActive = true;
    data.consecutiveErrors = 0;
    data.autoPausedAt = null;
  } else if (body.isActive === false) {
    data.isActive = false;
  }

  const updated = await db.monitor.update({ where: { id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.monitor.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await runMonitor(id);
  return NextResponse.json(result);
}
