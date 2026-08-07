// v7.65: Portfolio Concentration Risk Analyzer — Pareto analiza in
// Herfindahl index za identifikacijo koncentracijskega tveganja portfelja.
//
// "65% kapitala v elektronika = HIGH_RISK. Herfindahl 4200. Top 20% trade-ov
//  = 75% profita. Diverzificiraj v moda."
//
// Razlika od risk-spread-calculator (ki priporoča AI kapitalsko alokacijo
// glede na kategorijo) — ta računa PARETO analizo (% trade-ov = % profita)
// in HERFINDAHL koncentracijski index (0 = perfect diversified, 10000 =
// monopoly) z eksplicitno DIVERSIFIED/MODERATE/CONCENTRATED/HIGH_RISK
// klasifikacijo. Razlika od portfolio-stress-test (ki simulira tržne scenarije
// -10/-25/-40%) — ta gleda STRUKTURO portfelja (koliko je v eni kategoriji/
// brandu) in priporoča diverzifikacijo.
//
// Pure DB analytics (NO AI). GET /api/analytics/portfolio-concentration-risk

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

interface CategoryBreakdownRow {
  category: string;
  itemCount: number;
  capital: number;
  percentage: number;
}

interface BrandBreakdownRow {
  brand: string;
  itemCount: number;
  capital: number;
  percentage: number;
}

interface PriceRangeBreakdownRow {
  range: string;
  itemCount: number;
  capital: number;
  percentage: number;
}

type ConcentrationLevel =
  | 'DIVERSIFIED'
  | 'MODERATE'
  | 'CONCENTRATED'
  | 'HIGH_RISK';

interface OverexposedCategory {
  category: string;
  currentShare: number;
  suggestedReduction: number;
}

interface UnderrepresentedCategory {
  category: string;
  suggestedIncrease: number;
  reasoning: string;
}

// --- Helpers -------------------------------------------------------------

// Same brand extraction logic as roi-leaderboard
const KNOWN_BRANDS = [
  'apple',
  'iphone',
  'samsung',
  'galaxy',
  'huawei',
  'xiaomi',
  'sony',
  'playstation',
  'xbox',
  'nintendo',
  'lg',
  'bosch',
  'makita',
  'dewalt',
  'ikea',
  'lego',
  'nike',
  'adidas',
];

function extractBrand(title: string): string {
  const lower = title.toLowerCase();
  const found = KNOWN_BRANDS.find(b => lower.includes(b));
  return found || 'drugo';
}

const PRICE_RANGES: Array<{ label: string; min: number; max: number }> = [
  { label: '0-100€', min: 0, max: 100 },
  { label: '100-500€', min: 100, max: 500 },
  { label: '500-1000€', min: 500, max: 1000 },
  { label: '1000€+', min: 1000, max: Number.POSITIVE_INFINITY },
];

function priceRangeLabel(buyPrice: number): string {
  for (const r of PRICE_RANGES) {
    if (buyPrice >= r.min && buyPrice < r.max) return r.label;
  }
  return '0-100€';
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    // 1) Query all HELD trades for current portfolio
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
      },
      take: 2000,
    });

    // 2) Query all SOLD trades for historical profit distribution (Pareto)
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
        sellPrice: true,
        sellFees: true,
      },
      take: 5000,
    });

    // Empty state — no portfolio at all
    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        currentPortfolio: {
          totalItems: 0,
          totalCapital: 0,
          byCategory: [],
          byBrand: [],
          byPriceRange: [],
        },
        paretoAnalysis: {
          totalTradesAnalyzed: 0,
          top20PercentProfitShare: 0,
          tradesFor80PercentProfit: 0,
          paretoRatio: '—',
          insight: 'Ni prodanih trade-ov — Pareto analiza ni mogoča.',
        },
        riskMetrics: {
          herfindahlIndex: 0,
          topCategoryShare: 0,
          topBrandShare: 0,
          concentrationLevel: 'DIVERSIFIED',
          riskScore: 0,
        },
        recommendations: {
          overexposedCategories: [],
          underrepresentedCategories: [],
          diversificationAdvice:
            'Skladišče je prazno — začni z nakupi in nato analiziraj koncentracijo.',
          targetAction: 'Dodaj prvi item v portfelj.',
        },
        message:
          'Ni held ali sold trade-ov — Concentration Risk analiza ni mogoča.',
      });
    }

    // 3) Compute current portfolio concentration
    const totalCapital = heldTrades.reduce((s, t) => s + t.buyPrice, 0);
    const totalItems = heldTrades.length;

    // By category
    const catMap = new Map<string, { count: number; capital: number }>();
    for (const t of heldTrades) {
      const category = (t.category || 'drugo').trim().toLowerCase() || 'drugo';
      const cur = catMap.get(category) || { count: 0, capital: 0 };
      cur.count += 1;
      cur.capital += t.buyPrice;
      catMap.set(category, cur);
    }
    const byCategory: CategoryBreakdownRow[] = Array.from(catMap.entries())
      .map(([category, d]) => ({
        category,
        itemCount: d.count,
        capital: Math.round(d.capital),
        percentage:
          totalCapital > 0 ? Math.round((d.capital / totalCapital) * 100) : 0,
      }))
      .sort((a, b) => b.capital - a.capital);

    // By brand (extract from title)
    const brandMap = new Map<string, { count: number; capital: number }>();
    for (const t of heldTrades) {
      const brand = extractBrand(t.title);
      const cur = brandMap.get(brand) || { count: 0, capital: 0 };
      cur.count += 1;
      cur.capital += t.buyPrice;
      brandMap.set(brand, cur);
    }
    const byBrand: BrandBreakdownRow[] = Array.from(brandMap.entries())
      .map(([brand, d]) => ({
        brand,
        itemCount: d.count,
        capital: Math.round(d.capital),
        percentage:
          totalCapital > 0 ? Math.round((d.capital / totalCapital) * 100) : 0,
      }))
      .sort((a, b) => b.capital - a.capital);

    // By price range
    const rangeMap = new Map<string, { count: number; capital: number }>();
    for (const t of heldTrades) {
      const range = priceRangeLabel(t.buyPrice);
      const cur = rangeMap.get(range) || { count: 0, capital: 0 };
      cur.count += 1;
      cur.capital += t.buyPrice;
      rangeMap.set(range, cur);
    }
    const byPriceRange: PriceRangeBreakdownRow[] = Array.from(rangeMap.entries())
      .map(([range, d]) => ({
        range,
        itemCount: d.count,
        capital: Math.round(d.capital),
        percentage:
          totalCapital > 0 ? Math.round((d.capital / totalCapital) * 100) : 0,
      }))
      .sort((a, b) => b.capital - a.capital);

    // 4) Pareto analysis on SOLD trades
    // Compute profit per trade
    const soldWithProfit = soldTrades.map(t => {
      const buy = t.buyPrice + (t.buyFees ?? 0);
      const sell = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = sell - buy;
      return { tradeId: t.id, profit };
    });
    // Sort by profit desc
    soldWithProfit.sort((a, b) => b.profit - a.profit);

    const totalProfit = soldWithProfit.reduce((s, t) => s + t.profit, 0);
    let top20PercentProfitShare = 0;
    let tradesFor80PercentProfit = 0;
    let paretoRatio = '—';
    let insight = 'Ni prodanih trade-ov — Pareto analiza ni mogoča.';

    if (soldWithProfit.length > 0 && totalProfit > 0) {
      // Top 20% of trades — how much profit do they generate?
      const top20Count = Math.max(1, Math.ceil(soldWithProfit.length * 0.2));
      const top20Profit = soldWithProfit
        .slice(0, top20Count)
        .reduce((s, t) => s + t.profit, 0);
      top20PercentProfitShare = Math.round((top20Profit / totalProfit) * 100);

      // How many trades = 80% of profit?
      let cumulative = 0;
      let tradesFor80 = 0;
      for (const t of soldWithProfit) {
        cumulative += t.profit;
        tradesFor80 += 1;
        if (cumulative >= totalProfit * 0.8) break;
      }
      tradesFor80PercentProfit = tradesFor80;
      const tradesFor80Pct = Math.round(
        (tradesFor80 / soldWithProfit.length) * 100,
      );
      paretoRatio = `${tradesFor80Pct}/${top20PercentProfitShare}`;

      insight = `Top 20% trade-ov (${top20Count}) generira ${top20PercentProfitShare}% profita. ${tradesFor80Pct}% trade-ov (${tradesFor80}) = 80% profita (Pareto ratio ${paretoRatio}).`;
    } else if (soldWithProfit.length > 0 && totalProfit <= 0) {
      insight = `Skupni profit je ${Math.round(totalProfit)}€ — Pareto analiza ni smiselna (skupna izguba).`;
      top20PercentProfitShare = 0;
      tradesFor80PercentProfit = soldWithProfit.length;
      paretoRatio = '—';
    }

    // 5) Risk metrics — Herfindahl-Hirschman Index (HHI)
    // HHI = sum of (market share)^2, scaled 0-10000
    // 0 = perfectly diversified, 10000 = monopoly
    let herfindahlIndex = 0;
    if (byCategory.length > 0 && totalCapital > 0) {
      herfindahlIndex = Math.round(
        byCategory.reduce((s, c) => s + c.percentage * c.percentage, 0),
      );
    }

    const topCategoryShare = byCategory[0]?.percentage ?? 0;
    const topBrandShare = byBrand[0]?.percentage ?? 0;

    // Concentration level — based on top category share
    let concentrationLevel: ConcentrationLevel;
    if (topCategoryShare >= 60) concentrationLevel = 'HIGH_RISK';
    else if (topCategoryShare >= 40) concentrationLevel = 'CONCENTRATED';
    else if (topCategoryShare >= 25) concentrationLevel = 'MODERATE';
    else concentrationLevel = 'DIVERSIFIED';

    // Risk score 0-100 — combines top category share + top brand share + HHI/100
    // Top category share weighted 50%, top brand 20%, HHI/100 weighted 30%
    let riskScore = Math.round(
      Math.min(100, topCategoryShare * 0.5 + topBrandShare * 0.2 + herfindahlIndex / 100),
    );
    if (totalItems === 0) riskScore = 0;

    // 6) Recommendations
    // Overexposed categories: those with share >= 30% (or >= CONCENTRATED threshold)
    const overexposedCategories: OverexposedCategory[] = byCategory
      .filter(c => c.percentage >= 30)
      .map(c => ({
        category: c.category,
        currentShare: c.percentage,
        // Suggest reduction to 25% (or below MODERATE threshold)
        suggestedReduction: Math.max(0, c.percentage - 25),
      }));

    // Underrepresented categories: from SOLD history — categories that were
    // historically profitable but are NOT in current portfolio (or low share)
    const soldCategoryProfit = new Map<string, { profit: number; count: number }>();
    for (const t of soldWithProfit) {
      const trade = soldTrades.find(st => st.id === t.tradeId);
      const category = (trade?.category || 'drugo').trim().toLowerCase() || 'drugo';
      const cur = soldCategoryProfit.get(category) || { profit: 0, count: 0 };
      cur.profit += t.profit;
      cur.count += 1;
      soldCategoryProfit.set(category, cur);
    }
    // Pick top 3 historical categories with positive profit that are
    // underrepresented (< 15% share) in current portfolio
    const underrepresentedCategories: UnderrepresentedCategory[] = Array.from(
      soldCategoryProfit.entries(),
    )
      .filter(([cat, d]) => d.profit > 0 && d.count >= 1)
      .map(([cat, d]) => {
        const current = byCategory.find(c => c.category === cat);
        const currentShare = current?.percentage ?? 0;
        return {
          category: cat,
          historicalProfit: Math.round(d.profit),
          historicalCount: d.count,
          currentShare,
        };
      })
      .filter(c => c.currentShare < 15)
      .sort((a, b) => b.historicalProfit - a.historicalProfit)
      .slice(0, 3)
      .map(c => ({
        category: c.category,
        suggestedIncrease: 15 - c.currentShare,
        reasoning: `Zgodovinsko ${c.historicalProfit}€ profita iz ${c.historicalCount} prodaj — trenutno ${c.currentShare}% portfelja.`,
      }));

    // Diversification advice
    let diversificationAdvice: string;
    if (totalItems === 0) {
      diversificationAdvice = 'Skladišče je prazno — diverzifikacija še ni relevantna.';
    } else if (concentrationLevel === 'HIGH_RISK') {
      diversificationAdvice = `HIGH_RISK: ${topCategoryShare}% kapitala v "${byCategory[0]?.category ?? '—'}". Nujno diverzificiraj — zmanjšaj top kategorijo pod 40%.`;
    } else if (concentrationLevel === 'CONCENTRATED') {
      diversificationAdvice = `CONCENTRATED: ${topCategoryShare}% v "${byCategory[0]?.category ?? '—'}". Priporočljivo diverzificiraj v 2-3 druge kategorije.`;
    } else if (concentrationLevel === 'MODERATE') {
      diversificationAdvice = `MODERATE: ${topCategoryShare}% v "${byCategory[0]?.category ?? '—'}". Diverzifikacija je dobra, vendar lahko še izboljšaš.`;
    } else {
      diversificationAdvice = `DIVERSIFIED: najvišji delež ${topCategoryShare}% — dobra diverzifikacija. Vzdržuj sedanjo strukturo.`;
    }

    // Target action — concrete next step
    let targetAction: string;
    if (overexposedCategories.length > 0) {
      const oc = overexposedCategories[0];
      targetAction = `Zmanjšaj "${oc.category}" s ${oc.currentShare}% na <25% (redukcija ${oc.suggestedReduction}%) v naslednjih 2-4 kupih — nove nakupe usmeri v ${underrepresentedCategories[0]?.category ?? 'drugo kategorijo'}.`;
    } else if (underrepresentedCategories.length > 0) {
      targetAction = `Premakni ${underrepresentedCategories[0].suggestedIncrease}% kapitala v "${underrepresentedCategories[0].category}" — ${underrepresentedCategories[0].reasoning}`;
    } else if (totalItems === 0) {
      targetAction = 'Dodaj prvi item v portfelj za začetek analize koncentracije.';
    } else {
      targetAction = `Portfelj je dobro diverzificiran (HHI ${herfindahlIndex}, top share ${topCategoryShare}%). Vzdržuj trenutno strukturo in monitoring.`;
    }

    return NextResponse.json({
      ok: true,
      currentPortfolio: {
        totalItems,
        totalCapital: Math.round(totalCapital),
        byCategory,
        byBrand,
        byPriceRange,
      },
      paretoAnalysis: {
        totalTradesAnalyzed: soldWithProfit.length,
        top20PercentProfitShare,
        tradesFor80PercentProfit,
        paretoRatio,
        insight,
      },
      riskMetrics: {
        herfindahlIndex,
        topCategoryShare,
        topBrandShare,
        concentrationLevel,
        riskScore,
      },
      recommendations: {
        overexposedCategories,
        underrepresentedCategories,
        diversificationAdvice,
        targetAction,
      },
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/portfolio-concentration-risk',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
