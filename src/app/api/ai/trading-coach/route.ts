// v7.64 / v8.96.6-batch1: AI Trading Coach — personal AI coach ki analizira tvoje trading
// pattern-e, identificira weaknesse in da personaliziran advice za izboljšavo.
// "80% koncentracija v elektronika — diverzificiraj v moda. Win rate 40% ob
// vikendih — kupuj med tednom."
//
// Razlika od trade-replication-engine (ki predlaga nove MONITOR-je bazirane na
// winner-ih) — ta ANALIZIRA TVOJO TRADERSKO POTEKAVANJA (win rate by day/category,
// category concentration, recent trend) in da coaching za izboljšavo. Razlika od
// capital-allocation-optimizer (ki svetuje kapitalsko alokacijo) — ta gleda
// osebne vzorce in slabosti (overtrading, vikend-kupi, koncentracija).
//
// GET+POST /api/ai/trading-coach
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.6) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface TradingCoachInput {}

// --- Types ---------------------------------------------------------------

interface TradeStats {
  totalTrades: number;
  totalSold: number;
  totalCancelled: number;
  winRate: number; // %
  avgROI: number; // %
  avgHoldDays: number;
  tradesPerWeek: number;
  topCategory: string;
  categoryConcentration: number; // %
  bestDayOfWeek: string;
  worstDayOfWeek: string;
  recentTrend: 'IMPROVING' | 'STABLE' | 'DECLINING';
  categoryBreakdown: Array<{ category: string; count: number; winRate: number; avgROI: number }>;
  dayBreakdown: Array<{ day: string; count: number; winRate: number }>;
  priceRangeBreakdown: Array<{ range: string; count: number; winRate: number; avgROI: number }>;
  recent30WinRate: number;
  previous30WinRate: number;
  heldCount: number;
  heldCapital: number;
}

interface Pattern {
  pattern: string;
  impact: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  detail: string;
}

interface Recommendation {
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  action: string;
  expectedImpact: string;
}

interface CoachingReport {
  strengths: string[];
  weaknesses: string[];
  patterns: Pattern[];
  recommendations: Recommendation[];
  riskProfile: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  skillLevel: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT';
  nextSteps: string[];
}

interface AiCoachingResponse {
  strengths?: unknown;
  weaknesses?: unknown;
  patterns?: unknown;
  recommendations?: unknown;
  riskProfile?: unknown;
  skillLevel?: unknown;
  nextSteps?: unknown;
  summary?: unknown;
}

// --- Helpers -------------------------------------------------------------

const DAY_NAMES = [
  'Nedelja',
  'Ponedeljek',
  'Torek',
  'Sreda',
  'Četrtek',
  'Petek',
  'Sobota',
];

const PRICE_RANGES: Array<{ label: string; min: number; max: number }> = [
  { label: '0-50€', min: 0, max: 50 },
  { label: '50-100€', min: 50, max: 100 },
  { label: '100-250€', min: 100, max: 250 },
  { label: '250-500€', min: 250, max: 500 },
  { label: '500-1000€', min: 500, max: 1000 },
  { label: '1000€+', min: 1000, max: Number.POSITIVE_INFINITY },
];

function priceRangeLabel(buyPrice: number): string | null {
  for (const r of PRICE_RANGES) {
    if (buyPrice >= r.min && buyPrice < r.max) return r.label;
  }
  return null;
}

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

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

function clampStringArray(
  raw: unknown,
  maxItems: number,
  maxLen: number,
  fallback: string[],
): string[] {
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item === 'string' && item.trim().length > 0) {
        out.push(item.trim().slice(0, maxLen));
        if (out.length >= maxItems) break;
      }
    }
    if (out.length > 0) return out;
  }
  return fallback.slice(0, maxItems);
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

// Compute win rate from list of profitable flags
function computeWinRate(winFlags: boolean[]): number {
  if (winFlags.length === 0) return 0;
  const wins = winFlags.filter(Boolean).length;
  return Math.round((wins / winFlags.length) * 100);
}

// Compute skill level from volume + win rate
function computeSkillLevel(
  totalSold: number,
  winRate: number,
  avgROI: number,
): 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT' {
  // BEGINNER: <10 sold OR winRate <40%
  if (totalSold < 10 || winRate < 40) return 'BEGINNER';
  // EXPERT: >=40 sold AND winRate >=70% AND avgROI >=25%
  if (totalSold >= 40 && winRate >= 70 && avgROI >= 25) return 'EXPERT';
  // ADVANCED: >=25 sold AND winRate >=55%
  if (totalSold >= 25 && winRate >= 55) return 'ADVANCED';
  return 'INTERMEDIATE';
}

// Compute risk profile from trade patterns
function computeRiskProfile(
  avgROI: number,
  avgHoldDays: number,
  categoryConcentration: number,
  topCategoryWinRate: number,
): 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE' {
  let score = 0;
  // High ROI = aggressive (chasing high returns)
  if (avgROI >= 30) score += 2;
  else if (avgROI >= 15) score += 1;
  // Short hold = aggressive (quick flips)
  if (avgHoldDays > 0 && avgHoldDays < 7) score += 2;
  else if (avgHoldDays < 21) score += 1;
  // Category concentration = aggressive (all-in on one category)
  if (categoryConcentration >= 70) score += 2;
  else if (categoryConcentration >= 50) score += 1;
  // Low win rate on top category = aggressive (risk-taking)
  if (topCategoryWinRate < 50) score += 1;

  if (score >= 5) return 'AGGRESSIVE';
  if (score <= 2) return 'CONSERVATIVE';
  return 'BALANCED';
}

// Deterministic coaching report — used as fallback when AI unavailable
function buildDeterministicCoaching(stats: TradeStats): {
  coaching: CoachingReport;
  summary: string;
} {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const patterns: Pattern[] = [];
  const recommendations: Recommendation[] = [];
  const nextSteps: string[] = [];

  // Strengths
  if (stats.winRate >= 60) {
    strengths.push(
      `Win rate ${stats.winRate}% je nadpovprečen — večina trade-ov je dobičkonosnih.`,
    );
  }
  if (stats.avgROI >= 20) {
    strengths.push(
      `Povprečni ROI ${stats.avgROI}% kaže dobro izbiro nabora in pricing strategijo.`,
    );
  }
  if (stats.avgHoldDays > 0 && stats.avgHoldDays <= 14) {
    strengths.push(
      `Kratek hold time (${stats.avgHoldDays} dni) pomeni hitro obračanje kapitala.`,
    );
  }
  if (stats.totalSold >= 30) {
    strengths.push(
      `Tradeska zgodovina (${stats.totalSold} prodaj) omogoča zanesljivo analizo vzorcev.`,
    );
  }
  if (strengths.length === 0) {
    strengths.push(
      `Aktivno trgovanje (${stats.totalSold} prodaj) — zbiranje podatkov za analizo.`,
    );
  }

  // Weaknesses
  if (stats.categoryConcentration >= 70) {
    weaknesses.push(
      `Koncentracija ${stats.categoryConcentration}% v kategoriji "${stats.topCategory}" — prevelika odvisnost od ene kategorije.`,
    );
  }
  if (stats.winRate < 50) {
    weaknesses.push(
      `Win rate ${stats.winRate}% je pod 50% — večina trade-ov je izgubnih.`,
    );
  }
  if (stats.avgHoldDays > 45) {
    weaknesses.push(
      `Povprečni hold time ${stats.avgHoldDays} dni je predolg — kapital je vezan predolgo.`,
    );
  }
  // Check worst day vs best day
  const dayBreakdownSorted = [...stats.dayBreakdown].filter(d => d.count >= 2);
  if (dayBreakdownSorted.length >= 2) {
    const sorted = [...dayBreakdownSorted].sort((a, b) => a.winRate - b.winRate);
    const worst = sorted[0];
    const best = sorted[sorted.length - 1];
    if (best.winRate - worst.winRate >= 20 && worst.count >= 3) {
      weaknesses.push(
        `Win rate ob ${worst.day} (${worst.winRate}%, ${worst.count} trade-ov) je bistveno nižji od ${best.day} (${best.winRate}%) — časovna odvisnost.`,
      );
    }
  }
  if (stats.recentTrend === 'DECLINING') {
    weaknesses.push(
      `Recent trend DECLINING — win rate padla iz ${stats.previous30WinRate}% na ${stats.recent30WinRate}% v zadnjih 30 dneh.`,
    );
  }
  if (weaknesses.length === 0) {
    weaknesses.push(
      `Brez očitnih slabosti — vzdržuj sedanjo disciplino in monitoring.`,
    );
  }

  // Patterns
  if (stats.categoryConcentration >= 60) {
    patterns.push({
      pattern: 'Visoka kategorijska koncentracija',
      impact: 'NEGATIVE',
      detail: `${stats.categoryConcentration}% trade-ov v "${stats.topCategory}" — povečan sektorski risk.`,
    });
  }
  if (stats.avgHoldDays > 0 && stats.avgHoldDays <= 10 && stats.totalSold >= 10) {
    patterns.push({
      pattern: 'Quick-flip strategija',
      impact: stats.avgROI >= 15 ? 'POSITIVE' : 'NEUTRAL',
      detail: `Povprečno ${stats.avgHoldDays} dni hold — hitra obračanja kapitala, ROI ${stats.avgROI}%.`,
    });
  }
  if (stats.totalCancelled > 0 && stats.totalTrades > 0) {
    const cancelRate = Math.round((stats.totalCancelled / stats.totalTrades) * 100);
    if (cancelRate >= 15) {
      patterns.push({
        pattern: 'Visoka stopnja preklicev',
        impact: 'NEGATIVE',
        detail: `${cancelRate}% trade-ov preklicanih — morda impulzivni kupi ali slaba izbira.`,
      });
    }
  }
  if (stats.recentTrend === 'IMPROVING') {
    patterns.push({
      pattern: 'Izboljšujoč trend',
      impact: 'POSITIVE',
      detail: `Win rate narasla iz ${stats.previous30WinRate}% na ${stats.recent30WinRate}% v zadnjih 30 dneh.`,
    });
  }
  if (stats.tradesPerWeek >= 5) {
    patterns.push({
      pattern: 'Visok trade volumen',
      impact: stats.winRate >= 60 ? 'POSITIVE' : 'NEGATIVE',
      detail: `${stats.tradesPerWeek} trade-ov/teden — ${stats.winRate >= 60 ? 'aktiven in dobičkonosen' : 'visok volumen a nizka konverzija, možna overtrading'}.`,
    });
  }
  if (patterns.length === 0) {
    patterns.push({
      pattern: 'Uravnoteženo trgovanje',
      impact: 'NEUTRAL',
      detail: `Brez izrazitih vzorcev — nadaljuj z discipliniranim pristopom.`,
    });
  }

  // Recommendations
  if (stats.categoryConcentration >= 70) {
    recommendations.push({
      priority: 'HIGH',
      action: `Diverzificiraj v drugo kategorijo — zmanjšaj "${stats.topCategory}" s ${stats.categoryConcentration}% na <60%.`,
      expectedImpact: 'Zmanjšan sektorski risk, bolj stabilen ROI.',
    });
  }
  if (stats.winRate < 50) {
    recommendations.push({
      priority: 'HIGH',
      action: 'Bolj strog filter pred nakupom — zahtevaj dealScore >= 60 in aiVerdict PRILIKA.',
      expectedImpact: `Win rate naj se dvigne iz ${stats.winRate}% na >55%.`,
    });
  }
  if (stats.avgHoldDays > 45) {
    recommendations.push({
      priority: 'MEDIUM',
      action: `Skrajšaj hold time — uvedi ceno-akcijske dropdown-e vsakih 14 dni (5%, 10%, 15%).`,
      expectedImpact: `Povprečen hold iz ${stats.avgHoldDays} dni na <30 dni, hitrejši cash flow.`,
    });
  }
  // Best day recommendation
  const dayBreakdownSorted2 = [...stats.dayBreakdown].filter(d => d.count >= 2);
  if (dayBreakdownSorted2.length >= 2) {
    const sorted = [...dayBreakdownSorted2].sort((a, b) => b.winRate - a.winRate);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    if (best.winRate - worst.winRate >= 20 && worst.count >= 3) {
      recommendations.push({
        priority: 'MEDIUM',
        action: `Kupuj več ob ${best.day} (win rate ${best.winRate}%), zmanjšaj nakupe ob ${worst.day} (${worst.winRate}%).`,
        expectedImpact: `Povprečna win rate naj se dvigne za ${Math.round((best.winRate - worst.winRate) / 4)}%.`,
      });
    }
  }
  if (stats.recentTrend === 'DECLINING') {
    recommendations.push({
      priority: 'HIGH',
      action: 'Zmanjšaj volumen nakupov za 50% naslednji teden — preglej zadnjih 5 izgubnih trade-ov za skupne napake.',
      expectedImpact: `Zaustavitev padajočega trenda (win rate ${stats.recent30WinRate}% → stabilizacija).`,
    });
  }
  if (recommendations.length === 0) {
    recommendations.push({
      priority: 'LOW',
      action: 'Nadaljuj s sedanjo strategijo in tedensko preglej statistike.',
      expectedImpact: 'Vzdrževanje dosedanjih rezultatov.',
    });
  }

  // Next steps — pick top 1-2 recommendations by priority
  const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const sortedRecs = [...recommendations].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
  );
  for (const r of sortedRecs.slice(0, 2)) {
    nextSteps.push(r.action);
  }
  if (nextSteps.length === 0) {
    nextSteps.push('Preglej tedensko statistiko in prilagodi strategijo.');
  }

  const riskProfile = computeRiskProfile(
    stats.avgROI,
    stats.avgHoldDays,
    stats.categoryConcentration,
    stats.categoryBreakdown[0]?.winRate ?? stats.winRate,
  );
  const skillLevel = computeSkillLevel(stats.totalSold, stats.winRate, stats.avgROI);

  const coaching: CoachingReport = {
    strengths: strengths.slice(0, 3),
    weaknesses: weaknesses.slice(0, 3),
    patterns: patterns.slice(0, 4),
    recommendations: recommendations.slice(0, 5),
    riskProfile,
    skillLevel,
    nextSteps: nextSteps.slice(0, 2),
  };

  const summary = `Win rate ${stats.winRate}%, avg ROI ${stats.avgROI}%, ${stats.totalSold} prodaj. Risk profile: ${riskProfile}, skill level: ${skillLevel}. Top kategorija "${stats.topCategory}" (${stats.categoryConcentration}% koncentracije).`;

  return { coaching, summary };
}

// --- Prompt builder + AI merge (čisti, testabilni) ----------------------

function buildPrompt(stats: TradeStats): string {
  const categoryBlock = stats.categoryBreakdown
    .map(
      c =>
        `- ${c.category}: ${c.count} prodaj, win rate ${c.winRate}%, avg ROI ${c.avgROI}%`,
    )
    .join('\n');
  const dayBlock = stats.dayBreakdown
    .map(d => `- ${d.day}: ${d.count} trade-ov, win rate ${d.winRate}%`)
    .join('\n');
  const rangeBlock = stats.priceRangeBreakdown
    .map(
      r =>
        `- ${r.range}: ${r.count} trade-ov, win rate ${r.winRate}%, avg ROI ${r.avgROI}%`,
    )
    .join('\n');

  return `Si osebni AI trading coach za preprodajo na slovenskih in srednjeevropskih oglasnih platformah (Bolha, Vinted, Avtonet, mobile.de).
Analiziral si traderjevo zgodovino in mu dal personaliziran coaching za izboljšavo.

STATISTIKA TRADERJA:
- Skupno trade-ov: ${stats.totalTrades} (sold: ${stats.totalSold}, held: ${stats.heldCount}, cancelled: ${stats.totalCancelled})
- Win rate: ${stats.winRate}%
- Povprečni ROI: ${stats.avgROI}%
- Povprečni hold time: ${stats.avgHoldDays} dni
- Trades per week: ${stats.tradesPerWeek}
- Held inventar: ${stats.heldCount} itemov (${stats.heldCapital}€ vezanega kapitala)
- Top kategorija: ${stats.topCategory} (${stats.categoryConcentration}% koncentracije)
- Najboljši dan za trgovanje: ${stats.bestDayOfWeek}
- Najslabši dan za trgovanje: ${stats.worstDayOfWeek}
- Recent trend: ${stats.recentTrend} (recent30 win rate ${stats.recent30WinRate}% vs previous30 ${stats.previous30WinRate}%)

RAZČLENITEV PO KATEGORIJAH:
${categoryBlock || '- Ni podatkov'}

RAZČLENITEV PO DNEVIH (buyDate):
${dayBlock || '- Ni podatkov'}

RAZČLENITEV PO CENOVNIH RAZPONIH:
${rangeBlock || '- Ni podatkov'}

PRAVILA ZA COACHING:
1. strengths: 2-3 konkretni STRENGTHSI bazirani na statistiki (npr. "Win rate 65% je nadpovprečen").
2. weaknesses: 2-3 konkretni WEAKNESSI bazirani na statistiki (npr. "Koncentracija 80% v elektronika — prevelik sektorski risk").
3. patterns: 2-4 identificirani vzorci (npr. "overtrading on weekends", "quick-flip strategija"). impact: POSITIVE/NEGATIVE/NEUTRAL. detail = konkretne številke iz statistike.
4. recommendations: 3-5 specific actionable advice. priority: HIGH/MEDIUM/LOW. expectedImpact = kvantificiran rezultat (npr. "win rate +10%").
5. riskProfile: CONSERVATIVE (low score, nizka koncentracija, dolgi hold) | BALANCED | AGGRESSIVE (visok ROI, kratki hold, visoka koncentracija).
6. skillLevel: BEGINNER (<10 sold ali winRate <40%) | INTERMEDIATE | ADVANCED (>=25 sold, winRate >=55%) | EXPERT (>=40 sold, winRate >=70%, avgROI >=25%).
7. nextSteps: 1-2 immediate akcije za naslednji teden.
8. summary: 1-2 povedi overall assessment (slovensko).

VRNI LE JSON:
{
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "patterns": [
    { "pattern": "...", "impact": "POSITIVE|NEGATIVE|NEUTRAL", "detail": "..." }
  ],
  "recommendations": [
    { "priority": "HIGH|MEDIUM|LOW", "action": "...", "expectedImpact": "..." }
  ],
  "riskProfile": "CONSERVATIVE|BALANCED|AGGRESSIVE",
  "skillLevel": "BEGINNER|INTERMEDIATE|ADVANCED|EXPERT",
  "nextSteps": ["...", "..."],
  "summary": "1-2 povedi slovensko"
}${GROUNDING_PROMPT_SUFFIX}`;
}

function mergeAiIntoCoaching(
  parsed: AiCoachingResponse | null,
  stats: TradeStats,
): { coaching: CoachingReport; summary: string; aiUsed: boolean } {
  // Build deterministic fallback as base for clamping
  const det = buildDeterministicCoaching(stats);

  if (!parsed) {
    return { coaching: det.coaching, summary: det.summary, aiUsed: false };
  }

  // Validate AI strengths
  const strengths = clampStringArray(parsed.strengths, 3, 240, det.coaching.strengths);

  // Validate AI weaknesses
  const weaknesses = clampStringArray(parsed.weaknesses, 3, 240, det.coaching.weaknesses);

  // Validate patterns
  let patterns: Pattern[] = [];
  if (Array.isArray(parsed.patterns)) {
    for (const p of parsed.patterns) {
      if (p && typeof p === 'object') {
        patterns.push({
          pattern: clampString(
            (p as any).pattern,
            120,
            'Neznan vzorec',
          ),
          impact: clampEnum(
            (p as any).impact,
            ['POSITIVE', 'NEGATIVE', 'NEUTRAL'] as const,
            'NEUTRAL',
          ),
          detail: clampString(
            (p as any).detail,
            240,
            'Brez podrobnosti.',
          ),
        });
        if (patterns.length >= 4) break;
      }
    }
  }
  if (patterns.length === 0) patterns = det.coaching.patterns;

  // Validate recommendations
  let recommendations: Recommendation[] = [];
  if (Array.isArray(parsed.recommendations)) {
    for (const r of parsed.recommendations) {
      if (r && typeof r === 'object') {
        recommendations.push({
          priority: clampEnum(
            (r as any).priority,
            ['HIGH', 'MEDIUM', 'LOW'] as const,
            'MEDIUM',
          ),
          action: clampString((r as any).action, 280, 'Brez akcije.'),
          expectedImpact: clampString(
            (r as any).expectedImpact,
            200,
            'Brez pričakovanega vpliva.',
          ),
        });
        if (recommendations.length >= 5) break;
      }
    }
  }
  if (recommendations.length === 0) recommendations = det.coaching.recommendations;

  const riskProfile = clampEnum(
    parsed.riskProfile,
    ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'] as const,
    det.coaching.riskProfile,
  );
  const skillLevel = clampEnum(
    parsed.skillLevel,
    ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const,
    det.coaching.skillLevel,
  );
  const nextSteps = clampStringArray(parsed.nextSteps, 2, 280, det.coaching.nextSteps);
  const summary = clampString(parsed.summary, 400, det.summary);

  const coaching: CoachingReport = {
    strengths,
    weaknesses,
    patterns,
    recommendations,
    riskProfile,
    skillLevel,
    nextSteps,
  };

  return { coaching, summary, aiUsed: true };
}

// --- Handler -------------------------------------------------------------

const tradingCoachHandler = withAiRoute<TradingCoachInput>({
  endpoint: '/api/ai/trading-coach',
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

    // 1) Query all SOLD trades with buy+sell prices+dates
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        sellDate: { not: null },
        buyPrice: { gt: 0 },
      },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyDate: true,
        buyFees: true,
        sellPrice: true,
        sellDate: true,
        sellFees: true,
      },
      take: 5000,
    });

    // 2) Query HELD trades for current portfolio state
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, buyPrice: true, category: true },
      take: 500,
    });

    // 3) Query cancelled trades (for cancellation rate)
    const cancelledTrades = await db.trade.count({
      where: { status: 'cancelled' },
    });

    if (soldTrades.length === 0) {
      return apiOk({
        ok: true,
        stats: {
          totalTrades: heldTrades.length + cancelledTrades,
          totalSold: 0,
          winRate: 0,
          avgROI: 0,
          avgHoldDays: 0,
          tradesPerWeek: 0,
          topCategory: heldTrades[0]?.category ?? '—',
          categoryConcentration: 0,
          bestDayOfWeek: '—',
          worstDayOfWeek: '—',
          recentTrend: 'STABLE',
          categoryBreakdown: [],
          dayBreakdown: [],
          priceRangeBreakdown: [],
          recent30WinRate: 0,
          previous30WinRate: 0,
          heldCount: heldTrades.length,
          heldCapital: heldTrades.reduce((s, t) => s + (t.buyPrice ?? 0), 0),
        },
        coaching: {
          strengths: ['Nov trader — še zbirate trading zgodovino.'],
          weaknesses: ['Ni prodaj za analizo vzorcev.'],
          patterns: [],
          recommendations: [
            {
              priority: 'HIGH',
              action: 'Prodi prvi item in zabeleži buy/sell cene za analizo.',
              expectedImpact: 'Po 5+ prodajah bo coaching smiseln.',
            },
          ],
          riskProfile: 'CONSERVATIVE',
          skillLevel: 'BEGINNER',
          nextSteps: ['Prodi prvi held item in označi status=sold.'],
        },
        summary:
          'Ni prodanih trade-ov — Trading Coach potrebuje sold trades za analizo vzorcev.',
        aiUsed: false,
        message:
          'Ni prodanih trade-ov — Trading Coach potrebuje sold trades za analizo vzorcev.',
      });
    }

    // 4) Compute trade stats
    const now = Date.now();
    const dayMs = 86_400_000;

    // Per-trade metrics
    const tradeMetrics = soldTrades.map(t => {
      const buy = t.buyPrice + (t.buyFees ?? 0);
      const sell = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = sell - buy;
      const roi = buy > 0 ? (profit / buy) * 100 : 0;
      const isWin = profit > 0;
      const holdDays =
        t.sellDate && t.buyDate
          ? Math.max(
              0,
              Math.round(
                (new Date(t.sellDate).getTime() - new Date(t.buyDate).getTime()) / dayMs,
              ),
            )
          : 0;
      const buyDate = t.buyDate ? new Date(t.buyDate) : null;
      const buyDayOfWeek = buyDate ? buyDate.getDay() : -1; // 0=Sun, 6=Sat
      const sellDate = t.sellDate ? new Date(t.sellDate) : null;
      const category = (t.category || 'drugo').trim().toLowerCase() || 'drugo';
      const priceRange = priceRangeLabel(t.buyPrice);
      return {
        tradeId: t.id,
        category,
        buyPrice: t.buyPrice,
        sellPrice: t.sellPrice ?? 0,
        profit,
        roi,
        isWin,
        holdDays,
        buyDate,
        buyDayOfWeek,
        sellDate,
        priceRange,
      };
    });

    // 5) Compute aggregate stats
    const totalSold = soldTrades.length;
    const totalTrades = totalSold + heldTrades.length + cancelledTrades;
    const winFlags = tradeMetrics.map(t => t.isWin);
    const winRate = computeWinRate(winFlags);
    const avgROI = Math.round(
      (tradeMetrics.reduce((s, t) => s + t.roi, 0) / totalSold) * 10,
    ) / 10;
    const avgHoldDays = Math.round(
      tradeMetrics.reduce((s, t) => s + t.holdDays, 0) / totalSold,
    );

    // Trading frequency (trades per week based on buyDate range)
    const buyDates = tradeMetrics
      .filter(t => t.buyDate)
      .map(t => t.buyDate!.getTime());
    let tradesPerWeek = 0;
    if (buyDates.length >= 2) {
      const minBuy = Math.min(...buyDates);
      const maxBuy = Math.max(...buyDates);
      const spanDays = Math.max(1, (maxBuy - minBuy) / dayMs);
      tradesPerWeek = Math.round((totalSold / spanDays) * 7 * 10) / 10;
    } else if (buyDates.length === 1) {
      tradesPerWeek = 1;
    }

    // Category breakdown
    const categoryMap = new Map<
      string,
      { count: number; wins: number; roiSum: number }
    >();
    for (const t of tradeMetrics) {
      const cur =
        categoryMap.get(t.category) || { count: 0, wins: 0, roiSum: 0 };
      cur.count += 1;
      if (t.isWin) cur.wins += 1;
      cur.roiSum += t.roi;
      categoryMap.set(t.category, cur);
    }
    const categoryBreakdown = Array.from(categoryMap.entries())
      .map(([category, d]) => ({
        category,
        count: d.count,
        winRate: Math.round((d.wins / d.count) * 100),
        avgROI: Math.round((d.roiSum / d.count) * 10) / 10,
      }))
      .sort((a, b) => b.count - a.count);
    const topCategory = categoryBreakdown[0]?.category ?? 'drugo';
    const categoryConcentration =
      totalSold > 0 && categoryBreakdown[0]
        ? Math.round((categoryBreakdown[0].count / totalSold) * 100)
        : 0;

    // Day of week breakdown (using buyDate)
    const dayMap = new Map<number, { count: number; wins: number }>();
    for (const t of tradeMetrics) {
      if (t.buyDayOfWeek < 0) continue;
      const cur = dayMap.get(t.buyDayOfWeek) || { count: 0, wins: 0 };
      cur.count += 1;
      if (t.isWin) cur.wins += 1;
      dayMap.set(t.buyDayOfWeek, cur);
    }
    const dayBreakdown = Array.from(dayMap.entries())
      .map(([dayIdx, d]) => ({
        day: DAY_NAMES[dayIdx] ?? `Dan ${dayIdx}`,
        count: d.count,
        winRate: Math.round((d.wins / d.count) * 100),
      }))
      .sort((a, b) => b.count - a.count);
    const bestDay =
      dayBreakdown.filter(d => d.count >= 2).sort((a, b) => b.winRate - a.winRate)[0]?.day ??
      '—';
    const worstDay =
      dayBreakdown
        .filter(d => d.count >= 2)
        .sort((a, b) => a.winRate - b.winRate)[0]?.day ?? '—';

    // Price range breakdown
    const rangeMap = new Map<
      string,
      { count: number; wins: number; roiSum: number }
    >();
    for (const t of tradeMetrics) {
      if (!t.priceRange) continue;
      const cur =
        rangeMap.get(t.priceRange) || { count: 0, wins: 0, roiSum: 0 };
      cur.count += 1;
      if (t.isWin) cur.wins += 1;
      cur.roiSum += t.roi;
      rangeMap.set(t.priceRange, cur);
    }
    const priceRangeBreakdown = Array.from(rangeMap.entries())
      .map(([range, d]) => ({
        range,
        count: d.count,
        winRate: Math.round((d.wins / d.count) * 100),
        avgROI: Math.round((d.roiSum / d.count) * 10) / 10,
      }))
      .sort((a, b) => b.count - a.count);

    // Recent trend (last 30d vs previous 30d)
    const recent30Start = now - 30 * dayMs;
    const previous30Start = now - 60 * dayMs;
    const recent30Sold = tradeMetrics.filter(
      t => t.sellDate && t.sellDate.getTime() >= recent30Start,
    );
    const previous30Sold = tradeMetrics.filter(
      t =>
        t.sellDate &&
        t.sellDate.getTime() >= previous30Start &&
        t.sellDate.getTime() < recent30Start,
    );
    const recent30WinRate = computeWinRate(recent30Sold.map(t => t.isWin));
    const previous30WinRate = computeWinRate(previous30Sold.map(t => t.isWin));
    let recentTrend: 'IMPROVING' | 'STABLE' | 'DECLINING' = 'STABLE';
    const winRateDelta = recent30WinRate - previous30WinRate;
    if (winRateDelta >= 10) recentTrend = 'IMPROVING';
    else if (winRateDelta <= -10) recentTrend = 'DECLINING';

    const heldCapital = heldTrades.reduce((s, t) => s + (t.buyPrice ?? 0), 0);

    const stats: TradeStats = {
      totalTrades,
      totalSold,
      totalCancelled: cancelledTrades,
      winRate,
      avgROI,
      avgHoldDays,
      tradesPerWeek,
      topCategory,
      categoryConcentration,
      bestDayOfWeek: bestDay,
      worstDayOfWeek: worstDay,
      recentTrend,
      categoryBreakdown: categoryBreakdown.slice(0, 8),
      dayBreakdown,
      priceRangeBreakdown,
      recent30WinRate,
      previous30WinRate,
      heldCount: heldTrades.length,
      heldCapital: Math.round(heldCapital),
    };

    // 6) AI cache — keyed by total sold count (changes when new sale added)
    const cacheKey = `trading-coach:${totalSold}`;
    const cached = getCachedAI<{
      coaching: CoachingReport;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        stats,
        coaching: cached.coaching,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 7) Build AI prompt with grounding (settings loaded by withAiRoute wrapper)
    const prompt = buildPrompt(stats);

    // Deterministic baseline (fallback if AI call fails)
    const det = buildDeterministicCoaching(stats);
    let coaching: CoachingReport = det.coaching;
    let summary = det.summary;
    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiCoachingResponse | null;

      const merged = mergeAiIntoCoaching(parsed, stats);
      coaching = merged.coaching;
      summary = merged.summary;
      aiUsed = merged.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/trading-coach',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { coaching, summary });
    }

    return apiOk({
      ok: true,
      stats,
      coaching,
      summary,
      aiUsed,
    });
  },
});

export const GET = tradingCoachHandler;
export const POST = tradingCoachHandler;
