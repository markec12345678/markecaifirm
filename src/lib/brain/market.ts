// v8.17: Market Brain — synthesizes 6 market signals into ONE decision.
// Pure deterministic compute — no AI, no DB, no side effects.
//
// Architectural role: this is the THIRD Brain layer (after Profit Brain v8.15
// and Inventory Brain v8.16) that sits ABOVE the ~27 market specialist
// endpoints. Each specialist measures ONE market dimension (cycle phase,
// depth, volatility, trend, sentiment, timing). The Market Brain reads
// market context and synthesizes 6 market signals (cyclePhase, sentiment,
// depth, volatility, trend, timing) into:
//   - 3 top actions for today, ranked by expectedUpliftEUR × confidence
//   - 30d / 90d market phase projections (predictedPhase + predictedPriceChangePct
//     + recommendedAction BUY/SELL/HOLD/LIQUIDATE)
//   - overall market grade (weighted across 6 signals)
//   - one-line summary that names the single biggest market lever
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
//  - Specialists measure ONE dimension (e.g. market-cycle-phase-predictor,
//    market-depth-trend-analyzer, market-volatility-forecaster,
//    market-trend-forecaster-pro, market-saturation, sentiment-analysis,
//    market-timing-profit-optimizer). Brain SYNTHESIZES 6 dimensions into one
//    decision.
//  - Specialists are flat endpoints. Brain sits ABOVE them.
//  - In v8.17 the Brain computes the 6 signals itself (pure deterministic
//    TypeScript — no AI, no HTTP fan-out). This keeps the Brain fast (<5ms)
//    and fully testable.
//
// This module is a PURE TypeScript function — no `next/server` import, no
// Prisma calls (state is injected by the caller via MarketBrainInput). It is
// fully testable in isolation and deterministic given the same input.

// --- Types ----------------------------------------------------------------

import type { ProfitGrade, Confidence } from './profit';

export interface MarketBrainInput {
  activeListingCount?: number; // total active listings across all sources
  newLastWeek?: number; // new listings in last 7 days
  avgPriceChangePctWeek?: number; // avg % price change last 7 days (can be negative)
  avgPriceChangePctMonth?: number; // avg % price change last 30 days
  buyerInquiriesLastWeek?: number; // total buyer messages/inquiries
  sellThroughRatePct?: number; // % of listings that sold within 30 days
  avgDaysOnMarket?: number; // avg days a listing stays live before sold
  priceSpreadPct?: number; // (max - min) / median × 100 — price dispersion
  category?: string; // 'electronics' | 'sneakers' | 'auto' | 'general'
}

export type MarketSignalName =
  | 'cyclePhase' // where in market cycle (accumulation/markup/distribution/markdown)
  | 'sentiment' // buyer sentiment (positive/neutral/negative)
  | 'depth' // market depth/liquidity (how many active listings)
  | 'volatility' // price volatility (stable/volatile)
  | 'trend' // price trend direction (rising/falling/stable)
  | 'timing'; // is this a good time to buy/sell/hold

export interface MarketSignal {
  name: MarketSignalName;
  score: number; // 0-100 normalized
  grade: ProfitGrade;
  upliftEURPerMonth: number; // normalized expected €/month uplift if this signal is maximized
  topLever: string; // human-readable action lever
}

export interface MarketBrainAction {
  rank: number;
  domain: 'market'; // 'market' for v8.17
  signal: MarketSignalName;
  action: string; // human-readable, e.g. "Kupuj elektroniko — trg v MARKUP fazi"
  expectedUpliftEUR: number; // €/month
  confidence: Confidence;
}

export type MarketPhase = 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN';
export type MarketSentiment = 'BULLISH' | 'NEUTRAL' | 'BEARISH';
export type MarketAction = 'BUY' | 'SELL' | 'HOLD' | 'LIQUIDATE';

export interface MarketBrainResult {
  ok: true;
  signals: MarketSignal[]; // exactly 6 entries
  current: {
    activeListingCount: number;
    newLastWeek: number;
    avgPriceChangePctWeek: number;
    avgPriceChangePctMonth: number;
    buyerInquiriesLastWeek: number;
    sellThroughRatePct: number;
    avgDaysOnMarket: number;
    priceSpreadPct: number;
    inferredCyclePhase: MarketPhase;
    inferredSentiment: MarketSentiment;
  };
  maximization: {
    topActions: MarketBrainAction[]; // up to 3 actions, ranked by uplift × confidence
    projection30d: {
      predictedPhase: MarketPhase;
      predictedPriceChangePct: number;
      recommendedAction: MarketAction;
    };
    projection90d: {
      predictedPhase: MarketPhase;
      predictedPriceChangePct: number;
      recommendedAction: MarketAction;
    };
    marketGrade: ProfitGrade; // weighted across 6 signals
    bestOpportunity: MarketSignalName; // signal with highest upliftEURPerMonth
    oneLineSummary: string;
  };
  aiUsed: false;
  source: 'v8.17-market-brain';
  cachedAt?: number; // set by caller when served from cache
}

// --- Defaults -------------------------------------------------------------

const DEFAULT_ACTIVE_LISTING_COUNT = 150;
const DEFAULT_NEW_LAST_WEEK = 35;
const DEFAULT_AVG_PRICE_CHANGE_PCT_WEEK = 1.5;
const DEFAULT_AVG_PRICE_CHANGE_PCT_MONTH = 3.5;
const DEFAULT_BUYER_INQUIRIES_LAST_WEEK = 60;
const DEFAULT_SELL_THROUGH_RATE_PCT = 45;
const DEFAULT_AVG_DAYS_ON_MARKET = 14;
const DEFAULT_PRICE_SPREAD_PCT = 25;
const DEFAULT_CATEGORY = 'general';

// --- Helpers --------------------------------------------------------------

function clamp(x: number, min: number, max: number): number {
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function gradeFromScore(score: number): ProfitGrade {
  if (!Number.isFinite(score)) return 'F';
  if (score >= 90) return 'A+';
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  if (score >= 20) return 'D';
  return 'F';
}

function confidenceFromScore(score: number): Confidence {
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

function confidenceWeight(c: Confidence): number {
  switch (c) {
    case 'HIGH':
      return 1.0;
    case 'MEDIUM':
      return 0.7;
    case 'LOW':
      return 0.4;
  }
}

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

// --- Signal formulas ------------------------------------------------------

interface NormalizedInput {
  activeListingCount: number;
  newLastWeek: number;
  avgPriceChangePctWeek: number;
  avgPriceChangePctMonth: number;
  buyerInquiriesLastWeek: number;
  sellThroughRatePct: number;
  avgDaysOnMarket: number;
  priceSpreadPct: number;
  category: string;
}

function normalizeInput(
  input: MarketBrainInput | undefined | null,
): NormalizedInput {
  const activeListingCount =
    input?.activeListingCount != null && Number.isFinite(input.activeListingCount)
      ? input.activeListingCount
      : DEFAULT_ACTIVE_LISTING_COUNT;
  const newLastWeek =
    input?.newLastWeek != null && Number.isFinite(input.newLastWeek)
      ? input.newLastWeek
      : DEFAULT_NEW_LAST_WEEK;
  const avgPriceChangePctWeek =
    input?.avgPriceChangePctWeek != null && Number.isFinite(input.avgPriceChangePctWeek)
      ? input.avgPriceChangePctWeek
      : DEFAULT_AVG_PRICE_CHANGE_PCT_WEEK;
  const avgPriceChangePctMonth =
    input?.avgPriceChangePctMonth != null && Number.isFinite(input.avgPriceChangePctMonth)
      ? input.avgPriceChangePctMonth
      : DEFAULT_AVG_PRICE_CHANGE_PCT_MONTH;
  const buyerInquiriesLastWeek =
    input?.buyerInquiriesLastWeek != null && Number.isFinite(input.buyerInquiriesLastWeek)
      ? input.buyerInquiriesLastWeek
      : DEFAULT_BUYER_INQUIRIES_LAST_WEEK;
  const sellThroughRatePct =
    input?.sellThroughRatePct != null && Number.isFinite(input.sellThroughRatePct)
      ? input.sellThroughRatePct
      : DEFAULT_SELL_THROUGH_RATE_PCT;
  const avgDaysOnMarket =
    input?.avgDaysOnMarket != null && Number.isFinite(input.avgDaysOnMarket)
      ? input.avgDaysOnMarket
      : DEFAULT_AVG_DAYS_ON_MARKET;
  const priceSpreadPct =
    input?.priceSpreadPct != null && Number.isFinite(input.priceSpreadPct)
      ? input.priceSpreadPct
      : DEFAULT_PRICE_SPREAD_PCT;
  const category =
    input?.category && typeof input.category === 'string' && input.category.length > 0
      ? input.category
      : DEFAULT_CATEGORY;

  return {
    activeListingCount,
    newLastWeek,
    avgPriceChangePctWeek,
    avgPriceChangePctMonth,
    buyerInquiriesLastWeek,
    sellThroughRatePct,
    avgDaysOnMarket,
    priceSpreadPct,
    category,
  };
}

/**
 * Infer the current market cycle phase from price trend + sell-through rate.
 *  - MARKUP: rising prices + fast sales (bull market)
 *  - DISTRIBUTION: rising prices + slow sales (top of cycle — exit signal)
 *  - MARKDOWN: falling prices + fast sales (buyers in control — exit)
 *  - ACCUMULATION: falling prices + slow sales (bottom — buy signal)
 */
function inferCyclePhase(
  avgPriceChangePctMonth: number,
  sellThroughRatePct: number,
): MarketPhase {
  if (avgPriceChangePctMonth > 3 && sellThroughRatePct > 50) return 'MARKUP';
  if (avgPriceChangePctMonth > 3 && sellThroughRatePct <= 50) return 'DISTRIBUTION';
  if (avgPriceChangePctMonth < -3 && sellThroughRatePct > 50) return 'MARKDOWN';
  if (avgPriceChangePctMonth < -3 && sellThroughRatePct <= 50) return 'ACCUMULATION';
  // Neutral zone (-3 ≤ pct ≤ 3): lean toward phase direction
  return avgPriceChangePctMonth >= 0 ? 'MARKUP' : 'ACCUMULATION';
}

/**
 * Infer buyer sentiment from inquiry rate + sell-through.
 *  - BULLISH: many inquiries + fast sell-through (strong demand)
 *  - NEUTRAL: moderate demand
 *  - BEARISH: low inquiries + slow sell-through (weak demand)
 */
function inferSentiment(score: number): MarketSentiment {
  if (score >= 70) return 'BULLISH';
  if (score >= 40) return 'NEUTRAL';
  return 'BEARISH';
}

/**
 * 1. cyclePhase — where in the market cycle (Wyckoff-style classification).
 *    Phase derived from price trend (30d) + sell-through rate.
 *    Score: MARKUP = 80, ACCUMULATION = 70, DISTRIBUTION = 40, MARKDOWN = 30.
 *    Uplift: MARKUP = activeListings × 5 (ride the wave);
 *            ACCUMULATION = × 8 (buy low — highest uplift);
 *            DISTRIBUTION = × 2 (exit);
 *            MARKDOWN = × 1 (defensive).
 */
function computeCyclePhaseSignal(norm: NormalizedInput): MarketSignal {
  const phase = inferCyclePhase(norm.avgPriceChangePctMonth, norm.sellThroughRatePct);
  const scoreByPhase: Record<MarketPhase, number> = {
    MARKUP: 80,
    ACCUMULATION: 70,
    DISTRIBUTION: 40,
    MARKDOWN: 30,
  };
  const upliftByPhase: Record<MarketPhase, number> = {
    MARKUP: 5,
    ACCUMULATION: 8,
    DISTRIBUTION: 2,
    MARKDOWN: 1,
  };
  const score = scoreByPhase[phase];
  const upliftEURPerMonth = round2(Math.max(0, norm.activeListingCount * upliftByPhase[phase]));

  const actionByPhase: Record<MarketPhase, string> = {
    MARKUP: 'kupuj in relistuj s 10% višjo ceno — surfaj rastoči val',
    ACCUMULATION: 'agresivno kupuj pod ceno — dno trga, priložnost za nabavo',
    DISTRIBUTION: 'likvidiraj v inventarju — vrh cikla, prodaj pred padcem',
    MARKDOWN: 'defenzivno — zadrži capital, čakaj na preobrat v akumulacijo',
  };
  return {
    name: 'cyclePhase',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: `Trg v ${phase} fazi — ${actionByPhase[phase]}`,
  };
}

/**
 * 2. sentiment — buyer sentiment from inquiries + sell-through.
 *    inquiryRate = buyerInquiriesLastWeek / max(activeListingCount, 1).
 *    Score = clamp(inquiryRate × 30 + sellThroughRatePct × 0.5, 0, 100).
 *    Uplift = activeListingCount × (BULLISH ? 4 : NEUTRAL ? 2 : 0.5).
 */
function computeSentimentSignal(norm: NormalizedInput): MarketSignal {
  const safeListings = Math.max(norm.activeListingCount, 1);
  const inquiryRate = norm.buyerInquiriesLastWeek / safeListings;
  const score = clamp(inquiryRate * 30 + norm.sellThroughRatePct * 0.5, 0, 100);
  const sentiment = inferSentiment(score);
  const upliftBySentiment: Record<MarketSentiment, number> = {
    BULLISH: 4,
    NEUTRAL: 2,
    BEARISH: 0.5,
  };
  const upliftEURPerMonth = round2(
    Math.max(0, norm.activeListingCount * upliftBySentiment[sentiment]),
  );
  const actionBySentiment: Record<MarketSentiment, string> = {
    BULLISH: 'povečaj cene za 5-8% — povpraševanje to podpira',
    NEUTRAL: 'drži cene, optimiziraj oglase za boljšo konverzijo',
    BEARISH: 'znižaj cene za 10-15% za hitro prodajo pred padcem',
  };
  return {
    name: 'sentiment',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: `Sentiment ${sentiment} — ${actionBySentiment[sentiment]}`,
  };
}

/**
 * 3. depth — market depth/liquidity.
 *    newListingRate = newLastWeek / max(activeListingCount, 1) × 100 (% new/week).
 *    Score = clamp(newListingRate × 4 + min(activeListingCount, 100), 0, 100).
 *    Uplift = activeListingCount × 1.5.
 */
function computeDepthSignal(norm: NormalizedInput): MarketSignal {
  const safeListings = Math.max(norm.activeListingCount, 1);
  const newListingRate = (norm.newLastWeek / safeListings) * 100;
  const score = clamp(newListingRate * 4 + Math.min(norm.activeListingCount, 100), 0, 100);
  const upliftEURPerMonth = round2(Math.max(0, norm.activeListingCount * 1.5));
  const action =
    newListingRate > 15
      ? 'povečaj svojo prisotnost za ohranjanje share-a'
      : 'primeren čas za aktivno nabavo';
  return {
    name: 'depth',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: `Globina trga ${norm.activeListingCount} oglasov (${norm.newLastWeek} novih/teden) — ${action}`,
  };
}

/**
 * 4. volatility — price volatility from spread + weekly change.
 *    volatilityIndex = (|avgPriceChangePctWeek| × 3 + priceSpreadPct × 0.5).
 *    Score = clamp(100 - volatilityIndex, 0, 100)  (low volatility = high score).
 *    Uplift = activeListingCount × (volatilityIndex > 30 ? 3 : 1).
 */
function computeVolatilitySignal(norm: NormalizedInput): MarketSignal {
  const volatilityIndex =
    Math.abs(norm.avgPriceChangePctWeek) * 3 + norm.priceSpreadPct * 0.5;
  const score = clamp(100 - volatilityIndex, 0, 100);
  const upliftEURPerMonth = round2(
    Math.max(0, norm.activeListingCount * (volatilityIndex > 30 ? 3 : 1)),
  );
  const action =
    volatilityIndex > 30
      ? 'visoka: izkoristi arbitražo (kupi pod ceno, prodaj nad)'
      : 'nizka: stabilne cene, fokus na volume';
  return {
    name: 'volatility',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: `Volatilnost ${volatilityIndex.toFixed(0)} — ${action}`,
  };
}

/**
 * 5. trend — price trend direction.
 *    trendStrength = avgPriceChangePctMonth × 8 + avgPriceChangePctWeek × 4.
 *    Score = clamp(50 + trendStrength, 0, 100)  (neutral = 50).
 *    Uplift = activeListingCount × (trendStrength > 0 ? 2.5 : 1.0).
 */
function computeTrendSignal(norm: NormalizedInput): MarketSignal {
  const trendStrength = norm.avgPriceChangePctMonth * 8 + norm.avgPriceChangePctWeek * 4;
  const score = clamp(50 + trendStrength, 0, 100);
  const upliftEURPerMonth = round2(
    Math.max(0, norm.activeListingCount * (trendStrength > 0 ? 2.5 : 1.0)),
  );
  const sign = norm.avgPriceChangePctMonth >= 0 ? '+' : '';
  const action =
    norm.avgPriceChangePctMonth > 2
      ? 'skupaj s trendom: povečaj inventar, drži za višjo ceno'
      : norm.avgPriceChangePctMonth < -2
        ? 'proti trendu: likvidiraj, čakaj na dno'
        : 'stran trenda: normalna aktivnost';
  return {
    name: 'trend',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: `Trend ${sign}${norm.avgPriceChangePctMonth.toFixed(1)}%/mo — ${action}`,
  };
}

/**
 * 6. timing — composite timing score.
 *    timingScore = cyclePhase × 0.35 + sentiment × 0.25 + trend × 0.25 + depth × 0.15.
 *    Score = clamp(timingScore, 0, 100).
 *    Uplift = average of other 5 uplifts × 0.6.
 *
 * Note: this signal is computed AFTER the other 5 because it depends on their
 * scores. The synthesis function passes a precomputed set of base signals.
 */
function computeTimingSignal(
  norm: NormalizedInput,
  baseSignals: MarketSignal[],
): MarketSignal {
  const cyclePhaseScore = baseSignals.find((s) => s.name === 'cyclePhase')?.score ?? 0;
  const sentimentScore = baseSignals.find((s) => s.name === 'sentiment')?.score ?? 0;
  const trendScore = baseSignals.find((s) => s.name === 'trend')?.score ?? 0;
  const depthScore = baseSignals.find((s) => s.name === 'depth')?.score ?? 0;

  const timingScore =
    cyclePhaseScore * 0.35 +
    sentimentScore * 0.25 +
    trendScore * 0.25 +
    depthScore * 0.15;
  const score = clamp(timingScore, 0, 100);

  const avgUplift =
    baseSignals.reduce((a, s) => a + s.upliftEURPerMonth, 0) /
    Math.max(baseSignals.length, 1);
  const upliftEURPerMonth = round2(Math.max(0, avgUplift * 0.6));

  const action =
    score >= 70
      ? 'ODLIČEN — aktivno kupuj/prodaj'
      : score >= 50
        ? 'DOBER — normalna aktivnost'
        : 'SLAB — čakaj na boljši market timing';
  return {
    name: 'timing',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: `Timing ${score.toFixed(0)}/100 — ${action}`,
  };
}

// --- Synthesis ------------------------------------------------------------

const SIGNAL_WEIGHTS: Record<MarketSignalName, number> = {
  cyclePhase: 0.2,
  sentiment: 0.2,
  trend: 0.2,
  timing: 0.15,
  depth: 0.15,
  volatility: 0.1,
};

function actionForSignal(signal: MarketSignal): string {
  // Templated human-readable action derived from the signal's topLever.
  switch (signal.name) {
    case 'cyclePhase':
      return `Izkoristi fazo trga: ${signal.topLever}`;
    case 'sentiment':
      return `Uskladi s sentimentom: ${signal.topLever}`;
    case 'depth':
      return `Izkoristi globino: ${signal.topLever}`;
    case 'volatility':
      return `Igraj volatilnost: ${signal.topLever}`;
    case 'trend':
      return `Jahaj trend: ${signal.topLever}`;
    case 'timing':
      return `Optimiriraj timing: ${signal.topLever}`;
    default:
      return signal.topLever;
  }
}

/**
 * Project the market phase 30d forward, based on trend continuation.
 *  - Rising trend + high sentiment → MARKUP (continued bull)
 *  - Rising trend + dropping sentiment → DISTRIBUTION (top forming)
 *  - Falling trend + low sentiment → ACCUMULATION (bottom forming)
 *  - Falling trend + high sentiment → MARKDOWN (capitulation)
 */
function projectPhase30d(
  trendRising: boolean,
  sentimentHigh: boolean,
): MarketPhase {
  if (trendRising && sentimentHigh) return 'MARKUP';
  if (trendRising && !sentimentHigh) return 'DISTRIBUTION';
  if (!trendRising && !sentimentHigh) return 'ACCUMULATION';
  return 'MARKDOWN';
}

/**
 * Project the market phase 90d forward, regression to mean.
 * Markets tend to normalize toward MARKUP over longer horizons.
 */
function projectPhase90d(current: MarketPhase): MarketPhase {
  switch (current) {
    case 'ACCUMULATION':
      return 'MARKUP'; // recovery
    case 'MARKDOWN':
      return 'ACCUMULATION'; // bottoming
    case 'DISTRIBUTION':
      return 'MARKUP'; // correction done
    case 'MARKUP':
    default:
      return 'MARKUP'; // sustained
  }
}

function actionForPhase(phase: MarketPhase): MarketAction {
  switch (phase) {
    case 'ACCUMULATION':
      return 'BUY';
    case 'MARKUP':
      return 'HOLD';
    case 'DISTRIBUTION':
      return 'SELL';
    case 'MARKDOWN':
      return 'LIQUIDATE';
    default:
      return 'HOLD';
  }
}

function buildOneLineSummary(
  cyclePhase: MarketPhase,
  sentiment: MarketSentiment,
  grade: ProfitGrade,
  topActions: MarketBrainAction[],
): string {
  const a0 = topActions[0]?.action ?? '';
  return `Trg v ${cyclePhase} fazi, sentiment ${sentiment}. ${a0}. Grade ${grade}.`;
}

/**
 * Market Brain — pure deterministic compute.
 * Takes optional MarketBrainInput (with sensible defaults) and returns a
 * synthesized decision: 6 market signals, top 3 actions, 30d/90d market phase
 * projections, overall market grade, and a one-line summary.
 *
 * No side effects. No external calls. No DB. No AI.
 */
export function marketBrain(input?: MarketBrainInput): MarketBrainResult {
  const norm = normalizeInput(input);

  // --- Compute 5 of 6 signals first (timing depends on others) -----------
  const cyclePhase = computeCyclePhaseSignal(norm);
  const sentiment = computeSentimentSignal(norm);
  const depth = computeDepthSignal(norm);
  const volatility = computeVolatilitySignal(norm);
  const trend = computeTrendSignal(norm);

  const baseSignals: MarketSignal[] = [cyclePhase, sentiment, depth, volatility, trend];

  // --- Timing signal (depends on the other 5) ----------------------------
  const timing = computeTimingSignal(norm, baseSignals);

  const signals: MarketSignal[] = [...baseSignals, timing];

  // --- Inferred current cycle phase + sentiment (for `current` block) ----
  const inferredCyclePhase = inferCyclePhase(
    norm.avgPriceChangePctMonth,
    norm.sellThroughRatePct,
  );
  const sentimentScore = clamp(
    (norm.buyerInquiriesLastWeek / Math.max(norm.activeListingCount, 1)) * 30 +
      norm.sellThroughRatePct * 0.5,
    0,
    100,
  );
  const inferredSentiment = inferSentiment(sentimentScore);

  // --- Weighted overall market grade --------------------------------------
  const weightedScore = signals.reduce(
    (acc, s) => acc + s.score * SIGNAL_WEIGHTS[s.name],
    0,
  );
  const marketGrade = gradeFromScore(weightedScore);

  // --- Top 3 actions (sorted by uplift × confidence weight) --------------
  const ranked = signals
    .map((s) => {
      const confidence = confidenceFromScore(s.score);
      return {
        signal: s,
        confidence,
        rankScore: s.upliftEURPerMonth * confidenceWeight(confidence),
      };
    })
    .sort((a, b) => b.rankScore - a.rankScore);

  const top3 = ranked.slice(0, 3);
  const topActions: MarketBrainAction[] = top3.map((entry, i) => ({
    rank: i + 1,
    domain: 'market',
    signal: entry.signal.name,
    action: actionForSignal(entry.signal),
    expectedUpliftEUR: round2(entry.signal.upliftEURPerMonth),
    confidence: entry.confidence,
  }));

  // --- 30d projection (trend continuation) -------------------------------
  const trendRising = (norm.avgPriceChangePctMonth * 8 + norm.avgPriceChangePctWeek * 4) > 0;
  const projectedPhase30d = projectPhase30d(trendRising, inferredSentiment === 'BULLISH');
  const projection30d = {
    predictedPhase: projectedPhase30d,
    predictedPriceChangePct: round2(norm.avgPriceChangePctMonth * 0.5),
    recommendedAction: actionForPhase(projectedPhase30d),
  };

  // --- 90d projection (regression to mean) --------------------------------
  const projectedPhase90d = projectPhase90d(inferredCyclePhase);
  const projection90d = {
    predictedPhase: projectedPhase90d,
    predictedPriceChangePct: round2(norm.avgPriceChangePctMonth * 0.3),
    recommendedAction: actionForPhase(projectedPhase90d),
  };

  // --- Best opportunity (highest uplift signal) -------------------------
  const bestOpportunity = signals.reduce(
    (best, s) => (s.upliftEURPerMonth > best.upliftEURPerMonth ? s : best),
    signals[0],
  ).name;

  // --- One-line summary --------------------------------------------------
  const oneLineSummary = buildOneLineSummary(
    inferredCyclePhase,
    inferredSentiment,
    marketGrade,
    topActions,
  );

  return {
    ok: true,
    signals,
    current: {
      activeListingCount: norm.activeListingCount,
      newLastWeek: norm.newLastWeek,
      avgPriceChangePctWeek: round2(norm.avgPriceChangePctWeek),
      avgPriceChangePctMonth: round2(norm.avgPriceChangePctMonth),
      buyerInquiriesLastWeek: norm.buyerInquiriesLastWeek,
      sellThroughRatePct: round2(norm.sellThroughRatePct),
      avgDaysOnMarket: round2(norm.avgDaysOnMarket),
      priceSpreadPct: round2(norm.priceSpreadPct),
      inferredCyclePhase,
      inferredSentiment,
    },
    maximization: {
      topActions,
      projection30d,
      projection90d,
      marketGrade,
      bestOpportunity,
      oneLineSummary,
    },
    aiUsed: false,
    source: 'v8.17-market-brain',
  };
}
