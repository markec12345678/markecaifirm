// v7.78 / v8.96.4-batch4: AI Inventory Turnover Forecast — AI napove turnover rate za naslednje
// 30/60/90 dni glede na historično prodajno hitrost, trenutno zalogo in
// tržne razmere. "Tvoj turnover: 3.2x/mesec, projected 2.5x v 30 dneh (aging
// stock). Action: likvidiraj 3 item-e >60d → nazaj na 3.5x."
//
// Razlika od inventory-turnover-predictor (v7.x, ki napove turnover za posamezno
// kategorijo z basic predikcijo) — ta da 30/60/90d PROJECTION z AI-jevo
// analizo aging stock-a, bottleneck item-ov in optimization actions. Razlika
// od inventory-turnover-optimizer (ki optimizira turnover strategijo) — ta
// FORECAST-a prihodnji turnover rate z explicitnim bottleneck item tracking-om.
// Razlika od inventory-turnover-accelerator (ki pospeši turnover) — ta gleda
// PROJECTION in RISK FACTORS za naslednje 90 dni. Razlika od turnover-optimizer
// (basic turnover optimization) — ta da TIME-PHASED forecast 30/60/90 dni z
// confidence score in bottleneck items. Razlika od cash-conversion-cycle (CCC
// = DIO+DSO-DPO finance metric) — ta gleda OPERATIVNI turnover rate (koliko
// item-ov/month prodas) z AI projection. Razlika od cash-flow-velocity (v7.74
// cash velocity) — ta gleda TURNOVER VELOCITY (item-i/month) z aging stock
// analysis in bottleneck identification.
//
// GET+POST /api/ai/inventory-turnover-forecast
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.4) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Input ----------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InventoryTurnoverForecastInput {}

// --- Types ---------------------------------------------------------------

type TurnoverTrend = 'IMPROVING' | 'STABLE' | 'DECLINING';
type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

interface CurrentTurnover {
  avgMonthlyTurnover: number;
  avgTurnoverRate: number; // sold items / avg inventory held
  avgHoldDays: number;
  currentStock: number;
  totalHeldCapital: number;
  agingItems: number; // held >30 days
  freshItems: number; // held <7 days
  turnoverTrend: TurnoverTrend;
}

interface TurnoverForecast {
  projectedTurnover30d: number;
  projectedTurnover60d: number;
  projectedTurnover90d: number;
  turnoverAssessment: string;
  confidence: number; // 0-100
}

interface BottleneckItem {
  tradeId: string;
  title: string;
  daysHeld: number;
  dealScore: number | null;
  bottleneckReason: string;
  recommendedAction: string;
}

interface TurnoverAction {
  action: string;
  priority: ActionPriority;
  expectedImpact: string;
  expectedTurnoverImprovement: number; // % uplift
}

interface TurnoverSummary {
  expectedTurnoverRate: number;
  riskFactors: string[];
  advice: string;
}

interface AiTurnoverResponse {
  forecast?: unknown;
  bottleneckItems?: unknown;
  actions?: unknown;
  summary?: unknown;
}

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

const VALID_TREND: readonly TurnoverTrend[] = [
  'IMPROVING',
  'STABLE',
  'DECLINING',
];

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

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round0(v: number): number {
  return Math.round(v);
}

function toMs(d: Date | null | undefined): number {
  if (!d) return 0;
  try {
    return new Date(d as unknown as Date | string).getTime();
  } catch {
    return 0;
  }
}

function daysBetween(aMs: number, bMs: number): number {
  if (aMs <= 0 || bMs <= 0) return 0;
  return Math.max(0, Math.round((bMs - aMs) / 86_400_000));
}

// Classify turnover trend based on monthly sold count slope (last 3 months)
function classifyTrend(monthlyCounts: number[]): TurnoverTrend {
  if (monthlyCounts.length < 2) return 'STABLE';
  // Linear regression slope
  const n = monthlyCounts.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const sumX = xs.reduce((s, x) => s + x, 0);
  const sumY = monthlyCounts.reduce((s, y) => s + y, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * monthlyCounts[i]!, 0);
  const sumXX = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 'STABLE';
  const slope = (n * sumXY - sumX * sumY) / denom;
  const mean = sumY / n;
  if (mean === 0) return 'STABLE';
  const relSlope = slope / mean; // relative change per month
  if (relSlope > 0.15) return 'IMPROVING';
  if (relSlope < -0.15) return 'DECLINING';
  return 'STABLE';
}

// Deterministic forecast: project turnover based on trend + aging factor
function computeDeterministicForecast(
  avgMonthlyTurnover: number,
  currentStock: number,
  agingItems: number,
  freshItems: number,
  trend: TurnoverTrend,
  avgHoldDays: number,
): {
  projectedTurnover30d: number;
  projectedTurnover60d: number;
  projectedTurnover90d: number;
  confidence: number;
} {
  if (avgMonthlyTurnover <= 0 || currentStock <= 0) {
    return {
      projectedTurnover30d: 0,
      projectedTurnover60d: 0,
      projectedTurnover90d: 0,
      confidence: 10,
    };
  }
  // Trend multiplier — improving adds 5%, declining subtracts 10%
  const trendMultiplier =
    trend === 'IMPROVING' ? 1.05 : trend === 'DECLINING' ? 0.9 : 1.0;
  // Aging drag — aging items slow down future turnover (each aging item reduces rate ~2%)
  const agingDrag = Math.min(0.5, agingItems * 0.02);
  // Fresh boost — fresh items speed up future turnover slightly
  const freshBoost = Math.min(0.15, freshItems * 0.01);
  // Stock factor — if currentStock < avgMonthlyTurnover, you'll run out
  const stockRatio = currentStock / Math.max(1, avgMonthlyTurnover);
  // Apply factors over time (further out = more decay)
  const base30 = avgMonthlyTurnover * trendMultiplier * (1 - agingDrag * 0.5 + freshBoost);
  const base60 = avgMonthlyTurnover * trendMultiplier * (1 - agingDrag * 0.7 + freshBoost * 0.7);
  const base90 = avgMonthlyTurnover * trendMultiplier * (1 - agingDrag + freshBoost * 0.4);
  // If stock is thin, decay turnover further
  const stockFactor = stockRatio < 1 ? Math.max(0.3, stockRatio) : 1;
  // Confidence: based on sample size + trend consistency
  const sampleConfidence = Math.min(80, Math.round((currentStock / 30) * 80));
  const confidence = Math.max(
    15,
    Math.min(95, sampleConfidence + (trend === 'STABLE' ? 10 : 0)),
  );

  void avgHoldDays;
  return {
    projectedTurnover30d: round1(Math.max(0, base30 * stockFactor)),
    projectedTurnover60d: round1(Math.max(0, base60 * stockFactor * 0.95)),
    projectedTurnover90d: round1(Math.max(0, base90 * stockFactor * 0.9)),
    confidence,
  };
}

// Build deterministic bottleneck items from current HELD trades (sorted by days held desc)
function buildBottleneckItems(
  heldTrades: Array<{
    id: string;
    title: string;
    buyDate: Date | null;
    listing: { dealScore: number | null } | null;
  }>,
  now: number,
): BottleneckItem[] {
  const items: BottleneckItem[] = [];
  for (const t of heldTrades) {
    const buyMs = toMs(t.buyDate);
    if (buyMs <= 0) continue;
    const daysHeld = daysBetween(buyMs, now);
    // Bottleneck criteria: held >21 days, OR low dealScore
    const dealScore = t.listing?.dealScore ?? null;
    const isAging = daysHeld > 21;
    const isLowScore = dealScore != null && dealScore > 0 && dealScore < 40;
    if (!isAging && !isLowScore) continue;

    let bottleneckReason: string;
    let recommendedAction: string;
    let priority: ActionPriority;
    if (daysHeld > 60) {
      bottleneckReason = `Item je v inventarju že ${daysHeld} dni — kritično aging, blokira turnover in kapital.`;
      recommendedAction = 'Likvidiraj takoj — znižaj ceno za 15-25% ali prodaj na bundlu za sprostitev kapitala.';
      priority = 'HIGH';
    } else if (daysHeld > 30) {
      bottleneckReason = `Item je v inventarju ${daysHeld} dni — srednje aging, tveganje za stagnacijo.`;
      recommendedAction = 'Cenašno pregledaj — znižaj za 8-12% in povečaj promocijo na 2 kanalih.';
      priority = 'MEDIUM';
    } else if (isLowScore) {
      bottleneckReason = `Deal score ${dealScore} — nizka kakovost nakupa, verjetno slaba priložnost.`;
      recommendedAction = 'Cut losses — prodaj po current price, ne čakaj na dobiček.';
      priority = 'MEDIUM';
    } else {
      bottleneckReason = `Item v inventarju ${daysHeld} dni — blaga stagnacija.`;
      recommendedAction = 'Spremljaj 7 dni — če ni zanimanja, znižaj ceno za 5%.';
      priority = 'LOW';
    }

    items.push({
      tradeId: t.id,
      title: t.title.slice(0, 100),
      daysHeld,
      dealScore,
      bottleneckReason,
      recommendedAction,
    });
    void priority;
    if (items.length >= 10) break;
  }
  // Sort by daysHeld desc (worst bottlenecks first)
  items.sort((a, b) => b.daysHeld - a.daysHeld);
  return items.slice(0, 10);
}

// Build deterministic actions
function buildDeterministicActions(
  avgMonthlyTurnover: number,
  agingItems: number,
  freshItems: number,
  currentStock: number,
  trend: TurnoverTrend,
): TurnoverAction[] {
  const actions: TurnoverAction[] = [];

  if (agingItems > 0) {
    actions.push({
      action: `Likvidiraj ${agingItems} aging item-ov (>30 dni) z 15-25% popustom — sprosti ${Math.round(agingItems * 0.3 * Math.max(1, avgMonthlyTurnover * 50))}€ vezanega kapitala.`,
      priority: 'HIGH',
      expectedImpact: `Zmanjša aging drag za ${(agingItems * 2).toFixed(0)}% in sprosti cash za nove nakupe.`,
      expectedTurnoverImprovement: Math.min(
        50,
        Math.round((agingItems / Math.max(1, currentStock)) * 100 * 0.3),
      ),
    });
  }

  if (trend === 'DECLINING') {
    actions.push({
      action: 'Razširi iskanje na 2 novi kategoriji z visokim historical ROI-jem za reverz declining trend-a.',
      priority: 'HIGH',
      expectedImpact: 'Diverzificira portfolio in stabilizira monthly turnover rate.',
      expectedTurnoverImprovement: 12,
    });
  } else if (trend === 'IMPROVING') {
    actions.push({
      action: 'Povečaj buying volume za 20-30% v top kategorijah — izkoristi improving trend.',
      priority: 'MEDIUM',
      expectedImpact: 'Ojača momentum in poveča monthly sold count.',
      expectedTurnoverImprovement: 18,
    });
  } else {
    actions.push({
      action: 'Optimiziraj buying — fokusiraj se na item-e z dealScore >60 za boljšo konverzijo.',
      priority: 'MEDIUM',
      expectedImpact: 'Višji deal quality skrajša povprečni hold time za 15-25%.',
      expectedTurnoverImprovement: 10,
    });
  }

  if (freshItems > currentStock * 0.4) {
    actions.push({
      action: 'Veliko fresh item-ov (<7 dni) — pospeši listing in promocijo za hitro turnover.',
      priority: 'MEDIUM',
      expectedImpact: 'Pridobi momentum iz fresh inventory-ja preden postane aging.',
      expectedTurnoverImprovement: 8,
    });
  }

  actions.push({
    action: 'Implementiraj 7-dnevni price review cycle — po 7 dneh brez zanimanja znižaj ceno za 5%.',
    priority: 'LOW',
    expectedImpact: 'Prepreči aging preko 14 dni in vzdržuje zdrav turnover.',
    expectedTurnoverImprovement: 6,
  });

  return actions.slice(0, 5);
}

// --- Build deterministic assessment + summary -----------------------------

function buildDeterministicAssessment(
  avgMonthlyTurnover: number,
  avgHoldDays: number,
  currentStock: number,
  totalHeldCapital: number,
  agingItems: number,
  turnoverTrend: TurnoverTrend,
  deterministicForecast: {
    projectedTurnover30d: number;
    projectedTurnover60d: number;
    projectedTurnover90d: number;
  },
): string {
  const trendLabel =
    turnoverTrend === 'IMPROVING'
      ? 'trend turnover-a se izboljšuje'
      : turnoverTrend === 'DECLINING'
        ? 'trend turnover-a pada'
        : 'trend turnover-a je stabilen';
  const agingWarn =
    agingItems > 0
      ? ` ${agingItems} aging item-ov (>30 dni) bodo upočasnila prihodnji turnover.`
      : ' Brez aging item-ov.';
  return `Trenutni monthly turnover: ${avgMonthlyTurnover}x (avg hold ${avgHoldDays} dni, ${currentStock} HELD item-ov, ${totalHeldCapital}€ kapitala). ${trendLabel}.${agingWarn} Projected 30d: ${deterministicForecast.projectedTurnover30d}x, 60d: ${deterministicForecast.projectedTurnover60d}x, 90d: ${deterministicForecast.projectedTurnover90d}x.`;
}

function buildDeterministicSummary(
  deterministicForecast: {
    projectedTurnover30d: number;
    projectedTurnover60d: number;
    projectedTurnover90d: number;
  },
  agingItems: number,
  turnoverTrend: TurnoverTrend,
  currentStock: number,
  avgMonthlyTurnover: number,
  avgHoldDays: number,
): TurnoverSummary {
  return {
    expectedTurnoverRate: round1(
      (deterministicForecast.projectedTurnover30d +
        deterministicForecast.projectedTurnover60d +
        deterministicForecast.projectedTurnover90d) /
        3,
    ),
    riskFactors: (() => {
      const risks: string[] = [];
      if (agingItems > 0) {
        risks.push(
          `${agingItems} aging item-ov (>30 dni) — tveganje stagnacije kapitala.`,
        );
      }
      if (turnoverTrend === 'DECLINING') {
        risks.push('Padajoči trend turnover-a — potreben takojšen poseg.');
      }
      if (currentStock > 0 && avgMonthlyTurnover > currentStock) {
        risks.push(
          'Trenutna zaloga manjša od monthly turnover-a — tveganje izčrpanja inventarja.',
        );
      }
      if (avgHoldDays > 45) {
        risks.push(
          `Povprečni hold time ${avgHoldDays} dni je visok — optimiziraj buying ali pricing.`,
        );
      }
      if (risks.length === 0) {
        risks.push('Ni specifičnih tveganj — ohrani trenutno strategijo.');
      }
      return risks.slice(0, 5);
    })(),
    advice: (() => {
      if (agingItems > 0) {
        return `Prioritetno likvidiraj ${agingItems} aging item-ov z 15-25% popustom — sproščeno kapital reinvestiraj v item-e z višjim dealScore.`;
      }
      if (turnoverTrend === 'DECLINING') {
        return 'Trend turnover-a pada — diverzificiraj kategorije in povečaj buying disciplino.';
      }
      if (turnoverTrend === 'IMPROVING') {
        return 'Turnover raste — povečaj buying volume zmerno (20-30%) za izkoristek momentum-a.';
      }
      return 'Turnover stabilen — fokusiraj se na deal quality (dealScore >60) za boljšo konverzijo.';
    })(),
  };
}

// --- Prompt builder -------------------------------------------------------

function buildBottleneckForPrompt(bottleneckItems: BottleneckItem[]): Array<Record<string, unknown>> {
  return bottleneckItems.slice(0, 5).map((b) => ({
    tradeId: b.tradeId,
    title: b.title,
    daysHeld: b.daysHeld,
    dealScore: b.dealScore,
    bottleneckReason: b.bottleneckReason,
  }));
}

function buildPrompt(args: {
  avgMonthlyTurnover: number;
  avgTurnoverRate: number;
  avgHoldDays: number;
  currentStock: number;
  totalHeldCapital: number;
  agingItems: number;
  freshItems: number;
  turnoverTrend: TurnoverTrend;
  month3Count: number;
  month2Count: number;
  month1Count: number;
  bottleneckForPrompt: Array<Record<string, unknown>>;
}): string {
  const {
    avgMonthlyTurnover, avgTurnoverRate, avgHoldDays, currentStock,
    totalHeldCapital, agingItems, freshItems, turnoverTrend,
    month3Count, month2Count, month1Count, bottleneckForPrompt,
  } = args;
  return `Si AI "Inventory Turnover Forecaster" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Napovej turnover rate (koliko item-ov/month prodaš) za naslednje 30/60/90 dni glede na historično prodajno hitrost, trenutno zalogo in tržne razmere.

TRENUTNO STANJE (deterministično izračunano):
- avgMonthlyTurnover: ${avgMonthlyTurnover}x (zadnjih 90 dni / 3 mesece)
- avgTurnoverRate: ${avgTurnoverRate}x (sold items / avg inventory held per month)
- avgHoldDays: ${avgHoldDays} dni (povprečni čas od buy do sell)
- currentStock (HELD item-i): ${currentStock}
- totalHeldCapital: ${totalHeldCapital}€
- agingItems (>30 dni): ${agingItems}
- freshItems (<7 dni): ${freshItems}
- turnoverTrend: ${turnoverTrend}
- monthlySoldCount (zadnji 3 meseci): [${month3Count}, ${month2Count}, ${month1Count}]

BOTTLENECK ITEMS (deterministično identificirano — top 5):
${JSON.stringify(bottleneckForPrompt, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. forecast:
   - projectedTurnover30d: število item-ov, ki jih boš prodal v naslednjih 30 dneh (clamped [0, 20])
   - projectedTurnover60d: 60 dni projection (clamped [0, 20])
   - projectedTurnover90d: 90 dni projection (clamped [0, 20])
   - turnoverAssessment: slovenski opis trenutnega stanja turnover-a z aging stock analizo (max 500 znakov). NE izmišljuj številk — uporabi zgornje deterministične podatke.
   - confidence: 0-100 (glede na sample size in konsistentnost signalov)
2. actions: array 3-5 konkretnih ukrepov za izboljšanje turnover-a, vsak z:
   - action: slovenski opis ukrepa (max 200 znakov)
   - priority: HIGH / MEDIUM / LOW (validiraj proti enum)
   - expectedImpact: slovenski opis pričakovanega učinka (max 200 znakov)
   - expectedTurnoverImprovement: % izboljšanje turnover-a (clamped [0, 100])
3. summary:
   - expectedTurnoverRate: pričakovan povprečni turnover rate z implementiranimi actions (clamped [0, 20])
   - riskFactors: array 3-5 slovenskih opisov tveganj (max 200 znakov vsak)
   - advice: slovenski nasvet (max 500 znakov)

VRNI LE JSON:
{
  "forecast": {
    "projectedTurnover30d": 0,
    "projectedTurnover60d": 0,
    "projectedTurnover90d": 0,
    "turnoverAssessment": "...",
    "confidence": 75
  },
  "actions": [
    { "action": "...", "priority": "HIGH", "expectedImpact": "...", "expectedTurnoverImprovement": 15 }
  ],
  "summary": {
    "expectedTurnoverRate": 0,
    "riskFactors": ["...", "...", "..."],
    "advice": "..."
  }
}${GROUNDING_PROMPT_SUFFIX}`;
}

// --- AI merge ------------------------------------------------------------

interface AiMergedForecast {
  forecast: TurnoverForecast;
  actions: TurnoverAction[];
  summary: TurnoverSummary;
  aiUsed: boolean;
}

function mergeAiIntoForecast(
  parsed: AiTurnoverResponse | null,
  deterministicForecast: {
    projectedTurnover30d: number;
    projectedTurnover60d: number;
    projectedTurnover90d: number;
    confidence: number;
  },
  deterministicAssessment: string,
  deterministicActions: TurnoverAction[],
  deterministicSummary: TurnoverSummary,
): AiMergedForecast {
  let forecast: TurnoverForecast = {
    ...deterministicForecast,
    turnoverAssessment: deterministicAssessment,
  };
  let actions = deterministicActions;
  let summary = deterministicSummary;
  let aiUsed = false;

  if (parsed && typeof parsed === 'object') {
    // Parse forecast
    if (parsed.forecast && typeof parsed.forecast === 'object') {
      const f = parsed.forecast as Record<string, unknown>;
      forecast = {
        projectedTurnover30d: clampNumber(
          f.projectedTurnover30d,
          0,
          20,
          deterministicForecast.projectedTurnover30d,
        ),
        projectedTurnover60d: clampNumber(
          f.projectedTurnover60d,
          0,
          20,
          deterministicForecast.projectedTurnover60d,
        ),
        projectedTurnover90d: clampNumber(
          f.projectedTurnover90d,
          0,
          20,
          deterministicForecast.projectedTurnover90d,
        ),
        turnoverAssessment: clampString(
          f.turnoverAssessment,
          500,
          deterministicAssessment,
        ),
        confidence: clampNumber(
          f.confidence,
          0,
          100,
          deterministicForecast.confidence,
        ),
      };
    }

    // Parse actions
    if (Array.isArray(parsed.actions)) {
      const newActions: TurnoverAction[] = [];
      for (const a of parsed.actions) {
        const ar = a as Record<string, unknown>;
        if (!ar || typeof ar !== 'object') continue;
        const actionStr = clampString(
          ar.action,
          200,
          'Izboljšaj turnover strategijo.',
        );
        const priority = clampEnum(ar.priority, VALID_PRIORITY, 'MEDIUM');
        const expectedImpact = clampString(
          ar.expectedImpact,
          200,
          'Izboljša turnover rate.',
        );
        const expectedTurnoverImprovement = clampNumber(
          ar.expectedTurnoverImprovement,
          0,
          100,
          10,
        );
        newActions.push({
          action: actionStr,
          priority,
          expectedImpact,
          expectedTurnoverImprovement: round0(expectedTurnoverImprovement),
        });
        if (newActions.length >= 5) break;
      }
      if (newActions.length > 0) {
        // Sort by priority HIGH > MEDIUM > LOW, then by expectedTurnoverImprovement desc
        const priorityRank: Record<ActionPriority, number> = {
          HIGH: 0,
          MEDIUM: 1,
          LOW: 2,
        };
        newActions.sort(
          (a, b) =>
            priorityRank[a.priority] - priorityRank[b.priority] ||
            b.expectedTurnoverImprovement - a.expectedTurnoverImprovement,
        );
        actions = newActions;
      }
    }

    // Parse summary
    if (parsed.summary && typeof parsed.summary === 'object') {
      const s = parsed.summary as Record<string, unknown>;
      const riskFactors: string[] = Array.isArray(s.riskFactors)
        ? (s.riskFactors as unknown[])
            .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
            .map((r) => r.trim().slice(0, 200))
            .slice(0, 5)
        : deterministicSummary.riskFactors;
      if (riskFactors.length === 0 && deterministicSummary.riskFactors.length > 0) {
        riskFactors.push(...deterministicSummary.riskFactors);
      }
      summary = {
        expectedTurnoverRate: clampNumber(
          s.expectedTurnoverRate,
          0,
          20,
          deterministicSummary.expectedTurnoverRate,
        ),
        riskFactors,
        advice: clampString(s.advice, 500, deterministicSummary.advice),
      };
    }

    aiUsed = true;
  }

  return { forecast, actions, summary, aiUsed };
}

void VALID_TREND; // referenced indirectly via classifyTrend return value

// --- Handler -------------------------------------------------------------

const inventoryTurnoverForecastHandler = withAiRoute<InventoryTurnoverForecastInput>({
  endpoint: '/api/ai/inventory-turnover-forecast',
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
    const cutoff90d = new Date(now - 90 * 86_400_000);
    const cutoff30d = new Date(now - 30 * 86_400_000);
    const cutoff60d = new Date(now - 60 * 86_400_000);

    // 1) Query SOLD trades from last 90 days for turnover rate calculation
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: cutoff90d, not: null },
      },
      select: {
        id: true,
        buyDate: true,
        sellDate: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        category: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    });

    // 2) Query current HELD trades
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        buyDate: true,
        buyPrice: true,
        category: true,
        listing: {
          select: { dealScore: true },
        },
      },
      take: 100000,
    });

    const currentStock = heldTrades.length;
    const totalHeldCapital = round0(
      heldTrades.reduce((s, t) => s + (t.buyPrice ?? 0), 0),
    );

    // Count aging (>30 days) and fresh (<7 days)
    let agingItems = 0;
    let freshItems = 0;
    for (const t of heldTrades) {
      const buyMs = toMs(t.buyDate);
      if (buyMs <= 0) continue;
      const daysHeld = daysBetween(buyMs, now);
      if (daysHeld > 30) agingItems += 1;
      if (daysHeld < 7) freshItems += 1;
    }

    // Compute avg monthly turnover (last 90 days = 3 months)
    const avgMonthlyTurnover = round1(soldTrades.length / 3);

    // Compute avg turnover rate = sold items / avg inventory held
    // avg inventory held ≈ (currentStock + currentStock + soldIn90) / 3 (rough estimate)
    const avgInventoryHeld = Math.max(
      1,
      round0((currentStock * 2 + soldTrades.length) / 3),
    );
    const avgTurnoverRate = round1(soldTrades.length / avgInventoryHeld / 3);

    // Compute avg hold days (from SOLD trades — days from buyDate to sellDate)
    let holdDaysSum = 0;
    let holdDaysCount = 0;
    for (const t of soldTrades) {
      const buyMs = toMs(t.buyDate);
      const sellMs = toMs(t.sellDate);
      if (buyMs > 0 && sellMs > 0) {
        holdDaysSum += daysBetween(buyMs, sellMs);
        holdDaysCount += 1;
      }
    }
    const avgHoldDays = round0(
      holdDaysCount > 0 ? holdDaysSum / holdDaysCount : 0,
    );

    // Compute turnover trend by month (last 3 months sold counts)
    const month1Count = soldTrades.filter(
      (t) => toMs(t.sellDate) >= cutoff30d.getTime(),
    ).length;
    const month2Count = soldTrades.filter((t) => {
      const ms = toMs(t.sellDate);
      return ms >= cutoff60d.getTime() && ms < cutoff30d.getTime();
    }).length;
    const month3Count = soldTrades.filter((t) => {
      const ms = toMs(t.sellDate);
      return ms >= cutoff90d.getTime() && ms < cutoff60d.getTime();
    }).length;
    const turnoverTrend = classifyTrend([month3Count, month2Count, month1Count]);

    const current: CurrentTurnover = {
      avgMonthlyTurnover,
      avgTurnoverRate,
      avgHoldDays,
      currentStock,
      totalHeldCapital,
      agingItems,
      freshItems,
      turnoverTrend,
    };

    // Empty state — no SOLD trades and no HELD trades
    if (soldTrades.length === 0 && currentStock === 0) {
      return apiOk({
        ok: true,
        current,
        forecast: {
          projectedTurnover30d: 0,
          projectedTurnover60d: 0,
          projectedTurnover90d: 0,
          turnoverAssessment:
            'Ni SOLD trade-ov v zadnjih 90 dneh in ni HELD inventarja — Inventory Turnover Forecast ni mogoč.',
          confidence: 0,
        },
        bottleneckItems: [],
        actions: [],
        summary: {
          expectedTurnoverRate: 0,
          riskFactors: [],
          advice:
            'Dodaj SOLD trade-e (status "sold", sellDate v zadnjih 90 dneh) in HELD trade-e (status "held") za Inventory Turnover Forecast.',
        },
        aiUsed: false,
        message:
          'Ni SOLD trade-ov v zadnjih 90 dneh in ni HELD inventarja — Inventory Turnover Forecast ni mogoč.',
      });
    }

    // 3) Build bottleneck items (deterministic, from HELD trades)
    const bottleneckItems = buildBottleneckItems(heldTrades, now);

    // 4) AI cache check (6h TTL) — key by current month
    const monthKey = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `inventory-turnover-forecast:${monthKey}`;
    const cached = getCachedAI<{
      forecast: TurnoverForecast;
      actions: TurnoverAction[];
      summary: TurnoverSummary;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        current,
        forecast: cached.forecast,
        bottleneckItems,
        actions: cached.actions,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 5) Compute deterministic forecast (fallback if AI fails)
    const deterministicForecast = computeDeterministicForecast(
      avgMonthlyTurnover,
      currentStock,
      agingItems,
      freshItems,
      turnoverTrend,
      avgHoldDays,
    );
    const deterministicActions = buildDeterministicActions(
      avgMonthlyTurnover,
      agingItems,
      freshItems,
      currentStock,
      turnoverTrend,
    );

    const deterministicAssessment = buildDeterministicAssessment(
      avgMonthlyTurnover,
      avgHoldDays,
      currentStock,
      totalHeldCapital,
      agingItems,
      turnoverTrend,
      deterministicForecast,
    );

    const deterministicSummary = buildDeterministicSummary(
      deterministicForecast,
      agingItems,
      turnoverTrend,
      currentStock,
      avgMonthlyTurnover,
      avgHoldDays,
    );

    // 6) AI prompt with grounding
    const bottleneckForPrompt = buildBottleneckForPrompt(bottleneckItems);
    const prompt = buildPrompt({
      avgMonthlyTurnover,
      avgTurnoverRate,
      avgHoldDays,
      currentStock,
      totalHeldCapital,
      agingItems,
      freshItems,
      turnoverTrend,
      month3Count,
      month2Count,
      month1Count,
      bottleneckForPrompt,
    });

    let forecast: TurnoverForecast = {
      ...deterministicForecast,
      turnoverAssessment: deterministicAssessment,
    };
    let actions = deterministicActions;
    let summary = deterministicSummary;
    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiTurnoverResponse | null;

      const result = mergeAiIntoForecast(
        parsed,
        deterministicForecast,
        deterministicAssessment,
        deterministicActions,
        deterministicSummary,
      );
      if (result.aiUsed) {
        forecast = result.forecast;
        actions = result.actions;
        summary = result.summary;
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-turnover-forecast',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { forecast, actions, summary });
    }

    return apiOk({
      ok: true,
      current,
      forecast,
      bottleneckItems,
      actions,
      summary,
      aiUsed,
    });
  },
});

export const GET = inventoryTurnoverForecastHandler;
export const POST = inventoryTurnoverForecastHandler;
