// v7.84: AI Seller Churn Predictor — AI napove kateri PRODAJALCI
// (dobavitelji) bodo verjetno prenehali prodajati (churn) in kdaj. Pomaga
// proaktivno vzdrževati odnose z dobavitelji. "Marjan: HIGH churn risk (45d
// since last trade, avg 20d). Retention: 'Imam nove iPhone-e!' URGENT."
//
// Razlika od buyer-churn-predictor-v2 (v6.81, ki napove odhod KUPCEV) — ta
// napove odhod PRODAJALCEV (supplier side). Razlika od
// buyer-churn-prevention-strategist (ki predlaga strategije za kupce) — ta
// forecast-a churn za prodajalce z retentionActions + retentionMessage.
// Razlika od seller-reliability-scorecard (v7.80, ki ocenjuje reliability
// prodajalcev) — ta PREDICT-a future churn z daysUntilChurn in
// predictedChurnDate. Razlika od seller-performance-analytics (v7.77, ki
// meri performance) — ta gleda CHURN RISK z retention priority. Razlika od
// supplier-crm (ki je CRM za spremljanje) — ta je AI PREDICTOR churn-a z
// supplierHealthScore.
//
// GET+POST /api/ai/seller-churn-predictor
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

type ChurnRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type FrequencyTrend = 'INCREASING' | 'STABLE' | 'DECREASING';
type RetentionPriority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';

interface SellerRow {
  sellerName: string;
  totalTrades: number;
  lastTradeDate: string; // ISO
  daysSinceLastTrade: number;
  avgDaysBetweenTrades: number;
  expectedNextTradeDate: string; // ISO
  tradeFrequency: number; // trades per month
  tradeFrequencyTrend: FrequencyTrend;
  totalSpent: number; // EUR
  avgDealScore: number; // 0-100
  successRate: number; // 0-100
  churnRiskScore: number; // 0-100
  churnRiskLevel: ChurnRiskLevel;
  predictedChurnDate: string; // ISO
  daysUntilChurn: number;
  churnAssessment: string;
  retentionActions: string[];
  retentionMessage: string;
  retentionPriority: RetentionPriority;
}

interface ChurnSummary {
  totalSellers: number;
  lowRiskCount: number;
  mediumRiskCount: number;
  highRiskCount: number;
  criticalRiskCount: number;
  supplierHealthScore: number; // 0-100
  urgentRetentionCount: number;
  advice: string;
}

interface AiChurnResponse {
  sellers?: unknown;
  summary?: unknown;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HIGH_RISK_DAYS_MULTIPLIER = 2.0; // 2x avg days between trades = HIGH risk
const CRITICAL_RISK_DAYS_MULTIPLIER = 3.0; // 3x avg days between trades = CRITICAL

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

function clampInt(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const v = clampNumber(raw, min, max, fallback);
  return Math.round(v);
}

const VALID_RISK_LEVEL: readonly ChurnRiskLevel[] = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
];
const VALID_FREQ_TREND: readonly FrequencyTrend[] = [
  'INCREASING',
  'STABLE',
  'DECREASING',
];
const VALID_RETENTION_PRIORITY: readonly RetentionPriority[] = [
  'URGENT',
  'HIGH',
  'MEDIUM',
  'LOW',
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

function round0(v: number): number {
  return Math.round(v);
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function toMs(d: Date | null | undefined): number {
  if (!d) return 0;
  try {
    return new Date(d as unknown as Date | string).getTime();
  } catch {
    return 0;
  }
}

function daysBetween(aMs: number, bMs: number): number {
  if (aMs <= 0 || bMs <= 0) return 0;
  return Math.max(0, Math.round((bMs - aMs) / DAY_MS));
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function addDaysISO(fromMs: number, days: number): string {
  const target = fromMs + Math.max(0, days) * DAY_MS;
  return new Date(target).toISOString();
}

// --- Seller churn metrics -----------------------------------------------

interface SellerTradeRow {
  id: string;
  buyDate: Date | null;
  buyPrice: number;
  buyFees: number;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  status: string;
  listing: {
    dealScore: number | null;
    sellerName: string | null;
  } | null;
}

interface SellerAgg {
  sellerName: string;
  tradeDates: number[]; // sorted buy dates
  totalSpent: number;
  dealScores: number[];
  successCount: number; // count of profitable sold trades
  soldCount: number; // count of sold trades
}

function aggregateBySeller(trades: SellerTradeRow[]): Map<string, SellerAgg> {
  const map = new Map<string, SellerAgg>();
  for (const t of trades) {
    const seller = (t.listing?.sellerName || '').trim();
    if (!seller || seller.length < 2) continue;
    let a = map.get(seller);
    if (!a) {
      a = {
        sellerName: seller,
        tradeDates: [],
        totalSpent: 0,
        dealScores: [],
        successCount: 0,
        soldCount: 0,
      };
      map.set(seller, a);
    }
    const buyMs = toMs(t.buyDate);
    if (buyMs > 0) a.tradeDates.push(buyMs);
    a.totalSpent += (t.buyPrice ?? 0) + (t.buyFees ?? 0);
    if (t.listing?.dealScore != null && t.listing.dealScore > 0) {
      a.dealScores.push(t.listing.dealScore);
    }
    if (t.status === 'sold' && t.sellDate) {
      a.soldCount += 1;
      const profit =
        (t.sellPrice ?? 0) - (t.sellFees ?? 0) - (t.buyPrice ?? 0) - (t.buyFees ?? 0);
      if (profit > 0) a.successCount += 1;
    }
  }
  return map;
}

// --- Deterministic churn score ------------------------------------------

// churnRiskScore 0-100 based on:
// - daysSinceLastTrade vs avgDaysBetweenTrades (ratio)
// - tradeFrequencyTrend (DECREASING = higher risk)
// - successRate (lower success = higher risk)
function computeChurnRiskScore(
  daysSinceLastTrade: number,
  avgDaysBetweenTrades: number,
  freqTrend: FrequencyTrend,
  successRate: number,
): number {
  // Ratio component (0-60): how far past expected next trade?
  let ratioScore = 0;
  if (avgDaysBetweenTrades > 0) {
    const ratio = daysSinceLastTrade / avgDaysBetweenTrades;
    if (ratio >= CRITICAL_RISK_DAYS_MULTIPLIER) {
      // >3x overdue → max 60
      ratioScore = 60;
    } else if (ratio >= HIGH_RISK_DAYS_MULTIPLIER) {
      // 2-3x overdue → 40-60
      ratioScore = 40 + ((ratio - HIGH_RISK_DAYS_MULTIPLIER) / (CRITICAL_RISK_DAYS_MULTIPLIER - HIGH_RISK_DAYS_MULTIPLIER)) * 20;
    } else if (ratio >= 1.0) {
      // 1-2x overdue → 20-40
      ratioScore = 20 + ((ratio - 1.0) / (HIGH_RISK_DAYS_MULTIPLIER - 1.0)) * 20;
    } else {
      // <1x → 0-20 (not yet overdue)
      ratioScore = (ratio / 1.0) * 20;
    }
  } else {
    // No history of avg between trades — if daysSince > 60, assume high
    ratioScore = daysSinceLastTrade > 60 ? 50 : 20;
  }

  // Trend component (0-20): DECREASING freq = higher risk
  let trendScore = 0;
  if (freqTrend === 'DECREASING') trendScore = 20;
  else if (freqTrend === 'STABLE') trendScore = 10;

  // Success rate component (0-20): lower success = higher risk
  let successScore = 0;
  if (successRate < 30) successScore = 20;
  else if (successRate < 60) successScore = 10;
  else if (successRate < 80) successScore = 5;

  const total = ratioScore + trendScore + successScore;
  return round0(Math.max(0, Math.min(100, total)));
}

function riskLevelFromScore(score: number): ChurnRiskLevel {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 35) return 'MEDIUM';
  return 'LOW';
}

function priorityFromScore(score: number): RetentionPriority {
  if (score >= 80) return 'URGENT';
  if (score >= 60) return 'HIGH';
  if (score >= 35) return 'MEDIUM';
  return 'LOW';
}

function freqTrendFromTrades(
  tradeDates: number[],
): FrequencyTrend {
  if (tradeDates.length < 3) return 'STABLE';
  // Split into first half and second half, compute avg days between
  const sorted = [...tradeDates].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, mid + 1);
  const secondHalf = sorted.slice(mid);
  const firstGaps: number[] = [];
  for (let i = 1; i < firstHalf.length; i++) {
    firstGaps.push(daysBetween(firstHalf[i - 1]!, firstHalf[i]!));
  }
  const secondGaps: number[] = [];
  for (let i = 1; i < secondHalf.length; i++) {
    secondGaps.push(daysBetween(secondHalf[i - 1]!, secondHalf[i]!));
  }
  if (firstGaps.length === 0 || secondGaps.length === 0) return 'STABLE';
  const firstAvg = avg(firstGaps);
  const secondAvg = avg(secondGaps);
  if (firstAvg <= 0) return 'STABLE';
  // Decreasing frequency = increasing gaps
  const ratioChange = (secondAvg - firstAvg) / firstAvg;
  if (ratioChange > 0.25) return 'DECREASING';
  if (ratioChange < -0.25) return 'INCREASING';
  return 'STABLE';
}

// --- Deterministic seller churn row -------------------------------------

function buildDeterministicSellerRow(
  agg: SellerAgg,
  now: number,
): SellerRow | null {
  if (agg.tradeDates.length === 0) return null;
  const sortedDates = [...agg.tradeDates].sort((a, b) => a - b);
  const lastTradeMs = sortedDates[sortedDates.length - 1]!;
  const firstTradeMs = sortedDates[0]!;
  const daysSinceLastTrade = daysBetween(lastTradeMs, now);

  // avgDaysBetweenTrades: avg gap between consecutive trades
  let avgDaysBetweenTrades = 0;
  if (sortedDates.length >= 2) {
    const totalSpan = daysBetween(firstTradeMs, lastTradeMs);
    avgDaysBetweenTrades = sortedDates.length > 1
      ? totalSpan / (sortedDates.length - 1)
      : 0;
  }

  // expectedNextTradeDate = lastTrade + avgDaysBetweenTrades
  const expectedNextTradeDate =
    avgDaysBetweenTrades > 0
      ? addDaysISO(lastTradeMs, round0(avgDaysBetweenTrades))
      : addDaysISO(lastTradeMs, 30); // default 30d if no history

  // tradeFrequency: trades per month
  const totalDays = daysBetween(firstTradeMs, now);
  const tradeFrequency =
    totalDays > 0 ? round1((agg.tradeDates.length / totalDays) * 30) : 0;

  const tradeFrequencyTrend = freqTrendFromTrades(sortedDates);

  const totalSpent = round0(agg.totalSpent);
  const avgDealScore =
    agg.dealScores.length > 0 ? round1(avg(agg.dealScores)) : 0;
  const successRate =
    agg.soldCount > 0 ? round1((agg.successCount / agg.soldCount) * 100) : 0;

  const churnRiskScore = computeChurnRiskScore(
    daysSinceLastTrade,
    avgDaysBetweenTrades,
    tradeFrequencyTrend,
    successRate,
  );
  const churnRiskLevel = riskLevelFromScore(churnRiskScore);
  const retentionPriority = priorityFromScore(churnRiskScore);

  // predictedChurnDate = expectedNextTradeDate + grace period (avgDaysBetweenTrades)
  // If already past expectedNextTradeDate, predicted churn is near
  const graceDays =
    avgDaysBetweenTrades > 0 ? round0(avgDaysBetweenTrades) : 30;
  const predictedChurnMs =
    toMs(new Date(expectedNextTradeDate)) > 0
      ? toMs(new Date(expectedNextTradeDate)) + graceDays * DAY_MS
      : now + graceDays * DAY_MS;
  const predictedChurnDate = new Date(predictedChurnMs).toISOString();
  const daysUntilChurn = Math.max(0, daysBetween(now, predictedChurnMs));

  // Deterministic churn assessment
  const churnAssessment = buildDeterministicChurnAssessment(
    agg.sellerName,
    daysSinceLastTrade,
    avgDaysBetweenTrades,
    tradeFrequencyTrend,
    successRate,
    churnRiskLevel,
  );

  // Deterministic retention actions
  const retentionActions = buildDeterministicRetentionActions(
    churnRiskLevel,
    tradeFrequencyTrend,
    successRate,
  );

  // Deterministic retention message
  const retentionMessage = buildDeterministicRetentionMessage(
    agg.sellerName,
    churnRiskLevel,
    avgDealScore,
    totalSpent,
  );

  return {
    sellerName: agg.sellerName,
    totalTrades: agg.tradeDates.length,
    lastTradeDate: new Date(lastTradeMs).toISOString(),
    daysSinceLastTrade,
    avgDaysBetweenTrades: round1(avgDaysBetweenTrades),
    expectedNextTradeDate,
    tradeFrequency,
    tradeFrequencyTrend,
    totalSpent,
    avgDealScore,
    successRate,
    churnRiskScore,
    churnRiskLevel,
    predictedChurnDate,
    daysUntilChurn,
    churnAssessment,
    retentionActions,
    retentionMessage,
    retentionPriority,
  };
}

function buildDeterministicChurnAssessment(
  sellerName: string,
  daysSinceLastTrade: number,
  avgDaysBetweenTrades: number,
  freqTrend: FrequencyTrend,
  successRate: number,
  riskLevel: ChurnRiskLevel,
): string {
  const trendText =
    freqTrend === 'DECREASING'
      ? 'Upadanje frekvence trgovin'
      : freqTrend === 'INCREASING'
      ? 'Rast frekvence trgovin'
      : 'Stabilna frekvenca';
  const ratio =
    avgDaysBetweenTrades > 0
      ? (daysSinceLastTrade / avgDaysBetweenTrades).toFixed(1)
      : 'N/A';
  if (riskLevel === 'CRITICAL') {
    return `${sellerName}: KRITIČNO tveganje odhoda. ${daysSinceLastTrade}d od zadnje trgovine (avg ${round1(avgDaysBetweenTrades)}d, ${ratio}x overdue). ${trendText}. Success rate ${successRate}%. Dejansko neaktivno — nujna intervencija.`;
  }
  if (riskLevel === 'HIGH') {
    return `${sellerName}: VISOKO tveganje odhoda. ${daysSinceLastTrade}d od zadnje trgovine (avg ${round1(avgDaysBetweenTrades)}d, ${ratio}x overdue). ${trendText}. Success rate ${successRate}%. Proaktivni kontakt nujen.`;
  }
  if (riskLevel === 'MEDIUM') {
    return `${sellerName}: SREDNJE tveganje odhoda. ${daysSinceLastTrade}d od zadnje trgovine (avg ${round1(avgDaysBetweenTrades)}d, ${ratio}x). ${trendText}. Success rate ${successRate}%. Spremljaj in kontaktiraj preventivno.`;
  }
  return `${sellerName}: NIZKO tveganje odhoda. ${daysSinceLastTrade}d od zadnje trgovine (avg ${round1(avgDaysBetweenTrades)}d, ${ratio}x). ${trendText}. Success rate ${successRate}%. Aktiven in zanesljiv dobavitelj.`;
}

function buildDeterministicRetentionActions(
  riskLevel: ChurnRiskLevel,
  freqTrend: FrequencyTrend,
  successRate: number,
): string[] {
  const actions: string[] = [];
  if (riskLevel === 'CRITICAL' || riskLevel === 'HIGH') {
    actions.push(
      'Takojšen osebni kontakt (klic/SMS) — ponudi novo priložnost za sodelovanje',
    );
    actions.push(
      'Pošlji povzetek zadnjih uspešnih trgovin — pokaži vrednost sodelovanja',
    );
  } else if (riskLevel === 'MEDIUM') {
    actions.push(
      'Preventivni kontakt v 7 dneh — povprašaj o morebitnih novih artikelih',
    );
  } else {
    actions.push(
      'Vzdržuj redni kontakt (monthly check-in) — ohranjaj odnos',
    );
  }
  if (freqTrend === 'DECREASING') {
    actions.push(
      'Identificiraj vzrok za upadanje — morda potrebuje boljše pogoje ali hitrejše plačilo',
    );
  }
  if (successRate < 60) {
    actions.push(
      'Ponudi boljše pogoje (višje nabavne cene) za ohranitev dobavitelja',
    );
  }
  return actions.slice(0, 4);
}

function buildDeterministicRetentionMessage(
  sellerName: string,
  riskLevel: ChurnRiskLevel,
  avgDealScore: number,
  totalSpent: number,
): string {
  if (riskLevel === 'CRITICAL' || riskLevel === 'HIGH') {
    return `Pozdravljen ${sellerName}, opazil sem, da že dalj časa nismo poslovali. Zanimalo bi me, če imaš trenutno kakšne nove article na voljo — še posebej iščem kvalitetne item-e (do sedaj smo skupaj poslovali za ${totalSpent}€). Z veseljem bi nadaljevali sodelovanje — kaj imaš trenutno na zalogi?`;
  }
  if (riskLevel === 'MEDIUM') {
    return `Živjo ${sellerName}, samo naključno se javljam — zanimalo me je, če morda kaj novega pripravljaš. Do sedaj smo vedno našli dobre dogovore. Sporoči, če imaš kaj zanimivega!`;
  }
  return `Živjo ${sellerName}, hvala za dosedanje sodelovanje! Sporoči, če pride kaj novega na voljo — kot vedno z veseljem slišim za nove priložnosti.`;
}

// --- Supplier health score ---------------------------------------------

function computeSupplierHealthScore(
  sellers: SellerRow[],
): number {
  if (sellers.length === 0) return 0;
  // Inverse of avg churn risk: 100 - avg(riskScore)
  const avgRisk = avg(sellers.map((s) => s.churnRiskScore));
  return round0(Math.max(0, Math.min(100, 100 - avgRisk)));
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleSellerChurnPredictor(req);
}
export async function POST(req: NextRequest) {
  return handleSellerChurnPredictor(req);
}

async function handleSellerChurnPredictor(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-seller-churn-predictor', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();

    // 1) Query all trades with linked Listing (for sellerName, dealScore)
    const trades = await db.trade.findMany({
      where: {
        listing: { sellerName: { not: null } },
      },
      select: {
        id: true,
        buyDate: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        status: true,
        listing: {
          select: {
            dealScore: true,
            sellerName: true,
          },
        },
      },
      orderBy: { buyDate: 'asc' },
      take: 100000,
    });

    // 2) Aggregate by seller
    const sellerAggs = aggregateBySeller(trades as SellerTradeRow[]);

    // Filter to sellers with 2+ trades
    const eligibleSellers = Array.from(sellerAggs.values()).filter(
      (a) => a.tradeDates.length >= 2,
    );

    const emptyResponse = {
      ok: true,
      sellers: [] as SellerRow[],
      summary: {
        totalSellers: 0,
        lowRiskCount: 0,
        mediumRiskCount: 0,
        highRiskCount: 0,
        criticalRiskCount: 0,
        supplierHealthScore: 0,
        urgentRetentionCount: 0,
        advice:
          'Ni prodajalcev z 2+ trgovinami — Seller Churn Predictor ni mogoč.',
      },
      aiUsed: false,
      message:
        'Ni prodajalcev z 2+ trgovinami — Seller Churn Predictor ni mogoč.',
    };

    if (eligibleSellers.length === 0) {
      return NextResponse.json(emptyResponse);
    }

    // 3) Build deterministic seller rows (sorted by churnRiskScore desc)
    let sellers: SellerRow[] = [];
    for (const agg of eligibleSellers) {
      const row = buildDeterministicSellerRow(agg, now);
      if (row) sellers.push(row);
    }
    sellers.sort((a, b) => b.churnRiskScore - a.churnRiskScore);

    // Limit to top 50 sellers for AI processing (avoid huge prompts)
    const topSellers = sellers.slice(0, 50);

    // 4) Deterministic summary
    const lowRiskCount = sellers.filter((s) => s.churnRiskLevel === 'LOW').length;
    const mediumRiskCount = sellers.filter((s) => s.churnRiskLevel === 'MEDIUM').length;
    const highRiskCount = sellers.filter((s) => s.churnRiskLevel === 'HIGH').length;
    const criticalRiskCount = sellers.filter((s) => s.churnRiskLevel === 'CRITICAL').length;
    const urgentRetentionCount = sellers.filter(
      (s) => s.retentionPriority === 'URGENT',
    ).length;
    const supplierHealthScore = computeSupplierHealthScore(sellers);

    const deterministicAdvice =
      sellers.length === 0
        ? 'Ni prodajalcev za analizo.'
        : `${sellers.length} prodajalcev analiziranih. Supplier health: ${supplierHealthScore}/100. ${urgentRetentionCount} URGENT (${
            highRiskCount + criticalRiskCount
          } visok tveganj). ${
            criticalRiskCount > 0
              ? `${criticalRiskCount} kriznih prodajalcev — takojšen kontakt!`
              : urgentRetentionCount > 0
              ? 'Proaktivni kontakt nujen za HIGH risk prodajalce.'
              : 'Dobavitelji stabilni — vzdržuj redne kontakte.'
          }`;

    const deterministicSummary: ChurnSummary = {
      totalSellers: sellers.length,
      lowRiskCount,
      mediumRiskCount,
      highRiskCount,
      criticalRiskCount,
      supplierHealthScore,
      urgentRetentionCount,
      advice: deterministicAdvice,
    };

    // 5) AI cache check (6h TTL) — key by total sellers count
    const cacheKey = `seller-churn-predictor:${sellers.length}`;
    const cached = getCachedAI<{
      sellers: SellerRow[];
      summary: ChurnSummary;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        sellers: cached.sellers,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 6) AI prompt with grounding
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

    const sellersForPrompt = topSellers.map((s) => ({
      sellerName: s.sellerName,
      totalTrades: s.totalTrades,
      lastTradeDate: s.lastTradeDate,
      daysSinceLastTrade: s.daysSinceLastTrade,
      avgDaysBetweenTrades: s.avgDaysBetweenTrades,
      expectedNextTradeDate: s.expectedNextTradeDate,
      tradeFrequency: s.tradeFrequency,
      tradeFrequencyTrend: s.tradeFrequencyTrend,
      totalSpent: s.totalSpent,
      avgDealScore: s.avgDealScore,
      successRate: s.successRate,
      deterministicChurnRiskScore: s.churnRiskScore,
      deterministicChurnRiskLevel: s.churnRiskLevel,
      deterministicRetentionPriority: s.retentionPriority,
    }));

    const prompt = `Si AI "Seller Churn Predictor" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Napoveš kateri PRODAJALCI (dobavitelji) bodo verjetno prenehali prodajati (churn) in kdaj. Predlagaš retention akcije in personalizirana outreach sporočila.

PRODAJALCI (deterministično izračunano):
${JSON.stringify(sellersForPrompt, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. sellers: array per seller z:
   - sellerName: enako kot v promptu (max 100 znakov)
   - churnRiskScore: 0-100 (lahko prilagodiš znotraj [-10, +10] od deterministične vrednosti — anti-hallucination)
   - churnRiskLevel: LOW (<35) | MEDIUM (35-59) | HIGH (60-79) | CRITICAL (80+). Vedno izračunaj iz score.
   - churnAssessment: slovenski opis tveganja (max 350 znakov). NE izmišljuj podatkov.
   - retentionActions: 2-4 slovenske konkretne akcije (max 200 znakov na akcijo)
   - retentionMessage: slovensko personalizirano sporočilo za prodajalca (max 400 znakov)
   - retentionPriority: URGENT (≥80) | HIGH (60-79) | MEDIUM (35-59) | LOW (<35). Vedno izračunaj iz score.
   - predictedChurnDate: ISO date v prihodnosti (po expectedNextTradeDate + grace period)
   - daysUntilChurn: število dni do predicted churn (max 365)
2. summary: {
   - supplierHealthScore: 0-100 (lahko prilagodiš znotraj [-5, +5] od deterministične vrednosti)
   - advice: slovenski povzetek (max 400 znakov)
}
3. NE pozabi sellerName, totalTrades, lastTradeDate, daysSinceLastTrade, avgDaysBetweenTrades, expectedNextTradeDate, tradeFrequency, tradeFrequencyTrend, totalSpent, avgDealScore, successRate ostanejo nespremenjeni (iz determinističnih podatkov).

VRNI LE JSON:
{
  "sellers": [
    {
      "sellerName": "Marjan",
      "churnRiskScore": 75,
      "churnRiskLevel": "HIGH",
      "churnAssessment": "Marjan: VISOKO tveganje odhoda. 45d od zadnje trgovine (avg 20d, 2.3x overdue). Upadanje frekvence. Success rate 65%. Proaktivni kontakt nujen.",
      "retentionActions": ["Takojšen osebni kontakt (klic/SMS)", "Pošlji povzetek zadnjih uspešnih trgovin"],
      "retentionMessage": "Pozdravljen Marjan, opazil sem, da že dalj časa nismo poslovali. Zanimalo bi me, če imaš trenutno kakšne nove iPhone-e ali elektroniko na voljo. Z veseljem bi nadaljevali sodelovanje!",
      "retentionPriority": "HIGH",
      "predictedChurnDate": "2026-09-15T00:00:00.000Z",
      "daysUntilChurn": 25
    }
  ],
  "summary": {
    "supplierHealthScore": 62,
    "advice": "12 prodajalcev. Supplier health: 62/100. 3 URGENT (HIGH+CRITICAL). Takojšen kontakt za Marjan, Ana, Peter."
  }
}${GROUNDING_PROMPT_SUFFIX}`;

    let finalSummary = deterministicSummary;
    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiChurnResponse | null;

      if (parsed && typeof parsed === 'object') {
        // AI may override per-seller fields
        if (parsed.sellers && Array.isArray(parsed.sellers)) {
          const aiSellers = parsed.sellers as Array<Record<string, unknown>>;
          for (const ai of aiSellers) {
            const sellerName = clampString(ai.sellerName, 100, '');
            if (!sellerName) continue;
            const match = sellers.find((s) => s.sellerName === sellerName);
            if (!match) continue;

            const detScore = match.churnRiskScore;
            const aiScore = clampNumber(ai.churnRiskScore, 0, 100, detScore);
            // Anti-hallucination: AI can adjust by max ±10
            const clampedScore = Math.max(
              0,
              Math.min(
                100,
                Math.round(
                  detScore + Math.max(-10, Math.min(10, aiScore - detScore)),
                ),
              ),
            );
            match.churnRiskScore = clampedScore;
            // Risk level ALWAYS recomputed from clamped score
            match.churnRiskLevel = clampEnum(
              ai.churnRiskLevel,
              VALID_RISK_LEVEL,
              riskLevelFromScore(clampedScore),
            );
            match.retentionPriority = clampEnum(
              ai.retentionPriority,
              VALID_RETENTION_PRIORITY,
              priorityFromScore(clampedScore),
            );

            const churnAssessment = clampString(
              ai.churnAssessment,
              350,
              '',
            );
            if (churnAssessment) match.churnAssessment = churnAssessment;

            if (Array.isArray(ai.retentionActions)) {
              const aiActions = (ai.retentionActions as unknown[])
                .map((a) => clampString(a, 200, ''))
                .filter((a) => a.length > 0)
                .slice(0, 4);
              if (aiActions.length > 0) match.retentionActions = aiActions;
            }

            const retentionMessage = clampString(
              ai.retentionMessage,
              400,
              '',
            );
            if (retentionMessage) match.retentionMessage = retentionMessage;

            // Predicted churn date validation
            if (
              typeof ai.predictedChurnDate === 'string' &&
              ai.predictedChurnDate.trim()
            ) {
              const churnMs = toMs(new Date(ai.predictedChurnDate));
              if (churnMs > now) {
                match.predictedChurnDate = ai.predictedChurnDate.slice(0, 30);
                match.daysUntilChurn = Math.min(
                  365,
                  Math.max(0, daysBetween(now, churnMs)),
                );
              }
            }
          }
          // Re-sort sellers by clamped score desc
          sellers.sort((a, b) => b.churnRiskScore - a.churnRiskScore);
        }

        // Summary override
        if (parsed.summary && typeof parsed.summary === 'object') {
          const s = parsed.summary as Record<string, unknown>;
          // Recompute counts from clamped sellers
          const low = sellers.filter((s) => s.churnRiskLevel === 'LOW').length;
          const med = sellers.filter((s) => s.churnRiskLevel === 'MEDIUM').length;
          const high = sellers.filter((s) => s.churnRiskLevel === 'HIGH').length;
          const crit = sellers.filter((s) => s.churnRiskLevel === 'CRITICAL').length;
          const urgent = sellers.filter(
            (s) => s.retentionPriority === 'URGENT',
          ).length;
          // Supplier health score: AI can adjust ±5
          const detHealth = computeSupplierHealthScore(sellers);
          const aiHealth = clampNumber(s.supplierHealthScore, 0, 100, detHealth);
          const clampedHealth = Math.max(
            0,
            Math.min(
              100,
              Math.round(
                detHealth + Math.max(-5, Math.min(5, aiHealth - detHealth)),
              ),
            ),
          );

          const advice = clampString(
            s.advice,
            400,
            deterministicAdvice,
          );

          finalSummary = {
            totalSellers: sellers.length,
            lowRiskCount: low,
            mediumRiskCount: med,
            highRiskCount: high,
            criticalRiskCount: crit,
            supplierHealthScore: clampedHealth,
            urgentRetentionCount: urgent,
            advice,
          };
        }

        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/seller-churn-predictor',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        sellers,
        summary: finalSummary,
      });
    }

    return NextResponse.json({
      ok: true,
      sellers,
      summary: finalSummary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error('/api/ai/seller-churn-predictor', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
