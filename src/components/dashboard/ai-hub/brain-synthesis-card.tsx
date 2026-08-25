'use client';

// v8.98: BrainSynthesisCard — extracted from ai-hub-view.tsx.
import { useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Brain } from 'lucide-react';

// Import all brain sub-components
import { SystemHealthCard } from './system-health-card';
import { SeedAndTelegramCard } from './seed-and-telegram-card';
import { PerformanceCard } from './performance-card';
import { ActualProfitCard } from './actual-profit-card';
import { RiskProfileCard } from './risk-profile-card';
import { MasterBrainBanner } from './master-brain-banner';
import { ScenarioBrainCard } from './scenario-brain-card';
import { AdaptiveWeightsCard } from './adaptive-weights-card';
import { DraftQueueCard } from './draft-queue-card';
import { AutoPilotCard } from './auto-pilot-card';
import { ProfitBrainSection } from './profit-brain-section';
import { InventoryBrainSection } from './inventory-brain-section';
import { MarketBrainSection } from './market-brain-section';
import { SourcingBrainSection } from './sourcing-brain-section';
import { RiskBrainSection } from './risk-brain-section';
import { BuyerBrainSection } from './buyer-brain-section';
import { PricingBrainSection } from './pricing-brain-section';
import { BrainSnapshotsSection } from './brain-snapshots-section';
import { AccuracyTrendCard } from './accuracy-trend-card';
import { NotificationCenterCard } from './notification-center-card';
import { NotificationBellDropdown } from './notification-bell-dropdown';

export function BrainSynthesisCard({ onBrainCategoryClick }: { onBrainCategoryClick: () => void }) {
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

