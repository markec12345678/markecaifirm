// v6.76 / v8.95.3-batch1: AI Buyer Acquisition Cost Optimizer — optimizira CAC z ML in channel analysis
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-acquisition-cost-optimizer
// Body: { monthsAhead?: number }
// Returns: { ok, optimizer: { current, channels, optimizations, projections, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BuyerAcquisitionCostOptimizerInput {
  monthsAhead: number;
}

interface SoldTradeRow {
  id: string;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  sellLocation: string;
}

const ACQUISITION_CHANNELS = [
  'bolha_organic', 'facebook_organic', 'vinted_organic', 'referral', 'social_media',
  'email_marketing', 'cross_posting', 'flash_sale', 'bundle_attract', 'local_community',
] as const;

export const POST = withAiRoute<BuyerAcquisitionCostOptimizerInput>({
  endpoint: '/api/ai/buyer-acquisition-cost-optimizer',
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
      where: {
        status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null },
      },
      select: { id: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, optimizer: null, message: 'Ni prodaj za CAC optimizacijo.' });
    }

    const totalBuyers = new Set(soldTrades.map(t => t.sellLocation)).size;
    const totalRevenue = soldTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
    const avgRevenuePerBuyer = Math.round(totalRevenue / Math.max(1, totalBuyers));

    const prompt = buildPrompt(monthsAhead, totalBuyers, totalRevenue, avgRevenuePerBuyer);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const optimizer = transformOptimizer(parsed, totalBuyers, avgRevenuePerBuyer, monthsAhead);

    return apiOk({ ok: true, optimizer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildPrompt(
  monthsAhead: number,
  totalBuyers: number,
  totalRevenue: number,
  avgRevenuePerBuyer: number
): string {
  return `Si AI buyer acquisition cost optimizer z ML in channel analysis.
Optimizira CAC za ${monthsAhead} mesecev z 10 kanali.

STATS:
- Skupno kupcev: ${totalBuyers}
- Skupni prihodek: ${Math.round(totalRevenue)}€
- Povp prihodek per kupec: ${avgRevenuePerBuyer}€

10 acquisition kanalov:
1. BOLHA_ORGANIC: organski Bolha search
2. FACEBOOK_ORGANIC: organski Facebook
3. VINTED_ORGANIC: organski Vinted
4. REFERRAL: priporočila
5. SOCIAL_MEDIA: socialni mediji
6. EMAIL_MARKETING: email kampanje
7. CROSS_POSTING: cross-posting
8. FLASH_SALE: flash sale privabi
9. BUNDLE_ATTRACT: bundle privabi
10. LOCAL_COMMUNITY: lokalna skupnost

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": { "total_buyers": <number>, "avg_cac_eur": <number>, "avg_ltv_eur": <number>, "ltv_cac_ratio": <number>, "cac_efficiency_pct": <number 0-100>, "acquisition_grade": "<A|B|C|D|F>" },
  "channels": [
    { "channel": "<10 kanalov>", "current_buyers_acquired": <number>, "current_cac_eur": <number>, "current_revenue_eur": <number>, "current_roi_pct": <number>, "optimized_cac_eur": <number>, "cac_reduction_pct": <number>, "expected_new_buyers": <number>, "expected_revenue_eur": <number>, "optimization_potential": "<high|medium|low>", "recommended_action": "<scale_up|maintain|reduce|exit>" }
  ],
  "optimizations": [
    { "optimization_type": "<channel_reallocation|budget_optimization|referral_boost|content_marketing|cross_posting_expansion|bundle_strategy|flash_sale_optimization|community_building|email_automation|social_proof_leverage>", "description": "<max 120 znakov>", "current_cac_eur": <number>, "optimized_cac_eur": <number>, "cac_savings_eur": <number>, "expected_new_buyers": <number>, "expected_revenue_increase_eur": <number>, "implementation_difficulty": "<low|medium|high>", "timeframe_days": <number> }
  ],
  "projections": [
    { "month": <1-12>, "projected_new_buyers": <number>, "projected_avg_cac_eur": <number>, "projected_total_cac_eur": <number>, "projected_revenue_from_new_eur": <number>, "projected_roi_pct": <number>, "confidence_pct": <number 0-100> }
  ],
  "mlModels": [
    { "model": "<random_forest|gradient_boosting|neural_network|lstm|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<cac_forecast|channel_performance|buyer_acquisition|optimal_allocation>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "current_avg_cac_eur": <number>, "optimized_avg_cac_eur": <number>, "cac_reduction_pct": <number>,
    "total_expected_new_buyers": <number>, "total_expected_revenue_increase_eur": <number>,
    "best_channel": "<10 kanalov>", "biggest_cac_opportunity": "<max 100 znakov>",
    "quickest_cac_win": "<max 100 znakov>", "cac_optimization_score": <number 0-100>
  }
}`;
}

const OPTIMIZATION_TYPES = [
  'channel_reallocation', 'budget_optimization', 'referral_boost', 'content_marketing',
  'cross_posting_expansion', 'bundle_strategy', 'flash_sale_optimization',
  'community_building', 'email_automation', 'social_proof_leverage',
] as const;

const ML_MODELS = ['random_forest', 'gradient_boosting', 'neural_network', 'lstm', 'ensemble'] as const;
const ML_PREDICTION_TYPES = ['cac_forecast', 'channel_performance', 'buyer_acquisition', 'optimal_allocation'] as const;

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function round2(n: number): number {
  return Math.round(Number(n) * 100) / 100;
}

function round1(n: number): number {
  return Math.round(Number(n) * 10) / 10;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function transformOptimizer(
  parsed: any,
  totalBuyers: number,
  avgRevenuePerBuyer: number,
  monthsAhead: number
): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    current: {
      totalBuyers: Math.max(0, Number(parsed?.current?.total_buyers ?? totalBuyers)),
      avgCacEur: round2(parsed?.current?.avg_cac_eur ?? 0),
      avgLtvEur: Math.round(Number(parsed?.current?.avg_ltv_eur ?? avgRevenuePerBuyer)),
      ltvCacRatio: round2(parsed?.current?.ltv_cac_ratio ?? 3),
      cacEfficiencyPct: clamp(Number(parsed?.current?.cac_efficiency_pct ?? 60), 0, 100),
      acquisitionGrade:
        ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.current?.acquisition_grade))
          ? String(parsed.current.acquisition_grade)
          : 'C',
    },
    channels: (parsed?.channels || []).slice(0, 10).map((c: any) => ({
      channel: includes(ACQUISITION_CHANNELS, String(c?.channel)) ? String(c.channel) : 'bolha_organic',
      currentBuyersAcquired: Math.max(0, Number(c?.current_buyers_acquired ?? 0)),
      currentCacEur: round2(c?.current_cac_eur ?? 0),
      currentRevenueEur: Math.round(Number(c?.current_revenue_eur ?? 0)),
      currentRoiPct: round1(c?.current_roi_pct ?? 0),
      optimizedCacEur: round2(c?.optimized_cac_eur ?? 0),
      cacReductionPct: round1(c?.cac_reduction_pct ?? 0),
      expectedNewBuyers: Math.max(0, Number(c?.expected_new_buyers ?? 0)),
      expectedRevenueEur: Math.round(Number(c?.expected_revenue_eur ?? 0)),
      optimizationPotential:
        ['high', 'medium', 'low'].includes(String(c?.optimization_potential))
          ? String(c.optimization_potential)
          : 'medium',
      recommendedAction:
        ['scale_up', 'maintain', 'reduce', 'exit'].includes(String(c?.recommended_action))
          ? String(c.recommended_action)
          : 'maintain',
    })),
    optimizations: (parsed?.optimizations || []).slice(0, 10).map((o: any) => ({
      optimizationType: includes(OPTIMIZATION_TYPES, String(o?.optimization_type))
        ? String(o.optimization_type)
        : 'channel_reallocation',
      description: String(o?.description ?? '').slice(0, 250),
      currentCacEur: round2(o?.current_cac_eur ?? 0),
      optimizedCacEur: round2(o?.optimized_cac_eur ?? 0),
      cacSavingsEur: Math.round(Number(o?.cac_savings_eur ?? 0)),
      expectedNewBuyers: Math.max(0, Number(o?.expected_new_buyers ?? 0)),
      expectedRevenueIncreaseEur: Math.round(Number(o?.expected_revenue_increase_eur ?? 0)),
      implementationDifficulty:
        ['low', 'medium', 'high'].includes(String(o?.implementation_difficulty))
          ? String(o.implementation_difficulty)
          : 'medium',
      timeframeDays: Math.max(1, Number(o?.timeframe_days ?? 7)),
    })),
    projections: (parsed?.projections || [])
      .slice(0, monthsAhead)
      .map((p: any) => ({
        month: Math.max(1, Math.min(12, Number(p?.month ?? 1))),
        projectedNewBuyers: Math.max(0, Number(p?.projected_new_buyers ?? 0)),
        projectedAvgCacEur: round2(p?.projected_avg_cac_eur ?? 0),
        projectedTotalCacEur: Math.round(Number(p?.projected_total_cac_eur ?? 0)),
        projectedRevenueFromNewEur: Math.round(Number(p?.projected_revenue_from_new_eur ?? 0)),
        projectedRoiPct: round1(p?.projected_roi_pct ?? 0),
        confidencePct: clamp(Number(p?.confidence_pct ?? 50), 0, 100),
      })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: includes(ML_MODELS, String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: clamp(Number(m?.accuracy_pct ?? 75), 0, 100),
      predictionType: includes(ML_PREDICTION_TYPES, String(m?.prediction_type))
        ? String(m.prediction_type)
        : 'cac_forecast',
      weightInEnsemble: clamp(Number(m?.weight_in_ensemble ?? 20), 0, 100),
    })),
    summary: {
      currentAvgCacEur: round2(parsed?.summary?.current_avg_cac_eur ?? 0),
      optimizedAvgCacEur: round2(parsed?.summary?.optimized_avg_cac_eur ?? 0),
      cacReductionPct: round1(parsed?.summary?.cac_reduction_pct ?? 0),
      totalExpectedNewBuyers: Math.max(0, Number(parsed?.summary?.total_expected_new_buyers ?? 0)),
      totalExpectedRevenueIncreaseEur: Math.round(
        Number(parsed?.summary?.total_expected_revenue_increase_eur ?? 0)
      ),
      bestChannel: includes(ACQUISITION_CHANNELS, String(parsed?.summary?.best_channel))
        ? String(parsed.summary.best_channel)
        : 'bolha_organic',
      biggestCacOpportunity: String(parsed?.summary?.biggest_cac_opportunity ?? '').slice(0, 200),
      quickestCacWin: String(parsed?.summary?.quickest_cac_win ?? '').slice(0, 200),
      cacOptimizationScore: clamp(Number(parsed?.summary?.cac_optimization_score ?? 60), 0, 100),
    },
  };
}
