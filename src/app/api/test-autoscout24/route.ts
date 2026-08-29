import { NextResponse } from 'next/server';
import { scrapeAutoScout24, buildAutoScout24Url } from '@/lib/scraper-autoscout24';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const make = searchParams.get('make') || 'volkswagen';
    const model = searchParams.get('model') || 'golf';
    const country = searchParams.get('country') || 'de';
    const maxPrice = parseInt(searchParams.get('maxPrice') || '15000');
    const minYear = parseInt(searchParams.get('minYear') || '2015');

    const url = buildAutoScout24Url({
      make,
      model,
      country,
      maxPrice,
      minYear,
      sortBy: 'price',
    });

    console.log('Scraping URL:', url);
    const listings = await scrapeAutoScout24(url);

    return NextResponse.json({
      url,
      count: listings.length,
      listings: listings.slice(0, 20),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
