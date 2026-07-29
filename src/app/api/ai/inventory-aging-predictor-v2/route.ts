// v6.80: AI Inventory Aging Predictor v2 — ML napoved staranja inventarja z devaluation curve
// POST /api/ai/inventory-aging-predictor-v2
// Body: { days?: number }
// Returns: { ok, predictor: { overview, agingBuckets, devaluationCurve, riskItems, recommendations, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const AGING_BUCKETS = ['fresh_0_30d', 'aging_30_60d', 'stale_60_90d', 'old_90_180d', 'stale_180_365d', 'dead_365d_plus'] as const;
const DEVALUATION_TIERS = ['minimal', 'moderate', 'significant', 'severe', 'critical'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.max(7, Math.min(365, Number(body?.days ?? 90)));

    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, buyLocation: true, notes: true, listingId: true }, take: 500, orderBy: { buyDate: 'desc' } });
    if (heldTrades.length === 0) return NextResponse.json({ ok: true, predictor: null, message: 'Ni inventarja za aging analizo.' });

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const items = heldTrades.map(t => {
      const ageDays = Math.floor((now - t.buyDate.getTime()) / DAY);
      const cost = t.buyPrice + (t.buyFees ?? 0);
      let bucket = 'fresh_0_30d';
      if (ageDays > 365) bucket = 'dead_365d_plus';
      else if (ageDays > 180) bucket = 'stale_180_365d';
      else if (ageDays > 90) bucket = 'old_90_180d';
      else if (ageDays > 60) bucket = 'stale_60_90d';
      else if (ageDays > 30) bucket = 'aging_30_60d';
      return { id: t.id, title: t.title, category: t.category, ageDays, cost, bucket };
    });

    const totalValue = items.reduce((s, i) => s + i.cost, 0);
    const avgAge = items.length > 0 ? Math.round(items.reduce((s, i) => s + i.ageDays, 0) / items.length) : 0;
    const staleCount = items.filter(i => i.ageDays > 90).length;
    const staleValue = items.filter(i => i.ageDays > 90).reduce((s, i) => s + i.cost, 0);
    const stalePct = totalValue > 0 ? Math.round((staleValue / totalValue) * 100) : 0;

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const topAging = items.filter(i => i.ageDays > 60).slice(0, 10).map(i => `- ${i.title} | ${i.category} | ${i.ageDays}d | ${i.cost}€ | ${i.bucket}`).join('\n');

    const prompt = `Si AI inventory aging predictor v2 z ML in devaluation curve modeling.
Napoveduje staranje inventarja in devaluation curve z 6 bucketi.

STATS:
- Total items: ${items.length} | vrednost: ${Math.round(totalValue)}€
- Povprečna starost: ${avgAge} dni
- Stale (>90d): ${staleCount} items | ${Math.round(staleValue)}€ (${stalePct}%)
- Analiza za: ${days} dni naprej

6 aging bucketov:
1. FRESH_0_30D: 0-30 dni
2. AGING_30_60D: 30-60 dni
3. STALE_60_90D: 60-90 dni
4. OLD_90_180D: 90-180 dni
5. STALE_180_365D: 180-365 dni
6. DEAD_365D_PLUS: 365+ dni

5 devaluation tierjev: minimal, moderate, significant, severe, critical

TOP AGING ITEMS (>60d):
${topAging || 'brez'}

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_items": <number>, "total_value_eur": <number>, "avg_age_days": <number>, "stale_items_count": <number>, "stale_value_eur": <number>, "stale_pct": <number 0-100>, "devaluation_at_risk_eur": <number>, "aging_grade": "<A|B|C|D|F>" },
  "agingBuckets": [
    { "bucket": "<${AGING_BUCKETS.join('|')}>", "item_count": <number>, "total_value_eur": <number>, "value_pct": <number 0-100>, "avg_age_days": <number>, "devaluation_pct": <number 0-100>, "risk_level": "<critical|high|medium|low>", "recommended_action": "<sell_fast|discount|bundle|liquidate|hold>" }
  ],
  "devaluationCurve": [
    { "age_days": <number>, "expected_value_pct": <number 0-100>, "devaluation_pct": <number 0-100>, "devaluation_tier": "<${DEVALUATION_TIERS.join('|')}>", "action_threshold": "<sell_now|discount_10|discount_20|discount_30|liquidate>" }
  ],
  "riskItems": [
    { "item_title": "<max 100 znakov>", "category": "<string>", "current_age_days": <number>, "current_value_eur": <number>, "predicted_value_30d_eur": <number>, "predicted_value_90d_eur": <number>, "devaluation_tier": "<${DEVALUATION_TIERS.join('|')}>", "recommended_action": "<sell_fast|discount|bundle|liquidate|hold>", "urgency": "<critical|high|medium|low>" }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "target_bucket": "<${AGING_BUCKETS.join('|')}>", "expected_savings_eur": <number>, "implementation_days": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<arima|prophet|lstm|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<age_forecast|devaluation_forecast|sell_probability|risk_score>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "aging_risk_score": <number 0-100>, "aging_grade": "<A|B|C|D|F>", "total_devaluation_at_risk_eur": <number>,
    "critical_items_count": <number>, "avg_age_days": <number>,
    "biggest_aging_risk": "<max 100 znakov>", "biggest_aging_opportunity": "<max 100 znakov>",
    "quickest_aging_win": "<max 100 znakov>", "aging_prediction_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const predictor = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      overview: { totalItems: Math.max(0, Number(parsed?.overview?.total_items ?? items.length)), totalValueEur: Math.round(Number(parsed?.overview?.total_value_eur ?? totalValue)), avgAgeDays: Math.max(0, Number(parsed?.overview?.avg_age_days ?? avgAge)), staleItemsCount: Math.max(0, Number(parsed?.overview?.stale_items_count ?? staleCount)), staleValueEur: Math.round(Number(parsed?.overview?.stale_value_eur ?? staleValue)), stalePct: Math.max(0, Math.min(100, Number(parsed?.overview?.stale_pct ?? stalePct))), devaluationAtRiskEur: Math.round(Number(parsed?.overview?.devaluation_at_risk_eur ?? staleValue * 0.3)), agingGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.aging_grade)) ? String(parsed.overview.aging_grade) : 'C' },
      agingBuckets: (parsed?.agingBuckets || []).slice(0, 6).map((b: any) => ({ bucket: (AGING_BUCKETS as readonly string[]).includes(String(b?.bucket)) ? String(b.bucket) : 'fresh_0_30d', itemCount: Math.max(0, Number(b?.item_count ?? 0)), totalValueEur: Math.round(Number(b?.total_value_eur ?? 0)), valuePct: Math.max(0, Math.min(100, Number(b?.value_pct ?? 0))), avgAgeDays: Math.max(0, Number(b?.avg_age_days ?? 0)), devaluationPct: Math.max(0, Math.min(100, Number(b?.devaluation_pct ?? 0))), riskLevel: ['critical', 'high', 'medium', 'low'].includes(String(b?.risk_level)) ? String(b.risk_level) : 'medium', recommendedAction: ['sell_fast', 'discount', 'bundle', 'liquidate', 'hold'].includes(String(b?.recommended_action)) ? String(b.recommended_action) : 'hold' })),
      devaluationCurve: (parsed?.devaluationCurve || []).slice(0, 10).map((d: any) => ({ ageDays: Math.max(0, Number(d?.age_days ?? 0)), expectedValuePct: Math.max(0, Math.min(100, Number(d?.expected_value_pct ?? 100))), devaluationPct: Math.max(0, Math.min(100, Number(d?.devaluation_pct ?? 0))), devaluationTier: (DEVALUATION_TIERS as readonly string[]).includes(String(d?.devaluation_tier)) ? String(d.devaluation_tier) : 'minimal', actionThreshold: ['sell_now', 'discount_10', 'discount_20', 'discount_30', 'liquidate'].includes(String(d?.action_threshold)) ? String(d.action_threshold) : 'sell_now' })),
      riskItems: (parsed?.riskItems || []).slice(0, 15).map((r: any) => ({ itemTitle: String(r?.item_title ?? '').slice(0, 200), category: String(r?.category ?? '').slice(0, 50), currentAgeDays: Math.max(0, Number(r?.current_age_days ?? 0)), currentValueEur: Math.round(Number(r?.current_value_eur ?? 0)), predictedValue30dEur: Math.round(Number(r?.predicted_value_30d_eur ?? 0)), predictedValue90dEur: Math.round(Number(r?.predicted_value_90d_eur ?? 0)), devaluationTier: (DEVALUATION_TIERS as readonly string[]).includes(String(r?.devaluation_tier)) ? String(r.devaluation_tier) : 'minimal', recommendedAction: ['sell_fast', 'discount', 'bundle', 'liquidate', 'hold'].includes(String(r?.recommended_action)) ? String(r.recommended_action) : 'hold', urgency: ['critical', 'high', 'medium', 'low'].includes(String(r?.urgency)) ? String(r.urgency) : 'medium' })),
      recommendations: (parsed?.recommendations || []).slice(0, 8).map((r: any) => ({ action: String(r?.action ?? '').slice(0, 300), targetBucket: (AGING_BUCKETS as readonly string[]).includes(String(r?.target_bucket)) ? String(r.target_bucket) : 'fresh_0_30d', expectedSavingsEur: Math.round(Number(r?.expected_savings_eur ?? 0)), implementationDays: Math.max(1, Number(r?.implementation_days ?? 7)), priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium' })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['arima', 'prophet', 'lstm', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['age_forecast', 'devaluation_forecast', 'sell_probability', 'risk_score'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'devaluation_forecast', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { agingRiskScore: Math.max(0, Math.min(100, Number(parsed?.summary?.aging_risk_score ?? 50))), agingGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.aging_grade)) ? String(parsed.summary.aging_grade) : 'C', totalDevaluationAtRiskEur: Math.round(Number(parsed?.summary?.total_devaluation_at_risk_eur ?? staleValue * 0.3)), criticalItemsCount: Math.max(0, Number(parsed?.summary?.critical_items_count ?? 0)), avgAgeDays: Math.max(0, Number(parsed?.summary?.avg_age_days ?? avgAge)), biggestAgingRisk: String(parsed?.summary?.biggest_aging_risk ?? '').slice(0, 200), biggestAgingOpportunity: String(parsed?.summary?.biggest_aging_opportunity ?? '').slice(0, 200), quickestAgingWin: String(parsed?.summary?.quickest_aging_win ?? '').slice(0, 200), agingPredictionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.aging_prediction_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, predictor });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
