// v6.22 / v8.96.1-batch2: AI Reverse Image Search — odkrije stock fotografije preko URL pattern matching + AI analiza
// Refaktoriran z withAiRoute helperjem (v8.96.1) + enforceBudget guard.
//
// POST /api/ai/reverse-image-search
// Body: { listingId?: string, imageUrl?: string }
// Returns: { ok, search: { isStockPhoto, stockPhotoProbability, urlPatterns: [], visualIndicators: [], searchUrls: {}, recommendation } }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface ReverseImageSearchInput {
  listingId: string | null;
  imageUrl: string | null;
}

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

export const POST = withAiRoute<ReverseImageSearchInput>({
  endpoint: '/api/ai/reverse-image-search',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      listingId: body?.listingId ? String(body.listingId) : null,
      imageUrl: body?.imageUrl ? String(body.imageUrl) : null,
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { listingId } = input;
    let imageUrl: string | null = input.imageUrl;
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
      if (!listing) throw new ApiRouteError('Listing ne obstaja', 404);
      title = listing.title;
      description = listing.detailDescription || listing.description;
      imageUrl = imageUrl || listing.imageUrl;
    }

    if (!imageUrl) {
      return apiBadRequest('imageUrl ali listingId z sliko je obvezen');
    }

    // 1. Hevristična analiza URL-ja
    const { matchedStockDomains, matchedPatterns, matchedWatermarks } = analyzeUrlHeuristics(imageUrl);

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
      /* ignore */
    }

    // 3. AI vizualna analiza + reverse search priporočila
    const prompt = buildPrompt({
      title,
      imageUrl,
      sellerInfo,
      matchedStockDomains,
      matchedPatterns,
      matchedWatermarks,
      imageBase64,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    // Konstruiraj dejanske URL-je za reverse image search
    const search = transformSearch(parsed, matchedStockDomains, matchedPatterns, matchedWatermarks, imageUrl);

    return apiOk({
      ok: true,
      search,
      imageUrl,
      hasImageBase64: !!imageBase64,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface SellerInfo {
  sellerName: string | null;
  sellerListingCount: number | null;
  postedAt: Date | null;
}

interface PromptData {
  title: string;
  imageUrl: string;
  sellerInfo: SellerInfo | null;
  matchedStockDomains: string[];
  matchedPatterns: string[];
  matchedWatermarks: string[];
  imageBase64: string | null;
}

function analyzeUrlHeuristics(imageUrl: string): {
  matchedStockDomains: string[];
  matchedPatterns: string[];
  matchedWatermarks: string[];
} {
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
  return { matchedStockDomains, matchedPatterns, matchedWatermarks };
}

function buildPrompt(d: PromptData): string {
  return `Si forenzik za odkrivanje stock fotografij v oglasih.
Analiziraj sliko in URL za znake stock fotografije.

NASLOV OGLASA: ${d.title}
URL SLIKE: ${d.imageUrl}
${d.sellerInfo ? `
PRODAJALEC: ${d.sellerInfo.sellerName ?? 'neznan'}
Število oglasov prodajalca: ${d.sellerInfo.sellerListingCount}
Starost oglasa: ${d.sellerInfo.postedAt ? Math.round((Date.now() - d.sellerInfo.postedAt.getTime()) / (24 * 60 * 60 * 1000)) : 0} dni` : ''}

HEVRISTIČNA ANALIZA URL-ja:
- Stock domeni v URL: ${d.matchedStockDomains.length > 0 ? d.matchedStockDomains.join(', ') : 'brez'}
- Stock vzorci: ${d.matchedPatterns.length > 0 ? d.matchedPatterns.join(', ') : 'brez'}
- Watermark besede: ${d.matchedWatermarks.length > 0 ? d.matchedWatermarks.join(', ') : 'brez'}

${d.imageBase64 ? 'SLIKA: pridobljena za vizualno analizo' : 'SLIKA: ni na voljo'}

Znaki stock fotografije:
1. Predorejšnja osvetlitev (studio)
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
}

function transformSearch(
  parsed: any,
  matchedStockDomains: string[],
  matchedPatterns: string[],
  matchedWatermarks: string[],
  imageUrl: string,
): {
  isStockPhoto: boolean;
  stockPhotoProbabilityPct: number;
  imageFindings: string;
  visualIndicators: Array<{ indicator: string; type: string; weight: number }>;
  urlAnalysis: {
    matchedStockDomains: string[];
    matchedPatterns: string[];
    matchedWatermarks: string[];
    totalRedFlags: number;
  };
  searchStrategy: {
    googleImagesUrl: string;
    googleLensUrl: string;
    bingVisualUrl: string;
    tineyeUrl: string;
    yandexUrl: string;
  };
  platformSpecificConcerns: { bolha: string; vinted: string; kleinanzeigen: string };
  recommendation: string;
  reasoning: string;
} {
  const encodedUrl = encodeURIComponent(imageUrl);
  const searchUrls = {
    googleImages: `https://images.google.com/searchbyimage?image_url=${encodedUrl}`,
    googleLens: `https://lens.google.com/uploadbyurl?url=${encodedUrl}`,
    bingVisual: `https://www.bing.com/images/search?q=imgurl:${encodedUrl}&view=detailv2&iss=sbi`,
    tineye: `https://tineye.com/search/?url=${encodedUrl}`,
    yandex: `https://yandex.com/images/search?rpt=imageview&url=${encodedUrl}`,
  };

  return {
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
}
