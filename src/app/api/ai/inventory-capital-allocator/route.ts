// v6.66: AI Inventory Capital Allocator — alokacija kapitala z ML in portfolio optimization
// POST /api/ai/inventory-capital-allocator
// Body: { totalBudget?: number, riskTolerance?: string }
// Returns: { ok, allocator: { current, allocation, scenarios, mlModels, rebalancing, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const totalBudget = Math.max(0, Number(body?.totalBudget ?? 0));
    const riskTolerance = ['conservative', 'moderate', 'aggressive'].includes(String(body?.riskTolerance)) ? String(body.riskTolerance) : 'moderate';

    const since12m = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since12m, not: null } },
      select: { id: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 500, orderBy: { sellDate: 'desc' },
    });
    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true } } }, take: 100 });

    if (soldTrades.length === 0) return NextResponse.json({ ok: true, allocator: null, message: 'Ni podatkov za capital allocation.' });

    // Category stats
    const catMap = new Map<string, { count: number; invested: number; revenue: number; profit: number; marginPct: number; avgDaysToSell: number; riskScore: number }>();
    for (const t of soldTrades) {
      const cat = (t.category || 'drugo').toLowerCase();
      const cost = t.buyPrice + (t.buyFees ?? 0); const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const days = Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000)));
      if (!catMap.has(cat)) catMap.set(cat, { count: 0, invested: 0, revenue: 0, profit: 0, marginPct: 0, avgDaysToSell: 0, riskScore: 50 });
      const c = catMap.get(cat)!; c.count += 1; c.invested += cost; c.revenue += revenue; c.profit += revenue - cost; c.avgDaysToSell += days;
    }
    catMap.forEach(c => { c.marginPct = c.invested > 0 ? Math.round((c.profit / c.invested) * 1000) / 10 : 0; c.avgDaysToSell = Math.round(c.avgDaysToSell / c.count); c.riskScore = Math.max(10, Math.min(100, 50 + c.avgDaysToSell / 2 - c.marginPct / 2)); });

    const totalInvested = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalValue = heldTrades.reduce((s, t) => s + (t.listing?.aiEstimatedValue ?? t.buyPrice * 1.25), 0);
    const categoryStats = Array.from(catMap.entries()).map(([cat, c]) => ({ category: cat, ...c, invested: Math.round(c.invested), revenue: Math.round(c.revenue), profit: Math.round(c.profit) })).sort((a, b) => b.profit - a.profit);

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const catStr = categoryStats.slice(0, 8).map(c => `- ${c.category}: ${c.count}x | margin ${c.marginPct}% | ${c.avgDaysToSell}d | risk ${c.riskScore}/100 | profit ${c.profit}€`).join('\n');

    const prompt = `Si AI inventory capital allocator z ML in portfolio optimization theory.
Alocira kapital med kategorije za maksimalen risk-adjusted return.

TRENUTNO STANJE:
- Held capital: ${Math.round(totalInvested)}€
- Held value: ${Math.round(totalValue)}€
- Risk tolerance: ${riskTolerance}
${totalBudget > 0 ? `- Budget za realokacijo: ${totalBudget}€` : ''}

KATEGORIJE (12m):
${catStr}

5 ML modelov za portfolio optimization:
1. MEAN_VARIANCE: Markowitz optimal portfolio
2. KELLY_CRITERION: optimal bet size
3. RISK_PARITY: enak risk contribution
4. MOMENTUM_TILTING: povečaj nedavno dobre
5. ENSEMBLE: kombinacija vseh

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": {
    "total_capital_eur": <number>, "total_value_eur": <number>, "total_categories": <number>,
    "avg_margin_pct": <number>, "avg_risk_score": <number>, "diversification_score": <number 0-100>,
    "capital_efficiency_pct": <number 0-100>, "concentration_risk": "<low|medium|high>"
  },
  "allocation": [
    { "category": "<kategorija>", "current_allocation_pct": <number>, "target_allocation_pct": <number>, "current_invested_eur": <number>, "target_invested_eur": <number>, "rebalance_amount_eur": <number>, "rebalance_direction": "<increase|decrease|maintain>", "expected_return_pct": <number>, "expected_risk_pct": <number>, "sharpe_ratio": <number>, "reasoning": "<max 120 znakov>" }
  ],
  "scenarios": [
    { "scenario": "<conservative|balanced|aggressive>", "total_expected_return_pct": <number>, "total_expected_risk_pct": <number>, "sharpe_ratio": <number>, "max_drawdown_pct": <number>, "expected_annual_profit_eur": <number>, "best_for": "<max 100 znakov>" }
  ],
  "ml_models": [
    { "model": "<mean_variance|kelly_criterion|risk_parity|momentum_tilting|ensemble>", "recommended_allocation": [{"category": "<kategorija>", "allocation_pct": <number>}], "expected_return_pct": <number>, "expected_risk_pct": <number>, "sharpe_ratio": <number>, "confidence_pct": <number 0-100> }
  ],
  "rebalancing": [
    { "action": "<buy_more|sell_partial|exit_category|enter_new|hold>", "category": "<kategorija>", "amount_eur": <number>, "priority": "<high|medium|low>", "timeframe_days": <number>, "expected_impact_eur": <number>, "reasoning": "<max 150 znakov>" }
  ],
  "summary": {
    "current_portfolio_score": <number 0-100>, "target_portfolio_score": <number 0-100>, "improvement_pct": <number>,
    "total_rebalance_amount_eur": <number>, "expected_annual_return_improvement_eur": <number>,
    "risk_reduction_pct": <number>, "best_model": "<max 80 znakov>", "biggest_risk": "<max 100 znakov>",
    "biggest_opportunity": "<max 100 znakov>", "capital_allocation_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); }
      else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const validCats = new Set(categoryStats.map(c => c.category));

    const allocator = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      current: {
        totalCapitalEur: Math.round(Number(parsed?.current?.total_capital_eur ?? totalInvested)),
        totalValueEur: Math.round(Number(parsed?.current?.total_value_eur ?? totalValue)),
        totalCategories: Math.max(0, Number(parsed?.current?.total_categories ?? catMap.size)),
        avgMarginPct: Math.round(Number(parsed?.current?.avg_margin_pct ?? Array.from(catMap.values()).reduce((s, c) => s + c.marginPct, 0) / Math.max(1, catMap.size)) * 10) / 10,
        avgRiskScore: Math.round(Number(parsed?.current?.avg_risk_score ?? 50)),
        diversificationScore: Math.max(0, Math.min(100, Number(parsed?.current?.diversification_score ?? 50))),
        capitalEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.current?.capital_efficiency_pct ?? 60))),
        concentrationRisk: ['low', 'medium', 'high'].includes(String(parsed?.current?.concentration_risk)) ? String(parsed.current.concentration_risk) : 'medium',
      },
      allocation: (parsed?.allocation || []).filter((a: any) => validCats.has(String(a?.category ?? ''))).slice(0, 10).map((a: any) => ({
        category: String(a?.category ?? '').slice(0, 50),
        currentAllocationPct: Math.round(Number(a?.current_allocation_pct ?? 0) * 10) / 10,
        targetAllocationPct: Math.round(Number(a?.target_allocation_pct ?? 0) * 10) / 10,
        currentInvestedEur: Math.round(Number(a?.current_invested_eur ?? 0)),
        targetInvestedEur: Math.round(Number(a?.target_invested_eur ?? 0)),
        rebalanceAmountEur: Math.round(Number(a?.rebalance_amount_eur ?? 0)),
        rebalanceDirection: ['increase', 'decrease', 'maintain'].includes(String(a?.rebalance_direction)) ? String(a.rebalance_direction) : 'maintain',
        expectedReturnPct: Math.round(Number(a?.expected_return_pct ?? 0) * 10) / 10,
        expectedRiskPct: Math.round(Number(a?.expected_risk_pct ?? 0) * 10) / 10,
        sharpeRatio: Math.round(Number(a?.sharpe_ratio ?? 0) * 100) / 100,
        reasoning: String(a?.reasoning ?? '').slice(0, 250),
      })),
      scenarios: (parsed?.scenarios || []).slice(0, 3).map((s: any) => ({
        scenario: ['conservative', 'balanced', 'aggressive'].includes(String(s?.scenario)) ? String(s.scenario) : 'balanced',
        totalExpectedReturnPct: Math.round(Number(s?.total_expected_return_pct ?? 0) * 10) / 10,
        totalExpectedRiskPct: Math.round(Number(s?.total_expected_risk_pct ?? 0) * 10) / 10,
        sharpeRatio: Math.round(Number(s?.sharpe_ratio ?? 0) * 100) / 100,
        maxDrawdownPct: Math.round(Number(s?.max_drawdown_pct ?? 0) * 10) / 10,
        expectedAnnualProfitEur: Math.round(Number(s?.expected_annual_profit_eur ?? 0)),
        bestFor: String(s?.best_for ?? '').slice(0, 200),
      })),
      mlModels: (parsed?.ml_models || []).slice(0, 5).map((m: any) => ({
        model: ['mean_variance', 'kelly_criterion', 'risk_parity', 'momentum_tilting', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
        recommendedAllocation: (m?.recommended_allocation || []).slice(0, 10).map((a: any) => ({ category: String(a?.category ?? '').slice(0, 50), allocationPct: Math.round(Number(a?.allocation_pct ?? 0) * 10) / 10 })),
        expectedReturnPct: Math.round(Number(m?.expected_return_pct ?? 0) * 10) / 10,
        expectedRiskPct: Math.round(Number(m?.expected_risk_pct ?? 0) * 10) / 10,
        sharpeRatio: Math.round(Number(m?.sharpe_ratio ?? 0) * 100) / 100,
        confidencePct: Math.max(0, Math.min(100, Number(m?.confidence_pct ?? 50))),
      })),
      rebalancing: (parsed?.rebalancing || []).slice(0, 8).map((r: any) => ({
        action: ['buy_more', 'sell_partial', 'exit_category', 'enter_new', 'hold'].includes(String(r?.action)) ? String(r.action) : 'hold',
        category: String(r?.category ?? '').slice(0, 50), amountEur: Math.round(Number(r?.amount_eur ?? 0)),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        timeframeDays: Math.max(1, Number(r?.timeframe_days ?? 7)), expectedImpactEur: Math.round(Number(r?.expected_impact_eur ?? 0)),
        reasoning: String(r?.reasoning ?? '').slice(0, 300),
      })),
      summary: {
        currentPortfolioScore: Math.max(0, Math.min(100, Number(parsed?.summary?.current_portfolio_score ?? 50))),
        targetPortfolioScore: Math.max(0, Math.min(100, Number(parsed?.summary?.target_portfolio_score ?? 70))),
        improvementPct: Math.round(Number(parsed?.summary?.improvement_pct ?? 0) * 10) / 10,
        totalRebalanceAmountEur: Math.round(Number(parsed?.summary?.total_rebalance_amount_eur ?? 0)),
        expectedAnnualReturnImprovementEur: Math.round(Number(parsed?.summary?.expected_annual_return_improvement_eur ?? 0)),
        riskReductionPct: Math.round(Number(parsed?.summary?.risk_reduction_pct ?? 0) * 10) / 10,
        bestModel: ['mean_variance', 'kelly_criterion', 'risk_parity', 'momentum_tilting', 'ensemble'].includes(String(parsed?.summary?.best_model)) ? String(parsed.summary.best_model) : 'ensemble',
        biggestRisk: String(parsed?.summary?.biggest_risk ?? '').slice(0, 200),
        biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 200),
        capitalAllocationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.capital_allocation_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, allocator });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
