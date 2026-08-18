// v7.48 / v8.94.8-refactor: Auto-Listing Draft Creator — generira pripravljen Bolha oglas za copy-paste.
//
// Razlika od Cross-Platform Listing Generator: ta je FOKUSIRAN na Bolho,
// z vsemi obveznimi polji ki jih Bolha zahteva (kategorija, stanje, lokacija).
// Generira TEXT ki ga direkt copy-paste-aš v Bolha obrazec.
//
// Refaktoriran z withAiRoute helperjem (v8.94.8) + enforceBudget guard.
//
// POST /api/ai/auto-listing-draft
// Body: { tradeId: string, platform?: 'bolha' | 'vinted' | 'facebook' }
// Returns: { ok, draft: { title, category, condition, price, description, tags, location, shipping, payment, listingTips, expectedSellTimeDays, expectedProfitEur }, trade?: { id, title, buyPrice, estValue } }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface AutoListingDraftInput {
  tradeId: string;
  platform: string;
}

export const POST = withAiRoute<AutoListingDraftInput>({
  endpoint: '/api/ai/auto-listing-draft',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget + avtomatski recordAiCall

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : '',
      platform: body?.platform ? String(body.platform) : 'bolha',
    };
  },

  validateInput: (input) => (input.tradeId ? null : 'tradeId je obvezen'),

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    // 1. Resolve trade iz DB (throw ApiRouteError 404 ko ne obstaja)
    const trade = await resolveTrade(input.tradeId, db);

    // 2. Izračunaj izvedena polja (IDENTIČNO originalu)
    const totalCost = trade.buyPrice + (trade.buyFees ?? 0);
    const estValue = trade.listing?.aiEstimatedValue ?? Math.round(totalCost * 1.2);
    const originalDesc = trade.listing?.detailDescription || trade.listing?.description || '';
    const imageAnalysis = trade.listing?.aiImageAnalysis || '';

    // 3. Zgradi AI prompt
    const prompt = buildDraftPrompt({
      title: trade.title,
      category: trade.category,
      totalCost,
      estValue,
      originalDesc,
      imageAnalysis,
      platform: input.platform,
    });

    // 4. AI klic (ctx.callAi obravnava fallback provider + retry)
    //    Fallback na deterministic baseline draft ko AI ni na voljo (tudi ko fallback provider manjka/sfail-a).
    let raw: string;
    try {
      raw = await callAi(prompt);
    } catch {
      return apiOk(buildFallbackResponse(trade, totalCost, estValue));
    }

    // 5. Parse + transform (loose parser ne throw-a)
    const parsed: any = parseAi(raw);
    return apiOk(buildSuccessResponse(parsed, trade, totalCost, estValue));
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface TradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  notes: string | null;
  imageUrl: string | null;
  listing: {
    aiEstimatedValue: number | null;
    description: string | null;
    detailDescription: string | null;
    aiImageAnalysis: string | null;
    aiImageVerdict: string | null;
    price: number | null;
  } | null;
}

/** Pridobi trade iz DB — throw ApiRouteError 404 ko ne obstaja. */
async function resolveTrade(
  tradeId: string,
  db: AiRouteContext['db']
): Promise<TradeRow> {
  const trade = await db.trade.findUnique({
    where: { id: tradeId },
    select: {
      id: true, title: true, category: true, buyPrice: true, buyFees: true,
      notes: true, imageUrl: true,
      listing: { select: { aiEstimatedValue: true, description: true, detailDescription: true, aiImageAnalysis: true, aiImageVerdict: true, price: true } },
    },
  });
  if (!trade) {
    throw new ApiRouteError('Trade ne obstaja', 404);
  }
  return trade as TradeRow;
}

/** Pravila platform-e (bolha/vinted/facebook) — besedilo IDENTIČNO originalu. */
const PLATFORM_RULES: Record<string, string> = {
  bolha: `BOLHA.COM PRAVILA:
- Naslov: max 80 znakov, vključi brand + model + ključno specifikacijo
- Kategorija: izberi iz Bolha kategorij (npr. "Elektronika > Telefoni in pametne ure")
- Stanje: novo / rabljeno - odlično / rabljeno - dobro / rabljeno - zadovoljivo
- Opis: 200-400 besed, Markdown dovoljen
- Obvezno: stanje, starost, dodatki, garancija, prevzem/pošiljanje
- Cena: realna (ne predrago, ne pod ceno)`,
  vinted: `VINTED PRAVILA:
- Naslov: max 80 znakov, vključi brand + velikost
- Opis: 50-150 besed, emoji dovoljen
- Obvezno: stanje, brand, velikost/meritve
- Tags: #hashtag format`,
  facebook: `FACEBOOK MARKETPLACE PRAVILA:
- Naslov: max 80 znakov, direktno
- Opis: 80-150 besed, pogovorno
- Obvezno: cena, lokacija, prevzem
- Poudari: da si zasebna oseba (ne dealer)`,
};

/** Zgradi AI prompt (besedilo IDENTIČNO originalu v7.48). */
function buildDraftPrompt(params: {
  title: string;
  category: string | null;
  totalCost: number;
  estValue: number;
  originalDesc: string;
  imageAnalysis: string;
  platform: string;
}): string {
  const { title, category, totalCost, estValue, originalDesc, imageAnalysis, platform } = params;
  return `Si ekspert za pisanje prodajnih oglasov na slovenskih platformah.

Generiraj POPOLN OGLAS za ${platform.toUpperCase()} ki ga lahko direkt copy-paste.

ITEM:
- Naslov: ${title}
- Kategorija: ${category || 'splošno'}
- Nabavna cena: ${totalCost}€
- AI ocena vrednosti: ${estValue}€
- Originalni opis: ${originalDesc.slice(0, 500) || 'Ni opisa'}
${imageAnalysis ? `- AI analiza slike: ${imageAnalysis}` : ''}

${PLATFORM_RULES[platform] || PLATFORM_RULES.bolha}

CENA: Določi optimalno prodajno ceno (cilj: hitra prodaja v 14 dneh z max profitom).
- Nabava: ${totalCost}€
- Pričakovan dobiček: ${estValue - totalCost}€
- Priporočena cena: ${Math.round(estValue * 0.95)}€ (5% pod est. za hitro prodajo)

Odgovori LE z JSON:
{
  "title": "<max 80 znakov, SEO optimiziran>",
  "category": "<Bolha kategorija pot>",
  "condition": "<novo|rabajeno-odlicno|rabajeno-dobro|rabajeno-zadovoljivo>",
  "price_eur": <number>,
  "description": "<full opis, Markdown formatiran, 200-400 besed>",
  "tags": ["<tag1>", "<tag2>", "..."],
  "location": "<mesto>",
  "shipping": "<pošiljanje možnosti>",
  "payment": "<plačilo možnosti>",
  "listing_tips": ["<nasvet za Bolha objavo>", "..."],
  "expected_sell_time_days": <number>,
  "expected_profit_eur": <number>
}`;
}

/** Transformiraj AI odgovor v draft objekt (z identično logiko kot original). */
function transformDraft(
  parsed: any,
  trade: TradeRow,
  totalCost: number,
  estValue: number
): {
  title: string;
  category: string;
  condition: string;
  price: number;
  description: string;
  tags: string[];
  location: string;
  shipping: string;
  payment: string;
  listingTips: string[];
  expectedSellTimeDays: number;
  expectedProfitEur: number;
} {
  return {
    title: String(parsed?.title ?? trade.title).slice(0, 80),
    category: String(parsed?.category ?? trade.category ?? 'Splošno').slice(0, 100),
    condition: String(parsed?.condition ?? 'rabajeno-dobro').slice(0, 30),
    price: Math.round(Number(parsed?.price_eur ?? estValue * 0.95)),
    description: String(parsed?.description ?? '').slice(0, 2000),
    tags: (parsed?.tags || []).slice(0, 10).map((t: any) => String(t).slice(0, 30)),
    location: String(parsed?.location ?? 'Ljubljana').slice(0, 50),
    shipping: String(parsed?.shipping ?? 'Pošta Slovenije, osebni prevzem').slice(0, 100),
    payment: String(parsed?.payment ?? 'Gotovina, nakazilo').slice(0, 100),
    listingTips: (parsed?.listing_tips || []).slice(0, 5).map((t: any) => String(t).slice(0, 200)),
    expectedSellTimeDays: Math.max(1, Math.min(60, Number(parsed?.expected_sell_time_days ?? 14))),
    expectedProfitEur: Math.round(Number(parsed?.expected_profit_eur ?? (estValue * 0.95 - totalCost))),
  };
}

/** Zgradi success response (z identično strukturo kot original). */
function buildSuccessResponse(
  parsed: any,
  trade: TradeRow,
  totalCost: number,
  estValue: number
): {
  ok: true;
  draft: ReturnType<typeof transformDraft>;
  trade: { id: string; title: string; buyPrice: number; estValue: number };
} {
  return {
    ok: true,
    draft: transformDraft(parsed, trade, totalCost, estValue),
    trade: { id: trade.id, title: trade.title, buyPrice: totalCost, estValue },
  };
}

/** Zgradi fallback baseline draft ko AI ni na voljo (z identično strukturo kot original). */
function buildFallbackResponse(
  trade: TradeRow,
  totalCost: number,
  estValue: number
): {
  ok: true;
  draft: {
    title: string;
    category: string;
    condition: string;
    price: number;
    description: string;
    tags: string[];
    listingTips: string[];
    expectedSellTimeDays: number;
    expectedProfitEur: number;
  };
  note: string;
} {
  return {
    ok: true,
    draft: {
      title: trade.title.slice(0, 80),
      category: trade.category || 'Splošno',
      condition: 'rabajeno-dobro',
      price: Math.round(estValue * 0.95),
      description: `${trade.title}\n\nStanje: rabljeno, dobro ohranjeno.\n\nPrevzem: osebno, po dogovoru.\nPošiljanje: Pošta Slovenije.`,
      tags: [],
      listingTips: ['Dodaj 6+ fotografij', 'Odgovarjaj hitro na sporočila'],
      expectedSellTimeDays: 14,
      expectedProfitEur: Math.round(estValue * 0.95 - totalCost),
    },
    note: 'AI ni na voljo — osnovni predlog.',
  };
}
