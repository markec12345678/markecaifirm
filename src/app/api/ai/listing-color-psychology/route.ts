// v6.89 / v8.95.5-listing: AI Listing Color Psychology — ML optimizacija barvne psihologije v oglasih
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/listing-color-psychology
// Body: { tradeId?: string }
// Returns: { ok, optimizer: { listing, colorAnalysis, emotionalImpact, recommendations, mlModels, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const COLOR_PSYCHOLOGIES = ['red_urgency', 'blue_trust', 'green_natural', 'yellow_optimism', 'purple_luxury', 'orange_energy', 'black_premium', 'white_minimal', 'pink_playful', 'brown_earthy'] as const;
const EMOTIONAL_RESPONSES = ['excitement', 'trust', 'calm', 'urgency', 'luxury', 'happiness', 'professionalism', 'warmth', 'sophistication', 'approachability'] as const;

interface ListingColorPsychologyInput {
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
  url: string | null;
  imageUrl: string | null;
}

interface TargetContext {
  title: string;
  category: string;
  buyPrice: number;
  imageUrl: string | null;
  suggestedPrice: number;
}

export const POST = withAiRoute<ListingColorPsychologyInput>({
  endpoint: '/api/ai/listing-color-psychology',
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
      return apiOk({ ok: true, optimizer: null, message: 'Ni aktivnih oglasov za color psychology analizo.' });
    }

    const target = heldTrades.find(t => t.id === tradeId) ?? heldTrades[0];
    const targetListing: TargetListingRow | null = target.listingId
      ? await db.listing.findUnique({ where: { id: target.listingId }, select: { aiEstimatedValue: true, aiRisk: true, url: true, imageUrl: true } })
      : null;
    const suggestedPrice = targetListing?.aiEstimatedValue ?? Math.round(target.buyPrice * 1.25);

    const prompt = buildPrompt({ title: target.title, category: target.category, buyPrice: target.buyPrice, imageUrl: targetListing?.imageUrl ?? null, suggestedPrice });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const optimizer = transformOptimizer(parsed, { title: target.title, category: target.category, imageUrl: targetListing?.imageUrl ?? null });

    return apiOk({ ok: true, optimizer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function buildPrompt(ctx: TargetContext): string {
  return `Si AI listing color psychology optimizer z ML in color theory.
Optimizira barvno psihologijo z 10 barvami in 10 čustvenimi odzivi.

CILJNI OGLAS:
- Naslov: ${ctx.title}
- Kategorija: ${ctx.category}
- Nabavna cena: ${ctx.buyPrice}€
- Predlagana cena: ${ctx.suggestedPrice}€
- Image URL: ${ctx.imageUrl || 'brez'}

10 barvnih psihologij:
1. RED_URGENCY: rdeča (nujnost, akcija)
2. BLUE_TRUST: modra (zaupanje, stabilnost)
3. GREEN_NATURAL: zelena (narava, rast)
4. YELLOW_OPTIMISM: rumena (optimizem, energija)
5. PURPLE_LUXURY: vijolična (luksuz, prestiž)
6. ORANGE_ENERGY: oranžna (energija, veselje)
7. BLACK_PREMIUM: črna (premium, sofisticiranost)
8. WHITE_MINIMAL: bela (minimalizem, čistoča)
9. PINK_PLAYFUL: roza (igrivost, nežnost)
10. BROWN_EARTHY: rjava (zemeljskost, toplota)

10 čustvenih odzivov: excitement, trust, calm, urgency, luxury, happiness, professionalism, warmth, sophistication, approachability

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listing": { "title": "<string>", "category": "<string>", "current_color_score": <number 0-100>, "optimized_color_score": <number 0-100>, "current_emotional_response": "<${EMOTIONAL_RESPONSES.join('|')}>", "optimized_emotional_response": "<${EMOTIONAL_RESPONSES.join('|')}>", "color_psychology_grade": "<A|B|C|D|F>" },
  "colorAnalysis": [
    { "color_psychology": "<${COLOR_PSYCHOLOGIES.join('|')}>", "hex_code": "<#RRGGBB>", "current_usage_pct": <number 0-100>, "recommended_usage_pct": <number 0-100>, "emotional_trigger": "<${EMOTIONAL_RESPONSES.join('|')}>", "cultural_consideration": "<max 100 znakov>", "best_for_element": "<background|accent|cta|text|border>" }
  ],
  "emotionalImpact": [
    { "emotion": "<${EMOTIONAL_RESPONSES.join('|')}>", "current_intensity_pct": <number 0-100>, "optimized_intensity_pct": <number 0-100>, "primary_color_driver": "<${COLOR_PSYCHOLOGIES.join('|')}>", "buyer_segment_appeal": "<max 100 znakov>", "conversion_correlation_pct": <number -50 do 50> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "color_psychology": "<${COLOR_PSYCHOLOGIES.join('|')}>", "target_element": "<background|accent|cta|text|border>", "expected_conversion_lift_pct": <number 0-30>, "implementation_difficulty": "<easy|medium|hard>", "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<cnn|resnet|vit|efficientnet|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<color_analysis|emotion_prediction|conversion_forecast|aesthetic_scoring>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "color_psychology_score": <number 0-100>, "color_psychology_grade": "<A|B|C|D|F>", "current_color_score": <number 0-100>,
    "optimized_color_score": <number 0-100>, "expected_conversion_lift_pct": <number 0-100>,
    "biggest_color_risk": "<max 100 znakov>", "biggest_color_opportunity": "<max 100 znakov>",
    "quickest_color_win": "<max 100 znakov>", "color_analysis_score": <number 0-100>
  }
}`;
}

function transformOptimizer(parsed: any, target: { title: string; category: string; imageUrl: string | null }): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listing: {
      title: String(parsed?.listing?.title ?? target.title).slice(0, 200),
      category: String(parsed?.listing?.category ?? target.category).slice(0, 50),
      currentColorScore: Math.max(0, Math.min(100, Number(parsed?.listing?.current_color_score ?? 50))),
      optimizedColorScore: Math.max(0, Math.min(100, Number(parsed?.listing?.optimized_color_score ?? 75))),
      currentEmotionalResponse: includes(EMOTIONAL_RESPONSES, String(parsed?.listing?.current_emotional_response)) ? String(parsed.listing.current_emotional_response) : 'trust',
      optimizedEmotionalResponse: includes(EMOTIONAL_RESPONSES, String(parsed?.listing?.optimized_emotional_response)) ? String(parsed.listing.optimized_emotional_response) : 'excitement',
      colorPsychologyGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.listing?.color_psychology_grade)) ? String(parsed.listing.color_psychology_grade) : 'C',
    },
    colorAnalysis: (parsed?.colorAnalysis || []).slice(0, 10).map((c: any) => ({
      colorPsychology: includes(COLOR_PSYCHOLOGIES, String(c?.color_psychology)) ? String(c.color_psychology) : 'blue_trust',
      hexCode: String(c?.hex_code ?? '').slice(0, 7),
      currentUsagePct: Math.max(0, Math.min(100, Number(c?.current_usage_pct ?? 30))),
      recommendedUsagePct: Math.max(0, Math.min(100, Number(c?.recommended_usage_pct ?? 50))),
      emotionalTrigger: includes(EMOTIONAL_RESPONSES, String(c?.emotional_trigger)) ? String(c.emotional_trigger) : 'trust',
      culturalConsideration: String(c?.cultural_consideration ?? '').slice(0, 200),
      bestForElement: ['background', 'accent', 'cta', 'text', 'border'].includes(String(c?.best_for_element)) ? String(c.best_for_element) : 'accent',
    })),
    emotionalImpact: (parsed?.emotionalImpact || []).slice(0, 10).map((e: any) => ({
      emotion: includes(EMOTIONAL_RESPONSES, String(e?.emotion)) ? String(e.emotion) : 'trust',
      currentIntensityPct: Math.max(0, Math.min(100, Number(e?.current_intensity_pct ?? 50))),
      optimizedIntensityPct: Math.max(0, Math.min(100, Number(e?.optimized_intensity_pct ?? 70))),
      primaryColorDriver: includes(COLOR_PSYCHOLOGIES, String(e?.primary_color_driver)) ? String(e.primary_color_driver) : 'blue_trust',
      buyerSegmentAppeal: String(e?.buyer_segment_appeal ?? '').slice(0, 200),
      conversionCorrelationPct: Math.max(-50, Math.min(50, Number(e?.conversion_correlation_pct ?? 0))),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 10).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      colorPsychology: includes(COLOR_PSYCHOLOGIES, String(r?.color_psychology)) ? String(r.color_psychology) : 'blue_trust',
      targetElement: ['background', 'accent', 'cta', 'text', 'border'].includes(String(r?.target_element)) ? String(r.target_element) : 'accent',
      expectedConversionLiftPct: Math.max(0, Math.min(30, Number(r?.expected_conversion_lift_pct ?? 5))),
      implementationDifficulty: ['easy', 'medium', 'hard'].includes(String(r?.implementation_difficulty)) ? String(r.implementation_difficulty) : 'medium',
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['cnn', 'resnet', 'vit', 'efficientnet', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: ['color_analysis', 'emotion_prediction', 'conversion_forecast', 'aesthetic_scoring'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'color_analysis',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      colorPsychologyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.color_psychology_score ?? 50))),
      colorPsychologyGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.color_psychology_grade)) ? String(parsed.summary.color_psychology_grade) : 'C',
      currentColorScore: Math.max(0, Math.min(100, Number(parsed?.summary?.current_color_score ?? 50))),
      optimizedColorScore: Math.max(0, Math.min(100, Number(parsed?.summary?.optimized_color_score ?? 75))),
      expectedConversionLiftPct: Math.max(0, Math.min(100, Number(parsed?.summary?.expected_conversion_lift_pct ?? 15))),
      biggestColorRisk: String(parsed?.summary?.biggest_color_risk ?? '').slice(0, 200),
      biggestColorOpportunity: String(parsed?.summary?.biggest_color_opportunity ?? '').slice(0, 200),
      quickestColorWin: String(parsed?.summary?.quickest_color_win ?? '').slice(0, 200),
      colorAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.color_analysis_score ?? 50))),
    },
  };
}
