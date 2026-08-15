// v8.52: Daily AI Tip cron — runs at 09:00 daily.

import { NextRequest, NextResponse } from 'next/server';
import { sendDailyTip, generateDailyTip } from '@/lib/brain/daily-tip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  try {
    const result = await sendDailyTip();
    return NextResponse.json(result);
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
