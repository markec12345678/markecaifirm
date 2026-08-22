// v8.03 / v8.96.6-batch2: AI Inventory Yield Maximizer — AI MAXIMIZIRA YIELD (profit as % of
// capital deployed) na HELD inventory. Kot financial yield optimizer — kateri
// items dajejo najboljši yield in kako izboljšati yield čez portfolio.
// "iPhone 13: capitalDeployed 450€, estValue 580€, currentYield 28.9%,
// annualizedYield 421% (held 25d), yieldScore 78/100, action HOLD_FOR_YIELD.
// PS5: capitalDeployed 500€, estValue 540€, currentYield 8%, annualizedYield
// 48% (held 60d), yieldScore 35/100, action SELL_FOR_YIELD. Old TV: yield
// -5%, action REPRICE_FOR_YIELD." Razlika od inventory-capital-efficiency-
// maximizer (v8.01 ki maksimizira capital efficiency per item z reallocation)
// — ta MAXIMIZIRA YIELD % (profit / capital deployed) z annualized view in
// yieldGrade (A+ to F). Razlika od inventory-roi-maximizer-pro (v7.99 ki
// maksimizira ROI per item) — ta maksimizira YIELD z annualizedYield in
// optimalHoldTime. Razlika od deal-profit-margin-enhancer-pro (v8.01 ki
// enhanca margin per item) — ta maksimizira YIELD (ne margin) z yieldUplift.
// Razlika od inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily
// profit) — ta daje PER-ITEM yield analizo z annualizedYield. Razlika od
// profit-horizon-maximizer (v8.03 ki maksimizira profit per horizon) — ta
// fokusira na PER-ITEM yield maximization z yieldGrade in yieldRanking.
// Razlika od inventory-capital-allocator (ki alokira capital) — ta daje
// YIELD ANALYSIS z optimalHoldTime in yieldOptimizationActions. Razlika od
// profit-multiplier-engine (v8.00 ki multiplicira profit z 8 levers) — ta
// fokusira na YIELD % per item z annualized projection.
//
// "Current: 8,500€ deployed, portfolio yield 22%, annualized yield 145%,
// grade B. Item analysis: iPhone 13 yield 28.9% (annualized 421%, score 78),
// PS5 yield 8% (annualized 48%, score 35), TV yield -5% (annualized -28%,
// score 12). Maximization: HOLD_FOR_YIELD iPhone (potential 35% yield in 14d),
// SELL_FOR_YIELD PS5 (locked yield at 8% - liquidate), REPRICE_FOR_YIELD TV
// (+10% repricing for yield). Portfolio: 22% → 32% (+10pp uplift), grade B→A.
// Yield ranking: iPhone (1), PS5 (2), TV (3)."

// GET+POST /api/ai/inventory-yield-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.6) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Input ----------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InventoryYieldMaximizerInput {}

// --- Types ---------------------------------------------------------------

type YieldGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
type YieldMaximizationAction =
  | 'HOLD_FOR_YIELD'
  | 'SELL_FOR_YIELD'
  | 'REPRICE_FOR_YIELD'
  | 'BUNDLE_FOR_YIELD'
  | 'UPGRADE_FOR_YIELD';

interface HeldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  listing: {
    aiEstimatedValue: number | null;
    price: number | null;
    aiScore: number | null;
    dealScore: number | null;
  } | null;
}

interface CurrentState {
  totalCapitalDeployed: number;
  portfolioCurrentYield: number; // %
  portfolioAnnualizedYield: number; // %
  avgHoldDays: number;
}

interface PerItemYield {
  tradeId: string;
  title: string;
  category: string;
  capitalDeployed: number;
  estValue: number;
  currentYield: number; // %
  annualizedYield: number; // %
  yieldScore: number; // 0-100
  daysHeld: number;
}

interface ItemMaximization {
  yieldMaximizationAction: YieldMaximizationAction;
  maximizedYield: number; // %
  yieldUplift: number; // pp
  optimalHoldTime: number; // days
  yieldOptimizationActions: string[];
}

interface ItemEntry {
  tradeId: string;
  title: string;
  category: string;
  capitalDeployed: number;
  estValue: number;
  currentYield: number;
  annualizedYield: number;
  yieldScore: number;
  daysHeld: number;
  maximization: ItemMaximization;
}

interface PortfolioSummary {
  currentPortfolioYield: number;
  maximizedPortfolioYield: number;
  totalYieldUplift: number;
  yieldGrade: YieldGrade;
  yieldRanking: Array<{
    tradeId: string;
    title: string;
    currentYield: number;
    maximizedYield: number;
    rank: number;
  }>;
}

interface InventoryYieldResponse {
  ok: true;
  current: CurrentState;
  perItem: ItemEntry[];
  portfolio: PortfolioSummary;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  perItem?: Array<{
    tradeId?: string;
    maximization?: {
      yieldMaximizationAction?: YieldMaximizationAction;
      maximizedYield?: number;
      optimalHoldTime?: number;
      yieldOptimizationActions?: string[];
    };
  }>;
  portfolio?: {
    yieldGrade?: YieldGrade;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;

const CAPITAL_MIN = 0;
const CAPITAL_MAX = 100_000;
const YIELD_MIN = -50;
const YIELD_MAX = 500; // annualized yield up to 500%
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const DAYS_MIN = 0;
const DAYS_MAX = 730;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 50;
const FEE_PCT = 0.05;
const MIN_DAYS_FOR_ANNUALIZE = 1; // Avoid div by 0

const VALID_GRADE: readonly YieldGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_ACTION: readonly YieldMaximizationAction[] = [
  'HOLD_FOR_YIELD',
  'SELL_FOR_YIELD',
  'REPRICE_FOR_YIELD',
  'BUNDLE_FOR_YIELD',
  'UPGRADE_FOR_YIELD',
];

const MAX_ITEMS_TO_PROCESS = 40;
const MAX_ACTIONS_PER_ITEM = 5;

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

interface HeldComputed {
  tradeId: string;
  title: string;
  category: string;
  capitalDeployed: number;
  estValue: number;
  daysHeld: number;
  currentYield: number; // (estValue - cost - fees) / cost * 100
  annualizedYield: number;
}

function computeHeldTrade(t: HeldTradeRow, now: number): HeldComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  if (buyPrice <= 0) return null;
  const capitalDeployed = buyPrice + buyFees;
  const aiEst = t.listing?.aiEstimatedValue ?? null;
  const lp = t.listing?.price ?? null;
  let estValue: number;
  if (aiEst && aiEst > 0) {
    estValue = aiEst;
  } else if (lp && lp > 0) {
    estValue = lp;
  } else {
    estValue = buyPrice * 1.1;
  }
  const buyMs = toMs(t.buyDate);
  const daysHeld = buyMs > 0
    ? Math.max(0, Math.round((now - buyMs) / DAY_MS))
    : 0;
  const profit = estValue - capitalDeployed - (estValue * FEE_PCT);
  const currentYield = capitalDeployed > 0
    ? (profit / capitalDeployed) * 100
    : 0;
  // Annualized yield = currentYield * 365 / max(daysHeld, 1)
  // But cap to prevent ridiculous numbers for very short holds
  const annualizeBase = Math.max(MIN_DAYS_FOR_ANNUALIZE, daysHeld);
  const annualizedYield = currentYield * (365 / annualizeBase);
  return {
    tradeId: t.id,
    title: t.title || 'Untitled',
    category: t.category || 'Unknown',
    capitalDeployed,
    estValue,
    daysHeld,
    currentYield,
    annualizedYield,
  };
}

// Yield score 0-100:
// 60% annualizedYield normalized (capped at 200% → 100 points)
// 25% currentYield (capped at 50% → 25 points)
// 15% speed bonus (low daysHeld = bonus)
function computeYieldScore(c: HeldComputed): number {
  const annYieldNorm = clampNum(
    Math.min(100, Math.max(0, c.annualizedYield * 0.5)),
    SCORE_MIN, SCORE_MAX, 0,
  );
  const currentYieldNorm = clampNum(
    Math.min(50, Math.max(0, c.currentYield * 1)),
    SCORE_MIN, SCORE_MAX, 0,
  );
  // Speed bonus: items held <30 days get bonus (fresh = better yield potential)
  const speedBonus = c.daysHeld < 30
    ? clampNum(15 - c.daysHeld * 0.5, 0, 15, 0)
    : clampNum(Math.max(0, 15 - (c.daysHeld - 30) * 0.05), 0, 15, 0);
  // Weighted score (normalized to 0-100):
  // 60% annualizedYield (annYieldNorm is already 0-100)
  // 25% currentYield (currentYieldNorm is 0-50, scale × 2 to get 0-100 contribution)
  // 15% speedBonus (0-15, scale × (100/15) to get 0-100 contribution)
  const normalized = annYieldNorm * 0.6 + (currentYieldNorm * 2) * 0.25 + speedBonus * (100 / 15) * 0.15;
  return round0(clampNum(normalized, SCORE_MIN, SCORE_MAX, 50));
}

function computePerItem(c: HeldComputed): PerItemYield {
  const yieldScore = computeYieldScore(c);
  return {
    tradeId: c.tradeId,
    title: c.title,
    category: c.category,
    capitalDeployed: round0(clampNum(c.capitalDeployed, CAPITAL_MIN, CAPITAL_MAX, 0)),
    estValue: round0(clampNum(c.estValue, CAPITAL_MIN, CAPITAL_MAX, 0)),
    currentYield: round2(clampNum(c.currentYield, YIELD_MIN, YIELD_MAX, 0)),
    annualizedYield: round2(clampNum(c.annualizedYield, YIELD_MIN, YIELD_MAX, 0)),
    yieldScore,
    daysHeld: round0(clampNum(c.daysHeld, DAYS_MIN, DAYS_MAX, 0)),
  };
}

function computeCurrent(perItem: PerItemYield[]): CurrentState {
  const totalCapitalDeployed = round0(clampNum(
    perItem.reduce((s, i) => s + i.capitalDeployed, 0),
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));
  // Portfolio current yield = weighted avg by capitalDeployed
  const portfolioCurrentYield = totalCapitalDeployed > 0
    ? round2(clampNum(
      perItem.reduce((s, i) => s + i.currentYield * i.capitalDeployed, 0) / totalCapitalDeployed,
      YIELD_MIN, YIELD_MAX, 0,
    ))
    : 0;
  const portfolioAnnualizedYield = totalCapitalDeployed > 0
    ? round2(clampNum(
      perItem.reduce((s, i) => s + i.annualizedYield * i.capitalDeployed, 0) / totalCapitalDeployed,
      YIELD_MIN, YIELD_MAX, 0,
    ))
    : 0;
  const avgHoldDays = perItem.length > 0
    ? round0(clampNum(
      perItem.reduce((s, i) => s + i.daysHeld, 0) / perItem.length,
      DAYS_MIN, DAYS_MAX, 0,
    ))
    : 0;
  return {
    totalCapitalDeployed,
    portfolioCurrentYield,
    portfolioAnnualizedYield,
    avgHoldDays,
  };
}

function decideYieldAction(item: PerItemYield): YieldMaximizationAction {
  // SELL_FOR_YIELD: negative yield OR low yield after long hold
  if (item.currentYield < 0) {
    return 'SELL_FOR_YIELD';
  }
  if (item.currentYield < 5 && item.daysHeld > 60) {
    return 'SELL_FOR_YIELD';
  }
  // REPRICE_FOR_YIELD: low yield but mid-range hold
  if (item.currentYield < 10 && item.daysHeld > 14) {
    return 'REPRICE_FOR_YIELD';
  }
  // UPGRADE_FOR_YIELD: high value items with mid yield → refurb/enhance
  if (item.capitalDeployed > 200 && item.currentYield < 25 && item.yieldScore < 60) {
    return 'UPGRADE_FOR_YIELD';
  }
  // BUNDLE_FOR_YIELD: low-value items with low yield → bundle for higher combined yield
  if (item.capitalDeployed < 100 && item.currentYield < 20) {
    return 'BUNDLE_FOR_YIELD';
  }
  // HOLD_FOR_YIELD: high yield + good score → keep holding
  return 'HOLD_FOR_YIELD';
}

function buildItemMaximization(item: PerItemYield): ItemMaximization {
  const action = decideYieldAction(item);

  // Max yield depends on action
  // HOLD_FOR_YIELD: yield grows with time (annualized compounding)
  // SELL_FOR_YIELD: lock current yield (no further yield potential)
  // REPRICE_FOR_YIELD: +10-20% from repricing
  // BUNDLE_FOR_YIELD: +15-30% from bundle premium
  // UPGRADE_FOR_YIELD: +20-40% from refurbishment/enhancement
  let yieldUplift = 0;
  let optimalHoldTime = item.daysHeld;

  switch (action) {
    case 'HOLD_FOR_YIELD': {
      // Continue holding — yield grows proportionally with annualization
      // Max yield potential = current yield + (annualized yield - current yield) × 0.3
      const growthPotential = Math.max(0, item.annualizedYield - item.currentYield) * 0.3;
      yieldUplift = round2(clampNum(
        Math.min(growthPotential, item.currentYield * 0.5 + 5),
        UPLIFT_MIN, UPLIFT_MAX, 0,
      ));
      // Optimal hold time: items reach peak yield at ~30-60 days
      optimalHoldTime = Math.max(item.daysHeld, Math.min(45, item.daysHeld + 14));
      break;
    }
    case 'SELL_FOR_YIELD': {
      // Lock current yield — no uplift (already at peak achievable)
      yieldUplift = 0;
      optimalHoldTime = 0; // sell immediately
      break;
    }
    case 'REPRICE_FOR_YIELD': {
      // +5-15pp from repricing
      yieldUplift = round2(clampNum(
        Math.min(15, Math.max(5, (10 - item.currentYield) * 0.5 + 5)),
        UPLIFT_MIN, UPLIFT_MAX, 5,
      ));
      optimalHoldTime = Math.max(7, item.daysHeld); // give 7d for new price to convert
      break;
    }
    case 'BUNDLE_FOR_YIELD': {
      // +10-25pp from bundle premium
      yieldUplift = round2(clampNum(
        Math.min(25, Math.max(10, (25 - item.currentYield) * 0.4 + 10)),
        UPLIFT_MIN, UPLIFT_MAX, 10,
      ));
      optimalHoldTime = Math.max(14, item.daysHeld); // time to find bundle buyer
      break;
    }
    case 'UPGRADE_FOR_YIELD': {
      // +15-35pp from refurb/enhancement
      yieldUplift = round2(clampNum(
        Math.min(35, Math.max(15, (35 - item.currentYield) * 0.5 + 15)),
        UPLIFT_MIN, UPLIFT_MAX, 15,
      ));
      optimalHoldTime = Math.max(21, item.daysHeld); // time for refurb + sale
      break;
    }
  }

  // Anti-hallucination: uplift can't exceed 50% of current yield (or 25pp for low-yield)
  if (item.currentYield > 0) {
    yieldUplift = round2(Math.min(yieldUplift, Math.max(8, item.currentYield * 0.6)));
  } else {
    yieldUplift = round2(Math.min(yieldUplift, 25));
  }

  const maximizedYield = round2(clampNum(
    Math.max(item.currentYield, item.currentYield + yieldUplift),
    YIELD_MIN, YIELD_MAX, item.currentYield,
  ));

  // Optimization actions per type
  const actionsByType: Record<YieldMaximizationAction, string[]> = {
    HOLD_FOR_YIELD: [
      `HOLD ${item.title} še ${optimalHoldTime - item.daysHeld} dni za yield growth iz ${item.currentYield}% na ${maximizedYield}%.`,
      'Spremljaj market price trend — če pade pod buy price, takoj prodaj.',
      'Cross-post na 3 platforme za širši buyer pool (hitrejši yield realization).',
      'Optimiziraj listing (boljše fotografije, SEO opis) za premium pricing.',
    ],
    SELL_FOR_YIELD: [
      `PRODAJ ${item.title} takoj — yield ${item.currentYield}% je locked, nadaljnje držanje zmanjša yield.`,
      'Postavi -10% discount za hitro prodajo in sprostitev kapitala.',
      'Cross-post na vse platforme z urgency CTA.',
      'Reinvestiraj sproščen kapital v višje-yield priložnosti.',
    ],
    REPRICE_FOR_YIELD: [
      `REPRICE ${item.title} za +${round0(yieldUplift * item.capitalDeployed / 100)}€ (+${yieldUplift}pp yield).`,
      `Postavi novo ceno ${round0(item.estValue * 1.05)}€ (premium positioning, +5% od estValue).`,
      'Dodaj premium fotografije in certifikat (če aplikabilno) za utemeljitev cene.',
      'Testiraj novo ceno 7 dni — če ni konverzije, apliciraj -5% discount.',
    ],
    BUNDLE_FOR_YIELD: [
      `BUNDLE ${item.title} z accessori ali komplementarnim item-om za +${yieldUplift}pp yield.`,
      'Postavi bundle price 15% nad sum individual prices (premium bundle pricing).',
      'Cross-sell z drugim held item-om iz komplementarne kategorije.',
      'Marketiraj bundle kot "complete set" za višji perceived value.',
    ],
    UPGRADE_FOR_YIELD: [
      `UPGRADE ${item.title} z refurbishment/enhancement za +${yieldUplift}pp yield.`,
      'Clean/refurbish item (cost ~5-10% buyPrice) za premium positioning.',
      'Dodaj certifikat avtentičnosti (če aplikabilno — luxury/electronics).',
      'Reinvestiraj refurb cost in postavi novo ceno +20% (premium tier).',
    ],
  };

  return {
    yieldMaximizationAction: action,
    maximizedYield,
    yieldUplift,
    optimalHoldTime: round0(clampNum(optimalHoldTime, 0, DAYS_MAX, item.daysHeld)),
    yieldOptimizationActions: actionsByType[action].slice(0, MAX_ACTIONS_PER_ITEM),
  };
}

function buildItemEntries(computed: HeldComputed[]): ItemEntry[] {
  const entries: ItemEntry[] = [];
  for (const c of computed) {
    const item = computePerItem(c);
    const maximization = buildItemMaximization(item);
    entries.push({
      ...item,
      maximization,
    });
  }
  return entries;
}

function decideGrade(
  portfolioYield: number,
  portfolioAnnualizedYield: number,
): YieldGrade {
  // A+ if annualized yield ≥ 200% AND portfolio yield ≥ 30%
  // A if annualized ≥ 150% AND yield ≥ 25%
  // B if annualized ≥ 100% AND yield ≥ 20%
  // C if annualized ≥ 60% AND yield ≥ 15%
  // D if annualized ≥ 30% AND yield ≥ 10%
  // else F
  if (portfolioAnnualizedYield >= 200 && portfolioYield >= 30) return 'A+';
  if (portfolioAnnualizedYield >= 150 && portfolioYield >= 25) return 'A';
  if (portfolioAnnualizedYield >= 100 && portfolioYield >= 20) return 'B';
  if (portfolioAnnualizedYield >= 60 && portfolioYield >= 15) return 'C';
  if (portfolioAnnualizedYield >= 30 && portfolioYield >= 10) return 'D';
  return 'F';
}

function buildPortfolio(
  entries: ItemEntry[],
  current: CurrentState,
): PortfolioSummary {
  const totalCapital = current.totalCapitalDeployed;
  const currentPortfolioYield = current.portfolioCurrentYield;
  // Maximized portfolio yield = weighted avg of maximizedYield
  const maximizedPortfolioYield = totalCapital > 0
    ? round2(clampNum(
      entries.reduce((s, e) => s + e.maximization.maximizedYield * e.capitalDeployed, 0) / totalCapital,
      YIELD_MIN, YIELD_MAX, 0,
    ))
    : 0;
  const totalYieldUplift = round2(clampNum(
    maximizedPortfolioYield - currentPortfolioYield,
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  // Use current portfolio annualized yield for grade decision
  const yieldGrade = decideGrade(currentPortfolioYield, current.portfolioAnnualizedYield);

  // Yield ranking by maximizedYield
  const yieldRanking = entries
    .map((e, idx) => ({
      tradeId: e.tradeId,
      title: e.title,
      currentYield: e.currentYield,
      maximizedYield: e.maximization.maximizedYield,
      rank: idx + 1,
    }))
    .sort((a, b) => b.maximizedYield - a.maximizedYield)
    .map((r, idx) => ({ ...r, rank: idx + 1 }));

  return {
    currentPortfolioYield,
    maximizedPortfolioYield,
    totalYieldUplift,
    yieldGrade,
    yieldRanking,
  };
}

function buildSummary(
  current: CurrentState,
  portfolio: PortfolioSummary,
  entriesCount: number,
): string {
  const parts: string[] = [
    `${entriesCount} items, ${current.totalCapitalDeployed}€ deployed.`,
    `Portfolio yield: ${current.portfolioCurrentYield}% (annualized ${current.portfolioAnnualizedYield}%) → ${portfolio.maximizedPortfolioYield}% (+${portfolio.totalYieldUplift}pp uplift).`,
    `Grade: ${portfolio.yieldGrade}.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- AI prompt + merge helpers (pure, testable) ---------------------------

interface PromptData {
  heldCount: number;
  current: CurrentState;
  topItems: Array<{
    tradeId: string;
    title: string;
    category: string;
    capitalDeployed: number;
    estValue: number;
    currentYield: number;
    annualizedYield: number;
    yieldScore: number;
    daysHeld: number;
    deterministicMaximization: {
      yieldMaximizationAction: YieldMaximizationAction;
      maximizedYield: number;
      yieldUplift: number;
      optimalHoldTime: number;
    };
  }>;
  deterministicPortfolio: {
    currentPortfolioYield: number;
    maximizedPortfolioYield: number;
    totalYieldUplift: number;
    yieldGrade: YieldGrade;
  };
  caps: Record<string, number>;
}

function buildPromptData(
  heldCount: number,
  current: CurrentState,
  topForPrompt: ItemEntry[],
  portfolio: PortfolioSummary,
): PromptData {
  return {
    heldCount,
    current,
    topItems: topForPrompt.map((i) => ({
      tradeId: i.tradeId,
      title: i.title,
      category: i.category,
      capitalDeployed: i.capitalDeployed,
      estValue: i.estValue,
      currentYield: i.currentYield,
      annualizedYield: i.annualizedYield,
      yieldScore: i.yieldScore,
      daysHeld: i.daysHeld,
      deterministicMaximization: {
        yieldMaximizationAction: i.maximization.yieldMaximizationAction,
        maximizedYield: i.maximization.maximizedYield,
        yieldUplift: i.maximization.yieldUplift,
        optimalHoldTime: i.maximization.optimalHoldTime,
      },
    })),
    deterministicPortfolio: {
      currentPortfolioYield: portfolio.currentPortfolioYield,
      maximizedPortfolioYield: portfolio.maximizedPortfolioYield,
      totalYieldUplift: portfolio.totalYieldUplift,
      yieldGrade: portfolio.yieldGrade,
    },
    caps: {
      capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
      yieldMin: YIELD_MIN, yieldMax: YIELD_MAX,
      scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
      daysMin: DAYS_MIN, daysMax: DAYS_MAX,
      upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
    },
  };
}

function buildPrompt(promptData: PromptData, topCount: number): string {
  return `Si AI "Inventory Yield Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za YIELD MAXIMIZATION — kako maksimizirati YIELD (profit as % of capital deployed) na HELD inventory. Kot financial yield optimizer — identificiraš kateri items dajejo najboljši yield in kako izboljšati yield čez portfolio. Razlika od inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital efficiency per item z reallocation) — ti MAKSIMIZIRAŠ YIELD % (profit / capital deployed) z annualizedYield in yieldGrade (A+ to F). Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item) — ti maksimiziraš YIELD z annualizedYield in optimalHoldTime. Razlika od deal-profit-margin-enhancer-pro (v8.01 ki enhanca margin per item) — ti maksimiziraš YIELD (ne margin) z yieldUplift. Razlika od inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily profit) — ti daje PER-ITEM yield analizo z annualizedYield. Razlika od profit-horizon-maximizer (v8.03 ki maksimizira profit per horizon) — ti fokusiraš na PER-ITEM yield maximization z yieldGrade in yieldRanking. Razlika od inventory-capital-allocator (ki alokira capital) — ti daje YIELD ANALYSIS z optimalHoldTime in yieldOptimizationActions. Razlika od profit-multiplier-engine (v8.00 ki multiplicira profit z 8 levers) — ti fokusiraš na YIELD % per item z annualized projection.

DETERMINISTIČNI PODATKI (top ${topCount} HELD item-ov z najnižjim yield score):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. perItem: za vsak item iz topItems, daj:
   - tradeId (string, MORA match-at enega iz topItems — anti-hallucination),
   - maximization.yieldMaximizationAction: HOLD_FOR_YIELD | SELL_FOR_YIELD | REPRICE_FOR_YIELD | BUNDLE_FOR_YIELD | UPGRADE_FOR_YIELD (lahko se razlikuje od deterministic),
   - maximization.maximizedYield % [-50, 500] (≥ currentYield, ≤ currentYield × 1.6 ali +35pp absolute — anti-hallucination),
   - maximization.optimalHoldTime dni [0, 730],
   - maximization.yieldOptimizationActions: 3-5 stringov (max 200 vsak, slovenski — specifične akcije za maksimiranje yield-a za ta item),
2. portfolio.yieldGrade: A+ | A | B | C | D | F (A+ če annualized ≥ 200% AND yield ≥ 30%, A ≥ 150/25, B ≥ 100/20, C ≥ 60/15, D ≥ 30/10, else F),
3. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "perItem": [
    {
      "tradeId": "abc123",
      "maximization": {
        "yieldMaximizationAction": "HOLD_FOR_YIELD",
        "maximizedYield": 35,
        "optimalHoldTime": 14,
        "yieldOptimizationActions": [
          "HOLD iPhone 13 še 14 dni za yield growth iz 28.9% na 35%.",
          "Cross-post na 3 platforme za širši buyer pool."
        ]
      }
    }
  ],
  "portfolio": {
    "yieldGrade": "B"
  },
  "summary": "8 items, 8500€ deployed. Portfolio yield: 22% (annualized 145%) → 32% (+10pp uplift). Grade B."
}${GROUNDING_PROMPT_SUFFIX}`;
}

function mergeAiResponse(
  parsed: AiResponse | null,
  detEntries: ItemEntry[],
  current: CurrentState,
): { entries: ItemEntry[]; portfolio: PortfolioSummary; summary: string; aiUsed: boolean } {
  if (!parsed || typeof parsed !== 'object') {
    const detPortfolio = buildPortfolio(detEntries, current);
    return {
      entries: detEntries,
      portfolio: detPortfolio,
      summary: buildSummary(current, detPortfolio, detEntries.length),
      aiUsed: false,
    };
  }

  let entries = detEntries;
  const validIds = new Set(detEntries.map((e) => e.tradeId));
  const aiMap = new Map<string, NonNullable<AiResponse['perItem']>[number]>();
  if (Array.isArray(parsed.perItem)) {
    for (const ai of parsed.perItem) {
      if (ai && typeof ai === 'object' && typeof ai.tradeId === 'string') {
        aiMap.set(ai.tradeId, ai);
      }
    }
  }

  const newEntries: ItemEntry[] = [];
  for (const det of detEntries) {
    const ai = aiMap.get(det.tradeId);
    if (!ai || !ai.maximization) {
      newEntries.push(det);
      continue;
    }

    const aiMax = ai.maximization;
    const action = clampEnum(
      aiMax.yieldMaximizationAction,
      VALID_ACTION,
      det.maximization.yieldMaximizationAction,
    );

    // Anti-hallucination: maximizedYield ∈ [currentYield, currentYield × 1.6 or +35pp]
    const maxYieldBound = Math.min(
      YIELD_MAX,
      Math.max(
        det.currentYield + 5,
        Math.min(det.currentYield * 1.6 + 15, det.currentYield + 35),
      ),
    );
    const maximizedYield = round2(clampNum(
      aiMax.maximizedYield,
      det.currentYield, maxYieldBound,
      det.maximization.maximizedYield,
    ));
    const yieldUplift = round2(clampNum(
      maximizedYield - det.currentYield,
      UPLIFT_MIN, UPLIFT_MAX, 0,
    ));

    const optimalHoldTime = round0(clampNum(
      aiMax.optimalHoldTime,
      0, DAYS_MAX, det.maximization.optimalHoldTime,
    ));

    // Optimization actions
    let yieldOptimizationActions: string[] = det.maximization.yieldOptimizationActions;
    if (Array.isArray(aiMax.yieldOptimizationActions) &&
        aiMax.yieldOptimizationActions.length >= 2) {
      const aiActions = aiMax.yieldOptimizationActions
        .slice(0, MAX_ACTIONS_PER_ITEM)
        .map((a) => clampString(a, 200, 'Optimiziraj yield.'))
        .filter((s) => s.length > 0);
      if (aiActions.length >= 2) {
        yieldOptimizationActions = aiActions;
      }
    }

    newEntries.push({
      ...det,
      maximization: {
        yieldMaximizationAction: action,
        maximizedYield,
        yieldUplift,
        optimalHoldTime,
        yieldOptimizationActions,
      },
    });
  }

  // Anti-hallucination: skip AI entries with unknown tradeIds
  const filtered = newEntries.filter((e) => validIds.has(e.tradeId));
  if (filtered.length === detEntries.length) {
    entries = newEntries;
  }

  // Rebuild portfolio with new entries
  let portfolio = buildPortfolio(entries, current);

  // Override yieldGrade if AI provided
  if (parsed.portfolio?.yieldGrade) {
    portfolio = {
      ...portfolio,
      yieldGrade: clampEnum(
        parsed.portfolio.yieldGrade,
        VALID_GRADE,
        portfolio.yieldGrade,
      ),
    };
  }

  const summary = clampString(parsed.summary, 400, buildSummary(current, portfolio, entries.length));
  return { entries, portfolio, summary, aiUsed: true };
}

// --- Handler -------------------------------------------------------------

const inventoryYieldMaximizerHandler = withAiRoute<InventoryYieldMaximizerInput>({
  endpoint: '/api/ai/inventory-yield-maximizer',
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

    // 1) Query HELD trades with linked Listing (for aiEstimatedValue, price)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
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
    }) as unknown as HeldTradeRow[];

    // Empty-state: no HELD trades
    if (heldTrades.length === 0) {
      return apiOk({
        ok: true,
        current: {
          totalCapitalDeployed: 0,
          portfolioCurrentYield: 0,
          portfolioAnnualizedYield: 0,
          avgHoldDays: 0,
        },
        perItem: [],
        portfolio: {
          currentPortfolioYield: 0,
          maximizedPortfolioYield: 0,
          totalYieldUplift: 0,
          yieldGrade: 'F',
          yieldRanking: [],
        },
        summary: 'Ni HELD trgovin v inventarju — Inventory Yield Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD trgovin v inventarju — Inventory Yield Maximizer ni mogoč.',
      } satisfies InventoryYieldResponse);
    }

    // 2) Compute aggregates
    const heldComputed: HeldComputed[] = [];
    for (const t of heldTrades) {
      const c = computeHeldTrade(t, now);
      if (c) heldComputed.push(c);
    }

    if (heldComputed.length === 0) {
      return apiOk({
        ok: true,
        current: {
          totalCapitalDeployed: 0,
          portfolioCurrentYield: 0,
          portfolioAnnualizedYield: 0,
          avgHoldDays: 0,
        },
        perItem: [],
        portfolio: {
          currentPortfolioYield: 0,
          maximizedPortfolioYield: 0,
          totalYieldUplift: 0,
          yieldGrade: 'F',
          yieldRanking: [],
        },
        summary: 'Ni veljavnih HELD trgovin — Inventory Yield Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih HELD trgovin — Inventory Yield Maximizer ni mogoč.',
      } satisfies InventoryYieldResponse);
    }

    let entries = buildItemEntries(heldComputed);
    const current = computeCurrent(entries.map((e) => ({
      tradeId: e.tradeId,
      title: e.title,
      category: e.category,
      capitalDeployed: e.capitalDeployed,
      estValue: e.estValue,
      currentYield: e.currentYield,
      annualizedYield: e.annualizedYield,
      yieldScore: e.yieldScore,
      daysHeld: e.daysHeld,
    })));
    let portfolio = buildPortfolio(entries, current);
    let summary = buildSummary(current, portfolio, entries.length);

    // 3) AI cache check (6h TTL) — key by held item IDs
    const heldItemIds = heldComputed.map((c) => c.tradeId).sort();
    const cacheKey = `inventory-yield-maximizer:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<{
      perItem: ItemEntry[];
      portfolio: PortfolioSummary;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        current,
        perItem: cached.perItem,
        portfolio: cached.portfolio,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies InventoryYieldResponse);
    }

    // 4) AI prompt with grounding
    // Sort entries by yieldScore ASC (worst first) for AI prompt
    const sortedEntries = [...entries].sort((a, b) => a.yieldScore - b.yieldScore);
    const topForPrompt = sortedEntries.slice(0, MAX_ITEMS_TO_PROCESS);

    const promptData = buildPromptData(heldComputed.length, current, topForPrompt, portfolio);
    const prompt = buildPrompt(promptData, topForPrompt.length);

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      const result = mergeAiResponse(parsed, entries, current);
      entries = result.entries;
      portfolio = result.portfolio;
      summary = result.summary;
      aiUsed = result.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-yield-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { perItem: entries, portfolio, summary });
    }

    return apiOk({
      ok: true,
      current,
      perItem: entries,
      portfolio,
      summary,
      aiUsed,
    } satisfies InventoryYieldResponse);
  },
});

export const GET = inventoryYieldMaximizerHandler;
export const POST = inventoryYieldMaximizerHandler;
