// v7.75: AI Profit Momentum Tracker — AI sledi MOMENTUM rasti profita —
// ali profit pospešuje, upočasnjuje ali stagnira? Identificira kaj pogan
// momentum in kako ga vzdrževati. "Profit momentum: ACCELERATING (growth
// +15%, accel +5%). Driver: volume (+3 trades). Sustain: list 2 more/week."
//
// Razlika od profit-trajectory-forecaster (ki napove FUTURE growth
// trajectory) — ta tracks CURRENT momentum (acceleration/deceleration
// right now). Razlika od profit-accelerator (ki pospešuje profit preko
// akcij) — ta diagnosticira stanje momentum-a in drivere. Razlika od
// profit-stream-predictor (ki napove stream prihodka) — ta gleda
// profit GROWTH RATE in njegovo ACCELERATION. Razlika od cash-flow-velocity
// (ki gleda velocity cash flow-a) — ta gleda PROFIT momentum (growth rate
// + acceleration). Razlika od profit-efficiency-analyzer (ki meri profit
// per day) — ta gleda MOMENTUM (smer + hitrost spremembe).
//
// GET+POST /api/ai/profit-momentum-tracker
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

type MomentumStatus =
  | 'ACCELERATING'
  | 'STEADY'
  | 'DECELERATING'
  | 'PLATEAUING'
  | 'DECLINING';

type DriverImpact = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

interface Momentum {
  currentMonthlyProfit: number;
  previousMonthlyProfit: number;
  profitGrowthRate: number; // %
  profitAcceleration: number; // % change in growth rate
  momentumStatus: MomentumStatus;
  momentumScore: number; // 0-100
}

interface DriverMetric {
  change: number;
  impact: DriverImpact;
  detail: string;
}

interface Drivers {
  volumeDriver: DriverMetric;
  priceDriver: DriverMetric;
  efficiencyDriver: DriverMetric;
  categoryDriver: { topContributor: string; contribution: number };
}

interface KeyDriver {
  driver: string;
  impact: 'POSITIVE' | 'NEGATIVE';
  weight: number;
  detail: string;
}

interface MomentumAction {
  action: string;
  priority: ActionPriority;
  expectedImpact: string;
}

interface Analysis {
  momentumAssessment: string;
  keyDrivers: KeyDriver[];
  sustainabilityScore: number; // 0-100
  momentumForecast: string;
  momentumActions: MomentumAction[];
  riskFactors: string[];
}

interface AiMomentumResponse {
  analysis?: unknown;
}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;
const MONTH_MS = 30 * DAY_MS;

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

const VALID_MOMENTUM: readonly MomentumStatus[] = [
  'ACCELERATING',
  'STEADY',
  'DECELERATING',
  'PLATEAUING',
  'DECLINING',
];

const VALID_IMPACT: readonly DriverImpact[] = ['POSITIVE', 'NEGATIVE', 'NEUTRAL'];

const VALID_PRIORITY: readonly ActionPriority[] = ['HIGH', 'MEDIUM', 'LOW'];

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

// Compute momentum status from growth rate + acceleration
function classifyMomentum(
  growthRate: number,
  acceleration: number,
): MomentumStatus {
  // DECLINING: negative profit growth
  if (growthRate < -5) {
    // Profit dropping — is it accelerating decline?
    if (acceleration < -2) return 'DECLINING';
    return 'DECLINING';
  }
  // PLATEAUING: near-zero growth
  if (Math.abs(growthRate) <= 2) {
    return 'PLATEAUING';
  }
  // Positive growth — check acceleration
  if (growthRate > 2) {
    if (acceleration > 2) return 'ACCELERATING';
    if (acceleration < -2) return 'DECELERATING';
    return 'STEADY';
  }
  return 'STEADY';
}

// Compute momentum score (0-100) from growth rate + acceleration + status
function computeMomentumScore(
  growthRate: number,
  acceleration: number,
  status: MomentumStatus,
): number {
  let score = 50; // baseline
  // Growth rate contribution: -50% to +50% maps to -25 to +25
  score += Math.max(-25, Math.min(25, growthRate * 0.5));
  // Acceleration contribution: -25% to +25% maps to -15 to +15
  score += Math.max(-15, Math.min(15, acceleration * 0.6));
  // Status bonus
  switch (status) {
    case 'ACCELERATING': score += 15; break;
    case 'STEADY': score += 5; break;
    case 'DECELERATING': score -= 5; break;
    case 'PLATEAUING': score -= 10; break;
    case 'DECLINING': score -= 20; break;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Compute sustainability score (0-100)
function computeSustainability(
  growthRate: number,
  acceleration: number,
  tradeCount: number,
  status: MomentumStatus,
): number {
  let score = 50;
  // Sustainable growth is moderate (10-30%) — not too extreme
  if (growthRate >= 10 && growthRate <= 30) score += 20;
  else if (growthRate > 0 && growthRate < 10) score += 10;
  else if (growthRate > 50) score -= 10; // too fast, unsustainable
  else if (growthRate < 0) score -= 20;

  // Positive acceleration with steady base = more sustainable
  if (acceleration > 0 && growthRate > 0) score += 10;
  if (acceleration < -5) score -= 15; // decelerating badly

  // Sample size matters — more trades = more reliable
  if (tradeCount >= 10) score += 15;
  else if (tradeCount >= 5) score += 5;
  else if (tradeCount < 3) score -= 10;

  // Status adjustments
  switch (status) {
    case 'STEADY': score += 5; break;
    case 'ACCELERATING': score += 5; break;
    case 'DECELERATING': score -= 5; break;
    case 'DECLINING': score -= 15; break;
    case 'PLATEAUING': score -= 5; break;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// Get month key (YYYY-MM)
function getMonthKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

// Build deterministic momentum assessment in Slovenian
function buildMomentumAssessment(
  status: MomentumStatus,
  currentProfit: number,
  growthRate: number,
  acceleration: number,
): string {
  const statusTxt = {
    ACCELERATING: `Profit pospešuje`,
    STEADY: `Profit stabilno raste`,
    DECELERATING: `Profit raste vendar upočasnjuje`,
    PLATEAUING: `Profit stagnira`,
    DECLINING: `Profit pada`,
  }[status];

  const growthTxt = growthRate > 0
    ? `Rast ${growthRate.toFixed(1)}% (trenutni profit ${currentProfit.toFixed(0)}€)`
    : growthRate < 0
      ? `Padec ${Math.abs(growthRate).toFixed(1)}% (trenutni profit ${currentProfit.toFixed(0)}€)`
      : `Profit stabilen (trenutni ${currentProfit.toFixed(0)}€)`;

  const accelTxt = acceleration > 2
    ? `Pospešek +${acceleration.toFixed(1)}%`
    : acceleration < -2
      ? `Upočasnitev ${acceleration.toFixed(1)}%`
      : `Stabilen trend`;

  return `${statusTxt}. ${growthTxt}. ${accelTxt}.`;
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleProfitMomentumTracker(req);
}
export async function POST(req: NextRequest) {
  return handleProfitMomentumTracker(req);
}

async function handleProfitMomentumTracker(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-profit-momentum-tracker', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();

    // 1) Query SOLD trades for last 6 months (for monthly aggregation)
    const soldCutoff = new Date(now - 6 * MONTH_MS);
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: soldCutoff },
        buyPrice: { gt: 0 },
        sellPrice: { not: null },
      },
      select: {
        id: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        buyDate: true,
        sellDate: true,
      },
      take: 20000,
    });

    // Empty state — no SOLD trades
    if (soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        momentum: {
          currentMonthlyProfit: 0,
          previousMonthlyProfit: 0,
          profitGrowthRate: 0,
          profitAcceleration: 0,
          momentumStatus: 'PLATEAUING',
          momentumScore: 0,
        },
        drivers: {
          volumeDriver: { change: 0, impact: 'NEUTRAL', detail: 'Ni podatkov' },
          priceDriver: { change: 0, impact: 'NEUTRAL', detail: 'Ni podatkov' },
          efficiencyDriver: { change: 0, impact: 'NEUTRAL', detail: 'Ni podatkov' },
          categoryDriver: { topContributor: 'neznan', contribution: 0 },
        },
        analysis: {
          momentumAssessment: 'Ni SOLD trade-ov v zadnjih 6 mesecih — momentum ni mogoč izračunati.',
          keyDrivers: [],
          sustainabilityScore: 0,
          momentumForecast: 'Dodaj SOLD trade-e za analizo momentum-a.',
          momentumActions: [],
          riskFactors: ['Ni zgodovinskih podatkov za analizo'],
        },
        summary: 'Ni SOLD trade-ov — Profit Momentum Tracker ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trade-ov v zadnjih 6 mesecih — Profit Momentum Tracker ni mogoč.',
      });
    }

    // 2) Aggregate monthly profit + trade count + cycle time per month
    interface MonthAgg {
      profit: number;
      tradeCount: number;
      totalSellPrice: number;
      totalBuyPrice: number;
      cycleDaysSum: number;
      cycleDaysCount: number;
    }
    const monthlyAgg = new Map<string, MonthAgg>();

    // Per category for current month (for categoryDriver)
    interface CatAgg {
      profit: number;
      tradeCount: number;
    }
    const currentMonthCatAgg = new Map<string, CatAgg>();
    const previousMonthCatAgg = new Map<string, CatAgg>();

    // Determine current month + previous month keys
    const currentMonthKey = getMonthKey(now);
    const previousMonthKey = getMonthKey(now - MONTH_MS);

    for (const t of soldTrades) {
      const sellMs = t.sellDate
        ? new Date(t.sellDate as unknown as Date | string).getTime()
        : 0;
      if (sellMs <= 0) continue;
      const monthKey = getMonthKey(sellMs);

      const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);

      let agg = monthlyAgg.get(monthKey);
      if (!agg) {
        agg = {
          profit: 0,
          tradeCount: 0,
          totalSellPrice: 0,
          totalBuyPrice: 0,
          cycleDaysSum: 0,
          cycleDaysCount: 0,
        };
        monthlyAgg.set(monthKey, agg);
      }
      agg.profit += profit;
      agg.tradeCount += 1;
      agg.totalSellPrice += t.sellPrice ?? 0;
      agg.totalBuyPrice += t.buyPrice;

      const buyMs = new Date(t.buyDate as unknown as Date | string).getTime();
      if (buyMs > 0) {
        const cycleDays = (sellMs - buyMs) / DAY_MS;
        if (cycleDays >= 0 && cycleDays <= 365) {
          agg.cycleDaysSum += cycleDays;
          agg.cycleDaysCount += 1;
        }
      }

      // Per-category aggregation for current + previous month
      const cat = (t.category || '').trim().toLowerCase() || 'neznan';
      if (monthKey === currentMonthKey) {
        let c = currentMonthCatAgg.get(cat);
        if (!c) { c = { profit: 0, tradeCount: 0 }; currentMonthCatAgg.set(cat, c); }
        c.profit += profit;
        c.tradeCount += 1;
      } else if (monthKey === previousMonthKey) {
        let c = previousMonthCatAgg.get(cat);
        if (!c) { c = { profit: 0, tradeCount: 0 }; previousMonthCatAgg.set(cat, c); }
        c.profit += profit;
        c.tradeCount += 1;
      }
    }

    // Sort months chronologically
    const sortedMonths = Array.from(monthlyAgg.keys()).sort();
    if (sortedMonths.length === 0) {
      return NextResponse.json({
        ok: true,
        momentum: {
          currentMonthlyProfit: 0,
          previousMonthlyProfit: 0,
          profitGrowthRate: 0,
          profitAcceleration: 0,
          momentumStatus: 'PLATEAUING',
          momentumScore: 0,
        },
        drivers: {
          volumeDriver: { change: 0, impact: 'NEUTRAL', detail: 'Ni podatkov' },
          priceDriver: { change: 0, impact: 'NEUTRAL', detail: 'Ni podatkov' },
          efficiencyDriver: { change: 0, impact: 'NEUTRAL', detail: 'Ni podatkov' },
          categoryDriver: { topContributor: 'neznan', contribution: 0 },
        },
        analysis: {
          momentumAssessment: 'Ni veljavnih mesečnih podatkov.',
          keyDrivers: [],
          sustainabilityScore: 0,
          momentumForecast: 'Potrebni dodatni podatki.',
          momentumActions: [],
          riskFactors: ['Ni zadostnih mesečnih podatkov'],
        },
        summary: 'Ni mesečnih podatkov — Profit Momentum Tracker ni mogoč.',
        aiUsed: false,
      });
    }

    // 3) Compute momentum metrics
    // Current = last month with data; Previous = month before
    const lastIdx = sortedMonths.length - 1;
    const currentMonth = sortedMonths[lastIdx]!;
    const previousMonth = sortedMonths[lastIdx - 1] ?? currentMonth;

    const currentAgg = monthlyAgg.get(currentMonth)!;
    const previousAgg = monthlyAgg.get(previousMonth)!;

    const currentMonthlyProfit = currentAgg.profit;
    const previousMonthlyProfit = previousAgg.profit;

    // profitGrowthRate = (current - previous) / |previous| × 100
    let profitGrowthRate = 0;
    if (Math.abs(previousMonthlyProfit) > 0.01) {
      profitGrowthRate = ((currentMonthlyProfit - previousMonthlyProfit) / Math.abs(previousMonthlyProfit)) * 100;
    } else if (currentMonthlyProfit > 0) {
      profitGrowthRate = 100; // Going from 0 to positive = 100% growth
    }

    // profitAcceleration = change in growth rate
    // Compute previous growth rate (month before previousMonth vs previousMonth)
    let profitAcceleration = 0;
    if (sortedMonths.length >= 3) {
      const prevPrevMonth = sortedMonths[lastIdx - 2]!;
      const prevPrevAgg = monthlyAgg.get(prevPrevMonth)!;
      const prevPrevProfit = prevPrevAgg.profit;
      let prevGrowthRate = 0;
      if (Math.abs(prevPrevProfit) > 0.01) {
        prevGrowthRate = ((previousMonthlyProfit - prevPrevProfit) / Math.abs(prevPrevProfit)) * 100;
      } else if (previousMonthlyProfit > 0) {
        prevGrowthRate = 100;
      }
      profitAcceleration = profitGrowthRate - prevGrowthRate;
    }

    // Clamp anti-hallucination
    profitGrowthRate = Math.max(-100, Math.min(500, profitGrowthRate));
    profitAcceleration = Math.max(-100, Math.min(500, profitAcceleration));

    const momentumStatus = classifyMomentum(profitGrowthRate, profitAcceleration);
    const momentumScore = computeMomentumScore(profitGrowthRate, profitAcceleration, momentumStatus);

    const momentum: Momentum = {
      currentMonthlyProfit: Math.round(currentMonthlyProfit * 100) / 100,
      previousMonthlyProfit: Math.round(previousMonthlyProfit * 100) / 100,
      profitGrowthRate: Math.round(profitGrowthRate * 100) / 100,
      profitAcceleration: Math.round(profitAcceleration * 100) / 100,
      momentumStatus,
      momentumScore,
    };

    // 4) Compute momentum drivers
    // Volume driver: change in trade count
    const currentTradeCount = currentAgg.tradeCount;
    const previousTradeCount = previousAgg.tradeCount;
    const volumeChange = currentTradeCount - previousTradeCount;
    const volumeImpact: DriverImpact = volumeChange > 0 ? 'POSITIVE' : volumeChange < 0 ? 'NEGATIVE' : 'NEUTRAL';
    const volumeDriver: DriverMetric = {
      change: volumeChange,
      impact: volumeImpact,
      detail: `${currentTradeCount} prodaj v ${currentMonth} vs ${previousTradeCount} v ${previousMonth} (${volumeChange > 0 ? '+' : ''}${volumeChange}).`,
    };

    // Price driver: change in avg profit per trade
    const currentAvgProfitPerTrade = currentTradeCount > 0
      ? currentMonthlyProfit / currentTradeCount
      : 0;
    const previousAvgProfitPerTrade = previousTradeCount > 0
      ? previousMonthlyProfit / previousTradeCount
      : 0;
    const priceChange = currentAvgProfitPerTrade - previousAvgProfitPerTrade;
    const priceImpact: DriverImpact = priceChange > 0 ? 'POSITIVE' : priceChange < 0 ? 'NEGATIVE' : 'NEUTRAL';
    const priceDriver: DriverMetric = {
      change: Math.round(priceChange * 100) / 100,
      impact: priceImpact,
      detail: `Povprečni profit na trade: ${currentAvgProfitPerTrade.toFixed(2)}€ vs ${previousAvgProfitPerTrade.toFixed(2)}€ (${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}€).`,
    };

    // Efficiency driver: change in avg cycle days (faster = positive)
    const currentAvgCycleDays = currentAgg.cycleDaysCount > 0
      ? currentAgg.cycleDaysSum / currentAgg.cycleDaysCount
      : 0;
    const previousAvgCycleDays = previousAgg.cycleDaysCount > 0
      ? previousAgg.cycleDaysSum / previousAgg.cycleDaysCount
      : 0;
    const cycleChange = currentAvgCycleDays - previousAvgCycleDays;
    // Negative cycle change = faster = positive
    const efficiencyImpact: DriverImpact = cycleChange < 0 ? 'POSITIVE' : cycleChange > 0 ? 'NEGATIVE' : 'NEUTRAL';
    const efficiencyDriver: DriverMetric = {
      change: Math.round(cycleChange * 100) / 100,
      impact: efficiencyImpact,
      detail: `Povprečni cycle time: ${currentAvgCycleDays.toFixed(1)} dni vs ${previousAvgCycleDays.toFixed(1)} dni (${cycleChange > 0 ? '+' : ''}${cycleChange.toFixed(1)}d).`,
    };

    // Category driver: which category contributes most to momentum?
    let topCat = 'neznan';
    let topContribution = 0;
    for (const [cat, agg] of currentMonthCatAgg.entries()) {
      const prevCatAgg = previousMonthCatAgg.get(cat);
      const prevProfit = prevCatAgg?.profit ?? 0;
      const contribution = agg.profit - prevProfit;
      if (Math.abs(contribution) > Math.abs(topContribution)) {
        topContribution = contribution;
        topCat = cat;
      }
    }
    const categoryDriver = {
      topContributor: topCat,
      contribution: Math.round(topContribution * 100) / 100,
    };

    const drivers: Drivers = {
      volumeDriver,
      priceDriver,
      efficiencyDriver,
      categoryDriver,
    };

    // 5) Build deterministic baseline analysis
    const sustainabilityScore = computeSustainability(
      profitGrowthRate,
      profitAcceleration,
      currentTradeCount,
      momentumStatus,
    );

    // Build key drivers list (top 3 by |impact|)
    const keyDriversList: KeyDriver[] = [
      { driver: 'Volumen prodaj', impact: volumeImpact === 'NEUTRAL' ? 'NEGATIVE' : volumeImpact as 'POSITIVE' | 'NEGATIVE', weight: Math.abs(volumeChange) * 10, detail: volumeDriver.detail },
      { driver: 'Profit na trade', impact: priceImpact === 'NEUTRAL' ? 'NEGATIVE' : priceImpact as 'POSITIVE' | 'NEGATIVE', weight: Math.abs(priceChange) * 5, detail: priceDriver.detail },
      { driver: 'Hitrost cikla', impact: efficiencyImpact === 'NEUTRAL' ? 'NEGATIVE' : efficiencyImpact as 'POSITIVE' | 'NEGATIVE', weight: Math.abs(cycleChange) * 3, detail: efficiencyDriver.detail },
    ].sort((a, b) => b.weight - a.weight).slice(0, 3);

    const momentumAssessment = buildMomentumAssessment(
      momentumStatus,
      currentMonthlyProfit,
      profitGrowthRate,
      profitAcceleration,
    );

    // Build deterministic forecast
    let momentumForecast: string;
    if (momentumStatus === 'ACCELERATING') {
      momentumForecast = `Momentum pospešuje — če vzdržiš sedanji tempo, pričakujem +${(profitGrowthRate * 1.2).toFixed(1)}% rast naslednji mesec (${(currentMonthlyProfit * (1 + profitGrowthRate / 100 * 1.2)).toFixed(0)}€).`;
    } else if (momentumStatus === 'STEADY') {
      momentumForecast = `Momentum stabilen — pričakujem podobno rast ${profitGrowthRate.toFixed(1)}% naslednji mesec (${(currentMonthlyProfit * (1 + profitGrowthRate / 100)).toFixed(0)}€).`;
    } else if (momentumStatus === 'DECELERATING') {
      momentumForecast = `Momentum upočasnjuje — rast se bo verjetno zmanjšala na ${(profitGrowthRate + profitAcceleration).toFixed(1)}% naslednji mesec. Preglej drivere.`;
    } else if (momentumStatus === 'PLATEAUING') {
      momentumForecast = `Momentum stagnira — potreben je nov stimulus (več nabave, boljša cena, hitrejši cikel) za nadaljnjo rast.`;
    } else {
      momentumForecast = `Momentum pada — takojšnje akcije potrebne za zaustavitev padca. Zmanjšaj nabavo in pospeši prodajo.`;
    }

    // Build deterministic actions
    const momentumActions: MomentumAction[] = [];
    if (volumeChange <= 0) {
      momentumActions.push({
        action: 'Povečaj volumen — dodaj 2-3 nove listing-e na teden za več prodajnih priložnosti.',
        priority: 'HIGH',
        expectedImpact: '+10-15% profit v 30 dneh',
      });
    }
    if (priceChange < 0) {
      momentumActions.push({
        action: 'Izboljšaj profit na trade — fokusiraj se na višje-maržne kategorije ali povišaj cene za 5%.',
        priority: 'HIGH',
        expectedImpact: '+5-10€ profit na trade',
      });
    }
    if (cycleChange > 0) {
      momentumActions.push({
        action: 'Pospeši cikel — optimiziraj cene in predstavitve za hitrejšo prodajo.',
        priority: 'MEDIUM',
        expectedImpact: '-5-10 dni cycle time',
      });
    }
    if (momentumStatus === 'ACCELERATING' || momentumStatus === 'STEADY') {
      momentumActions.push({
        action: 'Vzdržuj sedanjo strategijo — ohrani fokus na top-kategorijah za trajnostno rast.',
        priority: 'MEDIUM',
        expectedImpact: 'Trajnostna rast +10-20% mesečno',
      });
    }
    if (momentumActions.length === 0) {
      momentumActions.push({
        action: 'Spremljaj momentum tedensko — dodaj več podatkov za boljšo analizo.',
        priority: 'LOW',
        expectedImpact: 'Boljša natančnost napovedi',
      });
    }

    // Build deterministic risk factors
    const riskFactors: string[] = [];
    if (currentTradeCount < 5) {
      riskFactors.push('Majhen volumen prodaj — nizka statistična zanesljivost');
    }
    if (Math.abs(profitGrowthRate) > 50) {
      riskFactors.push('Ekstremna rast/padec — težko vzdržna v daljši dobi');
    }
    if (profitAcceleration < -10) {
      riskFactors.push('Močno upočasnjujoč trend — tveganje stagnacije');
    }
    if (topContribution < 0) {
      riskFactors.push(`Top kategorija "${topCat}" prispeva negativno (${topContribution.toFixed(0)}€) — exit premisli`);
    }
    if (riskFactors.length === 0) {
      riskFactors.push('Ni specifičnih tveganj — momentum je zdrav');
    }

    const baselineAnalysis: Analysis = {
      momentumAssessment,
      keyDrivers: keyDriversList,
      sustainabilityScore,
      momentumForecast,
      momentumActions: momentumActions.slice(0, 5),
      riskFactors: riskFactors.slice(0, 5),
    };

    const baselineSummary = `${momentumStatus} (growth ${profitGrowthRate.toFixed(1)}%, accel ${profitAcceleration.toFixed(1)}%). Sustainability ${sustainabilityScore}/100. Top driver: ${keyDriversList[0]?.driver ?? 'neznan'}.`;

    // 6) AI cache check (6h TTL) — key by current month
    const cacheKey = `profit-momentum-tracker:${currentMonth}`;
    const cached = getCachedAI<{
      analysis: Analysis;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        momentum,
        drivers,
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
      monthlyHistory: sortedMonths.map((m) => {
        const a = monthlyAgg.get(m)!;
        return {
          month: m,
          profit: Math.round(a.profit * 100) / 100,
          tradeCount: a.tradeCount,
          avgProfitPerTrade: a.tradeCount > 0 ? Math.round((a.profit / a.tradeCount) * 100) / 100 : 0,
          avgCycleDays: a.cycleDaysCount > 0 ? Math.round((a.cycleDaysSum / a.cycleDaysCount) * 10) / 10 : 0,
        };
      }),
      currentMonth,
      previousMonth,
      momentum: {
        currentMonthlyProfit: momentum.currentMonthlyProfit,
        previousMonthlyProfit: momentum.previousMonthlyProfit,
        profitGrowthRate: momentum.profitGrowthRate,
        profitAcceleration: momentum.profitAcceleration,
        momentumStatus: momentum.momentumStatus,
        momentumScore: momentum.momentumScore,
        deterministicSustainabilityScore: sustainabilityScore,
      },
      drivers: {
        volumeDriver: {
          currentTradeCount,
          previousTradeCount,
          change: volumeChange,
          impact: volumeImpact,
        },
        priceDriver: {
          currentAvgProfitPerTrade: Math.round(currentAvgProfitPerTrade * 100) / 100,
          previousAvgProfitPerTrade: Math.round(previousAvgProfitPerTrade * 100) / 100,
          change: Math.round(priceChange * 100) / 100,
          impact: priceImpact,
        },
        efficiencyDriver: {
          currentAvgCycleDays: Math.round(currentAvgCycleDays * 10) / 10,
          previousAvgCycleDays: Math.round(previousAvgCycleDays * 10) / 10,
          change: Math.round(cycleChange * 100) / 100,
          impact: efficiencyImpact,
        },
        categoryDriver: {
          topContributor: topCat,
          contribution: topContribution,
          currentCategories: Array.from(currentMonthCatAgg.entries()).map(([cat, agg]) => ({
            category: cat,
            profit: Math.round(agg.profit * 100) / 100,
            tradeCount: agg.tradeCount,
          })),
        },
      },
    };

    const prompt = `Si AI "Profit Momentum Tracker" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Sledi MOMENTUM rasti profita — ali profit pospešuje, upočasnjuje ali stagnira? Identificiraj kaj pogan momentum in kako ga vzdrževati.

MOMENTUM PODATKI (deterministično izračunano):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. analysis: object z naslednjimi polji:
   - momentumAssessment: opis trenutnega profit momentum-a v slovenščini (max 400 znakov)
   - keyDrivers: top 3 faktorji ki poganjajo momentum (driver, impact POSITIVE/NEGATIVE, weight 0-100, detail v slovenščini)
   - sustainabilityScore: 0-100 (kako trajen je trenutni momentum — anti-hallucination clamp)
   - momentumForecast: napoved ali bo momentum nadaljeval, pospešil ali upočasnil v slovenščini (max 400 znakov)
   - momentumActions: 3-5 akcij za vzdrževanje/pospešitev momentum-a (action v slovenščini, priority HIGH/MEDIUM/LOW, expectedImpact v slovenščini)
   - riskFactors: tveganja ki bi lahko prekinila momentum (array stringov v slovenščini, max 5)

VRNI LE JSON:
{
  "analysis": {
    "momentumAssessment": "...",
    "keyDrivers": [
      { "driver": "...", "impact": "POSITIVE", "weight": 0, "detail": "..." }
    ],
    "sustainabilityScore": 0,
    "momentumForecast": "...",
    "momentumActions": [
      { "action": "...", "priority": "HIGH", "expectedImpact": "..." }
    ],
    "riskFactors": ["..."]
  }
}${GROUNDING_PROMPT_SUFFIX}`;

    let analysis = baselineAnalysis;
    let summary = baselineSummary;
    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiMomentumResponse | null;

      if (parsed && typeof parsed === 'object' && parsed.analysis && typeof parsed.analysis === 'object') {
        const a = parsed.analysis as Record<string, unknown>;

        const momentumAssessment = clampString(
          a.momentumAssessment,
          400,
          baselineAnalysis.momentumAssessment,
        );

        // Parse keyDrivers
        const keyDrivers: KeyDriver[] = [];
        if (Array.isArray(a.keyDrivers)) {
          for (const d of a.keyDrivers) {
            const r = d as Record<string, unknown>;
            if (!r || typeof r !== 'object') continue;
            const driver = clampString(r.driver, 100, '');
            const impact = clampEnum(r.impact, ['POSITIVE', 'NEGATIVE'] as readonly ('POSITIVE' | 'NEGATIVE')[], 'POSITIVE');
            const weight = clampNumber(r.weight, 0, 100, 50);
            const detail = clampString(r.detail, 300, '');
            if (driver && detail) {
              keyDrivers.push({ driver, impact, weight: Math.round(weight), detail });
            }
            if (keyDrivers.length >= 5) break;
          }
        }

        const sustainabilityScoreClamped = clampNumber(
          a.sustainabilityScore,
          0,
          100,
          baselineAnalysis.sustainabilityScore,
        );

        const momentumForecast = clampString(
          a.momentumForecast,
          400,
          baselineAnalysis.momentumForecast,
        );

        // Parse momentumActions
        const momentumActions: MomentumAction[] = [];
        if (Array.isArray(a.momentumActions)) {
          for (const ma of a.momentumActions) {
            const r = ma as Record<string, unknown>;
            if (!r || typeof r !== 'object') continue;
            const action = clampString(r.action, 300, '');
            const priority = clampEnum(r.priority, VALID_PRIORITY, 'MEDIUM');
            const expectedImpact = clampString(r.expectedImpact, 200, '');
            if (action) {
              momentumActions.push({ action, priority, expectedImpact });
            }
            if (momentumActions.length >= 5) break;
          }
        }

        // Parse riskFactors
        const riskFactors: string[] = [];
        if (Array.isArray(a.riskFactors)) {
          for (const rf of a.riskFactors) {
            if (typeof rf === 'string' && rf.trim().length > 0) {
              riskFactors.push(rf.trim().slice(0, 300));
            }
            if (riskFactors.length >= 5) break;
          }
        }

        analysis = {
          momentumAssessment,
          keyDrivers: keyDrivers.length > 0 ? keyDrivers : baselineAnalysis.keyDrivers,
          sustainabilityScore: Math.round(sustainabilityScoreClamped),
          momentumForecast,
          momentumActions: momentumActions.length > 0 ? momentumActions : baselineAnalysis.momentumActions,
          riskFactors: riskFactors.length > 0 ? riskFactors : baselineAnalysis.riskFactors,
        };

        // Build summary from analysis
        summary = `${momentumStatus} (growth ${profitGrowthRate.toFixed(1)}%, accel ${profitAcceleration.toFixed(1)}%). ${analysis.momentumAssessment} Sustainability ${analysis.sustainabilityScore}/100.`;

        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/profit-momentum-tracker',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        analysis,
        summary,
      });
    }

    return NextResponse.json({
      ok: true,
      momentum,
      drivers,
      analysis,
      summary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error('/api/ai/profit-momentum-tracker', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
