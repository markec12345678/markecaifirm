// v8.94: withAiRoute — reusable wrapper za AI API endpointe.
//
// ARHITEKTURNA MOTIVACIJA:
// Projekt ima 432 AI endpointov, ki vsak ponavljajo isti vzorec:
//   1. try/catch z logger.error + NextResponse.json error
//   2. Load settings + build AiSettings object (fallback provider)
//   3. Build prompt
//   4. callProviderForRaw z fallback provider-jem na napako
//   5. parseJsonLooseExported
//   6. Validate + transform output
//
// Ta helper izloči korake 1, 2, 4, 5 v skupen wrapper. Endpoint
// definira samo: parseBody, validateInput, in handler (ki dobi context
// s callAi/parseAi/db/logger/aiSettings).
//
// PRIMER UPORABE:
//
//   export const POST = withAiRoute<{ tradeId: string }>({
//     endpoint: '/api/ai/profit-maximizer',
//     maxDuration: 90,
//     parseBody: async (req) => {
//       const body = await req.json().catch(() => ({}));
//       return { tradeId: String(body?.tradeId ?? '') };
//     },
//     validateInput: (input) => input.tradeId ? null : 'tradeId je obvezen',
//     handler: async (input, { callAi, parseAi, db }) => {
//       const trade = await db.trade.findUnique({ where: { id: input.tradeId } });
//       if (!trade) return apiNotFound('Trade ne obstaja');
//       const raw = await callAi(buildPrompt(trade));
//       const parsed = parseAi(raw);
//       return apiOk({ analysis: transform(parsed) });
//     },
//   });
//
// BENEFITI:
// - ~40-60% manj kode na endpoint (brez boilerplate try/catch, settings, fallback)
// - Konsistenten error handling + logging (preko apiError iz lib/api-response.ts)
// - Konsistenten rate limiting (preko lib/rate-limit.ts)
// - Lažje testiranje (handler je čista funkcija, dobi context z dependency injection)
// - Retry z exponential backoff (že v callProvider, v8.86) se deduje
// - Fallback provider (že v callProvider) se deduje
//
// BACKWARD COMPATIBILITY:
// Helper je non-breaking — obstoječi endpointi lahko ostanejo kakršni so.
// Postopoma se jih lahko migrira na withAiRoute. Oba vzorca sobivata.

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getSettingsRow } from '@/lib/pipeline';
import { apiError, apiBadRequest } from '@/lib/api-response';
import {
  callProviderForRaw,
  parseJsonLooseExported,
  type AiProviderType,
  type AiSettings,
} from '@/lib/ai';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

// --- ApiRouteError (za custom status iz helper funkcij) -------------------

/**
 * Throw v pomožnih funkcijah, ko želiš specifičen HTTP status (npr. 404).
 * withAiRoute ga ulovi in vrne ustrezen status code (namesto default 500).
 *
 * @example
 *   if (!trade) throw new ApiRouteError('Trade ne obstaja', 404);
 *
 * Za 400/404 iz samega handler-ja raje uporabi apiBadRequest/apiNotFound
 * direktno (vzame NextResponse, ne throw-a). Ta class je za helper funkcije
 * ki so globoko ugnezdjene in nimajo dostopa do response objekta.
 */
export class ApiRouteError extends Error {
  status: number;
  constructor(message: string, status: number = 500) {
    super(message);
    this.name = 'ApiRouteError';
    this.status = status;
  }
}

// --- Context (dependency injection za handler) -----------------------------

export interface AiRouteContext {
  /** Pre-loaded AI settings (primary + fallback). */
  aiSettings: AiSettings;
  /** Prisma client. */
  db: typeof db;
  /** Structured logger. */
  logger: typeof logger;
  /**
   * Pokliče AI provider z fallback + retry (exponential backoff).
   * Vrne raw text odgovor.
   * Meta: aiUsed=true, provider=settings.aiProvider.
   */
  callAi: (prompt: string) => Promise<string>;
  /**
   * Loose JSON parser — handle-a code fences (```json ... ```), ekstraktne
   * prvi { ... } blok. Vrne null na parse failure (ne throw-a).
   */
  parseAi: (raw: string) => unknown;
  /** Original NextRequest (za redke primere ko handler rabi headers). */
  req: NextRequest;
}

// --- Options ---------------------------------------------------------------

export interface AiRouteOptions<TInput> {
  /** Route ime za logging (npr. '/api/ai/profit-maximizer'). */
  endpoint: string;
  /** Next.js maxDuration v sekundah. Default 90. */
  maxDuration?: number;
  /** Rate limit per minute per IP. Default 20. Set 0 za izklop. */
  rateLimit?: number;
  /**
   * Parse request body. Default: JSON parse z {} fallback.
   * Vrne tipiziran input za handler.
   */
  parseBody?: (req: NextRequest) => Promise<TInput> | TInput;
  /**
   * Validiraj input. Vrne error message ali null če je valid.
   * Če vrne string, se takoj odgovori z 400.
   */
  validateInput?: (input: TInput) => string | null;
  /** Handler — prejme input + context, vrne NextResponse. */
  handler: (input: TInput, ctx: AiRouteContext) => Promise<NextResponse>;
  /** HTTP metoda. Default 'POST'. */
  method?: 'POST' | 'GET';
  /**
   * v8.94: AI budget guard — preveri dnevni/mesečni AI call limit PRED klicem.
   * Če preseženo, vrne 429 z message-om.
   * Default: false (backward-compatible). Set true za endpoint-e ki kliknejo AI.
   *
   * Ko je true, helper tudi avtomatsko pokliče recordAiCall() PO uspešnem klicu.
   * Handler še vedno mora klicati callAi() — helper samo wrap-a budget check.
   *
   * TODO (v8.95): ko bo token tracking, dodaj trackTokens: true option.
   */
  enforceBudget?: boolean;
}

// --- Implementation --------------------------------------------------------

/**
 * Ustvari AI route handler z vso boilerplate logiko.
 *
 * @example
 * export const POST = withAiRoute({ endpoint: '/api/ai/foo', handler: ... });
 */
export function withAiRoute<TInput = unknown>(
  options: AiRouteOptions<TInput>
): (req: NextRequest) => Promise<NextResponse> {
  const {
    endpoint,
    maxDuration = 90,
    rateLimit = 20,
    parseBody,
    validateInput,
    handler,
    method = 'POST',
    enforceBudget = false,
  } = options;

  async function routeHandler(req: NextRequest): Promise<NextResponse> {
    // 1. Rate limit (če ni izklopljen)
    if (rateLimit > 0) {
      const rl = checkRateLimit(req, endpoint, rateLimit);
      if (!rl.allowed) {
        logger.warn(endpoint, `Rate limit exceeded (${rl.limit - rl.remaining}/${rl.limit})`, {
          ip: req.headers.get('x-forwarded-for') ?? 'unknown',
          retryAfterSeconds: rl.retryAfterSeconds,
        });
        return rateLimitResponse(rl) as unknown as NextResponse;
      }
    }

    // 2. Method check
    if (method === 'POST' && req.method !== 'POST') {
      return apiBadRequest(`Metoda ${req.method} ni dovoljena. Uporabi POST.`);
    }

    // 2.5 v8.94: Budget guard — preveri dnevni/mesečni AI call limit
    if (enforceBudget) {
      try {
        const { checkAiBudget } = await import('@/lib/ai-cost');
        await checkAiBudget(db);
      } catch (budgetErr) {
        // AiBudgetExceeded → 429 (Too Many Requests za budget)
        if (budgetErr instanceof Error && budgetErr.name === 'AiBudgetExceeded') {
          logger.warn(endpoint, `Budget exceeded: ${budgetErr.message}`);
          return NextResponse.json(
            { ok: false, error: budgetErr.message, code: 'BUDGET_EXCEEDED' },
            { status: 429 }
          );
        }
        // Druga napaka pri budget check-u — ne blokiraj (fail-open)
        logger.warn(endpoint, 'Budget check failed (failing open)', budgetErr);
      }
    }

    try {
      // 3. Parse body (ali default)
      let input: TInput;
      if (parseBody) {
        input = await parseBody(req);
      } else {
        // Default: JSON parse z {} fallback (ustreza TInput = unknown)
        const body = await req.json().catch(() => ({}));
        input = body as TInput;
      }

      // 4. Validate input
      if (validateInput) {
        const error = validateInput(input);
        if (error) {
          return apiBadRequest(error);
        }
      }

      // 5. Load AI settings iz Settings tabele (z fallback polji)
      const settings = await getSettingsRow();
      const aiSettings: AiSettings = {
        provider: settings.aiProvider as AiProviderType,
        baseUrl: settings.aiBaseUrl,
        apiKey: settings.aiApiKey,
        model: settings.aiModel,
        fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
        fallbackBaseUrl: settings.fallbackBaseUrl || '',
        fallbackApiKey: settings.fallbackApiKey || '',
        fallbackModel: settings.fallbackModel || '',
      };

      // 6. callAi — wrapper okrog callProviderForRaw z fallback handling.
      //    callProviderForRaw že interno kliče callProvider ki ima retry (v8.86).
      //    Ampak NE implementira fallback provider-ja — to delamo tu.
      const callAi = async (prompt: string): Promise<string> => {
        try {
          return await callProviderForRaw(aiSettings, prompt);
        } catch (primaryError) {
          // Fallback na secondary provider (če konfiguriran)
          if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
            const fb: AiSettings = {
              provider: aiSettings.fallbackProvider,
              baseUrl: aiSettings.fallbackBaseUrl || '',
              apiKey: aiSettings.fallbackApiKey || '',
              model: aiSettings.fallbackModel || '',
            };
            logger.warn(endpoint, 'Primary AI failed, using fallback', {
              primary: (primaryError as Error)?.message ?? String(primaryError),
            });
            return await callProviderForRaw(fb, prompt);
          }
          throw primaryError;
        }
      };

      // 7. parseAi — loose JSON parser, ne throw-a
      const parseAi = (raw: string): unknown => parseJsonLooseExported(raw);

      // 8. Build context
      const ctx: AiRouteContext = {
        aiSettings,
        db,
        logger,
        callAi,
        parseAi,
        req,
      };

      // 9. Call handler
      const result = await handler(input, ctx);

      // 10. v8.94: Zabeleži AI klic (če je enforceBudget vklopljen)
      // Samo če handler ni throw-al (uspešen klic).
      if (enforceBudget) {
        try {
          const { recordAiCall } = await import('@/lib/ai-cost');
          await recordAiCall(db, endpoint);
        } catch (recordErr) {
          // Ne failaj handler-ja zaradi logging napake
          logger.warn(endpoint, 'Failed to record AI call (non-fatal)', recordErr);
        }
      }

      return result;
    } catch (err) {
      // ApiRouteError: handler/helper je vrnil specifičen status (npr. 404)
      if (err instanceof ApiRouteError) {
        const status = err.status || 500;
        if (status >= 400 && status < 500) {
          // 4xx — log kot warn (ni napaka v kodi, ampak uporabnikova napaka)
          logger.warn(endpoint, `ApiRouteError ${status}: ${err.message}`);
        } else {
          logger.error(endpoint, `ApiRouteError ${status}: ${err.message}`, err);
        }
        return NextResponse.json(
          { ok: false, error: err.message },
          { status }
        );
      }
      // Ostale napake — 500 + error logging
      return apiError(endpoint, `${method} handler failed`, err);
    }
  }

  // Next.js route config (runtime/dynamic/maxDuration) mora biti izpostavljen
  // statično na modulu route-ja. Helper tega ne more nastaviti sam, ampak
  // caller ga import-a iz AI_ROUTE_DEFAULTS in re-export-a:
  //   export const { runtime, dynamic, maxDuration } = AI_ROUTE_DEFAULTS;
  return routeHandler;
}

/**
 * Konstante za Next.js route config. Uporabi v svojem route modulu:
 *
 *   import { withAiRoute, AI_ROUTE_DEFAULTS } from '@/lib/with-ai-route';
 *   export const { runtime, dynamic, maxDuration } = AI_ROUTE_DEFAULTS;
 *   export const POST = withAiRoute({ endpoint: '/api/ai/foo', handler: ... });
 */
export const AI_ROUTE_DEFAULTS = {
  runtime: 'nodejs' as const,
  dynamic: 'force-dynamic' as const,
  maxDuration: 90,
};
