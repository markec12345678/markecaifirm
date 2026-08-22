// v8.02 / v8.96.5-batch1: AI Profit Scale Engine — AI identificira kako SCALE-ATI
// profit za EXPONENTIAL growth. NE samo optimizira trenutne operacije — ta
// načrtuje scaling CELEGA business-a za exponential growth. "You're making
// 2000€/month. To scale to 10,000€/month you need: 3x more inventory, 2x
// faster turnover, and 1.5x better margins." Refaktoriran z withAiRoute
// helperjem (v8.96) + enforceBudget guard.
//
// Razlika od profit-multiplier-engine (v8.00 ki MULTIPLICIRA profit z 8 levers)
// — ta SCALE-A cel business z exponential growth plan (phased: 2x → 3x → 5x),
// ne compounding multiplier. Razlika od revenue-growth-maximizer (v8.01 ki
// maksimizira REVENUE growth) — ta SCALE-A PROFIT (bottom-line), ne revenue
// (top-line), in dodaja scaling bottlenecks + capacity analysis. Razlika od
// inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital
// efficiency per item) — ta daje GLOBAL scale plan z bottlenecks in phased
// timeline (ne per-item). Razlika od capital-growth-maximizer (v7.99 ki
// maksimizira compounding capital growth) — ta maksimizira SCALE FACTOR
// (multiplier na monthly profit z bottlenecks). Razlika od profit-velocity-
// maximizer (v7.98 ki maksimizira €/day velocity) — ta daje PHASED scale plan
// (2x/3x/5x) z bottleneck analizo. Razlika od inventory-growth-planner (ki
// planira inventory growth) — ta SCALE-A profit preko 3 axes (inventory ×
// turnover × margin) z capacity assessment.
//
// "Current: 2000€/mo profit, 18 items inventory, 12 trades/mo, avgProfitPerTrade
// 167€, ROI 35%. Scale capacity: capital 5000€ available, time 20h/wk,
// logistics 8 items/mo. Scaling: target 10,000€/mo (5x). Requirements:
// inventory 3x (54 items), turnover 2x (24 trades/mo), margin 1.5x (250€/trade),
// capital +15,000€. Bottlenecks: capital (15k gap), sourcing (need 3x more
// deals), time (need 40h/wk). Action plan: Phase 1 (3mo) 2x=4000€, Phase 2
// (6mo) 3x=6000€, Phase 3 (12mo) 5x=10000€. Timeline: 12 months to target.
// Risk: capital gap, market depth, sourcing burnout. Grade B (current
// operation moderately scalable)."

// GET+POST /api/ai/profit-scale-engine
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitScaleEngineInput {}

// --- Types ---------------------------------------------------------------

type ScaleGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

interface SoldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  category: string | null;
}

interface HeldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
}

interface CurrentScale {
  inventorySize: number;
  tradeVolumePerMonth: number;
  avgProfitPerTrade: number;
  avgROI: number;
}

interface ScaleCapacity {
  capitalCapacity: number;
  timeCapacity: number;
  logisticsCapacity: number;
}

interface CurrentState {
  currentMonthlyProfit: number;
  currentScale: CurrentScale;
  scaleCapacity: ScaleCapacity;
}

interface ScaleRequirements {
  inventoryScalingFactor: number;
  turnoverScalingFactor: number;
  marginScalingFactor: number;
  capitalRequirement: number;
}

interface ScaleBottleneck {
  bottleneck: string;
  impact: string;
  mitigation: string;
}

interface ScaleActionPhase {
  phase: string;
  targetProfit: number;
  timeline: string;
  actions: string[];
}

interface ScaleRisk {
  risk: string;
  severity: RiskSeverity;
  mitigation: string;
}

interface Scaling {
  targetMonthlyProfit: number;
  scaleMultiplier: number;
  scaleRequirements: ScaleRequirements;
  scaleBottlenecks: ScaleBottleneck[];
  scaleActionPlan: ScaleActionPhase[];
  scaleTimeline: string;
  scaleRiskAssessment: ScaleRisk[];
  scaleGrade: ScaleGrade;
}

interface ProfitScaleResponse {
  ok: true;
  current: CurrentState;
  scaling: Scaling;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  scaleBottlenecks?: Array<{
    bottleneck?: string;
    impact?: string;
    mitigation?: string;
  }>;
  scaleActionPlan?: Array<{
    phase?: string;
    targetProfit?: number;
    timeline?: string;
    actions?: string[];
  }>;
  scaleTimeline?: string;
  scaleRiskAssessment?: Array<{
    risk?: string;
    severity?: RiskSeverity;
    mitigation?: string;
  }>;
  scaleGrade?: ScaleGrade;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const PROFIT_MIN = 0;
const PROFIT_MAX = 100_000; // 100k/mo ceiling
const FACTOR_MIN = 1.0;
const FACTOR_MAX = 10.0; // scaling factors up to 10x
const MULT_MIN = 1.0;
const MULT_MAX = 10.0; // scaleMultiplier up to 10x
const CAPITAL_MIN = 0;
const CAPITAL_MAX = 1_000_000; // 1M capital ceiling
const TIME_MIN = 0;
const TIME_MAX = 168; // 168 hours/week max
const LOGISTICS_MIN = 0;
const LOGISTICS_MAX = 500; // 500 items/mo logistics ceiling
const ROI_MIN = -100;
const ROI_MAX = 500;
const RISK_MIN = 0;
const SCORE_MAX = 100;

const VALID_GRADE: readonly ScaleGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_SEVERITY: readonly RiskSeverity[] = ['LOW', 'MEDIUM', 'HIGH'];

const MAX_BOTTLENECKS = 6;
const MAX_ACTION_PHASES = 4;
const MAX_RISKS = 6;
const MAX_ACTIONS_PER_PHASE = 6;
const MAX_HELD_FOR_CAPACITY = 500;

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

interface SoldComputed {
  profit: number;
  roi: number; // %
  sellMs: number;
  within12m: boolean;
  sellMonth: string;
}

function computeSoldTrade(t: SoldTradeRow, now: number): SoldComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellPrice = t.sellPrice ?? 0;
  const sellFees = t.sellFees ?? 0;
  if (sellPrice <= 0) return null;
  const sellMs = toMs(t.sellDate);
  if (sellMs <= 0) return null;
  const cost = buyPrice + buyFees;
  const net = sellPrice - sellFees;
  const profit = net - cost;
  const roi = cost > 0 ? (profit / cost) * 100 : 0;
  const sellMonth = new Date(sellMs).toISOString().slice(0, 7);
  const within12m = (now - sellMs) <= TWELVE_MONTHS_MS;
  return { profit, roi, sellMs, within12m, sellMonth };
}

interface SoldAgg {
  profit12m: number;
  count12m: number;
  totalROI: number;
  perMonth: Map<string, number>;
}

function aggregateSold(trades: SoldComputed[]): SoldAgg {
  let profit12m = 0;
  let count12m = 0;
  let totalROI = 0;
  const perMonth = new Map<string, number>();
  for (const t of trades) {
    if (t.within12m) {
      profit12m += t.profit;
      count12m += 1;
      totalROI += t.roi;
      perMonth.set(t.sellMonth, (perMonth.get(t.sellMonth) ?? 0) + t.profit);
    }
  }
  return { profit12m, count12m, totalROI, perMonth };
}

function computeCurrent(
  agg: SoldAgg,
  heldCount: number,
): CurrentState {
  // currentMonthlyProfit = avg monthly profit last 12m
  const currentMonthlyProfit = round0(clampNum(
    agg.count12m > 0 ? agg.profit12m / 12 : 0,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  const tradeVolumePerMonth = round2(clampNum(
    agg.count12m > 0 ? agg.count12m / 12 : 0,
    0, 1000, 0,
  ));

  const avgProfitPerTrade = round0(clampNum(
    agg.count12m > 0 ? agg.profit12m / agg.count12m : 0,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  const avgROI = round2(clampNum(
    agg.count12m > 0 ? agg.totalROI / agg.count12m : 0,
    ROI_MIN, ROI_MAX, 0,
  ));

  // Scale capacity — derived from current operation:
  // capitalCapacity = approx working capital = avgProfit × 3 months + held inventory value proxy
  // timeCapacity = approx hours/week available (assume 30h baseline — current operator)
  // logisticsCapacity = items/mo processable (current tradeVolume × 1.5 headroom)
  const capitalCapacity = round0(clampNum(
    currentMonthlyProfit * 3 + avgProfitPerTrade * heldCount * 0.5,
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));
  const timeCapacity = round0(clampNum(
    20 + Math.min(20, tradeVolumePerMonth * 1.5),
    TIME_MIN, TIME_MAX, 20,
  ));
  const logisticsCapacity = round0(clampNum(
    Math.max(5, tradeVolumePerMonth * 1.5 + 5),
    LOGISTICS_MIN, LOGISTICS_MAX, 5,
  ));

  return {
    currentMonthlyProfit,
    currentScale: {
      inventorySize: round0(clampNum(heldCount, 0, 10000, 0)),
      tradeVolumePerMonth,
      avgProfitPerTrade,
      avgROI,
    },
    scaleCapacity: {
      capitalCapacity,
      timeCapacity,
      logisticsCapacity,
    },
  };
}

function decideGrade(multiplier: number, bottlenecks: number): ScaleGrade {
  // multiplier [1.0, 10.0]
  // A+ if multiplier ≥ 5.0 and bottlenecks ≤ 2
  // A if multiplier ≥ 3.5 and bottlenecks ≤ 3
  // B if multiplier ≥ 2.5 and bottlenecks ≤ 4
  // C if multiplier ≥ 1.8
  // D if multiplier ≥ 1.3
  // else F
  if (multiplier >= 5.0 && bottlenecks <= 2) return 'A+';
  if (multiplier >= 3.5 && bottlenecks <= 3) return 'A';
  if (multiplier >= 2.5 && bottlenecks <= 4) return 'B';
  if (multiplier >= 1.8) return 'C';
  if (multiplier >= 1.3) return 'D';
  return 'F';
}

function buildDeterministicScaling(current: CurrentState): Scaling {
  // Target = 5x current monthly profit (ambitious but achievable ceiling)
  const targetMonthlyProfit = round0(clampNum(
    Math.max(current.currentMonthlyProfit * 5, current.currentMonthlyProfit + 1000),
    PROFIT_MIN, PROFIT_MAX, current.currentMonthlyProfit,
  ));
  const scaleMultiplier = round2(clampNum(
    current.currentMonthlyProfit > 0
      ? targetMonthlyProfit / current.currentMonthlyProfit
      : 1,
    MULT_MIN, MULT_MAX, 1,
  ));

  // Decompose scaling into 3 factors: inventory × turnover × margin = scaleMultiplier
  // Distribute: inventory 2x, turnover 1.5x, margin 1.3x → cumulative ~3.9x (we round up to 5x)
  // But clamp to actual scaleMultiplier for consistency
  const targetInventory = Math.max(2, scaleMultiplier / 1.5); // inventory factor
  const targetTurnover = Math.max(1.2, scaleMultiplier / 2.5);
  const targetMargin = Math.max(1.1, scaleMultiplier / 3.5);
  // Normalize so product ≈ scaleMultiplier
  const product = targetInventory * targetTurnover * targetMargin;
  const norm = product > 0 ? Math.pow(scaleMultiplier / product, 1 / 3) : 1;
  const inventoryScalingFactor = round2(clampNum(
    targetInventory * norm, FACTOR_MIN, FACTOR_MAX, 2,
  ));
  const turnoverScalingFactor = round2(clampNum(
    targetTurnover * norm, FACTOR_MIN, FACTOR_MAX, 1.5,
  ));
  const marginScalingFactor = round2(clampNum(
    targetMargin * norm, FACTOR_MIN, FACTOR_MAX, 1.3,
  ));

  // Capital requirement = inventory factor × current inventory value proxy
  const currentInventoryValue = current.currentScale.inventorySize
    * current.currentScale.avgProfitPerTrade * 3; // proxy: cost ≈ 3x profit margin
  const capitalRequirement = round0(clampNum(
    currentInventoryValue * (inventoryScalingFactor - 1) * 0.7,
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));

  // Bottlenecks — derive from gaps
  const bottlenecks: ScaleBottleneck[] = [];
  // Capital gap
  if (capitalRequirement > current.scaleCapacity.capitalCapacity) {
    bottlenecks.push({
      bottleneck: 'Capital gap — dodatni kapital potreben za inventory scaling.',
      impact: `Potreben +${round0(capitalRequirement - current.scaleCapacity.capitalCapacity)}€ nad trenutno kapaciteto.`,
      mitigation: 'Reinvestiraj 80% profita, razmisli o short-term financing (0% credit card) ali partner capital.',
    });
  }
  // Sourcing capacity
  if (inventoryScalingFactor > 2) {
    bottlenecks.push({
      bottleneck: 'Sourcing depth — 3x več deal-ov potrebnih za inventory scaling.',
      impact: `Trenutno ${Math.round(current.currentScale.tradeVolumePerMonth)} trades/mo, potrebno ${Math.round(current.currentScale.tradeVolumePerMonth * inventoryScalingFactor)}.`,
      mitigation: 'Avtomatiziraj monitor alert-e, dodaj 3 nove monitorje z širšimi kategorijami, batch sourcing ob vikendih.',
    });
  }
  // Time capacity
  const requiredTime = Math.min(168, current.scaleCapacity.timeCapacity * turnoverScalingFactor);
  if (requiredTime > current.scaleCapacity.timeCapacity * 1.5) {
    bottlenecks.push({
      bottleneck: 'Time capacity — obratovalni čas ne sledi scaling.',
      impact: `Potrebno ~${round0(requiredTime)}h/teden, na voljo ${current.scaleCapacity.timeCapacity}h.`,
      mitigation: 'Avtomatiziraj listing creation, VAs za customer service, batch operations za pricing/repricing.',
    });
  }
  // Logistics
  const requiredLogistics = current.currentScale.tradeVolumePerMonth * turnoverScalingFactor;
  if (requiredLogistics > current.scaleCapacity.logisticsCapacity) {
    bottlenecks.push({
      bottleneck: 'Logistics capacity — shipping/handling ne sledi volume.',
      impact: `Potrebno ${round0(requiredLogistics)} items/mo, kapaciteta ${current.scaleCapacity.logisticsCapacity}.`,
      mitigation: 'Outsource shipping na Packeta/DPD, batch packaging, drop-ship model za high-volume kategorije.',
    });
  }
  // Market depth
  if (marginScalingFactor > 1.3) {
    bottlenecks.push({
      bottleneck: 'Market depth — premium pricing zahteva dovolj buyer demand.',
      impact: 'Margin scaling 1.3x+ zahteva premium segment positioning.',
      mitigation: 'Razširi na 3+ platforme (Bolha + mobile.de + Vinted) za večji buyer pool, premium fotografija + certifikati.',
    });
  }

  // Action plan: 3 phases (2x → 3x → 5x)
  const phases: ScaleActionPhase[] = [
    {
      phase: 'Phase 1 — Foundation (2x)',
      targetProfit: round0(clampNum(
        current.currentMonthlyProfit * 2, PROFIT_MIN, PROFIT_MAX, 0,
      )),
      timeline: '1-3 meseci',
      actions: [
        `Povečaj inventory iz ${current.currentScale.inventorySize} na ${Math.round(current.currentScale.inventorySize * 2)} items.`,
        `Dvigni trade volume na ${Math.round(current.currentScale.tradeVolumePerMonth * 2)} trades/mo z aktivnejšim sourcingom.`,
        'Avtomatiziraj monitor alert-e za 24/7 deal detection.',
        'Cross-post vse listing-e na 3 platforme za hitrejši turnover.',
      ],
    },
    {
      phase: 'Phase 2 — Acceleration (3x)',
      targetProfit: round0(clampNum(
        current.currentMonthlyProfit * 3, PROFIT_MIN, PROFIT_MAX, 0,
      )),
      timeline: '4-6 meseci',
      actions: [
        `Razširi inventory na ${Math.round(current.currentScale.inventorySize * 3)} items z additional capital injection.`,
        'Onboard VA za customer service + listing creation (8h/teden sproščeno).',
        'Dvigni avg profit per trade za 30% z premium pricing + refurbish enhancement.',
        'Dodaj 2 nova source-a (mobile.de + Vinted) za diversifikacijo.',
      ],
    },
    {
      phase: 'Phase 3 — Scale (5x)',
      targetProfit: targetMonthlyProfit,
      timeline: '7-12 meseci',
      actions: [
        `Inventory ${Math.round(current.currentScale.inventorySize * 5)} items z ${round0(capitalRequirement)}€ capital deployed.`,
        'Setup batch operations: weekly sourcing, daily listing, daily shipping.',
        'Premium pricing strategy z 1.5x margin scaling.',
        'Hire part-time logistics assistant za 20h/teden.',
      ],
    },
  ];

  const scaleTimeline = clampString(
    `12-mesečni scale plan od ${current.currentMonthlyProfit}€/mo na ${targetMonthlyProfit}€/mo (${scaleMultiplier}x). ` +
    `Phase 1 (3mo): 2x=${round0(current.currentMonthlyProfit * 2)}€. Phase 2 (6mo): 3x=${round0(current.currentMonthlyProfit * 3)}€. ` +
    `Phase 3 (12mo): ${scaleMultiplier}x=${targetMonthlyProfit}€. Bottlenecks: ${bottlenecks.length}. ` +
    `Capital requirement: ${capitalRequirement}€.`,
    400,
    `12-mesečni scale plan do ${targetMonthlyProfit}€/mo (${scaleMultiplier}x).`,
  );

  // Risk assessment
  const risks: ScaleRisk[] = [
    {
      risk: 'Capital gap — pomanjkanje kapitala za inventory expansion.',
      severity: capitalRequirement > current.scaleCapacity.capitalCapacity * 2 ? 'HIGH' : 'MEDIUM',
      mitigation: 'Reinvestiraj profit, postopni scaling (Phase 1 → 2 → 3) z minimalnim capital injection.',
    },
    {
      risk: 'Sourcing burnout — prevelik sourcing pritisk za operaterja.',
      severity: inventoryScalingFactor > 3 ? 'HIGH' : 'MEDIUM',
      mitigation: 'Avtomatiziraj monitorje, batch sourcing, eventualno VA sourcing assistant.',
    },
    {
      risk: 'Market depth — omejen buyer demand za premium pricing.',
      severity: marginScalingFactor > 1.4 ? 'MEDIUM' : 'LOW',
      mitigation: 'Diversificiraj preko 3+ platform in kategorij.',
    },
    {
      risk: 'Quality dilution — večji volume lahko zmanjša avg profit per trade.',
      severity: 'MEDIUM',
      mitigation: 'Vzdržuj dealScore threshold ≥60 za vse buys, ne kompromitiraj sourcing criteria.',
    },
  ];

  const scaleGrade = decideGrade(scaleMultiplier, bottlenecks.length);

  return {
    targetMonthlyProfit,
    scaleMultiplier,
    scaleRequirements: {
      inventoryScalingFactor,
      turnoverScalingFactor,
      marginScalingFactor,
      capitalRequirement,
    },
    scaleBottlenecks: bottlenecks.slice(0, MAX_BOTTLENECKS),
    scaleActionPlan: phases.slice(0, MAX_ACTION_PHASES),
    scaleTimeline,
    scaleRiskAssessment: risks.slice(0, MAX_RISKS),
    scaleGrade,
  };
}

function buildSummary(current: CurrentState, scaling: Scaling): string {
  const parts: string[] = [
    `Current: ${current.currentMonthlyProfit}€/mo profit, ${current.currentScale.inventorySize} items, ${Math.round(current.currentScale.tradeVolumePerMonth)} trades/mo, ROI ${current.currentScale.avgROI}%.`,
    `Scaling target: ${scaling.targetMonthlyProfit}€/mo (${scaling.scaleMultiplier}x) — inventory ${scaling.scaleRequirements.inventoryScalingFactor}x, turnover ${scaling.scaleRequirements.turnoverScalingFactor}x, margin ${scaling.scaleRequirements.marginScalingFactor}x.`,
    `Capital requirement: ${scaling.scaleRequirements.capitalRequirement}€. Bottlenecks: ${scaling.scaleBottlenecks.length}. Grade: ${scaling.scaleGrade}.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- AI prompt + merge helpers (pure, extracted OUTSIDE handler) ----------

function buildPromptData(agg: SoldAgg, heldCount: number, current: CurrentState, scaling: Scaling) {
  return {
    soldCount12m: agg.count12m,
    profit12m: round0(agg.profit12m),
    heldInventorySize: heldCount,
    current,
    deterministicScaling: {
      targetMonthlyProfit: scaling.targetMonthlyProfit,
      scaleMultiplier: scaling.scaleMultiplier,
      scaleRequirements: scaling.scaleRequirements,
      scaleBottlenecks: scaling.scaleBottlenecks.map((b) => ({
        bottleneck: b.bottleneck,
        impact: b.impact,
      })),
      scaleGrade: scaling.scaleGrade,
    },
    caps: {
      profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
      factorMin: FACTOR_MIN, factorMax: FACTOR_MAX,
      multMin: MULT_MIN, multMax: MULT_MAX,
      capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
      timeMin: TIME_MIN, timeMax: TIME_MAX,
      logisticsMin: LOGISTICS_MIN, logisticsMax: LOGISTICS_MAX,
      roiMin: ROI_MIN, roiMax: ROI_MAX,
    },
  };
}

function buildPrompt(promptData: ReturnType<typeof buildPromptData>): string {
  return `Si AI "Profit Scale Engine" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za SCALING profit-a za EXPONENTIAL growth — NE optimiziraš trenutne operacije, ampak načrtuješ scaling CELEGA business-a. Tvoj cilj je identificirati kako scale-at iz npr. 2000€/mo na 10,000€/mo z inventory scaling, turnover scaling, margin scaling, bottleneck analizo in phased action plan. Razlika od profit-multiplier-engine (v8.00 ki MULTIPLICIRA profit z 8 levers) — ti SCALE-A cel business z exponential growth plan (phased: 2x → 3x → 5x). Razlika od revenue-growth-maximizer (v8.01 ki maksimizira REVENUE growth) — ti SCALE-A PROFIT (bottom-line) z bottlenecks in capacity analysis. Razlika od inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital efficiency per item) — ti daje GLOBAL scale plan z bottlenecks in phased timeline.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih + HELD inventarja):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. scaleBottlenecks: 3-6 bottleneck-ov { bottleneck (string, max 200, slovenski), impact (string, max 200, slovenski), mitigation (string, max 200, slovenski) },
2. scaleActionPlan: 3-4 phase { phase (string, max 100, slovenski), targetProfit € [0, 100000], timeline (string, max 100, slovenski), actions 3-6 stringov (max 200 vsak, slovenski) },
3. scaleTimeline: slovenski povzetek celotne scaling timeline (max 400 znakov),
4. scaleRiskAssessment: 3-6 risk-ov { risk (string, max 200, slovenski), severity LOW | MEDIUM | HIGH, mitigation (string, max 200, slovenski) },
5. scaleGrade: A+ | A | B | C | D | F (A+ če multiplier ≥ 5.0 in ≤2 bottlenecka, A ≥ 3.5 in ≤3, B ≥ 2.5 in ≤4, C ≥ 1.8, D ≥ 1.3, else F),
6. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "scaleBottlenecks": [
    { "bottleneck": "Capital gap.", "impact": "+5000€ potrebnih.", "mitigation": "Reinvestiraj profit." }
  ],
  "scaleActionPlan": [
    { "phase": "Phase 1 — 2x", "targetProfit": 4000, "timeline": "1-3 meseci", "actions": ["Povečaj inventory.", "Avtomatiziraj sourcing."] }
  ],
  "scaleTimeline": "12-mesečni scale plan od 2000€ na 10000€.",
  "scaleRiskAssessment": [
    { "risk": "Capital gap.", "severity": "HIGH", "mitigation": "Reinvestiraj profit." }
  ],
  "scaleGrade": "B",
  "summary": "Current: 2000€/mo. Scaling target: 10000€/mo (5x) z 3 phases."
}${GROUNDING_PROMPT_SUFFIX}`;
}

interface MergeResult {
  scaling: Scaling;
  summary: string;
  aiUsed: boolean;
}

function mergeAiIntoScaling(
  parsed: AiResponse | null,
  detScaling: Scaling,
  current: CurrentState,
): MergeResult {
  let scaling = detScaling;
  let summary = buildSummary(current, detScaling);
  let aiUsed = false;

  if (parsed && typeof parsed === 'object') {
    // Override bottlenecks if AI provided ≥3
    if (Array.isArray(parsed.scaleBottlenecks) && parsed.scaleBottlenecks.length >= 3) {
      const aiBottlenecks: ScaleBottleneck[] = [];
      for (const b of parsed.scaleBottlenecks.slice(0, MAX_BOTTLENECKS)) {
        if (!b || typeof b !== 'object') continue;
        aiBottlenecks.push({
          bottleneck: clampString(b.bottleneck, 200, 'Bottleneck.'),
          impact: clampString(b.impact, 200, 'Vpliv na scaling.'),
          mitigation: clampString(b.mitigation, 200, 'Mitigacija.'),
        });
      }
      if (aiBottlenecks.length >= 3) {
        scaling = { ...scaling, scaleBottlenecks: aiBottlenecks };
      }
    }

    // Override action plan if AI provided ≥2 phases
    if (Array.isArray(parsed.scaleActionPlan) && parsed.scaleActionPlan.length >= 2) {
      const aiPhases: ScaleActionPhase[] = [];
      for (const p of parsed.scaleActionPlan.slice(0, MAX_ACTION_PHASES)) {
        if (!p || typeof p !== 'object') continue;
        const actions = Array.isArray(p.actions)
          ? p.actions.slice(0, MAX_ACTIONS_PER_PHASE).map((a) =>
              clampString(a, 200, 'Akcija scaling.'),
            )
          : [];
        if (actions.length < 3) continue;
        aiPhases.push({
          phase: clampString(p.phase, 100, 'Phase.'),
          targetProfit: round0(clampNum(
            p.targetProfit, PROFIT_MIN, PROFIT_MAX, 0,
          )),
          timeline: clampString(p.timeline, 100, '1-3 meseci'),
          actions,
        });
      }
      if (aiPhases.length >= 2) {
        scaling = { ...scaling, scaleActionPlan: aiPhases };
      }
    }

    // Override timeline
    if (typeof parsed.scaleTimeline === 'string' && parsed.scaleTimeline.trim()) {
      scaling = {
        ...scaling,
        scaleTimeline: clampString(parsed.scaleTimeline, 400, scaling.scaleTimeline),
      };
    }

    // Override risk assessment if AI provided ≥3
    if (Array.isArray(parsed.scaleRiskAssessment) && parsed.scaleRiskAssessment.length >= 3) {
      const aiRisks: ScaleRisk[] = [];
      for (const r of parsed.scaleRiskAssessment.slice(0, MAX_RISKS)) {
        if (!r || typeof r !== 'object') continue;
        aiRisks.push({
          risk: clampString(r.risk, 200, 'Risk.'),
          severity: clampEnum(r.severity, VALID_SEVERITY, 'MEDIUM'),
          mitigation: clampString(r.mitigation, 200, 'Mitigacija.'),
        });
      }
      if (aiRisks.length >= 3) {
        scaling = { ...scaling, scaleRiskAssessment: aiRisks };
      }
    }

    // Override grade (re-decide based on AI bottlenecks count)
    const finalGrade = parsed.scaleGrade
      ? clampEnum(parsed.scaleGrade, VALID_GRADE, decideGrade(
          scaling.scaleMultiplier, scaling.scaleBottlenecks.length,
        ))
      : decideGrade(scaling.scaleMultiplier, scaling.scaleBottlenecks.length);
    scaling = { ...scaling, scaleGrade: finalGrade };

    summary = clampString(parsed.summary, 400, buildSummary(current, scaling));
    aiUsed = true;
  }

  return { scaling, summary, aiUsed };
}

// --- Handler -------------------------------------------------------------

const profitScaleHandler = withAiRoute<ProfitScaleEngineInput>({
  endpoint: '/api/ai/profit-scale-engine',
  maxDuration: 60,
  enforceBudget: true,
  method: 'GET',

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;
    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Parallel query SOLD trades last 12m + HELD trades for capacity
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
          buyDate: true,
          sellPrice: true,
          sellFees: true,
          sellDate: true,
          category: true,
        },
        orderBy: { sellDate: 'asc' },
        take: 100000,
      }) as unknown as SoldTradeRow[],
      db.trade.findMany({
        where: { status: 'held' },
        select: {
          id: true,
          buyPrice: true,
          buyFees: true,
          buyDate: true,
        },
        take: MAX_HELD_FOR_CAPACITY,
      }) as unknown as HeldTradeRow[],
    ]);

    // Empty-state: no SOLD trades
    if (soldTrades.length === 0) {
      return apiOk({
        ok: true,
        current: {
          currentMonthlyProfit: 0,
          currentScale: {
            inventorySize: heldTrades.length,
            tradeVolumePerMonth: 0,
            avgProfitPerTrade: 0,
            avgROI: 0,
          },
          scaleCapacity: {
            capitalCapacity: 0,
            timeCapacity: 20,
            logisticsCapacity: 5,
          },
        },
        scaling: {
          targetMonthlyProfit: 0,
          scaleMultiplier: 1,
          scaleRequirements: {
            inventoryScalingFactor: 1,
            turnoverScalingFactor: 1,
            marginScalingFactor: 1,
            capitalRequirement: 0,
          },
          scaleBottlenecks: [],
          scaleActionPlan: [],
          scaleTimeline: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Scale Engine ni mogoč.',
          scaleRiskAssessment: [],
          scaleGrade: 'F',
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Scale Engine ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Scale Engine ni mogoč.',
      } satisfies ProfitScaleResponse);
    }

    // 2) Compute aggregates
    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c) soldComputed.push(c);
    }
    const agg = aggregateSold(soldComputed);
    const current = computeCurrent(agg, heldTrades.length);

    const detScaling = buildDeterministicScaling(current);
    let scaling = detScaling;
    let summary = buildSummary(current, detScaling);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `profit-scale-engine:${currentMonth}`;
    const cached = getCachedAI<{
      scaling: Scaling;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        current,
        scaling: cached.scaling,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies ProfitScaleResponse);
    }

    // 4) AI prompt with grounding
    const promptData = buildPromptData(agg, heldTrades.length, current, detScaling);
    const prompt = buildPrompt(promptData);

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      const merged = mergeAiIntoScaling(parsed, detScaling, current);
      scaling = merged.scaling;
      summary = merged.summary;
      aiUsed = merged.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/profit-scale-engine',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { scaling, summary });
    }

    return apiOk({
      ok: true,
      current,
      scaling,
      summary,
      aiUsed,
    } satisfies ProfitScaleResponse);
  },
});

export const GET = profitScaleHandler;
export const POST = profitScaleHandler;
