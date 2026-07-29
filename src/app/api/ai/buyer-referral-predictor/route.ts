// v6.88: AI Buyer Referral Predictor — ML napoved referral vedenja kupcev z network analysis
// POST /api/ai/buyer-referral-predictor
// Body: { customerName?: string }
// Returns: { ok, predictor: { overview, buyers, referralPotential, networkAnalysis, incentives, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const REFERRAL_TIERS = ['super_advocate', 'advocate', 'potential_referrer', 'passive', 'unlikely', 'detractor'] as const;
const INCENTIVE_TYPES = ['cash_reward', 'discount_coupon', 'free_item', 'loyalty_points', 'exclusive_access', 'recognition', 'charity_donation', 'tier_upgrade'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true }, take: 500, orderBy: { sellDate: 'desc' } });
    if (soldTrades.length === 0) return NextResponse.json({ ok: true, predictor: null, message: 'Ni prodaj za referral analizo.' });

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
    const buyers = Array.from(buyerMap.values()).map(b => { b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0; b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / DAY) : 999; b.lifetimeDays = b.firstPurchase ? Math.round((now - b.firstPurchase.getTime()) / DAY) : 0; return b; });
    if (customerName) { const f = buyers.filter(b => b.name === customerName); if (f.length === 0) return NextResponse.json({ ok: true, predictor: null, message: `Kupec "${customerName}" ni najden.` }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d | ${b.lifetimeDays}d | ${b.categories.size} kat`).join('\n');

    const prompt = `Si AI buyer referral predictor z ML in network analysis.
Napoveduje referral vedenje kupcev z 6 tierji in 8 tipi spodbud.

KUPCI (${targetBuyers.length}):
${buyersStr}

6 referral tierjev:
1. SUPER_ADVOCATE: visoko verjetno (80-100%)
2. ADVOCATE: verjetno (60-79%)
3. POTENTIAL_REFERRER: morda (40-59%)
4. PASSIVE: nizko (20-39%)
5. UNLIKELY: zelo nizko (5-19%)
6. DETRACTOR: tveganje (<5%)

8 tipov spodbud: cash_reward, discount_coupon, free_item, loyalty_points, exclusive_access, recognition, charity_donation, tier_upgrade

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_buyers": <number>, "avg_referral_probability_pct": <number 0-100>, "super_advocates_count": <number>, "detractors_count": <number>, "estimated_annual_referrals": <number>, "estimated_referral_value_eur": <number>, "referral_grade": "<A|B|C|D|F>" },
  "buyers": [
    { "name": "<string>", "referral_probability_pct": <number 0-100>, "referral_tier": "<${REFERRAL_TIERS.join('|')}>", "estimated_referrals_per_year": <number>, "estimated_referral_value_eur": <number>, "network_reach_score": <number 0-100>, "influence_score": <number 0-100>, "recommended_incentive": "<${INCENTIVE_TYPES.join('|')}>" }
  ],
  "referralPotential": [
    { "buyer_name": "<string>", "current_referrals_made": <number>, "potential_referrals_12m": <number>, "conversion_rate_of_referrals_pct": <number 0-100>, "avg_referred_buyer_value_eur": <number>, "total_referral_value_eur": <number>, "best_timing": "<post_purchase|holiday|milestone|anytime>" }
  ],
  "networkAnalysis": [
    { "buyer_name": "<string>", "network_size_estimate": <number>, "network_influence_pct": <number 0-100>, "social_proof_potential": "<high|medium|low>", "viral_coefficient": <number 0-2>, "amplification_factor": <number 1-10> }
  ],
  "incentives": [
    { "incentive_type": "<${INCENTIVE_TYPES.join('|')}>", "cost_per_referral_eur": <number>, "expected_referral_count": <number>, "expected_revenue_eur": <number>, "roi_pct": <number>, "target_tier": "<${REFERRAL_TIERS.join('|')}>" }
  ],
  "mlModels": [
    { "model": "<random_forest|xgboost|neural_net|graph_neural_net|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<referral_probability|network_influence|conversion_prediction|viral_forecast>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "referral_prediction_score": <number 0-100>, "referral_grade": "<A|B|C|D|F>", "total_referral_potential_eur": <number>,
    "super_advocates_count": <number>, "avg_referral_probability_pct": <number 0-100>,
    "biggest_referral_risk": "<max 100 znakov>", "biggest_referral_opportunity": "<max 100 znakov>",
    "quickest_referral_win": "<max 100 znakov>", "referral_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const predictor = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      overview: { totalBuyers: Math.max(0, Number(parsed?.overview?.total_buyers ?? targetBuyers.length)), avgReferralProbabilityPct: Math.max(0, Math.min(100, Number(parsed?.overview?.avg_referral_probability_pct ?? 30))), superAdvocatesCount: Math.max(0, Number(parsed?.overview?.super_advocates_count ?? 0)), detractorsCount: Math.max(0, Number(parsed?.overview?.detractors_count ?? 0)), estimatedAnnualReferrals: Math.max(0, Number(parsed?.overview?.estimated_annual_referrals ?? 0)), estimatedReferralValueEur: Math.round(Number(parsed?.overview?.estimated_referral_value_eur ?? 0)), referralGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.referral_grade)) ? String(parsed.overview.referral_grade) : 'C' },
      buyers: (parsed?.buyers || []).slice(0, 25).map((b: any) => ({ name: String(b?.name ?? '').slice(0, 100), referralProbabilityPct: Math.max(0, Math.min(100, Number(b?.referral_probability_pct ?? 30))), referralTier: (REFERRAL_TIERS as readonly string[]).includes(String(b?.referral_tier)) ? String(b.referral_tier) : 'potential_referrer', estimatedReferralsPerYear: Math.max(0, Number(b?.estimated_referrals_per_year ?? 0)), estimatedReferralValueEur: Math.round(Number(b?.estimated_referral_value_eur ?? 0)), networkReachScore: Math.max(0, Math.min(100, Number(b?.network_reach_score ?? 50))), influenceScore: Math.max(0, Math.min(100, Number(b?.influence_score ?? 50))), recommendedIncentive: (INCENTIVE_TYPES as readonly string[]).includes(String(b?.recommended_incentive)) ? String(b.recommended_incentive) : 'discount_coupon' })),
      referralPotential: (parsed?.referralPotential || []).slice(0, 25).map((r: any) => ({ buyerName: String(r?.buyer_name ?? '').slice(0, 100), currentReferralsMade: Math.max(0, Number(r?.current_referrals_made ?? 0)), potentialReferrals12m: Math.max(0, Number(r?.potential_referrals_12m ?? 0)), conversionRateOfReferralsPct: Math.max(0, Math.min(100, Number(r?.conversion_rate_of_referrals_pct ?? 40))), avgReferredBuyerValueEur: Math.round(Number(r?.avg_referred_buyer_value_eur ?? 0)), totalReferralValueEur: Math.round(Number(r?.total_referral_value_eur ?? 0)), bestTiming: ['post_purchase', 'holiday', 'milestone', 'anytime'].includes(String(r?.best_timing)) ? String(r.best_timing) : 'post_purchase' })),
      networkAnalysis: (parsed?.networkAnalysis || []).slice(0, 25).map((n: any) => ({ buyerName: String(n?.buyer_name ?? '').slice(0, 100), networkSizeEstimate: Math.max(0, Number(n?.network_size_estimate ?? 50)), networkInfluencePct: Math.max(0, Math.min(100, Number(n?.network_influence_pct ?? 40))), socialProofPotential: ['high', 'medium', 'low'].includes(String(n?.social_proof_potential)) ? String(n.social_proof_potential) : 'medium', viralCoefficient: Math.max(0, Math.min(2, Number(n?.viral_coefficient ?? 0.5))), amplificationFactor: Math.max(1, Math.min(10, Number(n?.amplification_factor ?? 1))) })),
      incentives: (parsed?.incentives || []).slice(0, 8).map((i: any) => ({ incentiveType: (INCENTIVE_TYPES as readonly string[]).includes(String(i?.incentive_type)) ? String(i.incentive_type) : 'discount_coupon', costPerReferralEur: Math.round(Number(i?.cost_per_referral_eur ?? 0) * 100) / 100, expectedReferralCount: Math.max(0, Number(i?.expected_referral_count ?? 0)), expectedRevenueEur: Math.round(Number(i?.expected_revenue_eur ?? 0)), roiPct: Math.round(Number(i?.roi_pct ?? 0) * 10) / 10, targetTier: (REFERRAL_TIERS as readonly string[]).includes(String(i?.target_tier)) ? String(i.target_tier) : 'advocate' })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['random_forest', 'xgboost', 'neural_net', 'graph_neural_net', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['referral_probability', 'network_influence', 'conversion_prediction', 'viral_forecast'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'referral_probability', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { referralPredictionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.referral_prediction_score ?? 50))), referralGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.referral_grade)) ? String(parsed.summary.referral_grade) : 'C', totalReferralPotentialEur: Math.round(Number(parsed?.summary?.total_referral_potential_eur ?? 0)), superAdvocatesCount: Math.max(0, Number(parsed?.summary?.super_advocates_count ?? 0)), avgReferralProbabilityPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_referral_probability_pct ?? 30))), biggestReferralRisk: String(parsed?.summary?.biggest_referral_risk ?? '').slice(0, 200), biggestReferralOpportunity: String(parsed?.summary?.biggest_referral_opportunity ?? '').slice(0, 200), quickestReferralWin: String(parsed?.summary?.quickest_referral_win ?? '').slice(0, 200), referralAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.referral_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, predictor });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
