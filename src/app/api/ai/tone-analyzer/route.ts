// v6.28: AI Listing Description Tone Analyzer — analizira ton opisa in priporoča izboljšave
// POST /api/ai/tone-analyzer
// Body: { tradeId?: string, description?: string, title?: string }
// Returns: { ok, analysis: { toneProfile, sentiment, readability, persuasiveness, issues, recommendations, rewrite } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { tradeId } = body;
    let description: string = body?.description ?? '';
    let title: string = body?.title ?? '';

    if (tradeId) {
      const trade = await db.trade.findUnique({
        where: { id: String(tradeId) },
        select: { title: true, listing: { select: { description: true, detailDescription: true } } },
      });
      if (!trade) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
      title = title || trade.title;
      description = description || trade.listing?.detailDescription || trade.listing?.description || '';
    }

    if (!description) {
      return NextResponse.json({ error: 'description ali tradeId je obvezen' }, { status: 400 });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za analizo tona in prepričljivosti besedil v e-commerce.
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

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);

    const analysis = {
      toneProfile: String(parsed?.tone_profile ?? 'neutral').slice(0, 30),
      sentiment: ['positive', 'negative', 'neutral', 'mixed'].includes(String(parsed?.sentiment)) ? String(parsed.sentiment) : 'neutral',
      sentimentScore: Math.max(-100, Math.min(100, Number(parsed?.sentiment_score ?? 0))),
      readabilityScore: Math.max(0, Math.min(100, Number(parsed?.readability_score ?? 50))),
      persuasivenessScore: Math.max(0, Math.min(100, Number(parsed?.persuasiveness_score ?? 50))),
      trustScore: Math.max(0, Math.min(100, Number(parsed?.trust_score ?? 50))),
      overallScore: Math.max(0, Math.min(100, Number(parsed?.overall_score ?? 50))),
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

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, analysis });
  } catch (e: any) {
    logger.error("/api/ai/tone-analyzer", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
