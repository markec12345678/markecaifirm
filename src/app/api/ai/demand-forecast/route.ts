// v7.60 / v8.96.3-batch4: Demand Forecast AI — AI napoved katere kategorije bodo v visokem
// povpraševanju naslednji mesec glede na zgodovinsko pogostost oglasov,
// sell-through rate in sezonske vzorce. Pomaga odločiti KAM investirati
// kapital.
//
// "Elektronika: HIGH demand next 30d (sell-through 65%, trend ↑) → kupuj več"
//
// GET+POST /api/ai/demand-forecast
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.3) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface DemandForecastInput {}

// --- Types ---------------------------------------------------------------

type DemandLevel = 'HIGH' | 'MEDIUM' | 'LOW';
type Trend3 = 'INCREASING' | 'STABLE' | 'DECREASING';
type PriceTrend = 'UP' | 'STABLE' | 'DOWN';
type Action = 'BUY_MORE' | 'HOLD' | 'REDUCE' | 'AVOID';

interface CategoryStats {
  category: string;
  listingFrequency: number; // per week (last 4 weeks)
  frequencyTrend: Trend3;
  sellThroughRate: number; // %
  avgPrice: number;
  avgPriceTrend: PriceTrend;
  seasonalityScore: number;
  totalListings: number;
  soldTrades: number;
}

interface CategoryForecast {
  category: string;
  currentDemand: DemandLevel;
  predictedDemand: DemandLevel;
  confidenceScore: number;
  listingFrequency: number;
  frequencyTrend: Trend3;
  sellThroughRate: number;
  avgPriceTrend: PriceTrend;
  seasonalityScore: number;
  expectedPriceMovement: PriceTrend;
  recommendedAction: Action;
  reasoning: string;
}

interface AiForecastEntry {
  category?: unknown;
  predictedDemand?: unknown;
  confidenceScore?: unknown;
  expectedPriceMovement?: unknown;
  recommendedAction?: unknown;
  reasoning?: unknown;
}

interface AiForecastResponse {
  categories?: AiForecastEntry[];
}

// --- Helpers -------------------------------------------------------------

// Extract category from listing title keywords (Slovenian-ish heuristics)
// Falls back to monitor.tags if title gives no signal.
function inferCategoryFromTitle(title: string): string | null {
  const t = (title || '').toLowerCase();
  if (!t) return null;
  const rules: Array<[string, RegExp]> = [
    ['elektronika', /\b(ps5|ps4|playstation|xbox|nintendo|laptop|prenosnik|telefon|iphone|samsung|tabli?ca|monitor|tv|televiz|slušal|headphone|speaker|zvočnik|kamera|fotoaparat|graficna|graphics)\b/],
    ['avto', /\b(avto|auto|bmw|audi|vw|golf|passat|mercedes|renault|peugeot|fiat|citroen|toyota|honda|ford|opel|skoda|kia|hyundai|mazda|volkswagen|vw|tesla)\b/],
    ['kolesa', /\b(kolo|bike|bicycle|mtb|trek|special|cannondale|giant|scott|bmx|cyclocross|e-bike|elektricno kolo)\b/],
    ['pohistvo', /\b(pohištvo|pohistvo|stol|miza|omara|postelja|sofa|kanap|fotelj|kavč|komoda|regal)\b/],
    ['moda', /\b(jakna|jacket|hlače|hlace|majica|t-shirt|pulover|kapa|oblačila|oblačil|čevlji|cevlji|superge|sneakers|torbica|moški|ženski|otrok)\b/],
    ['dom', /\b(posoda|kuhinja|kitchen|kava|coffee|espresso|mikser|mešalnik|likalnik|likaln|sušilni|pečica|suedilc|sesalec|robot)\b/],
    ['orodje', /\b(vijačnik|orodje|tool|akumulatorski|vrtalni|vrtaln|brusilni|brusiln|sbosilni|sbosiln|metla|polirni|kompleti orodja)\b/],
    ['sport', /\b(smuči|smuci|smučanje|snowboard|roke|proteini|fitnes|dumbbell|uteži|kolesarski|kolesarovanje|tenis|nogomet|žoga|fitnes)\b/],
    ['igre', /\b(fifa|call of duty|cod|gta|minecraft|nintendo|playstation game|xbox game|steam|ps5 game|ps4 game|switch game)\b/],
    ['nepremicnine', /\b(stanovanje|hiša|hisa|parcela|zemljišče|zemljisce|soba|garsonka|nova|najem|prodn)\b/],
  ];
  for (const [cat, re] of rules) {
    if (re.test(t)) return cat;
  }
  return null;
}

// Slovenian-ish seasonality map: month 1-12 → score boost for select categories
// Based on typical demand cycles in EU/SI classifieds
function seasonalityScoreFor(category: string, date: Date): number {
  const m = date.getMonth() + 1; // 1-12
  const c = category.toLowerCase();
  // Base 50
  let score = 50;
  // Electronics surge Nov/Dec (holidays) — gift-heavy
  if (c === 'elektronika' && (m === 11 || m === 12)) score += 35;
  else if (c === 'elektronika' && m === 1) score += 15; // post-holiday resale
  // Fitness gear — January spike (new year resolutions)
  else if (c === 'sport' && (m === 1 || m === 2)) score += 30;
  else if (c === 'sport' && m === 12) score += 10;
  // Bicycles — spring (Mar-May) peak
  else if (c === 'kolesa' && (m === 3 || m === 4 || m === 5)) score += 35;
  else if (c === 'kolesa' && (m === 9 || m === 10)) score -= 20; // autumn drop
  // Cars — spring and autumn stronger
  else if (c === 'avto' && (m === 3 || m === 4 || m === 9 || m === 10)) score += 20;
  // Winter tires — Sep-Nov peak
  else if (c === 'avto' && (m === 9 || m === 10 || m === 11)) score += 15;
  // Fashion — season change (Feb/Mar spring, Aug/Sep autumn)
  else if (c === 'moda' && (m === 2 || m === 3 || m === 8 || m === 9)) score += 20;
  // Furniture — spring cleaning (Apr/May), pre-summer moves (Jun/Jul)
  else if (c === 'pohistvo' && (m === 4 || m === 5 || m === 6 || m === 7)) score += 15;
  // Tools/garden — spring and summer
  else if (c === 'orodje' && (m === 4 || m === 5 || m === 6)) score += 20;
  // Real estate — spring and early autumn
  else if (c === 'nepremicnine' && (m === 4 || m === 5 || m === 9)) score += 25;
  // Games — winter months + Dec/Jan gifts
  else if (c === 'igre' && (m === 12 || m === 1 || m === 2)) score += 25;
  return Math.max(0, Math.min(100, score));
}

function classifyFrequencyTrend(now4w: number, prev4w: number): Trend3 {
  if (prev4w === 0) return now4w > 0 ? 'INCREASING' : 'STABLE';
  const delta = (now4w - prev4w) / prev4w;
  if (delta >= 0.15) return 'INCREASING';
  if (delta <= -0.15) return 'DECREASING';
  return 'STABLE';
}

function classifyPriceTrend(nowAvg: number, prevAvg: number): PriceTrend {
  if (prevAvg === 0) return nowAvg > 0 ? 'UP' : 'STABLE';
  const delta = (nowAvg - prevAvg) / prevAvg;
  if (delta >= 0.10) return 'UP';
  if (delta <= -0.10) return 'DOWN';
  return 'STABLE';
}

function demandFromRate(rate: number): DemandLevel {
  // Sell-through rate buckets: >50% HIGH, 25-50% MEDIUM, <25% LOW
  if (rate >= 50) return 'HIGH';
  if (rate >= 25) return 'MEDIUM';
  return 'LOW';
}

function clampReasoning(s: unknown, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) return s.trim().slice(0, 280);
  return fallback;
}

// Deterministic forecast — used when AI unavailable.
function deterministicForecast(
  stats: CategoryStats[],
  today: Date,
): CategoryForecast[] {
  return stats.map(s => {
    const predictedDemand: DemandLevel = (() => {
      // Combine sell-through rate, trend, and seasonality
      const season = seasonalityScoreFor(s.category, today);
      let score = 0;
      if (s.sellThroughRate >= 50) score += 40;
      else if (s.sellThroughRate >= 25) score += 20;
      if (s.frequencyTrend === 'INCREASING') score += 25;
      else if (s.frequencyTrend === 'DECREASING') score -= 15;
      if (season >= 75) score += 20;
      else if (season <= 30) score -= 20;
      if (s.listingFrequency >= 5) score += 15;
      if (score >= 60) return 'HIGH' as DemandLevel;
      if (score >= 30) return 'MEDIUM' as DemandLevel;
      return 'LOW' as DemandLevel;
    })();

    const expectedPriceMovement: PriceTrend = (() => {
      if (s.avgPriceTrend === 'UP' && s.frequencyTrend === 'INCREASING') return 'UP';
      if (s.avgPriceTrend === 'DOWN' && s.frequencyTrend === 'DECREASING') return 'DOWN';
      return 'STABLE';
    })();

    const recommendedAction: Action = (() => {
      if (predictedDemand === 'HIGH' && expectedPriceMovement !== 'DOWN') return 'BUY_MORE';
      if (predictedDemand === 'LOW' && expectedPriceMovement === 'DOWN') return 'AVOID';
      if (predictedDemand === 'LOW') return 'REDUCE';
      return 'HOLD';
    })();

    const confidenceScore = Math.max(
      20,
      Math.min(
        85,
        Math.round(40 + s.sellThroughRate * 0.4 + (s.frequencyTrend === 'STABLE' ? 5 : 10)),
      ),
    );

    return {
      category: s.category,
      currentDemand: demandFromRate(s.sellThroughRate),
      predictedDemand,
      confidenceScore,
      listingFrequency: Math.round(s.listingFrequency * 10) / 10,
      frequencyTrend: s.frequencyTrend,
      sellThroughRate: Math.round(s.sellThroughRate),
      avgPriceTrend: s.avgPriceTrend,
      seasonalityScore: seasonalityScoreFor(s.category, today),
      expectedPriceMovement,
      recommendedAction,
      reasoning: `${s.category}: sell-through ${Math.round(s.sellThroughRate)}%, trend ${s.frequencyTrend.toLowerCase()} → ${predictedDemand === 'HIGH' ? 'kupuj več' : predictedDemand === 'LOW' ? 'zmanjšaj' : 'ohrani'}.`,
    };
  });
}

// Anti-hallucination: clamp AI predictions to be consistent with history.
// Rule: a category cannot be predicted HIGH if it has been DECREASING for
// the past 8 weeks AND has LOW seasonality — that would be hallucinated optimism.
function validateAiForecast(
  raw: AiForecastEntry,
  stats: CategoryStats,
  today: Date,
): CategoryForecast | null {
  const category = typeof raw.category === 'string' ? raw.category.trim() : stats.category;
  if (!category) return null;

  const predictedDemandRaw = String(raw.predictedDemand).toUpperCase();
  let predictedDemand: DemandLevel =
    predictedDemandRaw === 'HIGH' || predictedDemandRaw === 'LOW' || predictedDemandRaw === 'MEDIUM'
      ? (predictedDemandRaw as DemandLevel)
      : demandFromRate(stats.sellThroughRate);

  // Anti-hallucination rule: declining category + low seasonality cannot be HIGH
  const season = seasonalityScoreFor(category, today);
  if (predictedDemand === 'HIGH' && stats.frequencyTrend === 'DECREASING' && season < 60) {
    predictedDemand = 'MEDIUM';
  }
  // Anti-hallucination: very low sell-through (<10%) + declining + low season → can't be HIGH
  if (
    predictedDemand === 'HIGH' &&
    stats.sellThroughRate < 10 &&
    stats.frequencyTrend === 'DECREASING'
  ) {
    predictedDemand = 'LOW';
  }

  const expectedPriceMovementRaw = String(raw.expectedPriceMovement).toUpperCase();
  const expectedPriceMovement: PriceTrend =
    expectedPriceMovementRaw === 'UP' || expectedPriceMovementRaw === 'DOWN' || expectedPriceMovementRaw === 'STABLE'
      ? (expectedPriceMovementRaw as PriceTrend)
      : stats.avgPriceTrend;

  const actionRaw = String(raw.recommendedAction).toUpperCase();
  const recommendedAction: Action =
    actionRaw === 'BUY_MORE' || actionRaw === 'HOLD' || actionRaw === 'REDUCE' || actionRaw === 'AVOID'
      ? (actionRaw as Action)
      : predictedDemand === 'HIGH'
        ? 'BUY_MORE'
        : predictedDemand === 'LOW'
          ? 'REDUCE'
          : 'HOLD';

  let confidenceScore = Number(raw.confidenceScore);
  if (!Number.isFinite(confidenceScore)) confidenceScore = 50;
  confidenceScore = Math.max(10, Math.min(95, Math.round(confidenceScore)));

  const reasoning = clampReasoning(
    raw.reasoning,
    `${category}: sell-through ${Math.round(stats.sellThroughRate)}%, trend ${stats.frequencyTrend.toLowerCase()} → ${predictedDemand}.`,
  );

  return {
    category,
    currentDemand: demandFromRate(stats.sellThroughRate),
    predictedDemand,
    confidenceScore,
    listingFrequency: Math.round(stats.listingFrequency * 10) / 10,
    frequencyTrend: stats.frequencyTrend,
    sellThroughRate: Math.round(stats.sellThroughRate),
    avgPriceTrend: stats.avgPriceTrend,
    seasonalityScore: season,
    expectedPriceMovement,
    recommendedAction,
    reasoning,
  };
}

// --- Category aggregation (čisti helper) --------------------------------

interface CatAgg {
  listingsNow4w: number;
  listingsPrev4w: number;
  soldCount: number;
  priceSumNow4w: number;
  priceCountNow4w: number;
  priceSumPrev4w: number;
  priceCountPrev4w: number;
  totalListings: number;
}

interface ListingRow {
  title: string;
  price: number | null;
  firstSeenAt: Date;
  monitor: { tags: string | null } | null;
}

interface SoldTradeRow {
  title: string;
  category: string | null;
  sellPrice: number | null;
  sellDate: Date | null;
  buyPrice: number | null;
}

function aggregateCategoryStats(
  listings: ListingRow[],
  soldTrades: SoldTradeRow[],
  today: Date,
  cutoff28: Date,
  cutoff56: Date,
): CategoryStats[] {
  const agg = new Map<string, CatAgg>();

  function bump(cat: string, init: Partial<CatAgg> = {}) {
    const key = cat || 'drugo';
    if (!agg.has(key)) {
      agg.set(key, {
        listingsNow4w: 0,
        listingsPrev4w: 0,
        soldCount: 0,
        priceSumNow4w: 0,
        priceCountNow4w: 0,
        priceSumPrev4w: 0,
        priceCountPrev4w: 0,
        totalListings: 0,
        ...init,
      });
    }
    return agg.get(key)!;
  }

  for (const l of listings) {
    const fromTitle = inferCategoryFromTitle(l.title);
    const tags = l.monitor?.tags || '';
    const tag = tags.split(',').map(t => t.trim().toLowerCase()).find(Boolean);
    const category = (fromTitle || tag || 'drugo').toLowerCase();
    const a = bump(category);
    a.totalListings += 1;
    const seen = l.firstSeenAt;
    const price = l.price ?? 0;
    if (seen >= cutoff28) {
      a.listingsNow4w += 1;
      if (price > 0) {
        a.priceSumNow4w += price;
        a.priceCountNow4w += 1;
      }
    } else if (seen >= cutoff56) {
      a.listingsPrev4w += 1;
      if (price > 0) {
        a.priceSumPrev4w += price;
        a.priceCountPrev4w += 1;
      }
    }
  }

  for (const t of soldTrades) {
    const fromTitle = inferCategoryFromTitle(t.title);
    const category = (fromTitle || t.category || 'drugo').toLowerCase();
    const a = bump(category);
    a.soldCount += 1;
  }

  const stats: CategoryStats[] = [];
  for (const [category, a] of agg.entries()) {
    const listingsNow4w = a.listingsNow4w;
    const listingsPrev4w = a.listingsPrev4w;
    // per week (4 weeks in window)
    const listingFrequency = listingsNow4w / 4;
    const frequencyTrend = classifyFrequencyTrend(listingsNow4w, listingsPrev4w);

    const avgPriceNow = a.priceCountNow4w > 0 ? a.priceSumNow4w / a.priceCountNow4w : 0;
    const avgPricePrev = a.priceCountPrev4w > 0 ? a.priceSumPrev4w / a.priceCountPrev4w : 0;
    const avgPriceTrend = classifyPriceTrend(avgPriceNow, avgPricePrev);

    const sellThroughRate =
      a.totalListings > 0 ? Math.min(100, (a.soldCount / a.totalListings) * 100) : 0;

    stats.push({
      category,
      listingFrequency,
      frequencyTrend,
      sellThroughRate,
      avgPrice: Math.round(avgPriceNow),
      avgPriceTrend,
      seasonalityScore: seasonalityScoreFor(category, today),
      totalListings: a.totalListings,
      soldTrades: a.soldCount,
    });
  }

  return stats;
}

// --- Prompt builder + summary (čisti helperji) --------------------------

function buildPrompt(topStats: CategoryStats[], today: Date): string {
  const statsBlock = topStats
    .map(
      (s, i) =>
        `${i + 1}. kategorija=${s.category} | listings4w=${Math.round(s.listingFrequency * 4)} | sellThrough=${Math.round(s.sellThroughRate)}% | avgPrice=${s.avgPrice}€ | trend=${s.frequencyTrend} | seasonality=${s.seasonalityScore}/100`,
    )
    .join('\n');

  // Provide explicit numeric fields for the AI to be deterministic about
  const aiStatsBlock = topStats
    .map(s => `${s.category}|${Math.round(s.sellThroughRate)}|${s.frequencyTrend}|${s.avgPriceTrend}|${s.seasonalityScore}|${Math.round(s.listingFrequency * 10) / 10}`)
    .join('\n');

  return `Si analitik povpraševanja na slovenskem/EU oglasnem trgu (Bolha, Vinted, mobile.de, Kleinanzeigen).
Napovej povpraševanje za naslednjih 30 dni za vsako kategorijo.

ZGODOVINSKI PODATKI (zadnjih 8 tednov, razdeljeno na "now4w" in "prev4w"):
${statsBlock}

PARSIRANO (kategorija|sellThrough%|freqTrend|priceTrend|seasonality|freqPerWeek):
${aiStatsBlock}

DATUM: ${today.toISOString().slice(0, 10)}

NALOGA:
Za vsako kategorijo napovej:
- predictedDemand: HIGH / MEDIUM / LOW (za naslednji 30 dni)
- confidenceScore: 0-100 (višji če več podatkov in jasen trend)
- expectedPriceMovement: UP / STABLE / DOWN
- recommendedAction: BUY_MORE / HOLD / REDUCE / AVOID
- reasoning: 1 stavek v slovenščini z razlogom

PRAVILA:
- Kategorija, ki pada 8 tednov BREZ sezonskega razloga, NE more biti HIGH (to bi bila halucinacija).
- Upoštevaj sezonskost (npr. elektronika dec/jan, fitness jan/feb, kolesa marec-maj).
- Če je sell-through pod 25% in trend pada → AVOID ali REDUCE.
- BUY_MORE samo če je predictedDemand HIGH in expectedPriceMovement ni DOWN.

Odgovori LE z JSON:
{
  "categories": [
    {
      "category": "<ime>",
      "predictedDemand": "HIGH|MEDIUM|LOW",
      "confidenceScore": <0-100>,
      "expectedPriceMovement": "UP|STABLE|DOWN",
      "recommendedAction": "BUY_MORE|HOLD|REDUCE|AVOID",
      "reasoning": "<1 stavek>"
    }
  ]
}${GROUNDING_PROMPT_SUFFIX}`;
}

interface DemandForecastSummary {
  totalCategories: number;
  highDemand: number;
  bestOpportunity: string | null;
  worstCategory: string | null;
  reasoning: string;
}

function buildSummary(
  topForecasts: CategoryForecast[],
): DemandForecastSummary {
  const highDemand = topForecasts.filter(f => f.predictedDemand === 'HIGH').length;
  const bestOpportunity =
    topForecasts.find(f => f.recommendedAction === 'BUY_MORE')?.category ?? null;
  const worstCategory =
    [...topForecasts]
      .reverse()
      .find(f => f.recommendedAction === 'AVOID' || f.recommendedAction === 'REDUCE')?.category ??
    null;
  return {
    totalCategories: topForecasts.length,
    highDemand,
    bestOpportunity,
    worstCategory,
    reasoning:
      highDemand > 0
        ? `${highDemand} kategorij v HIGH povpraševanju. Najboljša priložnost: ${bestOpportunity ?? '—'}.`
        : 'Brez kategorij v HIGH povpraševanju — prestavi kapital v zdrave kategorije.',
  };
}

// --- Handler -------------------------------------------------------------

const demandForecastHandler = withAiRoute<DemandForecastInput>({
  endpoint: '/api/ai/demand-forecast',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — body ignored
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    const today = new Date();
    const cutoff90 = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
    const cutoff56 = new Date(today.getTime() - 56 * 24 * 60 * 60 * 1000); // 8 weeks ago (prev4w start)
    const cutoff28 = new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000); // 4 weeks ago (now4w start)

    // 1) Listings from last 90 days — group by category (extract from title or monitor.tags)
    const listings = await db.listing.findMany({
      where: { firstSeenAt: { gte: cutoff90 } },
      select: {
        title: true,
        price: true,
        firstSeenAt: true,
        monitor: { select: { tags: true } },
      },
      take: 5000,
    });

    // 2) SOLD trades from last 90 days — group by category
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: cutoff90 },
      },
      select: {
        title: true,
        category: true,
        sellPrice: true,
        sellDate: true,
        buyPrice: true,
      },
      take: 5000,
    });

    // 3) Compute per-category stats
    const stats = aggregateCategoryStats(
      listings as ListingRow[],
      soldTrades as SoldTradeRow[],
      today,
      cutoff28,
      cutoff56,
    );

    // Empty state
    if (stats.length === 0) {
      return apiOk({
        ok: true,
        categories: [],
        summary: {
          totalCategories: 0,
          highDemand: 0,
          bestOpportunity: null,
          worstCategory: null,
          reasoning: 'Ni zgodovinskih oglasov v zadnjih 90 dneh — napoved povpraševanja ni mogoča.',
        },
        aiUsed: false,
        message: 'Ni zgodovinskih oglasov v zadnjih 90 dneh — napoved povpraševanja ni mogoča.',
      });
    }

    // Sort by sellThrough × frequency (signal-weighted)
    stats.sort(
      (a, b) =>
        b.sellThroughRate * 0.5 + b.listingFrequency * 2 -
        (a.sellThroughRate * 0.5 + a.listingFrequency * 2),
    );
    // Take top 15 categories to send to AI
    const topStats = stats.slice(0, 15);

    // 4) AI cache — keyed by current month (refreshes ~daily due to 6h TTL)
    const currentMonth = `${today.getFullYear()}-${today.getMonth() + 1}`;
    const cacheKey = `demand-forecast:${currentMonth}`;
    const cached = getCachedAI<{
      categories: CategoryForecast[];
      summary: DemandForecastSummary;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        ...cached,
        cached: true,
        aiUsed: true,
      });
    }

    // 5) Build AI prompt with grounding + call AI (try/catch z graceful fallback)
    const prompt = buildPrompt(topStats, today);

    let aiUsed = false;
    let forecasts: CategoryForecast[] = [];

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiForecastResponse | null;
      if (parsed && Array.isArray(parsed.categories)) {
        const statsByCat = new Map<string, CategoryStats>(topStats.map(s => [s.category, s]));
        for (const rawEntry of parsed.categories) {
          const catName = typeof rawEntry.category === 'string' ? rawEntry.category.trim().toLowerCase() : '';
          const matched = catName ? statsByCat.get(catName) : undefined;
          if (!matched) continue;
          const forecast = validateAiForecast(rawEntry, matched, today);
          if (forecast) forecasts.push(forecast);
        }
        if (forecasts.length > 0) aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/demand-forecast',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 6) Deterministic fallback if AI unavailable
    if (forecasts.length === 0) {
      forecasts = deterministicForecast(topStats, today);
    } else {
      // Fill in any categories the AI skipped with deterministic forecast
      const seenCats = new Set(forecasts.map(f => f.category));
      for (const s of topStats) {
        if (!seenCats.has(s.category)) {
          const det = deterministicForecast([s], today)[0];
          if (det) forecasts.push(det);
        }
      }
    }

    // Sort: HIGH first, then by confidenceScore desc
    const demandRank: Record<DemandLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    forecasts.sort(
      (a, b) =>
        demandRank[a.predictedDemand] - demandRank[b.predictedDemand] ||
        b.confidenceScore - a.confidenceScore,
    );
    // Cap to 10 categories
    const topForecasts = forecasts.slice(0, 10);

    const summary = buildSummary(topForecasts);

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { categories: topForecasts, summary });
    }

    return apiOk({
      ok: true,
      categories: topForecasts,
      summary,
      aiUsed,
    });
  },
});

export const GET = demandForecastHandler;
export const POST = demandForecastHandler;
