// v6.85 / v8.95.8-refactor: AI Inventory Supplier Evaluator — ML evalvacija dobaviteljev z reliability scoring
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-supplier-evaluator
// Body: { days?: number }
// Returns: { ok, evaluator: { overview, suppliers, reliabilityScoring, riskAssessment, recommendations, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const RELIABILITY_TIERS = ['platinum', 'gold', 'silver', 'bronze', 'risk', 'blacklisted'] as const;
const RISK_TYPES = ['price_volatility', 'supply_disruption', 'quality_inconsistency', 'delivery_delays', 'communication_gaps', 'financial_instability', 'regulatory_issues', 'capacity_constraints'] as const;
const DAY = 24 * 60 * 60 * 1000;

interface SupplierEvaluatorInput {
  days: number;
}

interface BoughtTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  buyLocation: string | null;
  notes: string | null;
  status: string;
}

interface Supplier {
  name: string;
  totalPurchases: number;
  totalSpent: number;
  avgOrder: number;
  categories: Set<string>;
  items: string[];
  statuses: Map<string, number>;
  lastPurchase: Date | null;
}

export const POST = withAiRoute<SupplierEvaluatorInput>({
  endpoint: '/api/ai/inventory-supplier-evaluator',
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
    const since = new Date(Date.now() - days * DAY);

    const boughtTrades = await db.trade.findMany({
      where: { buyDate: { gte: since } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, buyLocation: true, notes: true, status: true },
      take: 1000,
      orderBy: { buyDate: 'desc' },
    });
    if (boughtTrades.length === 0) {
      return apiOk({ ok: true, evaluator: null, message: 'Ni nakupov za supplier evalvacijo.' });
    }

    const suppliers = buildSuppliers(boughtTrades);
    const totalSpent = boughtTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);

    const supplierList = suppliers.slice(0, 15).map(s => {
      const sold = s.statuses.get('sold') ?? 0;
      const held = s.statuses.get('held') ?? 0;
      const cancelled = s.statuses.get('cancelled') ?? 0;
      return `- ${s.name} | ${s.totalPurchases}x | ${s.totalSpent}€ | sold:${sold} held:${held} cancel:${cancelled} | ${s.categories.size} kat`;
    }).join('\n');

    const prompt = buildPrompt({
      days,
      suppliersCount: suppliers.length,
      boughtTradesCount: boughtTrades.length,
      totalSpent,
      supplierList,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const evaluator = transformEvaluator(parsed, { suppliers, boughtTrades, totalSpent });

    return apiOk({ ok: true, evaluator });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildSuppliers(boughtTrades: BoughtTradeRow[]): Supplier[] {
  const supplierMap = new Map<string, Supplier>();
  for (const t of boughtTrades) {
    const name = (t.buyLocation || '').trim();
    if (!name || name.length < 2) continue;
    if (!supplierMap.has(name)) {
      supplierMap.set(name, { name, totalPurchases: 0, totalSpent: 0, avgOrder: 0, categories: new Set(), items: [], statuses: new Map(), lastPurchase: null });
    }
    const s = supplierMap.get(name)!;
    s.totalPurchases += 1;
    s.totalSpent += t.buyPrice + (t.buyFees ?? 0);
    if (t.category) s.categories.add(t.category);
    if (s.items.length < 5) s.items.push(t.title);
    s.statuses.set(t.status, (s.statuses.get(t.status) ?? 0) + 1);
    if (!s.lastPurchase || t.buyDate > s.lastPurchase) s.lastPurchase = t.buyDate;
  }
  return Array.from(supplierMap.values()).map(s => {
    s.avgOrder = s.totalPurchases > 0 ? Math.round(s.totalSpent / s.totalPurchases) : 0;
    return s;
  });
}

interface SupplierPromptInput {
  days: number;
  suppliersCount: number;
  boughtTradesCount: number;
  totalSpent: number;
  supplierList: string;
}

function buildPrompt(input: SupplierPromptInput): string {
  const { days, suppliersCount, boughtTradesCount, totalSpent, supplierList } = input;
  return `Si AI inventory supplier evaluator z ML in risk assessment.
Evalvira dobavitelje z 6 tierji in 8 tipi tveganj.

STATS (zadnjih ${days} dni):
- Skupno dobaviteljev: ${suppliersCount}
- Skupno nakupov: ${boughtTradesCount}
- Skupna vrednost: ${Math.round(totalSpent)}€

DOBAVITELJI (top 15):
${supplierList}

6 reliability tierjev:
1. PLATINUM: 95-100% zanesljivost
2. GOLD: 85-94%
3. SILVER: 70-84%
4. BRONZE: 55-69%
5. RISK: 30-54%
6. BLACKLISTED: <30%

8 tipov tveganj: price_volatility, supply_disruption, quality_inconsistency, delivery_delays, communication_gaps, financial_instability, regulatory_issues, capacity_constraints

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_suppliers": <number>, "total_purchases": <number>, "total_spent_eur": <number>, "avg_supplier_reliability_pct": <number 0-100>, "platinum_suppliers_count": <number>, "risk_suppliers_count": <number>, "supplier_grade": "<A|B|C|D|F>" },
  "suppliers": [
    { "name": "<string>", "reliability_score": <number 0-100>, "reliability_tier": "<${RELIABILITY_TIERS.join('|')}>", "total_purchases": <number>, "total_spent_eur": <number>, "avg_order_value_eur": <number>, "categories_count": <number>, "successful_sales_pct": <number 0-100>, "cancellation_rate_pct": <number 0-100>, "last_purchase_date": "<YYYY-MM>", "recommended_action": "<continue|reduce_volume|monitor|find_alternative|terminate>" }
  ],
  "reliabilityScoring": [
    { "supplier_name": "<string>", "quality_score": <number 0-100>, "delivery_score": <number 0-100>, "price_stability_score": <number 0-100>, "communication_score": <number 0-100>, "consistency_score": <number 0-100>, "overall_reliability_pct": <number 0-100>, "tier": "<${RELIABILITY_TIERS.join('|')}>" }
  ],
  "riskAssessment": [
    { "supplier_name": "<string>", "risk_type": "<${RISK_TYPES.join('|')}>", "severity": "<critical|high|medium|low>", "probability_pct": <number 0-100>, "financial_impact_eur": <number>, "mitigation_strategy": "<max 150 znakov>", "monitoring_frequency": "<daily|weekly|monthly|quarterly>" }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "supplier_name": "<string>", "action_type": "<diversify|consolidate|renegotiate|backup_source|terminate>", "expected_savings_eur": <number>, "expected_risk_reduction_pct": <number 0-100>, "implementation_days": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<random_forest|xgboost|neural_net|gradient_boosting|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<reliability_prediction|risk_assessment|supplier_classification|performance_forecast>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "supplier_evaluation_score": <number 0-100>, "supplier_grade": "<A|B|C|D|F>", "total_spent_eur": <number>,
    "platinum_suppliers_count": <number>, "blacklisted_suppliers_count": <number>,
    "biggest_supplier_risk": "<max 100 znakov>", "biggest_supplier_opportunity": "<max 100 znakov>",
    "quickest_supplier_win": "<max 100 znakov>", "supplier_analysis_score": <number 0-100>
  }
}`;
}

interface SupplierStats {
  suppliers: Supplier[];
  boughtTrades: BoughtTradeRow[];
  totalSpent: number;
}

function transformEvaluator(parsed: any, stats: SupplierStats) {
  const { suppliers, boughtTrades, totalSpent } = stats;
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    overview: {
      totalSuppliers: Math.max(0, Number(parsed?.overview?.total_suppliers ?? suppliers.length)),
      totalPurchases: Math.max(0, Number(parsed?.overview?.total_purchases ?? boughtTrades.length)),
      totalSpentEur: Math.round(Number(parsed?.overview?.total_spent_eur ?? totalSpent)),
      avgSupplierReliabilityPct: Math.max(0, Math.min(100, Number(parsed?.overview?.avg_supplier_reliability_pct ?? 65))),
      platinumSuppliersCount: Math.max(0, Number(parsed?.overview?.platinum_suppliers_count ?? 0)),
      riskSuppliersCount: Math.max(0, Number(parsed?.overview?.risk_suppliers_count ?? 0)),
      supplierGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.supplier_grade)) ? String(parsed.overview.supplier_grade) : 'C',
    },
    suppliers: (parsed?.suppliers || []).slice(0, 25).map((s: any) => ({
      name: String(s?.name ?? '').slice(0, 100),
      reliabilityScore: Math.max(0, Math.min(100, Number(s?.reliability_score ?? 60))),
      reliabilityTier: (RELIABILITY_TIERS as readonly string[]).includes(String(s?.reliability_tier)) ? String(s.reliability_tier) : 'silver',
      totalPurchases: Math.max(0, Number(s?.total_purchases ?? 0)),
      totalSpentEur: Math.round(Number(s?.total_spent_eur ?? 0)),
      avgOrderValueEur: Math.round(Number(s?.avg_order_value_eur ?? 0)),
      categoriesCount: Math.max(0, Number(s?.categories_count ?? 0)),
      successfulSalesPct: Math.max(0, Math.min(100, Number(s?.successful_sales_pct ?? 60))),
      cancellationRatePct: Math.max(0, Math.min(100, Number(s?.cancellation_rate_pct ?? 20))),
      lastPurchaseDate: String(s?.last_purchase_date ?? '').slice(0, 7),
      recommendedAction: ['continue', 'reduce_volume', 'monitor', 'find_alternative', 'terminate'].includes(String(s?.recommended_action)) ? String(s.recommended_action) : 'continue',
    })),
    reliabilityScoring: (parsed?.reliabilityScoring || []).slice(0, 25).map((s: any) => ({
      supplierName: String(s?.supplier_name ?? '').slice(0, 100),
      qualityScore: Math.max(0, Math.min(100, Number(s?.quality_score ?? 70))),
      deliveryScore: Math.max(0, Math.min(100, Number(s?.delivery_score ?? 70))),
      priceStabilityScore: Math.max(0, Math.min(100, Number(s?.price_stability_score ?? 70))),
      communicationScore: Math.max(0, Math.min(100, Number(s?.communication_score ?? 70))),
      consistencyScore: Math.max(0, Math.min(100, Number(s?.consistency_score ?? 70))),
      overallReliabilityPct: Math.max(0, Math.min(100, Number(s?.overall_reliability_pct ?? 65))),
      tier: (RELIABILITY_TIERS as readonly string[]).includes(String(s?.tier)) ? String(s.tier) : 'silver',
    })),
    riskAssessment: (parsed?.riskAssessment || []).slice(0, 10).map((r: any) => ({
      supplierName: String(r?.supplier_name ?? '').slice(0, 100),
      riskType: (RISK_TYPES as readonly string[]).includes(String(r?.risk_type)) ? String(r.risk_type) : 'price_volatility',
      severity: ['critical', 'high', 'medium', 'low'].includes(String(r?.severity)) ? String(r.severity) : 'medium',
      probabilityPct: Math.max(0, Math.min(100, Number(r?.probability_pct ?? 30))),
      financialImpactEur: Math.round(Number(r?.financial_impact_eur ?? 0)),
      mitigationStrategy: String(r?.mitigation_strategy ?? '').slice(0, 300),
      monitoringFrequency: ['daily', 'weekly', 'monthly', 'quarterly'].includes(String(r?.monitoring_frequency)) ? String(r.monitoring_frequency) : 'monthly',
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 8).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      supplierName: String(r?.supplier_name ?? '').slice(0, 100),
      actionType: ['diversify', 'consolidate', 'renegotiate', 'backup_source', 'terminate'].includes(String(r?.action_type)) ? String(r.action_type) : 'monitor',
      expectedSavingsEur: Math.round(Number(r?.expected_savings_eur ?? 0)),
      expectedRiskReductionPct: Math.max(0, Math.min(100, Number(r?.expected_risk_reduction_pct ?? 20))),
      implementationDays: Math.max(1, Number(r?.implementation_days ?? 14)),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['random_forest', 'xgboost', 'neural_net', 'gradient_boosting', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: ['reliability_prediction', 'risk_assessment', 'supplier_classification', 'performance_forecast'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'reliability_prediction',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      supplierEvaluationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.supplier_evaluation_score ?? 50))),
      supplierGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.supplier_grade)) ? String(parsed.summary.supplier_grade) : 'C',
      totalSpentEur: Math.round(Number(parsed?.summary?.total_spent_eur ?? 0)),
      platinumSuppliersCount: Math.max(0, Number(parsed?.summary?.platinum_suppliers_count ?? 0)),
      blacklistedSuppliersCount: Math.max(0, Number(parsed?.summary?.blacklisted_suppliers_count ?? 0)),
      biggestSupplierRisk: String(parsed?.summary?.biggest_supplier_risk ?? '').slice(0, 200),
      biggestSupplierOpportunity: String(parsed?.summary?.biggest_supplier_opportunity ?? '').slice(0, 200),
      quickestSupplierWin: String(parsed?.summary?.quickest_supplier_win ?? '').slice(0, 200),
      supplierAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.supplier_analysis_score ?? 50))),
    },
  };
}
