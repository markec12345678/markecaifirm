// v8.21: Pricing Brain — synthesizes 6 pricing signals into ONE decision.
// Pure deterministic compute — no AI, no DB, no side effects.
//
// Architectural role: this is the SEVENTH and FINAL Brain layer (after
// Profit Brain v8.15, Inventory Brain v8.16, Market Brain v8.17, Sourcing
// Brain v8.18, Risk Brain v8.19, Buyer Brain v8.20) that sits ABOVE the
// ~39 pricing specialist endpoints (price-elasticity, price-optimization-
// engine-pro, smart-pricing-engine, pricing-psychology-optimizer,
// margin-guardian, margin-guardian-pro, price-war-strategist, price-war,
// seasonal-pricing, competitor-price-tracker, competitor-tracker,
// margin-optimizer, margin-guardian, price-volatility-analyzer,
// pricing-abtest, smart-bundle-pricing, smart-pricing-engine,
// price-intelligence-engine, profit-margin-maximizer, profit-margin-predictor,
// profit-margin-predictor-v3, profit-margin-forecaster, profit-margin-forecaster-pro,
// profit-margin-acceleration-tracker, profit-margin-optimizer-v2,
// inventory-profit-margin-tracker, inventory-profit-margin-optimizer-pro,
// deal-source-margin-maximizer, deal-source-profit-margin-growth-maximizer,
// deal-profit-margin-enhancer-pro, bundle-profit-optimizer, ...). Each
// specialist measures ONE pricing dimension (margin, elasticity,
// competitiveness, dynamic, war, psychology). The Pricing Brain reads
// pricing context and synthesizes 6 pricing signals (margin, elasticity,
// competitiveness, dynamic, war, psychology) into:
//   - 3 top pricing actions for today, ranked by upliftEURPerMonth ×
//     confidence
//   - 30d / 90d pricing projections (projectedMarginPct + projectedRevenue +
//     recommendedPriceChangePct + listingsToReprice)
//   - overall pricing grade (weighted across 6 signals)
//   - pricingPower composite (ability to raise prices without losing volume)
//   - one-line summary that names the single biggest pricing lever
//
// DIFFERENCES from Profit Brain (v8.15):
//  - Profit Brain reads TRADE HISTORY (monthlyProfits[]) → synthesizes
//    profit-growth signals. Pricing Brain reads PRICING CONTEXT (margin,
//    elasticity, competitor prices, sell-through, seasonality, psychology)
//    → synthesizes pricing-optimization signals.
//  - Profit Brain's projection30d/projection90d are scalars (EUR/mo).
//    Pricing Brain's projections are STRUCTURED objects with
//    projectedMarginPct + projectedRevenue + recommendedPriceChangePct +
//    listingsToReprice — because pricing optimization is multi-dimensional
//    (raise/lower prices, plan repricing scope, project margin + revenue).
//  - Profit Brain = "how much money are you making?".
//    Pricing Brain = "which pricing lever (margin / elasticity /
//    competitiveness / dynamic / war / psychology) yields the highest
//    uplift, and how should prices move in next 30d/90d?".
//
// DIFFERENCES from Inventory Brain (v8.16):
//  - Inventory Brain answers "how well is your stock performing as capital?".
//    Pricing Brain answers "how well are your prices optimized?".
//  - Inventory Brain projects inventory value + aged stock %.
//    Pricing Brain projects margin % + revenue + price change % + listings to reprice.
//
// DIFFERENCES from Market Brain (v8.17):
//  - Market Brain reads MARKET CONTEXT (active listings, price changes,
//    inquiries, sell-through) → synthesizes market-cycle signals.
//    Pricing Brain reads PRICING CONTEXT (margin, elasticity, competitor
//    price position, sell-through, seasonality, psychology) → synthesizes
//    pricing-optimization signals.
//  - Market Brain answers "where in the market cycle are we RIGHT NOW?".
//    Pricing Brain answers "which pricing lever should we pull first?".
//
// DIFFERENCES from Sourcing Brain (v8.18):
//  - Sourcing Brain reads PER-SOURCE BREAKDOWN → synthesizes sourcing signals.
//    Pricing Brain reads PRICING CONTEXT → synthesizes pricing signals.
//
// DIFFERENCES from Risk Brain (v8.19):
//  - Risk Brain reads RISK EXPOSURE → synthesizes risk-mitigation signals
//    (score HIGHER = LOWER risk; inverted).
//    Pricing Brain reads PRICING CONTEXT → synthesizes pricing-optimization
//    signals (score HIGHER = better pricing — same direction as Profit/
//    Inventory/Market/Sourcing/Buyer).
//
// DIFFERENCES from Buyer Brain (v8.20):
//  - Buyer Brain reads BUYER CONTEXT (active buyers, churn, LTV, repeat rate,
//    engagement) → synthesizes buyer-cultivation signals.
//    Pricing Brain reads PRICING CONTEXT (margin, elasticity, competitor
//    prices, sell-through, seasonality, psychology) → synthesizes
//    pricing-optimization signals.
//  - Buyer Brain projects active buyers + LTV + churn + outreach count.
//    Pricing Brain projects margin % + revenue + price change % + listings to reprice.
//
// DIFFERENCES from the ~39 pricing specialists:
//  - Specialists measure ONE dimension. Brain SYNTHESIZES 6 dimensions.
//  - In v8.21 the Brain computes the 6 signals itself (pure deterministic
//    TypeScript — no AI, no HTTP fan-out). This keeps the Brain fast (<5ms)
//    and fully testable.
//
// MILESTONE: After v8.21, all SEVEN Domain Brains are complete. Next step
// is v8.22 Master Brain which will orchestrate all 7 Brain outputs into ONE
// final decision (TOP 5 actions for today + 30d/90d/12m strategy).
//
// This module is a PURE TypeScript function — no `next/server` import, no
// Prisma calls (state is injected by the caller via PricingBrainInput). It is
// fully testable in isolation and deterministic given the same input.

// --- Types ----------------------------------------------------------------

import type { ProfitGrade, Confidence } from './profit';

export interface PricingBrainInput {
  activeListingsCount?: number;        // total active listings
  avgProfitMarginPct?: number;          // current avg profit margin %
  avgDaysOnMarket?: number;             // avg days to sell
  competitorPriceAvgPct?: number;       // your avg price as % of competitor avg (100 = same, 90 = 10% below, 110 = 10% above)
  priceElasticityScore?: number;        // 0-100 (higher = more elastic, price-sensitive buyers)
  sellThroughRatePct?: number;          // % listings sold within 30 days
  monthlyRevenue?: number;              // EUR (last 30 days)
  avgOrderValue?: number;                // EUR per sale
  priceWarDetected?: boolean;            // is a competitor price war active?
  seasonalMultiplier?: number;           // current seasonal demand multiplier (1.0 = normal, 1.2 = high season, 0.8 = low)
  psychologyOptimizedPct?: number;      // % of listings using psychology pricing (e.g. 199 instead of 200)
  lastPriceChangePct?: number;          // avg % price change in last 30 days
}

export type PricingSignalName =
  | 'margin'         // profit margin health
  | 'elasticity'     // price elasticity awareness
  | 'competitiveness' // vs competitors
  | 'dynamic'        // dynamic/real-time pricing
  | 'war'            // price war defense
  | 'psychology';    // psychological pricing optimization

export interface PricingSignal {
  name: PricingSignalName;
  score: number;          // 0-100
  grade: ProfitGrade;
  upliftEURPerMonth: number;
  topLever: string;        // human-readable action lever (in Slovenian)
}

export interface PricingBrainAction {
  rank: number;
  domain: 'pricing';
  signal: PricingSignalName;
  action: string;
  expectedUpliftEUR: number;
  confidence: Confidence;
}

export interface PricingBrainResult {
  ok: true;
  signals: PricingSignal[];  // exactly 6
  current: {
    activeListingsCount: number;
    avgProfitMarginPct: number;
    avgDaysOnMarket: number;
    competitorPriceAvgPct: number;
    priceElasticityScore: number;
    sellThroughRatePct: number;
    monthlyRevenue: number;
    avgOrderValue: number;
    priceWarDetected: boolean;
    seasonalMultiplier: number;
    psychologyOptimizedPct: number;
    lastPriceChangePct: number;
    pricingPower: number;       // 0-100 composite — ability to raise prices
  };
  maximization: {
    topActions: PricingBrainAction[];  // 3, ranked by uplift × confidence
    projection30d: {
      projectedMarginPct: number;
      projectedRevenue: number;
      recommendedPriceChangePct: number;   // avg % price adjustment (+/-)
      listingsToReprice: number;            // count of listings to reprice
    };
    projection90d: {
      projectedMarginPct: number;
      projectedRevenue: number;
      recommendedPriceChangePct: number;
      listingsToReprice: number;
    };
    pricingGrade: ProfitGrade;
    bestOpportunity: PricingSignalName;
    oneLineSummary: string;  // e.g. "Margin 25%, kompetitorji 5% ceneje. Zvišaj 5 itemov za 8%, znižaj 2 za 12%. Grade B."
  };
  aiUsed: false;
  source: 'v8.21-pricing-brain';
  cachedAt?: number;
}

// --- Defaults -------------------------------------------------------------

const DEFAULT_ACTIVE_LISTINGS_COUNT = 150;
const DEFAULT_AVG_PROFIT_MARGIN_PCT = 25;
const DEFAULT_AVG_DAYS_ON_MARKET = 14;
const DEFAULT_COMPETITOR_PRICE_AVG_PCT = 95; // 5% below competitor avg
const DEFAULT_PRICE_ELASTICITY_SCORE = 55;
const DEFAULT_SELL_THROUGH_RATE_PCT = 45;
const DEFAULT_MONTHLY_REVENUE = 350;
const DEFAULT_AVG_ORDER_VALUE = 180;
const DEFAULT_PRICE_WAR_DETECTED = false;
const DEFAULT_SEASONAL_MULTIPLIER = 1.0;
const DEFAULT_PSYCHOLOGY_OPTIMIZED_PCT = 40;
const DEFAULT_LAST_PRICE_CHANGE_PCT = 0;

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
  activeListingsCount: number;
  avgProfitMarginPct: number;
  avgDaysOnMarket: number;
  competitorPriceAvgPct: number;
  priceElasticityScore: number;
  sellThroughRatePct: number;
  monthlyRevenue: number;
  avgOrderValue: number;
  priceWarDetected: boolean;
  seasonalMultiplier: number;
  psychologyOptimizedPct: number;
  lastPriceChangePct: number;
}

function normalizeInput(input: PricingBrainInput | undefined | null): NormalizedInput {
  const num = (v: unknown, def: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : def;

  const activeListingsCount = Math.max(
    0,
    Math.round(num(input?.activeListingsCount, DEFAULT_ACTIVE_LISTINGS_COUNT)),
  );
  const avgProfitMarginPct = clamp(
    num(input?.avgProfitMarginPct, DEFAULT_AVG_PROFIT_MARGIN_PCT),
    0,
    100,
  );
  const avgDaysOnMarket = Math.max(0, num(input?.avgDaysOnMarket, DEFAULT_AVG_DAYS_ON_MARKET));
  const competitorPriceAvgPct = Math.max(
    0,
    num(input?.competitorPriceAvgPct, DEFAULT_COMPETITOR_PRICE_AVG_PCT),
  );
  const priceElasticityScore = clamp(
    num(input?.priceElasticityScore, DEFAULT_PRICE_ELASTICITY_SCORE),
    0,
    100,
  );
  const sellThroughRatePct = clamp(
    num(input?.sellThroughRatePct, DEFAULT_SELL_THROUGH_RATE_PCT),
    0,
    100,
  );
  const monthlyRevenue = Math.max(0, num(input?.monthlyRevenue, DEFAULT_MONTHLY_REVENUE));
  const avgOrderValue = Math.max(0, num(input?.avgOrderValue, DEFAULT_AVG_ORDER_VALUE));
  const priceWarDetected =
    typeof input?.priceWarDetected === 'boolean' ? input.priceWarDetected : DEFAULT_PRICE_WAR_DETECTED;
  const seasonalMultiplier = Math.max(
    0,
    num(input?.seasonalMultiplier, DEFAULT_SEASONAL_MULTIPLIER),
  );
  const psychologyOptimizedPct = clamp(
    num(input?.psychologyOptimizedPct, DEFAULT_PSYCHOLOGY_OPTIMIZED_PCT),
    0,
    100,
  );
  const lastPriceChangePct = num(input?.lastPriceChangePct, DEFAULT_LAST_PRICE_CHANGE_PCT);

  return {
    activeListingsCount,
    avgProfitMarginPct,
    avgDaysOnMarket,
    competitorPriceAvgPct,
    priceElasticityScore,
    sellThroughRatePct,
    monthlyRevenue,
    avgOrderValue,
    priceWarDetected,
    seasonalMultiplier,
    psychologyOptimizedPct,
    lastPriceChangePct,
  };
}

/**
 * 1. margin — profit margin health.
 *    Score = clamp(avgProfitMarginPct × 3, 0, 100) (33% margin = 100).
 *    Uplift = monthlyRevenue × 0.05 (5% revenue uplift from margin optimization).
 */
function computeMarginSignal(norm: NormalizedInput): PricingSignal {
  const score = clamp(norm.avgProfitMarginPct * 3, 0, 100);
  const upliftEURPerMonth = norm.monthlyRevenue * 0.05;
  const topLever = `Margin ${norm.avgProfitMarginPct.toFixed(0)}% — ${norm.avgProfitMarginPct < 20 ? 'NIZKA: zvišaj cene 5-10% na high-demand itemih' : norm.avgProfitMarginPct < 30 ? 'zmerna: optimiziraj bundle za margin boost' : 'zdrava: ohranjaj pricing power'}`;
  return {
    name: 'margin',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth: round2(Math.max(0, upliftEURPerMonth)),
    topLever,
  };
}

/**
 * 2. elasticity — price elasticity awareness.
 *    Score = clamp(priceElasticityScore, 0, 100) (direct — higher elasticity =
 *    more price-sensitive = need careful pricing).
 *    Uplift = activeListingsCount × 3 (€3/listing uplift from elasticity-aware repricing).
 */
function computeElasticitySignal(norm: NormalizedInput): PricingSignal {
  const score = clamp(norm.priceElasticityScore, 0, 100);
  const upliftEURPerMonth = norm.activeListingsCount * 3;
  const topLever = `Elastičnost ${norm.priceElasticityScore.toFixed(0)}/100 — ${norm.priceElasticityScore > 70 ? 'VISOKA: majhne spremembe velik vpliv — A/B test 2% koraki' : norm.priceElasticityScore > 40 ? 'zmerna: eksperimentiraj s 5% spremembami' : 'NIZKA: prostor za višje cene (inelastic)'}`;
  return {
    name: 'elasticity',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth: round2(Math.max(0, upliftEURPerMonth)),
    topLever,
  };
}

/**
 * 3. competitiveness — vs competitors.
 *    competitivenessScore = clamp(100 - Math.abs(competitorPriceAvgPct - 100) × 2, 0, 100)
 *    (90% or 110% of competitor = 80 score; 80% or 120% = 60).
 *    Uplift = monthlyRevenue × 0.04 (4% revenue uplift from better competitive positioning).
 */
function computeCompetitivenessSignal(norm: NormalizedInput): PricingSignal {
  const score = clamp(100 - Math.abs(norm.competitorPriceAvgPct - 100) * 2, 0, 100);
  const upliftEURPerMonth = norm.monthlyRevenue * 0.04;
  const topLever = `Cene ${norm.competitorPriceAvgPct > 100 ? '+' : ''}${(norm.competitorPriceAvgPct - 100).toFixed(0)}% vs kompetitorji — ${norm.competitorPriceAvgPct > 105 ? 'PREDRAGO: znižaj za 5%' : norm.competitorPriceAvgPct < 95 ? 'poceni: zvišaj za 5%' : 'pravilno pozicionirano'}`;
  return {
    name: 'competitiveness',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth: round2(Math.max(0, upliftEURPerMonth)),
    topLever,
  };
}

/**
 * 4. dynamic — dynamic/real-time pricing adoption.
 *    dynamicScore = clamp(
 *      (activeListingsCount > 0 ? (lastPriceChangePct !== 0 ? 60 : 20) : 0)
 *        + (seasonalMultiplier !== 1 ? 20 : 0)
 *        + (sellThroughRatePct < 30 ? 20 : 0),
 *      0, 100,
 *    )
 *    — score based on whether repricing happens, seasonality is tracked,
 *    slow movers are repriced.
 *    Uplift = activeListingsCount × 2 (€2/listing uplift from dynamic repricing).
 */
function computeDynamicSignal(norm: NormalizedInput): PricingSignal {
  const repricingPart = norm.activeListingsCount > 0 ? (norm.lastPriceChangePct !== 0 ? 60 : 20) : 0;
  const seasonalPart = norm.seasonalMultiplier !== 1 ? 20 : 0;
  const slowMoverPart = norm.sellThroughRatePct < 30 ? 20 : 0;
  const dynamicScore = clamp(repricingPart + seasonalPart + slowMoverPart, 0, 100);
  const upliftEURPerMonth = norm.activeListingsCount * 2;
  const topLever = `Dynamic pricing ${dynamicScore.toFixed(0)}/100 — ${dynamicScore < 40 ? 'NIZKA: implementiraj tedensko repricing avtomatizacijo' : dynamicScore < 70 ? 'delna: dodaj seasonal adjustments' : 'visoka: ohranjaj algoritem'}`;
  return {
    name: 'dynamic',
    score: round2(dynamicScore),
    grade: gradeFromScore(dynamicScore),
    upliftEURPerMonth: round2(Math.max(0, upliftEURPerMonth)),
    topLever,
  };
}

/**
 * 5. war — price war defense.
 *    If priceWarDetected: Score = clamp(40 - (100 - competitorPriceAvgPct) × 2, 0, 100)
 *      (war + undercut = bad).
 *    Else: Score = 90 (no war = healthy).
 *    Uplift = priceWarDetected ? monthlyRevenue × 0.06 : 0
 *      (6% revenue at risk if war continues, 0 if no war).
 */
function computeWarSignal(norm: NormalizedInput): PricingSignal {
  let score: number;
  let upliftEURPerMonth: number;
  if (norm.priceWarDetected) {
    score = clamp(40 - (100 - norm.competitorPriceAvgPct) * 2, 0, 100);
    upliftEURPerMonth = norm.monthlyRevenue * 0.06;
  } else {
    score = 90;
    upliftEURPerMonth = 0;
  }
  const topLever = `Price war ${norm.priceWarDetected ? 'DETEKTIRAN — diferenčiraj se z branding/bundle, ne samo cene' : 'ni aktiven — spremljaj kompetitorje'}`;
  return {
    name: 'war',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth: round2(Math.max(0, upliftEURPerMonth)),
    topLever,
  };
}

/**
 * 6. psychology — psychological pricing optimization.
 *    Score = clamp(psychologyOptimizedPct × 1.2, 0, 100) (83% optimized = 100).
 *    Uplift = (activeListingsCount - (activeListingsCount × psychologyOptimizedPct/100)) × 4
 *      (€4 per non-optimized listing that gets optimized).
 */
function computePsychologySignal(norm: NormalizedInput): PricingSignal {
  const score = clamp(norm.psychologyOptimizedPct * 1.2, 0, 100);
  const nonOptimizedListings = norm.activeListingsCount * (1 - norm.psychologyOptimizedPct / 100);
  const upliftEURPerMonth = nonOptimizedListings * 4;
  const topLever = `Psychology pricing ${norm.psychologyOptimizedPct.toFixed(0)}% — ${norm.psychologyOptimizedPct < 50 ? 'NIZKA: pretvori cene v .99/.95 (199€ namesto 200€)' : norm.psychologyOptimizedPct < 80 ? 'delna: optimiziraj preostale' : 'visoka: ohranjaj'}`;
  return {
    name: 'psychology',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth: round2(Math.max(0, upliftEURPerMonth)),
    topLever,
  };
}

// --- Synthesis ------------------------------------------------------------

// Pricing-grade weights — used to compute `maximization.pricingGrade`
// (weighted average of 6 signal scores, then gradeFromScore).
// Slightly different from PRICING_POWER_WEIGHTS: pricing-grade rewards the
// signals that contribute to overall pricing HEALTH (margin health,
// competitive position, elasticity awareness, dynamic adoption, war
// defense, psychology), whereas pricingPower rewards the signals that
// enable price INCREASES (margin health + competitive position + low
// elasticity).
const SIGNAL_WEIGHTS: Record<PricingSignalName, number> = {
  margin: 0.25,
  elasticity: 0.15,
  competitiveness: 0.20,
  dynamic: 0.15,
  war: 0.10,
  psychology: 0.15,
};

// Composite "pricingPower" weights — represents the ability to raise prices
// without losing volume. Slightly different from grade weights to emphasize
// the factors that enable price INCREASES (margin health + competitive
// position + elasticity awareness).
const PRICING_POWER_WEIGHTS: Record<PricingSignalName, number> = {
  margin: 0.25,
  elasticity: 0.15,
  competitiveness: 0.25,
  dynamic: 0.10,
  war: 0.10,
  psychology: 0.15,
};

function actionForSignal(signal: PricingSignal): string {
  // Templated human-readable action derived from the signal's topLever.
  switch (signal.name) {
    case 'margin':
      return `Optimiziraj margin: ${signal.topLever}`;
    case 'elasticity':
      return `Izkoristi elastičnost: ${signal.topLever}`;
    case 'competitiveness':
      return `Prilagodi kompetitivnost: ${signal.topLever}`;
    case 'dynamic':
      return `Vklopi dynamic pricing: ${signal.topLever}`;
    case 'war':
      return `Mitigiraj price war: ${signal.topLever}`;
    case 'psychology':
      return `Optimiziraj psychology pricing: ${signal.topLever}`;
    default:
      return signal.topLever;
  }
}

/**
 * Pricing Brain — pure deterministic compute.
 * Takes optional PricingBrainInput (with sensible defaults) and returns a
 * synthesized decision: 6 pricing signals, top 3 pricing actions, 30d/90d
 * pricing projections (projectedMarginPct + projectedRevenue +
 * recommendedPriceChangePct + listingsToReprice), overall pricing grade,
 * pricingPower composite, and a one-line summary.
 *
 * No side effects. No external calls. No DB. No AI.
 */
export function pricingBrain(input: PricingBrainInput = {}): PricingBrainResult {
  const norm = normalizeInput(input);

  // --- Compute all 6 signals ----------------------------------------------
  const margin = computeMarginSignal(norm);
  const elasticity = computeElasticitySignal(norm);
  const competitiveness = computeCompetitivenessSignal(norm);
  const dynamic = computeDynamicSignal(norm);
  const war = computeWarSignal(norm);
  const psychology = computePsychologySignal(norm);

  const signals: PricingSignal[] = [
    margin,
    elasticity,
    competitiveness,
    dynamic,
    war,
    psychology,
  ];

  // --- pricingPower composite (ability to raise prices) -------------------
  const pricingPowerRaw = signals.reduce(
    (acc, s) => acc + s.score * PRICING_POWER_WEIGHTS[s.name],
    0,
  );
  const pricingPower = clamp(pricingPowerRaw, 0, 100);

  // --- Weighted overall pricing grade -------------------------------------
  const weightedScore = signals.reduce(
    (acc, s) => acc + s.score * SIGNAL_WEIGHTS[s.name],
    0,
  );
  const pricingGrade = gradeFromScore(weightedScore);

  // --- Top 3 actions (sorted by uplift × confidence weight) ---------------
  // Confidence = HIGH if score ≥ 70, MEDIUM if ≥ 40, LOW otherwise.
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
  const topActions: PricingBrainAction[] = top3.map((entry, i) => ({
    rank: i + 1,
    domain: 'pricing',
    signal: entry.signal.name,
    action: actionForSignal(entry.signal),
    expectedUpliftEUR: round2(entry.signal.upliftEURPerMonth),
    confidence: entry.confidence,
  }));

  // --- Best opportunity = signal with highest upliftEURPerMonth -----------
  const bestOpportunitySignal = signals.reduce(
    (best, s) => (s.upliftEURPerMonth > best.upliftEURPerMonth ? s : best),
    signals[0],
  );
  const bestOpportunity = bestOpportunitySignal.name;

  // --- 30d projection (3-pt margin uplift, 8% revenue uplift, reprice 30%) -
  const projection30d = {
    projectedMarginPct: round2(norm.avgProfitMarginPct + 3),
    projectedRevenue: round2(norm.monthlyRevenue * 1.08),
    recommendedPriceChangePct:
      pricingPower > 60 ? 5 : pricingPower > 40 ? 2 : -3,
    listingsToReprice: Math.ceil(norm.activeListingsCount * 0.3),
  };

  // --- 90d projection (7-pt margin uplift, 18% revenue uplift, reprice 60%) -
  const projection90d = {
    projectedMarginPct: round2(norm.avgProfitMarginPct + 7),
    projectedRevenue: round2(norm.monthlyRevenue * 1.18),
    recommendedPriceChangePct:
      pricingPower > 60 ? 8 : pricingPower > 40 ? 4 : -2,
    listingsToReprice: Math.ceil(norm.activeListingsCount * 0.6),
  };

  // --- One-line summary ----------------------------------------------------
  const oneLineSummary = `Margin ${norm.avgProfitMarginPct.toFixed(0)}%, kompetitorji ${norm.competitorPriceAvgPct > 100 ? '+' : ''}${(norm.competitorPriceAvgPct - 100).toFixed(0)}%. ${topActions[0]?.action ?? ''}. Grade ${pricingGrade}.`;

  return {
    ok: true,
    signals,
    current: {
      activeListingsCount: norm.activeListingsCount,
      avgProfitMarginPct: round2(norm.avgProfitMarginPct),
      avgDaysOnMarket: round2(norm.avgDaysOnMarket),
      competitorPriceAvgPct: round2(norm.competitorPriceAvgPct),
      priceElasticityScore: round2(norm.priceElasticityScore),
      sellThroughRatePct: round2(norm.sellThroughRatePct),
      monthlyRevenue: round2(norm.monthlyRevenue),
      avgOrderValue: round2(norm.avgOrderValue),
      priceWarDetected: norm.priceWarDetected,
      seasonalMultiplier: round2(norm.seasonalMultiplier),
      psychologyOptimizedPct: round2(norm.psychologyOptimizedPct),
      lastPriceChangePct: round2(norm.lastPriceChangePct),
      pricingPower: round2(pricingPower),
    },
    maximization: {
      topActions,
      projection30d,
      projection90d,
      pricingGrade,
      bestOpportunity,
      oneLineSummary,
    },
    aiUsed: false,
    source: 'v8.21-pricing-brain',
  };
}
