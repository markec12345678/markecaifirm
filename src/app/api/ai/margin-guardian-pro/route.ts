// v7.60: Margin Guardian Pro — real-time margin monitoring z AI-driven
// pricing priporočili. Skenira ves HELD inventar, identificira iteme kjer
// je profitni margin ogrožen (carrying cost, market price drop), in
// priporoči takojšnje prilagoditve cene.
//
// "PS5 držan 45 dni — carrying cost 22.5€, margin 8% (WARNING) →
//  znižaj ceno za 10% na 380€"
//
// GET+POST /api/ai/margin-guardian-pro
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

// --- Config -------------------------------------------------------------

const TARGET_MARGIN = 0.20; // 20% default target margin
const CARRYING_COST_PER_DAY_EUR = 0.50; // storage / opportunity cost

// --- Types ---------------------------------------------------------------

type MarginStatus = 'HEALTHY' | 'WARNING' | 'AT_RISK' | 'LOSS';
type ActionType = 'HOLD' | 'PRICE_DROP_5%' | 'PRICE_DROP_10%' | 'PRICE_DROP_15%' | 'LIQUIDATE';
type Urgency = 'IMMEDIATE' | 'THIS_WEEK' | 'THIS_MONTH';

interface HeldItemData {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number;
  aiEstimatedValue: number;
  daysHeld: number;
}

interface MarginAlert {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  aiEstimatedValue: number;
  daysHeld: number;
  carryingCost: number;
  breakevenPrice: number;
  currentMargin: number; // %
  marginStatus: MarginStatus;
  action: ActionType;
  newPrice: number;
  urgency: Urgency;
  reasoning: string;
}

interface AiMarginEntry {
  tradeId?: unknown;
  action?: unknown;
  newPrice?: unknown;
  urgency?: unknown;
  reasoning?: unknown;
}

interface AiMarginResponse {
  alerts?: AiMarginEntry[];
}

// --- Helpers -------------------------------------------------------------

function classifyMargin(pct: number): MarginStatus {
  if (pct < 0) return 'LOSS';
  if (pct < 5) return 'AT_RISK';
  if (pct < 15) return 'WARNING';
  return 'HEALTHY';
}

function clampReasoning(s: unknown, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) return s.trim().slice(0, 280);
  return fallback;
}

// Anti-hallucination: clamp AI newPrice to [breakevenPrice, aiEstimatedValue × 1.1]
// (don't recommend selling below breakeven — that would crystallize a loss.
//  Don't recommend above estValue×1.1 — that's unrealistic for a stuck item.)
function clampNewPrice(
  rawPrice: unknown,
  breakeven: number,
  estValue: number,
  action: ActionType,
): number {
  const min = breakeven;
  const max = Math.round(estValue * 1.1);

  let price: number;
  if (action === 'LIQUIDATE') {
    // Liquidate: allow selling slightly below breakeven (90% of breakeven)
    // to free up capital fast. But still clamp to [breakeven × 0.85, breakeven]
    price = Math.round(breakeven * 0.9);
  } else {
    price = Number(rawPrice);
    if (!Number.isFinite(price)) {
      // Fallback by action: % drop from estValue
      const dropMap: Record<ActionType, number> = {
        HOLD: 0,
        'PRICE_DROP_5%': 0.05,
        'PRICE_DROP_10%': 0.10,
        'PRICE_DROP_15%': 0.15,
        LIQUIDATE: 0.20,
      };
      price = Math.round(estValue * (1 - dropMap[action]));
    }
    price = Math.max(min, Math.min(max, Math.round(price)));
  }
  return price;
}

function actionFromStatus(status: MarginStatus, daysHeld: number): ActionType {
  if (status === 'LOSS' || (status === 'AT_RISK' && daysHeld > 60)) return 'LIQUIDATE';
  if (status === 'AT_RISK') return 'PRICE_DROP_15%';
  if (status === 'WARNING' && daysHeld > 30) return 'PRICE_DROP_10%';
  if (status === 'WARNING') return 'PRICE_DROP_5%';
  return 'HOLD';
}

function urgencyFromStatus(status: MarginStatus, daysHeld: number): Urgency {
  if (status === 'LOSS' || daysHeld > 60) return 'IMMEDIATE';
  if (status === 'AT_RISK' || daysHeld > 30) return 'THIS_WEEK';
  if (status === 'WARNING') return 'THIS_MONTH';
  return 'THIS_MONTH';
}

// Deterministic alert for fallback
function deterministicAlert(item: HeldItemData): MarginAlert {
  const carryingCost = Math.round(item.daysHeld * CARRYING_COST_PER_DAY_EUR);
  const breakevenPrice = Math.round(item.buyPrice + item.buyFees + carryingCost);
  const currentMargin = item.buyPrice > 0
    ? Math.round(((item.aiEstimatedValue - item.buyPrice - item.buyFees - carryingCost) / item.buyPrice) * 100)
    : 0;
  const marginStatus = classifyMargin(currentMargin);
  const action = actionFromStatus(marginStatus, item.daysHeld);
  const newPrice = clampNewPrice(null, breakevenPrice, item.aiEstimatedValue, action);
  const urgency = urgencyFromStatus(marginStatus, item.daysHeld);

  return {
    tradeId: item.tradeId,
    title: item.title,
    category: item.category,
    buyPrice: Math.round(item.buyPrice),
    aiEstimatedValue: Math.round(item.aiEstimatedValue),
    daysHeld: item.daysHeld,
    carryingCost,
    breakevenPrice,
    currentMargin,
    marginStatus,
    action,
    newPrice,
    urgency,
    reasoning: `${item.title.slice(0, 50)} — ${item.daysHeld} dni držano, carrying ${carryingCost}€, margin ${currentMargin}%.`,
  };
}

// Validate AI alert entry — anti-hallucination
function validateAiAlert(
  raw: AiMarginEntry,
  item: HeldItemData,
): MarginAlert | null {
  const tid = String(raw.tradeId || '').trim();
  if (tid && tid !== item.tradeId) return null; // mismatched tradeId

  const carryingCost = Math.round(item.daysHeld * CARRYING_COST_PER_DAY_EUR);
  const breakevenPrice = Math.round(item.buyPrice + item.buyFees + carryingCost);
  const currentMargin = item.buyPrice > 0
    ? Math.round(
        ((item.aiEstimatedValue - item.buyPrice - item.buyFees - carryingCost) / item.buyPrice) * 100,
      )
    : 0;
  const marginStatus = classifyMargin(currentMargin);

  // Validate action
  const actionRaw = String(raw.action).toUpperCase().replace(' ', '_');
  const validActions: ActionType[] = ['HOLD', 'PRICE_DROP_5%', 'PRICE_DROP_10%', 'PRICE_DROP_15%', 'LIQUIDATE'];
  const action: ActionType = validActions.includes(actionRaw as ActionType)
    ? (actionRaw as ActionType)
    : actionFromStatus(marginStatus, item.daysHeld);

  const newPrice = clampNewPrice(raw.newPrice, breakevenPrice, item.aiEstimatedValue, action);

  // Validate urgency
  const urgencyRaw = String(raw.urgency).toUpperCase().replace(' ', '_');
  const validUrgencies: Urgency[] = ['IMMEDIATE', 'THIS_WEEK', 'THIS_MONTH'];
  const urgency: Urgency = validUrgencies.includes(urgencyRaw as Urgency)
    ? (urgencyRaw as Urgency)
    : urgencyFromStatus(marginStatus, item.daysHeld);

  const reasoning = clampReasoning(
    raw.reasoning,
    `${item.title.slice(0, 50)} — ${item.daysHeld} dni držano, carrying ${carryingCost}€, margin ${currentMargin}%.`,
  );

  return {
    tradeId: item.tradeId,
    title: item.title,
    category: item.category,
    buyPrice: Math.round(item.buyPrice),
    aiEstimatedValue: Math.round(item.aiEstimatedValue),
    daysHeld: item.daysHeld,
    carryingCost,
    breakevenPrice,
    currentMargin,
    marginStatus,
    action,
    newPrice,
    urgency,
    reasoning,
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleMarginGuardian(req);
}
export async function POST(req: NextRequest) {
  return handleMarginGuardian(req);
}

async function handleMarginGuardian(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-margin-guardian-pro', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const today = new Date();

    // 1) HELD trades with linked Listing
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
            dealScore: true,
          },
        },
      },
      take: 1000,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        alerts: [],
        summary: {
          totalItems: 0,
          healthy: 0,
          warning: 0,
          atRisk: 0,
          loss: 0,
          potentialLossEur: 0,
          avgMargin: 0,
        },
        aiUsed: false,
        message: 'Ni held inventarja — Margin Guardian nima kaj čuvati.',
      });
    }

    const items: HeldItemData[] = heldTrades.map(t => {
      const estValue =
        t.listing?.aiEstimatedValue && t.listing.aiEstimatedValue > 0
          ? t.listing.aiEstimatedValue
          : Math.round(t.buyPrice * 1.2);
      const daysHeld = Math.max(
        0,
        Math.round((today.getTime() - t.buyDate.getTime()) / (1000 * 60 * 60 * 24)),
      );
      return {
        tradeId: t.id,
        title: t.title,
        category: (t.category || 'drugo').trim().toLowerCase(),
        buyPrice: t.buyPrice,
        buyFees: t.buyFees,
        aiEstimatedValue: estValue,
        daysHeld,
      };
    });

    // 2) Compute per-item margin health
    const itemAlerts = items.map(item => {
      const carryingCost = Math.round(item.daysHeld * CARRYING_COST_PER_DAY_EUR);
      const breakevenPrice = Math.round(item.buyPrice + item.buyFees + carryingCost);
      const currentMargin = item.buyPrice > 0
        ? Math.round(((item.aiEstimatedValue - item.buyPrice - item.buyFees - carryingCost) / item.buyPrice) * 100)
        : 0;
      const marginStatus = classifyMargin(currentMargin);
      return { item, carryingCost, breakevenPrice, currentMargin, marginStatus };
    });

    // 3) Filter to items that need attention (WARNING / AT_RISK / LOSS)
    const atRisk = itemAlerts.filter(x => x.marginStatus !== 'HEALTHY');

    // Compute summary across ALL held items (not just at-risk) — for transparency
    const allSummary = (() => {
      let healthy = 0, warning = 0, atRisk = 0, loss = 0, marginSum = 0;
      let potentialLossEur = 0;
      for (const x of itemAlerts) {
        if (x.marginStatus === 'HEALTHY') healthy++;
        else if (x.marginStatus === 'WARNING') warning++;
        else if (x.marginStatus === 'AT_RISK') atRisk++;
        else if (x.marginStatus === 'LOSS') loss++;
        marginSum += x.currentMargin;
        if (x.currentMargin < 0) potentialLossEur += Math.abs(x.currentMargin * x.item.buyPrice / 100);
      }
      return {
        totalItems: items.length,
        healthy,
        warning,
        atRisk,
        loss,
        potentialLossEur: Math.round(potentialLossEur),
        avgMargin: items.length > 0 ? Math.round(marginSum / items.length) : 0,
      };
    })();

    // Empty at-risk state — all margins healthy
    if (atRisk.length === 0) {
      return NextResponse.json({
        ok: true,
        alerts: [],
        summary: allSummary,
        aiUsed: false,
        message: `Vsi held item-i imajo zdrav margin (>=15%). ${items.length} item-ov pod nadzorom.`,
      });
    }

    // 4) AI cache — keyed by held item IDs
    const sortedIds = items.map(i => i.tradeId).sort().join(',');
    const cacheKey = `margin-guardian-pro:${JSON.stringify(sortedIds)}`;
    const cached = getCachedAI<{
      alerts: MarginAlert[];
      summary: typeof allSummary;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        ...cached,
        cached: true,
        aiUsed: true,
      });
    }

    // 5) Build AI prompt with grounding
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '',
      fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // Cap to 60 at-risk items for AI (the rest use deterministic fallback)
    const aiSlice = atRisk.slice(0, 60);

    const itemsBlock = aiSlice
      .map(
        (x, i) =>
          `${i + 1}. tradeId=${x.item.tradeId} | ${x.item.title} | kategorija=${x.item.category} | nabava=${x.item.buyPrice}€ | estValue=${x.item.aiEstimatedValue}€ | dneviHeld=${x.item.daysHeld} | carrying=${x.carryingCost}€ | breakeven=${x.breakevenPrice}€ | margin=${x.currentMargin}% | status=${x.marginStatus}`,
      )
      .join('\n');

    const prompt = `Si finančni analitik za trading firmo na oglasnih platformah (Bolha, Vinted, mobile.de).
Skeniraj HELD inventar z ogroženim margin-om in priporoči takojšnje ukrepanje.

CILJNI MARGIN: ${Math.round(TARGET_MARGIN * 100)}%
CARRYING COST: ${CARRYING_COST_PER_DAY_EUR}€ na dan (storage + opportunity cost)

OGROŽENI ITEMI (${aiSlice.length}):
${itemsBlock}

NALOGA:
Za vsak item določi:
- action: HOLD | PRICE_DROP_5% | PRICE_DROP_10% | PRICE_DROP_15% | LIQUIDATE
- newPrice: specifična cena v EUR
- urgency: IMMEDIATE | THIS_WEEK | THIS_MONTH
- reasoning: 1 stavek v slovenščini — zakaj ta ukrep

PRAVILA:
- newPrice mora biti med [breakevenPrice, estValue × 1.1] — ne prodaj pod breakeven
  (razen LIQUIDATE, kjer je 0.9× breakeven dovoljen za sprostitev kapitala).
- LIQUIDATE samo za LOSS ali item-e držane več kot 60 dni z AT_RISK.
- PRICE_DROP_15% za AT_RISK pod 60 dnevi.
- PRICE_DROP_10% za WARNING držane >30 dni.
- PRICE_DROP_5% za WARNING <30 dni.
- HITROST PRODAJE > maksimiranje cene (vsak dan held = 0.50€ izgube).

Odgovori LE z JSON:
{
  "alerts": [
    {
      "tradeId": "<id>",
      "action": "HOLD|PRICE_DROP_5%|PRICE_DROP_10%|PRICE_DROP_15%|LIQUIDATE",
      "newPrice": <number EUR>,
      "urgency": "IMMEDIATE|THIS_WEEK|THIS_MONTH",
      "reasoning": "<1 stavek>"
    }
  ]
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;
    let alerts: MarginAlert[] = [];

    // Build lookup: tradeId → HeldItemData (only at-risk items sent to AI)
    const itemById = new Map<string, HeldItemData>(aiSlice.map(x => [x.item.tradeId, x.item]));

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiMarginResponse | null;
      if (parsed && Array.isArray(parsed.alerts)) {
        for (const rawEntry of parsed.alerts) {
          const tid = String(rawEntry.tradeId || '').trim();
          const matched = itemById.get(tid);
          if (!matched) continue;
          const alert = validateAiAlert(rawEntry, matched);
          if (alert) alerts.push(alert);
        }
        if (alerts.length > 0) aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/margin-guardian-pro',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 6) Deterministic fallback for any at-risk items the AI didn't cover
    const seenIds = new Set(alerts.map(a => a.tradeId));
    for (const x of aiSlice) {
      if (!seenIds.has(x.item.tradeId)) {
        alerts.push(deterministicAlert(x.item));
      }
    }

    // Sort alerts by urgency (IMMEDIATE first)
    const urgencyRank: Record<Urgency, number> = { IMMEDIATE: 0, THIS_WEEK: 1, THIS_MONTH: 2 };
    alerts.sort(
      (a, b) => urgencyRank[a.urgency] - urgencyRank[b.urgency] || a.currentMargin - b.currentMargin,
    );

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { alerts, summary: allSummary });
    }

    return NextResponse.json({
      ok: true,
      alerts,
      summary: allSummary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error('/api/ai/margin-guardian-pro', 'handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
