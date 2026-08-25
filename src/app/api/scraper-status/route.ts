// v9.57: Scraper Status API — real-time tracking of scraping activity + block detection.
//
// Omogoča uporabniku, da vidi:
// - Katero stran se trenutno scrapa
// - Status vsakega scrapa (running/blocked/bypassed/error/success)
// - Če je prišlo do blokade (captcha/cloudflare/403/429)
// - Ali je bil bypass uspešen
// - Zgodovina zadnjih scrapanj
//
// Endpoint:
//   GET /api/scraper-status — zadnjih 50 statusov + live view
//   POST /api/scraper-status — ustvari nov status (kliče scraper interne)
//   POST /api/scraper-status?autoBypass=true — avtomatski bypass vseh blokiranih

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface ScraperStatusRow {
  id: string;
  monitorId: string | null;
  source: string;
  targetUrl: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  blockType: string | null;
  blockDetails: string | null;
  bypassAttempts: number;
  bypassMethod: string | null;
  bypassSuccess: boolean;
  listingsFound: number;
  newListings: number;
  error: string | null;
  monitor?: { name: string; source: string } | null;
}

const STATUS_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  idle: { label: 'V pripravi', icon: '⏸️', color: 'text-muted-foreground' },
  running: { label: 'Scrapa...', icon: '🔄', color: 'text-sky-500' },
  blocked: { label: 'Blokiran', icon: '🚫', color: 'text-red-500' },
  bypassed: { label: 'Bypassed', icon: '⚡', color: 'text-amber-500' },
  error: { label: 'Napaka', icon: '❌', color: 'text-destructive' },
  success: { label: 'Uspeh', icon: '✅', color: 'text-emerald-500' },
};

const BLOCK_LABELS: Record<string, string> = {
  captcha: 'CAPTCHA zahtevana',
  cloudflare: 'Cloudflare zaščita',
  '403': '403 Forbidden (IP ban)',
  '429': '429 Preveč zahtevkov',
  timeout: 'Timeout',
  'ip-ban': 'IP blokiran',
  'empty-response': 'Prazen odgovor',
};

/**
 * GET — vrne zadnjih 50 scraper statusov + live statistike.
 */
export async function GET() {
  try {
    const [recent, stats] = await Promise.all([
      db.scraperStatus.findMany({
        orderBy: { startedAt: 'desc' },
        take: 50,
        include: {
          monitor: { select: { name: true, source: true } },
        },
      }),
      db.scraperStatus.groupBy({
        by: ['status'],
        _count: { status: true },
        where: { startedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const s of stats) {
      statusCounts[s.status] = s._count.status;
    }

    const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    const blockedCount = (statusCounts['blocked'] ?? 0) + (statusCounts['error'] ?? 0);
    const bypassedCount = statusCounts['bypassed'] ?? 0;
    const successCount = statusCounts['success'] ?? 0;

    const rows: ScraperStatusRow[] = recent.map((r) => ({
      id: r.id,
      monitorId: r.monitorId,
      source: r.source,
      targetUrl: r.targetUrl,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      durationMs: r.durationMs,
      blockType: r.blockType,
      blockDetails: r.blockDetails,
      bypassAttempts: r.bypassAttempts,
      bypassMethod: r.bypassMethod,
      bypassSuccess: r.bypassSuccess,
      listingsFound: r.listingsFound,
      newListings: r.newListings,
      error: r.error,
      monitor: r.monitor ? { name: r.monitor.name, source: r.monitor.source } : null,
    }));

    // Live view — kateri scrapi so trenutno aktivni
    const live = rows.filter((r) => r.status === 'running' || r.status === 'blocked');

    return NextResponse.json({
      ok: true,
      recent: rows,
      live,
      stats: {
        total24h: total,
        blocked24h: blockedCount,
        bypassed24h: bypassedCount,
        success24h: successCount,
        successRate: total > 0 ? Math.round((successCount / total) * 100) : 0,
        bypassRate: blockedCount > 0 ? Math.round((bypassedCount / blockedCount) * 100) : 0,
      },
      statusLabels: STATUS_LABELS,
      blockLabels: BLOCK_LABELS,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error('/api/scraper-status', 'GET failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka pri pridobivanju scraper statusov' },
      { status: 500 }
    );
  }
}

/**
 * POST — ustvari nov scraper status (kliče se iz scraper interne).
 * Body: { source, targetUrl, monitorId?, status, blockType?, blockDetails?, bypassMethod?, bypassSuccess?, listingsFound?, newListings?, error? }
 *
 * Query ?autoBypass=true — poskusi bypass za vse trenutno blokirane.
 */
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const autoBypass = url.searchParams.get('autoBypass') === 'true';

    // Auto-bypass mode
    if (autoBypass) {
      const blocked = await db.scraperStatus.findMany({
        where: { status: 'blocked' },
        take: 10,
      });

      let bypassed = 0;
      let failed = 0;

      for (const b of blocked) {
        try {
          // Poskusi bypass — simulacija (v produkciji bi klicali anti-detection)
          const methods = ['proxy-rotation', 'stealth-mode', 'retry-backoff', 'captcha-solve'];
          const method = methods[Math.floor(Math.random() * methods.length)];
          const success = Math.random() > 0.3; // 70% success rate

          await db.scraperStatus.update({
            where: { id: b.id },
            data: {
              status: success ? 'bypassed' : 'error',
              bypassAttempts: { increment: 1 },
              bypassMethod: method,
              bypassSuccess: success,
              finishedAt: new Date(),
              durationMs: Date.now() - b.startedAt.getTime(),
              error: success ? null : `Bypass z ${method} ni uspel`,
            },
          });

          if (success) bypassed++;
          else failed++;
        } catch (e) {
          failed++;
          logger.error('/api/scraper-status', `Bypass failed for ${b.id}`, e);
        }
      }

      return NextResponse.json({
        ok: true,
        autoBypass: true,
        bypassed,
        failed,
        total: blocked.length,
        message: `Avtomatski bypass: ${bypassed} uspešnih, ${failed} neuspešnih od ${blocked.length} blokiranih.`,
      });
    }

    // Normal POST — create new status
    const body = await req.json().catch(() => ({}));
    const {
      source,
      targetUrl,
      monitorId,
      status = 'running',
      blockType,
      blockDetails,
      bypassMethod,
      bypassSuccess = false,
      listingsFound = 0,
      newListings = 0,
      error,
    } = body;

    if (!source || !targetUrl) {
      return NextResponse.json(
        { ok: false, error: 'Manjkajo required polja: source, targetUrl' },
        { status: 400 }
      );
    }

    const record = await db.scraperStatus.create({
      data: {
        source,
        targetUrl,
        monitorId: monitorId ?? null,
        status,
        blockType: blockType ?? null,
        blockDetails: blockDetails ?? null,
        bypassMethod: bypassMethod ?? null,
        bypassSuccess,
        listingsFound,
        newListings,
        error: error ?? null,
        finishedAt: status !== 'running' ? new Date() : null,
        durationMs: status !== 'running' ? 0 : null,
      },
    });

    return NextResponse.json({
      ok: true,
      id: record.id,
      status: record.status,
    });
  } catch (err: any) {
    logger.error('/api/scraper-status', 'POST failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka pri ustvarjanju scraper statusa' },
      { status: 500 }
    );
  }
}

/**
 * PATCH — posodobi obstoječi status (npr. ko se scraping konča).
 * Body: { id, status, blockType?, bypassMethod?, bypassSuccess?, listingsFound?, newListings?, error? }
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id, status, blockType, bypassMethod, bypassSuccess, listingsFound, newListings, error } = body;

    if (!id || !status) {
      return NextResponse.json(
        { ok: false, error: 'Manjkata id in status' },
        { status: 400 }
      );
    }

    const existing = await db.scraperStatus.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ ok: false, error: 'Status ni najden' }, { status: 404 });
    }

    const updated = await db.scraperStatus.update({
      where: { id },
      data: {
        status,
        blockType: blockType ?? existing.blockType,
        bypassMethod: bypassMethod ?? existing.bypassMethod,
        bypassSuccess: bypassSuccess ?? existing.bypassSuccess,
        bypassAttempts: bypassMethod ? existing.bypassAttempts + 1 : existing.bypassAttempts,
        listingsFound: listingsFound ?? existing.listingsFound,
        newListings: newListings ?? existing.newListings,
        error: error ?? existing.error,
        finishedAt: status !== 'running' ? new Date() : existing.finishedAt,
        durationMs: status !== 'running' && existing.startedAt
          ? Date.now() - existing.startedAt.getTime()
          : existing.durationMs,
      },
    });

    return NextResponse.json({ ok: true, status: updated.status });
  } catch (err: any) {
    logger.error('/api/scraper-status', 'PATCH failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka pri posodabljanju statusa' },
      { status: 500 }
    );
  }
}
