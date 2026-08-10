// v7.54: AI Conversation Memory — pomni prejšnja pogajanja z istim prodajalcem.
//
// "Pri Janez123 si že pogajal 3x — zadnjič si ponudil 200€, zavrnil je,
//  rekel je da ne gre pod 250€. Tokrat začni pri 230€ (blizu njegovega min)."
//
// POST /api/ai/conversation-memory
// Body: { sellerName: string, currentListingTitle?: string }
// Returns: { ok, memory: { pastNegotiations, sellerPattern, suggestedOpeningPrice, strategy } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { sellerName } = body;
    if (!sellerName) return NextResponse.json({ error: 'sellerName je obvezen' }, { status: 400 });

    // Get all listings by this seller with negotiation messages
    const listings = await db.listing.findMany({
      where: { sellerName, negotiationMessages: { some: {} } },
      select: {
        id: true, title: true, price: true, priceText: true,
        contactStatus: true, contactedAt: true, sellerResponse: true,
        negotiationMessages: {
          select: { direction: true, text: true, suggestedPrice: true, status: true, createdAt: true, aiNextStep: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      take: 20,
    });

    if (listings.length === 0) {
      return NextResponse.json({
        ok: true,
        memory: {
          hasHistory: false,
          message: 'Ni prejšnjih pogajanj s tem prodajalcem.',
          suggestedOpeningPrice: null,
          strategy: 'Standardni pristop — 15% pod asking price.',
        },
      });
    }

    // Analyze negotiation patterns
    const allMessages = listings.flatMap(l => l.negotiationMessages.map(m => ({ ...m, listingTitle: l.title, listingPrice: l.price })));
    const sentOffers = allMessages.filter(m => m.direction === 'sent' && m.suggestedPrice);
    const receivedResponses = allMessages.filter(m => m.direction === 'received');

    // Price pattern: what did you offer vs what did they accept?
    const acceptedNegotiations = listings.filter(l => l.contactStatus === 'closed' || l.contactStatus === 'responded');
    const lastOfferPrices = sentOffers.map(m => m.suggestedPrice!).filter(p => p > 0);
    const avgOfferPrice = lastOfferPrices.length > 0 ? Math.round(lastOfferPrices.reduce((s, p) => s + p, 0) / lastOfferPrices.length) : 0;

    // Seller behavior patterns
    const responseRate = listings.length > 0 ? Math.round((listings.filter(l => l.contactStatus !== 'contacted').length / listings.length) * 100) : 0;

    // Find the seller's "minimum" — lowest price they ever mentioned
    const mentionedPrices: number[] = [];
    for (const m of receivedResponses) {
      const priceMatch = m.text?.match(/(\d+)\s*€/);
      if (priceMatch) mentionedPrices.push(parseInt(priceMatch[1]));
    }
    const sellerMinPrice = mentionedPrices.length > 0 ? Math.min(...mentionedPrices) : null;

    // Extract negotiation outcomes
    const outcomes = listings.map(l => ({
      title: l.title.slice(0, 50),
      askingPrice: l.price,
      yourOffer: l.negotiationMessages.find(m => m.direction === 'sent')?.suggestedPrice ?? null,
      sellerResponse: l.contactStatus,
      outcome: l.contactStatus === 'closed' ? 'DEAL' : l.contactStatus === 'responded' ? 'NEGOTIATED' : 'NO_RESPONSE',
      lastMessage: l.negotiationMessages[l.negotiationMessages.length - 1]?.text?.slice(0, 100) ?? null,
    }));

    // Strategy recommendation
    let strategy = '';
    let suggestedOpeningPrice: number | null = null;

    if (responseRate < 30) {
      strategy = '🔴 Prodajalec redko odgovarja. Ne porabi veliko časa — pošlji 1 ponudbo in počakaj 24h.';
    } else if (sellerMinPrice != null) {
      strategy = `📊 Prodajalec je prej omenil minimum ${sellerMinPrice}€. Začni pri ${Math.round(sellerMinPrice * 1.05)}€ (5% nad njegovim minimumom).`;
      suggestedOpeningPrice = Math.round(sellerMinPrice * 1.05);
    } else if (avgOfferPrice > 0) {
      strategy = `📊 Povprečno si ponujal ${avgOfferPrice}€. Zadrži podobno raven ali začni nekoliko nižje.`;
    } else if (responseRate >= 70) {
      strategy = '✅ Prodajalec dobro odgovarja. Agresivnejša ponudba je varna — začni 20% pod asking.';
    } else {
      strategy = '🟡 Zmerna response rate. Standardna ponudba 15% pod asking price.';
    }

    // Past negotiation summary
    const pastNegotiations = outcomes.slice(0, 5).map(o => ({
      title: o.title,
      askingPrice: o.askingPrice,
      yourOffer: o.yourOffer,
      outcome: o.outcome,
      lastMessage: o.lastMessage,
    }));

    return NextResponse.json({
      ok: true,
      memory: {
        hasHistory: true,
        totalNegotiations: listings.length,
        responseRate,
        sellerMinPrice,
        avgYourOffer: avgOfferPrice,
        pastNegotiations,
        suggestedOpeningPrice,
        strategy,
        warning: responseRate < 30 ? 'Nizka response rate — morda ne izgubi časa' : undefined,
      },
    });
  } catch (err: any) {
    logger.error('/api/ai/conversation-memory', 'POST handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
