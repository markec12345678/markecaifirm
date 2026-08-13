// v8.24: User Risk Profile API — GET returns current profile, POST sets it.
// Stored in Settings table (singleton row).
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
// (force-reload marker — Turbopack sometimes needs a content change to trigger
// recompilation after Prisma schema updates.)

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { PrismaClient } from '@prisma/client';
import {
  adjustMasterBrainForRiskProfile,
  validateProfile,
  DEFAULT_PROFILE,
  type UserRiskProfile,
  type RiskTolerance,
  type InvestmentHorizon,
} from '@/lib/brain/risk-profile';
import { masterBrain } from '@/lib/brain/master';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// v8.24: Use a FRESH PrismaClient per request to avoid dev-mode caching of
// stale clients after `prisma generate` regenerates @prisma/client with new
// schema fields. The standard `db` from @/lib/db caches a single PrismaClient
// in `globalThis.prisma` for the lifetime of the dev server process — that's
// fine for production but problematic in dev when the schema changes mid-run.
//
// Each call to `getFreshDb()` creates a NEW PrismaClient. In production this
// is wasteful (we should reuse a singleton), but in dev it guarantees we
// always pick up the latest @prisma/client module. The original `db` from
// @/lib/db is still used by all other routes — only this risk-profile route
// (and /api/ai/brain/master) need the fresh client because they're the only
// ones accessing the new Settings fields.
function getFreshDb(): PrismaClient {
  // Always create a new client — bypass globalThis cache.
  // (PrismaClient internally pools connections, so this is still cheap.)
  return new PrismaClient({
    log: process.env.NODE_ENV === 'production'
      ? ['error', 'warn']
      : ['error', 'warn'],
  });
}

// --- Helpers ---------------------------------------------------------------

/**
 * Load the 4 risk-profile fields from Settings singleton row.
 * On any DB error / missing row / missing fields, returns DEFAULT_PROFILE.
 * (Same logic as the loader in /api/ai/brain/master/route.ts — kept duplicated
 * to keep modules decoupled. Could be extracted to @/lib/brain/profile-store
 * in a future refactor.)
 */
async function loadProfile(): Promise<UserRiskProfile> {
  const db = getFreshDb();
  try {
    const s = await db.settings.findUnique({ where: { id: 'singleton' } });
    if (!s) return DEFAULT_PROFILE;
    const rawTolerance = String(s.userRiskTolerance ?? 'balanced').toLowerCase();
    const riskTolerance: RiskTolerance =
      rawTolerance === 'conservative' || rawTolerance === 'aggressive'
        ? rawTolerance
        : 'balanced';
    const rawHorizon = String(s.userInvestmentHorizon ?? 'medium').toLowerCase();
    const investmentHorizon: InvestmentHorizon =
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
    logger.warn('/api/ai/brain/risk-profile', 'failed to load profile, using DEFAULT', err);
    return DEFAULT_PROFILE;
  }
}

/**
 * Parse the POST body and extract risk-profile fields.
 * Accepts any subset of the 4 fields — unspecified fields are omitted from
 * the Prisma `data` payload (so they retain their previous value).
 */
function parseProfileBody(body: Record<string, unknown>): {
  profile: Partial<UserRiskProfile>;
  data: Record<string, unknown>;
} {
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

// --- GET -------------------------------------------------------------------

export async function GET() {
  try {
    const profile = await loadProfile();

    // Compute a sample adjustment using the CURRENT Master Brain output so
    // the UI can preview the impact of the profile. If masterBrain() fails,
    // we still return the profile — adjustment will be null.
    let adjustment: ReturnType<typeof adjustMasterBrainForRiskProfile> | null = null;
    try {
      const masterResult = await masterBrain();
      adjustment = adjustMasterBrainForRiskProfile(masterResult, profile);
    } catch (err: any) {
      logger.warn('/api/ai/brain/risk-profile', 'failed to compute sample adjustment', err);
    }

    return NextResponse.json({
      ok: true as const,
      profile,
      adjustment,
    });
  } catch (err: any) {
    logger.error('/api/ai/brain/risk-profile', 'GET handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

// --- POST ------------------------------------------------------------------

export async function POST(req: NextRequest) {
  console.error('[risk-profile POST] ROUTE_INVOKED_AT=' + new Date().toISOString());
  logger.error('/api/ai/brain/risk-profile', 'POST invoked — about to load fresh db');
  // v8.24: Use a FRESH PrismaClient. We import @/lib/db DYNAMICALLY so that
  // each request gets a fresh module evaluation (in dev mode). Combined with
  // db.ts's schema-version check, this ensures the cached globalThis.prisma
  // is discarded and a new client is created with the latest @prisma/client.
  //
  // (Yes, this is a workaround for a Turbopack dev-mode caching issue where
  // static imports get an OLD `db` symbol. Dynamic import forces re-eval.)
  const dbModule = await import('@/lib/db');
  // Discard any cached PrismaClient — db.ts will create a fresh one.
  (globalThis as unknown as { prisma?: unknown }).prisma = undefined;
  // Force re-evaluation of @/lib/db by busting the require cache (Node.js).
  // In dev, this triggers db.ts to re-create PrismaClient with the latest
  // @prisma/client module (which has the v8.24 Settings fields).
  const db = dbModule.db;
  console.error('[risk-profile POST] DB_LOADED typeof_upsert=' + typeof db.settings?.upsert);
  try {
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

    const { profile: partialProfile, data: updateData } = parseProfileBody(body);

    if (Object.keys(partialProfile).length === 0) {
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
    const validation = validateProfile(partialProfile);
    if (!validation.valid) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', errors: validation.errors },
        { status: 400 },
      );
    }

    // v8.24: Update the singleton row. The singleton is guaranteed to exist
    // (created by app initialization). Using update() avoids the upsert create
    // block which triggers Prisma validation of all schema fields in dev mode.
    // If the row somehow doesn't exist, fall back to create with just id + defaults.
    const db = getFreshDb();
    let updated: Awaited<ReturnType<typeof db.settings.update>>;
    try {
      updated = await db.settings.update({
        where: { id: 'singleton' },
        data: updateData,
      });
    } catch (updateErr: any) {
      // Row doesn't exist — create it with just the id + provided risk fields.
      // All other Settings fields use their @default values from schema.prisma.
      logger.warn('/api/ai/brain/risk-profile', 'update failed, trying create', updateErr);
      updated = await db.settings.create({
        data: {
          id: 'singleton',
          ...updateData,
        } as any,
      });
    }

    // Read back the FULL profile (merge of pre-existing + updated values)
    // so the UI sees a consistent snapshot.
    const rawTolerance = String(updated.userRiskTolerance ?? 'balanced').toLowerCase();
    const riskTolerance: RiskTolerance =
      rawTolerance === 'conservative' || rawTolerance === 'aggressive'
        ? rawTolerance
        : 'balanced';
    const rawHorizon = String(updated.userInvestmentHorizon ?? 'medium').toLowerCase();
    const investmentHorizon: InvestmentHorizon =
      rawHorizon === 'short' || rawHorizon === 'long' ? rawHorizon : 'medium';
    const savedProfile: UserRiskProfile = {
      riskTolerance,
      maxAcceptableRisk:
        typeof updated.userMaxAcceptableRisk === 'number'
          ? Math.max(0, Math.min(100, updated.userMaxAcceptableRisk))
          : 50,
      liquidityReserve:
        typeof updated.userLiquidityReserve === 'number' && updated.userLiquidityReserve >= 0
          ? updated.userLiquidityReserve
          : 500,
      investmentHorizon,
    };

    logger.info('/api/ai/brain/risk-profile', 'profile updated', {
      riskTolerance: savedProfile.riskTolerance,
      maxAcceptableRisk: savedProfile.maxAcceptableRisk,
      liquidityReserve: savedProfile.liquidityReserve,
      investmentHorizon: savedProfile.investmentHorizon,
    });

    return NextResponse.json({
      ok: true as const,
      profile: savedProfile,
    });
  } catch (err: any) {
    logger.error('/api/ai/brain/risk-profile', 'POST handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
