// v7.79 / v8.96.4-batch2: AI Inventory ROI Optimizer — AI optimira ROI čez
// celoten HELD inventar — identificira kateri item-i imajo najboljši/najslabši
// ROI potencial in predlaga rebalancing (prodaj nizko-ROI item-e, obdrži
// visoko-ROI). "Portfolio ROI: 18% → projected 24% z optimizacijami.
// Sell 2 negativnih item-ov, obdrži 3 visoko-ROI. +320€ izboljšanje."
//
// Razlika od inventory-profit-maximizer (v7.x, ki maksimizira profit na
// posameznem item-u) — ta optimira PORTFOLIO ROI čez vse HELD item-e z
// rebalancing actions. Razlika od inventory-profitability-analyzer (ki
// analizira profitabilnost kategorij) — ta gleda POSAMEZNE HELD item-e
// z ROI potential in urgency. Razlika od inventory-profit-margin-tracker
// (ki track-a margin čez čas) — ta OPTIMIRA z AI-generated rebalance
// actions (HOLD/SELL_NOW/PRICE_ADJUST/BUNDLE/LIQUIDATE). Razlika od
// refurb-roi-calculator (ki računa ROI za refurb projekt) — ta gleda
// UNREALIZED ROI na current HELD inventar z AI projection. Razlika od
// roi-leaderboard (ki rank-a best brands by ROI) — ta optimira TRENUTNI
// inventar z actionable rebalance plan. Razlika od deal-source-roi (ki
// gleda ROI po viru nakupa) — ta gleda INDIVIDUAL held item-e z ROI
// potential in urgency score. Razlika od profit-margin-forecaster (ki
// forecast-a margin čez čas) — ta da REBALANCE ACTIONS za konkretne
// item-e z newTargetPrice in expectedROI. Razlika od profit-margin-
// optimizer-v2 (ki optimira margin na novo ceno) — ta optimira PORTFOLIO
// ROI z diversified rebalance (HOLD/SELL/PRICE_ADJUST/BUNDLE/LIQUIDATE).
// Razlika od inventory-liquidation-optimizer (ki likvidira zastarele
// item-e) — ta gleda ROI potential in prioritizira HIGH_ROI holds.
// Razlika od inventory-rebalancer-v3 (ki rebalancira po kategorijah) —
// ta optimira ROI na posameznem item-u z AI projection + urgency.
// Razlika od inventory-capital-allocator (ki alokira kapital po novih
// kategorijah) — ta optimira RAZPOLOŽLJIVI inventar z rebalance actions.
//
// Refaktoriran z withAiRoute helperjem (v8.96.4) + enforceBudget guard.
//
// GET+POST /api/ai/inventory-roi-optimizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type RoiCategory = 'HIGH_ROI' | 'MEDIUM_ROI' | 'LOW_ROI' | 'NEGATIVE_ROI';
type RebalanceAction =
  | 'HOLD'
  | 'SELL_NOW'
  | 'PRICE_ADJUST'
  | 'BUNDLE_WITH_OTHER'
  | 'LIQUIDATE';

interface PortfolioSummary {
  totalItems: number;
  totalInvested: number;
  totalEstimatedValue: number;
  currentAvgROI: number;
  projectedAvgROI: number;
  roiOptimizationPotential: number; // % improvement possible
}

interface OptimizationItem {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  aiEstimatedValue: number | null;
  currentROI: number;
  projectedROI: number;
  roiPotential: number;
  urgencyScore: number; // 0-100
  roiCategory: RoiCategory;
  action: RebalanceAction;
  newTargetPrice: number | null;
  expectedROIAfterAction: number;
  timingAdvice: string;
  reasoning: string;
}

interface Optimization {
  portfolioROIOptimization: string;
  projectedPortfolioROI: number;
  riskMitigation: string;
  totalExpectedImprovement: number; // €
}

interface AiRoiResponse {
  optimization?: unknown;
  items?: unknown;
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

const VALID_ROI_CATEGORY: readonly RoiCategory[] = [
  'HIGH_ROI',
  'MEDIUM_ROI',
  'LOW_ROI',
  'NEGATIVE_ROI',
];

const VALID_REBALANCE_ACTION: readonly RebalanceAction[] = [
  'HOLD',
  'SELL_NOW',
  'PRICE_ADJUST',
  'BUNDLE_WITH_OTHER',
  'LIQUIDATE',
];

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

// Categorize ROI into buckets
function categorizeROI(roi: number): RoiCategory {
  if (roi >= 30) return 'HIGH_ROI';
  if (roi >= 10) return 'MEDIUM_ROI';
  if (roi >= 0) return 'LOW_ROI';
  return 'NEGATIVE_ROI';
}

// Determine rebalance action from ROI metrics (deterministic fallback)
function determineAction(
  roiPotential: number,
  roiCategory: RoiCategory,
): RebalanceAction {
  if (roiCategory === 'NEGATIVE_ROI' && roiPotential < 0) return 'LIQUIDATE';
  if (roiCategory === 'NEGATIVE_ROI') return 'PRICE_ADJUST';
  if (roiPotential < 0) return 'SELL_NOW';
  if (roiPotential < 5 && roiCategory === 'LOW_ROI') return 'BUNDLE_WITH_OTHER';
  return 'HOLD';
}

// Clamp newTargetPrice to [0.5x, 1.3x] buyPrice (anti-hallucination)
function clampTargetPrice(
  rawPrice: unknown,
  buyPrice: number,
): number | null {
  if (rawPrice == null) return null;
  const v = Number(rawPrice);
  if (!Number.isFinite(v) || v <= 0) return null;
  const minP = buyPrice * 0.5;
  const maxP = buyPrice * 1.3;
  return round0(Math.max(minP, Math.min(maxP, v)));
}

// Compute urgency score 0-100 — older items have lower ROI potential
function computeUrgencyScore(daysHeld: number): number {
  if (daysHeld <= 0) return 10;
  if (daysHeld < 7) return 20;
  if (daysHeld < 14) return 35;
  if (daysHeld < 30) return 50;
  if (daysHeld < 45) return 70;
  if (daysHeld < 60) return 85;
  return 95;
}

// Compute deterministic projected ROI based on aging + market factors
function computeProjectedROI(
  currentROI: number,
  daysHeld: number,
  aiEstimatedValue: number | null,
  buyPrice: number,
): number {
  if (buyPrice <= 0) return 0;
  // Holding cost impact: 0.50€/day/buyPrice × 100
  const holdingCostImpact = (daysHeld * 0.5 / buyPrice) * 100;
  // If we have AI estValue, project toward it with decay
  if (aiEstimatedValue != null && aiEstimatedValue > 0) {
    const targetROI = ((aiEstimatedValue - buyPrice) / buyPrice) * 100;
    // Decay: as days pass, the item is less likely to achieve target ROI
    // - fresh (<14d): 95% of target
    // - mid (14-30d): 80% of target
    // - aging (30-60d): 65% of target
    // - old (>60d): 50% of target
    let achievementFactor = 0.95;
    if (daysHeld > 60) achievementFactor = 0.5;
    else if (daysHeld > 30) achievementFactor = 0.65;
    else if (daysHeld > 14) achievementFactor = 0.8;
    const projected = targetROI * achievementFactor - holdingCostImpact;
    return Math.max(-50, Math.min(200, round1(projected)));
  }
  // No AI estValue — decay currentROI with aging
  let decayFactor = 0.9;
  if (daysHeld > 60) decayFactor = 0.5;
  else if (daysHeld > 30) decayFactor = 0.7;
  else if (daysHeld > 14) decayFactor = 0.85;
  const projected = currentROI * decayFactor - holdingCostImpact;
  return Math.max(-50, Math.min(200, round1(projected)));
}

// Compute expected ROI after action (deterministic)
function computeExpectedROIAfterAction(
  action: RebalanceAction,
  currentROI: number,
  projectedROI: number,
  roiPotential: number,
): number {
  switch (action) {
    case 'SELL_NOW':
      // Realize current ROI immediately (no further decay)
      return round1(currentROI);
    case 'LIQUIDATE':
      // Sell below current value to clear fast — small loss
      return round1(Math.max(-50, currentROI - 5));
    case 'PRICE_ADJUST':
      // Adjust price to stimulate demand — moderate gain
      return round1(currentROI + Math.max(0, roiPotential * 0.6));
    case 'BUNDLE_WITH_OTHER':
      // Bundle for higher combined value — modest gain
      return round1(currentROI + Math.max(0, roiPotential * 0.4));
    case 'HOLD':
    default:
      // Hold for projected ROI
      return round1(projectedROI);
  }
}

// --- Handler -------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InventoryRoiOptimizerInput {}

const inventoryRoiOptimizerHandler = withAiRoute<InventoryRoiOptimizerInput>({
  endpoint: '/api/ai/inventory-roi-optimizer',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async () => ({}),

  // No validateInput — endpoint ne sprejema inputa

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    const now = Date.now();

    // 1) Query all HELD trades with linked Listing (for aiEstimatedValue + dealScore)
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
            aiEstimatedValue: true,
            dealScore: true,
            monitor: { select: { source: true } },
          },
        },
      },
      orderBy: { buyDate: 'asc' },
      take: 100000,
    });

    // 2) Compute per-item ROI metrics (deterministic)
    const items: OptimizationItem[] = [];
    let totalInvested = 0;
    let totalEstimatedValue = 0;
    let totalEstimatedValueCount = 0;
    let sumCurrentROI = 0;
    let sumProjectedROI = 0;

    for (const t of heldTrades) {
      const buyPrice = t.buyPrice ?? 0;
      if (buyPrice <= 0) continue;
      const aiEstimatedValue = t.listing?.aiEstimatedValue ?? null;
      const buyMs = toMs(t.buyDate);
      const daysHeld = buyMs > 0 ? daysBetween(buyMs, now) : 0;

      // currentROI = (aiEstimatedValue - buyPrice) / buyPrice × 100 (unrealized)
      // If no aiEstimatedValue, fall back to 0 (we don't know the value yet)
      let currentROI: number;
      if (aiEstimatedValue != null && aiEstimatedValue > 0) {
        currentROI = round1(((aiEstimatedValue - buyPrice) / buyPrice) * 100);
      } else {
        // No AI estimate — current ROI unknown, treat as 0
        currentROI = 0;
      }

      const projectedROI = computeProjectedROI(
        currentROI,
        daysHeld,
        aiEstimatedValue,
        buyPrice,
      );
      const roiPotential = round1(projectedROI - currentROI);
      const urgencyScore = computeUrgencyScore(daysHeld);
      const roiCategory = categorizeROI(currentROI);
      const action = determineAction(roiPotential, roiCategory);
      const expectedROIAfterAction = computeExpectedROIAfterAction(
        action,
        currentROI,
        projectedROI,
        roiPotential,
      );

      totalInvested += buyPrice;
      if (aiEstimatedValue != null && aiEstimatedValue > 0) {
        totalEstimatedValue += aiEstimatedValue;
        totalEstimatedValueCount += 1;
      }
      sumCurrentROI += currentROI;
      sumProjectedROI += projectedROI;

      const category =
        (t.category || t.listing?.monitor?.source || '').trim() || 'neznan';

      items.push({
        tradeId: t.id,
        title: t.title.slice(0, 100),
        category,
        buyPrice: round0(buyPrice),
        aiEstimatedValue: aiEstimatedValue ?? null,
        currentROI,
        projectedROI,
        roiPotential,
        urgencyScore,
        roiCategory,
        action,
        newTargetPrice: null,
        expectedROIAfterAction,
        timingAdvice: buildTimingAdvice(action, daysHeld),
        reasoning: buildDeterministicReasoning(
          action,
          roiCategory,
          roiPotential,
          daysHeld,
        ),
      });
    }

    const totalItems = items.length;
    const currentAvgROI = totalItems > 0 ? round1(sumCurrentROI / totalItems) : 0;
    const projectedAvgROI = totalItems > 0 ? round1(sumProjectedROI / totalItems) : 0;
    const roiOptimizationPotential = round1(
      Math.max(0, projectedAvgROI - currentAvgROI),
    );

    const portfolio: PortfolioSummary = {
      totalItems,
      totalInvested: round0(totalInvested),
      totalEstimatedValue: round0(totalEstimatedValue),
      currentAvgROI,
      projectedAvgROI,
      roiOptimizationPotential,
    };

    // Empty state — no HELD items
    if (totalItems === 0) {
      return apiOk({
        ok: true,
        portfolio,
        items: [],
        optimization: {
          portfolioROIOptimization:
            'Ni HELD inventarja — Inventory ROI Optimizer ni mogoč.',
          projectedPortfolioROI: 0,
          riskMitigation:
            'Dodaj HELD trade-e (status "held", buyPrice > 0) za optimizacijo ROI-ja portfelja.',
          totalExpectedImprovement: 0,
        },
        summary:
          'Ni HELD inventarja — Inventory ROI Optimizer ni mogoč.',
        aiUsed: false,
        message:
          'Ni HELD inventarja — Inventory ROI Optimizer ni mogoč.',
      });
    }

    // 3) AI cache check (6h TTL) — key by heldItemIds
    const heldItemIds = items.map((i) => i.tradeId).sort();
    const cacheKey = `inventory-roi-optimizer:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<{
      items: OptimizationItem[];
      optimization: Optimization;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        portfolio,
        items: cached.items,
        optimization: cached.optimization,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 4) Compute deterministic optimization fallback
    const totalExpectedImprovement = round0(
      items.reduce(
        (s, it) =>
          s +
          Math.max(0, it.expectedROIAfterAction - it.currentROI) *
            (it.buyPrice / 100),
        0,
      ),
    );

    const highCount = items.filter((i) => i.roiCategory === 'HIGH_ROI').length;
    const mediumCount = items.filter((i) => i.roiCategory === 'MEDIUM_ROI').length;
    const lowCount = items.filter((i) => i.roiCategory === 'LOW_ROI').length;
    const negativeCount = items.filter((i) => i.roiCategory === 'NEGATIVE_ROI').length;
    const sellCount = items.filter((i) => i.action === 'SELL_NOW' || i.action === 'LIQUIDATE').length;
    const holdCount = items.filter((i) => i.action === 'HOLD').length;

    const deterministicOptimization: Optimization = {
      portfolioROIOptimization: `Portfolio ROI: ${currentAvgROI}% → projected ${projectedAvgROI}% z optimizacijami (${roiOptimizationPotential}% potencial). Sell ${sellCount} nizko-ROI item-ov, obdrži ${holdCount} visoko-ROI. Distribucija: ${highCount} HIGH, ${mediumCount} MEDIUM, ${lowCount} LOW, ${negativeCount} NEGATIVE.`,
      projectedPortfolioROI: projectedAvgROI,
      riskMitigation:
        negativeCount > 2
          ? `${negativeCount} negativnih item-ov — diverzificiraj in likvidiraj najslabše za sprostitev kapitala.`
          : 'Portfolio je diverzificiran — ohrani disciplino z rednim ROI tracking-om.',
      totalExpectedImprovement,
    };

    const deterministicSummary = `Portfolio ROI: ${currentAvgROI}% → projected ${projectedAvgROI}% z optimizacijami. Sell ${sellCount} nizko-ROI item-ov, obdrži ${holdCount} visoko-ROI. Pričakovano izboljšanje: +${totalExpectedImprovement}€.`;

    // 5) AI prompt with grounding
    const itemsForPrompt = items.slice(0, 20).map((i) => ({
      tradeId: i.tradeId,
      title: i.title,
      category: i.category,
      buyPrice: i.buyPrice,
      aiEstimatedValue: i.aiEstimatedValue,
      currentROI: i.currentROI,
      projectedROI: i.projectedROI,
      roiPotential: i.roiPotential,
      urgencyScore: i.urgencyScore,
      roiCategory: i.roiCategory,
      deterministicAction: i.action,
      deterministicExpectedROI: i.expectedROIAfterAction,
    }));

    const prompt = buildPrompt({
      totalItems,
      totalInvested: portfolio.totalInvested,
      totalEstimatedValue: portfolio.totalEstimatedValue,
      totalEstimatedValueCount,
      currentAvgROI,
      projectedAvgROI,
      roiOptimizationPotential,
      highCount,
      mediumCount,
      lowCount,
      negativeCount,
      itemsForPrompt,
    });

    let optimization = deterministicOptimization;
    let optimizedItems = items;
    let summary = deterministicSummary;
    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiRoiResponse | null;

      if (parsed && typeof parsed === 'object') {
        const transformed = transformOptimization(
          parsed,
          items,
          deterministicOptimization,
          deterministicSummary,
          projectedAvgROI,
          totalExpectedImprovement,
        );
        optimization = transformed.optimization;
        optimizedItems = transformed.optimizedItems;
        summary = transformed.summary;
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-roi-optimizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 6) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        items: optimizedItems,
        optimization,
        summary,
      });
    }

    return apiOk({
      ok: true,
      portfolio,
      items: optimizedItems,
      optimization,
      summary,
      aiUsed,
    });
  },
});

// AI Hub runner compatibility — body is ignored, identical logic.
export const GET = inventoryRoiOptimizerHandler;
export const POST = inventoryRoiOptimizerHandler;

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface PromptParams {
  totalItems: number;
  totalInvested: number;
  totalEstimatedValue: number;
  totalEstimatedValueCount: number;
  currentAvgROI: number;
  projectedAvgROI: number;
  roiOptimizationPotential: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  negativeCount: number;
  itemsForPrompt: Array<{
    tradeId: string;
    title: string;
    category: string;
    buyPrice: number;
    aiEstimatedValue: number | null;
    currentROI: number;
    projectedROI: number;
    roiPotential: number;
    urgencyScore: number;
    roiCategory: RoiCategory;
    deterministicAction: RebalanceAction;
    deterministicExpectedROI: number;
  }>;
}

function buildPrompt(p: PromptParams): string {
  return `Si AI "Inventory ROI Optimizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Optimiraj ROI čez celoten HELD inventar — identificira kateri item-i imajo najboljši/najslabši ROI potencial in predlagaj rebalancing (sell nizko-ROI, hold visoko-ROI).

PORTFOLIO STANJE (deterministično izračunano):
- totalItems: ${p.totalItems}
- totalInvested: ${p.totalInvested}€
- totalEstimatedValue: ${p.totalEstimatedValue}€ (iz ${p.totalEstimatedValueCount} item-ov z AI estValue)
- currentAvgROI: ${p.currentAvgROI}%
- projectedAvgROI: ${p.projectedAvgROI}%
- roiOptimizationPotential: ${p.roiOptimizationPotential}%
- ROI distribution: ${p.highCount} HIGH_ROI (>30%), ${p.mediumCount} MEDIUM_ROI (10-30%), ${p.lowCount} LOW_ROI (0-10%), ${p.negativeCount} NEGATIVE_ROI (<0%)

ITEM-I (top 20, deterministično izračunano):
${JSON.stringify(p.itemsForPrompt, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. optimization:
   - portfolioROIOptimization: slovenski opis strategije (max 500 znakov). NE izmišljuj številk — uporabi zgornje deterministične podatke.
   - projectedPortfolioROI: pričakovani portfolio ROI po optimizacijah (clamped [-50, 200])
   - riskMitigation: slovenski nasvet za diversifikacijo in risk management (max 400 znakov)
   - totalExpectedImprovement: pričakovano € izboljšanje (clamped [0, 100000])
2. items: array z AI-optimiziranimi actions za vsak item (isti vrstni red kot vhod):
   - tradeId: enak kot v vhodu
   - action: HOLD | SELL_NOW | PRICE_ADJUST | BUNDLE_WITH_OTHER | LIQUIDATE (validiraj proti enum)
   - newTargetPrice: če action=PRICE_ADJUST, nova ciljna cena (clamped na [0.5x, 1.3x] buyPrice). Drugače null.
   - expectedROIAfterAction: pričakovani ROI po ukrepu (clamped [-50, 200])
   - timingAdvice: slovenski nasvet o timing-u (max 200 znakov)
   - reasoning: slovenski razlog (max 300 znakov)
3. summary: slovenski povzetek optimizacije (max 500 znakov)

VRNI LE JSON:
{
  "optimization": {
    "portfolioROIOptimization": "...",
    "projectedPortfolioROI": 0,
    "riskMitigation": "...",
    "totalExpectedImprovement": 0
  },
  "items": [
    { "tradeId": "...", "action": "HOLD", "newTargetPrice": null, "expectedROIAfterAction": 0, "timingAdvice": "...", "reasoning": "..." }
  ],
  "summary": "..."
}${GROUNDING_PROMPT_SUFFIX}`;
}

function transformOptimization(
  parsed: AiRoiResponse,
  items: OptimizationItem[],
  deterministicOptimization: Optimization,
  deterministicSummary: string,
  projectedAvgROI: number,
  totalExpectedImprovement: number,
): {
  optimization: Optimization;
  optimizedItems: OptimizationItem[];
  summary: string;
} {
  let optimization = deterministicOptimization;
  let optimizedItems = items;
  let summary = deterministicSummary;

  // Parse optimization
  if (parsed.optimization && typeof parsed.optimization === 'object') {
    const o = parsed.optimization as Record<string, unknown>;
    optimization = {
      portfolioROIOptimization: clampString(
        o.portfolioROIOptimization,
        500,
        deterministicOptimization.portfolioROIOptimization,
      ),
      projectedPortfolioROI: clampNumber(
        o.projectedPortfolioROI,
        -50,
        200,
        projectedAvgROI,
      ),
      riskMitigation: clampString(
        o.riskMitigation,
        400,
        deterministicOptimization.riskMitigation,
      ),
      totalExpectedImprovement: clampNumber(
        o.totalExpectedImprovement,
        0,
        100000,
        totalExpectedImprovement,
      ),
    };
  }

  // Parse items (AI overrides per-item actions)
  if (Array.isArray(parsed.items)) {
    const aiItemMap = new Map<string, Record<string, unknown>>();
    for (const a of parsed.items) {
      const ar = a as Record<string, unknown>;
      if (!ar || typeof ar !== 'object') continue;
      const tid = String(ar.tradeId || '').trim();
      if (tid) aiItemMap.set(tid, ar);
    }
    optimizedItems = items.map((it) => {
      const aiItem = aiItemMap.get(it.tradeId);
      if (!aiItem) return it;
      const action = clampEnum(
        aiItem.action,
        VALID_REBALANCE_ACTION,
        it.action,
      );
      const newTargetPrice =
        action === 'PRICE_ADJUST'
          ? clampTargetPrice(aiItem.newTargetPrice, it.buyPrice)
          : null;
      const expectedROIAfterAction = clampNumber(
        aiItem.expectedROIAfterAction,
        -50,
        200,
        computeExpectedROIAfterAction(
          action,
          it.currentROI,
          it.projectedROI,
          it.roiPotential,
        ),
      );
      const timingAdvice = clampString(
        aiItem.timingAdvice,
        200,
        it.timingAdvice,
      );
      const reasoning = clampString(
        aiItem.reasoning,
        300,
        it.reasoning,
      );
      return {
        ...it,
        action,
        newTargetPrice,
        expectedROIAfterAction: round1(expectedROIAfterAction),
        timingAdvice,
        reasoning,
      };
    });
  }

  // Parse summary
  if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
    summary = clampString(parsed.summary, 500, deterministicSummary);
  }

  return { optimization, optimizedItems, summary };
}

// --- Helpers (deterministic advice) -------------------------------------

function buildTimingAdvice(action: RebalanceAction, daysHeld: number): string {
  switch (action) {
    case 'SELL_NOW':
      return 'Prodaj v naslednjih 7 dneh — sprosti kapital.';
    case 'LIQUIDATE':
      return 'Likvidiraj takoj z 15-25% popustom — blokira portfolio.';
    case 'PRICE_ADJUST':
      return 'Prilagodi ceno v 3 dneh — ponovno objavi z novo ceno.';
    case 'BUNDLE_WITH_OTHER':
      return 'Bundle z drugim item-om v 14 dneh za višjo skupno vrednost.';
    case 'HOLD':
    default:
      if (daysHeld < 14) return 'Drži vsaj 14 dni — pusti trgu čas.';
      if (daysHeld < 30) return 'Drži do 30 dni — monitoriraj zanimanje.';
      return 'Drži še 7 dni, nato ponovno evaluiraj.';
  }
}

function buildDeterministicReasoning(
  action: RebalanceAction,
  roiCategory: RoiCategory,
  roiPotential: number,
  daysHeld: number,
): string {
  const cat = roiCategory === 'HIGH_ROI'
    ? 'visok ROI potencial'
    : roiCategory === 'MEDIUM_ROI'
      ? 'zmerni ROI'
      : roiCategory === 'LOW_ROI'
        ? 'nizek ROI'
        : 'negativen ROI';
  switch (action) {
    case 'SELL_NOW':
      return `Item z ${cat} in negativnim projection-om (${roiPotential}%) — sprosti kapital v boljše priložnosti. Item v inventarju ${daysHeld} dni.`;
    case 'LIQUIDATE':
      return `Negativen ROI in slab projection — likvidiraj za sprostitev kapitala. Item v inventarju ${daysHeld} dni, aging tveganje.`;
    case 'PRICE_ADJUST':
      return `Negativen ROI vendar z ROI potential-om — prilagodi ceno za stimulacijo povpraševanja. Trenutni ${cat}, potential ${roiPotential}%.`;
    case 'BUNDLE_WITH_OTHER':
      return `Nizek ROI samostojno, vendar dober kandidat za bundle — kombiniraj z drugim item-om za skupno višjo vrednost. ROI potential ${roiPotential}%.`;
    case 'HOLD':
    default:
      return `${cat.charAt(0).toUpperCase() + cat.slice(1)}, pozitiven ROI potential (${roiPotential}%). Drži za izkoristek projection-a. Item v inventarju ${daysHeld} dni.`;
  }
}
