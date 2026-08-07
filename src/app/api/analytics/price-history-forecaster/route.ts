// v7.66: Price History Forecaster — uporablja zgodovinske cenovne podatke
// (90 dni) za napoved cenovnih gibanj po kategorijah. Pure DB analytics
// s statistično projekcijo (linearna regresija) — NO AI. Prikaz trend linije
// in predvidene smeri (RISING/STABLE/FALLING).
//
// "Elektronika: -8% v 4 tednih, forecast FALLING → dober čas za nakup.
//  Moda: +12% → prodi zdaj."
//
// Razlika od market-trend (ki gleda rising/falling counts v zadnjem obdobju)
// — ta računa LINEARNO REGRESIJO na tedenskih povprečjih (13 tednov) in
// PROJICIRA ceno čez 30 dni (forecast30d) z confidence score-om. Razlika
// od listings/[id]/price-forecast (ki napove ceno za EN listing) — ta
// napove gibanje CELE KATEGORIJE z BUY/SELL/HOLD priporočilom.
//
// Pure DB analytics (NO AI). GET /api/analytics/price-history-forecaster

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type ForecastDirection = 'RISING' | 'STABLE' | 'FALLING';
type Recommendation =
  | 'GOOD_TIME_TO_BUY'
  | 'GOOD_TIME_TO_SELL'
  | 'HOLD'
  | 'NEUTRAL';

interface WeeklyPrice {
  week: string; // ISO date of week start (Monday)
  avgPrice: number;
}

interface CategoryForecast {
  category: string;
  currentAvgPrice: number;
  previousAvgPrice: number;
  priceChangePercent: number;
  volatility: number;
  weeklyPrices: WeeklyPrice[];
  forecast30d: number;
  forecastDirection: ForecastDirection;
  confidenceScore: number;
  recommendation: Recommendation;
}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Returns the Monday of the week containing the given date
function weekStart(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay(); // 0=Sun..6=Sat
  const diff = (day + 6) % 7; // days since Monday
  date.setDate(date.getDate() - diff);
  return date;
}

// Simple linear regression: returns slope and intercept
function linearRegression(
  points: Array<{ x: number; y: number }>,
): { slope: number; intercept: number } {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: points[0].y };
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance =
    arr.reduce((s, v) => s + (v - m) * (v - m), 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();
    const cutoff = new Date(now - 90 * DAY_MS);

    // 1) Query all listings from last 90 days with price data
    const listings = await db.listing.findMany({
      where: {
        isHidden: false,
        firstSeenAt: { gte: cutoff },
        price: { gt: 0 },
      },
      select: {
        id: true,
        price: true,
        firstSeenAt: true,
        monitor: { select: { name: true, source: true } },
      },
      take: 20000,
    });

    // Empty state
    if (listings.length === 0) {
      return NextResponse.json({
        ok: true,
        categories: [],
        summary: {
          totalCategories: 0,
          risingCount: 0,
          fallingCount: 0,
          stableCount: 0,
          bestBuyCategory: null,
          bestSellCategory: null,
        },
        advice:
          'Ni oglasov s cenami v zadnjih 90 dneh — Price History Forecaster potrebuje vsaj nekaj oglasov z veljavnimi cenami.',
      });
    }

    // 2) Group by category (using monitor.name as category proxy) and by week
    // Week bucket: Monday of the week containing firstSeenAt
    const catWeekly = new Map<
      string, // category (monitor.name or fallback)
      Map<string, { sum: number; count: number }>
    >();

    for (const l of listings) {
      const category = (l.monitor?.name ?? 'drugo').trim() || 'drugo';
      const weekDate = weekStart(l.firstSeenAt);
      const weekKey = isoDate(weekDate);
      let weekMap = catWeekly.get(category);
      if (!weekMap) {
        weekMap = new Map();
        catWeekly.set(category, weekMap);
      }
      const entry = weekMap.get(weekKey) || { sum: 0, count: 0 };
      entry.sum += l.price ?? 0;
      entry.count += 1;
      weekMap.set(weekKey, entry);
    }

    // Build time series for each category — last 13 weeks
    // Find the week range
    const allWeeks = new Set<string>();
    for (const weekMap of catWeekly.values()) {
      for (const wk of weekMap.keys()) allWeeks.add(wk);
    }
    const sortedWeeks = Array.from(allWeeks).sort();
    // Take last 13 weeks (or all if fewer)
    const lastWeeks = sortedWeeks.slice(-13);

    // 3) For each category with 4+ weeks of data, compute forecast
    const categories: CategoryForecast[] = [];

    for (const [category, weekMap] of catWeekly.entries()) {
      // Build weekly prices array (only weeks with data)
      const weeklyPrices: WeeklyPrice[] = [];
      for (const wk of lastWeeks) {
        const entry = weekMap.get(wk);
        if (entry && entry.count > 0) {
          weeklyPrices.push({
            week: wk,
            avgPrice: Math.round(entry.sum / entry.count),
          });
        }
      }

      // Sort by week ascending
      weeklyPrices.sort((a, b) => a.week.localeCompare(b.week));

      // Need at least 4 weeks of data for forecast
      if (weeklyPrices.length < 4) continue;

      // Current avg = avg price last 4 weeks (or all if fewer)
      const last4 = weeklyPrices.slice(-4);
      const currentAvgPrice = Math.round(
        mean(last4.map(w => w.avgPrice)),
      );

      // Previous avg = avg price weeks 5-8 (or earlier if fewer)
      const prev4 = weeklyPrices.slice(-8, -4);
      const previousAvgPrice =
        prev4.length > 0
          ? Math.round(mean(prev4.map(w => w.avgPrice)))
          : currentAvgPrice;

      // Price change %
      const priceChangePercent =
        previousAvgPrice > 0
          ? Number(
              (
                ((currentAvgPrice - previousAvgPrice) / previousAvgPrice) *
                100
              ).toFixed(1),
            )
          : 0;

      // Volatility = std dev of weekly prices / mean
      const prices = weeklyPrices.map(w => w.avgPrice);
      const pricesMean = mean(prices);
      const volatility =
        pricesMean > 0
          ? Number((stdDev(prices) / pricesMean).toFixed(3))
          : 0;

      // Linear regression on weekly prices (x = week index, y = price)
      const regPoints = weeklyPrices.map((w, i) => ({ x: i, y: w.avgPrice }));
      const { slope, intercept } = linearRegression(regPoints);

      // Forecast 30 days = ~4.3 weeks ahead — project from last point
      // x_future = lastWeekIndex + 4.3
      const lastIdx = weeklyPrices.length - 1;
      const projectedX = lastIdx + 30 / 7; // 30 days = ~4.3 weeks
      const forecast30d = Math.max(
        0,
        Math.round(slope * projectedX + intercept),
      );

      // Forecast direction — based on slope vs avg price (relative change)
      // If slope > 1% of avg price per week → RISING
      // If slope < -1% of avg price per week → FALLING
      // Else STABLE
      const slopeThreshold = Math.abs(pricesMean * 0.01);
      let forecastDirection: ForecastDirection = 'STABLE';
      if (slope > slopeThreshold) forecastDirection = 'RISING';
      else if (slope < -slopeThreshold) forecastDirection = 'FALLING';

      // Confidence score (0-100):
      // +30 if 8+ weeks of data, +20 if 6+, +10 if 4+
      // +20 if low volatility (< 0.15), +10 if moderate (< 0.30), +0 if high
      // +20 if price change consistent (slope sign matches change direction)
      // +10 if recent data (last week is within last 14 days)
      let confidence = 20; // base
      if (weeklyPrices.length >= 8) confidence += 30;
      else if (weeklyPrices.length >= 6) confidence += 20;
      else if (weeklyPrices.length >= 4) confidence += 10;
      if (volatility < 0.15) confidence += 20;
      else if (volatility < 0.30) confidence += 10;
      // Consistency: slope sign matches change direction
      if (
        (slope > 0 && priceChangePercent > 0) ||
        (slope < 0 && priceChangePercent < 0)
      ) {
        confidence += 20;
      } else if (Math.abs(slope) < slopeThreshold * 0.5) {
        // Stable slope = consistent
        confidence += 10;
      }
      // Recent data: last week within last 14 days
      const lastWeekDate = new Date(weeklyPrices[weeklyPrices.length - 1].week);
      if (now - lastWeekDate.getTime() < 14 * DAY_MS) {
        confidence += 10;
      }
      confidence = Math.max(0, Math.min(100, confidence));

      // Recommendation:
      // FALLING prices = good time to BUY (lower prices coming)
      // RISING prices = good time to SELL (higher prices now, but may peak)
      // STABLE = HOLD or NEUTRAL
      let recommendation: Recommendation;
      if (forecastDirection === 'FALLING' && priceChangePercent < -5) {
        recommendation = 'GOOD_TIME_TO_BUY';
      } else if (forecastDirection === 'RISING' && priceChangePercent > 5) {
        recommendation = 'GOOD_TIME_TO_SELL';
      } else if (
        forecastDirection === 'STABLE' &&
        Math.abs(priceChangePercent) < 3
      ) {
        recommendation = 'HOLD';
      } else {
        recommendation = 'NEUTRAL';
      }

      categories.push({
        category,
        currentAvgPrice,
        previousAvgPrice,
        priceChangePercent,
        volatility,
        weeklyPrices,
        forecast30d,
        forecastDirection,
        confidenceScore: confidence,
        recommendation,
      });
    }

    // Sort by confidence (desc) then by absolute price change (desc)
    categories.sort((a, b) => {
      // First by confidence
      if (b.confidenceScore !== a.confidenceScore) {
        return b.confidenceScore - a.confidenceScore;
      }
      return (
        Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent)
      );
    });

    // 4) Summary
    const risingCount = categories.filter(c => c.forecastDirection === 'RISING').length;
    const fallingCount = categories.filter(c => c.forecastDirection === 'FALLING').length;
    const stableCount = categories.filter(c => c.forecastDirection === 'STABLE').length;

    // Best buy = falling category with highest confidence
    const bestBuy = categories
      .filter(c => c.forecastDirection === 'FALLING')
      .sort((a, b) => b.confidenceScore - a.confidenceScore)[0];
    const bestBuyCategory = bestBuy?.category ?? null;

    // Best sell = rising category with highest confidence
    const bestSell = categories
      .filter(c => c.forecastDirection === 'RISING')
      .sort((a, b) => b.confidenceScore - a.confidenceScore)[0];
    const bestSellCategory = bestSell?.category ?? null;

    // 5) Advice
    let advice: string;
    if (categories.length === 0) {
      advice =
        'Ni kategorij z dovolj tedenskimi podatki (4+ tednov) — počakaj da zbereš več zgodovine.';
    } else {
      const parts: string[] = [];
      parts.push(
        `Analiziranih ${categories.length} kategorij z zadostnimi podatki.`,
      );
      if (bestBuyCategory) {
        parts.push(
          `Nakup: "${bestBuyCategory}" (${bestBuy!.priceChangePercent > 0 ? '+' : ''}${bestBuy!.priceChangePercent}%, FALLING, confidence ${bestBuy!.confidenceScore}%).`,
        );
      }
      if (bestSellCategory) {
        parts.push(
          `Prodaja: "${bestSellCategory}" (${bestSell!.priceChangePercent > 0 ? '+' : ''}${bestSell!.priceChangePercent}%, RISING, confidence ${bestSell!.confidenceScore}%).`,
        );
      }
      if (risingCount === 0 && fallingCount === 0) {
        parts.push(
          'Trg je stabilen — ni jasnih buy/sell signalov. Vzdržuj redno aktivnost.',
        );
      }
      advice = parts.join(' ');
    }

    return NextResponse.json({
      ok: true,
      categories,
      summary: {
        totalCategories: categories.length,
        risingCount,
        fallingCount,
        stableCount,
        bestBuyCategory,
        bestSellCategory,
      },
      advice,
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/price-history-forecaster',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
