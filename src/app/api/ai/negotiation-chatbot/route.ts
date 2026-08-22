// v6.20 / v8.94-refactor: Smart Negotiation Chatbot — več-turn pogovor z avtomatskim odgovarjanjem
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/negotiation-chatbot
// Body: { listingId?: string, messages: [{ role: 'user'|'seller', text }], myGoal?: { maxPrice, mustInclude }, strategy?: 'aggressive'|'firm'|'patient' }
// Returns: { ok, reply: { text, suggestedPriceEur, tone, nextStep, confidencePct, alternatives, conversationState, warning }, messageCount, strategy }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

type Strategy = 'aggressive' | 'firm' | 'patient';

interface ChatMessage {
  role: 'user' | 'seller';
  text: string;
}

interface NegotiationChatbotInput {
  listingId?: string;
  messages: ChatMessage[];
  myGoal: { maxPrice?: number; mustInclude?: string[] };
  strategy: Strategy;
}

export const POST = withAiRoute<NegotiationChatbotInput>({
  endpoint: '/api/ai/negotiation-chatbot',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const messages: ChatMessage[] = Array.isArray(body?.messages) ? body.messages : [];
    const myGoal: { maxPrice?: number; mustInclude?: string[] } = body?.myGoal ?? {};
    const strategy: Strategy = ['aggressive', 'firm', 'patient'].includes(String(body?.strategy))
      ? (String(body.strategy) as Strategy) : 'firm';
    return {
      listingId: body?.listingId ? String(body.listingId) : undefined,
      messages,
      myGoal,
      strategy,
    };
  },

  validateInput: (input) => {
    if (input.messages.length === 0) {
      return 'messages array ne sme biti prazen';
    }
    return null;
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { listingId, messages, myGoal, strategy } = input;

    // 1. Listing context (če je listingId podan)
    const listingContext = listingId
      ? await buildListingContext(listingId, db)
      : '';

    // 2. Build prompt
    const prompt = buildPrompt(listingContext, strategy, myGoal, messages);

    // 3. AI klic (helper internally upravlja fallback + retry)
    const raw = await callAi(prompt);

    // 4. Parse + transform
    const parsed: any = parseAi(raw);
    const reply = transformReply(parsed, strategy);

    return apiOk({
      ok: true,
      reply,
      messageCount: messages.length,
      strategy,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

/**
 * Pridobi listing iz DB in zgradi kontekstni niz za AI prompt.
 * Vrne '' če listing ne obstaja ali listingId ni podan.
 */
async function buildListingContext(
  listingId: string,
  db: AiRouteContext['db']
): Promise<string> {
  const listing = await db.listing.findUnique({
    where: { id: listingId },
    select: {
      title: true, price: true, priceText: true, location: true,
      description: true, detailDescription: true, aiEstimatedValue: true,
      aiRisk: true, aiVerdict: true, postedAt: true, sellerName: true,
      previousPrice: true, priceDroppedAt: true,
    },
  });
  if (!listing) return '';

  const daysPosted = listing.postedAt
    ? Math.round((Date.now() - listing.postedAt.getTime()) / (24 * 60 * 60 * 1000))
    : 0;

  return `OGLAS: ${listing.title}
Cena: ${listing.priceText || (listing.price + ' EUR')}
Lokacija: ${listing.location}
AI est. vrednost: ${listing.aiEstimatedValue ?? 'neznan'}€
Starost oglasa: ${daysPosted} dni
${listing.previousPrice ? `Prejšnja cena: ${listing.previousPrice}€ (padla!)` : ''}
Opis: ${(listing.detailDescription || listing.description || '').slice(0, 400)}`;
}

/**
 * Zgradi AI prompt za naslednji pogajalski odgovor.
 * Besedilo IDENTIČNO originalu (v6.20).
 */
function buildPrompt(
  listingContext: string,
  strategy: Strategy,
  myGoal: { maxPrice?: number; mustInclude?: string[] },
  messages: ChatMessage[]
): string {
  const messagesStr = messages.map((m, i) => {
    const speaker = m.role === 'user' ? 'JAZ (kupec)' : 'PRODAJALEC';
    return `[#${i + 1}] ${speaker}: ${m.text}`;
  }).join('\n');

  const goalStr = myGoal.maxPrice
    ? `Moja max cena: ${myGoal.maxPrice}€`
    : 'Cilj cena: ni specifična — minimiziraj';
  const mustIncludeStr = myGoal.mustInclude?.length
    ? `Pogoji: ${myGoal.mustInclude.join(', ')}`
    : '';

  return `Si AI pogajalski asistent, ki mi pomaga pri nakupu rabljene dobrine.
Na podlagi dosedanjega pogovora in konteksta oglasa generiraj moj naslednji odgovor prodajalcu.

${listingContext ? listingContext + '\n\n' : ''}MOJA STRATEGIJA: ${strategy}
${goalStr}
${mustIncludeStr}

DOSLEDENJI POGOVOR:
${messagesStr}

Pravila za odgovor:
1. Besedilo naj bo v slovenščini, naravno in osebno (ne robotsko)
2. Ohranjaj ${strategy} ton:
   - aggressive: 15-25% pod tržno, firm maš prednosti
   - firm: 10-15% pod tržno, argumenti
   - patient: sprašuj več, čakaj na padec
3. Sklicuj se na prejšnje prodajalčeve izjave
4. Postavi vprašanje ali naredi konkretno ponudbo
5. Če prodajalec preveč pritiska, omeni alternative ( konkurenčni oglasi)
6. Nikoli ne razkrij mojega max budgeta
7. Ohrani odgovor 50-150 besed (kratek in jedrnat)

Odgovori LE z JSON:
{
  "text": "<moj odgovor prodajalcu, 50-150 besed v slovenščini>",
  "suggested_price_eur": <number | null>,
  "tone": "<aggressive|firm|friendly|patient|questioning>",
  "next_step": "<kaj storiti če prodajalec odgovori, max 100 znakov>",
  "confidence_pct": <number 0-100>,
  "alternatives": ["<alternativni odgovor, max 100 znakov>", "..."],
  "conversation_state": "<opening|discovery|offer|counter|closing|stuck>",
  "warning": "<opozorilo če nekaj gre narobe, max 100 znakov | null>"
}`;
}

/**
 * Transformiraj AI JSON odgovor v tipiziran reply objekt.
 * Validira in clamp-a vse numerične vrednosti; uporablja privzete
 * vrednosti ko AI manjka polja.
 */
function transformReply(parsed: any, strategy: Strategy) {
  return {
    text: String(parsed?.text ?? '').slice(0, 1500),
    suggestedPriceEur: parsed?.suggested_price_eur != null
      ? Math.max(0, Number(parsed.suggested_price_eur)) : null,
    tone: ['aggressive', 'firm', 'friendly', 'patient', 'questioning'].includes(String(parsed?.tone))
      ? String(parsed.tone) : strategy,
    nextStep: String(parsed?.next_step ?? '').slice(0, 200),
    confidencePct: Math.max(0, Math.min(100, Number(parsed?.confidence_pct ?? 60))),
    alternatives: (parsed?.alternatives || []).slice(0, 3).map((a: any) => String(a).slice(0, 200)),
    conversationState: ['opening', 'discovery', 'offer', 'counter', 'closing', 'stuck'].includes(String(parsed?.conversation_state))
      ? String(parsed.conversation_state) : 'opening',
    warning: parsed?.warning && parsed.warning !== 'null'
      ? String(parsed.warning).slice(0, 200) : null,
  };
}
