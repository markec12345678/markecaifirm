// v8.52: Daily AI Tip API — GET returns today's tip without sending. POST sends it.

import { NextResponse } from 'next/server';
import { generateDailyTip, sendDailyTip } from '@/lib/brain/daily-tip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET() {
  try {
    const tip = await generateDailyTip();
    return NextResponse.json(tip);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}

export async function POST() {
  try {
    const result = await sendDailyTip();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
