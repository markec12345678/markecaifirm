/**
 * Backward-compat re-export shim.
 *
 * Originally a 1947-line monolith holding all 7 system cards (SystemHealth,
 * SeedTelegram, Performance, ActualProfit, NotificationCenter,
 * NotificationBell, BrainSynthesis orchestrator) + their module-local types,
 * constants, and helpers. Split into per-component modules under ./system/ as
 * part of v8.94.7-split.
 *
 * Existing imports like:
 *   import { BrainSynthesisCard } from './system-cards';
 *   import { hitRateColor, responseTimeColor, hitRateBarColor, namespaceLabel } from './system-cards';
 * continue to work via this shim.
 *
 * New code should import directly from './system' (the index barrel).
 */

export {
  SystemHealthCard,
  SeedAndTelegramCard,
  PerformanceCard,
  ActualProfitCard,
  NotificationCenterCard,
  NotificationBellDropdown,
  BrainSynthesisCard,
  hitRateColor,
  responseTimeColor,
  hitRateBarColor,
  namespaceLabel,
} from './system';
