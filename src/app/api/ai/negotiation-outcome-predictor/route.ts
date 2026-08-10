// v7.55: Negotiation Outcome Predictor — pred pošiljanjem ponudbe, AI napove izid.
//
// "Asking 300€, est value 280€, tvoja ponudba 250€:
//  ACCEPT probability: 15%, COUNTER probability: 60%, REJECT probability: 25%
//  Priporočilo: povečaj na 270€ za 40% accept probability."
//
// POST /api/ai/negotiation-outcome-predictor
// Body: { listingId: string, offerPrice: number }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId, offerPrice } = body;
    if (!listingId || !offerPrice) return NextResponse.json({ error: 'listingId in offerPrice sta obvezna' }, { status: 400 });

    const listing = await db.listing.findUnique({
      where: { id: String(listingId) },
      select: {
        id: true, title: true, price: true, priceText: true, firstSeenAt: true,
        aiEstimatedValue: true, aiVerdict: true, aiRisk: true,
        sellerName: true, location: true,
        monitor: { select: { source: true } },
        negotiationMessages: { select: { direction: true, suggestedPrice: true, text: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!listing) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });

    const askingPrice = listing.price ?? 0;
    const estValue = listing.aiEstimatedValue ?? Math.round(askingPrice * 1.15);
    const offer = Number(offerPrice);
    const discountPct = askingPrice > 0 ? Math.round(((askingPrice - offer) / askingPrice) * 100) : 0;

    // Compute outcome probabilities based on data (not just AI)
    // Factors:
    // 1. Discount depth: >30% off = likely reject, <10% = likely accept
    // 2. Offer vs est value: if offer > est value, seller should accept
    // 3. Seller risk: high risk seller = more likely to reject (scam)
    // 4. Days listed: longer = more likely to accept lower offer
    // 5. Previous negotiation history with this seller

    const riskFactor = (listing.aiRisk ?? 5) / 10; // 0 = safe, 1 = scam
    const discountFactor = Math.min(1, discountPct / 40); // 0 = no discount, 1 = 40%+ discount
    const estValueFactor = offer >= estValue ? 1 : offer / estValue; // 1 = at/above value, <1 = below
    const daysListed = Math.floor((Date.now() - new Date(listing.firstSeenAt).getTime()) / 86400000);
    const ageFactor = Math.min(1, daysListed / 30); // 0 = fresh, 1 = 30+ days (more likely to accept)

    // Probability model (weighted)
    const acceptProb = Math.round(
      (estValueFactor * 40 + (1 - discountFactor) * 30 + ageFactor * 20 + (1 - riskFactor) * 10)
    );
    const rejectProb = Math.round(
      (discountFactor * 35 + riskFactor * 30 + (1 - estValueFactor) * 25 + (1 - ageFactor) * 10)
    );
    const counterProb = Math.max(0, 100 - acceptProb - rejectProb);

    // AI enhancement (if available)
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const recentMessages = listing.negotiationMessages.map(m => `${m.direction}: ${m.text?.slice(0, 50)}`).join('; ') || 'none';

    const prompt = `Si ekspert za napovedovanje izida pogajanj pri nakupu rabljenih dobrin.

SITUACIJA:
- Item: ${listing.title}
- Zahtevana cena: ${askingPrice}€
- AI ocenjena vrednost: ${estValue}€
- Tvoja ponudba: ${offer}€ (${discountPct}% pod asking)
- AI risk: ${listing.aiRisk ?? 5}/10
- Dni na trgu: ${daysListed}
- Platforma: ${listing.monitor?.source || 'bolha'}
- Prejšnja pogajanja: ${recentMessages}

Napovej verjetnost izida (0-100%):
1. ACCEPT — prodajalec sprejme ponudbo
2. COUNTER — prodajalec predlaga drugo ceno
3. REJECT — prodajalec zavrne

Pravila:
- Če je ponudba > estValue → visok ACCEPT (razumno je)
- Če je popust >30% → visok REJECT (preveč nizko)
- Če je item 30+ dni na trgu → večja ACCEPT (prodajalec motiviran)
- Če je risk visok → večja REJECT (lahko scam)

Odgovori LE z JSON:
{
  "accept_probability": <number 0-100>,
  "counter_probability": <number 0-100>,
  "reject_probability": <number 0-100>,
  "predicted_counter_price_eur": <number ali null>,
  "optimal_offer_eur": <number — cena z 40%+ accept probability>,
  "strategy": "<1 stavek>",
  "confidence": <number 0-100>
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiPrediction: any = null;
    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      aiPrediction = parseJsonLooseExported(raw);
    } catch {
      // Use computed probabilities only
    }

    // Merge computed + AI predictions (AI takes priority if available)
    const finalAccept = aiPrediction?.accept_probability != null
      ? Math.max(0, Math.min(100, Math.round(Number(aiPrediction.accept_probability))))
      : acceptProb;
    const finalCounter = aiPrediction?.counter_probability != null
      ? Math.max(0, Math.min(100, Math.round(Number(aiPrediction.counter_probability))))
      : counterProb;
    const finalReject = aiPrediction?.reject_probability != null
      ? Math.max(0, Math.min(100, Math.round(Number(aiPrediction.reject_probability))))
      : rejectProb;

    const optimalOffer = aiPrediction?.optimal_offer_eur != null
      ? Math.max(1, Math.round(Number(aiPrediction.optimal_offer_eur)))
      : Math.round(estValue * 0.9); // 10% under est value = reasonable

    // Strategy
    let strategy = '';
    if (finalAccept >= 50) {
      strategy = `✅ Ponudba ${offer}€ ima ${finalAccept}% accept probability. Pošlji!`;
    } else if (finalCounter >= 50) {
      const counterPrice = aiPrediction?.predicted_counter_price_eur ? Math.round(Number(aiPrediction.predicted_counter_price_eur)) : Math.round(askingPrice * 0.9);
      strategy = `🟡 Verjetno bo counter-offer (~${counterPrice}€). Pošlji ${offer}€ in bodi pripravljen na ${counterPrice}€.`;
    } else {
      strategy = `🔴 ${finalReject}% reject probability. Povečaj na ${optimalOffer}€ za boljše možnosti (${Math.round((1 - (optimalOffer / askingPrice)) * 100)}% popust).`;
    }

    return NextResponse.json({
      ok: true,
      prediction: {
        accept: finalAccept,
        counter: finalCounter,
        reject: finalReject,
        predictedCounterPrice: aiPrediction?.predicted_counter_price_eur ? Math.round(Number(aiPrediction.predicted_counter_price_eur)) : null,
        optimalOffer,
        strategy,
        confidence: aiPrediction?.confidence ? Math.round(Number(aiPrediction.confidence)) : Math.round((100 - Math.abs(finalAccept - finalCounter)) / 2),
      },
      analysis: {
        askingPrice, estValue, offer, discountPct,
        daysListed, risk: listing.aiRisk ?? 5,
        estValueFactor: Math.round(estValueFactor * 100) / 100,
        discountFactor: Math.round(discountFactor * 100) / 100,
        ageFactor: Math.round(ageFactor * 100) / 100,
      },
      recommendation: strategy,
    });
  } catch (err: any) {
    logger.error('/api/ai/negotiation-outcome-predictor', 'POST handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
