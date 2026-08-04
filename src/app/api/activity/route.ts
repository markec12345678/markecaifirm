import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/activity
 * Returns unified activity feed: recent alerts, trades, price drops, contact changes.
 * Sorted by date, limited to 20 items.
 */
export async function GET() {
  try {
    const limit = 20;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // last 7 days

    const [alerts, trades, priceDrops] = await Promise.all([
      // Recent alerts
      db.alert.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true, title: true, url: true, aiVerdict: true, aiScore: true,
          createdAt: true, isArchived: true,
          monitor: { select: { name: true } },
        },
      }),
      // Recent trades (buy or sell)
      db.trade.findMany({
        where: { OR: [{ buyDate: { gte: since } }, { sellDate: { gte: since } }] },
        orderBy: { updatedAt: 'desc' },
        take: 6,
        select: {
          id: true, title: true, status: true, buyPrice: true, sellPrice: true,
          buyDate: true, sellDate: true, category: true,
        },
      }),
      // Recent price drops
      db.listing.findMany({
        where: { priceDroppedAt: { gte: since } },
        orderBy: { priceDroppedAt: 'desc' },
        take: 6,
        select: {
          id: true, title: true, price: true, previousPrice: true, priceText: true,
          url: true, priceDroppedAt: true,
          monitor: { select: { name: true } },
        },
      }),
    ]);

    // Build unified feed
    const feed: Array<{
      type: 'alert' | 'trade_buy' | 'trade_sell' | 'price_drop';
      timestamp: string;
      title: string;
      subtitle: string;
      url?: string;
      badge?: string;
      badgeColor?: string;
    }> = [];

    for (const a of alerts) {
      feed.push({
        type: 'alert',
        timestamp: a.createdAt.toISOString(),
        title: a.title,
        subtitle: a.monitor.name,
        url: a.url,
        badge: a.aiVerdict ?? undefined,
        badgeColor: a.aiVerdict === 'PRILIKA' ? 'text-primary' : a.aiVerdict === 'SUMNJIVO' ? 'text-amber-400' : 'text-muted-foreground',
      });
    }

    for (const t of trades) {
      if (t.sellDate) {
        const profit = (t.sellPrice ?? 0) - t.buyPrice;
        feed.push({
          type: 'trade_sell',
          timestamp: t.sellDate.toISOString(),
          title: `💰 Prodano: ${t.title}`,
          subtitle: `${t.sellPrice}€ (profit: ${profit >= 0 ? '+' : ''}${profit.toFixed(0)}€)`,
          badge: 'PRODANO',
          badgeColor: 'text-primary',
        });
      } else {
        feed.push({
          type: 'trade_buy',
          timestamp: t.buyDate.toISOString(),
          title: `🛒 Kupljeno: ${t.title}`,
          subtitle: `${t.buyPrice}€${t.category ? ` • ${t.category}` : ''}`,
          badge: 'KUPENO',
          badgeColor: 'text-amber-400',
        });
      }
    }

    for (const p of priceDrops) {
      const diff = p.previousPrice != null && p.price != null ? p.previousPrice - p.price : 0;
      const pct = p.previousPrice != null && p.previousPrice > 0 ? Math.round((diff / p.previousPrice) * 100) : 0;
      feed.push({
        type: 'price_drop',
        timestamp: (p.priceDroppedAt ?? new Date()).toISOString(),
        title: `📉 Cena padla: ${p.title}`,
        subtitle: `${p.priceText} (prej ${p.previousPrice}€, -${pct}%)`,
        url: p.url,
        badge: `-${pct}%`,
        badgeColor: 'text-primary',
      });
    }

    // Sort by timestamp descending
    feed.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json({ feed: feed.slice(0, limit) });

  } catch (err) {
    logger.error("/api/activity", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
