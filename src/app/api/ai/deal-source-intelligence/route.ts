// v7.82: AI Deal Source Intelligence — AI generira celovit INTELLIGENCE
// report za vsak deal source (Bolha, Vinted, Facebook, mobile.de) — kombinira
// ROI, risk, reliability, opportunity in trend v eno intelligence scorecard
// per source. "Bolha: A grade (88/100, HIGH strategic value). Strengths: high
// ROI, fast turnover. Increase focus."
//
// Razlika od deal-source-roi (v7.58, ki gleda ROI per source) — ta generira
// COMPOSITE intelligence scorecard (overall 0-100 + grade A+ do F) z
// strengths/weaknesses/strategicValue/recommendedAction per source +
// cross-source opportunities + risk assessment.
// Razlika od deal-source-comparison-matrix (v7.70, ki primerja source ×
// category) — ta gleda STRATEGIC intelligence per source z recommended
// action (INCREASE_FOCUS/MAINTAIN/REDUCE/EXIT) + crossSourceOpportunities.
// Razlika od source-quality (ki ocenjuje monitore po listing quality) — ta
// gleda celovit INTELLIGENCE (ROI + reliability + opportunity + trend) z
// composite score + grade.
//
// GET+POST /api/ai/deal-source-intelligence
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

type Grade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
type StrategicValue = 'HIGH' | 'MEDIUM' | 'LOW';
type RecommendedAction =
  | 'INCREASE_FOCUS'
  | 'MAINTAIN'
  | 'REDUCE'
  | 'EXIT';
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

interface SourceMetrics {
  totalTrades: number;
  totalProfit: number;
  avgROI: number;
  winRate: number;
  avgDealScore: number;
  avgRiskScore: number;
  avgHoldDays: number;
  reliabilityScore: number; // 0-100
  opportunityScore: number; // 0-100
  trendScore: number; // 0-100
}

interface SourceScorecard {
  overallIntelligenceScore: number; // 0-100
  intelligenceGrade: Grade;
  strengths: string[];
  weaknesses: string[];
  strategicValue: StrategicValue;
  recommendedAction: RecommendedAction;
}

interface SourceIntelligence {
  source: string;
  displayName: string;
  metrics: SourceMetrics;
  scorecard: SourceScorecard;
}

interface RankingEntry {
  source: string;
  rank: number;
  score: number;
}

interface CrossSourceOpportunity {
  opportunity: string;
  sources: string[];
  expectedProfit: number;
}

interface RiskAssessment {
  source: string;
  riskLevel: RiskLevel;
  riskFactors: string[];
}

interface AiIntelligenceResponse {
  scorecards?: unknown;
  crossSourceOpportunities?: unknown;
  riskAssessment?: unknown;
  summary?: unknown;
}

// --- Source display name mapping (same as deal-source-roi) ---------------

const SOURCE_DISPLAY: Record<string, string> = {
  bolha: 'Bolha',
  vinted: 'Vinted',
  facebook: 'Facebook',
  avtonet: 'Avtonet',
  mobilede: 'mobile.de',
  'mobile-de': 'mobile.de',
  kleinanzeigen: 'Kleinanzeigen',
  subito: 'Subito',
  willhaben: 'Willhaben',
  nepremicnine: 'Nepremičnine',
  salomon: 'Salomon',
  'custom-rss': 'Custom RSS',
  unknown: 'Unknown',
};

function displayName(source: string): string {
  return (
    SOURCE_DISPLAY[source] ??
    (source.charAt(0).toUpperCase() + source.slice(1))
  );
}

// Normalize monitor.source / buyLocation / category to a known source key.
function normalizeSource(raw: string | null | undefined): string {
  if (!raw) return 'unknown';
  const s = raw.trim().toLowerCase();
  if (!s) return 'unknown';
  if (s.includes('bolha')) return 'bolha';
  if (s.includes('vinted')) return 'vinted';
  if (s.includes('face') || s === 'fb' || s.includes('marketplace'))
    return 'facebook';
  if (s.includes('avtonet')) return 'avtonet';
  if (s.includes('mobile.de') || s.includes('mobilede') || s === 'mobile-de')
    return 'mobilede';
  if (s.includes('kleinan')) return 'kleinanzeigen';
  if (s.includes('subito')) return 'subito';
  if (s.includes('willhaben')) return 'willhaben';
  if (s.includes('nepremicn')) return 'nepremicnine';
  if (s.includes('salomon')) return 'salomon';
  if (s.includes('custom-rss') || s.includes('rss')) return 'custom-rss';
  return 'unknown';
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

const VALID_ACTION: readonly RecommendedAction[] = [
  'INCREASE_FOCUS',
  'MAINTAIN',
  'REDUCE',
  'EXIT',
];
const VALID_RISK: readonly RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'];

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
function round0(v: number): number {
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

function daysBetween(aMs: number, bMs: number): number {
  if (aMs <= 0 || bMs <= 0) return 0;
  return Math.max(0, Math.round((bMs - aMs) / 86_400_000));
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = avg(values);
  const variance =
    values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function monthKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

// Convert numeric score 0-100 to letter grade (A+ ≥ 90, A 80-89, B 70-79,
// C 55-69, D 40-54, F < 40)
function gradeFromScore(score: number): Grade {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function strategicFromScore(score: number): StrategicValue {
  if (score >= 70) return 'HIGH';
  if (score >= 45) return 'MEDIUM';
  return 'LOW';
}

function actionFromScore(
  score: number,
  winRate: number,
): RecommendedAction {
  if (score >= 75 && winRate >= 60) return 'INCREASE_FOCUS';
  if (score >= 50) return 'MAINTAIN';
  if (score >= 30) return 'REDUCE';
  return 'EXIT';
}

function riskLevelFromMetrics(
  avgRiskScore: number,
  winRate: number,
): RiskLevel {
  // avgRiskScore is 0-100 (normalized 1-10 aiRisk × 10).
  // Higher risk + lower win rate = higher risk level.
  if (avgRiskScore >= 60 || winRate < 40) return 'HIGH';
  if (avgRiskScore >= 40 || winRate < 60) return 'MEDIUM';
  return 'LOW';
}

// --- Source aggregation -------------------------------------------------

interface TradeRow {
  buyPrice: number | null;
  buyFees: number | null;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  category: string;
  buyLocation: string;
  listing: {
    dealScore: number | null;
    aiRisk: number | null;
    monitor: { source: string } | null;
  } | null;
}

interface SourceAgg {
  source: string;
  trades: Array<{
    profit: number;
    revenue: number;
    cost: number;
    win: boolean;
    dealScore: number | null;
    aiRisk: number | null;
    holdDays: number;
    sellMs: number;
  }>;
}

function aggregateBySource(soldTrades: TradeRow[]): SourceAgg[] {
  const map = new Map<string, SourceAgg>();

  for (const t of soldTrades) {
    const sellMs = toMs(t.sellDate);
    if (sellMs <= 0) continue;

    // Source: prefer monitor.source, fall back to buyLocation, then category
    const monitorSource = t.listing?.monitor?.source ?? null;
    const source = normalizeSource(monitorSource || t.buyLocation);

    const buyPrice = t.buyPrice ?? 0;
    const buyFees = t.buyFees ?? 0;
    const sellPrice = t.sellPrice ?? 0;
    const sellFees = t.sellFees ?? 0;
    const profit = sellPrice - sellFees - buyPrice - buyFees;
    const revenue = sellPrice;
    const cost = buyPrice + buyFees;
    const win = profit > 0;

    const dealScore = t.listing?.dealScore ?? null;
    const aiRisk = t.listing?.aiRisk ?? null;

    const buyMs = toMs(t.buyDate);
    const holdDays =
      buyMs > 0 && sellMs > 0 ? daysBetween(buyMs, sellMs) : 0;

    let a = map.get(source);
    if (!a) {
      a = { source, trades: [] };
      map.set(source, a);
    }
    a.trades.push({
      profit,
      revenue,
      cost,
      win,
      dealScore,
      aiRisk,
      holdDays,
      sellMs,
    });
  }

  return Array.from(map.values());
}

// --- Per-source metrics --------------------------------------------------

interface ComputedMetrics {
  totalTrades: number;
  totalProfit: number;
  avgROI: number;
  winRate: number;
  avgDealScore: number;
  avgRiskScore: number;
  avgHoldDays: number;
  reliabilityScore: number;
  opportunityScore: number;
  trendScore: number;
  // Internal helpers (not in response)
  recentProfit: number;
  priorProfit: number;
  recentCount: number;
  priorCount: number;
}

function computeSourceMetrics(agg: SourceAgg, now: number): ComputedMetrics {
  const trades = agg.trades;
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      totalTrades: 0,
      totalProfit: 0,
      avgROI: 0,
      winRate: 0,
      avgDealScore: 0,
      avgRiskScore: 0,
      avgHoldDays: 0,
      reliabilityScore: 0,
      opportunityScore: 0,
      trendScore: 0,
      recentProfit: 0,
      priorProfit: 0,
      recentCount: 0,
      priorCount: 0,
    };
  }

  const totalProfit = round0(trades.reduce((s, t) => s + t.profit, 0));
  const totalCost = trades.reduce((s, t) => s + t.cost, 0);
  const avgROI =
    totalCost > 0 ? round1((totalProfit / totalCost) * 100) : 0;

  const wins = trades.filter((t) => t.win).length;
  const winRate = round1((wins / totalTrades) * 100);

  const dealScores = trades
    .map((t) => t.dealScore)
    .filter((d): d is number => d != null && d > 0);
  const avgDealScore =
    dealScores.length > 0 ? round1(avg(dealScores)) : 0;

  const aiRisks = trades
    .map((t) => t.aiRisk)
    .filter((r): r is number => r != null && r > 0);
  // aiRisk is 1-10. Normalize to 0-100 by × 10 (higher = more risk).
  const avgRiskScore =
    aiRisks.length > 0 ? round1(avg(aiRisks) * 10) : 0;

  const holdDaysValues = trades.map((t) => t.holdDays);
  const avgHoldDays = round1(avg(holdDaysValues));

  // Reliability score: based on win rate consistency + low profit volatility.
  // reliability = winRate (0-100) weighted 60% + profit stability 40%.
  // profit stability = 100 - normalized stddev of trade profits.
  const profits = trades.map((t) => t.profit);
  const profitStd = stdDev(profits);
  const profitMean = avg(profits);
  // CV (coefficient of variation) — high CV = unstable.
  const cv = profitMean !== 0 ? profitStd / Math.abs(profitMean) : profitStd;
  // Clamp CV to 0-3 (3 = very unstable).
  const clampedCv = Math.min(3, Math.max(0, cv));
  const profitStability = round0(100 - (clampedCv / 3) * 100);
  const reliabilityScore = round0(
    Math.max(0, Math.min(100, winRate * 0.6 + profitStability * 0.4)),
  );

  // Opportunity score: based on deal volume + profit potential.
  // volume component: scale totalTrades (max ~20 trades = full score).
  const volumeComponent = Math.min(100, (totalTrades / 20) * 100);
  // profit potential: avg profit per trade, normalized (50€ avg = 50 pts,
  // 100€ = 100 pts).
  const avgProfitPerTrade = totalProfit / totalTrades;
  const profitPotential = Math.min(
    100,
    Math.max(0, (avgProfitPerTrade / 100) * 100),
  );
  // deal quality (avgDealScore 0-100 directly).
  const dealQuality = avgDealScore;
  const opportunityScore = round0(
    Math.max(
      0,
      Math.min(
        100,
        volumeComponent * 0.3 + profitPotential * 0.4 + dealQuality * 0.3,
      ),
    ),
  );

  // Trend score: is this source improving or declining?
  // Compare recent 6 months vs prior 6 months (within this source).
  const cutoff6m = now - 6 * 30 * 86_400_000;
  const cutoff12m = now - 12 * 30 * 86_400_000;
  let recentProfit = 0;
  let priorProfit = 0;
  let recentCount = 0;
  let priorCount = 0;
  for (const t of trades) {
    if (t.sellMs >= cutoff6m) {
      recentProfit += t.profit;
      recentCount += 1;
    } else if (t.sellMs >= cutoff12m) {
      priorProfit += t.profit;
      priorCount += 1;
    }
  }
  recentProfit = round0(recentProfit);
  priorProfit = round0(priorProfit);

  let trendScore = 50; // neutral
  if (priorProfit > 0 && recentProfit > 0) {
    const trendPct =
      ((recentProfit - priorProfit) / Math.abs(priorProfit)) * 100;
    // 50 + trendPct/2, clamped 0-100.
    trendScore = round0(
      Math.max(0, Math.min(100, 50 + trendPct / 2)),
    );
  } else if (recentProfit > 0 && priorProfit <= 0) {
    trendScore = 80; // source emerged / growing
  } else if (recentProfit <= 0 && priorProfit > 0) {
    trendScore = 20; // source declining / dead
  }

  return {
    totalTrades,
    totalProfit,
    avgROI,
    winRate,
    avgDealScore,
    avgRiskScore,
    avgHoldDays,
    reliabilityScore,
    opportunityScore,
    trendScore,
    recentProfit,
    priorProfit,
    recentCount,
    priorCount,
  };
}

// --- Deterministic intelligence scorecard ------------------------------

function computeIntelligenceScore(m: ComputedMetrics): number {
  // Weighted composite (0-100):
  // - reliabilityScore: 25% (consistency = trust)
  // - opportunityScore: 25% (deal volume + profit potential)
  // - avgROI normalized: 25% (financial performance)
  // - winRate: 15% (success rate)
  // - trendScore: 10% (is source improving?)
  // Cap ROI contribution: ROI > 100% = full score.
  const roiNormalized = Math.min(100, Math.max(0, m.avgROI));
  const score =
    m.reliabilityScore * 0.25 +
    m.opportunityScore * 0.25 +
    roiNormalized * 0.25 +
    m.winRate * 0.15 +
    m.trendScore * 0.1;
  return round0(Math.max(0, Math.min(100, score)));
}

function buildDeterministicScorecard(m: ComputedMetrics): SourceScorecard {
  const overall = computeIntelligenceScore(m);
  const grade = gradeFromScore(overall);
  const strategicValue = strategicFromScore(overall);
  const recommendedAction = actionFromScore(overall, m.winRate);

  // Build strengths/weaknesses deterministically from metrics
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (m.avgROI >= 30) strengths.push(`Visok ROI (${m.avgROI}%)`);
  else if (m.avgROI >= 15) strengths.push(`Soliden ROI (${m.avgROI}%)`);
  if (m.winRate >= 70) strengths.push(`Visoka win rate (${m.winRate}%)`);
  if (m.avgHoldDays > 0 && m.avgHoldDays <= 14)
    strengths.push(`Hiter turnover (${m.avgHoldDays} dni)`);
  if (m.reliabilityScore >= 70)
    strengths.push(`Visoka zanesljivost (${m.reliabilityScore}/100)`);
  if (m.trendScore >= 65)
    strengths.push(`Rastoči trend (${m.trendScore}/100)`);
  if (m.avgDealScore >= 60)
    strengths.push(`Kvalitetne ponudbe (deal ${m.avgDealScore}/100)`);

  if (m.avgROI < 10) weaknesses.push(`Nizek ROI (${m.avgROI}%)`);
  if (m.winRate < 50) weaknesses.push(`Nizka win rate (${m.winRate}%)`);
  if (m.avgHoldDays > 45)
    weaknesses.push(`Počasen turnover (${m.avgHoldDays} dni)`);
  if (m.reliabilityScore < 40)
    weaknesses.push(`Nizka zanesljivost (${m.reliabilityScore}/100)`);
  if (m.trendScore <= 35)
    weaknesses.push(`Padajoči trend (${m.trendScore}/100)`);
  if (m.avgRiskScore >= 60)
    weaknesses.push(`Visoko tveganje (risk ${m.avgRiskScore}/100)`);
  if (m.totalTrades < 3)
    weaknesses.push(`Majhen vzorec (${m.totalTrades} trgovin)`);

  if (strengths.length === 0) strengths.push('Brez izrazitih prednosti');
  if (weaknesses.length === 0) weaknesses.push('Brez izrazitih slabosti');

  return {
    overallIntelligenceScore: overall,
    intelligenceGrade: grade,
    strengths: strengths.slice(0, 3),
    weaknesses: weaknesses.slice(0, 3),
    strategicValue,
    recommendedAction,
  };
}

function buildDeterministicRiskFactors(m: ComputedMetrics): string[] {
  const factors: string[] = [];
  if (m.avgRiskScore >= 60)
    factors.push(`Visok AI risk score (${m.avgRiskScore}/100)`);
  if (m.winRate < 50) factors.push(`Nizka win rate (${m.winRate}%)`);
  if (m.avgHoldDays > 45) factors.push(`Dolgi hold časi (${m.avgHoldDays} dni)`);
  if (m.totalTrades < 5)
    factors.push(`Majhen vzorec (${m.totalTrades} trgovin)`);
  if (m.avgROI < 0) factors.push(`Negativen ROI (${m.avgROI}%)`);
  if (m.trendScore <= 35)
    factors.push(`Padajoči trend (${m.trendScore}/100)`);
  if (factors.length === 0)
    factors.push('Brez zaznanih dejavnikov tveganja');
  return factors.slice(0, 4);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleDealSourceIntelligence(req);
}
export async function POST(req: NextRequest) {
  return handleDealSourceIntelligence(req);
}

async function handleDealSourceIntelligence(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-deal-source-intelligence', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();

    // 1) Query all SOLD trades with linked Listing (for monitor.source,
    //    dealScore, aiRisk).
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null },
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
        buyLocation: true,
        listing: {
          select: {
            dealScore: true,
            aiRisk: true,
            monitor: { select: { source: true } },
          },
        },
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    });

    const emptyResponse = {
      ok: true,
      sources: [] as SourceIntelligence[],
      ranking: [] as RankingEntry[],
      crossSourceOpportunities: [] as CrossSourceOpportunity[],
      riskAssessment: [] as RiskAssessment[],
      summary:
        'Ni zgodovinskih prodaj (SOLD) s povezanim Listing — Deal Source Intelligence ni mogoč.',
      aiUsed: false,
      message:
        'Ni zgodovinskih prodaj (SOLD) s povezanim Listing — Deal Source Intelligence ni mogoč.',
    };

    if (soldTrades.length === 0) {
      return NextResponse.json(emptyResponse);
    }

    // 2) Aggregate per source
    const sourceAggs = aggregateBySource(soldTrades as TradeRow[]);
    if (sourceAggs.length === 0) {
      return NextResponse.json(emptyResponse);
    }

    // 3) Compute metrics + deterministic scorecard per source
    const sourcesData = sourceAggs.map((agg) => {
      const metrics = computeSourceMetrics(agg, now);
      const scorecard = buildDeterministicScorecard(metrics);
      return {
        source: agg.source,
        displayName: displayName(agg.source),
        metrics,
        scorecard,
        riskFactors: buildDeterministicRiskFactors(metrics),
      };
    });

    // Sort by overall score desc
    sourcesData.sort(
      (a, b) =>
        b.scorecard.overallIntelligenceScore -
        a.scorecard.overallIntelligenceScore,
    );

    const ranking: RankingEntry[] = sourcesData.map((s, i) => ({
      source: s.source,
      rank: i + 1,
      score: s.scorecard.overallIntelligenceScore,
    }));

    const sources: SourceIntelligence[] = sourcesData.map((s) => ({
      source: s.source,
      displayName: s.displayName,
      metrics: {
        totalTrades: s.metrics.totalTrades,
        totalProfit: s.metrics.totalProfit,
        avgROI: s.metrics.avgROI,
        winRate: s.metrics.winRate,
        avgDealScore: s.metrics.avgDealScore,
        avgRiskScore: s.metrics.avgRiskScore,
        avgHoldDays: s.metrics.avgHoldDays,
        reliabilityScore: s.metrics.reliabilityScore,
        opportunityScore: s.metrics.opportunityScore,
        trendScore: s.metrics.trendScore,
      },
      scorecard: s.scorecard,
    }));

    const riskAssessment: RiskAssessment[] = sourcesData.map((s) => ({
      source: s.source,
      riskLevel: riskLevelFromMetrics(
        s.metrics.avgRiskScore,
        s.metrics.winRate,
      ),
      riskFactors: s.riskFactors,
    }));

    // 4) Deterministic cross-source opportunities (fallback)
    // Find sources with high opportunity + high reliability — synergy.
    const deterministicCrossOp: CrossSourceOpportunity[] = [];
    if (sourcesData.length >= 2) {
      const highOpp = sourcesData.find(
        (s) =>
          s.metrics.opportunityScore >= 50 &&
          s.metrics.reliabilityScore >= 50,
      );
      if (highOpp) {
        const others = sourcesData
          .filter((s) => s.source !== highOpp.source)
          .slice(0, 2);
        if (others.length > 0) {
          deterministicCrossOp.push({
            opportunity: `Povečaj nabavo na ${highOpp.displayName} (opportunity ${highOpp.metrics.opportunityScore}/100) in distribucijo prek ${others.map((o) => o.displayName).join(', ')}`,
            sources: [highOpp.source, ...others.map((o) => o.source)],
            expectedProfit: round0(
              (highOpp.metrics.totalProfit /
                Math.max(1, highOpp.metrics.totalTrades)) *
                3,
            ),
          });
        }
      }
    }

    // Deterministic summary
    const top = sourcesData[0];
    const bottom = sourcesData[sourcesData.length - 1];
    const deterministicSummary =
      sourcesData.length === 1
        ? `Edini vir: ${top.displayName} (${top.scorecard.intelligenceGrade}, ${top.scorecard.overallIntelligenceScore}/100, ${top.scorecard.strategicValue} strategic). Akcija: ${top.scorecard.recommendedAction}.`
        : `Najboljši vir: ${top.displayName} (${top.scorecard.intelligenceGrade}, ${top.scorecard.overallIntelligenceScore}/100, ${top.scorecard.recommendedAction}). Najšibkejši: ${bottom.displayName} (${bottom.scorecard.intelligenceGrade}, ${bottom.scorecard.overallIntelligenceScore}/100, ${bottom.scorecard.recommendedAction}). ${sourcesData.length} virov analiziranih.`;

    // 5) AI cache check (6h TTL) — key by current month
    const currentMonthKey = monthKeyOf(new Date(now));
    const cacheKey = `deal-source-intelligence:${currentMonthKey}`;
    const cached = getCachedAI<{
      sources: SourceIntelligence[];
      crossSourceOpportunities: CrossSourceOpportunity[];
      riskAssessment: RiskAssessment[];
      summary: string;
    }>(cacheKey);
    if (cached) {
      // Recompute ranking from cached sources (in case AI adjusted scores)
      const cachedRanking: RankingEntry[] = [...cached.sources]
        .sort(
          (a, b) =>
            b.scorecard.overallIntelligenceScore -
            a.scorecard.overallIntelligenceScore,
        )
        .map((s, i) => ({
          source: s.source,
          rank: i + 1,
          score: s.scorecard.overallIntelligenceScore,
        }));
      return NextResponse.json({
        ok: true,
        sources: cached.sources,
        ranking: cachedRanking,
        crossSourceOpportunities: cached.crossSourceOpportunities,
        riskAssessment: cached.riskAssessment,
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

    const metricsForPrompt = sourcesData.map((s) => ({
      source: s.displayName,
      sourceKey: s.source,
      metrics: {
        totalTrades: s.metrics.totalTrades,
        totalProfit: s.metrics.totalProfit,
        avgROI: s.metrics.avgROI,
        winRate: s.metrics.winRate,
        avgDealScore: s.metrics.avgDealScore,
        avgRiskScore: s.metrics.avgRiskScore,
        avgHoldDays: s.metrics.avgHoldDays,
        reliabilityScore: s.metrics.reliabilityScore,
        opportunityScore: s.metrics.opportunityScore,
        trendScore: s.metrics.trendScore,
        recentProfit: s.metrics.recentProfit,
        priorProfit: s.metrics.priorProfit,
      },
      deterministicScorecard: s.scorecard,
    }));

    const prompt = `Si AI "Deal Source Intelligence" analitik za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Generiraš celovit INTELLIGENCE report za vsak deal source — kombiniraš ROI, risk, reliability, opportunity in trend v eno scorecard per source.

METRIKE PER VIR (deterministično izračunano):
${JSON.stringify(metricsForPrompt, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. scorecards: array per source z:
   - source: sourceKey (npr. "bolha")
   - overallIntelligenceScore: 0-100 (composite — reliability 25%, opportunity 25%, ROI normalized 25%, winRate 15%, trend 10%). Lahko prilagodiš znotraj [-15, +15] od deterministične vrednosti.
   - intelligenceGrade: A+ (≥90), A (80-89), B (70-79), C (55-69), D (40-54), F (<40). Vedno izračunaj iz score.
   - strengths: 2-3 konkretni strength-i (slovenščina, max 80 znakov na strength)
   - weaknesses: 2-3 konkretne slabosti (slovenščina, max 80 znakov na weakness)
   - strategicValue: HIGH (≥70) | MEDIUM (45-69) | LOW (<45)
   - recommendedAction: INCREASE_FOCUS (score ≥75 in winRate ≥60) | MAINTAIN (50-74) | REDUCE (30-49) | EXIT (<30)
2. crossSourceOpportunities: 0-3 priložnosti ki združujejo več virov — npr. "kupuj na Bolhi, prodaj na Vinted". Vsaka z: opportunity (opis), sources (array source key-ev), expectedProfit (EUR, 0-10000, realno na podlagi povprečja).
3. riskAssessment: per source z:
   - source: sourceKey
   - riskLevel: LOW (avgRiskScore <40 in winRate ≥60) | MEDIUM (40-59 risk ali winRate 40-59) | HIGH (≥60 risk ali winRate <40)
   - riskFactors: 2-4 konkretni dejavniki tveganja (slovenščina)
4. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi zgornje deterministične podatke.

VRNI LE JSON:
{
  "scorecards": [
    {
      "source": "bolha",
      "overallIntelligenceScore": 88,
      "intelligenceGrade": "A",
      "strengths": ["Visok ROI (35%)", "Hiter turnover (12 dni)"],
      "weaknesses": ["Majhen vzorec (8 trgovin)"],
      "strategicValue": "HIGH",
      "recommendedAction": "INCREASE_FOCUS"
    }
  ],
  "crossSourceOpportunities": [
    { "opportunity": "Kupuj na Bolhi, prodaj na Vinted za +20% margin", "sources": ["bolha", "vinted"], "expectedProfit": 200 }
  ],
  "riskAssessment": [
    { "source": "bolha", "riskLevel": "LOW", "riskFactors": ["Majhen vzorec (8 trgovin)"] }
  ],
  "summary": "Bolha: A grade (88/100, HIGH). Povečaj fokus. Vinted: B (72/100, MAINTAIN)."
}${GROUNDING_PROMPT_SUFFIX}`;

    let finalCrossOpportunities = deterministicCrossOp;
    let finalRiskAssessment = riskAssessment;
    let finalSummary = deterministicSummary;
    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(
        raw,
      ) as AiIntelligenceResponse | null;

      if (parsed && typeof parsed === 'object') {
        // AI may override scorecards per source
        if (parsed.scorecards && Array.isArray(parsed.scorecards)) {
          const aiScorecards = parsed.scorecards as Array<
            Record<string, unknown>
          >;
          for (const sc of aiScorecards) {
            const src = clampString(sc.source, 50, '');
            if (!src) continue;
            const match = sources.find(
              (s) => s.source === src || s.source.includes(src),
            );
            if (!match) continue;

            const sdMatch = sourcesData.find((s) => s.source === match.source)!;
            const detOverall = match.scorecard.overallIntelligenceScore;
            const aiOverall = clampNumber(
              sc.overallIntelligenceScore,
              0,
              100,
              detOverall,
            );
            // Anti-hallucination: AI can adjust by max ±15 from deterministic
            const clampedOverall = Math.max(
              0,
              Math.min(
                100,
                Math.round(
                  detOverall +
                    Math.max(-15, Math.min(15, aiOverall - detOverall)),
                ),
              ),
            );
            match.scorecard.overallIntelligenceScore = clampedOverall;
            // Grade ALWAYS recomputed from score (anti-hallucination)
            match.scorecard.intelligenceGrade = gradeFromScore(clampedOverall);
            match.scorecard.strategicValue = strategicFromScore(clampedOverall);
            match.scorecard.recommendedAction = clampEnum(
              sc.recommendedAction,
              VALID_ACTION,
              actionFromScore(clampedOverall, match.metrics.winRate),
            );

            if (Array.isArray(sc.strengths)) {
              const aiStr = (sc.strengths as unknown[])
                .map((s: unknown) => clampString(s, 80, ''))
                .filter((s) => s.length > 0)
                .slice(0, 3);
              if (aiStr.length > 0) match.scorecard.strengths = aiStr;
            }
            if (Array.isArray(sc.weaknesses)) {
              const aiWeak = (sc.weaknesses as unknown[])
                .map((s: unknown) => clampString(s, 80, ''))
                .filter((s) => s.length > 0)
                .slice(0, 3);
              if (aiWeak.length > 0) match.scorecard.weaknesses = aiWeak;
            }
            void sdMatch;
          }
          // Re-sort sources + ranking after AI adjustments
          sources.sort(
            (a, b) =>
              b.scorecard.overallIntelligenceScore -
              a.scorecard.overallIntelligenceScore,
          );
          sources.forEach((s, i) => {
            ranking[i] = {
              source: s.source,
              rank: i + 1,
              score: s.scorecard.overallIntelligenceScore,
            };
          });
        }

        if (
          parsed.crossSourceOpportunities &&
          Array.isArray(parsed.crossSourceOpportunities)
        ) {
          const aiCross = (parsed.crossSourceOpportunities as unknown[])
            .map((o: unknown) => {
              const op = o as Record<string, unknown>;
              if (!op || typeof op !== 'object') return null;
              const opportunity = clampString(op.opportunity, 250, '');
              if (!opportunity) return null;
              const srcArr = Array.isArray(op.sources)
                ? (op.sources as unknown[])
                    .map((s) => clampString(s, 50, ''))
                    .filter((s) => s.length > 0)
                : [];
              if (srcArr.length < 2) return null;
              const expectedProfit = clampNumber(
                op.expectedProfit,
                0,
                10000,
                0,
              );
              return {
                opportunity,
                sources: srcArr.slice(0, 5),
                expectedProfit: round0(expectedProfit),
              };
            })
            .filter((o): o is CrossSourceOpportunity => o !== null)
            .slice(0, 3);
          if (aiCross.length > 0) finalCrossOpportunities = aiCross;
        }

        if (parsed.riskAssessment && Array.isArray(parsed.riskAssessment)) {
          const aiRisk = (parsed.riskAssessment as unknown[])
            .map((r: unknown) => {
              const ra = r as Record<string, unknown>;
              if (!ra || typeof ra !== 'object') return null;
              const src = clampString(ra.source, 50, '');
              if (!src) return null;
              const match = sourcesData.find(
                (s) => s.source === src || s.source.includes(src),
              );
              if (!match) return null;
              const riskLevel = clampEnum(
                ra.riskLevel,
                VALID_RISK,
                riskLevelFromMetrics(
                  match.metrics.avgRiskScore,
                  match.metrics.winRate,
                ),
              );
              const factors = Array.isArray(ra.riskFactors)
                ? (ra.riskFactors as unknown[])
                    .map((f) => clampString(f, 100, ''))
                    .filter((f) => f.length > 0)
                    .slice(0, 4)
                : [];
              return {
                source: match.source,
                riskLevel,
                riskFactors:
                  factors.length > 0
                    ? factors
                    : buildDeterministicRiskFactors(match.metrics),
              };
            })
            .filter((r): r is RiskAssessment => r !== null)
            .slice(0, sourcesData.length);
          if (aiRisk.length > 0) finalRiskAssessment = aiRisk;
        }

        if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
          finalSummary = clampString(parsed.summary, 400, deterministicSummary);
        }

        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/deal-source-intelligence',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        sources,
        crossSourceOpportunities: finalCrossOpportunities,
        riskAssessment: finalRiskAssessment,
        summary: finalSummary,
      });
    }

    return NextResponse.json({
      ok: true,
      sources,
      ranking,
      crossSourceOpportunities: finalCrossOpportunities,
      riskAssessment: finalRiskAssessment,
      summary: finalSummary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error('/api/ai/deal-source-intelligence', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
