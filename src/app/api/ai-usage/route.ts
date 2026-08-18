// v8.94: AI Usage Stats API — vrača trenutno AI porabo za dashboard.
// GET /api/ai-usage
// Returns: { ok, usage: { today, month, dailyLimit, monthlyLimit, ... } }
//
// Namizni widget lahko prikaže progress bar + "Danes 45/500 klicev (9%)".

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAiUsageStats } from '@/lib/ai-cost';
import { apiOk, apiError } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET() {
  try {
    const usage = await getAiUsageStats(db);
    return apiOk({ usage });
  } catch (err) {
    return apiError('/api/ai-usage', 'GET failed', err);
  }
}
