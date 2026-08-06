// v7.39: Bundle Opportunity Detector — najde priložnosti za paketno prodajo.
//
// "Imaš 3 iPhone-13 v inventarju. Če jih prodaš skupaj kot bundle,
// lahko zaračunaš +15% (kupci radi kupijo vse naenkrat)."
//
// GET /api/ai/bundle-opportunity-detector
// Skenira held inventory, najde similar items, AI oceni bundle potential.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function GET(req: NextRequest) {
  try {
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true, imageUrl: true },
      take: 100,
    });

    if (heldTrades.length < 2) {
      return NextResponse.json({ ok: true, bundles: [], message: 'Potrebnih vsaj 2 held item-a za bundle analizo.' });
    }

    // Group by category
    const byCategory = new Map<string, typeof heldTrades>();
    for (const t of heldTrades) {
      const cat = (t.category || 'drugo').toLowerCase();
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(t);
    }

    // Find categories with 2+ items (potential bundles)
    const potentialBundles = Array.from(byCategory.entries())
      .filter(([_, items]) => items.length >= 2)
      .map(([category, items]) => ({ category, items }));

    if (potentialBundles.length === 0) {
      return NextResponse.json({ ok: true, bundles: [], message: 'Ni dovolj podobnih item-ov za bundle.' });
    }

    // AI analysis for each potential bundle
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const bundles: any[] = [];

    for (const pb of potentialBundles.slice(0, 5)) {
      const items = pb.items.slice(0, 5);
      const totalBuyPrice = items.reduce((s, t) => s + t.buyPrice, 0);
      const individualSellPrice = Math.round(totalBuyPrice * 1.2); // 20% markup estimate
      const bundlePrice = Math.round(individualSellPrice * 1.15); // +15% for bundle

      const prompt = `Si ekspert za bundle prodajo na slovenskih oglasnih platformah.

Imaš ${items.length} item-e v kategoriji "${pb.category}":
${items.map((t, i) => `${i + 1}. ${t.title} (nabava ${t.buyPrice}€)`).join('\n')}

Skupna nabavna cena: ${totalBuyPrice}€
Ocenjena posamezna prodaja: ${individualSellPrice}€ (20% markup)
Predlagana bundle cena: ${bundlePrice}€ (+15% nad posamezno)

Oceni:
1. Ali imajo smisel kot bundle? (ali so si dovolj podobni?)
2. Kakšna je verjetnost da bo bundle prodan v 14 dneh?
3. Kakšen naj bo bundle naslov?
4. Kratek opis za bundle oglas

Odgovori LE z JSON:
{
  "is_viable_bundle": <boolean>,
  "bundle_title": "<max 80 znakov>",
  "bundle_description": "<100-200 besed>",
  "bundle_price_eur": <number>,
  "individual_sell_price_eur": <number>,
  "extra_profit_eur": <number>,
  "sell_probability_14d_pct": <number>,
  "reasoning": "<1-2 stavka>"
}`;

      try {
        const raw = await callProviderForRaw(aiSettings, prompt);
        const parsed: any = parseJsonLooseExported(raw);

        if (parsed?.is_viable_bundle) {
          bundles.push({
            category: pb.category,
            items: items.map(t => ({ id: t.id, title: t.title, buyPrice: t.buyPrice })),
            itemCount: items.length,
            totalBuyPrice,
            individualSellPrice: Math.round(Number(parsed?.individual_sell_price_eur ?? individualSellPrice)),
            bundlePrice: Math.round(Number(parsed?.bundle_price_eur ?? bundlePrice)),
            extraProfit: Math.round(Number(parsed?.extra_profit_eur ?? (bundlePrice - individualSellPrice))),
            sellProbability14d: Math.max(0, Math.min(100, Number(parsed?.sell_probability_14d_pct ?? 50))),
            bundleTitle: String(parsed?.bundle_title ?? '').slice(0, 80),
            bundleDescription: String(parsed?.bundle_description ?? '').slice(0, 500),
            reasoning: String(parsed?.reasoning ?? '').slice(0, 300),
          });
        }
      } catch {
        // AI failed for this bundle — skip
      }
    }

    // Sort by extra profit
    bundles.sort((a, b) => b.extraProfit - a.extraProfit);

    return NextResponse.json({
      ok: true,
      totalHeld: heldTrades.length,
      potentialBundles: potentialBundles.length,
      viableBundles: bundles.length,
      bundles,
      totalExtraProfit: bundles.reduce((s, b) => s + b.extraProfit, 0),
    });
  } catch (err: any) {
    logger.error('/api/ai/bundle-opportunity-detector', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
