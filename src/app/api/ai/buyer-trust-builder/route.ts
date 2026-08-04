// v6.90: AI Buyer Trust Builder — ML gradnja zaupanja kupcev z trust signals in verification
// POST /api/ai/buyer-trust-builder
// Body: { customerName?: string }
// Returns: { ok, builder: { overview, trustFactors, trustSignals, verificationSteps, recommendations, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const TRUST_LEVELS = ['trusted_partner', 'highly_trusted', 'trusted', 'building_trust', 'neutral', 'suspicious'] as const;
const TRUST_FACTORS = ['transaction_history', 'communication_quality', 'payment_reliability', 'review_score', 'dispute_history', 'response_time', 'transparency', 'consistency', 'social_proof', 'verification_status'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true }, take: 500, orderBy: { sellDate: 'desc' } });
    if (soldTrades.length === 0) return NextResponse.json({ ok: true, builder: null, message: 'Ni prodaj za trust building analizo.' });

    const buyerMap = new Map<string, { name: string; purchases: number; totalSpent: number; avgOrder: number; firstPurchase: Date | null; lastPurchase: Date | null; categories: Set<string>; daysSinceLast: number }>();
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2 || !t.sellDate) continue;
      const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, firstPurchase: t.sellDate, lastPurchase: t.sellDate, categories: new Set(), daysSinceLast: 0 });
      const b = buyerMap.get(name)!;
      b.purchases += 1; b.totalSpent += rev;
      if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate;
      if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
      if (t.category) b.categories.add(t.category);
    }
    const buyers = Array.from(buyerMap.values()).map(b => { b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0; b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / DAY) : 999; return b; });
    if (customerName) { const f = buyers.filter(b => b.name === customerName); if (f.length === 0) return NextResponse.json({ ok: true, builder: null, message: `Kupec "${customerName}" ni najden.` }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d`).join('\n');

    const prompt = `Si AI buyer trust builder z ML in trust signal analysis.
Gradi zaupanje kupcev z 6 nivoji in 10 dejavniki zaupanja.

KUPCI (${targetBuyers.length}):
${buyersStr}

6 nivojev zaupanja:
1. TRUSTED_PARTNER: najvišje zaupanje (90-100%)
2. HIGHLY_TRUSTED: zelo zaupan (75-89%)
3. TRUSTED: zaupan (60-74%)
4. BUILDING_TRUST: gradnja zaupanja (40-59%)
5. NEUTRAL: nevtralen (20-39%)
6. SUSPICIOUS: sumljiv (<20%)

10 dejavnikov zaupanja: transaction_history, communication_quality, payment_reliability, review_score, dispute_history, response_time, transparency, consistency, social_proof, verification_status

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_buyers": <number>, "avg_trust_score": <number 0-100>, "trusted_partner_count": <number>, "suspicious_count": <number>, "trust_growth_potential_pct": <number 0-100>, "trust_grade": "<A|B|C|D|F>" },
  "trustFactors": [
    { "factor": "<${TRUST_FACTORS.join('|')}>", "avg_score": <number 0-100>, "weight_pct": <number 0-100>, "impact_on_trust": "<high|medium|low>", "improvement_potential_pct": <number 0-50>, "improvement_strategy": "<max 120 znakov>" }
  ],
  "buyers": [
    { "name": "<string>", "current_trust_score": <number 0-100>, "trust_level": "<${TRUST_LEVELS.join('|')}>", "predicted_trust_6m_pct": <number 0-100>, "weakest_factor": "<${TRUST_FACTORS.join('|')}>", "strongest_factor": "<${TRUST_FACTORS.join('|')}>", "trust_trend": "<improving|stable|declining>", "recommended_action": "<reward|maintain|strengthen|verify|monitor>" }
  ],
  "trustSignals": [
    { "signal_type": "<verified_identity|transaction_history|review_count|response_rate|dispute_free_streak|loyalty_badge|social_proof|payment_consistency|communication_quality|longevity>", "current_status": "<present|absent|partial>", "impact_pct": <number 0-30>, "implementation_difficulty": "<easy|medium|hard>", "priority": "<high|medium|low>", "description": "<max 120 znakov>" }
  ],
  "verificationSteps": [
    { "step": "<max 150 znakov>", "verification_type": "<identity|payment|address|phone|email|social|business|product>", "buyer_coverage_pct": <number 0-100>, "trust_lift_pct": <number 0-30>, "implementation_days": <number>, "cost_eur": <number> }
  ],
  "recommendations": [
    { "buyer_name": "<string>", "action": "<max 150 znakov>", "expected_trust_lift_pct": <number 0-30>, "implementation_days": <number>, "priority": "<high|medium|low>", "long_term_impact": "<max 100 znakov>" }
  ],
  "mlModels": [
    { "model": "<random_forest|xgboost|neural_net|gradient_boosting|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<trust_prediction|risk_assessment|fraud_detection|behavior_analysis>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "trust_building_score": <number 0-100>, "trust_grade": "<A|B|C|D|F>", "avg_trust_score": <number 0-100>,
    "trusted_partner_count": <number>, "suspicious_count": <number>,
    "biggest_trust_risk": "<max 100 znakov>", "biggest_trust_opportunity": "<max 100 znakov>",
    "quickest_trust_win": "<max 100 znakov>", "trust_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const builder = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      overview: { totalBuyers: Math.max(0, Number(parsed?.overview?.total_buyers ?? targetBuyers.length)), avgTrustScore: Math.max(0, Math.min(100, Number(parsed?.overview?.avg_trust_score ?? 60))), trustedPartnerCount: Math.max(0, Number(parsed?.overview?.trusted_partner_count ?? 0)), suspiciousCount: Math.max(0, Number(parsed?.overview?.suspicious_count ?? 0)), trustGrowthPotentialPct: Math.max(0, Math.min(100, Number(parsed?.overview?.trust_growth_potential_pct ?? 30))), trustGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.trust_grade)) ? String(parsed.overview.trust_grade) : 'C' },
      trustFactors: (parsed?.trustFactors || []).slice(0, 10).map((f: any) => ({ factor: (TRUST_FACTORS as readonly string[]).includes(String(f?.factor)) ? String(f.factor) : 'transaction_history', avgScore: Math.max(0, Math.min(100, Number(f?.avg_score ?? 60))), weightPct: Math.max(0, Math.min(100, Number(f?.weight_pct ?? 10))), impactOnTrust: ['high', 'medium', 'low'].includes(String(f?.impact_on_trust)) ? String(f.impact_on_trust) : 'medium', improvementPotentialPct: Math.max(0, Math.min(50, Number(f?.improvement_potential_pct ?? 20))), improvementStrategy: String(f?.improvement_strategy ?? '').slice(0, 250) })),
      buyers: (parsed?.buyers || []).slice(0, 25).map((b: any) => ({ name: String(b?.name ?? '').slice(0, 100), currentTrustScore: Math.max(0, Math.min(100, Number(b?.current_trust_score ?? 60))), trustLevel: (TRUST_LEVELS as readonly string[]).includes(String(b?.trust_level)) ? String(b.trust_level) : 'building_trust', predictedTrust6mPct: Math.max(0, Math.min(100, Number(b?.predicted_trust_6m_pct ?? 65))), weakestFactor: (TRUST_FACTORS as readonly string[]).includes(String(b?.weakest_factor)) ? String(b.weakest_factor) : 'verification_status', strongestFactor: (TRUST_FACTORS as readonly string[]).includes(String(b?.strongest_factor)) ? String(b.strongest_factor) : 'transaction_history', trustTrend: ['improving', 'stable', 'declining'].includes(String(b?.trust_trend)) ? String(b.trust_trend) : 'stable', recommendedAction: ['reward', 'maintain', 'strengthen', 'verify', 'monitor'].includes(String(b?.recommended_action)) ? String(b.recommended_action) : 'maintain' })),
      trustSignals: (parsed?.trustSignals || []).slice(0, 10).map((s: any) => ({ signalType: String(s?.signal_type ?? 'verified_identity').slice(0, 50), currentStatus: ['present', 'absent', 'partial'].includes(String(s?.current_status)) ? String(s.current_status) : 'absent', impactPct: Math.max(0, Math.min(30, Number(s?.impact_pct ?? 10))), implementationDifficulty: ['easy', 'medium', 'hard'].includes(String(s?.implementation_difficulty)) ? String(s.implementation_difficulty) : 'medium', priority: ['high', 'medium', 'low'].includes(String(s?.priority)) ? String(s.priority) : 'medium', description: String(s?.description ?? '').slice(0, 250) })),
      verificationSteps: (parsed?.verificationSteps || []).slice(0, 8).map((v: any) => ({ step: String(v?.step ?? '').slice(0, 300), verificationType: ['identity', 'payment', 'address', 'phone', 'email', 'social', 'business', 'product'].includes(String(v?.verification_type)) ? String(v.verification_type) : 'identity', buyerCoveragePct: Math.max(0, Math.min(100, Number(v?.buyer_coverage_pct ?? 30))), trustLiftPct: Math.max(0, Math.min(30, Number(v?.trust_lift_pct ?? 10))), implementationDays: Math.max(1, Number(v?.implementation_days ?? 7)), costEur: Math.round(Number(v?.cost_eur ?? 0)) })),
      recommendations: (parsed?.recommendations || []).slice(0, 10).map((r: any) => ({ buyerName: String(r?.buyer_name ?? '').slice(0, 100), action: String(r?.action ?? '').slice(0, 300), expectedTrustLiftPct: Math.max(0, Math.min(30, Number(r?.expected_trust_lift_pct ?? 10))), implementationDays: Math.max(1, Number(r?.implementation_days ?? 7)), priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium', longTermImpact: String(r?.long_term_impact ?? '').slice(0, 200) })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['random_forest', 'xgboost', 'neural_net', 'gradient_boosting', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['trust_prediction', 'risk_assessment', 'fraud_detection', 'behavior_analysis'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'trust_prediction', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { trustBuildingScore: Math.max(0, Math.min(100, Number(parsed?.summary?.trust_building_score ?? 50))), trustGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.trust_grade)) ? String(parsed.summary.trust_grade) : 'C', avgTrustScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_trust_score ?? 60))), trustedPartnerCount: Math.max(0, Number(parsed?.summary?.trusted_partner_count ?? 0)), suspiciousCount: Math.max(0, Number(parsed?.summary?.suspicious_count ?? 0)), biggestTrustRisk: String(parsed?.summary?.biggest_trust_risk ?? '').slice(0, 200), biggestTrustOpportunity: String(parsed?.summary?.biggest_trust_opportunity ?? '').slice(0, 200), quickestTrustWin: String(parsed?.summary?.quickest_trust_win ?? '').slice(0, 200), trustAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.trust_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, builder });
  } catch (e: any) { logger.error("/api/ai/buyer-trust-builder", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
