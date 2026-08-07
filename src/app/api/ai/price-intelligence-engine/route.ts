// v7.72: AI Price Intelligence Engine — AI-powered "price intelligence" ki
// analizira pricing vzorce čez tvoje listinge + konkurenco + trg. Generira
// actionable pricing insights: optimal price points, price elasticity per
// kategorija, competitor pricing strategije, in dynamic pricing recommendations.
//
// "Elektronika: your price 280€ vs market 310€ (BELOW). Opportunity: raise to
//  305€ (+9% profit, -5% sell prob)."
//
// Razlika od smart-pricing-engine (ki priporoča ceno za POSAMEZEN listing) — ta
// gleda TRŽNO inteligenco čez kategorije (your vs market vs competitor avg).
// Razlika od price-elasticity (ki meri koliko prodaja odreagira na ceno za
// posamezen listing) — ta gleda kategorijo-elastičnost in competitor strategije.
// Razlika od cross-platform-price (ki primerja cene čez platforme) — ta
// primerja tvoje cene proti market in competitors. Razlika od
// listing-price-elasticity-analyzer-v2 (ki gleda posamezni listing) — ta
// generira dynamic pricing recommendations za vse HELD item-e hkrati.
//
// GET+POST /api/ai/price-intelligence-engine
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import {
  callProviderForRaw,
  parseJsonLooseExported,
  type AiProviderType,
  type AiSettings,
} from '@/lib/ai';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type PricePosition = 'BELOW' | 'AT' | 'ABOVE';
type AdjustAction = 'UP' | 'DOWN' | 'KEEP';
type CompetitorStrategy = 'UNDERCUT' | 'PREMIUM' | 'MATCH';

interface MarketPricing {
  category: string;
  yourAvgPrice: number;
  marketAvgPrice: number;
  competitorAvgPrice: number;
  pricePosition: PricePosition;
  priceElasticityScore: number; // 0-100, higher = more sensitive to price
  optimalPricePoint: number;
  insight: string;
}

interface DynamicPricing {
  tradeId: string;
  title: string;
  category: string;
  currentPrice: number;
  recommendedPrice: number;
  adjustAction: AdjustAction;
  expectedImpact: string;
  confidence: number; // 0-1
}

interface CompetitorStrategyInfo {
  commonStrategy: CompetitorStrategy;
  avgCompetitorDiscount: number; // %
  strategyAdvice: string;
}

interface OptimalWindow {
  timeFrame: string;
  action: string;
  reasoning: string;
}

interface AiPriceIntelligenceResponse {
  marketPricing?: unknown;
  dynamicPricing?: unknown;
  competitorStrategy?: unknown;
  optimalWindows?: unknown;
  summary?: unknown;
}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;
const POSITION_THRESHOLD = 0.05; // 5% ± tolerance for "AT"

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

const VALID_POSITION: readonly PricePosition[] = ['BELOW', 'AT', 'ABOVE'];
const VALID_ACTION: readonly AdjustAction[] = ['UP', 'DOWN', 'KEEP'];
const VALID_STRATEGY: readonly CompetitorStrategy[] = [
  'UNDERCUT',
  'PREMIUM',
  'MATCH',
];

function clampEnum<T extends string>(
  raw: unknown,
  valid: readonly T[],
  fallback: T,
): T {
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '_');
  for (const v of valid) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
}

// Compute ISO week number (1-53).
function isoWeekNumber(date: Date): number {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7; // Mon=0, Sun=6
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * DAY_MS));
}

function derivePricePosition(
  yourAvg: number,
  marketAvg: number,
): PricePosition {
  if (marketAvg <= 0) return 'AT';
  const ratio = yourAvg / marketAvg;
  if (ratio < 1 - POSITION_THRESHOLD) return 'BELOW';
  if (ratio > 1 + POSITION_THRESHOLD) return 'ABOVE';
  return 'AT';
}

// Compute price elasticity score (0-100) from historical sold data:
// elasticity = how sensitive sales are to price changes.
// Higher score = more elastic = price changes have more impact on sell probability.
function computeElasticityScore(
  soldWithYourPrice: Array<{ sellPrice: number; holdDays: number }>,
  marketAvg: number,
): number {
  if (soldWithYourPrice.length < 3 || marketAvg <= 0) return 30; // default medium
  // Group trades into 3 buckets by sell price relative to market: below, at, above
  const buckets: Record<string, { count: number; totalHold: number }> = {
    below: { count: 0, totalHold: 0 },
    at: { count: 0, totalHold: 0 },
    above: { count: 0, totalHold: 0 },
  };
  for (const t of soldWithYourPrice) {
    const ratio = t.sellPrice / marketAvg;
    const bucket = ratio < 0.95 ? 'below' : ratio > 1.05 ? 'above' : 'at';
    buckets[bucket].count += 1;
    buckets[bucket].totalHold += t.holdDays;
  }
  // If lower price → faster sale (lower holdDays), elasticity is high
  const belowAvgHold =
    buckets.below.count > 0
      ? buckets.below.totalHold / buckets.below.count
      : 0;
  const atAvgHold =
    buckets.at.count > 0 ? buckets.at.totalHold / buckets.at.count : 0;
  const aboveAvgHold =
    buckets.above.count > 0 ? buckets.above.totalHold / buckets.above.count : 0;
  // Elasticity = (aboveHold - belowHold) / max(aboveHold, 1)
  // High if pricing above market leads to much longer hold times
  if (aboveAvgHold > 0 && belowAvgHold > 0) {
    const elasticity = (aboveAvgHold - belowAvgHold) / Math.max(aboveAvgHold, 1);
    return Math.max(0, Math.min(100, Math.round(elasticity * 100)));
  }
  // Fallback: distribution-based — if most trades sold at "below", market is elastic
  const total = buckets.below.count + buckets.at.count + buckets.above.count;
  if (total > 0) {
    const belowRatio = buckets.below.count / total;
    return Math.round(belowRatio * 80 + 10); // 10-90 range
  }
  return 30;
}

// Optimal price point: maximizes profit × sell probability
// Heuristic: if elasticity > 50 (high), optimal = market avg (price to sell)
//            if elasticity < 30 (low), optimal = above market (premium)
function computeOptimalPrice(
  yourAvg: number,
  marketAvg: number,
  elasticityScore: number,
): number {
  if (marketAvg <= 0) return yourAvg;
  // If highly elastic, stay near market average
  if (elasticityScore > 60) return Math.round(marketAvg);
  // If low elasticity, you can charge a premium
  if (elasticityScore < 30) return Math.round(marketAvg * 1.1);
  // Medium: blend your price with market
  return Math.round((yourAvg + marketAvg) / 2);
}

// Derive dynamic pricing recommendation per held item
function deriveDynamicPricing(
  tradeId: string,
  title: string,
  category: string,
  currentPrice: number,
  marketAvgPrice: number,
  elasticityScore: number,
): DynamicPricing {
  // Default: keep
  let recommendedPrice = currentPrice;
  let adjustAction: AdjustAction = 'KEEP';

  if (marketAvgPrice > 0) {
    const ratio = currentPrice / marketAvgPrice;
    if (ratio > 1.15) {
      // Price is well above market — recommend downward
      const target = Math.max(marketAvgPrice * 0.95, currentPrice * 0.7);
      recommendedPrice = Math.round(target);
      adjustAction = 'DOWN';
    } else if (ratio < 0.85) {
      // Price is well below market — recommend upward
      const target = Math.min(marketAvgPrice * 0.95, currentPrice * 1.3);
      recommendedPrice = Math.round(target);
      adjustAction = 'UP';
    } else {
      // Within ±15% of market — keep
      recommendedPrice = currentPrice;
      adjustAction = 'KEEP';
    }
  }

  // Confidence based on elasticity score (more elastic = more confident in adjustment)
  let confidence: number;
  if (adjustAction === 'KEEP') {
    confidence = 0.7;
  } else {
    confidence = Math.min(0.95, 0.4 + (elasticityScore / 100) * 0.5);
  }

  const direction =
    adjustAction === 'UP'
      ? 'povišaj'
      : adjustAction === 'DOWN'
        ? 'spusti'
        : 'ohrani';
  const expectedImpact =
    adjustAction === 'KEEP'
      ? `Cena blizu trga — ohrani. Pričakovana prodaja v povprečnem hold času.`
      : `${direction} ceno iz ${currentPrice}€ na ${recommendedPrice}€ — približevanje tržni ceni (${Math.round(marketAvgPrice)}€) poveča verjetnost prodaje.`;

  return {
    tradeId,
    title,
    category,
    currentPrice,
    recommendedPrice,
    adjustAction,
    expectedImpact,
    confidence: Math.round(confidence * 100) / 100,
  };
}

// Derive competitor strategy from competitor listings (same categories)
function deriveCompetitorStrategy(
  yourAvgByCat: Map<string, number>,
  competitorAvgByCat: Map<string, number>,
): CompetitorStrategyInfo {
  if (competitorAvgByCat.size === 0 || yourAvgByCat.size === 0) {
    return {
      commonStrategy: 'MATCH',
      avgCompetitorDiscount: 0,
      strategyAdvice:
        'Ni dovolj podatkov o konkurenci — dodaj listinge s sellerName za analizo strategije konkurence.',
    };
  }

  // Compute avg competitor discount vs your prices
  let totalDiscountPct = 0;
  let matchCount = 0;
  let undercutCount = 0;
  let premiumCount = 0;
  let comparisonCount = 0;

  for (const [cat, compAvg] of competitorAvgByCat.entries()) {
    const yourAvg = yourAvgByCat.get(cat);
    if (!yourAvg || yourAvg <= 0 || compAvg <= 0) continue;
    comparisonCount += 1;
    const diffPct = ((compAvg - yourAvg) / yourAvg) * 100;
    // If competitor is cheaper by >5% → undercut; pricier by >5% → premium; else match
    if (diffPct < -5) {
      undercutCount += 1;
      totalDiscountPct += Math.abs(diffPct);
    } else if (diffPct > 5) {
      premiumCount += 1;
    } else {
      matchCount += 1;
    }
  }

  if (comparisonCount === 0) {
    return {
      commonStrategy: 'MATCH',
      avgCompetitorDiscount: 0,
      strategyAdvice:
        'Ni prekrivajočih se kategorij med tvojimi cenami in konkurenco.',
    };
  }

  let commonStrategy: CompetitorStrategy;
  if (undercutCount >= matchCount && undercutCount >= premiumCount) {
    commonStrategy = 'UNDERCUT';
  } else if (premiumCount >= matchCount && premiumCount >= undercutCount) {
    commonStrategy = 'PREMIUM';
  } else {
    commonStrategy = 'MATCH';
  }

  const avgCompetitorDiscount =
    undercutCount > 0 ? totalDiscountPct / undercutCount : 0;

  let advice: string;
  switch (commonStrategy) {
    case 'UNDERCUT':
      advice = `Konkurenca v povprečju podcenjuje (${Math.round(avgCompetitorDiscount)}% nižje od tebe v ${undercutCount} kategorijah). Premisli ali slediš s podcenitvijo ali diferenciraš s kvaliteto/boljšo ponudbo.`;
      break;
    case 'PREMIUM':
      advice = `Konkurenca v povprečju določa višje cene (premium pozicija v ${premiumCount} kategorijah). Priložnost: dvigni cene proti tržnemu povprečju za večji profit.`;
      break;
    default:
      advice = `Konkurenca v povprečju sledi tržnim cenam (v ${matchCount} kategorijah). Ohrani trenutno pozicijo ali testno dvigni cene za 5-10% kjer je elastičnost nizka.`;
  }

  return {
    commonStrategy,
    avgCompetitorDiscount: Math.round(avgCompetitorDiscount * 10) / 10,
    strategyAdvice: advice,
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handlePriceIntelligence(req);
}
export async function POST(req: NextRequest) {
  return handlePriceIntelligence(req);
}

async function handlePriceIntelligence(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-price-intelligence', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    // 1) Query HELD trades (your current asking prices via linked listings)
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
        buyFees: true,
        listingId: true,
        listing: {
          select: {
            id: true,
            price: true,
            sellerName: true,
            monitor: { select: { source: true } },
          },
        },
      },
      take: 5000,
    });

    // 2) Query SOLD trades (what prices actually worked) — last 180 days
    // NOTE: Prisma 6 DateTime filter does not accept `not: null`; using `gte`
    // implicitly excludes nulls for the sellDate field.
    const soldCutoff = new Date(Date.now() - 180 * DAY_MS);
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
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        buyDate: true,
        sellDate: true,
      },
      take: 20000,
    });

    // 3) Query competitor listings (with sellerName) — last 90 days
    const competitorCutoff = new Date(Date.now() - 90 * DAY_MS);
    const competitorListings = await db.listing.findMany({
      where: {
        sellerName: { not: '' },
        firstSeenAt: { gte: competitorCutoff },
        price: { gt: 0 },
        isHidden: false,
      },
      select: {
        id: true,
        title: true,
        price: true,
        sellerName: true,
        firstSeenAt: true,
        monitor: { select: { source: true } },
      },
      take: 20000,
    });

    // Empty state — no data at all
    if (
      heldTrades.length === 0 &&
      soldTrades.length === 0 &&
      competitorListings.length === 0
    ) {
      return NextResponse.json({
        ok: true,
        marketPricing: [],
        dynamicPricing: [],
        competitorStrategy: {
          commonStrategy: 'MATCH',
          avgCompetitorDiscount: 0,
          strategyAdvice: 'Ni podatkov o konkurenci.',
        },
        optimalWindows: [],
        summary:
          'Ni podatkov za Price Intelligence — dodaj HELD trades in listinge s sellerName za analizo.',
        aiUsed: false,
        message:
          'Ni HELD trade-ov, prodanih trade-ov ali listing-ov s sellerName — Price Intelligence ni mogoča.',
      });
    }

    // 4) Build per-category aggregates
    // yourAvgPrice: from HELD trade buyPrice (proxy for asking price; listing.price is the listed price)
    //   — Use listing.price when available (asking price), else fall back to buyPrice.
    // marketAvgPrice: from SOLD trades' sellPrice (what prices actually worked)
    // competitorAvgPrice: from competitor listings' price
    const yourByCat = new Map<string, { sum: number; count: number }>();
    const soldByCat = new Map<
      string,
      Array<{ sellPrice: number; holdDays: number }>
    >();
    const competitorByCat = new Map<string, { sum: number; count: number }>();

    for (const t of heldTrades) {
      const cat = (t.category || '').trim().toLowerCase() || 'neznan';
      const askingPrice = t.listing?.price ?? t.buyPrice;
      if (askingPrice <= 0) continue;
      const cur = yourByCat.get(cat) || { sum: 0, count: 0 };
      cur.sum += askingPrice;
      cur.count += 1;
      yourByCat.set(cat, cur);
    }

    for (const t of soldTrades) {
      const cat = (t.category || '').trim().toLowerCase() || 'neznan';
      const sellPrice = t.sellPrice ?? 0;
      if (sellPrice <= 0) continue;
      const sellDateMs = new Date(t.sellDate as unknown as Date | string).getTime();
      const buyDateMs = new Date(t.buyDate as unknown as Date | string).getTime();
      if (!Number.isFinite(sellDateMs) || !Number.isFinite(buyDateMs)) continue;
      const holdDays = Math.max(0, (sellDateMs - buyDateMs) / DAY_MS);
      const arr = soldByCat.get(cat) || [];
      arr.push({ sellPrice, holdDays });
      soldByCat.set(cat, arr);
    }

    for (const l of competitorListings) {
      const cat = (l.title || '').toLowerCase() || 'neznan';
      const price = l.price ?? 0;
      if (price <= 0) continue;
      // We don't have a real category for listings — use monitor source as pseudo-category
      // (since listing doesn't have category field)
      const sourceCat = (l.monitor?.source || '').trim().toLowerCase() || 'neznan';
      const catKey = `vir:${sourceCat}`;
      const cur = competitorByCat.get(catKey) || { sum: 0, count: 0 };
      cur.sum += price;
      cur.count += 1;
      competitorByCat.set(catKey, cur);
    }

    // 5) Compute per-category marketPricing
    const allCategories = new Set<string>([
      ...yourByCat.keys(),
      ...soldByCat.keys(),
      ...competitorByCat.keys(),
    ]);

    const marketPricing: MarketPricing[] = [];
    const yourAvgByCat = new Map<string, number>();
    const competitorAvgByCat = new Map<string, number>();

    for (const cat of allCategories) {
      const yourAgg = yourByCat.get(cat);
      const soldArr = soldByCat.get(cat) || [];
      const compAgg = competitorByCat.get(cat);

      const yourAvgPrice = yourAgg && yourAgg.count > 0 ? yourAgg.sum / yourAgg.count : 0;
      const marketAvgPrice =
        soldArr.length > 0
          ? soldArr.reduce((s, t) => s + t.sellPrice, 0) / soldArr.length
          : 0;
      const competitorAvgPrice =
        compAgg && compAgg.count > 0 ? compAgg.sum / compAgg.count : 0;

      if (yourAvgPrice > 0) yourAvgByCat.set(cat, yourAvgPrice);
      if (competitorAvgPrice > 0) competitorAvgByCat.set(cat, competitorAvgPrice);

      // Price position needs at least one reference (market or competitor)
      if (yourAvgPrice <= 0 && marketAvgPrice <= 0 && competitorAvgPrice <= 0) {
        continue;
      }

      const referencePrice = marketAvgPrice || competitorAvgPrice || yourAvgPrice;
      const pricePosition = derivePricePosition(
        yourAvgPrice || referencePrice,
        referencePrice,
      );
      const priceElasticityScore = computeElasticityScore(soldArr, marketAvgPrice);
      const optimalPricePoint = computeOptimalPrice(
        yourAvgPrice || referencePrice,
        referencePrice,
        priceElasticityScore,
      );

      // Build insight
      let insight: string;
      const yourStr = yourAvgPrice > 0 ? `${Math.round(yourAvgPrice)}€` : 'neznan';
      const marketStr =
        marketAvgPrice > 0 ? `${Math.round(marketAvgPrice)}€` : 'neznan';
      const compStr =
        competitorAvgPrice > 0
          ? `${Math.round(competitorAvgPrice)}€`
          : 'neznan';
      insight = `${cat}: tvoja cena ${yourStr} vs trg ${marketStr} vs konkurenca ${compStr} (${pricePosition}).`;
      if (pricePosition === 'BELOW') {
        insight += ` Priložnost: dvigni ceno proti ${Math.round(optimalPricePoint)}€ za večji profit.`;
      } else if (pricePosition === 'ABOVE') {
        insight += ` Tvegano: spusti ceno proti ${Math.round(optimalPricePoint)}€ za hitrejšo prodajo.`;
      } else {
        insight += ` Optimalno: ohrani ceno okoli ${Math.round(optimalPricePoint)}€.`;
      }

      marketPricing.push({
        category: cat,
        yourAvgPrice: Math.round(yourAvgPrice * 100) / 100,
        marketAvgPrice: Math.round(marketAvgPrice * 100) / 100,
        competitorAvgPrice: Math.round(competitorAvgPrice * 100) / 100,
        pricePosition,
        priceElasticityScore,
        optimalPricePoint,
        insight,
      });
    }

    // Sort: BELOW first (biggest opportunity), then ABOVE, then AT
    const positionOrder: Record<PricePosition, number> = {
      BELOW: 0,
      ABOVE: 1,
      AT: 2,
    };
    marketPricing.sort(
      (a, b) => positionOrder[a.pricePosition] - positionOrder[b.pricePosition],
    );

    // 6) Compute dynamic pricing per HELD trade
    const dynamicPricing: DynamicPricing[] = [];
    for (const t of heldTrades) {
      const cat = (t.category || '').trim().toLowerCase() || 'neznan';
      const currentPrice = t.listing?.price ?? t.buyPrice;
      if (currentPrice <= 0) continue;
      const marketAgg = soldByCat.get(cat);
      const marketAvgPrice = marketAgg && marketAgg.length > 0
        ? marketAgg.reduce((s, x) => s + x.sellPrice, 0) / marketAgg.length
        : 0;
      const elasticityScore = marketAgg
        ? computeElasticityScore(marketAgg, marketAvgPrice)
        : 30;
      const dp = deriveDynamicPricing(
        t.id,
        t.title,
        cat,
        currentPrice,
        marketAvgPrice,
        elasticityScore,
      );
      dynamicPricing.push(dp);
    }

    // 7) Compute competitor strategy
    const competitorStrategy = deriveCompetitorStrategy(
      yourAvgByCat,
      competitorAvgByCat,
    );

    // 8) AI cache check (6h TTL) — key by current week
    const currentWeek = `${new Date().getFullYear()}-W${isoWeekNumber(new Date())}`;
    const cacheKey = `price-intelligence:${currentWeek}`;
    const cached = getCachedAI<{
      marketPricing: MarketPricing[];
      dynamicPricing: DynamicPricing[];
      competitorStrategy: CompetitorStrategyInfo;
      optimalWindows: OptimalWindow[];
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        marketPricing: cached.marketPricing,
        dynamicPricing: cached.dynamicPricing,
        competitorStrategy: cached.competitorStrategy,
        optimalWindows: cached.optimalWindows,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 9) Build deterministic baseline (used as fallback)
    const baselineWindows: OptimalWindow[] = [
      {
        timeFrame: 'Nedelja zvečer',
        action: 'Objavi s 5% nižjo ceno',
        reasoning:
          'Končni tedenski kupci iščejo popuste — spodnja meja tržne cene poveča konverzijo.',
      },
      {
        timeFrame: 'Sreda dopoldne',
        action: 'Testno dvigni ceno za 5-10%',
        reasoning:
          'Visoka aktivnost kupcev — primerno za testiranje višjih cen kjer je elastičnost nizka.',
      },
    ];

    const baselineSummary =
      marketPricing.length > 0
        ? `Pricing inteligenca: ${marketPricing.length} kategorij. ` +
          `${marketPricing.filter(m => m.pricePosition === 'BELOW').length} pod tržno ceno (dvigni), ` +
          `${marketPricing.filter(m => m.pricePosition === 'ABOVE').length} nad (spusti), ` +
          `${marketPricing.filter(m => m.pricePosition === 'AT').length} optimalno. ` +
          `Konkurenčna strategija: ${competitorStrategy.commonStrategy}.`
        : 'Ni dovolj podatkov za pricing inteligenčno analizo.';

    // 10) AI prompt with grounding
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as
        | AiProviderType
        | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '',
      fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si AI "Price Intelligence" analitik za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Generiraj pricing inteligenčno poročilo: optimal price points, price elasticity per kategorija, competitor pricing strategije in dynamic pricing recommendations.

PODATKI O CENAH (TVOJI + TRG + KONKURENCA):
${JSON.stringify(marketPricing.slice(0, 20), null, 2)}

TVOJI HELD TRADE-i (za dynamic pricing recommendations):
${JSON.stringify(
  dynamicPricing.slice(0, 25).map(d => ({
    tradeId: d.tradeId,
    title: d.title,
    category: d.category,
    currentPrice: d.currentPrice,
    marketAvgPrice: marketPricing.find(m => m.category === d.category)?.marketAvgPrice ?? 0,
  })),
  null,
  2,
)}

KONKURENČNA STRATEGIJA (deterministično izračunana):
${JSON.stringify(competitorStrategy, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. marketPricing: array (sprejmi obstoječo strukturo, dodaj/posodobi "insight" polje za vsako kategorijo z specifičnim nasvetom v slovenščini)
2. dynamicPricing: array (sprejmi obstoječo strukturo, posodobi "expectedImpact" z bolj specifično napovedjo vpliva, "confidence" 0-1)
   - recommendedPrice MORA biti v [0.5 × currentPrice, 1.3 × currentPrice] (anti-hallucination)
   - adjustAction: "UP" | "DOWN" | "KEEP" (enum)
3. competitorStrategy: posodobi "strategyAdvice" z bolj specifičnim nasvetom v slovenščini
   - commonStrategy: "UNDERCUT" | "PREMIUM" | "MATCH" (enum)
4. optimalWindows: 2-3 optimalna časovna okna za prilagajanje cen (npr. "Nedelja zvečer — objavi s 5% popustom")
5. summary: 1-2 stavka povzetka v slovenščini

VRNI LE JSON:
{
  "marketPricing": [
    { "category": "...", "yourAvgPrice": 0, "marketAvgPrice": 0, "competitorAvgPrice": 0, "pricePosition": "BELOW", "priceElasticityScore": 0, "optimalPricePoint": 0, "insight": "..." }
  ],
  "dynamicPricing": [
    { "tradeId": "...", "title": "...", "category": "...", "currentPrice": 0, "recommendedPrice": 0, "adjustAction": "KEEP", "expectedImpact": "...", "confidence": 0.5 }
  ],
  "competitorStrategy": { "commonStrategy": "MATCH", "avgCompetitorDiscount": 0, "strategyAdvice": "..." },
  "optimalWindows": [ { "timeFrame": "...", "action": "...", "reasoning": "..." } ],
  "summary": "1-2 stavka povzetka v slovenščini"
}${GROUNDING_PROMPT_SUFFIX}`;

    let finalMarketPricing = marketPricing;
    let finalDynamicPricing = dynamicPricing;
    let finalCompetitorStrategy = competitorStrategy;
    let finalOptimalWindows = baselineWindows;
    let summary = baselineSummary;
    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(
        raw,
      ) as AiPriceIntelligenceResponse | null;

      if (parsed && typeof parsed === 'object') {
        // Parse marketPricing — only update "insight" string, keep numeric fields
        if (Array.isArray(parsed.marketPricing)) {
          const updated: MarketPricing[] = [];
          for (const item of parsed.marketPricing) {
            const r = item as Record<string, unknown>;
            if (!r || typeof r !== 'object') continue;
            const cat = String(r.category || '').toLowerCase();
            const existing = marketPricing.find(m => m.category === cat);
            if (!existing) continue;
            const insight = clampString(r.insight, 400, existing.insight);
            updated.push({ ...existing, insight });
          }
          if (updated.length > 0) finalMarketPricing = updated;
        }

        // Parse dynamicPricing — apply anti-hallucination clamp [0.5x, 1.3x]
        if (Array.isArray(parsed.dynamicPricing)) {
          const updated: DynamicPricing[] = [];
          for (const item of parsed.dynamicPricing) {
            const r = item as Record<string, unknown>;
            if (!r || typeof r !== 'object') continue;
            const tradeId = String(r.tradeId || '');
            const existing = dynamicPricing.find(d => d.tradeId === tradeId);
            if (!existing) continue;
            const minPrice = existing.currentPrice * 0.5;
            const maxPrice = existing.currentPrice * 1.3;
            const recPrice = clampNumber(
              r.recommendedPrice,
              minPrice,
              maxPrice,
              existing.recommendedPrice,
            );
            const adjustAction = clampEnum(
              r.adjustAction,
              VALID_ACTION,
              existing.adjustAction,
            );
            const expectedImpact = clampString(
              r.expectedImpact,
              300,
              existing.expectedImpact,
            );
            const confidence = clampNumber(r.confidence, 0, 1, existing.confidence);
            updated.push({
              ...existing,
              recommendedPrice: Math.round(recPrice),
              adjustAction,
              expectedImpact,
              confidence: Math.round(confidence * 100) / 100,
            });
          }
          if (updated.length > 0) finalDynamicPricing = updated;
        }

        // Parse competitorStrategy
        if (
          parsed.competitorStrategy &&
          typeof parsed.competitorStrategy === 'object'
        ) {
          const cs = parsed.competitorStrategy as Record<string, unknown>;
          finalCompetitorStrategy = {
            commonStrategy: clampEnum(
              cs.commonStrategy,
              VALID_STRATEGY,
              competitorStrategy.commonStrategy,
            ),
            avgCompetitorDiscount: clampNumber(
              cs.avgCompetitorDiscount,
              0,
              100,
              competitorStrategy.avgCompetitorDiscount,
            ),
            strategyAdvice: clampString(
              cs.strategyAdvice,
              600,
              competitorStrategy.strategyAdvice,
            ),
          };
        }

        // Parse optimalWindows
        if (Array.isArray(parsed.optimalWindows)) {
          const windows: OptimalWindow[] = [];
          for (const item of parsed.optimalWindows) {
            const r = item as Record<string, unknown>;
            if (!r || typeof r !== 'object') continue;
            const timeFrame = clampString(r.timeFrame, 100, '');
            const action = clampString(r.action, 200, '');
            const reasoning = clampString(r.reasoning, 400, '');
            if (timeFrame && action) {
              windows.push({ timeFrame, action, reasoning });
            }
            if (windows.length >= 5) break;
          }
          if (windows.length > 0) finalOptimalWindows = windows;
        }

        if (
          typeof parsed.summary === 'string' &&
          parsed.summary.trim().length > 0
        ) {
          summary = parsed.summary.trim().slice(0, 600);
        }

        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/price-intelligence-engine',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 11) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        marketPricing: finalMarketPricing,
        dynamicPricing: finalDynamicPricing,
        competitorStrategy: finalCompetitorStrategy,
        optimalWindows: finalOptimalWindows,
        summary,
      });
    }

    return NextResponse.json({
      ok: true,
      marketPricing: finalMarketPricing,
      dynamicPricing: finalDynamicPricing,
      competitorStrategy: finalCompetitorStrategy,
      optimalWindows: finalOptimalWindows,
      summary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error('/api/ai/price-intelligence-engine', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
