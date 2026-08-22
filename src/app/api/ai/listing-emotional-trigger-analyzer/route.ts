// v6.72 / v8.94-refactor: AI Listing Emotional Trigger Analyzer — analiza čustvenih sprožilcev z ML NLP
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/listing-emotional-trigger-analyzer
// Body: { tradeId?: string }
// Returns: { ok, analyzer: { listings, triggers, emotions, optimizations, mlModels, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic, maxDuration } = AI_ROUTE_DEFAULTS;

const TRIGGER_TYPES = [
  'scarcity', 'urgency', 'social_proof', 'authority', 'reciprocity',
  'loss_aversion', 'aspiration', 'nostalgia', 'belonging', 'achievement',
  'security', 'novelty',
] as const;

const EMOTION_TYPES = ['joy', 'trust', 'fear', 'surprise', 'sadness', 'disgust', 'anger', 'anticipation'] as const;
const OPTIMIZATION_TYPES = ['trigger_addition', 'trigger_intensification', 'trigger_removal', 'trigger_combination'] as const;
const EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
const ML_MODELS = ['bert', 'roberta', 'distilbert', 'xlm_roberta', 'ensemble'] as const;
const ML_PREDICTION_TYPES = ['trigger_detection', 'emotion_classification', 'conversion_prediction', 'engagement_forecast'] as const;

interface EmotionalTriggerInput {
  tradeId: string | null;
}

export const POST = withAiRoute<EmotionalTriggerInput>({
  endpoint: '/api/ai/listing-emotional-trigger-analyzer',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : null,
    };
  },

  // No validateInput — tradeId je opcijski (null = vsi held tradei)

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId } = input;

    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;

    const heldTrades = await db.trade.findMany({
      where,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true,
        listing: {
          select: {
            description: true, detailDescription: true, aiEstimatedValue: true, price: true,
          },
        },
      },
      take: tradeId ? 1 : 10,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, analyzer: null, message: 'Ni held tradeov za emotional trigger analizo.' });
    }

    const items = buildItems(heldTrades);
    const itemsStr = buildItemsStr(items);
    const prompt = buildPrompt(items, itemsStr);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const analyzer = transformAnalyzer(parsed, items);

    return apiOk({ ok: true, analyzer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number;
  listing: {
    description: string;
    detailDescription: string | null;
    aiEstimatedValue: number | null;
    price: number | null;
  } | null;
}

interface TriggerItem {
  id: string;
  title: string;
  category: string;
  price: number;
  description: string;
}

function buildItems(heldTrades: HeldTradeRow[]): TriggerItem[] {
  return heldTrades.map(t => ({
    id: t.id,
    title: t.title,
    category: t.category || 'drugo',
    price: t.listing?.price ?? Math.round(t.buyPrice * 1.25),
    description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 300),
  }));
}

function buildItemsStr(items: TriggerItem[]): string {
  return items
    .slice(0, 10)
    .map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.price}€ | ${i.description.slice(0, 100)}`)
    .join('\n');
}

function buildPrompt(items: TriggerItem[], itemsStr: string): string {
  return `Si AI listing emotional trigger analyzer z ML NLP.
Analizira čustvene sprožilce v oglasih in predlaga optimizacije.

OGLASI (${items.length}):
${itemsStr}

12 emotional trigger tipov:
1. SCARCITY: redkost, omejena količina
2. URGENCY: časovna omejenost, danes
3. SOCIAL_PROOF: popularno, bestseller
4. AUTHORITY: ekspertnost, certifikat
5. RECIPROCITY: bonus, dodatek
6. LOSS_AVERSION: kaj izgubiš če ne kupiš
7. ASPIRATION: boljše življenje, status
8. NOSTALGIA: spomin, vintage
9. BELONGING: skupnost, družina
10. ACHIEVEMENT: uspeh, napredek
11. SECURITY: varnost, garancija
12. NOVELTY: novo, trendy

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    { "id": "<trade_id>", "title": "<naslov>", "current_trigger_score": <number 0-100>, "optimized_trigger_score": <number 0-100>, "detected_triggers": [{"trigger": "<12 tipov>", "intensity": <number 0-100>, "evidence": "<max 100 znakov>"}], "missing_triggers": ["<12 tipov>"], "recommended_triggers": [{"trigger": "<12 tipov>", "implementation": "<max 150 znakov>", "expected_engagement_increase_pct": <number>, "example_phrase": "<max 150 znakov>"}], "optimized_description_snippet": "<max 300 znakov>", "expected_conversion_increase_pct": <number> }
  ],
  "triggers": [
    { "trigger": "<12 tipov>", "description": "<max 100 znakov>", "psychological_basis": "<max 120 znakov>", "avg_intensity": <number 0-100>, "avg_conversion_lift_pct": <number>, "best_for_category": "<max 80 znakov>", "example_phrases": ["<max 80 znakov>"] }
  ],
  "emotions": [
    { "emotion": "<joy|trust|fear|surprise|sadness|disgust|anger|anticipation>", "trigger_association": "<12 tipov>", "avg_intensity": <number 0-100>, "buyer_count": <number>, "conversion_correlation_pct": <number 0-100> }
  ],
  "optimizations": [
    { "optimization_type": "<trigger_addition|trigger_intensification|trigger_removal|trigger_combination>", "trigger_targeted": "<12 tipov>", "description": "<max 120 znakov>", "expected_lift_pct": <number>, "implementation_effort": "<low|medium|high>", "example_before": "<max 100 znakov>", "example_after": "<max 100 znakov>" }
  ],
  "mlModels": [
    { "model": "<bert|roberta|distilbert|xlm_roberta|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<trigger_detection|emotion_classification|conversion_prediction|engagement_forecast>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_listings_analyzed": <number>, "avg_current_trigger_score": <number>, "avg_optimized_trigger_score": <number>,
    "most_effective_trigger": "<12 tipov>", "biggest_trigger_gap": "<max 100 znakov>",
    "quickest_trigger_win": "<max 100 znakov>", "emotional_trigger_score": <number 0-100>
  }
}`;
}

function isValidTrigger(value: unknown): value is typeof TRIGGER_TYPES[number] {
  return TRIGGER_TYPES.includes(value as any);
}

function transformAnalyzer(parsed: any, items: TriggerItem[]): any {
  const validIds = new Set(items.map(i => i.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listings: (parsed?.listings || [])
      .filter((l: any) => validIds.has(String(l?.id ?? '')))
      .slice(0, 10)
      .map((l: any) => ({
        tradeId: String(l?.id ?? ''),
        title: String(l?.title ?? '').slice(0, 150),
        currentTriggerScore: Math.max(0, Math.min(100, Number(l?.current_trigger_score ?? 40))),
        optimizedTriggerScore: Math.max(0, Math.min(100, Number(l?.optimized_trigger_score ?? 70))),
        detectedTriggers: (l?.detected_triggers || []).slice(0, 6).map((t: any) => ({
          trigger: isValidTrigger(String(t?.trigger)) ? String(t.trigger) : 'scarcity',
          intensity: Math.max(0, Math.min(100, Number(t?.intensity ?? 30))),
          evidence: String(t?.evidence ?? '').slice(0, 200),
        })),
        missingTriggers: (l?.missing_triggers || []).slice(0, 8).map((t: any) =>
          isValidTrigger(String(t)) ? String(t) : 'scarcity'
        ),
        recommendedTriggers: (l?.recommended_triggers || []).slice(0, 5).map((t: any) => ({
          trigger: isValidTrigger(String(t?.trigger)) ? String(t.trigger) : 'scarcity',
          implementation: String(t?.implementation ?? '').slice(0, 300),
          expectedEngagementIncreasePct: Math.round(Number(t?.expected_engagement_increase_pct ?? 0)),
          examplePhrase: String(t?.example_phrase ?? '').slice(0, 300),
        })),
        optimizedDescriptionSnippet: String(l?.optimized_description_snippet ?? '').slice(0, 500),
        expectedConversionIncreasePct: Math.round(Number(l?.expected_conversion_increase_pct ?? 0)),
      })),
    triggers: (parsed?.triggers || []).slice(0, 12).map((t: any) => ({
      trigger: isValidTrigger(String(t?.trigger)) ? String(t.trigger) : 'scarcity',
      description: String(t?.description ?? '').slice(0, 200),
      psychologicalBasis: String(t?.psychological_basis ?? '').slice(0, 250),
      avgIntensity: Math.max(0, Math.min(100, Number(t?.avg_intensity ?? 30))),
      avgConversionLiftPct: Math.round(Number(t?.avg_conversion_lift_pct ?? 0)),
      bestForCategory: String(t?.best_for_category ?? '').slice(0, 150),
      examplePhrases: (t?.example_phrases || []).slice(0, 4).map((p: any) => String(p).slice(0, 150)),
    })),
    emotions: (parsed?.emotions || []).slice(0, 8).map((e: any) => ({
      emotion: (EMOTION_TYPES as readonly string[]).includes(String(e?.emotion)) ? String(e.emotion) : 'joy',
      triggerAssociation: isValidTrigger(String(e?.trigger_association)) ? String(e.trigger_association) : 'scarcity',
      avgIntensity: Math.max(0, Math.min(100, Number(e?.avg_intensity ?? 30))),
      buyerCount: Math.max(0, Number(e?.buyer_count ?? 0)),
      conversionCorrelationPct: Math.max(0, Math.min(100, Number(e?.conversion_correlation_pct ?? 50))),
    })),
    optimizations: (parsed?.optimizations || []).slice(0, 8).map((o: any) => ({
      optimizationType: (OPTIMIZATION_TYPES as readonly string[]).includes(String(o?.optimization_type))
        ? String(o.optimization_type) : 'trigger_addition',
      triggerTargeted: isValidTrigger(String(o?.trigger_targeted)) ? String(o.trigger_targeted) : 'scarcity',
      description: String(o?.description ?? '').slice(0, 250),
      expectedLiftPct: Math.round(Number(o?.expected_lift_pct ?? 0)),
      implementationEffort: (EFFORT_LEVELS as readonly string[]).includes(String(o?.implementation_effort))
        ? String(o.implementation_effort) : 'low',
      exampleBefore: String(o?.example_before ?? '').slice(0, 200),
      exampleAfter: String(o?.example_after ?? '').slice(0, 200),
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: (ML_MODELS as readonly string[]).includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: (ML_PREDICTION_TYPES as readonly string[]).includes(String(m?.prediction_type))
        ? String(m.prediction_type) : 'trigger_detection',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      totalListingsAnalyzed: items.length,
      avgCurrentTriggerScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_current_trigger_score ?? 40))),
      avgOptimizedTriggerScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_optimized_trigger_score ?? 70))),
      mostEffectiveTrigger: isValidTrigger(String(parsed?.summary?.most_effective_trigger))
        ? String(parsed.summary.most_effective_trigger) : 'scarcity',
      biggestTriggerGap: String(parsed?.summary?.biggest_trigger_gap ?? '').slice(0, 200),
      quickestTriggerWin: String(parsed?.summary?.quickest_trigger_win ?? '').slice(0, 200),
      emotionalTriggerScore: Math.max(0, Math.min(100, Number(parsed?.summary?.emotional_trigger_score ?? 60))),
    },
  };
}
