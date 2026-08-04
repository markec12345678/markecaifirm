/**
 * v6.92: POST /api/auth/clear-key
 * Briše `app-key` cookie (logout).
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const res = NextResponse.json({ ok: true, message: 'Ključ izbrisan.' });
    res.cookies.delete('app-key');
    return res;

  } catch (err) {
    logger.error("/api/auth/clear-key", "POST handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
