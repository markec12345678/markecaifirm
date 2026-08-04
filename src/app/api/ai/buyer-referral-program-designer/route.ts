// v6.65: AI Buyer Referral Program Designer — oblikuje referral program z ML in incentive optimization
// POST /api/ai/buyer-referral-program-designer
// Body: { monthsAhead?: number }
// Returns: { ok, designer: { program, incentives, tiers, campaigns, projections, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const monthsAhead = Math.max(1, Math.min(12, Number(body?.monthsAhead ?? 6)));

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true },
      take: 500, orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) return NextResponse.json({ ok: true, designer: null, message: 'Ni prodaj za referral program design.' });

    const buyerMap = new Map<string, { purchases: number; totalSpent: number }>();
    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2) continue;
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      if (!buyerMap.has(name)) buyerMap.set(name, { purchases: 0, totalSpent: 0 });
      const b = buyerMap.get(name)!;
      b.purchases += 1; b.totalSpent += revenue;
    }
    const totalBuyers = buyerMap.size;
    const repeatBuyers = Array.from(buyerMap.values()).filter(b => b.purchases >= 2).length;
    const highValueBuyers = Array.from(buyerMap.values()).filter(b => b.totalSpent >= 500).length;
    const avgBuyerValue = Math.round(Array.from(buyerMap.values()).reduce((s, b) => s + b.totalSpent, 0) / Math.max(1, totalBuyers));

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const prompt = `Si AI buyer referral program designer z ML in incentive optimization.
Oblikuje referral program za ${totalBuyers} kupcev (${repeatBuyers} repeat, ${highValueBuyers} high-value, povp vrednost ${avgBuyerValue}€).

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "program": {
    "program_name": "<max 80 znakov>",
    "description": "<max 200 znakov>",
    "program_type": "<two_sided|one_sided_referrer|one_sided_referee|tiered|gamified>",
    "double_incentive": <boolean>,
    "max_referrals_per_buyer": <number>,
    "referral_window_days": <number>,
    "qualification_criteria": ["<max 80 znakov>"]
  },
  "incentives": [
    { "incentive_name": "<max 80 znakov>", "recipient": "<referrer|referee|both>", "incentive_type": "<discount|cash|free_item|store_credit|early_access|bundle>", "value_eur": <number>, "qualification": "<max 100 znakov>", "estimated_conversion_pct": <number 0-100>, "cost_per_referral_eur": <number>, "expected_revenue_per_referral_eur": <number>, "roi_score": <number 0-100> }
  ],
  "tiers": [
    { "tier_name": "<starter|bronze|silver|gold|ambassador>", "min_referrals": <number>, "referrer_reward": "<max 100 znakov>", "referee_reward": "<max 100 znakov>", "bonus_perks": ["<max 80 znakov>"], "estimated_participants": <number> }
  ],
  "campaigns": [
    { "campaign_name": "<max 80 znakov>", "target_audience": "<max 80 znakov>", "description": "<max 120 znakov>", "channel": "<email|sms|social|in_app>", "frequency": "<once|weekly|monthly|triggered>", "expected_referrals": <number>, "expected_conversion_pct": <number 0-100>, "implementation_cost_eur": <number> }
  ],
  "projections": [
    { "month": <1-12>, "expected_referrals": <number>, "expected_new_buyers": <number>, "expected_revenue_eur": <number>, "expected_cost_eur": <number>, "net_profit_eur": <number>, "cumulative_new_buyers": <number> }
  ],
  "summary": {
    "total_potential_referrers": <number>,
    "expected_referrals_${monthsAhead}m": <number>,
    "expected_new_buyers": <number>,
    "expected_total_revenue_eur": <number>,
    "expected_total_cost_eur": <number>,
    "expected_net_profit_eur": <number>,
    "expected_roi_pct": <number>,
    "best_incentive": "<max 80 znakov>",
    "referral_program_score": <number 0-100>
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
      program: {
        programName: String(parsed?.program?.program_name ?? '').slice(0, 150),
        description: String(parsed?.program?.description ?? '').slice(0, 300),
        programType: ['two_sided', 'one_sided_referrer', 'one_sided_referee', 'tiered', 'gamified'].includes(String(parsed?.program?.program_type)) ? String(parsed.program.program_type) : 'two_sided',
        doubleIncentive: Boolean(parsed?.program?.double_incentive ?? true),
        maxReferralsPerBuyer: Math.max(0, Number(parsed?.program?.max_referrals_per_buyer ?? 10)),
        referralWindowDays: Math.max(1, Number(parsed?.program?.referral_window_days ?? 30)),
        qualificationCriteria: (parsed?.program?.qualification_criteria || []).slice(0, 5).map((c: any) => String(c).slice(0, 150)),
      },
      incentives: (parsed?.incentives || []).slice(0, 8).map((i: any) => ({
        incentiveName: String(i?.incentive_name ?? '').slice(0, 150),
        recipient: ['referrer', 'referee', 'both'].includes(String(i?.recipient)) ? String(i.recipient) : 'both',
        incentiveType: ['discount', 'cash', 'free_item', 'store_credit', 'early_access', 'bundle'].includes(String(i?.incentive_type)) ? String(i.incentive_type) : 'discount',
        valueEur: Math.round(Number(i?.value_eur ?? 0)),
        qualification: String(i?.qualification ?? '').slice(0, 200),
        estimatedConversionPct: Math.max(0, Math.min(100, Number(i?.estimated_conversion_pct ?? 20))),
        costPerReferralEur: Math.round(Number(i?.cost_per_referral_eur ?? 0)),
        expectedRevenuePerReferralEur: Math.round(Number(i?.expected_revenue_per_referral_eur ?? 0)),
        roiScore: Math.max(0, Math.min(100, Number(i?.roi_score ?? 50))),
      })),
      tiers: (parsed?.tiers || []).slice(0, 5).map((t: any) => ({
        tierName: ['starter', 'bronze', 'silver', 'gold', 'ambassador'].includes(String(t?.tier_name)) ? String(t.tier_name) : 'starter',
        minReferrals: Math.max(0, Number(t?.min_referrals ?? 0)),
        referrerReward: String(t?.referrer_reward ?? '').slice(0, 200),
        refereeReward: String(t?.referee_reward ?? '').slice(0, 200),
        bonusPerks: (t?.bonus_perks || []).slice(0, 5).map((p: any) => String(p).slice(0, 150)),
        estimatedParticipants: Math.max(0, Number(t?.estimated_participants ?? 0)),
      })),
      campaigns: (parsed?.campaigns || []).slice(0, 6).map((c: any) => ({
        campaignName: String(c?.campaign_name ?? '').slice(0, 150),
        targetAudience: String(c?.target_audience ?? '').slice(0, 150),
        description: String(c?.description ?? '').slice(0, 250),
        channel: ['email', 'sms', 'social', 'in_app'].includes(String(c?.channel)) ? String(c.channel) : 'email',
        frequency: ['once', 'weekly', 'monthly', 'triggered'].includes(String(c?.frequency)) ? String(c.frequency) : 'triggered',
        expectedReferrals: Math.max(0, Number(c?.expected_referrals ?? 0)),
        expectedConversionPct: Math.max(0, Math.min(100, Number(c?.expected_conversion_pct ?? 20))),
        implementationCostEur: Math.round(Number(c?.implementation_cost_eur ?? 0)),
      })),
      projections: (parsed?.projections || []).slice(0, monthsAhead).map((p: any) => ({
        month: Math.max(1, Math.min(12, Number(p?.month ?? 1))),
        expectedReferrals: Math.max(0, Number(p?.expected_referrals ?? 0)),
        expectedNewBuyers: Math.max(0, Number(p?.expected_new_buyers ?? 0)),
        expectedRevenueEur: Math.round(Number(p?.expected_revenue_eur ?? 0)),
        expectedCostEur: Math.round(Number(p?.expected_cost_eur ?? 0)),
        netProfitEur: Math.round(Number(p?.net_profit_eur ?? 0)),
        cumulativeNewBuyers: Math.max(0, Number(p?.cumulative_new_buyers ?? 0)),
      })),
      summary: {
        totalPotentialReferrers: Math.max(0, Number(parsed?.summary?.total_potential_referrers ?? repeatBuyers)),
        expectedReferralsMonths: Math.max(0, Number(parsed?.summary?.[`expected_referrals_${monthsAhead}m`] ?? parsed?.summary?.expected_referrals_6m ?? 0)),
        expectedNewBuyers: Math.max(0, Number(parsed?.summary?.expected_new_buyers ?? 0)),
        expectedTotalRevenueEur: Math.round(Number(parsed?.summary?.expected_total_revenue_eur ?? 0)),
        expectedTotalCostEur: Math.round(Number(parsed?.summary?.expected_total_cost_eur ?? 0)),
        expectedNetProfitEur: Math.round(Number(parsed?.summary?.expected_net_profit_eur ?? 0)),
        expectedRoiPct: Math.round(Number(parsed?.summary?.expected_roi_pct ?? 0) * 10) / 10,
        bestIncentive: String(parsed?.summary?.best_incentive ?? '').slice(0, 150),
        referralProgramScore: Math.max(0, Math.min(100, Number(parsed?.summary?.referral_program_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, designer });
  } catch (e: any) { logger.error("/api/ai/buyer-referral-program-designer", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
