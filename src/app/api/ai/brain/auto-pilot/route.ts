// v8.30: Safe Auto-pilot API — 🎯 AUTOMATION PHASE STARTED.
// GET  /api/ai/brain/auto-pilot — returns current config + stats (today + all-time).
// POST /api/ai/brain/auto-pilot — 2 actions:
//   { action: 'run' }                    → triggers auto-pilot run (manual trigger)
//                                          returns AutoPilotRunResult with
//                                          checked/autoExecuted/skipped lists
//   { action: 'config', config: {...} }  → updates config (Partial<AutoPilotConfig>)
//                                          e.g. { enabled: true } or
//                                          { dailyLimit: 3, dailyBudgetEUR: 250 }
//                                          returns { ok, config }
//
// Rollback is at /api/ai/brain/auto-pilot/rollback (separate route).
// Cron is at /api/cron/auto-pilot (hourly auto-trigger).
//
// 8 SAFETY RULES (all must pass for an action to be auto-executed):
// 1. autoPilotEnabled=true (master switch)
// 2. autoPilotMode='safe' (v8.31 will add 'aggressive')
// 3. User risk tolerance != 'conservative' (v8.24)
// 4. confidence='LOW' (HIGH/MEDIUM always need manual)
// 5. expectedUpliftEUR < 100€
// 6. domain != 'risk' (risk mitigation needs human judgment)
// 7. today's auto-executed count < dailyLimit (default 5)
// 8. today's auto-executed budget + this draft's uplift < dailyBudgetEUR (default 500€)
//
// Each auto-execution:
// - Sets draft.status='executed', autoExecuted=true, executedAt=now
// - Records autoPilotReason (8-rule audit trail, semicolon-separated)
// - Calls recordActionFeedback() from v8.28 via updateDraftStatus()
// - Is rollbackable (POST /rollback)
//
// MEDIUM/HIGH risk actions stay 'pending' for manual ✅ Izvedel click (v8.29).
//
// DETERMINISTIC (aiUsed: false): no AI/LLM SDK called. Real-world side effects
// (sending Telegram, relisting items) are OUT OF SCOPE for v8.30 — this is
// purely bookkeeping + audit trail. v8.31+ will add execution-side integration.

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  runSafeAutoPilot,
  getAutoPilotStats,
  updateAutoPilotConfig,
  type AutoPilotConfig,
} from '@/lib/brain/auto-pilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// --- GET: stats + config ----------------------------------------------------

export async function GET() {
  try {
    const stats = await getAutoPilotStats();
    return NextResponse.json(stats);
  } catch (err: any) {
    logger.error('/api/ai/brain/auto-pilot', 'GET handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

// --- POST: run OR config update --------------------------------------------

export async function POST(req: NextRequest) {
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

    const action = typeof body.action === 'string' ? body.action.toLowerCase().trim() : '';

    // --- action: run -------------------------------------------------------
    if (action === 'run') {
      const result = await runSafeAutoPilot();
      return NextResponse.json(result);
    }

    // --- action: config ----------------------------------------------------
    if (action === 'config') {
      const rawConfig = body.config;
      if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
        return NextResponse.json(
          {
            ok: false,
            error: `Invalid 'config' — expected an object with optional fields: enabled, mode, dailyLimit, dailyBudgetEUR.`,
          },
          { status: 400 },
        );
      }
      const cfgObj = rawConfig as Record<string, unknown>;
      const updates: Partial<AutoPilotConfig> = {};
      if (typeof cfgObj.enabled === 'boolean') updates.enabled = cfgObj.enabled;
      if (cfgObj.mode === 'safe' || cfgObj.mode === 'aggressive') {
        updates.mode = cfgObj.mode;
      }
      if (typeof cfgObj.dailyLimit === 'number' && Number.isFinite(cfgObj.dailyLimit)) {
        updates.dailyLimit = cfgObj.dailyLimit;
      }
      if (typeof cfgObj.dailyBudgetEUR === 'number' && Number.isFinite(cfgObj.dailyBudgetEUR)) {
        updates.dailyBudgetEUR = cfgObj.dailyBudgetEUR;
      }
      // lastRunAt is read-only via this endpoint (only set by runSafeAutoPilot)

      if (Object.keys(updates).length === 0) {
        return NextResponse.json(
          {
            ok: false,
            error: `No valid config fields in body.config. Expected at least one of: enabled (boolean), mode ('safe'|'aggressive'), dailyLimit (number), dailyBudgetEUR (number).`,
          },
          { status: 400 },
        );
      }

      const result = await updateAutoPilotConfig(updates);
      return NextResponse.json(result);
    }

    // --- unknown action ----------------------------------------------------
    return NextResponse.json(
      {
        ok: false,
        error: `Unknown action: ${JSON.stringify(action)}. Must be 'run' (trigger auto-pilot) or 'config' (update config).`,
      },
      { status: 400 },
    );
  } catch (err: any) {
    logger.error('/api/ai/brain/auto-pilot', 'POST handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
