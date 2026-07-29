/**
 * v6.92: GET /api/auth/check
 * Preveri, ali je trenutni request avtentikiran (cookie ali header).
 * Frontend uporablja za prikaz login modala.
 *
 * Ta endpoint je v PUBLIC_PATHS v middleware (nikoli ne zahteva avtentikacijo).
 * A v /auth/check ne nastavi — preveri tukaj eksplicitno.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const APP_API_KEY = process.env.APP_API_KEY;
  if (!APP_API_KEY) {
    return NextResponse.json({
      authEnabled: false,
      authenticated: true, // če auth ni omogočen, je "avtentikiran"
      message: 'Avtentikacija izklopljena (APP_API_KEY env ni nastavljen).',
    });
  }

  // Preveri X-App-Key header ali app-key cookie
  const headers = new Headers(req.headers);
  const headerKey = headers.get('x-app-key');
  const cookieHeader = headers.get('cookie') ?? '';
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)app-key=([^;]+)/);
  const cookieKey = cookieMatch ? decodeURIComponent(cookieMatch[1]) : null;
  const providedKey = headerKey ?? cookieKey;

  const authenticated = providedKey === APP_API_KEY;

  return NextResponse.json({
    authEnabled: true,
    authenticated,
    message: authenticated ? 'Avtentikiran.' : 'Manjka ali napačen ključ.',
  });
}
