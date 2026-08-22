// v6.84 / v8.95.8-refactor: AI Inventory Storage Optimizer — ML optimizacija skladiščnih prostorov z layout analysis
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-storage-optimizer
// Body: { days?: number }
// Returns: { ok, optimizer: { overview, storageZones, layoutOptimization, recommendations, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const ZONE_TYPES = ['fast_access', 'bulk_storage', 'fragile_zone', 'climate_controlled', 'high_value', 'overflow', 'returns', 'staging'] as const;
const STORAGE_TIERS = ['tier_1_premium', 'tier_2_standard', 'tier_3_economy', 'tier_4_overflow', 'tier_5_offsite'] as const;
const DAY = 24 * 60 * 60 * 1000;

interface StorageOptimizerInput {
  days: number;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  buyLocation: string | null;
  notes: string | null;
  listingId: string | null;
}

interface SoldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  sellPrice: number | null;
  sellDate: Date | null;
  buyDate: Date;
}

export const POST = withAiRoute<StorageOptimizerInput>({
  endpoint: '/api/ai/inventory-storage-optimizer',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      days: Math.max(7, Math.min(365, Number(body?.days ?? 90))),
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { days } = input;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, buyLocation: true, notes: true, listingId: true },
      take: 500,
      orderBy: { buyDate: 'desc' },
    });
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { gte: new Date(Date.now() - days * DAY) } },
      select: { id: true, title: true, category: true, buyPrice: true, sellPrice: true, sellDate: true, buyDate: true },
      take: 500,
    });
    if (heldTrades.length === 0) {
      return apiOk({ ok: true, optimizer: null, message: 'Ni inventarja za storage optimizacijo.' });
    }

    const now = Date.now();
    const stats = computeStorageStats(heldTrades, soldTrades, now, days);

    const prompt = buildPrompt({
      totalItems: stats.totalItems,
      totalValue: stats.totalValue,
      avgItemValue: stats.avgItemValue,
      avgAge: stats.avgAge,
      days,
      catList: stats.catList,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const optimizer = transformOptimizer(parsed, stats);

    return apiOk({ ok: true, optimizer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface StorageStats {
  totalItems: number;
  totalValue: number;
  avgItemValue: number;
  avgAge: number;
  catList: string;
}

function computeStorageStats(heldTrades: HeldTradeRow[], soldTrades: SoldTradeRow[], now: number, days: number): StorageStats {
  const totalValue = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
  const totalItems = heldTrades.length;
  const avgItemValue = totalItems > 0 ? Math.round(totalValue / totalItems) : 0;
  const avgAge = Math.round(heldTrades.reduce((s, t) => s + Math.floor((now - t.buyDate.getTime()) / DAY), 0) / Math.max(1, totalItems));

  // Category sold velocity
  const catSold = new Map<string, number>();
  for (const t of soldTrades) {
    const cat = t.category || 'unknown';
    catSold.set(cat, (catSold.get(cat) ?? 0) + 1);
  }
  const catHeld = new Map<string, { count: number; value: number }>();
  for (const t of heldTrades) {
    const cat = t.category || 'unknown';
    if (!catHeld.has(cat)) catHeld.set(cat, { count: 0, value: 0 });
    catHeld.get(cat)!.count += 1;
    catHeld.get(cat)!.value += t.buyPrice + (t.buyFees ?? 0);
  }

  const catList = Array.from(catHeld.entries()).slice(0, 12).map(([cat, s]) => `- ${cat} | ${s.count} items | ${Math.round(s.value)}€ | sold ${catSold.get(cat) ?? 0} v ${days}d`).join('\n');

  return { totalItems, totalValue, avgItemValue, avgAge, catList };
}

interface StoragePromptInput {
  totalItems: number;
  totalValue: number;
  avgItemValue: number;
  avgAge: number;
  days: number;
  catList: string;
}

function buildPrompt(input: StoragePromptInput): string {
  const { totalItems, totalValue, avgItemValue, avgAge, days, catList } = input;
  return `Si AI inventory storage optimizer z ML in layout analysis.
Optimizira skladiščne prostore z 8 conami in 5 tierji.

STATS:
- Total items: ${totalItems} | vrednost: ${Math.round(totalValue)}€
- Povprečna vrednost itema: ${avgItemValue}€
- Povprečna starost: ${avgAge} dni
- Analiza za: ${days} dni

KATEGORIJE (held/sold/value):
${catList}

8 con skladišča:
1. FAST_ACCESS: hitri dostop
2. BULK_STORAGE: masovno skladiščenje
3. FRAGILE_ZONE: občutljivo
4. CLIMATE_CONTROLLED: klimatizirano
5. HIGH_VALUE: visoka vrednost
6. OVERFLOW: preliv
7. RETURNS: vračila
8. STAGING: predpriprava

5 storage tierjev: tier_1_premium, tier_2_standard, tier_3_economy, tier_4_overflow, tier_5_offsite

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_items": <number>, "total_value_eur": <number>, "estimated_storage_cost_eur": <number>, "storage_efficiency_pct": <number 0-100>, "space_utilization_pct": <number 0-100>, "avg_item_value_eur": <number>, "storage_grade": "<A|B|C|D|F>" },
  "storageZones": [
    { "zone_type": "<${ZONE_TYPES.join('|')}>", "recommended_categories": "<max 150 znakov>", "item_count": <number>, "value_eur": <number>, "utilization_pct": <number 0-100>, "access_frequency": "<high|medium|low>", "climate_required": <boolean>, "security_level": "<standard|enhanced|maximum>" }
  ],
  "layoutOptimization": [
    { "current_layout": "<max 100 znakov>", "optimized_layout": "<max 100 znakov>", "space_saved_pct": <number 0-50>, "access_time_reduction_pct": <number 0-50>, "implementation_days": <number>, "cost_eur": <number>, "savings_eur_monthly": <number> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "zone_type": "<${ZONE_TYPES.join('|')}>", "tier": "<${STORAGE_TIERS.join('|')}>", "affected_items": <number>, "expected_cost_savings_eur_monthly": <number>, "implementation_days": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<k-means|dbscan|linear_regression|neural_net|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<layout_optimization|demand_prediction|space_forecast|access_pattern>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "storage_optimization_score": <number 0-100>, "storage_grade": "<A|B|C|D|F>", "total_storage_cost_eur_monthly": <number>,
    "potential_monthly_savings_eur": <number>, "space_utilization_pct": <number 0-100>,
    "biggest_storage_risk": "<max 100 znakov>", "biggest_storage_opportunity": "<max 100 znakov>",
    "quickest_storage_win": "<max 100 znakov>", "storage_analysis_score": <number 0-100>
  }
}`;
}

function transformOptimizer(parsed: any, stats: StorageStats) {
  const { totalItems, totalValue, avgItemValue } = stats;
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    overview: {
      totalItems: Math.max(0, Number(parsed?.overview?.total_items ?? totalItems)),
      totalValueEur: Math.round(Number(parsed?.overview?.total_value_eur ?? totalValue)),
      estimatedStorageCostEur: Math.round(Number(parsed?.overview?.estimated_storage_cost_eur ?? totalValue * 0.02)),
      storageEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.overview?.storage_efficiency_pct ?? 60))),
      spaceUtilizationPct: Math.max(0, Math.min(100, Number(parsed?.overview?.space_utilization_pct ?? 65))),
      avgItemValueEur: Math.round(Number(parsed?.overview?.avg_item_value_eur ?? avgItemValue)),
      storageGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.storage_grade)) ? String(parsed.overview.storage_grade) : 'C',
    },
    storageZones: (parsed?.storageZones || []).slice(0, 8).map((z: any) => ({
      zoneType: (ZONE_TYPES as readonly string[]).includes(String(z?.zone_type)) ? String(z.zone_type) : 'fast_access',
      recommendedCategories: String(z?.recommended_categories ?? '').slice(0, 300),
      itemCount: Math.max(0, Number(z?.item_count ?? 0)),
      valueEur: Math.round(Number(z?.value_eur ?? 0)),
      utilizationPct: Math.max(0, Math.min(100, Number(z?.utilization_pct ?? 50))),
      accessFrequency: ['high', 'medium', 'low'].includes(String(z?.access_frequency)) ? String(z.access_frequency) : 'medium',
      climateRequired: Boolean(z?.climate_required ?? false),
      securityLevel: ['standard', 'enhanced', 'maximum'].includes(String(z?.security_level)) ? String(z.security_level) : 'standard',
    })),
    layoutOptimization: (parsed?.layoutOptimization || []).slice(0, 6).map((l: any) => ({
      currentLayout: String(l?.current_layout ?? '').slice(0, 200),
      optimizedLayout: String(l?.optimized_layout ?? '').slice(0, 200),
      spaceSavedPct: Math.max(0, Math.min(50, Number(l?.space_saved_pct ?? 10))),
      accessTimeReductionPct: Math.max(0, Math.min(50, Number(l?.access_time_reduction_pct ?? 20))),
      implementationDays: Math.max(1, Number(l?.implementation_days ?? 7)),
      costEur: Math.round(Number(l?.cost_eur ?? 0)),
      savingsEurMonthly: Math.round(Number(l?.savings_eur_monthly ?? 0)),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 8).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      zoneType: (ZONE_TYPES as readonly string[]).includes(String(r?.zone_type)) ? String(r.zone_type) : 'fast_access',
      tier: (STORAGE_TIERS as readonly string[]).includes(String(r?.tier)) ? String(r.tier) : 'tier_2_standard',
      affectedItems: Math.max(0, Number(r?.affected_items ?? 0)),
      expectedCostSavingsEurMonthly: Math.round(Number(r?.expected_cost_savings_eur_monthly ?? 0)),
      implementationDays: Math.max(1, Number(r?.implementation_days ?? 7)),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['k-means', 'dbscan', 'linear_regression', 'neural_net', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: ['layout_optimization', 'demand_prediction', 'space_forecast', 'access_pattern'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'layout_optimization',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      storageOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.storage_optimization_score ?? 50))),
      storageGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.storage_grade)) ? String(parsed.summary.storage_grade) : 'C',
      totalStorageCostEurMonthly: Math.round(Number(parsed?.summary?.total_storage_cost_eur_monthly ?? totalValue * 0.002)),
      potentialMonthlySavingsEur: Math.round(Number(parsed?.summary?.potential_monthly_savings_eur ?? totalValue * 0.005)),
      spaceUtilizationPct: Math.max(0, Math.min(100, Number(parsed?.summary?.space_utilization_pct ?? 65))),
      biggestStorageRisk: String(parsed?.summary?.biggest_storage_risk ?? '').slice(0, 200),
      biggestStorageOpportunity: String(parsed?.summary?.biggest_storage_opportunity ?? '').slice(0, 200),
      quickestStorageWin: String(parsed?.summary?.quickest_storage_win ?? '').slice(0, 200),
      storageAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.storage_analysis_score ?? 50))),
    },
  };
}
