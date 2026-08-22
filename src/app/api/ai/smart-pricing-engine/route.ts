// v6.36 / v8.96.0-refactor: AI Smart Pricing Engine — real-time dinamično prilagajanje cen
// Refaktoriran z withAiRoute helperjem (v8.96.0) + enforceBudget guard.
//
// POST /api/ai/smart-pricing-engine
// Body: {}
// Returns: { ok, pricing: { items, pricingRules, adjustmentsSummary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface SmartPricingEngineInput {}

export const POST = withAiRoute<SmartPricingEngineInput>({
  endpoint: '/api/ai/smart-pricing-engine',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — telo zahtevka je prazno

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, priceDroppedAt: true, previousPrice: true } } },
      take: 40,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, buyDate: true, sellDate: true },
      take: 300,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, pricing: null, message: 'Ni held tradeov za pricing engine.' });
    }

    const items = computePricingItems(heldTrades);
    const catData = computeCategoryVelocity(soldTrades);

    const prompt = buildPrompt(items, catData);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const pricing = transformPricing(parsed, items);

    return apiOk({ ok: true, pricing });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

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
    priceDroppedAt: Date | null;
    previousPrice: number | null;
  } | null;
}

interface PricingItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  dealScore: number;
  hasPriceDropped: boolean;
  prevPrice: number | null;
}

interface SoldTradeRow {
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  buyDate: Date;
  sellDate: Date | null;
}

interface CategoryVelocity {
  avgDays: number;
  avgRoi: number;
  count: number;
}

function computePricingItems(heldTrades: HeldTradeRow[]): PricingItem[] {
  return heldTrades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));
    const hasPriceDropped = !!t.listing?.priceDroppedAt;
    const prevPrice = t.listing?.previousPrice ?? null;
    return { id: t.id, title: t.title, category: t.category || 'drugo', cost, estValue, daysHeld,
      dealScore: t.listing?.dealScore ?? 0, hasPriceDropped, prevPrice };
  });
}

function computeCategoryVelocity(soldTrades: SoldTradeRow[]): Record<string, CategoryVelocity> {
  const catData: Record<string, CategoryVelocity> = {};
  for (const t of soldTrades) {
    const cat = t.category || 'drugo';
    if (!catData[cat]) catData[cat] = { avgDays: 0, avgRoi: 0, count: 0 };
    catData[cat].count++;
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - cost;
    catData[cat].avgRoi += cost > 0 ? (profit / cost) * 100 : 0;
    if (t.sellDate && t.buyDate) catData[cat].avgDays += Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000));
  }
  for (const c of Object.keys(catData)) {
    catData[c].avgRoi = Math.round(catData[c].avgRoi / catData[c].count);
    catData[c].avgDays = Math.round(catData[c].avgDays / catData[c].count);
  }
  return catData;
}

function buildPrompt(items: PricingItem[], catData: Record<string, CategoryVelocity>): string {
  const itemsStr = items.slice(0, 20).map(i => `- [${i.id}] ${i.title} | ${i.category} | cost: ${i.cost}€ | est: ${i.estValue}€ | ${i.daysHeld}d | deal: ${i.dealScore}${i.hasPriceDropped ? ` | padec: ${i.prevPrice}→${i.estValue}€` : ''}`).join('\n');
  const catStr = Object.entries(catData).slice(0, 8).map(([cat, d]) => `- ${cat}: ${d.count} prodaj, ${d.avgRoi}% ROI, ${d.avgDays}d`).join('\n');

  return `Si AI dynamic pricing engine za real-time prilagajanje cen.
Za vsak held item določi optimalno ceno glede na 10 faktorjev.

INVENTAR (${items.length}):
${itemsStr}

KATEGORIJSKI PODATKI:
${catStr}

Dynamic pricing faktorji (real-time):
1. DAYS_HELD: >30d → -5%, >60d → -10%, >90d → -15%
2. DEAL_SCORE: >=80 → +5%, >=60 → 0%, <40 → -10%
3. CATEGORY_VELOCITY: fast (<14d) → +5%, slow (>45d) → -5%
4. SEASONAL: v sezoni → +10%, izven sezone → -10%
5. MARKET_DEMAND: high → +5%, low → -5%
6. PRICE_HISTORY: že padla → manjši nadaljnji padec
7. COMPETITION: veliko podobnih → -5%, malo → +5%
8. PROFIT_MARGIN: >40% margin → lahko znižaš, <15% → drži ceno
9. URGENCY: stalled >45d → agresiven padec
10. AI_CONFIDENCE: visok deal score → zaupaj višji ceni

Pricing strategije:
- "hold_price": ohrani trenutno ceno (še vedno dober čas)
- "small_discount": -3-5% (blago spodbujanje)
- "medium_discount": -5-10% (pospešitev prodaje)
- "large_discount": -10-20% (agresivna likvidacija)
- "price_increase": +3-5% (redkost/visoko povpraševanje)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "category": "<kategorija>",
      "current_price_eur": <number>,
      "recommended_price_eur": <number>,
      "price_change_eur": <number>,
      "price_change_pct": <number>,
      "strategy": "<hold_price|small_discount|medium_discount|large_discount|price_increase>",
      "factors": [
        { "factor": "<days_held|deal_score|velocity|seasonal|demand|history|competition|margin|urgency|confidence>", "impact_pct": <number>, "direction": "<up|down|neutral>" }
      ],
      "expected_sell_probability_pct": <number>,
      "expected_days_to_sell": <number>,
      "projected_profit_eur": <number>,
      "reasoning": "<max 100 znakov>"
    }
  ],
  "pricing_rules": [
    { "rule": "<max 80 znakov>", "trigger": "<max 80 znakov>", "action": "<max 80 znakov>", "priority": "<high|medium|low>" }
  ],
  "adjustments_summary": {
    "items_price_increased": <number>,
    "items_price_held": <number>,
    "items_price_decreased": <number>,
    "total_projected_revenue_eur": <number>,
    "total_projected_profit_eur": <number>,
    "avg_price_change_pct": <number>
  }
}`;
}

function transformPricing(parsed: any, items: PricingItem[]) {
  const validIds = new Set(items.map(i => i.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).map((it: any) => ({
      tradeId: String(it?.id ?? ''),
      title: String(it?.title ?? '').slice(0, 150),
      category: String(it?.category ?? '').slice(0, 50),
      currentPriceEur: Math.max(0, Number(it?.current_price_eur ?? 0)),
      recommendedPriceEur: Math.max(0, Number(it?.recommended_price_eur ?? 0)),
      priceChangeEur: Math.round(Number(it?.price_change_eur ?? 0)),
      priceChangePct: Math.round(Number(it?.price_change_pct ?? 0)),
      strategy: ['hold_price', 'small_discount', 'medium_discount', 'large_discount', 'price_increase'].includes(String(it?.strategy))
        ? String(it.strategy) : 'hold_price',
      factors: (it?.factors || []).slice(0, 10).map((f: any) => ({
        factor: String(f?.factor ?? '').slice(0, 50),
        impactPct: Math.round(Number(f?.impact_pct ?? 0)),
        direction: ['up', 'down', 'neutral'].includes(String(f?.direction)) ? String(f.direction) : 'neutral',
      })),
      expectedSellProbabilityPct: Math.max(0, Math.min(100, Number(it?.expected_sell_probability_pct ?? 50))),
      expectedDaysToSell: Math.max(0, Number(it?.expected_days_to_sell ?? 14)),
      projectedProfitEur: Math.round(Number(it?.projected_profit_eur ?? 0)),
      reasoning: String(it?.reasoning ?? '').slice(0, 200),
    })),
    pricingRules: (parsed?.pricing_rules || []).slice(0, 8).map((r: any) => ({
      rule: String(r?.rule ?? '').slice(0, 150),
      trigger: String(r?.trigger ?? '').slice(0, 150),
      action: String(r?.action ?? '').slice(0, 150),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
    })),
    adjustmentsSummary: {
      itemsPriceIncreased: Math.max(0, Number(parsed?.adjustments_summary?.items_price_increased ?? 0)),
      itemsPriceHeld: Math.max(0, Number(parsed?.adjustments_summary?.items_price_held ?? 0)),
      itemsPriceDecreased: Math.max(0, Number(parsed?.adjustments_summary?.items_price_decreased ?? 0)),
      totalProjectedRevenueEur: Math.round(Number(parsed?.adjustments_summary?.total_projected_revenue_eur ?? 0)),
      totalProjectedProfitEur: Math.round(Number(parsed?.adjustments_summary?.total_projected_profit_eur ?? 0)),
      avgPriceChangePct: Math.round(Number(parsed?.adjustments_summary?.avg_price_change_pct ?? 0)),
    },
  };
}
