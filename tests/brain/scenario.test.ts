import { describe, it, expect } from 'vitest';
import {
  compareScenarios,
  CONSERVATIVE_CONFIG,
  BALANCED_CONFIG,
  AGGRESSIVE_CONFIG,
} from '@/lib/brain/scenario';

/**
 * v8.34: Scenario Brain test — runs 3 preset scenarios (conservative, balanced,
 * aggressive) in PARALLEL via Promise.all + optional custom what-if.
 *
 * Source: v8.27-scenario-brain. Async because it calls masterBrain() (which
 * itself is async). Returns ScenarioComparison with scenarios[], comparisonTable,
 * and recommendation.
 */
describe('Scenario Brain', () => {
  it('generates 3 preset scenarios', async () => {
    const result = await compareScenarios();
    expect(result.ok).toBe(true);
    expect(result.scenarios).toHaveLength(3);
    expect(result.source).toBe('v8.27-scenario-brain');
  });

  it('returns comparison table', async () => {
    const result = await compareScenarios();
    // 8 metric rows: 30d, 90d, 12m, Overall Health, Risk Level, Top akcija,
    // Capital potreben, Konflikti
    expect(result.comparisonTable.length).toBeGreaterThanOrEqual(6);
    expect(result.recommendation.bestScenario).toBeTruthy();
  });

  it('aggressive has higher 12m projection than conservative', async () => {
    const result = await compareScenarios();
    const conservative = result.scenarios.find((s) => s.type === 'conservative')!;
    const aggressive = result.scenarios.find((s) => s.type === 'aggressive')!;
    expect(conservative).toBeDefined();
    expect(aggressive).toBeDefined();
    expect(aggressive.comparison.projectedProfit12m).toBeGreaterThan(
      conservative.comparison.projectedProfit12m,
    );
  });

  it('supports custom overrides', async () => {
    const result = await compareScenarios({ profitInput: { capitalDeployed: 5000 } });
    expect(result.custom).toBeDefined();
    expect(result.custom!.type).toBe('custom');
    expect(result.custom!.comparison.projectedProfit12m).toBeGreaterThan(0);
  });

  it('preset configs have correct capital multipliers', () => {
    expect(CONSERVATIVE_CONFIG.capitalMultiplier).toBe(0.7);
    expect(BALANCED_CONFIG.capitalMultiplier).toBe(1.0);
    expect(AGGRESSIVE_CONFIG.capitalMultiplier).toBe(1.5);
  });

  it('comparisonTable has all 3 scenarios per metric', async () => {
    const result = await compareScenarios();
    for (const row of result.comparisonTable) {
      expect(row.conservative).toBeDefined();
      expect(row.balanced).toBeDefined();
      expect(row.aggressive).toBeDefined();
    }
  });

  it('each scenario has full MasterBrainResult attached', async () => {
    const result = await compareScenarios();
    for (const s of result.scenarios) {
      expect(s.masterResult.ok).toBe(true);
      expect(s.masterResult.source).toBe('v8.22-master-brain');
      expect(s.masterResult.topActions.length).toBeGreaterThan(0);
    }
  });

  it('recommendation reasoning references best scenario', async () => {
    const result = await compareScenarios();
    expect(result.recommendation.reasoning).toBeTruthy();
    expect(result.recommendation.reasoning.length).toBeGreaterThan(10);
    // bestScenario should be one of the 3 presets or custom
    const validTypes = ['conservative', 'balanced', 'aggressive', 'custom'];
    expect(validTypes).toContain(result.recommendation.bestScenario);
  });
});
