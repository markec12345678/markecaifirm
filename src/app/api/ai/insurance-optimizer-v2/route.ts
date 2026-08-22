// v6.44 / v8.95.8-other1: AI Inventory Insurance Optimizer v2 — napredna analiza zavarovalnih tveganj z vizualno analizo.
// Refaktoriran z withAiRoute helperjem (v8.95.8-other1) + enforceBudget guard.
//
// POST /api/ai/insurance-optimizer-v2
// Body: {}
// Returns: { ok, optimizer: { riskMatrix, policies, items, recommendations, claims, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InsuranceOptimizerInput {}

interface CategoryRiskProfile {
  theft: number;
  damage: number;
  depreciation: number;
  liquidity: number;
}

const CATEGORY_RISK_PROFILES: Record<string, CategoryRiskProfile> = {
  'elektronika': { theft: 9, damage: 6, depreciation: 25, liquidity: 3 },
  'telefoni': { theft: 10, damage: 7, depreciation: 30, liquidity: 2 },
  'avto': { theft: 6, damage: 8, depreciation: 12, liquidity: 4 },
  'nepremicnine': { theft: 2, damage: 4, depreciation: 3, liquidity: 8 },
  'kolesa': { theft: 8, damage: 5, depreciation: 15, liquidity: 4 },
  'pohištvo': { theft: 3, damage: 7, depreciation: 8, liquidity: 6 },
  'drugo': { theft: 5, damage: 5, depreciation: 10, liquidity: 5 },
};

interface HeldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: { aiEstimatedValue: number | null; dealScore: number | null; aiRisk: number | null; imageUrl: string | null } | null;
}

interface InventoryItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  profile: CategoryRiskProfile;
  depreciationLoss: number;
  riskScore: number;
  aiRisk: number;
}

export const POST = withAiRoute<InsuranceOptimizerInput>({
  endpoint: '/api/ai/insurance-optimizer-v2',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async () => ({}),

  // No validateInput — endpoint has no input

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true, imageUrl: true } } },
      take: 50,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, optimizer: null, message: 'Ni held tradeov za insurance v2.' });
    }

    const items = buildItems(heldTrades);
    const totalValue = items.reduce((s, i) => s + i.estValue, 0);
    const totalRisk = items.reduce((s, i) => s + i.riskScore, 0);
    const avgRisk = items.length > 0 ? Math.round(totalRisk / items.length) : 50;
    const itemsStr = buildItemsStr(items);

    const prompt = buildPrompt(items, itemsStr, totalValue);
    const raw = await callAi(prompt);

    const parsed: any = parseAi(raw);
    const optimizer = transformOptimizer(parsed, items, totalValue, avgRisk);

    return apiOk({ ok: true, optimizer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildItems(heldTrades: HeldTradeRow[]): InventoryItem[] {
  const now = Date.now();
  return heldTrades.map(t => {
    const cat = (t.category || 'drugo').toLowerCase();
    const profile = CATEGORY_RISK_PROFILES[cat] ?? CATEGORY_RISK_PROFILES['drugo'];
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    const daysHeld = Math.round((now - t.buyDate.getTime()) / (24*60*60*1000));
    const depreciationLoss = Math.round(cost * (profile.depreciation / 100) * (daysHeld / 365));
    const riskScore = Math.min(100, profile.theft * 4 + profile.damage * 3 + profile.liquidity * 2 + Math.min(20, daysHeld / 7));
    return { id: t.id, title: t.title, category: cat, cost, estValue, daysHeld, profile, depreciationLoss, riskScore, aiRisk: t.listing?.aiRisk ?? 5 };
  });
}

function buildItemsStr(items: InventoryItem[]): string {
  return items.slice(0, 20).map(i => `- [${i.id}] ${i.title} | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d | theft ${i.profile.theft}/10 | damage ${i.profile.damage}/10 | deprec ${i.profile.depreciation}%/leto | risk ${i.riskScore}/100`).join('\n');
}

function buildPrompt(items: InventoryItem[], itemsStr: string, totalValue: number): string {
  return `Si AI insurance optimizer v2 z napredno analizo zavarovalnih tveganj.
Analiziraj inventar z 4-dimenzionalno risk matriko (theft/damage/depreciation/liquidity).

INVENTAR (${items.length}, skupna vrednost ${Math.round(totalValue)}€):
${itemsStr}

Risk matrika (4 dimenzije):
1. THEFT RISK: verjetnost kraje (1-10, telefoni=10, nepremicnine=2)
2. DAMAGE RISK: verjetnost poškodbe (1-10, avto=8, pohištvo=7)
3. DEPRECIATION RATE: letni % padca vrednosti (elektronika=30%, nepremicnine=3%)
4. LIQUIDITY RISK: težava prodaje (1-10, nepremicnine=8, telefoni=2)

Zavarovalne police:
1. HOME_INSURANCE: hišno zavarovanje (do 5.000€ ali 10.000€ premičnin)
2. BUSINESS_INSURANCE: poslovno zavarovanje za preprodajalce
3. PER_ITEM: individualno zavarovanje dragocenih itemov (>500€)
4. SELF_INSURANCE: rezerva za self-covered izgube
5. TRANSIT_INSURANCE: zavarovanje med transportom (shipping)

Claim scenariji:
- Theft: verjetnost × vrednost = expected loss
- Damage: verjetnost × vrednost × 50% (delna izguba)
- Depreciation: že izračunano (drži predolgo)
- Total loss: popolna izguba (požar, poplava)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "risk_matrix": {
    "theft": {"avg_risk": <number>, "high_risk_items": <number>, "expected_annual_loss_eur": <number>},
    "damage": {"avg_risk": <number>, "high_risk_items": <number>, "expected_annual_loss_eur": <number>},
    "depreciation": {"avg_rate_pct": <number>, "annual_loss_eur": <number>},
    "liquidity": {"avg_risk": <number>, "stalled_items": <number>}
  },
  "policies": [
    { "type": "<home_insurance|business_insurance|per_item|self_insurance|transit_insurance>", "coverage_eur": <number>, "deductible_eur": <number>, "annual_premium_eur": <number>, "covers": ["<theft|damage|depreciation|transit>"], "recommended": <boolean>, "reasoning": "<max 80 znakov>" }
  ],
  "items": [
    { "id": "<trade_id>", "title": "<naslov>", "value_eur": <number>, "risk_score": <number 0-100>, "risk_level": "<low|medium|high|critical>", "primary_risk": "<theft|damage|depreciation|liquidity>", "recommended_action": "<insure|self_insure|sell_now|monitor>", "insurance_value_eur": <number>, "reasoning": "<max 80 znakov>" }
  ],
  "recommendations": [
    { "action": "<max 120 znakov>", "priority": "<high|medium|low>", "risk_addressed": "<max 50 znakov>", "expected_savings_eur": <number> }
  ],
  "claims": [
    { "scenario": "<theft|damage|total_loss|depreciation>", "probability_pct": <number>, "expected_loss_eur": <number>, "covered_by": "<policy_type|self>", "uncovered_eur": <number>, "mitigation": "<max 80 znakov>" }
  ],
  "summary": {
    "overall_risk_score": <number 0-100>,
    "total_insured_value_eur": <number>,
    "total_uninsured_value_eur": <number>,
    "recommended_annual_premium_eur": <number>,
    "expected_annual_loss_eur": <number>,
    "insurance_efficiency_score": <number 0-100>
  }
}`;
}

function transformOptimizer(parsed: any, items: InventoryItem[], totalValue: number, avgRisk: number): {
  insights: string;
  riskMatrix: any;
  policies: any[];
  items: any[];
  recommendations: any[];
  claims: any[];
  summary: any;
} {
  const validIds = new Set(items.map(i => i.id));
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    riskMatrix: {
      theft: { avgRisk: Math.round(Number(parsed?.risk_matrix?.theft?.avg_risk ?? 5)), highRiskItems: Math.max(0, Number(parsed?.risk_matrix?.theft?.high_risk_items ?? 0)), expectedAnnualLossEur: Math.round(Number(parsed?.risk_matrix?.theft?.expected_annual_loss_eur ?? 0)) },
      damage: { avgRisk: Math.round(Number(parsed?.risk_matrix?.damage?.avg_risk ?? 5)), highRiskItems: Math.max(0, Number(parsed?.risk_matrix?.damage?.high_risk_items ?? 0)), expectedAnnualLossEur: Math.round(Number(parsed?.risk_matrix?.damage?.expected_annual_loss_eur ?? 0)) },
      depreciation: { avgRatePct: Math.round(Number(parsed?.risk_matrix?.depreciation?.avg_rate_pct ?? 10)), annualLossEur: Math.round(Number(parsed?.risk_matrix?.depreciation?.annual_loss_eur ?? 0)) },
      liquidity: { avgRisk: Math.round(Number(parsed?.risk_matrix?.liquidity?.avg_risk ?? 5)), stalledItems: Math.max(0, Number(parsed?.risk_matrix?.liquidity?.stalled_items ?? 0)) },
    },
    policies: (parsed?.policies || []).slice(0, 6).map((p: any) => ({
      type: String(p?.type ?? '').slice(0, 50), coverageEur: Math.max(0, Number(p?.coverage_eur ?? 0)),
      deductibleEur: Math.max(0, Number(p?.deductible_eur ?? 0)), annualPremiumEur: Math.max(0, Number(p?.annual_premium_eur ?? 0)),
      covers: (p?.covers || []).slice(0, 4).map((c: any) => String(c).slice(0, 30)),
      recommended: Boolean(p?.recommended ?? false), reasoning: String(p?.reasoning ?? '').slice(0, 150),
    })),
    items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).map((it: any) => ({
      tradeId: String(it?.id ?? ''), title: String(it?.title ?? '').slice(0, 100),
      valueEur: Math.max(0, Number(it?.value_eur ?? 0)), riskScore: Math.max(0, Math.min(100, Number(it?.risk_score ?? 50))),
      riskLevel: ['low', 'medium', 'high', 'critical'].includes(String(it?.risk_level)) ? String(it.risk_level) : 'medium',
      primaryRisk: ['theft', 'damage', 'depreciation', 'liquidity'].includes(String(it?.primary_risk)) ? String(it.primaryRisk) : 'damage',
      recommendedAction: ['insure', 'self_insure', 'sell_now', 'monitor'].includes(String(it?.recommended_action)) ? String(it.recommended_action) : 'monitor',
      insuranceValueEur: Math.max(0, Number(it?.insurance_value_eur ?? 0)), reasoning: String(it?.reasoning ?? '').slice(0, 200),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 250), priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      riskAddressed: String(r?.risk_addressed ?? '').slice(0, 80), expectedSavingsEur: Math.round(Number(r?.expected_savings_eur ?? 0)),
    })),
    claims: (parsed?.claims || []).slice(0, 5).map((c: any) => ({
      scenario: String(c?.scenario ?? '').slice(0, 30), probabilityPct: Math.round(Number(c?.probability_pct ?? 0)),
      expectedLossEur: Math.round(Number(c?.expected_loss_eur ?? 0)), coveredBy: String(c?.covered_by ?? '').slice(0, 50),
      uncoveredEur: Math.round(Number(c?.uncovered_eur ?? 0)), mitigation: String(c?.mitigation ?? '').slice(0, 150),
    })),
    summary: {
      overallRiskScore: Math.max(0, Math.min(100, Number(parsed?.summary?.overall_risk_score ?? avgRisk))),
      totalInsuredValueEur: Math.round(Number(parsed?.summary?.total_insured_value_eur ?? 0)),
      totalUninsuredValueEur: Math.round(Number(parsed?.summary?.total_uninsured_value_eur ?? totalValue)),
      recommendedAnnualPremiumEur: Math.round(Number(parsed?.summary?.recommended_annual_premium_eur ?? 0)),
      expectedAnnualLossEur: Math.round(Number(parsed?.summary?.expected_annual_loss_eur ?? 0)),
      insuranceEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.insurance_efficiency_score ?? 50))),
    },
  };
}
