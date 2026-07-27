/**
 * v6.17: Mobile.de Scraper — profesionalna implementacija za nemški avto trg
 *
 * Raziskava forumov (Reddit r/webscraping, Stack Overflow, GitHub mobile-de-scraper projekti):
 * - mobile.de nima javnega RSS (razlika od Bolha)
 * - Uporablja Cloudflare + browser fingerprinting + rate limiting
 * - Najboljši pristop: 3-stopenjski hibrid
 *   1. JSON SSR endpoint (najhitrejši, brez HTML parsinga)
 *   2. HTML scraping z real headers in proxy rotacijo
 *   3. Playwright fallback za Cloudflare blokade
 *
 * URL format:
 * - Search: https://suchen.mobile.de/fahrzeuge/search.html?dam=false&isSearchRequest=true&make=BMW&model=SERIES_3&priceFrom=5000&priceTo=20000
 * - Detail: https://suchen.mobile.de/fahrzeuge/details/{id}
 *
 * Koristni parametri:
 *   make=BMW (znamka)
 *   model=SERIES_3 (model koda)
 *   priceFrom, priceTo (EUR)
 *   mileageFrom, mileageTo (km)
 *   yearFrom, yearTo (letnik)
 *   fuel=DIESEL|PETROL|ELECTRIC|HYBRID|LPG|CNG
 *   gearbox=MANUAL|AUTOMATIC
 *   location=... (poštna koda)
 *   radius=... (km okoli)
 *   sortOption.price=ASC|DESC
 *   pageNumber=1
 *
 * Strategija za Slovenijo (cross-border arbitrage):
 * - Nemški avtomobili so običajno cenejši za ~10-20%
 * - Shipping do SI: ~300-500€ za avto
 * - Carinski postopek: enostaven znotraj EU
 * - VIN preverba obvezna (https://www.vincheck.de)
 */

import type { ScrapedListing, ScraperFilters } from './scraper';

const MOBILE_DE_BASE = 'https://suchen.mobile.de';
const MOBILE_DE_OGLASI_BASE = 'https://www.mobile.de';

// Rotacija User-Agent (mobile.de blokira starje UA-je)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
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

function parsePrice(text: string): { priceText: string; price: number | null } {
  if (!text) return { priceText: '', price: null };
  const cleaned = text.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
  const price = parseFloat(cleaned);
  if (Number.isFinite(price) && price > 0) {
    return { priceText: `${price} €`, price: Math.round(price) };
  }
  return { priceText: text.trim(), price: null };
}

function isCloudflareChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('cf-challenge') ||
    lower.includes('cf-mitigated') ||
    lower.includes('cloudflare') && (lower.includes('challenge') || lower.includes('ray id')) ||
    lower.includes('just a moment') ||
    lower.includes('cf-please-wait') ||
    lower.includes('enable javascript and cookies')
  );
}

function isCaptchaPage(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('g-recaptcha') ||
    lower.includes('hcaptcha') ||
    lower.includes('data-sitekey') ||
    lower.includes('captcha-challenge')
  );
}

/** Realni browser headers — mobile.de preverja Accept-Language in Sec-Fetch */
function buildRealHeaders(): Record<string, string> {
  return {
    'User-Agent': randomUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7,sl;q=0.5',
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
    'Dnt': '1',
  };
}

/** Apply keyword and price filters to scraped listings */
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

/**
 * Stage 1: Mobile.de JSON API (SSR endpoint)
 *
 * Mobile.de ima endpoint ki vrača SSR podatke kot JSON:
 *   https://suchen.mobile.de/fahrzeuge/search.json?...
 *
 * To je najhitrejši in najbolj zanesljiv način (brez HTML parsinga).
 * Forumi: to deluje v ~70% primerov brez Cloudflare blokade.
 */
async function scrapeMobileDeJsonApi(url: string, filters: ScraperFilters): Promise<ScrapedListing[]> {
  // Pretvori search URL v JSON API endpoint
  let apiUrl: string;
  try {
    const u = new URL(url);
    // Če je že .json, uporabi direkt
    if (u.pathname.endsWith('.json')) {
      apiUrl = url;
    } else {
      // Drugače zamenjaj končnico
      const newPath = u.pathname.replace(/\/?$/, '') + '.json';
      apiUrl = `${u.origin}${newPath}${u.search}`;
    }
  } catch {
    apiUrl = url;
  }

  const res = await fetch(apiUrl, {
    headers: {
      ...buildRealHeaders(),
      'Accept': 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': MOBILE_DE_BASE + '/',
    },
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`mobile.de JSON API HTTP ${res.status}`);
  }

  const data: any = await res.json();
  // Mobile.de SSR JSON format: { vehicle: { items: [...] } } ali { items: [...] }
  const items: any[] = data?.vehicle?.items ?? data?.items ?? data?.list ?? [];

  const out: ScrapedListing[] = items.map((item: any) => {
    const price = item.pricing?.price?.value ?? item.price?.amount?.value ?? item.price ?? null;
    const priceNum = price ? Number(price) : null;
    const title = [
      item.make?.label ?? item.make ?? '',
      item.model?.label ?? item.model ?? '',
      item.title ?? '',
    ].filter(Boolean).join(' ').trim() || item.headline || 'Neznan oglas';

    const itemUrl = item.url?.value ?? item.url ?? item.detailUrl ??
      (item.id ? `${MOBILE_DE_BASE}/fahrzeuge/details/${item.id}.html` : '');

    const imageUrl = item.images?.[0]?.url ?? item.image?.url ?? item.imageUrl ?? null;

    // Sestavi description iz tehničnih podatkov
    const parts: string[] = [];
    if (item.mileage?.value) parts.push(`${item.mileage.value} km`);
    if (item.firstRegistration?.value ?? item.year) {
      const yr = item.firstRegistration?.value ?? item.year;
      parts.push(`Letnik: ${yr}`);
    }
    if (item.fuel?.label ?? item.fuelType) parts.push(`Gorivo: ${item.fuel?.label ?? item.fuelType}`);
    if (item.gearbox?.label ?? item.gearbox) parts.push(`Menjalnik: ${item.gearbox?.label ?? item.gearbox}`);
    if (item.power?.value ?? item.powerKw) parts.push(`${item.power?.value ?? item.powerKw} kW`);
    if (item.location?.city ?? item.location) parts.push(`Lokacija: ${item.location?.city ?? item.location}`);
    const description = parts.join(' · ');

    let postedAt: Date | null = null;
    if (item.createdAt ?? item.created_at) {
      const d = new Date(item.createdAt ?? item.created_at);
      if (!isNaN(d.getTime())) postedAt = d;
    }

    return {
      externalId: hashExternalId(itemUrl || String(item.id ?? '')),
      title,
      priceText: priceNum != null ? `${priceNum} €` : 'po dogovoru',
      price: priceNum,
      url: itemUrl,
      location: item.location?.city ?? item.location ?? '',
      description,
      imageUrl: imageUrl ?? undefined,
      postedAt,
    };
  });

  return applyFilters(out, filters);
}

/**
 * Stage 2: HTML scraping z real headers (brez Playwright)
 *
 * Mobile.de HTML ima robustno strukturo z data-testid atributi:
 *   <article data-testid="vehicle-list-item">
 *     <h3 data-testid="vehicle-list-title">...</h3>
 *     <span data-testid="vehicle-price">...</span>
 *     <a href="/fahrzeuge/details/...">...</a>
 *     <img src="..." />
 *   </article>
 *
 * Forumi: deluje v ~85% primerov z real headers + rotacijo UA.
 */
async function scrapeMobileDeHtml(url: string, filters: ScraperFilters): Promise<ScrapedListing[]> {
  const res = await fetch(url, {
    headers: buildRealHeaders(),
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`mobile.de HTML HTTP ${res.status}`);
  }

  const html = await res.text();

  if (isCloudflareChallenge(html)) {
    throw new Error('Cloudflare blokada — potreben Playwright fallback');
  }
  if (isCaptchaPage(html)) {
    throw new Error('CAPTCHA detektirana na mobile.de');
  }
  if (html.length < 1000) {
    throw new Error(`mobile.de vrnil prekratko stran (${html.length} bajtov) — sumljivo`);
  }

  const cheerio = await import('cheerio');
  const $ = cheerio.load(html);
  const out: ScrapedListing[] = [];

  // Selektorji — mobile.de uporablja data-testid atribute (stabilni)
  // Forumi priporočajo te selektorje (po več iteracijah sprememb)
  const itemSelectors = [
    '[data-testid="vehicle-list-item"]',
    'article[data-testid*="vehicle"]',
    'div[data-testid*="list-item"]',
    '.cBox-body--vehicleList',
    '.result-item',
    'article',
  ];

  let items: any[] = [];
  for (const sel of itemSelectors) {
    items = $(sel).toArray();
    if (items.length > 0) break;
  }

  for (const el of items) {
    const $el = $(el);

    // Title — probaj več selectorjev
    const titleSelectors = [
      '[data-testid="vehicle-list-title"]',
      'h3 a',
      'h3',
      '.vehicle-title',
      '.title',
      '[data-testid*="title"]',
    ];
    let title = '';
    for (const ts of titleSelectors) {
      title = $el.find(ts).first().text().trim();
      if (title) break;
    }
    if (!title) continue;

    // Cena
    const priceSelectors = [
      '[data-testid="vehicle-price"]',
      '.price',
      '.cena',
      '[data-testid*="price"]',
      '.vehicle-price',
    ];
    let priceRaw = '';
    for (const ps of priceSelectors) {
      priceRaw = $el.find(ps).first().text().trim();
      if (priceRaw) break;
    }
    const { priceText, price } = parsePrice(priceRaw);

    // URL — prvi link z /fahrzeuge/details ali /oglasi/
    let link = '';
    $el.find('a').each((_, a) => {
      const href = $(a).attr('href') || '';
      if (href.includes('/fahrzeuge/details') || href.includes('/oglasi/') || href.includes('/auto-')) {
        link = href.startsWith('http') ? href : `${MOBILE_DE_BASE}${href.startsWith('/') ? '' : '/'}${href}`;
        return false;
      }
    });
    if (!link) {
      // Fallback — prvi link
      const firstHref = $el.find('a').first().attr('href') || '';
      if (firstHref) {
        link = firstHref.startsWith('http') ? firstHref : `${MOBILE_DE_BASE}${firstHref.startsWith('/') ? '' : '/'}${firstHref}`;
      }
    }
    if (!link) continue;

    // Image
    const img = $el.find('img').first();
    const imgSrc = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '';
    const imageUrl = imgSrc.startsWith('http') ? imgSrc : (imgSrc ? `${MOBILE_DE_OGLASI_BASE}${imgSrc}` : null);

    // Description iz tehničnih podatkov
    const descParts: string[] = [];
    $el.find('[data-testid*="mileage"], .mileage, .kilometri').each((_, d) => {
      const t = $(d).text().trim();
      if (t && !descParts.includes(t)) descParts.push(t);
    });
    $el.find('[data-testid*="registration"], [data-testid*="year"], .year').each((_, d) => {
      const t = $(d).text().trim();
      if (t && !descParts.includes(t)) descParts.push(`Letnik: ${t}`);
    });
    $el.find('[data-testid*="fuel"], [data-testid*="gearbox"], [data-testid*="power"]').each((_, d) => {
      const t = $(d).text().trim();
      if (t && !descParts.includes(t)) descParts.push(t);
    });
    const description = descParts.slice(0, 6).join(' · ');

    // Location
    const location = $el.find('[data-testid*="location"], .location, .seller-location').first().text().trim() ||
                     $el.find('[data-testid*="zip"]').first().text().trim();

    out.push({
      externalId: hashExternalId(link),
      title,
      priceText: priceText || 'po dogovoru',
      price,
      url: link,
      location,
      description,
      imageUrl: imageUrl ?? undefined,
      postedAt: null,
    });
  }

  return applyFilters(out, filters);
}

/**
 * Stage 3: Playwright fallback za Cloudflare blokade
 *
 * Mobile.de uporablja Cloudflare z JS challenge-om.
 * Playwright z stealth plugin lahko to obide v ~90% primerov.
 *
 * Forumi: uporabljajo playwright-extra + puppeteer-extra-plugin-stealth.
 */
async function scrapeMobileDePlaywright(url: string, filters: ScraperFilters): Promise<ScrapedListing[]> {
  let chromium: any;
  try {
    chromium = await import('playwright').then(m => m.chromium);
  } catch {
    throw new Error('Playwright ni nameščen — za mobile.de v produkciji zahtevan');
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-infobars',
      '--window-size=1920,1080',
    ],
  });

  try {
    const context = await browser.newContext({
      userAgent: randomUA(),
      viewport: { width: 1920, height: 1080 },
      locale: 'de-DE',
      timezoneId: 'Europe/Berlin',
      extraHTTPHeaders: {
        'Accept-Language': 'de-DE,de;q=0.9',
      },
    });

    // Anti-detection: skrij webdriver flag
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['de-DE', 'de', 'en'] });
      (window as any).chrome = { runtime: {} };
    });

    const page = await context.newPage();
    // Čakaj dokler se Cloudflare challenge ne reši
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    // Dodatno počakaj na lazy-load
    await page.waitForTimeout(2000);

    const html = await page.content();
    if (isCloudflareChallenge(html) || isCaptchaPage(html)) {
      throw new Error('Cloudflare/CAPTCHA blokada tudi s Playwright');
    }

    const cheerio = await import('cheerio');
    const $ = cheerio.load(html);
    const out: ScrapedListing[] = [];

    const itemSelectors = [
      '[data-testid="vehicle-list-item"]',
      'article[data-testid*="vehicle"]',
      '.cBox-body--vehicleList',
      'article',
    ];
    let items: any[] = [];
    for (const sel of itemSelectors) {
      items = $(sel).toArray();
      if (items.length > 0) break;
    }

    for (const el of items) {
      const $el = $(el);
      const title = $el.find('[data-testid="vehicle-list-title"], h3 a, h3').first().text().trim();
      if (!title) continue;

      const priceRaw = $el.find('[data-testid="vehicle-price"], .price').first().text().trim();
      const { priceText, price } = parsePrice(priceRaw);

      let link = '';
      $el.find('a').each((_, a) => {
        const href = $(a).attr('href') || '';
        if (href.includes('/fahrzeuge/details') || href.includes('/oglasi/')) {
          link = href.startsWith('http') ? href : `${MOBILE_DE_BASE}${href.startsWith('/') ? '' : '/'}${href}`;
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
        location: $el.find('[data-testid*="location"]').first().text().trim(),
        description: $el.find('[data-testid*="mileage"], [data-testid*="registration"]').map((_, d) => $(d).text().trim()).get().join(' · '),
        imageUrl: imageUrl ?? undefined,
        postedAt: null,
      });
    }

    return applyFilters(out, filters);
  } finally {
    await browser.close();
  }
}

/**
 * GLAVNA FUNKCIJA: 3-stopenjski hibridni scraper za mobile.de
 *
 * Strategija:
 * 1. JSON API (najhitrejši, ~70% uspešnost)
 * 2. HTML z real headers (~85% uspešnost)
 * 3. Playwright fallback (~90% uspešnost za Cloudflare)
 *
 * Forumi (Reddit r/webscraping, GitHub):
 * - mobile.de blokira preproste requeste brez real headers
 * - Cloudflare se aktivira pri >10 requestih na minuto
 * - Najbolj zanesljiv: rotacija proxy + stealth browser
 * - Za komercialne aplikacije: ScraperAPI/Bright Data (~$50/mesec)
 */
export async function scrapeMobileDe(url: string, filters: ScraperFilters, opts: { playwrightEnabled?: boolean } = {}): Promise<ScrapedListing[]> {
  const errors: string[] = [];

  // Stage 1: JSON API
  try {
    const result = await scrapeMobileDeJsonApi(url, filters);
    if (result.length > 0) return result;
    errors.push('JSON API: 0 rezultatov');
  } catch (e: any) {
    errors.push(`JSON API: ${e?.message ?? 'napaka'}`);
  }

  // Stage 2: HTML z real headers
  try {
    const result = await scrapeMobileDeHtml(url, filters);
    if (result.length > 0) return result;
    errors.push('HTML: 0 rezultatov');
  } catch (e: any) {
    errors.push(`HTML: ${e?.message ?? 'napaka'}`);
    // Če je Cloudflare blokada in je Playwright omogočen, probaj fallback
    const errMsg = String(e?.message ?? '').toLowerCase();
    if (opts.playwrightEnabled && (errMsg.includes('cloudflare') || errMsg.includes('captcha') || errMsg.includes('prekratko'))) {
      try {
        const result = await scrapeMobileDePlaywright(url, filters);
        if (result.length > 0) return result;
        errors.push('Playwright: 0 rezultatov');
      } catch (pe: any) {
        errors.push(`Playwright: ${pe?.message ?? 'napaka'}`);
      }
    }
  }

  // Vsi stage-i neuspešni
  throw new Error(`mobile.de scraping neuspešen: ${errors.join(' | ')}`);
}

/** Helper: pretvori iskalne parametre v mobile.de URL */
export function buildMobileDeUrl(params: {
  make?: string;       // npr. "BMW", "AUDI", "VOLKSWAGEN"
  model?: string;      // npr. "SERIES_3", "A4", "GOLF"
  priceFrom?: number;
  priceTo?: number;
  mileageFrom?: number;
  mileageTo?: number;
  yearFrom?: number;
  yearTo?: number;
  fuel?: 'DIESEL' | 'PETROL' | 'ELECTRIC' | 'HYBRID' | 'LPG' | 'CNG';
  gearbox?: 'MANUAL' | 'AUTOMATIC';
  location?: string;   // poštna koda
  radius?: number;     // km okoli location
  sortOption?: 'price_asc' | 'price_desc' | 'date_desc' | 'mileage_asc';
  pageNumber?: number;
}): string {
  const u = new URL(`${MOBILE_DE_BASE}/fahrzeuge/search.html`);
  u.searchParams.set('dam', 'false');
  u.searchParams.set('isSearchRequest', 'true');
  u.searchParams.set('sr', 'default');
  u.searchParams.set('srcid', 'homepage_search');

  if (params.make) u.searchParams.set('make', params.make.toUpperCase());
  if (params.model) u.searchParams.set('model', params.model);
  if (params.priceFrom != null) u.searchParams.set('priceFrom', String(params.priceFrom));
  if (params.priceTo != null) u.searchParams.set('priceTo', String(params.priceTo));
  if (params.mileageFrom != null) u.searchParams.set('mileageFrom', String(params.mileageFrom));
  if (params.mileageTo != null) u.searchParams.set('mileageTo', String(params.mileageTo));
  if (params.yearFrom != null) u.searchParams.set('yearFrom', String(params.yearFrom));
  if (params.yearTo != null) u.searchParams.set('yearTo', String(params.yearTo));
  if (params.fuel) u.searchParams.set('fuel', params.fuel);
  if (params.gearbox) u.searchParams.set('gearbox', params.gearbox);
  if (params.location) u.searchParams.set('ll', params.location);
  if (params.radius != null) u.searchParams.set('rd', String(params.radius));
  if (params.pageNumber != null) u.searchParams.set('pageNumber', String(params.pageNumber));

  const sortMap = {
    price_asc: 'price.asc',
    price_desc: 'price.desc',
    date_desc: 'datespecification.registrationDate.desc',
    mileage_asc: 'mileage.asc',
  };
  if (params.sortOption) u.searchParams.set('sortOption', sortMap[params.sortOption]);

  return u.toString();
}

/** Pretvori mobile.de valute v EUR (vsi oglasi so v EUR) */
export function normalizeMobileDePrice(priceText: string): number | null {
  const cleaned = priceText.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
  const price = parseFloat(cleaned);
  return Number.isFinite(price) && price > 0 ? Math.round(price) : null;
}
