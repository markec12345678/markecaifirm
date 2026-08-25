// v8.24: User Risk Profile — adjusts Master Brain recommendations based on
// user's personal risk tolerance. Pure deterministic compute — no AI, no DB.
//
// Architectural role: Master Brain (v8.22) gives OBJECTIVE recommendations.
// This module makes them SUBJECTIVE — adapted to the user's risk appetite.
// A conservative user sees different actions than an aggressive user, even
// with the same Master Brain output.
//
// Used by: /api/ai/brain/master endpoint (applies profile adjustment before
// returning the result) and /api/ai/brain/risk-profile endpoint (CRUD).

import type { MasterBrainResult, MasterAction, DomainName } from './master';
import type { ProfitGrade, Confidence } from './profit';

export type RiskTolerance = 'conservative' | 'balanced' | 'aggressive';
export type InvestmentHorizon = 'short' | 'medium' | 'long';

export interface UserRiskProfile {
  riskTolerance: RiskTolerance;
  maxAcceptableRisk: number;      // 0-100
  liquidityReserve: number;        // EUR
  investmentHorizon: InvestmentHorizon;
}

export type RiskFlag = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RiskProfileAdjustment {
  profile: UserRiskProfile;
  adjusted: boolean;                // true if any adjustment was made (false for balanced)
  recommendationOverride: {
    action: 'REDUCE_RISK' | 'ACCEPT_RISK' | 'PROCEED' | 'CAUTIOUS_PROCEED';
    urgency: 'HIGH' | 'MEDIUM' | 'LOW';
    reason: string;
  } | null;
  filteredTopActions: Array<{
    rank: number;
    domain: DomainName;
    signal: string;
    action: string;
    expectedUpliftEUR: number;
    confidence: Confidence;
    riskFlag: RiskFlag;
    kept: boolean;                  // false if filtered out by conservative profile
    filterReason?: string;          // why it was filtered
  }>;
  adjustedRiskBudget: {
    original30d: number;
    adjusted30d: number;
    original90d: number;
    adjusted90d: number;
    adjustmentFactor: number;       // 0.5 for conservative, 1.0 for balanced, 1.5 for aggressive
  };
  profileSummary: string;           // human-readable, e.g. "Konzervativni profil: zmanjšaj tveganje na <60/100, rezerva 500€"
}

export const DEFAULT_PROFILE: UserRiskProfile = {
  riskTolerance: 'balanced',
  maxAcceptableRisk: 50,
  liquidityReserve: 500,
  investmentHorizon: 'medium',
};

// --- Helpers ---------------------------------------------------------------

function clamp(x: number, min: number, max: number): number {
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/**
 * Adjustment factor applied to the "risk budget" (we use overallHealth.score
 * as a proxy because MasterBrainResult.strategy.projection30d has profitEUR
 * but not riskBudget — see the note in the task description).
 *
 *   - conservative: 0.5 (halve the budget)
 *   - balanced:     1.0 (no change)
 *   - aggressive:   1.5 (1.5× the budget)
 */
function adjustmentFactorFor(tolerance: RiskTolerance): number {
  switch (tolerance) {
    case 'conservative':
      return 0.5;
    case 'aggressive':
      return 1.5;
    case 'balanced':
    default:
      return 1.0;
  }
}

/**
 * Derive a risk flag for an action based on its domain + confidence + € uplift.
 *
 * - domain === 'risk' && confidence === 'HIGH'   → 'CRITICAL'
 * - domain === 'risk' && confidence === 'MEDIUM' → 'HIGH'
 * - expectedUpliftEUR > 300 && confidence !== 'HIGH' → 'HIGH' (large impact = higher risk)
 * - expectedUpliftEUR > 100 → 'MEDIUM'
 * - else → 'LOW'
 *
 * Rationale: risk-domain actions are inherently riskier (they signal exposure
 * issues). Large expected uplift that ISN'T backed by HIGH confidence is also
 * risky (could be speculative). Everything else is mostly mechanical.
 */
function deriveRiskFlag(action: MasterAction): RiskFlag {
  if (action.domain === 'risk') {
    if (action.confidence === 'HIGH') return 'CRITICAL';
    if (action.confidence === 'MEDIUM') return 'HIGH';
    // risk + LOW confidence → still elevated
    return 'MEDIUM';
  }
  if (action.expectedUpliftEUR > 300 && action.confidence !== 'HIGH') {
    return 'HIGH';
  }
  if (action.expectedUpliftEUR > 100) {
    return 'MEDIUM';
  }
  return 'LOW';
}

/**
 * Slovenian label for each tolerance — used in profileSummary.
 */
function toleranceLabel(t: RiskTolerance): string {
  switch (t) {
    case 'conservative':
      return 'Konzervativni';
    case 'aggressive':
      return 'Agresivni';
    case 'balanced':
    default:
      return 'Uravnoteženi';
  }
}

/**
 * Slovenian label for each horizon — used in profileSummary.
 */
function horizonLabel(h: InvestmentHorizon): string {
  switch (h) {
    case 'short':
      return 'kratka (<3m)';
    case 'long':
      return 'dolga (>12m)';
    case 'medium':
    default:
      return 'srednja (3-12m)';
  }
}

/**
 * Adjust Master Brain result based on user's risk profile.
 * Pure function — does not modify the input.
 *
 * Behavior:
 *
 * recommendationOverride:
 *   - conservative + overallHealth < 70 → REDUCE_RISK, HIGH urgency
 *   - conservative + overallHealth >= 70 → CAUTIOUS_PROCEED, MEDIUM urgency
 *   - aggressive + overallHealth > 40 → ACCEPT_RISK, LOW urgency
 *   - aggressive + overallHealth <= 40 → CAUTIOUS_PROCEED, HIGH urgency
 *   - balanced → null (no override)
 *
 * filteredTopActions:
 *   - For each action in masterResult.topActions, derive a riskFlag.
 *   - conservative: filter out (kept: false) actions where riskFlag is HIGH
 *     or CRITICAL — those exceed the conservative user's maxAcceptableRisk.
 *     Also filter any action whose riskFlag value (mapped LOW=25, MEDIUM=50,
 *     HIGH=75, CRITICAL=100) exceeds profile.maxAcceptableRisk.
 *   - aggressive: keep all (kept: true)
 *   - balanced: keep all (kept: true)
 *
 * adjustedRiskBudget:
 *   - original30d = masterResult.overallHealth.score (used as proxy for
 *     "risk budget" — see module docstring).
 *   - adjusted30d = original30d × adjustmentFactor
 *   - same for 90d (masterResult.overallHealth.score for 90d proxy — same
 *     value, since MasterBrain doesn't expose a 90d-specific health score)
 *
 * profileSummary:
 *   - Slovenian, e.g. "Konzervativni profil: zmanjšaj tveganje na <60/100,
 *     rezerva 500€, horizont srednja (3-12m). Priporočilo: REDUCE_RISK (HIGH)."
 */
export function adjustMasterBrainForRiskProfile(
  masterResult: MasterBrainResult,
  profile: UserRiskProfile = DEFAULT_PROFILE,
): RiskProfileAdjustment {
  const overallHealth = masterResult.overallHealth.score;
  const tolerance = profile.riskTolerance;

  // 1. recommendationOverride logic
  let recommendationOverride: RiskProfileAdjustment['recommendationOverride'] = null;

  if (tolerance === 'conservative') {
    if (overallHealth < 70) {
      recommendationOverride = {
        action: 'REDUCE_RISK',
        urgency: 'HIGH',
        reason: `Konzervativni profil + overallHealth ${round2(overallHealth)}/100 < 70 — zmanjšaj tveganje (filter HIGH/CRITICAL akcij, zmanjšaj risk budget za 50%).`,
      };
    } else {
      recommendationOverride = {
        action: 'CAUTIOUS_PROCEED',
        urgency: 'MEDIUM',
        reason: `Konzervativni profil + overallHealth ${round2(overallHealth)}/100 ≥ 70 — nadaljuj previdno, vendar še vedno filtriraj HIGH-risk akcije.`,
      };
    }
  } else if (tolerance === 'aggressive') {
    if (overallHealth > 40) {
      recommendationOverride = {
        action: 'ACCEPT_RISK',
        urgency: 'LOW',
        reason: `Agresivni profil + overallHealth ${round2(overallHealth)}/100 > 40 — prevzemi tveganje, dovoli HIGH-risk akcije, povečaj risk budget za 50%.`,
      };
    } else {
      recommendationOverride = {
        action: 'CAUTIOUS_PROCEED',
        urgency: 'HIGH',
        reason: `Agresivni profil + overallHealth ${round2(overallHealth)}/100 ≤ 40 — sistem je preveč nestabilen za agresivno strategijo, upočasni.`,
      };
    }
  }
  // balanced → null (no override)

  // 2. filteredTopActions
  // Map riskFlag to a numeric severity (LOW=25, MEDIUM=50, HIGH=75, CRITICAL=100)
  // for comparison against profile.maxAcceptableRisk.
  const flagSeverity: Record<RiskFlag, number> = {
    LOW: 25,
    MEDIUM: 50,
    HIGH: 75,
    CRITICAL: 100,
  };

  const filteredTopActions = masterResult.topActions.map((a) => {
    const riskFlag = deriveRiskFlag(a);
    const severity = flagSeverity[riskFlag];

    if (tolerance === 'conservative') {
      // Conservative: filter HIGH and CRITICAL actions (always),
      // AND filter any action whose severity exceeds profile.maxAcceptableRisk.
      const exceedsMax = severity > profile.maxAcceptableRisk;
      const highOrCritical = riskFlag === 'HIGH' || riskFlag === 'CRITICAL';
      if (highOrCritical || exceedsMax) {
        return {
          rank: a.rank,
          domain: a.domain,
          signal: a.signal,
          action: a.action,
          expectedUpliftEUR: round2(a.expectedUpliftEUR),
          confidence: a.confidence,
          riskFlag,
          kept: false,
          filterReason: `presega maxAcceptableRisk (${profile.maxAcceptableRisk}/100) za conservative profil (riskFlag=${riskFlag})`,
        };
      }
    }
    // aggressive + balanced: keep all
    return {
      rank: a.rank,
      domain: a.domain,
      signal: a.signal,
      action: a.action,
      expectedUpliftEUR: round2(a.expectedUpliftEUR),
      confidence: a.confidence,
      riskFlag,
      kept: true,
    };
  });

  // 3. adjustedRiskBudget
  const adjustmentFactor = adjustmentFactorFor(tolerance);
  // Per task: use overallHealth.score as proxy (masterResult.strategy.projection30d
  // has profitEUR, not riskBudget).
  const original30d = clamp(overallHealth, 0, 100);
  const original90d = clamp(overallHealth, 0, 100);
  const adjusted30d = clamp(round2(original30d * adjustmentFactor), 0, 100);
  const adjusted90d = clamp(round2(original90d * adjustmentFactor), 0, 100);

  // 4. profileSummary
  const recText = recommendationOverride
    ? `Priporočilo: ${recommendationOverride.action} (${recommendationOverride.urgency}).`
    : 'Priporočilo: po Master Brain-u (brez override).';
  const profileSummary =
    `${toleranceLabel(tolerance)} profil: maxAcceptableRisk=${profile.maxAcceptableRisk}/100, ` +
    `rezerva=${profile.liquidityReserve}€, horizont=${horizonLabel(profile.investmentHorizon)}. ` +
    `${recText} ` +
    `Risk budget: ${round2(original30d)} → ${adjusted30d} (×${adjustmentFactor}).`;

  const adjusted = tolerance !== 'balanced';

  return {
    profile,
    adjusted,
    recommendationOverride,
    filteredTopActions,
    adjustedRiskBudget: {
      original30d: round2(original30d),
      adjusted30d,
      original90d: round2(original90d),
      adjusted90d,
      adjustmentFactor,
    },
    profileSummary,
  };
}

/**
 * Validate a UserRiskProfile — returns { valid: boolean, errors: string[] }.
 *
 * Used by the POST /api/ai/brain/risk-profile handler before writing to DB.
 */
export function validateProfile(
  profile: Partial<UserRiskProfile>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (
    profile.riskTolerance &&
    !['conservative', 'balanced', 'aggressive'].includes(profile.riskTolerance)
  ) {
    errors.push('riskTolerance must be conservative | balanced | aggressive');
  }
  if (profile.maxAcceptableRisk !== undefined) {
    if (
      typeof profile.maxAcceptableRisk !== 'number' ||
      profile.maxAcceptableRisk < 0 ||
      profile.maxAcceptableRisk > 100
    ) {
      errors.push('maxAcceptableRisk must be 0-100');
    }
  }
  if (profile.liquidityReserve !== undefined) {
    if (
      typeof profile.liquidityReserve !== 'number' ||
      profile.liquidityReserve < 0
    ) {
      errors.push('liquidityReserve must be >= 0');
    }
  }
  if (
    profile.investmentHorizon &&
    !['short', 'medium', 'long'].includes(profile.investmentHorizon)
  ) {
    errors.push('investmentHorizon must be short | medium | long');
  }
  return { valid: errors.length === 0, errors };
}
