/**
 * Barrel file for the 7 Domain Brain Sections.
 *
 * Extracted from the original `brain-sections.tsx` (1147 lines) as part of
 * v8.94.8-split-brain. Each section fetches its respective `/api/ai/brain/*`
 * endpoint, displays signals + projections + grade pill, and provides a
 * refresh button. All seven are rendered in parallel inside BrainSynthesisCard
 * (in ../system/brain-synthesis-card.tsx).
 *
 * Sections:
 *   - ProfitBrainSection  (v8.15, emerald)    — 6 profit signals
 *   - InventoryBrainSection (v8.16, amber)    — 6 inventory signals
 *   - MarketBrainSection  (v8.17, sky/blue)   — 6 market signals
 *   - SourcingBrainSection (v8.18, violet)    — 6 sourcing signals
 *   - RiskBrainSection    (v8.19, red/rose)   — 6 risk signals
 *   - BuyerBrainSection   (v8.20, cyan/teal)  — 6 buyer signals
 *   - PricingBrainSection (v8.21, lime)       — 6 pricing signals
 *
 * Shared types live in ../types; shared color/label helpers live in ../utils.
 * Each section imports only the lucide icons and helpers it actually uses.
 */

export { ProfitBrainSection } from './profit-brain-section';
export { InventoryBrainSection } from './inventory-brain-section';
export { MarketBrainSection } from './market-brain-section';
export { SourcingBrainSection } from './sourcing-brain-section';
export { RiskBrainSection } from './risk-brain-section';
export { BuyerBrainSection } from './buyer-brain-section';
export { PricingBrainSection } from './pricing-brain-section';
