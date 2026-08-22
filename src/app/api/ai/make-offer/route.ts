// v7.35 / v8.94-refactor: AI Make Offer Generator — 1-click optimizirano sporočilo prodajalcu.
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
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

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface MakeOfferInput {
  listingId: string;
  tone: string;
  offerPrice: number | null;
}

export const POST = withAiRoute<MakeOfferInput>({
  endpoint: '/api/ai/make-offer',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      listingId: String(body?.listingId ?? ''),
      tone: String(body?.tone ?? 'friendly'),
      offerPrice: body?.offerPrice ? Number(body.offerPrice) : null,
    };
  },

  validateInput: (input) => (input.listingId ? null : 'listingId je obvezen'),

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { listingId, tone, offerPrice } = input;

    const listing = await db.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true, title: true, price: true, priceText: true, url: true,
        description: true, aiVerdict: true, aiScore: true, aiRisk: true,
        aiEstimatedValue: true, location: true, sellerName: true,
        monitor: { select: { source: true, name: true } },
      },
    });

    if (!listing) throw new ApiRouteError('Listing ne obstaja', 404);

    if (!listing.price || listing.price <= 0) {
      throw new ApiRouteError('Oglas nima cene — ne morem generirati ponudbe.', 400);
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

    const prompt = buildPrompt({
      title: listing.title,
      askingPrice,
      aiValue,
      aiVerdict: listing.aiVerdict || 'neznan',
      aiRisk: listing.aiRisk ?? '?',
      location: listing.location || 'neznan',
      source,
      sellerName: listing.sellerName || 'neznan',
      suggestedPrice,
      tone,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const result = transformOffer(parsed, {
      suggestedPrice,
      askingPrice,
      openSellerUrl,
      source,
      tone,
    });

    // Update listing contactStatus to 'contacted'
    await db.listing.update({
      where: { id: listing.id },
      data: { contactStatus: 'contacted', contactedAt: new Date() },
    }).catch(() => {});

    return apiOk(result);
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

const TONE_MAP: Record<string, string> = {
  friendly: 'prijateljski, vljuden, a odločen',
  direct: 'direkten, kratek, posloven',
  expert: 'ekspert — pokaži znanje o artiklu, vplivaj s strokovnostjo',
};

interface PromptData {
  title: string;
  askingPrice: number;
  aiValue: number;
  aiVerdict: string;
  aiRisk: number | string;
  location: string;
  source: string;
  sellerName: string;
  suggestedPrice: number;
  tone: string;
}

function buildPrompt(d: PromptData): string {
  const discountPct = Math.round(((d.askingPrice - d.suggestedPrice) / d.askingPrice) * 100);
  return `Si ekspert za pogajanje pri nakupu rabljenih dobrin na slovenskih oglasnih platformah.

Generiraj sporočilo prodajalcu za ta oglas:

NASLOV: ${d.title}
CENA (asking): ${d.askingPrice}€
AI OCENA VREDNOSTI: ${d.aiValue}€
AI VERDICT: ${d.aiVerdict}
AI RISK: ${d.aiRisk}/10
LOKACIJA: ${d.location}
VIR: ${d.source}
PRODAJALEC: ${d.sellerName}

PONUJENA CENA: ${d.suggestedPrice}€ (${discountPct}% pod asking price)

TON: ${TONE_MAP[d.tone] || TONE_MAP.friendly}

PRAVILA:
1. Slovenski jezik, naravno in neposredno (ne "spoštovani" — preveč formalno za Bolha)
2. Začni z osebnim vtisom o artiklu (pokaži da si resen kupec, ne time-waster)
3. Omeni 1-2 pozitivni vidik artikla (iz opisa ali naslova)
4. Predlagaj ceno ${d.suggestedPrice}€ z utemeljitvijo (razumen argument, ne agresivno)
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
}

interface OfferContext {
  suggestedPrice: number;
  askingPrice: number;
  openSellerUrl: string;
  source: string;
  tone: string;
}

function transformOffer(parsed: any, ctx: OfferContext) {
  const { suggestedPrice, askingPrice, openSellerUrl, source, tone } = ctx;
  return {
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
}
