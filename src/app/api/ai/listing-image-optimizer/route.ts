// v6.47: AI Listing Image Optimizer — VLM analiza slik + priporočila za better photos
// POST /api/ai/listing-image-optimizer
// Body: { listingId?: string, tradeId?: string, imageUrl?: string }
// Returns: { ok, optimizer: { analysis, currentImages, suggestedShots, improvements, editingTips, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

interface ImageInfo {
  url: string;
  type: 'primary' | 'secondary' | 'detail';
  analysis?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId } = body;
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const bodyImageUrl = body?.imageUrl;

    let title = '';
    let description = '';
    let category = '';
    let images: ImageInfo[] = [];
    let estValue = 0;

    if (tradeId) {
      const trade = await db.trade.findUnique({
        where: { id: tradeId },
        select: {
          title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, imageUrl: true, detailImages: true, aiEstimatedValue: true } },
        },
      });
      if (!trade) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
      title = trade.title;
      category = trade.category || '';
      description = (trade.listing?.detailDescription || trade.listing?.description || '').slice(0, 300);
      estValue = trade.listing?.aiEstimatedValue ?? Math.round(trade.buyPrice * 1.25);

      if (trade.listing?.imageUrl) images.push({ url: trade.listing.imageUrl, type: 'primary' });
      try {
        if (trade.listing?.detailImages) {
          const extra = JSON.parse(trade.listing.detailImages);
          if (Array.isArray(extra)) {
            extra.slice(0, 5).forEach((url: string, idx: number) => {
              images.push({ url, type: idx === 0 ? 'secondary' : 'detail' });
            });
          }
        }
      } catch {}
    } else if (listingId) {
      const listing = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: {
          title: true, description: true, detailDescription: true, imageUrl: true,
          detailImages: true, aiImageAnalysis: true, aiEstimatedValue: true,
        },
      });
      if (!listing) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      title = listing.title;
      description = (listing.detailDescription || listing.description || '').slice(0, 300);
      estValue = listing.aiEstimatedValue ?? 0;
      if (listing.imageUrl) images.push({ url: listing.imageUrl, type: 'primary', analysis: listing.aiImageAnalysis ?? undefined });
      try {
        if (listing.detailImages) {
          const extra = JSON.parse(listing.detailImages);
          if (Array.isArray(extra)) {
            extra.slice(0, 5).forEach((url: string, idx: number) => {
              images.push({ url, type: idx === 0 ? 'secondary' : 'detail' });
            });
          }
        }
      } catch {}
    } else if (bodyImageUrl) {
      images.push({ url: String(bodyImageUrl), type: 'primary' });
      title = body?.title ? String(body.title) : 'Neznan item';
    } else {
      // Pridobi held trade z slikami
      const trade = await db.trade.findFirst({
        where: { status: 'held', listing: { imageUrl: { not: null } } },
        orderBy: { buyDate: 'desc' },
        select: {
          title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, imageUrl: true, detailImages: true, aiEstimatedValue: true } },
        },
      });
      if (!trade) return NextResponse.json({ ok: true, optimizer: null, message: 'Ni slik za analizo.' });
      title = trade.title;
      category = trade.category || '';
      description = (trade.listing?.detailDescription || trade.listing?.description || '').slice(0, 300);
      estValue = trade.listing?.aiEstimatedValue ?? Math.round(trade.buyPrice * 1.25);
      if (trade.listing?.imageUrl) images.push({ url: trade.listing.imageUrl, type: 'primary' });
      try {
        if (trade.listing?.detailImages) {
          const extra = JSON.parse(trade.listing.detailImages);
          if (Array.isArray(extra)) {
            extra.slice(0, 5).forEach((url: string, idx: number) => {
              images.push({ url, type: idx === 0 ? 'secondary' : 'detail' });
            });
          }
        }
      } catch {}
    }

    if (images.length === 0) {
      return NextResponse.json({ ok: true, optimizer: null, message: 'Ni najdenih slik za optimizacijo.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const imagesStr = images.slice(0, 6).map((img, idx) =>
      `- ${idx + 1}. ${img.type.toUpperCase()} | ${img.url}${img.analysis ? ` | prejšnja analiza: ${img.analysis.slice(0, 100)}` : ''}`
    ).join('\n');

    const prompt = `Si AI listing image optimizer z VLM (vision-language model) ekspertizo.
Analiziraj slike oglasa in predlagaj izboljšave za večjo konverzijo.

OGLAS:
- Naslov: "${title}"
- Kategorija: ${category || 'nepoznano'}
- Opis: ${description}
- Est. vrednost: ${estValue}€

SLIKE (${images.length}):
${imagesStr}

Slikovna pravila za uspešen oglas:
1. GLAVNA SLIKA: čista, dobro osvetljena, ozadje brez motenj, item v sredini
2. KOTI: vsaj 3-4 različni koti (spredaj, stranski, zadaj, od zgoraj)
3. DETAJLI: close-up na pomembne dele (blagovna znamka, poškodbe, certifikati)
4. KONTEKST: item v uporabi (npr. telefon v roki, kolo na cesti)
6. STANJE: jasno pokazi stanje (nova, rabljena, s poškodbami)
7. RAZMERJE: 4:3 ali 1:1 (kvadratno za Bolha, 1.91:1 za Facebook)
8. LOČLJIVOST: minimum 1000x1000px za zoom
9. OSVETLJENJE: naravna svetloba, brez bleščanja, brez senc
10. OZADJE: enobarvno (belo/sivo) ali kontekstualno (soba za pohištvo)

Pogoste težave na slikah:
- Slaba osvetlitev (pretemno, bleščanje)
- Nered v ozadju
- Item premajhen v sliki
- Slika zamegljena
- Samo 1 slika (potrebnih vsaj 5)
- Brez detajlnih posnetkov stanja
- Stock photo namesto realne slike
- Vodni žig ali logotip prek itema

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "analysis": {
    "overall_score": <number 0-100>,
    "primary_image_score": <number 0-100>,
    "image_count_score": <number 0-100>,
    "quality_score": <number 0-100>,
    "composition_score": <number 0-100>,
    "lighting_score": <number 0-100>,
    "background_score": <number 0-100>,
    "detail_coverage_score": <number 0-100>,
    "issues_found": ["<max 100 znakov>"],
    "strengths": ["<max 100 znakov>"]
  },
  "current_images": [
    { "url": "<url>", "type": "<primary|secondary|detail>", "score": <number 0-100>, "issues": ["<max 80 znakov>"], "improvement": "<max 150 znakov>" }
  ],
  "suggested_shots": [
    { "shot_type": "<primary|angle_left|angle_right|back|top|detail_brand|detail_damage|context|accessories|size_reference>", "description": "<max 120 znakov>", "priority": "<high|medium|low>", "expected_impact_pct": <number>, "how_to_shoot": "<max 150 znakov>" }
  ],
  "improvements": [
    { "category": "<lighting|background|composition|angle|detail|context|editing>", "issue": "<max 100 znakov>", "fix": "<max 200 znakov>", "expected_views_increase_pct": <number>, "effort": "<low|medium|high>" }
  ],
  "editing_tips": [
    { "tip": "<max 150 znakov>", "tool": "<snapseed|lightroom|photoshop|canva|phone_default>", "step_by_step": "<max 200 znakov>", "expected_impact": "<max 80 znakov>" }
  ],
  "summary": {
    "current_image_quality_score": <number 0-100>,
    "optimized_image_quality_score": <number 0-100>,
    "expected_views_increase_pct": <number>,
    "expected_inquiries_increase_pct": <number>,
    "expected_sale_speedup_days": <number>,
    "images_needed": <number>,
    "images_current": <number>,
    "biggest_issue": "<max 100 znakov>",
    "quickest_fix": "<max 100 znakov>",
    "image_optimization_score": <number 0-100>
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
    const validUrls = new Set(images.map(i => i.url));

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      analysis: {
        overallScore: Math.max(0, Math.min(100, Number(parsed?.analysis?.overall_score ?? 50))),
        primaryImageScore: Math.max(0, Math.min(100, Number(parsed?.analysis?.primary_image_score ?? 50))),
        imageCountScore: Math.max(0, Math.min(100, Number(parsed?.analysis?.image_count_score ?? 50))),
        qualityScore: Math.max(0, Math.min(100, Number(parsed?.analysis?.quality_score ?? 50))),
        compositionScore: Math.max(0, Math.min(100, Number(parsed?.analysis?.composition_score ?? 50))),
        lightingScore: Math.max(0, Math.min(100, Number(parsed?.analysis?.lighting_score ?? 50))),
        backgroundScore: Math.max(0, Math.min(100, Number(parsed?.analysis?.background_score ?? 50))),
        detailCoverageScore: Math.max(0, Math.min(100, Number(parsed?.analysis?.detail_coverage_score ?? 50))),
        issuesFound: (parsed?.analysis?.issues_found || []).slice(0, 8).map((i: any) => String(i).slice(0, 200)),
        strengths: (parsed?.analysis?.strengths || []).slice(0, 8).map((s: any) => String(s).slice(0, 200)),
      },
      currentImages: (parsed?.current_images || [])
        .filter((img: any) => validUrls.has(String(img?.url ?? '')))
        .slice(0, 6)
        .map((img: any) => ({
          url: String(img?.url ?? '').slice(0, 500),
          type: ['primary', 'secondary', 'detail'].includes(String(img?.type)) ? String(img.type) : 'primary',
          score: Math.max(0, Math.min(100, Number(img?.score ?? 50))),
          issues: (img?.issues || []).slice(0, 5).map((i: any) => String(i).slice(0, 150)),
          improvement: String(img?.improvement ?? '').slice(0, 300),
        })),
      suggestedShots: (parsed?.suggested_shots || []).slice(0, 10).map((s: any) => ({
        shotType: ['primary', 'angle_left', 'angle_right', 'back', 'top', 'detail_brand', 'detail_damage', 'context', 'accessories', 'size_reference'].includes(String(s?.shot_type)) ? String(s.shot_type) : 'primary',
        description: String(s?.description ?? '').slice(0, 250),
        priority: ['high', 'medium', 'low'].includes(String(s?.priority)) ? String(s.priority) : 'medium',
        expectedImpactPct: Math.round(Number(s?.expected_impact_pct ?? 0)),
        howToShoot: String(s?.how_to_shoot ?? '').slice(0, 300),
      })),
      improvements: (parsed?.improvements || []).slice(0, 8).map((im: any) => ({
        category: ['lighting', 'background', 'composition', 'angle', 'detail', 'context', 'editing'].includes(String(im?.category)) ? String(im.category) : 'editing',
        issue: String(im?.issue ?? '').slice(0, 200),
        fix: String(im?.fix ?? '').slice(0, 400),
        expectedViewsIncreasePct: Math.round(Number(im?.expected_views_increase_pct ?? 0)),
        effort: ['low', 'medium', 'high'].includes(String(im?.effort)) ? String(im.effort) : 'medium',
      })),
      editingTips: (parsed?.editing_tips || []).slice(0, 6).map((t: any) => ({
        tip: String(t?.tip ?? '').slice(0, 300),
        tool: ['snapseed', 'lightroom', 'photoshop', 'canva', 'phone_default'].includes(String(t?.tool)) ? String(t.tool) : 'phone_default',
        stepByStep: String(t?.step_by_step ?? '').slice(0, 400),
        expectedImpact: String(t?.expected_impact ?? '').slice(0, 150),
      })),
      summary: {
        currentImageQualityScore: Math.max(0, Math.min(100, Number(parsed?.summary?.current_image_quality_score ?? 50))),
        optimizedImageQualityScore: Math.max(0, Math.min(100, Number(parsed?.summary?.optimized_image_quality_score ?? 75))),
        expectedViewsIncreasePct: Math.round(Number(parsed?.summary?.expected_views_increase_pct ?? 30)),
        expectedInquiriesIncreasePct: Math.round(Number(parsed?.summary?.expected_inquiries_increase_pct ?? 25)),
        expectedSaleSpeedupDays: Math.round(Number(parsed?.summary?.expected_sale_speedup_days ?? 5)),
        imagesNeeded: Math.max(0, Number(parsed?.summary?.images_needed ?? 5)),
        imagesCurrent: images.length,
        biggestIssue: String(parsed?.summary?.biggest_issue ?? '').slice(0, 200),
        quickestFix: String(parsed?.summary?.quickest_fix ?? '').slice(0, 200),
        imageOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.image_optimization_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
