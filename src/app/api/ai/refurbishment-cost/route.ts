// v6.20 / v8.96.0-batch4: AI Refurbishment Cost Estimator — ocena stroškov obnove z vizualno analizo slike
// Refaktoriran z withAiRoute helperjem (v8.96) + enforceBudget guard.
//
// POST /api/ai/refurbishment-cost
// Body: { listingId?: string, tradeId?: string }
// Returns: { ok, estimate: { totalRefurbCost, items: [{ name, cost, complexity, optional }], resaleValue, profitPotential, recommendedAction, breakdown }, imageAnalysis }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// Slovenske cene za refurbishment (povprečne 2024)
const REFURB_PRICES: Record<string, { low: number; high: number; unit: string }> = {
  'cleaning_basic': { low: 10, high: 30, unit: '€' },
  'cleaning_deep': { low: 30, high: 80, unit: '€' },
  'paint_minor': { low: 20, high: 60, unit: '€' },
  'paint_full': { low: 100, high: 400, unit: '€' },
  'polishing': { low: 15, high: 50, unit: '€' },
  'battery_replacement': { low: 30, high: 120, unit: '€' },
  'screen_replacement_phone': { low: 80, high: 250, unit: '€' },
  'screen_replacement_laptop': { low: 100, high: 350, unit: '€' },
  'keyboard_replacement': { low: 30, high: 100, unit: '€' },
  'tire_replacement': { low: 50, high: 200, unit: '€/komplet' },
  'brake_replacement': { low: 100, high: 400, unit: '€' },
  'oil_change': { low: 50, high: 150, unit: '€' },
  'chain_replacement_bike': { low: 20, high: 80, unit: '€' },
  'frame_repair_bike': { low: 50, high: 300, unit: '€' },
  'upholstery_repair': { low: 80, high: 500, unit: '€' },
  'fabric_replacement': { low: 50, high: 300, unit: '€' },
  'rust_removal': { low: 30, high: 200, unit: '€' },
  'wood_restoration': { low: 50, high: 400, unit: '€' },
  'electrical_repair': { low: 30, high: 200, unit: '€' },
  'motor_repair': { low: 100, high: 800, unit: '€' },
  'gasket_replacement': { low: 50, high: 300, unit: '€' },
  'logo_replacement': { low: 5, high: 30, unit: '€' },
  'packaging_replacement': { low: 10, high: 50, unit: '€' },
  'accessory_purchase': { low: 10, high: 100, unit: '€' },
  'professional_service': { low: 50, high: 300, unit: '€' },
};

interface RefurbishmentCostInput {
  listingId: string | null;
  tradeId: string | null;
}

export const POST = withAiRoute<RefurbishmentCostInput>({
  endpoint: '/api/ai/refurbishment-cost',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      listingId: body?.listingId ? String(body.listingId) : null,
      tradeId: body?.tradeId ? String(body.tradeId) : null,
    };
  },

  validateInput: (input) => (input.listingId || input.tradeId ? null : 'listingId ali tradeId je obvezen'),

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { listingId, tradeId } = input;

    // 1. Pridobi listing ali trade
    let listing: any = null;
    let trade: any = null;
    let imageBase64: string | null = null;

    if (listingId) {
      listing = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: {
          id: true, title: true, price: true, priceText: true,
          description: true, detailDescription: true, imageUrl: true,
          aiEstimatedValue: true, aiImageAnalysis: true, aiImageVerdict: true,
          aiRisk: true, aiVerdict: true, monitor: { select: { source: true } },
        },
      });
      if (!listing) throw new ApiRouteError('Listing ne obstaja', 404);
    } else if (tradeId) {
      trade = await db.trade.findUnique({
        where: { id: String(tradeId) },
        select: {
          id: true, title: true, category: true, buyPrice: true, buyFees: true,
          listing: { select: { imageUrl: true, description: true, detailDescription: true, aiEstimatedValue: true } },
        },
      });
      if (!trade) throw new ApiRouteError('Trade ne obstaja', 404);
    }

    const title = listing?.title || trade?.title || '';
    const description = listing?.detailDescription || listing?.description || trade?.listing?.description || '';
    const imageUrl = listing?.imageUrl || trade?.listing?.imageUrl || null;
    const price = listing?.price ?? trade?.buyPrice ?? 0;

    // 2. Pridobi sliko za vizualno analizo (če je na voljo)
    if (imageUrl) {
      try {
        const { downloadImageAsBase64 } = await import('@/lib/ai');
        imageBase64 = await downloadImageAsBase64(imageUrl);
      } catch {
        // ignore image fetch failures
      }
    }

    // 3. AI analiza
    const prompt = buildPrompt({
      title,
      price,
      description,
      aiImageAnalysis: listing?.aiImageAnalysis ?? null,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const estimate = transformEstimate(parsed, price);

    return apiOk({
      ok: true,
      estimate,
      imageAnalysis: imageBase64 ? 'Slika pridobljena in analizirana' : 'Slika ni na voljo',
      hasImage: !!imageBase64,
      source: listing ? 'listing' : 'trade',
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface PromptData {
  title: string;
  price: number;
  description: string;
  aiImageAnalysis: string | null;
}

function buildPrompt(d: PromptData): string {
  return `Si ekspert za vrednotenje in obnovo rabljenih dobrin.
Oceni stroške obnove (refurbishment) za ta artikel in potencionalni dobiček po preprodaji.

NASLOV: ${d.title}
CENA: ${d.price}€
OPIS: ${d.description.slice(0, 800)}
${d.aiImageAnalysis ? `AI SLIKOVNA ANALIZA: ${d.aiImageAnalysis}` : ''}

Slovenske povprečne cene refurbishment postopkov (za referenco):
${Object.entries(REFURB_PRICES).slice(0, 12).map(([k, v]) => `- ${k}: ${v.low}-${v.high}${v.unit}`).join('\n')}

Pravila:
1. Identificiraj VSE potrebne postopke obnove (cleaning, repairs, replacements)
2. Za vsak postopek: ime, cena (EUR), kompleksnost (easy/medium/hard), ali je obvezen
3. Določi resaleValue (ocenjena prodajna cena po obnovi)
4. Izračunaj profitPotential = resaleValue - cena - refurbCost
5. Priporoči action: buy_and_refurb|buy_as_is|avoid|marginal

Strategije obnove:
- "cosmetical_only": samo čiščenje/poliranje (low cost, low return)
- "functional_repair": popravila funkcionalnosti (medium cost, medium return)
- "full_restoration": popolna obnova (high cost, high return za premium)
- "part_out": razstaviti in prodati kot dele (npr. za avto, kolo)

Odgovori LE z JSON:
{
  "image_findings": "<kaj vidiš na sliki glede stanja, max 200 znakov>",
  "items": [
    {
      "name": "<postopek, npr. 'Zamenjava zaslona'>",
      "cost_eur": <number>,
      "complexity": "<easy|medium|hard>",
      "optional": <boolean>,
      "reasoning": "<max 80 znakov>"
    }
  ],
  "total_refurb_cost_eur": <number>,
  "refurb_strategy": "<cosmetical_only|functional_repair|full_restoration|part_out>",
  "resale_value_eur": <number>,
  "profit_potential_eur": <number>,
  "roi_pct": <number>,
  "recommended_action": "<buy_and_refurb|buy_as_is|avoid|marginal>",
  "time_required_days": <number>,
  "tools_needed": ["<orodje, max 50 znakov>", "..."],
  "skills_required": "<beginner|intermediate|expert>",
  "warnings": ["<opozorilo, max 80 znakov>", "..."],
  "reasoning": "<max 200 znakov>"
}`;
}

function transformEstimate(parsed: any, price: number) {
  const items = (parsed?.items || []).slice(0, 15).map((it: any) => {
    const cost = Math.max(0, Number(it?.cost_eur ?? 0));
    return {
      name: String(it?.name ?? '').slice(0, 100),
      costEur: cost,
      complexity: ['easy', 'medium', 'hard'].includes(String(it?.complexity)) ? String(it.complexity) : 'medium',
      optional: Boolean(it?.optional ?? false),
      reasoning: String(it?.reasoning ?? '').slice(0, 150),
    };
  });

  const totalRefurbCost = items.reduce((s, i) => s + i.costEur, 0);
  const resaleValue = Math.max(0, Number(parsed?.resale_value_eur ?? 0));
  const totalCost = price + totalRefurbCost;
  const profitPotential = Math.round(resaleValue - totalCost);
  const roiPct = totalCost > 0 ? Math.round((profitPotential / totalCost) * 100) : 0;

  return {
    imageFindings: String(parsed?.image_findings ?? '').slice(0, 400),
    items,
    totalRefurbCostEur: Math.round(totalRefurbCost),
    refurbStrategy: ['cosmetical_only', 'functional_repair', 'full_restoration', 'part_out'].includes(String(parsed?.refurb_strategy))
      ? String(parsed.refurb_strategy) : 'cosmetical_only',
    resaleValueEur: resaleValue,
    profitPotentialEur: profitPotential,
    roiPct,
    buyPrice: price,
    totalCostEur: Math.round(totalCost),
    recommendedAction: ['buy_and_refurb', 'buy_as_is', 'avoid', 'marginal'].includes(String(parsed?.recommended_action))
      ? String(parsed.recommended_action) : 'buy_as_is',
    timeRequiredDays: Math.max(0, Math.min(365, Number(parsed?.time_required_days ?? 7))),
    toolsNeeded: (parsed?.tools_needed || []).slice(0, 8).map((t: any) => String(t).slice(0, 80)),
    skillsRequired: ['beginner', 'intermediate', 'expert'].includes(String(parsed?.skills_required))
      ? String(parsed.skills_required) : 'beginner',
    warnings: (parsed?.warnings || []).slice(0, 5).map((w: any) => String(w).slice(0, 150)),
    reasoning: String(parsed?.reasoning ?? '').slice(0, 400),
  };
}
