/**
 * CustomScenarioForm — capital / trades / risk inputs + submit button.
 *
 * Extracted from the original `scenario-brain-card.tsx` (397 lines) as part
 * of v8.95.0-split-scenario. Renders the bottom "Custom What If?" form below
 * the comparison table — three inputs (Capital €, Trades / mesec, Risk
 * tolerance) + a "Poženi custom scenarij" submit button.
 *
 * On submit the container POSTs to /api/ai/brain/scenario with
 *   { profitInput: { capitalDeployed, tradesPerMonth? }, riskInput: { ... } }
 * where riskInput.concentrationPct is mapped from the LOW/MEDIUM/HIGH pick
 * (LOW=30%, MEDIUM=40% default, HIGH=50%). The 4th "🎯 Custom" column then
 * appears in the comparison table above.
 *
 * Purely presentational — takes the form state (customCapital, customTrades,
 * customRisk, submitting, loading) + 4 change/submit handlers as props. No
 * internal state, no fetches, no side effects.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RefreshCw, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  CustomScenarioFormProps,
  RiskLevel,
} from './types';

const RISK_LEVELS: readonly RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'] as const;

function riskLabel(r: RiskLevel): string {
  return r === 'LOW' ? '🛡️ LOW' : r === 'MEDIUM' ? '⚖️ MED' : '🚀 HIGH';
}

export function CustomScenarioForm({
  customCapital,
  customTrades,
  customRisk,
  submitting,
  loading,
  onCapitalChange,
  onTradesChange,
  onRiskChange,
  onSubmit,
}: CustomScenarioFormProps) {
  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2 sm:p-2.5 space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-rose-700/80 dark:text-rose-300/80 font-semibold flex items-center gap-1">
        <Sparkles className="w-3 h-3" />
        Custom &quot;What If?&quot; scenarij
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">
        Vnesi svoje parametre in poglej, kako bi se Master Brain odzval.
        Rezultat se prikaže v 4. stolpcu (🎯 Custom) zgornje tabele.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {/* Capital (€) */}
        <div>
          <label className="text-[9px] uppercase text-muted-foreground font-semibold block mb-1">
            Capital (€)
          </label>
          <Input
            type="number"
            value={customCapital}
            onChange={(e) => onCapitalChange(e.target.value)}
            placeholder="5000"
            min={0}
            className="h-8 text-xs bg-background/50"
          />
        </div>

        {/* Trades/month */}
        <div>
          <label className="text-[9px] uppercase text-muted-foreground font-semibold block mb-1">
            Trades / mesec
          </label>
          <Input
            type="number"
            value={customTrades}
            onChange={(e) => onTradesChange(e.target.value)}
            placeholder="25"
            min={0}
            className="h-8 text-xs bg-background/50"
          />
        </div>

        {/* Risk tolerance */}
        <div>
          <label className="text-[9px] uppercase text-muted-foreground font-semibold block mb-1">
            Risk tolerance
          </label>
          <div className="grid grid-cols-3 gap-1">
            {RISK_LEVELS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onRiskChange(r)}
                className={cn(
                  'h-8 text-[10px] font-bold rounded border transition-colors',
                  customRisk === r
                    ? 'bg-rose-500/30 border-rose-500/60 text-rose-700 dark:text-rose-300'
                    : 'bg-background/40 border-rose-500/20 text-muted-foreground hover:bg-rose-500/10',
                )}
              >
                {riskLabel(r)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-[9px] text-muted-foreground italic">
          POST /api/ai/brain/scenario → profitInput + riskInput overrides
        </span>
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={submitting || loading}
          className="h-7 px-3 text-[10px] gap-1.5 bg-rose-600 hover:bg-rose-700 text-white border-rose-700"
        >
          {submitting ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <Sparkles className="w-3 h-3" />
          )}
          {submitting ? 'Računam...' : 'Poženi custom scenarij'}
        </Button>
      </div>
    </div>
  );
}
