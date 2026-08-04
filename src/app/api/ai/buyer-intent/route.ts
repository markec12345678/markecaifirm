// v6.38: AI Predictive Buyer Intent — napove nakupno namero kupcev za held inventar
// POST /api/ai/buyer-intent
// Body: {}
// Returns: { ok, intent: { items: [], signals, conversionPredictions, outreachTiming } }

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

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiVerdict: true, price: true, location: true } } },
      take: 30,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null }, sellPrice: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true, sellLocation: true },
      take: 200,
    });

    if (heldTrades.length === 0) { return NextResponse.json({ ok: true, intent: null, message: 'Ni held tradeov za buyer intent.' }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const items = heldTrades.map(t => ({
      id: t.id, title: t.title, category: t.category || 'drugo',
      cost: t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)),
      dealScore: t.listing?.dealScore ?? 0, location: t.listing?.location ?? '',
    }));

    // Analiza prodajnih vzorcev za intent napoved
    const avgDaysToSell = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => { if (t.sellDate && t.buyDate) return s + (t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000); return s; }, 0) / soldTrades.length) : 30;
    const sellLocations = Object.entries(soldTrades.reduce((acc, t) => { const s = t.sellLocation || 'neznan'; acc[s] = (acc[s] ?? 0) + 1; return acc; }, {} as Record<string, number>)).sort(([,a],[,b]) => b - a).slice(0, 5).map(([s, c]) => `${s}: ${c}`).join(', ');

    const itemsStr = items.slice(0, 15).map(i => `- [${i.id}] ${i.title} | ${i.category} | est ${i.estValue}€ | ${i.daysHeld}d | deal ${i.dealScore} | ${i.location}`).join('\n');

    const prompt = `Si AI sistem za napovedovanje nakupne namere (buyer intent).
Za vsak held item napovej KDAJ, KDO in Z KAKŠNO VERJETNOSTJO bo kupec kupil.

INVENTAR (${items.length}):
${itemsStr}

PRODAJNI VZORCI: povp. ${avgDaysToSell}d do prodaje, kanali: ${sellLocations}

Buyer intent faktorji:
1. SEARCH_VOLUME: koliko ljudi išče ta tip itema (bolha iskanja, google trends)
2. SEASONAL_DEMAND: ali je ta item trenutno "v sezon"
3. PRICE_ATTRACTIVENESS: ali je naša cena privlačna glede na trg
4. LISTING_QUALITY: kakovost slike/opisa vpliva na intent
5. URGENCY_SIGNALS: ali kupec čuti nujnost (redkost, omejena zaloga)
6. COMPETITION: koliko podobnih oglasov je na trgu
7. SOCIAL_PROOF: ali so podobni itemi že prodani (dokaz povpraševanja)
8. LOCAL_DEMAND: ali je lokacija ugodna za osebni prevzem

Intent nivoji:
- HOT (80-100%): kupec aktivno išče, visoka verjetnost prodaje v 3-7 dneh
- WARM (50-79%): zanimanje obstaja, prodaja v 7-21 dneh
- COOL (20-49%): nizko povpraševanje, prodaja v 21-60 dneh
- COLD (0-19%): zelo nizko povpraševanje, potreben refresh ali popust

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "category": "<kategorija>",
      "est_value_eur": <number>,
      "intent_score": <number 0-100>,
      "intent_level": "<hot|warm|cool|cold>",
      "predicted_sell_probability_7d_pct": <number>,
      "predicted_sell_probability_30d_pct": <number>,
      "factors": [
        { "factor": "<search_volume|seasonal|price|quality|urgency|competition|social_proof|local_demand>", "score": <number 0-100>, "impact": "<positive|negative|neutral>", "note": "<max 60 znakov>" }
      ],
      "buyer_signals": ["<signal da kupec išče, max 80 znakov>", "..."],
      "recommended_actions": ["<kaj storiti za povečati intent, max 80 znakov>", "..."],
      "optimal_contact_window": "<kdaj je najboljši čas za objavo/kontakt, max 80 znakov>",
      "reasoning": "<max 100 znakov>"
    }
  ],
  "signals": [
    { "signal": "<ime signala>", "type": "<market|seasonal|competitive|social>", "strength": "<strong|medium|weak>", "description": "<max 100 znakov>" }
  ],
  "conversion_predictions": {
    "hot_items_count": <number>,
    "warm_items_count": <number>,
    "cool_items_count": <number>,
    "cold_items_count": <number>,
    "expected_sales_7d": <number>,
    "expected_sales_30d": <number>,
    "expected_revenue_30d_eur": <number>
  },
  "outreach_timing": {
    "best_day": "<dan>",
    "best_hour": <number>,
    "best_platform": "<platforma>",
    "reasoning": "<max 100 znakov>"
  },
  "summary": {
    "avg_intent_score": <number>,
    "hottest_item": "<naslov>",
    "coldest_item": "<naslov>",
    "items_needing_boost": <number>,
    "expected_portfolio_sell_through_30d_pct": <number>
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
    const validIds = new Set(items.map(i => i.id));

    const intent = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).map((it: any) => ({
        tradeId: String(it?.id ?? ''), title: String(it?.title ?? '').slice(0, 150), category: String(it?.category ?? '').slice(0, 50),
        estValueEur: Math.max(0, Number(it?.est_value_eur ?? 0)),
        intentScore: Math.max(0, Math.min(100, Number(it?.intent_score ?? 50))),
        intentLevel: ['hot', 'warm', 'cool', 'cold'].includes(String(it?.intent_level)) ? String(it.intent_level) : 'warm',
        predictedSellProbability7dPct: Math.max(0, Math.min(100, Number(it?.predicted_sell_probability_7d_pct ?? 0))),
        predictedSellProbability30dPct: Math.max(0, Math.min(100, Number(it?.predicted_sell_probability_30d_pct ?? 0))),
        factors: (it?.factors || []).slice(0, 8).map((f: any) => ({
          factor: String(f?.factor ?? '').slice(0, 50), score: Math.max(0, Math.min(100, Number(f?.score ?? 50))),
          impact: ['positive', 'negative', 'neutral'].includes(String(f?.impact)) ? String(f.impact) : 'neutral',
          note: String(f?.note ?? '').slice(0, 100),
        })),
        buyerSignals: (it?.buyer_signals || []).slice(0, 4).map((s: any) => String(s).slice(0, 150)),
        recommendedActions: (it?.recommended_actions || []).slice(0, 4).map((a: any) => String(a).slice(0, 150)),
        optimalContactWindow: String(it?.optimal_contact_window ?? '').slice(0, 150),
        reasoning: String(it?.reasoning ?? '').slice(0, 200),
      })),
      signals: (parsed?.signals || []).slice(0, 8).map((s: any) => ({
        signal: String(s?.signal ?? '').slice(0, 80), type: ['market', 'seasonal', 'competitive', 'social'].includes(String(s?.type)) ? String(s.type) : 'market',
        strength: ['strong', 'medium', 'weak'].includes(String(s?.strength)) ? String(s.strength) : 'medium',
        description: String(s?.description ?? '').slice(0, 200),
      })),
      conversionPredictions: {
        hotItemsCount: Math.max(0, Number(parsed?.conversion_predictions?.hot_items_count ?? 0)),
        warmItemsCount: Math.max(0, Number(parsed?.conversion_predictions?.warm_items_count ?? 0)),
        coolItemsCount: Math.max(0, Number(parsed?.conversion_predictions?.cool_items_count ?? 0)),
        coldItemsCount: Math.max(0, Number(parsed?.conversion_predictions?.cold_items_count ?? 0)),
        expectedSales7d: Math.max(0, Number(parsed?.conversion_predictions?.expected_sales_7d ?? 0)),
        expectedSales30d: Math.max(0, Number(parsed?.conversion_predictions?.expected_sales_30d ?? 0)),
        expectedRevenue30dEur: Math.round(Number(parsed?.conversion_predictions?.expected_revenue_30d_eur ?? 0)),
      },
      outreachTiming: {
        bestDay: String(parsed?.outreach_timing?.best_day ?? '').slice(0, 30),
        bestHour: Math.max(0, Math.min(23, Number(parsed?.outreach_timing?.best_hour ?? 19))),
        bestPlatform: String(parsed?.outreach_timing?.best_platform ?? '').slice(0, 30),
        reasoning: String(parsed?.outreach_timing?.reasoning ?? '').slice(0, 200),
      },
      summary: {
        avgIntentScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_intent_score ?? 50))),
        hottestItem: String(parsed?.summary?.hottest_item ?? '').slice(0, 100),
        coldestItem: String(parsed?.summary?.coldest_item ?? '').slice(0, 100),
        itemsNeedingBoost: Math.max(0, Number(parsed?.summary?.items_needing_boost ?? 0)),
        expectedPortfolioSellThrough30dPct: Math.max(0, Math.min(100, Number(parsed?.summary?.expected_portfolio_sell_through_30d_pct ?? 30))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, intent });
  } catch (e: any) { logger.error("/api/ai/buyer-intent", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
