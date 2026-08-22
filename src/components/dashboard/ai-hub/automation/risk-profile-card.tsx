/**
 * RiskProfileCard — v8.24 (violet) — user risk-tolerance form.
 *
 * Extracted from the original `automation-cards.tsx` (4095 lines) as part of
 * v8.94.6-split. Lets the user pick riskTolerance (3 buttons), maxAcceptableRisk
 * (slider 0-100), liquidityReserve (EUR input), investmentHorizon (3 buttons).
 * On save → POST /api/ai/brain/risk-profile. Profile preview shows the
 * current MasterBrain adjustment recommendation (if any).
 *
 * Module-local types come from ./types. No shared utils or shared types are
 * used directly here (RiskProfileApiResponse + RISK_TOLERANCE_OPTIONS etc. are
 * all in ./types).
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { AlertCircle, RefreshCw, Save, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  INVESTMENT_HORIZON_OPTIONS,
  RISK_TOLERANCE_OPTIONS,
} from './types';
import type {
  InvestmentHorizon,
  RiskProfileAdjustment,
  RiskProfileApiResponse,
  RiskTolerance,
  UserRiskProfile,
} from './types';

export function RiskProfileCard() {
  const [profile, setProfile] = useState<UserRiskProfile | null>(null);
  const [adjustment, setAdjustment] = useState<RiskProfileAdjustment | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local working copy (so user can edit before saving)
  const [draftTolerance, setDraftTolerance] = useState<RiskTolerance>('balanced');
  const [draftMaxRisk, setDraftMaxRisk] = useState<number>(50);
  const [draftReserve, setDraftReserve] = useState<number>(500);
  const [draftHorizon, setDraftHorizon] = useState<InvestmentHorizon>('medium');

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/risk-profile', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as RiskProfileApiResponse;
      if (!json?.ok) throw new Error('Risk Profile API ni vrnil rezultata');
      setProfile(json.profile);
      setAdjustment(json.adjustment ?? null);
      setDraftTolerance(json.profile.riskTolerance);
      setDraftMaxRisk(json.profile.maxAcceptableRisk);
      setDraftReserve(json.profile.liquidityReserve);
      setDraftHorizon(json.profile.investmentHorizon);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const dirty =
    profile != null &&
    (profile.riskTolerance !== draftTolerance ||
      profile.maxAcceptableRisk !== draftMaxRisk ||
      profile.liquidityReserve !== draftReserve ||
      profile.investmentHorizon !== draftHorizon);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/ai/brain/risk-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          riskTolerance: draftTolerance,
          maxAcceptableRisk: draftMaxRisk,
          liquidityReserve: draftReserve,
          investmentHorizon: draftHorizon,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as RiskProfileApiResponse;
      if (!json?.ok) throw new Error('Risk Profile API ni vrnil rezultata');
      setProfile(json.profile);
      toast.success('✓ Profil shranjen');
      // Re-fetch to refresh the adjustment preview (Master Brain will pick
      // up the new profile on next call).
      setTimeout(() => fetchProfile(), 300);
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri shranjevanju');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border-2 border-violet-500/40 bg-gradient-to-br from-violet-500/15 via-indigo-500/10 to-purple-500/5 p-3 sm:p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Settings2 className="w-5 h-5 text-violet-600 dark:text-violet-400 shrink-0" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            ⚙️ Tvoj Risk Profile
          </span>
          <Badge variant="outline" className="text-[10px] border-violet-500/50 text-violet-700 dark:text-violet-400 shrink-0 font-bold">
            v8.24
          </Badge>
          <Badge variant="outline" className="text-[9px] border-violet-500/30 text-violet-700/80 dark:text-violet-400/80 shrink-0">
            PERSONAL
          </Badge>
        </div>
        <button
          onClick={fetchProfile}
          disabled={loading}
          className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-2.5 h-2.5', loading && 'animate-spin')} />
          Osveži profil
        </button>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full bg-violet-500/10" />
          <Skeleton className="h-4 w-3/4 bg-violet-500/10" />
          <Skeleton className="h-6 w-1/2 bg-violet-500/10" />
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchProfile} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && profile && (
        <div className="space-y-3">
          {/* 1. riskTolerance — 3 big toggle buttons */}
          <div>
            <label className="text-[10px] uppercase text-muted-foreground mb-1 block font-semibold">
              Toleranca na tveganje
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {RISK_TOLERANCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setDraftTolerance(opt.value)}
                  title={opt.hint}
                  className={cn(
                    'px-2 py-2 rounded-md border text-center transition-all',
                    draftTolerance === opt.value
                      ? 'border-violet-500 bg-violet-500/20 shadow-sm'
                      : 'border-violet-500/20 bg-background/50 hover:bg-violet-500/10',
                  )}
                >
                  <div className={cn(
                    'text-[11px] font-bold',
                    draftTolerance === opt.value
                      ? 'text-violet-700 dark:text-violet-300'
                      : 'text-muted-foreground',
                  )}>
                    {opt.label}
                  </div>
                  <div className="text-[8px] text-muted-foreground/70 mt-0.5 leading-tight hidden sm:block">
                    {opt.hint.split(', ')[0]}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 2. maxAcceptableRisk — slider 0-100 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] uppercase text-muted-foreground font-semibold">
                Max sprejemljivo tveganje
              </label>
              <span className="text-xs font-bold font-mono text-violet-700 dark:text-violet-400">
                {draftMaxRisk}/100
              </span>
            </div>
            <Slider
              value={[draftMaxRisk]}
              min={0}
              max={100}
              step={5}
              onValueChange={(v) => setDraftMaxRisk(v[0] ?? 50)}
              className="w-full"
            />
            <div className="flex justify-between text-[8px] text-muted-foreground mt-0.5">
              <span>0 (varno)</span>
              <span>50</span>
              <span>100 (vse)</span>
            </div>
          </div>

          {/* 3. liquidityReserve — EUR input */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase text-muted-foreground mb-1 block font-semibold">
                Likvidnostna rezerva
              </label>
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  step={50}
                  value={draftReserve}
                  onChange={(e) => {
                    const v = Number.parseFloat(e.target.value);
                    setDraftReserve(Number.isFinite(v) && v >= 0 ? v : 0);
                  }}
                  className="pr-7 h-8 text-xs font-mono border-violet-500/30"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                  €
                </span>
              </div>
            </div>

            {/* 4. investmentHorizon — 3 toggle buttons */}
            <div>
              <label className="text-[10px] uppercase text-muted-foreground mb-1 block font-semibold">
                Investicijski horizont
              </label>
              <div className="grid grid-cols-3 gap-0.5 bg-background/50 rounded-md border border-violet-500/20 p-0.5">
                {INVESTMENT_HORIZON_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDraftHorizon(opt.value)}
                    className={cn(
                      'px-1 py-1 text-[10px] font-semibold rounded transition-colors',
                      draftHorizon === opt.value
                        ? 'bg-violet-500/30 text-violet-700 dark:text-violet-300'
                        : 'text-muted-foreground hover:text-foreground hover:bg-violet-500/10',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Save button */}
          <div className="flex items-center gap-2">
            <Button
              onClick={save}
              disabled={!dirty || saving}
              size="sm"
              className="gap-1.5 h-7 text-[11px] bg-violet-600 hover:bg-violet-700 text-white"
            >
              {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              {saving ? 'Shranjujem...' : 'Shrani profil'}
            </Button>
            {dirty && (
              <span className="text-[10px] text-amber-600 dark:text-amber-400 italic">
                Neshranjene spremembe
              </span>
            )}
          </div>

          {/* Profile preview — current adjustment recommendation */}
          <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-2 space-y-1.5">
            <div className="text-[10px] uppercase text-muted-foreground font-semibold">
              Trenutna priporočila
            </div>
            {adjustment ? (
              <>
                <p className="text-[11px] leading-snug text-foreground">
                  {adjustment.profileSummary}
                </p>
                {adjustment.recommendationOverride && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    <Badge
                      variant="outline"
                      className={cn(
                        'font-bold border-violet-500/40',
                        adjustment.recommendationOverride.action === 'REDUCE_RISK' && 'text-red-600 dark:text-red-400 border-red-500/40',
                        adjustment.recommendationOverride.action === 'ACCEPT_RISK' && 'text-emerald-600 dark:text-emerald-400 border-emerald-500/40',
                        adjustment.recommendationOverride.action === 'CAUTIOUS_PROCEED' && 'text-amber-600 dark:text-amber-400 border-amber-500/40',
                        adjustment.recommendationOverride.action === 'PROCEED' && 'text-blue-600 dark:text-blue-400 border-blue-500/40',
                      )}
                    >
                      {adjustment.recommendationOverride.action}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] border-violet-500/30 text-muted-foreground">
                      urgency: {adjustment.recommendationOverride.urgency}
                    </Badge>
                    {!adjustment.adjusted && (
                      <Badge variant="outline" className="text-[9px] border-muted-foreground/30 text-muted-foreground">
                        no override (balanced)
                      </Badge>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground italic">
                  {adjustment.recommendationOverride?.reason ?? 'Brez override — Master Brain kot je.'}
                </p>
              </>
            ) : (
              <p className="text-[10px] text-muted-foreground italic">
                Predogled prilagoditve ni na voljo (Master Brain še ni zagnan).
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
