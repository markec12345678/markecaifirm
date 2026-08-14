import { describe, it, expect } from 'vitest';
import { masterBrain } from '@/lib/brain/master';

/**
 * v8.34: Master Brain orchestration test.
 *
 * Master Brain is the apex of the 7-domain-brain hierarchy. It calls all 7
 * in parallel, collects their actions, detects conflicts, ranks TOP 5,
 * synthesizes 30d/90d/12m strategy, computes overallHealth, and produces
 * ONE oneLineSummary that answers "Kaj naj naredim danes?".
 *
 * Source: v8.22-master-brain. Async because it uses Promise.all over the 7
 * domain brains (preserving parallel call contract for future-proofing).
 */
describe('Master Brain', () => {
  it('orchestrates all 7 domain brains', async () => {
    const result = await masterBrain();
    expect(result.ok).toBe(true);
    expect(result.domainSummary).toHaveLength(7);
    expect(result.topActions).toHaveLength(5);
    expect(result.source).toBe('v8.22-master-brain');
    expect(result.aiUsed).toBe(false);
  });

  it('returns conflicts array', async () => {
    const result = await masterBrain();
    expect(Array.isArray(result.conflicts)).toBe(true);
  });

  it('computes overallHealth score 0-100', async () => {
    const result = await masterBrain();
    expect(result.overallHealth.score).toBeGreaterThanOrEqual(0);
    expect(result.overallHealth.score).toBeLessThanOrEqual(100);
    expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(result.overallHealth.riskLevel);
  });

  it('generates strategy projections', async () => {
    const result = await masterBrain();
    expect(result.strategy.projection30d.profitEUR).toBeGreaterThan(0);
    expect(result.strategy.projection90d.profitEUR).toBeGreaterThan(0);
    expect(result.strategy.projection12m.profitEUR).toBeGreaterThan(0);
  });

  it('returns oneLineSummary', async () => {
    const result = await masterBrain();
    expect(result.oneLineSummary).toBeTruthy();
    expect(result.oneLineSummary.length).toBeGreaterThan(20);
  });

  it('supports skip flags', async () => {
    const result = await masterBrain({ skipProfit: true });
    expect(result.ok).toBe(true);
    expect(result.domains.profit).toBeNull();
    // Other domains should still be populated
    expect(result.domains.inventory).not.toBeNull();
    expect(result.domains.market).not.toBeNull();
    // domainSummary should have 6 (one fewer than the full 7)
    expect(result.domainSummary).toHaveLength(6);
  });

  it('domains object exposes all 7 raw brain results', async () => {
    const result = await masterBrain();
    expect(result.domains.profit).not.toBeNull();
    expect(result.domains.inventory).not.toBeNull();
    expect(result.domains.market).not.toBeNull();
    expect(result.domains.sourcing).not.toBeNull();
    expect(result.domains.risk).not.toBeNull();
    expect(result.domains.buyer).not.toBeNull();
    expect(result.domains.pricing).not.toBeNull();
  });

  it('overallHealth has bottlenecks + strengths arrays', async () => {
    const result = await masterBrain();
    expect(Array.isArray(result.overallHealth.bottlenecks)).toBe(true);
    expect(Array.isArray(result.overallHealth.strengths)).toBe(true);
    expect(typeof result.overallHealth.grade).toBe('string');
  });

  it('topActions ranked 1..5 with monotonically decreasing finalScore', async () => {
    const result = await masterBrain();
    expect(result.topActions[0].rank).toBe(1);
    expect(result.topActions[4].rank).toBe(5);
    for (let i = 1; i < 5; i++) {
      expect(result.topActions[i].finalScore).toBeLessThanOrEqual(result.topActions[i - 1].finalScore);
    }
  });
});
