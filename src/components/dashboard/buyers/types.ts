// v9.09: Shared types for buyers modules.
// Extracted from buyers-view.tsx to enable modular buyer AI components.

export interface Trade {
  id: string;
  title: string;
  buyPrice: number;
  sellPrice: number | null;
  sellLocation: string;
  category: string;
  sellDate: string | null;
  status: string;
}

export interface BuyerStat {
  name: string;
  count: number;
  totalSpent: number;
}
