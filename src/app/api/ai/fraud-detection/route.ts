// v6.13 / v8.94-refactor: Predictive Fraud Detection — hevristična + AI analiza sumljivih oglasov
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/fraud-detection
// Body: { listingId?: string, listing?: { title, price, priceText, location, description, source, imageUrl, sellerName, postedAt } }
// Returns: { ok, analysis: { fraudScore, riskLevel, redFlags, mlSignals, aiAssessment, recommendations, similarFraudPatterns } }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface ListingInput {
  title: string;
  price?: number | null;
  priceText?: string;
  location?: string;
  description?: string;
  source?: string;
  imageUrl?: string | null;
  sellerName?: string | null;
  postedAt?: string | null;
}

interface FraudDetectionInput {
  listingId?: string;
  listing: ListingInput | null;
}

interface DbListingFraudInfo { aiEstimatedValue: number | null; sellerListingCount: number | null; aiImageVerdict: string | null }
interface RedFlag { category: string; pattern: string; weight: number; matched: string }
interface MlSignal { signal: string; value: any; riskContribution: number }
interface SimilarFraudPattern { id: string; title: string; price: number | null; sellerName: string | null; matchReason: string }

// Hevristični sumljivi vzorci (pravi ML pattern matching)
const FRAUD_PATTERNS = {
  paymentRedFlags: [
    { pattern: /pošiljam\s+samo|pošiljam\s+tudi|pošiljam\s+po\s+svetu/i, weight: 25, label: 'Pošiljanje samo (klasična prevara)' },
    { pattern: /paysafecard|paysafe\s+card/i, weight: 30, label: 'Paysafecard (anonimno plačilo)' },
    { pattern: /western\s+union|moneygram/i, weight: 35, label: 'Western Union / MoneyGram' },
    { pattern: /predračun|predračunu|nakazilo\s+pred/i, weight: 25, label: 'Predračun pred prevzemom' },
    { pattern: /paypal\s+friends|paypal\s+family/i, weight: 20, label: 'PayPal Friends&Family (brez zaščite)' },
    { pattern: /gotovina\s+predhodno|predhodno\s+plačilo/i, weight: 25, label: 'Predhodno plačilo' },
    { pattern: /bitcoin|btc|kripto/i, weight: 20, label: 'Kripto plačilo' },
  ],
  urgencyRedFlags: [
    { pattern: /nujna\s+prodaja|nujno\s+prodajam|moram\s+prodati/i, weight: 15, label: 'Nujna prodaja (pritisk)' },
    { pattern: /selim\s+se|selitev|odselim/i, weight: 12, label: 'Selitev (klasičen izgovor)' },
    { pattern: /dedovanje|podedoval|od\s+deda|od\s+babice/i, weight: 10, label: 'Dedovanje (težko preverljivo)' },
    { pattern: /razvod|ločitev|ex\s+partner/i, weight: 12, label: 'Razvod (čustvena manipulacija)' },
    { pattern: /zdaj\s+ali\s+nikoli|samo\s+danes|samo\s+ta\s+teden/i, weight: 18, label: 'Time pressure' },
  ],
  descriptionRedFlags: [
    { pattern: /^[\s\S]{0,30}$/, weight: 15, label: 'Zelo kratek opis (<30 znakov)' },
    { pattern: /kontaktiraj\s+me\s+na|piši\s+mi\s+na\s+whatsapp|kontakt\s+mail/i, weight: 12, label: 'Direktni kontakt izven platforme' },
    { pattern: /nov\s+nov\s+nov|novo\s+novo|neodprto|neodprt/i, weight: 8, label: 'Preveč poudarja "novo"' },
    { pattern: /garancija\s+\d+\s+let|garancija\s+do/i, weight: 5, label: 'Garancija (lahko lažna)' },
  ],
  priceRedFlags: [
    { pattern: /po\s+dogovoru|po\s+dogovoru\s+cena/i, weight: 8, label: 'Cena "po dogovoru" (sumljivo)' },
    { pattern: /zelo\s+ugodno|super\s+cena|akcijska\s+cena|super\s+ugodno/i, weight: 12, label: 'Agregatno ugodno (pritisnk)' },
  ],
  sellerRedFlags: [
    { pattern: /(?:telefon|mobitel|mob)\s*[:.]?\s*\+?\d{3,}/i, weight: 10, label: 'Telefon v naslovu (sumnjivo)' },
  ],
};

const STOCK_PHOTO_KEYWORDS = ['stock', 'photo', 'shutterstock', 'getty', 'unsplash', 'pexels', 'pixabay'];

export const POST = withAiRoute<FraudDetectionInput>({
  endpoint: '/api/ai/fraud-detection',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      listingId: body?.listingId ? String(body.listingId) : undefined,
      listing: body?.listing ?? null,
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    // 1. Resolve listing input — iz DB (listingId) ali direktno iz body-ja
    const { listingInput, dbInfo } = await resolveListingInput(input, db);
    if (!listingInput) {
      return apiBadRequest('listingId ali listing objekt je obvezen');
    }

    // 2. Hevristična ML analiza (pattern matching + signali)
    const { redFlags, mlSignals, hevristicScore, sellerCount, imgVerdict } =
      runHeuristicAnalysis(listingInput, dbInfo);

    // 3. AI forenzik analiza konteksta
    const prompt = buildFraudPrompt({
      listingInput,
      price: Number(listingInput.price) || 0,
      sellerCount,
      imgVerdict,
      hevristicScore,
      redFlags,
      mlSignals,
    });
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    // 4. Kombiniraj hevristiko + AI
    const analysis = transformFraudResult(parsed, hevristicScore, redFlags, mlSignals);

    // 5. Poišči podobne sumljive oglase v bazi (similar fraud patterns)
    analysis.similarFraudPatterns = await findSimilarFraudPatterns(
      redFlags, db, input.listingId ?? ''
    );

    return apiOk({ ok: true, analysis });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

// Pridobi ListingInput iz direktnega body-ja ali iz baze (listingId).
async function resolveListingInput(
  input: FraudDetectionInput,
  db: AiRouteContext['db']
): Promise<{ listingInput: ListingInput | null; dbInfo: DbListingFraudInfo | null }> {
  if (!input.listingId || input.listing) {
    return { listingInput: input.listing, dbInfo: null };
  }

  const listing = await db.listing.findUnique({
    where: { id: input.listingId },
    select: {
      title: true, price: true, priceText: true, location: true, description: true,
      detailDescription: true, url: true, imageUrl: true, aiEstimatedValue: true,
      aiRisk: true, aiVerdict: true, aiReason: true, dealScore: true,
      sellerName: true, sellerListingCount: true, postedAt: true, firstSeenAt: true,
      aiImageAnalysis: true, aiImageVerdict: true,
      monitor: { select: { source: true, name: true } },
    },
  });

  if (!listing) {
    throw new ApiRouteError('Listing ne obstaja', 404);
  }

  return {
    listingInput: {
      title: listing.title,
      price: listing.price,
      priceText: listing.priceText,
      location: listing.location,
      description: listing.detailDescription || listing.description,
      source: listing.monitor?.source,
      imageUrl: listing.imageUrl,
      sellerName: listing.sellerName,
      postedAt: listing.postedAt?.toISOString() ?? null,
    },
    dbInfo: {
      aiEstimatedValue: listing.aiEstimatedValue,
      sellerListingCount: listing.sellerListingCount,
      aiImageVerdict: listing.aiImageVerdict,
    },
  };
}

// ML hevristična analiza — pattern matching (red flags) + analiza značilnosti (ml signals).
function runHeuristicAnalysis(
  listingInput: ListingInput,
  dbInfo: DbListingFraudInfo | null
): {
  redFlags: RedFlag[];
  mlSignals: MlSignal[];
  hevristicScore: number;
  sellerCount: number;
  imgVerdict: string | null;
} {
  const redFlags: RedFlag[] = [];
  let totalWeight = 0;

  // 1. Pattern matching po vseh kategorijah
  const fullText = `${listingInput.title} ${listingInput.description || ''} ${listingInput.priceText || ''} ${listingInput.location || ''}`;
  for (const [category, patterns] of Object.entries(FRAUD_PATTERNS)) {
    for (const p of patterns) {
      const match = fullText.match(p.pattern);
      if (match) {
        redFlags.push({ category, pattern: p.label, weight: p.weight, matched: match[0].slice(0, 50) });
        totalWeight += p.weight;
      }
    }
  }

  // 2. ML signali — analiza značilnosti
  const mlSignals: MlSignal[] = [];
  const price = Number(listingInput.price) || 0;
  const estValue = dbInfo?.aiEstimatedValue ?? 0;
  const sellerCount = dbInfo?.sellerListingCount ?? 0;
  const imgVerdict = dbInfo?.aiImageVerdict ?? null;

  // Price vs estimated value
  if (price > 0 && estValue > 0) {
    const discount = Math.round(((estValue - price) / estValue) * 100);
    if (discount > 50) {
      mlSignals.push({ signal: 'Cena preveč pod tržno (>{50}%)', value: `${discount}% pod est.`, riskContribution: 25 });
      totalWeight += 25;
    } else if (discount > 30) {
      mlSignals.push({ signal: 'Cena močno pod tržno', value: `${discount}% pod est.`, riskContribution: 12 });
      totalWeight += 12;
    }
  }

  // Seller listing count
  if (sellerCount === 0) {
    mlSignals.push({ signal: 'Nov prodajalec (0 oglasov)', value: 0, riskContribution: 8 });
    totalWeight += 8;
  } else if (sellerCount > 50) {
    mlSignals.push({ signal: 'Množični prodajalec (>50 oglasov)', value: sellerCount, riskContribution: 5 });
    totalWeight += 5;
  }

  // Image verdict
  if (imgVerdict === 'STOCK_PHOTO') {
    mlSignals.push({ signal: 'Stock fotografija namesto realne', value: 'STOCK_PHOTO', riskContribution: 20 });
    totalWeight += 20;
  } else if (imgVerdict === 'SUSPICIOUS') {
    mlSignals.push({ signal: 'AI označil sliko kot sumljivo', value: 'SUSPICIOUS', riskContribution: 15 });
    totalWeight += 15;
  }

  // Description length
  const descLen = (listingInput.description || '').length;
  if (descLen < 50) {
    mlSignals.push({ signal: 'Zelo kratek opis (<50 znakov)', value: descLen, riskContribution: 10 });
    totalWeight += 10;
  }

  // Posted recently + low price (suspicious combo)
  if (listingInput.postedAt) {
    const hoursAgo = (Date.now() - new Date(listingInput.postedAt).getTime()) / (60 * 60 * 1000);
    if (hoursAgo < 6 && price > 0 && estValue > 0 && price < estValue * 0.6) {
      mlSignals.push({ signal: 'Nov oglas (<6h) + izjemno nizka cena', value: `${Math.round(hoursAgo)}h`, riskContribution: 18 });
      totalWeight += 18;
    }
  }

  // Image URL stock check
  const imageUrl = listingInput.imageUrl;
  if (imageUrl && STOCK_PHOTO_KEYWORDS.some(k => imageUrl.toLowerCase().includes(k))) {
    mlSignals.push({ signal: 'URL slike vsebuje stock photo keyword', value: imageUrl.slice(0, 50), riskContribution: 22 });
    totalWeight += 22;
  }

  return { redFlags, mlSignals, hevristicScore: Math.min(100, totalWeight), sellerCount, imgVerdict };
}

function buildFraudPrompt(params: {
  listingInput: ListingInput;
  price: number;
  sellerCount: number;
  imgVerdict: string | null;
  hevristicScore: number;
  redFlags: RedFlag[];
  mlSignals: MlSignal[];
}): string {
  const { listingInput, price, sellerCount, imgVerdict, hevristicScore, redFlags, mlSignals } = params;
  return `Si forenzik za odkrivanje prevar pri spletnih oglasih rabljenih dobrin.
Analiziraj oglas in potrdi/odpovej hevristično oceno tveganja.

OGLAS:
NASLOV: ${listingInput.title}
CENA: ${listingInput.priceText || (price + ' EUR')}
LOKACIJA: ${listingInput.location || 'neznan'}
PRODAJALEC: ${listingInput.sellerName || 'neznan'} (${sellerCount} oglasov)
OPIS: ${(listingInput.description || '').slice(0, 1000)}
${imgVerdict ? `SLIKA: ${imgVerdict}` : ''}

HEVRISTIČNA ANALIZA:
- Score: ${hevristicScore}/100
- Red flags: ${redFlags.length > 0 ? redFlags.map(r => r.pattern).join('; ') : 'brez'}
- ML signali: ${mlSignals.length > 0 ? mlSignals.map(s => `${s.signal} (+${s.riskContribution})`).join('; ') : 'brez'}

Pravila:
1. Predpostavi, da je hevristična analiza natančna v 70% primerov
2. Preveri kombinacije znakov (npr. nujna prodaja + pošiljanje samo + nov prodajalec = skoraj gotovo prevara)
3. Opozori tudi na subtilne znake ki jih hevristika ne najde
4. Razlikuj med "resnično prevara" in "sumljivo a morda legitimno"
5. Priporoči konkretno dejanje (pogajaj prek platforme / zahtevaj osebni prevzem / ne nakupuj / itd.)

Odgovori LE z JSON:
{
  "ai_assessment": "<glavna ugotovitev, max 200 znakov>",
  "fraud_probability_pct": <number 0-100>,
  "scam_type": "<classic_scam|phishing|advance_fee|fake_item|non_delivery|legitimate|suspicious>",
  "additional_red_flags": ["<subtilen znak, max 80 znakov>", "..."],
  "verification_steps": ["<korak za preverjanje, max 100 znakov>", "..."],
  "recommendation": "<buy_with_caution|verify_first|avoid|report>",
  "reasoning": "<zakaj ta ocena, max 200 znakov>"
}`;
}

// Kombiniraj hevristiko + AI odgovor v končno analizo (redFlags.sort mutira v-place).
function transformFraudResult(
  parsed: any,
  hevristicScore: number,
  redFlags: RedFlag[],
  mlSignals: MlSignal[]
): any {
  const aiFraudProb = Math.max(0, Math.min(100, Number(parsed?.fraud_probability_pct ?? hevristicScore)));
  const combinedScore = Math.round(hevristicScore * 0.6 + aiFraudProb * 0.4);
  const riskLevel = combinedScore >= 70 ? 'critical' :
                    combinedScore >= 40 ? 'high' :
                    combinedScore >= 20 ? 'medium' : 'low';

  return {
    fraudScore: combinedScore,
    riskLevel,
    hevristicScore,
    aiScore: aiFraudProb,
    scamType: ['classic_scam', 'phishing', 'advance_fee', 'fake_item', 'non_delivery', 'legitimate', 'suspicious'].includes(String(parsed?.scam_type))
      ? String(parsed.scam_type) : 'suspicious',
    aiAssessment: String(parsed?.ai_assessment ?? '').slice(0, 400),
    reasoning: String(parsed?.reasoning ?? '').slice(0, 400),
    redFlags: redFlags.sort((a, b) => b.weight - a.weight),
    mlSignals,
    additionalRedFlags: Array.isArray(parsed?.additional_red_flags)
      ? parsed.additional_red_flags.slice(0, 6).map((r: any) => String(r).slice(0, 200))
      : [],
    verificationSteps: Array.isArray(parsed?.verification_steps)
      ? parsed.verification_steps.slice(0, 6).map((s: any) => String(s).slice(0, 250))
      : [],
    recommendation: ['buy_with_caution', 'verify_first', 'avoid', 'report'].includes(String(parsed?.recommendation))
      ? String(parsed.recommendation) : 'verify_first',
    similarFraudPatterns: [] as SimilarFraudPattern[],
  };
}

// Poišči podobne sumljive oglase v bazi glede na top red flag (highest weight).
async function findSimilarFraudPatterns(redFlags: RedFlag[], db: AiRouteContext['db'], excludeId: string): Promise<SimilarFraudPattern[]> {
  if (redFlags.length === 0) return [];

  const topPattern = redFlags[0].pattern;
  const similar = await db.listing.findMany({
    where: {
      id: { not: excludeId },
      isHidden: false,
      OR: [
        { description: { contains: topPattern.slice(0, 20) } },
        { detailDescription: { contains: topPattern.slice(0, 20) } },
        { title: { contains: topPattern.slice(0, 20) } },
      ],
    },
    select: { id: true, title: true, price: true, sellerName: true, firstSeenAt: true },
    take: 5,
  });

  return similar.map(s => ({
    id: s.id,
    title: s.title,
    price: s.price,
    sellerName: s.sellerName,
    matchReason: `Podoben vzorec: ${topPattern.slice(0, 50)}`,
  }));
}
