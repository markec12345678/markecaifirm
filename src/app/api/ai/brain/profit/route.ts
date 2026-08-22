// v8.15 / v8.95.1-a-refactor: Profit Brain — GET+POST /api/ai/brain/profit
//
// Profit Brain is the FIRST "Brain" layer — a NEW architectural layer ABOVE
// the 404 specialist endpoints. Each specialist (profit-growth-rate-maximizer,
// profit-multiplier-maximizer, profit-density-maximizer, ...) measures ONE
// dimension of profit. The Profit Brain synthesizes 6 profit signals
// (growth, scale, efficiency, velocity, compounding, horizon) into ONE
// decision:
//   - 3 top actions for today, ranked by expectedUpliftEUR × confidence
//   - 30d / 90d profit projections
//   - overall profit grade (weighted across 6 signals)
//   - one-line summary that names the single biggest lever
//
// DIFFERENCES from the 404 specialists (v8.01–v8.14):
//  - Specialists measure ONE dimension (e.g. profit density, compounding,
//    working capital). Brain SYNTHESIZES 6 dimensions into one decision.
//  - Specialists are flat endpoints (no hierarchy). Brain sits ABOVE them
//    and may, in future versions (v8.16+), invoke them in parallel.
//  - In v8.15 the Brain computes the 6 signals itself (pure deterministic
//    TypeScript — no AI, no HTTP fan-out). This keeps the Brain fast (<5ms)
//    and fully testable.
//
// DETERMINISTIC (aiUsed: false): no external AI/LLM SDK is called.
// DB-BACKED STATE INJECTION (graceful): if Prisma is available, fetch last
// 12 months of SOLD trades to derive monthlyProfits + avgProfitPerTrade +
// tradesPerMonth + capitalDeployed (sum of HELD item est. values). If DB
// unavailable or no trades, falls back to sensible defaults — never crashes.
// 5-MIN CACHE: cache key = `profit-brain:${hashOfInputs}`, TTL = 300000 ms.
//
// Refaktoriran z withAiRoute helperjem (v8.95.1-a) + enforceBudget guard
// (non-breaking — endpoint ne kliče AI direktno, ampak je konsistentno z
// vsemi v8.94.x migracijami).

import type { NextRequest } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { getCachedAIWithStats, setCachedAIWithStats } from '@/lib/ai-cache';
// v8.33: Performance metrics — wraps profitBrain() with response-time tracking
import { withPerf, recordPerf } from '@/lib/brain/performance';
import {
  profitBrain,
  type ProfitBrainInput,
  type ProfitBrainResult,
} from '@/lib/brain/profit';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Cache TTL -----------------------------------------------------------
const BRAIN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// --- Input resolution ----------------------------------------------------

/**
 * Parse inputs from BOTH query string (GET) and POST body. Body takes
 * precedence over query (POST is more explicit intent).
 */
async function resolveInputs(req: NextRequest): Promise<ProfitBrainInput> {
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

  const asNumberArray = (key: string): number[] | undefined => {
    const v = lookup(key);
    if (v == null) return undefined;
    if (Array.isArray(v)) {
      const arr = v
        .map((x) => (typeof x === 'number' ? x : Number(x)))
        .filter((n) => Number.isFinite(n));
      return arr.length > 0 ? arr : undefined;
    }
    if (typeof v === 'string') {
      // Accept "200,220,250" or "[200,220,250]" or JSON array
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) {
          const arr = parsed
            .map((x: unknown) => (typeof x === 'number' ? x : Number(x)))
            .filter((n: number) => Number.isFinite(n));
          return arr.length > 0 ? arr : undefined;
        }
      } catch {
        // try CSV split
        const arr = v
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n));
        return arr.length > 0 ? arr : undefined;
      }
    }
    return undefined;
  };

  const input: ProfitBrainInput = {};
  const monthlyProfits = asNumberArray('monthlyProfits');
  if (monthlyProfits) input.monthlyProfits = monthlyProfits;
  const avgProfitPerTrade = asNumber('avgProfitPerTrade');
  if (avgProfitPerTrade != null) input.avgProfitPerTrade = avgProfitPerTrade;
  const tradesPerMonth = asNumber('tradesPerMonth');
  if (tradesPerMonth != null) input.tradesPerMonth = tradesPerMonth;
  const capitalDeployed = asNumber('capitalDeployed');
  if (capitalDeployed != null) input.capitalDeployed = capitalDeployed;
  return input;
}

// --- DB state injection (graceful) ---------------------------------------

interface DbDerivedState {
  monthlyProfits: number[];
  avgProfitPerTrade: number;
  tradesPerMonth: number;
  capitalDeployed: number;
}

/**
 * Fetch last 12 months of SOLD trades + current HELD inventory capital.
 * Wrapped in try/catch — never throws. Returns null if DB unavailable
 * or no usable data found.
 *
 * v8.95.1-a: db + logger sta parameterja (prej modul-level uvoza +
 * dynamic import) — passed-in iz ctx.db/ctx.logger v withAiRoute handler-ju.
 */
async function fetchDbState(
  db: AiRouteContext['db'],
  logger: AiRouteContext['logger'],
): Promise<DbDerivedState | null> {
  try {
    const now = new Date();
    const twelveMonthsAgo = new Date(now);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    // SOLD trades in last 12 months (used for monthly profits + trade frequency)
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: twelveMonthsAgo, not: null },
        sellPrice: { not: null },
      },
      select: {
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
      },
    });

    // HELD inventory — sum of estimated values (= capital currently deployed)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { buyPrice: true, buyFees: true },
    });

    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return null;
    }

    // Bucket SOLD trades by month (YYYY-MM) → sum profit
    const monthlyMap = new Map<string, number>();
    let totalProfit = 0;
    let countSold = 0;
    for (const t of soldTrades) {
      const sellPrice = typeof t.sellPrice === 'number' ? t.sellPrice : 0;
      const buyPrice = typeof t.buyPrice === 'number' ? t.buyPrice : 0;
      const buyFees = typeof t.buyFees === 'number' ? t.buyFees : 0;
      const sellFees = typeof t.sellFees === 'number' ? t.sellFees : 0;
      const profit = sellPrice - sellFees - (buyPrice + buyFees);
      totalProfit += profit;
      countSold += 1;
      if (t.sellDate) {
        const d = new Date(t.sellDate);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + profit);
      }
    }

    // Build 12-element monthlyProfits array (oldest → newest), aligned to last
    // 12 calendar months. Months with no sales → 0.
    const monthlyProfits: number[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyProfits.push(Math.round((monthlyMap.get(key) ?? 0) * 100) / 100);
    }

    const avgProfitPerTrade =
      countSold > 0 ? Math.round((totalProfit / countSold) * 100) / 100 : 30;

    // tradesPerMonth = average over 12 months (count / 12)
    const tradesPerMonth = Math.round((countSold / 12) * 100) / 100;

    // capitalDeployed = sum of (buyPrice + buyFees) of currently HELD items
    let capitalDeployed = 0;
    for (const t of heldTrades) {
      capitalDeployed +=
        (typeof t.buyPrice === 'number' ? t.buyPrice : 0) +
        (typeof t.buyFees === 'number' ? t.buyFees : 0);
    }

    return {
      monthlyProfits,
      avgProfitPerTrade,
      tradesPerMonth,
      capitalDeployed: Math.round(capitalDeployed * 100) / 100,
    };
  } catch (err: any) {
    logger.warn(
      '/api/ai/brain/profit',
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
function buildCacheKey(input: ProfitBrainInput): string {
  const parts: string[] = [];
  parts.push(`mp:${(input.monthlyProfits ?? []).join(',')}`);
  parts.push(`apt:${input.avgProfitPerTrade ?? ''}`);
  parts.push(`tpm:${input.tradesPerMonth ?? ''}`);
  parts.push(`cd:${input.capitalDeployed ?? ''}`);
  // v8.33: Return ONLY the suffix — namespace prefix ('profit-brain:') is now
  // prepended by getCachedAIWithStats/setCachedAIWithStats so they can track
  // per-namespace stats. Actual stored key unchanged: `profit-brain:mp:...`.
  return parts.join('|');
}

// --- Handler -------------------------------------------------------------

const profitBrainHandler = withAiRoute<ProfitBrainInput>({
  endpoint: '/api/ai/brain/profit',
  maxDuration: 60,
  enforceBudget: true, // v8.95.1-a: budget guard + avtomatski recordAiCall
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  // GET+POST — parse iz query string-a (GET) ali POST body-ja (body
  // precedence nad query). Vsa polja so optional — ProfitBrainInput
  // degrade gracefully z defaults kadar katerokoli polje manjka.
  parseBody: async (req) => resolveInputs(req),

  // Brez validateInput — vsa polja so optional

  handler: async (userInput, ctx: AiRouteContext) => {
    const { db, logger } = ctx;

    // DB state injection — fills in any missing fields from real trade history.
    // If both DB and user input are present, USER INPUT WINS (user can override).
    const dbState = await fetchDbState(db, logger);
    const mergedInput: ProfitBrainInput = {
      monthlyProfits:
        userInput.monthlyProfits
        ?? (dbState && dbState.monthlyProfits.length > 0 ? dbState.monthlyProfits : undefined),
      avgProfitPerTrade:
        userInput.avgProfitPerTrade ?? dbState?.avgProfitPerTrade ?? undefined,
      tradesPerMonth: userInput.tradesPerMonth ?? dbState?.tradesPerMonth ?? undefined,
      capitalDeployed: userInput.capitalDeployed ?? dbState?.capitalDeployed ?? undefined,
    };

    const cacheKey = buildCacheKey(mergedInput);
    // v8.33: Use cache stats-tracked variants. Namespace = 'profit-brain'.
    const cacheHitStart = Date.now();
    const cached = getCachedAIWithStats<ProfitBrainResult>('profit-brain', cacheKey);
    if (cached) {
      // v8.33: Record a perf entry for the cache-hit path (fast — just lookup).
      recordPerf('profit', Date.now() - cacheHitStart, true);
      // Re-stamp cachedAt so the caller sees a fresh "served at" timestamp.
      const served: ProfitBrainResult = {
        ...cached,
        cachedAt: Date.now(),
      };
      return apiOk(served);
    }

    // v8.33: Wrap profitBrain() call with perf tracking. cached=false (slow path).
    const result = await withPerf('profit', async () => profitBrain(mergedInput), false);
    setCachedAIWithStats('profit-brain', cacheKey, result, BRAIN_CACHE_TTL_MS);

    return apiOk(result);
  },
});

export const GET = profitBrainHandler;
export const POST = profitBrainHandler;
