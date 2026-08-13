// v8.27: Scenario Brain — "What if?" simulator. Generates 3 preset scenarios
// (conservative/balanced/aggressive) + accepts custom what-if inputs.
// Runs Master Brain for EACH scenario in parallel, returns comparison.
//
// Architectural role: this is the WHAT-IF layer of the Intelligence phase.
//   - v8.22 Master Brain gives ONE strategy (the WHAT — "Kaj naj naredim danes?")
//   - v8.24 Risk Profile makes it PERSONAL (subjective adjustment)
//   - v8.26 Explainability gives the WHY ("Zakaj točno to akcijo?")
//   - v8.27 Scenario Brain gives the WHAT IF ("Kaj če investiram 5000€ več?")
//
// How it works:
// 1. Defines 3 preset ScenarioConfig objects:
//    - CONSERVATIVE: -30% capitalDeployed, +100% liquidityReserve (1000€),
//      lower concentration allowed, fewer items.
//    - BALANCED: default (mirrors current Master Brain output — no overrides)
//    - AGGRESSIVE: +50% capitalDeployed (2250€), more items (27), higher
//      concentration tolerated (50%), more trades/month (15).
// 2. compareScenarios() runs all 3 presets in PARALLEL via Promise.all —
//    each calls masterBrain() with its overrides applied.
// 3. If customOverrides is provided (POST endpoint), a 4th 'custom' scenario
//    is run too.
// 4. Returns ScenarioComparison with:
//    - scenarios[] (3 or 4 ScenarioResult, each containing full MasterBrainResult)
//    - comparisonTable (8 rows × 3-4 columns of side-by-side metrics)
//    - recommendation { bestScenario, reasoning } — best by projectedProfit12m
//
// Pure TypeScript function — no `next/server` import, no Prisma calls, no AI.
// Reuses masterBrain() directly (which itself calls all 7 Domain Brains).
// Each scenario run is ~14ms (same as Master Brain) — 3 in parallel = ~14ms
// wall-clock (Promise.all). The route layer caches for 15 min because the
// preset scenarios are STABLE (they only depend on Master Brain's deterministic
// compute — which itself is stable across calls).

import {
  masterBrain,
  type MasterBrainResult,
  type MasterBrainInput,
} from './master';
import type { ProfitGrade } from './profit';

export type ScenarioType = 'conservative' | 'balanced' | 'aggressive' | 'custom';

export interface ScenarioConfig {
  type: ScenarioType;
  label: string;                    // human-readable (Slovenian)
  description: string;               // 1-sentence explanation
  capitalMultiplier: number;        // 0.7 for conservative, 1.0 balanced, 1.5 aggressive
  riskTolerance: 'LOW' | 'MEDIUM' | 'HIGH';
  liquidityReserveEUR: number;       // 1000 conservative, 500 balanced, 200 aggressive
  // Per-domain input overrides (applied to MasterBrainInput)
  overrides: Partial<MasterBrainInput>;
}

export interface ScenarioResult {
  type: ScenarioType;
  label: string;
  description: string;
  config: ScenarioConfig;
  masterResult: MasterBrainResult;
  // Derived comparison metrics (extracted from masterResult for easy side-by-side)
  comparison: {
    projectedProfit30d: number;
    projectedProfit90d: number;
    projectedProfit12m: number;
    overallHealth: number;
    healthGrade: ProfitGrade;
    riskLevel: string;
    topAction: string;               // masterResult.topActions[0].action (truncated to 80 chars)
    topActionUpliftEUR: number;
    capitalRequired: number;         // derived from config.capitalMultiplier × base
    conflictsCount: number;
    bottlenecksCount: number;
  };
}

export interface ScenarioComparison {
  ok: true;
  scenarios: ScenarioResult[];        // 3 (conservative + balanced + aggressive) — custom is separate
  baseCapital: number;               // the "current" capital used as baseline (1500€)
  custom?: ScenarioResult;           // only if custom input was provided
  comparisonTable: Array<{
    metric: string;
    conservative: string | number;
    balanced: string | number;
    aggressive: string | number;
    custom?: string | number;
  }>;
  recommendation: {
    bestScenario: ScenarioType;     // which scenario has highest projectedProfit12m
    reasoning: string;               // why this scenario is recommended (Slovenian)
  };
  source: 'v8.27-scenario-brain';
  cachedAt?: number;
}

// --- Preset scenario configs ---------------------------------------------
//
// Rationale for each preset:
//
// CONSERVATIVE: For users who want to PROTECT capital. Reduce deployed
// capital by 30% (1500€ → 1050€), keep MORE cash in reserve (1000€ vs 500€
// default), and limit concentration to 30% (vs default ~40%). Fewer items,
// smaller aged stock. This produces a LOWER projected profit but a HIGHER
// overallHealth score (because risk is contained).
//
// BALANCED: Mirrors the current Master Brain output. No overrides applied —
// masterBrain() is called with the same default inputs the master endpoint
// uses. This is the "control" scenario — the other two are compared against
// it.
//
// AGGRESSIVE: For users who want to SCALE. Increase deployed capital by 50%
// (1500€ → 2250€), increase trades/month to 15 (vs default ~10), carry more
// items (27 vs default ~18), tolerate higher concentration (50%). This
// produces a HIGHER projected profit but a LOWER overallHealth (more risk).

const BASE_CAPITAL_EUR = 1500;

export const CONSERVATIVE_CONFIG: ScenarioConfig = {
  type: 'conservative',
  label: 'Konzervativni',
  description: 'Manj kapitala, večje rezerve, samo nizko-tveganje akcije',
  capitalMultiplier: 0.7,
  riskTolerance: 'LOW',
  liquidityReserveEUR: 1000,
  overrides: {
    // 1500 × 0.7 = 1050
    profitInput: { capitalDeployed: 1050 },
    inventoryInput: { capitalDeployed: 1050, agedItemsValue: 150 },
    // Lower concentration threshold for conservative profile
    riskInput: { capitalConcentrationPct: 30, totalCapitalDeployed: 1050 },
  },
};

export const BALANCED_CONFIG: ScenarioConfig = {
  type: 'balanced',
  label: 'Uravnovešeni',
  description: 'Trenutno stanje — brez sprememb',
  capitalMultiplier: 1.0,
  riskTolerance: 'MEDIUM',
  liquidityReserveEUR: 500,
  overrides: {}, // no overrides = current Master Brain output
};

export const AGGRESSIVE_CONFIG: ScenarioConfig = {
  type: 'aggressive',
  label: 'Agresivni',
  description: 'Več kapitala, manj rezerv, dovoljena visoko-tveganja akcije',
  capitalMultiplier: 1.5,
  riskTolerance: 'HIGH',
  liquidityReserveEUR: 200,
  overrides: {
    // 1500 × 1.5 = 2250, plus more aggressive volume
    profitInput: { capitalDeployed: 2250, tradesPerMonth: 15 },
    inventoryInput: { capitalDeployed: 2250, itemCount: 27 },
    // Higher concentration acceptable for aggressive profile
    riskInput: { totalCapitalDeployed: 2250, capitalConcentrationPct: 50 },
  },
};

/**
 * Run Master Brain for a single scenario (with its overrides applied).
 *
 * The baseInput (if provided) is merged UNDER the scenario's overrides —
 * scenario overrides win. This lets the caller pass a MasterBrainInput
 * (e.g. loaded from current Settings state) and have each preset apply
 * its delta on top.
 */
export async function runScenario(
  config: ScenarioConfig,
  baseInput?: MasterBrainInput,
): Promise<ScenarioResult> {
  // Scenario overrides win over baseInput (shallow merge per top-level key —
  // the individual Domain Brains will deep-merge their own nested overrides).
  const input: MasterBrainInput = {
    ...baseInput,
    ...config.overrides,
  };
  const masterResult = await masterBrain(input);

  const topAction = masterResult.topActions[0];

  return {
    type: config.type,
    label: config.label,
    description: config.description,
    config,
    masterResult,
    comparison: {
      projectedProfit30d: masterResult.strategy.projection30d.profitEUR,
      projectedProfit90d: masterResult.strategy.projection90d.profitEUR,
      projectedProfit12m: masterResult.strategy.projection12m.profitEUR,
      overallHealth: masterResult.overallHealth.score,
      healthGrade: masterResult.overallHealth.grade,
      riskLevel: masterResult.overallHealth.riskLevel,
      topAction: topAction?.action?.substring(0, 80) ?? '—',
      topActionUpliftEUR: topAction?.expectedUpliftEUR ?? 0,
      capitalRequired: BASE_CAPITAL_EUR * config.capitalMultiplier,
      conflictsCount: masterResult.conflicts.length,
      bottlenecksCount: masterResult.overallHealth.bottlenecks.length,
    },
  };
}

/**
 * Run all 3 preset scenarios in PARALLEL + optional custom scenario.
 *
 * The 3 presets (conservative + balanced + aggressive) always run — they
 * form the comparison baseline. The custom scenario (if customOverrides is
 * provided) runs as a 4th scenario appended to `custom` (not to `scenarios[]`
 * — they stay as the canonical 3 presets).
 *
 * Returns ScenarioComparison with the comparisonTable (8 metrics × 3-4 columns)
 * and a recommendation (best scenario by projectedProfit12m).
 */
export async function compareScenarios(
  customOverrides?: Partial<MasterBrainInput>,
  baseInput?: MasterBrainInput,
): Promise<ScenarioComparison> {
  // 1. Run 3 presets in parallel (Promise.all — each is ~14ms, total ~14ms wall)
  const [conservative, balanced, aggressive] = await Promise.all([
    runScenario(CONSERVATIVE_CONFIG, baseInput),
    runScenario(BALANCED_CONFIG, baseInput),
    runScenario(AGGRESSIVE_CONFIG, baseInput),
  ]);

  // 2. If custom overrides provided, run that too (sequentially — preserves
  //    the 3-preset baseline even if the custom call throws)
  let custom: ScenarioResult | undefined;
  if (customOverrides && Object.keys(customOverrides).length > 0) {
    const customConfig: ScenarioConfig = {
      type: 'custom',
      label: 'Custom',
      description: 'Uporabnikovo what-if scenarij',
      capitalMultiplier: 1.0,
      riskTolerance: 'MEDIUM',
      liquidityReserveEUR: 500,
      overrides: customOverrides,
    };
    custom = await runScenario(customConfig, baseInput);
  }

  // 3. Build comparison table rows (8 metrics × 3-4 columns).
  //    Each cell is a pre-formatted string (or number for counts) for easy
  //    rendering. The UI doesn't need to know the shape of MasterBrainResult.
  const fmtEUR = (v: number) => `${v.toFixed(0)}€`;
  const fmtHealth = (s: ScenarioResult) =>
    `${s.comparison.overallHealth.toFixed(0)}/100 (${s.comparison.healthGrade})`;

  const comparisonTable: ScenarioComparison['comparisonTable'] = [
    {
      metric: 'Projiciran profit 30d',
      conservative: fmtEUR(conservative.comparison.projectedProfit30d),
      balanced: fmtEUR(balanced.comparison.projectedProfit30d),
      aggressive: fmtEUR(aggressive.comparison.projectedProfit30d),
      custom: custom ? fmtEUR(custom.comparison.projectedProfit30d) : undefined,
    },
    {
      metric: 'Projiciran profit 90d',
      conservative: fmtEUR(conservative.comparison.projectedProfit90d),
      balanced: fmtEUR(balanced.comparison.projectedProfit90d),
      aggressive: fmtEUR(aggressive.comparison.projectedProfit90d),
      custom: custom ? fmtEUR(custom.comparison.projectedProfit90d) : undefined,
    },
    {
      metric: 'Projiciran profit 12m',
      conservative: fmtEUR(conservative.comparison.projectedProfit12m),
      balanced: fmtEUR(balanced.comparison.projectedProfit12m),
      aggressive: fmtEUR(aggressive.comparison.projectedProfit12m),
      custom: custom ? fmtEUR(custom.comparison.projectedProfit12m) : undefined,
    },
    {
      metric: 'Overall Health',
      conservative: fmtHealth(conservative),
      balanced: fmtHealth(balanced),
      aggressive: fmtHealth(aggressive),
      custom: custom ? fmtHealth(custom) : undefined,
    },
    {
      metric: 'Risk Level',
      conservative: conservative.comparison.riskLevel,
      balanced: balanced.comparison.riskLevel,
      aggressive: aggressive.comparison.riskLevel,
      custom: custom?.comparison.riskLevel,
    },
    {
      metric: 'Top akcija',
      conservative: conservative.comparison.topAction,
      balanced: balanced.comparison.topAction,
      aggressive: aggressive.comparison.topAction,
      custom: custom?.comparison.topAction,
    },
    {
      metric: 'Capital potreben',
      conservative: fmtEUR(conservative.comparison.capitalRequired),
      balanced: fmtEUR(balanced.comparison.capitalRequired),
      aggressive: fmtEUR(aggressive.comparison.capitalRequired),
      custom: custom ? fmtEUR(custom.comparison.capitalRequired) : undefined,
    },
    {
      metric: 'Konflikti',
      conservative: conservative.comparison.conflictsCount,
      balanced: balanced.comparison.conflictsCount,
      aggressive: aggressive.comparison.conflictsCount,
      custom: custom?.comparison.conflictsCount,
    },
  ];

  // 4. Recommend best scenario (highest projectedProfit12m).
  //    Tie-breaker: higher overallHealth (safer wins on ties).
  //    Custom is included in the comparison if present.
  const allScenarios = custom ? [...[conservative, balanced, aggressive], custom] : [conservative, balanced, aggressive];
  const best = allScenarios.reduce((bestSoFar, s) => {
    if (s.comparison.projectedProfit12m > bestSoFar.comparison.projectedProfit12m) return s;
    if (
      Math.abs(s.comparison.projectedProfit12m - bestSoFar.comparison.projectedProfit12m) < 0.5 &&
      s.comparison.overallHealth > bestSoFar.comparison.overallHealth
    ) {
      return s;
    }
    return bestSoFar;
  });
  const recommendation: ScenarioComparison['recommendation'] = {
    bestScenario: best.type,
    reasoning: `Scenario "${best.label}" pričakuje ${best.comparison.projectedProfit12m.toFixed(0)}€ v 12 mesecih z ${best.comparison.overallHealth.toFixed(0)}/100 zdravjem. ${best.config.description}.`,
  };

  return {
    ok: true,
    scenarios: [conservative, balanced, aggressive],
    baseCapital: BASE_CAPITAL_EUR,
    custom,
    comparisonTable,
    recommendation,
    source: 'v8.27-scenario-brain',
  };
}
