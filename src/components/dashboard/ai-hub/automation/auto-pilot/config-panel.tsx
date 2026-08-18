/**
 * Auto-pilot config panel — daily limit/budget sliders + mode selector + save.
 *
 * Extracted from the original `auto-pilot-card.tsx` (1176 lines) as part of
 * v8.94.8-split-autopilot. Renders the config panel that appears inside
 * AutoPilotCard WHEN the master switch is ON:
 *
 *   - "Konfiguracija" header (with Settings2 icon)
 *   - Daily limit slider (1-10 actions/day)
 *   - Daily budget slider (100-2000€/day)
 *   - Mode selector (Safe/Aggressive buttons — delegated to <ModeSelector />)
 *   - Save config button (only when dirty; with Cancel button to reset)
 *
 * Purely presentational — the parent owns dailyLimitInput/dailyBudgetInput
 * local state (debounced save) and passes data + handlers as props.
 */

import { Settings2 } from 'lucide-react';
import { ModeSelector } from './mode-selector';

export interface ConfigPanelProps {
  dailyLimitInput: number;
  dailyBudgetInput: number;
  onDailyLimitChange: (value: number) => void;
  onDailyBudgetChange: (value: number) => void;
  isAggressive: boolean;
  aggressivePending: boolean;
  anomalySuspended: boolean;
  togglingMode: boolean;
  toggling: boolean;
  dirty: boolean;
  todayLimit: number;
  todayBudget: number;
  onResetConfig: () => void;
  onSaveConfig: () => void;
  onEnableAggressive: () => void;
  onDisableAggressive: () => void;
}

export function ConfigPanel({
  dailyLimitInput,
  dailyBudgetInput,
  onDailyLimitChange,
  onDailyBudgetChange,
  isAggressive,
  aggressivePending,
  anomalySuspended,
  togglingMode,
  toggling,
  dirty,
  todayLimit,
  todayBudget,
  onResetConfig,
  onSaveConfig,
  onEnableAggressive,
  onDisableAggressive,
}: ConfigPanelProps) {
  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/[0.03] p-2 space-y-3">
      <div className="text-[10px] uppercase tracking-wide text-purple-700/80 dark:text-purple-300/80 font-semibold flex items-center gap-1">
        <Settings2 className="w-2.5 h-2.5" />
        Konfiguracija
      </div>

      {/* Daily limit slider (1-10) */}
      <div>
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="text-muted-foreground">Dnevni limit (akcije)</span>
          <span className="font-mono font-bold text-purple-700 dark:text-purple-300">
            {dailyLimitInput}/dan
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={dailyLimitInput}
          onChange={(e) => onDailyLimitChange(Number(e.target.value))}
          className="w-full accent-purple-600 cursor-pointer"
        />
        <div className="flex justify-between text-[8px] text-muted-foreground mt-0.5">
          <span>1</span>
          <span>5</span>
          <span>10</span>
        </div>
      </div>

      {/* Daily budget slider (100-2000€) */}
      <div>
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="text-muted-foreground">Dnevni budget (€)</span>
          <span className="font-mono font-bold text-purple-700 dark:text-purple-300">
            {dailyBudgetInput}€/dan
          </span>
        </div>
        <input
          type="range"
          min={100}
          max={2000}
          step={50}
          value={dailyBudgetInput}
          onChange={(e) => onDailyBudgetChange(Number(e.target.value))}
          className="w-full accent-purple-600 cursor-pointer"
        />
        <div className="flex justify-between text-[8px] text-muted-foreground mt-0.5">
          <span>100€</span>
          <span>1000€</span>
          <span>2000€</span>
        </div>
      </div>

      {/* v8.31: Mode selector — now active (not disabled).
          Safe is default; Aggressive requires double confirmation. */}
      <ModeSelector
        isAggressive={isAggressive}
        aggressivePending={aggressivePending}
        anomalySuspended={anomalySuspended}
        togglingMode={togglingMode}
        onEnableAggressive={onEnableAggressive}
        onDisableAggressive={onDisableAggressive}
      />

      {/* Save config button (only when dirty) */}
      {dirty && (
        <div className="flex items-center justify-end gap-1 pt-1 border-t border-purple-500/20">
          <button
            onClick={onResetConfig}
            className="text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:bg-muted/50"
          >
            Prekliči
          </button>
          <button
            onClick={onSaveConfig}
            disabled={toggling}
            className="text-[10px] px-2 py-1 rounded border bg-purple-500/20 border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-500/30 font-semibold disabled:opacity-50"
          >
            💾 Shrani config
          </button>
        </div>
      )}
    </div>
  );
}
