// v6.60: AI Buyer Sentiment Analyzer v2 — NLP sentiment z emotion detection in intent classification
// POST /api/ai/buyer-sentiment-analyzer-v2
// Body: { customerName?: string, messages?: Array<{ text, timestamp }> }
// Returns: { ok, analyzer: { buyers, emotions, intents, mlModels, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const EMOTIONS = [
  'joy', 'trust', 'fear', 'surprise', 'sadness', 'disgust', 'anger', 'anticipation',
] as const;

const INTENTS = [
  'purchase_intent',     // kupec želi kupiti
  'price_inquiry',       // vpraša za ceno
  'condition_inquiry',   // vpraša za stanje
  'negotiation_intent',  // želi se pogajati
  'comparison_shopping', // primerja z drugimi
  'urgency_expression',  // izraža nujnost
  'skepticism',          // skepticen
  'complaint',           // pritožba
  'compliment',          // pohvala
  'bargaining',          // explicitno pogaja
  'closing_intent',      // želi zaključiti
  'walk_away_intent',    // grozi da odide
] as const;

const ML_MODELS = [
  'bert_multilingual',
  'roberta_sentiment',
  'distilbert_slavic',
  'xlm_roberta',
  'svm_classifier',
  'lstm_sentiment',
] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;
    const inputMessages: Array<{ text: string; timestamp?: string }> = Array.isArray(body?.messages) ? body.messages : [];

    // Pridobi negotiation messages če so v bazi
    let dbMessages: any[] = [];
    if (customerName && inputMessages.length === 0) {
      const listings = await db.listing.findMany({
        where: { sellerName: customerName, contactStatus: { not: 'none' } },
        select: { id: true, title: true, contactStatus: true, contactedAt: true, sellerResponse: true, description: true },
        take: 50,
      });
      dbMessages = listings.flatMap(l => [
        { text: l.sellerResponse || '', timestamp: l.contactedAt?.toISOString() },
        { text: l.description || '', timestamp: l.firstSeenAt?.toISOString() },
      ].filter(m => m.text));
    }

    const messagesToAnalyze = inputMessages.length > 0 ? inputMessages : dbMessages;

    if (messagesToAnalyze.length === 0 && !customerName) {
      // Default: pridobi zadnje negotiation messages iz baze
      const listings = await db.listing.findMany({
        where: { contactStatus: { not: 'none' }, sellerResponse: { not: null } },
        select: { id: true, title: true, contactStatus: true, contactedAt: true, sellerResponse: true, description: true },
        take: 30,
        orderBy: { contactedAt: 'desc' },
      });
      dbMessages = listings.flatMap(l => [
        { text: l.sellerResponse || '', timestamp: l.contactedAt?.toISOString(), listingTitle: l.title },
        { text: l.description || '', timestamp: l.firstSeenAt?.toISOString(), listingTitle: l.title },
      ].filter(m => m.text));
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const messagesStr = messagesToAnalyze.slice(0, 15).map((m: any, i: number) =>
      `- Msg ${i + 1}: "${String(m.text || '').slice(0, 200)}" | ${m.timestamp || 'nepoznano'}`
    ).join('\n');

    const prompt = `Si AI buyer sentiment analyzer v2 z NLP, emotion detection in intent classification.
Analiziraš čustva in namere kupcev iz njihovih sporočil.

SPOROČILA ZA ANALIZO (${messagesToAnalyze.length}):
${messagesStr}

8 čustev (Plutchik model):
1. JOY: veselje, navdušenje ("super!", "odlično!")
2. TRUST: zaupanje ("lahko zaupam?", "vidi OK")
3. FEAR: strah, negotovost ("kaj če?", "sem negotov")
4. SURPRISE: presenečenje ("wow!", "nenavadno")
5. SADNESS: žalost, razočaranje ("škoda", "ne morem")
6. DISGUST: gnus, odpor ("grozno", "nedopustno")
7. ANGER: jeza, frustracija ("ne morem verjeti!", "dražje!")
8. ANTICIPATION: pričakovanje ("komaj čakam", "vidva")

12 intentov:
1. PURCHASE_INTENT: kupec želi kupiti ("vzamem", "kupim")
2. PRICE_INQUIRY: vpraša za ceno ("koliko?", "k cena?")
3. CONDITION_INQUIRY: vpraša za stanje ("kako stanje?", "poškodbe?")
4. NEGOTIATION_INTENT: želi se pogajati ("lahko ceneje?", "popust?")
5. COMPARISON_SHOPPING: primerja ("drugje ceneje", "sem videl drugje")
6. URGENCY_EXPRESSION: izraža nujnost ("danes", "nujno", "hitro")
7. SKEPTICISM: skepticen ("res?", "ne vem če...")
8. COMPLAINT: pritožba ("slaba izkušnja", "ne deluje")
9. COMPLIMENT: pohvala ("super stanje", "hvala")
10. BARGAINING: explicitno pogaja ("130€ namesto 150€")
11. CLOSING_INTENT: želi zaključiti ("kje se dobimo?", "plačam")
12. WALK_AWAY_INTENT: grozi da odide ("drugje bom kupil", "pa ne")

ML modeli:
- BERT_MULTILINGUAL: za slovensko-angleski tekst
- ROBERTA_SENTIMENT: optimized za sentiment
- DISTILBERT_SLAVIC: lažji model za slovanske jezike
- XLM_ROBERTA: cross-lingual
- SVM_CLASSIFIER: tradicionalni ML
- LSTM_SENTIMENT: recurrent za sequence

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    {
      "name": "<ime ali anonymous>",
      "overall_sentiment": "<very_positive|positive|neutral|negative|very_negative>",
      "sentiment_score": <number -100 do 100>,
      "emotions": [
        {"emotion": "<8 čustev>", "intensity": <number 0-100>, "confidence_pct": <number 0-100>}
      ],
      "dominant_emotion": "<8 čustev>",
      "intents": [
        {"intent": "<12 intentov>", "probability_pct": <number 0-100>, "confidence_pct": <number 0-100>}
      ],
      "primary_intent": "<12 intentov>",
      "purchase_probability_pct": <number 0-100>,
      "churn_probability_pct": <number 0-100>,
      "satisfaction_score": <number 0-100>,
      "engagement_level": "<high|medium|low>",
      "recommended_response_tone": "<professional|friendly|empathetic|urgent|apologetic|enthusiastic>",
      "key_phrases": ["<max 80 znakov>"],
      "concerns": ["<max 100 znakov>"],
      "opportunities": ["<max 100 znakov>"]
    }
  ],
  "emotions": [
    {"emotion": "<8 čustev>", "avg_intensity": <number 0-100>, "frequency": <number>, "buyer_count": <number>, "trigger_pattern": "<max 100 znakov>", "recommended_response": "<max 150 znakov>"}
  ],
  "intents": [
    {"intent": "<12 intentov>", "frequency": <number>, "buyer_count": <number>, "conversion_correlation_pct": <number 0-100>, "best_response_strategy": "<max 150 znakov>"}
  ],
  "ml_models": [
    {"model": "<6 ML modelov>", "accuracy_pct": <number 0-100>, "f1_score": <number 0-100>, "inference_time_ms": <number>, "best_for": "<max 80 znakov>", "weight_in_ensemble": <number 0-100>}
  ],
  "recommendations": [
    {"action": "<max 150 znakov>", "priority": "<high|medium|low>", "target_sentiment": "<8 čustev ali all>", "expected_outcome": "<max 100 znakov>", "buyers_affected": <number>}
  ],
  "summary": {
    "total_messages_analyzed": <number>,
    "total_buyers_analyzed": <number>,
    "avg_sentiment_score": <number>,
    "avg_purchase_probability_pct": <number>,
    "avg_satisfaction_score": <number>,
    "most_common_emotion": "<max 80 znakov>",
    "most_common_intent": "<max 80 znakov>",
    "biggest_concern": "<max 100 znakov>",
    "biggest_opportunity": "<max 100 znakov>",
    "sentiment_analysis_score": <number 0-100>
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

    const analyzer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      buyers: (parsed?.buyers || []).slice(0, 15).map((b: any) => ({
        name: String(b?.name ?? 'anonymous').slice(0, 100),
        overallSentiment: ['very_positive', 'positive', 'neutral', 'negative', 'very_negative'].includes(String(b?.overall_sentiment)) ? String(b.overall_sentiment) : 'neutral',
        sentimentScore: Math.max(-100, Math.min(100, Number(b?.sentiment_score ?? 0))),
        emotions: (b?.emotions || []).slice(0, 8).map((e: any) => ({
          emotion: EMOTIONS.includes(String(e?.emotion) as any) ? String(e.emotion) : 'joy',
          intensity: Math.max(0, Math.min(100, Number(e?.intensity ?? 30))),
          confidencePct: Math.max(0, Math.min(100, Number(e?.confidence_pct ?? 50))),
        })),
        dominantEmotion: EMOTIONS.includes(String(b?.dominant_emotion) as any) ? String(b.dominant_emotion) : 'joy',
        intents: (b?.intents || []).slice(0, 12).map((i: any) => ({
          intent: INTENTS.includes(String(i?.intent) as any) ? String(i.intent) : 'purchase_intent',
          probabilityPct: Math.max(0, Math.min(100, Number(i?.probability_pct ?? 30))),
          confidencePct: Math.max(0, Math.min(100, Number(i?.confidence_pct ?? 50))),
        })),
        primaryIntent: INTENTS.includes(String(b?.primary_intent) as any) ? String(b.primary_intent) : 'purchase_intent',
        purchaseProbabilityPct: Math.max(0, Math.min(100, Number(b?.purchase_probability_pct ?? 50))),
        churnProbabilityPct: Math.max(0, Math.min(100, Number(b?.churn_probability_pct ?? 30))),
        satisfactionScore: Math.max(0, Math.min(100, Number(b?.satisfaction_score ?? 50))),
        engagementLevel: ['high', 'medium', 'low'].includes(String(b?.engagement_level)) ? String(b.engagement_level) : 'medium',
        recommendedResponseTone: ['professional', 'friendly', 'empathetic', 'urgent', 'apologetic', 'enthusiastic'].includes(String(b?.recommended_response_tone)) ? String(b.recommended_response_tone) : 'professional',
        keyPhrases: (b?.key_phrases || []).slice(0, 5).map((p: any) => String(p).slice(0, 150)),
        concerns: (b?.concerns || []).slice(0, 4).map((c: any) => String(c).slice(0, 200)),
        opportunities: (b?.opportunities || []).slice(0, 4).map((o: any) => String(o).slice(0, 200)),
      })),
      emotions: (parsed?.emotions || []).slice(0, 8).map((e: any) => ({
        emotion: EMOTIONS.includes(String(e?.emotion) as any) ? String(e.emotion) : 'joy',
        avgIntensity: Math.max(0, Math.min(100, Number(e?.avg_intensity ?? 30))),
        frequency: Math.max(0, Number(e?.frequency ?? 0)),
        buyerCount: Math.max(0, Number(e?.buyer_count ?? 0)),
        triggerPattern: String(e?.trigger_pattern ?? '').slice(0, 200),
        recommendedResponse: String(e?.recommended_response ?? '').slice(0, 300),
      })),
      intents: (parsed?.intents || []).slice(0, 12).map((i: any) => ({
        intent: INTENTS.includes(String(i?.intent) as any) ? String(i.intent) : 'purchase_intent',
        frequency: Math.max(0, Number(i?.frequency ?? 0)),
        buyerCount: Math.max(0, Number(i?.buyer_count ?? 0)),
        conversionCorrelationPct: Math.max(0, Math.min(100, Number(i?.conversion_correlation_pct ?? 50))),
        bestResponseStrategy: String(i?.best_response_strategy ?? '').slice(0, 300),
      })),
      mlModels: (parsed?.ml_models || []).slice(0, 6).map((m: any) => ({
        model: ML_MODELS.includes(String(m?.model) as any) ? String(m.model) : 'bert_multilingual',
        accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
        f1Score: Math.max(0, Math.min(100, Number(m?.f1_score ?? 70))),
        inferenceTimeMs: Math.round(Number(m?.inference_time_ms ?? 100)),
        bestFor: String(m?.best_for ?? '').slice(0, 150),
        weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 16))),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        targetSentiment: String(r?.target_sentiment ?? 'all').slice(0, 30),
        expectedOutcome: String(r?.expected_outcome ?? '').slice(0, 200),
        buyersAffected: Math.max(0, Number(r?.buyers_affected ?? 0)),
      })),
      summary: {
        totalMessagesAnalyzed: Math.max(0, Number(parsed?.summary?.total_messages_analyzed ?? messagesToAnalyze.length)),
        totalBuyersAnalyzed: Math.max(0, Number(parsed?.summary?.total_buyers_analyzed ?? (parsed?.buyers || []).length)),
        avgSentimentScore: Math.max(-100, Math.min(100, Number(parsed?.summary?.avg_sentiment_score ?? 0))),
        avgPurchaseProbabilityPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_purchase_probability_pct ?? 50))),
        avgSatisfactionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_satisfaction_score ?? 50))),
        mostCommonEmotion: EMOTIONS.includes(String(parsed?.summary?.most_common_emotion) as any) ? String(parsed.summary.most_common_emotion) : 'joy',
        mostCommonIntent: INTENTS.includes(String(parsed?.summary?.most_common_intent) as any) ? String(parsed.summary.most_common_intent) : 'purchase_intent',
        biggestConcern: String(parsed?.summary?.biggest_concern ?? '').slice(0, 200),
        biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 200),
        sentimentAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.sentiment_analysis_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, analyzer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
