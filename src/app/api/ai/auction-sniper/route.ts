/**
 * @deprecated v8.94 — uporabi `/api/ai/auction-sniper-v2` namesto tega.
 * Zastareli v1 — v2 je najnovejši.
 * Ta endpoint bo odstranjen v v9.0. Glej ENDPOINTS_AUDIT.md za migracijski načrt.
 */
// v6.12 / v8.94-refactor: AI Auction Sniper — strategija za last-minute bidding / čakanje na cenovni padec
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/auction-sniper
// Body: { listingId?: string, listing?: { title, price, location, description, source, postedAt } }
// Returns: { ok, strategy: { mode, action, timing: { wait, bid, deadline }, maxBid, snipeTime, reasoning, signals, contingencies } }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';
import { logDeprecatedCall } from '@/lib/deprecated-redirect';

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
}

interface AuctionSniperInput {
  listingId?: string;
  listing: ListingInput | null;
}

export const POST = withAiRoute<AuctionSniperInput>({
  endpoint: '/api/ai/auction-sniper',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      listingId: body?.listingId ? String(body.listingId) : undefined,
      listing: (body?.listing ?? null) as ListingInput | null,
    };
  },

  // No validateInput — listingId in listing sta oba opcijska; validira handler
  // (listingId brez listing-a naloži iz baze; brez obeh → 400).
  handler: async (input, ctx: AiRouteContext) => {
    // PRESERVED: Phase 2 deprecation logging — kliče se na VRH handler-ja.
    logDeprecatedCall('/api/ai/auction-sniper', ctx.req, '/api/ai/auction-sniper-v2');

    const { db, callAi, parseAi } = ctx;
    const { listingId, listing: listingInputRaw } = input;

    // 1. Če je podan listingId, pridobi iz baze
    let listingInput: ListingInput | null = listingInputRaw;
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
      };
    }

    if (!listingInput) {
      return apiBadRequest('listingId ali listing objekt je obvezen');
    }

    // 2. Pridobi kontekst — price drop patterns in seller history
    const listingPrice = Number(listingInput.price) || 0;
    const marketSignals = await buildMarketSignals(db, listingPrice);

    // 3. AI auction sniper analiza
    const postedAtStr = listingInput.postedAt
      ? new Date(listingInput.postedAt).toISOString()
      : 'neznan';
    const daysSincePosted = listingInput.postedAt
      ? Math.round((Date.now() - new Date(listingInput.postedAt).getTime()) / (24 * 60 * 60 * 1000))
      : 0;

    const prompt = buildPrompt({ listingInput, listingPrice, postedAtStr, daysSincePosted, marketSignals });

    const raw = await callAi(prompt);
    const parsed: unknown = parseAi(raw);

    const strategy = transformStrategy(parsed, listingPrice);

    return apiOk({
      ok: true,
      strategy,
      listing: listingInput,
      marketSignals,
      daysSincePosted,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

async function buildMarketSignals(
  db: AiRouteContext['db'],
  listingPrice: number
): Promise<string[]> {
  const signals: string[] = [];
  if (listingPrice <= 0) return signals;

  const similar = await db.listing.findMany({
    where: {
      price: { gte: Math.floor(listingPrice * 0.7), lte: Math.ceil(listingPrice * 1.3) },
      isHidden: false,
    },
    select: { price: true, firstSeenAt: true, previousPrice: true, priceDroppedAt: true, title: true },
    take: 30,
  });

  const droppedCount = similar.filter(l => l.priceDroppedAt).length;
  const dropRate = similar.length > 0 ? Math.round((droppedCount / similar.length) * 100) : 0;
  if (dropRate > 30) {
    signals.push(`${dropRate}% podobnih oglasov je že znižalo ceno — verjetno bo tudi ta`);
  }

  const avgAgeDays = similar.length > 0
    ? Math.round(similar.reduce((s, l) => s + (Date.now() - l.firstSeenAt.getTime()) / (24 * 60 * 60 * 1000), 0) / similar.length)
    : 0;
  if (avgAgeDays > 14) {
    signals.push(`Podobni oglasi so v povprečju stari ${avgAgeDays}d — prodajalci so morda bolj motivirani`);
  }

  return signals;
}

interface PromptContext {
  listingInput: ListingInput;
  listingPrice: number;
  postedAtStr: string;
  daysSincePosted: number;
  marketSignals: string[];
}

function buildPrompt(ctx: PromptContext): string {
  const { listingInput, listingPrice, postedAtStr, daysSincePosted, marketSignals } = ctx;
  return `Si ekspert za "auction sniping" strategijo pri nakupu rabljenih dobrin.
Analiziraj oglas in predlagaj optimalno strategijo: kdaj kontaktirati, koliko ponuditi, kdaj čakati.

OGLAS:
NASLOV: ${listingInput.title}
CENA: ${listingInput.priceText || (listingPrice + ' EUR')}
LOKACIJA: ${listingInput.location || 'neznan'}
VIR: ${listingInput.source || 'neznan'}
DODAN: ${postedAtStr} (${daysSincePosted}d nazaj)
OPIS: ${(listingInput.description || '').slice(0, 600)}

TRŽNI SIGNALI:
${marketSignals.length > 0 ? marketSignals.map(s => `- ${s}`).join('\n') : '- Ni posebnih signalov'}

Strategije (mode):
- "wait_drop": čakaj na cenovni padec (primerno ko prodajalci tipično znižujejo)
- "snipe_now": kontaktiraj takoj z nižjo ponudbo (redki itemi, visoka konkurenca)
- "last_minute": kontaktiraj ob koncu tedna/dneva ko prodajalci popuščajo
- "patient_hold": ne kontaktiraj še, počakaj 7-14d na večji padec
- "aggressive_bid": takojšnja agresivna ponudba (80% cene) — za redke/high-demand iteme

Za vsako strategijo določi:
- maxBid: maksimalna ponudba v EUR
- snipeTime: kdaj točno kontaktirati (datum/uro ali "v X dneh")
- wait: koliko dni čakati od zdaj
- bid: kdaj staviti (urov v dnevu)
- deadline: do kdaj velja ponudba
- signals: ključni signali ki podpirajo strategijo (3-5)
- contingencies: kaj narediti če prodajalec ne odgovori/zavrne (2-3)

Odgovori LE z JSON:
{
  "mode": "<wait_drop|snipe_now|last_minute|patient_hold|aggressive_bid>",
  "action": "<konkretno dejanje, max 150 znakov>",
  "maxBid": <number>,
  "timing": {
    "wait": <number, koliko dni čakati>,
    "bid": "<urov/dan za kontakt, max 80 znakov>",
    "deadline": "<do kdaj velja, max 80 znakov>"
  },
  "snipeTime": "<natančen opis kdaj, max 150 znakov>",
  "reasoning": "<zakaj ta strategija, max 200 znakov>",
  "signals": ["<signal, max 100 znakov>", "..."],
  "contingencies": ["<kaj če, max 100 znakov>", "..."],
  "priceDropProbability": <number 0-100>,
  "competitionLevel": "<low|medium|high>",
  "estimatedDealScore": <number 0-100>
}`;
}

interface StrategyResult {
  mode: string;
  action: string;
  maxBid: number;
  timing: {
    wait: number;
    bid: string;
    deadline: string;
  };
  snipeTime: string;
  reasoning: string;
  signals: string[];
  contingencies: string[];
  priceDropProbability: number;
  competitionLevel: string;
  estimatedDealScore: number;
}

function transformStrategy(parsed: unknown, listingPrice: number): StrategyResult {
  const p = (parsed ?? {}) as Record<string, any>;
  const timing = (p?.timing ?? {}) as Record<string, any>;
  return {
    mode: ['wait_drop', 'snipe_now', 'last_minute', 'patient_hold', 'aggressive_bid'].includes(String(p?.mode))
      ? String(p.mode) : 'wait_drop',
    action: String(p?.action ?? '').slice(0, 250),
    maxBid: Math.max(0, Number(p?.maxBid ?? Math.round(listingPrice * 0.85))),
    timing: {
      wait: Math.max(0, Math.min(60, Number(timing?.wait ?? 0))),
      bid: String(timing?.bid ?? '').slice(0, 150),
      deadline: String(timing?.deadline ?? '').slice(0, 150),
    },
    snipeTime: String(p?.snipeTime ?? '').slice(0, 250),
    reasoning: String(p?.reasoning ?? '').slice(0, 300),
    signals: Array.isArray(p?.signals)
      ? p.signals.slice(0, 6).map((s: any) => String(s).slice(0, 200))
      : [],
    contingencies: Array.isArray(p?.contingencies)
      ? p.contingencies.slice(0, 4).map((c: any) => String(c).slice(0, 200))
      : [],
    priceDropProbability: Math.max(0, Math.min(100, Number(p?.priceDropProbability ?? 50))),
    competitionLevel: ['low', 'medium', 'high'].includes(String(p?.competitionLevel))
      ? String(p.competitionLevel) : 'medium',
    estimatedDealScore: Math.max(0, Math.min(100, Number(p?.estimatedDealScore ?? 50))),
  };
}
