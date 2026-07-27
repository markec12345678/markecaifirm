// v6.32: AI Performance Benchmarking Dashboard — primerja performance proti industry benchmarkom
// POST /api/ai/performance-benchmark
// Body: {}
// Returns: { ok, benchmark: { yourMetrics, industryBenchmarks, gaps, competitivePosition, improvements } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    await req.json().catch(() => ({}));

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true,
        buyDate: true, sellDate: true },
      take: 300,
    });

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { buyPrice: true, buyDate: true, category: true },
    });

    if (soldTrades.length === 0) {
      return NextResponse.json({ ok: true, benchmark: null, message: 'Ni prodaj za benchmarking.' });
    }

    // Izračunaj lastne metrike
    const totalProfit = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0), 0);
    const totalRevenue = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0), 0);
    const totalCost = soldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const avgRoi = totalCost > 0 ? Math.round((totalProfit / totalCost) * 100) : 0;
    const avgDaysToSell = soldTrades.length > 0
      ? Math.round(soldTrades.reduce((s, t) => {
          if (t.sellDate && t.buyDate) return s + (t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000);
          return s;
        }, 0) / soldTrades.length) : 0;
    const successRate = Math.round(soldTrades.filter(t => (t.sellPrice ?? 0) - (t.sellFees ?? 0) > t.buyPrice + (t.buyFees ?? 0)).length / soldTrades.length * 100);
    const totalInvestedHeld = heldTrades.reduce((s, t) => s + t.buyPrice, 0);
    const turnoverRatio = heldTrades.length > 0 ? soldTrades.length / heldTrades.length : 0;
    const profitMargin = totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0;

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za benchmarking v e-commerce in preprodaji.
Primerjaj uporabnikove metrike z industry benchmarki za preprodajo rabljenih dobrin.

UPORABNIKOVE METRIKE:
- Skupni dobiček: ${Math.round(totalProfit)}€
- Povp. ROI: ${avgRoi}%
- Povp. čas do prodaje: ${avgDaysToSell} dni
- Success rate: ${successRate}%
- Profit margin: ${profitMargin}%
- Skupni prihodek: ${Math.round(totalRevenue)}€
- Vezano v inventarju: ${Math.round(totalInvestedHeld)}€
- Turnover ratio: ${turnoverRatio.toFixed(2)}
- Število prodaj: ${soldTrades.length}
- Število held: ${heldTrades.length}

INDUSTRY BENCHMARKI (slovenski trg rabljenih dobrin 2024):
- Povp. ROI preprodajalcev: 15-25%
- Povp. čas do prodaje: 30-60 dni
- Povp. success rate: 60-75%
- Povp. profit margin: 12-20%
- Povp. turnover ratio: 3-6 na leto
- Top 10% preprodajalcev: ROI > 35%, success > 85%

Kategorije za benchmarking:
1. ROI performance (tvoj ROI vs industry)
2. Speed to sell (tvoji dnevi vs industry)
3. Success rate (tvoj % vs industry)
4. Profit margin (tvoj % vs industry)
5. Inventory turnover (tvoj ratio vs industry)
6. Portfolio diversification (kategorije)
7. Cash flow efficiency
8. Risk management (stalled %)

Odgovori LE z JSON:
{
  "insights": "<max 250 znakov>",
  "your_metrics": {
    "roi_pct": <number>,
    "avg_days_to_sell": <number>,
    "success_rate_pct": <number>,
    "profit_margin_pct": <number>,
    "turnover_ratio": <number>,
    "total_profit_eur": <number>
  },
  "industry_benchmarks": {
    "avg_roi_pct": <number>,
    "avg_days_to_sell": <number>,
    "avg_success_rate_pct": <number>,
    "avg_profit_margin_pct": <number>,
    "avg_turnover_ratio": <number>,
    "top_10pct_roi_pct": <number>
  },
  "competitive_position": {
    "overall_percentile": <number 0-100>,
    "tier": "<beginner|intermediate|advanced|expert|top_5pct>",
    "strengths": ["<prednost, max 80 znakov>", "..."],
    "weaknesses": ["<šibkost, max 80 znakov>", "..."]
  },
  "gaps": [
    {
      "metric": "<ime>",
      "your_value": <number>,
      "benchmark_value": <number>,
      "gap_pct": <number>,
      "gap_direction": "<above|below|at_par>",
      "urgency": "<high|medium|low>",
      "fix": "<max 100 znakov>"
    }
  ],
  "improvements": [
    {
      "area": "<ime področja>",
      "current_score": <number 0-100>,
      "target_score": <number 0-100>,
      "action": "<max 120 znakov>",
      "expected_impact_eur": <number>,
      "timeline_days": <number>
    }
  ],
  "summary": {
    "overall_score": <number 0-100>,
    "grade": "<A+|A|B+|B|C|D|F>",
    "vs_last_period": "<improving|stable|declining>",
    "projected_score_30d": <number 0-100>
  }
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);

    const benchmark = {
      insights: String(parsed?.insights ?? '').slice(0, 600),
      yourMetrics: {
        roiPct: avgRoi,
        avgDaysToSell,
        successRatePct: successRate,
        profitMarginPct: profitMargin,
        turnoverRatio: Math.round(turnoverRatio * 100) / 100,
        totalProfitEur: Math.round(totalProfit),
      },
      industryBenchmarks: {
        avgRoiPct: Math.round(Number(parsed?.industry_benchmarks?.avg_roi_pct ?? 20)),
        avgDaysToSell: Math.round(Number(parsed?.industry_benchmarks?.avg_days_to_sell ?? 45)),
        avgSuccessRatePct: Math.round(Number(parsed?.industry_benchmarks?.avg_success_rate_pct ?? 68)),
        avgProfitMarginPct: Math.round(Number(parsed?.industry_benchmarks?.avg_profit_margin_pct ?? 16)),
        avgTurnoverRatio: Math.round(Number(parsed?.industry_benchmarks?.avg_turnover_ratio ?? 4.5) * 100) / 100,
        top10pctRoiPct: Math.round(Number(parsed?.industry_benchmarks?.top_10pct_roi_pct ?? 35)),
      },
      competitivePosition: {
        overallPercentile: Math.max(0, Math.min(100, Number(parsed?.competitive_position?.overall_percentile ?? 50))),
        tier: ['beginner', 'intermediate', 'advanced', 'expert', 'top_5pct'].includes(String(parsed?.competitive_position?.tier))
          ? String(parsed.competitive_position.tier) : 'intermediate',
        strengths: (parsed?.competitive_position?.strengths || []).slice(0, 4).map((s: any) => String(s).slice(0, 150)),
        weaknesses: (parsed?.competitive_position?.weaknesses || []).slice(0, 4).map((w: any) => String(w).slice(0, 150)),
      },
      gaps: (parsed?.gaps || []).slice(0, 8).map((g: any) => ({
        metric: String(g?.metric ?? '').slice(0, 50),
        yourValue: Math.round(Number(g?.your_value ?? 0)),
        benchmarkValue: Math.round(Number(g?.benchmark_value ?? 0)),
        gapPct: Math.round(Number(g?.gap_pct ?? 0)),
        gapDirection: ['above', 'below', 'at_par'].includes(String(g?.gap_direction)) ? String(g.gap_direction) : 'at_par',
        urgency: ['high', 'medium', 'low'].includes(String(g?.urgency)) ? String(g.urgency) : 'medium',
        fix: String(g?.fix ?? '').slice(0, 200),
      })),
      improvements: (parsed?.improvements || []).slice(0, 6).map((i: any) => ({
        area: String(i?.area ?? '').slice(0, 50),
        currentScore: Math.max(0, Math.min(100, Number(i?.current_score ?? 50))),
        targetScore: Math.max(0, Math.min(100, Number(i?.target_score ?? 70))),
        action: String(i?.action ?? '').slice(0, 250),
        expectedImpactEur: Math.round(Number(i?.expected_impact_eur ?? 0)),
        timelineDays: Math.max(0, Number(i?.timeline_days ?? 30)),
      })),
      summary: {
        overallScore: Math.max(0, Math.min(100, Number(parsed?.summary?.overall_score ?? 50))),
        grade: ['A+', 'A', 'B+', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.grade)) ? String(parsed.summary.grade) : 'C',
        vsLastPeriod: ['improving', 'stable', 'declining'].includes(String(parsed?.summary?.vs_last_period)) ? String(parsed.summary.vs_last_period) : 'stable',
        projectedScore30d: Math.max(0, Math.min(100, Number(parsed?.summary?.projected_score_30d ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, benchmark });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
