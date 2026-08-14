import { describe, it, expect } from 'vitest';
import {
  adjustMasterBrainForRiskProfile,
  DEFAULT_PROFILE,
  validateProfile,
} from '@/lib/brain/risk-profile';
import { masterBrain } from '@/lib/brain/master';

/**
 * v8.34: Risk Profile test — adjusts Master Brain recommendations based on
 * user's personal risk tolerance.
 *
 * Source: v8.24-risk-profile. Pure functions — no side effects.
 *
 * Behavior:
 *   - balanced profile → no adjustment (adjusted: false, override: null)
 *   - conservative + health < 70 → REDUCE_RISK
 *   - aggressive + health > 40 → ACCEPT_RISK
 *   - validateProfile accepts/rejects partial profiles
 */
describe('Risk Profile', () => {
  it('balanced profile makes no adjustment', async () => {
    const masterResult = await masterBrain();
    const adjustment = adjustMasterBrainForRiskProfile(masterResult, DEFAULT_PROFILE);
    expect(adjustment.adjusted).toBe(false);
    expect(adjustment.recommendationOverride).toBeNull();
  });

  it('conservative profile triggers REDUCE_RISK when health < 70', async () => {
    const masterResult = await masterBrain();
    const conservativeProfile = {
      riskTolerance: 'conservative' as const,
      maxAcceptableRisk: 40,
      liquidityReserve: 800,
      investmentHorizon: 'long' as const,
    };
    const adjustment = adjustMasterBrainForRiskProfile(masterResult, conservativeProfile);
    expect(adjustment.adjusted).toBe(true);
    // Conservative profile always has an override — REDUCE_RISK if health<70,
    // CAUTIOUS_PROCEED otherwise.
    expect(adjustment.recommendationOverride).not.toBeNull();
    if (masterResult.overallHealth.score < 70) {
      expect(adjustment.recommendationOverride!.action).toBe('REDUCE_RISK');
    }
  });

  it('aggressive profile triggers ACCEPT_RISK when health > 40', async () => {
    const masterResult = await masterBrain();
    const aggressiveProfile = {
      riskTolerance: 'aggressive' as const,
      maxAcceptableRisk: 60,
      liquidityReserve: 200,
      investmentHorizon: 'short' as const,
    };
    const adjustment = adjustMasterBrainForRiskProfile(masterResult, aggressiveProfile);
    expect(adjustment.adjusted).toBe(true);
    expect(adjustment.recommendationOverride).not.toBeNull();
    if (masterResult.overallHealth.score > 40) {
      expect(adjustment.recommendationOverride!.action).toBe('ACCEPT_RISK');
    }
  });

  it('conservative profile adjusts risk budget by 0.5x', async () => {
    const masterResult = await masterBrain();
    const conservativeProfile = {
      riskTolerance: 'conservative' as const,
      maxAcceptableRisk: 40,
      liquidityReserve: 800,
      investmentHorizon: 'long' as const,
    };
    const adjustment = adjustMasterBrainForRiskProfile(masterResult, conservativeProfile);
    expect(adjustment.adjustedRiskBudget.adjustmentFactor).toBe(0.5);
    expect(adjustment.adjustedRiskBudget.adjusted30d).toBeLessThanOrEqual(
      adjustment.adjustedRiskBudget.original30d,
    );
  });

  it('aggressive profile adjusts risk budget by 1.5x', async () => {
    const masterResult = await masterBrain();
    const aggressiveProfile = {
      riskTolerance: 'aggressive' as const,
      maxAcceptableRisk: 60,
      liquidityReserve: 200,
      investmentHorizon: 'short' as const,
    };
    const adjustment = adjustMasterBrainForRiskProfile(masterResult, aggressiveProfile);
    expect(adjustment.adjustedRiskBudget.adjustmentFactor).toBe(1.5);
    expect(adjustment.adjustedRiskBudget.adjusted30d).toBeGreaterThanOrEqual(
      adjustment.adjustedRiskBudget.original30d,
    );
  });

  it('validateProfile accepts valid profiles', () => {
    const result = validateProfile({
      riskTolerance: 'conservative',
      maxAcceptableRisk: 40,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validateProfile rejects invalid profiles', () => {
    const result = validateProfile({
      riskTolerance: 'invalid' as any,
      maxAcceptableRisk: 150,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('validateProfile rejects negative liquidityReserve', () => {
    const result = validateProfile({
      liquidityReserve: -100,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('validateProfile rejects invalid investmentHorizon', () => {
    const result = validateProfile({
      investmentHorizon: 'never' as any,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('DEFAULT_PROFILE is balanced', () => {
    expect(DEFAULT_PROFILE.riskTolerance).toBe('balanced');
    expect(DEFAULT_PROFILE.maxAcceptableRisk).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_PROFILE.maxAcceptableRisk).toBeLessThanOrEqual(100);
  });
});
