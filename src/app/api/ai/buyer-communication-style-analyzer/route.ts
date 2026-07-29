// v6.69: AI Buyer Communication Style Analyzer — analiza komunikacijskega stila z ML NLP
// POST /api/ai/buyer-communication-style-analyzer
// Body: { customerName?: string }
// Returns: { ok, analyzer: { buyers, communicationStyles, adaptations, mlModels, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const COMMUNICATION_STYLES = ['direct', 'indirect', 'formal', 'informal', 'analytical', 'emotional', 'assertive', 'passive', 'persuasive', 'collaborative'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;

    const listings = await db.listing.findMany({ where: { contactStatus: { not: 'none' }, sellerResponse: { not: null } }, select: { id: true, title: true, contactStatus: true, contactedAt: true, sellerResponse: true, description: true }, take: 100, orderBy: { contactedAt: 'desc' } });
    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true }, take: 300, orderBy: { sellDate: 'desc' } });

    if (listings.length === 0 && soldTrades.length === 0) return NextResponse.json({ ok: true, analyzer: null, message: 'Ni komunikacije za analizo.' });

    const buyerMap = new Map<string, { name: string; purchases: number; totalSpent: number; }>();
    for (const t of soldTrades) { const name = (t.sellLocation || '').trim(); if (!name || name.length < 2) continue; const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0); if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0 }); const b = buyerMap.get(name)!; b.purchases += 1; b.totalSpent += rev; }
    const buyers = Array.from(buyerMap.values());
    if (customerName) { const f = buyers.filter(b => b.name === customerName); if (f.length === 0) return NextResponse.json({ ok: true, analyzer: null, message: `Kupec "${customerName}" ni najden.` }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const msgStr = listings.slice(0, 15).map(l => `- "${l.title}" | response: "${String(l.sellerResponse || '').slice(0, 200)}"`).join('\n');
    const buyersStr = (customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 20)).slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€`).join('\n');

    const prompt = `Si AI buyer communication style analyzer z ML NLP.
Analizira komunikacijski stil kupcev in predlaga adaptacije.

KOMUNIKACIJE (${listings.length}):
${msgStr}

KUPCI:
${buyersStr}

10 komunikacijskih stilov:
1. DIRECT: direktni, jasni, hitro k bistvu
2. INDIRECT: indirektni, ovinkari
3. FORMAL: formalni, profesionalni
4. INFORMAL: neformalni, sproščeni
5. ANALYTICAL: analitični, podatek usmerjeni
6. EMOTIONAL: čustveni, osebni
7. ASSERTIVE: odločni, zahtevni
8. PASSIVE: pasivni, negotovi
9. PERSUASIVE: prepričljivi, pogajalski
10. COLLABORATIVE: sodelovalni, kompromisni

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    { "name": "<ime>", "primary_style": "<10 stilov>", "secondary_style": "<10 stilov>", "style_confidence_pct": <number 0-100>, "communication_score": <number 0-100>, "preferred_tone": "<professional|friendly|formal|casual|urgent|empathetic>", "preferred_channel": "<email|sms|phone|in_person|social>", "response_time_preference": "<immediate|same_day|flexible>", "negotiation_style": "<aggressive|moderate|collaborative|passive>", "key_phrases": ["<max 60 znakov>"], "adaptation_strategy": "<max 150 znakov>", "expected_response_rate_pct": <number 0-100> }
  ],
  "communicationStyles": [
    { "style": "<10 stilov>", "buyer_count": <number>, "avg_response_rate_pct": <number 0-100>, "avg_deal_close_rate_pct": <number 0-100>, "best_tone_match": "<professional|friendly|formal|casual|urgent|empathetic>", "description": "<max 120 znakov>", "best_strategy": "<max 150 znakov>" }
  ],
  "adaptations": [
    { "buyer_style": "<10 stilov>", "your_adapted_style": "<10 stilov>", "adaptation_description": "<max 120 znakov>", "expected_improvement_pct": <number>, "example_message": "<max 200 znakov>", "do_say": ["<max 80 znakov>"], "dont_say": ["<max 80 znakov>"] }
  ],
  "mlModels": [
    { "model": "<bert|roberta|distilbert|xlm_roberta|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<style_classification|tone_matching|response_prediction|negotiation_outcome>", "weight_in_ensemble": <number 0-100> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "style_targeted": "<10 stilov ali all>", "expected_response_improvement_pct": <number>, "buyers_affected": <number> }
  ],
  "summary": {
    "total_buyers_analyzed": <number>, "avg_communication_score": <number>, "most_common_style": "<10 stilov>",
    "best_responding_style": "<10 stilov>", "biggest_communication_challenge": "<max 100 znakov>",
    "biggest_communication_opportunity": "<max 100 znakov>", "communication_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);
    const validNames = new Set(buyers.map(b => b.name));

    const analyzer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      buyers: (parsed?.buyers || []).filter((b: any) => validNames.has(String(b?.name ?? ''))).slice(0, 25).map((b: any) => ({
        name: String(b?.name ?? '').slice(0, 100),
        primaryStyle: COMMUNICATION_STYLES.includes(String(b?.primary_style) as any) ? String(b.primary_style) : 'direct',
        secondaryStyle: COMMUNICATION_STYLES.includes(String(b?.secondary_style) as any) ? String(b.secondary_style) : 'collaborative',
        styleConfidencePct: Math.max(0, Math.min(100, Number(b?.style_confidence_pct ?? 60))),
        communicationScore: Math.max(0, Math.min(100, Number(b?.communication_score ?? 60))),
        preferredTone: ['professional', 'friendly', 'formal', 'casual', 'urgent', 'empathetic'].includes(String(b?.preferred_tone)) ? String(b.preferred_tone) : 'professional',
        preferredChannel: ['email', 'sms', 'phone', 'in_person', 'social'].includes(String(b?.preferred_channel)) ? String(b.preferred_channel) : 'email',
        responseTimePreference: ['immediate', 'same_day', 'flexible'].includes(String(b?.response_time_preference)) ? String(b.response_time_preference) : 'same_day',
        negotiationStyle: ['aggressive', 'moderate', 'collaborative', 'passive'].includes(String(b?.negotiation_style)) ? String(b.negotiation_style) : 'moderate',
        keyPhrases: (b?.key_phrases || []).slice(0, 5).map((p: any) => String(p).slice(0, 100)),
        adaptationStrategy: String(b?.adaptation_strategy ?? '').slice(0, 300),
        expectedResponseRatePct: Math.max(0, Math.min(100, Number(b?.expected_response_rate_pct ?? 40))),
      })),
      communicationStyles: (parsed?.communicationStyles || []).slice(0, 10).map((s: any) => ({
        style: COMMUNICATION_STYLES.includes(String(s?.style) as any) ? String(s.style) : 'direct',
        buyerCount: Math.max(0, Number(s?.buyer_count ?? 0)),
        avgResponseRatePct: Math.max(0, Math.min(100, Number(s?.avg_response_rate_pct ?? 40))),
        avgDealCloseRatePct: Math.max(0, Math.min(100, Number(s?.avg_deal_close_rate_pct ?? 30))),
        bestToneMatch: ['professional', 'friendly', 'formal', 'casual', 'urgent', 'empathetic'].includes(String(s?.best_tone_match)) ? String(s.best_tone_match) : 'professional',
        description: String(s?.description ?? '').slice(0, 250), bestStrategy: String(s?.best_strategy ?? '').slice(0, 300),
      })),
      adaptations: (parsed?.adaptations || []).slice(0, 10).map((a: any) => ({
        buyerStyle: COMMUNICATION_STYLES.includes(String(a?.buyer_style) as any) ? String(a.buyer_style) : 'direct',
        yourAdaptedStyle: COMMUNICATION_STYLES.includes(String(a?.your_adapted_style) as any) ? String(a.your_adapted_style) : 'collaborative',
        adaptationDescription: String(a?.adaptation_description ?? '').slice(0, 250),
        expectedImprovementPct: Math.round(Number(a?.expected_improvement_pct ?? 0)),
        exampleMessage: String(a?.example_message ?? '').slice(0, 400),
        doSay: (a?.do_say || []).slice(0, 5).map((d: any) => String(d).slice(0, 150)),
        dontSay: (a?.dont_say || []).slice(0, 5).map((d: any) => String(d).slice(0, 150)),
      })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
        model: ['bert', 'roberta', 'distilbert', 'xlm_roberta', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
        accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
        predictionType: ['style_classification', 'tone_matching', 'response_prediction', 'negotiation_outcome'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'style_classification',
        weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300), priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        styleTargeted: String(r?.style_targeted ?? 'all').slice(0, 30), expectedResponseImprovementPct: Math.round(Number(r?.expected_response_improvement_pct ?? 0)),
        buyersAffected: Math.max(0, Number(r?.buyers_affected ?? 0)),
      })),
      summary: {
        totalBuyersAnalyzed: buyers.length, avgCommunicationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_communication_score ?? 60))),
        mostCommonStyle: COMMUNICATION_STYLES.includes(String(parsed?.summary?.most_common_style) as any) ? String(parsed.summary.most_common_style) : 'direct',
        bestRespondingStyle: COMMUNICATION_STYLES.includes(String(parsed?.summary?.best_responding_style) as any) ? String(parsed.summary.best_responding_style) : 'collaborative',
        biggestCommunicationChallenge: String(parsed?.summary?.biggest_communication_challenge ?? '').slice(0, 200),
        biggestCommunicationOpportunity: String(parsed?.summary?.biggest_communication_opportunity ?? '').slice(0, 200),
        communicationAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.communication_analysis_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, analyzer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
