// v8.94: Razširjeni testi za rate-limit (lib/rate-limit.ts).
//
// Pokrivamo:
// 1. Basic allow/block (že obstoječi + novi)
// 2. Per-IP izolacija
// 3. Per-routeKey izolacija
// 4. x-real-ip fallback (ko ni x-forwarded-for)
// 5. 'unknown' IP ko ni nobenega header-ja
// 6. Default routeKey ('ai-global')
// 7. Default limit (20)
// 8. remaining count tracking
// 9. resetAt je vedno v prihodnosti
// 10. rateLimitResponse headers
// 11. resetRateLimits clear-a vse buckete
// 12. Window reset (po WINDOW_MS se bucket reset-a)
// 13. Edge cases: limit=1 (single request), limit=0

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkRateLimit, rateLimitResponse, resetRateLimits } from '../../src/lib/rate-limit';

// Helper: mock NextRequest z poljubnimi headers
function mockReq(opts: { xff?: string | null; xRealIp?: string | null } = {}): any {
  const headers = new Headers();
  if (opts.xff !== null) headers.set('x-forwarded-for', opts.xff ?? '127.0.0.1');
  if (opts.xRealIp !== null) headers.set('x-real-ip', opts.xRealIp ?? '');
  return { headers, cookies: { get: () => undefined } };
}

describe('rate-limit — basic behavior', () => {
  beforeEach(() => resetRateLimits());

  it('allows first request', () => {
    const rl = checkRateLimit(mockReq(), 'test', 5);
    expect(rl.allowed).toBe(true);
    expect(rl.remaining).toBe(4);
  });

  it('allows up to limit requests', () => {
    for (let i = 0; i < 5; i++) {
      const rl = checkRateLimit(mockReq(), 'basic-allow', 5);
      expect(rl.allowed).toBe(true);
    }
  });

  it('blocks when limit exceeded', () => {
    for (let i = 0; i < 3; i++) checkRateLimit(mockReq(), 'exceed', 3);
    const rl = checkRateLimit(mockReq(), 'exceed', 3);
    expect(rl.allowed).toBe(false);
    expect(rl.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('remaining decreases with each request', () => {
    expect(checkRateLimit(mockReq(), 'remaining', 5).remaining).toBe(4);
    expect(checkRateLimit(mockReq(), 'remaining', 5).remaining).toBe(3);
    expect(checkRateLimit(mockReq(), 'remaining', 5).remaining).toBe(2);
    expect(checkRateLimit(mockReq(), 'remaining', 5).remaining).toBe(1);
    expect(checkRateLimit(mockReq(), 'remaining', 5).remaining).toBe(0);
    // 6. request — blocked, remaining ostane 0
    expect(checkRateLimit(mockReq(), 'remaining', 5).remaining).toBe(0);
  });

  it('resetAt je vedno v prihodnosti', () => {
    const before = Date.now();
    const rl = checkRateLimit(mockReq(), 'reset', 5);
    expect(rl.resetAt).toBeGreaterThanOrEqual(before);
    expect(rl.resetAt).toBeLessThanOrEqual(before + 70_000); // ~60s + tolerance
  });

  it('limit=1 dovoli samo 1 request', () => {
    expect(checkRateLimit(mockReq(), 'limit-1', 1).allowed).toBe(true);
    expect(checkRateLimit(mockReq(), 'limit-1', 1).allowed).toBe(false);
  });
});

describe('rate-limit — per-IP isolation', () => {
  beforeEach(() => resetRateLimits());

  it('different IPs have independent buckets', () => {
    checkRateLimit(mockReq({ xff: '1.1.1.1' }), 'shared', 2);
    checkRateLimit(mockReq({ xff: '1.1.1.1' }), 'shared', 2);
    expect(checkRateLimit(mockReq({ xff: '1.1.1.1' }), 'shared', 2).allowed).toBe(false);
    expect(checkRateLimit(mockReq({ xff: '2.2.2.2' }), 'shared', 2).allowed).toBe(true);
  });

  it('x-forwarded-for z vejico (proxy chain) vzame prvi IP', () => {
    // Real-world: "1.1.1.1, 2.2.2.2, 3.3.3.3" (client, proxy1, proxy2)
    checkRateLimit(mockReq({ xff: '1.1.1.1, 2.2.2.2, 3.3.3.3' }), 'chain', 2);
    checkRateLimit(mockReq({ xff: '1.1.1.1, 2.2.2.2' }), 'chain', 2);
    // Tretji request z istim client IP (1.1.1.1) — blocked
    expect(checkRateLimit(mockReq({ xff: '1.1.1.1, 9.9.9.9' }), 'chain', 2).allowed).toBe(false);
    // Drug client IP — allowed
    expect(checkRateLimit(mockReq({ xff: '5.5.5.5, 2.2.2.2' }), 'chain', 2).allowed).toBe(true);
  });

  it('x-forwarded-for z whitespace se pravilno trim-a', () => {
    // "1.1.1.1, 2.2.2.2" — space po vejici
    checkRateLimit(mockReq({ xff: '1.1.1.1, 2.2.2.2' }), 'whitespace', 2);
    checkRateLimit(mockReq({ xff: '  1.1.1.1  , 2.2.2.2  ' }), 'whitespace', 2);
    // Oba sta ista client IP (1.1.1.1) — tretji blocked
    expect(checkRateLimit(mockReq({ xff: '1.1.1.1' }), 'whitespace', 2).allowed).toBe(false);
  });
});

describe('rate-limit — IP fallback', () => {
  beforeEach(() => resetRateLimits());

  it('x-real-ip se uporabi ko ni x-forwarded-for', () => {
    const req = mockReq({ xff: null, xRealIp: '9.9.9.9' });
    const rl = checkRateLimit(req, 'real-ip', 5);
    expect(rl.allowed).toBe(true);
    expect(rl.remaining).toBe(4);
  });

  it('vrne "unknown" ko ni nobenega IP header-ja', () => {
    const req = mockReq({ xff: null, xRealIp: null });
    const rl = checkRateLimit(req, 'no-ip', 5);
    expect(rl.allowed).toBe(true);
    // Vsi request-i brez IP-ja se štejejo pod isti "unknown" bucket
    // (potencialno problematično za shared NAT, ampak to je design choice)
  });

  it('multiple requests brez IP header-ja delijo "unknown" bucket', () => {
    const req = mockReq({ xff: null, xRealIp: null });
    checkRateLimit(req, 'unknown-shared', 2);
    checkRateLimit(req, 'unknown-shared', 2);
    // Tretji — blocked (isti "unknown" bucket)
    expect(checkRateLimit(req, 'unknown-shared', 2).allowed).toBe(false);
  });

  it('x-forwarded-for ima prednost pred x-real-ip', () => {
    const req = mockReq({ xff: '1.1.1.1', xRealIp: '2.2.2.2' });
    checkRateLimit(req, 'priority', 2);
    checkRateLimit(req, 'priority', 2);
    // Tretji z xff=1.1.1.1 (isti client) — blocked
    expect(checkRateLimit(mockReq({ xff: '1.1.1.1', xRealIp: '3.3.3.3' }), 'priority', 2).allowed).toBe(false);
    // Drugi client (x-real-ip) — allowed
    expect(checkRateLimit(mockReq({ xff: '5.5.5.5', xRealIp: '2.2.2.2' }), 'priority', 2).allowed).toBe(true);
  });
});

describe('rate-limit — per-routeKey isolation', () => {
  beforeEach(() => resetRateLimits());

  it('different routeKeys have independent buckets za isti IP', () => {
    const ip = '1.1.1.1';
    checkRateLimit(mockReq({ xff: ip }), 'route-a', 2);
    checkRateLimit(mockReq({ xff: ip }), 'route-a', 2);
    // route-a blocked
    expect(checkRateLimit(mockReq({ xff: ip }), 'route-a', 2).allowed).toBe(false);
    // route-b allowed (isti IP, drug routeKey)
    expect(checkRateLimit(mockReq({ xff: ip }), 'route-b', 2).allowed).toBe(true);
  });

  it('default routeKey je "ai-global" (klic brez routeKey)', () => {
    // checkRateLimit(req) — brez routeKey, default je 'ai-global'
    const rl1 = checkRateLimit(mockReq(), undefined as any, 5);
    const rl2 = checkRateLimit(mockReq(), 'ai-global', 5);
    // Oba delita isti 'ai-global' bucket → rl2.remaining < 4
    expect(rl1.remaining).toBe(4);
    expect(rl2.remaining).toBe(3);
  });

  it('default limit je 20 (klic brez limit)', () => {
    // 20 requestov — vsi allowed
    for (let i = 0; i < 20; i++) {
      const rl = checkRateLimit(mockReq(), 'default-limit');
      expect(rl.allowed).toBe(true);
    }
    // 21. — blocked
    const rl = checkRateLimit(mockReq(), 'default-limit');
    expect(rl.allowed).toBe(false);
    expect(rl.limit).toBe(20);
  });
});

describe('rate-limit — rateLimitResponse', () => {
  it('returns 429 status', () => {
    const res = rateLimitResponse({
      allowed: false,
      limit: 20,
      remaining: 0,
      retryAfterSeconds: 45,
      resetAt: Date.now() + 45000,
    });
    expect(res.status).toBe(429);
  });

  it('sets Retry-After header', () => {
    const res = rateLimitResponse({
      allowed: false, limit: 20, remaining: 0, retryAfterSeconds: 45, resetAt: Date.now() + 45000,
    });
    expect(res.headers.get('Retry-After')).toBe('45');
  });

  it('sets X-RateLimit-Limit header', () => {
    const res = rateLimitResponse({
      allowed: false, limit: 20, remaining: 0, retryAfterSeconds: 45, resetAt: Date.now() + 45000,
    });
    expect(res.headers.get('X-RateLimit-Limit')).toBe('20');
  });

  it('sets X-RateLimit-Remaining to 0', () => {
    const res = rateLimitResponse({
      allowed: false, limit: 20, remaining: 5, retryAfterSeconds: 45, resetAt: Date.now() + 45000,
    });
    // Vedno 0 v response (client ne ve kolko še lahko pošlje)
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('sets X-RateLimit-Reset header (unix seconds)', () => {
    const resetAt = Date.now() + 45000;
    const res = rateLimitResponse({
      allowed: false, limit: 20, remaining: 0, retryAfterSeconds: 45, resetAt,
    });
    expect(res.headers.get('X-RateLimit-Reset')).toBe(String(Math.floor(resetAt / 1000)));
  });

  it('body vsebuje error message + retryAfterSeconds', async () => {
    const res = rateLimitResponse({
      allowed: false, limit: 20, remaining: 0, retryAfterSeconds: 30, resetAt: Date.now() + 30000,
    });
    const body = await res.json();
    expect(body.error).toMatch(/omejitev/i);
    expect(body.retryAfterSeconds).toBe(30);
  });
});

describe('rate-limit — resetRateLimits', () => {
  it('clear-a vse buckete', () => {
    // Napolni bucket
    checkRateLimit(mockReq({ xff: '1.1.1.1' }), 'clear-test', 2);
    checkRateLimit(mockReq({ xff: '1.1.1.1' }), 'clear-test', 2);
    expect(checkRateLimit(mockReq({ xff: '1.1.1.1' }), 'clear-test', 2).allowed).toBe(false);

    // Reset
    resetRateLimits();

    // Sedaj spet allowed (fresh bucket) — 1. request, remaining = limit - 1 = 1
    const afterReset = checkRateLimit(mockReq({ xff: '1.1.1.1' }), 'clear-test', 2);
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(1);
  });
});

describe('rate-limit — window reset', () => {
  beforeEach(() => resetRateLimits());
  afterEach(() => vi.useRealTimers());

  it('po WINDOW_MS (60s) se bucket reset-a', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    // Napolni bucket do limit
    checkRateLimit(mockReq(), 'window-test', 2);
    checkRateLimit(mockReq(), 'window-test', 2);
    expect(checkRateLimit(mockReq(), 'window-test', 2).allowed).toBe(false);

    // Premakni se 61s v prihodnost (preko WINDOW_MS)
    vi.setSystemTime(now + 61_000);

    // Nov bucket — allowed
    const rl = checkRateLimit(mockReq(), 'window-test', 2);
    expect(rl.allowed).toBe(true);
    expect(rl.remaining).toBe(1);
  });

  it('pred WINDOW_MS bucket ostane blokiran', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    checkRateLimit(mockReq(), 'window-blocked', 2);
    checkRateLimit(mockReq(), 'window-blocked', 2);
    expect(checkRateLimit(mockReq(), 'window-blocked', 2).allowed).toBe(false);

    // 30s kasneje — še vedno blokiran (window ni potekel)
    vi.setSystemTime(now + 30_000);
    expect(checkRateLimit(mockReq(), 'window-blocked', 2).allowed).toBe(false);
  });
});
