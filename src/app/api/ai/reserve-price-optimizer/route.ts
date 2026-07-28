// v6.45: AI Reserve Price Optimizer — optimalni reserve price za auction listings z demand analizo
// POST /api/ai/reserve-price-optimizer
// Body: { tradeId?: string, auctionDurationDays?: number }
// Returns: { ok, optimizer: { items, demandAnalysis, reserveStrategy, auctionPlan, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

// Kategorije z auction podatki
const CATEGORY_AUCTION_PROFILE: Record<string, {
  auctionSuitability: number; // 0-100
  avgBidders: number;
  priceVolatility: number; // %
  optimalDuration: number; // dni
  reservePctOfValue: number; // % estValue
}> = {
  'elektronika':  { auctionSuitability: 75, avgBidders: 4, priceVolatility: 15, optimalDuration: 7, reservePctOfValue: 70 },
  'telefoni':     { auctionSuitability: 90, avgBidders: 7, priceVolatility: 20, optimalDuration: 5, reservePctOfValue: 75 },
  'avto':         { auctionSuitability: 95, avgBidders: 8, priceVolatility: 25, optimalDuration: 10, reservePctOfValue: 80 },
  'nepremicnine': { auctionSuitability: 60, avgBidders: 3, priceVolatility: 10, optimalDuration: 30, reservePctOfValue: 85 },
  'kolesa':       { auctionSuitability: 70, avgBidders: 5, priceVolatility: 18, optimalDuration: 7, reservePctOfValue: 70 },
  'pohištvo':     { auctionSuitability: 40, avgBidders: 2, priceVolatility: 12, optimalDuration: 10, reservePctOfValue: 65 },
  'drugo':        { auctionSuitability: 50, avgBidders: 3, priceVolatility: 15, optimalDuration: 7, reservePctOfValue: 70 },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const auctionDuration = Math.max(1, Math.min(30, Number(body?.auctionDurationDays ?? 7)));

    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;

    const heldTrades = await db.trade.findMany({
      where,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: {
          select: {
            aiEstimatedValue: true, dealScore: true, aiScore: true, aiRisk: true,
            location: true, price: true, firstSeenAt: true, url: true,
          },
        },
      },
      take: tradeId ? 1 : 25,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        optimizer: null,
        message: 'Ni held tradeov za reserve price optimizacijo.',
      });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // Pridobi zgodovino sold za similar items (za demand analizo)
    const recentSold = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellDate: true, buyDate: true },
      take: 200,
      orderBy: { sellDate: 'desc' },
    });

    const items = heldTrades.map(t => {
      const cat = (t.category || 'drugo').toLowerCase();
      const profile = CATEGORY_AUCTION_PROFILE[cat] ?? CATEGORY_AUCTION_PROFILE['drugo'];
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));

      // Zgodovina podobnih (kategorija)
      const similar = recentSold.filter(s => (s.category || '').toLowerCase() === cat);
      const similarPrices = similar.map(s => s.sellPrice ?? 0);
      const avgSimilarPrice = similarPrices.length > 0
        ? Math.round(similarPrices.reduce((a, b) => a + b, 0) / similarPrices.length)
        : estValue;
      const minSimilar = similarPrices.length > 0 ? Math.min(...similarPrices) : Math.round(estValue * 0.8);
      const maxSimilar = similarPrices.length > 0 ? Math.max(...similarPrices) : Math.round(estValue * 1.2);

      // Hitrost prodaje v kategoriji (povprečni dni od buy do sell)
      const similarDurations = similar.map(s => s.sellDate ? Math.round((s.sellDate.getTime() - s.buyDate.getTime()) / (24*60*60*1000)) : -1).filter(d => d >= 0);
      const avgDaysToSell = similarDurations.length > 0
        ? Math.round(similarDurations.reduce((a, b) => a + b, 0) / similarDurations.length)
        : 14;

      // Osnovni reserve price izračun (brez AI)
      const baseReserve = Math.round(estValue * (profile.reservePctOfValue / 100));
      const startingPrice = Math.round(baseReserve * 0.6); // 60% reserve = start
      const buyNowPrice = Math.round(estValue * 1.05); // 5% nad estValue

      return {
        id: t.id,
        title: t.title,
        category: cat,
        cost,
        estValue,
        daysHeld,
        profile,
        similarSoldCount: similar.length,
        avgSimilarPrice,
        minSimilarPrice: minSimilar,
        maxSimilarPrice: maxSimilar,
        avgDaysToSell,
        baseReserve,
        baseStartingPrice: startingPrice,
        baseBuyNowPrice: buyNowPrice,
        aiRisk: t.listing?.aiRisk ?? 5,
        dealScore: t.listing?.dealScore ?? 50,
        source: 'bolha',
      };
    });

    const itemsStr = items.map(i =>
      `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d v inventarju | podobnih prodanih: ${i.similarSoldCount} | povp cena: ${i.avgSimilarPrice}€ (${i.minSimilarPrice}-${i.maxSimilarPrice}€) | povp dni do prodaje: ${i.avgDaysToSell} | auctionSuitability ${i.profile.auctionSuitability}/100 | bidders ${i.profile.avgBidders} | volatilnost ${i.profile.priceVolatility}%`
    ).join('\n');

    const prompt = `Si AI reserve price optimizer za dražbe (auction) na Bolha, Avtonet, eBay.
Izračunaj optimalni reserve price, starting price in buy-now price za vsak item.

ITEMS ZA DRAŽBO (${items.length}):
${itemsStr}

Auction pravila:
1. STARTING_PRICE: 50-70% reserve price (privabi bidders)
2. RESERVE_PRICE: minimum pod katerim se ne proda (70-85% estValue)
3. BUY_NOW_PRICE: 100-115% estValue (za instant nakup)
4. AUCTION_DURATION: 5-10 dni (odvisno od kategorije)
5. SNIPER_PROTECTION: anti-snipe (avtomatsko podaljšanje za 5 min ob zadnji ponudbi)

Demand faktorji:
- HIGH_DEMAND (>5 bidderjev pričakovan): starting 60% reserve, reserve 75% estValue
- MEDIUM_DEMAND (3-5 bidderjev): starting 65% reserve, reserve 80% estValue
- LOW_DEMAND (<3 bidderjev): starting 70% reserve, reserve 85% estValue

Risk faktorji:
- HIGH_VOLATILITY (>20%): višji reserve za zaščito
- DEPRECIATING (elektronika, telefoni): hitra dražba, nižji reserve
- STABLE (nepremicnine): daljša dražba, višji reserve

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "demand_level": "<high|medium|low>",
      "expected_bidders": <number>,
      "starting_price_eur": <number>,
      "reserve_price_eur": <number>,
      "buy_now_price_eur": <number>,
      "optimal_duration_days": <number>,
      "auction_strategy": "<max 150 znakov>",
      "expected_final_price_eur": <number>,
      "probability_of_sale_pct": <number 0-100>,
      "risk_considerations": "<max 120 znakov>",
      "sniper_protection": <boolean>,
      "listing_day": "<pon|tor|sre|cet|pet|sob|ned>"
    }
  ],
  "demand_analysis": [
    { "category": "<kategorija>", "demand_trend": "<rising|stable|falling>", "avg_bidders": <number>, "price_trend": "<up|flat|down>", "best_auction_day": "<dan>", "saturation_level": "<low|medium|high>" }
  ],
  "reserve_strategy": [
    { "strategy": "<aggressive|moderate|conservative>", "reserve_pct": <number>, "starting_pct": <number>, "best_for": "<max 100 znakov>", "risk_level": "<low|medium|high>" }
  ],
  "auction_plan": [
    { "day": <1-30>, "items_to_list": <number>, "categories": ["<kategorije>"], "expected_revenue_eur": <number>, "notes": "<max 80 znakov>" }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_impact_eur": <number>, "risk_addressed": "<max 80 znakov>" }
  ],
  "summary": {
    "total_items": <number>,
    "total_reserve_value_eur": <number>,
    "expected_total_revenue_eur": <number>,
    "expected_total_profit_eur": <number>,
    "avg_probability_of_sale_pct": <number>,
    "best_auction_day": "<dan>",
    "reserve_optimization_score": <number 0-100>,
    "biggest_risk": "<max 100 znakov>",
    "quickest_win": "<max 100 znakov>"
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

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      items: (parsed?.items || [])
        .filter((it: any) => validIds.has(String(it?.id ?? '')))
        .slice(0, 25)
        .map((it: any) => {
          const orig = items.find(x => x.id === String(it?.id));
          return {
            tradeId: String(it?.id ?? ''),
            title: String(it?.title ?? orig?.title ?? '').slice(0, 150),
            demandLevel: ['high', 'medium', 'low'].includes(String(it?.demand_level)) ? String(it.demand_level) : 'medium',
            expectedBidders: Math.max(0, Math.min(20, Number(it?.expected_bidders ?? orig?.profile.avgBidders ?? 3))),
            startingPriceEur: Math.max(0, Math.round(Number(it?.starting_price_eur ?? orig?.baseStartingPrice ?? 0))),
            reservePriceEur: Math.max(0, Math.round(Number(it?.reserve_price_eur ?? orig?.baseReserve ?? 0))),
            buyNowPriceEur: Math.max(0, Math.round(Number(it?.buy_now_price_eur ?? orig?.baseBuyNowPrice ?? 0))),
            optimalDurationDays: Math.max(1, Math.min(30, Number(it?.optimal_duration_days ?? orig?.profile.optimalDuration ?? 7))),
            auctionStrategy: String(it?.auction_strategy ?? '').slice(0, 300),
            expectedFinalPriceEur: Math.round(Number(it?.expected_final_price_eur ?? orig?.estValue ?? 0)),
            probabilityOfSalePct: Math.max(0, Math.min(100, Number(it?.probability_of_sale_pct ?? 60))),
            riskConsiderations: String(it?.risk_considerations ?? '').slice(0, 200),
            sniperProtection: Boolean(it?.sniper_protection ?? true),
            listingDay: ['pon', 'tor', 'sre', 'cet', 'pet', 'sob', 'ned'].includes(String(it?.listing_day)) ? String(it.listing_day) : 'pet',
          };
        }),
      demandAnalysis: (parsed?.demand_analysis || []).slice(0, 8).map((d: any) => ({
        category: String(d?.category ?? '').slice(0, 50),
        demandTrend: ['rising', 'stable', 'falling'].includes(String(d?.demand_trend)) ? String(d.demand_trend) : 'stable',
        avgBidders: Math.max(0, Math.min(15, Number(d?.avg_bidders ?? 3))),
        priceTrend: ['up', 'flat', 'down'].includes(String(d?.price_trend)) ? String(d.price_trend) : 'flat',
        bestAuctionDay: ['pon', 'tor', 'sre', 'cet', 'pet', 'sob', 'ned'].includes(String(d?.best_auction_day)) ? String(d.best_auction_day) : 'pet',
        saturationLevel: ['low', 'medium', 'high'].includes(String(d?.saturation_level)) ? String(d.saturation_level) : 'medium',
      })),
      reserveStrategy: (parsed?.reserve_strategy || []).slice(0, 4).map((s: any) => ({
        strategy: ['aggressive', 'moderate', 'conservative'].includes(String(s?.strategy)) ? String(s.strategy) : 'moderate',
        reservePct: Math.max(0, Math.min(100, Number(s?.reserve_pct ?? 75))),
        startingPct: Math.max(0, Math.min(100, Number(s?.starting_pct ?? 60))),
        bestFor: String(s?.best_for ?? '').slice(0, 200),
        riskLevel: ['low', 'medium', 'high'].includes(String(s?.risk_level)) ? String(s.risk_level) : 'medium',
      })),
      auctionPlan: (parsed?.auction_plan || []).slice(0, 14).map((p: any) => ({
        day: Math.max(1, Math.min(30, Number(p?.day ?? 1))),
        itemsToList: Math.max(0, Math.min(20, Number(p?.items_to_list ?? 0))),
        categories: (p?.categories || []).slice(0, 5).map((c: any) => String(c).slice(0, 40)),
        expectedRevenueEur: Math.round(Number(p?.expected_revenue_eur ?? 0)),
        notes: String(p?.notes ?? '').slice(0, 150),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        expectedImpactEur: Math.round(Number(r?.expected_impact_eur ?? 0)),
        riskAddressed: String(r?.risk_addressed ?? '').slice(0, 150),
      })),
      summary: {
        totalItems: items.length,
        totalReserveValueEur: Math.round(Number(parsed?.summary?.total_reserve_value_eur ?? items.reduce((s, i) => s + i.baseReserve, 0))),
        expectedTotalRevenueEur: Math.round(Number(parsed?.summary?.expected_total_revenue_eur ?? items.reduce((s, i) => s + i.estValue, 0))),
        expectedTotalProfitEur: Math.round(Number(parsed?.summary?.expected_total_profit_eur ?? items.reduce((s, i) => s + (i.estValue - i.cost), 0))),
        avgProbabilityOfSalePct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_probability_of_sale_pct ?? 60))),
        bestAuctionDay: ['pon', 'tor', 'sre', 'cet', 'pet', 'sob', 'ned'].includes(String(parsed?.summary?.best_auction_day)) ? String(parsed.summary.best_auction_day) : 'pet',
        reserveOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.reserve_optimization_score ?? 60))),
        biggestRisk: String(parsed?.summary?.biggest_risk ?? '').slice(0, 200),
        quickestWin: String(parsed?.summary?.quickest_win ?? '').slice(0, 200),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
