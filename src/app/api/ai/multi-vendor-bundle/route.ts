// v6.16: AI Multi-Vendor Bundle Deals — AI kombinira inventar iz različnih virov/prodajalcev
// POST /api/ai/multi-vendor-bundle
// Body: { maxItems?: number }
// Returns: { ok, deals: [{ name, items, individualTotal, bundlePrice, savingsPct, expectedProfit, sources, reasoning }], insights, summary }

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
    const maxItems = Math.max(3, Math.min(15, Number(body?.maxItems) || 8));

    // 1. Pridobi held trades + listing podatke o viru
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        buyLocation: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, monitor: { select: { source: true, name: true } } } },
      },
      take: 30,
    });

    if (heldTrades.length < 2) {
      return NextResponse.json({
        ok: true,
        deals: [],
        message: 'Za multi-vendor bundle so potrebni vsaj 2 itema iz različnih virov.',
      });
    }

    // 2. Pridobi sold trades za kontekst uspešnosti
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { title: true, category: true, buyPrice: true, sellPrice: true, buyLocation: true, sellLocation: true },
      take: 100,
    });

    // 3. Pripravi iteme z virom
    const items = heldTrades.map(t => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const source = t.listing?.monitor?.source || t.buyLocation || 'neznan';
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      return {
        id: t.id,
        title: t.title,
        category: t.category || 'drugo',
        cost,
        estValue,
        source,
        daysHeld,
        dealScore: t.listing?.dealScore ?? 0,
      };
    });

    // Group by source za multi-vendor
    const bySource: Record<string, typeof items> = {};
    for (const i of items) {
      if (!bySource[i.source]) bySource[i.source] = [];
      bySource[i.source].push(i);
    }
    const sources = Object.keys(bySource);

    // 4. AI multi-vendor bundle
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const itemsStr = items.map(i =>
      `- [${i.id}] ${i.title} | ${i.category} | vir: ${i.source} | nabavna: ${i.cost}€ | est. prodajna: ${i.estValue}€ | ${i.daysHeld}d v skladišču`
    ).join('\n');

    const soldStr = soldTrades.slice(0, 20).map(t =>
      `- ${t.title} | ${t.category} | kupljeno na: ${t.buyLocation || 'neznan'} | prodano na: ${t.sellLocation || 'neznan'} | ${(t.sellPrice ?? 0) - t.buyPrice}€ dobička`
    ).join('\n');

    const prompt = `Si ekspert za multi-vendor bundle strategije pri preprodaji.
Kombiniraj iteme iz RAZLIČNIH virov/prodajalcev v bundle za maksimalni dobiček.

INVENTAR PO VIRIH (${sources.length} virov: ${sources.join(', ')}):
${itemsStr}

ZGODOVINSKE PRODAJE:
${soldStr || '- Ni podatkov'}

Pravila za multi-vendor bundle:
1. Kombiniraj iteme iz vsaj 2 različnih virov (bolha + nepremicnine, avtonet + bolha, itd.)
2. Items naj bodo komplementarni (npr. telefon iz Bolha + slušalke iz Vinted)
3. Bundle cena naj bo 5-15% NIŽJA od vsote posameznih
4. Profit mora biti večji kot pri posamični prodaji
5. Prioritiziraj stalled iteme (>30d)
6. Vsak item je samo v enem bundleu

Strategije bundle:
- "complete_setup": kompletiraj setup (npr. avto + zimske gume + navezniki)
- "mixed_category": različne kategorije za raznoliko ponudbo
- "cross_source": izkoristi prednosti vsakega vira (bolha ceneje, vinted modni)
- "premium_discount": premium bundle z diskontom
- "starter_pack": začetniški paket

Odgovori LE z JSON:
{
  "insights": "<splošne ugotovitve, max 200 znakov>",
  "deals": [
    {
      "name": "<ime bundla, max 80 znakov>",
      "strategy": "<complete_setup|mixed_category|cross_source|premium_discount|starter_pack>",
      "item_ids": ["<trade_id>", "<trade_id>"],
      "sources": ["<vir1>", "<vir2>"],
      "individual_total_eur": <number>,
      "bundle_price_eur": <number>,
      "savings_pct": <number>,
      "total_cost_eur": <number>,
      "expected_profit_eur": <number>,
      "expected_sell_time_days": <number>,
      "target_buyer": "<kdo bi kupil, max 80 znakov>",
      "reasoning": "<max 120 znakov>"
    }
  ]
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
    const validIds = new Set(items.map(i => i.id));
    const itemMap = new Map(items.map(i => [i.id, i]));
    const usedIds = new Set<string>();

    const deals = (parsed?.deals || []).map((d: any) => {
      const itemIds: string[] = Array.isArray(d?.item_ids)
        ? d.item_ids.filter((id: any) => typeof id === 'string' && validIds.has(id) && !usedIds.has(id))
        : [];
      if (itemIds.length < 2) return null;
      itemIds.forEach(id => usedIds.add(id));

      const bundleItems = itemIds.map(id => {
        const orig = itemMap.get(id)!;
        return { id: orig.id, title: orig.title, source: orig.source, cost: orig.cost, estValue: orig.estValue };
      });
      const sourcesUsed = [...new Set(bundleItems.map(i => i.source))];
      const individualTotal = bundleItems.reduce((s, i) => s + i.estValue, 0);
      const totalCost = bundleItems.reduce((s, i) => s + i.cost, 0);
      const bundlePrice = Number(d?.bundle_price_eur ?? Math.round(individualTotal * 0.9));
      const savingsPct = individualTotal > 0 ? Math.round(((individualTotal - bundlePrice) / individualTotal) * 100) : 0;
      const expectedProfit = Math.round(bundlePrice - totalCost);

      return {
        name: String(d?.name ?? 'Bundle').slice(0, 120),
        strategy: String(d?.strategy ?? 'cross_source').slice(0, 30),
        items: bundleItems,
        sources: sourcesUsed,
        individualTotal,
        bundlePrice,
        totalCost,
        savingsPct: Math.max(0, Math.min(50, savingsPct)),
        expectedProfit,
        expectedSellTimeDays: Math.max(1, Math.min(120, Number(d?.expected_sell_time_days ?? 14))),
        targetBuyer: String(d?.target_buyer ?? '').slice(0, 150),
        reasoning: String(d?.reasoning ?? '').slice(0, 250),
      };
    }).filter(Boolean);

    const totalBundleProfit = deals.reduce((s: number, d: any) => s + (d?.expectedProfit ?? 0), 0);
    const avgSavings = deals.length > 0
      ? Math.round(deals.reduce((s: number, d: any) => s + d.savingsPct, 0) / deals.length)
      : 0;
    const unusedItems = items.filter(i => !usedIds.has(i.id));

    // Increment AI usage
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      insights: String(parsed?.insights ?? '').slice(0, 500),
      deals,
      summary: {
        totalItems: items.length,
        bundledItems: usedIds.size,
        unbundledItems: unusedItems.length,
        totalDeals: deals.length,
        totalBundleProfit,
        avgSavings,
        sourcesAnalyzed: sources.length,
      },
      unbundledItems: unusedItems.map(i => ({ id: i.id, title: i.title, source: i.source, estValue: i.estValue })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
