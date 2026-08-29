/**
 * AutoScout24 Scraper — GraphQL API
 * 
 * GraphQL API vrača strukturirane podatke (make, model, letnik, km, menjalnik, moč).
 * Cene so anonimizirane (€1). API filtrira po ceni, a je ne prikaže.
 * Prikazujemo "do X€" iz URL parametra.
 * 
 * Podpira: DE, AT, NL, BE, IT, FR, ES, CH
 */

import { ScrapedListing, ScraperFilters } from './scraper';
import { hashExternalId } from './scraper-helpers';

const GRAPHQL_URL = 'https://www.autoscout24.de/listing-search-api/graphql';
const AUTH = 'Basic YXMyNC1zZWFyY2gtZnVubmVsOnZucmZiYkJqSTMyT2wxV2thNnVOSFJwM0VZbjRkag==';

const LISTINGS_QUERY = `{
  search {
    listings {
      listings {
        id
        details {
          title
          vehicle {
            classification { make { raw formatted } model { raw formatted } modelVersionCustom }
            condition { mileageInKm { raw formatted } firstRegistrationDate { raw formatted } }
            engine { power { kw { raw formatted } hp { raw formatted } } transmissionType { formatted } }
            fuels { primary { type { formatted } } }
          }
          prices {
            dealer { amountInEUR { raw formatted } negotiable }
            public { amountInEUR { raw formatted } negotiable }
          }
          location { city countryCode }
          seller { companyName type }
        }
        searchResultType
      }
      metadata { totalItems currentPage pageSize }
    }
  }
}`;

export async function scrapeAutoScout24(
  searchUrl: string,
  filters?: ScraperFilters,
): Promise<ScrapedListing[]> {
  const queryString = buildQueryString(searchUrl);
  const priceRange = extractPriceRange(searchUrl);

  try {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': AUTH,
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: LISTINGS_QUERY,
        variables: { queryString },
      }),
    });

    if (!res.ok) {
      throw new Error(`AutoScout24 GraphQL API ${res.status}`);
    }

    const data = await res.json();
    
    if (data.errors?.length) {
      console.error('AutoScout24 GraphQL errors:', data.errors.map((e: any) => e.message));
    }

    const listings = data?.data?.search?.listings?.listings || [];
    const meta = data?.data?.search?.listings?.metadata;
    
    const results: ScrapedListing[] = listings
      .map((l: any) => transformListing(l, priceRange))
      .filter(Boolean);

    console.log(`AutoScout24: ${results.length} listings from ${meta?.totalItems || '?'} total`);

    if (filters) {
      return applyFilters(results, filters);
    }
    return results;
  } catch (error: any) {
    console.error('AutoScout24 scraper error:', error?.message);
    return [];
  }
}

function extractPriceRange(searchUrl: string): { min?: number; max?: number } {
  try {
    const url = new URL(searchUrl);
    return {
      min: url.searchParams.get('pricefrom') ? parseInt(url.searchParams.get('pricefrom')!) : undefined,
      max: url.searchParams.get('priceto') ? parseInt(url.searchParams.get('priceto')!) : undefined,
    };
  } catch {
    return {};
  }
}

function transformListing(item: any, priceRange: { min?: number; max?: number }): ScrapedListing | null {
  try {
    const d = item.details;
    if (!d) return null;

    const make = d.vehicle?.classification?.make?.formatted || '';
    const model = d.vehicle?.classification?.model?.formatted || '';
    const version = d.vehicle?.classification?.modelVersionCustom || '';
    const title = `${make} ${model} ${version}`.trim();
    if (!title) return null;

    const mileage = d.vehicle?.condition?.mileageInKm?.raw || null;
    const yearRaw = d.vehicle?.condition?.firstRegistrationDate?.formatted || '';
    const year = yearRaw ? yearRaw.split('/')[1] || yearRaw : '';
    const fuel = d.vehicle?.fuels?.primary?.type?.formatted || '';
    const power = d.vehicle?.engine?.power?.kw?.raw || null;
    const trans = d.vehicle?.engine?.transmissionType?.formatted || '';
    const city = d.location?.city || '';
    const country = d.location?.countryCode || '';
    const dealer = d.seller?.companyName || '';
    const dealerType = d.seller?.type || '';

    const specs = [
      mileage ? `${mileage.toLocaleString('de-DE')} km` : '',
      year,
      fuel,
      trans,
      power ? `${power} kW` : '',
    ].filter(Boolean).join(' · ');

    let priceText = 'Cena po dogovoru';
    if (priceRange.max) {
      priceText = priceRange.min
        ? `${priceRange.min.toLocaleString('de-DE')} – ${priceRange.max.toLocaleString('de-DE')} €`
        : `do ${priceRange.max.toLocaleString('de-DE')} €`;
    }

    const sellerBadge = dealerType === 'dealer' ? ` · 🏪 ${dealer}` : '';

    return {
      externalId: hashExternalId(`autoscout24-${item.id}`),
      title,
      priceText,
      price: null,
      url: `https://www.autoscout24.de/angebote/${item.id}`,
      location: [city, country].filter(Boolean).join(', '),
      description: `${specs}${sellerBadge}`,
      imageUrl: null,
      postedAt: null,
    };
  } catch {
    return null;
  }
}

function buildQueryString(searchUrl: string): string {
  const url = new URL(searchUrl);
  const params = Object.fromEntries(url.searchParams.entries());

  const pathParts = url.pathname.split('/').filter(Boolean);
  let pathMake: string | undefined;
  let pathModel: string | undefined;
  if (pathParts[0] === 'lst') {
    if (pathParts[1]) pathMake = pathParts[1];
    if (pathParts[2]) pathModel = pathParts[2];
  }

  const make = params.make || pathMake;
  const model = params.model || pathModel;

  const parts: string[] = ['sort=standard', 'desc=0', 'atype=C', 'ocs_listing=include'];
  
  if (params.cy) parts.push(`cy=${params.cy}`);
  if (make) parts.push(`make=${make}`);
  if (model) parts.push(`model=${model}`);
  if (params.fregfrom) parts.push(`fregfrom=${params.fregfrom}`);
  if (params.fregto) parts.push(`fregto=${params.fregto}`);
  if (params.pricefrom) parts.push(`pricefrom=${params.pricefrom}`);
  if (params.priceto) parts.push(`priceto=${params.priceto}`);
  if (params.fuel) parts.push(`fuel=${params.fuel}`);
  if (params.sort) parts[0] = `sort=${params.sort}`;
  
  return parts.join('&');
}

function applyFilters(listings: ScrapedListing[], filters: ScraperFilters): ScrapedListing[] {
  return listings.filter(l => {
    if (filters.minPrice && l.price && l.price < filters.minPrice) return false;
    if (filters.maxPrice && l.price && l.price > filters.maxPrice) return false;
    if (filters.keywords?.length) {
      const text = `${l.title} ${l.description || ''}`.toLowerCase();
      if (!filters.keywords.some(k => text.includes(k.toLowerCase()))) return false;
    }
    if (filters.excludeKeywords?.length) {
      const text = `${l.title} ${l.description || ''}`.toLowerCase();
      if (filters.excludeKeywords.some(k => text.includes(k.toLowerCase()))) return false;
    }
    return true;
  });
}

export function buildAutoScout24Url(params: {
  make?: string;
  model?: string;
  country?: string;
  minPrice?: number;
  maxPrice?: number;
  minYear?: number;
  maxYear?: number;
  fuelType?: string;
  sortBy?: string;
}): string {
  const base = 'https://www.autoscout24.de/lst';
  const segments: string[] = [];
  if (params.make) segments.push(params.make.toLowerCase());
  if (params.model) segments.push(params.model.toLowerCase());

  const qp = new URLSearchParams();
  qp.set('atype', 'C');
  if (params.country) qp.set('cy', params.country.toUpperCase());
  if (params.minPrice) qp.set('pricefrom', String(params.minPrice));
  if (params.maxPrice) qp.set('priceto', String(params.maxPrice));
  if (params.minYear) qp.set('fregfrom', String(params.minYear));
  if (params.maxYear) qp.set('fregto', String(params.maxYear));
  if (params.fuelType) qp.set('fuel', params.fuelType);
  if (params.sortBy) qp.set('sort', params.sortBy);

  return `${base}/${segments.join('/')}?${qp.toString()}`;
}
