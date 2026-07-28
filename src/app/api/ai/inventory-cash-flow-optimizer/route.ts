// v6.61: AI Inventory Cash Flow Optimizer — optimizira cash flow z ML forecasting in working capital management
// POST /api/ai/inventory-cash-flow-optimizer
// Body: { monthsAhead?: number }
// Returns: { ok, optimizer: { current, forecast, optimization, scenarios, workingCapital, recommendations, summary } }

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
    const monthsAhead = Math.max(1, Math.min(12, Number(body?.monthsAhead ?? 6)));

    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since, not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 300,
      orderBy: { sellDate: 'desc' },
    });

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 100,
    });

    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return NextResponse.json({ ok: true, optimizer: null, message: 'Ni podatkov za cash flow optimizacijo.' });
    }

    // Compute current cash flow metrics
    const now = Date.now();
    const last30dRevenue = soldTrades.filter(t => t.sellDate && t.sellDate >= new Date(now - 30 * 24 * 60 * 60 * 1000)).reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
    const last30dCost = soldTrades.filter(t => t.sellDate && t.sellDate >= new Date(now - 30 * 24 * 60 * 60 * 1000)).reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const last30dProfit = last30dRevenue - last30dCost;

    const capitalInvested = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const inventoryValue = heldTrades.reduce((s, t) => s + (t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25)), 0);
    const avgDaysHeld = heldTrades.length > 0 ? Math.round(heldTrades.reduce((s, t) => s + Math.round((now - t.buyDate.getTime()) / (24*60*60*1000)), 0) / heldTrades.length) : 0;
    const staleCapital = heldTrades.filter(t => Math.round((now - t.buyDate.getTime()) / (24*60*60*1000)) > 30).reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const deadCapital = heldTrades.filter(t => Math.round((now - t.buyDate.getTime()) / (24*60*60*1000)) > 90).reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si AI inventory cash flow optimizer z ML forecasting in working capital management.
Optimizira cash flow za naslednjih ${monthsAhead} mesecev.

TRENUTNO STANJE:
- Prihodek (30d): ${Math.round(last30dRevenue)}€
- Cost (30d): ${Math.round(last30dCost)}€
- Profit (30d): ${Math.round(last30dProfit)}€
- Vložen kapital: ${Math.round(capitalInvested)}€
- Vrednost inventarja: ${Math.round(inventoryValue)}€
- Povp dni v skladišču: ${avgDaysHeld}
- Stale capital (>30d): ${Math.round(staleCapital)}€
- Dead capital (>90d): ${Math.round(deadCapital)}€
- Held items: ${heldTrades.length}

Cash flow optimization cilji:
1. MAXIMIZE_LIQUIDITY: več cash na voljo
2. MINIMIZE_CAPITAL_TIED: manj kapitala v nizko-likvidnem inventarju
3. OPTIMIZE_TURNOVER: hitrejši obrat inventarja
4. SMOOTH_CASH_FLOW: zmanjšaj nihanja
5. BUILD_RESERVE: ustvari rezervo za slow sezone

Working capital management:
- CURRENT_ASSETS: cash + inventory + receivables
- CURRENT_LIABILITIES: suppliers + fees + obligations
- WORKING_CAPITAL: current_assets - current_liabilities
- CASH_CONVERSION_CYCLE: time from buy to cash from sell

Cash flow strategije:
- ACCELERATE_SALES: hitrejša prodaja stalled inventarja
- DELAY_PURCHASES: nakupuj pozneje (just-in-time)
- LIQUIDATE_DEAD: prodaj dead inventory za takojšen cash
- FACTOR_RECEIVABLES: proda invoices za takojšen cash
- LEVERAGE_CREDIT: kratkoročno kredit za cash gap
- SEASONAL_RESERVE: rezerva za seasonal slow period

ML forecasting:
- ARIMA: time series forecast
- LSTM: deep learning za sequential patterns
- PROPHET: Facebook Prophet za seasonal
- ENSEMBLE: kombinacija vseh

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": {
    "monthly_revenue_eur": <number>,
    "monthly_cost_eur": <number>,
    "monthly_profit_eur": <number>,
    "capital_invested_eur": <number>,
    "inventory_value_eur": <number>,
    "stale_capital_eur": <number>,
    "dead_capital_eur": <number>,
    "cash_conversion_cycle_days": <number>,
    "working_capital_eur": <number>,
    "current_ratio": <number>,
    "cash_flow_score": <number 0-100>
  },
  "forecast": [
    {
      "month": <1-12>,
      "projected_inflow_eur": <number>,
      "projected_outflow_eur": <number>,
      "net_cash_flow_eur": <number>,
      "cumulative_cash_eur": <number>,
      "confidence_pct": <number 0-100>,
      "key_assumptions": ["<max 80 znakov>"]
    }
  ],
  "optimization": [
    {
      "strategy": "<accelerate_sales|delay_purchases|liquidate_dead|factor_receivables|leverage_credit|seasonal_reserve>",
      "description": "<max 120 znakov>",
      "expected_cash_impact_eur": <number>,
      "timeframe_days": <number>,
      "implementation_difficulty": "<low|medium|high>",
      "risk_level": "<low|medium|high>",
      "priority": "<high|medium|low>"
    }
  ],
  "scenarios": [
    {
      "scenario": "<base_case|optimized|aggressive|conservative>",
      "total_cash_generated_eur": <number>,
      "avg_monthly_cash_flow_eur": <number>,
      "cash_flow_stability_pct": <number 0-100>,
      "peak_cash_eur": <number>,
      "trough_cash_eur": <number>,
      "probability_pct": <number 0-100>
    }
  ],
  "working_capital": [
    {
      "component": "<cash|inventory|receivables|payables|fees>",
      "current_value_eur": <number>,
      "optimized_value_eur": <number>,
      "change_eur": <number>,
      "optimization_action": "<max 120 znakov>",
      "impact_on_cash_flow_eur": <number>
    }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_cash_impact_eur": <number>, "timeframe_days": <number>, "risk_level": "<low|medium|high>" }
  ],
  "summary": {
    "current_monthly_cash_flow_eur": <number>,
    "projected_monthly_cash_flow_eur": <number>,
    "improvement_pct": <number>,
    "total_cash_improvement_eur": <number>,
    "cash_flow_stability_score": <number 0-100>,
    "biggest_cash_flow_bottleneck": "<max 100 znakov>",
    "biggest_cash_opportunity": "<max 100 znakov>",
    "cash_flow_optimization_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      current: {
        monthlyRevenueEur: Math.round(Number(parsed?.current?.monthly_revenue_eur ?? last30dRevenue)),
        monthlyCostEur: Math.round(Number(parsed?.current?.monthly_cost_eur ?? last30dCost)),
        monthlyProfitEur: Math.round(Number(parsed?.current?.monthly_profit_eur ?? last30dProfit)),
        capitalInvestedEur: Math.round(Number(parsed?.current?.capital_invested_eur ?? capitalInvested)),
        inventoryValueEur: Math.round(Number(parsed?.current?.inventory_value_eur ?? inventoryValue)),
        staleCapitalEur: Math.round(Number(parsed?.current?.stale_capital_eur ?? staleCapital)),
        deadCapitalEur: Math.round(Number(parsed?.current?.dead_capital_eur ?? deadCapital)),
        cashConversionCycleDays: Math.max(0, Number(parsed?.current?.cash_conversion_cycle_days ?? avgDaysHeld)),
        workingCapitalEur: Math.round(Number(parsed?.current?.working_capital_eur ?? inventoryValue - capitalInvested)),
        currentRatio: Math.round(Number(parsed?.current?.current_ratio ?? 1.5) * 100) / 100,
        cashFlowScore: Math.max(0, Math.min(100, Number(parsed?.current?.cash_flow_score ?? 60))),
      },
      forecast: (parsed?.forecast || []).slice(0, monthsAhead).map((f: any) => ({
        month: Math.max(1, Math.min(12, Number(f?.month ?? 1))),
        projectedInflowEur: Math.round(Number(f?.projected_inflow_eur ?? 0)),
        projectedOutflowEur: Math.round(Number(f?.projected_outflow_eur ?? 0)),
        netCashFlowEur: Math.round(Number(f?.net_cash_flow_eur ?? 0)),
        cumulativeCashEur: Math.round(Number(f?.cumulative_cash_eur ?? 0)),
        confidencePct: Math.max(0, Math.min(100, Number(f?.confidence_pct ?? 60))),
        keyAssumptions: (f?.key_assumptions || []).slice(0, 4).map((a: any) => String(a).slice(0, 150)),
      })),
      optimization: (parsed?.optimization || []).slice(0, 6).map((o: any) => ({
        strategy: ['accelerate_sales', 'delay_purchases', 'liquidate_dead', 'factor_receivables', 'leverage_credit', 'seasonal_reserve'].includes(String(o?.strategy)) ? String(o.strategy) : 'accelerate_sales',
        description: String(o?.description ?? '').slice(0, 250),
        expectedCashImpactEur: Math.round(Number(o?.expected_cash_impact_eur ?? 0)),
        timeframeDays: Math.max(1, Number(o?.timeframe_days ?? 7)),
        implementationDifficulty: ['low', 'medium', 'high'].includes(String(o?.implementation_difficulty)) ? String(o.implementation_difficulty) : 'medium',
        riskLevel: ['low', 'medium', 'high'].includes(String(o?.risk_level)) ? String(o.risk_level) : 'medium',
        priority: ['high', 'medium', 'low'].includes(String(o?.priority)) ? String(o.priority) : 'medium',
      })),
      scenarios: (parsed?.scenarios || []).slice(0, 4).map((s: any) => ({
        scenario: ['base_case', 'optimized', 'aggressive', 'conservative'].includes(String(s?.scenario)) ? String(s.scenario) : 'base_case',
        totalCashGeneratedEur: Math.round(Number(s?.total_cash_generated_eur ?? 0)),
        avgMonthlyCashFlowEur: Math.round(Number(s?.avg_monthly_cash_flow_eur ?? 0)),
        cashFlowStabilityPct: Math.max(0, Math.min(100, Number(s?.cash_flow_stability_pct ?? 60))),
        peakCashEur: Math.round(Number(s?.peak_cash_eur ?? 0)),
        troughCashEur: Math.round(Number(s?.trough_cash_eur ?? 0)),
        probabilityPct: Math.max(0, Math.min(100, Number(s?.probability_pct ?? 50))),
      })),
      workingCapital: (parsed?.working_capital || []).slice(0, 5).map((w: any) => ({
        component: ['cash', 'inventory', 'receivables', 'payables', 'fees'].includes(String(w?.component)) ? String(w.component) : 'cash',
        currentValueEur: Math.round(Number(w?.current_value_eur ?? 0)),
        optimizedValueEur: Math.round(Number(w?.optimized_value_eur ?? 0)),
        changeEur: Math.round(Number(w?.change_eur ?? 0)),
        optimizationAction: String(w?.optimization_action ?? '').slice(0, 250),
        impactOnCashFlowEur: Math.round(Number(w?.impact_on_cash_flow_eur ?? 0)),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        expectedCashImpactEur: Math.round(Number(r?.expected_cash_impact_eur ?? 0)),
        timeframeDays: Math.max(1, Number(r?.timeframe_days ?? 7)),
        riskLevel: ['low', 'medium', 'high'].includes(String(r?.risk_level)) ? String(r.risk_level) : 'medium',
      })),
      summary: {
        currentMonthlyCashFlowEur: Math.round(Number(parsed?.summary?.current_monthly_cash_flow_eur ?? last30dProfit)),
        projectedMonthlyCashFlowEur: Math.round(Number(parsed?.summary?.projected_monthly_cash_flow_eur ?? 0)),
        improvementPct: Math.round(Number(parsed?.summary?.improvement_pct ?? 0) * 10) / 10,
        totalCashImprovementEur: Math.round(Number(parsed?.summary?.total_cash_improvement_eur ?? 0)),
        cashFlowStabilityScore: Math.max(0, Math.min(100, Number(parsed?.summary?.cash_flow_stability_score ?? 60))),
        biggestCashFlowBottleneck: String(parsed?.summary?.biggest_cash_flow_bottleneck ?? '').slice(0, 200),
        biggestCashOpportunity: String(parsed?.summary?.biggest_cash_opportunity ?? '').slice(0, 200),
        cashFlowOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.cash_flow_optimization_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
