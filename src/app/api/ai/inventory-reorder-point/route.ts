// v6.83 / v8.95.7-inv2-refactor: AI Inventory Reorder Point — ML izračun reorder pointov z demand variability
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-reorder-point
// Body: { days?: number }
// Returns: { ok, analyzer: { overview, reorderPoints, safetyStock, recommendations, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const REORDER_STATUSES = ['urgent_reorder', 'reorder_now', 'monitor_closely', 'adequate_stock', 'overstocked', 'no_restock_needed'] as const;
const DEMAND_PATTERNS = ['steady', 'increasing', 'decreasing', 'volatile', 'seasonal_high', 'seasonal_low', 'sporadic', 'new_product'] as const;

interface ReorderPointInput {
  days: number;
}

export const POST = withAiRoute<ReorderPointInput>({
  endpoint: '/api/ai/inventory-reorder-point',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget + avtomatsko recordAiCall po uspehu

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      days: Math.max(7, Math.min(365, Number(body?.days ?? 90))),
    };
  },

  // No validateInput — days ima default z clamp

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { days } = input;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since, not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellDate: true, buyDate: true },
      take: 1000,
      orderBy: { sellDate: 'desc' },
    });
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true, listingId: true },
      take: 200,
    });
    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return apiOk({ ok: true, analyzer: null, message: 'Ni podatkov za reorder point analizo.' });
    }

    const stats = computeReorderStats(soldTrades, heldTrades);

    const prompt = buildReorderPrompt({ days, stats });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const analyzer = transformReorderAnalyzer(parsed, stats);

    return apiOk({ ok: true, analyzer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface ReorderSoldRow {
  category: string | null;
  sellDate: Date | null;
}

interface ReorderHeldRow {
  category: string | null;
}

interface ReorderStats {
  catSold: Map<string, { count: number; dates: Date[] }>;
  catHeld: Map<string, number>;
  totalSold: number;
  totalHeld: number;
  categories: Set<string>;
}

function computeReorderStats(soldTrades: ReorderSoldRow[], heldTrades: ReorderHeldRow[]): ReorderStats {
  const catSold = new Map<string, { count: number; dates: Date[] }>();
  for (const t of soldTrades) {
    const cat = t.category || 'unknown';
    if (!catSold.has(cat)) catSold.set(cat, { count: 0, dates: [] });
    catSold.get(cat)!.count += 1;
    if (t.sellDate) catSold.get(cat)!.dates.push(t.sellDate);
  }

  const catHeld = new Map<string, number>();
  for (const t of heldTrades) {
    const cat = t.category || 'unknown';
    catHeld.set(cat, (catHeld.get(cat) ?? 0) + 1);
  }

  const categories = new Set([...catSold.keys(), ...catHeld.keys()]);

  return {
    catSold,
    catHeld,
    totalSold: soldTrades.length,
    totalHeld: heldTrades.length,
    categories,
  };
}

interface ReorderPromptInput {
  days: number;
  stats: ReorderStats;
}

function buildReorderPrompt(input: ReorderPromptInput): string {
  const { days, stats } = input;
  const catList = Array.from(stats.categories).slice(0, 12).map(cat => {
    const sold = stats.catSold.get(cat);
    const held = stats.catHeld.get(cat) ?? 0;
    const soldCount = sold?.count ?? 0;
    return `- ${cat} | sold: ${soldCount} | held: ${held} | avg daily: ${(soldCount / days).toFixed(2)}`;
  }).join('\n');

  return `Si AI inventory reorder point analyzer z ML in demand variability analysis.
Izračuna reorder pointe z 6 statusi in 8 demand patterni.

STATS (zadnjih ${days} dni):
- Total sold: ${stats.totalSold} | Total held: ${stats.totalHeld}
- Kategorij: ${stats.categories.size}

KATEGORIJE (sold/held/daily avg):
${catList}

6 reorder statusov:
1. URGENT_REORDER: takojšnji reorder
2. REORDER_NOW: potrebno naročilo
3. MONITOR_CLOSELY: spremljaj
4. ADEQUATE_STOCK: dovolj zaloge
5. OVERSTOCKED: preveč zaloge
6. NO_RESTOCK_NEEDED: ni potrebno

8 demand patternov: steady, increasing, decreasing, volatile, seasonal_high, seasonal_low, sporadic, new_product

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_categories": <number>, "total_held_items": <number>, "urgent_reorders_count": <number>, "adequate_stock_count": <number>, "overstocked_count": <number>, "avg_reorder_urgency_score": <number 0-100>, "reorder_grade": "<A|B|C|D|F>" },
  "reorderPoints": [
    { "category": "<string>", "current_stock": <number>, "avg_daily_demand": <number>, "lead_time_days": <number>, "reorder_point": <number>, "safety_stock": <number>, "days_until_stockout": <number>, "reorder_status": "<${REORDER_STATUSES.join('|')}>", "demand_pattern": "<${DEMAND_PATTERNS.join('|')}>" }
  ],
  "safetyStock": [
    { "category": "<string>", "avg_demand": <number>, "demand_std_dev": <number>, "service_level_pct": <number 0-100>, "lead_time_days": <number>, "safety_stock_units": <number>, "current_safety_stock": <number>, "safety_stock_status": "<adequate|low|critical|excess>" }
  ],
  "recommendations": [
    { "category": "<string>", "action": "<max 150 znakov>", "quantity_to_reorder": <number>, "expected_cost_eur": <number>, "expected_revenue_eur": <number>, "supplier_lead_time_days": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<prophet|arima|lstm|gradient_boosting|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<demand_forecast|reorder_optimization|stockout_prediction|lead_time_forecast>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "reorder_optimization_score": <number 0-100>, "reorder_grade": "<A|B|C|D|F>", "total_reorder_value_eur": <number>,
    "urgent_reorders_count": <number>, "stockout_risk_count": <number>,
    "biggest_reorder_risk": "<max 100 znakov>", "biggest_reorder_opportunity": "<max 100 znakov>",
    "quickest_reorder_win": "<max 100 znakov>", "reorder_analysis_score": <number 0-100>
  }
}`;
}

function transformReorderAnalyzer(parsed: any, stats: ReorderStats) {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    overview: {
      totalCategories: Math.max(0, Number(parsed?.overview?.total_categories ?? stats.categories.size)),
      totalHeldItems: Math.max(0, Number(parsed?.overview?.total_held_items ?? stats.totalHeld)),
      urgentReordersCount: Math.max(0, Number(parsed?.overview?.urgent_reorders_count ?? 0)),
      adequateStockCount: Math.max(0, Number(parsed?.overview?.adequate_stock_count ?? 0)),
      overstockedCount: Math.max(0, Number(parsed?.overview?.overstocked_count ?? 0)),
      avgReorderUrgencyScore: Math.max(0, Math.min(100, Number(parsed?.overview?.avg_reorder_urgency_score ?? 50))),
      reorderGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.reorder_grade)) ? String(parsed.overview.reorder_grade) : 'C',
    },
    reorderPoints: (parsed?.reorderPoints || []).slice(0, 12).map((r: any) => ({
      category: String(r?.category ?? '').slice(0, 50),
      currentStock: Math.max(0, Number(r?.current_stock ?? 0)),
      avgDailyDemand: Math.round(Number(r?.avg_daily_demand ?? 0) * 100) / 100,
      leadTimeDays: Math.max(1, Number(r?.lead_time_days ?? 7)),
      reorderPoint: Math.max(0, Number(r?.reorder_point ?? 0)),
      safetyStock: Math.max(0, Number(r?.safety_stock ?? 0)),
      daysUntilStockout: Math.max(0, Number(r?.days_until_stockout ?? 30)),
      reorderStatus: (REORDER_STATUSES as readonly string[]).includes(String(r?.reorder_status)) ? String(r.reorder_status) : 'adequate_stock',
      demandPattern: (DEMAND_PATTERNS as readonly string[]).includes(String(r?.demand_pattern)) ? String(r.demand_pattern) : 'steady',
    })),
    safetyStock: (parsed?.safetyStock || []).slice(0, 12).map((s: any) => ({
      category: String(s?.category ?? '').slice(0, 50),
      avgDemand: Math.round(Number(s?.avg_demand ?? 0) * 100) / 100,
      demandStdDev: Math.round(Number(s?.demand_std_dev ?? 0) * 100) / 100,
      serviceLevelPct: Math.max(0, Math.min(100, Number(s?.service_level_pct ?? 95))),
      leadTimeDays: Math.max(1, Number(s?.lead_time_days ?? 7)),
      safetyStockUnits: Math.max(0, Number(s?.safety_stock_units ?? 0)),
      currentSafetyStock: Math.max(0, Number(s?.current_safety_stock ?? 0)),
      safetyStockStatus: ['adequate', 'low', 'critical', 'excess'].includes(String(s?.safety_stock_status)) ? String(s.safety_stock_status) : 'adequate',
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 10).map((r: any) => ({
      category: String(r?.category ?? '').slice(0, 50),
      action: String(r?.action ?? '').slice(0, 300),
      quantityToReorder: Math.max(0, Number(r?.quantity_to_reorder ?? 0)),
      expectedCostEur: Math.round(Number(r?.expected_cost_eur ?? 0)),
      expectedRevenueEur: Math.round(Number(r?.expected_revenue_eur ?? 0)),
      supplierLeadTimeDays: Math.max(1, Number(r?.supplier_lead_time_days ?? 7)),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['prophet', 'arima', 'lstm', 'gradient_boosting', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: ['demand_forecast', 'reorder_optimization', 'stockout_prediction', 'lead_time_forecast'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'demand_forecast',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      reorderOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.reorder_optimization_score ?? 50))),
      reorderGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.reorder_grade)) ? String(parsed.summary.reorder_grade) : 'C',
      totalReorderValueEur: Math.round(Number(parsed?.summary?.total_reorder_value_eur ?? 0)),
      urgentReordersCount: Math.max(0, Number(parsed?.summary?.urgent_reorders_count ?? 0)),
      stockoutRiskCount: Math.max(0, Number(parsed?.summary?.stockout_risk_count ?? 0)),
      biggestReorderRisk: String(parsed?.summary?.biggest_reorder_risk ?? '').slice(0, 200),
      biggestReorderOpportunity: String(parsed?.summary?.biggest_reorder_opportunity ?? '').slice(0, 200),
      quickestReorderWin: String(parsed?.summary?.quickest_reorder_win ?? '').slice(0, 200),
      reorderAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.reorder_analysis_score ?? 50))),
    },
  };
}
