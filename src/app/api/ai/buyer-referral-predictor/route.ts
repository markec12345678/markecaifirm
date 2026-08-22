// v6.88 / v8.95.4-batch2: AI Buyer Referral Predictor — ML napoved referral vedenja kupcev z network analysis
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-referral-predictor
// Body: { customerName?: string }
// Returns: { ok, predictor: { overview, buyers, referralPotential, networkAnalysis, incentives, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BuyerReferralPredictorInput {
  customerName: string | null;
}

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  sellLocation: string;
  buyDate: Date | null;
}

interface BuyerInfo {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrder: number;
  firstPurchase: Date | null;
  lastPurchase: Date | null;
  categories: Set<string>;
  daysSinceLast: number;
  lifetimeDays: number;
}

const REFERRAL_TIERS = ['super_advocate', 'advocate', 'potential_referrer', 'passive', 'unlikely', 'detractor'] as const;
const INCENTIVE_TYPES = ['cash_reward', 'discount_coupon', 'free_item', 'loyalty_points', 'exclusive_access', 'recognition', 'charity_donation', 'tier_upgrade'] as const;
const ML_MODELS = ['random_forest', 'xgboost', 'neural_net', 'graph_neural_net', 'ensemble'] as const;
const ML_PREDICTION_TYPES = ['referral_probability', 'network_influence', 'conversion_prediction', 'viral_forecast'] as const;
const TIMINGS = ['post_purchase', 'holiday', 'milestone', 'anytime'] as const;
const SOCIAL_PROOF = ['high', 'medium', 'low'] as const;
const GRADES = ['A', 'B', 'C', 'D', 'F'] as const;

export const POST = withAiRoute<BuyerReferralPredictorInput>({
  endpoint: '/api/ai/buyer-referral-predictor',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { customerName: body?.customerName ? String(body.customerName).trim() : null };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { customerName } = input;

    const soldTrades: SoldTradeRow[] = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, predictor: null, message: 'Ni prodaj za referral analizo.' });
    }

    const buyers = buildBuyerMap(soldTrades);
    if (customerName) {
      const f = buyers.filter(b => b.name === customerName);
      if (f.length === 0) {
        return apiOk({ ok: true, predictor: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const prompt = buildPrompt(targetBuyers);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const predictor = transformPredictor(parsed, targetBuyers);
    return apiOk({ ok: true, predictor });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildBuyerMap(soldTrades: SoldTradeRow[]): BuyerInfo[] {
  const buyerMap = new Map<string, BuyerInfo>();
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  for (const t of soldTrades) {
    const name = (t.sellLocation || '').trim();
    if (!name || name.length < 2 || !t.sellDate) continue;
    const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    if (!buyerMap.has(name)) {
      buyerMap.set(name, {
        name, purchases: 0, totalSpent: 0, avgOrder: 0,
        firstPurchase: t.sellDate, lastPurchase: t.sellDate,
        categories: new Set(), daysSinceLast: 0, lifetimeDays: 0,
      });
    }
    const b = buyerMap.get(name)!;
    b.purchases += 1;
    b.totalSpent += rev;
    if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate;
    if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
    if (t.category) b.categories.add(t.category);
  }
  return Array.from(buyerMap.values()).map(b => {
    b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0;
    b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / DAY) : 999;
    b.lifetimeDays = b.firstPurchase ? Math.round((now - b.firstPurchase.getTime()) / DAY) : 0;
    return b;
  });
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

function round2(n: number): number {
  return Math.round(Number(n) * 100) / 100;
}

function buildPrompt(targetBuyers: BuyerInfo[]): string {
  const buyersStr = targetBuyers.slice(0, 10).map(b =>
    `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d | ${b.lifetimeDays}d | ${b.categories.size} kat`
  ).join('\n');

  return `Si AI buyer referral predictor z ML in network analysis.
Napoveduje referral vedenje kupcev z 6 tierji in 8 tipi spodbud.

KUPCI (${targetBuyers.length}):
${buyersStr}

6 referral tierjev:
1. SUPER_ADVOCATE: visoko verjetno (80-100%)
2. ADVOCATE: verjetno (60-79%)
3. POTENTIAL_REFERRER: morda (40-59%)
4. PASSIVE: nizko (20-39%)
5. UNLIKELY: zelo nizko (5-19%)
6. DETRACTOR: tveganje (<5%)

8 tipov spodbud: cash_reward, discount_coupon, free_item, loyalty_points, exclusive_access, recognition, charity_donation, tier_upgrade

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_buyers": <number>, "avg_referral_probability_pct": <number 0-100>, "super_advocates_count": <number>, "detractors_count": <number>, "estimated_annual_referrals": <number>, "estimated_referral_value_eur": <number>, "referral_grade": "<A|B|C|D|F>" },
  "buyers": [
    { "name": "<string>", "referral_probability_pct": <number 0-100>, "referral_tier": "<${REFERRAL_TIERS.join('|')}>", "estimated_referrals_per_year": <number>, "estimated_referral_value_eur": <number>, "network_reach_score": <number 0-100>, "influence_score": <number 0-100>, "recommended_incentive": "<${INCENTIVE_TYPES.join('|')}>" }
  ],
  "referralPotential": [
    { "buyer_name": "<string>", "current_referrals_made": <number>, "potential_referrals_12m": <number>, "conversion_rate_of_referrals_pct": <number 0-100>, "avg_referred_buyer_value_eur": <number>, "total_referral_value_eur": <number>, "best_timing": "<post_purchase|holiday|milestone|anytime>" }
  ],
  "networkAnalysis": [
    { "buyer_name": "<string>", "network_size_estimate": <number>, "network_influence_pct": <number 0-100>, "social_proof_potential": "<high|medium|low>", "viral_coefficient": <number 0-2>, "amplification_factor": <number 1-10> }
  ],
  "incentives": [
    { "incentive_type": "<${INCENTIVE_TYPES.join('|')}>", "cost_per_referral_eur": <number>, "expected_referral_count": <number>, "expected_revenue_eur": <number>, "roi_pct": <number>, "target_tier": "<${REFERRAL_TIERS.join('|')}>" }
  ],
  "mlModels": [
    { "model": "<random_forest|xgboost|neural_net|graph_neural_net|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<referral_probability|network_influence|conversion_prediction|viral_forecast>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "referral_prediction_score": <number 0-100>, "referral_grade": "<A|B|C|D|F>", "total_referral_potential_eur": <number>,
    "super_advocates_count": <number>, "avg_referral_probability_pct": <number 0-100>,
    "biggest_referral_risk": "<max 100 znakov>", "biggest_referral_opportunity": "<max 100 znakov>",
    "quickest_referral_win": "<max 100 znakov>", "referral_analysis_score": <number 0-100>
  }
}`;
}

function transformPredictor(parsed: any, targetBuyers: BuyerInfo[]): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    overview: {
      totalBuyers: Math.max(0, Number(parsed?.overview?.total_buyers ?? targetBuyers.length)),
      avgReferralProbabilityPct: clamp(Number(parsed?.overview?.avg_referral_probability_pct ?? 30), 0, 100),
      superAdvocatesCount: Math.max(0, Number(parsed?.overview?.super_advocates_count ?? 0)),
      detractorsCount: Math.max(0, Number(parsed?.overview?.detractors_count ?? 0)),
      estimatedAnnualReferrals: Math.max(0, Number(parsed?.overview?.estimated_annual_referrals ?? 0)),
      estimatedReferralValueEur: Math.round(Number(parsed?.overview?.estimated_referral_value_eur ?? 0)),
      referralGrade: includes(GRADES, String(parsed?.overview?.referral_grade)) ? String(parsed.overview.referral_grade) : 'C',
    },
    buyers: (parsed?.buyers || []).slice(0, 25).map((b: any) => ({
      name: String(b?.name ?? '').slice(0, 100),
      referralProbabilityPct: clamp(Number(b?.referral_probability_pct ?? 30), 0, 100),
      referralTier: includes(REFERRAL_TIERS, String(b?.referral_tier)) ? String(b.referral_tier) : 'potential_referrer',
      estimatedReferralsPerYear: Math.max(0, Number(b?.estimated_referrals_per_year ?? 0)),
      estimatedReferralValueEur: Math.round(Number(b?.estimated_referral_value_eur ?? 0)),
      networkReachScore: clamp(Number(b?.network_reach_score ?? 50), 0, 100),
      influenceScore: clamp(Number(b?.influence_score ?? 50), 0, 100),
      recommendedIncentive: includes(INCENTIVE_TYPES, String(b?.recommended_incentive)) ? String(b.recommended_incentive) : 'discount_coupon',
    })),
    referralPotential: (parsed?.referralPotential || []).slice(0, 25).map((r: any) => ({
      buyerName: String(r?.buyer_name ?? '').slice(0, 100),
      currentReferralsMade: Math.max(0, Number(r?.current_referrals_made ?? 0)),
      potentialReferrals12m: Math.max(0, Number(r?.potential_referrals_12m ?? 0)),
      conversionRateOfReferralsPct: clamp(Number(r?.conversion_rate_of_referrals_pct ?? 40), 0, 100),
      avgReferredBuyerValueEur: Math.round(Number(r?.avg_referred_buyer_value_eur ?? 0)),
      totalReferralValueEur: Math.round(Number(r?.total_referral_value_eur ?? 0)),
      bestTiming: includes(TIMINGS, String(r?.best_timing)) ? String(r.best_timing) : 'post_purchase',
    })),
    networkAnalysis: (parsed?.networkAnalysis || []).slice(0, 25).map((n: any) => ({
      buyerName: String(n?.buyer_name ?? '').slice(0, 100),
      networkSizeEstimate: Math.max(0, Number(n?.network_size_estimate ?? 50)),
      networkInfluencePct: clamp(Number(n?.network_influence_pct ?? 40), 0, 100),
      socialProofPotential: includes(SOCIAL_PROOF, String(n?.social_proof_potential)) ? String(n.social_proof_potential) : 'medium',
      viralCoefficient: clamp(Number(n?.viral_coefficient ?? 0.5), 0, 2),
      amplificationFactor: clamp(Number(n?.amplification_factor ?? 1), 1, 10),
    })),
    incentives: (parsed?.incentives || []).slice(0, 8).map((i: any) => ({
      incentiveType: includes(INCENTIVE_TYPES, String(i?.incentive_type)) ? String(i.incentive_type) : 'discount_coupon',
      costPerReferralEur: round2(i?.cost_per_referral_eur ?? 0),
      expectedReferralCount: Math.max(0, Number(i?.expected_referral_count ?? 0)),
      expectedRevenueEur: Math.round(Number(i?.expected_revenue_eur ?? 0)),
      roiPct: round1(i?.roi_pct ?? 0),
      targetTier: includes(REFERRAL_TIERS, String(i?.target_tier)) ? String(i.target_tier) : 'advocate',
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: includes(ML_MODELS, String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: clamp(Number(m?.accuracy_pct ?? 75), 0, 100),
      predictionType: includes(ML_PREDICTION_TYPES, String(m?.prediction_type)) ? String(m.prediction_type) : 'referral_probability',
      weightInEnsemble: clamp(Number(m?.weight_in_ensemble ?? 20), 0, 100),
    })),
    summary: {
      referralPredictionScore: clamp(Number(parsed?.summary?.referral_prediction_score ?? 50), 0, 100),
      referralGrade: includes(GRADES, String(parsed?.summary?.referral_grade)) ? String(parsed.summary.referral_grade) : 'C',
      totalReferralPotentialEur: Math.round(Number(parsed?.summary?.total_referral_potential_eur ?? 0)),
      superAdvocatesCount: Math.max(0, Number(parsed?.summary?.super_advocates_count ?? 0)),
      avgReferralProbabilityPct: clamp(Number(parsed?.summary?.avg_referral_probability_pct ?? 30), 0, 100),
      biggestReferralRisk: String(parsed?.summary?.biggest_referral_risk ?? '').slice(0, 200),
      biggestReferralOpportunity: String(parsed?.summary?.biggest_referral_opportunity ?? '').slice(0, 200),
      quickestReferralWin: String(parsed?.summary?.quickest_referral_win ?? '').slice(0, 200),
      referralAnalysisScore: clamp(Number(parsed?.summary?.referral_analysis_score ?? 50), 0, 100),
    },
  };
}
