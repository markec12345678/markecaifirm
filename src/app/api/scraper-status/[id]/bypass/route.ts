// v9.58: Bypass posameznega blokiranega scraperja — PRAVI bypass z anti-detection.ts.
//
// POST /api/scraper-status/[id]/bypass
// Body: { method?: 'auto' | 'proxy-rotation' | 'stealth-mode' | 'captcha-solve' | 'retry-backoff' | 'playwright' }
//
// v9.58: Uporablja executeBypassChain() iz src/lib/scraper/bypass-chain.ts
//        (pravi klici fetchWithAntiDetection + solveCaptcha, ne simulacija).

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { executeBypassChain, isAutoPilotEnabled } from '@/lib/scraper/bypass-chain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60s ker bypass chain lahko traja (captcha solve)

interface BypassResult {
  ok: boolean;
  success: boolean;
  method: string | null;
  attempts: number;
  message: string;
  details?: {
    attempts: Array<{ method: string; success: boolean; durationMs: number; error?: string }>;
    totalDurationMs: number;
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const requestedMethod = body.method || 'auto';

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

    // v9.58: Preveri ali je avtopilot omogočen
    const autoPilotActive = await isAutoPilotEnabled();

    // Če je method='auto', izvedi celoten chain
    if (requestedMethod === 'auto') {
      const result = await executeBypassChain(
        id,
        existing.targetUrl,
        existing.blockType ?? undefined,
        body.siteKey,
        autoPilotActive
      );

      const response: BypassResult = {
        ok: true,
        success: result.success,
        method: result.finalMethod,
        attempts: result.attempts.length,
        message: result.success
          ? `Bypass uspešen z metodo "${result.finalMethod}" (${result.attempts.length} poskusov, ${result.totalDurationMs}ms)`
          : `Vse ${result.attempts.length} metode odpadle. Zadnja napaka: ${result.error}`,
        details: {
          attempts: result.attempts.map(a => ({
            method: a.method,
            success: a.success,
            durationMs: a.durationMs,
            error: a.error,
          })),
          totalDurationMs: result.totalDurationMs,
        },
      };

      return NextResponse.json({
        ...response,
        id,
        newStatus: result.success ? 'bypassed' : 'error',
        autoPilotActive,
      });
    }

    // Specifična metoda — izvedi chain in najdi rezultat za to metodo
    const result = await executeBypassChain(
      id,
      existing.targetUrl,
      existing.blockType ?? undefined,
      body.siteKey,
      autoPilotActive
    );

    // Najdi rezultat zahtevane metode
    const specificAttempt = result.attempts.find(a => a.method === requestedMethod);

    const response: BypassResult = {
      ok: true,
      success: specificAttempt?.success ?? false,
      method: requestedMethod,
      attempts: 1,
      message: specificAttempt?.success
        ? `Bypass z metodo "${requestedMethod}" je uspel (${specificAttempt.durationMs}ms)`
        : `Bypass z metodo "${requestedMethod}" ni uspel: ${specificAttempt?.error ?? 'neznan vzrok'}`,
    };

    return NextResponse.json({
      ...response,
      id,
      newStatus: specificAttempt?.success ? 'bypassed' : existing.status,
      autoPilotActive,
    });
  } catch (err: any) {
    logger.error('/api/scraper-status/[id]/bypass', 'POST failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka pri bypass poskusu' },
      { status: 500 }
    );
  }
}
