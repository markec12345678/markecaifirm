// v7.83: Market Cycle Forecaster — projicira tržne cikle faz 90 dni v
// prihodnost — kdaj se bo končal ACCUMULATION? Kdaj bo MARKUP dosegel vrh?
// Kdaj bo začel DISTRIBUTION? Pure DB analytics — NO AI. "Current: MARKUP
// (70% progress, ends ~Sep 15). Next: DISTRIBUTION (est. 6 weeks). Prepare
// to SELL."
//
// Razlika od market-cycle-detector (v7.77, ki identificira current phase) —
// ta FORECAST-a future phases 90 dni vnaprej z projectedPhaseEnd,
// projectedNextPhaseStart in phaseTransitionConfidence. Razlika od
// market-trend-momentum (ki gleda ACCELERATION) — ta gleda 4-fazni cikel
// z avg phase duration in cycle length. Razlika od
// market-saturation-forecaster (ki forecast-a saturacijo) — ta gleda
// CYLE PHASE projections (kdaj markup → distribution). Razlika od
// market-gap-forecaster (ki napove market gaps) — ta gleda CYCLE timing
// za buy/sell odločitve.
//
// Pure DB analytics (NO AI). GET /api/analytics/market-cycle-forecaster

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type CyclePhase = 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'DECLINE';
type TrendDirection = 'UP' | 'FLAT' | 'DOWN';

interface CurrentCycle {
  phase: CyclePhase;
  phaseProgress: number; // 0-100 %
  weeksInPhase: number;
  projectedPhaseEnd: string; // ISO date
}

interface ForecastCycle {
  nextPhase: CyclePhase;
  projectedNextPhaseStart: string; // ISO date
  nextPhaseDuration: number; // weeks
  projectedPhase90d: CyclePhase; // phase we'll be in 90 days from now
  phaseTransitionConfidence: number; // 0-100
}

interface CategoryCycleForecast {
  category: string;
  currentPhase: CyclePhase;
  phaseProgress: number;
  projectedPhaseEnd: string;
  nextPhase: CyclePhase;
}

interface PhaseFrequencyEntry {
  phase: CyclePhase;
  occurrences: number;
  avgDuration: number;
}

interface HistoricalCycles {
  phaseFrequency: PhaseFrequencyEntry[];
  avgPhaseDuration: Record<string, number>; // phase -> weeks
  cycleLength: number; // weeks for full cycle (accumulation→markup→distribution→decline)
}

interface CycleRecommendations {
  currentPhaseAction: string;
  nextPhasePreparation: string;
  timeHorizon: string;
  advice: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const HORIZON_365D = 365 * DAY_MS;
const FORECAST_HORIZON_DAYS = 90;

// Canonical phase order: ACCUMULATION → MARKUP → DISTRIBUTION → DECLINE → (back to ACCUMULATION)
const PHASE_ORDER: CyclePhase[] = [
  'ACCUMULATION',
  'MARKUP',
  'DISTRIBUTION',
  'DECLINE',
];

function nextPhaseInCycle(phase: CyclePhase): CyclePhase {
  const idx = PHASE_ORDER.indexOf(phase);
  return PHASE_ORDER[(idx + 1) % PHASE_ORDER.length]!;
}

// --- Math helpers --------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function round0(v: number): number {
  return Math.round(v);
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function linearRegression(ys: number[]): { slope: number; intercept: number } {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  const xs = Array.from({ length: n }, (_, i) => i);
  const sumX = xs.reduce((s, x) => s + x, 0);
  const sumY = ys.reduce((s, y) => s + y, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i]!, 0);
  const sumXX = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function directionFromSlope(
  slope: number,
  thresholdPct: number,
  meanValue: number,
): TrendDirection {
  if (meanValue <= 0) return 'FLAT';
  const relSlope = (slope / meanValue) * 100; // % per week
  if (relSlope > thresholdPct) return 'UP';
  if (relSlope < -thresholdPct) return 'DOWN';
  return 'FLAT';
}

function isoWeekStart(ms: number): number {
  // ISO week starts Monday
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const offset = day === 0 ? 6 : day - 1; // shift to Mon=0
  const start = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset),
  );
  return start.getTime();
}

function addDaysISO(fromMs: number, days: number): string {
  return new Date(fromMs + Math.max(0, days) * DAY_MS).toISOString();
}

// --- Phase classification (same logic as market-cycle-detector) ---------
// Inspired by Wyckoff market cycle.

function classifyPhase(
  price90d: TrendDirection,
  price30d: TrendDirection,
  volume90d: TrendDirection,
  volume30d: TrendDirection,
  volatilityIndex: number,
): CyclePhase {
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
  return scores[0]!.phase;
}

// --- Weekly aggregation --------------------------------------------------

interface WeeklyAgg {
  totalListings: number;
  pricedListings: number;
  sumPrice: number;
  sumDealScore: number;
  dealScoreCount: number;
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

// --- Per-week phase computation (for historical cycle analysis) ---------

interface WeekPhaseEntry {
  weekMs: number;
  phase: CyclePhase;
}

// Compute the phase for each week based on trailing indicators centered on that week.
function computeWeekPhases(
  sortedWeekKeys: number[],
  overallByWeek: Map<number, WeeklyAgg>,
): WeekPhaseEntry[] {
  const entries: WeekPhaseEntry[] = [];
  for (let i = 0; i < sortedWeekKeys.length; i++) {
    const weekMs = sortedWeekKeys[i]!;
    // Use trailing 4 weeks (or fewer if at start) for trend indicators.
    const startIdx = Math.max(0, i - 3);
    const window = sortedWeekKeys.slice(startIdx, i + 1);
    if (window.length < 2) continue;
    const priceSeries = window.map((wk) => {
      const a = overallByWeek.get(wk)!;
      return a.pricedListings > 0 ? a.sumPrice / a.pricedListings : 0;
    });
    const volumeSeries = window.map(
      (wk) => overallByWeek.get(wk)!.totalListings,
    );
    const priced = priceSeries.filter((v) => v > 0);
    const meanPrice = mean(priced);
    const meanVolume = mean(volumeSeries);
    // 4w trends: slope over the window
    const priceReg = linearRegression(priceSeries);
    const volumeReg = linearRegression(volumeSeries);
    const priceDir = directionFromSlope(priceReg.slope, 1.5, meanPrice);
    const volDir = directionFromSlope(volumeReg.slope, 5, meanVolume);
    // Volatility over window
    const volIndex =
      priced.length > 1 && meanPrice > 0
        ? round1((stdDev(priced) / meanPrice) * 100)
        : 0;
    // Recent vs prior (last 2 vs prior 2 in window — approximate for 30d/90d)
    const price30d =
      priceSeries.length >= 2
        ? directionFromSlope(
            linearRegression(priceSeries.slice(-2)).slope,
            2.5,
            mean(priceSeries.slice(-2)),
          )
        : 'FLAT';
    const vol30d =
      volumeSeries.length >= 2
        ? directionFromSlope(
            linearRegression(volumeSeries.slice(-2)).slope,
            8,
            mean(volumeSeries.slice(-2)),
          )
        : 'FLAT';
    const phase = classifyPhase(
      priceDir,
      price30d,
      volDir,
      vol30d,
      volIndex,
    );
    entries.push({ weekMs, phase });
  }
  return entries;
}

// Group consecutive weeks of same phase into "phase runs" with durations.
interface PhaseRun {
  phase: CyclePhase;
  startMs: number;
  endMs: number;
  weeks: number;
}

function groupPhaseRuns(entries: WeekPhaseEntry[]): PhaseRun[] {
  const runs: PhaseRun[] = [];
  if (entries.length === 0) return runs;
  let current: PhaseRun | null = null;
  for (const e of entries) {
    if (current && current.phase === e.phase) {
      current.endMs = e.weekMs;
      current.weeks += 1;
    } else {
      if (current) runs.push(current);
      current = {
        phase: e.phase,
        startMs: e.weekMs,
        endMs: e.weekMs,
        weeks: 1,
      };
    }
  }
  if (current) runs.push(current);
  return runs;
}

// Compute progress (0-100) of current phase based on how far into avg
// duration we are. Heuristic: if weeksInPhase >= avgDuration → 95% (about to end).
function computePhaseProgress(
  weeksInPhase: number,
  avgDurationForPhase: number,
): number {
  if (avgDurationForPhase <= 0) return 50;
  const progress = Math.min(95, (weeksInPhase / avgDurationForPhase) * 100);
  return round0(progress);
}

// --- Phase-specific recommendations -------------------------------------

function currentPhaseAction(phase: CyclePhase): string {
  switch (phase) {
    case 'ACCUMULATION':
      return 'BUY_AGGRESSIVELY — trg v ACCUMULATION fazi. Cene nizke, nabavljaj pred Markup. Confidence visok.';
    case 'MARKUP':
      return 'BUY — trg v MARKUP fazi. Cene rastejo, vendar še vedno priložnosti. Spremljaj znake Distribution.';
    case 'DISTRIBUTION':
      return 'SELL — trg v DISTRIBUTION fazi. Cene visoke, prodaj inventar pred Decline.';
    case 'DECLINE':
      return 'WAIT — trg v DECLINE fazi. Zadrži kapital, čakaj na znake Accumulation (cene se umirijo).';
  }
}

function nextPhasePreparation(currentPhase: CyclePhase): string {
  const next = nextPhaseInCycle(currentPhase);
  switch (next) {
    case 'ACCUMULATION':
      return 'Pripravi kapital za ACCUMULATION — znižaj inventar, identifikuj kategorije z nizkimi cenami za naslednji nakup.';
    case 'MARKUP':
      return 'Pripravi se za MARKUP — povečaj nabavo v ACCUMULATION kategorijah, določi target cene za prodajo.';
    case 'DISTRIBUTION':
      return 'Pripravi se za DISTRIBUTION — planiraj prodajo inventarja, določi realisticne asking cene, osveži oglase.';
    case 'DECLINE':
      return 'Pripravi se za DECLINE — zmanjšaj nabavo, dvigni cash rezerve, identifikuj katere item-e obdržati skozi bear phase.';
  }
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();
    const cutoff = new Date(now - HORIZON_365D);

    // 1) Query listings from last 365 days for cycle analysis
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: cutoff },
        isHidden: false,
      },
      select: {
        price: true,
        firstSeenAt: true,
        dealScore: true,
        monitor: { select: { source: true } },
      },
      take: 200000,
    });

    const emptyResponse = {
      ok: true,
      current: {
        phase: 'ACCUMULATION' as CyclePhase,
        phaseProgress: 0,
        weeksInPhase: 0,
        projectedPhaseEnd: new Date(now).toISOString(),
      },
      forecast: {
        nextPhase: 'MARKUP' as CyclePhase,
        projectedNextPhaseStart: new Date(now).toISOString(),
        nextPhaseDuration: 0,
        projectedPhase90d: 'ACCUMULATION' as CyclePhase,
        phaseTransitionConfidence: 0,
      },
      byCategory: [] as CategoryCycleForecast[],
      historical: {
        phaseFrequency: [] as PhaseFrequencyEntry[],
        avgPhaseDuration: {} as Record<string, number>,
        cycleLength: 0,
      },
      recommendations: {
        currentPhaseAction: 'WAIT',
        nextPhasePreparation: '',
        timeHorizon: 'Ni podatkov',
        advice:
          'Ni listing-ov v zadnjih 365 dneh — Market Cycle Forecaster ni mogoč.',
      },
      message:
        'Ni listing-ov v zadnjih 365 dneh — Market Cycle Forecaster ni mogoč.',
    };

    if (listings.length === 0) {
      return NextResponse.json(emptyResponse);
    }

    // 2) Build weekly aggregates — overall + per-source ("category" dimension)
    const overallByWeek = new Map<number, WeeklyAgg>();
    const perSourceByWeek = new Map<string, Map<number, WeeklyAgg>>();

    for (const l of listings) {
      const firstSeenMs = new Date(
        l.firstSeenAt as unknown as Date | string,
      ).getTime();
      if (!Number.isFinite(firstSeenMs) || firstSeenMs < cutoff.getTime())
        continue;
      const weekMs = isoWeekStart(firstSeenMs);

      let oAgg = overallByWeek.get(weekMs);
      if (!oAgg) {
        oAgg = emptyWeeklyAgg();
        overallByWeek.set(weekMs, oAgg);
      }
      oAgg.totalListings += 1;
      if (l.price != null && l.price > 0) {
        oAgg.pricedListings += 1;
        oAgg.sumPrice += l.price;
      }
      if (l.dealScore != null && l.dealScore > 0) {
        oAgg.sumDealScore += l.dealScore;
        oAgg.dealScoreCount += 1;
      }

      const source =
        (l.monitor?.source || '').trim().toLowerCase() || 'neznan';
      let srcMap = perSourceByWeek.get(source);
      if (!srcMap) {
        srcMap = new Map<number, WeeklyAgg>();
        perSourceByWeek.set(source, srcMap);
      }
      let sAgg = srcMap.get(weekMs);
      if (!sAgg) {
        sAgg = emptyWeeklyAgg();
        srcMap.set(weekMs, sAgg);
      }
      sAgg.totalListings += 1;
      if (l.price != null && l.price > 0) {
        sAgg.pricedListings += 1;
        sAgg.sumPrice += l.price;
      }
      if (l.dealScore != null && l.dealScore > 0) {
        sAgg.sumDealScore += l.dealScore;
        sAgg.dealScoreCount += 1;
      }
    }

    const sortedWeekKeys = Array.from(overallByWeek.keys()).sort(
      (a, b) => a - b,
    );

    // Need at least 8 weeks of history for forecasting
    if (sortedWeekKeys.length < 8) {
      return NextResponse.json({
        ok: true,
        current: {
          phase: 'ACCUMULATION' as CyclePhase,
          phaseProgress: 0,
          weeksInPhase: sortedWeekKeys.length,
          projectedPhaseEnd: new Date(now).toISOString(),
        },
        forecast: {
          nextPhase: 'MARKUP' as CyclePhase,
          projectedNextPhaseStart: new Date(now).toISOString(),
          nextPhaseDuration: 0,
          projectedPhase90d: 'ACCUMULATION' as CyclePhase,
          phaseTransitionConfidence: 10,
        },
        byCategory: [] as CategoryCycleForecast[],
        historical: {
          phaseFrequency: [] as PhaseFrequencyEntry[],
          avgPhaseDuration: {} as Record<string, number>,
          cycleLength: 0,
        },
        recommendations: {
          currentPhaseAction: 'WAIT',
          nextPhasePreparation: '',
          timeHorizon: 'Ni dovolj zgodovine',
          advice: `Premalo tedenskih podatkov (${sortedWeekKeys.length} tednov) — zberi vsaj 8 tednov za zanesljiv cycle forecast.`,
        },
        message: `Premalo tedenskih podatkov (${sortedWeekKeys.length} tednov) — Market Cycle Forecaster ni zanesljiv.`,
      });
    }

    // 3) Compute historical phase runs (for cycle length + avg durations)
    const weekPhaseEntries = computeWeekPhases(sortedWeekKeys, overallByWeek);
    const phaseRuns = groupPhaseRuns(weekPhaseEntries);

    // Phase frequency + avg duration per phase
    const phaseStats = new Map<
      CyclePhase,
      { occurrences: number; totalWeeks: number }
    >();
    for (const run of phaseRuns) {
      const entry = phaseStats.get(run.phase) ?? {
        occurrences: 0,
        totalWeeks: 0,
      };
      entry.occurrences += 1;
      entry.totalWeeks += run.weeks;
      phaseStats.set(run.phase, entry);
    }

    const avgPhaseDuration: Record<string, number> = {};
    const phaseFrequency: PhaseFrequencyEntry[] = [];
    for (const phase of PHASE_ORDER) {
      const stats = phaseStats.get(phase);
      const occurrences = stats?.occurrences ?? 0;
      const totalWeeks = stats?.totalWeeks ?? 0;
      const avgDur =
        occurrences > 0 ? round1(totalWeeks / occurrences) : 0;
      avgPhaseDuration[phase] = avgDur;
      phaseFrequency.push({
        phase,
        occurrences,
        avgDuration: avgDur,
      });
    }
    phaseFrequency.sort((a, b) => b.occurrences - a.occurrences);

    // Cycle length: total weeks / number of complete cycles.
    // A "complete cycle" passes through all 4 phases at least once.
    // Heuristic: count transitions where phase changes to next in PHASE_ORDER.
    let transitions = 0;
    for (let i = 1; i < phaseRuns.length; i++) {
      if (nextPhaseInCycle(phaseRuns[i - 1]!.phase) === phaseRuns[i]!.phase) {
        transitions += 1;
      }
    }
    // Each complete cycle = 4 transitions (accumulation→markup→distribution→decline→accumulation)
    const completeCycles = Math.max(
      1,
      Math.floor(transitions / 4) || 1,
    );
    const totalWeeks =
      phaseRuns.length > 0
        ? phaseRuns.reduce((s, r) => s + r.weeks, 0)
        : sortedWeekKeys.length;
    const cycleLength = round0(totalWeeks / completeCycles);

    // 4) Compute current phase + progress
    // Current phase = last week's phase
    const currentPhase =
      weekPhaseEntries.length > 0
        ? weekPhaseEntries[weekPhaseEntries.length - 1]!.phase
        : 'ACCUMULATION';

    // Weeks in current phase: count consecutive weeks at end with same phase
    let weeksInPhase = 0;
    for (let i = weekPhaseEntries.length - 1; i >= 0; i--) {
      if (weekPhaseEntries[i]!.phase === currentPhase) weeksInPhase += 1;
      else break;
    }

    const avgDurForCurrent = avgPhaseDuration[currentPhase] ?? 8; // default 8 weeks
    const phaseProgress = computePhaseProgress(
      weeksInPhase,
      avgDurForCurrent,
    );

    // projectedPhaseEnd: now + (avgDuration - weeksInPhase) weeks (at least 1 week)
    const remainingWeeks = Math.max(
      1,
      Math.round(avgDurForCurrent - weeksInPhase),
    );
    const projectedPhaseEndMs = now + remainingWeeks * WEEK_MS;

    // 5) Forecast next phase
    const nextPhase = nextPhaseInCycle(currentPhase);
    const nextPhaseDuration = avgPhaseDuration[nextPhase] ?? 6; // default 6 weeks
    const projectedNextPhaseStartMs = projectedPhaseEndMs;
    // 90-day projection: which phase will we be in 90 days from now?
    const projectedPhase90dMs = now + FORECAST_HORIZON_DAYS * DAY_MS;
    // Walk through phases from now until 90d ahead
    let phase90d: CyclePhase = currentPhase;
    let cursor = now;
    let safety = 0;
    while (cursor < projectedPhase90dMs && safety < 20) {
      safety += 1;
      const avgDur = avgPhaseDuration[phase90d] ?? 6;
      const phaseEndMs =
        phase90d === currentPhase
          ? projectedPhaseEndMs
          : cursor + avgDur * WEEK_MS;
      if (phaseEndMs >= projectedPhase90dMs) break;
      cursor = phaseEndMs;
      phase90d = nextPhaseInCycle(phase90d);
    }

    // Phase transition confidence: based on phase progress + how dominant
    // current phase has been in history.
    const phaseFreqMatch = phaseStats.get(currentPhase);
    const occurrences = phaseFreqMatch?.occurrences ?? 0;
    const totalOccurrences = phaseFrequency.reduce(
      (s, p) => s + p.occurrences,
      0,
    );
    const phaseStability =
      totalOccurrences > 0
        ? Math.min(100, (occurrences / totalOccurrences) * 200)
        : 30;
    const phaseTransitionConfidence = round0(
      Math.min(
        95,
        phaseProgress * 0.5 + phaseStability * 0.5,
      ),
    );

    // 6) Per-category cycle forecast (per source)
    const byCategory: CategoryCycleForecast[] = [];
    for (const [source, srcMap] of perSourceByWeek.entries()) {
      const sortedWeeksSrc = Array.from(srcMap.keys()).sort((a, b) => a - b);
      if (sortedWeeksSrc.length < 4) continue;
      const srcEntries = computeWeekPhases(sortedWeeksSrc, srcMap);
      if (srcEntries.length === 0) continue;
      const catPhase = srcEntries[srcEntries.length - 1]!.phase;
      // Weeks in current phase
      let catWeeksInPhase = 0;
      for (let i = srcEntries.length - 1; i >= 0; i--) {
        if (srcEntries[i]!.phase === catPhase) catWeeksInPhase += 1;
        else break;
      }
      const catAvgDur = avgPhaseDuration[catPhase] ?? 8;
      const catProgress = computePhaseProgress(catWeeksInPhase, catAvgDur);
      const catRemaining = Math.max(
        1,
        Math.round(catAvgDur - catWeeksInPhase),
      );
      const catPhaseEndMs = now + catRemaining * WEEK_MS;
      byCategory.push({
        category: source,
        currentPhase: catPhase,
        phaseProgress: catProgress,
        projectedPhaseEnd: new Date(catPhaseEndMs).toISOString(),
        nextPhase: nextPhaseInCycle(catPhase),
      });
    }

    // 7) Recommendations
    const phaseAction = currentPhaseAction(currentPhase);
    const nextPhasePrep = nextPhasePreparation(currentPhase);
    const advice = `Trg v ${currentPhase} fazi (${phaseProgress}% progress, ${weeksInPhase} tednov). Projected end: ${new Date(projectedPhaseEndMs).toISOString().slice(0, 10)}. Naslednja faza: ${nextPhase} (~${nextPhaseDuration} tednov). 90d projekcija: ${phase90d}. ${phaseAction.split(' — ')[1] ?? ''}`;

    return NextResponse.json({
      ok: true,
      current: {
        phase: currentPhase,
        phaseProgress,
        weeksInPhase,
        projectedPhaseEnd: new Date(projectedPhaseEndMs).toISOString(),
      },
      forecast: {
        nextPhase,
        projectedNextPhaseStart: new Date(
          projectedNextPhaseStartMs,
        ).toISOString(),
        nextPhaseDuration,
        projectedPhase90d: phase90d,
        phaseTransitionConfidence,
      },
      byCategory,
      historical: {
        phaseFrequency,
        avgPhaseDuration,
        cycleLength,
      },
      recommendations: {
        currentPhaseAction: phaseAction,
        nextPhasePreparation: nextPhasePrep,
        timeHorizon: `${remainingWeeks} tednov do ${nextPhase} (~${round0(remainingWeeks * 7)} dni)`,
        advice,
      },
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/market-cycle-forecaster',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
