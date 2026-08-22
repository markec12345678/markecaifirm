// v6.65 / v8.95.4-batch2: AI Buyer Referral Program Designer — oblikuje referral program z ML in incentive optimization
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-referral-program-designer
// Body: { monthsAhead?: number }
// Returns: { ok, designer: { program, incentives, tiers, campaigns, projections, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BuyerReferralProgramDesignerInput {
  monthsAhead: number;
}

interface SoldTradeRow {
  id: string;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  sellLocation: string;
}

interface BuyerAgg {
  purchases: number;
  totalSpent: number;
}

const PROGRAM_TYPES = ['two_sided', 'one_sided_referrer', 'one_sided_referee', 'tiered', 'gamified'] as const;
const RECIPIENTS = ['referrer', 'referee', 'both'] as const;
const INCENTIVE_TYPES = ['discount', 'cash', 'free_item', 'store_credit', 'early_access', 'bundle'] as const;
const TIER_NAMES = ['starter', 'bronze', 'silver', 'gold', 'ambassador'] as const;
const CAMPAIGN_CHANNELS = ['email', 'sms', 'social', 'in_app'] as const;
const CAMPAIGN_FREQUENCIES = ['once', 'weekly', 'monthly', 'triggered'] as const;

export const POST = withAiRoute<BuyerReferralProgramDesignerInput>({
  endpoint: '/api/ai/buyer-referral-program-designer',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { monthsAhead: Math.max(1, Math.min(12, Number(body?.monthsAhead ?? 6))) };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { monthsAhead } = input;

    const soldTrades: SoldTradeRow[] = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, designer: null, message: 'Ni prodaj za referral program design.' });
    }

    const buyerMap = buildBuyerMap(soldTrades);
    const totalBuyers = buyerMap.size;
    const repeatBuyers = Array.from(buyerMap.values()).filter(b => b.purchases >= 2).length;
    const highValueBuyers = Array.from(buyerMap.values()).filter(b => b.totalSpent >= 500).length;
    const avgBuyerValue = Math.round(Array.from(buyerMap.values()).reduce((s, b) => s + b.totalSpent, 0) / Math.max(1, totalBuyers));

    const prompt = buildPrompt(totalBuyers, repeatBuyers, highValueBuyers, avgBuyerValue, monthsAhead);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const designer = transformDesigner(parsed, monthsAhead, repeatBuyers);
    return apiOk({ ok: true, designer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildBuyerMap(soldTrades: SoldTradeRow[]): Map<string, BuyerAgg> {
  const buyerMap = new Map<string, BuyerAgg>();
  for (const t of soldTrades) {
    const name = (t.sellLocation || '').trim();
    if (!name || name.length < 2) continue;
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    if (!buyerMap.has(name)) buyerMap.set(name, { purchases: 0, totalSpent: 0 });
    const b = buyerMap.get(name)!;
    b.purchases += 1;
    b.totalSpent += revenue;
  }
  return buyerMap;
}

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Math.round(Number(n) * 10) / 10;
}

function buildPrompt(totalBuyers: number, repeatBuyers: number, highValueBuyers: number, avgBuyerValue: number, monthsAhead: number): string {
  return `Si AI buyer referral program designer z ML in incentive optimization.
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
}

function transformDesigner(parsed: any, monthsAhead: number, repeatBuyers: number): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    program: {
      programName: String(parsed?.program?.program_name ?? '').slice(0, 150),
      description: String(parsed?.program?.description ?? '').slice(0, 300),
      programType: includes(PROGRAM_TYPES, String(parsed?.program?.program_type)) ? String(parsed.program.program_type) : 'two_sided',
      doubleIncentive: Boolean(parsed?.program?.double_incentive ?? true),
      maxReferralsPerBuyer: Math.max(0, Number(parsed?.program?.max_referrals_per_buyer ?? 10)),
      referralWindowDays: Math.max(1, Number(parsed?.program?.referral_window_days ?? 30)),
      qualificationCriteria: (parsed?.program?.qualification_criteria || []).slice(0, 5).map((c: any) => String(c).slice(0, 150)),
    },
    incentives: (parsed?.incentives || []).slice(0, 8).map((i: any) => ({
      incentiveName: String(i?.incentive_name ?? '').slice(0, 150),
      recipient: includes(RECIPIENTS, String(i?.recipient)) ? String(i.recipient) : 'both',
      incentiveType: includes(INCENTIVE_TYPES, String(i?.incentive_type)) ? String(i.incentive_type) : 'discount',
      valueEur: Math.round(Number(i?.value_eur ?? 0)),
      qualification: String(i?.qualification ?? '').slice(0, 200),
      estimatedConversionPct: clamp(Number(i?.estimated_conversion_pct ?? 20), 0, 100),
      costPerReferralEur: Math.round(Number(i?.cost_per_referral_eur ?? 0)),
      expectedRevenuePerReferralEur: Math.round(Number(i?.expected_revenue_per_referral_eur ?? 0)),
      roiScore: clamp(Number(i?.roi_score ?? 50), 0, 100),
    })),
    tiers: (parsed?.tiers || []).slice(0, 5).map((t: any) => ({
      tierName: includes(TIER_NAMES, String(t?.tier_name)) ? String(t.tier_name) : 'starter',
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
      channel: includes(CAMPAIGN_CHANNELS, String(c?.channel)) ? String(c.channel) : 'email',
      frequency: includes(CAMPAIGN_FREQUENCIES, String(c?.frequency)) ? String(c.frequency) : 'triggered',
      expectedReferrals: Math.max(0, Number(c?.expected_referrals ?? 0)),
      expectedConversionPct: clamp(Number(c?.expected_conversion_pct ?? 20), 0, 100),
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
      expectedRoiPct: round1(parsed?.summary?.expected_roi_pct ?? 0),
      bestIncentive: String(parsed?.summary?.best_incentive ?? '').slice(0, 150),
      referralProgramScore: clamp(Number(parsed?.summary?.referral_program_score ?? 60), 0, 100),
    },
  };
}
