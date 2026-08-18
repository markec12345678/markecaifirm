// v7.39 / v8.94-refactor: Bundle Opportunity Detector — najde priložnosti za paketno prodajo.
//
// "Imaš 3 iPhone-13 v inventarju. Če jih prodaš skupaj kot bundle,
// lahko zaračunaš +15% (kupci radi kupijo vse naenkrat)."
//
// GET /api/ai/bundle-opportunity-detector
// Skenira held inventory, najde similar items, AI oceni bundle potential.
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface BundleOpportunityInput {}

export const GET = withAiRoute<BundleOpportunityInput>({
  endpoint: '/api/ai/bundle-opportunity-detector',
  maxDuration: 90,
  enforceBudget: true, // AI klici (do 5 na zahtevo) — preveri budget
  method: 'GET',

  parseBody: async () => {
    // GET nima telesa
    return {};
  },

  // Brez validateInput — GET brez input polj

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true, imageUrl: true },
      take: 100,
    });

    if (heldTrades.length < 2) {
      return apiOk({ ok: true, bundles: [], message: 'Potrebnih vsaj 2 held item-a za bundle analizo.' });
    }

    // Group by category — find categories with 2+ items (potential bundles)
    const potentialBundles = groupByCategory(heldTrades);

    if (potentialBundles.length === 0) {
      return apiOk({ ok: true, bundles: [], message: 'Ni dovolj podobnih item-ov za bundle.' });
    }

    // AI analysis for each potential bundle (top 5)
    const bundles: BundleResult[] = [];

    for (const pb of potentialBundles.slice(0, 5)) {
      const items = pb.items.slice(0, 5);
      const totalBuyPrice = items.reduce((s, t) => s + t.buyPrice, 0);
      const individualSellPrice = Math.round(totalBuyPrice * 1.2); // 20% markup estimate
      const bundlePrice = Math.round(individualSellPrice * 1.15); // +15% for bundle

      const prompt = buildBundlePrompt(items, pb.category, totalBuyPrice, individualSellPrice, bundlePrice);

      try {
        const raw = await callAi(prompt);
        const parsed: any = parseAi(raw);
        const bundle = transformBundle(parsed, pb.category, items, totalBuyPrice, individualSellPrice, bundlePrice);
        if (bundle) bundles.push(bundle);
      } catch {
        // AI failed for this bundle — skip
      }
    }

    // Sort by extra profit (descending)
    bundles.sort((a, b) => b.extraProfit - a.extraProfit);

    return apiOk({
      ok: true,
      totalHeld: heldTrades.length,
      potentialBundles: potentialBundles.length,
      viableBundles: bundles.length,
      bundles,
      totalExtraProfit: bundles.reduce((s, b) => s + b.extraProfit, 0),
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface HeldTrade {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyDate: Date;
  imageUrl: string | null;
}

interface BundleResult {
  category: string;
  items: Array<{ id: string; title: string; buyPrice: number }>;
  itemCount: number;
  totalBuyPrice: number;
  individualSellPrice: number;
  bundlePrice: number;
  extraProfit: number;
  sellProbability14d: number;
  bundleTitle: string;
  bundleDescription: string;
  reasoning: string;
}

/**
 * Group held trades by category (lowercased; fallback "drugo") and return
 * only categories with 2+ items (potential bundles).
 */
function groupByCategory(heldTrades: HeldTrade[]): Array<{ category: string; items: HeldTrade[] }> {
  const byCategory = new Map<string, HeldTrade[]>();
  for (const t of heldTrades) {
    const cat = (t.category || 'drugo').toLowerCase();
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(t);
  }
  return Array.from(byCategory.entries())
    .filter(([, items]) => items.length >= 2)
    .map(([category, items]) => ({ category, items }));
}

/**
 * Build AI prompt za oceno bundle potential-a (besedilo IDENTIČNO originalu v7.39).
 */
function buildBundlePrompt(
  items: HeldTrade[],
  category: string,
  totalBuyPrice: number,
  individualSellPrice: number,
  bundlePrice: number
): string {
  return `Si ekspert za bundle prodajo na slovenskih oglasnih platformah.

Imaš ${items.length} item-e v kategoriji "${category}":
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
}

/**
 * Transform AI JSON v bundle result. Vrne null če AI ni označil bundle-a kot viable.
 * Clamp/slice logika IDENTIČNA originalu v7.39.
 */
function transformBundle(
  parsed: any,
  category: string,
  items: HeldTrade[],
  totalBuyPrice: number,
  individualSellPrice: number,
  bundlePrice: number
): BundleResult | null {
  if (!parsed?.is_viable_bundle) return null;

  return {
    category,
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
  };
}
