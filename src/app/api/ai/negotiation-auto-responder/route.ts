// v7.42: Negotiation Auto-Responder — AI predlaga counter-offer ko prodajalec odgovori.
//
// Ko prodajalec odgovori na tvojo ponudbo (contactStatus = 'responded'),
// AI analizira odgovor in predlaga:
// - Ali sprejeti, znižati, ali pohoditi
// - Counter-offer sporočilo (copy-paste)
// - Maksimalno ceno ki jo še splača plačati
//
// POST /api/ai/negotiation-auto-responder
// Body: { listingId: string, sellerResponse: string, yourOffer: number }
// Returns: { ok, recommendation, counterMessage, maxAcceptablePrice, strategy }

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
    const { listingId, sellerResponse, yourOffer } = body;

    if (!listingId || !sellerResponse) {
      return NextResponse.json({ error: 'listingId in sellerResponse sta obvezna' }, { status: 400 });
    }

    const listing = await db.listing.findUnique({
      where: { id: String(listingId) },
      select: {
        id: true, title: true, price: true, priceText: true,
        aiEstimatedValue: true, aiVerdict: true, aiRisk: true,
        description: true, sellerName: true,
        negotiationMessages: { orderBy: { createdAt: 'asc' }, take: 10, select: { direction: true, text: true, suggestedPrice: true, createdAt: true } },
      },
    });

    if (!listing) {
      return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
    }

    const askingPrice = listing.price ?? 0;
    const estValue = listing.aiEstimatedValue ?? askingPrice;
    const offer = yourOffer ? Number(yourOffer) : Math.round(askingPrice * 0.85);

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // Build conversation history
    const conversation = listing.negotiationMessages.map(m => {
      const prefix = m.direction === 'sent' ? 'TI' : 'PRODAJALEC';
      const price = m.suggestedPrice ? ` (ponudba: ${m.suggestedPrice}€)` : '';
      return `${prefix}: ${m.text}${price}`;
    }).join('\n');

    const prompt = `Si ekspert za pogajanje pri nakupu rabljenih dobrin na slovenskih oglasnih platformah.

SITUACIJA:
- Item: ${listing.title}
- Zahtevana cena: ${askingPrice}€
- AI ocenjena vrednost: ${estValue}€
- Tvoja ponudba: ${offer}€
- AI risk: ${listing.aiRisk ?? '?'}/10

ZGODOVINA POGAJANJ:
${conversation || '(ni prejšnjih sporočil)'}

PRODAJALČEV ZADNJI ODGOVOR:
"${sellerResponse}"

NALOGA:
1. Analiziraj prodajalčev odgovor — kakšen je tone? (prilagodljiv, trd, ignorira?)
2. Ali omenja ceno? Koliko sprašuje?
3. Predlagaj naslednji korak:
   - ACCEPT: sprejmi (če je dobra cena)
   - COUNTER: predlagaj drugo ceno
   - WALK Away: prenehaj (če je predrago)
4. Generiraj counter-offer sporočilo v slovenščini (50-100 besed)
5. Določi maksimalno ceno ki jo še splača plačati (max = estValue - 10% margin)

Odgovori LE z JSON:
{
  "analysis": "<kaj prodajalec dejansko pravi>",
  "tone": "<prilagodljiv|trd|nevtralen|ignorira>",
  "mentioned_price": <number ali null>,
  "action": "<accept|counter|walk_away>",
  "counter_price": <number ali null>,
  "max_acceptable_price": <number>,
  "counter_message": "<slovensko sporočilo za copy-paste>",
  "reasoning": "<1 stavek zakaj ta odgovor>"
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else {
        return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);

    // Save the seller's response + AI suggestion as negotiation messages
    await db.negotiationMessage.create({
      data: {
        listingId: listing.id,
        direction: 'received',
        text: String(sellerResponse).slice(0, 1000),
        status: 'counter_received',
      },
    }).catch(() => {});

    const action = ['accept', 'counter', 'walk_away'].includes(String(parsed?.action)) ? String(parsed.action) : 'counter';
    const maxAcceptable = Math.max(1, Math.min(Number(parsed?.max_acceptable_price ?? estValue * 0.9), estValue));

    return NextResponse.json({
      ok: true,
      recommendation: {
        action,
        analysis: String(parsed?.analysis ?? '').slice(0, 300),
        tone: String(parsed?.tone ?? 'nevtralen'),
        mentionedPrice: parsed?.mentioned_price ? Number(parsed.mentioned_price) : null,
        counterPrice: parsed?.counter_price ? Number(parsed.counter_price) : null,
        maxAcceptablePrice: Math.round(maxAcceptable),
        reasoning: String(parsed?.reasoning ?? '').slice(0, 200),
      },
      counterMessage: String(parsed?.counter_message ?? '').slice(0, 500),
      copyToClipboard: String(parsed?.counter_message ?? '').slice(0, 500),
      listingUrl: listing.id,
    });
  } catch (err: any) {
    logger.error('/api/ai/negotiation-auto-responder', 'POST handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
