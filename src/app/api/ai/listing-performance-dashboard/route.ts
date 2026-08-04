// v6.70: AI Listing Performance Dashboard — centralni dashboard z ML insights in KPI tracking
// POST /api/ai/listing-performance-dashboard
// Body: { days?: number }
// Returns: { ok, dashboard: { kpis, insights, trends, topPerformers, alerts, recommendations, summary } }

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
    const days = Math.max(7, Math.min(365, Number(body?.days ?? 30)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since, not: null } }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true }, take: 500, orderBy: { sellDate: 'desc' } });
    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true } } }, take: 100 });
    const listings = await db.listing.findMany({ where: { firstSeenAt: { gte: since }, isHidden: false }, select: { id: true, title: true, price: true, aiScore: true, aiVerdict: true, dealScore: true }, take: 500 });

    if (soldTrades.length === 0 && heldTrades.length === 0) return NextResponse.json({ ok: true, dashboard: null, message: 'Ni podatkov za dashboard.' });

    const totalRevenue = soldTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
    const totalCost = soldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalProfit = totalRevenue - totalCost;
    const avgMarginPct = totalCost > 0 ? Math.round((totalProfit / totalCost) * 1000) / 10 : 0;
    const avgDaysToSell = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => s + Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000))), 0) / soldTrades.length) : 0;

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const prompt = `Si AI listing performance dashboard z ML insights in KPI tracking.
Centralni dashboard za zadnje ${days} dni.

STATS:
- Prodano: ${soldTrades.length} itemov
- Prihodek: ${Math.round(totalRevenue)}€
- Profit: ${Math.round(totalProfit)}€
- Marža: ${avgMarginPct}%
- Povp dni do prodaje: ${avgDaysToSell}
- Held: ${heldTrades.length}
- Aktivni listingi: ${listings.length}

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "kpis": [
    { "name": "<revenue|profit|margin_pct|items_sold|avg_days_to_sell|conversion_rate|avg_sell_price|profit_per_item|holding_cost|roi>", "current_value": <number>, "previous_value": <number>, "change_pct": <number>, "trend": "<up|down|flat>", "target": <number>, "status": "<above_target|on_track|below_target|critical>", "description": "<max 100 znakov>" }
  ],
  "insights_list": [
    { "type": "<trend|anomaly|opportunity|warning|info>", "severity": "<high|medium|low>", "title": "<max 80 znakov>", "description": "<max 200 znakov>", "actionable": "<max 150 znakov>", "impact_eur": <number> }
  ],
  "trends": [
    { "metric": "<revenue|profit|margin|sales_volume|days_to_sell|conversion>", "trend_direction": "<rising|falling|stable|volatile>", "trend_strength": <number 0-100>, "prediction_30d": <number>, "confidence_pct": <number 0-100>, "drivers": ["<max 80 znakov>"] }
  ],
  "topPerformers": [
    { "rank": <number>, "trade_id": "<id>", "title": "<naslov>", "category": "<kategorija>", "profit_eur": <number>, "margin_pct": <number>, "days_to_sell": <number>, "performance_score": <number 0-100>, "key_success_factor": "<max 100 znakov>" }
  ],
  "alerts": [
    { "type": "<low_margin|slow_moving|overstocked|underperforming|price_drop|market_shift>", "severity": "<info|warning|critical>", "description": "<max 150 znakov>", "affected_count": <number>, "financial_impact_eur": <number>, "recommended_action": "<max 150 znakov>" }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "kpi_affected": "<kpi>", "expected_impact_eur": <number>, "implementation_effort": "<low|medium|high>", "timeframe_days": <number> }
  ],
  "summary": {
    "overall_health_score": <number 0-100>, "health_grade": "<A|B|C|D|F>", "trend": "<improving|stable|declining>",
    "total_revenue_eur": <number>, "total_profit_eur": <number>, "avg_margin_pct": <number>,
    "biggest_opportunity": "<max 100 znakov>", "biggest_threat": "<max 100 znakov>",
    "quickest_win": "<max 100 znakov>", "dashboard_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const dashboard = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      kpis: (parsed?.kpis || []).slice(0, 10).map((k: any) => ({
        name: ['revenue', 'profit', 'margin_pct', 'items_sold', 'avg_days_to_sell', 'conversion_rate', 'avg_sell_price', 'profit_per_item', 'holding_cost', 'roi'].includes(String(k?.name)) ? String(k.name) : 'revenue',
        currentValue: Math.round(Number(k?.current_value ?? 0) * 100) / 100, previousValue: Math.round(Number(k?.previous_value ?? 0) * 100) / 100,
        changePct: Math.round(Number(k?.change_pct ?? 0) * 10) / 10, trend: ['up', 'down', 'flat'].includes(String(k?.trend)) ? String(k.trend) : 'flat',
        target: Math.round(Number(k?.target ?? 0) * 100) / 100, status: ['above_target', 'on_track', 'below_target', 'critical'].includes(String(k?.status)) ? String(k.status) : 'on_track',
        description: String(k?.description ?? '').slice(0, 200),
      })),
      insightsList: (parsed?.insights_list || []).slice(0, 8).map((i: any) => ({
        type: ['trend', 'anomaly', 'opportunity', 'warning', 'info'].includes(String(i?.type)) ? String(i.type) : 'info',
        severity: ['high', 'medium', 'low'].includes(String(i?.severity)) ? String(i.severity) : 'medium',
        title: String(i?.title ?? '').slice(0, 150), description: String(i?.description ?? '').slice(0, 400),
        actionable: String(i?.actionable ?? '').slice(0, 300), impactEur: Math.round(Number(i?.impact_eur ?? 0)),
      })),
      trends: (parsed?.trends || []).slice(0, 6).map((t: any) => ({
        metric: ['revenue', 'profit', 'margin', 'sales_volume', 'days_to_sell', 'conversion'].includes(String(t?.metric)) ? String(t.metric) : 'revenue',
        trendDirection: ['rising', 'falling', 'stable', 'volatile'].includes(String(t?.trend_direction)) ? String(t.trend_direction) : 'stable',
        trendStrength: Math.max(0, Math.min(100, Number(t?.trend_strength ?? 50))), prediction30d: Math.round(Number(t?.prediction_30d ?? 0) * 100) / 100,
        confidencePct: Math.max(0, Math.min(100, Number(t?.confidence_pct ?? 50))), drivers: (t?.drivers || []).slice(0, 4).map((d: any) => String(d).slice(0, 150)),
      })),
      topPerformers: (parsed?.topPerformers || []).slice(0, 10).map((p: any) => ({
        rank: Math.max(1, Number(p?.rank ?? 1)), tradeId: String(p?.trade_id ?? '').slice(0, 50), title: String(p?.title ?? '').slice(0, 100),
        category: String(p?.category ?? '').slice(0, 50), profitEur: Math.round(Number(p?.profit_eur ?? 0)),
        marginPct: Math.round(Number(p?.margin_pct ?? 0) * 10) / 10, daysToSell: Math.max(0, Number(p?.days_to_sell ?? 0)),
        performanceScore: Math.max(0, Math.min(100, Number(p?.performance_score ?? 50))), keySuccessFactor: String(p?.key_success_factor ?? '').slice(0, 200),
      })),
      alerts: (parsed?.alerts || []).slice(0, 6).map((a: any) => ({
        type: ['low_margin', 'slow_moving', 'overstocked', 'underperforming', 'price_drop', 'market_shift'].includes(String(a?.type)) ? String(a.type) : 'underperforming',
        severity: ['info', 'warning', 'critical'].includes(String(a?.severity)) ? String(a.severity) : 'warning',
        description: String(a?.description ?? '').slice(0, 300), affectedCount: Math.max(0, Number(a?.affected_count ?? 0)),
        financialImpactEur: Math.round(Number(a?.financial_impact_eur ?? 0)), recommendedAction: String(a?.recommended_action ?? '').slice(0, 300),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300), priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        kpiAffected: String(r?.kpi_affected ?? '').slice(0, 50), expectedImpactEur: Math.round(Number(r?.expected_impact_eur ?? 0)),
        implementationEffort: ['low', 'medium', 'high'].includes(String(r?.implementation_effort)) ? String(r.implementation_effort) : 'medium',
        timeframeDays: Math.max(1, Number(r?.timeframe_days ?? 7)),
      })),
      summary: {
        overallHealthScore: Math.max(0, Math.min(100, Number(parsed?.summary?.overall_health_score ?? 60))),
        healthGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.health_grade)) ? String(parsed.summary.health_grade) : 'C',
        trend: ['improving', 'stable', 'declining'].includes(String(parsed?.summary?.trend)) ? String(parsed.summary.trend) : 'stable',
        totalRevenueEur: Math.round(Number(parsed?.summary?.total_revenue_eur ?? totalRevenue)),
        totalProfitEur: Math.round(Number(parsed?.summary?.total_profit_eur ?? totalProfit)),
        avgMarginPct: Math.round(Number(parsed?.summary?.avg_margin_pct ?? avgMarginPct) * 10) / 10,
        biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 200),
        biggestThreat: String(parsed?.summary?.biggest_threat ?? '').slice(0, 200),
        quickestWin: String(parsed?.summary?.quickest_win ?? '').slice(0, 200),
        dashboardScore: Math.max(0, Math.min(100, Number(parsed?.summary?.dashboard_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, dashboard });
  } catch (e: any) { logger.error("/api/ai/listing-performance-dashboard", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
