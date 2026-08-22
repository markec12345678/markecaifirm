// v6.81 / v8.95.5-listing: AI Listing Cross-Sell Optimizer — ML optimizacija cross-sell priložnosti za oglase
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/listing-cross-sell-optimizer
// Body: { tradeId?: string }
// Returns: { ok, optimizer: { listing, crossSellOpportunities, bundleSuggestions, mlModels, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const CROSS_SELL_TYPES = ['complementary', 'accessory', 'upgrade', 'replacement', 'bundled', 'warranty', 'service', 'subscription'] as const;
const BUNDLE_STRATEGIES = ['fixed_bundle', 'dynamic_bundle', 'tiered_bundle', 'optional_addon', 'loyalty_bundle', 'seasonal_bundle'] as const;

interface ListingCrossSellOptimizerInput {
  tradeId: string | null;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyDate: Date;
  buyLocation: string;
  notes: string | null;
  listingId: string | null;
}

interface TargetListingRow {
  aiEstimatedValue: number | null;
  aiRisk: number | null;
  url: string | null;
}

interface OtherItem {
  title: string;
  category: string;
  buyPrice: number;
  buyLocation: string;
}

interface TargetContext {
  title: string;
  category: string;
  buyPrice: number;
  buyLocation: string;
  suggestedPrice: number;
  otherItems: string;
}

export const POST = withAiRoute<ListingCrossSellOptimizerInput>({
  endpoint: '/api/ai/listing-cross-sell-optimizer',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId).trim() : null,
    };
  },

  // No validateInput — tradeId je opcijski (null = prvi held trade)

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId } = input;

    const heldTrades: HeldTradeRow[] = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true, buyLocation: true, notes: true, listingId: true },
      take: 200,
      orderBy: { buyDate: 'desc' },
    });
    if (heldTrades.length === 0) {
      return apiOk({ ok: true, optimizer: null, message: 'Ni aktivnih oglasov za cross-sell analizo.' });
    }

    const target = heldTrades.find(t => t.id === tradeId) ?? heldTrades[0];
    const targetListing: TargetListingRow | null = target.listingId
      ? await db.listing.findUnique({ where: { id: target.listingId }, select: { aiEstimatedValue: true, aiRisk: true, url: true } })
      : null;
    const suggestedPrice = targetListing?.aiEstimatedValue ?? Math.round(target.buyPrice * 1.25);

    const otherItems = buildOtherItems(heldTrades);

    const prompt = buildPrompt({
      title: target.title,
      category: target.category,
      buyPrice: target.buyPrice,
      buyLocation: target.buyLocation,
      suggestedPrice,
      otherItems,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const optimizer = transformOptimizer(parsed, { title: target.title, category: target.category, buyPrice: target.buyPrice });

    return apiOk({ ok: true, optimizer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function buildOtherItems(heldTrades: HeldTradeRow[]): string {
  return heldTrades
    .slice(0, 8)
    .map(t => `- ${t.title} | ${t.category} | ${t.buyPrice}€ | ${t.buyLocation}`)
    .join('\n');
}

function buildPrompt(ctx: TargetContext): string {
  return `Si AI listing cross-sell optimizer z ML in market basket analysis.
Analizira cross-sell priložnosti za oglase z 8 tipi in 6 strategijami bundlov.

CILJNI OGLAS:
- Naslov: ${ctx.title}
- Kategorija: ${ctx.category}
- Nabavna cena: ${ctx.buyPrice}€
- Predlagana cena: ${ctx.suggestedPrice}€
- Kupljeno pri: ${ctx.buyLocation}

DRUGI AKTIVNI OGLASI (za cross-sell):
${ctx.otherItems}

8 tipov cross-sell:
1. COMPLEMENTARY: dopolnilni izdelki
2. ACCESSORY: dodatki in pribor
3. UPGRADE: nadgradnja
4. REPLACEMENT: zamenjava
5. BUNDLED: skupaj v paketu
6. WARRANTY: garancija
7. SERVICE: storitev
8. SUBSCRIPTION: naročnina

6 bundle strategij: fixed_bundle, dynamic_bundle, tiered_bundle, optional_addon, loyalty_bundle, seasonal_bundle

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listing": { "title": "<string>", "category": "<string>", "current_price_eur": <number>, "cross_sell_opportunity_score": <number 0-100>, "potential_revenue_lift_pct": <number 0-50>, "bundle_readiness_pct": <number 0-100>, "cross_sell_grade": "<A|B|C|D|F>" },
  "crossSellOpportunities": [
    { "opportunity_type": "<${CROSS_SELL_TYPES.join('|')}>", "suggested_item": "<max 100 znakov>", "category": "<string>", "estimated_price_eur": <number>, "probability_pct": <number 0-100>, "expected_revenue_lift_eur": <number>, "rationale": "<max 150 znakov>", "buyer_persona": "<max 80 znakov>" }
  ],
  "bundleSuggestions": [
    { "bundle_name": "<max 100 znakov>", "strategy": "<${BUNDLE_STRATEGIES.join('|')}>", "items_included": "<max 200 znakov>", "individual_total_eur": <number>, "bundle_price_eur": <number>, "discount_pct": <number 0-30>, "expected_conversion_lift_pct": <number 0-50>, "margin_impact_pct": <number> }
  ],
  "mlModels": [
    { "model": "<apriori|fp_growth|collaborative_filtering|neural_net|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<association_rules|bundle_optimization|cross_sell_probability|conversion_forecast>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "cross_sell_optimization_score": <number 0-100>, "cross_sell_grade": "<A|B|C|D|F>", "total_opportunities": <number>,
    "expected_revenue_lift_eur": <number>, "bundle_count": <number>,
    "biggest_cross_sell_risk": "<max 100 znakov>", "biggest_cross_sell_opportunity": "<max 100 znakov>",
    "quickest_cross_sell_win": "<max 100 znakov>", "cross_sell_analysis_score": <number 0-100>
  }
}`;
}

function transformOptimizer(parsed: any, target: { title: string; category: string; buyPrice: number }): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listing: {
      title: String(parsed?.listing?.title ?? target.title).slice(0, 200),
      category: String(parsed?.listing?.category ?? target.category).slice(0, 50),
      currentPriceEur: Math.round(Number(parsed?.listing?.current_price_eur ?? target.buyPrice)),
      crossSellOpportunityScore: Math.max(0, Math.min(100, Number(parsed?.listing?.cross_sell_opportunity_score ?? 50))),
      potentialRevenueLiftPct: Math.max(0, Math.min(50, Number(parsed?.listing?.potential_revenue_lift_pct ?? 15))),
      bundleReadinessPct: Math.max(0, Math.min(100, Number(parsed?.listing?.bundle_readiness_pct ?? 40))),
      crossSellGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.listing?.cross_sell_grade)) ? String(parsed.listing.cross_sell_grade) : 'C',
    },
    crossSellOpportunities: (parsed?.crossSellOpportunities || []).slice(0, 10).map((o: any) => ({
      opportunityType: includes(CROSS_SELL_TYPES, String(o?.opportunity_type)) ? String(o.opportunity_type) : 'complementary',
      suggestedItem: String(o?.suggested_item ?? '').slice(0, 200),
      category: String(o?.category ?? '').slice(0, 50),
      estimatedPriceEur: Math.round(Number(o?.estimated_price_eur ?? 0)),
      probabilityPct: Math.max(0, Math.min(100, Number(o?.probability_pct ?? 50))),
      expectedRevenueLiftEur: Math.round(Number(o?.expected_revenue_lift_eur ?? 0)),
      rationale: String(o?.rationale ?? '').slice(0, 300),
      buyerPersona: String(o?.buyer_persona ?? '').slice(0, 160),
    })),
    bundleSuggestions: (parsed?.bundleSuggestions || []).slice(0, 8).map((b: any) => ({
      bundleName: String(b?.bundle_name ?? '').slice(0, 200),
      strategy: includes(BUNDLE_STRATEGIES, String(b?.strategy)) ? String(b.strategy) : 'fixed_bundle',
      itemsIncluded: String(b?.items_included ?? '').slice(0, 400),
      individualTotalEur: Math.round(Number(b?.individual_total_eur ?? 0)),
      bundlePriceEur: Math.round(Number(b?.bundle_price_eur ?? 0)),
      discountPct: Math.max(0, Math.min(30, Number(b?.discount_pct ?? 0))),
      expectedConversionLiftPct: Math.max(0, Math.min(50, Number(b?.expected_conversion_lift_pct ?? 10))),
      marginImpactPct: Math.round(Number(b?.margin_impact_pct ?? 0) * 10) / 10,
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['apriori', 'fp_growth', 'collaborative_filtering', 'neural_net', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: ['association_rules', 'bundle_optimization', 'cross_sell_probability', 'conversion_forecast'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'cross_sell_probability',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      crossSellOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.cross_sell_optimization_score ?? 50))),
      crossSellGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.cross_sell_grade)) ? String(parsed.summary.cross_sell_grade) : 'C',
      totalOpportunities: Math.max(0, Number(parsed?.summary?.total_opportunities ?? 0)),
      expectedRevenueLiftEur: Math.round(Number(parsed?.summary?.expected_revenue_lift_eur ?? 0)),
      bundleCount: Math.max(0, Number(parsed?.summary?.bundle_count ?? 0)),
      biggestCrossSellRisk: String(parsed?.summary?.biggest_cross_sell_risk ?? '').slice(0, 200),
      biggestCrossSellOpportunity: String(parsed?.summary?.biggest_cross_sell_opportunity ?? '').slice(0, 200),
      quickestCrossSellWin: String(parsed?.summary?.quickest_cross_sell_win ?? '').slice(0, 200),
      crossSellAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.cross_sell_analysis_score ?? 50))),
    },
  };
}
