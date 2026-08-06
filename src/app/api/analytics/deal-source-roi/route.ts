// v7.58: Deal Source ROI Analyzer — katera PLATFORMA (Bolha, Vinted, Facebook,
// mobile.de, Avtonet, ...) prinaša najboljši FINANČNI ROI pri nakupu?
//
// Razlikuje se od source-quality (ki ocenjuje monitore po listing quality),
// ker ta analiza gleda dejansko FINANČNO uspešnost (profit, ROI, winRate)
// opravljenih trgovin razdeljenih po viru nakupa.
//
// "Bolha: 35% ROI (12 trgovin), Vinted: 18% ROI (8 trgovin) → kupuj več na Bolhi"
//
// GET /api/analytics/deal-source-roi

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;

// Mapping source (monitor.source) → display name
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
};

// Normalize buyLocation string to a known source key.
// buyLocation is free-form ("Bolha", "FB", "Vinted", "Facebook Marketplace", ...)
function normalizeBuyLocation(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return 'unknown';
  if (s.includes('bolha')) return 'bolha';
  if (s.includes('vinted')) return 'vinted';
  if (s.includes('face') || s === 'fb' || s.includes('marketplace')) return 'facebook';
  if (s.includes('avtonet')) return 'avtonet';
  if (s.includes('mobile.de') || s.includes('mobilede')) return 'mobilede';
  if (s.includes('kleinan')) return 'kleinanzeigen';
  if (s.includes('subito')) return 'subito';
  if (s.includes('willhaben')) return 'willhaben';
  if (s.includes('nepremicn')) return 'nepremicnine';
  if (s.includes('salomon')) return 'salomon';
  return 'unknown';
}

function displayName(source: string): string {
  return SOURCE_DISPLAY[source] ?? (source.charAt(0).toUpperCase() + source.slice(1));
}

interface SourceRow {
  source: string;
  displayName: string;
  totalTrades: number;
  totalInvested: number;
  totalRevenue: number;
  totalProfit: number;
  avgROI: number;
  avgHoldDays: number;
  winRate: number;
  avgDealScore: number;
  bestCategory: string;
  categories: Array<{ category: string; trades: number; profit: number; roi: number }>;
}

interface MatrixRow {
  source: string;
  category: string;
  trades: number;
  profit: number;
  roi: number;
}

export async function GET() {
  try {
    // 1) Query all SOLD trades with their linked Listing (to get monitor.source)
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        sellDate: { not: null },
      },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        buyLocation: true,
        listing: {
          select: {
            id: true,
            dealScore: true,
            monitor: {
              select: { source: true },
            },
          },
        },
      },
      take: 2000,
    });

    if (soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        sources: [],
        matrix: [],
        recommendation: { bestSource: null, worstSource: null, reasoning: 'Ni prodanih trgovin.' },
        summary: { totalSources: 0, totalTrades: 0, totalProfit: 0 },
        message: 'Ni prodanih trgovin — analiziraj znova ko bo vsaj 1 prodaja.',
      });
    }

    // 2) Per-source aggregation
    interface SourceAgg {
      source: string;
      trades: number;
      totalInvested: number;
      totalRevenue: number;
      totalProfit: number;
      holdDaysSum: number;
      holdDaysCount: number;
      wins: number;
      dealScoreSum: number;
      dealScoreCount: number;
      // category breakdown
      categories: Map<string, { trades: number; profit: number; invested: number }>;
    }

    const sourceAgg = new Map<string, SourceAgg>();

    for (const t of soldTrades) {
      // Determine source: prefer listing.monitor.source, fallback to buyLocation
      const monitorSource = t.listing?.monitor?.source;
      const source = monitorSource && monitorSource.trim() !== ''
        ? monitorSource.trim().toLowerCase()
        : normalizeBuyLocation(t.buyLocation);

      const buyFees = t.buyFees ?? 0;
      const sellFees = t.sellFees ?? 0;
      const sellPrice = t.sellPrice ?? 0;
      const invested = t.buyPrice + buyFees;
      const revenue = sellPrice - sellFees;
      const profit = revenue - invested;

      const holdDays = (new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / DAY_MS;
      const holdDaysValid = holdDays >= 0 && Number.isFinite(holdDays);

      const category = (t.category && t.category.trim() !== '') ? t.category.trim() : 'drugo';

      let agg = sourceAgg.get(source);
      if (!agg) {
        agg = {
          source,
          trades: 0,
          totalInvested: 0,
          totalRevenue: 0,
          totalProfit: 0,
          holdDaysSum: 0,
          holdDaysCount: 0,
          wins: 0,
          dealScoreSum: 0,
          dealScoreCount: 0,
          categories: new Map(),
        };
        sourceAgg.set(source, agg);
      }

      agg.trades += 1;
      agg.totalInvested += invested;
      agg.totalRevenue += revenue;
      agg.totalProfit += profit;
      if (holdDaysValid) {
        agg.holdDaysSum += holdDays;
        agg.holdDaysCount += 1;
      }
      if (profit > 0) agg.wins += 1;
      if (t.listing?.dealScore != null) {
        agg.dealScoreSum += t.listing.dealScore;
        agg.dealScoreCount += 1;
      }

      const cat = agg.categories.get(category) || { trades: 0, profit: 0, invested: 0 };
      cat.trades += 1;
      cat.profit += profit;
      cat.invested += invested;
      agg.categories.set(category, cat);
    }

    // 3) Build source rows + matrix
    const sources: SourceRow[] = [];
    const matrix: MatrixRow[] = [];

    for (const [, agg] of sourceAgg) {
      const avgROI = agg.totalInvested > 0
        ? Math.round((agg.totalProfit / agg.totalInvested) * 1000) / 10
        : 0;
      const avgHoldDays = agg.holdDaysCount > 0
        ? Math.round(agg.holdDaysSum / agg.holdDaysCount)
        : 0;
      const winRate = agg.trades > 0
        ? Math.round((agg.wins / agg.trades) * 1000) / 10
        : 0;
      const avgDealScore = agg.dealScoreCount > 0
        ? Math.round(agg.dealScoreSum / agg.dealScoreCount)
        : 0;

      // Best category: highest profit
      const catEntries = Array.from(agg.categories.entries()).map(([cat, d]) => ({
        category: cat,
        trades: d.trades,
        profit: Math.round(d.profit),
        roi: d.invested > 0 ? Math.round((d.profit / d.invested) * 1000) / 10 : 0,
      }));
      catEntries.sort((a, b) => b.profit - a.profit);
      const bestCategory = catEntries.length > 0 ? catEntries[0].category : 'drugo';

      sources.push({
        source: agg.source,
        displayName: displayName(agg.source),
        totalTrades: agg.trades,
        totalInvested: Math.round(agg.totalInvested),
        totalRevenue: Math.round(agg.totalRevenue),
        totalProfit: Math.round(agg.totalProfit),
        avgROI,
        avgHoldDays,
        winRate,
        avgDealScore,
        bestCategory,
        categories: catEntries,
      });

      // Add to matrix
      for (const c of catEntries) {
        matrix.push({
          source: agg.source,
          category: c.category,
          trades: c.trades,
          profit: c.profit,
          roi: c.roi,
        });
      }
    }

    // 4) Rank sources by avgROI desc (only with trades >= 1, all qualify)
    sources.sort((a, b) => b.avgROI - a.avgROI);

    // 5) Recommendation: best source (highest ROI with >= 2 trades) and worst (lowest ROI)
    const ranked = sources.filter(s => s.totalTrades >= 1);
    const bestSource = ranked.length > 0 ? ranked[0] : null;
    // Worst = lowest ROI (most negative or smallest positive). Reverse sort last.
    const worstSource = ranked.length > 0 ? ranked[ranked.length - 1] : null;

    let reasoning = 'Ni dovolj podatkov za priporočilo.';
    if (bestSource && worstSource && ranked.length >= 1) {
      if (bestSource.source === worstSource.source) {
        reasoning = `Edini vir: ${bestSource.displayName} (${bestSource.avgROI}% ROI, ${bestSource.totalTrades} trgovin).`;
      } else {
        reasoning =
          `Najboljši vir: ${bestSource.displayName} (${bestSource.avgROI}% ROI, ${bestSource.totalTrades} trgovin, ` +
          `winRate ${bestSource.winRate}%). Najšibkejši: ${worstSource.displayName} (${worstSource.avgROI}% ROI, ${worstSource.totalTrades} trgovin). ` +
          `→ kupuj več na ${bestSource.displayName}.`;
      }
    } else if (bestSource) {
      reasoning = `Najboljši vir: ${bestSource.displayName} (${bestSource.avgROI}% ROI, ${bestSource.totalTrades} trgovin).`;
    }

    // 6) Summary
    const totalTrades = sources.reduce((s, x) => s + x.totalTrades, 0);
    const totalProfit = sources.reduce((s, x) => s + x.totalProfit, 0);

    return NextResponse.json({
      ok: true,
      sources,
      matrix,
      recommendation: {
        bestSource: bestSource ? bestSource.source : null,
        worstSource: worstSource ? worstSource.source : null,
        reasoning,
      },
      summary: {
        totalSources: sources.length,
        totalTrades,
        totalProfit: Math.round(totalProfit),
      },
    });
  } catch (err: any) {
    logger.error('/api/analytics/deal-source-roi', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
