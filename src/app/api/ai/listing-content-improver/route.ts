// v6.84 / v8.95.5-listing: AI Listing Content Improver — ML izboljšava vsebine oglasov z NLP in readability
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/listing-content-improver
// Body: { tradeId?: string }
// Returns: { ok, improver: { listing, contentAnalysis, improvements, generatedContent, mlModels, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const CONTENT_SECTIONS = ['headline', 'introduction', 'features', 'specifications', 'condition', 'usage_history', 'reason_for_selling', 'shipping_info', 'call_to_action', 'faq_preview'] as const;
const IMPROVEMENT_TYPES = ['clarity', 'persuasion', 'specificity', 'emotion', 'urgency', 'credibility', 'readability', 'seo_optimization', 'mobile_optimization', 'accessibility'] as const;

interface ListingContentImproverInput {
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
  description: string;
  url: string | null;
}

interface TargetContext {
  title: string;
  category: string;
  buyPrice: number;
  suggestedPrice: number;
  currentDesc: string;
}

export const POST = withAiRoute<ListingContentImproverInput>({
  endpoint: '/api/ai/listing-content-improver',
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
      return apiOk({ ok: true, improver: null, message: 'Ni aktivnih oglasov za content improvement.' });
    }

    const target = heldTrades.find(t => t.id === tradeId) ?? heldTrades[0];
    const targetListing: TargetListingRow | null = target.listingId
      ? await db.listing.findUnique({ where: { id: target.listingId }, select: { aiEstimatedValue: true, aiRisk: true, description: true, url: true } })
      : null;
    const suggestedPrice = targetListing?.aiEstimatedValue ?? Math.round(target.buyPrice * 1.25);
    const currentDesc = (target.notes || targetListing?.description || '').slice(0, 500);

    const prompt = buildPrompt({ title: target.title, category: target.category, buyPrice: target.buyPrice, suggestedPrice, currentDesc });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const improver = transformImprover(parsed, { title: target.title, category: target.category, currentDesc });

    return apiOk({ ok: true, improver });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function buildPrompt(ctx: TargetContext): string {
  return `Si AI listing content improver z ML in NLP za izboljšavo vsebine oglasov.
Analizira vsebino z 10 sekcijami in 10 tipi izboljšav, generira novo vsebino.

CILJNI OGLAS:
- Naslov: ${ctx.title}
- Kategorija: ${ctx.category}
- Nabavna cena: ${ctx.buyPrice}€
- Predlagana cena: ${ctx.suggestedPrice}€
- Trenutni opis: ${ctx.currentDesc || 'brez'}

10 sekcij vsebine:
1. HEADLINE: naslov
2. INTRODUCTION: uvod
3. FEATURES: lastnosti
4. SPECIFICATIONS: specifikacije
5. CONDITION: stanje
6. USAGE_HISTORY: zgodovina uporabe
7. REASON_FOR_SELLING: razlog prodaje
8. SHIPPING_INFO: dostava
9. CALL_TO_ACTION: poziv k dejanju
10. FAQ_PREVIEW: predogled FAQ

10 tipov izboljšav: clarity, persuasion, specificity, emotion, urgency, credibility, readability, seo_optimization, mobile_optimization, accessibility

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listing": { "title": "<string>", "category": "<string>", "current_content_score": <number 0-100>, "improved_content_score": <number 0-100>, "readability_grade": "<A|B|C|D|F>", "word_count": <number>, "improved_word_count": <number>, "content_improvement_grade": "<A|B|C|D|F>" },
  "contentAnalysis": [
    { "section": "<${CONTENT_SECTIONS.join('|')}>", "current_quality_pct": <number 0-100>, "improved_quality_pct": <number 0-100>, "missing": <boolean>, "improvement_priority": "<high|medium|low>", "current_text": "<max 200 znakov>", "issue": "<max 100 znakov>" }
  ],
  "improvements": [
    { "improvement_type": "<${IMPROVEMENT_TYPES.join('|')}>", "current_score": <number 0-100>, "improved_score": <number 0-100>, "improvement_pct": <number 0-50>, "rationale": "<max 120 znakov>", "implementation_difficulty": "<easy|medium|hard>" }
  ],
  "generatedContent": [
    { "section": "<${CONTENT_SECTIONS.join('|')}>", "improved_text": "<max 400 znakov>", "character_count": <number>, "tone": "<formal|friendly|enthusiastic|professional|concise>", "key_changes": "<max 150 znakov>", "expected_impact_pct": <number 0-50> }
  ],
  "mlModels": [
    { "model": "<gpt|t5|bart|pegasus|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<content_generation|readability_scoring|persuasion_analysis|seo_optimization>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "content_improvement_score": <number 0-100>, "content_improvement_grade": "<A|B|C|D|F>", "current_content_score": <number 0-100>,
    "improved_content_score": <number 0-100>, "improvement_potential_pct": <number 0-100>,
    "biggest_content_risk": "<max 100 znakov>", "biggest_content_opportunity": "<max 100 znakov>",
    "quickest_content_win": "<max 100 znakov>", "content_analysis_score": <number 0-100>
  }
}`;
}

function transformImprover(parsed: any, target: { title: string; category: string; currentDesc: string }): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listing: {
      title: String(parsed?.listing?.title ?? target.title).slice(0, 200),
      category: String(parsed?.listing?.category ?? target.category).slice(0, 50),
      currentContentScore: Math.max(0, Math.min(100, Number(parsed?.listing?.current_content_score ?? 50))),
      improvedContentScore: Math.max(0, Math.min(100, Number(parsed?.listing?.improved_content_score ?? 75))),
      readabilityGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.listing?.readability_grade)) ? String(parsed.listing.readability_grade) : 'C',
      wordCount: Math.max(0, Number(parsed?.listing?.word_count ?? target.currentDesc.split(/\s+/).length)),
      improvedWordCount: Math.max(0, Number(parsed?.listing?.improved_word_count ?? 200)),
      contentImprovementGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.listing?.content_improvement_grade)) ? String(parsed.listing.content_improvement_grade) : 'C',
    },
    contentAnalysis: (parsed?.contentAnalysis || []).slice(0, 10).map((c: any) => ({
      section: includes(CONTENT_SECTIONS, String(c?.section)) ? String(c.section) : 'headline',
      currentQualityPct: Math.max(0, Math.min(100, Number(c?.current_quality_pct ?? 50))),
      improvedQualityPct: Math.max(0, Math.min(100, Number(c?.improved_quality_pct ?? 75))),
      missing: Boolean(c?.missing ?? false),
      improvementPriority: ['high', 'medium', 'low'].includes(String(c?.improvement_priority)) ? String(c.improvement_priority) : 'medium',
      currentText: String(c?.current_text ?? '').slice(0, 400),
      issue: String(c?.issue ?? '').slice(0, 200),
    })),
    improvements: (parsed?.improvements || []).slice(0, 10).map((i: any) => ({
      improvementType: includes(IMPROVEMENT_TYPES, String(i?.improvement_type)) ? String(i.improvement_type) : 'clarity',
      currentScore: Math.max(0, Math.min(100, Number(i?.current_score ?? 50))),
      improvedScore: Math.max(0, Math.min(100, Number(i?.improved_score ?? 75))),
      improvementPct: Math.max(0, Math.min(50, Number(i?.improvement_pct ?? 0))),
      rationale: String(i?.rationale ?? '').slice(0, 250),
      implementationDifficulty: ['easy', 'medium', 'hard'].includes(String(i?.implementation_difficulty)) ? String(i.implementation_difficulty) : 'medium',
    })),
    generatedContent: (parsed?.generatedContent || []).slice(0, 10).map((g: any) => ({
      section: includes(CONTENT_SECTIONS, String(g?.section)) ? String(g.section) : 'headline',
      improvedText: String(g?.improved_text ?? '').slice(0, 800),
      characterCount: Math.max(0, Number(g?.character_count ?? 0)),
      tone: ['formal', 'friendly', 'enthusiastic', 'professional', 'concise'].includes(String(g?.tone)) ? String(g.tone) : 'friendly',
      keyChanges: String(g?.key_changes ?? '').slice(0, 300),
      expectedImpactPct: Math.max(0, Math.min(50, Number(g?.expected_impact_pct ?? 10))),
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['gpt', 't5', 'bart', 'pegasus', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: ['content_generation', 'readability_scoring', 'persuasion_analysis', 'seo_optimization'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'content_generation',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      contentImprovementScore: Math.max(0, Math.min(100, Number(parsed?.summary?.content_improvement_score ?? 50))),
      contentImprovementGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.content_improvement_grade)) ? String(parsed.summary.content_improvement_grade) : 'C',
      currentContentScore: Math.max(0, Math.min(100, Number(parsed?.summary?.current_content_score ?? 50))),
      improvedContentScore: Math.max(0, Math.min(100, Number(parsed?.summary?.improved_content_score ?? 75))),
      improvementPotentialPct: Math.max(0, Math.min(100, Number(parsed?.summary?.improvement_potential_pct ?? 25))),
      biggestContentRisk: String(parsed?.summary?.biggest_content_risk ?? '').slice(0, 200),
      biggestContentOpportunity: String(parsed?.summary?.biggest_content_opportunity ?? '').slice(0, 200),
      quickestContentWin: String(parsed?.summary?.quickest_content_win ?? '').slice(0, 200),
      contentAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.content_analysis_score ?? 50))),
    },
  };
}
