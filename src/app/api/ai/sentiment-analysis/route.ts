// v6.20: AI Sentiment Analysis — analiza prodajalčevih sporočil in opisov
// POST /api/ai/sentiment-analysis
// Body: { listingId?: string, sellerMessage?: string, listing?: { title, description, sellerName } }
// Returns: { ok, sentiment: { overall, urgency, deceptionRisk, motivation, leverage, toneProfile, redFlags, greenFlags, recommendedApproach } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Hevristični vzorci za zaznavanje prodajalčevega sentimenta
const URGENCY_PATTERNS = [
  { pattern: /nujna|nujno|moram\s+prodati|moram\s+po|hitro\s+prodati/i, weight: 8, label: 'Visoka nujnost' },
  { pattern: /selim\s+se|selitev|odselim|odhod/i, weight: 6, label: 'Selitev izgovor' },
  { pattern: /rabim\s+denar|denar\s+nujen|finančna\s+stiska/i, weight: 9, label: 'Finančna stiska' },
  { pattern: /zdaj\s+ali\s+nikoli|samo\s+danes|samo\s+ta\s+teden|takoj/i, weight: 7, label: 'Time pressure' },
  { pattern: /prvi\s+kupec|prvi\s+zainteresiran|kdor\s+prvi|hitro\s+bo\s+šlo/i, weight: 6, label: 'Pritisk s konkurenco' },
  { pattern: /konča\s+se|zadnji\s+dan|še\s+samo/i, weight: 5, label: 'Končni rok' },
];

const DECEPTION_PATTERNS = [
  { pattern: /brez\s+vprašanj|ne\s+vprašuj|kar\s+kupi|ne\s+razmišljaj/i, weight: 9, label: 'Odsvetuje preverjanje' },
  { pattern: /samo\s+pošiljam|pošiljam\s+samo|pošiljam\s+po\s+svetu|samo\s+predračun/i, weight: 10, label: 'Samo shipping (klasična prevara)' },
  { pattern: /paysafecard|western\s+union|moneygram|bitcoin/i, weight: 10, label: 'Anonimno plačilo' },
  { pattern: /ne\s+morem\s+pokazati|ne\s+morem\s+se\s+zmeniti|preveč\s+komplikacij/i, weight: 7, label: 'Izogiba srečanju' },
  { pattern: /dedovanje|podedoval|od\s+strica|od\s+babice/i, weight: 4, label: 'Težko preverljiv vir' },
  { pattern: /službeni|služba|firma\s+kompenzacija/i, weight: 6, label: 'Sumljiv vir' },
  { pattern: /nov\s+nov|novo\s+novo|popolnoma\s+nov|neodprto/i, weight: 3, label: 'Preveč poudarja novo' },
  { pattern: /cena\s+ni\s+končna|cena\s+po\s+dogovoru|lahko\s+cena/i, weight: 4, label: 'Cena fleksibilna (sumljivo)' },
];

const LEVERAGE_PATTERNS = [
  { pattern: /že\s+ceneje|že\s+nižje|spuščam|popust|cena\s+gre\s+dol/i, weight: 5, label: 'Že zniževal' },
  { pattern: /drago\s+sem\s+kupil|več\s+vredno|investiral\s+sem/i, weight: 3, label: 'Poudarja svojo investicijo' },
  { pattern: /tudi\s+jaz|tudi\s+ti|kompromis|srečamo\s+se\s+v\s+sredini/i, weight: 4, label: 'Odprt za kompromis' },
  { pattern: /lepo\s+stanje|odlično|kot\s+novo|funkcionalno/i, weight: 2, label: 'Poudarja stanje' },
  { pattern: /redko|redkejši|težko\s+dobiti|izjema/i, weight: 4, label: 'Poudarja redkost' },
];

const GREEN_FLAGS = [
  { pattern: /faktura|račun|garancija|servisno|original\s+škatla|embalaža/i, weight: 6, label: 'Dokumentacija' },
  { pattern: /osebni\s+prevzem|lahko\s+vidiš|lahko\s+preizkusiš|srečanje/i, weight: 7, label: 'Omogoča osebni prevzem' },
  { pattern: /test|preizkus|delujoč|brez\s+napak|vse\s+deluje/i, weight: 5, label: 'Omogoča testiranje' },
  { pattern: /zadovoljen|priporočam|lahko\s+vrneš|garantiram/i, weight: 6, label: 'Zaupanje v produkte' },
  { pattern: /slikam\s+še|več\s+slik|video\s+lahko/i, weight: 5, label: 'Ponuja več materiala' },
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId, sellerMessage } = body;
    let listingInput: { title: string; description: string; sellerName?: string | null } | null = body?.listing ?? null;

    if (listingId && !listingInput) {
      const listing = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: {
          title: true, description: true, detailDescription: true, sellerName: true,
          aiRisk: true, aiVerdict: true, aiReason: true,
        },
      });
      if (!listing) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      listingInput = {
        title: listing.title,
        description: listing.detailDescription || listing.description,
        sellerName: listing.sellerName,
      };
    }

    if (!listingInput) {
      return NextResponse.json({ error: 'listingId ali listing objekt je obvezen' }, { status: 400 });
    }

    // 1. Hevristična analiza — pattern matching na opisu in sporočilu
    const fullText = `${listingInput.title} ${listingInput.description} ${sellerMessage || ''}`;
    const detectedUrgency: Array<{ label: string; weight: number; matched: string }> = [];
    const detectedDeception: Array<{ label: string; weight: number; matched: string }> = [];
    const detectedLeverage: Array<{ label: string; weight: number; matched: string }> = [];
    const detectedGreen: Array<{ label: string; weight: number; matched: string }> = [];

    let urgencyScore = 0;
    let deceptionScore = 0;
    let leverageScore = 0;
    let greenScore = 0;

    for (const p of URGENCY_PATTERNS) {
      const m = fullText.match(p.pattern);
      if (m) {
        detectedUrgency.push({ label: p.label, weight: p.weight, matched: m[0].slice(0, 50) });
        urgencyScore += p.weight;
      }
    }
    for (const p of DECEPTION_PATTERNS) {
      const m = fullText.match(p.pattern);
      if (m) {
        detectedDeception.push({ label: p.label, weight: p.weight, matched: m[0].slice(0, 50) });
        deceptionScore += p.weight;
      }
    }
    for (const p of LEVERAGE_PATTERNS) {
      const m = fullText.match(p.pattern);
      if (m) {
        detectedLeverage.push({ label: p.label, weight: p.weight, matched: m[0].slice(0, 50) });
        leverageScore += p.weight;
      }
    }
    for (const p of GREEN_FLAGS) {
      const m = fullText.match(p.pattern);
      if (m) {
        detectedGreen.push({ label: p.label, weight: p.weight, matched: m[0].slice(0, 50) });
        greenScore += p.weight;
      }
    }

    // 2. AI kontekstualna analiza
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si forenzik psiholog specializiran za analizo komunikacije pri spletnih oglasih.
Analiziraj sentiment, motivacijo in morebitne rdeče zastave prodajalca.

NASLOV OGLASA: ${listingInput.title}
OPIS OGLASA: ${(listingInput.description || '').slice(0, 800)}
${sellerMessage ? `\nSPOROČILO PRODAJALCA:\n${sellerMessage.slice(0, 1500)}` : ''}

HEVRISTIČNA ANALIZA (predhodna):
- Urgentnost (visoka = motiviran prodajalec): ${urgencyScore}/100
- Deception risk (sumljivo): ${deceptionScore}/100
- Leverage (tvojih argumentov za pogajanje): ${leverageScore}/100
- Green flags (pozitivni znaki): ${greenScore}/100

Oceni:
1. OVERALL sentiment: desperate|motivated|neutral|reluctant|suspicious
2. URGENCY (0-100): kako nujno prodajalec želi prodati (višje = boljši za nakup)
3. DECEPTION_RISK (0-100): verjetnost prevare
4. MOTIVATION: zakaj prodaja (selitev, denar, nadgradnja, dedovanje, prevara, ...)
5. LEVERAGE (0-100): kako močno lahko pogajaš (višje = boljše za kupca)
6. TONE_PROFILE: prijateljski|poslovni|agresivni|previdni|odlašujoči
7. RED_FLAGS (3-5): sumljivi znaki
8. GREEN_FLAGS (3-5): pozitivni znaki zaupanja
9. RECOMMENDED_APPROACH: aggressive|firm|patient|walk_away
10. OPENING_TACTIC: kaj reči v prvem kontaktu (max 150 znakov)

Odgovori LE z JSON:
{
  "overall": "<desperate|motivated|neutral|reluctant|suspicious>",
  "urgency_pct": <number>,
  "deception_risk_pct": <number>,
  "motivation": "<max 100 znakov>",
  "leverage_pct": <number>,
  "tone_profile": "<prijateljski|poslovni|agresivni|previdni|odlašujoči>",
  "red_flags": ["<max 80 znakov>", "..."],
  "green_flags": ["<max 80 znakov>", "..."],
  "recommended_approach": "<aggressive|firm|patient|walk_away>",
  "opening_tactic": "<max 150 znakov>",
  "reasoning": "<max 200 znakov>"
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

    const sentiment = {
      overall: ['desperate', 'motivated', 'neutral', 'reluctant', 'suspicious'].includes(String(parsed?.overall))
        ? String(parsed.overall) : 'neutral',
      urgencyPct: Math.max(0, Math.min(100, Number(parsed?.urgency_pct ?? urgencyScore))),
      deceptionRiskPct: Math.max(0, Math.min(100, Number(parsed?.deception_risk_pct ?? deceptionScore))),
      motivation: String(parsed?.motivation ?? '').slice(0, 200),
      leveragePct: Math.max(0, Math.min(100, Number(parsed?.leverage_pct ?? leverageScore))),
      toneProfile: ['prijateljski', 'poslovni', 'agresivni', 'previdni', 'odlašujoči'].includes(String(parsed?.tone_profile))
        ? String(parsed.tone_profile) : 'poslovni',
      redFlags: (parsed?.red_flags || []).slice(0, 6).map((r: any) => String(r).slice(0, 200)),
      greenFlags: (parsed?.green_flags || []).slice(0, 6).map((g: any) => String(g).slice(0, 200)),
      recommendedApproach: ['aggressive', 'firm', 'patient', 'walk_away'].includes(String(parsed?.recommended_approach))
        ? String(parsed.recommended_approach) : 'firm',
      openingTactic: String(parsed?.opening_tactic ?? '').slice(0, 300),
      reasoning: String(parsed?.reasoning ?? '').slice(0, 400),
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
      sentiment,
      heuristics: {
        urgencyScore,
        deceptionScore,
        leverageScore,
        greenScore,
        detectedUrgency,
        detectedDeception,
        detectedLeverage,
        detectedGreen,
      },
      listing: listingInput,
      hasSellerMessage: !!sellerMessage,
    });
  } catch (e: any) {
    logger.error("/api/ai/sentiment-analysis", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
