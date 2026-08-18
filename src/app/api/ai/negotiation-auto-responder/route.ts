// v7.42 / v8.94.5-j-refactor: Negotiation Auto-Responder — AI predlaga counter-offer ko prodajalec odgovori.
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
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

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface NegotiationAutoResponderInput {
  listingId: string;
  sellerResponse: string;
  yourOffer: number | null;
}

export const POST = withAiRoute<NegotiationAutoResponderInput>({
  endpoint: '/api/ai/negotiation-auto-responder',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      listingId: body?.listingId ? String(body.listingId) : '',
      sellerResponse: body?.sellerResponse ? String(body.sellerResponse) : '',
      yourOffer: body?.yourOffer != null ? Number(body.yourOffer) : null,
    };
  },

  validateInput: (input) => {
    if (!input.listingId || !input.sellerResponse) {
      return 'listingId in sellerResponse sta obvezna';
    }
    return null;
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { listingId, sellerResponse, yourOffer } = input;

    const listing = await db.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true, title: true, price: true, priceText: true,
        aiEstimatedValue: true, aiVerdict: true, aiRisk: true,
        description: true, sellerName: true,
        negotiationMessages: { orderBy: { createdAt: 'asc' }, take: 10, select: { direction: true, text: true, suggestedPrice: true, createdAt: true } },
      },
    });

    if (!listing) {
      throw new ApiRouteError('Listing ne obstaja', 404);
    }

    const askingPrice = listing.price ?? 0;
    const estValue = listing.aiEstimatedValue ?? askingPrice;
    const offer = yourOffer ? Number(yourOffer) : Math.round(askingPrice * 0.85);

    // Build prompt (besedilo IDENTIČNO originalu v7.42)
    const prompt = buildPrompt(listing, askingPrice, estValue, offer, sellerResponse);

    // AI klic (helper interno upravlja fallback + retry)
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    // Save the seller's response as negotiation message (ne fail-a responsa)
    await db.negotiationMessage.create({
      data: {
        listingId: listing.id,
        direction: 'received',
        text: String(sellerResponse).slice(0, 1000),
        status: 'counter_received',
      },
    }).catch(() => {});

    const recommendation = transformRecommendation(parsed, estValue);

    return apiOk({
      ok: true,
      recommendation,
      counterMessage: String(parsed?.counter_message ?? '').slice(0, 500),
      copyToClipboard: String(parsed?.counter_message ?? '').slice(0, 500),
      listingUrl: listing.id,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

/**
 * Zgradi AI prompt za negotiation auto-responder.
 * Besedilo IDENTIČNO originalu (v7.42).
 */
function buildPrompt(
  listing: {
    title: string;
    aiRisk: number | null;
    negotiationMessages: Array<{
      direction: string;
      text: string;
      suggestedPrice: number | null;
    }>;
  },
  askingPrice: number,
  estValue: number,
  offer: number,
  sellerResponse: string
): string {
  const conversation = listing.negotiationMessages.map(m => {
    const prefix = m.direction === 'sent' ? 'TI' : 'PRODAJALEC';
    const price = m.suggestedPrice ? ` (ponudba: ${m.suggestedPrice}€)` : '';
    return `${prefix}: ${m.text}${price}`;
  }).join('\n');

  return `Si ekspert za pogajanje pri nakupu rabljenih dobrin na slovenskih oglasnih platformah.

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
}

/**
 * Transformiraj AI JSON odgovor v tipiziran recommendation objekt.
 * Validira + clamp-a vse numerične vrednosti; uporablja privzete ko AI manjka.
 */
function transformRecommendation(parsed: any, estValue: number) {
  const action = ['accept', 'counter', 'walk_away'].includes(String(parsed?.action)) ? String(parsed.action) : 'counter';
  const maxAcceptable = Math.max(1, Math.min(Number(parsed?.max_acceptable_price ?? estValue * 0.9), estValue));
  return {
    action,
    analysis: String(parsed?.analysis ?? '').slice(0, 300),
    tone: String(parsed?.tone ?? 'nevtralen'),
    mentionedPrice: parsed?.mentioned_price ? Number(parsed.mentioned_price) : null,
    counterPrice: parsed?.counter_price ? Number(parsed.counter_price) : null,
    maxAcceptablePrice: Math.round(maxAcceptable),
    reasoning: String(parsed?.reasoning ?? '').slice(0, 200),
  };
}
