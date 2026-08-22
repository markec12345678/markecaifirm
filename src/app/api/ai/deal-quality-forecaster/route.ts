// v7.65 / v8.96.4-batch1: AI Deal Quality Forecaster — AI napove kvaliteto
// deal-ov za naslednjih 7 dni na podlagi zgodovinskih vzorcev po dnevih v tednu.
// "Torek = najboljši dan za skeniranje (avg dealScore 72, 15 oglasov).
//  Petek = najslabši (45, 8 oglasov). Načrtuj nakupe za torek."
//
// Razlika od deal-timing (ki gleda kdaj se pojavijo PRILIKA oglasi po dnevih/urah
// — zgodovinski pregled) — ta PREDVIDI prihodnje 7 dni (forecast) z AI za vsak
// dan posebej (predictedDealScore, predictedListingCount, confidenceScore,
// recommendation SCAN_ACTIVELY/SKIP/...). Razlika od seasonal-timing-optimizer
// (ki priporoča buy/sell timing za held inventar) — ta gleda najboljše dni za
// SKENIRANJE trga (kdaj obnoviti monitore in pričakovati nove dobre oglase).
//
// GET+POST /api/ai/deal-quality-forecaster
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.4-batch1) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type Recommendation =
  | 'SCAN_ACTIVELY'
  | 'SCAN_NORMAL'
  | 'SKIP'
  | 'CHECK_MORNING'
  | 'CHECK_EVENING';

interface DayOfWeekStat {
  day: string; // "Monday", "Tuesday", ...
  avgDealScore: number;
  avgEstValue: number;
  listingCount: number;
  prilikaRate: number; // %
}

interface ForecastDay {
  date: string; // ISO date
  dayOfWeek: string;
  predictedDealScore: number; // 0-100
  predictedListingCount: number;
  predictedPrilikaCount: number;
  confidenceScore: number; // 0-100
  recommendation: Recommendation;
}

interface AiForecastResponse {
  forecast?: unknown;
  bestDayReasoning?: unknown;
  trend?: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface DealQualityForecasterInput {}

// --- Helpers -------------------------------------------------------------

// English day names (matches schema requirement: "Monday", "Tuesday", etc.)
const DAY_NAMES_EN = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// Slovenian day names for AI prompt readability
const DAY_NAMES_SL = [
  'Nedelja',
  'Ponedeljek',
  'Torek',
  'Sreda',
  'Četrtek',
  'Petek',
  'Sobota',
];

const VALID_RECS: readonly Recommendation[] = [
  'SCAN_ACTIVELY',
  'SCAN_NORMAL',
  'SKIP',
  'CHECK_MORNING',
  'CHECK_EVENING',
] as const;

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

function clampEnum<T extends string>(
  raw: unknown,
  valid: readonly T[],
  fallback: T,
): T {
  const s = String(raw).trim().toUpperCase();
  for (const v of valid) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// --- Deterministic forecast (fallback) -----------------------------------

function buildDeterministicForecast(
  byDay: DayOfWeekStat[],
  recent14: {
    avgDealScore: number;
    avgListingCountPerDay: number;
    prilikaRate: number;
  },
  overallAvgListingCountPerDay: number,
): {
  forecast: ForecastDay[];
  bestDayReasoning: string;
  trend: 'IMPROVING' | 'STABLE' | 'DECLINING';
} {
  const now = new Date();
  const forecast: ForecastDay[] = [];

  // Map day-of-week stats by index (0=Sunday..6=Saturday)
  const dayMap = new Map<number, DayOfWeekStat>();
  for (let i = 0; i < 7; i++) {
    const stat = byDay.find(d => d.day === DAY_NAMES_EN[i]);
    if (stat) dayMap.set(i, stat);
  }

  // Trend: compare recent14 avg vs overall 90d avg
  let trend: 'IMPROVING' | 'STABLE' | 'DECLINING' = 'STABLE';
  const overallAvgScore =
    byDay.length > 0
      ? byDay.reduce((s, d) => s + d.avgDealScore * d.listingCount, 0) /
        Math.max(1, byDay.reduce((s, d) => s + d.listingCount, 0))
      : 0;
  const scoreDelta = recent14.avgDealScore - overallAvgScore;
  if (scoreDelta >= 5) trend = 'IMPROVING';
  else if (scoreDelta <= -5) trend = 'DECLINING';

  // For each of next 7 days (starting tomorrow)
  for (let i = 1; i <= 7; i++) {
    const date = new Date(now.getTime() + i * 86_400_000);
    const dayIdx = date.getDay(); // 0=Sun..6=Sat
    const stat = dayMap.get(dayIdx);

    // If no historical data for this day-of-week, use overall averages
    const avgDealScore = stat ? stat.avgDealScore : Math.round(overallAvgScore);
    const avgListingCount = stat ? stat.listingCount : Math.round(overallAvgListingCountPerDay);
    const prilikaRate = stat ? stat.prilikaRate : recent14.prilikaRate;

    // Apply recent trend adjustment (+/-10% based on trend)
    const trendAdj =
      trend === 'IMPROVING' ? 1.05 : trend === 'DECLINING' ? 0.95 : 1.0;

    const predictedDealScore = clampNumber(
      Math.round(avgDealScore * trendAdj),
      0,
      100,
      avgDealScore,
    );

    // Predicted listing count: based on historical avg for this day-of-week
    // (most recent 14 days weigh more if trend is shifting)
    const recentCountWeight = trend === 'IMPROVING' || trend === 'DECLINING' ? 0.4 : 0.2;
    const blendedCount = Math.round(
      avgListingCount * (1 - recentCountWeight) +
        recent14.avgListingCountPerDay * recentCountWeight,
    );
    const predictedListingCount = Math.max(0, blendedCount);

    // Predicted prilika count = predictedListingCount × prilikaRate / 100
    const predictedPrilikaCount = Math.max(
      0,
      Math.round((predictedListingCount * prilikaRate) / 100),
    );

    // Confidence: based on sample size (listingCount for this day-of-week) +
    // consistency (how much variance from overall avg). 0-100.
    let confidence = 30;
    if (stat) {
      // More samples = more confidence
      if (stat.listingCount >= 30) confidence += 30;
      else if (stat.listingCount >= 15) confidence += 25;
      else if (stat.listingCount >= 7) confidence += 18;
      else if (stat.listingCount >= 3) confidence += 10;
      // Small variance from overall = more confidence
      const variance = Math.abs(avgDealScore - overallAvgScore);
      if (variance <= 5) confidence += 15;
      else if (variance <= 10) confidence += 10;
      else if (variance <= 20) confidence += 5;
    }
    // Recent trend stability adds confidence
    if (trend === 'STABLE') confidence += 10;
    confidence = clampNumber(confidence, 0, 100, 40);

    // Recommendation: based on predicted deal score + prilika count
    let recommendation: Recommendation;
    if (predictedDealScore >= 65 && predictedPrilikaCount >= 2) {
      recommendation = 'SCAN_ACTIVELY';
    } else if (predictedDealScore >= 50 && predictedPrilikaCount >= 1) {
      recommendation = 'SCAN_NORMAL';
    } else if (predictedDealScore < 35 && predictedListingCount < 4) {
      recommendation = 'SKIP';
    } else if (predictedDealScore >= 45) {
      // Moderately decent day — check morning (often when listings appear)
      recommendation = 'CHECK_MORNING';
    } else {
      recommendation = 'CHECK_EVENING';
    }

    forecast.push({
      date: isoDate(date),
      dayOfWeek: DAY_NAMES_EN[dayIdx],
      predictedDealScore,
      predictedListingCount,
      predictedPrilikaCount,
      confidenceScore: confidence,
      recommendation,
    });
  }

  // Best day = highest predictedDealScore (ties broken by higher prilika count)
  const bestDay = [...forecast].sort(
    (a, b) =>
      b.predictedDealScore - a.predictedDealScore ||
      b.predictedPrilikaCount - a.predictedPrilikaCount,
  )[0];

  const bestDayReasoning = bestDay
    ? `${bestDay.dayOfWeek} (${bestDay.date}) = najboljši dan: predicted dealScore ${bestDay.predictedDealScore}, ${bestDay.predictedPrilikaCount} pričakovanih prilik, confidence ${bestDay.confidenceScore}%. Trend: ${trend}.`
    : 'Ni napovedi — nezadostni podatki.';

  return { forecast, bestDayReasoning, trend };
}

// --- Prompt builder ------------------------------------------------------

interface PromptArgs {
  listingsLength: number;
  byDayOfWeek: DayOfWeekStat[];
  bestDay: string;
  worstDay: string;
  recent14AvgDealScore: number;
  recent14AvgListingCountPerDay: number;
  overallAvgListingCountPerDay: number;
  recent14Prilika: number;
  det: {
    forecast: ForecastDay[];
    bestDayReasoning: string;
    trend: 'IMPROVING' | 'STABLE' | 'DECLINING';
  };
  maxListingCountPerDayX2: number;
}

function buildPrompt(args: PromptArgs): string {
  const {
    listingsLength,
    byDayOfWeek,
    bestDay,
    worstDay,
    recent14AvgDealScore,
    recent14AvgListingCountPerDay,
    overallAvgListingCountPerDay,
    recent14Prilika,
    det,
    maxListingCountPerDayX2,
  } = args;

  const dayBlock = byDayOfWeek
    .map(
      d =>
        `- ${d.day} (SL: ${DAY_NAMES_SL[DAY_NAMES_EN.indexOf(d.day)]}): avgDealScore=${d.avgDealScore}, avgEstValue=${d.avgEstValue}€, listingCount=${d.listingCount}, prilikaRate=${d.prilikaRate}%`,
    )
    .join('\n');

  const overall90dAvg = byDayOfWeek.reduce((s, d) => s + d.avgDealScore * d.listingCount, 0) / Math.max(1, listingsLength);
  const overall90dAvgRounded = overall90dAvg > 0 ? Math.round(overall90dAvg) : 0;

  return `Si AI napovedovalec kvalitete deal-ov za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Na podlagi ZGODOVINSKIH vzorcev po dnevih v tednu (zadnjih 90 dni) in recent trend-a (zadnjih 14 dni) napovi kvaliteto deal-ov za naslednjih 7 dni.

ZGODOVINSKI VZORCI (po dnevih v tednu, zadnjih 90 dni, skupno ${listingsLength} oglasov):
${dayBlock}

BEST dan (zgodovinsko): ${bestDay}
WORST dan (zgodovinsko): ${worstDay}

RECENT TREND (zadnjih 14 dni):
- avgDealScore: ${recent14AvgDealScore} (90d avg: ${overall90dAvgRounded})
- avg listingCount/day: ${recent14AvgListingCountPerDay} (90d avg: ${overallAvgListingCountPerDay}/day)
- prilikaRate: ${recent14Prilika}%

DETERMINISTIČNA OSNOVA (uporabi kot referenco, AI lahko prilagodi ±20%):
${det.forecast
  .map(
    f =>
      `- ${f.date} (${f.dayOfWeek}): predvideno dealScore=${f.predictedDealScore}, listingCount=${f.predictedListingCount}, prilikaCount=${f.predictedPrilikaCount}, confidence=${f.confidenceScore}, rec=${f.recommendation}`,
  )
  .join('\n')}

PRAVILA ZA NAPOVED:
1. Za vsak od naslednjih 7 dni (start jutri) izračunaj:
   - predictedDealScore (0-100, clamp): baziraj na zgodovinskem avg za ta dan v tednu, prilagodi glede na recent trend (±20%).
   - predictedListingCount: baziraj na zgodovinskem avg za ta dan v tednu (clamp 0 do 2× max historical listingCount = ${maxListingCountPerDayX2}).
   - predictedPrilikaCount: predictedListingCount × prilikaRate / 100 (clamp 0+).
   - confidenceScore (0-100, clamp): višji če je več zgodovinskih podatkov + nižja variansa.
   - recommendation: SCAN_ACTIVELY (dealScore >= 65 in prilikaCount >= 2), SCAN_NORMAL (50-64 in prilika >= 1), SKIP (< 35 in < 4 listings), CHECK_MORNING (45+ z malo prilik — jutra so aktivna), CHECK_EVENING (drugače).
2. trend: IMPROVING (recent > 90d avg +5), STABLE (±5), DECLINING (recent < 90d avg -5).
3. bestDayReasoning: 1-2 povedi slovensko, zakaj je izbran najboljši dan (z navedbo specificnih številk).

VRNI LE JSON:
{
  "forecast": [
    { "date": "YYYY-MM-DD", "dayOfWeek": "Monday", "predictedDealScore": 70, "predictedListingCount": 12, "predictedPrilikaCount": 3, "confidenceScore": 65, "recommendation": "SCAN_ACTIVELY" }
  ],
  "bestDayReasoning": "Torek = najboljši dan: ...",
  "trend": "IMPROVING|STABLE|DECLINING"
}${GROUNDING_PROMPT_SUFFIX}`;
}

// --- AI response parser --------------------------------------------------

interface ParsedArgs {
  parsed: AiForecastResponse | null;
  det: {
    forecast: ForecastDay[];
    bestDayReasoning: string;
    trend: 'IMPROVING' | 'STABLE' | 'DECLINING';
  };
  listingCountUpperBound: number;
}

function parseAiForecast(args: ParsedArgs): {
  forecast: ForecastDay[];
  bestDayReasoning: string;
  trend: 'IMPROVING' | 'STABLE' | 'DECLINING';
  aiUsed: boolean;
} {
  const { parsed, det, listingCountUpperBound } = args;

  if (!parsed) {
    return {
      forecast: det.forecast,
      bestDayReasoning: det.bestDayReasoning,
      trend: det.trend,
      aiUsed: false,
    };
  }

  const aiForecast: ForecastDay[] = [];
  if (Array.isArray(parsed.forecast)) {
    for (let i = 0; i < Math.min(parsed.forecast.length, 7); i++) {
      const f = parsed.forecast[i] as Record<string, unknown> | null;
      if (!f || typeof f !== 'object') continue;
      // Determine date — use deterministic date if AI didn't provide valid one
      const detDay = det.forecast[i];
      const aiDate =
        typeof f.date === 'string' && f.date.length === 10
          ? f.date
          : detDay.date;
      const aiDayOfWeek =
        typeof f.dayOfWeek === 'string' &&
        DAY_NAMES_EN.includes(f.dayOfWeek as (typeof DAY_NAMES_EN)[number])
          ? (f.dayOfWeek as string)
          : detDay.dayOfWeek;
      const predictedDealScore = clampNumber(
        f.predictedDealScore,
        0,
        100,
        detDay.predictedDealScore,
      );
      const predictedListingCount = clampNumber(
        f.predictedListingCount,
        0,
        listingCountUpperBound,
        detDay.predictedListingCount,
      );
      const predictedPrilikaCount = clampNumber(
        f.predictedPrilikaCount,
        0,
        predictedListingCount,
        detDay.predictedPrilikaCount,
      );
      const confidenceScore = clampNumber(
        f.confidenceScore,
        0,
        100,
        detDay.confidenceScore,
      );
      const recommendation = clampEnum(
        f.recommendation,
        VALID_RECS,
        detDay.recommendation,
      );
      aiForecast.push({
        date: aiDate,
        dayOfWeek: aiDayOfWeek,
        predictedDealScore,
        predictedListingCount,
        predictedPrilikaCount,
        confidenceScore,
        recommendation,
      });
    }
  }

  const forecast = aiForecast.length > 0 ? aiForecast : det.forecast;
  const bestDayReasoning = clampString(
    parsed.bestDayReasoning,
    400,
    det.bestDayReasoning,
  );
  const trend = clampEnum(
    parsed.trend,
    ['IMPROVING', 'STABLE', 'DECLINING'] as const,
    det.trend,
  );

  return { forecast, bestDayReasoning, trend, aiUsed: true };
}

// --- Handler -------------------------------------------------------------

const dealQualityHandler = withAiRoute<DealQualityForecasterInput>({
  endpoint: '/api/ai/deal-quality-forecaster',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // dual GET+POST

  parseBody: async () => {
    // Body ignored — forecast uses global listing history
    return {};
  },

  // No validateInput — body ignored

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    const now = Date.now();
    const dayMs = 86_400_000;

    // 1) Query all listings from last 90 days with dealScore/aiEstimatedValue/aiVerdict
    const listings = await db.listing.findMany({
      where: {
        isHidden: false,
        firstSeenAt: { gte: new Date(now - 90 * dayMs) },
        OR: [{ dealScore: { not: null } }, { aiEstimatedValue: { not: null } }],
      },
      select: {
        id: true,
        firstSeenAt: true,
        dealScore: true,
        aiEstimatedValue: true,
        aiVerdict: true,
      },
      take: 10000,
    });

    // Empty state — return gracefully
    if (listings.length === 0) {
      return apiOk({
        ok: true,
        historical: {
          byDayOfWeek: [],
          bestDay: '—',
          worstDay: '—',
          totalListings90d: 0,
        },
        forecast: [],
        summary: {
          bestDayToScan: null,
          bestDayReasoning:
            'Ni zgodovinskih oglasov v zadnjih 90 dneh — Forecast ni mogoč. Začni zbirati monitore.',
          avgConfidence: 0,
          trend: 'STABLE',
        },
        aiUsed: false,
        message:
          'Ni oglasov v zadnjih 90 dneh — Deal Quality Forecaster potrebuje vsaj nekaj zgodovine.',
      });
    }

    // 2) Group by day of week
    const dayAgg = new Map<
      number,
      {
        scoreSum: number;
        scoreCount: number;
        estValueSum: number;
        estValueCount: number;
        listingCount: number;
        prilikaCount: number;
      }
    >();
    for (let i = 0; i < 7; i++) {
      dayAgg.set(i, {
        scoreSum: 0,
        scoreCount: 0,
        estValueSum: 0,
        estValueCount: 0,
        listingCount: 0,
        prilikaCount: 0,
      });
    }

    for (const l of listings) {
      if (!l.firstSeenAt) continue;
      const d = new Date(l.firstSeenAt);
      const dayIdx = d.getDay();
      const agg = dayAgg.get(dayIdx);
      if (!agg) continue;
      agg.listingCount += 1;
      if (l.dealScore != null) {
        agg.scoreSum += l.dealScore;
        agg.scoreCount += 1;
      }
      if (l.aiEstimatedValue != null) {
        agg.estValueSum += l.aiEstimatedValue;
        agg.estValueCount += 1;
      }
      if (l.aiVerdict === 'PRILIKA') {
        agg.prilikaCount += 1;
      }
    }

    const byDayOfWeek: DayOfWeekStat[] = [];
    for (let i = 0; i < 7; i++) {
      const agg = dayAgg.get(i)!;
      const avgDealScore = agg.scoreCount > 0 ? Math.round(agg.scoreSum / agg.scoreCount) : 0;
      const avgEstValue =
        agg.estValueCount > 0 ? Math.round(agg.estValueSum / agg.estValueCount) : 0;
      const prilikaRate =
        agg.listingCount > 0
          ? Math.round((agg.prilikaCount / agg.listingCount) * 100)
          : 0;
      byDayOfWeek.push({
        day: DAY_NAMES_EN[i],
        avgDealScore,
        avgEstValue,
        listingCount: agg.listingCount,
        prilikaRate,
      });
    }

    // Best / worst day (by avgDealScore, min 5 listings)
    const withData = byDayOfWeek.filter(d => d.listingCount >= 5);
    const bestDay =
      withData.length > 0
        ? [...withData].sort((a, b) => b.avgDealScore - a.avgDealScore)[0].day
        : byDayOfWeek[0]?.day ?? '—';
    const worstDay =
      withData.length > 0
        ? [...withData].sort((a, b) => a.avgDealScore - b.avgDealScore)[0].day
        : byDayOfWeek[0]?.day ?? '—';

    // 3) Recent 14 days trend
    const recent14Cutoff = new Date(now - 14 * dayMs);
    const recent14Listings = listings.filter(
      l => l.firstSeenAt && new Date(l.firstSeenAt) >= recent14Cutoff,
    );
    const recent14Scored = recent14Listings.filter(l => l.dealScore != null);
    const recent14AvgDealScore =
      recent14Scored.length > 0
        ? Math.round(
            recent14Scored.reduce((s, l) => s + (l.dealScore ?? 0), 0) /
              recent14Scored.length,
          )
        : 0;
    const recent14AvgListingCountPerDay =
      recent14Listings.length > 0 ? Math.round(recent14Listings.length / 14) : 0;
    const recent14Prilika =
      recent14Listings.length > 0
        ? Math.round(
            (recent14Listings.filter(l => l.aiVerdict === 'PRILIKA').length /
              recent14Listings.length) *
              100,
          )
        : 0;

    // Overall avg listings per day (90d)
    const overallAvgListingCountPerDay = Math.round(listings.length / 90);

    const recent14 = {
      avgDealScore: recent14AvgDealScore,
      avgListingCountPerDay: recent14AvgListingCountPerDay,
      prilikaRate: recent14Prilika,
    };

    // 4) Build deterministic forecast as fallback base
    const det = buildDeterministicForecast(
      byDayOfWeek,
      recent14,
      overallAvgListingCountPerDay,
    );

    // 5) AI cache — keyed by current ISO week (refreshes weekly)
    const currentWeek = isoDate(new Date(now));
    const cacheKey = `deal-quality-forecaster:${currentWeek}`;
    const cached = getCachedAI<{
      forecast: ForecastDay[];
      bestDayReasoning: string;
      trend: 'IMPROVING' | 'STABLE' | 'DECLINING';
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        historical: {
          byDayOfWeek,
          bestDay,
          worstDay,
          totalListings90d: listings.length,
        },
        forecast: cached.forecast,
        summary: {
          bestDayToScan:
            cached.forecast.length > 0
              ? [...cached.forecast].sort(
                  (a, b) =>
                    b.predictedDealScore - a.predictedDealScore ||
                    b.predictedPrilikaCount - a.predictedPrilikaCount,
                )[0]?.date ?? null
              : null,
          bestDayReasoning: cached.bestDayReasoning,
          avgConfidence:
            cached.forecast.length > 0
              ? Math.round(
                  cached.forecast.reduce((s, d) => s + d.confidenceScore, 0) /
                    cached.forecast.length,
                )
              : 0,
          trend: cached.trend,
        },
        cached: true,
        aiUsed: true,
      });
    }

    // 6) AI prompt with grounding
    const maxListingCountPerDay = Math.max(
      ...byDayOfWeek.map(d => d.listingCount),
      0,
    );
    const listingCountUpperBound = maxListingCountPerDay * 2;

    const prompt = buildPrompt({
      listingsLength: listings.length,
      byDayOfWeek,
      bestDay,
      worstDay,
      recent14AvgDealScore,
      recent14AvgListingCountPerDay,
      overallAvgListingCountPerDay,
      recent14Prilika,
      det,
      maxListingCountPerDayX2: maxListingCountPerDay * 2,
    });

    let aiUsed = false;
    let forecast: ForecastDay[] = det.forecast;
    let bestDayReasoning = det.bestDayReasoning;
    let trend: 'IMPROVING' | 'STABLE' | 'DECLINING' = det.trend;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiForecastResponse | null;
      const result = parseAiForecast({ parsed, det, listingCountUpperBound });
      forecast = result.forecast;
      bestDayReasoning = result.bestDayReasoning;
      trend = result.trend;
      aiUsed = result.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/deal-quality-forecaster',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { forecast, bestDayReasoning, trend });
    }

    // 8) Build best day to scan (highest predictedDealScore, tie-break by prilika count)
    const bestForecast = [...forecast].sort(
      (a, b) =>
        b.predictedDealScore - a.predictedDealScore ||
        b.predictedPrilikaCount - a.predictedPrilikaCount,
    )[0];
    const bestDayToScan = bestForecast?.date ?? null;
    const avgConfidence =
      forecast.length > 0
        ? Math.round(
            forecast.reduce((s, d) => s + d.confidenceScore, 0) / forecast.length,
          )
        : 0;

    return apiOk({
      ok: true,
      historical: {
        byDayOfWeek,
        bestDay,
        worstDay,
        totalListings90d: listings.length,
      },
      forecast,
      summary: {
        bestDayToScan,
        bestDayReasoning,
        avgConfidence,
        trend,
      },
      aiUsed,
    });
  },
});

export const GET = dealQualityHandler;
export const POST = dealQualityHandler;
