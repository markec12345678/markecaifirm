// v6.35 / v8.96.0-refactor: AI Listing Velocity Tracker — sledi hitrosti oglasov od objave do prodaje
// Refaktoriran z withAiRoute helperjem (v8.96.0) + enforceBudget guard.
//
// POST /api/ai/listing-velocity
// Body: {}
// Returns: { ok, velocity: { items, velocityCurve, categoryBenchmarks, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ListingVelocityInput {}

export const POST = withAiRoute<ListingVelocityInput>({
  endpoint: '/api/ai/listing-velocity',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — telo zahtevka je prazno

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null }, sellPrice: { not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true,
        sellPrice: true, sellFees: true, buyDate: true, sellDate: true },
      take: 300,
      orderBy: { sellDate: 'desc' },
    });

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 50,
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, velocity: null, message: 'Ni prodaj za velocity analizo.' });
    }

    const soldWithMetrics = computeSoldWithMetrics(soldTrades);
    const catVelocity = computeCategoryVelocity(soldWithMetrics);

    const prompt = buildPrompt(soldWithMetrics, catVelocity, heldTrades);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const velocity = transformVelocity(parsed, heldTrades);

    return apiOk({ ok: true, velocity });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  buyDate: Date;
  sellDate: Date | null;
}

interface SoldWithMetrics {
  id: string;
  title: string;
  category: string;
  cost: number;
  revenue: number;
  profit: number;
  days: number;
  profitPerDay: number;
  velocityScore: number;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyDate: Date;
  listing: {
    aiEstimatedValue: number | null;
    dealScore: number | null;
  } | null;
}

interface CategoryVelocity {
  count: number;
  avgDays: number;
  avgProfit: number;
  avgVelocity: number;
}

function computeSoldWithMetrics(soldTrades: SoldTradeRow[]): SoldWithMetrics[] {
  return soldTrades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    const profit = revenue - cost;
    const days = t.sellDate && t.buyDate ? Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000)) : 0;
    const profitPerDay = days > 0 ? Math.round(profit / days) : profit;
    const velocityScore = Math.max(0, Math.min(100, Math.round(100 - (days / 90) * 50 + (profit > 0 ? 30 : -20))));
    return { id: t.id, title: t.title, category: t.category || 'drugo', cost, revenue, profit, days, profitPerDay, velocityScore };
  });
}

function computeCategoryVelocity(soldWithMetrics: SoldWithMetrics[]): Record<string, CategoryVelocity> {
  const catVelocity: Record<string, CategoryVelocity> = {};
  for (const t of soldWithMetrics) {
    if (!catVelocity[t.category]) catVelocity[t.category] = { count: 0, avgDays: 0, avgProfit: 0, avgVelocity: 0 };
    catVelocity[t.category].count++;
    catVelocity[t.category].avgDays += t.days;
    catVelocity[t.category].avgProfit += t.profit;
    catVelocity[t.category].avgVelocity += t.velocityScore;
  }
  for (const cat of Object.keys(catVelocity)) {
    const c = catVelocity[cat];
    c.avgDays = Math.round(c.avgDays / c.count);
    c.avgProfit = Math.round(c.avgProfit / c.count);
    c.avgVelocity = Math.round(c.avgVelocity / c.count);
  }
  return catVelocity;
}

function buildPrompt(soldWithMetrics: SoldWithMetrics[], catVelocity: Record<string, CategoryVelocity>, heldTrades: HeldTradeRow[]): string {
  const heldStr = heldTrades.slice(0, 15).map(t => `- ${t.title} | ${t.category} | ${Math.round((Date.now()-t.buyDate.getTime())/(24*60*60*1000))}d | est. ${t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice*1.25)}€`).join('\n');
  const catStr = Object.entries(catVelocity).sort(([,a],[,b]) => b.avgVelocity - a.avgVelocity).slice(0, 10).map(([cat, d]) => `- ${cat}: ${d.count} prodaj, povp. ${d.avgDays}d, ${d.avgProfit}€, velocity ${d.avgVelocity}/100`).join('\n');
  const fastSales = soldWithMetrics.filter(t => t.days <= 7).slice(0, 5).map(t => `- ${t.title} | ${t.days}d | ${t.profit}€ | velocity ${t.velocityScore}`).join('\n');
  const slowSales = soldWithMetrics.filter(t => t.days >= 60).slice(0, 5).map(t => `- ${t.title} | ${t.days}d | ${t.profit}€ | velocity ${t.velocityScore}`).join('\n');

  return `Si ekspert za analizo hitrosti prodaje (velocity) pri preprodaji.
Analiziraj velocity vzorce in priporoči kako pospešiti prodajo.

VELOCITY PO KATEGORIJAH:
${catStr}

NAJHITREJŠE PRODAJE (≤7 dni):
${fastSales || '- Ni podatkov'}

NAJPOČASNEJŠE PRODAJE (≥60 dni):
${slowSales || '- Ni podatkov'}

TRENUTNI INVENTAR:
${heldStr || '- Prazno'}

Velocity benchmarki:
- FAST: ≤7 dni (velocity 80-100) — odlično, ponovi strategijo
- GOOD: 8-21 dni (velocity 60-79) — nad povprečjem
- AVERAGE: 22-45 dni (velocity 40-59) — normalno
- SLOW: 46-90 dni (velocity 20-39) — potreben优化
- STALLED: >90 dni (velocity 0-19) — kritično

Velocity faktorji:
1. Cena (nižja = hitreje, a manj dobička)
2. Kategorija (elektronika hitro, pohištvo počasno)
3. Sezona (sezonski itemi v vrhu = hitro)
4. Platforma (Facebook hitro, Bolha srednje)
5. Kakovost slike/opisa (boljše = hitreje)
6. Čas objave (večer/vikend = več ogledov)

Odgovori LE z JSON:
{
  "insights": "<max 250 znakov>",
  "held_items_velocity": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "category": "<kategorija>",
      "days_held": <number>,
      "predicted_velocity_score": <number 0-100>,
      "predicted_days_to_sell": <number>,
      "velocity_status": "<fast|good|average|slow|stalled>",
      "acceleration_actions": ["<kaj storiti za pospešitev, max 80 znakov>", "..."],
      "price_adjustment_eur": <number>,
      "expected_velocity_boost_pct": <number>,
      "reasoning": "<max 80 znakov>"
    }
  ],
  "velocity_curve": [
    { "day_range": "<max 20 znakov>", "sales_count": <number>, "avg_profit_eur": <number>, "velocity_score": <number> }
  ],
  "category_benchmarks": [
    { "category": "<kat>", "fast_threshold_days": <number>, "avg_days": <number>, "best_price_point_eur": <number>, "velocity_tip": "<max 80 znakov>" }
  ],
  "summary": {
    "overall_avg_velocity": <number 0-100>,
    "fastest_category": "<kategorija>",
    "slowest_category": "<kategorija>",
    "items_needing_acceleration": <number>,
    "potential_time_savings_days": <number>
  }
}`;
}

function transformVelocity(parsed: any, heldTrades: HeldTradeRow[]) {
  const validIds = new Set(heldTrades.map(t => t.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 600),
    heldItemsVelocity: (parsed?.held_items_velocity || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).map((it: any) => ({
      tradeId: String(it?.id ?? ''),
      title: String(it?.title ?? '').slice(0, 150),
      category: String(it?.category ?? '').slice(0, 50),
      daysHeld: Math.max(0, Number(it?.days_held ?? 0)),
      predictedVelocityScore: Math.max(0, Math.min(100, Number(it?.predicted_velocity_score ?? 50))),
      predictedDaysToSell: Math.max(0, Number(it?.predicted_days_to_sell ?? 14)),
      velocityStatus: ['fast', 'good', 'average', 'slow', 'stalled'].includes(String(it?.velocity_status)) ? String(it.velocity_status) : 'average',
      accelerationActions: (it?.acceleration_actions || []).slice(0, 4).map((a: any) => String(a).slice(0, 150)),
      priceAdjustmentEur: Number(it?.price_adjustment_eur ?? 0),
      expectedVelocityBoostPct: Math.round(Number(it?.expected_velocity_boost_pct ?? 0)),
      reasoning: String(it?.reasoning ?? '').slice(0, 200),
    })),
    velocityCurve: (parsed?.velocity_curve || []).slice(0, 6).map((v: any) => ({
      dayRange: String(v?.day_range ?? '').slice(0, 50),
      salesCount: Math.max(0, Number(v?.sales_count ?? 0)),
      avgProfitEur: Math.round(Number(v?.avg_profit_eur ?? 0)),
      velocityScore: Math.max(0, Math.min(100, Number(v?.velocity_score ?? 50))),
    })),
    categoryBenchmarks: (parsed?.category_benchmarks || []).slice(0, 10).map((c: any) => ({
      category: String(c?.category ?? '').slice(0, 50),
      fastThresholdDays: Math.max(0, Number(c?.fast_threshold_days ?? 7)),
      avgDays: Math.max(0, Number(c?.avg_days ?? 30)),
      bestPricePointEur: Math.max(0, Number(c?.best_price_point_eur ?? 0)),
      velocityTip: String(c?.velocity_tip ?? '').slice(0, 150),
    })),
    summary: {
      overallAvgVelocity: Math.max(0, Math.min(100, Number(parsed?.summary?.overall_avg_velocity ?? 50))),
      fastestCategory: String(parsed?.summary?.fastest_category ?? '').slice(0, 50),
      slowestCategory: String(parsed?.summary?.slowest_category ?? '').slice(0, 50),
      itemsNeedingAcceleration: Math.max(0, Number(parsed?.summary?.items_needing_acceleration ?? 0)),
      potentialTimeSavingsDays: Math.max(0, Number(parsed?.summary?.potential_time_savings_days ?? 0)),
    },
  };
}
