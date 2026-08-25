import { describe, it, expect } from 'vitest';
import {
  computeWeightAdjustment,
  DEFAULT_DOMAIN_WEIGHTS,
  ADAPTIVE_WEIGHTS_CONSTANTS,
} from '@/lib/brain/adaptive-weights';

/**
 * v8.34: Adaptive Weights test — pure weight adjustment logic.
 *
 * Source: v8.28-adaptive-weights. `computeWeightAdjustment(currentWeight,
 * executed, rejected)` is a pure function — no DB, no side effects.
 *
 * Rules:
 *   - executionRate > 0.8 → boost ×1.1
 *   - executionRate < 0.4 → reduce ×0.9
 *   - else → no change
 *   - clamp weight to [0.5, 2.0]
 *
 * NOTE: the function returns { newWeight, reason, adjusted } — it does NOT
 * return executionRate or oldWeight directly. The test uses the input value
 * as the "old weight" reference.
 */
describe('Adaptive Weights', () => {
  it('boosts weight when executionRate > 0.8', () => {
    const oldWeight = 1.0;
    const result = computeWeightAdjustment(oldWeight, 9, 1); // 90% execution rate
    const executionRate = 9 / (9 + 1);
    expect(executionRate).toBeGreaterThan(0.8);
    expect(result.adjusted).toBe(true);
    expect(result.newWeight).toBeGreaterThan(oldWeight);
  });

  it('reduces weight when executionRate < 0.4', () => {
    const oldWeight = 1.0;
    const result = computeWeightAdjustment(oldWeight, 1, 9); // 10% execution rate
    const executionRate = 1 / (1 + 9);
    expect(executionRate).toBeLessThan(0.4);
    expect(result.adjusted).toBe(true);
    expect(result.newWeight).toBeLessThan(oldWeight);
  });

  it('no change when executionRate is 0.4-0.8', () => {
    const oldWeight = 1.0;
    const result = computeWeightAdjustment(oldWeight, 5, 5); // 50% execution rate
    const executionRate = 5 / (5 + 5);
    expect(executionRate).toBeGreaterThanOrEqual(0.4);
    expect(executionRate).toBeLessThanOrEqual(0.8);
    expect(result.adjusted).toBe(false);
    expect(result.newWeight).toBe(oldWeight);
  });

  it('no change when no actions yet (executed=0, rejected=0)', () => {
    const oldWeight = 1.0;
    const result = computeWeightAdjustment(oldWeight, 0, 0);
    expect(result.adjusted).toBe(false);
    expect(result.newWeight).toBe(oldWeight);
    expect(result.reason).toBeTruthy();
  });

  it('clamps weight to [0.5, 2.0] upper bound', () => {
    // Boost from 1.9 (×1.1 = 2.09 → clamped to 2.0)
    const highResult = computeWeightAdjustment(1.9, 10, 0); // 100% execution rate
    expect(highResult.newWeight).toBeLessThanOrEqual(ADAPTIVE_WEIGHTS_CONSTANTS.MAX_WEIGHT);
    expect(highResult.newWeight).toBe(2.0);
  });

  it('clamps weight to [0.5, 2.0] lower bound', () => {
    // Reduce from 0.6 (×0.9 = 0.54 — not yet at min, but reduce further from 0.55)
    const lowResult = computeWeightAdjustment(0.55, 0, 10); // 0% execution rate
    expect(lowResult.newWeight).toBeGreaterThanOrEqual(ADAPTIVE_WEIGHTS_CONSTANTS.MIN_WEIGHT);
  });

  it('reason is always non-empty', () => {
    const r1 = computeWeightAdjustment(1.0, 9, 1);
    const r2 = computeWeightAdjustment(1.0, 1, 9);
    const r3 = computeWeightAdjustment(1.0, 5, 5);
    const r4 = computeWeightAdjustment(1.0, 0, 0);
    expect(r1.reason.length).toBeGreaterThan(0);
    expect(r2.reason.length).toBeGreaterThan(0);
    expect(r3.reason.length).toBeGreaterThan(0);
    expect(r4.reason.length).toBeGreaterThan(0);
  });

  it('DEFAULT_DOMAIN_WEIGHTS has all 7 domains', () => {
    const domains = Object.keys(DEFAULT_DOMAIN_WEIGHTS);
    expect(domains).toHaveLength(7);
    expect(domains).toContain('profit');
    expect(domains).toContain('inventory');
    expect(domains).toContain('market');
    expect(domains).toContain('sourcing');
    expect(domains).toContain('risk');
    expect(domains).toContain('buyer');
    expect(domains).toContain('pricing');
  });

  it('ADAPTIVE_WEIGHTS_CONSTANTS exposes thresholds', () => {
    expect(ADAPTIVE_WEIGHTS_CONSTANTS.MIN_WEIGHT).toBe(0.5);
    expect(ADAPTIVE_WEIGHTS_CONSTANTS.MAX_WEIGHT).toBe(2.0);
    expect(ADAPTIVE_WEIGHTS_CONSTANTS.BOOST_FACTOR).toBe(1.1);
    expect(ADAPTIVE_WEIGHTS_CONSTANTS.REDUCE_FACTOR).toBe(0.9);
    expect(ADAPTIVE_WEIGHTS_CONSTANTS.BOOST_THRESHOLD).toBe(0.8);
    expect(ADAPTIVE_WEIGHTS_CONSTANTS.REDUCE_THRESHOLD).toBe(0.4);
    expect(ADAPTIVE_WEIGHTS_CONSTANTS.ADJUSTMENT_INTERVAL).toBe(10);
  });

  it('risk domain has highest default weight (1.3)', () => {
    expect(DEFAULT_DOMAIN_WEIGHTS.risk).toBe(1.3);
    // All others should be ≤ risk weight
    for (const d of Object.keys(DEFAULT_DOMAIN_WEIGHTS) as Array<keyof typeof DEFAULT_DOMAIN_WEIGHTS>) {
      expect(DEFAULT_DOMAIN_WEIGHTS[d]).toBeLessThanOrEqual(1.3);
    }
  });

  it('buyer domain has lowest default weight (0.9)', () => {
    expect(DEFAULT_DOMAIN_WEIGHTS.buyer).toBe(0.9);
    for (const d of Object.keys(DEFAULT_DOMAIN_WEIGHTS) as Array<keyof typeof DEFAULT_DOMAIN_WEIGHTS>) {
      expect(DEFAULT_DOMAIN_WEIGHTS[d]).toBeGreaterThanOrEqual(0.9);
    }
  });
});
