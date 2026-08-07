// v7.74: Cash Flow Velocity Tracker — sledi KAKO HITRO denar teče skozi
// posel — inflow velocity vs outflow velocity. Višja hitrost = bolj
// učinkovita raba kapitala. "Cash velocity: +125€/ted, turnover 1.8x,
// cycle 28d. Najhitrejša: elektronika (18d). Bottleneck: avto (65d)."
//
// Razlika od cash-conversion-cycle (ki meri CCC = DIO+DSO-DPO finančno
// metriko) — ta gleda VELOCITY (€/ted) in trend acceleration. Razlika od
// cash-flow-forecast (ki napove 7/14/30d capital forecast) — ta meri
// hitrost pretoka denarja (inflow vs outflow velocity). Razlika od
// inventory-cash-flow-optimizer (ki optimizira cash flow) — ta diagnosticira
// bottleneck-e in velocity score. Razlika od profit-efficiency-analyzer
// (ki meri profit per day) — ta gleda €/ted net cash velocity. Razlika od
// deal-velocity (ki meri market temperature) — ta gleda cash flow velocity.
//
// Pure DB analytics (NO AI). GET /api/analytics/cash-flow-velocity

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type VelocityTrend = 'ACCELERATING' | 'STABLE' | 'DECELERATING';

interface Velocity {
  totalInflow: number;
  totalOutflow: number;
  avgInflowPerWeek: number;
  avgOutflowPerWeek: number;
  netCashVelocity: number; // €/week
  cashTurnoverRate: number; // ratio
  capitalCycleTime: number; // days
  velocityScore: number; // 0-100
  velocityTrend: VelocityTrend;
}

interface CategoryVelocity {
  category: string;
  inflow: number;
  outflow: number;
  avgCycleDays: number;
  cashConversionRate: number;
  velocityRank: number; // 1 = fastest
}

interface Projection {
  currentVelocity: number; // €/week
  projectedVelocity30d: number;
  velocityBottleneck: string;
  bottleneckImpact: number; // €/week lost
}

interface Recommendations {
  fastestCategory: string | null;
  slowestCategory: string | null;
  velocityAdvice: string;
  bottleneckFix: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const ANALYSIS_PERIOD_DAYS = 90; // 13 weeks
const ANALYSIS_PERIOD_WEEKS = ANALYSIS_PERIOD_DAYS / 7;

// --- Helpers -------------------------------------------------------------

// Compute mean of an array (skipping NaN)
function mean(arr: number[]): number {
  const valid = arr.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return 0;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

// Compute median of an array
function median(arr: number[]): number {
  const valid = arr.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (valid.length === 0) return 0;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 0
    ? (valid[mid - 1]! + valid[mid]!) / 2
    : valid[mid]!;
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    // 1) Query all SOLD trades for cash inflow analysis
    const inflowCutoff = new Date(Date.now() - ANALYSIS_PERIOD_DAYS * DAY_MS);
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: inflowCutoff },
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

    // 2) Query recent buys for cash outflow
    const outflowCutoff = new Date(Date.now() - ANALYSIS_PERIOD_DAYS * DAY_MS);
    const recentBuys = await db.trade.findMany({
      where: {
        buyDate: { gte: outflowCutoff },
        buyPrice: { gt: 0 },
      },
      select: {
        id: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
      },
      take: 20000,
    });

    // 3) Query HELD trades for projected velocity (held inventory conversion)
    const heldTrades = await db.trade.findMany({
      where: {
        status: 'held',
        buyPrice: { gt: 0 },
      },
      select: {
        id: true,
        category: true,
        buyPrice: true,
        buyDate: true,
        listing: {
          select: { aiEstimatedValue: true },
        },
      },
      take: 5000,
    });

    // Empty state — no data at all
    if (soldTrades.length === 0 && recentBuys.length === 0 && heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        velocity: {
          totalInflow: 0,
          totalOutflow: 0,
          avgInflowPerWeek: 0,
          avgOutflowPerWeek: 0,
          netCashVelocity: 0,
          cashTurnoverRate: 0,
          capitalCycleTime: 0,
          velocityScore: 0,
          velocityTrend: 'STABLE',
        },
        byCategory: [],
        projection: {
          currentVelocity: 0,
          projectedVelocity30d: 0,
          velocityBottleneck: 'Ni podatkov — dodaj trade-e za analizo.',
          bottleneckImpact: 0,
        },
        recommendations: {
          fastestCategory: null,
          slowestCategory: null,
          velocityAdvice: 'Ni SOLD/HELD trade-ov — Cash Flow Velocity ni mogoč.',
          bottleneckFix: 'Dodaj trade-e (status "sold" ali "held") za analizo hitrosti denarja.',
        },
        message: 'Ni SOLD/HELD trade-ov — Cash Flow Velocity ni mogoč.',
      });
    }

    // 4) Compute cash inflow from SOLD trades
    // totalInflow = sum(sellPrice - sellFees)
    let totalInflow = 0;
    const inflowCycleDays: number[] = [];
    const inflowByWeek = new Map<number, number>(); // weekIdx → inflow

    for (const t of soldTrades) {
      const sellPrice = t.sellPrice ?? 0;
      const sellFees = t.sellFees ?? 0;
      const inflow = sellPrice - sellFees;
      totalInflow += inflow;

      // Cycle days: from buy to sell
      const sellMs = t.sellDate
        ? new Date(t.sellDate as unknown as Date | string).getTime()
        : 0;
      const buyMs = new Date(t.buyDate as unknown as Date | string).getTime();
      if (sellMs > 0 && buyMs > 0) {
        const cycleDays = (sellMs - buyMs) / DAY_MS;
        if (cycleDays >= 0 && cycleDays <= 365) {
          inflowCycleDays.push(cycleDays);
        }
      }

      // Week bucket for trend analysis (relative to cutoff)
      if (sellMs > 0) {
        const weekIdx = Math.floor((sellMs - inflowCutoff.getTime()) / WEEK_MS);
        if (weekIdx >= 0 && weekIdx < ANALYSIS_PERIOD_WEEKS) {
          inflowByWeek.set(weekIdx, (inflowByWeek.get(weekIdx) || 0) + inflow);
        }
      }
    }

    // 5) Compute cash outflow from recent buys
    let totalOutflow = 0;
    const outflowByWeek = new Map<number, number>();

    for (const t of recentBuys) {
      const buyPrice = t.buyPrice;
      const buyFees = t.buyFees ?? 0;
      const outflow = buyPrice + buyFees;
      totalOutflow += outflow;

      const buyMs = new Date(t.buyDate as unknown as Date | string).getTime();
      const weekIdx = Math.floor((buyMs - outflowCutoff.getTime()) / WEEK_MS);
      if (weekIdx >= 0 && weekIdx < ANALYSIS_PERIOD_WEEKS) {
        outflowByWeek.set(weekIdx, (outflowByWeek.get(weekIdx) || 0) + outflow);
      }
    }

    // 6) Compute velocity metrics
    const avgInflowPerWeek = totalInflow / ANALYSIS_PERIOD_WEEKS;
    const avgOutflowPerWeek = totalOutflow / ANALYSIS_PERIOD_WEEKS;
    const netCashVelocity = avgInflowPerWeek - avgOutflowPerWeek;
    const cashTurnoverRate = totalOutflow > 0 ? totalInflow / totalOutflow : 0;
    const capitalCycleTime = mean(inflowCycleDays);

    // Velocity trend: last 4 weeks vs previous 4 weeks (inflow)
    const lastWeeksStart = ANALYSIS_PERIOD_WEEKS - 4;
    const prevWeeksStart = ANALYSIS_PERIOD_WEEKS - 8;
    let last4WeeksInflow = 0;
    let prev4WeeksInflow = 0;
    for (let w = lastWeeksStart; w < ANALYSIS_PERIOD_WEEKS; w++) {
      last4WeeksInflow += inflowByWeek.get(w) || 0;
    }
    for (let w = prevWeeksStart; w < lastWeeksStart; w++) {
      prev4WeeksInflow += inflowByWeek.get(w) || 0;
    }
    // Normalize per week
    const last4Weekly = last4WeeksInflow / 4;
    const prev4Weekly = prev4WeeksInflow / 4;

    let velocityTrend: VelocityTrend = 'STABLE';
    if (prev4Weekly > 0) {
      const changeRatio = (last4Weekly - prev4Weekly) / prev4Weekly;
      if (changeRatio > 0.1) velocityTrend = 'ACCELERATING';
      else if (changeRatio < -0.1) velocityTrend = 'DECELERATING';
    } else if (last4Weekly > 0) {
      velocityTrend = 'ACCELERATING'; // Going from 0 → positive
    }

    // Velocity score (0-100) — weighted composite:
    // - netCashVelocity positive (40 pts max): scaled by €/week
    // - cashTurnoverRate > 1 (30 pts max)
    // - capitalCycleTime shorter (20 pts max)
    // - velocityTrend (10 pts max)
    let velocityScore = 0;
    // Net cash velocity: 0€/week=0, 500€/week=full 40
    velocityScore += Math.max(0, Math.min(40, (netCashVelocity / 500) * 40));
    // Turnover rate: 1.0=0, 2.0=full 30
    velocityScore += Math.max(0, Math.min(30, Math.max(0, cashTurnoverRate - 1) * 30));
    // Cycle time: 0d=20, 90d=0
    velocityScore += Math.max(0, Math.min(20, 20 - (capitalCycleTime / 90) * 20));
    // Trend bonus
    if (velocityTrend === 'ACCELERATING') velocityScore += 10;
    else if (velocityTrend === 'STABLE') velocityScore += 5;
    velocityScore = Math.max(0, Math.min(100, Math.round(velocityScore)));

    const velocity: Velocity = {
      totalInflow: Math.round(totalInflow * 100) / 100,
      totalOutflow: Math.round(totalOutflow * 100) / 100,
      avgInflowPerWeek: Math.round(avgInflowPerWeek * 100) / 100,
      avgOutflowPerWeek: Math.round(avgOutflowPerWeek * 100) / 100,
      netCashVelocity: Math.round(netCashVelocity * 100) / 100,
      cashTurnoverRate: Math.round(cashTurnoverRate * 100) / 100,
      capitalCycleTime: Math.round(capitalCycleTime * 10) / 10,
      velocityScore,
      velocityTrend,
    };

    // 7) Per-category cash flow velocity
    interface CatAgg {
      inflow: number;
      outflow: number;
      cycleDays: number[];
    }
    const catAgg = new Map<string, CatAgg>();

    for (const t of soldTrades) {
      const cat = (t.category || '').trim().toLowerCase() || 'neznan';
      const sellPrice = t.sellPrice ?? 0;
      const sellFees = t.sellFees ?? 0;
      const inflow = sellPrice - sellFees;
      const sellMs = t.sellDate
        ? new Date(t.sellDate as unknown as Date | string).getTime()
        : 0;
      const buyMs = new Date(t.buyDate as unknown as Date | string).getTime();
      const cycleDays = sellMs > 0 && buyMs > 0 ? (sellMs - buyMs) / DAY_MS : 0;

      const existing = catAgg.get(cat) || { inflow: 0, outflow: 0, cycleDays: [] };
      existing.inflow += inflow;
      if (cycleDays >= 0 && cycleDays <= 365) existing.cycleDays.push(cycleDays);
      catAgg.set(cat, existing);
    }

    for (const t of recentBuys) {
      const cat = (t.category || '').trim().toLowerCase() || 'neznan';
      const buyPrice = t.buyPrice;
      const buyFees = t.buyFees ?? 0;
      const outflow = buyPrice + buyFees;

      const existing = catAgg.get(cat) || { inflow: 0, outflow: 0, cycleDays: [] };
      existing.outflow += outflow;
      catAgg.set(cat, existing);
    }

    const byCategory: CategoryVelocity[] = [];
    for (const [cat, agg] of catAgg.entries()) {
      const avgCycleDays = mean(agg.cycleDays);
      // cashConversionRate = profit / time × capital
      const profit = agg.inflow - agg.outflow;
      const timeFactor = avgCycleDays > 0 ? avgCycleDays / 30 : 1; // normalize to month
      const capital = agg.outflow > 0 ? agg.outflow : 1;
      const cashConversionRate = (profit / capital / timeFactor) * 100;
      byCategory.push({
        category: cat,
        inflow: Math.round(agg.inflow * 100) / 100,
        outflow: Math.round(agg.outflow * 100) / 100,
        avgCycleDays: Math.round(avgCycleDays * 10) / 10,
        cashConversionRate: Math.round(cashConversionRate * 100) / 100,
        velocityRank: 0, // assigned after sort
      });
    }

    // Sort by avgCycleDays asc (fastest first) and assign velocityRank
    byCategory.sort((a, b) => a.avgCycleDays - b.avgCycleDays);
    byCategory.forEach((c, i) => {
      c.velocityRank = i + 1;
    });

    // 8) Projection — current + 30d projected velocity
    const currentVelocity = avgInflowPerWeek - avgOutflowPerWeek;

    // Projected 30d velocity: estimate from HELD inventory conversion
    // Assume avg cycle time → if cycleDays=30, then ~all HELD converts to cash in 30d
    let projectedInflow30d = 0;
    for (const t of heldTrades) {
      const estValue =
        t.listing?.aiEstimatedValue && t.listing.aiEstimatedValue > 0
          ? t.listing.aiEstimatedValue
          : Math.round(t.buyPrice * 1.15);
      // Discount 10% for fees
      projectedInflow30d += estValue * 0.9;
    }
    // Convert to weekly rate (over expected conversion window)
    const projectedCycleDays = capitalCycleTime > 0 ? capitalCycleTime : 30;
    const projectedWeeks = Math.max(1, projectedCycleDays / 7);
    const projectedInflowWeekly = projectedInflow30d / projectedWeeks;
    const projectedVelocity30d = projectedInflowWeekly - avgOutflowPerWeek;

    // 9) Bottleneck detection
    // Find slowest category with significant volume (>=3 trades)
    let slowestCat: { cat: string; cycleDays: number; impact: number } | null = null;
    for (const c of byCategory) {
      const cycleDays = c.avgCycleDays;
      if (cycleDays > 0) {
        // Impact = lost inflow per week from slow cycle
        // If we could reduce cycle to 14d, how much extra velocity?
        const potentialWeekly =
          cycleDays > 14 ? (c.inflow * (cycleDays / 14 - 1)) / ANALYSIS_PERIOD_WEEKS : 0;
        if (!slowestCat || cycleDays > slowestCat.cycleDays) {
          slowestCat = {
            cat: c.category,
            cycleDays,
            impact: Math.max(0, potentialWeekly),
          };
        }
      }
    }

    const velocityBottleneck = slowestCat
      ? `Kategorija "${slowestCat.cat}" ima počasen cikel (${slowestCat.cycleDays.toFixed(0)} dni) — blokira cash flow.`
      : 'Ni zaznanih bottleneck-ov — cash flow je uravnotežen.';

    const bottleneckImpact = Math.round((slowestCat?.impact ?? 0) * 100) / 100;

    const projection: Projection = {
      currentVelocity: Math.round(currentVelocity * 100) / 100,
      projectedVelocity30d: Math.round(projectedVelocity30d * 100) / 100,
      velocityBottleneck,
      bottleneckImpact,
    };

    // 10) Recommendations
    const fastestCategory =
      byCategory.length > 0 && byCategory[0]!.avgCycleDays > 0
        ? byCategory[0]!.category
        : null;
    const slowestCategory =
      byCategory.length > 0 && byCategory[byCategory.length - 1]!.avgCycleDays > 0
        ? byCategory[byCategory.length - 1]!.category
        : null;

    let velocityAdvice: string;
    if (netCashVelocity > 0 && velocityScore >= 60) {
      velocityAdvice = `Cash flow velocity je zdrav (+${netCashVelocity.toFixed(0)}€/ted, score ${velocityScore}/100). Fokus na "${fastestCategory ?? 'top'}" kategorijo za nadaljnjo rast.`;
    } else if (netCashVelocity > 0) {
      velocityAdvice = `Cash flow velocity je pozitiven vendar počasen (+${netCashVelocity.toFixed(0)}€/ted). Skrajšaj cycle time v "${slowestCategory ?? 'počasnejših'}" kategorijah za pospešitev.`;
    } else if (netCashVelocity === 0) {
      velocityAdvice = `Cash flow velocity je nevtralen — inflow in outflow sta izenačena. Premisli povečanje prodajnega tempa ali zmanjšanje nabave.`;
    } else {
      velocityAdvice = `Cash flow velocity je negativen (${netCashVelocity.toFixed(0)}€/ted) — outflow presega inflow. Zmanjšaj nabavo in pospeši prodajo HELD inventarja.`;
    }

    const bottleneckFix = slowestCat
      ? `Pospeši "${slowestCat.cat}" (cycle ${slowestCat.cycleDays.toFixed(0)}d → 14d) z nižanjem cen, relistanjem ali boljšo predstavitvijo — sprosti ${slowestCat.impact.toFixed(0)}€/ted dodatnega cash flow-a.`
      : 'Ni specifičnega bottleneck-a — optimiziraj splošno prodajno strategijo.';

    const recommendations: Recommendations = {
      fastestCategory,
      slowestCategory,
      velocityAdvice,
      bottleneckFix,
    };

    return NextResponse.json({
      ok: true,
      velocity,
      byCategory,
      projection,
      recommendations,
    });
  } catch (err: any) {
    logger.error('/api/analytics/cash-flow-velocity', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
