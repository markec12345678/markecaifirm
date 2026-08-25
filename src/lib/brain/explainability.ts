// v8.26: Action Explainability — generates human-readable reasoning for each
// Master Brain TOP 5 action. Answers "Zakaj Master Brain priporoča TOČNO to akcijo?"
//
// Pure deterministic compute — no AI, no DB, no side effects. Takes a
// MasterBrainResult (already computed by masterBrain()) + optional
// RiskProfileAdjustment (from v8.24) and generates reasoning strings.
//
// Architectural role:
//   - Master Brain (v8.22) gives WHAT to do (TOP 5 ranked actions).
//   - Risk Profile (v8.24) makes it PERSONAL (filters/overrides for the user).
//   - Explainability (v8.26) gives WHY — the reasoning behind each action.
//   Together they answer "Kaj naj naredim danes in zakaj?"
//
// Why this matters (the v8.26 motivation):
//   A black-box "Prodaj iPhone 13 zdaj" recommendation is not actionable.
//   The user needs to see:
//     - WHICH signal triggered it (signal name + score + grade)
//     - WHY it's at THIS rank (finalScore decomposition)
//     - HOW their personal risk profile affected it (kept/filtered)
//     - WHETHER any conflicts touched this action's domain
//     - WHAT happens if they execute (expected uplift + confidence)
//     - HOW TRUSTWORTHY this recommendation is overall (trustScore 0-100)
//   Without explainability, users ignore recommendations. With it, they trust.
//
// Determinism:
//   Given the same MasterBrainResult, this function produces the exact same
//   explanation strings. No randomness, no AI calls, no I/O.
//
// Caching:
//   The caller (route handler) sets a 10-min cache — same TTL as Master Brain
//   itself, because explanations are PURELY derived from the master result.
//   Re-running explainability is cheap, but the masterBrain() call that feeds
//   it is expensive (orchestrates 7 Domain Brains).

import type { MasterBrainResult, MasterAction, DomainName, Conflict } from './master';
import type { ProfitGrade, Confidence } from './profit';
import type { RiskProfileAdjustment } from './risk-profile';

// --- Types ----------------------------------------------------------------

export interface ActionExplanation {
  rank: number;
  domain: DomainName;
  signal: string;
  action: string;
  expectedUpliftEUR: number;
  confidence: Confidence;
  finalScore: number;

  // NEW v8.26 fields:
  /** Human-readable, Slovenian, 1-3 sentences. The primary explainability string. */
  reasoning: string;
  /** Structured breakdown — the WHY behind the reasoning. */
  reasoningParts: {
    /** What signal/domain triggered this — e.g. "profit Brain signal 'growth' (B, 67/100) sproži to priporočilo" */
    trigger: string;
    /** The signal's 0-100 score (looked up in the domain's signals array). */
    signalScore: number;
    /** The signal's grade (looked up in the domain's signals array). */
    signalGrade: ProfitGrade;
    /** Why this action is at this rank — finalScore decomposition. */
    whyRankedHere: string;
    /** How user's risk profile affected this (null if balanced or no profile). */
    profileImpact: string | null;
    /** How conflicts affected this (null if no conflicts touch this domain). */
    conflictImpact: string | null;
    /** What will happen if user executes — expected uplift + confidence. */
    expectedOutcome: string;
  };
  /** 0-100 — how confident we are in this recommendation overall. */
  trustScore: number;
}

export interface MasterBrainExplanation {
  ok: true;
  /** 5 explanations, one per TOP action (or fewer if fewer actions). */
  explanations: ActionExplanation[];
  /** 1-paragraph overall summary, Slovenian. */
  summaryBlurb: string;
  /** 0-100 overall trust score (weighted avg of action trustScores, weighted by finalScore). */
  trustScore: number;
  source: 'v8.26-explainability';
  cachedAt?: number;
}

// --- Helpers --------------------------------------------------------------

function clamp(x: number, min: number, max: number): number {
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/**
 * Confidence → numeric trustScore component.
 * HIGH=100, MEDIUM=65, LOW=30.
 */
function confidenceToTrustScore(c: Confidence): number {
  switch (c) {
    case 'HIGH':
      return 100;
    case 'MEDIUM':
      return 65;
    case 'LOW':
      return 30;
    default:
      return 30;
  }
}

/**
 * Normalize a domainWeight (0.9 to 1.3) to a 0-100 scale.
 * 1.3 → 100, 0.9 → 0. Linear interpolation between.
 */
function normalizeDomainWeight(weight: number): number {
  // DOMAIN_WEIGHTS range: 0.9 (buyer) to 1.3 (risk)
  // Linear map: (weight - 0.9) / (1.3 - 0.9) × 100
  if (!Number.isFinite(weight)) return 50;
  return clamp(((weight - 0.9) / (1.3 - 0.9)) * 100, 0, 100);
}

/**
 * Slovenian label for each domain (used in trigger strings).
 */
function domainLabelSlo(d: DomainName): string {
  switch (d) {
    case 'profit':
      return 'Profit';
    case 'inventory':
      return 'Inventar';
    case 'market':
      return 'Trg';
    case 'sourcing':
      return 'Sourcing';
    case 'risk':
      return 'Tveganje';
    case 'buyer':
      return 'Kupci';
    case 'pricing':
      return 'Cene';
    default:
      return d;
  }
}

/**
 * Slovenian label for confidence.
 */
function confidenceLabelSlo(c: Confidence): string {
  switch (c) {
    case 'HIGH':
      return 'VISOKA';
    case 'MEDIUM':
      return 'SREDNJA';
    case 'LOW':
      return 'NIZKA';
    default:
      return c;
  }
}

// --- Signal score/grade lookup -------------------------------------------

/**
 * A unified shape for any domain's signal — regardless of which brain.
 * All 7 Domain Brains share the same {name, score, grade} shape.
 */
interface DomainSignalLite {
  name: string;
  score: number;
  grade: ProfitGrade;
}

/**
 * Extract the signals array from a domain's raw brain result. Each domain
 * brain stores its signals at the top level of its result object — they all
 * share the same shape: `signals: Array<{ name, score, grade, ... }>`.
 *
 * Returns an empty array if the domain was skipped or has no signals.
 */
function extractDomainSignals(
  masterResult: MasterBrainResult,
  domain: DomainName,
): DomainSignalLite[] {
  const dr = masterResult.domains[domain];
  if (!dr) return [];
  // Every Domain Brain result has a `signals` field with at least {name, score, grade}.
  const signals = (dr as { signals?: DomainSignalLite[] }).signals;
  if (!Array.isArray(signals)) return [];
  return signals.map((s) => ({
    name: String(s.name ?? ''),
    score: typeof s.score === 'number' ? s.score : 50,
    grade: (s.grade ?? 'C') as ProfitGrade,
  }));
}

/**
 * Lookup the score + grade for a given signal name within a domain.
 * Falls back to { score: 50, grade: 'C' } if not found.
 */
function lookupSignalScoreGrade(
  masterResult: MasterBrainResult,
  domain: DomainName,
  signalName: string,
): { score: number; grade: ProfitGrade } {
  const signals = extractDomainSignals(masterResult, domain);
  const match = signals.find((s) => s.name === signalName);
  if (match) {
    return { score: match.score, grade: match.grade };
  }
  // Fallback — when signal not found (shouldn't happen, but defensive).
  return { score: 50, grade: 'C' };
}

// --- Conflict matching ----------------------------------------------------

/**
 * Check if a conflict mentions the given domain (either as domainA or domainB).
 */
function conflictTouchesDomain(conflict: Conflict, domain: DomainName): boolean {
  return conflict.domainA === domain || conflict.domainB === domain;
}

// --- Risk Profile matching ------------------------------------------------

/**
 * Find the RiskProfileAdjustment's filteredTopActions entry that corresponds
 * to the given MasterAction (matched by rank). Returns null if no profile
 * adjustment is provided or no matching entry exists.
 */
function findProfileEntry(
  profileAdjustment: RiskProfileAdjustment | null | undefined,
  action: MasterAction,
): RiskProfileAdjustment['filteredTopActions'][number] | null {
  if (!profileAdjustment) return null;
  const match = profileAdjustment.filteredTopActions.find(
    (f) => f.rank === action.rank && f.domain === action.domain && f.signal === action.signal,
  );
  return match ?? null;
}

// --- Main explainability function ----------------------------------------

/**
 * Generate explanations for all TOP 5 actions in a Master Brain result.
 * Pure function — no side effects, no I/O, no AI calls.
 *
 * For each action:
 *   1. Look up the signal's score + grade in the corresponding domain's
 *      signals array (e.g. for action.domain='profit' & action.signal='growth',
 *      find profit.signals.find(s => s.name === 'growth')).
 *   2. Build reasoningParts: trigger, whyRankedHere, profileImpact,
 *      conflictImpact, expectedOutcome.
 *   3. Build reasoning (1-3 Slovenian sentences) by composing the parts.
 *   4. Compute trustScore (0-100) per the formula:
 *        trustScore = clamp(
 *          signalScore × 0.4
 *          + confidenceScore × 0.3
 *          + domainWeightScore × 0.15
 *          - conflictPenalty × 0.15,
 *          0, 100
 *        )
 *      where:
 *        - confidenceScore: HIGH=100, MEDIUM=65, LOW=30
 *        - domainWeightScore: linear normalization (1.3→100, 0.9→0)
 *        - conflictPenalty: 20 if a conflict mentions this domain, else 0
 *
 * Then compute the overall summaryBlurb (1 paragraph Slovenian) and the
 * overall trustScore (weighted avg of action trustScores, weighted by
 * finalScore).
 */
export function explainMasterBrainActions(
  masterResult: MasterBrainResult,
  profileAdjustment: RiskProfileAdjustment | null | undefined = null,
): MasterBrainExplanation {
  const topActions = masterResult.topActions ?? [];

  // Build per-action explanations
  const explanations: ActionExplanation[] = topActions.map((action) => {
    // 1. Lookup signal score + grade from the domain's signals array
    const { score: signalScore, grade: signalGrade } = lookupSignalScoreGrade(
      masterResult,
      action.domain,
      action.signal,
    );

    // 2. Build reasoningParts
    const domainLabel = domainLabelSlo(action.domain);
    const trigger =
      `${domainLabel} Brain signal '${action.signal}' (${signalGrade}, ${Math.round(signalScore)}/100) ` +
      `sproži to priporočilo`;

    const whyRankedHere =
      `Uvrščena na #${action.rank} ker finalScore=${action.finalScore} ` +
      `(uplift ${round2(action.expectedUpliftEUR)}€ × confidence ${action.confidence} ` +
      `× domainWeight ${action.domainWeight})`;

    // profileImpact
    let profileImpact: string | null = null;
    if (profileAdjustment && profileAdjustment.adjusted) {
      const entry = findProfileEntry(profileAdjustment, action);
      if (entry) {
        // kept=true or false
        const tolerance = profileAdjustment.profile.riskTolerance;
        if (entry.kept) {
          if (tolerance === 'conservative') {
            profileImpact =
              `Tvoj conservative profil obdrži to akcijo ker je ${entry.riskFlag} risk ` +
              `(znotraj maxAcceptableRisk ${profileAdjustment.profile.maxAcceptableRisk}/100)`;
          } else if (tolerance === 'aggressive') {
            profileImpact =
              `Tvoj aggressive profil dovoljuje to akcijo (riskFlag=${entry.riskFlag}) ` +
              `— risk budget povečan za ${(profileAdjustment.adjustedRiskBudget.adjustmentFactor * 100 - 100).toFixed(0)}%`;
          } else {
            profileImpact = null; // balanced → no special impact
          }
        } else {
          // kept=false → action was filtered out by conservative profile.
          // Spec: this shouldn't appear in topActions (the action list itself isn't filtered,
          // only the adjustment's filteredTopActions keeps the entry for visibility). We mark
          // the impact so the user sees WHY their profile removed it.
          profileImpact =
            `Tvoj ${tolerance} profil je FILTRIRAL to akcijo (${entry.filterReason ?? 'presega tvojo toleranco'}) ` +
            `— prikazana je še vedno, vendar je za tvoj profil ni priporočljivo izvesti`;
        }
      }
    }

    // conflictImpact
    let conflictImpact: string | null = null;
    const touchingConflicts = (masterResult.conflicts ?? []).filter(
      (c) => conflictTouchesDomain(c, action.domain),
    );
    if (touchingConflicts.length > 0) {
      // Build a brief summary of the touching conflicts
      const c = touchingConflicts[0];
      const otherDomain = c.domainA === action.domain ? c.domainB : c.domainA;
      conflictImpact =
        `Konflikt ${domainLabelSlo(otherDomain)} vs ${domainLabelSlo(action.domain)} ` +
        `(${c.severity}) vpliva na to domeno — preveri resolucijo: ${c.resolution}`;
    }

    // expectedOutcome
    const expectedOutcome =
      `Če izvedeš: +${round2(action.expectedUpliftEUR)}€/mo pričakovanega profita ` +
      `(confidence: ${confidenceLabelSlo(action.confidence)})`;

    // 3. Build reasoning (1-3 Slovenian sentences)
    //   "${trigger}. ${whyRankedHere}. ${profileImpact || conflictImpact || expectedOutcome}"
    const tertiary = profileImpact ?? conflictImpact ?? expectedOutcome;
    const reasoning = `${trigger}. ${whyRankedHere}. ${tertiary}`;

    // 4. Compute trustScore
    const confidenceScore = confidenceToTrustScore(action.confidence);
    const domainWeightScore = normalizeDomainWeight(action.domainWeight);
    const conflictPenalty = touchingConflicts.length > 0 ? 20 : 0;
    const trustScore = clamp(
      round2(
        signalScore * 0.4 +
          confidenceScore * 0.3 +
          domainWeightScore * 0.15 -
          conflictPenalty * 0.15,
      ),
      0,
      100,
    );

    return {
      rank: action.rank,
      domain: action.domain,
      signal: action.signal,
      action: action.action,
      expectedUpliftEUR: round2(action.expectedUpliftEUR),
      confidence: action.confidence,
      finalScore: round2(action.finalScore),
      reasoning,
      reasoningParts: {
        trigger,
        signalScore: round2(signalScore),
        signalGrade,
        whyRankedHere,
        profileImpact,
        conflictImpact,
        expectedOutcome,
      },
      trustScore,
    };
  });

  // Compute overall trustScore: weighted avg of action trustScores,
  // weighted by finalScore (so higher-ranked actions count more).
  let overallTrustScore = 0;
  if (explanations.length > 0) {
    let weightSum = 0;
    let weightedSum = 0;
    for (const e of explanations) {
      // Use finalScore as weight (default to 1 if 0, so we don't ignore zero-uplift actions)
      const w = e.finalScore > 0 ? e.finalScore : 1;
      weightedSum += e.trustScore * w;
      weightSum += w;
    }
    overallTrustScore = weightSum > 0 ? clamp(round2(weightedSum / weightSum), 0, 100) : 0;
  }

  // Build summaryBlurb
  const sumUplift = explanations.reduce(
    (acc, e) => acc + e.expectedUpliftEUR,
    0,
  );
  const sumUpliftRounded = Math.round(sumUplift);

  // Best trust action = highest trustScore
  let bestTrustAction: ActionExplanation | null = null;
  for (const e of explanations) {
    if (!bestTrustAction || e.trustScore > bestTrustAction.trustScore) {
      bestTrustAction = e;
    }
  }

  // profileNote: only if profileAdjustment.adjusted (not balanced)
  let profileNote = '';
  if (profileAdjustment && profileAdjustment.adjusted) {
    const tolerance = profileAdjustment.profile.riskTolerance;
    profileNote = `Tvoj ${tolerance} profil je upoštevan. `;
  }

  // conflictNote
  const conflictCount = masterResult.conflicts?.length ?? 0;
  const conflictNote =
    conflictCount > 0
      ? `${conflictCount} konflikt${conflictCount === 1 ? '' : 'ov'} zaznanih — preveri resolucije.`
      : '';

  const summaryBlurb =
    `Master Brain priporoča ${explanations.length} akcij za danes. ` +
    (bestTrustAction
      ? `Najvišji trust: #${bestTrustAction.rank} (${bestTrustAction.trustScore}/100). `
      : '') +
    `Skupni pričakovan uplift: ${sumUpliftRounded}€/mo. ` +
    profileNote +
    conflictNote;

  return {
    ok: true,
    explanations,
    summaryBlurb,
    trustScore: overallTrustScore,
    source: 'v8.26-explainability',
  };
}
