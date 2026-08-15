// v8.53: Profit Forecast API
import { NextResponse } from 'next/server';
import { getProfitForecast } from '@/lib/trades/profit-forecast';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET() {
  try {
    const forecast = await getProfitForecast();
    return NextResponse.json(forecast);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
