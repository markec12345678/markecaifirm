// v9.09: Shared types for inventory modules.
// Extracted from inventory-view.tsx to enable modular inventory components.

export interface Trade {
  id: string;
  title: string;
  buyPrice: number;
  category: string;
  buyDate: string;
  status: string;
}
