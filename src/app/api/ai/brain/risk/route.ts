// v8.19: Risk Brain — GET+POST /api/ai/brain/risk
//
// Risk Brain is the FIFTH "Brain" layer — a NEW architectural layer ABOVE the
// ~7 risk specialist endpoints (fraud-detection, inventory-risk-assessor,
// portfolio-risk-forecaster, risk-hedging, risk-parity, risk-reward-calculator,
// risk-spread-calculator). Each specialist measures ONE risk dimension
// (concentration, aging, market, liquidity, fraud, hedging). The Risk Brain
// synthesizes 6 risk signals (concentration, aging, liquidity, market, fraud,
// portfolio) into ONE decision:
//   - 3 top risk mitigation actions for today, ranked by
//     riskReductionEUR × confidence
//   - 30d / 90d risk projections (projectedRiskScore + projectedConcentrationPct
//     + projectedAgedPct + recommendedRiskBudget)
//   - overall risk grade (weighted across 6 signals)
//   - one-line summary that names the single biggest risk lever
//
// DIFFERENCES from Profit Brain (v8.15):
//  - Profit Brain reads TRADE HISTORY (monthlyProfits[]) → synthesizes
//    profit-growth signals. Risk Brain reads RISK EXPOSURE (concentration,
//    aged inventory, fraud suspicions, market volatility) → synthesizes
//    risk-mitigation signals.
//  - Profit Brain's projection30d/projection90d are scalars (EUR/mo).
//    Risk Brain's projections are STRUCTURED objects with projectedRiskScore
//    + projectedConcentrationPct + projectedAgedPct + recommendedRiskBudget.
//
// DIFFERENCES from Inventory Brain (v8.16):
//  - Inventory Brain answers "how well is your stock performing as capital?".
//    Risk Brain answers "what could go WRONG, and how do we mitigate it?".
//  - Inventory Brain projects inventory value + aged stock %.
//    Risk Brain projects risk SCORE + concentration % + aged % + risk budget.
//
// DIFFERENCES from Market Brain (v8.17):
//  - Market Brain reads MARKET CONTEXT (active listings, price changes,
//    inquiries, sell-through) → synthesizes market-cycle signals.
//    Risk Brain reads RISK EXPOSURE (concentration, fraud, volatility, aged
//    stock) → synthesizes risk-mitigation signals.
//
// DIFFERENCES from Sourcing Brain (v8.18):
//  - Sourcing Brain reads PER-SOURCE BREAKDOWN (capitalDeployed, monthlyProfit,
//    margin per source) → synthesizes sourcing-allocation signals.
//    Risk Brain reads AGGREGATE RISK EXPOSURE → synthesizes risk-mitigation.
//
// DIFFERENCES from the ~7 risk specialists:
//  - Specialists measure ONE dimension. Brain SYNTHESIZES 6 dimensions.
//  - In v8.19 the Brain computes the 6 signals itself (pure deterministic
//    TypeScript — no AI, no HTTP fan-out). This keeps the Brain fast (<5ms)
//    and fully testable.
//
// DETERMINISTIC (aiUsed: false): no external AI/LLM SDK is called.
// DB-BACKED STATE INJECTION (graceful): if Prisma is available, read from the
// Listing model (fraudSuspicionsCount = listings flagged SUMNJIVO or aiRisk >= 7,
// totalListingsCount = all listings) and Trade model (inventoryValue,
// agedInventoryValue, capitalConcentrationPct, activeSources, monthlyRevenue,
// monthlyProfit, avgDaysToSell). If DB unavailable or empty, falls back to
// sensible defaults — never crashes.
// 5-MIN CACHE: cache key = `risk-brain:${hashOfInputs}`, TTL = 300000 ms.

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getCachedAIWithStats, setCachedAIWithStats } from '@/lib/ai-cache';
// v8.33: Performance metrics — wraps riskBrain() with response-time tracking
import { withPerf, recordPerf } from '@/lib/brain/performance';
import {
  riskBrain,
  type RiskBrainInput,
  type RiskBrainResult,
} from '@/lib/brain/risk';

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
async function resolveInputs(req: NextRequest): Promise<RiskBrainInput> {
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

  const input: RiskBrainInput = {};
  const totalCapitalDeployed = asNumber('totalCapitalDeployed');
  if (totalCapitalDeployed != null) input.totalCapitalDeployed = totalCapitalDeployed;
  const inventoryValue = asNumber('inventoryValue');
  if (inventoryValue != null) input.inventoryValue = inventoryValue;
  const agedInventoryValue = asNumber('agedInventoryValue');
  if (agedInventoryValue != null) input.agedInventoryValue = agedInventoryValue;
  const capitalConcentrationPct = asNumber('capitalConcentrationPct');
  if (capitalConcentrationPct != null) input.capitalConcentrationPct = capitalConcentrationPct;
  const monthlyRevenue = asNumber('monthlyRevenue');
  if (monthlyRevenue != null) input.monthlyRevenue = monthlyRevenue;
  const monthlyProfit = asNumber('monthlyProfit');
  if (monthlyProfit != null) input.monthlyProfit = monthlyProfit;
  const activeSources = asInt('activeSources');
  if (activeSources != null) input.activeSources = activeSources;
  const fraudSuspicionsCount = asInt('fraudSuspicionsCount');
  if (fraudSuspicionsCount != null) input.fraudSuspicionsCount = fraudSuspicionsCount;
  const totalListingsCount = asInt('totalListingsCount');
  if (totalListingsCount != null) input.totalListingsCount = totalListingsCount;
  const avgDaysToSell = asNumber('avgDaysToSell');
  if (avgDaysToSell != null) input.avgDaysToSell = avgDaysToSell;
  const marketVolatilityPct = asNumber('marketVolatilityPct');
  if (marketVolatilityPct != null) input.marketVolatilityPct = marketVolatilityPct;

  return input;
}

// --- DB state injection (graceful) ---------------------------------------

interface DbDerivedState {
  totalCapitalDeployed?: number;
  inventoryValue?: number;
  agedInventoryValue?: number;
  capitalConcentrationPct?: number;
  monthlyRevenue?: number;
  monthlyProfit?: number;
  activeSources?: number;
  fraudSuspicionsCount?: number;
  totalListingsCount?: number;
  avgDaysToSell?: number;
}

/**
 * Read from Listing + Trade tables to derive risk context.
 * Falls back to null on any DB error.
 *
 * Mapping:
 *  - fraudSuspicionsCount: count of Listing where aiVerdict='SUMNJIVO' OR aiRisk >= 7
 *  - totalListingsCount: count of all non-hidden Listing
 *  - inventoryValue: sum(Trade.buyPrice + Trade.buyFees) where status='held'
 *  - agedInventoryValue: same as above, filtered buyDate < 30 days ago
 *  - monthlyRevenue: sum(Trade.sellPrice) where status='sold' AND sellDate >= 30d ago
 *  - monthlyProfit: sum(sellPrice - buyPrice - buyFees - sellFees) for same set
 *  - capitalConcentrationPct: (top buyLocation sum / total) × 100 (grouped by buyLocation)
 *  - activeSources: distinct count of buyLocation with non-empty value
 *  - avgDaysToSell: avg(sellDate - buyDate) for all sold trades with both dates
 *
 * Note: marketVolatilityPct cannot be derived from existing DB tables — falls
 * back to the default (25%) if user did not provide it.
 */
async function fetchDbState(): Promise<DbDerivedState | null> {
  try {
    const { db } = await import('@/lib/db');

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Held trades (current inventory)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        buyLocation: true,
      },
    });

    // Sold trades in last 30 days (for monthly revenue + profit)
    const soldRecent = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: thirtyDaysAgo, not: null },
        sellPrice: { not: null },
      },
      select: {
        buyPrice: true,
        buyDate: true,
        sellPrice: true,
        sellDate: true,
        buyFees: true,
        sellFees: true,
      },
    });

    // All sold trades ever (for avgDaysToSell)
    const soldAll = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null },
        sellPrice: { not: null },
      },
      select: {
        buyPrice: true,
        buyDate: true,
        sellDate: true,
      },
    });

    // Fraud-suspicious listings (aiVerdict='SUMNJIVO' OR aiRisk >= 7)
    const fraudSuspicionsCount = await db.listing.count({
      where: {
        OR: [
          { aiVerdict: 'SUMNJIVO' },
          { aiRisk: { gte: 7 } },
        ],
      },
    });

    // Total listings (exclude hidden — those are out of the active pool)
    const totalListingsCount = await db.listing.count({
      where: { isHidden: false },
    });

    if (
      heldTrades.length === 0 &&
      soldRecent.length === 0 &&
      fraudSuspicionsCount === 0 &&
      totalListingsCount === 0
    ) {
      return null;
    }

    // --- Inventory + aged --------------------------------------------------
    let inventoryValue = 0;
    let agedInventoryValue = 0;
    // Per-source capital buckets for concentration calculation
    const sourceCapital = new Map<string, number>();
    const dayMs = 86_400_000;
    for (const t of heldTrades) {
      const buyPrice = typeof t.buyPrice === 'number' ? t.buyPrice : 0;
      const buyFees = typeof t.buyFees === 'number' ? t.buyFees : 0;
      const cost = buyPrice + buyFees;
      inventoryValue += cost;
      const ageDays = t.buyDate
        ? (now.getTime() - new Date(t.buyDate).getTime()) / dayMs
        : 0;
      if (ageDays > 30) {
        agedInventoryValue += cost;
      }
      // Track by source (buyLocation) — skip empty
      const loc = (t.buyLocation ?? '').trim();
      if (loc) {
        sourceCapital.set(loc, (sourceCapital.get(loc) ?? 0) + cost);
      }
    }

    // --- Monthly revenue + profit (last 30d sold) ---------------------------
    let monthlyRevenue = 0;
    let monthlyProfit = 0;
    for (const t of soldRecent) {
      const buyPrice = typeof t.buyPrice === 'number' ? t.buyPrice : 0;
      const sellPrice = typeof t.sellPrice === 'number' ? t.sellPrice : 0;
      const buyFees = typeof t.buyFees === 'number' ? t.buyFees : 0;
      const sellFees = typeof t.sellFees === 'number' ? t.sellFees : 0;
      monthlyRevenue += sellPrice;
      monthlyProfit += sellPrice - buyPrice - buyFees - sellFees;
    }

    // --- avgDaysToSell -----------------------------------------------------
    let daysSum = 0;
    let daysCount = 0;
    for (const t of soldAll) {
      if (t.buyDate && t.sellDate) {
        const days =
          (new Date(t.sellDate).getTime() - new Date(t.buyDate).getTime()) /
          dayMs;
        if (days >= 0 && days < 365) {
          daysSum += days;
          daysCount += 1;
        }
      }
    }
    const avgDaysToSell = daysCount > 0 ? daysSum / daysCount : undefined;

    // --- capitalConcentrationPct (top source / total) ---------------------
    let capitalConcentrationPct: number | undefined;
    if (inventoryValue > 0 && sourceCapital.size > 0) {
      let maxCap = 0;
      for (const cap of sourceCapital.values()) {
        if (cap > maxCap) maxCap = cap;
      }
      capitalConcentrationPct = (maxCap / inventoryValue) * 100;
    }
    const activeSources = sourceCapital.size > 0 ? sourceCapital.size : undefined;

    const totalCapitalDeployed = inventoryValue > 0 ? inventoryValue : undefined;

    return {
      totalCapitalDeployed:
        totalCapitalDeployed != null
          ? Math.round(totalCapitalDeployed * 100) / 100
          : undefined,
      inventoryValue: Math.round(inventoryValue * 100) / 100,
      agedInventoryValue: Math.round(agedInventoryValue * 100) / 100,
      capitalConcentrationPct:
        capitalConcentrationPct != null
          ? Math.round(capitalConcentrationPct * 100) / 100
          : undefined,
      monthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
      monthlyProfit: Math.round(monthlyProfit * 100) / 100,
      activeSources,
      fraudSuspicionsCount,
      totalListingsCount,
      avgDaysToSell:
        avgDaysToSell != null ? Math.round(avgDaysToSell * 100) / 100 : undefined,
    };
  } catch (err: any) {
    logger.warn(
      '/api/ai/brain/risk',
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
function buildCacheKey(input: RiskBrainInput): string {
  const parts: string[] = [];
  parts.push(`tcd:${input.totalCapitalDeployed ?? ''}`);
  parts.push(`iv:${input.inventoryValue ?? ''}`);
  parts.push(`aiv:${input.agedInventoryValue ?? ''}`);
  parts.push(`ccp:${input.capitalConcentrationPct ?? ''}`);
  parts.push(`mr:${input.monthlyRevenue ?? ''}`);
  parts.push(`mp:${input.monthlyProfit ?? ''}`);
  parts.push(`as:${input.activeSources ?? ''}`);
  parts.push(`fsc:${input.fraudSuspicionsCount ?? ''}`);
  parts.push(`tlc:${input.totalListingsCount ?? ''}`);
  parts.push(`ats:${input.avgDaysToSell ?? ''}`);
  parts.push(`mvp:${input.marketVolatilityPct ?? ''}`);
  // v8.33: Return ONLY the suffix — namespace prefix is now prepended by the
  // stats-tracked cache wrappers. Actual stored key unchanged.
  return parts.join('|');
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleRiskBrain(req);
}

export async function POST(req: NextRequest) {
  return handleRiskBrain(req);
}

async function handleRiskBrain(req: NextRequest) {
  try {
    const userInput = await resolveInputs(req);

    // DB state injection — fills in any missing fields from real DB state.
    // If both DB and user input are present, USER INPUT WINS (user can override).
    const dbState = await fetchDbState();
    const mergedInput: RiskBrainInput = {
      totalCapitalDeployed:
        userInput.totalCapitalDeployed ?? dbState?.totalCapitalDeployed ?? undefined,
      inventoryValue: userInput.inventoryValue ?? dbState?.inventoryValue ?? undefined,
      agedInventoryValue:
        userInput.agedInventoryValue ?? dbState?.agedInventoryValue ?? undefined,
      capitalConcentrationPct:
        userInput.capitalConcentrationPct ?? dbState?.capitalConcentrationPct ?? undefined,
      monthlyRevenue: userInput.monthlyRevenue ?? dbState?.monthlyRevenue ?? undefined,
      monthlyProfit: userInput.monthlyProfit ?? dbState?.monthlyProfit ?? undefined,
      activeSources: userInput.activeSources ?? dbState?.activeSources ?? undefined,
      fraudSuspicionsCount:
        userInput.fraudSuspicionsCount ?? dbState?.fraudSuspicionsCount ?? undefined,
      totalListingsCount:
        userInput.totalListingsCount ?? dbState?.totalListingsCount ?? undefined,
      avgDaysToSell: userInput.avgDaysToSell ?? dbState?.avgDaysToSell ?? undefined,
      marketVolatilityPct: userInput.marketVolatilityPct ?? undefined,
    };

    const cacheKey = buildCacheKey(mergedInput);
    // v8.33: Use cache stats-tracked variants. Namespace = 'risk-brain'.
    const cacheHitStart = Date.now();
    const cached = getCachedAIWithStats<RiskBrainResult>('risk-brain', cacheKey);
    if (cached) {
      // v8.33: Record a perf entry for the cache-hit path (fast — just lookup).
      recordPerf('risk', Date.now() - cacheHitStart, true);
      // Re-stamp cachedAt so the caller sees a fresh "served at" timestamp.
      const served: RiskBrainResult = {
        ...cached,
        cachedAt: Date.now(),
      };
      return NextResponse.json(served);
    }

    // v8.33: Wrap riskBrain() call with perf tracking. cached=false (slow path).
    const result = await withPerf('risk', async () => riskBrain(mergedInput), false);
    setCachedAIWithStats('risk-brain', cacheKey, result, BRAIN_CACHE_TTL_MS);

    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/api/ai/brain/risk', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
