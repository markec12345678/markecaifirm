// v8.21: Pricing Brain — GET+POST /api/ai/brain/pricing
//
// Pricing Brain is the SEVENTH and FINAL "Brain" layer — a NEW architectural
// layer ABOVE the ~39 pricing specialist endpoints (price-elasticity,
// price-optimization-engine-pro, smart-pricing-engine, pricing-psychology-
// optimizer, margin-guardian, margin-guardian-pro, price-war-strategist,
// price-war, seasonal-pricing, competitor-price-tracker, competitor-tracker,
// margin-optimizer, price-volatility-analyzer, pricing-abtest,
// smart-bundle-pricing, price-intelligence-engine, profit-margin-maximizer,
// profit-margin-predictor, profit-margin-predictor-v3, profit-margin-
// forecaster, profit-margin-forecaster-pro, profit-margin-acceleration-
// tracker, profit-margin-optimizer-v2, inventory-profit-margin-tracker,
// inventory-profit-margin-optimizer-pro, deal-source-margin-maximizer,
// deal-source-profit-margin-growth-maximizer, deal-profit-margin-enhancer-pro,
// bundle-profit-optimizer, ...). Each specialist measures ONE pricing
// dimension. The Pricing Brain synthesizes 6 pricing signals (margin,
// elasticity, competitiveness, dynamic, war, psychology) into ONE decision:
//   - 3 top pricing actions for today, ranked by upliftEURPerMonth ×
//     confidence
//   - 30d / 90d pricing projections (projectedMarginPct + projectedRevenue +
//     recommendedPriceChangePct + listingsToReprice)
//   - overall pricing grade (weighted across 6 signals)
//   - pricingPower composite (ability to raise prices without losing volume)
//   - one-line summary that names the single biggest pricing lever
//
// DIFFERENCES from Profit Brain (v8.15):
//  - Profit Brain reads TRADE HISTORY → synthesizes profit-growth signals.
//    Pricing Brain reads PRICING CONTEXT → synthesizes pricing-optimization
//    signals.
//  - Profit Brain's projection30d/projection90d are scalars (EUR/mo).
//    Pricing Brain's projections are STRUCTURED objects with
//    projectedMarginPct + projectedRevenue + recommendedPriceChangePct +
//    listingsToReprice — because pricing optimization is multi-dimensional
//    (raise/lower prices, plan repricing scope, project margin + revenue).
//
// DIFFERENCES from Inventory Brain (v8.16):
//  - Inventory Brain answers "how well is your stock performing as capital?".
//    Pricing Brain answers "how well are your prices optimized?".
//
// DIFFERENCES from Market Brain (v8.17):
//  - Market Brain reads MARKET CONTEXT → synthesizes market-cycle signals.
//    Pricing Brain reads PRICING CONTEXT (margin, elasticity, competitor
//    prices, sell-through, seasonality, psychology) → synthesizes
//    pricing-optimization signals.
//
// DIFFERENCES from Sourcing Brain (v8.18):
//  - Sourcing Brain reads PER-SOURCE BREAKDOWN → synthesizes sourcing signals.
//    Pricing Brain reads AGGREGATE PRICING CONTEXT → synthesizes pricing signals.
//
// DIFFERENCES from Risk Brain (v8.19):
//  - Risk Brain reads RISK EXPOSURE → synthesizes risk-mitigation signals
//    (score HIGHER = LOWER risk; inverted).
//    Pricing Brain reads PRICING CONTEXT → synthesizes pricing-optimization
//    signals (score HIGHER = better pricing — same direction as Profit/
//    Inventory/Market/Sourcing/Buyer).
//
// DIFFERENCES from Buyer Brain (v8.20):
//  - Buyer Brain reads BUYER CONTEXT → synthesizes buyer-cultivation signals.
//    Pricing Brain reads PRICING CONTEXT → synthesizes pricing-optimization
//    signals.
//  - Buyer Brain projects active buyers + LTV + churn + outreach count.
//    Pricing Brain projects margin % + revenue + price change % + listings to reprice.
//
// DIFFERENCES from the ~39 pricing specialists:
//  - Specialists measure ONE dimension. Brain SYNTHESIZES 6 dimensions.
//  - In v8.21 the Brain computes the 6 signals itself (pure deterministic
//    TypeScript — no AI, no HTTP fan-out). This keeps the Brain fast (<5ms)
//    and fully testable.
//
// MILESTONE: After v8.21, all SEVEN Domain Brains are complete (Profit +
// Inventory + Market + Sourcing + Risk + Buyer + Pricing). Next step is
// v8.22 Master Brain which will orchestrate all 7 Brain outputs into ONE
// final decision (TOP 5 actions for today + 30d/90d/12m strategy).
//
// DETERMINISTIC (aiUsed: false): no external AI/LLM SDK is called.
// DB-BACKED STATE INJECTION (graceful): if Prisma is available, read from the
// Listing model (for activeListingsCount, sellThroughRatePct, psychologyOptimizedPct
// inferred from price endings like *.99/*.95) and the Trade model (for
// monthlyRevenue, avgOrderValue, avgProfitMarginPct, avgDaysOnMarket). If DB
// unavailable or no usable rows, falls back to sensible defaults — never
// crashes the endpoint.
// 5-MIN CACHE: cache key = `pricing-brain:${hashOfInputs}`, TTL = 300000 ms.

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';
import {
  pricingBrain,
  type PricingBrainInput,
  type PricingBrainResult,
} from '@/lib/brain/pricing';

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
async function resolveInputs(req: NextRequest): Promise<PricingBrainInput> {
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

  const asInt = (key: string): number | undefined => {
    const n = asNumber(key);
    if (n == null) return undefined;
    return Math.trunc(n);
  };

  const asBoolean = (key: string): boolean | undefined => {
    const v = lookup(key);
    if (v == null) return undefined;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const s = v.toLowerCase().trim();
      if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
      if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    }
    if (typeof v === 'number') return v !== 0;
    return undefined;
  };

  const input: PricingBrainInput = {};
  const activeListingsCount = asInt('activeListingsCount');
  if (activeListingsCount != null) input.activeListingsCount = activeListingsCount;
  const avgProfitMarginPct = asNumber('avgProfitMarginPct');
  if (avgProfitMarginPct != null) input.avgProfitMarginPct = avgProfitMarginPct;
  const avgDaysOnMarket = asNumber('avgDaysOnMarket');
  if (avgDaysOnMarket != null) input.avgDaysOnMarket = avgDaysOnMarket;
  const competitorPriceAvgPct = asNumber('competitorPriceAvgPct');
  if (competitorPriceAvgPct != null) input.competitorPriceAvgPct = competitorPriceAvgPct;
  const priceElasticityScore = asNumber('priceElasticityScore');
  if (priceElasticityScore != null) input.priceElasticityScore = priceElasticityScore;
  const sellThroughRatePct = asNumber('sellThroughRatePct');
  if (sellThroughRatePct != null) input.sellThroughRatePct = sellThroughRatePct;
  const monthlyRevenue = asNumber('monthlyRevenue');
  if (monthlyRevenue != null) input.monthlyRevenue = monthlyRevenue;
  const avgOrderValue = asNumber('avgOrderValue');
  if (avgOrderValue != null) input.avgOrderValue = avgOrderValue;
  const priceWarDetected = asBoolean('priceWarDetected');
  if (priceWarDetected != null) input.priceWarDetected = priceWarDetected;
  const seasonalMultiplier = asNumber('seasonalMultiplier');
  if (seasonalMultiplier != null) input.seasonalMultiplier = seasonalMultiplier;
  const psychologyOptimizedPct = asNumber('psychologyOptimizedPct');
  if (psychologyOptimizedPct != null) input.psychologyOptimizedPct = psychologyOptimizedPct;
  const lastPriceChangePct = asNumber('lastPriceChangePct');
  if (lastPriceChangePct != null) input.lastPriceChangePct = lastPriceChangePct;

  return input;
}

// --- DB state injection (graceful) ---------------------------------------

interface DbDerivedState {
  activeListingsCount?: number;
  sellThroughRatePct?: number;
  psychologyOptimizedPct?: number;
  monthlyRevenue?: number;
  avgOrderValue?: number;
  avgProfitMarginPct?: number;
  avgDaysOnMarket?: number;
}

/**
 * Read from the Listing and Trade tables to derive pricing context.
 *
 * MAPPING (uses only existing schema fields — Listing.price, Listing.firstSeenAt,
 * Listing.contactStatus, Trade.buyPrice, Trade.sellPrice, Trade.buyDate,
 * Trade.sellDate, Trade.buyFees, Trade.sellFees):
 *
 *  - activeListingsCount: count of Listing rows (total scraped listings proxy
 *    for active listings; in a future schema with an `isActive` flag this can
 *    be tightened).
 *  - sellThroughRatePct: count of Trades sold in last 30d / count of Listings
 *    seen in last 30d × 100 (proxy for sell-through).
 *  - psychologyOptimizedPct: count of Listing rows whose `price` ends in 99 or
 *    95 (e.g. 199, 299, 49.95) / total × 100 — a heuristic for psychology
 *    pricing adoption.
 *  - monthlyRevenue: sum of (sellPrice - sellFees) for Trade rows sold in last
 *    30d.
 *  - avgOrderValue: avg of (sellPrice) for Trade rows sold in last 30d.
 *  - avgProfitMarginPct: avg of ((sellPrice - buyPrice - buyFees - sellFees) /
 *    buyPrice × 100) for Trade rows sold in last 30d (skipped when buyPrice is
 *    0 or null).
 *  - avgDaysOnMarket: avg of (sellDate - buyDate in days) for Trade rows sold
 *    in last 30d (skipped when either date is missing).
 *
 * If no sold trades exist in the 30d window OR Listing table is empty,
 * returns null and falls back to defaults. NEVER crashes the endpoint.
 */
async function fetchDbState(): Promise<DbDerivedState | null> {
  try {
    const { db } = await import('@/lib/db');

    const now = new Date();
    const dayMs = 86_400_000;
    const thirtyDaysAgo = new Date(now.getTime() - 30 * dayMs);

    // --- Listing-based metrics ---
    let listingCount = 0;
    let psychologyCount = 0;
    let listingsSeenLast30d = 0;
    try {
      const listings = await db.listing.findMany({
        select: {
          price: true,
          firstSeenAt: true,
        },
      });
      listingCount = listings.length;
      for (const l of listings) {
        if (typeof l.price === 'number' && l.price > 0) {
          const p = l.price;
          // Heuristic: ends in .99/.95/9 or last 2-3 digits are 99/95/49/79
          const lastTwo = Math.round(p) % 100;
          if (lastTwo === 99 || lastTwo === 95 || lastTwo === 49 || lastTwo === 79) {
            psychologyCount += 1;
          }
        }
        if (l.firstSeenAt && new Date(l.firstSeenAt) >= thirtyDaysAgo) {
          listingsSeenLast30d += 1;
        }
      }
    } catch (err: any) {
      logger.warn(
        '/api/ai/brain/pricing',
        'Listing state injection failed — using defaults for listing metrics',
        err,
      );
    }

    // --- Trade-based metrics (last 30d window) ---
    let soldTrades: Array<{
      buyPrice: number;
      sellPrice: number | null;
      buyDate: Date | string | null;
      sellDate: Date | string | null;
      buyFees?: number;
      sellFees?: number;
    }> = [];
    try {
      soldTrades = await db.trade.findMany({
        where: {
          status: 'sold',
          sellDate: { gte: thirtyDaysAgo },
        },
        select: {
          buyPrice: true,
          sellPrice: true,
          buyDate: true,
          sellDate: true,
          buyFees: true,
          sellFees: true,
        },
      });
    } catch (err: any) {
      logger.warn(
        '/api/ai/brain/pricing',
        'Trade state injection failed — using defaults for trade metrics',
        err,
      );
    }

    if (listingCount === 0 && soldTrades.length === 0) {
      return null;
    }

    // --- Compute derived metrics ---
    const activeListingsCount = listingCount > 0 ? listingCount : undefined;

    const sellThroughRatePct =
      listingsSeenLast30d > 0 && soldTrades.length > 0
        ? (soldTrades.length / listingsSeenLast30d) * 100
        : undefined;

    const psychologyOptimizedPct =
      listingCount > 0 ? (psychologyCount / listingCount) * 100 : undefined;

    let monthlyRevenue: number | undefined;
    let avgOrderValue: number | undefined;
    let avgProfitMarginPct: number | undefined;
    let avgDaysOnMarket: number | undefined;

    if (soldTrades.length > 0) {
      const revenueSum = soldTrades.reduce(
        (a, t) =>
          a +
          Math.max(
            0,
            (typeof t.sellPrice === 'number' ? t.sellPrice : 0) -
              (typeof t.sellFees === 'number' ? t.sellFees : 0),
          ),
        0,
      );
      monthlyRevenue = revenueSum;

      const aovSum = soldTrades.reduce(
        (a, t) => a + (typeof t.sellPrice === 'number' ? t.sellPrice : 0),
        0,
      );
      avgOrderValue = aovSum / soldTrades.length;

      const marginSamples: number[] = [];
      for (const t of soldTrades) {
        const buy = typeof t.buyPrice === 'number' ? t.buyPrice : 0;
        const sell = typeof t.sellPrice === 'number' ? t.sellPrice : 0;
        const buyFees = typeof t.buyFees === 'number' ? t.buyFees : 0;
        const sellFees = typeof t.sellFees === 'number' ? t.sellFees : 0;
        if (buy > 0) {
          const margin = ((sell - buy - buyFees - sellFees) / buy) * 100;
          marginSamples.push(margin);
        }
      }
      if (marginSamples.length > 0) {
        avgProfitMarginPct =
          marginSamples.reduce((a, m) => a + m, 0) / marginSamples.length;
      }

      const daySamples: number[] = [];
      for (const t of soldTrades) {
        if (!t.buyDate || !t.sellDate) continue;
        const bd = t.buyDate instanceof Date ? t.buyDate : new Date(t.buyDate);
        const sd = t.sellDate instanceof Date ? t.sellDate : new Date(t.sellDate);
        const days = (sd.getTime() - bd.getTime()) / dayMs;
        if (days >= 0 && days < 3650) {
          daySamples.push(days);
        }
      }
      if (daySamples.length > 0) {
        avgDaysOnMarket = daySamples.reduce((a, d) => a + d, 0) / daySamples.length;
      }
    }

    const round2v = (v: number | undefined): number | undefined =>
      v != null ? Math.round(v * 100) / 100 : undefined;

    return {
      activeListingsCount,
      sellThroughRatePct: round2v(sellThroughRatePct),
      psychologyOptimizedPct: round2v(psychologyOptimizedPct),
      monthlyRevenue: round2v(monthlyRevenue),
      avgOrderValue: round2v(avgOrderValue),
      avgProfitMarginPct: round2v(avgProfitMarginPct),
      avgDaysOnMarket: round2v(avgDaysOnMarket),
    };
  } catch (err: any) {
    logger.warn(
      '/api/ai/brain/pricing',
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
 * slowly (trades are append-only) and the 5-min TTL is short enough that any
 * state drift is acceptable.
 */
function buildCacheKey(input: PricingBrainInput): string {
  const parts: string[] = [];
  parts.push(`alc:${input.activeListingsCount ?? ''}`);
  parts.push(`mgn:${input.avgProfitMarginPct ?? ''}`);
  parts.push(`dom:${input.avgDaysOnMarket ?? ''}`);
  parts.push(`cmp:${input.competitorPriceAvgPct ?? ''}`);
  parts.push(`el:${input.priceElasticityScore ?? ''}`);
  parts.push(`st:${input.sellThroughRatePct ?? ''}`);
  parts.push(`rev:${input.monthlyRevenue ?? ''}`);
  parts.push(`aov:${input.avgOrderValue ?? ''}`);
  parts.push(`pw:${input.priceWarDetected ?? ''}`);
  parts.push(`sm:${input.seasonalMultiplier ?? ''}`);
  parts.push(`po:${input.psychologyOptimizedPct ?? ''}`);
  parts.push(`lpc:${input.lastPriceChangePct ?? ''}`);
  return `pricing-brain:${parts.join('|')}`;
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handlePricingBrain(req);
}

export async function POST(req: NextRequest) {
  return handlePricingBrain(req);
}

async function handlePricingBrain(req: NextRequest) {
  try {
    const userInput = await resolveInputs(req);

    // DB state injection — fills in any missing fields from real DB state.
    // If both DB and user input are present, USER INPUT WINS (user can override).
    const dbState = await fetchDbState();
    const mergedInput: PricingBrainInput = {
      activeListingsCount:
        userInput.activeListingsCount ?? dbState?.activeListingsCount ?? undefined,
      avgProfitMarginPct:
        userInput.avgProfitMarginPct ?? dbState?.avgProfitMarginPct ?? undefined,
      avgDaysOnMarket:
        userInput.avgDaysOnMarket ?? dbState?.avgDaysOnMarket ?? undefined,
      competitorPriceAvgPct: userInput.competitorPriceAvgPct ?? undefined,
      priceElasticityScore: userInput.priceElasticityScore ?? undefined,
      sellThroughRatePct:
        userInput.sellThroughRatePct ?? dbState?.sellThroughRatePct ?? undefined,
      monthlyRevenue: userInput.monthlyRevenue ?? dbState?.monthlyRevenue ?? undefined,
      avgOrderValue: userInput.avgOrderValue ?? dbState?.avgOrderValue ?? undefined,
      priceWarDetected: userInput.priceWarDetected ?? undefined,
      seasonalMultiplier: userInput.seasonalMultiplier ?? undefined,
      psychologyOptimizedPct:
        userInput.psychologyOptimizedPct ?? dbState?.psychologyOptimizedPct ?? undefined,
      lastPriceChangePct: userInput.lastPriceChangePct ?? undefined,
    };

    const cacheKey = buildCacheKey(mergedInput);
    const cached = getCachedAI<PricingBrainResult>(cacheKey);
    if (cached) {
      // Re-stamp cachedAt so the caller sees a fresh "served at" timestamp.
      const served: PricingBrainResult = {
        ...cached,
        cachedAt: Date.now(),
      };
      return NextResponse.json(served);
    }

    const result = pricingBrain(mergedInput);
    setCachedAI(cacheKey, result, BRAIN_CACHE_TTL_MS);

    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/api/ai/brain/pricing', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
