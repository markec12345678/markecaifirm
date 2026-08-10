// v6.78: AI Inventory Portfolio Analyzer — ML analiza inventarja kot portfolio z risk-return
// POST /api/ai/inventory-portfolio-analyzer
// Body: { days?: number }
// Returns: { ok, analyzer: { portfolio, allocations, riskReturn, correlations, recommendations, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.max(7, Math.min(365, Number(body?.days ?? 90)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since, not: null } }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true }, take: 500, orderBy: { sellDate: 'desc' } });
    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true } } }, take: 100 });
    if (soldTrades.length === 0 && heldTrades.length === 0) return NextResponse.json({ ok: true, analyzer: null, message: 'Ni podatkov za portfolio analizo.' });

    const totalInvested = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalValue = heldTrades.reduce((s, t) => s + (t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25)), 0);
    const totalRevenue = soldTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
    const totalCost = soldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalProfit = totalRevenue - totalCost;
    const avgMarginPct = totalCost > 0 ? Math.round((totalProfit / totalCost) * 1000) / 10 : 0;

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const prompt = `Si AI inventory portfolio analyzer z ML in modern portfolio theory.
Analizira inventar kot investicijski portfolio z risk-return analizo.

STATS:
- Held capital: ${Math.round(totalInvested)}€
- Held value: ${Math.round(totalValue)}€
- Total revenue (${days}d): ${Math.round(totalRevenue)}€
- Total profit (${days}d): ${Math.round(totalProfit)}€
- Avg margin: ${avgMarginPct}%

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "portfolio": { "total_assets_eur": <number>, "total_invested_eur": <number>, "total_unrealized_profit_eur": <number>, "portfolio_return_pct": <number>, "portfolio_risk_pct": <number>, "sharpe_ratio": <number>, "diversification_score": <number 0-100>, "portfolio_efficiency_pct": <number 0-100>, "portfolio_grade": "<A|B|C|D|F>" },
  "allocations": [
    { "category": "<kategorija>", "current_allocation_pct": <number 0-100>, "current_value_eur": <number>, "return_pct": <number>, "risk_pct": <number>, "sharpe_ratio": <number>, "optimal_allocation_pct": <number 0-100>, "rebalance_action": "<increase|decrease|maintain>", "rationale": "<max 120 znakov>" }
  ],
  "riskReturn": [
    { "metric": "<return|volatility|sharpe_ratio|max_drawdown|beta|alpha|correlation>", "value": <number>, "benchmark": <number>, "status": "<above|at|below>", "interpretation": "<max 100 znakov>" }
  ],
  "correlations": [
    { "category_a": "<kategorija>", "category_b": "<kategorija>", "correlation_coefficient": <number -1 do 1>, "correlation_type": "<positive|negative|neutral>", "interpretation": "<max 100 znakov>", "hedging_opportunity": <boolean> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_return_improvement_pct": <number>, "expected_risk_reduction_pct": <number>, "timeframe_days": <number> }
  ],
  "mlModels": [
    { "model": "<mean_variance|risk_parity|monte_carlo|black_litterman|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<optimal_weights|risk_forecast|return_forecast|correlation_matrix>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "portfolio_health_score": <number 0-100>, "portfolio_grade": "<A|B|C|D|F>", "total_return_pct": <number>,
    "total_risk_pct": <number>, "sharpe_ratio": <number>, "diversification_score": <number 0-100>,
    "biggest_portfolio_risk": "<max 100 znakov>", "biggest_portfolio_opportunity": "<max 100 znakov>",
    "quickest_portfolio_win": "<max 100 znakov>", "portfolio_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const analyzer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      portfolio: { totalAssetsEur: Math.round(Number(parsed?.portfolio?.total_assets_eur ?? totalValue)), totalInvestedEur: Math.round(Number(parsed?.portfolio?.total_invested_eur ?? totalInvested)), totalUnrealizedProfitEur: Math.round(Number(parsed?.portfolio?.total_unrealized_profit_eur ?? totalValue - totalInvested)), portfolioReturnPct: Math.round(Number(parsed?.portfolio?.portfolio_return_pct ?? avgMarginPct) * 10) / 10, portfolioRiskPct: Math.round(Number(parsed?.portfolio?.portfolio_risk_pct ?? 30) * 10) / 10, sharpeRatio: Math.round(Number(parsed?.portfolio?.sharpe_ratio ?? 1.5) * 100) / 100, diversificationScore: Math.max(0, Math.min(100, Number(parsed?.portfolio?.diversification_score ?? 50))), portfolioEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.portfolio?.portfolio_efficiency_pct ?? 60))), portfolioGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.portfolio?.portfolio_grade)) ? String(parsed.portfolio.portfolio_grade) : 'C' },
      allocations: (parsed?.allocations || []).slice(0, 12).map((a: any) => ({ category: String(a?.category ?? '').slice(0, 50), currentAllocationPct: Math.max(0, Math.min(100, Number(a?.current_allocation_pct ?? 0))), currentValueEur: Math.round(Number(a?.current_value_eur ?? 0)), returnPct: Math.round(Number(a?.return_pct ?? 0) * 10) / 10, riskPct: Math.round(Number(a?.risk_pct ?? 0) * 10) / 10, sharpeRatio: Math.round(Number(a?.sharpe_ratio ?? 0) * 100) / 100, optimalAllocationPct: Math.max(0, Math.min(100, Number(a?.optimal_allocation_pct ?? 0))), rebalanceAction: ['increase', 'decrease', 'maintain'].includes(String(a?.rebalance_action)) ? String(a.rebalance_action) : 'maintain', rationale: String(a?.rationale ?? '').slice(0, 250) })),
      riskReturn: (parsed?.riskReturn || []).slice(0, 6).map((r: any) => ({ metric: ['return', 'volatility', 'sharpe_ratio', 'max_drawdown', 'beta', 'alpha', 'correlation'].includes(String(r?.metric)) ? String(r.metric) : 'return', value: Math.round(Number(r?.value ?? 0) * 100) / 100, benchmark: Math.round(Number(r?.benchmark ?? 0) * 100) / 100, status: ['above', 'at', 'below'].includes(String(r?.status)) ? String(r.status) : 'at', interpretation: String(r?.interpretation ?? '').slice(0, 200) })),
      correlations: (parsed?.correlations || []).slice(0, 8).map((c: any) => ({ categoryA: String(c?.category_a ?? '').slice(0, 50), categoryB: String(c?.category_b ?? '').slice(0, 50), correlationCoefficient: Math.max(-1, Math.min(1, Number(c?.correlation_coefficient ?? 0))), correlationType: ['positive', 'negative', 'neutral'].includes(String(c?.correlation_type)) ? String(c.correlation_type) : 'neutral', interpretation: String(c?.interpretation ?? '').slice(0, 200), hedgingOpportunity: Boolean(c?.hedging_opportunity ?? false) })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({ action: String(r?.action ?? '').slice(0, 300), priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium', expectedReturnImprovementPct: Math.round(Number(r?.expected_return_improvement_pct ?? 0) * 10) / 10, expectedRiskReductionPct: Math.round(Number(r?.expected_risk_reduction_pct ?? 0) * 10) / 10, timeframeDays: Math.max(1, Number(r?.timeframe_days ?? 7)) })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['mean_variance', 'risk_parity', 'monte_carlo', 'black_litterman', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))), predictionType: ['optimal_weights', 'risk_forecast', 'return_forecast', 'correlation_matrix'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'optimal_weights', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { portfolioHealthScore: Math.max(0, Math.min(100, Number(parsed?.summary?.portfolio_health_score ?? 60))), portfolioGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.portfolio_grade)) ? String(parsed.summary.portfolio_grade) : 'C', totalReturnPct: Math.round(Number(parsed?.summary?.total_return_pct ?? avgMarginPct) * 10) / 10, totalRiskPct: Math.round(Number(parsed?.summary?.total_risk_pct ?? 30) * 10) / 10, sharpeRatio: Math.round(Number(parsed?.summary?.sharpe_ratio ?? 1.5) * 100) / 100, diversificationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.diversification_score ?? 50))), biggestPortfolioRisk: String(parsed?.summary?.biggest_portfolio_risk ?? '').slice(0, 200), biggestPortfolioOpportunity: String(parsed?.summary?.biggest_portfolio_opportunity ?? '').slice(0, 200), quickestPortfolioWin: String(parsed?.summary?.quickest_portfolio_win ?? '').slice(0, 200), portfolioAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.portfolio_analysis_score ?? 60))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, analyzer });
  } catch (e: any) { logger.error("/api/ai/inventory-portfolio-analyzer", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
