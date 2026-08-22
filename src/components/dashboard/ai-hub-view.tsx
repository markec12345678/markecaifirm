/**
 * v8.94.5-split: This file is now a re-export shim.
 *
 * The original 8217-line monolithic `ai-hub-view.tsx` was split into 7
 * focused modules under `./ai-hub/`:
 *   - ai-hub/types.ts           (shared interfaces)
 *   - ai-hub/utils.ts           (helpers + CATEGORIES + categorize)
 *   - ai-hub/brain-sections.tsx (7 Domain Brain sections)
 *   - ai-hub/automation-cards.tsx (Master/Scenario/Adaptive/Draft/AutoPilot/
 *                                  RiskProfile/Snapshots/Accuracy)
 *   - ai-hub/system-cards.tsx   (SystemHealth/Seed/Performance/ActualProfit/
 *                               NotificationCenter/BellDropdown/BrainSynthesis)
 *   - ai-hub/runner-modal.tsx   (AIRunnerModal)
 *   - ai-hub/index.tsx          (AIHubView main export)
 *
 * New code should import from `@/components/dashboard/ai-hub` directly.
 * This shim exists only for backward compatibility — it re-exports the
 * public `AIHubView` symbol so any lingering references to the old path
 * continue to resolve.
 */

export { AIHubView } from './ai-hub';
export type { AIEndpoint } from './ai-hub/types';
