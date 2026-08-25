// v8.99: Shared types for trades modules.
// Extracted from trades-view.tsx to enable modular trades components.

export interface Trade {
  id: string;
  listingId: string | null;
  title: string;
  category: string;
  imageUrl: string | null;
  url: string | null;
  buyPrice: number;
  buyDate: string;
  buyLocation: string;
  buyFees: number;
  sellPrice: number | null;
  sellDate: string | null;
  sellLocation: string;
  sellFees: number;
  status: string;
  notes: string;
  flipChecklist?: string;
  tags?: string;
  tagsArray?: string[];
  // v8.69: persisted buy intelligence context (from v8.68 buy score)
  buyScore?: number | null;
  buyVerdict?: string | null;
  buyScoreAt?: string | null;
  createdAt: string;
  listing?: { id: string; title: string; url: string; imageUrl: string | null; monitor?: { name: string } } | null;
}

export interface TradeStats {
  totalTrades: number;
  heldCount: number;
  soldCount: number;
  realizedProfit: number;
  totalInvestedHeld: number;
  totalRealizedRevenue: number;
  totalRealizedCost: number;
  avgRoiPercent: number;
  byCategory: Array<{ category: string; count: number; profit: number; invested: number }>;
  byMonth: Array<{ month: string; profit: number; count: number }>;
  // v4.2: Profit goal
  thisMonthProfit: number;
  monthlyGoal: number;
  goalProgress: number;
}

/** v8.64: Saved View — a named filter combination, persisted in localStorage. */
export interface SavedViewFilters {
  status: string;
  category: string;
  source: string;
  tag: string;
  search: string;
  sortBy: string;
}

export interface SavedView {
  name: string;
  filters: SavedViewFilters;
  createdAt: string;
  custom: boolean; // false = auto-generated default, true = user-saved
}
