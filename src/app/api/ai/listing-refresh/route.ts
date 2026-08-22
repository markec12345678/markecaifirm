// v6.33 / v8.95.8-listing: AI Predictive Listing Refresh — napove kdaj osvežiti oglase za max izpostavljenost
// Refaktoriran z withAiRoute helperjem (v8.95.8) + enforceBudget guard.
//
// POST /api/ai/listing-refresh
// Body: {}
// Returns: { ok, refresh: { items, schedule, expectedImpact, insights } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic, maxDuration } = AI_ROUTE_DEFAULTS;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface RefreshInput {}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyDate: Date;
  listing: {
    aiEstimatedValue: number | null;
    dealScore: number | null;
    priceDroppedAt: Date | null;
    firstSeenAt: Date | null;
  } | null;
}

interface RefreshItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  dealScore: number;
  lastPriceDrop: number | null;
}

const REFRESH_STRATEGIES = ['relist_fresh', 'price_adjust', 'title_swap', 'image_refresh', 'platform_switch', 'bundle_refresh', 'hold'] as const;

export const POST = withAiRoute<RefreshInput>({
  endpoint: '/api/ai/listing-refresh',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, priceDroppedAt: true, firstSeenAt: true } } },
      take: 50,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, refresh: null, message: 'Ni held tradeov za refresh analizo.' });
    }

    const items = buildItems(heldTrades);
    const itemsStr = buildItemsStr(items);
    const prompt = buildPrompt(items, itemsStr);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const validIds = new Set(items.map(i => i.id));
    const refresh = transformRefresh(parsed, validIds);

    return apiOk({ ok: true, refresh });
  },
});

// --- Pomožne funkcije (čiste, testabilne) ---------------------------------

function buildItems(heldTrades: HeldTradeRow[]): RefreshItem[] {
  return heldTrades.map(t => ({
    id: t.id, title: t.title, category: t.category || 'drugo',
    cost: t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
    daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000)),
    dealScore: t.listing?.dealScore ?? 0,
    lastPriceDrop: t.listing?.priceDroppedAt ? Math.round((Date.now() - t.listing.priceDroppedAt.getTime()) / (24 * 60 * 60 * 1000)) : null,
  }));
}

function buildItemsStr(items: RefreshItem[]): string {
  return items.slice(0, 20).map(i =>
    `- [${i.id}] ${i.title} | ${i.category} | ${i.daysHeld}d | est. ${i.estValue}€ | deal: ${i.dealScore}${i.lastPriceDrop ? ` | zadnji padec: ${i.lastPriceDrop}d` : ''}`
  ).join('\n');
}

function buildPrompt(items: RefreshItem[], itemsStr: string): string {
  return `Si ekspert za optimizacijo oglasov in algoritmično izpostavljenost.
Za vsak held item določi KDAJ in KAKO osvežiti oglas za maksimalno izpostavljenost.

INVENTAR (${items.length}):
${itemsStr}

Algoritmi refresh pravila (Bolha/Vinted/Facebook):
1. Algoritem favorizira SVEŽE oglase (prvih 3-7 dni = največja izpostavljenost)
2. Po 7 dneh izpostavljenost pade 50%, po 14 dneh 80%, po 30 dneh 95%
3. Refresh = nova objava (nov ID) z izboljšanim naslovom/sliko/ceno
4. Vsak refresh mora imeti vsaj eno spremembo (algoritem zazna duplicate)
5. Optimalni refresh cikel: vsakih 5-10 dni za stalled iteme

Refresh strategije:
- "relist_fresh": popolnoma nova objava (nov naslov, slika, opis)
- "price_adjust": znižanje cene 5-10% + nova objava
- "title_swap": sprememba naslova z novimi ključnimi besedami
- "image_refresh": nove slike z drugačnim kotom/osvetlitvijo
- "platform_switch": prestavi na drugo platformo
- "bundle_refresh": objavi kot del bundla
- "hold": ne osvežuj še (še vedno dovolj izpostavljenosti)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "days_held": <number>,
      "current_exposure_pct": <number 0-100>,
      "refresh_strategy": "<relist_fresh|price_adjust|title_swap|image_refresh|platform_switch|bundle_refresh|hold>",
      "refresh_in_days": <number, kdaj osvežiti>,
      "changes_needed": ["<kaj spremeniti, max 80 znakov>", "..."],
      "suggested_title": "<nov naslov, max 100 znakov>",
      "suggested_price_eur": <number>,
      "expected_exposure_boost_pct": <number>,
      "priority": "<high|medium|low>",
      "reasoning": "<max 100 znakov>"
    }
  ],
  "schedule": [
    { "day": "<dan v tednu>", "items_to_refresh": <number>, "platforms": ["<platforma>"], "time_window": "<max 50 znakov>" }
  ],
  "expected_impact": {
    "avg_exposure_increase_pct": <number>,
    "expected_inquiries_increase_pct": <number>,
    "expected_sell_time_reduction_days": <number>,
    "items_needing_immediate_refresh": <number>
  }
}`;
}

function transformRefresh(parsed: any, validIds: Set<string>): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).map((it: any) => ({
      tradeId: String(it?.id ?? ''),
      title: String(it?.title ?? '').slice(0, 150),
      daysHeld: Math.max(0, Number(it?.days_held ?? 0)),
      currentExposurePct: Math.max(0, Math.min(100, Number(it?.current_exposure_pct ?? 50))),
      refreshStrategy: REFRESH_STRATEGIES.includes(String(it?.refresh_strategy) as any)
        ? String(it.refresh_strategy) : 'hold',
      refreshInDays: Math.max(0, Number(it?.refresh_in_days ?? 0)),
      changesNeeded: (it?.changes_needed || []).slice(0, 4).map((c: any) => String(c).slice(0, 150)),
      suggestedTitle: String(it?.suggested_title ?? '').slice(0, 200),
      suggestedPriceEur: Math.max(0, Number(it?.suggested_price_eur ?? 0)),
      expectedExposureBoostPct: Math.round(Number(it?.expected_exposure_boost_pct ?? 0)),
      priority: ['high', 'medium', 'low'].includes(String(it?.priority)) ? String(it.priority) : 'medium',
      reasoning: String(it?.reasoning ?? '').slice(0, 200),
    })),
    schedule: (parsed?.schedule || []).slice(0, 7).map((s: any) => ({
      day: String(s?.day ?? '').slice(0, 30),
      itemsToRefresh: Math.max(0, Number(s?.items_to_refresh ?? 0)),
      platforms: (s?.platforms || []).slice(0, 4).map((p: any) => String(p).slice(0, 30)),
      timeWindow: String(s?.time_window ?? '').slice(0, 100),
    })),
    expectedImpact: {
      avgExposureIncreasePct: Math.round(Number(parsed?.expected_impact?.avg_exposure_increase_pct ?? 0)),
      expectedInquiriesIncreasePct: Math.round(Number(parsed?.expected_impact?.expected_inquiries_increase_pct ?? 0)),
      expectedSellTimeReductionDays: Math.round(Number(parsed?.expected_impact?.expected_sell_time_reduction_days ?? 0)),
      itemsNeedingImmediateRefresh: Math.max(0, Number(parsed?.expected_impact?.items_needing_immediate_refresh ?? 0)),
    },
  };
}
