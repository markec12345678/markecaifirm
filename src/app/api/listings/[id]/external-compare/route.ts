// v5.6: External Price Comparison — AI primerja ceno z zunanjimi viri
// GET /api/listings/:id/external-compare
// AI analizira naslov in išče podobne izdelke na drugih platformah (Amazon, eBay,AliExpress)
// Returns: { ok, comparisons: Array<{ source, productName, price, url, priceDiff, priceDiffPct }>, aiAnalysis }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const listing = await db.listing.findUnique({
    where: { id },
    select: {
      id: true, title: true, price: true, priceText: true, url: true,
      description: true, detailDescription: true,
      aiVerdict: true, aiScore: true, aiEstimatedValue: true, dealScore: true,
      monitor: { select: { name: true, source: true } },
    },
  });
  if (!listing) {
    return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
  }
  if (listing.price == null) {
    return NextResponse.json({ error: 'Oglas nima znane cene' }, { status: 400 });
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

  const prompt = buildComparePrompt(listing);

  let raw = '';
  try {
    raw = await callProviderForRaw(aiSettings, prompt);
  } catch (primaryError: any) {
    if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
      const fallbackSettings: AiSettings = {
        provider: aiSettings.fallbackProvider,
        baseUrl: aiSettings.fallbackBaseUrl || '',
        apiKey: aiSettings.fallbackApiKey || '',
        model: aiSettings.fallbackModel,
      };
      raw = await callProviderForRaw(fallbackSettings, prompt);
    } else {
      return NextResponse.json({ error: primaryError?.message ?? 'AI call failed' }, { status: 500 });
    }
  }

  const parsed: any = parseJsonLooseExported(raw);
  const currentPrice = listing.price;
  const comparisons = (parsed?.comparisons || []).map((c: any) => {
    const extPrice = clampInt(c?.price, 0, 1_000_000);
    return {
      source: String(c?.source ?? 'neznan'),
      productName: String(c?.product_name ?? c?.productName ?? '').slice(0, 200),
      price: extPrice,
      url: String(c?.url ?? '').slice(0, 500),
      priceDiff: currentPrice - (extPrice ?? 0),
      priceDiffPct: extPrice != null && extPrice > 0
        ? Math.round(((currentPrice - extPrice) / extPrice) * 100)
        : null,
    };
  }).filter((c: any) => c.price != null);

  // Increment AI usage counter
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
    comparisons,
    aiAnalysis: String(parsed?.analysis ?? '').slice(0, 1000),
    aiRecommendation: String(parsed?.recommendation ?? '').slice(0, 300),
    currentPrice,
  });
}

function buildComparePrompt(listing: any): string {
  const parts: string[] = [
    'Si ekspert za primerjavo cen izdelkov na različnih platformah.',
    'Za naslednji oglas poišči podobne izdelke na drugih platformah in primerjaj cene.',
    '',
    `Naslov: ${listing.title}`,
    `Cena: ${listing.priceText} (${listing.price}€)`,
    `Vir: ${listing.monitor?.source ?? 'neznan'}`,
    `Opis: ${(listing.detailDescription || listing.description || '').slice(0, 500)}`,
    '',
    'Iskanje na platformah:',
    '- Amazon (amazon.com / amazon.de)',
    '- eBay (ebay.com)',
    '- AliExpress (aliexpress.com)',
    '- Bolha (bolha.com — slovensko)',
    '- Vinted (vinted.si — za oblačila)',
    '',
    'Za vsako platformo najdi najbolj podoben izdelek in ceno.',
    'Če na platformi ni primerljivega izdelka, jo preskoči.',
    '',
    'Odgovori LE z JSON:',
    '{',
    '  "comparisons": [',
    '    {',
    '      "source": "<amazon|ebay|aliexpress|bolha|vinted>",',
    '      "product_name": "<ime izdelka na tej platformi>",',
    '      "price": <number EUR>,',
    '      "url": "<URL do izdelka ali iskalne strani>"',
    '    }',
    '  ],',
    '  "analysis": "<1-2 stavka analize v slovenščini>",',
    '  "recommendation": "<kupi tukaj / išči drugje / dobra cena>"',
    '}',
  ];
  return parts.join('\n');
}

function clampInt(v: any, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
}
