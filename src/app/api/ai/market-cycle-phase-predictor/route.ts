// v7.87: AI Market Cycle Phase Predictor — AI napove EXACT TIMING market
// cycle phase transitions — kdaj se bo MARKUP končal in DISTRIBUTION začel?
// Uporablja multiple indicators (price/volume/dealQuality/sentiment momentum)
// za prediction phase transition dates z confidence. Razlika od market-cycle-detector
// (v7.77 ki detektira current phase) — ta PREDICT-a transition timing. Razlika
// od market-cycle-forecaster (v7.83 ki projicira phases) — ta napove TRANSITION
// TIMING z daysUntilTransition in preTransitionActions.
// "Current: MARKUP (LATE phase, 85% maturity). Next: DISTRIBUTION in ~18d.
// Action: start selling NOW."
//
// GET+POST /api/ai/market-cycle-phase-predictor
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

type CyclePhase = 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'DECLINE';
type PhaseMaturity = 'EARLY' | 'MID' | 'LATE';
type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

interface MomentumIndicator {
  slope: number;
  acceleration: number;
  signal: string;
}

interface SimpleMomentumIndicator {
  slope: number;
  signal: string;
}

interface CurrentPhaseInfo {
  phase: CyclePhase;
  phaseIntensityScore: number; // 0-100
  phaseMaturity: PhaseMaturity;
  weeksInPhase: number;
}

interface Indicators {
  priceMomentum: MomentumIndicator;
  volumeMomentum: MomentumIndicator;
  dealQualityMomentum: SimpleMomentumIndicator;
  sentimentMomentum: SimpleMomentumIndicator;
}

interface PhaseTransitionPrediction {
  nextPhase: string;
  predictedTransitionDate: string; // ISO date
  daysUntilTransition: number;
  transitionConfidence: number; // 0-100
  transitionSignals: string[];
}

interface StrategyAction {
  action: string;
  priority: ActionPriority;
  timing: string;
}

interface Strategy {
  preTransitionActions: StrategyAction[];
  postTransitionStrategy: string;
  phaseStrategy: string;
}

interface AiPhaseResponse {
  prediction?: unknown;
  strategy?: unknown;
  summary?: unknown;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const HORIZON_365D = 365 * DAY_MS;
const INTENSITY_MIN = 0;
const INTENSITY_MAX = 100;
const CONFIDENCE_MIN = 0;
const CONFIDENCE_MAX = 100;
const DAYS_UNTIL_MIN = 0;
const DAYS_UNTIL_MAX = 180;

const VALID_PHASE: readonly CyclePhase[] = [
  'ACCUMULATION',
  'MARKUP',
  'DISTRIBUTION',
  'DECLINE',
];
const VALID_MATURITY: readonly PhaseMaturity[] = ['EARLY', 'MID', 'LATE'];
const VALID_PRIORITY: readonly ActionPriority[] = ['HIGH', 'MEDIUM', 'LOW'];

// Cycle phase transitions — each phase has only one logical "next" phase
const NEXT_PHASE_MAP: Record<CyclePhase, CyclePhase> = {
  ACCUMULATION: 'MARKUP',
  MARKUP: 'DISTRIBUTION',
  DISTRIBUTION: 'DECLINE',
  DECLINE: 'ACCUMULATION',
};

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
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = avg(values);
  const variance =
    values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / values.length;
  return Math.sqrt(variance);
}

// Linear regression slope
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

// Acceleration: slope of last half - slope of first half
function computeAcceleration(values: number[]): number {
  if (values.length < 4) return 0;
  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);
  return trendSlope(secondHalf) - trendSlope(firstHalf);
}

function isoWeekStart(ms: number): number {
  // ISO week starts Monday
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const offset = day === 0 ? 6 : day - 1;
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset));
  return start.getTime();
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().split('T')[0]!;
}

// --- Cycle classification logic ------------------------------------------
// Adapted from market-cycle-detector (v7.77). Determines current phase from
// price + volume + volatility trends.

type TrendDirection = 'UP' | 'FLAT' | 'DOWN';

function directionFromSlope(
  slope: number,
  thresholdPct: number,
  meanValue: number,
): TrendDirection {
  if (meanValue <= 0) return 'FLAT';
  const relSlope = (slope / meanValue) * 100;
  if (relSlope > thresholdPct) return 'UP';
  if (relSlope < -thresholdPct) return 'DOWN';
  return 'FLAT';
}

function classifyPhase(
  price90d: TrendDirection,
  price30d: TrendDirection,
  volume90d: TrendDirection,
  volume30d: TrendDirection,
  volatilityIndex: number,
): { phase: CyclePhase; confidence: number } {
  let accScore = 0;
  let markupScore = 0;
  let distScore = 0;
  let declineScore = 0;

  if (price90d === 'FLAT' || price90d === 'DOWN') accScore += 2;
  if (volume90d === 'FLAT' || volume90d === 'DOWN') accScore += 1;
  if (price30d === 'FLAT') accScore += 1;
  if (volatilityIndex < 25) accScore += 1;

  if (price90d === 'UP') markupScore += 2;
  if (price30d === 'UP') markupScore += 2;
  if (volume90d === 'UP' || volume30d === 'UP') markupScore += 1;
  if (volatilityIndex >= 15 && volatilityIndex < 35) markupScore += 1;

  if (price90d === 'UP' && price30d === 'FLAT') distScore += 2;
  if (price30d === 'FLAT') distScore += 1;
  if (volume90d === 'UP' && volume30d === 'FLAT') distScore += 1;
  if (volatilityIndex >= 35) distScore += 2;
  if (volume30d === 'UP') distScore += 1;

  if (price90d === 'DOWN') declineScore += 2;
  if (price30d === 'DOWN') declineScore += 2;
  if (volume90d === 'DOWN') declineScore += 1;
  if (volume30d === 'DOWN') declineScore += 1;
  if (volatilityIndex >= 30) declineScore += 1;

  const scores: Array<{ phase: CyclePhase; score: number }> = [
    { phase: 'ACCUMULATION', score: accScore },
    { phase: 'MARKUP', score: markupScore },
    { phase: 'DISTRIBUTION', score: distScore },
    { phase: 'DECLINE', score: declineScore },
  ];
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0]!;
  const total = scores.reduce((s, sc) => s + sc.score, 0);
  const confidence =
    total > 0 ? Math.min(95, Math.max(15, Math.round((top.score / total) * 100))) : 20;
  return { phase: top.phase, confidence };
}

// Compute phase maturity (EARLY/MID/LATE) based on:
// - cycleProgress (0-100): how far into current phase
// - trend deceleration (late phase shows fading signal)
function classifyPhaseMaturity(
  phase: CyclePhase,
  cycleProgress: number,
  trend30d: TrendDirection,
): PhaseMaturity {
  // Combine cycleProgress + 30d trend signal to determine maturity
  // EARLY: progress < 33 OR trend just started changing direction
  // MID: progress 33-66
  // LATE: progress > 66 AND trend weakening
  let progress = cycleProgress;

  // Late phase signals (trend deceleration):
  // MARKUP late = price30d FLAT (was UP)
  // DISTRIBUTION late = price30d DOWN (was FLAT)
  // ACCUMULATION late = volume30d UP (smart money returning)
  // DECLINE late = price30d FLAT (bottoming)
  if (
    (phase === 'MARKUP' && trend30d === 'FLAT') ||
    (phase === 'DISTRIBUTION' && trend30d === 'DOWN') ||
    (phase === 'DECLINE' && trend30d === 'FLAT') ||
    (phase === 'ACCUMULATION' && trend30d === 'UP')
  ) {
    progress = Math.max(progress, 70);
  }

  if (progress < 33) return 'EARLY';
  if (progress < 67) return 'MID';
  return 'LATE';
}

// Compute cycle progress 0-100 (heuristic — same logic as market-cycle-detector)
function computeCycleProgress(
  phase: CyclePhase,
  price30d: TrendDirection,
  volume30d: TrendDirection,
): number {
  if (phase === 'ACCUMULATION') {
    if (volume30d === 'UP' && price30d === 'FLAT') return 80;
    if (volume30d === 'UP') return 65;
    return 45;
  }
  if (phase === 'MARKUP') {
    if (price30d === 'FLAT') return 80;
    if (price30d === 'UP' && volume30d === 'FLAT') return 65;
    if (price30d === 'UP' && volume30d === 'UP') return 50;
    return 40;
  }
  if (phase === 'DISTRIBUTION') {
    if (price30d === 'DOWN') return 85;
    if (volume30d === 'DOWN') return 70;
    return 55;
  }
  // DECLINE
  if (price30d === 'FLAT' && volume30d === 'FLAT') return 80;
  if (price30d === 'FLAT') return 65;
  if (price30d === 'DOWN' && volume30d === 'DOWN') return 50;
  return 45;
}

// Phase intensity score 0-100: how strong is the current phase?
// Higher = more decisive trend, lower = weak/uncertain phase
function computePhaseIntensity(
  phase: CyclePhase,
  phaseConfidence: number,
  priceSlopeAbs: number,
  volumeSlopeAbs: number,
  priceMean: number,
  volumeMean: number,
): number {
  // Base: phase confidence (15-95 → 15-95 points)
  let score = phaseConfidence * 0.5;
  // Price slope magnitude (relative): ±5%/week = 25 points
  if (priceMean > 0) {
    const relSlope = Math.abs(priceSlopeAbs / priceMean) * 100;
    score += Math.max(0, Math.min(25, (relSlope / 5) * 25));
  }
  // Volume slope magnitude (relative): ±10%/week = 25 points
  if (volumeMean > 0) {
    const relVol = Math.abs(volumeSlopeAbs / volumeMean) * 100;
    score += Math.max(0, Math.min(25, (relVol / 10) * 25));
  }
  return round0(Math.max(INTENSITY_MIN, Math.min(INTENSITY_MAX, score)));
}

// --- Deterministic prediction --------------------------------------------

// Estimate weeks until phase transition based on phase + maturity + momentum
function estimateWeeksUntilTransition(
  phase: CyclePhase,
  maturity: PhaseMaturity,
  intensity: number,
  priceAcceleration: number,
  volumeAcceleration: number,
): number {
  // Base by maturity (in weeks)
  // EARLY: 8-12 weeks, MID: 4-8 weeks, LATE: 1-4 weeks
  let baseWeeks: number;
  switch (maturity) {
    case 'EARLY': baseWeeks = 10; break;
    case 'MID': baseWeeks = 6; break;
    case 'LATE': baseWeeks = 3; break;
    default: baseWeeks = 6;
  }

  // High intensity = phase is strong → may last a bit longer
  if (intensity >= 75) baseWeeks += 1;
  else if (intensity < 30) baseWeeks -= 2;

  // Strong acceleration in the direction of next phase = transition sooner
  // MARKUP → DISTRIBUTION: price accel negative (decelerating growth) = sooner
  // DISTRIBUTION → DECLINE: price accel negative = sooner
  // ACCUMULATION → MARKUP: volume accel positive = sooner
  // DECLINE → ACCUMULATION: price accel positive (bottoming) = sooner
  const accelTowardsTransition =
    (phase === 'MARKUP' || phase === 'DISTRIBUTION')
      ? -priceAcceleration // negative price accel = transition sooner
      : (phase === 'ACCUMULATION' ? volumeAcceleration : priceAcceleration);

  if (accelTowardsTransition < -0.5) baseWeeks -= 2;
  else if (accelTowardsTransition < -0.2) baseWeeks -= 1;
  else if (accelTowardsTransition > 0.5) baseWeeks += 2;

  return Math.max(1, Math.min(26, baseWeeks));
}

function buildDeterministicPrediction(
  phase: CyclePhase,
  maturity: PhaseMaturity,
  intensity: number,
  weeksInPhase: number,
  priceAccel: number,
  volumeAccel: number,
  now: number,
): PhaseTransitionPrediction {
  const nextPhase = NEXT_PHASE_MAP[phase];
  const weeksUntil = estimateWeeksUntilTransition(
    phase,
    maturity,
    intensity,
    priceAccel,
    volumeAccel,
  );
  const daysUntil = weeksUntil * 7;
  const predictedTransitionDate = isoDate(now + daysUntil * DAY_MS);

  // Confidence: based on intensity + data quality (more weeks = more confident)
  let confidence = 35;
  if (maturity === 'LATE') confidence += 30;
  else if (maturity === 'MID') confidence += 15;
  if (intensity >= 70) confidence += 15;
  else if (intensity >= 40) confidence += 8;
  if (weeksInPhase >= 8) confidence += 10;
  else if (weeksInPhase >= 4) confidence += 5;
  confidence = round0(Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX, confidence)));

  // Transition signals (deterministic)
  const signals: string[] = [];
  if (maturity === 'LATE') {
    signals.push(`${phase} faza je v LATE maturity (${weeksInPhase}+ tednov) — trend se izrablja.`);
  } else if (maturity === 'MID') {
    signals.push(`${phase} faza je v MID maturity — še vedno nezaželen za transition.`);
  } else {
    signals.push(`${phase} faza je v EARLY maturity — transition še ni verjeten.`);
  }
  if (priceAccel < -0.3) {
    signals.push(`Cenovni trend izgublja momentum (acceleration ${round2(priceAccel)}) — signal transition.`);
  } else if (priceAccel > 0.3) {
    signals.push(`Cenovni trend še vedno pridobiva momentum (acceleration ${round2(priceAccel)}) — transition manj verjeten kratkoročno.`);
  }
  if (volumeAccel < -0.3) {
    signals.push(`Volumen izgublja momentum (acceleration ${round2(volumeAccel)}) —参与ost trga se zmanjšuje.`);
  } else if (volumeAccel > 0.3) {
    signals.push(`Volumen še vedno pridobiva (acceleration ${round2(volumeAccel)}) — trg je aktiven.`);
  }
  if (intensity >= 70) {
    signals.push(`Phase intensity ${intensity}/100 — močan signal v smeri trenutne faze, vendar bo prešel v ${nextPhase}.`);
  } else if (intensity < 30) {
    signals.push(`Phase intensity ${intensity}/100 — šibka faza, transition negotov.`);
  }

  return {
    nextPhase,
    predictedTransitionDate,
    daysUntilTransition: Math.max(DAYS_UNTIL_MIN, Math.min(DAYS_UNTIL_MAX, daysUntil)),
    transitionConfidence: confidence,
    transitionSignals: signals.slice(0, 5),
  };
}

function buildDeterministicStrategy(
  phase: CyclePhase,
  maturity: PhaseMaturity,
  prediction: PhaseTransitionPrediction,
): Strategy {
  const nextPhase = prediction.nextPhase;
  const daysUntil = prediction.daysUntilTransition;

  const preTransitionActions: StrategyAction[] = [];

  // Action depends on current phase + what's coming next
  if (phase === 'MARKUP') {
    if (maturity === 'LATE') {
      preTransitionActions.push({
        action: 'Začni postopno prodajo inventarja (50% v naslednjih 7-14 dneh)',
        priority: 'HIGH',
        timing: 'V naslednjih 7 dneh',
      });
      preTransitionActions.push({
        action: 'Ustavi nove nakupe (razen exception dealov >70% margin)',
        priority: 'HIGH',
        timing: 'Takoj',
      });
    } else if (maturity === 'MID') {
      preTransitionActions.push({
        action: 'Optimiziraj pricing za hitrejši turnover (5-10% znižanja)',
        priority: 'MEDIUM',
        timing: 'V naslednjih 14 dneh',
      });
    } else {
      preTransitionActions.push({
        action: 'Nadaljuj z nakupi, vendar skrbi za quality nad quantity',
        priority: 'MEDIUM',
        timing: 'V naslednjih 30 dni',
      });
    }
  } else if (phase === 'DISTRIBUTION') {
    preTransitionActions.push({
      action: 'Prodaj ves inventar z >20% margin (DISTRIBUTION → DECLINE prehod)',
      priority: 'HIGH',
      timing: 'Takoj',
    });
    preTransitionActions.push({
      action: 'Zmanjšaj izpostavljenost tveganim kategorijam',
      priority: 'HIGH',
      timing: 'V naslednjih 7 dneh',
    });
  } else if (phase === 'ACCUMULATION') {
    preTransitionActions.push({
      action: 'Povečaj buying volume — ACCUMULATION faza je idealna za nakup',
      priority: 'HIGH',
      timing: 'V naslednjih 30 dni',
    });
    preTransitionActions.push({
      action: 'Identificiraj kategorije z najnižjimi cenami za bulk buy',
      priority: 'MEDIUM',
      timing: 'V naslednjih 14 dni',
    });
  } else if (phase === 'DECLINE') {
    preTransitionActions.push({
      action: 'Zadrži kapital — DECLINE faza, ne prodaj razen nuje',
      priority: 'HIGH',
      timing: 'Takoj',
    });
    preTransitionActions.push({
      action: 'Postavi buy alerts za kategorije kjer cene dosežejo bottom',
      priority: 'MEDIUM',
      timing: 'V naslednjih 30 dni',
    });
  }

  if (preTransitionActions.length === 0) {
    preTransitionActions.push({
      action: 'Monitor trga — vzdržuj trenutno strategijo',
      priority: 'LOW',
      timing: 'V naslednjih 14 dni',
    });
  }

  // Post-transition strategy
  let postTransitionStrategy: string;
  switch (nextPhase) {
    case 'MARKUP':
      postTransitionStrategy = `Po prehodu v MARKUP (~${daysUntil} dni): povečaj inventory, cene bodo rasle. Fokus na buying + listing.`;
      break;
    case 'DISTRIBUTION':
      postTransitionStrategy = `Po prehodu v DISTRIBUTION (~${daysUntil} dni): prodaj inventar, cene so na vrhu. Fokus na selling + cash collection.`;
      break;
    case 'DECLINE':
      postTransitionStrategy = `Po prehodu v DECLINE (~${daysUntil} dni): zadrži kapital, čakaj na naslednjo ACCUMULATION. Fokus na cash preservation.`;
      break;
    case 'ACCUMULATION':
      postTransitionStrategy = `Po prehodu v ACCUMULATION (~${daysUntil} dni): začni postopno nakupovanje, cene so nizke. Fokus na buying opportunities.`;
      break;
    default:
      postTransitionStrategy = `Po prehodu v ${nextPhase}: prilagodi strategijo glede na novo phase.`;
  }

  // Phase strategy
  const phaseStrategy: string = (() => {
    switch (phase) {
      case 'ACCUMULATION':
        return `Trenutno ACCUMULATION (${maturity}) — buying faza. Akumuliraj kvalitetne deal-e pred prihajajočim MARKUP. Najvišja prioriteta: sourcing + buying.`;
      case 'MARKUP':
        return `Trenutno MARKUP (${maturity}) — bull faza, cene rastejo. Nadaljuj nakupe (manj agresivno v LATE) in pripravi selling strategijo za DISTRIBUTION.`;
      case 'DISTRIBUTION':
        return `Trenutno DISTRIBUTION (${maturity}) — selling faza, cene visoke. Aktivno prodaj inventar, zmanjšaj izpostavljenost. Najvišja prioriteta: selling + cash collection.`;
      case 'DECLINE':
        return `Trenutno DECLINE (${maturity}) — bear faza, cene padajo. Zadrži kapital, postavi buy alerts, čakaj na ACCUMULATION signal. Najvišja prioriteta: capital preservation.`;
      default:
        return 'Strategija odvisna od tržne faze.';
    }
  })();

  return {
    preTransitionActions: preTransitionActions.slice(0, 4),
    postTransitionStrategy: postTransitionStrategy.slice(0, 400),
    phaseStrategy: phaseStrategy.slice(0, 400),
  };
}

function buildDeterministicSummary(
  currentPhase: CurrentPhaseInfo,
  prediction: PhaseTransitionPrediction,
): string {
  return `Current: ${currentPhase.phase} (${currentPhase.phaseMaturity} maturity, ${currentPhase.phaseIntensityScore}/100 intensity, ${currentPhase.weeksInPhase}w). Next: ${prediction.nextPhase} v ~${prediction.daysUntilTransition}d (${prediction.predictedTransitionDate}). Confidence ${prediction.transitionConfidence}%.`.slice(0, 400);
}

// --- Listing row ---------------------------------------------------------

interface ListingRow {
  id: string;
  price: number | null;
  firstSeenAt: Date;
  dealScore: number | null;
  monitor: { source: string | null } | null;
}

interface WeeklyAgg {
  totalListings: number;
  pricedListings: number;
  sumPrice: number;
  sumDealScore: number;
  dealScoreCount: number;
  // Sold trade activity (for sentiment momentum — sell-through proxy)
  // (we don't have sellThrough at listing level — but totalListings itself is a volume signal)
}

function emptyWeeklyAgg(): WeeklyAgg {
  return {
    totalListings: 0,
    pricedListings: 0,
    sumPrice: 0,
    sumDealScore: 0,
    dealScoreCount: 0,
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleMarketCyclePhasePredictor(req);
}
export async function POST(req: NextRequest) {
  return handleMarketCyclePhasePredictor(req);
}

async function handleMarketCyclePhasePredictor(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-market-cycle-phase-predictor', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const cutoff = new Date(now - HORIZON_365D);

    // 1) Query listings from last 365 days
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: cutoff },
        isHidden: false,
      },
      select: {
        id: true,
        price: true,
        firstSeenAt: true,
        dealScore: true,
        monitor: { select: { source: true } },
      },
      take: 200000,
    });

    const rows = listings as unknown as ListingRow[];

    // 2) Build weekly aggregates
    const overallByWeek = new Map<number, WeeklyAgg>();
    for (const l of rows) {
      const firstSeenMs =
        (l.firstSeenAt as unknown as Date).getTime?.() ??
        new Date(l.firstSeenAt as unknown as Date | string).getTime();
      if (!Number.isFinite(firstSeenMs) || firstSeenMs < cutoff.getTime()) continue;
      const weekMs = isoWeekStart(firstSeenMs);
      let agg = overallByWeek.get(weekMs);
      if (!agg) {
        agg = emptyWeeklyAgg();
        overallByWeek.set(weekMs, agg);
      }
      agg.totalListings += 1;
      if (l.price != null && l.price > 0) {
        agg.pricedListings += 1;
        agg.sumPrice += l.price;
      }
      if (l.dealScore != null && l.dealScore > 0) {
        agg.sumDealScore += l.dealScore;
        agg.dealScoreCount += 1;
      }
    }

    const sortedWeekKeys = Array.from(overallByWeek.keys()).sort((a, b) => a - b);

    // Empty state
    if (sortedWeekKeys.length < 4) {
      return NextResponse.json({
        ok: true,
        currentPhase: {
          phase: 'ACCUMULATION',
          phaseIntensityScore: 0,
          phaseMaturity: 'EARLY',
          weeksInPhase: sortedWeekKeys.length,
        },
        indicators: {
          priceMomentum: { slope: 0, acceleration: 0, signal: 'Ni dovolj tedenskih podatkov.' },
          volumeMomentum: { slope: 0, acceleration: 0, signal: 'Ni dovolj tedenskih podatkov.' },
          dealQualityMomentum: { slope: 0, signal: 'Ni dovolj tedenskih podatkov.' },
          sentimentMomentum: { slope: 0, signal: 'Ni dovolj tedenskih podatkov.' },
        },
        prediction: {
          nextPhase: 'MARKUP',
          predictedTransitionDate: isoDate(now + 90 * DAY_MS),
          daysUntilTransition: 90,
          transitionConfidence: 10,
          transitionSignals: [
            `Premalo tedenskih podatkov (${sortedWeekKeys.length} tednov) — zberi vsaj 4 tedne za zanesljivo phase prediction.`,
          ],
        },
        strategy: {
          preTransitionActions: [
            { action: 'Zberi vsaj 4 tedne podatkov za zanesljivo analizo', priority: 'MEDIUM', timing: 'V naslednjih 30 dni' },
          ],
          postTransitionStrategy: 'Premalo podatkov za post-transition strategijo.',
          phaseStrategy: 'Premalo podatkov za phase strategijo.',
        },
        summary:
          sortedWeekKeys.length === 0
            ? 'Ni listing-ov v zadnjih 365 dneh — Market Cycle Phase Predictor ni mogoč.'
            : `Premalo tedenskih podatkov (${sortedWeekKeys.length} tednov) — zberi vsaj 4 tedne za zanesljivo analizo.`,
        aiUsed: false,
        message:
          sortedWeekKeys.length === 0
            ? 'Ni listing-ov v zadnjih 365 dneh — Market Cycle Phase Predictor ni mogoč.'
            : `Premalo tedenskih podatkov (${sortedWeekKeys.length} tednov) — zberi vsaj 4 tedne za zanesljivo analizo.`,
      });
    }

    // 3) Compute indicators
    // 13 weeks for 90d trend, 4 weeks for 30d trend
    const last13Weeks = sortedWeekKeys.slice(-13);
    const last4Weeks = sortedWeekKeys.slice(-4);

    // Weekly avg price series
    const weeklyAvgPrice13 = last13Weeks.map((wk) => {
      const a = overallByWeek.get(wk)!;
      return a.pricedListings > 0 ? a.sumPrice / a.pricedListings : 0;
    });
    const weeklyVolume13 = last13Weeks.map((wk) => overallByWeek.get(wk)!.totalListings);
    const weeklyDealScore13 = last13Weeks.map((wk) => {
      const a = overallByWeek.get(wk)!;
      return a.dealScoreCount > 0 ? a.sumDealScore / a.dealScoreCount : 0;
    });
    // Sentiment proxy: ratio of priced listings to total (higher = better sentiment —
    // sellers feel confident about pricing when market is healthy)
    const weeklySentiment13 = last13Weeks.map((wk) => {
      const a = overallByWeek.get(wk)!;
      return a.totalListings > 0 ? a.pricedListings / a.totalListings : 0;
    });

    // Linear regressions
    const priceReg90d = trendSlope(weeklyAvgPrice13);
    const volumeReg90d = trendSlope(weeklyVolume13);
    const dealScoreReg90d = trendSlope(weeklyDealScore13);
    const sentimentReg90d = trendSlope(weeklySentiment13);

    // Accelerations
    const priceAcceleration = computeAcceleration(weeklyAvgPrice13);
    const volumeAcceleration = computeAcceleration(weeklyVolume13);

    const meanPrice90 = avg(weeklyAvgPrice13.filter((v) => v > 0));
    const meanVolume90 = avg(weeklyVolume13);

    // Phase classification (deterministic)
    const priceTrend90Direction = directionFromSlope(priceReg90d, 1.5, meanPrice90);
    const priceTrend30Direction = directionFromSlope(
      trendSlope(last4Weeks.map((wk) => {
        const a = overallByWeek.get(wk)!;
        return a.pricedListings > 0 ? a.sumPrice / a.pricedListings : 0;
      })),
      2.5,
      avg(last4Weeks.map((wk) => {
        const a = overallByWeek.get(wk)!;
        return a.pricedListings > 0 ? a.sumPrice / a.pricedListings : 0;
      }).filter((v) => v > 0)),
    );
    const volumeTrend90Direction = directionFromSlope(volumeReg90d, 5, meanVolume90);
    const volumeTrend30Direction = directionFromSlope(
      trendSlope(last4Weeks.map((wk) => overallByWeek.get(wk)!.totalListings)),
      8,
      avg(last4Weeks.map((wk) => overallByWeek.get(wk)!.totalListings)),
    );

    // Volatility index (stddev of weekly avg prices / mean × 100)
    const priced13 = weeklyAvgPrice13.filter((v) => v > 0);
    const volatilityIndex =
      priced13.length > 1 && meanPrice90 > 0
        ? round1((stddev(priced13) / meanPrice90) * 100)
        : 0;

    const { phase, confidence: phaseConfidence } = classifyPhase(
      priceTrend90Direction,
      priceTrend30Direction,
      volumeTrend90Direction,
      volumeTrend30Direction,
      volatilityIndex,
    );

    // Compute cycle progress (0-100)
    const cycleProgress = computeCycleProgress(phase, priceTrend30Direction, volumeTrend30Direction);

    // Phase maturity
    const phaseMaturity = classifyPhaseMaturity(phase, cycleProgress, priceTrend30Direction);

    // Weeks in phase: estimate from data
    // (we don't track actual phase history in this endpoint — we estimate
    // from weeks where data is consistent with current phase)
    // Use weeksInPhase = max(1, min(sortedWeekKeys.length, estimated))
    // For a quick proxy: LATE = ~10+ weeks, MID = ~5-9 weeks, EARLY = ~1-4 weeks
    let weeksInPhase: number;
    switch (phaseMaturity) {
      case 'EARLY': weeksInPhase = Math.max(1, Math.min(4, Math.floor(sortedWeekKeys.length / 3))); break;
      case 'MID': weeksInPhase = Math.max(5, Math.min(9, Math.floor(sortedWeekKeys.length / 2))); break;
      case 'LATE': weeksInPhase = Math.max(10, Math.min(sortedWeekKeys.length, 12)); break;
      default: weeksInPhase = Math.min(8, sortedWeekKeys.length);
    }

    // Phase intensity
    const phaseIntensityScore = computePhaseIntensity(
      phase,
      phaseConfidence,
      Math.abs(priceReg90d),
      Math.abs(volumeReg90d),
      meanPrice90,
      meanVolume90,
    );

    const currentPhase: CurrentPhaseInfo = {
      phase,
      phaseIntensityScore,
      phaseMaturity,
      weeksInPhase,
    };

    // Indicators
    const indicators: Indicators = {
      priceMomentum: {
        slope: round2(priceReg90d),
        acceleration: round2(priceAcceleration),
        signal: momentumSignalFromSlope(priceReg90d, meanPrice90, priceAcceleration),
      },
      volumeMomentum: {
        slope: round2(volumeReg90d),
        acceleration: round2(volumeAcceleration),
        signal: momentumSignalFromSlope(volumeReg90d, meanVolume90, volumeAcceleration),
      },
      dealQualityMomentum: {
        slope: round2(dealScoreReg90d),
        signal: simpleMomentumSignalFromSlope(dealScoreReg90d, 'dealScore'),
      },
      sentimentMomentum: {
        slope: round2(sentimentReg90d),
        signal: simpleMomentumSignalFromSlope(sentimentReg90d, 'sentiment'),
      },
    };

    // 4) Deterministic prediction (fallback)
    const detPrediction = buildDeterministicPrediction(
      phase,
      phaseMaturity,
      phaseIntensityScore,
      weeksInPhase,
      priceAcceleration,
      volumeAcceleration,
      now,
    );
    let prediction = detPrediction;

    const detStrategy = buildDeterministicStrategy(phase, phaseMaturity, detPrediction);
    let strategy = detStrategy;

    let finalSummary = buildDeterministicSummary(currentPhase, detPrediction);

    // 5) AI cache check (6h TTL) — key by current week
    const currentWeekMs = isoWeekStart(now);
    const cacheKey = `market-cycle-phase-predictor:${currentWeekMs}`;
    const cached = getCachedAI<{
      prediction: PhaseTransitionPrediction;
      strategy: Strategy;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        currentPhase,
        indicators,
        prediction: cached.prediction,
        strategy: cached.strategy,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 6) AI prompt with grounding
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
      currentPhase,
      indicators,
      deterministicPrediction: detPrediction,
      deterministicStrategy: detStrategy,
      weeklyData: {
        last13Weeks: last13Weeks.map((wk, i) => ({
          weekStart: isoDate(wk),
          avgPrice: round1(weeklyAvgPrice13[i]),
          volume: weeklyVolume13[i],
          avgDealScore: round1(weeklyDealScore13[i]!),
          sentimentRatio: round2(weeklySentiment13[i]!),
        })),
        volatilityIndex,
        totalWeeks: sortedWeekKeys.length,
      },
    };

    const prompt = `Si AI "Market Cycle Phase Predictor" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Napoveš EXACT TIMING market cycle phase transitions — kdaj se bo trenutna faza končala in katera bo naslednja. Uporabljaš Wyckoff-inspired 4-fazni cikel: ACCUMULATION → MARKUP → DISTRIBUTION → DECLINE → ACCUMULATION.

DETERMINISTIČNI PODATKI (izračunano iz DB):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. prediction: {
   - nextPhase: ACCUMULATION|MARKUP|DISTRIBUTION|DECLINE (logični naslednik trenutne faze — validiraj z Wyckoff cycle)
   - predictedTransitionDate: ISO date (YYYY-MM-DD), ±7 dni od deterministične (${detPrediction.predictedTransitionDate})
   - daysUntilTransition: 0-180, ±14 dni od deterministične (${detPrediction.daysUntilTransition})
   - transitionConfidence: 0-100, ±15 od deterministične (${detPrediction.transitionConfidence})
   - transitionSignals: 2-5 signalov (max 200 chars vsak) — kateri indikatorji nakazujejo transition (npr. "priceMomentum decelerating", "volume acceleration negative", "phase maturity LATE", "dealQuality declining")
}
2. strategy: {
   - preTransitionActions: 2-4 akcije z { action (max 200, slovensko), priority: HIGH|MEDIUM|LOW, timing (max 80, slovensko — npr. "V naslednjih 7 dneh") }
     * Akcije ki jih mora trader narediti ZDAJ da se pripravi na transition.
     * MARKUP→DISTRIBUTION: začni prodajo inventarja.
     * DISTRIBUTION→DECLINE: zaključi selling, zadrži kapital.
     * DECLINE→ACCUMULATION: postavi buy alerts za bottom.
     * ACCUMULATION→MARKUP: povečaj buying volume.
   - postTransitionStrategy: slovenski opis (max 400 znakov) — kaj narediti PO prehodu v naslednjo fazo.
   - phaseStrategy: slovenski opis (max 400 znakov) — kaj narediti v trenutni fazi (dodatno k preTransitionActions).
}
3. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi zgornje deterministične.

VRNI LE JSON:
{
  "prediction": {
    "nextPhase": "DISTRIBUTION",
    "predictedTransitionDate": "2026-09-15",
    "daysUntilTransition": 18,
    "transitionConfidence": 72,
    "transitionSignals": [
      "MARKUP faza v LATE maturity (10 tednov) — trend se izrablja.",
      "priceMomentum decelerating (acceleration -0.4) — signal transition.",
      "Phase intensity 85/100 — močan signal v smeri MARKUP, vendar bo prešel v DISTRIBUTION."
    ]
  },
  "strategy": {
    "preTransitionActions": [
      { "action": "Začni postopno prodajo inventarja (50% v naslednjih 7-14 dneh)", "priority": "HIGH", "timing": "V naslednjih 7 dneh" },
      { "action": "Ustavi nove nakupe (razen exception deal-ov >70% margin)", "priority": "HIGH", "timing": "Takoj" }
    ],
    "postTransitionStrategy": "Po prehodu v DISTRIBUTION: prodaj inventar, cene so na vrhu. Fokus na selling + cash collection.",
    "phaseStrategy": "Trenutno MARKUP (LATE) — bull faza, vendar se bliža DISTRIBUTION. Nadaljuj nakupe manj agresivno in pripravi selling strategijo."
  },
  "summary": "Current: MARKUP (LATE, 85% intensity, 10w). Next: DISTRIBUTION v ~18d (2026-09-15). Confidence 72%. Action: start selling NOW."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiPhaseResponse | null;

      if (parsed && typeof parsed === 'object') {
        // 1) prediction override (with anti-hallucination)
        if (parsed.prediction && typeof parsed.prediction === 'object') {
          const p = parsed.prediction as Record<string, unknown>;

          // nextPhase: validate against Wyckoff cycle
          const aiNext = clampEnum(p.nextPhase, VALID_PHASE, detPrediction.nextPhase);
          prediction.nextPhase = aiNext === NEXT_PHASE_MAP[phase]
            ? aiNext
            : detPrediction.nextPhase;

          // predictedTransitionDate: ±7 days from deterministic
          if (typeof p.predictedTransitionDate === 'string') {
            const parsedDate = Date.parse(p.predictedTransitionDate);
            if (Number.isFinite(parsedDate)) {
              const detDate = Date.parse(detPrediction.predictedTransitionDate);
              const offset = parsedDate - detDate;
              const clampedOffset = Math.max(-7 * DAY_MS, Math.min(7 * DAY_MS, offset));
              prediction.predictedTransitionDate = isoDate(detDate + clampedOffset);
            }
          }

          // daysUntilTransition: ±14 from deterministic, clamped [0, 180]
          if (p.daysUntilTransition != null) {
            const det = detPrediction.daysUntilTransition;
            const adj = clampNumber(p.daysUntilTransition, DAYS_UNTIL_MIN, DAYS_UNTIL_MAX, det);
            prediction.daysUntilTransition = round0(
              Math.max(
                DAYS_UNTIL_MIN,
                Math.min(
                  DAYS_UNTIL_MAX,
                  det + Math.max(-14, Math.min(14, adj - det)),
                ),
              ),
            );
          }

          // transitionConfidence: ±15 from deterministic, clamped [0, 100]
          if (p.transitionConfidence != null) {
            const det = detPrediction.transitionConfidence;
            const adj = clampNumber(p.transitionConfidence, CONFIDENCE_MIN, CONFIDENCE_MAX, det);
            prediction.transitionConfidence = round0(
              Math.max(
                CONFIDENCE_MIN,
                Math.min(
                  CONFIDENCE_MAX,
                  det + Math.max(-15, Math.min(15, adj - det)),
                ),
              ),
            );
          }

          // transitionSignals
          if (Array.isArray(p.transitionSignals)) {
            const signals = (p.transitionSignals as unknown[])
              .map((s: unknown) => clampString(s, 200, ''))
              .filter((s) => s.length > 0)
              .slice(0, 5);
            if (signals.length > 0) prediction.transitionSignals = signals;
          }
        }

        // 2) strategy override
        if (parsed.strategy && typeof parsed.strategy === 'object') {
          const s = parsed.strategy as Record<string, unknown>;

          if (Array.isArray(s.preTransitionActions)) {
            const aiActions = (s.preTransitionActions as unknown[])
              .map((ac: unknown) => {
                const a2 = ac as Record<string, unknown>;
                if (!a2 || typeof a2 !== 'object') return null;
                const action = clampString(a2.action, 200, '');
                if (!action) return null;
                const priority = clampEnum(a2.priority, VALID_PRIORITY, 'MEDIUM');
                const timing = clampString(a2.timing, 80, '');
                if (!timing) return null;
                return { action, priority, timing };
              })
              .filter((ac): ac is StrategyAction => ac !== null)
              .slice(0, 4);
            if (aiActions.length > 0) strategy.preTransitionActions = aiActions;
          }

          if (typeof s.postTransitionStrategy === 'string' && s.postTransitionStrategy.trim()) {
            strategy.postTransitionStrategy = clampString(
              s.postTransitionStrategy,
              400,
              detStrategy.postTransitionStrategy,
            );
          }
          if (typeof s.phaseStrategy === 'string' && s.phaseStrategy.trim()) {
            strategy.phaseStrategy = clampString(
              s.phaseStrategy,
              400,
              detStrategy.phaseStrategy,
            );
          }
        }

        // 3) summary
        if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
          finalSummary = clampString(parsed.summary, 400, buildDeterministicSummary(currentPhase, prediction));
        }

        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/market-cycle-phase-predictor',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        prediction,
        strategy,
        summary: finalSummary,
      });
    }

    return NextResponse.json({
      ok: true,
      currentPhase,
      indicators,
      prediction,
      strategy,
      summary: finalSummary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error(
      '/api/ai/market-cycle-phase-predictor',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

// Generate signal description from slope + acceleration
function momentumSignalFromSlope(
  slope: number,
  meanValue: number,
  acceleration: number,
): string {
  if (meanValue <= 0) return 'Ni dovolj cenovnih podatkov za signal.';
  const relSlope = (slope / meanValue) * 100;
  let direction: string;
  if (relSlope > 1.5) direction = 'močno naraščajoč';
  else if (relSlope > 0.3) direction = 'naraščajoč';
  else if (relSlope < -1.5) direction = 'močno padajoč';
  else if (relSlope < -0.3) direction = 'padajoč';
  else direction = 'stabilen';

  let accelDesc: string;
  if (acceleration > 0.3) accelDesc = 'in še pospešuje';
  else if (acceleration < -0.3) accelDesc = 'vendar izgublja momentum';
  else accelDesc = 'z stabilnim momentumom';

  return `Trend je ${direction} (${round2(relSlope)}%/teden) ${accelDesc} (acceleration ${round2(acceleration)}).`.slice(0, 200);
}

function simpleMomentumSignalFromSlope(slope: number, kind: string): string {
  let direction: string;
  if (slope > 0.5) direction = 'IMPROVING';
  else if (slope < -0.5) direction = 'DECLINING';
  else direction = 'STABLE';
  return `${kind} trend: ${direction} (slope ${round2(slope)}/teden).`.slice(0, 200);
}
