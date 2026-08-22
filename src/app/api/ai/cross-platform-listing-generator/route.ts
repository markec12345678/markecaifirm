// v7.39 / v8.95.8-other1: AI Cross-Platform Listing Generator — generira prodajne oglase za 3 platforme.
// Refaktoriran z withAiRoute helperjem (v8.95.8-other1) + enforceBudget guard.
//
// Ko si pripravljen prodati item, AI generira:
// - Bolha oglas (slovenski, podroben, SEO optimiziran)
// - Vinted oglas (krajši, moda-style, hashtags)
// - Facebook Marketplace (direkten, cenejsi tone, local pickup)
//
// Vsak oglas je optimiziran za platformo: dolzina, ton, kljucne besede, format.
//
// POST /api/ai/cross-platform-listing-generator
// Body: { tradeId: string }
// Returns: { ok, trade, pricing, listings, photoTips, listingStrategy }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface CrossPlatformInput {
  tradeId: string;
}

interface PromptData {
  title: string;
  category: string;
  totalCost: number;
  estValue: number;
  description: string;
  aiImageAnalysis: string | null;
}

export const POST = withAiRoute<CrossPlatformInput>({
  endpoint: '/api/ai/cross-platform-listing-generator',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { tradeId: String(body?.tradeId ?? '') };
  },

  validateInput: (input) => (input.tradeId ? null : 'tradeId je obvezen'),

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId } = input;

    // 1. Load trade
    const trade = await db.trade.findUnique({
      where: { id: tradeId },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true,
        imageUrl: true, url: true, notes: true,
        listing: { select: { description: true, aiEstimatedValue: true, detailDescription: true, aiImageAnalysis: true } },
      },
    });
    if (!trade) throw new ApiRouteError('Trade ne obstaja', 404);

    const totalCost = trade.buyPrice + (trade.buyFees ?? 0);
    const estValue = trade.listing?.aiEstimatedValue ?? Math.round(totalCost * 1.25);
    const description = trade.listing?.detailDescription || trade.listing?.description || trade.notes || '';

    // 2. Build prompt + call AI
    const prompt = buildPrompt({
      title: trade.title,
      category: trade.category || 'splosno',
      totalCost,
      estValue,
      description,
      aiImageAnalysis: trade.listing?.aiImageAnalysis ?? null,
    });
    const raw = await callAi(prompt);

    // 3. Parse + transform
    const parsed: any = parseAi(raw);
    const { pricing, listings, photoTips, listingStrategy } = transformResponse(parsed, estValue, trade.title);

    return apiOk({
      ok: true,
      trade: { id: trade.id, title: trade.title, buyPrice: totalCost, estValue },
      pricing,
      listings,
      photoTips,
      listingStrategy,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildPrompt(d: PromptData): string {
  return `Si ekspert za pisanje prodajnih oglasov na slovenskih oglasnih platformah.

Generiraj 3 razlicne oglase za ta item — vsak optimiziran za drugo platformo.

ITEM:
- Naslov: ${d.title}
- Kategorija: ${d.category}
- Nabavna cena: ${d.totalCost}€
- AI ocenjena vrednost: ${d.estValue}€
- Opis/artikel: ${d.description.slice(0, 500) || 'Ni dodatnega opisa'}
${d.aiImageAnalysis ? `- AI analiza slike: ${d.aiImageAnalysis}` : ''}

CENOVNA STRATEGIJA:
- Nabavna: ${d.totalCost}€
- Predlagana prodajna cena: ${d.estValue}€ (margin: ${d.estValue - d.totalCost}€)
- Hitra prodaja (7 dni): ${Math.round(d.estValue * 0.9)}€
- Premium (30 dni): ${Math.round(d.estValue * 1.1)}€

PRAVILA ZA PLATFORMO:

1. BOLHA.COM:
- Dolzina: 200-400 besed
- Ton: podroben, informativen, profesionalen
- Struktura: naslov → stanje → specifikacije → dodaten paket → prevzem
- SEO: naravno vkljuci iskalne besede
- Obvezno omeni: stanje (novo/rabljeno), starost, dodatki, garancija
- Format: Markdown (bold naslovi, bullet tocke)

2. VINTED:
- Dolzina: 50-100 besed (krajse!)
- Ton: lazji, bolj osbnostni, emoji dovoljen
- Struktura: kratek opis → stanje → meri/velikost → postnina
- Tags: #hashtag style na koncu
- Fokus na: stanje, brend, velikost/meritve

3. FACEBOOK MARKETPLACE:
- Dolzina: 80-150 besed
- Ton: direkten, konkreten, lokalno
- Struktura: kaj je → stanje → cena → prevzem/posiljanje
- Fokus na: cena (poudari popust), lokacija, hitra prevzem
- POMEMBNO: omeni da si zasebna oseba (ne dealer)

Odgovori LE z JSON:
{
  "pricing": {
    "bolha": <number>,
    "vinted": <number>,
    "facebook": <number>,
    "reasoning": "<zakaj razlicne cene>"
  },
  "listings": {
    "bolha": {
      "title": "<max 80 znakov>",
      "description": "<full markdown>",
      "price": <number>
    },
    "vinted": {
      "title": "<max 80 znakov>",
      "description": "<kratek tekst>",
      "tags": ["#tag1", "#tag2", "..."],
      "price": <number>
    },
    "facebook": {
      "title": "<max 80 znakov>",
      "description": "<direkten tekst>",
      "price": <number>,
      "location_hint": "<npr. Ljubljana center>"
    }
  },
  "photo_tips": ["<nasvet za fotografijo 1>", "..."],
  "listing_strategy": "<1 stavek: katero platformo prvo in zakaj>"
}`;
}

function transformResponse(parsed: any, estValue: number, fallbackTitle: string): {
  pricing: {
    bolha: number;
    vinted: number;
    facebook: number;
    reasoning: string;
  };
  listings: {
    bolha: { title: string; description: string; price: number };
    vinted: { title: string; description: string; tags: string[]; price: number };
    facebook: { title: string; description: string; price: number; locationHint: string };
  };
  photoTips: string[];
  listingStrategy: string;
} {
  return {
    pricing: {
      bolha: Math.round(Number(parsed?.pricing?.bolha ?? estValue)),
      vinted: Math.round(Number(parsed?.pricing?.vinted ?? estValue * 0.95)),
      facebook: Math.round(Number(parsed?.pricing?.facebook ?? estValue * 0.9)),
      reasoning: String(parsed?.pricing?.reasoning ?? '').slice(0, 200),
    },
    listings: {
      bolha: {
        title: String(parsed?.listings?.bolha?.title ?? fallbackTitle).slice(0, 80),
        description: String(parsed?.listings?.bolha?.description ?? '').slice(0, 2000),
        price: Math.round(Number(parsed?.listings?.bolha?.price ?? estValue)),
      },
      vinted: {
        title: String(parsed?.listings?.vinted?.title ?? fallbackTitle).slice(0, 80),
        description: String(parsed?.listings?.vinted?.description ?? '').slice(0, 500),
        tags: (parsed?.listings?.vinted?.tags || []).slice(0, 10).map((t: any) => String(t).slice(0, 30)),
        price: Math.round(Number(parsed?.listings?.vinted?.price ?? estValue * 0.95)),
      },
      facebook: {
        title: String(parsed?.listings?.facebook?.title ?? fallbackTitle).slice(0, 80),
        description: String(parsed?.listings?.facebook?.description ?? '').slice(0, 1000),
        price: Math.round(Number(parsed?.listings?.facebook?.price ?? estValue * 0.9)),
        locationHint: String(parsed?.listings?.facebook?.location_hint ?? 'Ljubljana').slice(0, 50),
      },
    },
    photoTips: (parsed?.photo_tips || []).slice(0, 5).map((t: any) => String(t).slice(0, 200)),
    listingStrategy: String(parsed?.listing_strategy ?? '').slice(0, 300),
  };
}
