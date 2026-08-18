// v7.55 / v8.94-refactor: Negotiation Outcome Predictor — AI napove izid pred ponudbo
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/negotiation-outcome-predictor
// Body: { listingId: string, offerPrice: number }

import { NextResponse } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface NegotiationPredictInput {
  listingId: string;
  offerPrice: number;
}

export const POST = withAiRoute<NegotiationPredictInput>({
  endpoint: '/api/ai/negotiation-outcome-predictor',
  maxDuration: 60,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      listingId: body?.listingId ? String(body.listingId) : '',
      offerPrice: Number(body?.offerPrice) || 0,
    };
  },

  validateInput: (input) => {
    if (!input.listingId || !input.offerPrice) {
      return 'listingId in offerPrice sta obvezna';
    }
    return null;
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { listingId, offerPrice } = input;

    // 1. Pridobi listing z negotiation history
    const listing = await db.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true, title: true, price: true, priceText: true, firstSeenAt: true,
        aiEstimatedValue: true, aiVerdict: true, aiRisk: true,
        sellerName: true, location: true,
        monitor: { select: { source: true } },
        negotiationMessages: {
          select: { direction: true, suggestedPrice: true, text: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });
    if (!listing) throw new ApiRouteError('Listing ne obstaja', 404);

    // 2. Izračunaj heuristične faktorje
    const { askingPrice, estValue, offer, discountPct } = computeBasics(listing, offerPrice);
    const factors = computeFactors(listing, askingPrice, estValue, offer);
    const computed = computeProbabilities(factors);

    // 3. AI enhancement (non-critical — fallback na computed)
    const prompt = buildPrompt(listing, askingPrice, estValue, offer, discountPct, factors);
    let aiPrediction: any = null;
    try {
      const raw = await callAi(prompt);
      aiPrediction = parseAi(raw);
    } catch {
      // Use computed probabilities only
    }

    // 4. Merge computed + AI (AI takes priority)
    const finalPredictions = mergePredictions(aiPrediction, computed);
    const optimalOffer = computeOptimalOffer(aiPrediction, estValue);
    const strategy = buildStrategy(finalPredictions, offer, optimalOffer, askingPrice, aiPrediction);

    return apiOk({
      prediction: {
        accept: finalPredictions.accept,
        counter: finalPredictions.counter,
        reject: finalPredictions.reject,
        predictedCounterPrice: aiPrediction?.predicted_counter_price_eur
          ? Math.round(Number(aiPrediction.predicted_counter_price_eur)) : null,
        optimalOffer,
        strategy,
        confidence: aiPrediction?.confidence
          ? Math.round(Number(aiPrediction.confidence))
          : Math.round((100 - Math.abs(finalPredictions.accept - finalPredictions.counter)) / 2),
      },
      analysis: {
        askingPrice, estValue, offer, discountPct,
        daysListed: factors.daysListed,
        risk: listing.aiRisk ?? 5,
        estValueFactor: Math.round(factors.estValueFactor * 100) / 100,
        discountFactor: Math.round(factors.discountFactor * 100) / 100,
        ageFactor: Math.round(factors.ageFactor * 100) / 100,
      },
      recommendation: strategy,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface ListingData {
  price: number | null;
  aiEstimatedValue: number | null;
  aiRisk: number | null;
  firstSeenAt: Date;
  title: string;
  monitor: { source: string } | null;
  negotiationMessages: Array<{ direction: string; text: string | null }>;
}

function computeBasics(listing: ListingData, offerPrice: number) {
  const askingPrice = listing.price ?? 0;
  const estValue = listing.aiEstimatedValue ?? Math.round(askingPrice * 1.15);
  const offer = Number(offerPrice);
  const discountPct = askingPrice > 0 ? Math.round(((askingPrice - offer) / askingPrice) * 100) : 0;
  return { askingPrice, estValue, offer, discountPct };
}

interface Factors {
  riskFactor: number;
  discountFactor: number;
  estValueFactor: number;
  daysListed: number;
  ageFactor: number;
}

function computeFactors(listing: ListingData, askingPrice: number, estValue: number, offer: number): Factors {
  const riskFactor = (listing.aiRisk ?? 5) / 10;
  const discountPct = askingPrice > 0 ? ((askingPrice - offer) / askingPrice) * 100 : 0;
  const discountFactor = Math.min(1, discountPct / 40);
  const estValueFactor = offer >= estValue ? 1 : offer / estValue;
  const daysListed = Math.floor((Date.now() - new Date(listing.firstSeenAt).getTime()) / 86400000);
  const ageFactor = Math.min(1, daysListed / 30);
  return { riskFactor, discountFactor, estValueFactor, daysListed, ageFactor };
}

interface Probabilities {
  accept: number;
  reject: number;
  counter: number;
}

function computeProbabilities(f: Factors): Probabilities {
  const accept = Math.round(
    f.estValueFactor * 40 + (1 - f.discountFactor) * 30 + f.ageFactor * 20 + (1 - f.riskFactor) * 10
  );
  const reject = Math.round(
    f.discountFactor * 35 + f.riskFactor * 30 + (1 - f.estValueFactor) * 25 + (1 - f.ageFactor) * 10
  );
  const counter = Math.max(0, 100 - accept - reject);
  return { accept, reject, counter };
}

function buildPrompt(
  listing: ListingData,
  askingPrice: number,
  estValue: number,
  offer: number,
  discountPct: number,
  f: Factors
): string {
  const recentMessages = listing.negotiationMessages
    .map(m => `${m.direction}: ${m.text?.slice(0, 50)}`)
    .join('; ') || 'none';

  return `Si ekspert za napovedovanje izida pogajanj pri nakupu rabljenih dobrin.

SITUACIJA:
- Item: ${listing.title}
- Zahtevana cena: ${askingPrice}€
- AI ocenjena vrednost: ${estValue}€
- Tvoja ponudba: ${offer}€ (${discountPct}% pod asking)
- AI risk: ${listing.aiRisk ?? 5}/10
- Dni na trgu: ${f.daysListed}
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
}

function mergePredictions(ai: any, computed: Probabilities): Probabilities {
  return {
    accept: ai?.accept_probability != null
      ? Math.max(0, Math.min(100, Math.round(Number(ai.accept_probability))))
      : computed.accept,
    counter: ai?.counter_probability != null
      ? Math.max(0, Math.min(100, Math.round(Number(ai.counter_probability))))
      : computed.counter,
    reject: ai?.reject_probability != null
      ? Math.max(0, Math.min(100, Math.round(Number(ai.reject_probability))))
      : computed.reject,
  };
}

function computeOptimalOffer(ai: any, estValue: number): number {
  return ai?.optimal_offer_eur != null
    ? Math.max(1, Math.round(Number(ai.optimal_offer_eur)))
    : Math.round(estValue * 0.9);
}

function buildStrategy(
  predictions: Probabilities,
  offer: number,
  optimalOffer: number,
  askingPrice: number,
  ai: any
): string {
  if (predictions.accept >= 50) {
    return `✅ Ponudba ${offer}€ ima ${predictions.accept}% accept probability. Pošlji!`;
  }
  if (predictions.counter >= 50) {
    const counterPrice = ai?.predicted_counter_price_eur
      ? Math.round(Number(ai.predicted_counter_price_eur))
      : Math.round(askingPrice * 0.9);
    return `🟡 Verjetno bo counter-offer (~${counterPrice}€). Pošlji ${offer}€ in bodi pripravljen na ${counterPrice}€.`;
  }
  const discountPct = Math.round((1 - (optimalOffer / askingPrice)) * 100);
  return `🔴 ${predictions.reject}% reject probability. Povečaj na ${optimalOffer}€ za boljše možnosti (${discountPct}% popust).`;
}
