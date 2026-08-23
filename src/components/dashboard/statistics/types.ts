// v9.01: Shared types for statistics modules.
// Extracted from statistics-view.tsx to enable modular statistics components.

export interface AdvancedStats {
  generatedAt: string;
  keyMetrics: {
    totalRealizedProfit: number;
    totalInvestedHeld: number;
    avgRoi: number | null;
    totalTrades: number;
    soldCount: number;
    heldCount: number;
    cancelledCount: number;
  };
  monthlyPnl: Array<{ month: string; label: string; profit: number; count: number; cumulative: number; invested: number }>;
  conversion: {
    totalListings: number;
    bookmarked: number;
    contacted: number;
    responded: number;
    closed: number;
    withTarget: number;
    targetsHit: number;
    tradesFromListings: number;
    bookmarkToContactPct: number | null;
    contactToResponsePct: number | null;
    responseToClosedPct: number | null;
    bookmarkToTradePct: number | null;
    targetHitPct: number | null;
  };
  aiAccuracy: {
    sampleSize: number;
    avgAbsErrorPct: number | null;
    within15Pct: number | null;
    within30Pct: number | null;
    prilikaAccuracyPct: number | null;
    prilikaSampleSize: number;
    topPredictions: Array<{ id: string; title: string; listingPrice: number | null; aiEstimate: number | null; actualPrice: number | null; diff: number | null; diffPct: number | null }>;
    worstPredictions: Array<{ id: string; title: string; listingPrice: number | null; aiEstimate: number | null; actualPrice: number | null; diff: number | null; diffPct: number | null }>;
  };
  monitorPerformance: Array<{
    id: string;
    name: string;
    source: string;
    isActive: boolean;
    totalListings: number;
    totalAlerts: number;
    totalRuns: number;
    recentRuns: number;
    successRate: number | null;
    successCount: number;
    errorCount: number;
    avgDuration: number | null;
    recentNewListings: number;
    recentAlertsSent: number;
  }>;
  sourceBreakdown: Array<{ source: string; listings: number; monitors: number }>;
  topCategories: Array<{
    name: string;
    count: number;
    profit: number;
    invested: number;
    sold: number;
    held: number;
    avgRoi: number;
    conversionRate: number;
  }>;
}
