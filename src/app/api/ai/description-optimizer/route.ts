// v6.23 / v8.94.4-b-refactor: AI Listing Description Optimizer — optimizira opise oglasov z A/B test variantami
// Refaktoriran z withAiRoute helperjem (v8.94) — boilerplate (try/catch, settings
// load, fallback provider, rate limit, JSON parse, AI counter increment) je
// izločen v helper. enforceBudget: true — helper avtomatsko recordAiCall.
//
// POST /api/ai/description-optimizer
// Body: { tradeId?: string, currentDescription?: string, title?: string, category?: string, price?: number, targetPlatform?: string }
// Returns: { ok, optimization: { currentAnalysis, variants, winner, seoKeywords, improvements, platformSpecificTips }, targetPlatform }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiNotFound } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

const VALID_PLATFORMS = ['bolha', 'vinted', 'facebook', 'avtonet', 'kleinanzeigen'] as const;
const VALID_STRATEGIES = ['BENEFIT_FOCUSED', 'STORYTELLING', 'TECHNICAL', 'SCANNABLE'] as const;
const VALID_PRIORITIES = ['high', 'medium', 'low'] as const;

interface DescriptionOptimizerInput {
  tradeId?: string;
  currentDescription: string;
  title: string;
  category: string;
  price: number;
  targetPlatform: string;
}

export const POST = withAiRoute<DescriptionOptimizerInput>({
  endpoint: '/api/ai/description-optimizer',
  maxDuration: 60,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : undefined,
      currentDescription: body?.currentDescription ? String(body.currentDescription) : '',
      title: body?.title ? String(body.title) : '',
      category: body?.category ? String(body.category) : '',
      price: typeof body?.price === 'number' ? body.price : Number(body?.price) || 0,
      targetPlatform: (VALID_PLATFORMS as readonly string[]).includes(String(body?.targetPlatform))
        ? String(body.targetPlatform) : 'bolha',
    };
  },

  validateInput: (input) => {
    if (!input.currentDescription && !input.tradeId) {
      return 'currentDescription ali tradeId je obvezen';
    }
    return null;
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    let { currentDescription, title, category, price, targetPlatform } = input;

    // Če je podan tradeId, naloži title/category/price/description iz baze
    if (input.tradeId) {
      const trade = await db.trade.findUnique({
        where: { id: input.tradeId },
        select: {
          title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, aiEstimatedValue: true } },
        },
      });
      if (!trade) return apiNotFound('Trade ne obstaja');
      title = title || trade.title;
      category = category || trade.category || '';
      price = price || trade.buyPrice;
      currentDescription = currentDescription || trade.listing?.detailDescription || trade.listing?.description || '';
    }

    // 1. AI optimizacija
    const prompt = buildPrompt(title, category, price, currentDescription, targetPlatform);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const optimization = transformOptimization(parsed);

    // (AI counter increment obravnava helper preko enforceBudget: true → recordAiCall)
    return apiOk({
      ok: true,
      optimization,
      targetPlatform,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) ---------------------------------

/** Zgradi AI prompt za optimizacijo opisa (besedilo IDENTIČNO originalu). */
function buildPrompt(
  title: string,
  category: string,
  price: number,
  currentDescription: string,
  targetPlatform: string
): string {
  return `Si ekspert za copywriting in optimizacijo opisov oglasov za e-commerce.
Analiziraj trenutni opis in generiraj 4 optimizirane variante z različnimi strategijami.

NASLOV: ${title}
KATEGORIJA: ${category}
CENA: ${price}€
TRENUTNI OPIS:
${currentDescription.slice(0, 1500)}

CIJLJNA PLATFORMA: ${targetPlatform}

Slovenski kontekst:
- Bolha: do 2000 znakov, ključne besede v prvih 200 znakih
- Vinted: do 500 znakov, hashtagi (#bolha #stanje), specifikacije
- Facebook: do 5000 znakov, emoji dovoljen, osebni ton
- Avtonet: do 1000 znakov, tehnični podatki (letnik, km, kW)
- Kleinanzeigen: do 4000 znakov, "Zustand" opis, "Versand" informacija

Strategije opisov:
1. BENEFIT_FOCUSED: poudari koristi za kupca ("prihranek", "kakovost", "redkost")
2. STORYTELLING: osebna zgodba (zakaj prodaja, zgodovina itema)
3. TECHNICAL: specifikacije in tehnični podatki (slovenski kupci to radi)
4. SCANNABLE: bullet list, enostaven pregled (hitro prebiranje)

Za vsako varianto oceni:
- readabilityScore (0-100) — kako enostavno berljivo
- persuasivenessScore (0-100) — kako prepričljivo
- seoScore (0-100) — ključne besede za iskanje
- trustScore (0-100) — koliko zaupanja vzbuja
- characterCount (ali ustreza limitu)
- expectedInquiries (predvideno število povpraševanj)

Odgovori LE z JSON:
{
  "current_analysis": {
    "score": <number 0-100>,
    "word_count": <number>,
    "strengths": ["<max 60 znakov>", "..."],
    "weaknesses": ["<max 60 znakov>", "..."],
    "missing_elements": ["<kaj manjka, max 80 znakov>", "..."]
  },
  "variants": [
    {
      "strategy": "<BENEFIT_FOCUSED|STORYTELLING|TECHNICAL|SCANNABLE>",
      "description": "<optimiziran opis, max 2500 znakov>",
      "character_count": <number>,
      "readability_score": <number 0-100>,
      "persuasiveness_score": <number 0-100>,
      "seo_score": <number 0-100>,
      "trust_score": <number 0-100>,
      "overall_score": <number 0-100>,
      "expected_inquiries": <number>,
      "key_features": ["<kaj je poudarjeno, max 60 znakov>", "..."],
      "best_for_platform": "<bolha|vinted|facebook|avtonet|kleinanzeigen>"
    }
  ],
  "winner": {
    "description": "<zmagovalni opis>",
    "why": "<max 200 znakov>",
    "expected_improvement_pct": <number>
  },
  "seo_keywords": ["<ključna beseda, max 30 znakov>", "..."],
  "improvements": [
    {
      "element": "<kaj dodati, max 80 znakov>",
      "priority": "<high|medium|low>",
      "impact": "<max 80 znakov>"
    }
  ],
  "platform_specific_tips": {
    "bolha": "<max 100 znakov>",
    "vinted": "<max 100 znakov>",
    "facebook": "<max 100 znakov>"
  }
}`;
}

/** Transformiraj AI JSON v optimizacijski objekt (validacija + slice + clamp). */
function transformOptimization(parsed: any) {
  return {
    currentAnalysis: {
      score: clampInt(Number(parsed?.current_analysis?.score ?? 50), 0, 100),
      wordCount: Math.max(0, Number(parsed?.current_analysis?.word_count ?? 0)),
      strengths: (parsed?.current_analysis?.strengths || []).slice(0, 4).map((s: any) => String(s).slice(0, 150)),
      weaknesses: (parsed?.current_analysis?.weaknesses || []).slice(0, 4).map((w: any) => String(w).slice(0, 150)),
      missingElements: (parsed?.current_analysis?.missing_elements || []).slice(0, 5).map((m: any) => String(m).slice(0, 200)),
    },
    variants: (parsed?.variants || []).slice(0, 5).map((v: any) => ({
      strategy: (VALID_STRATEGIES as readonly string[]).includes(String(v?.strategy))
        ? String(v.strategy) : 'BENEFIT_FOCUSED',
      description: String(v?.description ?? '').slice(0, 3000),
      characterCount: Math.max(0, Number(v?.character_count ?? 0)),
      readabilityScore: clampInt(Number(v?.readability_score ?? 50), 0, 100),
      persuasivenessScore: clampInt(Number(v?.persuasiveness_score ?? 50), 0, 100),
      seoScore: clampInt(Number(v?.seo_score ?? 50), 0, 100),
      trustScore: clampInt(Number(v?.trust_score ?? 50), 0, 100),
      overallScore: clampInt(Number(v?.overall_score ?? 50), 0, 100),
      expectedInquiries: Math.max(0, Number(v?.expected_inquiries ?? 0)),
      keyFeatures: (v?.key_features || []).slice(0, 5).map((f: any) => String(f).slice(0, 150)),
      bestForPlatform: (VALID_PLATFORMS as readonly string[]).includes(String(v?.best_for_platform))
        ? String(v.best_for_platform) : 'bolha',
    })),
    winner: {
      description: String(parsed?.winner?.description ?? '').slice(0, 3000),
      why: String(parsed?.winner?.why ?? '').slice(0, 300),
      expectedImprovementPct: Math.max(0, Number(parsed?.winner?.expected_improvement_pct ?? 0)),
    },
    seoKeywords: (parsed?.seo_keywords || []).slice(0, 10).map((k: any) => String(k).slice(0, 80)),
    improvements: (parsed?.improvements || []).slice(0, 8).map((i: any) => ({
      element: String(i?.element ?? '').slice(0, 200),
      priority: (VALID_PRIORITIES as readonly string[]).includes(String(i?.priority)) ? String(i.priority) : 'medium',
      impact: String(i?.impact ?? '').slice(0, 200),
    })),
    platformSpecificTips: {
      bolha: String(parsed?.platform_specific_tips?.bolha ?? '').slice(0, 300),
      vinted: String(parsed?.platform_specific_tips?.vinted ?? '').slice(0, 300),
      facebook: String(parsed?.platform_specific_tips?.facebook ?? '').slice(0, 300),
    },
  };
}

/** Clamp števila v [min, max]; non-finite → min. */
function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
