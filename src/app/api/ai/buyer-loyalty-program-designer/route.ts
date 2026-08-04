// v6.64: AI Buyer Loyalty Program Designer — oblikuje loyalty program z ML in tier-based rewards
// POST /api/ai/buyer-loyalty-program-designer
// Body: { monthsAhead?: number }
// Returns: { ok, designer: { tiers, rewards, pointSystem, campaigns, projections, summary } }

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
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) return NextResponse.json({ ok: true, designer: null, message: 'Ni prodaj za loyalty program design.' });

    // Buyer aggregation
    const buyerMap = new Map<string, { purchases: number; totalSpent: number; avgOrder: number; daysSinceLast: number; lastPurchase: Date | null }>();
    const now = Date.now();
    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2 || !t.sellDate) continue;
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      if (!buyerMap.has(name)) buyerMap.set(name, { purchases: 0, totalSpent: 0, avgOrder: 0, daysSinceLast: 0, lastPurchase: t.sellDate });
      const b = buyerMap.get(name)!;
      b.purchases += 1; b.totalSpent += revenue;
      if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
    }
    const buyers = Array.from(buyerMap.values()).map(b => {
      b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0;
      b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / (24*60*60*1000)) : 999;
      return b;
    });

    const totalBuyers = buyers.length;
    const repeatBuyers = buyers.filter(b => b.purchases >= 2).length;
    const highValueBuyers = buyers.filter(b => b.totalSpent >= 500).length;
    const avgBuyerValue = Math.round(buyers.reduce((s, b) => s + b.totalSpent, 0) / Math.max(1, totalBuyers));

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const prompt = `Si AI buyer loyalty program designer z ML in tier-based rewards.
Oblikuje loyalty program za ${totalBuyers} kupcev (${repeatBuyers} repeat, ${highValueBuyers} high-value).

STATS:
- Skupno kupcev: ${totalBuyers}
- Repeat kupci (2+): ${repeatBuyers}
- High-value kupci (500€+): ${highValueBuyers}
- Povp vrednost kupca: ${avgBuyerValue}€

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "tiers": [
    { "tier_name": "<bronze|silver|gold|platinum|diamond>", "min_purchases": <number>, "min_spent_eur": <number>, "buyer_count": <number>, "perks": ["<max 80 znakov>"], "discount_pct": <number>, "exclusive_access": <boolean>, "priority_support": <boolean>, "free_shipping": <boolean> }
  ],
  "rewards": [
    { "reward_name": "<max 80 znakov>", "reward_type": "<discount|free_item|early_access|bundle|cashback|referral_bonus|birthday_gift>", "tier_required": "<tier>", "points_cost": <number>, "description": "<max 120 znakov>", "estimated_redemption_rate_pct": <number 0-100>, "cost_to_business_eur": <number>, "expected_revenue_uplift_eur": <number> }
  ],
  "point_system": {
    "points_per_euro_spent": <number>,
    "bonus_points_first_purchase": <number>,
    "bonus_points_repeat_purchase": <number>,
    "bonus_points_referral": <number>,
    "bonus_points_review": <number>,
    "points_expiry_months": <number>,
    "redemption_options": [{"points_needed": <number>, "reward": "<max 80 znakov>"}]
  },
  "campaigns": [
    { "campaign_name": "<max 80 znakov>", "target_tier": "<tier ali all>", "description": "<max 120 znakov>", "frequency": "<once|monthly|quarterly|triggered>", "expected_participation_pct": <number 0-100>, "expected_revenue_eur": <number>, "implementation_cost_eur": <number> }
  ],
  "projections": [
    { "month": <1-12>, "expected_active_members": <number>, "expected_points_issued": <number>, "expected_points_redeemed": <number>, "expected_revenue_uplift_eur": <number>, "expected_retention_improvement_pct": <number> }
  ],
  "summary": {
    "total_buyers_in_program": <number>,
    "estimated_annual_cost_eur": <number>,
    "estimated_annual_revenue_uplift_eur": <number>,
    "estimated_roi_pct": <number>,
    "best_tier_strategy": "<max 80 znakov>",
    "biggest_loyalty_opportunity": "<max 100 znakov>",
    "loyalty_program_score": <number 0-100>
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

    const designer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      tiers: (parsed?.tiers || []).slice(0, 5).map((t: any) => ({
        tierName: ['bronze', 'silver', 'gold', 'platinum', 'diamond'].includes(String(t?.tier_name)) ? String(t.tier_name) : 'bronze',
        minPurchases: Math.max(0, Number(t?.min_purchases ?? 0)),
        minSpentEur: Math.max(0, Number(t?.min_spent_eur ?? 0)),
        buyerCount: Math.max(0, Number(t?.buyer_count ?? 0)),
        perks: (t?.perks || []).slice(0, 6).map((p: any) => String(p).slice(0, 150)),
        discountPct: Math.round(Number(t?.discount_pct ?? 0) * 10) / 10,
        exclusiveAccess: Boolean(t?.exclusive_access ?? false),
        prioritySupport: Boolean(t?.priority_support ?? false),
        freeShipping: Boolean(t?.free_shipping ?? false),
      })),
      rewards: (parsed?.rewards || []).slice(0, 10).map((r: any) => ({
        rewardName: String(r?.reward_name ?? '').slice(0, 150),
        rewardType: ['discount', 'free_item', 'early_access', 'bundle', 'cashback', 'referral_bonus', 'birthday_gift'].includes(String(r?.reward_type)) ? String(r.reward_type) : 'discount',
        tierRequired: String(r?.tier_required ?? 'all').slice(0, 30),
        pointsCost: Math.max(0, Number(r?.points_cost ?? 0)),
        description: String(r?.description ?? '').slice(0, 250),
        estimatedRedemptionRatePct: Math.max(0, Math.min(100, Number(r?.estimated_redemption_rate_pct ?? 30))),
        costToBusinessEur: Math.round(Number(r?.cost_to_business_eur ?? 0)),
        expectedRevenueUpliftEur: Math.round(Number(r?.expected_revenue_uplift_eur ?? 0)),
      })),
      pointSystem: {
        pointsPerEuroSpent: Math.round(Number(parsed?.point_system?.points_per_euro_spent ?? 1) * 10) / 10,
        bonusPointsFirstPurchase: Math.max(0, Number(parsed?.point_system?.bonus_points_first_purchase ?? 100)),
        bonusPointsRepeatPurchase: Math.max(0, Number(parsed?.point_system?.bonus_points_repeat_purchase ?? 50)),
        bonusPointsReferral: Math.max(0, Number(parsed?.point_system?.bonus_points_referral ?? 200)),
        bonusPointsReview: Math.max(0, Number(parsed?.point_system?.bonus_points_review ?? 30)),
        pointsExpiryMonths: Math.max(1, Number(parsed?.point_system?.points_expiry_months ?? 12)),
        redemptionOptions: (parsed?.point_system?.redemption_options || []).slice(0, 8).map((o: any) => ({
          pointsNeeded: Math.max(0, Number(o?.points_needed ?? 0)),
          reward: String(o?.reward ?? '').slice(0, 150),
        })),
      },
      campaigns: (parsed?.campaigns || []).slice(0, 6).map((c: any) => ({
        campaignName: String(c?.campaign_name ?? '').slice(0, 150),
        targetTier: String(c?.target_tier ?? 'all').slice(0, 30),
        description: String(c?.description ?? '').slice(0, 250),
        frequency: ['once', 'monthly', 'quarterly', 'triggered'].includes(String(c?.frequency)) ? String(c.frequency) : 'triggered',
        expectedParticipationPct: Math.max(0, Math.min(100, Number(c?.expected_participation_pct ?? 30))),
        expectedRevenueEur: Math.round(Number(c?.expected_revenue_eur ?? 0)),
        implementationCostEur: Math.round(Number(c?.implementation_cost_eur ?? 0)),
      })),
      projections: (parsed?.projections || []).slice(0, monthsAhead).map((p: any) => ({
        month: Math.max(1, Math.min(12, Number(p?.month ?? 1))),
        expectedActiveMembers: Math.max(0, Number(p?.expected_active_members ?? 0)),
        expectedPointsIssued: Math.max(0, Number(p?.expected_points_issued ?? 0)),
        expectedPointsRedeemed: Math.max(0, Number(p?.expected_points_redeemed ?? 0)),
        expectedRevenueUpliftEur: Math.round(Number(p?.expected_revenue_uplift_eur ?? 0)),
        expectedRetentionImprovementPct: Math.round(Number(p?.expected_retention_improvement_pct ?? 0) * 10) / 10,
      })),
      summary: {
        totalBuyersInProgram: Math.max(0, Number(parsed?.summary?.total_buyers_in_program ?? totalBuyers)),
        estimatedAnnualCostEur: Math.round(Number(parsed?.summary?.estimated_annual_cost_eur ?? 0)),
        estimatedAnnualRevenueUpliftEur: Math.round(Number(parsed?.summary?.estimated_annual_revenue_uplift_eur ?? 0)),
        estimatedRoiPct: Math.round(Number(parsed?.summary?.estimated_roi_pct ?? 0) * 10) / 10,
        bestTierStrategy: String(parsed?.summary?.best_tier_strategy ?? '').slice(0, 150),
        biggestLoyaltyOpportunity: String(parsed?.summary?.biggest_loyalty_opportunity ?? '').slice(0, 200),
        loyaltyProgramScore: Math.max(0, Math.min(100, Number(parsed?.summary?.loyalty_program_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, designer });
  } catch (e: any) { logger.error("/api/ai/buyer-loyalty-program-designer", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
