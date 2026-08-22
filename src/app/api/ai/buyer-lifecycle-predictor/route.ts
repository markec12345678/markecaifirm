// v6.61 / v8.96.3-batch1: AI Buyer Lifecycle Predictor — napove lifecycle kupca z ML stage transition modeling
// Refaktoriran z withAiRoute helperjem (v8.96.3-batch1) + enforceBudget guard.
//
// POST /api/ai/buyer-lifecycle-predictor
// Body: { customerName?: string, monthsAhead?: number }
// Returns: { ok, predictor: { buyers, lifecycleStages, transitions, mlPredictions, valueProjection, recommendations, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const LIFECYCLE_STAGES = [
  'prospect',        // potencialni kupec (še ni kupil)
  'first_time',      // 1. nakup
  'repeat_customer', // 2-3 nakupi
  'loyal_customer',  // 4+ nakupi
  'advocate',        // priporoča drugim
  'at_risk',         // upadajoča aktivnost
  'churning',        // 90+ dni neaktiven
  'churned',         // 180+ dni neaktiven
  'reactivated',     // ponovno aktiven po churn
] as const;

type LifecycleStage = typeof LIFECYCLE_STAGES[number];

interface BuyerLifecycleInput {
  customerName: string | null;
  monthsAhead: number;
}

export const POST = withAiRoute<BuyerLifecycleInput>({
  endpoint: '/api/ai/buyer-lifecycle-predictor',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      customerName: body?.customerName ? String(body.customerName).trim() : null,
      monthsAhead: Math.max(1, Math.min(24, Number(body?.monthsAhead ?? 12))),
    };
  },

  // No validateInput — vsi input-i imajo defaults

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { customerName, monthsAhead } = input;

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, predictor: null, message: 'Ni prodaj za lifecycle analizo.' });
    }

    // Aggregation
    const buyerMap = new Map<string, {
      name: string;
      purchases: number;
      totalSpent: number;
      avgOrderValue: number;
      firstPurchase: Date | null;
      lastPurchase: Date | null;
      daysAsCustomer: number;
      daysSinceLastPurchase: number;
      categories: Set<string>;
      purchaseDates: Date[];
      currentStage: LifecycleStage;
    }>();

    const now = Date.now();
    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2 || !t.sellDate) continue;
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);

      if (!buyerMap.has(name)) {
        buyerMap.set(name, {
          name, purchases: 0, totalSpent: 0, avgOrderValue: 0,
          firstPurchase: t.sellDate, lastPurchase: t.sellDate,
          daysAsCustomer: 0, daysSinceLastPurchase: 0,
          categories: new Set(), purchaseDates: [], currentStage: 'first_time',
        });
      }
      const b = buyerMap.get(name)!;
      b.purchases += 1;
      b.totalSpent += revenue;
      if (t.sellDate < (b.firstPurchase as Date)) b.firstPurchase = t.sellDate;
      if (t.sellDate > b.lastPurchase!) b.lastPurchase = t.sellDate;
      if (t.category) b.categories.add(t.category);
      b.purchaseDates.push(t.sellDate);
    }

    // Determine current lifecycle stage
    const buyers = Array.from(buyerMap.values()).map(b => {
      b.avgOrderValue = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0;
      if (b.firstPurchase && b.lastPurchase) {
        b.daysAsCustomer = Math.max(1, Math.round((now - b.firstPurchase.getTime()) / (24*60*60*1000)));
        b.daysSinceLastPurchase = Math.round((now - b.lastPurchase.getTime()) / (24*60*60*1000));
      }

      // Stage determination
      if (b.daysSinceLastPurchase > 180) b.currentStage = 'churned';
      else if (b.daysSinceLastPurchase > 90) b.currentStage = 'churning';
      else if (b.daysSinceLastPurchase > 60 && b.purchases >= 3) b.currentStage = 'at_risk';
      else if (b.purchases >= 5 && b.daysAsCustomer > 180) b.currentStage = 'advocate';
      else if (b.purchases >= 4) b.currentStage = 'loyal_customer';
      else if (b.purchases >= 2) b.currentStage = 'repeat_customer';
      else b.currentStage = 'first_time';

      return b;
    });

    if (customerName) {
      const filtered = buyers.filter(b => b.name === customerName);
      if (filtered.length === 0) {
        return apiOk({ ok: true, predictor: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);

    const prompt = buildPrompt(targetBuyers, monthsAhead);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const predictor = transformPredictor(parsed, targetBuyers, monthsAhead);

    return apiOk({ ok: true, predictor });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface BuyerRow {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrderValue: number;
  firstPurchase: Date | null;
  lastPurchase: Date | null;
  daysAsCustomer: number;
  daysSinceLastPurchase: number;
  categories: Set<string>;
  purchaseDates: Date[];
  currentStage: LifecycleStage;
}

function buildPrompt(targetBuyers: BuyerRow[], monthsAhead: number): string {
  const buyersStr = targetBuyers.slice(0, 15).map(b =>
    `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.daysAsCustomer}d | ${b.daysSinceLastPurchase}d zadnji | stage: ${b.currentStage} | ${b.categories.size} kat`
  ).join('\n');

  return `Si AI buyer lifecycle predictor z ML stage transition modeling.
Napove lifecycle kupca v naslednjih ${monthsAhead} mesecih z ML modelom.

KUPCI (${targetBuyers.length}):
${buyersStr}

9 lifecycle faz:
1. PROSPECT: potencialni kupec (še ni kupil)
2. FIRST_TIME: 1. nakup (nov kupec)
3. REPEAT_CUSTOMER: 2-3 nakupi (povratnik)
4. LOYAL_CUSTOMER: 4+ nakupi (zvest)
5. ADVOCATE: 5+ nakupi + 180d+ (prijatelj branda, priporoča)
6. AT_RISK: upadajoča aktivnost (60+ dni zadnji, prej aktiven)
7. CHURNING: 90+ dni neaktiven (verjetno izgubljen)
8. CHURNED: 180+ dni neaktiven (izgubljen)
9. REACTIVATED: ponovno aktiven po churn

Stage transition pravila:
- PROSPECT → FIRST_TIME: prvi nakup
- FIRST_TIME → REPEAT_CUSTOMER: 2. nakup v 60d
- REPEAT_CUSTOMER → LOYAL_CUSTOMER: 4. nakup
- LOYAL_CUSTOMER → ADVOCATE: 5+ nakupov + 180d+
- ANY → AT_RISK: 60d neaktiven (prej aktiven)
- AT_RISK → CHURNING: 90d neaktiven
- CHURNING → CHURNED: 180d neaktiven
- CHURNED → REACTIVATED: nov nakup po churn

ML modeli:
- MARKOV_CHAIN: probabilistic stage transitions
- LSTM_SEQUENCE: deep learning za sequence prediction
- RANDOM_FOREST: stage classification
- SURVIVAL_ANALYSIS: time-to-churn prediction
- COX_PROPORTIONAL_HAZARDS: churn hazard modeling

Value projection:
- CLV (Customer Lifetime Value): napovedana vrednost
- RETENTION_PROBABILITY: verjetnost retention v ${monthsAhead}m
- CHURN_PROBABILITY: verjetnost churn
- NEXT_PURCHASE_PROBABILITY: verjetnost naslednjega nakupa
- PROJECTED_REVENUE: napovedan prihodek

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    {
      "name": "<ime>",
      "current_stage": "<9 faz>",
      "stage_duration_days": <number>,
      "predicted_next_stage": "<9 faz>",
      "predicted_transition_date": "<YYYY-MM-DD>",
      "transition_probability_pct": <number 0-100>,
      "ml_predictions": {
        "retention_probability_12m_pct": <number 0-100>,
        "churn_probability_6m_pct": <number 0-100>,
        "churn_probability_12m_pct": <number 0-100>,
        "next_purchase_probability_30d_pct": <number 0-100>,
        "predicted_clv_eur": <number>,
        "predicted_remaining_purchases": <number>,
        "model_confidence_pct": <number 0-100>
      },
      "value_projection": [
        {"month": <1-24>, "predicted_revenue_eur": <number>, "cumulative_clv_eur": <number>, "stage_at_month": "<9 faz>"}
      ],
      "risk_factors": ["<max 80 znakov>"],
      "growth_drivers": ["<max 80 znakov>"],
      "recommended_intervention": "<maintain|nurture|reward|win_back|reactivate|let_go>",
      "intervention_priority": "<high|medium|low>",
      "expected_intervention_impact_eur": <number>
    }
  ],
  "lifecycle_stages": [
    {
      "stage": "<9 faz>",
      "buyer_count": <number>,
      "avg_clv_eur": <number>,
      "total_value_eur": <number>,
      "avg_duration_days": <number>,
      "conversion_rate_to_next_pct": <number 0-100>,
      "churn_rate_pct": <number 0-100>,
      "best_strategy": "<max 120 znakov>"
    }
  ],
  "transitions": [
    {
      "from_stage": "<9 faz>",
      "to_stage": "<9 faz>",
      "transition_probability_pct": <number 0-100>,
      "avg_time_to_transition_days": <number>,
      "buyer_count": <number>,
      "key_drivers": ["<max 80 znakov>"],
      "intervention_to_encourage": "<max 120 znakov>"
    }
  ],
  "ml_predictions": [
    {
      "model": "<markov_chain|lstm_sequence|random_forest|survival_analysis|cox_proportional_hazards>",
      "accuracy_pct": <number 0-100>,
      "prediction_type": "<stage_transition|churn_probability|clv|retention>",
      "weight_in_ensemble": <number 0-100>,
      "best_for": "<max 80 znakov>"
    }
  ],
  "value_projection": [
    {
      "timeframe_months": <number>,
      "total_projected_revenue_eur": <number>,
      "total_projected_clv_eur": <number>,
      "retained_buyers": <number>,
      "churned_buyers": <number>,
      "new_buyers_needed": <number>,
      "net_buyer_change": <number>
    }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "stage_targeted": "<9 faz ali all>", "expected_revenue_impact_eur": <number>, "implementation_months": <number> }
  ],
  "summary": {
    "total_buyers_analyzed": <number>,
    "avg_predicted_clv_eur": <number>,
    "total_projected_clv_eur": <number>,
    "avg_retention_probability_12m_pct": <number>,
    "avg_churn_probability_12m_pct": <number>,
    "biggest_churn_risk_stage": "<max 80 znakov>",
    "biggest_growth_opportunity_stage": "<max 80 znakov>",
    "lifecycle_efficiency_score": <number 0-100>
  }
}`;
}

function transformPredictor(parsed: any, targetBuyers: BuyerRow[], monthsAhead: number) {
  const validNames = new Set(targetBuyers.map(b => b.name));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    buyers: (parsed?.buyers || [])
      .filter((b: any) => validNames.has(String(b?.name ?? '')))
      .slice(0, 25)
      .map((b: any) => ({
        name: String(b?.name ?? '').slice(0, 100),
        currentStage: LIFECYCLE_STAGES.includes(String(b?.current_stage) as any) ? String(b.current_stage) : 'first_time',
        stageDurationDays: Math.max(0, Number(b?.stage_duration_days ?? 0)),
        predictedNextStage: LIFECYCLE_STAGES.includes(String(b?.predicted_next_stage) as any) ? String(b.predicted_next_stage) : 'repeat_customer',
        predictedTransitionDate: String(b?.predicted_transition_date ?? '').slice(0, 20),
        transitionProbabilityPct: Math.max(0, Math.min(100, Number(b?.transition_probability_pct ?? 50))),
        mlPredictions: {
          retentionProbability12mPct: Math.max(0, Math.min(100, Number(b?.ml_predictions?.retention_probability_12m_pct ?? 60))),
          churnProbability6mPct: Math.max(0, Math.min(100, Number(b?.ml_predictions?.churn_probability_6m_pct ?? 20))),
          churnProbability12mPct: Math.max(0, Math.min(100, Number(b?.ml_predictions?.churn_probability_12m_pct ?? 30))),
          nextPurchaseProbability30dPct: Math.max(0, Math.min(100, Number(b?.ml_predictions?.next_purchase_probability_30d_pct ?? 30))),
          predictedClvEur: Math.round(Number(b?.ml_predictions?.predicted_clv_eur ?? 0)),
          predictedRemainingPurchases: Math.max(0, Number(b?.ml_predictions?.predicted_remaining_purchases ?? 0)),
          modelConfidencePct: Math.max(0, Math.min(100, Number(b?.ml_predictions?.model_confidence_pct ?? 60))),
        },
        valueProjection: (b?.value_projection || []).slice(0, monthsAhead).map((v: any) => ({
          month: Math.max(1, Math.min(24, Number(v?.month ?? 1))),
          predictedRevenueEur: Math.round(Number(v?.predicted_revenue_eur ?? 0)),
          cumulativeClvEur: Math.round(Number(v?.cumulative_clv_eur ?? 0)),
          stageAtMonth: LIFECYCLE_STAGES.includes(String(v?.stage_at_month) as any) ? String(v.stage_at_month) : 'first_time',
        })),
        riskFactors: (b?.risk_factors || []).slice(0, 5).map((r: any) => String(r).slice(0, 150)),
        growthDrivers: (b?.growth_drivers || []).slice(0, 5).map((g: any) => String(g).slice(0, 150)),
        recommendedIntervention: ['maintain', 'nurture', 'reward', 'win_back', 'reactivate', 'let_go'].includes(String(b?.recommended_intervention)) ? String(b.recommended_intervention) : 'maintain',
        interventionPriority: ['high', 'medium', 'low'].includes(String(b?.intervention_priority)) ? String(b.intervention_priority) : 'medium',
        expectedInterventionImpactEur: Math.round(Number(b?.expected_intervention_impact_eur ?? 0)),
      })),
    lifecycleStages: (parsed?.lifecycle_stages || []).slice(0, 9).map((s: any) => ({
      stage: LIFECYCLE_STAGES.includes(String(s?.stage) as any) ? String(s.stage) : 'first_time',
      buyerCount: Math.max(0, Number(s?.buyer_count ?? 0)),
      avgClvEur: Math.round(Number(s?.avg_clv_eur ?? 0)),
      totalValueEur: Math.round(Number(s?.total_value_eur ?? 0)),
      avgDurationDays: Math.max(0, Number(s?.avg_duration_days ?? 0)),
      conversionRateToNextPct: Math.max(0, Math.min(100, Number(s?.conversion_rate_to_next_pct ?? 50))),
      churnRatePct: Math.max(0, Math.min(100, Number(s?.churn_rate_pct ?? 10))),
      bestStrategy: String(s?.best_strategy ?? '').slice(0, 250),
    })),
    transitions: (parsed?.transitions || []).slice(0, 12).map((t: any) => ({
      fromStage: LIFECYCLE_STAGES.includes(String(t?.from_stage) as any) ? String(t.from_stage) : 'first_time',
      toStage: LIFECYCLE_STAGES.includes(String(t?.to_stage) as any) ? String(t.to_stage) : 'repeat_customer',
      transitionProbabilityPct: Math.max(0, Math.min(100, Number(t?.transition_probability_pct ?? 50))),
      avgTimeToTransitionDays: Math.max(0, Number(t?.avg_time_to_transition_days ?? 0)),
      buyerCount: Math.max(0, Number(t?.buyer_count ?? 0)),
      keyDrivers: (t?.key_drivers || []).slice(0, 4).map((d: any) => String(d).slice(0, 150)),
      interventionToEncourage: String(t?.intervention_to_encourage ?? '').slice(0, 250),
    })),
    mlPredictions: (parsed?.ml_predictions || []).slice(0, 5).map((m: any) => ({
      model: ['markov_chain', 'lstm_sequence', 'random_forest', 'survival_analysis', 'cox_proportional_hazards'].includes(String(m?.model)) ? String(m.model) : 'markov_chain',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))),
      predictionType: ['stage_transition', 'churn_probability', 'clv', 'retention'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'stage_transition',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
      bestFor: String(m?.best_for ?? '').slice(0, 150),
    })),
    valueProjection: (parsed?.value_projection || []).slice(0, 4).map((v: any) => ({
      timeframeMonths: Math.max(3, Number(v?.timeframe_months ?? 12)),
      totalProjectedRevenueEur: Math.round(Number(v?.total_projected_revenue_eur ?? 0)),
      totalProjectedClvEur: Math.round(Number(v?.total_projected_clv_eur ?? 0)),
      retainedBuyers: Math.max(0, Number(v?.retained_buyers ?? 0)),
      churnedBuyers: Math.max(0, Number(v?.churned_buyers ?? 0)),
      newBuyersNeeded: Math.max(0, Number(v?.new_buyers_needed ?? 0)),
      netBuyerChange: Math.round(Number(v?.net_buyer_change ?? 0)),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      stageTargeted: String(r?.stage_targeted ?? 'all').slice(0, 30),
      expectedRevenueImpactEur: Math.round(Number(r?.expected_revenue_impact_eur ?? 0)),
      implementationMonths: Math.max(1, Number(r?.implementation_months ?? 1)),
    })),
    summary: {
      totalBuyersAnalyzed: targetBuyers.length,
      avgPredictedClvEur: Math.round(Number(parsed?.summary?.avg_predicted_clv_eur ?? 0)),
      totalProjectedClvEur: Math.round(Number(parsed?.summary?.total_projected_clv_eur ?? 0)),
      avgRetentionProbability12mPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_retention_probability_12m_pct ?? 60))),
      avgChurnProbability12mPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_churn_probability_12m_pct ?? 30))),
      biggestChurnRiskStage: LIFECYCLE_STAGES.includes(String(parsed?.summary?.biggest_churn_risk_stage) as any) ? String(parsed.summary.biggest_churn_risk_stage) : 'at_risk',
      biggestGrowthOpportunityStage: LIFECYCLE_STAGES.includes(String(parsed?.summary?.biggest_growth_opportunity_stage) as any) ? String(parsed.summary.biggest_growth_opportunity_stage) : 'repeat_customer',
      lifecycleEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.lifecycle_efficiency_score ?? 60))),
    },
  };
}
