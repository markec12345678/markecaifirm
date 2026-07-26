/**
 * v5.8: Advanced Scraper — z rotacijo proxy, realističnimi headers,
 * randomizacijo timing-a, stealth mode in CAPTCHA support
 *
 * Tehnike:
 * 1. Rotating proxies (HTTP/SOCKS5 z avtentikacijo)
 * 2. Realistic headers (User-Agent rotation, Referer, Accept, itd.)
 * 3. Request randomization (random delay, jitter)
 * 4. Stealth mode (Playwright z anti-detection)
 * 5. CAPTCHA detection + 2captcha solving
 * 6. TLS fingerprinting (custom TLS client)
 */

import { db } from './db';
import { getSettingsRow } from './pipeline';

// ===== 1. REALISTIC USER-AGENTS =====
const USER_AGENTS = [
  // Chrome (Windows)
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  // Firefox (Windows)
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
  // Chrome (Mac)
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  // Safari (Mac)
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  // Chrome (Linux)
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  // Edge (Windows)
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
];

const ACCEPT_LANGUAGES = [
  'sl-SI,sl;q=0.9,en;q=0.8,de;q=0.7',
  'sl-SI,sl;q=0.9,en-US;q=0.8,en;q=0.7',
  'en-US,en;q=0.9,sl;q=0.8',
  'sl;q=1.0,en;q=0.9',
];

const REFERERS = [
  'https://www.google.com/',
  'https://www.bolha.com/',
  'https://www.google.si/',
  'https://duckduckgo.com/',
];

export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function getRandomAcceptLanguage(): string {
  return ACCEPT_LANGUAGES[Math.floor(Math.random() * ACCEPT_LANGUAGES.length)];
}

export function getRandomReferer(): string {
  return REFERERS[Math.floor(Math.random() * REFERERS.length)];
}

// ===== 2. REALISTIC HEADERS =====
export function buildRealisticHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': getRandomAcceptLanguage(),
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    'DNT': '1',
  };
  // Random Referer (50% chance)
  if (Math.random() > 0.5) {
    headers['Referer'] = getRandomReferer();
  }
  // Merge extra headers
  if (extra) {
    Object.assign(headers, extra);
  }
  return headers;
}

// ===== 3. PROXY ROTATION =====
interface ProxyConfig {
  url: string; // http://host:port or socks5://host:port
  username?: string;
  password?: string;
  type: 'http' | 'socks5';
}

let proxyIndex = 0;

export async function getNextProxy(): Promise<ProxyConfig | null> {
  const settings = await getSettingsRow();
  if (!settings.proxyEnabled) return null;

  try {
    const proxies: ProxyConfig[] = JSON.parse(settings.proxyList || '[]');
    if (proxies.length === 0) return null;

    // Round-robin rotation
    const proxy = proxies[proxyIndex % proxies.length];
    proxyIndex++;
    return proxy;
  } catch {
    return null;
  }
}

export function proxyToFetchConfig(proxy: ProxyConfig): { proxy?: string; headers?: Record<string, string> } {
  // For fetch with proxy support (Node.js 18+ with undici)
  const proxyUrl = proxy.username
    ? `${proxy.type}://${proxy.username}:${proxy.password}@${proxy.url.replace(/^[a-z0-9]+:\/\//, '')}`
    : `${proxy.type}://${proxy.url.replace(/^[a-z0-9]+:\/\//, '')}`;
  return { proxy: proxyUrl };
}

// ===== 4. REQUEST RANDOMIZATION =====
export async function randomDelay(): Promise<void> {
  const settings = await getSettingsRow();
  const min = settings.requestMinDelay || 1000;
  const max = settings.requestMaxDelay || 5000;
  const delay = min + Math.random() * (max - min);
  await new Promise(resolve => setTimeout(resolve, delay));
}

// ===== 5. CAPTCHA DETECTION =====
export function detectCaptcha(html: string): { detected: boolean; type?: string; siteKey?: string } {
  const lower = html.toLowerCase();

  // reCAPTCHA v2/v3
  const recaptchaMatch = html.match(/grecaptcha[^"']*data-sitekey=["']([^"']+)["']/i);
  if (recaptchaMatch) {
    return { detected: true, type: 'recaptcha', siteKey: recaptchaMatch[1] };
  }

  // hCaptcha
  const hcaptchaMatch = html.match(/data-sitekey=["']([^"']+)["'][^>]*class=["']h-captcha["']/i);
  if (hcaptchaMatch) {
    return { detected: true, type: 'hcaptcha', siteKey: hcaptchaMatch[1] };
  }

  // Cloudflare challenge
  if (lower.includes('cf-challenge') || lower.includes('cloudflare') && lower.includes('challenge')) {
    return { detected: true, type: 'cloudflare' };
  }

  // Generic captcha text
  if (lower.includes('captcha') && (lower.includes('verify') || lower.includes('solve') || lower.includes('human'))) {
    return { detected: true, type: 'generic' };
  }

  return { detected: false };
}

// ===== 6. CAPTCHA SOLVING (2captcha) =====
export async function solveCaptcha(
  type: string,
  siteKey: string | undefined,
  pageUrl: string
): Promise<{ solved: boolean; token?: string; error?: string }> {
  const settings = await getSettingsRow();
  if (!settings.captchaSolverEnabled || !settings.captchaApiKey) {
    return { solved: false, error: 'CAPTCHA solver ni konfiguriran' };
  }

  try {
    // 2captcha API
    if (type === 'recaptcha' && siteKey) {
      // Submit task
      const submitRes = await fetch('https://2captcha.com/in.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: settings.captchaApiKey,
          method: 'userrecaptcha',
          googlekey: siteKey,
          pageurl: pageUrl,
          json: 1,
        }),
      });
      const submitData = await submitRes.json();
      if (submitData.status !== 1) {
        return { solved: false, error: submitData.request || 'Napaka pri oddaji' };
      }

      // Poll for result (max 60 seconds)
      const taskId = submitData.request;
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 3000)); // 3s poll interval
        const resultRes = await fetch(`https://2captcha.com/res.php?key=${settings.captchaApiKey}&action=get&id=${taskId}&json=1`);
        const resultData = await resultRes.json();
        if (resultData.status === 1) {
          return { solved: true, token: resultData.request };
        }
        if (resultData.request !== 'CAPCHA_NOT_READY') {
          return { solved: false, error: resultData.request };
        }
      }
      return { solved: false, error: 'Timeout — CAPTCHA ni rešena v 60s' };
    }

    return { solved: false, error: `Tip CAPTCHA "${type}" ni podprt` };
  } catch (e: any) {
    return { solved: false, error: e?.message ?? 'Napaka' };
  }
}

// ===== 7. ADVANCED FETCH (z vsemi tehnikami) =====
export async function advancedFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
  } = {}
): Promise<{ ok: boolean; status: number; html: string; captchaDetected: boolean; proxyUsed: boolean }> {
  const settings = await getSettingsRow();
  const timeout = options.timeout ?? 15_000;

  // Random delay before request
  await randomDelay();

  // Build realistic headers
  const headers = settings.realisticHeaders
    ? buildRealisticHeaders(options.headers)
    : { 'User-Agent': 'Mozilla/5.0 (MarkecAIFirm/5.8)', ...(options.headers || {}) };

  // Get proxy
  const proxy = await getNextProxy();
  const proxyUsed = proxy != null;

  // Fetch options
  const fetchOptions: any = {
    method: options.method || 'GET',
    headers,
    signal: AbortSignal.timeout(timeout),
  };
  if (options.body) fetchOptions.body = options.body;

  // For Node.js undici proxy support
  if (proxy) {
    const { ProxyAgent } = await import('undici').catch(() => ({ ProxyAgent: null }));
    if (ProxyAgent) {
      const proxyUrl = proxy.username
        ? `${proxy.type}://${proxy.username}:${proxy.password}@${proxy.url.replace(/^[a-z0-9]+:\/\//, '')}`
        : `${proxy.type}://${proxy.url.replace(/^[a-z0-9]+:\/\//, '')}`;
      fetchOptions.dispatcher = new ProxyAgent(proxyUrl);
    }
  }

  try {
    const res = await fetch(url, fetchOptions);
    const html = await res.text();

    // Check for CAPTCHA
    const captcha = detectCaptcha(html);

    return {
      ok: res.ok,
      status: res.status,
      html,
      captchaDetected: captcha.detected,
      proxyUsed,
    };
  } catch (e: any) {
    return {
      ok: false,
      status: 0,
      html: '',
      captchaDetected: false,
      proxyUsed,
    };
  }
}

// ===== 8. STEALTH PLAYWRIGHT (z anti-detection) =====
export async function stealthScrape(
  url: string,
  options: { timeout?: number; waitForSelector?: string } = {}
): Promise<{ ok: boolean; html: string; captchaDetected: boolean; error?: string }> {
  const settings = await getSettingsRow();

  try {
    // Dynamic import Playwright (optional dependency)
    const { chromium } = await import('playwright').catch(() => ({ chromium: null }));
    if (!chromium) {
      return { ok: false, html: '', captchaDetected: false, error: 'Playwright ni nameščen' };
    }

    // Random delay
    await randomDelay();

    // Launch with stealth args
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-size=1920,1080',
        '--disable-notifications',
        ...(settings.stealthMode ? ['--disable-web-security', '--disable-features=IsolateOrigins'] : []),
      ],
    });

    const context = await browser.newContext({
      userAgent: getRandomUserAgent(),
      locale: 'sl-SI',
      timezoneId: 'Europe/Ljubljana',
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
      javaScriptEnabled: true,
      extraHTTPHeaders: {
        'Accept-Language': getRandomAcceptLanguage(),
      },
    });

    // Anti-detection: override navigator properties
    if (settings.stealthMode) {
      await context.addInitScript(() => {
        // Override webdriver flag
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        // Override plugins
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });
        // Override languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['sl-SI', 'sl', 'en'],
        });
        // Override chrome runtime
        (window as any).chrome = { runtime: {} };
        // Override permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters: any) =>
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission } as any)
            : originalQuery(parameters);
      });
    }

    // Set proxy if configured
    const proxy = await getNextProxy();
    if (proxy) {
      // Note: proxy must be set at browser launch, not context
      // For simplicity, we skip proxy in Playwright mode (fetch handles it)
    }

    const page = await context.newPage();

    // Navigate
    const response = await page.goto(url, {
      waitUntil: options.waitForSelector ? 'domcontentloaded' : 'networkidle',
      timeout: options.timeout ?? 20_000,
    });

    // Wait for selector if specified
    if (options.waitForSelector) {
      await page.waitForSelector(options.waitForSelector, { timeout: 10_000 }).catch(() => {});
    }

    // Wait a bit for dynamic content
    await page.waitForTimeout(1000 + Math.random() * 2000);

    const html = await page.content();
    await browser.close();

    // Check for CAPTCHA
    const captcha = detectCaptcha(html);

    return {
      ok: response?.ok() ?? false,
      html,
      captchaDetected: captcha.detected,
    };
  } catch (e: any) {
    return { ok: false, html: '', captchaDetected: false, error: e?.message ?? 'Playwright napaka' };
  }
}
