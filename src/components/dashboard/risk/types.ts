// v9.09: Shared types for risk modules.
// Extracted from risk-view.tsx to enable modular risk AI components.

export interface Trade {
  id: string;
  title: string;
  buyPrice: number;
  category: string;
  status: string;
}
