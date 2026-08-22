// v7.47 / v8.95.6-other: Tax-Aware Selling Advisor — optimiziraj kdaj prodati za min davčni breme.
// Refaktoriran z withAiRoute helperjem (v8.95.6-other) + enforceBudget guard
// (konsistentno z vsemi v8.94.x / v8.95.x migracijami — endpoint ne kliče AI
// providerja, je deterministic; vendar ohranjamo guard za konsistentnost).
//
// Slovenian tax: 5000€ neoporečno, 40% nad.
// Strategija: če si blizu 5000€, prodi najprej izgubne (offset gains).
// Če si preko, zadrži profitable za naslednje leto, prodi losing za tax offset.
//
// GET /api/ai/tax-aware-selling

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Input {}

interface SoldTradeRow {
  id: string;
  title: string;
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  category: string | null;
}

interface HeldTradeRow {
  id: string;
  title: string;
  buyPrice: number;
  buyDate: Date;
  category: string | null;
  listing: { aiEstimatedValue: number | null } | null;
}

interface RealizedRow {
  id: string;
  title: string;
  category: string | null;
  profit: number;
  sellDate: Date | null;
}

interface HeldPotentialRow {
  id: string;
  title: string;
  buyPrice: number;
  estValue: number;
  potentialProfit: number;
  isProfitable: boolean;
  daysHeld: number;
}

interface SellPriorityRow {
  tradeId: string;
  title: string;
  reason: string;
  urgency: 'high' | 'medium' | 'low';
}

const TAX_FREE_ALLOWANCE = 5000;
const TAX_RATE = 0.40;

export const GET = withAiRoute<Input>({
  endpoint: '/api/ai/tax-aware-selling',
  maxDuration: 90,
  enforceBudget: true, // v8.95.6-other: budget guard (konsistentno z vsemi AI route-i)
  method: 'GET',

  parseBody: async () => ({}),

  // Brez validateInput — endpoint nima inputa

  handler: async (_input, ctx: AiRouteContext) => {
    const { db } = ctx;

    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
    const daysLeftInYear = Math.ceil((yearEnd.getTime() - now.getTime()) / 86400000);

    // This year's sold trades
    const soldThisYear = await db.trade.findMany({
      where: { status: 'sold', sellDate: { gte: yearStart, not: null } },
      select: { id: true, title: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, category: true },
    });

    // Currently held trades (not yet sold)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, buyPrice: true, buyDate: true, category: true,
        listing: { select: { aiEstimatedValue: true } },
      },
    });

    // Compute realized profit/loss
    const realized = computeRealized(soldThisYear);

    const totalRealizedProfit = realized.reduce((s, r) => s + r.profit, 0);
    const profitableSold = realized.filter(r => r.profit > 0);
    const losingSold = realized.filter(r => r.profit < 0);
    const totalGains = profitableSold.reduce((s, r) => s + r.profit, 0);
    const totalLosses = Math.abs(losingSold.reduce((s, r) => s + r.profit, 0));

    // Tax calculation
    const netGain = totalGains - totalLosses;
    const taxableBase = Math.max(0, netGain - TAX_FREE_ALLOWANCE);
    const currentTax = Math.round(taxableBase * TAX_RATE);
    const remainingAllowance = Math.max(0, TAX_FREE_ALLOWANCE - netGain);

    // Held trades potential profit/loss
    const heldPotential = computeHeldPotential(heldTrades, now);

    const heldProfitable = heldPotential.filter(h => h.isProfitable);
    const heldLosing = heldPotential.filter(h => !h.isProfitable);

    // Strategy
    const { strategy, actionItems, sellPriority } = buildStrategy({
      netGain,
      taxableBase,
      currentTax,
      daysLeftInYear,
      heldProfitable,
      heldLosing,
    });

    return apiOk({
      ok: true,
      year: now.getFullYear(),
      daysLeftInYear,
      realized: {
        totalProfit: Math.round(totalRealizedProfit),
        totalGains: Math.round(totalGains),
        totalLosses: Math.round(totalLosses),
        netGain: Math.round(netGain),
        profitableCount: profitableSold.length,
        losingCount: losingSold.length,
      },
      tax: {
        allowance: TAX_FREE_ALLOWANCE,
        remainingAllowance: Math.round(remainingAllowance),
        taxableBase: Math.round(taxableBase),
        rate: TAX_RATE * 100,
        currentTaxLiability: currentTax,
        effectiveRate: netGain > 0 ? Math.round((currentTax / netGain) * 100) : 0,
      },
      held: {
        total: heldTrades.length,
        profitable: heldProfitable.length,
        losing: heldLosing.length,
        potentialGains: Math.round(heldProfitable.reduce((s, h) => s + h.potentialProfit, 0)),
        potentialLosses: Math.round(Math.abs(heldLosing.reduce((s, h) => s + h.potentialProfit, 0))),
      },
      strategy,
      actionItems,
      sellPriority,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function computeRealized(soldThisYear: SoldTradeRow[]): RealizedRow[] {
  return soldThisYear.map(t => ({
    id: t.id, title: t.title, category: t.category,
    profit: (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0),
    sellDate: t.sellDate,
  }));
}

function computeHeldPotential(heldTrades: HeldTradeRow[], now: Date): HeldPotentialRow[] {
  return heldTrades.map(t => {
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.2);
    const potentialProfit = estValue - t.buyPrice;
    return {
      id: t.id, title: t.title, buyPrice: t.buyPrice,
      estValue, potentialProfit,
      isProfitable: potentialProfit > 0,
      daysHeld: Math.floor((now.getTime() - new Date(t.buyDate).getTime()) / 86400000),
    };
  });
}

interface StrategyInput {
  netGain: number;
  taxableBase: number;
  currentTax: number;
  daysLeftInYear: number;
  heldProfitable: HeldPotentialRow[];
  heldLosing: HeldPotentialRow[];
}

interface StrategyResult {
  strategy: string;
  actionItems: string[];
  sellPriority: SellPriorityRow[];
}

function buildStrategy(input: StrategyInput): StrategyResult {
  const { netGain, taxableBase, currentTax, daysLeftInYear, heldProfitable, heldLosing } = input;

  let strategy: string;
  let actionItems: string[] = [];
  let sellPriority: SellPriorityRow[] = [];

  if (netGain < TAX_FREE_ALLOWANCE) {
    // Still under tax-free allowance
    const spaceLeft = TAX_FREE_ALLOWANCE - netGain;
    strategy = `✅ Si še v neoporečnem območju (${netGain}€ od ${TAX_FREE_ALLOWANCE}€). ${spaceLeft}€ prostora do davka.`;

    if (heldProfitable.length > 0) {
      // Sell profitable items NOW while still tax-free
      actionItems.push(`💰 PRODAJ PROFITABLE item-e ZDAJ — še ${spaceLeft}€ neoporečnega prostora!`);
      sellPriority.push(...heldProfitable
        .sort((a, b) => b.potentialProfit - a.potentialProfit)
        .slice(0, 3)
        .map(h => ({ tradeId: h.id, title: h.title, reason: `+${h.potentialProfit}€ profit — še neoporečno`, urgency: 'high' as const })));
    }

    if (heldLosing.length > 0) {
      actionItems.push(`⚠️ Zadrži izgubne item-e za naslednje leto — ne prodajaj zdaj (ne zmanjšujejo davčne osnove ker si pod 5000€).`);
    }
  } else if (netGain < TAX_FREE_ALLOWANCE * 2) {
    // Just crossed tax threshold
    strategy = `⚠️ Si nad neoporečnim limitom (${netGain}€). Davek na ${taxableBase}€ = ${currentTax}€ (40%).`;

    if (heldLosing.length > 0) {
      actionItems.push(`📉 PRODAJ IZGUBNE item-e ZDAJ — zmanjšajo davčno osnovo!`);
      sellPriority.push(...heldLosing
        .sort((a, b) => a.potentialProfit - b.potentialProfit)
        .slice(0, 3)
        .map(h => ({ tradeId: h.id, title: h.title, reason: `${h.potentialProfit}€ izguba — zmanjša davek za ${Math.round(Math.abs(h.potentialProfit) * TAX_RATE)}€`, urgency: 'high' as const })));
    }

    if (heldProfitable.length > 0 && daysLeftInYear > 60) {
      actionItems.push(`💰 Zadrži profitable item-e za januar — prenesi dobiček v naslednje leto (novih 5000€ neoporečnega).`);
    } else if (heldProfitable.length > 0) {
      actionItems.push(`💰 Profitable item-i: prodi če potrebuješ cash, a upoštevaj 40% davek na dobiček.`);
    }
  } else {
    // Well above threshold
    strategy = `🔴 Visoko nad neoporečnim limitom (${netGain}€). Davek: ${currentTax}€. Maksimiziraj tax offset.`;

    if (heldLosing.length > 0) {
      actionItems.push(`📉 URGENTNO: prodaj VSE izgubne item-e — vsak € izgube prihrani 40 centov davka!`);
      sellPriority.push(...heldLosing
        .sort((a, b) => a.potentialProfit - b.potentialProfit)
        .map(h => ({ tradeId: h.id, title: h.title, reason: `Tax savings: ${Math.round(Math.abs(h.potentialProfit) * TAX_RATE)}€`, urgency: 'high' as const })));
    }

    actionItems.push(`💰 Zadrži profitable item-e do januar (naslednje leto = novih 5000€ neoporečnega).`);
  }

  // Year-end planning
  if (daysLeftInYear < 60) {
    actionItems.push(`🗓 ${daysLeftInYear} dni do konca leta — načrtuj katere item-e prodati letos (offset) in katere prenesti (profitable).`);
  }

  return { strategy, actionItems, sellPriority };
}
