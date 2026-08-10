// v8.02: AI Deal Source Volume Maximizer — AI maksimizira trade VOLUME per
// source — kako dobit VEČ deal-ov iz vsakega source-a BREZ dilutiranja quality.
// Fokus na scaling VOLUME (več trades) namesto ROI ali margin. "Bolha je
// trenutno 8 trades/mo, lahko 18 trades/mo z broader categories + cross-posting."
//
// Razlika od deal-source-roi-maximizer (v8.00 ki maksimizira ROI per source)
// — ta MAXIMIZIRA VOLUME per source (več trades), ne ROI %. Razlika od
// deal-source-profit-maximizer (v7.97 ki maksimizira profit per source) — ta
// maksimizira VOLUME (število trades) z quality maintenance strategy, ne profit
// €. Razlika od revenue-growth-maximizer (v8.01 ki maksimizira top-line revenue)
// — ta daje PER-SOURCE volume maximization z volume levers + projected 30d
// volume. Razlika od profit-scale-engine (v8.02 ki scale-a cel business) — ta
// maksimizira VOLUME per source z quality maintenance strategy, ne global
// scaling. Razlika od deal-source-momentum-analyzer (ki analizira momentum)
// — ta MAXIMIZIRA volume z actionable levers (more search terms, broader
// categories, new monitors, cross-posting). Razlika od deal-source-trend-
// analyzer (ki analizira trende) — ta daje PROJECTED 30d volume + 3/6/12m
// forecast + portfolio-level volume uplift.

// GET+POST /api/ai/deal-source-volume-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import {
  callProviderForRaw,
  parseJsonLooseExported,
  type AiProviderType,
  type AiSettings,
} from '@/lib/ai';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type VolumeAction = 'SCALE_AGGRESSIVELY' | 'SCALE_GRADUALLY' | 'MAINTAIN' | 'REDUCE';

interface SoldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  category: string | null;
  listing: {
    monitor: { source: string; tags: string } | null;
  } | null;
}

interface CurrentVolume {
  tradesPerMonth: number;
  volumeGrowthRate: number;
  volumeCapacity: number;
  avgProfitPerTrade: number;
  volumeEfficiencyScore: number;
}

interface VolumeLever {
  lever: string;
  action: string;
  expectedVolumeGain: number;
}

interface VolumeGrowthPoint {
  month: number;
  projectedTrades: number;
}

interface Maximation {
  volumeMaximizationAction: VolumeAction;
  projectedVolume30d: number;
  volumeUplift: number;
  volumeMaximizationLevers: VolumeLever[];
  qualityMaintenanceStrategy: string;
  capitalRequirement: number;
  timeRequirement: number;
  volumeGrowthProjection: VolumeGrowthPoint[];
}

interface SourceResult {
  source: string;
  displayName: string;
  current: CurrentVolume;
  maximization: Maximation;
}

interface Portfolio {
  totalCurrentVolume: number;
  totalProjectedVolume: number;
  totalVolumeUplift: number;
  bestVolumeSource: string | null;
  volumeDiversificationAdvice: string;
}

interface DealSourceVolumeResponse {
  ok: true;
  sources: SourceResult[];
  portfolio: Portfolio;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiSourceOverride {
  source?: string;
  maximization?: {
    volumeMaximizationAction?: VolumeAction;
    projectedVolume30d?: number;
    volumeUplift?: number;
    volumeMaximizationLevers?: Array<{
      lever?: string;
      action?: string;
      expectedVolumeGain?: number;
    }>;
    qualityMaintenanceStrategy?: string;
    capitalRequirement?: number;
    timeRequirement?: number;
    volumeGrowthProjection?: Array<{ month?: number; projectedTrades?: number }>;
  };
}

interface AiResponse {
  sources?: AiSourceOverride[];
  portfolio?: {
    bestVolumeSource?: string;
    volumeDiversificationAdvice?: string;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;
const THREE_MONTHS_MS = 90 * DAY_MS;
const SIX_MONTHS_MS = 180 * DAY_MS;

const VOLUME_MIN = 0;
const VOLUME_MAX = 1000; // trades/mo ceiling
const GROWTH_MIN = -100;
const GROWTH_MAX = 500; // %/mo
const CAPACITY_MIN = 0;
const CAPACITY_MAX = 1000;
const PROFIT_MIN = 0;
const PROFIT_MAX = 100_000;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const CAPITAL_MIN = 0;
const CAPITAL_MAX = 1_000_000;
const TIME_MIN = 0;
const TIME_MAX = 168;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 500;
const GAIN_MIN = 0;
const GAIN_MAX = 200; // additional trades per lever ceiling

const VALID_ACTION: readonly VolumeAction[] = [
  'SCALE_AGGRESSIVELY', 'SCALE_GRADUALLY', 'MAINTAIN', 'REDUCE',
];

const MAX_SOURCES = 12;
const MAX_LEVERS = 6;
const MAX_PROJECTION_POINTS = 12; // 3/6/12 months

// --- Helpers -------------------------------------------------------------

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

function clampEnum<T extends string>(
  raw: unknown,
  valid: readonly T[],
  fallback: T,
): T {
  const s = String(raw ?? '').trim().toUpperCase();
  for (const v of valid) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function round0(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v);
}

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function toMs(d: Date | null | undefined): number {
  if (!d) return 0;
  try {
    return new Date(d as unknown as Date | string).getTime();
  } catch {
    return 0;
  }
}

function displayName(source: string): string {
  if (!source) return 'Unknown';
  const s = source.trim().toLowerCase();
  const map: Record<string, string> = {
    bolha: 'Bolha',
    vinted: 'Vinted',
    avtonet: 'Avtonet',
    'mobile.de': 'mobile.de',
    mobile: 'mobile.de',
    kleinanzeigen: 'Kleinanzeigen',
    facebook: 'Facebook Marketplace',
    fb: 'Facebook Marketplace',
    subito: 'Subito',
    willhaben: 'Willhaben',
  };
  return map[s] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

// --- Deterministic computation ------------------------------------------

interface SoldComputed {
  profit: number;
  sellMs: number;
  sellMonth: string;
  source: string;
  within3m: boolean;
  within6m: boolean;
  within12m: boolean;
}

function computeSoldTrade(t: SoldTradeRow, now: number): SoldComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellPrice = t.sellPrice ?? 0;
  const sellFees = t.sellFees ?? 0;
  if (sellPrice <= 0) return null;
  const sellMs = toMs(t.sellDate);
  if (sellMs <= 0) return null;
  const cost = buyPrice + buyFees;
  const net = sellPrice - sellFees;
  const profit = net - cost;
  const sellMonth = new Date(sellMs).toISOString().slice(0, 7);
  const source = t.listing?.monitor?.source?.trim() || 'unknown';
  const within3m = (now - sellMs) <= THREE_MONTHS_MS;
  const within6m = (now - sellMs) <= SIX_MONTHS_MS;
  const within12m = (now - sellMs) <= TWELVE_MONTHS_MS;
  return {
    profit, sellMs, sellMonth, source, within3m, within6m, within12m,
  };
}

interface SourceAgg {
  count12m: number;
  count6m: number;
  count3m: number;
  profit12m: number;
  perMonth: Map<string, number>;
}

function aggregatePerSource(trades: SoldComputed[]): Map<string, SourceAgg> {
  const bySource = new Map<string, SourceAgg>();
  for (const t of trades) {
    let agg = bySource.get(t.source);
    if (!agg) {
      agg = {
        count12m: 0, count6m: 0, count3m: 0,
        profit12m: 0, perMonth: new Map(),
      };
      bySource.set(t.source, agg);
    }
    if (t.within12m) {
      agg.count12m += 1;
      agg.profit12m += t.profit;
      agg.perMonth.set(t.sellMonth, (agg.perMonth.get(t.sellMonth) ?? 0) + 1);
    }
    if (t.within6m) agg.count6m += 1;
    if (t.within3m) agg.count3m += 1;
  }
  return bySource;
}

function computeVolumeGrowthRate(perMonth: Map<string, number>): number {
  const sortedMonths = Array.from(perMonth.keys()).sort();
  if (sortedMonths.length < 2) return 0;
  const lastIdx = sortedMonths.length - 1;
  const last3 = sortedMonths.slice(Math.max(0, lastIdx - 2), lastIdx + 1);
  const prev3 = sortedMonths.slice(Math.max(0, lastIdx - 5), Math.max(0, lastIdx - 2));
  if (last3.length === 0 || prev3.length === 0) return 0;
  const last3Avg = last3.reduce((s, m) => s + (perMonth.get(m) ?? 0), 0) / last3.length;
  const prev3Avg = prev3.reduce((s, m) => s + (perMonth.get(m) ?? 0), 0) / prev3.length;
  if (prev3Avg <= 0) return last3Avg > 0 ? 100 : 0;
  return ((last3Avg - prev3Avg) / prev3Avg) * 100;
}

function computeVolumeEfficiencyScore(
  tradesPerMonth: number,
  growthRate: number,
  avgProfitPerTrade: number,
): number {
  // 0-100 score
  // 50% volume (12 trades/mo = 50 pts, 24+ = 100)
  const volScore = clampNum((tradesPerMonth / 24) * 50, 0, 50, 0);
  // 25% growth (positive growth adds up to 25 pts)
  const growthScore = clampNum(Math.max(0, growthRate) / 100 * 25, 0, 25, 0);
  // 25% quality (avgProfit ≥50€ = 25 pts)
  const qualScore = clampNum(Math.max(0, avgProfitPerTrade) / 100 * 25, 0, 25, 0);
  return round0(clampNum(volScore + growthScore + qualScore, SCORE_MIN, SCORE_MAX, 0));
}

function computeCurrent(agg: SourceAgg): CurrentVolume {
  const tradesPerMonth = round2(clampNum(
    agg.count12m > 0 ? agg.count12m / 12 : 0,
    VOLUME_MIN, VOLUME_MAX, 0,
  ));
  const volumeGrowthRate = round2(clampNum(
    computeVolumeGrowthRate(agg.perMonth),
    GROWTH_MIN, GROWTH_MAX, 0,
  ));
  const volumeCapacity = round0(clampNum(
    Math.max(tradesPerMonth * 1.5, 10),
    CAPACITY_MIN, CAPACITY_MAX, 10,
  ));
  const avgProfitPerTrade = round0(clampNum(
    agg.count12m > 0 ? agg.profit12m / agg.count12m : 0,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const volumeEfficiencyScore = computeVolumeEfficiencyScore(
    tradesPerMonth, volumeGrowthRate, avgProfitPerTrade,
  );
  return {
    tradesPerMonth,
    volumeGrowthRate,
    volumeCapacity,
    avgProfitPerTrade,
    volumeEfficiencyScore,
  };
}

function decideVolumeAction(
  current: CurrentVolume,
): VolumeAction {
  // SCALE_AGGRESSIVELY if volumeEfficiencyScore ≥ 60 AND growth ≥ 10%
  // SCALE_GRADUALLY if volumeEfficiencyScore ≥ 40 OR growth ≥ 0
  // MAINTAIN if volumeEfficiencyScore ≥ 25
  // REDUCE if quality bad (avgProfitPerTrade < 0)
  if (current.avgProfitPerTrade < 0) return 'REDUCE';
  if (current.volumeEfficiencyScore >= 60 && current.volumeGrowthRate >= 10) {
    return 'SCALE_AGGRESSIVELY';
  }
  if (current.volumeEfficiencyScore >= 40 || current.volumeGrowthRate >= 0) {
    return 'SCALE_GRADUALLY';
  }
  if (current.volumeEfficiencyScore >= 25) return 'MAINTAIN';
  return 'REDUCE';
}

function buildDeterministicMaximization(
  source: string,
  current: CurrentVolume,
): Maximation {
  const action = decideVolumeAction(current);
  let upliftPct = 0;
  switch (action) {
    case 'SCALE_AGGRESSIVELY': upliftPct = 1.2; break; // +120% (2.2x)
    case 'SCALE_GRADUALLY': upliftPct = 0.5; break;    // +50% (1.5x)
    case 'MAINTAIN': upliftPct = 0.1; break;          // +10%
    case 'REDUCE': upliftPct = -0.2; break;           // -20%
  }
  const projectedVolume30d = round2(clampNum(
    Math.max(0, current.tradesPerMonth * (1 + upliftPct)),
    VOLUME_MIN, VOLUME_MAX, 0,
  ));
  const volumeUplift = round2(clampNum(
    projectedVolume30d - current.tradesPerMonth,
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  // Levers — based on source characteristics
  const levers: VolumeLever[] = [];
  // 1) More search terms / monitors
  levers.push({
    lever: 'Broader search terms',
    action: `Dodaj 5+ novih search keyword-ov v ${displayName(source)} monitorje za širši deal coverage.`,
    expectedVolumeGain: round2(clampNum(
      volumeUplift * 0.35, GAIN_MIN, GAIN_MAX, 0,
    )),
  });
  // 2) Broader categories
  levers.push({
    lever: 'Broader categories',
    action: 'Razširi category filter iz npr. iPhone 13 → iPhone 12-15 + Samsung Galaxy S-series.',
    expectedVolumeGain: round2(clampNum(
      volumeUplift * 0.25, GAIN_MIN, GAIN_MAX, 0,
    )),
  });
  // 3) New monitors (more URLs)
  levers.push({
    lever: 'New monitors (more URLs)',
    action: `Dodaj 3 nove ${displayName(source)} URL monitorje z različnimi lokacijami/cenovnimi rangi.`,
    expectedVolumeGain: round2(clampNum(
      volumeUplift * 0.2, GAIN_MIN, GAIN_MAX, 0,
    )),
  });
  // 4) Cross-posting
  levers.push({
    lever: 'Cross-posting',
    action: 'Cross-post deals na 3 platforme za hitrejši turnover in več deal-ov per source.',
    expectedVolumeGain: round2(clampNum(
      volumeUplift * 0.15, GAIN_MIN, GAIN_MAX, 0,
    )),
  });
  // 5) Faster response (alert automation)
  levers.push({
    lever: 'Faster response automation',
    action: 'Setup instant alert-e za high-dealScore listing-e — prvi kontakt = 3x večja verjetnost chiusura.',
    expectedVolumeGain: round2(clampNum(
      volumeUplift * 0.1, GAIN_MIN, GAIN_MAX, 0,
    )),
  });
  // 6) Price-range expansion (low-end + high-end)
  if (action === 'SCALE_AGGRESSIVELY') {
    levers.push({
      lever: 'Price-range expansion',
      action: 'Razširi price range filter: dodaj low-end (50-200€) in high-end (1000€+) segment za večji deal pool.',
      expectedVolumeGain: round2(clampNum(
        volumeUplift * 0.05, GAIN_MIN, GAIN_MAX, 0,
      )),
    });
  }

  const qualityMaintenanceStrategy = clampString(
    `Vzdržuj dealScore threshold ≥60 za vse buys (ne kompromitiraj quality za volume). ` +
    `Avg profit per trade target: ≥${Math.max(50, current.avgProfitPerTrade * 0.85)}€. ` +
    `Quality gating: AI score ≥7.0, price drop alert-i samo za ≥40% popust. ` +
    `Regular quality audit: če avgProfit pade pod 80% trenutnega, prekini scaling.`,
    400,
    'Vzdržuj dealScore threshold in quality gating pri volume scaling.',
  );

  // Capital requirement = additional trades × avgProfitPerTrade × 3 (cost proxy)
  const capitalRequirement = round0(clampNum(
    Math.max(0, volumeUplift) * Math.max(50, current.avgProfitPerTrade) * 3,
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));
  // Time requirement = additional trades × 1.5h per trade (sourcing + listing + customer service)
  const timeRequirement = round0(clampNum(
    Math.max(0, volumeUplift) * 1.5,
    TIME_MIN, TIME_MAX, 0,
  ));

  // Volume growth projection (3/6/12 months)
  const growthProjection: VolumeGrowthPoint[] = [];
  const monthlyGrowthRate = Math.max(0.05, current.volumeGrowthRate > 0 ? current.volumeGrowthRate / 100 : 0.1);
  const projMonths = [3, 6, 9, 12];
  for (const m of projMonths) {
    // Compounding: projected = projected30d × (1 + monthlyGrowthRate)^(m-1)
    const projected = m === 1 ? projectedVolume30d
      : projectedVolume30d * Math.pow(1 + monthlyGrowthRate, Math.min(m - 1, 12));
    growthProjection.push({
      month: m,
      projectedTrades: round2(clampNum(
        projected, VOLUME_MIN, VOLUME_MAX, 0,
      )),
    });
  }

  return {
    volumeMaximizationAction: action,
    projectedVolume30d,
    volumeUplift,
    volumeMaximizationLevers: levers.slice(0, MAX_LEVERS),
    qualityMaintenanceStrategy,
    capitalRequirement,
    timeRequirement,
    volumeGrowthProjection: growthProjection.slice(0, MAX_PROJECTION_POINTS),
  };
}

function buildPortfolio(
  results: SourceResult[],
): Portfolio {
  const totalCurrentVolume = round2(clampNum(
    results.reduce((s, r) => s + r.current.tradesPerMonth, 0),
    VOLUME_MIN, VOLUME_MAX, 0,
  ));
  const totalProjectedVolume = round2(clampNum(
    results.reduce((s, r) => s + r.maximization.projectedVolume30d, 0),
    VOLUME_MIN, VOLUME_MAX, 0,
  ));
  const totalVolumeUplift = round2(clampNum(
    totalProjectedVolume - totalCurrentVolume,
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  // bestVolumeSource = source z highest volumeUplift (absolute)
  let bestSource: string | null = null;
  let bestUplift = 0;
  for (const r of results) {
    if (r.maximization.volumeUplift > bestUplift) {
      bestUplift = r.maximization.volumeUplift;
      bestSource = r.displayName;
    }
  }

  // Diversification advice
  const topShare = totalCurrentVolume > 0
    ? Math.max(...results.map((r) => r.current.tradesPerMonth)) / totalCurrentVolume
    : 1;
  const advice = topShare > 0.6
    ? clampString(
      `TOP source = ${(topShare * 100).toFixed(0)}% total volume — HIGH concentration risk. ` +
      `Diversificiraj: dodaj 2 nova source-a (mobile.de + Vinted), postavi cap 40% na vsak source. ` +
      `Cross-post vse listing-e na 3+ platforme za distribucijo risk-a.`,
      400,
      'Diversificiraj preko 3+ source-ov z 40% cap na vsakega.',
    )
    : clampString(
      `Volume dobro diversificiran preko ${results.length} source-ov. ` +
      `Vzdržuj <40% cap na vsak source, dodaj nove source-e ko raste total volume. ` +
      `Portfolio je resilient na platform-specific risk.`,
      400,
      'Vzdržuj diversifikacijo preko 3+ source-ov.',
    );

  return {
    totalCurrentVolume,
    totalProjectedVolume,
    totalVolumeUplift,
    bestVolumeSource: bestSource,
    volumeDiversificationAdvice: advice,
  };
}

function buildSummary(
  portfolio: Portfolio,
  sourcesCount: number,
): string {
  return clampString(
    `${sourcesCount} source-ov: ${portfolio.totalCurrentVolume} trades/mo trenutno → ` +
    `${portfolio.totalProjectedVolume} trades/mo projected (+${portfolio.totalVolumeUplift} uplift). ` +
    `Best source: ${portfolio.bestVolumeSource ?? 'N/A'}.`,
    400,
    `${sourcesCount} source-ov z volume maximization.`,
  );
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleDealSourceVolumeMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleDealSourceVolumeMaximizer(req);
}

async function handleDealSourceVolumeMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-deal-source-volume-maximizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Query SOLD trades last 12 months with linked Listing (for monitor.source)
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: twelveMonthsAgo },
        sellPrice: { gt: 0 },
      },
      select: {
        id: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        category: true,
        listing: {
          select: {
            monitor: {
              select: { source: true, tags: true },
            },
          },
        },
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    // Empty-state: no SOLD trades
    if (soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        sources: [],
        portfolio: {
          totalCurrentVolume: 0,
          totalProjectedVolume: 0,
          totalVolumeUplift: 0,
          bestVolumeSource: null,
          volumeDiversificationAdvice: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Volume Maximizer ni mogoč.',
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Volume Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Volume Maximizer ni mogoč.',
      } satisfies DealSourceVolumeResponse);
    }

    // 2) Compute aggregates
    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c) soldComputed.push(c);
    }
    const bySource = aggregatePerSource(soldComputed);

    // Build per-source results, sorted by current volume (highest first)
    const sourcesRaw = Array.from(bySource.entries())
      .map(([src, agg]) => {
        const current = computeCurrent(agg);
        const maximization = buildDeterministicMaximization(src, current);
        return {
          source: src,
          displayName: displayName(src),
          current,
          maximization,
        } as SourceResult;
      })
      .sort((a, b) => b.current.tradesPerMonth - a.current.tradesPerMonth);

    const sources = sourcesRaw.slice(0, MAX_SOURCES);

    let portfolio = buildPortfolio(sources);
    let summary = buildSummary(portfolio, sources.length);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `deal-source-volume-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      sources: SourceResult[];
      portfolio: Portfolio;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        sources: cached.sources,
        portfolio: cached.portfolio,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies DealSourceVolumeResponse);
    }

    // 4) AI prompt with grounding
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as
        | AiProviderType
        | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '',
      fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const promptData = {
      soldCount12m: soldComputed.length,
      sourcesCount: sources.length,
      sources: sources.map((s) => ({
        source: s.source,
        current: s.current,
        deterministicMaximization: {
          volumeMaximizationAction: s.maximization.volumeMaximizationAction,
          projectedVolume30d: s.maximization.projectedVolume30d,
          volumeUplift: s.maximization.volumeUplift,
        },
      })),
      portfolio,
      caps: {
        volumeMin: VOLUME_MIN, volumeMax: VOLUME_MAX,
        growthMin: GROWTH_MIN, growthMax: GROWTH_MAX,
        capacityMin: CAPACITY_MIN, capacityMax: CAPACITY_MAX,
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
        timeMin: TIME_MIN, timeMax: TIME_MAX,
        gainMin: GAIN_MIN, gainMax: GAIN_MAX,
      },
    };

    const prompt = `Si AI "Deal Source Volume Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za VOLUME MAXIMIZATION per source — kako dobiti VEČ deal-ov (trades) iz vsakega source-a BREZ dilutiranja quality. Fokus je na scaling VOLUME (število trades), NE ROI ali margin. Razlika od deal-source-roi-maximizer (v8.00 ki maksimizira ROI per source) — ti MAXIMIZIRAŠ VOLUME per source (več trades). Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira profit per source) — ti maksimiziraš VOLUME z quality maintenance strategy. Razlika od revenue-growth-maximizer (v8.01 ki maksimizira revenue) — ti daje PER-SOURCE volume maximization z volume levers + projected 30d volume. Razlika od profit-scale-engine (v8.02 ki scale-a cel business) — ti maksimiziraš VOLUME per source z quality maintenance strategy.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih, per source):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. sources: array per source { source (string), maximization: { ... } } — za vsak source iz determinističnih podatkov:
   - volumeMaximizationAction: SCALE_AGGRESSIVELY | SCALE_GRADUALLY | MAINTAIN | REDUCE,
   - projectedVolume30d: number [0, 1000],
   - volumeUplift: number [0, 500],
   - volumeMaximizationLevers: 3-6 { lever (max 100, slovenski), action (max 200, slovenski), expectedVolumeGain [0, 200] },
   - qualityMaintenanceStrategy: slovenski opis kako vzdrževati quality pri volume scaling (max 400),
   - capitalRequirement: € [0, 1000000],
   - timeRequirement: hours/week [0, 168],
   - volumeGrowthProjection: 3-12 points { month (1-12), projectedTrades [0, 1000] },
2. portfolio: { bestVolumeSource (string | null), volumeDiversificationAdvice (max 400, slovenski) },
3. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "sources": [
    {
      "source": "bolha",
      "maximization": {
        "volumeMaximizationAction": "SCALE_AGGRESSIVELY",
        "projectedVolume30d": 18,
        "volumeUplift": 10,
        "volumeMaximizationLevers": [
          { "lever": "Broader search terms", "action": "Dodaj 5+ novih keyword-ov.", "expectedVolumeGain": 3.5 }
        ],
        "qualityMaintenanceStrategy": "Vzdržuj dealScore threshold ≥60.",
        "capitalRequirement": 5000,
        "timeRequirement": 15,
        "volumeGrowthProjection": [
          { "month": 3, "projectedTrades": 20 },
          { "month": 6, "projectedTrades": 24 }
        ]
      }
    }
  ],
  "portfolio": {
    "bestVolumeSource": "Bolha",
    "volumeDiversificationAdvice": "Diversificiraj preko 3 source-ov."
  },
  "summary": "5 source-ov: 22 trades/mo → 42 trades/mo projected (+20 uplift). Best: Bolha."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object') {
        // Override per-source maximization fields
        if (Array.isArray(parsed.sources)) {
          const overrideMap = new Map<string, AiSourceOverride>();
          for (const s of parsed.sources) {
            if (s && typeof s.source === 'string') {
              overrideMap.set(s.source.toLowerCase(), s);
            }
          }
          let overridden = 0;
          for (let i = 0; i < sources.length; i++) {
            const src = sources[i];
            const ov = overrideMap.get(src.source.toLowerCase());
            if (!ov || !ov.maximization || typeof ov.maximization !== 'object') continue;
            const m = ov.maximization;
            const action = clampEnum(
              m.volumeMaximizationAction, VALID_ACTION, src.maximization.volumeMaximizationAction,
            );
            const projectedVolume30d = round2(clampNum(
              m.projectedVolume30d, VOLUME_MIN, VOLUME_MAX, src.maximization.projectedVolume30d,
            ));
            const volumeUplift = round2(clampNum(
              m.volumeUplift, UPLIFT_MIN, UPLIFT_MAX, src.maximization.volumeUplift,
            ));
            let levers = src.maximization.volumeMaximizationLevers;
            if (Array.isArray(m.volumeMaximizationLevers) && m.volumeMaximizationLevers.length >= 2) {
              levers = m.volumeMaximizationLevers.slice(0, MAX_LEVERS).map((l) => ({
                lever: clampString(l?.lever, 100, 'Volume lever.'),
                action: clampString(l?.action, 200, 'Akcija za volume scaling.'),
                expectedVolumeGain: round2(clampNum(
                  l?.expectedVolumeGain, GAIN_MIN, GAIN_MAX, 0,
                )),
              }));
            }
            const qualityMaintenanceStrategy = clampString(
              m.qualityMaintenanceStrategy, 400, src.maximization.qualityMaintenanceStrategy,
            );
            const capitalRequirement = round0(clampNum(
              m.capitalRequirement, CAPITAL_MIN, CAPITAL_MAX, src.maximization.capitalRequirement,
            ));
            const timeRequirement = round0(clampNum(
              m.timeRequirement, TIME_MIN, TIME_MAX, src.maximization.timeRequirement,
            ));
            let projection = src.maximization.volumeGrowthProjection;
            if (Array.isArray(m.volumeGrowthProjection) && m.volumeGrowthProjection.length >= 2) {
              projection = m.volumeGrowthProjection.slice(0, MAX_PROJECTION_POINTS).map((p) => ({
                month: round0(clampNum(p?.month, 1, 12, 1)),
                projectedTrades: round2(clampNum(
                  p?.projectedTrades, VOLUME_MIN, VOLUME_MAX, 0,
                )),
              }));
            }
            sources[i] = {
              ...src,
              maximization: {
                volumeMaximizationAction: action,
                projectedVolume30d,
                volumeUplift,
                volumeMaximizationLevers: levers,
                qualityMaintenanceStrategy,
                capitalRequirement,
                timeRequirement,
                volumeGrowthProjection: projection,
              },
            };
            overridden += 1;
          }
          if (overridden > 0) {
            portfolio = buildPortfolio(sources);
          }
        }

        // Override portfolio
        if (parsed.portfolio && typeof parsed.portfolio === 'object') {
          if (typeof parsed.portfolio.bestVolumeSource === 'string') {
            portfolio = {
              ...portfolio,
              bestVolumeSource: clampString(
                parsed.portfolio.bestVolumeSource, 100,
                portfolio.bestVolumeSource ?? '',
              ) || portfolio.bestVolumeSource,
            };
          }
          if (typeof parsed.portfolio.volumeDiversificationAdvice === 'string'
              && parsed.portfolio.volumeDiversificationAdvice.trim()) {
            portfolio = {
              ...portfolio,
              volumeDiversificationAdvice: clampString(
                parsed.portfolio.volumeDiversificationAdvice, 400,
                portfolio.volumeDiversificationAdvice,
              ),
            };
          }
        }

        summary = clampString(parsed.summary, 400, buildSummary(portfolio, sources.length));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/deal-source-volume-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { sources, portfolio, summary });
    }

    return NextResponse.json({
      ok: true,
      sources,
      portfolio,
      summary,
      aiUsed,
    } satisfies DealSourceVolumeResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/deal-source-volume-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
