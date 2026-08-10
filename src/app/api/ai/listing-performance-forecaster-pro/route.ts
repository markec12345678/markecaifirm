// v7.88: AI Listing Performance Forecaster Pro — AI forecast-a FULL performance
// spectrum vsakega HELD listing-a — predicted views, contacts, bookmarks in 30
// dni + sell timeline + price optimization + performance grade. Razlika od
// listing-performance-forecaster-v4 (ki se osredotoča na sell probability) —
// ta forecast-a FULL performance spectrum: engagement metrics + sell timeline
// + price optimization + performance grade.
// "PS5: 85 views, 12 contacts in 30d, sell 72% in 14d. Grade: A.
// Factor: price -12% below estValue."
//
// Razlika od listing-performance-forecaster-v3 (ki forecast-a eno listing) —
// ta forecast-a celoten HELD portfolio z engagement metrics. Razlika od
// listing-performance-forecaster-v4 (ki se osredotoča na sell probability) —
// ta gleda views/contacts/bookmarks/timeline/optimization/grade. Razlika od
// listing-performance (analytics ki da historical performance) — ta forecast-a
// future performance. Razlika od listing-exposure-score (v7.63 ki meri exposure
// score) — ta forecast-a engagement + sell timeline. Razlika od
// inventory-performance-forecaster (v7.86 ki forecast-a portfolio profit) —
// ta forecast-a per-item engagement metrics.
//
// GET+POST /api/ai/listing-performance-forecaster-pro
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

type PerformanceGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
type FactorImpact = 'POSITIVE' | 'NEGATIVE';

interface PerformanceFactors {
  factor: string;
  impact: FactorImpact;
  weight: number; // 0-100
}

interface HeldItemInput {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  aiEstimatedValue: number | null;
  dealScore: number | null;
  daysListed: number;
  hasImage: boolean;
  categoryDemandScore: number; // 0-100 (sell-through rate for category)
  priceCompetitiveness: number; // (estValue - price) / estValue
  aiScore: number | null;
  aiRisk: number | null;
  aiVerdict: string | null;
}

interface HeldItemForecast {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  aiEstimatedValue: number | null;
  daysListed: number;
  predictedViews30d: number;
  predictedContacts30d: number;
  predictedBookmarks30d: number;
  predictedSellDate: { earliest: string; latest: string };
  predictedDaysToSale: number;
  sellProbability7d: number;
  sellProbability14d: number;
  sellProbability30d: number;
  performanceGrade: PerformanceGrade;
  performanceFactors: PerformanceFactors[];
  optimizationActions: string[];
  confidenceLevel: number;
}

interface HistoricalPatterns {
  avgDaysToFirstContact: number;
  avgDaysToSale: number;
  avgContactsBeforeSale: number;
  contactToSaleRate: number; // %
  sampleSize: number;
}

interface PortfolioSummary {
  totalItems: number;
  avgSellProbability30d: number;
  avgPredictedDaysToSale: number;
  gradeDistribution: Record<PerformanceGrade, number>;
  avgConfidence: number;
}

interface AiItemResponse {
  tradeId?: string;
  predictedViews30d?: number;
  predictedContacts30d?: number;
  predictedBookmarks30d?: number;
  predictedDaysToSale?: number;
  sellProbability7d?: number;
  sellProbability14d?: number;
  sellProbability30d?: number;
  performanceGrade?: PerformanceGrade;
  performanceFactors?: PerformanceFactors[];
  optimizationActions?: string[];
  confidenceLevel?: number;
}

interface AiListingPerformanceResponse {
  items?: AiItemResponse[];
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const PROB_MIN = 0;
const PROB_MAX = 100;
const VIEWS_MIN = 0;
const VIEWS_MAX = 500;
const CONTACTS_MIN = 0;
const CONTACTS_MAX = 500;
const BOOKMARKS_MIN = 0;
const BOOKMARKS_MAX = 500;
const DAYS_TO_SALE_MIN = 0;
const DAYS_TO_SALE_MAX = 365;
const WEIGHT_MIN = 0;
const WEIGHT_MAX = 100;
const CONFIDENCE_MIN = 0;
const CONFIDENCE_MAX = 100;

const VALID_GRADES: readonly PerformanceGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_IMPACT: readonly FactorImpact[] = ['POSITIVE', 'NEGATIVE'];

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

function clampGrade(raw: unknown, fallback: PerformanceGrade): PerformanceGrade {
  const s = String(raw ?? '').trim().toUpperCase();
  for (const v of VALID_GRADES) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
}

function clampImpact(raw: unknown, fallback: FactorImpact): FactorImpact {
  const s = String(raw ?? '').trim().toUpperCase();
  for (const v of VALID_IMPACT) {
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

function isoDate(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * DAY_MS);
  return d.toISOString().slice(0, 10);
}

// --- Deterministic forecast ---------------------------------------------

// Map dealScore (0-100) to performance grade
function gradeFromDealScore(dealScore: number): PerformanceGrade {
  if (dealScore >= 90) return 'A+';
  if (dealScore >= 75) return 'A';
  if (dealScore >= 60) return 'B';
  if (dealScore >= 45) return 'C';
  if (dealScore >= 30) return 'D';
  return 'F';
}

// Deterministic engagement forecast — based on dealScore + age + price competitiveness
function deterministicEngagement(
  item: HeldItemInput,
  history: HistoricalPatterns,
): {
  views: number;
  contacts: number;
  bookmarks: number;
  daysToSale: number;
  prob7: number;
  prob14: number;
  prob30: number;
} {
  // Base views scale with dealScore (0-100 → 0-300)
  const baseViews = (item.dealScore ?? 0) * 3;
  // Image present doubles views
  const views = round0(
    Math.max(
      VIEWS_MIN,
      Math.min(VIEWS_MAX, baseViews * (item.hasImage ? 1.2 : 0.6)),
    ),
  );
  // Contacts ~ 12% of views
  const contacts = round0(
    Math.max(CONTACTS_MIN, Math.min(CONTACTS_MAX, views * 0.12)),
  );
  // Bookmarks ~ 18% of views
  const bookmarks = round0(
    Math.max(BOOKMARKS_MIN, Math.min(BOOKMARKS_MAX, views * 0.18)),
  );

  // Days to sale — use historical avg + price competitiveness adjustment
  const baseDays = history.avgDaysToSale > 0 ? history.avgDaysToSale : 30;
  // Lower competitiveness → faster sale (price below market)
  const competitivenessAdj =
    item.priceCompetitiveness > 0
      ? -item.priceCompetitiveness * 30 // -30 days max if half-price below
      : item.priceCompetitiveness < -0.2
        ? 15
        : 0;
  const daysToSale = round0(
    Math.max(
      DAYS_TO_SALE_MIN,
      Math.min(DAYS_TO_SALE_MAX, baseDays + competitivenessAdj),
    ),
  );

  // Sell probabilities — derived from dealScore + competitiveness + age
  // Older listings that haven't sold have lower probability
  const ageFactor = Math.max(0, 1 - item.daysListed / 90); // fresh listings have higher prob
  const dealFactor = (item.dealScore ?? 0) / 100;
  const priceFactor =
    item.priceCompetitiveness > 0
      ? Math.min(1, 0.5 + item.priceCompetitiveness)
      : Math.max(0, 0.5 + item.priceCompetitiveness);
  const probBase = (dealFactor * 0.5 + priceFactor * 0.3 + ageFactor * 0.2) * 100;

  const prob7 = round0(
    Math.max(PROB_MIN, Math.min(PROB_MAX, probBase * 0.3)),
  );
  const prob14 = round0(
    Math.max(PROB_MIN, Math.min(PROB_MAX, probBase * 0.6)),
  );
  const prob30 = round0(
    Math.max(PROB_MIN, Math.min(PROB_MAX, probBase)),
  );

  return { views, contacts, bookmarks, daysToSale, prob7, prob14, prob30 };
}

function buildDeterministicFactors(
  item: HeldItemInput,
): PerformanceFactors[] {
  const factors: PerformanceFactors[] = [];
  // Price competitiveness
  if (item.priceCompetitiveness > 0.05) {
    factors.push({
      factor: `Cena ${round1(item.priceCompetitiveness * 100)}% pod ocenjeno vrednostjo`,
      impact: 'POSITIVE',
      weight: round0(Math.min(WEIGHT_MAX, item.priceCompetitiveness * 200)),
    });
  } else if (item.priceCompetitiveness < -0.05) {
    factors.push({
      factor: `Cena ${round1(Math.abs(item.priceCompetitiveness) * 100)}% nad ocenjeno vrednostjo`,
      impact: 'NEGATIVE',
      weight: round0(Math.min(WEIGHT_MAX, Math.abs(item.priceCompetitiveness) * 200)),
    });
  }
  // Deal score
  if ((item.dealScore ?? 0) >= 70) {
    factors.push({
      factor: `Deal score ${item.dealScore}/100 — visoka kakovost ponudbe`,
      impact: 'POSITIVE',
      weight: round0(Math.min(WEIGHT_MAX, (item.dealScore ?? 0) * 0.8)),
    });
  } else if ((item.dealScore ?? 0) < 30) {
    factors.push({
      factor: `Deal score ${item.dealScore}/100 — nizka kakovost ponudbe`,
      impact: 'NEGATIVE',
      weight: round0(Math.min(WEIGHT_MAX, (100 - (item.dealScore ?? 0)) * 0.5)),
    });
  }
  // Image presence
  if (!item.hasImage) {
    factors.push({
      factor: 'Brez slike — zmanjšana izpostavljenost',
      impact: 'NEGATIVE',
      weight: 30,
    });
  } else {
    factors.push({
      factor: 'Slika prisotna — boljša izpostavljenost',
      impact: 'POSITIVE',
      weight: 25,
    });
  }
  // Listing age
  if (item.daysListed > 30) {
    factors.push({
      factor: `Oglas star ${item.daysListed} dni — zmanjšan interest`,
      impact: 'NEGATIVE',
      weight: round0(Math.min(WEIGHT_MAX, item.daysListed)),
    });
  } else if (item.daysListed <= 7) {
    factors.push({
      factor: `Svež oglas (${item.daysListed} dni) — peak interest`,
      impact: 'POSITIVE',
      weight: 40,
    });
  }
  // Category demand
  if (item.categoryDemandScore >= 70) {
    factors.push({
      factor: `Kategorija "${item.category}" — visoka povpraševanja (${item.categoryDemandScore}/100)`,
      impact: 'POSITIVE',
      weight: 35,
    });
  } else if (item.categoryDemandScore < 30) {
    factors.push({
      factor: `Kategorija "${item.category}" — nizka povpraševanja (${item.categoryDemandScore}/100)`,
      impact: 'NEGATIVE',
      weight: 30,
    });
  }
  // Sort by weight desc, take top 3
  factors.sort((a, b) => b.weight - a.weight);
  return factors.slice(0, 3);
}

function buildDeterministicOptimizationActions(item: HeldItemInput): string[] {
  const actions: string[] = [];
  if (!item.hasImage) {
    actions.push('Dodaj kakovostne fotografije za izboljšanje izpostavljenosti');
  }
  if (item.priceCompetitiveness < -0.05 && item.aiEstimatedValue) {
    actions.push(
      `Znižaj ceno proti ocenjeni vrednosti (${item.aiEstimatedValue}€) za boljšo konkurenčnost`,
    );
  }
  if (item.daysListed > 21) {
    actions.push('Premakni oglas višje v seznamu z re-listing ali refresh');
  }
  if ((item.dealScore ?? 0) < 40) {
    actions.push('Izboljšaj opis in dodaj več detaljev za višji deal score');
  }
  if (item.categoryDemandScore < 40) {
    actions.push(
      `Premisli cross-platform listing za večjo izpostavljenost v kategoriji "${item.category}"`,
    );
  }
  if (actions.length === 0) {
    actions.push('Ohranjaj trenutno strategijo — performance je optimalna');
  }
  return actions.slice(0, 3);
}

function buildDeterministicConfidence(item: HeldItemInput): number {
  // Higher confidence when more data available
  let conf = 50;
  if (item.aiEstimatedValue != null) conf += 15;
  if (item.dealScore != null) conf += 10;
  if (item.hasImage) conf += 5;
  if (item.daysListed > 0) conf += 10;
  if (item.aiScore != null) conf += 10;
  return round0(Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX, conf)));
}

function buildDeterministicForecast(
  item: HeldItemInput,
  history: HistoricalPatterns,
): HeldItemForecast {
  const eng = deterministicEngagement(item, history);
  const grade = gradeFromDealScore(item.dealScore ?? 0);
  const factors = buildDeterministicFactors(item);
  const actions = buildDeterministicOptimizationActions(item);
  const confidence = buildDeterministicConfidence(item);

  // Sell date range — earliest = 60% of predictedDaysToSale, latest = 140%
  const earliestDays = Math.max(1, Math.round(eng.daysToSale * 0.6));
  const latestDays = Math.max(earliestDays + 1, Math.round(eng.daysToSale * 1.4));

  return {
    tradeId: item.tradeId,
    title: item.title,
    category: item.category,
    buyPrice: item.buyPrice,
    aiEstimatedValue: item.aiEstimatedValue,
    daysListed: item.daysListed,
    predictedViews30d: eng.views,
    predictedContacts30d: eng.contacts,
    predictedBookmarks30d: eng.bookmarks,
    predictedSellDate: {
      earliest: isoDate(earliestDays),
      latest: isoDate(latestDays),
    },
    predictedDaysToSale: eng.daysToSale,
    sellProbability7d: eng.prob7,
    sellProbability14d: eng.prob14,
    sellProbability30d: eng.prob30,
    performanceGrade: grade,
    performanceFactors: factors,
    optimizationActions: actions,
    confidenceLevel: confidence,
  };
}

function buildPortfolioSummary(items: HeldItemForecast[]): PortfolioSummary {
  const totalItems = items.length;
  const avgSellProbability30d =
    totalItems > 0
      ? round1(items.reduce((s, i) => s + i.sellProbability30d, 0) / totalItems)
      : 0;
  const avgPredictedDaysToSale =
    totalItems > 0
      ? round0(items.reduce((s, i) => s + i.predictedDaysToSale, 0) / totalItems)
      : 0;
  const gradeDistribution: Record<PerformanceGrade, number> = {
    'A+': 0, A: 0, B: 0, C: 0, D: 0, F: 0,
  };
  for (const it of items) {
    gradeDistribution[it.performanceGrade] = (gradeDistribution[it.performanceGrade] ?? 0) + 1;
  }
  const avgConfidence =
    totalItems > 0
      ? round0(items.reduce((s, i) => s + i.confidenceLevel, 0) / totalItems)
      : 0;
  return {
    totalItems,
    avgSellProbability30d,
    avgPredictedDaysToSale,
    gradeDistribution,
    avgConfidence,
  };
}

function buildDeterministicSummary(
  items: HeldItemForecast[],
  portfolio: PortfolioSummary,
): string {
  if (items.length === 0) {
    return 'Ni HELD trgovin — Listing Performance Forecaster Pro ni mogoč.';
  }
  const top = items[0]!;
  return `Napoved za ${portfolio.totalItems} HELD itemov. Povprečno: ${portfolio.avgSellProbability30d}% prodaja v 30d, ${portfolio.avgPredictedDaysToSale} dni do prodaje. Najboljši: "${top.title}" (${top.performanceGrade}, ${top.sellProbability30d}% v 30d, ${top.predictedViews30d} views). Avg confidence: ${portfolio.avgConfidence}/100.`.slice(0, 400);
}

// --- Held trade row with linked listing ----------------------------------

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  listing: {
    aiEstimatedValue: number | null;
    dealScore: number | null;
    aiScore: number | null;
    aiRisk: number | null;
    aiVerdict: string | null;
    imageUrl: string | null;
    firstSeenAt: Date;
    contactStatus: string;
    contactedAt: Date | null;
    monitor: { source: string | null } | null;
  } | null;
}

interface SoldTradeRow {
  buyDate: Date | null;
  sellDate: Date | null;
  listing: {
    firstSeenAt: Date;
    contactStatus: string;
    contactedAt: Date | null;
    monitor: { source: string | null } | null;
  } | null;
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleListingPerformanceForecasterPro(req);
}
export async function POST(req: NextRequest) {
  return handleListingPerformanceForecasterPro(req);
}

async function handleListingPerformanceForecasterPro(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-listing-performance-forecaster-pro', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();

    // 1) Query all HELD trades with their linked Listing
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        listing: {
          select: {
            aiEstimatedValue: true,
            dealScore: true,
            aiScore: true,
            aiRisk: true,
            aiVerdict: true,
            imageUrl: true,
            firstSeenAt: true,
            contactStatus: true,
            contactedAt: true,
            monitor: { select: { source: true } },
          },
        },
      },
      orderBy: { buyDate: 'desc' },
      take: 1000,
    });

    const heldRows = heldTrades as unknown as HeldTradeRow[];

    if (heldRows.length === 0) {
      return NextResponse.json({
        ok: true,
        items: [],
        portfolio: {
          totalItems: 0,
          avgSellProbability30d: 0,
          avgPredictedDaysToSale: 0,
          gradeDistribution: { 'A+': 0, A: 0, B: 0, C: 0, D: 0, F: 0 },
          avgConfidence: 0,
        },
        summary: 'Ni HELD trgovin — Listing Performance Forecaster Pro ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD trgovin — Listing Performance Forecaster Pro ni mogoč.',
      });
    }

    // 2) Query SOLD trades with linked Listing for historical performance patterns
    const cutoff12m = new Date(now - HORIZON_12M);
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
      },
      select: {
        buyDate: true,
        sellDate: true,
        listing: {
          select: {
            firstSeenAt: true,
            contactStatus: true,
            contactedAt: true,
            monitor: { select: { source: true } },
          },
        },
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    // Compute historical patterns
    let daysToFirstContactSum = 0;
    let daysToFirstContactCount = 0;
    let daysToSaleSum = 0;
    let daysToSaleCount = 0;
    let contactsBeforeSaleCount = 0;
    let contactedCount = 0;
    let contactedSoldCount = 0;

    // Per-source sell-through (Listing has no category field — use monitor.source)
    const categorySold = new Map<string, number>();

    for (const t of soldTrades) {
      const sellMs = toMs(t.sellDate);
      const buyMs = toMs(t.buyDate);
      if (sellMs <= 0 || buyMs <= 0) continue;

      const listing = t.listing;
      const seenMs = listing ? toMs(listing.firstSeenAt) : 0;

      // Days from listing to sale
      if (seenMs > 0 && sellMs > seenMs) {
        const days = (sellMs - seenMs) / DAY_MS;
        if (days > 0 && days < 3650) {
          daysToSaleSum += days;
          daysToSaleCount += 1;
        }
      }

      // Days from listing to first contact
      const contactedMs = listing ? toMs(listing.contactedAt) : 0;
      if (listing && contactedMs > 0 && seenMs > 0) {
        const days = (contactedMs - seenMs) / DAY_MS;
        if (days >= 0 && days < 3650) {
          daysToFirstContactSum += days;
          daysToFirstContactCount += 1;
          contactsBeforeSaleCount += 1;
        }
      }

      // Contact-to-sale rate (based on contactStatus being 'contacted' or beyond)
      if (listing && listing.contactStatus === 'contacted') {
        contactedCount += 1;
        contactedSoldCount += 1; // this trade was sold AND contacted
      }

      // Per-source sell count
      const sourceRaw = listing?.monitor?.source ?? 'neznan';
      const cat = (sourceRaw ?? '').trim().toLowerCase() || 'neznan';
      categorySold.set(cat, (categorySold.get(cat) ?? 0) + 1);
    }

    // Compute total listings per source from last 12m for sell-through rate
    const listingCountsByMonitor = await db.listing.groupBy({
      by: ['monitorId'],
      where: { firstSeenAt: { gte: cutoff12m } },
      _count: true,
    });

    const monitorIds = listingCountsByMonitor.map((r) => r.monitorId);
    const monitors = monitorIds.length > 0
      ? await db.monitor.findMany({
          where: { id: { in: monitorIds } },
          select: { id: true, source: true },
        })
      : [];
    const monitorSourceMap = new Map<string, string>();
    for (const m of monitors) {
      monitorSourceMap.set(m.id, (m.source ?? '').trim().toLowerCase() || 'neznan');
    }
    const sourceTotal = new Map<string, number>();
    for (const r of listingCountsByMonitor) {
      const src = monitorSourceMap.get(r.monitorId) ?? 'neznan';
      sourceTotal.set(src, (sourceTotal.get(src) ?? 0) + r._count);
    }

    const history: HistoricalPatterns = {
      avgDaysToFirstContact: daysToFirstContactCount > 0
        ? round1(daysToFirstContactSum / daysToFirstContactCount)
        : 0,
      avgDaysToSale: daysToSaleCount > 0
        ? round1(daysToSaleSum / daysToSaleCount)
        : 0,
      avgContactsBeforeSale: daysToSaleCount > 0
        ? round1(contactsBeforeSaleCount / daysToSaleCount)
        : 0,
      contactToSaleRate: contactedCount > 0
        ? round1((contactedSoldCount / contactedCount) * 100)
        : 0,
      sampleSize: soldTrades.length,
    };

    // 3) Build HeldItemInput array with computed performance factors
    const heldItems: HeldItemInput[] = heldRows.map((t) => {
      const listing = t.listing;
      const seenMs = listing ? toMs(listing.firstSeenAt) : 0;
      const daysListed = seenMs > 0 ? Math.max(0, Math.round((now - seenMs) / DAY_MS)) : 0;

      const aiEstimatedValue = listing?.aiEstimatedValue ?? null;
      const buyPrice = t.buyPrice ?? 0;
      const priceCompetitiveness =
        aiEstimatedValue && aiEstimatedValue > 0
          ? (aiEstimatedValue - buyPrice) / aiEstimatedValue
          : 0;

      // Category demand score = sell-through rate (sold / total) × 100
      const sourceRaw = listing?.monitor?.source ?? 'neznan';
      const cat = (sourceRaw ?? '').trim().toLowerCase() || 'neznan';
      const sold = categorySold.get(cat) ?? 0;
      const total = sourceTotal.get(cat) ?? sold;
      const categoryDemandScore = total > 0
        ? round0(Math.min(100, (sold / total) * 100))
        : 50; // default if no data

      return {
        tradeId: t.id,
        title: t.title,
        category: cat,
        buyPrice,
        aiEstimatedValue,
        dealScore: listing?.dealScore ?? null,
        daysListed,
        hasImage: !!listing?.imageUrl,
        categoryDemandScore,
        priceCompetitiveness,
        aiScore: listing?.aiScore ?? null,
        aiRisk: listing?.aiRisk ?? null,
        aiVerdict: listing?.aiVerdict ?? null,
      };
    });

    // 4) Build deterministic forecasts (fallback)
    let items: HeldItemForecast[] = heldItems.map((it) =>
      buildDeterministicForecast(it, history),
    );
    let portfolio = buildPortfolioSummary(items);
    let finalSummary = buildDeterministicSummary(items, portfolio);

    // 5) AI cache check (6h TTL) — key by held item IDs
    const heldItemIds = heldItems.map((i) => i.tradeId).sort().join(',');
    const cacheKey = `listing-performance-forecaster-pro:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<{
      items: HeldItemForecast[];
      summary: string;
    }>(cacheKey);
    if (cached) {
      const portfolioCached = buildPortfolioSummary(cached.items);
      return NextResponse.json({
        ok: true,
        items: cached.items,
        portfolio: portfolioCached,
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

    const promptData = {
      heldItems,
      historicalPatterns: history,
      deterministicForecasts: items.map((i) => ({
        tradeId: i.tradeId,
        title: i.title,
        predictedViews30d: i.predictedViews30d,
        predictedContacts30d: i.predictedContacts30d,
        predictedBookmarks30d: i.predictedBookmarks30d,
        predictedDaysToSale: i.predictedDaysToSale,
        sellProbability7d: i.sellProbability7d,
        sellProbability14d: i.sellProbability14d,
        sellProbability30d: i.sellProbability30d,
        performanceGrade: i.performanceGrade,
        performanceFactors: i.performanceFactors,
        optimizationActions: i.optimizationActions,
        confidenceLevel: i.confidenceLevel,
      })),
      caps: {
        probMin: PROB_MIN, probMax: PROB_MAX,
        viewsMax: VIEWS_MAX, contactsMax: CONTACTS_MAX, bookmarksMax: BOOKMARKS_MAX,
        daysMax: DAYS_TO_SALE_MAX, weightMax: WEIGHT_MAX, confidenceMax: CONFIDENCE_MAX,
      },
    };

    const prompt = `Si AI "Listing Performance Forecaster Pro" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Forecast-aš FULL performance spectrum vsakega HELD listing-a — predicted views, contacts, bookmarks in 30 dni + sell timeline + price optimization + performance grade.

DETERMINISTIČNI PODATKI (izračunano iz DB):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. items: array z istim vrstnim redom kot heldItems. Za vsak item:
   - tradeId: mora biti enak kot v inputu
   - predictedViews30d: 0-500, ±50 od deterministične
   - predictedContacts30d: 0-500, ±10 od deterministične
   - predictedBookmarks30d: 0-500, ±15 od deterministične
   - predictedDaysToSale: 0-365, ±7 dni od deterministične
   - sellProbability7d/14d/30d: 0-100, ±15 od deterministične
   - performanceGrade: A+ | A | B | C | D | F (glede na dealScore + factors)
   - performanceFactors: top 3 z { factor (slovensko, max 100 znakov), impact: POSITIVE | NEGATIVE, weight: 0-100 }
   - optimizationActions: 2-3 konkretne akcije (slovensko, max 150 znakov vsaka)
   - confidenceLevel: 0-100, ±15 od deterministične
2. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi deterministične.

VRNI LE JSON:
{
  "items": [
    {
      "tradeId": "abc123",
      "predictedViews30d": 85,
      "predictedContacts30d": 12,
      "predictedBookmarks30d": 18,
      "predictedDaysToSale": 14,
      "sellProbability7d": 25,
      "sellProbability14d": 72,
      "sellProbability30d": 88,
      "performanceGrade": "A",
      "performanceFactors": [
        { "factor": "Cena 12% pod ocenjeno vrednostjo", "impact": "POSITIVE", "weight": 80 },
        { "factor": "Deal score 78/100", "impact": "POSITIVE", "weight": 65 }
      ],
      "optimizationActions": [
        "Dodaj še 2 fotografije iz drugih kotov",
        "Dodaj ključne besede v naslov za boljšo searchable"
      ],
      "confidenceLevel": 75
    }
  ],
  "summary": "Napoved za 5 HELD itemov. Povprečno: 65% prodaja v 30d, 18 dni do prodaje. Najboljši: PS5 (A, 88% v 30d, 85 views)."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiListingPerformanceResponse | null;

      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
        const aiItems = parsed.items as AiItemResponse[];

        // Build a map of deterministic forecasts by tradeId for adjustment
        const detMap = new Map<string, HeldItemForecast>();
        for (const it of items) detMap.set(it.tradeId, it);

        const merged: HeldItemForecast[] = [];
        for (const ai of aiItems) {
          if (!ai || typeof ai !== 'object') continue;
          const det = detMap.get(ai.tradeId ?? '');
          if (!det) continue; // unknown tradeId — skip (anti-hallucination)

          // Adjust predictions within allowed bounds
          const prob7 = round0(
            Math.max(PROB_MIN, Math.min(PROB_MAX,
              det.sellProbability7d + Math.max(-15, Math.min(15, Number(ai.sellProbability7d ?? det.sellProbability7d) - det.sellProbability7d)))),
          );
          const prob14 = round0(
            Math.max(PROB_MIN, Math.min(PROB_MAX,
              det.sellProbability14d + Math.max(-15, Math.min(15, Number(ai.sellProbability14d ?? det.sellProbability14d) - det.sellProbability14d)))),
          );
          const prob30 = round0(
            Math.max(PROB_MIN, Math.min(PROB_MAX,
              det.sellProbability30d + Math.max(-15, Math.min(15, Number(ai.sellProbability30d ?? det.sellProbability30d) - det.sellProbability30d)))),
          );

          const views = round0(
            Math.max(VIEWS_MIN, Math.min(VIEWS_MAX,
              det.predictedViews30d + Math.max(-50, Math.min(50, Number(ai.predictedViews30d ?? det.predictedViews30d) - det.predictedViews30d)))),
          );
          const contacts = round0(
            Math.max(CONTACTS_MIN, Math.min(CONTACTS_MAX,
              det.predictedContacts30d + Math.max(-10, Math.min(10, Number(ai.predictedContacts30d ?? det.predictedContacts30d) - det.predictedContacts30d)))),
          );
          const bookmarks = round0(
            Math.max(BOOKMARKS_MIN, Math.min(BOOKMARKS_MAX,
              det.predictedBookmarks30d + Math.max(-15, Math.min(15, Number(ai.predictedBookmarks30d ?? det.predictedBookmarks30d) - det.predictedBookmarks30d)))),
          );
          const days = round0(
            Math.max(DAYS_TO_SALE_MIN, Math.min(DAYS_TO_SALE_MAX,
              det.predictedDaysToSale + Math.max(-7, Math.min(7, Number(ai.predictedDaysToSale ?? det.predictedDaysToSale) - det.predictedDaysToSale)))),
          );

          const grade = clampGrade(ai.performanceGrade, det.performanceGrade);

          const factors: PerformanceFactors[] = Array.isArray(ai.performanceFactors)
            ? ai.performanceFactors
                .map((f) => {
                  if (!f || typeof f !== 'object') return null;
                  const factor = clampString(f.factor, 100, '');
                  if (!factor) return null;
                  const impact = clampImpact(f.impact, 'POSITIVE');
                  const weight = round0(
                    clampNumber(f.weight, WEIGHT_MIN, WEIGHT_MAX, 50),
                  );
                  return { factor, impact, weight };
                })
                .filter((f): f is PerformanceFactors => f !== null)
                .slice(0, 3)
            : det.performanceFactors;

          const actions: string[] = Array.isArray(ai.optimizationActions)
            ? ai.optimizationActions
                .map((a) => clampString(a, 150, ''))
                .filter((a) => a.length > 0)
                .slice(0, 3)
            : det.optimizationActions;

          const confidence = round0(
            Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX,
              det.confidenceLevel + Math.max(-15, Math.min(15, Number(ai.confidenceLevel ?? det.confidenceLevel) - det.confidenceLevel)))),
          );

          const earliestDays = Math.max(1, Math.round(days * 0.6));
          const latestDays = Math.max(earliestDays + 1, Math.round(days * 1.4));

          merged.push({
            tradeId: det.tradeId,
            title: det.title,
            category: det.category,
            buyPrice: det.buyPrice,
            aiEstimatedValue: det.aiEstimatedValue,
            daysListed: det.daysListed,
            predictedViews30d: views,
            predictedContacts30d: contacts,
            predictedBookmarks30d: bookmarks,
            predictedSellDate: {
              earliest: isoDate(earliestDays),
              latest: isoDate(latestDays),
            },
            predictedDaysToSale: days,
            sellProbability7d: prob7,
            sellProbability14d: prob14,
            sellProbability30d: prob30,
            performanceGrade: grade,
            performanceFactors: factors.length > 0 ? factors : det.performanceFactors,
            optimizationActions: actions.length > 0 ? actions : det.optimizationActions,
            confidenceLevel: confidence,
          });
        }

        if (merged.length > 0) {
          items = merged;
          portfolio = buildPortfolioSummary(items);
          aiUsed = true;
        }
      }

      if (typeof parsed?.summary === 'string' && parsed.summary.trim()) {
        finalSummary = clampString(parsed.summary, 400, buildDeterministicSummary(items, portfolio));
      }
    } catch (err) {
      logger.warn(
        '/api/ai/listing-performance-forecaster-pro',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        items,
        summary: finalSummary,
      });
    }

    return NextResponse.json({
      ok: true,
      items,
      portfolio,
      summary: finalSummary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error(
      '/api/ai/listing-performance-forecaster-pro',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
