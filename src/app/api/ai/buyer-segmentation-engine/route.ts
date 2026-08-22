// v6.82 / v8.94-refactor: AI Buyer Segmentation Engine — ML segmentacija kupcev z RFM in clustering
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-segmentation-engine
// Body: { customerName?: string }
// Returns: { ok, engine: { overview, segments, rfmAnalysis, segmentStrategies, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const SEGMENT_TYPES = ['champions', 'loyal', 'potential_loyalists', 'new_customers', 'promising', 'need_attention', 'about_to_sleep', 'at_risk', 'cannot_lose_them', 'hibernating', 'lost'] as const;
const STRATEGY_TYPES = ['reward', 'retain', 'activate', 'reactivate', 'win_back', 'educate', 'upsell', 'say_goodbye'] as const;

interface BuyerSegmentationInput {
  customerName: string | null;
}

export const POST = withAiRoute<BuyerSegmentationInput>({
  endpoint: '/api/ai/buyer-segmentation-engine',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      customerName: body?.customerName ? String(body.customerName).trim() : null,
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { customerName } = input;

    // 1. Pridobi prodane trade-e
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: {
        id: true, title: true, category: true, sellPrice: true, sellFees: true,
        sellDate: true, sellLocation: true, buyDate: true,
      },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, engine: null, message: 'Ni prodaj za segmentacijo.' });
    }

    // 2. Zgradi RFM analizo kupcev
    const buyers = buildBuyerRfm(soldTrades);

    if (customerName) {
      const f = buyers.filter(b => b.name === customerName);
      if (f.length === 0) {
        return apiOk({ ok: true, engine: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    // 3. AI klic
    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const prompt = buildPrompt(targetBuyers);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    // 4. Transformacija rezultatov
    const engine = transformEngine(parsed, targetBuyers);

    return apiOk({ ok: true, engine });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface BuyerRfm {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrder: number;
  firstPurchase: Date | null;
  lastPurchase: Date | null;
  categories: Set<string>;
  daysSinceLast: number;
  recency: number;
  frequency: number;
  monetary: number;
}

/**
 * Zgradi RFM (Recency, Frequency, Monetary) analizo iz prodanih trade-ov.
 * Group-a po sellLocation (ime kupca) in izračuna R/F/M score-ve.
 */
function buildBuyerRfm(soldTrades: Array<{
  id: string; title: string; category: string | null;
  sellPrice: number | null; sellFees: number | null;
  sellDate: Date | null; sellLocation: string | null;
  buyDate: Date | null;
}>): BuyerRfm[] {
  const buyerMap = new Map<string, BuyerRfm>();
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
        categories: new Set(), daysSinceLast: 0,
        recency: 0, frequency: 0, monetary: 0,
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
    b.recency = Math.max(1, 100 - Math.min(100, Math.round(b.daysSinceLast / 3)));
    b.frequency = Math.min(100, b.purchases * 10);
    b.monetary = Math.min(100, Math.round(b.totalSpent / 50));
    return b;
  });
}

/**
 * Zgradi AI prompt za buyer segmentation.
 * Besedilo IDENTIČNO originalu (v6.82).
 */
function buildPrompt(targetBuyers: BuyerRfm[]): string {
  const buyersStr = targetBuyers.slice(0, 10).map(b =>
    `- ${b.name} | R:${b.recency} F:${b.frequency} M:${b.monetary} | ${b.purchases}x | ${b.totalSpent}€ | ${b.daysSinceLast}d`
  ).join('\n');

  return `Si AI buyer segmentation engine z ML in RFM analizo.
Segmentira kupce v 11 tipov z RFM (Recency, Frequency, Monetary) in predlaga 8 strategij.

KUPCI (${targetBuyers.length}):
${buyersStr}

11 segmentov (RFM-based):
1. CHAMPIONS: R>90, F>80, M>80 (najboljši)
2. LOYAL: F>70 (dosledno)
3. POTENTIAL_LOYALISTS: R>70, F<60 (obetavni)
4. NEW_CUSTOMERS: F=1, R>80
5. PROMISING: R>60, F<40
6. NEED_ATTENTION: R 40-60
7. ABOUT_TO_SLEEP: R 30-50, F<50
8. AT_RISK: R 10-30, F>60
9. CANNOT_LOSE_THEM: R<20, F>80, M>80
10. HIBERNATING: R<20, F<30
11. LOST: R<10, F<20

8 strategij: reward, retain, activate, reactivate, win_back, educate, upsell, say_goodbye

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_buyers": <number>, "total_revenue_eur": <number>, "avg_recency_score": <number 0-100>, "avg_frequency_score": <number 0-100>, "avg_monetary_score": <number 0-100>, "segmentation_confidence_pct": <number 0-100>, "segmentation_grade": "<A|B|C|D|F>" },
  "segments": [
    { "segment_type": "<${SEGMENT_TYPES.join('|')}>", "buyer_count": <number>, "buyer_pct": <number 0-100>, "total_revenue_eur": <number>, "revenue_pct": <number 0-100>, "avg_recency": <number 0-100>, "avg_frequency": <number 0-100>, "avg_monetary": <number 0-100>, "avg_order_value_eur": <number>, "retention_rate_pct": <number 0-100> }
  ],
  "rfmAnalysis": [
    { "buyer_name": "<string>", "recency_score": <number 0-100>, "frequency_score": <number 0-100>, "monetary_score": <number 0-100>, "rfm_segment": "<${SEGMENT_TYPES.join('|')}>", "rfm_score_combined": <number 0-100>, "predicted_clv_eur": <number>, "recommended_strategy": "<${STRATEGY_TYPES.join('|')}>" }
  ],
  "segmentStrategies": [
    { "segment_type": "<${SEGMENT_TYPES.join('|')}>", "strategy_type": "<${STRATEGY_TYPES.join('|')}>", "strategy_description": "<max 200 znakov>", "estimated_cost_eur": <number>, "expected_revenue_lift_eur": <number>, "implementation_days": <number>, "expected_conversion_rate_pct": <number 0-100> }
  ],
  "mlModels": [
    { "model": "<k-means|dbscan|gmm|hdbscan|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<segment_classification|clv_prediction|churn_risk|behavior_pattern>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "segmentation_quality_score": <number 0-100>, "segmentation_grade": "<A|B|C|D|F>", "total_revenue_eur": <number>,
    "champions_count": <number>, "lost_count": <number>,
    "biggest_segmentation_risk": "<max 100 znakov>", "biggest_segmentation_opportunity": "<max 100 znakov>",
    "quickest_segmentation_win": "<max 100 znakov>", "segmentation_analysis_score": <number 0-100>
  }
}`;
}

/**
 * Transformiraj AI JSON v engine objekt z vsemi clamp-i in whitelist-i.
 * Logika IDENTIČNA originalu (v6.82).
 */
function transformEngine(parsed: any, targetBuyers: BuyerRfm[]): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    overview: {
      totalBuyers: Math.max(0, Number(parsed?.overview?.total_buyers ?? targetBuyers.length)),
      totalRevenueEur: Math.round(Number(parsed?.overview?.total_revenue_eur ?? targetBuyers.reduce((s, b) => s + b.totalSpent, 0))),
      avgRecencyScore: Math.max(0, Math.min(100, Number(parsed?.overview?.avg_recency_score ?? 50))),
      avgFrequencyScore: Math.max(0, Math.min(100, Number(parsed?.overview?.avg_frequency_score ?? 50))),
      avgMonetaryScore: Math.max(0, Math.min(100, Number(parsed?.overview?.avg_monetary_score ?? 50))),
      segmentationConfidencePct: Math.max(0, Math.min(100, Number(parsed?.overview?.segmentation_confidence_pct ?? 70))),
      segmentationGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.segmentation_grade)) ? String(parsed.overview.segmentation_grade) : 'C',
    },
    segments: (parsed?.segments || []).slice(0, 11).map((s: any) => ({
      segmentType: (SEGMENT_TYPES as readonly string[]).includes(String(s?.segment_type)) ? String(s.segment_type) : 'need_attention',
      buyerCount: Math.max(0, Number(s?.buyer_count ?? 0)),
      buyerPct: Math.max(0, Math.min(100, Number(s?.buyer_pct ?? 0))),
      totalRevenueEur: Math.round(Number(s?.total_revenue_eur ?? 0)),
      revenuePct: Math.max(0, Math.min(100, Number(s?.revenue_pct ?? 0))),
      avgRecency: Math.max(0, Math.min(100, Number(s?.avg_recency ?? 0))),
      avgFrequency: Math.max(0, Math.min(100, Number(s?.avg_frequency ?? 0))),
      avgMonetary: Math.max(0, Math.min(100, Number(s?.avg_monetary ?? 0))),
      avgOrderValueEur: Math.round(Number(s?.avg_order_value_eur ?? 0)),
      retentionRatePct: Math.max(0, Math.min(100, Number(s?.retention_rate_pct ?? 50))),
    })),
    rfmAnalysis: (parsed?.rfmAnalysis || []).slice(0, 25).map((r: any) => ({
      buyerName: String(r?.buyer_name ?? '').slice(0, 100),
      recencyScore: Math.max(0, Math.min(100, Number(r?.recency_score ?? 50))),
      frequencyScore: Math.max(0, Math.min(100, Number(r?.frequency_score ?? 50))),
      monetaryScore: Math.max(0, Math.min(100, Number(r?.monetary_score ?? 50))),
      rfmSegment: (SEGMENT_TYPES as readonly string[]).includes(String(r?.rfm_segment)) ? String(r.rfm_segment) : 'need_attention',
      rfmScoreCombined: Math.max(0, Math.min(100, Number(r?.rfm_score_combined ?? 50))),
      predictedClvEur: Math.round(Number(r?.predicted_clv_eur ?? 0)),
      recommendedStrategy: (STRATEGY_TYPES as readonly string[]).includes(String(r?.recommended_strategy)) ? String(r.recommended_strategy) : 'retain',
    })),
    segmentStrategies: (parsed?.segmentStrategies || []).slice(0, 11).map((s: any) => ({
      segmentType: (SEGMENT_TYPES as readonly string[]).includes(String(s?.segment_type)) ? String(s.segment_type) : 'need_attention',
      strategyType: (STRATEGY_TYPES as readonly string[]).includes(String(s?.strategy_type)) ? String(s.strategy_type) : 'retain',
      strategyDescription: String(s?.strategy_description ?? '').slice(0, 400),
      estimatedCostEur: Math.round(Number(s?.estimated_cost_eur ?? 0)),
      expectedRevenueLiftEur: Math.round(Number(s?.expected_revenue_lift_eur ?? 0)),
      implementationDays: Math.max(1, Number(s?.implementation_days ?? 7)),
      expectedConversionRatePct: Math.max(0, Math.min(100, Number(s?.expected_conversion_rate_pct ?? 30))),
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['k-means', 'dbscan', 'gmm', 'hdbscan', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: ['segment_classification', 'clv_prediction', 'churn_risk', 'behavior_pattern'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'segment_classification',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      segmentationQualityScore: Math.max(0, Math.min(100, Number(parsed?.summary?.segmentation_quality_score ?? 50))),
      segmentationGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.segmentation_grade)) ? String(parsed.summary.segmentation_grade) : 'C',
      totalRevenueEur: Math.round(Number(parsed?.summary?.total_revenue_eur ?? 0)),
      championsCount: Math.max(0, Number(parsed?.summary?.champions_count ?? 0)),
      lostCount: Math.max(0, Number(parsed?.summary?.lost_count ?? 0)),
      biggestSegmentationRisk: String(parsed?.summary?.biggest_segmentation_risk ?? '').slice(0, 200),
      biggestSegmentationOpportunity: String(parsed?.summary?.biggest_segmentation_opportunity ?? '').slice(0, 200),
      quickestSegmentationWin: String(parsed?.summary?.quickest_segmentation_win ?? '').slice(0, 200),
      segmentationAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.segmentation_analysis_score ?? 50))),
    },
  };
}
