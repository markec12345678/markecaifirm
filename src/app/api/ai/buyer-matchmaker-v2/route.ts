// v6.49 / v8.95.9-buyer-medium: AI Buyer Matchmaker v2 — ML matching kupcev z inventarjem z behavioral scoringom
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-matchmaker-v2
// Body: { tradeId?: string, customerName?: string }
// Returns: { ok, matcher: { matches, scoringFactors, outreachPlan, predictions, recommendations, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BuyerMatchmakerV2Input {
  tradeId: string | null;
  customerName: string | null;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: {
    aiEstimatedValue: number | null;
    dealScore: number | null;
    aiRisk: number | null;
    imageUrl: string | null;
    location: string | null;
    description: string | null;
    detailDescription: string | null;
  } | null;
}

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  sellLocation: string;
  buyDate: Date | null;
}

interface InventoryItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  description: string;
}

interface BuyerProfile {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrderValue: number;
  categories: Set<string>;
  items: string[];
  lastPurchase: Date | null;
  daysSinceLastPurchase: number;
  preferredCategories: string[];
  priceRange: { min: number; max: number };
  buyingPattern: 'impulsive' | 'deliberate' | 'seasonal' | 'opportunistic';
  lifetimeValuePotential: number;
  engagementScore: number; // 0-100
}

const MATCH_TYPES = [
  'direct_match', 'cross_sell_match', 'upsell_match',
  'repeat_match', 'new_category_match', 'reactivation_match',
] as const;

const SCORING_FACTOR_KEYS = [
  'category_fit', 'price_fit', 'recency', 'frequency',
  'affinity', 'conversion', 'engagement', 'seasonal',
] as const;

const RECOMMENDED_CHANNELS = ['email', 'sms', 'in_person', 'social_dm', 'none'] as const;
const PREDICTION_METRICS = ['total_reach', 'total_responses', 'total_conversions', 'expected_revenue'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;
const DAY = 24 * 60 * 60 * 1000;

export const POST = withAiRoute<BuyerMatchmakerV2Input>({
  endpoint: '/api/ai/buyer-matchmaker-v2',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : null,
      customerName: body?.customerName ? String(body.customerName).trim() : null,
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId, customerName } = input;

    // 1. Pridobi held trade-e (inventar za matching)
    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;

    const heldTrades: HeldTradeRow[] = await db.trade.findMany({
      where,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: {
          select: { aiEstimatedValue: true, dealScore: true, aiRisk: true, imageUrl: true, location: true, description: true, detailDescription: true },
        },
      },
      take: tradeId ? 1 : 30,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, matcher: null, message: 'Ni held tradeov za buyer matching.' });
    }

    // 2. Pridobi sold trades za buyer profile
    const soldTrades: SoldTradeRow[] = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, matcher: null, message: 'Ni prodaj za buyer profile.' });
    }

    // 3. Buyer profile aggregation
    const now = Date.now();
    const buyers = buildBuyers(soldTrades, now, DAY);

    if (customerName) {
      const filtered = buyers.filter(b => b.name === customerName);
      if (filtered.length === 0) {
        return apiOk({ ok: true, matcher: null, message: `Kupec "${customerName}" ni najden v zgodovini.` });
      }
    }

    // 5. Pripravi AI input
    const inventoryItems = buildInventoryItems(heldTrades, now);
    const targetBuyers = customerName
      ? buyers.filter(b => b.name === customerName)
      : buyers.filter(b => b.engagementScore >= 30).slice(0, 20);

    const prompt = buildPrompt(inventoryItems, targetBuyers);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const matcher = transformMatcher(parsed, inventoryItems, targetBuyers);

    return apiOk({ ok: true, matcher });
  },
});

// --- Pomožne funkcive (čiste, testabilne) --------------------------------

function buildInventoryItems(heldTrades: HeldTradeRow[], now: number): InventoryItem[] {
  return heldTrades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    const daysHeld = Math.round((now - t.buyDate.getTime()) / DAY);
    return {
      id: t.id, title: t.title, category: t.category || 'drugo',
      cost, estValue, daysHeld,
      description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 200),
    };
  });
}

function buildBuyers(soldTrades: SoldTradeRow[], now: number, DAY: number): BuyerProfile[] {
  const buyerMap = new Map<string, BuyerProfile>();
  for (const t of soldTrades) {
    const name = (t.sellLocation || '').trim();
    if (!name || name.length < 2 || !t.sellDate) continue;
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);

    if (!buyerMap.has(name)) {
      buyerMap.set(name, {
        name,
        purchases: 0,
        totalSpent: 0,
        avgOrderValue: 0,
        categories: new Set<string>(),
        items: [],
        lastPurchase: t.sellDate,
        daysSinceLastPurchase: 0,
        preferredCategories: [],
        priceRange: { min: revenue, max: revenue },
        buyingPattern: 'deliberate',
        lifetimeValuePotential: 0,
        engagementScore: 50,
      });
    }
    const b = buyerMap.get(name)!;
    b.purchases += 1;
    b.totalSpent += revenue;
    if (t.sellDate > (b.lastPurchase as Date)) b.lastPurchase = t.sellDate;
    if (t.category) b.categories.add(t.category);
    b.items.push(t.title);
    if (revenue < b.priceRange.min) b.priceRange.min = revenue;
    if (revenue > b.priceRange.max) b.priceRange.max = revenue;
  }

  // 4. ML hevristike za buyer scoring
  return Array.from(buyerMap.values()).map(b => {
    b.avgOrderValue = Math.round(b.totalSpent / b.purchases);
    if (b.lastPurchase) {
      b.daysSinceLastPurchase = Math.round((now - b.lastPurchase.getTime()) / DAY);
    }
    b.preferredCategories = Array.from(b.categories).slice(0, 5);

    // Buying pattern detection
    if (b.purchases === 1 && b.totalSpent > 300) b.buyingPattern = 'impulsive';
    else if (b.daysSinceLastPurchase < 30 && b.purchases >= 3) b.buyingPattern = 'opportunistic';
    else if (b.preferredCategories.length === 1) b.buyingPattern = 'deliberate';
    else b.buyingPattern = 'seasonal';

    // LTV potential: totalSpent × projection factor glede na recency
    const recencyFactor = Math.max(0.1, 1 - b.daysSinceLastPurchase / 365);
    b.lifetimeValuePotential = Math.round(b.totalSpent * recencyFactor * 2.5);

    // Engagement score
    const recencyScore = Math.max(0, 40 - Math.round(b.daysSinceLastPurchase / 7));
    const frequencyScore = Math.min(30, b.purchases * 6);
    const monetaryScore = Math.min(20, Math.round(b.totalSpent / 100));
    const diversityScore = Math.min(10, b.preferredCategories.length * 2);
    b.engagementScore = Math.min(100, recencyScore + frequencyScore + monetaryScore + diversityScore);

    return b;
  });
}

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function buildPrompt(inventoryItems: InventoryItem[], targetBuyers: BuyerProfile[]): string {
  const inventoryStr = inventoryItems.slice(0, 15).map(i =>
    `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d | ${i.description.slice(0, 80)}`
  ).join('\n');

  const buyersStr = targetBuyers.slice(0, 15).map(b =>
    `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ skupaj | ${b.avgOrderValue}€ povp | ${b.daysSinceLastPurchase}d nazadnje | pattern: ${b.buyingPattern} | kategorije: ${b.preferredCategories.join(',')} | range ${b.priceRange.min}-${b.priceRange.max}€ | engagement ${b.engagementScore}/100 | LTV ${b.lifetimeValuePotential}€`
  ).join('\n');

  return `Si AI buyer matchmaker v2 z ML matching algoritmom.
Poveži inventar z najboljšimi kupci glede na behavioral patterns in predicted conversion.

INVENTAR (${inventoryItems.length}):
${inventoryStr}

KUPCI ZA MATCHING (${targetBuyers.length}):
${buyersStr}

ML scoring faktorji (0-100 vsak):
1. CATEGORY_FIT: ujemanje kategorije itema z buyerjevimi preferred categories
2. PRICE_FIT: ali cena itema ustreza buyerjevem price range
3. RECENCY_SCORE: kako nedavno je kupec aktivno kupoval (dragi recency > 30d)
4. FREQUENCY_SCORE: kako pogosto kupec kupuje (povratnik > nov)
5. AFFINITY_SCORE: kombinacija category + price + pattern match
6. PREDICTED_CONVERSION: verjetnost da bo kupec dejansko kupil
7. ENGAGEMENT_SCORE: kako aktiven je kupec (recency × frequency × monetary)
8. SEASONAL_TIMING: ali je trenutno ugoden čas za to kategorijo

Matching taktike:
- DIRECT_MATCH: kupec je kupoval isto kategorijo + cena ustreza
- CROSS_SELL_MATCH: kupec kupuje complementary kategorije
- UPSELL_MATCH: kupec je kupoval cenejšo verzijo, sedaj lahko kupi dražjo
- REPEAT_MATCH: kupec je kupoval isti item pred časom (nadomestitev)
- NEW_CATEGORY_MATCH: kupec z visokim engagementom, širi kategorije
- REACTIVATION_MATCH: kupec je bil neaktiven, lahko ga reaktiviramo z ugodno ponudbo

Outreach strategije:
- EMAIL: za deliberate buyers z visokim engagement
- SMS: za impulsive/opportunistic z nedavno aktivnostjo
- IN_PERSON: za high-value local buyers
- SOCIAL_DM: za seasonal buyers z nižjim engagement
- NONE: za neaktivne buyers (prevelika verjetnost neuspeha)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "matches": [
    {
      "trade_id": "<trade_id>",
      "buyer_name": "<ime kupca>",
      "match_type": "<direct_match|cross_sell_match|upsell_match|repeat_match|new_category_match|reactivation_match>",
      "overall_match_score": <number 0-100>,
      "category_fit_score": <number 0-100>,
      "price_fit_score": <number 0-100>,
      "recency_score": <number 0-100>,
      "frequency_score": <number 0-100>,
      "affinity_score": <number 0-100>,
      "predicted_conversion_pct": <number 0-100>,
      "engagement_score": <number 0-100>,
      "seasonal_timing_score": <number 0-100>,
      "recommended_price_eur": <number>,
      "recommended_channel": "<email|sms|in_person|social_dm|none>",
      "outreach_message": "<max 250 znakov>",
      "best_time_to_contact": "<max 80 znakov>",
      "expected_value_eur": <number>,
      "priority": "<high|medium|low>"
    }
  ],
  "scoring_factors": [
    { "factor": "<category_fit|price_fit|recency|frequency|affinity|conversion|engagement|seasonal>", "weight": <number 0-100>, "description": "<max 100 znakov>", "average_score": <number 0-100> }
  ],
  "outreach_plan": [
    { "day": <1-14>, "action": "<max 100 znakov>", "buyers_contacted": <number>, "expected_responses": <number>, "expected_conversions": <number> }
  ],
  "predictions": [
    { "metric": "<total_reach|total_responses|total_conversions|expected_revenue>", "predicted_value": <number>, "confidence_pct": <number 0-100>, "notes": "<max 80 znakov>" }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_impact_eur": <number>, "buyers_affected": <number> }
  ],
  "summary": {
    "total_matches": <number>,
    "high_priority_matches": <number>,
    "total_buyers_targeted": <number>,
    "total_inventory_matched": <number>,
    "avg_match_score": <number>,
    "expected_total_revenue_eur": <number>,
    "expected_conversion_rate_pct": <number>,
    "best_match_score": <number>,
    "best_match_pair": "<max 100 znakov>",
    "matching_efficiency_score": <number 0-100>,
    "biggest_opportunity": "<max 100 znakov>"
  }
}`;
}

function transformMatcher(parsed: any, inventoryItems: InventoryItem[], targetBuyers: BuyerProfile[]): any {
  const validTradeIds = new Set(inventoryItems.map(i => i.id));
  const validBuyerNames = new Set(targetBuyers.map(b => b.name));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    matches: (parsed?.matches || [])
      .filter((m: any) => validTradeIds.has(String(m?.trade_id ?? '')) && validBuyerNames.has(String(m?.buyer_name ?? '')))
      .slice(0, 30)
      .map((m: any) => ({
        tradeId: String(m?.trade_id ?? '').slice(0, 50),
        buyerName: String(m?.buyer_name ?? '').slice(0, 100),
        matchType: includes(MATCH_TYPES, String(m?.match_type)) ? String(m.match_type) : 'direct_match',
        overallMatchScore: Math.max(0, Math.min(100, Number(m?.overall_match_score ?? 50))),
        categoryFitScore: Math.max(0, Math.min(100, Number(m?.category_fit_score ?? 50))),
        priceFitScore: Math.max(0, Math.min(100, Number(m?.price_fit_score ?? 50))),
        recencyScore: Math.max(0, Math.min(100, Number(m?.recency_score ?? 50))),
        frequencyScore: Math.max(0, Math.min(100, Number(m?.frequency_score ?? 50))),
        affinityScore: Math.max(0, Math.min(100, Number(m?.affinity_score ?? 50))),
        predictedConversionPct: Math.max(0, Math.min(100, Number(m?.predicted_conversion_pct ?? 30))),
        engagementScore: Math.max(0, Math.min(100, Number(m?.engagement_score ?? 50))),
        seasonalTimingScore: Math.max(0, Math.min(100, Number(m?.seasonal_timing_score ?? 50))),
        recommendedPriceEur: Math.max(0, Math.round(Number(m?.recommended_price_eur ?? 0))),
        recommendedChannel: includes(RECOMMENDED_CHANNELS, String(m?.recommended_channel)) ? String(m.recommended_channel) : 'email',
        outreachMessage: String(m?.outreach_message ?? '').slice(0, 500),
        bestTimeToContact: String(m?.best_time_to_contact ?? '').slice(0, 150),
        expectedValueEur: Math.round(Number(m?.expected_value_eur ?? 0)),
        priority: includes(PRIORITIES, String(m?.priority)) ? String(m.priority) : 'medium',
      })),
    scoringFactors: (parsed?.scoring_factors || []).slice(0, 8).map((s: any) => ({
      factor: includes(SCORING_FACTOR_KEYS, String(s?.factor)) ? String(s.factor) : 'affinity',
      weight: Math.max(0, Math.min(100, Number(s?.weight ?? 50))),
      description: String(s?.description ?? '').slice(0, 200),
      averageScore: Math.max(0, Math.min(100, Number(s?.average_score ?? 50))),
    })),
    outreachPlan: (parsed?.outreach_plan || []).slice(0, 14).map((o: any) => ({
      day: Math.max(1, Math.min(14, Number(o?.day ?? 1))),
      action: String(o?.action ?? '').slice(0, 200),
      buyersContacted: Math.max(0, Number(o?.buyers_contacted ?? 0)),
      expectedResponses: Math.max(0, Number(o?.expected_responses ?? 0)),
      expectedConversions: Math.max(0, Number(o?.expected_conversions ?? 0)),
    })),
    predictions: (parsed?.predictions || []).slice(0, 5).map((p: any) => ({
      metric: includes(PREDICTION_METRICS, String(p?.metric)) ? String(p.metric) : 'total_reach',
      predictedValue: Math.round(Number(p?.predicted_value ?? 0)),
      confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 50))),
      notes: String(p?.notes ?? '').slice(0, 150),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      priority: includes(PRIORITIES, String(r?.priority)) ? String(r.priority) : 'medium',
      expectedImpactEur: Math.round(Number(r?.expected_impact_eur ?? 0)),
      buyersAffected: Math.max(0, Number(r?.buyers_affected ?? 0)),
    })),
    summary: {
      totalMatches: Math.max(0, Number(parsed?.summary?.total_matches ?? 0)),
      highPriorityMatches: Math.max(0, Number(parsed?.summary?.high_priority_matches ?? 0)),
      totalBuyersTargeted: Math.max(0, Number(parsed?.summary?.total_buyers_targeted ?? targetBuyers.length)),
      totalInventoryMatched: Math.max(0, Number(parsed?.summary?.total_inventory_matched ?? inventoryItems.length)),
      avgMatchScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_match_score ?? 50))),
      expectedTotalRevenueEur: Math.round(Number(parsed?.summary?.expected_total_revenue_eur ?? 0)),
      expectedConversionRatePct: Math.max(0, Math.min(100, Number(parsed?.summary?.expected_conversion_rate_pct ?? 20))),
      bestMatchScore: Math.max(0, Math.min(100, Number(parsed?.summary?.best_match_score ?? 80))),
      bestMatchPair: String(parsed?.summary?.best_match_pair ?? '').slice(0, 200),
      matchingEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.matching_efficiency_score ?? 60))),
      biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 200),
    },
  };
}
