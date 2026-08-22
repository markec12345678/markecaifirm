// v6.8 / v8.95.6-profit: AI Profit Forecast — AI napove pričakovani dobiček za naslednji mesec
// Refaktoriran z withAiRoute helperjem (v8.95.6-profit) + enforceBudget guard.
//
// POST /api/ai/profit-forecast
// Body: { months?: number (default 1) }
// Returns: { ok, forecast: { expectedProfit, confidence, scenarios, factors, recommendation } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface ProfitForecastInput {
  months: number;
}

export const POST = withAiRoute<ProfitForecastInput>({
  endpoint: '/api/ai/profit-forecast',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { months: Math.min(3, Math.max(1, body?.months ?? 1)) };
  },

  // No validateInput — months ima clamp default
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { months } = input;

    // Gather historical data
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);

    const [soldTrades, heldTrades, listings, monitors] = await Promise.all([
      db.trade.findMany({
        where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: sixMonthsAgo } },
        select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true, category: true, title: true },
      }),
      db.trade.findMany({
        where: { status: 'held' },
        select: { buyPrice: true, buyFees: true, title: true, category: true, buyDate: true, listing: { select: { aiEstimatedValue: true } } },
      }),
      db.listing.count({
        where: { firstSeenAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, aiVerdict: 'PRILIKA' },
      }),
      db.monitor.count({ where: { isActive: true } }),
    ]);

    // Monthly profit history
    const monthlyProfits = buildMonthlyProfits(soldTrades, now);

    // Calculate trends
    const avgMonthlyProfit = monthlyProfits.reduce((s, m) => s + m.profit, 0) / Math.max(1, monthlyProfits.length);
    const lastMonth = monthlyProfits[monthlyProfits.length - 1];
    const prevMonth = monthlyProfits[monthlyProfits.length - 2];

    // Trend direction
    const trendPct = prevMonth && prevMonth.profit !== 0
      ? Math.round(((lastMonth.profit - prevMonth.profit) / Math.abs(prevMonth.profit)) * 100)
      : 0;

    // Held inventory potential
    const heldPotential = heldTrades.reduce((s, t) => {
      const estSell = t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.15);
      return s + (estSell - t.buyPrice - (t.buyFees ?? 0) - estSell * 0.1);
    }, 0);

    // Pipeline: active monitors × avg listings per monitor × avg conversion rate
    const avgListingsPerMonitor = monitors > 0 ? listings / monitors : 0;
    const conversionRate = soldTrades.length > 0 && listings > 0 ? soldTrades.length / (listings * 6) : 0.05;
    const expectedNewOpportunities = Math.round(avgListingsPerMonitor * conversionRate * months * 4);

    const prompt = buildPrompt(monthlyProfits, avgMonthlyProfit, trendPct, heldTrades.length, heldPotential, monitors, listings, expectedNewOpportunities, months);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const forecast = transformForecast(parsed, avgMonthlyProfit, months);

    return apiOk({
      ok: true,
      forecast,
      historicalData: {
        monthlyProfits,
        avgMonthlyProfit: Math.round(avgMonthlyProfit),
        trendPct,
        heldPotential: Math.round(heldPotential),
        heldCount: heldTrades.length,
        activeMonitors: monitors,
        recentPrilikaCount: listings,
        expectedNewOpportunities,
        soldTradesCount: soldTrades.length,
      },
      months,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface SoldTradeRow {
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  buyDate: Date | null;
  category: string | null;
  title: string;
}

interface HeldTradeRow {
  buyPrice: number;
  buyFees: number | null;
  title: string;
  category: string | null;
  buyDate: Date;
  listing: { aiEstimatedValue: number | null } | null;
}

interface MonthlyProfit {
  month: string;
  profit: number;
  count: number;
}

/**
 * Build monthly profit history za zadnjih 6 mesecev (IDENTIČNO originalu v6.8).
 */
function buildMonthlyProfits(soldTrades: SoldTradeRow[], now: Date): MonthlyProfit[] {
  const monthlyProfits: MonthlyProfit[] = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const monthTrades = soldTrades.filter(t => t.sellDate! >= start && t.sellDate! < end);
    const profit = monthTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
    monthlyProfits.push({
      month: start.toISOString().slice(0, 7),
      profit: Math.round(profit),
      count: monthTrades.length,
    });
  }
  return monthlyProfits;
}

/**
 * Build AI prompt za profit forecast (besedilo IDENTIČNO originalu v6.8).
 */
function buildPrompt(
  monthlyProfits: MonthlyProfit[],
  avgMonthlyProfit: number,
  trendPct: number,
  heldCount: number,
  heldPotential: number,
  monitors: number,
  listings: number,
  expectedNewOpportunities: number,
  months: number,
): string {
  return `Si ekspert za napovedovanje dobička pri preprodaji na slovenskih oglasih.
Napovej pričakovani dobiček za naslednjih ${months} mesec(-ev).

Zgodovinski podatki (zadnjih 6 mesecev):
${monthlyProfits.map(m => `${m.month}: ${m.profit}€ (${m.count} prodaj)`).join('\n')}

Povprečni mesečni dobiček: ${Math.round(avgMonthlyProfit)}€
Trend (zadnji mesec vs prejšnji): ${trendPct > 0 ? '+' : ''}${trendPct}%
Trenutno v skladišču: ${heldCount} itemov, potencialni dobiček: ${Math.round(heldPotential)}€
Aktivni monitorji: ${monitors}
PRILIKA oglasov v zadnjih 30 dneh: ${listings}
Pričakovane nove priložnosti: ${expectedNewOpportunities}

Generiraj:
1. expected_profit (EUR za ${months} mesec(-ev))
2. confidence (0-100)
3. Scenariji: optimistic, realistic, pessimistic (vsak z profit in probability)
4. Ključni faktorji ki vplivajo na napoved
5. Priporočilo za uporabnika

Odgovori LE z JSON:
{
  "expected_profit": <number>,
  "confidence": <0-100>,
  "scenarios": {
    "optimistic": { "profit": <number>, "probability": <0-100> },
    "realistic": { "profit": <number>, "probability": <0-100> },
    "pessimistic": { "profit": <number>, "probability": <0-100> }
  },
  "factors": ["<faktor1>", "<faktor2>", "<faktor3>"],
  "recommendation": "<priporočilo v slovenščini, max 200 znakov>"
}`;
}

/**
 * Transform AI JSON v forecast rezultat. Clamp/slice logika IDENTIČNA originalu v6.8.
 */
function transformForecast(parsed: any, avgMonthlyProfit: number, months: number): any {
  return {
    expectedProfit: Number(parsed?.expected_profit ?? Math.round(avgMonthlyProfit * months)),
    confidence: Math.min(100, Math.max(0, parseInt(parsed?.confidence, 10) || 50)),
    scenarios: {
      optimistic: { profit: Number(parsed?.scenarios?.optimistic?.profit ?? Math.round(avgMonthlyProfit * months * 1.3)), probability: parseInt(parsed?.scenarios?.optimistic?.probability, 10) || 25 },
      realistic: { profit: Number(parsed?.scenarios?.realistic?.profit ?? Math.round(avgMonthlyProfit * months)), probability: parseInt(parsed?.scenarios?.realistic?.probability, 10) || 50 },
      pessimistic: { profit: Number(parsed?.scenarios?.pessimistic?.profit ?? Math.round(avgMonthlyProfit * months * 0.6)), probability: parseInt(parsed?.scenarios?.pessimistic?.probability, 10) || 25 },
    },
    factors: Array.isArray(parsed?.factors) ? parsed.factors.slice(0, 5).map((f: any) => String(f).slice(0, 200)) : [],
    recommendation: String(parsed?.recommendation ?? '').slice(0, 300),
  };
}
