// v9.05: Shared types for analytics modules.
// Extracted from analytics-view.tsx to enable modular analytics components.

export const PIE_COLORS = ['#4ade80', '#fbbf24', '#6b7280'];

export interface AnalyticsData {
  alertsPerDay: Array<{ date: string; total: number; PRILIKA: number; SUMNJIVO: number; NEZANIMIVO: number }>;
  listingsPerDay: Array<{ date: string; count: number }>;
  verdictDistribution: { PRILIKA: number; SUMNJIVO: number; NEZANIMIVO: number };
  monitorPerformance: Array<{
    id: string;
    name: string;
    source: string;
    isActive: boolean;
    totalListings: number;
    totalAlerts: number;
    recentAlerts: number;
    prilika: number;
    successRate: number;
    avgDurationMs: number;
    userInterested: number;
    userScam: number;
    userArchived: number;
    precision: number | null;
    conversionRate: number;
  }>;
  accuracy: {
    interested: number;
    archived: number;
    scam: number;
    ignored: number;
    total: number;
    precision: number | null;
  };
  // v1.7: Trade stats
  trades: {
    totalTrades: number;
    heldCount: number;
    soldCount: number;
    realizedProfit: number;
    byMonth: Array<{ month: string; profit: number; count: number }>;
    byCategory: Array<{ category: string; count: number; profit: number }>;
  };
  // v2.0: Price drops
  priceDrops: {
    total: number;
    recent: Array<{
      id: string;
      title: string;
      currentPrice: number | null;
      previousPrice: number | null;
      priceText: string;
      url: string;
      monitorName: string;
      droppedAt: string | null;
    }>;
  };
  // v2.0: Threshold suggestion
  thresholdSuggestion: {
    action: string;
    current: number;
    suggested: number;
    reason: string;
    impact: string;
  } | null;
  // v2.0: Top sellers
  topSellers: Array<{ name: string; listingCount: number }>;
  generatedAt: string;
}
