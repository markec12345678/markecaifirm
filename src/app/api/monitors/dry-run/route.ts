import { NextRequest, NextResponse } from 'next/server';
import { scrape, type SourceType, type ScraperFilters } from '@/lib/scraper';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/monitors/dry-run
 * Test scraping without saving listings or calling AI.
 * Returns first 10 listings found for inspection.
 *
 * Body: { source, sourceUrl, keywords?, excludeKeywords?, minPrice?, maxPrice?, playwrightEnabled? }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (!body?.source || !body?.sourceUrl) {
    return NextResponse.json({ error: 'source in sourceUrl sta obvezna' }, { status: 400 });
  }

  const filters: ScraperFilters = {
    keywords: (body.keywords ?? '').split(',').map((s: string) => s.trim()).filter(Boolean),
    excludeKeywords: (body.excludeKeywords ?? '').split(',').map((s: string) => s.trim()).filter(Boolean),
    minPrice: typeof body.minPrice === 'number' ? body.minPrice : null,
    maxPrice: typeof body.maxPrice === 'number' ? body.maxPrice : null,
  };

  // Get playwrightEnabled from settings
  const settings = await db.settings.findUnique({ where: { id: 'singleton' } });
  const playwrightEnabled = settings?.playwrightEnabled ?? false;

  try {
    const startedAt = Date.now();
    const listings = await scrape(
      body.source as SourceType,
      body.sourceUrl,
      filters,
      { playwrightEnabled }
    );
    const durationMs = Date.now() - startedAt;
    return NextResponse.json({
      ok: true,
      count: listings.length,
      durationMs,
      sample: listings.slice(0, 10),
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.message ?? 'Napaka pri scraping',
      count: 0,
    }, { status: 200 });
  }
}
