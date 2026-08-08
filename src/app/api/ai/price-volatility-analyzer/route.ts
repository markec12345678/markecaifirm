// v7.86: AI Price Volatility Analyzer — AI analizira PRICE VOLATILITY
// (nihanje cen) čez kategorije zadnjih 90 dni. Meri coefficient of variation
// (stddev / mean × 100) tedenskih povprečnih cen, identifies high-volatility
// (risky but profitable) vs low-volatility (safe but lower profit) kategorije.
// "Elektronika: HIGH volatility (22%), AGGRESSIVE. Buy low, sell quick. Avto:
// VERY_LOW (3%), hold longer."
//
// Razlika od market-trend-momentum (v7.73 ki gleda ACCELERATION cen) — ta meri
// VOLATILITY (stddev cen) in classification VERY_HIGH..VERY_LOW. Razlika od
// market-trend (rising/falling prices) — ta gleda MAGNITUDE nihanja ne smer.
// Razlika od market-trend-forecaster-pro (v7.78 AI ki forecast-a future trend)
// — ta analizira HISTORICAL volatility in risk profile per category. Razlika
// od deal-quality-trend-analyzer (v7.83 pure DB ki analizira quality trends)
// — ta gleda CENOVNO volatilnost ne quality. Razlika od price-elasticity
// (ki meri kako demand odgovarja na ceno) — ta meri kako cene NIHajo čez čas.
// Razlika od price-history-forecaster (v7.83 ki forecast-a future cene) — ta
// meri HISTORICAL volatility coefficient of variation.
//
// GET+POST /api/ai/price-volatility-analyzer
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

type VolatilityLevel =
  | 'VERY_HIGH'
  | 'HIGH'
  | 'MODERATE'
  | 'LOW'
  | 'VERY_LOW';
type RiskProfile = 'AGGRESSIVE' | 'BALANCED' | 'CONSERVATIVE';
type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

interface CategoryVolatility {
  category: string;
  priceVolatility: number; // % coefficient of variation
  volatilityLevel: VolatilityLevel;
  riskProfile: RiskProfile;
  priceRange: { min: number; max: number };
  priceChangePercent: number; // % over 90d
  priceDropFrequency: number; // % listings with priceDroppedAt set
  weeklyAvgPrices: number[]; // 13 weeks
  listingCount: number;
  tradingStrategy: string;
  arbitragePotential: number; // 0-100
}

interface BestWorstCategory {
  category: string;
  volatility: number;
  reasoning: string;
}

interface RiskMitigationAction {
  action: string;
  priority: ActionPriority;
  detail: string;
}

interface VolatilityAnalysis {
  volatilityAssessment: string;
  bestVolatilityCategories: BestWorstCategory[];
  worstVolatilityCategories: BestWorstCategory[];
  riskMitigationActions: RiskMitigationAction[];
}

interface AiVolatilityResponse {
  analysis?: unknown;
  summary?: unknown;
  categoriesPatch?: unknown;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_90D = 90 * DAY_MS;
const WEEK_MS = 7 * DAY_MS;
const VOLATILITY_MIN = 0;
const VOLATILITY_MAX = 200;
const ARBITRAGE_MIN = 0;
const ARBITRAGE_MAX = 100;

const VALID_PRIORITY: readonly ActionPriority[] = ['HIGH', 'MEDIUM', 'LOW'];

// --- Helpers -------------------------------------------------------------

function clampNumber(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw == null) return Math.max(min, Math.min(max, fallback));
  const v = Number(raw);
  if (!Number.isFinite(v)) return Math.max(min, Math.min(max, fallback));
  return Math.max(min, Math.min(max, v));
}

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
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '_');
  for (const v of valid) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
}

function round0(v: number): number {
  return Math.round(v);
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function toMs(d: Date | null | undefined): number {
  if (!d) return 0;
  try {
    return new Date(d as unknown as Date | string).getTime();
  } catch {
    return 0;
  }
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = avg(values);
  const variance =
    values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / values.length;
  return Math.sqrt(variance);
}

// Coefficient of variation (stddev / mean × 100) — relative volatility
function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const m = avg(values);
  if (m <= 0) return 0;
  return (stdDev(values) / m) * 100;
}

function classifyVolatilityLevel(cv: number): VolatilityLevel {
  if (cv > 30) return 'VERY_HIGH';
  if (cv > 20) return 'HIGH';
  if (cv > 10) return 'MODERATE';
  if (cv > 5) return 'LOW';
  return 'VERY_LOW';
}

function classifyRiskProfile(level: VolatilityLevel): RiskProfile {
  if (level === 'VERY_HIGH' || level === 'HIGH') return 'AGGRESSIVE';
  if (level === 'MODERATE') return 'BALANCED';
  return 'CONSERVATIVE';
}

// Deterministic trading strategy from volatility level
function strategyForLevel(level: VolatilityLevel): string {
  switch (level) {
    case 'VERY_HIGH':
      return 'Zelo visoka volatilnost — kupuj na dnevih z nizkimi cenami, prodaj hitro ko cena poskoči. Watch for dips, hitre flip operacije. Visoko tveganje, visok profit.';
    case 'HIGH':
      return 'Visoka volatilnost — kupuj nizko, prodaj hitro. Spremljaj cenovne padce (priceDroppedAt) in izkoristi kratka okna za arbitražo.';
    case 'MODERATE':
      return 'Zmerna volatilnost — uravnotežena strategija: drži 1-3 tedne, izkoristi manjše nihaje. Varnoendar donosno.';
    case 'LOW':
      return 'Nizka volatilnost — drži dlje (3-6 tednov), stabilne marže. Počasen a varen profit.';
    case 'VERY_LOW':
      return 'Zelo nizka volatilnost — cene praktično stabilne. Drži dolgo, konstantne marže. Minimalno tveganje, minimalni profit.';
    default:
      return 'Strategija odvisna od volatilnosti.';
  }
}

// Deterministic arbitrage potential 0-100 from volatility + priceDropFreq
// Higher volatility + more drops = more arbitrage opportunity
function computeArbitragePotential(
  volatility: number,
  priceDropFreq: number,
): number {
  // Volatility contributes up to 60 points (saturates at 30%)
  const volScore = Math.max(0, Math.min(60, (volatility / 30) * 60));
  // Price drop frequency contributes up to 40 points
  const dropScore = Math.max(0, Math.min(40, (priceDropFreq / 100) * 40));
  return round0(Math.max(ARBITRAGE_MIN, Math.min(ARBITRAGE_MAX, volScore + dropScore)));
}

// --- Listing row --------------------------------------------------------

interface ListingRow {
  id: string;
  price: number | null;
  firstSeenAt: Date;
  priceDroppedAt: Date | null;
  monitor: { source: string | null } | null;
}

interface CategoryWeeklyAgg {
  category: string;
  weeklyPrices: Map<number, { sum: number; count: number }>; // weekIndex → agg
  priceMin: number;
  priceMax: number;
  totalListings: number;
  droppedCount: number;
  firstSeenMsMin: number;
  firstSeenMsMax: number;
}

// Group listings by category (= monitor source as proxy for category), then bucket by ISO week (0..12 from oldest week)
function aggregateByCategoryAndWeek(
  listings: ListingRow[],
  now: number,
): Map<string, CategoryWeeklyAgg> {
  const cutoff = now - HORIZON_90D;
  const catMap = new Map<string, CategoryWeeklyAgg>();

  for (const l of listings) {
    if (l.price == null || l.price <= 0) continue;
    const seen = toMs(l.firstSeenAt);
    if (seen <= 0 || seen < cutoff) continue;
    // Listings don't have a `category` field — use monitor.source as the
    // category proxy (each source = one trading category, e.g. bolha/vinted/mobile.de).
    const category = (l.monitor?.source ?? '').trim().toLowerCase() || 'neznan';
    const weekIndex = Math.floor((seen - cutoff) / WEEK_MS);
    if (weekIndex < 0 || weekIndex > 12) continue;

    let agg = catMap.get(category);
    if (!agg) {
      agg = {
        category,
        weeklyPrices: new Map<number, { sum: number; count: number }>(),
        priceMin: Number.POSITIVE_INFINITY,
        priceMax: Number.NEGATIVE_INFINITY,
        totalListings: 0,
        droppedCount: 0,
        firstSeenMsMin: seen,
        firstSeenMsMax: seen,
      };
      catMap.set(category, agg);
    }
    let w = agg.weeklyPrices.get(weekIndex);
    if (!w) {
      w = { sum: 0, count: 0 };
      agg.weeklyPrices.set(weekIndex, w);
    }
    w.sum += l.price;
    w.count += 1;
    if (l.price < agg.priceMin) agg.priceMin = l.price;
    if (l.price > agg.priceMax) agg.priceMax = l.price;
    agg.totalListings += 1;
    if (l.priceDroppedAt != null) agg.droppedCount += 1;
    if (seen < agg.firstSeenMsMin) agg.firstSeenMsMin = seen;
    if (seen > agg.firstSeenMsMax) agg.firstSeenMsMax = seen;
  }

  return catMap;
}

// Build a 13-element array of weekly avg prices (fill gaps with previous week)
function buildWeeklyAvgPrices(
  agg: CategoryWeeklyAgg,
): number[] {
  const out: number[] = [];
  let lastVal = 0;
  for (let i = 0; i < 13; i++) {
    const w = agg.weeklyPrices.get(i);
    if (w && w.count > 0) {
      const v = w.sum / w.count;
      out.push(round1(v));
      lastVal = v;
    } else {
      // gap fill — use last known value (or 0 if none yet)
      out.push(round1(lastVal));
    }
  }
  return out;
}

// Compute category volatility record (deterministic)
function buildCategoryVolatility(
  agg: CategoryWeeklyAgg,
): CategoryVolatility {
  const weeklyAvg = buildWeeklyAvgPrices(agg);
  const volatility = round1(coefficientOfVariation(weeklyAvg));
  const clampedVol = Math.max(VOLATILITY_MIN, Math.min(VOLATILITY_MAX, volatility));
  const level = classifyVolatilityLevel(clampedVol);
  const risk = classifyRiskProfile(level);
  const priceRange = {
    min: round0(Math.min(agg.priceMin, agg.priceMax)),
    max: round0(Math.max(agg.priceMin, agg.priceMax)),
  };
  // Price change percent: latest week avg vs first week avg
  const first = weeklyAvg[0] ?? 0;
  const last = weeklyAvg[weeklyAvg.length - 1] ?? 0;
  const priceChangePercent =
    first > 0 ? round1(((last - first) / first) * 100) : 0;
  const priceDropFrequency =
    agg.totalListings > 0
      ? round1((agg.droppedCount / agg.totalListings) * 100)
      : 0;
  const arbitrage = computeArbitragePotential(clampedVol, priceDropFrequency);
  const strategy = strategyForLevel(level);
  return {
    category: agg.category,
    priceVolatility: clampedVol,
    volatilityLevel: level,
    riskProfile: risk,
    priceRange,
    priceChangePercent,
    priceDropFrequency,
    weeklyAvgPrices: weeklyAvg,
    listingCount: agg.totalListings,
    tradingStrategy: strategy,
    arbitragePotential: arbitrage,
  };
}

// Deterministic risk mitigation actions from category mix
function buildDeterministicActions(
  cats: CategoryVolatility[],
): RiskMitigationAction[] {
  const actions: RiskMitigationAction[] = [];
  const veryHigh = cats.filter((c) => c.volatilityLevel === 'VERY_HIGH');
  const high = cats.filter((c) => c.volatilityLevel === 'HIGH');
  const veryLow = cats.filter((c) => c.volatilityLevel === 'VERY_LOW');
  const aggressiveCount = veryHigh.length + high.length;
  const conservativeCount = veryLow.length;

  if (veryHigh.length > 0) {
    actions.push({
      action: `Zmanjšaj izpostavljenost zelo visoko volatilnim kategorijam (${veryHigh.slice(0, 3).map((c) => c.category).join(', ')})`,
      priority: 'HIGH',
      detail: `VERY_HIGH volatilnost (>30%) pomeni veliko tveganje izgube. Omeji kapital na max 15% portfolija v teh kategorijah in diversificiraj.`,
    });
  }
  if (high.length > 0) {
    actions.push({
      action: `Spremljaj cenovne padce v visoko volatilnih kategorijah (${high.slice(0, 3).map((c) => c.category).join(', ')})`,
      priority: 'MEDIUM',
      detail: `HIGH volatilnost (20-30%) omogoča hitre flip-e. Postavi alert na priceDroppedAt in kupuj na dnevih z nizkimi cenami.`,
    });
  }
  if (aggressiveCount > conservativeCount && aggressiveCount >= 2) {
    actions.push({
      action: 'Diversificiraj v nizko-volatilne kategorije za stabilnost portfolija',
      priority: 'MEDIUM',
      detail: `Portfolio je preveč AGGRESSIVE (${aggressiveCount} visoko-volatilnih kategorij). Dodaj CONSERVATIVE kategorije za zmanjšanje portfolia variance.`,
    });
  }
  if (veryLow.length > cats.length / 2) {
    actions.push({
      action: 'Premakni del kapitala v višje-volatilne kategorije za višje profite',
      priority: 'LOW',
      detail: `Portfolio je preveč CONSERVATIVE (${veryLow.length} VERY_LOW kategorij). Premajhen profit potencial — premakni 20-30% v MODERATE kategorije.`,
    });
  }
  const highArb = cats.filter((c) => c.arbitragePotential >= 60);
  if (highArb.length > 0) {
    actions.push({
      action: `Izkoristi arbitražne priložnosti v kategorijah z visokim potencialom (${highArb.slice(0, 2).map((c) => c.category).join(', ')})`,
      priority: 'HIGH',
      detail: `Arbitražni potencial ≥60/100 pomeni pogoste cenovne razlike znotraj kategorije. Cross-platform listing ali hitri flip-i znotraj kategorije.`,
    });
  }
  if (actions.length === 0) {
    actions.push({
      action: 'Vzdržuj trenutno strategijo in monitor volatilnost čez naslednje 30 dni',
      priority: 'LOW',
      detail: 'Brez izrazitih tveganj — kategorije so v uravnoteženem volatilnostnem razponu.',
    });
  }
  return actions.slice(0, 4);
}

// Deterministic best/worst categories
function buildDeterministicBestWorst(
  cats: CategoryVolatility[],
): { best: BestWorstCategory[]; worst: BestWorstCategory[] } {
  if (cats.length === 0) {
    return { best: [], worst: [] };
  }
  // Best: optimal risk/reward — MODERATE or LOW volatility with high arbitrage
  // (sweet spot: not too risky, decent profit potential)
  const scored = cats.map((c) => {
    let score = 0;
    // Sweet spot: MODERATE (10-20%) volatility gets highest score
    if (c.volatilityLevel === 'MODERATE') score += 50;
    else if (c.volatilityLevel === 'LOW') score += 40;
    else if (c.volatilityLevel === 'HIGH') score += 30;
    else if (c.volatilityLevel === 'VERY_LOW') score += 15;
    else if (c.volatilityLevel === 'VERY_HIGH') score += 10;
    score += c.arbitragePotential * 0.5;
    // Listing count: more listings = more reliable data + more opportunities
    if (c.listingCount >= 20) score += 10;
    return { c, score };
  });
  const best = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ c }) => ({
      category: c.category,
      volatility: c.priceVolatility,
      reasoning: `${c.volatilityLevel} volatilnost (${c.priceVolatility}%), ${c.riskProfile} profil. Arbitražni potencial ${c.arbitragePotential}/100. ${c.listingCount} oglasov — ${c.listingCount >= 20 ? 'zanesljivi podatki' : 'omejeni podatki'}.`,
    }));
  // Worst: VERY_HIGH (too risky) or VERY_LOW (no profit opportunity)
  const worst = [...scored]
    .filter(({ c }) => c.volatilityLevel === 'VERY_HIGH' || c.volatilityLevel === 'VERY_LOW')
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(({ c }) => ({
      category: c.category,
      volatility: c.priceVolatility,
      reasoning:
        c.volatilityLevel === 'VERY_HIGH'
          ? `VERY_HIGH volatilnost (${c.priceVolatility}%) — preveliko tveganje, nepredvidljivi profit. Premakni v stabilnejše kategorije.`
          : `VERY_LOW volatilnost (${c.priceVolatility}%) — premajhna profitna priložnost, cene praktično stabilne. Drži samo za dolgoročne investicije.`,
    }));
  return { best, worst };
}

// Deterministic full analysis (fallback when AI unavailable)
function buildDeterministicAnalysis(
  cats: CategoryVolatility[],
): VolatilityAnalysis {
  const { best, worst } = buildDeterministicBestWorst(cats);
  const actions = buildDeterministicActions(cats);

  const veryHigh = cats.filter((c) => c.volatilityLevel === 'VERY_HIGH').length;
  const high = cats.filter((c) => c.volatilityLevel === 'HIGH').length;
  const moderate = cats.filter((c) => c.volatilityLevel === 'MODERATE').length;
  const low = cats.filter((c) => c.volatilityLevel === 'LOW').length;
  const veryLow = cats.filter((c) => c.volatilityLevel === 'VERY_LOW').length;
  const avgVol =
    cats.length > 0 ? round1(cats.reduce((s, c) => s + c.priceVolatility, 0) / cats.length) : 0;

  const assessment =
    cats.length === 0
      ? 'Ni oglasov z ceno v zadnjih 90 dneh — Price Volatility Analyzer ni mogoč.'
      : `Analiziranih ${cats.length} kategorij. Povprečna volatilnost ${avgVol}%. ` +
        `VERY_HIGH: ${veryHigh}, HIGH: ${high}, MODERATE: ${moderate}, LOW: ${low}, VERY_LOW: ${veryLow}. ` +
        (veryHigh + high > moderate + low
          ? 'Portfolio je pretežno AGGRESSIVE — visoko tveganje, visok profit potencial.'
          : veryLow + low > moderate
            ? 'Portfolio je pretežno CONSERVATIVE — stabilnoendar manjši profit.'
            : 'Portfolio je uravnotežen — mešanica tveganj in donosov.');

  return {
    volatilityAssessment: assessment,
    bestVolatilityCategories: best,
    worstVolatilityCategories: worst,
    riskMitigationActions: actions,
  };
}

// Deterministic summary
function buildDeterministicSummary(
  cats: CategoryVolatility[],
  analysis: VolatilityAnalysis,
): string {
  if (cats.length === 0) {
    return 'Ni oglasov z ceno v zadnjih 90 dneh — Price Volatility Analyzer ni mogoč.';
  }
  const best = analysis.bestVolatilityCategories[0];
  const worst = analysis.worstVolatilityCategories[0];
  const top = [...cats].sort((a, b) => b.priceVolatility - a.priceVolatility)[0]!;
  const parts: string[] = [
    `${cats.length} kategorij analiziranih. Najvišja volatilnost: ${top.category} (${top.priceVolatility}%, ${top.volatilityLevel}).`,
  ];
  if (best) {
    parts.push(`Optimalna: ${best.category} (${best.volatility}%).`);
  }
  if (worst) {
    parts.push(`Begaj: ${worst.category} (${worst.volatility}%).`);
  }
  return parts.join(' ');
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handlePriceVolatilityAnalyzer(req);
}
export async function POST(req: NextRequest) {
  return handlePriceVolatilityAnalyzer(req);
}

async function handlePriceVolatilityAnalyzer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-price-volatility-analyzer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const cutoff = new Date(now - HORIZON_90D);

    // 1) Query listings from last 90 days with price + firstSeenAt + monitor source
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: cutoff },
        isHidden: false,
        price: { gt: 0 },
      },
      select: {
        id: true,
        price: true,
        firstSeenAt: true,
        priceDroppedAt: true,
        monitor: { select: { source: true } },
      },
      orderBy: { firstSeenAt: 'asc' },
      take: 100000,
    });

    const rows = listings as unknown as ListingRow[];

    // 2) Aggregate by category × week (13 weeks)
    const catMap = aggregateByCategoryAndWeek(rows, now);

    // 3) Compute per-category volatility (deterministic)
    const categories: CategoryVolatility[] = Array.from(catMap.values())
      .map((agg) => buildCategoryVolatility(agg))
      .sort((a, b) => b.priceVolatility - a.priceVolatility);

    // Empty state
    if (categories.length === 0) {
      return NextResponse.json({
        ok: true,
        categories: [],
        analysis: {
          volatilityAssessment:
            'Ni oglasov z ceno v zadnjih 90 dneh — Price Volatility Analyzer ni mogoč.',
          bestVolatilityCategories: [],
          worstVolatilityCategories: [],
          riskMitigationActions: [],
        },
        summary:
          'Ni oglasov z ceno v zadnjih 90 dneh — Price Volatility Analyzer ni mogoč.',
        aiUsed: false,
        message:
          'Ni oglasov z ceno v zadnjih 90 dneh — Price Volatility Analyzer ni mogoč.',
      });
    }

    // Deterministic analysis (fallback)
    const detAnalysis = buildDeterministicAnalysis(categories);
    const detSummary = buildDeterministicSummary(categories, detAnalysis);
    let analysis = detAnalysis;
    let finalSummary = detSummary;

    // 4) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now);
    const monthKey = `${currentMonth.getFullYear()}-${(currentMonth.getMonth() + 1)
      .toString()
      .padStart(2, '0')}`;
    const cacheKey = `price-volatility-analyzer:${monthKey}`;
    const cached = getCachedAI<{
      analysis: VolatilityAnalysis;
      summary: string;
      categoriesPatch?: Array<{
        category: string;
        tradingStrategy: string;
        arbitragePotential: number;
      }>;
    }>(cacheKey);
    if (cached) {
      // Apply AI patch to categories (tradingStrategy, arbitragePotential)
      if (cached.categoriesPatch) {
        const patchMap = new Map(
          cached.categoriesPatch.map((p) => [p.category, p]),
        );
        for (const c of categories) {
          const p = patchMap.get(c.category);
          if (p) {
            c.tradingStrategy = p.tradingStrategy;
            c.arbitragePotential = Math.max(
              ARBITRAGE_MIN,
              Math.min(ARBITRAGE_MAX, p.arbitragePotential),
            );
          }
        }
      }
      return NextResponse.json({
        ok: true,
        categories,
        analysis: cached.analysis,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 5) AI prompt with grounding
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

    // Build compact AI prompt data (top 8 categories by listing count, all relevant fields)
    const topCats = [...categories]
      .sort((a, b) => b.listingCount - a.listingCount)
      .slice(0, 8)
      .map((c) => ({
        category: c.category,
        priceVolatility: c.priceVolatility,
        volatilityLevel: c.volatilityLevel,
        riskProfile: c.riskProfile,
        priceRange: c.priceRange,
        priceChangePercent: c.priceChangePercent,
        priceDropFrequency: c.priceDropFrequency,
        weeklyAvgPrices: c.weeklyAvgPrices,
        listingCount: c.listingCount,
        deterministicStrategy: c.tradingStrategy,
        deterministicArbitrage: c.arbitragePotential,
      }));

    const promptData = {
      totalCategories: categories.length,
      totalListings: rows.length,
      avgVolatility: round1(
        categories.reduce((s, c) => s + c.priceVolatility, 0) / categories.length,
      ),
      categories: topCats,
      deterministicAnalysis: {
        volatilityAssessment: detAnalysis.volatilityAssessment,
        bestVolatilityCategories: detAnalysis.bestVolatilityCategories,
        worstVolatilityCategories: detAnalysis.worstVolatilityCategories,
        riskMitigationActions: detAnalysis.riskMitigationActions,
      },
    };

    const prompt = `Si AI "Price Volatility Analyzer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Analiziraš CENOVNO VOLATILNOST (coefficient of variation = stddev / mean × 100 tedenskih povprečnih cen) čez kategorije zadnjih 90 dni.

DETERMINISTIČNI PODATKI (izračunano iz DB):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. categoriesPatch: array of { category (max 60), tradingStrategy (max 250, slovensko), arbitragePotential: 0-100 }
   - Za vsako od top kategorij izboljšaj tradingStrategy z AI vpogledom (glede na volatilityLevel in priceChangePercent).
   - HIGH_VOL (VERY_HIGH/HIGH): kupuj nizko, prodaj hitro, watch for dips, hitre flip operacije.
   - LOW_VOL (LOW/VERY_LOW): drži dlje, stabilne marže, dolgoročno.
   - MODERATE: uravnotežena strategija.
   - arbitragePotential: ±20 od deterministične vrednosti, clamped [0, 100]. Višja volatilnost + višja priceDropFrequency = višji arbitrage potential.
2. analysis: {
   - volatilityAssessment: slovenski povzetek (max 500 znakov) — kaj volatilnost pomeni za trading decisions. NE izmišljuj številk — uporabi zgornje deterministične.
   - bestVolatilityCategories: 2-3 kategorije z OPTIMALNIM risk/reward razmerjem (max 3) z { category, volatility, reasoning (max 250) }
     * Optimalna = MODERATE ali LOW volatilnost z visokim arbitragePotential (ne premajhna profit priložnost, ne preveliko tveganje).
   - worstVolatilityCategories: 2-3 kategorije ki so preveč tveganje (VERY_HIGH) ali premajhna profit priložnost (VERY_LOW) z { category, volatility, reasoning (max 250) }
   - riskMitigationActions: 3-4 akcije za zaščito proti volatilnosti z { action (max 200), priority: HIGH|MEDIUM|LOW, detail (max 250) }
3. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "categoriesPatch": [
    { "category": "elektronika", "tradingStrategy": "HIGH volatilnost — kupuj nizko, prodaj hitro. Watch for dips.", "arbitragePotential": 75 }
  ],
  "analysis": {
    "volatilityAssessment": "Portfolio je...",
    "bestVolatilityCategories": [
      { "category": "mobilni_telefoni", "volatility": 15, "reasoning": "MODERATE volatilnost, visok arbitrage potential." }
    ],
    "worstVolatilityCategories": [
      { "category": "avto_deli", "volatility": 45, "reasoning": "VERY_HIGH volatilnost — preveliko tveganje." }
    ],
    "riskMitigationActions": [
      { "action": "Diversificiraj...", "priority": "HIGH", "detail": "Zmanjšaj izpostavljenost VERY_HIGH kategorijam." }
    ]
  },
  "summary": "Analiziranih 8 kategorij. Povprečna volatilnost 18%. Najboljša: mobilni_telefoni."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(
        raw,
      ) as AiVolatilityResponse | null;

      if (parsed && typeof parsed === 'object') {
        // 1) categoriesPatch — apply AI tradingStrategy and arbitragePotential
        if (Array.isArray(parsed.categoriesPatch)) {
          const patchMap = new Map<string, { tradingStrategy: string; arbitragePotential: number }>();
          for (const p of parsed.categoriesPatch as unknown[]) {
            const pr = p as Record<string, unknown>;
            if (!pr || typeof pr !== 'object') continue;
            const cat = clampString(pr.category, 60, '');
            if (!cat) continue;
            const strategy = clampString(pr.tradingStrategy, 250, '');
            const arbRaw = clampNumber(
              pr.arbitragePotential,
              ARBITRAGE_MIN,
              ARBITRAGE_MAX,
              50,
            );
            // ±20 from deterministic
            const existing = categories.find((c) => c.category === cat);
            if (existing && strategy) {
              const adjArb = Math.max(
                ARBITRAGE_MIN,
                Math.min(
                  ARBITRAGE_MAX,
                  existing.arbitragePotential + Math.max(-20, Math.min(20, arbRaw - existing.arbitragePotential)),
                ),
              );
              patchMap.set(cat, {
                tradingStrategy: strategy,
                arbitragePotential: round0(adjArb),
              });
            }
          }
          for (const c of categories) {
            const p = patchMap.get(c.category);
            if (p) {
              c.tradingStrategy = p.tradingStrategy;
              c.arbitragePotential = p.arbitragePotential;
            }
          }
        }

        // 2) analysis override (with anti-hallucination)
        if (parsed.analysis && typeof parsed.analysis === 'object') {
          const a = parsed.analysis as Record<string, unknown>;

          if (typeof a.volatilityAssessment === 'string' && a.volatilityAssessment.trim()) {
            analysis.volatilityAssessment = clampString(
              a.volatilityAssessment,
              500,
              detAnalysis.volatilityAssessment,
            );
          }

          if (Array.isArray(a.bestVolatilityCategories)) {
            const aiBest = (a.bestVolatilityCategories as unknown[])
              .map((b: unknown) => {
                const br = b as Record<string, unknown>;
                if (!br || typeof br !== 'object') return null;
                const category = clampString(br.category, 60, '');
                if (!category) return null;
                const existing = categories.find((c) => c.category === category);
                const volatility = clampNumber(
                  br.volatility,
                  VOLATILITY_MIN,
                  VOLATILITY_MAX,
                  existing?.priceVolatility ?? 0,
                );
                const reasoning = clampString(br.reasoning, 250, '');
                if (!reasoning) return null;
                return { category, volatility: round1(volatility), reasoning };
              })
              .filter((b): b is BestWorstCategory => b !== null)
              .slice(0, 3);
            if (aiBest.length > 0) analysis.bestVolatilityCategories = aiBest;
          }

          if (Array.isArray(a.worstVolatilityCategories)) {
            const aiWorst = (a.worstVolatilityCategories as unknown[])
              .map((b: unknown) => {
                const br = b as Record<string, unknown>;
                if (!br || typeof br !== 'object') return null;
                const category = clampString(br.category, 60, '');
                if (!category) return null;
                const existing = categories.find((c) => c.category === category);
                const volatility = clampNumber(
                  br.volatility,
                  VOLATILITY_MIN,
                  VOLATILITY_MAX,
                  existing?.priceVolatility ?? 0,
                );
                const reasoning = clampString(br.reasoning, 250, '');
                if (!reasoning) return null;
                return { category, volatility: round1(volatility), reasoning };
              })
              .filter((b): b is BestWorstCategory => b !== null)
              .slice(0, 3);
            if (aiWorst.length > 0) analysis.worstVolatilityCategories = aiWorst;
          }

          if (Array.isArray(a.riskMitigationActions)) {
            const aiActions = (a.riskMitigationActions as unknown[])
              .map((ac: unknown) => {
                const a2 = ac as Record<string, unknown>;
                if (!a2 || typeof a2 !== 'object') return null;
                const action = clampString(a2.action, 200, '');
                if (!action) return null;
                const priority = clampEnum(a2.priority, VALID_PRIORITY, 'MEDIUM');
                const detail = clampString(a2.detail, 250, '');
                if (!detail) return null;
                return { action, priority, detail };
              })
              .filter((ac): ac is RiskMitigationAction => ac !== null)
              .slice(0, 4);
            if (aiActions.length > 0) analysis.riskMitigationActions = aiActions;
          }
        }

        // 3) summary
        if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
          finalSummary = clampString(parsed.summary, 400, detSummary);
        }

        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/price-volatility-analyzer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 6) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        analysis,
        summary: finalSummary,
        categoriesPatch: categories.map((c) => ({
          category: c.category,
          tradingStrategy: c.tradingStrategy,
          arbitragePotential: c.arbitragePotential,
        })),
      });
    }

    return NextResponse.json({
      ok: true,
      categories,
      analysis,
      summary: finalSummary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error(
      '/api/ai/price-volatility-analyzer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
