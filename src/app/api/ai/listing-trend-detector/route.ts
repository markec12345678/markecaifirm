// v6.83 / v8.95.8-refactor: AI Listing Trend Detector — ML detekcija trendov za oglase z momentum analysis
// POST /api/ai/listing-trend-detector
// Body: { days?: number }
// Returns: { ok, detector: { overview, trends, categoryTrends, momentumSignals, mlModels, summary } }
// Refaktoriran z withAiRoute helperjem (v8.95.8) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const TREND_TYPES = ['rising_star', 'viral', 'hot', 'emerging', 'stable_grower', 'plateau', 'declining', 'fading', 'dead', 'seasonal_spike'] as const;
const MOMENTUM_SIGNALS = ['price_increase', 'demand_surge', 'supply_shortage', 'category_breakout', 'cross_category_shift', 'demographic_shift', 'seasonal_onset', 'competitor_exit', 'platform_algorithm_change', 'macro_event'] as const;

interface ListingTrendDetectorInput {
  days: number;
}

export const POST = withAiRoute<ListingTrendDetectorInput>({
  endpoint: '/api/ai/listing-trend-detector',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { days: Math.max(7, Math.min(365, Number(body?.days ?? 90))) };
  },

  // No validateInput — days ima default

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { days } = input;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since, not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellDate: true, buyDate: true },
      take: 1000, orderBy: { sellDate: 'desc' },
    });
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true },
      take: 200,
    });
    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return apiOk({ ok: true, detector: null, message: 'Ni podatkov za trend detekcijo.' });
    }

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const halfDays = Math.floor(days / 2);
    const midPoint = new Date(now - halfDays * DAY);

    const recentSold = soldTrades.filter(t => t.sellDate && t.sellDate >= midPoint);
    const olderSold = soldTrades.filter(t => t.sellDate && t.sellDate < midPoint);

    const catStats = computeCatStats(recentSold, olderSold);

    const catList = Array.from(catStats.entries()).slice(0, 12).map(([cat, s]) => `- ${cat} | recent: ${s.recent} (${Math.round(s.recentRev)}€) | older: ${s.older} | avg price: ${s.avgPrice}€`).join('\n');
    const heldList = heldTrades.slice(0, 8).map(t => `- ${t.title} | ${t.category} | ${t.buyPrice}€`).join('\n');

    const prompt = buildPrompt({
      days,
      halfDays,
      recentSoldCount: recentSold.length,
      olderSoldCount: olderSold.length,
      heldCount: heldTrades.length,
      catList,
      heldList,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const detector = transformDetector(parsed, catStats, recentSold.length, olderSold.length);

    return apiOk({ ok: true, detector });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface CatStat {
  recent: number;
  older: number;
  recentRev: number;
  olderRev: number;
  avgPrice: number;
}

function computeCatStats(
  recentSold: Array<{ category: string | null; sellPrice: number | null }>,
  olderSold: Array<{ category: string | null; sellPrice: number | null }>
): Map<string, CatStat> {
  const catStats = new Map<string, CatStat>();
  for (const t of recentSold) {
    const cat = t.category || 'unknown';
    if (!catStats.has(cat)) catStats.set(cat, { recent: 0, older: 0, recentRev: 0, olderRev: 0, avgPrice: 0 });
    catStats.get(cat)!.recent += 1; catStats.get(cat)!.recentRev += (t.sellPrice ?? 0);
  }
  for (const t of olderSold) {
    const cat = t.category || 'unknown';
    if (!catStats.has(cat)) catStats.set(cat, { recent: 0, older: 0, recentRev: 0, olderRev: 0, avgPrice: 0 });
    catStats.get(cat)!.older += 1; catStats.get(cat)!.olderRev += (t.sellPrice ?? 0);
  }
  for (const s of catStats.values()) {
    const total = s.recent + s.older;
    s.avgPrice = total > 0 ? Math.round((s.recentRev + s.olderRev) / total) : 0;
  }
  return catStats;
}

interface PromptData {
  days: number;
  halfDays: number;
  recentSoldCount: number;
  olderSoldCount: number;
  heldCount: number;
  catList: string;
  heldList: string;
}

function buildPrompt(d: PromptData): string {
  return `Si AI listing trend detector z ML in momentum analysis.
Detektira trende za oglase z 10 tipi in 10 momentum signali.

STATS (zadnjih ${d.days} dni, polovica = ${d.halfDays}d):
- Recent sold: ${d.recentSoldCount} | Older sold: ${d.olderSoldCount}
- Held items: ${d.heldCount}

KATEGORIJE:
${d.catList}

AKTIVNI OGLASI:
${d.heldList}

10 tipov trendov:
1. RISING_STAR: hitro naraščajoča priljubljenost
2. VIRAL: eksplozivna rast
3. HOT: visoko povpraševanje
4. EMERGING: nov trend v nastajanju
5. STABLE_GROWER: dosledna rast
6. PLATEAU: stagnacija
7. DECLINING: padajoč trend
8. FADING: izumiranje
9. DEAD: mrtev trend
10. SEASONAL_SPIKE: sezonski vrh

10 momentum signalov: price_increase, demand_surge, supply_shortage, category_breakout, cross_category_shift, demographic_shift, seasonal_onset, competitor_exit, platform_algorithm_change, macro_event

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_categories": <number>, "total_sold_recent": <number>, "total_sold_older": <number>, "growth_rate_pct": <number>, "trend_confidence_pct": <number 0-100>, "trend_grade": "<A|B|C|D|F>" },
  "trends": [
    { "category": "<string>", "trend_type": "<${TREND_TYPES.join('|')}>", "momentum_score": <number 0-100>, "growth_pct": <number -100 do 200>, "avg_price_eur": <number>, "price_trend_pct": <number -50 do 50>, "volume_trend_pct": <number -100 do 200>, "predicted_duration_days": <number>, "opportunity_score": <number 0-100> }
  ],
  "categoryTrends": [
    { "category": "<string>", "current_volume": <number>, "previous_volume": <number>, "volume_change_pct": <number>, "current_avg_price_eur": <number>, "previous_avg_price_eur": <number>, "price_change_pct": <number>, "trend_strength": "<strong|moderate|weak|none>", "trend_direction": "<up|down|flat>" }
  ],
  "momentumSignals": [
    { "signal": "<${MOMENTUM_SIGNALS.join('|')}>", "detected_categories": "<max 150 znakov>", "strength_pct": <number 0-100>, "duration_days": <number>, "affected_listings_count": <number>, "monetary_impact_eur": <number>, "action_required": "<capitalize|exit|hold|double_down|monitor>" }
  ],
  "mlModels": [
    { "model": "<prophet|lstm|arima|gradient_boosting|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<trend_detection|momentum_analysis|growth_forecast|seasonality_decomposition>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "trend_detection_score": <number 0-100>, "trend_grade": "<A|B|C|D|F>", "rising_trends_count": <number>,
    "declining_trends_count": <number>, "strongest_trend": "<string>",
    "biggest_trend_risk": "<max 100 znakov>", "biggest_trend_opportunity": "<max 100 znakov>",
    "quickest_trend_win": "<max 100 znakov>", "trend_analysis_score": <number 0-100>
  }
}`;
}

function transformDetector(
  parsed: any,
  catStats: Map<string, CatStat>,
  recentSoldCount: number,
  olderSoldCount: number
): {
  insights: string;
  overview: any;
  trends: any[];
  categoryTrends: any[];
  momentumSignals: any[];
  mlModels: any[];
  summary: any;
} {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    overview: {
      totalCategories: Math.max(0, Number(parsed?.overview?.total_categories ?? catStats.size)),
      totalSoldRecent: Math.max(0, Number(parsed?.overview?.total_sold_recent ?? recentSoldCount)),
      totalSoldOlder: Math.max(0, Number(parsed?.overview?.total_sold_older ?? olderSoldCount)),
      growthRatePct: Math.round(Number(parsed?.overview?.growth_rate_pct ?? (olderSoldCount > 0 ? ((recentSoldCount - olderSoldCount) / olderSoldCount) * 100 : 0)) * 10) / 10,
      trendConfidencePct: Math.max(0, Math.min(100, Number(parsed?.overview?.trend_confidence_pct ?? 70))),
      trendGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.trend_grade)) ? String(parsed.overview.trend_grade) : 'C',
    },
    trends: (parsed?.trends || []).slice(0, 12).map((t: any) => ({
      category: String(t?.category ?? '').slice(0, 50),
      trendType: (TREND_TYPES as readonly string[]).includes(String(t?.trend_type)) ? String(t.trend_type) : 'stable_grower',
      momentumScore: Math.max(0, Math.min(100, Number(t?.momentum_score ?? 50))),
      growthPct: Math.max(-100, Math.min(200, Number(t?.growth_pct ?? 0))),
      avgPriceEur: Math.round(Number(t?.avg_price_eur ?? 0)),
      priceTrendPct: Math.max(-50, Math.min(50, Number(t?.price_trend_pct ?? 0))),
      volumeTrendPct: Math.max(-100, Math.min(200, Number(t?.volume_trend_pct ?? 0))),
      predictedDurationDays: Math.max(0, Number(t?.predicted_duration_days ?? 30)),
      opportunityScore: Math.max(0, Math.min(100, Number(t?.opportunity_score ?? 50))),
    })),
    categoryTrends: (parsed?.categoryTrends || []).slice(0, 12).map((c: any) => ({
      category: String(c?.category ?? '').slice(0, 50),
      currentVolume: Math.max(0, Number(c?.current_volume ?? 0)),
      previousVolume: Math.max(0, Number(c?.previous_volume ?? 0)),
      volumeChangePct: Math.round(Number(c?.volume_change_pct ?? 0) * 10) / 10,
      currentAvgPriceEur: Math.round(Number(c?.current_avg_price_eur ?? 0)),
      previousAvgPriceEur: Math.round(Number(c?.previous_avg_price_eur ?? 0)),
      priceChangePct: Math.round(Number(c?.price_change_pct ?? 0) * 10) / 10,
      trendStrength: ['strong', 'moderate', 'weak', 'none'].includes(String(c?.trend_strength)) ? String(c.trend_strength) : 'moderate',
      trendDirection: ['up', 'down', 'flat'].includes(String(c?.trend_direction)) ? String(c.trend_direction) : 'flat',
    })),
    momentumSignals: (parsed?.momentumSignals || []).slice(0, 10).map((m: any) => ({
      signal: (MOMENTUM_SIGNALS as readonly string[]).includes(String(m?.signal)) ? String(m.signal) : 'demand_surge',
      detectedCategories: String(m?.detected_categories ?? '').slice(0, 300),
      strengthPct: Math.max(0, Math.min(100, Number(m?.strength_pct ?? 50))),
      durationDays: Math.max(0, Number(m?.duration_days ?? 7)),
      affectedListingsCount: Math.max(0, Number(m?.affected_listings_count ?? 0)),
      monetaryImpactEur: Math.round(Number(m?.monetary_impact_eur ?? 0)),
      actionRequired: ['capitalize', 'exit', 'hold', 'double_down', 'monitor'].includes(String(m?.action_required)) ? String(m.action_required) : 'monitor',
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['prophet', 'lstm', 'arima', 'gradient_boosting', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: ['trend_detection', 'momentum_analysis', 'growth_forecast', 'seasonality_decomposition'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'trend_detection',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      trendDetectionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.trend_detection_score ?? 50))),
      trendGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.trend_grade)) ? String(parsed.summary.trend_grade) : 'C',
      risingTrendsCount: Math.max(0, Number(parsed?.summary?.rising_trends_count ?? 0)),
      decliningTrendsCount: Math.max(0, Number(parsed?.summary?.declining_trends_count ?? 0)),
      strongestTrend: String(parsed?.summary?.strongest_trend ?? '').slice(0, 100),
      biggestTrendRisk: String(parsed?.summary?.biggest_trend_risk ?? '').slice(0, 200),
      biggestTrendOpportunity: String(parsed?.summary?.biggest_trend_opportunity ?? '').slice(0, 200),
      quickestTrendWin: String(parsed?.summary?.quickest_trend_win ?? '').slice(0, 200),
      trendAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.trend_analysis_score ?? 50))),
    },
  };
}
