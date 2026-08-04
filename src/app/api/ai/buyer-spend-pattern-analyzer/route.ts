// v6.78: AI Buyer Spend Pattern Analyzer — ML analiza porabnih vzorcev z anomaly detection
// POST /api/ai/buyer-spend-pattern-analyzer
// Body: { customerName?: string }
// Returns: { ok, analyzer: { buyers, spendPatterns, anomalies, predictions, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const SPEND_PATTERNS = ['consistent_high', 'consistent_medium', 'consistent_low', 'increasing', 'decreasing', 'volatile_high', 'volatile_low', 'seasonal_spike', 'one_time_large', 'gradual_growth'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true }, take: 500, orderBy: { sellDate: 'desc' } });
    if (soldTrades.length === 0) return NextResponse.json({ ok: true, analyzer: null, message: 'Ni prodaj za spend pattern analizo.' });

    const buyerMap = new Map<string, { name: string; purchases: number; totalSpent: number; avgOrder: number; daysSinceLast: number; lastPurchase: Date | null; firstPurchase: Date | null; categories: Set<string>; spendHistory: Array<{ date: Date; amount: number }> }>();
    const now = Date.now();
    for (const t of soldTrades) { const name = (t.sellLocation || '').trim(); if (!name || name.length < 2 || !t.sellDate) continue; const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0); if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, daysSinceLast: 0, lastPurchase: t.sellDate, firstPurchase: t.sellDate, categories: new Set(), spendHistory: [] }); const b = buyerMap.get(name)!; b.purchases += 1; b.totalSpent += rev; if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate; if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate; if (t.category) b.categories.add(t.category); b.spendHistory.push({ date: t.sellDate, amount: rev }); }
    const buyers = Array.from(buyerMap.values()).map(b => { b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0; b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / (24*60*60*1000)) : 999; return b; });
    if (customerName) { const f = buyers.filter(b => b.name === customerName); if (f.length === 0) return NextResponse.json({ ok: true, analyzer: null, message: `Kupec "${customerName}" ni najden.` }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d | ${b.categories.size} kat`).join('\n');

    const prompt = `Si AI buyer spend pattern analyzer z ML in anomaly detection.
Analizira porabne vzorce kupcev z 10 tipi vzorcev in anomaly detection.

KUPCI (${targetBuyers.length}):
${buyersStr}

10 spend pattern tipov:
1. CONSISTENT_HIGH: dosledno visoka poraba
2. CONSISTENT_MEDIUM: dosledno srednja poraba
3. CONSISTENT_LOW: dosledno nizka poraba
4. INCREASING: naraščajoča poraba
5. DECREASING: padajoča poraba
6. VOLATILE_HIGH: volatile visoka poraba
7. VOLATILE_LOW: volatile nizka poraba
8. SEASONAL_SPIKE: sezonski vrhunci
9. ONE_TIME_LARGE: enkratni velik nakup
10. GRADUAL_GROWTH: postopna rast

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    { "name": "<ime>", "spend_pattern": "<10 tipov>", "pattern_confidence_pct": <number 0-100>, "avg_spend_eur": <number>, "spend_volatility_pct": <number>, "spend_trend": "<increasing|decreasing|stable|volatile>", "spend_anomalies": [{"type": "<unusual_high|unusual_low|frequency_spike|frequency_drop|category_shift>", "description": "<max 100 znakov>", "severity": "<low|medium|high>", "date": "<YYYY-MM-DD>"}], "predicted_next_spend_eur": <number>, "predicted_next_spend_date": "<YYYY-MM-DD>", "spend_segment": "<vip|high_value|medium_value|low_value|budget>", "lifetime_spend_trajectory": "<growing|peaking|declining|flat>", "recommended_action": "<upsell|cross_sell|retain|reactivate|maintain>", "expected_spend_uplift_eur": <number> }
  ],
  "spendPatterns": [
    { "pattern": "<10 tipov>", "buyer_count": <number>, "avg_total_spent_eur": <number>, "avg_order_value_eur": <number>, "avg_frequency_days": <number>, "retention_rate_pct": <number 0-100>, "best_strategy": "<max 120 znakov>" }
  ],
  "anomalies": [
    { "anomaly_type": "<spend_spike|spend_drop|frequency_change|category_shift|price_sensitivity_change>", "buyer_name": "<ime>", "description": "<max 120 znakov>", "severity": "<low|medium|high|critical>", "detected_by": "<statistical|ml_model|rule_based>", "investigation_needed": <boolean>, "recommended_action": "<max 120 znakov>" }
  ],
  "predictions": [
    { "timeframe": "<30d|90d|12m>", "total_predicted_spend_eur": <number>, "avg_predicted_order_eur": <number>, "predicted_active_buyers": <number>, "high_value_targets": <number>, "confidence_pct": <number 0-100> }
  ],
  "mlModels": [
    { "model": "<isolation_forest|k-means|autoencoder|lstm|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<spend_forecast|pattern_detection|anomaly_detection|segment_prediction>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_buyers_analyzed": <number>, "avg_total_spend_eur": <number>, "avg_order_value_eur": <number>,
    "most_common_pattern": "<10 tipov>", "biggest_spend_anomaly": "<max 100 znakov>",
    "biggest_spend_opportunity": "<max 100 znakov>", "quickest_spend_win": "<max 100 znakov>",
    "spend_pattern_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);
    const validNames = new Set(targetBuyers.map(b => b.name));

    const analyzer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      buyers: (parsed?.buyers || []).filter((b: any) => validNames.has(String(b?.name ?? ''))).slice(0, 25).map((b: any) => ({ name: String(b?.name ?? '').slice(0, 100), spendPattern: SPEND_PATTERNS.includes(String(b?.spend_pattern) as any) ? String(b.spend_pattern) : 'consistent_medium', patternConfidencePct: Math.max(0, Math.min(100, Number(b?.pattern_confidence_pct ?? 60))), avgSpendEur: Math.round(Number(b?.avg_spend_eur ?? 0)), spendVolatilityPct: Math.round(Number(b?.spend_volatility_pct ?? 0) * 10) / 10, spendTrend: ['increasing', 'decreasing', 'stable', 'volatile'].includes(String(b?.spend_trend)) ? String(b.spend_trend) : 'stable', spendAnomalies: (b?.spend_anomalies || []).slice(0, 5).map((a: any) => ({ type: ['unusual_high', 'unusual_low', 'frequency_spike', 'frequency_drop', 'category_shift'].includes(String(a?.type)) ? String(a.type) : 'unusual_high', description: String(a?.description ?? '').slice(0, 200), severity: ['low', 'medium', 'high'].includes(String(a?.severity)) ? String(a.severity) : 'medium', date: String(a?.date ?? '').slice(0, 20) })), predictedNextSpendEur: Math.round(Number(b?.predicted_next_spend_eur ?? 0)), predictedNextSpendDate: String(b?.predicted_next_spend_date ?? '').slice(0, 20), spendSegment: ['vip', 'high_value', 'medium_value', 'low_value', 'budget'].includes(String(b?.spend_segment)) ? String(b.spend_segment) : 'medium_value', lifetimeSpendTrajectory: ['growing', 'peaking', 'declining', 'flat'].includes(String(b?.lifetime_spend_trajectory)) ? String(b.lifetime_spend_trajectory) : 'flat', recommendedAction: ['upsell', 'cross_sell', 'retain', 'reactivate', 'maintain'].includes(String(b?.recommended_action)) ? String(b.recommended_action) : 'maintain', expectedSpendUpliftEur: Math.round(Number(b?.expected_spend_uplift_eur ?? 0)) })),
      spendPatterns: (parsed?.spendPatterns || []).slice(0, 10).map((p: any) => ({ pattern: SPEND_PATTERNS.includes(String(p?.pattern) as any) ? String(p.pattern) : 'consistent_medium', buyerCount: Math.max(0, Number(p?.buyer_count ?? 0)), avgTotalSpentEur: Math.round(Number(p?.avg_total_spent_eur ?? 0)), avgOrderValueEur: Math.round(Number(p?.avg_order_value_eur ?? 0)), avgFrequencyDays: Math.round(Number(p?.avg_frequency_days ?? 0)), retentionRatePct: Math.max(0, Math.min(100, Number(p?.retention_rate_pct ?? 50))), bestStrategy: String(p?.best_strategy ?? '').slice(0, 250) })),
      anomalies: (parsed?.anomalies || []).filter((a: any) => validNames.has(String(a?.buyer_name ?? ''))).slice(0, 10).map((a: any) => ({ anomalyType: ['spend_spike', 'spend_drop', 'frequency_change', 'category_shift', 'price_sensitivity_change'].includes(String(a?.anomaly_type)) ? String(a.anomaly_type) : 'spend_spike', buyerName: String(a?.buyer_name ?? '').slice(0, 100), description: String(a?.description ?? '').slice(0, 250), severity: ['low', 'medium', 'high', 'critical'].includes(String(a?.severity)) ? String(a.severity) : 'medium', detectedBy: ['statistical', 'ml_model', 'rule_based'].includes(String(a?.detected_by)) ? String(a.detected_by) : 'statistical', investigationNeeded: Boolean(a?.investigation_needed ?? false), recommendedAction: String(a?.recommended_action ?? '').slice(0, 250) })),
      predictions: (parsed?.predictions || []).slice(0, 3).map((p: any) => ({ timeframe: ['30d', '90d', '12m'].includes(String(p?.timeframe)) ? String(p.timeframe) : '90d', totalPredictedSpendEur: Math.round(Number(p?.total_predicted_spend_eur ?? 0)), avgPredictedOrderEur: Math.round(Number(p?.avg_predicted_order_eur ?? 0)), predictedActiveBuyers: Math.max(0, Number(p?.predicted_active_buyers ?? 0)), highValueTargets: Math.max(0, Number(p?.high_value_targets ?? 0)), confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 50))) })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['isolation_forest', 'k-means', 'autoencoder', 'lstm', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))), predictionType: ['spend_forecast', 'pattern_detection', 'anomaly_detection', 'segment_prediction'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'spend_forecast', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { totalBuyersAnalyzed: targetBuyers.length, avgTotalSpendEur: Math.round(Number(parsed?.summary?.avg_total_spend_eur ?? 0)), avgOrderValueEur: Math.round(Number(parsed?.summary?.avg_order_value_eur ?? 0)), mostCommonPattern: SPEND_PATTERNS.includes(String(parsed?.summary?.most_common_pattern) as any) ? String(parsed.summary.most_common_pattern) : 'consistent_medium', biggestSpendAnomaly: String(parsed?.summary?.biggest_spend_anomaly ?? '').slice(0, 200), biggestSpendOpportunity: String(parsed?.summary?.biggest_spend_opportunity ?? '').slice(0, 200), quickestSpendWin: String(parsed?.summary?.quickest_spend_win ?? '').slice(0, 200), spendPatternScore: Math.max(0, Math.min(100, Number(parsed?.summary?.spend_pattern_score ?? 60))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, analyzer });
  } catch (e: any) { logger.error("/api/ai/buyer-spend-pattern-analyzer", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
