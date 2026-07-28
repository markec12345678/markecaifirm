// v6.33: AI Cross-Category Bundle Optimizer — kombinira iteme iz RAZLIČNIH kategorij
// POST /api/ai/cross-category-bundle
// Body: {}
// Returns: { ok, bundles: [], insights, summary }

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

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 40,
    });

    if (heldTrades.length < 2) {
      return NextResponse.json({ ok: true, bundles: [], message: 'Potrebna vsaj 2 itema za cross-category bundle.' });
    }

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
      cost: t.buyPrice + (t.buyFees ?? 0),
      estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)),
    }));

    // Group by category
    const byCat: Record<string, typeof items> = {};
    for (const i of items) {
      if (!byCat[i.category]) byCat[i.category] = [];
      byCat[i.category].push(i);
    }
    const categories = Object.keys(byCat);

    const itemsStr = items.slice(0, 25).map(i => `- [${i.id}] ${i.title} | ${i.category} | nabavna: ${i.cost}€ | est: ${i.estValue}€ | ${i.daysHeld}d`).join('\n');

    const prompt = `Si ekspert za cross-category bundle strategije.
Kombiniraj iteme iz RAZLIČNIH kategorij v privlačne bundle za kupce.

INVENTAR PO KATEGORIJAH (${categories.length} kategorij: ${categories.join(', ')}):
${itemsStr}

Cross-category bundle koncepti:
1. "lifestyle_bundle": elektronika + pohištvo + drugo (npr. gaming setup: monitor + miza + slušalke)
2. "seasonal_bundle": smuči + zimski športni + oblačila (zimski paket)
3. "upgrade_bundle": star item + nov item (npr. star telefon + nov polnilec)
4. "gift_bundle": raznoliki itemi za darila (božič, rojstni dan)
5. "starter_kit": osnovna oprema za začetnika (študent, novi lastnik, itd.)
6. "complementary_bundle": itemi ki se dopolnjujejo (avto + zimske gume + navigacija)

Pravila:
1. Bundle mora vsebovati iteme iz vsaj 2 RAZLIČNIH kategorij
2. Bundle cena 5-15% pod vsoto posameznih cen
3. Profit mora biti večji kot pri posamični prodaji
4. Prioritiziraj stalled iteme (>30d) za vključitev v bundle
5. Vsak item je samo v enem bundleu
6. Bundle naj ima jasno "zgodbo" (why these items together)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "bundles": [
    {
      "name": "<ime bundla, max 80 znakov>",
      "concept": "<lifestyle_bundle|seasonal_bundle|upgrade_bundle|gift_bundle|starter_kit|complementary_bundle>",
      "story": "<zakaj ti itemi skupaj, max 150 znakov>",
      "item_ids": ["<trade_id>", "<trade_id>"],
      "categories": ["<kat1>", "<kat2>"],
      "individual_total_eur": <number>,
      "bundle_price_eur": <number>,
      "savings_pct": <number>,
      "total_cost_eur": <number>,
      "expected_profit_eur": <number>,
      "expected_sell_time_days": <number>,
      "target_buyer": "<kdo bi kupil, max 80 znakov>",
      "platform": "<bolha|facebook|vinted>",
      "reasoning": "<max 120 znakov>"
    }
  ],
  "summary": {
    "total_bundles": <number>,
    "bundled_items": <number>,
    "total_bundle_profit_eur": <number>,
    "avg_savings_pct": <number>,
    "unbundled_items": <number>
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
    const itemMap = new Map(items.map(i => [i.id, i]));
    const usedIds = new Set<string>();

    const bundles = (parsed?.bundles || []).map((b: any) => {
      const itemIds: string[] = (Array.isArray(b?.item_ids) ? b.item_ids : []).filter((id: any) => validIds.has(String(id)) && !usedIds.has(String(id)));
      if (itemIds.length < 2) return null;
      itemIds.forEach(id => usedIds.add(id));
      const bundleItems = itemIds.map(id => { const o = itemMap.get(id)!; return { id: o.id, title: o.title, category: o.category, cost: o.cost, estValue: o.estValue }; });
      const individualTotal = bundleItems.reduce((s, i) => s + i.estValue, 0);
      const totalCost = bundleItems.reduce((s, i) => s + i.cost, 0);
      const bundlePrice = Number(b?.bundle_price_eur ?? Math.round(individualTotal * 0.9));
      const savingsPct = individualTotal > 0 ? Math.round(((individualTotal - bundlePrice) / individualTotal) * 100) : 0;
      return {
        name: String(b?.name ?? 'Bundle').slice(0, 120),
        concept: ['lifestyle_bundle', 'seasonal_bundle', 'upgrade_bundle', 'gift_bundle', 'starter_kit', 'complementary_bundle'].includes(String(b?.concept)) ? String(b.concept) : 'complementary_bundle',
        story: String(b?.story ?? '').slice(0, 300),
        items: bundleItems,
        categories: [...new Set(bundleItems.map(i => i.category))],
        individualTotal,
        bundlePrice,
        totalCost,
        savingsPct: Math.max(0, Math.min(50, savingsPct)),
        expectedProfit: Math.round(bundlePrice - totalCost),
        expectedSellTimeDays: Math.max(1, Math.min(60, Number(b?.expected_sell_time_days ?? 14))),
        targetBuyer: String(b?.target_buyer ?? '').slice(0, 150),
        platform: ['bolha', 'facebook', 'vinted'].includes(String(b?.platform)) ? String(b.platform) : 'bolha',
        reasoning: String(b?.reasoning ?? '').slice(0, 250),
      };
    }).filter(Boolean);

    const totalBundleProfit = bundles.reduce((s: number, b: any) => s + (b?.expectedProfit ?? 0), 0);
    const avgSavings = bundles.length > 0 ? Math.round(bundles.reduce((s: number, b: any) => s + b.savingsPct, 0) / bundles.length) : 0;

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      insights: String(parsed?.insights ?? '').slice(0, 500),
      bundles,
      summary: {
        totalBundles: bundles.length,
        bundledItems: usedIds.size,
        totalBundleProfitEur: totalBundleProfit,
        avgSavingsPct: avgSavings,
        unbundledItems: items.length - usedIds.size,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
