// v6.21: AI Multi-Image Quality Assessor — oceni kakovost slik oglasa
// POST /api/ai/image-quality
// Body: { listingId?: string, imageUrl?: string }
// Returns: { ok, assessment: { overallScore, issues: [], recommendations: [], qualityFactors: {}, suggestedShots: [] } }

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
    const { listingId } = body;
    let imageUrl: string | null = body?.imageUrl ?? null;
    let title = '';
    let description = '';
    let detailDescription = '';
    let detailImages: string[] = [];

    if (listingId) {
      const listing = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: {
          title: true, description: true, detailDescription: true, imageUrl: true,
          detailImages: true, aiImageAnalysis: true, aiImageVerdict: true,
        },
      });
      if (!listing) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      title = listing.title;
      description = listing.description;
      detailDescription = listing.detailDescription || '';
      imageUrl = imageUrl || listing.imageUrl;
      // Parse detailImages JSON string
      try {
        if (listing.detailImages) {
          detailImages = JSON.parse(listing.detailImages);
          if (!Array.isArray(detailImages)) detailImages = [];
        }
      } catch {
        detailImages = [];
      }
    }

    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl ali listingId z sliko je obvezen' }, { status: 400 });
    }

    // Pridobi sliko za analizo
    let imageBase64: string | null = null;
    try {
      const { downloadImageAsBase64 } = await import('@/lib/ai');
      imageBase64 = await downloadImageAsBase64(imageUrl);
    } catch {
      // ignore
    }

    // 1. AI analiza kakovosti slike
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za fotografijo in e-commerce visual marketing.
Analiziraj kakovost slike oglasa in podaj predloge za izboljšave.

NASLOV OGLASA: ${title}
OPIS: ${description.slice(0, 400)}
URL SLIKE: ${imageUrl}
${imageBase64 ? 'SLIKA: pridobljena in priložena za vizualno analizo' : 'SLIKA: ni na voljo (samo URL)'}

Oceni naslednje vidike kakovosti slike (1-10):
1. LIGHTING (osvetlitev) — ali je dovolj svetla, enakomerna, brez senc?
2. COMPOSITION (kompozicija) — ali je item centriran, pravi kot?
3. BACKGROUND (ozadje) — ali je ozadje čisto, brez motenj?
4. FOCUS (ostrina) — ali je slika ostra, brez zameglitve?
5. COLOR_ACCURACY (barvna natančnost) — ali so barve realne?
6. RESOLUTION (ločljivost) — ali je dovolj visoka za podrobnosti?
7. ANGLE (kot) — ali je kot ustrezen za prikaz itema?
8. CLEANLINESS (čistoča) — ali je item čist na sliki?
9. CONTEXT (kontekst) — ali slika prikazuje item v uporabi?
10. SELLING_POTENTIAL (prodajni potencial) — ali slika prepriča kupca?

Identificiraj težave (issues):
- "low_light" — slaba osvetlitev
- "cluttered_background" — natrpano ozadje
- "blurry" — zamegljena slika
- "wrong_angle" — napačen kot
- "dirty_item" — umazan item
- "stock_photo" — stock fotografija (sumljivo)
- "watermark" — vodeni žig
- "low_resolution" — nizka ločljivost
- "no_context" — brez konteksta
- "wrong_color" — napačne barve

Priporočila za izboljšave:
- kaj dodati (več slik, drugačen kot, kontekst)
- kako popraviti (osvetlitev, ozadje, čiščenje)
- katere dodatkne slike potrebne (detalj, kontekst, video)

Strategija slik za Bolha/Vinted/Facebook:
- Glavna slika: item v naravni svetlobi, čisto ozadje
- Detalj 1: blagovna znamka/serijska številka
- Detalj 2: morebitne poškodbe (pošteno)
- Kontekst: item v uporabi
- Video (za premium): 360° vrtenje

Odgovori LE z JSON:
{
  "overall_score": <number 0-100>,
  "image_findings": "<kaj vidiš na sliki, max 200 znakov>",
  "quality_factors": {
    "lighting": <number 1-10>,
    "composition": <number 1-10>,
    "background": <number 1-10>,
    "focus": <number 1-10>,
    "color_accuracy": <number 1-10>,
    "resolution": <number 1-10>,
    "angle": <number 1-10>,
    "cleanliness": <number 1-10>,
    "context": <number 1-10>,
    "selling_potential": <number 1-10>
  },
  "issues": [
    {
      "type": "<low_light|cluttered_background|blurry|wrong_angle|dirty_item|stock_photo|watermark|low_resolution|no_context|wrong_color>",
      "severity": "<high|medium|low>",
      "description": "<max 80 znakov>",
      "fix": "<kako popraviti, max 80 znakov>"
    }
  ],
  "recommendations": [
    {
      "action": "<kaj narediti, max 100 znakov>",
      "impact": "<high|medium|low>",
      "estimated_value_increase_eur": <number>
    }
  ],
  "suggested_shots": [
    {
      "type": "<main|detail_brand|detail_damage|context|video>",
      "description": "<kaj pokazati, max 80 znakov>",
      "priority": "<high|medium|low>"
    }
  ],
  "platform_specific_advice": {
    "bolha": "<nasvet za Bolha, max 100 znakov>",
    "vinted": "<nasvet za Vinted, max 100 znakov>",
    "facebook": "<nasvet za Facebook, max 100 znakov>"
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

    const assessment = {
      overallScore: Math.max(0, Math.min(100, Number(parsed?.overall_score ?? 50))),
      imageFindings: String(parsed?.image_findings ?? '').slice(0, 400),
      qualityFactors: {
        lighting: Math.max(1, Math.min(10, Number(parsed?.quality_factors?.lighting ?? 5))),
        composition: Math.max(1, Math.min(10, Number(parsed?.quality_factors?.composition ?? 5))),
        background: Math.max(1, Math.min(10, Number(parsed?.quality_factors?.background ?? 5))),
        focus: Math.max(1, Math.min(10, Number(parsed?.quality_factors?.focus ?? 5))),
        colorAccuracy: Math.max(1, Math.min(10, Number(parsed?.quality_factors?.color_accuracy ?? 5))),
        resolution: Math.max(1, Math.min(10, Number(parsed?.quality_factors?.resolution ?? 5))),
        angle: Math.max(1, Math.min(10, Number(parsed?.quality_factors?.angle ?? 5))),
        cleanliness: Math.max(1, Math.min(10, Number(parsed?.quality_factors?.cleanliness ?? 5))),
        context: Math.max(1, Math.min(10, Number(parsed?.quality_factors?.context ?? 5))),
        sellingPotential: Math.max(1, Math.min(10, Number(parsed?.quality_factors?.selling_potential ?? 5))),
      },
      issues: (parsed?.issues || []).slice(0, 10).map((i: any) => ({
        type: String(i?.type ?? '').slice(0, 50),
        severity: ['high', 'medium', 'low'].includes(String(i?.severity)) ? String(i.severity) : 'medium',
        description: String(i?.description ?? '').slice(0, 200),
        fix: String(i?.fix ?? '').slice(0, 200),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 8).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 250),
        impact: ['high', 'medium', 'low'].includes(String(r?.impact)) ? String(r.impact) : 'medium',
        estimatedValueIncreaseEur: Math.max(0, Number(r?.estimated_value_increase_eur ?? 0)),
      })),
      suggestedShots: (parsed?.suggested_shots || []).slice(0, 6).map((s: any) => ({
        type: ['main', 'detail_brand', 'detail_damage', 'context', 'video'].includes(String(s?.type))
          ? String(s.type) : 'main',
        description: String(s?.description ?? '').slice(0, 200),
        priority: ['high', 'medium', 'low'].includes(String(s?.priority)) ? String(s.priority) : 'medium',
      })),
      platformSpecificAdvice: {
        bolha: String(parsed?.platform_specific_advice?.bolha ?? '').slice(0, 250),
        vinted: String(parsed?.platform_specific_advice?.vinted ?? '').slice(0, 250),
        facebook: String(parsed?.platform_specific_advice?.facebook ?? '').slice(0, 250),
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
      assessment,
      imageUrl,
      hasImageBase64: !!imageBase64,
      totalImages: detailImages.length + 1,
    });
  } catch (e: any) {
    logger.error("/api/ai/image-quality", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
