/**
 * Automation + scenario + adaptive cards for AI Hub.
 *
 * Extracted from the original monolithic `ai-hub-view.tsx` (8217 lines) as
 * part of v8.94.5-split. Holds the "automation phase" cards:
 *
 *   - RiskProfileCard       (v8.24, violet)         — risk-tolerance form
 *   - MasterBrainBanner     (v8.22, gold/amber)     — synthesizes 7 domains
 *   - ScenarioBrainCard     (v8.27, rose)           — "What if?" simulator
 *   - AdaptiveWeightsCard   (v8.28, orange)         — domain weight sliders
 *   - DraftQueueCard         (v8.29, slate)          — feedback-loop drafts
 *   - AutoPilotCard          (v8.30/v8.31, indigo)   — auto-execute low-risk drafts
 *   - BrainSnapshotsSection (v8.23, emerald)        — historical predictions
 *   - AccuracyTrendCard     (v8.25, teal)           — historical accuracy
 *
 * Module-local interfaces (used only here) are kept in this file.
 * Cross-module shared types (DomainName, DraftStatus, AccuracyTrendSummary)
 * are imported from ./types.
 */

'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Activity,
  AlertCircle,
  AlertOctagon,
  Bot,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  Crown,
  Filter,
  History,
  Info,
  Lock,
  Play,
  Power,
  RefreshCw,
  Rocket,
  Save,
  Settings2,
  ShieldAlert,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Undo2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { DomainName, DraftStatus, AccuracyTrendSummary, ActualProfitResponse } from './types';
import {
  gradeColor,
  confidenceColor,
  riskLevelColor,
  gradeTrendPill,
  trendBadgeClass,
  trendIcon,
  conflictSeverityColor,
  trustScoreColor,
  signalGradeColor,
  rateColor,
  rateLabel,
  draftStatusColor,
  draftStatusLabel,
} from './utils';

// ============================================================================
// Local types (used only inside this module)
// ============================================================================

type RiskTolerance = 'conservative' | 'balanced' | 'aggressive';
type InvestmentHorizon = 'short' | 'medium' | 'long';

interface UserRiskProfile {
  riskTolerance: RiskTolerance;
  maxAcceptableRisk: number;
  liquidityReserve: number;
  investmentHorizon: InvestmentHorizon;
}

interface RiskProfileAdjustment {
  profile: UserRiskProfile;
  adjusted: boolean;
  recommendationOverride: {
    action: 'REDUCE_RISK' | 'ACCEPT_RISK' | 'PROCEED' | 'CAUTIOUS_PROCEED';
    urgency: 'HIGH' | 'MEDIUM' | 'LOW';
    reason: string;
  } | null;
  profileSummary: string;
}

interface RiskProfileApiResponse {
  ok: true;
  profile: UserRiskProfile;
  adjustment: RiskProfileAdjustment | null;
}

const RISK_TOLERANCE_OPTIONS: Array<{ value: RiskTolerance; label: string; hint: string }> = [
  { value: 'conservative', label: 'Konzervativni', hint: 'Nizko tveganje, filter HIGH akcij, 0.5× budget' },
  { value: 'balanced', label: 'Uravnoteženi', hint: 'Brez prilagoditev — Master Brain kot je' },
  { value: 'aggressive', label: 'Agresivni', hint: 'Visoka rast, dovoli HIGH akcij, 1.5× budget' },
];

const INVESTMENT_HORIZON_OPTIONS: Array<{ value: InvestmentHorizon; label: string }> = [
  { value: 'short', label: 'Kratka' },
  { value: 'medium', label: 'Srednja' },
  { value: 'long', label: 'Dolga' },
];

interface SnapshotView {
  id: string;
  date: string;
  overallHealth: number;
  healthGrade: string;
  riskLevel: string;
  topActionCount: number;
  conflictCount: number;
  bottleneckCount: number;
  strengthCount: number;
  projection30dEUR: number;
  projection90dEUR: number;
  projection12mEUR: number;
  profitGrade: string;
  inventoryGrade: string;
  marketGrade: string;
  sourcingGrade: string;
  riskGrade: string;
  buyerGrade: string;
  pricingGrade: string;
  actualProfit30d: number | null;
  actualProfit90d: number | null;
  accuracy30d: number | null;
  accuracy90d: number | null;
  createdAt: string;
}

interface SnapshotsApiResponse {
  ok: true;
  days: number;
  snapshots: SnapshotView[];
  actualProfit: ActualProfitResponse;
  summary: {
    days: number;
    snapshotCount: number;
    latestSnapshot: SnapshotView | null;
    oldestSnapshot: SnapshotView | null;
    avgOverallHealth: number;
    avgProjection30d: number;
    actualProfit30d: number;
    actualProfitTradeCount: number;
  };
}

interface AccuracyTrendPoint {
  date: string;
  profitGrade: string;
  inventoryGrade: string;
  marketGrade: string;
  sourcingGrade: string;
  riskGrade: string;
  buyerGrade: string;
  pricingGrade: string;
  overallHealth: number;
  healthGrade: string;
  accuracy30d: number | null;
  accuracy90d: number | null;
}

interface AccuracyApiResponse {
  ok: true;
  days: number;
  accuracy30d: number | null;
  accuracy90d: number | null;
  gradeTrend: AccuracyTrendPoint[];
  summary: AccuracyTrendSummary;
}

// 7 Domain grade pill style — reuses the existing gradeColor() helper but with
// smaller padding for compact trend display.
const DOMAIN_TREND_LABELS: Array<{ key: keyof AccuracyTrendPoint; label: string }> = [
  { key: 'profitGrade', label: 'Profit' },
  { key: 'inventoryGrade', label: 'Inventar' },
  { key: 'marketGrade', label: 'Trg' },
  { key: 'sourcingGrade', label: 'Sourcing' },
  { key: 'riskGrade', label: 'Tveganje' },
  { key: 'buyerGrade', label: 'Kupci' },
  { key: 'pricingGrade', label: 'Cene' },
];
interface ActionExplanation {
  rank: number;
  domain: DomainName;
  signal: string;
  action: string;
  expectedUpliftEUR: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  finalScore: number;
  reasoning: string;
  reasoningParts: {
    trigger: string;
    signalScore: number;
    signalGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    whyRankedHere: string;
    profileImpact: string | null;
    conflictImpact: string | null;
    expectedOutcome: string;
  };
  trustScore: number; // 0-100
}

interface MasterBrainExplanation {
  ok: true;
  explanations: ActionExplanation[];
  summaryBlurb: string;
  trustScore: number; // 0-100 overall (weighted by finalScore)
  source: string;
  cachedAt?: number;
}

interface MasterBrainResult {
  ok: true;
  domainSummary: Array<{
    name: DomainName;
    grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    gradeScore: number;
    bestOpportunity: string;
    oneLineSummary: string;
  }>;
  topActions: Array<{
    rank: number;
    domain: DomainName;
    signal: string;
    action: string;
    expectedUpliftEUR: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    domainWeight: number;
    finalScore: number;
  }>;
  conflicts: Array<{
    id: string;
    domainA: DomainName;
    domainB: DomainName;
    description: string;
    resolution: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
  }>;
  overallHealth: {
    score: number;
    grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    bottlenecks: DomainName[];
    strengths: DomainName[];
  };
  strategy: {
    projection30d: { profitEUR: number; riskScore: number; keyMilestone: string };
    projection90d: { profitEUR: number; riskScore: number; keyMilestone: string };
    projection12m: { profitEUR: number; riskScore: number; keyMilestone: string };
  };
  oneLineSummary: string;
  aiUsed: false;
  source: string;
  cachedAt?: number;
  // v8.26: per-action explanations array (one per TOP action — up to 5)
  explanations?: ActionExplanation[];
  // v8.26: overall explanation summary (mirror from /api/ai/brain/explain response
  // when computed by master endpoint). Optional — only present if the master
  // endpoint included explanations in the response.
  explanationSummary?: {
    summaryBlurb: string;
    trustScore: number;
  };
}
const DOMAIN_LABELS: Record<DomainName, { icon: string; label: string; color: string }> = {
  profit: { icon: '🧠', label: 'Profit', color: 'text-emerald-600 dark:text-emerald-400' },
  inventory: { icon: '📦', label: 'Inventar', color: 'text-amber-600 dark:text-amber-400' },
  market: { icon: '📈', label: 'Trg', color: 'text-sky-600 dark:text-sky-400' },
  sourcing: { icon: '🎯', label: 'Sourcing', color: 'text-purple-600 dark:text-purple-400' },
  risk: { icon: '🛡️', label: 'Tveganje', color: 'text-rose-600 dark:text-rose-400' },
  buyer: { icon: '👥', label: 'Kupci', color: 'text-cyan-600 dark:text-cyan-400' },
  pricing: { icon: '💶', label: 'Cene', color: 'text-lime-700 dark:text-lime-400' },
};
interface ScenarioComparisonResponse {
  ok: true;
  scenarios: Array<{
    type: 'conservative' | 'balanced' | 'aggressive' | 'custom';
    label: string;
    description: string;
    comparison: {
      projectedProfit30d: number;
      projectedProfit90d: number;
      projectedProfit12m: number;
      overallHealth: number;
      healthGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
      riskLevel: string;
      topAction: string;
      topActionUpliftEUR: number;
      capitalRequired: number;
      conflictsCount: number;
      bottlenecksCount: number;
    };
  }>;
  baseCapital: number;
  custom?: ScenarioComparisonResponse['scenarios'][number];
  comparisonTable: Array<{
    metric: string;
    conservative: string | number;
    balanced: string | number;
    aggressive: string | number;
    custom?: string | number;
  }>;
  recommendation: {
    bestScenario: 'conservative' | 'balanced' | 'aggressive' | 'custom';
    reasoning: string;
  };
  source: string;
  cachedAt?: number;
}

interface DomainWeightStats {
  weight: number;
  executed: number;
  rejected: number;
  lastAdjustedAt: string | null;
  adjustmentHistory: Array<{
    date: string;
    oldWeight: number;
    newWeight: number;
    reason: string;
  }>;
}

type AdaptiveWeightsMap = Record<DomainName, DomainWeightStats>;

interface AdaptiveWeightsResponse {
  ok: true;
  adaptiveWeights: AdaptiveWeightsMap;
  source: string;
}

const DOMAIN_DISPLAY: Array<{
  key: DomainName;
  label: string;
  icon: string;
}> = [
  { key: 'profit', label: 'Profit', icon: '💰' },
  { key: 'inventory', label: 'Inventar', icon: '📦' },
  { key: 'market', label: 'Trg', icon: '📈' },
  { key: 'sourcing', label: 'Sourcing', icon: '🎯' },
  { key: 'risk', label: 'Tveganje', icon: '🛡️' },
  { key: 'buyer', label: 'Kupci', icon: '👥' },
  { key: 'pricing', label: 'Cene', icon: '💶' },
];


interface DraftRow {
  id: string;
  rank: number;
  domain: DomainName;
  signal: string;
  action: string;
  expectedUpliftEUR: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  status: DraftStatus;
  feedbackNote: string | null;
  executedAt: string | Date | null;
  rejectedAt: string | Date | null;
  snapshotDate: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface DraftQueueResponse {
  ok: true;
  drafts: DraftRow[];
  stats: {
    total: number;
    pending: number;
    approved: number;
    executed: number;
    rejected: number;
    expired: number;
    executionRate: number;
  };
  domainStats: Array<{
    domain: DomainName;
    executed: number;
    rejected: number;
    pending: number;
    executionRate: number;
  }>;
}

type AutoPilotMode = 'safe' | 'aggressive';

interface AutoPilotStatsResponse {
  ok: true;
  config: {
    enabled: boolean;
    mode: AutoPilotMode;
    dailyLimit: number;
    dailyBudgetEUR: number;
    lastRunAt: string | null;
    // v8.31: aggressive double-confirm + anomaly detection fields.
    aggressiveConfirmedAt: string | null;
    anomalySuspended: boolean;
    anomalySuspendedAt: string | null;
    anomalyReason: string | null;
    hourlyExecCount: number;
    hourlyWindowStart: string | null;
  };
  today: {
    autoExecuted: number;
    budgetUsed: number;
    budgetRemaining: number;
    limitRemaining: number;
  };
  allTime: {
    totalAutoExecuted: number;
    totalRolledBack: number;
    rollbackRate: number;
  };
  source: string;
}

interface AutoPilotHistoryDraft {
  id: string;
  rank: number;
  domain: DomainName;
  action: string;
  signal: string;
  expectedUpliftEUR: number;
  confidence: string;
  status: string;
  autoExecuted: boolean;
  autoPilotReason: string | null;
  rolledBack: boolean;
  rolledBackAt: string | null;
  rollbackReason: string | null;
  executedAt: string | null;
  createdAt: string;
}

interface AutoPilotHistoryResponse {
  ok: true;
  drafts: AutoPilotHistoryDraft[];
  source: string;
}

interface AutoPilotRunResponse {
  ok: true;
  config: AutoPilotStatsResponse['config'];
  checked: number;
  autoExecuted: number;
  skipped: number;
  executedDrafts: Array<{
    id: string;
    action: string;
    domain: DomainName;
    reasons: string[];
  }>;
  skippedDrafts: Array<{
    id: string;
    action: string;
    reasons: string[];
  }>;
  todayStats: {
    autoExecuted: number;
    budgetUsed: number;
    budgetRemaining: number;
    limitRemaining: number;
  };
  // v8.31: anomaly detection result — if suspended mid-run or pre-run.
  anomalySuspended?: boolean;
  anomalyReason?: string | null;
  source: string;
}

// v8.31: Response shape for POST {action:'enable_aggressive'}.
interface EnableAggressiveResponse {
  ok: true;
  confirmed: boolean; // false = pending first confirmation, true = aggressive enabled
  message: string;
  confirmedAt?: string;
}

// v8.31: Response shape for POST {action:'disable_aggressive'}.
interface DisableAggressiveResponse {
  ok: true;
  mode: string;
}

// v8.31: Response shape for POST {action:'clear_anomaly'}.
interface ClearAnomalyResponse {
  ok: true;
  message: string;
}

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

// --- Brain Snapshots Section (v8.23, emerald-tinted, horizontal scroll) ---
//
// v8.23 NEW PHASE: Validation — historical record of Master Brain predictions.
//
// This section appears BELOW the 7 Domain Brain sections in BrainSynthesisCard.
// It shows a horizontal-scroll list of BrainSnapshot cards (date + grade +
// projection30d + riskLevel). If no snapshots exist yet, an empty state with
// a "Shrani prvi snapshot" button is shown (POSTs to /api/ai/brain/snapshots).
// A small "Shrani snapshot zdaj" button at the top always allows manual save.
//
// Foundation for v8.25 (Historical Accuracy): once we have 30+ days of
// snapshots, we can compare predicted (projection30dEUR) vs actual
// (actualProfit30d, filled by backfill cron).

export function BrainSnapshotsSection() {
  const [data, setData] = useState<SnapshotsApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchSnapshots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/snapshots?days=30', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SnapshotsApiResponse;
      if (!json?.ok) throw new Error('Snapshots API ni vrnil rezultata');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSnapshots();
  }, [fetchSnapshots]);

  const triggerSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/ai/brain/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? 'Napaka pri shranjevanju');
      toast.success(`✓ Snapshot shranjen za ${json.date}`);
      // Refetch to show the new snapshot in the list
      await fetchSnapshots();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri shranjevanju snapshot-a');
    } finally {
      setSaving(false);
    }
  }, [fetchSnapshots]);

  const snapshots = data?.snapshots ?? [];
  const hasSnapshots = snapshots.length > 0;

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 sm:p-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Camera className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-sm font-bold tracking-tight">
            📸 Brain Snapshots
          </span>
          <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-700 dark:text-emerald-400 shrink-0">
            v8.23
          </Badge>
          {hasSnapshots && (
            <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-700/80 dark:text-emerald-400/80 shrink-0">
              <History className="w-2.5 h-2.5 mr-0.5" />
              {snapshots.length} {snapshots.length === 1 ? 'snapshot' : 'snapshotov'}
            </Badge>
          )}
        </div>

        {/* Manual save trigger — always available */}
        <button
          onClick={triggerSave}
          disabled={saving}
          className={cn(
            'text-[10px] flex items-center gap-1 px-2 py-0.5 rounded border transition-colors',
            'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
            'hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {saving ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Save className="w-2.5 h-2.5" />}
          {saving ? 'Shranjujem...' : 'Shrani snapshot zdaj'}
        </button>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-44 shrink-0 bg-emerald-500/10 rounded-lg" />
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchSnapshots} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && !hasSnapshots && (
        <div className="text-center py-6 px-4 border border-dashed border-emerald-500/30 rounded-lg">
          <Camera className="w-8 h-8 mx-auto mb-2 text-emerald-500/50" />
          <p className="text-xs text-muted-foreground mb-3">
            Še ni shranjenih snapshot-ov.<br />
            Shrani prvi snapshot za začetek zgodovine Master Brain napovedi.
          </p>
          <Button
            size="sm"
            onClick={triggerSave}
            disabled={saving}
            className="gap-1.5 bg-emerald-500/20 border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/30"
          >
            {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            {saving ? 'Shranjujem...' : 'Shrani prvi snapshot'}
          </Button>
        </div>
      )}

      {/* Snapshots horizontal scroll list */}
      {!loading && !error && hasSnapshots && (
        <div className="space-y-2">
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: 'thin' }}>
            {snapshots.map((s) => {
              // Predicted vs actual comparison (only available for snapshots
              // older than 30d, when v8.25 backfill runs)
              const hasActual30d = s.actualProfit30d != null;
              const predictedVsActual = hasActual30d && s.projection30dEUR > 0
                ? Math.round(((s.actualProfit30d ?? 0) / s.projection30dEUR) * 10000) / 100
                : null;

              return (
                <div
                  key={s.id}
                  className="shrink-0 w-44 rounded-lg border border-emerald-500/20 bg-background/60 p-2 hover:border-emerald-500/40 transition-colors"
                >
                  {/* Date + grade */}
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <span className="text-[10px] font-mono font-semibold text-muted-foreground">
                      {s.date}
                    </span>
                    <Badge variant="outline" className={cn('text-[9px] font-bold px-1.5 py-0', gradeColor(s.healthGrade))}>
                      {s.healthGrade}
                    </Badge>
                  </div>

                  {/* Overall health + risk level */}
                  <div className="flex items-center gap-1 mb-1">
                    <span className="text-[9px] text-muted-foreground">Zdravje:</span>
                    <span className="text-[10px] font-bold">
                      {Math.round(s.overallHealth)}/100
                    </span>
                    <Badge variant="outline" className={cn('text-[8px] px-1 py-0 ml-auto', riskLevelColor(s.riskLevel))}>
                      {s.riskLevel}
                    </Badge>
                  </div>

                  {/* Predicted 30d profit */}
                  <div className="rounded bg-emerald-500/10 border border-emerald-500/20 p-1 text-center mb-1">
                    <div className="text-[8px] uppercase text-muted-foreground">Napoved 30d</div>
                    <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      {Math.round(s.projection30dEUR)}€
                    </div>
                  </div>

                  {/* Accuracy (if backfilled) */}
                  {hasActual30d && predictedVsActual != null ? (
                    <div className="rounded bg-indigo-500/10 border border-indigo-500/20 p-1 text-center">
                      <div className="text-[8px] uppercase text-muted-foreground">Dejansko / Napoved</div>
                      <div className={cn(
                        'text-[10px] font-bold',
                        predictedVsActual >= 80 ? 'text-emerald-600 dark:text-emerald-400'
                          : predictedVsActual >= 50 ? 'text-amber-600 dark:text-amber-400'
                          : 'text-red-600 dark:text-red-400',
                      )}>
                        {Math.round(s.actualProfit30d ?? 0)}€ · {predictedVsActual}%
                      </div>
                    </div>
                  ) : (
                    <div className="text-[9px] text-muted-foreground italic text-center">
                      ⏳ Čaka 30d za primerjavo
                    </div>
                  )}

                  {/* Top action + conflict count */}
                  <div className="flex items-center justify-between text-[8px] text-muted-foreground mt-1 pt-1 border-t border-emerald-500/10">
                    <span>🎯 {s.topActionCount}</span>
                    <span>⚠️ {s.conflictCount}</span>
                    <span>💪 {s.strengthCount}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-emerald-500/20 text-[10px]">
            <div className="flex items-center gap-3 text-muted-foreground">
              <span>
                Povprečno zdravje: <span className="font-bold text-foreground">{Math.round(data?.summary.avgOverallHealth ?? 0)}/100</span>
              </span>
              <span>
                Povprečna napoved 30d: <span className="font-bold text-foreground">{Math.round(data?.summary.avgProjection30d ?? 0)}€</span>
              </span>
            </div>
            <button
              onClick={fetchSnapshots}
              className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              Osveži
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Accuracy & Trend Card (v8.25, teal/emerald tint) --------------------
//
// v8.25 — Historical Accuracy + Trend (Validation phase CULMINATION).
//
// This card answers the question that has driven the Validation phase since v8.23:
//   "Ali lahko zaupam Master Brain-u?"
//
// Answer:
//   "Master Brain accuracy: 89% (zadnjih 30 dni). Trend: ↗️ IMPROVING."
//
// Visual hierarchy (top → bottom) inside BrainSynthesisCard:
//   1. 📊 Actual Profit (v8.23, indigo) — GROUND TRUTH
//   2. ⚙️ Risk Profile (v8.24, violet) — USER CONTEXT
//   3. 🧠✨ Master Brain Banner (v8.22, gold) — PREDICTIONS
//   4. 🧠📦📈🎯🛡️👥💶 7 Domain Brain sections (v8.15-v8.21) — DRILL-DOWN
//   5. 📸 Brain Snapshots (v8.23, emerald) — RAW HISTORICAL DATA
//   6. 📈 Accuracy & Trend (v8.25, teal) — META-ANALYSIS: how accurate were predictions?
//
// Components:
//   - Two big-number accuracy pills (30d, 90d) — null if no snapshot has
//     accuracy yet (shows "—" + info message)
//   - OverallHealth trend sparkline: last 7 overallHealth scores as pills
//     with arrows between them
//   - Trend indicator: IMPROVING (green) / STABLE (blue) / DECLINING (red) /
//     INSUFFICIENT_DATA (gray)
//   - 7 Domain grade trend table: shows each domain's grade progression
//     (e.g. Profit: D → D → C → C → B)
//   - "🔄 Backfill accuracy" button — POSTs to /api/ai/brain/accuracy/backfill
//     for manual testing
//
// Fetches from /api/ai/brain/accuracy?days=30 on mount.

export function AccuracyTrendCard() {
  const [data, setData] = useState<AccuracyApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);

  const fetchAccuracy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/accuracy?days=30', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as AccuracyApiResponse;
      if (!json?.ok) throw new Error('Accuracy API ni vrnil rezultata');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccuracy();
  }, [fetchAccuracy]);

  const triggerBackfill = useCallback(async () => {
    setBackfilling(true);
    try {
      const res = await fetch('/api/ai/brain/accuracy/backfill', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? 'Napaka pri backfill');
      toast.success(
        `✓ Backfill: ${json.backfilled30d} novih 30d + ${json.backfilled90d} novih 90d (od ${json.totalSnapshots} snapshotov)`,
      );
      // Refetch to show updated accuracy
      await fetchAccuracy();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri backfill');
    } finally {
      setBackfilling(false);
    }
  }, [fetchAccuracy]);

  // Last N overallHealth scores for the sparkline (most recent on the right)
  const trend = data?.gradeTrend ?? [];
  const sparkline = trend.slice(-7);
  const hasSnapshots = trend.length > 0;
  const summary = data?.summary;
  const accuracy30d = data?.accuracy30d ?? null;
  const accuracy90d = data?.accuracy90d ?? null;

  return (
    <div className="rounded-xl border-2 border-teal-500/40 bg-gradient-to-br from-teal-500/15 via-cyan-500/10 to-emerald-500/5 p-3 sm:p-4 shadow-sm">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            📈 Master Brain Accuracy &amp; Trend
          </span>
          <Badge variant="outline" className="text-[10px] border-teal-500/50 text-teal-700 dark:text-teal-400 shrink-0 font-bold">
            v8.25
          </Badge>
          <Badge variant="outline" className="text-[9px] border-teal-500/40 text-teal-700/80 dark:text-teal-400/80 shrink-0">
            VALIDATION FINAL
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          {/* Backfill button */}
          <button
            onClick={triggerBackfill}
            disabled={backfilling}
            className={cn(
              'text-[10px] flex items-center gap-1 px-2 py-0.5 rounded border transition-colors',
              'border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400',
              'hover:bg-teal-500/20 disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {backfilling ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
            {backfilling ? 'Backfill...' : '🔄 Backfill accuracy'}
          </button>
          {/* Refresh button */}
          <button
            onClick={fetchAccuracy}
            className="text-[10px] flex items-center gap-1 px-2 py-0.5 rounded border border-teal-500/20 text-teal-700/80 dark:text-teal-400/80 hover:bg-teal-500/10"
          >
            <RefreshCw className="w-2.5 h-2.5" />
            Osveži
          </button>
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-16 bg-teal-500/10" />
            <Skeleton className="h-16 bg-teal-500/10" />
          </div>
          <Skeleton className="h-8 w-full bg-teal-500/10" />
          <Skeleton className="h-24 w-full bg-teal-500/10" />
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchAccuracy} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && (
        <div className="space-y-3">
          {/* Accuracy big-number block — 30d + 90d */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-teal-500/30 bg-teal-500/5 p-2 text-center">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">30d accuracy</div>
              <div className={cn(
                'text-2xl sm:text-3xl font-bold tabular-nums',
                accuracy30d === null ? 'text-muted-foreground/60' :
                  accuracy30d >= 80 ? 'text-emerald-600 dark:text-emerald-400' :
                  accuracy30d >= 50 ? 'text-amber-600 dark:text-amber-400' :
                  'text-red-600 dark:text-red-400',
              )}>
                {accuracy30d === null ? '—' : `${accuracy30d.toFixed(1)}%`}
              </div>
              <div className="text-[8px] text-muted-foreground">
                {summary?.snapshotsWithAccuracy30d ?? 0} / {summary?.totalSnapshots ?? 0} snapshotov
              </div>
            </div>

            <div className="rounded-lg border border-teal-500/30 bg-teal-500/5 p-2 text-center">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">90d accuracy</div>
              <div className={cn(
                'text-2xl sm:text-3xl font-bold tabular-nums',
                accuracy90d === null ? 'text-muted-foreground/60' :
                  accuracy90d >= 80 ? 'text-emerald-600 dark:text-emerald-400' :
                  accuracy90d >= 50 ? 'text-amber-600 dark:text-amber-400' :
                  'text-red-600 dark:text-red-400',
              )}>
                {accuracy90d === null ? '—' : `${accuracy90d.toFixed(1)}%`}
              </div>
              <div className="text-[8px] text-muted-foreground">
                {summary?.snapshotsWithAccuracy90d ?? 0} / {summary?.totalSnapshots ?? 0} snapshotov
              </div>
            </div>
          </div>

          {/* Insufficient-data info message */}
          {accuracy30d === null && (
            <div className="flex items-start gap-1.5 text-[10px] text-teal-700/80 dark:text-teal-400/80 bg-teal-500/5 border border-teal-500/20 rounded p-2">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                Potrebno več podatkov — snemaj dneve 30+ za accuracy.
                {' '}
                <button
                  onClick={triggerBackfill}
                  disabled={backfilling}
                  className="underline hover:text-teal-700 dark:hover:text-teal-300 disabled:opacity-50"
                >
                  Poženi backfill
                </button>{' '}
                za preverbo (pričakovan rezultat: 0 backfilled ker je naš snapshot iz današnjega dne).
              </span>
            </div>
          )}

          {/* Overall Health trend sparkline */}
          <div className="rounded-lg border border-teal-500/20 bg-background/40 p-2">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Overall Health trend (zadnjih {sparkline.length})
              </span>
              <Badge variant="outline" className={cn('text-[9px] font-bold px-1.5 py-0', trendBadgeClass(summary?.trend ?? 'INSUFFICIENT_DATA'))}>
                {trendIcon(summary?.trend ?? 'INSUFFICIENT_DATA')} {summary?.trend ?? 'INSUFFICIENT_DATA'}
              </Badge>
            </div>

            {sparkline.length === 0 ? (
              <div className="text-[10px] text-muted-foreground italic text-center py-1">
                — Ni dovolj snapshotov za trend
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1 flex-wrap">
                  {sparkline.map((s, i) => (
                    <span key={s.date} className="flex items-center gap-1">
                      <span className={cn(
                        'px-1.5 py-0.5 rounded border text-[10px] font-bold tabular-nums',
                        gradeColor(s.healthGrade),
                      )}>
                        {Math.round(s.overallHealth)}
                      </span>
                      {i < sparkline.length - 1 && (
                        <span className="text-[8px] text-muted-foreground">→</span>
                      )}
                    </span>
                  ))}
                </div>
                {(summary?.firstHalfAvg != null && summary?.secondHalfAvg != null) && (
                  <div className="text-[9px] text-muted-foreground mt-1">
                    1. polovica: <span className="font-bold text-foreground">{summary.firstHalfAvg}</span> · 2. polovica: <span className="font-bold text-foreground">{summary.secondHalfAvg}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 7 Domain grade trend table */}
          <div className="rounded-lg border border-teal-500/20 bg-background/40 p-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              7 Domain grade trend (zadnjih {sparkline.length} snapshotov)
            </div>
            {!hasSnapshots ? (
              <div className="text-[10px] text-muted-foreground italic text-center py-1">
                — Ni snapshotov
              </div>
            ) : (
              <div className="space-y-1">
                {DOMAIN_TREND_LABELS.map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2 text-[10px]">
                    <span className="w-16 shrink-0 text-muted-foreground font-semibold">{label}:</span>
                    <div className="flex items-center gap-1 flex-wrap">
                      {sparkline.map((s, i) => (
                        <span key={s.date} className="flex items-center gap-1">
                          <span className={gradeTrendPill(s[key] as string)}>
                            {s[key] as string}
                          </span>
                          {i < sparkline.length - 1 && (
                            <span className="text-[8px] text-muted-foreground">→</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer summary */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-teal-500/20 text-[10px] text-muted-foreground">
            <span>
              Skupaj snapshotov: <span className="font-bold text-foreground">{summary?.totalSnapshots ?? 0}</span>
            </span>
            <span>
              Z accuracy 30d: <span className="font-bold text-foreground">{summary?.snapshotsWithAccuracy30d ?? 0}</span>
            </span>
            <span>
              Z accuracy 90d: <span className="font-bold text-foreground">{summary?.snapshotsWithAccuracy90d ?? 0}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Master Brain BANNER (v8.22, gold/amber gradient) --------------------
//
// This is the APEX of the Brain hierarchy — sits ON TOP of all 7 Domain Brain
// sections inside BrainSynthesisCard. Master Brain synthesizes 21+ actions
// from 7 domains into ONE final decision: TOP 5 ranked actions + 30d/90d/12m
// strategy + conflict detection + overallHealth score + oneLineSummary.
//
// v8.26 (NEW): response now ALSO includes `explanations` — an array of
// ActionExplanation (one per TOP action). Each contains:
//   - reasoning (1-3 Slovenian sentences — the WHY behind the recommendation)
//   - reasoningParts { trigger, signalScore, signalGrade, whyRankedHere,
//     profileImpact, conflictImpact, expectedOutcome }
//   - trustScore (0-100 per action)
// The Master Brain banner renders an "ℹ️ Zakaj?" toggle per action to expand
// the reasoning + reasoningParts grid + per-action trustScore pill. An overall
// trustScore pill is also added to the banner header.

export function MasterBrainBanner() {
  const [data, setData] = useState<MasterBrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // v8.26: track which TOP action's "ℹ️ Zakaj?" panel is expanded.
  // null = none expanded; otherwise the action's rank (1-5).
  const [expandedRank, setExpandedRank] = useState<number | null>(null);

  // v8.29: Draft Queue integration — when Master Brain loads TOP 5, we POST
  // them to /api/ai/brain/drafts which auto-creates a draft per action
  // (idempotent per snapshotDate). The returned draft IDs power the ✅/❌
  // buttons — each click PATCHes the corresponding draft to executed/rejected
  // AND calls recordActionFeedback (v8.28) → adaptive weights learn.
  const [draftIds, setDraftIds] = useState<Record<number, string>>({});
  const [patchingRank, setPatchingRank] = useState<number | null>(null);
  // After a successful ✅/❌ click, records the final status so we can disable
  // both buttons and visually mark the row as decided.
  const [patchedRanks, setPatchedRanks] = useState<Record<number, 'executed' | 'rejected'>>({});

  const fetchMaster = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/master', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as MasterBrainResult;
      if (!json?.ok) throw new Error(json?.source ? 'Master Brain ni vrnil rezultata' : 'Napaka');
      setData(json);
      // v8.29: After Master Brain data loads, auto-create drafts for TOP 5.
      // POST body shape matches CreateDraftsInput.actions. The endpoint will
      // set snapshotDate=today (YYYY-MM-DD) by default and is idempotent —
      // multiple calls per day return the same drafts (no duplicates).
      // Errors here are non-fatal — Master Brain still renders.
      if (Array.isArray(json.topActions) && json.topActions.length > 0) {
        try {
          const actionsPayload = json.topActions.map((a) => ({
            rank: a.rank,
            domain: a.domain,
            signal: a.signal,
            action: a.action,
            expectedUpliftEUR: a.expectedUpliftEUR,
            confidence: a.confidence,
          }));
          const draftRes = await fetch('/api/ai/brain/drafts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actions: actionsPayload }),
          });
          if (draftRes.ok) {
            const draftJson = await draftRes.json();
            if (draftJson?.ok && Array.isArray(draftJson.drafts)) {
              const idMap: Record<number, string> = {};
              for (const d of draftJson.drafts) {
                if (typeof d.rank === 'number' && typeof d.id === 'string') {
                  idMap[d.rank] = d.id;
                }
              }
              setDraftIds(idMap);
              // Reset patched state — new TOP 5 means fresh pending decisions
              setPatchedRanks({});
            }
          }
        } catch {
          // Non-fatal: drafts just won't be trackable, banner still works.
        }
      }
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMaster();
  }, [fetchMaster]);

  // v8.29: PATCH a draft's status (✅ Izvedel or ❌ Zavrnil). Calls the
  // /api/ai/brain/drafts/{id} endpoint which also calls recordActionFeedback
  // (v8.28) — closing the feedback loop.
  const patchDraft = useCallback(async (rank: number, status: 'executed' | 'rejected') => {
    const draftId = draftIds[rank];
    if (!draftId) {
      toast.error('Draft ID ni najden — osveži Master Brain');
      return;
    }
    setPatchingRank(rank);
    try {
      const res = await fetch(`/api/ai/brain/drafts/${encodeURIComponent(draftId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      // Mark this rank as decided (disables both buttons, highlights result)
      setPatchedRanks((prev) => ({ ...prev, [rank]: status }));
      const emoji = status === 'executed' ? '✅' : '❌';
      const slovenian = status === 'executed' ? 'izvedena' : 'zavrnjena';
      const feedbackNote = json.feedbackRecorded
        ? ` · sistem se uči (${json.feedbackResult?.adjusted ? `utež ${json.feedbackResult.oldWeight} → ${json.feedbackResult.newWeight}` : 'utež nespremenjena'})`
        : '';
      toast.success(`${emoji} Akcija #${rank} označena kot ${slovenian}${feedbackNote}`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri posodobitvi drafta');
    } finally {
      setPatchingRank(null);
    }
  }, [draftIds]);

  // v8.26: compute overall trustScore from the explanations array
  // (weighted by finalScore — same as the backend's overall trustScore).
  // Falls back to 0 if no explanations are present.
  const explanations = data?.explanations;
  const overallTrustScore = useMemo(() => {
    if (!explanations || explanations.length === 0) return null;
    let weightSum = 0;
    let weightedSum = 0;
    for (const e of explanations) {
      const w = e.finalScore > 0 ? e.finalScore : 1;
      weightedSum += e.trustScore * w;
      weightSum += w;
    }
    if (weightSum === 0) return null;
    return Math.round((weightedSum / weightSum) * 10) / 10;
  }, [explanations]);

  return (
    <div className="rounded-xl border-2 border-amber-500/40 bg-gradient-to-br from-amber-500/15 via-yellow-500/10 to-orange-500/5 p-3 sm:p-4 shadow-sm">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Crown className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            🧠✨ MASTER BRAIN
          </span>
          <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-400 shrink-0 font-bold">
            v8.22
          </Badge>
          <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-700/80 dark:text-amber-400/80 shrink-0">
            FINAL · APEX
          </Badge>
          {/* v8.26: overall trustScore pill (emerald ≥70, amber ≥50, red <50) */}
          {overallTrustScore != null && (
            <Badge
              variant="outline"
              className={cn('text-[10px] font-bold px-2 py-0.5 shrink-0', trustScoreColor(overallTrustScore))}
              title="v8.26: Zaupanje v Master Brain priporočila (0-100)"
            >
              <Info className="w-2.5 h-2.5 inline mr-0.5" />
              Trust: {Math.round(overallTrustScore)}/100
            </Badge>
          )}
        </div>
        {data?.cachedAt && (
          <Badge variant="outline" className="text-[9px] text-muted-foreground border-muted shrink-0">
            cache {Math.round((Date.now() - data.cachedAt) / 1000)}s
          </Badge>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full bg-amber-500/10" />
          <Skeleton className="h-4 w-3/4 bg-amber-500/10" />
          <div className="grid grid-cols-5 gap-2 pt-1">
            <Skeleton className="h-8 bg-amber-500/10" />
            <Skeleton className="h-8 bg-amber-500/10" />
            <Skeleton className="h-8 bg-amber-500/10" />
            <Skeleton className="h-8 bg-amber-500/10" />
            <Skeleton className="h-8 bg-amber-500/10" />
          </div>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchMaster} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && data && (
        <div className="space-y-3">
          {/* Big oneLineSummary (centered, prominent) */}
          <p className="text-sm sm:text-base font-bold leading-snug text-center px-1">
            {data.oneLineSummary}
          </p>

          {/* Overall health row: grade pill + score + riskLevel pill */}
          <div className="flex items-center justify-center flex-wrap gap-2">
            <Badge variant="outline" className={cn('text-xs font-bold px-3 py-1', gradeColor(data.overallHealth.grade))}>
              Zdravje: {data.overallHealth.grade} · {Math.round(data.overallHealth.score)}/100
            </Badge>
            <Badge variant="outline" className={cn('text-[10px] px-2 py-0.5', riskLevelColor(data.overallHealth.riskLevel))}>
              Risk: {data.overallHealth.riskLevel}
            </Badge>
          </div>

          {/* TOP 5 AKCIJ ZA DANES (v8.26: each with an ℹ️ Zakaj? toggle) */}
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-amber-700/80 dark:text-amber-400/80 font-semibold flex items-center justify-between">
              <span>🎯 TOP 5 AKCIJ ZA DANES</span>
              {data.explanations && data.explanations.length > 0 && (
                <span className="text-[9px] normal-case font-normal text-muted-foreground italic">
                  ℹ️ klikni &quot;Zakaj?&quot; za razlago
                </span>
              )}
            </div>
            {data.topActions.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">Ni akcij</p>
            ) : (
              data.topActions.map((a) => {
                const dm = DOMAIN_LABELS[a.domain] ?? { icon: '•', label: a.domain, color: 'text-foreground' };
                // v8.26: find the matching explanation (if any)
                const explanation = data.explanations?.find(
                  (e) => e.rank === a.rank && e.domain === a.domain && e.signal === a.signal,
                );
                const isExpanded = expandedRank === a.rank;
                return (
                  <div
                    key={a.rank}
                    className={cn(
                      'rounded bg-background/40 transition-colors',
                      isExpanded ? 'ring-1 ring-amber-500/30 bg-amber-500/5' : '',
                    )}
                  >
                    <div className="flex items-start gap-2 text-[11px] sm:text-xs leading-snug p-1.5">
                      <span className="font-bold text-amber-700 dark:text-amber-400 shrink-0 w-4 text-center">
                        {a.rank}.
                      </span>
                      <span className="shrink-0" title={dm.label}>
                        {dm.icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="font-medium">{a.action}</span>
                        <span className="text-muted-foreground"> · +{Math.round(a.expectedUpliftEUR)}€/mo</span>
                      </span>
                      <span className={cn('text-[9px] font-bold shrink-0', confidenceColor(a.confidence))}>
                        {a.confidence}
                      </span>
                      {/* v8.29: ✅ Izvedel / ❌ Zavrnil buttons — close the feedback loop.
                          When clicked, PATCHes the draft for this action to status='executed'
                          or 'rejected', AND calls recordActionFeedback (v8.28) → adaptive
                          weights re-evaluate every 10 actions per domain → better ranking. */}
                      {draftIds[a.rank] && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => patchDraft(a.rank, 'executed')}
                            disabled={patchingRank === a.rank || patchedRanks[a.rank] != null}
                            className={cn(
                              'text-[9px] flex items-center gap-0.5 px-1.5 py-0.5 rounded border transition-colors',
                              patchedRanks[a.rank] === 'executed'
                                ? 'bg-emerald-500/30 border-emerald-500/60 text-emerald-700 dark:text-emerald-300 cursor-default'
                                : 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-400 disabled:opacity-40',
                            )}
                            aria-label={`Označi akcijo ${a.rank} kot izvedel`}
                            title="v8.29: Označi kot izvedel — sistem se bo naučil (recordActionFeedback)"
                          >
                            <Check className="w-2.5 h-2.5" />
                            Izvedel
                          </button>
                          <button
                            onClick={() => patchDraft(a.rank, 'rejected')}
                            disabled={patchingRank === a.rank || patchedRanks[a.rank] != null}
                            className={cn(
                              'text-[9px] flex items-center gap-0.5 px-1.5 py-0.5 rounded border transition-colors',
                              patchedRanks[a.rank] === 'rejected'
                                ? 'bg-red-500/30 border-red-500/60 text-red-700 dark:text-red-300 cursor-default'
                                : 'bg-red-500/10 border-red-500/30 hover:bg-red-500/25 text-red-700 dark:text-red-400 disabled:opacity-40',
                            )}
                            aria-label={`Označi akcijo ${a.rank} kot zavrnjeno`}
                            title="v8.29: Označi kot zavrnjeno — sistem se bo naučil (recordActionFeedback)"
                          >
                            <X className="w-2.5 h-2.5" />
                            Zavrnil
                          </button>
                        </div>
                      )}
                      {/* v8.26: ℹ️ Zakaj? toggle button — only render if an explanation exists */}
                      {explanation && (
                        <button
                          onClick={() => setExpandedRank(isExpanded ? null : a.rank)}
                          className="text-[9px] flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-amber-500/30 hover:bg-amber-500/15 text-amber-700 dark:text-amber-400 shrink-0 transition-colors"
                          aria-expanded={isExpanded}
                          aria-label={`Razširi razlago za akcijo ${a.rank}`}
                          title="v8.26: Razširi za razlago (Zakaj Master Brain priporoča to akcijo?)"
                        >
                          <Info className="w-2.5 h-2.5" />
                          Zakaj?
                          {isExpanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                        </button>
                      )}
                    </div>
                    {/* v8.26: Expanded explanation panel — reasoning + reasoningParts grid + trustScore pill */}
                    {explanation && isExpanded && (
                      <div className="mx-1.5 mb-1.5 p-2 rounded border border-amber-500/20 bg-amber-500/5 space-y-2">
                        {/* Reasoning — the primary WHY string (prominent) */}
                        <p className="text-[11px] leading-relaxed text-amber-900 dark:text-amber-200 font-medium">
                          <span className="text-[9px] uppercase tracking-wide text-amber-700/80 dark:text-amber-400/80 font-semibold mr-1">
                            💡 Razlaga:
                          </span>
                          {explanation.reasoning}
                        </p>

                        {/* reasoningParts grid: Signal + Rank + Profile + Conflict + Expected */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[10px]">
                          {/* Signal */}
                          <div className="rounded border border-amber-500/20 bg-background/50 p-1.5">
                            <div className="text-[8px] uppercase text-muted-foreground font-semibold">
                              Signal
                            </div>
                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                              <span className="font-mono text-amber-700 dark:text-amber-400 font-medium">
                                {explanation.signal}
                              </span>
                              <Badge
                                variant="outline"
                                className={cn('text-[8px] px-1 py-0 h-3.5', signalGradeColor(explanation.reasoningParts.signalGrade))}
                              >
                                {explanation.reasoningParts.signalGrade}
                              </Badge>
                              <span className="text-muted-foreground text-[9px]">
                                {Math.round(explanation.reasoningParts.signalScore)}/100
                              </span>
                            </div>
                          </div>

                          {/* Rank reason */}
                          <div className="rounded border border-amber-500/20 bg-background/50 p-1.5">
                            <div className="text-[8px] uppercase text-muted-foreground font-semibold">
                              Zakaj na tem mestu
                            </div>
                            <div className="mt-0.5 text-[9px] leading-snug text-foreground/90">
                              {explanation.reasoningParts.whyRankedHere}
                            </div>
                          </div>

                          {/* Profile impact */}
                          <div className="rounded border border-amber-500/20 bg-background/50 p-1.5">
                            <div className="text-[8px] uppercase text-muted-foreground font-semibold">
                              Vpliv profila
                            </div>
                            <div className="mt-0.5 text-[9px] leading-snug text-foreground/90">
                              {explanation.reasoningParts.profileImpact ?? '—'}
                            </div>
                          </div>

                          {/* Conflict impact */}
                          <div className="rounded border border-amber-500/20 bg-background/50 p-1.5">
                            <div className="text-[8px] uppercase text-muted-foreground font-semibold">
                              Vpliv konfliktov
                            </div>
                            <div className="mt-0.5 text-[9px] leading-snug text-foreground/90">
                              {explanation.reasoningParts.conflictImpact ?? '—'}
                            </div>
                          </div>

                          {/* Expected outcome */}
                          <div className="rounded border border-amber-500/20 bg-background/50 p-1.5 sm:col-span-2">
                            <div className="text-[8px] uppercase text-muted-foreground font-semibold">
                              Pričakovan izid
                            </div>
                            <div className="mt-0.5 text-[9px] leading-snug text-emerald-700 dark:text-emerald-400 font-medium">
                              {explanation.reasoningParts.expectedOutcome}
                            </div>
                          </div>
                        </div>

                        {/* Per-action trustScore pill */}
                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-amber-500/20">
                          <span className="text-[9px] uppercase text-muted-foreground font-semibold">
                            Trust score
                          </span>
                          <Badge
                            variant="outline"
                            className={cn('text-[10px] font-bold px-2 py-0.5', trustScoreColor(explanation.trustScore))}
                            title="v8.26: Zaupanje v to priporočilo (0-100). ≥70=zeleno, ≥50=rumeno, <50=rdeče."
                          >
                            {Math.round(explanation.trustScore)}/100
                          </Badge>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Strategy pills: 30d / 90d / 12m */}
          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded border border-amber-500/30 bg-amber-500/5 p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">30d</div>
              <div className="text-xs font-bold text-amber-700 dark:text-amber-400">
                {Math.round(data.strategy.projection30d.profitEUR)}€
              </div>
              <div className="text-[9px] text-muted-foreground">
                risk {Math.round(data.strategy.projection30d.riskScore)}/100
              </div>
            </div>
            <div className="rounded border border-amber-500/30 bg-amber-500/5 p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">90d</div>
              <div className="text-xs font-bold text-amber-700 dark:text-amber-400">
                {Math.round(data.strategy.projection90d.profitEUR)}€
              </div>
              <div className="text-[9px] text-muted-foreground">
                risk {Math.round(data.strategy.projection90d.riskScore)}/100
              </div>
            </div>
            <div className="rounded border border-amber-500/40 bg-amber-500/10 p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">12m</div>
              <div className="text-xs font-bold text-amber-700 dark:text-amber-400">
                {Math.round(data.strategy.projection12m.profitEUR)}€
              </div>
              <div className="text-[9px] text-muted-foreground">
                risk {Math.round(data.strategy.projection12m.riskScore)}/100
              </div>
            </div>
          </div>

          {/* Conflicts (if any) */}
          {data.conflicts.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-amber-500/20">
              <div className="text-[10px] uppercase tracking-wide text-amber-700/80 dark:text-amber-400/80 font-semibold flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                KONFLIKTI ({data.conflicts.length})
              </div>
              {data.conflicts.map((c) => (
                <div
                  key={c.id}
                  className={cn('rounded border p-1.5 text-[10px] leading-snug', conflictSeverityColor(c.severity))}
                >
                  <div className="font-semibold flex items-center gap-1">
                    <span className="font-bold uppercase">{c.severity}</span>
                    <span className="text-muted-foreground">·</span>
                    <span>
                      {DOMAIN_LABELS[c.domainA]?.icon ?? '•'} {c.domainA}
                    </span>
                    <span className="text-muted-foreground">vs</span>
                    <span>
                      {DOMAIN_LABELS[c.domainB]?.icon ?? '•'} {c.domainB}
                    </span>
                  </div>
                  <div className="mt-0.5">{c.description}</div>
                  <div className="mt-0.5 italic text-muted-foreground">→ {c.resolution}</div>
                </div>
              ))}
            </div>
          )}

          {/* Bottlenecks / Strengths row */}
          <div className="flex flex-wrap items-center gap-2 text-[10px] pt-1 border-t border-amber-500/20">
            {data.overallHealth.bottlenecks.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-muted-foreground">⚠️ Ozka grla:</span>
                {data.overallHealth.bottlenecks.map((d) => (
                  <span key={d} className={cn('font-bold', DOMAIN_LABELS[d]?.color ?? '')}>
                    {DOMAIN_LABELS[d]?.icon} {d}
                  </span>
                ))}
              </div>
            )}
            {data.overallHealth.strengths.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-muted-foreground">💪 Moč:</span>
                {data.overallHealth.strengths.map((d) => (
                  <span key={d} className={cn('font-bold', DOMAIN_LABELS[d]?.color ?? '')}>
                    {DOMAIN_LABELS[d]?.icon} {d}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Refresh */}
          <div className="flex justify-end">
            <button
              onClick={fetchMaster}
              className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              Osveži Master Brain
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

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

// --- v8.28: Adaptive Weights card (bright orange-tinted, "feedback loop") ------
//
// v8.28 NEW: 🎛️ Adaptive Domain Weights — the FEEDBACK LOOP. Master Brain (v8.22)
// uses hardcoded DOMAIN_WEIGHTS (risk=1.3, profit=1.2, ...). v8.28 makes these
// ADAPTIVE — stored per-user in Settings.adaptiveDomainWeights (JSON field).
// The user marks actions as "executed" or "rejected" → system tracks per-domain
// execution stats → after every 10 actions per domain:
//   - executionRate > 0.8: weight × 1.1 (boost — user values this domain)
//   - executionRate < 0.4: weight × 0.9 (reduce — user ignores this domain)
//   - else: no change
//   - clamp weight to [0.5, 2.0]
// UI: 7 sliders (one per domain) + execution stats + rate bar + history + reset
// button + feedback demo form. Card is orange-tinted (brighter than Risk's red
// and Inventory's amber). Card sits BETWEEN ScenarioBrainCard and the 7 Domain
// Brain sections.

export function AdaptiveWeightsCard() {
  const [data, setData] = useState<AdaptiveWeightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-domain slider draft state (so user can adjust multiple sliders before saving)
  const [draftWeights, setDraftWeights] = useState<Record<DomainName, number>>({
    profit: 1.2,
    inventory: 1.0,
    market: 1.0,
    sourcing: 1.1,
    risk: 1.3,
    buyer: 0.9,
    pricing: 1.1,
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Feedback demo form state
  const [feedbackDomain, setFeedbackDomain] = useState<DomainName>('profit');
  const [recording, setRecording] = useState(false);

  const fetchWeights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/weights', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as AdaptiveWeightsResponse;
      if (!json?.ok) throw new Error('Adaptive Weights API ni vrnil rezultata');
      setData(json);
      // Sync draft weights with current values (so slider shows current weight)
      const drafts: Record<DomainName, number> = { ...draftWeights };
      for (const d of DOMAIN_DISPLAY) {
        drafts[d.key] = json.adaptiveWeights[d.key]?.weight ?? 1.0;
      }
      setDraftWeights(drafts);
      setDirty(false);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWeights();
  }, [fetchWeights]);

  // Save all dirty slider values to backend (calls POST { action: 'set' } for each changed domain)
  const saveAll = useCallback(async () => {
    if (!data) return;
    setSaving(true);
    try {
      const changedDomains = DOMAIN_DISPLAY.filter(
        (d) => Math.abs(draftWeights[d.key] - data.adaptiveWeights[d.key].weight) > 0.001,
      );
      if (changedDomains.length === 0) {
        toast.info('Ni sprememb za shranjevanje');
        return;
      }
      let ok = 0;
      let fail = 0;
      for (const d of changedDomains) {
        try {
          const res = await fetch('/api/ai/brain/weights', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'set', domain: d.key, weight: draftWeights[d.key] }),
          });
          if (res.ok) ok++;
          else fail++;
        } catch {
          fail++;
        }
      }
      if (fail === 0) {
        toast.success(`✓ Shranjeno: ${ok} uteži posodobljene`);
      } else {
        toast.warning(`Delno: ${ok} OK, ${fail} napake`);
      }
      await fetchWeights();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri shranjevanju');
    } finally {
      setSaving(false);
    }
  }, [data, draftWeights, fetchWeights]);

  // Reset all weights to defaults
  const resetAll = useCallback(async () => {
    setResetting(true);
    try {
      const res = await fetch('/api/ai/brain/weights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.ok) throw new Error('Reset ni uspel');
      toast.success('✓ Vse uteži resetirane na default');
      await fetchWeights();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri resetu');
    } finally {
      setResetting(false);
    }
  }, [fetchWeights]);

  // Record feedback (executed/rejected) for the selected domain in the demo form
  const recordFeedback = useCallback(async (feedback: 'executed' | 'rejected') => {
    setRecording(true);
    try {
      const res = await fetch('/api/ai/brain/weights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'record', domain: feedbackDomain, feedback }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? 'Record ni uspel');
      const emoji = feedback === 'executed' ? '✅' : '❌';
      const adjText = json.adjusted
        ? ` → utež posodobljena: ${json.oldWeight} → ${json.newWeight}`
        : ` (executed: ${json.executed}, rejected: ${json.rejected}, rate: ${Math.round(json.executionRate * 100)}%)`;
      toast.success(`${emoji} ${feedbackDomain}: ${feedback}${adjText}`);
      await fetchWeights();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri record');
    } finally {
      setRecording(false);
    }
  }, [feedbackDomain, fetchWeights]);

  return (
    <div className="rounded-xl border-2 border-orange-500/40 bg-gradient-to-br from-orange-500/15 via-amber-500/10 to-yellow-500/5 p-3 sm:p-4 shadow-sm">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Settings2 className="w-5 h-5 text-orange-600 dark:text-orange-400 shrink-0" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            🎛️ Adaptive Domain Weights
          </span>
          <Badge variant="outline" className="text-[10px] border-orange-500/50 text-orange-700 dark:text-orange-400 shrink-0 font-bold">
            v8.28
          </Badge>
          <Badge variant="outline" className="text-[9px] border-orange-500/30 text-orange-700/80 dark:text-orange-400/80 shrink-0">
            FEEDBACK LOOP
          </Badge>
        </div>
        <button
          onClick={fetchWeights}
          disabled={loading}
          className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-2.5 h-2.5', loading && 'animate-spin')} />
          Osveži uteži
        </button>
      </div>

      {/* Subtitle */}
      <p className="text-[11px] sm:text-xs text-orange-700/80 dark:text-orange-300/80 mb-2.5 leading-snug">
        Master Brain se uči iz tvojega vedenja. Ko označuješ akcije kot
        &quot;executed&quot; ali &quot;rejected&quot;, sistem beleži execution
        rate per domeno. Po vsakih 10 akcijah: rate &gt; 80% → utež × 1.1 (boost),
        &lt; 40% → × 0.9 (reduce), clamp [0.5, 2.0].
      </p>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-orange-500/10" />
          <Skeleton className="h-3 w-3/4 bg-orange-500/10" />
          <div className="grid grid-cols-1 gap-2 pt-1">
            <Skeleton className="h-12 bg-orange-500/10" />
            <Skeleton className="h-12 bg-orange-500/10" />
          </div>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchWeights} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content — 7 domain rows */}
      {!loading && !error && data && (
        <div className="space-y-2.5">
          {DOMAIN_DISPLAY.map((d) => {
            const stats = data.adaptiveWeights[d.key];
            const total = stats.executed + stats.rejected;
            const rate = total > 0 ? stats.executed / total : 0;
            const draftVal = draftWeights[d.key];
            const isDirty = Math.abs(draftVal - stats.weight) > 0.001;
            return (
              <div
                key={d.key}
                className={cn(
                  'rounded-lg border p-2 sm:p-2.5',
                  isDirty
                    ? 'border-orange-500/60 bg-orange-500/10'
                    : 'border-orange-500/20 bg-orange-500/[0.03]',
                )}
              >
                {/* Top row: domain + weight number + stats */}
                <div className="flex items-center gap-2 mb-1.5 min-w-0 flex-wrap">
                  <div className="flex items-center gap-1.5 shrink-0 min-w-[110px]">
                    <span className="text-base">{d.icon}</span>
                    <span className="text-xs sm:text-[13px] font-semibold text-foreground">
                      {d.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 ml-auto shrink-0">
                    <span
                      className={cn(
                        'text-xs font-mono font-bold px-1.5 py-0.5 rounded',
                        isDirty
                          ? 'bg-orange-500/20 text-orange-700 dark:text-orange-300'
                          : 'bg-background/60 text-foreground',
                      )}
                      title="Current domain weight applied in Master Brain ranking"
                    >
                      {draftVal.toFixed(1)}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      ✅{stats.executed} | ❌{stats.rejected}
                    </span>
                  </div>
                </div>

                {/* Slider */}
                <Slider
                  value={[draftVal]}
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  onValueChange={(v) => {
                    const newV = v[0] ?? 1.0;
                    setDraftWeights((prev) => ({ ...prev, [d.key]: newV }));
                    setDirty(true);
                  }}
                  className="w-full"
                />
                <div className="flex justify-between text-[8px] text-muted-foreground mt-0.5">
                  <span>0.5 (reduce)</span>
                  <span>1.0 (default)</span>
                  <span>2.0 (boost)</span>
                </div>

                {/* Execution rate bar */}
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-background/60 rounded overflow-hidden">
                    <div
                      className={cn('h-full transition-all', rateColor(rate))}
                      style={{ width: `${Math.round(rate * 100)}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground font-mono shrink-0">
                    {total > 0 ? `${Math.round(rate * 100)}%` : '—'}
                    {' '}
                    ({rateLabel(rate)})
                  </span>
                </div>

                {/* Mini adjustment history (last 3) */}
                {stats.adjustmentHistory.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    <div className="text-[9px] uppercase text-muted-foreground font-semibold">
                      Zgodovina (zadnje {Math.min(3, stats.adjustmentHistory.length)})
                    </div>
                    {stats.adjustmentHistory.slice(0, 3).map((h, idx) => (
                      <div key={idx} className="text-[9px] text-muted-foreground/80 font-mono truncate">
                        {h.date.slice(0, 10)}: {h.oldWeight.toFixed(1)} → {h.newWeight.toFixed(1)}
                        {' '}
                        <span className="text-muted-foreground/60">
                          ({h.newWeight > h.oldWeight ? 'boost' : h.newWeight < h.oldWeight ? 'reduce' : 'no change'})
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Action buttons row */}
          <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-orange-500/20">
            <Button
              size="sm"
              variant="outline"
              onClick={resetAll}
              disabled={resetting || loading}
              className="h-7 px-3 text-[10px] gap-1.5 border-orange-500/40 text-orange-700 dark:text-orange-300 hover:bg-orange-500/10"
            >
              {resetting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              🔄 Reset na default
            </Button>
            <div className="flex items-center gap-2">
              {dirty && (
                <span className="text-[10px] text-amber-600 dark:text-amber-400 italic">
                  Neshranjene spremembe
                </span>
              )}
              <Button
                size="sm"
                onClick={saveAll}
                disabled={!dirty || saving}
                className="h-7 px-3 text-[10px] gap-1.5 bg-orange-600 hover:bg-orange-700 text-white border-orange-700"
              >
                {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                💾 Shrani uteži
              </Button>
            </div>
          </div>

          {/* Feedback demo form */}
          <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-2 sm:p-2.5 space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-orange-700/80 dark:text-orange-300/80 font-semibold flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              Demo: zabeleži akcijski feedback
            </div>
            <p className="text-[10px] text-muted-foreground leading-snug">
              Simuliraj uporabnikovo oznako akcije. Vsaka 10. akcija per domeno
              sproži re-evaluacijo uteži (boost ×1.1 če rate &gt; 80%, reduce ×0.9
              če rate &lt; 40%).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Domain dropdown */}
              <div>
                <label className="text-[9px] uppercase text-muted-foreground font-semibold block mb-1">
                  Domena
                </label>
                <select
                  value={feedbackDomain}
                  onChange={(e) => setFeedbackDomain(e.target.value as DomainName)}
                  className="h-8 w-full text-xs bg-background/50 border border-orange-500/20 rounded px-2"
                >
                  {DOMAIN_DISPLAY.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.icon} {d.label}
                    </option>
                  ))}
                </select>
              </div>
              {/* Feedback buttons */}
              <div>
                <label className="text-[9px] uppercase text-muted-foreground font-semibold block mb-1">
                  Feedback
                </label>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => recordFeedback('executed')}
                    disabled={recording}
                    className="h-8 text-[11px] font-bold rounded border bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    ✅ Executed
                  </button>
                  <button
                    type="button"
                    onClick={() => recordFeedback('rejected')}
                    disabled={recording}
                    className="h-8 text-[11px] font-bold rounded border bg-red-500/15 border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-500/25 disabled:opacity-50"
                  >
                    ❌ Rejected
                  </button>
                </div>
              </div>
            </div>
            <div className="text-[9px] text-muted-foreground italic">
              POST /api/ai/brain/weights &#123; action: &apos;record&apos;, domain, feedback &#125;
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- v8.29: Draft Queue card (slate/blue-gray-tinted, closed feedback loop) ---
//
// v8.29 NEW: 📋 Draft Queue — ACTION layer (Intelligence phase CULMINATION).
// Each Master Brain TOP 5 action becomes a "draft" row in the queue. When the
// user clicks ✅ Izvedel or ❌ Zavrnil (on the Master Brain banner), the draft
// status changes AND recordActionFeedback (v8.28) is called → adaptive weights
// re-evaluate. This card shows:
//   - Stats row: total pending / approved / executed / rejected / expired counts
//   - Filter bar: status dropdown + domain dropdown (filters the list below)
//   - Draft list (last 30, max-h-96 overflow-y-auto):
//       rank badge + domain icon + action text + status pill + ✅/❌ (if pending)
//       + timestamp (createdAt)
//   - Per-domain execution rates (7 rows, mini horizontal bars like Adaptive Weights)
//   - Osveži button + Počisti expired button (calls /api/cron/cleanup-drafts)
//
// Slate/blue-gray gradient distinguishes from:
//   - Adaptive Weights (orange) — the WEIGHTS / CONFIG side of the feedback loop
//   - Risk Profile (violet) — user's stated preferences
//   - This card (slate) — the DECISION LEDGER (history of past decisions)

export function DraftQueueCard() {
  const [data, setData] = useState<DraftQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Filters (local UI state — passed to API on next fetch)
  const [statusFilter, setStatusFilter] = useState<DraftStatus | 'all'>('all');
  const [domainFilter, setDomainFilter] = useState<DomainName | 'all'>('all');
  // Per-draft patching state (for inline ✅/❌ buttons in the list)
  const [patchingId, setPatchingId] = useState<string | null>(null);

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '30', days: '30' });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (domainFilter !== 'all') params.set('domain', domainFilter);
      const res = await fetch(`/api/ai/brain/drafts?${params.toString()}`, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DraftQueueResponse;
      if (!json?.ok) throw new Error('Draft Queue API ni vrnil rezultata');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, domainFilter]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  // PATCH a draft from the inline ✅/❌ button in the list (pending drafts only)
  const patchDraftInline = useCallback(async (draftId: string, status: 'executed' | 'rejected') => {
    setPatchingId(draftId);
    try {
      const res = await fetch(`/api/ai/brain/drafts/${encodeURIComponent(draftId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      const emoji = status === 'executed' ? '✅' : '❌';
      const slovenian = status === 'executed' ? 'izvedena' : 'zavrnjena';
      const feedbackNote = json.feedbackRecorded
        ? ` · sistem se uči (${json.feedbackResult?.adjusted ? `utež ${json.feedbackResult.oldWeight} → ${json.feedbackResult.newWeight}` : 'utež nespremenjena'})`
        : '';
      toast.success(`${emoji} Akcija označena kot ${slovenian}${feedbackNote}`);
      await fetchDrafts();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri posodobitvi drafta');
    } finally {
      setPatchingId(null);
    }
  }, [fetchDrafts]);

  // Trigger cleanup cron — deletes old (executed/rejected/expired, >90 days)
  const triggerCleanup = useCallback(async () => {
    try {
      const res = await fetch('/api/cron/cleanup-drafts', { method: 'GET' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success(`🧹 Počiščeno: ${json.deleted ?? 0} starih draftov`);
      await fetchDrafts();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri cleanup');
    }
  }, [fetchDrafts]);

  return (
    <div className="rounded-xl border-2 border-slate-500/40 bg-gradient-to-br from-slate-500/15 via-slate-400/10 to-zinc-500/5 p-3 sm:p-4 shadow-sm">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardList className="w-5 h-5 text-slate-600 dark:text-slate-300 shrink-0" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            📋 Draft Queue
          </span>
          <Badge variant="outline" className="text-[10px] border-slate-500/50 text-slate-700 dark:text-slate-300 shrink-0 font-bold">
            v8.29
          </Badge>
          <Badge variant="outline" className="text-[9px] border-slate-500/30 text-slate-700/80 dark:text-slate-300/80 shrink-0">
            ACTION · CLOSED LOOP
          </Badge>
        </div>
        <button
          onClick={fetchDrafts}
          disabled={loading}
          className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-2.5 h-2.5', loading && 'animate-spin')} />
          Osveži
        </button>
      </div>

      {/* Subtitle */}
      <p className="text-[11px] sm:text-xs text-slate-700/80 dark:text-slate-300/80 mb-2.5 leading-snug">
        Zgodovina odločitev za vsako TOP 5 Master Brain akcijo. Ko klikneš
        &quot;Izvedel&quot; ali &quot;Zavrnil&quot;, se odločitev shrani sem
        in avtomatsko pokliče <code className="px-1 bg-slate-500/10 rounded">recordActionFeedback</code> (v8.28) —
        adaptive weights se naučijo iz tvojega vedenja.
      </p>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-slate-500/10" />
          <Skeleton className="h-3 w-3/4 bg-slate-500/10" />
          <Skeleton className="h-16 w-full bg-slate-500/10" />
          <Skeleton className="h-16 w-full bg-slate-500/10" />
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchDrafts} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && data && (
        <div className="space-y-3">
          {/* Stats row — 5 color-coded pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className={cn('text-[10px]', draftStatusColor('pending'))}>
              {data.stats.pending} čaka
            </Badge>
            <Badge variant="outline" className={cn('text-[10px]', draftStatusColor('approved'))}>
              {data.stats.approved} odobrenih
            </Badge>
            <Badge variant="outline" className={cn('text-[10px]', draftStatusColor('executed'))}>
              {data.stats.executed} izvedenih
            </Badge>
            <Badge variant="outline" className={cn('text-[10px]', draftStatusColor('rejected'))}>
              {data.stats.rejected} zavrnjenih
            </Badge>
            <Badge variant="outline" className={cn('text-[10px]', draftStatusColor('expired'))}>
              {data.stats.expired} poteklih
            </Badge>
            {data.stats.executed + data.stats.rejected > 0 && (
              <Badge variant="outline" className="text-[10px] border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300">
                execution rate: {Math.round(data.stats.executionRate * 100)}%
              </Badge>
            )}
          </div>

          {/* Filter bar */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-slate-500/20 bg-slate-500/5 p-1.5">
              <label className="text-[9px] uppercase text-muted-foreground font-semibold block mb-1 flex items-center gap-1">
                <Filter className="w-2.5 h-2.5" /> Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as DraftStatus | 'all')}
                className="h-7 w-full text-xs bg-background/50 border border-slate-500/20 rounded px-1.5"
              >
                <option value="all">Vsi statusi</option>
                <option value="pending">⏳ Čaka</option>
                <option value="approved">👍 Odobreno</option>
                <option value="executed">✅ Izvedeno</option>
                <option value="rejected">❌ Zavrnjeno</option>
                <option value="expired">⌛ Poteklo</option>
              </select>
            </div>
            <div className="rounded border border-slate-500/20 bg-slate-500/5 p-1.5">
              <label className="text-[9px] uppercase text-muted-foreground font-semibold block mb-1 flex items-center gap-1">
                <Filter className="w-2.5 h-2.5" /> Domena
              </label>
              <select
                value={domainFilter}
                onChange={(e) => setDomainFilter(e.target.value as DomainName | 'all')}
                className="h-7 w-full text-xs bg-background/50 border border-slate-500/20 rounded px-1.5"
              >
                <option value="all">Vse domene</option>
                {DOMAIN_DISPLAY.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.icon} {d.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Draft list — max-h-96 with custom scrollbar */}
          <div className="max-h-96 overflow-y-auto rounded border border-slate-500/20 bg-slate-500/[0.03]">
            {data.drafts.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground italic">
                Ni draftov za izbrane filtre. Klikni &quot;Osveži Master Brain&quot; zgoraj
                da se avtomatsko kreirajo novi.
              </div>
            ) : (
              <div className="divide-y divide-slate-500/10">
                {data.drafts.map((d) => {
                  const dm = DOMAIN_LABELS[d.domain] ?? { icon: '•', label: d.domain, color: 'text-foreground' };
                  const ts = (() => {
                    try {
                      const dt = new Date(d.createdAt);
                      const date = dt.toLocaleDateString('sl-SI');
                      const time = dt.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
                      return `${date} ${time}`;
                    } catch {
                      return '—';
                    }
                  })();
                  return (
                    <div
                      key={d.id}
                      className={cn(
                        'p-2 flex items-start gap-2 text-[10px] sm:text-[11px] leading-snug transition-colors',
                        d.status === 'executed' && 'bg-emerald-500/[0.04]',
                        d.status === 'rejected' && 'bg-red-500/[0.04]',
                      )}
                    >
                      <span className="font-bold text-slate-700 dark:text-slate-300 shrink-0 w-4 text-center">
                        {d.rank}.
                      </span>
                      <span className="shrink-0" title={dm.label}>
                        {dm.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="font-medium truncate">{d.action}</span>
                        </div>
                        <div className="text-[9px] text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="w-2 h-2" />
                          {ts}
                          <span className="text-muted-foreground/60">·</span>
                          <span className="font-mono">{d.signal}</span>
                          <span className="text-muted-foreground/60">·</span>
                          <span className={cn('font-bold', confidenceColor(d.confidence))}>{d.confidence}</span>
                        </div>
                      </div>
                      <Badge variant="outline" className={cn('text-[9px] h-4 px-1 shrink-0', draftStatusColor(d.status))}>
                        {draftStatusLabel(d.status)}
                      </Badge>
                      {/* Inline ✅/❌ buttons — only for pending drafts */}
                      {d.status === 'pending' && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => patchDraftInline(d.id, 'executed')}
                            disabled={patchingId === d.id}
                            aria-label="Označi kot izvedeno"
                            title="v8.29: Označi kot izvedeno — sistem se bo naučil"
                            className="text-[9px] px-1 py-0.5 rounded border bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-400 disabled:opacity-40"
                          >
                            <Check className="w-2.5 h-2.5" />
                          </button>
                          <button
                            onClick={() => patchDraftInline(d.id, 'rejected')}
                            disabled={patchingId === d.id}
                            aria-label="Označi kot zavrnjeno"
                            title="v8.29: Označi kot zavrnjeno — sistem se bo naučil"
                            className="text-[9px] px-1 py-0.5 rounded border bg-red-500/10 border-red-500/30 hover:bg-red-500/25 text-red-700 dark:text-red-400 disabled:opacity-40"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Per-domain execution rates — mini section */}
          {data.domainStats.length > 0 && (
            <div className="rounded-lg border border-slate-500/20 bg-slate-500/[0.03] p-2 space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-slate-700/80 dark:text-slate-300/80 font-semibold flex items-center gap-1">
                <Target className="w-2.5 h-2.5" />
                Per-domain execution rate
                <span className="text-[8px] normal-case font-normal text-muted-foreground italic ml-auto">
                  klik na domeno za filter
                </span>
              </div>
              {data.domainStats.map((ds) => {
                const dm = DOMAIN_LABELS[ds.domain] ?? { icon: '•', label: ds.domain, color: 'text-foreground' };
                const rate = ds.executionRate;
                const total = ds.executed + ds.rejected;
                const isSelected = domainFilter === ds.domain;
                return (
                  <button
                    key={ds.domain}
                    onClick={() => setDomainFilter(isSelected ? 'all' : ds.domain)}
                    className={cn(
                      'w-full flex items-center gap-2 text-[10px] p-1 rounded transition-colors text-left',
                      isSelected ? 'bg-slate-500/15 ring-1 ring-slate-500/40' : 'hover:bg-slate-500/10',
                    )}
                    title={`Filter by ${dm.label} domain`}
                  >
                    <span className="shrink-0 w-3 text-center">{dm.icon}</span>
                    <span className="shrink-0 w-16 font-medium">{dm.label}</span>
                    <div className="flex-1 h-1.5 bg-background/60 rounded overflow-hidden">
                      <div
                        className={cn('h-full transition-all', rateColor(rate))}
                        style={{ width: `${Math.round(rate * 100)}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-[9px] text-muted-foreground font-mono w-20 text-right">
                      {total > 0 ? `${Math.round(rate * 100)}% (${ds.executed}/${total})` : '—'}
                      {ds.pending > 0 && (
                        <span className="text-blue-600 dark:text-blue-400"> · {ds.pending}⏳</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Action buttons row */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-500/20">
            <span className="text-[9px] text-muted-foreground italic">
              GET /api/ai/brain/drafts?limit=30&amp;days=30 · PATCH /api/ai/brain/drafts/&#123;id&#125;
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={triggerCleanup}
              className="h-7 px-3 text-[10px] gap-1.5 border-slate-500/40 text-slate-700 dark:text-slate-300 hover:bg-slate-500/10"
            >
              <Trash2 className="w-3 h-3" />
              Počisti expired
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- v8.30: Safe Auto-pilot card (purple/indigo-tinted, Automation phase) ---
//
// v8.30 NEW: 🤖 Safe Auto-pilot — AUTOMATION PHASE STARTED.
// Problem: Master Brain (v8.22) recommends TOP 5 actions, user must manually
// execute each one. For LOW-risk actions (e.g. "send Telegram reminder",
// "relist an item") this is tedious. v8.30 adds Safe Auto-pilot — automatically
// executes ONLY LOW-risk actions that meet ALL 8 safety rules:
//   1. autoPilotEnabled=true (master switch — default OFF)
//   2. autoPilotMode='safe' (v8.31 will add 'aggressive')
//   3. User risk tolerance != 'conservative' (v8.24)
//   4. confidence='LOW' (HIGH/MEDIUM always need manual)
//   5. expectedUpliftEUR < 100€
//   6. domain != 'risk' (risk mitigation needs human judgment)
//   7. today's auto-executed count < dailyLimit (default 5)
//   8. today's auto-executed budget + this draft's uplift < dailyBudgetEUR (default 500€)
//
// Card features:
//   - Master switch toggle (Auto-pilot: ON/OFF)
//   - Config sliders (when enabled): daily limit (1-10), daily budget (100-2000€)
//   - Mode selector: "Safe (LOW risk only)" — "Aggressive" disabled (v8.31)
//   - Today's stats: auto-executed count + budget used (with progress bars)
//   - All-time stats: total auto-executed + total rolled back + rollback rate %
//   - Action buttons: ▶️ Zaženi zdaj (manual trigger) + ℹ️ Zgodovina (last 10)
//   - History view: each auto-executed draft has ↩️ Razveljavi button
//   - Safety info box (always visible): 8 rules listed
//
// Purple/indigo-tinted gradient distinguishes from:
//   - Draft Queue (slate) — DECISION LEDGER
//   - Adaptive Weights (orange) — WEIGHTS / CONFIG
//   - Scenario Brain (rose/pink) — WHAT IF?
//   - This card (purple/indigo) — AUTONOMOUS EXECUTION

export function AutoPilotCard() {
  const [stats, setStats] = useState<AutoPilotStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // History modal
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<AutoPilotHistoryDraft[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Pending config edits (sliders local state, debounced save)
  const [dailyLimitInput, setDailyLimitInput] = useState<number>(5);
  const [dailyBudgetInput, setDailyBudgetInput] = useState<number>(500);
  // In-flight action states
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState(false);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  // v8.31: Aggressive mode + anomaly state
  const [aggressivePending, setAggressivePending] = useState(false); // local UI: pending confirmation shown
  const [aggressiveMsg, setAggressiveMsg] = useState<string | null>(null); // last enable message
  const [togglingMode, setTogglingMode] = useState(false); // disabling aggressive / enabling
  const [clearingAnomaly, setClearingAnomaly] = useState(false);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/auto-pilot', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as AutoPilotStatsResponse;
      if (!json?.ok) throw new Error('Auto-pilot API ni vrnil rezultata');
      setStats(json);
      setDailyLimitInput(json.config.dailyLimit);
      setDailyBudgetInput(json.config.dailyBudgetEUR);
      // v8.31: Sync aggressive pending state from server (aggressiveConfirmedAt
      // is set by first enable call, cleared on second call or expiry).
      setAggressivePending(Boolean(json.config.aggressiveConfirmedAt));
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Toggle master switch (POST config { enabled })
  const toggleEnabled = useCallback(async () => {
    if (!stats) return;
    setToggling(true);
    const newEnabled = !stats.config.enabled;
    try {
      const res = await fetch('/api/ai/brain/auto-pilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'config',
          config: { enabled: newEnabled },
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      toast.success(
        newEnabled
          ? '🤖 Auto-pilot VKLJUČEN — sistem samodejno izvaja LOW-risk akcije'
          : '🤖 Auto-pilot IZKLJUČEN — vse akcije zahtevajo ročni ✅ Izvedel',
      );
      await fetchStats();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri preklopu auto-pilot-a');
    } finally {
      setToggling(false);
    }
  }, [stats, fetchStats]);

  // Save config (dailyLimit + dailyBudgetEUR) — POST config
  const saveConfig = useCallback(async () => {
    setToggling(true);
    try {
      const res = await fetch('/api/ai/brain/auto-pilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'config',
          config: {
            dailyLimit: dailyLimitInput,
            dailyBudgetEUR: dailyBudgetInput,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      toast.success(
        `💾 Config shranjen: ${dailyLimitInput}/dan, ${dailyBudgetInput}€/dan budget`,
      );
      await fetchStats();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri shranjevanju config-a');
    } finally {
      setToggling(false);
    }
  }, [dailyLimitInput, dailyBudgetInput, fetchStats]);

  // Manual trigger — POST run
  const runNow = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/ai/brain/auto-pilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run' }),
      });
      const json = (await res.json()) as AutoPilotRunResponse;
      if (!res.ok || !json?.ok) {
        throw new Error((json as any)?.error ?? `HTTP ${res.status}`);
      }
      const executedMsg =
        json.autoExecuted > 0
          ? ` · auto-executed: ${json.autoExecuted} (${json.executedDrafts.map((d) => `#${d.id.slice(0, 6)}`).join(', ') || '—'})`
          : ' · 0 auto-executed';
      const skippedMsg = json.skipped > 0 ? ` · skipped: ${json.skipped}` : '';
      toast.success(
        `▶️ Auto-pilot tekel: preveril ${json.checked} draft-ov${executedMsg}${skippedMsg}`,
      );
      await fetchStats();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri zagonu auto-pilot-a');
    } finally {
      setRunning(false);
    }
  }, [fetchStats]);

  // Fetch history (last 10 auto-executed drafts) — used by history modal
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/ai/brain/drafts?limit=30&days=30&status=executed', {
        method: 'GET',
      });
      // Note: drafts endpoint doesn't filter by autoExecuted directly —
      // we filter client-side. This is intentional — reuses the existing
      // drafts endpoint without adding a new one. (The auto-pilot/rollback
      // route is the only auto-pilot-specific fetch besides GET/POST main.)
      const json = (await res.json()) as any;
      if (!res.ok || !json?.ok) throw new Error(`HTTP ${res.status}`);
      // Filter: only drafts where autoExecuted=true (v8.30 field).
      // The drafts endpoint returns DraftRow[] which may not include the
      // autoExecuted field — we accept both shapes (autoExecuted may be
      // missing → we treat undefined as false, which is fine since
      // pre-v8.30 drafts are never auto-executed).
      const auto = (json.drafts as any[]).filter((d) => d.autoExecuted === true);
      setHistory(auto as AutoPilotHistoryDraft[]);
    } catch (e: any) {
      // Fallback: show empty history with error toast
      toast.error(e?.message ?? 'Napaka pri pridobivanju zgodovine');
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Rollback an auto-executed draft — POST /rollback
  const rollbackDraft = useCallback(
    async (draftId: string) => {
      setRollingBackId(draftId);
      try {
        const res = await fetch('/api/ai/brain/auto-pilot/rollback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            draftId,
            reason: `User rollback iz Auto-pilot UI @ ${new Date().toISOString()}`,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error ?? `HTTP ${res.status}`);
        }
        toast.success(
          `↩️ Razveljavljeno — sistem undo-a learning (recordActionFeedback 'rejected')`,
        );
        // Refresh history + stats
        await fetchHistory();
        await fetchStats();
      } catch (e: any) {
        toast.error(e?.message ?? 'Napaka pri razveljavitvi');
      } finally {
        setRollingBackId(null);
      }
    },
    [fetchHistory, fetchStats],
  );

  // v8.31: Enable aggressive mode — double confirmation flow.
  // First click → server sets aggressiveConfirmedAt, returns confirmed=false.
  // Second click within 5 min → server confirms, returns confirmed=true + mode='aggressive'.
  const handleEnableAggressive = useCallback(async () => {
    setTogglingMode(true);
    setAggressiveMsg(null);
    try {
      const res = await fetch('/api/ai/brain/auto-pilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enable_aggressive' }),
      });
      const json = (await res.json()) as EnableAggressiveResponse;
      if (!res.ok || !json?.ok) {
        throw new Error((json as any)?.error ?? `HTTP ${res.status}`);
      }
      setAggressiveMsg(json.message);
      if (json.confirmed) {
        // Second confirmation succeeded — aggressive mode now active.
        toast.success(json.message);
        setAggressivePending(false);
      } else {
        // First confirmation — pending second click within 5 min.
        toast.info(json.message);
        setAggressivePending(true);
      }
      await fetchStats();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri vklopu aggressive mode');
    } finally {
      setTogglingMode(false);
    }
  }, [fetchStats]);

  // v8.31: Disable aggressive mode — immediate revert to safe (single click).
  const handleDisableAggressive = useCallback(async () => {
    setTogglingMode(true);
    setAggressiveMsg(null);
    try {
      const res = await fetch('/api/ai/brain/auto-pilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disable_aggressive' }),
      });
      const json = (await res.json()) as DisableAggressiveResponse;
      if (!res.ok || !json?.ok) {
        throw new Error((json as any)?.error ?? `HTTP ${res.status}`);
      }
      toast.success('🛡️ Aggressive mode izklopljen — vrnjen v safe mode (LOW risk only)');
      setAggressivePending(false);
      await fetchStats();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri izklopu aggressive mode');
    } finally {
      setTogglingMode(false);
    }
  }, [fetchStats]);

  // v8.31: Clear anomaly suspension — user manually re-enables after review.
  const handleClearAnomaly = useCallback(async () => {
    setClearingAnomaly(true);
    try {
      const res = await fetch('/api/ai/brain/auto-pilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear_anomaly' }),
      });
      const json = (await res.json()) as ClearAnomalyResponse;
      if (!res.ok || !json?.ok) {
        throw new Error((json as any)?.error ?? `HTTP ${res.status}`);
      }
      toast.success(json.message);
      await fetchStats();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri razveljavitvi suspenzije');
    } finally {
      setClearingAnomaly(false);
    }
  }, [fetchStats]);

  const enabled = stats?.config.enabled ?? false;
  const mode = stats?.config.mode ?? 'safe';
  const todayAutoExecuted = stats?.today.autoExecuted ?? 0;
  const todayBudgetUsed = stats?.today.budgetUsed ?? 0;
  const todayLimit = stats?.config.dailyLimit ?? 5;
  const todayBudget = stats?.config.dailyBudgetEUR ?? 500;
  const limitPct = Math.min(100, Math.round((todayAutoExecuted / Math.max(1, todayLimit)) * 100));
  const budgetPct = Math.min(100, Math.round((todayBudgetUsed / Math.max(1, todayBudget)) * 100));
  const allTimeTotal = stats?.allTime.totalAutoExecuted ?? 0;
  const allTimeRollback = stats?.allTime.totalRolledBack ?? 0;
  const rollbackRate = stats?.allTime.rollbackRate ?? 0;
  const dirty =
    dailyLimitInput !== todayLimit || dailyBudgetInput !== todayBudget;
  // v8.31: Anomaly detection state — surfaced for the anomaly banner.
  const anomalySuspended = stats?.config.anomalySuspended ?? false;
  const anomalyReason = stats?.config.anomalyReason ?? null;
  const anomalySuspendedAt = stats?.config.anomalySuspendedAt ?? null;
  // v8.31: Hourly counter for "Zadnja ura: N akcij" display.
  const hourlyExecCount = stats?.config.hourlyExecCount ?? 0;
  const hourlyWindowStart = stats?.config.hourlyWindowStart ?? null;
  const isAggressive = mode === 'aggressive';
  // Mode-aware thresholds for display:
  const displayLimit = isAggressive ? 10 : 5;
  const displayBudget = isAggressive ? 2000 : 500;

  return (
    <div
      className={cn(
        'rounded-xl border-2 p-3 sm:p-4 shadow-sm transition-colors',
        anomalySuspended
          ? 'border-red-500/60 bg-gradient-to-br from-red-500/10 via-purple-500/10 to-violet-500/5'
          : isAggressive
            ? 'border-rose-500/50 bg-gradient-to-br from-rose-500/10 via-purple-500/10 to-violet-500/5'
            : 'border-purple-500/40 bg-gradient-to-br from-purple-500/15 via-indigo-500/10 to-violet-500/5',
      )}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="w-5 h-5 text-purple-600 dark:text-purple-300 shrink-0" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            🤖 Auto-pilot
          </span>
          <Badge variant="outline" className="text-[10px] border-purple-500/50 text-purple-700 dark:text-purple-300 shrink-0 font-bold">
            v8.31
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              'text-[9px] shrink-0',
              isAggressive
                ? 'border-rose-500/40 text-rose-700 dark:text-rose-300'
                : 'border-purple-500/30 text-purple-700/80 dark:text-purple-300/80',
            )}
          >
            {anomalySuspended
              ? '⚠️ SUSPENDED · ANOMALY'
              : isAggressive
                ? '🚀 AGGRESSIVE · MEDIUM OK'
                : '🛡️ SAFE · LOW RISK ONLY'}
          </Badge>
        </div>
        <button
          onClick={fetchStats}
          disabled={loading}
          className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-2.5 h-2.5', loading && 'animate-spin')} />
          Osveži
        </button>
      </div>

      {/* Subtitle */}
      <p className="text-[11px] sm:text-xs text-purple-700/80 dark:text-purple-300/80 mb-2.5 leading-snug">
        Samodejno izvaja akcije ki izpolnjujejo VSA 8 varnostna pravila.
        {' '}
        <b className="text-purple-700 dark:text-purple-300">Safe mode</b>: confidence=LOW, uplift
        &lt;100€, limit 5/dan, budget 500€/dan.{' '}
        <b className="text-rose-700 dark:text-rose-300">Aggressive mode</b> (opt-in, double confirm):
        confidence=LOW/MEDIUM, uplift &lt;300€, limit 10/dan, budget 2000€/dan.
        {' '}HIGH confidence in domain=&apos;risk&apos; sta vedno ročno (v8.29).
        {' '}Vsako auto-executed akcijo lahko razveljaviš (↩️ Razveljavi).
      </p>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-purple-500/10" />
          <Skeleton className="h-3 w-3/4 bg-purple-500/10" />
          <Skeleton className="h-16 w-full bg-purple-500/10" />
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchStats} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && stats && (
        <div className="space-y-3">
          {/* v8.31: Anomaly banner — shown at TOP of card when suspended.
              Red, eye-catching, with "Razveljavi suspenzijo" button. */}
          {anomalySuspended && (
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
                  onClick={handleClearAnomaly}
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
          )}

          {/* v8.31: Aggressive mode active banner — shown when mode='aggressive'.
              Red/rose, with toggle-back button. */}
          {!anomalySuspended && isAggressive && (
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
                onClick={handleDisableAggressive}
                disabled={togglingMode}
                className="text-[10px] px-2 py-1 rounded border bg-rose-500/15 border-rose-500/40 hover:bg-rose-500/25 text-rose-700 dark:text-rose-300 shrink-0 disabled:opacity-50 font-semibold"
              >
                🛡️ Nazaj v Safe
              </button>
            </div>
          )}

          {/* v8.31: Aggressive pending confirmation banner — shown after first click.
              Yellow/amber, prompts user to confirm within 5 minutes. */}
          {!anomalySuspended && !isAggressive && aggressivePending && (
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
                onClick={handleEnableAggressive}
                disabled={togglingMode}
                className="text-[10px] px-2 py-1 rounded border bg-amber-500/20 border-amber-500/40 hover:bg-amber-500/30 text-amber-700 dark:text-amber-400 shrink-0 disabled:opacity-50 font-bold"
              >
                ✅ Potrdi
              </button>
            </div>
          )}

          {/* Master switch — big toggle */}
          <div
            className={cn(
              'flex items-center justify-between gap-2 p-2 rounded-lg border',
              enabled
                ? anomalySuspended
                  ? 'bg-red-500/15 border-red-500/40'
                  : isAggressive
                    ? 'bg-rose-500/15 border-rose-500/40'
                    : 'bg-purple-500/15 border-purple-500/40'
                : 'bg-muted/30 border-border',
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Power
                className={cn(
                  'w-4 h-4 shrink-0',
                  enabled
                    ? anomalySuspended
                      ? 'text-red-600 dark:text-red-400'
                      : isAggressive
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-purple-600 dark:text-purple-300'
                    : 'text-muted-foreground',
                )}
              />
              <div className="min-w-0">
                <div className="text-xs font-bold">
                  Auto-pilot: {enabled ? (anomalySuspended ? 'SUSPENDED' : 'ON') : 'OFF'}
                </div>
                <div className="text-[9px] text-muted-foreground">
                  {enabled
                    ? anomalySuspended
                      ? `Mode: ${mode} · SUSPENDED · ${anomalyReason ?? 'anomaly'}`
                      : `Mode: ${mode} · limit ${displayLimit}/dan · budget ${displayBudget}€/dan`
                    : 'Klikni za vklop — samodejno izvaja LOW/MEDIUM-risk akcije'}
                </div>
              </div>
            </div>
            <button
              onClick={toggleEnabled}
              disabled={toggling}
              role="switch"
              aria-checked={enabled}
              aria-label="Toggle auto-pilot master switch"
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50',
                enabled
                  ? anomalySuspended
                    ? 'bg-red-600'
                    : isAggressive
                      ? 'bg-rose-600'
                      : 'bg-purple-600'
                  : 'bg-muted-foreground/30',
                toggling && 'opacity-50 cursor-wait',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow ring-0 transition duration-200 ease-in-out',
                  enabled ? 'translate-x-5' : 'translate-x-0',
                )}
              />
            </button>
          </div>

          {/* Config sliders — only when enabled */}
          {enabled && (
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
                  onChange={(e) => setDailyLimitInput(Number(e.target.value))}
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
                  onChange={(e) => setDailyBudgetInput(Number(e.target.value))}
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
                    onClick={handleDisableAggressive}
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
                    onClick={handleEnableAggressive}
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

              {/* Save config button (only when dirty) */}
              {dirty && (
                <div className="flex items-center justify-end gap-1 pt-1 border-t border-purple-500/20">
                  <button
                    onClick={() => {
                      setDailyLimitInput(todayLimit);
                      setDailyBudgetInput(todayBudget);
                    }}
                    className="text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:bg-muted/50"
                  >
                    Prekliči
                  </button>
                  <button
                    onClick={saveConfig}
                    disabled={toggling}
                    className="text-[10px] px-2 py-1 rounded border bg-purple-500/20 border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-500/30 font-semibold disabled:opacity-50"
                  >
                    💾 Shrani config
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Today's stats — with progress bars + v8.31 hourly counter */}
          <div className="rounded-lg border border-purple-500/20 bg-purple-500/[0.03] p-2 space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-purple-700/80 dark:text-purple-300/80 font-semibold flex items-center gap-1">
              <Activity className="w-2.5 h-2.5" />
              Danes
              <span className="text-[8px] normal-case font-normal text-muted-foreground italic ml-auto">
                zadnji run: {stats.config.lastRunAt ? new Date(stats.config.lastRunAt).toLocaleString('sl-SI') : '—'}
              </span>
            </div>
            {/* v8.31: Mode-aware stats line */}
            <div className="text-[10px] text-muted-foreground leading-snug">
              Danes: <span className="font-mono font-bold text-purple-700 dark:text-purple-300">{todayAutoExecuted}/{displayLimit}</span> akcij ({mode}) ·{' '}
              <span className="font-mono font-bold text-purple-700 dark:text-purple-300">{todayBudgetUsed.toFixed(0)}€/{displayBudget}€</span> budget
            </div>
            {/* v8.31: Hourly counter line */}
            <div className="text-[9px] text-muted-foreground/80 italic">
              Zadnja ura: <span className="font-mono font-bold">{hourlyExecCount}</span> akcij
              {hourlyExecCount >= 6 && (
                <span className="ml-1 text-amber-600 dark:text-amber-400 font-semibold">
                  · ⚠️ blizu anomaly threshold (8)
                </span>
              )}
              {hourlyWindowStart && (
                <span className="ml-1 text-[8px]">
                  (od {new Date(hourlyWindowStart).toLocaleTimeString('sl-SI')})
                </span>
              )}
            </div>
            {/* Limit progress */}
            <div>
              <div className="flex items-center justify-between text-[10px] mb-0.5">
                <span className="text-muted-foreground">Limit</span>
                <span className="font-mono font-bold">
                  {todayAutoExecuted}/{todayLimit} akcij
                </span>
              </div>
              <div className="h-1.5 bg-background/60 rounded overflow-hidden">
                <div
                  className={cn(
                    'h-full transition-all',
                    limitPct >= 100 ? 'bg-red-500' : limitPct >= 80 ? 'bg-amber-500' : 'bg-purple-500',
                  )}
                  style={{ width: `${limitPct}%` }}
                />
              </div>
            </div>
            {/* Budget progress */}
            <div>
              <div className="flex items-center justify-between text-[10px] mb-0.5">
                <span className="text-muted-foreground">Budget</span>
                <span className="font-mono font-bold">
                  {todayBudgetUsed.toFixed(0)}€/{todayBudget}€
                </span>
              </div>
              <div className="h-1.5 bg-background/60 rounded overflow-hidden">
                <div
                  className={cn(
                    'h-full transition-all',
                    budgetPct >= 100 ? 'bg-red-500' : budgetPct >= 80 ? 'bg-amber-500' : 'bg-purple-500',
                  )}
                  style={{ width: `${budgetPct}%` }}
                />
              </div>
            </div>
          </div>

          {/* All-time stats */}
          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded border border-purple-500/20 bg-purple-500/[0.03] p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Skupno auto</div>
              <div className="text-base font-bold text-purple-700 dark:text-purple-300 font-mono">
                {allTimeTotal}
              </div>
            </div>
            <div className="rounded border border-purple-500/20 bg-purple-500/[0.03] p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Razveljavljeno</div>
              <div className="text-base font-bold text-amber-600 dark:text-amber-400 font-mono">
                {allTimeRollback}
              </div>
            </div>
            <div className="rounded border border-purple-500/20 bg-purple-500/[0.03] p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Rollback rate</div>
              <div
                className={cn(
                  'text-base font-bold font-mono',
                  rollbackRate > 20
                    ? 'text-red-600 dark:text-red-400'
                    : rollbackRate > 5
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-emerald-600 dark:text-emerald-400',
                )}
              >
                {rollbackRate.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Action buttons row */}
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              size="sm"
              onClick={runNow}
              disabled={running || anomalySuspended}
              className="h-8 text-[11px] font-bold bg-purple-600 hover:bg-purple-700 text-white border-purple-600 gap-1.5 disabled:opacity-50"
            >
              {running ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {running ? 'Teče...' : '▶️ Zaženi zdaj'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowHistory(true);
                fetchHistory();
              }}
              className="h-8 text-[11px] gap-1.5 border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-500/10"
            >
              <History className="w-3 h-3" />
              ℹ️ Zgodovina
            </Button>
          </div>

          {/* v8.31: Threshold comparison box — always visible info card
              showing the difference between Safe and Aggressive modes. */}
          <div className="rounded-lg border border-purple-500/30 bg-purple-500/[0.05] p-2 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-purple-700/80 dark:text-purple-300/80 font-semibold flex items-center gap-1">
              <Info className="w-2.5 h-2.5" />
              Primerjava modal (Safe vs Aggressive)
            </div>
            <div className="grid grid-cols-2 gap-2 text-[9px]">
              {/* Safe column */}
              <div className={cn('rounded border p-1.5 space-y-0.5', isAggressive ? 'border-border bg-muted/30 opacity-70' : 'border-purple-500/40 bg-purple-500/10')}>
                <div className="font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1">
                  🛡️ Safe {!isAggressive && '✓'}
                </div>
                <div className="text-muted-foreground">confidence: LOW</div>
                <div className="text-muted-foreground">uplift &lt; 100€</div>
                <div className="text-muted-foreground">limit 5/dan</div>
                <div className="text-muted-foreground">budget 500€/dan</div>
                <div className="text-muted-foreground">domain != risk</div>
                <div className="text-muted-foreground">HIGH = manual</div>
              </div>
              {/* Aggressive column */}
              <div className={cn('rounded border p-1.5 space-y-0.5', isAggressive ? 'border-rose-500/40 bg-rose-500/10' : 'border-border bg-muted/30 opacity-70')}>
                <div className="font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1">
                  🚀 Aggressive {isAggressive && '✓'}
                </div>
                <div className="text-muted-foreground">confidence: LOW, MEDIUM</div>
                <div className="text-muted-foreground">uplift &lt; 300€</div>
                <div className="text-muted-foreground">limit 10/dan</div>
                <div className="text-muted-foreground">budget 2000€/dan</div>
                <div className="text-muted-foreground">domain != risk (oba)</div>
                <div className="text-muted-foreground">HIGH = manual (oba)</div>
              </div>
            </div>
            <div className="text-[8px] text-muted-foreground italic pt-1 border-t border-purple-500/20">
              Anomaly: če &gt;8 akcij v 1 uri → suspendiran (oba modal).
              Rollback: ✅ razveljavi vsako auto-akcijo (+ undo learning).
            </div>
          </div>

          {/* Safety info box — always visible */}
          <div className="rounded-lg border border-purple-500/30 bg-purple-500/[0.05] p-2 space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-purple-700/80 dark:text-purple-300/80 font-semibold flex items-center gap-1">
              <Lock className="w-2.5 h-2.5" />
              Varnostna pravila (8 — mode-aware)
            </div>
            <ol className="text-[9px] text-muted-foreground space-y-0.5 list-decimal list-inside">
              <li>Auto-pilot enabled (master switch)</li>
              <li>Mode = &apos;safe&apos; ali &apos;aggressive&apos; (V2 — oba veljavna)</li>
              <li>User risk tolerance != conservative (oba modal)</li>
              <li>Confidence dovoljen za mode (safe: LOW; aggressive: LOW+MEDIUM; HIGH vedno ročno)</li>
              <li>expectedUpliftEUR &lt; mode threshold (safe: 100€, aggressive: 300€)</li>
              <li>Domain != &apos;risk&apos; (risk mitigation = human judgment — oba)</li>
              <li>Daily limit ≤ {displayLimit} akcij/dan ({mode})</li>
              <li>Daily budget ≤ {displayBudget}€/dan ({mode})</li>
            </ol>
          </div>

          {/* Footer info */}
          <div className="flex items-center justify-between pt-1 border-t border-purple-500/20">
            <span className="text-[9px] text-muted-foreground italic">
              GET + POST /api/ai/brain/auto-pilot · cron /api/cron/auto-pilot
            </span>
            <span className="text-[9px] text-muted-foreground/60">
              POST actions: run, config, enable_aggressive, disable_aggressive, clear_anomaly
            </span>
          </div>
        </div>
      )}

      {/* History Modal */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Bot className="w-4 h-4 text-purple-600 dark:text-purple-300" />
              🤖 Auto-pilot Zgodovina
            </DialogTitle>
            <DialogDescription>
              Zadnjih 10 auto-executed akcij. Vsako lahko razveljaviš (↩️ Razveljavi) —
              to tudi undo-a learning preko recordActionFeedback z &apos;rejected&apos;.
            </DialogDescription>
          </DialogHeader>

          {historyLoading && (
            <div className="space-y-2 py-4">
              <Skeleton className="h-12 w-full bg-purple-500/10" />
              <Skeleton className="h-12 w-full bg-purple-500/10" />
              <Skeleton className="h-12 w-full bg-purple-500/10" />
            </div>
          )}

          {!historyLoading && history && history.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <Bot className="w-8 h-8 mx-auto mb-2 text-purple-500/50" />
              Še ni auto-executed akcij. Vklopi auto-pilot in zaženi run, ali
              počakaj na hourly cron.
            </div>
          )}

          {!historyLoading && history && history.length > 0 && (
            <div className="space-y-2">
              {history.map((d) => {
                const dm = DOMAIN_LABELS[d.domain] ?? { icon: '•', label: d.domain, color: 'text-foreground' };
                const executedAtStr = d.executedAt
                  ? (() => {
                      try {
                        return new Date(d.executedAt).toLocaleString('sl-SI');
                      } catch {
                        return '—';
                      }
                    })()
                  : '—';
                return (
                  <div
                    key={d.id}
                    className={cn(
                      'rounded-lg border p-2 text-xs',
                      d.rolledBack
                        ? 'border-amber-500/30 bg-amber-500/[0.04]'
                        : 'border-purple-500/20 bg-purple-500/[0.03]',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 w-3 text-center font-bold text-muted-foreground">
                        {d.rank}.
                      </span>
                      <span className="shrink-0" title={dm.label}>
                        {dm.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{d.action}</div>
                        <div className="text-[9px] text-muted-foreground flex items-center gap-1 mt-0.5 flex-wrap">
                          <Clock className="w-2 h-2" />
                          {executedAtStr}
                          <span className="text-muted-foreground/60">·</span>
                          <span className="font-mono">{d.signal}</span>
                          <span className="text-muted-foreground/60">·</span>
                          <span className="font-mono text-purple-600 dark:text-purple-400">
                            +{d.expectedUpliftEUR}€
                          </span>
                        </div>
                        {d.rolledBack && (
                          <div className="mt-1 text-[9px] text-amber-700 dark:text-amber-400 italic">
                            ↩️ Razveljavljeno{d.rollbackReason ? `: ${d.rollbackReason.slice(0, 80)}` : ''}
                          </div>
                        )}
                        {d.autoPilotReason && !d.rolledBack && (
                          <details className="mt-1">
                            <summary className="text-[9px] text-purple-700/70 dark:text-purple-300/70 cursor-pointer">
                              ℹ️ Audit (8 pravil)
                            </summary>
                            <div className="text-[8px] text-muted-foreground mt-0.5 font-mono whitespace-pre-wrap">
                              {d.autoPilotReason.split('; ').map((r, i) => (
                                <div
                                  key={i}
                                  className={cn(
                                    r.startsWith('PASS')
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-red-600 dark:text-red-400',
                                  )}
                                >
                                  {r}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                      {!d.rolledBack && (
                        <button
                          onClick={() => rollbackDraft(d.id)}
                          disabled={rollingBackId === d.id}
                          className="text-[9px] px-2 py-1 rounded border bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/25 text-amber-700 dark:text-amber-400 shrink-0 flex items-center gap-1 disabled:opacity-50"
                        >
                          {rollingBackId === d.id ? (
                            <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                          ) : (
                            <Undo2 className="w-2.5 h-2.5" />
                          )}
                          Razveljavi
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Outer card wrapper (v8.30 Auto-pilot + v8.29 Draft Queue + v8.28 Adaptive + v8.27 Scenario + v8.26 Intelligence + v8.25 Accuracy + v8.24 Personal + v8.23 Validation + v8.22 Master + v8.15-v8.21 7 Domains) --------------------
//
// v8.28 NEW: Adaptive Domain Weights — feedback loop. Master Brain (v8.22) used
// HARDCODED domain weights. v8.28 makes them adaptive — stored per-user in
// Settings.adaptiveDomainWeights (JSON). System learns from REVEALED preferences
// (which actions user actually executes vs rejects). Card is bright orange-tinted,
// sits BETWEEN ScenarioBrainCard and the 7 Domain Brain sections. 7 sliders (one
// per domain, range 0.5-2.0) + execution stats + rate bar + history + reset
// button + save button + feedback demo form.
//
// v8.27 NEW: Scenario Brain — "What if?" simulator. Generates 3 preset scenarios
// (conservative/balanced/aggressive) and runs Master Brain for each in parallel
// (3× Promise.all). Shows side-by-side comparison table + recommendation +
// custom scenario input form. Rose/pink-tinted card sits BETWEEN Master Brain
// banner and the 7 Domain Brain sections.
//
// v8.26 NEW PHASE: Intelligence — "Zakaj Master Brain priporoča TOČNO to akcijo?"
// Master Brain banner response now includes `explanations` (5 ActionExplanation).
// Each TOP action gets an "ℹ️ Zakaj?" toggle that expands reasoning + reasoningParts
// grid + per-action trustScore pill. Banner header shows overall trustScore pill.
//
// v8.24 NEW: User Risk Profile — Master Brain becomes PERSONAL.
// Added "Tvoj Risk Profile" card BETWEEN Actual Profit and Master Brain banner.
// 4 user-configurable fields (riskTolerance, maxAcceptableRisk, liquidityReserve,
// investmentHorizon) stored in Settings singleton. Master Brain loads these and
// applies adjustMasterBrainForRiskProfile() — recommendationOverride (REDUCE_RISK /
// ACCEPT_RISK / CAUTIOUS_PROCEED), filteredTopActions, adjustedRiskBudget.
//
// v8.23 NEW PHASE: Validation — "Ali lahko zaupaš Master Brain-u?"
//
// New visual hierarchy (top → bottom):
//   1. 📊 Actual Profit Card (v8.23, indigo) — GROUND TRUTH first, before
//      any predictions. Shows real EUR profit from Trade table.
//   2. ⚙️ Tvoj Risk Profile (v8.24, violet) — USER CONTEXT. Defines how Master
//      Brain predictions should be interpreted for THIS user.
//   3. 🧠✨ Master Brain Banner (v8.22, gold/amber) — PREDICTIONS.
//      Synthesizes 7 Domain Brains into ONE decision (adjusted by profile).
//      v8.26: each TOP action has an "ℹ️ Zakaj?" toggle for explainability.
//   4. 🎯 Scenario Brain (v8.27, rose/pink) — WHAT IF? simulator. 3 preset
//      scenarios + custom input form, side-by-side comparison table.
//   5. 🎛️ Adaptive Domain Weights (v8.28, bright orange) — FEEDBACK LOOP.
//      7 sliders + execution stats + rate bars + history + feedback demo.
//      System learns from REVEALED preferences (which actions user executes).
//   6. 🧠📦📈🎯🛡️👥💶 7 Domain Brain sections (v8.15-v8.21) — detailed
//      drill-down into each domain.
//   7. 📸 Brain Snapshots section (v8.23, emerald) — historical record of
//      Master Brain predictions, foundation for v8.25 Historical Accuracy.

// ============================================================================
// v8.38: NOTIFICATION CENTER + ALERT HISTORY
// ============================================================================
//
// "What happened in the Brain system?" — centralized history of ALL
// notifications. Previously Brain events were scattered: Telegram messages,
// toast notifications, dev.log. User had no central view of "what happened".
//
// v8.38 solution:
//   - NEW `Notification` Prisma model (type, title, body, severity, source,
//     isRead, draftId, snapshotDate, metadata, createdAt) — general (NOT
//     tied to Monitor/Listing like the existing `Alert` model).
//   - `src/lib/notifications.ts` — createNotification, getNotifications,
//     markAsRead, markAllAsRead, deleteNotification, cleanupOldNotifications.
//   - Telegram integration: sendBrainDigest / sendAutoPilotAlert /
//     sendAnomalyAlert now ALSO createNotification() (in addition to Telegram
//     send). If Telegram is not configured, the notification is STILL logged.
//   - `/api/brain-notifications` — GET (with filters + stats) + POST (create)
//     + PATCH (bulk: mark_read / mark_all_read / delete_read). Uses
//     /api/brain-notifications (NOT /api/notifications — existing endpoint
//     for Monitor/Listing alert delivery history).
//   - `/api/brain-notifications/[id]` — PATCH (mark as read) + DELETE.
//   - `/api/cron/cleanup-notifications` — daily cron (90-day cutoff).
//
// UI:
//   - Bell icon (🔔) in BrainSynthesisCard header — unread count badge (red
//     circle) + dropdown with recent 5 notifications + "Glej vse" link.
//   - Full NotificationCenterCard at the bottom of BrainSynthesisCard —
//     filter bar (type/severity/read) + scrollable list + per-notification
//     actions (mark read / delete) + bulk actions (mark all read / delete
//     read) + auto-refresh 30s. Stats row at the top showing totals.
//
// 8 notification types: brain_digest | autopilot_executed | autopilot_rollback
//   | anomaly | price_drop | system | trade_sold | error
// 4 severities: info | success | warning | error
// 5 sources: brain | autopilot | telegram | system | manual

