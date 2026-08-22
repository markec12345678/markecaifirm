// v6.9 / v8.94-refactor: AI Portfolio Rebalancing — AI predlaga kako prerazporediti investicije
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/rebalance
// Body: { totalBudget?: number }
// Returns: { ok, actions: Array<{ action, category, current, suggested, reason }>, strategy }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface RebalanceInput {
  totalBudget: number;
}

export const POST = withAiRoute<RebalanceInput>({
  endpoint: '/api/ai/rebalance',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { totalBudget: Number(body?.totalBudget) || 0 };
  },

  // No validateInput — totalBudget defaults to 0

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { totalBudget } = input;

    // Get current portfolio state
    const [heldTrades, soldTrades] = await Promise.all([
      db.trade.findMany({
        where: { status: 'held' },
        select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
          listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      }),
      db.trade.findMany({
        where: { status: 'sold', sellPrice: { not: null } },
        select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      }),
    ]);

    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return apiOk({ ok: true, actions: [], message: 'Ni tradeov za analizo.' });
    }

    // Current allocation
    const currentByCat: Record<string, { invested: number; count: number }> = {};
    for (const t of heldTrades) {
      const cat = t.category || 'drugo';
      if (!currentByCat[cat]) currentByCat[cat] = { invested: 0, count: 0 };
      currentByCat[cat].invested += t.buyPrice + (t.buyFees ?? 0);
      currentByCat[cat].count++;
    }

    // Performance by category
    const perfByCat = computePerfByCat(soldTrades);

    const totalInvested = Object.values(currentByCat).reduce((s, c) => s + c.invested, 0);

    const prompt = buildPrompt({ currentByCat, perfByCat, totalInvested, totalBudget });
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const actions = (parsed?.actions || []).map((a: any) => ({
      category: String(a?.category ?? ''),
      action: String(a?.action ?? 'hold'),
      currentPct: Number(a?.current_pct ?? 0),
      suggestedPct: Number(a?.suggested_pct ?? 0),
      reason: String(a?.reason ?? '').slice(0, 200),
    }));

    return apiOk({
      ok: true,
      actions,
      strategy: String(parsed?.strategy ?? '').slice(0, 500),
      currentAllocation: Object.entries(currentByCat).map(([cat, c]) => ({
        category: cat, invested: c.invested, count: c.count, pct: Math.round((c.invested / Math.max(1, totalInvested)) * 100),
      })),
      performance: Object.entries(perfByCat).map(([cat, p]) => ({ category: cat, ...p })),
      totalInvested,
      totalBudget,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface SoldTradeRow {
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  buyDate: Date;
}

function computePerfByCat(soldTrades: SoldTradeRow[]): Record<string, { sold: number; profit: number; roi: number; avgDays: number }> {
  const perfByCat: Record<string, { sold: number; profit: number; roi: number; avgDays: number }> = {};
  for (const t of soldTrades) {
    const cat = t.category || 'drugo';
    if (!perfByCat[cat]) perfByCat[cat] = { sold: 0, profit: 0, roi: 0, avgDays: 0 };
    perfByCat[cat].sold++;
    const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
    perfByCat[cat].profit += profit;
    if (t.sellDate && t.buyDate) {
      perfByCat[cat].avgDays += Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
    }
  }
  for (const cat of Object.keys(perfByCat)) {
    const s = perfByCat[cat];
    const totalCost = soldTrades.filter(t => (t.category || 'drugo') === cat).reduce((sum, t) => sum + t.buyPrice + (t.buyFees ?? 0), 0);
    s.roi = totalCost > 0 ? Math.round((s.profit / totalCost) * 100) : 0;
    s.avgDays = s.sold > 0 ? Math.round(s.avgDays / s.sold) : 0;
  }
  return perfByCat;
}

interface PromptData {
  currentByCat: Record<string, { invested: number; count: number }>;
  perfByCat: Record<string, { sold: number; profit: number; roi: number; avgDays: number }>;
  totalInvested: number;
  totalBudget: number;
}

function buildPrompt(d: PromptData): string {
  return `Si ekspert za upravljanje portfolia pri preprodaji na slovenskih oglasih.
Predlagaj rebalancing portfolia za maksimalni dobiček in zmanjšanje tveganja.

Trenutna alokacija (held):
${Object.entries(d.currentByCat).map(([cat, c]) => `- ${cat}: ${c.invested}€ (${c.count} itemov, ${Math.round((c.invested / Math.max(1, d.totalInvested)) * 100)}%)`).join('\n')}

Zgodovinska uspešnost (sold):
${Object.entries(d.perfByCat).map(([cat, p]) => `- ${cat}: ${p.sold} prodaj, ${p.profit}€ dobička, ${p.roi}% ROI, ${p.avgDays}d povp. prodaja`).join('\n')}

Skupna investicija: ${d.totalInvested}€
${d.totalBudget > 0 ? `Na voljo novih sredstev: ${d.totalBudget}€` : ''}

Pravila:
1. Kategorije z ROI > 30% — povečaj alokacijo
2. Kategorije z ROI < 0% — zmanjšaj ali zapusti
3. Kategorije z > 30d povp. prodaja — zmanjšaj (nizka likvidnost)
4. Diverzifikacija: nobena kategorija naj ne presega 50% portfolia
5. Rezerviraj 15% za nove priložnosti

Za vsako kategorijo predlagaj: action (buy_more/reduce/hold/exit), target allocation %, reason.

Odgovori LE z JSON:
{
  "strategy": "<splošna strategija, max 200 znakov>",
  "actions": [
    {
      "category": "<kategorija>",
      "action": "<buy_more|reduce|hold|exit>",
      "current_pct": <number>,
      "suggested_pct": <number>,
      "reason": "<kratek razlog, max 100 znakov>"
    }
  ]
}`;
}
