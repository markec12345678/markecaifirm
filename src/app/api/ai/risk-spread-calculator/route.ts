// v7.50 / v8.95.6-other: AI Risk Spread Calculator — portfolio diversification analysis.
// Refaktoriran z withAiRoute helperjem (v8.95.6-other) + enforceBudget guard
// (konsistentno z vsemi v8.94.x / v8.95.x migracijami — endpoint ne kliče AI
// providerja, je deterministic; vendar ohranjamo guard za konsistentnost).
//
// "Imaš 80% capital v elektroniki — preveč koncentrirano.
//  Razprši: 40% elektronika, 30% avto, 20% orodje, 10% cash."
//
// GET /api/ai/risk-spread-calculator

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Input {}

interface HeldTradeRow {
  id: string;
  title: string;
  buyPrice: number;
  category: string | null;
  buyDate: Date;
  listing: { aiEstimatedValue: number | null; aiRisk: number | null } | null;
}

interface SoldTradeRow {
  category: string | null;
  buyPrice: number;
  sellPrice: number | null;
  buyFees: number | null;
  sellFees: number | null;
}

interface CatAllocation {
  category: string;
  count: number;
  valueEur: number;
  estValueEur: number;
  pct: number;
  avgRisk: number;
}

interface CatRoi {
  category: string;
  roi: number;
  count: number;
}

interface RecommendedAllocation {
  category: string;
  pct: number;
  reason: string;
}

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export const GET = withAiRoute<Input>({
  endpoint: '/api/ai/risk-spread-calculator',
  maxDuration: 90,
  enforceBudget: true, // v8.95.6-other: budget guard (konsistentno z vsemi AI route-i)
  method: 'GET',

  parseBody: async () => ({}),

  // Brez validateInput — endpoint nima inputa

  handler: async (_input, ctx: AiRouteContext) => {
    const { db } = ctx;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, buyPrice: true, category: true, buyDate: true, listing: { select: { aiEstimatedValue: true, aiRisk: true } } },
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true, buyFees: true, sellFees: true },
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, message: 'Skladišče je prazno — nič za analizo.' });
    }

    // Current allocation
    const totalValue = heldTrades.reduce((s, t) => s + t.buyPrice, 0);
    const currentAllocation = computeCurrentAllocation(heldTrades, totalValue);

    // Risk metrics
    const concentrationRisk = Math.max(...currentAllocation.map(a => a.pct)); // highest single category %
    const diversificationScore = Math.round(100 - concentrationRisk); // higher = more diversified
    const weightedAvgRisk = Math.round(currentAllocation.reduce((s, a) => s + a.avgRisk * (a.pct / 100), 0));

    // Category ROI from sold history
    const categoryRoi = computeCategoryRoi(soldTrades);

    // Recommended allocation (based on ROI + diversification)
    const recommendedAllocation = computeRecommendedAllocation(categoryRoi);

    // Risk assessment
    const { riskLevel, riskReason } = assessRisk(concentrationRisk, weightedAvgRisk);

    return apiOk({
      ok: true,
      totalValueEur: Math.round(totalValue),
      totalItems: heldTrades.length,
      currentAllocation,
      recommendedAllocation,
      risk: {
        level: riskLevel,
        concentrationRisk,
        diversificationScore,
        weightedAvgRisk,
        reason: riskReason,
      },
      categoryRoi,
      recommendation: riskLevel === 'HIGH'
        ? `🔴 Razprši portfelj! ${concentrationRisk}% v eni kategoriji je preveč. Cilj: max 40% per kategorija.`
        : riskLevel === 'MEDIUM'
        ? `🟡 Zmerno tveganje. Razmisli o diverzifikaciji v kategorije z višjim ROI.`
        : `🟢 Dobra diverzifikacija. Nadaljuj s trenutno strategijo.`,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function computeCurrentAllocation(heldTrades: HeldTradeRow[], totalValue: number): CatAllocation[] {
  const catMap = new Map<string, { count: number; value: number; estValue: number; avgRisk: number }>();
  for (const t of heldTrades) {
    const cat = (t.category || 'drugo').trim();
    const cur = catMap.get(cat) || { count: 0, value: 0, estValue: 0, avgRisk: 0 };
    cur.count += 1;
    cur.value += t.buyPrice;
    cur.estValue += t.listing?.aiEstimatedValue ?? t.buyPrice * 1.2;
    cur.avgRisk += t.listing?.aiRisk ?? 5;
    catMap.set(cat, cur);
  }

  return Array.from(catMap.entries()).map(([cat, d]) => ({
    category: cat,
    count: d.count,
    valueEur: Math.round(d.value),
    estValueEur: Math.round(d.estValue),
    pct: Math.round((d.value / totalValue) * 100),
    avgRisk: Math.round(d.avgRisk / d.count),
  })).sort((a, b) => b.valueEur - a.valueEur);
}

function computeCategoryRoi(soldTrades: SoldTradeRow[]): CatRoi[] {
  const soldCatMap = new Map<string, { invested: number; returned: number; count: number }>();
  for (const t of soldTrades) {
    const cat = (t.category || 'drugo').trim();
    const cur = soldCatMap.get(cat) || { invested: 0, returned: 0, count: 0 };
    cur.invested += t.buyPrice + (t.buyFees ?? 0);
    cur.returned += (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    cur.count += 1;
    soldCatMap.set(cat, cur);
  }

  return Array.from(soldCatMap.entries()).map(([cat, d]) => ({
    category: cat,
    roi: d.invested > 0 ? Math.round(((d.returned - d.invested) / d.invested) * 100) : 0,
    count: d.count,
  })).sort((a, b) => b.roi - a.roi);
}

function computeRecommendedAllocation(categoryRoi: CatRoi[]): RecommendedAllocation[] {
  const topCategories = categoryRoi.filter(c => c.roi > 0).slice(0, 5);
  const recommendedAllocation: RecommendedAllocation[] = [];

  if (topCategories.length > 0) {
    const totalRoi = topCategories.reduce((s, c) => s + c.roi, 0);
    recommendedAllocation.push(...topCategories.map((c) => {
      // 80% in top ROI categories; cap at 40% per category
      let pct = Math.round((c.roi / totalRoi) * 80);
      pct = Math.min(40, pct);
      return {
        category: c.category,
        pct,
        reason: `ROI ${c.roi}% iz ${c.count} prodaj`,
      };
    }));
    // Add cash reserve
    const allocated = recommendedAllocation.reduce((s, a) => s + a.pct, 0);
    recommendedAllocation.push({ category: 'Cash reserve', pct: 100 - allocated, reason: 'Likvidnost za nove priložnosti' });
  }

  return recommendedAllocation;
}

function assessRisk(
  concentrationRisk: number,
  weightedAvgRisk: number,
): { riskLevel: RiskLevel; riskReason: string } {
  if (concentrationRisk > 60) {
    return {
      riskLevel: 'HIGH',
      riskReason: `Preveč koncentrirano — ${concentrationRisk}% v eni kategoriji. Razprši!`,
    };
  }
  if (concentrationRisk > 40 || weightedAvgRisk > 5) {
    return {
      riskLevel: 'MEDIUM',
      riskReason: `Zmerna koncentracija (${concentrationRisk}%), povprečno tveganje ${weightedAvgRisk}/10.`,
    };
  }
  return {
    riskLevel: 'LOW',
    riskReason: `Dobra diverzifikacija — najvišja kategorija ${concentrationRisk}%.`,
  };
}
