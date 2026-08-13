'use client';

/**
 * v7.01: AIHubView — centralen pregled vseh 254 AI endpointov z iskalnikom.
 *
 * REŠI "194 orphan AI endpointov" problem:
 * - Prej: 76 % AI endpointov (194 od 254) ni imelo UI gumba
 * - Sedaj: vsi 254 endpointi so brskljivi in poganljivi iz AI Hub
 *
 * Funkcionalnost:
 * - Iskalnik (filter po imenu/opisu)
 * - Kategorije (brain, buyer, inventory, listing, pricing, risk, negotiation, reports, misc)
 * - Klik na endpoint → odpre AI Runner modal
 * - AI Runner: POST na endpoint, prikaže JSON rezultat v pretty-print formatu
 * - "Kopiraj JSON" gumb
 * - Statistike: skupaj endpointov, po kategorijah
 *
 * v8.15: Added 🧠 Brain category + Brain Synthesis Card.
 * - Brain category contains orchestrator endpoints above specialists.
 *   First entry: `brain/profit` (Profit Brain synthesizes 6 profit signals).
 * - Brain Synthesis Card fetches `/api/ai/brain/profit` on mount and shows
 *   the one-line summary, profit grade pills, top 3 actions, and 30d/90d
 *   projections. Emerald-tinted background distinguishes from specialists.
 *
 * v8.16: Extended Brain Synthesis Card with SECOND stacked section —
 * Inventory Brain (amber-tinted). Card renders BOTH brain layers
 * simultaneously:
 *   - 🧠 PROFIT BRAIN (emerald) — synthesizes 6 profit signals → €/mo projection
 *   - 📦 INVENTORY BRAIN (amber) — synthesizes 6 inventory signals → 30d/90d
 *     inventory projection (recommendedItemsToSell/Buy, projectedInventoryValue,
 *     projectedAgedPct, projectedTurnoverRate)
 *
 * v8.17: Extended Brain Synthesis Card with THIRD stacked section —
 * Market Brain (sky/blue-tinted). Card now renders ALL THREE brain layers
 * simultaneously:
 *   - 📈 MARKET BRAIN (sky/blue) — synthesizes 6 market signals → 30d/90d
 *     market phase projection (predictedPhase + predictedPriceChangePct +
 *     recommendedAction BUY/SELL/HOLD/LIQUIDATE)
 *
 * v8.18: Extended Brain Synthesis Card with FOURTH stacked section —
 * Sourcing Brain (purple/violet-tinted). Card now renders ALL FOUR brain
 * layers simultaneously:
 *   - 🎯 SOURCING BRAIN (purple/violet) — synthesizes 6 sourcing signals
 *     (roi, volume, margin, momentum, diversification, concentration) →
 *     per-source decision (recommendedSourceToScale + recommendedSourceToReduce
 *     + projectedTotalMonthlyProfit + recommendedNewSource)
 *
 * v8.19: Extended Brain Synthesis Card with FIFTH stacked section —
 * Risk Brain (red/rose-tinted). Card now renders ALL FIVE brain
 * layers simultaneously:
 *   - 🛡️ RISK BRAIN (red/rose) — synthesizes 6 risk signals
 *     (concentration, aging, liquidity, market, fraud, portfolio) →
 *     30d/90d risk projection (projectedRiskScore + projectedConcentrationPct
 *     + projectedAgedPct + recommendedRiskBudget)
 * v8.20: Extended Brain Synthesis Card with SIXTH stacked section —
 * Buyer Brain (cyan/teal-tinted). Card now renders ALL SIX brain
 * layers simultaneously:
 *   - 👥 BUYER BRAIN (cyan/teal) — synthesizes 6 buyer signals
 *     (intent, conversion, retention, lifetimeValue, loyalty, engagement) →
 *     30d/90d buyer projection (projectedActiveBuyers + projectedLTV +
 *     projectedChurnRatePct + recommendedOutreachCount)
 *
 * v8.21: Extended Brain Synthesis Card with SEVENTH stacked section —
 * Pricing Brain (green/lime-tinted). Card now renders ALL SEVEN brain
 * layers simultaneously:
 *   - 💶 PRICING BRAIN (green/lime) — synthesizes 6 pricing signals
 *     (margin, elasticity, competitiveness, dynamic, war, psychology) →
 *     30d/90d pricing projection (projectedMarginPct + projectedRevenue +
 *     recommendedPriceChangePct + listingsToReprice) + pricingPower composite.
 * All seven sections fetch in parallel on mount (`Promise.all`). Each has its
 * own loading skeleton, error state, refresh button, and cache indicator.
 *
 * MILESTONE: All 7 Domain Brains complete (Profit + Inventory + Market +
 * Sourcing + Risk + Buyer + Pricing).
 *
 * v8.22: Added Master Brain BANNER on TOP of BrainSynthesisCard (above the 7
 * domain sections). Master Brain is the FINAL orchestration layer — it
 * calls all 7 Domain Brain functions in PARALLEL via direct TS imports
 * (NOT HTTP), synthesizes 21+ actions into TOP 5 ranked actions, detects
 * conflicts between domains, computes overallHealth score, generates
 * 30d/90d/12m strategy, and returns ONE oneLineSummary answering:
 * "Kaj naj naredim danes?" The 7 domain sections remain BELOW the banner
 * for detailed drill-down.
 * Visual hierarchy: Master Brain banner (top, gold/amber gradient) → 7
 * Domain Brain sections (below, detailed).
 * 🎯 FINAL MILESTONE: Brain architecture COMPLETE (7 Domain + 1 Master = 8 layers).
 *
 * v8.23: NEW PHASE — Validation ("Ali lahko zaupaš Master Brain-u?").
 * Added TWO new sections to BrainSynthesisCard:
 *   1. 📊 Actual Profit Card (TOP, indigo/violet gradient) — GROUND TRUTH:
 *      actual EUR profit from Trade table (status='sold', sellDate within
 *      last N days). Placed ABOVE Master Brain banner because ground truth
 *      should be the first thing the user sees, BEFORE predictions.
 *      Days selector: 7d / 30d / 90d / 12m. Fetches /api/ai/brain/actual-profit.
 *   2. 📸 Brain Snapshots section (BOTTOM, emerald-tinted, horizontal scroll)
 *      — historical record of Master Brain predictions (cron @ 00:00 stores
 *      FULL masterBrain() output in BrainSnapshot Prisma model). Each card
 *      shows date + grade + projection30d + riskLevel + accuracy (when
 *      backfilled 30d later). Empty state with "Shrani prvi snapshot" button
 *      + always-available "Shrani snapshot zdaj" button (manual trigger).
 *      Fetches /api/ai/brain/snapshots?days=30.
 * New visual hierarchy (top → bottom): Actual Profit (ground truth) →
 * Master Brain (predictions) → 7 Domain Brain sections (drill-down) →
 * Brain Snapshots (historical record). Foundation for v8.25 Historical Accuracy.
 *
 * v8.24: Added ⚙️ Tvoj Risk Profile card (violet/indigo) BETWEEN Actual Profit
 * and Master Brain banner — makes Master Brain personal (conservative/balanced/
 * aggressive). Master Brain now applies adjustMasterBrainForRiskProfile() before
 * returning its result, so recommendations match the user's risk tolerance.
 *
 * v8.25: Added 📈 Master Brain Accuracy & Trend card (teal/emerald gradient) AT
 * THE BOTTOM of BrainSynthesisCard, below Brain Snapshots. Validation phase
 * CULMINATION — answers "Ali lahko zaupam Master Brain-u?" with actual data:
 * "Master Brain accuracy: 89% (zadnjih 30 dni). Trend: ↗️ IMPROVING." Uses
 * backfill cron to fill actualProfit30d/90d on snapshots older than 30/90 days,
 * then computes accuracy = actual / predicted × 100. Shows:
 *   - 30d + 90d accuracy big-number pills (— if no snapshot has accuracy yet)
 *   - Overall Health trend sparkline (last 7 overallHealth scores)
 *   - Trend indicator: IMPROVING / STABLE / DECLINING / INSUFFICIENT_DATA
 *   - 7 Domain grade trend table (each domain's grade progression)
 *   - "🔄 Backfill accuracy" button for manual testing
 * Fetches /api/ai/brain/accuracy?days=30. Backfill button POSTs to
 * /api/ai/brain/accuracy/backfill. 🎯 VALIDATION PHASE COMPLETE.
 *
 * v8.26: NEW PHASE — Intelligence ("Zakaj Master Brain priporoča TOČNO to
 * akcijo?"). Master Brain banner response now ALSO includes `explanations`
 * (array of 5 ActionExplanation — one per TOP action). Each explanation has:
 *   - reasoning (1-3 Slovenian sentences — the primary "why" string)
 *   - reasoningParts { trigger, signalScore, signalGrade, whyRankedHere,
 *     profileImpact, conflictImpact, expectedOutcome }
 *   - trustScore (0-100 per action)
 * Master Brain banner adds an "ℹ️ Zakaj?" toggle button per action — when
 * clicked, expands to show the reasoning + reasoningParts grid + trustScore
 * pill (emerald ≥70, amber ≥50, red <50). Banner also gains an OVERALL
 * trustScore pill in the header ("Trust: 67/100"). Fetches the same
 * /api/ai/brain/master endpoint (now includes explanations in the response —
 * no separate fetch needed). 🎯 INTELLIGENCE PHASE STARTED.
 *
 * v8.27: NEW — Scenario Brain ("What if?" simulator). Adds a 🎯 Scenario Brain
 * card (rose/pink-tinted) BETWEEN Master Brain banner and the 7 Domain Brain
 * sections. Generates 3 preset scenarios (conservative/balanced/aggressive)
 * and runs Master Brain for EACH in parallel (3× Promise.all), then shows a
 * side-by-side comparison table (8 metrics × 3-4 columns: profit 30d/90d/12m,
 * overallHealth, riskLevel, top akcija, capital potreben, konflikti). The
 * recommended scenario is highlighted with a subtle border + recommendation
 * banner ("🏆 Priporočeni scenarij: Agresivni — pričakuje X€ v 12m z Y/100
 * zdravjem."). Custom scenario input form (Capital €, Trades/month, Risk
 * tolerance) POSTs to /api/ai/brain/scenario with overrides → updates the
 * 4th 'custom' column. GET runs 3 presets (15-min cache). POST runs 3 + custom.
 *
 * Lazy-loaded z next/dynamic (ssr: false) — ne bremeni prvotnega nalaganja.
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { Sparkles, Search, Copy, Check, RefreshCw, Zap, X, ChevronRight, ChevronDown, ChevronUp, Brain, AlertCircle, Package, TrendingUp, Target, Shield, Users, Coins, Crown, Camera, Save, History, TrendingDown, ArrowUpRight, ArrowDownRight, Settings2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ===== Kategorije =====
const CATEGORIES = [
  { id: 'all', label: 'Vsi', icon: '📋', color: 'text-primary' },
  { id: 'brain', label: 'Možgani', icon: '🧠', color: 'text-emerald-500' },
  { id: 'buyer', label: 'Kupci', icon: '👥', color: 'text-blue-400' },
  { id: 'inventory', label: 'Skladišče', icon: '📦', color: 'text-amber-400' },
  { id: 'listing', label: 'Oglasi', icon: '📝', color: 'text-purple-400' },
  { id: 'pricing', label: 'Cene', icon: '💰', color: 'text-primary' },
  { id: 'risk', label: 'Tveganje', icon: '🛡️', color: 'text-red-500' },
  { id: 'negotiation', label: 'Pogajanje', icon: '🤝', color: 'text-cyan-400' },
  { id: 'reports', label: 'Poročila', icon: '📊', color: 'text-primary' },
  { id: 'misc', label: 'Ostalo', icon: '🔧', color: 'text-muted-foreground' },
] as const;

// ===== Kategorizacija endpointov (mirror of /api/ai-list categorize) =====
function categorize(name: string): string {
  const n = name.toLowerCase();
  if (n.startsWith('brain/') || n.split('/')[0] === 'brain') return 'brain';
  if (n.startsWith('buyer') || n.includes('customer')) return 'buyer';
  if (n.startsWith('inventory') || n.includes('stockout') || n.includes('shrinkage') || n.includes('liquidation') || n.includes('rebalancer') || n.includes('turnover') || n.includes('aging')) return 'inventory';
  if (n.startsWith('listing') || n.includes('description') || n.includes('title') || n.includes('seo') || n.includes('thumbnail') || n.includes('image') || n.includes('tag') || n.includes('content') || n.includes('ctr') || n.includes('conversion') || n.includes('engagement') || n.includes('virality') || n.includes('performance')) return 'listing';
  if (n.includes('price') || n.includes('pricing') || n.includes('margin') || n.includes('profit') || n.includes('bundle') || n.includes('cash') || n.includes('budget') || n.includes('seasonal') || n.includes('demand') || n.includes('depreciation') || n.includes('roi') || n.includes('cost')) return 'pricing';
  if (n.includes('risk') || n.includes('fraud') || n.includes('fake') || n.includes('insurance') || n.includes('hedge') || n.includes('parity') || n.includes('saturation') || n.includes('anomal')) return 'risk';
  if (n.includes('negotiation') || n.includes('negotiate') || n.includes('auction') || n.includes('sniper') || n.includes('bid') || n.includes('seller')) return 'negotiation';
  if (n.includes('report') || n.includes('summary') || n.includes('dashboard') || n.includes('forecast') || n.includes('benchmark') || n.includes('insights') || n.includes('trend') || n.includes('monthly') || n.includes('daily') || n.includes('playbook') || n.includes('automation') || n.includes('autonomous')) return 'reports';
  return 'misc';
}

// ===== Brain Synthesis Card (v8.22 Master + v8.15-v8.21 7 Domains) =====
//
// Renders ONE Master Brain BANNER on top + ALL SEVEN Domain Brain layers
// stacked below inside one Card:
//   - 🧠✨ MASTER BRAIN (v8.22, gold/amber gradient) — FINAL orchestration
//     layer that synthesizes ALL 7 Domain Brain outputs into ONE decision.
//   - 🧠 PROFIT BRAIN (v8.15, emerald) — synthesizes 6 profit signals
//   - 📦 INVENTORY BRAIN (v8.16, amber) — synthesizes 6 inventory signals
//   - 📈 MARKET BRAIN (v8.17, sky/blue) — synthesizes 6 market signals
//   - 🎯 SOURCING BRAIN (v8.18, purple/violet) — synthesizes 6 sourcing signals
//   - 🛡️ RISK BRAIN (v8.19, red/rose) — synthesizes 6 risk signals
//   - 👥 BUYER BRAIN (v8.20, cyan/teal) — synthesizes 6 buyer signals
//   - 💶 PRICING BRAIN (v8.21, green/lime) — synthesizes 6 pricing signals
//
// The Master Brain banner fetches `/api/ai/brain/master` independently and
// displays: oneLineSummary, overallHealth grade + riskLevel, TOP 5 ranked
// actions across all 7 domains, 30d/90d/12m strategy pills, conflicts,
// bottlenecks/strengths. The 7 domain sections fetch in parallel for
// detailed drill-down.
// Visual hierarchy: Master Brain banner (top, prominent) → 7 Domain Brain
// sections (below, detailed).

interface BrainAction {
  rank: number;
  domain: string;
  signal: string;
  action: string;
  expectedUpliftEUR: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface BrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number;
    grade: string;
    upliftEURPerMonth: number;
    topLever: string;
  }>;
  current: {
    monthlyProfit: number;
    profitGrowthRate: number;
    avgProfitPerTrade: number;
    tradesPerMonth: number;
    capitalDeployed: number;
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: number;
    projection90d: number;
    profitGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    bestOpportunity: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}

// v8.17: Market Brain result — projection30d/projection90d are STRUCTURED
// objects with `predictedPhase` + `predictedPriceChangePct` + `recommendedAction`
// (BUY/SELL/HOLD/LIQUIDATE). Different from both Profit (scalars) and
// Inventory (recommendedItemsToSell/Buy + projectedInventoryValue).
interface MarketBrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number;
    grade: string;
    upliftEURPerMonth: number;
    topLever: string;
  }>;
  current: {
    activeListingCount: number;
    newLastWeek: number;
    avgPriceChangePctWeek: number;
    avgPriceChangePctMonth: number;
    buyerInquiriesLastWeek: number;
    sellThroughRatePct: number;
    avgDaysOnMarket: number;
    priceSpreadPct: number;
    inferredCyclePhase: 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN';
    inferredSentiment: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: {
      predictedPhase: 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN';
      predictedPriceChangePct: number;
      recommendedAction: 'BUY' | 'SELL' | 'HOLD' | 'LIQUIDATE';
    };
    projection90d: {
      predictedPhase: 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN';
      predictedPriceChangePct: number;
      recommendedAction: 'BUY' | 'SELL' | 'HOLD' | 'LIQUIDATE';
    };
    marketGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    bestOpportunity: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}

// v8.16: Inventory Brain result — different `current` and `maximization`
// shape from Profit Brain (projections are STRUCTURED objects, not scalars).
interface InventoryBrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number;
    grade: string;
    upliftEURPerMonth: number;
    topLever: string;
  }>;
  current: {
    itemCount: number;
    totalInventoryValue: number;
    avgDaysToSell: number;
    agedItemsCount: number;
    agedItemsPct: number;
    avgProfitMarginPct: number;
    capitalDeployed: number;
    monthlySalesCount: number;
    monthlyRevenue: number;
    inventoryTurnoverRate: number;
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: {
      recommendedItemsToSell: number;
      recommendedItemsToBuy: number;
      projectedInventoryValue: number;
      projectedAgedPct: number;
    };
    projection90d: {
      projectedInventoryValue: number;
      projectedAgedPct: number;
      projectedTurnoverRate: number;
    };
    inventoryGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    bestOpportunity: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}

function gradeColor(grade: string): string {
  switch (grade) {
    case 'A+':
      return 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400';
    case 'A':
      return 'bg-green-500/15 text-green-600 border-green-500/30 dark:text-green-400';
    case 'B':
      return 'bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400';
    case 'C':
      return 'bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400';
    case 'D':
      return 'bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400';
    default:
      return 'bg-zinc-500/15 text-zinc-600 border-zinc-500/30 dark:text-zinc-400';
  }
}

function confidenceColor(c: string): string {
  switch (c) {
    case 'HIGH':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'MEDIUM':
      return 'text-amber-600 dark:text-amber-400';
    default:
      return 'text-zinc-500 dark:text-zinc-400';
  }
}

// --- Profit Brain section (v8.15, emerald) ---------------------------------

function ProfitBrainSection() {
  const [data, setData] = useState<BrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/profit', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as BrainResult;
      if (!json?.ok) throw new Error(json?.source ? 'Brain ni vrnil rezultata' : 'Napaka');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBrain();
  }, [fetchBrain]);

  return (
    <div className="rounded-lg border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <Brain className="w-4 h-4 text-emerald-500 shrink-0" />
        <span className="text-sm sm:text-base font-bold tracking-tight">
          🧠 PROFIT BRAIN
        </span>
        <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400 shrink-0">
          v8.15
        </Badge>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-emerald-500/10" />
          <Skeleton className="h-3 w-3/4 bg-emerald-500/10" />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Skeleton className="h-6 bg-emerald-500/10" />
            <Skeleton className="h-6 bg-emerald-500/10" />
            <Skeleton className="h-6 bg-emerald-500/10" />
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchBrain} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="space-y-2.5">
          <p className="text-xs sm:text-sm font-medium leading-snug">
            {data.maximization.oneLineSummary}
          </p>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className={cn('text-[10px]', gradeColor(data.maximization.profitGrade))}>
              Profit: {data.maximization.profitGrade}
            </Badge>
            <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
              Top: {data.maximization.bestOpportunity.toUpperCase()}
            </Badge>
            {data.cachedAt && (
              <Badge variant="outline" className="text-[9px] text-muted-foreground border-muted">
                cache {Math.round((Date.now() - data.cachedAt) / 1000)}s
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-[9px] uppercase text-muted-foreground">Top 3 akcije za danes</div>
            {data.maximization.topActions.map((a) => (
              <div key={a.rank} className="flex items-start gap-1.5 text-[11px]">
                <span className="font-bold text-emerald-600 dark:text-emerald-400 shrink-0 w-3">
                  {a.rank}.
                </span>
                <span className="flex-1 min-w-0">
                  <span className="font-medium">{a.action}</span>
                  <span className="text-muted-foreground"> · +{a.expectedUpliftEUR}€/mo</span>
                </span>
                <span className={cn('text-[9px] font-bold shrink-0', confidenceColor(a.confidence))}>
                  {a.confidence}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 text-[11px] pt-1 border-t border-emerald-500/20">
            <span className="text-muted-foreground">
              Trenutno: <span className="font-bold text-foreground">{Math.round(data.current.monthlyProfit)}€/mo</span>
            </span>
            <span className="text-muted-foreground">
              30d: <span className="font-bold text-emerald-600 dark:text-emerald-400">{Math.round(data.maximization.projection30d)}€/mo</span>
              {' · '}
              90d: <span className="font-bold text-emerald-600 dark:text-emerald-400">{Math.round(data.maximization.projection90d)}€/mo</span>
            </span>
          </div>

          <div className="flex justify-end">
            <button
              onClick={fetchBrain}
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

// --- Inventory Brain section (v8.16, amber) --------------------------------

function InventoryBrainSection() {
  const [data, setData] = useState<InventoryBrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/inventory', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as InventoryBrainResult;
      if (!json?.ok) throw new Error(json?.source ? 'Brain ni vrnil rezultata' : 'Napaka');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBrain();
  }, [fetchBrain]);

  return (
    <div className="rounded-lg border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <Package className="w-4 h-4 text-amber-500 shrink-0" />
        <span className="text-sm sm:text-base font-bold tracking-tight">
          📦 INVENTORY BRAIN
        </span>
        <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400 shrink-0">
          v8.16
        </Badge>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-amber-500/10" />
          <Skeleton className="h-3 w-3/4 bg-amber-500/10" />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Skeleton className="h-6 bg-amber-500/10" />
            <Skeleton className="h-6 bg-amber-500/10" />
            <Skeleton className="h-6 bg-amber-500/10" />
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchBrain} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="space-y-2.5">
          <p className="text-xs sm:text-sm font-medium leading-snug">
            {data.maximization.oneLineSummary}
          </p>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className={cn('text-[10px]', gradeColor(data.maximization.inventoryGrade))}>
              Inventory: {data.maximization.inventoryGrade}
            </Badge>
            <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-600 dark:text-amber-400">
              Top: {data.maximization.bestOpportunity.toUpperCase()}
            </Badge>
            {data.cachedAt && (
              <Badge variant="outline" className="text-[9px] text-muted-foreground border-muted">
                cache {Math.round((Date.now() - data.cachedAt) / 1000)}s
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-[9px] uppercase text-muted-foreground">Top 3 akcije za danes</div>
            {data.maximization.topActions.map((a) => (
              <div key={a.rank} className="flex items-start gap-1.5 text-[11px]">
                <span className="font-bold text-amber-600 dark:text-amber-400 shrink-0 w-3">
                  {a.rank}.
                </span>
                <span className="flex-1 min-w-0">
                  <span className="font-medium">{a.action}</span>
                  <span className="text-muted-foreground"> · +{a.expectedUpliftEUR}€/mo</span>
                </span>
                <span className={cn('text-[9px] font-bold shrink-0', confidenceColor(a.confidence))}>
                  {a.confidence}
                </span>
              </div>
            ))}
          </div>

          {/* 30d projection (structured, inventory-specific) */}
          <div className="grid grid-cols-2 gap-1.5 text-[10px] pt-1 border-t border-amber-500/20">
            <span className="text-muted-foreground">
              Sedaj: <span className="font-bold text-foreground">{data.current.itemCount} itemov</span>
            </span>
            <span className="text-muted-foreground">
              Vrednost: <span className="font-bold text-foreground">{Math.round(data.current.totalInventoryValue)}€</span>
            </span>
            <span className="text-muted-foreground">
              Staranje: <span className="font-bold text-amber-600 dark:text-amber-400">{Math.round(data.current.agedItemsPct)}%</span>
            </span>
            <span className="text-muted-foreground">
              Turnover: <span className="font-bold text-amber-600 dark:text-amber-400">{data.current.inventoryTurnoverRate.toFixed(2)}/mo</span>
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 text-[10px] pt-1 border-t border-amber-500/10">
            <span className="text-muted-foreground">
              30d: <span className="font-bold text-amber-600 dark:text-amber-400">
                prodaj {data.maximization.projection30d.recommendedItemsToSell} · kupi {data.maximization.projection30d.recommendedItemsToBuy}
              </span>
            </span>
            <span className="text-muted-foreground">
              90d: <span className="font-bold text-amber-600 dark:text-amber-400">
                {Math.round(data.maximization.projection90d.projectedInventoryValue)}€ · turnover {data.maximization.projection90d.projectedTurnoverRate.toFixed(2)}/mo
              </span>
            </span>
          </div>

          <div className="flex justify-end">
            <button
              onClick={fetchBrain}
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

// --- Market Brain section (v8.17, sky/blue) --------------------------------

function MarketBrainSection() {
  const [data, setData] = useState<MarketBrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/market', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as MarketBrainResult;
      if (!json?.ok) throw new Error(json?.source ? 'Brain ni vrnil rezultata' : 'Napaka');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBrain();
  }, [fetchBrain]);

  const phaseColor = (phase: string): string => {
    switch (phase) {
      case 'MARKUP':
        return 'text-emerald-600 dark:text-emerald-400';
      case 'ACCUMULATION':
        return 'text-sky-600 dark:text-sky-400';
      case 'DISTRIBUTION':
        return 'text-amber-600 dark:text-amber-400';
      case 'MARKDOWN':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-foreground';
    }
  };

  const actionColor = (action: string): string => {
    switch (action) {
      case 'BUY':
        return 'text-emerald-600 dark:text-emerald-400';
      case 'SELL':
        return 'text-amber-600 dark:text-amber-400';
      case 'HOLD':
        return 'text-sky-600 dark:text-sky-400';
      case 'LIQUIDATE':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-foreground';
    }
  };

  return (
    <div className="rounded-lg border border-sky-500/30 bg-gradient-to-br from-sky-500/10 via-sky-500/5 to-transparent p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <TrendingUp className="w-4 h-4 text-sky-500 shrink-0" />
        <span className="text-sm sm:text-base font-bold tracking-tight">
          📈 MARKET BRAIN
        </span>
        <Badge variant="outline" className="text-[10px] border-sky-500/40 text-sky-600 dark:text-sky-400 shrink-0">
          v8.17
        </Badge>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-sky-500/10" />
          <Skeleton className="h-3 w-3/4 bg-sky-500/10" />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Skeleton className="h-6 bg-sky-500/10" />
            <Skeleton className="h-6 bg-sky-500/10" />
            <Skeleton className="h-6 bg-sky-500/10" />
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchBrain} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="space-y-2.5">
          <p className="text-xs sm:text-sm font-medium leading-snug">
            {data.maximization.oneLineSummary}
          </p>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className={cn('text-[10px]', gradeColor(data.maximization.marketGrade))}>
              Market: {data.maximization.marketGrade}
            </Badge>
            <Badge variant="outline" className="text-[10px] border-sky-500/30 text-sky-600 dark:text-sky-400">
              Top: {data.maximization.bestOpportunity.toUpperCase()}
            </Badge>
            {data.cachedAt && (
              <Badge variant="outline" className="text-[9px] text-muted-foreground border-muted">
                cache {Math.round((Date.now() - data.cachedAt) / 1000)}s
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-[9px] uppercase text-muted-foreground">Top 3 akcije za danes</div>
            {data.maximization.topActions.map((a) => (
              <div key={a.rank} className="flex items-start gap-1.5 text-[11px]">
                <span className="font-bold text-sky-600 dark:text-sky-400 shrink-0 w-3">
                  {a.rank}.
                </span>
                <span className="flex-1 min-w-0">
                  <span className="font-medium">{a.action}</span>
                  <span className="text-muted-foreground"> · +{a.expectedUpliftEUR}€/mo</span>
                </span>
                <span className={cn('text-[9px] font-bold shrink-0', confidenceColor(a.confidence))}>
                  {a.confidence}
                </span>
              </div>
            ))}
          </div>

          {/* Current market state */}
          <div className="grid grid-cols-2 gap-1.5 text-[10px] pt-1 border-t border-sky-500/20">
            <span className="text-muted-foreground">
              Faza: <span className={cn('font-bold', phaseColor(data.current.inferredCyclePhase))}>{data.current.inferredCyclePhase}</span>
            </span>
            <span className="text-muted-foreground">
              Sentiment: <span className={cn('font-bold', phaseColor(data.current.inferredSentiment === 'BULLISH' ? 'MARKUP' : data.current.inferredSentiment === 'BEARISH' ? 'MARKDOWN' : 'DISTRIBUTION'))}>{data.current.inferredSentiment}</span>
            </span>
            <span className="text-muted-foreground">
              Oglasi: <span className="font-bold text-foreground">{data.current.activeListingCount}</span>
            </span>
            <span className="text-muted-foreground">
              Sell-through: <span className="font-bold text-foreground">{Math.round(data.current.sellThroughRatePct)}%</span>
            </span>
          </div>

          {/* 30d / 90d phase projection */}
          <div className="flex items-center justify-between gap-2 text-[10px] pt-1 border-t border-sky-500/10">
            <span className="text-muted-foreground">
              30d: <span className={cn('font-bold', phaseColor(data.maximization.projection30d.predictedPhase))}>
                {data.maximization.projection30d.predictedPhase}
              </span>
              {' '}
              <span className="text-muted-foreground">
                ({data.maximization.projection30d.predictedPriceChangePct >= 0 ? '+' : ''}
                {data.maximization.projection30d.predictedPriceChangePct.toFixed(1)}%)
              </span>
              {' → '}
              <span className={cn('font-bold', actionColor(data.maximization.projection30d.recommendedAction))}>
                {data.maximization.projection30d.recommendedAction}
              </span>
            </span>
            <span className="text-muted-foreground">
              90d: <span className={cn('font-bold', phaseColor(data.maximization.projection90d.predictedPhase))}>
                {data.maximization.projection90d.predictedPhase}
              </span>
              {' '}
              <span className="text-muted-foreground">
                ({data.maximization.projection90d.predictedPriceChangePct >= 0 ? '+' : ''}
                {data.maximization.projection90d.predictedPriceChangePct.toFixed(1)}%)
              </span>
              {' → '}
              <span className={cn('font-bold', actionColor(data.maximization.projection90d.recommendedAction))}>
                {data.maximization.projection90d.recommendedAction}
              </span>
            </span>
          </div>

          <div className="flex justify-end">
            <button
              onClick={fetchBrain}
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

// --- Sourcing Brain section (v8.18, purple/violet) -------------------------

// v8.18: Sourcing Brain result — different `current` shape (per-source array)
// and different `maximization` shape (projection30d/projection90d are STRUCTURED
// objects with recommendedSourceToScale + recommendedSourceToReduce +
// projectedConcentrationPct + recommendedNewSource). Distinct from Profit
// (scalars), Inventory (recommendedItemsToSell/Buy + projectedInventoryValue),
// and Market (predictedPhase + predictedPriceChangePct + recommendedAction).
interface SourcingBrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number;
    grade: string;
    upliftEURPerMonth: number;
    topLever: string;
  }>;
  current: {
    sourceCount: number;
    sources: Array<{
      name: string;
      monthlyVolume: number;
      avgProfitMarginPct: number;
      avgDaysToSell: number;
      capitalDeployedEUR: number;
      monthlyProfitEUR: number;
    }>;
    totalCapitalDeployed: number;
    totalMonthlyProfit: number;
    bestSource: string;
    worstSource: string;
    avgMarginPct: number;
    concentrationPct: number;
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: {
      recommendedSourceToScale: string;
      recommendedSourceToReduce: string;
      projectedTotalMonthlyProfit: number;
      projectedConcentrationPct: number;
    };
    projection90d: {
      projectedTotalMonthlyProfit: number;
      projectedSourceCount: number;
      projectedConcentrationPct: number;
      recommendedNewSource?: string;
    };
    sourcingGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    bestOpportunity: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}

function SourcingBrainSection() {
  const [data, setData] = useState<SourcingBrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/sourcing', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SourcingBrainResult;
      if (!json?.ok) throw new Error(json?.source ? 'Brain ni vrnil rezultata' : 'Napaka');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBrain();
  }, [fetchBrain]);

  return (
    <div className="rounded-lg border border-purple-500/30 bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <Target className="w-4 h-4 text-purple-500 shrink-0" />
        <span className="text-sm sm:text-base font-bold tracking-tight">
          🎯 SOURCING BRAIN
        </span>
        <Badge variant="outline" className="text-[10px] border-purple-500/40 text-purple-600 dark:text-purple-400 shrink-0">
          v8.18
        </Badge>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-purple-500/10" />
          <Skeleton className="h-3 w-3/4 bg-purple-500/10" />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Skeleton className="h-6 bg-purple-500/10" />
            <Skeleton className="h-6 bg-purple-500/10" />
            <Skeleton className="h-6 bg-purple-500/10" />
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchBrain} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="space-y-2.5">
          <p className="text-xs sm:text-sm font-medium leading-snug">
            {data.maximization.oneLineSummary}
          </p>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className={cn('text-[10px]', gradeColor(data.maximization.sourcingGrade))}>
              Sourcing: {data.maximization.sourcingGrade}
            </Badge>
            <Badge variant="outline" className="text-[10px] border-purple-500/30 text-purple-600 dark:text-purple-400">
              Top: {data.maximization.bestOpportunity.toUpperCase()}
            </Badge>
            {data.cachedAt && (
              <Badge variant="outline" className="text-[9px] text-muted-foreground border-muted">
                cache {Math.round((Date.now() - data.cachedAt) / 1000)}s
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-[9px] uppercase text-muted-foreground">Top 3 akcije za danes</div>
            {data.maximization.topActions.map((a) => (
              <div key={a.rank} className="flex items-start gap-1.5 text-[11px]">
                <span className="font-bold text-purple-600 dark:text-purple-400 shrink-0 w-3">
                  {a.rank}.
                </span>
                <span className="flex-1 min-w-0">
                  <span className="font-medium">{a.action}</span>
                  <span className="text-muted-foreground"> · +{a.expectedUpliftEUR}€/mo</span>
                </span>
                <span className={cn('text-[9px] font-bold shrink-0', confidenceColor(a.confidence))}>
                  {a.confidence}
                </span>
              </div>
            ))}
          </div>

          {/* Current sourcing state */}
          <div className="grid grid-cols-2 gap-1.5 text-[10px] pt-1 border-t border-purple-500/20">
            <span className="text-muted-foreground">
              Virov: <span className="font-bold text-foreground">{data.current.sourceCount}</span>
            </span>
            <span className="text-muted-foreground">
              Najboljši: <span className="font-bold text-purple-600 dark:text-purple-400">{data.current.bestSource}</span>
            </span>
            <span className="text-muted-foreground">
              Najslabši: <span className="font-bold text-foreground">{data.current.worstSource}</span>
            </span>
            <span className="text-muted-foreground">
              Koncentracija: <span className="font-bold text-purple-600 dark:text-purple-400">{Math.round(data.current.concentrationPct)}%</span>
            </span>
          </div>

          {/* 30d / 90d sourcing projection */}
          <div className="flex items-center justify-between gap-2 text-[10px] pt-1 border-t border-purple-500/10">
            <span className="text-muted-foreground">
              30d: <span className="font-bold text-purple-600 dark:text-purple-400">
                ↑ {data.maximization.projection30d.recommendedSourceToScale} · ↓ {data.maximization.projection30d.recommendedSourceToReduce}
              </span>
            </span>
            <span className="text-muted-foreground">
              90d: <span className="font-bold text-purple-600 dark:text-purple-400">
                {Math.round(data.maximization.projection90d.projectedTotalMonthlyProfit)}€/mo
                {data.maximization.projection90d.recommendedNewSource ? ` · +${data.maximization.projection90d.recommendedNewSource}` : ''}
              </span>
            </span>
          </div>

          <div className="flex justify-end">
            <button
              onClick={fetchBrain}
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

// --- Risk Brain section (v8.19, red/rose) ----------------------------------
//
// v8.19: Risk Brain result — projection30d/projection90d are STRUCTURED
// objects with projectedRiskScore + projectedConcentrationPct +
// projectedAgedPct + recommendedRiskBudget. Each signal has a `riskLevel`
// (LOW/MEDIUM/HIGH/CRITICAL) inverse to score, and `riskReductionEUR` (EUR
// saved if mitigated). Distinct from all four prior Brains.
interface RiskBrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number; // 0-100 (HIGHER = LOWER risk)
    grade: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    riskReductionEUR: number;
    topLever: string;
  }>;
  current: {
    totalCapitalDeployed: number;
    inventoryValue: number;
    agedInventoryValue: number;
    agedPct: number;
    capitalConcentrationPct: number;
    monthlyRevenue: number;
    monthlyProfit: number;
    activeSources: number;
    fraudSuspicionsPct: number;
    avgDaysToSell: number;
    marketVolatilityPct: number;
    overallRiskScore: number; // 0-100 (lower = more risk)
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: {
      projectedRiskScore: number;
      projectedConcentrationPct: number;
      projectedAgedPct: number;
      recommendedRiskBudget: number;
    };
    projection90d: {
      projectedRiskScore: number;
      projectedConcentrationPct: number;
      projectedAgedPct: number;
      recommendedRiskBudget: number;
    };
    riskGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    biggestRisk: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}

function riskLevelColor(level: string): string {
  switch (level) {
    case 'CRITICAL':
      return 'bg-rose-600/20 text-rose-700 border-rose-600/40 dark:text-rose-300';
    case 'HIGH':
      return 'bg-rose-500/15 text-rose-600 border-rose-500/30 dark:text-rose-400';
    case 'MEDIUM':
      return 'bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400';
    case 'LOW':
    default:
      return 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400';
  }
}

function RiskBrainSection() {
  const [data, setData] = useState<RiskBrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/risk', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as RiskBrainResult;
      if (!json?.ok) throw new Error(json?.source ? 'Brain ni vrnil rezultata' : 'Napaka');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBrain();
  }, [fetchBrain]);

  const biggestRiskSignal = data?.signals.find(
    (s) => s.name === data.maximization.biggestRisk,
  );

  return (
    <div className="rounded-lg border border-rose-500/30 bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <Shield className="w-4 h-4 text-rose-500 shrink-0" />
        <span className="text-sm sm:text-base font-bold tracking-tight">
          🛡️ RISK BRAIN
        </span>
        <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-600 dark:text-rose-400 shrink-0">
          v8.19
        </Badge>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-rose-500/10" />
          <Skeleton className="h-3 w-3/4 bg-rose-500/10" />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Skeleton className="h-6 bg-rose-500/10" />
            <Skeleton className="h-6 bg-rose-500/10" />
            <Skeleton className="h-6 bg-rose-500/10" />
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchBrain} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="space-y-2.5">
          <p className="text-xs sm:text-sm font-medium leading-snug">
            {data.maximization.oneLineSummary}
          </p>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className={cn('text-[10px]', gradeColor(data.maximization.riskGrade))}>
              Risk: {data.maximization.riskGrade}
            </Badge>
            {biggestRiskSignal && (
              <Badge variant="outline" className={cn('text-[10px]', riskLevelColor(biggestRiskSignal.riskLevel))}>
                Top: {data.maximization.biggestRisk.toUpperCase()}
              </Badge>
            )}
            {data.cachedAt && (
              <Badge variant="outline" className="text-[9px] text-muted-foreground border-muted">
                cache {Math.round((Date.now() - data.cachedAt) / 1000)}s
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-[9px] uppercase text-muted-foreground">Top 3 akcije za danes (mitigacija)</div>
            {data.maximization.topActions.map((a) => (
              <div key={a.rank} className="flex items-start gap-1.5 text-[11px]">
                <span className="font-bold text-rose-600 dark:text-rose-400 shrink-0 w-3">
                  {a.rank}.
                </span>
                <span className="flex-1 min-w-0">
                  <span className="font-medium">{a.action}</span>
                  <span className="text-muted-foreground"> · -{a.expectedUpliftEUR}€/mo tveganja</span>
                </span>
                <span className={cn('text-[9px] font-bold shrink-0', confidenceColor(a.confidence))}>
                  {a.confidence}
                </span>
              </div>
            ))}
          </div>

          {/* Current risk state */}
          <div className="grid grid-cols-2 gap-1.5 text-[10px] pt-1 border-t border-rose-500/20">
            <span className="text-muted-foreground">
              Tveganje: <span className="font-bold text-rose-600 dark:text-rose-400">{Math.round(data.current.overallRiskScore)}/100</span>
            </span>
            <span className="text-muted-foreground">
              Koncentracija: <span className="font-bold text-rose-600 dark:text-rose-400">{Math.round(data.current.capitalConcentrationPct)}%</span>
            </span>
            <span className="text-muted-foreground">
              Stari inventar: <span className="font-bold text-rose-600 dark:text-rose-400">{Math.round(data.current.agedPct)}%</span>
            </span>
            <span className="text-muted-foreground">
              Fraud: <span className="font-bold text-rose-600 dark:text-rose-400">{data.current.fraudSuspicionsPct.toFixed(1)}%</span>
            </span>
          </div>

          {/* 30d / 90d risk projection */}
          <div className="flex items-center justify-between gap-2 text-[10px] pt-1 border-t border-rose-500/10">
            <span className="text-muted-foreground">
              30d: <span className="font-bold text-rose-600 dark:text-rose-400">
                {Math.round(data.maximization.projection30d.projectedRiskScore)}/100 · budget {Math.round(data.maximization.projection30d.recommendedRiskBudget)}€
              </span>
            </span>
            <span className="text-muted-foreground">
              90d: <span className="font-bold text-rose-600 dark:text-rose-400">
                {Math.round(data.maximization.projection90d.projectedRiskScore)}/100 · budget {Math.round(data.maximization.projection90d.recommendedRiskBudget)}€
              </span>
            </span>
          </div>

          <div className="flex justify-end">
            <button
              onClick={fetchBrain}
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

// --- Buyer Brain section (v8.20, cyan/teal) ---------------------------------
//
// v8.20: Buyer Brain result — projection30d/projection90d are STRUCTURED
// objects with projectedActiveBuyers + projectedLTV + projectedChurnRatePct +
// recommendedOutreachCount. Each signal has score + grade + upliftEURPerMonth +
// topLever (same shape as Profit/Inventory/Market/Sourcing — NOT inverted like
// Risk). Distinct from all five prior Brains.
interface BuyerBrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number; // 0-100 (HIGHER = better buyer health)
    grade: string;
    upliftEURPerMonth: number;
    topLever: string;
  }>;
  current: {
    totalBuyers: number;
    activeBuyersLast30d: number;
    newBuyersLast30d: number;
    churnedBuyersLast30d: number;
    avgBuyerLifetimeValue: number;
    avgPurchaseFrequency: number;
    avgOrderValue: number;
    repeatBuyerRatePct: number;
    inquiriesConvertedPct: number;
    avgEngagementScore: number;
    highValueBuyersCount: number;
    churnRatePct: number;
    netGrowthPct: number;
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: {
      projectedActiveBuyers: number;
      projectedLTV: number;
      projectedChurnRatePct: number;
      recommendedOutreachCount: number;
    };
    projection90d: {
      projectedActiveBuyers: number;
      projectedLTV: number;
      projectedChurnRatePct: number;
      recommendedOutreachCount: number;
    };
    buyerGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    bestOpportunity: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}

function BuyerBrainSection() {
  const [data, setData] = useState<BuyerBrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/buyer', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as BuyerBrainResult;
      if (!json?.ok) throw new Error(json?.source ? 'Brain ni vrnil rezultata' : 'Napaka');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBrain();
  }, [fetchBrain]);

  return (
    <div className="rounded-lg border border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 via-teal-500/5 to-transparent p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <Users className="w-4 h-4 text-cyan-500 shrink-0" />
        <span className="text-sm sm:text-base font-bold tracking-tight">
          👥 BUYER BRAIN
        </span>
        <Badge variant="outline" className="text-[10px] border-cyan-500/40 text-cyan-600 dark:text-cyan-400 shrink-0">
          v8.20
        </Badge>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-cyan-500/10" />
          <Skeleton className="h-3 w-3/4 bg-cyan-500/10" />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Skeleton className="h-6 bg-cyan-500/10" />
            <Skeleton className="h-6 bg-cyan-500/10" />
            <Skeleton className="h-6 bg-cyan-500/10" />
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchBrain} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="space-y-2.5">
          <p className="text-xs sm:text-sm font-medium leading-snug">
            {data.maximization.oneLineSummary}
          </p>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className={cn('text-[10px]', gradeColor(data.maximization.buyerGrade))}>
              Buyer: {data.maximization.buyerGrade}
            </Badge>
            <Badge variant="outline" className="text-[10px] border-cyan-500/30 text-cyan-600 dark:text-cyan-400">
              Top: {data.maximization.bestOpportunity.toUpperCase()}
            </Badge>
            {data.cachedAt && (
              <Badge variant="outline" className="text-[9px] text-muted-foreground border-muted">
                cache {Math.round((Date.now() - data.cachedAt) / 1000)}s
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-[9px] uppercase text-muted-foreground">Top 3 akcije za danes (kultivacija)</div>
            {data.maximization.topActions.map((a) => (
              <div key={a.rank} className="flex items-start gap-1.5 text-[11px]">
                <span className="font-bold text-cyan-600 dark:text-cyan-400 shrink-0 w-3">
                  {a.rank}.
                </span>
                <span className="flex-1 min-w-0">
                  <span className="font-medium">{a.action}</span>
                  <span className="text-muted-foreground"> · +{a.expectedUpliftEUR}€/mo</span>
                </span>
                <span className={cn('text-[9px] font-bold shrink-0', confidenceColor(a.confidence))}>
                  {a.confidence}
                </span>
              </div>
            ))}
          </div>

          {/* Current buyer state */}
          <div className="grid grid-cols-2 gap-1.5 text-[10px] pt-1 border-t border-cyan-500/20">
            <span className="text-muted-foreground">
              Kupcev: <span className="font-bold text-cyan-600 dark:text-cyan-400">{data.current.totalBuyers}</span>
            </span>
            <span className="text-muted-foreground">
              Aktivnih: <span className="font-bold text-cyan-600 dark:text-cyan-400">{data.current.activeBuyersLast30d}</span>
            </span>
            <span className="text-muted-foreground">
              Churn: <span className="font-bold text-cyan-600 dark:text-cyan-400">{Math.round(data.current.churnRatePct)}%</span>
            </span>
            <span className="text-muted-foreground">
              Rast: <span className="font-bold text-cyan-600 dark:text-cyan-400">{data.current.netGrowthPct >= 0 ? '+' : ''}{Math.round(data.current.netGrowthPct)}%</span>
            </span>
            <span className="text-muted-foreground">
              LTV: <span className="font-bold text-cyan-600 dark:text-cyan-400">{Math.round(data.current.avgBuyerLifetimeValue)}€</span>
            </span>
          </div>

          {/* 30d / 90d buyer projection */}
          <div className="flex items-center justify-between gap-2 text-[10px] pt-1 border-t border-cyan-500/10">
            <span className="text-muted-foreground">
              30d: <span className="font-bold text-cyan-600 dark:text-cyan-400">
                {Math.round(data.maximization.projection30d.projectedActiveBuyers)} aktivnih · LTV {Math.round(data.maximization.projection30d.projectedLTV)}€ · kontaktiraj {data.maximization.projection30d.recommendedOutreachCount}
              </span>
            </span>
            <span className="text-muted-foreground">
              90d: <span className="font-bold text-cyan-600 dark:text-cyan-400">
                {Math.round(data.maximization.projection90d.projectedActiveBuyers)} aktivnih · LTV {Math.round(data.maximization.projection90d.projectedLTV)}€ · kontaktiraj {data.maximization.projection90d.recommendedOutreachCount}
              </span>
            </span>
          </div>

          <div className="flex justify-end">
            <button
              onClick={fetchBrain}
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

// --- Pricing Brain section (v8.21, green/lime) --------------------------------
//
// v8.21: Pricing Brain result — projection30d/projection90d are STRUCTURED
// objects with projectedMarginPct + projectedRevenue +
// recommendedPriceChangePct + listingsToReprice. Each signal has score +
// grade + upliftEURPerMonth + topLever (same shape as Profit/Inventory/
// Market/Sourcing/Buyer — NOT inverted like Risk). Distinct from all six
// prior Brains. Also exposes a `pricingPower` composite (0-100) on `current`
// that represents the ability to raise prices without losing volume.
interface PricingBrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number; // 0-100 (HIGHER = better pricing health)
    grade: string;
    upliftEURPerMonth: number;
    topLever: string;
  }>;
  current: {
    activeListingsCount: number;
    avgProfitMarginPct: number;
    avgDaysOnMarket: number;
    competitorPriceAvgPct: number;
    priceElasticityScore: number;
    sellThroughRatePct: number;
    monthlyRevenue: number;
    avgOrderValue: number;
    priceWarDetected: boolean;
    seasonalMultiplier: number;
    psychologyOptimizedPct: number;
    lastPriceChangePct: number;
    pricingPower: number; // 0-100 composite — ability to raise prices
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: {
      projectedMarginPct: number;
      projectedRevenue: number;
      recommendedPriceChangePct: number;
      listingsToReprice: number;
    };
    projection90d: {
      projectedMarginPct: number;
      projectedRevenue: number;
      recommendedPriceChangePct: number;
      listingsToReprice: number;
    };
    pricingGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    bestOpportunity: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}

function PricingBrainSection() {
  const [data, setData] = useState<PricingBrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/pricing', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as PricingBrainResult;
      if (!json?.ok) throw new Error(json?.source ? 'Brain ni vrnil rezultata' : 'Napaka');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBrain();
  }, [fetchBrain]);

  return (
    <div className="rounded-lg border border-lime-500/30 bg-gradient-to-br from-lime-500/10 via-green-500/5 to-transparent p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <Coins className="w-4 h-4 text-lime-600 dark:text-lime-400 shrink-0" />
        <span className="text-sm sm:text-base font-bold tracking-tight">
          💶 PRICING BRAIN
        </span>
        <Badge variant="outline" className="text-[10px] border-lime-500/40 text-lime-700 dark:text-lime-400 shrink-0">
          v8.21
        </Badge>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-lime-500/10" />
          <Skeleton className="h-3 w-3/4 bg-lime-500/10" />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Skeleton className="h-6 bg-lime-500/10" />
            <Skeleton className="h-6 bg-lime-500/10" />
            <Skeleton className="h-6 bg-lime-500/10" />
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchBrain} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="space-y-2.5">
          <p className="text-xs sm:text-sm font-medium leading-snug">
            {data.maximization.oneLineSummary}
          </p>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className={cn('text-[10px]', gradeColor(data.maximization.pricingGrade))}>
              Pricing: {data.maximization.pricingGrade}
            </Badge>
            <Badge variant="outline" className="text-[10px] border-lime-500/30 text-lime-700 dark:text-lime-400">
              Top: {data.maximization.bestOpportunity.toUpperCase()}
            </Badge>
            {data.cachedAt && (
              <Badge variant="outline" className="text-[9px] text-muted-foreground border-muted">
                cache {Math.round((Date.now() - data.cachedAt) / 1000)}s
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-[9px] uppercase text-muted-foreground">Top 3 akcije za danes (pricing)</div>
            {data.maximization.topActions.map((a) => (
              <div key={a.rank} className="flex items-start gap-1.5 text-[11px]">
                <span className="font-bold text-lime-700 dark:text-lime-400 shrink-0 w-3">
                  {a.rank}.
                </span>
                <span className="flex-1 min-w-0">
                  <span className="font-medium">{a.action}</span>
                  <span className="text-muted-foreground"> · +{a.expectedUpliftEUR}€/mo</span>
                </span>
                <span className={cn('text-[9px] font-bold shrink-0', confidenceColor(a.confidence))}>
                  {a.confidence}
                </span>
              </div>
            ))}
          </div>

          {/* Current pricing state */}
          <div className="grid grid-cols-2 gap-1.5 text-[10px] pt-1 border-t border-lime-500/20">
            <span className="text-muted-foreground">
              Margin: <span className="font-bold text-lime-700 dark:text-lime-400">{Math.round(data.current.avgProfitMarginPct)}%</span>
            </span>
            <span className="text-muted-foreground">
              Vs komp.: <span className="font-bold text-lime-700 dark:text-lime-400">{data.current.competitorPriceAvgPct > 100 ? '+' : ''}{Math.round(data.current.competitorPriceAvgPct - 100)}%</span>
            </span>
            <span className="text-muted-foreground">
              Sell-through: <span className="font-bold text-lime-700 dark:text-lime-400">{Math.round(data.current.sellThroughRatePct)}%</span>
            </span>
            <span className="text-muted-foreground">
              Pricing power: <span className="font-bold text-lime-700 dark:text-lime-400">{Math.round(data.current.pricingPower)}/100</span>
            </span>
          </div>

          {/* 30d / 90d pricing projection */}
          <div className="flex items-center justify-between gap-2 text-[10px] pt-1 border-t border-lime-500/10">
            <span className="text-muted-foreground">
              30d: <span className="font-bold text-lime-700 dark:text-lime-400">
                {Math.round(data.maximization.projection30d.projectedMarginPct)}% margin · {Math.round(data.maximization.projection30d.projectedRevenue)}€ · {data.maximization.projection30d.recommendedPriceChangePct >= 0 ? '+' : ''}{data.maximization.projection30d.recommendedPriceChangePct}% · {data.maximization.projection30d.listingsToReprice} repr.
              </span>
            </span>
            <span className="text-muted-foreground">
              90d: <span className="font-bold text-lime-700 dark:text-lime-400">
                {Math.round(data.maximization.projection90d.projectedMarginPct)}% margin · {Math.round(data.maximization.projection90d.projectedRevenue)}€ · {data.maximization.projection90d.recommendedPriceChangePct >= 0 ? '+' : ''}{data.maximization.projection90d.recommendedPriceChangePct}% · {data.maximization.projection90d.listingsToReprice} repr.
              </span>
            </span>
          </div>

          <div className="flex justify-end">
            <button
              onClick={fetchBrain}
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

// --- Actual Profit Card (v8.23, indigo/violet tint) ----------------------
//
// v8.23 NEW PHASE: Validation — "Ali lahko zaupaš Master Brain-u?"
//
// This card shows GROUND TRUTH: actual EUR profit computed from the Trade
// table (status='sold', sellDate within last N days). Placed ABOVE the Master
// Brain banner because ground truth should be the first thing the user sees,
// before predictions. The Master Brain banner shows PREDICTIONS (30d: 3133€);
// this card shows ACTUAL (zadnjih 30 dni: X€ prodano).
//
// Visual hierarchy: Actual Profit (top, indigo, ground truth) → Master Brain
// (gold/amber, predictions) → 7 Domain Brains (detailed drill-down).
//
// Days selector: 7d / 30d / 90d / 12m (12m = 365d).

const ACTUAL_PROFIT_DAYS_PRESETS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '12m', days: 365 },
] as const;

interface ActualProfitResponse {
  ok: true;
  period: string;
  totalProfitEUR: number;
  totalRevenueEUR: number;
  totalCostEUR: number;
  tradeCount: number;
  avgProfitPerTradeEUR: number;
  avgMarginPct: number;
  dailyAvgEUR: number;
  bestTrade: { title: string; profitEUR: number } | null;
  worstTrade: { title: string; profitEUR: number } | null;
}

function ActualProfitCard() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<ActualProfitResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActual = useCallback(async (selectedDays: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/brain/actual-profit?days=${selectedDays}`, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ActualProfitResponse;
      if (!json?.ok) throw new Error('Actual profit API ni vrnil rezultata');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActual(days);
  }, [days, fetchActual]);

  const profitPositive = (data?.totalProfitEUR ?? 0) >= 0;

  return (
    <div className="rounded-xl border-2 border-indigo-500/40 bg-gradient-to-br from-indigo-500/15 via-violet-500/10 to-purple-500/5 p-3 sm:p-4 shadow-sm">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            📊 Dejanski profit
          </span>
          <Badge variant="outline" className="text-[10px] border-indigo-500/50 text-indigo-700 dark:text-indigo-400 shrink-0 font-bold">
            v8.23
          </Badge>
          <Badge variant="outline" className="text-[9px] border-indigo-500/30 text-indigo-700/80 dark:text-indigo-400/80 shrink-0">
            GROUND TRUTH
          </Badge>
        </div>

        {/* Days selector: 7d / 30d / 90d / 12m */}
        <div className="flex items-center gap-0.5 bg-background/50 rounded-md border border-indigo-500/20 p-0.5">
          {ACTUAL_PROFIT_DAYS_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setDays(p.days)}
              className={cn(
                'px-2 py-0.5 text-[10px] font-mono font-semibold rounded transition-colors',
                days === p.days
                  ? 'bg-indigo-500/30 text-indigo-700 dark:text-indigo-300'
                  : 'text-muted-foreground hover:text-foreground hover:bg-indigo-500/10',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full bg-indigo-500/10" />
          <Skeleton className="h-4 w-3/4 bg-indigo-500/10" />
          <div className="grid grid-cols-4 gap-2 pt-1">
            <Skeleton className="h-7 bg-indigo-500/10" />
            <Skeleton className="h-7 bg-indigo-500/10" />
            <Skeleton className="h-7 bg-indigo-500/10" />
            <Skeleton className="h-7 bg-indigo-500/10" />
          </div>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={() => fetchActual(days)} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && data && (
        <div className="space-y-3">
          {/* Big profit number */}
          <div className="text-center px-1">
            <div className={cn(
              'text-3xl sm:text-4xl font-bold font-mono tracking-tight',
              profitPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
            )}>
              {profitPositive ? '+' : ''}{data.totalProfitEUR}€
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {data.dailyAvgEUR >= 0 ? '+' : ''}{data.dailyAvgEUR}€/dan · {data.tradeCount} {data.tradeCount === 1 ? 'trade' : 'trade-ov'} · {data.avgProfitPerTradeEUR}€/trade · {data.avgMarginPct}% margin
            </div>
          </div>

          {/* Metrics grid: revenue / cost / margin / daily avg */}
          <div className="grid grid-cols-4 gap-1.5">
            <div className="rounded border border-indigo-500/30 bg-indigo-500/5 p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Prihodek</div>
              <div className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                {Math.round(data.totalRevenueEUR)}€
              </div>
            </div>
            <div className="rounded border border-indigo-500/30 bg-indigo-500/5 p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Stroški</div>
              <div className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                {Math.round(data.totalCostEUR)}€
              </div>
            </div>
            <div className="rounded border border-indigo-500/30 bg-indigo-500/5 p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Margin</div>
              <div className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                {data.avgMarginPct}%
              </div>
            </div>
            <div className="rounded border border-indigo-500/30 bg-indigo-500/5 p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Na dan</div>
              <div className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                {data.dailyAvgEUR}€
              </div>
            </div>
          </div>

          {/* Best / worst trade pills */}
          {(data.bestTrade || data.worstTrade) && (
            <div className="flex flex-wrap gap-2 justify-center text-[10px]">
              {data.bestTrade && (
                <div className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5">
                  <ArrowUpRight className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-muted-foreground">Naj:</span>
                  <span className="font-semibold truncate max-w-[140px]" title={data.bestTrade.title}>
                    {data.bestTrade.title}
                  </span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">
                    +{data.bestTrade.profitEUR}€
                  </span>
                </div>
              )}
              {data.worstTrade && (
                <div className="flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/5 px-2 py-0.5">
                  <ArrowDownRight className="w-3 h-3 text-red-600 dark:text-red-400 shrink-0" />
                  <span className="text-muted-foreground">Slab:</span>
                  <span className="font-semibold truncate max-w-[140px]" title={data.worstTrade.title}>
                    {data.worstTrade.title}
                  </span>
                  <span className={cn(
                    'font-bold',
                    data.worstTrade.profitEUR >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400',
                  )}>
                    {data.worstTrade.profitEUR >= 0 ? '+' : ''}{data.worstTrade.profitEUR}€
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {data.tradeCount === 0 && (
            <p className="text-[11px] text-muted-foreground italic text-center">
              📭 Ni prodaj v zadnjih {days} dneh. Dodaj prodaje v Trade tabelo za prikaz dejanskega profita.
            </p>
          )}

          {/* Refresh */}
          <div className="flex justify-end">
            <button
              onClick={() => fetchActual(days)}
              className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              Osveži dejanski profit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- User Risk Profile Card (v8.24, violet/indigo tint) ------------------
//
// v8.24: User Risk Profile — makes Master Brain PERSONAL.
//
// Problem (v8.15-v8.23): Master Brain gives the SAME recommendation for a
// conservative user (who wants low risk) and an aggressive user (who wants
// high growth). This is impersonal and wrong.
//
// Solution: 4 user-configurable fields stored in Settings singleton:
//   - riskTolerance: 'conservative' | 'balanced' | 'aggressive'
//   - maxAcceptableRisk: 0-100 (numeric cap)
//   - liquidityReserve: EUR (min cash to keep)
//   - investmentHorizon: 'short' | 'medium' | 'long'
//
// Master Brain (v8.22) endpoint loads these fields and applies
// adjustMasterBrainForRiskProfile() to its result before returning — so the
// recommendationOverride (REDUCE_RISK / ACCEPT_RISK / CAUTIOUS_PROCEED),
// filteredTopActions (HIGH/CRITICAL actions filtered for conservative), and
// adjustedRiskBudget (0.5× / 1.0× / 1.5×) all reflect the user's profile.
//
// Visual: violet/indigo gradient (distinct from Actual Profit's indigo and
// Master Brain's gold/amber). Placed BETWEEN Actual Profit (top) and Master
// Brain banner (predictions) because the profile DEFINES how the predictions
// are interpreted — context before content.

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

function RiskProfileCard() {
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

function BrainSnapshotsSection() {
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

interface AccuracyTrendSummary {
  totalSnapshots: number;
  snapshotsWithAccuracy30d: number;
  snapshotsWithAccuracy90d: number;
  avgAccuracy30d: number | null;
  avgAccuracy90d: number | null;
  trend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';
  firstHalfAvg: number | null;
  secondHalfAvg: number | null;
  message?: string;
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
function gradeTrendPill(grade: string): string {
  return cn('text-[9px] font-bold px-1.5 py-0.5 rounded border', gradeColor(grade));
}

function trendBadgeClass(trend: AccuracyTrendSummary['trend']): string {
  switch (trend) {
    case 'IMPROVING':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
    case 'STABLE':
      return 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400';
    case 'DECLINING':
      return 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400';
    default:
      return 'border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400';
  }
}

function trendIcon(trend: AccuracyTrendSummary['trend']): string {
  switch (trend) {
    case 'IMPROVING':
      return '↗️';
    case 'STABLE':
      return '→';
    case 'DECLINING':
      return '↘️';
    default:
      return '—';
  }
}

const DOMAIN_TREND_LABELS: Array<{ key: keyof AccuracyTrendPoint; label: string }> = [
  { key: 'profitGrade', label: 'Profit' },
  { key: 'inventoryGrade', label: 'Inventar' },
  { key: 'marketGrade', label: 'Trg' },
  { key: 'sourcingGrade', label: 'Sourcing' },
  { key: 'riskGrade', label: 'Tveganje' },
  { key: 'buyerGrade', label: 'Kupci' },
  { key: 'pricingGrade', label: 'Cene' },
];

function AccuracyTrendCard() {
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

type DomainName = 'profit' | 'inventory' | 'market' | 'sourcing' | 'risk' | 'buyer' | 'pricing';

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

function conflictSeverityColor(severity: string): string {
  switch (severity) {
    case 'HIGH':
      return 'text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/5';
    case 'MEDIUM':
      return 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/5';
    default:
      return 'text-zinc-600 dark:text-zinc-400 border-zinc-500/30 bg-zinc-500/5';
  }
}

/**
 * v8.26: Color a 0-100 trustScore value for a pill.
 * ≥70 = emerald (high trust), ≥50 = amber (medium), <50 = red (low trust).
 */
function trustScoreColor(score: number): string {
  if (score >= 70) {
    return 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400';
  }
  if (score >= 50) {
    return 'bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400';
  }
  return 'bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400';
}

/**
 * v8.26: Color a signal grade pill (mirrors the master brain's gradeColor but
 * with slightly tighter styling for the reasoning grid).
 */
function signalGradeColor(grade: string): string {
  return gradeColor(grade);
}

function MasterBrainBanner() {
  const [data, setData] = useState<MasterBrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // v8.26: track which TOP action's "ℹ️ Zakaj?" panel is expanded.
  // null = none expanded; otherwise the action's rank (1-5).
  const [expandedRank, setExpandedRank] = useState<number | null>(null);

  const fetchMaster = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/master', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as MasterBrainResult;
      if (!json?.ok) throw new Error(json?.source ? 'Master Brain ni vrnil rezultata' : 'Napaka');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMaster();
  }, [fetchMaster]);

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

function ScenarioBrainCard() {
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

/**
 * Color the execution rate bar:
 *  - >80% (≥0.8): green — user executes most actions in this domain
 *  - 40-80%: amber — mixed signals
 *  - <40% (<0.4): red — user ignores this domain
 */
function rateColor(rate: number): string {
  if (rate >= 0.8) return 'bg-emerald-500';
  if (rate >= 0.4) return 'bg-amber-500';
  return 'bg-red-500';
}

function rateLabel(rate: number): string {
  if (rate >= 0.8) return 'VISOKA (boost ×1.1)';
  if (rate >= 0.4) return 'SREDNJA';
  return 'NIZKA (reduce ×0.9)';
}

function AdaptiveWeightsCard() {
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

// --- Outer card wrapper (v8.28 Adaptive + v8.27 Scenario + v8.26 Intelligence + v8.25 Accuracy + v8.24 Personal + v8.23 Validation + v8.22 Master + v8.15-v8.21 7 Domains) --------------------
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

function BrainSynthesisCard({ onBrainCategoryClick }: { onBrainCategoryClick: () => void }) {
  return (
    <Card className="border-primary/30">
      <CardContent className="p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 pb-1 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <Brain className="w-5 h-5 text-primary shrink-0" />
            <span className="text-sm sm:text-base font-bold tracking-tight">
              AI BRAIN SYNTHESIS
            </span>
            <Badge variant="outline" className="text-[10px] border-primary/40 text-primary shrink-0">
              v8.28 Adaptive + v8.27 Scenario + v8.26 Explain + v8.25 Accuracy + v8.24 Personal + v8.23 Validation + v8.22 Master + v8.15-v8.21 (7 Domains)
            </Badge>
          </div>
          <button
            onClick={onBrainCategoryClick}
            className="text-[11px] text-primary hover:underline shrink-0 flex items-center gap-1"
          >
            🧠 Možgani kategorija →
          </button>
        </div>

        {/* v8.23: GROUND TRUTH first — actual profit from Trade table */}
        <ActualProfitCard />

        {/* v8.24: User Risk Profile — makes Master Brain PERSONAL (conservative/balanced/aggressive) */}
        <RiskProfileCard />

        {/* v8.22: PREDICTIONS — Master Brain synthesizes 7 Domain Brains */}
        <MasterBrainBanner />

        {/* v8.27: SCENARIO BRAIN — "What If?" simulator. 3 preset scenarios
            (conservative/balanced/aggressive) run Master Brain in parallel,
            show side-by-side comparison + recommendation + custom input form. */}
        <ScenarioBrainCard />

        {/* v8.28: ADAPTIVE DOMAIN WEIGHTS — feedback loop. Master Brain (v8.22)
            used HARDCODED domain weights. v8.28 makes them adaptive — stored
            per-user in Settings.adaptiveDomainWeights (JSON). System learns
            from REVEALED preferences (which actions user actually executes vs
            rejects). Bright orange-tinted card with 7 sliders + stats +
            history + reset + feedback demo form. */}
        <AdaptiveWeightsCard />

        {/* v8.15-v8.21: 7 Domain Brain sections — detailed drill-down */}
        <ProfitBrainSection />
        <InventoryBrainSection />
        <MarketBrainSection />
        <SourcingBrainSection />
        <RiskBrainSection />
        <BuyerBrainSection />
        <PricingBrainSection />

        {/* v8.23: Historical record of Master Brain predictions — foundation for v8.25 */}
        <BrainSnapshotsSection />

        {/* v8.25: Historical Accuracy + Trend — Validation phase CULMINATION.
            Answers "Ali lahko zaupam Master Brain-u?" with actual % data. */}
        <AccuracyTrendCard />
      </CardContent>
    </Card>
  );
}

// ===== AI Runner Modal =====
function AIRunnerModal({ endpoint, onClose }: { endpoint: AIEndpoint | null; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [bodyInput, setBodyInput] = useState('{}');

  useEffect(() => {
    if (endpoint) {
      setResult('');
      setCopied(false);
      setBodyInput(endpoint.bodyHint || '{}');
    }
  }, [endpoint]);

  const run = async () => {
    if (!endpoint) return;
    setLoading(true);
    setResult('');
    try {
      let body;
      try { body = JSON.parse(bodyInput); } catch { body = {}; }
      const res = await fetch(`/api/ai/${endpoint.name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
      if (data.ok) toast.success(`✓ ${endpoint.name} uspešen`);
      else toast.error(data.error ?? 'AI je vrnil napako');
    } catch (e: any) {
      setResult(`Error: ${e?.message ?? 'Napaka'}`);
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  };

  const copyResult = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    toast.success('JSON kopiran');
    setTimeout(() => setCopied(false), 2000);
  };

  if (!endpoint) return null;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Zap className="w-4 h-4 text-primary" />
            AI Runner: <span className="font-mono text-primary">{endpoint.name}</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {endpoint.description}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {/* Body input */}
          <div>
            <label className="text-xs uppercase text-muted-foreground mb-1 block">Request body (JSON)</label>
            <textarea
              value={bodyInput}
              onChange={(e) => setBodyInput(e.target.value)}
              className="w-full text-xs font-mono bg-card/30 border border-border rounded p-2 min-h-[60px] max-h-[120px]"
              placeholder='{}'
            />
          </div>

          {/* Run button */}
          <Button onClick={run} disabled={loading} className="w-full gap-2">
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {loading ? 'AI analizira...' : 'Pošlji AI zahtevo'}
          </Button>

          {/* Result */}
          {result && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs uppercase text-muted-foreground">Rezultat (JSON)</label>
                <button onClick={copyResult} className="text-xs text-primary hover:underline flex items-center gap-1">
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Kopirano' : 'Kopiraj'}
                </button>
              </div>
              <pre className="text-[10px] font-mono bg-card/30 border border-border rounded p-2 max-h-[300px] overflow-y-auto whitespace-pre-wrap break-all">
                {result}
              </pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ===== Tip endpoint-a =====
interface AIEndpoint {
  name: string;
  description: string;
  bodyHint: string;
  category: string;
}

// ===== Glavna komponenta =====
export function AIHubView() {
  const [endpoints, setEndpoints] = useState<AIEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [selectedEndpoint, setSelectedEndpoint] = useState<AIEndpoint | null>(null);

  // Generiraj seznam iz AI_ENDPOINTS.md ali direktno iz route.ts datotek
  useEffect(() => {
    // Statičen seznam generiran iz backend-a (254 endpointov)
    // V produkciji bi to lahko bil API klic na /api/ai/list, a za enostavnost
    // uporabljamo statičen seznam (generiran ob build-izgradnji)
    fetch('/api/ai-list')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.endpoints) {
          // Mirror server-side categorize — guarantees consistency even if
          // /api/ai-list returns a stale category field.
          const normalized: AIEndpoint[] = data.endpoints.map((e: AIEndpoint) => ({
            ...e,
            category: categorize(e.name),
          }));
          setEndpoints(normalized);
        } else {
          // Fallback: prazen seznam (API ne obstaja — uporabnik lahko še vedno išče)
          setEndpoints([]);
        }
      })
      .catch(() => setEndpoints([]))
      .finally(() => setLoading(false));
  }, []);

  // Filter
  const filtered = useMemo(() => {
    let result = endpoints;
    if (activeCategory !== 'all') {
      result = result.filter(e => e.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q)
      );
    }
    return result;
  }, [endpoints, activeCategory, search]);

  // Statistike po kategorijah
  const categoryStats = useMemo(() => {
    const stats: Record<string, number> = {};
    endpoints.forEach(e => { stats[e.category] = (stats[e.category] ?? 0) + 1; });
    return stats;
  }, [endpoints]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        <span className="ml-3 text-sm terminal-glow">Nalagam AI endpointe...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            AI Hub
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {endpoints.length} AI funkcij · {filtered.length} prikazanih
          </p>
        </div>
      </div>

      {/* v8.15: Brain Synthesis Card — top of AI Hub, above stats */}
      <BrainSynthesisCard onBrainCategoryClick={() => setActiveCategory('brain')} />

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {CATEGORIES.map(cat => (
          <Card key={cat.id} className={cn('cursor-pointer transition-all hover:border-primary/40',
            activeCategory === cat.id && 'border-primary bg-primary/5')}
            onClick={() => setActiveCategory(cat.id)}>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground uppercase flex items-center gap-1">
                <span>{cat.icon}</span>
                {cat.label}
              </div>
              <div className={cn('text-xl font-bold font-mono', cat.color)}>
                {cat.id === 'all' ? endpoints.length : (categoryStats[cat.id] ?? 0)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Išči AI funkcijo (npr. 'fraud', 'buyer', 'profit', 'brain'...)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Endpoints grid */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              {endpoints.length === 0
                ? 'AI endpointi še niso naloženi. Za generiranje poženi: bun run dev in obišči /api/ai-list'
                : 'Ni rezultatov za ta iskalni niz.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {filtered.slice(0, 60).map(ep => {
            const cat = CATEGORIES.find(c => c.id === ep.category) ?? CATEGORIES[CATEGORIES.length - 1];
            return (
              <Card
                key={ep.name}
                className={cn(
                  'cursor-pointer hover:border-primary/40 hover:bg-card/50 transition-all group',
                  ep.category === 'brain' && 'border-emerald-500/30 hover:border-emerald-500/50',
                )}
                onClick={() => setSelectedEndpoint(ep)}
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-xs">{cat.icon}</span>
                        <span className="font-mono text-xs font-bold text-foreground truncate group-hover:text-primary">
                          {ep.name}
                        </span>
                        {ep.category === 'brain' && ep.name === 'brain/profit' && (
                          <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400 shrink-0">
                            v8.15
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/inventory' && (
                          <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-600 dark:text-amber-400 shrink-0">
                            v8.16
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/market' && (
                          <Badge variant="outline" className="text-[9px] border-sky-500/40 text-sky-600 dark:text-sky-400 shrink-0">
                            v8.17
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/sourcing' && (
                          <Badge variant="outline" className="text-[9px] border-purple-500/40 text-purple-600 dark:text-purple-400 shrink-0">
                            v8.18
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/risk' && (
                          <Badge variant="outline" className="text-[9px] border-rose-500/40 text-rose-600 dark:text-rose-400 shrink-0">
                            v8.19
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/buyer' && (
                          <Badge variant="outline" className="text-[9px] border-cyan-500/40 text-cyan-600 dark:text-cyan-400 shrink-0">
                            v8.20
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/pricing' && (
                          <Badge variant="outline" className="text-[9px] border-lime-500/40 text-lime-700 dark:text-lime-400 shrink-0">
                            v8.21
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/master' && (
                          <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-700 dark:text-amber-400 shrink-0 font-bold">
                            v8.22 · FINAL
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/actual-profit' && (
                          <Badge variant="outline" className="text-[9px] border-indigo-500/50 text-indigo-700 dark:text-indigo-400 shrink-0 font-bold">
                            v8.23 · GROUND TRUTH
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/snapshots' && (
                          <Badge variant="outline" className="text-[9px] border-emerald-500/50 text-emerald-700 dark:text-emerald-400 shrink-0 font-bold">
                            v8.23 · VALIDATION
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/risk-profile' && (
                          <Badge variant="outline" className="text-[9px] border-violet-500/50 text-violet-700 dark:text-violet-400 shrink-0 font-bold">
                            v8.24 · PERSONAL
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground line-clamp-2">
                        {ep.description || 'Brez opisa'}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Show more / count */}
      {filtered.length > 60 && (
        <div className="text-center text-xs text-muted-foreground py-2">
          Prikažujem prvih 60 od {filtered.length} rezultatov. Zaostriti iskanje za manj rezultatov.
        </div>
      )}

      {/* AI Runner Modal */}
      <AIRunnerModal endpoint={selectedEndpoint} onClose={() => setSelectedEndpoint(null)} />

      {/* Footer */}
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          <p>
            🤖 <b>AI Hub</b> omogoča brskanje in poganjanje vseh {endpoints.length} AI funkcij.
            Klikni na endpoint za podrobnosti in pošiljanje zahteve.
            Body je JSON (privzeto <code className="px-1 bg-card rounded">{`{}`}</code> — prazno).
            Rezultat je prikazan v pretty-print JSON formatu.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
