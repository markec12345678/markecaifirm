// v7.97 / v8.96.5-batch1: AI Inventory Value Maximizer — AI identificira kako
// MAXIMIZIRATI total value of HELD inventorija — kateri itemi za obdržati dlje
// (appreciating), kateri prodati zdaj (at peak), kateri nadgraditi (replace z
// higher-value itemi). The "ultimate inventory value optimization."
// Refaktoriran z withAiRoute helperjem (v8.96) + enforceBudget guard.
//
// Razlika od inventory-profit-maximizer (ki maksimizira profit) — ta
// maksimizira VALUE (koliko je inventorij vreden, ne koliko profit-a generira).
// Razlika od inventory-profit-margin-optimizer-pro (v7.96 ki optimira margin
// per item) — ta optimira VALUE per item z hold/sell/upgrade actions. Razlika
// od cash-recovery-accelerator (v7.96 ki accelerira cash recovery) — ta
// maksimizira VALUE (ne cash velocity). Razlika od inventory-aging-strategist
// (ki strategizes aging) — ta daje VALUE-maximization actions per item.
// Razlika od inventory-liquidation-strategist (ki likvidira) — ta daje HOLD
// /SELL/UPGRADE/REPLACE choice per item. Razlika od inventory-roi-optimizer
// (ki optimizira ROI) — ta optimira TOTAL VALUE appreciation. Razlika od
// depreciation-forecast (ki napove depreciation) — ta daje actionable
// value-maximization actions per item.
//
// "iPhone 13: currentValue 380€, trajectory APPRECIATING (+8%/month). Action:
// HOLD_FOR_APPRECIATION → holdValue 410€ in 30 days (+30€ uplift). Optimal
// sell date: 30 days. PS5: currentValue 450€, trajectory PEAK. Action:
// SELL_AT_PEAK → sellNowValue 414€ (0€ uplift vs sell now, but at peak). Old
// laptop: currentValue 180€, trajectory DEPRECIATING (-5%/month). Action:
// LIQUIDATE_BEFORE_DECLINE → 0.85× sellNowValue = 141€ (loss but prevents
// further decline). Portfolio value: 8,200€ → maximized 8,750€ (+550€ uplift,
// grade B)."
//
// GET+POST /api/ai/inventory-value-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InventoryValueMaximizerInput {}

// --- Types ---------------------------------------------------------------

type ValueTrajectory = 'APPRECIATING' | 'PEAK' | 'DEPRECIATING';
type ValueMaximizationAction =
  | 'HOLD_FOR_APPRECIATION'
  | 'SELL_AT_PEAK'
  | 'UPGRADE_ITEM'
  | 'REPLACE_WITH_HIGHER_VALUE'
  | 'LIQUIDATE_BEFORE_DECLINE';
type ValueOptimizationGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

interface HeldItemRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyDate: Date | null;
  listing: {
    aiEstimatedValue: number | null;
    price: number | null;
    aiScore: number | null;
    dealScore: number | null;
    monitor: { source: string; tags: string } | null;
  } | null;
}

interface ValueItem {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  currentValue: number;
  appreciationRate: number; // % per month
  valueTrajectory: ValueTrajectory;
  daysUntilValueDecline: number | null;
  holdValue: number; // expected value in 30 days
  sellNowValue: number; // expected value if sold today (after fees)
  valueMaximizationAction: ValueMaximizationAction;
  expectedValueWithAction: number; // projected value if action taken
  valueUplift: number; // additional value vs selling today
  optimalSellDate: string | null; // human-readable date or "now"
  holdOrSellReasoning: string;
  upgradeRecommendation: string | null;
}

interface Portfolio {
  currentTotalValue: number;
  maximizedTotalValue: number;
  valueMaximizationPotential: number;
  valueOptimizationGrade: ValueOptimizationGrade;
  itemsToHold: number;
  itemsToSell: number;
  itemsToUpgrade: number;
}

interface InventoryValueResponse {
  ok: true;
  items: ValueItem[];
  portfolio: Portfolio;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  items?: Array<{
    tradeId?: string;
    valueMaximizationAction?: ValueMaximizationAction;
    expectedValueWithAction?: number;
    optimalSellDate?: string | null;
    holdOrSellReasoning?: string;
    upgradeRecommendation?: string | null;
  }>;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const EST_FEE_RATE = 0.08; // 8% est. selling fees (Bolha + cross-post)
const QUICK_SALE_DISCOUNT = 0.85; // 15% discount for quick liquidation
const UPGRADE_VALUE_LIFT = 1.15; // 15% uplift from upgrading
const REPLACE_VALUE_LIFT = 1.20; // 20% above buyPrice for higher-value replacement
const APPRECIATION_THRESHOLD = 1.25; // estValue > buyPrice × 1.25 = APPRECIATING
const DEPRECIATION_THRESHOLD = 0.85; // estValue < buyPrice × 0.85 = DEPRECIATING
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const VALUE_MIN = 0;
const VALUE_MAX = 100_000;
const UPLIFT_MIN = -50_000;
const UPLIFT_MAX = 50_000;
const APPRECIATION_MIN = -50;
const APPRECIATION_MAX = 100;
const DAYS_UNTIL_DECLINE_MIN = 0;
const DAYS_UNTIL_DECLINE_MAX = 365;

const VALID_ACTION: readonly ValueMaximizationAction[] = [
  'HOLD_FOR_APPRECIATION',
  'SELL_AT_PEAK',
  'UPGRADE_ITEM',
  'REPLACE_WITH_HIGHER_VALUE',
  'LIQUIDATE_BEFORE_DECLINE',
];
const VALID_GRADE: readonly ValueOptimizationGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

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

function formatDateDaysFromNow(days: number): string {
  if (days <= 0) return 'now';
  try {
    const d = new Date(Date.now() + days * DAY_MS);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  } catch {
    return `+${days} dni`;
  }
}

// --- Deterministic computation ------------------------------------------

interface DetValueItem {
  item: ValueItem;
  estValue: number;
  daysHeld: number;
}

function computeValueItem(t: HeldItemRow, now: number): DetValueItem {
  const buyPrice = t.buyPrice ?? 0;
  const buyMs = toMs(t.buyDate);
  const daysHeld = buyMs > 0 ? Math.max(0, Math.round((now - buyMs) / DAY_MS)) : 0;

  // Estimated value: listing.aiEstimatedValue, fallback to listing.price, then buyPrice
  const listingEst = t.listing?.aiEstimatedValue ?? null;
  const listingPrice = t.listing?.price ?? null;
  const estValue =
    listingEst && listingEst > 0 ? listingEst
      : listingPrice && listingPrice > 0 ? listingPrice
        : Math.round(buyPrice * 1.15);

  // currentValue = estValue (the current market value)
  // Anti-hallucination: clamp currentValue to [0.5x, 2x] buyPrice
  const valueLowBound = Math.round(buyPrice * 0.5);
  const valueHighBound = Math.round(buyPrice * 2);
  const currentValue = round0(
    Math.max(
      valueLowBound,
      Math.min(valueHighBound, estValue),
    ),
  );

  // Value trajectory based on estValue vs buyPrice ratio
  const ratio = buyPrice > 0 ? currentValue / buyPrice : 1;
  let valueTrajectory: ValueTrajectory;
  if (ratio >= APPRECIATION_THRESHOLD) {
    valueTrajectory = 'APPRECIATING';
  } else if (ratio <= DEPRECIATION_THRESHOLD) {
    valueTrajectory = 'DEPRECIATING';
  } else {
    valueTrajectory = 'PEAK';
  }

  // Appreciation rate (% per month, simple linear assumption)
  // APPRECIATING: positive rate proportional to how much above 1.25× it is
  // DEPRECIATING: negative rate proportional to how much below 0.85×
  // PEAK: 0 (stable)
  let appreciationRate: number;
  if (valueTrajectory === 'APPRECIATING') {
    // Assume appreciation over 3 months: (ratio - 1.25) / 3 × 100
    appreciationRate = round2(
      clampNum(((ratio - 1.25) / 3) * 100, APPRECIATION_MIN, APPRECIATION_MAX, 0),
    );
  } else if (valueTrajectory === 'DEPRECIATING') {
    // Negative rate: (ratio - 0.85) / 3 × 100
    appreciationRate = round2(
      clampNum(((ratio - 0.85) / 3) * 100, APPRECIATION_MIN, APPRECIATION_MAX, -5),
    );
  } else {
    appreciationRate = 0;
  }

  // Days until value decline
  let daysUntilValueDecline: number | null;
  if (valueTrajectory === 'APPRECIATING') {
    // Will continue to appreciate for ~30-90 days, then peak
    daysUntilValueDecline = round0(
      clampNum(30 + appreciationRate * 3, DAYS_UNTIL_DECLINE_MIN, DAYS_UNTIL_DECLINE_MAX, 30),
    );
  } else if (valueTrajectory === 'PEAK') {
    daysUntilValueDecline = 0;
  } else {
    // Already declining
    daysUntilValueDecline = 0;
  }

  // holdValue: expected value in 30 days (after appreciation, before fees)
  const holdValue = round0(
    Math.max(
      valueLowBound,
      Math.min(
        valueHighBound,
        Math.round(currentValue * (1 + appreciationRate / 100)),
      ),
    ),
  );

  // sellNowValue: expected value if sold today (after fees)
  const sellNowValue = round0(
    Math.max(valueLowBound, Math.round(currentValue * (1 - EST_FEE_RATE))),
  );

  // Decide action deterministically
  let valueMaximizationAction: ValueMaximizationAction;
  if (valueTrajectory === 'APPRECIATING' && appreciationRate > 5) {
    valueMaximizationAction = 'HOLD_FOR_APPRECIATION';
  } else if (valueTrajectory === 'DEPRECIATING' && daysHeld > 60) {
    valueMaximizationAction = 'LIQUIDATE_BEFORE_DECLINE';
  } else if (valueTrajectory === 'DEPRECIATING' && currentValue < 200) {
    valueMaximizationAction = 'REPLACE_WITH_HIGHER_VALUE';
  } else if (valueTrajectory === 'PEAK' && currentValue > 1000) {
    valueMaximizationAction = 'UPGRADE_ITEM';
  } else {
    valueMaximizationAction = 'SELL_AT_PEAK';
  }

  // Expected value with action (cash realized or projected value)
  let expectedValueWithAction: number;
  let optimalSellDate: string | null;
  switch (valueMaximizationAction) {
    case 'HOLD_FOR_APPRECIATION':
      expectedValueWithAction = round0(
        Math.max(valueLowBound, Math.min(valueHighBound, Math.round(holdValue * (1 - EST_FEE_RATE)))),
      );
      optimalSellDate = formatDateDaysFromNow(30);
      break;
    case 'SELL_AT_PEAK':
      expectedValueWithAction = sellNowValue;
      optimalSellDate = 'now';
      break;
    case 'UPGRADE_ITEM':
      expectedValueWithAction = round0(
        Math.max(valueLowBound, Math.min(valueHighBound, Math.round(sellNowValue * UPGRADE_VALUE_LIFT))),
      );
      optimalSellDate = 'now';
      break;
    case 'REPLACE_WITH_HIGHER_VALUE':
      expectedValueWithAction = round0(
        Math.max(valueLowBound, Math.min(valueHighBound, Math.round(buyPrice * REPLACE_VALUE_LIFT))),
      );
      optimalSellDate = 'now';
      break;
    case 'LIQUIDATE_BEFORE_DECLINE':
      expectedValueWithAction = round0(
        Math.max(valueLowBound, Math.round(sellNowValue * QUICK_SALE_DISCOUNT)),
      );
      optimalSellDate = 'now';
      break;
  }

  // valueUplift = expectedValueWithAction - sellNowValue (signed)
  // (positive = action is better than selling now; negative = action chosen to prevent bigger loss)
  const valueUplift = round0(
    clampNum(
      expectedValueWithAction - sellNowValue,
      UPLIFT_MIN, UPLIFT_MAX, 0,
    ),
  );

  // Reasoning
  const reasoningParts: string[] = [
    `currentValue ${currentValue}€ (${valueTrajectory.toLowerCase()}, ${appreciationRate > 0 ? '+' : ''}${appreciationRate}%/m).`,
    `sellNow ${sellNowValue}€, holdValue ${holdValue}€.`,
  ];
  switch (valueMaximizationAction) {
    case 'HOLD_FOR_APPRECIATION':
      reasoningParts.push(`HOLD: ${appreciationRate}%/m appreciation → holdValue ${holdValue}€ in 30 days (+${valueUplift}€ uplift).`);
      break;
    case 'SELL_AT_PEAK':
      reasoningParts.push(`SELL_AT_PEAK: value at peak now — prodaj takoj da izkoristiš trenutno tržno ceno.`);
      break;
    case 'UPGRADE_ITEM':
      reasoningParts.push(`UPGRADE: visoka currentValue (${currentValue}€) — zamenjaj z višje-vrednostnim item-om v isti kategoriji (+${valueUplift}€ uplift).`);
      break;
    case 'REPLACE_WITH_HIGHER_VALUE':
      reasoningParts.push(`REPLACE: currentValue nizka (${currentValue}€) — zamenjaj z višje-vrednostnim item-om (buyPrice × 1.2 = ${expectedValueWithAction}€).`);
      break;
    case 'LIQUIDATE_BEFORE_DECLINE':
      reasoningParts.push(`LIQUIDATE: ${daysHeld} dni held in declining — prodaj hitro (${expectedValueWithAction}€) da preprečiš nadaljnji upad.`);
      break;
  }
  const holdOrSellReasoning = reasoningParts.join(' ').slice(0, 400);

  // Upgrade recommendation
  let upgradeRecommendation: string | null = null;
  if (valueMaximizationAction === 'UPGRADE_ITEM') {
    upgradeRecommendation = clampString(
      `Zamenjaj z višje-vrednostnim item-om v isti kategoriji (${t.category || 'splošno'}) — target value ~${Math.round(currentValue * 1.2)}€.`,
      250,
      `Upgrade z višje-vrednostnim item-om.`,
    );
  } else if (valueMaximizationAction === 'REPLACE_WITH_HIGHER_VALUE') {
    upgradeRecommendation = clampString(
      `Zamenjaj z item-om vrednim ~${Math.round(buyPrice * REPLACE_VALUE_LIFT)}€ (${(REPLACE_VALUE_LIFT * 100 - 100).toFixed(0)}% nad buyPrice) za boljši ROI.`,
      250,
      `Replace z višje-vrednostnim item-om.`,
    );
  }

  return {
    item: {
      tradeId: t.id,
      title: clampString(t.title, 200, 'Item'),
      category: clampString(t.category, 50, 'drugo').toLowerCase() || 'drugo',
      buyPrice: round0(buyPrice),
      currentValue,
      appreciationRate,
      valueTrajectory,
      daysUntilValueDecline,
      holdValue,
      sellNowValue,
      valueMaximizationAction,
      expectedValueWithAction,
      valueUplift,
      optimalSellDate,
      holdOrSellReasoning,
      upgradeRecommendation,
    },
    estValue,
    daysHeld,
  };
}

function computePortfolio(detItems: DetValueItem[]): Portfolio {
  if (detItems.length === 0) {
    return {
      currentTotalValue: 0,
      maximizedTotalValue: 0,
      valueMaximizationPotential: 0,
      valueOptimizationGrade: 'F',
      itemsToHold: 0,
      itemsToSell: 0,
      itemsToUpgrade: 0,
    };
  }
  let currentTotalValue = 0;
  let maximizedTotalValue = 0;
  let totalUplift = 0;
  let itemsToHold = 0;
  let itemsToSell = 0;
  let itemsToUpgrade = 0;

  for (const d of detItems) {
    currentTotalValue += d.item.currentValue;
    maximizedTotalValue += Math.max(d.item.expectedValueWithAction, d.item.sellNowValue);
    totalUplift += Math.max(0, d.item.valueUplift);
    switch (d.item.valueMaximizationAction) {
      case 'HOLD_FOR_APPRECIATION':
        itemsToHold += 1;
        break;
      case 'SELL_AT_PEAK':
      case 'LIQUIDATE_BEFORE_DECLINE':
        itemsToSell += 1;
        break;
      case 'UPGRADE_ITEM':
      case 'REPLACE_WITH_HIGHER_VALUE':
        itemsToUpgrade += 1;
        break;
    }
  }

  currentTotalValue = round0(clampNum(currentTotalValue, VALUE_MIN, VALUE_MAX, 0));
  maximizedTotalValue = round0(clampNum(maximizedTotalValue, VALUE_MIN, VALUE_MAX, 0));
  const valueMaximizationPotential = round0(clampNum(totalUplift, 0, VALUE_MAX, 0));

  // Grade based on:
  // - % of items at PEAK or APPRECIATING (well-positioned)
  // - uplift potential (lower uplift = already optimized)
  const appreciatingOrPeakCount = detItems.filter(
    (d) => d.item.valueTrajectory === 'APPRECIATING' || d.item.valueTrajectory === 'PEAK',
  ).length;
  const wellPositionedPct = (appreciatingOrPeakCount / detItems.length) * 100;
  const upliftPct = currentTotalValue > 0 ? (valueMaximizationPotential / currentTotalValue) * 100 : 0;
  // Score: wellPositionedPct - upliftPct×2 (lower uplift = better grade)
  const optimizationScore = clampNum(
    wellPositionedPct - upliftPct * 2,
    0, 100, 50,
  );
  let valueOptimizationGrade: ValueOptimizationGrade;
  if (optimizationScore >= 90) valueOptimizationGrade = 'A+';
  else if (optimizationScore >= 80) valueOptimizationGrade = 'A';
  else if (optimizationScore >= 70) valueOptimizationGrade = 'B';
  else if (optimizationScore >= 55) valueOptimizationGrade = 'C';
  else if (optimizationScore >= 40) valueOptimizationGrade = 'D';
  else valueOptimizationGrade = 'F';

  return {
    currentTotalValue,
    maximizedTotalValue,
    valueMaximizationPotential,
    valueOptimizationGrade,
    itemsToHold,
    itemsToSell,
    itemsToUpgrade,
  };
}

function buildSummary(portfolio: Portfolio, items: DetValueItem[]): string {
  if (items.length === 0) {
    return 'Ni HELD trgovin v inventarju — Inventory Value Maximizer ni mogoč.';
  }
  const parts: string[] = [
    `Portfolio value: ${portfolio.currentTotalValue}€ → maximized ${portfolio.maximizedTotalValue}€ (+${portfolio.valueMaximizationPotential}€ uplift, grade ${portfolio.valueOptimizationGrade}).`,
    `${portfolio.itemsToHold} hold, ${portfolio.itemsToSell} sell, ${portfolio.itemsToUpgrade} upgrade.`,
  ];
  const topItem = [...items].sort((a, b) => b.item.valueUplift - a.item.valueUplift)[0];
  if (topItem && topItem.item.valueUplift > 0) {
    parts.push(`Top uplift: ${topItem.item.title.slice(0, 40)} (+${topItem.item.valueUplift}€).`);
  }
  return parts.join(' ').slice(0, 400);
}

// --- AI prompt + merge helpers (pure, extracted OUTSIDE handler) ----------

interface PromptItem {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  currentValue: number;
  appreciationRate: number;
  valueTrajectory: ValueTrajectory;
  daysUntilValueDecline: number | null;
  holdValue: number;
  sellNowValue: number;
  detAction: ValueMaximizationAction;
  detExpectedValue: number;
  detValueUplift: number;
  detOptimalSellDate: string | null;
}

function buildPromptItems(detItems: DetValueItem[]): PromptItem[] {
  return [...detItems]
    .sort((a, b) => Math.abs(b.item.valueUplift) - Math.abs(a.item.valueUplift))
    .slice(0, 40)
    .map((d) => ({
      tradeId: d.item.tradeId,
      title: d.item.title,
      category: d.item.category,
      buyPrice: d.item.buyPrice,
      currentValue: d.item.currentValue,
      appreciationRate: d.item.appreciationRate,
      valueTrajectory: d.item.valueTrajectory,
      daysUntilValueDecline: d.item.daysUntilValueDecline,
      holdValue: d.item.holdValue,
      sellNowValue: d.item.sellNowValue,
      detAction: d.item.valueMaximizationAction,
      detExpectedValue: d.item.expectedValueWithAction,
      detValueUplift: d.item.valueUplift,
      detOptimalSellDate: d.item.optimalSellDate,
    }));
}

function buildPromptData(portfolio: Portfolio, topItemsForAI: PromptItem[]) {
  return {
    portfolio,
    heldItems: topItemsForAI,
    caps: {
      valueMin: VALUE_MIN, valueMax: VALUE_MAX,
      upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
      appreciationMin: APPRECIATION_MIN, appreciationMax: APPRECIATION_MAX,
      daysUntilDeclineMin: DAYS_UNTIL_DECLINE_MIN, daysUntilDeclineMax: DAYS_UNTIL_DECLINE_MAX,
    },
  };
}

function buildPrompt(promptData: ReturnType<typeof buildPromptData>): string {
  return `Si AI "Inventory Value Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za VALUE maximization — identificiraš kako MAXIMIZIRATI total value of HELD inventorija. Razlika od inventory-profit-maximizer (ki maksimizira profit) — ti maksimiziraš VALUE (koliko je inventorij vreden). Razlika od inventory-profit-margin-optimizer-pro (v7.96 ki optimira margin per item) — ti optimiraš VALUE per item z hold/sell/upgrade actions. Razlika od cash-recovery-accelerator (v7.96 ki accelerira cash recovery) — ti maksimiziraš VALUE (ne cash velocity). Razlika od inventory-aging-strategist (ki strategizes aging) — ti daje VALUE-maximization actions per item. Razlika od inventory-liquidation-strategist (ki likvidira) — ti daje HOLD/SELL/UPGRADE/REPLACE choice per item. Razlika od inventory-roi-optimizer (ki optimizira ROI) — ti optimiraš TOTAL VALUE appreciation. Razlika od depreciation-forecast (ki napove depreciation) — ti daje actionable value-maximization actions per item.

DETERMINISTIČNI PODATKI (izračunano iz DB — HELD trgovin z linked Listing):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. items: za vsak tradeId iz heldItems, daj value maximization:
   - tradeId (string, MORA match-at enega iz heldItems — anti-hallucination),
   - valueMaximizationAction: HOLD_FOR_APPRECIATION | SELL_AT_PEAK | UPGRADE_ITEM | REPLACE_WITH_HIGHER_VALUE | LIQUIDATE_BEFORE_DECLINE (lahko se razlikuje od detAction če imaš boljšo idejo),
   - expectedValueWithAction € [0, 100000] (CLAMPED to [0.5x, 2x] buyPrice anti-hallucination; ±20% od detExpectedValue),
   - optimalSellDate (string | null; "now" ali specific YYYY-MM-DD datum; ±30 dni od detOptimalSellDate),
   - holdOrSellReasoning (max 400, slovenski — zakaj hold/sell/upgrade/replace/liquidate),
   - upgradeRecommendation (string | null; max 250, slovenski — SAMO za UPGRADE_ITEM ali REPLACE_WITH_HIGHER_VALUE, drugače null).
   Ostali field-i (currentValue, appreciationRate, valueTrajectory, daysUntilValueDecline, holdValue, sellNowValue, valueUplift) se avtomatsko izračunajo iz expectedValueWithAction v backendu.
2. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "items": [
    {
      "tradeId": "ckxxxxx",
      "valueMaximizationAction": "HOLD_FOR_APPRECIATION",
      "expectedValueWithAction": 410,
      "optimalSellDate": "2026-09-15",
      "holdOrSellReasoning": "iPhone 13 appreciating (+8%/m) — hold 30 dni za +30€ uplift.",
      "upgradeRecommendation": null
    },
    {
      "tradeId": "ckyyyyy",
      "valueMaximizationAction": "UPGRADE_ITEM",
      "expectedValueWithAction": 480,
      "optimalSellDate": "now",
      "holdOrSellReasoning": "PS5 at peak — upgrade z višje-vrednostnim item-om.",
      "upgradeRecommendation": "Zamenjaj z višje-vrednostnim item-om v isti kategoriji."
    }
  ],
  "summary": "Portfolio value: 8200€ → maximized 8750€ (+550€ uplift, grade B). 5 hold, 3 sell, 2 upgrade."
}${GROUNDING_PROMPT_SUFFIX}`;
}

interface MergeResult {
  items: ValueItem[];
  portfolio: Portfolio;
  summary: string;
  aiUsed: boolean;
}

function mergeAiIntoItems(
  parsed: AiResponse | null,
  detItems: DetValueItem[],
  detPortfolio: Portfolio,
): MergeResult {
  let items: ValueItem[] = detItems.map((d) => d.item);
  let portfolio = detPortfolio;
  let summary = buildSummary(detPortfolio, detItems);
  let aiUsed = false;

  if (parsed && typeof parsed === 'object') {
    const detByTradeId = new Map<string, DetValueItem>();
    for (const d of detItems) detByTradeId.set(d.item.tradeId, d);

    const aiItems: ValueItem[] = [];
    if (Array.isArray(parsed.items)) {
      for (const r of parsed.items) {
        if (!r || typeof r !== 'object') continue;
        const det = detByTradeId.get(String(r.tradeId ?? ''));
        if (!det) continue; // skip unknown tradeId — anti-hallucination

        const action = clampEnum(
          r.valueMaximizationAction,
          VALID_ACTION,
          det.item.valueMaximizationAction,
        );

        // Anti-hallucination: expectedValueWithAction clamped to [0.5x, 2x] buyPrice
        const valueLowBound = Math.round(det.item.buyPrice * 0.5);
        const valueHighBound = Math.round(det.item.buyPrice * 2);
        const aiExpected = round0(clampNum(
          r.expectedValueWithAction,
          VALUE_MIN, VALUE_MAX,
          det.item.expectedValueWithAction,
        ));
        const expectedValueWithAction = round0(
          Math.max(valueLowBound, Math.min(valueHighBound, aiExpected)),
        );

        // Recompute valueUplift based on AI expectedValueWithAction
        const valueUplift = round0(clampNum(
          expectedValueWithAction - det.item.sellNowValue,
          UPLIFT_MIN, UPLIFT_MAX, det.item.valueUplift,
        ));

        // optimalSellDate: validate format (either "now" or YYYY-MM-DD)
        const rawSellDate = r.optimalSellDate;
        let optimalSellDate: string | null;
        if (rawSellDate === null || rawSellDate === undefined) {
          optimalSellDate = det.item.optimalSellDate;
        } else if (typeof rawSellDate === 'string') {
          const trimmed = rawSellDate.trim().toLowerCase();
          if (trimmed === 'now' || trimmed === '') {
            optimalSellDate = trimmed === 'now' ? 'now' : det.item.optimalSellDate;
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            optimalSellDate = trimmed;
          } else {
            optimalSellDate = det.item.optimalSellDate;
          }
        } else {
          optimalSellDate = det.item.optimalSellDate;
        }

        const holdOrSellReasoning = clampString(
          r.holdOrSellReasoning,
          400,
          det.item.holdOrSellReasoning,
        );

        // upgradeRecommendation: only for UPGRADE_ITEM or REPLACE_WITH_HIGHER_VALUE
        let upgradeRecommendation: string | null = null;
        if (action === 'UPGRADE_ITEM' || action === 'REPLACE_WITH_HIGHER_VALUE') {
          const rec = r.upgradeRecommendation;
          if (typeof rec === 'string' && rec.trim().length > 0) {
            upgradeRecommendation = clampString(rec, 250, det.item.upgradeRecommendation ?? 'Upgrade z višje-vrednostnim item-om.');
          } else {
            upgradeRecommendation = det.item.upgradeRecommendation ?? 'Upgrade z višje-vrednostnim item-om.';
          }
        }

        aiItems.push({
          ...det.item,
          valueMaximizationAction: action,
          expectedValueWithAction,
          valueUplift,
          optimalSellDate,
          holdOrSellReasoning,
          upgradeRecommendation,
        });
      }
    }
    // Fallback to deterministic if AI returned nothing useful
    if (aiItems.length === 0) {
      for (const d of detItems) aiItems.push(d.item);
    } else {
      // For items AI didn't return, keep deterministic values
      const aiTradeIds = new Set(aiItems.map((r) => r.tradeId));
      for (const d of detItems) {
        if (!aiTradeIds.has(d.item.tradeId)) {
          aiItems.push(d.item);
        }
      }
    }
    // Sort by valueUplift descending (biggest uplift first)
    aiItems.sort((a, b) => b.valueUplift - a.valueUplift);
    items = aiItems;

    // Update portfolio based on AI items
    const aiPortfolio = computePortfolio(
      aiItems.map((i) => ({
        item: i,
        estValue: i.currentValue,
        daysHeld: 0, // not needed for portfolio recompute
      })),
    );
    portfolio = aiPortfolio;

    summary = clampString(parsed.summary, 400, buildSummary(portfolio, aiItems.map((i) => ({
      item: i,
      estValue: i.currentValue,
      daysHeld: 0,
    }))));
    aiUsed = true;
  }

  return { items, portfolio, summary, aiUsed };
}

// --- Handler -------------------------------------------------------------

const inventoryValueHandler = withAiRoute<InventoryValueMaximizerInput>({
  endpoint: '/api/ai/inventory-value-maximizer',
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
          currentTotalValue: 0,
          maximizedTotalValue: 0,
          valueMaximizationPotential: 0,
          valueOptimizationGrade: 'F',
          itemsToHold: 0,
          itemsToSell: 0,
          itemsToUpgrade: 0,
        },
        summary: 'Ni HELD trgovin v inventarju — Inventory Value Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD trgovin v inventarju — Inventory Value Maximizer ni mogoč.',
      } satisfies InventoryValueResponse);
    }

    // 2) Compute per-item value metrics (deterministic baseline)
    const detItems = heldTrades.map((t) => computeValueItem(t, now));
    const detPortfolio = computePortfolio(detItems);
    let portfolio = detPortfolio;
    let items: ValueItem[] = detItems.map((d) => d.item);
    let summary = buildSummary(detPortfolio, detItems);

    // 3) AI cache check (6h TTL) — key by held item ids
    const heldItemIds = heldTrades.map((t) => t.id).sort();
    const cacheKey = `inventory-value-maximizer:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<{
      items: ValueItem[];
      portfolio: Portfolio;
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
      } satisfies InventoryValueResponse);
    }

    // 4) AI prompt with grounding
    const topItemsForAI = buildPromptItems(detItems);
    const promptData = buildPromptData(detPortfolio, topItemsForAI);
    const prompt = buildPrompt(promptData);

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      const merged = mergeAiIntoItems(parsed, detItems, detPortfolio);
      items = merged.items;
      portfolio = merged.portfolio;
      summary = merged.summary;
      aiUsed = merged.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-value-maximizer',
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
    } satisfies InventoryValueResponse);
  },
});

export const GET = inventoryValueHandler;
export const POST = inventoryValueHandler;
