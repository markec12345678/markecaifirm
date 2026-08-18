// v8.94: Helper za Phase 2 deprecation — logiraj usage zastarelih endpointov.
//
// Namesto da takoj redirect-amo (kar bi zlomilo UI ki še kliče stare endpoint-e),
// logiramo vsak klic zastarelega endpoint-a. Po 30 dneh preverimo log-e in
// izbrišemo endpoint-e ki se ne kličejo več (Phase 3).
//
// LOGIRANJE:
// - logger.warn() — vidi se v dev.log / server.log
// - Console.warn() z structured info — za grepping
// - TODO (v8.95): dodaj DB tabelo DeprecatedEndpointCall za dashboard prikaz
//
// UPORABA v zastarelem route.ts (na VRH handler-ja):
//
//   import { logDeprecatedCall } from '@/lib/deprecated-redirect';
//   export async function POST(req: NextRequest) {
//     logDeprecatedCall('/api/ai/profit-maximizer', req, '/api/ai/profit-maximizer-pro');
//     // ... obstoječa logika ...
//   }
//
// STRATEGIJA:
// - Phase 1 (v8.94.3): @deprecated komentarji ✅ DONE
// - Phase 2 (v8.94.4): usage logging ← TA
// - Phase 3 (v9.0): izbriši neuporabljene endpoint-e (po 30 dneh log-anja)

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

/**
 * Zabeleži klic zastarelega endpoint-a za Phase 3 cleanup.
 *
 * @param endpointPath Star endpoint path (npr. '/api/ai/profit-maximizer')
 * @param req NextRequest za IP/User-Agent info
 * @param replacementPath Nov endpoint path (optional, za kontekst)
 */
export function logDeprecatedCall(
  endpointPath: string,
  req: NextRequest,
  replacementPath?: string
): void {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')?.trim()
    ?? 'unknown';
  const ua = req.headers.get('user-agent')?.slice(0, 100) ?? 'unknown';
  const method = req.method;

  // Structured log — vidi se v dev.log
  logger.warn('deprecated-call', `${method} ${endpointPath} called`, {
    endpoint: endpointPath,
    method,
    ip,
    userAgent: ua,
    replacement: replacementPath ?? null,
  });

  // Console.warn za lažje grepping v log datotekah
  console.warn(JSON.stringify({
    type: 'deprecated_call',
    endpoint: endpointPath,
    replacement: replacementPath ?? null,
    method,
    ip,
    ts: new Date().toISOString(),
  }));
}

/**
 * Vrne 308 Permanent Redirect na nov endpoint (za kliente ki podpirajo redirect).
 * Uporablja se v endpoint-ih kjer želimo FORCIRATI prehod na novo verzijo
 * (ne za endpoint-e ki se še aktivno kličejo iz UI — za te uporabi logDeprecatedCall).
 *
 * @param newEndpointPath Nov endpoint path (npr. '/api/ai/profit-maximizer-pro')
 * @param oldMethod HTTP metoda originalnega klica (POST/GET)
 * @param oldEndpointPath Star endpoint path za logging (npr. '/api/ai/profit-maximizer')
 * @returns NextResponse z 308 status + Location header + JSON body z navodili
 */
export function deprecatedRedirect(
  newEndpointPath: string,
  oldMethod: string,
  oldEndpointPath: string
): NextResponse {
  logger.warn('deprecated-redirect', `Deprecated endpoint called: ${oldEndpointPath} (${oldMethod}) → redirecting to ${newEndpointPath}`);

  return NextResponse.json(
    {
      ok: false,
      error: `Endpoint ${oldEndpointPath} je zastarel (deprecated v8.94). Uporabi ${newEndpointPath} namesto tega.`,
      code: 'ENDPOINT_DEPRECATED',
      deprecated: true,
      oldEndpoint: oldEndpointPath,
      newEndpoint: newEndpointPath,
      migrationGuide: 'Posodobi svojo kodo da kliče nov endpoint. Ta endpoint bo odstranjen v v9.0.',
      autoFollow: oldMethod === 'GET',
    },
    {
      status: 308,
      headers: {
        'Location': newEndpointPath,
        'X-Deprecated': 'true',
        'X-Deprecated-Replacement': newEndpointPath,
        'X-Deprecated-Removed-In': 'v9.0',
        'Cache-Control': 'no-store',
      },
    }
  );
}
