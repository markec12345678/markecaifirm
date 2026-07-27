// v6.24: AI Listing Performance Tracker — analizira uspešnost objavljenih oglasov
// POST /api/ai/listing-performance
// Body: {}
// Returns: { ok, performance: [{ tradeId, title, metrics, insights, optimization }], summary, recommendations }

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

    // 1. Pridobi sold trades z vsemi podatki
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true,
        sellPrice: true, sellFees: true, buyDate: true, sellDate: true,
        buyLocation: true, sellLocation: true,
      },
      take: 100,
      orderBy: { sellDate: 'desc' },
    });

    // 2. Pridobi held trades (neuspešne ali v teku)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true } } },
      take: 30,
    });

    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        performance: [],
        message: 'Ni podatkov o prodajah za analizo uspešnosti.',
      });
    }

    // 3. Izračunaj metrike za sold trades
    const soldMetrics = soldTrades.map(t => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = revenue - cost;
      const roiPct = cost > 0 ? Math.round((profit / cost) * 100) : 0;
      const daysToSell = t.sellDate && t.buyDate
        ? Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000))
        : 0;
      const profitPerDay = daysToSell > 0 ? Math.round(profit / daysToSell) : profit;
      return {
        id: t.id, title: t.title, category: t.category || 'drugo',
        cost, revenue, profit, roiPct, daysToSell, profitPerDay,
        buyLocation: t.buyLocation || 'neznan',
        sellLocation: t.sellLocation || 'neznan',
        sellDate: t.sellDate?.toISOString() ?? null,
      };
    });

    // 4. AI analiza
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const topPerformers = [...soldMetrics].sort((a, b) => b.profit - a.profit).slice(0, 10);
    const worstPerformers = [...soldMetrics].sort((a, b) => a.profit - b.profit).slice(0, 5);
    const heldStr = heldTrades.slice(0, 10).map(t =>
      `- ${t.title} | ${t.category} | ${Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000))}d v skladišču`
    ).join('\n');

    const prompt = `Si ekspert za analizo uspešnosti oglasov in prodajnih strategij.
Analiziraj prodajne rezultate in priporoči optimizacije za prihodnje oglase.

TOP 10 PRODAJ (po dobičku):
${topPerformers.map(t => `- ${t.title} | ${t.category} | dobiček: ${t.profit}€ (${t.roiPct}% ROI) | ${t.daysToSell}d | ${t.profitPerDay}€/d | kupljeno: ${t.buyLocation} | prodano: ${t.sellLocation}`).join('\n')}

NAJSLABŠIH 5 PRODAJ (po dobičku):
${worstPerformers.map(t => `- ${t.title} | ${t.category} | dobiček: ${t.profit}€ (${t.roiPct}% ROI) | ${t.daysToSell}d | kupljeno: ${t.buyLocation} | prodano: ${t.sellLocation}`).join('\n')}

${heldStr ? `\nTRENUTNI INVENTAR (v skladišču):\n${heldStr}` : ''}

Pravila za analizo:
1. Identificiraj vzorce uspešnih prodaj (kategorije, viri, platforme, časi)
2. Identificiraj neuspešne prodaje (kaj je šlo narobe)
3. Za vsak held item predvidi uspešnost glede na podobne prodaje
4. Priporoči katere kategorije/vire/platforme najbolj izkoristiti
5. Predlagaj ceno in strategijo za held items

Strategije:
- "double_down": ponovi uspešno strategijo (isti vir, kategorija, platforma)
- "pivot": spremeni strategijo za neuspešne kategorije
- "scale_up": povečaj volumen v profitabilnih kategorijah
- "diversify": dodaj nove kategorije
- "exit": zapusti neprofitabilne kategorije

Odgovori LE z JSON:
{
  "insights": "<splošne ugotovitve o uspešnosti, max 250 znakov>",
  "top_performers_analysis": [
    {
      "title": "<naslov>",
      "category": "<kategorija>",
      "profit_eur": <number>,
      "roi_pct": <number>,
      "days_to_sell": <number>,
      "success_factors": ["<faktor, max 80 znakov>", "..."],
      "replicate": "<kako ponoviti, max 100 znakov>"
    }
  ],
  "worst_performers_analysis": [
    {
      "title": "<naslov>",
      "category": "<kategorija>",
      "profit_eur": <number>,
      "failure_reasons": ["<razlog, max 80 znakov>", "..."],
      "lesson": "<max 100 znakov>"
    }
  ],
  "held_items_forecast": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "predicted_profit_eur": <number>,
      "predicted_roi_pct": <number>,
      "predicted_days_to_sell": <number>,
      "recommended_price_eur": <number>,
      "recommended_platform": "<bolha|vinted|facebook|avtonet>",
      "confidence_pct": <number>,
      "reasoning": "<max 100 znakov>"
    }
  ],
  "category_performance": [
    {
      "category": "<kategorija>",
      "total_profit_eur": <number>,
      "avg_roi_pct": <number>,
      "avg_days_to_sell": <number>,
      "success_rate_pct": <number>,
      "recommendation": "<double_down|pivot|scale_up|diversify|exit>"
    }
  ],
  "summary": {
    "total_profit_eur": <number>,
    "avg_roi_pct": <number>,
    "avg_days_to_sell": <number>,
    "best_category": "<kategorija>",
    "worst_category": "<kategorija>",
    "best_source": "<vir>",
    "recommended_strategy": "<double_down|pivot|scale_up|diversify|exit>"
  },
  "recommendations": ["<splošno priporočilo, max 150 znakov>", "..."]
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = {
          provider: aiSettings.fallbackProvider,
          baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '',
          model: aiSettings.fallbackModel,
        };
        raw = await callProviderForRaw(fb, prompt);
      } else {
        return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);

    const result = {
      insights: String(parsed?.insights ?? '').slice(0, 600),
      topPerformersAnalysis: (parsed?.top_performers_analysis || []).slice(0, 10).map((t: any) => ({
        title: String(t?.title ?? '').slice(0, 150),
        category: String(t?.category ?? '').slice(0, 50),
        profitEur: Math.round(Number(t?.profit_eur ?? 0)),
        roiPct: Math.round(Number(t?.roi_pct ?? 0)),
        daysToSell: Math.max(0, Number(t?.days_to_sell ?? 0)),
        successFactors: (t?.success_factors || []).slice(0, 4).map((f: any) => String(f).slice(0, 150)),
        replicate: String(t?.replicate ?? '').slice(0, 200),
      })),
      worstPerformersAnalysis: (parsed?.worst_performers_analysis || []).slice(0, 5).map((t: any) => ({
        title: String(t?.title ?? '').slice(0, 150),
        category: String(t?.category ?? '').slice(0, 50),
        profitEur: Math.round(Number(t?.profit_eur ?? 0)),
        failureReasons: (t?.failure_reasons || []).slice(0, 4).map((r: any) => String(r).slice(0, 150)),
        lesson: String(t?.lesson ?? '').slice(0, 200),
      })),
      heldItemsForecast: (parsed?.held_items_forecast || []).slice(0, 10).map((h: any) => ({
        tradeId: String(h?.id ?? '').slice(0, 50),
        title: String(h?.title ?? '').slice(0, 150),
        predictedProfitEur: Math.round(Number(h?.predicted_profit_eur ?? 0)),
        predictedRoiPct: Math.round(Number(h?.predicted_roi_pct ?? 0)),
        predictedDaysToSell: Math.max(0, Number(h?.predicted_days_to_sell ?? 0)),
        recommendedPriceEur: Math.max(0, Number(h?.recommended_price_eur ?? 0)),
        recommendedPlatform: ['bolha', 'vinted', 'facebook', 'avtonet'].includes(String(h?.recommended_platform))
          ? String(h.recommended_platform) : 'bolha',
        confidencePct: Math.max(0, Math.min(100, Number(h?.confidence_pct ?? 50))),
        reasoning: String(h?.reasoning ?? '').slice(0, 200),
      })),
      categoryPerformance: (parsed?.category_performance || []).slice(0, 10).map((c: any) => ({
        category: String(c?.category ?? '').slice(0, 50),
        totalProfitEur: Math.round(Number(c?.total_profit_eur ?? 0)),
        avgRoiPct: Math.round(Number(c?.avg_roi_pct ?? 0)),
        avgDaysToSell: Math.max(0, Number(c?.avg_days_to_sell ?? 0)),
        successRatePct: Math.max(0, Math.min(100, Number(c?.success_rate_pct ?? 0))),
        recommendation: ['double_down', 'pivot', 'scale_up', 'diversify', 'exit'].includes(String(c?.recommendation))
          ? String(c.recommendation) : 'hold',
      })),
      summary: {
        totalProfitEur: Math.round(Number(parsed?.summary?.total_profit_eur ?? soldMetrics.reduce((s, t) => s + t.profit, 0))),
        avgRoiPct: Math.round(Number(parsed?.summary?.avg_roi_pct ?? 0)),
        avgDaysToSell: Math.round(Number(parsed?.summary?.avg_days_to_sell ?? 0)),
        bestCategory: String(parsed?.summary?.best_category ?? '').slice(0, 50),
        worstCategory: String(parsed?.summary?.worst_category ?? '').slice(0, 50),
        bestSource: String(parsed?.summary?.best_source ?? '').slice(0, 50),
        recommendedStrategy: ['double_down', 'pivot', 'scale_up', 'diversify', 'exit'].includes(String(parsed?.summary?.recommended_strategy))
          ? String(parsed.summary.recommended_strategy) : 'double_down',
      },
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => String(r).slice(0, 300)),
    };

    // Increment AI usage
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      ...result,
      rawData: {
        totalSold: soldTrades.length,
        totalHeld: heldTrades.length,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
