import { NextRequest, NextResponse } from 'next/server';
import { runMonitor } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Manually trigger a monitor run by id (?id=...). */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Manjka id' }, { status: 400 });
  const result = await runMonitor(id);
  return NextResponse.json(result);
}
