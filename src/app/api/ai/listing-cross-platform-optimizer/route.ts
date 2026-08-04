// v6.66: AI Listing Cross-Platform Optimizer — optimizira oglase čez 5 platform z ML in sync strategy
// POST /api/ai/listing-cross-platform-optimizer
// Body: { tradeId?: string }
// Returns: { ok, optimizer: { listings, platforms, syncStrategy, conflicts, performance, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PLATFORMS = ['bolha', 'facebook', 'vinted', 'ebay', 'kleinanzeigen'] as const;
const SYNC_STRATEGIES = ['cross_post', 'price_sync', 'inventory_sync', 'rotation_sync', 'bundle_sync', 'seasonal_sync', 'exclusive_deal', 'competitive_pricing'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId) : null;

    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades = await db.trade.findMany({
      where, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true, location: true, description: true, detailDescription: true, imageUrl: true } } }, take: tradeId ? 1 : 15,
    });

    if (heldTrades.length === 0) return NextResponse.json({ ok: true, optimizer: null, message: 'Ni held tradeov za cross-platform optimizacijo.' });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const items = heldTrades.map(t => ({ id: t.id, title: t.title, category: t.category || 'drugo', cost: t.buyPrice + (t.buyFees ?? 0), estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25), description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 200), location: t.listing?.location ?? '' }));
    const itemsStr = items.slice(0, 10).map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.location}`).join('\n');

    const prompt = `Si AI listing cross-platform optimizer z ML in sync strategy.
Optimizira oglase čez 5 platform (Bolha, Facebook, Vinted, eBay, Kleinanzeigen) za maksimalen doseg in profit.

INVENTAR (${items.length}):
${itemsStr}

8 sync strategij:
1. CROSS_POST: isti item na več platformah z različnim opisom
2. PRICE_SYNC: usklajene cene čez platforme
3. INVENTORY_SYNC: odstrani z drugih ko prodaš na eni
4. ROTATION_SYNC: rotiraj vsakih 7d med platformami
5. BUNDLE_SYNC: bundle na eni, posamezni na drugi
6. SEASONAL_SYNC: sezonsko prilagajanje platform
7. EXCLUSIVE_DEAL: ekskluzivna ponudba samo na eni platformi
8. COMPETITIVE_PRICING: prilagodi ceno glede na konkurenco na platformi

Platform specifikacije:
- BOLHA: 0% fee, slovenski kupci, max 60c naslov, 4000c opis
- FACEBOOK: 0% fee, širši demographics, max 80c naslov, 5000c opis
- VINTED: 5% fee, modno ozaveščeni, max 50c naslov, 1500c opis
- EBAY: 10% fee, mednarodni, max 80c naslov, 8000c opis
- KLEINANZEIGEN: 0% fee, nemški kupci, max 70c naslov, 4000c opis

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "id": "<trade_id>", "title": "<naslov>",
      "platform_configs": [
        { "platform": "<bolha|facebook|vinted|ebay|kleinanzeigen>", "title": "<platform-specific naslov>", "description": "<platform-specific opis 300c>", "price_eur": <number>, "tags": ["<tag>"], "language": "<sl|en|de>", "cta": "<max 80 znakov>", "expected_views_per_week": <number>, "expected_inquiries_per_week": <number>, "fee_pct": <number>, "net_revenue_eur": <number>, "performance_score": <number 0-100>, "recommended": <boolean> }
      ],
      "best_platform": "<platforma>", "best_platform_reason": "<max 120 znakov>", "cross_platform_strategy": "<8 strategij>", "strategy_reasoning": "<max 150 znakov>", "expected_total_revenue_eur": <number>, "expected_total_net_revenue_eur": <number>
    }
  ],
  "platforms": [
    { "platform": "<5 platform>", "items_recommended": <number>, "avg_performance_score": <number 0-100>, "fee_pct": <number>, "avg_reach": "<local|national|international>", "best_for_category": "<max 80 znakov>", "avg_expected_revenue_eur": <number>, "avg_net_revenue_eur": <number>, "competitive_density": "<low|medium|high>" }
  ],
  "sync_strategy": [
    { "strategy": "<8 strategij>", "description": "<max 120 znakov>", "best_for_category": "<max 80 znakov>", "implementation_difficulty": "<low|medium|high>", "expected_revenue_increase_pct": <number>, "conflict_risk": "<low|medium|high>" }
  ],
  "conflicts": [
    { "conflict_type": "<price_mismatch|double_sale|description_conflict|platform_violation>", "description": "<max 120 znakov>", "affected_platforms": ["<platforma>"], "severity": "<low|medium|high>", "resolution": "<max 150 znakov>" }
  ],
  "performance": [
    { "metric": "<total_revenue|total_net_revenue|total_fees|avg_views|avg_inquiries|cross_platform_efficiency>", "current_value": <number>, "optimized_value": <number>, "improvement_pct": <number> }
  ],
  "summary": {
    "total_listings_optimized": <number>, "total_platforms_used": <number>, "avg_items_per_platform": <number>, "total_expected_revenue_eur": <number>, "total_expected_net_revenue_eur": <number>, "total_expected_fees_eur": <number>, "best_platform_overall": "<max 80 znakov>", "best_sync_strategy": "<8 strategij>", "biggest_cross_platform_opportunity": "<max 100 znakov>", "cross_platform_optimization_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); }
      else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const validIds = new Set(items.map(i => i.id));

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      listings: (parsed?.listings || []).filter((l: any) => validIds.has(String(l?.id ?? ''))).slice(0, 15).map((l: any) => ({
        tradeId: String(l?.id ?? ''), title: String(l?.title ?? '').slice(0, 150),
        platformConfigs: (l?.platform_configs || []).filter((p: any) => PLATFORMS.includes(String(p?.platform) as any)).slice(0, 5).map((p: any) => ({
          platform: PLATFORMS.includes(String(p?.platform) as any) ? String(p.platform) : 'bolha',
          title: String(p?.title ?? '').slice(0, 120), description: String(p?.description ?? '').slice(0, 500),
          priceEur: Math.max(0, Math.round(Number(p?.price_eur ?? 0))), tags: (p?.tags || []).slice(0, 10).map((t: any) => String(t).slice(0, 50)),
          language: ['sl', 'en', 'de'].includes(String(p?.language)) ? String(p.language) : 'sl', cta: String(p?.cta ?? '').slice(0, 150),
          expectedViewsPerWeek: Math.max(0, Math.round(Number(p?.expected_views_per_week ?? 0))),
          expectedInquiriesPerWeek: Math.max(0, Math.round(Number(p?.expected_inquiries_per_week ?? 0))),
          feePct: Math.round(Number(p?.fee_pct ?? 0)), netRevenueEur: Math.round(Number(p?.net_revenue_eur ?? 0)),
          performanceScore: Math.max(0, Math.min(100, Number(p?.performance_score ?? 50))), recommended: Boolean(p?.recommended ?? false),
        })),
        bestPlatform: PLATFORMS.includes(String(l?.best_platform) as any) ? String(l.best_platform) : 'bolha',
        bestPlatformReason: String(l?.best_platform_reason ?? '').slice(0, 250),
        crossPlatformStrategy: SYNC_STRATEGIES.includes(String(l?.cross_platform_strategy) as any) ? String(l.cross_platform_strategy) : 'cross_post',
        strategyReasoning: String(l?.strategy_reasoning ?? '').slice(0, 300),
        expectedTotalRevenueEur: Math.round(Number(l?.expected_total_revenue_eur ?? 0)),
        expectedTotalNetRevenueEur: Math.round(Number(l?.expected_total_net_revenue_eur ?? 0)),
      })),
      platforms: (parsed?.platforms || []).filter((p: any) => PLATFORMS.includes(String(p?.platform) as any)).slice(0, 5).map((p: any) => ({
        platform: PLATFORMS.includes(String(p?.platform) as any) ? String(p.platform) : 'bolha',
        itemsRecommended: Math.max(0, Number(p?.items_recommended ?? 0)),
        avgPerformanceScore: Math.max(0, Math.min(100, Number(p?.avg_performance_score ?? 50))),
        feePct: Math.round(Number(p?.fee_pct ?? 0)), avgReach: ['local', 'national', 'international'].includes(String(p?.avg_reach)) ? String(p.avg_reach) : 'local',
        bestForCategory: String(p?.best_for_category ?? '').slice(0, 150),
        avgExpectedRevenueEur: Math.round(Number(p?.avg_expected_revenue_eur ?? 0)),
        avgNetRevenueEur: Math.round(Number(p?.avg_net_revenue_eur ?? 0)),
        competitiveDensity: ['low', 'medium', 'high'].includes(String(p?.competitive_density)) ? String(p.competitive_density) : 'medium',
      })),
      syncStrategy: (parsed?.sync_strategy || []).slice(0, 8).map((s: any) => ({
        strategy: SYNC_STRATEGIES.includes(String(s?.strategy) as any) ? String(s.strategy) : 'cross_post',
        description: String(s?.description ?? '').slice(0, 250), bestForCategory: String(s?.best_for_category ?? '').slice(0, 150),
        implementationDifficulty: ['low', 'medium', 'high'].includes(String(s?.implementation_difficulty)) ? String(s.implementation_difficulty) : 'medium',
        expectedRevenueIncreasePct: Math.round(Number(s?.expected_revenue_increase_pct ?? 0)),
        conflictRisk: ['low', 'medium', 'high'].includes(String(s?.conflict_risk)) ? String(s.conflict_risk) : 'low',
      })),
      conflicts: (parsed?.conflicts || []).slice(0, 5).map((c: any) => ({
        conflictType: ['price_mismatch', 'double_sale', 'description_conflict', 'platform_violation'].includes(String(c?.conflict_type)) ? String(c.conflict_type) : 'price_mismatch',
        description: String(c?.description ?? '').slice(0, 250), affectedPlatforms: (c?.affected_platforms || []).slice(0, 5).map((p: any) => String(p).slice(0, 30)),
        severity: ['low', 'medium', 'high'].includes(String(c?.severity)) ? String(c.severity) : 'medium',
        resolution: String(c?.resolution ?? '').slice(0, 300),
      })),
      performance: (parsed?.performance || []).slice(0, 6).map((p: any) => ({
        metric: ['total_revenue', 'total_net_revenue', 'total_fees', 'avg_views', 'avg_inquiries', 'cross_platform_efficiency'].includes(String(p?.metric)) ? String(p.metric) : 'total_revenue',
        currentValue: Math.round(Number(p?.current_value ?? 0) * 100) / 100, optimizedValue: Math.round(Number(p?.optimized_value ?? 0) * 100) / 100,
        improvementPct: Math.round(Number(p?.improvement_pct ?? 0) * 10) / 10,
      })),
      summary: {
        totalListingsOptimized: items.length, totalPlatformsUsed: Math.max(0, Number(parsed?.summary?.total_platforms_used ?? 5)),
        avgItemsPerPlatform: Math.round(Number(parsed?.summary?.avg_items_per_platform ?? 0) * 10) / 10,
        totalExpectedRevenueEur: Math.round(Number(parsed?.summary?.total_expected_revenue_eur ?? 0)),
        totalExpectedNetRevenueEur: Math.round(Number(parsed?.summary?.total_expected_net_revenue_eur ?? 0)),
        totalExpectedFeesEur: Math.round(Number(parsed?.summary?.total_expected_fees_eur ?? 0)),
        bestPlatformOverall: PLATFORMS.includes(String(parsed?.summary?.best_platform_overall) as any) ? String(parsed.summary.best_platform_overall) : 'bolha',
        bestSyncStrategy: SYNC_STRATEGIES.includes(String(parsed?.summary?.best_sync_strategy) as any) ? String(parsed.summary.best_sync_strategy) : 'cross_post',
        biggestCrossPlatformOpportunity: String(parsed?.summary?.biggest_cross_platform_opportunity ?? '').slice(0, 200),
        crossPlatformOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.cross_platform_optimization_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { logger.error("/api/ai/listing-cross-platform-optimizer", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
