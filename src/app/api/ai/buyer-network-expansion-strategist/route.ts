// v6.72: AI Buyer Network Expansion Strategist — širi mrežo kupcev z ML in network analysis
// POST /api/ai/buyer-network-expansion-strategist
// Body: { monthsAhead?: number }
// Returns: { ok, strategist: { current, expansion, channels, campaigns, mlModels, projections, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const EXPANSION_STRATEGIES = ['referral_program', 'social_media_outreach', 'cross_platform_expansion', 'bundle_attract_new', 'seasonal_campaign', 'local_community', 'niche_targeting', 'partnership_leverage', 'content_marketing', 'flash_sale_attraction'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const monthsAhead = Math.max(1, Math.min(12, Number(body?.monthsAhead ?? 6)));

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true }, take: 500, orderBy: { sellDate: 'desc' } });
    if (soldTrades.length === 0) return NextResponse.json({ ok: true, strategist: null, message: 'Ni prodaj za network expansion analizo.' });

    const buyerMap = new Map<string, { name: string; purchases: number; totalSpent: number }>();
    for (const t of soldTrades) { const name = (t.sellLocation || '').trim(); if (!name || name.length < 2) continue; const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0); if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0 }); const b = buyerMap.get(name)!; b.purchases += 1; b.totalSpent += rev; }
    const totalBuyers = buyerMap.size;
    const repeatBuyers = Array.from(buyerMap.values()).filter(b => b.purchases >= 2).length;
    const avgBuyerValue = Math.round(Array.from(buyerMap.values()).reduce((s, b) => s + b.totalSpent, 0) / Math.max(1, totalBuyers));

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const prompt = `Si AI buyer network expansion strategist z ML in network analysis.
Širi mrežo kupcev za ${monthsAhead} mesecev.

STATS:
- Skupno kupcev: ${totalBuyers}
- Repeat kupci: ${repeatBuyers}
- Povp vrednost kupca: ${avgBuyerValue}€

10 expansion strategij:
1. REFERRAL_PROGRAM: priporočila obstoječih kupcev
2. SOCIAL_MEDIA_OUTREACH: socialni mediji za nove kupce
3. CROSS_PLATFORM_EXPANSION: širitev na nove platforme
4. BUNDLE_ATTRACT_NEW: bundle ki privabi nove kupce
5. SEASONAL_CAMPAIGN: sezonske kampanje za nove kupce
6. LOCAL_COMMUNITY: lokalna skupnost, dogodki
7. NICHE_TARGETING: ciljanje niche publike
8. PARTNERSHIP_LEVERAGE: partnerstva za nove kupce
9. CONTENT_MARKETING: vsebinski marketing
10. FLASH_SALE_ATTRACTION: flash sale za nove kupce

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": { "total_buyers": <number>, "repeat_buyers": <number>, "repeat_rate_pct": <number 0-100>, "avg_buyer_value_eur": <number>, "network_density_score": <number 0-100>, "growth_rate_pct": <number> },
  "expansion": [
    { "strategy": "<10 strategij>", "description": "<max 120 znakov>", "target_new_buyers": <number>, "expected_revenue_eur": <number>, "implementation_cost_eur": <number>, "timeframe_days": <number>, "expected_roi_pct": <number>, "difficulty": "<low|medium|high>", "priority": "<high|medium|low>" }
  ],
  "channels": [
    { "channel": "<bolha|facebook|vinted|ebay|kleinanzeigen|instagram|telegram|local|email|sms>", "current_buyer_count": <number>, "potential_new_buyers": <number>, "expansion_difficulty": "<low|medium|high>", "avg_acquisition_cost_eur": <number>, "expected_conversion_pct": <number 0-100>, "best_strategy": "<10 strategij>" }
  ],
  "campaigns": [
    { "campaign_name": "<max 80 znakov>", "strategy": "<10 strategij>", "target_audience": "<max 80 znakov>", "description": "<max 120 znakov>", "channel": "<channel>", "duration_days": <number>, "expected_new_buyers": <number>, "expected_revenue_eur": <number>, "cost_eur": <number>, "roi_pct": <number> }
  ],
  "mlModels": [
    { "model": "<random_forest|gradient_boosting|lstm|neural_network|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<buyer_acquisition|revenue_forecast|channel_performance|network_growth>", "weight_in_ensemble": <number 0-100> }
  ],
  "projections": [
    { "month": <1-12>, "projected_new_buyers": <number>, "projected_total_buyers": <number>, "projected_revenue_eur": <number>, "projected_cost_eur": <number>, "net_profit_eur": <number>, "cumulative_new_buyers": <number> }
  ],
  "summary": {
    "total_potential_new_buyers": <number>, "total_expected_revenue_eur": <number>, "total_expected_cost_eur": <number>,
    "expected_net_profit_eur": <number>, "expected_roi_pct": <number>,
    "best_expansion_strategy": "<10 strategij>", "biggest_expansion_opportunity": "<max 100 znakov>",
    "quickest_expansion_win": "<max 100 znakov>", "network_expansion_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const strategist = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      current: { totalBuyers: Math.max(0, Number(parsed?.current?.total_buyers ?? totalBuyers)), repeatBuyers: Math.max(0, Number(parsed?.current?.repeat_buyers ?? repeatBuyers)), repeatRatePct: Math.max(0, Math.min(100, Number(parsed?.current?.repeat_rate_pct ?? 30))), avgBuyerValueEur: Math.round(Number(parsed?.current?.avg_buyer_value_eur ?? avgBuyerValue)), networkDensityScore: Math.max(0, Math.min(100, Number(parsed?.current?.network_density_score ?? 40))), growthRatePct: Math.round(Number(parsed?.current?.growth_rate_pct ?? 0) * 10) / 10 },
      expansion: (parsed?.expansion || []).slice(0, 10).map((e: any) => ({ strategy: EXPANSION_STRATEGIES.includes(String(e?.strategy) as any) ? String(e.strategy) : 'referral_program', description: String(e?.description ?? '').slice(0, 250), targetNewBuyers: Math.max(0, Number(e?.target_new_buyers ?? 0)), expectedRevenueEur: Math.round(Number(e?.expected_revenue_eur ?? 0)), implementationCostEur: Math.round(Number(e?.implementation_cost_eur ?? 0)), timeframeDays: Math.max(1, Number(e?.timeframe_days ?? 7)), expectedRoiPct: Math.round(Number(e?.expected_roi_pct ?? 0) * 10) / 10, difficulty: ['low', 'medium', 'high'].includes(String(e?.difficulty)) ? String(e.difficulty) : 'medium', priority: ['high', 'medium', 'low'].includes(String(e?.priority)) ? String(e.priority) : 'medium' })),
      channels: (parsed?.channels || []).slice(0, 10).map((c: any) => ({ channel: ['bolha', 'facebook', 'vinted', 'ebay', 'kleinanzeigen', 'instagram', 'telegram', 'local', 'email', 'sms'].includes(String(c?.channel)) ? String(c.channel) : 'bolha', currentBuyerCount: Math.max(0, Number(c?.current_buyer_count ?? 0)), potentialNewBuyers: Math.max(0, Number(c?.potential_new_buyers ?? 0)), expansionDifficulty: ['low', 'medium', 'high'].includes(String(c?.expansion_difficulty)) ? String(c.expansion_difficulty) : 'medium', avgAcquisitionCostEur: Math.round(Number(c?.avg_acquisition_cost_eur ?? 0) * 100) / 100, expectedConversionPct: Math.max(0, Math.min(100, Number(c?.expected_conversion_pct ?? 20))), bestStrategy: EXPANSION_STRATEGIES.includes(String(c?.best_strategy) as any) ? String(c.best_strategy) : 'referral_program' })),
      campaigns: (parsed?.campaigns || []).slice(0, 6).map((c: any) => ({ campaignName: String(c?.campaign_name ?? '').slice(0, 150), strategy: EXPANSION_STRATEGIES.includes(String(c?.strategy) as any) ? String(c.strategy) : 'referral_program', targetAudience: String(c?.target_audience ?? '').slice(0, 150), description: String(c?.description ?? '').slice(0, 250), channel: String(c?.channel ?? 'bolha').slice(0, 30), durationDays: Math.max(1, Number(c?.duration_days ?? 7)), expectedNewBuyers: Math.max(0, Number(c?.expected_new_buyers ?? 0)), expectedRevenueEur: Math.round(Number(c?.expected_revenue_eur ?? 0)), costEur: Math.round(Number(c?.cost_eur ?? 0)), roiPct: Math.round(Number(c?.roi_pct ?? 0) * 10) / 10 })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['random_forest', 'gradient_boosting', 'lstm', 'neural_network', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))), predictionType: ['buyer_acquisition', 'revenue_forecast', 'channel_performance', 'network_growth'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'buyer_acquisition', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      projections: (parsed?.projections || []).slice(0, monthsAhead).map((p: any) => ({ month: Math.max(1, Math.min(12, Number(p?.month ?? 1))), projectedNewBuyers: Math.max(0, Number(p?.projected_new_buyers ?? 0)), projectedTotalBuyers: Math.max(0, Number(p?.projected_total_buyers ?? 0)), projectedRevenueEur: Math.round(Number(p?.projected_revenue_eur ?? 0)), projectedCostEur: Math.round(Number(p?.projected_cost_eur ?? 0)), netProfitEur: Math.round(Number(p?.net_profit_eur ?? 0)), cumulativeNewBuyers: Math.max(0, Number(p?.cumulative_new_buyers ?? 0)) })),
      summary: { totalPotentialNewBuyers: Math.max(0, Number(parsed?.summary?.total_potential_new_buyers ?? 0)), totalExpectedRevenueEur: Math.round(Number(parsed?.summary?.total_expected_revenue_eur ?? 0)), totalExpectedCostEur: Math.round(Number(parsed?.summary?.total_expected_cost_eur ?? 0)), expectedNetProfitEur: Math.round(Number(parsed?.summary?.expected_net_profit_eur ?? 0)), expectedRoiPct: Math.round(Number(parsed?.summary?.expected_roi_pct ?? 0) * 10) / 10, bestExpansionStrategy: EXPANSION_STRATEGIES.includes(String(parsed?.summary?.best_expansion_strategy) as any) ? String(parsed.summary.best_expansion_strategy) : 'referral_program', biggestExpansionOpportunity: String(parsed?.summary?.biggest_expansion_opportunity ?? '').slice(0, 200), quickestExpansionWin: String(parsed?.summary?.quickest_expansion_win ?? '').slice(0, 200), networkExpansionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.network_expansion_score ?? 60))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, strategist });
  } catch (e: any) { logger.error("/api/ai/buyer-network-expansion-strategist", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
