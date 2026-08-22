// v6.79 / v8.95.6-listing: AI Listing Question Optimizer — ML napoved vprašanj kupcev in preventivni FAQ
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/listing-question-optimizer
// Body: { tradeId?: string }
// Returns: { ok, optimizer: { listing, predictedQuestions, faqEntries, gapAnalysis, mlModels, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const QUESTION_TYPES = ['condition', 'price_negotiation', 'shipping', 'specs', 'availability', 'history', 'warranty', 'compatibility', 'authenticity', 'logistics'] as const;
const URGENCY_LEVELS = ['critical', 'high', 'medium', 'low'] as const;

interface ListingQuestionOptimizerInput {
  tradeId: string | null;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyDate: Date;
  buyLocation: string;
  notes: string | null;
  listingId: string | null;
}

interface TargetListingRow {
  aiEstimatedValue: number | null;
  aiRisk: number | null;
  aiScore: number | null;
  url: string | null;
  imageUrl: string | null;
}

interface TargetContext {
  title: string;
  category: string;
  buyPrice: number;
  buyLocation: string;
  buyDate: Date;
  notes: string;
  suggestedPrice: number;
  recentListings: string;
}

export const POST = withAiRoute<ListingQuestionOptimizerInput>({
  endpoint: '/api/ai/listing-question-optimizer',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId).trim() : null,
    };
  },

  // No validateInput — tradeId je opcijski (null = prvi held trade)

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId } = input;

    const heldTrades: HeldTradeRow[] = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true, buyLocation: true, notes: true, listingId: true },
      take: 200,
      orderBy: { buyDate: 'desc' },
    });
    if (heldTrades.length === 0) {
      return apiOk({ ok: true, optimizer: null, message: 'Ni aktivnih oglasov za analizo vprašanj.' });
    }

    const target = heldTrades.find(t => t.id === tradeId) ?? heldTrades[0];
    const targetListing: TargetListingRow | null = target.listingId
      ? await db.listing.findUnique({ where: { id: target.listingId }, select: { aiEstimatedValue: true, aiRisk: true, aiScore: true, url: true, imageUrl: true } })
      : null;
    const suggestedPrice = targetListing?.aiEstimatedValue ?? Math.round(target.buyPrice * 1.25);

    const recentListings = buildRecentListings(heldTrades);

    const prompt = buildPrompt({
      title: target.title,
      category: target.category,
      buyPrice: target.buyPrice,
      buyLocation: target.buyLocation,
      buyDate: target.buyDate,
      notes: (target.notes || '').slice(0, 200),
      suggestedPrice,
      recentListings,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const optimizer = transformOptimizer(parsed, {
      title: target.title,
      category: target.category,
      buyPrice: target.buyPrice,
      suggestedPrice,
    });

    return apiOk({ ok: true, optimizer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function buildRecentListings(heldTrades: HeldTradeRow[]): string {
  return heldTrades.slice(0, 6).map(t => `- ${t.title} | ${t.category} | ${t.buyPrice}€ | ${t.buyLocation}`).join('\n');
}

function buildPrompt(ctx: TargetContext): string {
  return `Si AI listing question optimizer z ML in NLP.
Napoveduje katera vprašanja bodo kupci zastavili za oglas in predlaga preventivni FAQ.

CILJNI OGLAS:
- Naslov: ${ctx.title}
- Kategorija: ${ctx.category}
- Nabavna cena: ${ctx.buyPrice}€
- Predlagana cena: ${ctx.suggestedPrice}€
- Kupljeno pri: ${ctx.buyLocation}
- Datum nakupa: ${ctx.buyDate.toISOString().slice(0, 10)}
- Opombe: ${ctx.notes || 'brez'}

OSTALI AKTIVNI OGLASI (kontekst):
${ctx.recentListings}

10 tipov vprašanj kupcev:
1. CONDITION: stanje izdelka
2. PRICE_NEGOTIATION: pogajanje za ceno
3. SHIPPING: dostava in prevoz
4. SPECS: tehnične specifikacije
5. AVAILABILITY: razpoložljivost in rezervacija
6. HISTORY: zgodovina izdelka
7. WARRANTY: garancija in povračila
8. COMPATIBILITY: združljivost z drugimi izdelki
9. AUTHENTICITY: avtentičnost in originalnost
10. LOGISTICS: logistika in osebni prevzem

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listing": { "title": "<string>", "category": "<string>", "current_price_eur": <number>, "suggested_price_eur": <number>, "question_optimization_score": <number 0-100>, "faq_completeness_pct": <number 0-100>, "listing_readiness_grade": "<A|B|C|D|F>" },
  "predictedQuestions": [
    { "question_type": "<${QUESTION_TYPES.join('|')}>", "predicted_question": "<max 150 znakov>", "likelihood_pct": <number 0-100>, "urgency": "<${URGENCY_LEVELS.join('|')}>", "buyer_persona": "<max 80 znakov>", "impact_on_sale": "<high|medium|low>" }
  ],
  "faqEntries": [
    { "question": "<max 150 znakov>", "answer": "<max 300 znakov>", "question_type": "<${QUESTION_TYPES.join('|')}>", "placement": "<top|middle|bottom>", "tone": "<formal|friendly|concise>", "priority": "<high|medium|low>" }
  ],
  "gapAnalysis": [
    { "gap": "<missing_info|unclear_pricing|no_shipping_info|no_condition_photo|no_warranty|no_specs>", "severity": "<critical|high|medium|low>", "current_state": "<max 100 znakov>", "recommended_action": "<max 150 znakov>", "expected_conversion_lift_pct": <number 0-30> }
  ],
  "mlModels": [
    { "model": "<bert|gpt|t5|roberta|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<question_prediction|faq_generation|gap_detection|sentiment_analysis>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "listing_readiness_score": <number 0-100>, "listing_readiness_grade": "<A|B|C|D|F>", "total_predicted_questions": <number>,
    "critical_gaps_count": <number>, "faq_completeness_pct": <number 0-100>,
    "biggest_question_risk": "<max 100 znakov>", "biggest_faq_opportunity": "<max 100 znakov>",
    "quickest_listing_win": "<max 100 znakov>", "question_optimization_score": <number 0-100>
  }
}`;
}

function transformOptimizer(parsed: any, target: { title: string; category: string; buyPrice: number; suggestedPrice: number }): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listing: {
      title: String(parsed?.listing?.title ?? target.title).slice(0, 200),
      category: String(parsed?.listing?.category ?? target.category).slice(0, 50),
      currentPriceEur: Math.round(Number(parsed?.listing?.current_price_eur ?? target.buyPrice)),
      suggestedPriceEur: Math.round(Number(parsed?.listing?.suggested_price_eur ?? target.suggestedPrice)),
      questionOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.listing?.question_optimization_score ?? 50))),
      faqCompletenessPct: Math.max(0, Math.min(100, Number(parsed?.listing?.faq_completeness_pct ?? 30))),
      listingReadinessGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.listing?.listing_readiness_grade)) ? String(parsed.listing.listing_readiness_grade) : 'C',
    },
    predictedQuestions: (parsed?.predictedQuestions || []).slice(0, 12).map((q: any) => ({
      questionType: includes(QUESTION_TYPES, String(q?.question_type)) ? String(q.question_type) : 'condition',
      predictedQuestion: String(q?.predicted_question ?? '').slice(0, 300),
      likelihoodPct: Math.max(0, Math.min(100, Number(q?.likelihood_pct ?? 50))),
      urgency: includes(URGENCY_LEVELS, String(q?.urgency)) ? String(q.urgency) : 'medium',
      buyerPersona: String(q?.buyer_persona ?? '').slice(0, 160),
      impactOnSale: ['high', 'medium', 'low'].includes(String(q?.impact_on_sale)) ? String(q.impact_on_sale) : 'medium',
    })),
    faqEntries: (parsed?.faqEntries || []).slice(0, 10).map((f: any) => ({
      question: String(f?.question ?? '').slice(0, 300),
      answer: String(f?.answer ?? '').slice(0, 600),
      questionType: includes(QUESTION_TYPES, String(f?.question_type)) ? String(f.question_type) : 'condition',
      placement: ['top', 'middle', 'bottom'].includes(String(f?.placement)) ? String(f.placement) : 'middle',
      tone: ['formal', 'friendly', 'concise'].includes(String(f?.tone)) ? String(f.tone) : 'friendly',
      priority: ['high', 'medium', 'low'].includes(String(f?.priority)) ? String(f.priority) : 'medium',
    })),
    gapAnalysis: (parsed?.gapAnalysis || []).slice(0, 8).map((g: any) => ({
      gap: ['missing_info', 'unclear_pricing', 'no_shipping_info', 'no_condition_photo', 'no_warranty', 'no_specs'].includes(String(g?.gap)) ? String(g.gap) : 'missing_info',
      severity: ['critical', 'high', 'medium', 'low'].includes(String(g?.severity)) ? String(g.severity) : 'medium',
      currentState: String(g?.current_state ?? '').slice(0, 200),
      recommendedAction: String(g?.recommended_action ?? '').slice(0, 300),
      expectedConversionLiftPct: Math.max(0, Math.min(30, Number(g?.expected_conversion_lift_pct ?? 5))),
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['bert', 'gpt', 't5', 'roberta', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: ['question_prediction', 'faq_generation', 'gap_detection', 'sentiment_analysis'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'question_prediction',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      listingReadinessScore: Math.max(0, Math.min(100, Number(parsed?.summary?.listing_readiness_score ?? 50))),
      listingReadinessGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.listing_readiness_grade)) ? String(parsed.summary.listing_readiness_grade) : 'C',
      totalPredictedQuestions: Math.max(0, Number(parsed?.summary?.total_predicted_questions ?? 0)),
      criticalGapsCount: Math.max(0, Number(parsed?.summary?.critical_gaps_count ?? 0)),
      faqCompletenessPct: Math.max(0, Math.min(100, Number(parsed?.summary?.faq_completeness_pct ?? 30))),
      biggestQuestionRisk: String(parsed?.summary?.biggest_question_risk ?? '').slice(0, 200),
      biggestFaqOpportunity: String(parsed?.summary?.biggest_faq_opportunity ?? '').slice(0, 200),
      quickestListingWin: String(parsed?.summary?.quickest_listing_win ?? '').slice(0, 200),
      questionOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.question_optimization_score ?? 50))),
    },
  };
}
