// v6.14 / v8.96.0-batch4: AI Multi-Modal Listing Generator — generira celovit listing za prodajo
// Refaktoriran z withAiRoute helperjem (v8.96) + enforceBudget guard.
//
// POST /api/ai/multimodal-listing
// Body: { tradeId?: string, trade?: { title, category, buyPrice, description }, targetPlatform?: 'bolha'|'vinted'|'facebook'|'avtonet', language?: 'sl'|'en' }
// Returns: { ok, listing: { title, description, price, platforms: [{ name, titleAdapted, priceAdapted, descriptionAdapted }], imageStrategy, tags, keywords, seo } }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface TradeInput {
  title: string;
  category?: string;
  buyPrice?: number;
  buyFees?: number;
  description?: string;
}

interface MultimodalListingInput {
  tradeId: string | null;
  targetPlatform: string;
  language: string;
  trade: TradeInput | null;
}

interface SimilarListingRow {
  price: number | null;
  title: string;
  firstSeenAt: Date;
  monitor: { source: string | null } | null;
}

export const POST = withAiRoute<MultimodalListingInput>({
  endpoint: '/api/ai/multimodal-listing',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const { tradeId, targetPlatform, language } = body;
    const tradeInput: TradeInput | null = body?.trade ?? null;
    const lang = language === 'en' ? 'en' : 'sl';
    const platform = ['bolha', 'vinted', 'facebook', 'avtonet'].includes(String(targetPlatform))
      ? String(targetPlatform) : 'bolha';
    return {
      tradeId: tradeId ? String(tradeId) : null,
      targetPlatform: platform,
      language: lang,
      trade: tradeInput,
    };
  },

  // No validateInput — tradeId/trade validacija se zgodi v handler-ju (odvisno od trade fetch-a)
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId, targetPlatform, language, trade } = input;
    let tradeInput: TradeInput | null = trade;

    // 1. Pridobi trade iz baze
    if (tradeId && !tradeInput) {
      const tradeRow = await db.trade.findUnique({
        where: { id: String(tradeId) },
        select: {
          title: true, category: true, buyPrice: true, buyFees: true,
          notes: true, listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true, dealScore: true } },
        },
      });
      if (!tradeRow) throw new ApiRouteError('Trade ne obstaja', 404);
      tradeInput = {
        title: tradeRow.title,
        category: tradeRow.category,
        buyPrice: tradeRow.buyPrice,
        buyFees: tradeRow.buyFees,
        description: tradeRow.notes || tradeRow.listing?.detailDescription || tradeRow.listing?.description,
      };
    }

    if (!tradeInput) {
      throw new ApiRouteError('tradeId ali trade objekt je obvezen', 400);
    }

    // 2. Pridobi kontekst — podobni aktivni oglasi za benchmark
    const cost = (tradeInput.buyPrice ?? 0) + (tradeInput.buyFees ?? 0);
    let marketBenchmark = '';

    if (cost > 0) {
      const similar = await db.listing.findMany({
        where: {
          price: { gte: Math.floor(cost * 0.7), lte: Math.ceil(cost * 1.5) },
          isHidden: false,
        },
        select: { price: true, title: true, firstSeenAt: true, monitor: { select: { source: true } } },
        take: 20,
      });
      marketBenchmark = computeMarketBenchmark(similar as SimilarListingRow[]);
    }

    // 3. AI multi-modal listing generation
    const prompt = buildPrompt({
      title: tradeInput.title,
      category: tradeInput.category,
      cost,
      description: tradeInput.description ?? '',
      marketBenchmark,
      platform: targetPlatform,
      lang: language,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const listing = transformListing(parsed, tradeInput.title, cost);

    return apiOk({
      ok: true,
      listing,
      trade: { ...tradeInput, cost },
      marketBenchmark,
      platform: targetPlatform,
      language,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function computeMarketBenchmark(similar: SimilarListingRow[]): string {
  const prices = similar.map(l => l.price!).filter(Boolean);
  if (prices.length === 0) return '';
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return `Tržno povprečje podobnih: ${avg}€ (min ${min}€, max ${max}€, ${prices.length} oglasov)`;
}

interface PromptData {
  title: string;
  category?: string;
  cost: number;
  description: string;
  marketBenchmark: string;
  platform: string;
  lang: string;
}

function buildPrompt(d: PromptData): string {
  return `Si ekspert za copywriting in marketing pri prodaji rabljenih dobrin.
Generiraj celovit listing za prodajo tega artikla, optimiziran za ${d.platform}.

ARTIKEL:
Naslov: ${d.title}
Kategorija: ${d.category || 'neznan'}
Nabavna cena: ${d.cost}€
Opis: ${d.description.slice(0, 800)}

${d.marketBenchmark ? `TRŽNI BENCHMARK:\n${d.marketBenchmark}\n` : ''}
Ciljna platforma: ${d.platform}
Jezik: ${d.lang === 'sl' ? 'slovenščina' : 'angleščina'}

Pravila za vsako platformo:
- Bolha: dovoljen naslov 60 znakov, opis 2000 znakov, poudari stanje in kontakt
- Vinted: naslov 80 znakov, opis 500 znakov, fokus na stanje/brend/size, hash tags
- Facebook Marketplace: naslov 100 znakov, opis 5000 znakov, emoji, fokus na ceno in lokacijo
- Avtonet: naslov 50 znakov, opis 1000 znakov, tehnični podatki, letnik, km

Slikovna strategija:
- glavna slika: dobra osvetlitev, čisto ozadje, celotni item viden
- detalj: pokaži brand/oznako, morebitne poškodbe
- kontekst: item v uporabi (npr. telefon v roki, kolo na cesti)
- video: 360° vrtenje za dragocene iteme (>500€)

SEO ključne besede: 5-10 relevantnih iskalnih besed, ki jih kupec išče

Odgovori LE z JSON:
{
  "title": "<optimiziran naslov za ${d.platform}, max 100 znakov>",
  "price_recommendation": <number>,
  "price_strategy": "<premium|fair|aggressive>",
  "main_description": "<glavni opis v ${d.lang === 'sl' ? 'slovenščini' : 'angleščini'}, 800-1500 znakov>",
  "platforms_adaptations": [
    {
      "platform": "bolha",
      "title": "<naslov prilagojen za bolha, max 60 znakov>",
      "price": <number>,
      "description_short": "<krajši opis za bolha, max 500 znakov>"
    },
    {
      "platform": "facebook",
      "title": "<naslov za FB, max 100 znakov, z emoji>",
      "price": <number>,
      "description_short": "<opis za FB z emoji, max 800 znakov>"
    },
    {
      "platform": "vinted",
      "title": "<naslov za Vinted, max 80 znakov>",
      "price": <number>,
      "description_short": "<opis za Vinted s hashtagi, max 400 znakov>"
    }
  ],
  "image_strategy": {
    "main_shot": "<opis glavne slike, max 100 znakov>",
    "detail_shots": ["<detalj 1, max 80 znakov>", "<detalj 2>", "<detalj 3>"],
    "context_shot": "<kontekstna slika, max 100 znakov>",
    "video_recommended": <boolean>,
    "video_description": "<kakšen video, max 100 znakov>"
  },
  "tags_keywords": ["<ključna beseda 1>", "..."],
  "seo": {
    "primary_keyword": "<glavna ključna beseda>",
    "search_terms": ["<izraz ki ga kupec išče>", "..."]
  },
  "call_to_action": "<CTA na koncu opisa, max 80 znakov>",
  "highlight_features": ["<feature 1, max 50 znakov>", "..."],
  "honest_disclosures": ["<pošteno povedano o stanju, max 80 znakov>", "..."]
}`;
}

function transformListing(parsed: any, fallbackTitle: string, fallbackCost: number) {
  return {
    title: String(parsed?.title ?? fallbackTitle).slice(0, 200),
    priceRecommendation: Math.max(0, Number(parsed?.price_recommendation ?? Math.round(fallbackCost * 1.25))),
    priceStrategy: ['premium', 'fair', 'aggressive'].includes(String(parsed?.price_strategy))
      ? String(parsed.price_strategy) : 'fair',
    mainDescription: String(parsed?.main_description ?? '').slice(0, 3000),
    platformsAdaptations: (parsed?.platforms_adaptations || []).slice(0, 4).map((p: any) => ({
      platform: ['bolha', 'vinted', 'facebook', 'avtonet'].includes(String(p?.platform))
        ? String(p.platform) : 'bolha',
      title: String(p?.title ?? '').slice(0, 200),
      price: Math.max(0, Number(p?.price ?? 0)),
      descriptionShort: String(p?.description_short ?? '').slice(0, 1500),
    })),
    imageStrategy: {
      mainShot: String(parsed?.image_strategy?.main_shot ?? '').slice(0, 200),
      detailShots: Array.isArray(parsed?.image_strategy?.detail_shots)
        ? parsed.image_strategy.detail_shots.slice(0, 5).map((s: any) => String(s).slice(0, 150))
        : [],
      contextShot: String(parsed?.image_strategy?.context_shot ?? '').slice(0, 200),
      videoRecommended: Boolean(parsed?.image_strategy?.video_recommended ?? false),
      videoDescription: String(parsed?.image_strategy?.video_description ?? '').slice(0, 200),
    },
    tagsKeywords: Array.isArray(parsed?.tags_keywords)
      ? parsed.tags_keywords.slice(0, 12).map((t: any) => String(t).slice(0, 50))
      : [],
    seo: {
      primaryKeyword: String(parsed?.seo?.primary_keyword ?? '').slice(0, 80),
      searchTerms: Array.isArray(parsed?.seo?.search_terms)
        ? parsed.seo.search_terms.slice(0, 8).map((s: any) => String(s).slice(0, 80))
        : [],
    },
    callToAction: String(parsed?.call_to_action ?? '').slice(0, 200),
    highlightFeatures: Array.isArray(parsed?.highlight_features)
      ? parsed.highlight_features.slice(0, 6).map((f: any) => String(f).slice(0, 100))
      : [],
    honestDisclosures: Array.isArray(parsed?.honest_disclosures)
      ? parsed.honest_disclosures.slice(0, 4).map((d: any) => String(d).slice(0, 200))
      : [],
  };
}
