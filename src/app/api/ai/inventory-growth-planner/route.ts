// v6.70 / v8.95.7-inv1: AI Inventory Growth Planner — načrt rasti inventarja z ML in capital projection
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-growth-planner
// Body: { monthsAhead?: number, targetGrowthPct?: number }
// Returns: { ok, planner: { current, growthPlan, projections, milestones, mlModels, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const SCENARIO_TYPES = ['conservative', 'realistic', 'aggressive'] as const;
const ML_MODELS = ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'] as const;
const PREDICTION_TYPES = ['growth_rate', 'capital_projection', 'profit_forecast', 'optimal_reinvest'] as const;

interface GrowthPlannerInput {
  monthsAhead: number;
  targetGrowthPct: number;
}

interface SoldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  buyDate: Date;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: { aiEstimatedValue: number | null } | null;
}

interface GrowthTotals {
  totalRevenue: number;
  totalProfit: number;
  monthlyProfit: number;
  heldCapital: number;
  soldCount: number;
}

export const POST = withAiRoute<GrowthPlannerInput>({
  endpoint: '/api/ai/inventory-growth-planner',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget + avtomatsko recordAiCall po uspehu

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      monthsAhead: Math.max(1, Math.min(24, Number(body?.monthsAhead ?? 12))),
      targetGrowthPct: Math.max(0, Math.min(500, Number(body?.targetGrowthPct ?? 50))),
    };
  },

  // No validateInput — monthsAhead/targetGrowthPct imata clamp + default

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { monthsAhead, targetGrowthPct } = input;

    const since12m = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const soldTrades: SoldTradeRow[] = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since12m, not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 500, orderBy: { sellDate: 'desc' },
    });
    const heldTrades: HeldTradeRow[] = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true } } },
      take: 100,
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, planner: null, message: 'Ni podatkov za growth planning.' });
    }

    const totals = computeGrowthTotals(soldTrades, heldTrades);

    const prompt = buildGrowthPrompt({ monthsAhead, targetGrowthPct, totals });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const planner = transformPlanner(parsed, monthsAhead, targetGrowthPct, totals);

    return apiOk({ ok: true, planner });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function computeGrowthTotals(soldTrades: SoldTradeRow[], heldTrades: HeldTradeRow[]): GrowthTotals {
  const totalRevenue = soldTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
  const totalProfit = totalRevenue - soldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
  const monthlyProfit = Math.round(totalProfit / 12);
  const heldCapital = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
  return { totalRevenue, totalProfit, monthlyProfit, heldCapital, soldCount: soldTrades.length };
}

interface GrowthPromptInput {
  monthsAhead: number;
  targetGrowthPct: number;
  totals: GrowthTotals;
}

function buildGrowthPrompt(input: GrowthPromptInput): string {
  const { monthsAhead, targetGrowthPct, totals } = input;
  return `Si AI inventory growth planner z ML in capital projection.
Načrtuje rast inventarja za ${monthsAhead} mesecev s ciljem ${targetGrowthPct}% rasti.

TRENUTNO:
- Mesečni profit: ${totals.monthlyProfit}€
- Held capital: ${Math.round(totals.heldCapital)}€
- Skupno sold (12m): ${totals.soldCount}
- Letni profit: ${Math.round(totals.totalProfit)}€

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": { "monthly_profit_eur": <number>, "monthly_volume": <number>, "avg_margin_pct": <number>, "held_capital_eur": <number>, "capital_efficiency_pct": <number 0-100>, "growth_rate_12m_pct": <number> },
  "growthPlan": [
    { "month": <1-24>, "target_capital_eur": <number>, "target_items": <number>, "reinvest_amount_eur": <number>, "expected_profit_eur": <number>, "cumulative_capital_eur": <number>, "growth_pct": <number>, "key_focus": "<max 80 znakov>" }
  ],
  "projections": [
    { "scenario": "<conservative|realistic|aggressive>", "final_capital_eur": <number>, "final_monthly_profit_eur": <number>, "total_profit_eur": <number>, "growth_achieved_pct": <number>, "probability_pct": <number 0-100> }
  ],
  "milestones": [
    { "milestone": "<max 80 znakov>", "target_month": <number>, "target_capital_eur": <number>, "description": "<max 120 znakov>", "achievement_probability_pct": <number 0-100> }
  ],
  "mlModels": [
    { "model": "<arima|lstm|prophet|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<growth_rate|capital_projection|profit_forecast|optimal_reinvest>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "current_monthly_profit_eur": <number>, "target_monthly_profit_eur": <number>, "growth_target_pct": <number>,
    "required_reinvest_pct": <number>, "total_capital_needed_eur": <number>, "expected_total_profit_eur": <number>,
    "best_scenario": "<max 80 znakov>", "biggest_growth_challenge": "<max 100 znakov>",
    "biggest_growth_opportunity": "<max 100 znakov>", "growth_planning_score": <number 0-100>
  }
}`;
}

function transformPlanner(parsed: any, monthsAhead: number, targetGrowthPct: number, totals: GrowthTotals): any {
  const monthlyVolumeFallback = Math.round(totals.soldCount / 12);
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    current: {
      monthlyProfitEur: Math.round(Number(parsed?.current?.monthly_profit_eur ?? totals.monthlyProfit)),
      monthlyVolume: Math.max(0, Number(parsed?.current?.monthly_volume ?? monthlyVolumeFallback)),
      avgMarginPct: Math.round(Number(parsed?.current?.avg_margin_pct ?? 25) * 10) / 10,
      heldCapitalEur: Math.round(Number(parsed?.current?.held_capital_eur ?? totals.heldCapital)),
      capitalEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.current?.capital_efficiency_pct ?? 60))),
      growthRate12mPct: Math.round(Number(parsed?.current?.growth_rate_12m_pct ?? 0) * 10) / 10,
    },
    growthPlan: (parsed?.growthPlan || []).slice(0, monthsAhead).map((g: any) => ({
      month: Math.max(1, Math.min(24, Number(g?.month ?? 1))), targetCapitalEur: Math.round(Number(g?.target_capital_eur ?? 0)),
      targetItems: Math.max(0, Number(g?.target_items ?? 0)), reinvestAmountEur: Math.round(Number(g?.reinvest_amount_eur ?? 0)),
      expectedProfitEur: Math.round(Number(g?.expected_profit_eur ?? 0)), cumulativeCapitalEur: Math.round(Number(g?.cumulative_capital_eur ?? 0)),
      growthPct: Math.round(Number(g?.growth_pct ?? 0) * 10) / 10, keyFocus: String(g?.key_focus ?? '').slice(0, 150),
    })),
    projections: (parsed?.projections || []).slice(0, 3).map((p: any) => ({
      scenario: (SCENARIO_TYPES as readonly string[]).includes(String(p?.scenario)) ? String(p.scenario) : 'realistic',
      finalCapitalEur: Math.round(Number(p?.final_capital_eur ?? 0)), finalMonthlyProfitEur: Math.round(Number(p?.final_monthly_profit_eur ?? 0)),
      totalProfitEur: Math.round(Number(p?.total_profit_eur ?? 0)), growthAchievedPct: Math.round(Number(p?.growth_achieved_pct ?? 0) * 10) / 10,
      probabilityPct: Math.max(0, Math.min(100, Number(p?.probability_pct ?? 50))),
    })),
    milestones: (parsed?.milestones || []).slice(0, 6).map((m: any) => ({
      milestone: String(m?.milestone ?? '').slice(0, 150), targetMonth: Math.max(1, Number(m?.target_month ?? 1)),
      targetCapitalEur: Math.round(Number(m?.target_capital_eur ?? 0)), description: String(m?.description ?? '').slice(0, 250),
      achievementProbabilityPct: Math.max(0, Math.min(100, Number(m?.achievement_probability_pct ?? 50))),
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: (ML_MODELS as readonly string[]).includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))),
      predictionType: (PREDICTION_TYPES as readonly string[]).includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'profit_forecast',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      currentMonthlyProfitEur: Math.round(Number(parsed?.summary?.current_monthly_profit_eur ?? totals.monthlyProfit)),
      targetMonthlyProfitEur: Math.round(Number(parsed?.summary?.target_monthly_profit_eur ?? 0)),
      growthTargetPct: Math.round(Number(parsed?.summary?.growth_target_pct ?? targetGrowthPct) * 10) / 10,
      requiredReinvestPct: Math.round(Number(parsed?.summary?.required_reinvest_pct ?? 30) * 10) / 10,
      totalCapitalNeededEur: Math.round(Number(parsed?.summary?.total_capital_needed_eur ?? 0)),
      expectedTotalProfitEur: Math.round(Number(parsed?.summary?.expected_total_profit_eur ?? 0)),
      bestScenario: (SCENARIO_TYPES as readonly string[]).includes(String(parsed?.summary?.best_scenario)) ? String(parsed.summary.best_scenario) : 'realistic',
      biggestGrowthChallenge: String(parsed?.summary?.biggest_growth_challenge ?? '').slice(0, 200),
      biggestGrowthOpportunity: String(parsed?.summary?.biggest_growth_opportunity ?? '').slice(0, 200),
      growthPlanningScore: Math.max(0, Math.min(100, Number(parsed?.summary?.growth_planning_score ?? 60))),
    },
  };
}
