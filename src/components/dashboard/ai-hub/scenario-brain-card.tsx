'use client';

// v8.97: Scenario Brain Card extracted from ai-hub-view.tsx (v8.27, rose/pink).
// "What If?" simulator — runs Master Brain for 3 preset scenarios (conservative/
// balanced/aggressive) in parallel, shows side-by-side comparison table +
// recommendation banner + custom scenario input form. Fetches /api/ai/brain/scenario.

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkles, AlertCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { ScenarioComparisonResponse } from './types';

export function ScenarioBrainCard() {
  const [data, setData] = useState<ScenarioComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Custom scenario form state
  const [customCapital, setCustomCapital] = useState('5000');
  const [customTrades, setCustomTrades] = useState('25');
  const [customRisk, setCustomRisk] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [submitting, setSubmitting] = useState(false);

  const fetchScenarios = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/scenario', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ScenarioComparisonResponse;
      if (!json?.ok) throw new Error(json?.source ? 'Scenario Brain ni vrnil rezultata' : 'Napaka');
      setData(json);
    } catch (e: unknown) {
      setError((e as Error)?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScenarios();
  }, [fetchScenarios]);

  const submitCustom = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const capitalNum = Math.max(0, Math.round(Number(customCapital) || 0));
      const tradesNum = Math.max(0, Math.round(Number(customTrades) || 0));
      // Build the override body — match MasterBrainInput.profitInput shape
      const body: Record<string, unknown> = {
        profitInput: {
          capitalDeployed: capitalNum,
          ...(tradesNum > 0 ? { tradesPerMonth: tradesNum } : {}),
        },
      };
      // Risk tolerance maps to riskInput fields:
      //  LOW    → conservative concentration (30%)
      //  MEDIUM → default (40%)
      //  HIGH   → aggressive concentration (50%)
      if (customRisk === 'LOW') {
        body.riskInput = { capitalConcentrationPct: 30, totalCapitalDeployed: capitalNum };
      } else if (customRisk === 'HIGH') {
        body.riskInput = { capitalConcentrationPct: 50, totalCapitalDeployed: capitalNum };
      } else {
        body.riskInput = { totalCapitalDeployed: capitalNum };
      }

      const res = await fetch('/api/ai/brain/scenario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ScenarioComparisonResponse;
      if (!json?.ok) throw new Error('Scenario Brain (custom) ni vrnil rezultata');
      setData(json);
      toast.success('✓ Custom scenarij izračunan');
    } catch (e: unknown) {
      setError((e as Error)?.message ?? 'Napaka');
      toast.error((e as Error)?.message ?? 'Napaka');
    } finally {
      setSubmitting(false);
    }
  }, [customCapital, customTrades, customRisk]);

  // Build a list of { key, label, isBest } for the column headers
  const columns = useMemo(() => {
    if (!data) return [];
    const best = data.recommendation?.bestScenario;
    const cols: Array<{ key: 'conservative' | 'balanced' | 'aggressive' | 'custom'; label: string; isBest: boolean; isCustom?: boolean }> = [
      { key: 'conservative', label: '🛡️ Konzervativni', isBest: best === 'conservative' },
      { key: 'balanced', label: '⚖️ Uravnovešeni', isBest: best === 'balanced' },
      { key: 'aggressive', label: '🚀 Agresivni', isBest: best === 'aggressive' },
    ];
    if (data.custom) {
      cols.push({
        key: 'custom',
        label: '🎯 Custom',
        isBest: best === 'custom',
        isCustom: true,
      });
    }
    return cols;
  }, [data]);

  return (
    <div className="rounded-xl border-2 border-rose-500/40 bg-gradient-to-br from-rose-500/15 via-pink-500/10 to-fuchsia-500/5 p-3 sm:p-4 shadow-sm">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            🎯 SCENARIO BRAIN
          </span>
          <Badge variant="outline" className="text-[10px] border-rose-500/50 text-rose-700 dark:text-rose-400 shrink-0 font-bold">
            v8.27
          </Badge>
          <Badge variant="outline" className="text-[9px] border-rose-500/30 text-rose-700/80 dark:text-rose-400/80 shrink-0">
            WHAT IF?
          </Badge>
        </div>
        {data?.cachedAt && (
          <Badge variant="outline" className="text-[9px] text-muted-foreground border-muted shrink-0">
            cache {Math.round((Date.now() - data.cachedAt) / 1000)}s
          </Badge>
        )}
      </div>

      {/* Subtitle */}
      <p className="text-[11px] sm:text-xs text-rose-700/80 dark:text-rose-300/80 mb-2.5 leading-snug">
        Primerjaj 3 scenarije (konzervativni / uravnovešeni / agresivni) side-by-side.
        Vsak scenarij požene Master Brain vzporedno (3× Promise.all) in vrne
        primerjavo: profit 30d / 90d / 12m, overallHealth, riskLevel, top akcija,
        capital potreben, konflikti. Priporočilo: scenarij z najvišjim 12m profitom.
      </p>

      {/* Loading skeleton (3 brains running in parallel) */}
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-rose-500/10" />
          <Skeleton className="h-3 w-3/4 bg-rose-500/10" />
          <div className="grid grid-cols-4 gap-2 pt-1">
            <Skeleton className="h-8 bg-rose-500/10" />
            <Skeleton className="h-8 bg-rose-500/10" />
            <Skeleton className="h-8 bg-rose-500/10" />
            <Skeleton className="h-8 bg-rose-500/10" />
          </div>
          <Skeleton className="h-16 w-full bg-rose-500/10" />
          <p className="text-[10px] text-rose-700/70 dark:text-rose-400/70 italic text-center">
            ⏳ 3 Master Brain-i tečejo vzporedno...
          </p>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchScenarios} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && data && (
        <div className="space-y-3">
          {/* Recommendation banner */}
          {data.recommendation && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 sm:p-2.5">
              <div className="flex items-start gap-2 min-w-0">
                <span className="text-base shrink-0">🏆</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-wide text-rose-700/80 dark:text-rose-300/80 font-semibold">
                    Priporočeni scenarij
                  </div>
                  <p className="text-[11px] sm:text-xs leading-snug font-medium text-rose-900 dark:text-rose-100 mt-0.5">
                    {data.recommendation.reasoning}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Comparison table */}
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-[10px] sm:text-[11px] border-collapse">
              <thead>
                <tr>
                  <th className="text-left font-semibold uppercase tracking-wide text-muted-foreground p-1.5 sm:p-2 align-bottom">
                    Metrika
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={cn(
                        'p-1.5 sm:p-2 text-center font-bold align-bottom rounded-t',
                        col.isBest
                          ? 'bg-rose-500/20 border-2 border-rose-500/50 text-rose-700 dark:text-rose-300'
                          : 'bg-rose-500/5 border border-rose-500/20 text-rose-700/80 dark:text-rose-300/80',
                        col.isCustom && !col.isBest && 'italic',
                      )}
                    >
                      <div className="flex flex-col gap-0.5 items-center">
                        <span>{col.label}</span>
                        {col.isBest && (
                          <span className="text-[8px] uppercase font-bold text-rose-600 dark:text-rose-400">
                            🏆 BEST
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.comparisonTable.map((row, idx) => (
                  <tr
                    key={row.metric}
                    className={cn(
                      'border-b border-rose-500/10',
                      idx % 2 === 0 ? 'bg-rose-500/[0.03]' : '',
                    )}
                  >
                    <td className="text-left font-medium text-muted-foreground p-1.5 sm:p-2">
                      {row.metric}
                    </td>
                    {columns.map((col) => {
                      const cellVal = row[col.key];
                      return (
                        <td
                          key={col.key}
                          className={cn(
                            'p-1.5 sm:p-2 text-center font-medium',
                            col.isBest
                              ? 'bg-rose-500/15 border-x-2 border-rose-500/40 text-rose-900 dark:text-rose-100'
                              : 'text-foreground/90',
                          )}
                        >
                          {cellVal === undefined || cellVal === '' ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className="block max-w-[160px] mx-auto leading-snug">
                              {String(cellVal)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Custom scenario input form */}
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
                  onChange={(e) => setCustomCapital(e.target.value)}
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
                  onChange={(e) => setCustomTrades(e.target.value)}
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
                  {(['LOW', 'MEDIUM', 'HIGH'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setCustomRisk(r)}
                      className={cn(
                        'h-8 text-[10px] font-bold rounded border transition-colors',
                        customRisk === r
                          ? 'bg-rose-500/30 border-rose-500/60 text-rose-700 dark:text-rose-300'
                          : 'bg-background/40 border-rose-500/20 text-muted-foreground hover:bg-rose-500/10',
                      )}
                    >
                      {r === 'LOW' ? '🛡️ LOW' : r === 'MEDIUM' ? '⚖️ MED' : '🚀 HIGH'}
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
                onClick={submitCustom}
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

          {/* Refresh */}
          <div className="flex justify-end">
            <button
              onClick={fetchScenarios}
              className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              Osveži Scenario Brain (reset na 3 presete)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
