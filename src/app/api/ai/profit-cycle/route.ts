// v6.43 / v8.95.6-profit: AI Profit Cycle Optimizer — optimizira celoten cikel dobička od nakupa do reinvesticije
// Refaktoriran z withAiRoute helperjem (v8.95.6-profit) + enforceBudget guard.
//
// POST /api/ai/profit-cycle
// Body: {}
// Returns: { ok, cycle: { currentCycle, phases, optimizations, reinvestmentPlan, compounding, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitCycleInput {}

export const POST = withAiRoute<ProfitCycleInput>({
  endpoint: '/api/ai/profit-cycle',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {} as ProfitCycleInput;
  },

  // No validateInput — brez polj
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true } } },
      take: 40,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true,
        buyDate: true, sellDate: true },
      take: 300,
    });

    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return apiOk({ ok: true, cycle: null, message: 'Ni podatkov za profit cycle analizo.' });
    }

    const totalRealized = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0), 0);
    const totalInvested = soldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0) + heldTrades.reduce((s, t) => s + t.buyPrice, 0);
    const avgCycleDays = soldTrades.length > 0
      ? Math.round(soldTrades.reduce((s, t) => {
          if (t.sellDate && t.buyDate) return s + (t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000);
          return s;
        }, 0) / soldTrades.length)
      : 30;
    const avgRoi = soldTrades.length > 0
      ? Math.round(soldTrades.reduce((s, t) => {
          const c = t.buyPrice + (t.buyFees ?? 0);
          return s + (c > 0 ? (((t.sellPrice ?? 0) - (t.sellFees ?? 0) - c) / c) * 100 : 0);
        }, 0) / soldTrades.length)
      : 0;

    const prompt = buildPrompt(totalRealized, totalInvested, avgCycleDays, avgRoi, heldTrades.length, soldTrades.length);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const cycle = transformCycle(parsed, avgCycleDays, avgRoi, totalRealized);

    return apiOk({ ok: true, cycle });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

const PRIORITIES = ['high', 'medium', 'low'] as const;

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

/**
 * Build AI prompt za profit cycle (besedilo IDENTIČNO originalu v6.43).
 */
function buildPrompt(
  totalRealized: number,
  totalInvested: number,
  avgCycleDays: number,
  avgRoi: number,
  heldCount: number,
  soldCount: number,
): string {
  return `Si AI profit cycle optimizer. Optimiziraj celoten cikel dobička od nakupa do reinvesticije.

METRIKE:
- Realizirani dobiček: ${Math.round(totalRealized)}€
- Total investirano: ${Math.round(totalInvested)}€
- Povp. cikel dni: ${avgCycleDays}
- Povp. ROI: ${avgRoi}%
- Held: ${heldCount}, Sold: ${soldCount}

Profit cycle faze:
1. CAPITAL_ALLOCATION: koliko denarja kam vložiti
2. SOURCING: iskanje priložnosti
3. ACQUISITION: nakup
4. HOLDING: držanje
5. SELLING: prodaja
6. PROFIT_REALIZATION: realizacija dobička
7. REINVESTMENT: reinvestiranje dobička
8. COMPOUNDING: sestavljeni dobiček

Compounding formula: če reinvestiraš X% dobička z Y% ROI vsakih Z dni:
- Po 12 mesecih z 50% reinvesticijo in 25% ROI vsakih 30d: profit raste eksponentno

Optimizacijska področja:
1. Cycle time: skrajšaj povp. cikel dni (krajši cikel = več ciklov/leto)
2. ROI per cycle: povečaj povp. ROI (boljši sourcing + pricing)
3. Reinvestment rate: optimalen % reinvesticije (20-80%)
4. Capital efficiency: koliko obrneš na en € investicije
5. Risk-adjusted return: Sharpe-like metric za preprodajo

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current_cycle": {
    "avg_cycle_days": <number>,
    "avg_roi_pct": <number>,
    "cycles_per_year": <number>,
    "annual_return_pct": <number>,
    "capital_efficiency": <number>,
    "reinvestment_rate_pct": <number>
  },
  "phases": [
    { "phase": "<capital_allocation|sourcing|acquisition|holding|selling|profit_realization|reinvestment|compounding>", "current_efficiency_pct": <number 0-100>, "optimized_efficiency_pct": <number 0-100>, "improvement_pct": <number>, "action": "<max 100 znakov>", "expected_impact_eur": <number> }
  ],
  "optimizations": [
    { "area": "<cycle_time|roi|reinvestment|capital_efficiency|risk_adjusted>", "current": <number>, "optimized": <number>, "improvement_pct": <number>, "action": "<max 120 znakov>", "priority": "<high|medium|low>" }
  ],
  "reinvestment_plan": [
    { "month": <number>, "capital_eur": <number>, "reinvest_eur": <number>, "reserve_eur": <number>, "expected_profit_eur": <number>, "cumulative_capital_eur": <number> }
  ],
  "compounding": {
    "current_annual_profit_eur": <number>,
    "optimized_annual_profit_eur": <number>,
    "compounding_12m_eur": <number>,
    "compounding_24m_eur": <number>,
    "compounding_36m_eur": <number>,
    "growth_rate_pct": <number>
  },
  "summary": {
    "cycle_efficiency_score": <number 0-100>,
    "biggest_bottleneck": "<max 80 znakov>",
    "quickest_improvement": "<max 80 znakov>",
    "expected_annual_improvement_eur": <number>,
    "projected_3year_value_eur": <number>
  }
}`;
}

/**
 * Transform AI JSON v cycle rezultat. Clamp/slice logika IDENTIČNA originalu v6.43.
 */
function transformCycle(parsed: any, avgCycleDays: number, avgRoi: number, totalRealized: number): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    currentCycle: {
      avgCycleDays: Math.round(Number(parsed?.current_cycle?.avg_cycle_days ?? avgCycleDays)),
      avgRoiPct: Math.round(Number(parsed?.current_cycle?.avg_roi_pct ?? avgRoi)),
      cyclesPerYear: Math.round(Number(parsed?.current_cycle?.cycles_per_year ?? Math.round(365 / Math.max(1, avgCycleDays)))),
      annualReturnPct: Math.round(Number(parsed?.current_cycle?.annual_return_pct ?? 0)),
      capitalEfficiency: Math.round(Number(parsed?.current_cycle?.capital_efficiency ?? 0) * 100) / 100,
      reinvestmentRatePct: Math.round(Number(parsed?.current_cycle?.reinvestment_rate_pct ?? 50)),
    },
    phases: (parsed?.phases || []).slice(0, 8).map((p: any) => ({
      phase: String(p?.phase ?? '').slice(0, 50),
      currentEfficiencyPct: Math.max(0, Math.min(100, Number(p?.current_efficiency_pct ?? 50))),
      optimizedEfficiencyPct: Math.max(0, Math.min(100, Number(p?.optimized_efficiency_pct ?? 70))),
      improvementPct: Math.round(Number(p?.improvement_pct ?? 0)),
      action: String(p?.action ?? '').slice(0, 200),
      expectedImpactEur: Math.round(Number(p?.expected_impact_eur ?? 0)),
    })),
    optimizations: (parsed?.optimizations || []).slice(0, 6).map((o: any) => ({
      area: String(o?.area ?? '').slice(0, 50),
      current: Math.round(Number(o?.current ?? 0)), optimized: Math.round(Number(o?.optimized ?? 0)),
      improvementPct: Math.round(Number(o?.improvement_pct ?? 0)),
      action: String(o?.action ?? '').slice(0, 250),
      priority: includes(PRIORITIES, String(o?.priority)) ? String(o.priority) : 'medium',
    })),
    reinvestmentPlan: (parsed?.reinvestment_plan || []).slice(0, 12).map((r: any) => ({
      month: Math.max(1, Number(r?.month ?? 1)),
      capitalEur: Math.round(Number(r?.capital_eur ?? 0)),
      reinvestEur: Math.round(Number(r?.reinvest_eur ?? 0)),
      reserveEur: Math.round(Number(r?.reserve_eur ?? 0)),
      expectedProfitEur: Math.round(Number(r?.expected_profit_eur ?? 0)),
      cumulativeCapitalEur: Math.round(Number(r?.cumulative_capital_eur ?? 0)),
    })),
    compounding: {
      currentAnnualProfitEur: Math.round(Number(parsed?.compounding?.current_annual_profit_eur ?? totalRealized)),
      optimizedAnnualProfitEur: Math.round(Number(parsed?.compounding?.optimized_annual_profit_eur ?? 0)),
      compounding12mEur: Math.round(Number(parsed?.compounding?.compounding_12m_eur ?? 0)),
      compounding24mEur: Math.round(Number(parsed?.compounding?.compounding_24m_eur ?? 0)),
      compounding36mEur: Math.round(Number(parsed?.compounding?.compounding_36m_eur ?? 0)),
      growthRatePct: Math.round(Number(parsed?.compounding?.growth_rate_pct ?? 0)),
    },
    summary: {
      cycleEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.cycle_efficiency_score ?? 50))),
      biggestBottleneck: String(parsed?.summary?.biggest_bottleneck ?? '').slice(0, 150),
      quickestImprovement: String(parsed?.summary?.quickest_improvement ?? '').slice(0, 150),
      expectedAnnualImprovementEur: Math.round(Number(parsed?.summary?.expected_annual_improvement_eur ?? 0)),
      projected3yearValueEur: Math.round(Number(parsed?.summary?.projected_3year_value_eur ?? 0)),
    },
  };
}
