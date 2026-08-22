// v7.72 / v8.96.3-batch4: AI Profit Trajectory Forecaster — AI napove "trajektorijo" rasti profita
// čez 6/12/24 mesecev pod različnimi scenariji (trenutni tempo, pospešen,
// upočasnjen). Pokaže OBLIKO krivulje rasti — linearna, eksponentna ali
// platoirajoča. "Trajectory: EXPONENTIAL (growth velocity +15%/mo). 24m
// projection: 12,000€ (accelerated) vs 6,000€ (current). Bottleneck: capital."
//
// Razlika od profit-forecast (ki napove profit za obdobje) — ta gleda OBLIKO
// rasti in inflection points. Razlika od profit-stream-predictor (ki napove
// tok profita po virih) — ta gleda 3 scenarije rasti (CONTINUE/ACCELERATED/
// DECELERATED). Razlika od profit-accelerator (ki daje akcije za pospešitev)
// — ta modelira PROJEKCIJO profit trajektorije čez 24 mesecev. Razlika od
// deal-quality-forecaster (ki napoveduje quality posameznega deal-a) — ta
// napoveduje celotno profit rast.
//
// GET+POST /api/ai/profit-trajectory-forecaster
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.3) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitTrajectoryInput {}

// --- Types ---------------------------------------------------------------

type GrowthPattern = 'LINEAR' | 'EXPONENTIAL' | 'PLATEAUING' | 'FLAT';

interface Trajectory {
  monthlyGrowthRate: number; // EUR/month (slope)
  growthPattern: GrowthPattern;
  growthVelocity: number; // acceleration (2nd derivative)
  currentTrajectory: string;
}

interface ScenarioProjection {
  month6: number;
  month12: number;
  month24: number;
  totalProfit24m: number;
}

interface Projections {
  CONTINUE_CURRENT: ScenarioProjection;
  ACCELERATED: ScenarioProjection;
  DECELERATED: ScenarioProjection;
}

interface Analysis {
  inflectionPoint: string | null;
  growthBottleneck: string;
  trajectoryAdvice: string;
}

interface AiTrajectoryResponse {
  projections?: unknown;
  analysis?: unknown;
  summary?: unknown;
}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;

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

// Linear slope of values (month-over-month).
function computeSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xs = values.map((_, i) => i);
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = values.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (values[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

// Determine growth pattern from slope and acceleration.
// - growthRate = slope of monthly profits
// - growthVelocity = slope of slopes (2nd derivative) — how fast growth is accelerating
function deriveGrowthPattern(
  growthRate: number,
  growthVelocity: number,
): GrowthPattern {
  const absRate = Math.abs(growthRate);
  const absVel = Math.abs(growthVelocity);
  // FLAT if growth rate is essentially zero
  if (absRate < 5) return 'FLAT';
  // EXPONENTIAL if growth is positive AND accelerating
  if (growthRate > 0 && growthVelocity > absRate * 0.1) return 'EXPONENTIAL';
  // PLATEAUING if growth is positive but decelerating
  if (growthRate > 0 && growthVelocity < -absRate * 0.1) return 'PLATEAUING';
  // LINEAR otherwise
  return 'LINEAR';
}

// Compute ISO month key (YYYY-MM).
function isoMonthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// --- Deterministic Trajectory (fallback) ---------------------------------

function buildDeterministicTrajectory(
  monthlyProfits: number[],
  currentMonthly: number,
): {
  trajectory: Trajectory;
  projections: Projections;
  analysis: Analysis;
} {
  const slope = computeSlope(monthlyProfits);
  // 2nd derivative: slope of slopes — for simplicity, compute slope of first half vs second half
  const half = Math.floor(monthlyProfits.length / 2);
  const firstHalfSlope =
    half >= 2 ? computeSlope(monthlyProfits.slice(0, half)) : slope;
  const secondHalfSlope =
    half >= 2 ? computeSlope(monthlyProfits.slice(-half)) : slope;
  const growthVelocity = secondHalfSlope - firstHalfSlope;

  const growthPattern = deriveGrowthPattern(slope, growthVelocity);

  // Linear projections — simple slope extrapolation
  const baseMonth = Math.max(0, currentMonthly);

  // CONTINUE_CURRENT: pure linear extrapolation
  const continue6 = Math.max(0, baseMonth + slope * 6);
  const continue12 = Math.max(0, baseMonth + slope * 12);
  const continue24 = Math.max(0, baseMonth + slope * 24);
  const continueTotal = Math.max(0, baseMonth * 24 + slope * (24 * 25) / 2);

  // ACCELERATED: 1.5x slope (more aggressive growth)
  const accelSlope = slope * 1.5 + Math.max(50, baseMonth * 0.05);
  const accel6 = Math.max(0, baseMonth + accelSlope * 6);
  const accel12 = Math.max(0, baseMonth + accelSlope * 12);
  const accel24 = Math.max(0, baseMonth + accelSlope * 24);
  const accelTotal = Math.max(0, baseMonth * 24 + accelSlope * (24 * 25) / 2);

  // DECELERATED: 0.5x slope (market cools)
  const decelSlope = slope * 0.5 - Math.max(20, baseMonth * 0.02);
  const decel6 = Math.max(0, baseMonth + decelSlope * 6);
  const decel12 = Math.max(0, baseMonth + decelSlope * 12);
  const decel24 = Math.max(0, baseMonth + decelSlope * 24);
  const decelTotal = Math.max(0, baseMonth * 24 + decelSlope * (24 * 25) / 2);

  const projections: Projections = {
    CONTINUE_CURRENT: {
      month6: Math.round(continue6 * 100) / 100,
      month12: Math.round(continue12 * 100) / 100,
      month24: Math.round(continue24 * 100) / 100,
      totalProfit24m: Math.round(continueTotal * 100) / 100,
    },
    ACCELERATED: {
      month6: Math.round(accel6 * 100) / 100,
      month12: Math.round(accel12 * 100) / 100,
      month24: Math.round(accel24 * 100) / 100,
      totalProfit24m: Math.round(accelTotal * 100) / 100,
    },
    DECELERATED: {
      month6: Math.round(decel6 * 100) / 100,
      month12: Math.round(decel12 * 100) / 100,
      month24: Math.round(decel24 * 100) / 100,
      totalProfit24m: Math.round(decelTotal * 100) / 100,
    },
  };

  const trajectoryDesc = (() => {
    switch (growthPattern) {
      case 'EXPONENTIAL':
        return `Eksponentna rast — mesečni profit pospešeno raste (slope ${Math.round(slope)}€/mo, velocity ${Math.round(growthVelocity)}€/mo²).`;
      case 'PLATEAUING':
        return `Platoirajoča rast — rast se upočasnjuje (slope ${Math.round(slope)}€/mo, velocity ${Math.round(growthVelocity)}€/mo²).`;
      case 'FLAT':
        return `Ravnine — profit stabilen brez jasne rasti (slope ${Math.round(slope)}€/mo).`;
      default:
        return `Linearna rast — stabilen mesečni prirast (slope ${Math.round(slope)}€/mo).`;
    }
  })();

  // Inflection point
  let inflectionPoint: string | null = null;
  if (growthPattern === 'PLATEAUING') {
    inflectionPoint = `Rast se platoira — inflection pri ~6-12 mesecih, kjer bo profit verjetno stagniral brez novih akcij.`;
  } else if (growthPattern === 'EXPONENTIAL') {
    inflectionPoint = `Eksponentna rast bo prešla v plato pri ~12-18 mesecih, ko se trg nasiči ali kapital omeji volumen.`;
  }

  // Growth bottleneck (heuristic)
  let growthBottleneck: string;
  if (slope <= 0) {
    growthBottleneck = `Bottleneck: profit ne raste — potrebne strukturne spremembe (sourcing, pricing, diverzifikacija).`;
  } else if (growthVelocity < 0) {
    growthBottleneck = `Bottleneck: rast se upočasnjuje — omejen kapital, omejen volumen ali nasičenje trga v trenutnih kategorijah.`;
  } else if (growthPattern === 'EXPONENTIAL') {
    growthBottleneck = `Bottleneck: kapital in operational bandwidth — eksponentna rast zahteva več kapitala za nabavo in več časa za management.`;
  } else {
    growthBottleneck = `Bottleneck: linearna rast je omejena s trenutnim tempom sourcing-a in pricing strategije.`;
  }

  // Trajectory advice
  let trajectoryAdvice: string;
  if (growthPattern === 'FLAT') {
    trajectoryAdvice = `Profit je stabilen — za rast diverzificiraj kategorije ali povečaj listing frequency. Trenutni 24m projection: ${Math.round(continueTotal)}€.`;
  } else if (growthPattern === 'PLATEAUING') {
    trajectoryAdvice = `Platoirajoča rast — preusmeri kapital v emerging kategorije (glej Market Gap Forecaster) in skrajšaj hold time. Accelerated scenario: ${Math.round(accelTotal)}€ (vs ${Math.round(continueTotal)}€ pri trenutnem tempu).`;
  } else if (growthPattern === 'EXPONENTIAL') {
    trajectoryAdvice = `Eksponentna rast — ohrani momentum. Fokus na skaliranje (povečaj kapital, diverzificiraj vire) da izkoristiš exponential pattern. 24m projection: ${Math.round(continueTotal)}€.`;
  } else {
    trajectoryAdvice = `Linearna rast je stabilna. Za prehod v eksponentno rast dodaj 1-2 nove kategorije in povečaj listing frequency. Accelerated scenario: ${Math.round(accelTotal)}€ (vs ${Math.round(continueTotal)}€).`;
  }

  return {
    trajectory: {
      monthlyGrowthRate: Math.round(slope * 100) / 100,
      growthPattern,
      growthVelocity: Math.round(growthVelocity * 100) / 100,
      currentTrajectory: trajectoryDesc,
    },
    projections,
    analysis: {
      inflectionPoint,
      growthBottleneck,
      trajectoryAdvice,
    },
  };
}

// --- Prompt builder + AI response transform (čisti helperji) ------------

function buildPrompt(
  baseline: {
    trajectory: Trajectory;
    projections: Projections;
    analysis: Analysis;
  },
  monthlyProfits: number[],
  currentMonthProfit: number,
  maxMonthProfit: number,
  maxTotal24m: number,
): string {
  return `Si AI "Profit Trajectory" analitik za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Napovej "trajektorijo" rasti profita čez 6/12/24 mesecev pod 3 scenariji (CONTINUE_CURRENT, ACCELERATED, DECELERATED). Identificiraj obliko krivulje rasti, inflection point in bottleneck.

MESEČNI PROFIT (zadnjih 12 mesecev, od najstarejšega do najnovejšega):
${JSON.stringify(monthlyProfits)}

TRAJEKTORIJA (deterministično izračunana):
- monthlyGrowthRate: ${baseline.trajectory.monthlyGrowthRate}€/mo
- growthPattern: ${baseline.trajectory.growthPattern}
- growthVelocity: ${baseline.trajectory.growthVelocity}€/mo²
- currentTrajectory: ${baseline.trajectory.currentTrajectory}

TRENUTNI MESEČNI PROFIT: ${Math.round(currentMonthProfit)}€

DETERMINISTIČNE PROJEKCIJE (baseline):
${JSON.stringify(baseline.projections, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. projections: 3 scenariji (CONTINUE_CURRENT, ACCELERATED, DECELERATED)
   - Vsak scenario: month6, month12, month24, totalProfit24m
   - month6/12/24 = pričakovan mesečni profit v tistem mesecu
   - totalProfit24m = skupni profit v naslednjih 24 mesecih (vsota)
   - Vrednosti MORAJO biti v [0, ${Math.round(maxMonthProfit)}] za month6/12/24 in [0, ${Math.round(maxTotal24m)}] za totalProfit24m (anti-hallucination)
   - ACCELERATED > CONTINUE_CURRENT > DECELERATED (logično)
2. analysis:
   - inflectionPoint: kdaj se bo growth pattern spremenil (npr. "pri ~12 mesecih, ko trg nasiči") ali null
   - growthBottleneck: kaj trenutno najbolj omejuje rast (kapital, volumen, win rate, kategorije)
   - trajectoryAdvice: kako vzdrževati ali pospešiti trajektorijo (1-2 stavka v slovenščini)
3. summary: 1-2 stavka povzetka v slovenščini — kaj projektiraš in ključna ugotovitev

VRNI LE JSON:
{
  "projections": {
    "CONTINUE_CURRENT": { "month6": 0, "month12": 0, "month24": 0, "totalProfit24m": 0 },
    "ACCELERATED": { "month6": 0, "month12": 0, "month24": 0, "totalProfit24m": 0 },
    "DECELERATED": { "month6": 0, "month12": 0, "month24": 0, "totalProfit24m": 0 }
  },
  "analysis": {
    "inflectionPoint": "..." | null,
    "growthBottleneck": "...",
    "trajectoryAdvice": "..."
  },
  "summary": "1-2 stavka v slovenščini"
}${GROUNDING_PROMPT_SUFFIX}`;
}

function parseAiTrajectory(
  parsed: unknown,
  baseline: { projections: Projections; analysis: Analysis },
  maxMonthProfit: number,
  maxTotal24m: number,
): {
  projections: Projections;
  analysis: Analysis;
  summary: string | null;
  aiUsed: boolean;
} {
  const raw = parsed as AiTrajectoryResponse | null;
  if (!raw || typeof raw !== 'object') {
    return {
      projections: baseline.projections,
      analysis: baseline.analysis,
      summary: null,
      aiUsed: false,
    };
  }

  let projections = baseline.projections;
  let analysis = baseline.analysis;
  let summary: string | null = null;

  // Parse projections — apply anti-hallucination clamp [0, maxMonthProfit] / [0, maxTotal24m]
  if (raw.projections && typeof raw.projections === 'object') {
    const p = raw.projections as Record<string, unknown>;
    const parseScenario = (
      key: string,
      fallback: ScenarioProjection,
    ): ScenarioProjection => {
      const sc = p[key];
      if (!sc || typeof sc !== 'object') return fallback;
      const r = sc as Record<string, unknown>;
      return {
        month6: clampNumber(
          r.month6,
          0,
          maxMonthProfit,
          fallback.month6,
        ),
        month12: clampNumber(
          r.month12,
          0,
          maxMonthProfit,
          fallback.month12,
        ),
        month24: clampNumber(
          r.month24,
          0,
          maxMonthProfit,
          fallback.month24,
        ),
        totalProfit24m: clampNumber(
          r.totalProfit24m,
          0,
          maxTotal24m,
          fallback.totalProfit24m,
        ),
      };
    };
    projections = {
      CONTINUE_CURRENT: parseScenario(
        'CONTINUE_CURRENT',
        baseline.projections.CONTINUE_CURRENT,
      ),
      ACCELERATED: parseScenario(
        'ACCELERATED',
        baseline.projections.ACCELERATED,
      ),
      DECELERATED: parseScenario(
        'DECELERATED',
        baseline.projections.DECELERATED,
      ),
    };

    // Enforce ACCELERATED >= CONTINUE_CURRENT >= DECELERATED for totalProfit24m
    const totalAccel = projections.ACCELERATED.totalProfit24m;
    const totalCont = projections.CONTINUE_CURRENT.totalProfit24m;
    const totalDecel = projections.DECELERATED.totalProfit24m;
    if (totalAccel < totalCont) {
      projections.ACCELERATED = {
        ...projections.ACCELERATED,
        totalProfit24m: Math.max(totalAccel, totalCont),
      };
    }
    if (totalCont < totalDecel) {
      projections.CONTINUE_CURRENT = {
        ...projections.CONTINUE_CURRENT,
        totalProfit24m: Math.max(totalCont, totalDecel),
      };
    }
  }

  // Parse analysis
  if (raw.analysis && typeof raw.analysis === 'object') {
    const a = raw.analysis as Record<string, unknown>;
    const ip = a.inflectionPoint;
    analysis = {
      inflectionPoint:
        ip === null || ip === undefined
          ? null
          : clampString(ip, 400, baseline.analysis.inflectionPoint || ''),
      growthBottleneck: clampString(
        a.growthBottleneck,
        600,
        baseline.analysis.growthBottleneck,
      ),
      trajectoryAdvice: clampString(
        a.trajectoryAdvice,
        600,
        baseline.analysis.trajectoryAdvice,
      ),
    };
  }

  if (
    typeof raw.summary === 'string' &&
    raw.summary.trim().length > 0
  ) {
    summary = raw.summary.trim().slice(0, 600);
  }

  return { projections, analysis, summary, aiUsed: true };
}

// --- Handler -------------------------------------------------------------

const profitTrajectoryHandler = withAiRoute<ProfitTrajectoryInput>({
  endpoint: '/api/ai/profit-trajectory-forecaster',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — body ignored
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    // 1) Query SOLD trades from last 12 months for monthly profit history
    // NOTE: Prisma 6 DateTime filter does not accept `not: null`; using `gte`
    // implicitly excludes nulls for the sellDate field.
    const twelveMonthsAgo = new Date(Date.now() - 365 * DAY_MS);
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: twelveMonthsAgo },
        buyPrice: { gt: 0 },
        sellPrice: { not: null },
      },
      select: {
        id: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
      },
      take: 20000,
    });

    // Empty state
    if (soldTrades.length === 0) {
      return apiOk({
        ok: true,
        trajectory: {
          monthlyGrowthRate: 0,
          growthPattern: 'FLAT',
          growthVelocity: 0,
          currentTrajectory: 'Ni prodanih trade-ov — trajektorija ni mogoča.',
        },
        projections: {
          CONTINUE_CURRENT: { month6: 0, month12: 0, month24: 0, totalProfit24m: 0 },
          ACCELERATED: { month6: 0, month12: 0, month24: 0, totalProfit24m: 0 },
          DECELERATED: { month6: 0, month12: 0, month24: 0, totalProfit24m: 0 },
        },
        analysis: {
          inflectionPoint: null,
          growthBottleneck: 'Ni prodanih trade-ov — bottleneck neznan.',
          trajectoryAdvice: 'Dodaj prodane trade-e za izračun trajektorije rasti.',
        },
        summary:
          'Ni prodanih trade-ov — Profit Trajectory Forecaster ne more delovati.',
        aiUsed: false,
        message: 'Ni prodanih trade-ov — Profit Trajectory ni mogoča.',
      });
    }

    // 2) Bucket profit by month (last 12 months)
    const now = new Date();
    const monthlyMap = new Map<string, number>();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthlyMap.set(isoMonthKey(d), 0);
    }

    let currentMonthProfit = 0;
    const currentMonthKey = isoMonthKey(now);
    for (const t of soldTrades) {
      const sellDate = new Date(t.sellDate as unknown as Date | string);
      const key = isoMonthKey(sellDate);
      const profit =
        (t.sellPrice ?? 0) -
        (t.sellFees ?? 0) -
        (t.buyPrice ?? 0) -
        (t.buyFees ?? 0);
      if (monthlyMap.has(key)) {
        monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + profit);
      }
      if (key === currentMonthKey) {
        currentMonthProfit += profit;
      }
    }

    const monthlyProfits = Array.from(monthlyMap.values());

    // 3) Compute deterministic trajectory
    const baseline = buildDeterministicTrajectory(
      monthlyProfits,
      currentMonthProfit,
    );

    // 4) AI cache check (6h TTL) — key by current month
    const currentMonth = isoMonthKey(now);
    const cacheKey = `profit-trajectory:${currentMonth}`;
    const cached = getCachedAI<{
      projections: Projections;
      analysis: Analysis;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        trajectory: baseline.trajectory,
        projections: cached.projections,
        analysis: cached.analysis,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 5) Anti-hallucination clamp bounds — projected profits must be in [0, current × 4]
    const maxMonthProfit = Math.max(currentMonthProfit * 4, 50000);
    const maxTotal24m = maxMonthProfit * 24;

    // 6) AI prompt with grounding + call AI (try/catch z graceful fallback)
    const prompt = buildPrompt(
      baseline,
      monthlyProfits,
      currentMonthProfit,
      maxMonthProfit,
      maxTotal24m,
    );

    let projections = baseline.projections;
    let analysis = baseline.analysis;
    let summary = `Trajektorija: ${baseline.trajectory.growthPattern} (growth ${Math.round(baseline.trajectory.monthlyGrowthRate)}€/mo, velocity ${Math.round(baseline.trajectory.growthVelocity)}€/mo²). 24m projection: ${Math.round(baseline.projections.CONTINUE_CURRENT.totalProfit24m)}€ (trenutno) vs ${Math.round(baseline.projections.ACCELERATED.totalProfit24m)}€ (pospešeno). Bottleneck: ${analysis.growthBottleneck.slice(0, 100)}.`;
    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const result = parseAiTrajectory(parseAi(raw), baseline, maxMonthProfit, maxTotal24m);
      projections = result.projections;
      analysis = result.analysis;
      if (result.summary !== null) summary = result.summary;
      aiUsed = result.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/profit-trajectory-forecaster',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { projections, analysis, summary });
    }

    return apiOk({
      ok: true,
      trajectory: baseline.trajectory,
      projections,
      analysis,
      summary,
      aiUsed,
    });
  },
});

export const GET = profitTrajectoryHandler;
export const POST = profitTrajectoryHandler;
