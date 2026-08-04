// v6.43: AI Smart Bundle Pricing — optimalno določi cene bundlov za max dobiček in hitro prodajo
// POST /api/ai/smart-bundle-pricing
// Body: { tradeIds?: string[] }
// Returns: { ok, bundles: [], pricingModels, recommendations, summary }

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
    const requestedIds: string[] = Array.isArray(body?.tradeIds) ? body.tradeIds.filter(Boolean) : [];

    const heldTrades = await db.trade.findMany({
      where: { status: 'held', ...(requestedIds.length > 0 ? { id: { in: requestedIds } } : {}) },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 30,
    });

    if (heldTrades.length < 2) { return NextResponse.json({ ok: true, bundles: [], message: 'Potrebna vsaj 2 itema.' }); }

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
      cost: t.buyPrice + (t.buyFees ?? 0), estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)),
    }));

    const itemsStr = items.slice(0, 20).map(i => `- [${i.id}] ${i.title} | ${i.category} | cost ${i.cost}€ | est ${i.estValue}€ | ${i.daysHeld}d`).join('\n');

    const prompt = `Si AI smart bundle pricing strategist. Optimalno določi cene bundlov za max dobiček in hitro prodajo.

INVENTAR (${items.length}):
${itemsStr}

Bundle pricing modeli:
1. VOLUME_DISCOUNT: 5-15% popust na vsoto (klasično)
2. ANCHOR_PRICING: dragi item kot "sidro" + cenejši kot "bonus"
3. LOSS_LEADER: en item blizu nabavne, drugi z visoko maržo
4. TIERED_PRICING: bronze/silver/gold paketi z različnimi kombinacijami
5. PSYCHOLOGICAL_PRICING: 99€, 199€, 299€ (pragovi)
6. DYNAMIC_PRICING: cena se prilagaja glede na demand
7. AUCTION_BUNDLE: začetna cena nižja,竞价 dvigne
8. FLASH_SALE: 24-48h akcijska cena (urgentnost)

Pricing faktorji:
- Total cost (nabavna vrednost vseh itemov)
- Total est. value (vsota est. vrednosti)
- Savings % (koliko kupec prihrani)
- Profit margin (mora biti > 15%)
- Days held (stalled itemi → večji popust)
- Category complementarity (komplementarni → manjši popust)
- Market demand (visoko → manjši popust)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "bundles": [
    {
      "name": "<ime, max 80 znakov>",
      "item_ids": ["<id>", "<id>"],
      "items": [{"id": "<id>", "title": "<naslov>", "cost_eur": <number>, "est_value_eur": <number>}],
      "total_cost_eur": <number>,
      "total_est_value_eur": <number>,
      "pricing_models": [
        {
          "model": "<volume_discount|anchor_pricing|loss_leader|tiered_pricing|psychological|dynamic|auction|flash_sale>",
          "bundle_price_eur": <number>,
          "savings_pct": <number>,
          "profit_eur": <number>,
          "margin_pct": <number>,
          "expected_sell_days": <number>,
          "buyer_perception": "<great_deal|fair|premium>",
          "recommended": <boolean>
        }
      ],
      "best_price_eur": <number>,
      "best_model": "<ime modela>",
      "expected_profit_eur": <number>,
      "expected_sell_days": <number>,
      "target_buyer": "<max 60 znakov>",
      "reasoning": "<max 100 znakov>"
    }
  ],
  "pricing_recommendations": [
    { "tip": "<max 100 znakov>", "impact": "<high|medium|low>", "expected_revenue_increase_pct": <number> }
  ],
  "summary": {
    "total_bundles": <number>,
    "total_bundle_profit_eur": <number>,
    "avg_margin_pct": <number>,
    "avg_savings_pct": <number>,
    "best_pricing_model": "<ime>",
    "expected_sell_time_reduction_pct": <number>
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
    const usedIds = new Set<string>();

    const bundles = (parsed?.bundles || []).map((b: any) => {
      const itemIds: string[] = (Array.isArray(b?.item_ids) ? b.item_ids : []).filter((id: any) => validIds.has(String(id)) && !usedIds.has(String(id)));
      if (itemIds.length < 2) return null;
      itemIds.forEach(id => usedIds.add(id));
      const bundleItems = itemIds.map(id => { const o = items.find(i => i.id === id)!; return { id: o.id, title: o.title, costEur: o.cost, estValueEur: o.estValue }; });
      const totalCost = bundleItems.reduce((s, i) => s + i.costEur, 0);
      const totalEstValue = bundleItems.reduce((s, i) => s + i.estValueEur, 0);
      return {
        name: String(b?.name ?? 'Bundle').slice(0, 120),
        items: bundleItems,
        totalCostEur: totalCost,
        totalEstValueEur: totalEstValue,
        pricingModels: (b?.pricing_models || []).slice(0, 4).map((pm: any) => ({
          model: ['volume_discount', 'anchor_pricing', 'loss_leader', 'tiered_pricing', 'psychological', 'dynamic', 'auction', 'flash_sale'].includes(String(pm?.model)) ? String(pm.model) : 'volume_discount',
          bundlePriceEur: Math.max(0, Number(pm?.bundle_price_eur ?? 0)),
          savingsPct: Math.round(Number(pm?.savings_pct ?? 0)),
          profitEur: Math.round(Number(pm?.profit_eur ?? 0)),
          marginPct: Math.round(Number(pm?.margin_pct ?? 0)),
          expectedSellDays: Math.max(1, Number(pm?.expected_sell_days ?? 14)),
          buyerPerception: ['great_deal', 'fair', 'premium'].includes(String(pm?.buyer_perception)) ? String(pm.buyer_perception) : 'fair',
          recommended: Boolean(pm?.recommended ?? false),
        })),
        bestPriceEur: Math.max(0, Number(b?.best_price_eur ?? 0)),
        bestModel: String(b?.best_model ?? '').slice(0, 30),
        expectedProfitEur: Math.round(Number(b?.expected_profit_eur ?? 0)),
        expectedSellDays: Math.max(1, Number(b?.expected_sell_days ?? 14)),
        targetBuyer: String(b?.target_buyer ?? '').slice(0, 100),
        reasoning: String(b?.reasoning ?? '').slice(0, 200),
      };
    }).filter(Boolean);

    const totalBundleProfit = bundles.reduce((s: number, b: any) => s + (b?.expectedProfitEur ?? 0), 0);
    const avgMargin = bundles.length > 0 ? Math.round(bundles.reduce((s: number, b: any) => s + (b?.pricingModels?.find((pm: any) => pm.recommended)?.marginPct ?? 20), 0) / bundles.length) : 0;
    const avgSavings = bundles.length > 0 ? Math.round(bundles.reduce((s: number, b: any) => s + (b?.pricingModels?.find((pm: any) => pm.recommended)?.savingsPct ?? 10), 0) / bundles.length) : 0;

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({
      ok: true,
      insights: String(parsed?.insights ?? '').slice(0, 500),
      bundles,
      pricingRecommendations: (parsed?.pricing_recommendations || []).slice(0, 5).map((r: any) => ({
        tip: String(r?.tip ?? '').slice(0, 200), impact: ['high', 'medium', 'low'].includes(String(r?.impact)) ? String(r.impact) : 'medium',
        expectedRevenueIncreasePct: Math.round(Number(r?.expected_revenue_increase_pct ?? 0)),
      })),
      summary: {
        totalBundles: bundles.length,
        totalBundleProfitEur: totalBundleProfit,
        avgMarginPct: avgMargin,
        avgSavingsPct: avgSavings,
        bestPricingModel: String(parsed?.summary?.best_pricing_model ?? '').slice(0, 30),
        expectedSellTimeReductionPct: Math.round(Number(parsed?.summary?.expected_sell_time_reduction_pct ?? 0)),
      },
    });
  } catch (e: any) { logger.error("/api/ai/smart-bundle-pricing", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
