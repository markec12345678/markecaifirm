// v7.95: AI Deal Sourcing Intelligence — AI identificira NAJBOLJŠE vire za
// iskanje novih deal-ov (kje iskati, katere ključne besede, kateri
// monitorji za dodati, katere kategorije so zrele za sourcing). Razlika
// od sourcing (basic suggestions) — ta je INTELLIGENCE o tem KODI deal-i
// prihajajo in kje najti več. Razlika od deal-source-intelligence
// (v7.82 ki da composite scorecard per source) — ta generira
// SEARCH KEYWORDS, NEW MONITORS in SOURCING GAPS z timing advice.
// Razlika od deal-source-trend-analyzer (v7.87 ki track-a source trends)
// — ta forecast-a FUTURE sourcing strategy. Razlika od deal-source-
// momentum-analyzer (v7.91 ki gleda momentum) — ta identificira
// SOURCING OPPORTUNITIES (keywords, monitors, categories). Razlika od
// deal-source-profitability-analyzer (v7.89 ki decomposes profit) —
// ta generira ACTIONABLE sourcing plan.
//
// "Best source: Bolha (85/100, avg profit 45€). Keywords: 'PS5',
// 'iPhone 13', 'Samsung'. Gap: no Vinted monitor for moda. Add monitor:
// 'Vinted nakit < 50€'."
//
// GET+POST /api/ai/deal-sourcing-intelligence
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

interface BestSource {
  source: string;
  score: number; // 0-100
  avgProfit: number;
  dealCount: number;
  reasoning: string;
}

interface RecommendedKeyword {
  keyword: string;
  expectedROI: number; // 0-1000 %
  category: string;
}

interface RecommendedPriceRange {
  range: string;
  avgROI: number; // 0-1000 %
  dealFrequency: number; // 0-100
}

interface RecommendedCategory {
  category: string;
  opportunity: string;
  expectedProfit: number;
}

interface SourcingGap {
  gap: string;
  impact: string;
  recommendation: string;
}

interface NewMonitorRecommendation {
  name: string;
  source: string;
  searchUrl: string;
  keywords: string[];
  expectedDeals: number;
}

interface SourcingTimingAdvice {
  dayOfWeek: string;
  hourRange: string;
  dealQualityScore: number; // 0-100
}

interface Intelligence {
  bestSources: BestSource[];
  recommendedSearchKeywords: RecommendedKeyword[];
  recommendedPriceRanges: RecommendedPriceRange[];
  recommendedCategories: RecommendedCategory[];
  sourcingGaps: SourcingGap[];
  newMonitorRecommendations: NewMonitorRecommendation[];
  sourcingTimingAdvice: SourcingTimingAdvice[];
  competitorSourcingInsight: string;
  sourcingEfficiencyScore: number; // 0-100
}

interface DealSourcingIntelligenceResponse {
  ok: true;
  intelligence: Intelligence;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiIntelligenceResponse {
  intelligence?: {
    bestSources?: Array<{ source?: string; score?: number; avgProfit?: number; dealCount?: number; reasoning?: string }>;
    recommendedSearchKeywords?: Array<{ keyword?: string; expectedROI?: number; category?: string }>;
    recommendedPriceRanges?: Array<{ range?: string; avgROI?: number; dealFrequency?: number }>;
    recommendedCategories?: Array<{ category?: string; opportunity?: string; expectedProfit?: number }>;
    sourcingGaps?: Array<{ gap?: string; impact?: string; recommendation?: string }>;
    newMonitorRecommendations?: Array<{ name?: string; source?: string; searchUrl?: string; keywords?: string[]; expectedDeals?: number }>;
    sourcingTimingAdvice?: Array<{ dayOfWeek?: string; hourRange?: string; dealQualityScore?: number }>;
    competitorSourcingInsight?: string;
    sourcingEfficiencyScore?: number;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const ROI_MIN = 0;
const ROI_MAX = 1000;
const PROFIT_MIN = 0;
const PROFIT_MAX = 100_000;
const DEAL_FREQ_MIN = 0;
const DEAL_FREQ_MAX = 100;
const EXPECTED_DEALS_MIN = 0;
const EXPECTED_DEALS_MAX = 5000;

// --- Helpers -------------------------------------------------------------

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
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

// --- DB row types --------------------------------------------------------

interface SoldTradeRow {
  id: string;
  title: string;
  buyPrice: number;
  buyFees: number;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  sellLocation: string;
  category: string;
}

interface MonitorRow {
  id: string;
  name: string;
  source: string;
  sourceUrl: string;
  isActive: boolean;
  keywords: string;
  tags: string;
}

// --- Historical sourcing computation ------------------------------------

interface SourcingHistory {
  bySource: Map<string, { count: number; totalProfit: number; totalRevenue: number; totalCost: number; avgROI: number; avgProfit: number }>;
  byCategory: Map<string, { count: number; totalProfit: number; avgProfit: number; avgROI: number; titles: string[] }>;
  byPriceRange: Map<string, { count: number; totalProfit: number; avgROI: number }>;
  byDayOfWeek: Map<number, { count: number; avgProfit: number; totalProfit: number }>;
  byHour: Map<number, { count: number; avgProfit: number }>;
  topKeywords: Map<string, { count: number; avgProfit: number; avgROI: number; category: string }>;
  totalDeals: number;
  totalProfit: number;
}

function computeSourcingHistory(soldTrades: SoldTradeRow[]): SourcingHistory {
  const bySource = new Map<string, { count: number; totalProfit: number; totalRevenue: number; totalCost: number; avgROI: number; avgProfit: number }>();
  const byCategory = new Map<string, { count: number; totalProfit: number; avgProfit: number; avgROI: number; titles: string[] }>();
  const byPriceRange = new Map<string, { count: number; totalProfit: number; avgROI: number }>();
  const byDayOfWeek = new Map<number, { count: number; avgProfit: number; totalProfit: number }>();
  const byHour = new Map<number, { count: number; avgProfit: number }>();
  const topKeywords = new Map<string, { count: number; avgProfit: number; avgROI: number; category: string }>();

  let totalDeals = 0;
  let totalProfit = 0;

  for (const t of soldTrades) {
    const sellMs = toMs(t.sellDate);
    if (sellMs <= 0) continue;
    const sellPrice = t.sellPrice ?? 0;
    const sellFees = t.sellFees ?? 0;
    const buyPrice = t.buyPrice ?? 0;
    const buyFees = t.buyFees ?? 0;
    const revenue = sellPrice - sellFees;
    const cost = buyPrice + buyFees;
    const profit = revenue - cost;
    const roi = cost > 0 ? (profit / cost) * 100 : 0;
    const cat = (t.category || 'drugo').trim().toLowerCase() || 'drugo';
    const src = (t.sellLocation || 'neznano').trim().toLowerCase() || 'neznano';

    totalDeals += 1;
    totalProfit += profit;

    // By source
    const sEntry = bySource.get(src) || { count: 0, totalProfit: 0, totalRevenue: 0, totalCost: 0, avgROI: 0, avgProfit: 0 };
    sEntry.count += 1;
    sEntry.totalProfit += profit;
    sEntry.totalRevenue += revenue;
    sEntry.totalCost += cost;
    bySource.set(src, sEntry);

    // By category
    const cEntry = byCategory.get(cat) || { count: 0, totalProfit: 0, avgProfit: 0, avgROI: 0, titles: [] };
    cEntry.count += 1;
    cEntry.totalProfit += profit;
    if (cEntry.titles.length < 5) cEntry.titles.push(t.title || '');
    byCategory.set(cat, cEntry);

    // By price range (using buyPrice)
    let range = '0-50€';
    if (buyPrice >= 500) range = '500€+';
    else if (buyPrice >= 200) range = '200-500€';
    else if (buyPrice >= 100) range = '100-200€';
    else if (buyPrice >= 50) range = '50-100€';
    const pEntry = byPriceRange.get(range) || { count: 0, totalProfit: 0, avgROI: 0 };
    pEntry.count += 1;
    pEntry.totalProfit += profit;
    byPriceRange.set(range, pEntry);

    // By day of week (1=Mon, 7=Sun)
    const day = new Date(sellMs).getDay();
    const dayNorm = day === 0 ? 7 : day; // Sunday = 7
    const dEntry = byDayOfWeek.get(dayNorm) || { count: 0, avgProfit: 0, totalProfit: 0 };
    dEntry.count += 1;
    dEntry.totalProfit += profit;
    byDayOfWeek.set(dayNorm, dEntry);

    // By hour
    const hour = new Date(sellMs).getHours();
    const hEntry = byHour.get(hour) || { count: 0, avgProfit: 0 };
    hEntry.count += 1;
    byHour.set(hour, hEntry);

    // Top keywords: extract significant words from title
    const words = (t.title || '').toLowerCase()
      .replace(/[^a-z0-9čšž\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !['the', 'and', 'for', 'nov', 'nova', 'uporabljano', 'prodaja'].includes(w));
    for (const w of words.slice(0, 5)) {
      const kEntry = topKeywords.get(w) || { count: 0, avgProfit: 0, avgROI: 0, category: cat };
      kEntry.count += 1;
      kEntry.avgProfit += profit;
      topKeywords.set(w, kEntry);
    }
  }

  // Compute averages
  for (const [, s] of bySource) {
    s.avgProfit = s.count > 0 ? s.totalProfit / s.count : 0;
    s.avgROI = s.totalCost > 0 ? (s.totalProfit / s.totalCost) * 100 : 0;
  }
  for (const [, c] of byCategory) {
    c.avgProfit = c.count > 0 ? c.totalProfit / c.count : 0;
  }
  for (const [, d] of byDayOfWeek) {
    d.avgProfit = d.count > 0 ? d.totalProfit / d.count : 0;
  }
  for (const [, k] of topKeywords) {
    k.avgProfit = k.count > 0 ? k.avgProfit / k.count : 0;
  }

  return { bySource, byCategory, byPriceRange, byDayOfWeek, byHour, topKeywords, totalDeals, totalProfit };
}

// --- Deterministic intelligence ------------------------------------------

function buildBestSources(history: SourcingHistory): BestSource[] {
  const sources: BestSource[] = [];
  for (const [src, s] of history.bySource) {
    if (s.count === 0) continue;
    // Score: profit + ROI + volume (normalized)
    const profitScore = Math.max(0, Math.min(40, s.avgProfit / 2));
    const roiScore = Math.max(0, Math.min(30, s.avgROI / 5));
    const volumeScore = Math.max(0, Math.min(30, s.count));
    const score = round0(profitScore + roiScore + volumeScore);
    sources.push({
      source: src,
      score: round0(Math.max(SCORE_MIN, Math.min(SCORE_MAX, score))),
      avgProfit: round0(s.avgProfit),
      dealCount: s.count,
      reasoning: `Vir ${src}: ${s.count} deal-ov, avg profit ${round0(s.avgProfit)}€, avg ROI ${round0(s.avgROI)}%. Score sestavljen iz profit/ROI/volume.`,
    });
  }
  sources.sort((a, b) => b.score - a.score);
  return sources.slice(0, 5);
}

function buildRecommendedKeywords(history: SourcingHistory): RecommendedKeyword[] {
  const keywords: RecommendedKeyword[] = [];
  for (const [kw, k] of history.topKeywords) {
    if (k.count < 1) continue;
    const expectedROI = round0(Math.max(ROI_MIN, Math.min(ROI_MAX, k.avgProfit * 0.5)));
    keywords.push({
      keyword: kw,
      expectedROI,
      category: k.category,
    });
  }
  keywords.sort((a, b) => b.expectedROI - a.expectedROI);
  return keywords.slice(0, 8);
}

function buildRecommendedPriceRanges(history: SourcingHistory): RecommendedPriceRange[] {
  const ranges: RecommendedPriceRange[] = [];
  for (const [range, r] of history.byPriceRange) {
    if (r.count === 0) continue;
    const avgProfit = r.totalProfit / r.count;
    const avgROI = avgProfit > 0 ? Math.min(ROI_MAX, avgProfit * 2) : 0;
    const dealFrequency = Math.min(DEAL_FREQ_MAX, r.count);
    ranges.push({
      range,
      avgROI: round0(avgROI),
      dealFrequency: round0(dealFrequency),
    });
  }
  ranges.sort((a, b) => b.avgROI - a.avgROI);
  return ranges.slice(0, 5);
}

function buildRecommendedCategories(history: SourcingHistory): RecommendedCategory[] {
  const categories: RecommendedCategory[] = [];
  for (const [cat, c] of history.byCategory) {
    if (c.count === 0) continue;
    categories.push({
      category: cat,
      opportunity: c.avgProfit > 30 ? 'HIGH_VALUE' : c.avgProfit > 10 ? 'STABLE' : 'LOW_MARGIN',
      expectedProfit: round0(c.avgProfit),
    });
  }
  categories.sort((a, b) => b.expectedProfit - a.expectedProfit);
  return categories.slice(0, 8);
}

function buildSourcingGaps(history: SourcingHistory, monitors: MonitorRow[]): SourcingGap[] {
  const gaps: SourcingGap[] = [];
  const activeSources = new Set(monitors.filter((m) => m.isActive).map((m) => m.source.toLowerCase()));
  const knownSources = new Set(['bolha', 'vinted', 'avtonet', 'mobile-de', 'kleinanzeigen', 'subito', 'willhaben']);

  // Gap 1: Best source not monitored
  for (const [src, s] of history.bySource) {
    if (s.count >= 3 && s.avgProfit > 30 && !activeSources.has(src) && knownSources.has(src)) {
      gaps.push({
        gap: `Vir "${src}" je high-profit (avg ${round0(s.avgProfit)}€) ampak ni aktivno monitoriran.`,
        impact: `${s.count} zgodovinskih deal-ov iz tega vira, povprečno ${round0(s.avgProfit)}€ profit/deal.`,
        recommendation: `Dodaj aktiven monitor za vir "${src}" za ${round0(s.avgProfit * 5)}€ potencial profit/mo.`,
      });
    }
  }

  // Gap 2: Best category not monitored
  const monitoredCats = new Set<string>();
  for (const m of monitors) {
    if (m.isActive && m.tags) {
      for (const tag of m.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)) {
        monitoredCats.add(tag);
      }
    }
  }
  for (const [cat, c] of history.byCategory) {
    if (c.count >= 3 && c.avgProfit > 30 && !monitoredCats.has(cat)) {
      gaps.push({
        gap: `Kategorija "${cat}" je high-profit ampak ni monitorirana.`,
        impact: `${c.count} zgodovinskih deal-ov v tej kategoriji, povprečno ${round0(c.avgProfit)}€ profit/deal.`,
        recommendation: `Dodaj monitor za kategorijo "${cat}" z ustrezno iskalno URL.`,
      });
    }
  }

  // Gap 3: No active monitors at all
  if (monitors.filter((m) => m.isActive).length === 0) {
    gaps.push({
      gap: 'Ni aktivnih monitorjev.',
      impact: 'Brez aktivnih monitorjev ne bo novih deal-ov.',
      recommendation: 'Aktiviraj vsaj 3 monitorje za top 3 vire.',
    });
  }

  // Gap 4: Missing major sources
  for (const knownSrc of knownSources) {
    if (!activeSources.has(knownSrc)) {
      gaps.push({
        gap: `Glavni vir "${knownSrc}" ni monitoriran.`,
        impact: 'Zamujajo se potencialni deal-i iz tega vira.',
        recommendation: `Dodaj monitor za "${knownSrc}" z glavnimi keywords.`,
      });
    }
  }

  return gaps.slice(0, 5);
}

function buildNewMonitorRecommendations(history: SourcingHistory, monitors: MonitorRow[]): NewMonitorRecommendation[] {
  const recs: NewMonitorRecommendation[] = [];
  const activeSources = new Set(monitors.filter((m) => m.isActive).map((m) => m.source.toLowerCase()));

  // Recommend new monitor for top unmonitored source
  const sortedSources = Array.from(history.bySource.entries())
    .filter(([src, s]) => s.count >= 2 && s.avgProfit > 20)
    .sort(([, a], [, b]) => b.avgProfit - a.avgProfit);

  for (const [src, s] of sortedSources.slice(0, 2)) {
    const searchUrl = src === 'bolha' ? 'https://www.bolha.com/iskanje?q='
      : src === 'vinted' ? 'https://www.vinted.si/catalog'
      : src === 'avtonet' ? 'https://www.avtonet.si/'
      : src === 'mobile-de' ? 'https://suchen.mobile.de/fahrzeuge/search.html'
      : 'https://example.com/search?q=';
    const keywords = Array.from(history.topKeywords.entries())
      .filter(([_, k]) => k.category === src || k.count >= 2)
      .sort((a, b) => b[1].avgProfit - a[1].avgProfit)
      .slice(0, 3)
      .map(([kw]) => kw);
    recs.push({
      name: `${src} — top profit vir`,
      source: src,
      searchUrl,
      keywords: keywords.length > 0 ? keywords : ['ps5', 'iphone', 'samsung'],
      expectedDeals: round0(Math.min(EXPECTED_DEALS_MAX, Math.max(5, s.count / 6))),
    });
  }

  // Recommend monitor for known but unmonitored source
  const knownSources = ['bolha', 'vinted', 'avtonet', 'mobile-de', 'kleinanzeigen', 'subito', 'willhaben'];
  for (const src of knownSources) {
    if (recs.length >= 4) break;
    if (!activeSources.has(src)) {
      const searchUrl = src === 'bolha' ? 'https://www.bolha.com/iskanje?q='
        : src === 'vinted' ? 'https://www.vinted.si/catalog'
        : src === 'avtonet' ? 'https://www.avtonet.si/'
        : src === 'mobile-de' ? 'https://suchen.mobile.de/fahrzeuge/search.html'
        : 'https://example.com/search?q=';
      recs.push({
        name: `Nov monitor: ${src}`,
        source: src,
        searchUrl,
        keywords: ['ps5', 'iphone', 'samsung'],
        expectedDeals: 5,
      });
    }
  }

  return recs.slice(0, 4);
}

function buildSourcingTimingAdvice(history: SourcingHistory): SourcingTimingAdvice[] {
  const days = ['Pon', 'Tor', 'Sre', 'Čet', 'Pet', 'Sob', 'Ned'];
  const advice: SourcingTimingAdvice[] = [];
  for (let day = 1; day <= 7; day++) {
    const d = history.byDayOfWeek.get(day);
    if (!d || d.count === 0) continue;
    const overallAvg = history.totalDeals > 0 ? history.totalProfit / history.totalDeals : 0;
    const quality = overallAvg > 0 ? Math.min(100, Math.max(0, (d.avgProfit / overallAvg) * 50)) : 50;
    advice.push({
      dayOfWeek: days[day - 1] || `Dan ${day}`,
      hourRange: '18:00-22:00',
      dealQualityScore: round0(quality),
    });
  }
  advice.sort((a, b) => b.dealQualityScore - a.dealQualityScore);
  return advice.slice(0, 5);
}

function buildSourcingEfficiencyScore(history: SourcingHistory, monitors: MonitorRow[]): number {
  // Score: 0-100 — višji = bolj efficient sourcing
  // Factors: activeMonitors (0-30), source diversity (0-25), avg profit per deal (0-25), keyword coverage (0-20)
  const activeMonitorCount = monitors.filter((m) => m.isActive).length;
  const monitorScore = Math.min(30, activeMonitorCount * 5);

  const sourceDiversity = Math.min(25, history.bySource.size * 5);
  const avgProfit = history.totalDeals > 0 ? history.totalProfit / history.totalDeals : 0;
  const profitScore = Math.min(25, Math.max(0, avgProfit / 2));

  const keywordCoverage = Math.min(20, history.topKeywords.size);

  return round0(Math.max(SCORE_MIN, Math.min(SCORE_MAX, monitorScore + sourceDiversity + profitScore + keywordCoverage)));
}

function buildDeterministicIntelligence(history: SourcingHistory, monitors: MonitorRow[]): Intelligence {
  return {
    bestSources: buildBestSources(history),
    recommendedSearchKeywords: buildRecommendedKeywords(history),
    recommendedPriceRanges: buildRecommendedPriceRanges(history),
    recommendedCategories: buildRecommendedCategories(history),
    sourcingGaps: buildSourcingGaps(history, monitors),
    newMonitorRecommendations: buildNewMonitorRecommendations(history, monitors),
    sourcingTimingAdvice: buildSourcingTimingAdvice(history),
    competitorSourcingInsight: 'Konkurenti aktivno monitorirajo Bolha in Vinted z avtomatiziranimi alerti. Povečaj svojo pokritost virov za ohranitev konkurenčne prednosti.',
    sourcingEfficiencyScore: buildSourcingEfficiencyScore(history, monitors),
  };
}

function buildSummary(intelligence: Intelligence, history: SourcingHistory): string {
  if (history.totalDeals === 0) {
    return 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Sourcing Intelligence ni mogoč.';
  }
  const top = intelligence.bestSources[0];
  const parts: string[] = [
    `${history.totalDeals} SOLD deal-ov analiziranih. Score: ${intelligence.sourcingEfficiencyScore}/100.`,
  ];
  if (top) {
    parts.push(`Best source: ${top.source} (${top.score}/100, avg profit ${top.avgProfit}€).`);
  }
  const topKeyword = intelligence.recommendedSearchKeywords[0];
  if (topKeyword) {
    parts.push(`Keyword: "${topKeyword.keyword}" (ROI ${topKeyword.expectedROI}%).`);
  }
  if (intelligence.sourcingGaps.length > 0) {
    parts.push(`Gap: ${intelligence.sourcingGaps[0]!.gap.slice(0, 80)}.`);
  }
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleDealSourcingIntelligence(req);
}
export async function POST(req: NextRequest) {
  return handleDealSourcingIntelligence(req);
}

async function handleDealSourcingIntelligence(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-deal-sourcing-intelligence', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const cutoff12m = new Date(now - HORIZON_12M);

    // 1) Query SOLD trades for sourcing history
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
      },
      select: {
        id: true,
        title: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        sellLocation: true,
        category: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    // 2) Query all monitors for sourcing coverage
    const monitors = await db.monitor.findMany({
      select: {
        id: true,
        name: true,
        source: true,
        sourceUrl: true,
        isActive: true,
        keywords: true,
        tags: true,
      },
      take: 10000,
    }) as unknown as MonitorRow[];

    // Empty-state: no SOLD trades
    if (soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        intelligence: {
          bestSources: [],
          recommendedSearchKeywords: [],
          recommendedPriceRanges: [],
          recommendedCategories: [],
          sourcingGaps: [{
            gap: 'Ni SOLD trgovin v zadnjih 12 mesecih.',
            impact: 'Brez zgodovine prodaj ni mogoče določiti best sources.',
            recommendation: 'Začni kupovati in prodajati da zbereš sourcing data.',
          }],
          newMonitorRecommendations: [],
          sourcingTimingAdvice: [],
          competitorSourcingInsight: 'Ni podatkov o konkurenčnem sourcing-u.',
          sourcingEfficiencyScore: 0,
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Sourcing Intelligence ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Sourcing Intelligence ni mogoč.',
      } satisfies DealSourcingIntelligenceResponse);
    }

    // 3) Compute sourcing history
    const history = computeSourcingHistory(soldTrades);

    // 4) Build deterministic intelligence
    let intelligence = buildDeterministicIntelligence(history, monitors);
    let summary = buildSummary(intelligence, history);

    // 5) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    const cacheKey = `deal-sourcing-intelligence:${currentMonth}`;
    const cached = getCachedAI<{ intelligence: Intelligence; summary: string }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        intelligence: cached.intelligence,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies DealSourcingIntelligenceResponse);
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
      sourcingHistory: {
        totalDeals: history.totalDeals,
        totalProfit: round0(history.totalProfit),
        bySource: Array.from(history.bySource.entries()).slice(0, 10).map(([src, s]) => ({
          source: src, count: s.count, avgProfit: round0(s.avgProfit), avgROI: round0(s.avgROI),
        })),
        byCategory: Array.from(history.byCategory.entries()).slice(0, 10).map(([cat, c]) => ({
          category: cat, count: c.count, avgProfit: round0(c.avgProfit),
        })),
        topKeywords: Array.from(history.topKeywords.entries()).slice(0, 15).map(([kw, k]) => ({
          keyword: kw, count: k.count, avgProfit: round0(k.avgProfit), category: k.category,
        })),
      },
      monitorCoverage: {
        activeCount: monitors.filter((m) => m.isActive).length,
        totalCount: monitors.length,
        bySource: Array.from(new Set(monitors.map((m) => m.source))).map((src) => ({
          source: src,
          activeCount: monitors.filter((m) => m.source === src && m.isActive).length,
        })),
      },
      deterministic: intelligence,
      caps: {
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        roiMin: ROI_MIN, roiMax: ROI_MAX,
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        dealFreqMin: DEAL_FREQ_MIN, dealFreqMax: DEAL_FREQ_MAX,
        expectedDealsMin: EXPECTED_DEALS_MIN, expectedDealsMax: EXPECTED_DEALS_MAX,
      },
    };

    const prompt = `Si AI "Deal Sourcing Intelligence" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Ti identificiraš NAJBOLJŠE vire za iskanje novih deal-ov — kje iskati, katere ključne besede, kateri monitorji za dodati, katere kategorije so zrele za sourcing. Razlika od sourcing (basic suggestions) — ti si INTELLIGENCE o tem KODI deal-i prihajajo in kje najti več.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD 12m za sourcing patterns + aktivni monitorji za coverage):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. intelligence.bestSources: 3-5 najboljših virov { source (max 50), score 0-100 (±10 od deterministic), avgProfit € [0, 100000], dealCount, reasoning (max 200, slovenski) }.
2. intelligence.recommendedSearchKeywords: 5-8 ključnih besed iz zgodovinskih winner-jev { keyword (max 50), expectedROI 0-1000 %, category (max 50) }.
3. intelligence.recommendedPriceRanges: 3-5 price ranges { range (max 30, npr. "100-200€"), avgROI 0-1000 %, dealFrequency 0-100 }.
4. intelligence.recommendedCategories: 3-8 kategorij zrelih za sourcing { category (max 50), opportunity (max 100), expectedProfit € [0, 100000] }.
5. intelligence.sourcingGaps: 2-5 vrzeli v trenutni sourcing strategiji { gap (max 200), impact (max 200), recommendation (max 200) }.
6. intelligence.newMonitorRecommendations: 2-4 specifični monitorji za setup { name (max 100), source (max 30), searchUrl (max 200), keywords string[] (max 5), expectedDeals [0, 5000] }.
7. intelligence.sourcingTimingAdvice: 3-5 timing priporočil { dayOfWeek (max 10, npr. "Pon"), hourRange (max 20, npr. "18:00-22:00"), dealQualityScore 0-100 }.
8. intelligence.competitorSourcingInsight: slovenski tekst (max 400) — kje konkurenti iščejo deal-e in kako pridobiti prednost.
9. intelligence.sourcingEfficiencyScore: 0-100 (±10 od deterministic).
10. summary: slovenski povzetek (max 400 znakov). NE izmišljuj virov ali keyword-ov — uporabi deterministic baseline.

VRNI LE JSON:
{
  "intelligence": {
    "bestSources": [
      { "source": "bolha", "score": 85, "avgProfit": 45, "dealCount": 18, "reasoning": "Bolha je najboljši vir z 18 deal-i in povprečjem 45€." }
    ],
    "recommendedSearchKeywords": [
      { "keyword": "ps5", "expectedROI": 250, "category": "elektronika" }
    ],
    "recommendedPriceRanges": [
      { "range": "100-200€", "avgROI": 180, "dealFrequency": 25 }
    ],
    "recommendedCategories": [
      { "category": "elektronika", "opportunity": "HIGH_VALUE", "expectedProfit": 55 }
    ],
    "sourcingGaps": [
      { "gap": "Vinted za modo ni monitoriran.", "impact": "Manjkajoči deal-i iz mode.", "recommendation": "Dodaj monitor 'Vinted moda < 50€'." }
    ],
    "newMonitorRecommendations": [
      { "name": "Vinted nakit < 50€", "source": "vinted", "searchUrl": "https://www.vinted.si/catalog", "keywords": ["nakit", "ura", "verizica"], "expectedDeals": 8 }
    ],
    "sourcingTimingAdvice": [
      { "dayOfWeek": "Sob", "hourRange": "18:00-22:00", "dealQualityScore": 75 }
    ],
    "competitorSourcingInsight": "Konkurenti aktivno monitorirajo Bolha z avtomatiziranimi alerti. Povečaj pokritost z monitorji za Vinted in Avtonet.",
    "sourcingEfficiencyScore": 68
  },
  "summary": "18 SOLD deal-ov analiziranih. Score: 68/100. Best source: bolha (85/100, avg 45€). Gap: Vinted za modo manjka."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiIntelligenceResponse | null;

      if (parsed && parsed.intelligence && typeof parsed.intelligence === 'object') {
        const ai = parsed.intelligence;
        const det = intelligence;

        // bestSources — only accept sources that exist in deterministic OR are known sources
        const knownSources = new Set(Array.from(history.bySource.keys()).concat(['bolha', 'vinted', 'avtonet', 'mobile-de', 'kleinanzeigen', 'subito', 'willhaben']));
        const bestSources: BestSource[] = [];
        if (Array.isArray(ai.bestSources)) {
          for (const s of ai.bestSources.slice(0, 5)) {
            if (!s || typeof s !== 'object') continue;
            const src = clampString(s.source, 50, 'neznano').toLowerCase();
            if (!knownSources.has(src)) continue; // anti-hallucination
            const detScore = det.bestSources.find((b) => b.source === src)?.score ?? 50;
            bestSources.push({
              source: src,
              score: round0(clampNum(s.score, SCORE_MIN, SCORE_MAX, detScore + Math.max(-10, Math.min(10, (Number(s.score) || detScore) - detScore)))),
              avgProfit: round0(clampNum(s.avgProfit, PROFIT_MIN, PROFIT_MAX, det.bestSources.find((b) => b.source === src)?.avgProfit ?? 0)),
              dealCount: round0(clampNum(s.dealCount, 0, 100000, det.bestSources.find((b) => b.source === src)?.dealCount ?? 0)),
              reasoning: clampString(s.reasoning, 200, det.bestSources.find((b) => b.source === src)?.reasoning ?? `Vir ${src}.`),
            });
          }
        }
        if (bestSources.length === 0) bestSources.push(...det.bestSources);

        // recommendedSearchKeywords — only from known historical keywords
        const knownKeywords = new Set(history.topKeywords.keys());
        const recommendedSearchKeywords: RecommendedKeyword[] = [];
        if (Array.isArray(ai.recommendedSearchKeywords)) {
          for (const k of ai.recommendedSearchKeywords.slice(0, 8)) {
            if (!k || typeof k !== 'object') continue;
            const kw = clampString(k.keyword, 50, '').toLowerCase();
            if (!kw) continue;
            // Accept if from history OR generic tech keyword (allow slight generalization)
            const isKnown = knownKeywords.has(kw);
            const detKw = det.recommendedSearchKeywords.find((r) => r.keyword === kw);
            if (!isKnown && !detKw) continue; // anti-hallucination: only known keywords
            const cat = detKw?.category || clampString(k.category, 50, 'drugo');
            recommendedSearchKeywords.push({
              keyword: kw,
              expectedROI: round0(clampNum(k.expectedROI, ROI_MIN, ROI_MAX, detKw?.expectedROI ?? 50)),
              category: cat,
            });
          }
        }
        if (recommendedSearchKeywords.length === 0) recommendedSearchKeywords.push(...det.recommendedSearchKeywords);

        // recommendedPriceRanges
        const recommendedPriceRanges: RecommendedPriceRange[] = [];
        if (Array.isArray(ai.recommendedPriceRanges)) {
          const knownRanges = new Set(history.byPriceRange.keys());
          for (const r of ai.recommendedPriceRanges.slice(0, 5)) {
            if (!r || typeof r !== 'object') continue;
            const range = clampString(r.range, 30, '');
            if (!range || !knownRanges.has(range)) {
              // Accept ranges that match known format
              const detRange = det.recommendedPriceRanges.find((p) => p.range === range);
              if (!detRange) continue;
            }
            const detRange = det.recommendedPriceRanges.find((p) => p.range === range);
            recommendedPriceRanges.push({
              range,
              avgROI: round0(clampNum(r.avgROI, ROI_MIN, ROI_MAX, detRange?.avgROI ?? 50)),
              dealFrequency: round0(clampNum(r.dealFrequency, DEAL_FREQ_MIN, DEAL_FREQ_MAX, detRange?.dealFrequency ?? 10)),
            });
          }
        }
        if (recommendedPriceRanges.length === 0) recommendedPriceRanges.push(...det.recommendedPriceRanges);

        // recommendedCategories
        const recommendedCategories: RecommendedCategory[] = [];
        if (Array.isArray(ai.recommendedCategories)) {
          const knownCats = new Set(history.byCategory.keys());
          for (const c of ai.recommendedCategories.slice(0, 8)) {
            if (!c || typeof c !== 'object') continue;
            const cat = clampString(c.category, 50, '').toLowerCase();
            if (!cat || !knownCats.has(cat)) continue; // anti-hallucination: only known categories
            const detCat = det.recommendedCategories.find((rc) => rc.category === cat);
            recommendedCategories.push({
              category: cat,
              opportunity: clampString(c.opportunity, 100, detCat?.opportunity ?? 'STABLE'),
              expectedProfit: round0(clampNum(c.expectedProfit, PROFIT_MIN, PROFIT_MAX, detCat?.expectedProfit ?? 0)),
            });
          }
        }
        if (recommendedCategories.length === 0) recommendedCategories.push(...det.recommendedCategories);

        // sourcingGaps
        const sourcingGaps: SourcingGap[] = [];
        if (Array.isArray(ai.sourcingGaps)) {
          for (const g of ai.sourcingGaps.slice(0, 5)) {
            if (!g || typeof g !== 'object') continue;
            sourcingGaps.push({
              gap: clampString(g.gap, 200, det.sourcingGaps[0]?.gap ?? 'Sourcing gap identificiran.'),
              impact: clampString(g.impact, 200, det.sourcingGaps[0]?.impact ?? 'Vpliv na sourcing.'),
              recommendation: clampString(g.recommendation, 200, det.sourcingGaps[0]?.recommendation ?? 'Priporočilo za izboljšanje.'),
            });
          }
        }
        if (sourcingGaps.length === 0) sourcingGaps.push(...det.sourcingGaps);

        // newMonitorRecommendations
        const newMonitorRecommendations: NewMonitorRecommendation[] = [];
        if (Array.isArray(ai.newMonitorRecommendations)) {
          for (const m of ai.newMonitorRecommendations.slice(0, 4)) {
            if (!m || typeof m !== 'object') continue;
            const source = clampString(m.source, 30, 'bolha').toLowerCase();
            if (!knownSources.has(source)) continue; // anti-hallucination
            const kws = Array.isArray(m.keywords)
              ? m.keywords.slice(0, 5).filter((k: unknown) => typeof k === 'string').map((k: unknown) => String(k).slice(0, 50))
              : [];
            newMonitorRecommendations.push({
              name: clampString(m.name, 100, `Nov monitor: ${source}`),
              source,
              searchUrl: clampString(m.searchUrl, 200, ''),
              keywords: kws.length > 0 ? kws : ['ps5', 'iphone'],
              expectedDeals: round0(clampNum(m.expectedDeals, EXPECTED_DEALS_MIN, EXPECTED_DEALS_MAX, 5)),
            });
          }
        }
        if (newMonitorRecommendations.length === 0) newMonitorRecommendations.push(...det.newMonitorRecommendations);

        // sourcingTimingAdvice
        const sourcingTimingAdvice: SourcingTimingAdvice[] = [];
        if (Array.isArray(ai.sourcingTimingAdvice)) {
          for (const t of ai.sourcingTimingAdvice.slice(0, 5)) {
            if (!t || typeof t !== 'object') continue;
            sourcingTimingAdvice.push({
              dayOfWeek: clampString(t.dayOfWeek, 10, 'Pon'),
              hourRange: clampString(t.hourRange, 20, '18:00-22:00'),
              dealQualityScore: round0(clampNum(t.dealQualityScore, SCORE_MIN, SCORE_MAX, 50)),
            });
          }
        }
        if (sourcingTimingAdvice.length === 0) sourcingTimingAdvice.push(...det.sourcingTimingAdvice);

        const detScore = det.sourcingEfficiencyScore;
        const sourcingEfficiencyScore = round0(
          Math.max(SCORE_MIN, Math.min(SCORE_MAX,
            detScore + Math.max(-10, Math.min(10,
              (Number(ai.sourcingEfficiencyScore ?? detScore)) - detScore)))),
        );

        intelligence = {
          bestSources,
          recommendedSearchKeywords,
          recommendedPriceRanges,
          recommendedCategories,
          sourcingGaps,
          newMonitorRecommendations,
          sourcingTimingAdvice,
          competitorSourcingInsight: clampString(ai.competitorSourcingInsight, 400, det.competitorSourcingInsight),
          sourcingEfficiencyScore,
        };
        summary = clampString(parsed.summary, 400, buildSummary(intelligence, history));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/deal-sourcing-intelligence',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { intelligence, summary });
    }

    return NextResponse.json({
      ok: true,
      intelligence,
      summary,
      aiUsed,
    } satisfies DealSourcingIntelligenceResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/deal-sourcing-intelligence',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
