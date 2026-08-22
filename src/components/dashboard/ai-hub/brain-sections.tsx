/**
 * Backward-compat re-export shim.
 *
 * Originally a 1147-line monolith holding all 7 Domain Brain Section components
 * (Profit, Inventory, Market, Sourcing, Risk, Buyer, Pricing) + the shared
 * lucide / Badge / Button / Skeleton / cn / type imports. Split into
 * per-section modules under ./brain/ as part of v8.94.8-split-brain.
 *
 * Existing imports like:
 *   import { ProfitBrainSection, RiskBrainSection, ... } from './brain-sections';
 * continue to work via this shim.
 *
 * New code should import directly from './brain' (the index barrel).
 */

export {
  ProfitBrainSection,
  InventoryBrainSection,
  MarketBrainSection,
  SourcingBrainSection,
  RiskBrainSection,
  BuyerBrainSection,
  PricingBrainSection,
} from './brain';
