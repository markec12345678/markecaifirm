// v8.26 / v8.95.0-e-refactor: Action Explainability API — returns human-readable
// reasoning for TOP 5 Master Brain actions. Answers "Zakaj Master Brain
// priporoča TOČNO to akcijo?"
//
// GET: calls masterBrain() + loads the user's risk profile from Settings,
//      then calls explainMasterBrainActions(masterResult, profileAdjustment).
// POST: accepts an optional pre-computed MasterBrainResult in the body. If
//       not provided, calls masterBrain() internally. Also accepts an optional
//       profileAdjustment override. Useful for re-explaining an existing
//       master result without re-running all 7 Domain Brains.
//
// 10-MIN CACHE: same TTL as Master Brain — explanations are PURELY derived
// from the master result, so caching them is safe. The cache key is derived
// from the master brain cache key (input hash) so a fresh master result
// automatically triggers fresh explanations.
//
// DETERMINISTIC (aiUsed: false): no external AI/LLM SDK is called.
// The risk profile is loaded from the Settings singleton (same as the master
// brain endpoint v8.24).
//
// Refaktoriran z withAiRoute helperjem (v8.95.0-e) + enforceBudget guard
// (non-breaking — endpoint ne kliče AI direktno, ampak je konsistentno z
// vsemi v8.94.x migracijami).
//
// Response shape (MasterBrainExplanation):
//   {
//     ok: true,
//     explanations: [
//       {
//         rank: 1,
//         domain: 'profit',
//         signal: 'growth',
//         action: '...',
//         expectedUpliftEUR: 375,
//         confidence: 'HIGH',
//         finalScore: 375,
//         reasoning: 'Profit Brain signal growth (B, 67/100) sproži to priporočilo. Uvrščena na #1 ker...',
//         reasoningParts: {
//           trigger, signalScore, signalGrade, whyRankedHere,
//           profileImpact, conflictImpact, expectedOutcome
//         },
//         trustScore: 73
//       },
//       ... (5 total)
//     ],
//     summaryBlurb: 'Master Brain priporoča 5 akcij za danes. Najvišji trust: #1 (73/100)...',
//     trustScore: 67,
//     source: 'v8.26-explainability',
//     cachedAt?: number
//   }
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=60.

import type { NextRequest } from 'next/server';
import {
  withAiRoute,
  AI_ROUTE_DEFAULTS,
  type AiRouteContext,
} from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';
import {
  masterBrain,
  type MasterBrainResult,
  type MasterBrainInput,
} from '@/lib/brain/master';
import {
  explainMasterBrainActions,
  type MasterBrainExplanation,
} from '@/lib/brain/explainability';
// v8.24: User Risk Profile — same loader as master endpoint
import {
  adjustMasterBrainForRiskProfile,
  DEFAULT_PROFILE,
  type UserRiskProfile,
  type RiskProfileAdjustment,
} from '@/lib/brain/risk-profile';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Cache TTL -----------------------------------------------------------
// 10 minutes — same TTL as Master Brain (explanations are derived from the
// master result; if the master result is still fresh, so are the explanations).
const EXPLAIN_CACHE_TTL_MS = 10 * 60 * 1000;

// --- Input shape ---------------------------------------------------------

interface ExplainInput {
  /** Pre-computed MasterBrainResult (POST only). Skips masterBrain() call. */
  masterResult?: MasterBrainResult;
  /** Override profile adjustment (POST only). Skips DB risk-profile load. */
  profileAdjustment?: RiskProfileAdjustment;
  /** Merged MasterBrainInput (query string + POST body `input`). */
  input: MasterBrainInput;
}

// --- Shared handler (GET + POST) -----------------------------------------

const explainHandler = withAiRoute<ExplainInput>({
  endpoint: '/api/ai/brain/explain',
  maxDuration: 60,
  enforceBudget: true, // v8.95.0-e: budget guard + avtomatski recordAiCall
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req: NextRequest) => parseExplainInput(req),

  // Brez validateInput — vsi input-i imajo defaults (query string prazna → {})

  handler: async (input, ctx: AiRouteContext) => {
    const { db, logger } = ctx;

    // 1. Cache key (skip when caller supplied a pre-computed masterResult —
    //    caller wants a fresh explanation of their own data, not a cached one)
    const useCache = !input.masterResult;
    const cacheKey = useCache ? buildCacheKey(input.input) : '';

    if (cacheKey) {
      const cached = getCachedAI<MasterBrainExplanation>(cacheKey);
      if (cached) {
        // Re-stamp cachedAt so the caller sees a fresh "served at" time, even
        // though the underlying explanation is up to 10 min old. Mirrors the
        // pattern used by other brain endpoints (master, profit, ...).
        return apiOk({ ...cached, cachedAt: Date.now() });
      }
    }

    // 2. Get the MasterBrainResult — either from POST body, or call masterBrain()
    let masterResult: MasterBrainResult;
    if (input.masterResult) {
      masterResult = input.masterResult;
    } else {
      masterResult = await masterBrain(input.input);
    }

    // 3. Get the RiskProfileAdjustment — either from POST body, or compute
    //    from the user's persisted profile in Settings.
    let profileAdjustment: RiskProfileAdjustment | null | undefined =
      input.profileAdjustment;
    if (profileAdjustment === undefined) {
      // undefined = not provided → load from DB
      const profile = await loadUserRiskProfile(db, logger);
      profileAdjustment = adjustMasterBrainForRiskProfile(masterResult, profile);
    }

    // 4. Generate explanations
    const explanation = explainMasterBrainActions(masterResult, profileAdjustment);

    // 5. Cache the explanation (only if we computed masterResult ourselves)
    if (cacheKey) {
      setCachedAI(cacheKey, explanation, EXPLAIN_CACHE_TTL_MS);
    }

    // 6. Response — always re-stamp cachedAt on serve
    return apiOk({ ...explanation, cachedAt: Date.now() });
  },
});

export const GET = explainHandler;
export const POST = explainHandler;

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

/**
 * Reads the 4 risk-profile fields from the Settings singleton row.
 * On any DB error / missing row / missing fields, returns DEFAULT_PROFILE
 * (balanced) — explainability must never crash because the user's profile
 * couldn't be loaded.
 */
async function loadUserRiskProfile(
  db: AiRouteContext['db'],
  logger: AiRouteContext['logger'],
): Promise<UserRiskProfile> {
  try {
    const s = await db.settings.findUnique({ where: { id: 'singleton' } });
    if (!s) return DEFAULT_PROFILE;
    const rawTolerance = String(s.userRiskTolerance ?? 'balanced').toLowerCase();
    const riskTolerance: UserRiskProfile['riskTolerance'] =
      rawTolerance === 'conservative' || rawTolerance === 'aggressive'
        ? rawTolerance
        : 'balanced';
    const rawHorizon = String(s.userInvestmentHorizon ?? 'medium').toLowerCase();
    const investmentHorizon: UserRiskProfile['investmentHorizon'] =
      rawHorizon === 'short' || rawHorizon === 'long' ? rawHorizon : 'medium';
    return {
      riskTolerance,
      maxAcceptableRisk:
        typeof s.userMaxAcceptableRisk === 'number'
          ? Math.max(0, Math.min(100, s.userMaxAcceptableRisk))
          : 50,
      liquidityReserve:
        typeof s.userLiquidityReserve === 'number' && s.userLiquidityReserve >= 0
          ? s.userLiquidityReserve
          : 500,
      investmentHorizon,
    };
  } catch (err: any) {
    logger.warn(
      '/api/ai/brain/explain',
      'failed to load User Risk Profile, using DEFAULT_PROFILE',
      err,
    );
    return DEFAULT_PROFILE;
  }
}

/**
 * Parse MasterBrainInput from query string (GET + POST both). Supports
 * skip flags (skipProfit, skipInventory, skipMarket, skipSourcing, skipRisk,
 * skipBuyer, skipPricing) as boolean query params.
 */
function parseInputFromQuery(req: NextRequest): MasterBrainInput {
  const input: MasterBrainInput = {};
  let qp: URLSearchParams | null = null;
  try {
    qp = new URL(req.url).searchParams;
  } catch {
    qp = null;
  }
  if (!qp) return input;

  const asBoolean = (key: string): boolean | undefined => {
    const v = qp!.get(key);
    if (v == null) return undefined;
    const s = v.toLowerCase().trim();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    return undefined;
  };

  const b = asBoolean('skipProfit');
  if (b != null) input.skipProfit = b;
  const b2 = asBoolean('skipInventory');
  if (b2 != null) input.skipInventory = b2;
  const b3 = asBoolean('skipMarket');
  if (b3 != null) input.skipMarket = b3;
  const b4 = asBoolean('skipSourcing');
  if (b4 != null) input.skipSourcing = b4;
  const b5 = asBoolean('skipRisk');
  if (b5 != null) input.skipRisk = b5;
  const b6 = asBoolean('skipBuyer');
  if (b6 != null) input.skipBuyer = b6;
  const b7 = asBoolean('skipPricing');
  if (b7 != null) input.skipPricing = b7;

  return input;
}

/**
 * Parse the optional POST body. Accepts:
 *   - masterResult?: MasterBrainResult   (pre-computed — skip masterBrain() call)
 *   - profileAdjustment?: RiskProfileAdjustment  (override — skip DB load)
 *   - input?: MasterBrainInput            (overrides passed to masterBrain())
 *
 * Returns {} for non-POST requests, invalid Content-Type, or non-object bodies.
 */
async function parseExplainBody(req: NextRequest): Promise<{
  masterResult?: MasterBrainResult;
  profileAdjustment?: RiskProfileAdjustment;
  input?: MasterBrainInput;
}> {
  if (req.method !== 'POST') return {};
  try {
    const ct = req.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return {};
    const cloned = req.clone();
    const parsed = (await cloned.json()) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: {
      masterResult?: MasterBrainResult;
      profileAdjustment?: RiskProfileAdjustment;
      input?: MasterBrainInput;
    } = {};
    if (
      parsed.masterResult &&
      typeof parsed.masterResult === 'object' &&
      (parsed.masterResult as { ok?: unknown }).ok === true
    ) {
      out.masterResult = parsed.masterResult as MasterBrainResult;
    }
    if (
      parsed.profileAdjustment &&
      typeof parsed.profileAdjustment === 'object'
    ) {
      out.profileAdjustment = parsed.profileAdjustment as RiskProfileAdjustment;
    }
    if (
      parsed.input &&
      typeof parsed.input === 'object' &&
      !Array.isArray(parsed.input)
    ) {
      out.input = parsed.input as MasterBrainInput;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Resolve ExplainInput from the incoming request:
 *   1. Parse query string → queryInput (skip flags)
 *   2. Parse POST body (masterResult / profileAdjustment / input overrides)
 *   3. Merge: body.input overrides query string (preserves original precedence)
 */
async function parseExplainInput(req: NextRequest): Promise<ExplainInput> {
  const queryInput = parseInputFromQuery(req);
  const body = await parseExplainBody(req);
  const input: MasterBrainInput = { ...queryInput, ...(body.input ?? {}) };
  return {
    masterResult: body.masterResult,
    profileAdjustment: body.profileAdjustment,
    input,
  };
}

/**
 * Build a deterministic cache key for the explainability call. The key
 * incorporates the resolved MasterBrainInput (so different inputs get
 * different cache entries).
 */
function buildCacheKey(input: MasterBrainInput): string {
  const stableStringify = (obj: unknown): string => {
    if (obj == null) return '';
    if (typeof obj !== 'object') return String(obj);
    try {
      const seen = new WeakSet();
      const sortDeep = (v: unknown): unknown => {
        if (v == null || typeof v !== 'object') return v;
        if (seen.has(v as object)) return '[Circular]';
        seen.add(v as object);
        if (Array.isArray(v)) return v.map(sortDeep);
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(v as Record<string, unknown>).sort()) {
          sorted[k] = sortDeep((v as Record<string, unknown>)[k]);
        }
        return sorted;
      };
      return JSON.stringify(sortDeep(obj));
    } catch {
      return '[Unstringifiable]';
    }
  };
  const parts: string[] = [];
  parts.push(`pi:${stableStringify(input.profitInput)}`);
  parts.push(`ii:${stableStringify(input.inventoryInput)}`);
  parts.push(`mi:${stableStringify(input.marketInput)}`);
  parts.push(`si:${stableStringify(input.sourcingInput)}`);
  parts.push(`ri:${stableStringify(input.riskInput)}`);
  parts.push(`bi:${stableStringify(input.buyerInput)}`);
  parts.push(`pri:${stableStringify(input.pricingInput)}`);
  parts.push(`sP:${input.skipProfit ?? false}`);
  parts.push(`sI:${input.skipInventory ?? false}`);
  parts.push(`sM:${input.skipMarket ?? false}`);
  parts.push(`sS:${input.skipSourcing ?? false}`);
  parts.push(`sR:${input.skipRisk ?? false}`);
  parts.push(`sB:${input.skipBuyer ?? false}`);
  parts.push(`sPr:${input.skipPricing ?? false}`);
  return `brain-explain:${parts.join('|')}`;
}
