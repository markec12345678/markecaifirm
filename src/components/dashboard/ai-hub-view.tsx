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
import { Sparkles, Search, Copy, Check, RefreshCw, Zap, X, ChevronRight, ChevronDown, ChevronUp, Brain, AlertCircle, Package, TrendingUp, Target, Shield, Users, Coins, Crown, Camera, Save, History, TrendingDown, ArrowUpRight, ArrowDownRight, Settings2, Info, ClipboardList, Trash2, Filter, Clock, Bot, Power, Play, Undo2, Lock, Activity, AlertOctagon, ShieldAlert, Rocket, HeartPulse, Sprout, Send, MessageCircle, Bell, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// v8.97: Modularized AI Hub components
import { ProfitBrainSection } from './ai-hub/profit-brain-section';
import { InventoryBrainSection } from './ai-hub/inventory-brain-section';
import { MarketBrainSection } from './ai-hub/market-brain-section';
import { SourcingBrainSection } from './ai-hub/sourcing-brain-section';
import { RiskBrainSection } from './ai-hub/risk-brain-section';
import { BuyerBrainSection } from './ai-hub/buyer-brain-section';
import { PricingBrainSection } from './ai-hub/pricing-brain-section';
import { SystemHealthCard } from './ai-hub/system-health-card';
import { SeedAndTelegramCard } from './ai-hub/seed-and-telegram-card';
import { PerformanceCard } from './ai-hub/performance-card';
import { ActualProfitCard } from './ai-hub/actual-profit-card';
import { RiskProfileCard } from './ai-hub/risk-profile-card';
import { BrainSnapshotsSection } from './ai-hub/brain-snapshots-section';
import { AccuracyTrendCard } from './ai-hub/accuracy-trend-card';
import { MasterBrainBanner } from './ai-hub/master-brain-banner';
import { ScenarioBrainCard } from './ai-hub/scenario-brain-card';
import { AdaptiveWeightsCard } from './ai-hub/adaptive-weights-card';
import { DraftQueueCard } from './ai-hub/draft-queue-card';
import { AutoPilotCard } from './ai-hub/auto-pilot-card';


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

// ProfitBrainSection — v8.97: imported from ./ai-hub/profitbrain-section

// InventoryBrainSection — v8.97: imported from ./ai-hub/inventorybrain-section

// MarketBrainSection — v8.97: imported from ./ai-hub/marketbrain-section

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
// SourcingBrainSection — v8.97: imported from ./ai-hub/sourcingbrain-section

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
// RiskBrainSection — v8.97: imported from ./ai-hub/riskbrain-section

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
// BuyerBrainSection — v8.97: imported from ./ai-hub/buyerbrain-section

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
// PricingBrainSection — v8.97: imported from ./ai-hub/pricingbrain-section

// --- System Health Card (v8.32, gradient by status: emerald/amber/red) ---
//
// v8.32 NEW PHASE: Polish — "How healthy is the Brain system?"
//
// One card that aggregates the ENTIRE Brain system's health into a single
// view. Placed at the VERY TOP of BrainSynthesisCard (above Actual Profit
// and Master Brain banner) — health overview FIRST, then ground truth,
// then predictions.
//
// Shows:
//   - Big health score (87/100) with grade pill (A+/A/B/C/D/F) + status pill
//     (HEALTHY/DEGRADED/UNHEALTHY)
//   - 8 Brain endpoints grid (2 rows × 4 cols): each brain with icon + name +
//     status dot (green=responsive, red=error) + response time + grade pill
//   - Data freshness row: latest snapshot date + days ago + trades count +
//     accuracy 30d
//   - Auto-pilot status: enabled/mode + anomaly suspended + today's stats
//   - Draft queue summary: pending + executed + rejected + execution rate
//   - Risk profile: tolerance + max acceptable risk
//   - Adaptive weights: adjusted domains + total executed/rejected
//   - Auto-generated recommendations (5+ rules) — each as actionable pill
//
// Gradient background (status-aware):
//   - HEALTHY (≥80): emerald gradient
//   - DEGRADED (≥50): amber gradient
//   - UNHEALTHY (<50): red gradient
//
// Auto-refreshes every 60 seconds. Fetches /api/ai/brain/health (30s cache).

interface BrainEndpointHealth {
  name: string;
  path: string;
  responsive: boolean;
  responseTimeMs: number;
  lastError: string | null;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' | null;
}

interface SystemHealthReport {
  ok: true;
  timestamp: string;
  overallHealthScore: number;
  overallGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  brainEndpoints: BrainEndpointHealth[];
  dataFreshness: {
    latestSnapshotDate: string | null;
    snapshotsCount: number;
    daysSinceLastSnapshot: number | null;
    accuracy30d: number | null;
    tradesRecorded: number;
  };
  autoPilot: {
    enabled: boolean;
    mode: 'safe' | 'aggressive';
    anomalySuspended: boolean;
    todayAutoExecuted: number;
    todayBudgetUsed: number;
  };
  draftQueue: {
    pending: number;
    executed: number;
    rejected: number;
    expired: number;
    total: number;
    executionRate: number;
  };
  riskProfile: {
    riskTolerance: 'conservative' | 'balanced' | 'aggressive';
    maxAcceptableRisk: number;
  };
  adaptiveWeights: {
    adjustedDomains: number;
    totalExecuted: number;
    totalRejected: number;
  };
  recommendations: string[];
  source: string;
}

// Map brain name → lucide icon + tint color for the endpoint grid chip.
const BRAIN_HEALTH_ICONS: Record<string, { icon: typeof Brain; tint: string }> = {
  profit: { icon: Coins, tint: 'text-emerald-600 dark:text-emerald-400' },
  inventory: { icon: Package, tint: 'text-amber-600 dark:text-amber-400' },
  market: { icon: TrendingUp, tint: 'text-sky-600 dark:text-sky-400' },
  sourcing: { icon: Target, tint: 'text-violet-600 dark:text-violet-400' },
  risk: { icon: Shield, tint: 'text-red-600 dark:text-red-400' },
  buyer: { icon: Users, tint: 'text-cyan-600 dark:text-cyan-400' },
  pricing: { icon: Coins, tint: 'text-lime-600 dark:text-lime-400' },
  master: { icon: Crown, tint: 'text-amber-600 dark:text-amber-400' },
};

function gradeTextColor(grade: string | null): string {
  if (!grade) return 'text-muted-foreground';
  if (grade === 'A+' || grade === 'A') return 'text-emerald-600 dark:text-emerald-400';
  if (grade === 'B') return 'text-sky-600 dark:text-sky-400';
  if (grade === 'C') return 'text-amber-600 dark:text-amber-400';
  if (grade === 'D') return 'text-orange-600 dark:text-orange-400';
  return 'text-red-600 dark:text-red-400';
}
// SystemHealthCard — v8.97: imported from ./ai-hub/systemhealth-card

// --- Seed & Telegram Card (v8.35, lime + cyan gradient) --------------------
//
// v8.35 NEW: Polish phase continues — "Make the system alive."
//
// TWO action areas in one card (because both are about "onboarding" the Brain
// system with real-world signals):
//
//   A. SEED DEMO DATA — if Trade table is empty (0 trades), shows a prominent
//      🌱 button to load 25 realistic Slovenian trade-ov (Bolha/Vinted/
//      Avtonet/mobile.de, electronics/sneakers/clothing/auto/tools, last 90
//      days, mixed margins including one deliberate loss). Idempotent —
//      if trades already exist, the section is hidden.
//
//   B. TELEGRAM BRAIN NOTIFICATIONS — 3 test buttons that send test
//      notifications via the existing Telegram bot:
//        • "Pošlji digest" — sends real Master Brain TOP 5 + health summary
//        • "Pošlji auto-pilot test" — sends a mock auto-pilot execution alert
//        • "Pošlji anomalija test" — sends a mock anomaly suspension alert
//      Each button returns "✅ Poslano" or "❌ Telegram ni konfiguriran"
//      (when Telegram is not set up in Settings).
//
// Placed IMMEDIATELY BELOW 🏥 System Health (health first, then onboarding).
// Dual-tint gradient: lime for seed (growth metaphor) + cyan for Telegram
// (messaging metaphor). Auto-refreshes trade count every 60s.

interface SeedInfo {
  ok: true;
  count: number;
  byStatus: { sold: number; held: number; cancelled: number };
  demoTemplateCount: number;
  source: string;
}
// SeedAndTelegramCard — v8.97: imported from ./ai-hub/seedandtelegram-card

// --- Performance & Cache Stats Card (v8.33, yellow/amber tint) -----------
//
// v8.33 NEW PHASE: Polish continues — "How fast is the Brain system?
// Is the cache working?"
//
// Placed IMMEDIATELY BELOW the 🏥 System Health card (health first, then
// performance). Aggregates two complementary signals:
//
//   1. CACHE STATS (per namespace) — hit/miss/sets counters for each brain
//      layer's in-memory cache (master-brain, profit-brain, ...). The
//      overall hit rate (weighted) is the headline metric — a healthy
//      system should hit ≥70% (cache is doing its job).
//
//   2. PERF STATS (per brain) — rolling-window (last 100 calls) response
//      times per brain: avg, p50 (median), p95, p99, min, max, last.
//      Color-coded thresholds: green <50ms, amber 50-200ms, red >200ms.
//      cacheHitRate here is derived from the perf entries themselves
//      (cached flag set by recordPerf on each call) — independent from the
//      ai-cache.ts counter, so a useful cross-check.
//
// Action buttons:
//   - 🔄 Osveži — manual refetch (auto-refresh every 30s)
//   - 🗑️ Reset stats — POST { action: 'reset' } to clear counters
//
// Fetches /api/ai/brain/performance. Yellow/amber gradient (visual link
// to the lightning/⚡ emoji — "this is the speed card").

interface CacheStatsRow {
  namespace: string;
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
  hitRate: number;
  total: number;
}

interface PerfStatsRow {
  brain: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  cacheHitRate: number;
  lastDurationMs: number;
}

interface PerformanceReport {
  ok: true;
  timestamp: string;
  cacheStats: CacheStatsRow[];
  perfStats: PerfStatsRow[];
  cacheStoreSize: number;
  summary: {
    overallHitRate: number;
    totalRequests: number;
    totalCached: number;
    avgResponseTimeMs: number;
    p95ResponseTimeMs: number;
  };
  source: string;
}

// Color thresholds (shared between cache hit rate + response time).
function hitRateColor(rate: number): string {
  if (rate >= 70) return 'text-emerald-600 dark:text-emerald-400';
  if (rate >= 40) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function responseTimeColor(ms: number): string {
  if (ms < 50) return 'text-emerald-600 dark:text-emerald-400';
  if (ms <= 200) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function hitRateBarColor(rate: number): string {
  if (rate >= 70) return 'bg-emerald-500';
  if (rate >= 40) return 'bg-amber-500';
  return 'bg-red-500';
}

// Human-readable namespace label — strip the "-brain" suffix and capitalize.
function namespaceLabel(ns: string): string {
  return ns.replace(/-brain$/, '').replace(/^./, (c) => c.toUpperCase());
}
// PerformanceCard — v8.97: imported from ./ai-hub/performance-card

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
// ActualProfitCard — v8.97: imported from ./ai-hub/actualprofit-card

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
// RiskProfileCard — v8.97: imported from ./ai-hub/riskprofile-card

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
// BrainSnapshotsSection — v8.97: imported from ./ai-hub/brainsnapshots-section

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
// AccuracyTrendCard — v8.97: imported from ./ai-hub/accuracytrend-card

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
// MasterBrainBanner — v8.97: imported from ./ai-hub/masterbrainbanner

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
// ScenarioBrainCard — v8.97: imported from ./ai-hub/scenariobrain-card

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
// AdaptiveWeightsCard — v8.97: imported from ./ai-hub/adaptiveweights-card

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

type DraftStatus = 'pending' | 'approved' | 'executed' | 'rejected' | 'expired';

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

/**
 * v8.29: Color a draft status pill.
 *   pending   = blue (awaiting decision)
 *   approved  = amber (user is considering)
 *   executed  = green (user marked ✅ Izvedel)
 *   rejected  = red (user marked ❌ Zavrnil)
 *   expired   = gray (replaced by newer recommendations)
 */
function draftStatusColor(status: DraftStatus): string {
  switch (status) {
    case 'pending':
      return 'text-blue-600 dark:text-blue-400 border-blue-500/30 bg-blue-500/5';
    case 'approved':
      return 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/5';
    case 'executed':
      return 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5';
    case 'rejected':
      return 'text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/5';
    case 'expired':
      return 'text-zinc-500 dark:text-zinc-500 border-zinc-500/30 bg-zinc-500/5';
    default:
      return 'text-muted-foreground border-border';
  }
}

function draftStatusLabel(status: DraftStatus): string {
  switch (status) {
    case 'pending': return '⏳ Čaka';
    case 'approved': return '👍 Odobreno';
    case 'executed': return '✅ Izvedeno';
    case 'rejected': return '❌ Zavrnjeno';
    case 'expired': return '⌛ Poteklo';
    default: return status;
  }
}
// DraftQueueCard — v8.97: imported from ./ai-hub/draftqueue-card

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
// AutoPilotCard — v8.97: imported from ./ai-hub/autopilot-card

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

interface NotificationCenterItem {
  id: string;
  type: string;
  title: string;
  body: string;
  severity: string;
  source: string;
  isRead: boolean;
  readAt: string | null;
  draftId: string | null;
  snapshotDate: string | null;
  metadata: string | null;
  createdAt: string;
}

interface NotificationCenterStats {
  total: number;
  unread: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
}

interface NotificationCenterData {
  ok: true;
  notifications: NotificationCenterItem[];
  stats: NotificationCenterStats;
}

const NOTIFICATION_TYPE_LABELS: Record<string, { label: string; icon: string }> = {
  brain_digest: { label: 'Brain Digest', icon: '🧠' },
  autopilot_executed: { label: 'Auto-pilot', icon: '🤖' },
  autopilot_rollback: { label: 'Auto-pilot Rollback', icon: '↩️' },
  anomaly: { label: 'Anomalija', icon: '⚠️' },
  price_drop: { label: 'Cena padec', icon: '📉' },
  system: { label: 'Sistem', icon: '🔧' },
  trade_sold: { label: 'Trade prodan', icon: '💰' },
  error: { label: 'Napaka', icon: '❌' },
  buy_request_match: { label: 'Iskalnik ujemanje', icon: '🔍' },
};

const NOTIFICATION_SEVERITY_STYLES: Record<string, string> = {
  info: 'border-sky-500/40 bg-sky-500/5 text-sky-700 dark:text-sky-300',
  success: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
  warning: 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300',
  error: 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-300',
};

function severityBadgeClass(severity: string): string {
  return NOTIFICATION_SEVERITY_STYLES[severity] ?? NOTIFICATION_SEVERITY_STYLES.info;
}

function timeAgo(isoDate: string): string {
  const d = new Date(isoDate);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'zdaj';
  if (diffMin < 60) return `${diffMin} min nazaj`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} h nazaj`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} d nazaj`;
  return d.toLocaleDateString('sl-SI');
}

function NotificationCenterCard() {
  const [data, setData] = useState<NotificationCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterRead, setFilterRead] = useState<string>('all');
  const [acting, setActing] = useState<string | null>(null); // 'markAll' | 'deleteRead' | notificationId

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      params.set('days', '30');
      if (filterType !== 'all') params.set('type', filterType);
      if (filterSeverity !== 'all') params.set('severity', filterSeverity);
      if (filterRead !== 'all') params.set('isRead', filterRead);
      const res = await fetch(`/api/brain-notifications?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.ok) throw new Error('API failed');
      setData(json);
    } catch {
      // Silent fail — the card just shows empty state
    } finally {
      setLoading(false);
    }
  }, [filterType, filterSeverity, filterRead]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(fetchData, 30 * 1000);
    return () => clearInterval(id);
  }, [fetchData]);

  const handleMarkRead = useCallback(async (id: string) => {
    setActing(id);
    try {
      const res = await fetch(`/api/brain-notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? 'Failed');
      toast.success('✓ Označeno kot prebrano');
      await fetchData();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setActing(null);
    }
  }, [fetchData]);

  const handleDelete = useCallback(async (id: string) => {
    setActing(id);
    try {
      const res = await fetch(`/api/brain-notifications/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? 'Failed');
      toast.success('✓ Izbrisano');
      await fetchData();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setActing(null);
    }
  }, [fetchData]);

  const handleMarkAllRead = useCallback(async () => {
    setActing('markAll');
    try {
      const res = await fetch('/api/brain-notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_all_read' }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? 'Failed');
      toast.success(`✓ ${json.updated} obvestil označenih kot prebranih`);
      await fetchData();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setActing(null);
    }
  }, [fetchData]);

  const handleDeleteRead = useCallback(async () => {
    setActing('deleteRead');
    try {
      const res = await fetch('/api/brain-notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_read' }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? 'Failed');
      toast.success(`✓ ${json.deleted} prebranih obvestil izbrisanih`);
      await fetchData();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setActing(null);
    }
  }, [fetchData]);

  const notifications = data?.notifications ?? [];
  const stats = data?.stats ?? { total: 0, unread: 0, byType: {}, bySeverity: {} };

  return (
    <div
      id="notification-center"
      className="rounded-xl border-2 bg-gradient-to-br from-orange-500/10 via-amber-500/5 to-yellow-500/5 border-orange-500/30 p-3 sm:p-4 shadow-sm scroll-mt-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Bell className="w-5 h-5 shrink-0 text-orange-600 dark:text-orange-400" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            🔔 Notification Center
          </span>
          <Badge variant="outline" className="text-[10px] border-orange-500/50 text-orange-700 dark:text-orange-300 shrink-0 font-bold">
            v8.38
          </Badge>
          {stats.unread > 0 && (
            <Badge className="text-[10px] bg-red-500 text-white border-0 shrink-0 font-bold animate-pulse">
              {stats.unread} novo
            </Badge>
          )}
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-2.5 h-2.5', loading && 'animate-spin')} />
          Osveži
        </button>
      </div>

      {/* Filter bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 mb-2.5">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="text-[10px] h-7 rounded border border-border bg-background px-2"
          aria-label="Filter po tipu"
        >
          <option value="all">Vsi tipi</option>
          {Object.entries(NOTIFICATION_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
          className="text-[10px] h-7 rounded border border-border bg-background px-2"
          aria-label="Filter po teži"
        >
          <option value="all">Vse teže</option>
          <option value="info">ℹ️ Info</option>
          <option value="success">✅ Success</option>
          <option value="warning">⚠️ Warning</option>
          <option value="error">❌ Error</option>
        </select>
        <select
          value={filterRead}
          onChange={(e) => setFilterRead(e.target.value)}
          className="text-[10px] h-7 rounded border border-border bg-background px-2"
          aria-label="Filter po statusu prebranosti"
        >
          <option value="all">Vsa (prebrana + neprebrana)</option>
          <option value="false">📨 Samo neprebrana</option>
          <option value="true">✓ Samo prebrana</option>
        </select>
      </div>

      {/* Stats row */}
      <div className="text-[10px] text-muted-foreground mb-2 flex flex-wrap items-center gap-1.5">
        <span className="font-mono">
          <span className="font-bold text-foreground">{stats.total}</span> skupaj
        </span>
        <span className="text-muted-foreground/50">·</span>
        <span className="font-mono">
          <span className={cn('font-bold', stats.unread > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground')}>
            {stats.unread}
          </span>{' '}neprebranih
        </span>
        {Object.entries(stats.byType).slice(0, 5).map(([type, count]) => (
          <span key={type} className="text-muted-foreground/50">
            · <span className="font-mono font-bold">{count}</span> {NOTIFICATION_TYPE_LABELS[type]?.label ?? type}
          </span>
        ))}
      </div>

      {/* Notification list (scrollable, max-h-96 with custom scrollbar styling) */}
      <div className="max-h-96 overflow-y-auto rounded border border-border bg-card/30">
        {loading ? (
          <div className="p-4 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Nalagam obvestila...
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-muted-foreground">
            <Bell className="w-6 h-6 mx-auto mb-2 opacity-40" />
            Ni obvestil v zadnjih 30 dneh.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {notifications.map((n) => {
              const typeMeta = NOTIFICATION_TYPE_LABELS[n.type] ?? { label: n.type, icon: '🔔' };
              const truncatedBody = n.body.length > 200 ? n.body.slice(0, 200) + '...' : n.body;
              return (
                <div
                  key={n.id}
                  className={cn(
                    'p-2.5 transition-colors',
                    !n.isRead && 'bg-orange-500/5 border-l-2 border-l-orange-500',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-base shrink-0 mt-0.5" aria-hidden="true">{typeMeta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-semibold leading-tight flex items-center gap-1.5">
                            {!n.isRead && (
                              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0 animate-pulse" aria-label="neprebrano" />
                            )}
                            <span className="truncate">{n.title}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2 break-words">
                            {truncatedBody}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className={cn(
                              'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase',
                              severityBadgeClass(n.severity),
                            )}>
                              {n.severity}
                            </span>
                            <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                              <Clock className="w-2 h-2" />
                              {timeAgo(n.createdAt)}
                            </span>
                            <span className="text-[9px] text-muted-foreground">
                              · {n.source}
                            </span>
                          </div>
                          {/* v8.77: Action button za buy_request_match — deep link v Iskalnik */}
                          {n.type === 'buy_request_match' && (() => {
                            let buyRequestId: string | null = null;
                            try {
                              const meta = typeof n.metadata === 'string' ? JSON.parse(n.metadata) : n.metadata;
                              buyRequestId = meta?.buyRequestId || null;
                            } catch { /* ignore */ }
                            if (!buyRequestId) return null;
                            return (
                              <a
                                href={`/?view=iskalnik&matchRequestId=${encodeURIComponent(buyRequestId)}`}
                                className="inline-flex items-center gap-0.5 mt-1.5 px-2 py-0.5 rounded border border-primary/40 bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 transition-colors"
                                title="Prikaži ujemanja v Iskalniku"
                              >
                                <Eye className="w-2.5 h-2.5" /> Prikaži ujemanja
                              </a>
                            );
                          })()}
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          {!n.isRead && (
                            <button
                              onClick={() => handleMarkRead(n.id)}
                              disabled={acting === n.id}
                              title="Označi kot prebrano"
                              aria-label="Označi kot prebrano"
                              className="text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-50 p-1 rounded hover:bg-accent"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(n.id)}
                            disabled={acting === n.id}
                            title="Izbriši"
                            aria-label="Izbriši obvestilo"
                            className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 p-1 rounded hover:bg-accent"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bulk actions */}
      <div className="flex flex-wrap gap-1.5 mt-2.5">
        <Button
          onClick={handleMarkAllRead}
          disabled={acting === 'markAll' || stats.unread === 0}
          size="sm"
          variant="outline"
          className="h-7 text-[10px] border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
        >
          {acting === 'markAll' ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
          Označi vse kot prebrano
        </Button>
        <Button
          onClick={handleDeleteRead}
          disabled={acting === 'deleteRead'}
          size="sm"
          variant="outline"
          className="h-7 text-[10px] border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-500/10"
        >
          {acting === 'deleteRead' ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Trash2 className="w-3 h-3 mr-1" />}
          Izbriši prebrane
        </Button>
      </div>

      {/* Footer */}
      <div className="mt-2 text-[9px] text-muted-foreground/70 leading-relaxed">
        💡 Avto-osvežitev vsakih 30s. Prikazujem zadnjih 30 dni. Tipi: 🧠 Brain digest · 🤖 Auto-pilot · ⚠️ Anomalija · 🔧 Sistem. Telegram + DB log — tudi če Telegram ni konfiguriran, so obvestila zabeležena tukaj.
      </div>
    </div>
  );
}

/**
 * v8.38: Notification Bell icon — shown in the BrainSynthesisCard header.
 * Displays the unread count as a red badge + opens a dropdown with the most
 * recent 5 unread notifications + a "Glej vse" link that scrolls to the
 * full NotificationCenterCard section below.
 *
 * Polls /api/brain-notifications?limit=5&days=7&isRead=false every 30s for
 * the unread count + recent items.
 */
function NotificationBellDropdown({ onJumpToCenter }: { onJumpToCenter: () => void }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState<number>(0);
  const [recent, setRecent] = useState<NotificationCenterItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchUnread = async () => {
      try {
        const res = await fetch('/api/brain-notifications?limit=5&days=7&isRead=false');
        if (!res.ok) return;
        const json = await res.json();
        if (!json?.ok) return;
        if (cancelled) return;
        setUnread(json.stats.unread);
        setRecent(json.notifications);
      } catch {
        // Silent
      }
    };
    fetchUnread();
    const id = setInterval(fetchUnread, 30 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const handleMarkReadFromDropdown = useCallback(async (id: string) => {
    setLoading(true);
    try {
      await fetch(`/api/brain-notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true }),
      });
      toast.success('✓ Označeno kot prebrano');
      // Refresh the dropdown
      const res = await fetch('/api/brain-notifications?limit=5&days=7&isRead=false');
      if (res.ok) {
        const json = await res.json();
        if (json?.ok) {
          setUnread(json.stats.unread);
          setRecent(json.notifications);
        }
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-1.5 rounded-md hover:bg-accent transition-colors"
        title={unread > 0 ? `${unread} neprebranih obvestil` : 'Obvestila'}
        aria-label={`Obvestila — ${unread} neprebranih`}
        aria-expanded={open}
      >
        <Bell className={cn('w-4 h-4', unread > 0 && 'text-orange-500 animate-pulse')} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          {/* Backdrop (click outside to close) */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          {/* Dropdown panel */}
          <div className="absolute right-0 top-full mt-1 w-72 sm:w-80 max-h-[400px] flex flex-col bg-popover border border-border rounded-md shadow-lg z-50">
            <div className="flex items-center justify-between p-2 border-b border-border">
              <span className="text-xs font-bold flex items-center gap-1">
                <Bell className="w-3 h-3" />
                Obvestila
                {unread > 0 && (
                  <Badge className="text-[9px] bg-red-500 text-white border-0 px-1 py-0 h-4">
                    {unread}
                  </Badge>
                )}
              </span>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent"
                aria-label="Zapri"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {recent.length === 0 ? (
                <div className="p-4 text-center text-[11px] text-muted-foreground">
                  <Bell className="w-6 h-6 mx-auto mb-2 opacity-40" />
                  Ni neprebranih obvestil.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {recent.map((n) => {
                    const typeMeta = NOTIFICATION_TYPE_LABELS[n.type] ?? { label: n.type, icon: '🔔' };
                    return (
                      <div key={n.id} className="p-2 hover:bg-accent/50 transition-colors">
                        <div className="flex items-start gap-1.5">
                          <span className="text-sm shrink-0">{typeMeta.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-semibold truncate">{n.title}</div>
                            <p className="text-[10px] text-muted-foreground line-clamp-2">{n.body}</p>
                            <div className="flex items-center justify-between mt-0.5">
                              <span className="text-[9px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                              <button
                                onClick={() => handleMarkReadFromDropdown(n.id)}
                                disabled={loading}
                                className="text-[9px] text-primary hover:underline disabled:opacity-50"
                              >
                                ✓ Preberi
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="p-2 border-t border-border flex items-center justify-between gap-2">
              <button
                onClick={() => { setOpen(false); onJumpToCenter(); }}
                className="text-[10px] text-primary hover:underline flex items-center gap-1"
              >
                Glej vse →
              </button>
              <span className="text-[9px] text-muted-foreground">{unread} neprebranih</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BrainSynthesisCard({ onBrainCategoryClick }: { onBrainCategoryClick: () => void }) {
  const jumpToNotificationCenter = useCallback(() => {
    if (typeof document !== 'undefined') {
      const el = document.getElementById('notification-center');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

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
              v8.38 Notification Center + v8.35 Seed+Telegram + v8.33 Performance + v8.32 Health + v8.31 Auto-pilot + v8.29 Draft Queue + v8.28 Adaptive + v8.27 Scenario + v8.26 Explain + v8.25 Accuracy + v8.24 Personal + v8.23 Validation + v8.22 Master + v8.15-v8.21 (7 Domains)
            </Badge>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* v8.38: Notification Bell — unread count badge + dropdown with recent 5 + "Glej vse" link */}
            <NotificationBellDropdown onJumpToCenter={jumpToNotificationCenter} />
            <button
              onClick={onBrainCategoryClick}
              className="text-[11px] text-primary hover:underline shrink-0 flex items-center gap-1"
            >
              🧠 Možgani kategorija →
            </button>
          </div>
        </div>

        {/* v8.32: SYSTEM HEALTH DASHBOARD — POLISH PHASE.
            "How healthy is the Brain system?" One card that aggregates the
            entire Brain system's health into one view: 8 brain endpoints
            status + cache hit rates + auto-pilot status + draft queue +
            data freshness + risk profile + adaptive weights + auto-generated
            recommendations + overall health score 0-100.
            Gradient background: emerald HEALTHY / amber DEGRADED / red UNHEALTHY. */}
        <SystemHealthCard onBrainCategoryClick={onBrainCategoryClick} />

        {/* v8.35: SEED DATA + TELEGRAM BRAIN NOTIFICATIONS — POLISH PHASE CONTINUES.
            "Make the system alive." TWO action areas in one card:
            (A) Seed Demo Data — if Trade table is empty (0 trades), shows a
                prominent 🌱 button to load 25 realistic Slovenian trades. After
                seeding, the page auto-refreshes so Actual Profit + Accuracy +
                all brain signals pick up the new data.
            (B) Telegram Brain Notifications — 3 test buttons (digest/autopilot/
                anomaly) that send test notifications via the existing Telegram
                bot. Returns "✅ Poslano" or "❌ Telegram ni konfiguriran".
            Dual-tint gradient: lime (growth) + cyan (messaging). */}
        <SeedAndTelegramCard />

        {/* v8.33: PERFORMANCE + CACHE STATS — POLISH PHASE CONTINUES.
            "How fast is the Brain system? Is the cache working?" Placed
            immediately below System Health (health first, then performance).
            Shows per-namespace cache hit/miss/sets + per-brain response
            times (avg/p50/p95/p99/min/max) + overall summary (4 big numbers)
            + reset button. Auto-refresh every 30s. Yellow/amber gradient
            (visual link to ⚡ emoji — "speed card"). */}
        <PerformanceCard onBrainCategoryClick={onBrainCategoryClick} />

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

        {/* v8.29: DRAFT QUEUE — CLOSED FEEDBACK LOOP (Intelligence phase CULMINATION).
            Each Master Brain TOP 5 action becomes a draft row. When the user
            clicks ✅ Izvedel or ❌ Zavrnil (on the Master Brain banner OR in this
            card), the draft's status updates AND recordActionFeedback (v8.28) is
            called → adaptive weights re-evaluate → better ranking next time.
            Slate/blue-gray-tinted card. Stats + filter bar + draft list (max-h-96
            scrollable) + per-domain execution rates + cleanup button. */}
        <DraftQueueCard />

        {/* v8.30: SAFE AUTO-PILOT — AUTOMATION PHASE STARTED.
            Automatically executes ONLY LOW-risk drafts that meet ALL 8 safety
            rules (enabled + safe mode + non-conservative + confidence=LOW +
            uplift<100€ + domain!=risk + daily limit + daily budget). MEDIUM/HIGH
            risk drafts stay pending for manual ✅ Izvedel click. Each auto-executed
            draft is rollbackable — undo calls recordActionFeedback('rejected') to
            balance the learning signal. Purple/indigo-tinted card. Master switch +
            config sliders + today's stats + all-time stats + run button + history
            modal with rollback + safety info box. */}
        <AutoPilotCard />

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

        {/* v8.38: NOTIFICATION CENTER + ALERT HISTORY — POLISH PHASE CONTINUES.
            "What happened in the Brain system?" Centralized history of ALL
            notifications: Brain digests (sendBrainDigest), auto-pilot executions
            (sendAutoPilotAlert), anomalies (sendAnomalyAlert), system events.
            Bell icon in header shows unread count + dropdown with recent 5.
            This card (below) shows full filterable list + bulk actions +
            auto-refresh 30s. Fetches /api/brain-notifications?limit=50&days=30.
            Orange/amber-tinted card (visual link to 🔔 bell emoji). */}
        <NotificationCenterCard />
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
                        {ep.category === 'brain' && ep.name === 'brain/accuracy' && (
                          <Badge variant="outline" className="text-[9px] border-teal-500/50 text-teal-700 dark:text-teal-400 shrink-0 font-bold">
                            v8.25 · ACCURACY
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/explain' && (
                          <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-700 dark:text-amber-400 shrink-0 font-bold">
                            v8.26 · WHY
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/scenario' && (
                          <Badge variant="outline" className="text-[9px] border-rose-500/50 text-rose-700 dark:text-rose-400 shrink-0 font-bold">
                            v8.27 · WHAT IF?
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/weights' && (
                          <Badge variant="outline" className="text-[9px] border-orange-500/50 text-orange-700 dark:text-orange-400 shrink-0 font-bold">
                            v8.28 · LEARNING
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/drafts' && (
                          <Badge variant="outline" className="text-[9px] border-slate-500/50 text-slate-700 dark:text-slate-300 shrink-0 font-bold">
                            v8.29 · ACTION
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/drafts/[id]' && (
                          <Badge variant="outline" className="text-[9px] border-slate-500/50 text-slate-700 dark:text-slate-300 shrink-0 font-bold">
                            v8.29 · PATCH
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/auto-pilot' && (
                          <Badge variant="outline" className="text-[9px] border-purple-500/50 text-purple-700 dark:text-purple-300 shrink-0 font-bold">
                            v8.31 · AUTO+
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/auto-pilot/rollback' && (
                          <Badge variant="outline" className="text-[9px] border-purple-500/50 text-purple-700 dark:text-purple-300 shrink-0 font-bold">
                            v8.30 · UNDO
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
