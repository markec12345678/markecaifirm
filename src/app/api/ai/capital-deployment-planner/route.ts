// v7.76 / v8.96.4-batch1: AI Capital Deployment Planner — AI načrtuje KAKO
// deploy-ati razpoložljivi kapital v naslednjih 30/60/90 dneh — katere kategorije
// prioritizirati, koliko investirati, in timing deployment-ov.
// "2000€ deployable → Phase 1 (30d): 800€ elektronika (25% ROI). Phase 2 (60d):
//  700€ moda. Phase 3 (90d): 500€ reserve."
//
// Razlika od capital-allocation-optimizer (v7.63, ki da statično % alokacijo
// čez kategorije) — ta da TIME-PHASED deployment schedule (Phase 1/2/3 z
// timing-om). Razlika od capital-allocator (ki je basic capital allocation)
// — ta vključuje historične ROI-je per kategorija in časovno razporeditev.
// Razlika od budget-allocator (ki razdeli budget) — ta načrtuje deploy
// kapitala čez časovne faze. Razlika od cash-flow-forecast (ki napove
// capital 7/14/30d) — ta planira AKTIVNO deploy-anje kapitala, ne projection.
// Razlika od reinvestment-advisor (ki svetuje kam reinvestirat dobiček) — ta
// dačasi strukturiran deployment plan z risk mitigation in timing-om.
//
// GET+POST /api/ai/capital-deployment-planner
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.4-batch1) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type DeploymentStrategy = 'AGGRESSIVE' | 'BALANCED' | 'CONSERVATIVE';
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

interface CapitalInfo {
  availableCapital: number;
  heldCapital: number;
  deployableCapital: number;
  reserveAmount: number;
}

interface PhaseCategory {
  category: string;
  amount: number;
  expectedROI: number; // %
  expectedReturn: number;
  reasoning: string;
}

interface DeploymentPhase {
  phase: number;
  phaseName: string;
  timeWindow: string; // "Days 0-30"
  categories: PhaseCategory[];
  totalDeployment: number;
  expectedReturn: number;
  riskLevel: RiskLevel;
}

interface RiskMitigation {
  diversificationRule: string;
  maxPerCategory: number; // €
  reserveAdvice: string;
}

interface DeploymentSummary {
  totalToDeploy: number;
  totalExpectedReturn: number;
  overallROI: number; // %
  deploymentTimeline: string;
  advice: string;
}

interface AiDeploymentResponse {
  deploymentStrategy?: unknown;
  schedule?: unknown;
  riskMitigation?: unknown;
  summary?: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface CapitalDeploymentPlannerInput {}

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

const VALID_STRATEGY: readonly DeploymentStrategy[] = [
  'AGGRESSIVE',
  'BALANCED',
  'CONSERVATIVE',
];

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

// Pick strategy deterministically based on capital availability & market data
function pickStrategy(
  deployableCapital: number,
  heldCapital: number,
  categoryCount: number,
): DeploymentStrategy {
  // If low capital or few categories → conservative (don't risk thin spread)
  if (deployableCapital < 500 || categoryCount < 2) return 'CONSERVATIVE';
  // If lots of capital and heldCapital is high (over-allocated) → conservative
  if (heldCapital > 5000) return 'CONSERVATIVE';
  // If lots of capital and few held items → aggressive
  if (deployableCapital > 2000 && heldCapital < 1000) return 'AGGRESSIVE';
  return 'BALANCED';
}

// Build deterministic fallback schedule when AI unavailable
function buildDeterministicSchedule(
  deployableCapital: number,
  categoryRoi: Array<{ category: string; roi: number; trades: number }>,
  strategy: DeploymentStrategy,
): {
  schedule: DeploymentPhase[];
  riskMitigation: RiskMitigation;
  summary: DeploymentSummary;
} {
  // Sort categories by ROI desc, take top 3 (or fewer)
  const topCategories = [...categoryRoi]
    .sort((a, b) => b.roi - a.roi)
    .slice(0, Math.min(3, categoryRoi.length));

  // Phase split based on strategy (3 percentages that should sum to ~1.0)
  const phaseSplit: [number, number, number] =
    strategy === 'AGGRESSIVE'
      ? [0.6, 0.3, 0.1]
      : strategy === 'BALANCED'
        ? [0.4, 0.35, 0.25]
        : [0.3, 0.35, 0.35];

  const phases: DeploymentPhase[] = [];
  const phaseNames = ['Phase 1 — Hitri deployment', 'Phase 2 — Stabilna rast', 'Phase 3 — Rezervna faza'];
  const timeWindows = ['Days 0-30', 'Days 30-60', 'Days 60-90'];

  for (let i = 0; i < 3; i++) {
    const splitPct = phaseSplit[i]!;
    const phaseAmount = Math.round(deployableCapital * splitPct);
    if (phaseAmount <= 0) continue;
    // Assign category to this phase (cycle through top categories)
    const catIdx = i % topCategories.length;
    const cat = topCategories[catIdx];
    if (!cat) continue;
    const expectedReturn = Math.round(phaseAmount * (cat.roi / 100));
    phases.push({
      phase: i + 1,
      phaseName: phaseNames[i] ?? `Phase ${i + 1}`,
      timeWindow: timeWindows[i] ?? `Days ${i * 30}-${(i + 1) * 30}`,
      categories: [
        {
          category: cat.category,
          amount: phaseAmount,
          expectedROI: Math.round(cat.roi * 10) / 10,
          expectedReturn,
          reasoning: `Kategorija z ${cat.roi.toFixed(1)}% historičnim ROI-jem in ${cat.trades} prodajami — določena deterministično kot top-${catIdx + 1}.`,
        },
      ],
      totalDeployment: phaseAmount,
      expectedReturn,
      riskLevel: i === 0 ? 'MEDIUM' : i === 1 ? 'MEDIUM' : 'LOW',
    });
  }

  const totalToDeploy = phases.reduce((s, p) => s + p.totalDeployment, 0);
  const totalExpectedReturn = phases.reduce((s, p) => s + p.expectedReturn, 0);
  const overallROI = totalToDeploy > 0
    ? Math.round((totalExpectedReturn / totalToDeploy) * 1000) / 10
    : 0;

  const maxPerCategory = Math.round(deployableCapital * 0.4);

  const riskMitigation: RiskMitigation = {
    diversificationRule: `Max 40% kapitala (${maxPerCategory}€) v eno kategorijo — prepreči koncentracijo tveganja.`,
    maxPerCategory,
    reserveAdvice: `Drži 10% rezervo (${Math.round(deployableCapital * 0.1)}€) kot cash buffer za nepredvidene priložnosti ali izgube.`,
  };

  const phaseStrategyText = strategy === 'CONSERVATIVE'
    ? 'Konzervativen pristop — počasi deploy-aj in opazuj.'
    : 'Aktivno deploy-aj glede na plan.';
  const advice = `Strategija: ${strategy}. ${phases.length} faze, skupaj ${totalToDeploy}€ deployment z ${overallROI}% pričakovan ROI. ${phaseStrategyText}`;

  const summary: DeploymentSummary = {
    totalToDeploy,
    totalExpectedReturn,
    overallROI,
    deploymentTimeline: strategy === 'AGGRESSIVE'
      ? '30 dni (agresivno — 60% v prvem mesecu)'
      : strategy === 'BALANCED'
        ? '60 dni (uravnoteženo — 40% v prvem mesecu)'
        : '90 dni (konzervativno — 30% v prvem mesecu)',
    advice,
  };

  return { schedule: phases, riskMitigation, summary };
}

// --- Prompt builder ------------------------------------------------------

interface PromptArgs {
  availableCapital: number;
  heldCapital: number;
  reserveAmount: number;
  deployableCapital: number;
  deterministicStrategy: DeploymentStrategy;
  topCategoriesForPrompt: Array<{ category: string; roi: number; trades: number; totalCost: number }>;
}

function buildPrompt(args: PromptArgs): string {
  const {
    availableCapital,
    heldCapital,
    reserveAmount,
    deployableCapital,
    deterministicStrategy,
    topCategoriesForPrompt,
  } = args;

  return `Si AI "Capital Deployment Planner" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Načrtuj KAKO deploy-ati razpoložljivi kapital v naslednjih 30/60/90 dneh — katere kategorije prioritizirati, koliko investirati v vsako, in timing deployment-ov.

KAPITAL (deterministično izračunano):
- availableCapital: ${availableCapital}€ (neto prihodki iz SOLD trade-ov zadnjih 30 dni)
- heldCapital: ${heldCapital}€ (trenutno vezano v HELD inventarju)
- reserveAmount: ${reserveAmount}€ (10% cash buffer)
- deployableCapital: ${deployableCapital}€ (available - reserve)
- deterministicStrategy: ${deterministicStrategy}

ZGODOVINSKI ROI PER KATEGORIJA (zadnjih 90 dni, sortano desc po ROI):
${JSON.stringify(topCategoriesForPrompt, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. deploymentStrategy: AGGRESSIVE (deploy fast — 60% v Phase 1) / BALANCED (40% v Phase 1) / CONSERVATIVE (30% v Phase 1) — validiraj proti enum
2. schedule: array 3 faz (Phase 1/2/3)
   - phase: 1, 2, 3
   - phaseName: slovensko ime faze (max 60 znakov)
   - timeWindow: "Days 0-30" / "Days 30-60" / "Days 60-90"
   - categories: array (1-3 kategorij) z:
     - category: ime kategorije (mora obstajati v zgornjem seznamu!)
     - amount: € (vsota vseh kategorij v fazi ≤ totalToDeploy × phase pct)
     - expectedROI: % (clamped [−50, 200])
     - expectedReturn: amount × expectedROI / 100
     - reasoning: slovenski opis (max 200 znakov)
   - totalDeployment: vsota amount v fazi (≤ deployableCapital × phase pct)
   - expectedReturn: vsota expectedReturn v fazi
   - riskLevel: LOW / MEDIUM / HIGH (validiraj proti enum)
3. riskMitigation:
   - diversificationRule: slovenski (max 200 znakov)
   - maxPerCategory: € (≤ deployableCapital × 0.4)
   - reserveAdvice: slovenski (max 200 znakov)
4. summary:
   - totalToDeploy: vsota vseh faz (≈ deployableCapital)
   - totalExpectedReturn: vsota expectedReturn vseh faz
   - overallROI: % (totalExpectedReturn / totalToDeploy × 100)
   - deploymentTimeline: slovenski opis (max 100 znakov)
   - advice: slovenski nasvet (max 500 znakov)

VRNI LE JSON:
{
  "deploymentStrategy": "BALANCED",
  "schedule": [
    { "phase": 1, "phaseName": "...", "timeWindow": "Days 0-30", "categories": [{ "category": "...", "amount": 0, "expectedROI": 0, "expectedReturn": 0, "reasoning": "..." }], "totalDeployment": 0, "expectedReturn": 0, "riskLevel": "MEDIUM" }
  ],
  "riskMitigation": { "diversificationRule": "...", "maxPerCategory": 0, "reserveAdvice": "..." },
  "summary": { "totalToDeploy": 0, "totalExpectedReturn": 0, "overallROI": 0, "deploymentTimeline": "...", "advice": "..." }
}${GROUNDING_PROMPT_SUFFIX}`;
}

// --- AI response parser --------------------------------------------------

interface ParsedArgs {
  parsed: AiDeploymentResponse | null;
  deterministic: {
    schedule: DeploymentPhase[];
    riskMitigation: RiskMitigation;
    summary: DeploymentSummary;
  };
  deterministicStrategy: DeploymentStrategy;
  categoryRoi: Array<{ category: string; roi: number; trades: number; totalCost: number }>;
  deployableCapital: number;
}

function parseAiDeployment(args: ParsedArgs): {
  finalStrategy: DeploymentStrategy;
  schedule: DeploymentPhase[];
  riskMitigation: RiskMitigation;
  summary: DeploymentSummary;
  aiUsed: boolean;
} {
  const { parsed, deterministic, deterministicStrategy, categoryRoi, deployableCapital } = args;

  if (!parsed || typeof parsed !== 'object') {
    return {
      finalStrategy: deterministicStrategy,
      schedule: deterministic.schedule,
      riskMitigation: deterministic.riskMitigation,
      summary: deterministic.summary,
      aiUsed: false,
    };
  }

  const validCategories = new Set(categoryRoi.map((c) => c.category));

  let finalStrategy = deterministicStrategy;
  let schedule = deterministic.schedule;
  let riskMitigation = deterministic.riskMitigation;
  let summary = deterministic.summary;

  // Parse deploymentStrategy
  if (parsed.deploymentStrategy) {
    finalStrategy = clampEnum(
      parsed.deploymentStrategy,
      VALID_STRATEGY,
      deterministicStrategy,
    );
  }

  // Parse schedule (anti-hallucination: amounts ≤ deployableCapital,
  // categories must be from historical list)
  if (Array.isArray(parsed.schedule)) {
    const newSchedule: DeploymentPhase[] = [];
    let totalScheduled = 0;
    for (const p of parsed.schedule) {
      const r = p as Record<string, unknown>;
      if (!r || typeof r !== 'object') continue;
      const phaseNum = clampNumber(r.phase, 1, 3, 1);
      const phaseName = clampString(r.phaseName, 60, `Phase ${phaseNum}`);
      const timeWindowRaw = String(r.timeWindow || '').trim();
      const timeWindow = /^\s*Days\s+\d+\s*-\s*\d+\s*$/i.test(timeWindowRaw)
        ? timeWindowRaw
        : phaseNum === 1
          ? 'Days 0-30'
          : phaseNum === 2
            ? 'Days 30-60'
            : 'Days 60-90';
      const riskLevel = clampEnum(r.riskLevel, VALID_RISK, 'MEDIUM');

      // Parse categories
      const phaseCategories: PhaseCategory[] = [];
      if (Array.isArray(r.categories)) {
        for (const c of r.categories) {
          const cr = c as Record<string, unknown>;
          if (!cr || typeof cr !== 'object') continue;
          const category = String(cr.category || '').trim().toLowerCase();
          if (!category || !validCategories.has(category)) continue;
          const amount = clampNumber(cr.amount, 0, deployableCapital, 0);
          const expectedROI = clampNumber(cr.expectedROI, -50, 200, 0);
          const expectedReturn = clampNumber(
            cr.expectedReturn,
            -deployableCapital,
            deployableCapital * 2,
            Math.round(amount * (expectedROI / 100)),
          );
          const reasoning = clampString(cr.reasoning, 200, `Deploy ${amount}€ v ${category}.`);
          phaseCategories.push({
            category,
            amount: Math.round(amount),
            expectedROI: Math.round(expectedROI * 10) / 10,
            expectedReturn: Math.round(expectedReturn),
            reasoning,
          });
        }
      }
      // If no valid categories, skip this phase
      if (phaseCategories.length === 0) continue;

      // Clamp total deployment to deployableCapital (anti-hallucination)
      const totalDeployment = Math.round(
        Math.min(
          phaseCategories.reduce((s, c) => s + c.amount, 0),
          deployableCapital - totalScheduled,
        ),
      );
      if (totalDeployment <= 0) continue;
      totalScheduled += totalDeployment;

      const expectedReturn = Math.round(
        phaseCategories.reduce((s, c) => s + c.expectedReturn, 0),
      );

      newSchedule.push({
        phase: phaseNum,
        phaseName,
        timeWindow,
        categories: phaseCategories,
        totalDeployment,
        expectedReturn,
        riskLevel,
      });
    }
    if (newSchedule.length > 0) {
      // Sort by phase ascending
      newSchedule.sort((a, b) => a.phase - b.phase);
      schedule = newSchedule;
    }
  }

  // Parse riskMitigation
  if (parsed.riskMitigation && typeof parsed.riskMitigation === 'object') {
    const rm = parsed.riskMitigation as Record<string, unknown>;
    riskMitigation = {
      diversificationRule: clampString(
        rm.diversificationRule,
        200,
        deterministic.riskMitigation.diversificationRule,
      ),
      maxPerCategory: clampNumber(
        rm.maxPerCategory,
        0,
        deployableCapital * 0.4,
        deterministic.riskMitigation.maxPerCategory,
      ),
      reserveAdvice: clampString(
        rm.reserveAdvice,
        200,
        deterministic.riskMitigation.reserveAdvice,
      ),
    };
  }

  // Parse summary — recompute totals from actual schedule (anti-hallucination)
  const totalToDeploy = schedule.reduce((s, p) => s + p.totalDeployment, 0);
  const totalExpectedReturn = schedule.reduce((s, p) => s + p.expectedReturn, 0);
  const overallROI = totalToDeploy > 0
    ? Math.round((totalExpectedReturn / totalToDeploy) * 1000) / 10
    : 0;

  if (parsed.summary && typeof parsed.summary === 'object') {
    const s = parsed.summary as Record<string, unknown>;
    summary = {
      totalToDeploy,
      totalExpectedReturn,
      overallROI,
      deploymentTimeline: clampString(
        s.deploymentTimeline,
        100,
        deterministic.summary.deploymentTimeline,
      ),
      advice: clampString(s.advice, 500, deterministic.summary.advice),
    };
  } else {
    summary = {
      ...deterministic.summary,
      totalToDeploy,
      totalExpectedReturn,
      overallROI,
    };
  }

  return { finalStrategy, schedule, riskMitigation, summary, aiUsed: true };
}

// --- Handler -------------------------------------------------------------

const capitalDeploymentHandler = withAiRoute<CapitalDeploymentPlannerInput>({
  endpoint: '/api/ai/capital-deployment-planner',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // dual GET+POST

  parseBody: async () => {
    // Body ignored
    return {};
  },

  // No validateInput — body ignored

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    const now = Date.now();
    const soldCutoff = new Date(now - 30 * 86_400_000); // last 30d for available capital
    const roiCutoff = new Date(now - 90 * 86_400_000); // last 90d for ROI per category

    // 1) Query available capital (from recent sold trades — last 30d net proceeds)
    const recentSold = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: soldCutoff },
        sellPrice: { not: null },
      },
      select: {
        sellPrice: true,
        sellFees: true,
      },
      take: 5000,
    });
    const availableCapital = Math.round(
      recentSold.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0),
    );

    // 2) Query held capital (current HELD inventory buyPrice)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { buyPrice: true },
      take: 5000,
    });
    const heldCapital = Math.round(
      heldTrades.reduce((s, t) => s + (t.buyPrice ?? 0), 0),
    );

    // 3) Query historical ROI per category (from SOLD trades last 90d)
    const roiSold = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: roiCutoff },
        sellPrice: { not: null },
        buyPrice: { gt: 0 },
      },
      select: {
        category: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
      },
      take: 20000,
    });

    interface CategoryAgg {
      cost: number;
      revenue: number;
      profit: number;
      trades: number;
    }
    const catAgg = new Map<string, CategoryAgg>();
    for (const t of roiSold) {
      const cat = (t.category || '').trim().toLowerCase() || 'neznan';
      const cost = (t.buyPrice ?? 0) + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = revenue - cost;
      const a = catAgg.get(cat) || { cost: 0, revenue: 0, profit: 0, trades: 0 };
      a.cost += cost;
      a.revenue += revenue;
      a.profit += profit;
      a.trades += 1;
      catAgg.set(cat, a);
    }

    const categoryRoi: Array<{ category: string; roi: number; trades: number; totalCost: number }> = [];
    for (const [cat, agg] of catAgg.entries()) {
      const roi = agg.cost > 0 ? (agg.profit / agg.cost) * 100 : 0;
      categoryRoi.push({
        category: cat,
        roi: Math.round(roi * 10) / 10,
        trades: agg.trades,
        totalCost: Math.round(agg.cost),
      });
    }
    categoryRoi.sort((a, b) => b.roi - a.roi);

    // 4) Compute deployable capital (10% reserve kept as cash buffer)
    const reserveAmount = Math.round(availableCapital * 0.1);
    const deployableCapital = Math.max(0, availableCapital - reserveAmount);

    const capital: CapitalInfo = {
      availableCapital,
      heldCapital,
      deployableCapital,
      reserveAmount,
    };

    // Empty state — no available capital to deploy
    if (deployableCapital <= 0 || categoryRoi.length === 0) {
      const strategy: DeploymentStrategy = 'CONSERVATIVE';
      return apiOk({
        ok: true,
        capital,
        deploymentStrategy: strategy,
        schedule: [],
        riskMitigation: {
          diversificationRule: 'Ni kapitala za deploy — pridobi SOLD trade-e za sprostitev kapitala.',
          maxPerCategory: 0,
          reserveAdvice: 'Ni rezerve — čakaj na prvo prodajo ali dodaj nov kapital.',
        },
        summary: {
          totalToDeploy: 0,
          totalExpectedReturn: 0,
          overallROI: 0,
          deploymentTimeline: 'Ni podatkov',
          advice: availableCapital <= 0
            ? 'Ni razpoložljivega kapitala v zadnjih 30 dneh — dodaj SOLD trade-e (status "sold", sellDate v zadnjih 30 dneh) za Capital Deployment Planner.'
            : 'Ni zgodovinskih ROI podatkov per kategorija (SOLD trade-i zadnjih 90 dni) — dodaj trade-e z buyPrice > 0 za izračun ROI-jev.',
        },
        aiUsed: false,
        message: availableCapital <= 0
          ? 'Ni razpoložljivega kapitala — Capital Deployment Planner ni mogoč.'
          : 'Ni zgodovinskih ROI podatkov — Capital Deployment Planner ni mogoč.',
      });
    }

    // 5) Pick deterministic strategy (baseline)
    const deterministicStrategy = pickStrategy(
      deployableCapital,
      heldCapital,
      categoryRoi.length,
    );

    // 6) AI cache check (6h TTL) — key by availableCapital (snapshot of capital)
    const cacheKey = `capital-deployment-planner:${availableCapital}`;
    const cached = getCachedAI<{
      deploymentStrategy: DeploymentStrategy;
      schedule: DeploymentPhase[];
      riskMitigation: RiskMitigation;
      summary: DeploymentSummary;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        capital,
        deploymentStrategy: cached.deploymentStrategy,
        schedule: cached.schedule,
        riskMitigation: cached.riskMitigation,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 7) AI prompt with grounding
    const topCategoriesForPrompt = categoryRoi.slice(0, 10);
    const prompt = buildPrompt({
      availableCapital,
      heldCapital,
      reserveAmount,
      deployableCapital,
      deterministicStrategy,
      topCategoriesForPrompt,
    });

    const deterministic = buildDeterministicSchedule(
      deployableCapital,
      categoryRoi,
      deterministicStrategy,
    );

    let finalStrategy = deterministicStrategy;
    let schedule = deterministic.schedule;
    let riskMitigation = deterministic.riskMitigation;
    let summary = deterministic.summary;
    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiDeploymentResponse | null;
      const result = parseAiDeployment({
        parsed,
        deterministic,
        deterministicStrategy,
        categoryRoi,
        deployableCapital,
      });
      finalStrategy = result.finalStrategy;
      schedule = result.schedule;
      riskMitigation = result.riskMitigation;
      summary = result.summary;
      aiUsed = result.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/capital-deployment-planner',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        deploymentStrategy: finalStrategy,
        schedule,
        riskMitigation,
        summary,
      });
    }

    return apiOk({
      ok: true,
      capital,
      deploymentStrategy: finalStrategy,
      schedule,
      riskMitigation,
      summary,
      aiUsed,
    });
  },
});

export const GET = capitalDeploymentHandler;
export const POST = capitalDeploymentHandler;
