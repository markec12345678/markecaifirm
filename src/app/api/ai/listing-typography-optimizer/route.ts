// v6.90 / v8.95.6-listing: AI Listing Typography Optimizer — ML optimizacija tipografije z readability in hierarchy
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/listing-typography-optimizer
// Body: { tradeId?: string }
// Returns: { ok, optimizer: { listing, typographyElements, readabilityScore, fontPairings, optimization, mlModels, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const TYPOGRAPHY_ELEMENTS = ['headline', 'subheadline', 'body_text', 'price_display', 'specs_label', 'specs_value', 'cta_text', 'caption', 'footer', 'badge'] as const;
const FONT_FAMILIES = ['serif', 'sans_serif', 'monospace', 'display', 'handwritten', 'condensed', 'wide', 'slab'] as const;

interface ListingTypographyOptimizerInput {
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
}

interface TargetContext {
  title: string;
  category: string;
  buyPrice: number;
  suggestedPrice: number;
}

export const POST = withAiRoute<ListingTypographyOptimizerInput>({
  endpoint: '/api/ai/listing-typography-optimizer',
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
      return apiOk({ ok: true, optimizer: null, message: 'Ni aktivnih oglasov za typography analizo.' });
    }

    const target = heldTrades.find(t => t.id === tradeId) ?? heldTrades[0];
    const targetListing: TargetListingRow | null = target.listingId
      ? await db.listing.findUnique({ where: { id: target.listingId }, select: { aiEstimatedValue: true, aiRisk: true, url: true } })
      : null;
    const suggestedPrice = targetListing?.aiEstimatedValue ?? Math.round(target.buyPrice * 1.25);

    const prompt = buildPrompt({
      title: target.title,
      category: target.category,
      buyPrice: target.buyPrice,
      suggestedPrice,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const optimizer = transformOptimizer(parsed, { title: target.title, category: target.category });

    return apiOk({ ok: true, optimizer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function buildPrompt(ctx: TargetContext): string {
  return `Si AI listing typography optimizer z ML in readability analysis.
Optimizira tipografijo z 10 elementi in 8 font družinami.

CILJNI OGLAS:
- Naslov: ${ctx.title}
- Kategorija: ${ctx.category}
- Nabavna cena: ${ctx.buyPrice}€
- Predlagana cena: ${ctx.suggestedPrice}€

10 tipografskih elementov:
1. HEADLINE: glavni naslov
2. SUBHEADLINE: podnaslov
3. BODY_TEXT: glavno besedilo
4. PRICE_DISPLAY: prikaz cene
5. SPECS_LABEL: oznaka specifikacij
6. SPECS_VALUE: vrednost specifikacij
7. CTA_TEXT: tekst CTA
8. CAPTION: napis
9. FOOTER: noga
10. BADGE: značka

8 font družin: serif, sans_serif, monospace, display, handwritten, condensed, wide, slab

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listing": { "title": "<string>", "category": "<string>", "current_typography_score": <number 0-100>, "optimized_typography_score": <number 0-100>, "current_readability_level": "<poor|fair|good|excellent>", "optimized_readability_level": "<poor|fair|good|excellent>", "typography_grade": "<A|B|C|D|F>" },
  "typographyElements": [
    { "element": "<${TYPOGRAPHY_ELEMENTS.join('|')}>", "current_font_family": "<${FONT_FAMILIES.join('|')}>", "recommended_font_family": "<${FONT_FAMILIES.join('|')}>", "current_size_px": <number>, "recommended_size_px": <number>, "current_weight": "<light|regular|medium|bold|black>", "recommended_weight": "<light|regular|medium|bold|black>", "current_line_height": <number>, "recommended_line_height": <number>, "issue": "<max 100 znakov>", "fix": "<max 120 znakov>" }
  ],
  "readabilityScore": [
    { "metric": "<font_size|line_height|letter_spacing|contrast|font_complexity|text_length|word_spacing|paragraph_spacing>", "current_score": <number 0-100>, "optimized_score": <number 0-100>, "weight_pct": <number 0-100>, "improvement_pct": <number 0-50>, "recommendation": "<max 120 znakov>" }
  ],
  "fontPairings": [
    { "primary_font": "<${FONT_FAMILIES.join('|')}>", "secondary_font": "<${FONT_FAMILIES.join('|')}>", "pairing_score": <number 0-100>, "use_case": "<headline_body|display_text|modern_classic|elegant_casual>", "psychological_impact": "<max 100 znakov>", "best_for_category": "<max 50 znakov>" }
  ],
  "optimization": [
    { "action": "<max 150 znakov>", "element": "<${TYPOGRAPHY_ELEMENTS.join('|')}>", "change_type": "<font_family|font_size|font_weight|line_height|letter_spacing|color>", "expected_readability_lift_pct": <number 0-50>, "expected_conversion_lift_pct": <number 0-30>, "implementation_difficulty": "<easy|medium|hard>", "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<cnn|resnet|vit|efficientnet|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<readability_scoring|font_optimization|hierarchy_analysis|conversion_prediction>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "typography_optimization_score": <number 0-100>, "typography_grade": "<A|B|C|D|F>", "current_typography_score": <number 0-100>,
    "optimized_typography_score": <number 0-100>, "expected_conversion_lift_pct": <number 0-100>,
    "biggest_typography_risk": "<max 100 znakov>", "biggest_typography_opportunity": "<max 100 znakov>",
    "quickest_typography_win": "<max 100 znakov>", "typography_analysis_score": <number 0-100>
  }
}`;
}

function transformOptimizer(parsed: any, target: { title: string; category: string }): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listing: {
      title: String(parsed?.listing?.title ?? target.title).slice(0, 200),
      category: String(parsed?.listing?.category ?? target.category).slice(0, 50),
      currentTypographyScore: Math.max(0, Math.min(100, Number(parsed?.listing?.current_typography_score ?? 50))),
      optimizedTypographyScore: Math.max(0, Math.min(100, Number(parsed?.listing?.optimized_typography_score ?? 75))),
      currentReadabilityLevel: ['poor', 'fair', 'good', 'excellent'].includes(String(parsed?.listing?.current_readability_level)) ? String(parsed.listing.current_readability_level) : 'fair',
      optimizedReadabilityLevel: ['poor', 'fair', 'good', 'excellent'].includes(String(parsed?.listing?.optimized_readability_level)) ? String(parsed.listing.optimized_readability_level) : 'good',
      typographyGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.listing?.typography_grade)) ? String(parsed.listing.typography_grade) : 'C',
    },
    typographyElements: (parsed?.typographyElements || []).slice(0, 10).map((e: any) => ({
      element: includes(TYPOGRAPHY_ELEMENTS, String(e?.element)) ? String(e.element) : 'headline',
      currentFontFamily: includes(FONT_FAMILIES, String(e?.current_font_family)) ? String(e.current_font_family) : 'sans_serif',
      recommendedFontFamily: includes(FONT_FAMILIES, String(e?.recommended_font_family)) ? String(e.recommended_font_family) : 'sans_serif',
      currentSizePx: Math.max(8, Math.min(72, Number(e?.current_size_px ?? 16))),
      recommendedSizePx: Math.max(8, Math.min(72, Number(e?.recommended_size_px ?? 18))),
      currentWeight: ['light', 'regular', 'medium', 'bold', 'black'].includes(String(e?.current_weight)) ? String(e.current_weight) : 'regular',
      recommendedWeight: ['light', 'regular', 'medium', 'bold', 'black'].includes(String(e?.recommended_weight)) ? String(e.recommended_weight) : 'medium',
      currentLineHeight: Math.max(0.8, Math.min(2.5, Number(e?.current_line_height ?? 1.5))),
      recommendedLineHeight: Math.max(0.8, Math.min(2.5, Number(e?.recommended_line_height ?? 1.6))),
      issue: String(e?.issue ?? '').slice(0, 200),
      fix: String(e?.fix ?? '').slice(0, 250),
    })),
    readabilityScore: (parsed?.readabilityScore || []).slice(0, 8).map((r: any) => ({
      metric: String(r?.metric ?? 'font_size').slice(0, 50),
      currentScore: Math.max(0, Math.min(100, Number(r?.current_score ?? 50))),
      optimizedScore: Math.max(0, Math.min(100, Number(r?.optimized_score ?? 75))),
      weightPct: Math.max(0, Math.min(100, Number(r?.weight_pct ?? 12))),
      improvementPct: Math.max(0, Math.min(50, Number(r?.improvement_pct ?? 15))),
      recommendation: String(r?.recommendation ?? '').slice(0, 250),
    })),
    fontPairings: (parsed?.fontPairings || []).slice(0, 8).map((f: any) => ({
      primaryFont: includes(FONT_FAMILIES, String(f?.primary_font)) ? String(f.primary_font) : 'sans_serif',
      secondaryFont: includes(FONT_FAMILIES, String(f?.secondary_font)) ? String(f.secondary_font) : 'serif',
      pairingScore: Math.max(0, Math.min(100, Number(f?.pairing_score ?? 70))),
      useCase: ['headline_body', 'display_text', 'modern_classic', 'elegant_casual'].includes(String(f?.use_case)) ? String(f.use_case) : 'headline_body',
      psychologicalImpact: String(f?.psychological_impact ?? '').slice(0, 200),
      bestForCategory: String(f?.best_for_category ?? '').slice(0, 100),
    })),
    optimization: (parsed?.optimization || []).slice(0, 10).map((o: any) => ({
      action: String(o?.action ?? '').slice(0, 300),
      element: includes(TYPOGRAPHY_ELEMENTS, String(o?.element)) ? String(o.element) : 'headline',
      changeType: ['font_family', 'font_size', 'font_weight', 'line_height', 'letter_spacing', 'color'].includes(String(o?.change_type)) ? String(o.change_type) : 'font_size',
      expectedReadabilityLiftPct: Math.max(0, Math.min(50, Number(o?.expected_readability_lift_pct ?? 15))),
      expectedConversionLiftPct: Math.max(0, Math.min(30, Number(o?.expected_conversion_lift_pct ?? 5))),
      implementationDifficulty: ['easy', 'medium', 'hard'].includes(String(o?.implementation_difficulty)) ? String(o.implementation_difficulty) : 'medium',
      priority: ['high', 'medium', 'low'].includes(String(o?.priority)) ? String(o.priority) : 'medium',
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['cnn', 'resnet', 'vit', 'efficientnet', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: ['readability_scoring', 'font_optimization', 'hierarchy_analysis', 'conversion_prediction'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'readability_scoring',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      typographyOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.typography_optimization_score ?? 50))),
      typographyGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.typography_grade)) ? String(parsed.summary.typography_grade) : 'C',
      currentTypographyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.current_typography_score ?? 50))),
      optimizedTypographyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.optimized_typography_score ?? 75))),
      expectedConversionLiftPct: Math.max(0, Math.min(100, Number(parsed?.summary?.expected_conversion_lift_pct ?? 15))),
      biggestTypographyRisk: String(parsed?.summary?.biggest_typography_risk ?? '').slice(0, 200),
      biggestTypographyOpportunity: String(parsed?.summary?.biggest_typography_opportunity ?? '').slice(0, 200),
      quickestTypographyWin: String(parsed?.summary?.quickest_typography_win ?? '').slice(0, 200),
      typographyAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.typography_analysis_score ?? 50))),
    },
  };
}
