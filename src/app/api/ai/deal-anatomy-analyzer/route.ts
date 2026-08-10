// v7.71: AI Deal Anatomy Analyzer — AI "anatomizira" tvoje najboljše in
// najslabše posle — razčleni KAJ je naredilo posel uspešnega ali ne. Analizira
// anatomijo zmagovalnih poslov (cena, čas, kategorija, tip prodajalca, deal
// score) v primerjavi z izgubljene, da identificira "DNA dobrega posla".
//
// "Winning deals: 15% discount, dealScore 78, 22d hold. Losing: 5% discount,
//  dealScore 45, 65d hold. DNA: buy at 15%+ discount, dealScore 70+."
//
// Razlika od deal-scoring-model-v2 (ki ocenjuje POSAMEZEN deal z ML) — ta
// primerja ANATOMIJO winnerjev vs. losersov da izlušči skupne vzorce. Razlika
// od profit-leakage-detector (ki gleda kje profit "teče") — ta gleda KAJ loči
// zmagovalne od izgubljenih poslov (DNA profila). Razlika od
// deal-source-comparison-matrix (ki primerja vire) — ta primerja same trade-e
// (winner vs. loser anatomija). Razlika od profit-stream-predictor (ki
// napoveduje tok profita) — ta identificira faktorje uspeha v preteklih poslih.
//
// GET+POST /api/ai/deal-anatomy-analyzer
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

const DAY_MS = 86_400_000;
const DAY_NAMES = [
  'nedelja',
  'ponedeljek',
  'torek',
  'sreda',
  'četrtek',
  'petek',
  'sobota',
];

interface AnatomyGroup {
  count: number;
  avgDiscountAtBuy: number; // %
  avgDealScore: number;
  avgHoldDays: number;
  avgProfit: number;
  avgROI: number; // %
  topCategory: string;
  topSource: string;
  topDayOfWeek: string;
}

interface Anatomy {
  winners: AnatomyGroup;
  losers: AnatomyGroup;
}

interface AnatomyFactor {
  factor: string;
  weight: number; // 0-100
  detail: string;
  winnerAvg: number;
  loserAvg: number;
}

interface DealDNAProfile {
  idealPriceRange: { min: number; max: number };
  idealCategories: string[];
  idealDealScoreRange: { min: number; max: number };
  idealSource: string;
  idealHoldDays: number;
}

interface AvoidanceProfile {
  avoidCategories: string[];
  avoidSources: string[];
  avoidPriceRanges: string[];
  avoidDealScoreBelow: number;
}

interface ScoringRubric {
  criterion: string;
  weight: number;
  scoringMethod: string;
}

interface DealDNA {
  winningFactors: AnatomyFactor[];
  losingFactors: AnatomyFactor[];
  dealDNAProfile: DealDNAProfile;
  avoidanceProfile: AvoidanceProfile;
  scoringRubric: ScoringRubric[];
}

interface AiAnatomyResponse {
  dealDNA?: unknown;
  summary?: unknown;
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
  max: number,
  fallback: string[],
): string[] {
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item === 'string' && item.trim().length > 0) {
        out.push(item.trim().slice(0, 60));
        if (out.length >= max) break;
      }
    }
    if (out.length > 0) return out;
  }
  return fallback.slice(0, max);
}

// Day of week name from a date.
function dayOfWeek(date: Date): string {
  return DAY_NAMES[date.getDay()] ?? 'neznan';
}

// Normalize source string from buyLocation / monitor.source.
function normalizeSource(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return 'neznan';
  if (s.includes('bolha')) return 'bolha';
  if (s.includes('vinted')) return 'vinted';
  if (s.includes('face') || s === 'fb' || s.includes('marketplace')) return 'facebook';
  if (s.includes('avtonet')) return 'avtonet';
  if (s.includes('mobile.de') || s.includes('mobilede')) return 'mobile.de';
  if (s.includes('kleinan')) return 'kleinanzeigen';
  if (s.includes('subito')) return 'subito';
  if (s.includes('willhaben')) return 'willhaben';
  if (s.includes('nepremicn')) return 'nepremicnine';
  if (s.includes('salomon')) return 'salomon';
  if (s.includes('rss')) return 'custom-rss';
  return 'neznan';
}

function topKey(map: Map<string, number>): string {
  let best: string | null = null;
  let bestCount = -1;
  for (const [k, v] of map.entries()) {
    if (v > bestCount) {
      bestCount = v;
      best = k;
    }
  }
  return best ?? 'neznan';
}

// --- Deterministic Deal DNA (fallback) -----------------------------------

interface TradeAnatomyBase {
  profit: number;
  buyPrice: number;
  buyFees: number;
  sellPrice: number;
  sellFees: number;
  aiEstimatedValue: number | null;
  dealScore: number | null;
  holdDays: number;
  category: string;
  source: string;
  sellerName: string | null;
  buyDate: Date | null;
}

function computeAnatomyGroup(
  trades: TradeAnatomyBase[],
): AnatomyGroup {
  const count = trades.length;
  if (count === 0) {
    return {
      count: 0,
      avgDiscountAtBuy: 0,
      avgDealScore: 0,
      avgHoldDays: 0,
      avgProfit: 0,
      avgROI: 0,
      topCategory: 'neznan',
      topSource: 'neznan',
      topDayOfWeek: 'neznan',
    };
  }

  let sumDiscount = 0;
  let sumDealScore = 0;
  let dealScoreCount = 0;
  let sumHoldDays = 0;
  let sumProfit = 0;
  let sumInvested = 0;
  const catMap = new Map<string, number>();
  const srcMap = new Map<string, number>();
  const dayMap = new Map<string, number>();

  for (const t of trades) {
    const estValue =
      t.aiEstimatedValue != null && t.aiEstimatedValue > 0
        ? t.aiEstimatedValue
        : t.buyPrice;
    const discount =
      estValue > 0
        ? Math.max(0, ((estValue - t.buyPrice) / estValue) * 100)
        : 0;
    sumDiscount += discount;

    if (t.dealScore != null && t.dealScore >= 0) {
      sumDealScore += t.dealScore;
      dealScoreCount += 1;
    }

    sumHoldDays += t.holdDays;
    sumProfit += t.profit;
    sumInvested += t.buyPrice + t.buyFees;

    const cat = t.category || 'drugo';
    catMap.set(cat, (catMap.get(cat) ?? 0) + 1);

    const src = t.source || 'neznan';
    srcMap.set(src, (srcMap.get(src) ?? 0) + 1);

    if (t.buyDate) {
      const day = dayOfWeek(new Date(t.buyDate));
      dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
    }
  }

  const avgProfit = sumProfit / count;
  const avgROI = sumInvested > 0 ? (sumProfit / sumInvested) * 100 : 0;

  return {
    count,
    avgDiscountAtBuy: Math.round((sumDiscount / count) * 10) / 10,
    avgDealScore:
      dealScoreCount > 0 ? Math.round(sumDealScore / dealScoreCount) : 0,
    avgHoldDays: Math.round(sumHoldDays / count),
    avgProfit: Math.round(avgProfit * 100) / 100,
    avgROI: Math.round(avgROI * 10) / 10,
    topCategory: topKey(catMap),
    topSource: topKey(srcMap),
    topDayOfWeek: topKey(dayMap),
  };
}

function buildDeterministicDealDNA(
  winners: TradeAnatomyBase[],
  losers: TradeAnatomyBase[],
  winGroup: AnatomyGroup,
  loseGroup: AnatomyGroup,
): DealDNA {
  // Compute factors based on difference between winners and losers
  const factors: Array<{
    factor: string;
    delta: number;
    winnerAvg: number;
    loserAvg: number;
    detail: string;
  }> = [];

  // Discount at buy
  factors.push({
    factor: 'Discount at buy',
    delta: winGroup.avgDiscountAtBuy - loseGroup.avgDiscountAtBuy,
    winnerAvg: winGroup.avgDiscountAtBuy,
    loserAvg: loseGroup.avgDiscountAtBuy,
    detail: `Winners kupljeni s ${winGroup.avgDiscountAtBuy}% popusta, losers z ${loseGroup.avgDiscountAtBuy}%.`,
  });

  // Deal score
  factors.push({
    factor: 'Deal score',
    delta: winGroup.avgDealScore - loseGroup.avgDealScore,
    winnerAvg: winGroup.avgDealScore,
    loserAvg: loseGroup.avgDealScore,
    detail: `Winners dealScore ${winGroup.avgDealScore}, losers ${loseGroup.avgDealScore}.`,
  });

  // Hold days (lower = better — invert delta)
  factors.push({
    factor: 'Hold days (shorter = better)',
    delta: loseGroup.avgHoldDays - winGroup.avgHoldDays,
    winnerAvg: winGroup.avgHoldDays,
    loserAvg: loseGroup.avgHoldDays,
    detail: `Winners držani ${winGroup.avgHoldDays} dni, losers ${loseGroup.avgHoldDays} dni.`,
  });

  // ROI
  factors.push({
    factor: 'ROI',
    delta: winGroup.avgROI - loseGroup.avgROI,
    winnerAvg: winGroup.avgROI,
    loserAvg: loseGroup.avgROI,
    detail: `Winners ROI ${winGroup.avgROI}%, losers ${loseGroup.avgROI}%.`,
  });

  // Sort winning factors (largest positive delta = strongest winner signal)
  const winningSorted = [...factors].sort((a, b) => b.delta - a.delta);
  const winningFactors: AnatomyFactor[] = winningSorted
    .slice(0, 5)
    .map(f => ({
      factor: f.factor,
      weight: Math.max(
        10,
        Math.round(
          (f.delta /
            Math.max(1, Math.abs(f.winnerAvg) + Math.abs(f.loserAvg))) *
            100,
        ),
      ),
      detail: f.detail,
      winnerAvg: f.winnerAvg,
      loserAvg: f.loserAvg,
    }));
  // Re-normalize weights to 0-100 with a sane floor
  const wSum = winningFactors.reduce((s, f) => s + f.weight, 0);
  if (wSum > 0) {
    winningFactors.forEach(f => {
      f.weight = Math.max(5, Math.round((f.weight / wSum) * 100));
    });
  }

  // Losing factors (largest negative delta = strongest loser signal)
  const losingSorted = [...factors].sort((a, b) => a.delta - b.delta);
  const losingFactors: AnatomyFactor[] = losingSorted
    .slice(0, 5)
    .map(f => ({
      factor: f.factor,
      weight: Math.max(
        10,
        Math.round(
          (Math.abs(f.delta) /
            Math.max(1, Math.abs(f.winnerAvg) + Math.abs(f.loserAvg))) *
            100,
        ),
      ),
      detail: `Loser signal: ${f.detail}`,
      winnerAvg: f.winnerAvg,
      loserAvg: f.loserAvg,
    }));
  const lSum = losingFactors.reduce((s, f) => s + f.weight, 0);
  if (lSum > 0) {
    losingFactors.forEach(f => {
      f.weight = Math.max(5, Math.round((f.weight / lSum) * 100));
    });
  }

  // Ideal deal DNA profile — derived from winners
  const winBuyPrices = winners
    .map(w => w.buyPrice)
    .filter(p => p > 0)
    .sort((a, b) => a - b);
  const idealMin =
    winBuyPrices.length > 0 ? winBuyPrices[0]! : 0;
  const idealMax =
    winBuyPrices.length > 0
      ? winBuyPrices[winBuyPrices.length - 1]!
      : 0;

  // Top winner categories (max 3)
  const winCatMap = new Map<string, number>();
  for (const w of winners) {
    const c = w.category || 'drugo';
    winCatMap.set(c, (winCatMap.get(c) ?? 0) + 1);
  }
  const idealCategories = [...winCatMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  // Top loser categories (avoid)
  const loseCatMap = new Map<string, number>();
  for (const l of losers) {
    const c = l.category || 'drugo';
    loseCatMap.set(c, (loseCatMap.get(c) ?? 0) + 1);
  }
  const avoidCategories = [...loseCatMap.entries()]
    .filter(([k]) => !idealCategories.includes(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  // Sources
  const winSrcMap = new Map<string, number>();
  for (const w of winners) {
    const s = w.source || 'neznan';
    winSrcMap.set(s, (winSrcMap.get(s) ?? 0) + 1);
  }
  const idealSource = topKey(winSrcMap);

  const loseSrcMap = new Map<string, number>();
  for (const l of losers) {
    const s = l.source || 'neznan';
    loseSrcMap.set(s, (loseSrcMap.get(s) ?? 0) + 1);
  }
  const avoidSources = [...loseSrcMap.entries()]
    .filter(([k]) => k !== idealSource)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k);

  // Deal score range
  const winDealScores = winners
    .map(w => w.dealScore)
    .filter((v): v is number => v != null && v >= 0)
    .sort((a, b) => a - b);
  const idealDealScoreMin =
    winDealScores.length > 0 ? winDealScores[0]! : 0;
  const idealDealScoreMax =
    winDealScores.length > 0
      ? winDealScores[winDealScores.length - 1]!
      : 100;

  const loseDealScores = losers
    .map(l => l.dealScore)
    .filter((v): v is number => v != null && v >= 0);
  const loseAvgDealScore =
    loseDealScores.length > 0
      ? loseDealScores.reduce((s, v) => s + v, 0) / loseDealScores.length
      : 0;
  const avoidDealScoreBelow =
    loseAvgDealScore > 0 ? Math.round(loseAvgDealScore) : 40;

  // Avoid price ranges (loser cluster)
  const avoidPriceRanges: string[] = [];
  if (losers.length > 0) {
    const losePrices = losers
      .map(l => l.buyPrice)
      .filter(p => p > 0)
      .sort((a, b) => a - b);
    if (losePrices.length > 0) {
      const lo = losePrices[0]!;
      const hi = losePrices[losePrices.length - 1]!;
      avoidPriceRanges.push(`${Math.round(lo)}€-${Math.round(hi)}€`);
    }
  }

  const dealDNAProfile: DealDNAProfile = {
    idealPriceRange: {
      min: Math.round(idealMin),
      max: Math.round(idealMax),
    },
    idealCategories:
      idealCategories.length > 0 ? idealCategories : ['neznan'],
    idealDealScoreRange: {
      min: Math.round(idealDealScoreMin),
      max: Math.round(idealDealScoreMax),
    },
    idealSource,
    idealHoldDays: winGroup.avgHoldDays,
  };

  const avoidanceProfile: AvoidanceProfile = {
    avoidCategories: avoidCategories.length > 0 ? avoidCategories : [],
    avoidSources,
    avoidPriceRanges,
    avoidDealScoreBelow,
  };

  // Scoring rubric based on the winning factors
  const scoringRubric: ScoringRubric[] = winningFactors.map(f => ({
    criterion: f.factor,
    weight: f.weight,
    scoringMethod:
      f.factor === 'Hold days (shorter = better)'
        ? `Nižji od ${winGroup.avgHoldDays} dni = full score; linearno nižje nad ${loseGroup.avgHoldDays}`
        : `Višji od winnerAvg (${f.winnerAvg}) = full score; nižji od loserAvg (${f.loserAvg}) = 0`,
  }));

  return {
    winningFactors,
    losingFactors,
    dealDNAProfile,
    avoidanceProfile,
    scoringRubric,
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleDealAnatomy(req);
}
export async function POST(req: NextRequest) {
  return handleDealAnatomy(req);
}

async function handleDealAnatomy(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-deal-anatomy', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    // 1) Query all SOLD trades with linked Listing (for dealScore, estValue,
    //    sellerName, monitor.source)
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        buyPrice: { gt: 0 },
      },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        buyLocation: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        listing: {
          select: {
            id: true,
            dealScore: true,
            aiEstimatedValue: true,
            sellerName: true,
            monitor: { select: { source: true } },
          },
        },
      },
      take: 10000,
    });

    const totalSold = soldTrades.length;

    // Empty state
    if (totalSold === 0) {
      return NextResponse.json({
        ok: true,
        anatomy: {
          winners: {
            count: 0,
            avgDiscountAtBuy: 0,
            avgDealScore: 0,
            avgHoldDays: 0,
            avgProfit: 0,
            avgROI: 0,
            topCategory: 'neznan',
            topSource: 'neznan',
            topDayOfWeek: 'neznan',
          },
          losers: {
            count: 0,
            avgDiscountAtBuy: 0,
            avgDealScore: 0,
            avgHoldDays: 0,
            avgProfit: 0,
            avgROI: 0,
            topCategory: 'neznan',
            topSource: 'neznan',
            topDayOfWeek: 'neznan',
          },
        },
        dealDNA: {
          winningFactors: [],
          losingFactors: [],
          dealDNAProfile: {
            idealPriceRange: { min: 0, max: 0 },
            idealCategories: [],
            idealDealScoreRange: { min: 0, max: 0 },
            idealSource: 'neznan',
            idealHoldDays: 0,
          },
          avoidanceProfile: {
            avoidCategories: [],
            avoidSources: [],
            avoidPriceRanges: [],
            avoidDealScoreBelow: 0,
          },
          scoringRubric: [],
        },
        summary:
          'Ni prodanih trade-ov — Deal Anatomy analiza ni mogoča. Dodaš trades z buyPrice in sellPrice za začetek.',
        aiUsed: false,
        message:
          'Ni prodanih trade-ov — Deal Anatomy analiza ni mogoča.',
      });
    }

    // 2) Build trade anatomy base + split into winners / losers
    const winners: TradeAnatomyBase[] = [];
    const losers: TradeAnatomyBase[] = [];

    for (const t of soldTrades) {
      const buyPrice = t.buyPrice ?? 0;
      const buyFees = t.buyFees ?? 0;
      const sellPrice = t.sellPrice ?? 0;
      const sellFees = t.sellFees ?? 0;
      const profit = sellPrice - sellFees - buyPrice - buyFees;

      let holdDays = 0;
      if (t.buyDate && t.sellDate) {
        const holdMs =
          new Date(t.sellDate).getTime() - new Date(t.buyDate).getTime();
        if (Number.isFinite(holdMs) && holdMs > 0) {
          holdDays = Math.round(holdMs / DAY_MS);
        }
      }

      const buyLocRaw = (t.buyLocation || '').trim();
      const monSrcRaw = (t.listing?.monitor?.source || '').trim();
      let source: string;
      if (buyLocRaw) {
        source = normalizeSource(buyLocRaw);
      } else if (monSrcRaw) {
        source = normalizeSource(monSrcRaw);
      } else {
        source = 'neznan';
      }

      const category =
        (t.category || 'drugo').trim().toLowerCase() || 'drugo';

      const base: TradeAnatomyBase = {
        profit,
        buyPrice,
        buyFees,
        sellPrice,
        sellFees,
        aiEstimatedValue: t.listing?.aiEstimatedValue ?? null,
        dealScore: t.listing?.dealScore ?? null,
        holdDays,
        category,
        source,
        sellerName: t.listing?.sellerName ?? null,
        buyDate: t.buyDate ? new Date(t.buyDate) : null,
      };

      if (profit > 0) winners.push(base);
      else losers.push(base);
    }

    // 3) Compute anatomy groups
    const winGroup = computeAnatomyGroup(winners);
    const loseGroup = computeAnatomyGroup(losers);

    const anatomy: Anatomy = {
      winners: winGroup,
      losers: loseGroup,
    };

    // 4) AI cache check (6h TTL)
    const cacheKey = `deal-anatomy-analyzer:${totalSold}`;
    const cached = getCachedAI<{ dealDNA: DealDNA; summary: string }>(
      cacheKey,
    );
    if (cached) {
      return NextResponse.json({
        ok: true,
        anatomy,
        dealDNA: cached.dealDNA,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 5) Build deterministic baseline
    const baselineDNA = buildDeterministicDealDNA(
      winners,
      losers,
      winGroup,
      loseGroup,
    );

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

    // Build a compact trade listing for the AI (top 10 winners + top 10 losers by profit)
    const winTop = [...winners]
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 10);
    const loseTop = [...losers]
      .sort((a, b) => a.profit - b.profit)
      .slice(0, 10);

    const tradeLine = (t: TradeAnatomyBase, idx: number) => {
      const estValue =
        t.aiEstimatedValue != null ? t.aiEstimatedValue : t.buyPrice;
      const discount =
        estValue > 0
          ? Math.max(0, ((estValue - t.buyPrice) / estValue) * 100).toFixed(1)
          : '0';
      const dealScore = t.dealScore ?? 'null';
      return `  W${idx + 1}: profit=${Math.round(t.profit)}€, buy=${Math.round(t.buyPrice)}€, estValue=${Math.round(estValue)}€, discount=${discount}%, dealScore=${dealScore}, hold=${t.holdDays}d, cat=${t.category}, src=${t.source}`;
    };
    const winnerBlock = winTop.map((t, i) => tradeLine(t, i)).join('\n');
    const loserBlock = loseTop.map((t, i) => tradeLine(t, i)).join('\n');

    const prompt = `Si AI analitik za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Analiziraj "anatomijo" uspešnih (winner) in neuspešnih (loser) poslov. Identificiraj "DNA dobrega posla" — faktorje ki ločijo zmagovalne od izgubljenih poslov.

ANATOMIJA SKUPIN:
- WINNERS (profit > 0): ${winGroup.count} poslov
  - povprečen popust ob nakupu: ${winGroup.avgDiscountAtBuy}%
  - povprečen dealScore: ${winGroup.avgDealScore}/100
  - povprečen hold: ${winGroup.avgHoldDays} dni
  - povprečen profit: ${winGroup.avgProfit}€, ROI: ${winGroup.avgROI}%
  - top kategorija: ${winGroup.topCategory}, top vir: ${winGroup.topSource}
  - top dan v tednu: ${winGroup.topDayOfWeek}

- LOSERS (profit <= 0): ${loseGroup.count} poslov
  - povprečen popust ob nakupu: ${loseGroup.avgDiscountAtBuy}%
  - povprečen dealScore: ${loseGroup.avgDealScore}/100
  - povprečen hold: ${loseGroup.avgHoldDays} dni
  - povprečna izguba: ${loseGroup.avgProfit}€, ROI: ${loseGroup.avgROI}%
  - top kategorija: ${loseGroup.topCategory}, top vir: ${loseGroup.topSource}
  - top dan v tednu: ${loseGroup.topDayOfWeek}

TOP 10 WINNERJEV (podrobnosti):
${winnerBlock || '—'}

TOP 10 LOSERSOV (podrobnosti):
${loserBlock || '—'}

PRAVILA ZA DEAL DNA:
1. winningFactors: top 5 faktorjev ki ločijo winners od losers. Vsak faktor:
   - factor: kratko ime (npr. "Discount at buy", "Deal score", "Hold days", "Category fit", "Source platform")
   - weight: 0-100 (pomembnost faktorja)
   - detail: 1 stavek razlage zakaj ta faktor loči winners
   - winnerAvg: povprečje winnerjev za ta faktor
   - loserAvg: povprečje losersov
2. losingFactors: top 5 faktorjev ki korelirajo z izgubami (format enak kot winningFactors)
3. dealDNAProfile: idealen profil zmagovalnega posla:
   - idealPriceRange: { min, max } (EUR)
   - idealCategories: top 3 kategorije (lowercase)
   - idealDealScoreRange: { min, max }
   - idealSource: najboljši vir
   - idealHoldDays: optimalno število dni držanja
4. avoidanceProfile: kaj se izogniti:
   - avoidCategories: kategorije z visoko izgubo (max 3)
   - avoidSources: viri z visoko izgubo (max 2)
   - avoidPriceRanges: cena razponi z izgubo (stringi npr. "100€-200€", max 3)
   - avoidDealScoreBelow: dealScore pod katerim se izogni nakupu
5. scoringRubric: kako ocenjevati bodoče posle (3-5 kriterijev):
   - criterion: ime kriterija
   - weight: 0-100
   - scoringMethod: 1 stavek kako točkovati

VRNI LE JSON:
{
  "dealDNA": {
    "winningFactors": [
      { "factor": "...", "weight": 0, "detail": "...", "winnerAvg": 0, "loserAvg": 0 }
    ],
    "losingFactors": [
      { "factor": "...", "weight": 0, "detail": "...", "winnerAvg": 0, "loserAvg": 0 }
    ],
    "dealDNAProfile": {
      "idealPriceRange": { "min": 0, "max": 0 },
      "idealCategories": ["..."],
      "idealDealScoreRange": { "min": 0, "max": 0 },
      "idealSource": "...",
      "idealHoldDays": 0
    },
    "avoidanceProfile": {
      "avoidCategories": ["..."],
      "avoidSources": ["..."],
      "avoidPriceRanges": ["..."],
      "avoidDealScoreBelow": 0
    },
    "scoringRubric": [
      { "criterion": "...", "weight": 0, "scoringMethod": "..." }
    ]
  },
  "summary": "1-2 stavka povzetka DNA profila v slovenščini"
}${GROUNDING_PROMPT_SUFFIX}`;

    let dealDNA: DealDNA = baselineDNA;
    let summary = `Winners: ${winGroup.count} poslov (${winGroup.avgProfit}€ povp. profit, ROI ${winGroup.avgROI}%, dealScore ${winGroup.avgDealScore}). Losers: ${loseGroup.count} poslov (${loseGroup.avgProfit}€ povp.). DNA: kupuj s ${winGroup.avgDiscountAtBuy}%+ popusta, dealScore ${winGroup.avgDealScore}+, hold ${winGroup.avgHoldDays} dni, vir ${winGroup.topSource}.`;
    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(
        raw,
      ) as AiAnatomyResponse | null;

      if (parsed && typeof parsed === 'object') {
        // Parse dealDNA
        if (parsed.dealDNA && typeof parsed.dealDNA === 'object') {
          const d = parsed.dealDNA as Record<string, unknown>;

          // winningFactors
          const winningFactors: AnatomyFactor[] = [];
          if (Array.isArray(d.winningFactors)) {
            for (const f of d.winningFactors) {
              const fr = f as Record<string, unknown> | null;
              if (!fr || typeof fr !== 'object') continue;
              const factor = clampString(fr.factor, 80, 'neznan');
              const weight = clampNumber(fr.weight, 0, 100, 50);
              const detail = clampString(fr.detail, 300, '');
              const winnerAvg = clampNumber(
                fr.winnerAvg,
                -100000,
                100000,
                0,
              );
              const loserAvg = clampNumber(
                fr.loserAvg,
                -100000,
                100000,
                0,
              );
              winningFactors.push({
                factor,
                weight: Math.round(weight),
                detail,
                winnerAvg: Math.round(winnerAvg * 100) / 100,
                loserAvg: Math.round(loserAvg * 100) / 100,
              });
            }
          }
          if (winningFactors.length === 0)
            winningFactors.push(...baselineDNA.winningFactors);

          // losingFactors
          const losingFactors: AnatomyFactor[] = [];
          if (Array.isArray(d.losingFactors)) {
            for (const f of d.losingFactors) {
              const fr = f as Record<string, unknown> | null;
              if (!fr || typeof fr !== 'object') continue;
              const factor = clampString(fr.factor, 80, 'neznan');
              const weight = clampNumber(fr.weight, 0, 100, 50);
              const detail = clampString(fr.detail, 300, '');
              const winnerAvg = clampNumber(
                fr.winnerAvg,
                -100000,
                100000,
                0,
              );
              const loserAvg = clampNumber(
                fr.loserAvg,
                -100000,
                100000,
                0,
              );
              losingFactors.push({
                factor,
                weight: Math.round(weight),
                detail,
                winnerAvg: Math.round(winnerAvg * 100) / 100,
                loserAvg: Math.round(loserAvg * 100) / 100,
              });
            }
          }
          if (losingFactors.length === 0)
            losingFactors.push(...baselineDNA.losingFactors);

          // dealDNAProfile
          let dealDNAProfile = baselineDNA.dealDNAProfile;
          if (d.dealDNAProfile && typeof d.dealDNAProfile === 'object') {
            const p = d.dealDNAProfile as Record<string, unknown>;
            const ipr = (p.idealPriceRange || {}) as Record<string, unknown>;
            const idsr = (p.idealDealScoreRange || {}) as Record<
              string,
              unknown
            >;
            dealDNAProfile = {
              idealPriceRange: {
                min: Math.max(
                  0,
                  Math.round(
                    clampNumber(
                      ipr.min,
                      0,
                      1000000,
                      dealDNAProfile.idealPriceRange.min,
                    ),
                  ),
                ),
                max: Math.max(
                  0,
                  Math.round(
                    clampNumber(
                      ipr.max,
                      0,
                      1000000,
                      dealDNAProfile.idealPriceRange.max,
                    ),
                  ),
                ),
              },
              idealCategories: clampStringArray(
                p.idealCategories,
                5,
                dealDNAProfile.idealCategories,
              ),
              idealDealScoreRange: {
                min: Math.round(
                  clampNumber(
                    idsr.min,
                    0,
                    100,
                    dealDNAProfile.idealDealScoreRange.min,
                  ),
                ),
                max: Math.round(
                  clampNumber(
                    idsr.max,
                    0,
                    100,
                    dealDNAProfile.idealDealScoreRange.max,
                  ),
                ),
              },
              idealSource: clampString(
                p.idealSource,
                40,
                dealDNAProfile.idealSource,
              ),
              idealHoldDays: Math.max(
                0,
                Math.round(
                  clampNumber(
                    p.idealHoldDays,
                    0,
                    365,
                    dealDNAProfile.idealHoldDays,
                  ),
                ),
              ),
            };
          }

          // avoidanceProfile
          let avoidanceProfile = baselineDNA.avoidanceProfile;
          if (d.avoidanceProfile && typeof d.avoidanceProfile === 'object') {
            const a = d.avoidanceProfile as Record<string, unknown>;
            avoidanceProfile = {
              avoidCategories: clampStringArray(
                a.avoidCategories,
                5,
                avoidanceProfile.avoidCategories,
              ),
              avoidSources: clampStringArray(
                a.avoidSources,
                5,
                avoidanceProfile.avoidSources,
              ),
              avoidPriceRanges: clampStringArray(
                a.avoidPriceRanges,
                5,
                avoidanceProfile.avoidPriceRanges,
              ),
              avoidDealScoreBelow: Math.max(
                0,
                Math.round(
                  clampNumber(
                    a.avoidDealScoreBelow,
                    0,
                    100,
                    avoidanceProfile.avoidDealScoreBelow,
                  ),
                ),
              ),
            };
          }

          // scoringRubric
          let scoringRubric = baselineDNA.scoringRubric;
          if (Array.isArray(d.scoringRubric)) {
            const sr: ScoringRubric[] = [];
            for (const r of d.scoringRubric) {
              const rr = r as Record<string, unknown> | null;
              if (!rr || typeof rr !== 'object') continue;
              sr.push({
                criterion: clampString(rr.criterion, 80, 'neznan'),
                weight: Math.round(clampNumber(rr.weight, 0, 100, 50)),
                scoringMethod: clampString(rr.scoringMethod, 300, ''),
              });
            }
            if (sr.length > 0) scoringRubric = sr;
          }

          dealDNA = {
            winningFactors,
            losingFactors,
            dealDNAProfile,
            avoidanceProfile,
            scoringRubric,
          };
        }

        // Parse summary
        if (
          typeof parsed.summary === 'string' &&
          parsed.summary.trim().length > 0
        ) {
          summary = parsed.summary.trim().slice(0, 600);
        }

        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/deal-anatomy-analyzer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { dealDNA, summary });
    }

    return NextResponse.json({
      ok: true,
      anatomy,
      dealDNA,
      summary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error('/api/ai/deal-anatomy-analyzer', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
