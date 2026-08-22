// v7.99 / v8.96.4-batch3: AI Inventory ROI Maximizer Pro — AI maksimizira ROI čez celoten
// held inventar z per-item specifičnimi recommendations. Razlika od
// inventory-roi-optimizer (v7.79 ki optimira ROI z rebalance actions) — ta
// MAXIMIZIRA ROI z absolutno best strategy per item (HOLD_AND_WAIT,
// SELL_NOW_AT_PREMIUM, DISCOUNT_FOR_VOLUME, CROSS_PLATFORM_PREMIUM,
// BUNDLE_FOR_UPSELL, REFURB_FOR_PREMIUM). Razlika od inventory-profit-
// maximizer (ki maksimizira profit) — ta maksimizira ROI % (ne € profit).
// Razlika od capital-growth-maximizer (v7.99 ki maksimizira capital growth) —
// ta maksimizira per-item ROI z specific strategy. Razlika od deal-profit-
// accelerator-pro (v7.99 ki accelera profit per item) — ta maksimizira ROI %
// (ne profit acceleration €). Razlika od profit-margin-maximizer (ki
// maksimizira margin) — ta maksimizira ROI na posameznem held item-u z AI
// strategy. Razlika od inventory-value-maximizer (v7.97 ki maksimizira value)
// — ta maksimizira ROI % (ne value). Razlika from refurb-roi-calculator (ki
// računa refurb ROI) — ta daje 6 maximization strategies per item.
//
// "iPhone 13: currentROI 28% (GOOD), maximized 42% (EXCELLENT, +14% lift,
// CROSS_PLATFORM_PREMIUM, €185 profit, 14d to max ROI, risk: medium demand
// fluctuation). PS5: currentROI 35% (GOOD), maximized 58% (EXCELLENT, +23%
// lift, REFURB_FOR_PREMIUM, €240 profit, 21d to max ROI, risk: refurb cost
// overrun). Portfolio: current 24% → maximized 41% (+17% lift, grade A).
// Total additional profit: €425."
//
// GET+POST /api/ai/inventory-roi-maximizer-pro
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.4) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InventoryRoiMaximizerInput {}

// --- Types ---------------------------------------------------------------

type RoiCategory = 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'NEGATIVE';
type RoiMaximizationStrategy =
  | 'HOLD_AND_WAIT'
  | 'SELL_NOW_AT_PREMIUM'
  | 'DISCOUNT_FOR_VOLUME'
  | 'CROSS_PLATFORM_PREMIUM'
  | 'BUNDLE_FOR_UPSELL'
  | 'REFURB_FOR_PREMIUM';
type RoiMaximizationGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

interface HeldItemRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number;
  listing: {
    aiEstimatedValue: number | null;
    price: number | null;
    aiScore: number | null;
    dealScore: number | null;
  } | null;
}

interface RoiMaximizationItem {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  aiEstimatedValue: number | null;
  currentROI: number; // %
  maximizedROI: number; // %
  roiGap: number; // %
  roiCategory: RoiCategory;
  roiMaximizationStrategy: RoiMaximizationStrategy;
  roiLift: number; // %
  expectedProfitAtMaxROI: number; // €
  implementationActions: string[];
  timeToMaxROI: number; // days
  riskToMaxROI: string;
}

interface PortfolioRoiMaximization {
  currentPortfolioROI: number;
  maximizedPortfolioROI: number;
  totalROILift: number;
  roiMaximizationGrade: RoiMaximizationGrade;
  totalAdditionalProfit: number;
}

interface InventoryRoiMaximizerResponse {
  ok: true;
  items: RoiMaximizationItem[];
  portfolio: PortfolioRoiMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  items?: Array<{
    tradeId?: string;
    roiMaximizationStrategy?: RoiMaximizationStrategy;
    maximizedROI?: number;
    implementationActions?: string[];
    timeToMaxROI?: number;
    riskToMaxROI?: string;
  }>;
  portfolio?: {
    roiMaximizationGrade?: RoiMaximizationGrade;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const EST_FEE_RATE = 0.05; // 5% selling fees
const ROI_MIN = -50; // anti-hallucination lower bound
const ROI_MAX = 300; // anti-hallucination upper bound (300% ROI)
const LIFT_MIN = 0;
const LIFT_MAX = 100;
const PROFIT_MIN = 0;
const PROFIT_MAX = 50_000;
const DAYS_MIN = 1;
const DAYS_MAX = 365;
const MAX_ACTIONS_PER_ITEM = 5;

const MAX_ROI_UPGRADE_MULT = 1.8; // anti-hallucination: maximizedROI ≤ currentROI × 1.8
const MAX_ROI_UPGRADE_ADD = 25; // +25 percentage points baseline
const MAX_PROFIT_BASIS = 0.85; // profit capped at 85% of estValue (anti-hallucination)

const VALID_CATEGORY: readonly RoiCategory[] = ['EXCELLENT', 'GOOD', 'AVERAGE', 'NEGATIVE'];
const VALID_STRATEGY: readonly RoiMaximizationStrategy[] = [
  'HOLD_AND_WAIT',
  'SELL_NOW_AT_PREMIUM',
  'DISCOUNT_FOR_VOLUME',
  'CROSS_PLATFORM_PREMIUM',
  'BUNDLE_FOR_UPSELL',
  'REFURB_FOR_PREMIUM',
];
const VALID_GRADE: readonly RoiMaximizationGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

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

// --- Deterministic computation ------------------------------------------

interface DetRoiItem {
  item: RoiMaximizationItem;
  estValue: number;
  cost: number;
}

function computeEstValue(t: HeldItemRow): number {
  const buyPrice = t.buyPrice ?? 0;
  const listingEst = t.listing?.aiEstimatedValue ?? null;
  const listingPrice = t.listing?.price ?? null;
  if (listingEst && listingEst > 0) return Math.round(listingEst);
  if (listingPrice && listingPrice > 0) return Math.round(listingPrice);
  return Math.round(buyPrice * 1.1);
}

function decideRoiCategory(roi: number): RoiCategory {
  if (roi >= 40) return 'EXCELLENT';
  if (roi >= 20) return 'GOOD';
  if (roi >= 0) return 'AVERAGE';
  return 'NEGATIVE';
}

function decideRoiStrategy(
  currentROI: number,
  roiCategory: RoiCategory,
  dealScore: number | null,
): RoiMaximizationStrategy {
  // EXCELLENT ROI + high dealScore → SELL_NOW_AT_PREMIUM (lock in profit)
  // GOOD ROI + low dealScore → REFURB_FOR_PREMIUM (upgrade to push higher)
  // AVERAGE ROI → CROSS_PLATFORM_PREMIUM (find better market)
  // NEGATIVE ROI → BUNDLE_FOR_UPSELL (recover via bundle)
  // EXCELLENT + appreciation potential → HOLD_AND_WAIT
  // Discount situations → DISCOUNT_FOR_VOLUME (sell faster with small discount)
  if (roiCategory === 'EXCELLENT' && dealScore !== null && dealScore >= 75) {
    return 'SELL_NOW_AT_PREMIUM';
  }
  if (roiCategory === 'EXCELLENT') {
    return 'HOLD_AND_WAIT';
  }
  if (roiCategory === 'GOOD' && dealScore !== null && dealScore < 55) {
    return 'REFURB_FOR_PREMIUM';
  }
  if (roiCategory === 'GOOD') {
    return 'CROSS_PLATFORM_PREMIUM';
  }
  if (roiCategory === 'AVERAGE') {
    return 'DISCOUNT_FOR_VOLUME';
  }
  // NEGATIVE
  return 'BUNDLE_FOR_UPSELL';
}

function computeRoiMaximizationItem(t: HeldItemRow): DetRoiItem {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const estValue = computeEstValue(t);
  const cost = buyPrice + buyFees;

  const estFees = Math.round(estValue * EST_FEE_RATE);
  const currentProfit = estValue - cost - estFees;
  const currentROI = cost > 0
    ? round2(clampNum((currentProfit / cost) * 100, ROI_MIN, ROI_MAX, 0))
    : 0;

  const roiCategory = decideRoiCategory(currentROI);

  // Maximized ROI: anti-hallucination — cap at currentROI × 1.8 OR currentROI + 25 (whichever higher)
  const maxROIBound = Math.min(
    ROI_MAX,
    Math.max(
      currentROI * MAX_ROI_UPGRADE_MULT,
      currentROI + MAX_ROI_UPGRADE_ADD,
    ),
  );
  const maximizedROI = round2(clampNum(
    Math.max(currentROI, maxROIBound),
    ROI_MIN, ROI_MAX, currentROI,
  ));

  const roiGap = round2(clampNum(
    maximizedROI - currentROI,
    LIFT_MIN, LIFT_MAX, 0,
  ));

  const dealScore = t.listing?.dealScore ?? null;
  const roiMaximizationStrategy = decideRoiStrategy(currentROI, roiCategory, dealScore);

  const roiLift = roiGap;

  // Expected profit at max ROI = (maximizedROI / 100) × cost
  const expectedProfitAtMaxROI = round0(clampNum(
    (maximizedROI / 100) * cost,
    PROFIT_MIN, Math.min(PROFIT_MAX, estValue * MAX_PROFIT_BASIS), 0,
  ));

  // Time to max ROI (days)
  const timeToMaxROI = round0(clampNum(
    roiMaximizationStrategy === 'SELL_NOW_AT_PREMIUM' ? 7
      : roiMaximizationStrategy === 'DISCOUNT_FOR_VOLUME' ? 10
        : roiMaximizationStrategy === 'CROSS_PLATFORM_PREMIUM' ? 14
          : roiMaximizationStrategy === 'BUNDLE_FOR_UPSELL' ? 21
            : roiMaximizationStrategy === 'REFURB_FOR_PREMIUM' ? 28
              : 60, // HOLD_AND_WAIT
    DAYS_MIN, DAYS_MAX, 14,
  ));

  // Implementation actions (3-5 actionable, slovenski)
  const actions: string[] = [];
  switch (roiMaximizationStrategy) {
    case 'HOLD_AND_WAIT':
      actions.push('Počakaj 30-60 dni na seasonal peak (prazniki, sezona).');
      actions.push('Re-list z "rare / collectible" angle za premium perception.');
      actions.push('Monitoriraj demand trend tedensko.');
      break;
    case 'SELL_NOW_AT_PREMIUM':
      actions.push(`Postavi ceno ${Math.round(estValue * 1.05)}€ (+5% premium).`);
      actions.push('Dodaj "premium / mint condition" v naslov in opis.');
      actions.push('Promoviraj v weekend peak time.');
      break;
    case 'DISCOUNT_FOR_VOLUME':
      actions.push('Ponudi 10% popust za hitro prodajo.');
      actions.push('Bundle z drugim item-om za combined value.');
      actions.push('Ciljaj buyer-je z urgency ("limited time offer").');
      break;
    case 'CROSS_PLATFORM_PREMIUM':
      actions.push('Cross-post na Bolha + Vinted + Facebook Marketplace.');
      actions.push('Prilagodi ceno per platformi (Vinted +5%, FB -3%).');
      actions.push('Uporabi platform-specific SEO keywords v naslovu.');
      break;
    case 'BUNDLE_FOR_UPSELL':
      actions.push('Identificiraj 2-3 komplementarne item-e za bundle.');
      actions.push('Ustvari bundle z 10% popustom skupaj.');
      actions.push('Cross-promote bundle v vseh povezanih listing-ih.');
      break;
    case 'REFURB_FOR_PREMIUM':
      actions.push('Očisti in restavriraj item (1-2 uri dela).');
      actions.push('Naredi nove foto z boljšo osvetlitvijo in styling.');
      actions.push('Posodobi opis z "restored / refreshed" angle za +15-20% premium.');
      break;
  }
  const clampedActions = actions.slice(0, MAX_ACTIONS_PER_ITEM).map((s) => clampString(s, 200, 'Akcija.'));

  const riskToMaxROI = clampString(
    roiMaximizationStrategy === 'HOLD_AND_WAIT'
      ? 'Risk: market demand se spremeni med hold periodo — mitigiraj z weekly demand monitoring.'
      : roiMaximizationStrategy === 'REFURB_FOR_PREMIUM'
        ? 'Risk: refurb cost overrun — mitigiraj z明确 budget 30€ max za material.'
        : roiMaximizationStrategy === 'CROSS_PLATFORM_PREMIUM'
          ? 'Risk: cross-platform fees pojedo margin — mitigiraj z 2-3 platformami max, fees < 8%.'
          : roiMaximizationStrategy === 'BUNDLE_FOR_UPSELL'
            ? 'Risk: bundle ne proda — mitigiraj z mini-bundle (2 item-a max) za easier sell.'
            : roiMaximizationStrategy === 'DISCOUNT_FOR_VOLUME'
              ? 'Risk: prevelik discount — mitigiraj z 8-10% max discount, ne več.'
              : 'Risk: premium pricing zavre buyer-je — mitigiraj z "or best offer" opcijo za negiotiation.',
    200,
    'Risk pri doseganju max ROI.',
  );

  return {
    item: {
      tradeId: t.id,
      title: clampString(t.title, 200, 'Item'),
      category: clampString(t.category || 'drugo', 80, 'drugo'),
      buyPrice: round0(buyPrice),
      aiEstimatedValue: t.listing?.aiEstimatedValue && t.listing.aiEstimatedValue > 0
        ? round0(t.listing.aiEstimatedValue)
        : null,
      currentROI,
      maximizedROI,
      roiGap,
      roiCategory,
      roiMaximizationStrategy,
      roiLift,
      expectedProfitAtMaxROI,
      implementationActions: clampedActions,
      timeToMaxROI,
      riskToMaxROI,
    },
    estValue,
    cost,
  };
}

function buildPortfolio(detItems: DetRoiItem[]): PortfolioRoiMaximization {
  if (detItems.length === 0) {
    return {
      currentPortfolioROI: 0,
      maximizedPortfolioROI: 0,
      totalROILift: 0,
      roiMaximizationGrade: 'F',
      totalAdditionalProfit: 0,
    };
  }

  // Weighted average ROI by buyPrice + buyFees (cost)
  const totalCost = detItems.reduce((s, d) => s + d.cost, 0);
  const currentPortfolioROI = totalCost > 0
    ? round2(clampNum(
      (detItems.reduce((s, d) => s + d.item.currentROI * d.cost, 0) / totalCost),
      ROI_MIN, ROI_MAX, 0,
    ))
    : 0;
  const maximizedPortfolioROI = totalCost > 0
    ? round2(clampNum(
      (detItems.reduce((s, d) => s + d.item.maximizedROI * d.cost, 0) / totalCost),
      ROI_MIN, ROI_MAX, 0,
    ))
    : 0;
  const totalROILift = round2(clampNum(
    maximizedPortfolioROI - currentPortfolioROI,
    LIFT_MIN, LIFT_MAX, 0,
  ));

  // Grade based on ROI lift
  let roiMaximizationGrade: RoiMaximizationGrade;
  if (totalROILift >= 25) roiMaximizationGrade = 'A+';
  else if (totalROILift >= 18) roiMaximizationGrade = 'A';
  else if (totalROILift >= 12) roiMaximizationGrade = 'B';
  else if (totalROILift >= 7) roiMaximizationGrade = 'C';
  else if (totalROILift >= 3) roiMaximizationGrade = 'D';
  else roiMaximizationGrade = 'F';

  // Total additional profit = sum (expectedProfitAtMaxROI - currentProfit)
  const totalAdditionalProfit = round0(clampNum(
    detItems.reduce((s, d) => {
      const currentProfit = (d.item.currentROI / 100) * d.cost;
      return s + (d.item.expectedProfitAtMaxROI - currentProfit);
    }, 0),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  return {
    currentPortfolioROI,
    maximizedPortfolioROI,
    totalROILift,
    roiMaximizationGrade,
    totalAdditionalProfit,
  };
}

function buildSummary(
  detItems: DetRoiItem[],
  portfolio: PortfolioRoiMaximization,
): string {
  const parts: string[] = [
    `${detItems.length} held item-ov.`,
    `Portfolio ROI: ${portfolio.currentPortfolioROI}% → ${portfolio.maximizedPortfolioROI}% (+${portfolio.totalROILift}% lift).`,
    `Grade: ${portfolio.roiMaximizationGrade}.`,
    `Additional profit: ${portfolio.totalAdditionalProfit}€.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Prompt builder + AI response transform (čisti helperji) ------------

interface PromptData {
  heldItemsCount: number;
  heldItems: Array<{
    tradeId: string;
    title: string;
    category: string;
    buyPrice: number;
    estValue: number;
    cost: number;
    detCurrentROI: number;
    detMaximizedROI: number;
    detRoiGap: number;
    detRoiCategory: RoiCategory;
    detStrategy: RoiMaximizationStrategy;
    detExpectedProfitAtMaxROI: number;
    detTimeToMaxROI: number;
  }>;
  deterministicPortfolio: PortfolioRoiMaximization;
  caps: {
    roiMin: number; roiMax: number;
    liftMin: number; liftMax: number;
    profitMin: number; profitMax: number;
    daysMin: number; daysMax: number;
  };
}

function buildPrompt(detItems: DetRoiItem[], portfolio: PortfolioRoiMaximization): string {
  const topItemsForAI = [...detItems]
    .sort((a, b) => b.item.roiGap - a.item.roiGap)
    .slice(0, 40)
    .map((d) => ({
      tradeId: d.item.tradeId,
      title: d.item.title,
      category: d.item.category,
      buyPrice: d.item.buyPrice,
      estValue: d.estValue,
      cost: d.cost,
      detCurrentROI: d.item.currentROI,
      detMaximizedROI: d.item.maximizedROI,
      detRoiGap: d.item.roiGap,
      detRoiCategory: d.item.roiCategory,
      detStrategy: d.item.roiMaximizationStrategy,
      detExpectedProfitAtMaxROI: d.item.expectedProfitAtMaxROI,
      detTimeToMaxROI: d.item.timeToMaxROI,
    }));

  const promptData: PromptData = {
    heldItemsCount: detItems.length,
    heldItems: topItemsForAI,
    deterministicPortfolio: portfolio,
    caps: {
      roiMin: ROI_MIN, roiMax: ROI_MAX,
      liftMin: LIFT_MIN, liftMax: LIFT_MAX,
      profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
      daysMin: DAYS_MIN, daysMax: DAYS_MAX,
    },
  };

  return `Si AI "Inventory ROI Maximizer Pro" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za ROI MAXIMIZATION per held item — identificiraš kako MAXIMIZIRATI ROI % za vsak held item z absolutno best strategy. Razlika od inventory-roi-optimizer (v7.79 ki optimira ROI z rebalance) — ti MAXIMIZIRAŠ ROI z 6 strategies per item. Razlika od inventory-profit-maximizer (ki maksimizira profit) — ti maksimiziraš ROI % (ne € profit). Razlika od capital-growth-maximizer (v7.99 ki maksimizira capital growth) — ti maksimiziraš per-item ROI. Razlika od deal-profit-accelerator-pro (v7.99 ki accelera profit) — ti maksimiziraš ROI % (ne profit acceleration €).

DETERMINISTIČNI PODATKI (izračunano iz DB — HELD trgovin z linked Listing):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. items: za vsak tradeId iz heldItems (top 40), daj:
   - tradeId (string, MORA match-at enega iz heldItems — anti-hallucination),
   - roiMaximizationStrategy: HOLD_AND_WAIT | SELL_NOW_AT_PREMIUM | DISCOUNT_FOR_VOLUME | CROSS_PLATFORM_PREMIUM | BUNDLE_FOR_UPSELL | REFURB_FOR_PREMIUM (lahko se razlikuje od detStrategy),
   - maximizedROI % [−50, 300] (≥ detCurrentROI, ≤ detCurrentROI × 1.8 ali detCurrentROI + 25 — anti-hallucination),
   - implementationActions: 3-5 akcij (max 200 znakov vsak, slovenski),
   - timeToMaxROI dni [1, 365] (koliko dni da dosežeš maximizedROI),
   - riskToMaxROI (max 200, slovenski — glavni risk pri doseganju max ROI).
   Ostali field-i (currentROI, roiGap, roiCategory, roiLift, expectedProfitAtMaxROI) se avtomatsko izračunajo v backendu.
2. portfolio.roiMaximizationGrade: A+ | A | B | C | D | F (A+ če totalROILift ≥ 25, F če < 3),
3. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "items": [
    {
      "tradeId": "ckxxxxx",
      "roiMaximizationStrategy": "CROSS_PLATFORM_PREMIUM",
      "maximizedROI": 42,
      "implementationActions": ["Cross-post na Vinted.", "Prilagodi ceno per platformi.", "Dodaj SEO keywords."],
      "timeToMaxROI": 14,
      "riskToMaxROI": "Risk: cross-platform fees. Mitigiraj z 2-3 platformami max."
    }
  ],
  "portfolio": { "roiMaximizationGrade": "A" },
  "summary": "12 held item-ov. Portfolio ROI: 24% → 41% (+17% lift). Grade A. Additional profit: 425€."
}${GROUNDING_PROMPT_SUFFIX}`;
}

interface AiTransformResult {
  items: RoiMaximizationItem[];
  portfolio: PortfolioRoiMaximization;
  summary: string;
}

function transformAiResponse(
  parsed: unknown,
  detItems: DetRoiItem[],
  detByTradeId: Map<string, DetRoiItem>,
): AiTransformResult | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const ai = parsed as AiResponse;

  const aiItemsMap = new Map<string, NonNullable<AiResponse['items']>[number]>();
  if (Array.isArray(ai.items)) {
    for (const it of ai.items) {
      if (it && typeof it === 'object' && typeof it.tradeId === 'string') {
        aiItemsMap.set(it.tradeId, it);
      }
    }
  }

  const aiItems: RoiMaximizationItem[] = [];
  for (const d of detItems) {
    const a = aiItemsMap.get(d.item.tradeId);
    if (!a) {
      aiItems.push(d.item);
      continue;
    }

    const strategy = clampEnum(
      a.roiMaximizationStrategy,
      VALID_STRATEGY,
      d.item.roiMaximizationStrategy,
    );

    // Anti-hallucination: maximizedROI ∈ [currentROI, currentROI × 1.8 OR currentROI + 25]
    const maxROIBound = Math.min(
      ROI_MAX,
      Math.max(
        d.item.currentROI * MAX_ROI_UPGRADE_MULT,
        d.item.currentROI + MAX_ROI_UPGRADE_ADD,
      ),
    );
    const aiMaxROI = clampNum(
      a.maximizedROI,
      ROI_MIN, ROI_MAX,
      d.item.maximizedROI,
    );
    const maximizedROI = round2(
      Math.max(d.item.currentROI, Math.min(maxROIBound, aiMaxROI)),
    );

    const roiGap = round2(clampNum(
      maximizedROI - d.item.currentROI,
      LIFT_MIN, LIFT_MAX, 0,
    ));

    const roiLift = roiGap;

    // Recompute expected profit at max ROI based on cost
    const expectedProfitAtMaxROI = round0(clampNum(
      (maximizedROI / 100) * d.cost,
      PROFIT_MIN, Math.min(PROFIT_MAX, d.estValue * MAX_PROFIT_BASIS), 0,
    ));

    // Implementation actions (3-5 strings)
    const implementationActions: string[] = [];
    if (Array.isArray(a.implementationActions)) {
      for (const s of a.implementationActions.slice(0, MAX_ACTIONS_PER_ITEM)) {
        if (typeof s !== 'string') continue;
        implementationActions.push(clampString(s, 200, 'Akcija.'));
      }
    }
    if (implementationActions.length === 0) {
      for (const s of d.item.implementationActions) implementationActions.push(s);
    }
    if (implementationActions.length === 0) {
      implementationActions.push('Izvedi akcijo za ROI maximization.');
    }

    const timeToMaxROI = round0(clampNum(
      a.timeToMaxROI,
      DAYS_MIN, DAYS_MAX,
      d.item.timeToMaxROI,
    ));

    const riskToMaxROI = clampString(
      a.riskToMaxROI,
      200,
      d.item.riskToMaxROI,
    );

    aiItems.push({
      tradeId: d.item.tradeId,
      title: d.item.title,
      category: d.item.category,
      buyPrice: d.item.buyPrice,
      aiEstimatedValue: d.item.aiEstimatedValue,
      currentROI: d.item.currentROI,
      maximizedROI,
      roiGap,
      roiCategory: d.item.roiCategory,
      roiMaximizationStrategy: strategy,
      roiLift,
      expectedProfitAtMaxROI,
      implementationActions: implementationActions.slice(0, MAX_ACTIONS_PER_ITEM),
      timeToMaxROI,
      riskToMaxROI,
    });
  }

  let portfolio = buildPortfolio(
    aiItems.map((it) => {
      const det = detByTradeId.get(it.tradeId);
      return {
        item: it,
        estValue: det?.estValue ?? 0,
        cost: det?.cost ?? it.buyPrice,
      };
    }),
  );

  // Override portfolio grade if AI provided one
  if (ai.portfolio?.roiMaximizationGrade) {
    portfolio = {
      ...portfolio,
      roiMaximizationGrade: clampEnum(
        ai.portfolio.roiMaximizationGrade,
        VALID_GRADE,
        portfolio.roiMaximizationGrade,
      ),
    };
  }

  const summary = clampString(ai.summary, 400, buildSummary(
    aiItems.map((it) => {
      const det = detByTradeId.get(it.tradeId);
      return {
        item: it,
        estValue: det?.estValue ?? 0,
        cost: det?.cost ?? it.buyPrice,
      };
    }),
    portfolio,
  ));

  return { items: aiItems, portfolio, summary };
}

// --- Handler -------------------------------------------------------------

const inventoryRoiMaximizerProHandler = withAiRoute<InventoryRoiMaximizerInput>({
  endpoint: '/api/ai/inventory-roi-maximizer-pro',
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

    // 1) Query all HELD trades with their linked Listing
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        buyPrice: true,
        buyFees: true,
        category: true,
        listing: {
          select: {
            aiEstimatedValue: true,
            price: true,
            aiScore: true,
            dealScore: true,
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
          currentPortfolioROI: 0,
          maximizedPortfolioROI: 0,
          totalROILift: 0,
          roiMaximizationGrade: 'F',
          totalAdditionalProfit: 0,
        },
        summary: 'Ni HELD trgovin v inventarju — Inventory ROI Maximizer Pro ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD trgovin v inventarju — Inventory ROI Maximizer Pro ni mogoč.',
      } satisfies InventoryRoiMaximizerResponse);
    }

    // 2) Compute per-item ROI maximization metrics (deterministic baseline)
    const detItems = heldTrades.map((t) => computeRoiMaximizationItem(t));

    let items: RoiMaximizationItem[] = detItems.map((d) => d.item);
    let portfolio = buildPortfolio(detItems);
    let summary = buildSummary(detItems, portfolio);

    // 3) AI cache check (6h TTL) — key by held item ids
    const heldItemIds = heldTrades.map((t) => t.id).sort();
    const cacheKey = `inventory-roi-maximizer-pro:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<{
      items: RoiMaximizationItem[];
      portfolio: PortfolioRoiMaximization;
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
      } satisfies InventoryRoiMaximizerResponse);
    }

    // 4) Build AI prompt with grounding + call AI (try/catch z graceful fallback)
    const prompt = buildPrompt(detItems, portfolio);
    const detByTradeId = new Map<string, DetRoiItem>();
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
        '/api/ai/inventory-roi-maximizer-pro',
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
    } satisfies InventoryRoiMaximizerResponse);
  },
});

export const GET = inventoryRoiMaximizerProHandler;
export const POST = inventoryRoiMaximizerProHandler;
