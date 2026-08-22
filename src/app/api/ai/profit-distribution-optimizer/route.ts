// v6.53 / v8.96.1-batch4: AI Profit Distribution Optimizer — optimizira porazdelitev dobička (reinvest/reserve/cash/tax)
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/profit-distribution-optimizer
// Body: { monthsAhead?: number, totalProfitEur?: number }
// Returns: { ok, optimizer: { current, distribution, scenarios, taxPlan, reinvestPlan, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface ProfitDistributionOptimizerInput {
  monthsAhead: number;
  totalProfitEur: number;
}

interface SoldTradeRow {
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  buyDate: Date;
}

interface HeldTradeRow {
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  category: string;
  listing: { aiEstimatedValue: number | null } | null;
}

interface PromptData {
  monthsAhead: number;
  profit30d: number;
  profit90d: number;
  profit12m: number;
  monthlyAvgProfit: number;
  capitalInvested: number;
  inventoryValue: number;
  totalProfit: number;
}

export const POST = withAiRoute<ProfitDistributionOptimizerInput>({
  endpoint: '/api/ai/profit-distribution-optimizer',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      monthsAhead: Math.max(1, Math.min(24, Number(body?.monthsAhead ?? 12))),
      totalProfitEur: Number(body?.totalProfitEur ?? 0),
    };
  },

  // No validateInput — defaults handle clamping
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { monthsAhead, totalProfitEur: providedProfit } = input;

    // 1. Pridobi sold trades za profit analizo (zadnji 90 dni)
    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const since12m = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    const soldTrades90 = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since90, not: null } },
      select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    const soldTrades30 = soldTrades90.filter(t => t.sellDate && t.sellDate >= since30);
    const soldTrades12m = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since12m, not: null } },
      select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 1000,
    });

    // 2. Pridobi held trades (capital invested)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { buyPrice: true, buyFees: true, buyDate: true, category: true,
        listing: { select: { aiEstimatedValue: true } } },
      take: 100,
    });

    if (soldTrades90.length === 0 && heldTrades.length === 0) {
      return apiOk({ ok: true, optimizer: null, message: 'Ni podatkov za profit distribution analizo.' });
    }

    // 3. Compute profit metrics
    const profit90d = calcProfit(soldTrades90);
    const profit30d = calcProfit(soldTrades30);
    const profit12m = calcProfit(soldTrades12m);
    const monthlyAvgProfit = profit12m / 12;
    const totalProfit = providedProfit > 0 ? providedProfit : Math.round(monthlyAvgProfit * monthsAhead);

    const capitalInvested = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const inventoryValue = heldTrades.reduce((s, t) => s + (t.listing?.aiEstimatedValue ?? t.buyPrice * 1.25), 0);

    const prompt = buildPrompt({
      monthsAhead,
      profit30d, profit90d, profit12m,
      monthlyAvgProfit, capitalInvested, inventoryValue, totalProfit,
    });
    const raw = await callAi(prompt);

    const parsed: any = parseAi(raw);
    const optimizer = transformOptimizer(parsed, {
      monthlyAvgProfit, capitalInvested, inventoryValue, totalProfit,
    });

    return apiOk({ ok: true, optimizer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function calcProfit(trades: SoldTradeRow[]): number {
  return trades.reduce((s, t) => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    return s + (revenue - cost);
  }, 0);
}

function buildPrompt(d: PromptData): string {
  return `Si AI profit distribution optimizer za slovenske oglasne platforme.
Optimiziraj porazdelitev dobička čez ${d.monthsAhead} mesecev za maksimalno rast in varnost.

FINANČNI PODATKI:
- Profit v zadnjih 30 dneh: ${Math.round(d.profit30d)}€
- Profit v zadnjih 90 dneh: ${Math.round(d.profit90d)}€
- Profit v zadnjih 12 mesecih: ${Math.round(d.profit12m)}€
- Povprečni mesečni profit: ${Math.round(d.monthlyAvgProfit)}€
- Trenutno vložen kapital: ${Math.round(d.capitalInvested)}€
- Trenutna vrednost inventarja: ${Math.round(d.inventoryValue)}€
- Pričakovan profit v ${d.monthsAhead} mesecih: ${d.totalProfit}€

Porazdelitvene kategorije:
1. REINVEST (vloži nazaj v inventar) — za rast business-a
2. RESERVE (varnostna rezerva) — za slow sezone in emergencies
3. CASH_OUT (osebna poraba) — za življenjske stroške
4. TAX_RESERVE (davčna rezerva) — za dohodnino
5. EMERGENCY_FUND (nujnja rezerva) — za nepričakovane izgube
6. GROWTH_FUND (strategijska rast) — za tools, marketing, employees
7. DEBT_REPAYMENT (odplačilo dolgov) — če imaš obveznosti
8. EDUCATION (izobraževanje) — tečaji, knjige, konference

Optimizacijska pravila:
- Reinvest 30-50% za aggressive growth, 20-30% za steady, 10-20% za conservative
- Reserve 3-6 mesecev operativnih stroškov
- Tax reserve 25% dobička (slovenska dohodnina)
- Emergency fund 10-15% dokler ne doseže 5000€
- Cash out 10-30% glede na osebne potrebe
- Growth fund 5-15% za strategijske investicije

Compounding učinek:
- 100% reinvest: 100€/mesec → 12m: 1200€ + 144€ compounding = 1344€ (12% growth)
- 50% reinvest: 100€/mesec → 12m: 600€ + 36€ compounding = 636€ (6% growth)
- 30% reinvest: 100€/mesec → 12m: 360€ + 11€ compounding = 371€ (3% growth)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": {
    "monthly_avg_profit_eur": <number>,
    "annual_projected_profit_eur": <number>,
    "capital_invested_eur": <number>,
    "inventory_value_eur": <number>,
    "current_distribution_pct": { "reinvest": <number>, "reserve": <number>, "cash_out": <number>, "tax_reserve": <number>, "emergency": <number>, "growth": <number> }
  },
  "distribution": [
    {
      "category": "<reinvest|reserve|cash_out|tax_reserve|emergency_fund|growth_fund|debt_repayment|education>",
      "recommended_pct": <number 0-100>,
      "amount_eur": <number>,
      "monthly_amount_eur": <number>,
      "purpose": "<max 100 znakov>",
      "rationale": "<max 150 znakov>",
      "expected_growth_contribution_pct": <number>,
      "risk_level": "<low|medium|high>",
      "time_horizon": "<short|medium|long>"
    }
  ],
  "scenarios": [
    {
      "scenario": "<aggressive_growth|balanced|conservative|cash_focus>",
      "reinvest_pct": <number>,
      "reserve_pct": <number>,
      "cash_out_pct": <number>,
      "tax_pct": <number>,
      "growth_pct": <number>,
      "projected_12m_value_eur": <number>,
      "projected_24m_value_eur": <number>,
      "projected_36m_value_eur": <number>,
      "annual_growth_rate_pct": <number>,
      "risk_score": <number 0-100>,
      "best_for": "<max 100 znakov>"
    }
  ],
  "tax_plan": [
    {
      "year": <number>,
      "gross_profit_eur": <number>,
      "estimated_tax_eur": <number>,
      "net_profit_eur": <number>,
      "effective_tax_rate_pct": <number>,
      "deductions_available": ["<max 80 znakov>"],
      "tax_optimization_tips": ["<max 100 znakov>"]
    }
  ],
  "reinvest_plan": [
    {
      "month": <1-12>,
      "reinvest_amount_eur": <number>,
      "category_focus": "<max 80 znakov>",
      "expected_inventory_count": <number>,
      "expected_monthly_profit_increase_eur": <number>,
      "cumulative_capital_eur": <number>
    }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "category": "<reinvest|reserve|cash_out|tax|growth>", "expected_impact_eur": <number>, "timeframe_months": <number> }
  ],
  "summary": {
    "total_profit_to_distribute_eur": <number>,
    "recommended_reinvest_eur": <number>,
    "recommended_reserve_eur": <number>,
    "recommended_cash_out_eur": <number>,
    "recommended_tax_reserve_eur": <number>,
    "projected_12m_growth_pct": <number>,
    "projected_24m_value_eur": <number>,
    "best_scenario": "<max 80 znakov>",
    "biggest_risk": "<max 100 znakov>",
    "biggest_opportunity": "<max 100 znakov>",
    "distribution_efficiency_score": <number 0-100>
  }
}`;
}

function transformOptimizer(
  parsed: any,
  ctx: { monthlyAvgProfit: number; capitalInvested: number; inventoryValue: number; totalProfit: number }
) {
  const { monthlyAvgProfit, capitalInvested, inventoryValue, totalProfit } = ctx;
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    current: {
      monthlyAvgProfitEur: Math.round(Number(parsed?.current?.monthly_avg_profit_eur ?? monthlyAvgProfit)),
      annualProjectedProfitEur: Math.round(Number(parsed?.current?.annual_projected_profit_eur ?? monthlyAvgProfit * 12)),
      capitalInvestedEur: Math.round(Number(parsed?.current?.capital_invested_eur ?? capitalInvested)),
      inventoryValueEur: Math.round(Number(parsed?.current?.inventory_value_eur ?? inventoryValue)),
      currentDistributionPct: {
        reinvest: Math.max(0, Math.min(100, Number(parsed?.current?.current_distribution_pct?.reinvest ?? 30))),
        reserve: Math.max(0, Math.min(100, Number(parsed?.current?.current_distribution_pct?.reserve ?? 20))),
        cashOut: Math.max(0, Math.min(100, Number(parsed?.current?.current_distribution_pct?.cash_out ?? 25))),
        taxReserve: Math.max(0, Math.min(100, Number(parsed?.current?.current_distribution_pct?.tax_reserve ?? 25))),
        emergency: Math.max(0, Math.min(100, Number(parsed?.current?.current_distribution_pct?.emergency ?? 0))),
        growth: Math.max(0, Math.min(100, Number(parsed?.current?.current_distribution_pct?.growth ?? 0))),
      },
    },
    distribution: (parsed?.distribution || []).slice(0, 8).map((d: any) => ({
      category: ['reinvest', 'reserve', 'cash_out', 'tax_reserve', 'emergency_fund', 'growth_fund', 'debt_repayment', 'education'].includes(String(d?.category)) ? String(d.category) : 'reinvest',
      recommendedPct: Math.max(0, Math.min(100, Number(d?.recommended_pct ?? 0))),
      amountEur: Math.round(Number(d?.amount_eur ?? 0)),
      monthlyAmountEur: Math.round(Number(d?.monthly_amount_eur ?? 0)),
      purpose: String(d?.purpose ?? '').slice(0, 200),
      rationale: String(d?.rationale ?? '').slice(0, 300),
      expectedGrowthContributionPct: Math.round(Number(d?.expected_growth_contribution_pct ?? 0)),
      riskLevel: ['low', 'medium', 'high'].includes(String(d?.risk_level)) ? String(d.risk_level) : 'medium',
      timeHorizon: ['short', 'medium', 'long'].includes(String(d?.time_horizon)) ? String(d.time_horizon) : 'medium',
    })),
    scenarios: (parsed?.scenarios || []).slice(0, 4).map((s: any) => ({
      scenario: ['aggressive_growth', 'balanced', 'conservative', 'cash_focus'].includes(String(s?.scenario)) ? String(s.scenario) : 'balanced',
      reinvestPct: Math.max(0, Math.min(100, Number(s?.reinvest_pct ?? 30))),
      reservePct: Math.max(0, Math.min(100, Number(s?.reserve_pct ?? 20))),
      cashOutPct: Math.max(0, Math.min(100, Number(s?.cash_out_pct ?? 25))),
      taxPct: Math.max(0, Math.min(100, Number(s?.tax_pct ?? 25))),
      growthPct: Math.max(0, Math.min(100, Number(s?.growth_pct ?? 0))),
      projected12mValueEur: Math.round(Number(s?.projected_12m_value_eur ?? 0)),
      projected24mValueEur: Math.round(Number(s?.projected_24m_value_eur ?? 0)),
      projected36mValueEur: Math.round(Number(s?.projected_36m_value_eur ?? 0)),
      annualGrowthRatePct: Math.round(Number(s?.annual_growth_rate_pct ?? 0) * 10) / 10,
      riskScore: Math.max(0, Math.min(100, Number(s?.risk_score ?? 50))),
      bestFor: String(s?.best_for ?? '').slice(0, 200),
    })),
    taxPlan: (parsed?.tax_plan || []).slice(0, 3).map((t: any) => ({
      year: Math.max(2024, Number(t?.year ?? 2026)),
      grossProfitEur: Math.round(Number(t?.gross_profit_eur ?? 0)),
      estimatedTaxEur: Math.round(Number(t?.estimated_tax_eur ?? 0)),
      netProfitEur: Math.round(Number(t?.net_profit_eur ?? 0)),
      effectiveTaxRatePct: Math.round(Number(t?.effective_tax_rate_pct ?? 25) * 10) / 10,
      deductionsAvailable: (t?.deductions_available || []).slice(0, 5).map((d: any) => String(d).slice(0, 150)),
      taxOptimizationTips: (t?.tax_optimization_tips || []).slice(0, 5).map((tip: any) => String(tip).slice(0, 200)),
    })),
    reinvestPlan: (parsed?.reinvest_plan || []).slice(0, 12).map((r: any) => ({
      month: Math.max(1, Math.min(12, Number(r?.month ?? 1))),
      reinvestAmountEur: Math.round(Number(r?.reinvest_amount_eur ?? 0)),
      categoryFocus: String(r?.category_focus ?? '').slice(0, 150),
      expectedInventoryCount: Math.max(0, Number(r?.expected_inventory_count ?? 0)),
      expectedMonthlyProfitIncreaseEur: Math.round(Number(r?.expected_monthly_profit_increase_eur ?? 0)),
      cumulativeCapitalEur: Math.round(Number(r?.cumulative_capital_eur ?? 0)),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      category: ['reinvest', 'reserve', 'cash_out', 'tax', 'growth'].includes(String(r?.category)) ? String(r.category) : 'reinvest',
      expectedImpactEur: Math.round(Number(r?.expected_impact_eur ?? 0)),
      timeframeMonths: Math.max(1, Number(r?.timeframe_months ?? 1)),
    })),
    summary: {
      totalProfitToDistributeEur: Math.round(Number(parsed?.summary?.total_profit_to_distribute_eur ?? totalProfit)),
      recommendedReinvestEur: Math.round(Number(parsed?.summary?.recommended_reinvest_eur ?? 0)),
      recommendedReserveEur: Math.round(Number(parsed?.summary?.recommended_reserve_eur ?? 0)),
      recommendedCashOutEur: Math.round(Number(parsed?.summary?.recommended_cash_out_eur ?? 0)),
      recommendedTaxReserveEur: Math.round(Number(parsed?.summary?.recommended_tax_reserve_eur ?? 0)),
      projected12mGrowthPct: Math.round(Number(parsed?.summary?.projected_12m_growth_pct ?? 0) * 10) / 10,
      projected24mValueEur: Math.round(Number(parsed?.summary?.projected_24m_value_eur ?? 0)),
      bestScenario: ['aggressive_growth', 'balanced', 'conservative', 'cash_focus'].includes(String(parsed?.summary?.best_scenario)) ? String(parsed.summary.best_scenario) : 'balanced',
      biggestRisk: String(parsed?.summary?.biggest_risk ?? '').slice(0, 200),
      biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 200),
      distributionEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.distribution_efficiency_score ?? 60))),
    },
  };
}
