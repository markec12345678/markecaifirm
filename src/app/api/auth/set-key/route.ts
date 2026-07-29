/**
 * v6.92: POST /api/auth/set-key
 * Body: { key: string }
 *
 * Nastavi `app-key` cookie (HttpOnly=false, da ga EventSource/SSE lahko pošlje).
 * Cookie se samodejno pošlje z vsakim fetch() na isti origin — ni treba spreminjati
 * vseh 204 fetch klicev v frontend-u.
 *
 * Cookie je HttpOnly=false ker:
 * 1. EventSource (SSE) ne podpira custom headers — cookie je edini način
 * 2. Frontend mora lahko preveri, ali je ključ nastavljen (za prikaz UI)
 *
 * Cookie je SameSite=Lax (zaščita pred CSRF — cross-site fetch ne pošlje cookie).
 * Max-Age=30 dni (uporabnik naj ga redno obnovi).
 *
 * Varnostni premislek: če je aplikacija na localhost in nekdo drug dostopa do istih
 * brskalnikov (shared računalnik), lahko ključ ukrade. A to je local-first app —
 * uporabnik je edini na svojem računalniku. Za multi-user bi morali uporabiti
 * NextAuth + JWT + HttpOnly cookie.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APP_API_KEY = process.env.APP_API_KEY;
const DISABLED = !APP_API_KEY;

export async function POST(req: NextRequest) {
  if (DISABLED) {
    return NextResponse.json({ ok: true, message: 'Avtentikacija izklopljena (APP_API_KEY ni nastavljen).' });
  }

  const body = await req.json().catch(() => ({}));
  const key = typeof body?.key === 'string' ? body.key.trim() : '';

  if (!key) {
    return NextResponse.json({ error: 'Manjka ključ' }, { status: 400 });
  }

  if (key !== APP_API_KEY) {
    // Constant-time comparison (preprečevanje timing napada)
    // Pri 64-znakovnem hex ključu je timing razlika marginalna, a good practice
    if (key.length !== APP_API_KEY!.length || !timingSafeEqual(key, APP_API_KEY!)) {
      return NextResponse.json({ error: 'Napačen ključ' }, { status: 401 });
    }
  }

  const res = NextResponse.json({ ok: true, message: 'Ključ nastavljen. Cookie bo veljal 30 dni.' });
  res.cookies.set('app-key', key, {
    httpOnly: false,        // EventSource (SSE) ne podpira custom headers
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',        // CSRF zaščita
    maxAge: 30 * 24 * 60 * 60, // 30 dni
    path: '/',
  });
  return res;
}

/** Constant-time string comparison (preprečevanje timing napada). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
