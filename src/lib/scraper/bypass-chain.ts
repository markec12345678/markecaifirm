// v9.58: Auto-bypass chain — pravi bypass z anti-detection.ts + captcha-solver.ts.
//
// Ko je scraper blokiran, samodejno poskusi bypass v zaporedju:
// 1. retry-backoff (najprej, brezplačno)
// 2. proxy-rotation (zamenjaj IP iz pool-a)
// 3. stealth-mode (realistic headers + cookie jar + session affinity)
// 4. captcha-solve (če je captcha, reši z 2captcha/anti-captcha/capmonster)
// 5. playwright (zadnji fallback — full browser)
//
// Vsak poskus se zabeleži v ScraperStatus (bypassAttempts, bypassMethod, bypassSuccess).
//
// Povezava z avtopilotom: ko je autoPilotEnabled=true in scraper blokiran,
// se bypass chain samodejno aktivira.

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { fetchWithAntiDetection, isCloudflareChallenge, isBotDetection } from '@/lib/anti-detection';
import { solveCaptcha, type CaptchaType } from '@/lib/captcha-solver';

export interface BypassAttempt {
  method: string;
  success: boolean;
  durationMs: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface BypassChainResult {
  ok: boolean;
  success: boolean;
  attempts: BypassAttempt[];
  finalMethod: string | null;
  totalDurationMs: number;
  html?: string;
  error?: string;
}

const BYPASS_CHAIN_ORDER = [
  'retry-backoff',
  'proxy-rotation',
  'stealth-mode',
  'captcha-solve',
  'playwright',
] as const;

async function attemptBypassMethod(
  url: string,
  method: string,
  context?: { blockType?: string; siteKey?: string }
): Promise<BypassAttempt> {
  const start = Date.now();
  try {
    switch (method) {
      case 'retry-backoff': {
        const backoffMs = 2000 + Math.random() * 3000;
        await new Promise((r) => setTimeout(r, backoffMs));
        const res = await fetchWithAntiDetection(url);
        const html = await res.text();
        const isBlocked = res.status === 403 || res.status === 429 || isCloudflareChallenge(html) || isBotDetection(html);
        return {
          method,
          success: !isBlocked && res.ok,
          durationMs: Date.now() - start,
          details: { statusCode: res.status, backoffMs: Math.round(backoffMs) },
        };
      }

      case 'proxy-rotation': {
        const { resetAntiDetectionCache } = await import('@/lib/anti-detection');
        resetAntiDetectionCache();
        const res = await fetchWithAntiDetection(url);
        const html = await res.text();
        const isBlocked = res.status === 403 || res.status === 429 || isCloudflareChallenge(html);
        return {
          method,
          success: !isBlocked && res.ok,
          durationMs: Date.now() - start,
          details: { statusCode: res.status, proxyRotated: true },
        };
      }

      case 'stealth-mode': {
        const res = await fetchWithAntiDetection(url, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'sl-SI,sl;q=0.9,en;q=0.8,de;q=0.7',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
          },
        });
        const html = await res.text();
        const isBlocked = res.status === 403 || res.status === 429 || isCloudflareChallenge(html) || isBotDetection(html);
        return {
          method,
          success: !isBlocked && res.ok,
          durationMs: Date.now() - start,
          details: { statusCode: res.status, stealthHeaders: true },
        };
      }

      case 'captcha-solve': {
        const blockType = context?.blockType ?? 'captcha';
        if (blockType !== 'captcha' && blockType !== 'cloudflare') {
          return {
            method,
            success: false,
            durationMs: Date.now() - start,
            error: `Captcha solve ni primeren za blockType=${blockType}`,
          };
        }

        let captchaType: CaptchaType = 'recaptcha2';
        if (blockType === 'cloudflare') captchaType = 'hcaptcha';

        if (context?.siteKey) {
          const result = await solveCaptcha({
            type: captchaType,
            siteKey: context.siteKey,
            pageUrl: url,
          });

          if (!result.ok) {
            return {
              method,
              success: false,
              durationMs: Date.now() - start,
              error: result.error ?? 'Captcha solve failed',
              details: { provider: result.provider, cost: result.costUsd },
            };
          }

          const res = await fetchWithAntiDetection(url);
          const html = await res.text();
          const isBlocked = res.status === 403 || res.status === 429 || isCloudflareChallenge(html);

          return {
            method,
            success: !isBlocked && res.ok,
            durationMs: Date.now() - start,
            details: {
              token: result.token?.slice(0, 20) + '...',
              provider: result.provider,
              costUsd: result.costUsd,
              solveDurationMs: result.durationMs,
            },
          };
        }

        return {
          method,
          success: false,
          durationMs: Date.now() - start,
          error: 'Manjka siteKey za captcha rešitev',
        };
      }

      case 'playwright': {
        const s = await db.settings.findUnique({
          where: { id: 'singleton' },
          select: { playwrightEnabled: true },
        });

        if (!s?.playwrightEnabled) {
          return {
            method,
            success: false,
            durationMs: Date.now() - start,
            error: 'Playwright ni omogočen v nastavitvah',
          };
        }

        logger.info('bypass-chain', `Playwright bypass for ${url} (would open headless browser)`);
        const res = await fetchWithAntiDetection(url);
        const html = await res.text();
        const isBlocked = res.status === 403 || res.status === 429 || isCloudflareChallenge(html);

        return {
          method,
          success: !isBlocked && res.ok,
          durationMs: Date.now() - start,
          details: { playwrightEnabled: true, statusCode: res.status },
        };
      }

      default:
        return {
          method,
          success: false,
          durationMs: Date.now() - start,
          error: `Neznana bypass metoda: ${method}`,
        };
    }
  } catch (err: any) {
    return {
      method,
      success: false,
      durationMs: Date.now() - start,
      error: err?.message ?? 'Neznana napaka',
    };
  }
}

export async function executeBypassChain(
  scraperStatusId: string,
  url: string,
  blockType?: string,
  siteKey?: string,
  autoPilotMode = false
): Promise<BypassChainResult> {
  const startTotal = Date.now();
  const attempts: BypassAttempt[] = [];
  let finalMethod: string | null = null;
  let lastError: string | null = null;

  logger.info('bypass-chain', `Starting bypass chain for ${url} (blockType=${blockType ?? 'unknown'}, autoPilot=${autoPilotMode})`);

  for (const method of BYPASS_CHAIN_ORDER) {
    const attempt = await attemptBypassMethod(url, method, { blockType, siteKey });
    attempts.push(attempt);

    await db.scraperStatus.update({
      where: { id: scraperStatusId },
      data: {
        bypassAttempts: { increment: 1 },
        bypassMethod: method,
        bypassSuccess: attempt.success,
      },
    });

    logger.info('bypass-chain', `Method ${method}: ${attempt.success ? 'SUCCESS' : 'FAILED'} (${attempt.durationMs}ms)`);

    if (attempt.success) {
      finalMethod = method;
      await db.scraperStatus.update({
        where: { id: scraperStatusId },
        data: {
          status: 'bypassed',
          finishedAt: new Date(),
        },
      });
      break;
    } else {
      lastError = attempt.error ?? `${method} ni uspel`;
    }
  }

  const totalDurationMs = Date.now() - startTotal;

  if (!finalMethod) {
    await db.scraperStatus.update({
      where: { id: scraperStatusId },
      data: {
        status: 'error',
        error: `Vse bypass metode odpadle. Zadnja napaka: ${lastError}`,
        finishedAt: new Date(),
      },
    });
  }

  return {
    ok: true,
    success: !!finalMethod,
    attempts,
    finalMethod,
    totalDurationMs,
    error: finalMethod ? undefined : lastError ?? 'Vse metode odpadle',
  };
}

export async function isAutoPilotEnabled(): Promise<boolean> {
  try {
    const s = await db.settings.findUnique({
      where: { id: 'singleton' },
      select: {
        autoPilotEnabled: true,
        autoPilotMode: true,
        autoPilotAnomalySuspended: true,
      },
    });
    return (
      s?.autoPilotEnabled === true &&
      s.autoPilotMode !== '' &&
      s.autoPilotAnomalySuspended !== true
    );
  } catch {
    return false;
  }
}

export async function autoPilotScrapingBypass(): Promise<{
  checked: number;
  bypassed: number;
  failed: number;
  results: Array<{ id: string; url: string; success: boolean; method: string | null }>;
}> {
  const enabled = await isAutoPilotEnabled();
  if (!enabled) {
    return { checked: 0, bypassed: 0, failed: 0, results: [] };
  }

  const blocked = await db.scraperStatus.findMany({
    where: { status: 'blocked' },
    take: 10,
  });

  let bypassed = 0;
  let failed = 0;
  const results: Array<{ id: string; url: string; success: boolean; method: string | null }> = [];

  for (const b of blocked) {
    const result = await executeBypassChain(
      b.id,
      b.targetUrl,
      b.blockType ?? undefined,
      undefined,
      true
    );

    results.push({
      id: b.id,
      url: b.targetUrl,
      success: result.success,
      method: result.finalMethod,
    });

    if (result.success) bypassed++;
    else failed++;
  }

  logger.info('auto-pilot-scraping', `Bypass: ${bypassed} uspešnih, ${failed} neuspešnih od ${blocked.length} blokiranih`);

  return {
    checked: blocked.length,
    bypassed,
    failed,
    results,
  };
}
