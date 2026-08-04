/** v7.32: Memory-based rate limiter for AI endpoints (20/min/IP). */
import type { NextRequest } from 'next/server';

interface RateBucket { count: number; windowStart: number; }
interface RateLimitResult { allowed: boolean; limit: number; remaining: number; retryAfterSeconds: number; resetAt: number; }

const WINDOW_MS = 60_000;
const buckets = new Map<string, RateBucket>();
let lastPruneAt = 0;

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

export function checkRateLimit(req: NextRequest, routeKey = 'ai-global', limit = 20): RateLimitResult {
  const now = Date.now();
  if (now - lastPruneAt > 300000) { lastPruneAt = now; for (const [k, b] of buckets) if (b.windowStart < now - WINDOW_MS) buckets.delete(k); }
  const key = `${getClientIp(req)}:${routeKey}`;
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) { buckets.set(key, { count: 1, windowStart: now }); return { allowed: true, limit, remaining: limit - 1, retryAfterSeconds: 0, resetAt: now + WINDOW_MS }; }
  bucket.count += 1;
  const remaining = Math.max(0, limit - bucket.count);
  return { allowed: bucket.count <= limit, limit, remaining, retryAfterSeconds: bucket.count > limit ? Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000) : 0, resetAt: bucket.windowStart + WINDOW_MS };
}

export function rateLimitResponse(rl: RateLimitResult): Response {
  return new Response(JSON.stringify({ error: 'Presegli ste omejitev zahtevkov.', retryAfterSeconds: rl.retryAfterSeconds }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfterSeconds), 'X-RateLimit-Limit': String(rl.limit), 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(Math.floor(rl.resetAt / 1000)) },
  });
}
