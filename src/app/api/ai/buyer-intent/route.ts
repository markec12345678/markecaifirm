// v6.38 / v8.94-refactor: AI Predictive Buyer Intent — napove nakupno namero kupcev
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-intent
// Body: {}
// Returns: { ok, intent: { items, signals, conversionPredictions, outreachTiming, summary } }

import { NextResponse } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface BuyerIntentInput {}

export const POST = withAiRoute<BuyerIntentInput>({
  endpoint: '/api/ai/buyer-intent',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    // 1. Pridobi held + sold trades
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiVerdict: true, price: true, location: true } },
      },
      take: 30,
    });

    if (heldTrades.length === 0) {
      return apiOk({ intent: null, message: 'Ni held tradeov za buyer intent.' });
    }

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null }, sellPrice: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true, sellLocation: true },
      take: 200,
    });

    // 2. Pripravi podatke
    const items = heldTrades.map(t => ({
      id: t.id, title: t.title, category: t.category || 'drugo',
      cost: t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000)),
      dealScore: t.listing?.dealScore ?? 0, location: t.listing?.location ?? '',
    }));

    const { avgDaysToSell, sellLocationsStr } = analyzeSalesPatterns(soldTrades);

    // 3. AI klic
    const prompt = buildPrompt(items, avgDaysToSell, sellLocationsStr);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    // 4. Transformacija rezultatov
    const intent = transformIntent(parsed, items);

    return apiOk({ intent });
  },
});

// --- Pomožne funkcije -----------------------------------------------------

function analyzeSalesPatterns(soldTrades: Array<{
  buyDate: Date | null; sellDate: Date | null; sellLocation: string | null;
}>): { avgDaysToSell: number; sellLocationsStr: string } {
  const avgDaysToSell = soldTrades.length > 0
    ? Math.round(soldTrades.reduce((s, t) => {
        if (t.sellDate && t.buyDate) return s + (t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000);
        return s;
      }, 0) / soldTrades.length)
    : 30;

  const sellLocations = Object.entries(
    soldTrades.reduce((acc, t) => {
      const s = t.sellLocation || 'neznan';
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  )
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([s, c]) => `${s}: ${c}`)
    .join(', ');

  return { avgDaysToSell, sellLocationsStr: sellLocations };
}

function buildPrompt(items: Array<{ id: string; title: string; category: string; estValue: number; daysHeld: number; dealScore: number; location: string }>, avgDaysToSell: number, sellLocationsStr: string): string {
  const itemsStr = items.slice(0, 15).map(i =>
    `- [${i.id}] ${i.title} | ${i.category} | est ${i.estValue}€ | ${i.daysHeld}d | deal ${i.dealScore} | ${i.location}`
  ).join('\n');

  return `Si AI sistem za napovedovanje nakupne namere (buyer intent).
Za vsak held item napovej KDAJ, KDO in Z KAKŠNO VERJETNOSTJO bo kupec kupil.

INVENTAR (${items.length}):
${itemsStr}

PRODAJNI VZORCI: povp. ${avgDaysToSell}d do prodaje, kanali: ${sellLocationsStr}

Buyer intent faktorji:
1. SEARCH_VOLUME: koliko ljudi išče ta tip itema
2. SEASONAL_DEMAND: ali je ta item trenutno "v sezon"
3. PRICE_ATTRACTIVENESS: ali je naša cena privlačna
4. LISTING_QUALITY: kakovost slike/opisa
5. URGENCY_SIGNALS: ali kupec čuti nujnost
6. COMPETITION: koliko podobnih oglasov je na trgu
7. SOCIAL_PROOF: ali so podobni itemi že prodani
8. LOCAL_DEMAND: ali je lokacija ugodna za osebni prevzem

Intent nivoji:
- HOT (80-100%): kupec aktivno išče, visoka verjetnost prodaje v 3-7 dneh
- WARM (50-79%): zanimanje obstaja, prodaja v 7-21 dneh
- COOL (20-49%): nizko povpraševanje, prodaja v 21-60 dneh
- COLD (0-19%): zelo nizko povpraševanje

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>", "title": "<naslov>", "category": "<kategorija>",
      "est_value_eur": <number>, "intent_score": <number 0-100>,
      "intent_level": "<hot|warm|cool|cold>",
      "predicted_sell_probability_7d_pct": <number>,
      "predicted_sell_probability_30d_pct": <number>,
      "factors": [{"factor": "...", "score": <0-100>, "impact": "<positive|negative|neutral>", "note": "<max 60 znakov>"}],
      "buyer_signals": ["<signal, max 80 znakov>"],
      "recommended_actions": ["<akcija, max 80 znakov>"],
      "optimal_contact_window": "<max 80 znakov>",
      "reasoning": "<max 100 znakov>"
    }
  ],
  "signals": [{"signal": "...", "type": "<market|seasonal|competitive|social>", "strength": "<strong|medium|weak>", "description": "<max 100 znakov>"}],
  "conversion_predictions": {
    "hot_items_count": <number>, "warm_items_count": <number>,
    "cool_items_count": <number>, "cold_items_count": <number>,
    "expected_sales_7d": <number>, "expected_sales_30d": <number>,
    "expected_revenue_30d_eur": <number>
  },
  "outreach_timing": {
    "best_day": "<dan>", "best_hour": <number>, "best_platform": "<platforma>",
    "reasoning": "<max 100 znakov>"
  },
  "summary": {
    "avg_intent_score": <number>, "hottest_item": "<naslov>",
    "coldest_item": "<naslov>", "items_needing_boost": <number>,
    "expected_portfolio_sell_through_30d_pct": <number>
  }
}`;
}

function transformIntent(parsed: any, items: Array<{ id: string }>): any {
  const validIds = new Set(items.map(i => i.id));
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    items: (parsed?.items || [])
      .filter((it: any) => validIds.has(String(it?.id ?? '')))
      .map((it: any) => ({
        tradeId: String(it?.id ?? ''),
        title: String(it?.title ?? '').slice(0, 150),
        category: String(it?.category ?? '').slice(0, 50),
        estValueEur: Math.max(0, Number(it?.est_value_eur ?? 0)),
        intentScore: Math.max(0, Math.min(100, Number(it?.intent_score ?? 50))),
        intentLevel: ['hot', 'warm', 'cool', 'cold'].includes(String(it?.intent_level)) ? String(it.intent_level) : 'warm',
        predictedSellProbability7dPct: Math.max(0, Math.min(100, Number(it?.predicted_sell_probability_7d_pct ?? 0))),
        predictedSellProbability30dPct: Math.max(0, Math.min(100, Number(it?.predicted_sell_probability_30d_pct ?? 0))),
        factors: (it?.factors || []).slice(0, 8).map((f: any) => ({
          factor: String(f?.factor ?? '').slice(0, 50),
          score: Math.max(0, Math.min(100, Number(f?.score ?? 50))),
          impact: ['positive', 'negative', 'neutral'].includes(String(f?.impact)) ? String(f.impact) : 'neutral',
          note: String(f?.note ?? '').slice(0, 100),
        })),
        buyerSignals: (it?.buyer_signals || []).slice(0, 4).map((s: any) => String(s).slice(0, 150)),
        recommendedActions: (it?.recommended_actions || []).slice(0, 4).map((a: any) => String(a).slice(0, 150)),
        optimalContactWindow: String(it?.optimal_contact_window ?? '').slice(0, 150),
        reasoning: String(it?.reasoning ?? '').slice(0, 200),
      })),
    signals: (parsed?.signals || []).slice(0, 8).map((s: any) => ({
      signal: String(s?.signal ?? '').slice(0, 80),
      type: ['market', 'seasonal', 'competitive', 'social'].includes(String(s?.type)) ? String(s.type) : 'market',
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
}
