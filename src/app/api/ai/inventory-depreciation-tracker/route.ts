// v6.67 / v8.95.7-inv1: AI Inventory Depreciation Tracker — sledi padcu vrednosti z ML forecasting
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-depreciation-tracker
// Body: { tradeId?: string, daysAhead?: number }
// Returns: { ok, tracker: { items, curves, forecasts, writeOffSchedule, mlModels, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const CURVE_TYPES = ['exponential', 'linear', 'logarithmic', 'step'] as const;
const ML_MODELS = ['arima', 'lstm', 'prophet', 'ensemble'] as const;
const RECOMMENDED_ACTIONS = ['hold', 'sell_now', 'sell_30d', 'sell_90d', 'write_off'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;

interface DepreciationTrackerInput {
  tradeId: string | null;
  daysAhead: number;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: { aiEstimatedValue: number | null; aiRisk: number | null } | null;
}

interface DepreciationItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  aiRisk: number;
}

export const POST = withAiRoute<DepreciationTrackerInput>({
  endpoint: '/api/ai/inventory-depreciation-tracker',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget + avtomatsko recordAiCall po uspehu

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : null,
      daysAhead: Math.max(30, Math.min(365, Number(body?.daysAhead ?? 180))),
    };
  },

  // No validateInput — tradeId opcijski, daysAhead ima clamp [30, 365]

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId } = input;

    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades: HeldTradeRow[] = await db.trade.findMany({
      where,
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, aiRisk: true } } },
      take: tradeId ? 1 : 50,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, tracker: null, message: 'Ni held tradeov za depreciation tracking.' });
    }

    const items = buildDepreciationItems(heldTrades);

    const prompt = buildDepreciationPrompt(items);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const tracker = transformTracker(parsed, items);

    return apiOk({ ok: true, tracker });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildDepreciationItems(heldTrades: HeldTradeRow[]): DepreciationItem[] {
  const now = Date.now();
  return heldTrades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    const daysHeld = Math.round((now - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
    return { id: t.id, title: t.title, category: (t.category || 'drugo').toLowerCase(), cost, estValue, daysHeld, aiRisk: t.listing?.aiRisk ?? 5 };
  });
}

function buildDepreciationPrompt(items: DepreciationItem[]): string {
  const itemsStr = items.slice(0, 25).map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d | risk ${i.aiRisk}/10`).join('\n');
  return `Si AI inventory depreciation tracker z ML forecasting.
Sledi padcu vrednosti inventarja in napove future value z 4 curve tipi.

INVENTAR (${items.length}):
${itemsStr}

4 depreciation curve tipi:
1. EXPONENTIAL: hitro pada (telefoni, elektronika — 30-45% v 1. letu)
2. LINEAR: enakomerno pada (avto, kolesa — 12-18% na leto)
3. LOGARITHMIC: hitro pade, nato stabilno (pohištvo, nepremičnine)
4. STEP: stopnjasto pade (elektronika ob novi verziji)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>", "title": "<naslov>", "category": "<kategorija>",
      "original_value_eur": <number>, "current_value_eur": <number>, "current_depreciation_pct": <number>,
      "depreciation_curve_type": "<4 tipi>", "annual_depreciation_rate_pct": <number>,
      "projected_value_30d_eur": <number>, "projected_value_90d_eur": <number>, "projected_value_180d_eur": <number>,
      "floor_value_eur": <number>, "days_until_floor": <number>,
      "break_even_date": "<YYYY-MM-DD>", "urgent_sell_threshold_eur": <number>,
      "recommended_action": "<hold|sell_now|sell_30d|sell_90d|write_off>", "reasoning": "<max 120 znakov>"
    }
  ],
  "curves": [
    { "curve_type": "<4 tipi>", "description": "<max 100 znakov>", "best_for_categories": ["<kategorija>"], "annual_rate_pct": <number>, "floor_pct": <number>, "saturation_days": <number> }
  ],
  "forecasts": [
    { "day_offset": <number>, "total_projected_value_eur": <number>, "total_depreciation_loss_eur": <number>, "items_at_floor": <number>, "items_urgent_sell": <number> }
  ],
  "write_off_schedule": [
    { "category": "<kategorija>", "items_to_write_off": <number>, "total_loss_eur": <number>, "recommended_date": "<YYYY-MM-DD>", "tax_deduction_eur": <number>, "alternative_action": "<max 100 znakov>" }
  ],
  "ml_models": [
    { "model": "<arima|lstm|prophet|ensemble>", "accuracy_pct": <number 0-100>, "mae_eur": <number>, "weight_in_ensemble": <number 0-100>, "best_for_curve": "<4 tipi>" }
  ],
  "summary": {
    "total_items_tracked": <number>, "total_original_value_eur": <number>, "total_current_value_eur": <number>,
    "total_depreciation_loss_eur": <number>, "avg_depreciation_pct": <number>,
    "total_projected_loss_180d_eur": <number>, "items_at_urgent_sell": <number>,
    "biggest_depreciation_threat": "<max 100 znakov>", "quickest_depreciation_win": "<max 100 znakov>",
    "depreciation_tracking_score": <number 0-100>
  }
}`;
}

function transformTracker(parsed: any, items: DepreciationItem[]): any {
  const validIds = new Set(items.map(i => i.id));
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).slice(0, 50).map((it: any) => {
      const orig = items.find(x => x.id === String(it?.id));
      return {
        tradeId: String(it?.id ?? ''), title: String(it?.title ?? orig?.title ?? '').slice(0, 100), category: String(it?.category ?? orig?.category ?? '').slice(0, 50),
        originalValueEur: Math.round(Number(it?.original_value_eur ?? orig?.estValue ?? 0)),
        currentValueEur: Math.round(Number(it?.current_value_eur ?? orig?.estValue ?? 0)),
        currentDepreciationPct: Math.round(Number(it?.current_depreciation_pct ?? 0) * 10) / 10,
        depreciationCurveType: (CURVE_TYPES as readonly string[]).includes(String(it?.depreciation_curve_type)) ? String(it.depreciation_curve_type) : 'linear',
        annualDepreciationRatePct: Math.round(Number(it?.annual_depreciation_rate_pct ?? 15) * 10) / 10,
        projectedValue30dEur: Math.round(Number(it?.projected_value_30d_eur ?? 0)),
        projectedValue90dEur: Math.round(Number(it?.projected_value_90d_eur ?? 0)),
        projectedValue180dEur: Math.round(Number(it?.projected_value_180d_eur ?? 0)),
        floorValueEur: Math.round(Number(it?.floor_value_eur ?? 0)),
        daysUntilFloor: Math.max(0, Number(it?.days_until_floor ?? 0)),
        breakEvenDate: String(it?.break_even_date ?? '').slice(0, 20),
        urgentSellThresholdEur: Math.round(Number(it?.urgent_sell_threshold_eur ?? 0)),
        recommendedAction: (RECOMMENDED_ACTIONS as readonly string[]).includes(String(it?.recommended_action)) ? String(it.recommended_action) : 'hold',
        reasoning: String(it?.reasoning ?? '').slice(0, 250),
      };
    }),
    curves: (parsed?.curves || []).slice(0, 4).map((c: any) => ({
      curveType: (CURVE_TYPES as readonly string[]).includes(String(c?.curve_type)) ? String(c.curve_type) : 'linear',
      description: String(c?.description ?? '').slice(0, 200), bestForCategories: (c?.best_for_categories || []).slice(0, 6).map((cat: any) => String(cat).slice(0, 50)),
      annualRatePct: Math.round(Number(c?.annual_rate_pct ?? 15) * 10) / 10, floorPct: Math.round(Number(c?.floor_pct ?? 15) * 10) / 10,
      saturationDays: Math.max(0, Number(c?.saturation_days ?? 365)),
    })),
    forecasts: (parsed?.forecasts || []).slice(0, 6).map((f: any) => ({
      dayOffset: Math.max(30, Number(f?.day_offset ?? 30)),
      totalProjectedValueEur: Math.round(Number(f?.total_projected_value_eur ?? 0)),
      totalDepreciationLossEur: Math.round(Number(f?.total_depreciation_loss_eur ?? 0)),
      itemsAtFloor: Math.max(0, Number(f?.items_at_floor ?? 0)), itemsUrgentSell: Math.max(0, Number(f?.items_urgent_sell ?? 0)),
    })),
    writeOffSchedule: (parsed?.write_off_schedule || []).slice(0, 8).map((w: any) => ({
      category: String(w?.category ?? '').slice(0, 50), itemsToWriteOff: Math.max(0, Number(w?.items_to_write_off ?? 0)),
      totalLossEur: Math.round(Number(w?.total_loss_eur ?? 0)), recommendedDate: String(w?.recommended_date ?? '').slice(0, 20),
      taxDeductionEur: Math.round(Number(w?.tax_deduction_eur ?? 0)), alternativeAction: String(w?.alternative_action ?? '').slice(0, 200),
    })),
    mlModels: (parsed?.ml_models || []).slice(0, 4).map((m: any) => ({
      model: (ML_MODELS as readonly string[]).includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))), maeEur: Math.round(Number(m?.mae_eur ?? 0) * 100) / 100,
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 25))),
      bestForCurve: (CURVE_TYPES as readonly string[]).includes(String(m?.best_for_curve)) ? String(m.best_for_curve) : 'linear',
    })),
    summary: {
      totalItemsTracked: items.length, totalOriginalValueEur: Math.round(Number(parsed?.summary?.total_original_value_eur ?? items.reduce((s, i) => s + i.estValue, 0))),
      totalCurrentValueEur: Math.round(Number(parsed?.summary?.total_current_value_eur ?? items.reduce((s, i) => s + i.estValue, 0))),
      totalDepreciationLossEur: Math.round(Number(parsed?.summary?.total_depreciation_loss_eur ?? 0)),
      avgDepreciationPct: Math.round(Number(parsed?.summary?.avg_depreciation_pct ?? 0) * 10) / 10,
      totalProjectedLoss180dEur: Math.round(Number(parsed?.summary?.total_projected_loss_180d_eur ?? 0)),
      itemsAtUrgentSell: Math.max(0, Number(parsed?.summary?.items_at_urgent_sell ?? 0)),
      biggestDepreciationThreat: String(parsed?.summary?.biggest_depreciation_threat ?? '').slice(0, 200),
      quickestDepreciationWin: String(parsed?.summary?.quickest_depreciation_win ?? '').slice(0, 200),
      depreciationTrackingScore: Math.max(0, Math.min(100, Number(parsed?.summary?.depreciation_tracking_score ?? 60))),
    },
  };
}
