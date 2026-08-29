/**
 * Shared Playwright browser fallback — eliminates 3× duplicated Playwright logic.
 *
 * All scrapers (Bolha, mobile.de, foreign) use the same browser launch + anti-detection pattern.
 * This module provides:
 * - launchBrowser() — shared browser launch with anti-detection
 * - withPlaywrightFallback() — try scraper, fallback to Playwright on Cloudflare/CAPTCHA
 */

import { randomUA, isCloudflareChallenge, isCaptchaPage, dedupByUrl } from './scraper-helpers';
import type { ScrapedListing, ScraperFilters } from './scraper';

const TIMEZONE_MAP: Record<string, string> = {
  'de-DE': 'Europe/Berlin',
  'it-IT': 'Europe/Rome',
  'de-AT': 'Europe/Vienna',
  'sl-SI': 'Europe/Ljubljana',
};

const LOCALE_ACCEPT_LANG: Record<string, string> = {
  'de-DE': 'de-DE,de;q=0.9,en;q=0.7',
  'it-IT': 'it-IT,it;q=0.9,en;q=0.7',
  'de-AT': 'de-AT,de;q=0.9,en;q=0.7',
  'sl-SI': 'sl-SI,sl;q=0.9,en-US;q=0.8,en;q=0.7',
};

interface LaunchOptions {
  locale?: string;
  viewport?: { width: number; height: number };
}

/**
 * Launch a Playwright browser with anti-detection measures.
 * Returns { chromium, browser, context, close } — caller must close when done.
 */
export async function launchBrowser(opts: LaunchOptions = {}) {
  let chromium: any;
  try {
    chromium = await import('playwright').then(m => m.chromium);
  } catch {
    throw new Error('Playwright ni nameščen. Poženi: bun add playwright && bunx playwright install chromium');
  }

  const locale = opts.locale || 'sl-SI';
  const viewport = opts.viewport || { width: 1920, height: 1080 };

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-infobars',
      `--window-size=${viewport.width},${viewport.height}`,
    ],
  });

  const context = await browser.newContext({
    userAgent: randomUA(),
    viewport,
    locale,
    timezoneId: TIMEZONE_MAP[locale] || 'Europe/London',
    extraHTTPHeaders: {
      'Accept-Language': LOCALE_ACCEPT_LANG[locale] || 'en-US,en;q=0.9',
    },
  });

  // Anti-detection: hide webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    (window as any).chrome = { runtime: {} };
  });

  return {
    chromium,
    browser,
    context,
    async close() {
      try { await browser.close(); } catch { /* ignore */ }
    },
  };
}

/**
 * Fetch page HTML via Playwright with Cloudflare wait.
 * Returns the final HTML after JS rendering.
 */
export async function fetchWithPlaywright(
  url: string,
  opts: {
    locale?: string;
    waitForSelector?: string;
    waitMs?: number;
    timeoutMs?: number;
  } = {}
): Promise<string> {
  const { browser, context, close } = await launchBrowser({ locale: opts.locale });

  try {
    const page = await context.newPage();
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: opts.timeoutMs || 30_000,
    });

    // Wait for content or fallback to timeout
    if (opts.waitForSelector) {
      try {
        await page.waitForSelector(opts.waitForSelector, { timeout: 15_000 });
      } catch {
        // Cloudflare might still be clearing — wait extra
        await page.waitForTimeout(opts.waitMs || 3000);
      }
    } else {
      await page.waitForTimeout(opts.waitMs || 2000);
    }

    const html = await page.content();
    if (isCloudflareChallenge(html) || isCaptchaPage(html)) {
      throw new Error('Cloudflare/CAPTCHA blokada tudi s Playwright');
    }
    return html;
  } finally {
    await close();
  }
}

/**
 * Generic Playwright fallback — parses HTML with Cheerio after browser render.
 * Used by mobile.de and foreign scrapers.
 *
 * @param html - The rendered HTML from Playwright
 * @param selectors - CSS selectors to try for listing items
 * @param parser - Function to parse a single Cheerio element into a listing
 */
export function parsePlaywrightHtml<T>(
  html: string,
  selectors: string[],
  parser: ($el: ReturnType<any>, html: string) => T | null,
): T[] {
  // Dynamic import to avoid circular deps
  let cheerio: any;
  try {
    cheerio = require('cheerio');
  } catch {
    return [];
  }
  const $ = cheerio.load(html);
  const results: T[] = [];

  let items: any[] = [];
  for (const sel of selectors) {
    items = $(sel).toArray();
    if (items.length > 0) break;
  }

  for (const el of items) {
    const $el = $(el);
    const result = parser($el, html);
    if (result) results.push(result);
  }

  return results;
}

/**
 * Wrap a scraper function with Playwright fallback.
 * If the main scraper fails with Cloudflare/CAPTCHA, try Playwright.
 *
 * @param scraperFn - The main (fast) scraper function
 * @param playwrightParser - Function to parse Playwright-rendered HTML
 * @param opts - Playwright locale and config
 */
export async function withPlaywrightFallback<T>(
  scraperFn: () => Promise<T[]>,
  playwrightParser: (html: string) => Promise<T[]>,
  opts: { locale?: string; playwrightEnabled?: boolean } = {},
): Promise<T[]> {
  try {
    const result = await scraperFn();
    if (result.length > 0) return result;
    // 0 results might mean JS-rendered page — try Playwright
    if (opts.playwrightEnabled) {
      return await playwrightParser(''); // empty html triggers full Playwright fetch
    }
    return result;
  } catch (e: any) {
    const errMsg = String(e?.message ?? '').toLowerCase();
    if (opts.playwrightEnabled && (
      errMsg.includes('cloudflare') ||
      errMsg.includes('captcha') ||
      errMsg.includes('prekratko')
    )) {
      return await playwrightParser('');
    }
    throw e;
  }
}
