// v6.22 / v8.94-refactor: AI Listing Title A/B Tester — generira in testira naslove oglasov za maksimalen CTR
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/title-abtest
// Body: { tradeId?: string, currentTitle?: string, category?: string, price?: number }
// Returns: { ok, test: { currentTitle, currentTitleAnalysis, variants, winner, platformSpecificTitles, tips } }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface TitleAbTestInput {
  tradeId?: string;
  currentTitle?: string;
  category?: string;
  price?: number;
}

const TITLE_STRATEGIES = ['KEYWORD_OPTIMIZED', 'BENEFIT_DRIVEN', 'URGENCY', 'CURIOSITY', 'SPECIFICITY'] as const;
const TITLE_PLATFORMS = ['bolha', 'vinted', 'facebook', 'avtonet', 'kleinanzeigen'] as const;

export const POST = withAiRoute<TitleAbTestInput>({
  endpoint: '/api/ai/title-abtest',
  maxDuration: 60,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : undefined,
      currentTitle: body?.currentTitle != null ? String(body.currentTitle) : undefined,
      category: body?.category != null ? String(body.category) : undefined,
      price: body?.price != null ? Number(body.price) : undefined,
    };
  },

  // validateInput izpuščen — currentTitle pride lahko iz trade-a (DB lookup v handler-ju).
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    let currentTitle = input.currentTitle ?? '';
    let category = input.category ?? '';
    let price = input.price ?? 0;
    let description = '';

    if (input.tradeId) {
      const trade = await db.trade.findUnique({
        where: { id: input.tradeId },
        select: {
          title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, aiEstimatedValue: true } },
        },
      });
      if (!trade) throw new ApiRouteError('Trade ne obstaja', 404);
      currentTitle = currentTitle || trade.title;
      category = category || trade.category || '';
      price = price || trade.buyPrice;
      description = trade.listing?.detailDescription || trade.listing?.description || '';
    }

    if (!currentTitle) {
      return apiBadRequest('currentTitle ali tradeId je obvezen');
    }

    // 1. AI A/B test naslovov
    const prompt = buildTitleAbTestPrompt(currentTitle, category, price, description);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const test = transformTitleAbTestResult(parsed, currentTitle);

    return apiOk({ test });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildTitleAbTestPrompt(
  currentTitle: string,
  category: string,
  price: number,
  description: string
): string {
  return `Si ekspert za copywriting in A/B testiranje naslovov oglasov.
Generiraj 5 variants naslova za ta artikel in oceni njihovo učinkovitost.

TRENUTNI NASLOV: ${currentTitle}
KATEGORIJA: ${category}
CENA: ${price}€
OPIS: ${description.slice(0, 400)}

Slovenski kontekst:
- Bolha: max 60 znakov, ključne besede zadaj
- Vinted: max 80 znakov, brend + velikost + stanje
- Facebook: max 100 znakov, emoji dovoljen, lokacija koristna
- Avtonet: max 50 znakov, tehnični podatki (letnik, km)
- Kleinanzeigen: max 70 znakov, "Suche" ali "Biete" predpona

Strategije naslovov:
1. KEYWORD_OPTIMIZED: ključne besede za iskanje (model, brand, stanje)
2. BENEFIT_DRIVEN: poudari korist ("kot novo", "z garancijo", "redko")
3. URGENCY: nujnost ("nujno", "akcijska cena", "samo še danes")
4. CURIOSITY: zanimivost ("redki model", "izzučna priložnost")
5. SPECIFICITY: specifičnost (letnik, km, velikost, barva)

Za vsako varianto oceni:
- CTR score (0-100) — predviden click-through rate
- searchVisibility (0-100) — kako dobro bo najden v iskanju
- conversionScore (0-100) — predvidena konverzija v nakup
- characterCount (ali ustreza limitu platforme)
- strengths/weaknesses

Odgovori LE z JSON:
{
  "current_title_analysis": {
    "score": <number 0-100>,
    "strengths": ["<max 60 znakov>", "..."],
    "weaknesses": ["<max 60 znakov>", "..."]
  },
  "variants": [
    {
      "title": "<variant naslov, max 100 znakov>",
      "strategy": "<KEYWORD_OPTIMIZED|BENEFIT_DRIVEN|URGENCY|CURIOSITY|SPECIFICITY>",
      "character_count": <number>,
      "ctr_score": <number 0-100>,
      "search_visibility": <number 0-100>,
      "conversion_score": <number 0-100>,
      "overall_score": <number 0-100>,
      "strengths": ["<max 60 znakov>", "..."],
      "weaknesses": ["<max 60 znakov>", "..."],
      "best_for_platform": "<bolha|vinted|facebook|avtonet|kleinanzeigen>"
    }
  ],
  "winner": {
    "title": "<boljši naslov>",
    "why": "<max 150 znakov>",
    "expected_improvement_pct": <number>
  },
  "platform_specific_titles": {
    "bolha": "<naslov za Bolha, max 60 znakov>",
    "vinted": "<naslov za Vinted, max 80 znakov>",
    "facebook": "<naslov za Facebook z emoji, max 100 znakov>",
    "kleinanzeigen": "<naslov za Kleinanzeigen, max 70 znakov>"
  },
  "tips": ["<splošno priporočilo, max 100 znakov>", "..."]
}`;
}

function clampScore(v: any, def = 50): number {
  return Math.max(0, Math.min(100, Number(v ?? def)));
}

function transformTitleAbTestResult(parsed: any, currentTitle: string) {
  const cta = parsed?.current_title_analysis ?? {};
  return {
    currentTitle,
    currentTitleAnalysis: {
      score: clampScore(cta.score),
      strengths: (cta.strengths || []).slice(0, 4).map((s: any) => String(s).slice(0, 150)),
      weaknesses: (cta.weaknesses || []).slice(0, 4).map((w: any) => String(w).slice(0, 150)),
    },
    variants: (parsed?.variants || []).slice(0, 6).map((v: any) => ({
      title: String(v?.title ?? '').slice(0, 200),
      strategy: (TITLE_STRATEGIES as readonly string[]).includes(String(v?.strategy))
        ? String(v.strategy) : 'KEYWORD_OPTIMIZED',
      characterCount: Math.max(0, Number(v?.character_count ?? 0)),
      ctrScore: clampScore(v?.ctr_score),
      searchVisibility: clampScore(v?.search_visibility),
      conversionScore: clampScore(v?.conversion_score),
      overallScore: clampScore(v?.overall_score),
      strengths: (v?.strengths || []).slice(0, 3).map((s: any) => String(s).slice(0, 150)),
      weaknesses: (v?.weaknesses || []).slice(0, 3).map((w: any) => String(w).slice(0, 150)),
      bestForPlatform: (TITLE_PLATFORMS as readonly string[]).includes(String(v?.best_for_platform))
        ? String(v.best_for_platform) : 'bolha',
    })),
    winner: {
      title: String(parsed?.winner?.title ?? '').slice(0, 200),
      why: String(parsed?.winner?.why ?? '').slice(0, 300),
      expectedImprovementPct: Math.max(0, Number(parsed?.winner?.expected_improvement_pct ?? 0)),
    },
    platformSpecificTitles: {
      bolha: String(parsed?.platform_specific_titles?.bolha ?? '').slice(0, 100),
      vinted: String(parsed?.platform_specific_titles?.vinted ?? '').slice(0, 120),
      facebook: String(parsed?.platform_specific_titles?.facebook ?? '').slice(0, 150),
      kleinanzeigen: String(parsed?.platform_specific_titles?.kleinanzeigen ?? '').slice(0, 120),
    },
    tips: (parsed?.tips || []).slice(0, 6).map((t: any) => String(t).slice(0, 250)),
  };
}
