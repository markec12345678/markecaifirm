// v7.70 / v8.96.4-batch1: AI Profit Stream Predictor — AI napoveduje "profit
// stream" — vzorce ponavljajočega se profita. Identificira katere kategorije/
// zbirke prinašajo stalen (STEADY) vs. sporadičen (ERRATIC) profit in projektira
// 90-dnevni tok profita z intervali zaupanja. Razlika od profit-forecast (ki vrne
// eno številko) — ta prikaze VZOREC profita (steady vs. lumpy).
//
// "Profit stream: STEADY (volatility 0.2, consistency 85/100). 90d projection:
//  2400€. Najbolj zanesljiva: elektronika."
//
// Razlika od profit-forecast (ki vrne skupno napovedano številko za obdobje) —
// ta prikaze VZOREC profita po tednih z intervali zaupanja. Razlika od
// profit-dashboard (ki je real-time dashboard) — ta je napoved 90 dni vnaprej.
// Razlika od cash-flow-forecast (ki gleda cash flow in/out) — ta gleda samo
// profit tok. Razlika od profit-efficiency-analyzer (ki meri profit per dan) —
// ta gleda konsistentnost profita skozi čas. Razlika od profit-margin-heatmap
// (ki gleda margine po kategoriji/ceni) — ta gleda tok profita skozi čas.
//
// GET+POST /api/ai/profit-stream-predictor
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.4-batch1) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type StreamType = 'STEADY' | 'VARIABLE' | 'ERRATIC';

interface StreamAnalysis {
  avgWeeklyProfit: number;
  profitVolatility: number; // stdev / mean (lower = more stable)
  consistencyScore: number; // 0-100
  streamType: StreamType;
  totalWeeksAnalyzed: number;
}

interface CategoryStream {
  category: string;
  weeklyProfit: number;
  reliability: number; // 0-100
  streamType: StreamType;
  contribution: number; // % of total profit
}

interface ProjectionWeek {
  week: number;
  projectedProfit: number;
  confidenceLow: number;
  confidenceHigh: number;
}

interface ProjectionSummary {
  projectedTotalProfit90d: number;
  bestWeek: { week: number; profit: number };
  worstWeek: { week: number; profit: number };
  profitStabilityAdvice: string;
}

interface AiStreamResponse {
  projection?: unknown;
  summary?: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitStreamPredictorInput {}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEKS_HISTORY = 26; // ~180 days
const WEEKS_FORECAST = 13; // ~90 days

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

// Compute mean and standard deviation (population).
function computeStats(values: number[]): {
  mean: number;
  stdev: number;
} {
  const n = values.length;
  if (n === 0) return { mean: 0, stdev: 0 };
  const sum = values.reduce((s, x) => s + x, 0);
  const mean = sum / n;
  if (n === 1) return { mean, stdev: 0 };
  const variance =
    values.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  return { mean, stdev: Math.sqrt(Math.max(0, variance)) };
}

function deriveStreamType(volatility: number): StreamType {
  if (volatility < 0.3) return 'STEADY';
  if (volatility < 0.6) return 'VARIABLE';
  return 'ERRATIC';
}

// Consistency score: lower volatility → higher score.
// volatility 0 → 100, volatility 1 → 0, clamp.
function deriveConsistencyScore(volatility: number): number {
  if (volatility <= 0) return 100;
  const score = Math.round((1 - Math.min(1, volatility)) * 100);
  return Math.max(0, Math.min(100, score));
}

// Linear slope of values.
function computeSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xs = values.map((_, i) => i);
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = values.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (values[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

// --- Deterministic projection (fallback) ---------------------------------

interface WeeklyData {
  weekIdx: number; // 0 = oldest, 25 = newest
  profit: number;
  trades: number;
}

function buildDeterministicProjection(
  weeklyHistory: WeeklyData[],
  avgWeeklyProfit: number,
  stdev: number,
): { projection: ProjectionWeek[]; summary: ProjectionSummary } {
  const recent = weeklyHistory.slice(-8); // last 8 weeks trend
  const recentMean =
    recent.length > 0
      ? recent.reduce((s, w) => s + w.profit, 0) / recent.length
      : avgWeeklyProfit;
  const recentStats = computeStats(recent.map(w => w.profit));
  const recentSlope = computeSlope(recent.map(w => w.profit));

  // Linear projection: project = recentMean + slope × weekIndex
  // Clamped to [0, avgWeeklyProfit × 3]
  const maxCap = Math.max(0, avgWeeklyProfit * 3);

  const projection: ProjectionWeek[] = [];
  for (let i = 1; i <= WEEKS_FORECAST; i++) {
    const trend = recentMean + recentSlope * i;
    const projected = Math.max(
      0,
      Math.min(maxCap, Math.round(trend)),
    );
    // Confidence interval: ±1 stdev from projection (wider further out)
    const width = Math.max(stdev, recentStats.stdev) * (1 + i * 0.05);
    const confidenceLow = Math.max(0, Math.round(projected - width));
    const confidenceHigh = Math.min(maxCap, Math.round(projected + width));
    projection.push({
      week: i,
      projectedProfit: projected,
      confidenceLow,
      confidenceHigh,
    });
  }

  // Summary
  const projectedTotalProfit90d = projection.reduce(
    (s, w) => s + w.projectedProfit,
    0,
  );
  let bestWeek: ProjectionWeek | null = null;
  let worstWeek: ProjectionWeek | null = null;
  for (const w of projection) {
    if (!bestWeek || w.projectedProfit > bestWeek.projectedProfit) {
      bestWeek = w;
    }
    if (!worstWeek || w.projectedProfit < worstWeek.projectedProfit) {
      worstWeek = w;
    }
  }

  const volatility = avgWeeklyProfit > 0 ? stdev / avgWeeklyProfit : 0;
  let advice: string;
  if (volatility < 0.3) {
    advice = `Profit stream je STEADY (volatilnost ${volatility.toFixed(2)}). Vzdržuj trenutno kategorijo fokus in pospeši nabavo v najbolj zanesljivih kategorijah.`;
  } else if (volatility < 0.6) {
    advice = `Profit stream je VARIABLE (volatilnost ${volatility.toFixed(2)}). Diverzificiraj kategorije za stabilnejši tok — fokusiraj se na kategorije z reliability >70.`;
  } else {
    advice = `Profit stream je ERRATIC (volatilnost ${volatility.toFixed(2)}). Kritično: gradi zalogo v stabilnih kategorijah (reliability >70) in zmanjšaj odvisnost od redkih velikih poslov.`;
  }

  return {
    projection,
    summary: {
      projectedTotalProfit90d,
      bestWeek: {
        week: bestWeek?.week ?? 1,
        profit: bestWeek?.projectedProfit ?? 0,
      },
      worstWeek: {
        week: worstWeek?.week ?? 1,
        profit: worstWeek?.projectedProfit ?? 0,
      },
      profitStabilityAdvice: advice,
    },
  };
}

// --- Prompt builder ------------------------------------------------------

interface PromptArgs {
  weeklyHistory: WeeklyData[];
  avgWeeklyProfit: number;
  profitVolatility: number;
  consistencyScore: number;
  streamType: StreamType;
  categoryStreams: CategoryStream[];
  maxCap: number;
}

function buildPrompt(args: PromptArgs): string {
  const {
    weeklyHistory,
    avgWeeklyProfit,
    profitVolatility,
    consistencyScore,
    streamType,
    categoryStreams,
    maxCap,
  } = args;

  const weeklyHistoryBlock = weeklyHistory
    .map(w => `W${w.weekIdx}: profit=${w.profit}€, trades=${w.trades}`)
    .join('\n');

  const categoryBlock = categoryStreams
    .slice(0, 15)
    .map(
      c =>
        `- ${c.category}: weeklyProfit=${c.weeklyProfit}€, reliability=${c.reliability}/100, type=${c.streamType}, contribution=${c.contribution}%`,
    )
    .join('\n');

  return `Si AI analitik profitnih tokov za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Analiziraj "profit stream" — VZOREC ponavljajočega se profita skozi čas. Ali je profit stalen (STEADY) ali sporadičen (ERRATIC)? Projekciraj 90-dnevni tok profita z intervali zaupanja.

PODATKI O TEDENSKEM PROFITU (zadnjih 26 tednov, W0 = najstarejši, W25 = najnovejši):
${weeklyHistoryBlock}

ZNAČILNOSTI TOKA:
- avgWeeklyProfit: ${avgWeeklyProfit}€
- profitVolatility: ${profitVolatility} (stdev / mean, nižje = bolj stabilno)
- consistencyScore: ${consistencyScore}/100
- streamType: ${streamType}

KATEGORIJE PROFITNIH TOKOV (top ${Math.min(15, categoryStreams.length)}):
${categoryBlock || '—'}

PRAVILA ZA PROJEKCIJO:
1. projection: 13 tednov (90 dni) projekcija. Za vsak teden:
   - projectedProfit: EUR (lahko trend-up če zgodovina kaže rast, ali trend-down če padec)
   - confidenceLow / confidenceHigh: ±1 stdev interval (širši naprej)
   - Vsak projectedProfit mora biti v [0, ${maxCap.toFixed(2)}] (avgWeeklyProfit × 3)
2. summary.projectedTotalProfit90d: vsota vseh 13 tednov
3. summary.bestWeek: teden z najvišjim projectedProfit (week 1-13, profit)
4. summary.worstWeek: teden z najnižjim projectedProfit (week 1-13, profit)
5. summary.profitStabilityAdvice: konkreten nasvet (1-2 stavka) kako stabilizirati profit stream — npr. "diverzificiraj v elektroniko (reliability 85), zmanjšaj modno oblačilo (reliability 40)"

VRNI LE JSON:
{
  "projection": [
    { "week": 1, "projectedProfit": 0, "confidenceLow": 0, "confidenceHigh": 0 }
  ],
  "summary": {
    "projectedTotalProfit90d": 0,
    "bestWeek": { "week": 1, "profit": 0 },
    "worstWeek": { "week": 1, "profit": 0 },
    "profitStabilityAdvice": "..."
  }
}${GROUNDING_PROMPT_SUFFIX}`;
}

// --- AI response parser --------------------------------------------------

function parseAiStream(
  parsed: AiStreamResponse | null,
  baseline: { projection: ProjectionWeek[]; summary: ProjectionSummary },
  maxCap: number,
): { projection: ProjectionWeek[]; summary: ProjectionSummary; aiUsed: boolean } {
  if (!parsed || typeof parsed !== 'object') {
    return { projection: baseline.projection, summary: baseline.summary, aiUsed: false };
  }

  let projection: ProjectionWeek[] = baseline.projection;
  let summary: ProjectionSummary = baseline.summary;

  // Parse projection (13 weeks)
  if (Array.isArray(parsed.projection)) {
    const aiProj: ProjectionWeek[] = [];
    for (const p of parsed.projection) {
      const a = p as Record<string, unknown> | null;
      if (!a || typeof a !== 'object') continue;
      const week = clampNumber(a.week, 1, WEEKS_FORECAST, 1);
      const projectedProfit = clampNumber(
        a.projectedProfit,
        0,
        maxCap,
        0,
      );
      const confidenceLow = clampNumber(
        a.confidenceLow,
        0,
        projectedProfit,
        0,
      );
      const confidenceHigh = clampNumber(
        a.confidenceHigh,
        projectedProfit,
        maxCap,
        projectedProfit,
      );
      aiProj.push({
        week,
        projectedProfit: Math.round(projectedProfit),
        confidenceLow: Math.round(confidenceLow),
        confidenceHigh: Math.round(confidenceHigh),
      });
    }
    if (aiProj.length > 0) {
      // Ensure 13 weeks: pad missing weeks from baseline
      const byWeek = new Map(aiProj.map(p => [p.week, p]));
      projection = [];
      for (let i = 1; i <= WEEKS_FORECAST; i++) {
        const p = byWeek.get(i);
        if (p) projection.push(p);
        else {
          const b = baseline.projection[i - 1];
          if (b) projection.push(b);
        }
      }
    }
  }

  // Parse summary
  if (parsed.summary && typeof parsed.summary === 'object') {
    const s = parsed.summary as Record<string, unknown>;
    const projectedTotalProfit90d = clampNumber(
      s.projectedTotalProfit90d,
      0,
      maxCap * WEEKS_FORECAST * 2,
      projection.reduce((sum, w) => sum + w.projectedProfit, 0),
    );
    const bestWeekRaw = s.bestWeek as
      | Record<string, unknown>
      | undefined;
    const worstWeekRaw = s.worstWeek as
      | Record<string, unknown>
      | undefined;

    let bestWeek = baseline.summary.bestWeek;
    if (bestWeekRaw && typeof bestWeekRaw === 'object') {
      bestWeek = {
        week: clampNumber(bestWeekRaw.week, 1, WEEKS_FORECAST, 1),
        profit: clampNumber(
          bestWeekRaw.profit,
          0,
          maxCap,
          bestWeek.profit,
        ),
      };
    }
    let worstWeek = baseline.summary.worstWeek;
    if (worstWeekRaw && typeof worstWeekRaw === 'object') {
      worstWeek = {
        week: clampNumber(worstWeekRaw.week, 1, WEEKS_FORECAST, 1),
        profit: clampNumber(
          worstWeekRaw.profit,
          0,
          maxCap,
          worstWeek.profit,
        ),
      };
    }

    const profitStabilityAdvice = clampString(
      s.profitStabilityAdvice,
      500,
      baseline.summary.profitStabilityAdvice,
    );

    summary = {
      projectedTotalProfit90d: Math.round(projectedTotalProfit90d),
      bestWeek: {
        week: bestWeek.week,
        profit: Math.round(bestWeek.profit),
      },
      worstWeek: {
        week: worstWeek.week,
        profit: Math.round(worstWeek.profit),
      },
      profitStabilityAdvice,
    };
  }

  return { projection, summary, aiUsed: true };
}

// --- Handler -------------------------------------------------------------

const profitStreamHandler = withAiRoute<ProfitStreamPredictorInput>({
  endpoint: '/api/ai/profit-stream-predictor',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // dual GET+POST (konsistentno z vsemi prejšnjimi batchi)

  parseBody: async () => {
    // Body ignored — analysis uses global trade history
    return {};
  },

  // No validateInput — body ignored

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    // 1) Query all SOLD trades from last 180 days
    const cutoff = new Date(Date.now() - 180 * DAY_MS);
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: cutoff },
        buyPrice: { gt: 0 },
        sellPrice: { not: null },
      },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
      },
      take: 5000,
    });

    // Empty state
    if (soldTrades.length === 0) {
      return apiOk({
        ok: true,
        streamAnalysis: {
          avgWeeklyProfit: 0,
          profitVolatility: 0,
          consistencyScore: 0,
          streamType: 'STEADY' as StreamType,
          totalWeeksAnalyzed: 0,
        },
        categoryStreams: [],
        projection: [],
        summary: {
          projectedTotalProfit90d: 0,
          bestWeek: { week: 1, profit: 0 },
          worstWeek: { week: 1, profit: 0 },
          profitStabilityAdvice:
            'Ni prodanih trade-ov v zadnjih 180 dneh — Profit Stream analiza ni mogoča. Dodaš trades z buyDate in sellDate za začetek.',
        },
        aiUsed: false,
        message:
          'Ni prodanih trade-ov v zadnjih 180 dneh — Profit Stream analiza ni mogoča.',
      });
    }

    // 2) Group by week (26 weeks, 0 = oldest)
    const nowMs = Date.now();
    const weekMs = 7 * DAY_MS;
    void weekMs; // kept for documentation
    const weeklyMap = new Map<number, { profit: number; trades: number }>();
    const categoryWeeklyMap = new Map<
      string,
      Map<number, { profit: number; trades: number }>
    >();

    for (const t of soldTrades) {
      const sellDateMs = t.sellDate ? new Date(t.sellDate).getTime() : null;
      if (!sellDateMs) continue;
      const ageDays = (nowMs - sellDateMs) / DAY_MS;
      if (ageDays < 0) continue;
      const weekIdx = Math.min(
        WEEKS_HISTORY - 1,
        Math.max(0, Math.floor(ageDays / 7)),
      );
      // reverse: 0 = oldest, 25 = newest
      const reverseWeek = WEEKS_HISTORY - 1 - weekIdx;

      const buyPrice = t.buyPrice ?? 0;
      const buyFees = t.buyFees ?? 0;
      const sellPrice = t.sellPrice ?? 0;
      const sellFees = t.sellFees ?? 0;
      const profit = sellPrice - sellFees - buyPrice - buyFees;

      const cur = weeklyMap.get(reverseWeek) || { profit: 0, trades: 0 };
      cur.profit += profit;
      cur.trades += 1;
      weeklyMap.set(reverseWeek, cur);

      const category = (t.category || 'drugo').trim().toLowerCase() || 'drugo';
      let catMap = categoryWeeklyMap.get(category);
      if (!catMap) {
        catMap = new Map();
        categoryWeeklyMap.set(category, catMap);
      }
      const catCur = catMap.get(reverseWeek) || { profit: 0, trades: 0 };
      catCur.profit += profit;
      catCur.trades += 1;
      catMap.set(reverseWeek, catCur);
    }

    // Build weekly history array (fill 0 for missing weeks)
    const weeklyHistory: WeeklyData[] = [];
    for (let w = 0; w < WEEKS_HISTORY; w++) {
      const wd = weeklyMap.get(w);
      weeklyHistory.push({
        weekIdx: w,
        profit: Math.round((wd?.profit ?? 0) * 100) / 100,
        trades: wd?.trades ?? 0,
      });
    }

    // 3) Compute stream characteristics
    const weeklyProfits = weeklyHistory.map(w => w.profit);
    const { mean, stdev } = computeStats(weeklyProfits);
    const avgWeeklyProfit = Math.round(mean * 100) / 100;
    const profitVolatility =
      mean > 0 ? Math.round((stdev / mean) * 100) / 100 : 0;
    const consistencyScore = deriveConsistencyScore(profitVolatility);
    const streamType = deriveStreamType(profitVolatility);

    const streamAnalysis: StreamAnalysis = {
      avgWeeklyProfit,
      profitVolatility,
      consistencyScore,
      streamType,
      totalWeeksAnalyzed: WEEKS_HISTORY,
    };

    // 4) Per-category profit stream analysis
    const totalProfit = weeklyProfits.reduce((s, p) => s + p, 0);
    const categoryStreams: CategoryStream[] = [];

    for (const [category, catMap] of categoryWeeklyMap.entries()) {
      const catWeekly: number[] = [];
      let catTotalProfit = 0;
      let catTotalTrades = 0;
      for (let w = 0; w < WEEKS_HISTORY; w++) {
        const wd = catMap.get(w);
        const profit = wd?.profit ?? 0;
        catWeekly.push(profit);
        catTotalProfit += profit;
        catTotalTrades += wd?.trades ?? 0;
      }
      if (catTotalTrades === 0) continue;

      const catStats = computeStats(catWeekly);
      const catMean = catStats.mean;
      const catVolatility = catMean > 0 ? catStats.stdev / catMean : 0;
      const catConsistency = deriveConsistencyScore(catVolatility);
      const catStreamType = deriveStreamType(catVolatility);
      const contribution =
        totalProfit > 0
          ? Math.round((catTotalProfit / totalProfit) * 1000) / 10
          : 0;

      categoryStreams.push({
        category,
        weeklyProfit: Math.round(catMean * 100) / 100,
        reliability: catConsistency,
        streamType: catStreamType,
        contribution,
      });
    }

    // Sort category streams: by contribution desc (most profit-bearing first)
    categoryStreams.sort((a, b) => b.contribution - a.contribution);

    // 5) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `profit-stream-predictor:${currentMonth}`;
    const cached = getCachedAI<{
      projection: ProjectionWeek[];
      summary: ProjectionSummary;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        streamAnalysis,
        categoryStreams,
        projection: cached.projection,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 6) Build deterministic baseline
    const baseline = buildDeterministicProjection(
      weeklyHistory,
      avgWeeklyProfit,
      stdev,
    );

    // 7) AI prompt with grounding
    const maxCap = Math.max(0, avgWeeklyProfit * 3);
    const prompt = buildPrompt({
      weeklyHistory,
      avgWeeklyProfit,
      profitVolatility,
      consistencyScore,
      streamType,
      categoryStreams,
      maxCap,
    });

    // Start with deterministic baseline
    let projection: ProjectionWeek[] = baseline.projection;
    let summary: ProjectionSummary = baseline.summary;
    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiStreamResponse | null;
      const result = parseAiStream(parsed, baseline, maxCap);
      projection = result.projection;
      summary = result.summary;
      aiUsed = result.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/profit-stream-predictor',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { projection, summary });
    }

    return apiOk({
      ok: true,
      streamAnalysis,
      categoryStreams,
      projection,
      summary,
      aiUsed,
    });
  },
});

export const GET = profitStreamHandler;
export const POST = profitStreamHandler;
