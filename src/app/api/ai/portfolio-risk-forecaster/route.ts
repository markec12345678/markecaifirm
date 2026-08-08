// v7.90: AI Portfolio Risk Forecaster — AI forecast-a FUTURE RISK portfolia
// 30/60/90 dni vnaprej — projected risk score, emerging risk factors, in
// risk mitigation plan. Razlika od portfolio-stress-test (v7.59 ki test-a
// CURRENT portfolio pod stresnimi scenariji) — ta FORECAST-a kako bo
// portfolio RISK EVOLVIRAL čez čas. "Risk: 42/100 (MEDIUM), projected 55
// in 30d (WORSENING). Emerging: aging +10 items. Mitigation: sell 5
// items >60d → risk -15."
//
// Razlika od portfolio-concentration-risk (v7.65 ki da current
// concentration) — ta forecast-a future RISK composite. Razlika od
// portfolio-health-dashboard (v7.67 ki da current health 0-100) — ta
// forecast-a future RISK z mitigation plan. Razlika od risk-reward-
// calculator (v7.68 ki računa risk/reward per item) — ta je PORTFOLIO-
// level z emerging risks in mitigation. Razlika od risk-spread-calculator
// (diversification) — ta forecast-a composite risk evolution. Razlika od
// risk-hedging (hedging strategies) — ta je forward-looking z emerging
// risk factors. Razlika od risk-parity (risk parity) — ta gleda
// concentration + aging + market + liquidity + category risks composite.
//
// GET+POST /api/ai/portfolio-risk-forecaster
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

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type RiskTrend = 'IMPROVING' | 'STABLE' | 'WORSENING';
type RiskToleranceLevel = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

interface CurrentRisk {
  concentrationRisk: number; // 0-100 (HHI based)
  agingRisk: number; // 0-100 (% items held >60d)
  marketRisk: number; // 0-100 (current market conditions)
  liquidityRisk: number; // 0-100 (how easily convertible to cash)
  categoryRisk: number; // 0-100 (avg aiRisk across held items scaled)
  overallRiskScore: number; // 0-100 weighted composite
  currentRiskLevel: RiskLevel;
}

interface RiskForecast {
  projectedRisk30d: number;
  projectedRisk60d: number;
  projectedRisk90d: number;
  riskTrend: RiskTrend;
  projectedRiskLevel: RiskLevel;
  confidenceLevel: number; // 0-100
}

interface EmergingRiskFactor {
  risk: string;
  probability: number; // 0-100
  impact: string;
  timeline: string;
}

interface RiskHotspot {
  item: string;
  category: string;
  riskScore: number;
  reason: string;
}

interface MitigationAction {
  action: string;
  priority: ActionPriority;
  riskReduction: number; // 0-100
  timeline: string;
}

interface RiskTolerance {
  level: RiskToleranceLevel;
  assessment: string;
  acceptable: boolean;
}

interface RiskAnalysis {
  emergingRiskFactors: EmergingRiskFactor[];
  riskHotspots: RiskHotspot[];
  riskMitigationPlan: MitigationAction[];
  riskTolerance: RiskTolerance;
}

interface AiRiskResponse {
  projectedRisk30d?: number;
  projectedRisk60d?: number;
  projectedRisk90d?: number;
  riskTrend?: RiskTrend;
  projectedRiskLevel?: RiskLevel;
  confidenceLevel?: number;
  emergingRiskFactors?: Array<{
    risk?: string;
    probability?: number;
    impact?: string;
    timeline?: string;
  }>;
  riskHotspots?: Array<{
    item?: string;
    category?: string;
    riskScore?: number;
    reason?: string;
  }>;
  riskMitigationPlan?: Array<{
    action?: string;
    priority?: ActionPriority;
    riskReduction?: number;
    timeline?: string;
  }>;
  riskTolerance?: {
    level?: RiskToleranceLevel;
    assessment?: string;
    acceptable?: boolean;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const PROJECTION_MIN = 0;
const PROJECTION_MAX = 100;
const CONFIDENCE_MIN = 0;
const CONFIDENCE_MAX = 100;
const PROBABILITY_MIN = 0;
const PROBABILITY_MAX = 100;
const RISK_REDUCTION_MIN = 0;
const RISK_REDUCTION_MAX = 100;

const VALID_TREND: readonly RiskTrend[] = ['IMPROVING', 'STABLE', 'WORSENING'];
const VALID_LEVEL: readonly RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const VALID_TOLERANCE: readonly RiskToleranceLevel[] = ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'];
const VALID_PRIORITY: readonly ActionPriority[] = ['HIGH', 'MEDIUM', 'LOW'];

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

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = avg(values);
  const sumSq = values.reduce((s, v) => s + (v - m) * (v - m), 0);
  return Math.sqrt(sumSq / values.length);
}

function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 75) return 'CRITICAL';
  if (score >= 55) return 'HIGH';
  if (score >= 30) return 'MEDIUM';
  return 'LOW';
}

// --- Trade row with linked listing --------------------------------------

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyDate: Date | null;
  listing: {
    aiRisk: number | null;
    aiEstimatedValue: number | null;
    dealScore: number | null;
    firstSeenAt: Date | null;
    contactStatus: string | null;
    monitor: { source: string | null } | null;
  } | null;
}

interface SoldTradeRow {
  buyPrice: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellDate: Date | null;
  category: string;
}

// --- Deterministic current risk ------------------------------------------

function computeCurrentRisk(
  heldTrades: HeldTradeRow[],
  soldTrades: SoldTradeRow[],
  now: number,
): CurrentRisk {
  const totalItems = heldTrades.length;

  if (totalItems === 0) {
    return {
      concentrationRisk: 0,
      agingRisk: 0,
      marketRisk: 50, // neutral when no data
      liquidityRisk: 50,
      categoryRisk: 0,
      overallRiskScore: 0,
      currentRiskLevel: 'LOW',
    };
  }

  // 1) Concentration risk — Herfindahl-Hirschman Index by category
  // HHI = sum of (share %)^2, scaled 0-10000 → normalize to 0-100
  const catMap = new Map<string, number>();
  let totalCapital = 0;
  for (const t of heldTrades) {
    const cat = (t.category || '').trim().toLowerCase() || 'neznan';
    const cap = t.buyPrice ?? 0;
    catMap.set(cat, (catMap.get(cat) ?? 0) + cap);
    totalCapital += cap;
  }
  let herfindahlIndex = 0;
  if (totalCapital > 0) {
    for (const [, cap] of catMap.entries()) {
      const share = (cap / totalCapital) * 100;
      herfindahlIndex += share * share;
    }
  }
  // HHI scaled 0-10000 → divide by 100 → 0-100
  const concentrationRisk = round0(
    Math.max(SCORE_MIN, Math.min(SCORE_MAX, herfindahlIndex / 100)),
  );

  // 2) Aging risk — % of items held >60 days (weighted: >90d = full, 60-90d = half)
  let agingWeighted = 0;
  for (const t of heldTrades) {
    const buyMs = toMs(t.buyDate);
    if (buyMs <= 0) continue;
    const daysHeld = (now - buyMs) / DAY_MS;
    if (daysHeld > 90) agingWeighted += 1;
    else if (daysHeld > 60) agingWeighted += 0.5;
  }
  const agingRisk = round0(
    Math.max(SCORE_MIN, Math.min(SCORE_MAX, (agingWeighted / totalItems) * 100)),
  );

  // 3) Market risk — based on recent sold trade volatility
  // If recent SOLD trades show declining profit trend = higher market risk
  const recentSold = soldTrades.filter((t) => {
    const sellMs = toMs(t.sellDate);
    return sellMs > 0 && (now - sellMs) < 90 * DAY_MS;
  });
  let marketRisk = 50; // neutral baseline
  if (recentSold.length >= 4) {
    // Compute profit per trade (chronological order)
    const sorted = [...recentSold].sort((a, b) => toMs(a.sellDate) - toMs(b.sellDate));
    const profits = sorted.map((t) => (t.sellPrice ?? 0) - (t.buyPrice ?? 0));
    const profitSlope = trendSlope(profits);
    // Negative slope = declining profits = higher market risk
    if (profitSlope < -5) marketRisk = 75;
    else if (profitSlope < -1) marketRisk = 65;
    else if (profitSlope > 5) marketRisk = 25;
    else if (profitSlope > 1) marketRisk = 35;
    // volatility also increases risk
    const sd = stddev(profits);
    const avgAbsProfit = Math.max(1, Math.abs(avg(profits)));
    const cv = sd / avgAbsProfit;
    if (cv > 1.5) marketRisk = Math.min(100, marketRisk + 15);
    else if (cv > 0.8) marketRisk = Math.min(100, marketRisk + 8);
  }
  const marketRiskFinal = round0(
    Math.max(SCORE_MIN, Math.min(SCORE_MAX, marketRisk)),
  );

  // 4) Liquidity risk — how easily convertible to cash?
  // Based on: avg days-to-sell (historical), % items with no contact, low dealScore
  let liquidityScore = 50; // neutral baseline
  // Historical avg hold days (from SOLD trades)
  const soldWithDates = soldTrades.filter((t) => toMs(t.buyDate) > 0 && toMs(t.sellDate) > 0);
  if (soldWithDates.length > 0) {
    const holdDays = soldWithDates.map((t) =>
      Math.max(0, (toMs(t.sellDate) - toMs(t.buyDate)) / DAY_MS),
    );
    const avgHoldDays = avg(holdDays);
    // >60d avg = high liquidity risk, <14d = low
    if (avgHoldDays > 60) liquidityScore = 75;
    else if (avgHoldDays > 30) liquidityScore = 60;
    else if (avgHoldDays > 14) liquidityScore = 45;
    else liquidityScore = 25;
  }
  // Adjust: items without contact = harder to sell
  const noContactItems = heldTrades.filter(
    (t) => !t.listing?.contactStatus || t.listing.contactStatus === 'none',
  ).length;
  const noContactPct = (noContactItems / totalItems) * 100;
  liquidityScore += Math.min(25, noContactPct * 0.25);
  const liquidityRisk = round0(
    Math.max(SCORE_MIN, Math.min(SCORE_MAX, liquidityScore)),
  );

  // 5) Category risk — avg aiRisk (1-10) across held items, scaled to 0-100
  const aiRisks = heldTrades
    .map((t) => t.listing?.aiRisk)
    .filter((r): r is number => r != null && r > 0);
  const avgAiRisk = aiRisks.length > 0 ? avg(aiRisks) : 5; // default mid
  // aiRisk 1-10 → *10 = 10-100
  const categoryRisk = round0(
    Math.max(SCORE_MIN, Math.min(SCORE_MAX, avgAiRisk * 10)),
  );

  // Overall risk score — weighted composite
  // concentration 25% + aging 25% + market 20% + liquidity 15% + category 15%
  const overallRiskScore = round0(
    Math.max(SCORE_MIN, Math.min(SCORE_MAX,
      concentrationRisk * 0.25 +
      agingRisk * 0.25 +
      marketRiskFinal * 0.20 +
      liquidityRisk * 0.15 +
      categoryRisk * 0.15,
    )),
  );

  return {
    concentrationRisk,
    agingRisk,
    marketRisk: marketRiskFinal,
    liquidityRisk,
    categoryRisk,
    overallRiskScore,
    currentRiskLevel: riskLevelFromScore(overallRiskScore),
  };
}

// Linear regression slope per index
function trendSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = avg(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i]! - yMean);
    den += Math.pow(i - xMean, 2);
  }
  if (den === 0) return 0;
  return num / den;
}

// --- Deterministic forecast ----------------------------------------------

function buildDeterministicForecast(current: CurrentRisk): RiskForecast {
  const base = current.overallRiskScore;

  // Project risk evolution based on current risk components:
  // - Aging risk grows over time (items get older)
  // - Concentration risk grows if portfolio is already concentrated (sticky)
  // - Market risk mean-reverts (volatile, tends toward 50)
  // - Liquidity risk grows slowly
  // - Category risk stays roughly stable

  // Aging grows by ~1.5/wk per aging-risk-point contribution
  const agingGrowth = (current.agingRisk * 0.012); // per day
  // Concentration grows slightly if >50 (sticky concentration)
  const concGrowth = current.concentrationRisk > 50 ? 0.05 : 0.02;
  // Market mean-reverts toward 50
  const marketReversion = (50 - current.marketRisk) * 0.01;
  // Liquidity grows slowly
  const liqGrowth = 0.03;

  // Daily composite change
  const dailyChange =
    agingGrowth * 0.25 +
    concGrowth * 0.25 +
    marketReversion * 0.20 +
    liqGrowth * 0.15;

  const projectedRisk30d = round0(
    Math.max(PROJECTION_MIN, Math.min(PROJECTION_MAX, base + dailyChange * 30)),
  );
  const projectedRisk60d = round0(
    Math.max(PROJECTION_MIN, Math.min(PROJECTION_MAX, base + dailyChange * 60)),
  );
  const projectedRisk90d = round0(
    Math.max(PROJECTION_MIN, Math.min(PROJECTION_MAX, base + dailyChange * 90)),
  );

  // Risk trend from projection trajectory
  let riskTrend: RiskTrend = 'STABLE';
  const delta90 = projectedRisk90d - base;
  if (delta90 > 4) riskTrend = 'WORSENING';
  else if (delta90 < -4) riskTrend = 'IMPROVING';

  const projectedRiskLevel = riskLevelFromScore(projectedRisk30d);

  // Confidence — based on how much data we have (higher base = lower confidence due to volatility)
  // Higher concentration + aging = more predictable (sticky)
  let confidence = 55;
  if (current.concentrationRisk > 60) confidence += 10; // very predictable
  if (current.agingRisk > 60) confidence += 8;
  if (current.marketRisk > 70) confidence -= 12; // market volatility = less confidence
  if (current.marketRisk < 30) confidence += 5;
  confidence += Math.min(10, (current.overallRiskScore - 50) * 0.2); // high risk = more visible
  const confidenceLevel = round0(
    Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX, confidence)),
  );

  return {
    projectedRisk30d,
    projectedRisk60d,
    projectedRisk90d,
    riskTrend,
    projectedRiskLevel,
    confidenceLevel,
  };
}

// --- Deterministic emerging risk + hotspots + mitigation + tolerance -----

interface DeterministicAnalysis {
  emergingRiskFactors: EmergingRiskFactor[];
  riskHotspots: RiskHotspot[];
  riskMitigationPlan: MitigationAction[];
  riskTolerance: RiskTolerance;
}

function buildDeterministicAnalysis(
  current: CurrentRisk,
  forecast: RiskForecast,
  heldTrades: HeldTradeRow[],
  now: number,
): DeterministicAnalysis {
  const emergingRiskFactors: EmergingRiskFactor[] = [];
  const riskHotspots: RiskHotspot[] = [];
  const riskMitigationPlan: MitigationAction[] = [];

  // Emerging risks — based on which components are growing
  if (current.agingRisk > 40 && forecast.riskTrend === 'WORSENING') {
    const oldItems = heldTrades.filter((t) => {
      const buyMs = toMs(t.buyDate);
      return buyMs > 0 && (now - buyMs) > 60 * DAY_MS;
    }).length;
    emergingRiskFactors.push({
      risk: `Aging inventory bo rastel — ${oldItems} items bo preseglo 60d holding v naslednjih 30 dneh`,
      probability: clampNum(60 + current.agingRisk * 0.3, PROBABILITY_MIN, PROBABILITY_MAX, 70),
      impact: 'Povečan carrying cost in zmanjšana likvidnost',
      timeline: '30 dni',
    });
  }
  if (current.concentrationRisk > 50) {
    emergingRiskFactors.push({
      risk: `Koncentracija v eni kategoriji bo povečala exposure na kategorijo-specifične šoke`,
      probability: clampNum(50 + current.concentrationRisk * 0.3, PROBABILITY_MIN, PROBABILITY_MAX, 65),
      impact: 'Asimetrična izguba če kategorija pade',
      timeline: '60 dni',
    });
  }
  if (current.marketRisk > 60) {
    emergingRiskFactors.push({
      risk: `Market pogoji se slabšajo — padajoči profit trend v zadnjih 90 dneh`,
      probability: clampNum(55 + current.marketRisk * 0.25, PROBABILITY_MIN, PROBABILITY_MAX, 70),
      impact: 'Nižje realizacijske cene pri prodaji',
      timeline: '45 dni',
    });
  }
  if (current.liquidityRisk > 55) {
    emergingRiskFactors.push({
      risk: `Likvidnost portfolia se zmanjšuje — podaljšan cycle time in nizka buyer interest`,
      probability: clampNum(50 + current.liquidityRisk * 0.25, PROBABILITY_MIN, PROBABILITY_MAX, 60),
      impact: 'Zaklenjen kapital, zamujene reinvestment priložnosti',
      timeline: '60 dni',
    });
  }
  if (current.categoryRisk > 60) {
    emergingRiskFactors.push({
      risk: `AI Risk score held inventarja je visok — sumnjive/affective listings prevladujejo`,
      probability: clampNum(50 + current.categoryRisk * 0.25, PROBABILITY_MIN, PROBABILITY_MAX, 65),
      impact: 'Poslabšanje inventarja, težja prodaja',
      timeline: '45 dni',
    });
  }
  if (emergingRiskFactors.length === 0) {
    emergingRiskFactors.push({
      risk: 'Ni detektiranih emerging risk faktorjev — portfolio stabilen',
      probability: 20,
      impact: 'Minimalen vpliv',
      timeline: '90 dni',
    });
  }

  // Risk hotspots — top 5 highest-risk items
  const itemRisks: Array<{ tradeId: string; title: string; category: string; riskScore: number; reason: string }> = [];
  for (const t of heldTrades) {
    const buyMs = toMs(t.buyDate);
    const daysHeld = buyMs > 0 ? (now - buyMs) / DAY_MS : 0;
    const aiRisk = t.listing?.aiRisk ?? 5;
    let itemRisk = 30; // base
    if (daysHeld > 90) itemRisk += 35;
    else if (daysHeld > 60) itemRisk += 25;
    else if (daysHeld > 30) itemRisk += 12;
    itemRisk += aiRisk * 3;
    if (t.listing?.contactStatus === 'none' || !t.listing?.contactStatus) itemRisk += 8;
    if (t.listing?.dealScore != null && t.listing.dealScore < 30) itemRisk += 10;
    itemRisk = Math.max(SCORE_MIN, Math.min(SCORE_MAX, itemRisk));

    const reasons: string[] = [];
    if (daysHeld > 60) reasons.push(`${Math.round(daysHeld)}d held`);
    if (aiRisk >= 7) reasons.push(`aiRisk ${aiRisk}/10`);
    if (t.listing?.contactStatus === 'none' || !t.listing?.contactStatus) reasons.push('no contact');
    if (t.listing?.dealScore != null && t.listing.dealScore < 30) reasons.push(`low dealScore ${t.listing.dealScore}`);

    itemRisks.push({
      tradeId: t.id,
      title: t.title.slice(0, 80),
      category: (t.category || 'neznan').slice(0, 40),
      riskScore: round0(itemRisk),
      reason: reasons.join(', ') || 'splošno tveganje',
    });
  }
  itemRisks.sort((a, b) => b.riskScore - a.riskScore);
  for (const r of itemRisks.slice(0, 5)) {
    riskHotspots.push({
      item: r.title,
      category: r.category,
      riskScore: r.riskScore,
      reason: r.reason,
    });
  }

  // Mitigation plan — based on highest risk components
  if (current.agingRisk > 50) {
    const oldItems = heldTrades.filter((t) => {
      const buyMs = toMs(t.buyDate);
      return buyMs > 0 && (now - buyMs) > 60 * DAY_MS;
    }).length;
    riskMitigationPlan.push({
      action: `Prodaj ${Math.min(5, Math.ceil(oldItems / 2))} items starejših od 60 dni (price drop 10-15%)`,
      priority: 'HIGH',
      riskReduction: clampNum(15 + current.agingRisk * 0.1, RISK_REDUCTION_MIN, RISK_REDUCTION_MAX, 15),
      timeline: '14 dni',
    });
  }
  if (current.concentrationRisk > 55) {
    riskMitigationPlan.push({
      action: `Diversificiraj portfolio — dodaj item-e v 2-3 novih kategorijah za zmanjšanje HHI`,
      priority: 'HIGH',
      riskReduction: clampNum(12 + current.concentrationRisk * 0.08, RISK_REDUCTION_MIN, RISK_REDUCTION_MAX, 12),
      timeline: '30 dni',
    });
  }
  if (current.marketRisk > 60) {
    riskMitigationPlan.push({
      action: `Zmanjšaj buying aktivnost za 25% — market pogoji se slabšajo, čakaj na signal za obrat`,
      priority: 'MEDIUM',
      riskReduction: clampNum(10 + current.marketRisk * 0.05, RISK_REDUCTION_MIN, RISK_REDUCTION_MAX, 10),
      timeline: '30 dni',
    });
  }
  if (current.liquidityRisk > 55) {
    riskMitigationPlan.push({
      action: `Ciljno promoviraj nizko-contact item-e (cross-posting, boljše fotografije, nižja cena)`,
      priority: 'MEDIUM',
      riskReduction: clampNum(8 + current.liquidityRisk * 0.05, RISK_REDUCTION_MIN, RISK_REDUCTION_MAX, 8),
      timeline: '21 dni',
    });
  }
  if (current.categoryRisk > 60) {
    riskMitigationPlan.push({
      action: `Re-evaluiraj held inventar z AI — premakni sumnjive item-e v liquidation`,
      priority: 'MEDIUM',
      riskReduction: clampNum(8 + current.categoryRisk * 0.05, RISK_REDUCTION_MIN, RISK_REDUCTION_MAX, 8),
      timeline: '14 dni',
    });
  }
  if (riskMitigationPlan.length === 0) {
    riskMitigationPlan.push({
      action: 'Vzdržuj trenutno strategijo — portfolio v zdravem stanju, redno monitoring',
      priority: 'LOW',
      riskReduction: 5,
      timeline: '60 dni',
    });
  }

  // Risk tolerance — based on portfolio size + overall risk score
  const totalItems = heldTrades.length;
  let level: RiskToleranceLevel = 'BALANCED';
  if (totalItems < 5) level = 'CONSERVATIVE';
  else if (totalItems > 20) level = 'AGGRESSIVE';

  const acceptable = current.overallRiskScore < 60;
  const assessment = `Portfolio z ${totalItems} items, overall risk ${current.overallRiskScore}/100 (${current.currentRiskLevel}). ` +
    (acceptable
      ? `Tveganje je sprejemljivo za ${level} profil.`
      : `Tveganje PRESEGA sprejemljiv nivo za ${level} profil — potrebna mitigacija.`);

  return {
    emergingRiskFactors: emergingRiskFactors.slice(0, 5),
    riskHotspots,
    riskMitigationPlan: riskMitigationPlan.slice(0, 5),
    riskTolerance: {
      level,
      assessment: assessment.slice(0, 400),
      acceptable,
    },
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handlePortfolioRiskForecaster(req);
}
export async function POST(req: NextRequest) {
  return handlePortfolioRiskForecaster(req);
}

async function handlePortfolioRiskForecaster(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-portfolio-risk-forecaster', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();

    // 1) Query all HELD trades with linked Listing
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyDate: true,
        listing: {
          select: {
            aiRisk: true,
            aiEstimatedValue: true,
            dealScore: true,
            firstSeenAt: true,
            contactStatus: true,
            monitor: { select: { source: true } },
          },
        },
      },
      orderBy: { buyDate: 'asc' },
      take: 100000,
    }) as unknown as HeldTradeRow[];

    // 2) Query SOLD trades from last 12 months for historical risk patterns
    const cutoff12m = new Date(now - 365 * DAY_MS);
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
      },
      select: {
        buyPrice: true,
        buyDate: true,
        sellPrice: true,
        sellDate: true,
        category: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    // 3) Compute current risk metrics
    const current = computeCurrentRisk(heldTrades, soldTrades, now);

    // 4) Empty state
    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        current: {
          concentrationRisk: 0,
          agingRisk: 0,
          marketRisk: current.marketRisk,
          liquidityRisk: current.liquidityRisk,
          categoryRisk: 0,
          overallRiskScore: 0,
          currentRiskLevel: 'LOW' as RiskLevel,
        },
        forecast: {
          projectedRisk30d: 0,
          projectedRisk60d: 0,
          projectedRisk90d: 0,
          riskTrend: 'STABLE' as RiskTrend,
          projectedRiskLevel: 'LOW' as RiskLevel,
          confidenceLevel: 30,
        },
        analysis: {
          emergingRiskFactors: [{
            risk: 'Ni HELD inventarja — portfolio prazen, ni emerging risk-ov',
            probability: 10,
            impact: 'Minimalen vpliv',
            timeline: '90 dni',
          }],
          riskHotspots: [],
          riskMitigationPlan: [{
            action: 'Dodaj HELD item-e v portfolio za risk forecasting',
            priority: 'LOW' as ActionPriority,
            riskReduction: 0,
            timeline: 'Takoj',
          }],
          riskTolerance: {
            level: 'CONSERVATIVE' as RiskToleranceLevel,
            assessment: 'Ni HELD inventarja — Portfolio Risk Forecaster ni mogoč.',
            acceptable: true,
          },
        },
        summary: 'Ni HELD inventarja — Portfolio Risk Forecaster ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD inventarja — Portfolio Risk Forecaster ni mogoč.',
      });
    }

    // 5) Deterministic baseline (fallback)
    const detForecast = buildDeterministicForecast(current);
    const detAnalysis = buildDeterministicAnalysis(current, detForecast, heldTrades, now);

    let forecast: RiskForecast = detForecast;
    let analysis: DeterministicAnalysis = detAnalysis;
    let summary = buildSummary(current, detForecast, detAnalysis, heldTrades.length);

    // 6) AI cache check (6h TTL) — key by held item IDs
    const heldItemIds = heldTrades.map((t) => t.id).sort();
    const cacheKey = `portfolio-risk-forecaster:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<{
      forecast: RiskForecast;
      analysis: DeterministicAnalysis;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        current,
        forecast: cached.forecast,
        analysis: cached.analysis,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 7) AI prompt with grounding
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
      current,
      deterministicForecast: detForecast,
      deterministicAnalysis: detAnalysis,
      portfolio: {
        totalItems: heldTrades.length,
        totalSoldTrades: soldTrades.length,
        heldItemsSummary: heldTrades.slice(0, 30).map((t) => ({
          title: t.title.slice(0, 60),
          category: (t.category || 'neznan').slice(0, 30),
          buyPrice: t.buyPrice,
          daysHeld: t.buyDate
            ? Math.round((now - toMs(t.buyDate)) / DAY_MS)
            : 0,
          aiRisk: t.listing?.aiRisk ?? null,
          dealScore: t.listing?.dealScore ?? null,
          contactStatus: t.listing?.contactStatus ?? null,
        })),
      },
      caps: {
        projectionMin: PROJECTION_MIN, projectionMax: PROJECTION_MAX,
        confidenceMin: CONFIDENCE_MIN, confidenceMax: CONFIDENCE_MAX,
        probabilityMin: PROBABILITY_MIN, probabilityMax: PROBABILITY_MAX,
        riskReductionMin: RISK_REDUCTION_MIN, riskReductionMax: RISK_REDUCTION_MAX,
      },
    };

    const prompt = `Si AI "Portfolio Risk Forecaster" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Forecast-aš FUTURE RISK portfolia 30/60/90 dni vnaprej — projected risk score, emerging risk factors, in risk mitigation plan. Razlika od portfolio-stress-test (ki test-a current portfolio pod stresnimi scenariji) — ti FORECAST-a kako bo portfolio RISK EVOLVIRAL čez čas.

DETERMINISTIČNI PODATKI (izračunano iz DB — HELD trades + SOLD 12m history):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. forecast: { projectedRisk30d/60d/90d: 0-100, ±15 od deterministic, riskTrend: IMPROVING | STABLE | WORSENING, projectedRiskLevel: LOW | MEDIUM | HIGH | CRITICAL, confidenceLevel: 0-100 ±15 od deterministic }.
2. analysis.emergingRiskFactors: 2-5 faktorjev { risk (max 200 chars), probability 0-100, impact (max 150 chars), timeline (max 30 chars) }.
3. analysis.riskHotspots: 2-5 top risk items { item (max 80 chars), category (max 40 chars), riskScore 0-100, reason (max 150 chars) }.
4. analysis.riskMitigationPlan: 2-5 akcij { action (max 200 chars), priority HIGH | MEDIUM | LOW, riskReduction 0-100, timeline (max 30 chars) }.
5. analysis.riskTolerance: { level CONSERVATIVE | BALANCED | AGGRESSIVE, assessment (max 400 chars), acceptable: boolean }.
6. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi deterministične.

VRNI LE JSON:
{
  "projectedRisk30d": 55,
  "projectedRisk60d": 62,
  "projectedRisk90d": 68,
  "riskTrend": "WORSENING",
  "projectedRiskLevel": "HIGH",
  "confidenceLevel": 72,
  "emergingRiskFactors": [
    { "risk": "Aging inventory bo rastel — 10 items bo preseglo 60d", "probability": 75, "impact": "Povečan carrying cost", "timeline": "30 dni" }
  ],
  "riskHotspots": [
    { "item": "iPhone 13 Pro", "category": "elektronika", "riskScore": 78, "reason": "85d held, aiRisk 8/10, no contact" }
  ],
  "riskMitigationPlan": [
    { "action": "Prodaj 5 items >60d z 10% price drop", "priority": "HIGH", "riskReduction": 18, "timeline": "14 dni" }
  ],
  "riskTolerance": { "level": "BALANCED", "assessment": "Portfolio 15 items, risk 55/100 (HIGH). Presega sprejemljiv nivo.", "acceptable": false },
  "summary": "Risk 55/100 (HIGH), projected 68 v 90d (WORSENING). Emerging: aging +10 items. Mitigation: prodaj 5 items → risk -18."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiRiskResponse | null;

      if (parsed && typeof parsed === 'object') {
        // Anti-hallucination: clamp projections within ±15 of deterministic
        const projectedRisk30d = round0(
          Math.max(PROJECTION_MIN, Math.min(PROJECTION_MAX,
            detForecast.projectedRisk30d + Math.max(-15, Math.min(15,
              (Number(parsed.projectedRisk30d ?? detForecast.projectedRisk30d)) - detForecast.projectedRisk30d)))),
        );
        const projectedRisk60d = round0(
          Math.max(PROJECTION_MIN, Math.min(PROJECTION_MAX,
            detForecast.projectedRisk60d + Math.max(-15, Math.min(15,
              (Number(parsed.projectedRisk60d ?? detForecast.projectedRisk60d)) - detForecast.projectedRisk60d)))),
        );
        const projectedRisk90d = round0(
          Math.max(PROJECTION_MIN, Math.min(PROJECTION_MAX,
            detForecast.projectedRisk90d + Math.max(-15, Math.min(15,
              (Number(parsed.projectedRisk90d ?? detForecast.projectedRisk90d)) - detForecast.projectedRisk90d)))),
        );

        const riskTrend = clampEnum(parsed.riskTrend, VALID_TREND, detForecast.riskTrend);
        const projectedRiskLevel = clampEnum(parsed.projectedRiskLevel, VALID_LEVEL, detForecast.projectedRiskLevel);
        const confidenceLevel = round0(
          Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX,
            detForecast.confidenceLevel + Math.max(-15, Math.min(15,
              (Number(parsed.confidenceLevel ?? detForecast.confidenceLevel)) - detForecast.confidenceLevel)))),
        );

        forecast = {
          projectedRisk30d,
          projectedRisk60d,
          projectedRisk90d,
          riskTrend,
          projectedRiskLevel,
          confidenceLevel,
        };

        // Emerging risk factors — validate array + clamp fields
        const emergingRiskFactors: EmergingRiskFactor[] = [];
        if (Array.isArray(parsed.emergingRiskFactors)) {
          for (const f of parsed.emergingRiskFactors.slice(0, 5)) {
            if (!f || typeof f !== 'object') continue;
            emergingRiskFactors.push({
              risk: clampString(f.risk, 200, detAnalysis.emergingRiskFactors[0]?.risk ?? 'Ni podatka'),
              probability: clampNum(f.probability, PROBABILITY_MIN, PROBABILITY_MAX, 50),
              impact: clampString(f.impact, 150, detAnalysis.emergingRiskFactors[0]?.impact ?? 'Neznan'),
              timeline: clampString(f.timeline, 30, detAnalysis.emergingRiskFactors[0]?.timeline ?? '30 dni'),
            });
          }
        }
        if (emergingRiskFactors.length === 0) {
          // fallback to deterministic
          for (const f of detAnalysis.emergingRiskFactors) emergingRiskFactors.push(f);
        }

        // Risk hotspots
        const riskHotspots: RiskHotspot[] = [];
        if (Array.isArray(parsed.riskHotspots)) {
          for (const h of parsed.riskHotspots.slice(0, 5)) {
            if (!h || typeof h !== 'object') continue;
            riskHotspots.push({
              item: clampString(h.item, 80, detAnalysis.riskHotspots[0]?.item ?? 'neznan'),
              category: clampString(h.category, 40, detAnalysis.riskHotspots[0]?.category ?? 'neznan'),
              riskScore: clampNum(h.riskScore, SCORE_MIN, SCORE_MAX, detAnalysis.riskHotspots[0]?.riskScore ?? 50),
              reason: clampString(h.reason, 150, detAnalysis.riskHotspots[0]?.reason ?? 'splošno tveganje'),
            });
          }
        }
        if (riskHotspots.length === 0) {
          for (const h of detAnalysis.riskHotspots) riskHotspots.push(h);
        }

        // Mitigation plan
        const riskMitigationPlan: MitigationAction[] = [];
        if (Array.isArray(parsed.riskMitigationPlan)) {
          for (const m of parsed.riskMitigationPlan.slice(0, 5)) {
            if (!m || typeof m !== 'object') continue;
            riskMitigationPlan.push({
              action: clampString(m.action, 200, detAnalysis.riskMitigationPlan[0]?.action ?? 'Vzdržuj strategijo'),
              priority: clampEnum(m.priority, VALID_PRIORITY, detAnalysis.riskMitigationPlan[0]?.priority ?? 'MEDIUM'),
              riskReduction: clampNum(m.riskReduction, RISK_REDUCTION_MIN, RISK_REDUCTION_MAX,
                detAnalysis.riskMitigationPlan[0]?.riskReduction ?? 5),
              timeline: clampString(m.timeline, 30, detAnalysis.riskMitigationPlan[0]?.timeline ?? '30 dni'),
            });
          }
        }
        if (riskMitigationPlan.length === 0) {
          for (const m of detAnalysis.riskMitigationPlan) riskMitigationPlan.push(m);
        }

        // Risk tolerance
        const rt = parsed.riskTolerance ?? {};
        const riskTolerance: RiskTolerance = {
          level: clampEnum(rt.level, VALID_TOLERANCE, detAnalysis.riskTolerance.level),
          assessment: clampString(rt.assessment, 400, detAnalysis.riskTolerance.assessment),
          acceptable: typeof rt.acceptable === 'boolean' ? rt.acceptable : detAnalysis.riskTolerance.acceptable,
        };

        analysis = {
          emergingRiskFactors,
          riskHotspots,
          riskMitigationPlan,
          riskTolerance,
        };

        summary = clampString(parsed.summary, 400, buildSummary(current, forecast, analysis, heldTrades.length));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/portfolio-risk-forecaster',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        forecast,
        analysis,
        summary,
      });
    }

    return NextResponse.json({
      ok: true,
      current,
      forecast,
      analysis,
      summary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error(
      '/api/ai/portfolio-risk-forecaster',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

function buildSummary(
  current: CurrentRisk,
  forecast: RiskForecast,
  analysis: DeterministicAnalysis,
  totalItems: number,
): string {
  const topMitigation = analysis.riskMitigationPlan[0];
  const topEmerging = analysis.emergingRiskFactors[0];
  const parts: string[] = [
    `Risk ${current.overallRiskScore}/100 (${current.currentRiskLevel}), projected ${forecast.projectedRisk30d} v 30d (${forecast.riskTrend}).`,
  ];
  if (topEmerging) {
    parts.push(`Emerging: ${topEmerging.risk.slice(0, 80)}.`);
  }
  if (topMitigation) {
    parts.push(`Mitigation: ${topMitigation.action.slice(0, 80)} → risk -${topMitigation.riskReduction}.`);
  }
  parts.push(`Portfolio ${totalItems} items, ${analysis.riskTolerance.level} tolerance.`);
  return parts.join(' ').slice(0, 400);
}
