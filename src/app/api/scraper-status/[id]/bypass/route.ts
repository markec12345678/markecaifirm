// v9.83: Bypass route — simplified (bypass-chain removed)
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return NextResponse.json({
    ok: false,
    error: 'Bypass chain je bil odstranjen. Uporabi Playwright fallback v nastavitvah.',
    id,
  }, { status: 501 });
}
