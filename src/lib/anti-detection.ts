/**
 * v7.40: Anti-detection fetch helper — maximal bot bypass.
 *
 * Upgrades from v7.32:
 * 1. Cookie jar — persists Cloudflare cf_clearance cookies across requests
 * 2. 429 retry with exponential backoff + jitter
 * 3. Referer header (platform-specific)
 * 4. Gaussian delay distribution (more human-like than linear)
 * 5. Fallback chain: fetch → retry with backoff → Playwright (if enabled)
 * 6. More UA strings (Chrome/Firefox/Safari/Edge × Win/Mac/Linux)
 * 7. Accept-Encoding + Connection headers
 * 8. Per-domain session affinity (same UA + cookies per domain)
 */

import { db } from './db';
import { logger } from './logger';
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';

interface ProxyConfig { url: string; username?: string; password?: string; type: 'http' | 'socks5'; }
interface ADS {
  proxyEnabled: boolean;
  proxyList: ProxyConfig[];
  realisticHeaders: boolean;
  requestMinDelay: number;
  requestMaxDelay: number;
  stealthMode: boolean;
}

let cached: { data: ADS; expiresAt: number } | null = null;

async function getSettings(): Promise<ADS> {
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  try {
    const s = await db.settings.findUnique({
      where: { id: 'singleton' },
      select: { proxyEnabled: true, proxyList: true, realisticHeaders: true, requestMinDelay: true, requestMaxDelay: true, stealthMode: true },
    });
    let proxies: ProxyConfig[] = [];
    try { const p = JSON.parse(s?.proxyList || '[]'); if (Array.isArray(p)) proxies = p; } catch { /* */ }
    const data: ADS = {
      proxyEnabled: s?.proxyEnabled ?? false,
      proxyList: proxies,
      realisticHeaders: s?.realisticHeaders ?? true,
      requestMinDelay: s?.requestMinDelay ?? 1000,
      requestMaxDelay: s?.requestMaxDelay ?? 5000,
      stealthMode: s?.stealthMode ?? false,
    };
    cached = { data, expiresAt: Date.now() + 30000 };
    return data;
  } catch {
    return { proxyEnabled: false, proxyList: [], realisticHeaders: true, requestMinDelay: 1000, requestMaxDelay: 5000, stealthMode: false };
  }
}

// v7.40: Expanded UA pool — 12 strings (Chrome/Firefox/Safari × Win/Mac/Linux)
const USER_AGENTS = [
  // Chrome on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // Chrome on Mac
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // Firefox on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  // Firefox on Mac
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0',
  // Safari on Mac
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  // Chrome on Linux
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // Edge on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
];

// v7.40: Per-domain session affinity — same UA per domain per session
const domainSessions = new Map<string, { ua: string; cookies: Map<string, string> }>();

// v9.67: Session-sticky proxies — isti proxy za isto domeno v 30-min oknu
// (professional scrapers uporabljajo to da ne fingerprinta behavioral patterns)
interface SessionProxy {
  proxyUrl: string;
  assignedAt: number;
  domain: string;
}
const domainProxyAssignment = new Map<string, SessionProxy>();
const PROXY_STICKINESS_MS = 30 * 60 * 1000; // 30 minut

/**
 * v9.67: Pridobi session-sticky proxy za domeno.
 * Isti proxy se uporablja za isto domeno v 30-min oknu,
 * da se izognemo behavioral fingerprintingu.
 */
function getSessionStickyProxy(domain: string, proxies: ProxyConfig[]): ProxyConfig | null {
  if (proxies.length === 0) return null;

  const existing = domainProxyAssignment.get(domain);
  const now = Date.now();

  // Če obstaja in ni potekel (mlajši od 30 min) — uporabi isti
  if (existing && now - existing.assignedAt < PROXY_STICKINESS_MS) {
    const proxy = proxies.find((p) => p.url === existing.proxyUrl);
    if (proxy) return proxy;
  }

  // Drugače izberi nov proxy in ga shrani za to domeno
  const proxy = proxies[Math.floor(Math.random() * proxies.length)];
  domainProxyAssignment.set(domain, {
    proxyUrl: proxy.url,
    assignedAt: now,
    domain,
  });

  return proxy;
}

/**
 * v9.67: HTML cache — ne fetchaj iste strani dvakrat v 1h.
 * (Scrapfly ima caching na API nivoju — isto funkcionalnost)
 */
interface CachedHtml {
  html: string;
  status: number;
  cachedAt: number;
  url: string;
}
const htmlCache = new Map<string, CachedHtml>();
const HTML_CACHE_TTL_MS = 60 * 60 * 1000; // 1 ura

/**
 * Preveri ali je URL v HTML cache-u in še veljaven.
 */
export function getCachedHtml(url: string): { html: string; status: number } | null {
  const cached = htmlCache.get(url);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > HTML_CACHE_TTL_MS) {
    htmlCache.delete(url);
    return null;
  }
  return { html: cached.html, status: cached.status };
}

/**
 * Shrani HTML v cache.
 */
export function setCachedHtml(url: string, html: string, status: number): void {
  // Omeji cache na 1000 vnosov (prepreči memory leak)
  if (htmlCache.size > 1000) {
    const oldestKey = Array.from(htmlCache.keys())[0];
    if (oldestKey) htmlCache.delete(oldestKey);
  }
  htmlCache.set(url, { html, status, cachedAt: Date.now(), url });
}

/**
 * Počisti HTML cache (za settings spremembe ali debug).
 */
export function clearHtmlCache(): void {
  htmlCache.clear();
  logger.info('anti-detection', 'HTML cache cleared');
}

function getDomainSession(domain: string): { ua: string; cookies: Map<string, string> } {
  if (!domainSessions.has(domain)) {
    domainSessions.set(domain, {
      ua: USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      cookies: new Map(),
    });
  }
  return domainSessions.get(domain)!;
}

function getDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return 'unknown'; }
}

// v7.40: Gaussian random delay (Box-Muller transform) — more human-like
function gaussianRandom(min: number, max: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const mean = (min + max) / 2;
  const stddev = (max - min) / 6; // 99.7% within [min, max]
  const value = mean + z * stddev;
  return Math.max(min, Math.min(max, value));
}

// v7.40: Referer per platform
const PLATFORM_REFERERS: Record<string, string> = {
  'bolha.com': 'https://www.bolha.com/',
  'www.bolha.com': 'https://www.bolha.com/',
  'nepremicnine.net': 'https://www.nepremicnine.net/',
  'www.nepremicnine.net': 'https://www.nepremicnine.net/',
  'avtonet.si': 'https://www.avtonet.si/',
  'www.avtonet.si': 'https://www.avtonet.si/',
  'suchen.mobile.de': 'https://suchen.mobile.de/',
  'www.mobile.de': 'https://www.mobile.de/',
  'www.kleinanzeigen.de': 'https://www.kleinanzeigen.de/',
  'www.subito.it': 'https://www.subito.it/',
  'www.willhaben.at': 'https://www.willhaben.at/',
  'www.vinted.si': 'https://www.vinted.si/',
  'www.vinted.com': 'https://www.vinted.com/',
  'www.quoka.de': 'https://www.quoka.de/',
  'quoka.de': 'https://www.quoka.de/',
};

function buildHeaders(realistic: boolean, url: string, session: { ua: string; cookies: Map<string, string> }, extra?: Record<string, string>): Record<string, string> {
  const domain = getDomain(url);
  const referer = PLATFORM_REFERERS[domain] || `https://${domain}/`;

  if (!realistic) {
    return { 'User-Agent': session.ua, Accept: 'text/html,*/*;q=0.8', ...(extra || {}) };
  }

  // v7.40: Full browser fingerprint
  const isFirefox = session.ua.includes('Firefox');
  const isSafari = session.ua.includes('Safari') && !session.ua.includes('Chrome');
  const isEdge = session.ua.includes('Edg');
  const platform = session.ua.includes('Macintosh') ? 'macOS'
    : session.ua.includes('Linux') ? 'Linux'
    : session.ua.includes('Windows') ? 'Windows' : 'Windows';

  const headers: Record<string, string> = {
    'User-Agent': session.ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'sl-SI,sl;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Referer': referer,
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
  };

  // Chrome/Edge specific
  if (!isFirefox && !isSafari) {
    const secChUa = isEdge
      ? '"Microsoft Edge";v="125", "Chromium";v="125", "Not.A/Brand";v="24"'
      : '"Chromium";v="125", "Google Chrome";v="125", "Not.A/Brand";v="24"';
    headers['Sec-Ch-Ua'] = secChUa;
    headers['Sec-Ch-Ua-Mobile'] = '?0';
    headers['Sec-Ch-Ua-Platform'] = `"${platform}"`;
    headers['Sec-Fetch-Dest'] = 'document';
    headers['Sec-Fetch-Mode'] = 'navigate';
    headers['Sec-Fetch-Site'] = 'same-origin'; // v7.40: same-origin (more natural)
    headers['Sec-Fetch-User'] = '?1';
  }

  // v7.40: Add cookies if we have them (Cloudflare cf_clearance etc.)
  if (session.cookies.size > 0) {
    headers['Cookie'] = Array.from(session.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  return { ...headers, ...(extra || {}) };
}

// v7.40: Extract Set-Cookie from response and store in session
function extractCookies(response: Response, session: { ua: string; cookies: Map<string, string> }) {
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    // Parse Set-Cookie header (can have multiple cookies)
    const cookies = setCookie.split(/,(?=\s*\w+=)/);
    for (const cookie of cookies) {
      const match = cookie.match(/^([^=]+)=([^;]*)/);
      if (match) {
        session.cookies.set(match[1].trim(), match[2].trim());
      }
    }
  }
}

// v7.40: Exponential backoff with jitter
function backoffDelay(attempt: number): number {
  const base = Math.min(1000 * Math.pow(2, attempt), 30000); // max 30s
  const jitter = Math.random() * 1000;
  return base + jitter;
}

const MAX_RETRIES = 3;
const RETRY_STATUS_CODES = new Set([429, 503, 502, 504]);

export async function fetchWithAntiDetection(
  url: string,
  opts: { headers?: Record<string, string>; method?: string; skipCache?: boolean } = {}
): Promise<Response> {
  // v9.67: Preveri HTML cache (1h TTL) — ne fetchaj iste strani dvakrat
  if (!opts.skipCache) {
    const cached = getCachedHtml(url);
    if (cached) {
      logger.info('anti-detection', `HTML cache hit: ${url.slice(0, 60)}...`);
      // Vrni Response-like objekt (cached)
      return new Response(cached.html, {
        status: cached.status,
        headers: { 'Content-Type': 'text/html', 'X-Cache': 'HIT' },
      });
    }
  }

  const s = await getSettings();
  const domain = getDomain(url);
  const session = getDomainSession(domain);

  // v7.40: Gaussian delay (more human-like)
  if (s.requestMinDelay > 0 && s.requestMaxDelay >= s.requestMinDelay) {
    const delay = gaussianRandom(s.requestMinDelay, s.requestMaxDelay);
    await new Promise(r => setTimeout(r, delay));
  }

  const headers = buildHeaders(s.realisticHeaders, url, session, opts.headers);

  // v9.67: Session-sticky proxy — isti proxy za isto domeno v 30-min oknu
  let dispatcher: Dispatcher | undefined;
  if (s.proxyEnabled && s.proxyList.length > 0) {
    const proxy = getSessionStickyProxy(domain, s.proxyList);
    if (proxy) {
      try {
        dispatcher = new ProxyAgent({ uri: proxy.url });
        logger.info('anti-detection', `Session-sticky proxy for ${domain}: ${proxy.url.replace(/\/\/[^@]*@/, '//***@')}`);
      } catch { /* fall through */ }
    }
  }

  // v7.40: Retry loop with exponential backoff
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const fetchFn = dispatcher ? undiciFetch : fetch;
      const fetchOpts: any = {
        method: opts.method || 'GET',
        headers,
        redirect: 'follow',
        ...(dispatcher ? { dispatcher } : {}),
      };

      const res = dispatcher
        ? (await undiciFetch(url, fetchOpts)) as unknown as Response
        : await fetch(url, fetchOpts);

      // v7.40: Extract and store cookies (Cloudflare cf_clearance etc.)
      extractCookies(res, session);

      // v7.40: Handle 429 (rate limited) with retry
      if (RETRY_STATUS_CODES.has(res.status) && attempt < MAX_RETRIES) {
        const retryAfter = res.headers.get('Retry-After');
        const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : backoffDelay(attempt);
        logger.warn('anti-detection', `${res.status} from ${domain} — retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(waitMs / 1000)}s`);
        await new Promise(r => setTimeout(r, waitMs));

        // v7.40: Rotate UA on retry (different "browser" on retry)
        session.ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
        const newHeaders = buildHeaders(s.realisticHeaders, url, session, opts.headers);
        Object.assign(headers, newHeaders);
        continue;
      }

      // v9.67: Shrani v HTML cache (samo za uspešne GET, ne za cached)
      if (!opts.skipCache && res.ok && (!opts.method || opts.method === 'GET')) {
        try {
          const cloned = res.clone();
          const html = await cloned.text();
          setCachedHtml(url, html, res.status);
          logger.info('anti-detection', `HTML cached: ${url.slice(0, 60)}... (${Math.round(html.length / 1024)}KB)`);
        } catch {
          // ignore — don't fail request if cache fails
        }
      }

      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        const waitMs = backoffDelay(attempt);
        logger.warn('anti-detection', `Fetch error from ${domain} — retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(waitMs / 1000)}s: ${lastError.message}`);
        await new Promise(r => setTimeout(r, waitMs));
        // Rotate UA
        session.ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
        continue;
      }
    }
  }

  // All retries exhausted
  throw lastError ?? new Error(`Failed to fetch ${url} after ${MAX_RETRIES + 1} attempts`);
}

/**
 * v7.40: Check if HTML is a Cloudflare/bot challenge page.
 * Used by scrapers to decide whether to fall back to Playwright.
 */
export function isCloudflareChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('cf-challenge') ||
    lower.includes('cf-mitigated') ||
    lower.includes('cf-browser-verification') ||
    lower.includes('cf-challenge-running') ||
    lower.includes('just a moment...') ||
    lower.includes('attention required! | cloudflare') ||
    (lower.includes('cloudflare') && lower.includes('ray id') && html.length < 5000) ||
    lower.includes('ddos protection by cloudflare') ||
    lower.includes('enable javascript and cookies to continue')
  );
}

/**
 * v7.40: Check if response indicates bot detection (non-Cloudflare).
 */
export function isBotDetection(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('g-recaptcha') ||
    lower.includes('hcaptcha') ||
    lower.includes('captcha-challenge') ||
    lower.includes('are you a robot') ||
    lower.includes('bot detection') ||
    lower.includes('access denied') ||
    lower.includes('blocked') && lower.includes('automated')
  );
}

/**
 * Reset all caches (for tests + settings changes).
 */
export function resetAntiDetectionCache(): void {
  cached = null;
  domainSessions.clear();
  domainProxyAssignment.clear(); // v9.67: clear session-sticky proxy assignments
  htmlCache.clear(); // v9.67: clear HTML cache
}
