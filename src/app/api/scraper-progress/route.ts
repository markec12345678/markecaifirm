import { NextResponse } from 'next/server';
import { getAllProgress } from '@/lib/scraper-progress';

export const dynamic = 'force-dynamic';

/** GET — SSE stream of scraper progress. Connect via EventSource. */
export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: any) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* controller closed */ }
      };

      // Send current state immediately
      send(getAllProgress());

      // Poll every 1s and stream updates
      const interval = setInterval(() => {
        const all = getAllProgress();
        send(all);
      }, 1000);

      // Cleanup on close
      const cleanup = () => {
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
      };

      // Close after 5 minutes max
      setTimeout(cleanup, 300_000);

      // Auto-close when all done (checked by client via onmessage)
      // Client closes the connection
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
