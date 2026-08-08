// v7.83: AI Inventory Aging Predictor PRO — AI napove KDAJ bo vsak HELD
// item postal "stale" (problematski) in priporoči PROAKTIVNE akcije PREDEN
// staranje postane problem. "PS5: 28d held, avg 22d → MEDIUM risk. Stale in
// 32d. Preventive: drop 5% in 14d."
//
// Razlika od inventory-aging-predictor-v2 (v6.80, ki analizira CURRENT aging
// buckets in devaluation curve) — ta PREDICT-a future aging z
// predictedStaleDate/predictedDeadDate/daysUntilStale in PROACTIVE preventive
// actions. Razlika od inventory-aging-strategist (ki generira strategijo za
// aging items) — ta forecast-a WHEN item bo postal problem z
// priceAdjustmentTimeline in optimalSellWindow. Razlika od inventory-aging
// (osnovni aging report) — ta je AI-powered PROACTIVE prediction z
// agingRiskScore 0-100 + agingRiskLevel + portfolio aging risk scorecard.
// Razlika od inventory-lifecycle-stage-classifier (v7.70, ki klasificira
// lifecycle stage) — ta gleda AGING RISK z dni-do-stale countdown in
// preventive plan.
//
// GET+POST /api/ai/inventory-aging-predictor-pro
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

type AgingRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type UrgencyLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface PriceAdjustmentStep {
  trigger: string;
  daysFromNow: number;
  adjustment: string;
}

interface OptimalSellWindow {
  start: string; // ISO date
  end: string; // ISO date
}

interface HeldItemAgingPrediction {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  daysHeld: number;
  categoryAvgHoldDays: number;
  agingRiskScore: number; // 0-100
  agingRiskLevel: AgingRiskLevel;
  predictedStaleDate: string; // ISO date when item becomes STALE (60d)
  predictedDeadDate: string; // ISO date when item becomes DEAD (90d)
  daysUntilStale: number; // countdown to problematic aging
  preventiveAction: string;
  optimalSellWindow: OptimalSellWindow;
  priceAdjustmentTimeline: PriceAdjustmentStep[];
}

interface PortfolioRisk {
  totalAgingRiskScore: number; // 0-100
  itemsAtRisk: number; // count HIGH/CRITICAL
  projectedStaleItems30d: number;
  projectedDeadItems60d: number;
  urgencyLevel: UrgencyLevel;
}

interface AiAgingResponse {
  items?: unknown;
  portfolioRisk?: unknown;
  summary?: unknown;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const STALE_THRESHOLD_DAYS = 60; // 60+ days = stale
const DEAD_THRESHOLD_DAYS = 90; // 90+ days = dead

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

const VALID_RISK_LEVEL: readonly AgingRiskLevel[] = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
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
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '_');
  for (const v of valid) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
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
  return Math.max(0, Math.round((bMs - aMs) / DAY_MS));
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function addDaysISO(fromMs: number, days: number): string {
  const target = fromMs + Math.max(0, days) * DAY_MS;
  return new Date(target).toISOString();
}

// --- Aging risk classification ------------------------------------------
// agingRiskScore 0-100 — based on daysHeld vs categoryAvgHoldDays.
// - daysHeld < 50% of category avg → LOW (0-25)
// - daysHeld 50-100% of category avg → MEDIUM (25-55)
// - daysHeld > category avg but < STALE_THRESHOLD → HIGH (55-80)
// - daysHeld >= STALE_THRESHOLD → CRITICAL (80-100)
function computeAgingRiskScore(
  daysHeld: number,
  categoryAvgHoldDays: number,
): number {
  const staleRef = Math.max(
    STALE_THRESHOLD_DAYS,
    categoryAvgHoldDays > 0 ? categoryAvgHoldDays : STALE_THRESHOLD_DAYS,
  );
  const ratio = daysHeld / staleRef;
  let score: number;
  if (ratio < 0.5) score = 10 + ratio * 30; // 10-25
  else if (ratio < 1.0) score = 25 + (ratio - 0.5) * 60; // 25-55
  else if (daysHeld < STALE_THRESHOLD_DAYS) score = 55 + (ratio - 1.0) * 25; // 55-80
  else if (daysHeld < DEAD_THRESHOLD_DAYS) score = 80 + 10; // stale, 80-90
  else score = 90 + Math.min(10, (daysHeld - DEAD_THRESHOLD_DAYS) / 5); // 90-100
  return Math.max(0, Math.min(100, round0(score)));
}

function riskLevelFromScore(score: number): AgingRiskLevel {
  if (score >= 80) return 'CRITICAL';
  if (score >= 55) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  return 'LOW';
}

function urgencyFromScore(score: number): UrgencyLevel {
  if (score >= 80) return 'CRITICAL';
  if (score >= 55) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  return 'LOW';
}

// --- Deterministic per-item prediction ---------------------------------

interface HeldItemRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyDate: Date | null;
  listing: {
    firstSeenAt: Date | null;
    dealScore: number | null;
  } | null;
}

interface PreparedItem {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  buyMs: number;
  firstSeenMs: number;
  daysHeld: number;
  daysListed: number;
  categoryAvgHoldDays: number;
  agingRiskScore: number;
  agingRiskLevel: AgingRiskLevel;
  daysUntilStale: number;
  dealScore: number | null;
}

function buildPreparedItem(
  t: HeldItemRow,
  now: number,
  categoryAvgHoldDays: number,
): PreparedItem {
  const buyMs = toMs(t.buyDate) || now;
  const firstSeenMs =
    toMs(t.listing?.firstSeenAt ?? null) || buyMs || now;
  const daysHeld = daysBetween(buyMs, now);
  const daysListed = daysBetween(firstSeenMs, now);
  const agingRiskScore = computeAgingRiskScore(daysHeld, categoryAvgHoldDays);
  const agingRiskLevel = riskLevelFromScore(agingRiskScore);
  const daysUntilStale = Math.max(0, STALE_THRESHOLD_DAYS - daysHeld);
  return {
    tradeId: t.id,
    title: t.title,
    category: t.category,
    buyPrice: t.buyPrice,
    buyMs,
    firstSeenMs,
    daysHeld,
    daysListed,
    categoryAvgHoldDays,
    agingRiskScore,
    agingRiskLevel,
    daysUntilStale,
    dealScore: t.listing?.dealScore ?? null,
  };
}

function buildDeterministicPreventiveAction(
  item: PreparedItem,
): string {
  if (item.agingRiskLevel === 'CRITICAL') {
    return `Kritično staranje — znižaj ceno za 15-20% v 7 dneh in aktivno ponovno objavi oglas na vseh platformah. Razmisli o bundle ponudbi ali likvidaciji.`;
  }
  if (item.agingRiskLevel === 'HIGH') {
    return `Visok aging risk — znižaj ceno za 10% v naslednjih 14 dneh, osveži fotografije in naslov oglasa za boljšo izpostavljenost.`;
  }
  if (item.agingRiskLevel === 'MEDIUM') {
    return `Srednji aging risk — pripravi price drop strategijo (5-8% v 21 dneh) in monitor prodajnih signala.`;
  }
  return `Nizek aging risk — vzdržuj trenutno ceno in spremljaj engagement. Sledi weekly review cene.`;
}

function buildDeterministicOptimalSellWindow(
  item: PreparedItem,
  now: number,
): OptimalSellWindow {
  // Optimal sell window: from now until 14 days before stale date
  // (so user has time to sell before problematic aging).
  const daysUntilStale = item.daysUntilStale;
  const sellEndDays = Math.max(7, daysUntilStale - 14);
  const sellStartDays = Math.min(7, Math.max(0, sellEndDays - 14));
  return {
    start: addDaysISO(now, sellStartDays),
    end: addDaysISO(now, sellEndDays),
  };
}

function buildDeterministicPriceTimeline(
  item: PreparedItem,
): PriceAdjustmentStep[] {
  const buyPrice = item.buyPrice;
  const steps: PriceAdjustmentStep[] = [];
  if (item.agingRiskLevel === 'CRITICAL') {
    steps.push({
      trigger: 'Takoj (CRITICAL aging)',
      daysFromNow: 0,
      adjustment: `Znižaj za 15% na ${round0(buyPrice * 0.85)}€`,
    });
    steps.push({
      trigger: 'Če ni prodano v 7 dneh',
      daysFromNow: 7,
      adjustment: `Dodatno -10% na ${round0(buyPrice * 0.765)}€ (bundle ali likvidacija)`,
    });
  } else if (item.agingRiskLevel === 'HIGH') {
    steps.push({
      trigger: 'V 14 dneh',
      daysFromNow: 14,
      adjustment: `Znižaj za 10% na ${round0(buyPrice * 0.9)}€`,
    });
    steps.push({
      trigger: 'Če ni prodano v 30 dneh',
      daysFromNow: 30,
      adjustment: `Dodatno -10% na ${round0(buyPrice * 0.81)}€`,
    });
  } else if (item.agingRiskLevel === 'MEDIUM') {
    steps.push({
      trigger: 'V 21 dneh',
      daysFromNow: 21,
      adjustment: `Znižaj za 5% na ${round0(buyPrice * 0.95)}€`,
    });
    steps.push({
      trigger: 'Če ni prodano v 45 dneh',
      daysFromNow: 45,
      adjustment: `Dodatno -8% na ${round0(buyPrice * 0.874)}€`,
    });
  } else {
    steps.push({
      trigger: 'V 30 dneh (spremljaj engagement)',
      daysFromNow: 30,
      adjustment: `Oceni ceno na ${round0(buyPrice)}€ — če ni zanimanja, -5%`,
    });
  }
  return steps;
}

function buildDeterministicItem(
  item: PreparedItem,
  now: number,
): HeldItemAgingPrediction {
  return {
    tradeId: item.tradeId,
    title: item.title,
    category: item.category,
    buyPrice: item.buyPrice,
    daysHeld: item.daysHeld,
    categoryAvgHoldDays: item.categoryAvgHoldDays,
    agingRiskScore: item.agingRiskScore,
    agingRiskLevel: item.agingRiskLevel,
    predictedStaleDate: addDaysISO(item.buyMs, STALE_THRESHOLD_DAYS),
    predictedDeadDate: addDaysISO(item.buyMs, DEAD_THRESHOLD_DAYS),
    daysUntilStale: item.daysUntilStale,
    preventiveAction: buildDeterministicPreventiveAction(item),
    optimalSellWindow: buildDeterministicOptimalSellWindow(item, now),
    priceAdjustmentTimeline: buildDeterministicPriceTimeline(item),
  };
}

function buildDeterministicPortfolioRisk(
  items: PreparedItem[],
): PortfolioRisk {
  if (items.length === 0) {
    return {
      totalAgingRiskScore: 0,
      itemsAtRisk: 0,
      projectedStaleItems30d: 0,
      projectedDeadItems60d: 0,
      urgencyLevel: 'LOW',
    };
  }
  const totalAgingRiskScore = round0(avg(items.map((i) => i.agingRiskScore)));
  const itemsAtRisk = items.filter(
    (i) => i.agingRiskLevel === 'HIGH' || i.agingRiskLevel === 'CRITICAL',
  ).length;
  // projectedStaleItems30d: items whose daysUntilStale <= 30 (will become stale within 30 days)
  const projectedStaleItems30d = items.filter(
    (i) => i.daysUntilStale <= 30,
  ).length;
  // projectedDeadItems60d: items whose daysHeld + 60 >= DEAD threshold
  // (i.e., items that will reach DEAD threshold within 60 days)
  const projectedDeadItems60d = items.filter(
    (i) => i.daysHeld + 60 >= DEAD_THRESHOLD_DAYS && i.daysHeld < DEAD_THRESHOLD_DAYS,
  ).length;
  return {
    totalAgingRiskScore,
    itemsAtRisk,
    projectedStaleItems30d,
    projectedDeadItems60d,
    urgencyLevel: urgencyFromScore(totalAgingRiskScore),
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleInventoryAgingPredictorPro(req);
}
export async function POST(req: NextRequest) {
  return handleInventoryAgingPredictorPro(req);
}

async function handleInventoryAgingPredictorPro(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-inventory-aging-predictor-pro', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();

    // 1) Query all HELD trades with linked Listing (for firstSeenAt, dealScore)
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
            firstSeenAt: true,
            dealScore: true,
          },
        },
      },
      orderBy: { buyDate: 'asc' },
      take: 100000,
    });

    const emptyResponse = {
      ok: true,
      items: [] as HeldItemAgingPrediction[],
      portfolioRisk: {
        totalAgingRiskScore: 0,
        itemsAtRisk: 0,
        projectedStaleItems30d: 0,
        projectedDeadItems60d: 0,
        urgencyLevel: 'LOW' as UrgencyLevel,
      },
      summary:
        'Ni HELD inventarja — Inventory Aging Predictor Pro ni mogoč.',
      aiUsed: false,
      message:
        'Ni HELD inventarja — Inventory Aging Predictor Pro ni mogoč.',
    };

    if (heldTrades.length === 0) {
      return NextResponse.json(emptyResponse);
    }

    // 2) Compute categoryAvgHoldDays from SOLD trades (historical hold times)
    //    This gives us the "normal" hold time per category — used as baseline.
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null },
      },
      select: {
        category: true,
        buyDate: true,
        sellDate: true,
      },
      take: 100000,
    });

    const categoryHoldSum = new Map<string, { sum: number; count: number }>();
    for (const t of soldTrades) {
      const buyMs = toMs(t.buyDate);
      const sellMs = toMs(t.sellDate);
      if (buyMs <= 0 || sellMs <= 0) continue;
      const hold = daysBetween(buyMs, sellMs);
      const cat = (t.category || '').trim().toLowerCase() || 'neznan';
      const entry = categoryHoldSum.get(cat) ?? { sum: 0, count: 0 };
      entry.sum += hold;
      entry.count += 1;
      categoryHoldSum.set(cat, entry);
    }
    // Default avg if no SOLD history: 30 days (reasonable baseline)
    const DEFAULT_AVG_HOLD_DAYS = 30;
    const categoryAvgHoldDaysMap = new Map<string, number>();
    for (const [cat, v] of categoryHoldSum.entries()) {
      categoryAvgHoldDaysMap.set(
        cat,
        v.count > 0 ? round0(v.sum / v.count) : DEFAULT_AVG_HOLD_DAYS,
      );
    }

    // 3) Build prepared items
    const preparedItems: PreparedItem[] = heldTrades.map((t) => {
      const cat = (t.category || '').trim().toLowerCase() || 'neznan';
      const catAvg =
        categoryAvgHoldDaysMap.get(cat) ?? DEFAULT_AVG_HOLD_DAYS;
      return buildPreparedItem(t as HeldItemRow, now, catAvg);
    });

    // 4) Deterministic predictions (fallback if AI unavailable)
    let items: HeldItemAgingPrediction[] = preparedItems.map((p) =>
      buildDeterministicItem(p, now),
    );
    let portfolioRisk = buildDeterministicPortfolioRisk(preparedItems);

    // Sort by agingRiskScore desc (highest risk first)
    items.sort((a, b) => b.agingRiskScore - a.agingRiskScore);

    // Deterministic summary
    const topRisk = items[0];
    const deterministicSummary = topRisk
      ? `${items.length} HELD item-ov. Portfolio aging risk: ${portfolioRisk.totalAgingRiskScore}/100 (${portfolioRisk.urgencyLevel}). Items at risk: ${portfolioRisk.itemsAtRisk}. Najbolj kritičen: "${topRisk.title}" (${topRisk.agingRiskLevel}, stale v ${topRisk.daysUntilStale}d).`
      : `${items.length} HELD item-ov. Portfolio aging risk: ${portfolioRisk.totalAgingRiskScore}/100 (${portfolioRisk.urgencyLevel}).`;

    // 5) AI cache check (6h TTL) — key by held item IDs (sorted for stability)
    const heldItemIds = preparedItems.map((p) => p.tradeId).sort();
    const cacheKey = `inventory-aging-predictor-pro:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<{
      items: HeldItemAgingPrediction[];
      portfolioRisk: PortfolioRisk;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        items: cached.items,
        portfolioRisk: cached.portfolioRisk,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 6) AI prompt with grounding
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

    const itemsForPrompt = preparedItems.map((p) => ({
      tradeId: p.tradeId,
      title: p.title,
      category: p.category,
      buyPrice: p.buyPrice,
      daysHeld: p.daysHeld,
      daysListed: p.daysListed,
      categoryAvgHoldDays: p.categoryAvgHoldDays,
      dealScore: p.dealScore,
      deterministicRiskScore: p.agingRiskScore,
      deterministicRiskLevel: p.agingRiskLevel,
      daysUntilStale: p.daysUntilStale,
    }));

    const prompt = `Si AI "Inventory Aging Predictor PRO" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Napoveš KDAJ bo vsak HELD item postal "stale" (problematsko staranje) in priporočiš PROAKTIVNE akcije PREDEN staranje postane problem.

HELD INVENTAR (deterministično izračunano):
${JSON.stringify(itemsForPrompt, null, 2)}

PORTFOLIO STATS:
- Skupno HELD itemov: ${preparedItems.length}
- Povprečen aging risk score: ${portfolioRisk.totalAgingRiskScore}/100
- Items at risk (HIGH/CRITICAL): ${portfolioRisk.itemsAtRisk}
- Projected stale items v 30 dneh: ${portfolioRisk.projectedStaleItems30d}

PRAVILA ZA AI ODGOVOR:
1. items: array per held item z:
   - tradeId: enak kot v promptu (max 50 znakov)
   - agingRiskScore: 0-100 (lahko prilagodiš znotraj [-10, +10] od deterministične vrednosti — anti-hallucination)
   - agingRiskLevel: LOW (<25) | MEDIUM (25-54) | HIGH (55-79) | CRITICAL (80+). Vedno izračunaj iz score.
   - preventiveAction: slovenska konkretna akcija (max 250 znakov). Npr. "Znižaj ceno za 5% v 14 dneh in osveži fotografije."
   - optimalSellWindow: { start: ISO date, end: ISO date }. Start = sedaj ali kmalu. End = pred predictedStaleDate (14 dni pred).
2. portfolioRisk: {
   - totalAgingRiskScore: 0-100 (lahko prilagodiš znotraj [-5, +5] od deterministične vrednosti)
   - urgencyLevel: LOW/MEDIUM/HIGH/CRITICAL (izračunaj iz score)
   - projectedStaleItems30d: število itemov ki bodo postali stale v 30 dneh
   - projectedDeadItems60d: število itemov ki bodo dosegli dead threshold v 60 dneh
}
3. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi zgornje deterministične podatke.

VRNI LE JSON:
{
  "items": [
    {
      "tradeId": "abc123",
      "agingRiskScore": 65,
      "agingRiskLevel": "HIGH",
      "preventiveAction": "Znižaj ceno za 10% v 14 dneh in osveži fotografije za boljšo izpostavljenost.",
      "optimalSellWindow": { "start": "2026-08-08T00:00:00.000Z", "end": "2026-08-29T00:00:00.000Z" }
    }
  ],
  "portfolioRisk": {
    "totalAgingRiskScore": 55,
    "urgencyLevel": "MEDIUM",
    "projectedStaleItems30d": 2,
    "projectedDeadItems60d": 0
  },
  "summary": "5 HELD itemov. Portfolio aging risk: 55/100 (MEDIUM). 2 itema postala stale v 30 dneh. Najbolj kritičen: iPhone (stale v 18d)."
}${GROUNDING_PROMPT_SUFFIX}`;

    let finalSummary = deterministicSummary;
    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(
        raw,
      ) as AiAgingResponse | null;

      if (parsed && typeof parsed === 'object') {
        // AI may override per-item fields with anti-hallucination
        if (parsed.items && Array.isArray(parsed.items)) {
          const aiItems = parsed.items as Array<Record<string, unknown>>;
          for (const ai of aiItems) {
            const tradeId = clampString(ai.tradeId, 50, '');
            if (!tradeId) continue;
            const match = items.find((it) => it.tradeId === tradeId);
            if (!match) continue;

            const detScore = match.agingRiskScore;
            const aiScore = clampNumber(
              ai.agingRiskScore,
              0,
              100,
              detScore,
            );
            // Anti-hallucination: AI can adjust by max ±10
            const clampedScore = Math.max(
              0,
              Math.min(
                100,
                Math.round(
                  detScore +
                    Math.max(-10, Math.min(10, aiScore - detScore)),
                ),
              ),
            );
            match.agingRiskScore = clampedScore;
            // Risk level ALWAYS recomputed from clamped score
            match.agingRiskLevel = clampEnum(
              ai.agingRiskLevel,
              VALID_RISK_LEVEL,
              riskLevelFromScore(clampedScore),
            );

            const preventiveAction = clampString(
              ai.preventiveAction,
              250,
              '',
            );
            if (preventiveAction) match.preventiveAction = preventiveAction;

            // optimalSellWindow validation
            if (
              ai.optimalSellWindow &&
              typeof ai.optimalSellWindow === 'object'
            ) {
              const w = ai.optimalSellWindow as Record<string, unknown>;
              const start = clampString(w.start, 30, match.optimalSellWindow.start);
              const end = clampString(w.end, 30, match.optimalSellWindow.end);
              match.optimalSellWindow = { start, end };
            }
          }
          // Re-sort items by clamped score desc
          items.sort((a, b) => b.agingRiskScore - a.agingRiskScore);
        }

        // Portfolio risk override
        if (
          parsed.portfolioRisk &&
          typeof parsed.portfolioRisk === 'object'
        ) {
          const pr = parsed.portfolioRisk as Record<string, unknown>;
          const detPortfolio = portfolioRisk.totalAgingRiskScore;
          const aiPortfolio = clampNumber(
            pr.totalAgingRiskScore,
            0,
            100,
            detPortfolio,
          );
          // Anti-hallucination: AI can adjust by max ±5
          const clampedPortfolioScore = Math.max(
            0,
            Math.min(
              100,
              Math.round(
                detPortfolio +
                  Math.max(-5, Math.min(5, aiPortfolio - detPortfolio)),
              ),
            ),
          );
          // Recompute portfolio score from individual item scores (more accurate)
          const recomputedScore =
            items.length > 0
              ? round0(
                  avg(items.map((i) => i.agingRiskScore)),
                )
              : clampedPortfolioScore;
          const itemsAtRisk = items.filter(
            (i) => i.agingRiskLevel === 'HIGH' || i.agingRiskLevel === 'CRITICAL',
          ).length;
          const projectedStaleItems30d = clampInt(
            pr.projectedStaleItems30d,
            0,
            items.length,
            preparedItems.filter((p) => p.daysUntilStale <= 30).length,
          );
          const projectedDeadItems60d = clampInt(
            pr.projectedDeadItems60d,
            0,
            items.length,
            preparedItems.filter(
              (p) =>
                p.daysHeld + 60 >= DEAD_THRESHOLD_DAYS &&
                p.daysHeld < DEAD_THRESHOLD_DAYS,
            ).length,
          );
          portfolioRisk = {
            totalAgingRiskScore: recomputedScore,
            itemsAtRisk,
            projectedStaleItems30d,
            projectedDeadItems60d,
            urgencyLevel: clampEnum(
              pr.urgencyLevel,
              VALID_URGENCY,
              urgencyFromScore(recomputedScore),
            ),
          };
        }

        if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
          finalSummary = clampString(parsed.summary, 400, deterministicSummary);
        }

        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-aging-predictor-pro',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        items,
        portfolioRisk,
        summary: finalSummary,
      });
    }

    return NextResponse.json({
      ok: true,
      items,
      portfolioRisk,
      summary: finalSummary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error(
      '/api/ai/inventory-aging-predictor-pro',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
