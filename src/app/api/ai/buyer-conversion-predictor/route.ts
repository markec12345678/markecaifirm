// v6.54: AI Buyer Conversion Predictor — napove konverzijo povpraševanja v nakup
// POST /api/ai/buyer-conversion-predictor
// Body: { customerName?: string, tradeId?: string }
// Returns: { ok, predictor: { buyers, conversionFactors, funnels, predictions, interventions, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;
    const tradeId = body?.tradeId ? String(body.tradeId) : null;

    // 1. Pridobi sold trades
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return NextResponse.json({ ok: true, predictor: null, message: 'Ni prodaj za conversion analizo.' });
    }

    // 2. Held trade context (če je podan)
    let targetTradeTitle = '';
    let targetTradeCategory = '';
    let targetTradePrice = 0;
    if (tradeId) {
      const t = await db.trade.findUnique({
        where: { id: tradeId },
        select: { title: true, category: true, buyPrice: true, listing: { select: { aiEstimatedValue: true } } },
      });
      if (t) {
        targetTradeTitle = t.title;
        targetTradeCategory = t.category || '';
        targetTradePrice = t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25);
      }
    }

    // 3. Buyer aggregation
    const buyerMap = new Map<string, {
      name: string;
      inquiries: number; // approximated by purchases
      purchases: number;
      conversionRate: number; // 0-100 (hevristika: več nakupov = višja)
      totalSpent: number;
      avgOrderValue: number;
      categories: Set<string>;
      daysSinceLastPurchase: number;
      lastPurchase: Date | null;
      stage: 'inquiry' | 'consideration' | 'negotiation' | 'decision' | 'won';
    }>();

    const now = Date.now();
    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2 || !t.sellDate) continue;
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);

      if (!buyerMap.has(name)) {
        buyerMap.set(name, {
          name, inquiries: 1, purchases: 0, conversionRate: 50,
          totalSpent: 0, avgOrderValue: 0, categories: new Set<string>(),
          daysSinceLastPurchase: 0, lastPurchase: t.sellDate,
          stage: 'won',
        });
      }
      const b = buyerMap.get(name)!;
      b.purchases += 1;
      b.totalSpent += revenue;
      if (t.category) b.categories.add(t.category);
      if (t.sellDate > (b.lastPurchase as Date)) b.lastPurchase = t.sellDate;
    }

    const buyers = Array.from(buyerMap.values()).map(b => {
      b.avgOrderValue = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0;
      if (b.lastPurchase) {
        b.daysSinceLastPurchase = Math.round((now - b.lastPurchase.getTime()) / (24*60*60*1000));
      }
      // Hevristika: conversion rate ~ purchase frequency
      b.conversionRate = Math.min(95, 30 + b.purchases * 8);
      // Stage
      if (b.daysSinceLastPurchase < 7) b.stage = 'won';
      else if (b.daysSinceLastPurchase < 30) b.stage = 'decision';
      else if (b.daysSinceLastPurchase < 60) b.stage = 'negotiation';
      else if (b.daysSinceLastPurchase < 90) b.stage = 'consideration';
      else b.stage = 'inquiry';
      return b;
    });

    if (customerName) {
      const filtered = buyers.filter(b => b.name === customerName);
      if (filtered.length === 0) {
        return NextResponse.json({ ok: true, predictor: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const targetBuyers = customerName
      ? buyers.filter(b => b.name === customerName)
      : buyers.slice(0, 25);

    const buyersStr = targetBuyers.map(b =>
      `- ${b.name} | ${b.purchases}x nakup | ${b.totalSpent}€ | ${b.avgOrderValue}€ povp | ${b.daysSinceLastPurchase}d zadnji | conversion ${b.conversionRate}% | stage: ${b.stage} | kategorije: ${Array.from(b.categories).slice(0, 2).join(',')}`
    ).join('\n');

    const prompt = `Si AI buyer conversion predictor za slovenske oglasne platforme.
Napove verjetnost konverzije povpraševanja v dejanski nakup za vsakega kupca.

${targetTradeTitle ? `CILJNI ITEM: "${targetTradeTitle}" | ${targetTradeCategory} | ${targetTradePrice}€\n` : ''}KUPCI ZA ANALIZO (${targetBuyers.length}):
${buyersStr}

Conversion funnel faze:
1. AWARENESS: kupec vidi oglas (10% konverzija v naslednjo fazo)
2. INTEREST: kupec klikne in si ogleda oglas (30% v inquiry)
3. INQUIRY: kupec pošlje sporočilo (40% v consideration)
4. CONSIDERATION: kupec razmišlja, primerja (50% v negotiation)
5. NEGOTIATION: kupec se pogaja o ceni (60% v decision)
6. DECISION: kupec se odloča (75% v purchase)
7. PURCHASE: kupec plača (100% konverzija)

Conversion faktorji (0-100 vsak):
1. PRICE_MATCH: ali cena ustreza buyerjevem budgetu
2. ITEM_RELEVANCE: ali item ustreza buyerjevim potrebam
3. SELLER_TRUST: zaupanje v prodajalca (naš score)
4. URGENCY: ali kupec nujno rabi item
5. SOCIAL_PROOF: ali drugi kupujejo (FOMO)
6. COMPETITION: ali so drugi zainteresirani
7. LISTING_QUALITY: kakovost oglasa (slike, opis)
8. NEGOTIATION_FLEXIBILITY: ali je prostor za pogajanje
9. LOCATION_CONVENIENCE: ali je pickup blizu
10. PAYMENT_OPTIONS: ali so plačilne metode ustrezne

Intervention taktike za povečanje conversion:
1. PERSONAL_OUTREACH: osebno sporočilo
2. LIMITED_TIME_OFFER: časovno omejena ponudba
3. BUNDLE_DEAL: paket z dodatkom
4. PRICE_DROP: znižanje cene
5. SOCIAL_PROOF_BOOST: poudari popularnost
6. URGENCY_INJECTION: dodaj nujnost (samo še danes)
7. TRUST_BUILDING: poudari garancijo, reviews
8. NEGOTIATION_INVITE: povabi k pogajanju
9. FREE_SHIPPING: ponudi brezplačno dostavo
10. EXTENDED_WARRANTY: podaljšana garancija

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    {
      "name": "<ime>",
      "current_stage": "<awareness|interest|inquiry|consideration|negotiation|decision|purchase>",
      "conversion_probability_pct": <number 0-100>,
      "predicted_purchase_date": "<YYYY-MM-DD ali null>",
      "predicted_purchase_amount_eur": <number>,
      "conversion_factors": {
        "price_match": <number 0-100>,
        "item_relevance": <number 0-100>,
        "seller_trust": <number 0-100>,
        "urgency": <number 0-100>,
        "social_proof": <number 0-100>,
        "competition": <number 0-100>,
        "listing_quality": <number 0-100>,
        "negotiation_flexibility": <number 0-100>,
        "location_convenience": <number 0-100>,
        "payment_options": <number 0-100>
      },
      "biggest_conversion_blocker": "<max 80 znakov>",
      "biggest_conversion_accelerator": "<max 80 znakov>",
      "recommended_intervention": "<personal_outreach|limited_time_offer|bundle_deal|price_drop|social_proof_boost|urgency_injection|trust_building|negotiation_invite|free_shipping|extended_warranty>",
      "expected_conversion_uplift_pct": <number>,
      "priority": "<high|medium|low>"
    }
  ],
  "conversion_factors": [
    { "factor": "<price_match|item_relevance|seller_trust|urgency|social_proof|competition|listing_quality|negotiation_flexibility|location_convenience|payment_options>", "weight": <number 0-100>, "avg_score": <number 0-100>, "benchmark": <number 0-100>, "improvement_potential": "<high|medium|low>", "improvement_action": "<max 120 znakov>" }
  ],
  "funnels": [
    {
      "stage": "<awareness|interest|inquiry|consideration|negotiation|decision|purchase>",
      "buyer_count": <number>,
      "conversion_rate_to_next_pct": <number>,
      "avg_time_in_stage_days": <number>,
      "drop_off_pct": <number>,
      "biggest_drop_reason": "<max 100 znakov>"
    }
  ],
  "predictions": [
    { "timeframe_days": <number>, "expected_inquiries": <number>, "expected_conversions": <number>, "expected_revenue_eur": <number>, "confidence_pct": <number 0-100> }
  ],
  "interventions": [
    { "intervention": "<personal_outreach|limited_time_offer|bundle_deal|price_drop|social_proof_boost|urgency_injection|trust_building|negotiation_invite|free_shipping|extended_warranty>", "description": "<max 120 znakov>", "best_for_stage": "<stage>", "expected_conversion_lift_pct": <number>, "implementation_cost_eur": <number>, "expected_revenue_impact_eur": <number>, "roi_score": <number 0-100> }
  ],
  "summary": {
    "total_buyers_analyzed": <number>,
    "avg_conversion_probability_pct": <number>,
    "total_expected_conversions_30d": <number>,
    "total_expected_revenue_30d_eur": <number>,
    "biggest_conversion_blocker": "<max 100 znakov>",
    "best_intervention": "<max 100 znakov>",
    "funnel_efficiency_score": <number 0-100>,
    "conversion_prediction_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const validNames = new Set(targetBuyers.map(b => b.name));

    const predictor = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      buyers: (parsed?.buyers || [])
        .filter((b: any) => validNames.has(String(b?.name ?? '')))
        .slice(0, 25)
        .map((b: any) => ({
          name: String(b?.name ?? '').slice(0, 100),
          currentStage: ['awareness', 'interest', 'inquiry', 'consideration', 'negotiation', 'decision', 'purchase'].includes(String(b?.current_stage)) ? String(b.current_stage) : 'consideration',
          conversionProbabilityPct: Math.max(0, Math.min(100, Number(b?.conversion_probability_pct ?? 30))),
          predictedPurchaseDate: String(b?.predicted_purchase_date ?? '').slice(0, 20),
          predictedPurchaseAmountEur: Math.round(Number(b?.predicted_purchase_amount_eur ?? 0)),
          conversionFactors: {
            priceMatch: Math.max(0, Math.min(100, Number(b?.conversion_factors?.price_match ?? 50))),
            itemRelevance: Math.max(0, Math.min(100, Number(b?.conversion_factors?.item_relevance ?? 50))),
            sellerTrust: Math.max(0, Math.min(100, Number(b?.conversion_factors?.seller_trust ?? 50))),
            urgency: Math.max(0, Math.min(100, Number(b?.conversion_factors?.urgency ?? 30))),
            socialProof: Math.max(0, Math.min(100, Number(b?.conversion_factors?.social_proof ?? 40))),
            competition: Math.max(0, Math.min(100, Number(b?.conversion_factors?.competition ?? 30))),
            listingQuality: Math.max(0, Math.min(100, Number(b?.conversion_factors?.listing_quality ?? 60))),
            negotiationFlexibility: Math.max(0, Math.min(100, Number(b?.conversion_factors?.negotiation_flexibility ?? 50))),
            locationConvenience: Math.max(0, Math.min(100, Number(b?.conversion_factors?.location_convenience ?? 60))),
            paymentOptions: Math.max(0, Math.min(100, Number(b?.conversion_factors?.payment_options ?? 70))),
          },
          biggestConversionBlocker: String(b?.biggest_conversion_blocker ?? '').slice(0, 150),
          biggestConversionAccelerator: String(b?.biggest_conversion_accelerator ?? '').slice(0, 150),
          recommendedIntervention: ['personal_outreach', 'limited_time_offer', 'bundle_deal', 'price_drop', 'social_proof_boost', 'urgency_injection', 'trust_building', 'negotiation_invite', 'free_shipping', 'extended_warranty'].includes(String(b?.recommended_intervention)) ? String(b.recommended_intervention) : 'personal_outreach',
          expectedConversionUpliftPct: Math.round(Number(b?.expected_conversion_uplift_pct ?? 0)),
          priority: ['high', 'medium', 'low'].includes(String(b?.priority)) ? String(b.priority) : 'medium',
        })),
      conversionFactors: (parsed?.conversion_factors || []).slice(0, 10).map((f: any) => ({
        factor: ['price_match', 'item_relevance', 'seller_trust', 'urgency', 'social_proof', 'competition', 'listing_quality', 'negotiation_flexibility', 'location_convenience', 'payment_options'].includes(String(f?.factor)) ? String(f.factor) : 'price_match',
        weight: Math.max(0, Math.min(100, Number(f?.weight ?? 50))),
        avgScore: Math.max(0, Math.min(100, Number(f?.avg_score ?? 50))),
        benchmark: Math.max(0, Math.min(100, Number(f?.benchmark ?? 50))),
        improvementPotential: ['high', 'medium', 'low'].includes(String(f?.improvement_potential)) ? String(f.improvement_potential) : 'medium',
        improvementAction: String(f?.improvement_action ?? '').slice(0, 250),
      })),
      funnels: (parsed?.funnels || []).slice(0, 7).map((fn: any) => ({
        stage: ['awareness', 'interest', 'inquiry', 'consideration', 'negotiation', 'decision', 'purchase'].includes(String(fn?.stage)) ? String(fn.stage) : 'inquiry',
        buyerCount: Math.max(0, Number(fn?.buyer_count ?? 0)),
        conversionRateToNextPct: Math.max(0, Math.min(100, Number(fn?.conversion_rate_to_next_pct ?? 30))),
        avgTimeInStageDays: Math.max(0, Number(fn?.avg_time_in_stage_days ?? 0)),
        dropOffPct: Math.max(0, Math.min(100, Number(fn?.drop_off_pct ?? 30))),
        biggestDropReason: String(fn?.biggest_drop_reason ?? '').slice(0, 200),
      })),
      predictions: (parsed?.predictions || []).slice(0, 4).map((p: any) => ({
        timeframeDays: Math.max(7, Number(p?.timeframe_days ?? 30)),
        expectedInquiries: Math.max(0, Math.round(Number(p?.expected_inquiries ?? 0))),
        expectedConversions: Math.max(0, Math.round(Number(p?.expected_conversions ?? 0))),
        expectedRevenueEur: Math.round(Number(p?.expected_revenue_eur ?? 0)),
        confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 50))),
      })),
      interventions: (parsed?.interventions || []).slice(0, 10).map((i: any) => ({
        intervention: ['personal_outreach', 'limited_time_offer', 'bundle_deal', 'price_drop', 'social_proof_boost', 'urgency_injection', 'trust_building', 'negotiation_invite', 'free_shipping', 'extended_warranty'].includes(String(i?.intervention)) ? String(i.intervention) : 'personal_outreach',
        description: String(i?.description ?? '').slice(0, 250),
        bestForStage: ['awareness', 'interest', 'inquiry', 'consideration', 'negotiation', 'decision', 'purchase'].includes(String(i?.best_for_stage)) ? String(i.best_for_stage) : 'consideration',
        expectedConversionLiftPct: Math.round(Number(i?.expected_conversion_lift_pct ?? 0)),
        implementationCostEur: Math.round(Number(i?.implementation_cost_eur ?? 0)),
        expectedRevenueImpactEur: Math.round(Number(i?.expected_revenue_impact_eur ?? 0)),
        roiScore: Math.max(0, Math.min(100, Number(i?.roi_score ?? 50))),
      })),
      summary: {
        totalBuyersAnalyzed: targetBuyers.length,
        avgConversionProbabilityPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_conversion_probability_pct ?? 30))),
        totalExpectedConversions30d: Math.max(0, Math.round(Number(parsed?.summary?.total_expected_conversions_30d ?? 0))),
        totalExpectedRevenue30dEur: Math.round(Number(parsed?.summary?.total_expected_revenue_30d_eur ?? 0)),
        biggestConversionBlocker: String(parsed?.summary?.biggest_conversion_blocker ?? '').slice(0, 200),
        bestIntervention: ['personal_outreach', 'limited_time_offer', 'bundle_deal', 'price_drop', 'social_proof_boost', 'urgency_injection', 'trust_building', 'negotiation_invite', 'free_shipping', 'extended_warranty'].includes(String(parsed?.summary?.best_intervention)) ? String(parsed.summary.best_intervention) : 'personal_outreach',
        funnelEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.funnel_efficiency_score ?? 50))),
        conversionPredictionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.conversion_prediction_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, predictor });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
