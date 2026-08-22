// v7.63 / v8.96.5-batch2: Capital Allocation Optimizer — AI-driven optimal allocation of
// available capital across categories, optimizing for risk-adjusted
// (Sharpe-like) returns. Generira 3 strategije (CONSERVATIVE, BALANCED,
// AGGRESSIVE) bazirane na zgodovinskih ROI + volatilnosti per kategorija.
//
// Razlika od capital-allocation-advisor (ki svetuje STATIČNO alokacijo po
// kategorijah) — ta je DINAMIČNA: upošteva trenutno portfeljsko alokacijo,
// računa volatilnost ROI (std dev), in optimira Sharpe-like ratio
// (expectedROI / riskScore). Generira 3 strategije namesto 1.
//
// "2000€ available → BALANCED: 40% elektronika (25% ROI), 30% moda (15%),
//  30% orodje (20%)"
//
// GET+POST /api/ai/capital-allocation-optimizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.5) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Input ----------------------------------------------------------------

interface CapitalAllocationOptimizerInput {
  availableCapital?: number;
}

// --- Types ---------------------------------------------------------------

interface CategoryHistStat {
  category: string;
  count: number;
  roiSum: number; // sum of ROI percentages per trade
  rois: number[]; // individual ROI percentages per trade (for std dev)
  invested: number;
  profit: number;
}

interface CurrentAllocationEntry {
  category: string;
  percentage: number;
  capital: number;
}

interface AllocationEntry {
  category: string;
  percentage: number;
  amountToInvest: number;
  expectedROI: number; // %
  riskScore: number; // 0-100
  sharpeLikeRatio: number;
  reasoning: string;
}

interface Strategy {
  name: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  riskTolerance: 'LOW' | 'MEDIUM' | 'HIGH';
  expectedTotalROI: number;
  expectedTotalProfit: number;
  sharpeLikeRatio: number;
  allocations: AllocationEntry[];
}

interface RebalanceAction {
  action: 'BUY' | 'SELL' | 'HOLD';
  category: string;
  amount: number;
  reason: string;
}

interface AiAllocationEntry {
  category?: unknown;
  percentage?: unknown;
  expectedROI?: unknown;
  riskScore?: unknown;
  reasoning?: unknown;
}

interface AiStrategyEntry {
  name?: unknown;
  allocations?: AiAllocationEntry[];
}

interface AiOptimizerResponse {
  strategies?: AiStrategyEntry[];
  bestStrategy?: unknown;
  reasoning?: unknown;
  confidence?: unknown;
  rebalanceActions?: Array<{
    action?: unknown;
    category?: unknown;
    amount?: unknown;
    reason?: unknown;
  }>;
}

// --- Helpers -------------------------------------------------------------

function clampNumber(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw == null) return Math.max(min, Math.min(max, fallback));
  let v = Number(raw);
  if (!Number.isFinite(v)) v = fallback;
  return Math.max(min, Math.min(max, v));
}

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

// std dev of an array of numbers (sample std dev, ddof=1) — 0 if < 2 samples
function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// Risk score from volatility (0-100). Map std dev of ROI (0-100%) to risk 0-100.
function riskScoreFromVolatility(vol: number): number {
  // vol 0% → 10 (low), vol 20% → 30, vol 50% → 60, vol 80%+ → 90
  const score = Math.round(10 + Math.min(80, vol * 1.2));
  return Math.max(5, Math.min(95, score));
}

// --- Deterministic fallback ---------------------------------------------

// Build a deterministic allocation given historical ROI/vol per category,
// the available capital, and a risk-multiplier (low/med/high).
function deterministicAllocations(
  categories: Array<{
    category: string;
    avgROI: number;
    vol: number;
    riskScore: number;
  }>,
  availableCapital: number,
  riskMultiplier: number, // 0.5 conservative, 1.0 balanced, 1.5 aggressive
): AllocationEntry[] {
  if (categories.length === 0) return [];

  // Weight = (1 + max(0, avgROI / 20)) / max(1, riskScore / 30) × riskMultiplier
  // Higher ROI + lower risk → higher weight. riskMultiplier scales appetite.
  const weights = categories.map(c => {
    const roiFactor = 1 + Math.max(0, c.avgROI) / 20;
    const riskFactor = Math.max(1, c.riskScore / 30);
    // For aggressive, slightly boost high-ROI even if risky
    const appetite = riskMultiplier;
    return Math.max(0.05, (roiFactor / riskFactor) * appetite);
  });
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  return categories.map((c, i) => {
    const percentage = Math.round((weights[i] / totalWeight) * 1000) / 10;
    const amountToInvest = Math.round(
      (weights[i] / totalWeight) * availableCapital,
    );
    // Clamp expectedROI to [-20%, 100%]
    const expectedROI = Math.max(-20, Math.min(100, Math.round(c.avgROI)));
    const riskScore = Math.max(5, Math.min(95, c.riskScore));
    const sharpeLikeRatio =
      riskScore > 0
        ? Math.round((expectedROI / riskScore) * 100) / 100
        : 0;
    return {
      category: c.category,
      percentage,
      amountToInvest,
      expectedROI,
      riskScore,
      sharpeLikeRatio,
      reasoning: `Deterministicna alokacija bazirana na ${c.avgROI.toFixed(
        1,
      )}% zgodovinskem ROI in volatilnosti ${c.vol.toFixed(1)}%. Delež ${percentage}% od razpoložljivega kapitala.`,
    };
  });
}

function buildDeterministicStrategy(
  categories: Array<{ category: string; avgROI: number; vol: number; riskScore: number }>,
  availableCapital: number,
  name: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE',
  riskMultiplier: number,
  riskTol: 'LOW' | 'MEDIUM' | 'HIGH',
): Strategy {
  // Sort: CONSERVATIVE prefers low risk, AGGRESSIVE prefers high ROI
  const sorted =
    name === 'CONSERVATIVE'
      ? [...categories].sort((a, b) => a.riskScore - b.riskScore)
      : name === 'AGGRESSIVE'
      ? [...categories].sort((a, b) => b.avgROI - a.avgROI)
      : categories;

  const allocations = deterministicAllocations(
    sorted,
    availableCapital,
    riskMultiplier,
  );

  // Anti-hallucination: ensure percentages sum to 100
  const totalPct = allocations.reduce((s, a) => s + a.percentage, 0);
  if (allocations.length > 0 && Math.abs(totalPct - 100) > 0.5) {
    // Renormalize to 100
    const scale = 100 / totalPct;
    let acc = 0;
    for (let i = 0; i < allocations.length; i++) {
      const newPct = i === allocations.length - 1
        ? Math.round((100 - acc) * 10) / 10
        : Math.round(allocations[i].percentage * scale * 10) / 10;
      acc += newPct;
      allocations[i].percentage = newPct;
      allocations[i].amountToInvest = Math.round(
        (newPct / 100) * availableCapital,
      );
    }
  }

  const expectedTotalROI = allocations.length > 0
    ? Math.round(
        allocations.reduce(
          (s, a) => s + (a.expectedROI * a.percentage) / 100,
          0,
        ),
      )
    : 0;
  const expectedTotalProfit = Math.round(
    (expectedTotalROI / 100) * availableCapital,
  );

  // Sharpe-like = expectedTotalROI / weighted riskScore
  const totalRisk = allocations.length > 0
    ? allocations.reduce(
        (s, a) => s + (a.riskScore * a.percentage) / 100,
        0,
      )
    : 0;
  const sharpeLikeRatio =
    totalRisk > 0
      ? Math.round((expectedTotalROI / totalRisk) * 100) / 100
      : 0;

  return {
    name,
    riskTolerance: riskTol,
    expectedTotalROI,
    expectedTotalProfit,
    sharpeLikeRatio,
    allocations,
  };
}

// --- AI prompt + merge helpers (pure, testable) ---------------------------

function buildPrompt(
  availableCapital: number,
  categoriesForAI: Array<{ category: string; avgROI: number; vol: number; riskScore: number }>,
  currentAllocation: CurrentAllocationEntry[],
): string {
  const catsBlock = categoriesForAI
    .map(
      (c, i) =>
        `${i + 1}. ${c.category} | avgROI=${c.avgROI}% | volatility=${c.vol}% | riskScore=${c.riskScore}/100`,
    )
    .join('\n');

  const currentAllocBlock = currentAllocation.length > 0
    ? currentAllocation
        .map(
          (a, i) =>
            `${i + 1}. ${a.category} | ${a.percentage}% | ${a.capital}€`,
        )
        .join('\n')
    : '(ni held inventarja)';

  return `Si AI finančni optimizer za trading firmo na oglasnih platformah (Bolha, Vinted, mobile.de).
Tvoja naloga je optimirati alokacijo razpoložljivega kapitala čez kategorije tako, da maksimiraš
risk-adjusted return (Sharpe-like ratio = expectedROI / riskScore).

RAZPOLOŽLJIVI KAPITAL: ${availableCapital}€

ZGODOVINSKI ROI PER KATEGORIJA (iz sold trades):
${catsBlock}

TRENUTNA ALOKACIJA HELD INVENTARJA:
${currentAllocBlock}

NALOGA:
Generiraj 3 strategije alokacije — CONSERVATIVE, BALANCED, AGGRESSIVE.

1. CONSERVATIVE (LOW risk tolerance):
   - Nagib k nizko-volatilnim kategorijam (riskScore < 40)
   - expectedROI nekoliko nižji (clamped [-20, 100] %)
   - Manjše pozicije v visoko-tveganih kategorijah

2. BALANCED (MEDIUM risk tolerance):
   - Enakomerna mešanica ROI in tveganja
   - Sharpe-like ratio maximization

3. AGGRESSIVE (HIGH risk tolerance):
   - Nagib k visokemu ROI (tudi če volatilnost visoka)
   - Večje pozicije v top kategorijah

PRAVILA ZA VSAKO STRATEGIJO:
- allocations[]: za vsako kategorijo določi percentage (0-100), expectedROI clamped na [-20, 100] %,
  riskScore (0-100, baziran na volatilnosti), reasoning (1 stavek slovensko).
- Skupna suma percentage mora biti 100.
- sharpeLikeRatio = expectedROI / riskScore (kategorija).
- expectedTotalROI = Σ(expectedROI × percentage / 100) — za strategijo.
- expectedTotalProfit = round(expectedTotalROI / 100 × ${availableCapital}).
- sharpeLikeRatio za strategijo = expectedTotalROI / Σ(riskScore × percentage / 100).

REBALANCE ACTIONS:
- BUY: kategorije kjer je trenutna alokacija premajhna glede na novo BALANCED strategijo
- SELL: kategorije kjer je trenutna alokacija prevelika
- HOLD: kategorije kjer je razlika < 5%
- Za vsako akcijo določi amount (€) in reason (slovensko).

VRNI LE JSON:
{
  "strategies": [
    {
      "name": "CONSERVATIVE|BALANCED|AGGRESSIVE",
      "allocations": [
        {
          "category": "...",
          "percentage": <0-100>,
          "expectedROI": <-20 do 100>,
          "riskScore": <0-100>,
          "reasoning": "<1 stavek>"
        }
      ]
    }
  ],
  "bestStrategy": "CONSERVATIVE|BALANCED|AGGRESSIVE",
  "reasoning": "<slovensko, 1-2 stavka, zakaj ta strategija>",
  "confidence": <0-100>,
  "rebalanceActions": [
    { "action": "BUY|SELL|HOLD", "category": "...", "amount": <€>, "reason": "<slovensko>" }
  ]
}${GROUNDING_PROMPT_SUFFIX}`;
}

function mergeAiIntoStrategies(
  parsed: AiOptimizerResponse | null,
  categoriesForAI: Array<{ category: string; avgROI: number; vol: number; riskScore: number }>,
  availableCapital: number,
): {
  strategies: Strategy[];
  bestStrategy: string;
  bestReasoning: string;
  confidence: number;
  rebalanceActions: RebalanceAction[];
  aiUsed: boolean;
} {
  const strategies: Strategy[] = [];
  let bestStrategy = 'BALANCED';
  let bestReasoning = '';
  let confidence = 50;
  const rebalanceActions: RebalanceAction[] = [];
  let aiUsed = false;

  if (!parsed || !Array.isArray(parsed.strategies)) {
    return { strategies, bestStrategy, bestReasoning, confidence, rebalanceActions, aiUsed };
  }

  const validStrategyNames = new Set([
    'CONSERVATIVE',
    'BALANCED',
    'AGGRESSIVE',
  ]);
  const riskTolMap: Record<string, 'LOW' | 'MEDIUM' | 'HIGH'> = {
    CONSERVATIVE: 'LOW',
    BALANCED: 'MEDIUM',
    AGGRESSIVE: 'HIGH',
  };
  const riskMultMap: Record<string, number> = {
    CONSERVATIVE: 0.5,
    BALANCED: 1.0,
    AGGRESSIVE: 1.5,
  };

  for (const rawStrat of parsed.strategies) {
    const nameRaw = String(rawStrat.name || '').toUpperCase().trim();
    if (!validStrategyNames.has(nameRaw)) continue;
    const name = nameRaw as 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
    // Build allocations: validate each AI entry, fallback to deterministic
    const det = buildDeterministicStrategy(
      categoriesForAI,
      availableCapital,
      name,
      riskMultMap[name],
      riskTolMap[name],
    );

    // Match AI allocations to historical categories
    const histByCat = new Map(
      categoriesForAI.map(c => [c.category, c]),
    );
    const aiAllocs = Array.isArray(rawStrat.allocations)
      ? rawStrat.allocations
      : [];

    const allocations: AllocationEntry[] = [];
    let totalPctRaw = 0;
    for (const rawAlloc of aiAllocs) {
      const cat = clampString(rawAlloc.category, 60, '')
        .toLowerCase()
        .trim();
      if (!cat || !histByCat.has(cat)) continue;
      const hist = histByCat.get(cat)!;
      const percentage = clampNumber(rawAlloc.percentage, 0, 100, 0);
      if (percentage <= 0) continue;
      const expectedROI = clampNumber(
        rawAlloc.expectedROI,
        -20,
        100,
        hist.avgROI,
      );
      const riskScore = clampNumber(
        rawAlloc.riskScore,
        5,
        95,
        hist.riskScore,
      );
      const sharpeLikeRatio =
        riskScore > 0
          ? Math.round((expectedROI / riskScore) * 100) / 100
          : 0;
      const reasoning = clampString(
        rawAlloc.reasoning,
        240,
        `${cat}: ${expectedROI}% ROI, risk ${riskScore}/100.`,
      );
      allocations.push({
        category: cat,
        percentage,
        amountToInvest: 0, // filled after normalization
        expectedROI,
        riskScore,
        sharpeLikeRatio,
        reasoning,
      });
      totalPctRaw += percentage;
    }

    // Anti-hallucination: if AI skipped categories or sum != 100, fall back to deterministic
    if (allocations.length === 0 || Math.abs(totalPctRaw - 100) > 1) {
      // Use deterministic for this strategy
      strategies.push(det);
      continue;
    }

    // Normalize percentages to sum exactly 100 + compute amounts
    const scale = 100 / totalPctRaw;
    let acc = 0;
    for (let i = 0; i < allocations.length; i++) {
      const isLast = i === allocations.length - 1;
      const newPct = isLast
        ? Math.round((100 - acc) * 10) / 10
        : Math.round(allocations[i].percentage * scale * 10) / 10;
      acc += newPct;
      allocations[i].percentage = newPct;
      allocations[i].amountToInvest = Math.round(
        (newPct / 100) * availableCapital,
      );
    }

    // Compute strategy-level metrics
    const expectedTotalROI = Math.round(
      allocations.reduce(
        (s, a) => s + (a.expectedROI * a.percentage) / 100,
        0,
      ),
    );
    const expectedTotalProfit = Math.round(
      (expectedTotalROI / 100) * availableCapital,
    );
    const totalRisk = allocations.reduce(
      (s, a) => s + (a.riskScore * a.percentage) / 100,
      0,
    );
    const sharpeLikeRatio =
      totalRisk > 0
        ? Math.round((expectedTotalROI / totalRisk) * 100) / 100
        : 0;

    strategies.push({
      name,
      riskTolerance: riskTolMap[name],
      expectedTotalROI,
      expectedTotalProfit,
      sharpeLikeRatio,
      allocations,
    });
  }

  // Validate bestStrategy
  const bestRaw = String(parsed.bestStrategy || '').toUpperCase().trim();
  if (validStrategyNames.has(bestRaw)) {
    bestStrategy = bestRaw;
  }
  bestReasoning = clampString(parsed.reasoning, 360, '');
  confidence = clampNumber(parsed.confidence, 0, 100, 50);

  // Rebalance actions
  if (Array.isArray(parsed.rebalanceActions)) {
    const validActions = new Set(['BUY', 'SELL', 'HOLD']);
    for (const ra of parsed.rebalanceActions) {
      const actionRaw = String(ra.action || '').toUpperCase().trim();
      if (!validActions.has(actionRaw)) continue;
      const category = clampString(ra.category, 60, '')
        .toLowerCase()
        .trim();
      if (!category) continue;
      const amount = clampNumber(ra.amount, 0, availableCapital * 2, 0);
      const reason = clampString(
        ra.reason,
        240,
        `${actionRaw} ${category}: rebalance po BALANCED strategiji.`,
      );
      rebalanceActions.push({
        action: actionRaw as 'BUY' | 'SELL' | 'HOLD',
        category,
        amount: Math.round(amount),
        reason,
      });
    }
  }

  if (strategies.length > 0) aiUsed = true;

  return { strategies, bestStrategy, bestReasoning, confidence, rebalanceActions, aiUsed };
}

// --- Handler -------------------------------------------------------------

const capitalAllocationOptimizerHandler = withAiRoute<CapitalAllocationOptimizerInput>({
  endpoint: '/api/ai/capital-allocation-optimizer',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => {
    let availableCapital: number | undefined;
    try {
      const body = await req.json().catch(() => ({}));
      if (body && typeof body === 'object') {
        if (typeof body.availableCapital === 'number' && body.availableCapital >= 0) {
          availableCapital = body.availableCapital;
        }
      }
    } catch {
      // GET request — no body
    }
    return { availableCapital };
  },

  // No validateInput — optional availableCapital override
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;
    const overrideCapital = input.availableCapital ?? null;

    // 1) Query SOLD trades (last 30d) for available capital (sellPrice - sellFees)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const recentSoldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: thirtyDaysAgo, not: null },
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
      take: 2000,
    });

    // 2) Query HELD trades for current portfolio allocation
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        category: true,
        buyPrice: true,
        buyFees: true,
      },
      take: 2000,
    });

    // 3) Query ALL sold trades for historical ROI per category
    const allSoldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        buyPrice: { gt: 0 },
      },
      select: {
        id: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
      },
      take: 5000,
    });

    // 4) Compute available capital from last 30d sold trades
    let availableCapital = overrideCapital ?? 0;
    if (overrideCapital == null) {
      availableCapital = recentSoldTrades.reduce(
        (s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)),
        0,
      );
    }
    availableCapital = Math.round(availableCapital);

    // 5) Held capital (current portfolio)
    let heldCapital = 0;
    const heldByCat = new Map<string, number>();
    for (const t of heldTrades) {
      const cat = (t.category || 'drugo').trim().toLowerCase() || 'drugo';
      const invested = t.buyPrice + (t.buyFees ?? 0);
      heldCapital += invested;
      heldByCat.set(cat, (heldByCat.get(cat) ?? 0) + invested);
    }
    heldCapital = Math.round(heldCapital);

    const currentAllocation: CurrentAllocationEntry[] = Array.from(
      heldByCat.entries(),
    )
      .map(([category, capital]) => ({
        category,
        capital: Math.round(capital),
        percentage:
          heldCapital > 0
            ? Math.round((capital / heldCapital) * 1000) / 10
            : 0,
      }))
      .sort((a, b) => b.capital - a.capital);

    // 6) Historical ROI + volatility per category (from ALL sold trades)
    const catMap = new Map<string, CategoryHistStat>();
    for (const t of allSoldTrades) {
      const cat = (t.category || 'drugo').trim().toLowerCase() || 'drugo';
      const invested = t.buyPrice + (t.buyFees ?? 0);
      const returned = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = returned - invested;
      const roi = invested > 0 ? (profit / invested) * 100 : 0;
      const cur =
        catMap.get(cat) ||
        { category: cat, count: 0, roiSum: 0, rois: [], invested: 0, profit: 0 };
      cur.count += 1;
      cur.roiSum += roi;
      cur.rois.push(roi);
      cur.invested += invested;
      cur.profit += profit;
      catMap.set(cat, cur);
    }

    const histStats = Array.from(catMap.values()).map(s => ({
      category: s.category,
      count: s.count,
      avgROI: Math.round((s.roiSum / s.count) * 10) / 10,
      vol: Math.round(stdDev(s.rois) * 10) / 10,
      invested: Math.round(s.invested),
      profit: Math.round(s.profit),
    }));

    // Categories for AI prompt — at least 1 sold trade
    const categoriesForAI = histStats
      .filter(s => s.count >= 1)
      .map(s => ({
        category: s.category,
        avgROI: s.avgROI,
        vol: s.vol,
        riskScore: riskScoreFromVolatility(s.vol),
      }));

    // Empty-state fallback
    if (availableCapital <= 0 || categoriesForAI.length === 0) {
      return apiOk({
        ok: true,
        current: {
          availableCapital,
          heldCapital,
          currentAllocation,
        },
        strategies: [],
        recommendation: {
          bestStrategy: 'NONE',
          reasoning:
            availableCapital <= 0
              ? 'Ni razpoložljivega kapitala (0€ iz prodaj zadnjih 30 dni). Prodi inventar da sprostiš kapital.'
              : 'Ni zgodovine prodaj — Capital Allocation Optimizer potrebuje vsaj 1 sold trade za ROI per kategorijo.',
          confidence: 0,
          rebalanceActions: [],
        },
        aiUsed: false,
        message:
          availableCapital <= 0
            ? 'Ni razpoložljivega kapitala za alokacijo (0€ iz prodaj zadnjih 30 dni).'
            : 'Ni zgodovine prodaj — Capital Allocation Optimizer potrebuje sold trade-ove.',
      });
    }

    // 7) AI cache — keyed by availableCapital
    const cacheKey = `capital-allocation-optimizer:${availableCapital}`;
    const cached = getCachedAI<{
      strategies: Strategy[];
      recommendation: {
        bestStrategy: string;
        reasoning: string;
        confidence: number;
        rebalanceActions: RebalanceAction[];
      };
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        current: {
          availableCapital,
          heldCapital,
          currentAllocation,
        },
        ...cached,
        cached: true,
        aiUsed: true,
      });
    }

    // 8) Build AI prompt with grounding
    const prompt = buildPrompt(availableCapital, categoriesForAI, currentAllocation);

    let aiUsed = false;
    let strategies: Strategy[] = [];
    let bestStrategy = 'BALANCED';
    let bestReasoning = '';
    let confidence = 50;
    let rebalanceActions: RebalanceAction[] = [];

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiOptimizerResponse | null;
      const result = mergeAiIntoStrategies(parsed, categoriesForAI, availableCapital);
      strategies = result.strategies;
      bestStrategy = result.bestStrategy;
      bestReasoning = result.bestReasoning;
      confidence = result.confidence;
      rebalanceActions = result.rebalanceActions;
      aiUsed = result.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/capital-allocation-optimizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 9) Deterministic fallback — build all 3 strategies if AI didn't return enough
    const strategyNames: Array<'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE'> = [
      'CONSERVATIVE',
      'BALANCED',
      'AGGRESSIVE',
    ];
    const riskMultMap: Record<string, number> = {
      CONSERVATIVE: 0.5,
      BALANCED: 1.0,
      AGGRESSIVE: 1.5,
    };
    const riskTolMap: Record<string, 'LOW' | 'MEDIUM' | 'HIGH'> = {
      CONSERVATIVE: 'LOW',
      BALANCED: 'MEDIUM',
      AGGRESSIVE: 'HIGH',
    };
    const existingStrats = new Set(strategies.map(s => s.name));
    for (const name of strategyNames) {
      if (!existingStrats.has(name)) {
        strategies.push(
          buildDeterministicStrategy(
            categoriesForAI,
            availableCapital,
            name,
            riskMultMap[name],
            riskTolMap[name],
          ),
        );
      }
    }

    // Sort strategies by canonical order
    const orderMap: Record<string, number> = {
      CONSERVATIVE: 0,
      BALANCED: 1,
      AGGRESSIVE: 2,
    };
    strategies.sort((a, b) => orderMap[a.name] - orderMap[b.name]);

    // 10) Validate bestStrategy is among the strategies
    if (!strategies.find(s => s.name === bestStrategy)) {
      // Pick by Sharpe-like ratio
      const bestBySharpe = [...strategies].sort(
        (a, b) => b.sharpeLikeRatio - a.sharpeLikeRatio,
      )[0];
      bestStrategy = bestBySharpe?.name || 'BALANCED';
    }
    if (!bestReasoning) {
      const chosen = strategies.find(s => s.name === bestStrategy);
      bestReasoning = chosen
        ? `${bestStrategy} strategija: pričakovan ROI ${chosen.expectedTotalROI}% (profit ${chosen.expectedTotalProfit}€), Sharpe-like ratio ${chosen.sharpeLikeRatio}.`
        : `${bestStrategy} strategija izbrana kot optimalen kompromis med ROI in tveganjem.`;
    }

    // 11) Compute deterministic rebalance actions if AI didn't supply any
    if (rebalanceActions.length === 0) {
      const balanced = strategies.find(s => s.name === 'BALANCED');
      if (balanced) {
        const currentByCat = new Map(
          currentAllocation.map(a => [a.category, a]),
        );
        const totalHeldPct = currentAllocation.reduce(
          (s, a) => s + a.percentage,
          0,
        );
        // Compare BALANCED allocation vs current allocation (% of total)
        for (const alloc of balanced.allocations) {
          const cur = currentByCat.get(alloc.category);
          const curPct = cur?.percentage ?? 0;
          const diff = alloc.percentage - curPct;
          if (diff > 5) {
            // Underexposed → BUY
            const amount = Math.round(
              (diff / 100) * Math.max(availableCapital, heldCapital),
            );
            if (amount > 0) {
              rebalanceActions.push({
                action: 'BUY',
                category: alloc.category,
                amount,
                reason: `Trenutno ${curPct}% → cilj ${alloc.percentage}%. BUY da povečaš izpostavljenost.`,
              });
            }
          } else if (diff < -5) {
            // Overexposed → SELL
            const amount = Math.round(
              (Math.abs(diff) / 100) * Math.max(availableCapital, heldCapital),
            );
            if (amount > 0) {
              rebalanceActions.push({
                action: 'SELL',
                category: alloc.category,
                amount,
                reason: `Trenutno ${curPct}% → cilj ${alloc.percentage}%. SELL da zmanjšaš izpostavljenost.`,
              });
            }
          } else if (totalHeldPct > 0 || cur) {
            rebalanceActions.push({
              action: 'HOLD',
              category: alloc.category,
              amount: 0,
              reason: `Trenutno ${curPct}% → cilj ${alloc.percentage}% (znotraj ±5%). HOLD.`,
            });
          }
        }
      }
    }

    const recommendation = {
      bestStrategy,
      reasoning: bestReasoning,
      confidence,
      rebalanceActions,
    };

    // 12) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { strategies, recommendation });
    }

    return apiOk({
      ok: true,
      current: {
        availableCapital,
        heldCapital,
        currentAllocation,
      },
      strategies,
      recommendation,
      aiUsed,
    });
  },
});

export const GET = capitalAllocationOptimizerHandler;
export const POST = capitalAllocationOptimizerHandler;
