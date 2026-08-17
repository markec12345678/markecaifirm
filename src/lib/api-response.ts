// v8.91: Reusable API error response helper.
// Professional pattern: consistent error responses + logging across all endpoints.
//
// Usage:
//   import { apiError, apiOk } from '@/lib/api-response';
//
//   export async function GET() {
//     try {
//       const data = await computeSomething();
//       return apiOk(data);
//     } catch (err) {
//       return apiError('/api/my-endpoint', 'GET failed', err);
//     }
//   }

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

/**
 * Return a consistent error JSON response with logging.
 */
export function apiError(
  endpoint: string,
  message: string,
  err: unknown,
  status: number = 500
): NextResponse {
  const errMsg = err instanceof Error ? err.message : String(err);
  logger.error(endpoint, message, err);
  return NextResponse.json(
    { ok: false, error: errMsg },
    { status }
  );
}

/**
 * Return a consistent success JSON response.
 */
export function apiOk(data: unknown, status: number = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/**
 * Return a 404 with consistent format.
 */
export function apiNotFound(message: string = 'Ne najdem'): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status: 404 });
}

/**
 * Return a 400 with consistent format.
 */
export function apiBadRequest(message: string = 'Neveljaven zahtevek'): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}
