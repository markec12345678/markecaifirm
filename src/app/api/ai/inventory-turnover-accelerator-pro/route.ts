// v7.85: AI Inventory Turnover Accelerator Pro — AI-powered PRO verzija ki
// identificira SPECIFIČNE akcije za pospešitev inventory turnover-a — ne
// samo "turn faster" ampak natančno kateri item-i, kakšno akcijo in
// pričakovane dni prihranjene. "PS5: 28d held, avg 22d → PRICE_DROP_5%,
// save 7d, sell by Sep 5. Priority: HIGH."
//
// Razlika od inventory-turnover-accelerator (basic ki da general advice)
// — ta PRO verzija da PER-ITEM acceleration plan z recommendedAction,
// expectedDaysSaved in newTargetPrice. Razlika od inventory-turnover-optimizer
// (ki optimira turnover strategijo) — ta je PREDICTOR ki za vsak HELD item
// predlaga konkretne akcije. Razlika od inventory-turnover-predictor (ki
// napove future turnover) — ta je ACTION-oriented z per-item plan. Razlika
// od inventory-turnover-forecast (v7.78 ki forecast-a portfolio turnover)
// — ta je per-item accelerator z accelerationPotential in actionPriority.
// Razlika od inventory-aging-predictor-pro (v7.83 ki predict-a aging risk)
// — ta je ACTION-oriented z konkretnimi akcijami (PRICE_DROP/RELIST/CROSS_POST/BUNDLE/LIQUIDATE).
//
// GET+POST /api/ai/inventory-turnover-accelerator-pro
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import {
  callProviderForRaw,
  parseJsonLooseExported,
  type AiProviderType,
  type AiSettings,
} from '@/lib/ai';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type ActionType =
  | 'PRICE_DROP_5%'
  | 'PRICE_DROP_10%'
  | 'PRICE_DROP_15%'
  | 'RELIST_FRESH'
  | 'CROSS_POST'
  | 'BUNDLE'
  | 'LIQUIDATE'
  | 'HOLD';

type ActionPriority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
type UrgencyLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface HeldItemRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyDate: Date | null;
}

interface SoldTradeRow {
  category: string;
  buyDate: Date | null;
  sellDate: Date | null;
  buyPrice: number;
  sellPrice: number | null;
}

interface ItemAccelerationPlan {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  daysHeld: number;
  categoryAvgHoldDays: number;
  turnoverRiskScore: number; // 0-100
  accelerationPotential: number; // 0-100
  recommendedAction: ActionType;
  expectedDaysSaved: number;
  newTargetPrice: number | null;
  expectedSellDate: string; // ISO
  actionPriority: ActionPriority;
  reasoning: string;
}

interface PortfolioAcceleration {
  currentAvgTurnoverDays: number;
  projectedTurnoverWithActions: number;
  totalDaysSaved: number;
  accelerationROI: number; // EUR extra profit
  urgencyLevel: UrgencyLevel;
}

interface AiAccelerationResponse {
  items?: unknown;
  portfolio?: unknown;
  summary?: unknown;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const MIN_PRICE_RATIO = 0.5; // min newTargetPrice = 0.5x buyPrice
const MAX_PRICE_RATIO = 1.2; // max newTargetPrice = 1.2x buyPrice
const MAX_DAYS_SAVED = 60;

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

function clampInt(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const v = clampNumber(raw, min, max, fallback);
  return Math.round(v);
}

const VALID_ACTIONS: readonly ActionType[] = [
  'PRICE_DROP_5%',
  'PRICE_DROP_10%',
  'PRICE_DROP_15%',
  'RELIST_FRESH',
  'CROSS_POST',
  'BUNDLE',
  'LIQUIDATE',
  'HOLD',
];
const VALID_PRIORITY: readonly ActionPriority[] = [
  'URGENT',
  'HIGH',
  'MEDIUM',
  'LOW',
];
const VALID_URGENCY: readonly UrgencyLevel[] = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
];

function clampEnum<T extends string>(
  raw: unknown,
  valid: readonly T[],
  fallback: T,
): T {
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '_').replace(/%/g, '%');
  for (const v of valid) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
}

function round0(v: number): number {
  return Math.round(v);
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
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

function daysBetween(aMs: number, bMs: number): number {
  if (aMs <= 0 || bMs <= 0) return 0;
  return Math.max(0, Math.round((bMs - aMs) / DAY_MS));
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// --- Category avg hold days ---------------------------------------------

function computeCategoryAvgHoldDays(
  soldTrades: SoldTradeRow[],
): Map<string, number> {
  const catMap = new Map<string, number[]>();
  for (const t of soldTrades) {
    const buyMs = toMs(t.buyDate);
    const sellMs = toMs(t.sellDate);
    if (buyMs <= 0 || sellMs <= 0) continue;
    const days = daysBetween(buyMs, sellMs);
    if (days <= 0 || days > 3650) continue; // sanity check
    const cat = (t.category ?? '').trim() || 'unknown';
    let arr = catMap.get(cat);
    if (!arr) {
      arr = [];
      catMap.set(cat, arr);
    }
    arr.push(days);
  }
  const result = new Map<string, number>();
  for (const [cat, arr] of catMap.entries()) {
    result.set(cat, round1(avg(arr)));
  }
  // Global default fallback (avg across all sold trades)
  const allDays: number[] = [];
  for (const arr of catMap.values()) allDays.push(...arr);
  result.set('__default__', allDays.length > 0 ? round1(avg(allDays)) : 30);
  return result;
}

// --- Per-item deterministic acceleration -------------------------------

function computeTurnoverRiskScore(daysHeld: number, categoryAvg: number): number {
  // Higher = slower turnover risk
  // Ratio of daysHeld vs categoryAvg
  if (categoryAvg <= 0) categoryAvg = 30;
  const ratio = daysHeld / categoryAvg;
  // 0-1x → low risk (0-30), 1-2x → medium (30-60), 2-3x → high (60-80), 3x+ → critical (80-100)
  let score: number;
  if (ratio <= 1) {
    score = Math.max(0, 30 - ratio * 30);
  } else if (ratio <= 2) {
    score = 30 + (ratio - 1) * 30;
  } else if (ratio <= 3) {
    score = 60 + (ratio - 2) * 20;
  } else {
    score = Math.min(100, 80 + (ratio - 3) * 5);
  }
  return round0(Math.max(0, Math.min(100, score)));
}

function computeAccelerationPotential(
  daysHeld: number,
  categoryAvg: number,
  riskScore: number,
): number {
  // How much can turnover be improved — higher if item is slow + sellable
  if (categoryAvg <= 0) categoryAvg = 30;
  const room = Math.max(0, daysHeld - categoryAvg * 0.5);
  // Normalized room 0-50 component
  const roomScore = Math.min(50, (room / categoryAvg) * 50);
  // Risk score component 0-50
  const riskComponent = Math.min(50, riskScore * 0.5);
  return round0(Math.max(0, Math.min(100, roomScore + riskComponent)));
}

function recommendActionDeterministic(
  daysHeld: number,
  categoryAvg: number,
  buyPrice: number,
  riskScore: number,
): {
  action: ActionType;
  daysSaved: number;
  newTargetPrice: number | null;
  priority: ActionPriority;
} {
  if (categoryAvg <= 0) categoryAvg = 30;
  const ratio = daysHeld / categoryAvg;

  // If item is brand new (< 0.5x categoryAvg) → HOLD
  if (ratio < 0.5) {
    return {
      action: 'HOLD',
      daysSaved: 0,
      newTargetPrice: null,
      priority: 'LOW',
    };
  }

  // If extreme aging (>3x) → LIQUIDATE (dump)
  if (ratio >= 3) {
    const target = round2(buyPrice * 0.85); // 15% drop to liquidate
    const saved = Math.min(MAX_DAYS_SAVED, round0(daysHeld * 0.6));
    return {
      action: 'LIQUIDATE',
      daysSaved: saved,
      newTargetPrice: target,
      priority: 'URGENT',
    };
  }

  // 2-3x categoryAvg → PRICE_DROP_15% or RELIST_FRESH
  if (ratio >= 2) {
    const target = round2(buyPrice * 0.85);
    const saved = Math.min(MAX_DAYS_SAVED, round0(categoryAvg * 0.7));
    return {
      action: 'PRICE_DROP_15%',
      daysSaved: saved,
      newTargetPrice: target,
      priority: riskScore >= 70 ? 'HIGH' : 'MEDIUM',
    };
  }

  // 1.5-2x → PRICE_DROP_10%
  if (ratio >= 1.5) {
    const target = round2(buyPrice * 0.9);
    const saved = Math.min(MAX_DAYS_SAVED, round0(categoryAvg * 0.5));
    return {
      action: 'PRICE_DROP_10%',
      daysSaved: saved,
      newTargetPrice: target,
      priority: 'MEDIUM',
    };
  }

  // 1-1.5x → PRICE_DROP_5% or CROSS_POST
  if (ratio >= 1) {
    // If buyPrice > 200 → CROSS_POST (more visibility), else small drop
    if (buyPrice > 200) {
      const saved = Math.min(MAX_DAYS_SAVED, round0(categoryAvg * 0.4));
      return {
        action: 'CROSS_POST',
        daysSaved: saved,
        newTargetPrice: null,
        priority: 'MEDIUM',
      };
    }
    const target = round2(buyPrice * 0.95);
    const saved = Math.min(MAX_DAYS_SAVED, round0(categoryAvg * 0.4));
    return {
      action: 'PRICE_DROP_5%',
      daysSaved: saved,
      newTargetPrice: target,
      priority: 'LOW',
    };
  }

  // 0.5-1x → BUNDLE or RELIST_FRESH
  if (ratio >= 0.5) {
    return {
      action: 'RELIST_FRESH',
      daysSaved: round0(categoryAvg * 0.2),
      newTargetPrice: null,
      priority: 'LOW',
    };
  }

  return {
    action: 'HOLD',
    daysSaved: 0,
    newTargetPrice: null,
    priority: 'LOW',
  };
}

function expectedSellDate(daysHeld: number, daysSaved: number, now: number): string {
  // Expected sale = now + (daysHeld - daysSaved) projected forward,
  // but realistically: now + (categoryAvg - daysSaved) — i.e., item sells faster than current pace
  // Simplified: now + max(7, daysSaved * 2) days
  const projectedDays = Math.max(7, Math.round(daysSaved * 2));
  return new Date(now + projectedDays * DAY_MS).toISOString();
}

function buildReasoning(
  action: ActionType,
  daysHeld: number,
  categoryAvg: number,
  daysSaved: number,
  buyPrice: number,
): string {
  const ratio = (daysHeld / Math.max(1, categoryAvg)).toFixed(2);
  switch (action) {
    case 'PRICE_DROP_5%':
      return `Item držan ${daysHeld}d (${ratio}x povprečja ${categoryAvg}d). Manjši -5% drop (na ${round2(buyPrice * 0.95)}€) bi pospešil prodajo za ${daysSaved}d.`;
    case 'PRICE_DROP_10%':
      return `Item držan ${daysHeld}d (${ratio}x povprečja). -10% drop (na ${round2(buyPrice * 0.9)}€) kompenzira zastoj in prihrani ${daysSaved}d.`;
    case 'PRICE_DROP_15%':
      return `Item držan ${daysHeld}d (${ratio}x povprečja). -15% drop (na ${round2(buyPrice * 0.85)}€) nujen za prekinitev stagnacije, ${daysSaved}d prihranka.`;
    case 'RELIST_FRESH':
      return `Item držan ${daysHeld}d. Relist z svežimi fotografijami/description-om poveča CTR in prihrani ${daysSaved}d.`;
    case 'CROSS_POST':
      return `Item držan ${daysHeld}d, višja cena (${buyPrice}€). Cross-post na druge platforme (Vinted, mobile.de) razširi doseg in prihrani ${daysSaved}d.`;
    case 'BUNDLE':
      return `Item držan ${daysHeld}d. Bundle z drugim inventoryjem poveča atraktivnost in prihrani ${daysSaved}d.`;
    case 'LIQUIDATE':
      return `Item držan ${daysHeld}d (${ratio}x povprečja) — kritično. Likvidacija na ${round2(buyPrice * 0.85)}€ sprosti kapital, ${daysSaved}d prihranka.`;
    case 'HOLD':
      return `Item držan ${daysHeld}d (${ratio}x povprečja) — v okvari, drži ceno in počakaj naravno prodajo.`;
    default:
      return `Item držan ${daysHeld}d, priporočena akcija: ${action}.`;
  }
}

function buildDeterministicPlan(
  held: HeldItemRow[],
  catAvg: Map<string, number>,
  now: number,
): { items: ItemAccelerationPlan[]; portfolio: PortfolioAcceleration; summary: string } {
  const items: ItemAccelerationPlan[] = [];
  for (const h of held) {
    const buyMs = toMs(h.buyDate);
    const daysHeld = buyMs > 0 ? daysBetween(buyMs, now) : 0;
    const category = (h.category ?? '').trim() || 'unknown';
    const categoryAvgHoldDays = catAvg.get(category) ?? catAvg.get('__default__') ?? 30;
    const turnoverRiskScore = computeTurnoverRiskScore(daysHeld, categoryAvgHoldDays);
    const accelerationPotential = computeAccelerationPotential(daysHeld, categoryAvgHoldDays, turnoverRiskScore);
    const rec = recommendActionDeterministic(daysHeld, categoryAvgHoldDays, h.buyPrice, turnoverRiskScore);
    const sellDate = expectedSellDate(daysHeld, rec.daysSaved, now);
    items.push({
      tradeId: h.id,
      title: h.title,
      category,
      buyPrice: round2(h.buyPrice),
      daysHeld,
      categoryAvgHoldDays,
      turnoverRiskScore,
      accelerationPotential,
      recommendedAction: rec.action,
      expectedDaysSaved: rec.daysSaved,
      newTargetPrice: rec.newTargetPrice !== null ? round2(rec.newTargetPrice) : null,
      expectedSellDate: sellDate,
      actionPriority: rec.priority,
      reasoning: buildReasoning(rec.action, daysHeld, categoryAvgHoldDays, rec.daysSaved, h.buyPrice),
    });
  }
  // Sort by turnoverRiskScore desc
  items.sort((a, b) => b.turnoverRiskScore - a.turnoverRiskScore);

  // Portfolio summary
  const currentAvgTurnoverDays =
    items.length > 0 ? round1(avg(items.map((i) => i.daysHeld))) : 0;
  const totalDaysSaved = round0(items.reduce((s, i) => s + i.expectedDaysSaved, 0));
  const projectedTurnoverWithActions = items.length > 0
    ? round1(Math.max(0, currentAvgTurnoverDays - totalDaysSaved / items.length))
    : 0;

  // accelerationROI = estimated additional profit from faster turnover
  // Assume 1%/day of held capital cost (opportunity cost)
  // Extra profit = items where action reduces days × avg buyPrice × daysSaved × 0.01
  const accelerationROI = round2(
    items.reduce(
      (s, i) => s + (i.expectedDaysSaved > 0 ? i.buyPrice * i.expectedDaysSaved * 0.005 : 0),
      0,
    ),
  );

  // Urgency level based on portfolio
  const highRiskCount = items.filter((i) => i.actionPriority === 'URGENT' || i.actionPriority === 'HIGH').length;
  const urgentCount = items.filter((i) => i.actionPriority === 'URGENT').length;
  let urgencyLevel: UrgencyLevel = 'LOW';
  if (urgentCount >= 3 || (items.length > 0 && urgentCount / items.length >= 0.3)) {
    urgencyLevel = 'CRITICAL';
  } else if (highRiskCount >= 3 || (items.length > 0 && highRiskCount / items.length >= 0.4)) {
    urgencyLevel = 'HIGH';
  } else if (highRiskCount >= 1) {
    urgencyLevel = 'MEDIUM';
  }

  const portfolio: PortfolioAcceleration = {
    currentAvgTurnoverDays,
    projectedTurnoverWithActions,
    totalDaysSaved,
    accelerationROI,
    urgencyLevel,
  };

  const summary =
    items.length === 0
      ? 'Ni HELD inventarja — Inventory Turnover Accelerator Pro ni mogoč.'
      : `Portfolio: ${currentAvgTurnoverDays}d avg → ${projectedTurnoverWithActions}d z akcijami (${totalDaysSaved}d prihranka, +${accelerationROI}€ ROI). Urgentnost: ${urgencyLevel}. ${urgentCount > 0 ? `${urgentCount} URGENT item-ov.` : `${highRiskCount} high-priority item-ov.`}`;

  return { items, portfolio, summary };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleInventoryTurnoverAcceleratorPro(req);
}
export async function POST(req: NextRequest) {
  return handleInventoryTurnoverAcceleratorPro(req);
}

async function handleInventoryTurnoverAcceleratorPro(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-inventory-turnover-accelerator-pro', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();

    // 1) Query HELD trades (with their listing for source context)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyDate: true,
      },
      orderBy: { buyDate: 'asc' },
      take: 10000,
    });

    // 2) Query SOLD trades for historical turnover patterns per category
    const cutoff12m = new Date(now - HORIZON_12M);
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
      },
      select: {
        category: true,
        buyDate: true,
        sellDate: true,
        buyPrice: true,
        sellPrice: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    });

    const catAvg = computeCategoryAvgHoldDays(
      soldTrades as unknown as SoldTradeRow[],
    );

    const held = heldTrades as unknown as HeldItemRow[];

    // Deterministic plan (fallback)
    const det = buildDeterministicPlan(held, catAvg, now);
    let items = det.items;
    let portfolio = det.portfolio;
    let finalSummary = det.summary;

    // Empty state: no HELD items
    if (held.length === 0) {
      return NextResponse.json({
        ok: true,
        items,
        portfolio,
        summary:
          'Ni HELD inventarja — Inventory Turnover Accelerator Pro ni mogoč.',
        aiUsed: false,
        message:
          'Ni HELD inventarja — Inventory Turnover Accelerator Pro ni mogoč.',
      });
    }

    // 3) AI cache check (6h TTL) — key by heldItemIds
    const heldItemIds = held.map((h) => h.id).sort().join(',');
    const cacheKey = `inventory-turnover-accelerator-pro:${heldItemIds}`;
    const cached = getCachedAI<{
      items: ItemAccelerationPlan[];
      portfolio: PortfolioAcceleration;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        items: cached.items,
        portfolio: cached.portfolio,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 4) AI prompt with grounding
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as
        | AiProviderType
        | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '',
      fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // Limit to top 50 items by risk for AI prompt (avoid huge prompts)
    const topItems = items.slice(0, 50);

    const promptData = {
      heldItemCount: held.length,
      itemsForAI: topItems.map((i) => ({
        tradeId: i.tradeId,
        title: i.title,
        category: i.category,
        buyPrice: i.buyPrice,
        daysHeld: i.daysHeld,
        categoryAvgHoldDays: i.categoryAvgHoldDays,
        turnoverRiskScore: i.turnoverRiskScore,
        accelerationPotential: i.accelerationPotential,
        deterministicAction: i.recommendedAction,
        deterministicDaysSaved: i.expectedDaysSaved,
        deterministicNewTargetPrice: i.newTargetPrice,
        deterministicPriority: i.actionPriority,
      })),
      portfolio: det.portfolio,
    };

    const prompt = `Si AI "Inventory Turnover Accelerator Pro" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Identificiraš SPECIFIČNE akcije za pospešitev inventory turnover-a — za vsak HELD item predlagaš natančno akcijo in pričakovane dni prihranjene.

HELD INVENTORY (deterministično izračunano):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. items: za vsak item predlagaj:
   - recommendedAction: PRICE_DROP_5% | PRICE_DROP_10% | PRICE_DROP_15% | RELIST_FRESH | CROSS_POST | BUNDLE | LIQUIDATE | HOLD (lahko prilagodiš od deterministične, validiraj proti enum)
   - expectedDaysSaved: 0-60 (lahko prilagodiš ±10 od deterministične)
   - newTargetPrice: EUR (samo za PRICE_DROP_* in LIQUIDATE, clamped [0.5x, 1.2x] buyPrice, drugače null)
   - expectedSellDate: ISO date v prihodnosti (po akciji)
   - actionPriority: URGENT | HIGH | MEDIUM | LOW (lahko prilagodiš, validiraj proti enum)
   - reasoning: slovenski opis max 250 znakov, zakaj ta akcija (upoštevaj daysHeld, categoryAvg, buyPrice)
2. portfolio:
   - currentAvgTurnoverDays: iz deterministične vrednosti (±5)
   - projectedTurnoverWithActions: iz deterministične (±5)
   - totalDaysSaved: sum of expectedDaysSaved (±20 od deterministične)
   - accelerationROI: EUR dodatnega profita iz hitrejšega turnover-ja (0-10000, ±200 od deterministične)
   - urgencyLevel: LOW | MEDIUM | HIGH | CRITICAL (validiraj proti enum)
3. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi zgornje deterministične podatke.

VRNI LE JSON:
{
  "items": [
    { "tradeId": "abc", "recommendedAction": "PRICE_DROP_10%", "expectedDaysSaved": 7, "newTargetPrice": 270, "expectedSellDate": "2026-09-05T00:00:00.000Z", "actionPriority": "HIGH", "reasoning": "PS5 držan 28d (1.27x povprečja 22d). -10% drop (na 270€) kompenzira zastoj in prihrani 7d." }
  ],
  "portfolio": {
    "currentAvgTurnoverDays": 28,
    "projectedTurnoverWithActions": 21,
    "totalDaysSaved": 35,
    "accelerationROI": 175.5,
    "urgencyLevel": "HIGH"
  },
  "summary": "Portfolio: 28d avg → 21d z akcijami (35d prihranka, +175.5€ ROI). Urgentnost: HIGH. 5 high-priority item-ov."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(
        raw,
      ) as AiAccelerationResponse | null;

      if (parsed && typeof parsed === 'object') {
        // AI items override (with anti-hallucination)
        if (Array.isArray(parsed.items)) {
          // Build map for fast lookup
          const detMap = new Map(items.map((i) => [i.tradeId, i]));
          const aiItems: ItemAccelerationPlan[] = [];

          for (const rawItem of parsed.items as unknown[]) {
            const r = rawItem as Record<string, unknown>;
            if (!r || typeof r !== 'object') continue;
            const tradeId = clampString(r.tradeId, 64, '');
            if (!tradeId) continue;
            const detItem = detMap.get(tradeId);
            if (!detItem) continue; // skip unknown tradeId

            const action = clampEnum(r.recommendedAction, VALID_ACTIONS, detItem.recommendedAction);
            // expectedDaysSaved ±10 from deterministic
            const rawDays = clampNumber(r.expectedDaysSaved, 0, MAX_DAYS_SAVED, detItem.expectedDaysSaved);
            const expectedDaysSaved = clampInt(
              Math.max(0, Math.min(MAX_DAYS_SAVED, detItem.expectedDaysSaved + Math.max(-10, Math.min(10, rawDays - detItem.expectedDaysSaved)))),
              0,
              MAX_DAYS_SAVED,
              detItem.expectedDaysSaved,
            );

            // newTargetPrice — only for PRICE_DROP_*/LIQUIDATE
            let newTargetPrice: number | null = null;
            if (
              action === 'PRICE_DROP_5%' ||
              action === 'PRICE_DROP_10%' ||
              action === 'PRICE_DROP_15%' ||
              action === 'LIQUIDATE'
            ) {
              const minPrice = detItem.buyPrice * MIN_PRICE_RATIO;
              const maxPrice = detItem.buyPrice * MAX_PRICE_RATIO;
              const aiPrice = clampNumber(r.newTargetPrice, minPrice, maxPrice, detItem.newTargetPrice ?? detItem.buyPrice);
              newTargetPrice = round2(
                Math.max(minPrice, Math.min(maxPrice, aiPrice)),
              );
            }

            // expectedSellDate — must be future
            const nowSellMs = now + 1 * DAY_MS;
            let sellDateIso: string;
            if (typeof r.expectedSellDate === 'string' && r.expectedSellDate.trim()) {
              const parsedMs = Date.parse(r.expectedSellDate);
              if (Number.isFinite(parsedMs) && parsedMs > nowSellMs) {
                sellDateIso = new Date(parsedMs).toISOString();
              } else {
                sellDateIso = expectedSellDate(detItem.daysHeld, expectedDaysSaved, now);
              }
            } else {
              sellDateIso = expectedSellDate(detItem.daysHeld, expectedDaysSaved, now);
            }

            const actionPriority = clampEnum(r.actionPriority, VALID_PRIORITY, detItem.actionPriority);
            const reasoning = clampString(r.reasoning, 250, detItem.reasoning);

            aiItems.push({
              tradeId: detItem.tradeId,
              title: detItem.title,
              category: detItem.category,
              buyPrice: detItem.buyPrice,
              daysHeld: detItem.daysHeld,
              categoryAvgHoldDays: detItem.categoryAvgHoldDays,
              turnoverRiskScore: detItem.turnoverRiskScore,
              accelerationPotential: detItem.accelerationPotential,
              recommendedAction: action,
              expectedDaysSaved,
              newTargetPrice,
              expectedSellDate: sellDateIso,
              actionPriority,
              reasoning,
            });
          }

          // If AI covered at least some items, use AI items + remaining deterministic
          if (aiItems.length > 0) {
            const aiIds = new Set(aiItems.map((i) => i.tradeId));
            const remaining = items.filter((i) => !aiIds.has(i.tradeId));
            items = [...aiItems, ...remaining];
            // Re-sort by risk
            items.sort((a, b) => b.turnoverRiskScore - a.turnoverRiskScore);
          }
        }

        // Portfolio override
        if (parsed.portfolio && typeof parsed.portfolio === 'object') {
          const p = parsed.portfolio as Record<string, unknown>;
          const adjCurrent = clampNumber(p.currentAvgTurnoverDays, 0, 3650, portfolio.currentAvgTurnoverDays);
          portfolio.currentAvgTurnoverDays = round1(
            Math.max(0, portfolio.currentAvgTurnoverDays + Math.max(-5, Math.min(5, adjCurrent - portfolio.currentAvgTurnoverDays))),
          );
          const adjProjected = clampNumber(p.projectedTurnoverWithActions, 0, 3650, portfolio.projectedTurnoverWithActions);
          portfolio.projectedTurnoverWithActions = round1(
            Math.max(0, portfolio.projectedTurnoverWithActions + Math.max(-5, Math.min(5, adjProjected - portfolio.projectedTurnoverWithActions))),
          );
          const detTotalDays = items.reduce((s, i) => s + i.expectedDaysSaved, 0);
          portfolio.totalDaysSaved = clampInt(
            detTotalDays,
            0,
            100000,
            portfolio.totalDaysSaved,
          );
          const adjROI = clampNumber(p.accelerationROI, 0, 10000, portfolio.accelerationROI);
          portfolio.accelerationROI = round2(
            Math.max(0, portfolio.accelerationROI + Math.max(-200, Math.min(200, adjROI - portfolio.accelerationROI))),
          );
          portfolio.urgencyLevel = clampEnum(p.urgencyLevel, VALID_URGENCY, portfolio.urgencyLevel);
        }

        if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
          finalSummary = clampString(parsed.summary, 400, det.summary);
        }

        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-turnover-accelerator-pro',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        items,
        portfolio,
        summary: finalSummary,
      });
    }

    return NextResponse.json({
      ok: true,
      items,
      portfolio,
      summary: finalSummary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error(
      '/api/ai/inventory-turnover-accelerator-pro',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
