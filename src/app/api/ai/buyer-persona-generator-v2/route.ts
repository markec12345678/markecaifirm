// v6.56: AI Buyer Persona Generator v2 — napredne osebe z ML clustering in behavioral modeling
// POST /api/ai/buyer-persona-generator-v2
// Body: { tradeId?: string, category?: string }
// Returns: { ok, generator: { personas, clusters, behavioralModels, messaging, channels, summary } }

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
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const category = body?.category ? String(body.category).toLowerCase() : null;

    // 1. Pridobi held trade (target item)
    let targetItem: any = null;
    if (tradeId) {
      const t = await db.trade.findUnique({
        where: { id: tradeId },
        select: { id: true, title: true, category: true, buyPrice: true,
          listing: { select: { aiEstimatedValue: true, description: true, detailDescription: true } } },
      });
      if (t) {
        targetItem = {
          id: t.id, title: t.title, category: t.category || 'drugo',
          price: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
          description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 400),
        };
      }
    }

    // 2. Pridobi sold trades za behavioral clustering
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 300,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0 && !targetItem) {
      return NextResponse.json({ ok: true, generator: null, message: 'Ni podatkov za persona generacijo.' });
    }

    // 3. Cluster analysis — find behavioral patterns
    const buyerMap = new Map<string, { purchases: number; totalSpent: number; categories: Set<string>; items: string[]; lastPurchase: Date | null }>();
    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2) continue;
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      if (!buyerMap.has(name)) buyerMap.set(name, { purchases: 0, totalSpent: 0, categories: new Set(), items: [], lastPurchase: null });
      const b = buyerMap.get(name)!;
      b.purchases += 1; b.totalSpent += revenue;
      if (t.category) b.categories.add(t.category);
      b.items.push(t.title);
      if (!b.lastPurchase || t.sellDate! > b.lastPurchase) b.lastPurchase = t.sellDate;
    }

    // Identify clusters
    const clusters: Array<{ name: string; count: number; avgSpent: number; avgPurchases: number; commonCategories: string[] }> = [];
    const allBuyers = Array.from(buyerMap.values());
    const highValue = allBuyers.filter(b => b.totalSpent > 500);
    const repeatBuyers = allBuyers.filter(b => b.purchases >= 3);
    const singleBuyers = allBuyers.filter(b => b.purchases === 1);
    if (highValue.length > 0) clusters.push({ name: 'high_value', count: highValue.length, avgSpent: Math.round(highValue.reduce((s, b) => s + b.totalSpent, 0) / highValue.length), avgPurchases: Math.round(highValue.reduce((s, b) => s + b.purchases, 0) / highValue.length), commonCategories: Array.from(new Set(highValue.flatMap(b => Array.from(b.categories)))).slice(0, 5) });
    if (repeatBuyers.length > 0) clusters.push({ name: 'repeat_loyal', count: repeatBuyers.length, avgSpent: Math.round(repeatBuyers.reduce((s, b) => s + b.totalSpent, 0) / repeatBuyers.length), avgPurchases: Math.round(repeatBuyers.reduce((s, b) => s + b.purchases, 0) / repeatBuyers.length), commonCategories: Array.from(new Set(repeatBuyers.flatMap(b => Array.from(b.categories)))).slice(0, 5) });
    if (singleBuyers.length > 0) clusters.push({ name: 'one_time_buyer', count: singleBuyers.length, avgSpent: Math.round(singleBuyers.reduce((s, b) => s + b.totalSpent, 0) / singleBuyers.length), avgPurchases: 1, commonCategories: Array.from(new Set(singleBuyers.flatMap(b => Array.from(b.categories)))).slice(0, 5) });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const targetStr = targetItem ? `CILJNI ITEM: "${targetItem.title}" | ${targetItem.category} | ${targetItem.price}€ | ${targetItem.description.slice(0, 200)}\n` : '';
    const clusterStr = clusters.map(c => `- ${c.name}: ${c.count} kupcev, povp ${c.avgSpent}€, povp ${c.avgPurchases}x, kategorije: ${c.commonCategories.join(',')}`).join('\n');

    const prompt = `Si AI buyer persona generator v2 z ML clustering in behavioral modeling.
Generiraj napredne buyer persone z messaging strategijami.

${targetStr}
CLUSTERS (iz zgodovine):
${clusterStr}
${category ? `FOKUS KATEGORIJA: ${category}` : ''}

Persona generacijska pravila:
- 5-7 person per item (različni kupci z različnimi motivacijami)
- Vsaka persona ima: demographics, psychographics, behavioral, motivational, messaging
- Behavioral: kako se obnaša pri nakupu (impulse, deliberate, comparison)
- Psychographics: vrednote, lifestyle, aspirations
- Motivational: zakaj kupi (need, want, status, emotional, practical)

Persona tipi:
1. BARGAIN_HUNTER: išče deal, comparison shopper, čaka na popust
2. COLLECTOR: redki itemi, vintage, ekspert znanje
3. PARENT_FAMILY: za družino, varnost, dolgoročno
4. STUDENT_YOUNG: omejen budget, trendy, social
5. PROFESSIONAL: premium, efficiency, status
6. HOBBYIST: pasija, specializiran, doplača za kvaliteto
7. GIFT_GIVER: darilo, emotional, hitrost pomembna
8. RESLLER: poslovni nakup, margin fokus, bulk
9. TECH_ENTHUSIAST: specifikacije, najnovejše, comparison
10. SEASONAL_BUYER: kupuje ob določenem času (božič, šola)

Behavioral triggers:
- URGENCY: časovna omejitev, scarcity
- VALUE: popust, bundle, savings
- QUALITY: specifikacije, garancija, reviews
- EMOTION: darilo, spomin, nostalgia
- STATUS: prestiž, ekskluzivnost, brand
- CONVENIENCE: hitrost, dostava, easy checkout

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "personas": [
    {
      "persona_name": "<max 60 znakov>",
      "persona_type": "<bargain_hunter|collector|parent_family|student_young|professional|hobbyist|gift_giver|reseller|tech_enthusiast|seasonal_buyer>",
      "demographics": {
        "age_range": "<max 20 znakov>",
        "gender": "<male|female|any>",
        "location": "<max 50 znakov>",
        "income_range_eur": "<max 30 znakov>",
        "occupation": "<max 50 znakov>",
        "education": "<max 50 znakov>"
      },
      "psychographics": {
        "values": ["<max 60 znakov>"],
        "lifestyle": "<max 100 znakov>",
        "aspirations": ["<max 80 znakov>"],
        "interests": ["<max 60 znakov>"]
      },
      "behavioral": {
        "purchase_pattern": "<impulse|deliberate|comparison|research>",
        "decision_time_days": <number>,
        "price_sensitivity": "<low|medium|high>",
        "brand_loyalty": "<low|medium|high>",
        "research_depth": "<low|medium|high>",
        "negotiation_tendency": "<aggressive|moderate|passive>"
      },
      "motivational": {
        "primary_trigger": "<urgency|value|quality|emotion|status|convenience>",
        "buying_reason": "<max 100 znakov>",
        "objection": "<max 100 znakov>",
        "deal_breaker": "<max 100 znakov>"
      },
      "messaging": {
        "tone": "<professional|friendly|urgent|emotional|technical|playful>",
        "key_phrases": ["<max 80 znakov>"],
        "avoid_phrases": ["<max 80 znakov>"],
        "hook": "<max 150 znakov>",
        "ctas": ["<max 80 znakov>"]
      },
      "channels": {
        "primary": "<bolha|facebook|vinted|email|sms|social|in_person>",
        "secondary": ["<channel>"],
        "best_time": "<max 80 znakov>"
      },
      "willingness_to_pay_eur": <number>,
      "conversion_probability_pct": <number 0-100>,
      "cluster_match": "<high_value|repeat_loyal|one_time_buyer|new>",
      "expected_value_eur": <number>
    }
  ],
  "clusters": [
    {
      "cluster_name": "<max 60 znakov>",
      "buyer_count": <number>,
      "avg_spent_eur": <number>,
      "common_categories": ["<max 50 znakov>"],
      "behavioral_pattern": "<max 100 znakov>",
      "best_persona_match": "<persona_type>",
      "targeting_strategy": "<max 120 znakov>"
    }
  ],
  "behavioral_models": [
    {
      "model_name": "<max 60 znakov>",
      "description": "<max 120 znakov>",
      "input_features": ["<max 60 znakov>"],
      "output_prediction": "<max 100 znakov>",
      "accuracy_pct": <number 0-100>,
      "use_case": "<max 100 znakov>"
    }
  ],
  "messaging": [
    {
      "persona_type": "<10 tipov>",
      "message_template": "<max 250 znakov>",
      "subject_line": "<max 100 znakov>",
      "key_benefit": "<max 100 znakov>",
      "emotional_appeal": "<max 100 znakov>",
      "urgency_level": "<low|medium|high>"
    }
  ],
  "channels": [
    {
      "channel": "<bolha|facebook|vinted|email|sms|social|in_person>",
      "persona_count": <number>,
      "avg_conversion_pct": <number>,
      "best_persona_types": ["<persona_type>"],
      "cost_per_reach_eur": <number>,
      "expected_roi_pct": <number>
    }
  ],
  "summary": {
    "total_personas_generated": <number>,
    "avg_conversion_probability_pct": <number>,
    "best_persona_overall": "<max 80 znakov>",
    "best_channel_overall": "<max 80 znakov>",
    "biggest_opportunity_persona": "<max 100 znakov>",
    "total_expected_revenue_eur": <number>,
    "persona_generation_score": <number 0-100>
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

    const generator = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      personas: (parsed?.personas || []).slice(0, 7).map((p: any) => ({
        personaName: String(p?.persona_name ?? '').slice(0, 100),
        personaType: ['bargain_hunter', 'collector', 'parent_family', 'student_young', 'professional', 'hobbyist', 'gift_giver', 'reseller', 'tech_enthusiast', 'seasonal_buyer'].includes(String(p?.persona_type)) ? String(p.persona_type) : 'bargain_hunter',
        demographics: {
          ageRange: String(p?.demographics?.age_range ?? '').slice(0, 30),
          gender: ['male', 'female', 'any'].includes(String(p?.demographics?.gender)) ? String(p.demographics.gender) : 'any',
          location: String(p?.demographics?.location ?? '').slice(0, 80),
          incomeRangeEur: String(p?.demographics?.income_range_eur ?? '').slice(0, 50),
          occupation: String(p?.demographics?.occupation ?? '').slice(0, 80),
          education: String(p?.demographics?.education ?? '').slice(0, 80),
        },
        psychographics: {
          values: (p?.psychographics?.values || []).slice(0, 5).map((v: any) => String(v).slice(0, 100)),
          lifestyle: String(p?.psychographics?.lifestyle ?? '').slice(0, 200),
          aspirations: (p?.psychographics?.aspirations || []).slice(0, 5).map((a: any) => String(a).slice(0, 150)),
          interests: (p?.psychographics?.interests || []).slice(0, 5).map((i: any) => String(i).slice(0, 100)),
        },
        behavioral: {
          purchasePattern: ['impulse', 'deliberate', 'comparison', 'research'].includes(String(p?.behavioral?.purchase_pattern)) ? String(p.behavioral.purchase_pattern) : 'deliberate',
          decisionTimeDays: Math.max(0, Number(p?.behavioral?.decision_time_days ?? 7)),
          priceSensitivity: ['low', 'medium', 'high'].includes(String(p?.behavioral?.price_sensitivity)) ? String(p.behavioral.price_sensitivity) : 'medium',
          brandLoyalty: ['low', 'medium', 'high'].includes(String(p?.behavioral?.brand_loyalty)) ? String(p.behavioral.brand_loyalty) : 'medium',
          researchDepth: ['low', 'medium', 'high'].includes(String(p?.behavioral?.research_depth)) ? String(p.behavioral.research_depth) : 'medium',
          negotiationTendency: ['aggressive', 'moderate', 'passive'].includes(String(p?.behavioral?.negotiation_tendency)) ? String(p.behavioral.negotiation_tendency) : 'moderate',
        },
        motivational: {
          primaryTrigger: ['urgency', 'value', 'quality', 'emotion', 'status', 'convenience'].includes(String(p?.motivational?.primary_trigger)) ? String(p.motivational.primary_trigger) : 'value',
          buyingReason: String(p?.motivational?.buying_reason ?? '').slice(0, 200),
          objection: String(p?.motivational?.objection ?? '').slice(0, 200),
          dealBreaker: String(p?.motivational?.deal_breaker ?? '').slice(0, 200),
        },
        messaging: {
          tone: ['professional', 'friendly', 'urgent', 'emotional', 'technical', 'playful'].includes(String(p?.messaging?.tone)) ? String(p.messaging.tone) : 'professional',
          keyPhrases: (p?.messaging?.key_phrases || []).slice(0, 5).map((k: any) => String(k).slice(0, 150)),
          avoidPhrases: (p?.messaging?.avoid_phrases || []).slice(0, 5).map((a: any) => String(a).slice(0, 150)),
          hook: String(p?.messaging?.hook ?? '').slice(0, 300),
          ctas: (p?.messaging?.ctas || []).slice(0, 4).map((c: any) => String(c).slice(0, 150)),
        },
        channels: {
          primary: ['bolha', 'facebook', 'vinted', 'email', 'sms', 'social', 'in_person'].includes(String(p?.channels?.primary)) ? String(p.channels.primary) : 'email',
          secondary: (p?.channels?.secondary || []).slice(0, 3).map((s: any) => String(s).slice(0, 30)),
          bestTime: String(p?.channels?.best_time ?? '').slice(0, 150),
        },
        willingnessToPayEur: Math.max(0, Math.round(Number(p?.willingness_to_pay_eur ?? 0))),
        conversionProbabilityPct: Math.max(0, Math.min(100, Number(p?.conversion_probability_pct ?? 30))),
        clusterMatch: ['high_value', 'repeat_loyal', 'one_time_buyer', 'new'].includes(String(p?.cluster_match)) ? String(p.cluster_match) : 'new',
        expectedValueEur: Math.round(Number(p?.expected_value_eur ?? 0)),
      })),
      clusters: (parsed?.clusters || []).slice(0, 5).map((c: any) => ({
        clusterName: String(c?.cluster_name ?? '').slice(0, 100),
        buyerCount: Math.max(0, Number(c?.buyer_count ?? 0)),
        avgSpentEur: Math.round(Number(c?.avg_spent_eur ?? 0)),
        commonCategories: (c?.common_categories || []).slice(0, 6).map((cat: any) => String(cat).slice(0, 80)),
        behavioralPattern: String(c?.behavioral_pattern ?? '').slice(0, 200),
        bestPersonaMatch: String(c?.best_persona_match ?? '').slice(0, 80),
        targetingStrategy: String(c?.targeting_strategy ?? '').slice(0, 250),
      })),
      behavioralModels: (parsed?.behavioral_models || []).slice(0, 5).map((m: any) => ({
        modelName: String(m?.model_name ?? '').slice(0, 100),
        description: String(m?.description ?? '').slice(0, 250),
        inputFeatures: (m?.input_features || []).slice(0, 6).map((f: any) => String(f).slice(0, 100)),
        outputPrediction: String(m?.output_prediction ?? '').slice(0, 200),
        accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))),
        useCase: String(m?.use_case ?? '').slice(0, 200),
      })),
      messaging: (parsed?.messaging || []).slice(0, 8).map((m: any) => ({
        personaType: ['bargain_hunter', 'collector', 'parent_family', 'student_young', 'professional', 'hobbyist', 'gift_giver', 'reseller', 'tech_enthusiast', 'seasonal_buyer'].includes(String(m?.persona_type)) ? String(m.persona_type) : 'bargain_hunter',
        messageTemplate: String(m?.message_template ?? '').slice(0, 500),
        subjectLine: String(m?.subject_line ?? '').slice(0, 200),
        keyBenefit: String(m?.key_benefit ?? '').slice(0, 200),
        emotionalAppeal: String(m?.emotional_appeal ?? '').slice(0, 200),
        urgencyLevel: ['low', 'medium', 'high'].includes(String(m?.urgency_level)) ? String(m.urgency_level) : 'medium',
      })),
      channels: (parsed?.channels || []).slice(0, 7).map((c: any) => ({
        channel: ['bolha', 'facebook', 'vinted', 'email', 'sms', 'social', 'in_person'].includes(String(c?.channel)) ? String(c.channel) : 'email',
        personaCount: Math.max(0, Number(c?.persona_count ?? 0)),
        avgConversionPct: Math.max(0, Math.min(100, Number(c?.avg_conversion_pct ?? 30))),
        bestPersonaTypes: (c?.best_persona_types || []).slice(0, 4).map((p: any) => String(p).slice(0, 50)),
        costPerReachEur: Math.round(Number(c?.cost_per_reach_eur ?? 0) * 100) / 100,
        expectedRoiPct: Math.round(Number(c?.expected_roi_pct ?? 0)),
      })),
      summary: {
        totalPersonasGenerated: Math.max(0, Number(parsed?.summary?.total_personas_generated ?? (parsed?.personas || []).length)),
        avgConversionProbabilityPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_conversion_probability_pct ?? 30))),
        bestPersonaOverall: String(parsed?.summary?.best_persona_overall ?? '').slice(0, 150),
        bestChannelOverall: ['bolha', 'facebook', 'vinted', 'email', 'sms', 'social', 'in_person'].includes(String(parsed?.summary?.best_channel_overall)) ? String(parsed.summary.best_channel_overall) : 'email',
        biggestOpportunityPersona: String(parsed?.summary?.biggest_opportunity_persona ?? '').slice(0, 200),
        totalExpectedRevenueEur: Math.round(Number(parsed?.summary?.total_expected_revenue_eur ?? 0)),
        personaGenerationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.persona_generation_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, generator });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
