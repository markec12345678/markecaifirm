// v8.18: Sourcing Brain — GET+POST /api/ai/brain/sourcing
//
// Sourcing Brain is the FOURTH "Brain" layer — a NEW architectural layer ABOVE
// the ~21 sourcing/deal-source specialist endpoints (deal-source-profit-
// maximizer, deal-source-roi-maximizer, deal-source-volume-maximizer,
// deal-source-momentum-analyzer, deal-source-trend-analyzer, sourcing,
// inventory-supplier-evaluator, ...). Each specialist measures ONE sourcing
// dimension. The Sourcing Brain synthesizes 6 sourcing signals (roi, volume,
// margin, momentum, diversification, concentration) into ONE decision:
//   - 3 top actions for today, ranked by expectedUpliftEUR × confidence
//   - 30d / 90d sourcing projections (recommendedSourceToScale +
//     recommendedSourceToReduce + projectedTotalMonthlyProfit +
//     projectedConcentrationPct + recommendedNewSource)
//   - overall sourcing grade (weighted across 6 signals)
//   - one-line summary that names the single biggest sourcing lever
//
// DIFFERENCES from Profit Brain (v8.15):
//  - Profit Brain reads TRADE HISTORY (monthlyProfits[]) → synthesizes
//    profit-growth signals. Sourcing Brain reads PER-SOURCE BREAKDOWN
//    (capitalDeployed, monthlyProfit, margin per source) → synthesizes
//    sourcing-allocation signals.
//  - Profit Brain's projection30d/projection90d are scalars (EUR/mo).
//    Sourcing Brain's projections are STRUCTURED objects with
//    recommendedSourceToScale + recommendedSourceToReduce + projectedConcentrationPct
//    + recommendedNewSource — because sourcing is per-source, not aggregate.
//
// DIFFERENCES from Inventory Brain (v8.16):
//  - Inventory Brain answers "how well is your stock performing as capital?".
//    Sourcing Brain answers "where should you ALLOCATE your next euro of
//    capital across Bolha/Vinted/Avtonet/.../Kleinanzeigen?".
//  - Inventory Brain projects inventory value + aged stock %.
//    Sourcing Brain projects source count + concentration % + which new
//    source to add (e.g. Kleinanzeigen for Slovenian flippers).
//
// DIFFERENCES from Market Brain (v8.17):
//  - Market Brain reads MARKET CONTEXT (active listings, price changes,
//    inquiries, sell-through) → synthesizes market-cycle signals.
//    Sourcing Brain reads SOURCE PERFORMANCE BREAKDOWN (which Bolha/Vinted/
//    mobile.de/etc. delivers the best ROI / volume / margin) → synthesizes
//    sourcing-allocation signals.
//  - Market Brain answers "where in the market cycle are we RIGHT NOW?".
//    Sourcing Brain answers "which source is winning, and where do we
//    rebalance our capital next month?".
//
// DIFFERENCES from the ~21 sourcing specialists:
//  - Specialists measure ONE dimension. Brain SYNTHESIZES 6 dimensions.
//  - In v8.18 the Brain computes the 6 signals itself (pure deterministic
//    TypeScript — no AI, no HTTP fan-out). This keeps the Brain fast (<5ms)
//    and fully testable.
//
// DETERMINISTIC (aiUsed: false): no external AI/LLM SDK is called.
// DB-BACKED STATE INJECTION (graceful): if Prisma is available, read from the
// Trade model (group by buyLocation: Bolha/Vinted/Avtonet/mobile.de/etc.)
// and the Monitor model (source field). If DB unavailable or no usable data,
// falls back to sensible 4-source defaults — never crashes.
// 5-MIN CACHE: cache key = `sourcing-brain:${hashOfInputs}`, TTL = 300000 ms.

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';
import {
  sourcingBrain,
  type SourcingBrainInput,
  type SourcingBrainResult,
  type SourceDatum,
} from '@/lib/brain/sourcing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// --- Cache TTL -----------------------------------------------------------
const BRAIN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// --- Input resolution ----------------------------------------------------

/**
 * Parse inputs from BOTH query string (GET) and POST body. Body takes
 * precedence over query (POST is more explicit intent).
 *
 * Sources array is only accepted from POST body (GET typically uses defaults).
 * For GET, scalar params `totalCapitalDeployed` + `totalMonthlyProfit` are
 * honored (sources fallback to defaults).
 */
async function resolveInputs(req: NextRequest): Promise<SourcingBrainInput> {
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

  const input: SourcingBrainInput = {};
  const totalCapitalDeployed = asNumber('totalCapitalDeployed');
  if (totalCapitalDeployed != null) input.totalCapitalDeployed = totalCapitalDeployed;
  const totalMonthlyProfit = asNumber('totalMonthlyProfit');
  if (totalMonthlyProfit != null) input.totalMonthlyProfit = totalMonthlyProfit;

  // Sources array — POST body only (GET URLs would be too long for arrays)
  if (bodyParams && Array.isArray(bodyParams.sources)) {
    const sources: SourceDatum[] = [];
    for (const raw of bodyParams.sources) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const name =
        typeof r.name === 'string' && r.name.length > 0 ? r.name : '';
      if (!name) continue;
      const sd: SourceDatum = {
        name,
        monthlyVolume: typeof r.monthlyVolume === 'number' ? r.monthlyVolume : 0,
        avgProfitMarginPct:
          typeof r.avgProfitMarginPct === 'number' ? r.avgProfitMarginPct : 0,
        avgDaysToSell:
          typeof r.avgDaysToSell === 'number' ? r.avgDaysToSell : 0,
        capitalDeployedEUR:
          typeof r.capitalDeployedEUR === 'number' ? r.capitalDeployedEUR : 0,
        monthlyProfitEUR:
          typeof r.monthlyProfitEUR === 'number' ? r.monthlyProfitEUR : 0,
      };
      sources.push(sd);
    }
    if (sources.length > 0) {
      input.sources = sources;
    }
  }

  return input;
}

// --- DB state injection (graceful) ---------------------------------------

interface DbDerivedState {
  sources: SourceDatum[];
  totalCapitalDeployed: number;
  totalMonthlyProfit: number;
}

/**
 * Read from the Trade table grouped by buyLocation to derive per-source
 * sourcing context. Falls back to null on any DB error.
 *
 * Per-source aggregation (last 30d window for sold trades; all held for capital):
 *  - name: normalized buyLocation (Bolha, Vinted, Avtonet, mobile.de, ...)
 *  - monthlyVolume: count of trades bought in last 30 days (per source)
 *  - avgProfitMarginPct: avg ((sell-buy)/buy × 100) for sold trades from this source
 *  - avgDaysToSell: avg (sellDate - buyDate) for sold trades from this source
 *  - capitalDeployedEUR: sum(buyPrice) of currently HELD trades from this source
 *  - monthlyProfitEUR: sum(sellPrice - buyPrice - buyFees - sellFees) of SOLD trades
 *    from this source in the last 30 days
 */
async function fetchDbState(): Promise<DbDerivedState | null> {
  try {
    const { db } = await import('@/lib/db');

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Held trades (capital currently deployed)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        buyPrice: true,
        buyDate: true,
        buyLocation: true,
      },
    });

    // Sold trades — last 30 days (for volume + profit + margin + daysToSell)
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: thirtyDaysAgo },
      },
      select: {
        buyPrice: true,
        buyDate: true,
        buyLocation: true,
        sellPrice: true,
        sellDate: true,
        buyFees: true,
        sellFees: true,
      },
    });

    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return null;
    }

    // Group by normalized buyLocation
    const buckets = new Map<
      string,
      {
        heldCapital: number;
        soldCount: number;
        buyCount30d: number;
        profitSum: number;
        marginPctSum: number;
        daysToSellSum: number;
        daysToSellCount: number;
      }
    >();

    const norm = (loc: string): string => {
      const l = (loc ?? '').trim().toLowerCase();
      if (!l) return 'Unknown';
      if (l.includes('bolha')) return 'Bolha';
      if (l.includes('vinted')) return 'Vinted';
      if (l.includes('avtonet')) return 'Avtonet';
      if (l.includes('mobile') || l.includes('mobile.de')) return 'mobile.de';
      if (l.includes('klein') || l.includes('kleinanzeigen')) return 'Kleinanzeigen';
      if (l.includes('subito')) return 'Subito';
      if (l.includes('willhaben')) return 'Willhaben';
      if (l.includes('salomon')) return 'Salomon';
      if (l.includes('nepremicn')) return 'Nepremicnine';
      // Capitalize first letter for unknown strings
      return loc.charAt(0).toUpperCase() + loc.slice(1);
    };

    const dayMs = 86_400_000;

    for (const t of heldTrades) {
      const name = norm(t.buyLocation ?? '');
      const b = buckets.get(name) ?? {
        heldCapital: 0,
        soldCount: 0,
        buyCount30d: 0,
        profitSum: 0,
        marginPctSum: 0,
        daysToSellSum: 0,
        daysToSellCount: 0,
      };
      b.heldCapital += typeof t.buyPrice === 'number' ? t.buyPrice : 0;
      // Held trades bought in last 30 days count toward monthly volume
      if (t.buyDate && new Date(t.buyDate) >= thirtyDaysAgo) {
        b.buyCount30d += 1;
      }
      buckets.set(name, b);
    }

    for (const t of soldTrades) {
      const name = norm(t.buyLocation ?? '');
      const b = buckets.get(name) ?? {
        heldCapital: 0,
        soldCount: 0,
        buyCount30d: 0,
        profitSum: 0,
        marginPctSum: 0,
        daysToSellSum: 0,
        daysToSellCount: 0,
      };
      const buy = typeof t.buyPrice === 'number' ? t.buyPrice : 0;
      const sell = typeof t.sellPrice === 'number' ? t.sellPrice : 0;
      const buyFees = typeof (t as { buyFees?: number }).buyFees === 'number'
        ? (t as { buyFees: number }).buyFees
        : 0;
      const sellFees = typeof (t as { sellFees?: number }).sellFees === 'number'
        ? (t as { sellFees: number }).sellFees
        : 0;
      const profit = sell - buy - buyFees - sellFees;
      b.soldCount += 1;
      b.profitSum += profit;
      if (buy > 0) {
        b.marginPctSum += (profit / buy) * 100;
      }
      if (t.buyDate && t.sellDate) {
        const days = (new Date(t.sellDate).getTime() - new Date(t.buyDate).getTime()) / dayMs;
        if (days >= 0 && days < 3650) {
          b.daysToSellSum += days;
          b.daysToSellCount += 1;
        }
      }
      buckets.set(name, b);
    }

    if (buckets.size === 0) {
      return null;
    }

    // Materialize sources (filter out tiny/inactive buckets — keep top 6 by capital)
    const sources: SourceDatum[] = [];
    for (const [name, b] of buckets.entries()) {
      const avgProfitMarginPct =
        b.soldCount > 0 ? b.marginPctSum / b.soldCount : 0;
      const avgDaysToSell =
        b.daysToSellCount > 0 ? b.daysToSellSum / b.daysToSellCount : 14;
      sources.push({
        name,
        monthlyVolume: b.buyCount30d,
        avgProfitMarginPct: Math.round(avgProfitMarginPct * 100) / 100,
        avgDaysToSell: Math.round(avgDaysToSell * 100) / 100,
        capitalDeployedEUR: Math.round(b.heldCapital * 100) / 100,
        monthlyProfitEUR: Math.round(b.profitSum * 100) / 100,
      });
    }
    // Sort by capital deployed descending, keep top 6
    sources.sort((a, b) => b.capitalDeployedEUR - a.capitalDeployedEUR);
    const top = sources.slice(0, 6);
    if (top.length === 0) return null;

    const totalCapitalDeployed = top.reduce((a, s) => a + s.capitalDeployedEUR, 0);
    const totalMonthlyProfit = top.reduce((a, s) => a + s.monthlyProfitEUR, 0);

    return {
      sources: top,
      totalCapitalDeployed: Math.round(totalCapitalDeployed * 100) / 100,
      totalMonthlyProfit: Math.round(totalMonthlyProfit * 100) / 100,
    };
  } catch (err: any) {
    logger.warn(
      '/api/ai/brain/sourcing',
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
function buildCacheKey(input: SourcingBrainInput): string {
  const parts: string[] = [];
  parts.push(`tcp:${input.totalCapitalDeployed ?? ''}`);
  parts.push(`tmp:${input.totalMonthlyProfit ?? ''}`);
  if (input.sources && Array.isArray(input.sources)) {
    const srcSig = input.sources
      .map(
        (s) =>
          `${s.name}:${s.monthlyVolume}:${s.avgProfitMarginPct}:${s.avgDaysToSell}:${s.capitalDeployedEUR}:${s.monthlyProfitEUR}`,
      )
      .join(',');
    parts.push(`src:[${srcSig}]`);
  } else {
    parts.push('src:default');
  }
  return `sourcing-brain:${parts.join('|')}`;
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleSourcingBrain(req);
}

export async function POST(req: NextRequest) {
  return handleSourcingBrain(req);
}

async function handleSourcingBrain(req: NextRequest) {
  try {
    const userInput = await resolveInputs(req);

    // DB state injection — fills in `sources` if the caller did not provide them.
    // If both DB and user input are present, USER INPUT WINS (user can override).
    const dbState = await fetchDbState();
    const mergedInput: SourcingBrainInput = {
      sources: userInput.sources ?? dbState?.sources ?? undefined,
      totalCapitalDeployed:
        userInput.totalCapitalDeployed ?? dbState?.totalCapitalDeployed ?? undefined,
      totalMonthlyProfit:
        userInput.totalMonthlyProfit ?? dbState?.totalMonthlyProfit ?? undefined,
    };

    const cacheKey = buildCacheKey(mergedInput);
    const cached = getCachedAI<SourcingBrainResult>(cacheKey);
    if (cached) {
      // Re-stamp cachedAt so the caller sees a fresh "served at" timestamp.
      const served: SourcingBrainResult = {
        ...cached,
        cachedAt: Date.now(),
      };
      return NextResponse.json(served);
    }

    const result = sourcingBrain(mergedInput);
    setCachedAI(cacheKey, result, BRAIN_CACHE_TTL_MS);

    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/api/ai/brain/sourcing', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
