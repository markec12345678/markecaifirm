// v6.74 / v8.95.5: AI Inventory Turnover Accelerator — pospešuje obrtnost z ML in bottleneck analysis
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-turnover-accelerator
// Body: { tradeId?: string }
// Returns: { ok, accelerator: { current, bottlenecks, accelerators, actionPlan, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const ACCELERATOR_TYPES = ['price_drop', 'bundle_creation', 'cross_post', 'refresh_listing', 'flash_sale', 'auction_listing', 'bundle_break', 'platform_switch', 'image_upgrade', 'description_rewrite', 'tag_optimization', 'urgency_injection'] as const;
const BOTTLENECK_TYPES = ['slow_category', 'overpriced', 'poor_listing', 'wrong_platform', 'seasonal_mismatch', 'competition', 'low_demand', 'bad_timing'] as const;
const DIFFICULTIES = ['low', 'medium', 'high'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;
const TURNOVER_ML_MODELS = ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'] as const;
const TURNOVER_PREDICTION_TYPES = ['days_to_sell', 'acceleration_potential', 'optimal_action', 'turnover_forecast'] as const;

interface InventoryTurnoverAcceleratorInput {
  tradeId: string | null;
}

export const POST = withAiRoute<InventoryTurnoverAcceleratorInput>({
  endpoint: '/api/ai/inventory-turnover-accelerator',
  maxDuration: 90,
  enforceBudget: true, // v8.94: budget guard + avtomatski recordAiCall

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : null,
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId } = input;

    const where: { status: 'held'; id?: string } = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades = await db.trade.findMany({
      where,
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true } } },
      take: tradeId ? 1 : 50,
    });
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null, gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 300,
      orderBy: { sellDate: 'desc' },
    });
    if (heldTrades.length === 0) return apiOk({ ok: true, accelerator: null, message: 'Ni held tradeov za turnover acceleration.' });

    const now = Date.now();
    const items = buildItems(heldTrades, now);
    const avgDays = computeAvgDaysToSell(soldTrades);

    const prompt = buildTurnoverPrompt(items, avgDays);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const accelerator = transformAccelerator(parsed, items, avgDays);

    return apiOk({ ok: true, accelerator });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface TurnoverHeldRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: { aiEstimatedValue: number | null; dealScore: number | null } | null;
}

interface TurnoverSoldRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  buyDate: Date;
}

interface HeldItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  dealScore: number;
}

function buildItems(heldTrades: TurnoverHeldRow[], now: number): HeldItem[] {
  return heldTrades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    const daysHeld = Math.round((now - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
    return {
      id: t.id,
      title: t.title,
      category: (t.category || 'drugo').toLowerCase(),
      cost,
      estValue,
      daysHeld,
      dealScore: t.listing?.dealScore ?? 50,
    };
  });
}

function computeAvgDaysToSell(soldTrades: TurnoverSoldRow[]): number {
  return soldTrades.length > 0
    ? Math.round(
        soldTrades.reduce(
          (s, t) => s + Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000))),
          0
        ) / soldTrades.length
      )
    : 14;
}

function buildTurnoverPrompt(items: HeldItem[], avgDays: number): string {
  const itemsStr = items.slice(0, 25).map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d | deal ${i.dealScore}/100`).join('\n');
  return `Si AI inventory turnover accelerator z ML in bottleneck analysis.
Pospešuje obrtnost inventarja za ${items.length} itemov.

INVENTAR:
${itemsStr}
Povp dni do prodaje (90d): ${avgDays}d

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": { "avg_days_to_sell": <number>, "turnover_rate": <number>, "capital_tied_eur": <number>, "holding_cost_per_day_eur": <number>, "turnover_efficiency_pct": <number 0-100>, "acceleration_potential_pct": <number 0-100> },
  "bottlenecks": [
    { "bottleneck_type": "<slow_category|overpriced|poor_listing|wrong_platform|seasonal_mismatch|competition|low_demand|bad_timing>", "affected_items": <number>, "avg_extra_days": <number>, "cost_impact_eur": <number>, "root_cause": "<max 120 znakov>", "fix_action": "<max 150 znakov>", "priority": "<high|medium|low>" }
  ],
  "accelerators": [
    { "accelerator_type": "<12 tipov>", "description": "<max 120 znakov>", "expected_days_saved": <number>, "expected_revenue_acceleration_eur": <number>, "items_affected": <number>, "implementation_difficulty": "<low|medium|high>", "timeframe_days": <number>, "roi_score": <number 0-100> }
  ],
  "actionPlan": [
    { "step": <number>, "action": "<max 120 znakov>", "accelerator_type": "<12 tipov>", "target_items": ["<trade_id>"], "expected_days_saved": <number>, "expected_revenue_impact_eur": <number>, "priority": "<high|medium|low>", "timeframe_days": <number> }
  ],
  "mlModels": [
    { "model": "<arima|lstm|prophet|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<days_to_sell|acceleration_potential|optimal_action|turnover_forecast>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_items_analyzed": <number>, "current_avg_days_to_sell": <number>, "target_avg_days_to_sell": <number>,
    "expected_days_saved": <number>, "expected_revenue_acceleration_eur": <number>,
    "best_accelerator": "<12 tipov>", "biggest_bottleneck": "<max 100 znakov>",
    "quickest_acceleration_win": "<max 100 znakov>", "turnover_acceleration_score": <number 0-100>
  }
}`;
}

function transformAccelerator(parsed: any, items: HeldItem[], avgDays: number) {
  const validIds = new Set(items.map(i => i.id));
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    current: {
      avgDaysToSell: Math.round(Number(parsed?.current?.avg_days_to_sell ?? avgDays)),
      turnoverRate: Math.round(Number(parsed?.current?.turnover_rate ?? (365 / avgDays)) * 10) / 10,
      capitalTiedEur: Math.round(Number(parsed?.current?.capital_tied_eur ?? items.reduce((s, i) => s + i.cost, 0))),
      holdingCostPerDayEur: Math.round(Number(parsed?.current?.holding_cost_per_day_eur ?? 0) * 100) / 100,
      turnoverEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.current?.turnover_efficiency_pct ?? 60))),
      accelerationPotentialPct: Math.max(0, Math.min(100, Number(parsed?.current?.acceleration_potential_pct ?? 40))),
    },
    bottlenecks: (parsed?.bottlenecks || []).slice(0, 8).map((b: any) => ({
      bottleneckType: (BOTTLENECK_TYPES as readonly string[]).includes(String(b?.bottleneck_type)) ? String(b.bottleneck_type) : 'slow_category',
      affectedItems: Math.max(0, Number(b?.affected_items ?? 0)),
      avgExtraDays: Math.max(0, Number(b?.avg_extra_days ?? 0)),
      costImpactEur: Math.round(Number(b?.cost_impact_eur ?? 0)),
      rootCause: String(b?.root_cause ?? '').slice(0, 250),
      fixAction: String(b?.fix_action ?? '').slice(0, 300),
      priority: (PRIORITIES as readonly string[]).includes(String(b?.priority)) ? String(b.priority) : 'medium',
    })),
    accelerators: (parsed?.accelerators || []).slice(0, 12).map((a: any) => ({
      acceleratorType: (ACCELERATOR_TYPES as readonly string[]).includes(String(a?.accelerator_type)) ? String(a.accelerator_type) : 'price_drop',
      description: String(a?.description ?? '').slice(0, 250),
      expectedDaysSaved: Math.max(0, Number(a?.expected_days_saved ?? 0)),
      expectedRevenueAccelerationEur: Math.round(Number(a?.expected_revenue_acceleration_eur ?? 0)),
      itemsAffected: Math.max(0, Number(a?.items_affected ?? 0)),
      implementationDifficulty: (DIFFICULTIES as readonly string[]).includes(String(a?.implementation_difficulty)) ? String(a.implementation_difficulty) : 'low',
      timeframeDays: Math.max(1, Number(a?.timeframe_days ?? 3)),
      roiScore: Math.max(0, Math.min(100, Number(a?.roi_score ?? 50))),
    })),
    actionPlan: (parsed?.actionPlan || []).slice(0, 10).map((a: any) => ({
      step: Math.max(1, Number(a?.step ?? 1)),
      action: String(a?.action ?? '').slice(0, 250),
      acceleratorType: (ACCELERATOR_TYPES as readonly string[]).includes(String(a?.accelerator_type)) ? String(a.accelerator_type) : 'price_drop',
      targetItems: (a?.target_items || []).filter((id: any) => validIds.has(String(id))).slice(0, 10).map((id: any) => String(id).slice(0, 50)),
      expectedDaysSaved: Math.max(0, Number(a?.expected_days_saved ?? 0)),
      expectedRevenueImpactEur: Math.round(Number(a?.expected_revenue_impact_eur ?? 0)),
      priority: (PRIORITIES as readonly string[]).includes(String(a?.priority)) ? String(a.priority) : 'medium',
      timeframeDays: Math.max(1, Number(a?.timeframe_days ?? 3)),
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: (TURNOVER_ML_MODELS as readonly string[]).includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))),
      predictionType: (TURNOVER_PREDICTION_TYPES as readonly string[]).includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'days_to_sell',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      totalItemsAnalyzed: items.length,
      currentAvgDaysToSell: Math.round(Number(parsed?.summary?.current_avg_days_to_sell ?? avgDays)),
      targetAvgDaysToSell: Math.round(Number(parsed?.summary?.target_avg_days_to_sell ?? avgDays * 0.7)),
      expectedDaysSaved: Math.round(Number(parsed?.summary?.expected_days_saved ?? 0)),
      expectedRevenueAccelerationEur: Math.round(Number(parsed?.summary?.expected_revenue_acceleration_eur ?? 0)),
      bestAccelerator: (ACCELERATOR_TYPES as readonly string[]).includes(String(parsed?.summary?.best_accelerator)) ? String(parsed.summary.best_accelerator) : 'price_drop',
      biggestBottleneck: String(parsed?.summary?.biggest_bottleneck ?? '').slice(0, 200),
      quickestAccelerationWin: String(parsed?.summary?.quickest_acceleration_win ?? '').slice(0, 200),
      turnoverAccelerationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.turnover_acceleration_score ?? 60))),
    },
  };
}
