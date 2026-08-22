// v6.28 / v8.94-refactor: AI Listing Description Tone Analyzer
// Refaktoriran z withAiRoute helperjem (v8.94) — boilerplate (try/catch,
// settings load, fallback provider, rate limit, JSON parse) je izločen.
//
// POST /api/ai/tone-analyzer
// Body: { tradeId?: string, description?: string, title?: string }
// Returns: { ok, analysis: { toneProfile, sentiment, readability, ... } }

import { NextResponse } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest, apiNotFound } from '@/lib/api-response';

export const { runtime, dynamic, maxDuration } = AI_ROUTE_DEFAULTS;

interface ToneInput {
  tradeId?: string;
  description?: string;
  title?: string;
}

export const POST = withAiRoute<ToneInput>({
  endpoint: '/api/ai/tone-analyzer',
  maxDuration: 60,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : undefined,
      description: body?.description ? String(body.description) : '',
      title: body?.title ? String(body.title) : '',
    };
  },

  validateInput: (input) => {
    if (!input.tradeId && !input.description) {
      return 'description ali tradeId je obvezen';
    }
    return null;
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    let { description, title } = input;

    // Če je podan tradeId, naloži title + description iz baze
    if (input.tradeId) {
      const trade = await db.trade.findUnique({
        where: { id: input.tradeId },
        select: {
          title: true,
          listing: { select: { description: true, detailDescription: true } },
        },
      });
      if (!trade) return apiNotFound('Trade ne obstaja');
      title = title || trade.title;
      description = description || trade.listing?.detailDescription || trade.listing?.description || '';
      if (!description) return apiBadRequest('Trade nima opisa — podaj description v body-ju');
    }

    const prompt = buildPrompt(title ?? '', description ?? '');
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const analysis = transformAnalysis(parsed);

    // Side effect: štej AI klic za dnevni counter (osnova za cost tracking)
    await incrementAiCallCounter(db);

    return apiOk({ analysis });
  },
});

// --- Pomožne funkcije (čiste, testabilne) ---------------------------------

function buildPrompt(title: string, description: string): string {
  return `Si ekspert za analizo tona in prepričljivosti besedil v e-commerce.
Analiziraj ton opisa oglasa in priporoči izboljšave za večjo prepričljivost.

NASLOV: ${title}
OPIS:
${description.slice(0, 2000)}

Analiziraj naslednje vidike:

1. TON (tone profile):
- formal|casual|friendly|urgent|desperate|professional|enthusiastic|neutral
- Ali je ton primeren za slovenski trg?

2. SENTIMENT:
- positive|negative|neutral|mixed
- Ali opis vzbuja zaupanje?

3. READABILITY (0-100):
- Berljivost za povprečnega bralca
- Uporaba žargonov, dolgih stavkov

4. PERSUASIVENESS (0-100):
- Koliko prepriča kupca k nakupu
- Ali poudarja koristi (ne le lastnosti)?

5. TRUST FACTORS (0-100):
- Ali vsebuje elemente zaupanja (garancija, stanje, osebni prevzem)?

6. ISSUES:
- Preveč žargonov
- Predolgi stavki
- Manjkajoče ključne informacije
- Preveč "prodajni" ton (off-putting)
- Napake v slovnici

Odgovori LE z JSON:
{
  "tone_profile": "<formal|casual|friendly|urgent|desperate|professional|enthusiastic|neutral>",
  "sentiment": "<positive|negative|neutral|mixed>",
  "sentiment_score": <number -100 do 100>,
  "readability_score": <number 0-100>,
  "persuasiveness_score": <number 0-100>,
  "trust_score": <number 0-100>,
  "overall_score": <number 0-100>,
  "word_count": <number>,
  "avg_sentence_length": <number>,
  "issues": [
    {
      "type": "<jargon|long_sentences|missing_info|too_salesy|grammar|tone_mismatch|repetition>",
      "severity": "<high|medium|low>",
      "description": "<max 100 znakov>",
      "fix": "<max 100 znakov>"
    }
  ],
  "strengths": ["<prednost, max 80 znakov>", "..."],
  "recommendations": [
    {
      "action": "<max 100 znakov>",
      "priority": "<high|medium|low>",
      "expected_impact": "<max 80 znakov>"
    }
  ],
  "rewrite": {
    "improved_description": "<optimiziran opis, max 2000 znakov>",
    "changes_made": ["<kaj spremenjeno, max 80 znakov>", "..."],
    "improvement_pct": <number>
  },
  "platform_specific_tone": {
    "bolha": "<kakšen ton za Bolha, max 80 znakov>",
    "vinted": "<kakšen ton za Vinted, max 80 znakov>",
    "facebook": "<kakšen ton za Facebook, max 80 znakov>"
  }
}`;
}

function transformAnalysis(parsed: any) {
  return {
    toneProfile: String(parsed?.tone_profile ?? 'neutral').slice(0, 30),
    sentiment: ['positive', 'negative', 'neutral', 'mixed'].includes(String(parsed?.sentiment))
      ? String(parsed.sentiment) : 'neutral',
    sentimentScore: clamp(Number(parsed?.sentiment_score ?? 0), -100, 100),
    readabilityScore: clamp(Number(parsed?.readability_score ?? 50), 0, 100),
    persuasivenessScore: clamp(Number(parsed?.persuasiveness_score ?? 50), 0, 100),
    trustScore: clamp(Number(parsed?.trust_score ?? 50), 0, 100),
    overallScore: clamp(Number(parsed?.overall_score ?? 50), 0, 100),
    wordCount: Math.max(0, Number(parsed?.word_count ?? 0)),
    avgSentenceLength: Math.max(0, Number(parsed?.avg_sentence_length ?? 0)),
    issues: (parsed?.issues || []).slice(0, 8).map((i: any) => ({
      type: String(i?.type ?? '').slice(0, 50),
      severity: ['high', 'medium', 'low'].includes(String(i?.severity)) ? String(i.severity) : 'medium',
      description: String(i?.description ?? '').slice(0, 200),
      fix: String(i?.fix ?? '').slice(0, 200),
    })),
    strengths: (parsed?.strengths || []).slice(0, 5).map((s: any) => String(s).slice(0, 150)),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 200),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      expectedImpact: String(r?.expected_impact ?? '').slice(0, 150),
    })),
    rewrite: {
      improvedDescription: String(parsed?.rewrite?.improved_description ?? '').slice(0, 3000),
      changesMade: (parsed?.rewrite?.changes_made || []).slice(0, 6).map((c: any) => String(c).slice(0, 150)),
      improvementPct: Math.max(0, Number(parsed?.rewrite?.improvement_pct ?? 0)),
    },
    platformSpecificTone: {
      bolha: String(parsed?.platform_specific_tone?.bolha ?? '').slice(0, 200),
      vinted: String(parsed?.platform_specific_tone?.vinted ?? '').slice(0, 200),
      facebook: String(parsed?.platform_specific_tone?.facebook ?? '').slice(0, 200),
    },
  };
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/**
 * Side effect: inkrementiraj dnevni AI counter (osnova za cost tracking).
 * Reset ob datumskem prehodu.
 * TODO (v8.95 cost tracking): razširi z token count + EUR tracking.
 */
async function incrementAiCallCounter(db: AiRouteContext['db']): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const settings = await db.settings.findUnique({
    where: { id: 'singleton' },
    select: { aiCallsDate: true },
  });
  if (settings?.aiCallsDate !== today) {
    await db.settings.update({
      where: { id: 'singleton' },
      data: { aiCallsDate: today, aiCallsToday: 1 },
    });
  } else {
    await db.settings.update({
      where: { id: 'singleton' },
      data: { aiCallsToday: { increment: 1 } },
    });
  }
}
