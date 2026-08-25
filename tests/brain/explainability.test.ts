import { describe, it, expect } from 'vitest';
import { explainMasterBrainActions } from '@/lib/brain/explainability';
import { masterBrain } from '@/lib/brain/master';
import { adjustMasterBrainForRiskProfile, DEFAULT_PROFILE } from '@/lib/brain/risk-profile';

/**
 * v8.34: Explainability test — generates reasoning per Master Brain TOP 5 action.
 *
 * Source: v8.26-explainability. Pure function — no side effects.
 * Each explanation has:
 *   - reasoning (1-3 Slovenian sentences, the primary explainability string)
 *   - reasoningParts (trigger, signalScore, signalGrade, whyRankedHere,
 *     profileImpact, conflictImpact, expectedOutcome)
 *   - trustScore (0-100 per-action)
 */
describe('Explainability', () => {
  it('generates reasoning for all 5 actions', async () => {
    const masterResult = await masterBrain();
    const explanation = explainMasterBrainActions(masterResult);
    expect(explanation.ok).toBe(true);
    expect(explanation.explanations).toHaveLength(5);
    expect(explanation.source).toBe('v8.26-explainability');
  });

  it('each explanation has reasoning + reasoningParts', async () => {
    const masterResult = await masterBrain();
    const explanation = explainMasterBrainActions(masterResult);
    for (const exp of explanation.explanations) {
      expect(exp.reasoning).toBeTruthy();
      expect(exp.reasoning.length).toBeGreaterThan(20);
      expect(exp.reasoningParts.trigger).toBeTruthy();
      expect(exp.reasoningParts.whyRankedHere).toBeTruthy();
      expect(exp.reasoningParts.expectedOutcome).toBeTruthy();
      expect(exp.trustScore).toBeGreaterThanOrEqual(0);
      expect(exp.trustScore).toBeLessThanOrEqual(100);
    }
  });

  it('computes overall trustScore', async () => {
    const masterResult = await masterBrain();
    const explanation = explainMasterBrainActions(masterResult);
    expect(explanation.trustScore).toBeGreaterThanOrEqual(0);
    expect(explanation.trustScore).toBeLessThanOrEqual(100);
    expect(explanation.summaryBlurb).toBeTruthy();
  });

  it('balanced profile produces null profileImpact on each action', async () => {
    const masterResult = await masterBrain();
    const adjustment = adjustMasterBrainForRiskProfile(masterResult, DEFAULT_PROFILE);
    const explanation = explainMasterBrainActions(masterResult, adjustment);
    // Balanced profile → no override → profileImpact should be null
    for (const exp of explanation.explanations) {
      expect(exp.reasoningParts.profileImpact).toBeNull();
    }
  });

  it('conservative profile produces non-null profileImpact on filtered actions', async () => {
    const masterResult = await masterBrain();
    const conservativeProfile = {
      riskTolerance: 'conservative' as const,
      maxAcceptableRisk: 40,
      liquidityReserve: 800,
      investmentHorizon: 'long' as const,
    };
    const adjustment = adjustMasterBrainForRiskProfile(masterResult, conservativeProfile);
    expect(adjustment.adjusted).toBe(true);
    const explanation = explainMasterBrainActions(masterResult, adjustment);
    // At least one explanation should have a non-null profileImpact (either kept
    // under conservative tolerance or filtered out)
    const withImpact = explanation.explanations.filter(
      (e) => e.reasoningParts.profileImpact !== null,
    );
    expect(withImpact.length).toBeGreaterThan(0);
  });

  it('explanations count matches topActions count', async () => {
    const masterResult = await masterBrain({ skipProfit: true });
    const explanation = explainMasterBrainActions(masterResult);
    // With skipProfit, Master Brain returns up to 5 actions from the remaining
    // 6 domains (3 each = 18 candidates → top 5 still returned)
    expect(explanation.explanations.length).toBe(masterResult.topActions.length);
  });
});
