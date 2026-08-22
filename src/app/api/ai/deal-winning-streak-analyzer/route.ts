// v7.77 / v8.96.4-batch2: AI Deal Winning Streak Analyzer — AI analizira
// tvoje winning in losing streak-e (zaporedni dobičkonosni deal-i vs zaporedne
// izgube). Identificira kaj sproži streak-e in kako jih vzdrževati/prekiniti.
// "Current: 5-win streak! Best ever: 8. Trigger: elektronika deals. Keep
// buying elektronika."
//
// Razlika od deal-quality-forecaster (ki napove quality posameznega deal-a
// po dnevih v tednu) — ta gleda STREAK-E (zaporedja win/loss). Razlika
// od deal-scoring-model-v2 (ki score-a posamezne deal-e) — ta gleda
// KONTEKST zaporednih rezultatov. Razlika od deal-anatomy-analyzer (ki
// analizira anatomijo winnerjev vs losersov) — ta gleda STREAK momentum
// in TRIGGER-e. Razlika od profit-momentum-tracker (ki gleda profit
// momentum čez mesece) — ta gleda DEAL-level streak-e (micro-pattern).
// Razlika od deal-velocity (ki meri market temperature) — ta gleda tvojo
// osebno winning/losing spiralo.
//
// Refaktoriran z withAiRoute helperjem (v8.96.4) + enforceBudget guard.
//
// GET+POST /api/ai/deal-winning-streak-analyzer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type StreakType = 'WINNING' | 'LOSING';
type CorrelationType = 'POSITIVE' | 'NEGATIVE';

interface StreakSummary {
  currentStreak: number;
  currentStreakType: StreakType;
  longestWinningStreak: number;
  longestLosingStreak: number;
  avgWinningStreakLength: number;
  avgLosingStreakLength: number;
  totalStreaks: number;
}

interface StreakPatterns {
  bestCategoryForStreaks: string | null;
  bestPriceRangeForStreaks: string | null;
  bestTimeForStreaks: string | null;
  streakCorrelationFactors: Array<{
    factor: string;
    correlation: number; // -1..1
    type: CorrelationType;
  }>;
}

interface StreakAnalysis {
  streakAssessment: string;
  streakTriggers: string[];
  streakBreakers: string[];
  streakForecast: string;
  streakAdvice: string;
  confidenceLevel: number; // 0-100
}

interface AiStreakResponse {
  analysis?: unknown;
}

// --- Helpers -------------------------------------------------------------

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

function clampStringArray(
  raw: unknown,
  maxItems: number,
  maxItemLen: number,
  fallback: string[],
): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return fallback.slice(0, maxItems);
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (!s) continue;
    out.push(s.slice(0, maxItemLen));
    if (out.length >= maxItems) break;
  }
  if (out.length === 0) return fallback.slice(0, maxItems);
  return out;
}

const VALID_STREAK_TYPE: readonly StreakType[] = ['WINNING', 'LOSING'];
const VALID_CORR_TYPE: readonly CorrelationType[] = ['POSITIVE', 'NEGATIVE'];

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

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// Price range bucketing — return bucket label
function priceBucket(price: number): string {
  if (price <= 0) return '0€';
  if (price < 50) return '0-50€';
  if (price < 150) return '50-150€';
  if (price < 400) return '150-400€';
  if (price < 1000) return '400-1000€';
  if (price < 5000) return '1000-5000€';
  return '5000€+';
}

// Day-of-week label (Slovenian)
function dayOfWeekLabel(date: Date): string {
  const day = date.getDay(); // 0=Sun
  const labels = [
    'Nedelja',
    'Ponedeljek',
    'Torek',
    'Sreda',
    'Četrtek',
    'Petek',
    'Sobota',
  ];
  return labels[day] ?? 'Neznan';
}

// Compute streaks from sorted WIN/LOSS sequence
function computeStreaks(
  outcomes: Array<{ type: 'WIN' | 'LOSS' }>,
): {
  currentStreak: number;
  currentStreakType: StreakType;
  longestWinningStreak: number;
  longestLosingStreak: number;
  winningStreakLengths: number[];
  losingStreakLengths: number[];
  totalStreaks: number;
} {
  if (outcomes.length === 0) {
    return {
      currentStreak: 0,
      currentStreakType: 'WINNING',
      longestWinningStreak: 0,
      longestLosingStreak: 0,
      winningStreakLengths: [],
      losingStreakLengths: [],
      totalStreaks: 0,
    };
  }
  const winningStreakLengths: number[] = [];
  const losingStreakLengths: number[] = [];
  let longestWinningStreak = 0;
  let longestLosingStreak = 0;
  let curType: 'WIN' | 'LOSS' | null = null;
  let curLen = 0;
  for (const o of outcomes) {
    if (o.type === curType) {
      curLen += 1;
    } else {
      // close previous streak
      if (curType === 'WIN' && curLen > 0) {
        winningStreakLengths.push(curLen);
      } else if (curType === 'LOSS' && curLen > 0) {
        losingStreakLengths.push(curLen);
      }
      curType = o.type;
      curLen = 1;
    }
    if (curType === 'WIN') {
      longestWinningStreak = Math.max(longestWinningStreak, curLen);
    } else if (curType === 'LOSS') {
      longestLosingStreak = Math.max(longestLosingStreak, curLen);
    }
  }
  // close last streak
  if (curType === 'WIN' && curLen > 0) {
    winningStreakLengths.push(curLen);
  } else if (curType === 'LOSS' && curLen > 0) {
    losingStreakLengths.push(curLen);
  }
  // current streak is the last segment
  const lastType = outcomes[outcomes.length - 1]?.type ?? 'WIN';
  const currentStreakType: StreakType =
    lastType === 'WIN' ? 'WINNING' : 'LOSING';
  // compute current streak length by counting backward
  let currentStreak = 0;
  for (let i = outcomes.length - 1; i >= 0; i--) {
    if (outcomes[i]?.type === lastType) {
      currentStreak += 1;
    } else {
      break;
    }
  }
  const totalStreaks = winningStreakLengths.length + losingStreakLengths.length;
  return {
    currentStreak,
    currentStreakType,
    longestWinningStreak,
    longestLosingStreak,
    winningStreakLengths,
    losingStreakLengths,
    totalStreaks,
  };
}

// Build deterministic patterns from outcome data
function buildDeterministicPatterns(
  outcomes: Array<{
    type: 'WIN' | 'LOSS';
    category: string;
    buyPrice: number;
    sellDate: Date;
  }>,
): StreakPatterns {
  if (outcomes.length === 0) {
    return {
      bestCategoryForStreaks: null,
      bestPriceRangeForStreaks: null,
      bestTimeForStreaks: null,
      streakCorrelationFactors: [],
    };
  }

  // bestCategoryForStreaks: category with highest win count
  const catWins = new Map<string, number>();
  const catTotal = new Map<string, number>();
  // bestPriceRangeForStreaks: price bucket with highest win rate
  const bucketWins = new Map<string, number>();
  const bucketTotal = new Map<string, number>();
  // bestTimeForStreaks: day-of-week with highest win rate
  const dayWins = new Map<string, number>();
  const dayTotal = new Map<string, number>();

  for (const o of outcomes) {
    const isWin = o.type === 'WIN' ? 1 : 0;
    const cat = o.category || 'neznan';
    catTotal.set(cat, (catTotal.get(cat) ?? 0) + 1);
    catWins.set(cat, (catWins.get(cat) ?? 0) + isWin);

    const bucket = priceBucket(o.buyPrice);
    bucketTotal.set(bucket, (bucketTotal.get(bucket) ?? 0) + 1);
    bucketWins.set(bucket, (bucketWins.get(bucket) ?? 0) + isWin);

    const day = dayOfWeekLabel(o.sellDate);
    dayTotal.set(day, (dayTotal.get(day) ?? 0) + 1);
    dayWins.set(day, (dayWins.get(day) ?? 0) + isWin);
  }

  function bestKey(
    wins: Map<string, number>,
    total: Map<string, number>,
    minSample = 2,
  ): string | null {
    let best: string | null = null;
    let bestRate = -1;
    for (const [k, t] of total.entries()) {
      if (t < minSample) continue;
      const w = wins.get(k) ?? 0;
      const rate = w / t;
      if (rate > bestRate) {
        bestRate = rate;
        best = k;
      }
    }
    return best;
  }

  const bestCategoryForStreaks = bestKey(catWins, catTotal, 2);
  const bestPriceRangeForStreaks = bestKey(bucketWins, bucketTotal, 2);
  const bestTimeForStreaks = bestKey(dayWins, dayTotal, 2);

  // Correlation factors — compute simple Pearson-ish correlation between
  // binary outcome (1=win, 0=loss) and continuous variables.
  // For categorical, use win-rate delta vs overall win-rate.
  const totalN = outcomes.length;
  const overallWinRate =
    outcomes.filter((o) => o.type === 'WIN').length / totalN;

  const streakCorrelationFactors: Array<{
    factor: string;
    correlation: number;
    type: CorrelationType;
  }> = [];

  // Factor 1: category effect — pick top-3 categories with biggest delta
  const catDeltas: Array<{ cat: string; delta: number; sample: number }> = [];
  for (const [cat, t] of catTotal.entries()) {
    if (t < 2) continue;
    const w = catWins.get(cat) ?? 0;
    const delta = w / t - overallWinRate;
    catDeltas.push({ cat, delta, sample: t });
  }
  catDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  for (const cd of catDeltas.slice(0, 3)) {
    const corr = Math.max(-1, Math.min(1, cd.delta * 2)); // scale
    streakCorrelationFactors.push({
      factor: `Kategorija "${cd.cat}" (${cd.sample} deal-ov)`,
      correlation: round1(corr),
      type: cd.delta >= 0 ? 'POSITIVE' : 'NEGATIVE',
    });
  }

  // Factor 2: price bucket effect
  const bucketDeltas: Array<{ bucket: string; delta: number; sample: number }> = [];
  for (const [bucket, t] of bucketTotal.entries()) {
    if (t < 2) continue;
    const w = bucketWins.get(bucket) ?? 0;
    const delta = w / t - overallWinRate;
    bucketDeltas.push({ bucket, delta, sample: t });
  }
  bucketDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const topBucket = bucketDeltas[0];
  if (topBucket) {
    const corr = Math.max(-1, Math.min(1, topBucket.delta * 2));
    streakCorrelationFactors.push({
      factor: `Cenovni razpon "${topBucket.bucket}" (${topBucket.sample} deal-ov)`,
      correlation: round1(corr),
      type: topBucket.delta >= 0 ? 'POSITIVE' : 'NEGATIVE',
    });
  }

  // Factor 3: day-of-week effect
  const dayDeltas: Array<{ day: string; delta: number; sample: number }> = [];
  for (const [day, t] of dayTotal.entries()) {
    if (t < 2) continue;
    const w = dayWins.get(day) ?? 0;
    const delta = w / t - overallWinRate;
    dayDeltas.push({ day, delta, sample: t });
  }
  dayDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const topDay = dayDeltas[0];
  if (topDay) {
    const corr = Math.max(-1, Math.min(1, topDay.delta * 2));
    streakCorrelationFactors.push({
      factor: `Dan prodaje "${topDay.day}" (${topDay.sample} deal-ov)`,
      correlation: round1(corr),
      type: topDay.delta >= 0 ? 'POSITIVE' : 'NEGATIVE',
    });
  }

  return {
    bestCategoryForStreaks,
    bestPriceRangeForStreaks,
    bestTimeForStreaks,
    streakCorrelationFactors,
  };
}

// Build deterministic analysis from streak data
function buildDeterministicAnalysis(
  streaks: StreakSummary,
  patterns: StreakPatterns,
  totalSold: number,
): StreakAnalysis {
  const isWinning = streaks.currentStreakType === 'WINNING';
  const cur = streaks.currentStreak;
  const long = isWinning
    ? streaks.longestWinningStreak
    : streaks.longestLosingStreak;

  const streakAssessment = isWinning
    ? `Trenutno si na ${cur}-deal WINNING streak-u (najdaljši winning streak v zgodovini: ${streaks.longestWinningStreak}). Tvoj povprečni winning streak je ${streaks.avgWinningStreakLength} deal-ov — ${cur >= streaks.avgWinningStreakLength ? ' nad povprečjem, odlična forma!' : ' blizu povprečja, ohrani fokus.'}`
    : `Trenutno si na ${cur}-deal LOSING streak-u (najdaljši losing streak v zgodovini: ${streaks.longestLosingStreak}). Tvoj povprečni losing streak je ${streaks.avgLosingStreakLength} deal-ov — ${cur >= streaks.avgLosingStreakLength ? ' prekoračen, čas za premik!' : ' še znotraj povprečja, zadrži živce.'}`;

  const triggers: string[] = [];
  if (patterns.bestCategoryForStreaks) {
    triggers.push(
      `Kategorija "${patterns.bestCategoryForStreaks}" — tvoja najbolj zanesljiva kategorija za win streak-e`,
    );
  }
  if (patterns.bestPriceRangeForStreaks) {
    triggers.push(
      `Cenovni razpon "${patterns.bestPriceRangeForStreaks}" — visoka win rate v tem razponu`,
    );
  }
  if (patterns.bestTimeForStreaks) {
    triggers.push(
      `Dan "${patterns.bestTimeForStreaks}" — tvoja najboljša prodajna dni za win`,
    );
  }
  if (triggers.length === 0) {
    triggers.push(
      'Konsistentnost v izbiri kategorij in cenovnem razponu — manj variacij pomeni bolj stabilni streak-i',
    );
  }
  // Pad triggers to at least 3
  while (triggers.length < 3) {
    triggers.push(
      'Disciplinirano izvajanje buying checklist-a pred vsakim nakupom',
    );
  }

  const breakers: string[] = [
    'Prehitro širjenje v nepoznane kategorije brez historičnih podatkov',
    'Ignoriranje deal quality-a zaradi FOMO (strah pred zamujanjem)',
    'Nedosledno preverjanje stanja item-a pred nakupom',
  ];

  const streakForecast = isWinning
    ? cur >= streaks.longestWinningStreak
      ? `Trenutni ${cur}-win streak je že tvoj rekord! Napoved: verjetnost nadaljevanja je zmerna — zgodovinsko tvoji winning streak-i trajajo povprečno ${streaks.avgWinningStreakLength} deal-ov.`
      : `Winning streak je v teku. Zgodovinsko bi lahko še ${Math.max(0, Math.round(streaks.avgWinningStreakLength - cur))} deal-ov ostal v win formi, če ohraniš disciplino.`
    : cur >= streaks.longestLosingStreak
      ? `Losing streak je dosegel zgodovinski maksimum — srednje-class signal za premik strategije.`
      : `Losing streak še znotraj zgodovinskega obsega (povprečno ${streaks.avgLosingStreakLength} deal-ov). Verjetno se bo prekinil v naslednjih ${Math.max(1, Math.round(streaks.avgLosingStreakLength - cur))} deal-ih.`;

  const streakAdvice = isWinning
    ? `OHRANI momentum: nadaljuj z "${patterns.bestCategoryForStreaks ?? 'preverjene kategorije'}", drži se cenovnega razpona "${patterns.bestPriceRangeForStreaks ?? 'preverjenega'}", in NE prestopaj v nepreizkušene kategorije dokler streak traja. Povečaj volume zmerno (ne prehitro).`
    : `PREKINI losing streak: PAUZA — vzemi 24-48h od nakupov, ponovno preglej buying checklist, zmanjšaj budget per deal za 30%, in fokusiraj se na kategorijo "${patterns.bestCategoryForStreaks ?? 'konzervativno'}" kjer imaš najboljšo win rate. Ne loviti izgub!`;

  // confidence — based on sample size
  const sampleConfidence = Math.min(100, Math.round((totalSold / 50) * 100));
  const confidenceLevel = Math.max(10, Math.min(95, 40 + sampleConfidence * 0.5));

  return {
    streakAssessment: clampString(streakAssessment, 500, streakAssessment),
    streakTriggers: triggers.slice(0, 5),
    streakBreakers: breakers.slice(0, 5),
    streakForecast: clampString(streakForecast, 400, streakForecast),
    streakAdvice: clampString(streakAdvice, 500, streakAdvice),
    confidenceLevel: Math.round(confidenceLevel),
  };
}

// --- Handler -------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface DealWinningStreakAnalyzerInput {}

const dealWinningStreakHandler = withAiRoute<DealWinningStreakAnalyzerInput>({
  endpoint: '/api/ai/deal-winning-streak-analyzer',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async () => ({}),

  // No validateInput — endpoint ne sprejema inputa

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    // 1) Query all SOLD trades sorted by sellDate asc
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null },
        buyPrice: { gt: 0 },
      },
      select: {
        id: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    });

    // Empty state — no sold trades
    if (soldTrades.length === 0) {
      return apiOk({
        ok: true,
        streaks: {
          currentStreak: 0,
          currentStreakType: 'WINNING',
          longestWinningStreak: 0,
          longestLosingStreak: 0,
          avgWinningStreakLength: 0,
          avgLosingStreakLength: 0,
          totalStreaks: 0,
        },
        patterns: {
          bestCategoryForStreaks: null,
          bestPriceRangeForStreaks: null,
          bestTimeForStreaks: null,
          streakCorrelationFactors: [],
        },
        analysis: {
          streakAssessment:
            'Ni SOLD trade-ov — Deal Winning Streak Analyzer ni mogoč.',
          streakTriggers: [],
          streakBreakers: [],
          streakForecast: 'Ni podatkov za napoved.',
          streakAdvice:
            'Dodaj SOLD trade-e (status "sold", sellDate in sellPrice izpolnjeni, buyPrice > 0) za izračun streak-e.',
          confidenceLevel: 0,
        },
        summary:
          'Ni SOLD trade-ov — Deal Winning Streak Analyzer ni mogoč.',
        aiUsed: false,
        message:
          'Ni SOLD trade-ov — Deal Winning Streak Analyzer ni mogoč.',
      });
    }

    // 2) Classify each as WIN (profit > 0) or LOSS (profit <= 0)
    const outcomes = soldTrades.map((t) => {
      const profit =
        (t.sellPrice ?? 0) -
        (t.sellFees ?? 0) -
        (t.buyPrice ?? 0) -
        (t.buyFees ?? 0);
      const type: 'WIN' | 'LOSS' = profit > 0 ? 'WIN' : 'LOSS';
      return {
        type,
        category: (t.category || '').trim().toLowerCase() || 'neznan',
        buyPrice: t.buyPrice ?? 0,
        sellDate: t.sellDate as unknown as Date,
        profit,
      };
    });

    // 3) Compute streaks
    const streakData = computeStreaks(outcomes);
    const avgWinningStreakLength =
      streakData.winningStreakLengths.length > 0
        ? round1(
            streakData.winningStreakLengths.reduce((s, v) => s + v, 0) /
              streakData.winningStreakLengths.length,
          )
        : 0;
    const avgLosingStreakLength =
      streakData.losingStreakLengths.length > 0
        ? round1(
            streakData.losingStreakLengths.reduce((s, v) => s + v, 0) /
              streakData.losingStreakLengths.length,
          )
        : 0;

    const streaks: StreakSummary = {
      currentStreak: streakData.currentStreak,
      currentStreakType: streakData.currentStreakType,
      longestWinningStreak: streakData.longestWinningStreak,
      longestLosingStreak: streakData.longestLosingStreak,
      avgWinningStreakLength,
      avgLosingStreakLength,
      totalStreaks: streakData.totalStreaks,
    };

    // 4) Analyze patterns
    const patterns = buildDeterministicPatterns(outcomes);

    // 5) AI cache check (6h TTL) — key by totalSold count
    const cacheKey = `deal-winning-streak:${soldTrades.length}`;
    const cached = getCachedAI<{
      analysis: StreakAnalysis;
    }>(cacheKey);
    if (cached) {
      // Recompute summary deterministically (do not trust AI cache text)
      const summary = buildSummary(streaks, cached.analysis);
      return apiOk({
        ok: true,
        streaks,
        patterns,
        analysis: cached.analysis,
        summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 6) Build deterministic fallback
    const deterministicAnalysis = buildDeterministicAnalysis(
      streaks,
      patterns,
      soldTrades.length,
    );

    // 7) AI prompt with grounding
    const timeline = outcomes
      .slice(-50)
      .map((o, i) => `${i + 1}:${o.type === 'WIN' ? 'W' : 'L'}:${o.category}:${priceBucket(o.buyPrice)}:${dayOfWeekLabel(o.sellDate)}`)
      .join(' | ');

    const prompt = buildPrompt({
      streaks,
      patterns,
      totalSoldDeals: soldTrades.length,
      timeline,
    });

    let analysis = deterministicAnalysis;
    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiStreakResponse | null;

      if (parsed && typeof parsed === 'object' && parsed.analysis) {
        analysis = transformStreak(parsed, deterministicAnalysis);
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/deal-winning-streak-analyzer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { analysis });
    }

    // 9) Build summary deterministically (NOT from AI)
    const summary = buildSummary(streaks, analysis);

    return apiOk({
      ok: true,
      streaks,
      patterns,
      analysis,
      summary,
      aiUsed,
    });
  },
});

// AI Hub runner compatibility — body is ignored, identical logic.
export const GET = dealWinningStreakHandler;
export const POST = dealWinningStreakHandler;

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface PromptParams {
  streaks: StreakSummary;
  patterns: StreakPatterns;
  totalSoldDeals: number;
  timeline: string;
}

function buildPrompt(p: PromptParams): string {
  return `Si AI "Deal Winning Streak Analyzer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Analiziraj winning in losing streak-e (zaporedne dobičkonosne deal-e vs zaporedne izgube). Identificiraj kaj sproži streak-e in kako jih vzdrževati/prekiniti.

STREAK PODATKI (deterministično izračunano):
- currentStreak: ${p.streaks.currentStreak}
- currentStreakType: ${p.streaks.currentStreakType}
- longestWinningStreak: ${p.streaks.longestWinningStreak}
- longestLosingStreak: ${p.streaks.longestLosingStreak}
- avgWinningStreakLength: ${p.streaks.avgWinningStreakLength}
- avgLosingStreakLength: ${p.streaks.avgLosingStreakLength}
- totalStreaks: ${p.streaks.totalStreaks}
- totalSoldDeals: ${p.totalSoldDeals}

PATTERNS (deterministično izračunano):
- bestCategoryForStreaks: ${p.patterns.bestCategoryForStreaks ?? 'Ni podatkov'}
- bestPriceRangeForStreaks: ${p.patterns.bestPriceRangeForStreaks ?? 'Ni podatkov'}
- bestTimeForStreaks: ${p.patterns.bestTimeForStreaks ?? 'Ni podatkov'}
- streakCorrelationFactors: ${JSON.stringify(p.patterns.streakCorrelationFactors)}

ZADNJIH 50 DEAL-OV (W=win, L=loss, format: index:type:category:priceBucket:dayOfWeek):
${p.timeline}

PRAVILA ZA AI ODGOVOR:
1. streakAssessment: slovenski opis trenutnega streak momentum-a (max 500 znakov). NE izmišljuj številk — uporabi zgornje deterministične podatke.
2. streakTriggers: array 3-5 faktorjev, ki START/MAINTAIN winning streak-e (slovenski, max 200 znakov vsak). Based on patterns + correlation factors.
3. streakBreakers: array 3-5 faktorjev, ki END winning streak-e (slovenski, max 200 znakov vsak).
4. streakForecast: slovenski opis ali bo current streak nadaljeval (max 400 znakov). Glej na currentStreak vs longestStreak in avgLength.
5. streakAdvice: konkreten slovenski nasvet kako vzdrževati winning ali prekiniti losing streak (max 500 znakov).
6. confidenceLevel: 0-100 (glede na sample size in konsistentnost signalov).

VRNI LE JSON:
{
  "analysis": {
    "streakAssessment": "...",
    "streakTriggers": ["...", "...", "..."],
    "streakBreakers": ["...", "...", "..."],
    "streakForecast": "...",
    "streakAdvice": "...",
    "confidenceLevel": 75
  }
}${GROUNDING_PROMPT_SUFFIX}`;
}

function transformStreak(
  parsed: AiStreakResponse,
  deterministicAnalysis: StreakAnalysis,
): StreakAnalysis {
  const a = parsed.analysis as Record<string, unknown>;
  return {
    streakAssessment: clampString(
      a.streakAssessment,
      500,
      deterministicAnalysis.streakAssessment,
    ),
    streakTriggers: clampStringArray(
      a.streakTriggers,
      5,
      200,
      deterministicAnalysis.streakTriggers,
    ),
    streakBreakers: clampStringArray(
      a.streakBreakers,
      5,
      200,
      deterministicAnalysis.streakBreakers,
    ),
    streakForecast: clampString(
      a.streakForecast,
      400,
      deterministicAnalysis.streakForecast,
    ),
    streakAdvice: clampString(
      a.streakAdvice,
      500,
      deterministicAnalysis.streakAdvice,
    ),
    confidenceLevel: clampNumber(
      a.confidenceLevel,
      0,
      100,
      deterministicAnalysis.confidenceLevel,
    ),
  };
}

// Build summary from streak data (deterministic, NOT from AI)
function buildSummary(streaks: StreakSummary, analysis: StreakAnalysis): string {
  const curTypeLabel =
    streaks.currentStreakType === 'WINNING' ? 'winning' : 'losing';
  const longType =
    streaks.currentStreakType === 'WINNING'
      ? streaks.longestWinningStreak
      : streaks.longestLosingStreak;
  const summary = `Trenutno ${streaks.currentStreak}-deal ${curTypeLabel} streak (najdaljši: ${longType}). Povprečni winning streak: ${streaks.avgWinningStreakLength}, losing streak: ${streaks.avgLosingStreakLength}. ${analysis.streakAdvice.slice(0, 200)}`;
  return clampString(summary, 500, summary);
}
