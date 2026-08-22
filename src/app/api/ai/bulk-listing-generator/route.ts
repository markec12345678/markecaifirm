// v6.48 / v8.96.2-batch2: AI Bulk Listing Generator — generira optimized listings za več platform hkrati iz enega itema
// Refaktoriran z withAiRoute helperjem (v8.96.2-batch2) + enforceBudget guard.
//
// POST /api/ai/bulk-listing-generator
// Body: { tradeIds?: string[], platforms?: ['bolha','facebook','vinted','ebay','kleinanzeigen'] }
// Returns: { ok, generator: { listings, platformAdaptations, batchPlan, recommendations, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 120;

const PLATFORM_CONFIG = {
  bolha: {
    titleMax: 60, descMax: 4000, tagMax: 5,
    priceStrategy: 'fair_market', supportsAuction: true, supportsBuyNow: true,
    audience: 'slovenski kupci, lokalno', feePct: 0,
  },
  facebook: {
    titleMax: 80, descMax: 5000, tagMax: 10,
    priceStrategy: 'slightly_below_market', supportsAuction: false, supportsBuyNow: true,
    audience: 'lokalna skupnost, širši demografski profil', feePct: 0,
  },
  vinted: {
    titleMax: 50, descMax: 1500, tagMax: 5,
    priceStrategy: 'competitive', supportsAuction: false, supportsBuyNow: true,
    audience: 'modno ozaveščeni, mlajši kupci', feePct: 5,
  },
  ebay: {
    titleMax: 80, descMax: 500000, tagMax: 80,
    priceStrategy: 'auction_friendly', supportsAuction: true, supportsBuyNow: true,
    audience: 'mednarodni kupci, collectorji', feePct: 10,
  },
  kleinanzeigen: {
    titleMax: 70, descMax: 4000, tagMax: 5,
    priceStrategy: 'fair_market', supportsAuction: false, supportsBuyNow: true,
    audience: 'nemški kupci, srednjeevropski', feePct: 0,
  },
} as const;

type PlatformName = keyof typeof PLATFORM_CONFIG;

interface BulkListingGeneratorInput {
  tradeIds: string[];
  platforms: PlatformName[];
}

export const POST = withAiRoute<BulkListingGeneratorInput>({
  endpoint: '/api/ai/bulk-listing-generator',
  maxDuration: 120,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const tradeIds: string[] = Array.isArray(body?.tradeIds) ? body.tradeIds : [];
    const platforms: PlatformName[] = Array.isArray(body?.platforms) && body.platforms.length > 0
      ? body.platforms.filter((p: string) => p in PLATFORM_CONFIG)
      : ['bolha', 'facebook', 'vinted'];
    return { tradeIds, platforms };
  },

  // No validateInput — defaults handle empty inputs
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeIds, platforms } = input;

    // 1. Pridobi held trade-e
    const where: any = { status: 'held' };
    if (tradeIds.length > 0) where.id = { in: tradeIds };

    const heldTrades = await db.trade.findMany({
      where,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        imageUrl: true,
        listing: {
          select: {
            description: true, detailDescription: true, imageUrl: true, detailImages: true,
            aiEstimatedValue: true, dealScore: true, aiScore: true, aiRisk: true,
            aiImageAnalysis: true, location: true,
          },
        },
      },
      take: tradeIds.length > 0 ? tradeIds.length : 15,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, generator: null, message: 'Ni held tradeov za bulk listing generacijo.' });
    }

    // 2. Pripravi podatke za AI
    const items = buildItems(heldTrades);
    const itemsStr = buildItemsStr(items);
    const prompt = buildPrompt(items, itemsStr, platforms);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const generator = transformGenerator(parsed, items, platforms);

    return apiOk({ ok: true, generator });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  imageUrl: string | null;
  listing: {
    description: string | null;
    detailDescription: string | null;
    imageUrl: string | null;
    detailImages: string | null;
    aiEstimatedValue: number | null;
    dealScore: number | null;
    aiScore: number | null;
    aiRisk: number | null;
    aiImageAnalysis: string | null;
    location: string | null;
  } | null;
}

interface ItemInfo {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  description: string;
  imageUrl: string;
  aiRisk: number;
}

function buildItems(heldTrades: HeldTradeRow[]): ItemInfo[] {
  return heldTrades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));
    return {
      id: t.id,
      title: t.title,
      category: t.category || 'drugo',
      cost,
      estValue,
      daysHeld,
      description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 300),
      imageUrl: t.imageUrl || t.listing?.imageUrl || '',
      aiRisk: t.listing?.aiRisk ?? 5,
    };
  });
}

function buildItemsStr(items: ItemInfo[]): string {
  return items.map(i =>
    `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d | slika: ${i.imageUrl ? 'da' : 'ne'}`
  ).join('\n');
}

function buildPrompt(items: ItemInfo[], itemsStr: string, platforms: PlatformName[]): string {
  const platformStr = platforms.join(', ');
  return `Si AI bulk listing generator za slovenske in mednarodne oglasne platforme.
Generiraj optimizirane listings za vsak item na vsaki platformi hkrati.

ITEMS ZA OBJAVO (${items.length}):
${itemsStr}

PLATFORME (${platforms.length}): ${platformStr}

Platform specifikacije:
- BOLHA: naslov ≤60c, opis ≤4000c, 5 tagov, 0% fee, lokalno slovenski kupci
- FACEBOOK: naslov ≤80c, opis ≤5000c, 10 tagov, 0% fee, širši demografski profil
- VINTED: naslov ≤50c, opis ≤1500c, 5 tagov, 5% fee, modno ozaveščeni mlajši
- EBAY: naslov ≤80c, opis 500KB, 80 tagov, 10% fee, mednarodni collectorji
- KLEINANZEIGEN: naslov ≤70c, opis ≤4000c, 5 tagov, 0% fee, nemški kupci

Generacijska pravila:
1. NASLOV per platforma: drugačna dolžina in stil glede na platformo
2. OPIS per platforma: bolha tehničen, facebook čustven, vinted modno stiliziran
3. CENA per platforma: prilagojena glede na fee in konkurenco
4. TAGS per platforma: različni keywords za iskanje
5. LOKACIJA per platforma: bolha=lokacija, facebook=mesto+okolica, vinted=država
6. CTA per platforma: različen poziv k akciji

Listing taktike:
- SEO_OPTIMIZED: ključne besede spredaj, brand + model + spec
- EMOTIONAL: čustveni opis za facebook ("perfektno darilo za...")
- TECHNICAL: specifikacije, dimenzije, stanje za bolha
- TRENDY: modni buzzwords za vinted
- INTERNATIONAL: angleški prevod za ebay, nemški za kleinanzeigen

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "trade_id": "<trade_id>",
      "platform_listings": [
        {
          "platform": "<bolha|facebook|vinted|ebay|kleinanzeigen>",
          "title": "<naslov glede na platformo>",
          "description": "<opis glede na platformo, max 800 znakov>",
          "price_eur": <number>,
          "tags": ["<5-10 tagov>"],
          "category": "<kategorija na platformi>",
          "location": "<lokacija>",
          "listing_type": "<fixed|auction|both>",
          "cta": "<call to action, max 80 znakov>",
          "language": "<sl|en|de>",
          "expected_views_per_week": <number>,
          "expected_inquiries_per_week": <number>
        }
      ],
      "cross_platform_strategy": "<max 120 znakov>",
      "best_platform": "<bolha|facebook|vinted|ebay|kleinanzeigen>",
      "best_platform_reason": "<max 100 znakov>"
    }
  ],
  "platform_adaptations": [
    {
      "platform": "<bolha|facebook|vinted|ebay|kleinanzeigen>",
      "title_strategy": "<max 100 znakov>",
      "description_strategy": "<max 100 znakov>",
      "pricing_strategy": "<max 100 znakov>",
      "tag_strategy": "<max 100 znakov>",
      "language": "<sl|en|de>",
      "expected_reach": "<local|national|international>",
      "fee_pct": <number>,
      "audience": "<max 80 znakov>"
    }
  ],
  "batch_plan": [
    {
      "batch_number": <number>,
      "items": <number>,
      "platforms": ["<platforme>"],
      "scheduled_date": "<YYYY-MM-DD>",
      "expected_total_revenue_eur": <number>,
      "estimated_fees_eur": <number>,
      "net_revenue_eur": <number>
    }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_impact_pct": <number>, "platforms_affected": <number> }
  ],
  "summary": {
    "total_items": <number>,
    "total_listings_generated": <number>,
    "platforms_used": <number>,
    "total_expected_revenue_eur": <number>,
    "total_estimated_fees_eur": <number>,
    "net_revenue_eur": <number>,
    "avg_listings_per_item": <number>,
    "best_platform": "<bolha|facebook|vinted|ebay|kleinanzeigen>",
    "best_platform_avg_revenue_eur": <number>,
    "bulk_efficiency_score": <number 0-100>,
    "biggest_opportunity": "<max 100 znakov>",
    "quickest_win": "<max 100 znakov>"
  }
}`;
}

function transformGenerator(parsed: any, items: ItemInfo[], platforms: PlatformName[]): any {
  const validIds = new Set(items.map(i => i.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listings: (parsed?.listings || [])
      .filter((l: any) => validIds.has(String(l?.trade_id ?? '')))
      .slice(0, 15)
      .map((l: any) => ({
        tradeId: String(l?.trade_id ?? '').slice(0, 50),
        platformListings: (l?.platform_listings || [])
          .filter((pl: any) => platforms.includes(String(pl?.platform) as PlatformName))
          .slice(0, 5)
          .map((pl: any) => ({
            platform: String(pl?.platform ?? '').slice(0, 30),
            title: String(pl?.title ?? '').slice(0, 120),
            description: String(pl?.description ?? '').slice(0, 1200),
            priceEur: Math.max(0, Math.round(Number(pl?.price_eur ?? 0))),
            tags: (pl?.tags || []).slice(0, 15).map((t: any) => String(t).slice(0, 50)),
            category: String(pl?.category ?? '').slice(0, 80),
            location: String(pl?.location ?? '').slice(0, 80),
            listingType: ['fixed', 'auction', 'both'].includes(String(pl?.listing_type)) ? String(pl.listing_type) : 'fixed',
            cta: String(pl?.cta ?? '').slice(0, 150),
            language: ['sl', 'en', 'de'].includes(String(pl?.language)) ? String(pl.language) : 'sl',
            expectedViewsPerWeek: Math.max(0, Number(pl?.expected_views_per_week ?? 0)),
            expectedInquiriesPerWeek: Math.max(0, Number(pl?.expected_inquiries_per_week ?? 0)),
          })),
        crossPlatformStrategy: String(l?.cross_platform_strategy ?? '').slice(0, 250),
        bestPlatform: platforms.includes(String(l?.best_platform) as PlatformName) ? String(l.best_platform) : platforms[0],
        bestPlatformReason: String(l?.best_platform_reason ?? '').slice(0, 200),
      })),
    platformAdaptations: (parsed?.platform_adaptations || [])
      .filter((p: any) => platforms.includes(String(p?.platform) as PlatformName))
      .slice(0, 5)
      .map((p: any) => {
        const cfg = PLATFORM_CONFIG[String(p?.platform) as PlatformName];
        return {
          platform: String(p?.platform ?? '').slice(0, 30),
          titleStrategy: String(p?.title_strategy ?? '').slice(0, 200),
          descriptionStrategy: String(p?.description_strategy ?? '').slice(0, 200),
          pricingStrategy: String(p?.pricing_strategy ?? '').slice(0, 200),
          tagStrategy: String(p?.tag_strategy ?? '').slice(0, 200),
          language: ['sl', 'en', 'de'].includes(String(p?.language)) ? String(p.language) : 'sl',
          expectedReach: ['local', 'national', 'international'].includes(String(p?.expected_reach)) ? String(p.expected_reach) : 'local',
          feePct: cfg ? cfg.feePct : 0,
          audience: String(p?.audience ?? '').slice(0, 150),
        };
      }),
    batchPlan: (parsed?.batch_plan || []).slice(0, 7).map((b: any) => ({
      batchNumber: Math.max(1, Number(b?.batch_number ?? 1)),
      items: Math.max(0, Number(b?.items ?? 0)),
      platforms: (b?.platforms || []).slice(0, 5).map((p: any) => String(p).slice(0, 30)),
      scheduledDate: String(b?.scheduled_date ?? '').slice(0, 20),
      expectedTotalRevenueEur: Math.round(Number(b?.expected_total_revenue_eur ?? 0)),
      estimatedFeesEur: Math.round(Number(b?.estimated_fees_eur ?? 0)),
      netRevenueEur: Math.round(Number(b?.net_revenue_eur ?? 0)),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      expectedImpactPct: Math.round(Number(r?.expected_impact_pct ?? 0)),
      platformsAffected: Math.max(0, Number(r?.platforms_affected ?? 0)),
    })),
    summary: {
      totalItems: items.length,
      totalListingsGenerated: Math.max(0, Number(parsed?.summary?.total_listings_generated ?? items.length * platforms.length)),
      platformsUsed: platforms.length,
      totalExpectedRevenueEur: Math.round(Number(parsed?.summary?.total_expected_revenue_eur ?? items.reduce((s, i) => s + i.estValue, 0))),
      totalEstimatedFeesEur: Math.round(Number(parsed?.summary?.total_estimated_fees_eur ?? 0)),
      netRevenueEur: Math.round(Number(parsed?.summary?.net_revenue_eur ?? 0)),
      avgListingsPerItem: Math.round(Number(parsed?.summary?.avg_listings_per_item ?? platforms.length) * 10) / 10,
      bestPlatform: platforms.includes(String(parsed?.summary?.best_platform) as PlatformName) ? String(parsed.summary.best_platform) : platforms[0],
      bestPlatformAvgRevenueEur: Math.round(Number(parsed?.summary?.best_platform_avg_revenue_eur ?? 0)),
      bulkEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.bulk_efficiency_score ?? 60))),
      biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 200),
      quickestWin: String(parsed?.summary?.quickest_win ?? '').slice(0, 200),
    },
  };
}
