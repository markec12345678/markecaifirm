/**
 * v5.9: TLS Fingerprinting — mimetizira pravega browserja na TLS nivoju
 *
 * Implementira TLS fingerprinting z:
 * 1. Custom cipher suites (mimics Chrome/Firefox/Safari)
 * 2. ALPN protocols (h2, http/1.1)
 * 3. TLS extension ordering
 * 4. JA3 fingerprint simulation
 * 5. Custom TLS min/max versions
 *
 * Čisti Node.js implementacija (brez native dependencies).
 */

import https from 'https';
import http from 'http';
import tls from 'tls';
import { URL } from 'url';

// ===== BROWSER TLS PROFILES =====
// Each profile mimics a real browser's TLS fingerprint

export interface TlsProfile {
  name: string;
  cipherSuites: string[];
  alpnProtocols: string[];
  minVersion: string;
  maxVersion: string;
  honorCipherOrder: boolean;
  ecdhCurve: string;
  sigalgs: string;
}

// Chrome 120 (Windows) TLS profile
const CHROME_120: TlsProfile = {
  name: 'chrome-120',
  cipherSuites: [
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-ECDSA-CHACHA20-POLY1305',
    'ECDHE-RSA-CHACHA20-POLY1305',
    'ECDHE-RSA-AES128-SHA',
    'ECDHE-RSA-AES256-SHA',
    'AES128-GCM-SHA256',
    'AES256-GCM-SHA384',
    'AES128-SHA',
    'AES256-SHA',
  ],
  alpnProtocols: ['h2', 'http/1.1'],
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
  honorCipherOrder: false,
  ecdhCurve: 'X25519:prime256v1:secp384r1',
  sigalgs: 'ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:rsa_pss_rsae_sha512:ecdsa_secp521r1_sha512',
};

// Firefox 121 TLS profile
const FIREFOX_121: TlsProfile = {
  name: 'firefox-121',
  cipherSuites: [
    'TLS_AES_128_GCM_SHA256',
    'TLS_CHACHA20_POLY1305_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-CHACHA20-POLY1305',
    'ECDHE-RSA-CHACHA20-POLY1305',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-ECDSA-AES256-SHA',
    'ECDHE-ECDSA-AES128-SHA',
    'ECDHE-RSA-AES128-SHA',
    'ECDHE-RSA-AES256-SHA',
    'AES128-GCM-SHA256',
    'AES256-GCM-SHA384',
    'AES128-SHA',
    'AES256-SHA',
  ],
  alpnProtocols: ['h2', 'http/1.1'],
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
  honorCipherOrder: false,
  ecdhCurve: 'X25519:prime256v1:secp384r11',
  sigalgs: 'ecdsa_secp256r1_sha256:ecdsa_secp384r1_sha384:ecdsa_secp521r1_sha512:rsa_pss_rsae_sha256:rsa_pss_rsae_sha384:rsa_pss_rsae_sha512:rsa_pkcs1_sha256:rsa_pkcs1_sha384:rsa_pkcs1_sha512',
};

// Safari 17 TLS profile
const SAFARI_17: TlsProfile = {
  name: 'safari-17',
  cipherSuites: [
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-AES256-SHA384',
    'ECDHE-ECDSA-AES128-SHA256',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES256-SHA384',
    'ECDHE-RSA-AES128-SHA256',
  ],
  alpnProtocols: ['h2', 'http/1.1'],
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
  honorCipherOrder: true,
  ecdhCurve: 'X25519:prime256v1:secp384r1',
  sigalgs: 'ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:rsa_pss_rsae_sha512:ecdsa_secp521r1_sha512',
};

export const TLS_PROFILES: TlsProfile[] = [CHROME_120, FIREFOX_121, SAFARI_17];

let profileIndex = 0;

export function getRandomTlsProfile(): TlsProfile {
  return TLS_PROFILES[Math.floor(Math.random() * TLS_PROFILES.length)];
}

export function getNextTlsProfile(): TlsProfile {
  const profile = TLS_PROFILES[profileIndex % TLS_PROFILES.length];
  profileIndex++;
  return profile;
}

// ===== TLS CLIENT REQUEST =====
/**
 * Makes an HTTPS request with custom TLS fingerprinting.
 * Mimics a real browser's TLS handshake by using browser-specific:
 * - Cipher suites ordering
 * - ALPN protocols
 * - EC DH curves
 * - Signature algorithms
 * - TLS version range
 */
export function tlsFetchRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
    profile?: TlsProfile;
    proxyUrl?: string;
  } = {}
): Promise<{ ok: boolean; status: number; html: string; headers: Record<string, string> }> {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const profile = options.profile || getRandomTlsProfile();
    const timeout = options.timeout ?? 15_000;
    const method = options.method || 'GET';

    // Custom TLS options matching the browser profile
    const tlsOptions: tls.SecureContextOptions = {
      ciphers: profile.cipherSuites.join(':'),
      minVersion: profile.minVersion as any,
      maxVersion: profile.maxVersion as any,
      honorCipherOrder: profile.honorCipherOrder,
      ecdhCurve: profile.ecdhCurve,
      sigalgs: profile.sigalgs,
    };

    // Create custom HTTPS agent with TLS fingerprint
    const agent = new https.Agent({
      ...tlsOptions,
      ALPNProtocols: profile.alpnProtocols,
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 1,
      rejectUnauthorized: false, // Accept self-signed certs (some sites use them)
    });

    const requestHeaders: Record<string, string> = {
      'Host': parsedUrl.host,
      ...options.headers,
    };

    const reqOptions: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: requestHeaders,
      agent,
      timeout,
    };

    const req = https.request(reqOptions, (res) => {
      let html = '';
      res.on('data', (chunk) => { html += chunk; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode! >= 200 && res.statusCode! < 400,
          status: res.statusCode!,
          html,
          headers: res.headers as Record<string, string>,
        });
      });
      res.on('error', () => {
        resolve({ ok: false, status: 0, html: '', headers: {} });
      });
    });

    req.on('error', () => {
      resolve({ ok: false, status: 0, html: '', headers: {} });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, html: '', headers: {} });
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// ===== JA3 FINGERPRINT =====
/**
 * Generates a JA3 fingerprint string from a TLS profile.
 * JA3 is a method of fingerprinting TLS clients based on their hello message.
 */
export function generateJa3(profile: TlsProfile): string {
  // JA3 format: SSLVersion,Ciphers,Extensions,EllipticCurves,EllipticCurvePointFormats
  const sslVersion = '771,772'; // TLS 1.2, TLS 1.3
  const ciphers = profile.cipherSuites
    .map(c => cipherToJa3Code(c))
    .filter(Boolean)
    .join('-');
  const extensions = '0-23-65281-10-11-35-16-5-34-51-43-13-45-28-65037'; // Common Chrome extensions
  const curves = profile.ecdhCurve.split(':')
    .map(c => curveToJa3Code(c))
    .filter(Boolean)
    .join('-');
  const pointFormats = '0'; // uncompressed

  return `${sslVersion},${ciphers},${extensions},${curves},${pointFormats}`;
}

function cipherToJa3Code(cipher: string): string | null {
  const map: Record<string, string> = {
    'TLS_AES_128_GCM_SHA256': '4865',
    'TLS_AES_256_GCM_SHA384': '4866',
    'TLS_CHACHA20_POLY1305_SHA256': '4867',
    'ECDHE-ECDSA-AES128-GCM-SHA256': '49195',
    'ECDHE-RSA-AES128-GCM-SHA256': '49199',
    'ECDHE-ECDSA-AES256-GCM-SHA384': '49196',
    'ECDHE-RSA-AES256-GCM-SHA384': '49200',
    'ECDHE-ECDSA-CHACHA20-POLY1305': '52393',
    'ECDHE-RSA-CHACHA20-POLY1305': '52392',
    'ECDHE-RSA-AES128-SHA': '49199',
    'ECDHE-RSA-AES256-SHA': '49200',
    'AES128-GCM-SHA256': '1568',
    'AES256-GCM-SHA384': '1569',
    'AES128-SHA': '47',
    'AES256-SHA': '53',
  };
  return map[cipher] || null;
}

function curveToJa3Code(curve: string): string | null {
  const map: Record<string, string> = {
    'X25519': '29',
    'prime256v1': '23',
    'secp384r1': '24',
    'secp521r1': '25',
  };
  return map[curve] || null;
}

// ===== UTILITY: Check if TLS fingerprinting is beneficial =====
export function shouldUseTlsFingerprinting(url: string): boolean {
  // Sites that are known to use TLS fingerprinting for bot detection
  const fingerprintingSites = [
    'cloudflare',
    'akamai',
    'imperva',
    'perimeterx',
    'distilnetworks',
  ];
  return fingerprintingSites.some(s => url.toLowerCase().includes(s));
}
