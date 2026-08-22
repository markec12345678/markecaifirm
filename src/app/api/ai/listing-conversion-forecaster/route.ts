// v7.73 / v8.96.4-batch4: AI Listing Conversion Forecaster — AI napove verjetnost konverzije
// (0-100%) za vsak HELD inventar — ali se bo prodal v 7/14/30 dneh?
// Pomaga prioritizirati katere iteme potisniti, katere relistati, katere
// likvidirati. "PS5 350€: 75% prob v 7d (cena -12%, dealScore 85). Jakna
// 80€: 25% prob (brez slike, zastarel)."
//
// Razlika od listing-conversion-optimizer (ki optimizira listing za
// konverzijo) — ta NAPOVE verjetnost konverzije. Razlika od
// listing-conversion-funnel-optimizer (ki gleda funnel) — ta gleda
// PROBABILITETA prodaje v časovnem oknu. Razlika od buyer-conversion-predictor
// (ki napoveduje konverzijo kupca) — ta napoveduje konverzijo TVOJEGA
// inventarja. Razlika od listing-trend-detector (ki zazna trend) — ta
// napoveduje konverzijo na podlagi multi-faktorjev.
//
// GET+POST /api/ai/listing-conversion-forecaster
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.4) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Input ----------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ListingConversionForecasterInput {}

// --- Types ---------------------------------------------------------------

type Impact = 'POSITIVE' | 'NEGATIVE';

interface KeyFactor {
  factor: string;
  impact: Impact;
  detail: string;
}

interface ConversionItem {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  aiEstimatedValue: number | null;
  daysListed: number;
  conversionProbability7d: number; // %
  conversionProbability14d: number; // %
  conversionProbability30d: number; // %
  expectedSellDate: { earliest: string; latest: string };
  confidenceScore: number; // 0-100
  keyFactors: KeyFactor[];
  improvementActions: string[];
}

interface Summary {
  totalItems: number;
  highProbabilityCount: number; // >70% within 7d
  mediumProbabilityCount: number; // 40-70%
  lowProbabilityCount: number; // <40%
  avgConversionProbability7d: number;
  advice: string;
}

interface AiConversionResponse {
  items?: unknown;
  summary?: unknown;
}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;

function clampNumber(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw == null) return Math.max(min, Math.min(max, fallback));
  const v = Number(raw);
  if (!Number.isFinite(v)) return Math.max(min, Math.min(max, fallback));
  return Math.max(min, Math.min(max, v));
}

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

const VALID_IMPACT: readonly Impact[] = ['POSITIVE', 'NEGATIVE'];

function clampImpact(raw: unknown, fallback: Impact): Impact {
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '_');
  for (const v of VALID_IMPACT) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
}

// --- Conversion factor computation --------------------------------------

interface ConversionFactors {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  aiEstimatedValue: number | null;
  daysListed: number;
  priceCompetitiveness: number; // -1 to 1 (positive = below estValue)
  listingAgeScore: number; // 0-100 (fresh=high)
  categoryDemandScore: number; // 0-100 (sell-through rate)
  dealScoreFactor: number; // 0-1
  imageScore: number; // 0 or 1
  contactActivityScore: number; // 0-100
  dataCompleteness: number; // 0-1 (for confidenceScore)
}

// Compute deterministic conversion probability from factors.
// Weighted sum → 0-100%.
function deterministicProbability(
  factors: ConversionFactors,
  horizonDays: 7 | 14 | 30,
): number {
  // Base weighted score (0-100)
  let score = 0;
  score += factors.priceCompetitiveness * 25; // -25 to +25
  score += factors.listingAgeScore * 0.2; // 0 to 20
  score += factors.categoryDemandScore * 0.2; // 0 to 20
  score += factors.dealScoreFactor * 15; // 0 to 15
  score += factors.imageScore * 10; // 0 or 10
  score += factors.contactActivityScore * 0.1; // 0 to 10
  // Baseline neutral: 50
  score += 50;

  // Apply horizon multiplier — longer horizon → higher probability
  // 7d = 1.0x, 14d = 1.4x, 30d = 1.8x (diminishing returns)
  const horizonMultiplier = horizonDays === 7 ? 1.0 : horizonDays === 14 ? 1.4 : 1.8;
  let prob = score * horizonMultiplier;

  // Stale listing penalty — items listed for too long lose appeal
  if (factors.daysListed > 60) {
    prob *= 0.7;
  } else if (factors.daysListed > 30) {
    prob *= 0.85;
  }

  // Clamp to [0, 100]
  prob = Math.max(0, Math.min(100, Math.round(prob)));
  return prob;
}

// Build expected sell date range based on probability horizon
function expectedSellDateRange(prob30d: number): { earliest: string; latest: string } {
  const now = Date.now();
  let earliestDays: number;
  let latestDays: number;
  if (prob30d >= 70) {
    earliestDays = 1;
    latestDays = 10;
  } else if (prob30d >= 40) {
    earliestDays = 5;
    latestDays = 25;
  } else if (prob30d >= 20) {
    earliestDays = 14;
    latestDays = 45;
  } else {
    earliestDays = 30;
    latestDays = 90;
  }
  const earliest = new Date(now + earliestDays * DAY_MS).toISOString().slice(0, 10);
  const latest = new Date(now + latestDays * DAY_MS).toISOString().slice(0, 10);
  return { earliest, latest };
}

// Compute confidence score (0-100) based on data completeness
function computeConfidence(factors: ConversionFactors): number {
  let c = factors.dataCompleteness * 70; // up to 70 from data completeness
  // Bonus if we have historical sold data (categoryDemandScore meaningful)
  if (factors.categoryDemandScore > 0 && factors.categoryDemandScore !== 50) c += 15;
  // Bonus if estValue is known (price competitiveness meaningful)
  if (factors.aiEstimatedValue !== null && factors.aiEstimatedValue > 0) c += 15;
  return Math.max(0, Math.min(100, Math.round(c)));
}

// Build key factors (top 3) for an item
function buildKeyFactors(factors: ConversionFactors): KeyFactor[] {
  const factorsArr: KeyFactor[] = [];
  if (factors.aiEstimatedValue !== null && factors.aiEstimatedValue > 0) {
    const discountPct = Math.round(
      ((factors.aiEstimatedValue - factors.buyPrice) / factors.aiEstimatedValue) * 100,
    );
    if (discountPct > 0) {
      factorsArr.push({
        factor: 'Cena pod estValue',
        impact: 'POSITIVE',
        detail: `Nakupna cena ${factors.buyPrice}€ je ${discountPct}% pod AI oceno ${factors.aiEstimatedValue}€ — visoka privlačnost.`,
      });
    } else if (discountPct < 0) {
      factorsArr.push({
        factor: 'Cena nad estValue',
        impact: 'NEGATIVE',
        detail: `Nakupna cena ${factors.buyPrice}€ je ${Math.abs(discountPct)}% nad AI oceno ${factors.aiEstimatedValue}€ — nizka marža za kupca.`,
      });
    }
  }

  if (factors.daysListed <= 7) {
    factorsArr.push({
      factor: 'Svež listing',
      impact: 'POSITIVE',
      detail: `Listing star ${factors.daysListed} dni — kupci še vedno aktivno brskajo.`,
    });
  } else if (factors.daysListed > 30) {
    factorsArr.push({
      factor: 'Zastarel listing',
      impact: 'NEGATIVE',
      detail: `Listing star ${factors.daysListed} dni — kupci ga vidijo kot "zastarel" in raje iščejo novejše.`,
    });
  }

  if (factors.dealScoreFactor >= 0.7) {
    factorsArr.push({
      factor: 'Visok dealScore',
      impact: 'POSITIVE',
      detail: `Deal score ${Math.round(factors.dealScoreFactor * 100)}/100 — kakovostna ponudba.`,
    });
  } else if (factors.dealScoreFactor > 0 && factors.dealScoreFactor < 0.4) {
    factorsArr.push({
      factor: 'Nizek dealScore',
      impact: 'NEGATIVE',
      detail: `Deal score ${Math.round(factors.dealScoreFactor * 100)}/100 — šibka ponudba.`,
    });
  }

  if (factors.imageScore === 0) {
    factorsArr.push({
      factor: 'Brez slike',
      impact: 'NEGATIVE',
      detail: 'Listing nima slike — klic k akciji je šibek.',
    });
  } else {
    factorsArr.push({
      factor: 'Slika prisotna',
      impact: 'POSITIVE',
      detail: 'Listing ima sliko — klic k akciji je močan.',
    });
  }

  if (factors.categoryDemandScore >= 60) {
    factorsArr.push({
      factor: 'Visoka povpraševanja kategorija',
      impact: 'POSITIVE',
      detail: `Sell-through rate za "${factors.category}" je ${factors.categoryDemandScore}% — hitra konverzija.`,
    });
  } else if (factors.categoryDemandScore > 0 && factors.categoryDemandScore < 30) {
    factorsArr.push({
      factor: 'Nizka povpraševanja kategorija',
      impact: 'NEGATIVE',
      detail: `Sell-through rate za "${factors.category}" je le ${factors.categoryDemandScore}% — počasna konverzija.`,
    });
  }

  if (factors.contactActivityScore >= 50) {
    factorsArr.push({
      factor: 'Aktivna interakcija',
      impact: 'POSITIVE',
      detail: `Status kontakta (${factors.contactActivityScore}/100) nakazuje zanimanje kupcev.`,
    });
  }

  // Take top 3
  return factorsArr.slice(0, 3);
}

// Build improvement actions (2-3 per item)
function buildImprovementActions(factors: ConversionFactors): string[] {
  const actions: string[] = [];
  if (factors.imageScore === 0) {
    actions.push('Dodaj kakovostno sliko — poveča konverzijo za ~30%.');
  }
  if (factors.daysListed > 21) {
    actions.push('Prenovi listing (relist) — osveži vidnost v iskalniku.');
  }
  if (factors.aiEstimatedValue !== null && factors.aiEstimatedValue > 0) {
    const ratio = factors.buyPrice / factors.aiEstimatedValue;
    if (ratio > 1.05) {
      actions.push(
        `Spusti ceno za 5-10% proti ${Math.round(factors.aiEstimatedValue * 0.95)}€ za hitrejšo prodajo.`,
      );
    } else if (ratio < 0.85) {
      actions.push(
        `Cena je nizka (${factors.buyPrice}€ vs estValue ${factors.aiEstimatedValue}€) — poudari vrednost v naslovu/opisu.`,
      );
    }
  }
  if (factors.contactActivityScore < 30) {
    actions.push('Aktivno odgovarjaj na povpraševanja — večja kontakt aktivnost dviguje zaupanje.');
  }
  if (factors.dealScoreFactor > 0 && factors.dealScoreFactor < 0.5) {
    actions.push('Izboljšaj opis (več detailov, poudari prednosti) za višji dealScore.');
  }
  if (actions.length === 0) {
    actions.push('Ohrani trenutno strategijo — faktorji so optimalni.');
  }
  return actions.slice(0, 3);
}

// --- Build baseline item from factors ------------------------------------

function buildBaselineItem(factors: ConversionFactors): ConversionItem {
  const p7d = deterministicProbability(factors, 7);
  const p14d = deterministicProbability(factors, 14);
  const p30d = deterministicProbability(factors, 30);
  // Anti-hallucination: p7d ≤ p14d ≤ p30d
  const p7 = Math.min(p7d, p14d, p30d);
  const p14 = Math.min(p14d, p30d);
  const p30 = p30d;
  const confidenceScore = computeConfidence(factors);
  const keyFactors = buildKeyFactors(factors);
  const improvementActions = buildImprovementActions(factors);
  return {
    tradeId: factors.tradeId,
    title: factors.title,
    category: factors.category,
    buyPrice: factors.buyPrice,
    aiEstimatedValue: factors.aiEstimatedValue,
    daysListed: factors.daysListed,
    conversionProbability7d: p7,
    conversionProbability14d: p14,
    conversionProbability30d: p30,
    expectedSellDate: expectedSellDateRange(p30),
    confidenceScore,
    keyFactors,
    improvementActions,
  };
}

// --- Build baseline summary ----------------------------------------------

function buildBaselineSummary(baselineItems: ConversionItem[]): Summary {
  const totalItems = baselineItems.length;
  const highProbabilityCount = baselineItems.filter(
    (i) => i.conversionProbability7d > 70,
  ).length;
  const mediumProbabilityCount = baselineItems.filter(
    (i) => i.conversionProbability7d >= 40 && i.conversionProbability7d <= 70,
  ).length;
  const lowProbabilityCount = baselineItems.filter(
    (i) => i.conversionProbability7d < 40,
  ).length;
  const avgConversionProbability7d = totalItems > 0
    ? Math.round(
        (baselineItems.reduce((s, i) => s + i.conversionProbability7d, 0) / totalItems) * 10,
      ) / 10
    : 0;

  let advice: string;
  if (highProbabilityCount > 0) {
    advice = `${highProbabilityCount} item${highProbabilityCount > 1 ? 'a' : ''} z visoko verjetnostjo prodaje (>70% v 7d) — potisni aktivno. `;
    if (lowProbabilityCount > 0) {
      advice += `${lowProbabilityCount} item${lowProbabilityCount > 1 ? 'a' : ''} z nizko verjetnostjo — premisli relist ali likvidacijo.`;
    }
  } else if (mediumProbabilityCount > 0) {
    advice = `Večina item-ov v srednji coni (40-70%) — izvedi improvement akcije (slike, relist) za dvig konverzije.`;
  } else {
    advice = `Vsi item-i imajo nizko verjetnost konverzije (<40% v 7d) — poglobljen pregled listingov in strategije prodaje.`;
  }

  return {
    totalItems,
    highProbabilityCount,
    mediumProbabilityCount,
    lowProbabilityCount,
    avgConversionProbability7d,
    advice,
  };
}

// --- Prompt builder -------------------------------------------------------

function buildItemsForPrompt(factorsList: ConversionFactors[]): Array<Record<string, unknown>> {
  return factorsList.slice(0, 25).map((f) => ({
    tradeId: f.tradeId,
    title: f.title,
    category: f.category,
    buyPrice: f.buyPrice,
    aiEstimatedValue: f.aiEstimatedValue,
    daysListed: f.daysListed,
    priceCompetitiveness: Math.round(f.priceCompetitiveness * 100) / 100,
    listingAgeScore: f.listingAgeScore,
    categoryDemandScore: f.categoryDemandScore,
    dealScoreFactor: Math.round(f.dealScoreFactor * 100) / 100,
    imageScore: f.imageScore,
    contactActivityScore: f.contactActivityScore,
    deterministicProb7d: deterministicProbability(f, 7),
    deterministicProb14d: deterministicProbability(f, 14),
    deterministicProb30d: deterministicProbability(f, 30),
  }));
}

function buildPrompt(
  factorsList: ConversionFactors[],
  sellThroughByCat: Map<string, number>,
): string {
  const itemsForPrompt = buildItemsForPrompt(factorsList);
  return `Si AI "Listing Conversion Forecaster" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Napovej verjetnost konverzije (0-100%) za vsak HELD inventar — ali se bo prodal v 7/14/30 dneh?

HELD INVENTAR S FAKTORJI (deterministično izračunano):
${JSON.stringify(itemsForPrompt, null, 2)}

HISTORIČNI SELL-THROUGH RATE PER KATEGORIJA (iz sold trade-ov zadnjih 365 dni):
${JSON.stringify(Object.fromEntries(sellThroughByCat), null, 2)}

PRAVILA ZA AI ODGOVOR:
1. items: array (sprejmi obstoječe tradeId-je, posodobi conversionProbability7d/14d/30d)
   - Vse verjetnosti MORAJO biti v [0, 100] (anti-hallucination)
   - conversionProbability7d ≤ conversionProbability14d ≤ conversionProbability30d (obvezno!)
   - confidenceScore 0-100 (kakovost podatkov)
   - keyFactors: top 3 faktorji (factor, impact POSITIVE/NEGATIVE, detail v slovenščini)
   - improvementActions: 2-3 konkretne akcije v slovenščini
   - expectedSellDate: { earliest: "YYYY-MM-DD", latest: "YYYY-MM-DD" }
2. summary: totalItems, highProbabilityCount (>70% 7d), mediumProbabilityCount (40-70%), lowProbabilityCount (<40%), avgConversionProbability7d, advice v slovenščini

VRNI LE JSON:
{
  "items": [
    { "tradeId": "...", "conversionProbability7d": 0, "conversionProbability14d": 0, "conversionProbability30d": 0, "expectedSellDate": { "earliest": "YYYY-MM-DD", "latest": "YYYY-MM-DD" }, "confidenceScore": 0, "keyFactors": [{ "factor": "...", "impact": "POSITIVE", "detail": "..." }], "improvementActions": ["..."] }
  ],
  "summary": { "totalItems": 0, "highProbabilityCount": 0, "mediumProbabilityCount": 0, "lowProbabilityCount": 0, "avgConversionProbability7d": 0, "advice": "..." }
}${GROUNDING_PROMPT_SUFFIX}`;
}

// --- AI merge ------------------------------------------------------------

interface AiMergedConversion {
  items: ConversionItem[];
  summary: Summary;
  aiUsed: boolean;
}

function mergeAiIntoConversion(
  parsed: AiConversionResponse | null,
  baselineItems: ConversionItem[],
  baselineSummary: Summary,
): AiMergedConversion {
  if (!parsed || typeof parsed !== 'object') {
    return { items: baselineItems, summary: baselineSummary, aiUsed: false };
  }

  let finalItems = baselineItems;
  let summary = baselineSummary;
  let aiUsed = false;

  // Parse items — apply anti-hallucination clamps
  if (Array.isArray(parsed.items)) {
    const updated: ConversionItem[] = [];
    for (const item of parsed.items) {
      const r = item as Record<string, unknown>;
      if (!r || typeof r !== 'object') continue;
      const tradeId = String(r.tradeId || '');
      const existing = baselineItems.find((i) => i.tradeId === tradeId);
      if (!existing) continue;

      // Clamp probabilities [0, 100]
      const p7 = clampNumber(r.conversionProbability7d, 0, 100, existing.conversionProbability7d);
      const p14 = clampNumber(r.conversionProbability14d, 0, 100, existing.conversionProbability14d);
      const p30 = clampNumber(r.conversionProbability30d, 0, 100, existing.conversionProbability30d);

      // Anti-hallucination: enforce p7d ≤ p14d ≤ p30d
      const ordered = [p7, p14, p30].sort((a, b) => a - b);

      const confidenceScore = clampNumber(
        r.confidenceScore,
        0,
        100,
        existing.confidenceScore,
      );

      // Parse expectedSellDate
      const esd = r.expectedSellDate as Record<string, unknown> | undefined;
      const earliest = esd && typeof esd.earliest === 'string'
        ? esd.earliest.slice(0, 10)
        : existing.expectedSellDate.earliest;
      const latest = esd && typeof esd.latest === 'string'
        ? esd.latest.slice(0, 10)
        : existing.expectedSellDate.latest;

      // Parse keyFactors
      const keyFactors: KeyFactor[] = [];
      if (Array.isArray(r.keyFactors)) {
        for (const kf of r.keyFactors) {
          const kfR = kf as Record<string, unknown>;
          if (!kfR || typeof kfR !== 'object') continue;
          const factor = clampString(kfR.factor, 80, '');
          const impact = clampImpact(kfR.impact, 'POSITIVE');
          const detail = clampString(kfR.detail, 300, '');
          if (factor && detail) {
            keyFactors.push({ factor, impact, detail });
          }
          if (keyFactors.length >= 5) break;
        }
      }

      // Parse improvementActions
      const improvementActions: string[] = [];
      if (Array.isArray(r.improvementActions)) {
        for (const a of r.improvementActions) {
          if (typeof a === 'string' && a.trim().length > 0) {
            improvementActions.push(a.trim().slice(0, 300));
          }
          if (improvementActions.length >= 5) break;
        }
      }

      updated.push({
        ...existing,
        conversionProbability7d: Math.round(ordered[0]!),
        conversionProbability14d: Math.round(ordered[1]!),
        conversionProbability30d: Math.round(ordered[2]!),
        expectedSellDate: { earliest, latest },
        confidenceScore: Math.round(confidenceScore),
        keyFactors: keyFactors.length > 0 ? keyFactors : existing.keyFactors,
        improvementActions: improvementActions.length > 0
          ? improvementActions
          : existing.improvementActions,
      });
    }
    if (updated.length > 0) {
      // Sort by conversionProbability7d desc
      updated.sort((a, b) => b.conversionProbability7d - a.conversionProbability7d);
      finalItems = updated;
    }
  }

  // Parse summary
  if (parsed.summary && typeof parsed.summary === 'object') {
    const s = parsed.summary as Record<string, unknown>;
    const highProbabilityCount = clampNumber(
      s.highProbabilityCount,
      0,
      finalItems.length,
      finalItems.filter((i) => i.conversionProbability7d > 70).length,
    );
    const mediumProbabilityCount = clampNumber(
      s.mediumProbabilityCount,
      0,
      finalItems.length,
      finalItems.filter((i) => i.conversionProbability7d >= 40 && i.conversionProbability7d <= 70).length,
    );
    const lowProbabilityCount = clampNumber(
      s.lowProbabilityCount,
      0,
      finalItems.length,
      finalItems.filter((i) => i.conversionProbability7d < 40).length,
    );
    const avgConversionProbability7d = clampNumber(
      s.avgConversionProbability7d,
      0,
      100,
      finalItems.length > 0
        ? finalItems.reduce((sum, i) => sum + i.conversionProbability7d, 0) / finalItems.length
        : 0,
    );
    const advice = clampString(s.advice, 600, baselineSummary.advice);
    summary = {
      totalItems: finalItems.length,
      highProbabilityCount: Math.round(highProbabilityCount),
      mediumProbabilityCount: Math.round(mediumProbabilityCount),
      lowProbabilityCount: Math.round(lowProbabilityCount),
      avgConversionProbability7d: Math.round(avgConversionProbability7d * 10) / 10,
      advice,
    };
  }

  aiUsed = true;
  return { items: finalItems, summary, aiUsed };
}

// --- Handler -------------------------------------------------------------

const listingConversionHandler = withAiRoute<ListingConversionForecasterInput>({
  endpoint: '/api/ai/listing-conversion-forecaster',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — body ignored, identična logika za GET in POST
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    // 1) Query all HELD trades with linked Listing
    const heldTrades = await db.trade.findMany({
      where: {
        status: 'held',
        buyPrice: { gt: 0 },
      },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyDate: true,
        buyFees: true,
        listingId: true,
        listing: {
          select: {
            id: true,
            price: true,
            firstSeenAt: true,
            aiEstimatedValue: true,
            aiScore: true,
            dealScore: true,
            aiRisk: true,
            aiVerdict: true,
            imageUrl: true,
            isBookmarked: true,
            contactStatus: true,
          },
        },
      },
      take: 5000,
    });

    // Empty state — no HELD trades
    if (heldTrades.length === 0) {
      return apiOk({
        ok: true,
        items: [],
        summary: {
          totalItems: 0,
          highProbabilityCount: 0,
          mediumProbabilityCount: 0,
          lowProbabilityCount: 0,
          avgConversionProbability7d: 0,
          advice:
            'Ni HELD inventarja — dodaj trade s statusom "held" za napoved konverzije.',
        },
        aiUsed: false,
        message: 'Ni HELD trade-ov — Listing Conversion Forecast ni mogoč.',
      });
    }

    // 2) Query SOLD trades to build conversion model (sell-through rate per category)
    // NOTE: Prisma 6 DateTime filter does not accept `not: null`; using `gte`
    // implicitly excludes nulls for the sellDate field.
    const soldCutoff = new Date(Date.now() - 365 * DAY_MS);
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: soldCutoff },
        buyPrice: { gt: 0 },
        sellPrice: { not: null },
      },
      select: {
        id: true,
        category: true,
        buyDate: true,
        sellDate: true,
      },
      take: 20000,
    });

    // Compute sell-through rate per category (sold count / (sold + held count))
    const soldByCat = new Map<string, number>();
    const heldByCat = new Map<string, number>();
    for (const t of soldTrades) {
      const cat = (t.category || '').trim().toLowerCase() || 'neznan';
      soldByCat.set(cat, (soldByCat.get(cat) || 0) + 1);
    }
    for (const t of heldTrades) {
      const cat = (t.category || '').trim().toLowerCase() || 'neznan';
      heldByCat.set(cat, (heldByCat.get(cat) || 0) + 1);
    }

    // sell-through rate per category
    const sellThroughByCat = new Map<string, number>();
    const allCats = new Set<string>([
      ...soldByCat.keys(),
      ...heldByCat.keys(),
    ]);
    for (const cat of allCats) {
      const sold = soldByCat.get(cat) || 0;
      const held = heldByCat.get(cat) || 0;
      const total = sold + held;
      // Need at least 3 data points for a meaningful rate; else default 50
      const rate = total >= 3 ? Math.round((sold / total) * 100) : 50;
      sellThroughByCat.set(cat, rate);
    }

    // 3) Compute conversion factors for each held item
    const now = Date.now();
    const factorsList: ConversionFactors[] = [];

    for (const t of heldTrades) {
      const cat = (t.category || '').trim().toLowerCase() || 'neznan';
      const buyPrice = t.buyPrice ?? 0;
      const aiEstimatedValue = t.listing?.aiEstimatedValue ?? null;

      // Price competitiveness: (estValue - buyPrice) / estValue (positive = good deal)
      let priceCompetitiveness = 0;
      if (aiEstimatedValue !== null && aiEstimatedValue > 0) {
        priceCompetitiveness = (aiEstimatedValue - buyPrice) / aiEstimatedValue;
        // Clamp to [-1, 1]
        priceCompetitiveness = Math.max(-1, Math.min(1, priceCompetitiveness));
      }

      // Listing age score: fresh = 100, stale = 0
      const firstSeen = t.listing?.firstSeenAt;
      const listingStartDate = firstSeen
        ? new Date(firstSeen as unknown as Date | string).getTime()
        : new Date(t.buyDate as unknown as Date | string).getTime();
      const daysListed = Math.max(
        0,
        Math.floor((now - listingStartDate) / DAY_MS),
      );
      let listingAgeScore: number;
      if (daysListed <= 3) listingAgeScore = 100;
      else if (daysListed <= 7) listingAgeScore = 85;
      else if (daysListed <= 14) listingAgeScore = 65;
      else if (daysListed <= 21) listingAgeScore = 50;
      else if (daysListed <= 30) listingAgeScore = 35;
      else if (daysListed <= 60) listingAgeScore = 20;
      else listingAgeScore = 10;

      // Category demand score from sell-through rate
      const categoryDemandScore = sellThroughByCat.get(cat) ?? 50;

      // Deal score factor (0-1)
      const dealScoreRaw = t.listing?.dealScore ?? 0;
      const dealScoreFactor = Math.max(0, Math.min(1, dealScoreRaw / 100));

      // Image score: has imageUrl (1) or not (0)
      const imageScore = t.listing?.imageUrl && t.listing.imageUrl.trim() !== '' ? 1 : 0;

      // Contact activity score based on contactStatus + isBookmarked
      let contactActivityScore = 0;
      const contactStatus = (t.listing?.contactStatus || 'none').toLowerCase();
      if (contactStatus === 'responded') contactActivityScore = 100;
      else if (contactStatus === 'contacted') contactActivityScore = 70;
      else if (contactStatus === 'closed') contactActivityScore = 30;
      else contactActivityScore = 10;
      if (t.listing?.isBookmarked) contactActivityScore = Math.min(100, contactActivityScore + 20);

      // Data completeness for confidence score
      let dataCompleteness = 0;
      if (aiEstimatedValue !== null && aiEstimatedValue > 0) dataCompleteness += 0.3;
      if (dealScoreRaw > 0) dataCompleteness += 0.2;
      if (imageScore === 1) dataCompleteness += 0.2;
      if ((soldByCat.get(cat) || 0) >= 3) dataCompleteness += 0.2; // historical data
      if (contactStatus !== 'none') dataCompleteness += 0.1;

      factorsList.push({
        tradeId: t.id,
        title: t.title,
        category: cat,
        buyPrice,
        aiEstimatedValue,
        daysListed,
        priceCompetitiveness,
        listingAgeScore,
        categoryDemandScore,
        dealScoreFactor,
        imageScore,
        contactActivityScore,
        dataCompleteness,
      });
    }

    // 4) Compute deterministic baseline (used as fallback / starting point)
    const baselineItems: ConversionItem[] = factorsList.map(buildBaselineItem);

    // Sort by conversionProbability7d desc
    baselineItems.sort((a, b) => b.conversionProbability7d - a.conversionProbability7d);

    // 5) Compute summary
    const baselineSummary = buildBaselineSummary(baselineItems);

    // 6) AI cache check (6h TTL) — key by held item IDs
    const heldItemIds = factorsList.map((f) => f.tradeId).sort();
    const cacheKey = `listing-conversion-forecast:${JSON.stringify(heldItemIds).slice(0, 200)}`;
    const cached = getCachedAI<{
      items: ConversionItem[];
      summary: Summary;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        items: cached.items,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 7) AI prompt with grounding — pass factors + historical sold-through rates
    const prompt = buildPrompt(factorsList, sellThroughByCat);

    let finalItems = baselineItems;
    let summary = baselineSummary;
    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiConversionResponse | null;

      const result = mergeAiIntoConversion(parsed, baselineItems, baselineSummary);
      if (result.aiUsed) {
        finalItems = result.items;
        summary = result.summary;
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/listing-conversion-forecaster',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        items: finalItems,
        summary,
      });
    }

    return apiOk({
      ok: true,
      items: finalItems,
      summary,
      aiUsed,
    });
  },
});

export const GET = listingConversionHandler;
export const POST = listingConversionHandler;
