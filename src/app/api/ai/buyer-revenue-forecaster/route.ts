// v6.75 / v8.95.4-batch3: AI Buyer Revenue Forecaster — napoveduje prihodek per kupec z ML in revenue decomposition
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-revenue-forecaster
// Body: { customerName?: string, monthsAhead?: number }
// Returns: { ok, forecaster: { buyers, revenueProjections, revenueDrivers, scenarios, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BuyerRevenueForecasterInput {
  customerName: string | null;
  monthsAhead: number;
}

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  sellLocation: string;
  buyDate: Date | null;
}

interface BuyerRow {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrder: number;
  daysSinceLast: number;
  lastPurchase: Date | null;
  firstPurchase: Date | null;
  categories: Set<string>;
}

const REVENUE_SEGMENTS = ['high_value', 'medium_value', 'low_value', 'declining', 'growing'] as const;
const RECOMMENDED_ACTIONS = ['maintain', 'upsell', 'cross_sell', 'retain', 'reactivate'] as const;
const REVENUE_DRIVERS = ['purchase_frequency', 'order_value', 'retention_rate', 'cross_sell', 'upsell', 'referral', 'seasonality', 'market_trend', 'pricing', 'category_expansion'] as const;
const SCENARIOS = ['pessimistic', 'realistic', 'optimistic', 'stretch'] as const;
const ML_MODELS = ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'] as const;
const PREDICTION_TYPES = ['revenue_forecast', 'buyer_spend', 'purchase_frequency', 'order_value'] as const;

export const POST = withAiRoute<BuyerRevenueForecasterInput>({
  endpoint: '/api/ai/buyer-revenue-forecaster',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      customerName: body?.customerName ? String(body.customerName).trim() : null,
      monthsAhead: Math.max(1, Math.min(24, Number(body?.monthsAhead ?? 12))),
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { customerName, monthsAhead } = input;

    const soldTrades: SoldTradeRow[] = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 500, orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, forecaster: null, message: 'Ni prodaj za revenue forecasting.' });
    }

    const buyers = buildBuyers(soldTrades);

    if (customerName) {
      const f = buyers.filter(b => b.name === customerName);
      if (f.length === 0) {
        return apiOk({ ok: true, forecaster: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const prompt = buildPrompt(targetBuyers, monthsAhead);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const forecaster = transformForecaster(parsed, targetBuyers, monthsAhead);

    return apiOk({ ok: true, forecaster });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildBuyers(soldTrades: SoldTradeRow[]): BuyerRow[] {
  const buyerMap = new Map<string, BuyerRow>();
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  for (const t of soldTrades) {
    const name = (t.sellLocation || '').trim();
    if (!name || name.length < 2 || !t.sellDate) continue;
    const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    if (!buyerMap.has(name)) {
      buyerMap.set(name, {
        name, purchases: 0, totalSpent: 0, avgOrder: 0, daysSinceLast: 0,
        lastPurchase: t.sellDate, firstPurchase: t.sellDate, categories: new Set(),
      });
    }
    const b = buyerMap.get(name)!;
    b.purchases += 1;
    b.totalSpent += rev;
    if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate;
    if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
    if (t.category) b.categories.add(t.category);
  }
  const buyers = Array.from(buyerMap.values());
  for (const b of buyers) {
    b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0;
    b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / DAY) : 999;
  }
  return buyers;
}

function buildPrompt(targetBuyers: BuyerRow[], monthsAhead: number): string {
  const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d`).join('\n');

  return `Si AI buyer revenue forecaster z ML in revenue decomposition.
Napoveduje prihodek per kupec za ${monthsAhead} mesecev.

KUPCI (${targetBuyers.length}):
${buyersStr}

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    { "name": "<ime>", "current_revenue_eur": <number>, "projected_revenue_eur": <number>, "revenue_change_pct": <number>, "projected_purchases": <number>, "avg_projected_order_value_eur": <number>, "revenue_drivers": ["<max 80 znakov>"], "revenue_risks": ["<max 80 znakov>"], "revenue_segment": "<high_value|medium_value|low_value|declining|growing>", "confidence_pct": <number 0-100>, "recommended_action": "<maintain|upsell|cross_sell|retain|reactivate>", "expected_revenue_uplift_eur": <number> }
  ],
  "revenueProjections": [
    { "month": <1-24>, "projected_total_revenue_eur": <number>, "projected_active_buyers": <number>, "projected_avg_order_value_eur": <number>, "projected_new_buyers": <number>, "cumulative_revenue_eur": <number>, "confidence_pct": <number 0-100> }
  ],
  "revenueDrivers": [
    { "driver": "<purchase_frequency|order_value|retention_rate|cross_sell|upsell|referral|seasonality|market_trend|pricing|category_expansion>", "current_contribution_eur": <number>, "current_contribution_pct": <number 0-100>, "projected_contribution_eur": <number>, "growth_potential_pct": <number>, "optimization_action": "<max 120 znakov>" }
  ],
  "scenarios": [
    { "scenario": "<pessimistic|realistic|optimistic|stretch>", "total_projected_revenue_eur": <number>, "avg_monthly_revenue_eur": <number>, "active_buyers": <number>, "avg_order_value_eur": <number>, "probability_pct": <number 0-100> }
  ],
  "mlModels": [
    { "model": "<arima|lstm|prophet|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<revenue_forecast|buyer_spend|purchase_frequency|order_value>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_buyers_forecasted": <number>, "current_total_revenue_eur": <number>, "projected_total_revenue_eur": <number>,
    "total_revenue_change_pct": <number>, "best_revenue_driver": "<max 80 znakov>",
    "biggest_revenue_risk": "<max 100 znakov>", "quickest_revenue_win": "<max 100 znakov>",
    "revenue_forecasting_score": <number 0-100>
  }
}`;
}

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function round1(n: number): number {
  return Math.round(Number(n) * 10) / 10;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function transformForecaster(parsed: any, targetBuyers: BuyerRow[], monthsAhead: number): any {
  const validNames = new Set(targetBuyers.map(b => b.name));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    buyers: (parsed?.buyers || []).filter((b: any) => validNames.has(String(b?.name ?? ''))).slice(0, 25).map((b: any) => ({
      name: String(b?.name ?? '').slice(0, 100),
      currentRevenueEur: Math.round(Number(b?.current_revenue_eur ?? 0)),
      projectedRevenueEur: Math.round(Number(b?.projected_revenue_eur ?? 0)),
      revenueChangePct: round1(b?.revenue_change_pct ?? 0),
      projectedPurchases: Math.max(0, Number(b?.projected_purchases ?? 0)),
      avgProjectedOrderValueEur: Math.round(Number(b?.avg_projected_order_value_eur ?? 0)),
      revenueDrivers: (b?.revenue_drivers || []).slice(0, 4).map((d: any) => String(d).slice(0, 150)),
      revenueRisks: (b?.revenue_risks || []).slice(0, 4).map((r: any) => String(r).slice(0, 150)),
      revenueSegment: includes(REVENUE_SEGMENTS, String(b?.revenue_segment)) ? String(b.revenue_segment) : 'medium_value',
      confidencePct: clamp(Number(b?.confidence_pct ?? 50), 0, 100),
      recommendedAction: includes(RECOMMENDED_ACTIONS, String(b?.recommended_action)) ? String(b.recommended_action) : 'maintain',
      expectedRevenueUpliftEur: Math.round(Number(b?.expected_revenue_uplift_eur ?? 0)),
    })),
    revenueProjections: (parsed?.revenueProjections || []).slice(0, monthsAhead).map((p: any) => ({
      month: Math.max(1, Math.min(24, Number(p?.month ?? 1))),
      projectedTotalRevenueEur: Math.round(Number(p?.projected_total_revenue_eur ?? 0)),
      projectedActiveBuyers: Math.max(0, Number(p?.projected_active_buyers ?? 0)),
      projectedAvgOrderValueEur: Math.round(Number(p?.projected_avg_order_value_eur ?? 0)),
      projectedNewBuyers: Math.max(0, Number(p?.projected_new_buyers ?? 0)),
      cumulativeRevenueEur: Math.round(Number(p?.cumulative_revenue_eur ?? 0)),
      confidencePct: clamp(Number(p?.confidence_pct ?? 50), 0, 100),
    })),
    revenueDrivers: (parsed?.revenueDrivers || []).slice(0, 10).map((d: any) => ({
      driver: includes(REVENUE_DRIVERS, String(d?.driver)) ? String(d.driver) : 'purchase_frequency',
      currentContributionEur: Math.round(Number(d?.current_contribution_eur ?? 0)),
      currentContributionPct: clamp(Number(d?.current_contribution_pct ?? 10), 0, 100),
      projectedContributionEur: Math.round(Number(d?.projected_contribution_eur ?? 0)),
      growthPotentialPct: round1(d?.growth_potential_pct ?? 0),
      optimizationAction: String(d?.optimization_action ?? '').slice(0, 250),
    })),
    scenarios: (parsed?.scenarios || []).slice(0, 4).map((s: any) => ({
      scenario: includes(SCENARIOS, String(s?.scenario)) ? String(s.scenario) : 'realistic',
      totalProjectedRevenueEur: Math.round(Number(s?.total_projected_revenue_eur ?? 0)),
      avgMonthlyRevenueEur: Math.round(Number(s?.avg_monthly_revenue_eur ?? 0)),
      activeBuyers: Math.max(0, Number(s?.active_buyers ?? 0)),
      avgOrderValueEur: Math.round(Number(s?.avg_order_value_eur ?? 0)),
      probabilityPct: clamp(Number(s?.probability_pct ?? 50), 0, 100),
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: includes(ML_MODELS, String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: clamp(Number(m?.accuracy_pct ?? 70), 0, 100),
      predictionType: includes(PREDICTION_TYPES, String(m?.prediction_type)) ? String(m.prediction_type) : 'revenue_forecast',
      weightInEnsemble: clamp(Number(m?.weight_in_ensemble ?? 20), 0, 100),
    })),
    summary: {
      totalBuyersForecasted: targetBuyers.length,
      currentTotalRevenueEur: Math.round(Number(parsed?.summary?.current_total_revenue_eur ?? 0)),
      projectedTotalRevenueEur: Math.round(Number(parsed?.summary?.projected_total_revenue_eur ?? 0)),
      totalRevenueChangePct: round1(parsed?.summary?.total_revenue_change_pct ?? 0),
      bestRevenueDriver: includes(REVENUE_DRIVERS, String(parsed?.summary?.best_revenue_driver)) ? String(parsed.summary.best_revenue_driver) : 'purchase_frequency',
      biggestRevenueRisk: String(parsed?.summary?.biggest_revenue_risk ?? '').slice(0, 200),
      quickestRevenueWin: String(parsed?.summary?.quickest_revenue_win ?? '').slice(0, 200),
      revenueForecastingScore: clamp(Number(parsed?.summary?.revenue_forecasting_score ?? 60), 0, 100),
    },
  };
}
