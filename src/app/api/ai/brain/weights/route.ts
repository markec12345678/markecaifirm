// v8.28 / v8.95.2-f-refactor: Adaptive Domain Weights API — feedback loop.
// GET  /api/ai/brain/weights — returns current adaptive weights + stats + history.
// POST /api/ai/brain/weights — 3 actions:
//   { action: 'record', domain, feedback: 'executed'|'rejected', action?: string }
//     → records user feedback for an action, re-evaluates weight every 10 actions.
//   { action: 'reset' }
//     → resets all weights to defaults, clears all stats + history.
//   { action: 'set', domain, weight }
//     → manually override a domain's weight (clamped to [0.5, 2.0]).
//
// DETERMINISTIC (aiUsed: false): no external AI/LLM SDK is called.
// Architecture: this endpoint is the ONLY writer to Settings.adaptiveDomainWeights.
// The Master Brain endpoint (/api/ai/brain/master) is a READER — it loads
// adaptive weights via loadAdaptiveWeights() and passes them as `domainWeights`
// in MasterBrainInput, replacing the hardcoded DOMAIN_WEIGHTS in master.ts.
//
// This is the "behavioral economics" feature — system learns from REVEALED
// preferences (what users actually do), not stated ones (what they say they want).
// Domains where the user executes 80%+ of actions get weight INCREASED; domains
// where they reject 60%+ get weight DECREASED.
//
// Refaktoriran z withAiRoute helperjem (v8.95.2-f) + enforceBudget guard
// (non-breaking — endpoint ne kliče AI direktno, ampak je konsistentno z
// vsemi v8.94.x / v8.95.x migracijami; avtomatski recordAiCall je additive).
// EN shared handler za GET in POST (konsistentno z brain/explain, brain/snapshots,
// brain/actual-profit vzorcem — parseBody interno razlikuje med metodami preko
// req.method, handler nato branch-a na GET ali POST logiko).
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=60.

import type { NextRequest } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';
import {
  loadAdaptiveWeights,
  recordActionFeedback,
  resetAdaptiveWeights,
  setDomainWeight,
  type AdaptiveWeights,
  type WeightAdjustmentResult,
} from '@/lib/brain/adaptive-weights';
import type { DomainName } from '@/lib/brain/master';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Domain name validation (pure helper, extracted OUTSIDE handler) -------

const ALL_DOMAINS: DomainName[] = ['profit', 'inventory', 'market', 'sourcing', 'risk', 'buyer', 'pricing'];
const DOMAIN_SET = new Set<string>(ALL_DOMAINS);

function isValidDomain(d: unknown): d is DomainName {
  return typeof d === 'string' && DOMAIN_SET.has(d);
}

// --- Input shape ---------------------------------------------------------

/**
 * Unified route-level input for both GET and POST. parseBody detects the HTTP
 * method via `req.method` and populates:
 *   - GET  → { method: 'GET', action: '', domain: undefined, ... }
 *   - POST → { method: 'POST', action: <lowercased+trimmed>, domain, feedback, weight }
 *
 * Handler branches on `input.method`: GET returns current weights, POST
 * routes by `input.action` ('record' | 'reset' | 'set').
 */
interface WeightsInput {
  /** HTTP method detected from req — distinguishes GET from POST in handler. */
  method: 'GET' | 'POST';
  /** Lowercased + trimmed action string ('record'|'reset'|'set'|''). Empty for GET. */
  action: string;
  /** Raw domain value from POST body (validated in handler). */
  domain: unknown;
  /** Raw feedback value from POST body ('executed'|'rejected', validated in handler). */
  feedback: unknown;
  /** Raw weight value from POST body (number, validated in handler). */
  weight: unknown;
}

// --- Body parsing (pure helper, extracted OUTSIDE handler) ----------------

/**
 * Resolve WeightsInput from the incoming request:
 *   - GET (or any non-POST): returns method='GET' with empty action fields
 *     → handler returns current adaptive weights
 *   - POST: parses JSON body, lowercases+trims action, preserves raw
 *     domain/feedback/weight for per-action validation in handler
 *
 * Body parsing mirrors original POST: content-type check, req.clone() to avoid
 * consuming the stream, try/catch around JSON parse with {} fallback, object
 * shape guard (rejects arrays / non-objects).
 */
async function parseWeightsInput(req: NextRequest): Promise<WeightsInput> {
  // GET (or any non-POST) — no body parsing needed
  if (req.method !== 'POST') {
    return {
      method: 'GET',
      action: '',
      domain: undefined,
      feedback: undefined,
      weight: undefined,
    };
  }

  // POST — parse JSON body
  let body: Record<string, unknown> = {};
  try {
    const ct = req.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const cloned = req.clone();
      body = (await cloned.json()) as Record<string, unknown>;
    }
  } catch {
    body = {};
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    body = {};
  }

  const action = typeof body.action === 'string' ? body.action.toLowerCase().trim() : '';

  return {
    method: 'POST',
    action,
    domain: body.domain,
    feedback: body.feedback,
    weight: body.weight,
  };
}

// --- Shared handler (GET + POST) -----------------------------------------

const weightsHandler = withAiRoute<WeightsInput>({
  endpoint: '/api/ai/brain/weights',
  maxDuration: 60,
  enforceBudget: true, // v8.95.2-f: budget guard + avtomatski recordAiCall (non-breaking za deterministic endpoint)
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req: NextRequest) => parseWeightsInput(req),

  // Brez validateInput — handler interno validira per-action (domain/feedback/weight)

  handler: async (input, _ctx: AiRouteContext) => {
    const { method, action } = input;

    // --- GET: return current adaptive weights -----------------------------
    if (method === 'GET') {
      const weights: AdaptiveWeights = await loadAdaptiveWeights();
      return apiOk({
        ok: true as const,
        adaptiveWeights: weights,
        source: 'v8.28-adaptive-weights',
      });
    }

    // --- POST: action-based routing ---------------------------------------

    // action: record ------------------------------------------------------
    if (action === 'record') {
      const { domain, feedback } = input;

      if (!isValidDomain(domain)) {
        return apiBadRequest(
          `Invalid domain: ${JSON.stringify(domain)}. Must be one of: ${ALL_DOMAINS.join(', ')}.`,
        );
      }
      if (feedback !== 'executed' && feedback !== 'rejected') {
        return apiBadRequest(
          `Invalid feedback: ${JSON.stringify(feedback)}. Must be 'executed' or 'rejected'.`,
        );
      }

      const result: WeightAdjustmentResult = await recordActionFeedback({
        domain,
        action: '',
        feedback,
      });

      return apiOk(result);
    }

    // action: reset -------------------------------------------------------
    if (action === 'reset') {
      const result = await resetAdaptiveWeights();
      return apiOk(result);
    }

    // action: set ---------------------------------------------------------
    if (action === 'set') {
      const { domain, weight } = input;

      if (!isValidDomain(domain)) {
        return apiBadRequest(
          `Invalid domain: ${JSON.stringify(domain)}. Must be one of: ${ALL_DOMAINS.join(', ')}.`,
        );
      }
      if (typeof weight !== 'number' || !Number.isFinite(weight)) {
        return apiBadRequest(
          `Invalid weight: ${JSON.stringify(weight)}. Must be a finite number.`,
        );
      }

      try {
        const result = await setDomainWeight(domain, weight);
        return apiOk(result);
      } catch (err: unknown) {
        // setDomainWeight throws on non-finite weight (unreachable — we validate
        // above) or on DB persistence errors. Original returned 400 with { error };
        // we use apiBadRequest for consistency with other migrations (additive
        // `ok: false` field, non-breaking).
        const errMsg = err instanceof Error ? err.message : 'Napaka pri setDomainWeight';
        return apiBadRequest(errMsg);
      }
    }

    // unknown action ------------------------------------------------------
    return apiBadRequest(
      `Unknown action: ${JSON.stringify(action)}. Must be 'record', 'reset', or 'set'.`,
    );
  },
});

export const GET = weightsHandler;
export const POST = weightsHandler;
