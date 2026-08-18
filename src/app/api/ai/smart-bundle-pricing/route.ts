// v6.43 / v8.94-refactor: AI Smart Bundle Pricing — optimalno določi cene bundlov za max dobiček in hitro prodajo
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/smart-bundle-pricing
// Body: { tradeIds?: string[] }
// Returns: { ok, bundles, pricingRecommendations, summary, insights }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface SmartBundlePricingInput {
  tradeIds: string[];
}

export const POST = withAiRoute<SmartBundlePricingInput>({
  endpoint: '/api/ai/smart-bundle-pricing',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const tradeIds: string[] = Array.isArray(body?.tradeIds)
      ? body.tradeIds.filter(Boolean)
      : [];
    return { tradeIds };
  },

  // No validateInput — tradeIds je opcijski (prazno = vsi held itemi)
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeIds } = input;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held', ...(tradeIds.length > 0 ? { id: { in: tradeIds } } : {}) },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } },
      },
      take: 30,
    });

    if (heldTrades.length < 2) {
      return apiOk({ ok: true, bundles: [], message: 'Potrebna vsaj 2 itema.' });
    }

    const items: HeldItem[] = heldTrades.map(t => ({
      id: t.id,
      title: t.title,
      category: t.category || 'drugo',
      cost: t.buyPrice + (t.buyFees ?? 0),
      estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000)),
    }));

    const prompt = buildPrompt(items);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const bundles = transformBundles(parsed, items);
    const pricingRecommendations = transformPricingRecommendations(parsed);
    const summary = computeSummary(bundles, parsed);

    return apiOk({
      ok: true,
      insights: String(parsed?.insights ?? '').slice(0, 500),
      bundles,
      pricingRecommendations,
      summary,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface HeldItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
}

interface BundleItem {
  id: string;
  title: string;
  costEur: number;
  estValueEur: number;
}

interface PricingModel {
  model: string;
  bundlePriceEur: number;
  savingsPct: number;
  profitEur: number;
  marginPct: number;
  expectedSellDays: number;
  buyerPerception: string;
  recommended: boolean;
}

interface BundleResult {
  name: string;
  items: BundleItem[];
  totalCostEur: number;
  totalEstValueEur: number;
  pricingModels: PricingModel[];
  bestPriceEur: number;
  bestModel: string;
  expectedProfitEur: number;
  expectedSellDays: number;
  targetBuyer: string;
  reasoning: string;
}

interface PricingRecommendation {
  tip: string;
  impact: string;
  expectedRevenueIncreasePct: number;
}

const PRICING_MODELS = [
  'volume_discount', 'anchor_pricing', 'loss_leader', 'tiered_pricing',
  'psychological', 'dynamic', 'auction', 'flash_sale',
] as const;

const BUYER_PERCEPTIONS = ['great_deal', 'fair', 'premium'] as const;

const IMPACTS = ['high', 'medium', 'low'] as const;

/**
 * Build AI prompt za smart bundle pricing (besedilo IDENTIČNO originalu v6.43).
 */
function buildPrompt(items: HeldItem[]): string {
  const itemsStr = items.slice(0, 20)
    .map(i => `- [${i.id}] ${i.title} | ${i.category} | cost ${i.cost}€ | est ${i.estValue}€ | ${i.daysHeld}d`)
    .join('\n');

  return `Si AI smart bundle pricing strategist. Optimalno določi cene bundlov za max dobiček in hitro prodajo.

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
}

/**
 * Transform AI JSON v bundle rezultate. Clamp/slice logika IDENTIČNA originalu v6.43.
 * Vsak item id je lahko uporabljen samo v enem bundle-u (dedup preko usedIds).
 */
function transformBundles(parsed: any, items: HeldItem[]): BundleResult[] {
  const validIds = new Set(items.map(i => i.id));
  const usedIds = new Set<string>();

  return (parsed?.bundles || [])
    .map((b: any): BundleResult | null => {
      const itemIds: string[] = (Array.isArray(b?.item_ids) ? b.item_ids : [])
        .filter((id: any) => validIds.has(String(id)) && !usedIds.has(String(id)));
      if (itemIds.length < 2) return null;
      itemIds.forEach(id => usedIds.add(id));

      const bundleItems: BundleItem[] = itemIds.map(id => {
        const o = items.find(i => i.id === id)!;
        return { id: o.id, title: o.title, costEur: o.cost, estValueEur: o.estValue };
      });
      const totalCost = bundleItems.reduce((s, i) => s + i.costEur, 0);
      const totalEstValue = bundleItems.reduce((s, i) => s + i.estValueEur, 0);

      return {
        name: String(b?.name ?? 'Bundle').slice(0, 120),
        items: bundleItems,
        totalCostEur: totalCost,
        totalEstValueEur: totalEstValue,
        pricingModels: (b?.pricing_models || []).slice(0, 4).map((pm: any): PricingModel => ({
          model: (PRICING_MODELS as readonly string[]).includes(String(pm?.model))
            ? String(pm.model)
            : 'volume_discount',
          bundlePriceEur: Math.max(0, Number(pm?.bundle_price_eur ?? 0)),
          savingsPct: Math.round(Number(pm?.savings_pct ?? 0)),
          profitEur: Math.round(Number(pm?.profit_eur ?? 0)),
          marginPct: Math.round(Number(pm?.margin_pct ?? 0)),
          expectedSellDays: Math.max(1, Number(pm?.expected_sell_days ?? 14)),
          buyerPerception: (BUYER_PERCEPTIONS as readonly string[]).includes(String(pm?.buyer_perception))
            ? String(pm.buyer_perception)
            : 'fair',
          recommended: Boolean(pm?.recommended ?? false),
        })),
        bestPriceEur: Math.max(0, Number(b?.best_price_eur ?? 0)),
        bestModel: String(b?.best_model ?? '').slice(0, 30),
        expectedProfitEur: Math.round(Number(b?.expected_profit_eur ?? 0)),
        expectedSellDays: Math.max(1, Number(b?.expected_sell_days ?? 14)),
        targetBuyer: String(b?.target_buyer ?? '').slice(0, 100),
        reasoning: String(b?.reasoning ?? '').slice(0, 200),
      };
    })
    .filter((b: BundleResult | null): b is BundleResult => b !== null);
}

/**
 * Transform pricing_recommendations. Clamp/slice IDENTIČEN originalu v6.43.
 */
function transformPricingRecommendations(parsed: any): PricingRecommendation[] {
  return (parsed?.pricing_recommendations || []).slice(0, 5).map((r: any): PricingRecommendation => ({
    tip: String(r?.tip ?? '').slice(0, 200),
    impact: (IMPACTS as readonly string[]).includes(String(r?.impact))
      ? String(r.impact)
      : 'medium',
    expectedRevenueIncreasePct: Math.round(Number(r?.expected_revenue_increase_pct ?? 0)),
  }));
}

/**
 * Izračunaj povzetek (totalBundleProfit, avgMargin, avgSavings).
 * Logika IDENTIČNA originalu v6.43 — upošteva priporočeni pricing model (če obstaja).
 */
function computeSummary(bundles: BundleResult[], parsed: any) {
  const totalBundleProfit = bundles.reduce((s, b) => s + (b?.expectedProfitEur ?? 0), 0);
  const avgMargin = bundles.length > 0
    ? Math.round(
      bundles.reduce((s, b) => s + (b?.pricingModels?.find(pm => pm.recommended)?.marginPct ?? 20), 0)
      / bundles.length
    )
    : 0;
  const avgSavings = bundles.length > 0
    ? Math.round(
      bundles.reduce((s, b) => s + (b?.pricingModels?.find(pm => pm.recommended)?.savingsPct ?? 10), 0)
      / bundles.length
    )
    : 0;

  return {
    totalBundles: bundles.length,
    totalBundleProfitEur: totalBundleProfit,
    avgMarginPct: avgMargin,
    avgSavingsPct: avgSavings,
    bestPricingModel: String(parsed?.summary?.best_pricing_model ?? '').slice(0, 30),
    expectedSellTimeReductionPct: Math.round(Number(parsed?.summary?.expected_sell_time_reduction_pct ?? 0)),
  };
}
