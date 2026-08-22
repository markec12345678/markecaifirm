// v7.93: AI Profit Margin Acceleration Tracker — AI track-a POSPEŠEK
// (acceleration = 2nd derivative) profitne marže. Ne samo "ali se marža
// izboljšuje?" (ki ga pokriva profit-margin-trend-analyzer v7.82) temveč
// "ali se HITROST izboljševanja marže pospešuje ali upočasnuje?". Compute-a
// 2nd derivative of monthly margin trends in klasificira acceleration stanje.
// "Margin: ACCELERATING_UP (momentum +2%/mo, accel +0.5%/mo²). Inflection: no
// reversal expected. 30d projection: 28%. Driver: price increases."
//
// Razlika od profit-margin-trend-analyzer (v7.82 ki track-a 1st-derivative
// margin trend) — ta gleda 2nd-derivative ACCELERATION (ali hitrost
// izboljševanja marže pospešuje ali upada). Razlika od profit-margin-forecaster-
// pro (v7.85 ki forecast-a margin z scenarios) — ta gleda ACCELERATION z
// inflection point detection. Razlika od profit-margin-optimizer-v2 (ki
// optimira margin) — ta gleda acceleration drivers in risks. Razlika od
// profit-margin-heatmap (ki prikazuje margin distribution) — ta gleda časovno
// trajektorijo marže. Razlika od profit-momentum-tracker (v7.75 ki track-a
// profit momentum) — ta gleda MARGIN-specifično acceleration. Razlika od
// profit-accelerator (v7.71 ki da acceleration actions) — ta track-a
// HISTORICAL margin acceleration čez 12 mesecev z projected trajectory.
//
// GET+POST /api/ai/profit-margin-acceleration-tracker
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.5) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitMarginAccelerationTrackerInput {}

// --- Types ---------------------------------------------------------------

type MarginClassification =
  | 'ACCELERATING_UP'
  | 'STEADY_UP'
  | 'DECELERATING_UP'
  | 'FLAT'
  | 'DECELERATING_DOWN'
  | 'ACCELERATING_DOWN';

type DriverImpact = 'POSITIVE' | 'NEGATIVE';
type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

interface MarginMomentum {
  marginMomentum: number; // slope per month (1st derivative)
  markupMomentum: number; // slope per month (1st derivative)
  profitPerTradeMomentum: number; // slope per month (1st derivative)
}

interface MarginAcceleration {
  marginAcceleration: number; // 2nd derivative
  markupAcceleration: number; // 2nd derivative
  profitAcceleration: number; // 2nd derivative
  compositeAccelerationScore: number; // 0-100 weighted
}

interface Derivatives {
  momentum: MarginMomentum;
  acceleration: MarginAcceleration;
  classification: MarginClassification;
}

interface MonthlyDataPoint {
  month: string; // ISO date (month start)
  avgMargin: number; // %
  avgMarkup: number; // %
  avgProfitPerTrade: number; // EUR
}

interface AccelerationDriver {
  driver: string;
  impact: DriverImpact;
  weight: number; // 0-100
  detail: string;
}

interface OptimizationAction {
  action: string;
  priority: ActionPriority;
  expectedMarginLift: number; // percentage points
}

interface AccelerationRisk {
  risk: string;
  severity: RiskSeverity;
  mitigation: string;
}

interface MarginAnalysis {
  accelerationAssessment: string;
  marginInflectionPoint: string | null;
  accelerationDrivers: AccelerationDriver[];
  projectedMargin30d: number; // %
  marginOptimizationActions: OptimizationAction[];
  accelerationRiskFactors: AccelerationRisk[];
  confidenceLevel: number; // 0-100
}

interface AiMarginResponse {
  accelerationAssessment?: string;
  marginInflectionPoint?: string | null;
  accelerationDrivers?: Array<{
    driver?: string;
    impact?: DriverImpact;
    weight?: number;
    detail?: string;
  }>;
  projectedMargin30d?: number;
  marginOptimizationActions?: Array<{
    action?: string;
    priority?: ActionPriority;
    expectedMarginLift?: number;
  }>;
  accelerationRiskFactors?: Array<{
    risk?: string;
    severity?: RiskSeverity;
    mitigation?: string;
  }>;
  confidenceLevel?: number;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const MONTHS_12 = 12;
const MARGIN_MIN = -50;
const MARGIN_MAX = 100;
const ACCEL_MIN = -100;
const ACCEL_MAX = 100;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const WEIGHT_MIN = 0;
const WEIGHT_MAX = 100;
const LIFT_MIN = -5;
const LIFT_MAX = 20;
const CONF_MIN = 0;
const CONF_MAX = 100;

const VALID_IMPACT: readonly DriverImpact[] = ['POSITIVE', 'NEGATIVE'];
const VALID_SEVERITY: readonly RiskSeverity[] = ['LOW', 'MEDIUM', 'HIGH'];
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

// 2nd derivative: slope of second half minus slope of first half
function computeAcceleration(values: number[]): number {
  if (values.length < 4) return 0;
  const mid = Math.floor(values.length / 2);
  const firstSlope = trendSlope(values.slice(0, mid));
  const secondSlope = trendSlope(values.slice(mid));
  return secondSlope - firstSlope;
}

// Normalize a momentum value to 0-100 score
function normalizeScore(value: number, maxAbs: number): number {
  if (maxAbs <= 0) return 50;
  const clamped = Math.max(-maxAbs, Math.min(maxAbs, value));
  return round0(50 + (clamped / maxAbs) * 50);
}

// Classify margin acceleration: combine momentum direction + acceleration sign
function classifyAcceleration(
  marginMomentum: number,
  marginAcceleration: number,
  compositeScore: number,
): MarginClassification {
  const momentumThreshold = 0.3; // %/mo
  const accelThreshold = 0.15; // %/mo²

  const improving = marginMomentum > momentumThreshold;
  const declining = marginMomentum < -momentumThreshold;
  const accelUp = marginAcceleration > accelThreshold;
  const accelDown = marginAcceleration < -accelThreshold;

  if (improving && accelUp) return 'ACCELERATING_UP';
  if (improving && !accelUp && !accelDown) return 'STEADY_UP';
  if (improving && accelDown) return 'DECELERATING_UP';
  if (declining && accelDown) return 'ACCELERATING_DOWN';
  if (declining && !accelUp && !accelDown) return 'FLAT';
  if (declining && accelUp) return 'DECELERATING_DOWN';

  // Near-zero momentum — fall back to composite score
  if (compositeScore >= 65) return 'STEADY_UP';
  if (compositeScore <= 35) return 'FLAT';
  return 'FLAT';
}

// --- Trade row type -------------------------------------------------------

interface SoldTradeRow {
  buyPrice: number;
  buyFees: number;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
}

// --- Monthly aggregation -------------------------------------------------

interface MonthAgg {
  marginSum: number; // sum of per-trade margins
  markupSum: number; // sum of per-trade markups
  profitSum: number; // sum of per-trade profits
  count: number;
}

function newMonthAgg(): MonthAgg {
  return { marginSum: 0, markupSum: 0, profitSum: 0, count: 0 };
}

// --- Deterministic analysis ----------------------------------------------

function buildDeterministicAnalysis(
  monthly: MonthAgg[],
  derivatives: Derivatives,
): MarginAnalysis {
  const lastMonth = monthly[monthly.length - 1];
  const lastMargin = lastMonth && lastMonth.count > 0
    ? lastMonth.marginSum / lastMonth.count
    : 0;

  // Project margin 30d using momentum + acceleration
  const marginMomentum = derivatives.momentum.marginMomentum;
  const marginAcceleration = derivatives.acceleration.marginAcceleration;
  // Project next month = lastMargin + momentum + 0.5 × acceleration (2nd-order extrapolation)
  const projectedMargin30d = round1(
    Math.max(MARGIN_MIN, Math.min(MARGIN_MAX,
      lastMargin + marginMomentum + 0.5 * marginAcceleration)),
  );

  // Acceleration assessment
  const cls = derivatives.classification;
  const score = derivatives.acceleration.compositeAccelerationScore;
  const assessmentParts: string[] = [];
  switch (cls) {
    case 'ACCELERATING_UP':
      assessmentParts.push(`Marža se izboljšuje in POSPEŠUJE (composite ${score}/100).`);
      break;
    case 'STEADY_UP':
      assessmentParts.push(`Marža se izboljšuje s stalno hitrostjo (composite ${score}/100).`);
      break;
    case 'DECELERATING_UP':
      assessmentParts.push(`Marža se izboljšuje VSE POASNEJE (composite ${score}/100).`);
      break;
    case 'FLAT':
      assessmentParts.push(`Marža je stabilna brez signifikantnega trenda (composite ${score}/100).`);
      break;
    case 'DECELERATING_DOWN':
      assessmentParts.push(`Marža pada VSE POASNEJE — možen povratek (composite ${score}/100).`);
      break;
    case 'ACCELERATING_DOWN':
      assessmentParts.push(`Marža pada in POSPEŠUJE navzdol (composite ${score}/100).`);
      break;
  }
  assessmentParts.push(`Trenutna marža: ${round1(lastMargin)}%, mesečna sprememba: ${round1(marginMomentum)}%/mo, pospešek: ${round1(marginAcceleration)}%/mo².`);
  assessmentParts.push(`30-dnevna projekcija: ${projectedMargin30d}%.`);
  const assessment = assessmentParts.join(' ').slice(0, 500);

  // Inflection point — when margin trend might reverse
  let marginInflectionPoint: string | null = null;
  if (cls === 'DECELERATING_UP' && marginAcceleration < 0) {
    // Project when momentum reaches zero
    const monthsToZero = marginMomentum > 0
      ? Math.ceil(-marginMomentum / marginAcceleration)
      : 0;
    if (monthsToZero > 0 && monthsToZero <= 6) {
      const inflectionDate = new Date();
      inflectionDate.setMonth(inflectionDate.getMonth() + monthsToZero);
      marginInflectionPoint = `Pričakovan obrat (peak margin) čez ~${monthsToZero} mesecev (${inflectionDate.toISOString().slice(0, 7)}). Po tem se bo stopnja izboljševanja marže zmanjšala ali prešla v stagnacijo.`.slice(0, 300);
    } else if (monthsToZero > 6) {
      marginInflectionPoint = `Trenutni upadajoči pospešek kaže na možen obrat čez ${monthsToZero} mesecev — vendar je to dolgoročna projekcija.`.slice(0, 300);
    }
  } else if (cls === 'DECELERATING_DOWN' && marginAcceleration > 0) {
    const monthsToZero = marginMomentum < 0
      ? Math.ceil(-marginMomentum / marginAcceleration)
      : 0;
    if (monthsToZero > 0 && monthsToZero <= 6) {
      marginInflectionPoint = `Pričakovan konec padanja marže čez ~${monthsToZero} mesecev — nato se bo marža stabilizirala ali začela rasti.`.slice(0, 300);
    }
  } else if (cls === 'ACCELERATING_DOWN') {
    marginInflectionPoint = `Ne vidimo inflection signala — padajoči trend se še krepi. Potreben takojšen poseg (znižanje cene, sprememba kategorije).`.slice(0, 300);
  } else if (cls === 'ACCELERATING_UP' || cls === 'STEADY_UP') {
    marginInflectionPoint = `Ne vidimo inflection signala — izboljševanje marže se nadaljuje. Pričakuj vzdrževanje trenda.`.slice(0, 300);
  }

  // Drivers: based on which derivative component is strongest
  const drivers: AccelerationDriver[] = [];
  const driverComponents: Array<{ name: string; score: number; kind: 'margin' | 'markup' | 'profit' }> = [
    { name: 'Margin acceleration', score: normalizeScore(derivatives.acceleration.marginAcceleration, 2), kind: 'margin' },
    { name: 'Markup acceleration', score: normalizeScore(derivatives.acceleration.markupAcceleration, 2), kind: 'markup' },
    { name: 'Profit-per-trade acceleration', score: normalizeScore(derivatives.acceleration.profitAcceleration, 50), kind: 'profit' },
  ];
  driverComponents.sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50));
  for (const c of driverComponents.slice(0, 3)) {
    const impact: DriverImpact = c.score >= 50 ? 'POSITIVE' : 'NEGATIVE';
    const weight = round0(Math.abs(c.score - 50) * 2);
    const detail =
      c.kind === 'margin'
        ? `Sprememba marže se ${c.score >= 50 ? 'pospešuje navzgor' : 'upočasnjuje'} (score ${c.score}/100).`
        : c.kind === 'markup'
          ? `Sprememba markup-a se ${c.score >= 50 ? 'pospešuje navzgor' : 'upočasnjuje'} (score ${c.score}/100).`
          : `Sprememba profita na trgovino se ${c.score >= 50 ? 'pospešuje navzgor' : 'upočasnjuje'} (score ${c.score}/100).`;
    drivers.push({
      driver: c.name,
      impact,
      weight: Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, weight)),
      detail: detail.slice(0, 200),
    });
  }

  // Optimization actions based on classification
  const actions: OptimizationAction[] = [];
  switch (cls) {
    case 'ACCELERATING_UP':
      actions.push({ action: 'Povečaj obseg nabave — izkoristi pospešujoč maržni trend z dodatnim volumenom.', priority: 'HIGH', expectedMarginLift: 2 });
      actions.push({ action: 'Povišaj cene za 3-5% — trg absorbira višje cene (pospešujoča marža kaže na to).', priority: 'MEDIUM', expectedMarginLift: 3 });
      actions.push({ action: 'Diversificiraj vire — prepreči koncentracijo tveganja pri eni kategoriji.', priority: 'LOW', expectedMarginLift: 1 });
      break;
    case 'STEADY_UP':
      actions.push({ action: 'Vzdržuj trenutno strategijo — konstantna rast marže je zdrava.', priority: 'MEDIUM', expectedMarginLift: 1 });
      actions.push({ action: 'Optimiziraj B-side (nabavne cene) za pospešitev trenda.', priority: 'MEDIUM', expectedMarginLift: 2 });
      actions.push({ action: 'Testiraj višje cene na 20% inventorija za zagon acceleration.', priority: 'LOW', expectedMarginLift: 2 });
      break;
    case 'DECELERATING_UP':
      actions.push({ action: 'Maksimiziraj profit pred inflection point-om — povišaj cene na top-tier inventoriju.', priority: 'HIGH', expectedMarginLift: 3 });
      actions.push({ action: 'Identificiraj vzroke upadanja acceleration (nasičenje, konkurenca).', priority: 'HIGH', expectedMarginLift: 1 });
      actions.push({ action: 'Diversificiraj v nove kategorije za nov momentum.', priority: 'MEDIUM', expectedMarginLift: 2 });
      break;
    case 'FLAT':
      actions.push({ action: 'Testiraj cenovne spremembe (A/B) za zagon novega trenda.', priority: 'MEDIUM', expectedMarginLift: 2 });
      actions.push({ action: 'Optimiziraj nabavne kanale za znižanje cost basis.', priority: 'MEDIUM', expectedMarginLift: 2 });
      actions.push({ action: 'Dodaj nove kategorije za diversifikacijo.', priority: 'LOW', expectedMarginLift: 1 });
      break;
    case 'DECELERATING_DOWN':
      actions.push({ action: 'Pospeši izhod iz stagnirajočih kategorij.', priority: 'HIGH', expectedMarginLift: 1 });
      actions.push({ action: 'Premakni kapital v kategorije z rastočo maržo.', priority: 'HIGH', expectedMarginLift: 3 });
      actions.push({ action: 'Stabiliziraj cene — prepreči nadaljnje upadanje.', priority: 'MEDIUM', expectedMarginLift: 1 });
      break;
    case 'ACCELERATING_DOWN':
      actions.push({ action: 'TAKOJŠNJA akcija — povišaj cene ali zmanjšaj volume da ustaviš padec.', priority: 'HIGH', expectedMarginLift: 5 });
      actions.push({ action: 'Spremeni nabavne vire — morda so trenutni predragi ali slabe kakovosti.', priority: 'HIGH', expectedMarginLift: 3 });
      actions.push({ action: 'Premakni ves inventar v kategorije z rastočo maržo.', priority: 'HIGH', expectedMarginLift: 4 });
      break;
  }

  // Risk factors
  const risks: AccelerationRisk[] = [];
  if (cls === 'ACCELERATING_UP') {
    risks.push({ risk: 'Prehitro pospeševanje lahko signalizira nasičenje trga v prihodnosti.', severity: 'LOW', mitigation: 'Spremljaj volume signale — ko volumen pade, zmanjšaj obseg.' });
    risks.push({ risk: 'Konkurenca lahko posname višje cene.', severity: 'MEDIUM', mitigation: 'Diversificiraj vire in kategorije, gradi brand loyalty.' });
  } else if (cls === 'DECELERATING_UP') {
    risks.push({ risk: 'Upadajoča acceleration napoveduje inflection point (peak marže).', severity: 'HIGH', mitigation: 'Maksimiziraj profit pred peak, pripravi exit strategijo.' });
    risks.push({ risk: 'Možen prihod konkurence v kategorijo.', severity: 'MEDIUM', mitigation: 'Gradi moat (long-term relationships, exkluzivni viri).' });
  } else if (cls === 'ACCELERATING_DOWN') {
    risks.push({ risk: 'Pospešujoč padec marže — tveganje capital loss.', severity: 'HIGH', mitigation: 'Takojšnja akcija — zmanjšaj volume, optimiziraj pricing.' });
    risks.push({ risk: 'Trg morda postaja nasičen ali nelikviden.', severity: 'HIGH', mitigation: 'Premakni kapital v druge kategorije ali vire.' });
  } else if (cls === 'FLAT') {
    risks.push({ risk: 'Stagnacija — izguba priložnosti za rast.', severity: 'LOW', mitigation: 'Testiraj nove strategije za zagon trenda.' });
  } else {
    risks.push({ risk: 'Trend je negotljiv — spremljaj signale.', severity: 'MEDIUM', mitigation: 'Vzdržuj monitoring in prilagajaj strategijo.' });
  }
  // Sample size risk
  const totalTrades = monthly.reduce((s, m) => s + m.count, 0);
  if (totalTrades < 20) {
    risks.push({ risk: 'Majhna vzorčna osnova — acceleration ocena je negotljiva.', severity: 'MEDIUM', mitigation: 'Počakaj na več trgov (vsaj 20) preden zcela zaupaš acceleration score.' });
  }

  // Confidence level
  const activeMonths = monthly.filter((m) => m.count > 0).length;
  let confidence = 30;
  confidence += Math.min(30, activeMonths * 4); // more months = more reliable
  confidence += Math.min(20, Math.min(50, totalTrades) * 0.4);
  if (Math.abs(derivatives.acceleration.compositeAccelerationScore - 50) > 30) {
    confidence += 10; // strong signal = more confident
  }
  if (cls === 'FLAT') confidence -= 5;
  confidence = round0(Math.max(CONF_MIN, Math.min(CONF_MAX, confidence)));

  return {
    accelerationAssessment: assessment,
    marginInflectionPoint,
    accelerationDrivers: drivers.slice(0, 3),
    projectedMargin30d,
    marginOptimizationActions: actions.slice(0, 3),
    accelerationRiskFactors: risks.slice(0, 3),
    confidenceLevel: confidence,
  };
}

function buildSummary(
  derivatives: Derivatives,
  analysis: MarginAnalysis,
): string {
  const cls = derivatives.classification;
  const score = derivatives.acceleration.compositeAccelerationScore;
  const mom = derivatives.momentum.marginMomentum;
  const acc = derivatives.acceleration.marginAcceleration;
  const parts = [
    `Margin: ${cls} (momentum ${round1(mom)}%/mo, accel ${round1(acc)}%/mo², score ${score}/100).`,
  ];
  if (analysis.marginInflectionPoint) {
    parts.push(`Inflection: detected.`);
  } else {
    parts.push(`Inflection: no reversal expected.`);
  }
  parts.push(`30d projection: ${analysis.projectedMargin30d}%.`);
  parts.push(`Confidence: ${analysis.confidenceLevel}/100.`);
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

const profitMarginAccelerationTrackerHandler = withAiRoute<ProfitMarginAccelerationTrackerInput>({
  endpoint: '/api/ai/profit-margin-acceleration-tracker',
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
    const cutoff12m = new Date(now - HORIZON_12M);

    // 1) Query all SOLD trades from last 12 months
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
      },
      select: {
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    if (soldTrades.length === 0) {
      return apiOk({
        ok: true,
        derivatives: {
          momentum: { marginMomentum: 0, markupMomentum: 0, profitPerTradeMomentum: 0 },
          acceleration: {
            marginAcceleration: 0,
            markupAcceleration: 0,
            profitAcceleration: 0,
            compositeAccelerationScore: 50,
          },
          classification: 'FLAT',
        },
        monthlyData: [],
        analysis: {
          accelerationAssessment: 'Ni SOLD trgovin v zadnjih 12 mesecih — Margin Acceleration Tracker ni mogoč.',
          marginInflectionPoint: null,
          accelerationDrivers: [],
          projectedMargin30d: 0,
          marginOptimizationActions: [],
          accelerationRiskFactors: [],
          confidenceLevel: 0,
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Margin Acceleration Tracker ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Margin Acceleration Tracker ni mogoč.',
      });
    }

    // 2) Group by month (12 buckets, index 0 = oldest, 11 = newest)
    const monthStartMs = (t: number): number => {
      const d = new Date(t);
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    };
    const thisMonthStart = monthStartMs(now);

    const months: MonthAgg[] = Array.from({ length: MONTHS_12 }, () => newMonthAgg());

    for (const t of soldTrades) {
      const sellMs = toMs(t.sellDate);
      if (sellMs <= 0) continue;
      const sellPrice = t.sellPrice ?? 0;
      const sellFees = t.sellFees ?? 0;
      const buyPrice = t.buyPrice ?? 0;
      const buyFees = t.buyFees ?? 0;
      const revenue = sellPrice - sellFees;
      const cost = buyPrice + buyFees;
      const profit = revenue - cost;
      // margin = profit / revenue × 100 (clamped to avoid division by zero)
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      // markup = (revenue - cost) / cost × 100 = profit / cost × 100
      const markup = cost > 0 ? (profit / cost) * 100 : 0;

      const sellMonthStart = monthStartMs(sellMs);
      const monthsAgo = Math.round((thisMonthStart - sellMonthStart) / (30 * DAY_MS));
      const bucketIdx = 11 - Math.max(0, Math.min(11, monthsAgo));
      if (bucketIdx >= 0 && bucketIdx <= 11) {
        const m = months[bucketIdx]!;
        m.marginSum += margin;
        m.markupSum += markup;
        m.profitSum += profit;
        m.count += 1;
      }
    }

    // 3) Build monthly data array
    const monthlyData: MonthlyDataPoint[] = months.map((m, i) => {
      const monthDate = new Date(thisMonthStart);
      monthDate.setMonth(monthDate.getMonth() - (11 - i));
      return {
        month: monthDate.toISOString().slice(0, 10),
        avgMargin: m.count > 0 ? round1(m.marginSum / m.count) : 0,
        avgMarkup: m.count > 0 ? round1(m.markupSum / m.count) : 0,
        avgProfitPerTrade: m.count > 0 ? round0(m.profitSum / m.count) : 0,
      };
    });

    // 4) Compute derivatives — need ≥2 active months for trend
    const activeIdx = months
      .map((m, i) => ({ i, count: m.count }))
      .filter((x) => x.count > 0);
    if (activeIdx.length < 2) {
      return apiOk({
        ok: true,
        derivatives: {
          momentum: { marginMomentum: 0, markupMomentum: 0, profitPerTradeMomentum: 0 },
          acceleration: {
            marginAcceleration: 0,
            markupAcceleration: 0,
            profitAcceleration: 0,
            compositeAccelerationScore: 50,
          },
          classification: 'FLAT',
        },
        monthlyData,
        analysis: {
          accelerationAssessment: 'Premo aktivnih mesecev (≥2) za trend analizo — Margin Acceleration Tracker ni mogoč.',
          marginInflectionPoint: null,
          accelerationDrivers: [],
          projectedMargin30d: 0,
          marginOptimizationActions: [],
          accelerationRiskFactors: [],
          confidenceLevel: 0,
        },
        summary: 'Premo aktivnih mesecev za margin acceleration analizo.',
        aiUsed: false,
        message: 'Premo aktivnih mesecev za margin acceleration analizo.',
      });
    }

    // Build per-month average series (only over active months — for cleaner trend)
    const marginSeries = months.map((m) => m.count > 0 ? m.marginSum / m.count : 0);
    const markupSeries = months.map((m) => m.count > 0 ? m.markupSum / m.count : 0);
    const profitSeries = months.map((m) => m.count > 0 ? m.profitSum / m.count : 0);

    // 1st derivative (momentum)
    const marginMomentum = trendSlope(marginSeries);
    const markupMomentum = trendSlope(markupSeries);
    const profitPerTradeMomentum = trendSlope(profitSeries);

    // 2nd derivative (acceleration)
    const marginAcceleration = computeAcceleration(marginSeries);
    const markupAcceleration = computeAcceleration(markupSeries);
    const profitAcceleration = computeAcceleration(profitSeries);

    // Composite acceleration score — combine momentum direction + acceleration boost
    const marginAccelScore = normalizeScore(
      marginAcceleration * 3 + marginMomentum * 0.3,
      6,
    );
    const markupAccelScore = normalizeScore(
      markupAcceleration * 3 + markupMomentum * 0.3,
      6,
    );
    const profitAccelScore = normalizeScore(
      profitAcceleration * 0.1 + profitPerTradeMomentum * 0.01,
      50,
    );
    const compositeAccelerationScore = round0(
      Math.max(SCORE_MIN, Math.min(SCORE_MAX,
        marginAccelScore * 0.45 +
        markupAccelScore * 0.30 +
        profitAccelScore * 0.25)),
    );

    // Classify acceleration
    const classification = classifyAcceleration(
      marginMomentum,
      marginAcceleration,
      compositeAccelerationScore,
    );

    const derivatives: Derivatives = {
      momentum: {
        marginMomentum: round1(marginMomentum),
        markupMomentum: round1(markupMomentum),
        profitPerTradeMomentum: round1(profitPerTradeMomentum),
      },
      acceleration: {
        marginAcceleration: round1(marginAcceleration),
        markupAcceleration: round1(markupAcceleration),
        profitAcceleration: round1(profitAcceleration),
        compositeAccelerationScore,
      },
      classification,
    };

    // 5) Build deterministic baseline (fallback)
    const detAnalysis = buildDeterministicAnalysis(months, derivatives);
    let analysis = detAnalysis;
    let summary = buildSummary(derivatives, detAnalysis);

    // 6) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    const cacheKey = `profit-margin-acceleration-tracker:${currentMonth}`;
    const cached = getCachedAI<{ analysis: MarginAnalysis; summary: string }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        derivatives,
        monthlyData,
        analysis: cached.analysis,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 7) AI prompt with grounding (settings loaded by withAiRoute wrapper)
    const prompt = buildPrompt(derivatives, monthlyData, detAnalysis);

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiMarginResponse | null;

      if (parsed && typeof parsed === 'object') {
        const detProj = detAnalysis.projectedMargin30d;
        const projectedMargin30d = round1(
          Math.max(MARGIN_MIN, Math.min(MARGIN_MAX,
            detProj + Math.max(-5, Math.min(5,
              (Number(parsed.projectedMargin30d ?? detProj)) - detProj)))),
        );

        const detConf = detAnalysis.confidenceLevel;
        const confidenceLevel = round0(
          Math.max(CONF_MIN, Math.min(CONF_MAX,
            detConf + Math.max(-10, Math.min(10,
              (Number(parsed.confidenceLevel ?? detConf)) - detConf)))),
        );

        // Drivers
        const drivers: AccelerationDriver[] = [];
        if (Array.isArray(parsed.accelerationDrivers)) {
          for (const d of parsed.accelerationDrivers.slice(0, 3)) {
            if (!d || typeof d !== 'object') continue;
            drivers.push({
              driver: clampString(d.driver, 100, detAnalysis.accelerationDrivers[0]?.driver ?? 'Margin acceleration'),
              impact: clampEnum(d.impact, VALID_IMPACT, detAnalysis.accelerationDrivers[0]?.impact ?? 'POSITIVE'),
              weight: clampNum(d.weight, WEIGHT_MIN, WEIGHT_MAX, detAnalysis.accelerationDrivers[0]?.weight ?? 50),
              detail: clampString(d.detail, 200, detAnalysis.accelerationDrivers[0]?.detail ?? 'Acceleration signal.'),
            });
          }
        }
        if (drivers.length === 0) {
          for (const d of detAnalysis.accelerationDrivers) drivers.push(d);
        }

        // Actions
        const actions: OptimizationAction[] = [];
        if (Array.isArray(parsed.marginOptimizationActions)) {
          for (const a of parsed.marginOptimizationActions.slice(0, 3)) {
            if (!a || typeof a !== 'object') continue;
            actions.push({
              action: clampString(a.action, 200, detAnalysis.marginOptimizationActions[0]?.action ?? 'Maintain strategy.'),
              priority: clampEnum(a.priority, VALID_PRIORITY, detAnalysis.marginOptimizationActions[0]?.priority ?? 'MEDIUM'),
              expectedMarginLift: round1(clampNum(a.expectedMarginLift, LIFT_MIN, LIFT_MAX, detAnalysis.marginOptimizationActions[0]?.expectedMarginLift ?? 1)),
            });
          }
        }
        if (actions.length === 0) {
          for (const a of detAnalysis.marginOptimizationActions) actions.push(a);
        }

        // Risks
        const risks: AccelerationRisk[] = [];
        if (Array.isArray(parsed.accelerationRiskFactors)) {
          for (const r of parsed.accelerationRiskFactors.slice(0, 3)) {
            if (!r || typeof r !== 'object') continue;
            risks.push({
              risk: clampString(r.risk, 200, detAnalysis.accelerationRiskFactors[0]?.risk ?? 'Brez specifičnega tveganja.'),
              severity: clampEnum(r.severity, VALID_SEVERITY, detAnalysis.accelerationRiskFactors[0]?.severity ?? 'LOW'),
              mitigation: clampString(r.mitigation, 200, detAnalysis.accelerationRiskFactors[0]?.mitigation ?? 'Vzdržuj strategijo.'),
            });
          }
        }
        if (risks.length === 0) {
          for (const r of detAnalysis.accelerationRiskFactors) risks.push(r);
        }

        // Inflection point
        const marginInflectionPoint = parsed.marginInflectionPoint === null || parsed.marginInflectionPoint === undefined
          ? detAnalysis.marginInflectionPoint
          : clampString(parsed.marginInflectionPoint, 300, detAnalysis.marginInflectionPoint ?? '');

        analysis = {
          accelerationAssessment: clampString(parsed.accelerationAssessment, 500, detAnalysis.accelerationAssessment),
          marginInflectionPoint,
          accelerationDrivers: drivers,
          projectedMargin30d,
          marginOptimizationActions: actions,
          accelerationRiskFactors: risks,
          confidenceLevel,
        };
        summary = clampString(parsed.summary, 400, buildSummary(derivatives, analysis));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/profit-margin-acceleration-tracker',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { analysis, summary });
    }

    return apiOk({
      ok: true,
      derivatives,
      monthlyData,
      analysis,
      summary,
      aiUsed,
    });
  },
});

export const GET = profitMarginAccelerationTrackerHandler;
export const POST = profitMarginAccelerationTrackerHandler;

// --- Prompt builder (čist, testabilen) -----------------------------------

function buildPrompt(
  derivatives: Derivatives,
  monthlyData: MonthlyDataPoint[],
  detAnalysis: MarginAnalysis,
): string {
  const promptData = {
    derivatives,
    monthlyData,
    deterministicBaseline: detAnalysis,
    caps: {
      marginMin: MARGIN_MIN, marginMax: MARGIN_MAX,
      accelMin: ACCEL_MIN, accelMax: ACCEL_MAX,
      scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
      weightMin: WEIGHT_MIN, weightMax: WEIGHT_MAX,
      liftMin: LIFT_MIN, liftMax: LIFT_MAX,
      confMin: CONF_MIN, confMax: CONF_MAX,
    },
  };

  return `Si AI "Profit Margin Acceleration Tracker" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Analiziraš POSPEŠEK (2nd derivative — acceleration) profitne marže — ali se HITROST izboljševanja marže pospešuje ali upočasnuje. Razlika od profit-margin-trend-analyzer (ki track-a 1st-derivative margin trend) — ti gledaš 2nd-derivative ACCELERATION z inflection point detection.

DETERMINISTIČNI PODATKI (izračunano iz DB — zadnjih 12 mesecev SOLD trgovin, grouped by month):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. accelerationAssessment: slovensko, max 500 znakov — kaj acceleration pomeni za poslovanje.
2. marginInflectionPoint: slovensko, max 300 znakov — KDAJ se bo margin trend verjetno obrnil (če je DECELERATING_*). Null če ni inflection signala.
3. accelerationDrivers: 1-3 driverjev { driver (max 100 chars), impact POSITIVE | NEGATIVE, weight 0-100, detail (max 200 chars) }.
4. projectedMargin30d: % (v dosegu [-50, 100]), ±5% od deterministične (ne pretiravaj).
5. marginOptimizationActions: 1-3 akcij { action (max 200 chars), priority HIGH | MEDIUM | LOW, expectedMarginLift v procentnih točkah [-5, 20] }.
6. accelerationRiskFactors: 1-3 tveganj { risk (max 200 chars), severity LOW | MEDIUM | HIGH, mitigation (max 200 chars) }.
7. confidenceLevel: 0-100, ±10 od deterministične.
8. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi deterministične.

VRNI LE JSON:
{
  "accelerationAssessment": "Marža se izboljšuje in POSPEŠUJE — composite 72/100. Trenutna marža 24%, mesečna sprememba +2%/mo, pospešek +0.5%/mo². 30-dnevna projekcija: 28%.",
  "marginInflectionPoint": "Ne vidimo inflection signala — izboljševanje marže se nadaljuje.",
  "accelerationDrivers": [
    { "driver": "Margin acceleration", "impact": "POSITIVE", "weight": 85, "detail": "Sprememba marže se pospešuje navzgor." }
  ],
  "projectedMargin30d": 28,
  "marginOptimizationActions": [
    { "action": "Povečaj obseg nabave — izkoristi pospešujoč maržni trend.", "priority": "HIGH", "expectedMarginLift": 2 }
  ],
  "accelerationRiskFactors": [
    { "risk": "Prehitro pospeševanje lahko signalizira nasičenje trga.", "severity": "LOW", "mitigation": "Spremeljaj volume signale." }
  ],
  "confidenceLevel": 72,
  "summary": "Margin: ACCELERATING_UP (momentum +2%/mo, accel +0.5%/mo²). Inflection: no reversal expected. 30d projection: 28%."
}${GROUNDING_PROMPT_SUFFIX}`;
}
