// v8.17: Market Brain — GET+POST /api/ai/brain/market
//
// Market Brain is the THIRD "Brain" layer — a NEW architectural layer ABOVE
// the ~27 market specialist endpoints (market-cycle-phase-predictor,
// market-depth-trend-analyzer, market-volatility-forecaster,
// market-trend-forecaster-pro, market-saturation, sentiment-analysis,
// market-timing-profit-optimizer, ...). Each specialist measures ONE market
// dimension. The Market Brain synthesizes 6 market signals (cyclePhase,
// sentiment, depth, volatility, trend, timing) into ONE decision:
//   - 3 top actions for today, ranked by expectedUpliftEUR × confidence
//   - 30d / 90d market phase projections (predictedPhase + predictedPriceChangePct
//     + recommendedAction BUY/SELL/HOLD/LIQUIDATE)
//   - overall market grade (weighted across 6 signals)
//   - one-line summary that names the single biggest lever
//
// DIFFERENCES from Profit Brain (v8.15):
//  - Profit Brain reads TRADE HISTORY (monthlyProfits[]) → synthesizes
//    profit-growth signals. Market Brain reads MARKET CONTEXT (active listings,
//    price changes, inquiries, sell-through) → synthesizes market-cycle signals.
//  - Profit Brain's projection30d/projection90d are scalars (EUR/mo).
//    Market Brain's projections are STRUCTURED objects with phase + price
//    change % + recommendedAction — because market timing is phase-dependent
//    (BUY in ACCUMULATION, SELL in DISTRIBUTION).
//
// DIFFERENCES from Inventory Brain (v8.16):
//  - Inventory Brain answers "how well is your stock performing as capital?".
//    Market Brain answers "where in the market cycle are we RIGHT NOW?".
//  - Inventory Brain projects inventory value + aged stock %.
//    Market Brain projects market PHASE + price-change % + recommended action.
//
// DIFFERENCES from the ~27 market specialists:
//  - Specialists measure ONE dimension. Brain SYNTHESIZES 6 dimensions.
//  - In v8.17 the Brain computes the 6 signals itself (pure deterministic
//    TypeScript — no AI, no HTTP fan-out). This keeps the Brain fast (<5ms)
//    and fully testable.
//
// DETERMINISTIC (aiUsed: false): no external AI/LLM SDK is called.
// DB-BACKED STATE INJECTION (graceful): if Prisma is available, read from the
// Listing model (active listings + price changes + sell-through estimates).
// If DB unavailable or no listings, falls back to sensible defaults — never
// crashes.
// 5-MIN CACHE: cache key = `market-brain:${hashOfInputs}`, TTL = 300000 ms.

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getCachedAIWithStats, setCachedAIWithStats } from '@/lib/ai-cache';
// v8.33: Performance metrics — wraps marketBrain() with response-time tracking
import { withPerf, recordPerf } from '@/lib/brain/performance';
import {
  marketBrain,
  type MarketBrainInput,
  type MarketBrainResult,
} from '@/lib/brain/market';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// --- Cache TTL -----------------------------------------------------------
const BRAIN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// --- Input resolution ----------------------------------------------------

/**
 * Parse inputs from BOTH query string (GET) and POST body. Body takes
 * precedence over query (POST is more explicit intent).
 */
async function resolveInputs(req: NextRequest): Promise<MarketBrainInput> {
  let queryParams: URLSearchParams | null = null;
  try {
    const url = new URL(req.url);
    queryParams = url.searchParams;
  } catch {
    queryParams = null;
  }

  let bodyParams: Record<string, unknown> | null = null;
  if (req.method === 'POST') {
    try {
      const ct = req.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        const cloned = req.clone();
        const parsed = (await cloned.json()) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          bodyParams = parsed;
        }
      }
    } catch {
      bodyParams = null;
    }
  }

  const lookup = (key: string): unknown => {
    if (bodyParams && key in bodyParams) return bodyParams[key];
    if (queryParams) {
      const qv = queryParams.get(key);
      if (qv != null && qv !== '') return qv;
    }
    return undefined;
  };

  const asNumber = (key: string): number | undefined => {
    const v = lookup(key);
    if (v == null) return undefined;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const asString = (key: string): string | undefined => {
    const v = lookup(key);
    if (v == null) return undefined;
    return typeof v === 'string' ? v : String(v);
  };

  const input: MarketBrainInput = {};
  const activeListingCount = asNumber('activeListingCount');
  if (activeListingCount != null) input.activeListingCount = activeListingCount;
  const newLastWeek = asNumber('newLastWeek');
  if (newLastWeek != null) input.newLastWeek = newLastWeek;
  const avgPriceChangePctWeek = asNumber('avgPriceChangePctWeek');
  if (avgPriceChangePctWeek != null) input.avgPriceChangePctWeek = avgPriceChangePctWeek;
  const avgPriceChangePctMonth = asNumber('avgPriceChangePctMonth');
  if (avgPriceChangePctMonth != null) input.avgPriceChangePctMonth = avgPriceChangePctMonth;
  const buyerInquiriesLastWeek = asNumber('buyerInquiriesLastWeek');
  if (buyerInquiriesLastWeek != null) input.buyerInquiriesLastWeek = buyerInquiriesLastWeek;
  const sellThroughRatePct = asNumber('sellThroughRatePct');
  if (sellThroughRatePct != null) input.sellThroughRatePct = sellThroughRatePct;
  const avgDaysOnMarket = asNumber('avgDaysOnMarket');
  if (avgDaysOnMarket != null) input.avgDaysOnMarket = avgDaysOnMarket;
  const priceSpreadPct = asNumber('priceSpreadPct');
  if (priceSpreadPct != null) input.priceSpreadPct = priceSpreadPct;
  const category = asString('category');
  if (category) input.category = category;
  return input;
}

// --- DB state injection (graceful) ---------------------------------------

interface DbDerivedState {
  activeListingCount: number;
  newLastWeek: number;
  avgPriceChangePctMonth: number;
  buyerInquiriesLastWeek: number;
  sellThroughRatePct: number;
  avgDaysOnMarket: number;
  priceSpreadPct: number;
}

/**
 * Read from Listing table to derive market context.
 * Wrapped in try/catch — never throws. Returns null if DB unavailable
 * or no usable data found.
 *
 *  - activeListingCount: total non-hidden listings
 *  - newLastWeek: listings first seen in last 7 days
 *  - avgPriceChangePctMonth: avg price drop % across listings with previousPrice set (last 30d)
 *  - buyerInquiriesLastWeek: listings with contactStatus != 'none' contacted in last 7 days
 *  - sellThroughRatePct: % of listings that had dealScoreComputedAt set within 30d of firstSeenAt
 *  - avgDaysOnMarket: avg age (now - firstSeenAt) of listings still active
 *  - priceSpreadPct: (max - min) / median × 100 across priced active listings
 */
async function fetchDbState(): Promise<DbDerivedState | null> {
  try {
    // Dynamic import — avoids Prisma client init cost when DB unavailable
    const { db } = await import('@/lib/db');

    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Active listings (not hidden)
    const activeListings = await db.listing.findMany({
      where: { isHidden: false },
      select: {
        price: true,
        firstSeenAt: true,
        previousPrice: true,
        priceDroppedAt: true,
        contactStatus: true,
        contactedAt: true,
        dealScoreComputedAt: true,
      },
    });

    if (activeListings.length === 0) {
      return null;
    }

    // --- activeListingCount + price spread ---------------------------------
    const pricedListings = activeListings.filter(
      (l) => typeof l.price === 'number' && l.price > 0,
    );
    const activeListingCount = activeListings.length;

    let priceSpreadPct = 25; // fallback default
    if (pricedListings.length >= 3) {
      const prices = pricedListings
        .map((l) => l.price as number)
        .sort((a, b) => a - b);
      const min = prices[0];
      const max = prices[prices.length - 1];
      const median =
        prices.length % 2 === 1
          ? prices[(prices.length - 1) / 2]
          : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
      if (median > 0) {
        priceSpreadPct = Math.round(((max - min) / median) * 100 * 100) / 100;
      }
    }

    // --- newLastWeek -------------------------------------------------------
    const newLastWeek = activeListings.filter(
      (l) => l.firstSeenAt && new Date(l.firstSeenAt) >= sevenDaysAgo,
    ).length;

    // --- avgPriceChangePctMonth (price drops in last 30d) -----------------
    const dropped = activeListings.filter(
      (l) =>
        l.previousPrice != null &&
        typeof l.price === 'number' &&
        l.price > 0 &&
        l.priceDroppedAt &&
        new Date(l.priceDroppedAt) >= thirtyDaysAgo,
    );
    let avgPriceChangePctMonth = 0; // negative = drops, positive = rises
    if (dropped.length > 0) {
      const sumPct = dropped.reduce((acc, l) => {
        const prev = l.previousPrice as number;
        const cur = l.price as number;
        return acc + ((cur - prev) / prev) * 100;
      }, 0);
      avgPriceChangePctMonth = Math.round((sumPct / dropped.length) * 100) / 100;
    }

    // --- buyerInquiriesLastWeek (contacted in last 7d) --------------------
    const buyerInquiriesLastWeek = activeListings.filter(
      (l) =>
        l.contactStatus &&
        l.contactStatus !== 'none' &&
        l.contactedAt &&
        new Date(l.contactedAt) >= sevenDaysAgo,
    ).length;

    // --- sellThroughRatePct (deal-scored within 30d of firstSeen) ----------
    const sold = activeListings.filter(
      (l) =>
        l.dealScoreComputedAt &&
        l.firstSeenAt &&
        new Date(l.dealScoreComputedAt).getTime() -
          new Date(l.firstSeenAt).getTime() <=
          30 * 86_400_000,
    ).length;
    const sellThroughRatePct =
      activeListingCount > 0
        ? Math.round((sold / activeListingCount) * 100 * 100) / 100
        : 45;

    // --- avgDaysOnMarket ---------------------------------------------------
    const dayMs = 86_400_000;
    const ageSum = activeListings.reduce((acc, l) => {
      if (!l.firstSeenAt) return acc;
      const days = (now.getTime() - new Date(l.firstSeenAt).getTime()) / dayMs;
      return days >= 0 && days < 365 ? acc + days : acc;
    }, 0);
    const countedAges = activeListings.filter(
      (l) =>
        l.firstSeenAt &&
        (now.getTime() - new Date(l.firstSeenAt).getTime()) / dayMs >= 0 &&
        (now.getTime() - new Date(l.firstSeenAt).getTime()) / dayMs < 365,
    ).length;
    const avgDaysOnMarket =
      countedAges > 0 ? Math.round((ageSum / countedAges) * 100) / 100 : 14;

    return {
      activeListingCount,
      newLastWeek,
      avgPriceChangePctMonth,
      buyerInquiriesLastWeek,
      sellThroughRatePct,
      avgDaysOnMarket,
      priceSpreadPct,
    };
  } catch (err: any) {
    logger.warn(
      '/api/ai/brain/market',
      'DB state injection failed — using defaults',
      err,
    );
    return null;
  }
}

// --- Cache key -----------------------------------------------------------

/**
 * Build a deterministic cache key from the resolved input. Same input → same
 * key → cache hit. We do NOT include DB state in the key — DB state changes
 * slowly (listings are append-only) and the 5-min TTL is short enough
 * that any state drift is acceptable.
 */
function buildCacheKey(input: MarketBrainInput): string {
  const parts: string[] = [];
  parts.push(`alc:${input.activeListingCount ?? ''}`);
  parts.push(`nlw:${input.newLastWeek ?? ''}`);
  parts.push(`apw:${input.avgPriceChangePctWeek ?? ''}`);
  parts.push(`apm:${input.avgPriceChangePctMonth ?? ''}`);
  parts.push(`bil:${input.buyerInquiriesLastWeek ?? ''}`);
  parts.push(`str:${input.sellThroughRatePct ?? ''}`);
  parts.push(`adm:${input.avgDaysOnMarket ?? ''}`);
  parts.push(`psp:${input.priceSpreadPct ?? ''}`);
  parts.push(`cat:${input.category ?? ''}`);
  // v8.33: Return ONLY the suffix — namespace prefix is now prepended by the
  // stats-tracked cache wrappers. Actual stored key unchanged.
  return parts.join('|');
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleMarketBrain(req);
}

export async function POST(req: NextRequest) {
  return handleMarketBrain(req);
}

async function handleMarketBrain(req: NextRequest) {
  try {
    const userInput = await resolveInputs(req);

    // DB state injection — fills in any missing fields from real market state.
    // If both DB and user input are present, USER INPUT WINS (user can override).
    const dbState = await fetchDbState();
    const mergedInput: MarketBrainInput = {
      activeListingCount:
        userInput.activeListingCount ?? dbState?.activeListingCount ?? undefined,
      newLastWeek: userInput.newLastWeek ?? dbState?.newLastWeek ?? undefined,
      avgPriceChangePctWeek: userInput.avgPriceChangePctWeek ?? undefined,
      avgPriceChangePctMonth:
        userInput.avgPriceChangePctMonth ?? dbState?.avgPriceChangePctMonth ?? undefined,
      buyerInquiriesLastWeek:
        userInput.buyerInquiriesLastWeek ?? dbState?.buyerInquiriesLastWeek ?? undefined,
      sellThroughRatePct:
        userInput.sellThroughRatePct ?? dbState?.sellThroughRatePct ?? undefined,
      avgDaysOnMarket:
        userInput.avgDaysOnMarket ?? dbState?.avgDaysOnMarket ?? undefined,
      priceSpreadPct: userInput.priceSpreadPct ?? dbState?.priceSpreadPct ?? undefined,
      category: userInput.category ?? undefined,
    };

    const cacheKey = buildCacheKey(mergedInput);
    // v8.33: Use cache stats-tracked variants. Namespace = 'market-brain'.
    const cacheHitStart = Date.now();
    const cached = getCachedAIWithStats<MarketBrainResult>('market-brain', cacheKey);
    if (cached) {
      // v8.33: Record a perf entry for the cache-hit path (fast — just lookup).
      recordPerf('market', Date.now() - cacheHitStart, true);
      // Re-stamp cachedAt so the caller sees a fresh "served at" timestamp.
      const served: MarketBrainResult = {
        ...cached,
        cachedAt: Date.now(),
      };
      return NextResponse.json(served);
    }

    // v8.33: Wrap marketBrain() call with perf tracking. cached=false (slow path).
    const result = await withPerf('market', async () => marketBrain(mergedInput), false);
    setCachedAIWithStats('market-brain', cacheKey, result, BRAIN_CACHE_TTL_MS);

    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/api/ai/brain/market', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
