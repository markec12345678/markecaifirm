// v9.09: Shared types for listing-optimization modules.
// Extracted from listing-optimization-view.tsx to enable modular listing AI components.

export interface Trade {
  id: string;
  title: string;
  buyPrice: number;
  category: string;
  status: string;
}
