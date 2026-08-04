// v6.35: AI Profit Trail Visualizer — vizualizira dobičkovno pot vsakega itema
// POST /api/ai/profit-trail
// Body: {}
// Returns: { ok, trails: [{ tradeId, title, trail: [], totalProfit, milestones, lessons }], insights, summary }

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
    await req.json().catch(() => ({}));

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null }, sellPrice: { not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true,
        sellPrice: true, sellFees: true, buyDate: true, sellDate: true,
        buyLocation: true, sellLocation: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiScore: true, aiRisk: true, aiVerdict: true } } },
      take: 50,
      orderBy: { sellDate: 'desc' },
    });

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiScore: true, aiRisk: true } } },
      take: 20,
    });

    if (soldTrades.length === 0) {
      return NextResponse.json({ ok: true, trails: [], message: 'Ni prodaj za profit trail.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // Izberi top 10 najbolj zanimivih prodaj za trail vizualizacijo
    const topTrades = [...soldTrades]
      .sort((a, b) => {
        const pa = (a.sellPrice ?? 0) - (a.sellFees ?? 0) - a.buyPrice - (a.buyFees ?? 0);
        const pb = (b.sellPrice ?? 0) - (b.sellFees ?? 0) - b.buyPrice - (b.buyFees ?? 0);
        return pb - pa;
      })
      .slice(0, 10);

    const trailsStr = topTrades.map(t => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = revenue - cost;
      const days = t.sellDate && t.buyDate ? Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000)) : 0;
      return `- [${t.id}] ${t.title} | ${t.category} | kupljeno ${cost}€ (${t.buyLocation}) | prodano ${revenue}€ (${t.sellLocation}) | ${profit}€ dobička | ${days}d | AI score: ${t.listing?.aiScore ?? '?'}/10 | deal: ${t.listing?.dealScore ?? '?'}/100`;
    }).join('\n');

    const heldStr = heldTrades.slice(0, 10).map(t => `- [${t.id}] ${t.title} | ${t.category} | ${t.buyPrice}€ | AI: ${t.listing?.aiScore ?? '?'}/10 | deal: ${t.listing?.dealScore ?? '?'}/100`).join('\n');

    const prompt = `Si ekspert za vizualizacijo dobičkovne poti (profit trail) pri preprodaji.
Za vsak prodan item rekonstruiraj dobičkovno pot od nakupa do prodaje z mejniki.

TOP 10 PRODAJ ZA TRAIL:
${trailsStr}

TRENUTNI HELD ITEMI (predvideni trails):
${heldStr || '- Prazno'}

Trail mejniki (milestones) za vsak item:
1. DISCOVERY: kdaj/kipodjal oglas, kakšen je bil deal score
2. AI EVALUATION: AI score, verdict, est. value
3. ACQUISITION: nabavna cena, vir, datum nakupa
4. LISTING: objava oglasa, platforma, prva cena
5. INTEREST: prvo povpraševanje, čas do njega
6. NEGOTIATION: pogajanja, končna cena
7. SALE: prodajna cena, kanal, datum prodaje
8. PROFIT: neto dobiček, ROI, čas do prodaje

Za vsak mejnik: datum, vrednost itema, kumulativni dobiček/izgubo

Odgovori LE z JSON:
{
  "insights": "<max 250 znakov>",
  "trails": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "category": "<kategorija>",
      "total_profit_eur": <number>,
      "roi_pct": <number>,
      "total_days": <number>,
      "trail": [
        {
          "milestone": "<discovery|ai_eval|acquisition|listing|interest|negotiation|sale|profit>",
          "day": <number, dan od nakupa>,
          "event": "<kaj se je zgodilo, max 80 znakov>",
          "item_value_eur": <number>,
          "cumulative_cost_eur": <number>,
          "cumulative_revenue_eur": <number>,
          "net_position_eur": <number>
        }
      ],
      "key_moments": ["<ključni trenutek, max 80 znakov>", "..."],
      "lessons_learned": ["<kaj se naučimo, max 100 znakov>", "..."],
      "replicable": <boolean>,
      "replicate_strategy": "<kako ponoviti, max 120 znakov>"
    }
  ],
  "held_item_projections": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "projected_trail": [
        { "milestone": "<ime>", "predicted_day": <number>, "predicted_value_eur": <number> }
      ],
      "projected_profit_eur": <number>,
      "projected_roi_pct": <number>,
      "confidence_pct": <number>
    }
  ],
  "summary": {
    "total_trails_analyzed": <number>,
    "avg_profit_per_trail_eur": <number>,
    "best_trail_profit_eur": <number>,
    "avg_trail_length_days": <number>,
    "most_common_success_pattern": "<max 150 znakov>",
    "replicable_count": <number>
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
    const validSoldIds = new Set(soldTrades.map(t => t.id));
    const validHeldIds = new Set(heldTrades.map(t => t.id));

    const trails = {
      insights: String(parsed?.insights ?? '').slice(0, 600),
      trails: (parsed?.trails || []).filter((t: any) => validSoldIds.has(String(t?.id ?? ''))).slice(0, 10).map((t: any) => ({
        tradeId: String(t?.id ?? ''),
        title: String(t?.title ?? '').slice(0, 150),
        category: String(t?.category ?? '').slice(0, 50),
        totalProfitEur: Math.round(Number(t?.total_profit_eur ?? 0)),
        roiPct: Math.round(Number(t?.roi_pct ?? 0)),
        totalDays: Math.max(0, Number(t?.total_days ?? 0)),
        trail: (t?.trail || []).slice(0, 8).map((m: any) => ({
          milestone: String(m?.milestone ?? '').slice(0, 30),
          day: Math.max(0, Number(m?.day ?? 0)),
          event: String(m?.event ?? '').slice(0, 150),
          itemValueEur: Math.round(Number(m?.item_value_eur ?? 0)),
          cumulativeCostEur: Math.round(Number(m?.cumulative_cost_eur ?? 0)),
          cumulativeRevenueEur: Math.round(Number(m?.cumulative_revenue_eur ?? 0)),
          netPositionEur: Math.round(Number(m?.net_position_eur ?? 0)),
        })),
        keyMoments: (t?.key_moments || []).slice(0, 4).map((k: any) => String(k).slice(0, 150)),
        lessonsLearned: (t?.lessons_learned || []).slice(0, 3).map((l: any) => String(l).slice(0, 200)),
        replicable: Boolean(t?.replicable ?? false),
        replicateStrategy: String(t?.replicate_strategy ?? '').slice(0, 250),
      })),
      heldItemProjections: (parsed?.held_item_projections || []).filter((h: any) => validHeldIds.has(String(h?.id ?? ''))).slice(0, 10).map((h: any) => ({
        tradeId: String(h?.id ?? ''),
        title: String(h?.title ?? '').slice(0, 100),
        projectedTrail: (h?.projected_trail || []).slice(0, 5).map((m: any) => ({
          milestone: String(m?.milestone ?? '').slice(0, 30),
          predictedDay: Math.max(0, Number(m?.predicted_day ?? 0)),
          predictedValueEur: Math.round(Number(m?.predicted_value_eur ?? 0)),
        })),
        projectedProfitEur: Math.round(Number(h?.projected_profit_eur ?? 0)),
        projectedRoiPct: Math.round(Number(h?.projected_roi_pct ?? 0)),
        confidencePct: Math.max(0, Math.min(100, Number(h?.confidence_pct ?? 50))),
      })),
      summary: {
        totalTrailsAnalyzed: Math.max(0, Number(parsed?.summary?.total_trails_analyzed ?? 0)),
        avgProfitPerTrailEur: Math.round(Number(parsed?.summary?.avg_profit_per_trail_eur ?? 0)),
        bestTrailProfitEur: Math.round(Number(parsed?.summary?.best_trail_profit_eur ?? 0)),
        avgTrailLengthDays: Math.max(0, Number(parsed?.summary?.avg_trail_length_days ?? 0)),
        mostCommonSuccessPattern: String(parsed?.summary?.most_common_success_pattern ?? '').slice(0, 300),
        replicableCount: Math.max(0, Number(parsed?.summary?.replicable_count ?? 0)),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, trails });
  } catch (e: any) {
    logger.error("/api/ai/profit-trail", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
