/**
 * v6.92: Minimalna avtentikacija — API key proxy.
 *
 * Prej so bili VSI API-ji javno dostopni (344 endpointov).
 * Kdor je poznal URL, je lahko:
 *   - brisal alerte (DELETE /api/alerts?id=)
 *   - spremenil Settings (POST /api/settings) — vključno z AI API ključem, Telegram tokenom
 *   - sprožil cron (GET /api/cron/run-all)
 *   - izvozil vse podatke (GET /api/listings?format=csv)
 *   - bral tajnosti iz Settings (GET /api/settings — masked, a še vedno)
 *
 * Rešitev: preprost API key (preko headerja `X-App-Key` ali cookie `app-key`).
 *
 * Konfiguracija:
 *   - Env var: `APP_API_KEY=nek-naključni-niz` v `.env`
 *   - Če env ni nastavljen: avtentikacija je izklopljena (za local dev)
 *   - Frontend sam nastavi cookie ob prvem vnosu ključa (prek /settings UI — TODO)
 *
 * Endpoint-i, ki so vedno javni (whitelist):
 *   - `/` (glavna stran)
 *   - `/manifest.json`, `/sw.js`, `/offline.html` (PWA)
 *   - `/icon-*.png`, `/favicon-*.png`, `/favicon.ico` (PWA ikone)
 *   - `/api/health` (healthcheck)
 *   - `/api/telegram/webhook` (Telegram pošlje sem — ima svoj secret prek `?secret=`)
 *   - `/api/push/subscribe` (brskalnik se prijavi za push — pred avtentikacijo)
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/proxy
 */

import { NextRequest, NextResponse } from 'next/server';

const APP_API_KEY = process.env.APP_API_KEY;
const DISABLED = !APP_API_KEY;

// Javni endpoint-i (nikoli ne zahtevajo avtentikacije)
const PUBLIC_PATHS = [
  // Glavna stran + statične datoteke
  /^\/$/,
  /^\/manifest\.json$/,
  /^\/sw\.js$/,
  /^\/offline\.html$/,
  /^\/robots\.txt$/,
  // PWA ikone
  /^\/icon-\d+\.png$/,
  /^\/favicon(-\d+)?\.png$/,
  /^\/favicon\.ico$/,
  /^\/logo\.svg$/,
  // Healthcheck (ops)
  /^\/api\/health$/,
  // Telegram webhook (ima svoj `?secret=` prek env TELEGRAM_WEBHOOK_SECRET)
  /^\/api\/telegram\/webhook$/,
  // Push subscription (brskalnik se prijavi pred avtentikacijo — push payload ne vsebuje tajnosti)
  /^\/api\/push\/subscribe$/,
  // v6.92: Auth endpoint-i (set-key/check morata delati brez avtentikacije)
  /^\/api\/auth\/set-key$/,
  /^\/api\/auth\/clear-key$/,
  /^\/api\/auth\/check$/,
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(re => re.test(pathname));
}

export function proxy(req: NextRequest) {
  // 1. Če APP_API_KEY ni nastavljen, je avtentikacija izklopljena (local dev)
  if (DISABLED) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;

  // 2. Javni endpoint-i — spusti skozi
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // 3. Preveri `X-App-Key` header ali `app-key` cookie
  const headerKey = req.headers.get('x-app-key');
  const cookieKey = req.cookies.get('app-key')?.value;
  const providedKey = headerKey ?? cookieKey;

  if (!providedKey || providedKey !== APP_API_KEY) {
    // 4. Za HTML zahteve (npr. uporabnik v brskalniku) redirect na /login
    //    (zaenkrat samo 401 — frontend UI naj sam ponovno zahteva ključ)
    const accept = req.headers.get('accept') ?? '';
    if (accept.includes('text/html')) {
      // Frontend bo imel modal za vnos ključa (TODO v settings)
      return NextResponse.json(
        { error: 'Avtentikacija zahtevana. Nastavi X-App-Key header ali app-key cookie.', needsAuth: true },
        { status: 401 }
      );
    }
    // Za API klice: 401 JSON
    return NextResponse.json(
      { error: 'Unauthorized — manjka ali napačen API ključ', needsAuth: true },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  // Zaženi na vseh poteh razen statičnih datotek
  matcher: [
    /*
     * Zaženi na vsem razen:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (sicer match-a PUBLIC_PATHS, a proxy ne teče za to)
     */
    '/((?!_next/static|_next/image).*)',
  ],
};
