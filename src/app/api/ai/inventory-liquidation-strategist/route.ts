// v6.55 / v8.94-refactor: AI Inventory Liquidation Strategist — strategic liquidation z timing in channel optimization
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-liquidation-strategist
// Body: { tradeIds?: string[], minDaysHeld?: number }
// Returns: { ok, strategist: { items, strategies, channels, timeline, bundles, recommendations, summary } | null, message? }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const LIQUIDATION_STRATEGIES = [
  'flash_sale',           // 24-48h akcija z visokim popustom
  'bundle_clearance',     // paket z deep discount
  'auction_clearance',    // dražba od 1€
  'bulk_discount',        // količinski popust za reseller
  'donation_tax_writeoff',// donacija za davčno olajšavo
  'part_out',             // razstavi na dele
  'trade_in_credit',      // v odbitem pri nakupu novega
  'wholesale_lot',        // prodaj lot reseller-ju
  'garage_sale',          // lokalna garažna prodaja
  'recycle_scrap',        // recikliraj/sell as scrap
] as const;

const CHANNELS = ['bolha', 'facebook', 'vinted', 'ebay', 'local_pickup'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;
const EFFORTS = ['low', 'medium', 'high'] as const;

interface LiquidationStrategistInput {
  tradeIds: string[];
  minDaysHeld: number;
}

export const POST = withAiRoute<LiquidationStrategistInput>({
  endpoint: '/api/ai/inventory-liquidation-strategist',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget + avtomatsko recordAiCall po uspehu

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const tradeIds: string[] = Array.isArray(body?.tradeIds) ? body.tradeIds : [];
    const minDaysHeld = Math.max(0, Number(body?.minDaysHeld ?? 30));
    return { tradeIds, minDaysHeld };
  },

  // No validateInput — vsi input-i imajo defaults (minDaysHeld=30 clamped 0+)

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeIds, minDaysHeld } = input;

    const where: any = { status: 'held' };
    if (tradeIds.length > 0) where.id = { in: tradeIds };

    const heldTrades = await db.trade.findMany({
      where,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true, location: true, imageUrl: true } },
      },
      take: tradeIds.length > 0 ? tradeIds.length : 50,
    });

    // Filter by minDaysHeld
    const now = Date.now();
    const filtered = heldTrades.filter(t => {
      const daysHeld = Math.round((now - t.buyDate.getTime()) / (24*60*60*1000));
      return daysHeld >= minDaysHeld;
    });

    if (filtered.length === 0) {
      return apiOk({ ok: true, strategist: null, message: `Ni held tradeov z vsaj ${minDaysHeld} dnevi v skladišču.` });
    }

    const items = computeLiquidationItems(filtered, now);

    const prompt = buildLiquidationPrompt(items, minDaysHeld);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const strategist = transformLiquidationStrategist(parsed, items);

    return apiOk({ ok: true, strategist });
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
    aiRisk: number | null;
    location: string | null;
    imageUrl: string | null;
  } | null;
}

interface LiquidationItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  holdingCost: number;
  currentValue: number;
  potentialLoss: number;
  dealScore: number;
  location: string;
}

function computeLiquidationItems(trades: HeldTradeRow[], now: number): LiquidationItem[] {
  return trades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    const daysHeld = Math.round((now - t.buyDate.getTime()) / (24*60*60*1000));
    const holdingCost = Math.round(cost * 0.0003 * daysHeld * 100) / 100;
    const currentValueAfterDepreciation = Math.max(cost * 0.5, estValue * Math.pow(0.99, daysHeld / 7));
    return {
      id: t.id, title: t.title, category: t.category || 'drugo',
      cost, estValue, daysHeld, holdingCost,
      currentValue: Math.round(currentValueAfterDepreciation),
      potentialLoss: Math.round(currentValueAfterDepreciation - cost),
      dealScore: t.listing?.dealScore ?? 50,
      location: t.listing?.location || '',
    };
  });
}

function buildLiquidationPrompt(items: LiquidationItem[], minDaysHeld: number): string {
  const itemsStr = items.slice(0, 25).map(i =>
    `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.currentValue}€ (loss ${i.potentialLoss}€) | ${i.daysHeld}d | holding ${i.holdingCost}€ | ${i.location}`
  ).join('\n');

  return `Si AI inventory liquidation strategist za slovenske oglasne platforme.
Strategic liquidation za stalled/dead inventar z timing in channel optimization.

INVENTAR ZA LIKVIDACIJO (${items.length}, min ${minDaysHeld}d):
${itemsStr}

10 liquidation strategij:
1. FLASH_SALE: 24-48h akcija z 30-50% popustom (visoka urgency)
2. BUNDLE_CLEARANCE: paket z deep discount 40-60% (grupiraj komplementarne)
3. AUCTION_CLEARANCE: dražba od 1€, najvišji bid zmaga (hitro, tvegano)
4. BULK_DISCOUNT: količinski popust za reseller (10+ itemov, 50% off)
5. DONATION_TAX_WRITEOFF: doniraj in odbriši od davkov (cajthi, socialna odgovornost)
6. PART_OUT: razstavi na dele in prodaj komponente (časovno zahtevno)
7. TRADE_IN_CREDIT: ponudi kot trade-in pri novem nakupu (zadrži kupca)
8. WHOLESALE_LOT: prodaj lot reseller-ju z 60-70% discount
9. GARAGE_SALE: lokalna garažna prodaja za takojšen cash
10. RECYCLE_SCRAP: recikliraj ali prodaj kot scrap (zadnja možnost)

Likvidacijska pravila:
- Days held 30-60: flash_sale, bundle_clearance (15-25% popust)
- Days held 60-90: auction_clearance, bulk_discount (25-40% popust)
- Days held 90-180: wholesale_lot, trade_in_credit (40-55% popust)
- Days held 180+: donation_tax_writeoff, recycle_scrap (zapiši izgubo)

Channel optimization:
- BOLHA: lokalno, dober za večino itemov, 0% fee
- FACEBOOK: širši doseg, dober za bundle in flash sale
- VINTED: moda, 5% fee
- EBAY: mednarodni, 10% fee, dober za auction
- LOCAL_PICKUP: garažna prodaja, ni fee

Timing pravila:
- VIKEND: boljši za lokalne prodaje
- PONEDELJEK-ZVEZER: slabše za urgency (ljudje začnejo teden)
- PRED PRAZNIKI: boljše za darila
- KONEC MESECA: boljše za discount (ljudje imajo plačo)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "recommended_strategy": "<flash_sale|bundle_clearance|auction_clearance|bulk_discount|donation_tax_writeoff|part_out|trade_in_credit|wholesale_lot|garage_sale|recycle_scrap>",
      "current_value_eur": <number>,
      "recommended_price_eur": <number>,
      "discount_pct": <number>,
      "expected_recovery_eur": <number>,
      "recovery_rate_pct": <number 0-100>,
      "expected_loss_eur": <number>,
      "best_channel": "<bolha|facebook|vinted|ebay|local_pickup>",
      "best_timing": "<max 80 znakov>",
      "expected_days_to_sell": <number>,
      "reasoning": "<max 120 znakov>",
      "priority": "<high|medium|low>"
    }
  ],
  "strategies": [
    { "strategy": "<10 strategij>", "description": "<max 120 znakov>", "best_for_category": "<max 80 znakov>", "best_for_days_held_range": "<max 60 znakov>", "expected_recovery_rate_pct": <number>, "time_to_liquidate_days": <number>, "implementation_effort": "<low|medium|high>" }
  ],
  "channels": [
    { "channel": "<bolha|facebook|vinted|ebay|local_pickup>", "items_recommended": <number>, "avg_recovery_rate_pct": <number>, "fee_pct": <number>, "net_recovery_eur": <number>, "best_for_strategy": "<max 80 znakov>" }
  ],
  "timeline": [
    { "week": <1-4>, "items_to_liquidate": <number>, "strategy_focus": "<max 80 znakov>", "expected_recovery_eur": <number>, "expected_loss_eur": <number>, "actions": ["<max 80 znakov>"] }
  ],
  "bundles": [
    { "bundle_name": "<max 60 znakov>", "item_ids": ["<trade_id>"], "individual_value_eur": <number>, "bundle_price_eur": <number>, "discount_pct": <number>, "expected_recovery_eur": <number>, "target_buyer": "<max 80 znakov>" }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_recovery_eur": <number>, "items_affected": <number>, "implementation_days": <number> }
  ],
  "summary": {
    "total_items_to_liquidate": <number>,
    "total_cost_eur": <number>,
    "total_current_value_eur": <number>,
    "total_expected_recovery_eur": <number>,
    "total_expected_loss_eur": <number>,
    "avg_recovery_rate_pct": <number>,
    "best_strategy_overall": "<max 80 znakov>",
    "best_channel_overall": "<max 80 znakov>",
    "biggest_loss_item": "<max 100 znakov>",
    "quickest_win": "<max 100 znakov>",
    "liquidation_efficiency_score": <number 0-100>
  }
}`;
}

function transformLiquidationStrategist(parsed: any, items: LiquidationItem[]) {
  const validIds = new Set(items.map(i => i.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    items: (parsed?.items || [])
      .filter((it: any) => validIds.has(String(it?.id ?? '')))
      .slice(0, 25)
      .map((it: any) => {
        const orig = items.find(x => x.id === String(it?.id));
        return {
          tradeId: String(it?.id ?? ''),
          title: String(it?.title ?? orig?.title ?? '').slice(0, 150),
          recommendedStrategy: LIQUIDATION_STRATEGIES.includes(String(it?.recommended_strategy) as any) ? String(it.recommended_strategy) : 'flash_sale',
          currentValueEur: Math.max(0, Math.round(Number(it?.current_value_eur ?? orig?.currentValue ?? 0))),
          recommendedPriceEur: Math.max(0, Math.round(Number(it?.recommended_price_eur ?? 0))),
          discountPct: Math.round(Number(it?.discount_pct ?? 0) * 10) / 10,
          expectedRecoveryEur: Math.round(Number(it?.expected_recovery_eur ?? 0)),
          recoveryRatePct: Math.max(0, Math.min(100, Number(it?.recovery_rate_pct ?? 50))),
          expectedLossEur: Math.round(Number(it?.expected_loss_eur ?? 0)),
          bestChannel: (CHANNELS as readonly string[]).includes(String(it?.best_channel)) ? String(it.best_channel) : 'bolha',
          bestTiming: String(it?.best_timing ?? '').slice(0, 150),
          expectedDaysToSell: Math.max(1, Number(it?.expected_days_to_sell ?? 7)),
          reasoning: String(it?.reasoning ?? '').slice(0, 250),
          priority: (PRIORITIES as readonly string[]).includes(String(it?.priority)) ? String(it.priority) : 'medium',
        };
      }),
    strategies: (parsed?.strategies || []).slice(0, 10).map((s: any) => ({
      strategy: LIQUIDATION_STRATEGIES.includes(String(s?.strategy) as any) ? String(s.strategy) : 'flash_sale',
      description: String(s?.description ?? '').slice(0, 250),
      bestForCategory: String(s?.best_for_category ?? '').slice(0, 150),
      bestForDaysHeldRange: String(s?.best_for_days_held_range ?? '').slice(0, 100),
      expectedRecoveryRatePct: Math.max(0, Math.min(100, Number(s?.expected_recovery_rate_pct ?? 50))),
      timeToLiquidateDays: Math.max(1, Number(s?.time_to_liquidate_days ?? 7)),
      implementationEffort: (EFFORTS as readonly string[]).includes(String(s?.implementation_effort)) ? String(s.implementation_effort) : 'medium',
    })),
    channels: (parsed?.channels || []).slice(0, 5).map((c: any) => ({
      channel: (CHANNELS as readonly string[]).includes(String(c?.channel)) ? String(c.channel) : 'bolha',
      itemsRecommended: Math.max(0, Number(c?.items_recommended ?? 0)),
      avgRecoveryRatePct: Math.max(0, Math.min(100, Number(c?.avg_recovery_rate_pct ?? 50))),
      feePct: Math.round(Number(c?.fee_pct ?? 0)),
      netRecoveryEur: Math.round(Number(c?.net_recovery_eur ?? 0)),
      bestForStrategy: String(c?.best_for_strategy ?? '').slice(0, 150),
    })),
    timeline: (parsed?.timeline || []).slice(0, 4).map((t: any) => ({
      week: Math.max(1, Math.min(4, Number(t?.week ?? 1))),
      itemsToLiquidate: Math.max(0, Number(t?.items_to_liquidate ?? 0)),
      strategyFocus: String(t?.strategy_focus ?? '').slice(0, 150),
      expectedRecoveryEur: Math.round(Number(t?.expected_recovery_eur ?? 0)),
      expectedLossEur: Math.round(Number(t?.expected_loss_eur ?? 0)),
      actions: (t?.actions || []).slice(0, 5).map((a: any) => String(a).slice(0, 150)),
    })),
    bundles: (parsed?.bundles || [])
      .filter((b: any) => (b?.item_ids || []).some((id: any) => validIds.has(String(id))))
      .slice(0, 8)
      .map((b: any) => ({
        bundleName: String(b?.bundle_name ?? '').slice(0, 100),
        itemIds: (b?.item_ids || []).filter((id: any) => validIds.has(String(id))).slice(0, 8).map((id: any) => String(id).slice(0, 50)),
        individualValueEur: Math.max(0, Math.round(Number(b?.individual_value_eur ?? 0))),
        bundlePriceEur: Math.max(0, Math.round(Number(b?.bundle_price_eur ?? 0))),
        discountPct: Math.round(Number(b?.discount_pct ?? 0) * 10) / 10,
        expectedRecoveryEur: Math.round(Number(b?.expected_recovery_eur ?? 0)),
        targetBuyer: String(b?.target_buyer ?? '').slice(0, 150),
      })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      priority: (PRIORITIES as readonly string[]).includes(String(r?.priority)) ? String(r.priority) : 'medium',
      expectedRecoveryEur: Math.round(Number(r?.expected_recovery_eur ?? 0)),
      itemsAffected: Math.max(0, Number(r?.items_affected ?? 0)),
      implementationDays: Math.max(1, Number(r?.implementation_days ?? 1)),
    })),
    summary: {
      totalItemsToLiquidate: items.length,
      totalCostEur: Math.round(Number(parsed?.summary?.total_cost_eur ?? items.reduce((s, i) => s + i.cost, 0))),
      totalCurrentValueEur: Math.round(Number(parsed?.summary?.total_current_value_eur ?? items.reduce((s, i) => s + i.currentValue, 0))),
      totalExpectedRecoveryEur: Math.round(Number(parsed?.summary?.total_expected_recovery_eur ?? 0)),
      totalExpectedLossEur: Math.round(Number(parsed?.summary?.total_expected_loss_eur ?? 0)),
      avgRecoveryRatePct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_recovery_rate_pct ?? 50))),
      bestStrategyOverall: LIQUIDATION_STRATEGIES.includes(String(parsed?.summary?.best_strategy_overall) as any) ? String(parsed.summary.best_strategy_overall) : 'flash_sale',
      bestChannelOverall: (CHANNELS as readonly string[]).includes(String(parsed?.summary?.best_channel_overall)) ? String(parsed.summary.best_channel_overall) : 'bolha',
      biggestLossItem: String(parsed?.summary?.biggest_loss_item ?? '').slice(0, 200),
      quickestWin: String(parsed?.summary?.quickest_win ?? '').slice(0, 200),
      liquidationEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.liquidation_efficiency_score ?? 50))),
    },
  };
}
