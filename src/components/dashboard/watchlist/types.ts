// v9.09: Shared types for watchlist modules.
// Extracted from watchlist-view.tsx.

export interface WatchlistItem {
  id: string;
  title: string;
  price: number | null;
  priceText: string;
  url: string;
  location: string;
  imageUrl: string | null;
  firstSeenAt: string;
  aiScore: number | null;
  aiRisk: number | null;
  aiVerdict: string | null;
  aiEstimatedValue: number | null;
  dealScore: number | null;
  dealScoreReason: string | null;
  isBookmarked: boolean;
  bookmarkedAt: string | null;
  targetPrice: number | null;
  targetPriceSetAt: string | null;
  targetPriceAlertSent: boolean;
  distanceToTarget: number | null;
  distancePct: number | null;
  targetHit: boolean;
  lowestEver: number | null;
  highestEver: number | null;
  priceHistoryCount: number;
  contactStatus: string;
  monitor: { name: string; source: string };
}

export interface WatchlistStats {
  total: number;
  withTarget: number;
  bookmarked: number;
  targetsHit: number;
  targetsAbove: number;
  priceDropPending: number;
  totalPotentialSavings: number;
  totalValue: number;
}

export type View = 'dashboard' | 'monitors' | 'alerts' | 'listings' | 'watchlist' | 'analytics' | 'trades' | 'health' | 'notifications' | 'settings';
