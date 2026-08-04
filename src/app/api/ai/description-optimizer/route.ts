// v6.23: AI Listing Description Optimizer — optimizira opise oglasov z A/B test variantami
// POST /api/ai/description-optimizer
// Body: { tradeId?: string, currentDescription?: string, title?: string, category?: string, price?: number, targetPlatform?: string }
// Returns: { ok, optimization: { currentAnalysis, variants: [], winner, platformOptimized: [], seoKeywords, improvements } }

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
    let currentDescription: string = body?.currentDescription ?? '';
    let title: string = body?.title ?? '';
    let category: string = body?.category ?? '';
    let price: number = body?.price ?? 0;
    const targetPlatform = ['bolha', 'vinted', 'facebook', 'avtonet', 'kleinanzeigen'].includes(String(body?.targetPlatform))
      ? String(body.targetPlatform) : 'bolha';

    if (tradeId) {
      const trade = await db.trade.findUnique({
        where: { id: String(tradeId) },
        select: {
          title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, aiEstimatedValue: true } },
        },
      });
      if (!trade) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
      title = title || trade.title;
      category = category || trade.category || '';
      price = price || trade.buyPrice;
      currentDescription = currentDescription || trade.listing?.detailDescription || trade.listing?.description || '';
    }

    if (!currentDescription && !tradeId) {
      return NextResponse.json({ error: 'currentDescription ali tradeId je obvezen' }, { status: 400 });
    }

    // 1. AI optimizacija
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za copywriting in optimizacijo opisov oglasov za e-commerce.
Analiziraj trenutni opis in generiraj 4 optimizirane variante z različnimi strategijami.

NASLOV: ${title}
KATEGORIJA: ${category}
CENA: ${price}€
TRENUTNI OPIS:
${currentDescription.slice(0, 1500)}

CIJLJNA PLATFORMA: ${targetPlatform}

Slovenski kontekst:
- Bolha: do 2000 znakov, ključne besede v prvih 200 znakih
- Vinted: do 500 znakov, hashtagi (#bolha #stanje), specifikacije
- Facebook: do 5000 znakov, emoji dovoljen, osebni ton
- Avtonet: do 1000 znakov, tehnični podatki (letnik, km, kW)
- Kleinanzeigen: do 4000 znakov, "Zustand" opis, "Versand" informacija

Strategije opisov:
1. BENEFIT_FOCUSED: poudari koristi za kupca ("prihranek", "kakovost", "redkost")
2. STORYTELLING: osebna zgodba (zakaj prodaja, zgodovina itema)
3. TECHNICAL: specifikacije in tehnični podatki (slovenski kupci to radi)
4. SCANNABLE: bullet list, enostaven pregled (hitro prebiranje)

Za vsako varianto oceni:
- readabilityScore (0-100) — kako enostavno berljivo
- persuasivenessScore (0-100) — kako prepričljivo
- seoScore (0-100) — ključne besede za iskanje
- trustScore (0-100) — koliko zaupanja vzbuja
- characterCount (ali ustreza limitu)
- expectedInquiries (predvideno število povpraševanj)

Odgovori LE z JSON:
{
  "current_analysis": {
    "score": <number 0-100>,
    "word_count": <number>,
    "strengths": ["<max 60 znakov>", "..."],
    "weaknesses": ["<max 60 znakov>", "..."],
    "missing_elements": ["<kaj manjka, max 80 znakov>", "..."]
  },
  "variants": [
    {
      "strategy": "<BENEFIT_FOCUSED|STORYTELLING|TECHNICAL|SCANNABLE>",
      "description": "<optimiziran opis, max 2500 znakov>",
      "character_count": <number>,
      "readability_score": <number 0-100>,
      "persuasiveness_score": <number 0-100>,
      "seo_score": <number 0-100>,
      "trust_score": <number 0-100>,
      "overall_score": <number 0-100>,
      "expected_inquiries": <number>,
      "key_features": ["<kaj je poudarjeno, max 60 znakov>", "..."],
      "best_for_platform": "<bolha|vinted|facebook|avtonet|kleinanzeigen>"
    }
  ],
  "winner": {
    "description": "<zmagovalni opis>",
    "why": "<max 200 znakov>",
    "expected_improvement_pct": <number>
  },
  "seo_keywords": ["<ključna beseda, max 30 znakov>", "..."],
  "improvements": [
    {
      "element": "<kaj dodati, max 80 znakov>",
      "priority": "<high|medium|low>",
      "impact": "<max 80 znakov>"
    }
  ],
  "platform_specific_tips": {
    "bolha": "<max 100 znakov>",
    "vinted": "<max 100 znakov>",
    "facebook": "<max 100 znakov>"
  }
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = {
          provider: aiSettings.fallbackProvider,
          baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '',
          model: aiSettings.fallbackModel,
        };
        raw = await callProviderForRaw(fb, prompt);
      } else {
        return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);

    const optimization = {
      currentAnalysis: {
        score: Math.max(0, Math.min(100, Number(parsed?.current_analysis?.score ?? 50))),
        wordCount: Math.max(0, Number(parsed?.current_analysis?.word_count ?? 0)),
        strengths: (parsed?.current_analysis?.strengths || []).slice(0, 4).map((s: any) => String(s).slice(0, 150)),
        weaknesses: (parsed?.current_analysis?.weaknesses || []).slice(0, 4).map((w: any) => String(w).slice(0, 150)),
        missingElements: (parsed?.current_analysis?.missing_elements || []).slice(0, 5).map((m: any) => String(m).slice(0, 200)),
      },
      variants: (parsed?.variants || []).slice(0, 5).map((v: any) => ({
        strategy: ['BENEFIT_FOCUSED', 'STORYTELLING', 'TECHNICAL', 'SCANNABLE'].includes(String(v?.strategy))
          ? String(v.strategy) : 'BENEFIT_FOCUSED',
        description: String(v?.description ?? '').slice(0, 3000),
        characterCount: Math.max(0, Number(v?.character_count ?? 0)),
        readabilityScore: Math.max(0, Math.min(100, Number(v?.readability_score ?? 50))),
        persuasivenessScore: Math.max(0, Math.min(100, Number(v?.persuasiveness_score ?? 50))),
        seoScore: Math.max(0, Math.min(100, Number(v?.seo_score ?? 50))),
        trustScore: Math.max(0, Math.min(100, Number(v?.trust_score ?? 50))),
        overallScore: Math.max(0, Math.min(100, Number(v?.overall_score ?? 50))),
        expectedInquiries: Math.max(0, Number(v?.expected_inquiries ?? 0)),
        keyFeatures: (v?.key_features || []).slice(0, 5).map((f: any) => String(f).slice(0, 150)),
        bestForPlatform: ['bolha', 'vinted', 'facebook', 'avtonet', 'kleinanzeigen'].includes(String(v?.best_for_platform))
          ? String(v.best_for_platform) : 'bolha',
      })),
      winner: {
        description: String(parsed?.winner?.description ?? '').slice(0, 3000),
        why: String(parsed?.winner?.why ?? '').slice(0, 300),
        expectedImprovementPct: Math.max(0, Number(parsed?.winner?.expected_improvement_pct ?? 0)),
      },
      seoKeywords: (parsed?.seo_keywords || []).slice(0, 10).map((k: any) => String(k).slice(0, 80)),
      improvements: (parsed?.improvements || []).slice(0, 8).map((i: any) => ({
        element: String(i?.element ?? '').slice(0, 200),
        priority: ['high', 'medium', 'low'].includes(String(i?.priority)) ? String(i.priority) : 'medium',
        impact: String(i?.impact ?? '').slice(0, 200),
      })),
      platformSpecificTips: {
        bolha: String(parsed?.platform_specific_tips?.bolha ?? '').slice(0, 300),
        vinted: String(parsed?.platform_specific_tips?.vinted ?? '').slice(0, 300),
        facebook: String(parsed?.platform_specific_tips?.facebook ?? '').slice(0, 300),
      },
    };

    // Increment AI usage
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      optimization,
      targetPlatform,
    });
  } catch (e: any) {
    logger.error("/api/ai/description-optimizer", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
