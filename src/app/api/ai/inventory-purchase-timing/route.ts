// v6.86 / v8.95.7-inv2-refactor: AI Inventory Purchase Timing — ML optimalen čas za nakup inventarja z market timing
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-purchase-timing
// Body: { days?: number, category?: string }
// Returns: { ok, analyzer: { overview, timingWindows, categoryAnalysis, priceForecasts, recommendations, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const TIMING_TIERS = ['excellent', 'good', 'fair', 'poor', 'avoid'] as const;
const MARKET_CONDITIONS = ['bull_market', 'bear_market', 'stable', 'volatile', 'seasonal_low', 'seasonal_high', 'post_holiday', 'pre_holiday', 'economic_uncertainty', 'clearance_period'] as const;

interface PurchaseTimingInput {
  days: number;
  category: string | null;
}

export const POST = withAiRoute<PurchaseTimingInput>({
  endpoint: '/api/ai/inventory-purchase-timing',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget + avtomatsko recordAiCall po uspehu

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      days: Math.max(7, Math.min(365, Number(body?.days ?? 90))),
      category: body?.category ? String(body.category).trim() : null,
    };
  },

  // No validateInput — days ima default, category je opcionalen

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { days, category } = input;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const boughtTrades = await db.trade.findMany({
      where: { buyDate: { gte: since } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, buyLocation: true, status: true },
      take: 1000,
      orderBy: { buyDate: 'desc' },
    });
    if (boughtTrades.length === 0) {
      return apiOk({ ok: true, analyzer: null, message: 'Ni nakupov za timing analizo.' });
    }

    const catStats = computeTimingCatStats(boughtTrades, days);

    const prompt = buildTimingPrompt({
      days,
      category,
      boughtCount: boughtTrades.length,
      totalSpent: boughtTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0),
      catStats,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const analyzer = transformTimingAnalyzer(parsed, catStats);

    return apiOk({ ok: true, analyzer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface TimingBoughtRow {
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  category: string | null;
}

interface TimingCatStat {
  recent: number;
  older: number;
  recentCost: number;
  olderCost: number;
  avgPrice: number;
}

function computeTimingCatStats(boughtTrades: TimingBoughtRow[], days: number): Map<string, TimingCatStat> {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const halfDays = Math.floor(days / 2);
  const midPoint = new Date(now - halfDays * DAY);

  const catStats = new Map<string, TimingCatStat>();
  for (const t of boughtTrades) {
    const cat = t.category || 'unknown';
    if (!catStats.has(cat)) catStats.set(cat, { recent: 0, older: 0, recentCost: 0, olderCost: 0, avgPrice: 0 });
    const s = catStats.get(cat)!;
    if (t.buyDate >= midPoint) {
      s.recent += 1;
      s.recentCost += t.buyPrice + (t.buyFees ?? 0);
    } else {
      s.older += 1;
      s.olderCost += t.buyPrice + (t.buyFees ?? 0);
    }
  }
  for (const s of catStats.values()) {
    const total = s.recent + s.older;
    s.avgPrice = total > 0 ? Math.round((s.recentCost + s.olderCost) / total) : 0;
  }
  return catStats;
}

interface TimingPromptInput {
  days: number;
  category: string | null;
  boughtCount: number;
  totalSpent: number;
  catStats: Map<string, TimingCatStat>;
}

function buildTimingPrompt(input: TimingPromptInput): string {
  const { days, category, boughtCount, totalSpent, catStats } = input;
  const catList = Array.from(catStats.entries()).slice(0, 12).map(([cat, s]) => `- ${cat} | recent: ${s.recent} (${Math.round(s.recentCost)}€) | older: ${s.older} | avg: ${s.avgPrice}€`).join('\n');

  return `Si AI inventory purchase timing analyzer z ML in market timing analysis.
Napoveduje optimalen čas za nakup inventarja z 5 tierji in 10 tržnimi razmerami.

STATS (zadnjih ${days} dni):
- Skupno nakupov: ${boughtCount}
- Skupna vrednost: ${Math.round(totalSpent)}€
${category ? `- Filter kategorija: ${category}` : ''}

KATEGORIJE:
${catList}

5 timing tierjev:
1. EXCELLENT: najboljši čas za nakup
2. GOOD: dober čas
3. FAIR: sprejemljiv
4. POOR: slab čas
5. AVOID: ne kupovati

10 tržnih razmer: bull_market, bear_market, stable, volatile, seasonal_low, seasonal_high, post_holiday, pre_holiday, economic_uncertainty, clearance_period

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_categories": <number>, "current_market_condition": "<${MARKET_CONDITIONS.join('|')}>", "avg_timing_score": <number 0-100>, "excellent_timing_count": <number>, "avoid_timing_count": <number>, "timing_grade": "<A|B|C|D|F>" },
  "timingWindows": [
    { "category": "<string>", "current_timing_tier": "<${TIMING_TIERS.join('|')}>", "best_purchase_window": "<YYYY-MM>", "worst_purchase_window": "<YYYY-MM>", "timing_confidence_pct": <number 0-100>, "expected_savings_pct": <number 0-30>, "days_until_optimal": <number>, "rationale": "<max 120 znakov>" }
  ],
  "categoryAnalysis": [
    { "category": "<string>", "current_avg_price_eur": <number>, "predicted_lowest_price_eur": <number>, "predicted_highest_price_eur": <number>, "price_volatility_pct": <number 0-100>, "seasonal_pattern": "<strong|moderate|weak|none>", "best_season": "<spring|summer|autumn|winter>", "market_trend": "<rising|falling|stable>" }
  ],
  "priceForecasts": [
    { "category": "<string>", "forecast_30d_eur": <number>, "forecast_90d_eur": <number>, "forecast_180d_eur": <number>, "confidence_pct": <number 0-100>, "trend_direction": "<up|down|flat>", "volatility_pct": <number 0-100> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "category": "<string>", "timing_tier": "<${TIMING_TIERS.join('|')}>", "expected_savings_eur": <number>, "wait_days": <number>, "priority": "<high|medium|low>", "rationale": "<max 120 znakov>" }
  ],
  "mlModels": [
    { "model": "<prophet|lstm|arima|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<price_forecast|timing_optimization|seasonality_detection|volatility_prediction>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "purchase_timing_score": <number 0-100>, "timing_grade": "<A|B|C|D|F>", "total_potential_savings_eur": <number>,
    "excellent_opportunities_count": <number>, "avoid_categories_count": <number>,
    "biggest_timing_risk": "<max 100 znakov>", "biggest_timing_opportunity": "<max 100 znakov>",
    "quickest_timing_win": "<max 100 znakov>", "timing_analysis_score": <number 0-100>
  }
}`;
}

function transformTimingAnalyzer(parsed: any, catStats: Map<string, TimingCatStat>) {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    overview: {
      totalCategories: Math.max(0, Number(parsed?.overview?.total_categories ?? catStats.size)),
      currentMarketCondition: (MARKET_CONDITIONS as readonly string[]).includes(String(parsed?.overview?.current_market_condition)) ? String(parsed.overview.current_market_condition) : 'stable',
      avgTimingScore: Math.max(0, Math.min(100, Number(parsed?.overview?.avg_timing_score ?? 50))),
      excellentTimingCount: Math.max(0, Number(parsed?.overview?.excellent_timing_count ?? 0)),
      avoidTimingCount: Math.max(0, Number(parsed?.overview?.avoid_timing_count ?? 0)),
      timingGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.timing_grade)) ? String(parsed.overview.timing_grade) : 'C',
    },
    timingWindows: (parsed?.timingWindows || []).slice(0, 12).map((t: any) => ({
      category: String(t?.category ?? '').slice(0, 50),
      currentTimingTier: (TIMING_TIERS as readonly string[]).includes(String(t?.current_timing_tier)) ? String(t.current_timing_tier) : 'fair',
      bestPurchaseWindow: String(t?.best_purchase_window ?? '').slice(0, 7),
      worstPurchaseWindow: String(t?.worst_purchase_window ?? '').slice(0, 7),
      timingConfidencePct: Math.max(0, Math.min(100, Number(t?.timing_confidence_pct ?? 60))),
      expectedSavingsPct: Math.max(0, Math.min(30, Number(t?.expected_savings_pct ?? 10))),
      daysUntilOptimal: Math.max(0, Number(t?.days_until_optimal ?? 0)),
      rationale: String(t?.rationale ?? '').slice(0, 250),
    })),
    categoryAnalysis: (parsed?.categoryAnalysis || []).slice(0, 12).map((c: any) => ({
      category: String(c?.category ?? '').slice(0, 50),
      currentAvgPriceEur: Math.round(Number(c?.current_avg_price_eur ?? 0)),
      predictedLowestPriceEur: Math.round(Number(c?.predicted_lowest_price_eur ?? 0)),
      predictedHighestPriceEur: Math.round(Number(c?.predicted_highest_price_eur ?? 0)),
      priceVolatilityPct: Math.max(0, Math.min(100, Number(c?.price_volatility_pct ?? 20))),
      seasonalPattern: ['strong', 'moderate', 'weak', 'none'].includes(String(c?.seasonal_pattern)) ? String(c.seasonal_pattern) : 'moderate',
      bestSeason: ['spring', 'summer', 'autumn', 'winter'].includes(String(c?.best_season)) ? String(c.best_season) : 'winter',
      marketTrend: ['rising', 'falling', 'stable'].includes(String(c?.market_trend)) ? String(c.market_trend) : 'stable',
    })),
    priceForecasts: (parsed?.priceForecasts || []).slice(0, 12).map((p: any) => ({
      category: String(p?.category ?? '').slice(0, 50),
      forecast30dEur: Math.round(Number(p?.forecast_30d_eur ?? 0)),
      forecast90dEur: Math.round(Number(p?.forecast_90d_eur ?? 0)),
      forecast180dEur: Math.round(Number(p?.forecast_180d_eur ?? 0)),
      confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 70))),
      trendDirection: ['up', 'down', 'flat'].includes(String(p?.trend_direction)) ? String(p.trend_direction) : 'flat',
      volatilityPct: Math.max(0, Math.min(100, Number(p?.volatility_pct ?? 20))),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 10).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      category: String(r?.category ?? '').slice(0, 50),
      timingTier: (TIMING_TIERS as readonly string[]).includes(String(r?.timing_tier)) ? String(r.timing_tier) : 'fair',
      expectedSavingsEur: Math.round(Number(r?.expected_savings_eur ?? 0)),
      waitDays: Math.max(0, Number(r?.wait_days ?? 0)),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      rationale: String(r?.rationale ?? '').slice(0, 250),
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['prophet', 'lstm', 'arima', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: ['price_forecast', 'timing_optimization', 'seasonality_detection', 'volatility_prediction'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'price_forecast',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      purchaseTimingScore: Math.max(0, Math.min(100, Number(parsed?.summary?.purchase_timing_score ?? 50))),
      timingGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.timing_grade)) ? String(parsed.summary.timing_grade) : 'C',
      totalPotentialSavingsEur: Math.round(Number(parsed?.summary?.total_potential_savings_eur ?? 0)),
      excellentOpportunitiesCount: Math.max(0, Number(parsed?.summary?.excellent_opportunities_count ?? 0)),
      avoidCategoriesCount: Math.max(0, Number(parsed?.summary?.avoid_categories_count ?? 0)),
      biggestTimingRisk: String(parsed?.summary?.biggest_timing_risk ?? '').slice(0, 200),
      biggestTimingOpportunity: String(parsed?.summary?.biggest_timing_opportunity ?? '').slice(0, 200),
      quickestTimingWin: String(parsed?.summary?.quickest_timing_win ?? '').slice(0, 200),
      timingAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.timing_analysis_score ?? 50))),
    },
  };
}
