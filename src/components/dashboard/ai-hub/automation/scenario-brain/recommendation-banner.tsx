/**
 * RecommendationBanner — 🏆 Priporočeni scenarij banner.
 *
 * Extracted from the original `scenario-brain-card.tsx` (397 lines) as part
 * of v8.95.0-split-scenario. Renders the rounded rose-tinted banner showing
 * the recommended scenario + its reasoning text (1-3 Slovenian sentences
 * explaining which preset won and why — picked by highest projectedProfit12m
 * with overallHealth as tie-break, computed server-side in
 * `src/lib/brain/scenario.ts`).
 *
 * Purely presentational — takes the `recommendation` slice of
 * ScenarioComparisonResponse as a prop. Renders nothing when the prop is
 * undefined (matches the original `{data.recommendation && (...)}` conditional
 * in the container).
 */

import type { RecommendationBannerProps } from './types';

export function RecommendationBanner({ recommendation }: RecommendationBannerProps) {
  if (!recommendation) return null;

  return (
    <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 sm:p-2.5">
      <div className="flex items-start gap-2 min-w-0">
        <span className="text-base shrink-0">🏆</span>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-rose-700/80 dark:text-rose-300/80 font-semibold">
            Priporočeni scenarij
          </div>
          <p className="text-[11px] sm:text-xs leading-snug font-medium text-rose-900 dark:text-rose-100 mt-0.5">
            {recommendation.reasoning}
          </p>
        </div>
      </div>
    </div>
  );
}
