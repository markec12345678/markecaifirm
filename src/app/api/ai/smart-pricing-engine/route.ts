// v6.36: AI Smart Pricing Engine — real-time dinamično prilagajanje cen
// POST /api/ai/smart-pricing-engine
// Body: { tradeIds?: string[] }
// Returns: { ok, pricing: { items: [], rules, marketSignals, adjustments, summary } }

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
    const requestedIds: string[] = Array.isArray(body?.tradeIds) ? body.tradeIds.filter(Boolean) : [];

    const heldTrades = await db.trade.findMany({
      where: { status: 'held', ...(requestedIds.length > 0 ? { id: { in: requestedIds } } : {}) },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, previousPrice: true, priceDroppedAt: true } } },
      take: 40,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, pricing: null, message: 'Ni held tradeov za pricing engine.' });
    }

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
      select: { category: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true },
      take: 200,
    });

    const recentListings = await db.listing.findMany({
      where: { isHidden: false, firstSeenAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      select: { price: true, dealScore: true, monitor: { select: { source: true } } },
      take: 200,
    });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const items = heldTrades.map(t => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));
      const lastPriceDrop = t.listing?.priceDroppedAt ? Math.round((Date.now() - t.listing.priceDroppedAt.getTime()) / (24*60*60*1000)) : null;
      return { id: t.id, title: t.title, category: t.category || 'drugo', cost, estValue, daysHeld, dealScore: t.listing?.dealScore ?? 0, lastPriceDrop, previousPrice: t.listing?.previousPrice };
    });

    const recentAvgPrice = recentListings.length > 0 ? Math.round(recentListings.reduce((s, l) => s + (l.price ?? 0), 0) / recentListings.length) : 0;
    const soldAvgRoi = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => {
      const c = t.buyPrice; const r = t.sellPrice ?? 0;
      return s + (c > 0 ? ((r - c) / c) * 100 : 0);
    }, 0) / soldTrades.length) : 0;

    const itemsStr = items.slice(0, 20).map(i => `- [${i.id}] ${i.title} | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d${i.lastPriceDrop ? ` | padec ${i.lastPriceDrop}d nazaj` : ''}`).join('\n');

    const prompt = `Si AI dinamični pricing engine za real-time prilagajanje cen.
Za vsak held item določi optimalno ceno glede na vse tržne faktorje.

INVENTAR (${items.length}):
${itemsStr}

TRŽNI SIGNALI:
- Nedavni oglasi (7d): ${recentListings.length}, povp. cena ${recentAvgPrice}€
- Povp. ROI prodaj (90d): ${soldAvgRoi}%
- Prodaj v 90d: ${soldTrades.length}

Dinamični pricing faktorji:
1. BASE PRICE: est. value (AI ocenjena tržna vrednost)
2. DAYS HELD ADJUSTMENT: -1% na teden za vsak teden nad 14 dni (max -30%)
3. SEASONAL ADJUSTMENT: +20% v sezonskem vrhu, -15% izven sezone
4. MARKET DEMAND: višje povpraševanje = +5-15%, nižje = -5-15%
5. COMPETITION: več podobnih oglasov = -5-10%, manj = +5-10%
6. URGENCY: stalled >45d = -10-20% za hitro likvidacijo
7. QUALITY PREMIUM: deal score >= 80 = +5-10%
8. BUNDLE POTENTIAL: če je del bundla = +5-10% (bundle cena)

Pricing strategije:
- "hold_premium": ohrani visoko ceno (premium item, nizka konkurenca)
- "gradual_decrease": -5% na teden do prodaje
- "aggressive_clearance": -15-25% za hitro likvidacijo
- "auction_style": začni nizko + "drama" (cena pada vsak dan)
- "psychological": 199€ namesto 200€ (charm pricing)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "category": "<kategorija>",
      "cost_eur": <number>,
      "base_price_eur": <number>,
      "adjustments": [
        { "factor": "<days_held|seasonal|demand|competition|urgency|quality|bundle>", "adjustment_pct": <number>, "reasoning": "<max 60 znakov>" }
      ],
      "final_suggested_price_eur": <number>,
      "current_price_eur": <number>,
      "price_change_eur": <number>,
      "price_change_pct": <number>,
      "strategy": "<hold_premium|gradual_decrease|aggressive_clearance|auction_style|psychological>",
      "psychological_price_eur": <number>,
      "min_acceptable_price_eur": <number>,
      "expected_sell_probability_pct": <number>,
      "expected_sell_time_days": <number>,
      "next_adjustment_in_days": <number>,
      "next_adjustment_direction": "<up|down|hold>",
      "reasoning": "<max 120 znakov>"
    }
  ],
  "pricing_rules": [
    { "rule": "<max 80 znakov>", "trigger": "<max 80 znakov>", "action": "<max 80 znakov>", "applies_to": "<kategorije>" }
  ],
  "market_signals": [
    { "signal": "<max 80 znakov>", "direction": "<bullish|bearish|neutral>", "impact_on_pricing": "<max 80 znakov>" }
  ],
  "summary": {
    "total_items": <number>,
    "avg_price_adjustment_pct": <number>,
    "items_price_increase": <number>,
    "items_price_decrease": <number>,
    "items_hold": <number>,
    "projected_revenue_change_eur": <number>,
    "projected_sell_time_reduction_days": <number>
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
    const validIds = new Set(items.map(i => i.id));

    const pricing = {
      insights: String(parsed?.insights ?? '').slice(0, 600),
      items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).map((it: any) => ({
        tradeId: String(it?.id ?? ''),
        title: String(it?.title ?? '').slice(0, 150),
        category: String(it?.category ?? '').slice(0, 50),
        costEur: Math.round(Number(it?.cost_eur ?? 0)),
        basePriceEur: Math.round(Number(it?.base_price_eur ?? 0)),
        adjustments: (it?.adjustments || []).slice(0, 7).map((a: any) => ({
          factor: String(a?.factor ?? '').slice(0, 50),
          adjustmentPct: Math.round(Number(a?.adjustment_pct ?? 0)),
          reasoning: String(a?.reasoning ?? '').slice(0, 100),
        })),
        finalSuggestedPriceEur: Math.round(Number(it?.final_suggested_price_eur ?? 0)),
        currentPriceEur: Math.round(Number(it?.current_price_eur ?? 0)),
        priceChangeEur: Math.round(Number(it?.price_change_eur ?? 0)),
        priceChangePct: Math.round(Number(it?.price_change_pct ?? 0)),
        strategy: ['hold_premium', 'gradual_decrease', 'aggressive_clearance', 'auction_style', 'psychological'].includes(String(it?.strategy)) ? String(it.strategy) : 'gradual_decrease',
        psychologicalPriceEur: Math.round(Number(it?.psychological_price_eur ?? 0)),
        minAcceptablePriceEur: Math.round(Number(it?.min_acceptable_price_eur ?? 0)),
        expectedSellProbabilityPct: Math.max(0, Math.min(100, Number(it?.expected_sell_probability_pct ?? 50))),
        expectedSellTimeDays: Math.max(0, Number(it?.expected_sell_time_days ?? 14)),
        nextAdjustmentInDays: Math.max(0, Number(it?.next_adjustment_in_days ?? 7)),
        nextAdjustmentDirection: ['up', 'down', 'hold'].includes(String(it?.next_adjustment_direction)) ? String(it.nextAdjustmentDirection) : 'hold',
        reasoning: String(it?.reasoning ?? '').slice(0, 250),
      })),
      pricingRules: (parsed?.pricing_rules || []).slice(0, 6).map((r: any) => ({
        rule: String(r?.rule ?? '').slice(0, 150),
        trigger: String(r?.trigger ?? '').slice(0, 150),
        action: String(r?.action ?? '').slice(0, 150),
        appliesTo: String(r?.applies_to ?? '').slice(0, 100),
      })),
      marketSignals: (parsed?.market_signals || []).slice(0, 5).map((s: any) => ({
        signal: String(s?.signal ?? '').slice(0, 150),
        direction: ['bullish', 'bearish', 'neutral'].includes(String(s?.direction)) ? String(s.direction) : 'neutral',
        impactOnPricing: String(s?.impact_on_pricing ?? '').slice(0, 150),
      })),
      summary: {
        totalItems: Math.max(0, Number(parsed?.summary?.total_items ?? 0)),
        avgPriceAdjustmentPct: Math.round(Number(parsed?.summary?.avg_price_adjustment_pct ?? 0)),
        itemsPriceIncrease: Math.max(0, Number(parsed?.summary?.items_price_increase ?? 0)),
        itemsPriceDecrease: Math.max(0, Number(parsed?.summary?.items_price_decrease ?? 0)),
        itemsHold: Math.max(0, Number(parsed?.summary?.items_hold ?? 0)),
        projectedRevenueChangeEur: Math.round(Number(parsed?.summary?.projected_revenue_change_eur ?? 0)),
        projectedSellTimeReductionDays: Math.round(Number(parsed?.summary?.projected_sell_time_reduction_days ?? 0)),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, pricing });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
