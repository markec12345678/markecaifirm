// v6.15 / v8.96.1-batch3: AI Predictive Stockout Alerts — napove primanjkljaj kategorij v inventarju
// Refaktoriran z withAiRoute helperjem (v8.96.1-batch3) + enforceBudget guard.
//
// POST /api/ai/predictive-stockout
// Body: { forecastDays?: number }
// Returns: { ok, predictions: Array<{ category, currentStock, depletionRate, daysToStockout, stockoutDate, severity, recommendation }>, restockAlerts, insights }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface PredictiveStockoutInput {
  forecastDays: number;
}

export const POST = withAiRoute<PredictiveStockoutInput>({
  endpoint: '/api/ai/predictive-stockout',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { forecastDays: Math.max(7, Math.min(180, Number(body?.forecastDays) || 30)) };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { forecastDays } = input;

    // 1. Pridobi held trades za trenutni stock
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
    });

    // 2. Pridobi sold trades za izračun depletion rate
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { gte: sixMonthsAgo } },
      select: { category: true, sellDate: true, buyDate: true, sellPrice: true, buyPrice: true },
      take: 500,
    });

    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return apiOk({
        ok: true,
        predictions: [],
        message: 'Ni dovolj podatkov za napoved primanjkljaja.',
      });
    }

    // 3. Trenutni stock per kategorija
    const currentStock: Record<string, { count: number; value: number; avgAge: number }> = {};
    for (const t of heldTrades) {
      const cat = t.category || 'drugo';
      if (!currentStock[cat]) currentStock[cat] = { count: 0, value: 0, avgAge: 0 };
      currentStock[cat].count++;
      currentStock[cat].value += t.buyPrice + (t.buyPrice * 0.2); // približek vrednosti
      currentStock[cat].avgAge += Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
    }
    for (const cat of Object.keys(currentStock)) {
      currentStock[cat].avgAge = currentStock[cat].count > 0
        ? Math.round(currentStock[cat].avgAge / currentStock[cat].count) : 0;
    }

    // 4. Depletion rate per kategorija (koliko prodano na mesec)
    const depletionByCat: Record<string, { soldPerMonth: number; avgSellDays: number; revenue: number }> = {};
    for (const t of soldTrades) {
      const cat = t.category || 'drugo';
      if (!depletionByCat[cat]) depletionByCat[cat] = { soldPerMonth: 0, avgSellDays: 0, revenue: 0 };
      depletionByCat[cat].soldPerMonth += 1 / 6; // 6 mesecev
      depletionByCat[cat].revenue += (t.sellPrice ?? 0);
      if (t.sellDate && t.buyDate) {
        depletionByCat[cat].avgSellDays += Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      }
    }
    for (const cat of Object.keys(depletionByCat)) {
      const sold = soldTrades.filter(t => (t.category || 'drugo') === cat).length;
      depletionByCat[cat].avgSellDays = sold > 0 ? Math.round(depletionByCat[cat].avgSellDays / sold) : 0;
    }

    // 5. Izračun daysToStockout per kategorija
    const allCategories = new Set([...Object.keys(currentStock), ...Object.keys(depletionByCat)]);
    const predictions: Array<{
      category: string;
      currentStock: number;
      currentValue: number;
      avgAge: number;
      depletionRate: number; // per month
      daysToStockout: number | null;
      stockoutDate: string | null;
      severity: string;
      projectedRevenue: number;
    }> = [];

    for (const cat of allCategories) {
      const stock = currentStock[cat]?.count ?? 0;
      const value = Math.round(currentStock[cat]?.value ?? 0);
      const age = currentStock[cat]?.avgAge ?? 0;
      const depletion = depletionByCat[cat]?.soldPerMonth ?? 0;
      const avgSellDays = depletionByCat[cat]?.avgSellDays ?? 30;

      let daysToStockout: number | null = null;
      let stockoutDate: string | null = null;
      let severity = 'low';

      if (stock === 0) {
        severity = 'critical';
        daysToStockout = 0;
        stockoutDate = new Date().toISOString().slice(0, 10);
      } else if (depletion > 0) {
        // days = stock / (depletion/30)
        daysToStockout = Math.round(stock / (depletion / 30));
        stockoutDate = new Date(Date.now() + daysToStockout * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        if (daysToStockout <= 7) severity = 'critical';
        else if (daysToStockout <= 14) severity = 'high';
        else if (daysToStockout <= 30) severity = 'medium';
        else severity = 'low';
      } else if (stock > 0) {
        // ni prodaj — ovrednotimo kot stagnant
        severity = age > 60 ? 'stagnant' : 'low';
        daysToStockout = null;
      }

      // Projected revenue v naslednjih forecastDays
      const projectedRevenue = Math.round((depletion / 30) * forecastDays * (value / Math.max(1, stock)) * 0.8);

      predictions.push({
        category: cat,
        currentStock: stock,
        currentValue: value,
        avgAge: age,
        depletionRate: Math.round(depletion * 10) / 10,
        daysToStockout,
        stockoutDate,
        severity,
        projectedRevenue,
      });
    }

    predictions.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, stagnant: 3, low: 4 };
      return (order[a.severity as keyof typeof order] ?? 5) - (order[b.severity as keyof typeof order] ?? 5);
    });

    // 6. AI analiza in priporočila
    const predsStr = predictions.slice(0, 20).map(p =>
      `- ${p.category}: ${p.currentStock} itemov (${p.currentValue}€), depletion ${p.depletionRate}/mesec, ${p.daysToStockout !== null ? `${p.daysToStockout}d do stockout` : 'ni prodaj'}, severity ${p.severity}`
    ).join('\n');

    const prompt = buildPrompt(predsStr, forecastDays);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    return apiOk(transformResponse(parsed, predictions, currentStock, heldTrades.length, forecastDays));
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildPrompt(predsStr: string, forecastDays: number): string {
  return `Si ekspert za supply chain management pri preprodaji rabljenih dobrin.
Analiziraj stock levels in napovej primanjkljaj (stockout) za naslednje ${forecastDays} dni.

TRENUTNO STANJE IN PRODAJNA ZGODOVINA:
${predsStr || '- Ni podatkov'}

Pravila:
1. Kategorije z "critical" severity (≤7 dni do stockout) — nujno dopolni
2. Kategorije z "high" severity (≤14 dni) — začni iskati
3. Kategorije z "stagnant" — počasna prodaja, zmanjšaj nabavo
4. Kategorije z "low" — dovolj zaloge, nadaljuj normalno
5. Upoštevaj sezonskost (poletje: kamp oprema, zima: grelniki)

Za vsako kategorijo podaj:
- action: restock_now|start_sourcing|reduce|maintain|liquidate
- suggestedQuantity: koliko itemov kupiti
- urgency: 1-10 (10=nujno takoj)
- expectedRevenue: pričakovan prihodek če dopolniš
- sourcingHint: kje iskati (bolha/avtonet/fb/...)

Odgovori LE z JSON:
{
  "insights": "<splošne ugotovitve o stock levels, max 250 znakov>",
  "recommendations": [
    {
      "category": "<kategorija>",
      "action": "<restock_now|start_sourcing|reduce|maintain|liquidate>",
      "suggested_quantity": <number>,
      "urgency": <number 1-10>,
      "expected_revenue_eur": <number>,
      "sourcing_hint": "<kje iskati, max 100 znakov>",
      "reasoning": "<max 100 znakov>"
    }
  ],
  "restock_alerts": [
    {
      "category": "<kategorija>",
      "alert_level": "<critical|high|medium>",
      "deadline_days": <number>,
      "message": "<konkretno opozorilo, max 150 znakov>"
    }
  ]
}`;
}

function transformResponse(
  parsed: any,
  predictions: Array<{ severity: string }>,
  currentStock: Record<string, { value: number }>,
  heldTradesLength: number,
  forecastDays: number
): any {
  const recommendations = (parsed?.recommendations || []).slice(0, 15).map((r: any) => ({
    category: String(r?.category ?? '').slice(0, 50),
    action: ['restock_now', 'start_sourcing', 'reduce', 'maintain', 'liquidate'].includes(String(r?.action))
      ? String(r.action) : 'maintain',
    suggestedQuantity: Math.max(0, Math.min(50, Number(r?.suggested_quantity ?? 0))),
    urgency: Math.max(1, Math.min(10, Number(r?.urgency ?? 5))),
    expectedRevenueEur: Math.max(0, Number(r?.expected_revenue_eur ?? 0)),
    sourcingHint: String(r?.sourcing_hint ?? '').slice(0, 200),
    reasoning: String(r?.reasoning ?? '').slice(0, 200),
  }));

  const restockAlerts = (parsed?.restock_alerts || []).slice(0, 10).map((a: any) => ({
    category: String(a?.category ?? '').slice(0, 50),
    alertLevel: ['critical', 'high', 'medium'].includes(String(a?.alert_level)) ? String(a.alert_level) : 'medium',
    deadlineDays: Math.max(0, Number(a?.deadline_days ?? 0)),
    message: String(a?.message ?? '').slice(0, 250),
  }));

  // Summary
  const criticalCount = predictions.filter(p => p.severity === 'critical').length;
  const highCount = predictions.filter(p => p.severity === 'high').length;
  const stagnantCount = predictions.filter(p => p.severity === 'stagnant').length;
  const totalStockValue = Object.values(currentStock).reduce((s, c) => s + c.value, 0);

  return {
    ok: true,
    insights: String(parsed?.insights ?? '').slice(0, 600),
    predictions,
    recommendations,
    restockAlerts,
    summary: {
      totalCategories: predictions.length,
      criticalCount,
      highCount,
      stagnantCount,
      totalStockValue: Math.round(totalStockValue),
      totalItems: heldTradesLength,
      forecastDays,
    },
  };
}
