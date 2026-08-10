// v7.58: Listing Performance Tracker — za HELD inventar (status='held') spremlja
// kako dobro vsak item performira glede na čas-do-prodaje, kontaktne aktivnosti,
// price-drop zgodovino in AI estimated value. Identificira "stale" oglase.
//
// "PS5 45 dni v zalogi, 0 kontaktov, cena že padla → RELIST"
// "iPhone 13 8 dni, 3 kontakti → KEEP"
//
// GET /api/analytics/listing-performance

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;

type ItemStatus = 'FRESH' | 'ACTIVE' | 'AGING' | 'STALE' | 'DEAD';
type RecommendedAction = 'KEEP' | 'PRICE_DROP' | 'RELIST' | 'LIQUIDATE';

interface PerformanceItem {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  aiEstimatedValue: number | null;
  potentialProfit: number | null;
  daysHeld: number;
  daysListed: number;
  contactCount: number;
  priceDropped: boolean;
  daysSincePriceDrop: number | null;
  isBookmarked: boolean;
  dealScore: number | null;
  staleScore: number;
  status: ItemStatus;
  recommendedAction: RecommendedAction;
}

function statusForDays(daysHeld: number): ItemStatus {
  if (daysHeld > 90) return 'DEAD';
  if (daysHeld > 60) return 'STALE';
  if (daysHeld > 30) return 'AGING';
  if (daysHeld > 7) return 'ACTIVE';
  return 'FRESH';
}

function recommendedActionFor(status: ItemStatus, contactCount: number): RecommendedAction {
  switch (status) {
    case 'DEAD':
      return 'LIQUIDATE';
    case 'STALE':
      return 'RELIST';
    case 'AGING':
      // AGING with no contacts → PRICE_DROP, with contacts → KEEP
      return contactCount > 0 ? 'KEEP' : 'PRICE_DROP';
    case 'FRESH':
    case 'ACTIVE':
    default:
      return 'KEEP';
  }
}

export async function GET() {
  try {
    // 1) Query all HELD trades with their linked Listing
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyDate: true,
        listing: {
          select: {
            id: true,
            firstSeenAt: true,
            contactStatus: true,
            priceDroppedAt: true,
            isBookmarked: true,
            dealScore: true,
            aiEstimatedValue: true,
          },
        },
      },
      take: 1000,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        items: [],
        summary: {
          totalHeld: 0,
          avgDaysHeld: 0,
          fresh: 0,
          active: 0,
          aging: 0,
          stale: 0,
          dead: 0,
          totalCapitalTied: 0,
          potentialTotalProfit: 0,
        },
        actionPlan: { priceDropItems: 0, relistItems: 0, liquidateItems: 0 },
        message: 'Ni held inventarja — nič za slediti.',
      });
    }

    const now = Date.now();

    // 2) Compute metrics for each held item
    const items: PerformanceItem[] = heldTrades.map(t => {
      const buyDateMs = new Date(t.buyDate).getTime();
      const daysHeld = Math.max(0, Math.floor((now - buyDateMs) / DAY_MS));

      // daysListed: days since listing.firstSeenAt (or buyDate if no listing)
      const firstSeenAtMs = t.listing?.firstSeenAt
        ? new Date(t.listing.firstSeenAt).getTime()
        : buyDateMs;
      const daysListed = Math.max(0, Math.floor((now - firstSeenAtMs) / DAY_MS));

      // contactCount: count of listings with contactStatus != 'none'
      // (each held trade has at most 1 linked listing, so it's 0 or 1)
      const contactCount = t.listing && t.listing.contactStatus && t.listing.contactStatus !== 'none' ? 1 : 0;

      // priceDrops
      const priceDroppedAt = t.listing?.priceDroppedAt ?? null;
      const priceDropped = priceDroppedAt !== null;
      const daysSincePriceDrop = priceDroppedAt
        ? Math.max(0, Math.floor((now - new Date(priceDroppedAt).getTime()) / DAY_MS))
        : null;

      const isBookmarked = t.listing?.isBookmarked ?? false;
      const dealScore = t.listing?.dealScore ?? null;
      const aiEstimatedValue = t.listing?.aiEstimatedValue ?? null;
      const potentialProfit = aiEstimatedValue != null
        ? Math.round(aiEstimatedValue - t.buyPrice)
        : null;

      // staleScore = daysHeld * (1 + priceDrops * 0.5) - contactCount * 2
      // priceDrops boolean treated as 0/1
      const priceDropFactor = priceDropped ? 1 : 0;
      const staleScore = Math.round(
        (daysHeld * (1 + priceDropFactor * 0.5) - contactCount * 2) * 10,
      ) / 10;

      const status = statusForDays(daysHeld);
      const recommendedAction = recommendedActionFor(status, contactCount);

      return {
        tradeId: t.id,
        title: t.title,
        category: (t.category && t.category.trim() !== '') ? t.category.trim() : 'drugo',
        buyPrice: Math.round(t.buyPrice),
        aiEstimatedValue,
        potentialProfit,
        daysHeld,
        daysListed,
        contactCount,
        priceDropped,
        daysSincePriceDrop,
        isBookmarked,
        dealScore,
        staleScore,
        status,
        recommendedAction,
      };
    });

    // 3) Sort by staleScore desc (most stale first)
    items.sort((a, b) => b.staleScore - a.staleScore);

    // 4) Summary
    const totalHeld = items.length;
    const avgDaysHeld = totalHeld > 0
      ? Math.round(items.reduce((s, i) => s + i.daysHeld, 0) / totalHeld)
      : 0;
    const fresh = items.filter(i => i.status === 'FRESH').length;
    const active = items.filter(i => i.status === 'ACTIVE').length;
    const aging = items.filter(i => i.status === 'AGING').length;
    const stale = items.filter(i => i.status === 'STALE').length;
    const dead = items.filter(i => i.status === 'DEAD').length;
    const totalCapitalTied = Math.round(items.reduce((s, i) => s + i.buyPrice, 0));
    const potentialTotalProfit = items.reduce(
      (s, i) => s + (i.potentialProfit ?? 0),
      0,
    );

    // 5) Action plan
    const priceDropItems = items.filter(i => i.recommendedAction === 'PRICE_DROP').length;
    const relistItems = items.filter(i => i.recommendedAction === 'RELIST').length;
    const liquidateItems = items.filter(i => i.recommendedAction === 'LIQUIDATE').length;

    return NextResponse.json({
      ok: true,
      items,
      summary: {
        totalHeld,
        avgDaysHeld,
        fresh,
        active,
        aging,
        stale,
        dead,
        totalCapitalTied,
        potentialTotalProfit: Math.round(potentialTotalProfit),
      },
      actionPlan: {
        priceDropItems,
        relistItems,
        liquidateItems,
      },
    });
  } catch (err: any) {
    logger.error('/api/analytics/listing-performance', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
