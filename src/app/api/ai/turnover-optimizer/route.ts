// v6.27 / v8.96.0-batch3: AI Inventory Turnover Optimizer — optimizira hitrost obrtnosti inventarja
// Refaktoriran z withAiRoute helperjem (v8.96) + enforceBudget guard.
//
// POST /api/ai/turnover-optimizer
// Body: {}
// Returns: { ok, analysis: { currentTurnover, targetTurnover, items: [], recommendations }, insights, summary }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface TurnoverOptimizerInput {}

export const POST = withAiRoute<TurnoverOptimizerInput>({
  endpoint: '/api/ai/turnover-optimizer',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {} as TurnoverOptimizerInput;
  },

  // No validateInput — body je ignored
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null }, sellPrice: { not: null } },
      select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true,
        buyDate: true, sellDate: true },
      take: 300,
    });

    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return apiOk({ ok: true, analysis: null, message: 'Ni podatkov za optimizacijo obrtnosti.' });
    }

    // Izračunaj turnover metrics
    const totalHeldValue = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalSoldRevenue = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0), 0);
    const avgDaysToSell = soldTrades.length > 0
      ? Math.round(soldTrades.reduce((s, t) => {
          if (t.sellDate && t.buyDate) return s + (t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000);
          return s;
        }, 0) / soldTrades.length) : 30;

    // Turnover ratio = sold / held (letni)
    const annualizedSold = soldTrades.length * (365 / Math.max(1, avgDaysToSell));
    const currentTurnoverRatio = heldTrades.length > 0 ? annualizedSold / heldTrades.length : 0;

    // Per kategorija turnover
    const catTurnover = computeCatTurnover(heldTrades, soldTrades);

    const items = heldTrades.map(t => ({
      id: t.id, title: t.title, category: t.category || 'drugo',
      cost: t.buyPrice + (t.buyFees ?? 0),
      estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000)),
    }));

    const catStr = Object.entries(catTurnover)
      .sort(([, a], [, b]) => b.profit - a.profit)
      .map(([cat, c]) => `- ${cat}: held=${c.heldCount}, sold=${c.soldCount}, povp. ${c.avgDays}d, ${c.profit}€ dobička`)
      .join('\n');

    const prompt = buildPrompt({
      heldCount: heldTrades.length,
      totalHeldValue,
      soldCount: soldTrades.length,
      avgDaysToSell,
      currentTurnoverRatio,
      catStr,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const validIds = new Set(items.map(i => i.id));
    const itemMap = new Map(items.map(i => [i.id, i]));

    const analysis = transformAnalysis(parsed, {
      currentTurnoverRatio, avgDaysToSell, totalSoldRevenue,
      items, validIds, itemMap,
    });

    return apiOk({ ok: true, analysis });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface HeldTradeRow {
  id: string; title: string; category: string | null; buyPrice: number; buyFees: number | null; buyDate: Date;
}
interface SoldTradeRow {
  category: string | null; buyPrice: number; buyFees: number | null; sellPrice: number | null; sellFees: number | null;
  buyDate: Date; sellDate: Date | null;
}
interface CatTurnoverStats { heldCount: number; soldCount: number; avgDays: number; profit: number; }

function computeCatTurnover(heldTrades: HeldTradeRow[], soldTrades: SoldTradeRow[]): Record<string, CatTurnoverStats> {
  const catTurnover: Record<string, CatTurnoverStats> = {};
  for (const t of heldTrades) {
    const cat = t.category || 'drugo';
    if (!catTurnover[cat]) catTurnover[cat] = { heldCount: 0, soldCount: 0, avgDays: 0, profit: 0 };
    catTurnover[cat].heldCount++;
  }
  for (const t of soldTrades) {
    const cat = t.category || 'drugo';
    if (!catTurnover[cat]) catTurnover[cat] = { heldCount: 0, soldCount: 0, avgDays: 0, profit: 0 };
    catTurnover[cat].soldCount++;
    catTurnover[cat].profit += (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
    if (t.sellDate && t.buyDate) catTurnover[cat].avgDays += Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
  }
  for (const cat of Object.keys(catTurnover)) {
    if (catTurnover[cat].soldCount > 0) catTurnover[cat].avgDays = Math.round(catTurnover[cat].avgDays / catTurnover[cat].soldCount);
  }
  return catTurnover;
}

interface PromptData {
  heldCount: number;
  totalHeldValue: number;
  soldCount: number;
  avgDaysToSell: number;
  currentTurnoverRatio: number;
  catStr: string;
}

function buildPrompt(d: PromptData): string {
  return `Si ekspert za upravljanje obrtnosti zalog (inventory turnover).
Optimiziraj hitrost obrtnosti inventarja za max dobiček.

TRENUTNO STANJE:
- Held itemov: ${d.heldCount} (skupna vrednost ${Math.round(d.totalHeldValue)}€)
- Prodanih (zgodovina): ${d.soldCount}
- Povp. čas do prodaje: ${d.avgDaysToSell} dni
- Trenutni turnover ratio: ${d.currentTurnoverRatio.toFixed(2)} (letni)

OBRTNOST PO KATEGORIJAH:
${d.catStr || '- Ni podatkov'}

Turnover pravila:
1. Visok turnover = hitro obrneš denar (dobro za cash flow)
2. Nizek turnover = denar vezan predolgo (slabo za ROI)
3. Optimalni turnover ratio: 4-8 na leto (item prodati v 45-90 dneh)
4. Kategorije z >90d povprečno prodajo → zmanjšaj nabavo
5. Kategorije z <30d povprečno prodajo → povečaj nabavo (hitro obrne)

Strategije optimizacije:
- "accelerate_slow": pospeši prodajo počasnih itemov (popust, bundle, dražba)
- "stock_fast": povečaj zalogo hitro-prodajnih kategorij
- "reduce_slow": zmanjšaj nabavo počasnih kategorij
- "exit_dead": likvidiraj mrtve iteme (>180d)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current_turnover_ratio": <number>,
  "target_turnover_ratio": <number>,
  "current_avg_days_to_sell": <number>,
  "target_avg_days_to_sell": <number>,
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "category": "<kategorija>",
      "days_held": <number>,
      "est_value_eur": <number>,
      "turnover_action": "<accelerate|hold|reduce_price|bundle|liquidate>",
      "suggested_price_eur": <number>,
      "expected_sell_time_days": <number>,
      "reasoning": "<max 80 znakov>"
    }
  ],
  "category_optimization": [
    {
      "category": "<kategorija>",
      "current_avg_days": <number>,
      "target_avg_days": <number>,
      "action": "<stock_up|maintain|reduce|exit>",
      "reasoning": "<max 80 znakov>"
    }
  ],
  "recommendations": [
    {
      "action": "<max 100 znakov>",
      "priority": "<high|medium|low>",
      "expected_impact_days": <number>
    }
  ],
  "summary": {
    "current_annual_revenue_eur": <number>,
    "projected_annual_revenue_eur": <number>,
    "improvement_pct": <number>,
    "cash_freed_eur": <number>,
    "items_to_accelerate": <number>,
    "items_to_liquidate": <number>
  }
}`;
}

interface ItemRow {
  id: string; title: string; category: string; cost: number; estValue: number; daysHeld: number;
}
interface TransformData {
  currentTurnoverRatio: number;
  avgDaysToSell: number;
  totalSoldRevenue: number;
  items: ItemRow[];
  validIds: Set<string>;
  itemMap: Map<string, ItemRow>;
}

function transformAnalysis(parsed: any, d: TransformData): {
  insights: string;
  currentTurnoverRatio: number;
  targetTurnoverRatio: number;
  currentAvgDaysToSell: number;
  targetAvgDaysToSell: number;
  items: any[];
  categoryOptimization: any[];
  recommendations: any[];
  summary: any;
} {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    currentTurnoverRatio: Math.round(Number(parsed?.current_turnover_ratio ?? d.currentTurnoverRatio) * 100) / 100,
    targetTurnoverRatio: Math.round(Number(parsed?.target_turnover_ratio ?? 6) * 100) / 100,
    currentAvgDaysToSell: Math.max(0, Number(parsed?.current_avg_days_to_sell ?? d.avgDaysToSell)),
    targetAvgDaysToSell: Math.max(0, Number(parsed?.target_avg_days_to_sell ?? 45)),
    items: (parsed?.items || []).filter((it: any) => d.validIds.has(String(it?.id ?? ''))).map((it: any) => {
      const orig = d.itemMap.get(String(it.id))!;
      return {
        tradeId: orig.id,
        title: orig.title,
        category: orig.category,
        daysHeld: orig.daysHeld,
        estValueEur: orig.estValue,
        turnoverAction: ['accelerate', 'hold', 'reduce_price', 'bundle', 'liquidate'].includes(String(it?.turnover_action))
          ? String(it.turnover_action) : 'hold',
        suggestedPriceEur: Math.max(0, Number(it?.suggested_price_eur ?? orig.estValue)),
        expectedSellTimeDays: Math.max(0, Number(it?.expected_sell_time_days ?? 14)),
        reasoning: String(it?.reasoning ?? '').slice(0, 200),
      };
    }),
    categoryOptimization: (parsed?.category_optimization || []).slice(0, 10).map((c: any) => ({
      category: String(c?.category ?? '').slice(0, 50),
      currentAvgDays: Math.max(0, Number(c?.current_avg_days ?? 0)),
      targetAvgDays: Math.max(0, Number(c?.target_avg_days ?? 0)),
      action: ['stock_up', 'maintain', 'reduce', 'exit'].includes(String(c?.action)) ? String(c.action) : 'maintain',
      reasoning: String(c?.reasoning ?? '').slice(0, 200),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 200),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      expectedImpactDays: Math.max(0, Number(r?.expected_impact_days ?? 0)),
    })),
    summary: {
      currentAnnualRevenueEur: Math.round(Number(parsed?.summary?.current_annual_revenue_eur ?? d.totalSoldRevenue)),
      projectedAnnualRevenueEur: Math.round(Number(parsed?.summary?.projected_annual_revenue_eur ?? 0)),
      improvementPct: Math.round(Number(parsed?.summary?.improvement_pct ?? 0)),
      cashFreedEur: Math.round(Number(parsed?.summary?.cash_freed_eur ?? 0)),
      itemsToAccelerate: Math.max(0, Number(parsed?.summary?.items_to_accelerate ?? 0)),
      itemsToLiquidate: Math.max(0, Number(parsed?.summary?.items_to_liquidate ?? 0)),
    },
  };
}
