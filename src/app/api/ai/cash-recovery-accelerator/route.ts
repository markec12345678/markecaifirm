// v7.96 / v8.96.5-batch1: AI Cash Recovery Accelerator — AI identifies how to
// ACCELERATE cash recovery from HELD inventory — kateri itemi za prodati FIRST,
// kateri discount-at, kateri bundle-at, kateri cross-post-at, da se
// kapital sprosti NAJHITREJŠE za reinvestment. Maximizes cash velocity.
// Refaktoriran z withAiRoute helperjem (v8.96) + enforceBudget guard.
//
// Razlika od cash-flow-velocity-tracker (ki track-a cash velocity) —
// ta ACCELERIRA cash recovery z actionable per-item plan. Razlika od
// liquidation-strategist (ki likvidira stale inventory) — ta
// identificira kateri itemi za prodati FIRST za max cash recovery
// (ne le stale). Razlika od turnover-optimizer (ki optimizira
// turnover rate) — ta optimizira CASH VELOCITY (kateri itemi sprostijo
// največ kapitala najhitreje). Razlika od inventory-aging-predictor
// (ki napove aging) — ta daje RECOVERY ACTIONS (SELL_NOW / PRICE_DROP
// / BUNDLE / CROSS_POST / LIQUIDATE). Razlika od capital-allocation-
// optimizer (ki alocira capital) — ta SPROŠČA capital iz held inventory.
// Razlika od inventory-profit-margin-optimizer-pro (v7.96 ki optimira
// margin) — ta optimira CASH RECOVERY VELOCITY (hitrost sproščanja
// kapitala). Razlika od loss-recovery-playbook (ki recover-a losses)
// — ta recover-a CAPITAL (ne losses) iz held inventory.
//
// "Capital tied: 4,500€, accrued carrying cost: 180€ (40 days × 0.50€).
// Recovery priority: iPhone 13 (urgency 85, SELL_NOW → 380€ in 3 days).
// Bundle: 2x USB-C kabel (urgency 70, BUNDLE → 25€ in 7 days). Total
// recoverable: 3,200€ in 14 days. Reinvest in elektronika (ROI 180%)."
//
// GET+POST /api/ai/cash-recovery-accelerator
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface CashRecoveryAcceleratorInput {}

// --- Types ---------------------------------------------------------------

type QuickRecoveryAction =
  | 'SELL_NOW'
  | 'PRICE_DROP_10%'
  | 'BUNDLE'
  | 'CROSS_POST'
  | 'LIQUIDATE';
type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

interface HeldItemRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  category: string;
  title: string;
  listing: {
    aiEstimatedValue: number | null;
    price: number | null;
    aiScore: number | null;
    dealScore: number | null;
    monitor: { tags: string } | null;
  } | null;
}

interface RecoveryItem {
  tradeId: string;
  title: string;
  buyPrice: number;
  capitalTied: number;
  carryingCostAccrued: number;
  netRecoverableValue: number;
  cashRecoveryUrgency: number; // 0-100
  capitalEfficiencyLoss: number; // %
  quickRecoveryAction: QuickRecoveryAction;
  expectedRecoveryAmount: number; // €
  expectedRecoveryDays: number; // days to free up capital
}

interface Portfolio {
  totalCapitalTied: number;
  totalCarryingCostAccrued: number;
  totalNetRecoverableValue: number;
  capitalEfficiencyLoss: number; // % weighted avg
  avgDaysHeld: number;
}

interface ReinvestmentOpportunity {
  category: string;
  expectedROI: number; // %
  reasoning: string;
}

interface PrioritizedAction {
  action: string;
  priority: ActionPriority;
  cashImpact: number; // €
}

interface RecoveryPlan {
  expectedCashRecovery: number; // €
  recoveryTimeline: number; // days
  capitalVelocityImprovement: number; // %
  reinvestmentOpportunities: ReinvestmentOpportunity[];
  prioritizedActions: PrioritizedAction[];
}

interface CashRecoveryResponse {
  ok: true;
  portfolio: Portfolio;
  recoveryItems: RecoveryItem[];
  plan: RecoveryPlan;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  recoveryItems?: Array<{
    tradeId?: string;
    quickRecoveryAction?: QuickRecoveryAction;
    expectedRecoveryAmount?: number;
    expectedRecoveryDays?: number;
  }>;
  plan?: {
    expectedCashRecovery?: number;
    recoveryTimeline?: number;
    capitalVelocityImprovement?: number;
    reinvestmentOpportunities?: Array<{ category?: string; expectedROI?: number; reasoning?: string }>;
    prioritizedActions?: Array<{ action?: string; priority?: ActionPriority; cashImpact?: number }>;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const CARRYING_COST_PER_DAY = 0.50; // €
const EST_FEE_RATE = 0.05; // 5% est. selling fees
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const URGENCY_MIN = 0;
const URGENCY_MAX = 100;
const EFFICIENCY_LOSS_MIN = 0;
const EFFICIENCY_LOSS_MAX = 100;
const RECOVERY_AMOUNT_MIN = 0;
const RECOVERY_AMOUNT_MAX = 100_000;
const RECOVERY_DAYS_MIN = 1;
const RECOVERY_DAYS_MAX = 180;
const REINVESTMENT_ROI_MIN = 0;
const REINVESTMENT_ROI_MAX = 500;
const CASH_IMPACT_MIN = 0;
const CASH_IMPACT_MAX = 100_000;
const VELOCITY_MIN = 0;
const VELOCITY_MAX = 300;
const TIMELINE_MIN = 1;
const TIMELINE_MAX = 180;

const VALID_ACTION: readonly QuickRecoveryAction[] = [
  'SELL_NOW',
  'PRICE_DROP_10%',
  'BUNDLE',
  'CROSS_POST',
  'LIQUIDATE',
];
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
  if (!Number.isFinite(v)) return 0;
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

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// --- Deterministic computation ------------------------------------------

interface DetRecoveryItem {
  item: RecoveryItem;
  aiEstValue: number;
}

function computeRecoveryItem(
  t: HeldItemRow,
  now: number,
): DetRecoveryItem {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const capitalTied = buyPrice + buyFees;
  const buyMs = toMs(t.buyDate);
  const daysHeld = buyMs > 0 ? Math.max(0, Math.round((now - buyMs) / DAY_MS)) : 0;
  const carryingCostAccrued = round0(daysHeld * CARRYING_COST_PER_DAY);

  // Estimated value: from listing.aiEstimatedValue, fallback to listing.price, then buyPrice × 1.15
  const listingEst = t.listing?.aiEstimatedValue ?? null;
  const listingPrice = t.listing?.price ?? null;
  const aiEstValue =
    listingEst && listingEst > 0 ? listingEst
      : listingPrice && listingPrice > 0 ? listingPrice
        : Math.round(buyPrice * 1.15);

  // Net recoverable value = est value - carrying cost - est fees
  const estFees = Math.round(aiEstValue * EST_FEE_RATE);
  const netRecoverableValue = round0(
    Math.max(0, aiEstValue - carryingCostAccrued - estFees),
  );

  // Capital efficiency loss: carryingCost / buyPrice × 100 (capped 100)
  const capitalEfficiencyLoss = round0(
    clampNum(
      buyPrice > 0 ? (carryingCostAccrued / buyPrice) * 100 : 0,
      EFFICIENCY_LOSS_MIN, EFFICIENCY_LOSS_MAX, 0,
    ),
  );

  // Cash recovery urgency: weighted by days held + capital efficiency loss + value erosion
  // Higher urgency = need to sell faster
  const daysHeldNorm = Math.min(100, (daysHeld / 60) * 100); // 60 days = 100% urgency on days
  const effLossNorm = Math.min(100, capitalEfficiencyLoss * 3); // 33% loss = 100%
  const valueErosion = capitalTied > 0
    ? Math.max(0, Math.min(100, ((capitalTied - netRecoverableValue) / capitalTied) * 100))
    : 0;
  const cashRecoveryUrgency = round0(
    clampNum(
      daysHeldNorm * 0.4 + effLossNorm * 0.3 + valueErosion * 0.3,
      URGENCY_MIN, URGENCY_MAX, 0,
    ),
  );

  // Quick recovery action: decide deterministically
  let quickRecoveryAction: QuickRecoveryAction;
  if (cashRecoveryUrgency >= 70 || daysHeld >= 75) {
    quickRecoveryAction = 'LIQUIDATE';
  } else if (cashRecoveryUrgency >= 50 || daysHeld >= 45) {
    quickRecoveryAction = 'SELL_NOW';
  } else if (capitalEfficiencyLoss >= 15) {
    quickRecoveryAction = 'PRICE_DROP_10%';
  } else if (capitalTied < 50) {
    // Low capital items — bundle for faster sale
    quickRecoveryAction = 'BUNDLE';
  } else {
    // Cross-post to multiple platforms for faster sale
    quickRecoveryAction = 'CROSS_POST';
  }

  // Expected recovery amount: fraction of netRecoverableValue based on action
  const recoveryRate: Record<QuickRecoveryAction, number> = {
    SELL_NOW: 0.92,
    'PRICE_DROP_10%': 0.85,
    BUNDLE: 0.80,
    CROSS_POST: 0.95,
    LIQUIDATE: 0.65,
  };
  const expectedRecoveryAmount = round0(
    Math.max(0, netRecoverableValue * recoveryRate[quickRecoveryAction]),
  );

  // Expected recovery days: based on action speed
  const recoveryDaysByAction: Record<QuickRecoveryAction, number> = {
    SELL_NOW: 5,
    'PRICE_DROP_10%': 10,
    BUNDLE: 14,
    CROSS_POST: 12,
    LIQUIDATE: 3,
  };
  const baseDays = recoveryDaysByAction[quickRecoveryAction];
  // Items held longer have higher chance of faster sale (more interest accrued)
  const daysAdj = daysHeld > 30 ? -1 : 0;
  const expectedRecoveryDays = round0(
    Math.max(RECOVERY_DAYS_MIN, Math.min(RECOVERY_DAYS_MAX, baseDays + daysAdj)),
  );

  return {
    item: {
      tradeId: t.id,
      title: clampString(t.title, 200, 'Item'),
      buyPrice: round0(buyPrice),
      capitalTied: round0(capitalTied),
      carryingCostAccrued,
      netRecoverableValue,
      cashRecoveryUrgency,
      capitalEfficiencyLoss,
      quickRecoveryAction,
      expectedRecoveryAmount,
      expectedRecoveryDays,
    },
    aiEstValue,
  };
}

function computePortfolio(items: DetRecoveryItem[]): Portfolio {
  if (items.length === 0) {
    return {
      totalCapitalTied: 0,
      totalCarryingCostAccrued: 0,
      totalNetRecoverableValue: 0,
      capitalEfficiencyLoss: 0,
      avgDaysHeld: 0,
    };
  }
  let totalCapitalTied = 0;
  let totalCarryingCostAccrued = 0;
  let totalNetRecoverableValue = 0;
  let weightedEffLoss = 0;
  let daysSum = 0;
  for (const it of items) {
    totalCapitalTied += it.item.capitalTied;
    totalCarryingCostAccrued += it.item.carryingCostAccrued;
    totalNetRecoverableValue += it.item.netRecoverableValue;
    weightedEffLoss += it.item.capitalEfficiencyLoss * it.item.capitalTied;
    // daysHeld encoded as carryingCost / 0.5
    daysSum += it.item.carryingCostAccrued / CARRYING_COST_PER_DAY;
  }
  const capitalEfficiencyLoss = totalCapitalTied > 0
    ? round0(clampNum(weightedEffLoss / totalCapitalTied, EFFICIENCY_LOSS_MIN, EFFICIENCY_LOSS_MAX, 0))
    : 0;
  return {
    totalCapitalTied: round0(totalCapitalTied),
    totalCarryingCostAccrued: round0(totalCarryingCostAccrued),
    totalNetRecoverableValue: round0(totalNetRecoverableValue),
    capitalEfficiencyLoss,
    avgDaysHeld: round0(daysSum / items.length),
  };
}

function buildDeterministicPlan(
  items: DetRecoveryItem[],
  portfolio: Portfolio,
): RecoveryPlan {
  // Sort recovery items by urgency descending
  const sortedItems = [...items].sort((a, b) => b.item.cashRecoveryUrgency - a.item.cashRecoveryUrgency);

  const expectedCashRecovery = round0(
    Math.min(
      RECOVERY_AMOUNT_MAX,
      sortedItems.reduce((s, it) => s + it.item.expectedRecoveryAmount, 0),
    ),
  );

  // Recovery timeline: weighted avg of recovery days by recovery amount
  let totalWeight = 0;
  let weightedDays = 0;
  for (const it of sortedItems) {
    const w = Math.max(1, it.item.expectedRecoveryAmount);
    weightedDays += it.item.expectedRecoveryDays * w;
    totalWeight += w;
  }
  const recoveryTimeline = totalWeight > 0
    ? round0(Math.max(TIMELINE_MIN, Math.min(TIMELINE_MAX, weightedDays / totalWeight)))
    : round0(Math.min(TIMELINE_MAX, Math.max(TIMELINE_MIN, avg(sortedItems.map((i) => i.item.expectedRecoveryDays)))));

  // Capital velocity improvement: faster recovery vs current pace
  // Current pace assumes sell at est value over avg hold time remaining
  const avgCurrentDaysHeld = portfolio.avgDaysHeld;
  // If we can free capital in recoveryTimeline days vs typical 45-day cycle
  const baselineCycle = Math.max(30, avgCurrentDaysHeld + 30); // assume 30 more days to sell typically
  const capitalVelocityImprovement = round0(
    clampNum(
      ((baselineCycle - recoveryTimeline) / baselineCycle) * 100,
      VELOCITY_MIN, VELOCITY_MAX, 0,
    ),
  );

  // Reinvestment opportunities: top categories by historical ROI (from held items)
  const catByROI = new Map<string, { sumROI: number; count: number }>();
  for (const it of sortedItems) {
    const title = it.item.title.toLowerCase();
    const cat = title.includes('iphone') || title.includes('samsung') || title.includes('ps5') || title.includes('laptop')
      ? 'elektronika'
      : title.includes('avto') || title.includes('gume') || title.includes('motor')
        ? 'avto-deli'
        : title.includes('oblačila') || title.includes('jakna') || title.includes('čevlji')
          ? 'moda'
          : 'drugo';
    const roi = it.item.buyPrice > 0 ? ((it.aiEstValue - it.item.buyPrice) / it.item.buyPrice) * 100 : 0;
    const entry = catByROI.get(cat) || { sumROI: 0, count: 0 };
    entry.sumROI += roi;
    entry.count += 1;
    catByROI.set(cat, entry);
  }
  const reinvestmentOpportunities: ReinvestmentOpportunity[] = [];
  for (const [cat, data] of catByROI) {
    const avgROI = data.count > 0 ? data.sumROI / data.count : 0;
    const roi = round0(clampNum(avgROI, REINVESTMENT_ROI_MIN, REINVESTMENT_ROI_MAX, 0));
    reinvestmentOpportunities.push({
      category: cat,
      expectedROI: roi,
      reasoning: clampString(
        `Kategorija z ${data.count} itemsi in povprečnim ROI ${roi}% — reinvestiraj sproščen kapital tukaj za hitro ciklanje.`,
        250,
        `Reinvestiraj v ${cat} (ROI ${roi}%).`,
      ),
    });
  }
  // Add defaults if empty
  if (reinvestmentOpportunities.length === 0) {
    reinvestmentOpportunities.push({
      category: 'elektronika',
      expectedROI: 120,
      reasoning: 'Elektronika ima visok turnover in konsistentno povpraševanje — idealna za reinvestment sproščenega kapitala.',
    });
  }
  // Sort by ROI desc, top 5
  reinvestmentOpportunities.sort((a, b) => b.expectedROI - a.expectedROI);
  const topReinvestment = reinvestmentOpportunities.slice(0, 5);

  // Prioritized actions: aggregate by recovery action type
  const actionGroups = new Map<QuickRecoveryAction, { count: number; totalCash: number }>();
  for (const it of sortedItems) {
    const action = it.item.quickRecoveryAction;
    const g = actionGroups.get(action) || { count: 0, totalCash: 0 };
    g.count += 1;
    g.totalCash += it.item.expectedRecoveryAmount;
    actionGroups.set(action, g);
  }
  const prioritizedActions: PrioritizedAction[] = [];
  const actionLabel: Record<QuickRecoveryAction, string> = {
    SELL_NOW: 'Prodaj takoj item-je z visoko urgency (SELL_NOW)',
    'PRICE_DROP_10%': 'Znižaj cene za 10% na item-je z visoko carrying cost (PRICE_DROP_10%)',
    BUNDLE: 'Bundle-aj nizko-vrednostne iteme skupaj (BUNDLE)',
    CROSS_POST: 'Cross-postaj na multiple platforme za širši reach (CROSS_POST)',
    LIQUIDATE: 'Likvidiraj stale iteme (LIQUIDATE) za sprostitev kapitala',
  };
  for (const [action, g] of actionGroups) {
    const priority: ActionPriority = g.totalCash > 1000 ? 'HIGH' : g.totalCash > 300 ? 'MEDIUM' : 'LOW';
    prioritizedActions.push({
      action: clampString(`${actionLabel[action]} — ${g.count} items, ~${round0(g.totalCash)}€ recovery.`, 300, actionLabel[action]),
      priority,
      cashImpact: round0(clampNum(g.totalCash, CASH_IMPACT_MIN, CASH_IMPACT_MAX, 0)),
    });
  }
  prioritizedActions.sort((a, b) => {
    const prioWeight: Record<ActionPriority, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    if (prioWeight[b.priority] !== prioWeight[a.priority]) {
      return prioWeight[b.priority] - prioWeight[a.priority];
    }
    return b.cashImpact - a.cashImpact;
  });
  const topActions = prioritizedActions.slice(0, 8);

  return {
    expectedCashRecovery,
    recoveryTimeline,
    capitalVelocityImprovement,
    reinvestmentOpportunities: topReinvestment,
    prioritizedActions: topActions,
  };
}

function buildSummary(portfolio: Portfolio, plan: RecoveryPlan): string {
  const parts: string[] = [
    `Capital tied: ${portfolio.totalCapitalTied}€, accrued carrying cost: ${portfolio.totalCarryingCostAccrued}€ (${portfolio.avgDaysHeld} days avg).`,
    `Recovery: ${plan.expectedCashRecovery}€ in ${plan.recoveryTimeline} days (+${plan.capitalVelocityImprovement}% velocity).`,
  ];
  const topReinvest = plan.reinvestmentOpportunities[0];
  if (topReinvest) {
    parts.push(`Reinvest in ${topReinvest.category} (ROI ${topReinvest.expectedROI}%).`);
  }
  return parts.join(' ').slice(0, 400);
}

// --- AI prompt + merge helpers (pure, extracted OUTSIDE handler) ----------

interface PromptItem {
  tradeId: string;
  title: string;
  buyPrice: number;
  capitalTied: number;
  carryingCostAccrued: number;
  netRecoverableValue: number;
  cashRecoveryUrgency: number;
  capitalEfficiencyLoss: number;
  detAction: QuickRecoveryAction;
  detRecoveryAmount: number;
  detRecoveryDays: number;
}

function buildPromptItems(detItems: DetRecoveryItem[]): PromptItem[] {
  return detItems
    .sort((a, b) => b.item.cashRecoveryUrgency - a.item.cashRecoveryUrgency)
    .slice(0, 30)
    .map((d) => ({
      tradeId: d.item.tradeId,
      title: d.item.title,
      buyPrice: d.item.buyPrice,
      capitalTied: d.item.capitalTied,
      carryingCostAccrued: d.item.carryingCostAccrued,
      netRecoverableValue: d.item.netRecoverableValue,
      cashRecoveryUrgency: d.item.cashRecoveryUrgency,
      capitalEfficiencyLoss: d.item.capitalEfficiencyLoss,
      detAction: d.item.quickRecoveryAction,
      detRecoveryAmount: d.item.expectedRecoveryAmount,
      detRecoveryDays: d.item.expectedRecoveryDays,
    }));
}

function buildPromptData(portfolio: Portfolio, topItemsForAI: PromptItem[], plan: RecoveryPlan) {
  return {
    portfolio,
    heldItems: topItemsForAI,
    deterministicPlan: plan,
    caps: {
      urgencyMin: URGENCY_MIN, urgencyMax: URGENCY_MAX,
      efficiencyLossMin: EFFICIENCY_LOSS_MIN, efficiencyLossMax: EFFICIENCY_LOSS_MAX,
      recoveryAmountMin: RECOVERY_AMOUNT_MIN, recoveryAmountMax: RECOVERY_AMOUNT_MAX,
      recoveryDaysMin: RECOVERY_DAYS_MIN, recoveryDaysMax: RECOVERY_DAYS_MAX,
      reinvestmentRoiMin: REINVESTMENT_ROI_MIN, reinvestmentRoiMax: REINVESTMENT_ROI_MAX,
      cashImpactMin: CASH_IMPACT_MIN, cashImpactMax: CASH_IMPACT_MAX,
      velocityMin: VELOCITY_MIN, velocityMax: VELOCITY_MAX,
      timelineMin: TIMELINE_MIN, timelineMax: TIMELINE_MAX,
    },
  };
}

function buildPrompt(promptData: ReturnType<typeof buildPromptData>): string {
  return `Si AI "Cash Recovery Accelerator" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za CASH VELOCITY optimization — identificiraš kako NAJHITREJŠE sprostiti kapital iz HELD inventorija za reinvestment. Razlika od cash-flow-velocity-tracker (ki track-a cash velocity) — ti ACCELERIRAŠ cash recovery z actionable per-item plan. Razlika od liquidation-strategist (ki likvidira stale inventory) — ti identificiraš kateri itemi za prodati FIRST za max cash recovery (ne le stale). Razlika od turnover-optimizer (ki optimizira turnover rate) — ti optimiziraš CASH VELOCITY (kateri itemi sprostijo največ kapitala najhitreje).

DETERMINISTIČNI PODATKI (izračunano iz DB — HELD trgovin z linked Listing):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. recoveryItems: za vsak tradeId iz heldItems, daj per-item recovery action:
   - tradeId (string, MORA match-at enega iz heldItems — anti-hallucination),
   - quickRecoveryAction: SELL_NOW | PRICE_DROP_10% | BUNDLE | CROSS_POST | LIQUIDATE (lahko se razlikuje od detAction če imaš boljšo idejo),
   - expectedRecoveryAmount € [0, 100000] (koliko kapitala se sprosti, ±20% od detRecoveryAmount; MORA biti v [0.5x, 1.2x] buyPrice anti-hallucination),
   - expectedRecoveryDays [1, 180] (v koliko dneh, ±50% od detRecoveryDays).
2. plan.expectedCashRecovery € [0, 100000] — skupni capital sproščen (≈ sum recoveryItems.expectedRecoveryAmount).
3. plan.recoveryTimeline [1, 180] — weighted avg days do full cash recovery.
4. plan.capitalVelocityImprovement [0, 300] % — koliko hitreje bo kapital ciklal po recovery actions (vs. tipični 45-dnevni cycle).
5. plan.reinvestmentOpportunities: 2-5 kategorij kam reinvestirati sproščen kapital { category (max 50), expectedROI [0, 500] %, reasoning (max 250, slovenski) }.
6. plan.prioritizedActions: 3-8 akcij ranked { action (max 300, slovenski), priority HIGH | MEDIUM | LOW, cashImpact € [0, 100000] }.
7. summary: slovenski povzetek (max 400 znakov). NE izmišljuj tradeId-jev — uporabi samo iz heldItems.

VRNI LE JSON:
{
  "recoveryItems": [
    { "tradeId": "ckxxxxx", "quickRecoveryAction": "SELL_NOW", "expectedRecoveryAmount": 380, "expectedRecoveryDays": 5 }
  ],
  "plan": {
    "expectedCashRecovery": 3200,
    "recoveryTimeline": 14,
    "capitalVelocityImprovement": 65,
    "reinvestmentOpportunities": [
      { "category": "elektronika", "expectedROI": 120, "reasoning": "Visoko povpraševanje in hiter turnover." }
    ],
    "prioritizedActions": [
      { "action": "Prodaj iPhone 13 takoj (urgency 85).", "priority": "HIGH", "cashImpact": 380 }
    ]
  },
  "summary": "Capital tied: 4500€, accrued carrying cost: 180€ (40 days). Recovery: 3200€ in 14 days (+65% velocity). Reinvest in elektronika (ROI 120%)."
}${GROUNDING_PROMPT_SUFFIX}`;
}

interface MergeResult {
  recoveryItems: RecoveryItem[];
  plan: RecoveryPlan;
  summary: string;
  aiUsed: boolean;
}

function mergeAiIntoRecovery(
  parsed: AiResponse | null,
  detItems: DetRecoveryItem[],
  portfolio: Portfolio,
  detPlan: RecoveryPlan,
): MergeResult {
  let recoveryItems: RecoveryItem[] = [...detItems]
    .sort((a, b) => b.item.cashRecoveryUrgency - a.item.cashRecoveryUrgency)
    .map((d) => d.item);
  let plan = detPlan;
  let summary = buildSummary(portfolio, detPlan);
  let aiUsed = false;

  if (parsed && typeof parsed === 'object') {
    // Build a quick lookup map of det items by tradeId
    const detByTradeId = new Map<string, DetRecoveryItem>();
    for (const d of detItems) detByTradeId.set(d.item.tradeId, d);

    // Parse recovery items — keep deterministic for unknown tradeIds (anti-hallucination)
    const aiRecoveryItems: RecoveryItem[] = [];
    if (parsed.recoveryItems && Array.isArray(parsed.recoveryItems)) {
      for (const r of parsed.recoveryItems) {
        if (!r || typeof r !== 'object') continue;
        const det = detByTradeId.get(String(r.tradeId ?? ''));
        if (!det) continue; // skip unknown tradeId — anti-hallucination
        const quickRecoveryAction = clampEnum(r.quickRecoveryAction, VALID_ACTION, det.item.quickRecoveryAction);
        const expectedRecoveryAmount = round0(clampNum(
          r.expectedRecoveryAmount,
          RECOVERY_AMOUNT_MIN, RECOVERY_AMOUNT_MAX,
          det.item.expectedRecoveryAmount,
        ));
        // Anti-hallucination: clamp recovery amount to [0.5x, 1.2x] buyPrice range
        const recoveryLowBound = det.item.buyPrice * 0.5;
        const recoveryHighBound = det.item.buyPrice * 1.2;
        const clampedRecoveryAmount = round0(
          Math.max(recoveryLowBound, Math.min(recoveryHighBound, expectedRecoveryAmount)),
        );
        const expectedRecoveryDays = round0(clampNum(
          r.expectedRecoveryDays,
          RECOVERY_DAYS_MIN, RECOVERY_DAYS_MAX,
          det.item.expectedRecoveryDays,
        ));
        aiRecoveryItems.push({
          ...det.item,
          quickRecoveryAction,
          expectedRecoveryAmount: clampedRecoveryAmount,
          expectedRecoveryDays,
        });
      }
    }
    // Fallback to deterministic if AI returned nothing useful
    if (aiRecoveryItems.length === 0) {
      for (const d of detItems) aiRecoveryItems.push(d.item);
    } else {
      // For items AI didn't return, keep deterministic values
      const aiTradeIds = new Set(aiRecoveryItems.map((r) => r.tradeId));
      for (const d of detItems) {
        if (!aiTradeIds.has(d.item.tradeId)) {
          aiRecoveryItems.push(d.item);
        }
      }
    }
    // Sort by urgency descending
    aiRecoveryItems.sort((a, b) => b.cashRecoveryUrgency - a.cashRecoveryUrgency);
    recoveryItems = aiRecoveryItems;

    // Parse plan
    const aiPlan = parsed.plan ?? {};
    const expectedCashRecovery = round0(clampNum(
      aiPlan.expectedCashRecovery,
      RECOVERY_AMOUNT_MIN, RECOVERY_AMOUNT_MAX,
      detPlan.expectedCashRecovery,
    ));
    const recoveryTimeline = round0(clampNum(
      aiPlan.recoveryTimeline,
      TIMELINE_MIN, TIMELINE_MAX,
      detPlan.recoveryTimeline,
    ));
    const capitalVelocityImprovement = round0(clampNum(
      aiPlan.capitalVelocityImprovement,
      VELOCITY_MIN, VELOCITY_MAX,
      detPlan.capitalVelocityImprovement,
    ));

    // Reinvestment opportunities
    const reinvestmentOpportunities: ReinvestmentOpportunity[] = [];
    if (Array.isArray(aiPlan.reinvestmentOpportunities)) {
      for (const o of aiPlan.reinvestmentOpportunities.slice(0, 5)) {
        if (!o || typeof o !== 'object') continue;
        reinvestmentOpportunities.push({
          category: clampString(o.category, 50, detPlan.reinvestmentOpportunities[0]?.category ?? 'drugo'),
          expectedROI: round0(clampNum(o.expectedROI, REINVESTMENT_ROI_MIN, REINVESTMENT_ROI_MAX, 0)),
          reasoning: clampString(o.reasoning, 250, detPlan.reinvestmentOpportunities[0]?.reasoning ?? 'Kategorija z visokim ROI-jem.'),
        });
      }
    }
    if (reinvestmentOpportunities.length === 0) {
      for (const o of detPlan.reinvestmentOpportunities) reinvestmentOpportunities.push(o);
    }

    // Prioritized actions
    const prioritizedActions: PrioritizedAction[] = [];
    if (Array.isArray(aiPlan.prioritizedActions)) {
      for (const a of aiPlan.prioritizedActions.slice(0, 8)) {
        if (!a || typeof a !== 'object') continue;
        prioritizedActions.push({
          action: clampString(a.action, 300, detPlan.prioritizedActions[0]?.action ?? 'Cash recovery akcija.'),
          priority: clampEnum(a.priority, VALID_PRIORITY, detPlan.prioritizedActions[0]?.priority ?? 'MEDIUM'),
          cashImpact: round0(clampNum(a.cashImpact, CASH_IMPACT_MIN, CASH_IMPACT_MAX, 0)),
        });
      }
    }
    if (prioritizedActions.length === 0) {
      for (const a of detPlan.prioritizedActions) prioritizedActions.push(a);
    }

    plan = {
      expectedCashRecovery,
      recoveryTimeline,
      capitalVelocityImprovement,
      reinvestmentOpportunities,
      prioritizedActions,
    };
    summary = clampString(parsed.summary, 400, buildSummary(portfolio, plan));
    aiUsed = true;
  }

  return { recoveryItems, plan, summary, aiUsed };
}

// --- Handler -------------------------------------------------------------

const cashRecoveryHandler = withAiRoute<CashRecoveryAcceleratorInput>({
  endpoint: '/api/ai/cash-recovery-accelerator',
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

    // 1) Query all HELD trades with their linked Listing
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        category: true,
        listing: {
          select: {
            aiEstimatedValue: true,
            price: true,
            aiScore: true,
            dealScore: true,
            monitor: { select: { tags: true } },
          },
        },
      },
      orderBy: { buyDate: 'asc' },
      take: 100000,
    }) as unknown as HeldItemRow[];

    // Empty-state: no HELD trades
    if (heldTrades.length === 0) {
      return apiOk({
        ok: true,
        portfolio: {
          totalCapitalTied: 0,
          totalCarryingCostAccrued: 0,
          totalNetRecoverableValue: 0,
          capitalEfficiencyLoss: 0,
          avgDaysHeld: 0,
        },
        recoveryItems: [],
        plan: {
          expectedCashRecovery: 0,
          recoveryTimeline: 0,
          capitalVelocityImprovement: 0,
          reinvestmentOpportunities: [],
          prioritizedActions: [],
        },
        summary: 'Ni HELD trgovin v inventarju — Cash Recovery Accelerator ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD trgovin v inventarju — Cash Recovery Accelerator ni mogoč.',
      } satisfies CashRecoveryResponse);
    }

    // 2) Compute recovery items (deterministic baseline)
    const detItems = heldTrades.map((t) => computeRecoveryItem(t, now));
    const portfolio = computePortfolio(detItems);
    const detPlan = buildDeterministicPlan(detItems, portfolio);

    // Baseline (deterministic) recovery items, plan, summary
    let recoveryItems: RecoveryItem[] = [...detItems]
      .sort((a, b) => b.item.cashRecoveryUrgency - a.item.cashRecoveryUrgency)
      .map((d) => d.item);
    let plan = detPlan;
    let summary = buildSummary(portfolio, detPlan);
    let aiUsed = false;

    // 3) AI cache check (6h TTL) — key by held item ids
    const heldItemIds = heldTrades.map((t) => t.id).sort();
    const cacheKey = `cash-recovery-accelerator:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<{
      recoveryItems: RecoveryItem[];
      plan: RecoveryPlan;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        portfolio,
        recoveryItems: cached.recoveryItems,
        plan: cached.plan,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies CashRecoveryResponse);
    }

    // 4) AI prompt with grounding
    const topItemsForAI = buildPromptItems(detItems);
    const promptData = buildPromptData(portfolio, topItemsForAI, detPlan);
    const prompt = buildPrompt(promptData);

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      const merged = mergeAiIntoRecovery(parsed, detItems, portfolio, detPlan);
      recoveryItems = merged.recoveryItems;
      plan = merged.plan;
      summary = merged.summary;
      aiUsed = merged.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/cash-recovery-accelerator',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { recoveryItems, plan, summary });
    }

    return apiOk({
      ok: true,
      portfolio,
      recoveryItems,
      plan,
      summary,
      aiUsed,
    } satisfies CashRecoveryResponse);
  },
});

export const GET = cashRecoveryHandler;
export const POST = cashRecoveryHandler;
