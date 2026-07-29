// v6.91: AI Buyer Reactivation Engine — ML reaktivacija neaktivnih kupcev z win-back strategy
// POST /api/ai/buyer-reactivation-engine
// Body: { customerName?: string, inactiveDays?: number }
// Returns: { ok, engine: { overview, inactiveBuyers, reactivationStrategies, campaignPlan, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const REACTIVATION_TIERS = ['highly_reactivatable', 'reactivatable', 'difficult_to_reactivate', 'hard_to_reactivate', 'unlikely_to_reactivate', 'lost'] as const;
const STRATEGY_TYPES = ['win_back_discount', 'personalized_outreach', 'new_product_alert', 'loyalty_reward', 'feedback_request', 'exclusive_offer', 'milestone_celebration', 're_engagement_campaign'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;
    const inactiveDays = Math.max(30, Math.min(730, Number(body?.inactiveDays ?? 90)));

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true }, take: 500, orderBy: { sellDate: 'desc' } });
    if (soldTrades.length === 0) return NextResponse.json({ ok: true, engine: null, message: 'Ni prodaj za reactivation analizo.' });

    const buyerMap = new Map<string, { name: string; purchases: number; totalSpent: number; avgOrder: number; firstPurchase: Date | null; lastPurchase: Date | null; categories: Set<string>; daysSinceLast: number; lifetimeDays: number }>();
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2 || !t.sellDate) continue;
      const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, firstPurchase: t.sellDate, lastPurchase: t.sellDate, categories: new Set(), daysSinceLast: 0, lifetimeDays: 0 });
      const b = buyerMap.get(name)!;
      b.purchases += 1; b.totalSpent += rev;
      if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate;
      if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
      if (t.category) b.categories.add(t.category);
    }
    const allBuyers = Array.from(buyerMap.values()).map(b => { b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0; b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / DAY) : 999; b.lifetimeDays = b.firstPurchase ? Math.round((now - b.firstPurchase.getTime()) / DAY) : 0; return b; });
    const inactiveBuyers = allBuyers.filter(b => b.daysSinceLast >= inactiveDays);
    if (customerName) { const f = allBuyers.filter(b => b.name === customerName); if (f.length === 0) return NextResponse.json({ ok: true, engine: null, message: `Kupec "${customerName}" ni najden.` }); }
    if (inactiveBuyers.length === 0) return NextResponse.json({ ok: true, engine: null, message: `Ni neaktivnih kupcev (>${inactiveDays} dni).` });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const targetBuyers = customerName ? allBuyers.filter(b => b.name === customerName) : inactiveBuyers.slice(0, 25);
    const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d neaktiven | ${b.lifetimeDays}d lifetime`).join('\n');

    const prompt = `Si AI buyer reactivation engine z ML in win-back strategy design.
Reaktivira neaktivne kupce (>${inactiveDays} dni) z 6 tierji in 8 strategijami.

NEAKTIVNI KUPCI (${targetBuyers.length}, >${inactiveDays} dni):
${buyersStr}

6 reactivation tierjev:
1. HIGHLY_REACTIVATABLE: 80-100% verjetnost reaktivacije
2. REACTIVATABLE: 60-79%
3. DIFFICULT_TO_REACTIVATE: 40-59%
4. HARD_TO_REACTIVATE: 20-39%
5. UNLIKELY_TO_REACTIVATE: 5-19%
6. LOST: <5%

8 strategij reaktivacije: win_back_discount, personalized_outreach, new_product_alert, loyalty_reward, feedback_request, exclusive_offer, milestone_celebration, re_engagement_campaign

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_inactive_buyers": <number>, "total_inactive_value_eur": <number>, "avg_inactive_days": <number>, "avg_reactivation_probability_pct": <number 0-100>, "highly_reactivatable_count": <number>, "reactivation_grade": "<A|B|C|D|F>" },
  "inactiveBuyers": [
    { "name": "<string>", "days_inactive": <number>, "lifetime_value_eur": <number>, "last_purchase_value_eur": <number>, "reactivation_probability_pct": <number 0-100>, "reactivation_tier": "<${REACTIVATION_TIERS.join('|')}>", "preferred_strategy": "<${STRATEGY_TYPES.join('|')}>" }
  ],
  "reactivationStrategies": [
    { "strategy_type": "<${STRATEGY_TYPES.join('|')}>", "target_buyer_count": <number>, "estimated_cost_eur": <number>, "expected_reactivations": <number>, "expected_revenue_eur": <number>, "roi_pct": <number>, "best_for_tier": "<${REACTIVATION_TIERS.join('|')}>" }
  ],
  "campaignPlan": [
    { "phase": "<awareness|consideration|incentive|follow_up|retention>", "channel": "<email|sms|whatsapp|push|social|phone>", "timing_days": <number>, "message_theme": "<max 100 znakov>", "estimated_cost_eur": <number>, "expected_response_rate_pct": <number 0-100> }
  ],
  "mlModels": [
    { "model": "<random_forest|xgboost|neural_net|survival_analysis|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<reactivation_probability|churn_prediction|response_forecast|value_prediction>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "reactivation_score": <number 0-100>, "reactivation_grade": "<A|B|C|D|F>", "total_reactivatable_value_eur": <number>,
    "expected_reactivation_count": <number>, "expected_revenue_recovery_eur": <number>,
    "biggest_reactivation_risk": "<max 100 znakov>", "biggest_reactivation_opportunity": "<max 100 znakov>",
    "quickest_reactivation_win": "<max 100 znakov>", "reactivation_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const engine = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      overview: { totalInactiveBuyers: Math.max(0, Number(parsed?.overview?.total_inactive_buyers ?? inactiveBuyers.length)), totalInactiveValueEur: Math.round(Number(parsed?.overview?.total_inactive_value_eur ?? inactiveBuyers.reduce((s, b) => s + b.totalSpent, 0))), avgInactiveDays: Math.max(0, Number(parsed?.overview?.avg_inactive_days ?? Math.round(inactiveBuyers.reduce((s, b) => s + b.daysSinceLast, 0) / Math.max(1, inactiveBuyers.length)))), avgReactivationProbabilityPct: Math.max(0, Math.min(100, Number(parsed?.overview?.avg_reactivation_probability_pct ?? 30))), highlyReactivatableCount: Math.max(0, Number(parsed?.overview?.highly_reactivatable_count ?? 0)), reactivationGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.reactivation_grade)) ? String(parsed.overview.reactivation_grade) : 'C' },
      inactiveBuyers: (parsed?.inactiveBuyers || []).slice(0, 25).map((b: any) => ({ name: String(b?.name ?? '').slice(0, 100), daysInactive: Math.max(0, Number(b?.days_inactive ?? 0)), lifetimeValueEur: Math.round(Number(b?.lifetime_value_eur ?? 0)), lastPurchaseValueEur: Math.round(Number(b?.last_purchase_value_eur ?? 0)), reactivationProbabilityPct: Math.max(0, Math.min(100, Number(b?.reactivation_probability_pct ?? 30))), reactivationTier: (REACTIVATION_TIERS as readonly string[]).includes(String(b?.reactivation_tier)) ? String(b.reactivation_tier) : 'reactivatable', preferredStrategy: (STRATEGY_TYPES as readonly string[]).includes(String(b?.preferred_strategy)) ? String(b.preferred_strategy) : 'personalized_outreach' })),
      reactivationStrategies: (parsed?.reactivationStrategies || []).slice(0, 8).map((s: any) => ({ strategyType: (STRATEGY_TYPES as readonly string[]).includes(String(s?.strategy_type)) ? String(s.strategy_type) : 'personalized_outreach', targetBuyerCount: Math.max(0, Number(s?.target_buyer_count ?? 0)), estimatedCostEur: Math.round(Number(s?.estimated_cost_eur ?? 0)), expectedReactivations: Math.max(0, Number(s?.expected_reactivations ?? 0)), expectedRevenueEur: Math.round(Number(s?.expected_revenue_eur ?? 0)), roiPct: Math.round(Number(s?.roi_pct ?? 0) * 10) / 10, bestForTier: (REACTIVATION_TIERS as readonly string[]).includes(String(s?.best_for_tier)) ? String(s.best_for_tier) : 'reactivatable' })),
      campaignPlan: (parsed?.campaignPlan || []).slice(0, 5).map((c: any) => ({ phase: ['awareness', 'consideration', 'incentive', 'follow_up', 'retention'].includes(String(c?.phase)) ? String(c.phase) : 'awareness', channel: ['email', 'sms', 'whatsapp', 'push', 'social', 'phone'].includes(String(c?.channel)) ? String(c.channel) : 'email', timingDays: Math.max(0, Number(c?.timing_days ?? 0)), messageTheme: String(c?.message_theme ?? '').slice(0, 200), estimatedCostEur: Math.round(Number(c?.estimated_cost_eur ?? 0)), expectedResponseRatePct: Math.max(0, Math.min(100, Number(c?.expected_response_rate_pct ?? 15))) })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['random_forest', 'xgboost', 'neural_net', 'survival_analysis', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['reactivation_probability', 'churn_prediction', 'response_forecast', 'value_prediction'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'reactivation_probability', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { reactivationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.reactivation_score ?? 50))), reactivationGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.reactivation_grade)) ? String(parsed.summary.reactivation_grade) : 'C', totalReactivatableValueEur: Math.round(Number(parsed?.summary?.total_reactivatable_value_eur ?? 0)), expectedReactivationCount: Math.max(0, Number(parsed?.summary?.expected_reactivation_count ?? 0)), expectedRevenueRecoveryEur: Math.round(Number(parsed?.summary?.expected_revenue_recovery_eur ?? 0)), biggestReactivationRisk: String(parsed?.summary?.biggest_reactivation_risk ?? '').slice(0, 200), biggestReactivationOpportunity: String(parsed?.summary?.biggest_reactivation_opportunity ?? '').slice(0, 200), quickestReactivationWin: String(parsed?.summary?.quickest_reactivation_win ?? '').slice(0, 200), reactivationAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.reactivation_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, engine });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
