// v6.90: AI Inventory Procurement Optimizer — ML optimizacija nabave z supplier comparison
// POST /api/ai/inventory-procurement-optimizer
// Body: { days?: number, budgetEur?: number }
// Returns: { ok, optimizer: { overview, procurementPlan, supplierComparison, categoryStrategy, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const PROCUREMENT_TIERS = ['bulk_procurement', 'strategic_procurement', 'opportunistic_procurement', 'just_in_time', 'consignment_procurement'] as const;
const SUPPLIER_CRITERIA = ['price', 'quality', 'delivery_speed', 'reliability', 'minimum_order', 'payment_terms', 'geographic_proximity', 'exclusivity'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.max(7, Math.min(365, Number(body?.days ?? 90)));
    const budgetEur = Math.max(0, Number(body?.budgetEur ?? 5000));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const boughtTrades = await db.trade.findMany({ where: { buyDate: { gte: since } }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, buyLocation: true, status: true }, take: 1000, orderBy: { buyDate: 'desc' } });
    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyDate: true }, take: 200 });
    if (boughtTrades.length === 0 && heldTrades.length === 0) return NextResponse.json({ ok: true, optimizer: null, message: 'Ni podatkov za procurement optimizacijo.' });

    const totalSpent = boughtTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const avgPurchase = boughtTrades.length > 0 ? Math.round(totalSpent / boughtTrades.length) : 0;
    const heldValue = heldTrades.reduce((s, t) => s + t.buyPrice, 0);

    const supplierMap = new Map<string, { name: string; purchases: number; totalSpent: number; avgOrder: number }>();
    for (const t of boughtTrades) {
      const name = (t.buyLocation || '').trim();
      if (!name || name.length < 2) continue;
      if (!supplierMap.has(name)) supplierMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0 });
      const s = supplierMap.get(name)!;
      s.purchases += 1; s.totalSpent += t.buyPrice + (t.buyFees ?? 0);
    }
    const suppliers = Array.from(supplierMap.values()).map(s => { s.avgOrder = s.purchases > 0 ? Math.round(s.totalSpent / s.purchases) : 0; return s; });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const supplierList = suppliers.slice(0, 10).map(s => `- ${s.name} | ${s.purchases}x | ${s.totalSpent}€ | ${s.avgOrder}€ povp`).join('\n');

    const prompt = `Si AI inventory procurement optimizer z ML in supplier comparison.
Optimizira nabavo z 5 strategijami in 8 kriteriji dobaviteljev.

STATS (zadnjih ${days} dni):
- Skupno nakupov: ${boughtTrades.length}
- Skupna vrednost: ${Math.round(totalSpent)}€
- Povprečni nakup: ${avgPurchase}€
- Held vrednost: ${Math.round(heldValue)}€
- Budget za nabavo: ${budgetEur}€
- Dobaviteljev: ${suppliers.length}

DOBAVITELJI:
${supplierList || 'brez'}

5 strategij nabave:
1. BULK_PROCUREMENT: masovna nabava
2. STRATEGIC_PROCUREMENT: strateška nabava
3. OPPORTUNISTIC_PROCUREMENT: priložnostna nabava
4. JUST_IN_TIME: nabava po potrebi
5. CONSIGNMENT_PROCUREMENT: nabava na komisijo

8 kriterijev dobaviteljev: price, quality, delivery_speed, reliability, minimum_order, payment_terms, geographic_proximity, exclusivity

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_suppliers": <number>, "total_spent_eur": <number>, "avg_purchase_eur": <number>, "budget_utilization_pct": <number 0-100>, "procurement_efficiency_pct": <number 0-100>, "procurement_grade": "<A|B|C|D|F>" },
  "procurementPlan": [
    { "category": "<string>", "procurement_tier": "<${PROCUREMENT_TIERS.join('|')}>", "quantity_to_procure": <number>, "estimated_cost_eur": <number>, "expected_margin_pct": <number>, "timeframe_days": <number>, "priority": "<high|medium|low>", "rationale": "<max 120 znakov>" }
  ],
  "supplierComparison": [
    { "supplier_name": "<string>", "price_score": <number 0-100>, "quality_score": <number 0-100>, "delivery_speed_score": <number 0-100>, "reliability_score": <number 0-100>, "overall_score": <number 0-100>, "recommended_spend_pct": <number 0-100>, "risk_level": "<low|medium|high>", "best_criterion": "<${SUPPLIER_CRITERIA.join('|')}>" }
  ],
  "categoryStrategy": [
    { "category": "<string>", "recommended_tier": "<${PROCUREMENT_TIERS.join('|')}>", "primary_supplier": "<max 100 znakov>", "backup_supplier": "<max 100 znakov>", "expected_cost_savings_pct": <number 0-30>, "quality_target": "<budget|standard|premium|luxury>", "reorder_frequency_days": <number> }
  ],
  "mlModels": [
    { "model": "<random_forest|xgboost|neural_net|linear_regression|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<price_prediction|supplier_scoring|demand_forecast|procurement_optimization>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "procurement_optimization_score": <number 0-100>, "procurement_grade": "<A|B|C|D|F>", "total_budget_eur": <number>,
    "expected_savings_eur": <number>, "avg_supplier_score": <number 0-100>,
    "biggest_procurement_risk": "<max 100 znakov>", "biggest_procurement_opportunity": "<max 100 znakov>",
    "quickest_procurement_win": "<max 100 znakov>", "procurement_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      overview: { totalSuppliers: Math.max(0, Number(parsed?.overview?.total_suppliers ?? suppliers.length)), totalSpentEur: Math.round(Number(parsed?.overview?.total_spent_eur ?? totalSpent)), avgPurchaseEur: Math.round(Number(parsed?.overview?.avg_purchase_eur ?? avgPurchase)), budgetUtilizationPct: Math.max(0, Math.min(100, Number(parsed?.overview?.budget_utilization_pct ?? budgetEur > 0 ? (totalSpent / budgetEur) * 100 : 0))), procurementEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.overview?.procurement_efficiency_pct ?? 60))), procurementGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.procurement_grade)) ? String(parsed.overview.procurement_grade) : 'C' },
      procurementPlan: (parsed?.procurementPlan || []).slice(0, 12).map((p: any) => ({ category: String(p?.category ?? '').slice(0, 50), procurementTier: (PROCUREMENT_TIERS as readonly string[]).includes(String(p?.procurement_tier)) ? String(p.procurement_tier) : 'strategic_procurement', quantityToProcure: Math.max(0, Number(p?.quantity_to_procure ?? 0)), estimatedCostEur: Math.round(Number(p?.estimated_cost_eur ?? 0)), expectedMarginPct: Math.round(Number(p?.expected_margin_pct ?? 20) * 10) / 10, timeframeDays: Math.max(1, Number(p?.timeframe_days ?? 7)), priority: ['high', 'medium', 'low'].includes(String(p?.priority)) ? String(p.priority) : 'medium', rationale: String(p?.rationale ?? '').slice(0, 250) })),
      supplierComparison: (parsed?.supplierComparison || []).slice(0, 12).map((s: any) => ({ supplierName: String(s?.supplier_name ?? '').slice(0, 100), priceScore: Math.max(0, Math.min(100, Number(s?.price_score ?? 60))), qualityScore: Math.max(0, Math.min(100, Number(s?.quality_score ?? 70))), deliverySpeedScore: Math.max(0, Math.min(100, Number(s?.delivery_speed_score ?? 60))), reliabilityScore: Math.max(0, Math.min(100, Number(s?.reliability_score ?? 70))), overallScore: Math.max(0, Math.min(100, Number(s?.overall_score ?? 65))), recommendedSpendPct: Math.max(0, Math.min(100, Number(s?.recommended_spend_pct ?? 20))), riskLevel: ['low', 'medium', 'high'].includes(String(s?.risk_level)) ? String(s.risk_level) : 'medium', bestCriterion: (SUPPLIER_CRITERIA as readonly string[]).includes(String(s?.best_criterion)) ? String(s.best_criterion) : 'price' })),
      categoryStrategy: (parsed?.categoryStrategy || []).slice(0, 12).map((c: any) => ({ category: String(c?.category ?? '').slice(0, 50), recommendedTier: (PROCUREMENT_TIERS as readonly string[]).includes(String(c?.recommended_tier)) ? String(c.recommended_tier) : 'strategic_procurement', primarySupplier: String(c?.primary_supplier ?? '').slice(0, 200), backupSupplier: String(c?.backup_supplier ?? '').slice(0, 200), expectedCostSavingsPct: Math.max(0, Math.min(30, Number(c?.expected_cost_savings_pct ?? 10))), qualityTarget: ['budget', 'standard', 'premium', 'luxury'].includes(String(c?.quality_target)) ? String(c.quality_target) : 'standard', reorderFrequencyDays: Math.max(1, Number(c?.reorder_frequency_days ?? 30)) })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['random_forest', 'xgboost', 'neural_net', 'linear_regression', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['price_prediction', 'supplier_scoring', 'demand_forecast', 'procurement_optimization'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'procurement_optimization', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { procurementOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.procurement_optimization_score ?? 50))), procurementGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.procurement_grade)) ? String(parsed.summary.procurement_grade) : 'C', totalBudgetEur: Math.round(Number(parsed?.summary?.total_budget_eur ?? budgetEur)), expectedSavingsEur: Math.round(Number(parsed?.summary?.expected_savings_eur ?? totalSpent * 0.1)), avgSupplierScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_supplier_score ?? 65))), biggestProcurementRisk: String(parsed?.summary?.biggest_procurement_risk ?? '').slice(0, 200), biggestProcurementOpportunity: String(parsed?.summary?.biggest_procurement_opportunity ?? '').slice(0, 200), quickestProcurementWin: String(parsed?.summary?.quickest_procurement_win ?? '').slice(0, 200), procurementAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.procurement_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { logger.error("/api/ai/inventory-procurement-optimizer", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
