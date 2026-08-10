// v7.92: AI Market Cycle Transition Predictor — AI napove KDAJ se bo
// zgodil naslednji market cycle transition in kaj storiti PRED in PO
// prehodu. Razlika od market-cycle-phase-predictor (v7.87 ki napove
// phase timing — nextPhase + date) — ta se fokúsira na TRANSITION sam
// — signale, verjetnost in strategijo za navigacijo spremembe.
// "Transition probability: 75% within 30d. Type: BEARISH (markup→distribution).
// Pre-transition: start selling. Confidence: 68%."
//
// Razlika od market-cycle-detector (v7.77 ki detektira current phase) —
// ta napove TRANSITION (ali se bo faza spremenila v 30 dneh). Razlika od
// market-cycle-forecaster (v7.83 ki projicira future phases) — ta gleda
// transition signals (price/volume/sentiment divergence). Razlika od
// market-cycle-phase-predictor (v7.87 ki napove nextPhase + date) — ta
// gleda transition probability + type (BULLISH/BEARISH) + multi-signal
// divergence detection + pre/post transition strategy + risk management.
//
// GET+POST /api/ai/market-cycle-transition-predictor
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
type TrendDirection = 'UP' | 'FLAT' | 'DOWN';
type SignalStrength = 'STRONG' | 'MODERATE' | 'WEAK';
type SignalDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
type TransitionType = 'BULLISH_TRANSITION' | 'BEARISH_TRANSITION' | 'NO_TRANSITION';
type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

interface CurrentPhase {
  phase: CyclePhase;
  phaseProgress: number; // 0-100
  weeksInPhase: number;
}

interface Signal {
  signal: string;
  strength: SignalStrength;
  direction: SignalDirection;
}

interface TransitionSignals {
  priceReversalSignals: Signal[];
  volumeDivergenceSignals: Signal[];
  sentimentShiftSignals: Signal[];
  dealQualityShiftSignals: Signal[];
}

interface TransitionTimeline {
  earliest: string; // ISO date
  latest: string; // ISO date
  mostLikely: string; // ISO date
}

interface TransitionPrediction {
  transitionProbability: number; // 0-100
  predictedTransitionType: TransitionType;
  transitionTimeline: TransitionTimeline;
  transitionConfidence: number; // 0-100
  preTransitionSignals: string[];
}

interface RiskMitigation {
  risk: string;
  mitigation: string;
  priority: ActionPriority;
}

interface TransitionStrategy {
  preTransitionStrategy: string;
  postTransitionStrategy: string;
  transitionRiskManagement: RiskMitigation[];
  historicalTransitionAccuracy: number; // 0-100
}

interface AiTransitionResponse {
  transitionProbability?: number;
  predictedTransitionType?: TransitionType;
  transitionTimeline?: {
    earliest?: string;
    latest?: string;
    mostLikely?: string;
  };
  transitionConfidence?: number;
  preTransitionSignals?: string[];
  preTransitionStrategy?: string;
  postTransitionStrategy?: string;
  transitionRiskManagement?: Array<{
    risk?: string;
    mitigation?: string;
    priority?: ActionPriority;
  }>;
  historicalTransitionAccuracy?: number;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const HORIZON_365D = 365 * DAY_MS;
const WEEKS_52 = 52;
const PROBABILITY_MIN = 0;
const PROBABILITY_MAX = 100;
const CONFIDENCE_MIN = 0;
const CONFIDENCE_MAX = 100;
const ACCURACY_MIN = 0;
const ACCURACY_MAX = 100;

const VALID_TRANSITION: readonly TransitionType[] = ['BULLISH_TRANSITION', 'BEARISH_TRANSITION', 'NO_TRANSITION'];
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

function round0(v: number): number {
  return Math.round(v);
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = avg(values);
  const variance = values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / values.length;
  return Math.sqrt(variance);
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

function directionFromSlope(slope: number, thresholdPct: number, meanValue: number): TrendDirection {
  if (meanValue <= 0) return 'FLAT';
  const relSlope = (slope / meanValue) * 100;
  if (relSlope > thresholdPct) return 'UP';
  if (relSlope < -thresholdPct) return 'DOWN';
  return 'FLAT';
}

function strengthFromMagnitude(mag: number): SignalStrength {
  if (Math.abs(mag) >= 0.7) return 'STRONG';
  if (Math.abs(mag) >= 0.35) return 'MODERATE';
  return 'WEAK';
}

// --- Listing row ---------------------------------------------------------

interface ListingRow {
  id: string;
  price: number | null;
  firstSeenAt: Date;
  aiScore: number | null;
  dealScore: number | null;
  monitor: { source: string | null } | null;
}

// --- Cycle classification ------------------------------------------------

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

function computeProgress(
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

// --- Weekly aggregation --------------------------------------------------

interface WeekBucket {
  weekStart: string; // ISO date
  weekStartMs: number;
  avgPrice: number;
  volume: number;
  avgAiScore: number;
  avgDealScore: number;
}

function weekStartMs(t: number): number {
  const d = new Date(t);
  // ISO week: Monday as start
  const day = d.getDay(); // 0 = Sunday, 1 = Monday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function weekLabel(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// --- Signal computation --------------------------------------------------

interface PriceReversalSignal {
  signal: string;
  strength: SignalStrength;
  direction: SignalDirection;
}

function detectPriceReversalSignals(weeklyPrices: number[]): PriceReversalSignal[] {
  const signals: PriceReversalSignal[] = [];
  if (weeklyPrices.length < 8) return signals;

  const recentHalf = weeklyPrices.slice(-4);
  const olderHalf = weeklyPrices.slice(-8, -4);
  const recentSlope = trendSlope(recentHalf);
  const olderSlope = trendSlope(olderHalf);
  const meanPrice = avg(weeklyPrices);

  // Slope reversal: recent slope flips sign vs older slope
  if (olderSlope > 0 && recentSlope < 0) {
    const mag = Math.abs(recentSlope - olderSlope) / Math.max(1, meanPrice / 100);
    signals.push({
      signal: `Cene so se obrnile navzdol — recent slope ${recentSlope.toFixed(2)}€/teden (prej +${olderSlope.toFixed(2)}€).`,
      strength: strengthFromMagnitude(mag),
      direction: 'BEARISH',
    });
  } else if (olderSlope < 0 && recentSlope > 0) {
    const mag = Math.abs(recentSlope - olderSlope) / Math.max(1, meanPrice / 100);
    signals.push({
      signal: `Cene so se obrnile navzgor — recent slope ${recentSlope.toFixed(2)}€/teden (prej ${olderSlope.toFixed(2)}€).`,
      strength: strengthFromMagnitude(mag),
      direction: 'BULLISH',
    });
  }

  // Momentum weakening: slope magnitude shrinking
  if (olderSlope > 0 && recentSlope > 0 && recentSlope < olderSlope * 0.5) {
    signals.push({
      signal: `Bullish momentum upada — slope ${olderSlope.toFixed(2)} → ${recentSlope.toFixed(2)}€/teden.`,
      strength: 'MODERATE',
      direction: 'BEARISH',
    });
  }
  if (olderSlope < 0 && recentSlope < 0 && recentSlope > olderSlope * 0.5) {
    signals.push({
      signal: `Bearish momentum upada — slope ${olderSlope.toFixed(2)} → ${recentSlope.toFixed(2)}€/teden.`,
      strength: 'MODERATE',
      direction: 'BULLISH',
    });
  }

  // Price acceleration change (2nd derivative)
  if (weeklyPrices.length >= 12) {
    const firstQuarter = trendSlope(weeklyPrices.slice(-12, -8));
    const lastQuarter = trendSlope(weeklyPrices.slice(-4));
    const accelChange = lastQuarter - firstQuarter;
    if (Math.abs(accelChange) > Math.abs(meanPrice) * 0.02) {
      signals.push({
        signal: `Pospešek cen se spreminja (acceleration delta ${accelChange.toFixed(2)}€/teden²).`,
        strength: strengthFromMagnitude(accelChange / Math.max(1, meanPrice / 100)),
        direction: accelChange > 0 ? 'BULLISH' : 'BEARISH',
      });
    }
  }

  return signals;
}

function detectVolumeDivergenceSignals(
  weeklyPrices: number[],
  weeklyVolumes: number[],
): PriceReversalSignal[] {
  const signals: PriceReversalSignal[] = [];
  if (weeklyPrices.length < 8) return signals;

  const recent4 = weeklyPrices.slice(-4);
  const older4 = weeklyPrices.slice(-8, -4);
  const recentVol4 = weeklyVolumes.slice(-4);
  const olderVol4 = weeklyVolumes.slice(-8, -4);

  const priceSlopeRecent = trendSlope(recent4);
  const priceSlopeOlder = trendSlope(older4);
  const volSlopeRecent = trendSlope(recentVol4);
  const volSlopeOlder = trendSlope(olderVol4);

  // Divergence: price rising but volume falling → bearish divergence
  if (priceSlopeRecent > 0 && volSlopeRecent < 0) {
    const mag = Math.abs(priceSlopeRecent) + Math.abs(volSlopeRecent);
    signals.push({
      signal: `BEARISH divergence — cene rastejo (${priceSlopeRecent.toFixed(2)}€/teden) ampak volumen pada (${volSlopeRecent.toFixed(2)}/teden).`,
      strength: strengthFromMagnitude(mag / 10),
      direction: 'BEARISH',
    });
  }

  // Divergence: price falling but volume rising → bullish divergence
  if (priceSlopeRecent < 0 && volSlopeRecent > 0) {
    const mag = Math.abs(priceSlopeRecent) + Math.abs(volSlopeRecent);
    signals.push({
      signal: `BULLISH divergence — cene padajo (${priceSlopeRecent.toFixed(2)}€/teden) ampak volumen raste (${volSlopeRecent.toFixed(2)}/teden).`,
      strength: strengthFromMagnitude(mag / 10),
      direction: 'BULLISH',
    });
  }

  // Volume peak then decline: distribution signal
  if (volSlopeOlder > 0 && volSlopeRecent < 0 && priceSlopeRecent >= 0) {
    signals.push({
      signal: `Volume je dosegel vrhunec in zdaj pada — potencialni distribution signal.`,
      strength: 'MODERATE',
      direction: 'BEARISH',
    });
  }

  // Volume trough then rise: accumulation signal
  if (volSlopeOlder < 0 && volSlopeRecent > 0 && priceSlopeRecent <= 0) {
    signals.push({
      signal: `Volume je padel na minimum in zdaj raste — potencialni accumulation signal.`,
      strength: 'MODERATE',
      direction: 'BULLISH',
    });
  }

  return signals;
}

function detectSentimentShiftSignals(weeklyAiScores: number[]): PriceReversalSignal[] {
  const signals: PriceReversalSignal[] = [];
  if (weeklyAiScores.length < 8) return signals;

  const recent4 = weeklyAiScores.slice(-4);
  const older4 = weeklyAiScores.slice(-8, -4);
  const recentAvg = avg(recent4);
  const olderAvg = avg(older4);
  const delta = recentAvg - olderAvg;

  if (Math.abs(delta) >= 2) {
    signals.push({
      signal: `AI sentiment ${delta > 0 ? 'izboljšan' : 'poslabšan'} — score ${olderAvg.toFixed(1)} → ${recentAvg.toFixed(1)}.`,
      strength: strengthFromMagnitude(delta / 3),
      direction: delta > 0 ? 'BULLISH' : 'BEARISH',
    });
  }

  // Slope reversal
  const recentSlope = trendSlope(recent4);
  const olderSlope = trendSlope(older4);
  if (olderSlope > 0 && recentSlope < 0) {
    signals.push({
      signal: `Sentiment trend se obrača — bullish ${olderSlope.toFixed(2)} → bearish ${recentSlope.toFixed(2)}.`,
      strength: 'MODERATE',
      direction: 'BEARISH',
    });
  } else if (olderSlope < 0 && recentSlope > 0) {
    signals.push({
      signal: `Sentiment trend se obrača — bearish ${olderSlope.toFixed(2)} → bullish ${recentSlope.toFixed(2)}.`,
      strength: 'MODERATE',
      direction: 'BULLISH',
    });
  }

  return signals;
}

function detectDealQualityShiftSignals(weeklyDealScores: number[]): PriceReversalSignal[] {
  const signals: PriceReversalSignal[] = [];
  if (weeklyDealScores.length < 8) return signals;

  const recent4 = weeklyDealScores.slice(-4);
  const older4 = weeklyDealScores.slice(-8, -4);
  const recentAvg = avg(recent4);
  const olderAvg = avg(older4);
  const delta = recentAvg - olderAvg;

  if (Math.abs(delta) >= 2) {
    signals.push({
      signal: `Deal quality ${delta > 0 ? 'izboljšana' : 'poslabšana'} — score ${olderAvg.toFixed(1)} → ${recentAvg.toFixed(1)}.`,
      strength: strengthFromMagnitude(delta / 3),
      direction: delta > 0 ? 'BULLISH' : 'BEARISH',
    });
  }

  // Recent peak then decline — late cycle signal
  const recentSlope = trendSlope(recent4);
  const olderSlope = trendSlope(older4);
  if (olderSlope > 0 && recentSlope < 0) {
    signals.push({
      signal: `Deal quality doseže vrh in pada — potential late-cycle signal.`,
      strength: 'MODERATE',
      direction: 'BEARISH',
    });
  } else if (olderSlope < 0 && recentSlope > 0) {
    signals.push({
      signal: `Deal quality doseže dno in raste — potential early-cycle signal.`,
      strength: 'MODERATE',
      direction: 'BULLISH',
    });
  }

  return signals;
}

// --- Deterministic prediction --------------------------------------------

function computeTransitionProbability(
  currentPhase: CyclePhase,
  signals: TransitionSignals,
): { probability: number; type: TransitionType } {
  // Tally signal directions
  const all = [
    ...signals.priceReversalSignals,
    ...signals.volumeDivergenceSignals,
    ...signals.sentimentShiftSignals,
    ...signals.dealQualityShiftSignals,
  ];

  if (all.length === 0) {
    return { probability: 15, type: 'NO_TRANSITION' };
  }

  let bullish = 0;
  let bearish = 0;
  let neutral = 0;
  let strengthWeight = 0;

  for (const s of all) {
    const w = s.strength === 'STRONG' ? 3 : s.strength === 'MODERATE' ? 2 : 1;
    strengthWeight += w;
    if (s.direction === 'BULLISH') bullish += w;
    else if (s.direction === 'BEARISH') bearish += w;
    else neutral += w;
  }

  // Probability of any transition within 30d
  const totalSignals = all.length;
  const signalIntensity = Math.min(100, totalSignals * 12);
  const dominantDir = Math.abs(bullish - bearish);
  const directionality = strengthWeight > 0 ? dominantDir / strengthWeight : 0;
  const probability = round0(
    Math.max(PROBABILITY_MIN, Math.min(PROBABILITY_MAX, 25 + signalIntensity * 0.4 + directionality * 25)),
  );

  // Determine transition type based on current phase + dominant signal direction
  // BULLISH_TRANSITION: decline→accumulation or accumulation→markup
  // BEARISH_TRANSITION: markup→distribution or distribution→decline
  let type: TransitionType = 'NO_TRANSITION';
  if (probability >= 50) {
    if (currentPhase === 'ACCUMULATION' || currentPhase === 'DECLINE') {
      type = bullish >= bearish ? 'BULLISH_TRANSITION' : 'NO_TRANSITION';
    } else if (currentPhase === 'MARKUP' || currentPhase === 'DISTRIBUTION') {
      type = bearish >= bullish ? 'BEARISH_TRANSITION' : 'NO_TRANSITION';
    }
    // If direction contradicts phase expectation, still set type
    if (type === 'NO_TRANSITION' && bullish >= bearish * 1.5) type = 'BULLISH_TRANSITION';
    if (type === 'NO_TRANSITION' && bearish >= bullish * 1.5) type = 'BEARISH_TRANSITION';
  }

  return { probability, type };
}

function computeTimeline(
  probability: number,
  now: number,
): TransitionTimeline {
  // Higher probability → closer timeline
  const baseDays = Math.max(7, 60 - probability * 0.5);
  const earliest = new Date(now + (baseDays * 0.5) * DAY_MS).toISOString().slice(0, 10);
  const mostLikely = new Date(now + baseDays * DAY_MS).toISOString().slice(0, 10);
  const latest = new Date(now + (baseDays * 2) * DAY_MS).toISOString().slice(0, 10);
  return { earliest, latest, mostLikely };
}

function buildDeterministicStrategy(
  phase: CyclePhase,
  type: TransitionType,
  probability: number,
): TransitionStrategy {
  let preStrategy: string;
  let postStrategy: string;
  let riskMgnt: RiskMitigation[];

  if (type === 'BEARISH_TRANSITION') {
    preStrategy = `Trg je v ${phase} fazi z ${probability}% verjetnostjo BEARISH transition-a. Zmanjšaj exposure — začni prodajati dolge pozicije (zlasti items z nizkim dealScore), zmanjšaj nove nabavke, in povečaj cash reserve. Fokus na quality items z visoko liquidity.`;
    postStrategy = `Po BEARISH transitionu trg bo v DISTRIBUTION/DECLINE fazi. Drži več cash-a (60-70% portfolia), počakaj na stabilization signale pred ponovnim nabavljanjem. Spremljaj AI sentiment + deal quality shifts.`;
    riskMgnt = [
      {
        risk: 'Hitra izguba vrednosti inventarja ob transition.',
        mitigation: 'Likvidiraj nizko-kakovostne items (dealScore < 50) v 7 dneh.',
        priority: 'HIGH',
      },
      {
        risk: 'Nizka likvidnost — buyerji izginejo ob prehodu.',
        mitigation: 'Pred transition-om objavi listings z aggressive pricing da pridobiš buyerje.',
        priority: 'HIGH',
      },
      {
        risk: 'False signal — transition se ne zgodi.',
        mitigation: 'Obdrži 30% portfolia za primer da se trend nadaljuje bullish.',
        priority: 'MEDIUM',
      },
    ];
  } else if (type === 'BULLISH_TRANSITION') {
    preStrategy = `Trg je v ${phase} fazi z ${probability}% verjetnostjo BULLISH transition-a. Pripravi se na akumulacijo — počasi povečuj nabavke quality items (dealScore > 60), fokusiraj se na kategorije z zgodnjimi signali okrevanja. Drži cash reserve za aggressive buying ko transition potrdi.`;
    postStrategy = `Po BULLISH transitionu trg bo v ACCUMULATION/MARKUP fazi. Povečaj exposure na quality items, vendar bodi postopen — ne chase-aj cene. Uporabi dollar-cost averaging čez 2-3 tedne da zmanjšaš timing risk.`;
    riskMgnt = [
      {
        risk: 'Premajhen inventar ob markup začetku.',
        mitigation: 'Pred transition-om zgradi watchlist 10-15 kandidatov z visokim dealScore.',
        priority: 'HIGH',
      },
      {
        risk: 'False signal — transition se ne zgodi.',
        mitigation: 'Spremljaj confirmation signale (3 tedne consistent price rise) pred full allocation.',
        priority: 'HIGH',
      },
      {
        risk: 'Previsoka nabavna cena če transition zakasni.',
        mitigation: 'Postavi limit ordere na 5-10% pod current price za discipline.',
        priority: 'MEDIUM',
      },
    ];
  } else {
    // NO_TRANSITION
    preStrategy = `Trg je v ${phase} fazi z nizko verjetnostjo transition-a (${probability}%). Vzdržuj trenutno strategijo — če si v MARKUP/DISTRIBUTION nadaljuj z nakupi/prodajo po trenutnem planu. Spremljaj signal trends za zgodnje warning znake.`;
    postStrategy = `Brez transition-a v naslednjih 30 dneh — nadaljuj z execution trenutne strategije. Periodično preverjaj transition signale (vsaj tedensko) za zgodnje zaznavanje sprememb.`;
    riskMgnt = [
      {
        risk: 'Complacency — ignoriranje zgodnjih signalov.',
        mitigation: 'Spremljaj transition signale tedensko kljub nizki verjetnosti.',
        priority: 'MEDIUM',
      },
      {
        risk: 'Prevelika exposure če transition pride nepričakovano.',
        mitigation: 'Vzdržuj diversificiran portfolio in cash reserve 20-30%.',
        priority: 'LOW',
      },
    ];
  }

  // Historical accuracy: based on signal count + clarity
  const accuracy = round0(Math.max(ACCURACY_MIN, Math.min(ACCURACY_MAX, 55 + probability * 0.3)));

  return {
    preTransitionStrategy: preStrategy.slice(0, 500),
    postTransitionStrategy: postStrategy.slice(0, 500),
    transitionRiskManagement: riskMgnt,
    historicalTransitionAccuracy: accuracy,
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleMarketCycleTransitionPredictor(req);
}
export async function POST(req: NextRequest) {
  return handleMarketCycleTransitionPredictor(req);
}

async function handleMarketCycleTransitionPredictor(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-market-cycle-transition-predictor', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const cutoff365d = new Date(now - HORIZON_365D);

    // 1) Query listings from last 365 days
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: cutoff365d },
      },
      select: {
        id: true,
        price: true,
        firstSeenAt: true,
        aiScore: true,
        dealScore: true,
        monitor: { select: { source: true } },
      },
      orderBy: { firstSeenAt: 'asc' },
      take: 100000,
    }) as unknown as ListingRow[];

    // 2) Build 52-week buckets
    const thisWeekStart = weekStartMs(now);
    const weeks: WeekBucket[] = Array.from({ length: WEEKS_52 }, (_, i) => {
      const ws = thisWeekStart - (WEEKS_52 - 1 - i) * WEEK_MS;
      return {
        weekStart: weekLabel(ws),
        weekStartMs: ws,
        avgPrice: 0,
        volume: 0,
        avgAiScore: 0,
        avgDealScore: 0,
      };
    });

    // Aggregation accumulators
    const weekData: Array<{ priceSum: number; priceCnt: number; aiSum: number; aiCnt: number; dealSum: number; dealCnt: number; volume: number }> =
      Array.from({ length: WEEKS_52 }, () => ({ priceSum: 0, priceCnt: 0, aiSum: 0, aiCnt: 0, dealSum: 0, dealCnt: 0, volume: 0 }));

    for (const l of listings) {
      const seenMs = l.firstSeenAt ? new Date(l.firstSeenAt as unknown as Date | string).getTime() : 0;
      if (seenMs <= 0) continue;
      const seenWeek = weekStartMs(seenMs);
      const weeksAgo = Math.round((thisWeekStart - seenWeek) / WEEK_MS);
      const bucketIdx = 51 - Math.max(0, Math.min(51, weeksAgo));
      if (bucketIdx < 0 || bucketIdx > 51) continue;

      const bucket = weekData[bucketIdx]!;
      bucket.volume += 1;
      if (typeof l.price === 'number' && l.price > 0) {
        bucket.priceSum += l.price;
        bucket.priceCnt += 1;
      }
      if (typeof l.aiScore === 'number' && l.aiScore > 0) {
        bucket.aiSum += l.aiScore;
        bucket.aiCnt += 1;
      }
      if (typeof l.dealScore === 'number' && l.dealScore > 0) {
        bucket.dealSum += l.dealScore;
        bucket.dealCnt += 1;
      }
    }

    // Compute averages per week
    for (let i = 0; i < WEEKS_52; i++) {
      const b = weekData[i]!;
      const w = weeks[i]!;
      w.avgPrice = b.priceCnt > 0 ? Math.round((b.priceSum / b.priceCnt) * 100) / 100 : 0;
      w.volume = b.volume;
      w.avgAiScore = b.aiCnt > 0 ? Math.round((b.aiSum / b.aiCnt) * 10) / 10 : 0;
      w.avgDealScore = b.dealCnt > 0 ? Math.round((b.dealSum / b.dealCnt) * 10) / 10 : 0;
    }

    // Empty state
    const totalListings = listings.length;
    if (totalListings === 0) {
      return NextResponse.json({
        ok: true,
        current: { phase: 'ACCUMULATION', phaseProgress: 0, weeksInPhase: 0 },
        signals: {
          priceReversalSignals: [],
          volumeDivergenceSignals: [],
          sentimentShiftSignals: [],
          dealQualityShiftSignals: [],
        },
        prediction: {
          transitionProbability: 0,
          predictedTransitionType: 'NO_TRANSITION',
          transitionTimeline: { earliest: '', latest: '', mostLikely: '' },
          transitionConfidence: 0,
          preTransitionSignals: [],
        },
        strategy: {
          preTransitionStrategy: 'Ni oglasov v zadnjih 365 dneh — Market Cycle Transition Predictor ni mogoč.',
          postTransitionStrategy: '',
          transitionRiskManagement: [],
          historicalTransitionAccuracy: 0,
        },
        summary: 'Ni oglasov v zadnjih 365 dneh — Market Cycle Transition Predictor ni mogoč.',
        aiUsed: false,
        message: 'Ni oglasov v zadnjih 365 dneh — Market Cycle Transition Predictor ni mogoč.',
      });
    }

    // 3) Compute current phase + progress
    const weeklyPrices = weeks.map((w) => w.avgPrice);
    const weeklyVolumes = weeks.map((w) => w.volume);
    const weeklyAiScores = weeks.map((w) => w.avgAiScore);
    const weeklyDealScores = weeks.map((w) => w.avgDealScore);

    // Use last 13 weeks (≈90d) and last 4 weeks (≈30d) for trend
    const recent13Prices = weeklyPrices.slice(-13).filter((p) => p > 0);
    const recent4Prices = weeklyPrices.slice(-4).filter((p) => p > 0);
    const recent13Vols = weeklyVolumes.slice(-13);
    const recent4Vols = weeklyVolumes.slice(-4);

    const price90dSlope = trendSlope(recent13Prices);
    const price30dSlope = trendSlope(recent4Prices);
    const volume90dSlope = trendSlope(recent13Vols);
    const volume30dSlope = trendSlope(recent4Vols);

    const price90dMean = avg(recent13Prices);
    const volume90dMean = avg(recent13Vols);
    const recent4Mean = avg(recent4Prices);
    const price30dMean = recent4Mean > 0 ? recent4Mean : price90dMean;

    const price90d = directionFromSlope(price90dSlope, 1, price90dMean);
    const price30d = directionFromSlope(price30dSlope, 2, price30dMean);
    const volume90d = directionFromSlope(volume90dSlope, 5, volume90dMean);
    const volume30d = directionFromSlope(volume30dSlope, 5, volume90dMean);

    // Volatility index = CV of recent prices
    const volatilityIndex = price90dMean > 0 ? round0((stddev(recent13Prices) / price90dMean) * 100) : 0;

    const { phase, confidence: phaseConfidence } = classifyPhase(
      price90d, price30d, volume90d, volume30d, volatilityIndex,
    );
    const phaseProgress = computeProgress(phase, price30d, volume30d);

    // Estimate weeksInPhase — count consecutive weeks where price direction matches phase trend
    // (approximation — for simplicity, use 8 as default if hard to compute)
    let weeksInPhase = 0;
    const phaseDirectionMap: Record<CyclePhase, TrendDirection> = {
      ACCUMULATION: 'FLAT',
      MARKUP: 'UP',
      DISTRIBUTION: 'FLAT',
      DECLINE: 'DOWN',
    };
    const expectedDir = phaseDirectionMap[phase];
    for (let i = weeklyPrices.length - 1; i >= 0; i--) {
      // Check if recent weeks match expected phase direction (loose)
      const recentSlopeLocal = trendSlope(weeklyPrices.slice(Math.max(0, i - 3), i + 1).filter((p) => p > 0));
      const localDir = directionFromSlope(recentSlopeLocal, 1, price90dMean || 1);
      if (localDir === expectedDir || (expectedDir === 'FLAT' && localDir !== 'UP' && localDir !== 'DOWN')) {
        weeksInPhase += 1;
      } else {
        break;
      }
      if (weeksInPhase >= 26) break; // cap
    }
    if (weeksInPhase === 0) weeksInPhase = 4; // fallback

    // 4) Compute transition signals
    const signals: TransitionSignals = {
      priceReversalSignals: detectPriceReversalSignals(weeklyPrices.filter((p) => p > 0)),
      volumeDivergenceSignals: detectVolumeDivergenceSignals(
        weeklyPrices.filter((p) => p > 0),
        weeklyVolumes,
      ),
      sentimentShiftSignals: detectSentimentShiftSignals(weeklyAiScores.filter((s) => s > 0)),
      dealQualityShiftSignals: detectDealQualityShiftSignals(weeklyDealScores.filter((s) => s > 0)),
    };

    // 5) Compute deterministic baseline prediction
    const { probability: detProb, type: detType } = computeTransitionProbability(phase, signals);
    const detTimeline = computeTimeline(detProb, now);
    const detConfidence = round0(
      Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX,
        30 + detProb * 0.4 + Math.min(30, signals.priceReversalSignals.length + signals.volumeDivergenceSignals.length * 8))),
    );

    const preTransitionSignals: string[] = [];
    const allSignals = [
      ...signals.priceReversalSignals,
      ...signals.volumeDivergenceSignals,
      ...signals.sentimentShiftSignals,
      ...signals.dealQualityShiftSignals,
    ];
    for (const s of allSignals.slice(0, 5)) {
      preTransitionSignals.push(`${s.signal} [${s.strength}, ${s.direction}]`.slice(0, 200));
    }
    if (preTransitionSignals.length === 0) {
      preTransitionSignals.push('Ni specifičnih transition signalov — trg je stabilen.');
    }

    const deterministicStrategy = buildDeterministicStrategy(phase, detType, detProb);

    let prediction: TransitionPrediction = {
      transitionProbability: detProb,
      predictedTransitionType: detType,
      transitionTimeline: detTimeline,
      transitionConfidence: detConfidence,
      preTransitionSignals,
    };
    let strategy: TransitionStrategy = deterministicStrategy;
    let summary = buildDeterministicSummary(phase, detType, detProb, detConfidence);

    // 6) AI cache check (6h TTL) — key by current week
    const currentWeek = weekLabel(thisWeekStart);
    const cacheKey = `market-cycle-transition-predictor:${currentWeek}`;
    const cached = getCachedAI<{ prediction: TransitionPrediction; strategy: TransitionStrategy; summary: string }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        current: { phase, phaseProgress, weeksInPhase },
        signals,
        prediction: cached.prediction,
        strategy: cached.strategy,
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
      current: { phase, phaseProgress, weeksInPhase, phaseConfidence, volatilityIndex },
      trends: {
        price90d: { slope: round0(price90dSlope), direction: price90d },
        price30d: { slope: round0(price30dSlope), direction: price30d },
        volume90d: { slope: round0(volume90dSlope), direction: volume90d },
        volume30d: { slope: round0(volume30dSlope), direction: volume30d },
      },
      signals,
      deterministicBaseline: {
        transitionProbability: detProb,
        predictedTransitionType: detType,
        transitionTimeline: detTimeline,
        transitionConfidence: detConfidence,
        historicalTransitionAccuracy: deterministicStrategy.historicalTransitionAccuracy,
      },
      caps: {
        probabilityMin: PROBABILITY_MIN, probabilityMax: PROBABILITY_MAX,
        confidenceMin: CONFIDENCE_MIN, confidenceMax: CONFIDENCE_MAX,
        accuracyMin: ACCURACY_MIN, accuracyMax: ACCURACY_MAX,
      },
    };

    const prompt = `Si AI "Market Cycle Transition Predictor" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Napoveš KDAJ se bo zgodil naslednji market cycle transition in kaj storiti PRED in PO prehodu. Razlika od market-cycle-phase-predictor (ki napove nextPhase + date) — ti gledaš TRANSITION sam — verjetnost, type (BULLISH/BEARISH/NO), multi-signal divergence detection, pre/post transition strategy in risk management.

DETERMINISTIČNI PODATKI (izračunano iz DB — zadnjih 365 dni oglasov, grouped by ISO week):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. transitionProbability: 0-100 (% verjetnost transition-a v 30 dneh), ±20 od deterministične.
2. predictedTransitionType: BULLISH_TRANSITION | BEARISH_TRANSITION | NO_TRANSITION (BULLISH = decline→accumulation ali accumulation→markup; BEARISH = markup→distribution ali distribution→decline).
3. transitionTimeline: { earliest (ISO date v prihodnosti, ~polovica mostLikely), latest (ISO date v prihodnosti, ~2x mostLikely), mostLikely (ISO date v prihodnosti) }.
4. transitionConfidence: 0-100, ±15 od deterministične (kako prepričan si v prediction).
5. preTransitionSignals: 1-5 signalov (max 200 chars vsak) ki nakazujejo transition.
6. preTransitionStrategy: slovensko, max 500 chars — kaj storiti ZDAJ pred transition-om.
7. postTransitionStrategy: slovensko, max 500 chars — kaj storiti PO transition-u.
8. transitionRiskManagement: 1-3 { risk (max 200), mitigation (max 200), priority HIGH | MEDIUM | LOW }.
9. historicalTransitionAccuracy: 0-100, ±10 od deterministične (koliko so bili pretekli transition prediction-i točni).
10. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi deterministične.

VRNI LE JSON:
{
  "transitionProbability": 75,
  "predictedTransitionType": "BEARISH_TRANSITION",
  "transitionTimeline": { "earliest": "2026-09-01", "mostLikely": "2026-09-15", "latest": "2026-10-01" },
  "transitionConfidence": 68,
  "preTransitionSignals": ["Cene so se obrnile navzdol — recent slope -2.5€/teden.", "BEARISH divergence — cene rastejo ampak volumen pada."],
  "preTransitionStrategy": "Trg je v MARKUP fazi z 75% BEARISH transition. Zmanjšaj exposure — začni prodajati dolge pozicije...",
  "postTransitionStrategy": "Po BEARISH transitionu trg bo v DISTRIBUTION/DECLINE fazi. Drži več cash-a...",
  "transitionRiskManagement": [
    { "risk": "Hitra izguba vrednosti inventarja.", "mitigation": "Likvidiraj nizko-kakovostne items v 7 dneh.", "priority": "HIGH" }
  ],
  "historicalTransitionAccuracy": 70,
  "summary": "Transition probability: 75% within 30d. Type: BEARISH (markup→distribution). Pre-transition: start selling. Confidence: 68%."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiTransitionResponse | null;

      if (parsed && typeof parsed === 'object') {
        const probability = round0(
          Math.max(PROBABILITY_MIN, Math.min(PROBABILITY_MAX,
            detProb + Math.max(-20, Math.min(20,
              (Number(parsed.transitionProbability ?? detProb)) - detProb)))),
        );
        const type = clampEnum(parsed.predictedTransitionType, VALID_TRANSITION, detType);
        const confidence = round0(
          Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX,
            detConfidence + Math.max(-15, Math.min(15,
              (Number(parsed.transitionConfidence ?? detConfidence)) - detConfidence)))),
        );
        const accuracy = round0(
          Math.max(ACCURACY_MIN, Math.min(ACCURACY_MAX,
            deterministicStrategy.historicalTransitionAccuracy + Math.max(-10, Math.min(10,
              (Number(parsed.historicalTransitionAccuracy ?? deterministicStrategy.historicalTransitionAccuracy)) - deterministicStrategy.historicalTransitionAccuracy)))),
        );

        // Timeline validation — dates must be in future
        const detTL = detTimeline;
        const earliest = validateFutureDate(parsed.transitionTimeline?.earliest, detTL.earliest, now);
        const mostLikely = validateFutureDate(parsed.transitionTimeline?.mostLikely, detTL.mostLikely, now);
        const latest = validateFutureDate(parsed.transitionTimeline?.latest, detTL.latest, now);

        // preTransitionSignals validation
        let preSignals = preTransitionSignals;
        if (Array.isArray(parsed.preTransitionSignals)) {
          const cleaned = parsed.preTransitionSignals
            .filter((s) => typeof s === 'string' && s.trim().length > 0)
            .slice(0, 5)
            .map((s) => (s as string).trim().slice(0, 200));
          if (cleaned.length > 0) preSignals = cleaned;
        }

        // Risk management validation
        let riskMgnt = deterministicStrategy.transitionRiskManagement;
        if (Array.isArray(parsed.transitionRiskManagement)) {
          const cleaned: RiskMitigation[] = [];
          for (const r of parsed.transitionRiskManagement.slice(0, 3)) {
            if (!r || typeof r !== 'object') continue;
            cleaned.push({
              risk: clampString(r.risk, 200, 'Tveganje pri transition-u.'),
              mitigation: clampString(r.mitigation, 200, 'Mitigacijska strategija.'),
              priority: clampEnum(r.priority, VALID_PRIORITY, 'MEDIUM'),
            });
          }
          if (cleaned.length > 0) riskMgnt = cleaned;
        }

        prediction = {
          transitionProbability: probability,
          predictedTransitionType: type,
          transitionTimeline: { earliest, latest, mostLikely },
          transitionConfidence: confidence,
          preTransitionSignals: preSignals,
        };
        strategy = {
          preTransitionStrategy: clampString(parsed.preTransitionStrategy, 500, deterministicStrategy.preTransitionStrategy),
          postTransitionStrategy: clampString(parsed.postTransitionStrategy, 500, deterministicStrategy.postTransitionStrategy),
          transitionRiskManagement: riskMgnt,
          historicalTransitionAccuracy: accuracy,
        };
        summary = clampString(parsed.summary, 400, buildDeterministicSummary(phase, type, probability, confidence));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/market-cycle-transition-predictor',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { prediction, strategy, summary });
    }

    return NextResponse.json({
      ok: true,
      current: { phase, phaseProgress, weeksInPhase },
      signals,
      prediction,
      strategy,
      summary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error(
      '/api/ai/market-cycle-transition-predictor',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

// Validate future date — fallback to deterministic if invalid
function validateFutureDate(
  raw: unknown,
  fallback: string,
  now: number,
): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  const trimmed = raw.trim().slice(0, 10);
  const ms = new Date(trimmed).getTime();
  if (!Number.isFinite(ms) || ms <= now) return fallback;
  return trimmed;
}

function buildDeterministicSummary(
  phase: CyclePhase,
  type: TransitionType,
  probability: number,
  confidence: number,
): string {
  const parts: string[] = [
    `Transition probability: ${probability}% within 30d.`,
  ];
  if (type !== 'NO_TRANSITION') {
    const typeLabel = type === 'BULLISH_TRANSITION' ? 'BULLISH' : 'BEARISH';
    const fromTo = type === 'BULLISH_TRANSITION'
      ? (phase === 'DECLINE' ? 'decline→accumulation' : 'accumulation→markup')
      : (phase === 'MARKUP' ? 'markup→distribution' : 'distribution→decline');
    parts.push(`Type: ${typeLabel} (${fromTo}).`);
  }
  parts.push(`Confidence: ${confidence}%.`);
  return parts.join(' ').slice(0, 400);
}
