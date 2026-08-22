// v6.89 / v8.95.6-inventory: AI Inventory Aging Strategist — ML strategija za staranje inventarja z action planning
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-aging-strategist
// Body: { days?: number }
// Returns: { ok, strategist: { overview, agingStrategy, categoryAging, actionPlan, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const STRATEGY_TIERS = ['aggressive_disposal', 'discount_heavy', 'moderate_discount', 'strategic_hold', 'opportunistic_sale', 'premium_positioning'] as const;
const AGING_PHASES = ['introduction', 'growth', 'maturity', 'decline', 'critical', 'terminal'] as const;

interface InventoryAgingStrategistInput {
  days: number;
}

export const POST = withAiRoute<InventoryAgingStrategistInput>({
  endpoint: '/api/ai/inventory-aging-strategist',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget + avtomatsko recordAiCall po uspehu

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      days: Math.max(7, Math.min(365, Number(body?.days ?? 90))),
    };
  },

  // No validateInput — days ima default 90 z clamp 7-365

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { days } = input;

    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, buyLocation: true, notes: true, listingId: true }, take: 500, orderBy: { buyDate: 'desc' } });
    if (heldTrades.length === 0) {
      return apiOk({ ok: true, strategist: null, message: 'Ni inventarja za aging strategijo.' });
    }

    const now = Date.now();
    const items = computeStrategistItems(heldTrades, now);
    const stats = computeStrategistStats(items);

    const topCritical = stats.criticalItems.slice(0, 10).map(i => `- ${i.title} | ${i.category} | ${i.ageDays}d | ${i.cost}€ | ${i.phase}`).join('\n');

    const prompt = buildStrategistPrompt({ stats, days, itemsCount: items.length, topCritical });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const strategist = transformStrategist(parsed, stats, items.length);

    return apiOk({ ok: true, strategist });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface StrategistHeldRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
}

interface StrategistItem {
  id: string;
  title: string;
  category: string;
  ageDays: number;
  cost: number;
  phase: string;
}

interface StrategistStats {
  totalValue: number;
  avgAge: number;
  criticalItems: StrategistItem[];
  criticalValue: number;
}

function computeStrategistItems(heldTrades: StrategistHeldRow[], now: number): StrategistItem[] {
  const DAY = 24 * 60 * 60 * 1000;
  return heldTrades.map(t => {
    const ageDays = Math.floor((now - t.buyDate.getTime()) / DAY);
    const cost = t.buyPrice + (t.buyFees ?? 0);
    let phase = 'introduction';
    if (ageDays > 365) phase = 'terminal';
    else if (ageDays > 180) phase = 'critical';
    else if (ageDays > 90) phase = 'decline';
    else if (ageDays > 60) phase = 'maturity';
    else if (ageDays > 30) phase = 'growth';
    return { id: t.id, title: t.title, category: t.category, ageDays, cost, phase };
  });
}

function computeStrategistStats(items: StrategistItem[]): StrategistStats {
  const totalValue = items.reduce((s, i) => s + i.cost, 0);
  const avgAge = Math.round(items.reduce((s, i) => s + i.ageDays, 0) / Math.max(1, items.length));
  const criticalItems = items.filter(i => i.phase === 'critical' || i.phase === 'terminal');
  const criticalValue = criticalItems.reduce((s, i) => s + i.cost, 0);
  return { totalValue, avgAge, criticalItems, criticalValue };
}

interface StrategistPromptInput {
  stats: StrategistStats;
  days: number;
  itemsCount: number;
  topCritical: string;
}

function buildStrategistPrompt(input: StrategistPromptInput): string {
  const { stats, days, itemsCount, topCritical } = input;
  return `Si AI inventory aging strategist z ML in lifecycle analysis.
Strategizira staranje inventarja z 6 strategijami in 6 fazami.

STATS:
- Total items: ${itemsCount} | vrednost: ${Math.round(stats.totalValue)}€
- Povprečna starost: ${stats.avgAge} dni
- Critical/terminal items: ${stats.criticalItems.length} | vrednost: ${Math.round(stats.criticalValue)}€
- Analiza za: ${days} dni

TOP CRITICAL/TERMINAL ITEMS:
${topCritical || 'brez'}

6 strategijskih tierjev:
1. AGGRESSIVE_DISPOSAL: takojšnja odtujitev
2. DISCOUNT_HEAVY: močan popust (30-50%)
3. MODERATE_DISCOUNT: zmeren popust (10-30%)
4. STRATEGIC_HOLD: strateško zadrževanje
5. OPPORTUNISTIC_SALE: priložnostna prodaja
6. PREMIUM_POSITIONING: premium pozicioniranje

6 faz staranja: introduction, growth, maturity, decline, critical, terminal

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_items": <number>, "total_value_eur": <number>, "avg_age_days": <number>, "critical_items_count": <number>, "critical_value_eur": <number>, "devaluation_at_risk_eur": <number>, "aging_strategy_grade": "<A|B|C|D|F>" },
  "agingStrategy": [
    { "phase": "<${AGING_PHASES.join('|')}>", "item_count": <number>, "total_value_eur": <number>, "value_pct": <number 0-100>, "recommended_strategy": "<${STRATEGY_TIERS.join('|')}>", "time_window_days": <number>, "expected_recovery_pct": <number 0-100>, "action_urgency": "<immediate|within_7d|within_30d|within_90d>" }
  ],
  "categoryAging": [
    { "category": "<string>", "total_items": <number>, "avg_age_days": <number>, "oldest_item_days": <number>, "critical_count": <number>, "devaluation_risk_eur": <number>, "category_strategy": "<${STRATEGY_TIERS.join('|')}>", "trend": "<improving|stable|worsening>" }
  ],
  "actionPlan": [
    { "action": "<max 150 znakov>", "strategy_tier": "<${STRATEGY_TIERS.join('|')}>", "target_items_count": <number>, "expected_recovery_eur": <number>, "loss_acceptance_eur": <number>, "implementation_days": <number>, "priority": "<high|medium|low>", "success_probability_pct": <number 0-100> }
  ],
  "mlModels": [
    { "model": "<prophet|lstm|arima|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<aging_forecast|devaluation_prediction|recovery_optimization|lifecycle_analysis>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "aging_strategy_score": <number 0-100>, "aging_strategy_grade": "<A|B|C|D|F>", "total_devaluation_at_risk_eur": <number>,
    "recoverable_value_eur": <number>, "immediate_action_count": <number>,
    "biggest_aging_risk": "<max 100 znakov>", "biggest_aging_opportunity": "<max 100 znakov>",
    "quickest_aging_win": "<max 100 znakov>", "aging_strategy_analysis_score": <number 0-100>
  }
}`;
}

function transformStrategist(parsed: any, stats: StrategistStats, itemsCount: number) {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    overview: { totalItems: Math.max(0, Number(parsed?.overview?.total_items ?? itemsCount)), totalValueEur: Math.round(Number(parsed?.overview?.total_value_eur ?? stats.totalValue)), avgAgeDays: Math.max(0, Number(parsed?.overview?.avg_age_days ?? stats.avgAge)), criticalItemsCount: Math.max(0, Number(parsed?.overview?.critical_items_count ?? stats.criticalItems.length)), criticalValueEur: Math.round(Number(parsed?.overview?.critical_value_eur ?? stats.criticalValue)), devaluationAtRiskEur: Math.round(Number(parsed?.overview?.devaluation_at_risk_eur ?? stats.criticalValue * 0.3)), agingStrategyGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.aging_strategy_grade)) ? String(parsed.overview.aging_strategy_grade) : 'C' },
    agingStrategy: (parsed?.agingStrategy || []).slice(0, 6).map((s: any) => ({ phase: (AGING_PHASES as readonly string[]).includes(String(s?.phase)) ? String(s.phase) : 'introduction', itemCount: Math.max(0, Number(s?.item_count ?? 0)), totalValueEur: Math.round(Number(s?.total_value_eur ?? 0)), valuePct: Math.max(0, Math.min(100, Number(s?.value_pct ?? 0))), recommendedStrategy: (STRATEGY_TIERS as readonly string[]).includes(String(s?.recommended_strategy)) ? String(s.recommended_strategy) : 'strategic_hold', timeWindowDays: Math.max(0, Number(s?.time_window_days ?? 30)), expectedRecoveryPct: Math.max(0, Math.min(100, Number(s?.expected_recovery_pct ?? 60))), actionUrgency: ['immediate', 'within_7d', 'within_30d', 'within_90d'].includes(String(s?.action_urgency)) ? String(s.action_urgency) : 'within_30d' })),
    categoryAging: (parsed?.categoryAging || []).slice(0, 12).map((c: any) => ({ category: String(c?.category ?? '').slice(0, 50), totalItems: Math.max(0, Number(c?.total_items ?? 0)), avgAgeDays: Math.max(0, Number(c?.avg_age_days ?? 0)), oldestItemDays: Math.max(0, Number(c?.oldest_item_days ?? 0)), criticalCount: Math.max(0, Number(c?.critical_count ?? 0)), devaluationRiskEur: Math.round(Number(c?.devaluation_risk_eur ?? 0)), categoryStrategy: (STRATEGY_TIERS as readonly string[]).includes(String(c?.category_strategy)) ? String(c.category_strategy) : 'strategic_hold', trend: ['improving', 'stable', 'worsening'].includes(String(c?.trend)) ? String(c.trend) : 'stable' })),
    actionPlan: (parsed?.actionPlan || []).slice(0, 10).map((a: any) => ({ action: String(a?.action ?? '').slice(0, 300), strategyTier: (STRATEGY_TIERS as readonly string[]).includes(String(a?.strategy_tier)) ? String(a.strategy_tier) : 'strategic_hold', targetItemsCount: Math.max(0, Number(a?.target_items_count ?? 0)), expectedRecoveryEur: Math.round(Number(a?.expected_recovery_eur ?? 0)), lossAcceptanceEur: Math.round(Number(a?.loss_acceptance_eur ?? 0)), implementationDays: Math.max(1, Number(a?.implementation_days ?? 7)), priority: ['high', 'medium', 'low'].includes(String(a?.priority)) ? String(a.priority) : 'medium', successProbabilityPct: Math.max(0, Math.min(100, Number(a?.success_probability_pct ?? 60))) })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['prophet', 'lstm', 'arima', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['aging_forecast', 'devaluation_prediction', 'recovery_optimization', 'lifecycle_analysis'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'aging_forecast', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
    summary: { agingStrategyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.aging_strategy_score ?? 50))), agingStrategyGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.aging_strategy_grade)) ? String(parsed.summary.aging_strategy_grade) : 'C', totalDevaluationAtRiskEur: Math.round(Number(parsed?.summary?.total_devaluation_at_risk_eur ?? stats.criticalValue * 0.3)), recoverableValueEur: Math.round(Number(parsed?.summary?.recoverable_value_eur ?? stats.criticalValue * 0.6)), immediateActionCount: Math.max(0, Number(parsed?.summary?.immediate_action_count ?? 0)), biggestAgingRisk: String(parsed?.summary?.biggest_aging_risk ?? '').slice(0, 200), biggestAgingOpportunity: String(parsed?.summary?.biggest_aging_opportunity ?? '').slice(0, 200), quickestAgingWin: String(parsed?.summary?.quickest_aging_win ?? '').slice(0, 200), agingStrategyAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.aging_strategy_analysis_score ?? 50))) },
  };
}
