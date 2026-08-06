// v7.59: Supplier Relationship Manager (CRM) — CRM za stalne dobavitelje
// (sellerje od katerih si kupoval). Razlika od competitor-tracker:
// ta je RELATIONSHIP MANAGEMENT orodje (trust tiers, negotiation history,
// reliability) — ne samo listing tracking.
//
// "Janez Novak — PLATINUM (5 nakupov, 100% win rate, 80%+ profitabilnost,
//  2.450€ total spent). Kupuj več od njega!"
//
// Pure DB analytics (NO AI). Trust tiers:
//   PLATINUM — 5+ purchases, 80%+ profitable
//   GOLD     — 3+ purchases, 60%+ profitable
//   SILVER   — 2+ purchases
//   BRONZE   — 1 purchase
//
// GET /api/analytics/supplier-crm

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;

type TrustTier = 'PLATINUM' | 'GOLD' | 'SILVER' | 'BRONZE';

interface SupplierEntry {
  sellerName: string;
  trustTier: TrustTier;
  purchasesCount: number;
  totalSpent: number;
  avgPurchasePrice: number;
  firstPurchaseDate: string;
  lastPurchaseDate: string;
  relationshipDuration: number;
  categories: string[];
  avgDealScore: number;
  profitFromSupplier: number;
  itemsStillHeld: number;
  reliabilityScore: number; // 0-100
  preferredContactMethod: string;
  recentTrades: Array<{
    title: string;
    buyPrice: number;
    buyDate: string;
    status: string;
  }>;
}

interface CrmSummary {
  totalSuppliers: number;
  platinum: number;
  gold: number;
  silver: number;
  bronze: number;
  totalLifetimeSpend: number;
  totalProfitFromSuppliers: number;
  topSupplier: string | null;
}

// Infer preferred contact method from trade notes
function inferContactMethod(notes: string): 'telegram' | 'phone' | 'bolha-msg' {
  const lower = (notes || '').toLowerCase();
  if (lower.includes('telegram') || lower.includes('tg') || lower.includes('@')) {
    return 'telegram';
  }
  if (
    lower.includes('telefon') ||
    lower.includes('phone') ||
    lower.includes('klic') ||
    /\b0\d{2,3}\s?\d{3}\s?\d{3}\b/.test(lower) // SI phone pattern
  ) {
    return 'phone';
  }
  return 'bolha-msg';
}

// Reliability score: how close was the AI estimate to the actual sell price?
// 0-100. Higher = more reliable estimates.
function computeReliabilityScore(
  estimatesVsActuals: Array<{ estValue: number; actualSell: number }>,
): number {
  if (estimatesVsActuals.length === 0) return 50; // neutral — no data
  let totalDeviation = 0;
  let count = 0;
  for (const { estValue, actualSell } of estimatesVsActuals) {
    if (estValue <= 0 || actualSell <= 0) continue;
    const deviation = Math.abs(estValue - actualSell) / Math.max(estValue, actualSell);
    totalDeviation += deviation;
    count += 1;
  }
  if (count === 0) return 50;
  const avgDeviation = totalDeviation / count;
  // reliability = 100 × (1 - deviation), clamped to [0, 100]
  const score = Math.round((1 - avgDeviation) * 100);
  return Math.max(0, Math.min(100, score));
}

function computeTrustTier(
  purchasesCount: number,
  profitCount: number,
  soldCount: number,
): TrustTier {
  const profitableRate = soldCount > 0 ? profitCount / soldCount : 0;
  if (purchasesCount >= 5 && profitableRate >= 0.80) return 'PLATINUM';
  if (purchasesCount >= 3 && profitableRate >= 0.60) return 'GOLD';
  if (purchasesCount >= 2) return 'SILVER';
  return 'BRONZE';
}

const TIER_RANK: Record<TrustTier, number> = {
  PLATINUM: 4,
  GOLD: 3,
  SILVER: 2,
  BRONZE: 1,
};

export async function GET() {
  try {
    // 1) Query all SOLD and HELD trades with linked Listing (for sellerName + dealScore + estValue)
    const trades = await db.trade.findMany({
      where: {
        status: { in: ['sold', 'held'] },
        listing: { isNot: null },
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
        status: true,
        notes: true,
        listing: {
          select: {
            sellerName: true,
            dealScore: true,
            aiEstimatedValue: true,
          },
        },
      },
      take: 2000,
      orderBy: { buyDate: 'desc' },
    });

    // 2) Group by sellerName (only non-null sellers)
    interface SellerAgg {
      sellerName: string;
      purchasesCount: number;
      totalSpent: number;
      firstBuyDate: Date;
      lastBuyDate: Date;
      categories: Set<string>;
      dealScores: number[];
      profitFromSupplier: number;
      itemsStillHeld: number;
      soldCount: number;
      profitCount: number;
      reliabilitySamples: Array<{ estValue: number; actualSell: number }>;
      notesConcat: string;
      recentTrades: Array<{
        title: string;
        buyPrice: number;
        buyDate: string;
        status: string;
      }>;
    }
    const sellerMap = new Map<string, SellerAgg>();

    for (const t of trades) {
      const seller = t.listing?.sellerName;
      if (!seller || seller.trim() === '') continue;
      const cur =
        sellerMap.get(seller) ||
        ({
          sellerName: seller,
          purchasesCount: 0,
          totalSpent: 0,
          firstBuyDate: new Date(t.buyDate),
          lastBuyDate: new Date(t.buyDate),
          categories: new Set<string>(),
          dealScores: [],
          profitFromSupplier: 0,
          itemsStillHeld: 0,
          soldCount: 0,
          profitCount: 0,
          reliabilitySamples: [],
          notesConcat: '',
          recentTrades: [],
        });
      cur.purchasesCount += 1;
      const buyCost = t.buyPrice + (t.buyFees ?? 0);
      cur.totalSpent += buyCost;
      cur.firstBuyDate =
        new Date(t.buyDate) < cur.firstBuyDate ? new Date(t.buyDate) : cur.firstBuyDate;
      cur.lastBuyDate =
        new Date(t.buyDate) > cur.lastBuyDate ? new Date(t.buyDate) : cur.lastBuyDate;
      const cat = (t.category || '').trim();
      if (cat) cur.categories.add(cat);
      if (t.listing?.dealScore != null) cur.dealScores.push(t.listing.dealScore);

      if (t.status === 'held') {
        cur.itemsStillHeld += 1;
      } else if (t.status === 'sold' && t.sellPrice != null) {
        cur.soldCount += 1;
        const profit =
          (t.sellPrice ?? 0) - (t.sellFees ?? 0) - buyCost;
        cur.profitFromSupplier += profit;
        if (profit > 0) cur.profitCount += 1;
        // Reliability sample: estValue vs actual sell
        const estValue = t.listing?.aiEstimatedValue ?? 0;
        if (estValue > 0) {
          cur.reliabilitySamples.push({
            estValue,
            actualSell: t.sellPrice ?? 0,
          });
        }
      }
      if (t.notes) cur.notesConcat += ' ' + t.notes;
      // Keep most recent 5 trades (input is ordered DESC by buyDate)
      if (cur.recentTrades.length < 5) {
        cur.recentTrades.push({
          title: t.title,
          buyPrice: t.buyPrice,
          buyDate: new Date(t.buyDate).toISOString(),
          status: t.status,
        });
      }
      sellerMap.set(seller, cur);
    }

    if (sellerMap.size === 0) {
      return NextResponse.json({
        ok: true,
        suppliers: [],
        summary: {
          totalSuppliers: 0,
          platinum: 0,
          gold: 0,
          silver: 0,
          bronze: 0,
          totalLifetimeSpend: 0,
          totalProfitFromSuppliers: 0,
          topSupplier: null,
        },
        message:
          'Ni sledenih dobaviteljev — sellerName ni populiran na nobenem od vaših Listingov.',
      });
    }

    // 3) Build supplier entries
    const suppliers: SupplierEntry[] = [];
    for (const agg of sellerMap.values()) {
      const avgPurchasePrice =
        agg.purchasesCount > 0
          ? Math.round(agg.totalSpent / agg.purchasesCount)
          : 0;
      const avgDealScore =
        agg.dealScores.length > 0
          ? Math.round(
              agg.dealScores.reduce((s, v) => s + v, 0) / agg.dealScores.length,
            )
          : 0;
      const trustTier = computeTrustTier(
        agg.purchasesCount,
        agg.profitCount,
        agg.soldCount,
      );
      const reliabilityScore = computeReliabilityScore(agg.reliabilitySamples);
      const relationshipDuration = Math.max(
        0,
        Math.round(
          (agg.lastBuyDate.getTime() - agg.firstBuyDate.getTime()) / DAY_MS,
        ),
      );
      const preferredContactMethod = inferContactMethod(agg.notesConcat);

      suppliers.push({
        sellerName: agg.sellerName,
        trustTier,
        purchasesCount: agg.purchasesCount,
        totalSpent: Math.round(agg.totalSpent),
        avgPurchasePrice,
        firstPurchaseDate: agg.firstBuyDate.toISOString(),
        lastPurchaseDate: agg.lastBuyDate.toISOString(),
        relationshipDuration,
        categories: Array.from(agg.categories).slice(0, 10),
        avgDealScore,
        profitFromSupplier: Math.round(agg.profitFromSupplier),
        itemsStillHeld: agg.itemsStillHeld,
        reliabilityScore,
        preferredContactMethod,
        recentTrades: agg.recentTrades,
      });
    }

    // 4) Sort: trustTier (PLATINUM first), then totalSpent desc
    suppliers.sort((a, b) => {
      const tierDiff = TIER_RANK[b.trustTier] - TIER_RANK[a.trustTier];
      if (tierDiff !== 0) return tierDiff;
      return b.totalSpent - a.totalSpent;
    });

    // 5) Summary
    const summary: CrmSummary = {
      totalSuppliers: suppliers.length,
      platinum: suppliers.filter(s => s.trustTier === 'PLATINUM').length,
      gold: suppliers.filter(s => s.trustTier === 'GOLD').length,
      silver: suppliers.filter(s => s.trustTier === 'SILVER').length,
      bronze: suppliers.filter(s => s.trustTier === 'BRONZE').length,
      totalLifetimeSpend: suppliers.reduce((s, x) => s + x.totalSpent, 0),
      totalProfitFromSuppliers: suppliers.reduce(
        (s, x) => s + x.profitFromSupplier,
        0,
      ),
      topSupplier: suppliers.length > 0 ? suppliers[0].sellerName : null,
    };

    return NextResponse.json({
      ok: true,
      suppliers: suppliers.slice(0, 50),
      summary,
    });
  } catch (err: any) {
    logger.error('/api/analytics/supplier-crm', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
