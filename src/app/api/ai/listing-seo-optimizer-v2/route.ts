// v6.60: AI Listing SEO Optimizer v2 — advanced SEO z keyword research, competitor analysis in ML ranking
// POST /api/ai/listing-seo-optimizer-v2
// Body: { tradeId?: string, listingId?: string, platforms?: string[] }
// Returns: { ok, optimizer: { listings, keywordResearch, competitorAnalysis, mlRanking, optimizationPlan, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const SEO_FACTORS = [
  'title_optimization',
  'keyword_density',
  'meta_description',
  'image_alt_text',
  'url_structure',
  'tag_optimization',
  'content_quality',
  'mobile_optimization',
  'page_load_speed',
  'social_signals',
] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId } = body;
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const platforms: string[] = Array.isArray(body?.platforms) ? body.platforms : ['bolha', 'facebook', 'vinted'];

    let targetListings: Array<{
      id: string; title: string; description: string; category: string;
      price: number; estValue: number; imageUrl: string; location: string;
    }> = [];

    if (tradeId) {
      const t = await db.trade.findUnique({
        where: { id: tradeId },
        select: { id: true, title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true, price: true, location: true } } },
      });
      if (!t) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
      targetListings = [{
        id: t.id, title: t.title, category: t.category || 'drugo',
        description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 800),
        price: t.listing?.price ?? t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
        imageUrl: t.listing?.imageUrl ?? '', location: t.listing?.location ?? '',
      }];
    } else if (listingId) {
      const l = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: { id: true, title: true, description: true, detailDescription: true, price: true, imageUrl: true, aiEstimatedValue: true, location: true },
      });
      if (!l) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      targetListings = [{
        id: l.id, title: l.title, category: '',
        description: (l.detailDescription || l.description || '').slice(0, 800),
        price: l.price ?? 0, estValue: l.aiEstimatedValue ?? l.price ?? 0,
        imageUrl: l.imageUrl ?? '', location: l.location ?? '',
      }];
    } else {
      const heldTrades = await db.trade.findMany({
        where: { status: 'held' },
        select: { id: true, title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true, price: true, location: true } } },
        take: 10,
        orderBy: { buyDate: 'desc' },
      });
      targetListings = heldTrades.map(t => ({
        id: t.id, title: t.title, category: t.category || 'drugo',
        description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 800),
        price: t.listing?.price ?? t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
        imageUrl: t.listing?.imageUrl ?? '', location: t.listing?.location ?? '',
      }));
    }

    if (targetListings.length === 0) {
      return NextResponse.json({ ok: true, optimizer: null, message: 'Ni listingov za SEO optimizacijo.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const itemsStr = targetListings.slice(0, 10).map(i =>
      `- [${i.id}] "${i.title}" | ${i.category} | ${i.price}€ | ${i.location} | opis: ${i.description.slice(0, 100)}...`
    ).join('\n');

    const prompt = `Si AI listing SEO optimizer v2 z keyword research, competitor analysis in ML ranking.
Advanced SEO optimizacija za Bolha, Facebook, Vinted, eBay, Kleinanzeigen.

OGLASI (${targetListings.length}):
${itemsStr}

PLATFORME: ${platforms.join(', ')}

10 SEO faktorjev:
1. TITLE_OPTIMIZATION: naslov z ključnimi besedami spredaj, brand, specifikacije
2. KEYWORD_DENSITY: optimalna gostota ključnih besed (1-3%)
3. META_DESCRIPTION: kratek opis za search preview
4. IMAGE_ALT_TEXT: alt text za slike z keywords
5. URL_STRUCTURE: clean URL z keywords
6. TAG_OPTIMIZATION: 5-10 relevantnih tagov
7. CONTENT_QUALITY: strukturiran, informativen opis
8. MOBILE_OPTIMIZATION: prikaz na mobilci
9. PAGE_LOAD_SPEED: hitrost nalaganja
10. SOCIAL_SIGNALS: share, like, save signals

Keyword research:
- PRIMARY_KEYWORDS: 3-5 glavnih ključnih besed (high volume, medium competition)
- LONG_TAIL_KEYWORDS: 5-10 dolgih ključnih besed (low competition, specific)
- BRAND_KEYWORDS: brand, model, specifikacije
- LOCAL_KEYWORDS: lokacija, mesto, regija
- SEASONAL_KEYWORDS: časovno relevantne besede

Competitor analysis:
- TOP_COMPETITORS: 5 najboljših konkurenčnih oglasov
- KEYWORD_GAPS: ključne besede ki jih competitorji uporabljajo
- PRICE_POSITIONING: ali si nad/pod/pri povprečju
- CONTENT_GAPS: kaj competitorji imajo v opisu kar ti ne

ML ranking model:
- Predicted search position (1-50)
- Click-through rate prediction
- Conversion rate prediction
- Engagement score

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "current_seo_score": <number 0-100>,
      "optimized_seo_score": <number 0-100>,
      "seo_factors": [
        {"factor": "<10 faktorjev>", "current_score": <number 0-100>, "optimized_score": <number 0-100>, "improvement_pct": <number>, "priority": "<high|medium|low>"}
      ],
      "optimized_title_per_platform": [{"platform": "<platforma>", "title": "<optimized naslov>"}],
      "optimized_description": "<max 800 znakov>",
      "primary_keywords": ["<5 ključnih besed>"],
      "long_tail_keywords": ["<8 dolgih ključnih besed>"],
      "tags": ["<10 tagov>"],
      "ml_predictions": {
        "predicted_search_position": <number 1-50>,
        "predicted_ctr_pct": <number 0-100>,
        "predicted_conversion_rate_pct": <number 0-100>,
        "predicted_engagement_score": <number 0-100>,
        "confidence_pct": <number 0-100>
      },
      "expected_views_increase_pct": <number>,
      "expected_inquiries_increase_pct": <number>
    }
  ],
  "keyword_research": [
    {
      "keyword": "<max 60 znakov>",
      "search_volume": "<low|medium|high|very_high>",
      "competition": "<low|medium|high|very_high>",
      "difficulty_score": <number 0-100>,
      "opportunity_score": <number 0-100>,
      "cpc_eur": <number>,
      "trend": "<rising|stable|falling>",
      "best_for_platform": "<platforma>"
    }
  ],
  "competitor_analysis": [
    {
      "competitor_title": "<max 100 znakov>",
      "competitor_price_eur": <number>,
      "keyword_overlap": ["<ključna beseda>"],
      "their_advantages": ["<max 80 znakov>"],
      "our_advantages": ["<max 80 znakov>"],
      "recommended_counter_strategy": "<max 150 znakov>"
    }
  ],
  "ml_ranking": [
    {
      "listing_id": "<trade_id>",
      "current_predicted_position": <number>,
      "optimized_predicted_position": <number>,
      "position_improvement": <number>,
      "ranking_factors": [{"factor": "<max 60 znakov>", "weight": <number 0-100>, "current_value": "<max 60 znakov>", "optimal_value": "<max 60 znakov>"}]
    }
  ],
  "optimization_plan": [
    {
      "step": <number>,
      "action": "<max 120 znakov>",
      "factor_targeted": "<10 faktorjev>",
      "expected_lift_pct": <number>,
      "implementation_effort": "<low|medium|high>",
      "time_to_complete_minutes": <number>
    }
  ],
  "summary": {
    "total_listings_optimized": <number>,
    "avg_current_seo_score": <number>,
    "avg_optimized_seo_score": <number>,
    "avg_improvement_pct": <number>,
    "total_keywords_researched": <number>,
    "best_keyword_opportunity": "<max 80 znakov>",
    "biggest_seo_issue": "<max 100 znakov>",
    "quickest_seo_win": "<max 100 znakov>",
    "seo_optimization_score": <number 0-100>
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
    const validIds = new Set(targetListings.map(i => i.id));

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      listings: (parsed?.listings || [])
        .filter((l: any) => validIds.has(String(l?.id ?? '')))
        .slice(0, 10)
        .map((l: any) => {
          const orig = targetListings.find(x => x.id === String(l?.id));
          return {
            tradeId: String(l?.id ?? ''),
            title: String(l?.title ?? orig?.title ?? '').slice(0, 150),
            currentSeoScore: Math.max(0, Math.min(100, Number(l?.current_seo_score ?? 50))),
            optimizedSeoScore: Math.max(0, Math.min(100, Number(l?.optimized_seo_score ?? 75))),
            seoFactors: (l?.seo_factors || []).slice(0, 10).map((f: any) => ({
              factor: SEO_FACTORS.includes(String(f?.factor) as any) ? String(f.factor) : 'title_optimization',
              currentScore: Math.max(0, Math.min(100, Number(f?.current_score ?? 50))),
              optimizedScore: Math.max(0, Math.min(100, Number(f?.optimized_score ?? 70))),
              improvementPct: Math.round(Number(f?.improvement_pct ?? 0)),
              priority: ['high', 'medium', 'low'].includes(String(f?.priority)) ? String(f.priority) : 'medium',
            })),
            optimizedTitlePerPlatform: (l?.optimized_title_per_platform || []).slice(0, 5).map((p: any) => ({
              platform: platforms.includes(String(p?.platform)) ? String(p.platform) : 'bolha',
              title: String(p?.title ?? '').slice(0, 150),
            })),
            optimizedDescription: String(l?.optimized_description ?? '').slice(0, 1200),
            primaryKeywords: (l?.primary_keywords || []).slice(0, 8).map((k: any) => String(k).slice(0, 80)),
            longTailKeywords: (l?.long_tail_keywords || []).slice(0, 12).map((k: any) => String(k).slice(0, 120)),
            tags: (l?.tags || []).slice(0, 15).map((t: any) => String(t).slice(0, 50)),
            mlPredictions: {
              predictedSearchPosition: Math.max(1, Math.min(50, Number(l?.ml_predictions?.predicted_search_position ?? 25))),
              predictedCtrPct: Math.max(0, Math.min(100, Number(l?.ml_predictions?.predicted_ctr_pct ?? 5))),
              predictedConversionRatePct: Math.max(0, Math.min(100, Number(l?.ml_predictions?.predicted_conversion_rate_pct ?? 10))),
              predictedEngagementScore: Math.max(0, Math.min(100, Number(l?.ml_predictions?.predicted_engagement_score ?? 60))),
              confidencePct: Math.max(0, Math.min(100, Number(l?.ml_predictions?.confidence_pct ?? 60))),
            },
            expectedViewsIncreasePct: Math.round(Number(l?.expected_views_increase_pct ?? 30)),
            expectedInquiriesIncreasePct: Math.round(Number(l?.expected_inquiries_increase_pct ?? 25)),
          };
        }),
      keywordResearch: (parsed?.keyword_research || []).slice(0, 20).map((k: any) => ({
        keyword: String(k?.keyword ?? '').slice(0, 100),
        searchVolume: ['low', 'medium', 'high', 'very_high'].includes(String(k?.search_volume)) ? String(k.search_volume) : 'medium',
        competition: ['low', 'medium', 'high', 'very_high'].includes(String(k?.competition)) ? String(k.competition) : 'medium',
        difficultyScore: Math.max(0, Math.min(100, Number(k?.difficulty_score ?? 50))),
        opportunityScore: Math.max(0, Math.min(100, Number(k?.opportunity_score ?? 50))),
        cpcEur: Math.round(Number(k?.cpc_eur ?? 0) * 100) / 100,
        trend: ['rising', 'stable', 'falling'].includes(String(k?.trend)) ? String(k.trend) : 'stable',
        bestForPlatform: platforms.includes(String(k?.best_for_platform)) ? String(k.best_for_platform) : 'bolha',
      })),
      competitorAnalysis: (parsed?.competitor_analysis || []).slice(0, 5).map((c: any) => ({
        competitorTitle: String(c?.competitor_title ?? '').slice(0, 150),
        competitorPriceEur: Math.max(0, Math.round(Number(c?.competitor_price_eur ?? 0))),
        keywordOverlap: (c?.keyword_overlap || []).slice(0, 8).map((k: any) => String(k).slice(0, 80)),
        theirAdvantages: (c?.their_advantages || []).slice(0, 4).map((a: any) => String(a).slice(0, 150)),
        ourAdvantages: (c?.our_advantages || []).slice(0, 4).map((a: any) => String(a).slice(0, 150)),
        recommendedCounterStrategy: String(c?.recommended_counter_strategy ?? '').slice(0, 300),
      })),
      mlRanking: (parsed?.ml_ranking || [])
        .filter((r: any) => validIds.has(String(r?.listing_id ?? '')))
        .slice(0, 10)
        .map((r: any) => ({
          tradeId: String(r?.listing_id ?? '').slice(0, 50),
          currentPredictedPosition: Math.max(1, Math.min(50, Number(r?.current_predicted_position ?? 25))),
          optimizedPredictedPosition: Math.max(1, Math.min(50, Number(r?.optimized_predicted_position ?? 10))),
          positionImprovement: Math.round(Number(r?.position_improvement ?? 0)),
          rankingFactors: (r?.ranking_factors || []).slice(0, 6).map((f: any) => ({
            factor: String(f?.factor ?? '').slice(0, 100),
            weight: Math.max(0, Math.min(100, Number(f?.weight ?? 50))),
            currentValue: String(f?.current_value ?? '').slice(0, 100),
            optimalValue: String(f?.optimal_value ?? '').slice(0, 100),
          })),
        })),
      optimizationPlan: (parsed?.optimization_plan || []).slice(0, 8).map((o: any) => ({
        step: Math.max(1, Number(o?.step ?? 1)),
        action: String(o?.action ?? '').slice(0, 250),
        factorTargeted: SEO_FACTORS.includes(String(o?.factor_targeted) as any) ? String(o.factor_targeted) : 'title_optimization',
        expectedLiftPct: Math.round(Number(o?.expected_lift_pct ?? 0)),
        implementationEffort: ['low', 'medium', 'high'].includes(String(o?.implementation_effort)) ? String(o.implementation_effort) : 'medium',
        timeToCompleteMinutes: Math.max(1, Number(o?.time_to_complete_minutes ?? 5)),
      })),
      summary: {
        totalListingsOptimized: targetListings.length,
        avgCurrentSeoScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_current_seo_score ?? 50))),
        avgOptimizedSeoScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_optimized_seo_score ?? 75))),
        avgImprovementPct: Math.round(Number(parsed?.summary?.avg_improvement_pct ?? 25) * 10) / 10,
        totalKeywordsResearched: Math.max(0, Number(parsed?.summary?.total_keywords_researched ?? (parsed?.keyword_research || []).length)),
        bestKeywordOpportunity: String(parsed?.summary?.best_keyword_opportunity ?? '').slice(0, 150),
        biggestSeoIssue: String(parsed?.summary?.biggest_seo_issue ?? '').slice(0, 200),
        quickestSeoWin: String(parsed?.summary?.quickest_seo_win ?? '').slice(0, 200),
        seoOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.seo_optimization_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { logger.error("/api/ai/listing-seo-optimizer-v2", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
