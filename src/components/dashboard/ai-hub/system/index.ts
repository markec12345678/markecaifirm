/**
 * Barrel file for system-phase AI Hub cards.
 *
 * Extracted from the original `system-cards.tsx` (1947 lines) as part of
 * v8.94.7-split. Re-exports the 7 system cards + the BrainSynthesisCard
 * orchestrator used by AIHubView (in ../index.tsx):
 *
 *   - SystemHealthCard         (v8.32, emerald/amber/red) — health dashboard
 *   - SeedAndTelegramCard      (v8.35, lime + cyan)        — seed + Telegram
 *   - PerformanceCard          (v8.33, yellow/amber)       — cache + perf stats
 *   - ActualProfitCard         (v8.23, indigo/violet)      — ground truth EUR profit
 *   - NotificationCenterCard   (v8.38, orange/amber)        — notification history
 *   - NotificationBellDropdown  (v8.38, unread-count bell)  — header dropdown
 *   - BrainSynthesisCard       (orchestrator)               — composes all cards
 *
 * Module-local types and helpers live in ./types and are NOT re-exported here
 * (they were never exported by the original system-cards.tsx as part of its
 * public API — they are an internal implementation detail). The 4 helper
 * functions (hitRateColor, responseTimeColor, hitRateBarColor, namespaceLabel)
 * ARE re-exported here for backward-compat with any code that may have
 * imported them from system-cards.tsx.
 */

export { SystemHealthCard } from './system-health-card';
export { SeedAndTelegramCard } from './seed-telegram-card';
export { PerformanceCard } from './performance-card';
export { ActualProfitCard } from './actual-profit-card';
export { NotificationCenterCard } from './notification-center-card';
export { NotificationBellDropdown } from './notification-bell-dropdown';
export { BrainSynthesisCard } from './brain-synthesis-card';

// Backward-compat: helpers were `export`-ed from the original system-cards.tsx
export {
  hitRateColor,
  responseTimeColor,
  hitRateBarColor,
  namespaceLabel,
} from './types';
