// v9.04: Shared types for dashboard modules.
// Extracted from dashboard-view.tsx to enable modular dashboard components.

export const WIDGET_IDS = ['todaySummary', 'quickStats', 'activityFeed', 'aiInsights', 'skladisceWidget'] as const;
export type WidgetId = typeof WIDGET_IDS[number];

export interface Stats {
  totalMonitors: number;
  activeMonitors: number;
  totalListings: number;
  totalAlerts: number;
  unreadAlerts: number;
  prilikaAlerts: number;
  sumnjivoAlerts: number;
  bookmarkedListings: number;
  contactedListings: number;
  priceDropCount: number;
  newListings24h: number;
  newAlerts24h: number;
  today: {
    newListings: number;
    newAlerts: number;
    priceDrops: number;
    runs: number;
    successfulRuns: number;
  };
  recentRuns: Array<{
    id: string;
    status: string;
    listingsFound: number;
    newListings: number;
    alertsSent: number;
    durationMs: number | null;
    error: string | null;
    startedAt: string;
    monitor: { name: string };
  }>;
}

export interface ViewProps {
  onNavigate: (v: 'dashboard' | 'monitors' | 'alerts' | 'listings' | 'trades' | 'analytics' | 'health' | 'notifications' | 'settings') => void;
}
