// v6.43 / v8.95.5-deal: AI Inventory Cash Generator — generira cash iz inventarja z minimalno izgubo
// Refaktoriran z withAiRoute helperjem (v8.95.5-deal) + enforceBudget guard.
//
// POST /api/ai/cash-generator
// Body: { targetCash?: number }
// Returns: { ok, generator: { cashPlan, items: [], strategies, projected, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface CashGeneratorInput {
  targetCash: number;
}

export const POST = withAiRoute<CashGeneratorInput>({
  endpoint: '/api/ai/cash-generator',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { targetCash: Math.max(0, Number(body?.targetCash) || 0) };
  },

  // No validateInput — targetCash ima default 0
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { targetCash } = input;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 50,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, generator: null, message: 'Ni held tradeov za cash generation.' });
    }

    const items = mapItems(heldTrades);
    const totalValue = items.reduce((s, i) => s + i.estValue, 0);
    const totalCost = items.reduce((s, i) => s + i.cost, 0);

    const prompt = buildPrompt(items, totalValue, totalCost, targetCash);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const validIds = new Set(items.map(i => i.id));

    const generator = transformGenerator(parsed, validIds);

    return apiOk({ ok: true, generator, targetCash });
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
  listing: { aiEstimatedValue: number | null; dealScore: number | null } | null;
}

interface Item {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  profitIfSold: number;
  profitPct: number;
}

const URGENCIES = ['high', 'medium', 'low'] as const;
const STRATEGIES = ['fast_sale', 'bundle', 'flash', 'partial', 'staged', 'reserve', 'panic', 'selective'] as const;

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

/**
 * Map heldTrades v items array z cost/estValue/daysHeld/profit compute.
 * Logika IDENTIČNA originalu v6.43.
 */
function mapItems(heldTrades: HeldTradeRow[]): Item[] {
  return heldTrades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
    const profitIfSold = estValue - cost;
    const profitPct = cost > 0 ? Math.round((profitIfSold / cost) * 100) : 0;
    return { id: t.id, title: t.title, category: t.category || 'drugo', cost, estValue, daysHeld, profitIfSold, profitPct };
  });
}

/**
 * Build AI prompt za cash generation (besedilo IDENTIČNO originalu v6.43).
 */
function buildPrompt(items: Item[], totalValue: number, totalCost: number, targetCash: number): string {
  const itemsStr = items.slice(0, 20).map(i => `- [${i.id}] ${i.title} | ${i.category} | cost ${i.cost}€ | est ${i.estValue}€ | profit ${i.profitIfSold}€ (${i.profitPct}%) | ${i.daysHeld}d`).join('\n');

  return `Si AI cash generation strategist. Generiraj cash iz inventarja z minimalno izgubo dobička.

CILJ: ${targetCash > 0 ? `generiraj ${targetCash}€ cash` : 'maksimiziraj cash brez izgube dobička'}
SKUPna vrednost inventarja: ${Math.round(totalValue)}€ (nabavna ${Math.round(totalCost)}€)

INVENTAR:
${itemsStr}

Cash generation strategije:
1. FAST_SALE: prodaj visokovredne iteme z 5-10% popustom za hiter cash
2. BUNDLE_LIQUIDATION: bundle stalled iteme z 10-15% popustom
3. FLASH_SALE: 24-48h akcija na izbrane iteme (urgentnost)
4. PARTIAL_SELL: prodaj del inventarja, obdrži profitabilne
5. STAGED_SALE: prodaj v 3 valovih (danes, 7d, 14d)
6. RESERVE_SALE: prodaj samo items ki imajo > 20% profit marže
7. PANIC_SALE: likvidiraj vse z minimalnim popustom (samo če nujno)
8. SELECTIVE_LIQUIDATION: prodaj samo stalled/dead iteme, obdrži fresh

Prioriteta: minimalna izguba dobička pri maksimiranju cash flow.

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "cash_plan": [
    {
      "wave": <number 1-3>,
      "timing": "<max 50 znakov>",
      "items_to_sell": <number>,
      "expected_cash_eur": <number>,
      "avg_discount_pct": <number>,
      "profit_retained_pct": <number>,
      "items": [{"id": "<trade_id>", "title": "<naslov>", "sell_price_eur": <number>, "discount_pct": <number>, "profit_eur": <number>, "reason": "<max 60 znakov>"}]
    }
  ],
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "current_est_value_eur": <number>,
      "recommended_sell_price_eur": <number>,
      "discount_pct": <number>,
      "cash_generated_eur": <number>,
      "profit_retained_eur": <number>,
      "urgency": "<high|medium|low>",
      "strategy": "<fast_sale|bundle|flash|partial|staged|reserve|panic|selective>",
      "reasoning": "<max 80 znakov>"
    }
  ],
  "strategies": [
    { "strategy": "<ime>", "description": "<max 100 znakov>", "cash_generated_eur": <number>, "profit_lost_eur": <number>, "time_to_execute_days": <number>, "recommended": <boolean> }
  ],
  "projected": {
    "total_cash_generatable_eur": <number>,
    "total_profit_retained_eur": <number>,
    "total_profit_lost_eur": <number>,
    "profit_retention_pct": <number>,
    "items_remaining_after": <number>,
    "time_to_generate_cash_days": <number>
  },
  "summary": {
    "cash_generation_efficiency": <number 0-100>,
    "best_strategy": "<ime>",
    "fastest_cash_option_eur": <number>,
    "highest_profit_option_eur": <number>,
    "recommended_balance_eur": <number>
  }
}`;
}

/**
 * Transform AI JSON v generator objekt. Clamp/slice logika IDENTIČNA originalu v6.43.
 */
function transformGenerator(parsed: any, validIds: Set<string>): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    cashPlan: (parsed?.cash_plan || []).slice(0, 3).map((w: any) => ({
      wave: Math.max(1, Number(w?.wave ?? 1)), timing: String(w?.timing ?? '').slice(0, 80),
      itemsToSell: Math.max(0, Number(w?.items_to_sell ?? 0)),
      expectedCashEur: Math.round(Number(w?.expected_cash_eur ?? 0)),
      avgDiscountPct: Math.round(Number(w?.avg_discount_pct ?? 0)),
      profitRetainedPct: Math.round(Number(w?.profit_retained_pct ?? 0)),
      items: (w?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).slice(0, 10).map((it: any) => ({
        id: String(it?.id ?? ''), title: String(it?.title ?? '').slice(0, 100),
        sellPriceEur: Math.max(0, Number(it?.sell_price_eur ?? 0)),
        discountPct: Math.round(Number(it?.discount_pct ?? 0)),
        profitEur: Math.round(Number(it?.profit_eur ?? 0)),
        reason: String(it?.reason ?? '').slice(0, 100),
      })),
    })),
    items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).map((it: any) => ({
      tradeId: String(it?.id ?? ''), title: String(it?.title ?? '').slice(0, 100),
      currentEstValueEur: Math.max(0, Number(it?.current_est_value_eur ?? 0)),
      recommendedSellPriceEur: Math.max(0, Number(it?.recommended_sell_price_eur ?? 0)),
      discountPct: Math.round(Number(it?.discount_pct ?? 0)),
      cashGeneratedEur: Math.round(Number(it?.cash_generated_eur ?? 0)),
      profitRetainedEur: Math.round(Number(it?.profit_retained_eur ?? 0)),
      urgency: includes(URGENCIES, String(it?.urgency)) ? String(it.urgency) : 'medium',
      strategy: includes(STRATEGIES, String(it?.strategy)) ? String(it.strategy) : 'fast_sale',
      reasoning: String(it?.reasoning ?? '').slice(0, 200),
    })),
    strategies: (parsed?.strategies || []).slice(0, 6).map((s: any) => ({
      strategy: String(s?.strategy ?? '').slice(0, 80), description: String(s?.description ?? '').slice(0, 200),
      cashGeneratedEur: Math.round(Number(s?.cash_generated_eur ?? 0)),
      profitLostEur: Math.round(Number(s?.profit_lost_eur ?? 0)),
      timeToExecuteDays: Math.max(0, Number(s?.time_to_execute_days ?? 0)),
      recommended: Boolean(s?.recommended ?? false),
    })),
    projected: {
      totalCashGeneratableEur: Math.round(Number(parsed?.projected?.total_cash_generatable_eur ?? 0)),
      totalProfitRetainedEur: Math.round(Number(parsed?.projected?.total_profit_retained_eur ?? 0)),
      totalProfitLostEur: Math.round(Number(parsed?.projected?.total_profit_lost_eur ?? 0)),
      profitRetentionPct: Math.round(Number(parsed?.projected?.profit_retention_pct ?? 0)),
      itemsRemainingAfter: Math.max(0, Number(parsed?.projected?.items_remaining_after ?? 0)),
      timeToGenerateCashDays: Math.max(0, Number(parsed?.projected?.time_to_generate_cash_days ?? 0)),
    },
    summary: {
      cashGenerationEfficiency: Math.max(0, Math.min(100, Number(parsed?.summary?.cash_generation_efficiency ?? 50))),
      bestStrategy: String(parsed?.summary?.best_strategy ?? '').slice(0, 80),
      fastestCashOptionEur: Math.round(Number(parsed?.summary?.fastest_cash_option_eur ?? 0)),
      highestProfitOptionEur: Math.round(Number(parsed?.summary?.highest_profit_option_eur ?? 0)),
      recommendedBalanceEur: Math.round(Number(parsed?.summary?.recommended_balance_eur ?? 0)),
    },
  };
}
