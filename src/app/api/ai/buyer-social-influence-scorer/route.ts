// v6.92 / v8.95.4-batch3: AI Buyer Social Influence Scorer — ML ocena socialnega vpliva kupcev z network analysis
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-social-influence-scorer
// Body: { customerName?: string }
// Returns: { ok, scorer: { overview, buyers, influenceFactors, networkMetrics, recommendations, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BuyerSocialInfluenceScorerInput {
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

interface BuyerRow {
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

const INFLUENCE_TIERS = ['mega_influencer', 'macro_influencer', 'micro_influencer', 'local_influencer', 'connected_buyer', 'average_buyer', 'isolated_buyer'] as const;
const INFLUENCE_FACTORS = ['network_size', 'social_proof_generation', 'referral_frequency', 'review_impact', 'community_standing', 'cross_platform_presence', 'engagement_magnitude', 'trust_amplification', 'viral_potential', 'advocacy_consistency'] as const;
const PARTNERSHIP_TYPES = ['brand_ambassador', 'affiliate', 'reviewer', 'testimonial', 'referral_partner', 'none'] as const;
const NETWORK_POSITIONS = ['hub', 'bridge', 'peripheral', 'isolated'] as const;
const ML_MODELS = ['graph_neural_net', 'random_forest', 'xgboost', 'neural_net', 'ensemble'] as const;
const PREDICTION_TYPES = ['influence_prediction', 'network_analysis', 'referral_forecast', 'viral_prediction'] as const;

export const POST = withAiRoute<BuyerSocialInfluenceScorerInput>({
  endpoint: '/api/ai/buyer-social-influence-scorer',
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
      take: 500, orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, scorer: null, message: 'Ni prodaj za social influence analizo.' });
    }

    const buyers = buildBuyers(soldTrades);

    if (customerName) {
      const f = buyers.filter(b => b.name === customerName);
      if (f.length === 0) {
        return apiOk({ ok: true, scorer: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const prompt = buildPrompt(targetBuyers);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const scorer = transformScorer(parsed, targetBuyers);

    return apiOk({ ok: true, scorer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildBuyers(soldTrades: SoldTradeRow[]): BuyerRow[] {
  const buyerMap = new Map<string, BuyerRow>();
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
  const buyers = Array.from(buyerMap.values());
  for (const b of buyers) {
    b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0;
    b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / DAY) : 999;
    b.lifetimeDays = b.firstPurchase ? Math.round((now - b.firstPurchase.getTime()) / DAY) : 0;
  }
  return buyers;
}

function buildPrompt(targetBuyers: BuyerRow[]): string {
  const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.lifetimeDays}d | ${b.categories.size} kat`).join('\n');

  return `Si AI buyer social influence scorer z ML in network analysis.
Ocenjuje socialni vpliv kupcev z 7 tierji in 10 dejavniki.

KUPCI (${targetBuyers.length}):
${buyersStr}

7 vplivnih tierjev:
1. MEGA_INFLUENCER: ogromen vpliv (>10000 followers)
2. MACRO_INFLUENCER: velik vpliv (1000-10000)
3. MICRO_INFLUENCER: srednji vpliv (100-1000)
4. LOCAL_INFLUENCER: lokalni vpliv (10-100)
5. CONNECTED_BUYER: povezan kupec (1-10)
6. AVERAGE_BUYER: povprečen kupec
7. ISOLATED_BUYER: izoliran kupec

10 dejavnikov vpliva: network_size, social_proof_generation, referral_frequency, review_impact, community_standing, cross_platform_presence, engagement_magnitude, trust_amplification, viral_potential, advocacy_consistency

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_buyers": <number>, "avg_influence_score": <number 0-100>, "influencer_count": <number>, "mega_influencer_count": <number>, "total_network_reach": <number>, "influence_grade": "<A|B|C|D|F>" },
  "buyers": [
    { "name": "<string>", "influence_score": <number 0-100>, "influence_tier": "<${INFLUENCE_TIERS.join('|')}>", "estimated_network_reach": <number>, "estimated_referral_value_eur": <number>, "advocacy_score": <number 0-100>, "viral_coefficient": <number 0-2>, "recommended_partnership": "<brand_ambassador|affiliate|reviewer|testimonial|referral_partner|none>" }
  ],
  "influenceFactors": [
    { "factor": "<${INFLUENCE_FACTORS.join('|')}>", "avg_score": <number 0-100>, "weight_pct": <number 0-100>, "impact_on_influence": "<high|medium|low>", "improvement_potential_pct": <number 0-50>, "improvement_strategy": "<max 120 znakov>" }
  ],
  "networkMetrics": [
    { "buyer_name": "<string>", "betweenness_centrality": <number 0-100>, "eigenvector_centrality": <number 0-100>, "clustering_coefficient": <number 0-1>, "network_position": "<hub|bridge|peripheral|isolated>", "influence_radius": <number> }
  ],
  "recommendations": [
    { "buyer_name": "<string>", "action": "<max 150 znakov>", "partnership_type": "<brand_ambassador|affiliate|reviewer|testimonial|referral_partner|none>", "expected_reach": <number>, "expected_revenue_eur": <number>, "cost_eur": <number>, "roi_pct": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<graph_neural_net|random_forest|xgboost|neural_net|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<influence_prediction|network_analysis|referral_forecast|viral_prediction>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "social_influence_score": <number 0-100>, "influence_grade": "<A|B|C|D|F>", "total_network_reach": <number>,
    "influencer_count": <number>, "total_influence_value_eur": <number>,
    "biggest_influence_risk": "<max 100 znakov>", "biggest_influence_opportunity": "<max 100 znakov>",
    "quickest_influence_win": "<max 100 znakov>", "influence_analysis_score": <number 0-100>
  }
}`;
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

function transformScorer(parsed: any, targetBuyers: BuyerRow[]): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    overview: {
      totalBuyers: Math.max(0, Number(parsed?.overview?.total_buyers ?? targetBuyers.length)),
      avgInfluenceScore: clamp(Number(parsed?.overview?.avg_influence_score ?? 40), 0, 100),
      influencerCount: Math.max(0, Number(parsed?.overview?.influencer_count ?? 0)),
      megaInfluencerCount: Math.max(0, Number(parsed?.overview?.mega_influencer_count ?? 0)),
      totalNetworkReach: Math.max(0, Number(parsed?.overview?.total_network_reach ?? 0)),
      influenceGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.influence_grade)) ? String(parsed.overview.influence_grade) : 'C',
    },
    buyers: (parsed?.buyers || []).slice(0, 25).map((b: any) => ({
      name: String(b?.name ?? '').slice(0, 100),
      influenceScore: clamp(Number(b?.influence_score ?? 40), 0, 100),
      influenceTier: includes(INFLUENCE_TIERS, String(b?.influence_tier)) ? String(b.influence_tier) : 'average_buyer',
      estimatedNetworkReach: Math.max(0, Number(b?.estimated_network_reach ?? 50)),
      estimatedReferralValueEur: Math.round(Number(b?.estimated_referral_value_eur ?? 0)),
      advocacyScore: clamp(Number(b?.advocacy_score ?? 40), 0, 100),
      viralCoefficient: clamp(Number(b?.viral_coefficient ?? 0.5), 0, 2),
      recommendedPartnership: includes(PARTNERSHIP_TYPES, String(b?.recommended_partnership)) ? String(b.recommended_partnership) : 'referral_partner',
    })),
    influenceFactors: (parsed?.influenceFactors || []).slice(0, 10).map((f: any) => ({
      factor: includes(INFLUENCE_FACTORS, String(f?.factor)) ? String(f.factor) : 'network_size',
      avgScore: clamp(Number(f?.avg_score ?? 40), 0, 100),
      weightPct: clamp(Number(f?.weight_pct ?? 10), 0, 100),
      impactOnInfluence: ['high', 'medium', 'low'].includes(String(f?.impact_on_influence)) ? String(f.impact_on_influence) : 'medium',
      improvementPotentialPct: clamp(Number(f?.improvement_potential_pct ?? 20), 0, 50),
      improvementStrategy: String(f?.improvement_strategy ?? '').slice(0, 250),
    })),
    networkMetrics: (parsed?.networkMetrics || []).slice(0, 25).map((n: any) => ({
      buyerName: String(n?.buyer_name ?? '').slice(0, 100),
      betweennessCentrality: clamp(Number(n?.betweenness_centrality ?? 30), 0, 100),
      eigenvectorCentrality: clamp(Number(n?.eigenvector_centrality ?? 30), 0, 100),
      clusteringCoefficient: clamp(Number(n?.clustering_coefficient ?? 0.3), 0, 1),
      networkPosition: includes(NETWORK_POSITIONS, String(n?.network_position)) ? String(n.network_position) : 'peripheral',
      influenceRadius: Math.max(0, Number(n?.influence_radius ?? 10)),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 10).map((r: any) => ({
      buyerName: String(r?.buyer_name ?? '').slice(0, 100),
      action: String(r?.action ?? '').slice(0, 300),
      partnershipType: includes(PARTNERSHIP_TYPES, String(r?.partnership_type)) ? String(r.partnership_type) : 'referral_partner',
      expectedReach: Math.max(0, Number(r?.expected_reach ?? 0)),
      expectedRevenueEur: Math.round(Number(r?.expected_revenue_eur ?? 0)),
      costEur: Math.round(Number(r?.cost_eur ?? 0)),
      roiPct: round1(r?.roi_pct ?? 0),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: includes(ML_MODELS, String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: clamp(Number(m?.accuracy_pct ?? 75), 0, 100),
      predictionType: includes(PREDICTION_TYPES, String(m?.prediction_type)) ? String(m.prediction_type) : 'influence_prediction',
      weightInEnsemble: clamp(Number(m?.weight_in_ensemble ?? 20), 0, 100),
    })),
    summary: {
      socialInfluenceScore: clamp(Number(parsed?.summary?.social_influence_score ?? 50), 0, 100),
      influenceGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.influence_grade)) ? String(parsed.summary.influence_grade) : 'C',
      totalNetworkReach: Math.max(0, Number(parsed?.summary?.total_network_reach ?? 0)),
      influencerCount: Math.max(0, Number(parsed?.summary?.influencer_count ?? 0)),
      totalInfluenceValueEur: Math.round(Number(parsed?.summary?.total_influence_value_eur ?? 0)),
      biggestInfluenceRisk: String(parsed?.summary?.biggest_influence_risk ?? '').slice(0, 200),
      biggestInfluenceOpportunity: String(parsed?.summary?.biggest_influence_opportunity ?? '').slice(0, 200),
      quickestInfluenceWin: String(parsed?.summary?.quickest_influence_win ?? '').slice(0, 200),
      influenceAnalysisScore: clamp(Number(parsed?.summary?.influence_analysis_score ?? 50), 0, 100),
    },
  };
}
