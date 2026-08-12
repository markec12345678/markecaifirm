// v8.20: Buyer Brain — synthesizes 6 buyer signals into ONE decision.
// Pure deterministic compute — no AI, no DB, no side effects.
//
// Architectural role: this is the SIXTH Brain layer (after Profit Brain v8.15,
// Inventory Brain v8.16, Market Brain v8.17, Sourcing Brain v8.18, Risk Brain
// v8.19) that sits ABOVE the ~51 buyer specialist endpoints (buyer-intent,
// buyer-clv-predictor, buyer-churn-predictor-v2, buyer-loyalty-predictor-v2,
// buyer-conversion-predictor, buyer-engagement-optimizer, buyer-journey-mapper,
// buyer-acquisition-cost-optimizer, buyer-behavior-pattern-detector,
// buyer-behavior-predictor, ...). Each specialist measures ONE buyer
// dimension (intent, conversion, churn, LTV, loyalty, engagement). The Buyer
// Brain reads buyer context and synthesizes 6 buyer signals (intent,
// conversion, retention, lifetimeValue, loyalty, engagement) into:
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
//    recommendedOutreachCount — because buyer cultivation is multi-dimensional
//    (re-activate churned, increase LTV, reduce churn rate, plan outreach).
//  - Profit Brain = "how much money are you making?".
//    Buyer Brain = "which buyer lever grows your buyer base + LTV the most?".
//
// DIFFERENCES from Inventory Brain (v8.16):
//  - Inventory Brain answers "how well is your stock performing as capital?".
//    Buyer Brain answers "how well are you cultivating your buyer base?".
//  - Inventory Brain projects inventory value + aged stock %.
//    Buyer Brain projects active buyers + LTV + churn rate + outreach count.
//
// DIFFERENCES from Market Brain (v8.17):
//  - Market Brain reads MARKET CONTEXT (active listings, price changes,
//    inquiries, sell-through) → synthesizes market-cycle signals.
//    Buyer Brain reads BUYER CONTEXT (active buyers, new/churned, LTV, repeat
//    rate, conversion %, engagement) → synthesizes buyer-cultivation signals.
//  - Market Brain answers "where in the market cycle are we RIGHT NOW?".
//    Buyer Brain answers "which buyer dimension should we cultivate first?".
//
// DIFFERENCES from Sourcing Brain (v8.18):
//  - Sourcing Brain reads PER-SOURCE BREAKDOWN (capitalDeployed, monthlyProfit,
//    margin per source) → synthesizes sourcing-allocation signals.
//    Buyer Brain reads AGGREGATE BUYER CONTEXT (totalBuyers, activeBuyers,
//    churnedBuyers, LTV, repeat rate) → synthesizes buyer-cultivation signals.
//  - Sourcing Brain answers "which source should we scale / cut / add?".
//    Buyer Brain answers "how many buyers to contact + which cultivation
//    lever (intent / conversion / retention / LTV / loyalty / engagement)
//    yields the highest uplift?".
//
// DIFFERENCES from Risk Brain (v8.19):
//  - Risk Brain reads RISK EXPOSURE (concentration, fraud, volatility, aged
//    stock) → synthesizes risk-mitigation signals.
//    Buyer Brain reads BUYER CONTEXT (active buyers, churn, LTV, repeat,
//    engagement) → synthesizes buyer-cultivation signals.
//  - Risk Brain answers "what is your single biggest risk, and how do we
//    mitigate it?".
//    Buyer Brain answers "what is your single biggest buyer lever, and how
//    many buyers should we contact this month?".
//
// DIFFERENCES from the ~51 buyer specialists:
//  - Specialists measure ONE dimension (e.g. buyer-intent,
//    buyer-conversion-predictor, buyer-churn-predictor-v2, buyer-clv-predictor,
//    buyer-loyalty-predictor-v2, buyer-engagement-optimizer). Brain
//    SYNTHESIZES 6 dimensions into one decision.
//  - Specialists are flat endpoints. Brain sits ABOVE them.
//  - In v8.20 the Brain computes the 6 signals itself (pure deterministic
//    TypeScript — no AI, no HTTP fan-out). This keeps the Brain fast (<5ms)
//    and fully testable.
//
// This module is a PURE TypeScript function — no `next/server` import, no
// Prisma calls (state is injected by the caller via BuyerBrainInput). It is
// fully testable in isolation and deterministic given the same input.

// --- Types ----------------------------------------------------------------

import type { ProfitGrade, Confidence } from './profit';

export interface BuyerBrainInput {
  totalBuyers?: number;              // distinct buyers in database
  activeBuyersLast30d?: number;       // buyers who purchased in last 30 days
  newBuyersLast30d?: number;          // first-time buyers in last 30 days
  churnedBuyersLast30d?: number;      // previously active buyers who didn't purchase
  avgBuyerLifetimeValue?: number;    // EUR — avg revenue per buyer across their lifetime
  avgPurchaseFrequency?: number;      // purchases per buyer per year
  avgOrderValue?: number;             // EUR per purchase
  repeatBuyerRatePct?: number;        // % of buyers who made 2+ purchases
  inquiriesConvertedPct?: number;    // % of inquiries that led to a sale
  avgEngagementScore?: number;        // 0-100 (messages, opens, click-throughs)
  highValueBuyersCount?: number;      // buyers with LTV > 500€
}

export type BuyerSignalName =
  | 'intent'         // current purchase intent (are buyers ready to buy)
  | 'conversion'     // inquiry → sale conversion rate
  | 'retention'      // repeat purchase / churn prevention
  | 'lifetimeValue'  // avg LTV trend
  | 'loyalty'        // loyalty/advocacy
  | 'engagement';    // ongoing engagement

export interface BuyerSignal {
  name: BuyerSignalName;
  score: number;           // 0-100
  grade: ProfitGrade;
  upliftEURPerMonth: number;  // €/mo uplift if this signal is maximized
  topLever: string;          // human-readable action lever (in Slovenian)
}

export interface BuyerBrainAction {
  rank: number;
  domain: 'buyer';
  signal: BuyerSignalName;
  action: string;
  expectedUpliftEUR: number;
  confidence: Confidence;
}

export interface BuyerBrainResult {
  ok: true;
  signals: BuyerSignal[];  // exactly 6
  current: {
    totalBuyers: number;
    activeBuyersLast30d: number;
    newBuyersLast30d: number;
    churnedBuyersLast30d: number;
    avgBuyerLifetimeValue: number;
    avgPurchaseFrequency: number;
    avgOrderValue: number;
    repeatBuyerRatePct: number;
    inquiriesConvertedPct: number;
    avgEngagementScore: number;
    highValueBuyersCount: number;
    churnRatePct: number;            // churnedBuyersLast30d / totalBuyers × 100
    netGrowthPct: number;            // (new - churned) / total × 100
  };
  maximization: {
    topActions: BuyerBrainAction[];  // 3, ranked by uplift × confidence
    projection30d: {
      projectedActiveBuyers: number;
      projectedLTV: number;
      projectedChurnRatePct: number;
      recommendedOutreachCount: number;  // buyers to contact this month
    };
    projection90d: {
      projectedActiveBuyers: number;
      projectedLTV: number;
      projectedChurnRatePct: number;
      recommendedOutreachCount: number;
    };
    buyerGrade: ProfitGrade;
    bestOpportunity: BuyerSignalName;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: 'v8.20-buyer-brain';
  cachedAt?: number;
}

// --- Defaults -------------------------------------------------------------

const DEFAULT_TOTAL_BUYERS = 32;
const DEFAULT_ACTIVE_BUYERS_LAST_30D = 8;
const DEFAULT_NEW_BUYERS_LAST_30D = 4;
const DEFAULT_CHURNED_BUYERS_LAST_30D = 3;
const DEFAULT_AVG_BUYER_LIFETIME_VALUE = 280;
const DEFAULT_AVG_PURCHASE_FREQUENCY = 1.8;
const DEFAULT_AVG_ORDER_VALUE = 180;
const DEFAULT_REPEAT_BUYER_RATE_PCT = 25;
const DEFAULT_INQUIRIES_CONVERTED_PCT = 35;
const DEFAULT_AVG_ENGAGEMENT_SCORE = 45;
const DEFAULT_HIGH_VALUE_BUYERS_COUNT = 3;

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
  totalBuyers: number;
  activeBuyersLast30d: number;
  newBuyersLast30d: number;
  churnedBuyersLast30d: number;
  avgBuyerLifetimeValue: number;
  avgPurchaseFrequency: number;
  avgOrderValue: number;
  repeatBuyerRatePct: number;
  inquiriesConvertedPct: number;
  avgEngagementScore: number;
  highValueBuyersCount: number;
  churnRatePct: number;
  netGrowthPct: number;
}

function normalizeInput(input: BuyerBrainInput | undefined | null): NormalizedInput {
  const num = (v: unknown, def: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : def;

  const totalBuyers = Math.max(1, Math.round(num(input?.totalBuyers, DEFAULT_TOTAL_BUYERS)));
  const activeBuyersLast30d = Math.max(
    0,
    Math.round(num(input?.activeBuyersLast30d, DEFAULT_ACTIVE_BUYERS_LAST_30D)),
  );
  const newBuyersLast30d = Math.max(
    0,
    Math.round(num(input?.newBuyersLast30d, DEFAULT_NEW_BUYERS_LAST_30D)),
  );
  const churnedBuyersLast30d = Math.max(
    0,
    Math.round(num(input?.churnedBuyersLast30d, DEFAULT_CHURNED_BUYERS_LAST_30D)),
  );
  const avgBuyerLifetimeValue = Math.max(
    0,
    num(input?.avgBuyerLifetimeValue, DEFAULT_AVG_BUYER_LIFETIME_VALUE),
  );
  const avgPurchaseFrequency = Math.max(
    0,
    num(input?.avgPurchaseFrequency, DEFAULT_AVG_PURCHASE_FREQUENCY),
  );
  const avgOrderValue = Math.max(0, num(input?.avgOrderValue, DEFAULT_AVG_ORDER_VALUE));
  const repeatBuyerRatePct = clamp(
    num(input?.repeatBuyerRatePct, DEFAULT_REPEAT_BUYER_RATE_PCT),
    0,
    100,
  );
  const inquiriesConvertedPct = clamp(
    num(input?.inquiriesConvertedPct, DEFAULT_INQUIRIES_CONVERTED_PCT),
    0,
    100,
  );
  const avgEngagementScore = clamp(
    num(input?.avgEngagementScore, DEFAULT_AVG_ENGAGEMENT_SCORE),
    0,
    100,
  );
  const highValueBuyersCount = Math.max(
    0,
    Math.round(num(input?.highValueBuyersCount, DEFAULT_HIGH_VALUE_BUYERS_COUNT)),
  );

  const churnRatePct = (churnedBuyersLast30d / Math.max(totalBuyers, 1)) * 100;
  const netGrowthPct =
    ((newBuyersLast30d - churnedBuyersLast30d) / Math.max(totalBuyers, 1)) * 100;

  return {
    totalBuyers,
    activeBuyersLast30d,
    newBuyersLast30d,
    churnedBuyersLast30d,
    avgBuyerLifetimeValue,
    avgPurchaseFrequency,
    avgOrderValue,
    repeatBuyerRatePct,
    inquiriesConvertedPct,
    avgEngagementScore,
    highValueBuyersCount,
    churnRatePct,
    netGrowthPct,
  };
}

/**
 * 1. intent — current purchase intent (how many buyers are ready to buy NOW).
 *    intentScore = clamp((activeBuyersLast30d / max(totalBuyers, 1)) × 100 × 1.5, 0, 100)
 *      (67% active ratio × 1.5 = 100 — high active ratio signals high intent)
 *    Score = intentScore.
 *    Uplift = activeBuyersLast30d × avgOrderValue × 0.15 (15% of active buyers
 *    will convert if nudged with personalized offers).
 */
function computeIntentSignal(norm: NormalizedInput): BuyerSignal {
  const intentScore = clamp(
    (norm.activeBuyersLast30d / Math.max(norm.totalBuyers, 1)) * 100 * 1.5,
    0,
    100,
  );
  const upliftEURPerMonth = norm.activeBuyersLast30d * norm.avgOrderValue * 0.15;
  const topLever = `${norm.activeBuyersLast30d} aktivnih kupcev — ${intentScore >= 70 ? 'HIGH intent: pošlji 5 personaliziranih ponudb danes' : intentScore >= 40 ? 'MEDIUM intent: ogrej z informacijskimi sporočili' : 'LOW intent: fokus na nova pridobivanja'}`;
  return {
    name: 'intent',
    score: round2(intentScore),
    grade: gradeFromScore(intentScore),
    upliftEURPerMonth: round2(Math.max(0, upliftEURPerMonth)),
    topLever,
  };
}

/**
 * 2. conversion — inquiry → sale conversion rate.
 *    Score = clamp(inquiriesConvertedPct × 1.5, 0, 100) (67% conversion = 100).
 *    Uplift = activeBuyersLast30d × avgOrderValue × (0.2 - inquiriesConvertedPct/100 × 0.2)
 *      (gap to 100% conversion × 20% margin — wider gap = more recoverable
 *      revenue via better follow-up).
 */
function computeConversionSignal(norm: NormalizedInput): BuyerSignal {
  const score = clamp(norm.inquiriesConvertedPct * 1.5, 0, 100);
  const upliftEURPerMonth =
    norm.activeBuyersLast30d *
    norm.avgOrderValue *
    (0.2 - (norm.inquiriesConvertedPct / 100) * 0.2);
  const topLever = `Konverzija ${norm.inquiriesConvertedPct.toFixed(0)}% — ${norm.inquiriesConvertedPct < 40 ? 'NIZKA: izboljšaj follow-up (24h response, multi-channel)' : norm.inquiriesConvertedPct < 65 ? 'zmerna: optimiziraj pricing in messaging' : 'visoka: ohranjaj kakovost'}`;
  return {
    name: 'conversion',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth: round2(Math.max(0, upliftEURPerMonth)),
    topLever,
  };
}

/**
 * 3. retention — repeat purchase / churn prevention.
 *    churnRatePct = churnedBuyersLast30d / max(totalBuyers, 1) × 100.
 *    netGrowthPct = (newBuyersLast30d - churnedBuyersLast30d) / max(totalBuyers, 1) × 100.
 *    Score = clamp(100 - churnRatePct × 2 + netGrowthPct × 3, 0, 100)
 *      (low churn + positive growth = high score).
 *    Uplift = churnedBuyersLast30d × avgBuyerLifetimeValue × 0.3 (30% of churned
 *    buyers recoverable via reactivation campaign).
 */
function computeRetentionSignal(norm: NormalizedInput): BuyerSignal {
  const score = clamp(
    100 - norm.churnRatePct * 2 + norm.netGrowthPct * 3,
    0,
    100,
  );
  const upliftEURPerMonth = norm.churnedBuyersLast30d * norm.avgBuyerLifetimeValue * 0.3;
  const topLever = `Churn ${norm.churnRatePct.toFixed(0)}%, rast ${norm.netGrowthPct >= 0 ? '+' : ''}${norm.netGrowthPct.toFixed(0)}% — ${norm.churnRatePct > 15 ? 'VISOK churn: reactivation kampanja z 10% popustom' : 'zdrava retention'}`;
  return {
    name: 'retention',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth: round2(Math.max(0, upliftEURPerMonth)),
    topLever,
  };
}

/**
 * 4. lifetimeValue — avg LTV trend.
 *    Score = clamp(avgBuyerLifetimeValue / 10, 0, 100) (1000€ LTV = 100).
 *    Uplift = totalBuyers × 5 (5€/buyer uplift via LTV optimization).
 */
function computeLifetimeValueSignal(norm: NormalizedInput): BuyerSignal {
  const score = clamp(norm.avgBuyerLifetimeValue / 10, 0, 100);
  const upliftEURPerMonth = norm.totalBuyers * 5;
  const topLever = `Povprečni LTV ${Math.round(norm.avgBuyerLifetimeValue)}€ — ${norm.avgBuyerLifetimeValue < 200 ? 'NIZAK: upsell/cross-sell bundle paketi' : norm.avgBuyerLifetimeValue < 500 ? 'zmerna: loyalty program za repeat purchase' : 'visok: ohranjaj VIP odnos'}`;
  return {
    name: 'lifetimeValue',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth: round2(Math.max(0, upliftEURPerMonth)),
    topLever,
  };
}

/**
 * 5. loyalty — loyalty/advocacy.
 *    Score = clamp(repeatBuyerRatePct × 1.2 + (highValueBuyersCount / max(totalBuyers, 1)) × 100 × 2, 0, 100)
 *      (repeat rate + high-value buyer share — both contribute to loyalty)
 *    Uplift = highValueBuyersCount × avgOrderValue × 0.5 (50% uplift from VIP
 *    cultivation).
 */
function computeLoyaltySignal(norm: NormalizedInput): BuyerSignal {
  const score = clamp(
    norm.repeatBuyerRatePct * 1.2 +
      (norm.highValueBuyersCount / Math.max(norm.totalBuyers, 1)) * 100 * 2,
    0,
    100,
  );
  const upliftEURPerMonth = norm.highValueBuyersCount * norm.avgOrderValue * 0.5;
  const topLever = `Repeat ${norm.repeatBuyerRatePct.toFixed(0)}%, VIP ${norm.highValueBuyersCount} kupcev — ${norm.repeatBuyerRatePct < 20 ? 'NIZKA: loyalty program z tier-ji (bron/srebro/zlato)' : 'močna loyalty: fokus na VIP retention'}`;
  return {
    name: 'loyalty',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth: round2(Math.max(0, upliftEURPerMonth)),
    topLever,
  };
}

/**
 * 6. engagement — ongoing engagement.
 *    Score = clamp(avgEngagementScore, 0, 100) (direct).
 *    Uplift = totalBuyers × 2 (2€/buyer uplift via engagement optimization).
 */
function computeEngagementSignal(norm: NormalizedInput): BuyerSignal {
  const score = clamp(norm.avgEngagementScore, 0, 100);
  const upliftEURPerMonth = norm.totalBuyers * 2;
  const topLever = `Engagement ${norm.avgEngagementScore.toFixed(0)}/100 — ${norm.avgEngagementScore < 40 ? 'NIZAK: povečaj komunikacijo (Telegram, email, Bolha messages)' : norm.avgEngagementScore < 70 ? 'zmerna: personalize content' : 'visok: ohranjaj frekvenco'}`;
  return {
    name: 'engagement',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth: round2(Math.max(0, upliftEURPerMonth)),
    topLever,
  };
}

// --- Synthesis ------------------------------------------------------------

const SIGNAL_WEIGHTS: Record<BuyerSignalName, number> = {
  intent: 0.15,
  conversion: 0.20,
  retention: 0.20,
  lifetimeValue: 0.20,
  loyalty: 0.15,
  engagement: 0.10,
};

function actionForSignal(signal: BuyerSignal): string {
  // Templated human-readable action derived from the signal's topLever.
  switch (signal.name) {
    case 'intent':
      return `Kultiviraj intent: ${signal.topLever}`;
    case 'conversion':
      return `Izboljšaj konverzijo: ${signal.topLever}`;
    case 'retention':
      return `Zmanjšaj churn: ${signal.topLever}`;
    case 'lifetimeValue':
      return `Povečaj LTV: ${signal.topLever}`;
    case 'loyalty':
      return `Krepi lojalnost: ${signal.topLever}`;
    case 'engagement':
      return `Povečaj engagement: ${signal.topLever}`;
    default:
      return signal.topLever;
  }
}

/**
 * Buyer Brain — pure deterministic compute.
 * Takes optional BuyerBrainInput (with sensible defaults) and returns a
 * synthesized decision: 6 buyer signals, top 3 cultivation actions, 30d/90d buyer
 * projections (projectedActiveBuyers + projectedLTV + projectedChurnRatePct +
 * recommendedOutreachCount), overall buyer grade, and a one-line summary.
 *
 * No side effects. No external calls. No DB. No AI.
 */
export function buyerBrain(input: BuyerBrainInput = {}): BuyerBrainResult {
  const norm = normalizeInput(input);

  // --- Compute all 6 signals ----------------------------------------------
  const intent = computeIntentSignal(norm);
  const conversion = computeConversionSignal(norm);
  const retention = computeRetentionSignal(norm);
  const lifetimeValue = computeLifetimeValueSignal(norm);
  const loyalty = computeLoyaltySignal(norm);
  const engagement = computeEngagementSignal(norm);

  const signals: BuyerSignal[] = [
    intent,
    conversion,
    retention,
    lifetimeValue,
    loyalty,
    engagement,
  ];

  // --- Weighted overall buyer score ---------------------------------------
  const overallScore = signals.reduce(
    (acc, s) => acc + s.score * SIGNAL_WEIGHTS[s.name],
    0,
  );
  const buyerGrade = gradeFromScore(overallScore);

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
  const topActions: BuyerBrainAction[] = top3.map((entry, i) => ({
    rank: i + 1,
    domain: 'buyer',
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

  // --- 30d projection (15% active uplift, 5% LTV growth, 5-pt churn drop) -
  const projection30d = {
    projectedActiveBuyers: Math.round(norm.activeBuyersLast30d * 1.15),
    projectedLTV: round2(norm.avgBuyerLifetimeValue * 1.05),
    projectedChurnRatePct: round2(Math.max(2, norm.churnRatePct - 5)),
    recommendedOutreachCount: Math.ceil(norm.activeBuyersLast30d * 0.3),
  };

  // --- 90d projection (35% active uplift, 15% LTV growth, 10-pt churn) ----
  const projection90d = {
    projectedActiveBuyers: Math.round(norm.activeBuyersLast30d * 1.35),
    projectedLTV: round2(norm.avgBuyerLifetimeValue * 1.15),
    projectedChurnRatePct: round2(Math.max(1, norm.churnRatePct - 10)),
    recommendedOutreachCount: Math.ceil(norm.activeBuyersLast30d * 0.5),
  };

  // --- One-line summary ----------------------------------------------------
  const oneLineSummary = `${norm.totalBuyers} kupcev (LTV ${Math.round(norm.avgBuyerLifetimeValue)}€), ${norm.activeBuyersLast30d} aktivnih. ${topActions[0]?.action ?? ''}. Grade ${buyerGrade}.`;

  return {
    ok: true,
    signals,
    current: {
      totalBuyers: norm.totalBuyers,
      activeBuyersLast30d: norm.activeBuyersLast30d,
      newBuyersLast30d: norm.newBuyersLast30d,
      churnedBuyersLast30d: norm.churnedBuyersLast30d,
      avgBuyerLifetimeValue: round2(norm.avgBuyerLifetimeValue),
      avgPurchaseFrequency: round2(norm.avgPurchaseFrequency),
      avgOrderValue: round2(norm.avgOrderValue),
      repeatBuyerRatePct: round2(norm.repeatBuyerRatePct),
      inquiriesConvertedPct: round2(norm.inquiriesConvertedPct),
      avgEngagementScore: round2(norm.avgEngagementScore),
      highValueBuyersCount: norm.highValueBuyersCount,
      churnRatePct: round2(norm.churnRatePct),
      netGrowthPct: round2(norm.netGrowthPct),
    },
    maximization: {
      topActions,
      projection30d,
      projection90d,
      buyerGrade,
      bestOpportunity,
      oneLineSummary,
    },
    aiUsed: false,
    source: 'v8.20-buyer-brain',
  };
}
