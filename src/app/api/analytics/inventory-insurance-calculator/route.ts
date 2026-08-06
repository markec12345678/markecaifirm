// v7.61: Inventory Insurance Calculator — izračun zavarovalnih potreb za
// HELD inventar glede na skupno vrednost, kategorijo (theft risk), in
// 3 opcije pokritja (BASIC / STANDARD / PREMIUM). Pure DB analytics — NO AI.
//
// "Skladišče 4500€ vrednosti → STANDARD zavarovanje, 157€/leto, pokrije 6750€"
//
// GET /api/analytics/inventory-insurance-calculator

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Config --------------------------------------------------------------

// Category risk multipliers (annual premium baseline modifiers):
// elektronika: 1.5 (high theft risk, easily resold on black market)
// avto: 2.0 (highest value, mandatory insurance in most countries)
// moda: 0.5 (low value, low risk)
// orodje: 1.0 (medium)
// drugo: 1.0
const CATEGORY_RISK_MULTIPLIER: Record<string, number> = {
  elektronika: 1.5,
  avto: 2.0,
  moda: 0.5,
  orodje: 1.0,
  drugo: 1.0,
};

// High-value item threshold (€)
const HIGH_VALUE_THRESHOLD = 500;

// Insurance coverage options — annual premium as % of replacement cost
const COVERAGE_OPTIONS = [
  {
    name: 'BASIC' as const,
    premiumRate: 0.02, // 2% / year
    perils: ['kraja', 'požar'],
    deductibleRate: 0.10, // 10% deductible
    description: 'BASIC — pokritje kraja in požara. Osnovno zavarovanje za nizko-vrednostne inventarje.',
  },
  {
    name: 'STANDARD' as const,
    premiumRate: 0.035, // 3.5% / year
    perils: ['kraja', 'požar', 'voda', 'vandalizem'],
    deductibleRate: 0.05, // 5% deductible
    description: 'STANDARD — kraja, požar, voda, vandalizem. Priporočeno za mešan inventar.',
  },
  {
    name: 'PREMIUM' as const,
    premiumRate: 0.05, // 5% / year
    perils: ['kraja', 'požar', 'voda', 'vandalizem', 'transport', 'deprecijacija', 'vsi riziki'],
    deductibleRate: 0.02, // 2% deductible
    description: 'PREMIUM — all-risk + transport + deprecijacija. Za visoko-vrednostne item-e (avto, elektronika).',
  },
];

// --- Types ---------------------------------------------------------------

type CoverageName = 'BASIC' | 'STANDARD' | 'PREMIUM';
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

interface CategoryBreakdownEntry {
  category: string;
  itemCount: number;
  totalValue: number;
  riskMultiplier: number;
  riskScore: number;
  highValueCount: number;
}

interface CoverageOption {
  name: CoverageName;
  coverageAmount: number;
  annualPremium: number;
  monthlyPremium: number;
  deductible: number;
  coveredPerils: string[];
  description: string;
}

interface PortfolioSummary {
  totalItems: number;
  totalInventoryValue: number;
  totalReplacementCost: number;
  highValueItems: number;
  avgItemValue: number;
}

interface Recommendation {
  recommendedOption: string;
  reasoning: string;
  riskLevel: RiskLevel;
}

// --- Helpers -------------------------------------------------------------

function getRiskMultiplier(category: string): number {
  return CATEGORY_RISK_MULTIPLIER[category] ?? 1.0;
}

// Normalize category string (lowercase, trimmed, fallback 'drugo')
function normalizeCategory(c: string | null | undefined): string {
  const s = (c || '').trim().toLowerCase();
  if (!s) return 'drugo';
  // Map common synonyms
  if (s.includes('elektron') || s.includes('phone') || s.includes('ps5') || s.includes('laptop')) return 'elektronika';
  if (s.includes('avto') || s.includes('vw') || s.includes('bmw') || s.includes('audi')) return 'avto';
  if (s.includes('moda') || s.includes('jakna') || s.includes('čevelj') || s.includes('oblač')) return 'moda';
  if (s.includes('orodj') || s.includes('tool')) return 'orodje';
  if (CATEGORY_RISK_MULTIPLIER[s] !== undefined) return s;
  return 'drugo';
}

// Determine recommended option based on portfolio size + risk profile
function recommendOption(
  totalReplacementCost: number,
  highValueCount: number,
  avgItemValue: number,
  riskScores: number[],
): { option: CoverageName; riskLevel: RiskLevel; reasoning: string } {
  // Risk level
  // HIGH if total > 5000€ OR high-value items > 3 OR avg item > 400€
  // LOW if total < 1000€ AND high-value items = 0 AND avg < 100€
  // MEDIUM otherwise
  let riskLevel: RiskLevel = 'MEDIUM';
  if (totalReplacementCost > 5000 || highValueCount > 3 || avgItemValue > 400) {
    riskLevel = 'HIGH';
  } else if (totalReplacementCost < 1000 && highValueCount === 0 && avgItemValue < 100) {
    riskLevel = 'LOW';
  }

  // Max risk score across categories
  const maxRiskScore = riskScores.length > 0 ? Math.max(...riskScores) : 0;

  // Recommend option
  let option: CoverageName;
  let reasoning: string;
  if (riskLevel === 'HIGH' || maxRiskScore >= 70) {
    option = 'PREMIUM';
    reasoning = `Portfelj je HIGH-risk (skupna replacement cost ${totalReplacementCost}€, ${highValueCount} high-value item-ov). PREMIUM all-risk zavarovanje pokrije transport in deprecijacijo — ključno za visoko-vrednostne item-e.`;
  } else if (riskLevel === 'MEDIUM' || maxRiskScore >= 35) {
    option = 'STANDARD';
    reasoning = `Portfelj je MEDIUM-risk (skupna replacement cost ${totalReplacementCost}€). STANDARD pokrije krajo + požar + vodo + vandalizem — primerna zaščita za mešan inventar z nekaj high-value item-i.`;
  } else {
    option = 'BASIC';
    reasoning = `Portfelj je LOW-risk (skupna replacement cost ${totalReplacementCost}€, ${highValueCount} high-value item-ov). BASIC pokritje kraje in požara je dovolj za nizko-vrednostni inventar.`;
  }

  return { option, riskLevel, reasoning };
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    // 1) HELD trades with linked Listing (for aiEstimatedValue, category)
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
          },
        },
      },
      take: 1000,
    });

    // Graceful handling: empty portfolio
    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        portfolio: {
          totalItems: 0,
          totalInventoryValue: 0,
          totalReplacementCost: 0,
          highValueItems: 0,
          avgItemValue: 0,
        },
        categoryBreakdown: [],
        coverageOptions: [],
        recommendation: {
          recommendedOption: '',
          reasoning: 'Skladišče je prazno — ni inventarja za zavarovanje.',
          riskLevel: 'LOW',
        },
        message: 'Ni held inventarja — kalkulator zavarovanja ni mogoč.',
      });
    }

    // 2) Compute per-item currentValue + category
    interface ItemData {
      id: string;
      category: string;
      currentValue: number;
      isHighValue: boolean;
    }
    const items: ItemData[] = heldTrades.map(t => {
      const estValue =
        t.listing?.aiEstimatedValue && t.listing.aiEstimatedValue > 0
          ? t.listing.aiEstimatedValue
          : t.buyPrice;
      const category = normalizeCategory(t.category);
      const currentValue = Math.round(estValue);
      return {
        id: t.id,
        category,
        currentValue,
        isHighValue: currentValue > HIGH_VALUE_THRESHOLD,
      };
    });

    // 3) Portfolio totals
    const totalInventoryValue = items.reduce((s, i) => s + i.currentValue, 0);
    const totalReplacementCost = items.reduce(
      (s, i) => s + i.currentValue * getRiskMultiplier(i.category),
      0,
    );
    const highValueItems = items.filter(i => i.isHighValue).length;
    const avgItemValue = items.length > 0 ? Math.round(totalInventoryValue / items.length) : 0;

    const portfolio: PortfolioSummary = {
      totalItems: items.length,
      totalInventoryValue: Math.round(totalInventoryValue),
      totalReplacementCost: Math.round(totalReplacementCost),
      highValueItems,
      avgItemValue,
    };

    // 4) Per-category breakdown
    const catMap = new Map<
      string,
      { itemCount: number; totalValue: number; highValueCount: number }
    >();
    for (const i of items) {
      const cur = catMap.get(i.category) || { itemCount: 0, totalValue: 0, highValueCount: 0 };
      cur.itemCount += 1;
      cur.totalValue += i.currentValue;
      if (i.isHighValue) cur.highValueCount += 1;
      catMap.set(i.category, cur);
    }

    const categoryBreakdown: CategoryBreakdownEntry[] = Array.from(catMap.entries()).map(
      ([category, d]) => {
        const riskMultiplier = getRiskMultiplier(category);
        // riskScore 0-100: combination of (category risk × totalValue)
        // High value × high multiplier = high risk score
        const valueComponent = Math.min(80, d.totalValue / 100); // 100€ = 1 point, cap 80
        const multiplierComponent = (riskMultiplier - 0.5) * 8; // 0.5 → 0, 2.0 → 12, scaled
        const highValueBoost = Math.min(20, d.highValueCount * 5);
        const riskScore = Math.round(
          Math.max(0, Math.min(100, valueComponent + multiplierComponent + highValueBoost)),
        );
        return {
          category,
          itemCount: d.itemCount,
          totalValue: Math.round(d.totalValue),
          riskMultiplier,
          riskScore,
          highValueCount: d.highValueCount,
        };
      },
    );
    categoryBreakdown.sort((a, b) => b.riskScore - a.riskScore);

    // 5) Coverage options
    const coverageOptions: CoverageOption[] = COVERAGE_OPTIONS.map(opt => {
      const annualPremium = Math.round(totalReplacementCost * opt.premiumRate);
      const monthlyPremium = Math.round((annualPremium / 12) * 100) / 100;
      const deductible = Math.round(totalReplacementCost * opt.deductibleRate);
      return {
        name: opt.name,
        coverageAmount: Math.round(totalReplacementCost),
        annualPremium,
        monthlyPremium,
        deductible,
        coveredPerils: opt.perils,
        description: opt.description,
      };
    });

    // 6) Recommendation
    const riskScores = categoryBreakdown.map(c => c.riskScore);
    const rec = recommendOption(
      Math.round(totalReplacementCost),
      highValueItems,
      avgItemValue,
      riskScores,
    );

    const recommendation: Recommendation = {
      recommendedOption: rec.option,
      reasoning: rec.reasoning,
      riskLevel: rec.riskLevel,
    };

    return NextResponse.json({
      ok: true,
      portfolio,
      categoryBreakdown,
      coverageOptions,
      recommendation,
    });
  } catch (err: any) {
    logger.error('/api/analytics/inventory-insurance-calculator', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
