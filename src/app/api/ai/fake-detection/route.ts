// v6.21 / v8.95.9-other-medium: AI Listing Fake Detection — zazna ponaredke luksuznih izdelkov z vizualno analizo
// Refaktoriran z withAiRoute helperjem (v8.95.9) + enforceBudget guard.
//
// POST /api/ai/fake-detection
// Body: { listingId?: string, imageUrl?: string, brand?: string }
// Returns: { ok, detection: { authenticityScore, isLikelyFake, fakeProbability, indicators: [], verificationSteps: [], brandSpecificChecks: [], recommendation } }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// Slovar luksuznih blagovnih znamk z značilnimi znaki pristnosti
const BRAND_AUTHENTICITY_CHECKS: Record<string, { patterns: string[]; knownIssues: string[]; keyFeatures: string[] }> = {
  'gucci': {
    patterns: ['gucci', 'double g', 'gg marmont', 'ophidia', 'marmont'],
    knownIssues: ['Napačen font GG logotipa', 'Slaba kakovost šivov', 'Manjkajoči serijski žig', 'Napačna barva podstavka'],
    keyFeatures: ['GG logotip simetričen', 'Serijska številka na hrbtni strani', 'Made in Italy žig', 'Originalna blagovna torbica'],
  },
  'prada': {
    patterns: ['prada', 'reo nylon', 'galleria'],
    knownIssues: ['Napačen material (ne pravi Re-Nylon)', 'Manjkajoči certifikat', 'Slaba kovina hardverja'],
    keyFeatures: ['Prada Re-Nylon material', 'Trojna kartica (certifikat)', 'Made in Italy', 'Kovinski hardver z napisom Prada'],
  },
  'louis vuitton': {
    patterns: ['louis vuitton', 'lv', 'monogram', 'damier', 'neverfull', 'speedy'],
    knownIssues: ['Napačni LV monogrami (rezani)', 'Slaba kakovost usnja', 'Manjkajoči date code', 'Napačna postavitev vzorca'],
    keyFeatures: ['LV monogrami simetrični (rezani na sredini)', 'Date code (ne serial number)', 'Made in France/Spain/USA', 'Varnostna nit v šivih'],
  },
  'rolex': {
    patterns: ['rolex', 'submariner', 'datejust', 'gmt master', 'daytona'],
    knownIssues: ['Napačna teža (prelahka)', 'Slabo premikajoča se sekundna minutna roka', 'Manjkajoči hologram', 'Napačen font'],
    keyFeatures: ['Teža (rolcraft je težak)', 'Sekunda drsi gladko (ne tiktaka)', 'Cyclops lens nad datumom (2.5x)', 'Serijska številka med lugs'],
  },
  'iphone': {
    patterns: ['iphone', 'apple', 'ios'],
    knownIssues: ['Napačna barva True Tone flash', 'Manjkajoči IMEI v Settings', 'Slaba kakovost zaslona (LCD namesto OLED)', 'Napačni font v Settings'],
    keyFeatures: ['IMEI v Settings > General > About', 'True Tone flash med camera', 'Original polnilec in kabel', 'Apple logotip na hrbtni strani (pravi centriran)'],
  },
  'samsung galaxy': {
    patterns: ['samsung', 'galaxy', 's21', 's22', 's23', 's24'],
    knownIssues: ['Napačna SAR vrednost', 'Slaba kakovost zaslona', 'Manjkajoči IMEI'],
    keyFeatures: ['IMEI v Settings > About phone', 'Samsung Knox warranty bit', 'Original polnilec', 'Samsung logotip na hrbtni strani'],
  },
  'sony playstation': {
    patterns: ['playstation', 'ps5', 'ps4', 'sony'],
    knownIssues: ['Manjkajoči serial number', 'Napačna teža', 'Slaba kakovost plastike'],
    keyFeatures: ['Serial number na dnu', 'Sony logotip', 'Original kabel HDMI', 'Original USB kabel'],
  },
};

interface FakeDetectionInput {
  listingId: string | null;
  imageUrl: string | null;
  brand: string | null;
}

export const POST = withAiRoute<FakeDetectionInput>({
  endpoint: '/api/ai/fake-detection',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const { listingId } = body;
    const imageUrl: string | null = body?.imageUrl ?? null;
    const brandInput: string | null = body?.brand ?? null;
    return {
      listingId: listingId ? String(listingId) : null,
      imageUrl,
      brand: brandInput,
    };
  },

  // No validateInput — validation se zgodi v handler-ju (odvisno od listingId/imageUrl)
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { listingId, brand: brandInput } = input;
    let imageUrl = input.imageUrl;
    let title = '';
    let description = '';
    let detailDescription = '';

    if (listingId) {
      const listing = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: {
          title: true, description: true, detailDescription: true, imageUrl: true,
          sellerName: true, sellerListingCount: true, postedAt: true,
          aiImageAnalysis: true, aiImageVerdict: true, aiRisk: true,
        },
      });
      if (!listing) throw new ApiRouteError('Listing ne obstaja', 404);
      title = listing.title;
      description = listing.description;
      detailDescription = listing.detailDescription || '';
      imageUrl = imageUrl || listing.imageUrl;
    }

    if (!imageUrl) {
      throw new ApiRouteError('imageUrl ali listingId z sliko je obvezen', 400);
    }

    // 1. Identificiraj blagovno znamko iz naslova/opisa
    const fullText = `${title} ${description} ${detailDescription}`.toLowerCase();
    const { detectedBrand, brandChecks } = detectBrand(fullText, brandInput);

    // 2. Pridobi sliko
    let imageBase64: string | null = null;
    try {
      const { downloadImageAsBase64 } = await import('@/lib/ai');
      imageBase64 = await downloadImageAsBase64(imageUrl);
    } catch {
      // ignore
    }

    // 3. AI fake detection
    const prompt = buildPrompt({ title, description, detailDescription, imageUrl, detectedBrand, brandChecks, imageBase64 });

    const raw = await callAi(prompt);

    const parsed: any = parseAi(raw);

    const detection = transformDetection(parsed, detectedBrand);

    return apiOk({
      ok: true,
      detection,
      hasImageBase64: !!imageBase64,
      brandChecksAvailable: !!brandChecks,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function detectBrand(fullText: string, brandInput: string | null): {
  detectedBrand: string | null;
  brandChecks: { patterns: string[]; knownIssues: string[]; keyFeatures: string[] } | null;
} {
  let detectedBrand: string | null = null;
  let brandChecks: { patterns: string[]; knownIssues: string[]; keyFeatures: string[] } | null = null;

  for (const [brand, checks] of Object.entries(BRAND_AUTHENTICITY_CHECKS)) {
    if (checks.patterns.some(p => fullText.includes(p.toLowerCase()))) {
      detectedBrand = brand;
      brandChecks = checks;
      break;
    }
  }
  if (brandInput) {
    const lower = brandInput.toLowerCase();
    for (const [brand, checks] of Object.entries(BRAND_AUTHENTICITY_CHECKS)) {
      if (lower.includes(brand)) {
        detectedBrand = brand;
        brandChecks = checks;
        break;
      }
    }
  }

  return { detectedBrand, brandChecks };
}

interface PromptData {
  title: string;
  description: string;
  detailDescription: string;
  imageUrl: string;
  detectedBrand: string | null;
  brandChecks: { patterns: string[]; knownIssues: string[]; keyFeatures: string[] } | null;
  imageBase64: string | null;
}

function buildPrompt(d: PromptData): string {
  return `Si forenzik za prepoznavanje ponaredkov luksuznih blagovnih znamk in elektronske opreme.
Analiziraj oglas in sliko za znake ponarejanja.

NASLOV: ${d.title}
OPIS: ${(d.detailDescription || d.description).slice(0, 800)}
URL SLIKE: ${d.imageUrl}
${d.detectedBrand ? `ZAZNANA ZNAMKA: ${d.detectedBrand}` : 'ZNAMKA: neznan'}
${d.brandChecks ? `
ZNANI ZNAKI PONAREJANJA ZA ${d.detectedBrand}: ${d.brandChecks.knownIssues.join(', ')}
KLJUČNI ZNAKI PRAISTNOSTI: ${d.brandChecks.keyFeatures.join(', ')}` : ''}
${d.imageBase64 ? 'SLIKA: pridobljena za vizualno analizo' : 'SLIKA: ni na voljo'}

Splošni znaki ponarejkov:
1. Stock fotografija namesto realne (Google reverse image search)
2. Vodeni žig (watermark) iz drugega spletišča
3. Predolgo ozadje ali profesionalna fotostudio
4. Manjkajoči certifikati/kartice v opisu
5. Prodajalec nov (0-2 oglasi) in prodaja visokovredne znamke
6. Cena močno pod tržno (>30% popust za luxury)
7. "Iz Kitajske" shipping
8. Slaba slovnica v opisu (prevodi)

Specifično za znamke:
- LV: monogrami morajo biti simetrični, date code (ne serial)
- Rolex: teža, gladka sekunda, cyclops lens
- iPhone: IMEI v Settings, True Tone, original Apple logotip
- Gucci: GG simetričen, serial, Made in Italy
- Prada: Re-Nylon material, trojna kartica

Odgovori LE z JSON:
{
  "authenticity_score": <number 0-100, višje = bolj verjetno pristen>,
  "is_likely_fake": <boolean>,
  "fake_probability_pct": <number 0-100>,
  "image_findings": "<kaj vidiš na sliki glede pristnosti, max 200 znakov>",
  "indicators": [
    {
      "type": "<authentic|suspicious|fake>",
      "description": "<kaj zaznano, max 100 znakov>",
      "weight": <number 1-10>
    }
  ],
  "brand_specific_checks": [
    {
      "check": "<kaj preveriti, max 80 znakov>",
      "status": "<present|missing|unclear>",
      "concern_level": "<high|medium|low>"
    }
  ],
  "verification_steps": [
    {
      "step": "<konkreten korak, max 100 znakov>",
      "priority": "<high|medium|low>",
      "how_to": "<kako preveriti, max 100 znakov>"
    }
  ],
  "online_verification": {
    "recommended_tools": ["<orodje, npr. 'Google Reverse Image Search'>", "..."],
    "websites": ["<URL za preverjanje>", "..."]
  },
  "recommendation": "<buy|verify_first|avoid|report>",
  "reasoning": "<max 200 znakov>"
}`;
}

function transformDetection(parsed: any, detectedBrand: string | null) {
  return {
    authenticityScore: Math.max(0, Math.min(100, Number(parsed?.authenticity_score ?? 50))),
    isLikelyFake: Boolean(parsed?.is_likely_fake ?? false),
    fakeProbabilityPct: Math.max(0, Math.min(100, Number(parsed?.fake_probability_pct ?? 50))),
    imageFindings: String(parsed?.image_findings ?? '').slice(0, 400),
    detectedBrand,
    indicators: (parsed?.indicators || []).slice(0, 10).map((i: any) => ({
      type: ['authentic', 'suspicious', 'fake'].includes(String(i?.type)) ? String(i.type) : 'suspicious',
      description: String(i?.description ?? '').slice(0, 200),
      weight: Math.max(1, Math.min(10, Number(i?.weight ?? 5))),
    })),
    brandSpecificChecks: (parsed?.brand_specific_checks || []).slice(0, 10).map((c: any) => ({
      check: String(c?.check ?? '').slice(0, 200),
      status: ['present', 'missing', 'unclear'].includes(String(c?.status)) ? String(c.status) : 'unclear',
      concernLevel: ['high', 'medium', 'low'].includes(String(c?.concern_level)) ? String(c.concern_level) : 'medium',
    })),
    verificationSteps: (parsed?.verification_steps || []).slice(0, 8).map((s: any) => ({
      step: String(s?.step ?? '').slice(0, 200),
      priority: ['high', 'medium', 'low'].includes(String(s?.priority)) ? String(s.priority) : 'medium',
      howTo: String(s?.how_to ?? '').slice(0, 200),
    })),
    onlineVerification: {
      recommendedTools: (parsed?.online_verification?.recommended_tools || []).slice(0, 5).map((t: any) => String(t).slice(0, 100)),
      websites: (parsed?.online_verification?.websites || []).slice(0, 5).map((w: any) => String(w).slice(0, 200)),
    },
    recommendation: ['buy', 'verify_first', 'avoid', 'report'].includes(String(parsed?.recommendation))
      ? String(parsed.recommendation) : 'verify_first',
    reasoning: String(parsed?.reasoning ?? '').slice(0, 400),
  };
}
