// v6.10: AI Bundle Profit Optimizer — AI kombinira inventar v bundle za maksimalni profit
// POST /api/ai/bundle-optimizer
// Body: { tradeIds?: string[] } // če ni podan, uporabi vse held tradeove
// Returns: { ok, bundles: Array<{ name, items: [{id,title}], individualValue, bundlePrice, savings, expectedProfit, reasoning }>, strategy }

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

    // 1. Pridobi held tradeove (vse ali samo izbrane)
    const heldTrades = await db.trade.findMany({
      where: {
        status: 'held',
        ...(requestedIds.length > 0 ? { id: { in: requestedIds } } : {}),
      },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true,
        buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true, aiVerdict: true, url: true } },
      },
      take: 50, // omejitev za AI kontekst
    });

    if (heldTrades.length < 2) {
      return NextResponse.json({
        ok: true,
        bundles: [],
        message: 'Za bundle optimizacijo so potrebni vsaj 2 itema v skladišču.',
      });
    }

    // 2. Pripravi podatke za AI
    const items = heldTrades.map((t) => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      return {
        id: t.id,
        title: t.title,
        category: t.category || 'drugo',
        cost: Math.round(cost),
        estimatedValue: Math.round(estValue),
        daysHeld,
        dealScore: t.listing?.dealScore ?? 0,
      };
    });

    const totalCost = items.reduce((s, i) => s + i.cost, 0);
    const totalEstValue = items.reduce((s, i) => s + i.estimatedValue, 0);
    const avgDays = Math.round(items.reduce((s, i) => s + i.daysHeld, 0) / items.length);

    // 3. AI optimizacija bundlov
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za bundle strategije pri preprodaji.
Tvoj cilj: kombiniraj iteme v bundle, ki prinesejo VEČ dobička kot posamezna prodaja.

Itemi v skladišču:
${items.map(i => `- [${i.id}] ${i.title} | kategorija: ${i.category} | nabavna: ${i.cost}€ | est. vrednost: ${i.estimatedValue}€ | v skladišču: ${i.daysHeld}d | deal score: ${i.dealScore}`).join('\n')}

Skupaj: ${items.length} itemov, ${totalCost}€ nabavne vrednosti, ${totalEstValue}€ est. vrednosti, povp. ${avgDays}d v skladišču.

Pravila za bundle:
1. Kombiniraj komplementarne iteme (npr. telefon + polnilnik + slušalke; kolo + čelada + luči)
2. Bundle cena naj bo 5-15% NIŽJA od vsote posameznih cen (incentiv za kupec)
3. Skupni dobiček bundle mora biti ≥ vsote posameznih dobičkov
4. Prioritiziraj iteme, ki so dalj časa v skladišču (>30 dni)
5. Kategorije naj se dopolnjuje (ne mešaj nepremičnin z elektroniko)
6. Vsak item je lahko samo v enem bundleu
7. Itemi, ki jih ne daš v bundle, ostanejo za individualno prodajo

Strategije:
- "complete_set": kompletiraj komplet (npr. gaming setup)
- "upgrade_path": cenejši + dražji (kupec lahko upgrade-a)
- "bulk_discount": več istih itemov z discountom
- "starter_pack": začetniški paket za novince
- "premium_bundle": luxury itemi skupaj

Odgovori LE z JSON:
{
  "strategy": "<splošna strategija, max 200 znakov>",
  "bundles": [
    {
      "name": "<ime bundla, npr. 'Gaming setup bundle'>",
      "strategy": "<complete_set|upgrade_path|bulk_discount|starter_pack|premium_bundle>",
      "item_ids": ["<trade_id>", "<trade_id>"],
      "individual_total": <number>,
      "bundle_price": <number>,
      "savings_pct": <number>,
      "expected_profit": <number>,
      "expected_sell_time_days": <number>,
      "reasoning": "<zakaj ta bundle, max 150 znakov>"
    }
  ],
  "individual_sale": ["<trade_id>", ...]
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

    // Validiraj bundle-je (item_ids morajo obstajati v skladišču)
    const validIds = new Set(items.map(i => i.id));
    const usedIds = new Set<string>();
    const bundles = (parsed?.bundles || [])
      .map((b: any) => {
        const itemIds: string[] = Array.isArray(b?.item_ids) ? b.item_ids.filter((id: any) => typeof id === 'string') : [];
        // preveri, da so IDji veljavni in še niso uporabljeni
        const validItemIds = itemIds.filter((id: string) => validIds.has(id) && !usedIds.has(id));
        if (validItemIds.length < 2) return null; // bundle mora imeti vsaj 2 itema
        validItemIds.forEach(id => usedIds.add(id));

        const bundleItems = validItemIds.map(id => {
          const item = items.find(i => i.id === id)!;
          return { id: item.id, title: item.title, cost: item.cost, estimatedValue: item.estimatedValue };
        });
        const individualTotal = bundleItems.reduce((s, i) => s + i.estimatedValue, 0);
        const bundlePrice = Number(b?.bundle_price ?? Math.round(individualTotal * 0.9));
        const bundleCost = bundleItems.reduce((s, i) => s + i.cost, 0);
        const expectedProfit = Math.round(bundlePrice - bundleCost);
        const savingsPct = individualTotal > 0 ? Math.round(((individualTotal - bundlePrice) / individualTotal) * 100) : 0;

        return {
          name: String(b?.name ?? 'Bundle').slice(0, 100),
          strategy: String(b?.strategy ?? 'complete_set').slice(0, 30),
          items: bundleItems,
          individualTotal,
          bundlePrice,
          bundleCost,
          savingsPct: Math.max(0, Math.min(50, savingsPct)),
          expectedProfit,
          expectedSellTimeDays: Math.max(1, Math.min(365, Number(b?.expected_sell_time_days ?? 14))),
          reasoning: String(b?.reasoning ?? '').slice(0, 300),
        };
      })
      .filter(Boolean);

    const individualSale = items.filter(i => !usedIds.has(i.id)).map(i => ({
      id: i.id,
      title: i.title,
      estimatedValue: i.estimatedValue,
      cost: i.cost,
      expectedProfit: i.estimatedValue - i.cost,
    }));

    const totalBundleProfit = bundles.reduce((s: number, b: any) => s + (b?.expectedProfit ?? 0), 0);
    const totalIndividualProfit = individualSale.reduce((s, i) => s + i.expectedProfit, 0);

    // Increment AI usage
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      strategy: String(parsed?.strategy ?? '').slice(0, 500),
      bundles,
      individualSale,
      summary: {
        totalItems: items.length,
        bundleItems: usedIds.size,
        individualItems: individualSale.length,
        totalBundleProfit,
        totalIndividualProfit,
        totalProjectedProfit: totalBundleProfit + totalIndividualProfit,
        avgBundleSavings: bundles.length > 0
          ? Math.round(bundles.reduce((s: number, b: any) => s + b.savingsPct, 0) / bundles.length)
          : 0,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
