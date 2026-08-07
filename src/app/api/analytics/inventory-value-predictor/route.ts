// v7.73: Inventory Value Predictor — napove SKUPNO REALIZABILNO vrednost
// trenutnega HELD inventarja (kaj bi dejansko dobil če bi vse prodal danes
// vs v 30/60/90 dneh). "Skladišče: 3500€ buy price, 4200€ estValue. Quick
// sale: 3150€ (profit 150€). Patient: 4200€ (profit 700€)."
//
// Razlika od inventory-profit-maximizer (ki AI optimizira inventory profit)
// — ta napove REALIZABILNO vrednost (cash flow projekcija). Razlika od
// inventory-profitability-analyzer (ki analizira profitability) — ta
// modelira 3 scenarije realizacije. Razlika od cash-conversion-cycle (ki
// meri CCC finančno metriko) — ta napove vrednost pod različnimi časi
// prodaje. Razlika od profit-trajectory-forecaster (ki napove rast profita)
// — ta napove vrednost obstoječega inventarja.
//
// Pure DB analytics (NO AI). GET /api/analytics/inventory-value-predictor

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

interface PerItem {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  aiEstimatedValue: number | null;
  quickSaleValue: number;
  normalSaleValue: number;
  patientSaleValue: number;
  carryingCostAccrued: number;
  netRealizableValue: number;
  daysHeld: number;
}

interface Scenario {
  totalValue: number;
  totalNetProfit: number;
  timeToCash: string;
}

interface ByCategory {
  category: string;
  itemCount: number;
  totalBuyPrice: number;
  totalEstValue: number;
  avgROI: number; // %
}

interface Recommendation {
  bestScenario: string;
  reasoning: string;
  expectedCashFlow: number;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const CARRYING_COST_PER_DAY = 0.5; // € per day per item
const ESTIMATED_FEES_PCT = 0.05; // 5% platform fees
const QUICK_SALE_FACTOR = 0.75; // 75% of estValue for fast sale
const NORMAL_SALE_FACTOR = 0.90; // 90% of estValue for 30-day sale
const PATIENT_SALE_FACTOR = 1.00; // 100% of estValue for patient sale
const FALLBACK_EST_FACTOR = 1.15; // If no estValue: assume 15% above buyPrice

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    // 1) Query all HELD trades with linked Listing
    const heldTrades = await db.trade.findMany({
      where: {
        status: 'held',
        buyPrice: { gt: 0 },
      },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyDate: true,
        buyFees: true,
        listing: {
          select: {
            id: true,
            aiEstimatedValue: true,
          },
        },
      },
      take: 5000,
    });

    // Empty state
    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        portfolio: {
          totalItems: 0,
          totalBuyPrice: 0,
          totalEstimatedValue: 0,
          totalUnrealizedProfit: 0,
          totalCarryingCostAccrued: 0,
        },
        perItem: [],
        scenarios: {
          immediateLiquidation: { totalValue: 0, totalNetProfit: 0, timeToCash: '0 dni' },
          balancedRealization: { totalValue: 0, totalNetProfit: 0, timeToCash: '0 dni' },
          patientRealization: { totalValue: 0, totalNetProfit: 0, timeToCash: '0 dni' },
        },
        byCategory: [],
        recommendation: {
          bestScenario: 'immediateLiquidation',
          reasoning: 'Ni HELD inventarja — dodaj trade s statusom "held" za napoved vrednosti.',
          expectedCashFlow: 0,
        },
        message: 'Ni HELD trade-ov — Inventory Value Predictor ni mogoč.',
      });
    }

    // 2) Compute per-item values
    const now = Date.now();
    const perItem: PerItem[] = [];
    let totalBuyPrice = 0;
    let totalEstimatedValue = 0;
    let totalCarryingCostAccrued = 0;

    for (const t of heldTrades) {
      const cat = (t.category || '').trim().toLowerCase() || 'neznan';
      const buyPrice = t.buyPrice ?? 0;
      const aiEstimatedValue = t.listing?.aiEstimatedValue ?? null;

      // If no estValue, assume FALLBACK_EST_FACTOR × buyPrice
      const estValue = aiEstimatedValue !== null && aiEstimatedValue > 0
        ? aiEstimatedValue
        : buyPrice * FALLBACK_EST_FACTOR;

      // Days held (from buyDate to now)
      const buyDateMs = new Date(t.buyDate as unknown as Date | string).getTime();
      const daysHeld = Number.isFinite(buyDateMs)
        ? Math.max(0, Math.floor((now - buyDateMs) / DAY_MS))
        : 0;

      // Carrying cost: 0.50€/day accrued
      const carryingCostAccrued = Math.round(daysHeld * CARRYING_COST_PER_DAY * 100) / 100;

      // Sale values per scenario
      const quickSaleValue = Math.round(estValue * QUICK_SALE_FACTOR * 100) / 100;
      const normalSaleValue = Math.round(estValue * NORMAL_SALE_FACTOR * 100) / 100;
      const patientSaleValue = Math.round(estValue * PATIENT_SALE_FACTOR * 100) / 100;

      // Net realizable value (normal sale scenario as default)
      const estimatedFees = normalSaleValue * ESTIMATED_FEES_PCT;
      const netRealizableValue = Math.round(
        (normalSaleValue - carryingCostAccrued - estimatedFees) * 100,
      ) / 100;

      perItem.push({
        tradeId: t.id,
        title: t.title,
        category: cat,
        buyPrice: Math.round(buyPrice * 100) / 100,
        aiEstimatedValue: aiEstimatedValue !== null && aiEstimatedValue > 0
          ? Math.round(aiEstimatedValue * 100) / 100
          : null,
        quickSaleValue,
        normalSaleValue,
        patientSaleValue,
        carryingCostAccrued,
        netRealizableValue,
        daysHeld,
      });

      totalBuyPrice += buyPrice;
      totalEstimatedValue += estValue;
      totalCarryingCostAccrued += carryingCostAccrued;
    }

    totalBuyPrice = Math.round(totalBuyPrice * 100) / 100;
    totalEstimatedValue = Math.round(totalEstimatedValue * 100) / 100;
    totalCarryingCostAccrued = Math.round(totalCarryingCostAccrued * 100) / 100;
    const totalUnrealizedProfit = Math.round(
      (totalEstimatedValue - totalBuyPrice) * 100,
    ) / 100;

    // 3) Compute scenarios
    // immediateLiquidation: sell everything at quickSaleValue
    const immediateValue = perItem.reduce((s, i) => s + i.quickSaleValue, 0);
    const immediateFees = immediateValue * ESTIMATED_FEES_PCT;
    const immediateNetProfit = Math.round(
      (immediateValue - immediateFees - totalCarryingCostAccrued - totalBuyPrice) * 100,
    ) / 100;

    // balancedRealization: 1/3 quick, 1/3 normal, 1/3 patient
    const thirdCount = Math.max(1, Math.ceil(perItem.length / 3));
    const sortedByEst = [...perItem].sort((a, b) => (b.aiEstimatedValue ?? 0) - (a.aiEstimatedValue ?? 0));
    const quickItems = sortedByEst.slice(0, thirdCount);
    const normalItems = sortedByEst.slice(thirdCount, 2 * thirdCount);
    const patientItems = sortedByEst.slice(2 * thirdCount);
    const balancedValue =
      quickItems.reduce((s, i) => s + i.quickSaleValue, 0) +
      normalItems.reduce((s, i) => s + i.normalSaleValue, 0) +
      patientItems.reduce((s, i) => s + i.patientSaleValue, 0);
    const balancedFees = balancedValue * ESTIMATED_FEES_PCT;
    const balancedNetProfit = Math.round(
      (balancedValue - balancedFees - totalCarryingCostAccrued - totalBuyPrice) * 100,
    ) / 100;

    // patientRealization: wait for best prices on all
    const patientValue = perItem.reduce((s, i) => s + i.patientSaleValue, 0);
    const patientFees = patientValue * ESTIMATED_FEES_PCT;
    // Patient scenario accrues more carrying cost (~60 days avg additional wait)
    const patientAdditionalCarryingCost = perItem.length * 60 * CARRYING_COST_PER_DAY;
    const patientNetProfit = Math.round(
      (patientValue - patientFees - totalCarryingCostAccrued - patientAdditionalCarryingCost - totalBuyPrice) * 100,
    ) / 100;

    const scenarios: {
      immediateLiquidation: Scenario;
      balancedRealization: Scenario;
      patientRealization: Scenario;
    } = {
      immediateLiquidation: {
        totalValue: Math.round(immediateValue * 100) / 100,
        totalNetProfit: immediateNetProfit,
        timeToCash: '7 dni',
      },
      balancedRealization: {
        totalValue: Math.round(balancedValue * 100) / 100,
        totalNetProfit: balancedNetProfit,
        timeToCash: '30-90 dni',
      },
      patientRealization: {
        totalValue: Math.round(patientValue * 100) / 100,
        totalNetProfit: patientNetProfit,
        timeToCash: '90+ dni',
      },
    };

    // 4) Per-category breakdown
    const byCatMap = new Map<
      string,
      {
        itemCount: number;
        totalBuyPrice: number;
        totalEstValue: number;
      }
    >();
    for (const item of perItem) {
      const cur = byCatMap.get(item.category) || {
        itemCount: 0,
        totalBuyPrice: 0,
        totalEstValue: 0,
      };
      cur.itemCount += 1;
      cur.totalBuyPrice += item.buyPrice;
      // Use aiEstimatedValue if available, else fallback computed (quickSaleValue/QUICK_SALE_FACTOR)
      const estVal = item.aiEstimatedValue !== null && item.aiEstimatedValue > 0
        ? item.aiEstimatedValue
        : item.quickSaleValue / QUICK_SALE_FACTOR;
      cur.totalEstValue += estVal;
      byCatMap.set(item.category, cur);
    }

    const byCategory: ByCategory[] = Array.from(byCatMap.entries()).map(
      ([category, d]) => {
        const avgROI = d.totalBuyPrice > 0
          ? Math.round(((d.totalEstValue - d.totalBuyPrice) / d.totalBuyPrice) * 1000) / 10
          : 0;
        return {
          category,
          itemCount: d.itemCount,
          totalBuyPrice: Math.round(d.totalBuyPrice * 100) / 100,
          totalEstValue: Math.round(d.totalEstValue * 100) / 100,
          avgROI,
        };
      },
    );
    byCategory.sort((a, b) => b.totalEstValue - a.totalEstValue);

    // 5) Recommendation — pick best scenario by net profit
    let bestScenario: string;
    let expectedCashFlow: number;
    let reasoning: string;
    const profits = {
      immediateLiquidation: immediateNetProfit,
      balancedRealization: balancedNetProfit,
      patientRealization: patientNetProfit,
    };
    if (patientNetProfit >= balancedNetProfit && patientNetProfit >= immediateNetProfit) {
      bestScenario = 'patientRealization';
      expectedCashFlow = scenarios.patientRealization.totalValue;
      reasoning = `Patient realizacija (90+ dni) prinaša najvišji net profit ${patientNetProfit}€ (vs ${immediateNetProfit}€ immediate). Če lahko čakaš na gotovo, izkoristi visoke cene — potrebno je vzdržati carrying cost ${Math.round(totalCarryingCostAccrued + patientAdditionalCarryingCost)}€.`;
    } else if (balancedNetProfit >= immediateNetProfit) {
      bestScenario = 'balancedRealization';
      expectedCashFlow = scenarios.balancedRealization.totalValue;
      reasoning = `Balanced realizacija (1/3 quick, 1/3 normal, 1/3 patient) prinaša optimalen cash flow ${balancedNetProfit}€ net profit. Dobra izbira če potrebuješ delno likvidnost zdaj, a želiš maksimirati profit.`;
    } else {
      bestScenario = 'immediateLiquidation';
      expectedCashFlow = scenarios.immediateLiquidation.totalValue;
      reasoning = `Immediate likvidacija (7 dni) prinaša ${immediateNetProfit}€ net profit — najnižji profit ampak najhitrejši cash. Priporočljivo če potrebuješ kapital za nove priložnosti ali če carrying cost preseže potencialni dodatni profit.`;
    }

    const recommendation: Recommendation = {
      bestScenario,
      reasoning,
      expectedCashFlow: Math.round(expectedCashFlow * 100) / 100,
    };

    return NextResponse.json({
      ok: true,
      portfolio: {
        totalItems: perItem.length,
        totalBuyPrice,
        totalEstimatedValue,
        totalUnrealizedProfit,
        totalCarryingCostAccrued,
      },
      perItem,
      scenarios,
      byCategory,
      recommendation,
    });
  } catch (err: any) {
    logger.error('/api/analytics/inventory-value-predictor', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
