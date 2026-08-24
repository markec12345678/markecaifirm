import { describe, it, expect } from 'vitest';
import { parseTagsLocal, CATEGORIES } from '@/components/dashboard/trades/utils';
import { categorize, gradeColor, confidenceColor, riskLevelColor, namespaceLabel } from '@/components/dashboard/ai-hub/utils';
import { sourceIcon, sourceColor, timeAgo } from '@/components/dashboard/iskalnik/utils';
import { formatTimeAgo } from '@/components/dashboard/listings/utils';

describe('Trades Utils', () => {
  describe('parseTagsLocal', () => {
    it('parses comma-separated tags', () => {
      expect(parseTagsLocal('elektronika, avto, orodje')).toEqual(['elektronika', 'avto', 'orodje']);
    });

    it('handles null input', () => {
      expect(parseTagsLocal(null)).toEqual([]);
    });

    it('handles undefined input', () => {
      expect(parseTagsLocal(undefined)).toEqual([]);
    });

    it('handles empty string', () => {
      expect(parseTagsLocal('')).toEqual([]);
    });

    it('trims whitespace', () => {
      expect(parseTagsLocal('  elektronika  ,  avto  ')).toEqual(['elektronika', 'avto']);
    });

    it('converts to lowercase', () => {
      expect(parseTagsLocal('Elektronika, AVTO')).toEqual(['elektronika', 'avto']);
    });

    it('filters empty entries', () => {
      expect(parseTagsLocal('elektronika,, ,avto')).toEqual(['elektronika', 'avto']);
    });
  });

  it('CATEGORIES has 8 entries', () => {
    expect(CATEGORIES).toHaveLength(8);
    expect(CATEGORIES).toContain('elektronika');
    expect(CATEGORIES).toContain('avto');
    expect(CATEGORIES).toContain('drugo');
  });
});

describe('AI Hub Utils', () => {
  describe('categorize', () => {
    it('categorizes brain endpoints', () => {
      expect(categorize('brain/profit')).toBe('brain');
      expect(categorize('brain/inventory')).toBe('brain');
    });

    it('categorizes buyer endpoints', () => {
      expect(categorize('buyer/matchmaker')).toBe('buyer');
      expect(categorize('customer-ltv')).toBe('buyer');
    });

    it('categorizes inventory endpoints', () => {
      expect(categorize('inventory-aging')).toBe('inventory');
      expect(categorize('stockout')).toBe('inventory');
    });

    it('returns misc for unknown', () => {
      expect(categorize('unknown-endpoint')).toBe('misc');
    });
  });

  describe('gradeColor', () => {
    it('returns emerald for A+ grade', () => {
      expect(gradeColor('A+')).toContain('emerald');
    });

    it('returns zinc for F grade (unknown)', () => {
      expect(gradeColor('F')).toContain('zinc');
    });
  });

  describe('confidenceColor', () => {
    it('returns emerald for HIGH', () => {
      expect(confidenceColor('HIGH')).toContain('emerald');
    });

    it('returns zinc for LOW', () => {
      expect(confidenceColor('LOW')).toContain('zinc');
    });
  });

  describe('riskLevelColor', () => {
    it('returns rose for HIGH risk', () => {
      expect(riskLevelColor('HIGH')).toContain('rose');
    });

    it('returns amber for MEDIUM risk', () => {
      expect(riskLevelColor('MEDIUM')).toContain('amber');
    });
  });

  describe('namespaceLabel', () => {
    it('returns label for known namespace', () => {
      const result = namespaceLabel('cache');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});

describe('Iskalnik Utils', () => {
  describe('sourceIcon', () => {
    it('returns icon for bolha', () => {
      expect(sourceIcon('bolha')).toBe('🇸🇮');
    });

    it('returns icon for mobile-de', () => {
      expect(sourceIcon('mobile-de')).toBe('🇩🇪');
    });

    it('returns default icon for unknown source', () => {
      expect(sourceIcon('unknown')).toBe('📋');
    });
  });

  describe('sourceColor', () => {
    it('returns color class for bolha', () => {
      expect(sourceColor('bolha')).toContain('emerald');
    });

    it('returns default for unknown', () => {
      expect(sourceColor('unknown')).toContain('muted');
    });
  });

  describe('timeAgo', () => {
    it('returns "zdaj" for recent date', () => {
      expect(timeAgo(new Date())).toBe('zdaj');
    });

    it('returns minutes ago', () => {
      const d = new Date(Date.now() - 5 * 60 * 1000);
      expect(timeAgo(d)).toContain('min');
    });

    it('returns hours ago', () => {
      const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
      expect(timeAgo(d)).toContain('h');
    });
  });
});

describe('Listings Utils', () => {
  describe('formatTimeAgo', () => {
    it('returns seconds for very recent', () => {
      const result = formatTimeAgo(new Date().toISOString());
      expect(result).toContain('s');
    });

    it('returns "pred Xd" for days', () => {
      const d = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      expect(formatTimeAgo(d.toISOString())).toContain('d');
    });
  });
});
