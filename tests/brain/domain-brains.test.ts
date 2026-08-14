import { describe, it, expect } from 'vitest';
import { profitBrain } from '@/lib/brain/profit';
import { inventoryBrain } from '@/lib/brain/inventory';
import { marketBrain } from '@/lib/brain/market';
import { sourcingBrain } from '@/lib/brain/sourcing';
import { riskBrain } from '@/lib/brain/risk';
import { buyerBrain } from '@/lib/brain/buyer';
import { pricingBrain } from '@/lib/brain/pricing';

const VALID_GRADES = ['A+', 'A', 'B', 'C', 'D', 'F'];

/**
 * v8.34: 7 Domain Brain integration tests.
 * Each domain brain is a PURE deterministic function — no DB, no AI, no side
 * effects. Tests verify:
 *   1. Returns valid result with default (empty) inputs
 *   2. Accepts custom inputs and reflects them in `current`
 *   3. All 6 signals have valid grades + 0-100 scores
 *
 * Goal: catch regressions if anyone changes a domain brain's signature or
 * return shape. Source code is verified working — tests assert the EXISTING
 * contract, not desired behavior.
 */
describe('7 Domain Brains', () => {
  // ----------------------------------------------------------- profitBrain
  describe('profitBrain', () => {
    it('returns valid result with default inputs', () => {
      const result = profitBrain();
      expect(result.ok).toBe(true);
      expect(result.signals).toHaveLength(6);
      expect(result.maximization.topActions).toHaveLength(3);
      expect(result.source).toBe('v8.15-profit-brain');
      expect(result.aiUsed).toBe(false);
    });

    it('accepts custom inputs', () => {
      const result = profitBrain({ avgProfitPerTrade: 50, tradesPerMonth: 20, capitalDeployed: 3000 });
      expect(result.ok).toBe(true);
      expect(result.current.avgProfitPerTrade).toBe(50);
      expect(result.current.tradesPerMonth).toBe(20);
      expect(result.current.capitalDeployed).toBe(3000);
    });

    it('all 6 signals have valid grades', () => {
      const result = profitBrain();
      for (const signal of result.signals) {
        expect(VALID_GRADES).toContain(signal.grade);
        expect(signal.score).toBeGreaterThanOrEqual(0);
        expect(signal.score).toBeLessThanOrEqual(100);
      }
    });
  });

  // ------------------------------------------------------- inventoryBrain
  describe('inventoryBrain', () => {
    it('returns valid result with default inputs', () => {
      const result = inventoryBrain();
      expect(result.ok).toBe(true);
      expect(result.signals).toHaveLength(6);
      expect(result.maximization.topActions).toHaveLength(3);
      expect(result.source).toBe('v8.16-inventory-brain');
      expect(result.aiUsed).toBe(false);
    });

    it('accepts custom inputs', () => {
      const result = inventoryBrain({ itemCount: 30, capitalDeployed: 5000, agedItemsCount: 5 });
      expect(result.ok).toBe(true);
      expect(result.current.itemCount).toBe(30);
      expect(result.current.capitalDeployed).toBe(5000);
      expect(result.current.agedItemsCount).toBe(5);
    });

    it('all 6 signals have valid grades', () => {
      const result = inventoryBrain();
      for (const signal of result.signals) {
        expect(VALID_GRADES).toContain(signal.grade);
        expect(signal.score).toBeGreaterThanOrEqual(0);
        expect(signal.score).toBeLessThanOrEqual(100);
      }
    });
  });

  // ----------------------------------------------------------- marketBrain
  describe('marketBrain', () => {
    it('returns valid result with default inputs', () => {
      const result = marketBrain();
      expect(result.ok).toBe(true);
      expect(result.signals).toHaveLength(6);
      expect(result.maximization.topActions).toHaveLength(3);
      expect(result.source).toBe('v8.17-market-brain');
      expect(result.aiUsed).toBe(false);
    });

    it('accepts custom inputs', () => {
      const result = marketBrain({ activeListingCount: 200, sellThroughRatePct: 60 });
      expect(result.ok).toBe(true);
      expect(result.current.activeListingCount).toBe(200);
      expect(result.current.sellThroughRatePct).toBe(60);
    });

    it('all 6 signals have valid grades', () => {
      const result = marketBrain();
      for (const signal of result.signals) {
        expect(VALID_GRADES).toContain(signal.grade);
        expect(signal.score).toBeGreaterThanOrEqual(0);
        expect(signal.score).toBeLessThanOrEqual(100);
      }
    });
  });

  // -------------------------------------------------------- sourcingBrain
  describe('sourcingBrain', () => {
    it('returns valid result with default inputs', () => {
      const result = sourcingBrain();
      expect(result.ok).toBe(true);
      expect(result.signals).toHaveLength(6);
      expect(result.maximization.topActions).toHaveLength(3);
      expect(result.source).toBe('v8.18-sourcing-brain');
      expect(result.aiUsed).toBe(false);
    });

    it('accepts custom inputs', () => {
      const result = sourcingBrain({ totalCapitalDeployed: 5000, totalMonthlyProfit: 1000 });
      expect(result.ok).toBe(true);
      expect(result.current.totalCapitalDeployed).toBe(5000);
      expect(result.current.totalMonthlyProfit).toBe(1000);
    });

    it('all 6 signals have valid grades', () => {
      const result = sourcingBrain();
      for (const signal of result.signals) {
        expect(VALID_GRADES).toContain(signal.grade);
        expect(signal.score).toBeGreaterThanOrEqual(0);
        expect(signal.score).toBeLessThanOrEqual(100);
      }
    });
  });

  // ------------------------------------------------------------ riskBrain
  describe('riskBrain', () => {
    it('returns valid result with default inputs', () => {
      const result = riskBrain();
      expect(result.ok).toBe(true);
      expect(result.signals).toHaveLength(6);
      expect(result.maximization.topActions).toHaveLength(3);
      expect(result.source).toBe('v8.19-risk-brain');
      expect(result.aiUsed).toBe(false);
    });

    it('accepts custom inputs', () => {
      const result = riskBrain({ totalCapitalDeployed: 5000, capitalConcentrationPct: 60 });
      expect(result.ok).toBe(true);
      expect(result.current.totalCapitalDeployed).toBe(5000);
      expect(result.current.capitalConcentrationPct).toBe(60);
    });

    it('all 6 signals have valid grades', () => {
      const result = riskBrain();
      for (const signal of result.signals) {
        expect(VALID_GRADES).toContain(signal.grade);
        expect(signal.score).toBeGreaterThanOrEqual(0);
        expect(signal.score).toBeLessThanOrEqual(100);
      }
    });
  });

  // ----------------------------------------------------------- buyerBrain
  describe('buyerBrain', () => {
    it('returns valid result with default inputs', () => {
      const result = buyerBrain();
      expect(result.ok).toBe(true);
      expect(result.signals).toHaveLength(6);
      expect(result.maximization.topActions).toHaveLength(3);
      expect(result.source).toBe('v8.20-buyer-brain');
      expect(result.aiUsed).toBe(false);
    });

    it('accepts custom inputs', () => {
      const result = buyerBrain({ totalBuyers: 100, avgOrderValue: 250 });
      expect(result.ok).toBe(true);
      expect(result.current.totalBuyers).toBe(100);
      expect(result.current.avgOrderValue).toBe(250);
    });

    it('all 6 signals have valid grades', () => {
      const result = buyerBrain();
      for (const signal of result.signals) {
        expect(VALID_GRADES).toContain(signal.grade);
        expect(signal.score).toBeGreaterThanOrEqual(0);
        expect(signal.score).toBeLessThanOrEqual(100);
      }
    });
  });

  // ---------------------------------------------------------- pricingBrain
  describe('pricingBrain', () => {
    it('returns valid result with default inputs', () => {
      const result = pricingBrain();
      expect(result.ok).toBe(true);
      expect(result.signals).toHaveLength(6);
      expect(result.maximization.topActions).toHaveLength(3);
      expect(result.source).toBe('v8.21-pricing-brain');
      expect(result.aiUsed).toBe(false);
    });

    it('accepts custom inputs', () => {
      const result = pricingBrain({ activeListingsCount: 250, avgProfitMarginPct: 35 });
      expect(result.ok).toBe(true);
      expect(result.current.activeListingsCount).toBe(250);
      expect(result.current.avgProfitMarginPct).toBe(35);
    });

    it('all 6 signals have valid grades', () => {
      const result = pricingBrain();
      for (const signal of result.signals) {
        expect(VALID_GRADES).toContain(signal.grade);
        expect(signal.score).toBeGreaterThanOrEqual(0);
        expect(signal.score).toBeLessThanOrEqual(100);
      }
    });
  });
});
