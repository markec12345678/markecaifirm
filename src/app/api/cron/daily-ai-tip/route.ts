// v8.52: Daily AI Tip cron — runs at 09:00 daily.

import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { sendDailyTip, generateDailyTip } from '@/lib/brain/daily-tip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  try {
    const result = await sendDailyTip();
    return NextResponse.json(result);
  } catch (err: unknown) {
    return apiError('/api/cron/daily-ai-tip', 'GET failed', err);
  }
}

export async function POST() {
  try {
    const result = await sendDailyTip();
    return NextResponse.json(result);
  } catch (err: unknown) {
    return apiError('/api/cron/daily-ai-tip', 'POST failed', err);
  }
}
