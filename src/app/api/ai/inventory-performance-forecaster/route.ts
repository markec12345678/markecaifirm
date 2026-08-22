// v7.86 / v8.96.9-final2: AI Inventory Performance Forecaster — AI napove PORTFOLIO-level
// PERFORMANCE celotnega inventarja za naslednje 30/60/90 dni — projected
// profit, turnover, capital efficiency. Razlika od individual item forecasters
// (ki napovedujejo posamezne item-e) — ta je PORTFOLIO-level prediction.
// "Inventory: 8 items, 2400€ invested, estValue 3100€. 30d forecast: +450€
// profit. Grade: B. Action: sell 2 aging items → grade A."
//
// Razlika od inventory-profit-maximizer (ki optimira profit za posamezne
// item-e) — ta forecast-a PORTFOLIO-level profit 30/60/90 dni. Razlika od
// inventory-value-tracker (v7.81 ki track-a current value) — ta napove
// FUTURE performance z projectedProfit in grade. Razlika od
// inventory-value-predictor (v7.73 ki predict-a future value) — ta gleda
// PERFORMANCE (profit + sell rate + capital efficiency) ne samo value.
// Razlika od inventory-aging-predictor-pro (v7.83 ki predict-a aging risk)
// — ta forecast-a PROFIT/turnover/capital efficiency ne aging. Razlika od
// profit-margin-forecaster-pro (v7.85 ki forecast-a margin) — ta gleda
// PORTFOLIO profit v EUR + performance grade ne margin %. Razlika od
// trade-performance-forecaster (ki forecast-a trade performance) — ta je
// INVENTORY-focused z current inventory composition.
//
// GET+POST /api/ai/inventory-performance-forecaster
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.9) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type PerformanceGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
type DriverImpact = 'POSITIVE' | 'NEGATIVE';
type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

interface InventoryComposition {
  totalItems: number;
  totalInvested: number;
  totalEstValue: number;
  categoryDistribution: Array<{ category: string; percentage: number }>;
  avgDealScore: number;
  avgDaysHeld: number;
}

interface HistoricalBaseline {
  avgProfitPerItem: number;
  avgHoldDays: number;
  avgROI: number; // %
  sellRatePerWeek: number;
}

interface PerformanceForecast {
  projectedProfit30d: number;
  projectedProfit60d: number;
  projectedProfit90d: number;
  projectedSellRate30d: number; // items per week
  projectedCapitalEfficiency: number; // projected ROI %
  projectedTurnoverRate: number; // inventory turns per year
  confidenceLevel: number; // 0-100
  projectedPerformanceGrade: PerformanceGrade;
}

interface PerformanceFactor {
  factor: string;
  impact: DriverImpact;
  weight: number; // 0-100
  detail: string;
}

interface PerformanceRisk {
  risk: string;
  severity: RiskSeverity;
  mitigation: string;
}

interface PerformanceAction {
  action: string;
  priority: ActionPriority;
  expectedImpact: string;
}

interface PerformanceAnalysis {
  performanceFactors: PerformanceFactor[];
  performanceRisks: PerformanceRisk[];
  performanceActions: PerformanceAction[];
}

interface AiPerformanceResponse {
  forecast?: unknown;
  analysis?: unknown;
  summary?: unknown;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const HORIZON_30D = 30 * DAY_MS;
const PROFIT_MIN = 0;
const CONFIDENCE_MIN = 0;
const CONFIDENCE_MAX = 100;

const VALID_GRADES: readonly PerformanceGrade[] = [
  'A+',
  'A',
  'B',
  'C',
  'D',
  'F',
];
const VALID_IMPACT: readonly DriverImpact[] = ['POSITIVE', 'NEGATIVE'];
const VALID_SEVERITY: readonly RiskSeverity[] = ['LOW', 'MEDIUM', 'HIGH'];
const VALID_PRIORITY: readonly ActionPriority[] = ['HIGH', 'MEDIUM', 'LOW'];

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
  // Special case: A+ grade (since + is stripped by regex)
  if (s === 'A+' || s === 'A_PLUS') return 'A+' as T;
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

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = avg(values);
  const variance =
    values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / values.length;
  return Math.sqrt(variance);
}

// Map performance score (0-100) to grade
function scoreToGrade(score: number): PerformanceGrade {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// --- Trade row ----------------------------------------------------------

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyDate: Date;
  listing: {
    dealScore: number | null;
    aiEstimatedValue: number | null;
    aiVerdict: string | null;
  } | null;
}

interface SoldTradeRow {
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
}

// --- Deterministic forecast ---------------------------------------------

// Compute historical performance baseline from SOLD trades last 12 months
function computeHistoricalBaseline(
  soldTrades: SoldTradeRow[],
  now: number,
): HistoricalBaseline {
  const cutoff = now - HORIZON_12M;
  const cutoff30d = now - HORIZON_30D;

  let totalProfit = 0;
  let totalInvested = 0;
  let totalHoldDays = 0;
  let holdCount = 0;
  let sold30d = 0;

  for (const t of soldTrades) {
    const sellMs = toMs(t.sellDate);
    const buyMs = toMs(t.buyDate);
    if (sellMs <= 0 || sellMs < cutoff) continue;
    const invested = (t.buyPrice ?? 0) + (t.buyFees ?? 0);
    const proceeds = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    const profit = proceeds - invested;
    totalProfit += profit;
    totalInvested += invested;
    if (buyMs > 0 && sellMs > buyMs) {
      const holdDays = (sellMs - buyMs) / DAY_MS;
      if (holdDays > 0 && holdDays < 3650) {
        totalHoldDays += holdDays;
        holdCount += 1;
      }
    }
    if (sellMs >= cutoff30d) sold30d += 1;
  }

  const itemCount = soldTrades.length;
  const avgProfitPerItem = itemCount > 0 ? totalProfit / itemCount : 0;
  const avgHoldDays = holdCount > 0 ? totalHoldDays / holdCount : 0;
  const avgROI = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
  // Sell rate per week (12 months = ~52 weeks)
  const sellRatePerWeek = itemCount > 0 ? itemCount / 52 : 0;

  return {
    avgProfitPerItem: round0(avgProfitPerItem),
    avgHoldDays: round1(avgHoldDays),
    avgROI: round1(avgROI),
    sellRatePerWeek: round2(sellRatePerWeek),
  };
}

// Compute current inventory composition
function computeInventoryComposition(
  heldTrades: HeldTradeRow[],
  now: number,
): InventoryComposition {
  if (heldTrades.length === 0) {
    return {
      totalItems: 0,
      totalInvested: 0,
      totalEstValue: 0,
      categoryDistribution: [],
      avgDealScore: 0,
      avgDaysHeld: 0,
    };
  }

  let totalInvested = 0;
  let totalEstValue = 0;
  let dealScoreSum = 0;
  let dealScoreCount = 0;
  let daysHeldSum = 0;
  const catMap = new Map<string, number>();

  for (const t of heldTrades) {
    totalInvested += t.buyPrice ?? 0;
    const estValue = t.listing?.aiEstimatedValue ?? null;
    if (estValue != null && estValue > 0) {
      totalEstValue += estValue;
    } else {
      // Fallback: use buyPrice as estimate if no AI value
      totalEstValue += t.buyPrice ?? 0;
    }
    const ds = t.listing?.dealScore ?? null;
    if (ds != null) {
      dealScoreSum += ds;
      dealScoreCount += 1;
    }
    const buyMs = toMs(t.buyDate);
    if (buyMs > 0 && now > buyMs) {
      daysHeldSum += (now - buyMs) / DAY_MS;
    }
    const cat = (t.category ?? '').trim().toLowerCase() || 'brez_kategorije';
    catMap.set(cat, (catMap.get(cat) ?? 0) + 1);
  }

  const total = heldTrades.length;
  const categoryDistribution = Array.from(catMap.entries())
    .map(([category, count]) => ({
      category,
      percentage: round1((count / total) * 100),
    }))
    .sort((a, b) => b.percentage - a.percentage);

  return {
    totalItems: total,
    totalInvested: round0(totalInvested),
    totalEstValue: round0(totalEstValue),
    categoryDistribution,
    avgDealScore: dealScoreCount > 0 ? round1(dealScoreSum / dealScoreCount) : 0,
    avgDaysHeld: round1(daysHeldSum / total),
  };
}

// Deterministic forecast (fallback when AI unavailable)
function buildDeterministicForecast(
  inventory: InventoryComposition,
  historical: HistoricalBaseline,
): PerformanceForecast {
  const { totalItems, totalInvested, totalEstValue, avgDealScore, avgDaysHeld } = inventory;
  const { avgProfitPerItem, avgHoldDays, avgROI, sellRatePerWeek } = historical;

  // Projected sell rate: use historical sell rate, scaled by inventory size + dealScore
  // Higher avgDealScore → faster sells
  const dealScoreBoost = avgDealScore > 60 ? 1.2 : avgDealScore > 40 ? 1.0 : 0.7;
  const projectedSellRate30d = round2(
    Math.max(0, sellRatePerWeek * dealScoreBoost),
  );

  // Projected profit:
  // - 30d = sellRate30d × 4 weeks × avgProfitPerItem, clamped to [0, totalEstValue × 0.5]
  // - 60d = 30d × ~1.8 (diminishing)
  // - 90d = 30d × ~2.4
  const profitCap30d = totalEstValue * 0.5;
  const profitCap60d = totalEstValue * 0.5 * 1.8;
  const profitCap90d = totalEstValue * 0.5 * 2.4;

  const base30d = projectedSellRate30d * 4 * avgProfitPerItem;
  const projectedProfit30d = round0(
    Math.max(PROFIT_MIN, Math.min(profitCap30d, base30d)),
  );
  const projectedProfit60d = round0(
    Math.max(PROFIT_MIN, Math.min(profitCap60d, base30d * 1.8)),
  );
  const projectedProfit90d = round0(
    Math.max(PROFIT_MIN, Math.min(profitCap90d, base30d * 2.4)),
  );

  // Projected capital efficiency = projected ROI %
  const projectedCapitalEfficiency =
    totalInvested > 0
      ? round1(((projectedProfit90d / totalInvested) * 100) + avgROI * 0.5)
      : 0;

  // Projected turnover rate (inventory turns per year)
  // = projectedSellRate30d × 52 weeks / totalItems
  const projectedTurnoverRate =
    totalItems > 0 ? round2((projectedSellRate30d * 52) / totalItems) : 0;

  // Confidence: based on historical data sample size + inventory size
  let confidence = 50;
  // Boost confidence with more historical data
  if (avgProfitPerItem > 0) confidence += 10;
  if (avgHoldDays > 0) confidence += 5;
  if (sellRatePerWeek > 0) confidence += 10;
  // Boost confidence with more inventory items
  if (totalItems >= 5) confidence += 10;
  if (totalItems >= 15) confidence += 5;
  // Boost confidence with higher avgDealScore
  if (avgDealScore >= 70) confidence += 10;
  else if (avgDealScore >= 50) confidence += 5;
  // Penalize confidence for aged inventory
  if (avgDaysHeld > 60) confidence -= 10;
  if (avgDaysHeld > 90) confidence -= 5;
  confidence = Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX, confidence));

  // Performance score for grade: weighted composite
  // 30% projectedCapitalEfficiency (normalized: 0-50% = 0-100)
  // 25% projectedTurnoverRate (normalized: 0-10 turns = 0-100)
  // 20% avgDealScore (0-100 already)
  // 15% projectedProfit30d relative to invested (0-30% = 0-100)
  // 10% confidence
  const roiScore = Math.max(
    0,
    Math.min(100, (projectedCapitalEfficiency / 50) * 100),
  );
  const turnoverScore = Math.max(
    0,
    Math.min(100, (projectedTurnoverRate / 10) * 100),
  );
  const dealScore = avgDealScore;
  const profitScore =
    totalInvested > 0
      ? Math.max(0, Math.min(100, ((projectedProfit30d / totalInvested) * 100 / 30) * 100))
      : 0;
  const performanceScore =
    roiScore * 0.3 +
    turnoverScore * 0.25 +
    dealScore * 0.2 +
    profitScore * 0.15 +
    confidence * 0.1;

  const projectedPerformanceGrade = scoreToGrade(performanceScore);

  return {
    projectedProfit30d,
    projectedProfit60d,
    projectedProfit90d,
    projectedSellRate30d,
    projectedCapitalEfficiency,
    projectedTurnoverRate,
    confidenceLevel: round0(confidence),
    projectedPerformanceGrade,
  };
}

// Deterministic performance factors
function buildDeterministicFactors(
  inventory: InventoryComposition,
  historical: HistoricalBaseline,
  forecast: PerformanceForecast,
): PerformanceFactor[] {
  const factors: PerformanceFactor[] = [];
  const { totalItems, avgDealScore, avgDaysHeld, categoryDistribution } = inventory;
  const { avgProfitPerItem, avgROI, sellRatePerWeek } = historical;
  const { projectedCapitalEfficiency, projectedTurnoverRate } = forecast;

  if (avgDealScore >= 70) {
    factors.push({
      factor: 'Visok avgDealScore inventarja',
      impact: 'POSITIVE',
      weight: 75,
      detail: `Povprečni dealScore ${avgDealScore}/100 — inventar vsebuje visoko-kvalitetne deal-e z boljšim profit potencialom.`,
    });
  } else if (avgDealScore < 40 && totalItems > 0) {
    factors.push({
      factor: 'Nizek avgDealScore inventarja',
      impact: 'NEGATIVE',
      weight: 70,
      detail: `Povprečni dealScore ${avgDealScore}/100 — inventar je pretežno nizko-kvalitetnih deal-ov, nižji profit potencial.`,
    });
  }
  if (avgDaysHeld > 90 && totalItems > 0) {
    factors.push({
      factor: 'Star inventar (visok avgDaysHeld)',
      impact: 'NEGATIVE',
      weight: 70,
      detail: `Povprečno ${avgDaysHeld} dni v inventarju — items postajajo zastareli, tveganje depreciation.`,
    });
  } else if (avgDaysHeld < 30 && totalItems > 0) {
    factors.push({
      factor: 'Svež inventar (nizek avgDaysHeld)',
      impact: 'POSITIVE',
      weight: 55,
      detail: `Povprečno ${avgDaysHeld} dni v inventarju — items so sveži, dober turnover potencial.`,
    });
  }
  if (avgProfitPerItem > 0) {
    factors.push({
      factor: 'Pozitivna historical profitabilnost',
      impact: 'POSITIVE',
      weight: 65,
      detail: `Povprečni profit per item ${avgProfitPerItem}€ iz SOLD zgodovine — dober track record.`,
    });
  } else if (totalItems > 0 && historical.avgROI < 0) {
    factors.push({
      factor: 'Negativna historical profitabilnost',
      impact: 'NEGATIVE',
      weight: 80,
      detail: `Povprečni ROI ${avgROI}% iz SOLD zgodovine — inventory je bil v zgodovini neprofitabilen.`,
    });
  }
  if (sellRatePerWeek >= 1) {
    factors.push({
      factor: 'Visok historical sell rate',
      impact: 'POSITIVE',
      weight: 60,
      detail: `Sell rate ${sellRatePerWeek} item-ov/teden — zdrav turnover, projected sell rate ${forecast.projectedSellRate30d}.`,
    });
  } else if (sellRatePerWeek > 0 && sellRatePerWeek < 0.3) {
    factors.push({
      factor: 'Nizek historical sell rate',
      impact: 'NEGATIVE',
      weight: 55,
      detail: `Sell rate ${sellRatePerWeek} item-ov/teden — počasen turnover, projected capital efficiency ${projectedCapitalEfficiency}%.`,
    });
  }
  if (projectedTurnoverRate >= 5) {
    factors.push({
      factor: 'Visok projected turnover rate',
      impact: 'POSITIVE',
      weight: 60,
      detail: `Projected ${projectedTurnoverRate} inventory turns/leto — kapital se bo večkrat obrnil, višji profit.`,
    });
  } else if (projectedTurnoverRate < 2 && totalItems > 0) {
    factors.push({
      factor: 'Nizek projected turnover rate',
      impact: 'NEGATIVE',
      weight: 65,
      detail: `Projected ${projectedTurnoverRate} inventory turns/leto — počasen turnover, kapital zaklenjen.`,
    });
  }
  if (categoryDistribution.length > 0) {
    const topCat = categoryDistribution[0]!;
    if (topCat.percentage > 60) {
      factors.push({
        factor: 'Visoka koncentracija v eni kategoriji',
        impact: 'NEGATIVE',
        weight: 50,
        detail: `Top kategorija ${topCat.category} = ${topCat.percentage}% portfolija — diversifikacija priporočena.`,
      });
    } else if (categoryDistribution.length >= 3) {
      factors.push({
        factor: 'Diversificiran portfolio',
        impact: 'POSITIVE',
        weight: 45,
        detail: `${categoryDistribution.length} kategorij v inventarju, top kategorija ${topCat.percentage}% — dobra diversifikacija.`,
      });
    }
  }
  if (factors.length === 0) {
    factors.push({
      factor: 'Stabilna inventory performance',
      impact: 'POSITIVE',
      weight: 50,
      detail: 'Brez izrazitih pozitivnih ali negativnih dejavnikov.',
    });
  }
  factors.sort((a, b) => b.weight - a.weight);
  return factors.slice(0, 5);
}

// Deterministic performance risks
function buildDeterministicRisks(
  inventory: InventoryComposition,
  historical: HistoricalBaseline,
  forecast: PerformanceForecast,
): PerformanceRisk[] {
  const risks: PerformanceRisk[] = [];
  const { totalItems, avgDaysHeld, avgDealScore } = inventory;
  const { avgProfitPerItem, sellRatePerWeek } = historical;

  if (avgDaysHeld > 90 && totalItems > 0) {
    risks.push({
      risk: 'Star inventar — tveganje depreciation',
      severity: 'HIGH',
      mitigation: 'Takojšnja akcija: znižaj cene ali liquidate stare items (>90d).',
    });
  }
  if (avgDealScore < 40 && totalItems > 0) {
    risks.push({
      risk: 'Nizka kvaliteta inventarja',
      severity: 'HIGH',
      mitigation: 'Premakni fokus na višje-dealScore item-e v naslednjih nakupih.',
    });
  }
  if (avgProfitPerItem < 0 && totalItems > 0) {
    risks.push({
      risk: 'Negativna historical profitabilnost',
      severity: 'HIGH',
      mitigation: 'Revizija pricing strategije — zgodovinski ROI je negativen.',
    });
  }
  if (sellRatePerWeek < 0.3 && totalItems > 5) {
    risks.push({
      risk: 'Počasen turnover',
      severity: 'MEDIUM',
      mitigation: 'Povečaj marketing ali znižaj cene za hitrejši turnover.',
    });
  }
  if (forecast.projectedCapitalEfficiency < 10 && totalItems > 0) {
    risks.push({
      risk: 'Nizka projected capital efficiency',
      severity: 'MEDIUM',
      mitigation: 'Premakni kapital v višje-margin kategorije ali优化 pricing.',
    });
  }
  if (risks.length === 0) {
    risks.push({
      risk: 'Brez izrazitih tveganj',
      severity: 'LOW',
      mitigation: 'Vzdržuj trenutno strategijo in monitor performance čez 30 dni.',
    });
  }
  return risks.slice(0, 4);
}

// Deterministic performance actions
function buildDeterministicActions(
  inventory: InventoryComposition,
  forecast: PerformanceForecast,
): PerformanceAction[] {
  const actions: PerformanceAction[] = [];
  const { totalItems, avgDaysHeld, avgDealScore } = inventory;
  const { projectedPerformanceGrade, projectedCapitalEfficiency } = forecast;

  if (avgDaysHeld > 60 && totalItems > 0) {
    actions.push({
      action: 'Prodaj ali znižaj cene starejšim item-om (>60d)',
      priority: 'HIGH',
      expectedImpact: `Povečan turnover, projected grade ${projectedPerformanceGrade} → višja (če se stari items proda)`,
    });
  }
  if (avgDealScore < 50 && totalItems > 0) {
    actions.push({
      action: 'Premakni fokus na višje-dealScore item-e v naslednjih nakupih',
      priority: 'HIGH',
      expectedImpact: 'Višji povprečni profit per item, boljša performance dolgoročno',
    });
  }
  if (projectedCapitalEfficiency < 15 && totalItems > 0) {
    actions.push({
      action: 'Optimiziraj pricing za povečanje ROI',
      priority: 'MEDIUM',
      expectedImpact: `Povečan projected capital efficiency z +5-10% (od ${projectedCapitalEfficiency}%)`,
    });
  }
  if (projectedPerformanceGrade === 'F' || projectedPerformanceGrade === 'D') {
    actions.push({
      action: 'Revizija celotne inventory strategije',
      priority: 'HIGH',
      expectedImpact: 'Re-evaluate sourcing, pricing in kategorije za višjo performance',
    });
  }
  if (totalItems < 5) {
    actions.push({
      action: 'Povečaj inventory volumen za boljšo diversifikacijo',
      priority: 'MEDIUM',
      expectedImpact: 'Manjši vpliv posameznega item-a na portfolio performance',
    });
  }
  if (actions.length === 0) {
    actions.push({
      action: 'Vzdržuj trenutno strategijo in monitor performance',
      priority: 'LOW',
      expectedImpact: 'Stabilna performance, projected grade ohranjena',
    });
  }
  return actions.slice(0, 5);
}

// Deterministic summary
function buildDeterministicSummary(
  inventory: InventoryComposition,
  forecast: PerformanceForecast,
): string {
  if (inventory.totalItems === 0) {
    return 'Ni HELD inventarja — Inventory Performance Forecaster ni mogoč.';
  }
  const { totalItems, totalInvested, totalEstValue } = inventory;
  const { projectedProfit30d, projectedPerformanceGrade, confidenceLevel } = forecast;
  return `Inventar: ${totalItems} item-ov, ${totalInvested}€ investirano, estValue ${totalEstValue}€. 30d forecast: +${projectedProfit30d}€ profit. Grade: ${projectedPerformanceGrade}. Confidence: ${confidenceLevel}%.`;
}

// --- Input ---------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InventoryPerformanceForecasterInput {}

// --- Handler -------------------------------------------------------------

const inventoryPerformanceForecasterHandler = withAiRoute<InventoryPerformanceForecasterInput>({
  endpoint: '/api/ai/inventory-performance-forecaster',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // GET+POST — body ignored

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — body ignored
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    const now = Date.now();
    const cutoff12m = new Date(now - HORIZON_12M);

    // 1) Query HELD trades with linked Listing (for aiEstimatedValue + dealScore)
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
            dealScore: true,
            aiEstimatedValue: true,
            aiVerdict: true,
          },
        },
      },
      orderBy: { buyDate: 'asc' },
      take: 100000,
    });

    // 2) Query SOLD trades for historical performance baseline
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
      },
      select: {
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    });

    const heldRows = heldTrades as unknown as HeldTradeRow[];
    const soldRows = soldTrades as unknown as SoldTradeRow[];

    // Compute inventory composition + historical baseline
    const inventory = computeInventoryComposition(heldRows, now);
    const historical = computeHistoricalBaseline(soldRows, now);

    // Empty state
    if (inventory.totalItems === 0) {
      return apiOk({
        ok: true,
        inventory,
        historical,
        forecast: {
          projectedProfit30d: 0,
          projectedProfit60d: 0,
          projectedProfit90d: 0,
          projectedSellRate30d: 0,
          projectedCapitalEfficiency: 0,
          projectedTurnoverRate: 0,
          confidenceLevel: 0,
          projectedPerformanceGrade: 'F',
        },
        analysis: {
          performanceFactors: [],
          performanceRisks: [],
          performanceActions: [],
        },
        summary:
          'Ni HELD inventarja — Inventory Performance Forecaster ni mogoč.',
        aiUsed: false,
        message:
          'Ni HELD inventarja — Inventory Performance Forecaster ni mogoč.',
      });
    }

    // Deterministic forecast (fallback)
    const detForecast = buildDeterministicForecast(inventory, historical);
    let forecast = detForecast;
    const detFactors = buildDeterministicFactors(inventory, historical, detForecast);
    const detRisks = buildDeterministicRisks(inventory, historical, detForecast);
    const detActions = buildDeterministicActions(inventory, detForecast);
    let analysis: PerformanceAnalysis = {
      performanceFactors: detFactors,
      performanceRisks: detRisks,
      performanceActions: detActions,
    };
    let finalSummary = buildDeterministicSummary(inventory, detForecast);

    // 3) AI cache check (6h TTL) — key by heldItemIds (sorted)
    const heldItemIds = heldRows.map((t) => t.id).sort();
    const cacheKey = `inventory-performance-forecaster:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<{
      forecast: PerformanceForecast;
      analysis: PerformanceAnalysis;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        inventory,
        historical,
        forecast: cached.forecast,
        analysis: cached.analysis,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 4) AI prompt with grounding

    // Cap profit ceiling at totalEstValue × 0.5 (anti-hallucination)
    const profitCap30d = inventory.totalEstValue * 0.5;
    const profitCap60d = profitCap30d * 1.8;
    const profitCap90d = profitCap30d * 2.4;

    const promptData = {
      inventory,
      historical,
      deterministicForecast: detForecast,
      profitCaps: { profitCap30d: round0(profitCap30d), profitCap60d: round0(profitCap60d), profitCap90d: round0(profitCap90d) },
    };

    const prompt = `Si AI "Inventory Performance Forecaster" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Napoveš PORTFOLIO-level PERFORMANCE celotnega inventarja za naslednje 30/60/90 dni — projected profit, sell rate, capital efficiency in performance grade.

DETERMINISTIČNI PODATKI (izračunano iz DB):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. forecast: {
   - projectedProfit30d: EUR, clamped [0, ${round0(profitCap30d)}], ±20% od deterministične (${detForecast.projectedProfit30d})
   - projectedProfit60d: EUR, clamped [0, ${round0(profitCap60d)}], ±20% od deterministične (${detForecast.projectedProfit60d})
   - projectedProfit90d: EUR, clamped [0, ${round0(profitCap90d)}], ±20% od deterministične (${detForecast.projectedProfit90d})
   - projectedSellRate30d: items/week, clamped [0, 20], ±30% od deterministične (${detForecast.projectedSellRate30d})
   - projectedCapitalEfficiency: % ROI, clamped [-30, 100], ±10 od deterministične (${detForecast.projectedCapitalEfficiency})
   - projectedTurnoverRate: turns/year, clamped [0, 30], ±2 od deterministične (${detForecast.projectedTurnoverRate})
   - confidenceLevel: 0-100, ±15 od deterministične (${detForecast.confidenceLevel})
   - projectedPerformanceGrade: A+ | A | B | C | D | F (validiraj proti enum)
}
2. analysis: {
   - performanceFactors: 3-5 z { factor (max 100), impact: POSITIVE|NEGATIVE, weight: 0-100, detail (max 250) }
     * Pozitivni dejavniki: visok avgDealScore, svež inventar, pozitivna historical profitabilnost, visok sell rate, dobra diversifikacija.
     * Negativni dejavniki: star inventar, nizek dealScore, negativna historical profitabilnost, počasen turnover, visoka koncentracija.
   - performanceRisks: 2-4 z { risk (max 100), severity: LOW|MEDIUM|HIGH, mitigation (max 250) }
   - performanceActions: 3-5 z { action (max 200), priority: HIGH|MEDIUM|LOW, expectedImpact (max 200) }
     * Akcije za izboljšanje projected performance (npr. "sell 2 aging items → grade A").
}
3. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi zgornje deterministične.

VRNI LE JSON:
{
  "forecast": {
    "projectedProfit30d": 450,
    "projectedProfit60d": 800,
    "projectedProfit90d": 1100,
    "projectedSellRate30d": 1.5,
    "projectedCapitalEfficiency": 18.5,
    "projectedTurnoverRate": 4.2,
    "confidenceLevel": 70,
    "projectedPerformanceGrade": "B"
  },
  "analysis": {
    "performanceFactors": [
      { "factor": "Visok avgDealScore", "impact": "POSITIVE", "weight": 75, "detail": "DealScore 72/100 — visoka kvaliteta." }
    ],
    "performanceRisks": [
      { "risk": "Star inventar", "severity": "HIGH", "mitigation": "Liquidate items >90d." }
    ],
    "performanceActions": [
      { "action": "Prodaj 2 aging items", "priority": "HIGH", "expectedImpact": "Grade B → A, turnover +30%" }
    ]
  },
  "summary": "Inventar: 8 item-ov, 2400€ investirano. 30d forecast: +450€ profit. Grade: B. Action: sell 2 aging items → grade A."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiPerformanceResponse | null;

      if (parsed && typeof parsed === 'object') {
        // 1) forecast override (with anti-hallucination)
        if (parsed.forecast && typeof parsed.forecast === 'object') {
          const f = parsed.forecast as Record<string, unknown>;

          if (f.projectedProfit30d != null) {
            const adj = clampNumber(f.projectedProfit30d, 0, profitCap30d, detForecast.projectedProfit30d);
            const aiAdj = Math.max(
              0,
              Math.min(
                profitCap30d,
                detForecast.projectedProfit30d + Math.max(-profitCap30d * 0.2, Math.min(profitCap30d * 0.2, adj - detForecast.projectedProfit30d)),
              ),
            );
            forecast.projectedProfit30d = round0(aiAdj);
          }
          if (f.projectedProfit60d != null) {
            const adj = clampNumber(f.projectedProfit60d, 0, profitCap60d, detForecast.projectedProfit60d);
            const aiAdj = Math.max(
              0,
              Math.min(
                profitCap60d,
                detForecast.projectedProfit60d + Math.max(-profitCap60d * 0.2, Math.min(profitCap60d * 0.2, adj - detForecast.projectedProfit60d)),
              ),
            );
            forecast.projectedProfit60d = round0(aiAdj);
          }
          if (f.projectedProfit90d != null) {
            const adj = clampNumber(f.projectedProfit90d, 0, profitCap90d, detForecast.projectedProfit90d);
            const aiAdj = Math.max(
              0,
              Math.min(
                profitCap90d,
                detForecast.projectedProfit90d + Math.max(-profitCap90d * 0.2, Math.min(profitCap90d * 0.2, adj - detForecast.projectedProfit90d)),
              ),
            );
            forecast.projectedProfit90d = round0(aiAdj);
          }
          if (f.projectedSellRate30d != null) {
            const adj = clampNumber(f.projectedSellRate30d, 0, 20, detForecast.projectedSellRate30d);
            const det = detForecast.projectedSellRate30d;
            const aiAdj = Math.max(
              0,
              Math.min(20, det + Math.max(-det * 0.3, Math.min(det * 0.3, adj - det))),
            );
            forecast.projectedSellRate30d = round2(aiAdj);
          }
          if (f.projectedCapitalEfficiency != null) {
            const adj = clampNumber(f.projectedCapitalEfficiency, -30, 100, detForecast.projectedCapitalEfficiency);
            forecast.projectedCapitalEfficiency = round1(
              Math.max(
                -30,
                Math.min(
                  100,
                  detForecast.projectedCapitalEfficiency + Math.max(-10, Math.min(10, adj - detForecast.projectedCapitalEfficiency)),
                ),
              ),
            );
          }
          if (f.projectedTurnoverRate != null) {
            const adj = clampNumber(f.projectedTurnoverRate, 0, 30, detForecast.projectedTurnoverRate);
            forecast.projectedTurnoverRate = round2(
              Math.max(
                0,
                Math.min(
                  30,
                  detForecast.projectedTurnoverRate + Math.max(-2, Math.min(2, adj - detForecast.projectedTurnoverRate)),
                ),
              ),
            );
          }
          if (f.confidenceLevel != null) {
            const adj = clampNumber(f.confidenceLevel, CONFIDENCE_MIN, CONFIDENCE_MAX, detForecast.confidenceLevel);
            forecast.confidenceLevel = round0(
              Math.max(
                CONFIDENCE_MIN,
                Math.min(
                  CONFIDENCE_MAX,
                  detForecast.confidenceLevel + Math.max(-15, Math.min(15, adj - detForecast.confidenceLevel)),
                ),
              ),
            );
          }
          if (f.projectedPerformanceGrade != null) {
            forecast.projectedPerformanceGrade = clampEnum(
              f.projectedPerformanceGrade,
              VALID_GRADES,
              detForecast.projectedPerformanceGrade,
            );
          }
        }

        // 2) analysis override
        if (parsed.analysis && typeof parsed.analysis === 'object') {
          const a = parsed.analysis as Record<string, unknown>;

          if (Array.isArray(a.performanceFactors)) {
            const aiFactors = (a.performanceFactors as unknown[])
              .map((d: unknown) => {
                const dr = d as Record<string, unknown>;
                if (!dr || typeof dr !== 'object') return null;
                const factor = clampString(dr.factor, 100, '');
                if (!factor) return null;
                const impact = clampEnum(dr.impact, VALID_IMPACT, 'POSITIVE');
                const weight = Math.max(0, Math.min(100, clampNumber(dr.weight, 0, 100, 50)));
                const detail = clampString(dr.detail, 250, '');
                if (!detail) return null;
                return { factor, impact, weight: round0(weight), detail };
              })
              .filter((d): d is PerformanceFactor => d !== null)
              .slice(0, 5);
            if (aiFactors.length > 0) analysis.performanceFactors = aiFactors;
          }

          if (Array.isArray(a.performanceRisks)) {
            const aiRisks = (a.performanceRisks as unknown[])
              .map((r: unknown) => {
                const rr = r as Record<string, unknown>;
                if (!rr || typeof rr !== 'object') return null;
                const risk = clampString(rr.risk, 100, '');
                if (!risk) return null;
                const severity = clampEnum(rr.severity, VALID_SEVERITY, 'MEDIUM');
                const mitigation = clampString(rr.mitigation, 250, '');
                if (!mitigation) return null;
                return { risk, severity, mitigation };
              })
              .filter((r): r is PerformanceRisk => r !== null)
              .slice(0, 4);
            if (aiRisks.length > 0) analysis.performanceRisks = aiRisks;
          }

          if (Array.isArray(a.performanceActions)) {
            const aiActions = (a.performanceActions as unknown[])
              .map((ac: unknown) => {
                const a2 = ac as Record<string, unknown>;
                if (!a2 || typeof a2 !== 'object') return null;
                const action = clampString(a2.action, 200, '');
                if (!action) return null;
                const priority = clampEnum(a2.priority, VALID_PRIORITY, 'MEDIUM');
                const expectedImpact = clampString(a2.expectedImpact, 200, '');
                if (!expectedImpact) return null;
                return { action, priority, expectedImpact };
              })
              .filter((ac): ac is PerformanceAction => ac !== null)
              .slice(0, 5);
            if (aiActions.length > 0) analysis.performanceActions = aiActions;
          }
        }

        // 3) summary
        if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
          finalSummary = clampString(parsed.summary, 400, buildDeterministicSummary(inventory, forecast));
        }

        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-performance-forecaster',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        forecast,
        analysis,
        summary: finalSummary,
      });
    }

    return apiOk({
      ok: true,
      inventory,
      historical,
      forecast,
      analysis,
      summary: finalSummary,
      aiUsed,
    });
  },
});

export const GET = inventoryPerformanceForecasterHandler;
export const POST = inventoryPerformanceForecasterHandler;
