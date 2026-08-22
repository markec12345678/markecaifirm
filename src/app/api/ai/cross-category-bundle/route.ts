// v6.33 / v8.95.5-deal: AI Cross-Category Bundle Optimizer — kombinira iteme iz RAZLIČNIH kategorij
// Refaktoriran z withAiRoute helperjem (v8.95.5-deal) + enforceBudget guard.
//
// POST /api/ai/cross-category-bundle
// Body: {}
// Returns: { ok, bundles: [], insights, summary }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface CrossCategoryBundleInput {}

export const POST = withAiRoute<CrossCategoryBundleInput>({
  endpoint: '/api/ai/cross-category-bundle',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {} as CrossCategoryBundleInput;
  },

  // No validateInput — brez polj
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 40,
    });

    if (heldTrades.length < 2) {
      return apiOk({ ok: true, bundles: [], message: 'Potrebna vsaj 2 itema za cross-category bundle.' });
    }

    const items = mapItems(heldTrades);

    // Group by category
    const byCat: Record<string, Item[]> = {};
    for (const i of items) {
      if (!byCat[i.category]) byCat[i.category] = [];
      byCat[i.category].push(i);
    }
    const categories = Object.keys(byCat);

    const prompt = buildPrompt(items, categories);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const { bundles, usedIds } = transformBundles(parsed, items);

    const totalBundleProfit = bundles.reduce((s: number, b: any) => s + (b?.expectedProfit ?? 0), 0);
    const avgSavings = bundles.length > 0 ? Math.round(bundles.reduce((s: number, b: any) => s + b.savingsPct, 0) / bundles.length) : 0;

    return apiOk({
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
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface HeldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: { aiEstimatedValue: number | null; dealScore: number | null } | null;
}

interface Item {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
}

const CONCEPTS = ['lifestyle_bundle', 'seasonal_bundle', 'upgrade_bundle', 'gift_bundle', 'starter_kit', 'complementary_bundle'] as const;
const PLATFORMS = ['bolha', 'facebook', 'vinted'] as const;

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

/**
 * Map heldTrades v items array. Logika IDENTIČNA originalu v6.33.
 */
function mapItems(heldTrades: HeldTradeRow[]): Item[] {
  return heldTrades.map(t => ({
    id: t.id, title: t.title, category: t.category || 'drugo',
    cost: t.buyPrice + (t.buyFees ?? 0),
    estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
    daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000)),
  }));
}

/**
 * Build AI prompt za cross-category bundle (besedilo IDENTIČNO originalu v6.33).
 */
function buildPrompt(items: Item[], categories: string[]): string {
  const itemsStr = items.slice(0, 25).map(i => `- [${i.id}] ${i.title} | ${i.category} | nabavna: ${i.cost}€ | est: ${i.estValue}€ | ${i.daysHeld}d`).join('\n');

  return `Si ekspert za cross-category bundle strategije.
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
}

/**
 * Transform AI JSON v bundles array z dedup (usedIds Set) + compute.
 * Clamp/slice/whitelist logika IDENTIČNA originalu v6.33.
 * Vrne tudi usedIds Set (za summary.bundledItems in unbundledItems v handlerju).
 */
function transformBundles(parsed: any, items: Item[]): { bundles: any[]; usedIds: Set<string> } {
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
      concept: includes(CONCEPTS, String(b?.concept)) ? String(b.concept) : 'complementary_bundle',
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
      platform: includes(PLATFORMS, String(b?.platform)) ? String(b.platform) : 'bolha',
      reasoning: String(b?.reasoning ?? '').slice(0, 250),
    };
  }).filter(Boolean);

  return { bundles, usedIds };
}
