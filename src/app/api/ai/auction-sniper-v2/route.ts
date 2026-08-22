// v6.46 / v8.94-refactor: AI Auction Sniper v2 — napreden sniper z ML timing, anti-snipe in multi-platform podporo
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/auction-sniper-v2
// Body: { listingId?: string, listing?: { title, price, location, source, postedAt, endsAt? } }
// Returns: { ok, strategy: { mode, timing, bid, defenses, scenarios, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface ListingInput {
  title: string;
  price?: number | null;
  priceText?: string;
  location?: string;
  description?: string;
  source?: string;
  postedAt?: string | null;
  endsAt?: string | null;
  currentBidders?: number;
  currentBid?: number;
}

interface AuctionSniperInput {
  listingId?: string;
  listing: ListingInput | null;
}

interface PromptContext {
  title: string;
  price: number | null;
  location: string;
  description: string;
  source: string;
  listingAgeHours: number;
  hoursUntilEnd: number | null;
  currentBidders: number;
  currentBid: number | null;
  recentSold: Array<{
    title: string;
    buyPrice: number | null;
    sellPrice: number | null;
  }>;
}

export const POST = withAiRoute<AuctionSniperInput>({
  endpoint: '/api/ai/auction-sniper-v2',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      listingId: body?.listingId ? String(body.listingId) : undefined,
      listing: body?.listing ?? null,
    };
  },

  // No validateInput — listingId/listing sta opcijska (fallback na PRILIKA listing)
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { listingId, listing: listingInput } = input;

    // 1. Pridobi listing podatke
    let title = '';
    let price: number | null = null;
    let location = '';
    let description = '';
    let source = 'bolha';
    let postedAt: Date | null = null;
    let endsAt: Date | null = null;
    let currentBidders = 0;
    let currentBid: number | null = null;

    if (listingId) {
      const listing = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: {
          title: true, price: true, priceText: true, location: true,
          description: true, detailDescription: true, postedAt: true, firstSeenAt: true,
          aiEstimatedValue: true, dealScore: true, aiScore: true, aiRisk: true,
          aiVerdict: true, url: true,
          monitor: { select: { name: true, source: true } },
        },
      });
      if (!listing) throw new ApiRouteError('Listing ne obstaja', 404);
      title = listing.title;
      price = listing.price;
      location = listing.location;
      description = (listing.detailDescription || listing.description || '').slice(0, 500);
      source = listing.monitor?.source || 'bolha';
      postedAt = listing.postedAt ?? listing.firstSeenAt;
    } else if (listingInput) {
      title = listingInput.title;
      price = listingInput.price ?? null;
      location = listingInput.location || '';
      description = listingInput.description || '';
      source = listingInput.source || 'bolha';
      postedAt = listingInput.postedAt ? new Date(listingInput.postedAt) : null;
      endsAt = listingInput.endsAt ? new Date(listingInput.endsAt) : null;
      currentBidders = listingInput.currentBidders || 0;
      currentBid = listingInput.currentBid ?? null;
    } else {
      // Pridobi zadnje "PRILIKA" listinge
      const listing = await db.listing.findFirst({
        where: { aiVerdict: 'PRILIKA', aiScore: { gte: 7 }, isHidden: false },
        orderBy: { firstSeenAt: 'desc' },
        select: {
          title: true, price: true, priceText: true, location: true,
          description: true, detailDescription: true, postedAt: true, firstSeenAt: true,
          aiEstimatedValue: true, dealScore: true, aiScore: true, aiRisk: true,
          url: true,
          monitor: { select: { name: true, source: true } },
        },
      });
      if (!listing) return apiOk({ ok: true, strategy: null, message: 'Ni primernega listinga za auction sniper.' });
      title = listing.title;
      price = listing.price;
      location = listing.location;
      description = (listing.detailDescription || listing.description || '').slice(0, 500);
      source = listing.monitor?.source || 'bolha';
      postedAt = listing.postedAt ?? listing.firstSeenAt;
    }

    const now = Date.now();
    const postedAtTime = postedAt ? postedAt.getTime() : now;
    const listingAgeHours = Math.round((now - postedAtTime) / (60 * 60 * 1000));
    const endsAtTime = endsAt ? endsAt.getTime() : null;
    const hoursUntilEnd = endsAtTime ? Math.max(0, Math.round((endsAtTime - now) / (60 * 60 * 1000))) : null;

    // Zgodovinski podatki o zmagovalnih ponudbah
    const recentSold = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { title: true, category: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true },
      take: 50,
      orderBy: { sellDate: 'desc' },
    });

    // 2. AI klic
    const prompt = buildPrompt({
      title, price, location, description, source,
      listingAgeHours, hoursUntilEnd, currentBidders, currentBid, recentSold,
    });
    const raw = await callAi(prompt);
    const parsed: unknown = parseAi(raw);

    // 3. Transformacija rezultatov
    const strategy = transformStrategy(parsed, price);

    return apiOk({ ok: true, strategy });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildPrompt(ctx: PromptContext): string {
  const { title, price, location, description, source, listingAgeHours,
    hoursUntilEnd, currentBidders, currentBid, recentSold } = ctx;
  return `Si AI auction sniper v2 z ML timing modelom za slovenske oglasne platforme.
Analiziraj listing in predlagaj optimalno bid strategijo z naprednim timingom.

LISTING:
- Naslov: "${title}"
- Trenutna cena: ${price ?? 'nepoznano'}€
- Lokacija: ${location || 'nepoznano'}
- Vir: ${source}
- Starost listinga: ${listingAgeHours}h
- ${hoursUntilEnd !== null ? `Dražba se konča čez: ${hoursUntilEnd}h` : 'Konca dražbe: nepoznan'}
- ${currentBidders > 0 ? `Trenutno ponudnikov: ${currentBidders}` : ''}
- ${currentBid !== null ? `Trenutna najvišja ponudba: ${currentBid}€` : ''}
- Opis: ${description.slice(0, 300)}

Zgodovinski podatki (zadnje prodaje):
${recentSold.slice(0, 10).map(s => `- "${s.title}" | ${s.buyPrice}€ → ${s.sellPrice}€`).join('\n')}

Sniper v2 funkcije:
1. ML TIMING MODEL: napove optimalen čas za bid (zadnji 5-30 sekund)
2. ANTI-SNIPE: avtomatsko podaljšanje če nekdo bid-a v zadnji sekundi
3. INCREMENTAL_BIDDING: postopno poviševanje do max bid
4. PSYCHOLOGICAL_BIDDING: bid-ki odvračajo druge (round numbers, +1€ above current)
5. MAX_BID_CALCULATION: max bid glede na AI value in competition
6. SNIPE_PROTECTION: zaključi v zadnji 1-3 sekundah da drugi ne morejo reagirati
7. MULTI-SNIPER: če več dražb hkrati, prioritetiziraj
8. FALLBACK_PLAN: če izgubiš, alternative

Bid taktike:
- AGGRESSIVE: visok začetni bid (odvrača konkurenco)
- PATIENT: čakaj do zadnje sekunde
- PSYCHOLOGICAL: bid-ki signalinga moč (npr. 105€ namesto 100€)
- INCREMENTAL: počasi povišuj da preizkusiš konkurenco
- DECOY: nizki začetni bid-ki privabi druge, nato high snipe

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "mode": "<aggressive|patient|psychological|incremental|decoy>",
  "action": "<bid_now|wait|monitor|skip>",
  "timing": {
    "wait_until_seconds_before_end": <number>,
    "optimal_bid_window_seconds": <number>,
    "earliest_bid_time": "<ISO datetime ali 'now'>",
    "latest_bid_time": "<ISO datetime>",
    "delay_between_bids_seconds": <number>,
    "anti_snipe_buffer_seconds": <number>,
    "timezone": "Europe/Ljubljana"
  },
  "bid": {
    "starting_bid_eur": <number>,
    "increment_strategy": "<aggressive|moderate|conservative>",
    "max_bid_eur": <number>,
    "snipe_bid_eur": <number>,
    "buy_now_price_eur": <number>,
    "expected_winning_bid_eur": <number>,
    "win_probability_pct": <number 0-100>,
    "expected_profit_eur": <number>,
    "bid_count_planned": <number>
  },
  "defenses": [
    { "defense": "<anti_snipe|incremental|psychological|decoy|fallback>", "description": "<max 100 znakov>", "trigger": "<max 80 znakov>", "response_action": "<max 120 znakov>" }
  ],
  "scenarios": [
    { "scenario": "<no_competition|one_bidder|frenzy|anti_snipe_triggered|loss>", "probability_pct": <number>, "expected_outcome": "<max 100 znakov>", "best_response": "<max 120 znakov>" }
  ],
  "competitor_analysis": {
    "expected_bidders": <number>,
    "likely_max_competitor_bid_eur": <number>,
    "competition_level": "<low|medium|high|frenzy>",
    "best_strategy_vs_competition": "<max 100 znakov>"
  },
  "summary": {
    "win_probability_pct": <number 0-100>,
    "expected_profit_eur": <number>,
    "max_acceptable_bid_eur": <number>,
    "optimal_timing": "<max 80 znakov>",
    "biggest_risk": "<max 100 znakov>",
    "sniper_efficiency_score": <number 0-100>,
    "fallback_action": "<max 100 znakov>"
  }
}`;
}

interface StrategyResult {
  insights: string;
  mode: string;
  action: string;
  timing: {
    waitUntilSecondsBeforeEnd: number;
    optimalBidWindowSeconds: number;
    earliestBidTime: string;
    latestBidTime: string;
    delayBetweenBidsSeconds: number;
    antiSnipeBufferSeconds: number;
    timezone: string;
  };
  bid: {
    startingBidEur: number;
    incrementStrategy: string;
    maxBidEur: number;
    snipeBidEur: number;
    buyNowPriceEur: number;
    expectedWinningBidEur: number;
    winProbabilityPct: number;
    expectedProfitEur: number;
    bidCountPlanned: number;
  };
  defenses: Array<{
    defense: string;
    description: string;
    trigger: string;
    responseAction: string;
  }>;
  scenarios: Array<{
    scenario: string;
    probabilityPct: number;
    expectedOutcome: string;
    bestResponse: string;
  }>;
  competitorAnalysis: {
    expectedBidders: number;
    likelyMaxCompetitorBidEur: number;
    competitionLevel: string;
    bestStrategyVsCompetition: string;
  };
  summary: {
    winProbabilityPct: number;
    expectedProfitEur: number;
    maxAcceptableBidEur: number;
    optimalTiming: string;
    biggestRisk: string;
    sniperEfficiencyScore: number;
    fallbackAction: string;
  };
}

function transformStrategy(parsed: unknown, price: number | null): StrategyResult {
  const p = (parsed ?? {}) as Record<string, any>;
  const t = (p?.timing ?? {}) as Record<string, any>;
  const b = (p?.bid ?? {}) as Record<string, any>;
  const ca = (p?.competitor_analysis ?? {}) as Record<string, any>;
  const s = (p?.summary ?? {}) as Record<string, any>;
  return {
    insights: String(p?.insights ?? '').slice(0, 500),
    mode: ['aggressive', 'patient', 'psychological', 'incremental', 'decoy'].includes(String(p?.mode)) ? String(p.mode) : 'patient',
    action: ['bid_now', 'wait', 'monitor', 'skip'].includes(String(p?.action)) ? String(p.action) : 'monitor',
    timing: {
      waitUntilSecondsBeforeEnd: Math.max(0, Math.min(300, Number(t?.wait_until_seconds_before_end ?? 5))),
      optimalBidWindowSeconds: Math.max(1, Math.min(60, Number(t?.optimal_bid_window_seconds ?? 10))),
      earliestBidTime: String(t?.earliest_bid_time ?? 'now').slice(0, 50),
      latestBidTime: String(t?.latest_bid_time ?? '').slice(0, 50),
      delayBetweenBidsSeconds: Math.max(0, Math.min(60, Number(t?.delay_between_bids_seconds ?? 3))),
      antiSnipeBufferSeconds: Math.max(0, Math.min(30, Number(t?.anti_snipe_buffer_seconds ?? 5))),
      timezone: 'Europe/Ljubljana',
    },
    bid: {
      startingBidEur: Math.max(0, Math.round(Number(b?.starting_bid_eur ?? price ?? 0))),
      incrementStrategy: ['aggressive', 'moderate', 'conservative'].includes(String(b?.increment_strategy)) ? String(b.increment_strategy) : 'moderate',
      maxBidEur: Math.max(0, Math.round(Number(b?.max_bid_eur ?? (price ?? 0) * 1.2))),
      snipeBidEur: Math.max(0, Math.round(Number(b?.snipe_bid_eur ?? (price ?? 0) * 1.1))),
      buyNowPriceEur: Math.max(0, Math.round(Number(b?.buy_now_price_eur ?? 0))),
      expectedWinningBidEur: Math.max(0, Math.round(Number(b?.expected_winning_bid_eur ?? price ?? 0))),
      winProbabilityPct: Math.max(0, Math.min(100, Number(b?.win_probability_pct ?? 50))),
      expectedProfitEur: Math.round(Number(b?.expected_profit_eur ?? 0)),
      bidCountPlanned: Math.max(1, Math.min(10, Number(b?.bid_count_planned ?? 1))),
    },
    defenses: (p?.defenses || []).slice(0, 6).map((d: any) => ({
      defense: ['anti_snipe', 'incremental', 'psychological', 'decoy', 'fallback'].includes(String(d?.defense)) ? String(d.defense) : 'anti_snipe',
      description: String(d?.description ?? '').slice(0, 200),
      trigger: String(d?.trigger ?? '').slice(0, 150),
      responseAction: String(d?.response_action ?? '').slice(0, 250),
    })),
    scenarios: (p?.scenarios || []).slice(0, 6).map((sc: any) => ({
      scenario: String(sc?.scenario ?? '').slice(0, 50),
      probabilityPct: Math.max(0, Math.min(100, Number(sc?.probability_pct ?? 30))),
      expectedOutcome: String(sc?.expected_outcome ?? '').slice(0, 200),
      bestResponse: String(sc?.best_response ?? '').slice(0, 250),
    })),
    competitorAnalysis: {
      expectedBidders: Math.max(0, Math.min(20, Number(ca?.expected_bidders ?? 3))),
      likelyMaxCompetitorBidEur: Math.round(Number(ca?.likely_max_competitor_bid_eur ?? (price ?? 0) * 1.15)),
      competitionLevel: ['low', 'medium', 'high', 'frenzy'].includes(String(ca?.competition_level)) ? String(ca.competition_level) : 'medium',
      bestStrategyVsCompetition: String(ca?.best_strategy_vs_competition ?? '').slice(0, 200),
    },
    summary: {
      winProbabilityPct: Math.max(0, Math.min(100, Number(s?.win_probability_pct ?? 50))),
      expectedProfitEur: Math.round(Number(s?.expected_profit_eur ?? 0)),
      maxAcceptableBidEur: Math.max(0, Math.round(Number(s?.max_acceptable_bid_eur ?? (price ?? 0) * 1.3))),
      optimalTiming: String(s?.optimal_timing ?? '').slice(0, 200),
      biggestRisk: String(s?.biggest_risk ?? '').slice(0, 200),
      sniperEfficiencyScore: Math.max(0, Math.min(100, Number(s?.sniper_efficiency_score ?? 60))),
      fallbackAction: String(s?.fallback_action ?? '').slice(0, 200),
    },
  };
}
