// v4.9: Server-Sent Events (SSE) for real-time alerts
// GET /api/alerts/stream — long-lived SSE connection
//
// Client receives events:
//   - 'alert' (new alert created)
//   - 'listing' (new listing scraped)
//   - 'heartbeat' (keep-alive every 30s)
//   - 'stats' (stats update)
//
// Uses polling internally (SQLite doesn't support subscriptions).
// Client should reconnect on disconnect (EventSource does this automatically).

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Disable body parsing for SSE
export const maxDuration = 300; // 5 minutes max

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let lastAlertId: string | null = null;
      let lastListingCheck = new Date();
      let isClosed = false;

      const send = (event: string, data: any) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          isClosed = true;
        }
      };

      // Send initial hello
      send('hello', {
        message: 'Povezan z Markec AI Firm SSE',
        timestamp: new Date().toISOString(),
      });

      // Get initial counts
      try {
        const [totalAlerts, unreadAlerts, totalListings, activeMonitors] = await Promise.all([
          db.alert.count(),
          db.alert.count({ where: { isRead: false, isArchived: false } }),
          db.listing.count(),
          db.monitor.count({ where: { isActive: true } }),
        ]);
        send('stats', { totalAlerts, unreadAlerts, totalListings, activeMonitors });
      } catch { /* ignore */ }

      // Polling loop — check every 5 seconds
      const pollInterval = setInterval(async () => {
        if (isClosed) return;
        try {
          // Check for new alerts
          const recentAlerts = await db.alert.findMany({
            where: { createdAt: { gte: new Date(Date.now() - 60_000) } },
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
              id: true, title: true, url: true, aiVerdict: true,
              aiScore: true, aiRisk: true, createdAt: true,
              monitor: { select: { name: true, source: true } },
            },
          });

          for (const a of recentAlerts) {
            if (lastAlertId !== a.id) {
              send('alert', a);
              lastAlertId = a.id;
            }
          }

          // Check for new listings
          const newListings = await db.listing.findMany({
            where: { firstSeenAt: { gte: lastListingCheck } },
            orderBy: { firstSeenAt: 'desc' },
            take: 10,
            select: {
              id: true, title: true, price: true, priceText: true, url: true,
              firstSeenAt: true, aiVerdict: true,
              monitor: { select: { name: true, source: true } },
            },
          });
          if (newListings.length > 0) {
            lastListingCheck = new Date();
            send('listing', { count: newListings.length, listings: newListings });
          }

          // Send updated stats
          const [totalAlerts, unreadAlerts, totalListings, activeMonitors] = await Promise.all([
            db.alert.count(),
            db.alert.count({ where: { isRead: false, isArchived: false } }),
            db.listing.count(),
            db.monitor.count({ where: { isActive: true } }),
          ]);
          send('stats', { totalAlerts, unreadAlerts, totalListings, activeMonitors });
        } catch (e) {
          // Ignore DB errors, keep connection alive
        }
      }, 5000);

      // Heartbeat every 30s
      const heartbeatInterval = setInterval(() => {
        if (isClosed) return;
        send('heartbeat', { timestamp: new Date().toISOString() });
      }, 30_000);

      // Cleanup on cancel (client disconnect)
      const cleanup = () => {
        isClosed = true;
        clearInterval(pollInterval);
        clearInterval(heartbeatInterval);
        try { controller.close(); } catch { /* ignore */ }
      };

      // Listen for abort signal (client disconnect)
      req.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      // Stream cancelled
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
