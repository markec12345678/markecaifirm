// Unit tests for computeBuyScore — pure deterministic math (no DB, no AI).
// Guards the buy-score computation that the run-buy-requests cron relies on
// for ranking saved-search matches. Locks behavior so the TODO regression
// (matchBuyScore: null) cannot silently come back.

import { describe, it, expect } from 'vitest';
import { computeBuyScore } from '@/lib/trades/buy-opportunity';

const baseListing = {
  id: 'test-1',
  title: 'VW Golf 5',
  price: 9500,
  priceText: '9500 €',
};

describe('computeBuyScore — no price', () => {
  it('returns score 0 / AVOID when price is null', () => {
    const r = computeBuyScore(
      { ...baseListing, price: null, priceText: 'Po dogovoru' },
      {},
    );
    expect(r.score).toBe(0);
    expect(r.verdict).toBe('AVOID');
    expect(r.expectedROI).toBeNull();
  });

  it('returns score 0 / AVOID when price is 0', () => {
    const r = computeBuyScore({ ...baseListing, price: 0, priceText: '0' }, {});
    expect(r.score).toBe(0);
    expect(r.verdict).toBe('AVOID');
  });
});

describe('computeBuyScore — price vs AI estimated value', () => {
  it('rewards listings priced below AI estimated value (discount)', () => {
    const r = computeBuyScore(
      { ...baseListing, price: 9000, aiEstimatedValue: 12000 },
      {},
    );
    // 25% below → +30 (capped), base 25 -> >=55 -> BUY or better
    expect(r.score).toBeGreaterThanOrEqual(55);
    expect(['BUY', 'STRONG_BUY']).toContain(r.verdict);
    expect(r.discountPercent).toBeGreaterThan(0);
  });

  it('penalizes listings priced above AI estimated value', () => {
    const r = computeBuyScore(
      { ...baseListing, price: 12000, aiEstimatedValue: 9000 },
      {},
    );
    // ~33% above → penalty, score should be < base 25
    expect(r.score).toBeLessThan(25);
    expect(r.discountPercent).not.toBeNull();
    expect(r.discountPercent! < 0).toBe(true);
  });
});

describe('computeBuyScore — AI score / risk weighting', () => {
  it('higher AI score increases the result', () => {
    const low = computeBuyScore(
      { ...baseListing, aiScore: 2, aiRisk: 8, aiEstimatedValue: 9500 },
      {},
    );
    const high = computeBuyScore(
      { ...baseListing, aiScore: 9, aiRisk: 1, aiEstimatedValue: 9500 },
      {},
    );
    expect(high.score).toBeGreaterThan(low.score);
  });
});

describe('computeBuyScore — market context', () => {
  it('rewards listings below market average sell price', () => {
    const r = computeBuyScore(
      { ...baseListing, price: 9000 },
      { marketAvgSellPrice: 12000, comparableCount: 5 },
    );
    expect(r.expectedProfit).toBe(3000);
    expect(r.expectedROI).toBeCloseTo((3000 / 9000) * 100, 0);
    expect(r.suggestedMaxBuyPrice).toBe(Math.round(12000 / 1.15));
  });

  it('penalizes listings above market average', () => {
    const r = computeBuyScore(
      { ...baseListing, price: 13000 },
      { marketAvgSellPrice: 10000, comparableCount: 3 },
    );
    expect(r.score).toBeLessThan(25);
  });
});

describe('computeBuyScore — verdict bands', () => {
  it('maps scores to verdict bands STRONG_BUY/BUY/CONSIDER/AVOID', () => {
    // No price -> AVOID (0)
    expect(computeBuyScore({ ...baseListing, price: null, priceText: 'x' }, {}).verdict).toBe('AVOID');
    // Strong discount + good AI -> STRONG_BUY band (>=75)
    const strong = computeBuyScore(
      { ...baseListing, price: 8000, aiScore: 9, aiRisk: 1, aiEstimatedValue: 13000 },
      { marketAvgSellPrice: 13000, comparableCount: 8 },
    );
    expect(['STRONG_BUY', 'BUY']).toContain(strong.verdict);
    expect(strong.score).toBeGreaterThan(55);
  });
});
