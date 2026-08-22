// v6.45 / v8.96.1-batch2: AI Listing SEO Optimizer — optimizacija naslovov, opisov in ključnih besed za Bolha/Facebook/Vinted
// Refaktoriran z withAiRoute helperjem (v8.96.1) + enforceBudget guard.
//
// POST /api/ai/listing-seo-optimizer
// Body: { tradeId?: string, platform?: 'bolha'|'facebook'|'vinted'|'all' }
// Returns: { ok, optimizer: { listings, keywords, platformAdaptations, seoScore, recommendations, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// SEO best practices per platforma
const PLATFORM_SEO = {
  bolha:    { titleMax: 60, descMax: 4000, keywordDensity: 2.5, tagsMax: 5,  prioritizes: 'keywords+location' },
  facebook: { titleMax: 80, descMax: 5000, keywordDensity: 1.5, tagsMax: 10, prioritizes: 'visuals+emotion' },
  vinted:   { titleMax: 50, descMax: 1500, keywordDensity: 3.0, tagsMax: 5,  prioritizes: 'brand+size+condition' },
} as const;

interface ListingSeoOptimizerInput {
  platform: string;
  tradeId: string | null;
}

export const POST = withAiRoute<ListingSeoOptimizerInput>({
  endpoint: '/api/ai/listing-seo-optimizer',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      platform: String(body?.platform ?? 'all'),
      tradeId: body?.tradeId ? String(body.tradeId) : null,
    };
  },

  // No validateInput — platform ima default 'all', tradeId je opcijski
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { platform, tradeId } = input;

    // 1. Pridobi held trade-e (inventar za prodajo)
    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;

    const heldTrades = await db.trade.findMany({
      where,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: {
          select: {
            description: true, detailDescription: true, imageUrl: true,
            aiEstimatedValue: true, dealScore: true, aiScore: true,
            location: true, sellerName: true, url: true,
          },
        },
      },
      take: tradeId ? 1 : 20,
    });

    if (heldTrades.length === 0) {
      return apiOk({
        ok: true,
        optimizer: null,
        message: 'Ni held tradeov za SEO optimizacijo.',
      });
    }

    // 2. Pripravi podatke za AI
    const listings = computeListings(heldTrades);

    // 3. AI SEO optimizacija
    const prompt = buildPrompt(listings, platform);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const optimizer = transformOptimizer(parsed, listings);

    return apiOk({ ok: true, optimizer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface ListingRow {
  id: string;
  title: string;
  category: string;
  source: string;
  location: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  description: string;
  descLen: number;
  titleLen: number;
  imageUrl: string;
  currentSeoScore: number;
  dealScore: number;
}

function computeListings(heldTrades: Array<{
  id: string; title: string; category: string | null; buyPrice: number; buyFees: number | null;
  buyDate: Date;
  listing: {
    description: string | null; detailDescription: string | null; imageUrl: string | null;
    aiEstimatedValue: number | null; dealScore: number | null; aiScore: number | null;
    location: string | null; sellerName: string | null; url: string | null;
  } | null;
}>): ListingRow[] {
  return heldTrades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    const titleLen = (t.title || '').length;
    const desc = (t.listing?.detailDescription || t.listing?.description || '').slice(0, 500);
    const descLen = desc.length;
    const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));

    // Osnovni SEO score brez AI
    const titleHasNumber = /\d/.test(t.title);
    const titleHasBrand = /[A-Z]{2,}/.test(t.title);
    const titleHasKeyword = t.title.split(' ').length >= 4;
    const basicSeoScore = Math.min(100,
      (titleLen >= 30 && titleLen <= 60 ? 25 : 10) +
      (titleHasNumber ? 15 : 0) +
      (titleHasBrand ? 15 : 0) +
      (titleHasKeyword ? 20 : 5) +
      (descLen >= 100 ? 15 : 5) +
      (t.listing?.imageUrl ? 10 : 0)
    );

    return {
      id: t.id,
      title: t.title,
      category: t.category || 'drugo',
      source: 'bolha',
      location: t.listing?.location || '',
      cost,
      estValue,
      daysHeld,
      description: desc,
      descLen,
      titleLen,
      imageUrl: t.listing?.imageUrl ?? '',
      currentSeoScore: basicSeoScore,
      dealScore: t.listing?.dealScore ?? 50,
    };
  });
}

function buildPrompt(listings: ListingRow[], platform: string): string {
  const listingsStr = listings.map(l =>
    `- [${l.id}] "${l.title}" | ${l.category} | ${l.source} | ${l.titleLen}c naslov, ${l.descLen}c opis | cena ${l.estValue}€ | SEO ${l.currentSeoScore}/100`
  ).join('\n');

  const platformStr = platform === 'all'
    ? 'vse platforme (Bolha, Facebook, Vinted)'
    : platform;

  return `Si AI SEO optimizer za slovenske oglasne platforme (Bolha, Facebook Marketplace, Vinted).
Optimiziraj naslove in opise za maksimalno iskalno vidljivost in konverzijo.

PLATFORMA: ${platformStr}

OGLASI ZA OPTIMIZACIJO (${listings.length}):
${listingsStr}

SEO pravila:
- BOLHA: naslov ≤60 znakov, ključne besede + lokacija, 2.5% keyword density
- FACEBOOK: naslov ≤80 znakov, čustveni elementi + vizualni opis, 1.5% density
- VINTED: naslov ≤50 znakov, znamka + velikost + stanje, 3.0% density

Optimizacijske taktike:
1. TITLE_OPT: ključne besede spredaj, brand + model + specifikacija + stanje
2. KEYWORD_EXP: dodaj sinonime in long-tail keywords (npr. "iPhone 13 Pro" → "iPhone 13 Pro 128GB gold mobitel")
3. DESC_ENH: strukturiran opis s specifikacijami, stanjem, razlogom prodaje
4. TAG_OPT: 5-10 relevantnih tagov za iskanje
5. PRICE_ANCHOR: omeni originalno ceno/MSRP za perceived value
6. LOCATION_OPT: dodaj regijo/mesto za lokalno iskanje
7. CTA: jasen call-to-action (kliči, piši, dogovor)
8. TRUST: omeni stanje, garancijo,originalno embalažo

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "id": "<trade_id>",
      "current_title": "<naslov>",
      "optimized_title_bolha": "<max 60 znakov>",
      "optimized_title_facebook": "<max 80 znakov>",
      "optimized_title_vinted": "<max 50 znakov>",
      "title_improvement": "<max 100 znakov>",
      "optimized_description": "<max 500 znakov strukturiran opis>",
      "primary_keywords": ["<5 ključnih besed>"],
      "long_tail_keywords": ["<5 dolgih ključnih besed>"],
      "tags": ["<5-10 tagov>"],
      "current_seo_score": <number 0-100>,
      "optimized_seo_score": <number 0-100>,
      "expected_views_increase_pct": <number>,
      "expected_inquiries_increase_pct": <number>
    }
  ],
  "keywords": [
    { "keyword": "<max 50 znakov>", "search_volume": "<low|medium|high>", "competition": "<low|medium|high>", "opportunity_score": <number 0-100>, "category": "<kategorija>" }
  ],
  "platform_adaptations": [
    { "platform": "<bolha|facebook|vinted>", "title_rule": "<max 80 znakov>", "desc_rule": "<max 80 znakov>", "tag_count": <number>, "special_tip": "<max 100 znakov>" }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_impact_pct": <number>, "implementation_effort": "<low|medium|high>" }
  ],
  "summary": {
    "avg_current_seo_score": <number>,
    "avg_optimized_seo_score": <number>,
    "seo_improvement_pct": <number>,
    "total_listings_optimized": <number>,
    "expected_avg_views_increase_pct": <number>,
    "expected_avg_inquiries_increase_pct": <number>,
    "seo_efficiency_score": <number 0-100>,
    "biggest_seo_issue": "<max 100 znakov>",
    "quickest_seo_win": "<max 100 znakov>"
  }
}`;
}

function transformOptimizer(parsed: any, listings: ListingRow[]): {
  insights: string;
  listings: Array<{
    tradeId: string;
    currentTitle: string;
    optimizedTitleBolha: string;
    optimizedTitleFacebook: string;
    optimizedTitleVinted: string;
    titleImprovement: string;
    optimizedDescription: string;
    primaryKeywords: string[];
    longTailKeywords: string[];
    tags: string[];
    currentSeoScore: number;
    optimizedSeoScore: number;
    expectedViewsIncreasePct: number;
    expectedInquiriesIncreasePct: number;
  }>;
  keywords: Array<{
    keyword: string;
    searchVolume: string;
    competition: string;
    opportunityScore: number;
    category: string;
  }>;
  platformAdaptations: Array<{
    platform: string;
    titleRule: string;
    descRule: string;
    tagCount: number;
    specialTip: string;
  }>;
  recommendations: Array<{
    action: string;
    priority: string;
    expectedImpactPct: number;
    implementationEffort: string;
  }>;
  summary: {
    avgCurrentSeoScore: number;
    avgOptimizedSeoScore: number;
    seoImprovementPct: number;
    totalListingsOptimized: number;
    expectedAvgViewsIncreasePct: number;
    expectedAvgInquiriesIncreasePct: number;
    seoEfficiencyScore: number;
    biggestSeoIssue: string;
    quickestSeoWin: string;
  };
} {
  const validIds = new Set(listings.map(l => l.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listings: (parsed?.listings || [])
      .filter((l: any) => validIds.has(String(l?.id ?? '')))
      .slice(0, 20)
      .map((l: any) => {
        const orig = listings.find(x => x.id === String(l?.id));
        return {
          tradeId: String(l?.id ?? ''),
          currentTitle: String(l?.current_title ?? orig?.title ?? '').slice(0, 200),
          optimizedTitleBolha: String(l?.optimized_title_bolha ?? '').slice(0, 80),
          optimizedTitleFacebook: String(l?.optimized_title_facebook ?? '').slice(0, 100),
          optimizedTitleVinted: String(l?.optimized_title_vinted ?? '').slice(0, 70),
          titleImprovement: String(l?.title_improvement ?? '').slice(0, 200),
          optimizedDescription: String(l?.optimized_description ?? '').slice(0, 800),
          primaryKeywords: (l?.primary_keywords || []).slice(0, 8).map((k: any) => String(k).slice(0, 50)),
          longTailKeywords: (l?.long_tail_keywords || []).slice(0, 8).map((k: any) => String(k).slice(0, 80)),
          tags: (l?.tags || []).slice(0, 12).map((t: any) => String(t).slice(0, 40)),
          currentSeoScore: Math.max(0, Math.min(100, Number(l?.current_seo_score ?? orig?.currentSeoScore ?? 50))),
          optimizedSeoScore: Math.max(0, Math.min(100, Number(l?.optimized_seo_score ?? 70))),
          expectedViewsIncreasePct: Math.round(Number(l?.expected_views_increase_pct ?? 0)),
          expectedInquiriesIncreasePct: Math.round(Number(l?.expected_inquiries_increase_pct ?? 0)),
        };
      }),
    keywords: (parsed?.keywords || []).slice(0, 15).map((k: any) => ({
      keyword: String(k?.keyword ?? '').slice(0, 80),
      searchVolume: ['low', 'medium', 'high'].includes(String(k?.search_volume)) ? String(k.search_volume) : 'medium',
      competition: ['low', 'medium', 'high'].includes(String(k?.competition)) ? String(k.competition) : 'medium',
      opportunityScore: Math.max(0, Math.min(100, Number(k?.opportunity_score ?? 50))),
      category: String(k?.category ?? '').slice(0, 50),
    })),
    platformAdaptations: (parsed?.platform_adaptations || []).slice(0, 3).map((p: any) => ({
      platform: ['bolha', 'facebook', 'vinted'].includes(String(p?.platform)) ? String(p.platform) : 'bolha',
      titleRule: String(p?.title_rule ?? '').slice(0, 150),
      descRule: String(p?.desc_rule ?? '').slice(0, 150),
      tagCount: Math.max(0, Math.min(15, Number(p?.tag_count ?? 5))),
      specialTip: String(p?.special_tip ?? '').slice(0, 200),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      expectedImpactPct: Math.round(Number(r?.expected_impact_pct ?? 0)),
      implementationEffort: ['low', 'medium', 'high'].includes(String(r?.implementation_effort)) ? String(r.implementation_effort) : 'medium',
    })),
    summary: {
      avgCurrentSeoScore: Math.round(Number(parsed?.summary?.avg_current_seo_score ?? listings.reduce((s, l) => s + l.currentSeoScore, 0) / Math.max(1, listings.length))),
      avgOptimizedSeoScore: Math.round(Number(parsed?.summary?.avg_optimized_seo_score ?? 75)),
      seoImprovementPct: Math.round(Number(parsed?.summary?.seo_improvement_pct ?? 25)),
      totalListingsOptimized: listings.length,
      expectedAvgViewsIncreasePct: Math.round(Number(parsed?.summary?.expected_avg_views_increase_pct ?? 30)),
      expectedAvgInquiriesIncreasePct: Math.round(Number(parsed?.summary?.expected_avg_inquiries_increase_pct ?? 20)),
      seoEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.seo_efficiency_score ?? 60))),
      biggestSeoIssue: String(parsed?.summary?.biggest_seo_issue ?? '').slice(0, 200),
      quickestSeoWin: String(parsed?.summary?.quickest_seo_win ?? '').slice(0, 200),
    },
  };
}
