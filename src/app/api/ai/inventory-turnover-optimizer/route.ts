// v7.49 / v8.95.8-refactor: Inventory Turnover Optimizer — kateri held item-i naj se prodajo PRVI?
// Refaktoriran z withAiRoute helperjem (v8.94).
//
// Razvrsti held inventar po "capital efficiency score":
// - Items z visokim ROI + dolg hold → PRODAJ PRVI (sprosti capital)
// - Items z nizkim ROI + kratek hold → ZADRŽI (bo še zraslo)
// - Items z negativnim ROI + dolg hold → LIKVIDIRAJ (reši kar se da)
//
// GET /api/ai/inventory-turnover-optimizer
// Returns: { ok, items, summary: { ... } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface TurnoverOptimizerInput {}

interface HeldTradeRow {
  id: string;
  title: string;
  buyPrice: number;
  buyDate: Date;
  category: string;
  flipChecklist: string | null;
  imageUrl: string | null;
  listing: { aiEstimatedValue: number | null; dealScore: number | null; aiVerdict: string | null } | null;
}

interface SoldTradeRow {
  category: string;
  buyPrice: number;
  sellPrice: number | null;
  buyDate: Date;
  sellDate: Date | null;
}

interface CatStat {
  avgHoldDays: number;
  avgRoiPct: number;
  count: number;
}

export const GET = withAiRoute<TurnoverOptimizerInput>({
  endpoint: '/api/ai/inventory-turnover-optimizer',
  maxDuration: 90,
  enforceBudget: true,
  method: 'GET',

  parseBody: async () => {
    return {} as TurnoverOptimizerInput;
  },

  handler: async (_input, ctx: AiRouteContext) => {
    const { db } = ctx;
    const now = Date.now();

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, buyPrice: true, buyDate: true,
        category: true, flipChecklist: true, imageUrl: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiVerdict: true } },
      },
      orderBy: { buyDate: 'asc' },
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, items: [], message: 'Skladišče je prazno.' });
    }

    // Get category avg turnover from sold history
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true },
    });

    const catStats = computeCategoryStats(soldTrades);
    const items = buildTurnoverItems(heldTrades, catStats, now);
    items.sort((a, b) => b.priorityScore - a.priorityScore);

    const summary = buildSummary(heldTrades, items);

    return apiOk({ ok: true, items, summary });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function computeCategoryStats(soldTrades: SoldTradeRow[]): Map<string, CatStat> {
  const catStats = new Map<string, CatStat>();
  for (const t of soldTrades) {
    const cat = (t.category || 'drugo').trim();
    const holdDays = (new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / 86400000;
    const roi = t.buyPrice > 0 ? ((t.sellPrice! - t.buyPrice) / t.buyPrice) * 100 : 0;
    const cur = catStats.get(cat) || { avgHoldDays: 0, avgRoiPct: 0, count: 0 };
    cur.avgHoldDays += holdDays;
    cur.avgRoiPct += roi;
    cur.count += 1;
    catStats.set(cat, cur);
  }
  catStats.forEach((v) => {
    if (v.count > 0) {
      v.avgHoldDays = Math.round(v.avgHoldDays / v.count);
      v.avgRoiPct = Math.round(v.avgRoiPct / v.count);
    }
  });
  return catStats;
}

interface TurnoverItem {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  estValue: number;
  potentialProfit: number;
  potentialRoiPct: number;
  daysHeld: number;
  expectedHoldDays: number;
  capitalCostEur: number;
  depreciationEur: number;
  totalCarryingCostEur: number;
  netProfitIfSoldNow: number;
  priorityScore: number;
  action: 'SELL_NOW' | 'SELL_SOON' | 'HOLD' | 'LIQUIDATE';
  reason: string;
  flipProgress: number;
}

function buildTurnoverItems(
  heldTrades: HeldTradeRow[],
  catStats: Map<string, CatStat>,
  now: number
): TurnoverItem[] {
  return heldTrades.map(t => {
    const daysHeld = Math.floor((now - new Date(t.buyDate).getTime()) / 86400000);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.2);
    const potentialProfit = estValue - t.buyPrice;
    const potentialRoiPct = t.buyPrice > 0 ? Math.round((potentialProfit / t.buyPrice) * 100) : 0;
    const catStat = catStats.get((t.category || 'drugo').trim());
    const expectedHoldDays = catStat?.avgHoldDays ?? 30;
    const expectedRoiPct = catStat?.avgRoiPct ?? 20;

    // Capital cost: buyPrice * 12% annual / 365 * daysHeld
    const capitalCostEur = Math.round(t.buyPrice * 0.12 / 365 * daysHeld * 100) / 100;
    // Depreciation: 3%/month
    const depreciationEur = Math.round(t.buyPrice * 0.03 * (daysHeld / 30) * 100) / 100;
    const totalCarryingCostEur = Math.round((capitalCostEur + depreciationEur) * 100) / 100;

    // Net value if sold now = estValue - carrying cost
    const netValueIfSoldNow = estValue - totalCarryingCostEur;
    const netProfitIfSoldNow = Math.round((netValueIfSoldNow - t.buyPrice) * 100) / 100;

    // Priority score (higher = sell first):
    // Factors:
    // - Days held vs expected hold (overdue = higher priority)
    // - Capital tied (higher buyPrice = more capital = higher priority)
    // - Depreciation rate (items losing value fast = sell sooner)
    // - ROI (high ROI items = sell to realize profit, low ROI = hold if short)
    const overdueFactor = daysHeld > expectedHoldDays ? (daysHeld - expectedHoldDays) / expectedHoldDays : 0;
    const capitalFactor = t.buyPrice / 100; // 100€ = 1 point
    const depreciationFactor = totalCarryingCostEur / 10; // 10€ carrying = 1 point
    const roiFactor = potentialRoiPct > 30 ? 2 : potentialRoiPct > 15 ? 1 : 0; // high ROI = sell to lock profit

    const priorityScore = Math.round((overdueFactor * 30 + capitalFactor + depreciationFactor + roiFactor * 10) * 10) / 10;

    // Action
    let action: 'SELL_NOW' | 'SELL_SOON' | 'HOLD' | 'LIQUIDATE';
    let reason = '';
    if (potentialProfit < 0 && daysHeld > 45) {
      action = 'LIQUIDATE';
      reason = `Negativni ROI + ${daysHeld}d — likvidiraj za ${t.buyPrice}€ (reši capital)`;
    } else if (daysHeld > 60 || (daysHeld > expectedHoldDays * 1.5)) {
      action = 'SELL_NOW';
      reason = `${daysHeld}d (pričakovano ${expectedHoldDays}d) — prodaj ZDAJ, carrying cost ${totalCarryingCostEur}€`;
    } else if (daysHeld > 30 || priorityScore > 15) {
      action = 'SELL_SOON';
      reason = `${daysHeld}d, priority ${priorityScore} — pripravi za prodajo`;
    } else {
      action = 'HOLD';
      reason = `${daysHeld}d, še freshe — počakaj na optimalno ceno`;
    }

    return {
      tradeId: t.id,
      title: t.title,
      category: t.category || 'drugo',
      buyPrice: t.buyPrice,
      estValue,
      potentialProfit: Math.round(potentialProfit),
      potentialRoiPct,
      daysHeld,
      expectedHoldDays,
      capitalCostEur,
      depreciationEur,
      totalCarryingCostEur,
      netProfitIfSoldNow,
      priorityScore,
      action,
      reason,
      flipProgress: (() => { try { return JSON.parse(t.flipChecklist || '[]').length; } catch { return 0; } })(),
    };
  });
}

function buildSummary(heldTrades: HeldTradeRow[], items: TurnoverItem[]) {
  const totalCapitalTied = heldTrades.reduce((s, t) => s + t.buyPrice, 0);
  const totalCarryingCost = items.reduce((s, i) => s + i.totalCarryingCostEur, 0);
  const sellNowCount = items.filter(i => i.action === 'SELL_NOW').length;
  const liquidateCount = items.filter(i => i.action === 'LIQUIDATE').length;
  const holdCount = items.filter(i => i.action === 'HOLD').length;

  // Capital efficiency: if we sell all SELL_NOW + LIQUIDATE items, how much capital freed?
  const sellItems = items.filter(i => i.action === 'SELL_NOW' || i.action === 'LIQUIDATE');
  const capitalFreed = sellItems.reduce((s, i) => s + i.estValue, 0);

  return {
    totalItems: items.length,
    totalCapitalTied: Math.round(totalCapitalTied),
    totalCarryingCost: Math.round(totalCarryingCost),
    sellNow: sellNowCount,
    sellSoon: items.filter(i => i.action === 'SELL_SOON').length,
    hold: holdCount,
    liquidate: liquidateCount,
    capitalFreedIfSold: Math.round(capitalFreed),
    recommendation: sellNowCount + liquidateCount > 0
      ? `🔑 AKCIJA: Prodaj ${sellNowCount + liquidateCount} item-ov ZDAJ — sprosti ${Math.round(capitalFreed)}€ capital!`
      : `✅ Vsi item-i so v optimalnem obdobju — ni naglice.`,
  };
}
