// v6.85 / v8.94-refactor: AI Buyer Feedback Analyzer — ML analiza povratnih informacij kupcev z NLP
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-feedback-analyzer
// Body: { customerName?: string, days?: number }
// Returns: { ok, analyzer: { overview, feedbacks, sentimentAnalysis, themes, actionItems, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const FEEDBACK_TYPES = ['product_quality', 'shipping_experience', 'communication', 'pricing', 'listing_accuracy', 'customer_service', 'return_process', 'overall_satisfaction'] as const;
const SENTIMENT_TYPES = ['very_positive', 'positive', 'neutral', 'negative', 'very_negative'] as const;
const THEME_CATEGORIES = ['quality_praise', 'quality_complaint', 'speed_praise', 'speed_complaint', 'price_positive', 'price_negative', 'communication_praise', 'communication_complaint', 'improvement_suggestion', 'recommendation'] as const;

interface BuyerFeedbackAnalyzerInput {
  customerName: string | null;
  days: number;
}

export const POST = withAiRoute<BuyerFeedbackAnalyzerInput>({
  endpoint: '/api/ai/buyer-feedback-analyzer',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      customerName: body?.customerName ? String(body.customerName).trim() : null,
      days: Math.max(7, Math.min(365, Number(body?.days ?? 90))),
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { customerName, days } = input;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // 1. Pridobi prodaje z neprazno sellLocation (proxy za buyer name)
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { gte: since, not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, notes: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, analyzer: null, message: 'Ni prodaj za feedback analizo.' });
    }

    // 2. Agregiraj po buyer imenu (sellLocation)
    const buyers = buildBuyerAggregates(soldTrades);

    if (customerName) {
      const matches = buyers.filter(b => b.name === customerName);
      if (matches.length === 0) {
        return apiOk({ ok: true, analyzer: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    // 3. Izberi target buyerje
    const targetBuyers = customerName
      ? buyers.filter(b => b.name === customerName)
      : buyers.slice(0, 25);

    // 4. AI klic
    const prompt = buildPrompt(targetBuyers);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    // 5. Transformacija rezultatov
    const analyzer = transformAnalyzer(parsed, targetBuyers);

    return apiOk({ ok: true, analyzer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) ---------------------------------

interface BuyerAggregate {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrder: number;
  items: string[];
  notes: string[];
}

function buildBuyerAggregates(soldTrades: Array<{
  title: string;
  sellPrice: number | null;
  sellFees: number | null;
  sellLocation: string | null;
  notes: string | null;
}>): BuyerAggregate[] {
  const buyerMap = new Map<string, BuyerAggregate>();
  for (const t of soldTrades) {
    const name = (t.sellLocation || '').trim();
    if (!name || name.length < 2) continue;
    const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    if (!buyerMap.has(name)) {
      buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, items: [], notes: [] });
    }
    const b = buyerMap.get(name)!;
    b.purchases += 1;
    b.totalSpent += rev;
    if (b.items.length < 5) b.items.push(t.title);
    if (t.notes && b.notes.length < 3) b.notes.push(t.notes.slice(0, 200));
  }
  return Array.from(buyerMap.values()).map(b => {
    b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0;
    return b;
  });
}

function buildPrompt(targetBuyers: BuyerAggregate[]): string {
  const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | naslov: ${b.items.slice(0, 2).join('; ')}`).join('\n');

  return `Si AI buyer feedback analyzer z ML in NLP za analizo povratnih informacij.
Analizira feedback z 8 tipi, 5 sentimenti in 10 tematskimi kategorijami.

KUPCI (${targetBuyers.length}):
${buyersStr}

8 tipov feedbacka:
1. PRODUCT_QUALITY: kakovost izdelka
2. SHIPPING_EXPERIENCE: izkušnja dostave
3. COMMUNICATION: komunikacija
4. PRICING: cenitev
5. LISTING_ACCURACY: natančnost oglasa
6. CUSTOMER_SERVICE: podpora
7. RETURN_PROCESS: postopek vračila
8. OVERALL_SATISFACTION: splošno zadovoljstvo

5 sentimentov: very_positive, positive, neutral, negative, very_negative

10 tematskih kategorij: quality_praise, quality_complaint, speed_praise, speed_complaint, price_positive, price_negative, communication_praise, communication_complaint, improvement_suggestion, recommendation

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_buyers_analyzed": <number>, "total_feedback_inferred": <number>, "avg_satisfaction_score": <number 0-100>, "positive_feedback_pct": <number 0-100>, "negative_feedback_pct": <number 0-100>, "feedback_grade": "<A|B|C|D|F>" },
  "feedbacks": [
    { "buyer_name": "<string>", "feedback_type": "<${FEEDBACK_TYPES.join('|')}>", "inferred_sentiment": "<${SENTIMENT_TYPES.join('|')}>", "satisfaction_score": <number 0-100>, "inferred_feedback_text": "<max 250 znakov>", "purchase_count": <number>, "total_spent_eur": <number>, "action_required": <boolean> }
  ],
  "sentimentAnalysis": [
    { "sentiment": "<${SENTIMENT_TYPES.join('|')}>", "buyer_count": <number>, "buyer_pct": <number 0-100>, "avg_satisfaction_score": <number 0-100>, "primary_driver": "<max 100 znakov>", "trend": "<improving|declining|stable>" }
  ],
  "themes": [
    { "theme": "<${THEME_CATEGORIES.join('|')}>", "occurrence_count": <number>, "occurrence_pct": <number 0-100>, "sentiment_correlation": "<positive|negative|neutral>", "key_phrases": "<max 200 znakov>", "impact_score": <number 0-100>, "recommended_response": "<max 150 znakov>" }
  ],
  "actionItems": [
    { "action": "<max 150 znakov>", "priority": "<critical|high|medium|low>", "target_buyer_count": <number>, "expected_satisfaction_lift_pct": <number 0-50>, "implementation_days": <number>, "responsible_area": "<product|shipping|communication|pricing|service>" }
  ],
  "mlModels": [
    { "model": "<bert|roberta|distilbert|t5|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<sentiment_analysis|theme_extraction|satisfaction_prediction|feedback_classification>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "feedback_analysis_score": <number 0-100>, "feedback_grade": "<A|B|C|D|F>", "avg_satisfaction_score": <number 0-100>,
    "positive_pct": <number 0-100>, "negative_pct": <number 0-100>,
    "biggest_feedback_risk": "<max 100 znakov>", "biggest_feedback_opportunity": "<max 100 znakov>",
    "quickest_feedback_win": "<max 100 znakov>", "feedback_analysis_score_v2": <number 0-100>
  }
}`;
}

function transformAnalyzer(parsed: any, targetBuyers: BuyerAggregate[]): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    overview: {
      totalBuyersAnalyzed: Math.max(0, Number(parsed?.overview?.total_buyers_analyzed ?? targetBuyers.length)),
      totalFeedbackInferred: Math.max(0, Number(parsed?.overview?.total_feedback_inferred ?? targetBuyers.length * 2)),
      avgSatisfactionScore: Math.max(0, Math.min(100, Number(parsed?.overview?.avg_satisfaction_score ?? 70))),
      positiveFeedbackPct: Math.max(0, Math.min(100, Number(parsed?.overview?.positive_feedback_pct ?? 60))),
      negativeFeedbackPct: Math.max(0, Math.min(100, Number(parsed?.overview?.negative_feedback_pct ?? 15))),
      feedbackGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.feedback_grade)) ? String(parsed.overview.feedback_grade) : 'C',
    },
    feedbacks: (parsed?.feedbacks || []).slice(0, 25).map((f: any) => ({
      buyerName: String(f?.buyer_name ?? '').slice(0, 100),
      feedbackType: (FEEDBACK_TYPES as readonly string[]).includes(String(f?.feedback_type)) ? String(f.feedback_type) : 'overall_satisfaction',
      inferredSentiment: (SENTIMENT_TYPES as readonly string[]).includes(String(f?.inferred_sentiment)) ? String(f.inferred_sentiment) : 'neutral',
      satisfactionScore: Math.max(0, Math.min(100, Number(f?.satisfaction_score ?? 70))),
      inferredFeedbackText: String(f?.inferred_feedback_text ?? '').slice(0, 500),
      purchaseCount: Math.max(0, Number(f?.purchase_count ?? 0)),
      totalSpentEur: Math.round(Number(f?.total_spent_eur ?? 0)),
      actionRequired: Boolean(f?.action_required ?? false),
    })),
    sentimentAnalysis: (parsed?.sentimentAnalysis || []).slice(0, 5).map((s: any) => ({
      sentiment: (SENTIMENT_TYPES as readonly string[]).includes(String(s?.sentiment)) ? String(s.sentiment) : 'neutral',
      buyerCount: Math.max(0, Number(s?.buyer_count ?? 0)),
      buyerPct: Math.max(0, Math.min(100, Number(s?.buyer_pct ?? 0))),
      avgSatisfactionScore: Math.max(0, Math.min(100, Number(s?.avg_satisfaction_score ?? 70))),
      primaryDriver: String(s?.primary_driver ?? '').slice(0, 200),
      trend: ['improving', 'declining', 'stable'].includes(String(s?.trend)) ? String(s.trend) : 'stable',
    })),
    themes: (parsed?.themes || []).slice(0, 10).map((t: any) => ({
      theme: (THEME_CATEGORIES as readonly string[]).includes(String(t?.theme)) ? String(t.theme) : 'improvement_suggestion',
      occurrenceCount: Math.max(0, Number(t?.occurrence_count ?? 0)),
      occurrencePct: Math.max(0, Math.min(100, Number(t?.occurrence_pct ?? 0))),
      sentimentCorrelation: ['positive', 'negative', 'neutral'].includes(String(t?.sentiment_correlation)) ? String(t.sentiment_correlation) : 'neutral',
      keyPhrases: String(t?.key_phrases ?? '').slice(0, 400),
      impactScore: Math.max(0, Math.min(100, Number(t?.impact_score ?? 50))),
      recommendedResponse: String(t?.recommended_response ?? '').slice(0, 300),
    })),
    actionItems: (parsed?.actionItems || []).slice(0, 8).map((a: any) => ({
      action: String(a?.action ?? '').slice(0, 300),
      priority: ['critical', 'high', 'medium', 'low'].includes(String(a?.priority)) ? String(a.priority) : 'medium',
      targetBuyerCount: Math.max(0, Number(a?.target_buyer_count ?? 0)),
      expectedSatisfactionLiftPct: Math.max(0, Math.min(50, Number(a?.expected_satisfaction_lift_pct ?? 10))),
      implementationDays: Math.max(1, Number(a?.implementation_days ?? 7)),
      responsibleArea: ['product', 'shipping', 'communication', 'pricing', 'service'].includes(String(a?.responsible_area)) ? String(a.responsible_area) : 'service',
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['bert', 'roberta', 'distilbert', 't5', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: ['sentiment_analysis', 'theme_extraction', 'satisfaction_prediction', 'feedback_classification'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'sentiment_analysis',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      feedbackAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.feedback_analysis_score ?? 50))),
      feedbackGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.feedback_grade)) ? String(parsed.summary.feedback_grade) : 'C',
      avgSatisfactionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_satisfaction_score ?? 70))),
      positivePct: Math.max(0, Math.min(100, Number(parsed?.summary?.positive_pct ?? 60))),
      negativePct: Math.max(0, Math.min(100, Number(parsed?.summary?.negative_pct ?? 15))),
      biggestFeedbackRisk: String(parsed?.summary?.biggest_feedback_risk ?? '').slice(0, 200),
      biggestFeedbackOpportunity: String(parsed?.summary?.biggest_feedback_opportunity ?? '').slice(0, 200),
      quickestFeedbackWin: String(parsed?.summary?.quickest_feedback_win ?? '').slice(0, 200),
      feedbackAnalysisScoreV2: Math.max(0, Math.min(100, Number(parsed?.summary?.feedback_analysis_score_v2 ?? 50))),
    },
  };
}
