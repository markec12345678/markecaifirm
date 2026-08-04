import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAppUrl, buildAppUrl } from '../../src/lib/app-url';

describe('app-url', () => {
  const origUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => { delete (process.env as any).NEXT_PUBLIC_APP_URL; });
  afterEach(() => {
    if (origUrl) (process.env as any).NEXT_PUBLIC_APP_URL = origUrl;
    else delete (process.env as any).NEXT_PUBLIC_APP_URL;
  });

  it('falls back to http://localhost:3000 when env unset', () => {
    expect(getAppUrl()).toBe('http://localhost:3000');
  });

  it('respects NEXT_PUBLIC_APP_URL', () => {
    (process.env as any).NEXT_PUBLIC_APP_URL = 'https://markec.example.com';
    expect(getAppUrl()).toBe('https://markec.example.com');
  });

  it('strips trailing slash', () => {
    (process.env as any).NEXT_PUBLIC_APP_URL = 'https://example.com/';
    expect(getAppUrl()).toBe('https://example.com');
  });

  it('buildAppUrl joins path with leading slash', () => {
    (process.env as any).NEXT_PUBLIC_APP_URL = 'https://example.com';
    expect(buildAppUrl('/alerts')).toBe('https://example.com/alerts');
  });

  it('buildAppUrl handles path without leading slash', () => {
    (process.env as any).NEXT_PUBLIC_APP_URL = 'https://example.com';
    expect(buildAppUrl('alerts')).toBe('https://example.com/alerts');
  });
});
