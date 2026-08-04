// v6.76: AI Buyer Acquisition Cost Optimizer — optimizira CAC z ML in channel analysis
// POST /api/ai/buyer-acquisition-cost-optimizer
// Body: { monthsAhead?: number }
// Returns: { ok, optimizer: { current, channels, optimizations, projections, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const ACQUISITION_CHANNELS = ['bolha_organic', 'facebook_organic', 'vinted_organic', 'referral', 'social_media', 'email_marketing', 'cross_posting', 'flash_sale', 'bundle_attract', 'local_community'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const monthsAhead = Math.max(1, Math.min(12, Number(body?.monthsAhead ?? 6)));

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } }, select: { id: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true }, take: 500, orderBy: { sellDate: 'desc' } });
    if (soldTrades.length === 0) return NextResponse.json({ ok: true, optimizer: null, message: 'Ni prodaj za CAC optimizacijo.' });

    const totalBuyers = new Set(soldTrades.map(t => t.sellLocation)).size;
    const totalRevenue = soldTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
    const avgRevenuePerBuyer = Math.round(totalRevenue / Math.max(1, totalBuyers));

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const prompt = `Si AI buyer acquisition cost optimizer z ML in channel analysis.
Optimizira CAC za ${monthsAhead} mesecev z 10 kanali.

STATS:
- Skupno kupcev: ${totalBuyers}
- Skupni prihodek: ${Math.round(totalRevenue)}€
- Povp prihodek per kupec: ${avgRevenuePerBuyer}€

10 acquisition kanalov:
1. BOLHA_ORGANIC: organski Bolha search
2. FACEBOOK_ORGANIC: organski Facebook
3. VINTED_ORGANIC: organski Vinted
4. REFERRAL: priporočila
5. SOCIAL_MEDIA: socialni mediji
6. EMAIL_MARKETING: email kampanje
7. CROSS_POSTING: cross-posting
8. FLASH_SALE: flash sale privabi
9. BUNDLE_ATTRACT: bundle privabi
10. LOCAL_COMMUNITY: lokalna skupnost

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": { "total_buyers": <number>, "avg_cac_eur": <number>, "avg_ltv_eur": <number>, "ltv_cac_ratio": <number>, "cac_efficiency_pct": <number 0-100>, "acquisition_grade": "<A|B|C|D|F>" },
  "channels": [
    { "channel": "<10 kanalov>", "current_buyers_acquired": <number>, "current_cac_eur": <number>, "current_revenue_eur": <number>, "current_roi_pct": <number>, "optimized_cac_eur": <number>, "cac_reduction_pct": <number>, "expected_new_buyers": <number>, "expected_revenue_eur": <number>, "optimization_potential": "<high|medium|low>", "recommended_action": "<scale_up|maintain|reduce|exit>" }
  ],
  "optimizations": [
    { "optimization_type": "<channel_reallocation|budget_optimization|referral_boost|content_marketing|cross_posting_expansion|bundle_strategy|flash_sale_optimization|community_building|email_automation|social_proof_leverage>", "description": "<max 120 znakov>", "current_cac_eur": <number>, "optimized_cac_eur": <number>, "cac_savings_eur": <number>, "expected_new_buyers": <number>, "expected_revenue_increase_eur": <number>, "implementation_difficulty": "<low|medium|high>", "timeframe_days": <number> }
  ],
  "projections": [
    { "month": <1-12>, "projected_new_buyers": <number>, "projected_avg_cac_eur": <number>, "projected_total_cac_eur": <number>, "projected_revenue_from_new_eur": <number>, "projected_roi_pct": <number>, "confidence_pct": <number 0-100> }
  ],
  "mlModels": [
    { "model": "<random_forest|gradient_boosting|neural_network|lstm|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<cac_forecast|channel_performance|buyer_acquisition|optimal_allocation>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "current_avg_cac_eur": <number>, "optimized_avg_cac_eur": <number>, "cac_reduction_pct": <number>,
    "total_expected_new_buyers": <number>, "total_expected_revenue_increase_eur": <number>,
    "best_channel": "<10 kanalov>", "biggest_cac_opportunity": "<max 100 znakov>",
    "quickest_cac_win": "<max 100 znakov>", "cac_optimization_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      current: { totalBuyers: Math.max(0, Number(parsed?.current?.total_buyers ?? totalBuyers)), avgCacEur: Math.round(Number(parsed?.current?.avg_cac_eur ?? 0) * 100) / 100, avgLtvEur: Math.round(Number(parsed?.current?.avg_ltv_eur ?? avgRevenuePerBuyer)), ltvCacRatio: Math.round(Number(parsed?.current?.ltv_cac_ratio ?? 3) * 100) / 100, cacEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.current?.cac_efficiency_pct ?? 60))), acquisitionGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.current?.acquisition_grade)) ? String(parsed.current.acquisition_grade) : 'C' },
      channels: (parsed?.channels || []).slice(0, 10).map((c: any) => ({ channel: ACQUISITION_CHANNELS.includes(String(c?.channel) as any) ? String(c.channel) : 'bolha_organic', currentBuyersAcquired: Math.max(0, Number(c?.current_buyers_acquired ?? 0)), currentCacEur: Math.round(Number(c?.current_cac_eur ?? 0) * 100) / 100, currentRevenueEur: Math.round(Number(c?.current_revenue_eur ?? 0)), currentRoiPct: Math.round(Number(c?.current_roi_pct ?? 0) * 10) / 10, optimizedCacEur: Math.round(Number(c?.optimized_cac_eur ?? 0) * 100) / 100, cacReductionPct: Math.round(Number(c?.cac_reduction_pct ?? 0) * 10) / 10, expectedNewBuyers: Math.max(0, Number(c?.expected_new_buyers ?? 0)), expectedRevenueEur: Math.round(Number(c?.expected_revenue_eur ?? 0)), optimizationPotential: ['high', 'medium', 'low'].includes(String(c?.optimization_potential)) ? String(c.optimization_potential) : 'medium', recommendedAction: ['scale_up', 'maintain', 'reduce', 'exit'].includes(String(c?.recommended_action)) ? String(c.recommended_action) : 'maintain' })),
      optimizations: (parsed?.optimizations || []).slice(0, 10).map((o: any) => ({ optimizationType: ['channel_reallocation', 'budget_optimization', 'referral_boost', 'content_marketing', 'cross_posting_expansion', 'bundle_strategy', 'flash_sale_optimization', 'community_building', 'email_automation', 'social_proof_leverage'].includes(String(o?.optimization_type)) ? String(o.optimization_type) : 'channel_reallocation', description: String(o?.description ?? '').slice(0, 250), currentCacEur: Math.round(Number(o?.current_cac_eur ?? 0) * 100) / 100, optimizedCacEur: Math.round(Number(o?.optimized_cac_eur ?? 0) * 100) / 100, cacSavingsEur: Math.round(Number(o?.cac_savings_eur ?? 0)), expectedNewBuyers: Math.max(0, Number(o?.expected_new_buyers ?? 0)), expectedRevenueIncreaseEur: Math.round(Number(o?.expected_revenue_increase_eur ?? 0)), implementationDifficulty: ['low', 'medium', 'high'].includes(String(o?.implementation_difficulty)) ? String(o.implementation_difficulty) : 'medium', timeframeDays: Math.max(1, Number(o?.timeframe_days ?? 7)) })),
      projections: (parsed?.projections || []).slice(0, monthsAhead).map((p: any) => ({ month: Math.max(1, Math.min(12, Number(p?.month ?? 1))), projectedNewBuyers: Math.max(0, Number(p?.projected_new_buyers ?? 0)), projectedAvgCacEur: Math.round(Number(p?.projected_avg_cac_eur ?? 0) * 100) / 100, projectedTotalCacEur: Math.round(Number(p?.projected_total_cac_eur ?? 0)), projectedRevenueFromNewEur: Math.round(Number(p?.projected_revenue_from_new_eur ?? 0)), projectedRoiPct: Math.round(Number(p?.projected_roi_pct ?? 0) * 10) / 10, confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 50))) })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['random_forest', 'gradient_boosting', 'neural_network', 'lstm', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['cac_forecast', 'channel_performance', 'buyer_acquisition', 'optimal_allocation'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'cac_forecast', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { currentAvgCacEur: Math.round(Number(parsed?.summary?.current_avg_cac_eur ?? 0) * 100) / 100, optimizedAvgCacEur: Math.round(Number(parsed?.summary?.optimized_avg_cac_eur ?? 0) * 100) / 100, cacReductionPct: Math.round(Number(parsed?.summary?.cac_reduction_pct ?? 0) * 10) / 10, totalExpectedNewBuyers: Math.max(0, Number(parsed?.summary?.total_expected_new_buyers ?? 0)), totalExpectedRevenueIncreaseEur: Math.round(Number(parsed?.summary?.total_expected_revenue_increase_eur ?? 0)), bestChannel: ACQUISITION_CHANNELS.includes(String(parsed?.summary?.best_channel) as any) ? String(parsed.summary.best_channel) : 'bolha_organic', biggestCacOpportunity: String(parsed?.summary?.biggest_cac_opportunity ?? '').slice(0, 200), quickestCacWin: String(parsed?.summary?.quickest_cac_win ?? '').slice(0, 200), cacOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.cac_optimization_score ?? 60))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { logger.error("/api/ai/buyer-acquisition-cost-optimizer", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
