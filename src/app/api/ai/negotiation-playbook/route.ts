// v6.11 / v8.96.0-batch2: AI Vendor Negotiation Playbook — AI pripravi celovit pogajalski scenarij
// Refaktoriran z withAiRoute helperjem (v8.96.0-batch2) + enforceBudget guard.
//
// POST /api/ai/negotiation-playbook
// Body: { listingId?: string, listing?: { title, price, location, description, source }, maxBudget?: number }
// Returns: { ok, playbook: { strategy, openingOffer, walkAwayPrice, targetPrice, arguments, counterOffers, psychologyTactics, redFlags, bestTiming, messageTemplates } }

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
}

interface NegotiationPlaybookInput {
  listingId: string;
  listing: ListingInput | null;
  maxBudget: number | null;
}

export const POST = withAiRoute<NegotiationPlaybookInput>({
  endpoint: '/api/ai/negotiation-playbook',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const maxBudgetRaw = body?.maxBudget;
    return {
      listingId: body?.listingId ? String(body.listingId) : '',
      listing: body?.listing ?? null,
      maxBudget: maxBudgetRaw === undefined || maxBudgetRaw === null ? null : Math.max(0, Number(maxBudgetRaw) || 0),
    };
  },

  // validateInput handled inside handler — listing lookup needs DB access
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { listingId, maxBudget } = input;
    let listingInput: ListingInput | null = input.listing;

    // 1. Če je podan listingId, pridobi iz baze
    if (listingId && !listingInput) {
      const listing = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: {
          title: true, price: true, priceText: true, location: true, description: true,
          detailDescription: true, url: true, aiEstimatedValue: true, aiRisk: true,
          aiVerdict: true, aiReason: true, dealScore: true, dealScoreReason: true,
          sellerName: true, sellerListingCount: true, postedAt: true, previousPrice: true,
          priceDroppedAt: true, monitor: { select: { source: true, name: true } },
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
      };
    }

    if (!listingInput) {
      return apiBadRequest('listingId ali listing objekt je obvezen');
    }

    // 2. Pridobi kontekst — podobni oglasi na trgu
    const listingPrice = Number(listingInput.price) || 0;
    const { marketContext } = await fetchMarketContext(db, listingPrice);

    // 3. AI pogajalski playbook
    const prompt = buildPrompt({
      title: listingInput.title,
      priceText: listingInput.priceText,
      price: listingPrice,
      location: listingInput.location,
      source: listingInput.source,
      description: listingInput.description,
      marketContext,
      maxBudget,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const playbook = transformPlaybook(parsed, listingPrice);

    return apiOk({
      ok: true,
      playbook,
      listing: listingInput,
      marketContext,
      maxBudget: maxBudget ?? null,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

async function fetchMarketContext(
  db: AiRouteContext['db'],
  listingPrice: number
): Promise<{ marketContext: string }> {
  let marketContext = '';
  if (listingPrice > 0) {
    const similar = await db.listing.findMany({
      where: {
        price: { gte: Math.floor(listingPrice * 0.6), lte: Math.ceil(listingPrice * 1.5) },
        isHidden: false,
      },
      select: { price: true, title: true, firstSeenAt: true, location: true,
        monitor: { select: { source: true } } },
      take: 20,
    });
    const prices = similar.map(l => l.price!).filter(Boolean);
    if (prices.length > 0) {
      const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      marketContext = `Tržno povprečje podobnih oglasov: ${avg}€ (min ${min}€, max ${max}€, ${prices.length} oglasov)`;
    }
  }
  return { marketContext };
}

interface PromptData {
  title: string;
  priceText?: string;
  price: number;
  location?: string;
  source?: string;
  description?: string;
  marketContext: string;
  maxBudget: number | null;
}

function buildPrompt(d: PromptData): string {
  const sellerHistory = '';
  return `Si ekspert za pogajanje pri nakupu rabljenih dobrin na slovenskem trgu (Bolha, Nepremičnine, Avtonet, Vinted).
Pripravi celovit pogajalski playbook za naslednji oglas:

NASLOV: ${d.title}
CENA: ${d.priceText || (d.price + ' EUR')}
LOKACIJA: ${d.location || 'neznan'}
VIR: ${d.source || 'neznan'}
OPIS: ${(d.description || '').slice(0, 800)}
${d.marketContext ? `\n${d.marketContext}` : ''}
${sellerHistory ? `\n${sellerHistory}` : ''}
${d.maxBudget ? `\nMoj maksimalni budget: ${d.maxBudget}€` : ''}

Pravila:
1. Realno oceni tržno vrednost in poda openingOffer (prva ponudba, običajno 70-80% cene)
2. Določi targetPrice (realna ciljna cena, ~85-90% tržne vrednosti)
3. Določi walkAwayPrice (meja, nad katero ne greš)
4. Pripravi 3-5 argumentov za pogajanje (specificno vezanih na oglas)
5. Pripravi 3 counter-offers za različne odgovore prodajalca
6. Identificiraj psihološke taktike (nujnost, empatija, alternativne ponudbe)
7. Opozori na red flags (sumljivi znaki v oglasu)
8. Predlagaj najboljši čas za kontakt (urov v dnevu, dan v tednu)
9. Pripravi 3 predloge sporočil v slovenščini (initial, follow-up, final)

Strategije pogajanja:
- "soft": prijazno, iskreno zanimanje, blaga pogajanja
- "firm": direktne ponudbe, jasni argumenti
- "creative": alternativne ponudbe (trade-in, hitra plačila, prevzem)
- "patient": čakaj na cenovni padec, kontaktiraj pozno

Odgovori LE z JSON:
{
  "strategy": "<soft|firm|creative|patient>",
  "strategyReasoning": "<zakaj ta strategija, max 150 znakov>",
  "openingOffer": <number>,
  "targetPrice": <number>,
  "walkAwayPrice": <number>,
  "estimatedMarketValue": <number>,
  "arguments": ["<specifičen argument, max 100 znakov>", "..."],
  "counterOffers": [
    { "trigger": "<kaj prodajalec reče>", "response": "<protiponudba>", "price": <number> }
  ],
  "psychologyTactics": ["<taktika, max 80 znakov>", "..."],
  "redFlags": ["<sumljiv znak, max 80 znakov>", "..."],
  "bestTiming": "<kdatum/uro/dan za kontakt, max 100 znakov>",
  "messageTemplates": [
    { "type": "initial", "text": "<prvo sporočilo, max 400 znakov>" },
    { "type": "follow_up", "text": "<follow-up po 24h, max 300 znakov>" },
    { "type": "final", "text": "<končna ponudba, max 300 znakov>" }
  ]
}`;
}

function transformPlaybook(parsed: any, listingPrice: number) {
  return {
    strategy: String(parsed?.strategy ?? 'firm').slice(0, 30),
    strategyReasoning: String(parsed?.strategyReasoning ?? '').slice(0, 250),
    openingOffer: Number(parsed?.openingOffer ?? Math.round(listingPrice * 0.75)) || 0,
    targetPrice: Number(parsed?.targetPrice ?? Math.round(listingPrice * 0.85)) || 0,
    walkAwayPrice: Number(parsed?.walkAwayPrice ?? Math.round(listingPrice * 0.95)) || 0,
    estimatedMarketValue: Number(parsed?.estimatedMarketValue ?? listingPrice) || 0,
    arguments: Array.isArray(parsed?.arguments)
      ? parsed.arguments.slice(0, 8).map((a: any) => String(a).slice(0, 200))
      : [],
    counterOffers: Array.isArray(parsed?.counterOffers)
      ? parsed.counterOffers.slice(0, 5).map((c: any) => ({
          trigger: String(c?.trigger ?? '').slice(0, 150),
          response: String(c?.response ?? '').slice(0, 300),
          price: Number(c?.price ?? 0) || 0,
        }))
      : [],
    psychologyTactics: Array.isArray(parsed?.psychologyTactics)
      ? parsed.psychologyTactics.slice(0, 6).map((t: any) => String(t).slice(0, 150))
      : [],
    redFlags: Array.isArray(parsed?.redFlags)
      ? parsed.redFlags.slice(0, 6).map((r: any) => String(r).slice(0, 150))
      : [],
    bestTiming: String(parsed?.bestTiming ?? '').slice(0, 200),
    messageTemplates: Array.isArray(parsed?.messageTemplates)
      ? parsed.messageTemplates.slice(0, 4).map((m: any) => ({
          type: String(m?.type ?? 'initial').slice(0, 30),
          text: String(m?.text ?? '').slice(0, 600),
        }))
      : [],
  };
}
