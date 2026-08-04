import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, rateLimitResponse, resetRateLimits } from '../../src/lib/rate-limit';

function mockReq(ip: string = '127.0.0.1'): any {
  const headers = new Headers();
  headers.set('x-forwarded-for', ip);
  return { headers, cookies: { get: () => undefined } };
}

describe('rate-limit', () => {
  beforeEach(() => resetRateLimits());

  it('allows first request', () => {
    const rl = checkRateLimit(mockReq(), 'test', 5);
    expect(rl.allowed).toBe(true);
    expect(rl.remaining).toBe(4);
  });

  it('blocks when limit exceeded', () => {
    for (let i = 0; i < 3; i++) checkRateLimit(mockReq(), 'exceed', 3);
    const rl = checkRateLimit(mockReq(), 'exceed', 3);
    expect(rl.allowed).toBe(false);
    expect(rl.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('different IPs have independent buckets', () => {
    checkRateLimit(mockReq('1.1.1.1'), 'shared', 2);
    checkRateLimit(mockReq('1.1.1.1'), 'shared', 2);
    expect(checkRateLimit(mockReq('1.1.1.1'), 'shared', 2).allowed).toBe(false);
    expect(checkRateLimit(mockReq('2.2.2.2'), 'shared', 2).allowed).toBe(true);
  });

  it('rateLimitResponse returns 429 with headers', () => {
    const res = rateLimitResponse({ allowed: false, limit: 20, remaining: 0, retryAfterSeconds: 45, resetAt: Date.now() + 45000 });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('45');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('20');
  });
});
