// v7.35: AI Make Offer Generator — 1-click optimizirano sporočilo prodajalcu.
//
// Generates a negotiation message based on:
// - Listing details (title, price, description)
// - AI valuation (aiEstimatedValue)
// - Seller reputation
// - Negotiation psychology (anchoring, social proof, urgency)
//
// POST /api/ai/make-offer
// Body: { listingId: string, offerPrice?: number, tone?: 'friendly' | 'direct' | 'expert' }
// Returns: { ok, message, suggestedPrice, strategy, openSellerUrl, clipboardText }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId, tone = 'friendly' } = body;
    const offerPrice = body.offerPrice ? Number(body.offerPrice) : null;

    if (!listingId) {
      return NextResponse.json({ error: 'listingId je obvezen' }, { status: 400 });
    }

    const listing = await db.listing.findUnique({
      where: { id: String(listingId) },
      select: {
        id: true, title: true, price: true, priceText: true, url: true,
        description: true, aiVerdict: true, aiScore: true, aiRisk: true,
        aiEstimatedValue: true, location: true, sellerName: true,
        monitor: { select: { source: true, name: true } },
      },
    });

    if (!listing) {
      return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
    }

    if (!listing.price || listing.price <= 0) {
      return NextResponse.json({ error: 'Oglas nima cene — ne morem generirati ponudbe.' }, { status: 400 });
    }

    // Compute suggested offer price (15% below asking, but not below AI est. value)
    const askingPrice = listing.price;
    const aiValue = listing.aiEstimatedValue ?? askingPrice;
    const defaultOffer = Math.round(askingPrice * 0.85); // 15% below asking
    const suggestedPrice = offerPrice ?? Math.max(defaultOffer, Math.round(aiValue * 0.9));

    // Determine the seller contact URL (platform-specific)
    const source = listing.monitor?.source || 'bolha';
    let openSellerUrl = listing.url; // Default: the listing itself
    // For Bolha, the contact form is on the listing page
    // For mobile.de, there's a "Contact seller" button on the listing
    // For others, the listing URL is the entry point

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const toneMap: Record<string, string> = {
      friendly: 'prijateljski, vljuden, a odločen',
      direct: 'direkten, kratek, posloven',
      expert: 'ekspert — pokaži znanje o artiklu, vplivaj s strokovnostjo',
    };

    const prompt = `Si ekspert za pogajanje pri nakupu rabljenih dobrin na slovenskih oglasnih platformah.

Generiraj sporočilo prodajalcu za ta oglas:

NASLOV: ${listing.title}
CENA (asking): ${askingPrice}€
AI OCENA VREDNOSTI: ${aiValue}€
AI VERDICT: ${listing.aiVerdict || 'neznan'}
AI RISK: ${listing.aiRisk ?? '?'}/10
LOKACIJA: ${listing.location || 'neznan'}
VIR: ${source}
PRODAJALEC: ${listing.sellerName || 'neznan'}

PONUJENA CENA: ${suggestedPrice}€ (${Math.round(((askingPrice - suggestedPrice) / askingPrice) * 100)}% pod asking price)

TON: ${toneMap[tone] || toneMap.friendly}

PRAVILA:
1. Slovenski jezik, naravno in neposredno (ne "spoštovani" — preveč formalno za Bolha)
2. Začni z osebnim vtisom o artiklu (pokaži da si resen kupec, ne time-waster)
3. Omeni 1-2 pozitivni vidik artikla (iz opisa ali naslova)
4. Predlagaj ceno ${suggestedPrice}€ z utemeljitvijo (razumen argument, ne agresivno)
5. Dodaj "kupim takoj" ali "lahko prevzamem ta teden" za urgency
6. Končaj z odprtim vprašanjem (ne da/nej, ampak "kdaj bi lahko" ali "kje točno")
7. Dolžina: 50-100 besed (ne predolgo — Bolha sporočila so kratka)

Odgovori LE z JSON:
{
  "message": "<celotno sporočilo v slovenščini>",
  "strategy": "<ena besedna opis strategije, npr. 'anchor-low + urgency'>",
  "psychology": "<katero taktiko uporablja, npr. 'anchoring effect, social proof'>",
  "expected_response_time_hours": <number>,
  "fallback_message": "<krajše sporočilo če prodajalec ne odgovori v 24h>"
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = {
          provider: aiSettings.fallbackProvider,
          baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '',
          model: aiSettings.fallbackModel,
        };
        raw = await callProviderForRaw(fb, prompt);
      } else {
        return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);

    const result = {
      ok: true,
      message: String(parsed?.message ?? '').trim(),
      strategy: String(parsed?.strategy ?? '').slice(0, 100),
      psychology: String(parsed?.psychology ?? '').slice(0, 100),
      expectedResponseTimeHours: Math.max(1, Math.min(168, Number(parsed?.expected_response_time_hours ?? 24))),
      fallbackMessage: String(parsed?.fallback_message ?? '').trim(),
      suggestedPrice,
      askingPrice,
      discountPct: Math.round(((askingPrice - suggestedPrice) / askingPrice) * 100),
      openSellerUrl,
      source,
      tone,
    };

    // Track AI call
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    // Update listing contactStatus to 'contacted'
    await db.listing.update({
      where: { id: listing.id },
      data: { contactStatus: 'contacted', contactedAt: new Date() },
    }).catch(() => {});

    return NextResponse.json(result);
  } catch (e: any) {
    logger.error('/api/ai/make-offer', 'POST handler failed', e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
