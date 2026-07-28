// v6.51: AI Inventory Performance Tracker — KPI tracking, trendi in benchmarks za inventar
// POST /api/ai/inventory-performance-tracker
// Body: { days?: number, category?: string }
// Returns: { ok, tracker: { kpis, trends, benchmarks, categoryPerformance, alerts, recommendations, summary } }

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
    const days = Math.max(7, Math.min(365, Number(body?.days ?? 30)));
    const categoryFilter = body?.category ? String(body.category).toLowerCase() : null;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sincePrev = new Date(Date.now() - days * 2 * 24 * 60 * 60 * 1000);

    // 1. Pridobi sold trades v obdobju
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null, gte: sincePrev } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    // 2. Pridobi held trades
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true } } },
      take: 200,
    });

    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return NextResponse.json({ ok: true, tracker: null, message: 'Ni podatkov za performance tracking.' });
    }

    // 3. Razdeli sold trades v current in previous period
    const currentSold = soldTrades.filter(t => t.sellDate! >= since);
    const prevSold = soldTrades.filter(t => t.sellDate! < since);

    // 4. KPI izračuni
    const calcKpis = (trades: typeof soldTrades) => {
      if (trades.length === 0) {
        return { count: 0, revenue: 0, cost: 0, profit: 0, avgMarginPct: 0, avgDaysToSell: 0, avgSellPrice: 0 };
      }
      const revenue = trades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
      const cost = trades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
      const profit = revenue - cost;
      const avgMarginPct = cost > 0 ? Math.round((profit / cost) * 1000) / 10 : 0;
      const totalDaysToSell = trades.reduce((s, t) => s + Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000))), 0);
      const avgDaysToSell = Math.round(totalDaysToSell / trades.length);
      const avgSellPrice = Math.round(revenue / trades.length);
      return { count: trades.length, revenue: Math.round(revenue), cost: Math.round(cost), profit: Math.round(profit), avgMarginPct, avgDaysToSell, avgSellPrice };
    };

    const currentKpis = calcKpis(currentSold);
    const prevKpis = calcKpis(prevSold);

    // 5. Category breakdown
    const catAgg = new Map<string, { count: number; revenue: number; profit: number; marginPct: number; daysToSell: number }>();
    for (const t of currentSold) {
      const cat = (t.category || 'drugo').toLowerCase();
      if (categoryFilter && !cat.includes(categoryFilter)) continue;
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const profit = revenue - cost;
      const days = Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000)));
      if (!catAgg.has(cat)) catAgg.set(cat, { count: 0, revenue: 0, profit: 0, marginPct: 0, daysToSell: 0 });
      const c = catAgg.get(cat)!;
      c.count += 1; c.revenue += revenue; c.profit += profit; c.daysToSell += days;
    }

    const categoryPerformance = Array.from(catAgg.entries()).map(([cat, c]) => {
      const marginPct = c.revenue > 0 ? Math.round((c.profit / c.revenue) * 1000) / 10 : 0;
      const avgDays = c.count > 0 ? Math.round(c.daysToSell / c.count) : 0;
      return { category: cat, count: c.count, revenue: Math.round(c.revenue), profit: Math.round(c.profit), marginPct, avgDaysToSell: avgDays };
    });

    // 6. Held inventory stats
    const heldStats = heldTrades.reduce((acc, t) => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));
      acc.totalValue += estValue;
      acc.totalCost += cost;
      acc.totalItems += 1;
      acc.avgDaysHeld += daysHeld;
      if (daysHeld > 30) acc.staleCount += 1;
      if (daysHeld > 90) acc.criticalCount += 1;
      if (daysHeld > 180) acc.deadCount += 1;
      return acc;
    }, { totalValue: 0, totalCost: 0, totalItems: 0, avgDaysHeld: 0, staleCount: 0, criticalCount: 0, deadCount: 0 });

    heldStats.avgDaysHeld = heldStats.totalItems > 0 ? Math.round(heldStats.avgDaysHeld / heldStats.totalItems) : 0;

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const catPerfStr = categoryPerformance.slice(0, 8).map(c =>
      `- ${c.category} | ${c.count}x | revenue ${c.revenue}€ | profit ${c.profit}€ (margin ${c.marginPct}%) | povp ${c.avgDaysToSell}d`
    ).join('\n');

    const prompt = `Si AI inventory performance tracker za slovenske oglasne platforme.
Analiziraj KPI-je, trende in benchmarks za inventar v zadnjih ${days} dneh.

TRENUTNO OBDOBJE (${days} dni):
- Prodano: ${currentKpis.count} itemov
- Prihodek: ${currentKpis.revenue}€
- Dobiček: ${currentKpis.profit}€
- Povp marža: ${currentKpis.avgMarginPct}%
- Povp dni do prodaje: ${currentKpis.avgDaysToSell}
- Povp prodajna cena: ${currentKpis.avgSellPrice}€

PREJŠNJE OBDOBJE (za primerjavo):
- Prodano: ${prevKpis.count} itemov
- Prihodek: ${prevKpis.revenue}€
- Dobiček: ${prevKpis.profit}€
- Povp marža: ${prevKpis.avgMarginPct}%

TRENUTNI INVENTAR (held):
- Skupno itemov: ${heldStats.totalItems}
- Skupna vrednost: ${heldStats.totalValue}€
- Skupni cost: ${heldStats.totalCost}€
- Povp dni v skladišču: ${heldStats.avgDaysHeld}
- Stale (>30d): ${heldStats.staleCount}
- Critical (>90d): ${heldStats.criticalCount}
- Dead (>180d): ${heldStats.deadCount}

KATEGORIJE PERFORMANCE:
${catPerfStr}

KPI-ji za tracking:
1. REVENUE (prihodek) — skupni + per kategorija
2. PROFIT (dobiček) — skupni + per kategorija
3. MARGIN_PCT (marža) — povprečna + per kategorija
4. DAYS_TO_SELL (hitrost prodaje) — povprečje + per kategorija
5. INVENTORY_TURNOVER (obračun) — kako hitro se zavrti inventar
6. SELL_THROUGH_RATE (prodaja rate) — % prodanega inventarja
7. AVG_SELL_PRICE (povp prodajna cena)
8. HOLDING_COST (strošek držanja) — opportunity cost
9. STALE_RATE (% inventarja >30d)
10. DEAD_INVENTORY_RATIO (% inventarja >180d)

Benchmark kategorije:
- EXCELLENT: >30% margin, <14d sell time, <10% stale
- GOOD: 20-30% margin, <30d, <20% stale
- AVERAGE: 15-20% margin, <45d, <30% stale
- POOR: <15% margin, >60d, >30% stale
- CRITICAL: <10% margin, >90d, >50% stale

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "kpis": [
    { "name": "<revenue|profit|margin_pct|days_to_sell|inventory_turnover|sell_through_rate|avg_sell_price|holding_cost|stale_rate|dead_inventory_ratio>", "current_value": <number>, "previous_value": <number>, "change_pct": <number>, "trend": "<up|down|flat>", "benchmark": <number>, "benchmark_status": "<above|at|below>", "status": "<excellent|good|average|poor|critical>", "description": "<max 120 znakov>" }
  ],
  "trends": [
    { "metric": "<metric_name>", "trend_direction": "<rising|falling|stable|volatile>", "trend_strength": <number 0-100>, "prediction_30d": <number>, "confidence_pct": <number 0-100>, "drivers": ["<max 80 znakov>"] }
  ],
  "benchmarks": [
    { "category": "<kategorija>", "your_margin_pct": <number>, "industry_avg_margin_pct": <number>, "your_days_to_sell": <number>, "industry_avg_days_to_sell": <number>, "performance_tier": "<excellent|good|average|poor|critical>", "gap_to_benchmark_pct": <number> }
  ],
  "category_performance": [
    { "category": "<kategorija>", "revenue_eur": <number>, "profit_eur": <number>, "margin_pct": <number>, "days_to_sell": <number>, "items_sold": <number>, "performance_tier": "<excellent|good|average|poor|critical>", "trend": "<rising|falling|stable>", "recommended_action": "<max 120 znakov>" }
  ],
  "alerts": [
    { "type": "<low_margin|slow_moving|high_stale|dead_inventory|underperforming_category>", "severity": "<info|warning|critical>", "category": "<kategorija ali all>", "description": "<max 150 znakov>", "recommended_action": "<max 150 znakov>", "expected_impact_eur": <number> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "kpi_affected": "<kpi_name>", "expected_impact_eur": <number>, "implementation_effort": "<low|medium|high>" }
  ],
  "summary": {
    "total_revenue_eur": <number>,
    "total_profit_eur": <number>,
    "avg_margin_pct": <number>,
    "revenue_change_vs_prev_pct": <number>,
    "profit_change_vs_prev_pct": <number>,
    "inventory_health_score": <number 0-100>,
    "best_performing_category": "<max 80 znakov>",
    "worst_performing_category": "<max 80 znakov>",
    "biggest_threat": "<max 100 znakov>",
    "biggest_opportunity": "<max 100 znakov>",
    "performance_efficiency_score": <number 0-100>
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

    const tracker = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      kpis: (parsed?.kpis || []).slice(0, 10).map((k: any) => ({
        name: ['revenue', 'profit', 'margin_pct', 'days_to_sell', 'inventory_turnover', 'sell_through_rate', 'avg_sell_price', 'holding_cost', 'stale_rate', 'dead_inventory_ratio'].includes(String(k?.name)) ? String(k.name) : 'revenue',
        currentValue: Math.round(Number(k?.current_value ?? 0) * 100) / 100,
        previousValue: Math.round(Number(k?.previous_value ?? 0) * 100) / 100,
        changePct: Math.round(Number(k?.change_pct ?? 0) * 10) / 10,
        trend: ['up', 'down', 'flat'].includes(String(k?.trend)) ? String(k.trend) : 'flat',
        benchmark: Math.round(Number(k?.benchmark ?? 0) * 100) / 100,
        benchmarkStatus: ['above', 'at', 'below'].includes(String(k?.benchmark_status)) ? String(k.benchmark_status) : 'at',
        status: ['excellent', 'good', 'average', 'poor', 'critical'].includes(String(k?.status)) ? String(k.status) : 'average',
        description: String(k?.description ?? '').slice(0, 250),
      })),
      trends: (parsed?.trends || []).slice(0, 6).map((t: any) => ({
        metric: String(t?.metric ?? '').slice(0, 50),
        trendDirection: ['rising', 'falling', 'stable', 'volatile'].includes(String(t?.trend_direction)) ? String(t.trend_direction) : 'stable',
        trendStrength: Math.max(0, Math.min(100, Number(t?.trend_strength ?? 50))),
        prediction30d: Math.round(Number(t?.prediction_30d ?? 0) * 100) / 100,
        confidencePct: Math.max(0, Math.min(100, Number(t?.confidence_pct ?? 50))),
        drivers: (t?.drivers || []).slice(0, 5).map((d: any) => String(d).slice(0, 150)),
      })),
      benchmarks: (parsed?.benchmarks || []).slice(0, 8).map((b: any) => ({
        category: String(b?.category ?? '').slice(0, 50),
        yourMarginPct: Math.round(Number(b?.your_margin_pct ?? 0) * 10) / 10,
        industryAvgMarginPct: Math.round(Number(b?.industry_avg_margin_pct ?? 0) * 10) / 10,
        yourDaysToSell: Math.round(Number(b?.your_days_to_sell ?? 0)),
        industryAvgDaysToSell: Math.round(Number(b?.industry_avg_days_to_sell ?? 0)),
        performanceTier: ['excellent', 'good', 'average', 'poor', 'critical'].includes(String(b?.performance_tier)) ? String(b.performance_tier) : 'average',
        gapToBenchmarkPct: Math.round(Number(b?.gap_to_benchmark_pct ?? 0) * 10) / 10,
      })),
      categoryPerformance: (parsed?.category_performance || []).slice(0, 10).map((c: any) => {
        const orig = categoryPerformance.find(x => x.category === String(c?.category));
        return {
          category: String(c?.category ?? '').slice(0, 50),
          revenueEur: Math.round(Number(c?.revenue_eur ?? orig?.revenue ?? 0)),
          profitEur: Math.round(Number(c?.profit_eur ?? orig?.profit ?? 0)),
          marginPct: Math.round(Number(c?.margin_pct ?? orig?.marginPct ?? 0) * 10) / 10,
          daysToSell: Math.round(Number(c?.days_to_sell ?? orig?.avgDaysToSell ?? 0)),
          itemsSold: Math.max(0, Number(c?.items_sold ?? orig?.count ?? 0)),
          performanceTier: ['excellent', 'good', 'average', 'poor', 'critical'].includes(String(c?.performance_tier)) ? String(c.performance_tier) : 'average',
          trend: ['rising', 'falling', 'stable'].includes(String(c?.trend)) ? String(c.trend) : 'stable',
          recommendedAction: String(c?.recommended_action ?? '').slice(0, 250),
        };
      }),
      alerts: (parsed?.alerts || []).slice(0, 6).map((a: any) => ({
        type: ['low_margin', 'slow_moving', 'high_stale', 'dead_inventory', 'underperforming_category'].includes(String(a?.type)) ? String(a.type) : 'slow_moving',
        severity: ['info', 'warning', 'critical'].includes(String(a?.severity)) ? String(a.severity) : 'warning',
        category: String(a?.category ?? 'all').slice(0, 50),
        description: String(a?.description ?? '').slice(0, 300),
        recommendedAction: String(a?.recommended_action ?? '').slice(0, 300),
        expectedImpactEur: Math.round(Number(a?.expected_impact_eur ?? 0)),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        kpiAffected: String(r?.kpi_affected ?? '').slice(0, 50),
        expectedImpactEur: Math.round(Number(r?.expected_impact_eur ?? 0)),
        implementationEffort: ['low', 'medium', 'high'].includes(String(r?.implementation_effort)) ? String(r.implementation_effort) : 'medium',
      })),
      summary: {
        totalRevenueEur: Math.round(Number(parsed?.summary?.total_revenue_eur ?? currentKpis.revenue)),
        totalProfitEur: Math.round(Number(parsed?.summary?.total_profit_eur ?? currentKpis.profit)),
        avgMarginPct: Math.round(Number(parsed?.summary?.avg_margin_pct ?? currentKpis.avgMarginPct) * 10) / 10,
        revenueChangeVsPrevPct: Math.round(Number(parsed?.summary?.revenue_change_vs_prev_pct ?? (prevKpis.revenue > 0 ? ((currentKpis.revenue - prevKpis.revenue) / prevKpis.revenue) * 100 : 0)) * 10) / 10,
        profitChangeVsPrevPct: Math.round(Number(parsed?.summary?.profit_change_vs_prev_pct ?? (prevKpis.profit > 0 ? ((currentKpis.profit - prevKpis.profit) / prevKpis.profit) * 100 : 0)) * 10) / 10,
        inventoryHealthScore: Math.max(0, Math.min(100, Number(parsed?.summary?.inventory_health_score ?? 60))),
        bestPerformingCategory: String(parsed?.summary?.best_performing_category ?? '').slice(0, 150),
        worstPerformingCategory: String(parsed?.summary?.worst_performing_category ?? '').slice(0, 150),
        biggestThreat: String(parsed?.summary?.biggest_threat ?? '').slice(0, 200),
        biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 200),
        performanceEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.performance_efficiency_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, tracker });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
