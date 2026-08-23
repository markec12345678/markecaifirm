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
import { NotificationCenterCard } from './ai-hub/notification-center-card';
import { NotificationBellDropdown } from './ai-hub/notification-bell-dropdown';
import { BrainSynthesisCard } from './ai-hub/brain-synthesis-card';
import { AIRunnerModal } from './ai-hub/ai-runner-modal';
import type { AIEndpoint } from './ai-hub/types';

// v9.12: Import helpers from shared utils (removed inline duplicates)
import { CATEGORIES, DOMAIN_DISPLAY, DOMAIN_LABELS, categorize, confidenceColor, conflictSeverityColor, draftStatusColor, draftStatusLabel, gradeColor, gradeTextColor, gradeTrendPill, hitRateBarColor, hitRateColor, namespaceLabel, rateColor, rateLabel, responseTimeColor, riskLevelColor, signalGradeColor, trendBadgeClass, trendIcon, trustScoreColor, ACTUAL_PROFIT_DAYS_PRESETS, RISK_TOLERANCE_OPTIONS, INVESTMENT_HORIZON_OPTIONS, DOMAIN_TREND_LABELS } from './ai-hub/utils';

// v9.12: Import types from shared types (removed inline duplicates)
import type { AccuracyApiResponse, AccuracyTrendPoint, AccuracyTrendSummary, ActionExplanation, ActualProfitResponse, AdaptiveWeightsMap, AdaptiveWeightsResponse, AutoPilotHistoryDraft, AutoPilotHistoryResponse, AutoPilotMode, AutoPilotRunResponse, AutoPilotStatsResponse, BrainAction, BrainEndpointHealth, BrainResult, BuyerBrainResult, CacheStatsRow, ClearAnomalyResponse, DisableAggressiveResponse, DomainName, DomainWeightStats, DraftQueueResponse, DraftRow, DraftStatus, EnableAggressiveResponse, InventoryBrainResult, InvestmentHorizon, MarketBrainResult, MasterBrainExplanation, MasterBrainResult, PerfStatsRow, PerformanceReport, PricingBrainResult, RiskBrainResult, RiskProfileAdjustment, RiskProfileApiResponse, RiskTolerance, ScenarioComparisonResponse, SeedInfo, SnapshotView, SnapshotsApiResponse, SourcingBrainResult, SystemHealthReport, UserRiskProfile } from './ai-hub/types';



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

// v8.17: Market Brain result — projection30d/projection90d are STRUCTURED
// objects with `predictedPhase` + `predictedPriceChangePct` + `recommendedAction`
// (BUY/SELL/HOLD/LIQUIDATE). Different from both Profit (scalars) and
// v8.16: Inventory Brain result — different `current` and `maximization`
// ProfitBrainSection — v8.97: imported from ./ai-hub/profitbrain-section

// InventoryBrainSection — v8.97: imported from ./ai-hub/inventorybrain-section

// MarketBrainSection — v8.97: imported from ./ai-hub/marketbrain-section

// --- Sourcing Brain section (v8.18, purple/violet) -------------------------

// v8.18: Sourcing Brain result — different `current` shape (per-source array)
// and different `maximization` shape (projection30d/projection90d are STRUCTURED
// objects with recommendedSourceToScale + recommendedSourceToReduce +
// projectedConcentrationPct + recommendedNewSource). Distinct from Profit
// (scalars), Inventory (recommendedItemsToSell/Buy + projectedInventoryValue),
// SourcingBrainSection — v8.97: imported from ./ai-hub/sourcingbrain-section

// --- Risk Brain section (v8.19, red/rose) ----------------------------------
//
// v8.19: Risk Brain result — projection30d/projection90d are STRUCTURED
// objects with projectedRiskScore + projectedConcentrationPct +
// projectedAgedPct + recommendedRiskBudget. Each signal has a `riskLevel`
// (LOW/MEDIUM/HIGH/CRITICAL) inverse to score, and `riskReductionEUR` (EUR
// RiskBrainSection — v8.97: imported from ./ai-hub/riskbrain-section

// --- Buyer Brain section (v8.20, cyan/teal) ---------------------------------
//
// v8.20: Buyer Brain result — projection30d/projection90d are STRUCTURED
// objects with projectedActiveBuyers + projectedLTV + projectedChurnRatePct +
// recommendedOutreachCount. Each signal has score + grade + upliftEURPerMonth +
// topLever (same shape as Profit/Inventory/Market/Sourcing — NOT inverted like
// BuyerBrainSection — v8.97: imported from ./ai-hub/buyerbrain-section

// --- Pricing Brain section (v8.21, green/lime) --------------------------------
//
// v8.21: Pricing Brain result — projection30d/projection90d are STRUCTURED
// objects with projectedMarginPct + projectedRevenue +
// recommendedPriceChangePct + listingsToReprice. Each signal has score +
// grade + upliftEURPerMonth + topLever (same shape as Profit/Inventory/
// Market/Sourcing/Buyer — NOT inverted like Risk). Distinct from all six
// prior Brains. Also exposes a `pricingPower` composite (0-100) on `current`
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

/**
 * v8.26: Color a 0-100 trustScore value for a pill.
 * ≥70 = emerald (high trust), ≥50 = amber (medium), <50 = red (low trust).
 */
/**
 * v8.26: Color a signal grade pill (mirrors the master brain's gradeColor but
 * with slightly tighter styling for the reasoning grid).
 */
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

/**
 * Color the execution rate bar:
 *  - >80% (≥0.8): green — user executes most actions in this domain
 *  - 40-80%: amber — mixed signals
 *  - <40% (<0.4): red — user ignores this domain
 */
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

/**
 * v8.29: Color a draft status pill.
 *   pending   = blue (awaiting decision)
 *   approved  = amber (user is considering)
 *   executed  = green (user marked ✅ Izvedel)
 *   rejected  = red (user marked ❌ Zavrnil)
 *   expired   = gray (replaced by newer recommendations)
 */
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

// v8.98: extracted to ./ai-hub/ module
// v8.98: extracted to ./ai-hub/ module
// v8.98: extracted to ./ai-hub/ module
// v8.98: extracted to ./ai-hub/ module
// v8.98: extracted to ./ai-hub/ module
// v8.98: extracted to ./ai-hub/ module
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
