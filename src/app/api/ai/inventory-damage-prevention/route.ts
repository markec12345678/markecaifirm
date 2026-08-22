// v6.92 / v8.95.6-inventory: AI Inventory Damage Prevention — ML preprečevanje škode na inventarju z risk assessment
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-damage-prevention
// Body: { days?: number }
// Returns: { ok, preventer: { overview, riskItems, damageTypes, preventionMeasures, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const DAMAGE_TYPES = ['physical_damage', 'moisture_damage', 'temperature_damage', 'uv_damage', 'pest_damage', 'theft_risk', 'fire_risk', 'electrical_damage', 'chemical_damage', 'handling_damage'] as const;
const PREVENTION_LEVELS = ['critical_prevention', 'high_prevention', 'moderate_prevention', 'low_prevention', 'no_prevention_needed'] as const;

interface InventoryDamagePreventionInput {
  days: number;
}

export const POST = withAiRoute<InventoryDamagePreventionInput>({
  endpoint: '/api/ai/inventory-damage-prevention',
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
      return apiOk({ ok: true, preventer: null, message: 'Ni inventarja za damage prevention analizo.' });
    }

    const now = Date.now();
    const stats = computeDamageStats(heldTrades, now);
    const topItems = buildTopItemsList(heldTrades, now);

    const prompt = buildDamagePrompt({ stats, days, itemsCount: heldTrades.length, topItems });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const preventer = transformPreventer(parsed, stats, heldTrades.length);

    return apiOk({ ok: true, preventer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface DamageHeldRow {
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
}

interface DamageStats {
  totalValue: number;
  avgAgeDays: number;
}

function computeDamageStats(heldTrades: DamageHeldRow[], now: number): DamageStats {
  const DAY = 24 * 60 * 60 * 1000;
  const totalValue = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
  const avgAgeDays = Math.round(heldTrades.reduce((s, t) => s + Math.floor((now - t.buyDate.getTime()) / DAY), 0) / Math.max(1, heldTrades.length));
  return { totalValue, avgAgeDays };
}

function buildTopItemsList(heldTrades: DamageHeldRow[], now: number): string {
  const DAY = 24 * 60 * 60 * 1000;
  return heldTrades.slice(0, 12).map(t => `- ${t.title} | ${t.category} | ${t.buyPrice}€ | ${Math.floor((now - t.buyDate.getTime()) / DAY)}d`).join('\n');
}

interface DamagePromptInput {
  stats: DamageStats;
  days: number;
  itemsCount: number;
  topItems: string;
}

function buildDamagePrompt(input: DamagePromptInput): string {
  const { stats, days, itemsCount, topItems } = input;
  return `Si AI inventory damage prevention z ML in risk assessment.
Preprečuje škodo na inventarju z 10 tipi škode in 5 nivoji preprečevanja.

STATS:
- Total items: ${itemsCount} | vrednost: ${Math.round(stats.totalValue)}€
- Povprečna starost: ${stats.avgAgeDays} dni
- Analiza za: ${days} dni

TOP ITEMS:
${topItems}

10 tipov škode:
1. PHYSICAL_DAMAGE: fizična škoda
2. MOISTURE_DAMAGE: vlaga
3. TEMPERATURE_DAMAGE: temperatura
4. UV_DAMAGE: UV žarki
5. PEST_DAMAGE: škodljivci
6. THEFT_RISK: tatvina
7. FIRE_RISK: požar
8. ELECTRICAL_DAMAGE: električna
9. CHEMICAL_DAMAGE: kemična
10. HANDLING_DAMAGE: rokovanje

5 nivojev preprečevanja: critical_prevention, high_prevention, moderate_prevention, low_prevention, no_prevention_needed

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_items": <number>, "total_value_eur": <number>, "at_risk_items_count": <number>, "at_risk_value_eur": <number>, "damage_probability_avg_pct": <number 0-100>, "prevention_grade": "<A|B|C|D|F>" },
  "riskItems": [
    { "item_title": "<max 100 znakov>", "category": "<string>", "value_eur": <number>, "primary_damage_risk": "<${DAMAGE_TYPES.join('|')}>", "risk_probability_pct": <number 0-100>, "potential_loss_eur": <number>, "prevention_level": "<${PREVENTION_LEVELS.join('|')}>", "recommended_action": "<inspect|secure|relocate|insure|sell_fast|climate_control>" }
  ],
  "damageTypes": [
    { "damage_type": "<${DAMAGE_TYPES.join('|')}>", "affected_items_count": <number>, "affected_value_eur": <number>, "avg_probability_pct": <number 0-100>, "primary_cause": "<max 100 znakov>", "prevention_cost_eur": <number>, "prevention_roi_pct": <number> }
  ],
  "preventionMeasures": [
    { "measure": "<max 150 znakov>", "damage_type": "<${DAMAGE_TYPES.join('|')}>", "cost_eur": <number>, "implementation_days": <number>, "items_protected_count": <number>, "value_protected_eur": <number>, "roi_pct": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<random_forest|xgboost|neural_net|isolation_forest|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<damage_prediction|risk_assessment|loss_forecast|anomaly_detection>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "damage_prevention_score": <number 0-100>, "prevention_grade": "<A|B|C|D|F>", "total_at_risk_value_eur": <number>,
    "preventable_loss_eur": <number>, "critical_items_count": <number>,
    "biggest_damage_risk": "<max 100 znakov>", "biggest_prevention_opportunity": "<max 100 znakov>",
    "quickest_prevention_win": "<max 100 znakov>", "damage_prevention_analysis_score": <number 0-100>
  }
}`;
}

function transformPreventer(parsed: any, stats: DamageStats, heldCount: number) {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    overview: { totalItems: Math.max(0, Number(parsed?.overview?.total_items ?? heldCount)), totalValueEur: Math.round(Number(parsed?.overview?.total_value_eur ?? stats.totalValue)), atRiskItemsCount: Math.max(0, Number(parsed?.overview?.at_risk_items_count ?? 0)), atRiskValueEur: Math.round(Number(parsed?.overview?.at_risk_value_eur ?? 0)), damageProbabilityAvgPct: Math.max(0, Math.min(100, Number(parsed?.overview?.damage_probability_avg_pct ?? 20))), preventionGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.prevention_grade)) ? String(parsed.overview.prevention_grade) : 'C' },
    riskItems: (parsed?.riskItems || []).slice(0, 15).map((r: any) => ({ itemTitle: String(r?.item_title ?? '').slice(0, 200), category: String(r?.category ?? '').slice(0, 50), valueEur: Math.round(Number(r?.value_eur ?? 0)), primaryDamageRisk: (DAMAGE_TYPES as readonly string[]).includes(String(r?.primary_damage_risk)) ? String(r.primary_damage_risk) : 'physical_damage', riskProbabilityPct: Math.max(0, Math.min(100, Number(r?.risk_probability_pct ?? 20))), potentialLossEur: Math.round(Number(r?.potential_loss_eur ?? 0)), preventionLevel: (PREVENTION_LEVELS as readonly string[]).includes(String(r?.prevention_level)) ? String(r.prevention_level) : 'moderate_prevention', recommendedAction: ['inspect', 'secure', 'relocate', 'insure', 'sell_fast', 'climate_control'].includes(String(r?.recommended_action)) ? String(r.recommended_action) : 'inspect' })),
    damageTypes: (parsed?.damageTypes || []).slice(0, 10).map((d: any) => ({ damageType: (DAMAGE_TYPES as readonly string[]).includes(String(d?.damage_type)) ? String(d.damage_type) : 'physical_damage', affectedItemsCount: Math.max(0, Number(d?.affected_items_count ?? 0)), affectedValueEur: Math.round(Number(d?.affected_value_eur ?? 0)), avgProbabilityPct: Math.max(0, Math.min(100, Number(d?.avg_probability_pct ?? 20))), primaryCause: String(d?.primary_cause ?? '').slice(0, 200), preventionCostEur: Math.round(Number(d?.prevention_cost_eur ?? 0)), preventionRoiPct: Math.round(Number(d?.prevention_roi_pct ?? 0) * 10) / 10 })),
    preventionMeasures: (parsed?.preventionMeasures || []).slice(0, 10).map((p: any) => ({ measure: String(p?.measure ?? '').slice(0, 300), damageType: (DAMAGE_TYPES as readonly string[]).includes(String(p?.damage_type)) ? String(p.damage_type) : 'physical_damage', costEur: Math.round(Number(p?.cost_eur ?? 0)), implementationDays: Math.max(1, Number(p?.implementation_days ?? 7)), itemsProtectedCount: Math.max(0, Number(p?.items_protected_count ?? 0)), valueProtectedEur: Math.round(Number(p?.value_protected_eur ?? 0)), roiPct: Math.round(Number(p?.roi_pct ?? 0) * 10) / 10, priority: ['high', 'medium', 'low'].includes(String(p?.priority)) ? String(p.priority) : 'medium' })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['random_forest', 'xgboost', 'neural_net', 'isolation_forest', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['damage_prediction', 'risk_assessment', 'loss_forecast', 'anomaly_detection'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'damage_prediction', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
    summary: { damagePreventionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.damage_prevention_score ?? 50))), preventionGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.prevention_grade)) ? String(parsed.summary.prevention_grade) : 'C', totalAtRiskValueEur: Math.round(Number(parsed?.summary?.total_at_risk_value_eur ?? 0)), preventableLossEur: Math.round(Number(parsed?.summary?.preventable_loss_eur ?? 0)), criticalItemsCount: Math.max(0, Number(parsed?.summary?.critical_items_count ?? 0)), biggestDamageRisk: String(parsed?.summary?.biggest_damage_risk ?? '').slice(0, 200), biggestPreventionOpportunity: String(parsed?.summary?.biggest_prevention_opportunity ?? '').slice(0, 200), quickestPreventionWin: String(parsed?.summary?.quickest_prevention_win ?? '').slice(0, 200), damagePreventionAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.damage_prevention_analysis_score ?? 50))) },
  };
}
