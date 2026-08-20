// v8.52: Daily AI Tip API — GET returns today's tip without sending. POST sends it.

import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { generateDailyTip, sendDailyTip } from '@/lib/brain/daily-tip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET() {
  try {
    const tip = await generateDailyTip();
    return NextResponse.json(tip);
  } catch (err: unknown) {
    return apiError('/api/ai/brain/daily-tip', 'GET failed', err);
  }
}

export async function POST() {
  try {
    const result = await sendDailyTip();
    return NextResponse.json(result);
  } catch (err: unknown) {
    return apiError('/api/ai/brain/daily-tip', 'POST failed', err);
  }
}
