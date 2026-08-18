// v6.44 / v8.94-refactor: AI Predictive Listing Refresh Calendar — 30-dnevni koledar osveževanja oglasov
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/refresh-calendar
// Body: {}
// Returns: { ok, calendar: { days, items, strategy, expectedImpact, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface RefreshCalendarInput {}

const REFRESH_ACTIONS = [
  'title_swap', 'image_refresh', 'price_drop', 'platform_switch',
  'relist_full', 'bundle_refresh', 'hold',
] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;
const REFRESH_FREQUENCIES = ['daily', 'every_3_days', 'weekly'] as const;

export const POST = withAiRoute<RefreshCalendarInput>({
  endpoint: '/api/ai/refresh-calendar',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget + zabeleži klic

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {} as RefreshCalendarInput;
  },

  // No validateInput — telo zahtevka je prazno (ni parametra za validirati)
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    // 1. Pridobi held trades (max 40)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, priceDroppedAt: true } },
      },
      take: 40,
    });

    if (heldTrades.length === 0) {
      return apiOk({ calendar: null, message: 'Ni held tradeov za refresh calendar.' });
    }

    // 2. Pripravi podatke za AI
    const items = heldTrades.map(t => ({
      id: t.id,
      title: t.title,
      category: t.category || 'drugo',
      cost: t.buyPrice,
      estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000)),
      lastRefresh: t.listing?.priceDroppedAt
        ? Math.round((Date.now() - t.listing.priceDroppedAt.getTime()) / (24 * 60 * 60 * 1000))
        : null,
    }));

    // 3. AI klic
    const prompt = buildPrompt(items);
    const raw = await callAi(prompt);
    const parsed: unknown = parseAi(raw);

    // 4. Transformacija rezultatov
    const calendar = transformCalendar(parsed, items);

    return apiOk({ calendar });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface HeldItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  lastRefresh: number | null;
}

function buildPrompt(items: HeldItem[]): string {
  const itemsStr = items.slice(0, 20).map(i =>
    `- [${i.id}] ${i.title} | ${i.category} | ${i.daysHeld}d | est ${i.estValue}€${i.lastRefresh ? ` | zadnji refresh: ${i.lastRefresh}d` : ''}`
  ).join('\n');

  return `Si AI listing refresh calendar strategist. Ustvari 30-dnevni koledar osveževanja oglasov.

INVENTAR (${items.length}):
${itemsStr}

Refresh koledar pravila:
1. Sveži itemi (1-7d): ne osvežuj, še vedno max izpostavljenost
2. Aktivni (7-14d): spremljaj, pripravi refresh za dan 14
3. Padajoči (14-21d): osveži na dan 14 (title swap ali image refresh)
4. Stale (21-30d): osveži + 5% popust na dan 21
5. Stalled (30-45d): agresiven refresh + 10% popust na dan 30
6. Dead (45+): likvidacija + 15% popust na dan 45

Refresh strategije per dan:
- "title_swap": nov naslov z drugačnimi ključnimi besedami
- "image_refresh": nove slike, drugačen kot
- "price_drop": znižanje cene 5-15%
- "platform_switch": prestavi na drugo platformo
- "relist_full": popolnoma nova objava (nov ID)
- "bundle_refresh": objavi kot del bundla
- "hold": ne osvežuj še

Koledar naj razporedi refresh-e čez 30 dni (ne vsi na isti dan).

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "days": [
    {
      "day": <number 1-30>,
      "date": "<YYYY-MM-DD>",
      "items_to_refresh": <number>,
      "refresh_actions": [{"item_id": "<id>", "title": "<naslov>", "action": "<title_swap|image_refresh|price_drop|platform_switch|relist_full|bundle_refresh|hold>", "detail": "<max 80 znakov>", "new_price_eur": <number|null>}],
      "total_refreshes": <number>,
      "priority": "<high|medium|low>"
    }
  ],
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "current_exposure_pct": <number 0-100>,
      "next_refresh_day": <number 1-30>,
      "refresh_strategy": "<title_swap|image_refresh|price_drop|platform_switch|relist_full|bundle_refresh|hold>",
      "refresh_detail": "<max 100 znakov>",
      "new_title": "<max 100 znakov | null>",
      "new_price_eur": <number | null>,
      "expected_exposure_boost_pct": <number>,
      "reasoning": "<max 80 znakov>"
    }
  ],
  "strategy": {
    "refresh_frequency": "<daily|every_3_days|weekly>",
    "avg_refreshes_per_day": <number>,
    "total_refreshes_30d": <number>,
    "price_drops_count": <number>,
    "title_swaps_count": <number>,
    "relists_count": <number>
  },
  "expected_impact": {
    "avg_exposure_increase_pct": <number>,
    "expected_inquiries_increase_pct": <number>,
    "expected_sell_time_reduction_days": <number>,
    "expected_extra_sales_30d": <number>,
    "expected_extra_profit_eur": <number>
  },
  "summary": {
    "calendar_completeness_pct": <number>,
    "items_covered": <number>,
    "items_not_needing_refresh": <number>,
    "refresh_efficiency_score": <number 0-100>
  }
}`;
}

function transformCalendar(parsed: unknown, items: HeldItem[]): Record<string, unknown> {
  const p = (parsed ?? {}) as Record<string, any>;
  const validIds = new Set(items.map(i => i.id));
  const refreshActions = REFRESH_ACTIONS as readonly string[];
  const priorities = PRIORITIES as readonly string[];
  const refreshFrequencies = REFRESH_FREQUENCIES as readonly string[];

  return {
    insights: String(p?.insights ?? '').slice(0, 500),
    days: (p?.days || []).slice(0, 30).map((d: any) => ({
      day: Math.max(1, Math.min(30, Number(d?.day ?? 1))),
      date: String(d?.date ?? '').slice(0, 20),
      itemsToRefresh: Math.max(0, Number(d?.items_to_refresh ?? 0)),
      refreshActions: (d?.refresh_actions || [])
        .filter((a: any) => validIds.has(String(a?.item_id ?? '')))
        .map((a: any) => ({
          itemId: String(a?.item_id ?? ''),
          title: String(a?.title ?? '').slice(0, 100),
          action: refreshActions.includes(String(a?.action)) ? String(a.action) : 'hold',
          detail: String(a?.detail ?? '').slice(0, 150),
          newPriceEur: a?.new_price_eur != null ? Math.max(0, Number(a.new_price_eur)) : null,
        })),
      totalRefreshes: Math.max(0, Number(d?.total_refreshes ?? 0)),
      priority: priorities.includes(String(d?.priority)) ? String(d.priority) : 'low',
    })),
    items: (p?.items || [])
      .filter((it: any) => validIds.has(String(it?.id ?? '')))
      .map((it: any) => ({
        tradeId: String(it?.id ?? ''),
        title: String(it?.title ?? '').slice(0, 100),
        currentExposurePct: Math.max(0, Math.min(100, Number(it?.current_exposure_pct ?? 50))),
        nextRefreshDay: Math.max(0, Math.min(30, Number(it?.next_refresh_day ?? 0))),
        refreshStrategy: refreshActions.includes(String(it?.refresh_strategy))
          ? String(it.refresh_strategy) : 'hold',
        refreshDetail: String(it?.refresh_detail ?? '').slice(0, 200),
        newTitle: it?.new_title ? String(it.new_title).slice(0, 200) : null,
        newPriceEur: it?.new_price_eur != null ? Math.max(0, Number(it.new_price_eur)) : null,
        expectedExposureBoostPct: Math.round(Number(it?.expected_exposure_boost_pct ?? 0)),
        reasoning: String(it?.reasoning ?? '').slice(0, 200),
      })),
    strategy: {
      refreshFrequency: refreshFrequencies.includes(String(p?.strategy?.refresh_frequency))
        ? String(p.strategy.refresh_frequency) : 'weekly',
      avgRefreshesPerDay: Math.round(Number(p?.strategy?.avg_refreshes_per_day ?? 0) * 10) / 10,
      totalRefreshes30d: Math.max(0, Number(p?.strategy?.total_refreshes_30d ?? 0)),
      priceDropsCount: Math.max(0, Number(p?.strategy?.price_drops_count ?? 0)),
      titleSwapsCount: Math.max(0, Number(p?.strategy?.title_swaps_count ?? 0)),
      relistsCount: Math.max(0, Number(p?.strategy?.relists_count ?? 0)),
    },
    expectedImpact: {
      avgExposureIncreasePct: Math.round(Number(p?.expected_impact?.avg_exposure_increase_pct ?? 0)),
      expectedInquiriesIncreasePct: Math.round(Number(p?.expected_impact?.expected_inquiries_increase_pct ?? 0)),
      expectedSellTimeReductionDays: Math.round(Number(p?.expected_impact?.expected_sell_time_reduction_days ?? 0)),
      expectedExtraSales30d: Math.max(0, Number(p?.expected_impact?.expected_extra_sales_30d ?? 0)),
      expectedExtraProfitEur: Math.round(Number(p?.expected_impact?.expected_extra_profit_eur ?? 0)),
    },
    summary: {
      calendarCompletenessPct: Math.max(0, Math.min(100, Number(p?.summary?.calendar_completeness_pct ?? 50))),
      itemsCovered: Math.max(0, Number(p?.summary?.items_covered ?? 0)),
      itemsNotNeedingRefresh: Math.max(0, Number(p?.summary?.items_not_needing_refresh ?? 0)),
      refreshEfficiencyScore: Math.max(0, Math.min(100, Number(p?.summary?.refresh_efficiency_score ?? 50))),
    },
  };
}
