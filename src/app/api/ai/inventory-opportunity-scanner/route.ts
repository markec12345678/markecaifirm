// v6.68: AI Inventory Opportunity Scanner — skenira inventar za hidden opportunities z ML
// POST /api/ai/inventory-opportunity-scanner
// Body: { tradeId?: string }
// Returns: { ok, scanner: { opportunities, hidden, crossSell, bundle, upcycle, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const OPPORTUNITY_TYPES = ['bundle_creation', 'cross_sell_pairing', 'upcycle_renovation', 'price_optimization', 'platform_switch', 'seasonal_timing', 'bundle_liquidation', 'wholesale_lot', 'trade_in_credit', 'auction_opportunity'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades = await db.trade.findMany({ where, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true, location: true } } }, take: tradeId ? 1 : 50 });
    if (heldTrades.length === 0) return NextResponse.json({ ok: true, scanner: null, message: 'Ni held tradeov za opportunity scanning.' });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const items = heldTrades.map(t => { const cost = t.buyPrice + (t.buyFees ?? 0); const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25); const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)); return { id: t.id, title: t.title, category: (t.category || 'drugo').toLowerCase(), cost, estValue, daysHeld, dealScore: t.listing?.dealScore ?? 50, aiRisk: t.listing?.aiRisk ?? 5, location: t.listing?.location ?? '' }; });
    const itemsStr = items.slice(0, 25).map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d`).join('\n');

    const prompt = `Si AI inventory opportunity scanner z ML za odkrivanje hidden priložnosti.
Skenira inventar za bundle, cross-sell, upcycle, auction in druge opportunities.

INVENTAR (${items.length}):
${itemsStr}

10 opportunity tipov:
1. BUNDLE_CREATION: kombiniraj 2+ itemov v paket z višjo maržo
2. CROSS_SELL_PAIRING: dopolnilni itemi (telefon + etui)
3. UPCYCLE_RENOVATION: obnovi item za višjo prodajno ceno
4. PRICE_OPTIMIZATION: cena je pod tržno, dvigni
5. PLATFORM_SWITCH: prestavi na boljšo platformo
6. SEASONAL_TIMING: počakaj na sezono za višjo ceno
7. BUNDLE_LIQUIDATION: paket za hitro likvidacijo
8. WHOLESALE_LOT: prodaj lot reseller-ju
9. TRADE_IN_CREDIT: ponudi kot trade-in
10. AUCTION_OPPORTUNITY: dražba za višjo ceno

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "opportunities": [
    { "opportunity_type": "<10 tipov>", "description": "<max 150 znakov>", "item_ids": ["<trade_id>"], "current_value_eur": <number>, "potential_value_eur": <number>, "uplift_eur": <number>, "uplift_pct": <number>, "implementation_effort": "<low|medium|high>", "timeframe_days": <number>, "priority": "<high|medium|low>", "reasoning": "<max 150 znakov>" }
  ],
  "hidden": [
    { "item_id": "<trade_id>", "hidden_value_eur": <number>, "hidden_value_source": "<max 100 znakov>", "current_realization_pct": <number 0-100>, "maximization_action": "<max 150 znakov>", "expected_additional_profit_eur": <number> }
  ],
  "crossSell": [
    { "primary_item_id": "<trade_id>", "cross_sell_item_ids": ["<trade_id>"], "bundle_value_eur": <number>, "individual_total_eur": <number>, "discount_pct": <number>, "expected_profit_eur": <number>, "target_buyer": "<max 80 znakov>" }
  ],
  "bundle": [
    { "bundle_name": "<max 60 znakov>", "item_ids": ["<trade_id>"], "bundle_price_eur": <number>, "individual_total_eur": <number>, "discount_pct": <number>, "profit_eur": <number>, "best_platform": "<bolha|facebook|vinted|ebay>", "selling_point": "<max 120 znakov>" }
  ],
  "upcycle": [
    { "item_id": "<trade_id>", "current_value_eur": <number>, "upcycled_value_eur": <number>, "renovation_cost_eur": <number>, "net_uplift_eur": <number>, "renovation_steps": ["<max 80 znakov>"], "timeframe_days": <number>, "roi_pct": <number> }
  ],
  "summary": {
    "total_items_scanned": <number>, "total_opportunities_found": <number>,
    "total_potential_uplift_eur": <number>, "avg_uplift_pct": <number>,
    "biggest_opportunity": "<max 100 znakov>", "quickest_opportunity": "<max 100 znakov>",
    "opportunity_scan_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);
    const validIds = new Set(items.map(i => i.id));
    const scanner = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      opportunities: (parsed?.opportunities || []).filter((o: any) => (o?.item_ids || []).some((id: any) => validIds.has(String(id)))).slice(0, 12).map((o: any) => ({
        opportunityType: OPPORTUNITY_TYPES.includes(String(o?.opportunity_type) as any) ? String(o.opportunity_type) : 'bundle_creation',
        description: String(o?.description ?? '').slice(0, 300), itemIds: (o?.item_ids || []).filter((id: any) => validIds.has(String(id))).slice(0, 6).map((id: any) => String(id).slice(0, 50)),
        currentValueEur: Math.round(Number(o?.current_value_eur ?? 0)), potentialValueEur: Math.round(Number(o?.potential_value_eur ?? 0)),
        upliftEur: Math.round(Number(o?.uplift_eur ?? 0)), upliftPct: Math.round(Number(o?.uplift_pct ?? 0) * 10) / 10,
        implementationEffort: ['low', 'medium', 'high'].includes(String(o?.implementation_effort)) ? String(o.implementation_effort) : 'medium',
        timeframeDays: Math.max(1, Number(o?.timeframe_days ?? 7)), priority: ['high', 'medium', 'low'].includes(String(o?.priority)) ? String(o.priority) : 'medium',
        reasoning: String(o?.reasoning ?? '').slice(0, 300),
      })),
      hidden: (parsed?.hidden || []).filter((h: any) => validIds.has(String(h?.item_id ?? ''))).slice(0, 10).map((h: any) => ({
        itemId: String(h?.item_id ?? '').slice(0, 50), hiddenValueEur: Math.round(Number(h?.hidden_value_eur ?? 0)),
        hiddenValueSource: String(h?.hidden_value_source ?? '').slice(0, 200), currentRealizationPct: Math.max(0, Math.min(100, Number(h?.current_realization_pct ?? 50))),
        maximizationAction: String(h?.maximization_action ?? '').slice(0, 300), expectedAdditionalProfitEur: Math.round(Number(h?.expected_additional_profit_eur ?? 0)),
      })),
      crossSell: (parsed?.cross_sell || []).filter((c: any) => validIds.has(String(c?.primary_item_id ?? ''))).slice(0, 8).map((c: any) => ({
        primaryItemId: String(c?.primary_item_id ?? '').slice(0, 50), crossSellItemIds: (c?.cross_sell_item_ids || []).filter((id: any) => validIds.has(String(id))).slice(0, 4).map((id: any) => String(id).slice(0, 50)),
        bundleValueEur: Math.round(Number(c?.bundle_value_eur ?? 0)), individualTotalEur: Math.round(Number(c?.individual_total_eur ?? 0)),
        discountPct: Math.round(Number(c?.discount_pct ?? 0) * 10) / 10, expectedProfitEur: Math.round(Number(c?.expected_profit_eur ?? 0)),
        targetBuyer: String(c?.target_buyer ?? '').slice(0, 150),
      })),
      bundle: (parsed?.bundle || []).filter((b: any) => (b?.item_ids || []).some((id: any) => validIds.has(String(id)))).slice(0, 8).map((b: any) => ({
        bundleName: String(b?.bundle_name ?? '').slice(0, 100), itemIds: (b?.item_ids || []).filter((id: any) => validIds.has(String(id))).slice(0, 6).map((id: any) => String(id).slice(0, 50)),
        bundlePriceEur: Math.round(Number(b?.bundle_price_eur ?? 0)), individualTotalEur: Math.round(Number(b?.individual_total_eur ?? 0)),
        discountPct: Math.round(Number(b?.discount_pct ?? 0) * 10) / 10, profitEur: Math.round(Number(b?.profit_eur ?? 0)),
        bestPlatform: ['bolha', 'facebook', 'vinted', 'ebay'].includes(String(b?.best_platform)) ? String(b.best_platform) : 'bolha',
        sellingPoint: String(b?.selling_point ?? '').slice(0, 250),
      })),
      upcycle: (parsed?.upcycle || []).filter((u: any) => validIds.has(String(u?.item_id ?? ''))).slice(0, 8).map((u: any) => ({
        itemId: String(u?.item_id ?? '').slice(0, 50), currentValueEur: Math.round(Number(u?.current_value_eur ?? 0)),
        upcycledValueEur: Math.round(Number(u?.upcycled_value_eur ?? 0)), renovationCostEur: Math.round(Number(u?.renovation_cost_eur ?? 0)),
        netUpliftEur: Math.round(Number(u?.net_uplift_eur ?? 0)), renovationSteps: (u?.renovation_steps || []).slice(0, 5).map((s: any) => String(s).slice(0, 150)),
        timeframeDays: Math.max(1, Number(u?.timeframe_days ?? 7)), roiPct: Math.round(Number(u?.roi_pct ?? 0) * 10) / 10,
      })),
      summary: {
        totalItemsScanned: items.length, totalOpportunitiesFound: Math.max(0, Number(parsed?.summary?.total_opportunities_found ?? 0)),
        totalPotentialUpliftEur: Math.round(Number(parsed?.summary?.total_potential_uplift_eur ?? 0)),
        avgUpliftPct: Math.round(Number(parsed?.summary?.avg_uplift_pct ?? 0) * 10) / 10,
        biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 200),
        quickestOpportunity: String(parsed?.summary?.quickest_opportunity ?? '').slice(0, 200),
        opportunityScanScore: Math.max(0, Math.min(100, Number(parsed?.summary?.opportunity_scan_score ?? 60))),
      },
    };
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }
    return NextResponse.json({ ok: true, scanner });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
