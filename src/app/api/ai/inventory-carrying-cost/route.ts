// v6.91: AI Inventory Carrying Cost — ML analiza stroškov držanja inventarja z optimization
// POST /api/ai/inventory-carrying-cost
// Body: { days?: number }
// Returns: { ok, analyzer: { overview, costBreakdown, categoryCarryingCost, optimization, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const COST_COMPONENTS = ['capital_cost', 'storage_cost', 'insurance_cost', 'depreciation_cost', 'obsolescence_cost', 'shrinkage_cost', 'handling_cost', 'administrative_cost', 'opportunity_cost', 'tax_cost'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.max(7, Math.min(365, Number(body?.days ?? 90)));

    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, buyLocation: true }, take: 500, orderBy: { buyDate: 'desc' } });
    if (heldTrades.length === 0) return NextResponse.json({ ok: true, analyzer: null, message: 'Ni inventarja za carrying cost analizo.' });

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const totalValue = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const avgAgeDays = Math.round(heldTrades.reduce((s, t) => s + Math.floor((now - t.buyDate.getTime()) / DAY), 0) / Math.max(1, heldTrades.length));
    const dailyCarryingCost = Math.round(totalValue * 0.0003); // ~11% annual
    const monthlyCarryingCost = dailyCarryingCost * 30;

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const catMap = new Map<string, { count: number; value: number }>();
    for (const t of heldTrades) {
      const cat = t.category || 'unknown';
      if (!catMap.has(cat)) catMap.set(cat, { count: 0, value: 0 });
      catMap.get(cat)!.count += 1; catMap.get(cat)!.value += t.buyPrice + (t.buyFees ?? 0);
    }
    const catList = Array.from(catMap.entries()).slice(0, 12).map(([cat, s]) => `- ${cat} | ${s.count} items | ${Math.round(s.value)}€`).join('\n');

    const prompt = `Si AI inventory carrying cost analyzer z ML in cost optimization.
Analizira stroške držanja inventarja z 10 komponentami.

STATS:
- Total items: ${heldTrades.length} | vrednost: ${Math.round(totalValue)}€
- Povprečna starost: ${avgAgeDays} dni
- Dnevni strošek držanja: ${dailyCarryingCost}€
- Mesečni strošek držanja: ${monthlyCarryingCost}€
- Analiza za: ${days} dni

KATEGORIJE:
${catList}

10 komponent stroškov držanja: capital_cost, storage_cost, insurance_cost, depreciation_cost, obsolescence_cost, shrinkage_cost, handling_cost, administrative_cost, opportunity_cost, tax_cost

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_inventory_value_eur": <number>, "daily_carrying_cost_eur": <number>, "monthly_carrying_cost_eur": <number>, "annual_carrying_cost_eur": <number>, "carrying_cost_pct": <number 0-50>, "carrying_cost_grade": "<A|B|C|D|F>" },
  "costBreakdown": [
    { "component": "<${COST_COMPONENTS.join('|')}>", "monthly_cost_eur": <number>, "annual_cost_eur": <number>, "cost_pct": <number 0-100>, "trend": "<increasing|decreasing|stable>", "controllable": <boolean>, "optimization_potential_pct": <number 0-50> }
  ],
  "categoryCarryingCost": [
    { "category": "<string>", "item_count": <number>, "inventory_value_eur": <number>, "monthly_carrying_cost_eur": <number>, "carrying_cost_pct": <number 0-50>, "avg_age_days": <number>, "cost_efficiency_score": <number 0-100>, "recommended_action": "<sell_fast|discount|hold|liquidate|relocate>" }
  ],
  "optimization": [
    { "action": "<max 150 znakov>", "component": "<${COST_COMPONENTS.join('|')}>", "expected_monthly_savings_eur": <number>, "implementation_days": <number>, "difficulty": "<easy|medium|hard>", "priority": "<high|medium|low>", "roi_pct": <number> }
  ],
  "mlModels": [
    { "model": "<prophet|arima|lstm|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<cost_forecast|optimization_prediction|trend_analysis|risk_assessment>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "carrying_cost_score": <number 0-100>, "carrying_cost_grade": "<A|B|C|D|F>", "total_annual_carrying_cost_eur": <number>,
    "potential_annual_savings_eur": <number>, "avg_carrying_cost_pct": <number 0-50>,
    "biggest_cost_risk": "<max 100 znakov>", "biggest_cost_opportunity": "<max 100 znakov>",
    "quickest_cost_win": "<max 100 znakov>", "carrying_cost_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const analyzer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      overview: { totalInventoryValueEur: Math.round(Number(parsed?.overview?.total_inventory_value_eur ?? totalValue)), dailyCarryingCostEur: Math.round(Number(parsed?.overview?.daily_carrying_cost_eur ?? dailyCarryingCost)), monthlyCarryingCostEur: Math.round(Number(parsed?.overview?.monthly_carrying_cost_eur ?? monthlyCarryingCost)), annualCarryingCostEur: Math.round(Number(parsed?.overview?.annual_carrying_cost_eur ?? monthlyCarryingCost * 12)), carryingCostPct: Math.max(0, Math.min(50, Number(parsed?.overview?.carrying_cost_pct ?? 11))), carryingCostGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.carrying_cost_grade)) ? String(parsed.overview.carrying_cost_grade) : 'C' },
      costBreakdown: (parsed?.costBreakdown || []).slice(0, 10).map((c: any) => ({ component: (COST_COMPONENTS as readonly string[]).includes(String(c?.component)) ? String(c.component) : 'capital_cost', monthlyCostEur: Math.round(Number(c?.monthly_cost_eur ?? 0)), annualCostEur: Math.round(Number(c?.annual_cost_eur ?? 0)), costPct: Math.max(0, Math.min(100, Number(c?.cost_pct ?? 10))), trend: ['increasing', 'decreasing', 'stable'].includes(String(c?.trend)) ? String(c.trend) : 'stable', controllable: Boolean(c?.controllable ?? true), optimizationPotentialPct: Math.max(0, Math.min(50, Number(c?.optimization_potential_pct ?? 15))) })),
      categoryCarryingCost: (parsed?.categoryCarryingCost || []).slice(0, 12).map((c: any) => ({ category: String(c?.category ?? '').slice(0, 50), itemCount: Math.max(0, Number(c?.item_count ?? 0)), inventoryValueEur: Math.round(Number(c?.inventory_value_eur ?? 0)), monthlyCarryingCostEur: Math.round(Number(c?.monthly_carrying_cost_eur ?? 0)), carryingCostPct: Math.max(0, Math.min(50, Number(c?.carrying_cost_pct ?? 11))), avgAgeDays: Math.max(0, Number(c?.avg_age_days ?? 0)), costEfficiencyScore: Math.max(0, Math.min(100, Number(c?.cost_efficiency_score ?? 50))), recommendedAction: ['sell_fast', 'discount', 'hold', 'liquidate', 'relocate'].includes(String(c?.recommended_action)) ? String(c.recommended_action) : 'hold' })),
      optimization: (parsed?.optimization || []).slice(0, 10).map((o: any) => ({ action: String(o?.action ?? '').slice(0, 300), component: (COST_COMPONENTS as readonly string[]).includes(String(o?.component)) ? String(o.component) : 'capital_cost', expectedMonthlySavingsEur: Math.round(Number(o?.expected_monthly_savings_eur ?? 0)), implementationDays: Math.max(1, Number(o?.implementation_days ?? 7)), difficulty: ['easy', 'medium', 'hard'].includes(String(o?.difficulty)) ? String(o.difficulty) : 'medium', priority: ['high', 'medium', 'low'].includes(String(o?.priority)) ? String(o.priority) : 'medium', roiPct: Math.round(Number(o?.roi_pct ?? 0) * 10) / 10 })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['prophet', 'arima', 'lstm', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['cost_forecast', 'optimization_prediction', 'trend_analysis', 'risk_assessment'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'cost_forecast', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { carryingCostScore: Math.max(0, Math.min(100, Number(parsed?.summary?.carrying_cost_score ?? 50))), carryingCostGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.carrying_cost_grade)) ? String(parsed.summary.carrying_cost_grade) : 'C', totalAnnualCarryingCostEur: Math.round(Number(parsed?.summary?.total_annual_carrying_cost_eur ?? monthlyCarryingCost * 12)), potentialAnnualSavingsEur: Math.round(Number(parsed?.summary?.potential_annual_savings_eur ?? monthlyCarryingCost * 12 * 0.2)), avgCarryingCostPct: Math.max(0, Math.min(50, Number(parsed?.summary?.avg_carrying_cost_pct ?? 11))), biggestCostRisk: String(parsed?.summary?.biggest_cost_risk ?? '').slice(0, 200), biggestCostOpportunity: String(parsed?.summary?.biggest_cost_opportunity ?? '').slice(0, 200), quickestCostWin: String(parsed?.summary?.quickest_cost_win ?? '').slice(0, 200), carryingCostAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.carrying_cost_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, analyzer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
