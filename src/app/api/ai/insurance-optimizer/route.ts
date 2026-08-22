// v6.14 / v8.96.1-batch4: AI Inventory Insurance Optimizer — analiza tveganj inventarja in zavarovanje
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/insurance-optimizer
// Body: { location?: string, storageType?: 'home'|'garage'|'storage_unit'|'shop' }
// Returns: { ok, riskAnalysis: { totalValue, concentrationRisk, theftRisk, damageRisk, depreciationRisk },
//            items: [{ id, title, value, riskScore, recommendation }], policy: { type, coverage, deductible, premium, providers }, recommendations }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface InsuranceOptimizerInput {
  location: string;
  storageType: 'home' | 'garage' | 'storage_unit' | 'shop';
}

// Kategorije z različnimi profili tveganja
const CATEGORY_RISK_PROFILES: Record<string, { theftRisk: number; damageRisk: number; depreciationRate: number; liquidityRisk: number }> = {
  'elektronika': { theftRisk: 9, damageRisk: 6, depreciationRate: 25, liquidityRisk: 3 },
  'telefoni': { theftRisk: 10, damageRisk: 7, depreciationRate: 30, liquidityRisk: 2 },
  'računalništvo': { theftRisk: 8, damageRisk: 5, depreciationRate: 20, liquidityRisk: 3 },
  'avto': { theftRisk: 6, damageRisk: 8, depreciationRate: 15, liquidityRisk: 4 },
  'nepremičnine': { theftRisk: 2, damageRisk: 4, depreciationRate: 3, liquidityRisk: 8 },
  'kolesa': { theftRisk: 8, damageRisk: 5, depreciationRate: 15, liquidityRisk: 4 },
  'pohištvo': { theftRisk: 3, damageRisk: 7, depreciationRate: 8, liquidityRisk: 6 },
  'umetnine': { theftRisk: 7, damageRisk: 8, depreciationRate: 0, liquidityRisk: 9 },
  'orožje': { theftRisk: 9, damageRisk: 3, depreciationRate: 2, liquidityRisk: 7 },
  'nakit': { theftRisk: 9, damageRisk: 4, depreciationRate: 0, liquidityRisk: 5 },
  'drugo': { theftRisk: 5, damageRisk: 5, depreciationRate: 10, liquidityRisk: 5 },
};

// Storage type risk multiplier
const STORAGE_MULTIPLIERS: Record<string, { theft: number; damage: number }> = {
  home: { theft: 1.0, damage: 1.0 },
  garage: { theft: 1.3, damage: 1.2 },
  storage_unit: { theft: 1.5, damage: 1.1 },
  shop: { theft: 1.8, damage: 1.4 },
};

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: { aiEstimatedValue: number | null; dealScore: number | null } | null;
}

interface RiskItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estimatedValue: number;
  daysHeld: number;
  theftRisk: number;
  damageRisk: number;
  depreciationRate: number;
  liquidityRisk: number;
  depreciationLoss: number;
  riskScore: number;
}

interface RiskSummary {
  totalValue: number;
  totalCost: number;
  concentrationPct: number;
  concentrationRisk: 'high' | 'medium' | 'low';
  topCategory: string | null;
  topCategoryPct: number;
  avgTheftRisk: number;
  theftRiskLevel: 'high' | 'medium' | 'low';
  avgDamageRisk: number;
  damageRiskLevel: 'high' | 'medium' | 'low';
  avgDepreciationRate: number;
  depreciationRiskLevel: 'high' | 'medium' | 'low';
  totalDepreciationLoss: number;
  storageType: 'home' | 'garage' | 'storage_unit' | 'shop';
}

interface PromptData {
  itemsCount: number;
  totalValue: number;
  itemsStr: string;
  concentrationPct: number;
  concentrationRisk: string;
  topCatName: string | null;
  topCatPct: number;
  avgTheftRisk: number;
  theftRiskLevel: string;
  avgDamageRisk: number;
  damageRiskLevel: string;
  avgDepreciationRate: number;
  depreciationRiskLevel: string;
  totalDepreciationLoss: number;
  storageType: string;
}

export const POST = withAiRoute<InsuranceOptimizerInput>({
  endpoint: '/api/ai/insurance-optimizer',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      location: String(body?.location || '').trim(),
      storageType: ['home', 'garage', 'storage_unit', 'shop'].includes(String(body?.storageType))
        ? String(body.storageType) as 'home' | 'garage' | 'storage_unit' | 'shop'
        : 'home',
    };
  },

  // No validateInput — storageType has enum default
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { storageType } = input;

    // 1. Pridobi held trades
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } },
      },
    });

    if (heldTrades.length === 0) {
      return apiOk({
        ok: true,
        items: [],
        message: 'Ni itemov v skladišču za analizo zavarovalnih tveganj.',
      });
    }

    // 2. Izračunaj tveganja per item
    const items = heldTrades.map(t => computeRiskItem(t));

    // 3. Skupna analiza tveganj
    const summary = computeRiskSummary(items, storageType);

    const itemsStr = items.slice(0, 25).map(i =>
      `- ${i.title} | ${i.category} | vrednost: ${i.estimatedValue}€ | theftRisk: ${i.theftRisk}/10 | damageRisk: ${i.damageRisk}/10 | depRate: ${i.depreciationRate}%/leto | ${i.daysHeld}d v skladišču`
    ).join('\n');

    const prompt = buildPrompt({
      itemsCount: items.length,
      totalValue: summary.totalValue,
      itemsStr,
      concentrationPct: summary.concentrationPct,
      concentrationRisk: summary.concentrationRisk,
      topCatName: summary.topCategory,
      topCatPct: summary.topCategoryPct,
      avgTheftRisk: summary.avgTheftRisk,
      theftRiskLevel: summary.theftRiskLevel,
      avgDamageRisk: summary.avgDamageRisk,
      damageRiskLevel: summary.damageRiskLevel,
      avgDepreciationRate: summary.avgDepreciationRate,
      depreciationRiskLevel: summary.depreciationRiskLevel,
      totalDepreciationLoss: summary.totalDepreciationLoss,
      storageType: summary.storageType,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const validIds = new Set(items.map(i => i.id));
    const itemMap = new Map(items.map(i => [i.id, i]));
    const analysis = transformAnalysis(parsed, itemMap, validIds, summary.totalValue);

    return apiOk({
      ok: true,
      riskAnalysis: {
        totalValue: summary.totalValue,
        totalCost: summary.totalCost,
        itemCount: items.length,
        concentrationRisk: summary.concentrationRisk,
        concentrationPct: summary.concentrationPct,
        topCategory: summary.topCategory,
        topCategoryPct: summary.topCategoryPct,
        theftRisk: summary.avgTheftRisk,
        theftRiskLevel: summary.theftRiskLevel,
        damageRisk: summary.avgDamageRisk,
        damageRiskLevel: summary.damageRiskLevel,
        depreciationRate: summary.avgDepreciationRate,
        depreciationRiskLevel: summary.depreciationRiskLevel,
        totalDepreciationLoss: summary.totalDepreciationLoss,
        storageType: summary.storageType,
      },
      items: items.sort((a, b) => b.riskScore - a.riskScore),
      analysis,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function computeRiskItem(t: HeldTradeRow): RiskItem {
  const cost = t.buyPrice + (t.buyFees ?? 0);
  const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
  const cat = (t.category || 'drugo').toLowerCase();
  const profile = CATEGORY_RISK_PROFILES[cat] ?? CATEGORY_RISK_PROFILES['drugo'];
  const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));

  // Risk score kombinacija
  const depreciationLoss = Math.round((cost * profile.depreciationRate / 100) * (daysHeld / 365));
  const riskScore = Math.min(100,
    profile.theftRisk * 4 +
    profile.damageRisk * 3 +
    profile.liquidityRisk * 2 +
    Math.min(20, daysHeld / 7) // stalled povečuje tveganje
  );

  return {
    id: t.id,
    title: t.title,
    category: cat,
    cost,
    estimatedValue: estValue,
    daysHeld,
    theftRisk: profile.theftRisk,
    damageRisk: profile.damageRisk,
    depreciationRate: profile.depreciationRate,
    liquidityRisk: profile.liquidityRisk,
    depreciationLoss,
    riskScore: Math.round(riskScore),
  };
}

function computeRiskSummary(items: RiskItem[], storageType: 'home' | 'garage' | 'storage_unit' | 'shop'): RiskSummary {
  const totalValue = items.reduce((s, i) => s + i.estimatedValue, 0);
  const totalCost = items.reduce((s, i) => s + i.cost, 0);

  // Concentration risk (koliko % vrednosti je v top 3 itemih)
  const sortedByValue = [...items].sort((a, b) => b.estimatedValue - a.estimatedValue);
  const top3Value = sortedByValue.slice(0, 3).reduce((s, i) => s + i.estimatedValue, 0);
  const concentrationPct = totalValue > 0 ? Math.round((top3Value / totalValue) * 100) : 0;

  // Kategorijska koncentracija
  const byCatValue: Record<string, number> = {};
  for (const i of items) {
    byCatValue[i.category] = (byCatValue[i.category] ?? 0) + i.estimatedValue;
  }
  const topCat = Object.entries(byCatValue).sort(([, a], [, b]) => b - a)[0];
  const topCatPct = totalValue > 0 && topCat ? Math.round((topCat[1] / totalValue) * 100) : 0;

  // Storage type risk multiplier
  const storageMult = STORAGE_MULTIPLIERS[storageType] ?? STORAGE_MULTIPLIERS.home;

  const avgTheftRisk = Math.round(items.reduce((s, i) => s + i.theftRisk, 0) / items.length * storageMult.theft);
  const avgDamageRisk = Math.round(items.reduce((s, i) => s + i.damageRisk, 0) / items.length * storageMult.damage);
  const avgDepreciationRate = Math.round(items.reduce((s, i) => s + i.depreciationRate, 0) / items.length);
  const totalDepreciationLoss = items.reduce((s, i) => s + i.depreciationLoss, 0);

  const concentrationRisk = concentrationPct > 60 ? 'high' : concentrationPct > 40 ? 'medium' : 'low';
  const theftRiskLevel = avgTheftRisk >= 7 ? 'high' : avgTheftRisk >= 5 ? 'medium' : 'low';
  const damageRiskLevel = avgDamageRisk >= 7 ? 'high' : avgDamageRisk >= 5 ? 'medium' : 'low';
  const depreciationRiskLevel = avgDepreciationRate >= 20 ? 'high' : avgDepreciationRate >= 10 ? 'medium' : 'low';

  return {
    totalValue,
    totalCost,
    concentrationPct,
    concentrationRisk,
    topCategory: topCat?.[0] ?? null,
    topCategoryPct: topCatPct,
    avgTheftRisk,
    theftRiskLevel,
    avgDamageRisk,
    damageRiskLevel,
    avgDepreciationRate,
    depreciationRiskLevel,
    totalDepreciationLoss,
    storageType,
  };
}

function buildPrompt(d: PromptData): string {
  return `Si ekspert za zavarovalništvo pri preprodaji rabljenih dobrin.
Analiziraj inventar in predlagaj optimalno zavarovanje ter mitigacijo tveganj.

INVENTAR (${d.itemsCount} itemov, skupna vrednost ${d.totalValue}€):
${d.itemsStr}

SKUPNA ANALIZA:
- Koncentracijsko tveganje: ${d.concentrationPct}% v top 3 itemih (${d.concentrationRisk})
- Top kategorija: ${d.topCatName ?? 'neznan'} (${d.topCatPct}% vrednosti)
- Povp. theft risk: ${d.avgTheftRisk}/10 (${d.theftRiskLevel})
- Povp. damage risk: ${d.avgDamageRisk}/10 (${d.damageRiskLevel})
- Povp. depreciation rate: ${d.avgDepreciationRate}%/leto (${d.depreciationRiskLevel})
- Skupna izguba zaradi amortizacije: ${d.totalDepreciationLoss}€
- Storage type: ${d.storageType}

Slovensko zavarovalniško okolje:
- Osnovno hišno zavarovanje pokriva do 5.000€ ali 10.000€ osebne premične lastnine
- Dodatno zavarovanje premičnin (Triglav, Adriatic, Zavarovalnica Sava) — do 50.000€
- Specialno zavarovanje za preprodajalce (business insurance) — višje premije, popolna pokritost
- Self-insurance (rezerva) za nizkovredne iteme (<200€)

Strategije zavarovanja:
- "self_insured": brez zavarovanja, sam pokriva izgube (za mali inventory <5.000€)
- "home_extension": razširi hišno zavarovanje na dodatne premičnine
- "business_policy": specialno poslovno zavarovanje za preprodajalce
- "hybrid": self-insured za <500€, business policy za >500€ iteme
- "per_item": individualno zavarovanje vsakega dragocenega itema

Odgovori LE z JSON:
{
  "risk_summary": "<povzetek tveganj, max 200 znakov>",
  "recommended_strategy": "<self_insured|home_extension|business_policy|hybrid|per_item>",
  "policy": {
    "type": "<tip zavarovanja>",
    "coverage_eur": <number>,
    "deductible_eur": <number>,
    "estimated_annual_premium_eur": <number>,
    "providers": ["<slovenski zavarovalnica, npr. Triglav>", "..."]
  },
  "high_risk_items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "risk": "<theft|damage|depreciation|stalled>",
      "recommendation": "<kaj narediti, max 100 znakov>"
    }
  ],
  "recommendations": [
    {
      "action": "<konkretno dejanje, max 120 znakov>",
      "priority": "<high|medium|low>",
      "savings_eur": <number>
    }
  ],
  "self_insurance_reserve": <number, koliko denarja rezervirati za self-insurance>
}`;
}

function transformAnalysis(
  parsed: any,
  itemMap: Map<string, RiskItem>,
  validIds: Set<string>,
  totalValue: number
) {
  const highRiskItems = (parsed?.high_risk_items || [])
    .filter((h: any) => validIds.has(String(h?.id ?? '')))
    .map((h: any) => {
      const id = String(h.id);
      const orig = itemMap.get(id)!;
      return {
        id,
        title: orig.title,
        category: orig.category,
        estimatedValue: orig.estimatedValue,
        riskScore: orig.riskScore,
        risk: ['theft', 'damage', 'depreciation', 'stalled'].includes(String(h?.risk)) ? String(h.risk) : 'damage',
        recommendation: String(h?.recommendation ?? '').slice(0, 200),
      };
    });

  return {
    riskSummary: String(parsed?.risk_summary ?? '').slice(0, 400),
    recommendedStrategy: ['self_insured', 'home_extension', 'business_policy', 'hybrid', 'per_item'].includes(String(parsed?.recommended_strategy))
      ? String(parsed.recommended_strategy) : 'hybrid',
    policy: {
      type: String(parsed?.policy?.type ?? '').slice(0, 80),
      coverageEur: Math.max(0, Number(parsed?.policy?.coverage_eur ?? totalValue)),
      deductibleEur: Math.max(0, Number(parsed?.policy?.deductible_eur ?? 0)),
      estimatedAnnualPremiumEur: Math.max(0, Number(parsed?.policy?.estimated_annual_premium_eur ?? 0)),
      providers: Array.isArray(parsed?.policy?.providers)
        ? parsed.policy.providers.slice(0, 5).map((p: any) => String(p).slice(0, 60))
        : [],
    },
    highRiskItems,
    recommendations: (parsed?.recommendations || []).slice(0, 8).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 250),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      savingsEur: Number(r?.savings_eur ?? 0) || 0,
    })),
    selfInsuranceReserve: Math.max(0, Number(parsed?.self_insurance_reserve ?? 0)),
  };
}
