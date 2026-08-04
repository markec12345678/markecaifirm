// v6.66: AI Buyer Win-Back Campaign Designer — oblikuje win-back kampanje z ML in multi-touch
// POST /api/ai/buyer-win-back-campaign-designer
// Body: { monthsAhead?: number }
// Returns: { ok, designer: { campaigns, segments, messages, channels, timeline, projections, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const CAMPAIGN_TYPES = ['reactivation_discount', 'we_miss_you', 'new_arrival_alert', 'exclusive_preview', 'bundle_offer', 'loyalty_reward', 'feedback_request', 'last_chance'] as const;
const SEGMENT_TYPES = ['dormant_30d', 'dormant_60d', 'dormant_90d', 'churned_180d', 'one_time_buyer', 'high_value_lost', 'seasonal_lapsed', 'price_sensitive_lost'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const monthsAhead = Math.max(1, Math.min(12, Number(body?.monthsAhead ?? 3)));

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 500, orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) return NextResponse.json({ ok: true, designer: null, message: 'Ni prodaj za win-back campaign design.' });

    const buyerMap = new Map<string, { purchases: number; totalSpent: number; lastPurchase: Date | null; daysSinceLast: number; categories: Set<string> }>();
    const now = Date.now();
    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2 || !t.sellDate) continue;
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      if (!buyerMap.has(name)) buyerMap.set(name, { purchases: 0, totalSpent: 0, lastPurchase: t.sellDate, daysSinceLast: 0, categories: new Set() });
      const b = buyerMap.get(name)!; b.purchases += 1; b.totalSpent += revenue;
      if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
      if (t.category) b.categories.add(t.category);
    }
    const buyers = Array.from(buyerMap.values()).map(b => { b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / (24*60*60*1000)) : 999; return b; });

    const dormant30 = buyers.filter(b => b.daysSinceLast >= 30 && b.daysSinceLast < 60).length;
    const dormant60 = buyers.filter(b => b.daysSinceLast >= 60 && b.daysSinceLast < 90).length;
    const dormant90 = buyers.filter(b => b.daysSinceLast >= 90 && b.daysSinceLast < 180).length;
    const churned = buyers.filter(b => b.daysSinceLast >= 180).length;
    const highValueLost = buyers.filter(b => b.daysSinceLast >= 60 && b.totalSpent >= 500).length;

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const prompt = `Si AI buyer win-back campaign designer z ML in multi-touch strategijo.
Oblikuje win-back kampanje za dormant in churned kupce.

STATS:
- Dormant 30-60d: ${dormant30} kupcev
- Dormant 60-90d: ${dormant60} kupcev
- Dormant 90-180d: ${dormant90} kupcev
- Churned 180d+: ${churned} kupcev
- High-value lost (60d+, 500€+): ${highValueLost} kupcev

8 campaign tipov:
1. REACTIVATION_DISCOUNT: specifičen popust za povratek
2. WE_MISS_YOU: čustveno sporočilo brez prodaje
3. NEW_ARRIVAL_ALERT: obvestilo o novem inventarju
4. EXCLUSIVE_PREVIEW: predhodni dostop do novih itemov
5. BUNDLE_OFFER: paket na podlagi preteklih nakupov
6. LOYALTY_REWARD: nagrada za nekdanjo zvestobo
7. FEEDBACK_REQUEST: prošnja za feedback (pokaže da ti mar)
8. LAST_CHANCE: zadnja priložnost pred izbrisom

8 segmentov:
1. DORMANT_30D: 30-60d neaktiven (lahko reaktivira)
2. DORMANT_60D: 60-90d (upadajoča verjetnost)
3. DORMANT_90D: 90-180d (težko reaktivira)
4. CHURNED_180D: 180d+ (izgubljen, poskusi)
5. ONE_TIME_BUYER: samo 1 nakup, nikoli več
6. HIGH_VALUE_LOST: 500€+ porabil, sedaj neaktiven
7. SEASONAL_LAPSED: kupoval sezonsko, sedaj ne
8. PRICE_SENSITIVE_LOST: odšel zaradi cene

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "campaigns": [
    { "campaign_name": "<max 80 znakov>", "campaign_type": "<8 tipov>", "target_segment": "<8 segmentov>", "description": "<max 150 znakov>", "incentive_eur": <number>, "incentive_type": "<discount|free_item|early_access|bundle|cashback>", "expected_reactivation_rate_pct": <number 0-100>, "expected_revenue_eur": <number>, "implementation_cost_eur": <number>, "roi_score": <number 0-100>, "priority": "<high|medium|low>" }
  ],
  "segments": [
    { "segment": "<8 segmentov>", "buyer_count": <number>, "total_value_at_risk_eur": <number>, "avg_days_dormant": <number>, "reactivation_difficulty": "<easy|medium|hard|very_hard>", "best_campaign_type": "<8 tipov>", "expected_reactivation_rate_pct": <number 0-100> }
  ],
  "messages": [
    { "segment": "<8 segmentov>", "message_type": "<8 tipov>", "subject_line": "<max 100 znakov>", "message_body": "<max 300 znakov>", "tone": "<friendly|emotional|professional|urgent|playful>", "personalization_tokens": ["<max 60 znakov>"], "best_send_time": "<max 80 znakov>", "expected_open_rate_pct": <number 0-100>, "expected_click_rate_pct": <number 0-100> }
  ],
  "channels": [
    { "channel": "<email|sms|telegram|social|in_person>", "segment_fit": "<8 segmentov>", "avg_response_rate_pct": <number 0-100>, "avg_response_time_hours": <number>, "cost_per_message_eur": <number>, "best_for_campaign_type": "<8 tipov>" }
  ],
  "timeline": [
    { "day_offset": <0-90>, "action": "<max 100 znakov>", "target_segment": "<8 segmentov>", "channel": "<email|sms|telegram|social|in_person>", "campaign_type": "<8 tipov>", "expected_reactivations": <number>, "expected_revenue_eur": <number> }
  ],
  "projections": [
    { "month": <1-12>, "expected_reactivations": <number>, "expected_revenue_eur": <number>, "expected_cost_eur": <number>, "net_profit_eur": <number>, "cumulative_reactivations": <number> }
  ],
  "summary": {
    "total_dormant_buyers": <number>, "total_churned_buyers": <number>, "total_value_at_risk_eur": <number>,
    "total_expected_reactivations": <number>, "total_expected_revenue_eur": <number>, "total_expected_cost_eur": <number>,
    "expected_net_profit_eur": <number>, "expected_roi_pct": <number>,
    "best_campaign_overall": "<8 tipov>", "biggest_win_back_opportunity": "<max 100 znakov>",
    "win_back_campaign_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); }
      else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);

    const designer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      campaigns: (parsed?.campaigns || []).slice(0, 8).map((c: any) => ({
        campaignName: String(c?.campaign_name ?? '').slice(0, 150),
        campaignType: CAMPAIGN_TYPES.includes(String(c?.campaign_type) as any) ? String(c.campaign_type) : 'reactivation_discount',
        targetSegment: SEGMENT_TYPES.includes(String(c?.target_segment) as any) ? String(c.target_segment) : 'dormant_30d',
        description: String(c?.description ?? '').slice(0, 300),
        incentiveEur: Math.round(Number(c?.incentive_eur ?? 0)),
        incentiveType: ['discount', 'free_item', 'early_access', 'bundle', 'cashback'].includes(String(c?.incentive_type)) ? String(c.incentive_type) : 'discount',
        expectedReactivationRatePct: Math.max(0, Math.min(100, Number(c?.expected_reactivation_rate_pct ?? 20))),
        expectedRevenueEur: Math.round(Number(c?.expected_revenue_eur ?? 0)),
        implementationCostEur: Math.round(Number(c?.implementation_cost_eur ?? 0)),
        roiScore: Math.max(0, Math.min(100, Number(c?.roi_score ?? 50))),
        priority: ['high', 'medium', 'low'].includes(String(c?.priority)) ? String(c.priority) : 'medium',
      })),
      segments: (parsed?.segments || []).slice(0, 8).map((s: any) => ({
        segment: SEGMENT_TYPES.includes(String(s?.segment) as any) ? String(s.segment) : 'dormant_30d',
        buyerCount: Math.max(0, Number(s?.buyer_count ?? 0)),
        totalValueAtRiskEur: Math.round(Number(s?.total_value_at_risk_eur ?? 0)),
        avgDaysDormant: Math.max(0, Number(s?.avg_days_dormant ?? 0)),
        reactivationDifficulty: ['easy', 'medium', 'hard', 'very_hard'].includes(String(s?.reactivation_difficulty)) ? String(s.reactivation_difficulty) : 'medium',
        bestCampaignType: CAMPAIGN_TYPES.includes(String(s?.best_campaign_type) as any) ? String(s.best_campaign_type) : 'reactivation_discount',
        expectedReactivationRatePct: Math.max(0, Math.min(100, Number(s?.expected_reactivation_rate_pct ?? 20))),
      })),
      messages: (parsed?.messages || []).slice(0, 8).map((m: any) => ({
        segment: SEGMENT_TYPES.includes(String(m?.segment) as any) ? String(m.segment) : 'dormant_30d',
        messageType: CAMPAIGN_TYPES.includes(String(m?.message_type) as any) ? String(m.message_type) : 'we_miss_you',
        subjectLine: String(m?.subject_line ?? '').slice(0, 200),
        messageBody: String(m?.message_body ?? '').slice(0, 600),
        tone: ['friendly', 'emotional', 'professional', 'urgent', 'playful'].includes(String(m?.tone)) ? String(m.tone) : 'friendly',
        personalizationTokens: (m?.personalization_tokens || []).slice(0, 5).map((t: any) => String(t).slice(0, 100)),
        bestSendTime: String(m?.best_send_time ?? '').slice(0, 150),
        expectedOpenRatePct: Math.max(0, Math.min(100, Number(m?.expected_open_rate_pct ?? 25))),
        expectedClickRatePct: Math.max(0, Math.min(100, Number(m?.expected_click_rate_pct ?? 10))),
      })),
      channels: (parsed?.channels || []).slice(0, 5).map((c: any) => ({
        channel: ['email', 'sms', 'telegram', 'social', 'in_person'].includes(String(c?.channel)) ? String(c.channel) : 'email',
        segmentFit: SEGMENT_TYPES.includes(String(c?.segment_fit) as any) ? String(c.segment_fit) : 'dormant_30d',
        avgResponseRatePct: Math.max(0, Math.min(100, Number(c?.avg_response_rate_pct ?? 20))),
        avgResponseTimeHours: Math.round(Number(c?.avg_response_time_hours ?? 24)),
        costPerMessageEur: Math.round(Number(c?.cost_per_message_eur ?? 0) * 100) / 100,
        bestForCampaignType: CAMPAIGN_TYPES.includes(String(c?.best_for_campaign_type) as any) ? String(c.best_for_campaign_type) : 'reactivation_discount',
      })),
      timeline: (parsed?.timeline || []).slice(0, 10).map((t: any) => ({
        dayOffset: Math.max(0, Math.min(90, Number(t?.day_offset ?? 0))),
        action: String(t?.action ?? '').slice(0, 200),
        targetSegment: SEGMENT_TYPES.includes(String(t?.target_segment) as any) ? String(t.target_segment) : 'dormant_30d',
        channel: ['email', 'sms', 'telegram', 'social', 'in_person'].includes(String(t?.channel)) ? String(t.channel) : 'email',
        campaignType: CAMPAIGN_TYPES.includes(String(t?.campaign_type) as any) ? String(t.campaign_type) : 'we_miss_you',
        expectedReactivations: Math.max(0, Number(t?.expected_reactivations ?? 0)),
        expectedRevenueEur: Math.round(Number(t?.expected_revenue_eur ?? 0)),
      })),
      projections: (parsed?.projections || []).slice(0, monthsAhead).map((p: any) => ({
        month: Math.max(1, Math.min(12, Number(p?.month ?? 1))),
        expectedReactivations: Math.max(0, Number(p?.expected_reactivations ?? 0)),
        expectedRevenueEur: Math.round(Number(p?.expected_revenue_eur ?? 0)),
        expectedCostEur: Math.round(Number(p?.expected_cost_eur ?? 0)),
        netProfitEur: Math.round(Number(p?.net_profit_eur ?? 0)),
        cumulativeReactivations: Math.max(0, Number(p?.cumulative_reactivations ?? 0)),
      })),
      summary: {
        totalDormantBuyers: Math.max(0, Number(parsed?.summary?.total_dormant_buyers ?? dormant30 + dormant60 + dormant90)),
        totalChurnedBuyers: Math.max(0, Number(parsed?.summary?.total_churned_buyers ?? churned)),
        totalValueAtRiskEur: Math.round(Number(parsed?.summary?.total_value_at_risk_eur ?? 0)),
        totalExpectedReactivations: Math.max(0, Number(parsed?.summary?.total_expected_reactivations ?? 0)),
        totalExpectedRevenueEur: Math.round(Number(parsed?.summary?.total_expected_revenue_eur ?? 0)),
        totalExpectedCostEur: Math.round(Number(parsed?.summary?.total_expected_cost_eur ?? 0)),
        expectedNetProfitEur: Math.round(Number(parsed?.summary?.expected_net_profit_eur ?? 0)),
        expectedRoiPct: Math.round(Number(parsed?.summary?.expected_roi_pct ?? 0) * 10) / 10,
        bestCampaignOverall: CAMPAIGN_TYPES.includes(String(parsed?.summary?.best_campaign_overall) as any) ? String(parsed.summary.best_campaign_overall) : 'reactivation_discount',
        biggestWinBackOpportunity: String(parsed?.summary?.biggest_win_back_opportunity ?? '').slice(0, 200),
        winBackCampaignScore: Math.max(0, Math.min(100, Number(parsed?.summary?.win_back_campaign_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, designer });
  } catch (e: any) { logger.error("/api/ai/buyer-win-back-campaign-designer", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
