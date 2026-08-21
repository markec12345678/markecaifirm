/**
 * ScenarioBrainCard — v8.27 (rose/pink) — "What if?" simulator.
 *
 * Extracted from the original `automation-cards.tsx` (4095 lines) as part of
 * v8.94.6-split. Generates 3 preset scenarios (conservative/balanced/aggressive)
 * and runs Master Brain for EACH in parallel (3× Promise.all via
 * /api/ai/brain/scenario). Shows a side-by-side comparison table
 * (8 metrics × 3-4 columns) + recommendation banner + custom scenario form.
 *
 *   - GET /api/ai/brain/scenario runs 3 presets (15-min cache).
 *   - POST /api/ai/brain/scenario { profitInput: { capitalDeployed, tradesPerMonth }, riskLevel }
 *
 * Recommendation: scenario with highest projectedProfit12m (tie-break:
 * higher overallHealth).
 *
 * v8.95.0-split-scenario: split into container + presentational sub-components.
 *   - Container (this file) owns all state (data, loading, error, customCapital,
 *     customTrades, customRisk, submitting), all callbacks (fetchScenarios,
 *     submitCustom), and renders the outer wrapper + header + subtitle +
 *     loading skeleton + error state + refresh button inline; delegates the
 *     three larger presentational blocks to ./scenario-brain/ sub-components.
 *   - Presentational sub-components (./scenario-brain/): RecommendationBanner
 *     (🏆 Priporočeni scenarij), ComparisonTable (8 × 3-4 side-by-side metrics
 *     + 🏆 BEST column highlight), CustomScenarioForm (capital/trades/risk
 *     inputs + Poženi button). Pure render — props in, JSX out, no state,
 *     no fetches, no side effects.
 *   - Module-local type (ScenarioComparisonResponse) moved to
 *     ./scenario-brain/types.ts — it is only consumed by this single client
 *     card (server-side uses its own ScenarioComparison type from
 *     src/lib/brain/scenario.ts). No shared utils or shared types are used
 *     directly here.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { ScenarioComparisonResponse } from './scenario-brain';
import {
  RecommendationBanner,
  ComparisonTable,
  CustomScenarioForm,
} from './scenario-brain';

// --- v8.27: Scenario Brain card (rose/pink-tinted, "What If?" simulator) -------
//
// v8.27 NEW: Scenario Brain — "Kaj če?" simulator. Generates 3 preset scenarios
// (conservative/balanced/aggressive) and runs Master Brain for EACH in parallel
// (3× Promise.all via /api/ai/brain/scenario). Shows a side-by-side comparison
// table (8 metrics × 3-4 columns) + recommendation banner + custom scenario
// input form.
//
// GET /api/ai/brain/scenario runs 3 presets (15-min cache).
// POST /api/ai/brain/scenario with body { profitInput: { capitalDeployed, tradesPerMonth } }
// runs 3 presets + custom scenario.
//
// Each preset modifies the Master Brain inputs:
//   - CONSERVATIVE: capitalDeployed × 0.7, liquidityReserve 1000€, low concentration
//   - BALANCED:     default (current Master Brain output)
//   - AGGRESSIVE:   capitalDeployed × 1.5, tradesPerMonth 15, more items, higher concentration
//
// Recommendation: scenario with highest projectedProfit12m (tie-break: higher overallHealth).

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
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
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
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setSubmitting(false);
    }
  }, [customCapital, customTrades, customRisk]);

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
          <RecommendationBanner recommendation={data.recommendation} />

          {/* Comparison table */}
          <ComparisonTable
            comparisonTable={data.comparisonTable}
            custom={data.custom}
            bestScenario={data.recommendation?.bestScenario}
          />

          {/* Custom scenario input form */}
          <CustomScenarioForm
            customCapital={customCapital}
            customTrades={customTrades}
            customRisk={customRisk}
            submitting={submitting}
            loading={loading}
            onCapitalChange={setCustomCapital}
            onTradesChange={setCustomTrades}
            onRiskChange={setCustomRisk}
            onSubmit={submitCustom}
          />

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
