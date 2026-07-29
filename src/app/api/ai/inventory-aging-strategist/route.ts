// v6.89: AI Inventory Aging Strategist — ML strategija za staranje inventarja z action planning
// POST /api/ai/inventory-aging-strategist
// Body: { days?: number }
// Returns: { ok, strategist: { overview, agingStrategy, categoryAging, actionPlan, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const STRATEGY_TIERS = ['aggressive_disposal', 'discount_heavy', 'moderate_discount', 'strategic_hold', 'opportunistic_sale', 'premium_positioning'] as const;
const AGING_PHASES = ['introduction', 'growth', 'maturity', 'decline', 'critical', 'terminal'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.max(7, Math.min(365, Number(body?.days ?? 90)));

    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, buyLocation: true, notes: true, listingId: true }, take: 500, orderBy: { buyDate: 'desc' } });
    if (heldTrades.length === 0) return NextResponse.json({ ok: true, strategist: null, message: 'Ni inventarja za aging strategijo.' });

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    const items = heldTrades.map(t => {
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

    const totalValue = items.reduce((s, i) => s + i.cost, 0);
    const avgAge = Math.round(items.reduce((s, i) => s + i.ageDays, 0) / Math.max(1, items.length));
    const criticalItems = items.filter(i => i.phase === 'critical' || i.phase === 'terminal');
    const criticalValue = criticalItems.reduce((s, i) => s + i.cost, 0);

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const topCritical = criticalItems.slice(0, 10).map(i => `- ${i.title} | ${i.category} | ${i.ageDays}d | ${i.cost}€ | ${i.phase}`).join('\n');

    const prompt = `Si AI inventory aging strategist z ML in lifecycle analysis.
Strategizira staranje inventarja z 6 strategijami in 6 fazami.

STATS:
- Total items: ${items.length} | vrednost: ${Math.round(totalValue)}€
- Povprečna starost: ${avgAge} dni
- Critical/terminal items: ${criticalItems.length} | vrednost: ${Math.round(criticalValue)}€
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

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const strategist = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      overview: { totalItems: Math.max(0, Number(parsed?.overview?.total_items ?? items.length)), totalValueEur: Math.round(Number(parsed?.overview?.total_value_eur ?? totalValue)), avgAgeDays: Math.max(0, Number(parsed?.overview?.avg_age_days ?? avgAge)), criticalItemsCount: Math.max(0, Number(parsed?.overview?.critical_items_count ?? criticalItems.length)), criticalValueEur: Math.round(Number(parsed?.overview?.critical_value_eur ?? criticalValue)), devaluationAtRiskEur: Math.round(Number(parsed?.overview?.devaluation_at_risk_eur ?? criticalValue * 0.3)), agingStrategyGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.aging_strategy_grade)) ? String(parsed.overview.aging_strategy_grade) : 'C' },
      agingStrategy: (parsed?.agingStrategy || []).slice(0, 6).map((s: any) => ({ phase: (AGING_PHASES as readonly string[]).includes(String(s?.phase)) ? String(s.phase) : 'introduction', itemCount: Math.max(0, Number(s?.item_count ?? 0)), totalValueEur: Math.round(Number(s?.total_value_eur ?? 0)), valuePct: Math.max(0, Math.min(100, Number(s?.value_pct ?? 0))), recommendedStrategy: (STRATEGY_TIERS as readonly string[]).includes(String(s?.recommended_strategy)) ? String(s.recommended_strategy) : 'strategic_hold', timeWindowDays: Math.max(0, Number(s?.time_window_days ?? 30)), expectedRecoveryPct: Math.max(0, Math.min(100, Number(s?.expected_recovery_pct ?? 60))), actionUrgency: ['immediate', 'within_7d', 'within_30d', 'within_90d'].includes(String(s?.action_urgency)) ? String(s.action_urgency) : 'within_30d' })),
      categoryAging: (parsed?.categoryAging || []).slice(0, 12).map((c: any) => ({ category: String(c?.category ?? '').slice(0, 50), totalItems: Math.max(0, Number(c?.total_items ?? 0)), avgAgeDays: Math.max(0, Number(c?.avg_age_days ?? 0)), oldestItemDays: Math.max(0, Number(c?.oldest_item_days ?? 0)), criticalCount: Math.max(0, Number(c?.critical_count ?? 0)), devaluationRiskEur: Math.round(Number(c?.devaluation_risk_eur ?? 0)), categoryStrategy: (STRATEGY_TIERS as readonly string[]).includes(String(c?.category_strategy)) ? String(c.category_strategy) : 'strategic_hold', trend: ['improving', 'stable', 'worsening'].includes(String(c?.trend)) ? String(c.trend) : 'stable' })),
      actionPlan: (parsed?.actionPlan || []).slice(0, 10).map((a: any) => ({ action: String(a?.action ?? '').slice(0, 300), strategyTier: (STRATEGY_TIERS as readonly string[]).includes(String(a?.strategy_tier)) ? String(a.strategy_tier) : 'strategic_hold', targetItemsCount: Math.max(0, Number(a?.target_items_count ?? 0)), expectedRecoveryEur: Math.round(Number(a?.expected_recovery_eur ?? 0)), lossAcceptanceEur: Math.round(Number(a?.loss_acceptance_eur ?? 0)), implementationDays: Math.max(1, Number(a?.implementation_days ?? 7)), priority: ['high', 'medium', 'low'].includes(String(a?.priority)) ? String(a.priority) : 'medium', successProbabilityPct: Math.max(0, Math.min(100, Number(a?.success_probability_pct ?? 60))) })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['prophet', 'lstm', 'arima', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['aging_forecast', 'devaluation_prediction', 'recovery_optimization', 'lifecycle_analysis'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'aging_forecast', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { agingStrategyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.aging_strategy_score ?? 50))), agingStrategyGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.aging_strategy_grade)) ? String(parsed.summary.aging_strategy_grade) : 'C', totalDevaluationAtRiskEur: Math.round(Number(parsed?.summary?.total_devaluation_at_risk_eur ?? criticalValue * 0.3)), recoverableValueEur: Math.round(Number(parsed?.summary?.recoverable_value_eur ?? criticalValue * 0.6)), immediateActionCount: Math.max(0, Number(parsed?.summary?.immediate_action_count ?? 0)), biggestAgingRisk: String(parsed?.summary?.biggest_aging_risk ?? '').slice(0, 200), biggestAgingOpportunity: String(parsed?.summary?.biggest_aging_opportunity ?? '').slice(0, 200), quickestAgingWin: String(parsed?.summary?.quickest_aging_win ?? '').slice(0, 200), agingStrategyAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.aging_strategy_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, strategist });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
