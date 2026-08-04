// v4.4: AI Deal Score (0-100) — separate from aiScore (1-10)
// AI evaluates the listing and returns a 0-100 score with reasoning.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { scoreDeal, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const listing = await db.listing.findUnique({
      where: { id },
      include: { monitor: true },
    });
    if (!listing) {
      return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '',
      fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    try {
      const result = await scoreDeal(aiSettings, {
        title: listing.title,
        priceText: listing.priceText,
        price: listing.price,
        location: listing.location,
        description: listing.description,
        detailDescription: listing.detailDescription,
        source: listing.monitor?.source,
        aiEstimatedValue: listing.aiEstimatedValue,
        previousPrice: listing.previousPrice,
      });

      const updated = await db.listing.update({
        where: { id },
        data: {
          dealScore: result.dealScore,
          dealScoreReason: result.reason,
          dealScoreComputedAt: new Date(),
        },
      });

      // Increment daily AI usage counter
      const today = new Date().toISOString().slice(0, 10);
      if (settings.aiCallsDate !== today) {
        await db.settings.update({
          where: { id: 'singleton' },
          data: { aiCallsDate: today, aiCallsToday: 1 },
        });
      } else {
        await db.settings.update({
          where: { id: 'singleton' },
          data: { aiCallsToday: { increment: 1 } },
        });
      }

      return NextResponse.json({
        ok: true,
        dealScore: updated.dealScore,
        dealScoreReason: updated.dealScoreReason,
        dealScoreComputedAt: updated.dealScoreComputedAt,
      });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'AI call failed' }, { status: 500 });
    }

  } catch (err) {
    logger.error("/api/listings/[id]/score", "POST handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
