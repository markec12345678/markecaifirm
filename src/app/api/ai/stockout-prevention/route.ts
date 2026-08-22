// v6.37 / v8.96.0-batch2: AI Predictive Stockout Prevention — prepreči izpraznitev zalog za profitabilne kategorije
// Refaktoriran z withAiRoute helperjem (v8.96.0-batch2) + enforceBudget guard.
//
// POST /api/ai/stockout-prevention
// Body: {}
// Returns: { ok, prevention: { atRiskCategories, items: [], restockPlan, alerts, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface StockoutPreventionInput {}

export const POST = withAiRoute<StockoutPreventionInput>({
  endpoint: '/api/ai/stockout-prevention',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {} as StockoutPreventionInput;
  },

  // No validateInput — body je prazen
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 50,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null }, sellPrice: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true },
      take: 300,
    });

    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return apiOk({ ok: true, prevention: null, message: 'Ni podatkov za stockout prevention.' });
    }

    // Izračunaj stockout tveganja per kategorija
    const { heldByCat, soldByCat } = computeCategoryAggs(heldTrades, soldTrades);
    const stockoutRisks = computeStockoutRisks(heldByCat, soldByCat);

    const heldStr = heldTrades.slice(0, 15).map(t => `- ${t.title} | ${t.category} | ${Math.round((Date.now()-t.buyDate.getTime())/(24*60*60*1000))}d`).join('\n');
    const riskStr = stockoutRisks.map(r => `- ${r.category}: 0 held, ${r.soldCount} prodaj, ${r.avgRoi}% ROI, ${r.avgDays}d, risk: ${r.risk}`).join('\n');

    const prompt = buildPrompt({ heldStr, riskStr });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const prevention = transformPrevention(parsed);

    return apiOk({ ok: true, prevention });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface HeldAgg { count: number; value: number; }
interface SoldAgg { count: number; profit: number; avgDays: number; avgRoi: number; }

function computeCategoryAggs(
  heldTrades: Array<{ category: string | null; buyPrice: number }>,
  soldTrades: Array<{ category: string | null; buyPrice: number; sellPrice: number | null; buyDate: Date; sellDate: Date | null }>
): { heldByCat: Record<string, HeldAgg>; soldByCat: Record<string, SoldAgg> } {
  const heldByCat: Record<string, HeldAgg> = {};
  for (const t of heldTrades) { const c = t.category || 'drugo'; if (!heldByCat[c]) heldByCat[c] = { count: 0, value: 0 }; heldByCat[c].count++; heldByCat[c].value += t.buyPrice; }

  const soldByCat: Record<string, SoldAgg> = {};
  for (const t of soldTrades) {
    const c = t.category || 'drugo';
    if (!soldByCat[c]) soldByCat[c] = { count: 0, profit: 0, avgDays: 0, avgRoi: 0 };
    soldByCat[c].count++;
    soldByCat[c].profit += (t.sellPrice ?? 0) - t.buyPrice;
    const cost = t.buyPrice; soldByCat[c].avgRoi += cost > 0 ? (((t.sellPrice ?? 0) - t.buyPrice) / cost) * 100 : 0;
    if (t.sellDate && t.buyDate) soldByCat[c].avgDays += Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000));
  }
  for (const c of Object.keys(soldByCat)) {
    soldByCat[c].avgRoi = Math.round(soldByCat[c].avgRoi / soldByCat[c].count);
    soldByCat[c].avgDays = Math.round(soldByCat[c].avgDays / soldByCat[c].count);
  }
  return { heldByCat, soldByCat };
}

interface StockoutRisk {
  category: string;
  heldCount: number;
  soldCount: number;
  avgRoi: number;
  avgDays: number;
  risk: string;
}

function computeStockoutRisks(
  heldByCat: Record<string, HeldAgg>,
  soldByCat: Record<string, SoldAgg>
): StockoutRisk[] {
  const allCats = new Set([...Object.keys(heldByCat), ...Object.keys(soldByCat)]);
  const stockoutRisks: StockoutRisk[] = [];
  for (const cat of allCats) {
    const held = heldByCat[cat]?.count ?? 0;
    const sold = soldByCat[cat];
    if (held === 0 && sold && sold.count >= 2 && sold.avgRoi > 15) {
      stockoutRisks.push({ category: cat, heldCount: 0, soldCount: sold.count, avgRoi: sold.avgRoi, avgDays: sold.avgDays, risk: 'critical' });
    } else if (held <= 2 && sold && sold.count >= 3 && sold.avgRoi > 20) {
      stockoutRisks.push({ category: cat, heldCount: held, soldCount: sold.count, avgRoi: sold.avgRoi, avgDays: sold.avgDays, risk: 'high' });
    } else if (held <= 5 && sold && sold.count >= 5 && sold.avgRoi > 25) {
      stockoutRisks.push({ category: cat, heldCount: held, soldCount: sold.count, avgRoi: sold.avgRoi, avgDays: sold.avgDays, risk: 'medium' });
    }
  }
  return stockoutRisks;
}

interface PromptData {
  heldStr: string;
  riskStr: string;
}

function buildPrompt(d: PromptData): string {
  return `Si AI sistem za preprečevanje izpraznitve zalog (stockout prevention).
Identificiraj profitabilne kategorije ki izpuščajo ali bodo izpraznile zalogo.

STOCKOUT RIZIKI:
${d.riskStr || '- Ni kritičnih stockoutov'}

TRENUTNI HELD:
${d.heldStr || '- Prazno'}

Stockout prevention pravila:
1. CRITICAL: 0 held + ROI > 15% + >= 2 prodaje → NUJNO dopolni
2. HIGH: <=2 held + ROI > 20% + >= 3 prodaje → začni iskati
3. MEDIUM: <=5 held + ROI > 25% + >= 5 prodaj → spremljaj
4. SAFE: dovolj zaloge ali nizek ROI

Za vsak stockout risk:
1. Določi: kaj konkretno kupiti (item tip)
2. Kje iskati (vir/platforma)
3. Koliko kupiti (quantity)
4. Kdaj ukrepati (deadline)
5. Predviden dobiček pri dopolnitvi

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "at_risk_categories": [
    {
      "category": "<kategorija>",
      "risk_level": "<critical|high|medium>",
      "held_count": <number>,
      "sold_count": <number>,
      "avg_roi_pct": <number>,
      "avg_days_to_sell": <number>,
      "depletion_rate_per_week": <number>,
      "estimated_stockout_date": "<max 30 znakov>",
      "lost_revenue_per_week_eur": <number>,
      "action": "<restock_urgent|start_sourcing|monitor>",
      "deadline_days": <number>
    }
  ],
  "restock_plan": [
    {
      "category": "<kategorija>",
      "items_to_buy": [{"item": "<max 80 znakov>", "source": "<vir>", "max_price_eur": <number>, "keywords": "<max 80 znakov>"}],
      "quantity": <number>,
      "budget_eur": <number>,
      "expected_profit_eur": <number>,
      "expected_roi_pct": <number>,
      "monitor_setup": {"keywords": "<max 80 znakov>", "alert_threshold": <number>, "source": "<vir>", "interval_minutes": <number>},
      "urgency": "<critical|high|medium>"
    }
  ],
  "alerts": [
    {"category": "<kat>", "message": "<max 120 znakov>", "severity": "<critical|high|medium>", "action": "<max 80 znakov>"}
  ],
  "summary": {
    "total_at_risk": <number>,
    "critical_count": <number>,
    "estimated_lost_revenue_eur": <number>,
    "restock_budget_needed_eur": <number>,
    "expected_recovery_profit_eur": <number>
  }
}`;
}

function transformPrevention(parsed: any) {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    atRiskCategories: (parsed?.at_risk_categories || []).slice(0, 10).map((c: any) => ({
      category: String(c?.category ?? '').slice(0, 50),
      riskLevel: ['critical', 'high', 'medium'].includes(String(c?.risk_level)) ? String(c.risk_level) : 'medium',
      heldCount: Math.max(0, Number(c?.held_count ?? 0)),
      soldCount: Math.max(0, Number(c?.sold_count ?? 0)),
      avgRoiPct: Math.round(Number(c?.avg_roi_pct ?? 0)),
      avgDaysToSell: Math.max(0, Number(c?.avg_days_to_sell ?? 0)),
      depletionRatePerWeek: Math.round(Number(c?.depletion_rate_per_week ?? 0) * 10) / 10,
      estimatedStockoutDate: String(c?.estimated_stockout_date ?? '').slice(0, 50),
      lostRevenuePerWeekEur: Math.round(Number(c?.lost_revenue_per_week_eur ?? 0)),
      action: ['restock_urgent', 'start_sourcing', 'monitor'].includes(String(c?.action)) ? String(c.action) : 'monitor',
      deadlineDays: Math.max(0, Number(c?.deadline_days ?? 7)),
    })),
    restockPlan: (parsed?.restock_plan || []).slice(0, 8).map((r: any) => ({
      category: String(r?.category ?? '').slice(0, 50),
      itemsToBuy: (r?.items_to_buy || []).slice(0, 4).map((i: any) => ({
        item: String(i?.item ?? '').slice(0, 150),
        source: String(i?.source ?? '').slice(0, 30),
        maxPriceEur: Math.max(0, Number(i?.max_price_eur ?? 0)),
        keywords: String(i?.keywords ?? '').slice(0, 150),
      })),
      quantity: Math.max(1, Number(r?.quantity ?? 1)),
      budgetEur: Math.max(0, Number(r?.budget_eur ?? 0)),
      expectedProfitEur: Math.round(Number(r?.expected_profit_eur ?? 0)),
      expectedRoiPct: Math.round(Number(r?.expected_roi_pct ?? 0)),
      monitorSetup: {
        keywords: String(r?.monitor_setup?.keywords ?? '').slice(0, 150),
        alertThreshold: Math.max(0, Math.min(100, Number(r?.monitor_setup?.alert_threshold ?? 70))),
        source: String(r?.monitor_setup?.source ?? '').slice(0, 30),
        intervalMinutes: Math.max(5, Number(r?.monitor_setup?.interval_minutes ?? 30)),
      },
      urgency: ['critical', 'high', 'medium'].includes(String(r?.urgency)) ? String(r.urgency) : 'medium',
    })),
    alerts: (parsed?.alerts || []).slice(0, 6).map((a: any) => ({
      category: String(a?.category ?? '').slice(0, 50),
      message: String(a?.message ?? '').slice(0, 250),
      severity: ['critical', 'high', 'medium'].includes(String(a?.severity)) ? String(a.severity) : 'medium',
      action: String(a?.action ?? '').slice(0, 150),
    })),
    summary: {
      totalAtRisk: Math.max(0, Number(parsed?.summary?.total_at_risk ?? 0)),
      criticalCount: Math.max(0, Number(parsed?.summary?.critical_count ?? 0)),
      estimatedLostRevenueEur: Math.round(Number(parsed?.summary?.estimated_lost_revenue_eur ?? 0)),
      restockBudgetNeededEur: Math.round(Number(parsed?.summary?.restock_budget_needed_eur ?? 0)),
      expectedRecoveryProfitEur: Math.round(Number(parsed?.summary?.expected_recovery_profit_eur ?? 0)),
    },
  };
}
