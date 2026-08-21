// v8.24 / v8.95.2-c: User Risk Profile API — GET returns current profile,
// POST sets it. Stored in Settings table (singleton row).
//
// GET /api/ai/brain/risk-profile
//   Returns: { ok, profile, adjustment }
//   - profile: the 4 risk-profile fields (riskTolerance, maxAcceptableRisk,
//     liquidityReserve, investmentHorizon) read from Settings singleton.
//     If no row exists, returns DEFAULT_PROFILE (balanced, 50, 500, medium).
//   - adjustment: a sample RiskProfileAdjustment computed by calling
//     adjustMasterBrainForRiskProfile(masterBrain(), profile). This lets the
//     UI immediately preview how the current profile affects Master Brain
//     output (e.g. REDUCE_RISK + filteredTopActions + adjustedRiskBudget).
//
// POST /api/ai/brain/risk-profile
//   Body: Partial<UserRiskProfile> — at least one of the 4 fields must be set.
//   - Validates via validateProfile() — returns 400 with errors[] if invalid.
//   - Updates the Settings singleton row (creates if missing) with the new
//     profile fields.
//   - Returns: { ok, profile } — the updated profile (after merge with current
//     values, so unspecified fields retain their previous value).
//
// Architecture: this endpoint is the ONLY writer to the 4 risk-profile
// fields in Settings. The Master Brain endpoint (/api/ai/brain/master) is a
// READER — it loads the profile and applies adjustMasterBrainForRiskProfile()
// before returning the result.
//
// Refaktoriran z withAiRoute helperjem (v8.95.2-c) + enforceBudget guard
// (non-breaking — endpoint NE kliče AI direktno: GET load-a profile iz DB +
// compute-a sample adjustment preko masterBrain() (ki je deterministic TS,
// ne kliče AI/LLM SDK); POST write-a v Settings tablo. Budget guard +
// avtomatski recordAiCall je additive, ne breaking — isti vzorec kot vse
// v8.94.x / v8.95.x brain migracije).
//
// DVE ločena withAiRoute klica (GET + POST) — match-a brain/drafts vzorec
// (v8.95.0-c) ker GET in POST imata fundamentalno različno logiko (read iz
// Settings + masterBrain() sample adjustment vs. validate + write v Settings).
// Skupni handler bi zahteval method-branching v handler-ju, kar je manj čisto
// kot dva ločena handler-ja z lastno parseBody/validateInput logiko.
//
// Odstranjeno iz originala (v8.24 dev-mode workarounds ki niso več potrebni
// ker so Settings schema polja od v8.24 stabilna v @prisma/client):
//   - getFreshDb() — workaround za dev-mode PrismaClient caching po
//     `prisma generate` (sedaj uporabljamo ctx.db singleton iz @/lib/db)
//   - dynamic `await import('@/lib/db')` + `globalThis.prisma = undefined`
//     reset + console.error debug log v POST handler-ju
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=60.

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { Settings } from '@prisma/client';
import {
  withAiRoute,
  AI_ROUTE_DEFAULTS,
  type AiRouteContext,
} from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import {
  adjustMasterBrainForRiskProfile,
  validateProfile,
  DEFAULT_PROFILE,
  type UserRiskProfile,
  type RiskTolerance,
  type InvestmentHorizon,
  type RiskProfileAdjustment,
} from '@/lib/brain/risk-profile';
import { masterBrain } from '@/lib/brain/master';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Input interfaces -------------------------------------------------------

// GET — brez telesa / query parametra; parseBody vrne prazen objekt.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface RiskProfileGetInput {}

// POST — parsed body v obliki { profile: Partial<UserRiskProfile>, data: PrismaUpdatePayload }.
interface RiskProfilePostInput {
  /** Valid partial profile fields parsed from POST body. */
  profile: Partial<UserRiskProfile>;
  /** Prisma update payload (camelCase field names → DB columns). */
  data: Record<string, unknown>;
}

// --- GET: return current profile + sample adjustment ------------------------

export const GET = withAiRoute<RiskProfileGetInput>({
  endpoint: '/api/ai/brain/risk-profile',
  maxDuration: 60,
  enforceBudget: true, // v8.95.2-c: consistency guard (non-breaking)
  method: 'GET',

  parseBody: async () => ({}),

  // Brez validateInput — GET nima inputa

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, logger } = ctx;

    const profile = await loadProfile(db, logger);

    // Compute a sample adjustment using the CURRENT Master Brain output so
    // the UI can preview the impact of the profile. If masterBrain() fails,
    // we still return the profile — adjustment will be null.
    let adjustment: RiskProfileAdjustment | null = null;
    try {
      const masterResult = await masterBrain();
      adjustment = adjustMasterBrainForRiskProfile(masterResult, profile);
    } catch (err: unknown) {
      logger.warn(
        '/api/ai/brain/risk-profile',
        'failed to compute sample adjustment',
        err,
      );
    }

    return apiOk({
      ok: true as const,
      profile,
      adjustment,
    });
  },
});

// --- POST: validate + update profile fields ---------------------------------

export const POST = withAiRoute<RiskProfilePostInput>({
  endpoint: '/api/ai/brain/risk-profile',
  maxDuration: 60,
  enforceBudget: true, // v8.95.2-c: consistency guard (non-breaking)
  method: 'POST',

  parseBody: (req: NextRequest) => parsePostInput(req),

  // Brez validateInput — validation se izvaja v handler-ju ker vrača
  // specifičen response shape z `errors[]` poljem (ne le `error: string`).

  handler: async (input, ctx: AiRouteContext) => {
    const { db, logger } = ctx;

    if (Object.keys(input.profile).length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'No valid risk-profile fields in body. Expected at least one of: riskTolerance, maxAcceptableRisk, liquidityReserve, investmentHorizon.',
        },
        { status: 400 },
      );
    }

    // Validate the partial profile (validateProfile accepts Partial<>).
    const validation = validateProfile(input.profile);
    if (!validation.valid) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', errors: validation.errors },
        { status: 400 },
      );
    }

    // Update the singleton row. The singleton is guaranteed to exist (created
    // by app initialization). Using update() avoids the upsert create block
    // which triggers Prisma validation of all schema fields in dev mode.
    // If the row somehow doesn't exist, fall back to create with just id +
    // provided risk fields (all other Settings fields use their @default
    // values from schema.prisma).
    let updated: Settings;
    try {
      updated = await db.settings.update({
        where: { id: 'singleton' },
        data: input.data,
      });
    } catch (updateErr: unknown) {
      // Row doesn't exist — create it with just the id + provided risk fields.
      logger.warn(
        '/api/ai/brain/risk-profile',
        'update failed, trying create',
        updateErr,
      );
      updated = await db.settings.create({
        data: {
          id: 'singleton',
          ...input.data,
        } as any,
      });
    }

    // Read back the FULL profile (merge of pre-existing + updated values)
    // so the UI sees a consistent snapshot.
    const savedProfile = profileFromSettings(updated);

    logger.info('/api/ai/brain/risk-profile', 'profile updated', {
      riskTolerance: savedProfile.riskTolerance,
      maxAcceptableRisk: savedProfile.maxAcceptableRisk,
      liquidityReserve: savedProfile.liquidityReserve,
      investmentHorizon: savedProfile.investmentHorizon,
    });

    return apiOk({
      ok: true as const,
      profile: savedProfile,
    });
  },
});

// --- Pure helpers (čiste, testabilne) ---------------------------------------

/**
 * Load the 4 risk-profile fields from Settings singleton row.
 * On any DB error / missing row / missing fields, returns DEFAULT_PROFILE.
 *
 * Same logic as the loader in /api/ai/brain/master/route.ts (kept duplicated
 * to keep modules decoupled — could be extracted to @/lib/brain/profile-store
 * in a future refactor).
 */
async function loadProfile(
  db: AiRouteContext['db'],
  logger: AiRouteContext['logger'],
): Promise<UserRiskProfile> {
  try {
    const s = await db.settings.findUnique({ where: { id: 'singleton' } });
    if (!s) return DEFAULT_PROFILE;
    return profileFromSettings(s);
  } catch (err: unknown) {
    logger.warn(
      '/api/ai/brain/risk-profile',
      'failed to load profile, using DEFAULT',
      err,
    );
    return DEFAULT_PROFILE;
  }
}

/**
 * Read the 4 risk-profile fields from a Settings row (post-update or
 * post-findUnique). Validates each field — older rows may have invalid
 * values (treat any non-{conservative,balanced,aggressive} as balanced,
 * any non-{short,medium,long} as medium). Out-of-range numbers are clamped
 * to their valid range.
 *
 * Same logic as the inline reader in the original POST handler — extracted
 * here so both GET (via loadProfile) and POST (after update/create) share
 * the same transform.
 */
function profileFromSettings(s: Settings | null): UserRiskProfile {
  const rawTolerance = String(s?.userRiskTolerance ?? 'balanced').toLowerCase();
  const riskTolerance: RiskTolerance =
    rawTolerance === 'conservative' || rawTolerance === 'aggressive'
      ? rawTolerance
      : 'balanced';
  const rawHorizon = String(s?.userInvestmentHorizon ?? 'medium').toLowerCase();
  const investmentHorizon: InvestmentHorizon =
    rawHorizon === 'short' || rawHorizon === 'long' ? rawHorizon : 'medium';
  return {
    riskTolerance,
    maxAcceptableRisk:
      typeof s?.userMaxAcceptableRisk === 'number'
        ? Math.max(0, Math.min(100, s.userMaxAcceptableRisk))
        : 50,
    liquidityReserve:
      typeof s?.userLiquidityReserve === 'number' && s.userLiquidityReserve >= 0
        ? s.userLiquidityReserve
        : 500,
    investmentHorizon,
  };
}

/**
 * Parse the POST body and extract risk-profile fields.
 * Accepts any subset of the 4 fields — unspecified fields are omitted from
 * the Prisma `data` payload (so they retain their previous value).
 *
 * Returns `{ profile: {}, data: {} }` for non-POST requests, invalid
 * Content-Type, or non-object bodies.
 */
async function parsePostInput(req: NextRequest): Promise<RiskProfilePostInput> {
  let body: Record<string, unknown> = {};
  try {
    const ct = req.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const cloned = req.clone();
      const parsed = (await cloned.json()) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed;
      }
    }
  } catch {
    body = {};
  }
  return parseProfileBody(body);
}

/**
 * Extract the 4 risk-profile fields from a parsed body object. Each field
 * is validated individually — invalid values are silently dropped (not
 * added to the output), so the caller can detect "no valid fields" by
 * checking `Object.keys(profile).length === 0`.
 *
 * `profile` is the type-safe UserRiskProfile subset for validation/return;
 * `data` is the Prisma update payload (field names match the schema columns
 * userRiskTolerance / userMaxAcceptableRisk / userLiquidityReserve /
 * userInvestmentHorizon).
 */
function parseProfileBody(body: Record<string, unknown>): RiskProfilePostInput {
  const profile: Partial<UserRiskProfile> = {};
  const data: Record<string, unknown> = {};

  if (typeof body.riskTolerance === 'string') {
    const v = body.riskTolerance.toLowerCase();
    if (v === 'conservative' || v === 'balanced' || v === 'aggressive') {
      profile.riskTolerance = v;
      data.userRiskTolerance = v;
    }
  }
  if (typeof body.maxAcceptableRisk === 'number' && Number.isFinite(body.maxAcceptableRisk)) {
    const v = Math.max(0, Math.min(100, Math.round(body.maxAcceptableRisk)));
    profile.maxAcceptableRisk = v;
    data.userMaxAcceptableRisk = v;
  }
  if (typeof body.liquidityReserve === 'number' && Number.isFinite(body.liquidityReserve)) {
    const v = Math.max(0, body.liquidityReserve);
    profile.liquidityReserve = v;
    data.userLiquidityReserve = v;
  }
  if (typeof body.investmentHorizon === 'string') {
    const v = body.investmentHorizon.toLowerCase();
    if (v === 'short' || v === 'medium' || v === 'long') {
      profile.investmentHorizon = v;
      data.userInvestmentHorizon = v;
    }
  }

  return { profile, data };
}
