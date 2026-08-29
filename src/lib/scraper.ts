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

export type SourceType = 'bolha' | 'nepremicnine' | 'avtonet' | 'salomon' | 'custom-rss' | 'vinted' | 'quoka' | 'autoscout24';

export type ProgressCallback = (msg: string) => void;

// Shared helpers — import from scraper-helpers.ts instead of duplicating
import { hashExternalId, randomUA, parsePrice, applyFilters, isCloudflareChallenge, dedupByUrl } from './scraper-helpers';

// v7.32: Import anti-detection fetch helper (proxy + delay + realistic headers)
import { fetchWithAntiDetection } from './anti-detection';

async function fetchHtml(url: string): Promise<string> {
  const res = await fetchWithAntiDetection(url, {
    headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'sl-SI,sl;q=0.9,en;q=0.8' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return await res.text();
}

async function fetchRss(url: string): Promise<string> {
  const res = await fetchWithAntiDetection(url, {
    headers: { 'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

/**
 * Parse Bolha LD+JSON structured data — most reliable method.
 * Bolha embeds all listings in a <script type="application/ld+json"> block
 * with @graph containing Product items with name, url, image, price.
 */
function parseBolhaLdJson(html: string): ScrapedListing[] {
  const out: ScrapedListing[] = [];
  // Find all LD+JSON blocks
  const ldJsonRegex = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = ldJsonRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]);
      // Handle @graph array (Bolha's format)
      const items = data['@graph'] || (Array.isArray(data) ? data : [data]);
      if (!Array.isArray(items)) continue;
      
      for (const item of items) {
        // Look for Product or ListItem with Product
        let product: any = null;
        if (item['@type'] === 'Product') {
          product = item;
        } else if (item['@type'] === 'ListItem' && item.item?.['@type'] === 'Product') {
          product = item.item;
        }
        if (!product) continue;
        
        const title = product.name || '';
        let link = product.url || '';
        if (link && !link.startsWith('http')) {
          link = link.startsWith('/') ? `https://www.bolha.com${link}` : `https://www.bolha.com/${link}`;
        }
        const imageUrl = product.image || null;
        const price = product.offers?.price ?? null;
        const priceText = price != null ? `${price} €` : 'po dogovoru';
        
        if (!title || !link) continue;
        // Skip image-only URLs
        if (link.includes('/image-') || link.includes('slika-')) continue;
        
        out.push({
          externalId: hashExternalId(link),
          title,
          priceText,
          price: typeof price === 'number' ? price : null,
          url: link,
          location: '',
          description: product.description || '',
          imageUrl: imageUrl ?? undefined,
          postedAt: null,
        });
      }
    } catch {
      // Invalid JSON in this block, skip
    }
  }
  return dedupByUrl(out);
}

/**
 * Parse Bolha HTML links — finds all listing URLs and extracts title/price.
 * Bolha uses: <a href="/category/slug-oglas-ID" class="link" name="ID">
 *   <!--[--><span>Title</span><!--]--></a>
 */
function parseBolhaLinks(html: string): ScrapedListing[] {
  const out: ScrapedListing[] = [];
  // Match: <a href="/...-oglas-NUMBER" class="link" name="NUMBER">
  //   optionally Vue comments <!--[-->, then <span>TITLE</span>, optionally <!--]-->
  const linkRegex = /<a\s+href="(\/[^"]*-oglas-(\d+))"[^>]*class="link"[^>]*>(?:<!--\[-->)?<span>([^<]*)<\/span>(?:<!--\]-->)?<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(html)) !== null) {
    const href = m[1];
    const title = m[3].trim();
    const link = `https://www.bolha.com${href}`;
    if (!title) continue;
    // Skip image-only URLs
    if (href.includes('/image-') || href.includes('slika-')) continue;

    // Find price within next 2000 chars
    const afterLink = html.substring(m.index, Math.min(html.length, m.index + 2000));
    let price: number | null = null;
    let priceText = 'po dogovoru';
    // Look for price spans: <span ... class="...price...">XXX €</span>
    const priceSpanMatch = afterLink.match(/class="[^"]*price[^"]*"[^>]*>([^<]*)<\/span>/i);
    if (priceSpanMatch) {
      priceText = priceSpanMatch[1].trim();
      const numMatch = priceText.match(/([\d.]+)/);
      if (numMatch) price = parseInt(numMatch[1].replace(/\./g, ''), 10);
    }
    if (price == null) {
      const simplePrice = afterLink.match(/(\d[\d.]*)\s*€/);
      if (simplePrice) {
        price = parseInt(simplePrice[1].replace(/\./g, ''), 10);
        priceText = simplePrice[0];
      }
    }

    out.push({
      externalId: hashExternalId(link),
      title,
      priceText,
      price,
      url: link,
      location: '',
      description: '',
      imageUrl: undefined,
      postedAt: null,
    });
  }
  return dedupByUrl(out);
}

/**
 * Bolha.com scraper — multi-strategy approach.
 * v1.5: RSS first (if available)
 * v9.83: LD+JSON structured data (most reliable)
 * v9.83: HTML link parsing (fallback)
 * v1.1: Playwright for Cloudflare bypass
 */
async function scrapeBolha(url: string, filters: ScraperFilters): Promise<ScrapedListing[]> {
  const html = await fetchHtml(url);
  // Detect Cloudflare challenge page
  if (isCloudflareChallenge(html)) {
    throw new Error('Cloudflare blokada — omogoči Playwright v nastavitvah za fallback');
  }

  // Strategy 1: LD+JSON structured data (most reliable, no CSS selector issues)
  const ldJsonListings = parseBolhaLdJson(html);
  if (ldJsonListings.length > 0) {
    return applyFilters(ldJsonListings, filters);
  }

  // Strategy 2: Parse listing links directly from HTML
  const linkListings = parseBolhaLinks(html);
  if (linkListings.length > 0) {
    return applyFilters(linkListings, filters);
  }

  // Strategy 3: Try RSS feed
  const rssUrl = appendRssParam(url);
  if (rssUrl !== url) {
    try {
      const rssListings = await scrapeBolhaRss(rssUrl, filters);
      if (rssListings.length > 0) return rssListings;
    } catch {
      // RSS not available
    }
  }

  // Strategy 4: Legacy cheerio parsing (may fail if Bolha changed DOM)
  const listings = await parseBolhaHtml(html);
  return applyFilters(listings, filters);
}

/** Append ?output=rss to Bolha URL if not already present. */
function appendRssParam(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes('bolha.com') && !u.searchParams.has('output')) {
      u.searchParams.set('output', 'rss');
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

/** Parse Bolha RSS feed (similar to generic RSS but with Bolha-specific price extraction). */
async function scrapeBolhaRss(url: string, filters: ScraperFilters): Promise<ScrapedListing[]> {
  const xml = await fetchRss(url);
  // v9.83: Bolha sometimes returns HTML instead of RSS — detect and bail
  if (xml.trimStart().startsWith('<!DOCTYPE') || xml.includes('<html')) {
    return []; // Not RSS, fall through to other strategies
  }
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
    const pubDate = (itemXml.match(fieldRegex('pubDate'))?.[1] ?? '').trim();

    if (!title || !link) continue;

    // Bolha RSS often embeds price in title or description like "350 € · iPhone 13 Pro"
    const priceMatch = title.match(/([\d.]+)\s*€/) || description.match(/([\d.]+)\s*€/);
    let price: number | null = null;
    let priceText = '';
    if (priceMatch) {
      price = parseInt(priceMatch[1].replace(/\./g, ''), 10);
      priceText = `${priceMatch[1]} €`;
    } else {
      priceText = 'po dogovoru';
    }

    // Try to extract image from enclosure tag or description
    let imageUrl: string | null = null;
    const enclosureMatch = itemXml.match(/<enclosure[^>]+url="([^"]+)"/i);
    if (enclosureMatch) {
      imageUrl = enclosureMatch[1];
    } else {
      const imgMatch = description.match(/<img[^>]+src="([^"]+)"/i);
      if (imgMatch) imageUrl = imgMatch[1];
    }

    let postedAt: Date | null = null;
    if (pubDate) {
      const d = new Date(pubDate);
      if (!isNaN(d.getTime())) postedAt = d;
    }

    out.push({
      externalId: hashExternalId(link),
      title,
      priceText,
      price,
      url: link,
      location: '',
      description,
      imageUrl: imageUrl ?? undefined,
      postedAt,
    });
  }

  return applyFilters(out, filters);
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

  return dedupByUrl(out);
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

/** v1.8: Vinted scraper — uses public catalog API.
 * URL format: https://www.vinted.si/api/v2/catalog/items?search_text=...&price_to=...
 * or just a search text which we convert to API call.
 */
async function scrapeVinted(url: string, filters: ScraperFilters): Promise<ScrapedListing[]> {
  // Parse the URL to extract search parameters
  let apiUrl: string;
  try {
    const u = new URL(url);
    if (u.hostname.includes('vinted') && u.pathname.includes('/api/')) {
      // Already an API URL, use as-is
      apiUrl = url;
    } else {
      // Convert search URL to API call
      // Extract search text from URL or query params
      const searchText = u.searchParams.get('search_text') ||
                        u.searchParams.get('q') ||
                        u.pathname.split('/').pop() ||
                        '';
      apiUrl = `https://www.vinted.si/api/v2/catalog/items?search_text=${encodeURIComponent(searchText)}&per_page=50&order_by=newest_first`;
      // Copy price filters from URL
      if (u.searchParams.get('price_from')) apiUrl += `&price_from=${u.searchParams.get('price_from')}`;
      if (u.searchParams.get('price_to')) apiUrl += `&price_to=${u.searchParams.get('price_to')}`;
    }
  } catch {
    // If URL parsing fails, treat as search text
    apiUrl = `https://www.vinted.si/api/v2/catalog/items?search_text=${encodeURIComponent(url)}&per_page=50&order_by=newest_first`;
  }

  // Apply filters from monitor config
  if (filters.minPrice != null) apiUrl += `&price_from=${filters.minPrice}`;
  if (filters.maxPrice != null) apiUrl += `&price_to=${filters.maxPrice}`;

  // v7.40: Routed through fetchWithAntiDetection (was bare fetch — no proxy/delay/cookies)
  const res = await fetchWithAntiDetection(apiUrl, {
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'sl-SI,sl;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) {
    throw new Error(`Vinted API HTTP ${res.status}`);
  }
  const data = await res.json();
  const items: any[] = data?.items ?? [];

  const out: ScrapedListing[] = items.map((item: any) => {
    const price = parseFloat(item.price || '0') || null;
    const title = item.title || '';
    const itemUrl = item.url || `https://www.vinted.si/items/${item.id}`;
    const imageUrl = item.photo?.thumbnails?.[0]?.url ||
                     item.photo?.full_size_url ||
                     null;
    const brand = item.brand_title ? ` (${item.brand_title})` : '';
    const size = item.size_title ? `, velikost: ${item.size_title}` : '';
    const description = `Brend: ${item.brand_title || 'n/a'}${size}${item.status ? `, stanje: ${item.status}` : ''}`;
    let postedAt: Date | null = null;
    if (item.created_at_ts) {
      const d = new Date(item.created_at_ts);
      if (!isNaN(d.getTime())) postedAt = d;
    }

    return {
      externalId: hashExternalId(itemUrl),
      title: title + brand,
      priceText: price != null ? `${price.toFixed(2)} €` : 'po dogovoru',
      price,
      url: itemUrl,
      location: '',
      description,
      imageUrl: imageUrl ?? undefined,
      postedAt,
    };
  });

  // Apply keyword filters (Vinted API doesn't support keyword exclusion)
  return applyFilters(out, filters);
}

/**
 * v8.73: Quoka.de scraper — German classifieds platform.
 * Strukturiran HTML z .ql-resultlist .ql-thumbnail-item elementi.
 * Quoka ima preprost HTML brez Cloudflare zaščite (lahek za scrapat).
 */
function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

async function scrapeQuoka(url: string, filters: ScraperFilters): Promise<ScrapedListing[]> {
  const html = await fetchHtml(url);
  const cheerio = await import('cheerio');
  const $ = cheerio.load(html);

  const out: ScrapedListing[] = [];
  // Quoka uporablja .ql-resultlist .ql-thumbnail-item za rezultate
  $('.ql-resultlist .ql-thumbnail-item, .result-list .result-item, .classifieds .item').each((_, el) => {
    const $el = $(el);
    const titleEl = $el.find('h2 a, h3 a, .title a, .headline a').first();
    const title = titleEl.text().trim();
    if (!title) return;

    let href = titleEl.attr('href') || '';
    if (href && !href.startsWith('http')) {
      href = href.startsWith('/') ? `https://www.quoka.de${href}` : `https://www.quoka.de/${href}`;
    }
    if (!href) return;

    // External ID iz URL
    const idMatch = href.match(/\/(\d+)\.html/) || href.match(/id[=/](\d+)/) || href.match(/\/(\d{6,})/);
    const externalId = idMatch ? `quoka-${idMatch[1]}` : `quoka-${hashString(href)}`;

    // Cena — Quoka format: "preis" ali "€XX,XX"
    const priceTextEl = $el.find('.price, .sem-price, .ads-price, [class*="price"]').first();
    const priceTextRaw = priceTextEl.text().trim() || $el.find('span:contains("€")').first().text().trim();
    const priceText = priceTextRaw || '';
    let price: number | null = null;
    if (priceText) {
      const m = priceText.match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?)/);
      if (m) {
        // German format: 1.234,56 → 1234.56
        price = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
      }
    }

    // Lokacija
    const locationEl = $el.find('.location, .sem-location, [class*="location"]').first();
    const location = locationEl.text().trim();

    // Opis
    const descEl = $el.find('.description, .text, .desc, [class*="desc"]').first();
    const description = descEl.text().trim();

    // Slika
    const imgEl = $el.find('img').first();
    const imageUrl = imgEl.attr('src') || imgEl.attr('data-src') || null;
    const absoluteImg = imageUrl && !imageUrl.startsWith('http') && imageUrl.startsWith('/')
      ? `https://www.quoka.de${imageUrl}`
      : imageUrl;

    // Datum
    const dateEl = $el.find('.date, .sem-date, time').first();
    const dateText = dateEl.text().trim() || dateEl.attr('datetime') || '';
    let postedAt: Date | null = null;
    if (dateText) {
      const parsed = new Date(dateText);
      if (!isNaN(parsed.getTime())) postedAt = parsed;
    }

    out.push({
      externalId,
      title,
      priceText: priceText || 'Preis auf Anfrage',
      price: price ?? null,
      url: href,
      location: location || '',
      description,
      imageUrl: absoluteImg,
      postedAt,
    });
  });

  // Fallback: če ni najdeno z selectorji, poskusi alternativne strukture
  if (out.length === 0) {
    $('article, .item, [data-id]').each((_, el) => {
      const $el = $(el);
      const title = $el.find('h2, h3, .title').first().text().trim();
      const href = $el.find('a').first().attr('href') || '';
      if (!title || !href) return;
      const absoluteUrl = href.startsWith('http') ? href : `https://www.quoka.de${href.startsWith('/') ? '' : '/'}${href}`;
      const externalId = `quoka-${$el.attr('data-id') || hashString(absoluteUrl)}`;
      out.push({
        externalId,
        title,
        priceText: $el.find('.price, [class*="price"]').first().text().trim() || '',
        price: null,
        url: absoluteUrl,
        location: $el.find('.location, [class*="location"]').first().text().trim() || '',
        description: $el.find('.description, .text').first().text().trim() || '',
        imageUrl: $el.find('img').attr('src') || null,
        postedAt: null,
      });
    });
  }

  return applyFilters(out, filters);
}

export async function scrape(
  source: SourceType,
  url: string,
  filters: ScraperFilters,
  opts: { playwrightEnabled?: boolean; onProgress?: ProgressCallback } = {}
): Promise<ScrapedListing[]> {
  const notify = opts.onProgress || (() => {});
  if (source === 'bolha' || source === 'salomon') {
    try {
      notify('Pridobivam HTML iz Bolha...');
      const result = await scrapeBolha(url, filters);
      notify(`Parsal ${result.length} oglasov iz Bolha`);
      return result;
    } catch (e: any) {
      // If Cloudflare detected AND Playwright enabled, retry with browser
      if (opts.playwrightEnabled && e?.message?.toLowerCase().includes('cloudflare')) {
        return await scrapeBolhaWithPlaywright(url, filters);
      }
      throw e;
    }
  }
  switch (source) {
    case 'nepremicnine': notify('Pridobivam iz Nepremičnin...'); return scrapeNepremicnine(url, filters);
    case 'avtonet': notify('Pridobivam iz Avtoneta...'); return scrapeAvtonet(url, filters);
    case 'custom-rss': notify('Pridobivam iz RSS...'); return scrapeCustomRss(url, filters);
    case 'vinted': notify('Pridobivam iz Vinted...'); return scrapeVinted(url, filters);
    case 'quoka': notify('Pridobivam iz Quoke...'); return scrapeQuoka(url, filters);
    case 'autoscout24': {
      notify('Pridobivam iz AutoScout24...');
      const { scrapeAutoScout24 } = await import('./scraper-autoscout24');
      return scrapeAutoScout24(url, filters);
    }
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

/**
 * Scrape multiple URLs in parallel and merge results.
 * Used for multi-query monitors (e.g. one monitor scraping iPhone + Samsung + VW Golf from Bolha).
 */
export async function scrapeMulti(
  source: SourceType,
  urls: string[],
  filters: ScraperFilters,
  opts: { playwrightEnabled?: boolean; onProgress?: ProgressCallback } = {}
): Promise<ScrapedListing[]> {
  const notify = opts.onProgress || (() => {});

  if (urls.length === 1) {
    return scrape(source, urls[0], filters, opts);
  }

  notify(`Scraperjam ${urls.length} virov hkrati...`);

  const results = await Promise.allSettled(
    urls.map((url, i) =>
      scrape(source, url, filters, {
        playwrightEnabled: opts.playwrightEnabled,
        onProgress: (msg) => notify(`[${i + 1}/${urls.length}] ${msg}`),
      }).catch(() => [] as ScrapedListing[])
    )
  );

  const all: ScrapedListing[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }

  // Dedup by externalId
  const seen = new Set<string>();
  const deduped = all.filter(l => {
    if (seen.has(l.externalId)) return false;
    seen.add(l.externalId);
    return true;
  });

  notify(`Skupaj ${deduped} oglasov iz ${urls.length} virov`);
  return deduped;
}
