// v6.80 / v8.95.3-batch2: AI Buyer Loyalty Tiers — ML klasifikacija kupcev v loyalty tierje z rewards
// Refaktoriran z withAiRoute helperjem (v8.95.3-batch2) + enforceBudget guard.
//
// POST /api/ai/buyer-loyalty-tiers
// Body: { customerName?: string }
// Returns: { ok, analyzer: { buyers, tierDistribution, rewardsProgram, migrationPaths, mlModels, summary } | null, message? }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const LOYALTY_TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond'] as const;
const REWARD_TYPES = ['discount_pct', 'free_shipping', 'priority_access', 'exclusive_deals', 'cashback', 'early_bird', 'bundle_bonus', 'referral_bonus'] as const;

interface BuyerLoyaltyTiersInput {
  customerName: string | null;
}

interface BuyerRow {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrder: number;
  firstPurchase: Date | null;
  lastPurchase: Date | null;
  categories: Set<string>;
  lifetime_days: number;
}

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  sellLocation: string | null;
  buyDate: Date | null;
}

export const POST = withAiRoute<BuyerLoyaltyTiersInput>({
  endpoint: '/api/ai/buyer-loyalty-tiers',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      customerName: body?.customerName ? String(body.customerName).trim() : null,
    };
  },

  // No validateInput — vsi input-i imajo defaults (customerName=null)

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { customerName } = input;

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, analyzer: null, message: 'Ni prodaj za loyalty analizo.' });
    }

    const buyers = buildBuyers(soldTrades);

    if (customerName) {
      const filtered = buyers.filter(b => b.name === customerName);
      if (filtered.length === 0) {
        return apiOk({ ok: true, analyzer: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);

    const prompt = buildPrompt(targetBuyers);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const analyzer = transformAnalyzer(parsed);

    return apiOk({ ok: true, analyzer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildBuyers(soldTrades: SoldTradeRow[]): BuyerRow[] {
  const buyerMap = new Map<string, BuyerRow>();
  const now = Date.now();
  for (const t of soldTrades) {
    const name = (t.sellLocation || '').trim();
    if (!name || name.length < 2 || !t.sellDate) continue;
    const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, firstPurchase: t.sellDate, lastPurchase: t.sellDate, categories: new Set(), lifetime_days: 0 });
    const b = buyerMap.get(name)!;
    b.purchases += 1; b.totalSpent += rev;
    if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate;
    if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
    if (t.category) b.categories.add(t.category);
  }
  return Array.from(buyerMap.values()).map(b => { b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0; b.lifetime_days = b.firstPurchase ? Math.round((now - b.firstPurchase.getTime()) / (24*60*60*1000)) : 0; return b; });
}

function buildPrompt(targetBuyers: BuyerRow[]): string {
  const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.lifetime_days}d | ${b.categories.size} kat`).join('\n');

  return `Si AI buyer loyalty tiers analyzer z ML in reward program design.
Klasificira kupce v 5 loyalty tierjev in predlaga rewards program.

KUPCI (${targetBuyers.length}):
${buyersStr}

5 loyalty tierjev:
1. BRONZE: 1-2 nakupov, <500€
2. SILVER: 3-5 nakupov, 500-2000€
3. GOLD: 6-10 nakupov, 2000-5000€
4. PLATINUM: 11-20 nakupov, 5000-15000€
5. DIAMOND: 20+ nakupov, 15000€+

8 reward tipov: discount_pct, free_shipping, priority_access, exclusive_deals, cashback, early_bird, bundle_bonus, referral_bonus

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    { "name": "<string>", "current_tier": "<${LOYALTY_TIERS.join('|')}>", "next_tier": "<${LOYALTY_TIERS.join('|')}|none>", "loyalty_score": <number 0-100>, "total_purchases": <number>, "total_spent_eur": <number>, "lifetime_days": <number>, "tier_progress_pct": <number 0-100>, "purchases_to_next_tier": <number>, "spend_to_next_tier_eur": <number>, "tier_benefits": "<max 150 znakov>" }
  ],
  "tierDistribution": [
    { "tier": "<${LOYALTY_TIERS.join('|')}>", "buyer_count": <number>, "total_revenue_eur": <number>, "revenue_pct": <number 0-100>, "avg_spend_eur": <number>, "retention_rate_pct": <number 0-100>, "churn_risk_pct": <number 0-100> }
  ],
  "rewardsProgram": [
    { "tier": "<${LOYALTY_TIERS.join('|')}>", "reward_type": "<${REWARD_TYPES.join('|')}>", "reward_value": <number>, "description": "<max 150 znakov>", "eligibility_criteria": "<max 100 znakov>", "estimated_cost_eur": <number>, "estimated_revenue_lift_eur": <number> }
  ],
  "migrationPaths": [
    { "from_tier": "<${LOYALTY_TIERS.join('|')}>", "to_tier": "<${LOYALTY_TIERS.join('|')}>", "required_purchases": <number>, "required_spend_eur": <number>, "estimated_days": <number>, "intervention": "<max 150 znakov>", "success_probability_pct": <number 0-100> }
  ],
  "mlModels": [
    { "model": "<k-means|dbscan|random_forest|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<tier_classification|churn_prediction|lifetime_value|risk_score>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "portfolio_loyalty_score": <number 0-100>, "portfolio_loyalty_grade": "<A|B|C|D|F>", "total_loyalty_revenue_eur": <number>,
    "diamond_buyers_count": <number>, "at_risk_buyers_count": <number>,
    "biggest_loyalty_risk": "<max 100 znakov>", "biggest_loyalty_opportunity": "<max 100 znakov>",
    "quickest_loyalty_win": "<max 100 znakov>", "loyalty_analysis_score": <number 0-100>
  }
}`;
}

function transformAnalyzer(parsed: any): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    buyers: (parsed?.buyers || []).slice(0, 25).map((b: any) => ({ name: String(b?.name ?? '').slice(0, 100), currentTier: (LOYALTY_TIERS as readonly string[]).includes(String(b?.current_tier)) ? String(b.current_tier) : 'bronze', nextTier: [...LOYALTY_TIERS, 'none'].includes(String(b?.next_tier)) ? String(b.next_tier) : 'none', loyaltyScore: Math.max(0, Math.min(100, Number(b?.loyalty_score ?? 50))), totalPurchases: Math.max(0, Number(b?.total_purchases ?? 0)), totalSpentEur: Math.round(Number(b?.total_spent_eur ?? 0)), lifetimeDays: Math.max(0, Number(b?.lifetime_days ?? 0)), tierProgressPct: Math.max(0, Math.min(100, Number(b?.tier_progress_pct ?? 0))), purchasesToNextTier: Math.max(0, Number(b?.purchases_to_next_tier ?? 0)), spendToNextTierEur: Math.round(Number(b?.spend_to_next_tier_eur ?? 0)), tierBenefits: String(b?.tier_benefits ?? '').slice(0, 300) })),
    tierDistribution: (parsed?.tierDistribution || []).slice(0, 5).map((t: any) => ({ tier: (LOYALTY_TIERS as readonly string[]).includes(String(t?.tier)) ? String(t.tier) : 'bronze', buyerCount: Math.max(0, Number(t?.buyer_count ?? 0)), totalRevenueEur: Math.round(Number(t?.total_revenue_eur ?? 0)), revenuePct: Math.max(0, Math.min(100, Number(t?.revenue_pct ?? 0))), avgSpendEur: Math.round(Number(t?.avg_spend_eur ?? 0)), retentionRatePct: Math.max(0, Math.min(100, Number(t?.retention_rate_pct ?? 70))), churnRiskPct: Math.max(0, Math.min(100, Number(t?.churn_risk_pct ?? 20))) })),
    rewardsProgram: (parsed?.rewardsProgram || []).slice(0, 12).map((r: any) => ({ tier: (LOYALTY_TIERS as readonly string[]).includes(String(r?.tier)) ? String(r.tier) : 'bronze', rewardType: (REWARD_TYPES as readonly string[]).includes(String(r?.reward_type)) ? String(r.reward_type) : 'discount_pct', rewardValue: Math.max(0, Number(r?.reward_value ?? 0)), description: String(r?.description ?? '').slice(0, 300), eligibilityCriteria: String(r?.eligibility_criteria ?? '').slice(0, 200), estimatedCostEur: Math.round(Number(r?.estimated_cost_eur ?? 0)), estimatedRevenueLiftEur: Math.round(Number(r?.estimated_revenue_lift_eur ?? 0)) })),
    migrationPaths: (parsed?.migrationPaths || []).slice(0, 8).map((m: any) => ({ fromTier: (LOYALTY_TIERS as readonly string[]).includes(String(m?.from_tier)) ? String(m.from_tier) : 'bronze', toTier: (LOYALTY_TIERS as readonly string[]).includes(String(m?.to_tier)) ? String(m.to_tier) : 'silver', requiredPurchases: Math.max(0, Number(m?.required_purchases ?? 0)), requiredSpendEur: Math.round(Number(m?.required_spend_eur ?? 0)), estimatedDays: Math.max(1, Number(m?.estimated_days ?? 30)), intervention: String(m?.intervention ?? '').slice(0, 300), successProbabilityPct: Math.max(0, Math.min(100, Number(m?.success_probability_pct ?? 50))) })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['k-means', 'dbscan', 'random_forest', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['tier_classification', 'churn_prediction', 'lifetime_value', 'risk_score'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'tier_classification', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
    summary: { portfolioLoyaltyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.portfolio_loyalty_score ?? 50))), portfolioLoyaltyGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.portfolio_loyalty_grade)) ? String(parsed.summary.portfolio_loyalty_grade) : 'C', totalLoyaltyRevenueEur: Math.round(Number(parsed?.summary?.total_loyalty_revenue_eur ?? 0)), diamondBuyersCount: Math.max(0, Number(parsed?.summary?.diamond_buyers_count ?? 0)), atRiskBuyersCount: Math.max(0, Number(parsed?.summary?.at_risk_buyers_count ?? 0)), biggestLoyaltyRisk: String(parsed?.summary?.biggest_loyalty_risk ?? '').slice(0, 200), biggestLoyaltyOpportunity: String(parsed?.summary?.biggest_loyalty_opportunity ?? '').slice(0, 200), quickestLoyaltyWin: String(parsed?.summary?.quickest_loyalty_win ?? '').slice(0, 200), loyaltyAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.loyalty_analysis_score ?? 50))) },
  };
}
