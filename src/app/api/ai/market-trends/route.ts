// v6.27: AI Predictive Market Trends — napove tržne trende po kategorijah
// POST /api/ai/market-trends
// Body: { monthsAhead?: number }
// Returns: { ok, trends: [{ category, currentTrend, predictedTrend, priceDirection, demandDirection, confidence, signals, action }], insights, summary }

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
    const monthsAhead = Math.max(1, Math.min(12, Number(body?.monthsAhead) || 3));

    // 1. Pridobi sold trades za analizo trendov (zadnji 18 mesecev)
    const eighteenMonthsAgo = new Date();
    eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { gte: eighteenMonthsAgo }, sellPrice: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true, sellFees: true, buyFees: true,
        buyDate: true, sellDate: true },
      take: 500,
    });

    // 2. Pridobi nedavne listinge za trend povpraševanja
    const recentListings = await db.listing.findMany({
      where: { isHidden: false, firstSeenAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      select: { price: true, aiVerdict: true, dealScore: true, firstSeenAt: true,
        monitor: { select: { source: true, name: true } } },
      take: 500,
    });

    if (soldTrades.length === 0 && recentListings.length === 0) {
      return NextResponse.json({ ok: true, trends: [], message: 'Ni podatkov za analizo trendov.' });
    }

    // 3. Analiza trendov po kategorijah (mesečni avg price in volume)
    const catTrends: Record<string, { monthlyData: Record<string, { avgPrice: number; count: number; profit: number }>; totalProfit: number; totalSales: number }> = {};
    for (const t of soldTrades) {
      const cat = t.category || 'drugo';
      if (!t.sellDate) continue;
      const monthKey = `${t.sellDate.getFullYear()}-${String(t.sellDate.getMonth() + 1).padStart(2, '0')}`;
      if (!catTrends[cat]) catTrends[cat] = { monthlyData: {}, totalProfit: 0, totalSales: 0 };
      if (!catTrends[cat].monthlyData[monthKey]) catTrends[cat].monthlyData[monthKey] = { avgPrice: 0, count: 0, profit: 0 };
      catTrends[cat].monthlyData[monthKey].avgPrice += t.sellPrice ?? 0;
      catTrends[cat].monthlyData[monthKey].count++;
      catTrends[cat].monthlyData[monthKey].profit += (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
      catTrends[cat].totalProfit += (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
      catTrends[cat].totalSales++;
    }
    for (const cat of Object.keys(catTrends)) {
      for (const m of Object.keys(catTrends[cat].monthlyData)) {
        const d = catTrends[cat].monthlyData[m];
        d.avgPrice = d.count > 0 ? Math.round(d.avgPrice / d.count) : 0;
      }
    }

    // 4. Recent listing volume per source (proxy za demand)
    const demandBySource: Record<string, number> = {};
    const opportunityCount = recentListings.filter(l => l.aiVerdict === 'PRILIKA' || (l.dealScore ?? 0) >= 70).length;
    for (const l of recentListings) {
      const src = l.monitor?.source || 'neznan';
      demandBySource[src] = (demandBySource[src] ?? 0) + 1;
    }

    // 5. AI analiza trendov
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const catTrendsStr = Object.entries(catTrends)
      .sort(([, a], [, b]) => b.totalProfit - a.totalProfit)
      .slice(0, 15)
      .map(([cat, d]) => {
        const months = Object.entries(d.monthlyData).sort(([a], [b]) => a.localeCompare(b));
        const recent3 = months.slice(-3);
        const prev3 = months.slice(-6, -3);
        const recentAvg = recent3.length > 0 ? Math.round(recent3.reduce((s, [_, m]) => s + m.avgPrice, 0) / recent3.length) : 0;
        const prevAvg = prev3.length > 0 ? Math.round(prev3.reduce((s, [_, m]) => s + m.avgPrice, 0) / prev3.length) : 0;
        const priceChange = prevAvg > 0 ? Math.round(((recentAvg - prevAvg) / prevAvg) * 100) : 0;
        const recentVol = recent3.reduce((s, [_, m]) => s + m.count, 0);
        return `- ${cat}: ${d.totalSales} prodaj, ${d.totalProfit}€ dobička, povp. cena ${recentAvg}€ (sprememba ${priceChange > 0 ? '+' : ''}${priceChange}%), ${recentVol} prodaj v zadnjih 3m`;
      })
      .join('\n');

    const demandStr = Object.entries(demandBySource)
      .sort(([, a], [, b]) => b - a)
      .map(([src, count]) => `- ${src}: ${count} oglasov v 30d`)
      .join('\n');

    const prompt = `Si ekspert za analizo tržnih trendov in napovedovanje pri preprodaji.
Za naslednje ${monthsAhead} mesecev napovej tržne trende po kategorijah.

ZGODOVINSKI PODATKI PO KATEGORIJAH:
${catTrendsStr || '- Ni podatkov'}

DEMAND SIGNALI (zadnjih 30 dni):
${demandStr || '- Ni podatkov'}
Skupno priložnosti: ${opportunityCount} od ${recentListings.length} oglasov

Slovenski tržni kontekst:
- Inflacija 2024: ~4% (vpliva na nominalne cene)
- Sezonskost: elektronika (dec avgust), avto (pomlad), pohištvo (jesen)
- EU trendi: EV vozila rastejo, vintage/nostalgija v modi, minimalizem v stanovanjih
- Tech: AI/ChatGPT poganja povpraševanje po močnih računalnikih

Trend indikatorji:
- priceDirection: rising|falling|stable (gibanje cen v naslednjih ${monthsAhead}m)
- demandDirection: increasing|decreasing|stable
- trendStrength: strong|moderate|weak

Odgovori LE z JSON:
{
  "insights": "<splošne ugotovitve o tržnih trendih, max 250 znakov>",
  "trends": [
    {
      "category": "<kategorija>",
      "current_trend": "<rising|falling|stable>",
      "predicted_trend": "<rising|falling|stable>",
      "price_direction": "<rising|falling|stable>",
      "price_change_pct": <number>,
      "demand_direction": "<increasing|decreasing|stable>",
      "demand_change_pct": <number>,
      "trend_strength": "<strong|moderate|weak>",
      "confidence_pct": <number 0-100>,
      "signals": ["<signal, max 80 znakov>", "..."],
      "action": "<stock_up|sell_now|hold|exit|monitor>",
      "timeframe": "<kdaj ukrepati, max 80 znakov>",
      "reasoning": "<max 120 znakov>"
    }
  ],
  "macro_factors": [
    {
      "factor": "<faktor, max 80 znakov>",
      "impact": "<positive|negative|neutral>",
      "affected_categories": ["<kategorija>", "..."],
      "severity": "<high|medium|low>"
    }
  ],
  "summary": {
    "hottest_category": "<kategorija>",
    "coldest_category": "<kategorija>",
    "rising_count": <number>,
    "falling_count": <number>,
    "overall_market_sentiment": "<bullish|bearish|neutral>",
    "recommended_portfolio_shift": "<max 150 znakov>"
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

    const trends = (parsed?.trends || []).slice(0, 15).map((t: any) => ({
      category: String(t?.category ?? '').slice(0, 50),
      currentTrend: ['rising', 'falling', 'stable'].includes(String(t?.current_trend)) ? String(t.current_trend) : 'stable',
      predictedTrend: ['rising', 'falling', 'stable'].includes(String(t?.predicted_trend)) ? String(t.predicted_trend) : 'stable',
      priceDirection: ['rising', 'falling', 'stable'].includes(String(t?.price_direction)) ? String(t.price_direction) : 'stable',
      priceChangePct: Math.round(Number(t?.price_change_pct ?? 0)),
      demandDirection: ['increasing', 'decreasing', 'stable'].includes(String(t?.demand_direction)) ? String(t.demand_direction) : 'stable',
      demandChangePct: Math.round(Number(t?.demand_change_pct ?? 0)),
      trendStrength: ['strong', 'moderate', 'weak'].includes(String(t?.trend_strength)) ? String(t.trend_strength) : 'moderate',
      confidencePct: Math.max(0, Math.min(100, Number(t?.confidence_pct ?? 50))),
      signals: (t?.signals || []).slice(0, 5).map((s: any) => String(s).slice(0, 150)),
      action: ['stock_up', 'sell_now', 'hold', 'exit', 'monitor'].includes(String(t?.action)) ? String(t.action) : 'monitor',
      timeframe: String(t?.timeframe ?? '').slice(0, 150),
      reasoning: String(t?.reasoning ?? '').slice(0, 200),
    }));

    const macroFactors = (parsed?.macro_factors || []).slice(0, 6).map((m: any) => ({
      factor: String(m?.factor ?? '').slice(0, 150),
      impact: ['positive', 'negative', 'neutral'].includes(String(m?.impact)) ? String(m.impact) : 'neutral',
      affectedCategories: (m?.affected_categories || []).slice(0, 4).map((c: any) => String(c).slice(0, 50)),
      severity: ['high', 'medium', 'low'].includes(String(m?.severity)) ? String(m.severity) : 'medium',
    }));

    const summary = {
      hottestCategory: String(parsed?.summary?.hottest_category ?? '').slice(0, 50),
      coldestCategory: String(parsed?.summary?.coldest_category ?? '').slice(0, 50),
      risingCount: Math.max(0, Number(parsed?.summary?.rising_count ?? 0)),
      fallingCount: Math.max(0, Number(parsed?.summary?.falling_count ?? 0)),
      overallMarketSentiment: ['bullish', 'bearish', 'neutral'].includes(String(parsed?.summary?.overall_market_sentiment))
        ? String(parsed.summary.overall_market_sentiment) : 'neutral',
      recommendedPortfolioShift: String(parsed?.summary?.recommended_portfolio_shift ?? '').slice(0, 300),
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      insights: String(parsed?.insights ?? '').slice(0, 600),
      trends,
      macroFactors,
      summary,
      monthsAhead,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
