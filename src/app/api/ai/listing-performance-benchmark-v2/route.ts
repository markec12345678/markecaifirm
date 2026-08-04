// v6.65: AI Listing Performance Benchmark v2 — benchmarking z ML competitor analysis in ranking
// POST /api/ai/listing-performance-benchmark-v2
// Body: { tradeId?: string, days?: number }
// Returns: { ok, benchmark: { listings, competitors, industryBenchmarks, ranking, gaps, improvements, summary } }

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
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const days = Math.max(7, Math.min(365, Number(body?.days ?? 30)));

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since, not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 300, orderBy: { sellDate: 'desc' },
    });

    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades = await db.trade.findMany({
      where, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true, aiScore: true, aiRisk: true } } }, take: tradeId ? 1 : 15,
    });

    if (soldTrades.length === 0 && heldTrades.length === 0) return NextResponse.json({ ok: true, benchmark: null, message: 'Ni podatkov za benchmark.' });

    // Compute sold stats
    const totalRevenue = soldTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
    const totalCost = soldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalProfit = totalRevenue - totalCost;
    const avgMarginPct = totalCost > 0 ? Math.round((totalProfit / totalCost) * 1000) / 10 : 0;
    const avgDaysToSell = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => s + Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000))), 0) / soldTrades.length) : 0;

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const itemsStr = heldTrades.slice(0, 10).map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.buyPrice}€→${i.listing?.aiEstimatedValue ?? Math.round(i.buyPrice * 1.25)}€`).join('\n');

    const prompt = `Si AI listing performance benchmark v2 z ML competitor analysis in ranking.
Benchmarking tvojih oglasov proti industry in competitorjem.

TVOJA PERFORMANCE (zadnji ${days} dni):
- Prodanih: ${soldTrades.length} itemov
- Prihodek: ${Math.round(totalRevenue)}€
- Profit: ${Math.round(totalProfit)}€
- Povp marža: ${avgMarginPct}%
- Povp dni do prodaje: ${avgDaysToSell}d

TRENUTNI INVENTAR (${heldTrades.length}):
${itemsStr}

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    { "id": "<trade_id>", "title": "<naslov>", "your_performance_score": <number 0-100>, "industry_avg_score": <number 0-100>, "top_performer_score": <number 0-100>, "performance_percentile": <number 0-100>, "gap_to_top_pct": <number>, "ranking_position": <number>, "total_compared": <number>, "strengths": ["<max 80 znakov>"], "weaknesses": ["<max 80 znakov>"] }
  ],
  "competitors": [
    { "competitor_name": "<max 80 znakov>", "their_avg_margin_pct": <number>, "their_avg_days_to_sell": <number>, "their_avg_price_eur": <number>, "their_strength": "<max 100 znakov>", "their_weakness": "<max 100 znakov>", "your_advantage": "<max 120 znakov>", "competitive_action": "<max 150 znakov>" }
  ],
  "industry_benchmarks": [
    { "metric": "<margin_pct|days_to_sell|conversion_rate|ctr|revenue_per_item|profit_per_item>", "your_value": <number>, "industry_avg": <number>, "industry_top_10_pct": <number>, "industry_bottom_10_pct": <number>, "your_percentile": <number 0-100>, "gap_to_avg_pct": <number>, "gap_to_top_pct": <number>, "status": "<above_avg|at_avg|below_avg|bottom>" }
  ],
  "ranking": [
    { "category": "<kategorija>", "your_rank": <number>, "total_sellers": <number>, "your_score": <number 0-100>, "top_seller_score": <number 0-100>, "rank_change_vs_last_month": <number>, "improvement_needed": "<max 120 znakov>" }
  ],
  "gaps": [
    { "gap_area": "<max 80 znakov>", "current_value": <number>, "target_value": <number>, "gap_size": <number>, "gap_priority": "<high|medium|low>", "closing_action": "<max 150 znakov>", "expected_impact_eur": <number> }
  ],
  "improvements": [
    { "improvement": "<max 120 znakov>", "metric_affected": "<metric>", "current_value": <number>, "target_value": <number>, "expected_lift_pct": <number>, "implementation_effort": "<low|medium|high>", "timeframe_days": <number> }
  ],
  "summary": {
    "overall_performance_percentile": <number 0-100>,
    "overall_performance_grade": "<A|B|C|D|F>",
    "total_competitors_analyzed": <number>,
    "biggest_competitive_advantage": "<max 100 znakov>",
    "biggest_competitive_gap": "<max 100 znakov>",
    "quickest_improvement": "<max 100 znakov>",
    "benchmark_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); }
      else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const validIds = new Set(heldTrades.map(t => t.id));

    const benchmark = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      listings: (parsed?.listings || []).filter((l: any) => validIds.has(String(l?.id ?? ''))).slice(0, 15).map((l: any) => ({
        tradeId: String(l?.id ?? ''),
        title: String(l?.title ?? '').slice(0, 150),
        yourPerformanceScore: Math.max(0, Math.min(100, Number(l?.your_performance_score ?? 50))),
        industryAvgScore: Math.max(0, Math.min(100, Number(l?.industry_avg_score ?? 50))),
        topPerformerScore: Math.max(0, Math.min(100, Number(l?.top_performer_score ?? 80))),
        performancePercentile: Math.max(0, Math.min(100, Number(l?.performance_percentile ?? 50))),
        gapToTopPct: Math.round(Number(l?.gap_to_top_pct ?? 0) * 10) / 10,
        rankingPosition: Math.max(1, Number(l?.ranking_position ?? 1)),
        totalCompared: Math.max(0, Number(l?.total_compared ?? 0)),
        strengths: (l?.strengths || []).slice(0, 4).map((s: any) => String(s).slice(0, 150)),
        weaknesses: (l?.weaknesses || []).slice(0, 4).map((w: any) => String(w).slice(0, 150)),
      })),
      competitors: (parsed?.competitors || []).slice(0, 5).map((c: any) => ({
        competitorName: String(c?.competitor_name ?? '').slice(0, 150),
        theirAvgMarginPct: Math.round(Number(c?.their_avg_margin_pct ?? 0) * 10) / 10,
        theirAvgDaysToSell: Math.round(Number(c?.their_avg_days_to_sell ?? 0)),
        theirAvgPriceEur: Math.round(Number(c?.their_avg_price_eur ?? 0)),
        theirStrength: String(c?.their_strength ?? '').slice(0, 200),
        theirWeakness: String(c?.their_weakness ?? '').slice(0, 200),
        yourAdvantage: String(c?.your_advantage ?? '').slice(0, 250),
        competitiveAction: String(c?.competitive_action ?? '').slice(0, 300),
      })),
      industryBenchmarks: (parsed?.industry_benchmarks || []).slice(0, 6).map((b: any) => ({
        metric: ['margin_pct', 'days_to_sell', 'conversion_rate', 'ctr', 'revenue_per_item', 'profit_per_item'].includes(String(b?.metric)) ? String(b.metric) : 'margin_pct',
        yourValue: Math.round(Number(b?.your_value ?? 0) * 100) / 100,
        industryAvg: Math.round(Number(b?.industry_avg ?? 0) * 100) / 100,
        industryTop10Pct: Math.round(Number(b?.industry_top_10_pct ?? 0) * 100) / 100,
        industryBottom10Pct: Math.round(Number(b?.industry_bottom_10_pct ?? 0) * 100) / 100,
        yourPercentile: Math.max(0, Math.min(100, Number(b?.your_percentile ?? 50))),
        gapToAvgPct: Math.round(Number(b?.gap_to_avg_pct ?? 0) * 10) / 10,
        gapToTopPct: Math.round(Number(b?.gap_to_top_pct ?? 0) * 10) / 10,
        status: ['above_avg', 'at_avg', 'below_avg', 'bottom'].includes(String(b?.status)) ? String(b.status) : 'at_avg',
      })),
      ranking: (parsed?.ranking || []).slice(0, 8).map((r: any) => ({
        category: String(r?.category ?? '').slice(0, 50),
        yourRank: Math.max(1, Number(r?.your_rank ?? 1)),
        totalSellers: Math.max(1, Number(r?.total_sellers ?? 1)),
        yourScore: Math.max(0, Math.min(100, Number(r?.your_score ?? 50))),
        topSellerScore: Math.max(0, Math.min(100, Number(r?.top_seller_score ?? 80))),
        rankChangeVsLastMonth: Math.round(Number(r?.rank_change_vs_last_month ?? 0)),
        improvementNeeded: String(r?.improvement_needed ?? '').slice(0, 250),
      })),
      gaps: (parsed?.gaps || []).slice(0, 6).map((g: any) => ({
        gapArea: String(g?.gap_area ?? '').slice(0, 150),
        currentValue: Math.round(Number(g?.current_value ?? 0) * 100) / 100,
        targetValue: Math.round(Number(g?.target_value ?? 0) * 100) / 100,
        gapSize: Math.round(Number(g?.gap_size ?? 0) * 100) / 100,
        gapPriority: ['high', 'medium', 'low'].includes(String(g?.gap_priority)) ? String(g.gap_priority) : 'medium',
        closingAction: String(g?.closing_action ?? '').slice(0, 300),
        expectedImpactEur: Math.round(Number(g?.expected_impact_eur ?? 0)),
      })),
      improvements: (parsed?.improvements || []).slice(0, 6).map((i: any) => ({
        improvement: String(i?.improvement ?? '').slice(0, 250),
        metricAffected: String(i?.metric_affected ?? '').slice(0, 50),
        currentValue: Math.round(Number(i?.current_value ?? 0) * 100) / 100,
        targetValue: Math.round(Number(i?.target_value ?? 0) * 100) / 100,
        expectedLiftPct: Math.round(Number(i?.expected_lift_pct ?? 0) * 10) / 10,
        implementationEffort: ['low', 'medium', 'high'].includes(String(i?.implementation_effort)) ? String(i.implementation_effort) : 'medium',
        timeframeDays: Math.max(1, Number(i?.timeframe_days ?? 7)),
      })),
      summary: {
        overallPerformancePercentile: Math.max(0, Math.min(100, Number(parsed?.summary?.overall_performance_percentile ?? 50))),
        overallPerformanceGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.overall_performance_grade)) ? String(parsed.summary.overall_performance_grade) : 'C',
        totalCompetitorsAnalyzed: Math.max(0, Number(parsed?.summary?.total_competitors_analyzed ?? 0)),
        biggestCompetitiveAdvantage: String(parsed?.summary?.biggest_competitive_advantage ?? '').slice(0, 200),
        biggestCompetitiveGap: String(parsed?.summary?.biggest_competitive_gap ?? '').slice(0, 200),
        quickestImprovement: String(parsed?.summary?.quickest_improvement ?? '').slice(0, 200),
        benchmarkScore: Math.max(0, Math.min(100, Number(parsed?.summary?.benchmark_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, benchmark });
  } catch (e: any) { logger.error("/api/ai/listing-performance-benchmark-v2", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
