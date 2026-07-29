/**
 * v6.92: POST /api/auth/clear-key
 * Briše `app-key` cookie (logout).
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true, message: 'Ključ izbrisan.' });
  res.cookies.delete('app-key');
  return res;
}
