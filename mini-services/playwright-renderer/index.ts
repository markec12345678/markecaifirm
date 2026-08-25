// v9.68: Playwright Renderer Service — mini service za JavaScript rendering.
//
// Ta service odpre URL v headless Chromium browserju in vrne rendered HTML.
// Uporablja se kot fallback ko fetchWithAntiDetection faila (Cloudflare, JS-heavy strani).
//
// Port: 3033 (fiksno, da ne konflikta z drugimi mini services)
//
// Endpoint: POST http://localhost:3033/render
// Body: { url: string, waitFor?: string, timeout?: number }
// Returns: { ok: boolean, html: string, status: number, title: string, durationMs: number }
//
// Uporaba iz aplikacije (prek Caddy gateway):
//   fetch('/api/render?XTransformPort=3033', { method: 'POST', body: JSON.stringify({ url }) })

// @ts-nocheck — mini service je standalone Bun projekt, ne del Next.js typecheck-a
import { chromium, type Browser } from 'playwright';

const PORT = 3033;

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-plugins',
        '--no-first-run',
        '--disable-background-networking',
      ],
    });
    console.log(`[playwright-renderer] Browser launched`);
  }
  return browser;
}

async function renderPage(url: string, waitFor?: string, timeoutMs = 30000) {
  const start = Date.now();
  const browser = await getBrowser();

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'sl-SI',
    timezoneId: 'Europe/Ljubljana',
  });

  const page = await context.newPage();

  try {
    // Block unnecessary resources for speed (images, fonts, media)
    await page.route('**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf,eot,mp4,webm}', (route) => {
      route.abort();
    });

    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: timeoutMs,
    });

    // Wait for specific selector if provided
    if (waitFor) {
      try {
        await page.waitForSelector(waitFor, { timeout: 10000 });
      } catch {
        // Continue even if selector not found
      }
    }

    const html = await page.content();
    const status = response?.status() ?? 200;
    const title = await page.title();

    return {
      ok: true,
      html,
      status,
      title,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message ?? 'Playwright render failed',
      durationMs: Date.now() - start,
    };
  } finally {
    await context.close();
  }
}

// Simple HTTP server (Bun native)
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (req.method === 'GET') {
      return Response.json({ ok: true, service: 'playwright-renderer', port: PORT }, { headers: corsHeaders });
    }

    if (req.method === 'POST') {
      try {
        const body = await req.json();
        const { url, waitFor, timeout } = body;

        if (!url) {
          return Response.json({ ok: false, error: 'Missing url' }, { status: 400, headers: corsHeaders });
        }

        console.log(`[playwright-renderer] Rendering: ${url}`);
        const result = await renderPage(url, waitFor, timeout);

        return Response.json(result, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json(
          { ok: false, error: err?.message ?? 'Server error' },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  },
});

console.log(`[playwright-renderer] Running on port ${PORT}`);

// Cleanup on exit
process.on('SIGTERM', async () => {
  if (browser) {
    await browser.close();
    console.log('[playwright-renderer] Browser closed');
  }
  server.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  if (browser) {
    await browser.close();
  }
  server.stop();
  process.exit(0);
});
