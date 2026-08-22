// v6.69 / v8.95.4-batch1: AI Buyer Communication Style Analyzer — analiza komunikacijskega stila z ML NLP
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-communication-style-analyzer
// Body: { customerName?: string }
// Returns: { ok, analyzer: { buyers, communicationStyles, adaptations, mlModels, recommendations, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BuyerCommunicationStyleAnalyzerInput {
  customerName: string | null;
}

interface ListingRow {
  id: string;
  title: string;
  contactStatus: string;
  contactedAt: Date | null;
  sellerResponse: string | null;
  description: string;
}

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  sellLocation: string;
}

interface BuyerInfo {
  name: string;
  purchases: number;
  totalSpent: number;
}

const COMMUNICATION_STYLES = ['direct', 'indirect', 'formal', 'informal', 'analytical', 'emotional', 'assertive', 'passive', 'persuasive', 'collaborative'] as const;
const PREFERRED_TONES = ['professional', 'friendly', 'formal', 'casual', 'urgent', 'empathetic'] as const;
const PREFERRED_CHANNELS = ['email', 'sms', 'phone', 'in_person', 'social'] as const;
const RESPONSE_TIME_PREFS = ['immediate', 'same_day', 'flexible'] as const;
const NEGOTIATION_STYLES = ['aggressive', 'moderate', 'collaborative', 'passive'] as const;
const NLP_MODELS = ['bert', 'roberta', 'distilbert', 'xlm_roberta', 'ensemble'] as const;
const NLP_PREDICTION_TYPES = ['style_classification', 'tone_matching', 'response_prediction', 'negotiation_outcome'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;

export const POST = withAiRoute<BuyerCommunicationStyleAnalyzerInput>({
  endpoint: '/api/ai/buyer-communication-style-analyzer',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { customerName: body?.customerName ? String(body.customerName).trim() : null };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { customerName } = input;

    const listings: ListingRow[] = await db.listing.findMany({
      where: { contactStatus: { not: 'none' }, sellerResponse: { not: null } },
      select: { id: true, title: true, contactStatus: true, contactedAt: true, sellerResponse: true, description: true },
      take: 100,
      orderBy: { contactedAt: 'desc' },
    });
    const soldTrades: SoldTradeRow[] = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true },
      take: 300,
      orderBy: { sellDate: 'desc' },
    });

    if (listings.length === 0 && soldTrades.length === 0) {
      return apiOk({ ok: true, analyzer: null, message: 'Ni komunikacije za analizo.' });
    }

    const buyerMap = new Map<string, BuyerInfo>();
    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2) continue;
      const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0 });
      const b = buyerMap.get(name)!;
      b.purchases += 1;
      b.totalSpent += rev;
    }
    const buyers = Array.from(buyerMap.values());

    if (customerName) {
      const f = buyers.filter(b => b.name === customerName);
      if (f.length === 0) {
        return apiOk({ ok: true, analyzer: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 20);
    const prompt = buildPrompt(listings, targetBuyers);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const analyzer = transformAnalyzer(parsed, buyers);

    return apiOk({ ok: true, analyzer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function buildPrompt(listings: ListingRow[], targetBuyers: BuyerInfo[]): string {
  const msgStr = listings.slice(0, 15).map(l =>
    `- "${l.title}" | response: "${String(l.sellerResponse || '').slice(0, 200)}"`
  ).join('\n');
  const buyersStr = targetBuyers.slice(0, 10).map(b =>
    `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€`
  ).join('\n');

  return `Si AI buyer communication style analyzer z ML NLP.
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
}

function transformAnalyzer(parsed: any, buyers: BuyerInfo[]): any {
  const validNames = new Set(buyers.map(b => b.name));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    buyers: (parsed?.buyers || []).filter((b: any) => validNames.has(String(b?.name ?? ''))).slice(0, 25).map((b: any) => ({
      name: String(b?.name ?? '').slice(0, 100),
      primaryStyle: includes(COMMUNICATION_STYLES, String(b?.primary_style)) ? String(b.primary_style) : 'direct',
      secondaryStyle: includes(COMMUNICATION_STYLES, String(b?.secondary_style)) ? String(b.secondary_style) : 'collaborative',
      styleConfidencePct: clamp(Number(b?.style_confidence_pct ?? 60), 0, 100),
      communicationScore: clamp(Number(b?.communication_score ?? 60), 0, 100),
      preferredTone: includes(PREFERRED_TONES, String(b?.preferred_tone)) ? String(b.preferred_tone) : 'professional',
      preferredChannel: includes(PREFERRED_CHANNELS, String(b?.preferred_channel)) ? String(b.preferred_channel) : 'email',
      responseTimePreference: includes(RESPONSE_TIME_PREFS, String(b?.response_time_preference)) ? String(b.response_time_preference) : 'same_day',
      negotiationStyle: includes(NEGOTIATION_STYLES, String(b?.negotiation_style)) ? String(b.negotiation_style) : 'moderate',
      keyPhrases: (b?.key_phrases || []).slice(0, 5).map((p: any) => String(p).slice(0, 100)),
      adaptationStrategy: String(b?.adaptation_strategy ?? '').slice(0, 300),
      expectedResponseRatePct: clamp(Number(b?.expected_response_rate_pct ?? 40), 0, 100),
    })),
    communicationStyles: (parsed?.communicationStyles || []).slice(0, 10).map((s: any) => ({
      style: includes(COMMUNICATION_STYLES, String(s?.style)) ? String(s.style) : 'direct',
      buyerCount: Math.max(0, Number(s?.buyer_count ?? 0)),
      avgResponseRatePct: clamp(Number(s?.avg_response_rate_pct ?? 40), 0, 100),
      avgDealCloseRatePct: clamp(Number(s?.avg_deal_close_rate_pct ?? 30), 0, 100),
      bestToneMatch: includes(PREFERRED_TONES, String(s?.best_tone_match)) ? String(s.best_tone_match) : 'professional',
      description: String(s?.description ?? '').slice(0, 250),
      bestStrategy: String(s?.best_strategy ?? '').slice(0, 300),
    })),
    adaptations: (parsed?.adaptations || []).slice(0, 10).map((a: any) => ({
      buyerStyle: includes(COMMUNICATION_STYLES, String(a?.buyer_style)) ? String(a.buyer_style) : 'direct',
      yourAdaptedStyle: includes(COMMUNICATION_STYLES, String(a?.your_adapted_style)) ? String(a.your_adapted_style) : 'collaborative',
      adaptationDescription: String(a?.adaptation_description ?? '').slice(0, 250),
      expectedImprovementPct: Math.round(Number(a?.expected_improvement_pct ?? 0)),
      exampleMessage: String(a?.example_message ?? '').slice(0, 400),
      doSay: (a?.do_say || []).slice(0, 5).map((d: any) => String(d).slice(0, 150)),
      dontSay: (a?.dont_say || []).slice(0, 5).map((d: any) => String(d).slice(0, 150)),
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: includes(NLP_MODELS, String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: clamp(Number(m?.accuracy_pct ?? 75), 0, 100),
      predictionType: includes(NLP_PREDICTION_TYPES, String(m?.prediction_type)) ? String(m.prediction_type) : 'style_classification',
      weightInEnsemble: clamp(Number(m?.weight_in_ensemble ?? 20), 0, 100),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      priority: includes(PRIORITIES, String(r?.priority)) ? String(r.priority) : 'medium',
      styleTargeted: String(r?.style_targeted ?? 'all').slice(0, 30),
      expectedResponseImprovementPct: Math.round(Number(r?.expected_response_improvement_pct ?? 0)),
      buyersAffected: Math.max(0, Number(r?.buyers_affected ?? 0)),
    })),
    summary: {
      totalBuyersAnalyzed: buyers.length,
      avgCommunicationScore: clamp(Number(parsed?.summary?.avg_communication_score ?? 60), 0, 100),
      mostCommonStyle: includes(COMMUNICATION_STYLES, String(parsed?.summary?.most_common_style)) ? String(parsed.summary.most_common_style) : 'direct',
      bestRespondingStyle: includes(COMMUNICATION_STYLES, String(parsed?.summary?.best_responding_style)) ? String(parsed.summary.best_responding_style) : 'collaborative',
      biggestCommunicationChallenge: String(parsed?.summary?.biggest_communication_challenge ?? '').slice(0, 200),
      biggestCommunicationOpportunity: String(parsed?.summary?.biggest_communication_opportunity ?? '').slice(0, 200),
      communicationAnalysisScore: clamp(Number(parsed?.summary?.communication_analysis_score ?? 60), 0, 100),
    },
  };
}
