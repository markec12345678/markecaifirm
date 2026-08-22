// v6.38 / v8.95.6-other: AI Listing Quality Predictor — napove kakovost oglasa pred objavo
// Refaktoriran z withAiRoute helperjem (v8.95.6-other) + enforceBudget guard.
//
// POST /api/ai/quality-predictor
// Body: { listingId?: string, tradeId?: string }
// Returns: { ok, prediction: { qualityScore, grade, components, issues, improvements, projectedPerformance } }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface QualityPredictorInput {
  listingId?: string;
  tradeId?: string;
}

interface ListingInput {
  title: string;
  description: string;
  imageUrl: string;
  price: number;
  category: string;
}

function includes<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

const GRADES = ['A+', 'A', 'B+', 'B', 'C', 'D'] as const;
const SEVERITIES = ['high', 'medium', 'low'] as const;
const IMPACTS = ['high', 'medium', 'low'] as const;
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export const POST = withAiRoute<QualityPredictorInput>({
  endpoint: '/api/ai/quality-predictor',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      listingId: body?.listingId ? String(body.listingId) : undefined,
      tradeId: body?.tradeId ? String(body.tradeId) : undefined,
    };
  },

  validateInput: (input) => (input.listingId || input.tradeId ? null : 'listingId ali tradeId je obvezen'),

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { listingId, tradeId } = input;

    // 1. Load listing or trade
    const listingInput = await loadListingInput(db, listingId, tradeId);
    const { title, description, imageUrl, price, category } = listingInput;

    // 2. Build prompt + call AI
    const prompt = buildPrompt({ title, description, imageUrl, price, category });
    const raw = await callAi(prompt);

    // 3. Parse + transform
    const parsed: any = parseAi(raw);
    const prediction = transformPrediction(parsed, price);

    return apiOk({ ok: true, prediction });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

async function loadListingInput(
  db: AiRouteContext['db'],
  listingId: string | undefined,
  tradeId: string | undefined,
): Promise<ListingInput> {
  if (tradeId) {
    const trade = await db.trade.findUnique({
      where: { id: tradeId },
      select: {
        title: true, category: true, buyPrice: true,
        listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true } },
      },
    });
    if (!trade) throw new ApiRouteError('Trade ne obstaja', 404);
    return {
      title: trade.title,
      category: trade.category || '',
      price: trade.listing?.aiEstimatedValue ?? trade.buyPrice,
      description: trade.listing?.detailDescription || trade.listing?.description || '',
      imageUrl: trade.listing?.imageUrl || '',
    };
  }
  if (listingId) {
    const l = await db.listing.findUnique({
      where: { id: listingId },
      select: {
        title: true, description: true, detailDescription: true, imageUrl: true, price: true,
        monitor: { select: { source: true } },
      },
    });
    if (!l) throw new ApiRouteError('Listing ne obstaja', 404);
    return {
      title: l.title,
      description: l.detailDescription || l.description,
      imageUrl: l.imageUrl || '',
      price: l.price ?? 0,
      category: l.monitor?.source || '',
    };
  }
  // Should never reach here because validateInput catches it first
  throw new ApiRouteError('listingId ali tradeId je obvezen', 400);
}

interface PromptData {
  title: string;
  description: string;
  imageUrl: string;
  price: number;
  category: string;
}

function buildPrompt(d: PromptData): string {
  return `Si AI listing quality predictor. Napovej kakovost oglasa pred objavo.
Analiziraj naslov, opis, ceno in sliko za napoved uspešnosti.

NASLOV: ${d.title}
KATEGORIJA: ${d.category}
CENA: ${d.price}€
OPIS: ${d.description.slice(0, 800)}
SLIKA: ${d.imageUrl ? 'na voljo' : 'ni slike'}

Quality komponente (vsaka 0-100):
1. TITLE_QUALITY: ali naslov vsebuje ključne besede, brand, model, stanje?
2. DESCRIPTION_QUALITY: ali je opis popoln (stanje, specifikacije, kontakt)?
3. PRICE_COMPETITIVENESS: ali je cena konkurenčna glede na trg?
4. IMAGE_QUALITY: ali slika privlači kupca?
5. SEO_SCORE: ali ga bodo našli v iskanju?
6. TRUST_SCORE: ali vzbuja zaupanje (račun, garancija, prevzem)?
7. COMPLETENESS: ali manjka kaj ključnega?
8. CONVERSION_POTENTIAL: ali bo konvertiral v povpraševanje?

Quality grade: A+ (90+), A (80+), B+ (70+), B (60+), C (50+), D (<50)

Odgovori LE z JSON:
{
  "quality_score": <number 0-100>,
  "grade": "<A+|A|B+|B|C|D>",
  "components": [
    { "name": "<title|description|price|image|seo|trust|completeness|conversion>", "score": <number 0-100>, "weight_pct": <number>, "issues": ["<max 60 znakov>"], "strengths": ["<max 60 znakov>"] }
  ],
  "issues": [
    { "type": "<missing_info|poor_image|bad_title|overpriced|underpriced|low_seo|low_trust|incomplete>", "severity": "<high|medium|low>", "description": "<max 100 znakov>", "fix": "<max 100 znakov>" }
  ],
  "improvements": [
    { "action": "<max 100 znakov>", "impact": "<high|medium|low>", "expected_score_increase": <number>, "difficulty": "<easy|medium|hard>" }
  ],
  "projected_performance": {
    "expected_views_7d": <number>,
    "expected_inquiries_7d": <number>,
    "expected_sell_probability_30d_pct": <number>,
    "expected_sell_time_days": <number>,
    "expected_final_price_eur": <number>
  },
  "quick_fixes": ["<max 80 znakov>", "..."],
  "reasoning": "<max 200 znakov>"
}`;
}

function transformPrediction(parsed: any, price: number) {
  return {
    qualityScore: Math.max(0, Math.min(100, Number(parsed?.quality_score ?? 50))),
    grade: includes(String(parsed?.grade), GRADES) ? String(parsed.grade) : 'C',
    components: (parsed?.components || []).slice(0, 8).map((c: any) => ({
      name: String(c?.name ?? '').slice(0, 50), score: Math.max(0, Math.min(100, Number(c?.score ?? 50))),
      weightPct: Math.max(0, Math.min(100, Number(c?.weight_pct ?? 0))),
      issues: (c?.issues || []).slice(0, 3).map((i: any) => String(i).slice(0, 100)),
      strengths: (c?.strengths || []).slice(0, 3).map((s: any) => String(s).slice(0, 100)),
    })),
    issues: (parsed?.issues || []).slice(0, 8).map((i: any) => ({
      type: String(i?.type ?? '').slice(0, 50), severity: includes(String(i?.severity), SEVERITIES) ? String(i.severity) : 'medium',
      description: String(i?.description ?? '').slice(0, 200), fix: String(i?.fix ?? '').slice(0, 200),
    })),
    improvements: (parsed?.improvements || []).slice(0, 6).map((im: any) => ({
      action: String(im?.action ?? '').slice(0, 200), impact: includes(String(im?.impact), IMPACTS) ? String(im.impact) : 'medium',
      expectedScoreIncrease: Math.round(Number(im?.expected_score_increase ?? 0)), difficulty: includes(String(im?.difficulty), DIFFICULTIES) ? String(im.difficulty) : 'medium',
    })),
    projectedPerformance: {
      expectedViews7d: Math.max(0, Number(parsed?.projected_performance?.expected_views_7d ?? 0)),
      expectedInquiries7d: Math.max(0, Number(parsed?.projected_performance?.expected_inquiries_7d ?? 0)),
      expectedSellProbability30dPct: Math.max(0, Math.min(100, Number(parsed?.projected_performance?.expected_sell_probability_30d_pct ?? 30))),
      expectedSellTimeDays: Math.max(0, Number(parsed?.projected_performance?.expected_sell_time_days ?? 30)),
      expectedFinalPriceEur: Math.max(0, Number(parsed?.projected_performance?.expected_final_price_eur ?? price)),
    },
    quickFixes: (parsed?.quick_fixes || []).slice(0, 5).map((q: any) => String(q).slice(0, 150)),
    reasoning: String(parsed?.reasoning ?? '').slice(0, 400),
  };
}
