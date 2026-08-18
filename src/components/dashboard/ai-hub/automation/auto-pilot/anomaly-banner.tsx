/**
 * Auto-pilot banner sub-components — three mode/anomaly alert banners.
 *
 * Extracted from the original `auto-pilot-card.tsx` (1176 lines) as part of
 * v8.94.8-split-autopilot. Renders the three "alert" banners that appear at
 * the TOP of the AutoPilotCard (above the master switch) depending on the
 * current mode + anomaly state:
 *
 *   - <AnomalyBanner />              shown when stats.config.anomalySuspended
 *   - <AggressiveActiveBanner />     shown when mode==='aggressive' (and not suspended)
 *   - <AggressivePendingBanner />   shown after first enable_aggressive click (5-min window)
 *
 * Each banner is purely presentational — the parent owns all state and passes
 * data + handlers as props. No internal state, no fetches, no side effects.
 */

import { AlertOctagon, RefreshCw, Rocket, ShieldAlert, Undo2 } from 'lucide-react';

export interface AnomalyBannerProps {
  anomalyReason: string | null;
  anomalySuspendedAt: string | null;
  clearingAnomaly: boolean;
  onClearAnomaly: () => void;
}

export function AnomalyBanner({
  anomalyReason,
  anomalySuspendedAt,
  clearingAnomaly,
  onClearAnomaly,
}: AnomalyBannerProps) {
  return (
    <div className="rounded-lg border-2 border-red-500/50 bg-red-500/10 p-2.5 space-y-1.5">
      <div className="flex items-start gap-2">
        <AlertOctagon className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-red-700 dark:text-red-300">
            ⚠️ AUTO-PILOT SUSPENDED
          </div>
          <div className="text-[10px] text-red-700/90 dark:text-red-300/90 mt-0.5 leading-snug">
            {anomalyReason ?? 'Anomaly detected — possible loop'}
            {anomalySuspendedAt && (
              <span className="block text-[9px] italic mt-0.5">
                Suspended at: {new Date(anomalySuspendedAt).toLocaleString('sl-SI')}
              </span>
            )}
            <span className="block mt-0.5">
              Preglej zgodovino in klikni &quot;Razveljavi suspenzijo&quot; za ponovni vklop.
            </span>
          </div>
        </div>
        <button
          onClick={onClearAnomaly}
          disabled={clearingAnomaly}
          className="text-[10px] px-2 py-1 rounded border bg-red-500/20 border-red-500/50 hover:bg-red-500/30 text-red-700 dark:text-red-300 shrink-0 flex items-center gap-1 disabled:opacity-50 font-semibold"
        >
          {clearingAnomaly ? (
            <RefreshCw className="w-2.5 h-2.5 animate-spin" />
          ) : (
            <Undo2 className="w-2.5 h-2.5" />
          )}
          Razveljavi suspenzijo
        </button>
      </div>
    </div>
  );
}

export interface AggressiveActiveBannerProps {
  togglingMode: boolean;
  onDisableAggressive: () => void;
}

export function AggressiveActiveBanner({
  togglingMode,
  onDisableAggressive,
}: AggressiveActiveBannerProps) {
  return (
    <div className="rounded-lg border-2 border-rose-500/40 bg-rose-500/10 p-2 flex items-center gap-2">
      <Rocket className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold text-rose-700 dark:text-rose-300">
          AGGRESSIVE MODE — višje tveganje
        </div>
        <div className="text-[9px] text-rose-700/80 dark:text-rose-300/80">
          Dovoljena MEDIUM confidence (do 300€ uplift). HIGH še vedno manual. Limit 10/dan, budget 2000€/dan.
        </div>
      </div>
      <button
        onClick={onDisableAggressive}
        disabled={togglingMode}
        className="text-[10px] px-2 py-1 rounded border bg-rose-500/15 border-rose-500/40 hover:bg-rose-500/25 text-rose-700 dark:text-rose-300 shrink-0 disabled:opacity-50 font-semibold"
      >
        🛡️ Nazaj v Safe
      </button>
    </div>
  );
}

export interface AggressivePendingBannerProps {
  togglingMode: boolean;
  onConfirmAggressive: () => void;
}

export function AggressivePendingBanner({
  togglingMode,
  onConfirmAggressive,
}: AggressivePendingBannerProps) {
  return (
    <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/10 p-2 flex items-center gap-2">
      <ShieldAlert className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold text-amber-700 dark:text-amber-400">
          ⚠️ Aggressive mode dovoli MEDIUM confidence
        </div>
        <div className="text-[9px] text-amber-700/80 dark:text-amber-300/80">
          Potrdi ponovno v 5 minutah za aktivacijo aggressive mode.
        </div>
      </div>
      <button
        onClick={onConfirmAggressive}
        disabled={togglingMode}
        className="text-[10px] px-2 py-1 rounded border bg-amber-500/20 border-amber-500/40 hover:bg-amber-500/30 text-amber-700 dark:text-amber-400 shrink-0 disabled:opacity-50 font-bold"
      >
        ✅ Potrdi
      </button>
    </div>
  );
}
