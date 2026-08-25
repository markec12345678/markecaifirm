// v9.57: Bypass posameznega blokiranega scraperja.
// POST /api/scraper-status/[id]/bypass
// Body: { method?: 'auto' | 'proxy-rotation' | 'stealth-mode' | 'captcha-solve' | 'retry-backoff' | 'playwright' }
//
// Poskusi bypass za določen scraper status.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface BypassResult {
  ok: boolean;
  success: boolean;
  method: string;
  attempts: number;
  message: string;
}

/**
 * Simulira bypass poskus.
 * V produkciji bi tukaj klicali:
 * - proxy-rotation → switch na drug proxy iz pool-a
 * - stealth-mode → enable stealth mode + Playwright
 * - captcha-solve → 2captcha/anti-captcha/capmonster API
 * - retry-backoff → počakaj z exponential backoff in retry
 * - playwright → full headless browser fetch
 */
async function attemptBypass(method: string): Promise<BypassResult> {
  const successRates: Record<string, number> = {
    'proxy-rotation': 0.75,
    'stealth-mode': 0.65,
    'captcha-solve': 0.85, // najvišji success rate, ampak plačljiv
    'retry-backoff': 0.45,
    'playwright': 0.90, // najvišji, ampak počasen
    'auto': 0.70,
  };

  const rate = successRates[method] ?? 0.5;
  const success = Math.random() < rate;

  return {
    ok: true,
    success,
    method,
    attempts: 1,
    message: success
      ? `Bypass z metodo "${method}" je uspel.`
      : `Bypass z metodo "${method}" ni uspel. Poskusi drugo metodo.`,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const method = body.method || 'auto';

    const existing = await db.scraperStatus.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: 'Scraper status ni najden' },
        { status: 404 }
      );
    }

    if (existing.status !== 'blocked' && existing.status !== 'error') {
      return NextResponse.json({
        ok: false,
        error: `Status "${existing.status}" ne potrebuje bypass-a. Samo blokirani/error statusi.`,
      }, { status: 400 });
    }

    // Izvedi bypass
    const result = await attemptBypass(method);

    // Posodobi status
    const updated = await db.scraperStatus.update({
      where: { id },
      data: {
        status: result.success ? 'bypassed' : 'error',
        bypassAttempts: { increment: 1 },
        bypassMethod: method,
        bypassSuccess: result.success,
        finishedAt: new Date(),
        durationMs: existing.startedAt ? Date.now() - existing.startedAt.getTime() : null,
        error: result.success ? null : `Bypass z ${method} ni uspel`,
      },
    });

    return NextResponse.json({
      ...result,
      id: updated.id,
      newStatus: updated.status,
      bypassAttempts: updated.bypassAttempts,
    });
  } catch (err: any) {
    logger.error('/api/scraper-status/[id]/bypass', 'POST failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka pri bypass poskusu' },
      { status: 500 }
    );
  }
}
