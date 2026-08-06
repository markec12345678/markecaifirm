// v7.55: ROI Performance Leaderboard — kateri item-i zmagujejo.
//
// "Samsung Galaxy S22 = 35% ROI (5 prodaj), iPhone 13 = 12% ROI (3 prodaje)
//  → Bolha iskati Samsung, ne iPhone"
//
// Analizira SOLD trade-e po brandu/modelu/ključnih besedah v naslovu.
// GET /api/analytics/roi-leaderboard

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Extract brand/model from title
function extractBrandModel(title: string): { brand: string; model: string } {
  const knownBrands = ['apple', 'iphone', 'samsung', 'galaxy', 'huawei', 'xiaomi', 'sony', 'playstation', 'xbox', 'nintendo', 'lg', 'bosch', 'makita', 'dewalt', 'ikea', 'lego', 'nike', 'adidas'];
  const lower = title.toLowerCase();
  const brand = knownBrands.find(b => lower.includes(b)) || 'drugo';
  // Extract model: words after brand
  const brandIdx = lower.indexOf(brand);
  const modelPart = brandIdx >= 0 ? title.slice(brandIdx, brandIdx + 30).split(/\s+/).slice(0, 4).join(' ') : title.split(/\s+/).slice(0, 3).join(' ');
  return { brand, model: modelPart.toLowerCase().trim() };
}

export async function GET() {
  try {
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, buyDate: true, sellDate: true },
    });

    if (soldTrades.length < 3) {
      return NextResponse.json({ ok: true, leaderboard: [], message: 'Potrebnih vsaj 3 prodaje za leaderboard.' });
    }

    // Group by brand
    const brandMap = new Map<string, { trades: typeof soldTrades; profit: number; invested: number; holdDays: number[] }>();
    for (const t of soldTrades) {
      const { brand } = extractBrandModel(t.title);
      if (!brandMap.has(brand)) brandMap.set(brand, { trades: [], profit: 0, invested: 0, holdDays: [] });
      const d = brandMap.get(brand)!;
      d.trades.push(t);
      d.profit += (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
      d.invested += t.buyPrice + (t.buyFees ?? 0);
      const hd = (new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / 86400000;
      if (hd >= 0) d.holdDays.push(hd);
    }

    const brandLeaderboard = Array.from(brandMap.entries()).map(([brand, d]) => ({
      brand,
      count: d.trades.length,
      totalProfit: Math.round(d.profit),
      avgProfit: Math.round(d.profit / d.trades.length),
      roi: d.invested > 0 ? Math.round((d.profit / d.invested) * 100) : 0,
      avgHoldDays: d.holdDays.length > 0 ? Math.round(d.holdDays.reduce((s, x) => s + x, 0) / d.holdDays.length) : 0,
      profitPerDay: d.holdDays.length > 0 ? Math.round((d.profit / d.trades.length) / (d.holdDays.reduce((s, x) => s + x, 0) / d.holdDays.length) * 10) / 10 : 0,
    })).sort((a, b) => b.roi - a.roi);

    // Group by model (more granular)
    const modelMap = new Map<string, { trades: typeof soldTrades; profit: number; invested: number; holdDays: number[] }>();
    for (const t of soldTrades) {
      const { model } = extractBrandModel(t.title);
      if (!modelMap.has(model)) modelMap.set(model, { trades: [], profit: 0, invested: 0, holdDays: [] });
      const d = modelMap.get(model)!;
      d.trades.push(t);
      d.profit += (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
      d.invested += t.buyPrice + (t.buyFees ?? 0);
      const hd = (new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / 86400000;
      if (hd >= 0) d.holdDays.push(hd);
    }

    const modelLeaderboard = Array.from(modelMap.entries())
      .filter(([_, d]) => d.trades.length >= 1)
      .map(([model, d]) => ({
        model,
        count: d.trades.length,
        totalProfit: Math.round(d.profit),
        avgProfit: Math.round(d.profit / d.trades.length),
        roi: d.invested > 0 ? Math.round((d.profit / d.invested) * 100) : 0,
        avgHoldDays: d.holdDays.length > 0 ? Math.round(d.holdDays.reduce((s, x) => s + x, 0) / d.holdDays.length) : 0,
      })).sort((a, b) => b.avgProfit - a.avgProfit);

    // Group by category
    const catMap = new Map<string, { count: number; profit: number; invested: number }>();
    for (const t of soldTrades) {
      const cat = (t.category || 'drugo').trim();
      const cur = catMap.get(cat) || { count: 0, profit: 0, invested: 0 };
      cur.count += 1;
      cur.profit += (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
      cur.invested += t.buyPrice + (t.buyFees ?? 0);
      catMap.set(cat, cur);
    }
    const categoryLeaderboard = Array.from(catMap.entries()).map(([cat, d]) => ({
      category: cat, count: d.count, totalProfit: Math.round(d.profit),
      avgProfit: Math.round(d.profit / d.count),
      roi: d.invested > 0 ? Math.round((d.profit / d.invested) * 100) : 0,
    })).sort((a, b) => b.roi - a.roi);

    // Winners vs losers
    const winners = brandLeaderboard.filter(b => b.roi > 0);
    const losers = brandLeaderboard.filter(b => b.roi < 0);

    return NextResponse.json({
      ok: true,
      brandLeaderboard: brandLeaderboard.slice(0, 15),
      modelLeaderboard: modelLeaderboard.slice(0, 15),
      categoryLeaderboard,
      summary: {
        totalTrades: soldTrades.length,
        totalBrands: brandLeaderboard.length,
        winners: winners.length,
        losers: losers.length,
        bestBrand: brandLeaderboard[0] ? { brand: brandLeaderboard[0].brand, roi: brandLeaderboard[0].roi, count: brandLeaderboard[0].count } : null,
        worstBrand: brandLeaderboard[brandLeaderboard.length - 1] ? { brand: brandLeaderboard[brandLeaderboard.length - 1].brand, roi: brandLeaderboard[brandLeaderboard.length - 1].roi } : null,
      },
      recommendation: brandLeaderboard[0]
        ? `🏆 Najboljši brand: ${brandLeaderboard[0].brand} (${brandLeaderboard[0].roi}% ROI). Išči več ${brandLeaderboard[0].brand} oglasov!`
        : 'Ni dovolj podatkov.',
    });
  } catch (err: any) {
    logger.error('/api/analytics/roi-leaderboard', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
