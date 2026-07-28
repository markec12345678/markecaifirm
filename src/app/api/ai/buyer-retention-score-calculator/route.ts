// v6.77: AI Buyer Retention Score Calculator — ML kalkulator retention score z 12-faktorsko analizo
// POST /api/ai/buyer-retention-score-calculator
// Body: { customerName?: string }
// Returns: { ok, calculator: { buyers, scoringFactors, retentionLevels, interventions, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const RETENTION_FACTORS = ['recency', 'frequency', 'monetary', 'engagement', 'satisfaction', 'loyalty_program_participation', 'referral_activity', 'communication_responsiveness', 'category_diversity', 'seasonal_consistency', 'price_sensitivity', 'platform_loyalty'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true }, take: 500, orderBy: { sellDate: 'desc' } });
    if (soldTrades.length === 0) return NextResponse.json({ ok: true, calculator: null, message: 'Ni prodaj za retention score kalkulacijo.' });

    const buyerMap = new Map<string, { name: string; purchases: number; totalSpent: number; avgOrder: number; daysSinceLast: number; lastPurchase: Date | null; firstPurchase: Date | null; categories: Set<string>; purchaseDates: Date[] }>();
    const now = Date.now();
    for (const t of soldTrades) { const name = (t.sellLocation || '').trim(); if (!name || name.length < 2 || !t.sellDate) continue; const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0); if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, daysSinceLast: 0, lastPurchase: t.sellDate, firstPurchase: t.sellDate, categories: new Set(), purchaseDates: [] }); const b = buyerMap.get(name)!; b.purchases += 1; b.totalSpent += rev; if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate; if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate; if (t.category) b.categories.add(t.category); b.purchaseDates.push(t.sellDate); }
    const buyers = Array.from(buyerMap.values()).map(b => { b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0; b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / (24*60*60*1000)) : 999; return b; });
    if (customerName) { const f = buyers.filter(b => b.name === customerName); if (f.length === 0) return NextResponse.json({ ok: true, calculator: null, message: `Kupec "${customerName}" ni najden.` }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d | ${b.categories.size} kat`).join('\n');

    const prompt = `Si AI buyer retention score calculator z ML in 12-faktorsko analizo.
Računa retention score za ${targetBuyers.length} kupcev.

KUPCI:
${buyersStr}

12 retention faktorjev:
1. RECENCY: koliko dni od zadnjega nakupa
2. FREQUENCY: pogostost nakupov
3. MONETARY: skupni znesek
4. ENGAGEMENT: aktivnost in interakcija
5. SATISFACTION: zadovoljstvo (težko izmeriti direktno)
6. LOYALTY_PROGRAM_PARTICIPATION: udeležba v loyalty programu
7. REFERRAL_ACTIVITY: ali priporoča
8. COMMUNICATION_RESPONSIVENESS: odzivnost na komunikacijo
9. CATEGORY_DIVERSITY: raznolikost kategorij
10. SEASONAL_CONSISTENCY: konsistentnost sezonskih nakupov
11. PRICE_SENSITIVITY: občutljivost na ceno
12. PLATFORM_LOYALTY: zvestoba platformi

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    { "name": "<ime>", "retention_score": <number 0-100>, "retention_level": "<platinum|gold|silver|bronze|at_risk|churned>", "retention_probability_6m_pct": <number 0-100>, "retention_probability_12m_pct": <number 0-100>, "scoring_factors": [{"factor": "<12 faktorjev>", "score": <number 0-100>, "weight": <number 0-100>, "trend": "<improving|stable|declining>"}], "retention_drivers": ["<max 80 znakov>"], "retention_risks": ["<max 80 znakov>"], "predicted_next_purchase_date": "<YYYY-MM-DD>", "recommended_intervention": "<maintain|nurture|reward|win_back|reactivate>", "intervention_priority": "<high|medium|low>", "expected_retention_uplift_pct": <number> }
  ],
  "scoringFactors": [
    { "factor": "<12 faktorjev>", "weight": <number 0-100>, "avg_score": <number 0-100>, "benchmark": <number 0-100>, "improvement_potential": "<high|medium|low>", "scoring_method": "<max 100 znakov>" }
  ],
  "retentionLevels": [
    { "level": "<6 nivojev>", "buyer_count": <number>, "percentage": <number 0-100>, "avg_score": <number 0-100>, "avg_revenue_eur": <number>, "avg_retention_probability_pct": <number 0-100>, "strategy": "<max 120 znakov>" }
  ],
  "interventions": [
    { "intervention": "<maintain|nurture|reward|win_back|reactivate>", "target_level": "<6 nivojev>", "description": "<max 120 znakov>", "expected_retention_lift_pct": <number>, "implementation_cost_eur": <number>, "expected_revenue_impact_eur": <number>, "timeframe_days": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<random_forest|gradient_boosting|neural_network|lstm|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<retention_score|retention_probability|churn_prediction|optimal_intervention>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_buyers_scored": <number>, "avg_retention_score": <number 0-100>, "platinum_count": <number>,
    "gold_count": <number>, "silver_count": <number>, "bronze_count": <number>,
    "at_risk_count": <number>, "churned_count": <number>,
    "biggest_retention_driver": "<max 100 znakov>", "biggest_retention_risk": "<max 100 znakov>",
    "quickest_retention_win": "<max 100 znakov>", "retention_scoring_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);
    const validNames = new Set(targetBuyers.map(b => b.name));

    const calculator = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      buyers: (parsed?.buyers || []).filter((b: any) => validNames.has(String(b?.name ?? ''))).slice(0, 25).map((b: any) => ({ name: String(b?.name ?? '').slice(0, 100), retentionScore: Math.max(0, Math.min(100, Number(b?.retention_score ?? 50))), retentionLevel: ['platinum', 'gold', 'silver', 'bronze', 'at_risk', 'churned'].includes(String(b?.retention_level)) ? String(b.retention_level) : 'bronze', retentionProbability6mPct: Math.max(0, Math.min(100, Number(b?.retention_probability_6m_pct ?? 60))), retentionProbability12mPct: Math.max(0, Math.min(100, Number(b?.retention_probability_12m_pct ?? 40))), scoringFactors: (b?.scoring_factors || []).slice(0, 12).map((f: any) => ({ factor: RETENTION_FACTORS.includes(String(f?.factor) as any) ? String(f.factor) : 'recency', score: Math.max(0, Math.min(100, Number(f?.score ?? 50))), weight: Math.max(0, Math.min(100, Number(f?.weight ?? 8))), trend: ['improving', 'stable', 'declining'].includes(String(f?.trend)) ? String(f.trend) : 'stable' })), retentionDrivers: (b?.retention_drivers || []).slice(0, 4).map((d: any) => String(d).slice(0, 150)), retentionRisks: (b?.retention_risks || []).slice(0, 4).map((r: any) => String(r).slice(0, 150)), predictedNextPurchaseDate: String(b?.predicted_next_purchase_date ?? '').slice(0, 20), recommendedIntervention: ['maintain', 'nurture', 'reward', 'win_back', 'reactivate'].includes(String(b?.recommended_intervention)) ? String(b.recommended_intervention) : 'maintain', interventionPriority: ['high', 'medium', 'low'].includes(String(b?.intervention_priority)) ? String(b.intervention_priority) : 'medium', expectedRetentionUpliftPct: Math.round(Number(b?.expected_retention_uplift_pct ?? 0) * 10) / 10 })),
      scoringFactors: (parsed?.scoringFactors || []).slice(0, 12).map((f: any) => ({ factor: RETENTION_FACTORS.includes(String(f?.factor) as any) ? String(f.factor) : 'recency', weight: Math.max(0, Math.min(100, Number(f?.weight ?? 8))), avgScore: Math.max(0, Math.min(100, Number(f?.avg_score ?? 50))), benchmark: Math.max(0, Math.min(100, Number(f?.benchmark ?? 60))), improvementPotential: ['high', 'medium', 'low'].includes(String(f?.improvement_potential)) ? String(f.improvement_potential) : 'medium', scoringMethod: String(f?.scoring_method ?? '').slice(0, 200) })),
      retentionLevels: (parsed?.retentionLevels || []).slice(0, 6).map((l: any) => ({ level: ['platinum', 'gold', 'silver', 'bronze', 'at_risk', 'churned'].includes(String(l?.level)) ? String(l.level) : 'bronze', buyerCount: Math.max(0, Number(l?.buyer_count ?? 0)), percentage: Math.max(0, Math.min(100, Number(l?.percentage ?? 17))), avgScore: Math.max(0, Math.min(100, Number(l?.avg_score ?? 50))), avgRevenueEur: Math.round(Number(l?.avg_revenue_eur ?? 0)), avgRetentionProbabilityPct: Math.max(0, Math.min(100, Number(l?.avg_retention_probability_pct ?? 50))), strategy: String(l?.strategy ?? '').slice(0, 250) })),
      interventions: (parsed?.interventions || []).slice(0, 6).map((i: any) => ({ intervention: ['maintain', 'nurture', 'reward', 'win_back', 'reactivate'].includes(String(i?.intervention)) ? String(i.intervention) : 'maintain', targetLevel: ['platinum', 'gold', 'silver', 'bronze', 'at_risk', 'churned'].includes(String(i?.target_level)) ? String(i.target_level) : 'bronze', description: String(i?.description ?? '').slice(0, 250), expectedRetentionLiftPct: Math.round(Number(i?.expected_retention_lift_pct ?? 0) * 10) / 10, implementationCostEur: Math.round(Number(i?.implementation_cost_eur ?? 0)), expectedRevenueImpactEur: Math.round(Number(i?.expected_revenue_impact_eur ?? 0)), timeframeDays: Math.max(1, Number(i?.timeframe_days ?? 7)), priority: ['high', 'medium', 'low'].includes(String(i?.priority)) ? String(i.priority) : 'medium' })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['random_forest', 'gradient_boosting', 'neural_network', 'lstm', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['retention_score', 'retention_probability', 'churn_prediction', 'optimal_intervention'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'retention_score', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { totalBuyersScored: targetBuyers.length, avgRetentionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_retention_score ?? 50))), platinumCount: Math.max(0, Number(parsed?.summary?.platinum_count ?? 0)), goldCount: Math.max(0, Number(parsed?.summary?.gold_count ?? 0)), silverCount: Math.max(0, Number(parsed?.summary?.silver_count ?? 0)), bronzeCount: Math.max(0, Number(parsed?.summary?.bronze_count ?? 0)), atRiskCount: Math.max(0, Number(parsed?.summary?.at_risk_count ?? 0)), churnedCount: Math.max(0, Number(parsed?.summary?.churned_count ?? 0)), biggestRetentionDriver: String(parsed?.summary?.biggest_retention_driver ?? '').slice(0, 200), biggestRetentionRisk: String(parsed?.summary?.biggest_retention_risk ?? '').slice(0, 200), quickestRetentionWin: String(parsed?.summary?.quickest_retention_win ?? '').slice(0, 200), retentionScoringScore: Math.max(0, Math.min(100, Number(parsed?.summary?.retention_scoring_score ?? 60))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, calculator });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
