// v7.99 / v8.96.6-batch2: AI Capital Growth Maximizer — AI maksimizira CAPITAL GROWTH — kako
// hitro kapital raste preko compounding reinvestment? Project-a optimal
// reinvestment strategy za maximum capital growth čez 6/12/24 mesecev. The
// "ultimate capital growth maximizer."
//
// Razlika od capital-allocation-optimizer (ki alokira kapital po kategorijah)
// — ta maksimizira COMPOUNDING GROWTH rate (ne allocation). Razlika od
// capital-efficiency-forecaster (ki forecast-a efficiency) — ta daje
// MAXIMIZATION plan z reinvestment strategy + compounding projection. Razlika
// od reinvestment-advisor (ki svetuje reinvestment) — ta KOMBINIRA growth
// rate maximization + compounding projection + time-to-double/10x forecast.
// Razlika od profit-growth-predictor (ki napove growth) — ta maksimizira
// growth z actionable levers (reinvestment rate, ROI per cycle, cycle speed).
// Razlika od capital-flow-analyzer (ki analizira flow) — ta daje MAX
// growth rate + compounding factor + double/10x timeline. Razlika od
// profit-velocity-maximizer (v7.98 ki maksimizira €/day velocity) — ta
// maksimizira COMPOUNDING growth rate (% per month, ne €/day). Razlika od
// inventory-cash-conversion-maximizer (v7.98 ki maksimizira cash conversion)
// — ta maksimizira CAPITAL GROWTH (kako kapital compounding-a v 6-24m).
// Razlika od deal-quality-profit-optimizer (v7.98 ki optimira quality-profit)
// — ta maksimizira compounding capital growth z reinvestment strategy.
//
// "Current capital: 4,250€ (cash 1,500€ + inventory 2,750€). Monthly growth:
// 8% (compounding factor 1.8x). MAXIMIZED: 14%/mo (1.8x → 2.6x). Projected:
// 6m: 9,300€, 12m: 20,400€, 24m: 98,500€ (grade A). Time to 2x: 5 months.
// Time to 10x: 17 months. Reinvest 75% / withdraw 25%. Risks: inventory
// saturation (HIGH — diversify categories), cash drag (MEDIUM — keep
// 30% liquid), market downturn (HIGH — hedging)."

// GET+POST /api/ai/capital-growth-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.6) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Input ----------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface CapitalGrowthMaximizerInput {}

// --- Types ---------------------------------------------------------------

type GrowthGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

interface SoldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
}

interface HeldTradeRow {
  id: string;
  buyPrice: number;
  listing: {
    aiEstimatedValue: number | null;
    price: number | null;
  } | null;
}

interface GrowthCurrent {
  currentCapital: number;
  avgMonthlyGrowthRate: number; // %
  compoundingFactor: number;
}

interface GrowthMaximizationLever {
  lever: string;
  currentGap: number;
  potentialGain: number;
  action: string;
}

interface OptimalReinvestmentStrategy {
  reinvestPercent: number;
  withdrawPercent: number;
  reasoning: string;
}

interface CompoundingProjectionEntry {
  month: number;
  capital: number;
  profit: number;
}

interface GrowthRiskEntry {
  risk: string;
  severity: RiskSeverity;
  mitigation: string;
}

interface GrowthMaximization {
  maximizedGrowthRate: number; // % per month
  projectedCapital6m: number;
  projectedCapital12m: number;
  projectedCapital24m: number;
  growthMaximizationLevers: GrowthMaximizationLever[];
  optimalReinvestmentStrategy: OptimalReinvestmentStrategy;
  compoundingProjection: CompoundingProjectionEntry[];
  capitalGrowthGrade: GrowthGrade;
  timeToDoubleCapital: number; // days
  timeTo10xCapital: number; // days
  growthRiskAssessment: GrowthRiskEntry[];
}

interface CapitalGrowthResponse {
  ok: true;
  current: GrowthCurrent;
  maximization: GrowthMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    maximizedGrowthRate?: number;
    projectedCapital6m?: number;
    projectedCapital12m?: number;
    projectedCapital24m?: number;
    growthMaximizationLevers?: Array<{
      lever?: string;
      currentGap?: number;
      potentialGain?: number;
      action?: string;
    }>;
    optimalReinvestmentStrategy?: {
      reinvestPercent?: number;
      withdrawPercent?: number;
      reasoning?: string;
    };
    compoundingProjection?: Array<{ month?: number; capital?: number; profit?: number }>;
    capitalGrowthGrade?: GrowthGrade;
    timeToDoubleCapital?: number;
    timeTo10xCapital?: number;
    growthRiskAssessment?: Array<{
      risk?: string;
      severity?: RiskSeverity;
      mitigation?: string;
    }>;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const CAPITAL_MIN = 0;
const CAPITAL_MAX = 10_000_000; // 10M ceiling
const RATE_MIN = 0;
const RATE_MAX = 50; // monthly growth rate ceiling (anti-hallucination: 50%/mo)
const COMPOUND_FACTOR_MIN = 1;
const COMPOUND_FACTOR_MAX = 10;
const GAP_MIN = 0;
const GAP_MAX = 100; // gap %
const GAIN_MIN = 0;
const GAIN_MAX = 1_000; // potential gain €/mo
const PERCENT_MIN = 0;
const PERCENT_MAX = 100;
const DAYS_MIN = 1;
const DAYS_MAX = 7300; // ~20 years ceiling
const MONTHS_PROJECTION = 24; // 24-month projection

const VALID_GRADE: readonly GrowthGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_SEVERITY: readonly RiskSeverity[] = ['LOW', 'MEDIUM', 'HIGH'];

const DEFAULT_REINVEST_PERCENT = 75;
const DEFAULT_WITHDRAW_PERCENT = 25;
const GROWTH_IMPROVEMENT_MULT = 1.5; // 50% achievable growth-rate improvement
const MONTHS_PER_YEAR = 12;

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
  if (!Number.isFinite(v)) return 0;
  return Math.round(v);
}

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
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

// --- Deterministic computation ------------------------------------------

interface SoldTradeProfit {
  profit: number;
  sellMs: number;
  within12m: boolean;
}

function computeSoldTradeProfit(t: SoldTradeRow, now: number): SoldTradeProfit | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellPrice = t.sellPrice ?? 0;
  const sellFees = t.sellFees ?? 0;
  if (sellPrice <= 0) return null;

  const sellMs = toMs(t.sellDate);
  if (sellMs <= 0) return null;

  const cost = buyPrice + buyFees;
  const profit = (sellPrice - sellFees) - cost;
  const within12m = (now - sellMs) <= TWELVE_MONTHS_MS;

  return { profit, sellMs, within12m };
}

function computeHeldEstValue(t: HeldTradeRow): number {
  const buyPrice = t.buyPrice ?? 0;
  const listingEst = t.listing?.aiEstimatedValue ?? null;
  const listingPrice = t.listing?.price ?? null;
  if (listingEst && listingEst > 0) return Math.round(listingEst);
  if (listingPrice && listingPrice > 0) return Math.round(listingPrice);
  return Math.round(buyPrice * 1.1);
}

interface CapitalBaseline {
  realizedProfit12m: number;
  soldCount12m: number;
  heldInventoryValue: number;
  heldCount: number;
}

function computeCapitalBaseline(
  soldProfits: SoldTradeProfit[],
  heldItems: HeldTradeRow[],
): CapitalBaseline {
  let realizedProfit12m = 0;
  let soldCount12m = 0;
  for (const sp of soldProfits) {
    if (!sp.within12m) continue;
    realizedProfit12m += sp.profit;
    soldCount12m += 1;
  }
  let heldInventoryValue = 0;
  for (const h of heldItems) {
    heldInventoryValue += computeHeldEstValue(h);
  }
  return {
    realizedProfit12m: round0(realizedProfit12m),
    soldCount12m,
    heldInventoryValue: round0(heldInventoryValue),
    heldCount: heldItems.length,
  };
}

function computeGrowthCurrent(baseline: CapitalBaseline): GrowthCurrent {
  // Available cash proxy = max(0, realized profit last 12m)
  // (User can re-invest realized profit. Negative → 0 cash to reinvest.)
  const availableCash = Math.max(0, baseline.realizedProfit12m);
  const currentCapital = round0(clampNum(
    availableCash + baseline.heldInventoryValue,
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));

  // Average monthly growth rate = monthly realized profit / current capital × 100
  let avgMonthlyGrowthRate = 0;
  if (currentCapital > 0 && baseline.soldCount12m > 0) {
    const monthlyProfit = baseline.realizedProfit12m / MONTHS_PER_YEAR;
    avgMonthlyGrowthRate = (monthlyProfit / currentCapital) * 100;
  }
  avgMonthlyGrowthRate = round2(clampNum(
    avgMonthlyGrowthRate,
    RATE_MIN, RATE_MAX, 0,
  ));

  // Compounding factor = how much reinvestment amplifies growth
  // If profit is reinvested at growthRate for 12 months: factor = (1 + r)^12 / 12r ≈ approx
  // Simplified: factor = 1 + min(2, growthRate × 0.5) — grows with growth rate
  const compoundingFactor = round2(clampNum(
    1 + Math.min(2, avgMonthlyGrowthRate * 0.5),
    COMPOUND_FACTOR_MIN, COMPOUND_FACTOR_MAX, 1,
  ));

  return {
    currentCapital,
    avgMonthlyGrowthRate,
    compoundingFactor,
  };
}

function decideGrade(monthlyRate: number): GrowthGrade {
  if (monthlyRate >= 20) return 'A+';
  if (monthlyRate >= 12) return 'A';
  if (monthlyRate >= 7) return 'B';
  if (monthlyRate >= 3) return 'C';
  if (monthlyRate >= 1) return 'D';
  return 'F';
}

function buildCompoundingProjection(
  currentCapital: number,
  monthlyRatePct: number,
): CompoundingProjectionEntry[] {
  const r = monthlyRatePct / 100;
  const proj: CompoundingProjectionEntry[] = [];
  let prevCapital = currentCapital;
  for (let month = 1; month <= MONTHS_PROJECTION; month++) {
    const newCapital = prevCapital * (1 + r);
    const profit = newCapital - prevCapital;
    proj.push({
      month,
      capital: round0(clampNum(newCapital, CAPITAL_MIN, CAPITAL_MAX, 0)),
      profit: round0(clampNum(profit, CAPITAL_MIN, CAPITAL_MAX, 0)),
    });
    prevCapital = newCapital;
  }
  return proj;
}

function buildDeterministicMaximization(
  current: GrowthCurrent,
  baseline: CapitalBaseline,
): GrowthMaximization {
  const maximizedGrowthRate = round2(clampNum(
    current.avgMonthlyGrowthRate * GROWTH_IMPROVEMENT_MULT,
    RATE_MIN, RATE_MAX, current.avgMonthlyGrowthRate > 0
      ? current.avgMonthlyGrowthRate
      : 5, // baseline 5% if no history
  ));

  const r = maximizedGrowthRate / 100;
  const projectedCapital6m = round0(clampNum(
    current.currentCapital * Math.pow(1 + r, 6),
    CAPITAL_MIN, current.currentCapital * 100, 0,
  ));
  const projectedCapital12m = round0(clampNum(
    current.currentCapital * Math.pow(1 + r, 12),
    CAPITAL_MIN, current.currentCapital * 100, 0,
  ));
  const projectedCapital24m = round0(clampNum(
    current.currentCapital * Math.pow(1 + r, 24),
    CAPITAL_MIN, current.currentCapital * 100, 0,
  ));

  // Growth maximization levers
  const levers: GrowthMaximizationLever[] = [];
  // Lever 1: Reinvestment rate
  const reinvestGap = clampNum(100 - DEFAULT_REINVEST_PERCENT, GAP_MIN, GAP_MAX, 25);
  levers.push({
    lever: 'Reinvestment rate',
    currentGap: round0(reinvestGap),
    potentialGain: round2(clampNum(
      current.avgMonthlyGrowthRate * (reinvestGap / 100) * 0.3,
      GAIN_MIN, GAIN_MAX, 0,
    )),
    action: clampString(
      `Povečaj reinvestment z ${100 - Math.round(reinvestGap)}% na ${DEFAULT_REINVEST_PERCENT}% — vsak € profit generira compound growth.`,
      200,
      `Povečaj reinvestment na ${DEFAULT_REINVEST_PERCENT}%.`,
    ),
  });
  // Lever 2: ROI per cycle
  const avgTradeProfit = baseline.soldCount12m > 0
    ? Math.max(0, baseline.realizedProfit12m) / baseline.soldCount12m
    : 0;
  const roiGap = clampNum(Math.max(0, 50 - avgTradeProfit), GAP_MIN, GAP_MAX, 30);
  levers.push({
    lever: 'ROI per cycle',
    currentGap: round0(roiGap),
    potentialGain: round2(clampNum(
      avgTradeProfit * (roiGap / 100) * (baseline.soldCount12m / 12),
      GAIN_MIN, GAIN_MAX, 0,
    )),
    action: clampString(
      `Povečaj ROI per cycle z ${Math.round(avgTradeProfit)}€ na ${Math.round(avgTradeProfit + roiGap)}€ — boljši sourcing ali refurb.`,
      200,
      `Povečaj ROI per cycle.`,
    ),
  });
  // Lever 3: Cycle speed (turnover)
  const cycleGap = clampNum(Math.max(0, 3 - baseline.soldCount12m / 12), GAP_MIN, GAP_MAX, 1);
  levers.push({
    lever: 'Cycle speed',
    currentGap: round0(cycleGap),
    potentialGain: round2(clampNum(
      avgTradeProfit * cycleGap * (current.avgMonthlyGrowthRate / 100 + 0.1),
      GAIN_MIN, GAIN_MAX, 0,
    )),
    action: clampString(
      `Povečaj cycle speed — ciklaj kapital hitreje (${Math.round(cycleGap * 12)} več trades/leto).`,
      200,
      `Povečaj cycle speed.`,
    ),
  });
  // Lever 4: Risk management
  const riskGap = 30; // fixed gap: 30% room for better risk-adjusted growth
  levers.push({
    lever: 'Risk-adjusted growth',
    currentGap: round0(riskGap),
    potentialGain: round2(clampNum(
      current.avgMonthlyGrowthRate * 0.1,
      GAIN_MIN, GAIN_MAX, 0,
    )),
    action: clampString(
      `Diversificiraj kategorije in viri nakupa — zmanjšaj variance, omogoči višji steady growth.`,
      200,
      `Diversificiraj za višji risk-adjusted growth.`,
    ),
  });

  const optimalReinvestmentStrategy: OptimalReinvestmentStrategy = {
    reinvestPercent: DEFAULT_REINVEST_PERCENT,
    withdrawPercent: DEFAULT_WITHDRAW_PERCENT,
    reasoning: clampString(
      `Reinvestiraj ${DEFAULT_REINVEST_PERCENT}% profit-a v nove deals za compounding, izplačaj ${DEFAULT_WITHDRAW_PERCENT}% za osebno porabo in cash reserve. Pri ${maximizedGrowthRate}%/mo growth rate → ${DEFAULT_REINVEST_PERCENT}% reinvestment daje optimalno rast brez cash drag.`,
      400,
      `Reinvestiraj ${DEFAULT_REINVEST_PERCENT}%, izplačaj ${DEFAULT_WITHDRAW_PERCENT}%.`,
    ),
  };

  const compoundingProjection = buildCompoundingProjection(
    current.currentCapital,
    maximizedGrowthRate,
  );

  const capitalGrowthGrade = decideGrade(maximizedGrowthRate);

  // Time to double / 10x capital (in days)
  // months = ln(target) / ln(1 + r); days = months × 30
  const timeToDoubleMonths = r > 0 ? Math.log(2) / Math.log(1 + r) : 999;
  const timeToDoubleCapital = round0(clampNum(
    Math.ceil(timeToDoubleMonths * 30),
    DAYS_MIN, DAYS_MAX, 365,
  ));
  const timeTo10xMonths = r > 0 ? Math.log(10) / Math.log(1 + r) : 9999;
  const timeTo10xCapital = round0(clampNum(
    Math.ceil(timeTo10xMonths * 30),
    DAYS_MIN, DAYS_MAX, 3650,
  ));

  // Growth risk assessment
  const risks: GrowthRiskEntry[] = [
    {
      risk: clampString('Inventory saturation — preveč kapitala v inventoriju, počasen turnover.', 150, 'Inventory saturation.'),
      severity: baseline.heldCount > 20 ? 'HIGH' : baseline.heldCount > 5 ? 'MEDIUM' : 'LOW',
      mitigation: clampString(
        `Diversificiraj kategorije, hitreje prodaj mature item-e (target: <30 dni hold).`,
        200,
        `Diversificiraj in hitreje prodaj.`,
      ),
    },
    {
      risk: clampString('Cash drag — prevelik cash balance ne generira profit-a.', 150, 'Cash drag.'),
      severity: 'MEDIUM',
      mitigation: clampString(
        `Drži max 30% kapitala v cash, 70% reinvestiraj v active inventory v 7 dneh.`,
        200,
        `Drži 30% cash, 70% reinvestiraj.`,
      ),
    },
    {
      risk: clampString('Market downturn — kategorija izgubi vrednost med hold periodo.', 150, 'Market downturn.'),
      severity: 'HIGH',
      mitigation: clampString(
        `Diversificiraj čez 3+ kategorije in 2+ platforme (Bolha + Vinted + Avtonet).`,
        200,
        `Diversificiraj čez kategorije in platforme.`,
      ),
    },
    {
      risk: clampString('Compounding limit — pri visokem growth rate postane težko reinvestirati vse.', 150, 'Compounding limit.'),
      severity: maximizedGrowthRate > 15 ? 'HIGH' : 'MEDIUM',
      mitigation: clampString(
        `Škali: povečaj volume z novimi deals, sodeluj z več buyer-ji, batch sourcing.`,
        200,
        `Škali z novimi deals in batch sourcing.`,
      ),
    },
  ];

  return {
    maximizedGrowthRate,
    projectedCapital6m,
    projectedCapital12m,
    projectedCapital24m,
    growthMaximizationLevers: levers.slice(0, 5),
    optimalReinvestmentStrategy,
    compoundingProjection,
    capitalGrowthGrade,
    timeToDoubleCapital,
    timeTo10xCapital,
    growthRiskAssessment: risks,
  };
}

function buildSummary(
  current: GrowthCurrent,
  maximization: GrowthMaximization,
): string {
  const parts: string[] = [
    `Capital: ${current.currentCapital}€.`,
    `Growth: ${current.avgMonthlyGrowthRate}%/mo (compounding ${current.compoundingFactor}x).`,
    `Maximized: ${maximization.maximizedGrowthRate}%/mo → 12m: ${maximization.projectedCapital12m}€.`,
    `Grade: ${maximization.capitalGrowthGrade}. 2x: ${maximization.timeToDoubleCapital} dni. 10x: ${maximization.timeTo10xCapital} dni.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- AI prompt + merge helpers (pure, testable) ---------------------------

interface PromptData {
  soldCount12m: number;
  heldCount: number;
  realizedProfit12m: number;
  heldInventoryValue: number;
  current: GrowthCurrent;
  deterministicMaximization: GrowthMaximization;
  caps: Record<string, number>;
}

function buildPromptData(
  baseline: CapitalBaseline,
  current: GrowthCurrent,
  maximization: GrowthMaximization,
): PromptData {
  return {
    soldCount12m: baseline.soldCount12m,
    heldCount: baseline.heldCount,
    realizedProfit12m: baseline.realizedProfit12m,
    heldInventoryValue: baseline.heldInventoryValue,
    current,
    deterministicMaximization: maximization,
    caps: {
      capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
      rateMin: RATE_MIN, rateMax: RATE_MAX,
      compoundFactorMin: COMPOUND_FACTOR_MIN, compoundFactorMax: COMPOUND_FACTOR_MAX,
      gapMin: GAP_MIN, gapMax: GAP_MAX,
      gainMin: GAIN_MIN, gainMax: GAIN_MAX,
      percentMin: PERCENT_MIN, percentMax: PERCENT_MAX,
      daysMin: DAYS_MIN, daysMax: DAYS_MAX,
    },
  };
}

function buildPrompt(promptData: PromptData): string {
  return `Si AI "Capital Growth Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za CAPITAL GROWTH maximization — identificiraš kako MAXIMIZIRATI compounding growth rate kapitala preko reinvestment strategy. Razlika od capital-allocation-optimizer (ki alokira kapital po kategorijah) — ti maksimiziraš COMPOUNDING GROWTH rate. Razlika od reinvestment-advisor (ki svetuje reinvestment) — ti KOMBINIRAŠ growth rate maximization + compounding projection + time-to-double/10x forecast. Razlika od profit-velocity-maximizer (v7.98 ki maksimizira €/day velocity) — ti maksimiziraš COMPOUNDING growth rate (% per month). Razlika od inventory-cash-conversion-maximizer (v7.98 ki maksimizira cash conversion) — ti maksimiziraš CAPITAL GROWTH čez 6/12/24 mesecev. Razlika od deal-quality-profit-optimizer (v7.98 ki optimira quality-profit) — ti maksimiziraš compounding capital growth z reinvestment strategy.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih + HELD inventorij):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.maximizedGrowthRate %/mo [0, 50] (≥ avgMonthlyGrowthRate, ≤ avgMonthlyGrowthRate × 3 ali 5% če 0 — anti-hallucination),
2. maximization.projectedCapital6m € [0, currentCapital × 100] (= currentCapital × (1 + rate/100)^6),
3. maximization.projectedCapital12m € [0, currentCapital × 100],
4. maximization.projectedCapital24m € [0, currentCapital × 100],
5. maximization.growthMaximizationLevers: 4 levers { lever (max 80), currentGap % [0, 100], potentialGain €/mo [0, 1000], action (max 200, slovenski) } (reinvestment rate, ROI per cycle, cycle speed, risk management),
6. maximization.optimalReinvestmentStrategy: { reinvestPercent % [0, 100], withdrawPercent % [0, 100] (reinvest + withdraw = 100), reasoning (max 400, slovenski) },
7. maximization.compoundingProjection: 24 entries { month 1-24, capital € [0, currentCapital × 100], profit € [0, capital] } (month-by-month compounding z maximizedGrowthRate),
8. maximization.capitalGrowthGrade: A+ | A | B | C | D | F (≥20 A+, ≥12 A, ≥7 B, ≥3 C, ≥1 D, else F),
9. maximization.timeToDoubleCapital dni [1, 7300] (koliko dni da podvojiš capital pri maximized rate),
10. maximization.timeTo10xCapital dni [1, 7300] (koliko dni da 10x-aš capital),
11. maximization.growthRiskAssessment: 3-5 risks { risk (max 150, slovenski), severity LOW | MEDIUM | HIGH, mitigation (max 200, slovenski) },
12. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "maximization": {
    "maximizedGrowthRate": 14,
    "projectedCapital6m": 9300,
    "projectedCapital12m": 20400,
    "projectedCapital24m": 98500,
    "growthMaximizationLevers": [
      { "lever": "Reinvestment rate", "currentGap": 25, "potentialGain": 80, "action": "Povečaj reinvestment na 75%." },
      { "lever": "ROI per cycle", "currentGap": 30, "potentialGain": 120, "action": "Boljši sourcing." }
    ],
    "optimalReinvestmentStrategy": { "reinvestPercent": 75, "withdrawPercent": 25, "reasoning": "Reinvestiraj 75% za compounding, izplačaj 25% za cash reserve." },
    "compoundingProjection": [
      { "month": 1, "capital": 4845, "profit": 595 },
      { "month": 2, "capital": 5523, "profit": 678 }
    ],
    "capitalGrowthGrade": "A",
    "timeToDoubleCapital": 154,
    "timeTo10xCapital": 511,
    "growthRiskAssessment": [
      { "risk": "Inventory saturation.", "severity": "HIGH", "mitigation": "Diversificiraj kategorije." }
    ]
  },
  "summary": "Capital: 4250€ (growth 8%/mo, compounding 1.8x). Maximized: 14%/mo → 12m: 20400€. Grade A. 2x: 154 dni. 10x: 511 dni."
}${GROUNDING_PROMPT_SUFFIX}`;
}

function mergeAiResponse(
  parsed: AiResponse | null,
  current: GrowthCurrent,
  detMaximization: GrowthMaximization,
): { maximization: GrowthMaximization; summary: string; aiUsed: boolean } {
  if (!parsed || typeof parsed !== 'object') {
    return {
      maximization: detMaximization,
      summary: buildSummary(current, detMaximization),
      aiUsed: false,
    };
  }

  const aiMax = parsed.maximization ?? {};

  // Anti-hallucination: maximizedGrowthRate clamped to [avgRate, avgRate × 3]
  const maxRateLowBound = current.avgMonthlyGrowthRate;
  const maxRateHighBound = Math.min(
    RATE_MAX,
    Math.max(5, current.avgMonthlyGrowthRate * 3),
  );
  const aiMaxRate = clampNum(
    aiMax.maximizedGrowthRate,
    RATE_MIN, RATE_MAX,
    detMaximization.maximizedGrowthRate,
  );
  const maximizedGrowthRate = round2(
    Math.max(maxRateLowBound, Math.min(maxRateHighBound, aiMaxRate)),
  );

  // Capital projection high bound = currentCapital × 100
  const projHighBound = Math.max(1000, current.currentCapital * 100);
  const projectedCapital6m = round0(clampNum(
    aiMax.projectedCapital6m,
    CAPITAL_MIN, projHighBound,
    round0(current.currentCapital * Math.pow(1 + maximizedGrowthRate / 100, 6)),
  ));
  const projectedCapital12m = round0(clampNum(
    aiMax.projectedCapital12m,
    CAPITAL_MIN, projHighBound,
    round0(current.currentCapital * Math.pow(1 + maximizedGrowthRate / 100, 12)),
  ));
  const projectedCapital24m = round0(clampNum(
    aiMax.projectedCapital24m,
    CAPITAL_MIN, projHighBound,
    round0(current.currentCapital * Math.pow(1 + maximizedGrowthRate / 100, 24)),
  ));

  // Growth maximization levers
  const levers: GrowthMaximizationLever[] = [];
  if (Array.isArray(aiMax.growthMaximizationLevers)) {
    for (const l of aiMax.growthMaximizationLevers.slice(0, 5)) {
      if (!l || typeof l !== 'object') continue;
      levers.push({
        lever: clampString(l.lever, 80, 'Lever'),
        currentGap: round0(clampNum(l.currentGap, GAP_MIN, GAP_MAX, 0)),
        potentialGain: round2(clampNum(l.potentialGain, GAIN_MIN, GAIN_MAX, 0)),
        action: clampString(l.action, 200, 'Izboljšaj lever.'),
      });
    }
  }
  if (levers.length === 0) {
    for (const l of detMaximization.growthMaximizationLevers) levers.push(l);
  }

  // Optimal reinvestment strategy
  const aiStrat = aiMax.optimalReinvestmentStrategy ?? {};
  const reinvestPercent = round0(clampNum(
    aiStrat.reinvestPercent,
    PERCENT_MIN, PERCENT_MAX,
    detMaximization.optimalReinvestmentStrategy.reinvestPercent,
  ));
  const withdrawPercent = round0(clampNum(
    aiStrat.withdrawPercent,
    PERCENT_MIN, PERCENT_MAX,
    100 - reinvestPercent,
  ));
  const optimalReinvestmentStrategy: OptimalReinvestmentStrategy = {
    reinvestPercent,
    withdrawPercent,
    reasoning: clampString(
      aiStrat.reasoning,
      400,
      detMaximization.optimalReinvestmentStrategy.reasoning,
    ),
  };

  // Compounding projection
  const compoundingProjection: CompoundingProjectionEntry[] = [];
  const expectedProj = buildCompoundingProjection(
    current.currentCapital,
    maximizedGrowthRate,
  );
  if (Array.isArray(aiMax.compoundingProjection) && aiMax.compoundingProjection.length > 0) {
    for (let i = 0; i < Math.min(MONTHS_PROJECTION, aiMax.compoundingProjection.length); i++) {
      const p = aiMax.compoundingProjection[i];
      if (!p || typeof p !== 'object') {
        compoundingProjection.push(expectedProj[i] ?? { month: i + 1, capital: 0, profit: 0 });
        continue;
      }
      const exp = expectedProj[i] ?? { month: i + 1, capital: 0, profit: 0 };
      compoundingProjection.push({
        month: round0(clampNum(p.month, 1, MONTHS_PROJECTION, i + 1)),
        capital: round0(clampNum(
          p.capital,
          CAPITAL_MIN, projHighBound,
          exp.capital,
        )),
        profit: round0(clampNum(
          p.profit,
          CAPITAL_MIN, projHighBound,
          exp.profit,
        )),
      });
    }
  }
  if (compoundingProjection.length === 0) {
    for (const p of expectedProj) compoundingProjection.push(p);
  }

  const capitalGrowthGrade = clampEnum(
    aiMax.capitalGrowthGrade,
    VALID_GRADE,
    detMaximization.capitalGrowthGrade,
  );

  const timeToDoubleCapital = round0(clampNum(
    aiMax.timeToDoubleCapital,
    DAYS_MIN, DAYS_MAX,
    detMaximization.timeToDoubleCapital,
  ));
  const timeTo10xCapital = round0(clampNum(
    aiMax.timeTo10xCapital,
    DAYS_MIN, DAYS_MAX,
    detMaximization.timeTo10xCapital,
  ));

  // Growth risk assessment
  const risks: GrowthRiskEntry[] = [];
  if (Array.isArray(aiMax.growthRiskAssessment)) {
    for (const r of aiMax.growthRiskAssessment.slice(0, 5)) {
      if (!r || typeof r !== 'object') continue;
      risks.push({
        risk: clampString(r.risk, 150, 'Risk.'),
        severity: clampEnum(r.severity, VALID_SEVERITY, 'MEDIUM'),
        mitigation: clampString(r.mitigation, 200, 'Mitigacija.'),
      });
    }
  }
  if (risks.length === 0) {
    for (const r of detMaximization.growthRiskAssessment) risks.push(r);
  }

  const maximization: GrowthMaximization = {
    maximizedGrowthRate,
    projectedCapital6m,
    projectedCapital12m,
    projectedCapital24m,
    growthMaximizationLevers: levers,
    optimalReinvestmentStrategy,
    compoundingProjection,
    capitalGrowthGrade,
    timeToDoubleCapital,
    timeTo10xCapital,
    growthRiskAssessment: risks,
  };

  const summary = clampString(parsed.summary, 400, buildSummary(current, maximization));
  return { maximization, summary, aiUsed: true };
}

// --- Handler -------------------------------------------------------------

const capitalGrowthMaximizerHandler = withAiRoute<CapitalGrowthMaximizerInput>({
  endpoint: '/api/ai/capital-growth-maximizer',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — body ignored, identična logika za GET in POST
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Query SOLD trades from last 12 months + HELD trades (parallel)
    const [soldTrades, heldTrades] = await Promise.all([
      db.trade.findMany({
        where: {
          status: 'sold',
          sellDate: { gte: twelveMonthsAgo },
          sellPrice: { gt: 0 },
        },
        select: {
          id: true,
          buyPrice: true,
          buyFees: true,
          sellPrice: true,
          sellFees: true,
          sellDate: true,
        },
        orderBy: { sellDate: 'asc' },
        take: 100000,
      }) as unknown as SoldTradeRow[],
      db.trade.findMany({
        where: { status: 'held' },
        select: {
          id: true,
          buyPrice: true,
          listing: {
            select: {
              aiEstimatedValue: true,
              price: true,
            },
          },
        },
        take: 100000,
      }) as unknown as HeldTradeRow[],
    ]);

    // Empty-state: no SOLD trades and no HELD inventory
    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return apiOk({
        ok: true,
        current: {
          currentCapital: 0,
          avgMonthlyGrowthRate: 0,
          compoundingFactor: 1,
        },
        maximization: {
          maximizedGrowthRate: 0,
          projectedCapital6m: 0,
          projectedCapital12m: 0,
          projectedCapital24m: 0,
          growthMaximizationLevers: [],
          optimalReinvestmentStrategy: {
            reinvestPercent: DEFAULT_REINVEST_PERCENT,
            withdrawPercent: DEFAULT_WITHDRAW_PERCENT,
            reasoning: 'Ni SOLD trgovin in HELD inventorija — capital growth maximization ni mogoč.',
          },
          compoundingProjection: [],
          capitalGrowthGrade: 'F',
          timeToDoubleCapital: 365,
          timeTo10xCapital: 3650,
          growthRiskAssessment: [],
        },
        summary: 'Ni SOLD trgovin in HELD inventorija — Capital Growth Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin in HELD inventorija — Capital Growth Maximizer ni mogoč.',
      } satisfies CapitalGrowthResponse);
    }

    // 2) Compute capital baseline
    const soldProfits: SoldTradeProfit[] = [];
    for (const t of soldTrades) {
      const sp = computeSoldTradeProfit(t, now);
      if (sp) soldProfits.push(sp);
    }

    const baseline = computeCapitalBaseline(soldProfits, heldTrades);
    const current = computeGrowthCurrent(baseline);

    let maximization = buildDeterministicMaximization(current, baseline);
    let summary = buildSummary(current, maximization);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `capital-growth-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: GrowthMaximization;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        current,
        maximization: cached.maximization,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies CapitalGrowthResponse);
    }

    // 4) AI prompt with grounding
    const promptData = buildPromptData(baseline, current, maximization);
    const prompt = buildPrompt(promptData);

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      const result = mergeAiResponse(parsed, current, maximization);
      maximization = result.maximization;
      summary = result.summary;
      aiUsed = result.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/capital-growth-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { maximization, summary });
    }

    return apiOk({
      ok: true,
      current,
      maximization,
      summary,
      aiUsed,
    } satisfies CapitalGrowthResponse);
  },
});

export const GET = capitalGrowthMaximizerHandler;
export const POST = capitalGrowthMaximizerHandler;
