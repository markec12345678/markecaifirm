/**
 * @deprecated v8.94 — uporabi `/api/ai/profit-maximizer-pro` namesto tega.
 * Zastareli v2 — Pro verzija je najbolj feature-rich.
 * Ta endpoint bo odstranjen v v9.0. Glej ENDPOINTS_AUDIT.md za migracijski načrt.
 */
// v7.56 / v8.96.3-batch2: Profit Maximizer v2 (ML Compounding) — simulacija reinvestiranja dobička
// z različnimi strategijami (conservative / balanced / aggressive) preko 24 mesecev.
//
// "Z 2000€ začetnega kapitala in 12% ROI, v 12 mesecih → 5400€ (balanced scenario)"
//
// Refaktoriran z withAiRoute helperjem (v8.96.3) + enforceBudget guard.
// logDeprecatedCall() PRESERVED — kliče se znotraj handler-ja preko ctx.req.
//
// GET+POST /api/ai/profit-maximizer-v2
// (AI-enhanced priporočilo + grounding + anti-hallucination + 6h cache)

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';
import { logDeprecatedCall } from '@/lib/deprecated-redirect';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

const DAY_MS = 86_400_000;

type ScenarioName = 'conservative' | 'balanced' | 'aggressive';
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

interface MonthRow {
  month: number;
  startingCapital: number;
  tradesExecuted: number;
  projectedProfit: number;
  endingCapital: number;
  cumulativeProfit: number;
}

interface Scenario {
  name: ScenarioName;
  monthlyGrowthRate: number;
  projection: MonthRow[];
  finalCapital: number;
  totalProfit: number;
  riskLevel: RiskLevel;
}

interface HistoricalMetrics {
  avgROI: number;
  avgHoldDays: number;
  winRate: number;
  avgProfitPerTrade: number;
  totalTrades: number;
  capitalAvailable: number;
  avgTradeSize: number;
  avgMonthlyProfit: number;
}

interface AiRecommendation {
  recommendedScenario?: string;
  reasoning?: string;
  confidence?: unknown;
  riskTolerance?: string;
  notes?: string;
}

const SCENARIO_DEFS: Array<{
  name: ScenarioName;
  monthlyGrowthRate: number;
  riskLevel: RiskLevel;
}> = [
  { name: 'conservative', monthlyGrowthRate: 0.05, riskLevel: 'LOW' },
  { name: 'balanced', monthlyGrowthRate: 0.10, riskLevel: 'MEDIUM' },
  { name: 'aggressive', monthlyGrowthRate: 0.15, riskLevel: 'HIGH' },
];

/**
 * Deterministic month-by-month compounding projection.
 * - Each month: tradesExecuted = startingCapital / avgTradeSize
 *   (rounded down, but always >= 1 if startingCapital > 0)
 * - projectedProfit = tradesExecuted * avgProfitPerTrade
 * - endingCapital = startingCapital + projectedProfit
 * - Next month: startingCapital grows by monthlyGrowthRate (reinvested profit)
 *   — but the "growth" applies to avgProfitPerTrade (compounding effect of learning
 *   + better deal selection). Starting capital itself is just (previous ending capital).
 */
function projectScenario(
  startingCapital: number,
  avgTradeSize: number,
  avgProfitPerTrade: number,
  monthlyGrowthRate: number,
  months = 24,
  avgMonthlyProfit: number,
): Scenario {
  const projection: MonthRow[] = [];
  let capital = startingCapital;
  let cumulative = 0;
  let profitPerTrade = avgProfitPerTrade;

  for (let m = 1; m <= months; m++) {
    const startCap = capital;
    const trades = avgTradeSize > 0 ? Math.max(1, Math.floor(startCap / avgTradeSize)) : 0;

    // Compounding: profit per trade grows monthly (learning + scale advantages)
    const monthProfit = Math.round(trades * profitPerTrade);

    // Anti-hallucination: clamp monthProfit to [0.5×, 3×] historical avg monthly profit
    const clampedProfit = avgMonthlyProfit > 0
      ? Math.max(
          Math.round(avgMonthlyProfit * 0.5),
          Math.min(Math.round(avgMonthlyProfit * 3), monthProfit),
        )
      : monthProfit;

    const endCap = Math.round(startCap + clampedProfit);
    cumulative += clampedProfit;

    projection.push({
      month: m,
      startingCapital: Math.round(startCap),
      tradesExecuted: trades,
      projectedProfit: clampedProfit,
      endingCapital: endCap,
      cumulativeProfit: cumulative,
    });

    capital = endCap;
    profitPerTrade = profitPerTrade * (1 + monthlyGrowthRate);
  }

  const lastRow = projection[projection.length - 1];
  return {
    name: 'conservative', // overwritten by caller
    monthlyGrowthRate,
    projection,
    finalCapital: lastRow?.endingCapital ?? startingCapital,
    totalProfit: lastRow?.cumulativeProfit ?? 0,
    riskLevel: 'LOW', // overwritten by caller
  };
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitMaximizerInput {}

const profitMaximizerHandler = withAiRoute<ProfitMaximizerInput>({
  endpoint: '/api/ai/profit-maximizer-v2',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async () => ({}),

  // No validateInput — endpoint ne sprejema inputa

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, req, callAi, parseAi, logger } = ctx;
    // @deprecated v8.94 — preserved: log usage of deprecated endpoint
    logDeprecatedCall('/api/ai/profit-maximizer-v2', req, '/api/ai/profit-maximizer-pro');

    // 1) Historical sold trades
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        sellDate: { not: null },
        // buyDate is non-nullable in schema (DateTime @default(now()))
      },
      select: {
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        buyDate: true,
        sellDate: true,
      },
      take: 1000,
      orderBy: { sellDate: 'desc' },
    });

    // 2) Current held inventory (capital tied up)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { buyPrice: true, buyDate: true },
      take: 500,
    });

    // 3) Compute baseline metrics
    let totalProfit = 0;
    let totalInvested = 0;
    let totalHoldDays = 0;
    let profitableTrades = 0;
    let sumTradeSize = 0;

    for (const t of soldTrades) {
      const buy = t.buyPrice + (t.buyFees ?? 0);
      const sell = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = sell - buy;
      totalProfit += profit;
      totalInvested += buy;
      sumTradeSize += buy;
      if (profit > 0) profitableTrades += 1;
      const hd = (new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / DAY_MS;
      if (hd >= 0) totalHoldDays += hd;
    }

    const avgROI = totalInvested > 0 ? Math.round((totalProfit / totalInvested) * 1000) / 10 : 0;
    const avgHoldDays = soldTrades.length > 0 ? Math.round(totalHoldDays / soldTrades.length) : 0;
    const winRate =
      soldTrades.length > 0
        ? Math.round((profitableTrades / soldTrades.length) * 1000) / 10
        : 0;
    const avgProfitPerTrade =
      soldTrades.length > 0 ? Math.round(totalProfit / soldTrades.length) : 0;
    const avgTradeSize =
      soldTrades.length > 0 ? Math.round(sumTradeSize / soldTrades.length) : 0;

    // capitalAvailable = sum of (sellPrice - sellFees) from recent sold trades (last 30d)
    const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);
    const recentSold = soldTrades.filter(t => new Date(t.sellDate!) >= thirtyDaysAgo);
    const capitalAvailable = recentSold.reduce(
      (s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)),
      0,
    );

    // Held capital tied up (informational)
    const heldCapitalTied = heldTrades.reduce((s, t) => s + t.buyPrice, 0);

    // avgMonthlyProfit: totalProfit normalized to months (assume 90d lookback by default)
    // If we have sell dates, compute actual months span; else use soldTrades.length/3
    let monthSpan = 3;
    if (soldTrades.length > 0) {
      const newest = Math.max(...soldTrades.map(t => new Date(t.sellDate!).getTime()));
      const oldest = Math.min(...soldTrades.map(t => new Date(t.sellDate!).getTime()));
      const spanDays = Math.max(1, (newest - oldest) / DAY_MS);
      monthSpan = Math.max(1, Math.round(spanDays / 30));
    }
    const avgMonthlyProfit = Math.round(totalProfit / monthSpan);

    const historical: HistoricalMetrics = {
      avgROI,
      avgHoldDays,
      winRate,
      avgProfitPerTrade,
      totalTrades: soldTrades.length,
      capitalAvailable,
      avgTradeSize,
      avgMonthlyProfit,
    };

    if (soldTrades.length === 0) {
      return apiOk({
        ok: true,
        historical,
        scenarios: [],
        recommendation: {
          scenario: null,
          reasoning:
            'Ni prodaj v zgodovini — zbrati vsaj 3 prodaje za smiselno projekcijo.',
          confidence: 0,
        },
        message: 'Ni dovolj zgodovinskih podatkov.',
      });
    }

    // Starting capital for projection: max(capitalAvailable, heldCapitalTied * 0.5)
    // (use available cash, fall back to a fraction of held inventory as a planning estimate)
    const projectionStartCapital = Math.max(
      capitalAvailable,
      Math.round(heldCapitalTied * 0.5),
      100, // floor
    );

    // 4) Check AI cache
    const cacheKey = `profit-maximizer-v2:${projectionStartCapital}`;
    const cached = getCachedAI<{
      historical: HistoricalMetrics;
      scenarios: Scenario[];
      recommendation: { scenario: string; reasoning: string; confidence: number };
    }>(cacheKey);
    if (cached) {
      return apiOk({ ok: true, ...cached, cached: true });
    }

    // 5) Compute 3 deterministic scenarios
    const scenarios: Scenario[] = SCENARIO_DEFS.map(def => {
      const s = projectScenario(
        projectionStartCapital,
        avgTradeSize,
        avgProfitPerTrade,
        def.monthlyGrowthRate,
        24,
        avgMonthlyProfit,
      );
      s.name = def.name;
      s.riskLevel = def.riskLevel;
      return s;
    });

    // 6) Build AI prompt for recommendation + reasoning
    const prompt = buildPrompt(historical, scenarios, heldCapitalTied, projectionStartCapital);

    let aiRec: AiRecommendation | null = null;
    let aiUsed = false;
    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiRecommendation | null;
      if (parsed && typeof parsed === 'object') {
        aiRec = parsed;
        aiUsed = true;
      }
    } catch (err) {
      logger.warn('/api/ai/profit-maximizer-v2', 'AI call failed — using deterministic fallback', err);
    }

    // 7) Validate AI recommendation; fall back to deterministic choice
    const validScenarios = new Set<ScenarioName>(['conservative', 'balanced', 'aggressive']);
    let recommendedName: ScenarioName;
    if (aiRec?.recommendedScenario && validScenarios.has(String(aiRec.recommendedScenario) as ScenarioName)) {
      recommendedName = String(aiRec.recommendedScenario) as ScenarioName;
    } else {
      // Deterministic choice:
      // - winRate < 50% OR avgROI < 5% → conservative
      // - winRate 50-70% AND avgROI 5-20% → balanced
      // - winRate > 70% AND avgROI > 20% → aggressive
      if (winRate < 50 || avgROI < 5) recommendedName = 'conservative';
      else if (winRate > 70 && avgROI > 20) recommendedName = 'aggressive';
      else recommendedName = 'balanced';
    }

    const recommended = scenarios.find(s => s.name === recommendedName)!;

    // Validate confidence — clamp to 0-100
    let confidence = 50;
    if (aiRec?.confidence != null) {
      const n = Number(aiRec.confidence);
      if (Number.isFinite(n)) {
        confidence = Math.max(0, Math.min(100, Math.round(n)));
      }
    } else {
      // Deterministic confidence: based on sample size + win rate stability
      const sampleSizeFactor = Math.min(1, historical.totalTrades / 20);
      confidence = Math.round(40 + sampleSizeFactor * 50);
    }

    // Reasoning
    let reasoning: string;
    if (aiRec?.reasoning && typeof aiRec.reasoning === 'string' && aiRec.reasoning.trim().length > 0) {
      reasoning = aiRec.reasoning.trim().slice(0, 400);
    } else {
      reasoning =
        recommendedName === 'aggressive'
          ? `Win rate ${winRate}% in ROI ${avgROI}% podpirata agresivno reinvesticijo — pričakovan končni kapital ${recommended.finalCapital}€ čez 24m.`
          : recommendedName === 'conservative'
          ? `Win rate ${winRate}% in ROI ${avgROI}% kažeta na previdnost — konzervativen scenarij prinese ${recommended.finalCapital}€ z nizkim tveganjem.`
          : `Win rate ${winRate}% in ROI ${avgROI}% podpirata uravnoteženo strategijo — ${recommended.finalCapital}€ v 24m z zmernim tveganjem.`;
    }

    const response = {
      ok: true,
      historical,
      scenarios,
      recommendation: {
        scenario: recommendedName,
        reasoning,
        confidence,
        riskTolerance: aiRec?.riskTolerance ?? (recommendedName === 'aggressive' ? 'high' : recommendedName === 'conservative' ? 'low' : 'medium'),
        notes: aiRec?.notes ?? '',
      },
      aiUsed,
      projectionStartCapital,
      heldCapitalTied: Math.round(heldCapitalTied),
    };

    // 8) Cache (6h TTL)
    setCachedAI(cacheKey, {
      historical,
      scenarios,
      recommendation: { scenario: recommendedName, reasoning, confidence },
    });

    return apiOk(response);
  },
});

// AI Hub runner compatibility — body is ignored, identical logic.
export const GET = profitMaximizerHandler;
export const POST = profitMaximizerHandler;

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildPrompt(
  historical: HistoricalMetrics,
  scenarios: Scenario[],
  heldCapitalTied: number,
  projectionStartCapital: number,
): string {
  const scenariosBlock = scenarios
    .map(s => {
      const m12 = s.projection.find(p => p.month === 12);
      return `${s.name.toUpperCase()} (rast ${Math.round(s.monthlyGrowthRate * 100)}%/m, ${s.riskLevel}):
- 12m: končni kapital ${m12?.endingCapital ?? 0}€, skupni profit ${m12?.cumulativeProfit ?? 0}€
- 24m: končni kapital ${s.finalCapital}€, skupni profit ${s.totalProfit}€`;
    })
    .join('\n');

  return `Si finančni svetovalec za preprodajalne rabljenih dobrin.

ZGODOVINSKI METRIKI:
- Skupaj prodaj: ${historical.totalTrades}
- Povprečni ROI: ${historical.avgROI}%
- Povprečni čas zadrževanja: ${historical.avgHoldDays} dni
- Win rate: ${historical.winRate}%
- Povprečni profit na trade: ${historical.avgProfitPerTrade}€
- Povprečna velikost trade-a: ${historical.avgTradeSize}€
- Povprečni mesečni profit: ${historical.avgMonthlyProfit}€
- Trenutno razpoložljivi kapital: ${historical.capitalAvailable}€
- Kapital vezan v held inventar: ${heldCapitalTied}€
- Začetni kapital za projekcijo: ${projectionStartCapital}€

SCENARIJI (24-mesečna projekcija z reinvesticijo):
${scenariosBlock}

Odgovori LE z JSON:
{
  "recommendedScenario": "conservative|balanced|aggressive",
  "reasoning": "<1-2 stavka — zakaj ta scenario glede na win rate, ROI, risk toleranco>",
  "confidence": <number 0-100>,
  "riskTolerance": "<low|medium|high — glede na win rate + ROI>",
  "notes": "<1 stavek — dodatno opozorilo ali nasvet>"
}${GROUNDING_PROMPT_SUFFIX}`;
}
