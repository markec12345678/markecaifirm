// v7.94: AI Deal Profitability Forecaster — AI napove PROFITABILITY
// potencialnih deal-ov PRED nakupom — "ali naj kupim ta item?".
// Za vsak PRILIKA listing AI predvidi: expected profit, ROI, hold time,
// sell probability in risk-adjusted return. PRE-PURCHASE profitability
// predictor. "PS5 350€ (estValue 500€, -30% discount): expected +120€
// profit, 35% ROI, 22d hold. Grade: A. STRONG_BUY. Optimal buy: ≤380€."
//
// Razlika od deal-profitability-matrix (v7.72 ki gleda category × hold-time
// profitability kot matriko) — ta forecast-a POSAMEZEN listing per-item.
// Razlika od deal-anatomy-analyzer (v7.71 ki analizira deal DNA) — ta
// forecast-a PROFITABILITY (expected profit + ROI + sell probability).
// Razlika od deal-scoring-model-v2 (v7.69 ki računa deal score 0-100)
// — ta daje PROFITABILITY forecast z buy recommendation in optimal
// buy/sell prices. Razlika od deal-quality-forecaster (ki napoveduje
// quality po dnevih v tednu) — ta forecast-a PER-LISTING profitability.
// Razlika od risk-reward-calculator (ki gleda potential reward/loss)
// — ta kombinira profit + ROI + hold time + sell probability v grade.
//
// GET+POST /api/ai/deal-profitability-forecaster
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.6) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Input ----------------------------------------------------------------

interface DealProfitabilityForecasterInput {
  listingId?: string;
}

// --- Types ---------------------------------------------------------------

type ProfitabilityGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
type BuyRecommendation = 'STRONG_BUY' | 'BUY' | 'CONSIDER' | 'PASS' | 'STRONG_AVOID';
type DriverImpact = 'POSITIVE' | 'NEGATIVE';
type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

interface ProfitDriver {
  driver: string;
  impact: DriverImpact;
  weight: number; // 0-100
  detail: string;
}

interface ProfitRisk {
  risk: string;
  severity: RiskSeverity;
  mitigation: string;
}

interface ListingForecast {
  expectedProfit: number; // EUR
  expectedROI: number; // %
  expectedHoldDays: number;
  sellProbability30d: number; // 0-100 %
  riskAdjustedReturn: number; // EUR (expectedProfit × sellProbability)
  profitabilityGrade: ProfitabilityGrade;
  buyRecommendation: BuyRecommendation;
  optimalBuyPrice: number; // EUR — max price to pay for target ROI
  optimalSellPrice: number; // EUR — recommended sell price
  keyProfitDrivers: ProfitDriver[];
  profitRisks: ProfitRisk[];
  profitOptimizationTips: string[];
  confidenceLevel: number; // 0-100
}

interface ListingResult {
  listingId: string;
  title: string;
  askingPrice: number;
  estValue: number | null;
  discountPercent: number;
  dealScore: number | null;
  category: string;
  forecast: ListingForecast;
}

interface Summary {
  totalAnalyzed: number;
  strongBuyCount: number;
  buyCount: number;
  considerCount: number;
  passCount: number;
  avoidCount: number;
  totalExpectedProfit: number;
  avgROI: number;
  bestDeal: { listingId: string; title: string; expectedProfit: number } | null;
  advice: string;
}

interface AiForecastResponse {
  forecasts?: Record<string, {
    expectedProfit?: number;
    expectedROI?: number;
    expectedHoldDays?: number;
    sellProbability30d?: number;
    riskAdjustedReturn?: number;
    profitabilityGrade?: ProfitabilityGrade;
    buyRecommendation?: BuyRecommendation;
    optimalBuyPrice?: number;
    optimalSellPrice?: number;
    keyProfitDrivers?: Array<{ driver?: string; impact?: DriverImpact; weight?: number; detail?: string }>;
    profitRisks?: Array<{ risk?: string; severity?: RiskSeverity; mitigation?: string }>;
    profitOptimizationTips?: string[];
    confidenceLevel?: number;
  }>;
  summary?: {
    advice?: string;
  };
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const WEIGHT_MIN = 0;
const WEIGHT_MAX = 100;
const CONF_MIN = 0;
const CONF_MAX = 100;
const DISCOUNT_MIN = -100; // allow premium listings (price > estValue)
const DISCOUNT_MAX = 100;
const HOLD_DAYS_MIN = 1;
const HOLD_DAYS_MAX = 365;
const ROI_MIN = -100;
const ROI_MAX = 1000;
const PROFIT_MIN_FACTOR = -1; // -1× estValue
const PROFIT_MAX_FACTOR = 1; // +1× estValue
const PROB_MIN = 0;
const PROB_MAX = 100;

const VALID_GRADE: readonly ProfitabilityGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_RECOMMENDATION: readonly BuyRecommendation[] = ['STRONG_BUY', 'BUY', 'CONSIDER', 'PASS', 'STRONG_AVOID'];
const VALID_IMPACT: readonly DriverImpact[] = ['POSITIVE', 'NEGATIVE'];
const VALID_SEVERITY: readonly RiskSeverity[] = ['LOW', 'MEDIUM', 'HIGH'];

// --- Helpers -------------------------------------------------------------

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
  const s = String(raw ?? '').trim().toUpperCase().replace(/[\s-]/g, '_');
  for (const v of valid) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function round0(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v);
}

function toMs(d: Date | null | undefined): number {
  if (!d) return 0;
  try {
    return new Date(d as unknown as Date | string).getTime();
  } catch {
    return 0;
  }
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// --- Listing row type ----------------------------------------------------

interface ListingRow {
  id: string;
  title: string;
  price: number | null;
  aiEstimatedValue: number | null;
  aiScore: number | null;
  aiRisk: number | null;
  dealScore: number | null;
  aiVerdict: string | null;
  monitor: { tags: string } | null;
}

interface SoldTradeRow {
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  category: string;
}

// --- Category baseline ---------------------------------------------------

interface CategoryBaseline {
  avgROI: number; // %
  avgHoldDays: number;
  winRate: number; // % profitable
  avgProfit: number; // EUR
  sampleSize: number;
}

function computeCategoryBaselines(soldTrades: SoldTradeRow[]): Map<string, CategoryBaseline> {
  const byCat = new Map<string, {
    rois: number[];
    holdDays: number[];
    profits: number[];
    wins: number;
    count: number;
  }>();
  const cutoff12m = Date.now() - HORIZON_12M;
  for (const t of soldTrades) {
    const sellMs = toMs(t.sellDate);
    if (sellMs <= 0 || sellMs < cutoff12m) continue;
    const sellPrice = t.sellPrice ?? 0;
    const sellFees = t.sellFees ?? 0;
    const buyPrice = t.buyPrice ?? 0;
    const buyFees = t.buyFees ?? 0;
    const buyMs = toMs(t.buyDate);
    const cost = buyPrice + buyFees;
    const revenue = sellPrice - sellFees;
    const profit = revenue - cost;
    const roi = cost > 0 ? (profit / cost) * 100 : 0;
    const holdDays = buyMs > 0 ? (sellMs - buyMs) / DAY_MS : 30;

    const cat = (t.category || 'drugo').trim().toLowerCase() || 'drugo';
    const c = byCat.get(cat) || { rois: [], holdDays: [], profits: [], wins: 0, count: 0 };
    c.rois.push(roi);
    c.holdDays.push(holdDays);
    c.profits.push(profit);
    if (profit > 0) c.wins += 1;
    c.count += 1;
    byCat.set(cat, c);
  }

  const result = new Map<string, CategoryBaseline>();
  for (const [cat, c] of byCat) {
    result.set(cat, {
      avgROI: avg(c.rois),
      avgHoldDays: avg(c.holdDays),
      winRate: c.count > 0 ? (c.wins / c.count) * 100 : 0,
      avgProfit: avg(c.profits),
      sampleSize: c.count,
    });
  }
  return result;
}

function getCategoryFromListing(l: ListingRow): string {
  const tagsRaw = (l.monitor?.tags as string | undefined) || '';
  const firstTag = tagsRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)[0];
  return (firstTag || 'drugo').trim() || 'drugo';
}

// --- Deterministic forecast ---------------------------------------------

function gradeFromMetrics(
  expectedROI: number,
  sellProb: number,
  discount: number,
  aiRisk: number,
): ProfitabilityGrade {
  // Composite score: 0-100
  let score = 50;
  score += Math.min(30, expectedROI / 4); // ROI up to +30
  score += Math.min(20, (sellProb - 50) * 0.4); // sell prob deviation
  score += Math.min(20, discount * 0.5); // discount boost
  score -= Math.min(20, aiRisk * 2); // risk penalty
  score = Math.max(0, Math.min(100, score));
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

function recommendationFromGrade(
  grade: ProfitabilityGrade,
  expectedROI: number,
  sellProb: number,
): BuyRecommendation {
  if (grade === 'A+' && expectedROI > 30 && sellProb > 60) return 'STRONG_BUY';
  if (grade === 'A' && expectedROI > 20) return 'BUY';
  if (grade === 'B' && expectedROI > 10) return 'BUY';
  if (grade === 'B') return 'CONSIDER';
  if (grade === 'C') return 'CONSIDER';
  if (grade === 'D') return 'PASS';
  return 'STRONG_AVOID';
}

function buildDeterministicForecast(
  listing: ListingRow,
  category: string,
  catBaseline: CategoryBaseline | undefined,
): ListingForecast {
  const askingPrice = listing.price ?? 0;
  const estValue = listing.aiEstimatedValue ?? 0;
  const discount = estValue > 0
    ? Math.max(DISCOUNT_MIN, Math.min(DISCOUNT_MAX, ((estValue - askingPrice) / estValue) * 100))
    : 0;
  const dealScore = listing.dealScore ?? 50;
  const aiRisk = listing.aiRisk ?? 5;

  // Expected profit — based on category avg profit + discount depth
  const catAvgProfit = catBaseline?.avgProfit ?? 0;
  const discountBonus = estValue > 0 ? (discount / 100) * estValue * 0.3 : 0;
  let expectedProfit = catAvgProfit + discountBonus;
  if (estValue > 0 && askingPrice > 0) {
    // If estValue > askingPrice, profit potential = estValue - askingPrice
    const profitFromDiscount = estValue - askingPrice;
    expectedProfit = Math.max(expectedProfit, profitFromDiscount * 0.7); // 70% capture rate
  }
  // Anti-hallucination: clamp to [-estValue, estValue]
  const profitMax = estValue > 0 ? estValue * PROFIT_MAX_FACTOR : Math.max(100, expectedProfit * 2);
  const profitMin = estValue > 0 ? estValue * PROFIT_MIN_FACTOR : -Math.max(100, Math.abs(expectedProfit));
  expectedProfit = round0(Math.max(profitMin, Math.min(profitMax, expectedProfit)));

  // Expected ROI
  const cost = askingPrice;
  const expectedROI = cost > 0 ? (expectedProfit / cost) * 100 : 0;
  const expectedROIClamped = round0(Math.max(ROI_MIN, Math.min(ROI_MAX, expectedROI)));

  // Expected hold days — category baseline
  const expectedHoldDays = round0(
    Math.max(HOLD_DAYS_MIN, Math.min(HOLD_DAYS_MAX, catBaseline?.avgHoldDays ?? 30)),
  );

  // Sell probability — based on dealScore + discount + category win rate
  let sellProb = 50;
  sellProb += Math.min(20, (dealScore - 50) * 0.4); // dealScore deviation
  sellProb += Math.min(15, discount * 0.3); // discount boost
  if (catBaseline) {
    sellProb += (catBaseline.winRate - 50) * 0.2;
  }
  sellProb -= Math.min(15, aiRisk * 1.5); // risk penalty
  const sellProbability30d = round0(Math.max(PROB_MIN, Math.min(PROB_MAX, sellProb)));

  // Risk-adjusted return = expectedProfit × sellProbability
  const riskAdjustedReturn = round0((expectedProfit * sellProbability30d) / 100);

  // Grade + recommendation
  const profitabilityGrade = gradeFromMetrics(expectedROIClamped, sellProbability30d, discount, aiRisk);
  const buyRecommendation = recommendationFromGrade(profitabilityGrade, expectedROIClamped, sellProbability30d);

  // Optimal buy price — max price to pay for 25% ROI
  const optimalBuyPrice = round0(
    Math.max(0, Math.min(askingPrice, estValue > 0 ? estValue / 1.25 : askingPrice * 0.8)),
  );

  // Optimal sell price — recommended sell price (estValue × 0.95 if available, else askingPrice × 1.3)
  const optimalSellPrice = round0(
    estValue > 0
      ? Math.max(askingPrice * 0.8, Math.min(estValue * 1.2, estValue * 0.95))
      : Math.max(askingPrice * 0.8, Math.min(askingPrice * 1.5, askingPrice * 1.3)),
  );

  // Key profit drivers
  const drivers: ProfitDriver[] = [];
  if (discount > 20) {
    drivers.push({
      driver: 'Price discount depth',
      impact: 'POSITIVE',
      weight: round0(Math.min(WEIGHT_MAX, discount)),
      detail: `Cena je ${round0(discount)}% pod estValue (${estValue}€).`.slice(0, 200),
    });
  }
  if (dealScore > 70) {
    drivers.push({
      driver: 'Deal score',
      impact: 'POSITIVE',
      weight: round0(Math.min(WEIGHT_MAX, dealScore)),
      detail: `Deal score ${dealScore}/100 — visoka kvaliteta deal-a.`.slice(0, 200),
    });
  }
  if (aiRisk > 5) {
    drivers.push({
      driver: 'AI risk score',
      impact: 'NEGATIVE',
      weight: round0(Math.min(WEIGHT_MAX, aiRisk * 10)),
      detail: `AI risk ${aiRisk}/10 — tveganje nepričakovanih težav.`.slice(0, 200),
    });
  }
  if (catBaseline && catBaseline.winRate > 70) {
    drivers.push({
      driver: 'Category win rate',
      impact: 'POSITIVE',
      weight: round0(Math.min(WEIGHT_MAX, catBaseline.winRate)),
      detail: `Kategorija ${category}: ${round0(catBaseline.winRate)}% win rate (sample ${catBaseline.sampleSize}).`.slice(0, 200),
    });
  }
  if (drivers.length === 0) {
    drivers.push({
      driver: 'Standard profitability',
      impact: 'POSITIVE',
      weight: 40,
      detail: 'Deal ustreza standardnim profitability kriterijem.'.slice(0, 200),
    });
  }
  drivers.sort((a, b) => b.weight - a.weight);

  // Profit risks
  const risks: ProfitRisk[] = [];
  if (aiRisk >= 7) {
    risks.push({
      risk: `Visok AI risk (${aiRisk}/10) — možne skrite težave.`,
      severity: 'HIGH',
      mitigation: 'Preveri listing podrobno pred nakupom.',
    });
  }
  if (estValue === 0 || estValue === null) {
    risks.push({
      risk: 'Manjka AI estimated value — profitability napoved je negotljiva.',
      severity: 'MEDIUM',
      mitigation: 'Počakaj na AI evaluation ali ročno določi market value.',
    });
  }
  if (catBaseline && catBaseline.sampleSize < 5) {
    risks.push({
      risk: `Majhna vzorčna osnova v kategoriji (${catBaseline.sampleSize} trgov).`,
      severity: 'MEDIUM',
      mitigation: 'Forecast je negotljiv — dopolni z lastnim znanjem kategorije.',
    });
  }
  if (sellProbability30d < 40) {
    risks.push({
      risk: `Nizka sell probability (${sellProbability30d}%) v 30 dneh.`,
      severity: 'MEDIUM',
      mitigation: 'Postavi konkurenčno ceno ali počakaj na pravi čas.',
    });
  }
  if (risks.length === 0) {
    risks.push({
      risk: 'Brez specifičnih tveganj — deal je clean.',
      severity: 'LOW',
      mitigation: 'Standardni previdnostni ukrepi pred nakupom.',
    });
  }

  // Profit optimization tips
  const tips: string[] = [];
  if (discount > 20) {
    tips.push(`Izkoristi ${round0(discount)}% popust — pogajaj se za še nižjo ceno.`);
  }
  if (dealScore > 70) {
    tips.push('Visok deal score — kupi hitro pred konkurenco.');
  }
  if (optimalSellPrice > askingPrice * 1.2) {
    tips.push(`Prodamo pri ~${optimalSellPrice}€ (asking × 1.2+).`);
  }
  if (catBaseline && catBaseline.avgHoldDays > 30) {
    tips.push(`Pričakovan hold: ${round0(catBaseline.avgHoldDays)} dni — načrtuj cash flow.`);
  }
  if (aiRisk >= 5) {
    tips.push('Preveri listing podrobno (slike, opis, seller history).');
  }
  if (tips.length === 0) {
    tips.push('Standardna flip strategija — kupi, fotografiraj, objavi z malo marže.');
  }

  // Confidence
  let confidence = 30;
  if (estValue > 0) confidence += 20;
  if (catBaseline && catBaseline.sampleSize >= 5) confidence += 20;
  if (dealScore > 0) confidence += 10;
  if (aiRisk <= 5) confidence += 10;
  confidence = round0(Math.max(CONF_MIN, Math.min(CONF_MAX, confidence)));

  return {
    expectedProfit,
    expectedROI: expectedROIClamped,
    expectedHoldDays,
    sellProbability30d,
    riskAdjustedReturn,
    profitabilityGrade,
    buyRecommendation,
    optimalBuyPrice,
    optimalSellPrice,
    keyProfitDrivers: drivers.slice(0, 3),
    profitRisks: risks.slice(0, 3),
    profitOptimizationTips: tips.slice(0, 4),
    confidenceLevel: confidence,
  };
}

function buildSummary(results: ListingResult[]): Summary {
  const total = results.length;
  let strong = 0, buy = 0, consider = 0, pass = 0, avoid = 0;
  let totalProfit = 0;
  let totalROI = 0;
  let best: { listingId: string; title: string; expectedProfit: number } | null = null;
  for (const r of results) {
    switch (r.forecast.buyRecommendation) {
      case 'STRONG_BUY': strong += 1; break;
      case 'BUY': buy += 1; break;
      case 'CONSIDER': consider += 1; break;
      case 'PASS': pass += 1; break;
      case 'STRONG_AVOID': avoid += 1; break;
    }
    totalProfit += r.forecast.expectedProfit;
    totalROI += r.forecast.expectedROI;
    if (!best || r.forecast.expectedProfit > best.expectedProfit) {
      best = { listingId: r.listingId, title: r.title, expectedProfit: r.forecast.expectedProfit };
    }
  }
  const advice = total === 0
    ? 'Ni aktivnih PRILIKA oglasov za analizo.'
    : strong > 0
      ? `${strong} STRONG_BUY priložnosti — kupi čimprej!`
      : buy > 0
        ? `${buy} BUY priložnosti — analiziraj pred nakupom.`
        : consider > 0
          ? `${consider} CONSIDER priložnosti — previdno evaluiraj.`
          : 'Ni izrazitih priložnosti — počakaj na boljše deals.';
  return {
    totalAnalyzed: total,
    strongBuyCount: strong,
    buyCount: buy,
    considerCount: consider,
    passCount: pass,
    avoidCount: avoid,
    totalExpectedProfit: round0(totalProfit),
    avgROI: round0(total > 0 ? totalROI / total : 0),
    bestDeal: best,
    advice,
  };
}

// --- Handler -------------------------------------------------------------

const dealProfitabilityForecasterHandler = withAiRoute<DealProfitabilityForecasterInput>({
  endpoint: '/api/ai/deal-profitability-forecaster',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { listingId: body?.listingId ? String(body.listingId) : undefined };
  },

  // No validateInput — listingId is optional (GET = forecast all PRILIKA)
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;
    const { listingId } = input;

    // 1) Query listings (PRILIKA = active opportunity listings)
    const listingWhere = listingId
      ? {
        id: listingId,
        isHidden: false,
        aiVerdict: 'PRILIKA',
      }
      : {
        isHidden: false,
        aiVerdict: 'PRILIKA',
        price: { gt: 0 },
      };

    const listings = await db.listing.findMany({
      where: listingWhere,
      select: {
        id: true,
        title: true,
        price: true,
        aiEstimatedValue: true,
        aiScore: true,
        aiRisk: true,
        dealScore: true,
        aiVerdict: true,
        monitor: { select: { tags: true } },
      },
      take: listingId ? 1 : 50,
      orderBy: listingId ? undefined : { dealScore: 'desc' },
    }) as unknown as ListingRow[];

    // Empty state
    if (listings.length === 0) {
      return apiOk({
        ok: true,
        listings: [],
        summary: {
          totalAnalyzed: 0,
          strongBuyCount: 0,
          buyCount: 0,
          considerCount: 0,
          passCount: 0,
          avoidCount: 0,
          totalExpectedProfit: 0,
          avgROI: 0,
          bestDeal: null,
          advice: 'Ni aktivnih PRILIKA oglasov za analizo — dodaš oglase ali spremeniš aiVerdict v PRILIKA.',
        },
        aiUsed: false,
        message: 'Ni aktivnih PRILIKA oglasov za analizo — dodaš oglase ali spremeniš aiVerdict v PRILIKA.',
      });
    }

    // 2) Query historical SOLD trades for category baselines
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        buyPrice: { gt: 0 },
        sellPrice: { not: null },
      },
      select: {
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        category: true,
      },
      take: 5000,
    }) as unknown as SoldTradeRow[];

    const categoryBaselines = computeCategoryBaselines(soldTrades);

    // 3) Build deterministic forecasts (fallback)
    const detResults: ListingResult[] = listings.map((l) => {
      const category = getCategoryFromListing(l);
      const askingPrice = l.price ?? 0;
      const estValue = l.aiEstimatedValue ?? 0;
      const discount = estValue > 0
        ? round0(Math.max(DISCOUNT_MIN, Math.min(DISCOUNT_MAX, ((estValue - askingPrice) / estValue) * 100)))
        : 0;
      return {
        listingId: l.id,
        title: l.title,
        askingPrice,
        estValue: l.aiEstimatedValue,
        discountPercent: discount,
        dealScore: l.dealScore,
        category,
        forecast: buildDeterministicForecast(l, category, categoryBaselines.get(category)),
      };
    });

    // 4) AI cache check (6h TTL) — key by listing IDs
    const listingIds = listings.map((l) => l.id).sort().join(',');
    const cacheKey = `deal-profitability-forecaster:${listingIds}`;
    const cached = getCachedAI<{
      forecasts: Record<string, ListingForecast>;
      summaryAdvice: string;
    }>(cacheKey);

    let forecasts: Record<string, ListingForecast> = {};
    let summaryAdviceOverride: string | null = null;
    let aiUsed = false;

    if (cached) {
      forecasts = cached.forecasts;
      summaryAdviceOverride = cached.summaryAdvice;
      aiUsed = true;
    } else {
      // 5) AI prompt with grounding
      const listingContext = detResults.map((r) => ({
        listingId: r.listingId,
        title: r.title.slice(0, 100),
        askingPrice: r.askingPrice,
        estValue: r.estValue,
        discountPercent: r.discountPercent,
        dealScore: r.dealScore,
        category: r.category,
        deterministicForecast: r.forecast,
      }));

      const promptData = {
        listings: listingContext,
        categoryBaselines: Array.from(categoryBaselines.entries()).map(([cat, b]) => ({
          category: cat,
          avgROI: round0(b.avgROI),
          avgHoldDays: round0(b.avgHoldDays),
          winRate: round0(b.winRate),
          avgProfit: round0(b.avgProfit),
          sampleSize: b.sampleSize,
        })),
        caps: {
          profitMinFactor: PROFIT_MIN_FACTOR,
          profitMaxFactor: PROFIT_MAX_FACTOR,
          probMin: PROB_MIN,
          probMax: PROB_MAX,
          roiMin: ROI_MIN,
          roiMax: ROI_MAX,
          holdDaysMin: HOLD_DAYS_MIN,
          holdDaysMax: HOLD_DAYS_MAX,
          weightMin: WEIGHT_MIN,
          weightMax: WEIGHT_MAX,
          confMin: CONF_MIN,
          confMax: CONF_MAX,
        },
      };

      const prompt = `Si AI "Deal Profitability Forecaster" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Napoveš PROFITABILITY potencialnih deal-ov PRED nakupom — "ali naj kupim ta item?". Za vsak PRILIKA listing predvidiš: expected profit, ROI, hold time, sell probability in risk-adjusted return. PRE-PURCHASE profitability predictor. Razlika od deal-profitability-matrix (v7.72 ki gleda category × hold-time kot matriko) — ti forecast-a POSAMEZEN listing per-item.

DETERMINISTIČNI PODATKI (izračunano iz DB — listings + historical SOLD trades per category):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. forecasts: per-listing object keyed by listingId z vsemi forecast polji.
2. expectedProfit: EUR, clamped [-estValue, +estValue] (anti-hallucination).
3. expectedROI: %, clamped [-100, 1000].
4. expectedHoldDays: 1-365 dni.
5. sellProbability30d: 0-100%.
6. riskAdjustedReturn: EUR = expectedProfit × sellProbability30d / 100.
7. profitabilityGrade: A+ | A | B | C | D | F (kombinacija ROI + sellProb + discount + risk).
8. buyRecommendation: STRONG_BUY | BUY | CONSIDER | PASS | STRONG_AVOID.
9. optimalBuyPrice: EUR, max cena za 25% ROI target, clamped [0, askingPrice].
10. optimalSellPrice: EUR, recommended sell price, clamped [askingPrice × 0.8, estValue × 1.2].
11. keyProfitDrivers: 1-3 driverjev { driver (max 100), impact POSITIVE | NEGATIVE, weight 0-100, detail (max 200) }.
12. profitRisks: 1-3 tveganj { risk (max 200), severity LOW | MEDIUM | HIGH, mitigation (max 200) }.
13. profitOptimizationTips: 1-4 concrete tips (max 200 chars each).
14. confidenceLevel: 0-100.
15. summary.advice: slovenski overall nasvet (max 300 chars).

VRNI LE JSON:
{
  "forecasts": {
    "listing_abc": {
      "expectedProfit": 120,
      "expectedROI": 35,
      "expectedHoldDays": 22,
      "sellProbability30d": 65,
      "riskAdjustedReturn": 78,
      "profitabilityGrade": "A",
      "buyRecommendation": "STRONG_BUY",
      "optimalBuyPrice": 380,
      "optimalSellPrice": 475,
      "keyProfitDrivers": [
        { "driver": "Price discount depth", "impact": "POSITIVE", "weight": 30, "detail": "Cena je 30% pod estValue (500€)." }
      ],
      "profitRisks": [
        { "risk": "Majhna vzorčna osnova v kategoriji.", "severity": "MEDIUM", "mitigation": "Forecast je negotljiv." }
      ],
      "profitOptimizationTips": ["Izkoristi 30% popust — pogajaj se za še nižjo ceno."],
      "confidenceLevel": 72
    }
  },
  "summary": { "advice": "3 STRONG_BUY priložnosti — kupi čimprej!" }
}${GROUNDING_PROMPT_SUFFIX}`;

      try {
        const raw = await callAi(prompt);
        const parsed = parseAi(raw) as AiForecastResponse | null;

        if (parsed && typeof parsed === 'object' && parsed.forecasts) {
          for (const det of detResults) {
            const ai = parsed.forecasts[det.listingId];
            if (!ai || typeof ai !== 'object') {
              forecasts[det.listingId] = det.forecast;
              continue;
            }
            const estValue = det.estValue ?? 0;
            const profitMax = estValue > 0 ? estValue * PROFIT_MAX_FACTOR : Math.max(100, Math.abs(det.forecast.expectedProfit) * 2);
            const profitMin = estValue > 0 ? estValue * PROFIT_MIN_FACTOR : -Math.max(100, Math.abs(det.forecast.expectedProfit));
            const expectedProfit = round0(
              clampNum(ai.expectedProfit, profitMin, profitMax, det.forecast.expectedProfit),
            );
            const expectedROI = round0(
              clampNum(ai.expectedROI, ROI_MIN, ROI_MAX, det.forecast.expectedROI),
            );
            const expectedHoldDays = round0(
              clampNum(ai.expectedHoldDays, HOLD_DAYS_MIN, HOLD_DAYS_MAX, det.forecast.expectedHoldDays),
            );
            const sellProbability30d = round0(
              clampNum(ai.sellProbability30d, PROB_MIN, PROB_MAX, det.forecast.sellProbability30d),
            );
            const riskAdjustedReturn = round0((expectedProfit * sellProbability30d) / 100);
            const profitabilityGrade = clampEnum(ai.profitabilityGrade, VALID_GRADE, det.forecast.profitabilityGrade);
            const buyRecommendation = clampEnum(ai.buyRecommendation, VALID_RECOMMENDATION, det.forecast.buyRecommendation);
            const optimalBuyPrice = round0(
              clampNum(ai.optimalBuyPrice, 0, det.askingPrice, det.forecast.optimalBuyPrice),
            );
            const sellMax = estValue > 0 ? estValue * 1.2 : det.askingPrice * 1.5;
            const sellMin = det.askingPrice * 0.8;
            const optimalSellPrice = round0(
              clampNum(ai.optimalSellPrice, sellMin, sellMax, det.forecast.optimalSellPrice),
            );

            // Drivers
            const drivers: ProfitDriver[] = [];
            if (Array.isArray(ai.keyProfitDrivers)) {
              for (const d of ai.keyProfitDrivers.slice(0, 3)) {
                if (!d || typeof d !== 'object') continue;
                drivers.push({
                  driver: clampString(d.driver, 100, det.forecast.keyProfitDrivers[0]?.driver ?? 'Profit driver'),
                  impact: clampEnum(d.impact, VALID_IMPACT, det.forecast.keyProfitDrivers[0]?.impact ?? 'POSITIVE'),
                  weight: round0(clampNum(d.weight, WEIGHT_MIN, WEIGHT_MAX, det.forecast.keyProfitDrivers[0]?.weight ?? 50)),
                  detail: clampString(d.detail, 200, det.forecast.keyProfitDrivers[0]?.detail ?? 'Profit signal.'),
                });
              }
            }
            if (drivers.length === 0) {
              for (const d of det.forecast.keyProfitDrivers) drivers.push(d);
            }

            // Risks
            const risks: ProfitRisk[] = [];
            if (Array.isArray(ai.profitRisks)) {
              for (const r of ai.profitRisks.slice(0, 3)) {
                if (!r || typeof r !== 'object') continue;
                risks.push({
                  risk: clampString(r.risk, 200, det.forecast.profitRisks[0]?.risk ?? 'Tveganje.'),
                  severity: clampEnum(r.severity, VALID_SEVERITY, det.forecast.profitRisks[0]?.severity ?? 'LOW'),
                  mitigation: clampString(r.mitigation, 200, det.forecast.profitRisks[0]?.mitigation ?? 'Standardni ukrepi.'),
                });
              }
            }
            if (risks.length === 0) {
              for (const r of det.forecast.profitRisks) risks.push(r);
            }

            // Tips
            const tips: string[] = [];
            if (Array.isArray(ai.profitOptimizationTips)) {
              for (const t of ai.profitOptimizationTips.slice(0, 4)) {
                if (typeof t === 'string' && t.trim()) {
                  tips.push(t.trim().slice(0, 200));
                }
              }
            }
            if (tips.length === 0) {
              for (const t of det.forecast.profitOptimizationTips) tips.push(t);
            }

            const confidenceLevel = round0(
              clampNum(ai.confidenceLevel, CONF_MIN, CONF_MAX, det.forecast.confidenceLevel),
            );

            forecasts[det.listingId] = {
              expectedProfit,
              expectedROI,
              expectedHoldDays,
              sellProbability30d,
              riskAdjustedReturn,
              profitabilityGrade,
              buyRecommendation,
              optimalBuyPrice,
              optimalSellPrice,
              keyProfitDrivers: drivers,
              profitRisks: risks,
              profitOptimizationTips: tips,
              confidenceLevel,
            };
          }
          if (parsed.summary?.advice) {
            summaryAdviceOverride = clampString(parsed.summary.advice, 300, '');
          }
          aiUsed = true;
        }
      } catch (err) {
        logger.warn(
          '/api/ai/deal-profitability-forecaster',
          'AI call failed — using deterministic fallback',
          err,
        );
      }

      // Fill missing forecasts with deterministic
      for (const det of detResults) {
        if (!forecasts[det.listingId]) {
          forecasts[det.listingId] = det.forecast;
        }
      }

      if (aiUsed) {
        setCachedAI(cacheKey, { forecasts, summaryAdvice: summaryAdviceOverride ?? '' });
      }
    }

    // 6) Build final results using AI forecasts (or deterministic fallback)
    const results: ListingResult[] = detResults.map((det) => ({
      ...det,
      forecast: forecasts[det.listingId] ?? det.forecast,
    }));

    // 7) Build summary
    let summary = buildSummary(results);
    if (summaryAdviceOverride && summaryAdviceOverride.trim().length > 0) {
      summary = { ...summary, advice: summaryAdviceOverride };
    }

    return apiOk({
      ok: true,
      listings: results,
      summary,
      aiUsed,
    });
  },
});

export const GET = dealProfitabilityForecasterHandler;
export const POST = dealProfitabilityForecasterHandler;

