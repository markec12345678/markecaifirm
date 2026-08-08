// v7.91: AI Deal Source Momentum Analyzer — AI analizira MOMENTUM (acceleration
// of trends) per deal source — ne samo trends (ki jih pokriva deal-source-
// trend-analyzer v7.87) temveč MOMENTUM (2nd derivative — pospešek trenda)
// per source. Identificira kateri viri pridobivajo momentum najhitreje in
// napove kateri bodo najboljši v 30 dneh. "Bolha: ACCELERATING (momentum 82,
// +15%/mo²). Vinted: DECELERATING (38). Emerging: Facebook (momentum 65,
// +20%/mo²)."
//
// Razlika od deal-source-trend-analyzer (v7.87 ki track-a 1st-derivative trend
// per source) — ta gleda 2nd-derivative MOMENTUM (ali rast pospešuje ali
// upada). Razlika od deal-source-intelligence (v7.82 AI ki da composite
// scorecard) — ta forecast-a FUTURE ranking z momentum sustainability.
// Razlika od deal-source-profitability-analyzer (v7.89 ki decomposes profit)
// — ta gleda MOMENTUM composite (profit + roi + volume acceleration).
// Razlika od deal-source-performance-tracker (v7.85 ki track-a performance
// metrics) — ta forecast-a future source rank z momentum drivers/risks.
// Razlika od deal-source-quality-tracker (v7.86 ki track-a quality) — ta
// gleda MOMENTUM z emergingSource identification.
//
// GET+POST /api/ai/deal-source-momentum-analyzer
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

type MomentumDirection = 'ACCELERATING' | 'STEADY' | 'DECELERATING';
type DriverImpact = 'POSITIVE' | 'NEGATIVE';
type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

interface SourceMomentum {
  profitMomentum: number; // 0-100
  roiMomentum: number; // 0-100
  volumeMomentum: number; // 0-100
  compositeMomentumScore: number; // 0-100 weighted
  momentumDirection: MomentumDirection;
}

interface MomentumDriver {
  driver: string;
  impact: DriverImpact;
  weight: number; // 0-100
  detail: string;
}

interface MomentumRisk {
  risk: string;
  severity: RiskSeverity;
  mitigation: string;
}

interface SourceAnalysis {
  momentumAssessment: string;
  predictedRank30d: number;
  momentumSustainability: number; // 0-100
  momentumDrivers: MomentumDriver[];
  momentumRisks: MomentumRisk[];
}

interface SourceEntry {
  source: string;
  displayName: string;
  momentum: SourceMomentum;
  analysis: SourceAnalysis;
}

interface MomentumInsights {
  bestMomentumSource: string | null;
  emergingSource: string | null;
  decliningSource: string | null;
  advice: string;
}

interface AiMomentumResponse {
  sources?: Array<{
    source?: string;
    momentumAssessment?: string;
    predictedRank30d?: number;
    momentumSustainability?: number;
    momentumDrivers?: Array<{
      driver?: string;
      impact?: DriverImpact;
      weight?: number;
      detail?: string;
    }>;
    momentumRisks?: Array<{
      risk?: string;
      severity?: RiskSeverity;
      mitigation?: string;
    }>;
  }>;
  insights?: {
    bestMomentumSource?: string | null;
    emergingSource?: string | null;
    decliningSource?: string | null;
    advice?: string;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const MONTHS_12 = 12;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const SUSTAINABILITY_MIN = 0;
const SUSTAINABILITY_MAX = 100;
const RANK_MIN = 1;
const RANK_MAX = 100;
const WEIGHT_MIN = 0;
const WEIGHT_MAX = 100;

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
  const s = String(raw ?? '').trim().toUpperCase();
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

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// Linear regression slope per index
function trendSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = avg(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i]! - yMean);
    den += Math.pow(i - xMean, 2);
  }
  if (den === 0) return 0;
  return num / den;
}

// 2nd derivative: slope of second half minus slope of first half
function computeAcceleration(values: number[]): number {
  if (values.length < 4) return 0;
  const mid = Math.floor(values.length / 2);
  const firstSlope = trendSlope(values.slice(0, mid));
  const secondSlope = trendSlope(values.slice(mid));
  return secondSlope - firstSlope;
}

// Normalize a momentum value to 0-100 score
function normalizeMomentumScore(
  momentum: number,
  maxAbs: number,
): number {
  if (maxAbs <= 0) return 50;
  // Map [-maxAbs, +maxAbs] → [0, 100] linearly: 50 at zero, 100 at +maxAbs, 0 at -maxAbs
  const clamped = Math.max(-maxAbs, Math.min(maxAbs, momentum));
  return round0(50 + (clamped / maxAbs) * 50);
}

function directionFromScore(score: number): MomentumDirection {
  if (score >= 60) return 'ACCELERATING';
  if (score <= 40) return 'DECELERATING';
  return 'STEADY';
}

// Display name for source
function displayName(source: string): string {
  const known: Record<string, string> = {
    'bolha': 'Bolha',
    'vinted': 'Vinted',
    'avtonet': 'Avtonet',
    'mobile-de': 'mobile.de',
    'kleinanzeigen': 'Kleinanzeigen',
    'subito': 'Subito',
    'willhaben': 'Willhaben',
    'salomon': 'Salomon',
    'facebook': 'Facebook',
    'nepremicnine': 'Nepremičnine',
    'neznan': 'Neznan',
  };
  return known[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

// --- Source aggregation (per source × 12 months) -------------------------

interface MonthAgg {
  profit: number;
  cost: number;
  volume: number;
}

function newMonthAgg(): MonthAgg {
  return { profit: 0, cost: 0, volume: 0 };
}

interface SourceAgg {
  source: string;
  months: MonthAgg[]; // 12 buckets, index 0 = oldest, 11 = newest
  totalVolume: number;
  totalProfit: number;
  totalCost: number;
}

function newSourceAgg(source: string): SourceAgg {
  return {
    source,
    months: Array.from({ length: MONTHS_12 }, () => newMonthAgg()),
    totalVolume: 0,
    totalProfit: 0,
    totalCost: 0,
  };
}

// --- Deterministic momentum ----------------------------------------------

function computeSourceMomentum(agg: SourceAgg): SourceMomentum {
  const monthlyProfits = agg.months.map((m) => m.profit);
  const monthlyVolumes = agg.months.map((m) => m.volume);
  // monthly ROI per month — if cost = 0 ROI is 0
  const monthlyRois = agg.months.map((m) => (m.cost > 0 ? (m.profit / m.cost) * 100 : 0));

  // 1st derivative (trend)
  const profitTrend = trendSlope(monthlyProfits);
  const volumeTrend = trendSlope(monthlyVolumes);
  const roiTrend = trendSlope(monthlyRois);

  // 2nd derivative (momentum = acceleration of trend)
  const profitAccel = computeAcceleration(monthlyProfits);
  const volumeAccel = computeAcceleration(monthlyVolumes);
  const roiAccel = computeAcceleration(monthlyRois);

  // Combine: trend direction + acceleration boost
  const profitAbsRef = Math.max(50, Math.abs(profitTrend) * 5);
  const profitMomentumScore = normalizeMomentumScore(
    profitAccel * 3 + profitTrend * 0.3,
    profitAbsRef,
  );
  const volumeAbsRef = Math.max(2, Math.abs(volumeTrend) * 2);
  const volumeMomentumScore = normalizeMomentumScore(
    volumeAccel * 0.5 + volumeTrend * 0.05,
    volumeAbsRef,
  );
  const roiAbsRef = Math.max(5, Math.abs(roiTrend) * 2);
  const roiMomentumScore = normalizeMomentumScore(
    roiAccel * 1.5 + roiTrend * 0.15,
    roiAbsRef,
  );

  // Composite: 45% profit + 30% roi + 25% volume
  const compositeMomentumScore = round0(
    Math.max(SCORE_MIN, Math.min(SCORE_MAX,
      profitMomentumScore * 0.45 +
      roiMomentumScore * 0.30 +
      volumeMomentumScore * 0.25)),
  );

  return {
    profitMomentum: profitMomentumScore,
    roiMomentum: roiMomentumScore,
    volumeMomentum: volumeMomentumScore,
    compositeMomentumScore,
    momentumDirection: directionFromScore(compositeMomentumScore),
  };
}

// --- Deterministic analysis (drivers + risks + sustainability) -----------

function buildDeterministicAnalysis(
  agg: SourceAgg,
  momentum: SourceMomentum,
  currentRank: number,
): SourceAnalysis {
  // Momentum assessment
  const trendVerb =
    momentum.momentumDirection === 'ACCELERATING' ? 'pospešuje' :
    momentum.momentumDirection === 'DECELERATING' ? 'upočasnjuje' : 'je stabilen';
  const assessment =
    `Source ${displayName(agg.source)} ${trendVerb} — composite momentum ${momentum.compositeMomentumScore}/100 ` +
    `(profit ${momentum.profitMomentum}, ROI ${momentum.roiMomentum}, volume ${momentum.volumeMomentum}). ` +
    `${agg.totalVolume} trgov v 12 mesecih, skupni profit ${round0(agg.totalProfit)}€.`.slice(0, 400);

  // Sustainability: based on consistency of momentum + sample size
  const months = agg.months.filter((m) => m.volume > 0).length;
  let sustainability = 35;
  sustainability += Math.min(25, months * 3); // more months = more reliable
  sustainability += Math.min(20, agg.totalVolume * 0.5);
  // If momentum direction matches composite sign, sustainability is higher
  if (momentum.momentumDirection === 'STEADY') sustainability += 8;
  if (momentum.compositeMomentumScore >= 70) sustainability -= 5; // extreme = less sustainable
  if (momentum.compositeMomentumScore <= 30) sustainability -= 5;
  sustainability = round0(Math.max(SUSTAINABILITY_MIN, Math.min(SUSTAINABILITY_MAX, sustainability)));

  // Predicted rank in 30 days — based on momentum direction shift
  let rankShift = 0;
  if (momentum.momentumDirection === 'ACCELERATING') {
    rankShift = momentum.compositeMomentumScore >= 75 ? -2 : -1;
  } else if (momentum.momentumDirection === 'DECELERATING') {
    rankShift = momentum.compositeMomentumScore <= 25 ? 2 : 1;
  }
  const predictedRank30d = Math.max(RANK_MIN, currentRank + rankShift);

  // Drivers: top 3 from momentum components
  const drivers: MomentumDriver[] = [];
  const componentList: Array<{ name: string; score: number; kind: 'profit' | 'roi' | 'volume' }> = [
    { name: 'Profit momentum', score: momentum.profitMomentum, kind: 'profit' },
    { name: 'ROI momentum', score: momentum.roiMomentum, kind: 'roi' },
    { name: 'Volume momentum', score: momentum.volumeMomentum, kind: 'volume' },
  ];
  componentList.sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50));
  for (const c of componentList.slice(0, 3)) {
    const impact: DriverImpact = c.score >= 50 ? 'POSITIVE' : 'NEGATIVE';
    const weight = round0(Math.abs(c.score - 50) * 2); // 0-100
    const detail =
      c.kind === 'profit'
        ? `Mesečni profit ${c.score >= 50 ? 'raste vse hitreje' : 'pada vse hitreje'} (score ${c.score}/100).`
        : c.kind === 'roi'
          ? `ROI ${c.score >= 50 ? 'se izboljšuje z naraščajočo hitrostjo' : 'se slabša z naraščajočo hitrostjo'} (score ${c.score}/100).`
          : `Volumen trgov ${c.score >= 50 ? 'pridobiva zagon' : 'izgublja zagon'} (score ${c.score}/100).`;
    drivers.push({
      driver: c.name,
      impact,
      weight: Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, weight)),
      detail: detail.slice(0, 200),
    });
  }

  // Risks: based on momentum direction + sample size + sustainability
  const risks: MomentumRisk[] = [];
  if (momentum.momentumDirection === 'ACCELERATING' && sustainability < 50) {
    risks.push({
      risk: 'Pospešujoč trend je lahko nestalen — majhna vzorčna osnova lahko povzroči obrat.',
      severity: 'MEDIUM',
      mitigation: 'Povečaj monitoring in analiziraj krovne vzroke za momentum pred povečanjem obsega.',
    });
  }
  if (momentum.momentumDirection === 'DECELERATING') {
    risks.push({
      risk: 'Trend upada — vir izgublja privlačnost ali se trg za izdelek tega vira nasičuje.',
      severity: momentum.compositeMomentumScore <= 30 ? 'HIGH' : 'MEDIUM',
      mitigation: 'Zmanjšaj obseg nabave iz tega vira in diversificiraj na vire z višjim momentum-om.',
    });
  }
  if (agg.totalVolume < 5) {
    risks.push({
      risk: 'Majhno število trgov — momentum ocena je negotljiva in podvržena šumu.',
      severity: 'LOW',
      mitigation: 'Počakaj na več trgov (vsaj 5-10) preden zcela zaupaš momentum score.',
    });
  }
  if (momentum.compositeMomentumScore >= 75) {
    risks.push({
      risk: 'Zelo visok momentum je redko dolgotrajen — pričakuj mean reversion.',
      severity: 'LOW',
      mitigation: 'Izkoristi momentum zdaj, vendar pripravi strategijo za izhod ko se trend normalizira.',
    });
  }
  if (risks.length === 0) {
    risks.push({
      risk: 'Ni specifičnih tveganj — vir z stabilnim momentum-om in zadostno vzorčno osnovo.',
      severity: 'LOW',
      mitigation: 'Vzdržuj trenutno strategijo in redno preverjaj momentum signale.',
    });
  }

  return {
    momentumAssessment: assessment,
    predictedRank30d,
    momentumSustainability: sustainability,
    momentumDrivers: drivers.slice(0, 3),
    momentumRisks: risks.slice(0, 3),
  };
}

// --- Trade row with linked listing ---------------------------------------

interface SoldTradeRow {
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  listing: {
    monitor: { source: string | null } | null;
  } | null;
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleDealSourceMomentumAnalyzer(req);
}
export async function POST(req: NextRequest) {
  return handleDealSourceMomentumAnalyzer(req);
}

async function handleDealSourceMomentumAnalyzer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-deal-source-momentum-analyzer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const cutoff12m = new Date(now - HORIZON_12M);

    // 1) Query all SOLD trades from last 12 months with linked Listing (for monitor.source)
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
      },
      select: {
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        listing: {
          select: {
            monitor: { select: { source: true } },
          },
        },
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    if (soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        sources: [],
        insights: {
          bestMomentumSource: null,
          emergingSource: null,
          decliningSource: null,
          advice: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Momentum Analyzer ni mogoč.',
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Momentum Analyzer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Momentum Analyzer ni mogoč.',
      });
    }

    // 2) Group by source × month (12 months back)
    const sourceMap = new Map<string, SourceAgg>();
    const monthStartMs = (t: number): number => {
      const d = new Date(t);
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    };
    const thisMonthStart = monthStartMs(now);

    for (const t of soldTrades) {
      const source = (t.listing?.monitor?.source ?? 'neznan').trim().toLowerCase() || 'neznan';
      const sellMs = toMs(t.sellDate);
      if (sellMs <= 0) continue;

      const sellPrice = t.sellPrice ?? 0;
      const sellFees = t.sellFees ?? 0;
      const buyPrice = t.buyPrice ?? 0;
      const buyFees = t.buyFees ?? 0;
      const profit = sellPrice - sellFees - buyPrice - buyFees;
      const cost = buyPrice + buyFees;

      let agg = sourceMap.get(source);
      if (!agg) {
        agg = newSourceAgg(source);
        sourceMap.set(source, agg);
      }

      // Determine which month bucket (index 0 = oldest, 11 = newest)
      const sellMonthStart = monthStartMs(sellMs);
      const monthsAgo = Math.round((thisMonthStart - sellMonthStart) / (30 * DAY_MS));
      const bucketIdx = 11 - Math.max(0, Math.min(11, monthsAgo));
      if (bucketIdx >= 0 && bucketIdx <= 11) {
        const m = agg.months[bucketIdx]!;
        m.profit += profit;
        m.cost += cost;
        m.volume += 1;
      }

      agg.totalVolume += 1;
      agg.totalProfit += profit;
      agg.totalCost += cost;
    }

    // 3) Compute momentum per source (require ≥2 months with data)
    const momentumEntries: Array<{
      source: string;
      displayName: string;
      momentum: SourceMomentum;
      currentRank: number;
      totalVolume: number;
      totalProfit: number;
    }> = [];

    for (const [source, agg] of sourceMap.entries()) {
      const activeMonths = agg.months.filter((m) => m.volume > 0).length;
      if (activeMonths < 2) continue; // need ≥2 months for trend
      const momentum = computeSourceMomentum(agg);
      momentumEntries.push({
        source,
        displayName: displayName(source),
        momentum,
        currentRank: 0, // set below
        totalVolume: agg.totalVolume,
        totalProfit: agg.totalProfit,
      });
    }

    if (momentumEntries.length === 0) {
      return NextResponse.json({
        ok: true,
        sources: [],
        insights: {
          bestMomentumSource: null,
          emergingSource: null,
          decliningSource: null,
          advice: 'Ni dovolj SOLD trgovin z znanim source-om v ≥2 mesecih — Deal Source Momentum Analyzer ni mogoč.',
        },
        summary: 'Ni dovolj SOLD trgovin z znanim source-om v ≥2 mesecih — Deal Source Momentum Analyzer ni mogoč.',
        aiUsed: false,
        message: 'Ni dovolj SOLD trgovin z znanim source-om v ≥2 mesecih — Deal Source Momentum Analyzer ni mogoč.',
      });
    }

    // Rank sources by current total profit (1 = highest)
    momentumEntries.sort((a, b) => b.totalProfit - a.totalProfit);
    momentumEntries.forEach((e, i) => {
      e.currentRank = i + 1;
    });

    // 4) Build deterministic baseline (fallback) per source
    const deterministicSources: SourceEntry[] = momentumEntries.map((e) => {
      const agg = sourceMap.get(e.source)!;
      const analysis = buildDeterministicAnalysis(agg, e.momentum, e.currentRank);
      return {
        source: e.source,
        displayName: e.displayName,
        momentum: e.momentum,
        analysis,
      };
    });

    // Sort by composite momentum score desc for response
    deterministicSources.sort((a, b) => b.momentum.compositeMomentumScore - a.momentum.compositeMomentumScore);

    // 5) Compute insights deterministically
    const detInsights = buildDeterministicInsights(deterministicSources, sourceMap);

    let sourcesOut: SourceEntry[] = deterministicSources;
    let insights = detInsights;
    let summary = buildSummary(deterministicSources, detInsights);

    // 6) AI cache check (6h TTL) — key by current month + source count
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    const cacheKey = `deal-source-momentum-analyzer:${currentMonth}`;
    const cached = getCachedAI<{
      sources: SourceEntry[];
      insights: MomentumInsights;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        sources: cached.sources,
        insights: cached.insights,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 7) AI prompt with grounding
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

    const promptData = {
      sources: deterministicSources.map((s) => ({
        source: s.source,
        displayName: s.displayName,
        momentum: s.momentum,
        analysis: s.analysis,
        monthlyBreakdown: sourceMap.get(s.source)!.months.map((m, i) => ({
          monthIndex: i,
          profit: round0(m.profit),
          roi: m.cost > 0 ? round1((m.profit / m.cost) * 100) : 0,
          volume: m.volume,
        })),
        totalVolume: sourceMap.get(s.source)!.totalVolume,
        totalProfit: round0(sourceMap.get(s.source)!.totalProfit),
        currentRank: momentumEntries.find((e) => e.source === s.source)?.currentRank ?? 0,
      })),
      caps: {
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        sustainabilityMin: SUSTAINABILITY_MIN, sustainabilityMax: SUSTAINABILITY_MAX,
        rankMin: RANK_MIN, rankMax: RANK_MAX,
        weightMin: WEIGHT_MIN, weightMax: WEIGHT_MAX,
      },
    };

    const prompt = `Si AI "Deal Source Momentum Analyzer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Analiziraš MOMENTUM (2nd derivative — pospešek trenda) per deal source — kateri viri pridobivajo momentum najhitreje in kateri bodo najboljši v 30 dneh. Razlika od deal-source-trend-analyzer (ki track-a 1st-derivative trend) — ti gledaš MOMENTUM (ali rast pospešuje ali upada).

DETERMINISTIČNI PODATKI (izračunano iz DB — zadnjih 12 mesecev SOLD trgovin z linked Listing → monitor.source, grouped by source × month):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. sources: array z istim vrstnim redom kot v inputu (po source). Za vsak source:
   - source: enako kot v inputu (lowercase)
   - momentumAssessment: slovensko, max 400 znakov — kaj poganja momentum tega vira
   - predictedRank30d: 1-100, ±2 od currentRank (kolikšen rank bo vir imel čez 30 dni glede na momentum)
   - momentumSustainability: 0-100, ±15 od deterministične (kako dolgo bo trenutni momentum trajal)
   - momentumDrivers: 1-3 driverjev { driver (max 100 chars), impact POSITIVE | NEGATIVE, weight 0-100, detail (max 200 chars) }
   - momentumRisks: 1-3 riskov { risk (max 200 chars), severity LOW | MEDIUM | HIGH, mitigation (max 200 chars) }
2. insights: { bestMomentumSource (source z najvišjim compositeMomentumScore), emergingSource (source z najvišjim profitMomentum in najmanj totalVolume — dark horse), decliningSource (source z najnižjim compositeMomentumScore), advice (max 400 chars slovensko) }
3. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi deterministične.

VRNI LE JSON:
{
  "sources": [
    {
      "source": "bolha",
      "momentumAssessment": "Bolha pospešuje — momentum 82/100 zaradi rastočega profita v zadnjih 3 mesecih.",
      "predictedRank30d": 1,
      "momentumSustainability": 72,
      "momentumDrivers": [
        { "driver": "Profit momentum", "impact": "POSITIVE", "weight": 85, "detail": "Mesečni profit raste vse hitreje v zadnjih 6 mesecih." }
      ],
      "momentumRisks": [
        { "risk": "Nasičenje trga po 3 mesecih", "severity": "MEDIUM", "mitigation": "Diversificiraj na Vinted za rezervo." }
      ]
    }
  ],
  "insights": { "bestMomentumSource": "bolha", "emergingSource": "facebook", "decliningSource": "vinted", "advice": "Bolha pridobiva momentum — povečaj obseg. Facebook je emerging dark horse." },
  "summary": "Bolha ACCELERATING (82), Facebook emerging (65). Vinted DECELERATING (38)."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiMomentumResponse | null;

      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.sources)) {
        const detMap = new Map<string, SourceEntry>();
        for (const s of deterministicSources) detMap.set(s.source, s);

        const merged: SourceEntry[] = [];
        for (const ai of parsed.sources) {
          if (!ai || typeof ai !== 'object') continue;
          const det = detMap.get(String(ai.source ?? '').toLowerCase());
          if (!det) continue; // unknown source — skip

          const detSustainability = det.analysis.momentumSustainability;
          const momentumSustainability = round0(
            Math.max(SUSTAINABILITY_MIN, Math.min(SUSTAINABILITY_MAX,
              detSustainability + Math.max(-15, Math.min(15,
                (Number(ai.momentumSustainability ?? detSustainability)) - detSustainability)))),
          );

          const currentRank = momentumEntries.find((e) => e.source === det.source)?.currentRank ?? 1;
          const predictedRank30d = round0(
            Math.max(RANK_MIN, Math.min(RANK_MAX,
              currentRank + Math.max(-2, Math.min(2,
                (Number(ai.predictedRank30d ?? currentRank)) - currentRank)))),
          );

          // Drivers validation
          const drivers: MomentumDriver[] = [];
          if (Array.isArray(ai.momentumDrivers)) {
            for (const d of ai.momentumDrivers.slice(0, 3)) {
              if (!d || typeof d !== 'object') continue;
              drivers.push({
                driver: clampString(d.driver, 100, det.analysis.momentumDrivers[0]?.driver ?? 'Momentum'),
                impact: clampEnum(d.impact, VALID_IMPACT, det.analysis.momentumDrivers[0]?.impact ?? 'POSITIVE'),
                weight: clampNum(d.weight, WEIGHT_MIN, WEIGHT_MAX, det.analysis.momentumDrivers[0]?.weight ?? 50),
                detail: clampString(d.detail, 200, det.analysis.momentumDrivers[0]?.detail ?? 'Momentum signal.'),
              });
            }
          }
          if (drivers.length === 0) {
            for (const d of det.analysis.momentumDrivers) drivers.push(d);
          }

          // Risks validation
          const risks: MomentumRisk[] = [];
          if (Array.isArray(ai.momentumRisks)) {
            for (const r of ai.momentumRisks.slice(0, 3)) {
              if (!r || typeof r !== 'object') continue;
              risks.push({
                risk: clampString(r.risk, 200, det.analysis.momentumRisks[0]?.risk ?? 'Brez specifičnega tveganja.'),
                severity: clampEnum(r.severity, VALID_SEVERITY, det.analysis.momentumRisks[0]?.severity ?? 'LOW'),
                mitigation: clampString(r.mitigation, 200, det.analysis.momentumRisks[0]?.mitigation ?? 'Vzdržuj strategijo.'),
              });
            }
          }
          if (risks.length === 0) {
            for (const r of det.analysis.momentumRisks) risks.push(r);
          }

          merged.push({
            source: det.source,
            displayName: det.displayName,
            momentum: det.momentum,
            analysis: {
              momentumAssessment: clampString(ai.momentumAssessment, 400, det.analysis.momentumAssessment),
              predictedRank30d,
              momentumSustainability,
              momentumDrivers: drivers,
              momentumRisks: risks,
            },
          });
        }

        if (merged.length > 0) {
          sourcesOut = merged;
          // Re-sort by composite momentum score desc
          sourcesOut.sort((a, b) => b.momentum.compositeMomentumScore - a.momentum.compositeMomentumScore);

          // Re-evaluate insights with merged sources
          if (parsed.insights && typeof parsed.insights === 'object') {
            const bestMomentumSource = sourcesOut.length > 0 ? sourcesOut[0]!.source : null;
            const emergingSource = pickEmergingSource(sourcesOut, sourceMap);
            const decliningSource = sourcesOut.length > 0 ? sourcesOut[sourcesOut.length - 1]!.source : null;
            const advice = clampString(parsed.insights.advice, 400, detInsights.advice);
            insights = {
              bestMomentumSource,
              emergingSource,
              decliningSource,
              advice,
            };
          } else {
            insights = buildDeterministicInsights(sourcesOut, sourceMap);
          }
          summary = clampString(parsed.summary, 400, buildSummary(sourcesOut, insights));
          aiUsed = true;
        }
      }
    } catch (err) {
      logger.warn(
        '/api/ai/deal-source-momentum-analyzer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        sources: sourcesOut,
        insights,
        summary,
      });
    }

    return NextResponse.json({
      ok: true,
      sources: sourcesOut,
      insights,
      summary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error(
      '/api/ai/deal-source-momentum-analyzer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

// Pick emerging source — highest profitMomentum in lower half by total volume
function pickEmergingSource(
  sources: SourceEntry[],
  sourceMap: Map<string, SourceAgg>,
): string | null {
  if (sources.length === 0) return null;
  const withVolume = sources.map((s) => ({
    source: s.source,
    momentum: s.momentum.profitMomentum,
    volume: sourceMap.get(s.source)?.totalVolume ?? 0,
  }));
  if (withVolume.length === 0) return null;
  const volumes = withVolume.map((w) => w.volume).sort((a, b) => a - b);
  const medianVol = volumes[Math.floor(volumes.length / 2)] ?? 0;
  // Emerging = below-median volume + highest momentum
  const candidates = withVolume.filter((w) => w.volume <= medianVol);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.momentum - a.momentum);
  return candidates[0]!.source;
}

function buildDeterministicInsights(
  sources: SourceEntry[],
  sourceMap: Map<string, SourceAgg>,
): MomentumInsights {
  if (sources.length === 0) {
    return {
      bestMomentumSource: null,
      emergingSource: null,
      decliningSource: null,
      advice: 'Ni virov z dovolj podatki za momentum analizo.',
    };
  }
  const bestMomentumSource = sources[0]!.source;
  const decliningSource = sources[sources.length - 1]!.source;
  const emergingSource = pickEmergingSource(sources, sourceMap);

  const adviceParts: string[] = [];
  const top = sources[0]!;
  adviceParts.push(`Top momentum: ${top.displayName} (${top.momentum.compositeMomentumScore}/100, ${top.momentum.momentumDirection}).`);
  if (emergingSource) {
    const em = sources.find((s) => s.source === emergingSource);
    if (em) {
      adviceParts.push(`Emerging dark horse: ${em.displayName} (${em.momentum.compositeMomentumScore}/100).`);
    }
  }
  const bottom = sources[sources.length - 1]!;
  if (bottom.momentum.momentumDirection === 'DECELERATING') {
    adviceParts.push(`Zmanjšaj obseg na ${bottom.displayName} (declining).`);
  }
  if (top.momentum.momentumDirection === 'ACCELERATING' && top.analysis.momentumSustainability >= 50) {
    adviceParts.push(`Povečaj obseg na ${top.displayName} (visok momentum z zadostno vzorčno osnovo).`);
  }
  return {
    bestMomentumSource,
    emergingSource,
    decliningSource,
    advice: adviceParts.join(' ').slice(0, 400),
  };
}

function buildSummary(
  sources: SourceEntry[],
  insights: MomentumInsights,
): string {
  if (sources.length === 0) return 'Ni virov z dovolj podatki za momentum analizo.';
  const top = sources[0]!;
  const bottom = sources[sources.length - 1]!;
  const parts: string[] = [
    `${top.displayName}: ${top.momentum.momentumDirection} (${top.momentum.compositeMomentumScore}).`,
  ];
  if (insights.emergingSource) {
    const em = sources.find((s) => s.source === insights.emergingSource);
    if (em) {
      parts.push(`Emerging: ${em.displayName} (${em.momentum.compositeMomentumScore}).`);
    }
  }
  parts.push(`${bottom.displayName}: ${bottom.momentum.momentumDirection} (${bottom.momentum.compositeMomentumScore}).`);
  return parts.join(' ').slice(0, 400);
}
