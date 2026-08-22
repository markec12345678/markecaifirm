// v6.57 / v8.96.2-batch1: AI Inventory Rebalancer v3 — advanced rebalancing z ML portfolio optimization
// Refaktoriran z withAiRoute helperjem (v8.96.2) + enforceBudget guard.
//
// POST /api/ai/inventory-rebalancer-v3
// Body: { totalBudget?: number }
// Returns: { ok, rebalancer: { current, target, actions, mlModels, scenarios, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface InventoryRebalancerV3Input {
  totalBudget: number;
}

export const POST = withAiRoute<InventoryRebalancerV3Input>({
  endpoint: '/api/ai/inventory-rebalancer-v3',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { totalBudget: Math.max(0, Number(body?.totalBudget ?? 0)) };
  },

  // No validateInput — totalBudget ima default 0

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { totalBudget } = input;

    // Pridobi vse trades za portfolio analizo
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true } } },
      take: 100,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null, gte: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, buyDate: true, sellDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return apiOk({ ok: true, rebalancer: null, message: 'Ni podatkov za rebalancing analizo.' });
    }

    // Compute category stats
    const catStats = computeCatStats(soldTrades);

    // Current portfolio distribution
    const { heldByCategory, totalHeldInvested, totalHeldValue } = computeHeldByCategory(heldTrades);

    const currentPortfolio = Array.from(heldByCategory.entries()).map(([cat, c]) => ({
      category: cat, count: c.count, invested: Math.round(c.invested), value: Math.round(c.value),
      allocationPct: totalHeldInvested > 0 ? Math.round((c.invested / totalHeldInvested) * 1000) / 10 : 0,
    }));

    const prompt = buildPrompt({ currentPortfolio, catStats, totalHeldInvested, totalHeldValue, totalBudget });
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const rebalancer = transformRebalancer(parsed, catStats, heldByCategory, totalHeldInvested, totalHeldValue);

    return apiOk({ ok: true, rebalancer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  buyDate: Date;
  sellDate: Date | null;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: { aiEstimatedValue: number | null; dealScore: number | null; aiRisk: number | null } | null;
}

interface CatStat {
  count: number;
  invested: number;
  revenue: number;
  profit: number;
  marginPct: number;
  avgDaysToSell: number;
  riskScore: number;
}

interface HeldCategoryStat {
  count: number;
  invested: number;
  value: number;
}

interface CurrentPortfolioItem {
  category: string;
  count: number;
  invested: number;
  value: number;
  allocationPct: number;
}

interface PromptData {
  currentPortfolio: CurrentPortfolioItem[];
  catStats: Map<string, CatStat>;
  totalHeldInvested: number;
  totalHeldValue: number;
  totalBudget: number;
}

function computeCatStats(soldTrades: SoldTradeRow[]): Map<string, CatStat> {
  const catStats = new Map<string, CatStat>();
  for (const t of soldTrades) {
    const cat = (t.category || 'drugo').toLowerCase();
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    const profit = revenue - cost;
    const days = Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000)));
    if (!catStats.has(cat)) catStats.set(cat, { count: 0, invested: 0, revenue: 0, profit: 0, marginPct: 0, avgDaysToSell: 0, riskScore: 50 });
    const c = catStats.get(cat)!;
    c.count += 1; c.invested += cost; c.revenue += revenue; c.profit += profit; c.avgDaysToSell += days;
  }
  catStats.forEach(c => {
    if (c.count > 0) {
      c.marginPct = c.invested > 0 ? Math.round((c.profit / c.invested) * 1000) / 10 : 0;
      c.avgDaysToSell = Math.round(c.avgDaysToSell / c.count);
      c.riskScore = Math.max(10, Math.min(100, 50 + c.avgDaysToSell / 2 - c.marginPct / 2));
    }
  });
  return catStats;
}

function computeHeldByCategory(heldTrades: HeldTradeRow[]): {
  heldByCategory: Map<string, HeldCategoryStat>;
  totalHeldInvested: number;
  totalHeldValue: number;
} {
  const heldByCategory = new Map<string, HeldCategoryStat>();
  let totalHeldInvested = 0;
  let totalHeldValue = 0;
  for (const t of heldTrades) {
    const cat = (t.category || 'drugo').toLowerCase();
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const value = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    if (!heldByCategory.has(cat)) heldByCategory.set(cat, { count: 0, invested: 0, value: 0 });
    const c = heldByCategory.get(cat)!;
    c.count += 1; c.invested += cost; c.value += value;
    totalHeldInvested += cost;
    totalHeldValue += value;
  }
  return { heldByCategory, totalHeldInvested, totalHeldValue };
}

function buildPrompt(d: PromptData): string {
  const catStatsStr = Array.from(d.catStats.entries()).slice(0, 8).map(([cat, c]) =>
    `- ${cat}: ${c.count}x sold | margin ${c.marginPct}% | ${c.avgDaysToSell}d povp | risk ${c.riskScore}/100`
  ).join('\n');

  const currentStr = d.currentPortfolio.map(c =>
    `- ${c.category}: ${c.count} itemov | ${c.invested}€ invested (${c.allocationPct}%) | ${c.value}€ value`
  ).join('\n');

  return `Si AI inventory rebalancer v3 z ML portfolio optimization.
Optimizira porazdelitev inventarja med kategorijami za maksimalen risk-adjusted return.

TRENUTNI PORTFOLIO:
${currentStr}
Skupaj: ${d.totalHeldInvested}€ investirano, ${d.totalHeldValue}€ estimirana vrednost

HISTORICAL KATEGORIJE (zadnji 6m):
${catStatsStr}
${d.totalBudget > 0 ? `\nNAČRTOVANI BUDGET ZA REBALANCING: ${d.totalBudget}€` : ''}

Rebalancing cilji:
1. MAXIMIZE_RISK_ADJUSTED_RETURN: visok return, nizko tveganje
2. DIVERSIFICATION: razpršitev prek kategorij (max 30% per kategorija)
3. LIQUIDITY: hitreje prodajajoče kategorije imajo večjo alokacijo
4. SEASONALITY: prilagoditev glede na sezono
5. MOMENTUM: nedavno dobro performing kategorije povečaj
6. CONTRARIAN: nizko performing kategorije povečaj (revert to mean)

Rebalancing pravila:
- Max 30% allocation per kategorija (diversification)
- Min 5% allocation per zdrava kategorija
- Reduce allocation kategorij z margin <10%
- Increase allocation kategorij z margin >25% in daysToSell <21
- Maintain 10-20% cash reserve za opportunities

ML modeli:
- MEAN_VARIANCE_OPTIMIZATION: Markowitz portfolio theory
- KELLY_CRITERION: optimal bet size glede na edge in odds
- RISK_PARITY: enak risk contribution per kategorija
- MOMENTUM_TILTING: povečaj nedavno dobre kategorije
- MEAN_REVERSION: povečaj nedavno slabe kategorije

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": {
    "total_invested_eur": <number>,
    "total_value_eur": <number>,
    "total_categories": <number>,
    "avg_margin_pct": <number>,
    "avg_days_to_sell": <number>,
    "risk_score": <number 0-100>,
    "diversification_score": <number 0-100>,
    "liquidity_score": <number 0-100>,
    "concentration_risk": "<low|medium|high>"
  },
  "target": [
    {
      "category": "<kategorija>",
      "current_allocation_pct": <number>,
      "target_allocation_pct": <number>,
      "current_invested_eur": <number>,
      "target_invested_eur": <number>,
      "rebalance_amount_eur": <number>,
      "rebalance_direction": "<increase|decrease|maintain>",
      "reasoning": "<max 120 znakov>",
      "expected_return_pct": <number>,
      "expected_risk_pct": <number>
    }
  ],
  "actions": [
    {
      "action_type": "<buy_more|sell_partial|exit_category|enter_new|hold>",
      "category": "<kategorija>",
      "amount_eur": <number>,
      "priority": "<high|medium|low>",
      "timeframe_days": <number>,
      "expected_impact_eur": <number>,
      "reasoning": "<max 150 znakov>"
    }
  ],
  "ml_models": [
    {
      "model_name": "<mean_variance|kelly_criterion|risk_parity|momentum_tilting|mean_reversion>",
      "description": "<max 100 znakov>",
      "recommended_allocation": [{"category": "<kategorija>", "allocation_pct": <number>}],
      "expected_return_pct": <number>,
      "expected_risk_pct": <number>,
      "sharpe_ratio": <number>,
      "confidence_pct": <number 0-100>
    }
  ],
  "scenarios": [
    {
      "scenario": "<aggressive|balanced|conservative|defensive>",
      "total_expected_return_pct": <number>,
      "total_expected_risk_pct": <number>,
      "sharpe_ratio": <number>,
      "max_drawdown_pct": <number>,
      "best_for": "<max 100 znakov>"
    }
  ],
  "summary": {
    "current_portfolio_score": <number 0-100>,
    "target_portfolio_score": <number 0-100>,
    "improvement_pct": <number>,
    "total_rebalance_amount_eur": <number>,
    "expected_annual_return_improvement_eur": <number>,
    "risk_reduction_pct": <number>,
    "best_model": "<max 80 znakov>",
    "biggest_risk": "<max 100 znakov>",
    "biggest_opportunity": "<max 100 znakov>",
    "rebalancing_efficiency_score": <number 0-100>
  }
}`;
}

function transformRebalancer(
  parsed: any,
  catStats: Map<string, CatStat>,
  heldByCategory: Map<string, HeldCategoryStat>,
  totalHeldInvested: number,
  totalHeldValue: number,
) {
  const validCats = new Set([...Array.from(catStats.keys()), ...Array.from(heldByCategory.keys())]);

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    current: {
      totalInvestedEur: Math.round(Number(parsed?.current?.total_invested_eur ?? totalHeldInvested)),
      totalValueEur: Math.round(Number(parsed?.current?.total_value_eur ?? totalHeldValue)),
      totalCategories: Math.max(0, Number(parsed?.current?.total_categories ?? heldByCategory.size)),
      avgMarginPct: Math.round(Number(parsed?.current?.avg_margin_pct ?? Array.from(catStats.values()).reduce((s, c) => s + c.marginPct, 0) / Math.max(1, catStats.size)) * 10) / 10,
      avgDaysToSell: Math.round(Number(parsed?.current?.avg_days_to_sell ?? Array.from(catStats.values()).reduce((s, c) => s + c.avgDaysToSell, 0) / Math.max(1, catStats.size))),
      riskScore: Math.max(0, Math.min(100, Number(parsed?.current?.risk_score ?? 50))),
      diversificationScore: Math.max(0, Math.min(100, Number(parsed?.current?.diversification_score ?? 50))),
      liquidityScore: Math.max(0, Math.min(100, Number(parsed?.current?.liquidity_score ?? 50))),
      concentrationRisk: ['low', 'medium', 'high'].includes(String(parsed?.current?.concentration_risk)) ? String(parsed.current.concentration_risk) : 'medium',
    },
    target: (parsed?.target || [])
      .filter((t: any) => validCats.has(String(t?.category ?? '')))
      .slice(0, 10)
      .map((t: any) => ({
        category: String(t?.category ?? '').slice(0, 50),
        currentAllocationPct: Math.round(Number(t?.current_allocation_pct ?? 0) * 10) / 10,
        targetAllocationPct: Math.round(Number(t?.target_allocation_pct ?? 0) * 10) / 10,
        currentInvestedEur: Math.round(Number(t?.current_invested_eur ?? 0)),
        targetInvestedEur: Math.round(Number(t?.target_invested_eur ?? 0)),
        rebalanceAmountEur: Math.round(Number(t?.rebalance_amount_eur ?? 0)),
        rebalanceDirection: ['increase', 'decrease', 'maintain'].includes(String(t?.rebalance_direction)) ? String(t.rebalance_direction) : 'maintain',
        reasoning: String(t?.reasoning ?? '').slice(0, 250),
        expectedReturnPct: Math.round(Number(t?.expected_return_pct ?? 0) * 10) / 10,
        expectedRiskPct: Math.round(Number(t?.expected_risk_pct ?? 0) * 10) / 10,
      })),
    actions: (parsed?.actions || []).slice(0, 8).map((a: any) => ({
      actionType: ['buy_more', 'sell_partial', 'exit_category', 'enter_new', 'hold'].includes(String(a?.action_type)) ? String(a.action_type) : 'hold',
      category: String(a?.category ?? '').slice(0, 50),
      amountEur: Math.round(Number(a?.amount_eur ?? 0)),
      priority: ['high', 'medium', 'low'].includes(String(a?.priority)) ? String(a.priority) : 'medium',
      timeframeDays: Math.max(1, Number(a?.timeframe_days ?? 7)),
      expectedImpactEur: Math.round(Number(a?.expected_impact_eur ?? 0)),
      reasoning: String(a?.reasoning ?? '').slice(0, 300),
    })),
    mlModels: (parsed?.ml_models || []).slice(0, 5).map((m: any) => ({
      modelName: ['mean_variance', 'kelly_criterion', 'risk_parity', 'momentum_tilting', 'mean_reversion'].includes(String(m?.model_name)) ? String(m.model_name) : 'mean_variance',
      description: String(m?.description ?? '').slice(0, 200),
      recommendedAllocation: (m?.recommended_allocation || []).slice(0, 10).map((a: any) => ({
        category: String(a?.category ?? '').slice(0, 50),
        allocationPct: Math.round(Number(a?.allocation_pct ?? 0) * 10) / 10,
      })),
      expectedReturnPct: Math.round(Number(m?.expected_return_pct ?? 0) * 10) / 10,
      expectedRiskPct: Math.round(Number(m?.expected_risk_pct ?? 0) * 10) / 10,
      sharpeRatio: Math.round(Number(m?.sharpe_ratio ?? 0) * 100) / 100,
      confidencePct: Math.max(0, Math.min(100, Number(m?.confidence_pct ?? 50))),
    })),
    scenarios: (parsed?.scenarios || []).slice(0, 4).map((s: any) => ({
      scenario: ['aggressive', 'balanced', 'conservative', 'defensive'].includes(String(s?.scenario)) ? String(s.scenario) : 'balanced',
      totalExpectedReturnPct: Math.round(Number(s?.total_expected_return_pct ?? 0) * 10) / 10,
      totalExpectedRiskPct: Math.round(Number(s?.total_expected_risk_pct ?? 0) * 10) / 10,
      sharpeRatio: Math.round(Number(s?.sharpe_ratio ?? 0) * 100) / 100,
      maxDrawdownPct: Math.round(Number(s?.max_drawdown_pct ?? 0) * 10) / 10,
      bestFor: String(s?.best_for ?? '').slice(0, 200),
    })),
    summary: {
      currentPortfolioScore: Math.max(0, Math.min(100, Number(parsed?.summary?.current_portfolio_score ?? 50))),
      targetPortfolioScore: Math.max(0, Math.min(100, Number(parsed?.summary?.target_portfolio_score ?? 70))),
      improvementPct: Math.round(Number(parsed?.summary?.improvement_pct ?? 0) * 10) / 10,
      totalRebalanceAmountEur: Math.round(Number(parsed?.summary?.total_rebalance_amount_eur ?? 0)),
      expectedAnnualReturnImprovementEur: Math.round(Number(parsed?.summary?.expected_annual_return_improvement_eur ?? 0)),
      riskReductionPct: Math.round(Number(parsed?.summary?.risk_reduction_pct ?? 0) * 10) / 10,
      bestModel: ['mean_variance', 'kelly_criterion', 'risk_parity', 'momentum_tilting', 'mean_reversion'].includes(String(parsed?.summary?.best_model)) ? String(parsed.summary.best_model) : 'mean_variance',
      biggestRisk: String(parsed?.summary?.biggest_risk ?? '').slice(0, 200),
      biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 200),
      rebalancingEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.rebalancing_efficiency_score ?? 60))),
    },
  };
}
