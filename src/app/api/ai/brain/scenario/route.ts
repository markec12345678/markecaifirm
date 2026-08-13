// v8.27: Scenario Brain API — "What if?" simulator.
//
// GET:  runs 3 preset scenarios (conservative/balanced/aggressive) in
//       parallel via compareScenarios() (which itself calls masterBrain()
//       3× via Promise.all). Returns ScenarioComparison with comparisonTable
//       (8 metrics × 3 columns) + recommendation (best scenario by 12m profit).
// POST: accepts custom overrides in body (any subset of MasterBrainInput
//       fields — profitInput, inventoryInput, marketInput, sourcingInput,
//       riskInput, buyerInput, pricingInput, plus skip flags). Runs the 3
//       presets PLUS a 4th 'custom' scenario with the user-supplied overrides.
//       Returns ScenarioComparison with custom column included.
//
// 15-MIN CACHE: longer than Master Brain's 10-min cache because:
//   - Each compareScenarios() call runs masterBrain() 3× (3 × 14ms ≈ 14ms
//     wall-clock via Promise.all — but still 3× the CPU work).
//   - The 3 preset scenarios are DETERMINISTIC and depend only on Master
//     Brain's compute (no DB state at this layer — the individual Domain
//     Brains handle their own DB injection when invoked).
//   - Custom scenario: cache key includes a stable hash of the overrides so
//     different custom inputs get different cache entries.
//
// DETERMINISTIC (aiUsed: false): no external AI/LLM SDK is called.
// Scenario Brain is pure orchestration above Master Brain — no DB, no AI.
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=60.
//
// Response shape (ScenarioComparison):
//   {
//     ok: true,
//     scenarios: [ScenarioResult, ScenarioResult, ScenarioResult], // 3 presets
//     baseCapital: 1500,
//     custom?: ScenarioResult,                                       // POST only
//     comparisonTable: [
//       { metric, conservative, balanced, aggressive, custom? }, × 8
//     ],
//     recommendation: { bestScenario, reasoning },
//     source: 'v8.27-scenario-brain',
//     cachedAt?: number
//   }

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';
import {
  compareScenarios,
  type ScenarioComparison,
} from '@/lib/brain/scenario';
import type { MasterBrainInput } from '@/lib/brain/master';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// --- Cache TTL -----------------------------------------------------------
// 15 minutes — longer than Master Brain's 10-min cache because Scenario Brain
// runs 3× masterBrain() and the results are stable across calls (the presets
// are fixed; only the custom POST body varies the cache key).
const SCENARIO_CACHE_TTL_MS = 15 * 60 * 1000;

// --- Input resolution ----------------------------------------------------

/**
 * Parse MasterBrainInput overrides from POST body. Accepts any subset of
 * the 7 per-domain input namespaces (profitInput, inventoryInput, ...) plus
 * skip flags. We do NOT validate each field — the individual Domain Brain
 * will sanitize/normalize via its own normalizeInput() function.
 *
 * Returns Partial<MasterBrainInput> — empty object if no overrides were
 * supplied (in which case compareScenarios() will only run the 3 presets,
 * skipping the custom scenario).
 */
async function parseBodyOverrides(req: NextRequest): Promise<Partial<MasterBrainInput>> {
  if (req.method !== 'POST') return {};
  try {
    const ct = req.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return {};
    const cloned = req.clone();
    const parsed = (await cloned.json()) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const out: Partial<MasterBrainInput> = {};

    // Per-domain input overrides — accept any nested object the caller provides.
    const asObject = (key: string): Record<string, unknown> | undefined => {
      const v = parsed[key];
      if (v == null) return undefined;
      if (typeof v === 'object' && !Array.isArray(v)) {
        return v as Record<string, unknown>;
      }
      return undefined;
    };

    const profitInput = asObject('profitInput');
    if (profitInput) out.profitInput = profitInput as MasterBrainInput['profitInput'];
    const inventoryInput = asObject('inventoryInput');
    if (inventoryInput) out.inventoryInput = inventoryInput as MasterBrainInput['inventoryInput'];
    const marketInput = asObject('marketInput');
    if (marketInput) out.marketInput = marketInput as MasterBrainInput['marketInput'];
    const sourcingInput = asObject('sourcingInput');
    if (sourcingInput) out.sourcingInput = sourcingInput as MasterBrainInput['sourcingInput'];
    const riskInput = asObject('riskInput');
    if (riskInput) out.riskInput = riskInput as MasterBrainInput['riskInput'];
    const buyerInput = asObject('buyerInput');
    if (buyerInput) out.buyerInput = buyerInput as MasterBrainInput['buyerInput'];
    const pricingInput = asObject('pricingInput');
    if (pricingInput) out.pricingInput = pricingInput as MasterBrainInput['pricingInput'];

    // Skip flags — useful for performance experiments
    const asBoolean = (key: string): boolean | undefined => {
      const v = parsed[key];
      if (v == null) return undefined;
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') {
        const s = v.toLowerCase().trim();
        if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
        if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
      }
      if (typeof v === 'number') return v !== 0;
      return undefined;
    };

    const skipProfit = asBoolean('skipProfit');
    if (skipProfit != null) out.skipProfit = skipProfit;
    const skipInventory = asBoolean('skipInventory');
    if (skipInventory != null) out.skipInventory = skipInventory;
    const skipMarket = asBoolean('skipMarket');
    if (skipMarket != null) out.skipMarket = skipMarket;
    const skipSourcing = asBoolean('skipSourcing');
    if (skipSourcing != null) out.skipSourcing = skipSourcing;
    const skipRisk = asBoolean('skipRisk');
    if (skipRisk != null) out.skipRisk = skipRisk;
    const skipBuyer = asBoolean('skipBuyer');
    if (skipBuyer != null) out.skipBuyer = skipBuyer;
    const skipPricing = asBoolean('skipPricing');
    if (skipPricing != null) out.skipPricing = skipPricing;

    return out;
  } catch {
    return {};
  }
}

// --- Cache key -----------------------------------------------------------

/**
 * Build a deterministic cache key from the custom overrides.
 *
 * GET requests always produce the same key (no overrides → empty string).
 * POST requests produce a key that incorporates the overrides hash, so
 * different custom inputs get different cache entries.
 *
 * The key starts with `scenario-brain:` so it doesn't collide with
 * `master-brain:` or `brain-explain:` keys.
 */
function buildCacheKey(customOverrides: Partial<MasterBrainInput>): string {
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
  parts.push(`pi:${stableStringify(customOverrides.profitInput)}`);
  parts.push(`ii:${stableStringify(customOverrides.inventoryInput)}`);
  parts.push(`mi:${stableStringify(customOverrides.marketInput)}`);
  parts.push(`si:${stableStringify(customOverrides.sourcingInput)}`);
  parts.push(`ri:${stableStringify(customOverrides.riskInput)}`);
  parts.push(`bi:${stableStringify(customOverrides.buyerInput)}`);
  parts.push(`pri:${stableStringify(customOverrides.pricingInput)}`);
  parts.push(`sP:${customOverrides.skipProfit ?? false}`);
  parts.push(`sI:${customOverrides.skipInventory ?? false}`);
  parts.push(`sM:${customOverrides.skipMarket ?? false}`);
  parts.push(`sS:${customOverrides.skipSourcing ?? false}`);
  parts.push(`sR:${customOverrides.skipRisk ?? false}`);
  parts.push(`sB:${customOverrides.skipBuyer ?? false}`);
  parts.push(`sPr:${customOverrides.skipPricing ?? false}`);
  return `scenario-brain:${parts.join('|')}`;
}

// --- Handlers ------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleScenarioBrain(req);
}

export async function POST(req: NextRequest) {
  return handleScenarioBrain(req);
}

async function handleScenarioBrain(req: NextRequest) {
  try {
    // 1. Parse optional custom overrides (POST only — empty for GET)
    const customOverrides = await parseBodyOverrides(req);

    // 2. Build cache key — same overrides → same key → cache hit
    const cacheKey = buildCacheKey(customOverrides);

    // 3. Check cache — return immediately if fresh
    const cached = getCachedAI<ScenarioComparison>(cacheKey);
    if (cached) {
      // Re-stamp cachedAt so the caller sees a fresh "served at" timestamp
      return NextResponse.json({ ...cached, cachedAt: Date.now() });
    }

    // 4. Run all 3 preset scenarios (+ custom if overrides provided) in parallel
    const result = await compareScenarios(
      Object.keys(customOverrides).length > 0 ? customOverrides : undefined,
    );

    // 5. Cache for 15 min (longer than master's 10 min because 3× compute)
    setCachedAI(cacheKey, result, SCENARIO_CACHE_TTL_MS);

    return NextResponse.json({ ...result, cachedAt: Date.now() });
  } catch (err: any) {
    logger.error('/api/ai/brain/scenario', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
