// v6.46: AI Cross-Sell Recommender — priporoča cross-sell priložnosti per kupec in per inventar
// POST /api/ai/cross-sell-recommender
// Body: { customerName?: string, tradeId?: string }
// Returns: { ok, recommender: { opportunities, customerOffers, bundles, strategies, summary } }

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
    const customerName = body?.customerName ? String(body.customerName).trim() : null;
    const tradeId = body?.tradeId ? String(body.tradeId) : null;

    // 1. Pridobi held trade-e (inventar za cross-sell)
    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades = await db.trade.findMany({
      where,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: {
          select: { aiEstimatedValue: true, dealScore: true, imageUrl: true, location: true, url: true, description: true, detailDescription: true },
        },
      },
      take: tradeId ? 1 : 30,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, recommender: null, message: 'Ni held tradeov za cross-sell analizo.' });
    }

    // 2. Pridobi prodaje (za customer purchase history)
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' } },
      select: { id: true, title: true, category: true, sellPrice: true, sellDate: true, sellLocation: true, sellFees: true },
      take: 200,
      orderBy: { sellDate: 'desc' },
    });

    // 3. Customer history aggregation
    const customerHistory = new Map<string, { purchases: number; totalSpent: number; categories: Set<string>; items: string[]; lastPurchase: Date | null }>();
    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name) continue;
      if (!customerHistory.has(name)) {
        customerHistory.set(name, { purchases: 0, totalSpent: 0, categories: new Set<string>(), items: [], lastPurchase: null });
      }
      const c = customerHistory.get(name)!;
      c.purchases += 1;
      c.totalSpent += (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      if (t.category) c.categories.add(t.category);
      c.items.push(t.title);
      if (t.sellDate && (!c.lastPurchase || t.sellDate > c.lastPurchase)) c.lastPurchase = t.sellDate;
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // 4. Pripravi podatke za AI
    const inventoryItems = heldTrades.map(t => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));
      return {
        id: t.id, title: t.title, category: t.category || 'drugo',
        cost, estValue, daysHeld,
        description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 200),
      };
    });

    const customers = customerName
      ? Array.from(customerHistory.entries()).filter(([n]) => n === customerName)
      : Array.from(customerHistory.entries()).slice(0, 15);

    const customersData = customers.map(([name, c]) => ({
      name, purchases: c.purchases, totalSpent: Math.round(c.totalSpent),
      categories: Array.from(c.categories),
      items: c.items.slice(0, 5),
      lastPurchase: c.lastPurchase ? c.lastPurchase.toISOString().slice(0, 10) : '',
    }));

    const inventoryStr = inventoryItems.slice(0, 20).map(i =>
      `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d`
    ).join('\n');

    const customersStr = customersData.map(c =>
      `- ${c.name} | ${c.purchases}x | ${c.totalSpent}€ | kategorije: ${c.categories.join(', ')} | ${c.lastPurchase}`
    ).join('\n');

    const prompt = `Si AI cross-sell recommender za slovenske oglasne platforme.
Analiziraj inventar in zgodovino kupcev ter predlagaj cross-sell priložnosti.

INVENTAR (${inventoryItems.length}):
${inventoryStr}

KUPCI (${customersData.length}):
${customersStr}

Cross-sell taktike:
1. COMPLEMENTARY: dopolnilni itemi (npr. telefon + etui, kolo + čelada, avto + gumbe)
2. UPSELL: dražja verzija istega itema
3. BUNDLE: paket istih ali povezanih itemov z 5-15% popustom
4. REPEAT_BUY: isti item kot prej (nadomestitev, druga barva)
5. ACCESSORY: dodaten pribor za že kupljen item
6. WARRANTY: extended warranty / garancija
7. RELATED_CATEGORY: povezana kategorija (avto → gume, telefon → slušalke)
8. SEASONAL: sezonsko povezan item (poletje → klima, zima → grelec)

Pravila:
- Cross-sell naj ima smisel za kupec glede na prejšnje nakupe
- Cena cross-sella naj bo 30-80% originalnega nakupa
- Profit margin naj ostane > 20%
- Bundle popust 5-15% glede na skupno vrednost

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "opportunities": [
    { "customer_name": "<ime>", "inventory_id": "<trade_id>", "cross_sell_type": "<complementary|upsell|bundle|repeat_buy|accessory|warranty|related_category|seasonal>", "reasoning": "<max 120 znakov>", "suggested_price_eur": <number>, "expected_acceptance_pct": <number 0-100>, "profit_eur": <number>, "priority": "<high|medium|low>" }
  ],
  "customer_offers": [
    { "customer_name": "<ime>", "primary_item_id": "<trade_id>", "cross_sell_items": ["<trade_id>"], "bundle_price_eur": <number>, "individual_total_eur": <number>, "savings_eur": <number>, "expected_total_profit_eur": <number>, "pitch_message": "<max 200 znakov>", "best_channel": "<email|sms|call|in_person>" }
  ],
  "bundles": [
    { "bundle_name": "<max 60 znakov>", "item_ids": ["<trade_id>"], "category_combo": "<max 80 znakov>", "bundle_price_eur": <number>, "individual_total_eur": <number>, "discount_pct": <number>, "profit_eur": <number>, "target_audience": "<max 80 znakov>", "selling_point": "<max 120 znakov>" }
  ],
  "strategies": [
    { "strategy": "<complementary|upsell|bundle|repeat_buy|accessory|warranty|related_category|seasonal>", "description": "<max 120 znakov>", "best_for": "<max 80 znakov>", "expected_uplift_pct": <number>, "implementation_effort": "<low|medium|high>" }
  ],
  "summary": {
    "total_opportunities": <number>,
    "total_customers_targeted": <number>,
    "expected_extra_revenue_eur": <number>,
    "expected_extra_profit_eur": <number>,
    "avg_acceptance_rate_pct": <number>,
    "best_strategy": "<max 80 znakov>",
    "quickest_win": "<max 100 znakov>",
    "cross_sell_efficiency_score": <number 0-100>
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
    const validIds = new Set(inventoryItems.map(i => i.id));
    const validNames = new Set(customersData.map(c => c.name));

    const recommender = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      opportunities: (parsed?.opportunities || [])
        .filter((o: any) => validIds.has(String(o?.inventory_id ?? '')) && validNames.has(String(o?.customer_name ?? '')))
        .slice(0, 25)
        .map((o: any) => ({
          customerName: String(o?.customer_name ?? '').slice(0, 100),
          inventoryId: String(o?.inventory_id ?? '').slice(0, 50),
          crossSellType: ['complementary', 'upsell', 'bundle', 'repeat_buy', 'accessory', 'warranty', 'related_category', 'seasonal'].includes(String(o?.cross_sell_type)) ? String(o.cross_sell_type) : 'complementary',
          reasoning: String(o?.reasoning ?? '').slice(0, 250),
          suggestedPriceEur: Math.max(0, Math.round(Number(o?.suggested_price_eur ?? 0))),
          expectedAcceptancePct: Math.max(0, Math.min(100, Number(o?.expected_acceptance_pct ?? 50))),
          profitEur: Math.round(Number(o?.profit_eur ?? 0)),
          priority: ['high', 'medium', 'low'].includes(String(o?.priority)) ? String(o.priority) : 'medium',
        })),
      customerOffers: (parsed?.customer_offers || [])
        .filter((o: any) => validNames.has(String(o?.customer_name ?? '')))
        .slice(0, 15)
        .map((o: any) => ({
          customerName: String(o?.customer_name ?? '').slice(0, 100),
          primaryItemId: String(o?.primary_item_id ?? '').slice(0, 50),
          crossSellItems: (o?.cross_sell_items || []).filter((id: any) => validIds.has(String(id))).slice(0, 5).map((id: any) => String(id).slice(0, 50)),
          bundlePriceEur: Math.max(0, Math.round(Number(o?.bundle_price_eur ?? 0))),
          individualTotalEur: Math.max(0, Math.round(Number(o?.individual_total_eur ?? 0))),
          savingsEur: Math.round(Number(o?.savings_eur ?? 0)),
          expectedTotalProfitEur: Math.round(Number(o?.expected_total_profit_eur ?? 0)),
          pitchMessage: String(o?.pitch_message ?? '').slice(0, 400),
          bestChannel: ['email', 'sms', 'call', 'in_person'].includes(String(o?.best_channel)) ? String(o.best_channel) : 'email',
        })),
      bundles: (parsed?.bundles || [])
        .filter((b: any) => (b?.item_ids || []).some((id: any) => validIds.has(String(id))))
        .slice(0, 10)
        .map((b: any) => ({
          bundleName: String(b?.bundle_name ?? '').slice(0, 100),
          itemIds: (b?.item_ids || []).filter((id: any) => validIds.has(String(id))).slice(0, 6).map((id: any) => String(id).slice(0, 50)),
          categoryCombo: String(b?.category_combo ?? '').slice(0, 150),
          bundlePriceEur: Math.max(0, Math.round(Number(b?.bundle_price_eur ?? 0))),
          individualTotalEur: Math.max(0, Math.round(Number(b?.individual_total_eur ?? 0))),
          discountPct: Math.round(Number(b?.discount_pct ?? 0)),
          profitEur: Math.round(Number(b?.profit_eur ?? 0)),
          targetAudience: String(b?.target_audience ?? '').slice(0, 150),
          sellingPoint: String(b?.selling_point ?? '').slice(0, 200),
        })),
      strategies: (parsed?.strategies || []).slice(0, 8).map((s: any) => ({
        strategy: ['complementary', 'upsell', 'bundle', 'repeat_buy', 'accessory', 'warranty', 'related_category', 'seasonal'].includes(String(s?.strategy)) ? String(s.strategy) : 'complementary',
        description: String(s?.description ?? '').slice(0, 200),
        bestFor: String(s?.best_for ?? '').slice(0, 150),
        expectedUpliftPct: Math.round(Number(s?.expected_uplift_pct ?? 0)),
        implementationEffort: ['low', 'medium', 'high'].includes(String(s?.implementation_effort)) ? String(s.implementation_effort) : 'medium',
      })),
      summary: {
        totalOpportunities: Math.max(0, Number(parsed?.summary?.total_opportunities ?? 0)),
        totalCustomersTargeted: Math.max(0, Number(parsed?.summary?.total_customers_targeted ?? 0)),
        expectedExtraRevenueEur: Math.round(Number(parsed?.summary?.expected_extra_revenue_eur ?? 0)),
        expectedExtraProfitEur: Math.round(Number(parsed?.summary?.expected_extra_profit_eur ?? 0)),
        avgAcceptanceRatePct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_acceptance_rate_pct ?? 30))),
        bestStrategy: String(parsed?.summary?.best_strategy ?? '').slice(0, 150),
        quickestWin: String(parsed?.summary?.quickest_win ?? '').slice(0, 200),
        crossSellEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.cross_sell_efficiency_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, recommender });
  } catch (e: any) { logger.error("/api/ai/cross-sell-recommender", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
