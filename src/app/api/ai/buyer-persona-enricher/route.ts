// v6.83: AI Buyer Persona Enricher — ML obogatitev buyer personas z demographics in behavior
// POST /api/ai/buyer-persona-enricher
// Body: { customerName?: string }
// Returns: { ok, enricher: { buyers, personas, demographicProfile, behaviorPatterns, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const PERSONA_TYPES = ['bargain_hunter', 'quality_seeker', 'collector', 'reseller', 'first_time_buyer', 'business_buyer', 'gift_buyer', 'enthusiast', 'casual_browser', 'power_buyer'] as const;
const DEMOGRAPHIC_TIERS = ['gen_z', 'millennial', 'gen_x', 'boomer', 'unknown'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true }, take: 500, orderBy: { sellDate: 'desc' } });
    if (soldTrades.length === 0) return NextResponse.json({ ok: true, enricher: null, message: 'Ni prodaj za persona enrichment.' });

    const buyerMap = new Map<string, { name: string; purchases: number; totalSpent: number; avgOrder: number; firstPurchase: Date | null; lastPurchase: Date | null; categories: Set<string>; titles: string[]; daysSinceLast: number }>();
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2 || !t.sellDate) continue;
      const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, firstPurchase: t.sellDate, lastPurchase: t.sellDate, categories: new Set(), titles: [], daysSinceLast: 0 });
      const b = buyerMap.get(name)!;
      b.purchases += 1; b.totalSpent += rev;
      if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate;
      if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
      if (t.category) b.categories.add(t.category);
      if (b.titles.length < 5) b.titles.push(t.title);
    }
    const buyers = Array.from(buyerMap.values()).map(b => { b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0; b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / DAY) : 999; return b; });
    if (customerName) { const f = buyers.filter(b => b.name === customerName); if (f.length === 0) return NextResponse.json({ ok: true, enricher: null, message: `Kupec "${customerName}" ni najden.` }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d | kat: ${Array.from(b.categories).slice(0, 3).join(',')} | zadnje: ${b.titles.slice(0, 2).join('; ')}`).join('\n');

    const prompt = `Si AI buyer persona enricher z ML in demographic inference.
Obogati buyer personas z 10 tipi in 5 demographic tierji.

KUPCI (${targetBuyers.length}):
${buyersStr}

10 tipov personas:
1. BARGAIN_HUNTER: išče ugodne cene
2. QUALITY_SEEKER: išče kakovost
3. COLLECTOR: zbiratelj
4. RESELLER: preprodajalec
5. FIRST_TIME_BUYER: prvi nakup
6. BUSINESS_BUYER: poslovni kupec
7. GIFT_BUYER: nakup za darilo
8. ENTHUSIAST: navdušenec
9. CASUAL_BROWSER: naključni kupec
10. POWER_BUYER: velik kupec

5 demographic tierjev: gen_z, millennial, gen_x, boomer, unknown

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    { "name": "<string>", "persona_type": "<${PERSONA_TYPES.join('|')}>", "persona_confidence_pct": <number 0-100>, "demographic_tier": "<${DEMOGRAPHIC_TIERS.join('|')}>", "estimated_age_range": "<max 20 znakov>", "spending_power": "<low|medium|high|premium>", "purchase_motivation": "<max 100 znakov>", "preferred_categories": "<max 100 znakov>", "communication_preference": "<formal|friendly|casual|technical>", "persona_score": <number 0-100> }
  ],
  "personas": [
    { "persona_type": "<${PERSONA_TYPES.join('|')}>", "buyer_count": <number>, "buyer_pct": <number 0-100>, "avg_order_value_eur": <number>, "total_revenue_eur": <number>, "retention_rate_pct": <number 0-100>, "lifetime_value_eur": <number>, "primary_motivation": "<max 100 znakov>", "best_channel": "<max 50 znakov>" }
  ],
  "demographicProfile": [
    { "tier": "<${DEMOGRAPHIC_TIERS.join('|')}>", "buyer_count": <number>, "buyer_pct": <number 0-100>, "preferred_categories": "<max 100 znakov>", "avg_order_value_eur": <number>, "purchase_frequency": "<daily|weekly|monthly|quarterly|yearly>", "tech_savviness_pct": <number 0-100>, "price_sensitivity_pct": <number 0-100> }
  ],
  "behaviorPatterns": [
    { "pattern": "<max 100 znakov>", "frequency_pct": <number 0-100>, "avg_revenue_per_occurrence_eur": <number>, "affected_buyer_count": <number>, "trigger": "<max 100 znakov>", "opportunity": "<max 100 znakov>" }
  ],
  "mlModels": [
    { "model": "<bert|gpt|roberta|distilbert|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<persona_classification|demographic_inference|behavior_prediction|motivation_analysis>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "persona_enrichment_score": <number 0-100>, "persona_grade": "<A|B|C|D|F>", "total_buyers_analyzed": <number>,
    "primary_persona_type": "<${PERSONA_TYPES.join('|')}>", "avg_persona_confidence_pct": <number 0-100>,
    "biggest_persona_risk": "<max 100 znakov>", "biggest_persona_opportunity": "<max 100 znakov>",
    "quickest_persona_win": "<max 100 znakov>", "persona_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const enricher = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      buyers: (parsed?.buyers || []).slice(0, 25).map((b: any) => ({ name: String(b?.name ?? '').slice(0, 100), personaType: (PERSONA_TYPES as readonly string[]).includes(String(b?.persona_type)) ? String(b.persona_type) : 'casual_browser', personaConfidencePct: Math.max(0, Math.min(100, Number(b?.persona_confidence_pct ?? 60))), demographicTier: (DEMOGRAPHIC_TIERS as readonly string[]).includes(String(b?.demographic_tier)) ? String(b.demographic_tier) : 'unknown', estimatedAgeRange: String(b?.estimated_age_range ?? '').slice(0, 40), spendingPower: ['low', 'medium', 'high', 'premium'].includes(String(b?.spending_power)) ? String(b.spending_power) : 'medium', purchaseMotivation: String(b?.purchase_motivation ?? '').slice(0, 200), preferredCategories: String(b?.preferred_categories ?? '').slice(0, 200), communicationPreference: ['formal', 'friendly', 'casual', 'technical'].includes(String(b?.communication_preference)) ? String(b.communication_preference) : 'friendly', personaScore: Math.max(0, Math.min(100, Number(b?.persona_score ?? 50))) })),
      personas: (parsed?.personas || []).slice(0, 10).map((p: any) => ({ personaType: (PERSONA_TYPES as readonly string[]).includes(String(p?.persona_type)) ? String(p.persona_type) : 'casual_browser', buyerCount: Math.max(0, Number(p?.buyer_count ?? 0)), buyerPct: Math.max(0, Math.min(100, Number(p?.buyer_pct ?? 0))), avgOrderValueEur: Math.round(Number(p?.avg_order_value_eur ?? 0)), totalRevenueEur: Math.round(Number(p?.total_revenue_eur ?? 0)), retentionRatePct: Math.max(0, Math.min(100, Number(p?.retention_rate_pct ?? 50))), lifetimeValueEur: Math.round(Number(p?.lifetime_value_eur ?? 0)), primaryMotivation: String(p?.primary_motivation ?? '').slice(0, 200), bestChannel: String(p?.best_channel ?? '').slice(0, 100) })),
      demographicProfile: (parsed?.demographicProfile || []).slice(0, 5).map((d: any) => ({ tier: (DEMOGRAPHIC_TIERS as readonly string[]).includes(String(d?.tier)) ? String(d.tier) : 'unknown', buyerCount: Math.max(0, Number(d?.buyer_count ?? 0)), buyerPct: Math.max(0, Math.min(100, Number(d?.buyer_pct ?? 0))), preferredCategories: String(d?.preferred_categories ?? '').slice(0, 200), avgOrderValueEur: Math.round(Number(d?.avg_order_value_eur ?? 0)), purchaseFrequency: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].includes(String(d?.purchase_frequency)) ? String(d.purchase_frequency) : 'monthly', techSavvinessPct: Math.max(0, Math.min(100, Number(d?.tech_savviness_pct ?? 50))), priceSensitivityPct: Math.max(0, Math.min(100, Number(d?.price_sensitivity_pct ?? 50))) })),
      behaviorPatterns: (parsed?.behaviorPatterns || []).slice(0, 8).map((p: any) => ({ pattern: String(p?.pattern ?? '').slice(0, 200), frequencyPct: Math.max(0, Math.min(100, Number(p?.frequency_pct ?? 0))), avgRevenuePerOccurrenceEur: Math.round(Number(p?.avg_revenue_per_occurrence_eur ?? 0)), affectedBuyerCount: Math.max(0, Number(p?.affected_buyer_count ?? 0)), trigger: String(p?.trigger ?? '').slice(0, 200), opportunity: String(p?.opportunity ?? '').slice(0, 200) })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['bert', 'gpt', 'roberta', 'distilbert', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['persona_classification', 'demographic_inference', 'behavior_prediction', 'motivation_analysis'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'persona_classification', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { personaEnrichmentScore: Math.max(0, Math.min(100, Number(parsed?.summary?.persona_enrichment_score ?? 50))), personaGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.persona_grade)) ? String(parsed.summary.persona_grade) : 'C', totalBuyersAnalyzed: Math.max(0, Number(parsed?.summary?.total_buyers_analyzed ?? targetBuyers.length)), primaryPersonaType: (PERSONA_TYPES as readonly string[]).includes(String(parsed?.summary?.primary_persona_type)) ? String(parsed.summary.primary_persona_type) : 'casual_browser', avgPersonaConfidencePct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_persona_confidence_pct ?? 60))), biggestPersonaRisk: String(parsed?.summary?.biggest_persona_risk ?? '').slice(0, 200), biggestPersonaOpportunity: String(parsed?.summary?.biggest_persona_opportunity ?? '').slice(0, 200), quickestPersonaWin: String(parsed?.summary?.quickest_persona_win ?? '').slice(0, 200), personaAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.persona_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, enricher });
  } catch (e: any) { logger.error("/api/ai/buyer-persona-enricher", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
