// v8.16 / v8.95.2-a-refactor: Inventory Brain — GET+POST /api/ai/brain/inventory
//
// Inventory Brain is the SECOND "Brain" layer — a NEW architectural layer
// ABOVE the 72 inventory specialist endpoints (inventory-aging,
// inventory-turnover-*, inventory-yield-*, inventory-capital-efficiency-*,
// inventory-liquidation-*, inventory-health-*, ...). Each specialist measures
// ONE inventory dimension. The Inventory Brain synthesizes 6 inventory signals
// (turnover, aging, yield, capitalEfficiency, liquidation, health) into ONE
// decision:
//   - 3 top actions for today, ranked by expectedUpliftEUR × confidence
//   - 30d / 90d inventory projections (recommendedItemsToSell/Buy,
//     projectedInventoryValue, projectedAgedPct, projectedTurnoverRate)
//   - overall inventory grade (weighted across 6 signals)
//   - one-line summary that names the single biggest lever
//
// DIFFERENCES from Profit Brain (v8.15):
//  - Profit Brain reads TRADE HISTORY (monthlyProfits[]) → synthesizes
//    profit-growth signals. Inventory Brain reads INVENTORY STATE (itemCount,
//    agedItemsCount, capitalDeployed) → synthesizes inventory-health signals.
//  - Profit Brain's projection30d/projection90d are scalars (EUR/mo).
//    Inventory Brain's projections are STRUCTURED objects with multiple
//    fields (recommendedItemsToSell/Buy, projectedInventoryValue,
//    projectedAgedPct, projectedTurnoverRate) — because inventory
//    optimization is multi-dimensional (volume + composition + capital +
//    aged stock).
//
// DIFFERENCES from the 72 inventory specialists:
//  - Specialists measure ONE dimension. Brain SYNTHESIZES 6 dimensions.
//  - In v8.16 the Brain computes the 6 signals itself (pure deterministic
//    TypeScript — no AI, no HTTP fan-out). This keeps the Brain fast (<5ms)
//    and fully testable.
//
// DETERMINISTIC (aiUsed: false): no external AI/LLM SDK is called.
// DB-BACKED STATE INJECTION (graceful): if Prisma is available, fetch HELD
// trades (current inventory) + SOLD trades (last 30d) to derive itemCount,
// totalInventoryValue, agedItemsCount, agedItemsValue, capitalDeployed,
// monthlySalesCount, monthlyRevenue, avgProfitMarginPct, avgDaysToSell. If DB
// unavailable or no trades, falls back to sensible defaults — never crashes.
// 5-MIN CACHE: cache key = `inventory-brain:${hashOfInputs}`, TTL = 300000 ms.
//
// Refaktoriran z withAiRoute helperjem (v8.95.2-a) + enforceBudget guard
// (non-breaking — endpoint ne kliče AI direktno, ampak je konsistentno z
// vsemi v8.94.x migracijami).

import type { NextRequest } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { getCachedAIWithStats, setCachedAIWithStats } from '@/lib/ai-cache';
// v8.33: Performance metrics — wraps inventoryBrain() with response-time tracking
import { withPerf, recordPerf } from '@/lib/brain/performance';
import {
  inventoryBrain,
  type InventoryBrainInput,
  type InventoryBrainResult,
} from '@/lib/brain/inventory';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Cache TTL -----------------------------------------------------------
const BRAIN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// --- Input resolution ----------------------------------------------------

/**
 * Parse inputs from BOTH query string (GET) and POST body. Body takes
 * precedence over query (POST is more explicit intent).
 */
async function resolveInputs(req: NextRequest): Promise<InventoryBrainInput> {
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

  const input: InventoryBrainInput = {};
  const itemCount = asNumber('itemCount');
  if (itemCount != null) input.itemCount = itemCount;
  const totalInventoryValue = asNumber('totalInventoryValue');
  if (totalInventoryValue != null) input.totalInventoryValue = totalInventoryValue;
  const avgDaysToSell = asNumber('avgDaysToSell');
  if (avgDaysToSell != null) input.avgDaysToSell = avgDaysToSell;
  const agedItemsCount = asNumber('agedItemsCount');
  if (agedItemsCount != null) input.agedItemsCount = agedItemsCount;
  const agedItemsValue = asNumber('agedItemsValue');
  if (agedItemsValue != null) input.agedItemsValue = agedItemsValue;
  const avgProfitMarginPct = asNumber('avgProfitMarginPct');
  if (avgProfitMarginPct != null) input.avgProfitMarginPct = avgProfitMarginPct;
  const capitalDeployed = asNumber('capitalDeployed');
  if (capitalDeployed != null) input.capitalDeployed = capitalDeployed;
  const monthlySalesCount = asNumber('monthlySalesCount');
  if (monthlySalesCount != null) input.monthlySalesCount = monthlySalesCount;
  const monthlyRevenue = asNumber('monthlyRevenue');
  if (monthlyRevenue != null) input.monthlyRevenue = monthlyRevenue;
  return input;
}

// --- DB state injection (graceful) ---------------------------------------

interface DbDerivedState {
  itemCount: number;
  totalInventoryValue: number;
  avgDaysToSell: number;
  agedItemsCount: number;
  agedItemsValue: number;
  avgProfitMarginPct: number;
  capitalDeployed: number;
  monthlySalesCount: number;
  monthlyRevenue: number;
}

/**
 * Fetch HELD trades (current inventory) + SOLD trades (last 30d) to derive
 * all 9 InventoryBrainInput fields. Wrapped in try/catch — never throws.
 * Returns null if DB unavailable or no usable data found.
 *
 * v8.95.2-a: db + logger sta parameterja (prej modul-level uvoza +
 * dynamic import) — passed-in iz ctx.db/ctx.logger v withAiRoute handler-ju.
 */
async function fetchDbState(
  db: AiRouteContext['db'],
  logger: AiRouteContext['logger'],
): Promise<DbDerivedState | null> {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // HELD trades = current inventory
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        buyPrice: true,
        buyFees: true,
        buyDate: true,
      },
    });

    // SOLD trades in last 30 days (for monthly sales + revenue)
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
      },
    });

    // SOLD trades ever (for avgDaysToSell + avgProfitMarginPct calibration)
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
        sellPrice: true,
      },
    });

    if (heldTrades.length === 0 && soldRecent.length === 0) {
      return null;
    }

    // --- Aggregate HELD inventory state ------------------------------------
    let itemCount = 0;
    let totalInventoryValue = 0;
    let agedItemsCount = 0;
    let agedItemsValue = 0;
    for (const t of heldTrades) {
      const buyPrice = typeof t.buyPrice === 'number' ? t.buyPrice : 0;
      const buyFees = typeof t.buyFees === 'number' ? t.buyFees : 0;
      const cost = buyPrice + buyFees;
      itemCount += 1;
      totalInventoryValue += cost;
      const ageDays = t.buyDate
        ? (now.getTime() - new Date(t.buyDate).getTime()) / 86_400_000
        : 0;
      if (ageDays > 30) {
        agedItemsCount += 1;
        agedItemsValue += cost;
      }
    }

    // --- Aggregate SOLD-in-last-30d state ----------------------------------
    let monthlySalesCount = 0;
    let monthlyRevenue = 0;
    for (const t of soldRecent) {
      const sellPrice = typeof t.sellPrice === 'number' ? t.sellPrice : 0;
      monthlySalesCount += 1;
      monthlyRevenue += sellPrice;
    }

    // --- avgProfitMarginPct over all sold trades (more stable than 30d) --
    let marginSum = 0;
    let marginCount = 0;
    for (const t of soldAll) {
      const buyPrice = typeof t.buyPrice === 'number' ? t.buyPrice : 0;
      const sellPrice = typeof t.sellPrice === 'number' ? t.sellPrice : 0;
      if (buyPrice > 0) {
        marginSum += ((sellPrice - buyPrice) / buyPrice) * 100;
        marginCount += 1;
      }
    }
    const avgProfitMarginPct = marginCount > 0 ? marginSum / marginCount : 25;

    // --- avgDaysToSell over all sold trades --------------------------------
    let daysSum = 0;
    let daysCount = 0;
    for (const t of soldAll) {
      if (t.buyDate && t.sellDate) {
        const days =
          (new Date(t.sellDate).getTime() - new Date(t.buyDate).getTime()) /
          86_400_000;
        if (days >= 0 && days < 365) {
          daysSum += days;
          daysCount += 1;
        }
      }
    }
    const avgDaysToSell = daysCount > 0 ? daysSum / daysCount : 14;

    // capitalDeployed = current inventory value (capital currently tied up)
    const capitalDeployed = totalInventoryValue;

    return {
      itemCount,
      totalInventoryValue: Math.round(totalInventoryValue * 100) / 100,
      avgDaysToSell: Math.round(avgDaysToSell * 100) / 100,
      agedItemsCount,
      agedItemsValue: Math.round(agedItemsValue * 100) / 100,
      avgProfitMarginPct: Math.round(avgProfitMarginPct * 100) / 100,
      capitalDeployed: Math.round(capitalDeployed * 100) / 100,
      monthlySalesCount,
      monthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
    };
  } catch (err: any) {
    logger.warn(
      '/api/ai/brain/inventory',
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
 * slowly (trade history is append-only) and the 5-min TTL is short enough
 * that any state drift is acceptable.
 */
function buildCacheKey(input: InventoryBrainInput): string {
  const parts: string[] = [];
  parts.push(`ic:${input.itemCount ?? ''}`);
  parts.push(`tiv:${input.totalInventoryValue ?? ''}`);
  parts.push(`ats:${input.avgDaysToSell ?? ''}`);
  parts.push(`aic:${input.agedItemsCount ?? ''}`);
  parts.push(`aiv:${input.agedItemsValue ?? ''}`);
  parts.push(`apm:${input.avgProfitMarginPct ?? ''}`);
  parts.push(`cd:${input.capitalDeployed ?? ''}`);
  parts.push(`msc:${input.monthlySalesCount ?? ''}`);
  parts.push(`mr:${input.monthlyRevenue ?? ''}`);
  // v8.33: Return ONLY the suffix — namespace prefix is now prepended by the
  // stats-tracked cache wrappers. Actual stored key unchanged.
  return parts.join('|');
}

// --- Handler -------------------------------------------------------------

const inventoryBrainHandler = withAiRoute<InventoryBrainInput>({
  endpoint: '/api/ai/brain/inventory',
  maxDuration: 60,
  enforceBudget: true, // v8.95.2-a: budget guard + avtomatski recordAiCall
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  // GET+POST — parse iz query string-a (GET) ali POST body-ja (body
  // precedence nad query). Vsa polja so optional — InventoryBrainInput
  // degrade gracefully z defaults kadar katerokoli polje manjka.
  parseBody: async (req) => resolveInputs(req),

  // Brez validateInput — vsa polja so optional

  handler: async (userInput, ctx: AiRouteContext) => {
    const { db, logger } = ctx;

    // DB state injection — fills in any missing fields from real trade state.
    // If both DB and user input are present, USER INPUT WINS (user can override).
    const dbState = await fetchDbState(db, logger);
    const mergedInput: InventoryBrainInput = {
      itemCount: userInput.itemCount ?? dbState?.itemCount ?? undefined,
      totalInventoryValue:
        userInput.totalInventoryValue ?? dbState?.totalInventoryValue ?? undefined,
      avgDaysToSell: userInput.avgDaysToSell ?? dbState?.avgDaysToSell ?? undefined,
      agedItemsCount: userInput.agedItemsCount ?? dbState?.agedItemsCount ?? undefined,
      agedItemsValue: userInput.agedItemsValue ?? dbState?.agedItemsValue ?? undefined,
      avgProfitMarginPct:
        userInput.avgProfitMarginPct ?? dbState?.avgProfitMarginPct ?? undefined,
      capitalDeployed: userInput.capitalDeployed ?? dbState?.capitalDeployed ?? undefined,
      monthlySalesCount:
        userInput.monthlySalesCount ?? dbState?.monthlySalesCount ?? undefined,
      monthlyRevenue: userInput.monthlyRevenue ?? dbState?.monthlyRevenue ?? undefined,
    };

    const cacheKey = buildCacheKey(mergedInput);
    // v8.33: Use cache stats-tracked variants. Namespace = 'inventory-brain'.
    const cacheHitStart = Date.now();
    const cached = getCachedAIWithStats<InventoryBrainResult>('inventory-brain', cacheKey);
    if (cached) {
      // v8.33: Record a perf entry for the cache-hit path (fast — just lookup).
      recordPerf('inventory', Date.now() - cacheHitStart, true);
      // Re-stamp cachedAt so the caller sees a fresh "served at" timestamp.
      const served: InventoryBrainResult = {
        ...cached,
        cachedAt: Date.now(),
      };
      return apiOk(served);
    }

    // v8.33: Wrap inventoryBrain() call with perf tracking. cached=false (slow path).
    const result = await withPerf('inventory', async () => inventoryBrain(mergedInput), false);
    setCachedAIWithStats('inventory-brain', cacheKey, result, BRAIN_CACHE_TTL_MS);

    return apiOk(result);
  },
});

export const GET = inventoryBrainHandler;
export const POST = inventoryBrainHandler;
