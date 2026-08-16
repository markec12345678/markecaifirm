// v8.70: Decision Accuracy Analytics API
import { NextResponse } from 'next/server';
import { getDecisionAccuracy } from '@/lib/trades/decision-accuracy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET() {
  try {
    const result = await getDecisionAccuracy();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
