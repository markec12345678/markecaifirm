// v6.79: AI Buyer Payment Reliability — ML napoved zanesljivosti plačila kupca
// POST /api/ai/buyer-payment-reliability
// Body: { customerName?: string }
// Returns: { ok, analyzer: { buyers, paymentPatterns, riskFactors, recommendations, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const RELIABILITY_TIERS = ['platinum', 'gold', 'silver', 'bronze', 'risk', 'blocked'] as const;
const PAYMENT_METHODS = ['cash', 'bank_transfer', 'paypal', 'card', 'crypto', 'cod', 'installments'] as const;
const RISK_FACTORS = ['late_payment_history', 'partial_payments', 'disputed_transactions', 'no_show', 'cancelled_deals', 'communication_breakdown', 'price_renegotiation', 'payment_method_risk'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true, notes: true }, take: 500, orderBy: { sellDate: 'desc' } });
    const cancelledTrades = await db.trade.findMany({ where: { status: 'cancelled' }, select: { id: true, title: true, category: true, buyPrice: true, buyLocation: true, notes: true }, take: 100 });
    if (soldTrades.length === 0) return NextResponse.json({ ok: true, analyzer: null, message: 'Ni prodaj za payment reliability analizo.' });

    const buyerMap = new Map<string, { name: string; purchases: number; totalSpent: number; avgOrder: number; firstPurchase: Date | null; lastPurchase: Date | null; categories: Set<string>; cancellations: number; totalLost: number }>();
    const now = Date.now();
    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2 || !t.sellDate) continue;
      const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, firstPurchase: t.sellDate, lastPurchase: t.sellDate, categories: new Set(), cancellations: 0, totalLost: 0 });
      const b = buyerMap.get(name)!;
      b.purchases += 1; b.totalSpent += rev;
      if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate;
      if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
      if (t.category) b.categories.add(t.category);
    }
    for (const c of cancelledTrades) {
      const name = (c.buyLocation || '').trim();
      if (!name || name.length < 2) continue;
      if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, firstPurchase: null, lastPurchase: null, categories: new Set(), cancellations: 0, totalLost: 0 });
      const b = buyerMap.get(name)!;
      b.cancellations += 1; b.totalLost += c.buyPrice;
    }
    const buyers = Array.from(buyerMap.values()).map(b => { b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0; return b; });
    if (customerName) { const f = buyers.filter(b => b.name === customerName); if (f.length === 0) return NextResponse.json({ ok: true, analyzer: null, message: `Kupec "${customerName}" ni najden.` }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.cancellations} cancel | ${b.totalLost}€ izguba | ${b.categories.size} kat`).join('\n');

    const prompt = `Si AI buyer payment reliability analyzer z ML in risk assessment.
Napoveduje zanesljivost plačila kupca z 6 tierji in 8 dejavnikov tveganja.

KUPCI (${targetBuyers.length}):
${buyersStr}

6 reliability tierjev:
1. PLATINUM: 95-100% zanesljivost, velika忠诚nost
2. GOLD: 85-94% zanesljivost
3. SILVER: 70-84% zanesljivost
4. BRONZE: 55-69% zanesljivost
5. RISK: 30-54% zanesljivost
6. BLOCKED: <30% zanesljivost, nevarni kupec

7 plačilnih metod: cash, bank_transfer, paypal, card, crypto, cod, installments

8 dejavnikov tveganja:
1. LATE_PAYMENT_HISTORY: zamude pri plačilih
2. PARTIAL_PAYMENTS: delna plačila
3. DISPUTED_TRANSACTIONS: sporne transakcije
4. NO_SHOW: kupec se ne pojavi
5. CANCELLED_DEALS: preklicane pogodbe
6. COMMUNICATION_BREAKDOWN: prekinitev komunikacije
7. PRICE_RENEGOTIATION: ponovno pogajanje cene
8. PAYMENT_METHOD_RISK: tveganje plačilne metode

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    { "name": "<string>", "reliability_score": <number 0-100>, "reliability_tier": "<${RELIABILITY_TIERS.join('|')}>", "total_purchases": <number>, "total_spent_eur": <number>, "cancellation_count": <number>, "total_lost_eur": <number>, "preferred_payment_method": "<${PAYMENT_METHODS.join('|')}>", "predicted_reliability_pct": <number 0-100>, "recommended_action": "<accept|accept_with_caution|require_deposit|require_escrow|decline>" }
  ],
  "paymentPatterns": [
    { "pattern": "<consistent_early|on_time|occasionally_late|frequently_late|partial_payments|no_show_pattern>", "frequency_pct": <number 0-100>, "avg_delay_days": <number>, "impact_eur": <number>, "affected_buyer_count": <number> }
  ],
  "riskFactors": [
    { "factor": "<${RISK_FACTORS.join('|')}>", "severity": "<critical|high|medium|low>", "frequency_pct": <number 0-100>, "financial_impact_eur": <number>, "mitigation_strategy": "<max 150 znakov>" }
  ],
  "recommendations": [
    { "buyer_name": "<string>", "action": "<accept|accept_with_caution|require_deposit|require_escrow|decline>", "deposit_amount_pct": <number 0-50>, "rationale": "<max 150 znakov>", "expected_risk_reduction_pct": <number 0-100> }
  ],
  "mlModels": [
    { "model": "<gradient_boosting|random_forest|neural_net|logistic_regression|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<payment_reliability|risk_score|default_probability|tier_classification>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "portfolio_reliability_score": <number 0-100>, "portfolio_reliability_grade": "<A|B|C|D|F>", "total_at_risk_eur": <number>,
    "high_risk_buyers_count": <number>, "platinum_buyers_count": <number>,
    "biggest_payment_risk": "<max 100 znakov>", "biggest_reliability_opportunity": "<max 100 znakov>",
    "quickest_risk_mitigation": "<max 100 znakov>", "reliability_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const analyzer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      buyers: (parsed?.buyers || []).slice(0, 25).map((b: any) => ({ name: String(b?.name ?? '').slice(0, 100), reliabilityScore: Math.max(0, Math.min(100, Number(b?.reliability_score ?? 70))), reliabilityTier: (RELIABILITY_TIERS as readonly string[]).includes(String(b?.reliability_tier)) ? String(b.reliability_tier) : 'silver', totalPurchases: Math.max(0, Number(b?.total_purchases ?? 0)), totalSpentEur: Math.round(Number(b?.total_spent_eur ?? 0)), cancellationCount: Math.max(0, Number(b?.cancellation_count ?? 0)), totalLostEur: Math.round(Number(b?.total_lost_eur ?? 0)), preferredPaymentMethod: (PAYMENT_METHODS as readonly string[]).includes(String(b?.preferred_payment_method)) ? String(b.preferred_payment_method) : 'cash', predictedReliabilityPct: Math.max(0, Math.min(100, Number(b?.predicted_reliability_pct ?? 70))), recommendedAction: ['accept', 'accept_with_caution', 'require_deposit', 'require_escrow', 'decline'].includes(String(b?.recommended_action)) ? String(b.recommended_action) : 'accept' })),
      paymentPatterns: (parsed?.paymentPatterns || []).slice(0, 8).map((p: any) => ({ pattern: String(p?.pattern ?? '').slice(0, 100), frequencyPct: Math.max(0, Math.min(100, Number(p?.frequency_pct ?? 0))), avgDelayDays: Math.max(0, Number(p?.avg_delay_days ?? 0)), impactEur: Math.round(Number(p?.impact_eur ?? 0)), affectedBuyerCount: Math.max(0, Number(p?.affected_buyer_count ?? 0)) })),
      riskFactors: (parsed?.riskFactors || []).slice(0, 8).map((r: any) => ({ factor: (RISK_FACTORS as readonly string[]).includes(String(r?.factor)) ? String(r.factor) : 'late_payment_history', severity: ['critical', 'high', 'medium', 'low'].includes(String(r?.severity)) ? String(r.severity) : 'medium', frequencyPct: Math.max(0, Math.min(100, Number(r?.frequency_pct ?? 0))), financialImpactEur: Math.round(Number(r?.financial_impact_eur ?? 0)), mitigationStrategy: String(r?.mitigation_strategy ?? '').slice(0, 300) })),
      recommendations: (parsed?.recommendations || []).slice(0, 10).map((r: any) => ({ buyerName: String(r?.buyer_name ?? '').slice(0, 100), action: ['accept', 'accept_with_caution', 'require_deposit', 'require_escrow', 'decline'].includes(String(r?.action)) ? String(r.action) : 'accept', depositAmountPct: Math.max(0, Math.min(50, Number(r?.deposit_amount_pct ?? 0))), rationale: String(r?.rationale ?? '').slice(0, 300), expectedRiskReductionPct: Math.max(0, Math.min(100, Number(r?.expected_risk_reduction_pct ?? 0))) })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['gradient_boosting', 'random_forest', 'neural_net', 'logistic_regression', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['payment_reliability', 'risk_score', 'default_probability', 'tier_classification'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'payment_reliability', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { portfolioReliabilityScore: Math.max(0, Math.min(100, Number(parsed?.summary?.portfolio_reliability_score ?? 60))), portfolioReliabilityGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.portfolio_reliability_grade)) ? String(parsed.summary.portfolio_reliability_grade) : 'C', totalAtRiskEur: Math.round(Number(parsed?.summary?.total_at_risk_eur ?? 0)), highRiskBuyersCount: Math.max(0, Number(parsed?.summary?.high_risk_buyers_count ?? 0)), platinumBuyersCount: Math.max(0, Number(parsed?.summary?.platinum_buyers_count ?? 0)), biggestPaymentRisk: String(parsed?.summary?.biggest_payment_risk ?? '').slice(0, 200), biggestReliabilityOpportunity: String(parsed?.summary?.biggest_reliability_opportunity ?? '').slice(0, 200), quickestRiskMitigation: String(parsed?.summary?.quickest_risk_mitigation ?? '').slice(0, 200), reliabilityAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.reliability_analysis_score ?? 60))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, analyzer });
  } catch (e: any) { logger.error("/api/ai/buyer-payment-reliability", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
