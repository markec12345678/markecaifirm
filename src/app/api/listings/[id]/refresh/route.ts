import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { scrape, type SourceType, type ScraperFilters } from '@/lib/scraper';
import { evaluateListing, type AiSettings } from '@/lib/ai';
import { getSettingsRow } from '@/lib/pipeline';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/listings/:id/refresh
 * Manually re-scrape a single listing from its source and re-evaluate with AI.
 * Updates price, description, and AI evaluation.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const listing = await db.listing.findUnique({
      where: { id },
      include: { monitor: { select: { id: true, name: true, source: true, sourceUrl: true, keywords: true, excludeKeywords: true, minPrice: true, maxPrice: true, customPrompt: true } } },
    });
    if (!listing) return NextResponse.json({ error: 'Ne najdem' }, { status: 404 });

    const settings = await getSettingsRow();
    const aiSettings: any = {
      provider: settings.aiProvider,
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
      fallbackProvider: settings.fallbackProvider || undefined,
      fallbackBaseUrl: settings.fallbackBaseUrl || undefined,
      fallbackApiKey: settings.fallbackApiKey || undefined,
      fallbackModel: settings.fallbackModel || undefined,
    };

    // Re-scrape the monitor's source URL to find this listing
    const filters: ScraperFilters = {
      keywords: listing.monitor.keywords.split(',').map(s => s.trim()).filter(Boolean),
      excludeKeywords: listing.monitor.excludeKeywords.split(',').map(s => s.trim()).filter(Boolean),
      minPrice: listing.monitor.minPrice,
      maxPrice: listing.monitor.maxPrice,
    };

    try {
      const scraped = await scrape(
        listing.monitor.source as SourceType,
        listing.monitor.sourceUrl,
        filters,
        { playwrightEnabled: settings.playwrightEnabled }
      );

      // Find this listing in the scraped results by externalId
      const found = scraped.find(s => s.externalId === listing.externalId);
      if (!found) {
        return NextResponse.json({ ok: false, error: 'Oglas ni več na voljo na viru (morda prodan/odstranjen)' });
      }

      // Check if price changed
      const priceChanged = found.price !== listing.price;
      if (priceChanged && found.price != null && listing.price != null && found.price < listing.price) {
        // Record price drop
        await db.priceHistory.create({
          data: { listingId: listing.id, price: found.price, priceText: found.priceText },
        });
        await db.listing.update({
          where: { id: listing.id },
          data: {
            previousPrice: listing.price,
            priceDroppedAt: new Date(),
            price: found.price,
            priceText: found.priceText,
            description: found.description || listing.description,
            imageUrl: found.imageUrl || listing.imageUrl,
          },
        });
      } else {
        await db.listing.update({
          where: { id: listing.id },
          data: {
            price: found.price ?? listing.price,
            priceText: found.priceText,
            description: found.description || listing.description,
            imageUrl: found.imageUrl || listing.imageUrl,
          },
        });
      }

      // Re-evaluate with AI
      let evaluation: any = null;
      let evalError: string | null = null;
      try {
        let imageBase64: string | null = null;
        if (settings.imageAnalysisEnabled && listing.imageUrl) {
          const { downloadImageAsBase64 } = await import('@/lib/ai');
          imageBase64 = await downloadImageAsBase64(listing.imageUrl, { timeoutMs: 8000 });
        }
        evaluation = await evaluateListing(aiSettings, {
          title: listing.title,
          priceText: found.priceText,
          price: found.price,
          location: listing.location,
          description: found.description || listing.description,
          source: listing.monitor.source,
          monitorName: listing.monitor.name,
          customPrompt: listing.monitor.customPrompt,
          imageBase64,
          imageUrl: listing.imageUrl ?? null,
        });
      } catch (e: any) {
        evalError = e?.message ?? 'AI eval error';
      }

      if (evaluation) {
        await db.listing.update({
          where: { id: listing.id },
          data: {
            aiScore: evaluation.ocena_prilike,
            aiRisk: evaluation.ocena_tveganja,
            aiVerdict: evaluation.verdict,
            aiReason: evaluation.razlog,
            aiEstimatedValue: evaluation.predvidena_trzna_vrednost ?? null,
            aiEvaluatedAt: new Date(),
            aiImageAnalysis: evaluation.image_analysis ?? null,
            aiImageVerdict: evaluation.image_verdict ?? null,
          },
        });
      }

      return NextResponse.json({
        ok: true,
        priceChanged,
        newPrice: found.price,
        oldPrice: listing.price,
        evaluation: evaluation ? {
          verdict: evaluation.verdict,
          score: evaluation.ocena_prilike,
          risk: evaluation.ocena_tveganja,
          reason: evaluation.razlog,
        } : null,
        evalError,
      });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message ?? 'Napaka pri osveževanju' });
    }

  } catch (err) {
    logger.error("/api/listings/[id]/refresh", "POST handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
