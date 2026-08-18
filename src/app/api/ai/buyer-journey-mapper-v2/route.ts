/**
 * @deprecated v8.94 — uporabi `/api/ai/buyer-journey-mapper` namesto tega.
 * v2 je poenostavljena verzija — v1 (brez suffix-a) je bolj feature-rich.
 * Ta endpoint bo odstranjen v v9.0. Glej ENDPOINTS_AUDIT.md za migracijski načrt.
 */
// v6.84: AI Buyer Journey Mapper v2 — ML mapiranje buyer journey z omnichannel touchpoints
// POST /api/ai/buyer-journey-mapper-v2
// Body: { customerName?: string }
// Returns: { ok, mapper: { overview, journeyStages, touchpoints, channelAnalysis, optimization, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const JOURNEY_STAGES = ['awareness', 'consideration', 'intent', 'evaluation', 'purchase', 'onboarding', 'retention', 'advocacy'] as const;
const TOUCHPOINT_TYPES = ['social_media_ad', 'search_result', 'marketplace_listing', 'email_campaign', 'word_of_mouth', 'influencer_referral', 'direct_visit', 'retargeting_ad', 'forum_discussion', 'comparison_site'] as const;
const CHANNEL_TYPES = ['bolha', 'facebook', 'vinted', 'avtonet', 'kleinanzeigen', 'email', 'website', 'phone', 'whatsapp', 'in_person'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true, buyLocation: true }, take: 500, orderBy: { sellDate: 'desc' } });
    if (soldTrades.length === 0) return NextResponse.json({ ok: true, mapper: null, message: 'Ni prodaj za journey mapping.' });

    const buyerMap = new Map<string, { name: string; purchases: number; totalSpent: number; avgOrder: number; firstPurchase: Date | null; lastPurchase: Date | null; categories: Set<string>; buyLocations: Set<string>; daysSinceLast: number }>();
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2 || !t.sellDate) continue;
      const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, firstPurchase: t.sellDate, lastPurchase: t.sellDate, categories: new Set(), buyLocations: new Set(), daysSinceLast: 0 });
      const b = buyerMap.get(name)!;
      b.purchases += 1; b.totalSpent += rev;
      if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate;
      if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
      if (t.category) b.categories.add(t.category);
      if (t.buyLocation) b.buyLocations.add(t.buyLocation);
    }
    const buyers = Array.from(buyerMap.values()).map(b => { b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0; b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / DAY) : 999; return b; });
    if (customerName) { const f = buyers.filter(b => b.name === customerName); if (f.length === 0) return NextResponse.json({ ok: true, mapper: null, message: `Kupec "${customerName}" ni najden.` }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d | ${b.categories.size} kat | channels: ${Array.from(b.buyLocations).slice(0, 3).join(',')}`).join('\n');

    const prompt = `Si AI buyer journey mapper v2 z ML in omnichannel touchpoint analysis.
Mapira buyer journey z 8 stadiji, 10 touchpointi in 10 kanali.

KUPCI (${targetBuyers.length}):
${buyersStr}

8 stadijev journey:
1. AWARENESS: zavedanje
2. CONSIDERATION: premisleka
3. INTENT: namen
4. EVALUATION: ocenjevanje
5. PURCHASE: nakup
6. ONBOARDING: uvod
7. RETENTION: zadrževanje
8. ADVOCACY: zagovorništvo

10 touchpointov: social_media_ad, search_result, marketplace_listing, email_campaign, word_of_mouth, influencer_referral, direct_visit, retargeting_ad, forum_discussion, comparison_site

10 kanalov: bolha, facebook, vinted, avtonet, kleinanzeigen, email, website, phone, whatsapp, in_person

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_buyers": <number>, "avg_journey_length_days": <number>, "avg_touchpoints_per_journey": <number>, "avg_conversion_rate_pct": <number 0-100>, "journey_completion_rate_pct": <number 0-100>, "journey_grade": "<A|B|C|D|F>" },
  "journeyStages": [
    { "stage": "<${JOURNEY_STAGES.join('|')}>", "buyer_count": <number>, "stage_completion_pct": <number 0-100>, "avg_time_in_stage_days": <number>, "drop_off_pct": <number 0-100>, "key_actions": "<max 150 znakov>", "optimization_opportunity": "<max 120 znakov>" }
  ],
  "touchpoints": [
    { "touchpoint_type": "<${TOUCHPOINT_TYPES.join('|')}>", "buyer_reach_pct": <number 0-100>, "conversion_contribution_pct": <number 0-100>, "avg_engagement_score": <number 0-100>, "cost_per_touchpoint_eur": <number>, "revenue_attributed_eur": <number>, "roi_pct": <number> }
  ],
  "channelAnalysis": [
    { "channel": "<${CHANNEL_TYPES.join('|')}>", "buyer_count": <number>, "revenue_eur": <number>, "revenue_pct": <number 0-100>, "avg_order_value_eur": <number>, "conversion_rate_pct": <number 0-100>, "cost_per_acquisition_eur": <number>, "channel_efficiency_score": <number 0-100> }
  ],
  "optimization": [
    { "action": "<max 150 znakov>", "target_stage": "<${JOURNEY_STAGES.join('|')}>", "expected_conversion_lift_pct": <number 0-50>, "expected_revenue_lift_eur": <number>, "implementation_days": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<markov_chain|lstm|bert|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<journey_prediction|touchpoint_attribution|conversion_forecast|drop_off_prediction>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "journey_mapping_score": <number 0-100>, "journey_grade": "<A|B|C|D|F>", "total_journey_revenue_eur": <number>,
    "biggest_drop_off_stage": "<${JOURNEY_STAGES.join('|')}>", "best_performing_channel": "<${CHANNEL_TYPES.join('|')}>",
    "biggest_journey_risk": "<max 100 znakov>", "biggest_journey_opportunity": "<max 100 znakov>",
    "quickest_journey_win": "<max 100 znakov>", "journey_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const mapper = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      overview: { totalBuyers: Math.max(0, Number(parsed?.overview?.total_buyers ?? targetBuyers.length)), avgJourneyLengthDays: Math.max(0, Number(parsed?.overview?.avg_journey_length_days ?? 30)), avgTouchpointsPerJourney: Math.max(0, Number(parsed?.overview?.avg_touchpoints_per_journey ?? 5)), avgConversionRatePct: Math.max(0, Math.min(100, Number(parsed?.overview?.avg_conversion_rate_pct ?? 30))), journeyCompletionRatePct: Math.max(0, Math.min(100, Number(parsed?.overview?.journey_completion_rate_pct ?? 60))), journeyGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.journey_grade)) ? String(parsed.overview.journey_grade) : 'C' },
      journeyStages: (parsed?.journeyStages || []).slice(0, 8).map((s: any) => ({ stage: (JOURNEY_STAGES as readonly string[]).includes(String(s?.stage)) ? String(s.stage) : 'awareness', buyerCount: Math.max(0, Number(s?.buyer_count ?? 0)), stageCompletionPct: Math.max(0, Math.min(100, Number(s?.stage_completion_pct ?? 70))), avgTimeInStageDays: Math.max(0, Number(s?.avg_time_in_stage_days ?? 7)), dropOffPct: Math.max(0, Math.min(100, Number(s?.drop_off_pct ?? 30))), keyActions: String(s?.key_actions ?? '').slice(0, 300), optimizationOpportunity: String(s?.optimization_opportunity ?? '').slice(0, 250) })),
      touchpoints: (parsed?.touchpoints || []).slice(0, 10).map((t: any) => ({ touchpointType: (TOUCHPOINT_TYPES as readonly string[]).includes(String(t?.touchpoint_type)) ? String(t.touchpoint_type) : 'marketplace_listing', buyerReachPct: Math.max(0, Math.min(100, Number(t?.buyer_reach_pct ?? 50))), conversionContributionPct: Math.max(0, Math.min(100, Number(t?.conversion_contribution_pct ?? 20))), avgEngagementScore: Math.max(0, Math.min(100, Number(t?.avg_engagement_score ?? 50))), costPerTouchpointEur: Math.round(Number(t?.cost_per_touchpoint_eur ?? 0) * 100) / 100, revenueAttributedEur: Math.round(Number(t?.revenue_attributed_eur ?? 0)), roiPct: Math.round(Number(t?.roi_pct ?? 0) * 10) / 10 })),
      channelAnalysis: (parsed?.channelAnalysis || []).slice(0, 10).map((c: any) => ({ channel: (CHANNEL_TYPES as readonly string[]).includes(String(c?.channel)) ? String(c.channel) : 'bolha', buyerCount: Math.max(0, Number(c?.buyer_count ?? 0)), revenueEur: Math.round(Number(c?.revenue_eur ?? 0)), revenuePct: Math.max(0, Math.min(100, Number(c?.revenue_pct ?? 0))), avgOrderValueEur: Math.round(Number(c?.avg_order_value_eur ?? 0)), conversionRatePct: Math.max(0, Math.min(100, Number(c?.conversion_rate_pct ?? 30))), costPerAcquisitionEur: Math.round(Number(c?.cost_per_acquisition_eur ?? 0)), channelEfficiencyScore: Math.max(0, Math.min(100, Number(c?.channel_efficiency_score ?? 50))) })),
      optimization: (parsed?.optimization || []).slice(0, 8).map((o: any) => ({ action: String(o?.action ?? '').slice(0, 300), targetStage: (JOURNEY_STAGES as readonly string[]).includes(String(o?.target_stage)) ? String(o.target_stage) : 'consideration', expectedConversionLiftPct: Math.max(0, Math.min(50, Number(o?.expected_conversion_lift_pct ?? 10))), expectedRevenueLiftEur: Math.round(Number(o?.expected_revenue_lift_eur ?? 0)), implementationDays: Math.max(1, Number(o?.implementation_days ?? 7)), priority: ['high', 'medium', 'low'].includes(String(o?.priority)) ? String(o.priority) : 'medium' })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['markov_chain', 'lstm', 'bert', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['journey_prediction', 'touchpoint_attribution', 'conversion_forecast', 'drop_off_prediction'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'journey_prediction', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { journeyMappingScore: Math.max(0, Math.min(100, Number(parsed?.summary?.journey_mapping_score ?? 50))), journeyGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.journey_grade)) ? String(parsed.summary.journey_grade) : 'C', totalJourneyRevenueEur: Math.round(Number(parsed?.summary?.total_journey_revenue_eur ?? 0)), biggestDropOffStage: (JOURNEY_STAGES as readonly string[]).includes(String(parsed?.summary?.biggest_drop_off_stage)) ? String(parsed.summary.biggest_drop_off_stage) : 'consideration', bestPerformingChannel: (CHANNEL_TYPES as readonly string[]).includes(String(parsed?.summary?.best_performing_channel)) ? String(parsed.summary.best_performing_channel) : 'bolha', biggestJourneyRisk: String(parsed?.summary?.biggest_journey_risk ?? '').slice(0, 200), biggestJourneyOpportunity: String(parsed?.summary?.biggest_journey_opportunity ?? '').slice(0, 200), quickestJourneyWin: String(parsed?.summary?.quickest_journey_win ?? '').slice(0, 200), journeyAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.journey_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, mapper });
  } catch (e: any) { logger.error("/api/ai/buyer-journey-mapper-v2", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
