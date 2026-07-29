// v6.87: AI Listing Audience Targeting — ML optimizacija ciljanja publike za oglase
// POST /api/ai/listing-audience-targeting
// Body: { tradeId?: string }
// Returns: { ok, optimizer: { listing, audienceSegments, targetingStrategy, channelMix, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const AUDIENCE_SEGMENTS = ['bargain_hunters', 'collectors', 'resellers', 'enthusiasts', 'first_time_buyers', 'business_buyers', 'gift_shoppers', 'luxury_buyers', 'vintage_lovers', 'tech_early_adopters'] as const;
const TARGETING_CHANNELS = ['facebook_marketplace', 'bolha_targeted', 'vinted_promoted', 'google_ads', 'instagram_shopping', 'tiktok_shop', 'email_campaign', 'whatsapp_broadcast', 'forum_posting', 'influencer_collab'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId).trim() : null;

    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyDate: true, buyLocation: true, notes: true, listingId: true }, take: 200, orderBy: { buyDate: 'desc' } });
    if (heldTrades.length === 0) return NextResponse.json({ ok: true, optimizer: null, message: 'Ni aktivnih oglasov za audience targeting analizo.' });

    const target = heldTrades.find(t => t.id === tradeId) ?? heldTrades[0];
    const targetListing = target.listingId ? await db.listing.findUnique({ where: { id: target.listingId }, select: { aiEstimatedValue: true, aiRisk: true, url: true } }) : null;
    const suggestedPrice = targetListing?.aiEstimatedValue ?? Math.round(target.buyPrice * 1.25);

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const prompt = `Si AI listing audience targeting optimizer z ML in demographic analysis.
Optimizira ciljanje publike z 10 segmenti in 10 kanali.

CILJNI OGLAS:
- Naslov: ${target.title}
- Kategorija: ${target.category}
- Nabavna cena: ${target.buyPrice}€
- Predlagana cena: ${suggestedPrice}€
- Kupljeno pri: ${target.buyLocation}

10 segmentske publike:
1. BARGAIN_HUNTERS: iščejo ugodne cene
2. COLLECTORS: zbiratelji
3. RESELLERS: preprodajalci
4. ENTHUSIASTS: navdušenci
5. FIRST_TIME_BUYERS: prvi kupci
6. BUSINESS_BUYERS: poslovni kupci
7. GIFT_SHOPPERS: kupci daril
8. LUXURY_BUYERS: luksuzni kupci
9. VINTAGE_LOVERS: ljubitelji vintage
10. TECH_EARLY_ADOPTERS: tehnološki navdušenci

10 kanalov ciljanja: facebook_marketplace, bolha_targeted, vinted_promoted, google_ads, instagram_shopping, tiktok_shop, email_campaign, whatsapp_broadcast, forum_posting, influencer_collab

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listing": { "title": "<string>", "category": "<string>", "current_reach_estimate": <number>, "optimized_reach_estimate": <number>, "current_conversion_pct": <number 0-100>, "optimized_conversion_pct": <number 0-100>, "targeting_grade": "<A|B|C|D|F>" },
  "audienceSegments": [
    { "segment": "<${AUDIENCE_SEGMENTS.join('|')}>", "match_score": <number 0-100>, "estimated_audience_size": <number>, "estimated_conversion_rate_pct": <number 0-100>, "avg_order_value_eur": <number>, "competition_level": "<low|medium|high>", "priority": "<primary|secondary|tertiary>" }
  ],
  "targetingStrategy": [
    { "segment": "<${AUDIENCE_SEGMENTS.join('|')}>", "strategy": "<max 150 znakov>", "key_message": "<max 120 znakov>", "best_time_to_post": "<morning|afternoon|evening|night>", "best_day": "<weekday|weekend|any>", "estimated_cpc_eur": <number>, "expected_ctr_pct": <number 0-100> }
  ],
  "channelMix": [
    { "channel": "<${TARGETING_CHANNELS.join('|')}>", "audience_fit_pct": <number 0-100>, "estimated_reach": <number>, "estimated_cost_eur": <number>, "expected_conversions": <number>, "expected_revenue_eur": <number>, "roi_pct": <number>, "recommended_budget_pct": <number 0-100> }
  ],
  "mlModels": [
    { "model": "<random_forest|xgboost|neural_net|k-means|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<audience_classification|conversion_prediction|reach_forecast|channel_optimization>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "audience_targeting_score": <number 0-100>, "targeting_grade": "<A|B|C|D|F>", "total_estimated_reach": <number>,
    "primary_segment": "<${AUDIENCE_SEGMENTS.join('|')}>", "expected_total_revenue_eur": <number>,
    "biggest_targeting_risk": "<max 100 znakov>", "biggest_targeting_opportunity": "<max 100 znakov>",
    "quickest_targeting_win": "<max 100 znakov>", "audience_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      listing: { title: String(parsed?.listing?.title ?? target.title).slice(0, 200), category: String(parsed?.listing?.category ?? target.category).slice(0, 50), currentReachEstimate: Math.max(0, Number(parsed?.listing?.current_reach_estimate ?? 500)), optimizedReachEstimate: Math.max(0, Number(parsed?.listing?.optimized_reach_estimate ?? 2500)), currentConversionPct: Math.max(0, Math.min(100, Number(parsed?.listing?.current_conversion_pct ?? 3))), optimizedConversionPct: Math.max(0, Math.min(100, Number(parsed?.listing?.optimized_conversion_pct ?? 7))), targetingGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.listing?.targeting_grade)) ? String(parsed.listing.targeting_grade) : 'C' },
      audienceSegments: (parsed?.audienceSegments || []).slice(0, 10).map((s: any) => ({ segment: (AUDIENCE_SEGMENTS as readonly string[]).includes(String(s?.segment)) ? String(s.segment) : 'bargain_hunters', matchScore: Math.max(0, Math.min(100, Number(s?.match_score ?? 50))), estimatedAudienceSize: Math.max(0, Number(s?.estimated_audience_size ?? 0)), estimatedConversionRatePct: Math.max(0, Math.min(100, Number(s?.estimated_conversion_rate_pct ?? 5))), avgOrderValueEur: Math.round(Number(s?.avg_order_value_eur ?? 0)), competitionLevel: ['low', 'medium', 'high'].includes(String(s?.competition_level)) ? String(s.competition_level) : 'medium', priority: ['primary', 'secondary', 'tertiary'].includes(String(s?.priority)) ? String(s.priority) : 'secondary' })),
      targetingStrategy: (parsed?.targetingStrategy || []).slice(0, 10).map((s: any) => ({ segment: (AUDIENCE_SEGMENTS as readonly string[]).includes(String(s?.segment)) ? String(s.segment) : 'bargain_hunters', strategy: String(s?.strategy ?? '').slice(0, 300), keyMessage: String(s?.key_message ?? '').slice(0, 250), bestTimeToPost: ['morning', 'afternoon', 'evening', 'night'].includes(String(s?.best_time_to_post)) ? String(s.best_time_to_post) : 'evening', bestDay: ['weekday', 'weekend', 'any'].includes(String(s?.best_day)) ? String(s.best_day) : 'weekend', estimatedCpcEur: Math.round(Number(s?.estimated_cpc_eur ?? 0) * 100) / 100, expectedCtrPct: Math.max(0, Math.min(100, Number(s?.expected_ctr_pct ?? 3))) })),
      channelMix: (parsed?.channelMix || []).slice(0, 10).map((c: any) => ({ channel: (TARGETING_CHANNELS as readonly string[]).includes(String(c?.channel)) ? String(c.channel) : 'facebook_marketplace', audienceFitPct: Math.max(0, Math.min(100, Number(c?.audience_fit_pct ?? 50))), estimatedReach: Math.max(0, Number(c?.estimated_reach ?? 0)), estimatedCostEur: Math.round(Number(c?.estimated_cost_eur ?? 0)), expectedConversions: Math.max(0, Number(c?.expected_conversions ?? 0)), expectedRevenueEur: Math.round(Number(c?.expected_revenue_eur ?? 0)), roiPct: Math.round(Number(c?.roi_pct ?? 0) * 10) / 10, recommendedBudgetPct: Math.max(0, Math.min(100, Number(c?.recommended_budget_pct ?? 10))) })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['random_forest', 'xgboost', 'neural_net', 'k-means', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['audience_classification', 'conversion_prediction', 'reach_forecast', 'channel_optimization'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'audience_classification', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { audienceTargetingScore: Math.max(0, Math.min(100, Number(parsed?.summary?.audience_targeting_score ?? 50))), targetingGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.targeting_grade)) ? String(parsed.summary.targeting_grade) : 'C', totalEstimatedReach: Math.max(0, Number(parsed?.summary?.total_estimated_reach ?? 0)), primarySegment: (AUDIENCE_SEGMENTS as readonly string[]).includes(String(parsed?.summary?.primary_segment)) ? String(parsed.summary.primary_segment) : 'bargain_hunters', expectedTotalRevenueEur: Math.round(Number(parsed?.summary?.expected_total_revenue_eur ?? 0)), biggestTargetingRisk: String(parsed?.summary?.biggest_targeting_risk ?? '').slice(0, 200), biggestTargetingOpportunity: String(parsed?.summary?.biggest_targeting_opportunity ?? '').slice(0, 200), quickestTargetingWin: String(parsed?.summary?.quickest_targeting_win ?? '').slice(0, 200), audienceAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.audience_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
