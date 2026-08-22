// v6.69 / v8.95.7-listing: AI Listing Competitor Price Tracker v2 — ML competitor tracking z price intelligence
// Refaktoriran z withAiRoute helperjem (v8.95.7-listing) + enforceBudget guard.
//
// POST /api/ai/listing-competitor-price-tracker-v2
// Body: { tradeId?: string, days?: number }
// Returns: { ok, tracker: { competitors, priceChanges, positioning, mlModels, recommendations, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic, maxDuration } = AI_ROUTE_DEFAULTS;

interface ListingCompetitorPriceTrackerV2Input {
  tradeId: string | null;
  days: number;
}

export const POST = withAiRoute<ListingCompetitorPriceTrackerV2Input>({
  endpoint: '/api/ai/listing-competitor-price-tracker-v2',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : null,
      days: Math.max(7, Math.min(90, Number(body?.days ?? 30))),
    };
  },

  // No validateInput — tradeId je opcijski, days ima default + clamp

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId, days } = input;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades = await db.trade.findMany({
      where,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, price: true, dealScore: true, sellerName: true } },
      },
      take: tradeId ? 1 : 20,
    });

    const competitorListings = await db.listing.findMany({
      where: { firstSeenAt: { gte: since }, isHidden: false, price: { not: null, gt: 0 } },
      select: { id: true, title: true, price: true, previousPrice: true, priceDroppedAt: true, firstSeenAt: true, sellerName: true, aiEstimatedValue: true },
      take: 500,
      orderBy: { firstSeenAt: 'desc' },
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, tracker: null, message: 'Ni held tradeov za competitor tracking.' });
    }

    const items = buildItems(heldTrades);
    const itemsStr = buildItemsStr(items);
    const competitorStr = buildCompetitorStr(competitorListings);
    const prompt = buildPrompt(items.length, itemsStr, competitorListings.length, competitorStr);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const tracker = transformTracker(parsed, competitorListings.length);

    return apiOk({ ok: true, tracker });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: {
    aiEstimatedValue: number | null;
    price: number | null;
    dealScore: number | null;
    sellerName: string | null;
  } | null;
}

interface CompetitorRow {
  id: string;
  title: string;
  price: number | null;
  previousPrice: number | null;
  priceDroppedAt: Date | null;
  firstSeenAt: Date | null;
  sellerName: string | null;
  aiEstimatedValue: number | null;
}

interface CompetitorItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  sellerName: string;
}

function buildItems(heldTrades: HeldTradeRow[]): CompetitorItem[] {
  return heldTrades.map(t => ({
    id: t.id,
    title: t.title,
    category: (t.category || 'drugo').toLowerCase(),
    cost: t.buyPrice + (t.buyFees ?? 0),
    estValue: t.listing?.aiEstimatedValue ?? Math.round((t.buyPrice + (t.buyFees ?? 0)) * 1.25),
    sellerName: t.listing?.sellerName ?? '',
  }));
}

function buildItemsStr(items: CompetitorItem[]): string {
  return items
    .slice(0, 15)
    .map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€`)
    .join('\n');
}

function buildCompetitorStr(competitorListings: CompetitorRow[]): string {
  return competitorListings
    .slice(0, 15)
    .map(l => `- "${l.title}" | ${l.price}€ | ${l.previousPrice ? 'padlo iz ' + l.previousPrice + '€' : 'brez padca'} | ${l.sellerName ?? 'neznan'}`)
    .join('\n');
}

function buildPrompt(itemsCount: number, itemsStr: string, competitorCount: number, competitorStr: string): string {
  return `Si AI listing competitor price tracker v2 z ML price intelligence.
Sledi competitorjem in predlaga pricing strategijo.

TVOJI INVENTAR (${itemsCount}):
${itemsStr}

COMPETITOR LISTINGI (${competitorCount}):
${competitorStr}

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "competitors": [
    { "competitor_name": "<max 80 znakov>", "listing_count": <number>, "avg_price_eur": <number>, "min_price_eur": <number>, "max_price_eur": <number>, "avg_discount_pct": <number>, "price_trend": "<rising|stable|falling>", "competitive_threat_level": "<low|medium|high|critical>", "their_strength": "<max 100 znakov>", "their_weakness": "<max 100 znakov>", "counter_strategy": "<max 150 znakov>" }
  ],
  "priceChanges": [
    { "competitor_name": "<max 80 znakov>", "old_price_eur": <number>, "new_price_eur": <number>, "change_pct": <number>, "change_type": "<increase|decrease|stable>", "listing_title": "<max 80 znakov>", "impact_on_you": "<positive|neutral|negative>", "recommended_response": "<match_price|hold_price|undercut|differentiate>" }
  ],
  "positioning": [
    { "category": "<kategorija>", "your_avg_price_eur": <number>, "competitor_avg_price_eur": <number>, "price_position": "<premium|above_avg|at_avg|below_avg|budget>", "positioning_score": <number 0-100>, "recommended_position": "<premium|competitive|value|budget>", "expected_impact_eur": <number> }
  ],
  "mlModels": [
    { "model": "<arima|lstm|prophet|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<price_trend|competitor_move|optimal_price|market_share>", "weight_in_ensemble": <number 0-100> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_revenue_impact_eur": <number>, "timeframe_days": <number>, "competitor_targeted": "<max 80 znakov>" }
  ],
  "summary": {
    "total_competitors_tracked": <number>, "total_competitor_listings": <number>, "avg_competitor_price_eur": <number>,
    "your_price_position": "<premium|competitive|value|budget>", "biggest_competitive_threat": "<max 100 znakov>",
    "biggest_competitive_opportunity": "<max 100 znakov>", "competitor_tracking_score": <number 0-100>
  }
}`;
}

function transformTracker(parsed: any, competitorListingsLength: number): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    competitors: (parsed?.competitors || []).slice(0, 10).map((c: any) => ({
      competitorName: String(c?.competitor_name ?? '').slice(0, 150), listingCount: Math.max(0, Number(c?.listing_count ?? 0)),
      avgPriceEur: Math.round(Number(c?.avg_price_eur ?? 0)), minPriceEur: Math.round(Number(c?.min_price_eur ?? 0)),
      maxPriceEur: Math.round(Number(c?.max_price_eur ?? 0)), avgDiscountPct: Math.round(Number(c?.avg_discount_pct ?? 0) * 10) / 10,
      priceTrend: ['rising', 'stable', 'falling'].includes(String(c?.price_trend)) ? String(c.price_trend) : 'stable',
      competitiveThreatLevel: ['low', 'medium', 'high', 'critical'].includes(String(c?.competitive_threat_level)) ? String(c.competitive_threat_level) : 'medium',
      theirStrength: String(c?.their_strength ?? '').slice(0, 200), theirWeakness: String(c?.their_weakness ?? '').slice(0, 200),
      counterStrategy: String(c?.counter_strategy ?? '').slice(0, 300),
    })),
    priceChanges: (parsed?.price_changes || []).slice(0, 15).map((p: any) => ({
      competitorName: String(p?.competitor_name ?? '').slice(0, 150), oldPriceEur: Math.round(Number(p?.old_price_eur ?? 0)),
      newPriceEur: Math.round(Number(p?.new_price_eur ?? 0)), changePct: Math.round(Number(p?.change_pct ?? 0) * 10) / 10,
      changeType: ['increase', 'decrease', 'stable'].includes(String(p?.change_type)) ? String(p.change_type) : 'stable',
      listingTitle: String(p?.listing_title ?? '').slice(0, 150),
      impactOnYou: ['positive', 'neutral', 'negative'].includes(String(p?.impact_on_you)) ? String(p.impact_on_you) : 'neutral',
      recommendedResponse: ['match_price', 'hold_price', 'undercut', 'differentiate'].includes(String(p?.recommended_response)) ? String(p.recommended_response) : 'hold_price',
    })),
    positioning: (parsed?.positioning || []).slice(0, 10).map((p: any) => ({
      category: String(p?.category ?? '').slice(0, 50), yourAvgPriceEur: Math.round(Number(p?.your_avg_price_eur ?? 0)),
      competitorAvgPriceEur: Math.round(Number(p?.competitor_avg_price_eur ?? 0)),
      pricePosition: ['premium', 'above_avg', 'at_avg', 'below_avg', 'budget'].includes(String(p?.price_position)) ? String(p.price_position) : 'at_avg',
      positioningScore: Math.max(0, Math.min(100, Number(p?.positioning_score ?? 50))),
      recommendedPosition: ['premium', 'competitive', 'value', 'budget'].includes(String(p?.recommended_position)) ? String(p.recommended_position) : 'competitive',
      expectedImpactEur: Math.round(Number(p?.expected_impact_eur ?? 0)),
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))),
      predictionType: ['price_trend', 'competitor_move', 'optimal_price', 'market_share'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'price_trend',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300), priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      expectedRevenueImpactEur: Math.round(Number(r?.expected_revenue_impact_eur ?? 0)),
      timeframeDays: Math.max(1, Number(r?.timeframe_days ?? 7)), competitorTargeted: String(r?.competitor_targeted ?? '').slice(0, 150),
    })),
    summary: {
      totalCompetitorsTracked: Math.max(0, Number(parsed?.summary?.total_competitors_tracked ?? 0)),
      totalCompetitorListings: Math.max(0, Number(parsed?.summary?.total_competitor_listings ?? competitorListingsLength)),
      avgCompetitorPriceEur: Math.round(Number(parsed?.summary?.avg_competitor_price_eur ?? 0)),
      yourPricePosition: ['premium', 'competitive', 'value', 'budget'].includes(String(parsed?.summary?.your_price_position)) ? String(parsed.summary.your_price_position) : 'competitive',
      biggestCompetitiveThreat: String(parsed?.summary?.biggest_competitive_threat ?? '').slice(0, 200),
      biggestCompetitiveOpportunity: String(parsed?.summary?.biggest_competitive_opportunity ?? '').slice(0, 200),
      competitorTrackingScore: Math.max(0, Math.min(100, Number(parsed?.summary?.competitor_tracking_score ?? 60))),
    },
  };
}
