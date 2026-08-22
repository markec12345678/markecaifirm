// v6.14 / v8.96.1-batch2: AI Negotiation Outcome Predictor — napove verjetnost uspeha ponudbe
// Refaktoriran z withAiRoute helperjem (v8.96.1) + enforceBudget guard.
//
// POST /api/ai/negotiation-outcome
// Body: { listingId?: string, offerPrice?: number, message?: string, listing?: {...} }
// Returns: { ok, prediction: { successProbability, expectedCounterOffer, suggestedOffer, factors, scenarios, warnings, optimalStrategy } }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface ListingInput {
  title: string;
  price?: number | null;
  priceText?: string;
  location?: string;
  description?: string;
  source?: string;
  postedAt?: string | null;
  sellerName?: string | null;
}

interface NegotiationOutcomeInput {
  listingId: string | null;
  offerPrice: number;
  message: string;
  listing: ListingInput | null;
}

export const POST = withAiRoute<NegotiationOutcomeInput>({
  endpoint: '/api/ai/negotiation-outcome',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const { listingId, offerPrice, message } = body;
    return {
      listingId: listingId ? String(listingId) : null,
      offerPrice: Number(offerPrice) || 0,
      message: String(message || '').trim(),
      listing: body?.listing ?? null,
    };
  },

  // No validateInput — listing lookup needs DB access, validation je v handlerju
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { listingId, offerPrice, message } = input;
    let listingInput: ListingInput | null = input.listing;
    const userOffer = offerPrice;
    const userMessage = message;

    // 1. Pridobi listing
    if (listingId && !listingInput) {
      const listing = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: {
          title: true, price: true, priceText: true, location: true, description: true,
          detailDescription: true, url: true, aiEstimatedValue: true, aiRisk: true,
          aiVerdict: true, aiReason: true, dealScore: true, postedAt: true,
          sellerName: true, sellerListingCount: true, previousPrice: true, priceDroppedAt: true,
          firstSeenAt: true, monitor: { select: { source: true, name: true } },
        },
      });
      if (!listing) throw new ApiRouteError('Listing ne obstaja', 404);
      listingInput = {
        title: listing.title,
        price: listing.price,
        priceText: listing.priceText,
        location: listing.location,
        description: listing.detailDescription || listing.description,
        source: listing.monitor?.source,
        postedAt: listing.postedAt?.toISOString() ?? null,
        sellerName: listing.sellerName,
      };
    }

    if (!listingInput) {
      return apiBadRequest('listingId ali listing objekt je obvezen');
    }

    const listPrice = Number(listingInput.price) || 0;
    const estValue = listPrice * 1.2; // približek če ni na voljo AI estimated
    const userOfferFinal = userOffer > 0 ? userOffer : Math.round(listPrice * 0.85);
    const discountRequested = listPrice > 0 ? Math.round(((listPrice - userOfferFinal) / listPrice) * 100) : 0;

    // 2. Pridobi kontekst — prodajalčeva zgodovina in podobni oglasi
    const sellerHistory = listingInput.sellerName
      ? await fetchSellerHistory(db, listingInput.sellerName)
      : '';
    const marketContext = listPrice > 0
      ? await fetchMarketContext(db, listPrice)
      : '';

    // 3. AI prediction
    const daysSincePosted = listingInput.postedAt
      ? Math.round((Date.now() - new Date(listingInput.postedAt).getTime()) / (24 * 60 * 60 * 1000))
      : 0;

    const prompt = buildPrompt({
      listingInput,
      listPrice,
      sellerHistory,
      marketContext,
      userOfferFinal,
      discountRequested,
      userMessage,
      daysSincePosted,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const prediction = transformPrediction(parsed, userOfferFinal, listPrice);

    return apiOk({
      ok: true,
      prediction,
      listing: listingInput,
      userOffer: userOfferFinal,
      discountRequested,
      marketContext,
      sellerHistory,
      daysSincePosted,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

type DbClient = AiRouteContext['db'];

async function fetchSellerHistory(db: DbClient, sellerName: string): Promise<string> {
  const sellerListings = await db.listing.findMany({
    where: { sellerName, isHidden: false },
    select: { price: true, previousPrice: true, priceDroppedAt: true, firstSeenAt: true, title: true },
    take: 30,
  });
  const droppedCount = sellerListings.filter(l => l.priceDroppedAt).length;
  const dropRate = sellerListings.length > 0 ? Math.round((droppedCount / sellerListings.length) * 100) : 0;
  const avgDaysListed = sellerListings.length > 0
    ? Math.round(sellerListings.reduce((s, l) => s + (Date.now() - l.firstSeenAt.getTime()) / (24 * 60 * 60 * 1000), 0) / sellerListings.length)
    : 0;
  return `${sellerListings.length} oglasov, ${dropRate}% je znižalo ceno, povp. ${avgDaysListed}d na trgu`;
}

async function fetchMarketContext(db: DbClient, listPrice: number): Promise<string> {
  const similar = await db.listing.findMany({
    where: { price: { gte: Math.floor(listPrice * 0.7), lte: Math.ceil(listPrice * 1.3) }, isHidden: false },
    select: { price: true, firstSeenAt: true },
    take: 20,
  });
  const prices = similar.map(l => l.price!).filter(Boolean);
  if (prices.length > 0) {
    const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    return `Tržno povprečje: ${avg}€ (range ${Math.min(...prices)}-${Math.max(...prices)}€)`;
  }
  return '';
}

interface PromptData {
  listingInput: ListingInput;
  listPrice: number;
  sellerHistory: string;
  marketContext: string;
  userOfferFinal: number;
  discountRequested: number;
  userMessage: string;
  daysSincePosted: number;
}

function buildPrompt(d: PromptData): string {
  return `Si ekspert za napovedovanje izida pogajanj pri nakupu rabljenih dobrin.
Predvidi uspešnost ponudbe uporabnika za ta oglas.

OGLAS:
Naslov: ${d.listingInput.title}
Cena: ${d.listingInput.priceText || (d.listPrice + ' EUR')}
Lokacija: ${d.listingInput.location || 'neznan'}
VIR: ${d.listingInput.source || 'neznan'}
Starost oglasa: ${d.daysSincePosted} dni
Opis: ${(d.listingInput.description || '').slice(0, 500)}

PRODAJALEC:
${d.sellerHistory || '- Ni podatkov'}

TRŽNI KONTEKST:
${d.marketContext || '- Ni podatkov'}

UPORABNIKOVA PONUDBA:
- Ponujena cena: ${d.userOfferFinal}€ (popust ${d.discountRequested}% glede na zahtevano)
- Sporočilo: ${d.userMessage || '(brez sporočila — samo cena)'}

Pravila za napoved:
1. Verjetnost uspeha (0-100%) glede na:
   - Razlika med ponudbo in tržno vrednostjo
   - Starost oglasa (starejši = bolj motiviran prodajalec)
   - Prodajalčeva zgodovina (zniževal ali ne)
   - Konkurenca (koliko podobnih oglasov)
   - Kvaliteta sporočila (ali kaže resno zanimanje)

2. Predvideni proti-predlog prodajalca (counter-offer)

3. Optimalna strategija:
   - če je popust <15%: high probability, pošlji direktno
   - če je popust 15-25%: medium probability, pristni argumenti
   - če je popust >25%: low probability, rabi močne argumente ali čakaj na cenovni padec

4. Scenariji (3 možni izidi z verjetnostmi)

5. Opozorila (kdaj ne ponuditi)

Odgovori LE z JSON:
{
  "success_probability_pct": <number 0-100>,
  "confidence": <number 0-100>,
  "expected_counter_offer_eur": <number>,
  "suggested_optimal_offer_eur": <number>,
  "factors": [
    {
      "factor": "<faktor, npr. 'Cena pod tržno'>",
      "impact": "<positive|negative|neutral>",
      "weight": <number 1-10>,
      "explanation": "<max 80 znakov>"
    }
  ],
  "scenarios": [
    {
      "name": "<ime scenarija>",
      "probability_pct": <number>,
      "outcome": "<opis izida, max 100 znakov>",
      "final_price_eur": <number>
    }
  ],
  "warnings": ["<opozorilo, max 100 znakov>", "..."],
  "optimal_strategy": {
    "approach": "<direct_offer|build_rapport|wait_for_drop|bundle_offer|walk_away>",
    "timing": "<kdaj ponuditi, max 80 znakov>",
    "message_tips": ["<nasvet za sporočilo, max 100 znakov>", "..."]
  },
  "reasoning": "<celotna razlaga, max 300 znakov>"
}`;
}

function transformPrediction(parsed: any, userOfferFinal: number, listPrice: number): {
  successProbabilityPct: number;
  confidence: number;
  expectedCounterOfferEur: number;
  suggestedOptimalOfferEur: number;
  factors: Array<{ factor: string; impact: string; weight: number; explanation: string }>;
  scenarios: Array<{ name: string; probabilityPct: number; outcome: string; finalPriceEur: number }>;
  warnings: string[];
  optimalStrategy: {
    approach: string;
    timing: string;
    messageTips: string[];
  };
  reasoning: string;
} {
  return {
    successProbabilityPct: Math.max(0, Math.min(100, Number(parsed?.success_probability_pct ?? 50))),
    confidence: Math.max(0, Math.min(100, Number(parsed?.confidence ?? 50))),
    expectedCounterOfferEur: Math.max(0, Number(parsed?.expected_counter_offer_eur ?? Math.round((userOfferFinal + listPrice) / 2))),
    suggestedOptimalOfferEur: Math.max(0, Number(parsed?.suggested_optimal_offer_eur ?? userOfferFinal)),
    factors: (parsed?.factors || []).slice(0, 8).map((f: any) => ({
      factor: String(f?.factor ?? '').slice(0, 100),
      impact: ['positive', 'negative', 'neutral'].includes(String(f?.impact)) ? String(f.impact) : 'neutral',
      weight: Math.max(1, Math.min(10, Number(f?.weight ?? 5))),
      explanation: String(f?.explanation ?? '').slice(0, 150),
    })),
    scenarios: (parsed?.scenarios || []).slice(0, 4).map((s: any) => ({
      name: String(s?.name ?? '').slice(0, 80),
      probabilityPct: Math.max(0, Math.min(100, Number(s?.probability_pct ?? 0))),
      outcome: String(s?.outcome ?? '').slice(0, 200),
      finalPriceEur: Math.max(0, Number(s?.final_price_eur ?? 0)),
    })),
    warnings: (parsed?.warnings || []).slice(0, 5).map((w: any) => String(w).slice(0, 200)),
    optimalStrategy: {
      approach: ['direct_offer', 'build_rapport', 'wait_for_drop', 'bundle_offer', 'walk_away'].includes(String(parsed?.optimal_strategy?.approach))
        ? String(parsed.optimal_strategy.approach) : 'direct_offer',
      timing: String(parsed?.optimal_strategy?.timing ?? '').slice(0, 200),
      messageTips: Array.isArray(parsed?.optimal_strategy?.message_tips)
        ? parsed.optimal_strategy.message_tips.slice(0, 5).map((t: any) => String(t).slice(0, 200))
        : [],
    },
    reasoning: String(parsed?.reasoning ?? '').slice(0, 500),
  };
}
