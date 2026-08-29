import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { evaluateListing, type AiProviderType } from '@/lib/ai';
import { getSettingsRow } from '@/lib/pipeline';

function toAiSettings(s: { aiProvider: string; aiModel: string; aiApiKey: string; aiBaseUrl: string; fallbackProvider: string | null; fallbackModel: string | null; fallbackApiKey: string | null; fallbackBaseUrl: string | null }) {
  return {
    provider: s.aiProvider as AiProviderType,
    model: s.aiModel,
    apiKey: s.aiApiKey,
    baseUrl: s.aiBaseUrl,
    fallbackProvider: s.fallbackProvider as AiProviderType | undefined,
    fallbackModel: s.fallbackModel ?? undefined,
    fallbackApiKey: s.fallbackApiKey ?? undefined,
    fallbackBaseUrl: s.fallbackBaseUrl ?? undefined,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const monitorId = body.monitorId as string | undefined;
    const limit = Math.min(Number(body.limit) || 20, 50);

    const where: any = {};
    if (monitorId) where.monitorId = monitorId;

    const listings = await db.listing.findMany({
      where,
      select: {
        id: true, title: true, price: true, priceText: true, url: true,
        location: true, description: true, imageUrl: true,
        monitorId: true, aiVerdict: true,
        monitor: { select: { name: true, source: true, customPrompt: true } },
      },
      orderBy: { firstSeenAt: 'desc' },
      take: limit,
    });

    const settings = await getSettingsRow();
    const aiSettings = toAiSettings(settings);

    let evaluated = 0;
    let errors = 0;

    for (const listing of listings) {
      try {
        const evaluation = await evaluateListing(aiSettings, {
          title: listing.title,
          priceText: listing.priceText,
          price: listing.price,
          location: listing.location,
          description: listing.description,
          source: listing.monitor.source,
          monitorName: listing.monitor.name,
          customPrompt: listing.monitor.customPrompt,
          imageUrl: listing.imageUrl ?? null,
        });

        await db.listing.update({
          where: { id: listing.id },
          data: {
            aiScore: evaluation.ocena_prilike,
            aiRisk: evaluation.ocena_tveganja,
            aiVerdict: evaluation.verdict,
            aiReason: evaluation.razlog,
            aiEstimatedValue: evaluation.predvidena_trzna_vrednost,
            dealScore: evaluation.deal_score ?? null,
            dealScoreReason: evaluation.razlog,
            dealScoreComputedAt: new Date(),
          },
        });
        evaluated++;
      } catch {
        errors++;
      }
    }

    return NextResponse.json({ ok: true, evaluated, errors, total: listings.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'unknown' }, { status: 500 });
  }
}
