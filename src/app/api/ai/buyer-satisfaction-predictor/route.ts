// v6.67 / v8.95.4-batch3: AI Buyer Satisfaction Predictor — napove zadovoljstvo kupca z ML in NPS prediction
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-satisfaction-predictor
// Body: { customerName?: string }
// Returns: { ok, predictor: { buyers, satisfactionFactors, npsPrediction, interventions, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BuyerSatisfactionPredictorInput {
  customerName: string | null;
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
  buyPrice: number | null;
  buyFees: number | null;
}

interface BuyerRow {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrder: number;
  daysSinceLast: number;
  lastPurchase: Date | null;
  categories: Set<string>;
}

const SATISFACTION_FACTORS = ['price_fairness', 'item_quality', 'communication_quality', 'shipping_speed', 'packaging_quality', 'description_accuracy', 'seller_responsiveness', 'post_sale_support', 'overall_experience', 'value_for_money'] as const;
const SATISFACTION_LEVELS = ['very_satisfied', 'satisfied', 'neutral', 'dissatisfied', 'very_dissatisfied'] as const;
const NPS_CATEGORIES = ['promoter', 'passive', 'detractor'] as const;
const FACTOR_STATUS = ['excellent', 'good', 'average', 'poor', 'critical'] as const;
const IMPROVEMENT_POTENTIAL = ['high', 'medium', 'low'] as const;
const INTERVENTIONS = ['maintain', 'nurture', 'recover', 'escalate'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;
const ML_MODELS = ['random_forest', 'gradient_boosting', 'neural_network', 'logistic_regression', 'ensemble'] as const;
const PREDICTION_TYPES = ['satisfaction', 'nps', 'churn', 'repeat_purchase'] as const;

export const POST = withAiRoute<BuyerSatisfactionPredictorInput>({
  endpoint: '/api/ai/buyer-satisfaction-predictor',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { customerName: body?.customerName ? String(body.customerName).trim() : null };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { customerName } = input;

    const soldTrades: SoldTradeRow[] = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true, buyPrice: true, buyFees: true },
      take: 500, orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, predictor: null, message: 'Ni prodaj za satisfaction prediction.' });
    }

    const buyers = buildBuyers(soldTrades);

    if (customerName) {
      const f = buyers.filter(b => b.name === customerName);
      if (f.length === 0) {
        return apiOk({ ok: true, predictor: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const prompt = buildPrompt(targetBuyers);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const predictor = transformPredictor(parsed, targetBuyers);

    return apiOk({ ok: true, predictor });
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
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    if (!buyerMap.has(name)) {
      buyerMap.set(name, {
        name, purchases: 0, totalSpent: 0, avgOrder: 0, daysSinceLast: 0,
        lastPurchase: t.sellDate, categories: new Set(),
      });
    }
    const b = buyerMap.get(name)!;
    b.purchases += 1;
    b.totalSpent += revenue;
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

function buildPrompt(targetBuyers: BuyerRow[]): string {
  const buyersStr = targetBuyers.slice(0, 15).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d zadnji`).join('\n');

  return `Si AI buyer satisfaction predictor z ML in NPS prediction.
Napove zadovoljstvo kupca z 10-faktorsko analizo in NPS (Net Promoter Score).

KUPCI (${targetBuyers.length}):
${buyersStr}

10 satisfaction faktorjev:
1. PRICE_FAIRNESS: ali je kupec dobil vrednost za ceno
2. ITEM_QUALITY: ali je item ustrezal opisu
3. COMMUNICATION_QUALITY: kakovost komunikacije
4. SHIPPING_SPEED: hitrost dostave/prevzema
5. PACKAGING_QUALITY: kakovost pakiranja
6. DESCRIPTION_ACCURACY: ali je opis ustrezal realnosti
7. SELLER_RESPONSIVENESS: hitrost odgovorov
8. POST_SALE_SUPPORT: support po nakupu
9. OVERALL_EXPERIENCE: splošna izkušnja
10. VALUE_FOR_MONEY: razmerje cena/kakovost

NPS (Net Promoter Score):
- PROMOTERS (9-10): zelo zadovoljni, priporočajo
- PASSIVES (7-8): zadovoljni, a ne priporočajo
- DETRACTORS (0-6): nezadovoljni, odsvetujejo

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    {
      "name": "<ime>", "satisfaction_score": <number 0-100>, "satisfaction_level": "<very_satisfied|satisfied|neutral|dissatisfied|very_dissatisfied>",
      "nps_category": "<promoter|passive|detractor>", "nps_score": <number 0-10>,
      "satisfaction_factors": [{"factor": "<10 faktorjev>", "score": <number 0-100>, "status": "<excellent|good|average|poor|critical>", "improvement_action": "<max 100 znakov>"}],
      "predicted_repeat_purchase_probability_pct": <number 0-100>, "predicted_referral_probability_pct": <number 0-100>,
      "predicted_churn_probability_pct": <number 0-100>, "predicted_lifetime_value_eur": <number>,
      "key_satisfaction_drivers": ["<max 80 znakov>"], "key_dissatisfaction_drivers": ["<max 80 znakov>"],
      "recommended_intervention": "<maintain|nurture|recover|escalate>", "intervention_priority": "<high|medium|low>"
    }
  ],
  "satisfaction_factors": [
    {"factor": "<10 faktorjev>", "weight": <number 0-100>, "avg_score": <number 0-100>, "benchmark": <number 0-100>, "improvement_potential": "<high|medium|low>", "best_practice": "<max 120 znakov>"}
  ],
  "nps_prediction": [
    {"nps_category": "<promoter|passive|detractor>", "buyer_count": <number>, "percentage": <number 0-100>, "avg_satisfaction_score": <number 0-100>, "characteristics": "<max 100 znakov>", "strategy": "<max 120 znakov>"}
  ],
  "interventions": [
    {"intervention": "<max 120 znakov>", "target_satisfaction_level": "<very_satisfied|satisfied|neutral|dissatisfied|very_dissatisfied>", "description": "<max 150 znakov>", "expected_satisfaction_lift_pct": <number>, "implementation_cost_eur": <number>, "priority": "<high|medium|low>"}
  ],
  "ml_models": [
    {"model": "<random_forest|gradient_boosting|neural_network|logistic_regression|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<satisfaction|nps|churn|repeat_purchase>", "weight_in_ensemble": <number 0-100>}
  ],
  "summary": {
    "total_buyers_analyzed": <number>, "avg_satisfaction_score": <number 0-100>,
    "promoter_count": <number>, "passive_count": <number>, "detractor_count": <number>,
    "nps_score": <number -100 do 100>, "avg_repeat_purchase_probability_pct": <number>,
    "biggest_satisfaction_driver": "<max 100 znakov>", "biggest_dissatisfaction_driver": "<max 100 znakov>",
    "satisfaction_prediction_score": <number 0-100>
  }
}`;
}

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function transformPredictor(parsed: any, targetBuyers: BuyerRow[]): any {
  const validNames = new Set(targetBuyers.map(b => b.name));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    buyers: (parsed?.buyers || []).filter((b: any) => validNames.has(String(b?.name ?? ''))).slice(0, 25).map((b: any) => ({
      name: String(b?.name ?? '').slice(0, 100),
      satisfactionScore: clamp(Number(b?.satisfaction_score ?? 60), 0, 100),
      satisfactionLevel: includes(SATISFACTION_LEVELS, String(b?.satisfaction_level)) ? String(b.satisfaction_level) : 'satisfied',
      npsCategory: includes(NPS_CATEGORIES, String(b?.nps_category)) ? String(b.nps_category) : 'passive',
      npsScore: clamp(Number(b?.nps_score ?? 7), 0, 10),
      satisfactionFactors: (b?.satisfaction_factors || []).slice(0, 10).map((f: any) => ({
        factor: includes(SATISFACTION_FACTORS, String(f?.factor)) ? String(f.factor) : 'price_fairness',
        score: clamp(Number(f?.score ?? 50), 0, 100),
        status: includes(FACTOR_STATUS, String(f?.status)) ? String(f.status) : 'average',
        improvementAction: String(f?.improvement_action ?? '').slice(0, 200),
      })),
      predictedRepeatPurchaseProbabilityPct: clamp(Number(b?.predicted_repeat_purchase_probability_pct ?? 40), 0, 100),
      predictedReferralProbabilityPct: clamp(Number(b?.predicted_referral_probability_pct ?? 30), 0, 100),
      predictedChurnProbabilityPct: clamp(Number(b?.predicted_churn_probability_pct ?? 30), 0, 100),
      predictedLifetimeValueEur: Math.round(Number(b?.predicted_lifetime_value_eur ?? 0)),
      keySatisfactionDrivers: (b?.key_satisfaction_drivers || []).slice(0, 4).map((d: any) => String(d).slice(0, 150)),
      keyDissatisfactionDrivers: (b?.key_dissatisfaction_drivers || []).slice(0, 4).map((d: any) => String(d).slice(0, 150)),
      recommendedIntervention: includes(INTERVENTIONS, String(b?.recommended_intervention)) ? String(b.recommended_intervention) : 'maintain',
      interventionPriority: includes(PRIORITIES, String(b?.intervention_priority)) ? String(b.intervention_priority) : 'medium',
    })),
    satisfactionFactors: (parsed?.satisfaction_factors || []).slice(0, 10).map((f: any) => ({
      factor: includes(SATISFACTION_FACTORS, String(f?.factor)) ? String(f.factor) : 'price_fairness',
      weight: clamp(Number(f?.weight ?? 10), 0, 100),
      avgScore: clamp(Number(f?.avg_score ?? 50), 0, 100),
      benchmark: clamp(Number(f?.benchmark ?? 60), 0, 100),
      improvementPotential: includes(IMPROVEMENT_POTENTIAL, String(f?.improvement_potential)) ? String(f.improvement_potential) : 'medium',
      bestPractice: String(f?.best_practice ?? '').slice(0, 250),
    })),
    npsPrediction: (parsed?.nps_prediction || []).slice(0, 3).map((n: any) => ({
      npsCategory: includes(NPS_CATEGORIES, String(n?.nps_category)) ? String(n.nps_category) : 'passive',
      buyerCount: Math.max(0, Number(n?.buyer_count ?? 0)),
      percentage: clamp(Number(n?.percentage ?? 33), 0, 100),
      avgSatisfactionScore: clamp(Number(n?.avg_satisfaction_score ?? 60), 0, 100),
      characteristics: String(n?.characteristics ?? '').slice(0, 200),
      strategy: String(n?.strategy ?? '').slice(0, 250),
    })),
    interventions: (parsed?.interventions || []).slice(0, 6).map((i: any) => ({
      intervention: String(i?.intervention ?? '').slice(0, 250),
      targetSatisfactionLevel: includes(SATISFACTION_LEVELS, String(i?.target_satisfaction_level)) ? String(i.target_satisfaction_level) : 'neutral',
      description: String(i?.description ?? '').slice(0, 300),
      expectedSatisfactionLiftPct: Math.round(Number(i?.expected_satisfaction_lift_pct ?? 0)),
      implementationCostEur: Math.round(Number(i?.implementation_cost_eur ?? 0)),
      priority: includes(PRIORITIES, String(i?.priority)) ? String(i.priority) : 'medium',
    })),
    mlModels: (parsed?.ml_models || []).slice(0, 5).map((m: any) => ({
      model: includes(ML_MODELS, String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: clamp(Number(m?.accuracy_pct ?? 75), 0, 100),
      predictionType: includes(PREDICTION_TYPES, String(m?.prediction_type)) ? String(m.prediction_type) : 'satisfaction',
      weightInEnsemble: clamp(Number(m?.weight_in_ensemble ?? 20), 0, 100),
    })),
    summary: {
      totalBuyersAnalyzed: targetBuyers.length,
      avgSatisfactionScore: clamp(Number(parsed?.summary?.avg_satisfaction_score ?? 60), 0, 100),
      promoterCount: Math.max(0, Number(parsed?.summary?.promoter_count ?? 0)),
      passiveCount: Math.max(0, Number(parsed?.summary?.passive_count ?? 0)),
      detractorCount: Math.max(0, Number(parsed?.summary?.detractor_count ?? 0)),
      npsScore: Math.max(-100, Math.min(100, Number(parsed?.summary?.nps_score ?? 0))),
      avgRepeatPurchaseProbabilityPct: clamp(Number(parsed?.summary?.avg_repeat_purchase_probability_pct ?? 40), 0, 100),
      biggestSatisfactionDriver: String(parsed?.summary?.biggest_satisfaction_driver ?? '').slice(0, 200),
      biggestDissatisfactionDriver: String(parsed?.summary?.biggest_dissatisfaction_driver ?? '').slice(0, 200),
      satisfactionPredictionScore: clamp(Number(parsed?.summary?.satisfaction_prediction_score ?? 60), 0, 100),
    },
  };
}
