/**
 * Shared scraper helpers — eliminates duplication across scraper.ts, scraper-mobile-de.ts, scraper-foreign.ts.
 *
 * Exports:
 * - hashExternalId(input) — FNV-1a hash (stable, no crypto)
 * - parsePrice(text) — simple regex price extraction
 * - parsePriceMultiFormat(text) — handles €, VB, German/Italian formats
 * - applyFilters(listings, filters) — keyword/price filtering
 * - randomUA() — picks random User-Agent from pool
 * - isCloudflareChallenge(html) — detect Cloudflare challenge
 * - isCaptchaPage(html) — detect CAPTCHA page
 * - buildRealHeaders(locale?) — realistic browser headers
 * - dedupByUrl(listings) — remove duplicate listings by URL
 */

import type { ScrapedListing, ScraperFilters } from './scraper';

// ── User-Agent Pool ──────────────────────────────────────────────────────────
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
];

/** Pick a random User-Agent from the shared pool. */
export function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ── Hash ─────────────────────────────────────────────────────────────────────

/** FNV-1a hash — stable across runs, no crypto dependency. */
export function hashExternalId(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Simple numeric hash for cases where string ID isn't needed. */
export function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// ── Price Parsing ────────────────────────────────────────────────────────────

/**
 * Simple regex price extraction — handles "350 €", "1.234 €", "1234 EUR".
 * Returns numeric price rounded to integer, or null if not found.
 */
export function parsePrice(text: string): { priceText: string; price: number | null } {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return { priceText: '', price: null };
  const m = t.match(/(\d[\d.\s]*\d|\d)/);
  if (!m) return { priceText: t, price: null };
  const n = parseInt(m[1].replace(/[\s.]/g, ''), 10);
  return { priceText: t, price: isNaN(n) ? null : n };
}

/**
 * Multi-format price parser — handles:
 * - "1.234,56 €" (German)
 * - "€ 1,234.56" (English)
 * - "1234€"
 * - "VB" / "Verhandlungsbasis" / "po dogovoru" (negotiable)
 * - Italian variants
 */
export function parsePriceMultiFormat(text: string): { priceText: string; price: number | null } {
  if (!text) return { priceText: '', price: null };
  const lower = text.toLowerCase().trim();

  // Negotiable variants
  if (lower === 'vb' || lower.includes('verhandlungsbasis') || lower.includes('po dogovoru') ||
      lower.includes('su richiesta') || lower.includes('auf anfrage')) {
    return { priceText: 'po dogovoru', price: null };
  }

  // Shipping-only price — not the main price
  if (lower.startsWith('versand') || lower.startsWith('spese di spedizione')) {
    return { priceText: text.trim(), price: null };
  }

  // Clean and normalize
  let cleaned = text.replace(/€/g, '').replace(/EUR/gi, '').trim();
  if (cleaned.includes('.') && cleaned.includes(',')) {
    // Determine which is the decimal separator
    if (cleaned.lastIndexOf('.') < cleaned.lastIndexOf(',')) {
      // 1.234,56 → 1234.56
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // 1,234.56 → 1234.56
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    // 1234,56 → 1234.56
    cleaned = cleaned.replace(',', '.');
  }
  cleaned = cleaned.replace(/[^\d.]/g, '');
  const price = parseFloat(cleaned);
  if (Number.isFinite(price) && price > 0) {
    return { priceText: `${Math.round(price)} €`, price: Math.round(price) };
  }
  return { priceText: text.trim(), price: null };
}

// ── Filtering ────────────────────────────────────────────────────────────────

/** Apply keyword exclusion, keyword inclusion, and price range filters. */
export function applyFilters(listings: ScrapedListing[], f: ScraperFilters): ScrapedListing[] {
  let out = listings;
  if (f.keywords && f.keywords.length > 0) {
    const kws = f.keywords.map(k => k.toLowerCase().trim()).filter(Boolean);
    if (kws.length > 0) {
      out = out.filter(l => {
        const blob = `${l.title} ${l.description ?? ''}`.toLowerCase();
        return kws.some(k => blob.includes(k));
      });
    }
  }
  if (f.excludeKeywords && f.excludeKeywords.length > 0) {
    const ex = f.excludeKeywords.map(k => k.toLowerCase().trim()).filter(Boolean);
    if (ex.length > 0) {
      out = out.filter(l => {
        const blob = `${l.title} ${l.description ?? ''}`.toLowerCase();
        return !ex.some(k => blob.includes(k));
      });
    }
  }
  if (f.minPrice != null) {
    out = out.filter(l => l.price != null && l.price >= f.minPrice!);
  }
  if (f.maxPrice != null) {
    out = out.filter(l => l.price != null && l.price <= f.maxPrice!);
  }
  return out;
}

// ── Deduplication ────────────────────────────────────────────────────────────

/** Remove duplicate listings by URL (preserves first occurrence). */
export function dedupByUrl(listings: ScrapedListing[]): ScrapedListing[] {
  const seen = new Set<string>();
  return listings.filter(l => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
}

// ── Bot Detection ────────────────────────────────────────────────────────────

/**
 * Detect Cloudflare challenge page.
 * Canonical implementation — use this everywhere instead of local copies.
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

/** Detect CAPTCHA pages (reCAPTCHA, hCaptcha, etc.). */
export function isCaptchaPage(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('g-recaptcha') ||
    lower.includes('hcaptcha') ||
    lower.includes('data-sitekey') ||
    lower.includes('captcha-challenge')
  );
}

// ── Headers ──────────────────────────────────────────────────────────────────

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

/**
 * Build realistic browser headers with platform-specific referer.
 * @param locale - 'sl-SI' (default), 'de-DE', 'it-IT', 'de-AT'
 */
export function buildRealHeaders(locale: 'sl-SI' | 'de-DE' | 'it-IT' | 'de-AT' = 'sl-SI'): Record<string, string> {
  const acceptLang = locale === 'de-DE' ? 'de-DE,de;q=0.9,en;q=0.7' :
                     locale === 'it-IT' ? 'it-IT,it;q=0.9,en;q=0.7' :
                     locale === 'de-AT' ? 'de-AT,de;q=0.9,en;q=0.7' :
                     'sl-SI,sl;q=0.9,en-US;q=0.8,en;q=0.7';
  return {
    'User-Agent': randomUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': acceptLang,
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Chromium";v="125", "Google Chrome";v="125", "Not-A/Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
}
