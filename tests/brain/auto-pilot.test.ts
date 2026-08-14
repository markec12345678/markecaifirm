import { describe, it, expect } from 'vitest';
import {
  checkAutoPilotEligibility,
  checkAutoPilotEligibilityV2,
  DEFAULT_AUTOPILOT_CONFIG,
  AGGRESSIVE_CONFIG,
} from '@/lib/brain/auto-pilot';
import type { ActionDraft } from '@/lib/brain/draft-queue';

/**
 * Helper: create a mock ActionDraft with sensible defaults.
 *
 * `ActionDraft` is the v8.29 draft queue shape (id, rank, domain, signal,
 * action, expectedUpliftEUR, confidence, status, etc.). The auto-pilot
 * eligibility check takes a draft + config + risk tolerance + counters.
 */
function makeDraft(overrides: Partial<ActionDraft> = {}): ActionDraft {
  return {
    id: 'test-1',
    rank: 1,
    domain: 'profit',
    signal: 'growth',
    action: 'Test action',
    expectedUpliftEUR: 50,
    confidence: 'LOW',
    status: 'pending',
    feedbackNote: null,
    executedAt: null,
    rejectedAt: null,
    snapshotDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * v8.34: Auto-pilot eligibility test — 8 safety rules enforced by
 * `checkAutoPilotEligibility` (V1, safe mode only) and the V2 mode-aware
 * variant `checkAutoPilotEligibilityV2` (supports aggressive mode).
 *
 * Source: v8.30-safe-auto-pilot (V1) + v8.31-aggressive (V2).
 *
 * V1 rules (all must be PASS for canAutoExecute=true):
 *   1. auto-pilot enabled
 *   2. mode === 'safe'
 *   3. user risk tolerance !== 'conservative'
 *   4. confidence === 'LOW' (only LOW in V1)
 *   5. expectedUpliftEUR < 100
 *   6. domain !== 'risk'
 *   7. daily count < dailyLimit
 *   8. daily budget not exceeded
 *
 * V2 supports mode='aggressive': allows MEDIUM confidence + uplift <300 + 10/day.
 */
describe('Auto-pilot Eligibility (V1 — safe mode)', () => {
  it('fails when auto-pilot disabled', () => {
    const draft = makeDraft();
    const config = { ...DEFAULT_AUTOPILOT_CONFIG, enabled: false };
    const result = checkAutoPilotEligibility(draft, config, 'balanced', 0, 0);
    expect(result.canAutoExecute).toBe(false);
  });

  it('fails for conservative user', () => {
    const draft = makeDraft();
    const config = { ...DEFAULT_AUTOPILOT_CONFIG, enabled: true };
    const result = checkAutoPilotEligibility(draft, config, 'conservative', 0, 0);
    expect(result.canAutoExecute).toBe(false);
  });

  it('fails for HIGH confidence', () => {
    const draft = makeDraft({ confidence: 'HIGH' });
    const config = { ...DEFAULT_AUTOPILOT_CONFIG, enabled: true };
    const result = checkAutoPilotEligibility(draft, config, 'balanced', 0, 0);
    expect(result.canAutoExecute).toBe(false);
  });

  it('fails for uplift >= 100€ in safe mode', () => {
    const draft = makeDraft({ expectedUpliftEUR: 150 });
    const config = { ...DEFAULT_AUTOPILOT_CONFIG, enabled: true };
    const result = checkAutoPilotEligibility(draft, config, 'balanced', 0, 0);
    expect(result.canAutoExecute).toBe(false);
  });

  it('fails for domain=risk', () => {
    const draft = makeDraft({ domain: 'risk' });
    const config = { ...DEFAULT_AUTOPILOT_CONFIG, enabled: true };
    const result = checkAutoPilotEligibility(draft, config, 'balanced', 0, 0);
    expect(result.canAutoExecute).toBe(false);
  });

  it('fails when daily limit reached', () => {
    const draft = makeDraft();
    const config = { ...DEFAULT_AUTOPILOT_CONFIG, enabled: true, dailyLimit: 5 };
    const result = checkAutoPilotEligibility(draft, config, 'balanced', 5, 0);
    expect(result.canAutoExecute).toBe(false);
  });

  it('fails when daily budget would be exceeded', () => {
    const draft = makeDraft({ expectedUpliftEUR: 60 });
    const config = { ...DEFAULT_AUTOPILOT_CONFIG, enabled: true, dailyBudgetEUR: 100 };
    // Already used 50€ + draft 60€ = 110€ > 100€ budget
    const result = checkAutoPilotEligibility(draft, config, 'balanced', 0, 50);
    expect(result.canAutoExecute).toBe(false);
  });

  it('passes all rules for eligible draft', () => {
    const draft = makeDraft({ confidence: 'LOW', expectedUpliftEUR: 50, domain: 'profit' });
    const config = { ...DEFAULT_AUTOPILOT_CONFIG, enabled: true, mode: 'safe' as const };
    const result = checkAutoPilotEligibility(draft, config, 'balanced', 0, 0);
    expect(result.canAutoExecute).toBe(true);
    // V1 always returns 8 reasons (one per rule)
    expect(result.reasons.length).toBeGreaterThan(0);
    // All should start with PASS:
    for (const reason of result.reasons) {
      expect(reason.startsWith('PASS:')).toBe(true);
    }
  });
});

describe('Auto-pilot Eligibility (V2 — aggressive mode)', () => {
  it('aggressive mode allows MEDIUM confidence', () => {
    const draft = makeDraft({ confidence: 'MEDIUM', expectedUpliftEUR: 200 });
    const config = { ...DEFAULT_AUTOPILOT_CONFIG, enabled: true, mode: 'aggressive' as const };
    const result = checkAutoPilotEligibilityV2(draft, config, 'balanced', 0, 0);
    // MEDIUM is allowed in aggressive (uplift 200 < 300 aggressive threshold)
    expect(result.canAutoExecute).toBe(true);
  });

  it('aggressive mode still rejects HIGH confidence', () => {
    const draft = makeDraft({ confidence: 'HIGH', expectedUpliftEUR: 50 });
    const config = { ...DEFAULT_AUTOPILOT_CONFIG, enabled: true, mode: 'aggressive' as const };
    const result = checkAutoPilotEligibilityV2(draft, config, 'balanced', 0, 0);
    // HIGH is ALWAYS excluded (manual execution only — both modes)
    expect(result.canAutoExecute).toBe(false);
  });

  it('aggressive mode rejects uplift >= 300€', () => {
    const draft = makeDraft({ confidence: 'MEDIUM', expectedUpliftEUR: 350 });
    const config = { ...DEFAULT_AUTOPILOT_CONFIG, enabled: true, mode: 'aggressive' as const };
    const result = checkAutoPilotEligibilityV2(draft, config, 'balanced', 0, 0);
    expect(result.canAutoExecute).toBe(false);
  });

  it('aggressive mode allows daily limit up to 10', () => {
    const draft = makeDraft({ confidence: 'MEDIUM', expectedUpliftEUR: 100 });
    const config = { ...DEFAULT_AUTOPILOT_CONFIG, enabled: true, mode: 'aggressive' as const };
    const result = checkAutoPilotEligibilityV2(draft, config, 'balanced', 9, 0);
    // 9 today, limit 10 — still under limit
    expect(result.canAutoExecute).toBe(true);
  });

  it('aggressive mode still rejects domain=risk (both modes)', () => {
    const draft = makeDraft({ confidence: 'MEDIUM', domain: 'risk', expectedUpliftEUR: 50 });
    const config = { ...DEFAULT_AUTOPILOT_CONFIG, enabled: true, mode: 'aggressive' as const };
    const result = checkAutoPilotEligibilityV2(draft, config, 'balanced', 0, 0);
    expect(result.canAutoExecute).toBe(false);
  });

  it('V2 returns exactly 8 audit reasons', () => {
    const draft = makeDraft({ confidence: 'LOW', expectedUpliftEUR: 50, domain: 'profit' });
    const config = { ...DEFAULT_AUTOPILOT_CONFIG, enabled: true, mode: 'safe' as const };
    const result = checkAutoPilotEligibilityV2(draft, config, 'balanced', 0, 0);
    expect(result.reasons).toHaveLength(8);
  });
});

describe('Auto-pilot Config defaults', () => {
  it('DEFAULT_AUTOPILOT_CONFIG has safe defaults', () => {
    expect(DEFAULT_AUTOPILOT_CONFIG.enabled).toBe(false); // fail-safe default OFF
    expect(DEFAULT_AUTOPILOT_CONFIG.mode).toBe('safe');
    expect(DEFAULT_AUTOPILOT_CONFIG.dailyLimit).toBe(5);
    expect(DEFAULT_AUTOPILOT_CONFIG.dailyBudgetEUR).toBe(500);
  });

  it('AGGRESSIVE_CONFIG has higher thresholds than safe', () => {
    expect(AGGRESSIVE_CONFIG.maxDailyLimit).toBe(10);
    expect(AGGRESSIVE_CONFIG.maxDailyBudgetEUR).toBe(2000);
    expect(AGGRESSIVE_CONFIG.maxUpliftEUR).toBe(300);
    expect(AGGRESSIVE_CONFIG.allowedConfidence).toContain('LOW');
    expect(AGGRESSIVE_CONFIG.allowedConfidence).toContain('MEDIUM');
    expect(AGGRESSIVE_CONFIG.allowedConfidence).not.toContain('HIGH');
    expect(AGGRESSIVE_CONFIG.anomalyHourlyThreshold).toBe(8);
  });
});
