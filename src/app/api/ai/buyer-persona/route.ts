// v6.22 / v8.94-refactor: AI Buyer Persona Generator — ustvari profile kupcev za ciljano trženje
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-persona
// Body: { tradeId?: string, customerName?: string, category?: string, priceRange?: { min, max } }
// Returns: { ok, personas: [{ name, ageRange, location, occupation, income, motivations, painPoints, channels, messaging, willingnessToPay }], marketingStrategy }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface BuyerPersonaInput {
  tradeId?: string;
  customerName?: string;
  category?: string;
  priceRange: { min: number; max: number };
}

export const POST = withAiRoute<BuyerPersonaInput>({
  endpoint: '/api/ai/buyer-persona',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : undefined,
      customerName: body?.customerName ? String(body.customerName) : undefined,
      category: body?.category ? String(body.category) : '',
      priceRange: {
        min: Number(body?.priceRange?.min ?? 0) || 0,
        max: Number(body?.priceRange?.max ?? 0) || 0,
      },
    };
  },

  validateInput: (input) => {
    if (!input.category && !input.tradeId && !input.customerName) {
      return 'category, tradeId ali customerName je obvezen';
    }
    return null;
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    // 1. Razreši kontekst (customerName / tradeId / direktna kategorija)
    const { category, priceMin, priceMax, title, description } = await resolveBuyerContext(input, db);

    // 2. Pridobi sold trades za kontekst kupcev
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, category: category || undefined },
      select: { title: true, category: true, sellPrice: true, sellLocation: true, sellDate: true },
      take: 30,
    });

    const soldStr = soldTrades.slice(0, 10).map(t =>
      `- ${t.title} | ${(t.sellLocation || 'neznan')} | ${t.sellPrice}€`
    ).join('\n');

    // 3. AI generiranje person
    const prompt = buildBuyerPersonaPrompt({ category, title, priceMin, priceMax, description, soldStr });
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    // 4. Transformacija + validacija
    const personas = transformPersonas(parsed);
    const marketingStrategy = transformMarketingStrategy(parsed);

    return apiOk({
      ok: true,
      personas,
      marketingStrategy,
      insights: String(parsed?.insights ?? '').slice(0, 500),
      category,
      priceRange: { min: priceMin, max: priceMax },
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

/**
 * Razreši kontekst person-e glede na vhod:
 * - customerName: pridobi zadnje prodaje kupca, izračunaj najpogostejšo kategorijo
 *   in dejanski cenovni razpon. Throw ApiRouteError 404 če ni prodaj.
 * - tradeId: pridobi trade + listing, izračunaj cenovni razpon iz buyPrice/aiEstimatedValue.
 *   Throw ApiRouteError 404 če trade ne obstaja.
 * - category (direktno): uporabi kot je.
 *
 * Če so podani tako customerName kot tradeId, ima tradeId prednost (originalno vedenje).
 */
async function resolveBuyerContext(
  input: BuyerPersonaInput,
  db: AiRouteContext['db']
): Promise<{ category: string; priceMin: number; priceMax: number; title: string; description: string }> {
  const { tradeId, customerName } = input;
  let category = input.category ?? '';
  let priceMin = input.priceRange.min;
  let priceMax = input.priceRange.max;
  let title = '';
  let description = '';

  // v7.32: Frontend BuyersView sends { customerName } (derived from sellLocation).
  // Resolve it to the buyer's most common category + actual spend range.
  if (!tradeId && !category && customerName) {
    const buyerTrades = await db.trade.findMany({
      where: { sellLocation: String(customerName), status: 'sold', sellPrice: { not: null } },
      select: { title: true, category: true, sellPrice: true, sellDate: true },
      take: 30,
      orderBy: { sellDate: 'desc' },
    });
    if (buyerTrades.length === 0) {
      throw new ApiRouteError(`Za kupca "${customerName}" ni prodaj v zgodovini.`, 404);
    }
    const catCounts: Record<string, number> = {};
    for (const t of buyerTrades) {
      const c = (t.category || 'drugo').trim();
      catCounts[c] = (catCounts[c] || 0) + 1;
    }
    category = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0][0];
    const prices = buyerTrades.map(t => t.sellPrice ?? 0).filter(p => p > 0).sort((a, b) => a - b);
    if (prices.length) {
      priceMin = Math.min(priceMin || prices[0], prices[0]);
      priceMax = Math.max(priceMax || prices[prices.length - 1], prices[prices.length - 1]);
    }
    title = `${customerName} — ${buyerTrades.length} nakupov`;
    description = `Zadnji nakupi: ` + buyerTrades.slice(0, 5).map(t => `${t.title} (${t.sellPrice}€)`).join(', ');
  }

  if (tradeId) {
    const trade = await db.trade.findUnique({
      where: { id: String(tradeId) },
      select: {
        title: true, category: true, buyPrice: true,
        listing: { select: { description: true, detailDescription: true, aiEstimatedValue: true } },
      },
    });
    if (!trade) throw new ApiRouteError('Trade ne obstaja', 404);
    title = trade.title;
    category = category || trade.category || '';
    priceMin = priceMin || Math.round(trade.buyPrice * 0.9);
    priceMax = priceMax || Math.round((trade.listing?.aiEstimatedValue ?? trade.buyPrice * 1.25) * 1.1);
    description = trade.listing?.detailDescription || trade.listing?.description || '';
  }

  return { category, priceMin, priceMax, title, description };
}

/**
 * Zgradi AI prompt za buyer persona generation. Besedilo IDENTIČNO originalu (v6.22).
 */
function buildBuyerPersonaPrompt(params: {
  category: string;
  title: string;
  priceMin: number;
  priceMax: number;
  description: string;
  soldStr: string;
}): string {
  const { category, title, priceMin, priceMax, description, soldStr } = params;
  return `Si ekspert za buyer persona development in ciljano trženje.
Za kategorijo "${category}" ustvari 3 različne buyer persone za optimalno trženje.

${title ? `NASLOV ITEM-A: ${title}` : ''}
CENOVNI RAZPON: ${priceMin}€ - ${priceMax}€
${description ? `OPIS: ${description.slice(0, 300)}` : ''}

ZGODOVINSKE PRODAJE V KATEGORIJI:
${soldStr || '- Ni podatkov'}

Slovenski kontekst:
- Prebivalstvo: 2.1M, povprečna plača ~1300€ neto
- Regije: Ljubljana (bogatejši), Maribor (cenejši), Primorska (premium)
- Starostne skupine: 18-25 (študenti, nizek budget), 25-40 (družine, srednji budget), 40-60 (ugr. kariere, visok budget)
- Slovenski kupci: previdni, raziščejo pred nakupom, radi vidijo/pregledajo

Strategije person:
1. BUDGET_CONSCIOUS: študenti/začetniki, nizka cena primarna
2. QUALITY_SEEKER: družine, kakovost primarna
3. PREMIUM Buyer: visok dohodek, redkost/znamka primarna
4. COLLECTOR: zbiratelji, redkost primarna
5. FLIPPER: preprodajalci, marža primarna

Odgovori LE z JSON:
{
  "personas": [
    {
      "name": "<ime persone, npr. 'Študent Tomaž'>",
      "type": "<BUDGET_CONSCIOUS|QUALITY_SEEKER|PREMIUM|COLLECTOR|FLIPPER>",
      "age_range": "<18-25|25-40|40-60|60+>",
      "location": "<Ljubljana|Maribor|Primorska|Štajerska|Gorenjska|Dolenjska|vsi>",
      "occupation": "<opis, max 50 znakov>",
      "income_range_eur": "<npr. '800-1200'>",
      "motivations": ["<zakaj bi kupil, max 80 znakov>", "..."],
      "pain_points": ["<skrbi, max 80 znakov>", "..."],
      "preferred_channels": ["<Bolha|Facebook|Vinted|prijatelji|...>", "..."],
      "willingness_to_pay_eur": <number>,
      "decision_time_days": <number>,
      "messaging": {
        "hook": "<kaj pritegne, max 100 znakov>",
        "tone": "<prijateljski|poslovni|emergentni|...>",
        "key_arguments": ["<argument, max 80 znakov>", "..."],
        "call_to_action": "<CTA, max 80 znakov>"
      },
      "price_sensitivity": "<high|medium|low>",
      "trust_factors": ["<kaj prepriča, max 80 znakov>", "..."],
      "objection_handling": [
        {
          "objection": "<pritožba, max 80 znakov>",
          "response": "<odgovor, max 100 znakov>"
        }
      ]
    }
  ],
  "marketing_strategy": {
    "primary_persona": "<ime glavne persone>",
    "secondary_persona": "<ime sekundarne persone>",
    "recommended_platform": "<bolha|vinted|facebook|avtonet>",
    "optimal_timing": "<kdaj objaviti, max 80 znakov>",
    "listing_tone": "<kakšen ton opisa, max 80 znakov>",
    "must_include_in_listing": ["<kaj mora biti v opisu, max 80 znakov>", "..."],
    "avoid_in_listing": ["<čemu se izogibati, max 80 znakov>", "..."]
  },
  "insights": "<splošne ugotovitve o trgu, max 200 znakov>"
}`;
}

/**
 * Validiraj in transformiraj AI-jeve persone v konzisten format.
 * - omeji na 4 persone (slice 0-4)
 * - vsa polja stringificiraj in omeji dolžino
 * - validiraj type in priceSensitivity (default če neveljaven)
 * - številski polji willingnessToPayEur/decisionTimeDays max(0, ...)
 */
function transformPersonas(parsed: any): any[] {
  return (parsed?.personas || []).slice(0, 4).map((p: any) => ({
    name: String(p?.name ?? '').slice(0, 80),
    type: ['BUDGET_CONSCIOUS', 'QUALITY_SEEKER', 'PREMIUM', 'COLLECTOR', 'FLIPPER'].includes(String(p?.type))
      ? String(p.type) : 'BUDGET_CONSCIOUS',
    ageRange: String(p?.age_range ?? '').slice(0, 30),
    location: String(p?.location ?? '').slice(0, 50),
    occupation: String(p?.occupation ?? '').slice(0, 100),
    incomeRangeEur: String(p?.income_range_eur ?? '').slice(0, 30),
    motivations: (p?.motivations || []).slice(0, 5).map((m: any) => String(m).slice(0, 150)),
    painPoints: (p?.pain_points || []).slice(0, 5).map((pp: any) => String(pp).slice(0, 150)),
    preferredChannels: (p?.preferred_channels || []).slice(0, 5).map((c: any) => String(c).slice(0, 50)),
    willingnessToPayEur: Math.max(0, Number(p?.willingness_to_pay_eur ?? 0)),
    decisionTimeDays: Math.max(0, Number(p?.decision_time_days ?? 7)),
    messaging: {
      hook: String(p?.messaging?.hook ?? '').slice(0, 200),
      tone: String(p?.messaging?.tone ?? '').slice(0, 50),
      keyArguments: (p?.messaging?.key_arguments || []).slice(0, 5).map((a: any) => String(a).slice(0, 150)),
      callToAction: String(p?.messaging?.call_to_action ?? '').slice(0, 150),
    },
    priceSensitivity: ['high', 'medium', 'low'].includes(String(p?.price_sensitivity)) ? String(p.price_sensitivity) : 'medium',
    trustFactors: (p?.trust_factors || []).slice(0, 5).map((t: any) => String(t).slice(0, 150)),
    objectionHandling: (p?.objection_handling || []).slice(0, 4).map((o: any) => ({
      objection: String(o?.objection ?? '').slice(0, 150),
      response: String(o?.response ?? '').slice(0, 200),
    })),
  }));
}

/**
 * Validiraj in transformiraj AI-jevo marketing_strategy.
 * - priporočeni platformi validiraj proti dovoljenemu seznamu (default 'bolha')
 * - vsa polja stringificiraj in omeji dolžino
 */
function transformMarketingStrategy(parsed: any) {
  return {
    primaryPersona: String(parsed?.marketing_strategy?.primary_persona ?? '').slice(0, 80),
    secondaryPersona: String(parsed?.marketing_strategy?.secondary_persona ?? '').slice(0, 80),
    recommendedPlatform: ['bolha', 'vinted', 'facebook', 'avtonet'].includes(String(parsed?.marketing_strategy?.recommended_platform))
      ? String(parsed.marketing_strategy.recommended_platform) : 'bolha',
    optimalTiming: String(parsed?.marketing_strategy?.optimal_timing ?? '').slice(0, 200),
    listingTone: String(parsed?.marketing_strategy?.listing_tone ?? '').slice(0, 200),
    mustIncludeInListing: (parsed?.marketing_strategy?.must_include_in_listing || []).slice(0, 6).map((m: any) => String(m).slice(0, 150)),
    avoidInListing: (parsed?.marketing_strategy?.avoid_in_listing || []).slice(0, 4).map((a: any) => String(a).slice(0, 150)),
  };
}
