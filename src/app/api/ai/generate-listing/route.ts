// v6.3 / v8.94-refactor: AI Auto-Listing Generator — generiraj optimized oglas za preprodajo
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/generate-listing
// Body: { tradeId: string } — generate from held trade
// Body: { title, buyPrice, category, condition?, description? } — generate from scratch
// Returns: { ok, listing: { title, description, price, tags, category, tips } }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface GenerateListingInput {
  tradeId?: string;
  title: string;
  buyPrice: number;
  category: string;
  condition: string | null;
  description: string | null;
}

export const POST = withAiRoute<GenerateListingInput>({
  endpoint: '/api/ai/generate-listing',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget + avtomatski recordAiCall

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    if (body?.tradeId) {
      // Trade-based path — field-i se resolve-a v handler-ju preko DB lookup-a.
      return {
        tradeId: String(body.tradeId),
        title: '',
        buyPrice: 0,
        category: 'drugo',
        condition: null,
        description: null,
      };
    }
    // Direct path — field-i iz body-ja.
    return {
      tradeId: undefined,
      title: body?.title ? String(body.title) : '',
      buyPrice: Number(body?.buyPrice) || 0,
      category: body?.category ? String(body.category) : 'drugo',
      condition: body?.condition ? String(body.condition) : null,
      description: body?.description ? String(body.description) : null,
    };
  },

  validateInput: (input) => {
    // Trade path ima title v DB (ne moremo preveriti tu); direct path rabi title.
    if (!input.tradeId && !input.title) {
      return 'Naslov je obvezen';
    }
    return null;
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    // 1. Resolve input field-i (trade path ali direct path)
    const resolved = await resolveListingFields(input, db);
    if (!resolved.title) {
      return apiBadRequest('Naslov je obvezen');
    }

    // 2. Get market data for pricing
    const marketAvg = await computeMarketAvg(resolved, db);

    // 3. AI klic (ctx.callAi obravnava fallback provider + retry)
    const prompt = buildListingPrompt({
      title: resolved.title,
      buyPrice: resolved.buyPrice,
      category: resolved.category,
      condition: resolved.condition,
      description: resolved.description,
      marketAvg,
    });
    const raw = await callAi(prompt);

    // 4. Parse + transform (loose parser ne throw-a)
    const parsed: any = parseAi(raw);
    const listing = transformListingResult(parsed, {
      title: resolved.title,
      category: resolved.category,
      buyPrice: resolved.buyPrice,
      marketAvg,
    });

    return apiOk({ ok: true, listing });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface ResolvedFields {
  title: string;
  buyPrice: number;
  category: string;
  condition: string | null;
  description: string | null;
}

/** Resolve input field-i — če je tradeId podan, pridobi iz DB; sicer uporabi direct field-e. */
async function resolveListingFields(
  input: GenerateListingInput,
  db: AiRouteContext['db']
): Promise<ResolvedFields> {
  if (input.tradeId) {
    const trade = await db.trade.findUnique({
      where: { id: input.tradeId },
      select: {
        id: true, title: true, buyPrice: true, category: true, notes: true,
        listing: { select: { description: true, detailDescription: true, aiEstimatedValue: true } },
      },
    });
    if (!trade) {
      throw new ApiRouteError('Trade ne obstaja', 404);
    }
    return {
      title: trade.title,
      buyPrice: trade.buyPrice,
      category: trade.category || 'drugo',
      condition: trade.notes?.includes('stanje') ? trade.notes : null,
      description: trade.listing?.detailDescription || trade.listing?.description || null,
    };
  }
  return {
    title: input.title,
    buyPrice: input.buyPrice,
    category: input.category,
    condition: input.condition,
    description: input.description,
  };
}

/** Pridobi podobne oglase znotraj ±20% cene + izračunaj tržno povprečje. */
async function computeMarketAvg(
  fields: ResolvedFields,
  db: AiRouteContext['db']
): Promise<number> {
  const minP = Math.floor(fields.buyPrice * 0.8);
  const maxP = Math.ceil(fields.buyPrice * 1.5);
  const similar = await db.listing.findMany({
    where: {
      price: { gte: minP, lte: maxP },
      isHidden: false,
      title: { contains: fields.title.split(' ')[0] },
    },
    select: { price: true, title: true },
    take: 10,
  });
  const marketPrices = similar.map(l => l.price!).filter(Boolean);
  return marketPrices.length > 0
    ? Math.round(marketPrices.reduce((a, b) => a + b, 0) / marketPrices.length)
    : Math.round(fields.buyPrice * 1.25);
}

/** Zgradi AI prompt (besedilo IDENTIČNO originalu). */
function buildListingPrompt(params: {
  title: string;
  buyPrice: number;
  category: string;
  condition: string | null;
  description: string | null;
  marketAvg: number;
}): string {
  const { title, buyPrice, category, condition, description, marketAvg } = params;
  return `Si ekspert za pisanje oglasov na slovenskih spletnih oglasih (Bolha, Vinted).
Generiraj optimiziran oglas za preprodajo naslednjega izdelka.

Izdelek: ${title}
Kupna cena: ${buyPrice}€
Kategorija: ${category}
${condition ? `Stanje: ${condition}` : ''}
${description ? `Originalni opis: ${description.slice(0, 500)}` : ''}
Tržno povprečje: ${marketAvg}€

Pravila za optimalen oglas:
1. Naslov naj vključuje ključne besede za iskanje (SEO za Bolha)
2. Opis naj bo podroben, profesionalen in privlačen
3. Omeni stanje, dodatke, garancijo če velja
4. Cena naj bo konkurenčna (tržno povprečje - 5% za hitro prodajo)
5. Dodaj 5-10 ključnih besed/tagov za iskanje
6. Vključi nasvete za hitro prodajo

Odgovori LE z JSON:
{
  "title": "<optimiziran naslov, max 80 znakov>",
  "description": "<poln opis, max 1000 znakov, markdown format>",
  "price": <number EUR>,
  "tags": ["<tag1>", "<tag2>", ...],
  "category": "<kategorija>",
  "tips": ["<nasvet1>", "<nasvet2>", "<nasvet3>"],
  "expected_sell_time_days": <number>,
  "profit_estimate": <number EUR>
}`;
}

/** Transformiraj AI odgovor v listing objekt (z identično logiko kot original). */
function transformListingResult(
  parsed: any,
  ctx: { title: string; category: string; buyPrice: number; marketAvg: number }
): {
  title: string;
  description: string;
  price: number;
  tags: string[];
  category: string;
  tips: string[];
  expectedSellTimeDays: number;
  profitEstimate: number;
  marketAvg: number;
  buyPrice: number;
  marginPct: number;
} {
  const { title, category, buyPrice, marketAvg } = ctx;
  const aiPrice = clampInt(parsed?.price, 0, 1_000_000);
  return {
    title: String(parsed?.title ?? title).slice(0, 200),
    description: String(parsed?.description ?? '').slice(0, 2000),
    price: aiPrice ?? Math.round(marketAvg * 0.95),
    tags: Array.isArray(parsed?.tags) ? parsed.tags.slice(0, 10).map((t: any) => String(t).slice(0, 50)) : [],
    category: String(parsed?.category ?? category).slice(0, 50),
    tips: Array.isArray(parsed?.tips) ? parsed.tips.slice(0, 5).map((t: any) => String(t).slice(0, 200)) : [],
    expectedSellTimeDays: clampInt(parsed?.expected_sell_time_days, 1, 365) ?? 7,
    profitEstimate: clampInt(parsed?.profit_estimate, -10000, 100000) ?? Math.round((marketAvg * 0.95) - buyPrice),
    marketAvg,
    buyPrice,
    marginPct: buyPrice > 0 ? Math.round(((aiPrice ?? marketAvg) - buyPrice) / buyPrice * 100) : 0,
  };
}

function clampInt(v: any, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
}
