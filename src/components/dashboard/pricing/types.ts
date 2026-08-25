// v9.09: Shared types for pricing modules.
// Extracted from pricing-view.tsx to enable modular pricing AI components.

export interface Trade {
  id: string;
  title: string;
  buyPrice: number;
  sellPrice: number | null;
  category: string;
  status: string;
}
