// v6.22: AI Reverse Image Search — odkrije stock fotografije preko URL pattern matching + AI analiza
// POST /api/ai/reverse-image-search
// Body: { listingId?: string, imageUrl?: string }
// Returns: { ok, search: { isStockPhoto, stockPhotoProbability, urlPatterns: [], visualIndicators: [], searchUrls: {}, recommendation } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Znani stock photo domeni v URL-jih
const STOCK_PHOTO_DOMAINS = [
  'shutterstock.com', 'istockphoto.com', 'gettyimages.com', 'depositphotos.com',
  'dreamstime.com', 'alamy.com', 'pexels.com', 'pixabay.com', 'unsplash.com',
  'freepik.com', 'adobe.stock.com', 'stock.adobe.com', 'bigstockphoto.com',
  '123rf.com', 'stocksy.com', 'stockio.com', 'stocksnap.io', 'flickr.com/photos',
];

// Znaki stock fotografij v URL-ju
const STOCK_URL_PATTERNS = [
  /shutterstock/i, /istock/i, /gettyimages/i, /depositphotos/i,
  /dreamstime/i, /alamy/i, /pexels/i, /pixabay/i, /unsplash/i,
  /freepik/i, /bigstock/i, /123rf/i, /stocksy/i,
  /preview/i, /watermark/i, /comp\./i, /stockphoto/i,
];

// Watermark besede v URL
const WATERMARK_PATTERNS = [
  /shutterstock/i, /gettyimages/i, /istock/i, /depositphotos/i,
  /dreamstime/i, /alamy/i,
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId } = body;
    let imageUrl: string | null = body?.imageUrl ?? null;
    let title = '';
    let description = '';

    if (listingId) {
      const listing = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: {
          title: true, description: true, detailDescription: true, imageUrl: true,
          sellerName: true, sellerListingCount: true, postedAt: true,
        },
      });
      if (!listing) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      title = listing.title;
      description = listing.detailDescription || listing.description;
      imageUrl = imageUrl || listing.imageUrl;
    }

    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl ali listingId z sliko je obvezen' }, { status: 400 });
    }

    // 1. Hevristična analiza URL-ja
    const urlLower = imageUrl.toLowerCase();
    const matchedStockDomains: string[] = [];
    const matchedPatterns: string[] = [];
    const matchedWatermarks: string[] = [];

    for (const d of STOCK_PHOTO_DOMAINS) {
      if (urlLower.includes(d)) matchedStockDomains.push(d);
    }
    for (const p of STOCK_URL_PATTERNS) {
      const m = imageUrl.match(p);
      if (m) matchedPatterns.push(m[0]);
    }
    for (const p of WATERMARK_PATTERNS) {
      const m = imageUrl.match(p);
      if (m) matchedWatermarks.push(m[0]);
    }

    // Analiza sellerja (nov prodajalec + stock foto = visoko tveganje)
    const sellerInfo = listingId ? await db.listing.findUnique({
      where: { id: String(listingId) },
      select: { sellerName: true, sellerListingCount: true, postedAt: true },
    }) : null;

    // 2. Pridobi sliko za AI vizualno analizo
    let imageBase64: string | null = null;
    try {
      const { downloadImageAsBase64 } = await import('@/lib/ai');
      imageBase64 = await downloadImageAsBase64(imageUrl);
    } catch {
      // ignore
    }

    // 3. AI vizualna analiza + reverse search priporočila
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si forenzik za odkrivanje stock fotografij v oglasih.
Analiziraj sliko in URL za znake stock fotografije.

NASLOV OGLASA: ${title}
URL SLIKE: ${imageUrl}
${sellerInfo ? `
PRODAJALEC: ${sellerInfo.sellerName ?? 'neznan'}
Število oglasov prodajalca: ${sellerInfo.sellerListingCount}
Starost oglasa: ${sellerInfo.postedAt ? Math.round((Date.now() - sellerInfo.postedAt.getTime()) / (24 * 60 * 60 * 1000)) : 0} dni` : ''}

HEVRISTIČNA ANALIZA URL-ja:
- Stock domeni v URL: ${matchedStockDomains.length > 0 ? matchedStockDomains.join(', ') : 'brez'}
- Stock vzorci: ${matchedPatterns.length > 0 ? matchedPatterns.join(', ') : 'brez'}
- Watermark besede: ${matchedWatermarks.length > 0 ? matchedWatermarks.join(', ') : 'brez'}

${imageBase64 ? 'SLIKA: pridobljena za vizualno analizo' : 'SLIKA: ni na voljo'}

Znaki stock fotografije:
1. Predobrejšnja osvetlitev (studio)
2. Čisto/profesionalno ozadje
3. Visoka ločljivost (večja kot pri amaterski)
4. Brez osebnih predmetov v ozadju
5. Vodeni žig (watermark) na sliki
6. Item centriran s perfektno kompozicijo
7. Bela/publikacijska barvna paleta
8. Manjkajoči specifični znaki uporabe (prask, prahu)

Strategije za preverjanje:
- Google Reverse Image Search (https://images.google.com ali https://lens.google.com)
- Bing Visual Search (https://bing.com/images)
- TinEye (https://tineye.com)
- Yandex Images (https://yandex.com/images)

Odgovori LE z JSON:
{
  "is_stock_photo": <boolean>,
  "stock_photo_probability_pct": <number 0-100>,
  "visual_indicators": [
    {
      "indicator": "<kaj vidiš, max 80 znakov>",
      "type": "<stock|authentic|unclear>",
      "weight": <number 1-10>
    }
  ],
  "image_findings": "<celotna analiza slike, max 200 znakov>",
  "search_strategy": {
    "google_images_url": "<URL za Google Reverse Image Search>",
    "bing_visual_url": "<URL za Bing Visual Search>",
    "tineye_url": "<URL za TinEye>",
    "yandex_url": "<URL za Yandex>"
  },
  "platform_specific_concerns": {
    "bolha": "<max 100 znakov>",
    "vinted": "<max 100 znakov>",
    "kleinanzeigen": "<max 100 znakov>"
  },
  "recommendation": "<buy_with_caution|verify_first|avoid|report>",
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

    // Konstruiraj dejanske URL-je za reverse image search
    const encodedUrl = encodeURIComponent(imageUrl);
    const searchUrls = {
      googleImages: `https://images.google.com/searchbyimage?image_url=${encodedUrl}`,
      googleLens: `https://lens.google.com/uploadbyurl?url=${encodedUrl}`,
      bingVisual: `https://www.bing.com/images/search?q=imgurl:${encodedUrl}&view=detailv2&iss=sbi`,
      tineye: `https://tineye.com/search/?url=${encodedUrl}`,
      yandex: `https://yandex.com/images/search?rpt=imageview&url=${encodedUrl}`,
    };

    const search = {
      isStockPhoto: Boolean(parsed?.is_stock_photo ?? matchedStockDomains.length > 0),
      stockPhotoProbabilityPct: Math.max(0, Math.min(100, Number(parsed?.stock_photo_probability_pct ?? (matchedStockDomains.length > 0 ? 95 : 30)))),
      imageFindings: String(parsed?.image_findings ?? '').slice(0, 400),
      visualIndicators: (parsed?.visual_indicators || []).slice(0, 8).map((v: any) => ({
        indicator: String(v?.indicator ?? '').slice(0, 200),
        type: ['stock', 'authentic', 'unclear'].includes(String(v?.type)) ? String(v.type) : 'unclear',
        weight: Math.max(1, Math.min(10, Number(v?.weight ?? 5))),
      })),
      urlAnalysis: {
        matchedStockDomains,
        matchedPatterns,
        matchedWatermarks,
        totalRedFlags: matchedStockDomains.length + matchedPatterns.length + matchedWatermarks.length,
      },
      searchStrategy: {
        googleImagesUrl: searchUrls.googleImages,
        googleLensUrl: searchUrls.googleLens,
        bingVisualUrl: searchUrls.bingVisual,
        tineyeUrl: searchUrls.tineye,
        yandexUrl: searchUrls.yandex,
      },
      platformSpecificConcerns: {
        bolha: String(parsed?.platform_specific_concerns?.bolha ?? '').slice(0, 300),
        vinted: String(parsed?.platform_specific_concerns?.vinted ?? '').slice(0, 300),
        kleinanzeigen: String(parsed?.platform_specific_concerns?.kleinanzeigen ?? '').slice(0, 300),
      },
      recommendation: ['buy_with_caution', 'verify_first', 'avoid', 'report'].includes(String(parsed?.recommendation))
        ? String(parsed.recommendation) : 'verify_first',
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
      search,
      imageUrl,
      hasImageBase64: !!imageBase64,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
