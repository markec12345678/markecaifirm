/**
 * v6.18: Foreign Marketplace Scrapers — 3 največji tuji generalni trgi
 *
 * Raziskava forumov (Reddit r/webscraping, GitHub projekti):
 *
 * 1. KLEINANZEIGEN.DE (Nemčija, nekdanji eBay Kleinanzeigen)
 *    - Največji nemški generalni oglasnik (kot Bolha za DE)
 *    - Multi-kategorija: elektronika, pohištvo, avto, nepremičnine
 *    - HTML z Cloudflare zaščito
 *    - URL: https://www.kleinanzeigen.de/s-suchanfrage.html?keywords=...
 *    - Selektorji: .ad-listitem, .text-body-end (title), .ad-price
 *
 * 2. SUBITO.IT (Italija)
 *    - Največji italijanski oglasnik
 *    - Multi-kategorija
 *    - Manj agresivna anti-bot zaščita kot Kleinanzeigen
 *    - URL: https://www.subito.it/annunci-italia/vendita?q=...
 *    - Selektorji: .item-listing, .item-title, .item-price
 *
 * 3. WILLHABEN.AT (Avstrija)
 *    - Največji avstrijski oglasnik
 *    - Multi-kategorija
 *    - Ima tudi JSON API (lahko deluje)
 *    - URL: https://www.willhaben.at/iad/kaufen-und-verkaufen?keyword=...
 *    - Selektorji: .search-result, .title, .price
 *
 * Strategija za Slovenijo (cross-border arbitraža):
 * - DE: 10-20% cenejše za elektroniko in pohištvo
 * - IT: 10-15% cenejše za oblačila in modne dodatke
 * - AT: 5-10% cenejše za avto dele in opremo
 * - Vsi znotraj EU (carina enostavna)
 * - Shipping: DE 10-15€, IT 15-20€, AT 8-12€ za manjše iteme
 */

import type { ScrapedListing, ScraperFilters } from './scraper';

// Skupni helperji (deljeni z mobile.de, vendar neodvisni)

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function hashExternalId(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Parsa cene iz različnih formatov: "1.234,56 €", "€ 1,234.56", "1234€", "VB" (Verhandlungsbasis) */
function parsePriceMultiFormat(text: string): { priceText: string; price: number | null } {
  if (!text) return { priceText: '', price: null };
  const lower = text.toLowerCase().trim();

  // "VB" = Verhandlungsbasis (kleinanzeigen) = po dogovoru
  if (lower === 'vb' || lower.includes('verhandlungsbasis') || lower.includes('po dogovoru') ||
      lower.includes('su richiesta') || lower.includes('auf anfrage')) {
    return { priceText: 'po dogovoru', price: null };
  }

  // "Versand" = samo shipping price, ne glavna cena
  if (lower.startsWith('versand') || lower.startsWith('spese di spedizione')) {
    return { priceText: text.trim(), price: null };
  }

  // Očisti nepomembne znake
  let cleaned = text.replace(/€/g, '').replace(/EUR/gi, '').trim();
  // Deutsch/Italian format: 1.234,56 → 1234.56
  if (cleaned.includes('.') && cleaned.includes(',')) {
    // Determiniraj katera je decimalna vejica
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
  // Odstrani vse razen številk in pike
  cleaned = cleaned.replace(/[^\d.]/g, '');
  const price = parseFloat(cleaned);
  if (Number.isFinite(price) && price > 0) {
    return { priceText: `${Math.round(price)} €`, price: Math.round(price) };
  }
  return { priceText: text.trim(), price: null };
}

function isCloudflareChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('cf-challenge') ||
    lower.includes('cf-mitigated') ||
    (lower.includes('cloudflare') && (lower.includes('challenge') || lower.includes('ray id'))) ||
    lower.includes('just a moment') ||
    lower.includes('enable javascript and cookies') ||
    lower.includes('ddos protection')
  );
}

function isCaptchaPage(html: string): boolean {
  const lower = html.toLowerCase();
  return lower.includes('g-recaptcha') || lower.includes('hcaptcha') || lower.includes('data-sitekey');
}

function buildRealHeaders(locale: 'de-DE' | 'it-IT' | 'de-AT'): Record<string, string> {
  const acceptLang = locale === 'de-DE' ? 'de-DE,de;q=0.9,en;q=0.7' :
                     locale === 'it-IT' ? 'it-IT,it;q=0.9,en;q=0.7' :
                     'de-AT,de;q=0.9,en;q=0.7';
  return {
    'User-Agent': randomUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': acceptLang,
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
}

function applyFilters(listings: ScrapedListing[], f: ScraperFilters): ScrapedListing[] {
  let out = listings;
  if (f.keywords && f.keywords.length > 0) {
    const kws = f.keywords.map(k => k.toLowerCase().trim()).filter(Boolean);
    if (kws.length > 0) {
      out = out.filter(l => {
        const text = `${l.title} ${l.description ?? ''}`.toLowerCase();
        return kws.some(k => text.includes(k));
      });
    }
  }
  if (f.excludeKeywords && f.excludeKeywords.length > 0) {
    const ex = f.excludeKeywords.map(k => k.toLowerCase().trim()).filter(Boolean);
    if (ex.length > 0) {
      out = out.filter(l => {
        const text = `${l.title} ${l.description ?? ''}`.toLowerCase();
        return !ex.some(k => text.includes(k));
      });
    }
  }
  if (f.minPrice != null) out = out.filter(l => l.price == null || l.price >= f.minPrice!);
  if (f.maxPrice != null) out = out.filter(l => l.price == null || l.price <= f.maxPrice!);
  return out;
}

// ==========================================================================
// 1. KLEINANZEIGEN.DE (Nemčija)
// ==========================================================================

/**
 * Kleinanzeigen.de scraper — največji nemški generalni oglasnik
 *
 * URL format:
 * https://www.kleinanzeigen.de/s-suchanfrage.html?keywords=iphone&priceType:from=200&priceType:to=500
 * ali
 * https://www.kleinanzeigen.de/s-iphone/k0
 *
 * Podpora tudi kategoriji:
 * https://www.kleinanzeigen.de/s-elektronik/iphone/k92c91
 */
async function scrapeKleinanzeigen(url: string, filters: ScraperFilters): Promise<ScrapedListing[]> {
  // Stage 1: poskusi najprej preprost fetch z real headers
  const res = await fetch(url, {
    headers: buildRealHeaders('de-DE'),
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`Kleinanzeigen HTTP ${res.status}`);
  }

  const html = await res.text();

  if (isCloudflareChallenge(html)) {
    throw new Error('Cloudflare blokada — potreben Playwright fallback');
  }
  if (isCaptchaPage(html)) {
    throw new Error('CAPTCHA detektirana na Kleinanzeigen');
  }
  if (html.length < 2000) {
    throw new Error(`Kleinanzeigen vrnil prekratko stran (${html.length} bajtov)`);
  }

  const cheerio = await import('cheerio');
  const $ = cheerio.load(html);
  const out: ScrapedListing[] = [];

  // Kleinanzeigen selektorji (veljavni 2024)
  const itemSelectors = [
    '.ad-listitem',
    'article.ad-listitem',
    '[data-testid="ad-list-item"]',
    '.listing',
  ];
  let items: any[] = [];
  for (const sel of itemSelectors) {
    items = $(sel).toArray();
    if (items.length > 0) break;
  }

  for (const el of items) {
    const $el = $(el);

    // Title
    const titleSelectors = [
      '.text-body-end',
      '.ad-listitem-main h2 a',
      'h2 a',
      '[data-testid="ad-title"]',
      '.ellipsis',
    ];
    let title = '';
    for (const ts of titleSelectors) {
      title = $el.find(ts).first().text().trim();
      if (title) break;
    }
    if (!title) continue;

    // Price
    const priceSelectors = [
      '.ad-price',
      '.price',
      '[data-testid="ad-price"]',
      '.p-price',
    ];
    let priceRaw = '';
    for (const ps of priceSelectors) {
      priceRaw = $el.find(ps).first().text().trim();
      if (priceRaw) break;
    }
    const { priceText, price } = parsePriceMultiFormat(priceRaw);

    // URL
    let link = '';
    $el.find('a').each((_, a) => {
      const href = $(a).attr('href') || '';
      if (href.includes('/s-anzeige/') || href.includes('/anzeige/')) {
        link = href.startsWith('http') ? href : `https://www.kleinanzeigen.de${href}`;
        return false;
      }
    });
    if (!link) {
      const firstHref = $el.find('a').first().attr('href') || '';
      if (firstHref) {
        link = firstHref.startsWith('http') ? firstHref : `https://www.kleinanzeigen.de${firstHref}`;
      }
    }
    if (!link) continue;

    // Image
    const img = $el.find('img').first();
    const imgSrc = img.attr('src') || img.attr('data-src') || '';
    const imageUrl = imgSrc.startsWith('http') ? imgSrc : null;

    // Description (pogosto v .ad-listitem-main p)
    const description = $el.find('.ad-listitem-main p, .text-module-end, .ad-main').text().trim();

    // Location
    const location = $el.find('.ad-listitem-main .simpletag, .ad-listitem-city, [data-testid="ad-location"]').text().trim();

    // Posted at (pogosto v .ad-listitem-time ali .simpletag)
    let postedAt: Date | null = null;
    const timeText = $el.find('.ad-listitem-time, .text-module-end time, time').attr('datetime') ||
                     $el.find('.ad-listitem-time, .text-module-end time').text().trim();
    if (timeText) {
      const d = new Date(timeText);
      if (!isNaN(d.getTime())) postedAt = d;
    }

    out.push({
      externalId: hashExternalId(link),
      title,
      priceText: priceText || 'po dogovoru',
      price,
      url: link,
      location,
      description: description.slice(0, 500),
      imageUrl: imageUrl ?? undefined,
      postedAt,
    });
  }

  return applyFilters(out, filters);
}

// ==========================================================================
// 2. SUBITO.IT (Italija)
// ==========================================================================

/**
 * Subito.it scraper — največji italijanski oglasnik
 *
 * URL format:
 * https://www.subito.it/annunci-italia/vendita?q=iphone&prezzo=200-500
 *
 * Podpora tudi kategoriji:
 * https://www.subito.it/elettronica/iphone/
 */
async function scrapeSubito(url: string, filters: ScraperFilters): Promise<ScrapedListing[]> {
  const res = await fetch(url, {
    headers: buildRealHeaders('it-IT'),
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`Subito HTTP ${res.status}`);
  }

  const html = await res.text();

  if (isCloudflareChallenge(html)) {
    throw new Error('Cloudflare blokada na Subito');
  }
  if (isCaptchaPage(html)) {
    throw new Error('CAPTCHA detektirana na Subito');
  }
  if (html.length < 2000) {
    throw new Error(`Subito vrnil prekratko stran (${html.length} bajtov)`);
  }

  const cheerio = await import('cheerio');
  const $ = cheerio.load(html);
  const out: ScrapedListing[] = [];

  // Subito selektorji
  const itemSelectors = [
    '.item-listing',
    '[data-testid="item-listing"]',
    'article.item-listing',
    '.listing-item',
  ];
  let items: any[] = [];
  for (const sel of itemSelectors) {
    items = $(sel).toArray();
    if (items.length > 0) break;
  }

  for (const el of items) {
    const $el = $(el);

    // Title
    const titleSelectors = [
      '.item-title',
      '[data-testid="item-title"]',
      'h2 a',
      '.title',
    ];
    let title = '';
    for (const ts of titleSelectors) {
      title = $el.find(ts).first().text().trim();
      if (title) break;
    }
    if (!title) continue;

    // Price
    const priceSelectors = [
      '.item-price',
      '[data-testid="item-price"]',
      '.price',
    ];
    let priceRaw = '';
    for (const ps of priceSelectors) {
      priceRaw = $el.find(ps).first().text().trim();
      if (priceRaw) break;
    }
    const { priceText, price } = parsePriceMultiFormat(priceRaw);

    // URL
    let link = '';
    $el.find('a').each((_, a) => {
      const href = $(a).attr('href') || '';
      if (href.includes('/vendita/') || href.includes('/annunci/')) {
        link = href.startsWith('http') ? href : `https://www.subito.it${href}`;
        return false;
      }
    });
    if (!link) {
      const firstHref = $el.find('a').first().attr('href') || '';
      if (firstHref) {
        link = firstHref.startsWith('http') ? firstHref : `https://www.subito.it${firstHref}`;
      }
    }
    if (!link) continue;

    // Image
    const img = $el.find('img').first();
    const imgSrc = img.attr('src') || img.attr('data-src') || '';
    const imageUrl = imgSrc.startsWith('http') ? imgSrc : null;

    // Description (pogosto v .item-description)
    const description = $el.find('.item-description, .description, p').first().text().trim();

    // Location
    const location = $el.find('.item-town, .town, .location, [data-testid="item-town"]').text().trim();

    // Posted at
    let postedAt: Date | null = null;
    const timeText = $el.find('time').attr('datetime') || $el.find('.item-date').text().trim();
    if (timeText) {
      const d = new Date(timeText);
      if (!isNaN(d.getTime())) postedAt = d;
    }

    out.push({
      externalId: hashExternalId(link),
      title,
      priceText: priceText || 'po dogovoru',
      price,
      url: link,
      location,
      description: description.slice(0, 500),
      imageUrl: imageUrl ?? undefined,
      postedAt,
    });
  }

  return applyFilters(out, filters);
}

// ==========================================================================
// 3. WILLHABEN.AT (Avstrija)
// ==========================================================================

/**
 * Willhaben.at scraper — največji avstrijski oglasnik
 *
 * URL format:
 * https://www.willhaben.at/iad/kaufen-und-verkaufen?keyword=iphone&priceFrom=200&priceTo=500
 *
 * Podpora tudi kategoriji:
 * https://www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz/elektronik/iphone
 */
async function scrapeWillhaben(url: string, filters: ScraperFilters): Promise<ScrapedListing[]> {
  const res = await fetch(url, {
    headers: buildRealHeaders('de-AT'),
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`Willhaben HTTP ${res.status}`);
  }

  const html = await res.text();

  if (isCloudflareChallenge(html)) {
    throw new Error('Cloudflare blokada na Willhaben');
  }
  if (isCaptchaPage(html)) {
    throw new Error('CAPTCHA detektirana na Willhaben');
  }
  if (html.length < 2000) {
    throw new Error(`Willhaben vrnil prekratko stran (${html.length} bajtov)`);
  }

  const cheerio = await import('cheerio');
  const $ = cheerio.load(html);
  const out: ScrapedListing[] = [];

  // Willhaben selektorji (veljavni 2024)
  const itemSelectors = [
    '.search-result',
    '[data-testid="search-result"]',
    '.listing-item',
    'article',
  ];
  let items: any[] = [];
  for (const sel of itemSelectors) {
    items = $(sel).toArray();
    if (items.length > 0) break;
  }

  for (const el of items) {
    const $el = $(el);

    // Title
    const titleSelectors = [
      '.title',
      '[data-testid="listing-title"]',
      'h3 a',
      'h2 a',
      '.listing-title',
    ];
    let title = '';
    for (const ts of titleSelectors) {
      title = $el.find(ts).first().text().trim();
      if (title) break;
    }
    if (!title) continue;

    // Price
    const priceSelectors = [
      '.price',
      '[data-testid="listing-price"]',
      '.current-price',
    ];
    let priceRaw = '';
    for (const ps of priceSelectors) {
      priceRaw = $el.find(ps).first().text().trim();
      if (priceRaw) break;
    }
    const { priceText, price } = parsePriceMultiFormat(priceRaw);

    // URL
    let link = '';
    $el.find('a').each((_, a) => {
      const href = $(a).attr('href') || '';
      if (href.includes('/iad/object/') || href.includes('/iad/kaufen') || href.includes('detail')) {
        link = href.startsWith('http') ? href : `https://www.willhaben.at${href}`;
        return false;
      }
    });
    if (!link) {
      const firstHref = $el.find('a').first().attr('href') || '';
      if (firstHref) {
        link = firstHref.startsWith('http') ? firstHref : `https://www.willhaben.at${firstHref}`;
      }
    }
    if (!link) continue;

    // Image
    const img = $el.find('img').first();
    const imgSrc = img.attr('src') || img.attr('data-src') || '';
    const imageUrl = imgSrc.startsWith('http') ? imgSrc : null;

    // Description
    const description = $el.find('.description, .info, p').first().text().trim();

    // Location
    const location = $el.find('.location, .address, [data-testid="listing-location"]').text().trim();

    // Posted at
    let postedAt: Date | null = null;
    const timeText = $el.find('time').attr('datetime') || $el.find('.date').text().trim();
    if (timeText) {
      const d = new Date(timeText);
      if (!isNaN(d.getTime())) postedAt = d;
    }

    out.push({
      externalId: hashExternalId(link),
      title,
      priceText: priceText || 'po dogovoru',
      price,
      url: link,
      location,
      description: description.slice(0, 500),
      imageUrl: imageUrl ?? undefined,
      postedAt,
    });
  }

  return applyFilters(out, filters);
}

// ==========================================================================
// GLAVNE FUNKCIJE (z Playwright fallback)
// ==========================================================================

async function scrapeWithPlaywrightFallback(
  url: string,
  filters: ScraperFilters,
  scraperFn: (url: string, filters: ScraperFilters) => Promise<ScrapedListing[]>,
  locale: 'de-DE' | 'it-IT' | 'de-AT',
  baseUrl: string,
  opts: { playwrightEnabled?: boolean }
): Promise<ScrapedListing[]> {
  try {
    const result = await scraperFn(url, filters);
    if (result.length > 0) return result;
    // Če 0 rezultatov, poizkusi Playwright (lahko JS-rendered)
    if (opts.playwrightEnabled) {
      return await scrapeForeignPlaywright(url, filters, locale, baseUrl);
    }
    return result;
  } catch (e: any) {
    const errMsg = String(e?.message ?? '').toLowerCase();
    if (opts.playwrightEnabled && (errMsg.includes('cloudflare') || errMsg.includes('captcha') || errMsg.includes('prekratko'))) {
      return await scrapeForeignPlaywright(url, filters, locale, baseUrl);
    }
    throw e;
  }
}

/** Playwright fallback za tuje trge */
async function scrapeForeignPlaywright(
  url: string,
  filters: ScraperFilters,
  locale: 'de-DE' | 'it-IT' | 'de-AT',
  baseUrl: string
): Promise<ScrapedListing[]> {
  let chromium: any;
  try {
    chromium = await import('playwright').then(m => m.chromium);
  } catch {
    throw new Error('Playwright ni nameščen — za tuje trge v produkciji zahtevan');
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  try {
    const timezoneMap = {
      'de-DE': 'Europe/Berlin',
      'it-IT': 'Europe/Rome',
      'de-AT': 'Europe/Vienna',
    };
    const context = await browser.newContext({
      userAgent: randomUA(),
      viewport: { width: 1920, height: 1080 },
      locale,
      timezoneId: timezoneMap[locale],
      extraHTTPHeaders: { 'Accept-Language': locale === 'de-DE' ? 'de-DE,de;q=0.9' : locale === 'it-IT' ? 'it-IT,it;q=0.9' : 'de-AT,de;q=0.9' },
    });

    // Anti-detection
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      (window as any).chrome = { runtime: {} };
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const html = await page.content();
    if (isCloudflareChallenge(html) || isCaptchaPage(html)) {
      throw new Error('Cloudflare/CAPTCHA blokada tudi s Playwright');
    }

    const cheerio = await import('cheerio');
    const $ = cheerio.load(html);
    const out: ScrapedListing[] = [];

    // Generični selektorji — pokrijemo vse 3 platforme
    const itemSelectors = [
      '.ad-listitem', '.item-listing', '.search-result',
      'article', '.listing-item', '[data-testid*="list-item"]',
    ];
    let items: any[] = [];
    for (const sel of itemSelectors) {
      items = $(sel).toArray();
      if (items.length > 0) break;
    }

    for (const el of items) {
      const $el = $(el);
      const title = $el.find('h2 a, h3 a, .title, .item-title, [data-testid*="title"]').first().text().trim();
      if (!title) continue;
      const priceRaw = $el.find('.price, .ad-price, .item-price, [data-testid*="price"]').first().text().trim();
      const { priceText, price } = parsePriceMultiFormat(priceRaw);

      let link = '';
      $el.find('a').each((_, a) => {
        const href = $(a).attr('href') || '';
        if (href.includes('/s-anzeige/') || href.includes('/vendita/') || href.includes('/iad/object/') ||
            href.includes('/anzeige/') || href.includes('/annunci/') || href.includes('detail')) {
          link = href.startsWith('http') ? href : `${baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
          return false;
        }
      });
      if (!link) continue;

      const imgSrc = $el.find('img').first().attr('src') || '';
      const imageUrl = imgSrc.startsWith('http') ? imgSrc : null;

      out.push({
        externalId: hashExternalId(link),
        title,
        priceText: priceText || 'po dogovoru',
        price,
        url: link,
        location: $el.find('[data-testid*="location"], .location, .item-town').first().text().trim(),
        description: $el.find('p, .description').first().text().trim().slice(0, 500),
        imageUrl: imageUrl ?? undefined,
        postedAt: null,
      });
    }

    return applyFilters(out, filters);
  } finally {
    await browser.close();
  }
}

// ==========================================================================
// PUBLIC API
// ==========================================================================

export async function scrapeKleinanzeigenFull(url: string, filters: ScraperFilters, opts: { playwrightEnabled?: boolean } = {}): Promise<ScrapedListing[]> {
  return scrapeWithPlaywrightFallback(url, filters, scrapeKleinanzeigen, 'de-DE', 'https://www.kleinanzeigen.de', opts);
}

export async function scrapeSubitoFull(url: string, filters: ScraperFilters, opts: { playwrightEnabled?: boolean } = {}): Promise<ScrapedListing[]> {
  return scrapeWithPlaywrightFallback(url, filters, scrapeSubito, 'it-IT', 'https://www.subito.it', opts);
}

export async function scrapeWillhabenFull(url: string, filters: ScraperFilters, opts: { playwrightEnabled?: boolean } = {}): Promise<ScrapedListing[]> {
  return scrapeWithPlaywrightFallback(url, filters, scrapeWillhaben, 'de-AT', 'https://www.willhaben.at', opts);
}

// ==========================================================================
// URL BUILDERJI
// ==========================================================================

export function buildKleinanzeigenUrl(params: {
  keyword?: string;
  category?: string; // npr. 'elektronik', 'moebel', 'kleidung'
  priceFrom?: number;
  priceTo?: number;
  location?: string; // poštna koda
  radius?: number; // km
  shippingOption?: 'versand' | 'nur_versand' | 'abholung'; // versand = dovoljen shipping
  sort?: 'date_desc' | 'price_asc' | 'price_desc';
}): string {
  const u = new URL('https://www.kleinanzeigen.de/s-suchanfrage.html');
  if (params.keyword) u.searchParams.set('keywords', params.keyword);
  if (params.priceFrom != null) u.searchParams.set('priceType:from', String(params.priceFrom));
  if (params.priceTo != null) u.searchParams.set('priceType:to', String(params.priceTo));
  if (params.location) u.searchParams.set('location', params.location);
  if (params.radius != null) u.searchParams.set('radius', String(params.radius));
  if (params.shippingOption === 'versand') u.searchParams.set('shippingOption', 'versand');
  if (params.shippingOption === 'nur_versand') u.searchParams.set('shippingOption', 'nur_versand');
  if (params.shippingOption === 'abholung') u.searchParams.set('shippingOption', 'abholung');
  const sortMap = {
    date_desc: '0', // Najnovejši
    price_asc: '1', // Cena naraščajoče
    price_desc: '2', // Cena padajoče
  };
  if (params.sort) u.searchParams.set('sorting', sortMap[params.sort]);
  return u.toString();
}

export function buildSubitoUrl(params: {
  keyword?: string;
  category?: string; // npr. 'elettronica', 'mobili', 'arredamento'
  priceFrom?: number;
  priceTo?: number;
  region?: string; // npr. 'italia', 'lombardia', 'lazio'
  sort?: 'date_desc' | 'price_asc' | 'price_desc';
}): string {
  const base = `https://www.subito.it/annunci-${params.region || 'italia'}/vendita`;
  const u = new URL(base);
  if (params.keyword) u.searchParams.set('q', params.keyword);
  if (params.priceFrom != null && params.priceTo != null) {
    u.searchParams.set('prezzo', `${params.priceFrom}-${params.priceTo}`);
  } else if (params.priceFrom != null) {
    u.searchParams.set('prezzo', `da-${params.priceFrom}`);
  } else if (params.priceTo != null) {
    u.searchParams.set('prezzo', `fino-a-${params.priceTo}`);
  }
  if (params.sort === 'price_asc') u.searchParams.set('order', 'price_asc');
  if (params.sort === 'price_desc') u.searchParams.set('order', 'price_desc');
  return u.toString();
}

export function buildWillhabenUrl(params: {
  keyword?: string;
  category?: string; // npr. 'elektronik', 'moebel', 'kleidung'
  priceFrom?: number;
  priceTo?: number;
  location?: string;
  sort?: 'date_desc' | 'price_asc' | 'price_desc';
}): string {
  const u = new URL('https://www.willhaben.at/iad/kaufen-und-verkaufen');
  if (params.keyword) u.searchParams.set('keyword', params.keyword);
  if (params.priceFrom != null) u.searchParams.set('priceFrom', String(params.priceFrom));
  if (params.priceTo != null) u.searchParams.set('priceTo', String(params.priceTo));
  if (params.location) u.searchParams.set('areaId', params.location);
  if (params.sort === 'price_asc') u.searchParams.set('sort', 'price_asc');
  if (params.sort === 'price_desc') u.searchParams.set('sort', 'price_desc');
  return u.toString();
}
