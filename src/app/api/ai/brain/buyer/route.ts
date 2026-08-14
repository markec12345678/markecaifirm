// v8.20: Buyer Brain — GET+POST /api/ai/brain/buyer
//
// Buyer Brain is the SIXTH "Brain" layer — a NEW architectural layer ABOVE the
// ~51 buyer specialist endpoints (buyer-intent, buyer-clv-predictor,
// buyer-churn-predictor-v2, buyer-loyalty-predictor-v2, buyer-conversion-
// predictor, buyer-engagement-optimizer, buyer-journey-mapper,
// buyer-acquisition-cost-optimizer, buyer-behavior-pattern-detector,
// buyer-behavior-predictor, ...). Each specialist measures ONE buyer
// dimension (intent, conversion, churn, LTV, loyalty, engagement). The Buyer
// Brain synthesizes 6 buyer signals (intent, conversion, retention,
// lifetimeValue, loyalty, engagement) into ONE decision:
//   - 3 top buyer cultivation actions for today, ranked by
//     upliftEURPerMonth × confidence
//   - 30d / 90d buyer projections (projectedActiveBuyers + projectedLTV +
//     projectedChurnRatePct + recommendedOutreachCount)
//   - overall buyer grade (weighted across 6 signals)
//   - one-line summary that names the single biggest buyer lever
//
// DIFFERENCES from Profit Brain (v8.15):
//  - Profit Brain reads TRADE HISTORY (monthlyProfits[]) → synthesizes
//    profit-growth signals. Buyer Brain reads BUYER CONTEXT (active buyers,
//    churn, LTV, repeat rate, engagement) → synthesizes buyer-cultivation
//    signals.
//  - Profit Brain's projection30d/projection90d are scalars (EUR/mo).
//    Buyer Brain's projections are STRUCTURED objects with
//    projectedActiveBuyers + projectedLTV + projectedChurnRatePct +
//    recommendedOutreachCount.
//
// DIFFERENCES from Inventory Brain (v8.16):
//  - Inventory Brain answers "how well is your stock performing as capital?".
//    Buyer Brain answers "how well are you cultivating your buyer base?".
//  - Inventory Brain projects inventory value + aged stock %.
//    Buyer Brain projects active buyers + LTV + churn rate + outreach count.
//
// DIFFERENCES from Market Brain (v8.17):
//  - Market Brain reads MARKET CONTEXT → synthesizes market-cycle signals.
//    Buyer Brain reads BUYER CONTEXT → synthesizes buyer-cultivation signals.
//
// DIFFERENCES from Sourcing Brain (v8.18):
//  - Sourcing Brain reads PER-SOURCE BREAKDOWN → synthesizes sourcing signals.
//    Buyer Brain reads AGGREGATE BUYER CONTEXT → synthesizes buyer signals.
//
// DIFFERENCES from Risk Brain (v8.19):
//  - Risk Brain reads RISK EXPOSURE → synthesizes risk-mitigation signals.
//    Buyer Brain reads BUYER CONTEXT → synthesizes buyer-cultivation signals.
//
// DIFFERENCES from the ~51 buyer specialists:
//  - Specialists measure ONE dimension. Brain SYNTHESIZES 6 dimensions.
//  - In v8.20 the Brain computes the 6 signals itself (pure deterministic
//    TypeScript — no AI, no HTTP fan-out). This keeps the Brain fast (<5ms)
//    and fully testable.
//
// DETERMINISTIC (aiUsed: false): no external AI/LLM SDK is called.
// DB-BACKED STATE INJECTION (graceful): if Prisma is available AND a Buyer
// model exists in the schema, read from it (totalBuyers = count, activeBuyers
// = count where lastPurchaseAt >= 30d ago, newBuyers = count where
// createdAt >= 30d ago, churnedBuyers = count where lastPurchaseAt between
// 30d-60d ago, highValueBuyers = count where LTV > 500, avgBuyerLifetimeValue
// = avg of LTV across all buyers, avgPurchaseFrequency = avg of purchaseCount,
// repeatBuyerRatePct = count where purchaseCount >= 2 / total × 100,
// inquiriesConvertedPct = avg of inquiryToSaleRate if field exists,
// avgEngagementScore = avg of engagementScore if field exists). If Buyer
// model does not exist (currently does NOT exist in prisma/schema.prisma) —
// falls back to sensible defaults. NEVER crashes the endpoint.
// 5-MIN CACHE: cache key = `buyer-brain:${hashOfInputs}`, TTL = 300000 ms.

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getCachedAIWithStats, setCachedAIWithStats } from '@/lib/ai-cache';
// v8.33: Performance metrics — wraps buyerBrain() with response-time tracking
import { withPerf, recordPerf } from '@/lib/brain/performance';
import {
  buyerBrain,
  type BuyerBrainInput,
  type BuyerBrainResult,
} from '@/lib/brain/buyer';

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
async function resolveInputs(req: NextRequest): Promise<BuyerBrainInput> {
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

  const input: BuyerBrainInput = {};
  const totalBuyers = asInt('totalBuyers');
  if (totalBuyers != null) input.totalBuyers = totalBuyers;
  const activeBuyersLast30d = asInt('activeBuyersLast30d');
  if (activeBuyersLast30d != null) input.activeBuyersLast30d = activeBuyersLast30d;
  const newBuyersLast30d = asInt('newBuyersLast30d');
  if (newBuyersLast30d != null) input.newBuyersLast30d = newBuyersLast30d;
  const churnedBuyersLast30d = asInt('churnedBuyersLast30d');
  if (churnedBuyersLast30d != null) input.churnedBuyersLast30d = churnedBuyersLast30d;
  const avgBuyerLifetimeValue = asNumber('avgBuyerLifetimeValue');
  if (avgBuyerLifetimeValue != null) input.avgBuyerLifetimeValue = avgBuyerLifetimeValue;
  const avgPurchaseFrequency = asNumber('avgPurchaseFrequency');
  if (avgPurchaseFrequency != null) input.avgPurchaseFrequency = avgPurchaseFrequency;
  const avgOrderValue = asNumber('avgOrderValue');
  if (avgOrderValue != null) input.avgOrderValue = avgOrderValue;
  const repeatBuyerRatePct = asNumber('repeatBuyerRatePct');
  if (repeatBuyerRatePct != null) input.repeatBuyerRatePct = repeatBuyerRatePct;
  const inquiriesConvertedPct = asNumber('inquiriesConvertedPct');
  if (inquiriesConvertedPct != null) input.inquiriesConvertedPct = inquiriesConvertedPct;
  const avgEngagementScore = asNumber('avgEngagementScore');
  if (avgEngagementScore != null) input.avgEngagementScore = avgEngagementScore;
  const highValueBuyersCount = asInt('highValueBuyersCount');
  if (highValueBuyersCount != null) input.highValueBuyersCount = highValueBuyersCount;

  return input;
}

// --- DB state injection (graceful) ---------------------------------------

interface DbDerivedState {
  totalBuyers?: number;
  activeBuyersLast30d?: number;
  newBuyersLast30d?: number;
  churnedBuyersLast30d?: number;
  avgBuyerLifetimeValue?: number;
  avgPurchaseFrequency?: number;
  avgOrderValue?: number;
  repeatBuyerRatePct?: number;
  inquiriesConvertedPct?: number;
  avgEngagementScore?: number;
  highValueBuyersCount?: number;
}

/**
 * Read from a `Buyer` model if it exists in Prisma schema.
 *
 * IMPORTANT: The `Buyer` model does NOT currently exist in
 * prisma/schema.prisma. This function gracefully falls back to null on any
 * error (missing model, missing field, DB unavailable). Once a Buyer model is
 * added in a future version, this function will start deriving state from it
 * automatically — no code changes needed here.
 *
 * Mapping (assumed Buyer schema fields):
 *  - totalBuyers: count of all Buyer rows
 *  - activeBuyersLast30d: count where lastPurchaseAt >= 30d ago
 *  - newBuyersLast30d: count where createdAt >= 30d ago
 *  - churnedBuyersLast30d: count where lastPurchaseAt in [60d, 30d) ago
 *  - highValueBuyersCount: count where LTV > 500 (field name: lifetimeValue)
 *  - avgBuyerLifetimeValue: avg of lifetimeValue across all buyers
 *  - avgPurchaseFrequency: avg of purchaseCount field
 *  - avgOrderValue: avg of avgOrderValue field
 *  - repeatBuyerRatePct: count where purchaseCount >= 2 / total × 100
 *  - inquiriesConvertedPct: avg of inquiryToSaleRate field (if exists)
 *  - avgEngagementScore: avg of engagementScore field (if exists)
 *
 * Any field that doesn't exist on the Buyer model is silently skipped
 * (graceful degradation). All DB access wrapped in try/catch + logger.warn —
 * NEVER crashes the endpoint.
 */
async function fetchDbState(): Promise<DbDerivedState | null> {
  try {
    const { db } = await import('@/lib/db');

    // Guard: Buyer model may not exist in current Prisma schema.
    // `db.buyer` will be `undefined` if the model is missing.
    const dbAny = db as unknown as Record<string, unknown>;
    const buyerModel = dbAny.buyer;
    if (!buyerModel || typeof (buyerModel as any).findMany !== 'function') {
      return null;
    }

    const buyers: any[] = await (buyerModel as any).findMany({
      select: {
        createdAt: true,
        lastPurchaseAt: true,
        lifetimeValue: true,
        purchaseCount: true,
        avgOrderValue: true,
        inquiryToSaleRate: true,
        engagementScore: true,
      },
    });

    if (!Array.isArray(buyers) || buyers.length === 0) {
      return null;
    }

    const now = new Date();
    const dayMs = 86_400_000;
    const thirtyDaysAgo = new Date(now.getTime() - 30 * dayMs);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * dayMs);

    let activeBuyersLast30d = 0;
    let newBuyersLast30d = 0;
    let churnedBuyersLast30d = 0;
    let highValueBuyersCount = 0;
    let repeatBuyersCount = 0;
    let ltvSum = 0;
    let ltvCount = 0;
    let purchaseCountSum = 0;
    let purchaseCountNonNull = 0;
    let avgOrderValueSum = 0;
    let avgOrderValueCount = 0;
    let inquiryToSaleRateSum = 0;
    let inquiryToSaleRateCount = 0;
    let engagementScoreSum = 0;
    let engagementScoreCount = 0;

    for (const b of buyers) {
      // lastPurchaseAt — for active / churned calculations
      const lastPurchaseAt =
        typeof b.lastPurchaseAt === 'string' || b.lastPurchaseAt instanceof Date
          ? new Date(b.lastPurchaseAt)
          : null;
      if (lastPurchaseAt) {
        if (lastPurchaseAt >= thirtyDaysAgo) {
          activeBuyersLast30d += 1;
        } else if (lastPurchaseAt >= sixtyDaysAgo && lastPurchaseAt < thirtyDaysAgo) {
          // Previously active (60d-30d ago), now churned (no purchase in 30d)
          churnedBuyersLast30d += 1;
        }
      }

      // createdAt — for new buyers
      const createdAt =
        typeof b.createdAt === 'string' || b.createdAt instanceof Date
          ? new Date(b.createdAt)
          : null;
      if (createdAt && createdAt >= thirtyDaysAgo) {
        newBuyersLast30d += 1;
      }

      // lifetimeValue — for LTV + highValueBuyers
      const ltv = typeof b.lifetimeValue === 'number' ? b.lifetimeValue : null;
      if (ltv != null) {
        ltvSum += ltv;
        ltvCount += 1;
        if (ltv > 500) {
          highValueBuyersCount += 1;
        }
      }

      // purchaseCount — for repeat rate + avg frequency
      const purchaseCount = typeof b.purchaseCount === 'number' ? b.purchaseCount : null;
      if (purchaseCount != null) {
        purchaseCountSum += purchaseCount;
        purchaseCountNonNull += 1;
        if (purchaseCount >= 2) {
          repeatBuyersCount += 1;
        }
      }

      // avgOrderValue
      if (typeof b.avgOrderValue === 'number') {
        avgOrderValueSum += b.avgOrderValue;
        avgOrderValueCount += 1;
      }

      // inquiryToSaleRate (optional field)
      if (typeof b.inquiryToSaleRate === 'number') {
        inquiryToSaleRateSum += b.inquiryToSaleRate;
        inquiryToSaleRateCount += 1;
      }

      // engagementScore (optional field)
      if (typeof b.engagementScore === 'number') {
        engagementScoreSum += b.engagementScore;
        engagementScoreCount += 1;
      }
    }

    const totalBuyers = buyers.length;
    const avgBuyerLifetimeValue = ltvCount > 0 ? ltvSum / ltvCount : undefined;
    const avgPurchaseFrequency =
      purchaseCountNonNull > 0 ? purchaseCountSum / purchaseCountNonNull : undefined;
    const avgOrderValue =
      avgOrderValueCount > 0 ? avgOrderValueSum / avgOrderValueCount : undefined;
    const repeatBuyerRatePct =
      totalBuyers > 0 && purchaseCountNonNull > 0
        ? (repeatBuyersCount / totalBuyers) * 100
        : undefined;
    const inquiriesConvertedPct =
      inquiryToSaleRateCount > 0 ? inquiryToSaleRateSum / inquiryToSaleRateCount : undefined;
    const avgEngagementScore =
      engagementScoreCount > 0 ? engagementScoreSum / engagementScoreCount : undefined;

    const round2v = (v: number | undefined): number | undefined =>
      v != null ? Math.round(v * 100) / 100 : undefined;

    return {
      totalBuyers,
      activeBuyersLast30d,
      newBuyersLast30d,
      churnedBuyersLast30d,
      highValueBuyersCount,
      avgBuyerLifetimeValue: round2v(avgBuyerLifetimeValue),
      avgPurchaseFrequency: round2v(avgPurchaseFrequency),
      avgOrderValue: round2v(avgOrderValue),
      repeatBuyerRatePct: round2v(repeatBuyerRatePct),
      inquiriesConvertedPct: round2v(inquiriesConvertedPct),
      avgEngagementScore: round2v(avgEngagementScore),
    };
  } catch (err: any) {
    logger.warn(
      '/api/ai/brain/buyer',
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
 * slowly and the 5-min TTL is short enough that any state drift is acceptable.
 */
function buildCacheKey(input: BuyerBrainInput): string {
  const parts: string[] = [];
  parts.push(`tb:${input.totalBuyers ?? ''}`);
  parts.push(`ab:${input.activeBuyersLast30d ?? ''}`);
  parts.push(`nb:${input.newBuyersLast30d ?? ''}`);
  parts.push(`cb:${input.churnedBuyersLast30d ?? ''}`);
  parts.push(`ltv:${input.avgBuyerLifetimeValue ?? ''}`);
  parts.push(`pf:${input.avgPurchaseFrequency ?? ''}`);
  parts.push(`aov:${input.avgOrderValue ?? ''}`);
  parts.push(`rbr:${input.repeatBuyerRatePct ?? ''}`);
  parts.push(`ic:${input.inquiriesConvertedPct ?? ''}`);
  parts.push(`es:${input.avgEngagementScore ?? ''}`);
  parts.push(`hv:${input.highValueBuyersCount ?? ''}`);
  // v8.33: Return ONLY the suffix — namespace prefix is now prepended by the
  // stats-tracked cache wrappers. Actual stored key unchanged.
  return parts.join('|');
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleBuyerBrain(req);
}

export async function POST(req: NextRequest) {
  return handleBuyerBrain(req);
}

async function handleBuyerBrain(req: NextRequest) {
  try {
    const userInput = await resolveInputs(req);

    // DB state injection — fills in any missing fields from real DB state.
    // If both DB and user input are present, USER INPUT WINS (user can override).
    const dbState = await fetchDbState();
    const mergedInput: BuyerBrainInput = {
      totalBuyers: userInput.totalBuyers ?? dbState?.totalBuyers ?? undefined,
      activeBuyersLast30d:
        userInput.activeBuyersLast30d ?? dbState?.activeBuyersLast30d ?? undefined,
      newBuyersLast30d: userInput.newBuyersLast30d ?? dbState?.newBuyersLast30d ?? undefined,
      churnedBuyersLast30d:
        userInput.churnedBuyersLast30d ?? dbState?.churnedBuyersLast30d ?? undefined,
      avgBuyerLifetimeValue:
        userInput.avgBuyerLifetimeValue ?? dbState?.avgBuyerLifetimeValue ?? undefined,
      avgPurchaseFrequency:
        userInput.avgPurchaseFrequency ?? dbState?.avgPurchaseFrequency ?? undefined,
      avgOrderValue: userInput.avgOrderValue ?? dbState?.avgOrderValue ?? undefined,
      repeatBuyerRatePct:
        userInput.repeatBuyerRatePct ?? dbState?.repeatBuyerRatePct ?? undefined,
      inquiriesConvertedPct:
        userInput.inquiriesConvertedPct ?? dbState?.inquiriesConvertedPct ?? undefined,
      avgEngagementScore:
        userInput.avgEngagementScore ?? dbState?.avgEngagementScore ?? undefined,
      highValueBuyersCount:
        userInput.highValueBuyersCount ?? dbState?.highValueBuyersCount ?? undefined,
    };

    const cacheKey = buildCacheKey(mergedInput);
    // v8.33: Use cache stats-tracked variants. Namespace = 'buyer-brain'.
    const cacheHitStart = Date.now();
    const cached = getCachedAIWithStats<BuyerBrainResult>('buyer-brain', cacheKey);
    if (cached) {
      // v8.33: Record a perf entry for the cache-hit path (fast — just lookup).
      recordPerf('buyer', Date.now() - cacheHitStart, true);
      // Re-stamp cachedAt so the caller sees a fresh "served at" timestamp.
      const served: BuyerBrainResult = {
        ...cached,
        cachedAt: Date.now(),
      };
      return NextResponse.json(served);
    }

    // v8.33: Wrap buyerBrain() call with perf tracking. cached=false (slow path).
    const result = await withPerf('buyer', async () => buyerBrain(mergedInput), false);
    setCachedAIWithStats('buyer-brain', cacheKey, result, BRAIN_CACHE_TTL_MS);

    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/api/ai/brain/buyer', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
