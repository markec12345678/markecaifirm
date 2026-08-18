// v6.28 / v8.94-refactor: AI Auction Timing Optimizer — optimalni čas za bid na dražbah
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/auction-timing
// Body: { listingId?: string, auctionEnd?: string, currentBid?: number }
// Returns: { ok, timing: { optimalBidTime, secondsBeforeEnd, maxBidEur, suggestedBidEur,
//   strategy, bidSequence, competitorAnalysis, signals, riskFactors, recommendation, reasoning },
//   hoursToEnd }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface AuctionTimingInput {
  listingId?: string;
  auctionEnd: Date | null;
  currentBid: number;
}

interface PromptContext {
  title: string;
  price: number;
  description: string;
  location: string;
  currentBid: number;
  auctionEnd: Date | null;
  hoursToEnd: number;
}

export const POST = withAiRoute<AuctionTimingInput>({
  endpoint: '/api/ai/auction-timing',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      listingId: body?.listingId ? String(body.listingId) : undefined,
      auctionEnd: body?.auctionEnd ? new Date(body.auctionEnd) : null,
      currentBid: Number(body?.currentBid) || 0,
    };
  },

  // No validateInput — vsi input-i imajo defaults (listingId opcijski, auctionEnd nullable, currentBid fallback 0)
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { listingId, auctionEnd, currentBid } = input;

    // 1. Pridobi listing podatke (če je listingId podan)
    let title = '', price = 0, description = '', location = '';
    if (listingId) {
      const listing = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: {
          title: true, price: true, description: true, detailDescription: true,
          location: true, postedAt: true, aiEstimatedValue: true, dealScore: true,
          monitor: { select: { source: true } },
        },
      });
      if (!listing) throw new ApiRouteError('Listing ne obstaja', 404);
      title = listing.title;
      price = listing.price ?? currentBid;
      description = listing.detailDescription || listing.description;
      location = listing.location;
    }

    // 2. Izračunaj čas do konca dražbe
    const now = new Date();
    const hoursToEnd = auctionEnd
      ? Math.round((auctionEnd.getTime() - now.getTime()) / (60 * 60 * 1000))
      : 0;

    // 3. AI klic
    const prompt = buildPrompt({ title, price, description, location, currentBid, auctionEnd, hoursToEnd });
    const raw = await callAi(prompt);
    const parsed: unknown = parseAi(raw);

    // 4. Transformacija rezultatov
    const timing = transformTiming(parsed);

    return apiOk({ ok: true, timing, hoursToEnd });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildPrompt(ctx: PromptContext): string {
  const { title, price, description, location, currentBid, auctionEnd, hoursToEnd } = ctx;
  return `Si ekspert za strategije bidding na spletnih dražbah (eBay, Bolha, Avtonet).
Optimiziraj timing in višino ponudbe za to dražbo.

NASLOV: ${title}
TRENUTNA PONUDBA: ${currentBid || price}€
${auctionEnd ? `KONEC DRAŽBE: ${auctionEnd.toISOString()} (čez ${hoursToEnd}h)` : 'KONEC DRAŽBE: neznan'}
LOKACIJA: ${location}
OPIS: ${description.slice(0, 500)}

Strategije bidding:
- "snipe_last_second": ponudi 3s pred koncom (prepreči bid wars)
- "early_high": visoka ponudba zgodaj (odvrne konkurenco)
- "incremental": postopno povišuj (testira konkurenco)
- "wait_and_snipe": čakaj do zadnje minute, nato snipe
- "proxy_bid": nastavi max bid in pusti sistem

Pravila:
1. Določi maxBid (tvoj absolutni limit) glede na tržno vrednost
2. Optimalen čas za bid: 5-60s pred koncom (snipe)
3. Upoštevaj konkurenco (več bidderjev = višji maxBid ne, prej snipe)
4. Bid sekvenca: kdaj in koliko ponuditi (1-3 koraki)

Odgovori LE z JSON:
{
  "optimal_bid_time": "<kdaj bidati, max 100 znakov>",
  "seconds_before_end": <number>,
  "max_bid_eur": <number>,
  "suggested_bid_eur": <number>,
  "strategy": "<snipe_last_second|early_high|incremental|wait_and_snipe|proxy_bid>",
  "bid_sequence": [
    { "step": <number>, "timing": "<kdaj, max 50 znakov>", "amount_eur": <number>, "condition": "<max 80 znakov>" }
  ],
  "competitor_analysis": {
    "estimated_bidders": <number>,
    "competition_level": "<low|medium|high>",
    "likely_max_competitor_bid_eur": <number>
  },
  "signals": ["<tržni signal, max 80 znakov>", "..."],
  "risk_factors": ["<tveganje, max 80 znakov>", "..."],
  "recommendation": "<bid_now|wait|set_proxy|skip>",
  "reasoning": "<max 200 znakov>"
}`;
}

interface TimingResult {
  optimalBidTime: string;
  secondsBeforeEnd: number;
  maxBidEur: number;
  suggestedBidEur: number;
  strategy: string;
  bidSequence: Array<{ step: number; timing: string; amountEur: number; condition: string }>;
  competitorAnalysis: {
    estimatedBidders: number;
    competitionLevel: string;
    likelyMaxCompetitorBidEur: number;
  };
  signals: string[];
  riskFactors: string[];
  recommendation: string;
  reasoning: string;
}

function transformTiming(parsed: unknown): TimingResult {
  const p = (parsed ?? {}) as Record<string, any>;
  const ca = (p?.competitor_analysis ?? {}) as Record<string, any>;
  return {
    optimalBidTime: String(p?.optimal_bid_time ?? '').slice(0, 200),
    secondsBeforeEnd: Math.max(0, Math.min(300, Number(p?.seconds_before_end ?? 5))),
    maxBidEur: Math.max(0, Number(p?.max_bid_eur ?? 0)),
    suggestedBidEur: Math.max(0, Number(p?.suggested_bid_eur ?? 0)),
    strategy: ['snipe_last_second', 'early_high', 'incremental', 'wait_and_snipe', 'proxy_bid'].includes(String(p?.strategy))
      ? String(p.strategy) : 'snipe_last_second',
    bidSequence: (p?.bid_sequence || []).slice(0, 4).map((b: any) => ({
      step: Math.max(1, Number(b?.step ?? 1)),
      timing: String(b?.timing ?? '').slice(0, 100),
      amountEur: Math.max(0, Number(b?.amount_eur ?? 0)),
      condition: String(b?.condition ?? '').slice(0, 150),
    })),
    competitorAnalysis: {
      estimatedBidders: Math.max(0, Number(ca?.estimated_bidders ?? 0)),
      competitionLevel: ['low', 'medium', 'high'].includes(String(ca?.competition_level))
        ? String(ca.competition_level) : 'medium',
      likelyMaxCompetitorBidEur: Math.max(0, Number(ca?.likely_max_competitor_bid_eur ?? 0)),
    },
    signals: (p?.signals || []).slice(0, 5).map((s: any) => String(s).slice(0, 150)),
    riskFactors: (p?.risk_factors || []).slice(0, 5).map((r: any) => String(r).slice(0, 150)),
    recommendation: ['bid_now', 'wait', 'set_proxy', 'skip'].includes(String(p?.recommendation))
      ? String(p.recommendation) : 'wait',
    reasoning: String(p?.reasoning ?? '').slice(0, 400),
  };
}
