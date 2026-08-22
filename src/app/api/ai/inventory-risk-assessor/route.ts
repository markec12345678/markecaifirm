// v6.65 / v8.95.7-inv2-refactor: AI Inventory Risk Assessor — ocena tveganj inventarja z ML in risk matrix
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-risk-assessor
// Body: { tradeId?: string }
// Returns: { ok, assessor: { overall, items, riskMatrix, riskFactors, mitigations, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const RISK_TYPES = ['market_risk', 'liquidity_risk', 'depreciation_risk', 'damage_risk', 'theft_risk', 'pricing_risk', 'competition_risk', 'seasonal_risk'] as const;

interface RiskAssessorInput {
  tradeId: string | null;
}

export const POST = withAiRoute<RiskAssessorInput>({
  endpoint: '/api/ai/inventory-risk-assessor',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget + avtomatsko recordAiCall po uspehu

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : null,
    };
  },

  // No validateInput — tradeId je opcionalen

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId } = input;

    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades = await db.trade.findMany({
      where,
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true, location: true, imageUrl: true } } },
      take: tradeId ? 1 : 50,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, assessor: null, message: 'Ni held tradeov za risk assessment.' });
    }

    const items = computeRiskItems(heldTrades);
    const itemsStr = items.slice(0, 25).map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d | risk ${i.aiRisk}/10 | deal ${i.dealScore}/100`).join('\n');

    const prompt = buildRiskPrompt({ items, itemsStr });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const validIds = new Set(items.map(i => i.id));
    const assessor = transformRiskAssessor(parsed, items, validIds);

    return apiOk({ ok: true, assessor });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface RiskHeldRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: { aiEstimatedValue: number | null; dealScore: number | null; aiRisk: number | null; location: string | null; imageUrl: string | null } | null;
}

interface RiskItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  dealScore: number;
  aiRisk: number;
  location: string;
}

function computeRiskItems(heldTrades: RiskHeldRow[]): RiskItem[] {
  const now = Date.now();
  return heldTrades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    const daysHeld = Math.round((now - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
    return {
      id: t.id,
      title: t.title,
      category: t.category || 'drugo',
      cost,
      estValue,
      daysHeld,
      dealScore: t.listing?.dealScore ?? 50,
      aiRisk: t.listing?.aiRisk ?? 5,
      location: t.listing?.location ?? '',
    };
  });
}

interface RiskPromptInput {
  items: RiskItem[];
  itemsStr: string;
}

function buildRiskPrompt(input: RiskPromptInput): string {
  const { items, itemsStr } = input;
  return `Si AI inventory risk assessor z ML in 8-dimenzionalno risk matriko.
Oceni tveganja inventarja in predlaga mitigations.

INVENTAR (${items.length}):
${itemsStr}

8 risk tipov:
1. MARKET_RISK: tveganje padca tržne cene
2. LIQUIDITY_RISK: tveganje da item ne proda
3. DEPRECIATION_RISK: tveganje izgube vrednosti čez čas
4. DAMAGE_RISK: tveganje poškodbe med shranjevanjem
5. THEFT_RISK: tveganje kraje
6. PRICING_RISK: tveganje napačne cene
7. COMPETITION_RISK: tveganje nove konkurence
8. SEASONAL_RISK: tveganje sezonskega padca

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overall": {
    "total_inventory_value_eur": <number>,
    "total_capital_at_risk_eur": <number>,
    "overall_risk_score": <number 0-100>,
    "risk_level": "<low|medium|high|critical>",
    "risk_diversification_score": <number 0-100>,
    "biggest_risk_concentration": "<max 100 znakov>"
  },
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "overall_risk_score": <number 0-100>,
      "risk_level": "<low|medium|high|critical>",
      "risk_scores": [{"risk_type": "<8 tipov>", "score": <number 0-100>, "severity": "<low|medium|high|critical>"}],
      "primary_risk": "<8 tipov>",
      "capital_at_risk_eur": <number>,
      "potential_loss_eur": <number>,
      "recommended_mitigation": "<max 120 znakov>",
      "urgency": "<immediate|7d|30d|90d>"
    }
  ],
  "risk_matrix": [
    { "risk_type": "<8 tipov>", "avg_score": <number 0-100>, "items_affected": <number>, "total_capital_at_risk_eur": <number>, "severity": "<low|medium|high|critical>", "trend": "<increasing|stable|decreasing>" }
  ],
  "risk_factors": [
    { "factor": "<max 80 znakov>", "weight": <number 0-100>, "description": "<max 100 znakov>", "affected_items": <number>, "mitigation": "<max 150 znakov>" }
  ],
  "mitigations": [
    { "mitigation": "<max 120 znakov>", "risk_addressed": "<8 tipov>", "implementation_cost_eur": <number>, "expected_risk_reduction_pct": <number>, "priority": "<high|medium|low>", "timeframe_days": <number> }
  ],
  "ml_models": [
    { "model": "<random_forest|gradient_boosting|neural_network|logistic_regression|ensemble>", "accuracy_pct": <number 0-100>, "risk_type_predicted": "<8 tipov>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_items_assessed": <number>,
    "total_capital_at_risk_eur": <number>,
    "avg_risk_score": <number>,
    "high_risk_count": <number>,
    "critical_risk_count": <number>,
    "biggest_risk_threat": "<max 100 znakov>",
    "quickest_mitigation": "<max 100 znakov>",
    "risk_assessment_score": <number 0-100>
  }
}`;
}

function transformRiskAssessor(parsed: any, items: RiskItem[], validIds: Set<string>) {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    overall: {
      totalInventoryValueEur: Math.round(Number(parsed?.overall?.total_inventory_value_eur ?? items.reduce((s, i) => s + i.estValue, 0))),
      totalCapitalAtRiskEur: Math.round(Number(parsed?.overall?.total_capital_at_risk_eur ?? 0)),
      overallRiskScore: Math.max(0, Math.min(100, Number(parsed?.overall?.overall_risk_score ?? 50))),
      riskLevel: ['low', 'medium', 'high', 'critical'].includes(String(parsed?.overall?.risk_level)) ? String(parsed.overall.risk_level) : 'medium',
      riskDiversificationScore: Math.max(0, Math.min(100, Number(parsed?.overall?.risk_diversification_score ?? 50))),
      biggestRiskConcentration: String(parsed?.overall?.biggest_risk_concentration ?? '').slice(0, 200),
    },
    items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).slice(0, 30).map((it: any) => ({
      tradeId: String(it?.id ?? ''),
      title: String(it?.title ?? '').slice(0, 100),
      overallRiskScore: Math.max(0, Math.min(100, Number(it?.overall_risk_score ?? 50))),
      riskLevel: ['low', 'medium', 'high', 'critical'].includes(String(it?.risk_level)) ? String(it.risk_level) : 'medium',
      riskScores: (it?.risk_scores || []).slice(0, 8).map((r: any) => ({
        riskType: (RISK_TYPES as readonly string[]).includes(String(r?.risk_type)) ? String(r.risk_type) : 'market_risk',
        score: Math.max(0, Math.min(100, Number(r?.score ?? 50))),
        severity: ['low', 'medium', 'high', 'critical'].includes(String(r?.severity)) ? String(r.severity) : 'medium',
      })),
      primaryRisk: (RISK_TYPES as readonly string[]).includes(String(it?.primary_risk)) ? String(it.primary_risk) : 'market_risk',
      capitalAtRiskEur: Math.round(Number(it?.capital_at_risk_eur ?? 0)),
      potentialLossEur: Math.round(Number(it?.potential_loss_eur ?? 0)),
      recommendedMitigation: String(it?.recommended_mitigation ?? '').slice(0, 250),
      urgency: ['immediate', '7d', '30d', '90d'].includes(String(it?.urgency)) ? String(it.urgency) : '30d',
    })),
    riskMatrix: (parsed?.risk_matrix || []).slice(0, 8).map((r: any) => ({
      riskType: (RISK_TYPES as readonly string[]).includes(String(r?.risk_type)) ? String(r.risk_type) : 'market_risk',
      avgScore: Math.max(0, Math.min(100, Number(r?.avg_score ?? 50))),
      itemsAffected: Math.max(0, Number(r?.items_affected ?? 0)),
      totalCapitalAtRiskEur: Math.round(Number(r?.total_capital_at_risk_eur ?? 0)),
      severity: ['low', 'medium', 'high', 'critical'].includes(String(r?.severity)) ? String(r.severity) : 'medium',
      trend: ['increasing', 'stable', 'decreasing'].includes(String(r?.trend)) ? String(r.trend) : 'stable',
    })),
    riskFactors: (parsed?.risk_factors || []).slice(0, 6).map((f: any) => ({
      factor: String(f?.factor ?? '').slice(0, 150),
      weight: Math.max(0, Math.min(100, Number(f?.weight ?? 50))),
      description: String(f?.description ?? '').slice(0, 200),
      affectedItems: Math.max(0, Number(f?.affected_items ?? 0)),
      mitigation: String(f?.mitigation ?? '').slice(0, 300),
    })),
    mitigations: (parsed?.mitigations || []).slice(0, 8).map((m: any) => ({
      mitigation: String(m?.mitigation ?? '').slice(0, 250),
      riskAddressed: (RISK_TYPES as readonly string[]).includes(String(m?.risk_addressed)) ? String(m.risk_addressed) : 'market_risk',
      implementationCostEur: Math.round(Number(m?.implementation_cost_eur ?? 0)),
      expectedRiskReductionPct: Math.round(Number(m?.expected_risk_reduction_pct ?? 0) * 10) / 10,
      priority: ['high', 'medium', 'low'].includes(String(m?.priority)) ? String(m.priority) : 'medium',
      timeframeDays: Math.max(1, Number(m?.timeframe_days ?? 7)),
    })),
    mlModels: (parsed?.ml_models || []).slice(0, 5).map((m: any) => ({
      model: ['random_forest', 'gradient_boosting', 'neural_network', 'logistic_regression', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      riskTypePredicted: (RISK_TYPES as readonly string[]).includes(String(m?.risk_type_predicted)) ? String(m.risk_type_predicted) : 'market_risk',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      totalItemsAssessed: items.length,
      totalCapitalAtRiskEur: Math.round(Number(parsed?.summary?.total_capital_at_risk_eur ?? 0)),
      avgRiskScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_risk_score ?? 50))),
      highRiskCount: Math.max(0, Number(parsed?.summary?.high_risk_count ?? 0)),
      criticalRiskCount: Math.max(0, Number(parsed?.summary?.critical_risk_count ?? 0)),
      biggestRiskThreat: String(parsed?.summary?.biggest_risk_threat ?? '').slice(0, 200),
      quickestMitigation: String(parsed?.summary?.quickest_mitigation ?? '').slice(0, 200),
      riskAssessmentScore: Math.max(0, Math.min(100, Number(parsed?.summary?.risk_assessment_score ?? 60))),
    },
  };
}
