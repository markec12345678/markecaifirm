// v8.52: Inventory Aging Check cron — runs daily at 06:00.
// Checks all held trades for aging thresholds (30/60/90 days).

import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { checkInventoryAging } from '@/lib/trades/aging-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  try {
    const result = await checkInventoryAging();
    return NextResponse.json(result);
  } catch (err: unknown) {
    return apiError('/api/cron/inventory-aging-check', 'GET failed', err);
  }
}

export async function POST() {
  try {
    const result = await checkInventoryAging();
    return NextResponse.json(result);
  } catch (err: unknown) {
    return apiError('/api/cron/inventory-aging-check', 'POST failed', err);
  }
}
