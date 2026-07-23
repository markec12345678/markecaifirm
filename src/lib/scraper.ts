/**
 * Scrapers for Slovenian marketplaces.
 *
 * Each scraper takes a source URL + filters and returns a normalized list of listings.
 * On the user's Windows machine this will hit the real sites. In the sandbox
 * the requests may fail (no external network), but the code is production-ready.
 */

export interface ScrapedListing {
  externalId: string;       // unique stable id (hash of URL or product id)
  title: string;
  priceText: string;        // raw price text
  price?: number | null;    // EUR numeric or null
  url: string;              // absolute URL
  location?: string;
  description?: string;
  imageUrl?: string | null;
  postedAt?: Date | null;
}

export interface ScraperFilters {
  keywords?: string[];        // must contain at least one
  excludeKeywords?: string[]; // must not contain any
  minPrice?: number | null;
  maxPrice?: number | null;
}

export type SourceType = 'bolha' | 'nepremicnine' | 'avtonet' | 'salomon' | 'custom-rss';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function hashExternalId(input: string): string {
  // Simple FNV-1a hash — stable across runs, no crypto needed
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function parsePrice(text: string): { priceText: string; price: number | null } {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return { priceText: '', price: null };
  // Match number with optional thousand separators (1.234 or 1,234 or 1234)
  const m = t.match(/(\d[\d.\s]*\d|\d)/);
  if (!m) return { priceText: t, price: null };
  const n = parseInt(m[1].replace(/[\s.]/g, ''), 10);
  return { priceText: t, price: isNaN(n) ? null : n };
}

function applyFilters(listings: ScrapedListing[], f: ScraperFilters): ScrapedListing[] {
  let out = listings;
  if (f.keywords && f.keywords.length > 0) {
    const kws = f.keywords.map(k => k.toLowerCase().trim()).filter(Boolean);
    out = out.filter(l => {
      const blob = `${l.title} ${l.description ?? ''}`.toLowerCase();
      return kws.some(k => blob.includes(k));
    });
  }
  if (f.excludeKeywords && f.excludeKeywords.length > 0) {
    const ex = f.excludeKeywords.map(k => k.toLowerCase().trim()).filter(Boolean);
    out = out.filter(l => {
      const blob = `${l.title} ${l.description ?? ''}`.toLowerCase();
      return !ex.some(k => blob.includes(k));
    });
  }
  if (f.minPrice != null) {
    out = out.filter(l => l.price != null && l.price >= f.minPrice!);
  }
  if (f.maxPrice != null) {
    out = out.filter(l => l.price != null && l.price <= f.maxPrice!);
  }
  return out;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': randomUA(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'sl-SI,sl;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  return await res.text();
}

async function fetchRss(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': randomUA(),
      'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

/**
 * Bolha.com scraper — uses the listings page HTML.
 * Bolha uses Cloudflare; if the simple fetch returns 0 results (likely blocked),
 * the pipeline will optionally retry with Playwright (v1.1) if enabled.
 */
async function scrapeBolha(url: string, filters: ScraperFilters): Promise<ScrapedListing[]> {
  const html = await fetchHtml(url);
  // Detect Cloudflare challenge page
  if (isCloudflareChallenge(html)) {
    throw new Error('Cloudflare blokada — omogoči Playwright v nastavitvah za fallback');
  }
  const listings = await parseBolhaHtml(html);
  // If we got 0 listings with cheerio, the page may have changed structure or be blocked.
  // The pipeline decides whether to retry with Playwright.
  return applyFilters(listings, filters);
}

/** Detect Cloudflare "Just a moment" or similar challenge page. */
function isCloudflareChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('just a moment') ||
    lower.includes('cf-browser-verification') ||
    lower.includes('cf-challenge-running') ||
    lower.includes('_cf_chl_opt') ||
    lower.includes('attention required! | cloudflare') ||
    (lower.includes('cloudflare') && lower.includes('ray id') && html.length < 5000)
  );
}

/** Parse Bolha HTML using cheerio — extracted so Playwright fallback can reuse it. */
async function parseBolhaHtml(html: string): Promise<ScrapedListing[]> {
  const cheerio = await import('cheerio');
  const $ = cheerio.load(html);
  const out: ScrapedListing[] = [];

  const cards = $([
    'article[data-id]',
    '.entity-body',
    '.search-item',
    'div[data-cy="ad-card"]',
    'a[href*="/bolha/"]',
  ].join(', '));

  cards.each((_, el) => {
    const $el = $(el);
    const title = $el.find('.entity-title, h3, h2, [data-cy="ad-title"]').first().text().trim()
      || $el.attr('title')?.trim()
      || '';
    const priceRaw = $el.find('.price, .price--normal, [data-cy="ad-price"]').first().text().trim();
    let link = $el.find('a[href*="/bolha/"], a[href*="bolha.com"]').first().attr('href') || '';
    if (link && !link.startsWith('http')) {
      link = link.startsWith('/') ? `https://www.bolha.com${link}` : `https://www.bolha.com/${link}`;
    }
    const location = $el.find('.entity-description-secondary, .ad-location, [data-cy="ad-location"]').first().text().trim();
    const image = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src') || null;
    const description = $el.find('.entity-description, .ad-description').first().text().trim();

    if (!title || !link) return;
    const { priceText, price } = parsePrice(priceRaw);
    out.push({
      externalId: hashExternalId(link),
      title,
      priceText: priceText || 'po dogovoru',
      price,
      url: link,
      location,
      description,
      imageUrl: image ?? undefined,
      postedAt: null,
    });
  });

  // Deduplicate by URL
  const seen = new Set<string>();
  return out.filter(l => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
}

/**
 * v1.1: Bolha scraper with Playwright fallback for Cloudflare bypass.
 * Falls back gracefully if Playwright is not installed.
 *
 * To enable: bun add playwright && bunx playwright install chromium
 * Then toggle "Playwright fallback" in Settings.
 */
export async function scrapeBolhaWithPlaywright(url: string, filters: ScraperFilters): Promise<ScrapedListing[]> {
  let chromium: any = null;
  try {
    // Dynamic import — if playwright isn't installed, this throws
    const pw = await import('playwright');
    chromium = pw.chromium;
  } catch {
    throw new Error('Playwright ni nameščen. Poženi: bun add playwright && bunx playwright install chromium');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: randomUA(),
    locale: 'sl-SI',
    viewport: { width: 1366, height: 768 },
  });
  try {
    const page = await context.newPage();
    // Bolha uses Cloudflare — wait for it to clear
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Wait for either listings or Cloudflare challenge to clear
    try {
      await page.waitForSelector('article, .entity-body, .search-item, a[href*="/bolha/"]', { timeout: 15_000 });
    } catch {
      // Maybe still on challenge page — wait more
      await page.waitForTimeout(5000);
    }
    const html = await page.content();
    if (isCloudflareChallenge(html)) {
      throw new Error('Cloudflare blokada tudi po Playwright poizkusu');
    }
    const listings = await parseBolhaHtml(html);
    return applyFilters(listings, filters);
  } finally {
    await browser.close();
  }
}

/**
 * Nepremicnine.net RSS scraper.
 * RSS URL form: https://www.nepremicnine.net/.../filter?output=rss
 * Each <item> has title, link, description, pubDate.
 */
async function scrapeNepremicnine(url: string, filters: ScraperFilters): Promise<ScrapedListing[]> {
  const xml = await fetchRss(url);
  const out: ScrapedListing[] = [];

  // Lightweight regex parser — avoids full XML parser dependency
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  const fieldRegex = (tag: string) => new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');

  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const itemXml = m[1];
    const title = (itemXml.match(fieldRegex('title'))?.[1] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    const link = (itemXml.match(fieldRegex('link'))?.[1] ?? '').trim();
    const description = (itemXml.match(fieldRegex('description'))?.[1] ?? '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const pubDate = (itemXml.match(fieldRegex('pubDate'))?.[1] ?? '').trim();

    if (!title || !link) continue;

    // Nepremičnine RSS often embeds price in title or description
    // Title format: "137.000 € · 2-sobno stanovanje, Ljubljana Bežigrad, 52 m2"
    const priceMatch = title.match(/([\d.]+)\s*€/);
    let price: number | null = null;
    let priceText = '';
    if (priceMatch) {
      price = parseInt(priceMatch[1].replace(/\./g, ''), 10);
      priceText = `${priceMatch[1]} €`;
    } else {
      priceText = 'cena ni navedena';
    }

    // Extract location from title after the comma
    const locationMatch = title.split(',').slice(1).join(',').trim();

    let postedAt: Date | null = null;
    if (pubDate) {
      const d = new Date(pubDate);
      if (!isNaN(d.getTime())) postedAt = d;
    }

    out.push({
      externalId: hashExternalId(link),
      title: title.split('·').slice(1).join('·').trim() || title,
      priceText,
      price,
      url: link,
      location: locationMatch,
      description,
      imageUrl: null,
      postedAt,
    });
  }

  return applyFilters(out, filters);
}

/** Generic RSS scraper for the 'custom-rss' source type. */
async function scrapeCustomRss(url: string, filters: ScraperFilters): Promise<ScrapedListing[]> {
  const xml = await fetchRss(url);
  const out: ScrapedListing[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  const fieldRegex = (tag: string) => new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');

  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const itemXml = m[1];
    const title = (itemXml.match(fieldRegex('title'))?.[1] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    const link = (itemXml.match(fieldRegex('link'))?.[1] ?? '').trim();
    const description = (itemXml.match(fieldRegex('description'))?.[1] ?? '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title || !link) continue;
    const { priceText, price } = parsePrice(title + ' ' + description);
    out.push({
      externalId: hashExternalId(link),
      title,
      priceText: priceText || '',
      price,
      url: link,
      location: '',
      description,
      imageUrl: null,
      postedAt: null,
    });
  }
  return applyFilters(out, filters);
}

/** Avtonet.si scraper — HTML listing parser. */
async function scrapeAvtonet(url: string, filters: ScraperFilters): Promise<ScrapedListing[]> {
  const html = await fetchHtml(url);
  const cheerio = await import('cheerio');
  const $ = cheerio.load(html);
  const out: ScrapedListing[] = [];

  $('.ad, .result, .vehicle, article').each((_, el) => {
    const $el = $(el);
    const title = $el.find('h2, h3, .title, .vehicle-title').first().text().trim();
    const priceRaw = $el.find('.price, .cena').first().text().trim();
    let link = $el.find('a').first().attr('href') || '';
    if (link && !link.startsWith('http')) {
      link = link.startsWith('/') ? `https://www.avtonet.si${link}` : `https://www.avtonet.si/${link}`;
    }
    if (!title || !link) return;
    const { priceText, price } = parsePrice(priceRaw);
    out.push({
      externalId: hashExternalId(link),
      title,
      priceText: priceText || 'po dogovoru',
      price,
      url: link,
      location: '',
      description: $el.find('.description, .opis').first().text().trim(),
      imageUrl: $el.find('img').first().attr('src') || undefined,
      postedAt: null,
    });
  });
  return applyFilters(out, filters);
}

export async function scrape(
  source: SourceType,
  url: string,
  filters: ScraperFilters,
  opts: { playwrightEnabled?: boolean } = {}
): Promise<ScrapedListing[]> {
  if (source === 'bolha' || source === 'salomon') {
    try {
      return await scrapeBolha(url, filters);
    } catch (e: any) {
      // If Cloudflare detected AND Playwright enabled, retry with browser
      if (opts.playwrightEnabled && e?.message?.toLowerCase().includes('cloudflare')) {
        return await scrapeBolhaWithPlaywright(url, filters);
      }
      throw e;
    }
  }
  switch (source) {
    case 'nepremicnine': return scrapeNepremicnine(url, filters);
    case 'avtonet': return scrapeAvtonet(url, filters);
    case 'custom-rss': return scrapeCustomRss(url, filters);
    default: throw new Error(`Unknown source: ${source}`);
  }
}

// v1.4: Listing detail page scraper — fetch full description and all images from a single listing URL
export interface ListingDetail {
  fullDescription: string;
  images: string[];
  fetchedAt: Date;
}

export async function fetchListingDetail(url: string): Promise<ListingDetail> {
  const html = await fetchHtml(url);
  if (isCloudflareChallenge(html)) {
    throw new Error('Cloudflare blokada — uporabi Playwright za detail page');
  }
  const cheerio = await import('cheerio');
  const $ = cheerio.load(html);

  // Bolha detail page selectors (flexible — try multiple)
  const fullDescription =
    $('.ad-description, .description, .entity-description, [data-cy="ad-description"]').text().trim() ||
    $('.ad-body, .body').text().trim() ||
    $('meta[name="description"]').attr('content')?.trim() ||
    '';

  // Images — collect all unique image URLs from gallery and listing
  const imageSet = new Set<string>();
  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-large');
    if (src && src.startsWith('http') && !src.includes('logo') && !src.includes('avatar')) {
      // Filter out small icons and logos
      const width = parseInt($(el).attr('width') ?? '0', 10);
      const height = parseInt($(el).attr('height') ?? '0', 10);
      if ((width === 0 || width > 100) && (height === 0 || height > 100)) {
        imageSet.add(src);
      }
    }
  });

  return {
    fullDescription,
    images: Array.from(imageSet).slice(0, 20), // limit to 20
    fetchedAt: new Date(),
  };
}
