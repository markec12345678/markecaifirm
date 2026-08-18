/**
 * Auto-pilot mode selector — Safe vs Aggressive toggle buttons.
 *
 * Extracted from the original `auto-pilot-card.tsx` (1176 lines) as part of
 * v8.94.8-split-autopilot. Renders the two-button mode selector that appears
 * inside the ConfigPanel:
 *
 *   - 🛡️ Safe (LOW risk only)         — default; calls onDisableAggressive
 *   - 🚀 Aggressive (MEDIUM OK)       — double-confirm; calls onEnableAggressive
 *
 * Purely presentational — the parent owns the mode/aggressivePending/
 * anomalySuspended state and passes data + handlers as props.
 */

import { cn } from '@/lib/utils';

export interface ModeSelectorProps {
  isAggressive: boolean;
  aggressivePending: boolean;
  anomalySuspended: boolean;
  togglingMode: boolean;
  onEnableAggressive: () => void;
  onDisableAggressive: () => void;
}

export function ModeSelector({
  isAggressive,
  aggressivePending,
  anomalySuspended,
  togglingMode,
  onEnableAggressive,
  onDisableAggressive,
}: ModeSelectorProps) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1 flex items-center justify-between">
        <span>Mode</span>
        <span className="text-[8px] normal-case font-normal italic">
          {isAggressive
            ? 'Aggressive aktiven — klikni Safe za izklop'
            : aggressivePending
              ? 'Čaka potrditev aggressive...'
              : 'Klikni Aggressive za double opt-in'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={onDisableAggressive}
          disabled={togglingMode || (!isAggressive && !aggressivePending)}
          className={cn(
            'h-7 text-[10px] font-bold rounded border transition-colors',
            !isAggressive
              ? 'bg-purple-500/15 border-purple-500/40 text-purple-700 dark:text-purple-300'
              : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/50',
          )}
          title="Safe mode — only LOW-confidence, low-uplift, non-risk actions"
        >
          🛡️ Safe (LOW risk only)
        </button>
        <button
          type="button"
          onClick={onEnableAggressive}
          disabled={togglingMode || isAggressive || anomalySuspended}
          className={cn(
            'h-7 text-[10px] font-bold rounded border transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
            isAggressive
              ? 'bg-rose-500/20 border-rose-500/50 text-rose-700 dark:text-rose-300'
              : aggressivePending
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-400 animate-pulse'
                : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/50',
          )}
          title={
            anomalySuspended
              ? 'Cannot switch to aggressive while anomaly is suspended'
              : isAggressive
                ? 'Aggressive mode already active'
                : 'Aggressive mode — requires double confirmation (5-min window)'
          }
        >
          {aggressivePending ? '✅ Potrdi Aggressive' : '🚀 Aggressive (MEDIUM OK)'}
        </button>
      </div>
    </div>
  );
}
