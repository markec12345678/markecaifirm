// v7.59: Bundle Profit Optimizer — AI analiza kateri held inventar
// združiti v pakete za cross-sell. Paketiranje komplementarnih item-ov
// (PS5 + controller + igra) lahko da višji skupni profit kot prodaja posebej.
//
// "PS5 (380€) + Extra Controller (45€) + FIFA 24 (35€) → bundle 420€
//  (save 10%), profit 110€ vs 80€ standalone"
//
// GET+POST /api/ai/bundle-profit-optimizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import {
  callProviderForRaw,
  parseJsonLooseExported,
  type AiProviderType,
  type AiSettings,
} from '@/lib/ai';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Categories that complement each other (cross-sell compatibility)
const COMPLEMENTARY: Record<string, string[]> = {
  'elektronika': ['igre', 'aksesoiri', 'pohistvo'],
  'igre': ['elektronika', 'aksesoiri'],
  'aksesoiri': ['elektronika', 'igre', 'moda'],
  'moda': ['aksesoiri', 'obutev'],
  'obutev': ['moda', 'aksesoiri'],
  'pohistvo': ['elektronika', 'dom'],
  'dom': ['pohistvo', 'kuhinja'],
  'kuhinja': ['dom', 'pohistvo'],
  'avto': ['gume', 'aksesoiri'],
  'gume': ['avto'],
  'orodje': ['gradnja', 'elektronika'],
  'gradnja': ['orodje', 'dom'],
  'sport': ['moda', 'aksesoiri'],
  'kolesa': ['aksesoiri', 'sport'],
};

interface HeldItem {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  estimatedValue: number;
  potentialProfit: number;
  bundleCompatibility: string[];
}

interface BundleItem {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  estimatedValue: number;
}

interface BundleSuggestion {
  bundleId: string;
  items: BundleItem[];
  suggestedBundlePrice: number;
  combinedBuyPrice: number;
  expectedProfit: number;
  bundleDiscountPercent: number;
  expectedSellTimeDays: number;
  profitVsStandalone: number;
  reasoning: string;
}

interface AiBundleEntry {
  itemIds?: unknown;
  suggestedBundlePrice?: unknown;
  bundleDiscountPercent?: unknown;
  expectedSellTimeDays?: unknown;
  reasoning?: unknown;
}

interface AiBundleResponse {
  bundles?: AiBundleEntry[];
}

// Compute bundle compatibility: which categories complement this one
function getCompatibleCategories(cat: string): string[] {
  const lower = cat.toLowerCase().trim();
  return COMPLEMENTARY[lower] || [];
}

// Validate and clamp AI-provided bundle suggestion
function clampBundleSuggestion(
  raw: AiBundleEntry,
  itemsById: Map<string, HeldItem>,
  usedTradeIds: Set<string>,
): BundleSuggestion | null {
  // itemIds must be array of 2-4 valid trade IDs
  const rawIds = raw.itemIds;
  if (!Array.isArray(rawIds)) return null;
  if (rawIds.length < 2 || rawIds.length > 4) return null;

  const bundleItems: BundleItem[] = [];
  for (const rawId of rawIds) {
    const id = String(rawId);
    // Skip if already used in another bundle (an item can only be in 1 bundle)
    if (usedTradeIds.has(id)) return null;
    const item = itemsById.get(id);
    if (!item) return null; // invalid trade ID
    bundleItems.push({
      tradeId: item.tradeId,
      title: item.title,
      category: item.category,
      buyPrice: item.buyPrice,
      estimatedValue: item.estimatedValue,
    });
  }

  const sumEstValues = bundleItems.reduce((s, i) => s + i.estimatedValue, 0);
  const combinedBuyPrice = bundleItems.reduce((s, i) => s + i.buyPrice, 0);

  // Anti-hallucination: bundle price clamped to [0.8×, 1.1×] sum of estValues
  // (bundles usually get a 5-15% discount, so 0.8-1.1 is realistic)
  const minPrice = Math.round(sumEstValues * 0.8);
  const maxPrice = Math.round(sumEstValues * 1.1);
  let suggestedBundlePrice = Number(raw.suggestedBundlePrice);
  if (!Number.isFinite(suggestedBundlePrice)) {
    // Fallback: 0.92× sumEstValues (8% discount)
    suggestedBundlePrice = Math.round(sumEstValues * 0.92);
  }
  suggestedBundlePrice = Math.max(
    minPrice,
    Math.min(maxPrice, Math.round(suggestedBundlePrice)),
  );
  // Floor: must cover buy price (don't sell at a loss)
  if (suggestedBundlePrice < combinedBuyPrice) {
    suggestedBundlePrice = combinedBuyPrice;
  }

  // bundleDiscountPercent: how much cheaper than buying separately
  const bundleDiscountPercent =
    sumEstValues > 0
      ? Math.round(((sumEstValues - suggestedBundlePrice) / sumEstValues) * 100)
      : 0;

  // expectedSellTimeDays: clamp to [1, 60]
  let expectedSellTimeDays = Number(raw.expectedSellTimeDays);
  if (!Number.isFinite(expectedSellTimeDays)) {
    // Fallback: 14 days (typical bundle sell time)
    expectedSellTimeDays = 14;
  }
  expectedSellTimeDays = Math.max(1, Math.min(60, Math.round(expectedSellTimeDays)));

  const expectedProfit = suggestedBundlePrice - combinedBuyPrice;
  const standaloneProfit = sumEstValues - combinedBuyPrice;
  const profitVsStandalone = Math.round(expectedProfit - standaloneProfit);

  // Reasoning: clamp to 300 chars if string, else fallback
  let reasoning: string;
  if (typeof raw.reasoning === 'string' && raw.reasoning.trim().length > 0) {
    reasoning = raw.reasoning.trim().slice(0, 300);
  } else {
    reasoning = `Paket ${bundleItems.length} item-ov: ${bundleItems
      .map(i => i.title.slice(0, 25))
      .join(' + ')}. Skupna vrednost ${sumEstValues}€, cena paketa ${suggestedBundlePrice}€ (${bundleDiscountPercent}% popust).`;
  }

  // Mark items as used
  for (const i of bundleItems) usedTradeIds.add(i.tradeId);

  return {
    bundleId: `bundle-${bundleItems[0].tradeId.slice(-6)}-${bundleItems.length}`,
    items: bundleItems,
    suggestedBundlePrice,
    combinedBuyPrice,
    expectedProfit,
    bundleDiscountPercent,
    expectedSellTimeDays,
    profitVsStandalone,
    reasoning,
  };
}

// Deterministic fallback: group items by category, bundle 2-4 same-category items
// whose combined value > 100€
function deterministicBundles(items: HeldItem[]): BundleSuggestion[] {
  const usedTradeIds = new Set<string>();
  const bundles: BundleSuggestion[] = [];

  // Group by category
  const byCat = new Map<string, HeldItem[]>();
  for (const i of items) {
    const cat = i.category;
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(i);
  }

  for (const [, catItems] of byCat.entries()) {
    // Sort by estValue desc — bundle highest-value items first
    catItems.sort((a, b) => b.estimatedValue - a.estimatedValue);
    // Greedy: take 2-3 consecutive items, build bundle if combined value > 100€
    let i = 0;
    while (i < catItems.length - 1) {
      const candidates: HeldItem[] = [];
      for (let k = i; k < Math.min(i + 4, catItems.length); k++) {
        if (usedTradeIds.has(catItems[k].tradeId)) continue;
        candidates.push(catItems[k]);
        if (candidates.length >= 2) {
          // Check combined value
          const combined = candidates.reduce((s, x) => s + x.estimatedValue, 0);
          if (combined >= 100) break;
        }
      }
      if (candidates.length >= 2) {
        const sumEst = candidates.reduce((s, x) => s + x.estimatedValue, 0);
        const combinedBuy = candidates.reduce((s, x) => s + x.buyPrice, 0);
        const suggestedPrice = Math.round(sumEst * 0.92); // 8% discount
        const profit = suggestedPrice - combinedBuy;
        // Only create bundle if it's profitable
        if (profit > 0) {
          const bundleItems: BundleItem[] = candidates.map(c => ({
            tradeId: c.tradeId,
            title: c.title,
            category: c.category,
            buyPrice: c.buyPrice,
            estimatedValue: c.estimatedValue,
          }));
          bundles.push({
            bundleId: `bundle-${candidates[0].tradeId.slice(-6)}-${candidates.length}`,
            items: bundleItems,
            suggestedBundlePrice: suggestedPrice,
            combinedBuyPrice: combinedBuy,
            expectedProfit: profit,
            bundleDiscountPercent: 8,
            expectedSellTimeDays: 14,
            profitVsStandalone: profit - (sumEst - combinedBuy),
            reasoning: `Paket ${candidates.length} ${candidates[0].category} item-ov z 8% popustom — hitra prodaja.`,
          });
          for (const c of candidates) usedTradeIds.add(c.tradeId);
          i += candidates.length;
        } else {
          i += 1;
        }
      } else {
        i += 1;
      }
    }
  }

  return bundles;
}

export async function GET(req: NextRequest) {
  return handleBundleOptimizer(req);
}

// v7.59: POST handler — AI Hub runner always sends POST with JSON body.
// Body is ignored (this endpoint takes no input) — logic is identical to GET.
export async function POST(req: NextRequest) {
  return handleBundleOptimizer(req);
}

async function handleBundleOptimizer(req: NextRequest) {
  try {
    // v7.32: AI rate limit
    const rl = checkRateLimit(req, 'ai-bundle-profit-optimizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    // 1) Query all HELD trades with their linked Listing
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        listing: {
          select: {
            aiEstimatedValue: true,
            dealScore: true,
          },
        },
      },
      take: 500,
    });

    // 2) Compute per-item data
    const items: HeldItem[] = heldTrades.map(t => {
      const estValue =
        t.listing?.aiEstimatedValue && t.listing.aiEstimatedValue > 0
          ? t.listing.aiEstimatedValue
          : Math.round(t.buyPrice * 1.2);
      return {
        tradeId: t.id,
        title: t.title,
        category: (t.category || 'drugo').trim().toLowerCase(),
        buyPrice: t.buyPrice,
        estimatedValue: estValue,
        potentialProfit: estValue - t.buyPrice,
        bundleCompatibility: getCompatibleCategories(
          (t.category || 'drugo').trim(),
        ),
      };
    });

    // Graceful handling: empty inventory
    if (items.length === 0) {
      return NextResponse.json({
        ok: true,
        standaloneAnalysis: {
          totalItems: 0,
          totalInvested: 0,
          totalEstimatedValue: 0,
          standaloneProfit: 0,
        },
        bundles: [],
        summary: {
          totalBundles: 0,
          itemsBundled: 0,
          itemsUnbundled: 0,
          expectedTotalProfitBundled: 0,
          expectedTotalProfitStandalone: 0,
          profitUplift: 0,
          recommendation: 'Ni held inventarja — nič za pakiranje.',
        },
        aiUsed: false,
        message: 'Ni held inventarja — nič za pakiranje.',
      });
    }

    // 3) Standalone analysis
    const totalInvested = items.reduce((s, i) => s + i.buyPrice, 0);
    const totalEstimatedValue = items.reduce((s, i) => s + i.estimatedValue, 0);
    const standaloneProfit = totalEstimatedValue - totalInvested;

    // 4) Check AI cache (keyed by sorted held item IDs)
    const sortedIds = items.map(i => i.tradeId).sort().join(',');
    const cacheKey = `bundle-profit-optimizer:${JSON.stringify(sortedIds)}`;
    const cached = getCachedAI<{
      bundles: BundleSuggestion[];
      summary: {
        totalBundles: number;
        itemsBundled: number;
        itemsUnbundled: number;
        expectedTotalProfitBundled: number;
        expectedTotalProfitStandalone: number;
        profitUplift: number;
        recommendation: string;
      };
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        standaloneAnalysis: {
          totalItems: items.length,
          totalInvested: Math.round(totalInvested),
          totalEstimatedValue: Math.round(totalEstimatedValue),
          standaloneProfit: Math.round(standaloneProfit),
        },
        ...cached,
        cached: true,
        aiUsed: true,
      });
    }

    // 5) Build AI prompt with grounding
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '',
      fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const itemsBlock = items
      .slice(0, 60)
      .map(
        (i, idx) =>
          `${idx + 1}. id=${i.tradeId} | ${i.title} | kategorija=${i.category} | nabava=${i.buyPrice}€ | estVrednost=${i.estimatedValue}€`,
      )
      .join('\n');

    const prompt = `Si strokovnjak za paketno prodajo na oglasnih platformah (Bolha, Vinted, FB Marketplace).

HELD INVENTAR (${items.length} item-ov):
${itemsBlock}

NALOGA:
Identificiraj 2-4 item-e, ki se medsebojno dopolnjujejo in bi jih lahko prodali SKUPAJ kot paket.
Paketiranje komplementarnih item-ov (npr. PS5 + controller + igra) lahko da višji skupni profit
kot prodaja posebej, ker:
- prihrani čas (en kontakt, en sestanek)
- poveča vrednost za kupca (pripravljen plačati malo več)
- hitrejša prodaja (bundle privabi več kupcev)

KOMPATIBILNOST KATEGORIJ (smernice):
- elektronika + igre/aksesoiri/pohistvo
- moda + aksesoiri/obutev
- avto + gume/aksesoiri
- dom + pohistvo/kuhinja

PRAVILA:
- Paket mora vsebovati 2-4 item-e
- Skupna vrednost paketa naj bo 0.8×-1.1× vsote posameznih estVrednosti (5-15% popust)
- Cena paketa mora pokriti nabavno ceno
- Vsak item je lahko samo v enem paketu

Odgovori LE z JSON:
{
  "bundles": [
    {
      "itemIds": ["<tradeId1>", "<tradeId2>", "<tradeId3>"],
      "suggestedBundlePrice": <number EUR>,
      "bundleDiscountPercent": <number 0-20>,
      "expectedSellTimeDays": <number 1-60>,
      "reasoning": "<1-2 stavka — zakaj ta paket deluje>"
    }
  ]
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;
    let bundles: BundleSuggestion[] = [];

    // Build itemsById lookup for clamping
    const itemsById = new Map<string, HeldItem>(items.map(i => [i.tradeId, i]));
    const usedTradeIds = new Set<string>();

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiBundleResponse | null;
      if (parsed && Array.isArray(parsed.bundles)) {
        for (const rawBundle of parsed.bundles) {
          const bundle = clampBundleSuggestion(rawBundle, itemsById, usedTradeIds);
          if (bundle) bundles.push(bundle);
          if (bundles.length >= 10) break; // cap at 10 bundles
        }
        if (bundles.length > 0) aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/bundle-profit-optimizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 6) Deterministic fallback if AI unavailable or returned no valid bundles
    if (bundles.length === 0) {
      bundles = deterministicBundles(items);
    }

    // 7) Compute summary
    const itemsBundled = bundles.reduce((s, b) => s + b.items.length, 0);
    const itemsUnbundled = items.length - itemsBundled;
    const expectedTotalProfitBundled = bundles.reduce(
      (s, b) => s + b.expectedProfit,
      0,
    );
    // Standalone profit for items that are bundled (compare apples-to-apples)
    const bundledItemStandaloneProfit = bundles.reduce((s, b) => {
      const standaloneForBundle =
        b.items.reduce((x, i) => x + i.estimatedValue, 0) -
        b.items.reduce((x, i) => x + i.buyPrice, 0);
      return s + standaloneForBundle;
    }, 0);
    const profitUplift =
      bundledItemStandaloneProfit > 0
        ? Math.round(
            ((expectedTotalProfitBundled - bundledItemStandaloneProfit) /
              bundledItemStandaloneProfit) *
              100,
          )
        : 0;

    let recommendation: string;
    if (bundles.length === 0) {
      recommendation = 'Ni komplementarnih item-ov za pakete — prodaj posebej.';
    } else if (profitUplift > 0) {
      recommendation = `Ustvari ${bundles.length} paket-ov (${itemsBundled} item-ov). Pričakovan profit +${profitUplift}% glede na prodajo posebej.`;
    } else {
      recommendation = `Ustvari ${bundles.length} paket-ov (${itemsBundled} item-ov) za hitrejšo prodajo (manjši profit, hitrejši turnover).`;
    }

    const summary = {
      totalBundles: bundles.length,
      itemsBundled,
      itemsUnbundled,
      expectedTotalProfitBundled: Math.round(expectedTotalProfitBundled),
      expectedTotalProfitStandalone: Math.round(bundledItemStandaloneProfit),
      profitUplift,
      recommendation,
    };

    // 8) Cache (6h TTL) — only cache when AI was used (not deterministic fallback,
    // which is cheap and changes only when items change)
    if (aiUsed) {
      setCachedAI(cacheKey, { bundles, summary });
    }

    return NextResponse.json({
      ok: true,
      standaloneAnalysis: {
        totalItems: items.length,
        totalInvested: Math.round(totalInvested),
        totalEstimatedValue: Math.round(totalEstimatedValue),
        standaloneProfit: Math.round(standaloneProfit),
      },
      bundles,
      summary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error('/api/ai/bundle-profit-optimizer', 'handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
