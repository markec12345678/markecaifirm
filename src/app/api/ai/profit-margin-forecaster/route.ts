/**
 * @deprecated v8.94 — uporabi `/api/ai/profit-margin-forecaster-pro` namesto tega.
 * Zastareli v1 — Pro verzija je najnovejša.
 * Ta endpoint bo odstranjen v v9.0. Glej ENDPOINTS_AUDIT.md za migracijski načrt.
 */
// v6.54: AI Profit Margin Forecaster — napove maržo za naslednje N nakupov in kategorije
// POST /api/ai/profit-margin-forecaster
// Body: { monthsAhead?: number, plannedPurchases?: number }
// Returns: { ok, forecaster: { current, forecast, scenarios, categoryProjections, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';
import { logDeprecatedCall } from '@/lib/deprecated-redirect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  logDeprecatedCall('/api/ai/profit-margin-forecaster', req, '/api/ai/profit-margin-forecaster-pro');
  try {
    const body = await req.json().catch(() => ({}));
    const monthsAhead = Math.max(1, Math.min(24, Number(body?.monthsAhead ?? 6)));
    const plannedPurchases = Math.max(1, Math.min(50, Number(body?.plannedPurchases ?? 10)));

    const since12m = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const soldTrades12m = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since12m, not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, buyDate: true, sellDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    const soldTrades90 = soldTrades12m.filter(t => t.sellDate && t.sellDate >= since90);

    if (soldTrades12m.length === 0) {
      return NextResponse.json({ ok: true, forecaster: null, message: 'Ni prodaj za margin forecast.' });
    }

    // Compute current metrics
    const calcStats = (trades: typeof soldTrades12m) => {
      if (trades.length === 0) return { count: 0, profit: 0, revenue: 0, cost: 0, marginPct: 0, avgDaysToSell: 0 };
      const revenue = trades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
      const cost = trades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
      const profit = revenue - cost;
      const marginPct = cost > 0 ? (profit / cost) * 100 : 0;
      const totalDays = trades.reduce((s, t) => s + Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000))), 0);
      const avgDays = Math.round(totalDays / trades.length);
      return { count: trades.length, profit: Math.round(profit), revenue: Math.round(revenue), cost: Math.round(cost), marginPct: Math.round(marginPct * 10) / 10, avgDaysToSell: avgDays };
    };

    const currentStats = calcStats(soldTrades12m);
    const recentStats = calcStats(soldTrades90);
    const monthlyAvgProfit = currentStats.profit / 12;

    // Category breakdown
    const catAgg = new Map<string, { count: number; profit: number; revenue: number; cost: number; marginPct: number; daysToSell: number }>();
    for (const t of soldTrades12m) {
      const cat = (t.category || 'drugo').toLowerCase();
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const profit = revenue - cost;
      const days = Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000)));
      if (!catAgg.has(cat)) catAgg.set(cat, { count: 0, profit: 0, revenue: 0, cost: 0, marginPct: 0, daysToSell: 0 });
      const c = catAgg.get(cat)!;
      c.count += 1; c.profit += profit; c.revenue += revenue; c.cost += cost; c.daysToSell += days;
    }
    const categoryStats = Array.from(catAgg.entries()).map(([cat, c]) => {
      c.marginPct = c.cost > 0 ? Math.round(((c.profit / c.cost) * 100) * 10) / 10 : 0;
      const avgDays = c.count > 0 ? Math.round(c.daysToSell / c.count) : 0;
      return { category: cat, count: c.count, profit: Math.round(c.profit), revenue: Math.round(c.revenue), cost: Math.round(c.cost), marginPct: c.marginPct, avgDaysToSell: avgDays };
    });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const catStr = categoryStats.slice(0, 8).map(c =>
      `- ${c.category} | ${c.count}x | profit ${c.profit}€ | revenue ${c.revenue}€ | margin ${c.marginPct}% | povp ${c.avgDaysToSell}d`
    ).join('\n');

    const prompt = `Si AI profit margin forecaster za slovenske oglasne platforme.
Napove maržo in profit za naslednjih ${monthsAhead} mesecev in ${plannedPurchases} načrtovanih nakupov.

TRENUTNO STANJE (zadnjih 12 mesecev):
- Skupno prodano: ${currentStats.count} itemov
- Skupni prihodek: ${currentStats.revenue}€
- Skupni cost: ${currentStats.cost}€
- Skupni profit: ${currentStats.profit}€
- Povprečna marža: ${currentStats.marginPct}%
- Povp dni do prodaje: ${currentStats.avgDaysToSell}
- Mesečni povprečni profit: ${Math.round(monthlyAvgProfit)}€

ZADNJI 90 DNI:
- ${recentStats.count} prodanih itemov
- Profit: ${recentStats.profit}€
- Marža: ${recentStats.marginPct}%

KATEGORIJE (zadnjih 12m):
${catStr}

Napovedni modeli:
1. LINEAR: trend se nadaljuje linearno
2. SEASONAL: upošteva sezonske nihanja
3. MOMENTUM: nedavni trend (90d) pospeši
4. REGRESSION: če marža pada, projectira nadaljnji padec
5. GROWTH: optimističen scenarij z izboljšavami

Forecast faktorji:
- HISTORICAL_MARGIN: povprečna marža zadnjih 12m
- RECENT_TREND: marža zadnjih 90d (momentum)
- CATEGORY_PERFORMANCE: najboljše kategorije
- SEASONALITY: sezonski vpliv na marže
- MARKET_CONDITIONS: konkurenca, demand, supply
- IMPROVEMENTS: optimizacije v pipeline (SEO, price psychology)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": {
    "current_margin_pct": <number>,
    "current_monthly_profit_eur": <number>,
    "current_monthly_purchases": <number>,
    "trend_3m": "<rising|falling|stable>",
    "trend_6m": "<rising|falling|stable>",
    "best_month_profit_eur": <number>,
    "worst_month_profit_eur": <number>
  },
  "forecast": [
    {
      "month": <1-24>,
      "projected_margin_pct": <number>,
      "projected_revenue_eur": <number>,
      "projected_cost_eur": <number>,
      "projected_profit_eur": <number>,
      "projected_purchases": <number>,
      "cumulative_profit_eur": <number>,
      "confidence_pct": <number 0-100>,
      "key_assumptions": ["<max 80 znakov>"]
    }
  ],
  "scenarios": [
    {
      "scenario": "<pessimistic|realistic|optimistic|stretch>",
      "avg_margin_pct": <number>,
      "total_profit_eur": <number>,
      "total_revenue_eur": <number>,
      "avg_monthly_profit_eur": <number>,
      "probability_pct": <number 0-100>,
      "key_driver": "<max 100 znakov>"
    }
  ],
  "category_projections": [
    {
      "category": "<kategorija>",
      "current_margin_pct": <number>,
      "projected_margin_pct": <number>,
      "projected_purchases": <number>,
      "projected_profit_eur": <number>,
      "trend": "<rising|falling|stable>",
      "recommendation": "<invest_more|maintain|reduce|exit>",
      "reasoning": "<max 120 znakov>"
    }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_margin_improvement_pct": <number>, "expected_profit_impact_eur": <number>, "implementation_months": <number> }
  ],
  "summary": {
    "current_monthly_profit_eur": <number>,
    "projected_monthly_profit_${monthsAhead}m_eur": <number>,
    "total_projected_profit_eur": <number>,
    "avg_projected_margin_pct": <number>,
    "margin_improvement_pct": <number>,
    "best_case_scenario": "<max 80 znakov>",
    "worst_case_scenario": "<max 80 znakov>",
    "biggest_margin_driver": "<max 100 znakov>",
    "biggest_margin_threat": "<max 100 znakov>",
    "forecast_confidence_score": <number 0-100>
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
    const validCategories = new Set(categoryStats.map(c => c.category));

    const forecaster = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      current: {
        currentMarginPct: Math.round(Number(parsed?.current?.current_margin_pct ?? currentStats.marginPct) * 10) / 10,
        currentMonthlyProfitEur: Math.round(Number(parsed?.current?.current_monthly_profit_eur ?? monthlyAvgProfit)),
        currentMonthlyPurchases: Math.max(0, Number(parsed?.current?.current_monthly_purchases ?? Math.round(currentStats.count / 12))),
        trend3m: ['rising', 'falling', 'stable'].includes(String(parsed?.current?.trend_3m)) ? String(parsed.current.trend_3m) : 'stable',
        trend6m: ['rising', 'falling', 'stable'].includes(String(parsed?.current?.trend_6m)) ? String(parsed.current.trend_6m) : 'stable',
        bestMonthProfitEur: Math.round(Number(parsed?.current?.best_month_profit_eur ?? 0)),
        worstMonthProfitEur: Math.round(Number(parsed?.current?.worst_month_profit_eur ?? 0)),
      },
      forecast: (parsed?.forecast || []).slice(0, monthsAhead).map((f: any) => ({
        month: Math.max(1, Math.min(24, Number(f?.month ?? 1))),
        projectedMarginPct: Math.round(Number(f?.projected_margin_pct ?? currentStats.marginPct) * 10) / 10,
        projectedRevenueEur: Math.round(Number(f?.projected_revenue_eur ?? 0)),
        projectedCostEur: Math.round(Number(f?.projected_cost_eur ?? 0)),
        projectedProfitEur: Math.round(Number(f?.projected_profit_eur ?? 0)),
        projectedPurchases: Math.max(0, Number(f?.projected_purchases ?? 0)),
        cumulativeProfitEur: Math.round(Number(f?.cumulative_profit_eur ?? 0)),
        confidencePct: Math.max(0, Math.min(100, Number(f?.confidence_pct ?? 50))),
        keyAssumptions: (f?.key_assumptions || []).slice(0, 4).map((a: any) => String(a).slice(0, 150)),
      })),
      scenarios: (parsed?.scenarios || []).slice(0, 4).map((s: any) => ({
        scenario: ['pessimistic', 'realistic', 'optimistic', 'stretch'].includes(String(s?.scenario)) ? String(s.scenario) : 'realistic',
        avgMarginPct: Math.round(Number(s?.avg_margin_pct ?? 0) * 10) / 10,
        totalProfitEur: Math.round(Number(s?.total_profit_eur ?? 0)),
        totalRevenueEur: Math.round(Number(s?.total_revenue_eur ?? 0)),
        avgMonthlyProfitEur: Math.round(Number(s?.avg_monthly_profit_eur ?? 0)),
        probabilityPct: Math.max(0, Math.min(100, Number(s?.probability_pct ?? 50))),
        keyDriver: String(s?.key_driver ?? '').slice(0, 200),
      })),
      categoryProjections: (parsed?.category_projections || [])
        .filter((c: any) => validCategories.has(String(c?.category ?? '')))
        .slice(0, 10)
        .map((c: any) => {
          const orig = categoryStats.find(x => x.category === String(c?.category));
          return {
            category: String(c?.category ?? '').slice(0, 50),
            currentMarginPct: Math.round(Number(c?.current_margin_pct ?? orig?.marginPct ?? 0) * 10) / 10,
            projectedMarginPct: Math.round(Number(c?.projected_margin_pct ?? 0) * 10) / 10,
            projectedPurchases: Math.max(0, Number(c?.projected_purchases ?? 0)),
            projectedProfitEur: Math.round(Number(c?.projected_profit_eur ?? 0)),
            trend: ['rising', 'falling', 'stable'].includes(String(c?.trend)) ? String(c.trend) : 'stable',
            recommendation: ['invest_more', 'maintain', 'reduce', 'exit'].includes(String(c?.recommendation)) ? String(c.recommendation) : 'maintain',
            reasoning: String(c?.reasoning ?? '').slice(0, 250),
          };
        }),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        expectedMarginImprovementPct: Math.round(Number(r?.expected_margin_improvement_pct ?? 0) * 10) / 10,
        expectedProfitImpactEur: Math.round(Number(r?.expected_profit_impact_eur ?? 0)),
        implementationMonths: Math.max(1, Number(r?.implementation_months ?? 1)),
      })),
      summary: {
        currentMonthlyProfitEur: Math.round(Number(parsed?.summary?.current_monthly_profit_eur ?? monthlyAvgProfit)),
        projectedMonthlyProfitMonthsEur: Math.round(Number(parsed?.summary?.[`projected_monthly_profit_${monthsAhead}m_eur`] ?? parsed?.summary?.projected_monthly_profit_eur ?? 0)),
        totalProjectedProfitEur: Math.round(Number(parsed?.summary?.total_projected_profit_eur ?? 0)),
        avgProjectedMarginPct: Math.round(Number(parsed?.summary?.avg_projected_margin_pct ?? currentStats.marginPct) * 10) / 10,
        marginImprovementPct: Math.round(Number(parsed?.summary?.margin_improvement_pct ?? 0) * 10) / 10,
        bestCaseScenario: String(parsed?.summary?.best_case_scenario ?? '').slice(0, 150),
        worstCaseScenario: String(parsed?.summary?.worst_case_scenario ?? '').slice(0, 150),
        biggestMarginDriver: String(parsed?.summary?.biggest_margin_driver ?? '').slice(0, 200),
        biggestMarginThreat: String(parsed?.summary?.biggest_margin_threat ?? '').slice(0, 200),
        forecastConfidenceScore: Math.max(0, Math.min(100, Number(parsed?.summary?.forecast_confidence_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, forecaster });
  } catch (e: any) { logger.error("/api/ai/profit-margin-forecaster", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
