// v6.22: AI Listing Title A/B Tester — generira in testira naslove oglasov za maksimalen CTR
// POST /api/ai/title-abtest
// Body: { tradeId?: string, currentTitle?: string, category?: string, price?: number }
// Returns: { ok, test: { currentTitle, variants: [], winner: [], analysis: [], platformSpecific: [] } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { tradeId } = body;
    let currentTitle: string = body?.currentTitle ?? '';
    let category: string = body?.category ?? '';
    let price: number = body?.price ?? 0;
    let description = '';

    if (tradeId) {
      const trade = await db.trade.findUnique({
        where: { id: String(tradeId) },
        select: {
          title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, aiEstimatedValue: true } },
        },
      });
      if (!trade) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
      currentTitle = currentTitle || trade.title;
      category = category || trade.category || '';
      price = price || trade.buyPrice;
      description = trade.listing?.detailDescription || trade.listing?.description || '';
    }

    if (!currentTitle) {
      return NextResponse.json({ error: 'currentTitle ali tradeId je obvezen' }, { status: 400 });
    }

    // 1. AI A/B test naslovov
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za copywriting in A/B testiranje naslovov oglasov.
Generiraj 5 variants naslova za ta artikel in oceni njihovo učinkovitost.

TRENUTNI NASLOV: ${currentTitle}
KATEGORIJA: ${category}
CENA: ${price}€
OPIS: ${description.slice(0, 400)}

Slovenski kontekst:
- Bolha: max 60 znakov, ključne besede zadaj
- Vinted: max 80 znakov, brend + velikost + stanje
- Facebook: max 100 znakov, emoji dovoljen, lokacija koristna
- Avtonet: max 50 znakov, tehnični podatki (letnik, km)
- Kleinanzeigen: max 70 znakov, "Suche" ali "Biete" predpona

Strategije naslovov:
1. KEYWORD_OPTIMIZED: ključne besede za iskanje (model, brand, stanje)
2. BENEFIT_DRIVEN: poudari korist ("kot novo", "z garancijo", "redko")
3. URGENCY: nujnost ("nujno", "akcijska cena", "samo še danes")
4. CURIOSITY: zanimivost ("redki model", "izzučna priložnost")
5. SPECIFICITY: specifičnost (letnik, km, velikost, barva)

Za vsako varianto oceni:
- CTR score (0-100) — predviden click-through rate
- searchVisibility (0-100) — kako dobro bo najden v iskanju
- conversionScore (0-100) — predvidena konverzija v nakup
- characterCount (ali ustreza limitu platforme)
- strengths/weaknesses

Odgovori LE z JSON:
{
  "current_title_analysis": {
    "score": <number 0-100>,
    "strengths": ["<max 60 znakov>", "..."],
    "weaknesses": ["<max 60 znakov>", "..."]
  },
  "variants": [
    {
      "title": "<variant naslov, max 100 znakov>",
      "strategy": "<KEYWORD_OPTIMIZED|BENEFIT_DRIVEN|URGENCY|CURIOSITY|SPECIFICITY>",
      "character_count": <number>,
      "ctr_score": <number 0-100>,
      "search_visibility": <number 0-100>,
      "conversion_score": <number 0-100>,
      "overall_score": <number 0-100>,
      "strengths": ["<max 60 znakov>", "..."],
      "weaknesses": ["<max 60 znakov>", "..."],
      "best_for_platform": "<bolha|vinted|facebook|avtonet|kleinanzeigen>"
    }
  ],
  "winner": {
    "title": "<boljši naslov>",
    "why": "<max 150 znakov>",
    "expected_improvement_pct": <number>
  },
  "platform_specific_titles": {
    "bolha": "<naslov za Bolha, max 60 znakov>",
    "vinted": "<naslov za Vinted, max 80 znakov>",
    "facebook": "<naslov za Facebook z emoji, max 100 znakov>",
    "kleinanzeigen": "<naslov za Kleinanzeigen, max 70 znakov>"
  },
  "tips": ["<splošno priporočilo, max 100 znakov>", "..."]
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

    const test = {
      currentTitle,
      currentTitleAnalysis: {
        score: Math.max(0, Math.min(100, Number(parsed?.current_title_analysis?.score ?? 50))),
        strengths: (parsed?.current_title_analysis?.strengths || []).slice(0, 4).map((s: any) => String(s).slice(0, 150)),
        weaknesses: (parsed?.current_title_analysis?.weaknesses || []).slice(0, 4).map((w: any) => String(w).slice(0, 150)),
      },
      variants: (parsed?.variants || []).slice(0, 6).map((v: any) => ({
        title: String(v?.title ?? '').slice(0, 200),
        strategy: ['KEYWORD_OPTIMIZED', 'BENEFIT_DRIVEN', 'URGENCY', 'CURIOSITY', 'SPECIFICITY'].includes(String(v?.strategy))
          ? String(v.strategy) : 'KEYWORD_OPTIMIZED',
        characterCount: Math.max(0, Number(v?.character_count ?? 0)),
        ctrScore: Math.max(0, Math.min(100, Number(v?.ctr_score ?? 50))),
        searchVisibility: Math.max(0, Math.min(100, Number(v?.search_visibility ?? 50))),
        conversionScore: Math.max(0, Math.min(100, Number(v?.conversion_score ?? 50))),
        overallScore: Math.max(0, Math.min(100, Number(v?.overall_score ?? 50))),
        strengths: (v?.strengths || []).slice(0, 3).map((s: any) => String(s).slice(0, 150)),
        weaknesses: (v?.weaknesses || []).slice(0, 3).map((w: any) => String(w).slice(0, 150)),
        bestForPlatform: ['bolha', 'vinted', 'facebook', 'avtonet', 'kleinanzeigen'].includes(String(v?.best_for_platform))
          ? String(v.best_for_platform) : 'bolha',
      })),
      winner: {
        title: String(parsed?.winner?.title ?? '').slice(0, 200),
        why: String(parsed?.winner?.why ?? '').slice(0, 300),
        expectedImprovementPct: Math.max(0, Number(parsed?.winner?.expected_improvement_pct ?? 0)),
      },
      platformSpecificTitles: {
        bolha: String(parsed?.platform_specific_titles?.bolha ?? '').slice(0, 100),
        vinted: String(parsed?.platform_specific_titles?.vinted ?? '').slice(0, 120),
        facebook: String(parsed?.platform_specific_titles?.facebook ?? '').slice(0, 150),
        kleinanzeigen: String(parsed?.platform_specific_titles?.kleinanzeigen ?? '').slice(0, 120),
      },
      tips: (parsed?.tips || []).slice(0, 6).map((t: any) => String(t).slice(0, 250)),
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
      test,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
