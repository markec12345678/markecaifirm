// v8.28: Adaptive Domain Weights API — feedback loop.
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
// runtime='nodejs', dynamic='force-dynamic', maxDuration=60.

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  loadAdaptiveWeights,
  recordActionFeedback,
  resetAdaptiveWeights,
  setDomainWeight,
  type AdaptiveWeights,
  type WeightAdjustmentResult,
} from '@/lib/brain/adaptive-weights';
import type { DomainName } from '@/lib/brain/master';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// --- Domain name validation -----------------------------------------------

const ALL_DOMAINS: DomainName[] = ['profit', 'inventory', 'market', 'sourcing', 'risk', 'buyer', 'pricing'];
const DOMAIN_SET = new Set<string>(ALL_DOMAINS);

function isValidDomain(d: unknown): d is DomainName {
  return typeof d === 'string' && DOMAIN_SET.has(d);
}

// --- GET -------------------------------------------------------------------

export async function GET() {
  try {
    const weights: AdaptiveWeights = await loadAdaptiveWeights();
    return NextResponse.json({
      ok: true as const,
      adaptiveWeights: weights,
      source: 'v8.28-adaptive-weights',
    });
  } catch (err: any) {
    logger.error('/api/ai/brain/weights', 'GET handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

// --- POST ------------------------------------------------------------------

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

    // --- action: record ----------------------------------------------------
    if (action === 'record') {
      const domain = body.domain;
      const feedback = body.feedback;

      if (!isValidDomain(domain)) {
        return NextResponse.json(
          {
            ok: false,
            error: `Invalid domain: ${JSON.stringify(domain)}. Must be one of: ${ALL_DOMAINS.join(', ')}.`,
          },
          { status: 400 },
        );
      }
      if (feedback !== 'executed' && feedback !== 'rejected') {
        return NextResponse.json(
          {
            ok: false,
            error: `Invalid feedback: ${JSON.stringify(feedback)}. Must be 'executed' or 'rejected'.`,
          },
          { status: 400 },
        );
      }

      const result: WeightAdjustmentResult = await recordActionFeedback({
        domain,
        action: '',
        feedback,
      });

      return NextResponse.json(result);
    }

    // --- action: reset -----------------------------------------------------
    if (action === 'reset') {
      const result = await resetAdaptiveWeights();
      return NextResponse.json(result);
    }

    // --- action: set -------------------------------------------------------
    if (action === 'set') {
      const domain = body.domain;
      const weight = body.weight;

      if (!isValidDomain(domain)) {
        return NextResponse.json(
          {
            ok: false,
            error: `Invalid domain: ${JSON.stringify(domain)}. Must be one of: ${ALL_DOMAINS.join(', ')}.`,
          },
          { status: 400 },
        );
      }
      if (typeof weight !== 'number' || !Number.isFinite(weight)) {
        return NextResponse.json(
          {
            ok: false,
            error: `Invalid weight: ${JSON.stringify(weight)}. Must be a finite number.`,
          },
          { status: 400 },
        );
      }

      try {
        const result = await setDomainWeight(domain, weight);
        return NextResponse.json(result);
      } catch (err: any) {
        return NextResponse.json(
          { error: err?.message ?? 'Napaka pri setDomainWeight' },
          { status: 400 },
        );
      }
    }

    // --- unknown action ----------------------------------------------------
    return NextResponse.json(
      {
        ok: false,
        error: `Unknown action: ${JSON.stringify(action)}. Must be 'record', 'reset', or 'set'.`,
      },
      { status: 400 },
    );
  } catch (err: any) {
    logger.error('/api/ai/brain/weights', 'POST handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
