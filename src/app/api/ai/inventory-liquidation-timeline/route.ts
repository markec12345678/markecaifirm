// v6.69 / v8.95.7-inv1: AI Inventory Liquidation Timeline — timeline likvidacije z ML scheduling
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-liquidation-timeline
// Body: { tradeIds?: string[], maxDays?: number }
// Returns: { ok, timeline: { phases, items, schedule, mlPredictions, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const PHASES = ['immediate', 'short_term', 'medium_term', 'extended', 'write_off'] as const;
const STRATEGIES = ['flash_sale', 'bundle', 'auction', 'discount', 'bulk', 'donate', 'write_off'] as const;
const ML_MODELS = ['random_forest', 'gradient_boosting', 'lstm', 'prophet', 'ensemble'] as const;
const PREDICTION_TYPES = ['sell_probability', 'optimal_price', 'time_to_sell', 'recovery_rate'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;

interface LiquidationTimelineInput {
  tradeIds: string[];
  maxDays: number;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: { aiEstimatedValue: number | null; dealScore: number | null; aiRisk: number | null; location: string | null } | null;
}

interface TimelineItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  dealScore: number;
  aiRisk: number;
}

export const POST = withAiRoute<LiquidationTimelineInput>({
  endpoint: '/api/ai/inventory-liquidation-timeline',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget + avtomatsko recordAiCall po uspehu

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeIds: Array.isArray(body?.tradeIds) ? body.tradeIds : [],
      maxDays: Math.max(7, Math.min(90, Number(body?.maxDays ?? 30))),
    };
  },

  // No validateInput — tradeIds opcijski, maxDays ima clamp [7, 90]

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeIds, maxDays } = input;

    const where: any = { status: 'held' };
    if (tradeIds.length > 0) where.id = { in: tradeIds };
    const heldTrades: HeldTradeRow[] = await db.trade.findMany({
      where,
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true, location: true } } },
      take: 50,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, timeline: null, message: 'Ni held tradeov za liquidation timeline.' });
    }

    const items = buildTimelineItems(heldTrades);

    const prompt = buildTimelinePrompt({ maxDays, items });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const timeline = transformTimeline(parsed, items, maxDays);

    return apiOk({ ok: true, timeline });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildTimelineItems(heldTrades: HeldTradeRow[]): TimelineItem[] {
  const now = Date.now();
  return heldTrades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    const daysHeld = Math.round((now - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
    return { id: t.id, title: t.title, category: (t.category || 'drugo').toLowerCase(), cost, estValue, daysHeld, dealScore: t.listing?.dealScore ?? 50, aiRisk: t.listing?.aiRisk ?? 5 };
  });
}

interface TimelinePromptInput {
  maxDays: number;
  items: TimelineItem[];
}

function buildTimelinePrompt(input: TimelinePromptInput): string {
  const { maxDays, items } = input;
  const itemsStr = items.slice(0, 25).map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d`).join('\n');
  return `Si AI inventory liquidation timeline z ML scheduling.
Ustvari timeline za postopno likvidacijo inventarja v ${maxDays} dneh.

INVENTAR (${items.length}):
${itemsStr}

Timeline faze:
1. IMMEDIATE (dan 1-3): hitri itemi z visokim popustom
2. SHORT_TERM (dan 4-10): srednje prioritete
3. MEDIUM_TERM (dan 11-20): postopna likvidacija
4. EXTENDED (dan 21-30): zadnji poskus pred write-off
5. WRITE_OFF (dan 31+): zapiši kot izgubo

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "phases": [
    { "phase": "<immediate|short_term|medium_term|extended|write_off>", "day_range": "<max 30 znakov>", "item_count": <number>, "total_value_eur": <number>, "expected_recovery_eur": <number>, "recovery_rate_pct": <number 0-100>, "strategy": "<max 120 znakov>" }
  ],
  "items": [
    { "id": "<trade_id>", "title": "<naslov>", "phase": "<5 faz>", "scheduled_day": <number>, "recommended_price_eur": <number>, "discount_pct": <number>, "expected_recovery_eur": <number>, "recovery_rate_pct": <number 0-100>, "strategy": "<flash_sale|bundle|auction|discount|bulk|donate|write_off>", "priority": "<high|medium|low>" }
  ],
  "schedule": [
    { "day": <1-30>, "items_to_list": <number>, "strategy_focus": "<max 80 znakov>", "expected_revenue_eur": <number>, "expected_loss_eur": <number>, "cumulative_recovery_eur": <number> }
  ],
  "mlPredictions": [
    { "model": "<random_forest|gradient_boosting|lstm|prophet|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<sell_probability|optimal_price|time_to_sell|recovery_rate>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_items_to_liquidate": <number>, "total_value_eur": <number>, "total_expected_recovery_eur": <number>,
    "total_expected_loss_eur": <number>, "avg_recovery_rate_pct": <number>,
    "fastest_liquidation_strategy": "<max 80 znakov>", "highest_recovery_strategy": "<max 80 znakov>",
    "liquidation_timeline_score": <number 0-100>
  }
}`;
}

function transformTimeline(parsed: any, items: TimelineItem[], maxDays: number): any {
  const validIds = new Set(items.map(i => i.id));
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    phases: (parsed?.phases || []).slice(0, 5).map((p: any) => ({
      phase: (PHASES as readonly string[]).includes(String(p?.phase)) ? String(p.phase) : 'immediate',
      dayRange: String(p?.day_range ?? '').slice(0, 50), itemCount: Math.max(0, Number(p?.item_count ?? 0)),
      totalValueEur: Math.round(Number(p?.total_value_eur ?? 0)), expectedRecoveryEur: Math.round(Number(p?.expected_recovery_eur ?? 0)),
      recoveryRatePct: Math.max(0, Math.min(100, Number(p?.recovery_rate_pct ?? 50))), strategy: String(p?.strategy ?? '').slice(0, 250),
    })),
    items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).slice(0, 50).map((it: any) => ({
      tradeId: String(it?.id ?? ''), title: String(it?.title ?? '').slice(0, 100),
      phase: (PHASES as readonly string[]).includes(String(it?.phase)) ? String(it.phase) : 'immediate',
      scheduledDay: Math.max(1, Math.min(maxDays, Number(it?.scheduled_day ?? 1))),
      recommendedPriceEur: Math.round(Number(it?.recommended_price_eur ?? 0)), discountPct: Math.round(Number(it?.discount_pct ?? 0) * 10) / 10,
      expectedRecoveryEur: Math.round(Number(it?.expected_recovery_eur ?? 0)),
      recoveryRatePct: Math.max(0, Math.min(100, Number(it?.recovery_rate_pct ?? 50))),
      strategy: (STRATEGIES as readonly string[]).includes(String(it?.strategy)) ? String(it.strategy) : 'discount',
      priority: (PRIORITIES as readonly string[]).includes(String(it?.priority)) ? String(it.priority) : 'medium',
    })),
    schedule: (parsed?.schedule || []).slice(0, maxDays).map((s: any) => ({
      day: Math.max(1, Math.min(maxDays, Number(s?.day ?? 1))), itemsToList: Math.max(0, Number(s?.items_to_list ?? 0)),
      strategyFocus: String(s?.strategy_focus ?? '').slice(0, 150), expectedRevenueEur: Math.round(Number(s?.expected_revenue_eur ?? 0)),
      expectedLossEur: Math.round(Number(s?.expected_loss_eur ?? 0)), cumulativeRecoveryEur: Math.round(Number(s?.cumulative_recovery_eur ?? 0)),
    })),
    mlPredictions: (parsed?.mlPredictions || []).slice(0, 5).map((m: any) => ({
      model: (ML_MODELS as readonly string[]).includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))),
      predictionType: (PREDICTION_TYPES as readonly string[]).includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'sell_probability',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      totalItemsToLiquidate: items.length, totalValueEur: Math.round(Number(parsed?.summary?.total_value_eur ?? items.reduce((s, i) => s + i.estValue, 0))),
      totalExpectedRecoveryEur: Math.round(Number(parsed?.summary?.total_expected_recovery_eur ?? 0)),
      totalExpectedLossEur: Math.round(Number(parsed?.summary?.total_expected_loss_eur ?? 0)),
      avgRecoveryRatePct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_recovery_rate_pct ?? 50))),
      fastestLiquidationStrategy: (STRATEGIES as readonly string[]).includes(String(parsed?.summary?.fastest_liquidation_strategy)) ? String(parsed.summary.fastest_liquidation_strategy) : 'flash_sale',
      highestRecoveryStrategy: (STRATEGIES as readonly string[]).includes(String(parsed?.summary?.highest_recovery_strategy)) ? String(parsed.summary.highest_recovery_strategy) : 'bundle',
      liquidationTimelineScore: Math.max(0, Math.min(100, Number(parsed?.summary?.liquidation_timeline_score ?? 60))),
    },
  };
}
