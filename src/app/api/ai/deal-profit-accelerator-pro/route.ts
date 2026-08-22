// v7.99 / v8.96.4-batch3: AI Deal Profit Accelerator Pro — AI identificira kako ACCELERATE
// profit iz vsakega HELD item-a — specifične akcije da pridobiš VEČ profit-a
// HITREJE iz trenutnega inventorija. Kombinira pricing, timing in channel
// optimization per item. The "ultimate deal profit accelerator."
//
// Razlika od deal-accelerator (v7.x ki accelera closing) — ta accelera PROFIT
// (€) per item z actionable strategy. Razlika od profit-accelerator (v7.96 ki
// accelera profit generično) — ta daje PER-ITEM profit acceleration z
// acceleration ROI (€/day). Razlika od profit-velocity-maximizer (v7.98 ki
// maksimizira velocity) — ta fokusira na PROFIT ACCELERATION per held item
// (ne velocity of flow). Razlika od inventory-cash-conversion-maximizer (v7.98
// ki maksimizira cash conversion) — ta accelera PROFIT (ne samo cash — tudi
// neto profit acceleration). Razlika od deal-quality-profit-optimizer (v7.98
// ki optimira quality-profit) — ta accelera PROFIT iz existing held inventorija
// (ne quality filtering za sourcing). Razlika od capital-growth-maximizer
// (v7.99 ki maksimizira capital growth) — ta accelera profit PER ITEM z
// specific actions. Razlika od inventory-roi-maximizer-pro (v7.99 ki
// maksimizira ROI) — ta fokusira na PROFIT ACCELERATION (€/day additional
// profit, ne ROI %). Razlika from refurb-roi-calculator (ki računa refurb ROI)
// — ta daje 6 acceleration actions per item (PRICE/TIMING/CHANNEL/BUNDLE/
// REFURB/WAIT).
//
// "iPhone 13: currentProfit 95€, maximized 145€ (+50€, EASY → PRICE_OPTIMIZE,
// expectedProfit 145€, timeReduction 8d, ROI 6.25€/day, 85% probability).
// PS5: currentProfit 80€, maximized 130€ (+50€, MEDIUM → CHANNEL_OPTIMIZE,
// cross-platform premium, timeReduction 5d, ROI 10€/day, 70% probability).
// Portfolio: current 580€ → maximized 850€ (+270€ acceleration, grade B).
// Top items: PS5, iPhone 13 (highest acceleration ROI)."

// GET+POST /api/ai/deal-profit-accelerator-pro
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.4) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface DealProfitAcceleratorProInput {}

// --- Types ---------------------------------------------------------------

type AccelerationDifficulty = 'EASY' | 'MEDIUM' | 'HARD';
type AccelerationAction =
  | 'PRICE_OPTIMIZE'
  | 'TIMING_OPTIMIZE'
  | 'CHANNEL_OPTIMIZE'
  | 'BUNDLE_OPTIMIZE'
  | 'REFURBISH_UPGRADE'
  | 'WAIT_FOR_APPRECIATION';
type PortfolioAccelerationGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

interface HeldItemRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  listing: {
    aiEstimatedValue: number | null;
    price: number | null;
    aiScore: number | null;
    dealScore: number | null;
    monitor: { source: string; tags: string } | null;
  } | null;
}

interface ProfitAccelerationItem {
  tradeId: string;
  title: string;
  currentProfitPotential: number;
  maximizedProfitPotential: number;
  profitAccelerationGap: number;
  accelerationDifficulty: AccelerationDifficulty;
  accelerationAction: AccelerationAction;
  expectedProfitWithAction: number;
  profitAcceleration: number;
  timeReduction: number; // days
  accelerationROI: number; // €/day
  implementationSteps: string[];
  successProbability: number; // 0-100 %
}

interface TopAccelerationEntry {
  tradeId: string;
  title: string;
  accelerationROI: number;
}

interface PortfolioAcceleration {
  totalCurrentProfitPotential: number;
  totalMaximizedProfitPotential: number;
  totalAccelerationPotential: number;
  portfolioAccelerationGrade: PortfolioAccelerationGrade;
  topAccelerationItems: TopAccelerationEntry[];
}

interface DealProfitAcceleratorResponse {
  ok: true;
  items: ProfitAccelerationItem[];
  portfolio: PortfolioAcceleration;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  items?: Array<{
    tradeId?: string;
    accelerationDifficulty?: AccelerationDifficulty;
    accelerationAction?: AccelerationAction;
    expectedProfitWithAction?: number;
    profitAcceleration?: number;
    timeReduction?: number;
    implementationSteps?: string[];
    successProbability?: number;
  }>;
  portfolio?: {
    portfolioAccelerationGrade?: PortfolioAccelerationGrade;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const EST_FEE_RATE = 0.05; // 5% selling fees
const PROFIT_MIN = 0;
const PROFIT_MAX = 50_000;
const GAP_MIN = 0;
const GAP_MAX = 50_000;
const DAYS_MIN = 0;
const DAYS_MAX = 365;
const ROI_MIN = 0;
const ROI_MAX = 5_000; // €/day ceiling
const PROB_MIN = 0;
const PROB_MAX = 100;
const MAX_STEPS_PER_ITEM = 6;

const DEFAULT_REDUCTION_DAYS_EASY = 10;
const DEFAULT_REDUCTION_DAYS_MEDIUM = 5;
const DEFAULT_REDUCTION_DAYS_HARD = 3;
const MAX_PROFIT_UPGRADE_MULT = 1.5; // anti-hallucination: max 50% profit uplift per item

const VALID_DIFFICULTY: readonly AccelerationDifficulty[] = ['EASY', 'MEDIUM', 'HARD'];
const VALID_ACTION: readonly AccelerationAction[] = [
  'PRICE_OPTIMIZE',
  'TIMING_OPTIMIZE',
  'CHANNEL_OPTIMIZE',
  'BUNDLE_OPTIMIZE',
  'REFURBISH_UPGRADE',
  'WAIT_FOR_APPRECIATION',
];
const VALID_GRADE: readonly PortfolioAccelerationGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

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

interface DetAccelItem {
  item: ProfitAccelerationItem;
  daysHeld: number;
  estValue: number;
}

function computeEstValue(t: HeldItemRow): number {
  const buyPrice = t.buyPrice ?? 0;
  const listingEst = t.listing?.aiEstimatedValue ?? null;
  const listingPrice = t.listing?.price ?? null;
  if (listingEst && listingEst > 0) return Math.round(listingEst);
  if (listingPrice && listingPrice > 0) return Math.round(listingPrice);
  return Math.round(buyPrice * 1.1);
}

function decideAccelerationDifficulty(
  estValue: number,
  buyPrice: number,
  daysHeld: number,
): AccelerationDifficulty {
  // EASY: if estValue > buyPrice × 1.5 (high margin) and held < 30 days (fresh)
  // MEDIUM: moderate margin OR moderate hold
  // HARD: low margin (close to break-even) OR long hold (>60 days, stale)
  if (buyPrice <= 0) return 'HARD';
  const marginRatio = estValue / buyPrice;
  if (marginRatio >= 1.5 && daysHeld < 30) return 'EASY';
  if (marginRatio >= 1.2 && daysHeld < 60) return 'MEDIUM';
  if (marginRatio < 1.1 || daysHeld >= 90) return 'HARD';
  return 'MEDIUM';
}

function decideAccelerationAction(
  estValue: number,
  buyPrice: number,
  daysHeld: number,
  source: string,
  dealScore: number | null,
): AccelerationAction {
  // WAIT_FOR_APPRECIATION: collectible / vintage items
  // REFURBISH_UPGRADE: low dealScore or older item
  // BUNDLE_OPTIMIZE: low-margin items that bundle well
  // CHANNEL_OPTIMIZE: cross-platform opportunity (currently only one source)
  // TIMING_OPTIMIZE: long hold → timing issue
  // PRICE_OPTIMIZE: default — adjust price
  if (daysHeld > 60 && estValue > buyPrice * 1.3) {
    return 'WAIT_FOR_APPRECIATION';
  }
  if (dealScore !== null && dealScore < 50) {
    return 'REFURBISH_UPGRADE';
  }
  if (estValue < buyPrice * 1.2) {
    return 'BUNDLE_OPTIMIZE';
  }
  if (source && !source.toLowerCase().includes('bolha')) {
    // Currently on non-Bolha → consider cross-platform premium
    return 'CHANNEL_OPTIMIZE';
  }
  if (daysHeld > 30) {
    return 'TIMING_OPTIMIZE';
  }
  return 'PRICE_OPTIMIZE';
}

function computeProfitAccelerationItem(t: HeldItemRow, now: number): DetAccelItem {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const buyMs = toMs(t.buyDate);
  const daysHeld = buyMs > 0 ? Math.max(0, Math.round((now - buyMs) / DAY_MS)) : 0;
  const estValue = computeEstValue(t);

  const cost = buyPrice + buyFees;
  const estFees = Math.round(estValue * EST_FEE_RATE);
  const currentProfitPotential = round0(clampNum(
    estValue - cost - estFees,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  // Maximized profit: anti-hallucination — cap at current × 1.5 + small uplift
  const maximizedProfitPotential = round0(clampNum(
    Math.max(currentProfitPotential, Math.min(
      currentProfitPotential * MAX_PROFIT_UPGRADE_MULT + 25,
      estValue * 0.8, // never exceed 80% of estValue as profit
    )),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  const profitAccelerationGap = round0(clampNum(
    maximizedProfitPotential - currentProfitPotential,
    GAP_MIN, GAP_MAX, 0,
  ));

  const accelerationDifficulty = decideAccelerationDifficulty(estValue, buyPrice, daysHeld);

  const source = t.listing?.monitor?.source ?? '';
  const dealScore = t.listing?.dealScore ?? null;
  const accelerationAction = decideAccelerationAction(
    estValue, buyPrice, daysHeld, source, dealScore,
  );

  const expectedProfitWithAction = round0(clampNum(
    maximizedProfitPotential,
    PROFIT_MIN, PROFIT_MAX, currentProfitPotential,
  ));

  const profitAcceleration = round0(clampNum(
    profitAccelerationGap,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  // Time reduction (days faster than current hold trajectory)
  const timeReduction = round0(clampNum(
    accelerationDifficulty === 'EASY'
      ? DEFAULT_REDUCTION_DAYS_EASY
      : accelerationDifficulty === 'MEDIUM'
        ? DEFAULT_REDUCTION_DAYS_MEDIUM
        : DEFAULT_REDUCTION_DAYS_HARD,
    DAYS_MIN, DAYS_MAX, 5,
  ));

  const accelerationROI = timeReduction > 0
    ? round2(clampNum(profitAcceleration / timeReduction, ROI_MIN, ROI_MAX, 0))
    : 0;

  // Implementation steps (3-6 actionable, slovenski)
  const steps: string[] = [];
  switch (accelerationAction) {
    case 'PRICE_OPTIMIZE':
      steps.push(`Ciljaj prodajno ceno ${Math.round(estValue * 0.98)}€ (2% pod estValue za hitro prodajo).`);
      steps.push('Posodobi listing ceno in opis.');
      steps.push('Monitoriraj CTR in ureau response v 7 dneh.');
      break;
    case 'TIMING_OPTIMIZE':
      steps.push('Premakni listing v weekend peak time (petek 18-20h).');
      steps.push('Osveži listing datum da se prikaže na vrhu search.');
      steps.push('Dodaj "limited time offer" v opis za urgency.');
      break;
    case 'CHANNEL_OPTIMIZE':
      steps.push('Cross-post na Bolha + Vinted + Facebook Marketplace.');
      steps.push('Prilagodi naslov za vsako platformo (SEO keywords).');
      steps.push('Postavi višjo ceno na premium platformi (Vinted +5%).');
      break;
    case 'BUNDLE_OPTIMIZE':
      steps.push('Identificiraj 2-3 komplementarne item-e v inventoriju.');
      steps.push('Ustvari bundle listing z 10% popustom.');
      steps.push('Promoviraj bundle v opisu vsakega item-a.');
      break;
    case 'REFURBISH_UPGRADE':
      steps.push('Očisti in restavriraj item (1-2 uri dela).');
      steps.push('Naredi nove foto z boljšo osvetlitvijo.');
      steps.push('Posodobi opis z "restored" angle za premium positioning.');
      break;
    case 'WAIT_FOR_APPRECIATION':
      steps.push('Počakaj 30-60 dni na seasonali peak (npr. pred prazniki).');
      steps.push('Re-list z "rare / collectible" tag za premium positioning.');
      steps.push('Monitoriraj market demand trend tedensko.');
      break;
  }
  const clampedSteps = steps.slice(0, MAX_STEPS_PER_ITEM).map((s) => clampString(s, 200, 'Akcija.'));

  // Success probability 0-100 (EASY → 80-90, MEDIUM → 60-75, HARD → 30-55)
  const baseProb = accelerationDifficulty === 'EASY'
    ? 85
    : accelerationDifficulty === 'MEDIUM'
      ? 65
      : 45;
  const successProbability = round0(clampNum(baseProb, PROB_MIN, PROB_MAX, baseProb));

  return {
    item: {
      tradeId: t.id,
      title: clampString(t.title, 200, 'Item'),
      currentProfitPotential,
      maximizedProfitPotential,
      profitAccelerationGap,
      accelerationDifficulty,
      accelerationAction,
      expectedProfitWithAction,
      profitAcceleration,
      timeReduction,
      accelerationROI,
      implementationSteps: clampedSteps,
      successProbability,
    },
    daysHeld,
    estValue,
  };
}

function buildPortfolio(detItems: DetAccelItem[]): PortfolioAcceleration {
  const totalCurrentProfitPotential = round0(clampNum(
    detItems.reduce((s, d) => s + d.item.currentProfitPotential, 0),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const totalMaximizedProfitPotential = round0(clampNum(
    detItems.reduce((s, d) => s + d.item.maximizedProfitPotential, 0),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const totalAccelerationPotential = round0(clampNum(
    totalMaximizedProfitPotential - totalCurrentProfitPotential,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  // Grade based on acceleration potential ratio
  const ratio = totalCurrentProfitPotential > 0
    ? totalAccelerationPotential / totalCurrentProfitPotential
    : 0;
  let portfolioAccelerationGrade: PortfolioAccelerationGrade;
  if (totalCurrentProfitPotential === 0) portfolioAccelerationGrade = 'F';
  else if (ratio >= 0.5) portfolioAccelerationGrade = 'A+';
  else if (ratio >= 0.35) portfolioAccelerationGrade = 'A';
  else if (ratio >= 0.25) portfolioAccelerationGrade = 'B';
  else if (ratio >= 0.15) portfolioAccelerationGrade = 'C';
  else if (ratio >= 0.05) portfolioAccelerationGrade = 'D';
  else portfolioAccelerationGrade = 'F';

  // Top acceleration items: top 5 by accelerationROI
  const topAccelerationItems: TopAccelerationEntry[] = [...detItems]
    .sort((a, b) => b.item.accelerationROI - a.item.accelerationROI)
    .slice(0, 5)
    .map((d) => ({
      tradeId: d.item.tradeId,
      title: clampString(d.item.title, 100, 'Item'),
      accelerationROI: d.item.accelerationROI,
    }));

  return {
    totalCurrentProfitPotential,
    totalMaximizedProfitPotential,
    totalAccelerationPotential,
    portfolioAccelerationGrade,
    topAccelerationItems,
  };
}

function buildSummary(
  detItems: DetAccelItem[],
  portfolio: PortfolioAcceleration,
): string {
  const parts: string[] = [
    `${detItems.length} held item-ov.`,
    `Current profit potential: ${portfolio.totalCurrentProfitPotential}€.`,
    `Maximized: ${portfolio.totalMaximizedProfitPotential}€ (+${portfolio.totalAccelerationPotential}€ acceleration).`,
    `Grade: ${portfolio.portfolioAccelerationGrade}.`,
    `Top ${portfolio.topAccelerationItems.length} acceleration items.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Prompt builder + AI response transform (čisti helperji) ------------

interface PromptData {
  heldItemsCount: number;
  heldItems: Array<{
    tradeId: string;
    title: string;
    daysHeld: number;
    estValue: number;
    buyPrice: number;
    detCurrentProfit: number;
    detMaximizedProfit: number;
    detAccelerationGap: number;
    detDifficulty: AccelerationDifficulty;
    detAction: AccelerationAction;
    detTimeReduction: number;
    detAccelerationROI: number;
    detSuccessProbability: number;
  }>;
  deterministicPortfolio: PortfolioAcceleration;
  caps: {
    profitMin: number; profitMax: number;
    gapMin: number; gapMax: number;
    daysMin: number; daysMax: number;
    roiMin: number; roiMax: number;
    probMin: number; probMax: number;
  };
}

function buildPrompt(detItems: DetAccelItem[], portfolio: PortfolioAcceleration): string {
  const topItemsForAI = [...detItems]
    .sort((a, b) => b.item.accelerationROI - a.item.accelerationROI)
    .slice(0, 40)
    .map((d) => ({
      tradeId: d.item.tradeId,
      title: d.item.title,
      daysHeld: d.daysHeld,
      estValue: d.estValue,
      buyPrice: d.item.currentProfitPotential > 0
        ? Math.round(d.estValue - d.item.currentProfitPotential)
        : d.estValue,
      detCurrentProfit: d.item.currentProfitPotential,
      detMaximizedProfit: d.item.maximizedProfitPotential,
      detAccelerationGap: d.item.profitAccelerationGap,
      detDifficulty: d.item.accelerationDifficulty,
      detAction: d.item.accelerationAction,
      detTimeReduction: d.item.timeReduction,
      detAccelerationROI: d.item.accelerationROI,
      detSuccessProbability: d.item.successProbability,
    }));

  const promptData: PromptData = {
    heldItemsCount: detItems.length,
    heldItems: topItemsForAI,
    deterministicPortfolio: portfolio,
    caps: {
      profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
      gapMin: GAP_MIN, gapMax: GAP_MAX,
      daysMin: DAYS_MIN, daysMax: DAYS_MAX,
      roiMin: ROI_MIN, roiMax: ROI_MAX,
      probMin: PROB_MIN, probMax: PROB_MAX,
    },
  };

  return `Si AI "Deal Profit Accelerator Pro" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za PROFIT ACCELERATION per held item — identificiraš kako MAXIMIZIRATI profit iz VSAKEGA held item-a z specifičnimi akcijami (pricing, timing, channel, bundle, refurb, wait). Razlika od deal-accelerator (ki accelera closing) — ti accelera PROFIT (€) per item. Razlika od profit-accelerator (v7.96 ki accelera profit generično) — ti daje PER-ITEM profit acceleration z acceleration ROI (€/day). Razlika od profit-velocity-maximizer (v7.98 ki maksimizira velocity) — ti fokusira na PROFIT ACCELERATION per held item (ne velocity of flow). Razlika od inventory-cash-conversion-maximizer (v7.98 ki maksimizira cash conversion) — ti accelera PROFIT (ne samo cash — tudi neto profit acceleration). Razlika od capital-growth-maximizer (v7.99 ki maksimizira capital growth) — ti accelera profit PER ITEM z specific actions.

DETERMINISTIČNI PODATKI (izračunano iz DB — HELD trgovin z linked Listing):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. items: za vsak tradeId iz heldItems (top 40), daj:
   - tradeId (string, MORA match-at enega iz heldItems — anti-hallucination),
   - accelerationDifficulty: EASY | MEDIUM | HARD (lahko se razlikuje od detDifficulty),
   - accelerationAction: PRICE_OPTIMIZE | TIMING_OPTIMIZE | CHANNEL_OPTIMIZE | BUNDLE_OPTIMIZE | REFURBISH_UPGRADE | WAIT_FOR_APPRECIATION (lahko se razlikuje od detAction),
   - expectedProfitWithAction € [0, 50000] (≥ detCurrentProfit, ≤ detMaximizedProfit × 1.5 anti-hallucination),
   - profitAcceleration € [0, 50000] (= expectedProfitWithAction - detCurrentProfit),
   - timeReduction dni [0, 365] (koliko dni hitreje kot trenutno),
   - implementationSteps: 3-6 korakov (max 200 znakov vsak, slovenski),
   - successProbability % [0, 100].
2. portfolio.portfolioAccelerationGrade: A+ | A | B | C | D | F (A+ če totalAccelerationPotential / totalCurrentProfitPotential ≥ 0.5, F če < 0.05),
3. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "items": [
    {
      "tradeId": "ckxxxxx",
      "accelerationDifficulty": "EASY",
      "accelerationAction": "PRICE_OPTIMIZE",
      "expectedProfitWithAction": 145,
      "profitAcceleration": 50,
      "timeReduction": 8,
      "implementationSteps": ["Ciljaj prodajno ceno 145€.", "Posodobi listing opis.", "Monitoriraj CTR 7 dni."],
      "successProbability": 85
    }
  ],
  "portfolio": { "portfolioAccelerationGrade": "B" },
  "summary": "12 held item-ov. Current profit: 580€. Maximized: 850€ (+270€). Grade B."
}${GROUNDING_PROMPT_SUFFIX}`;
}

interface AiTransformResult {
  items: ProfitAccelerationItem[];
  portfolio: PortfolioAcceleration;
  summary: string;
}

function transformAiResponse(
  parsed: unknown,
  detItems: DetAccelItem[],
  detByTradeId: Map<string, DetAccelItem>,
): AiTransformResult | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const ai = parsed as AiResponse;

  const aiItemsMap = new Map<string, NonNullable<AiResponse['items']>[number]>();
  if (Array.isArray(ai.items)) {
    for (const a of ai.items) {
      if (a && typeof a === 'object' && typeof a.tradeId === 'string') {
        aiItemsMap.set(a.tradeId, a);
      }
    }
  }

  const aiItems: ProfitAccelerationItem[] = [];
  for (const d of detItems) {
    const a = aiItemsMap.get(d.item.tradeId);
    if (!a) {
      aiItems.push(d.item);
      continue;
    }

    const difficulty = clampEnum(
      a.accelerationDifficulty,
      VALID_DIFFICULTY,
      d.item.accelerationDifficulty,
    );
    const action = clampEnum(
      a.accelerationAction,
      VALID_ACTION,
      d.item.accelerationAction,
    );

    // Anti-hallucination: expectedProfitWithAction ∈ [currentProfit, currentProfit × 1.5 + 25]
    const maxProfitBound = Math.min(
      PROFIT_MAX,
      d.item.currentProfitPotential * 1.5 + 25,
    );
    const expectedProfitWithAction = round0(clampNum(
      a.expectedProfitWithAction,
      d.item.currentProfitPotential, maxProfitBound,
      d.item.maximizedProfitPotential,
    ));
    const profitAcceleration = round0(clampNum(
      a.profitAcceleration,
      PROFIT_MIN, PROFIT_MAX,
      Math.max(0, expectedProfitWithAction - d.item.currentProfitPotential),
    ));

    const timeReduction = round0(clampNum(
      a.timeReduction,
      DAYS_MIN, DAYS_MAX,
      d.item.timeReduction,
    ));

    const accelerationROI = timeReduction > 0
      ? round2(clampNum(
        profitAcceleration / timeReduction,
        ROI_MIN, ROI_MAX, 0,
      ))
      : 0;

    // Implementation steps (3-6 strings)
    const implementationSteps: string[] = [];
    if (Array.isArray(a.implementationSteps)) {
      for (const s of a.implementationSteps.slice(0, MAX_STEPS_PER_ITEM)) {
        if (typeof s !== 'string') continue;
        implementationSteps.push(clampString(s, 200, 'Korak.'));
      }
    }
    if (implementationSteps.length === 0) {
      for (const s of d.item.implementationSteps) implementationSteps.push(s);
    }
    if (implementationSteps.length === 0) {
      implementationSteps.push('Izvedi akcijo za profit acceleration.');
    }

    const successProbability = round0(clampNum(
      a.successProbability,
      PROB_MIN, PROB_MAX,
      d.item.successProbability,
    ));

    aiItems.push({
      tradeId: d.item.tradeId,
      title: d.item.title,
      currentProfitPotential: d.item.currentProfitPotential,
      maximizedProfitPotential: expectedProfitWithAction > d.item.maximizedProfitPotential
        ? expectedProfitWithAction
        : d.item.maximizedProfitPotential,
      profitAccelerationGap: round0(clampNum(
        expectedProfitWithAction - d.item.currentProfitPotential,
        GAP_MIN, GAP_MAX, 0,
      )),
      accelerationDifficulty: difficulty,
      accelerationAction: action,
      expectedProfitWithAction,
      profitAcceleration,
      timeReduction,
      accelerationROI,
      implementationSteps: implementationSteps.slice(0, MAX_STEPS_PER_ITEM),
      successProbability,
    });
  }

  let portfolio = buildPortfolio(
    aiItems.map((it) => {
      const det = detByTradeId.get(it.tradeId);
      return {
        item: it,
        daysHeld: det?.daysHeld ?? 0,
        estValue: det?.estValue ?? 0,
      };
    }),
  );

  // Override portfolio grade if AI provided one
  if (ai.portfolio?.portfolioAccelerationGrade) {
    portfolio = {
      ...portfolio,
      portfolioAccelerationGrade: clampEnum(
        ai.portfolio.portfolioAccelerationGrade,
        VALID_GRADE,
        portfolio.portfolioAccelerationGrade,
      ),
    };
  }

  const summary = clampString(ai.summary, 400, buildSummary(
    aiItems.map((it) => {
      const det = detByTradeId.get(it.tradeId);
      return {
        item: it,
        daysHeld: det?.daysHeld ?? 0,
        estValue: det?.estValue ?? 0,
      };
    }),
    portfolio,
  ));

  return { items: aiItems, portfolio, summary };
}

// --- Handler -------------------------------------------------------------

const dealProfitAcceleratorProHandler = withAiRoute<DealProfitAcceleratorProInput>({
  endpoint: '/api/ai/deal-profit-accelerator-pro',
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
            monitor: { select: { source: true, tags: true } },
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
        items: [],
        portfolio: {
          totalCurrentProfitPotential: 0,
          totalMaximizedProfitPotential: 0,
          totalAccelerationPotential: 0,
          portfolioAccelerationGrade: 'F',
          topAccelerationItems: [],
        },
        summary: 'Ni HELD trgovin v inventarju — Deal Profit Accelerator Pro ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD trgovin v inventarju — Deal Profit Accelerator Pro ni mogoč.',
      } satisfies DealProfitAcceleratorResponse);
    }

    // 2) Compute per-item profit acceleration metrics (deterministic baseline)
    const detItems = heldTrades.map((t) => computeProfitAccelerationItem(t, now));

    let items: ProfitAccelerationItem[] = detItems.map((d) => d.item);
    let portfolio = buildPortfolio(detItems);
    let summary = buildSummary(detItems, portfolio);

    // 3) AI cache check (6h TTL) — key by held item ids
    const heldItemIds = heldTrades.map((t) => t.id).sort();
    const cacheKey = `deal-profit-accelerator-pro:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<{
      items: ProfitAccelerationItem[];
      portfolio: PortfolioAcceleration;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        items: cached.items,
        portfolio: cached.portfolio,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies DealProfitAcceleratorResponse);
    }

    // 4) Build AI prompt with grounding + call AI (try/catch z graceful fallback)
    const prompt = buildPrompt(detItems, portfolio);
    const detByTradeId = new Map<string, DetAccelItem>();
    for (const d of detItems) detByTradeId.set(d.item.tradeId, d);

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      const transformed = transformAiResponse(parsed, detItems, detByTradeId);
      if (transformed) {
        items = transformed.items;
        portfolio = transformed.portfolio;
        summary = transformed.summary;
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/deal-profit-accelerator-pro',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { items, portfolio, summary });
    }

    return apiOk({
      ok: true,
      items,
      portfolio,
      summary,
      aiUsed,
    } satisfies DealProfitAcceleratorResponse);
  },
});

export const GET = dealProfitAcceleratorProHandler;
export const POST = dealProfitAcceleratorProHandler;
