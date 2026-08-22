// v8.94: Tests za SSRF zaščito (lib/url-safety.ts).
// Security-critical — vsi SSRF bypass vektorji morajo biti pokriti.
//
// Pokrivamo:
// 1. Valid HTTPS URLs (safe)
// 2. HTTP blocked by default, allowed z ALLOW_HTTP_URLS=1
// 3. Localhost variante (127.0.0.1, ::1, [::1])
// 4. Cloud metadata (AWS, GCP, Azure)
// 5. Link-local (169.254.x)
// 6. Private IPv4 ranges (RFC 1918 + CGNAT + 0.0.0.0/8)
// 7. Private IPv6 (ULA, link-local, multicast, loopback)
// 8. Non-http protocols (ftp, file, gopher, etc.)
// 9. Invalid/empty URLs
// 10. maskedUrl output (ne razkrije internih IP-jev)
// 11. unsafeUrlError helper

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isUrlSafe,
  isUrlSafeWithDns,
  unsafeUrlError,
  type UrlSafetyResult,
} from '../../src/lib/url-safety';

describe('url-safety — isUrlSafe', () => {
  const origAllowHttp = process.env.ALLOW_HTTP_URLS;

  beforeEach(() => {
    // Default: production mode (HTTPS-only, no localhost)
    delete (process.env as any).ALLOW_HTTP_URLS;
  });

  afterEach(() => {
    if (origAllowHttp) (process.env as any).ALLOW_HTTP_URLS = origAllowHttp;
    else delete (process.env as any).ALLOW_HTTP_URLS;
  });

  // --- Valid URLs (should be safe) ---

  describe('valid public URLs', () => {
    it('accepts HTTPS URL z javnim hostname', () => {
      const r = isUrlSafe('https://example.com/webhook');
      expect(r.safe).toBe(true);
      expect(r.maskedUrl).toBe('https://example.com/webhook');
    });

    it('accepts HTTPS z portom', () => {
      const r = isUrlSafe('https://api.example.com:8443/wh');
      expect(r.safe).toBe(true);
    });

    it('accepts HTTPS z query string', () => {
      const r = isUrlSafe('https://example.com/wh?secret=abc');
      expect(r.safe).toBe(true);
      // maskedUrl ne sme vsebovati query-ja (security: ne razkrijemo secrets v logih)
      expect(r.maskedUrl).toBe('https://example.com/wh');
    });

    it('accepts HTTPS z javnim IP naslovom', () => {
      const r = isUrlSafe('https://8.8.8.8/health');
      expect(r.safe).toBe(true);
    });

    it('accepts HTTPS z subdomeno', () => {
      const r = isUrlSafe('https://hooks.slack.com/services/X/Y');
      expect(r.safe).toBe(true);
    });

    it('accepts HTTPS z IPv6 javnim naslovom', () => {
      const r = isUrlSafe('https://[2606:4700:4700::1111]/test');
      expect(r.safe).toBe(true);
    });
  });

  // --- HTTP protocol ---

  describe('HTTP protocol', () => {
    it('blocks HTTP by default (production mode)', () => {
      const r = isUrlSafe('http://example.com/wh');
      expect(r.safe).toBe(false);
      expect(r.reason).toMatch(/HTTPS/);
    });

    it('allows HTTP when ALLOW_HTTP_URLS=1 (dev mode)', () => {
      (process.env as any).ALLOW_HTTP_URLS = '1';
      const r = isUrlSafe('http://example.com/wh');
      expect(r.safe).toBe(true);
    });

    it('still blocks HTTP localhost even with ALLOW_HTTP_URLS=1', () => {
      (process.env as any).ALLOW_HTTP_URLS = '1';
      const r = isUrlSafe('http://localhost:3000/wh');
      expect(r.safe).toBe(false);
      expect(r.reason).toMatch(/localhost/);
    });

    it('still blocks HTTP private IP even with ALLOW_HTTP_URLS=1', () => {
      (process.env as any).ALLOW_HTTP_URLS = '1';
      const r = isUrlSafe('http://10.0.0.5/wh');
      expect(r.safe).toBe(false);
    });
  });

  // --- Localhost ---

  describe('localhost', () => {
    it('blocks "localhost"', () => {
      const r = isUrlSafe('https://localhost/secret');
      expect(r.safe).toBe(false);
      expect(r.reason).toMatch(/localhost/);
    });

    it('blocks 127.0.0.1', () => {
      const r = isUrlSafe('https://127.0.0.1/secret');
      expect(r.safe).toBe(false);
    });

    it('blocks ::1 (IPv6 loopback)', () => {
      const r = isUrlSafe('https://[::1]/secret');
      expect(r.safe).toBe(false);
    });

    it('blocks localhost z portom', () => {
      const r = isUrlSafe('https://localhost:8080/wh');
      expect(r.safe).toBe(false);
    });

    it('blocks 127.0.0.1 z portom', () => {
      const r = isUrlSafe('http://127.0.0.1:3000/api/internal');
      expect(r.safe).toBe(false);
    });
  });

  // --- Cloud metadata endpoints (SSRF critical) ---

  describe('cloud metadata endpoints', () => {
    it('blocks AWS metadata 169.254.169.254 (IPv4)', () => {
      const r = isUrlSafe('https://169.254.169.254/latest/meta-data/iam/');
      expect(r.safe).toBe(false);
      expect(r.reason).toMatch(/metadata|link-local/i);
    });

    it('blocks AWS metadata zexplicitno', () => {
      const r = isUrlSafe('http://169.254.169.254/latest/meta-data/');
      expect(r.safe).toBe(false);
    });

    it('blocks GCP metadata hostname', () => {
      // GCP metadata je na http:// — bypass HTTPS-only z ALLOW_HTTP_URLS
      // da dejansko testiramo metadata blokado (ne HTTPS check)
      (process.env as any).ALLOW_HTTP_URLS = '1';
      const r = isUrlSafe('http://metadata.google.internal/computeMetadata/');
      expect(r.safe).toBe(false);
      expect(r.reason).toMatch(/metadata/i);
    });

    it('blocks "metadata" hostname (GCP short form)', () => {
      (process.env as any).ALLOW_HTTP_URLS = '1';
      const r = isUrlSafe('http://metadata/computeMetadata/');
      expect(r.safe).toBe(false);
    });
  });

  // --- Link-local (169.254.x) ---

  describe('link-local 169.254.x', () => {
    it('blocks 169.254.0.1', () => {
      const r = isUrlSafe('https://169.254.0.1/test');
      expect(r.safe).toBe(false);
      expect(r.reason).toMatch(/link-local/i);
    });

    it('blocks 169.254.255.255', () => {
      const r = isUrlSafe('https://169.254.255.255/test');
      expect(r.safe).toBe(false);
    });

    it('blocks 169.254.169.254 (AWS metadata je subset link-local)', () => {
      const r = isUrlSafe('https://169.254.169.254/latest/');
      expect(r.safe).toBe(false);
    });
  });

  // --- Private IPv4 ranges (RFC 1918 + CGNAT + 0.0.0.0/8) ---

  describe('private IPv4 ranges', () => {
    it('blocks 10.0.0.0/8 (RFC 1918 Class A)', () => {
      expect(isUrlSafe('https://10.0.0.1/test').safe).toBe(false);
      expect(isUrlSafe('https://10.255.255.255/test').safe).toBe(false);
      expect(isUrlSafe('https://10.1.2.3/test').safe).toBe(false);
    });

    it('blocks 172.16.0.0/12 (RFC 1918 Class B)', () => {
      expect(isUrlSafe('https://172.16.0.1/test').safe).toBe(false);
      expect(isUrlSafe('https://172.31.255.255/test').safe).toBe(false);
      expect(isUrlSafe('https://172.20.5.5/test').safe).toBe(false);
    });

    it('does NOT block 172.15.x or 172.32.x (out of range)', () => {
      // 172.15.x je javni prostor — ne sme blokirati
      expect(isUrlSafe('https://172.15.0.1/test').safe).toBe(true);
      // 172.32.x je javni prostor
      expect(isUrlSafe('https://172.32.0.1/test').safe).toBe(true);
    });

    it('blocks 192.168.0.0/16 (RFC 1918 Class C)', () => {
      expect(isUrlSafe('https://192.168.0.1/test').safe).toBe(false);
      expect(isUrlSafe('https://192.168.1.1/test').safe).toBe(false);
      expect(isUrlSafe('https://192.168.255.255/test').safe).toBe(false);
    });

    it('blocks 100.64.0.0/10 (CGNAT)', () => {
      expect(isUrlSafe('https://100.64.0.1/test').safe).toBe(false);
      expect(isUrlSafe('https://100.100.50.50/test').safe).toBe(false);
      expect(isUrlSafe('https://100.127.255.255/test').safe).toBe(false);
    });

    it('does NOT block 100.63.x or 100.128.x (out of CGNAT range)', () => {
      expect(isUrlSafe('https://100.63.0.1/test').safe).toBe(true);
      expect(isUrlSafe('https://100.128.0.1/test').safe).toBe(true);
    });

    it('blocks 0.0.0.0/8 (reserved)', () => {
      expect(isUrlSafe('https://0.0.0.0/test').safe).toBe(false);
      expect(isUrlSafe('https://0.0.0.1/test').safe).toBe(false);
    });

    it('blocks 8.8.8.8 NOT (public Google DNS)', () => {
      expect(isUrlSafe('https://8.8.8.8/test').safe).toBe(true);
    });
  });

  // --- Private IPv6 ---

  describe('private IPv6', () => {
    it('blocks ::1 (loopback)', () => {
      const r = isUrlSafe('https://[::1]/test');
      expect(r.safe).toBe(false);
    });

    it('blocks fe80:: (link-local)', () => {
      const r = isUrlSafe('https://[fe80::1]/test');
      expect(r.safe).toBe(false);
      expect(r.reason).toMatch(/ULA|link-local/i);
    });

    it('blocks fc00:: (ULA)', () => {
      const r = isUrlSafe('https://[fc00::1]/test');
      expect(r.safe).toBe(false);
    });

    it('blocks fd00:: (ULA)', () => {
      const r = isUrlSafe('https://[fd12:3456:789a::1]/test');
      expect(r.safe).toBe(false);
    });

    it('blocks ff00:: (multicast)', () => {
      const r = isUrlSafe('https://[ff02::1]/test');
      expect(r.safe).toBe(false);
    });

    it('does NOT block public IPv6 (2606:4700:...)', () => {
      const r = isUrlSafe('https://[2606:4700:4700::1111]/test');
      expect(r.safe).toBe(true);
    });
  });

  // --- Non-http protocols ---

  describe('non-http protocols', () => {
    it('blocks ftp://', () => {
      const r = isUrlSafe('ftp://example.com/file');
      expect(r.safe).toBe(false);
      expect(r.reason).toMatch(/http/i);
    });

    it('blocks file://', () => {
      const r = isUrlSafe('file:///etc/passwd');
      expect(r.safe).toBe(false);
    });

    it('blocks gopher://', () => {
      const r = isUrlSafe('gopher://localhost/abc');
      expect(r.safe).toBe(false);
    });

    it('blocks javascript://', () => {
      const r = isUrlSafe('javascript://alert(1)');
      expect(r.safe).toBe(false);
    });

    it('blocks data://', () => {
      const r = isUrlSafe('data:text/plain,hello');
      expect(r.safe).toBe(false);
    });

    it('blocks ssh://', () => {
      const r = isUrlSafe('ssh://user@host');
      expect(r.safe).toBe(false);
    });
  });

  // --- Invalid / empty URLs ---

  describe('invalid URLs', () => {
    it('rejects empty string', () => {
      const r = isUrlSafe('');
      expect(r.safe).toBe(false);
      expect(r.reason).toMatch(/prazen|empty/i);
    });

    it('rejects null', () => {
      const r = isUrlSafe(null as unknown as string);
      expect(r.safe).toBe(false);
    });

    it('rejects undefined', () => {
      const r = isUrlSafe(undefined as unknown as string);
      expect(r.safe).toBe(false);
    });

    it('rejects non-string', () => {
      const r = isUrlSafe(123 as unknown as string);
      expect(r.safe).toBe(false);
    });

    it('rejects malformed URL (no protocol)', () => {
      const r = isUrlSafe('example.com/wh');
      expect(r.safe).toBe(false);
    });

    it('rejects malformed URL (spaces)', () => {
      const r = isUrlSafe('https://exa mple.com/test');
      expect(r.safe).toBe(false);
    });

    it('rejects URL z samo protocol', () => {
      const r = isUrlSafe('https://');
      expect(r.safe).toBe(false);
    });
  });

  // --- maskedUrl (security: ne razkrijemo internih IP-jev v logih) ---

  describe('maskedUrl', () => {
    it('vrne protocol + hostname + pathname (brez query/fragment)', () => {
      const r = isUrlSafe('https://example.com/wh?secret=topsecret&token=abc');
      expect(r.maskedUrl).toBe('https://example.com/wh');
    });

    it('očisti fragment', () => {
      const r = isUrlSafe('https://example.com/wh#section');
      expect(r.maskedUrl).toBe('https://example.com/wh');
    });

    it('ne vrne maskedUrl za unsafe URL', () => {
      const r = isUrlSafe('https://10.0.0.1/wh');
      expect(r.safe).toBe(false);
      expect(r.maskedUrl).toBeUndefined();
    });
  });
});

// --- unsafeUrlError helper ---

describe('url-safety — unsafeUrlError', () => {
  it('vrne null za safe URL', () => {
    const r = isUrlSafe('https://example.com/wh');
    expect(unsafeUrlError(r)).toBeNull();
  });

  it('vrne reason za unsafe URL', () => {
    const r = isUrlSafe('https://10.0.0.1/wh');
    const err = unsafeUrlError(r);
    expect(err).not.toBeNull();
    expect(typeof err).toBe('string');
  });

  it('vrne default message za unsafe URL brez reason', () => {
    const fakeResult: UrlSafetyResult = { safe: false };
    expect(unsafeUrlError(fakeResult)).toMatch(/ni varen/i);
  });
});

// --- isUrlSafeWithDns (async, DNS rebinding) ---

describe('url-safety — isUrlSafeWithDns', () => {
  beforeEach(() => {
    delete (process.env as any).ALLOW_HTTP_URLS;
  });

  it('vrne basic result za unsafe URL (ne naredi DNS lookup)', async () => {
    const r = await isUrlSafeWithDns('https://10.0.0.1/test');
    expect(r.safe).toBe(false);
  });

  it('vrne safe za javni hostname z dobrim DNS', async () => {
    // example.com se resolvuje na javni IP — safe
    const r = await isUrlSafeWithDns('https://example.com/test');
    expect(r.safe).toBe(true);
  });

  it('handles invalid URL graceful', async () => {
    const r = await isUrlSafeWithDns('not-a-url');
    expect(r.safe).toBe(false);
  });

  it('handles empty input graceful', async () => {
    const r = await isUrlSafeWithDns('');
    expect(r.safe).toBe(false);
  });
});
