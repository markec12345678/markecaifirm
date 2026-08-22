// v7.71 / v8.96.4-batch2: AI Profit Accelerator — AI identificira specifične
// akcije da POSPEŠI rast profita — ne samo maksimizira, ampak pohitri.
// "Če objaviš 2 dodatna oglasa na teden in skrajšaš hold za 5 dni, dosežeš
// 5000€ profit 60 dni prej."
//
// "Accelerate: list 3/week (+150€/wk), cut hold 5d (+80€/wk). Time to 5000€:
//  12wk → 7wk (save 5wk)."
//
// Razlika od profit-maximizer-v2 (ki ML maksimizira profit na posameznem
// trade-u) — ta gleda SISTEMSKE akcije za pohitritev rasti (pogostost listinga,
// hold time, capital efficiency). Razlika od profit-forecast (ki napoveduje
// profit za obdobje) — ta daje KONKRETNE akcije za pospešitev. Razlika od
// profit-stream-predictor (ki napoveduje profit tok) — ta generira akcijski
// načrt za pospešitev. Razlika od profit-leakage-detector (ki gleda kje profit
// teče) — ta gleda kako POHITRITI rast profita (ne samo preprečiti izgube).
//
// Refaktoriran z withAiRoute helperjem (v8.96.4) + enforceBudget guard.
//
// GET+POST /api/ai/profit-accelerator
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

type EffortLevel = 'LOW' | 'MEDIUM' | 'HIGH';
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

interface CurrentMetrics {
  weeklyProfit: number;
  avgHoldDays: number;
  listingFrequency: number; // new listings per week (held trades created in last 4 weeks)
  winRate: number; // %
  capitalDeployed: number; // € tied up in held inventory
  profitVelocity: number; // €/week (same as weeklyProfit)
}

interface TimelineInfo {
  timeTo5000Profit: number; // weeks
  timeTo10000Profit: number; // weeks
  totalProfitThisYear: number;
}

interface AccelerationAction {
  action: string;
  expectedImpact: string;
  expectedProfitIncrease: number; // €/week
  timeToImplement: number; // days
  effort: EffortLevel;
  riskLevel: RiskLevel;
}

interface ProjectedTimeline {
  newWeeklyProfit: number;
  acceleratedTimeTo5000: number; // weeks (reduced)
  acceleratedTimeTo10000: number; // weeks
  timeSaved5000: number; // weeks saved
  timeSaved10000: number; // weeks saved
}

interface AccelerationPlan {
  accelerationActions: AccelerationAction[];
  projectedTimeline: ProjectedTimeline;
  bottleneckAnalysis: string;
  quickWins: string[];
  longTermAccelerators: string[];
}

interface AiAcceleratorResponse {
  accelerationPlan?: unknown;
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

function clampStringArray(
  raw: unknown,
  max: number,
  fallback: string[],
): string[] {
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item === 'string' && item.trim().length > 0) {
        out.push(item.trim().slice(0, 200));
        if (out.length >= max) break;
      }
    }
    if (out.length > 0) return out;
  }
  return fallback.slice(0, max);
}

const VALID_EFFORT: readonly EffortLevel[] = ['LOW', 'MEDIUM', 'HIGH'];
const VALID_RISK: readonly RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'];

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

// Compute ISO week number (1-53).
function isoWeekNumber(date: Date): number {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7; // Mon=0, Sun=6
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * DAY_MS));
}

// --- Deterministic Acceleration Plan (fallback) -------------------------

interface MetricsBase {
  weeklyProfit: number;
  avgHoldDays: number;
  listingFrequency: number;
  winRate: number;
  capitalDeployed: number;
  totalProfitThisYear: number;
}

function buildDeterministicPlan(m: MetricsBase): {
  actions: AccelerationAction[];
  bottleneckAnalysis: string;
  quickWins: string[];
  longTermAccelerators: string[];
} {
  const actions: AccelerationAction[] = [];

  // Rule 1: if holdDays > 30 → reduce hold time
  if (m.avgHoldDays > 30) {
    const targetHold = Math.max(14, Math.round(m.avgHoldDays * 0.7));
    const savedDays = m.avgHoldDays - targetHold;
    // Rough: each day saved adds ~ (weeklyProfit / 7 / 30) × days saved per trade,
    // we estimate 15% profit velocity increase per 7 days saved
    const profitIncrease = Math.round(
      m.weeklyProfit * (savedDays / 30) * 0.4,
    );
    actions.push({
      action: `Skrajšaj povprečen hold iz ${Math.round(m.avgHoldDays)} na ${targetHold} dni — pospeši prodajo s 10% nižjimi cenami ali boljšo promocijo.`,
      expectedImpact: `+${profitIncrease}€/teden (hitrejši cikel)`,
      expectedProfitIncrease: profitIncrease,
      timeToImplement: 14,
      effort: 'MEDIUM' as EffortLevel,
      riskLevel: 'LOW' as RiskLevel,
    });
  }

  // Rule 2: if listingFrequency < 2 → list more items
  if (m.listingFrequency < 2 && m.listingFrequency >= 0) {
    const targetFreq = Math.max(3, Math.ceil(m.listingFrequency) + 2);
    const profitIncrease = Math.round(
      m.weeklyProfit * 0.3 + (targetFreq - m.listingFrequency) * 50,
    );
    actions.push({
      action: `Povečaj pogostost listinga iz ${m.listingFrequency}/teden na ${targetFreq}/teden — poišči več virov nabave.`,
      expectedImpact: `+${profitIncrease}€/teden (večji volumen)`,
      expectedProfitIncrease: profitIncrease,
      timeToImplement: 7,
      effort: 'MEDIUM' as EffortLevel,
      riskLevel: 'LOW' as RiskLevel,
    });
  }

  // Rule 3: if winRate < 60% → improve sourcing
  if (m.winRate > 0 && m.winRate < 60) {
    const profitIncrease = Math.round(
      m.weeklyProfit * ((60 - m.winRate) / 100) * 0.5,
    );
    actions.push({
      action: `Izboljšaj sourcing — winRate ${m.winRate}% je nizak. Fokus na Bolha + Vinted kategorije z dokazanim ROI.`,
      expectedImpact: `+${profitIncrease}€/teden (boljši sourcing)`,
      expectedProfitIncrease: profitIncrease,
      timeToImplement: 21,
      effort: 'HIGH' as EffortLevel,
      riskLevel: 'MEDIUM' as RiskLevel,
    });
  }

  // Rule 4: if capitalDeployed > 0 → free up capital
  if (m.capitalDeployed > 500) {
    const profitIncrease = Math.round(m.capitalDeployed * 0.02);
    actions.push({
      action: `Sprosti ${Math.round(m.capitalDeployed * 0.3)}€ kapitala — prodaj zastarele HELD item-e (60+ dni) z 10% popustom.`,
      expectedImpact: `+${profitIncrease}€/teden (sproščen kapital)`,
      expectedProfitIncrease: profitIncrease,
      timeToImplement: 7,
      effort: 'LOW' as EffortLevel,
      riskLevel: 'LOW' as RiskLevel,
    });
  }

  // Rule 5: general velocity boost — diversify listings
  if (actions.length < 3) {
    actions.push({
      action: `Diverzificiraj kategorije — dodaj 2 novi kategoriji v naslednjih 14 dneh.`,
      expectedImpact: `+${Math.round(m.weeklyProfit * 0.1)}€/teden (večji doseg)`,
      expectedProfitIncrease: Math.round(m.weeklyProfit * 0.1),
      timeToImplement: 14,
      effort: 'LOW' as EffortLevel,
      riskLevel: 'LOW' as RiskLevel,
    });
  }

  // Bottleneck analysis
  let bottleneckAnalysis: string;
  if (m.avgHoldDays > 45) {
    bottleneckAnalysis = `Glavni bottleneck: predolg hold time (${Math.round(m.avgHoldDays)} dni). Capital je vezan preveč dolgo — pospeši prodajo.`;
  } else if (m.listingFrequency < 2) {
    bottleneckAnalysis = `Glavni bottleneck: premajhen volumen listingov (${m.listingFrequency}/teden). Potreben več sourcing-a za kritje tedenskega profita.`;
  } else if (m.winRate < 60 && m.winRate > 0) {
    bottleneckAnalysis = `Glavni bottleneck: nizka win rate (${m.winRate}%). Premiki profitablne — izboljšaj sourcing kriterije (dealScore, vir).`;
  } else if (m.capitalDeployed > 1000) {
    bottleneckAnalysis = `Glavni bottleneck: vezan kapital (${Math.round(m.capitalDeployed)}€ v HELD). Sprosti zastarele item-e za reinvestiranje.`;
  } else {
    bottleneckAnalysis = `Bottleneck: povečaj volumen in ohrani trenutno učinkovitost za kompenziranje profita.`;
  }

  // Quick wins: top 2 LOW-effort actions
  const quickWinActions = actions
    .filter(a => a.effort === 'LOW')
    .slice(0, 2)
    .map(a => a.action);

  const quickWins: string[] = quickWinActions.length > 0
    ? quickWinActions
    : ['Preglej zastarele HELD item-e in jih prodaj z 10% popustom.', 'Dodaš 2 nova listinga še danes.'];

  // Long-term accelerators
  const longTermAccelerators: string[] = [
    'Avtomatiziraj sourcing z monitorji za nove vire (mobile.de, Willhaben).',
    'Gradi AI-ocenjevalni pipeline za hitro filtriranje priložnosti.',
    'Diverzificiraj v višje-margin kategorije z dokazanim ROI >30%.',
  ];

  return {
    actions: actions.slice(0, 5),
    bottleneckAnalysis,
    quickWins,
    longTermAccelerators,
  };
}

// --- Handler -------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitAcceleratorInput {}

const profitAcceleratorHandler = withAiRoute<ProfitAcceleratorInput>({
  endpoint: '/api/ai/profit-accelerator',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async () => ({}),

  // No validateInput — endpoint ne sprejema inputa

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    // 1) Query SOLD trades last 4 weeks for currentWeeklyProfit + winRate
    const fourWeeksAgo = new Date(Date.now() - 28 * DAY_MS);
    const recentSold = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: fourWeeksAgo },
        sellPrice: { not: null },
        buyPrice: { gt: 0 },
      },
      select: {
        id: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        buyDate: true,
        sellDate: true,
      },
      take: 5000,
    });

    // Query SOLD trades this year for totalProfitThisYear
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const soldThisYear = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: yearStart },
        sellPrice: { not: null },
        buyPrice: { gt: 0 },
      },
      select: {
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
      },
      take: 20000,
    });

    // Query HELD trades for capitalDeployed + hold time
    const heldTrades = await db.trade.findMany({
      where: { status: 'held', buyPrice: { gt: 0 } },
      select: {
        id: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
      },
      take: 5000,
    });

    // Query new HELD trades created in last 4 weeks for listingFrequency
    const newHeld = heldTrades.filter(t => {
      if (!t.buyDate) return false;
      return new Date(t.buyDate).getTime() >= fourWeeksAgo.getTime();
    });

    // Empty state — no sold trades at all
    if (recentSold.length === 0 && soldThisYear.length === 0 && heldTrades.length === 0) {
      return apiOk({
        ok: true,
        currentMetrics: {
          weeklyProfit: 0,
          avgHoldDays: 0,
          listingFrequency: 0,
          winRate: 0,
          capitalDeployed: 0,
          profitVelocity: 0,
        },
        timeline: {
          timeTo5000Profit: 0,
          timeTo10000Profit: 0,
          totalProfitThisYear: 0,
        },
        accelerationPlan: {
          accelerationActions: [],
          projectedTimeline: {
            newWeeklyProfit: 0,
            acceleratedTimeTo5000: 0,
            acceleratedTimeTo10000: 0,
            timeSaved5000: 0,
            timeSaved10000: 0,
          },
          bottleneckAnalysis: 'Ni prodanih trade-ov — Profit Accelerator ne more delovati.',
          quickWins: [],
          longTermAccelerators: [],
        },
        summary:
          'Ni prodanih trade-ov — Profit Accelerator ne more delovati. Dodaš trades z buyPrice in sellPrice za začetek.',
        aiUsed: false,
        message: 'Ni prodanih trade-ov — Profit Accelerator ne more delovati.',
      });
    }

    // 2) Compute current metrics
    // weeklyProfit = avg weekly profit last 4 weeks
    let weeklyProfitSum = 0;
    let winsCount = 0;
    let totalTrades = recentSold.length;
    let holdDaysSum = 0;
    let holdDaysCount = 0;

    for (const t of recentSold) {
      const profit =
        (t.sellPrice ?? 0) -
        (t.sellFees ?? 0) -
        (t.buyPrice ?? 0) -
        (t.buyFees ?? 0);
      weeklyProfitSum += profit;
      if (profit > 0) winsCount += 1;
      if (t.buyDate && t.sellDate) {
        const holdMs =
          new Date(t.sellDate).getTime() - new Date(t.buyDate).getTime();
        if (Number.isFinite(holdMs) && holdMs > 0) {
          holdDaysSum += Math.round(holdMs / DAY_MS);
          holdDaysCount += 1;
        }
      }
    }

    const weeklyProfit = totalTrades > 0 ? weeklyProfitSum / 4 : 0; // avg per week (4 weeks)
    const avgHoldDays =
      holdDaysCount > 0 ? holdDaysSum / holdDaysCount : 0;
    const listingFrequency = newHeld.length / 4; // per week
    const winRate = totalTrades > 0 ? (winsCount / totalTrades) * 100 : 0;
    const capitalDeployed = heldTrades.reduce(
      (s, t) => s + (t.buyPrice ?? 0) + (t.buyFees ?? 0),
      0,
    );
    const profitVelocity = weeklyProfit; // €/week

    let totalProfitThisYear = 0;
    for (const t of soldThisYear) {
      const profit =
        (t.sellPrice ?? 0) -
        (t.sellFees ?? 0) -
        (t.buyPrice ?? 0) -
        (t.buyFees ?? 0);
      totalProfitThisYear += profit;
    }

    const currentMetrics: CurrentMetrics = {
      weeklyProfit: Math.round(weeklyProfit * 100) / 100,
      avgHoldDays: Math.round(avgHoldDays * 10) / 10,
      listingFrequency: Math.round(listingFrequency * 10) / 10,
      winRate: Math.round(winRate * 10) / 10,
      capitalDeployed: Math.round(capitalDeployed * 100) / 100,
      profitVelocity: Math.round(profitVelocity * 100) / 100,
    };

    // 3) Compute timelines
    // timeTo5000Profit = (5000 - totalProfitThisYear) / weeklyProfit (weeks)
    const remaining5000 = Math.max(0, 5000 - totalProfitThisYear);
    const remaining10000 = Math.max(0, 10000 - totalProfitThisYear);
    const timeTo5000Profit =
      weeklyProfit > 0 ? remaining5000 / weeklyProfit : 0;
    const timeTo10000Profit =
      weeklyProfit > 0 ? remaining10000 / weeklyProfit : 0;

    const timeline: TimelineInfo = {
      timeTo5000Profit: Math.round(timeTo5000Profit * 10) / 10,
      timeTo10000Profit: Math.round(timeTo10000Profit * 10) / 10,
      totalProfitThisYear: Math.round(totalProfitThisYear * 100) / 100,
    };

    // 4) AI cache check (6h TTL) — key by current week
    const currentWeek = `${new Date().getFullYear()}-W${isoWeekNumber(new Date())}`;
    const cacheKey = `profit-accelerator:${currentWeek}`;
    const cached = getCachedAI<{
      accelerationPlan: AccelerationPlan;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        currentMetrics,
        timeline,
        accelerationPlan: cached.accelerationPlan,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 5) Build deterministic baseline
    const baseline = buildDeterministicPlan({
      weeklyProfit,
      avgHoldDays,
      listingFrequency,
      winRate,
      capitalDeployed,
      totalProfitThisYear,
    });

    // Compute baseline projected timeline
    const baselineProfitIncrease = baseline.actions.reduce(
      (s, a) => s + a.expectedProfitIncrease,
      0,
    );
    const baselineNewWeekly = Math.max(weeklyProfit, weeklyProfit + baselineProfitIncrease);
    const baselineAccelerated5000 =
      baselineNewWeekly > 0 ? remaining5000 / baselineNewWeekly : timeTo5000Profit;
    const baselineAccelerated10000 =
      baselineNewWeekly > 0 ? remaining10000 / baselineNewWeekly : timeTo10000Profit;

    // Anti-hallucination clamp bounds:
    // - newWeeklyProfit must be in [current, current × 3]
    const maxNewWeekly = Math.max(weeklyProfit * 3, weeklyProfit + 500);
    // - time savings must be in [0, 50% of current time]
    const maxTimeSaved5000 = timeTo5000Profit * 0.5;
    const maxTimeSaved10000 = timeTo10000Profit * 0.5;

    const baselineProjected: ProjectedTimeline = {
      newWeeklyProfit: Math.min(
        maxNewWeekly,
        Math.round(baselineNewWeekly * 100) / 100,
      ),
      acceleratedTimeTo5000: Math.round(baselineAccelerated5000 * 10) / 10,
      acceleratedTimeTo10000: Math.round(baselineAccelerated10000 * 10) / 10,
      timeSaved5000: Math.min(
        maxTimeSaved5000,
        Math.round((timeTo5000Profit - baselineAccelerated5000) * 10) / 10,
      ),
      timeSaved10000: Math.min(
        maxTimeSaved10000,
        Math.round((timeTo10000Profit - baselineAccelerated10000) * 10) / 10,
      ),
    };

    const baselinePlan: AccelerationPlan = {
      accelerationActions: baseline.actions,
      projectedTimeline: baselineProjected,
      bottleneckAnalysis: baseline.bottleneckAnalysis,
      quickWins: baseline.quickWins,
      longTermAccelerators: baseline.longTermAccelerators,
    };

    const baselineSummary = `Pospeši rast profita: ${baseline.actions.length} akcij pričakovano +${Math.round(baselineProfitIncrease)}€/teden. Time to 5000€: ${timeline.timeTo5000Profit} → ${baselineProjected.acceleratedTimeTo5000} tednov (prihranek ${baselineProjected.timeSaved5000} tednov).`;

    // 6) AI prompt with grounding
    const prompt = buildPrompt({
      currentMetrics,
      timeline,
      totalTrades,
      maxNewWeekly,
      maxTimeSaved5000,
      maxTimeSaved10000,
    });

    let accelerationPlan: AccelerationPlan = baselinePlan;
    let summary = baselineSummary;
    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiAcceleratorResponse | null;

      if (parsed && typeof parsed === 'object') {
        const transformed = transformAccelerator(parsed, {
          baseline,
          baselineProjected,
          baselineSummary,
          weeklyProfit,
          remaining5000,
          remaining10000,
          timeTo5000Profit,
          timeTo10000Profit,
          maxNewWeekly,
          maxTimeSaved5000,
          maxTimeSaved10000,
        });
        accelerationPlan = transformed.accelerationPlan;
        summary = transformed.summary;
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/profit-accelerator',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { accelerationPlan, summary });
    }

    return apiOk({
      ok: true,
      currentMetrics,
      timeline,
      accelerationPlan,
      summary,
      aiUsed,
    });
  },
});

// AI Hub runner compatibility — body is ignored, identical logic.
export const GET = profitAcceleratorHandler;
export const POST = profitAcceleratorHandler;

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface PromptParams {
  currentMetrics: CurrentMetrics;
  timeline: TimelineInfo;
  totalTrades: number;
  maxNewWeekly: number;
  maxTimeSaved5000: number;
  maxTimeSaved10000: number;
}

function buildPrompt(p: PromptParams): string {
  return `Si AI pospeševalnik profita za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Identificiraj KONKRETNE akcije za POSPEŠITEV rasti profita — ne maksimiziranje posameznega trade-a, ampak pohitritev celotne rasti.

TRENUTNE METRIKE:
- weeklyProfit: ${p.currentMetrics.weeklyProfit}€/teden (povprečje zadnjih 4 tednov)
- avgHoldDays: ${p.currentMetrics.avgHoldDays} dni
- listingFrequency: ${p.currentMetrics.listingFrequency} listing-ov/teden (novi HELD v zadnjih 4 tednih)
- winRate: ${p.currentMetrics.winRate}% (zadnji 4 tedni, ${p.totalTrades} sold)
- capitalDeployed: ${p.currentMetrics.capitalDeployed}€ v HELD inventarju
- profitVelocity: ${p.currentMetrics.profitVelocity}€/teden
- totalProfitThisYear: ${p.timeline.totalProfitThisYear}€

TIMELINE NAPOVED:
- timeTo5000Profit: ${p.timeline.timeTo5000Profit} tednov (pri trenutnem tempu)
- timeTo10000Profit: ${p.timeline.timeTo10000Profit} tednov

PRAVILA ZA POSPEŠEVALNI NAČRT:
1. accelerationActions: 3-5 konkretnih akcij. Vsaka:
   - action: specifična akcija (kaj storiti, kako, s kakšno ceno/frekvenco)
   - expectedImpact: opis vpliva (npr. "+150€/teden (večji volumen)")
   - expectedProfitIncrease: EUR/teden (številka, realna — glede na trenutne metrike)
   - timeToImplement: dni (1-90)
   - effort: LOW | MEDIUM | HIGH
   - riskLevel: LOW | MEDIUM | HIGH
2. projectedTimeline:
   - newWeeklyProfit: nov tedenski profit po implementaciji vseh akcij (mora biti v [${p.currentMetrics.weeklyProfit}, ${p.maxNewWeekly.toFixed(2)}])
   - acceleratedTimeTo5000: skrajšan čas do 5000€ (v tednih)
   - acceleratedTimeTo10000: skrajšan čas do 10000€ (v tednih)
   - timeSaved5000: prihranjeno tednov do 5000€ (mora biti v [0, ${p.maxTimeSaved5000.toFixed(2)}])
   - timeSaved10000: prihranjeno tednov do 10000€ (mora biti v [0, ${p.maxTimeSaved10000.toFixed(2)}])
3. bottleneckAnalysis: kaj trenutno najbolj upočasnjuje rast profita (1-2 stavka)
4. quickWins: 1-2 akcije ki jih lahko izvedeš DANES za takojšen vpliv
5. longTermAccelerators: 2-3 strukturne spremembe za trajno pospešitev

VRNI LE JSON:
{
  "accelerationPlan": {
    "accelerationActions": [
      { "action": "...", "expectedImpact": "...", "expectedProfitIncrease": 0, "timeToImplement": 0, "effort": "LOW", "riskLevel": "LOW" }
    ],
    "projectedTimeline": {
      "newWeeklyProfit": 0,
      "acceleratedTimeTo5000": 0,
      "acceleratedTimeTo10000": 0,
      "timeSaved5000": 0,
      "timeSaved10000": 0
    },
    "bottleneckAnalysis": "...",
    "quickWins": ["..."],
    "longTermAccelerators": ["..."]
  },
  "summary": "1-2 stavka povzetka v slovenščini — kaj storiti in koliko časa prihraniti"
}${GROUNDING_PROMPT_SUFFIX}`;
}

interface TransformParams {
  baseline: ReturnType<typeof buildDeterministicPlan>;
  baselineProjected: ProjectedTimeline;
  baselineSummary: string;
  weeklyProfit: number;
  remaining5000: number;
  remaining10000: number;
  timeTo5000Profit: number;
  timeTo10000Profit: number;
  maxNewWeekly: number;
  maxTimeSaved5000: number;
  maxTimeSaved10000: number;
}

function transformAccelerator(
  parsed: AiAcceleratorResponse,
  p: TransformParams,
): { accelerationPlan: AccelerationPlan; summary: string } {
  let accelerationPlan: AccelerationPlan = {
    accelerationActions: p.baseline.actions,
    projectedTimeline: p.baselineProjected,
    bottleneckAnalysis: p.baseline.bottleneckAnalysis,
    quickWins: p.baseline.quickWins,
    longTermAccelerators: p.baseline.longTermAccelerators,
  };
  let summary = p.baselineSummary;

  if (
    parsed.accelerationPlan &&
    typeof parsed.accelerationPlan === 'object'
  ) {
    const ap = parsed.accelerationPlan as Record<string, unknown>;

    // Parse actions
    let accelerationActions = p.baseline.actions;
    if (Array.isArray(ap.accelerationActions)) {
      const aa: AccelerationAction[] = [];
      for (const a of ap.accelerationActions) {
        const ar = a as Record<string, unknown> | null;
        if (!ar || typeof ar !== 'object') continue;
        const profitInc = clampNumber(
          ar.expectedProfitIncrease,
          0,
          Math.max(1000, p.weeklyProfit * 2),
          0,
        );
        aa.push({
          action: clampString(ar.action, 300, 'neznan'),
          expectedImpact: clampString(ar.expectedImpact, 200, ''),
          expectedProfitIncrease: Math.round(profitInc),
          timeToImplement: Math.max(
            1,
            Math.round(clampNumber(ar.timeToImplement, 1, 90, 7)),
          ),
          effort: clampEnum(ar.effort, VALID_EFFORT, 'MEDIUM'),
          riskLevel: clampEnum(ar.riskLevel, VALID_RISK, 'MEDIUM'),
        });
      }
      if (aa.length > 0) accelerationActions = aa.slice(0, 5);
    }

    // Parse projectedTimeline
    let projectedTimeline = p.baselineProjected;
    if (
      ap.projectedTimeline &&
      typeof ap.projectedTimeline === 'object'
    ) {
      const pt = ap.projectedTimeline as Record<string, unknown>;
      const totalNewIncrease = accelerationActions.reduce(
        (s, a) => s + a.expectedProfitIncrease,
        0,
      );
      const aiNewWeekly = clampNumber(
        pt.newWeeklyProfit,
        p.weeklyProfit,
        p.maxNewWeekly,
        Math.min(p.maxNewWeekly, p.weeklyProfit + totalNewIncrease),
      );
      const aiAccel5000 =
        aiNewWeekly > 0 ? p.remaining5000 / aiNewWeekly : p.timeTo5000Profit;
      const aiAccel10000 =
        aiNewWeekly > 0
          ? p.remaining10000 / aiNewWeekly
          : p.timeTo10000Profit;
      const aiSaved5000 = Math.max(
        0,
        Math.min(p.maxTimeSaved5000, p.timeTo5000Profit - aiAccel5000),
      );
      const aiSaved10000 = Math.max(
        0,
        Math.min(p.maxTimeSaved10000, p.timeTo10000Profit - aiAccel10000),
      );
      projectedTimeline = {
        newWeeklyProfit: Math.round(aiNewWeekly * 100) / 100,
        acceleratedTimeTo5000: Math.round(aiAccel5000 * 10) / 10,
        acceleratedTimeTo10000: Math.round(aiAccel10000 * 10) / 10,
        timeSaved5000: Math.round(aiSaved5000 * 10) / 10,
        timeSaved10000: Math.round(aiSaved10000 * 10) / 10,
      };
    }

    const bottleneckAnalysis = clampString(
      ap.bottleneckAnalysis,
      600,
      p.baseline.bottleneckAnalysis,
    );

    const quickWins = clampStringArray(
      ap.quickWins,
      5,
      p.baseline.quickWins,
    );

    const longTermAccelerators = clampStringArray(
      ap.longTermAccelerators,
      5,
      p.baseline.longTermAccelerators,
    );

    accelerationPlan = {
      accelerationActions,
      projectedTimeline,
      bottleneckAnalysis,
      quickWins,
      longTermAccelerators,
    };
  }

  if (
    typeof parsed.summary === 'string' &&
    parsed.summary.trim().length > 0
  ) {
    summary = parsed.summary.trim().slice(0, 600);
  }

  return { accelerationPlan, summary };
}
