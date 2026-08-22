// v7.61 / v8.96.3-batch4: AI Negotiation Script Generator — za specifičen listing/trade
// generira CEL estrategia dokument za pogajanje kot KUPEC. Razlika od
// realtime-negotiation-bot (ki je chatbot) — ta vrne strukturiran STRATEGY
// DOKUMENT z opening line, anchoring offer, offer ladder (3-5 korakov),
// walkaway price, target price, psychological tactics, objection handlers
// in closing line.
//
// "PS5 350€ → anchoring 280€, target 320€, walkaway 340€. Taktika: 'imam cash zdaj'"
//
// GET+POST /api/ai/negotiation-script-generator
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.3) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface NegotiationScriptInput {
  listingId: string | null;
  tradeId: string | null;
}

// --- Types ---------------------------------------------------------------

type NegotiationStyle = 'AGGRESSIVE' | 'BALANCED' | 'FRIENDLY';

interface OfferLadderStep {
  step: number;
  offer: number;
  reasoning: string;
}

interface PsychologicalTactic {
  tactic: string;
  application: string;
}

interface ObjectionHandler {
  objection: string;
  response: string;
}

interface NegotiationScript {
  openingLine: string;
  anchoringOffer: number;
  offerLadder: OfferLadderStep[];
  walkawayPrice: number;
  targetPrice: number;
  psychologicalTactics: PsychologicalTactic[];
  objectionHandlers: ObjectionHandler[];
  closingLine: string;
  negotiationStyle: NegotiationStyle;
}

interface NegotiationContext {
  listingId: string;
  title: string;
  askingPrice: number;
  aiEstimatedValue: number;
  dealScore: number;
  sellerName: string | null;
  category: string;
  daysListed: number;
}

// AI response shape (loose)
interface AiScriptResponse {
  openingLine?: unknown;
  anchoringOffer?: unknown;
  offerLadder?: unknown;
  walkawayPrice?: unknown;
  targetPrice?: unknown;
  psychologicalTactics?: unknown;
  objectionHandlers?: unknown;
  closingLine?: unknown;
  negotiationStyle?: unknown;
}

// --- Helpers -------------------------------------------------------------

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

function pickStyle(item: NegotiationContext): NegotiationStyle {
  // Aggressive: high dealScore, AI verdict PRILIKA (dealScore >= 70) — go hard
  // Friendly: low dealScore or small ticket — be gentle
  // Balanced: everything else
  if (item.dealScore >= 75 && item.askingPrice > 200) return 'AGGRESSIVE';
  if (item.askingPrice < 100 || item.dealScore < 40) return 'FRIENDLY';
  return 'BALANCED';
}

// Anti-hallucination: anchoringOffer clamped to [0.5×, 0.85×] askingPrice
function clampAnchoring(raw: unknown, askingPrice: number): number {
  const min = Math.round(askingPrice * 0.5);
  const max = Math.round(askingPrice * 0.85);
  const fallback = Math.round(askingPrice * 0.75);
  if (raw == null) return Math.max(min, Math.min(max, fallback));
  let v = Number(raw);
  if (!Number.isFinite(v)) v = fallback;
  v = Math.round(v);
  return Math.max(min, Math.min(max, v));
}

// Anti-hallucination: walkawayPrice clamped to [estValue × 0.8, estValue × 1.1]
function clampWalkaway(raw: unknown, estValue: number): number {
  const min = Math.round(estValue * 0.8);
  const max = Math.round(estValue * 1.1);
  const fallback = Math.round(estValue * 1.05);
  if (raw == null) return Math.max(min, Math.min(max, fallback));
  let v = Number(raw);
  if (!Number.isFinite(v)) v = fallback;
  v = Math.round(v);
  return Math.max(min, Math.min(max, v));
}

function clampTarget(raw: unknown, estValue: number): number {
  const min = Math.round(estValue * 0.7);
  const max = Math.round(estValue * 1.05);
  const fallback = Math.round(estValue * 0.9);
  if (raw == null) return Math.max(min, Math.min(max, fallback));
  let v = Number(raw);
  if (!Number.isFinite(v)) v = fallback;
  v = Math.round(v);
  return Math.max(min, Math.min(max, v));
}

function clampStyle(raw: unknown, fallback: NegotiationStyle): NegotiationStyle {
  const s = String(raw).toUpperCase().trim();
  if (s === 'AGGRESSIVE' || s === 'BALANCED' || s === 'FRIENDLY') return s;
  return fallback;
}

function validateTactics(raw: unknown): PsychologicalTactic[] {
  if (!Array.isArray(raw)) return [];
  const out: PsychologicalTactic[] = [];
  for (const t of raw) {
    if (t && typeof t === 'object') {
      const obj = t as Record<string, unknown>;
      const tactic = clampString(obj.tactic, 80, 'Rapport');
      const application = clampString(obj.application, 220, 'Vzpostavi odnos pred pogajanjem.');
      if (tactic.length > 0 && application.length > 0) {
        out.push({ tactic, application });
      }
    }
    if (out.length >= 3) break;
  }
  return out;
}

function validateObjections(raw: unknown): ObjectionHandler[] {
  if (!Array.isArray(raw)) return [];
  const out: ObjectionHandler[] = [];
  for (const t of raw) {
    if (t && typeof t === 'object') {
      const obj = t as Record<string, unknown>;
      const objection = clampString(obj.objection, 140, 'Cena je končna.');
      const response = clampString(obj.response, 280, 'Razumem — ponudim X€ in takojšen prevzem.');
      if (objection.length > 0 && response.length > 0) {
        out.push({ objection, response });
      }
    }
    if (out.length >= 5) break;
  }
  return out;
}

function validateOfferLadder(
  raw: unknown,
  anchoring: number,
  target: number,
  askingPrice: number,
): OfferLadderStep[] {
  if (!Array.isArray(raw)) return [];
  const out: OfferLadderStep[] = [];
  for (const t of raw) {
    if (t && typeof t === 'object') {
      const obj = t as Record<string, unknown>;
      const stepRaw = Number(obj.step);
      const step = Number.isFinite(stepRaw) ? Math.max(1, Math.min(10, Math.round(stepRaw))) : out.length + 1;
      const offerRaw = Number(obj.offer);
      // Offer must be within [anchoring, askingPrice] — sanity
      const offer = Number.isFinite(offerRaw)
        ? Math.max(anchoring, Math.min(askingPrice, Math.round(offerRaw)))
        : Math.round((anchoring + target) / 2);
      const reasoning = clampString(obj.reasoning, 220, `Ponudba ${offer}€ — kompromis med mojim in tvojim položajem.`);
      out.push({ step, offer, reasoning });
    }
    if (out.length >= 5) break;
  }
  return out;
}

// Deterministic fallback script — used when AI is unavailable
function deterministicScript(ctx: NegotiationContext): NegotiationScript {
  const anchoring = Math.round(ctx.askingPrice * 0.75);
  const target = Math.round(ctx.aiEstimatedValue * 0.9);
  const walkaway = Math.round(ctx.aiEstimatedValue * 1.05);
  const style = pickStyle(ctx);

  // Build a 3-step ladder between anchoring and target
  const ladder: OfferLadderStep[] = [];
  for (let i = 0; i < 3; i++) {
    const offer = Math.round(anchoring + ((target - anchoring) * (i + 1)) / 4);
    const reasoning =
      i === 0
        ? `Začetna resna ponudba — ${offer}€, blizu ${Math.round(ctx.askingPrice * 0.75)}€ (anchoring).`
        : i === 1
          ? `Srednja ponudba — ${offer}€, približanje target ${target}€.`
          : `Končna ponudba — ${offer}€, blizu target ${target}€ (zadnji korak pred odhodom).`;
    ladder.push({ step: i + 1, offer, reasoning });
  }

  const openingLine = `Pozdravljeni! Vidim ${ctx.title.slice(0, 50)} za ${ctx.askingPrice}€. Zanima me, ali bi šla cena nekoliko dol — pripravljen sem na takojšen prevzem in plačilo z gotovino.`;

  const closingLine = `Odlično, dogovorjeno! Prihajam prevzet v naslednjih 24h, plačilo gotovina. Hvala za pošteno pogajanje!`;

  const sellerRef = ctx.sellerName ? ` ${ctx.sellerName}` : '';

  return {
    openingLine,
    anchoringOffer: anchoring,
    offerLadder: ladder,
    walkawayPrice: walkaway,
    targetPrice: target,
    psychologicalTactics: [
      {
        tactic: 'Cash & urgency',
        application: `Poudari takojšnje plačilo z gotovino in prevzem v 24h — sprosti prodajalca${sellerRef} iz čakanja kupca.`,
      },
      {
        tactic: 'Anchoring',
        application: `Prva ponudba ${anchoring}€ (~75% cene) postavi nizko izhodišče za pogajanje.`,
      },
      {
        tactic: 'Walkaway leverage',
        application: `Če prodajalec${sellerRef} ne sprejme ${walkaway}€, mirno odidiš — pokažeš da imaš alternative.`,
      },
    ],
    objectionHandlers: [
      {
        objection: `'Cena je končna, ne spuščam.'`,
        response: `Razumem, ampak ${ctx.askingPrice}€ je nad tržno vrednostjo (AI estValue ${ctx.aiEstimatedValue}€). Lahko ponudim ${target}€ z gotovino danes.`,
      },
      {
        objection: `'Imam drugo zainteresirano osebo.'`,
        response: `V tem primeru bom pa ${target}€ z gotovino v 24h — kdor drug se pogaja, bo verjetno ponudil manj ali pa ratal plačilo.`,
      },
      {
        objection: `'Preveč nizko.'`,
        response: `Našel sem podobne oglase za ~${ctx.aiEstimatedValue}€. ${target}€ je realen kompromis — pripravljen takoj prevzeti.`,
      },
    ],
    closingLine,
    negotiationStyle: style,
  };
}

// Validate the AI script — clamp all numeric fields, validate enums
function validateAiScript(
  raw: AiScriptResponse | null,
  ctx: NegotiationContext,
): NegotiationScript {
  if (!raw) return deterministicScript(ctx);

  const anchoring = clampAnchoring(raw.anchoringOffer, ctx.askingPrice);
  const walkaway = clampWalkaway(raw.walkawayPrice, ctx.aiEstimatedValue);
  const target = clampTarget(raw.targetPrice, ctx.aiEstimatedValue);
  const style = clampStyle(raw.negotiationStyle, pickStyle(ctx));

  const fallback = deterministicScript(ctx);

  const offerLadder = validateOfferLadder(raw.offerLadder, anchoring, target, ctx.askingPrice);
  const tactics = validateTactics(raw.psychologicalTactics);
  const objections = validateObjections(raw.objectionHandlers);

  // Fill any missing arrays from fallback
  return {
    openingLine: clampString(raw.openingLine, 360, fallback.openingLine),
    anchoringOffer: anchoring,
    offerLadder: offerLadder.length > 0 ? offerLadder : fallback.offerLadder,
    walkawayPrice: walkaway,
    targetPrice: target,
    psychologicalTactics: tactics.length > 0 ? tactics : fallback.psychologicalTactics,
    objectionHandlers: objections.length > 0 ? objections : fallback.objectionHandlers,
    closingLine: clampString(raw.closingLine, 360, fallback.closingLine),
    negotiationStyle: style,
  };
}

// --- Context resolver (3-branch DB lookup) ------------------------------

const LISTING_SELECT_BASE = {
  id: true,
  title: true,
  price: true,
  aiEstimatedValue: true,
  aiScore: true,
  aiRisk: true,
  aiVerdict: true,
  dealScore: true,
  sellerName: true,
  firstSeenAt: true,
} as const;

async function resolveContextFromTrade(
  db: AiRouteContext['db'],
  tradeId: string,
): Promise<NegotiationContext | null> {
  const trade = await db.trade.findUnique({
    where: { id: tradeId },
    select: {
      id: true,
      title: true,
      category: true,
      buyPrice: true,
      listingId: true,
      listing: {
        select: LISTING_SELECT_BASE,
      },
    },
  });
  if (!trade) return null;

  const listing = trade.listing;
  const estValue =
    listing?.aiEstimatedValue && listing.aiEstimatedValue > 0
      ? listing.aiEstimatedValue
      : Math.round(trade.buyPrice * 1.2);
  const askingPrice = listing?.price && listing.price > 0 ? listing.price : Math.round(trade.buyPrice * 1.15);
  const daysListed = listing?.firstSeenAt
    ? Math.max(0, Math.round((Date.now() - listing.firstSeenAt.getTime()) / 86_400_000))
    : 0;
  return {
    listingId: listing?.id ?? `trade:${trade.id}`,
    title: trade.title,
    askingPrice,
    aiEstimatedValue: estValue,
    dealScore: listing?.dealScore ?? 0,
    sellerName: listing?.sellerName ?? null,
    category: (trade.category || 'drugo').trim().toLowerCase(),
    daysListed,
  };
}

async function resolveContextFromListing(
  db: AiRouteContext['db'],
  listingId: string,
): Promise<NegotiationContext | null> {
  const listing = await db.listing.findUnique({
    where: { id: listingId },
    select: LISTING_SELECT_BASE,
  });
  if (!listing) return null;

  const price = listing.price ?? 0;
  const estValue =
    listing.aiEstimatedValue && listing.aiEstimatedValue > 0
      ? listing.aiEstimatedValue
      : price > 0
        ? Math.round(price * 0.95)
        : 100;
  const daysListed = listing.firstSeenAt
    ? Math.max(0, Math.round((Date.now() - listing.firstSeenAt.getTime()) / 86_400_000))
    : 0;
  return {
    listingId: listing.id,
    title: listing.title,
    askingPrice: price,
    aiEstimatedValue: estValue,
    dealScore: listing.dealScore ?? 0,
    sellerName: listing.sellerName ?? null,
    category: 'drugo',
    daysListed,
  };
}

async function resolveContextFromPrilika(
  db: AiRouteContext['db'],
): Promise<NegotiationContext | null> {
  // Pick most recent PRILIKA listing (or most recent listing if none PRILIKA)
  let listing = await db.listing.findFirst({
    where: { aiVerdict: 'PRILIKA', price: { gt: 0 } },
    orderBy: { firstSeenAt: 'desc' },
    select: LISTING_SELECT_BASE,
  });
  if (!listing) {
    // Fallback: most recent listing with price > 0
    listing = await db.listing.findFirst({
      where: { price: { gt: 0 } },
      orderBy: { firstSeenAt: 'desc' },
      select: LISTING_SELECT_BASE,
    });
  }
  if (!listing) return null;

  const price = listing.price ?? 0;
  const estValue =
    listing.aiEstimatedValue && listing.aiEstimatedValue > 0
      ? listing.aiEstimatedValue
      : price > 0
        ? Math.round(price * 0.95)
        : 100;
  const daysListed = listing.firstSeenAt
    ? Math.max(0, Math.round((Date.now() - listing.firstSeenAt.getTime()) / 86_400_000))
    : 0;
  return {
    listingId: listing.id,
    title: listing.title,
    askingPrice: price,
    aiEstimatedValue: estValue,
    dealScore: listing.dealScore ?? 0,
    sellerName: listing.sellerName ?? null,
    category: 'drugo',
    daysListed,
  };
}

async function resolveNegotiationContext(
  db: AiRouteContext['db'],
  tradeId: string | null,
  listingId: string | null,
): Promise<NegotiationContext | null> {
  // Strategy:
  //   - If tradeId provided → look up that Trade (with linked Listing for context)
  //   - Else if listingId provided → look up that Listing
  //   - Else → pick most recent PRILIKA listing
  if (tradeId) {
    return await resolveContextFromTrade(db, tradeId);
  }
  if (listingId) {
    return await resolveContextFromListing(db, listingId);
  }
  return await resolveContextFromPrilika(db);
}

// --- Prompt builder (čisti helper) -------------------------------------

function buildPrompt(ctx: NegotiationContext): string {
  return `Si veteran pregajanja na slovenskih oglasnih platformah (Bolha, Vinted, mobile.de, Kleinanzeigen).
Generiraj CEL STRATEGIA DOKUMENT za pogajanje kot KUPEC za naslednji oglas.

KONTEKST:
- Naslov: ${ctx.title}
- Prošnja cena (askingPrice): ${ctx.askingPrice}€
- AI ocenjena tržna vrednost (aiEstimatedValue): ${ctx.aiEstimatedValue}€
- Deal Score (0-100): ${ctx.dealScore}
- Prodajalec: ${ctx.sellerName ?? 'neznan'}
- Kategorija: ${ctx.category}
- Dni na trgu: ${ctx.daysListed}

CILJ: doseči ceno blizu targetPrice (običajno estValue × 0.9) z minimalno ${ctx.daysListed > 14 ? '— prodajalec je že ' + ctx.daysListed + ' dni na trgu, motiviran za prodajo' : '— oglas je še svež'}.

PRAVILA:
1. openingLine: prijateljsko-strateško v slovenščini, ne predolg.
2. anchoringOffer: med ${Math.round(ctx.askingPrice * 0.5)}€ in ${Math.round(ctx.askingPrice * 0.85)}€ (običajno ~75% askingPrice).
3. offerLadder: 3-5 postopnih ponudb od anchoring do targetPrice, vsaka z reasoning.
4. walkawayPrice: max acceptable — med ${Math.round(ctx.aiEstimatedValue * 0.8)}€ in ${Math.round(ctx.aiEstimatedValue * 1.1)}€.
5. targetPrice: realističen cilj (običajno estValue × 0.9).
6. psychologicalTactics: 2-3 taktike (npr. cash/urgency, anchoring, walkaway leverage, rapport, scarcity).
7. objectionHandlers: 2-5 pričakovanih prodajalčevih ugovorov + odgovori v slovenščini.
8. closingLine: ko je dogovor dosežen.
9. negotiationStyle: AGGRESSIVE (visok dealScore, >200€) | BALANCED | FRIENDLY (<100€ ali nizek dealScore).

Odgovori LE z JSON:
{
  "openingLine": "<slovensko, max 360 znakov>",
  "anchoringOffer": <number EUR>,
  "offerLadder": [
    { "step": 1, "offer": <eur>, "reasoning": "<1 stavek>" },
    { "step": 2, "offer": <eur>, "reasoning": "<1 stavek>" },
    { "step": 3, "offer": <eur>, "reasoning": "<1 stavek>" }
  ],
  "walkawayPrice": <number EUR>,
  "targetPrice": <number EUR>,
  "psychologicalTactics": [
    { "tactic": "<ime>", "application": "<kako uporabiti>" }
  ],
  "objectionHandlers": [
    { "objection": "<ugovor>", "response": "<odgovor>" }
  ],
  "closingLine": "<slovensko>",
  "negotiationStyle": "AGGRESSIVE|BALANCED|FRIENDLY"
}${GROUNDING_PROMPT_SUFFIX}`;
}

// --- Handler -------------------------------------------------------------

const negotiationScriptHandler = withAiRoute<NegotiationScriptInput>({
  endpoint: '/api/ai/negotiation-script-generator',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    let requestedListingId: string | null = null;
    let requestedTradeId: string | null = null;
    if (body && typeof body === 'object') {
      if (typeof body.listingId === 'string' && body.listingId.trim()) {
        requestedListingId = body.listingId.trim();
      }
      if (typeof body.tradeId === 'string' && body.tradeId.trim()) {
        requestedTradeId = body.tradeId.trim();
      }
    }
    return { listingId: requestedListingId, tradeId: requestedTradeId };
  },

  // No validateInput — both are optional; resolution logic decides
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    // 1) Resolve target listing/trade
    const nctx = await resolveNegotiationContext(db, input.tradeId, input.listingId);

    if (!nctx) {
      return apiOk({
        ok: true,
        context: null,
        script: null,
        aiUsed: false,
        message: 'Ni najdenega oglasa ali trade-a — negotiation script ni mogoče generirati.',
      });
    }

    // 2) AI cache
    const cacheKey = `negotiation-script:${nctx.listingId}`;
    const cached = getCachedAI<{ context: NegotiationContext; script: NegotiationScript }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        context: cached.context,
        script: cached.script,
        cached: true,
        aiUsed: true,
      });
    }

    // 3) Build AI prompt with grounding + call AI (try/catch z graceful fallback)
    const prompt = buildPrompt(nctx);

    let aiUsed = false;
    let script: NegotiationScript = deterministicScript(nctx);

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiScriptResponse | null;
      if (parsed) {
        script = validateAiScript(parsed, nctx);
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/negotiation-script-generator',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 4) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { context: nctx, script });
    }

    return apiOk({
      ok: true,
      context: nctx,
      script,
      aiUsed,
    });
  },
});

export const GET = negotiationScriptHandler;
export const POST = negotiationScriptHandler;
