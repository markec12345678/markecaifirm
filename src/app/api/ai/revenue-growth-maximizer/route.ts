// v8.01 / v8.96.5-batch2: AI Revenue Growth Maximizer — AI maksimizira REVENUE GROWTH (top-line
// revenue, ne samo profit). "Your revenue is 5000€/mo but could be 12,000€/mo
// with 3 expansion actions." Fokus na total revenue growth, expansion v nove
// kategorije, scaling trade volume in diversifikacijo revenue streams.
//
// Razlika od profit-multiplier-engine (v8.00 ki MULTIPLICIRA profit z 8 levers)
// — ta MAXIMIZIRA REVENUE (top-line sales), ne profit. Razlika od
// deal-source-roi-maximizer (v8.00 ki maksimizira ROI per source) — ta
// fokusira na REVENUE GROWTH rate in category expansion (ne ROI %). Razlika
// od inventory-turnover-profit-maximizer (v8.00 ki maksimizira turnover-profit
// balance) — ta maksimizira TOTAL REVENUE preko volume scaling in category
// expansion (ne optimal turnover). Razlika od capital-growth-maximizer (v7.99
// ki maksimizira capital growth) — ta maksimizira REVENUE (top-line), ne
// capital. Razlika od revenue-stream-optimizer (v7.94 ki optimira revenue
// streams) — ta MAXIMIZIRA revenue z growth actions in category expansion +
// 3m/6m/12m projection + timeToDoubleRevenue. Razlika od profit-maximizer-pro
// (v7.94 ki maksimizira profit z 7 levers) — ta maksimizira REVENUE (ne profit)
// — different focus (top-line vs bottom-line). Razlika od deal-source-profit-
// maximizer (v7.97 ki maksimizira profit per source) — ta daje UNIFIED revenue
// growth engine (ne per-source profit).
//
// "Current: 5000€/mo revenue, growth 8%/mo, 12 trades/mo, avgRevenuePerTrade
// 417€. Maximization: 12,000€/mo (2.4x multiplier), 3 growth actions (expand
// to mobile.de +3500€, increase trade volume to 24/mo +2500€, raise prices
// +1000€). Projection 3m: 16500€, 6m: 24000€, 12m: 58000€. Category expansion:
// electronics (+2800€/mo), automotive (+1500€/mo). Volume scaling: 12→24
// trades/mo (2x). Diversification: Bolha 70% → Bolha 40% + Vinted 30% + mobile.
// de 30%. Grade A. Time to double revenue: 87 days."

// GET+POST /api/ai/revenue-growth-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.5) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Input ----------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface RevenueGrowthMaximizerInput {}

// --- Types ---------------------------------------------------------------

type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
type RevenueGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

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

interface RevenueStream {
  source: string;
  percentage: number;
  revenue: number;
}

interface CurrentRevenue {
  currentMonthlyRevenue: number;
  revenueGrowthRate: number;
  avgRevenuePerTrade: number;
  tradeVolumePerMonth: number;
  revenueStreams: RevenueStream[];
}

interface GrowthAction {
  action: string;
  expectedRevenueGain: number;
  priority: Priority;
  difficulty: Difficulty;
}

interface CategoryExpansion {
  category: string;
  potentialRevenue: number;
  reasoning: string;
}

interface Maximization {
  maximizedMonthlyRevenue: number;
  revenueGrowthMultiplier: number;
  growthActions: GrowthAction[];
  revenueProjection3m: number;
  revenueProjection6m: number;
  revenueProjection12m: number;
  categoryExpansionOpportunities: CategoryExpansion[];
  volumeScalingPlan: string;
  revenueDiversificationStrategy: string;
  revenueGrowthGrade: RevenueGrade;
  timeToDoubleRevenue: number;
}

interface RevenueGrowthResponse {
  ok: true;
  current: CurrentRevenue;
  maximization: Maximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  growthActions?: Array<{
    action?: string;
    expectedRevenueGain?: number;
    priority?: Priority;
    difficulty?: Difficulty;
  }>;
  categoryExpansionOpportunities?: Array<{
    category?: string;
    potentialRevenue?: number;
    reasoning?: string;
  }>;
  volumeScalingPlan?: string;
  revenueDiversificationStrategy?: string;
  revenueGrowthGrade?: RevenueGrade;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;
const THREE_MONTHS_MS = 90 * DAY_MS;
const SIX_MONTHS_MS = 180 * DAY_MS;

const REVENUE_MIN = 0;
const REVENUE_MAX = 100_000; // 100k/mo ceiling
const MULT_MIN = 1.0;
const MULT_MAX = 5.0; // up to 5x revenue growth multiplier
const GROWTH_RATE_MIN = 0;
const GROWTH_RATE_MAX = 200; // %/mo
const GAIN_MIN = 0;
const GAIN_MAX = 50_000;
const DAYS_MIN = 1;
const DAYS_MAX = 3650; // 10 years
const PERCENTAGE_MIN = 0;
const PERCENTAGE_MAX = 100;

const VALID_DIFFICULTY: readonly Difficulty[] = ['EASY', 'MEDIUM', 'HARD'];
const VALID_PRIORITY: readonly Priority[] = ['HIGH', 'MEDIUM', 'LOW'];
const VALID_GRADE: readonly RevenueGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

const MAX_GROWTH_ACTIONS = 6;
const MAX_CATEGORY_EXPANSIONS = 5;

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

interface SoldRevenueComputed {
  revenue: number; // net revenue (sellPrice - sellFees)
  sellMs: number;
  sellMonth: string; // YYYY-MM
  source: string;
  within3m: boolean;
  within6m: boolean;
  within12m: boolean;
}

function computeSoldRevenue(t: SoldTradeRow, now: number): SoldRevenueComputed | null {
  const sellPrice = t.sellPrice ?? 0;
  if (sellPrice <= 0) return null;
  const sellMs = toMs(t.sellDate);
  if (sellMs <= 0) return null;
  const sellFees = t.sellFees ?? 0;
  const revenue = sellPrice - sellFees;
  if (revenue <= 0) return null;
  const sellMonth = new Date(sellMs).toISOString().slice(0, 7);
  const source = t.listing?.monitor?.source?.trim() || 'unknown';
  const within3m = (now - sellMs) <= THREE_MONTHS_MS;
  const within6m = (now - sellMs) <= SIX_MONTHS_MS;
  const within12m = (now - sellMs) <= TWELVE_MONTHS_MS;
  return {
    revenue,
    sellMs,
    sellMonth,
    source,
    within3m,
    within6m,
    within12m,
  };
}

interface RevenueAgg {
  revenue3m: number;
  count3m: number;
  revenue6m: number;
  count6m: number;
  revenue12m: number;
  count12m: number;
  perMonth: Map<string, number>; // month → revenue
  perSource: Map<string, number>; // source → revenue (12m)
}

function aggregateRevenue(trades: SoldRevenueComputed[]): RevenueAgg {
  let revenue3m = 0;
  let count3m = 0;
  let revenue6m = 0;
  let count6m = 0;
  let revenue12m = 0;
  let count12m = 0;
  const perMonth = new Map<string, number>();
  const perSource = new Map<string, number>();
  for (const t of trades) {
    if (t.within3m) {
      revenue3m += t.revenue;
      count3m += 1;
    }
    if (t.within6m) {
      revenue6m += t.revenue;
      count6m += 1;
    }
    if (t.within12m) {
      revenue12m += t.revenue;
      count12m += 1;
      perSource.set(t.source, (perSource.get(t.source) ?? 0) + t.revenue);
    }
    perMonth.set(t.sellMonth, (perMonth.get(t.sellMonth) ?? 0) + t.revenue);
  }
  return {
    revenue3m,
    count3m,
    revenue6m,
    count6m,
    revenue12m,
    count12m,
    perMonth,
    perSource,
  };
}

function computeCurrent(agg: RevenueAgg): CurrentRevenue {
  // currentMonthlyRevenue = avg monthly revenue (last 6m preferred, fallback 12m)
  let currentMonthlyRevenue: number;
  if (agg.count6m > 0) {
    currentMonthlyRevenue = agg.revenue6m / 6;
  } else if (agg.count12m > 0) {
    currentMonthlyRevenue = agg.revenue12m / 12;
  } else {
    currentMonthlyRevenue = 0;
  }
  currentMonthlyRevenue = round0(clampNum(
    currentMonthlyRevenue, REVENUE_MIN, REVENUE_MAX, 0,
  ));

  // revenueGrowthRate = monthly growth %
  // Compare last 3 months avg revenue with previous 3 months avg revenue
  const sortedMonths = Array.from(agg.perMonth.keys()).sort();
  let revenueGrowthRate = 0;
  if (sortedMonths.length >= 2) {
    const lastIdx = sortedMonths.length - 1;
    // last 3 months avg vs previous 3 months avg
    const last3 = sortedMonths.slice(Math.max(0, lastIdx - 2), lastIdx + 1);
    const prev3 = sortedMonths.slice(Math.max(0, lastIdx - 5), Math.max(0, lastIdx - 2));
    if (last3.length > 0 && prev3.length > 0) {
      const last3Avg = last3.reduce((s, m) => s + (agg.perMonth.get(m) ?? 0), 0) / last3.length;
      const prev3Avg = prev3.reduce((s, m) => s + (agg.perMonth.get(m) ?? 0), 0) / prev3.length;
      if (prev3Avg > 0) {
        revenueGrowthRate = ((last3Avg - prev3Avg) / prev3Avg) * 100;
      }
    }
  }
  revenueGrowthRate = round2(clampNum(
    revenueGrowthRate, GROWTH_RATE_MIN, GROWTH_RATE_MAX, 0,
  ));

  const avgRevenuePerTrade = round0(clampNum(
    agg.count12m > 0 ? agg.revenue12m / agg.count12m : 0,
    REVENUE_MIN, REVENUE_MAX, 0,
  ));

  const tradeVolumePerMonth = round2(clampNum(
    agg.count12m > 0 ? agg.count12m / 12 : 0,
    0, 1000, 0,
  ));

  // Revenue streams: top sources by revenue
  const totalRev = agg.revenue12m;
  const revenueStreams: RevenueStream[] = [];
  if (totalRev > 0 && agg.perSource.size > 0) {
    const sorted = Array.from(agg.perSource.entries())
      .sort((a, b) => b[1] - a[1]);
    for (const [src, rev] of sorted.slice(0, 6)) {
      revenueStreams.push({
        source: displayName(src),
        percentage: round2((rev / totalRev) * 100),
        revenue: round0(rev),
      });
    }
  }

  return {
    currentMonthlyRevenue,
    revenueGrowthRate,
    avgRevenuePerTrade,
    tradeVolumePerMonth,
    revenueStreams,
  };
}

function decideGrade(multiplier: number): RevenueGrade {
  // multiplier [1.0, 5.0]
  // A+ if >= 3.5, A if >= 2.5, B if >= 1.8, C if >= 1.4, D if >= 1.15, else F
  if (multiplier >= 3.5) return 'A+';
  if (multiplier >= 2.5) return 'A';
  if (multiplier >= 1.8) return 'B';
  if (multiplier >= 1.4) return 'C';
  if (multiplier >= 1.15) return 'D';
  return 'F';
}

function buildDeterministicMaximization(
  current: CurrentRevenue,
  agg: RevenueAgg,
): Maximization {
  // Build 4 growth actions heuristically:
  // 1. Category expansion (always highest impact — diversification)
  // 2. Trade volume scaling
  // 3. Average revenue per trade uplift (premium pricing)
  // 4. New source addition (mobile.de / Vinted)

  const growthActions: GrowthAction[] = [];
  const monthlyRevenue = current.currentMonthlyRevenue;
  const streams = current.revenueStreams;

  // 1) Category expansion
  const catGain = round0(clampNum(
    monthlyRevenue * 0.7, GAIN_MIN, GAIN_MAX, 0,
  ));
  growthActions.push({
    action: 'Razširi se v novo kategorijo (elektronika ali avtomobilski deli) za dodatni revenue stream.',
    expectedRevenueGain: catGain,
    priority: 'HIGH',
    difficulty: 'MEDIUM',
  });

  // 2) Trade volume scaling (2x volume)
  const volumeGain = round0(clampNum(
    monthlyRevenue * 0.5, GAIN_MIN, GAIN_MAX, 0,
  ));
  growthActions.push({
    action: 'Povečaj trade volume iz ' + Math.round(current.tradeVolumePerMonth) + ' na ' + Math.round(current.tradeVolumePerMonth * 2) + ' trades/mo z bolj aktivnim sourcingom.',
    expectedRevenueGain: volumeGain,
    priority: 'HIGH',
    difficulty: 'MEDIUM',
  });

  // 3) Premium pricing
  const priceGain = round0(clampNum(
    current.avgRevenuePerTrade * current.tradeVolumePerMonth * 0.15, GAIN_MIN, GAIN_MAX, 0,
  ));
  growthActions.push({
    action: 'Dvigni povprečno prodajno ceno za 15% z premium pozicioniranjem in boljšo fotografijo.',
    expectedRevenueGain: priceGain,
    priority: 'MEDIUM',
    difficulty: 'EASY',
  });

  // 4) New source
  const topSourceShare = streams.length > 0 ? streams[0].percentage : 100;
  const sourceGain = round0(clampNum(
    monthlyRevenue * (topSourceShare > 70 ? 0.4 : 0.25), GAIN_MIN, GAIN_MAX, 0,
  ));
  growthActions.push({
    action: 'Dodaj nov source (mobile.de za automotive ali Vinted za fashion) za revenue diversifikacijo.',
    expectedRevenueGain: sourceGain,
    priority: topSourceShare > 70 ? 'HIGH' : 'MEDIUM',
    difficulty: 'HARD',
  });

  // Total gain
  const totalGain = growthActions.reduce((s, a) => s + a.expectedRevenueGain, 0);
  const maximizedMonthlyRevenue = round0(clampNum(
    monthlyRevenue + totalGain, REVENUE_MIN, REVENUE_MAX, monthlyRevenue,
  ));
  const revenueGrowthMultiplier = round2(clampNum(
    monthlyRevenue > 0 ? maximizedMonthlyRevenue / monthlyRevenue : 1,
    MULT_MIN, MULT_MAX, 1,
  ));

  // Projections (apply growth rate compounding)
  const growthRate = Math.max(0.05, current.revenueGrowthRate / 100);
  const proj3m = round0(clampNum(
    maximizedMonthlyRevenue * (1 + growthRate) * 3, REVENUE_MIN, REVENUE_MAX * 3, 0,
  ));
  const proj6m = round0(clampNum(
    maximizedMonthlyRevenue * (1 + growthRate * 1.5) * 6, REVENUE_MIN, REVENUE_MAX * 6, 0,
  ));
  const proj12m = round0(clampNum(
    maximizedMonthlyRevenue * (1 + growthRate * 2.5) * 12, REVENUE_MIN, REVENUE_MAX * 12, 0,
  ));

  // Category expansion opportunities
  const categoryExpansionOpportunities: CategoryExpansion[] = [
    {
      category: 'Elektronika',
      potentialRevenue: round0(clampNum(
        monthlyRevenue * 0.55, GAIN_MIN, GAIN_MAX, 0,
      )),
      reasoning: 'Visoka vrednost na trade, hitra prodaja. Bolha + Vinted imata močno demand za iPhone, MacBook, gaming konzole.',
    },
    {
      category: 'Avtomobilski deli',
      potentialRevenue: round0(clampNum(
        monthlyRevenue * 0.35, GAIN_MIN, GAIN_MAX, 0,
      )),
      reasoning: 'Avtonet + mobile.de imata visok avgRevenuePerTrade (800€+). Premium segment z močno profit margin.',
    },
    {
      category: 'Luxury fashion',
      potentialRevenue: round0(clampNum(
        monthlyRevenue * 0.3, GAIN_MIN, GAIN_MAX, 0,
      )),
      reasoning: 'Vinted + Vestiaire Collective — visok markup za prepoznavne znamke (Gucci, Prada, Louis Vuitton).',
    },
  ];

  // Volume scaling plan
  const targetVolume = Math.round(current.tradeVolumePerMonth * 2);
  const volumeScalingPlan = clampString(
    `Trenutno ${Math.round(current.tradeVolumePerMonth)} trades/mo. Cilj: ${targetVolume} trades/mo (2x). ` +
    `Strategija: avtomatiziraj monitor alert-e za 24/7 sourcing, batch sourcing ob vikendih (+50% capacity), ` +
    `setup auto-listing draft za hitrejši pipeline throughput. Cash injection: potreben +${round0(current.avgRevenuePerTrade * targetVolume * 0.5)}€ working capital.`,
    400,
    'Povečaj trade volume z bolj aktivnim sourcingom in avtomatizacijo monitor alert-ov.',
  );

  // Revenue diversification strategy
  const topSrc = streams[0]?.source ?? 'Bolha';
  const topPct = streams[0]?.percentage ?? 100;
  const revenueDiversificationStrategy = clampString(
    `Trenutno ${topSrc} ${topPct}% revenue concentration (HIGH risk). Cilj: top source ≤40%, ` +
    `dodaj mobile.de (30%) in Vinted (30%) za diversifikacijo. Cross-post vse listing-e na 3 platforme. ` +
    `To zmanjša platform-specific risk in poveča total reach.`,
    400,
    'Diversificiraj revenue preko 3+ platform (Bolha + mobile.de + Vinted).',
  );

  const revenueGrowthGrade = decideGrade(revenueGrowthMultiplier);

  // timeToDoubleRevenue = ln(2) / ln(1 + growthRate) * 30 (days)
  // Use projected growth rate (with maximization)
  const projectedDailyGrowth = Math.max(0.001, growthRate / 30);
  const timeToDoubleRevenue = round0(clampNum(
    Math.log(2) / Math.log(1 + projectedDailyGrowth),
    DAYS_MIN, DAYS_MAX, 365,
  ));

  return {
    maximizedMonthlyRevenue,
    revenueGrowthMultiplier,
    growthActions: growthActions.slice(0, MAX_GROWTH_ACTIONS),
    revenueProjection3m: proj3m,
    revenueProjection6m: proj6m,
    revenueProjection12m: proj12m,
    categoryExpansionOpportunities: categoryExpansionOpportunities.slice(0, MAX_CATEGORY_EXPANSIONS),
    volumeScalingPlan,
    revenueDiversificationStrategy,
    revenueGrowthGrade,
    timeToDoubleRevenue,
  };
}

function buildSummary(current: CurrentRevenue, max: Maximization): string {
  const parts: string[] = [
    `Current: ${current.currentMonthlyRevenue}€/mo revenue, growth ${current.revenueGrowthRate}%/mo, ${Math.round(current.tradeVolumePerMonth)} trades/mo.`,
    `Maximization: ${max.maximizedMonthlyRevenue}€/mo (${max.revenueGrowthMultiplier}x) z ${max.growthActions.length} growth actions.`,
    `Grade: ${max.revenueGrowthGrade}. 12m projection: ${max.revenueProjection12m}€.`,
    `Time to double revenue: ${max.timeToDoubleRevenue} days.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- AI prompt + merge helpers (pure, testable) ---------------------------

interface PromptData {
  soldCount12m: number;
  soldCount6m: number;
  soldCount3m: number;
  revenue12m: number;
  revenue6m: number;
  revenue3m: number;
  uniqueSources: number;
  current: CurrentRevenue;
  deterministicMaximization: {
    maximizedMonthlyRevenue: number;
    revenueGrowthMultiplier: number;
    revenueGrowthGrade: RevenueGrade;
    growthActions: Array<{
      action: string;
      expectedRevenueGain: number;
      priority: Priority;
      difficulty: Difficulty;
    }>;
    categoryExpansionOpportunities: CategoryExpansion[];
  };
  caps: Record<string, number>;
}

function buildPromptData(
  agg: RevenueAgg,
  current: CurrentRevenue,
  maximization: Maximization,
): PromptData {
  return {
    soldCount12m: agg.count12m,
    soldCount6m: agg.count6m,
    soldCount3m: agg.count3m,
    revenue12m: agg.revenue12m,
    revenue6m: agg.revenue6m,
    revenue3m: agg.revenue3m,
    uniqueSources: agg.perSource.size,
    current,
    deterministicMaximization: {
      maximizedMonthlyRevenue: maximization.maximizedMonthlyRevenue,
      revenueGrowthMultiplier: maximization.revenueGrowthMultiplier,
      revenueGrowthGrade: maximization.revenueGrowthGrade,
      growthActions: maximization.growthActions.map((a) => ({
        action: a.action,
        expectedRevenueGain: a.expectedRevenueGain,
        priority: a.priority,
        difficulty: a.difficulty,
      })),
      categoryExpansionOpportunities: maximization.categoryExpansionOpportunities,
    },
    caps: {
      revenueMin: REVENUE_MIN, revenueMax: REVENUE_MAX,
      multMin: MULT_MIN, multMax: MULT_MAX,
      growthRateMin: GROWTH_RATE_MIN, growthRateMax: GROWTH_RATE_MAX,
      gainMin: GAIN_MIN, gainMax: GAIN_MAX,
      daysMin: DAYS_MIN, daysMax: DAYS_MAX,
      pctMin: PERCENTAGE_MIN, pctMax: PERCENTAGE_MAX,
    },
  };
}

function buildPrompt(promptData: PromptData): string {
  return `Si AI "Revenue Growth Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za REVENUE GROWTH (top-line revenue, NE profit). Maksimiziraš TOTAL REVENUE z rastjo trade volume, širjenjem v nove kategorije in diversifikacijo revenue streams. Razlika od profit-multiplier-engine (v8.00 ki MULTIPLICIRA profit) — ti MAXIMIZIRAŠ REVENUE (top-line sales). Razlika od deal-source-roi-maximizer (v8.00 ki maksimizira ROI per source) — ti fokusiraš na REVENUE GROWTH rate in category expansion. Razlika od inventory-turnover-profit-maximizer (v8.00 ki maksimizira turnover-profit balance) — ti maksimiziraš TOTAL REVENUE preko volume scaling in category expansion. Razlika od capital-growth-maximizer (v7.99 ki maksimizira capital growth) — ti maksimiziraš REVENUE (top-line), ne capital. Razlika od revenue-stream-optimizer (v7.94 ki optimira revenue streams) — ti MAXIMIZIRAŠ revenue z growth actions in category expansion + 3m/6m/12m projection + timeToDoubleRevenue.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. growthActions: 4-6 akcij { action (string, max 200, slovenski), expectedRevenueGain € [0, 50000], priority HIGH | MEDIUM | LOW, difficulty EASY | MEDIUM | HARD },
2. categoryExpansionOpportunities: 3-5 priložnosti { category (max 50), potentialRevenue € [0, 50000], reasoning (max 200, slovenski) },
3. volumeScalingPlan: slovenski opis kako povečati trade volume (max 400),
4. revenueDiversificationStrategy: slovenski opis kako zmanjšati revenue concentration (max 400),
5. revenueGrowthGrade: A+ | A | B | C | D | F (A+ če multiplier ≥ 3.5, A ≥ 2.5, B ≥ 1.8, C ≥ 1.4, D ≥ 1.15, else F),
6. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "growthActions": [
    { "action": "Razširi se v elektroniko.", "expectedRevenueGain": 2800, "priority": "HIGH", "difficulty": "MEDIUM" },
    { "action": "Povečaj trade volume.", "expectedRevenueGain": 2500, "priority": "HIGH", "difficulty": "MEDIUM" }
  ],
  "categoryExpansionOpportunities": [
    { "category": "Elektronika", "potentialRevenue": 2800, "reasoning": "Visoka vrednost, hitra prodaja." }
  ],
  "volumeScalingPlan": "Povečaj trade volume z avtomatiziranim sourcingom.",
  "revenueDiversificationStrategy": "Diversificiraj preko 3 platform.",
  "revenueGrowthGrade": "A",
  "summary": "Current: 5000€/mo. Max: 12000€/mo (2.4x). Grade A. 12m proj: 58000€."
}${GROUNDING_PROMPT_SUFFIX}`;
}

function mergeAiIntoMaximization(
  parsed: AiResponse | null,
  current: CurrentRevenue,
  maximization: Maximization,
): { maximization: Maximization; summary: string; aiUsed: boolean } {
  if (!parsed || typeof parsed !== 'object') {
    return { maximization, summary: buildSummary(current, maximization), aiUsed: false };
  }

  let mergedMax = maximization;

  // Override growth actions if AI provided
  if (Array.isArray(parsed.growthActions) && parsed.growthActions.length >= 3) {
    const aiActions: GrowthAction[] = [];
    for (const a of parsed.growthActions.slice(0, MAX_GROWTH_ACTIONS)) {
      if (!a || typeof a !== 'object') continue;
      aiActions.push({
        action: clampString(a.action, 200, 'Growth akcija.'),
        expectedRevenueGain: round0(clampNum(
          a.expectedRevenueGain, GAIN_MIN, GAIN_MAX, 0,
        )),
        priority: clampEnum(a.priority, VALID_PRIORITY, 'MEDIUM'),
        difficulty: clampEnum(a.difficulty, VALID_DIFFICULTY, 'MEDIUM'),
      });
    }
    if (aiActions.length >= 3) {
      // Recompute maximized revenue from AI actions
      const totalGain = aiActions.reduce((s, a) => s + a.expectedRevenueGain, 0);
      const aiMaximized = round0(clampNum(
        current.currentMonthlyRevenue + totalGain,
        REVENUE_MIN, REVENUE_MAX, current.currentMonthlyRevenue,
      ));
      const aiMult = round2(clampNum(
        current.currentMonthlyRevenue > 0 ? aiMaximized / current.currentMonthlyRevenue : 1,
        MULT_MIN, MULT_MAX, 1,
      ));
      mergedMax = {
        ...mergedMax,
        growthActions: aiActions,
        maximizedMonthlyRevenue: aiMaximized,
        revenueGrowthMultiplier: aiMult,
        revenueGrowthGrade: decideGrade(aiMult),
      };
    }
  }

  // Override category expansions if AI provided
  if (Array.isArray(parsed.categoryExpansionOpportunities) &&
      parsed.categoryExpansionOpportunities.length >= 2) {
    const aiCats: CategoryExpansion[] = [];
    for (const c of parsed.categoryExpansionOpportunities.slice(0, MAX_CATEGORY_EXPANSIONS)) {
      if (!c || typeof c !== 'object') continue;
      aiCats.push({
        category: clampString(c.category, 50, 'Kategorija'),
        potentialRevenue: round0(clampNum(
          c.potentialRevenue, GAIN_MIN, GAIN_MAX, 0,
        )),
        reasoning: clampString(c.reasoning, 200, 'Premium priložnost.'),
      });
    }
    if (aiCats.length >= 2) {
      mergedMax = { ...mergedMax, categoryExpansionOpportunities: aiCats };
    }
  }

  // Override volume scaling plan
  if (typeof parsed.volumeScalingPlan === 'string' && parsed.volumeScalingPlan.trim()) {
    mergedMax = {
      ...mergedMax,
      volumeScalingPlan: clampString(parsed.volumeScalingPlan, 400, mergedMax.volumeScalingPlan),
    };
  }

  // Override revenue diversification strategy
  if (typeof parsed.revenueDiversificationStrategy === 'string' && parsed.revenueDiversificationStrategy.trim()) {
    mergedMax = {
      ...mergedMax,
      revenueDiversificationStrategy: clampString(
        parsed.revenueDiversificationStrategy, 400, mergedMax.revenueDiversificationStrategy,
      ),
    };
  }

  // Override grade
  if (parsed.revenueGrowthGrade) {
    mergedMax = {
      ...mergedMax,
      revenueGrowthGrade: clampEnum(
        parsed.revenueGrowthGrade,
        VALID_GRADE,
        mergedMax.revenueGrowthGrade,
      ),
    };
  }

  const summary = clampString(parsed.summary, 400, buildSummary(current, mergedMax));
  return { maximization: mergedMax, summary, aiUsed: true };
}

// --- Handler -------------------------------------------------------------

const revenueGrowthMaximizerHandler = withAiRoute<RevenueGrowthMaximizerInput>({
  endpoint: '/api/ai/revenue-growth-maximizer',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — body ignored, identična logika za GET in POST
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Query SOLD trades last 12 months
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
      return apiOk({
        ok: true,
        current: {
          currentMonthlyRevenue: 0,
          revenueGrowthRate: 0,
          avgRevenuePerTrade: 0,
          tradeVolumePerMonth: 0,
          revenueStreams: [],
        },
        maximization: {
          maximizedMonthlyRevenue: 0,
          revenueGrowthMultiplier: 1,
          growthActions: [],
          revenueProjection3m: 0,
          revenueProjection6m: 0,
          revenueProjection12m: 0,
          categoryExpansionOpportunities: [],
          volumeScalingPlan: 'Ni SOLD trgovin v zadnjih 12 mesecih — Revenue Growth Maximizer ni mogoč.',
          revenueDiversificationStrategy: 'Ni SOLD trgovin v zadnjih 12 mesecih — Revenue Growth Maximizer ni mogoč.',
          revenueGrowthGrade: 'F',
          timeToDoubleRevenue: 0,
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Revenue Growth Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Revenue Growth Maximizer ni mogoč.',
      } satisfies RevenueGrowthResponse);
    }

    // 2) Compute aggregates
    const soldComputed: SoldRevenueComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldRevenue(t, now);
      if (c) soldComputed.push(c);
    }

    const agg = aggregateRevenue(soldComputed);
    const current = computeCurrent(agg);

    let maximization = buildDeterministicMaximization(current, agg);
    let summary = buildSummary(current, maximization);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `revenue-growth-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: Maximization;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        current,
        maximization: cached.maximization,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies RevenueGrowthResponse);
    }

    // 4) AI prompt with grounding
    const promptData = buildPromptData(agg, current, maximization);
    const prompt = buildPrompt(promptData);

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      const result = mergeAiIntoMaximization(parsed, current, maximization);
      if (result.aiUsed) {
        maximization = result.maximization;
        summary = result.summary;
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/revenue-growth-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { maximization, summary });
    }

    return apiOk({
      ok: true,
      current,
      maximization,
      summary,
      aiUsed,
    } satisfies RevenueGrowthResponse);
  },
});

export const GET = revenueGrowthMaximizerHandler;
export const POST = revenueGrowthMaximizerHandler;
