// v7.49 / v8.95.6-profit: Profit Margin Guardian — preveri pred nakupom ali je margin dovolj.
// Refaktoriran z withAiRoute helperjem (v8.95.6-profit) + enforceBudget guard.
//
// Preprečuje slabe nakupe: "margin samo 8% — ne kupi! Išči vsaj 20%."
// Preverja: estValue vs askingPrice, fees, shipping, tax, depreciation risk.
//
// POST /api/ai/margin-guardian
// Body: { listingId: string, offerPrice?: number }
// Returns: { ok, verdict: 'BUY' | 'CAUTION' | 'AVOID', margin, analysis }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 30;

interface MarginGuardianInput {
  listingId: string;
  offerPrice: number | null;
}

const MIN_MARGIN_PCT = 20; // minimum acceptable margin
const GOOD_MARGIN_PCT = 35; // good margin
const PLATFORM_FEES: Record<string, { buyFeePct: number; sellFeePct: number }> = {
  bolha: { buyFeePct: 0, sellFeePct: 2 },
  vinted: { buyFeePct: 0, sellFeePct: 5 },
  'mobile-de': { buyFeePct: 0, sellFeePct: 3 },
  kleinanzeigen: { buyFeePct: 0, sellFeePct: 0 },
  avtonet: { buyFeePct: 0, sellFeePct: 0 },
};
const SHIPPING_ESTIMATE = 10; // avg shipping EUR
const DEPRECIATION_RISK_MONTHLY = 3; // 3%/month default

export const POST = withAiRoute<MarginGuardianInput>({
  endpoint: '/api/ai/margin-guardian',
  maxDuration: 30,
  enforceBudget: true, // AI-branded endpoint — preveri budget (konzistentno z vsemi 6 v tej migraciji)

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      listingId: String(body?.listingId ?? ''),
      offerPrice: body?.offerPrice ? Number(body.offerPrice) : null,
    };
  },

  validateInput: (input) => input.listingId ? null : 'listingId je obvezen',

  handler: async (input, ctx: AiRouteContext) => {
    const { db } = ctx;
    const { listingId, offerPrice } = input;

    const listing = await db.listing.findUnique({
      where: { id: String(listingId) },
      select: {
        id: true, title: true, price: true, priceText: true,
        aiEstimatedValue: true, aiVerdict: true, aiRisk: true, aiScore: true,
        dealScore: true, sellerName: true, location: true,
        monitor: { select: { source: true } },
      },
    });
    if (!listing) throw new ApiRouteError('Listing ne obstaja', 404);

    const computation = computeMargin(listing, offerPrice);
    if (computation.buyPrice <= 0) throw new ApiRouteError('Cena mora biti > 0', 400);

    const aiRisk = listing.aiRisk ?? 5;
    const { verdict, reason } = computeVerdict(computation.adjustedMarginPct, aiRisk);
    const warnings = computeWarnings(listing, computation.marginPct, computation.adjustedMarginPct, computation.estValue, computation.buyPrice);

    return apiOk({
      ok: true,
      verdict,
      margin: {
        gross: { profitEur: computation.grossProfit, marginPct: computation.marginPct },
        adjusted: { profitEur: computation.adjustedProfit, marginPct: computation.adjustedMarginPct },
        breakdown: {
          buyPrice: computation.buyPrice, buyFees: computation.buyFees, shipping: computation.shipping, totalCost: computation.totalCost,
          sellPrice: computation.sellPrice, sellFees: computation.sellFees, totalRevenue: computation.totalRevenue,
          estValue: computation.estValue, askingPrice: computation.askingPrice,
        },
      },
      risk: { aiRisk, aiVerdict: listing.aiVerdict, riskDiscount: computation.riskDiscount, dealScore: listing.dealScore },
      warnings,
      reason,
      minMarginPct: MIN_MARGIN_PCT,
      goodMarginPct: GOOD_MARGIN_PCT,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface ListingRow {
  id: string;
  title: string;
  price: number | null;
  priceText: string;
  aiEstimatedValue: number | null;
  aiVerdict: string | null;
  aiRisk: number | null;
  aiScore: number | null;
  dealScore: number | null;
  sellerName: string | null;
  location: string | null;
  monitor: { source: string | null } | null;
}

interface MarginComputation {
  askingPrice: number;
  buyPrice: number;
  estValue: number;
  source: string;
  buyFees: number;
  sellPrice: number;
  sellFees: number;
  shipping: number;
  totalCost: number;
  totalRevenue: number;
  grossProfit: number;
  marginPct: number;
  riskDiscount: number;
  adjustedProfit: number;
  adjustedMarginPct: number;
}

/**
 * Compute margin breakdown (costs, fees, profit, risk adjustment).
 * Logika IDENTIČNA originalu v7.49.
 */
function computeMargin(listing: ListingRow, offerPrice: number | null): MarginComputation {
  const askingPrice = listing.price ?? 0;
  const buyPrice = offerPrice ?? askingPrice;
  const estValue = listing.aiEstimatedValue ?? Math.round(buyPrice * 1.2);
  const source = listing.monitor?.source || 'bolha';
  const fees = PLATFORM_FEES[source] ?? { buyFeePct: 0, sellFeePct: 2 };

  // Compute costs
  const buyFees = Math.round(buyPrice * (fees.buyFeePct / 100));
  const sellPrice = Math.round(estValue * 0.95); // 5% under est for fast sale
  const sellFees = Math.round(sellPrice * (fees.sellFeePct / 100));
  const shipping = SHIPPING_ESTIMATE;
  const totalCost = buyPrice + buyFees + shipping;
  const totalRevenue = sellPrice - sellFees;
  const grossProfit = totalRevenue - totalCost;
  const marginPct = totalCost > 0 ? Math.round((grossProfit / totalCost) * 100) : 0;

  // Risk adjustments
  const aiRisk = listing.aiRisk ?? 5;
  const riskDiscount = aiRisk >= 7 ? 0.85 : aiRisk >= 5 ? 0.92 : 1.0;
  const adjustedProfit = Math.round(grossProfit * riskDiscount);
  const adjustedMarginPct = totalCost > 0 ? Math.round((adjustedProfit / totalCost) * 100) : 0;

  return {
    askingPrice, buyPrice, estValue, source,
    buyFees, sellPrice, sellFees, shipping,
    totalCost, totalRevenue, grossProfit, marginPct,
    riskDiscount, adjustedProfit, adjustedMarginPct,
  };
}

/**
 * Compute verdict (BUY/CAUTION/AVOID) based on adjusted margin + risk.
 * Logika IDENTIČNA originalu v7.49.
 */
function computeVerdict(
  adjustedMarginPct: number,
  aiRisk: number,
): { verdict: 'BUY' | 'CAUTION' | 'AVOID'; reason: string } {
  if (adjustedMarginPct >= GOOD_MARGIN_PCT && aiRisk <= 4) {
    return {
      verdict: 'BUY',
      reason: `✅ Odlična marge ${adjustedMarginPct}% (nizko tveganje ${aiRisk}/10). Kupi!`,
    };
  }
  if (adjustedMarginPct >= MIN_MARGIN_PCT) {
    return {
      verdict: 'CAUTION',
      reason: `⚠️ Marge ${adjustedMarginPct}% je nad minimum (${MIN_MARGIN_PCT}%), a tveganje ${aiRisk}/10. Preveri ročno.`,
    };
  }
  if (adjustedMarginPct > 0) {
    return {
      verdict: 'AVOID',
      reason: `❌ Marge samo ${adjustedMarginPct}% — pod minimum ${MIN_MARGIN_PCT}%. Ne kupi, išči boljše.`,
    };
  }
  return {
    verdict: 'AVOID',
    reason: `🔴 NEGATIVNA marge (${adjustedMarginPct}%) — izguba! Definitivno ne kupi.`,
  };
}

/**
 * Compute warnings array (IDENTIČNO originalu v7.49).
 */
function computeWarnings(
  listing: ListingRow,
  marginPct: number,
  adjustedMarginPct: number,
  estValue: number,
  buyPrice: number,
): string[] {
  const warnings: string[] = [];
  const aiRisk = listing.aiRisk ?? 5;
  if (aiRisk >= 6) warnings.push(`Visoko tveganje (${aiRisk}/10) — morda prevara`);
  if (!listing.aiEstimatedValue) warnings.push('AI ni ocenil vrednosti — marge je groba');
  if (listing.aiVerdict === 'SUMNJIVO') warnings.push('AI je oglas označil kot SUMNJIVO');
  if (marginPct < MIN_MARGIN_PCT && adjustedMarginPct >= MIN_MARGIN_PCT) {
    warnings.push(`Bruto marge ${marginPct}% je pod minimum, a tveganje je nizko`);
  }
  if (estValue < buyPrice) {
    warnings.push(`AI vrednost (${estValue}€) je NIŽJA od cene (${buyPrice}€) — preplačilo!`);
  }
  return warnings;
}

// Note: DEPRECIATION_RISK_MONTHLY je referenca za prihodnjo implementacacijo (trenutno unused, IDENTIČNO originalu v7.49 — dead code preserved za "same input → same output").
