import { NextResponse } from 'next/server';

interface PriceResult {
  source: string;
  title: string;
  price: number;
  currency: string;
  url: string;
}

async function searchEbay(query: string): Promise<PriceResult[]> {
  const results: PriceResult[] = [];
  try {
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&_sop=15&LH_Complete=1&LH_Sold=1&_ipg=20`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html = await res.text();
    
    const itemRegex = /<div[^>]*class="[^"]*s-item[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*s-item__price[^"]*"[^>]*>\s*([\$\€\£]\s*[\d,]+\.?\d*)\s*<\/span>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*class="[^"]*s-item__link[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*s-item__title[^"]*"[^>]*>([^<]*)<\/span>/gi;
    
    let match;
    while ((match = itemRegex.exec(html)) !== null && results.length < 10) {
      const priceStr = match[1].replace(/[^\d.,]/g, '').replace(',', '');
      const price = parseFloat(priceStr);
      if (price > 0 && !isNaN(price)) {
        results.push({
          source: 'ebay',
          title: match[3].trim(),
          price,
          currency: match[1].includes('€') ? 'EUR' : match[1].includes('$') ? 'USD' : 'GBP',
          url: match[2],
        });
      }
    }
  } catch {}
  return results;
}

async function searchAmazon(query: string): Promise<PriceResult[]> {
  const results: PriceResult[] = [];
  try {
    const url = `https://www.amazon.de/s?k=${encodeURIComponent(query)}&i=`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'de-DE,de;q=0.9',
      },
    });
    const html = await res.text();
    
    const priceRegex = /<span[^>]*class="[^"]*a-price-whole[^"]*"[^>]*>(\d+)<\/span>[^<]*<span[^>]*class="[^"]*a-price-fraction[^"]*"[^>]*>(\d+)<\/span>/gi;
    let match;
    while ((match = priceRegex.exec(html)) !== null && results.length < 10) {
      const price = parseFloat(`${match[1]}.${match[2]}`);
      if (price > 0) {
        results.push({
          source: 'amazon',
          title: query,
          price,
          currency: 'EUR',
          url,
        });
      }
    }
  } catch {}
  return results;
}

function calculateMargin(buyPrice: number, sellPrice: number): number {
  if (sellPrice <= 0) return 0;
  return Math.round(((sellPrice - buyPrice) / sellPrice) * 100);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');
    const buyPrice = parseFloat(searchParams.get('buy') || '0');
    
    if (!query) {
      return NextResponse.json({ error: 'Manjka parameter q (query)' }, { status: 400 });
    }

    const [ebayResults, amazonResults] = await Promise.all([
      searchEbay(query),
      searchAmazon(query),
    ]);

    const allResults = [...ebayResults, ...amazonResults];
    
    let avgPrice = 0;
    let minPrice = 0;
    let maxPrice = 0;
    let margin = 0;
    
    if (allResults.length > 0) {
      const prices = allResults.map(r => r.price);
      avgPrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      minPrice = Math.min(...prices);
      maxPrice = Math.max(...prices);
      if (buyPrice > 0) {
        margin = calculateMargin(buyPrice, avgPrice);
      }
    }

    return NextResponse.json({
      query,
      buyPrice,
      avgPrice,
      minPrice,
      maxPrice,
      margin,
      results: allResults.slice(0, 10),
      totalResults: allResults.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
