// v7.70: Inventory Lifecycle Stage Classifier — klasificira vsak HELD inventar
// v lifecycle stadij (INTAKE → PROCESSING → LISTED → ACTIVE → AGING → STALE →
// DEAD). Prikaže v katerem stadiju je vsak item in kaj storiti. Pure DB
// analytics — NO AI.
//
// "INTAKE: 2, PROCESSING: 1, LISTED: 3, ACTIVE: 2, AGING: 1, STALE: 1, DEAD: 0.
//  Bottleneck: LISTED (3 item-ov čaka aktivnost)."
//
// Razlika od inventory-lifecycle (ki upravlja lifecycle workflow) — ta
// KLASIFICIRA vsak item v eno od 7 stadijev. Razlika od
// inventory-lifecycle-optimizer-v2 (ki optimizira prehode med stadiji) — ta
// samo pokaže trenutni stadij in priporočilo. Razlika od inventory-aging-
// predictor-v2 (ki napoveduje kdaj bo item zastarel) — ta pove KAJ STORITI ZDaj
// glede na trenutni stadij. Razlika od listing-performance (ki spremlja
// aktivne listing-e) — ta vključuje tudi INTAKE/PROCESSING stadije ki še niso
// listed. Razlika od cash-conversion-cycle (ki meri DIO+DSO-DPO) — ta gleda
// lifecycle stadij vsakega item-a posebej.
//
// Pure DB analytics (NO AI). GET /api/analytics/inventory-lifecycle-stage-classifier

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type LifecycleStage =
  | 'INTAKE'
  | 'PROCESSING'
  | 'LISTED'
  | 'ACTIVE'
  | 'AGING'
  | 'STALE'
  | 'DEAD';

type Urgency = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface LifecycleItem {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  daysSinceBuy: number;
  daysSinceFirstSeen: number;
  hasContacts: boolean;
  hasPriceDrops: boolean;
  flipChecklistProgress: number; // %
  currentStage: LifecycleStage;
  stageProgress: number; // %
  nextStage: string;
  daysInStage: number;
  recommendedAction: string;
  urgency: Urgency;
}

interface PortfolioDistribution {
  intake: number;
  processing: number;
  listed: number;
  active: number;
  aging: number;
  stale: number;
  dead: number;
}

interface ImmediateAction {
  stage: string;
  action: string;
  itemCount: number;
  priority: string;
}

interface ActionPlan {
  immediateActions: ImmediateAction[];
  bottleneckStage: string | null;
  advice: string;
}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;

// Parse flipChecklist JSON: [{step, completedAt}] — count completed.
function parseFlipChecklistProgress(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return 0;
    if (parsed.length === 0) return 0;
    const completed = parsed.filter(
      (e): e is { step: string; completedAt?: string | null } => {
        if (!e || typeof e !== 'object') return false;
        const o = e as Record<string, unknown>;
        return (
          typeof o.step === 'string' &&
          (o.completedAt == null || typeof o.completedAt === 'string')
        );
      },
    );
    // Count completed (completedAt set OR completed truthy)
    const done = completed.filter(e => {
      const o = e as unknown as Record<string, unknown>;
      return (
        o.completedAt != null ||
        (o.completed as unknown) === true ||
        (o.completed as unknown) === 1
      );
    });
    return Math.round((done.length / parsed.length) * 100);
  } catch {
    return 0;
  }
}

// Classify item into lifecycle stage based on daysSinceBuy, daysSinceFirstSeen,
// hasContacts, hasPriceDrops, flipChecklistProgress.
// Returns stage + stageProgress + nextStage + daysInStage + recommendedAction + urgency.
function classifyItem(input: {
  daysSinceBuy: number;
  daysSinceFirstSeen: number;
  hasContacts: boolean;
  hasPriceDrops: boolean;
  flipChecklistProgress: number;
}): {
  stage: LifecycleStage;
  stageProgress: number;
  nextStage: string;
  daysInStage: number;
  recommendedAction: string;
  urgency: Urgency;
} {
  const {
    daysSinceBuy,
    daysSinceFirstSeen,
    hasContacts,
    hasPriceDrops,
    flipChecklistProgress,
  } = input;

  const daysListed = Math.max(0, daysSinceFirstSeen);

  // Stage thresholds (cumulative):
  // INTAKE: 0-2 days, no checklist
  // PROCESSING: 2-7 days, checklist <50%
  // LISTED: checklist >=50%, <7 days listed
  // ACTIVE: 7-30 days listed, has contacts OR bookmarks
  // AGING: 30-60 days, declining contacts
  // STALE: 60-90 days, no recent activity
  // DEAD: >90 days, no activity

  if (daysSinceBuy <= 2 && flipChecklistProgress < 10) {
    return {
      stage: 'INTAKE',
      stageProgress: Math.round((daysSinceBuy / 2) * 100),
      nextStage: 'PROCESSING',
      daysInStage: daysSinceBuy,
      recommendedAction:
        'Registriraj v sistem, fotografiraj in začni processing.',
      urgency: 'LOW',
    };
  }

  if (flipChecklistProgress < 50 && daysSinceBuy <= 7) {
    return {
      stage: 'PROCESSING',
      stageProgress: Math.round(
        ((daysSinceBuy - 2) / 5) * 100 + flipChecklistProgress / 2,
      ),
      nextStage: 'LISTED',
      daysInStage: Math.max(0, daysSinceBuy - 2),
      recommendedAction:
        'Zaključi flip checklist (čiščenje, fotografija, opis) in objavi.',
      urgency: 'MEDIUM',
    };
  }

  if (daysListed < 7 && flipChecklistProgress >= 50) {
    return {
      stage: 'LISTED',
      stageProgress: Math.round((daysListed / 7) * 100),
      nextStage: 'ACTIVE',
      daysInStage: daysListed,
      recommendedAction:
        'Spremljaj ogledi/kontakti — če po 3 dneh ni zanimanja, znižaj ceno za 5%.',
      urgency: 'LOW',
    };
  }

  if (daysListed < 30 && (hasContacts || hasPriceDrops)) {
    // Active: getting interest
    const progress = Math.round((daysListed / 30) * 100);
    return {
      stage: 'ACTIVE',
      stageProgress: Math.min(100, progress),
      nextStage: 'AGING',
      daysInStage: Math.max(0, daysListed - 7),
      recommendedAction:
        'Odzovi se hitro na povpršanja, ponudi discount za hitro sklenitev.',
      urgency: 'MEDIUM',
    };
  }

  if (daysListed < 30) {
    // Listed but not getting interest — push toward active
    return {
      stage: 'LISTED',
      stageProgress: Math.round((daysListed / 7) * 100),
      nextStage: 'ACTIVE',
      daysInStage: daysListed,
      recommendedAction:
        'Še vedno čaka aktivnost — premakni v drugo kategorijo ali izboljšaj naslov/sliko.',
      urgency: 'MEDIUM',
    };
  }

  if (daysListed < 60) {
    // AGING: 30-60 days
    return {
      stage: 'AGING',
      stageProgress: Math.round(((daysListed - 30) / 30) * 100),
      nextStage: 'STALE',
      daysInStage: Math.max(0, daysListed - 30),
      recommendedAction:
        'Znižaj ceno za 10-15%, osveži fotografije ali premakni v drugo platformo.',
      urgency: 'HIGH',
    };
  }

  if (daysListed < 90) {
    // STALE: 60-90 days
    return {
      stage: 'STALE',
      stageProgress: Math.round(((daysListed - 60) / 30) * 100),
      nextStage: 'DEAD',
      daysInStage: Math.max(0, daysListed - 60),
      recommendedAction:
        'Kritično — znižaj ceno pod break-even ali razmisli o bundle prodaji.',
      urgency: 'HIGH',
    };
  }

  // DEAD: >90 days
  return {
    stage: 'DEAD',
    stageProgress: 100,
    nextStage: 'LIQUIDATE',
    daysInStage: Math.max(0, daysListed - 90),
    recommendedAction:
      'Likvidiraj — prodaj pod ceno nakupa ali doniraj za davek. Sprosti kapital.',
    urgency: 'CRITICAL',
  };
}

function deriveBottleneck(
  dist: PortfolioDistribution,
): { stage: string | null; advice: string } {
  const entries: Array<[string, number]> = [
    ['INTAKE', dist.intake],
    ['PROCESSING', dist.processing],
    ['LISTED', dist.listed],
    ['ACTIVE', dist.active],
    ['AGING', dist.aging],
    ['STALE', dist.stale],
    ['DEAD', dist.dead],
  ];
  // Bottleneck = the stage with most items EXCLUDING ACTIVE (active is healthy).
  // We consider LISTED, PROCESSING, AGING, STALE, DEAD as potential bottlenecks.
  const bottleneckCandidates = entries.filter(([stage]) =>
    ['PROCESSING', 'LISTED', 'AGING', 'STALE', 'DEAD'].includes(stage),
  );
  bottleneckCandidates.sort((a, b) => b[1] - a[1]);
  const bottleneck = bottleneckCandidates[0];
  if (!bottleneck || bottleneck[1] === 0) {
    return { stage: null, advice: 'Portfolio je v ravnovesju — brez bottleneck.' };
  }
  const [stage, count] = bottleneck;
  let advice: string;
  switch (stage) {
    case 'PROCESSING':
      advice = `Bottleneck: ${stage} (${count} item-ov čaka processing). Pospeši fotografiranje in opis — vsak dan zakasnitve stane carrying cost.`;
      break;
    case 'LISTED':
      advice = `Bottleneck: ${stage} (${count} item-ov čaka aktivnost). Izboljšaj naslove/slike ali znižaj cene za sproženje zanimanja.`;
      break;
    case 'AGING':
      advice = `Bottleneck: ${stage} (${count} item-ov stara). Znižaj cene za 10-15% ali premakni v drugo platformo.`;
      break;
    case 'STALE':
      advice = `Bottleneck: ${stage} (${count} item-ov zastara). Kritično — znižaj pod break-even ali bundle prodaja.`;
      break;
    case 'DEAD':
      advice = `Bottleneck: ${stage} (${count} item-ov mrtvih). Likvidiraj takoj — sproščen kapital vloži v nove priložnosti.`;
      break;
    default:
      advice = `Bottleneck: ${stage} (${count} item-ov).`;
  }
  return { stage, advice };
}

function buildImmediateActions(
  dist: PortfolioDistribution,
): ImmediateAction[] {
  const actions: ImmediateAction[] = [];
  if (dist.dead > 0) {
    actions.push({
      stage: 'DEAD',
      action: 'Likvidiraj vse mrtve item-e (prodaj pod ceno ali doniraj)',
      itemCount: dist.dead,
      priority: 'CRITICAL',
    });
  }
  if (dist.stale > 0) {
    actions.push({
      stage: 'STALE',
      action: 'Znižaj cene pod break-even ali razmisli o bundle prodaji',
      itemCount: dist.stale,
      priority: 'HIGH',
    });
  }
  if (dist.aging > 0) {
    actions.push({
      stage: 'AGING',
      action: 'Znižaj cene za 10-15% ali premakni v drugo platformo',
      itemCount: dist.aging,
      priority: 'HIGH',
    });
  }
  if (dist.listed > 0) {
    actions.push({
      stage: 'LISTED',
      action: 'Izboljšaj naslove/slike ali znižaj cene za sproženje zanimanja',
      itemCount: dist.listed,
      priority: 'MEDIUM',
    });
  }
  if (dist.processing > 0) {
    actions.push({
      stage: 'PROCESSING',
      action: 'Pospeši fotografiranje in opis za hitro objavo',
      itemCount: dist.processing,
      priority: 'MEDIUM',
    });
  }
  return actions;
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    // 1) Query all HELD trades with their linked Listing
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyDate: true,
        flipChecklist: true,
        listing: {
          select: {
            id: true,
            firstSeenAt: true,
            contactStatus: true,
            priceDroppedAt: true,
            isBookmarked: true,
          },
        },
      },
      take: 5000,
    });

    // Empty state
    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        items: [],
        portfolioDistribution: {
          intake: 0,
          processing: 0,
          listed: 0,
          active: 0,
          aging: 0,
          stale: 0,
          dead: 0,
        },
        actionPlan: {
          immediateActions: [],
          bottleneckStage: null,
          advice:
            'Ni HELD trade-ov — portfolio je prazen. Dodaš trades z buyPrice za začetek lifecycle analize.',
        },
        message: 'Ni HELD trade-ov — Lifecycle Stage Classifier ni mogoč.',
      });
    }

    // 2) Classify each item
    const nowMs = Date.now();
    const items: LifecycleItem[] = [];
    const dist: PortfolioDistribution = {
      intake: 0,
      processing: 0,
      listed: 0,
      active: 0,
      aging: 0,
      stale: 0,
      dead: 0,
    };

    for (const t of heldTrades) {
      const buyDateMs = t.buyDate ? new Date(t.buyDate).getTime() : null;
      const daysSinceBuy = buyDateMs
        ? Math.max(0, Math.round((nowMs - buyDateMs) / DAY_MS))
        : 0;

      const firstSeenMs = t.listing?.firstSeenAt
        ? new Date(t.listing.firstSeenAt).getTime()
        : null;
      const daysSinceFirstSeen = firstSeenMs
        ? Math.max(0, Math.round((nowMs - firstSeenMs) / DAY_MS))
        : daysSinceBuy;

      const hasContacts =
        !!t.listing?.contactStatus &&
        t.listing.contactStatus !== 'none' &&
        t.listing.contactStatus !== '';
      const hasPriceDrops = !!t.listing?.priceDroppedAt;
      const flipChecklistProgress = parseFlipChecklistProgress(
        t.flipChecklist,
      );

      const c = classifyItem({
        daysSinceBuy,
        daysSinceFirstSeen,
        hasContacts,
        hasPriceDrops,
        flipChecklistProgress,
      });

      // Tally distribution
      const stageKey = c.stage.toLowerCase() as keyof PortfolioDistribution;
      dist[stageKey] += 1;

      items.push({
        tradeId: t.id,
        title: t.title,
        category: (t.category || 'drugo').trim().toLowerCase() || 'drugo',
        buyPrice: Math.round((t.buyPrice ?? 0) * 100) / 100,
        daysSinceBuy,
        daysSinceFirstSeen,
        hasContacts,
        hasPriceDrops,
        flipChecklistProgress,
        currentStage: c.stage,
        stageProgress: Math.max(0, Math.min(100, c.stageProgress)),
        nextStage: c.nextStage,
        daysInStage: c.daysInStage,
        recommendedAction: c.recommendedAction,
        urgency: c.urgency,
      });
    }

    // Sort items: urgency CRITICAL → LOW, then by daysInStage desc
    const urgencyOrder: Record<Urgency, number> = {
      CRITICAL: 0,
      HIGH: 1,
      MEDIUM: 2,
      LOW: 3,
    };
    items.sort((a, b) => {
      const u = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      if (u !== 0) return u;
      return b.daysInStage - a.daysInStage;
    });

    // 3) Action plan
    const immediateActions = buildImmediateActions(dist);
    const bottleneck = deriveBottleneck(dist);

    const actionPlan: ActionPlan = {
      immediateActions,
      bottleneckStage: bottleneck.stage,
      advice: bottleneck.advice,
    };

    return NextResponse.json({
      ok: true,
      items,
      portfolioDistribution: dist,
      actionPlan,
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/inventory-lifecycle-stage-classifier',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
