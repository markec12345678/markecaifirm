// v8.01 / v8.96.4-batch4: AI Deal Profit Margin Enhancer Pro — AI ENHANCE-A profit margin
// na vsakem HELD item-u preko specifičnih FIZIČNIH/LISTING enhancement akcij
// (refurbishment, repositioning, premium packaging, better photos, improved
// descriptions, certification). Gre BEYOND pricing optimization — fokus na
// physical/listing improvements ki dejansko povečajo PERCEIVED VALUE in
// consequently margin. "Your iPhone 13 has margin 28%, but with refurbish +
// premium photos + authenticity certificate, margin could reach 47% (+19pp)."
//
// Razlika od profit-multiplier-engine (v8.00 ki multiplicira profit z 8 levers)
// — ta ENHANCE-A MARGIN per item z specifičnimi fizikalnimi akcijami (ne
// global profit multiplication). Razlika od inventory-roi-maximizer-pro (v7.99
// ki maksimizira ROI per item z abstract strategies) — ta fokusira na
// MARGIN ENHANCEMENT z enhancment ROI (marginGain / cost). Razlika od
// deal-profit-accelerator-pro (v7.99 ki accelera profit per item) — ta
// ENHANCE-A margin preko physical/listing improvements (ne time/profit
// acceleration). Razlika od deal-source-roi-maximizer (v8.00 ki maksimizira
// ROI per source) — ta daje PER-ITEM margin enhancement z enhancementROI.
// Razlika od profit-margin-maximizer (ki maksimizira margin generično) — ta
// daje 8 specifičnih enhancement akcij z ROI per enhancement investment.
// Razlika from refurb-roi-calculator (ki calc-a refurb ROI) — ta daje FULL
// margin enhancement portfolio z 8 actions.
//
// "iPhone 13: buyPrice 450€, estValue 580€, currentMargin 28%. Enhancement:
// REFURBISH (cost 25€, marginAfter 35%, +7pp, ROI 2.8, 3d, 85% success).
// REPHOTOGRAPH (cost 5€, marginAfter 32%, +4pp, ROI 8.0, 1d, 90% success).
// CERTIFY_AUTHENTICITY (cost 15€, marginAfter 33%, +5pp, ROI 3.3, 7d, 80%
// success). Portfolio: totalEnhancementCost 145€, totalMarginEnhancement
// +180€, ROI 1.24x. Quick wins: REPHOTOGRAPH (EASY, ROI 8.0), BUNDLE (EASY,
// ROI 5.2). Priority ranking: 1. PS5 REFURBISH (ROI 4.5), 2. iPhone 13
// REPHOTOGRAPH (ROI 8.0)..."
//
// GET+POST /api/ai/deal-profit-margin-enhancer-pro
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.4) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Input ----------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface MarginEnhancerInput {}

// --- Types ---------------------------------------------------------------

type EnhancementDifficulty = 'EASY' | 'MEDIUM' | 'HARD';
type EnhancementAction =
  | 'REFURBISH'
  | 'REPOSITION'
  | 'REPHOTOGRAPH'
  | 'REWRITE_DESCRIPTION'
  | 'REPRICE_PREMIUM'
  | 'BUNDLE_WITH_ACCESSORY'
  | 'CERTIFY_AUTHENTICITY'
  | 'NONE_NEEDED';

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

interface MarginEnhancementItem {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  aiEstimatedValue: number | null;
  currentMargin: number;
  marginEnhancementPotential: number;
  enhancementDifficulty: EnhancementDifficulty;
  enhancementAction: EnhancementAction;
  estimatedCost: number;
  estimatedMarginAfter: number;
  marginEnhancement: number;
  enhancementROI: number;
  timeToImplement: number;
  enhancementSteps: string[];
  successProbability: number;
}

interface EnhancementPriorityEntry {
  tradeId: string;
  title: string;
  enhancementROI: number;
  rank: number;
}

interface QuickEnhancement {
  tradeId: string;
  title: string;
  action: string;
  roi: number;
}

interface Portfolio {
  totalEnhancementCost: number;
  totalMarginEnhancement: number;
  portfolioEnhancementROI: number;
  enhancementPriority: EnhancementPriorityEntry[];
  quickEnhancements: QuickEnhancement[];
}

interface MarginEnhancerResponse {
  ok: true;
  items: MarginEnhancementItem[];
  portfolio: Portfolio;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  items?: Array<{
    tradeId?: string;
    enhancementAction?: EnhancementAction;
    estimatedCost?: number;
    estimatedMarginAfter?: number;
    timeToImplement?: number;
    enhancementSteps?: string[];
    successProbability?: number;
  }>;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;

const BUYPRICE_MIN = 0;
const BUYPRICE_MAX = 100_000;
const COST_MIN = 0;
const COST_MAX = 500; // max enhancement cost €500
const MARGIN_MIN = -50;
const MARGIN_MAX = 200; // % margin
const ROI_MIN = 0;
const ROI_MAX = 50; // max enhancementROI 50x
const DAYS_MIN = 0;
const DAYS_MAX = 365;
const PROB_MIN = 0;
const PROB_MAX = 100;
const POTENTIAL_MIN = 0;
const POTENTIAL_MAX = 100;
const FEE_PCT = 0.05; // 5% platform fee on sale

const VALID_DIFFICULTY: readonly EnhancementDifficulty[] = ['EASY', 'MEDIUM', 'HARD'];
const VALID_ACTION: readonly EnhancementAction[] = [
  'REFURBISH',
  'REPOSITION',
  'REPHOTOGRAPH',
  'REWRITE_DESCRIPTION',
  'REPRICE_PREMIUM',
  'BUNDLE_WITH_ACCESSORY',
  'CERTIFY_AUTHENTICITY',
  'NONE_NEEDED',
];

const MAX_ITEMS_TO_PROCESS = 40; // top 40 items by enhancementPotential for AI
const MAX_STEPS = 6;
const MAX_PRIORITY_ENTRIES = 10;
const MAX_QUICK_ENHANCEMENTS = 5;

// Enhancement action cost/days/success heuristics
const ACTION_PROFILES: Record<EnhancementAction, {
  defaultCost: number;
  defaultDays: number;
  defaultSuccess: number;
}> = {
  REFURBISH: { defaultCost: 25, defaultDays: 3, defaultSuccess: 85 },
  REPOSITION: { defaultCost: 10, defaultDays: 1, defaultSuccess: 70 },
  REPHOTOGRAPH: { defaultCost: 5, defaultDays: 1, defaultSuccess: 90 },
  REWRITE_DESCRIPTION: { defaultCost: 3, defaultDays: 1, defaultSuccess: 80 },
  REPRICE_PREMIUM: { defaultCost: 0, defaultDays: 0, defaultSuccess: 60 },
  BUNDLE_WITH_ACCESSORY: { defaultCost: 15, defaultDays: 2, defaultSuccess: 75 },
  CERTIFY_AUTHENTICITY: { defaultCost: 15, defaultDays: 7, defaultSuccess: 80 },
  NONE_NEEDED: { defaultCost: 0, defaultDays: 0, defaultSuccess: 100 },
};

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
  buyPrice: number;
  buyFees: number;
  cost: number;
  estValue: number;
  daysHeld: number;
  aiScore: number;
  dealScore: number;
  currentProfit: number; // estValue - cost - 5% fees
  currentMargin: number; // %
  marginMultiple: number; // estValue / cost
}

function computeHeldTrade(t: HeldTradeRow, now: number): HeldComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  if (buyPrice <= 0) return null;
  const cost = buyPrice + buyFees;
  const aiEst = t.listing?.aiEstimatedValue ?? null;
  const lp = t.listing?.price ?? null;
  let estValue: number;
  if (aiEst && aiEst > 0) {
    estValue = aiEst;
  } else if (lp && lp > 0) {
    estValue = lp;
  } else {
    estValue = buyPrice * 1.1; // assume 10% markup if no AI value
  }
  const buyMs = toMs(t.buyDate);
  const daysHeld = buyMs > 0 ? Math.max(0, Math.round((now - buyMs) / DAY_MS)) : 0;
  const currentProfit = estValue - cost - (estValue * FEE_PCT);
  const currentMargin = cost > 0 ? (currentProfit / cost) * 100 : 0;
  const marginMultiple = cost > 0 ? estValue / cost : 1;
  return {
    tradeId: t.id,
    title: t.title || 'Untitled',
    category: t.category || 'Unknown',
    buyPrice,
    buyFees,
    cost,
    estValue,
    daysHeld,
    aiScore: t.listing?.aiScore ?? 0,
    dealScore: t.listing?.dealScore ?? 0,
    currentProfit,
    currentMargin,
    marginMultiple,
  };
}

function decideDifficulty(c: HeldComputed): EnhancementDifficulty {
  // EASY: margin ≥ 1.4x in daysHeld < 21 (already profitable, easy to enhance)
  // MEDIUM: margin ≥ 1.2x in daysHeld < 60
  // HARD: margin < 1.1x ali daysHeld ≥ 90
  if (c.marginMultiple >= 1.4 && c.daysHeld < 21) return 'EASY';
  if (c.marginMultiple >= 1.2 && c.daysHeld < 60) return 'MEDIUM';
  if (c.marginMultiple < 1.1 || c.daysHeld >= 90) return 'HARD';
  return 'MEDIUM';
}

function decideEnhancementAction(c: HeldComputed): EnhancementAction {
  // Heuristics:
  // - High dealScore + daysHeld > 30 → REFURBISH (stale but valuable)
  // - High value + no auth → CERTIFY_AUTHENTICITY (luxury)
  // - Small items + margin < 1.3x → BUNDLE_WITH_ACCESSORY (boost perceived value)
  // - Default low-cost → REPHOTOGRAPH (universal)
  const cat = c.category.toLowerCase();
  const isLuxury = /watch|rolex|omega|luxury|designer|lux|gucci|prada|louis|hermes/i.test(cat) ||
                   c.estValue > 500;
  if (isLuxury) return 'CERTIFY_AUTHENTICITY';
  if (c.dealScore >= 75 && c.daysHeld > 30) return 'REFURBISH';
  if (c.estValue < 100 && c.marginMultiple < 1.3) return 'BUNDLE_WITH_ACCESSORY';
  if (c.dealScore < 50) return 'REPOSITION';
  return 'REPHOTOGRAPH';
}

function computeEnhancementItem(c: HeldComputed): MarginEnhancementItem {
  const difficulty = decideDifficulty(c);
  const action = decideEnhancementAction(c);
  const profile = ACTION_PROFILES[action];

  // Estimated cost
  let estimatedCost = profile.defaultCost;
  // Scale by item value (high-value items cost more to refurbish/certify)
  if (action === 'REFURBISH' && c.estValue > 500) estimatedCost = 50;
  if (action === 'CERTIFY_AUTHENTICITY' && c.estValue > 1000) estimatedCost = 40;
  if (action === 'BUNDLE_WITH_ACCESSORY') {
    estimatedCost = Math.max(5, Math.round(c.estValue * 0.05));
  }
  estimatedCost = round0(clampNum(estimatedCost, COST_MIN, COST_MAX, profile.defaultCost));

  // Margin enhancement potential (0-100)
  // Higher for: low current margin + high dealScore + easy difficulty
  const marginRoom = Math.max(0, 100 - Math.max(0, c.currentMargin));
  const dealScoreFactor = c.dealScore / 100;
  const difficultyFactor = difficulty === 'EASY' ? 1.0 : difficulty === 'MEDIUM' ? 0.7 : 0.4;
  const marginEnhancementPotential = round0(clampNum(
    Math.min(100, marginRoom * dealScoreFactor * difficultyFactor),
    POTENTIAL_MIN, POTENTIAL_MAX, 30,
  ));

  // Estimated margin after enhancement (pp gain based on action + potential)
  // Each action adds different % margin lift
  const actionMarginLift: Record<EnhancementAction, number> = {
    REFURBISH: 12, // +12pp
    REPOSITION: 6,
    REPHOTOGRAPH: 5,
    REWRITE_DESCRIPTION: 4,
    REPRICE_PREMIUM: 8,
    BUNDLE_WITH_ACCESSORY: 10,
    CERTIFY_AUTHENTICITY: 15,
    NONE_NEEDED: 0,
  };
  const liftFactor = marginEnhancementPotential / 100;
  const marginLift = actionMarginLift[action] * liftFactor;
  let estimatedMarginAfter = round2(clampNum(
    c.currentMargin + marginLift, MARGIN_MIN, MARGIN_MAX, c.currentMargin,
  ));

  // Anti-hallucination: estimatedMarginAfter can't exceed estValue-implied margin
  const maxPossibleMargin = (cost: number) => {
    const maxProfit = c.estValue - c.cost - (c.estValue * FEE_PCT);
    return c.cost > 0 ? (maxProfit / cost) * 100 : 0;
  };
  const capMargin = maxPossibleMargin(c.cost) + 20; // allow some uplift from enhancement itself
  estimatedMarginAfter = round2(clampNum(
    estimatedMarginAfter, MARGIN_MIN, Math.min(MARGIN_MAX, capMargin), c.currentMargin,
  ));

  const marginEnhancement = round2(clampNum(
    estimatedMarginAfter - c.currentMargin,
    MARGIN_MIN, MARGIN_MAX, 0,
  ));

  // Enhancement ROI = marginEnhancement (in €) / estimatedCost
  const marginGainEur = (marginEnhancement / 100) * c.cost;
  const enhancementROI = round2(clampNum(
    estimatedCost > 0 ? marginGainEur / estimatedCost : 0,
    ROI_MIN, ROI_MAX, 0,
  ));

  const timeToImplement = round0(clampNum(
    profile.defaultDays, DAYS_MIN, DAYS_MAX, profile.defaultDays,
  ));

  const successProbability = round0(clampNum(
    profile.defaultSuccess, PROB_MIN, PROB_MAX, profile.defaultSuccess,
  ));

  // Build enhancement steps based on action
  const enhancementSteps = buildEnhancementSteps(action, c);

  return {
    tradeId: c.tradeId,
    title: c.title,
    category: c.category,
    buyPrice: round0(clampNum(c.buyPrice, BUYPRICE_MIN, BUYPRICE_MAX, 0)),
    aiEstimatedValue: c.estValue > 0 ? round0(c.estValue) : null,
    currentMargin: round2(clampNum(c.currentMargin, MARGIN_MIN, MARGIN_MAX, 0)),
    marginEnhancementPotential,
    enhancementDifficulty: difficulty,
    enhancementAction: action,
    estimatedCost,
    estimatedMarginAfter,
    marginEnhancement,
    enhancementROI,
    timeToImplement,
    enhancementSteps,
    successProbability,
  };
}

function buildEnhancementSteps(action: EnhancementAction, c: HeldComputed): string[] {
  const stepsByAction: Record<EnhancementAction, string[]> = {
    REFURBISH: [
      'Očisti površino z mikrofibro in specialnim čistilom (15 min).',
      'Popravljaj manjše poškodbe (praski, sledovi uporabe) z restoration kit.',
      'Poliraj zaslon / display z nano-coating za premium finish.',
      'Testiraj vse funkcije in dodaj "restored / like-new" v opis.',
    ],
    REPOSITION: [
      'Spremeni naslov listing-a z bolj iskalnimi ključnimi besedami.',
      'Ciljaj drug segment kupcev (premium collector namesto budget buyer).',
      'Premakni v drugo kategorijo če je bolj relevantna.',
      'Dodaj "rare / limited edition" angle če je aplikabilno.',
    ],
    REPHOTOGRAPH: [
      'Fotografiraj v naravni svetlobi ob jutranjem soncu (10-12h).',
      'Uporabi clean bel ozadje in 3+ kote (front, side, detail).',
      'Dodaj macro shot za detajle in close-up za authenticity.',
      'Odstrani vse motnje iz ozadja — clean studio look.',
    ],
    REWRITE_DESCRIPTION: [
      'Dodaj specifikacije (model, year, dimensions, material).',
      'Poudari unique selling points in condition (mint, like-new).',
      'Dodaj urgency in scarcity (limited stock, rare find).',
      'Vključi keywords za iskanje (SEO optimization per platform).',
    ],
    REPRICE_PREMIUM: [
      'Analiziraj comparable sold listings za premium pricing.',
      'Postavi ceno 10-15% nad P50 za premium pozicioniranje.',
      'Dodaj "premium" v naslov in poudari value-add features.',
      'Implementiraj post-sale upsell (extended warranty, free shipping).',
    ],
    BUNDLE_WITH_ACCESSORY: [
      'Identificiraj komplementaren accessory v inventoriju.',
      'Ustvari bundle listing z 10-15% popustom za urgency.',
      'Poudari value savings v opisu ("save 50€ vs individual purchase").',
      'Cross-promote bundle na individual listing-ih.',
    ],
    CERTIFY_AUTHENTICITY: [
      'Priskrbi certificate of authenticity od certified dealer.',
      'Dodaj serial number verification fotografijo v listing.',
      'Vključi original receipt ali proof of purchase.',
      'Poudari "100% authentic, money-back guarantee" v opisu.',
    ],
    NONE_NEEDED: [
      'Item je že v optimalnem stanju — ni potreb po enhancement.',
      'Nadaljuj z rednim monitoringom in pricing optimization.',
    ],
  };
  const steps = stepsByAction[action] || ['Izvedi enhancement akcijo.'];
  return steps.slice(0, MAX_STEPS).map((s) => clampString(s, 200, 'Korak.'));
}

function buildPortfolio(items: MarginEnhancementItem[]): Portfolio {
  const filteredItems = items.filter((i) => i.enhancementAction !== 'NONE_NEEDED');
  const totalEnhancementCost = round0(clampNum(
    filteredItems.reduce((s, i) => s + i.estimatedCost, 0),
    COST_MIN, 100000, 0,
  ));
  const totalMarginEnhancementEur = round0(clampNum(
    filteredItems.reduce((s, i) => s + (i.marginEnhancement / 100) * i.buyPrice, 0),
    0, 100000, 0,
  ));
  const portfolioEnhancementROI = round2(clampNum(
    totalEnhancementCost > 0 ? totalMarginEnhancementEur / totalEnhancementCost : 0,
    ROI_MIN, ROI_MAX, 0,
  ));

  // Enhancement priority: items ranked by enhancementROI
  const enhancementPriority: EnhancementPriorityEntry[] = filteredItems
    .map((i) => ({
      tradeId: i.tradeId,
      title: i.title,
      enhancementROI: i.enhancementROI,
      rank: 0,
    }))
    .sort((a, b) => b.enhancementROI - a.enhancementROI)
    .slice(0, MAX_PRIORITY_ENTRIES)
    .map((e, idx) => ({ ...e, rank: idx + 1 }));

  // Quick enhancements: EASY difficulty + high ROI
  const quickEnhancements: QuickEnhancement[] = filteredItems
    .filter((i) => i.enhancementDifficulty === 'EASY')
    .sort((a, b) => b.enhancementROI - a.enhancementROI)
    .slice(0, MAX_QUICK_ENHANCEMENTS)
    .map((i) => ({
      tradeId: i.tradeId,
      title: i.title,
      action: i.enhancementAction,
      roi: i.enhancementROI,
    }));

  return {
    totalEnhancementCost,
    totalMarginEnhancement: totalMarginEnhancementEur,
    portfolioEnhancementROI,
    enhancementPriority,
    quickEnhancements,
  };
}

function buildSummary(items: MarginEnhancementItem[], portfolio: Portfolio): string {
  const enhancedCount = items.filter((i) => i.enhancementAction !== 'NONE_NEEDED').length;
  const parts: string[] = [
    `Portfolio: ${enhancedCount} items z enhancement potential.`,
    `Total cost: ${portfolio.totalEnhancementCost}€, total margin gain: ${portfolio.totalMarginEnhancement}€.`,
    `Portfolio enhancement ROI: ${portfolio.portfolioEnhancementROI}x.`,
    `Quick wins: ${portfolio.quickEnhancements.length}. Top priority ROI: ${portfolio.enhancementPriority[0]?.enhancementROI ?? 0}x.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Prompt builder -------------------------------------------------------

function buildPromptData(
  computed: HeldComputed[],
  items: MarginEnhancementItem[],
  topForPrompt: MarginEnhancementItem[],
) {
  return {
    heldCount: computed.length,
    topItems: topForPrompt.map((i) => ({
      tradeId: i.tradeId,
      title: i.title,
      category: i.category,
      buyPrice: i.buyPrice,
      aiEstimatedValue: i.aiEstimatedValue,
      currentMargin: i.currentMargin,
      marginEnhancementPotential: i.marginEnhancementPotential,
      enhancementDifficulty: i.enhancementDifficulty,
      deterministicEnhancementAction: i.enhancementAction,
      deterministicEstimatedCost: i.estimatedCost,
      deterministicMarginAfter: i.estimatedMarginAfter,
      deterministicMarginEnhancement: i.marginEnhancement,
      deterministicEnhancementROI: i.enhancementROI,
    })),
    caps: {
      costMin: COST_MIN, costMax: COST_MAX,
      marginMin: MARGIN_MIN, marginMax: MARGIN_MAX,
      roiMin: ROI_MIN, roiMax: ROI_MAX,
      daysMin: DAYS_MIN, daysMax: DAYS_MAX,
      probMin: PROB_MIN, probMax: PROB_MAX,
    },
  };
}

function buildPrompt(topForPrompt: MarginEnhancementItem[], computed: HeldComputed[]): string {
  const promptData = buildPromptData(computed, [], topForPrompt);
  return `Si AI "Deal Profit Margin Enhancer Pro" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za MARGIN ENHANCEMENT preko specifičnih FIZIČNIH in LISTING enhancement akcij. Greš BEYOND pricing optimization — fokusiraš se na physical/listing improvements ki dejansko povečajo PERCEIVED VALUE in consequently margin. Razlika od profit-multiplier-engine (v8.00 ki multiplicira profit z 8 levers) — ti ENHANCE-AŠ MARGIN per item z specifičnimi fizikalnimi akcijami. Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item z abstract strategies) — ti fokusiraš na MARGIN ENHANCEMENT z enhancment ROI (marginGain / cost). Razlika od deal-profit-accelerator-pro (v7.99 ki accelera profit per item) — ti ENHANCE-AŠ margin preko physical/listing improvements (ne time/profit acceleration).

DETERMINISTIČNI PODATKI (top ${topForPrompt.length} HELD item-ov z najvišjim enhancement potential):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. items: za vsak tradeId MORAŠ vrniti enhancement data:
   - tradeId (MORA match-at topItems — skip unknown),
   - enhancementAction: REFURBISH | REPOSITION | REPHOTOGRAPH | REWRITE_DESCRIPTION | REPRICE_PREMIUM | BUNDLE_WITH_ACCESSORY | CERTIFY_AUTHENTICITY | NONE_NEEDED,
   - estimatedCost € [0, 500] (koliko € stane enhancement — material, čas),
   - estimatedMarginAfter % [-50, 200] (MORA biti ≥ currentMargin — anti-hallucination),
   - timeToImplement dni [0, 365],
   - enhancementSteps: 3-6 stringov (max 200 vsak, slovenski — specifični koraki),
   - successProbability % [0, 100],
2. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "items": [
    { "tradeId": "abc123", "enhancementAction": "REFURBISH", "estimatedCost": 25, "estimatedMarginAfter": 35, "timeToImplement": 3, "enhancementSteps": ["Očisti površino.", "Poliraj zaslon."], "successProbability": 85 }
  ],
  "summary": "Portfolio: 8 items z enhancement potential. Total cost 145€, gain +180€, ROI 1.24x."
}${GROUNDING_PROMPT_SUFFIX}`;
}

// --- AI merge ------------------------------------------------------------

function mergeAiIntoItems(
  items: MarginEnhancementItem[],
  parsed: AiResponse | null,
): MarginEnhancementItem[] {
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
    return items;
  }

  // Build map of AI enhancements by tradeId
  const aiMap = new Map<string, NonNullable<AiResponse['items']>[number]>();
  for (const it of parsed.items) {
    if (it && typeof it === 'object' && typeof it.tradeId === 'string') {
      aiMap.set(it.tradeId, it);
    }
  }

  // Override deterministic items with AI data (anti-hallucination clamping)
  const newItems: MarginEnhancementItem[] = [];
  for (const det of items) {
    const ai = aiMap.get(det.tradeId);
    if (!ai) {
      newItems.push(det);
      continue;
    }

    const enhancementAction = clampEnum(
      ai.enhancementAction, VALID_ACTION, det.enhancementAction,
    );
    const profile = ACTION_PROFILES[enhancementAction];
    const estimatedCost = round0(clampNum(
      ai.estimatedCost, COST_MIN, COST_MAX, profile.defaultCost,
    ));
    // Anti-hallucination: estimatedMarginAfter must be ≥ currentMargin
    const minMarginAfter = det.currentMargin;
    const maxMarginAfter = Math.min(MARGIN_MAX, det.currentMargin + 50);
    const estimatedMarginAfter = round2(clampNum(
      ai.estimatedMarginAfter,
      minMarginAfter,
      maxMarginAfter,
      det.estimatedMarginAfter,
    ));
    const marginEnhancement = round2(clampNum(
      estimatedMarginAfter - det.currentMargin,
      0, MARGIN_MAX, det.marginEnhancement,
    ));
    const marginGainEur = (marginEnhancement / 100) * det.buyPrice;
    const enhancementROI = round2(clampNum(
      estimatedCost > 0 ? marginGainEur / estimatedCost : 0,
      ROI_MIN, ROI_MAX, det.enhancementROI,
    ));
    const timeToImplement = round0(clampNum(
      ai.timeToImplement, DAYS_MIN, DAYS_MAX, profile.defaultDays,
    ));
    const successProbability = round0(clampNum(
      ai.successProbability, PROB_MIN, PROB_MAX, profile.defaultSuccess,
    ));

    // Build enhancement steps if AI provided them
    let enhancementSteps = det.enhancementSteps;
    if (Array.isArray(ai.enhancementSteps) && ai.enhancementSteps.length >= 2) {
      const aiSteps: string[] = [];
      for (const s of ai.enhancementSteps.slice(0, MAX_STEPS)) {
        if (typeof s !== 'string') continue;
        aiSteps.push(clampString(s, 200, 'Korak.'));
      }
      if (aiSteps.length >= 2) {
        enhancementSteps = aiSteps;
      }
    }

    newItems.push({
      ...det,
      enhancementAction,
      estimatedCost,
      estimatedMarginAfter,
      marginEnhancement,
      enhancementROI,
      timeToImplement,
      enhancementSteps,
      successProbability,
    });
  }

  if (newItems.length === items.length) {
    return newItems;
  }
  return items;
}

// --- Handler -------------------------------------------------------------

const marginEnhancerHandler = withAiRoute<MarginEnhancerInput>({
  endpoint: '/api/ai/deal-profit-margin-enhancer-pro',
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

    // 1) Query HELD trades with linked Listing
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
        items: [],
        portfolio: {
          totalEnhancementCost: 0,
          totalMarginEnhancement: 0,
          portfolioEnhancementROI: 0,
          enhancementPriority: [],
          quickEnhancements: [],
        },
        summary: 'Ni HELD trgovin v inventarju — Deal Profit Margin Enhancer Pro ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD trgovin v inventarju — Deal Profit Margin Enhancer Pro ni mogoč.',
      } satisfies MarginEnhancerResponse);
    }

    // 2) Compute deterministic baseline per item
    const computed: HeldComputed[] = [];
    for (const t of heldTrades) {
      const c = computeHeldTrade(t, now);
      if (c) computed.push(c);
    }

    // Build deterministic items
    let items: MarginEnhancementItem[] = computed.map(computeEnhancementItem);

    // Sort by marginEnhancementPotential DESC, take top 40 for AI prompt
    items.sort((a, b) => b.marginEnhancementPotential - a.marginEnhancementPotential);
    const topForPrompt = items.slice(0, MAX_ITEMS_TO_PROCESS);

    // 3) AI cache check (6h TTL) — key by held item IDs
    const heldItemIds = computed.map((c) => c.tradeId).sort();
    const cacheKey = `deal-profit-margin-enhancer-pro:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<{
      items: MarginEnhancementItem[];
      summary: string;
    }>(cacheKey);
    if (cached) {
      const portfolio = buildPortfolio(cached.items);
      return apiOk({
        ok: true,
        items: cached.items,
        portfolio,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies MarginEnhancerResponse);
    }

    let summary = buildSummary(items, buildPortfolio(items));

    // 4) AI prompt with grounding
    const prompt = buildPrompt(topForPrompt, computed);

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
        const merged = mergeAiIntoItems(items, parsed);
        if (merged.length === items.length) {
          items = merged;
        }
        summary = clampString(parsed.summary, 400, buildSummary(items, buildPortfolio(items)));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/deal-profit-margin-enhancer-pro',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Build portfolio from final items
    const portfolio = buildPortfolio(items);

    // 6) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { items, summary });
    }

    return apiOk({
      ok: true,
      items,
      portfolio,
      summary,
      aiUsed,
    } satisfies MarginEnhancerResponse);
  },
});

export const GET = marginEnhancerHandler;
export const POST = marginEnhancerHandler;
