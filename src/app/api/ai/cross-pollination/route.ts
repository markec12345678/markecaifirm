// v6.37 / v8.95.5-deal: AI Listing Cross-Pollination — povezuje oglase med platformami za sinergično prodajo
// Refaktoriran z withAiRoute helperjem (v8.95.5-deal) + enforceBudget guard.
//
// POST /api/ai/cross-pollination
// Body: {}
// Returns: { ok, pollination: { synergies, crossPosts, referralChains, amplification } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface CrossPollinationInput {}

export const POST = withAiRoute<CrossPollinationInput>({
  endpoint: '/api/ai/cross-pollination',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {} as CrossPollinationInput;
  },

  // No validateInput — brez polj
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, url: true } } },
      take: 30,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { category: true, buyLocation: true, sellLocation: true, sellPrice: true, buyPrice: true },
      take: 100,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, pollination: null, message: 'Ni held tradeov za cross-pollination.' });
    }

    const items = mapItems(heldTrades);
    const channelStr = buildChannelStr(soldTrades);

    const prompt = buildPrompt(items, channelStr);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const validIds = new Set(items.map(i => i.id));

    const pollination = transformPollination(parsed, validIds);

    return apiOk({ ok: true, pollination });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface HeldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyDate: Date;
  listing: { aiEstimatedValue: number | null; dealScore: number | null; url: string | null } | null;
}

interface SoldTradeRow {
  sellLocation: string | null;
}

interface Item {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
}

const SYNERGY_TYPES = ['cross_post', 'referral_chain', 'bundle_cross_ref', 'profile_link', 'seasonal_cross', 'complementary_cross'] as const;

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

/**
 * Map heldTrades v items array. Logika IDENTIČNA originalu v6.37.
 */
function mapItems(heldTrades: HeldTradeRow[]): Item[] {
  return heldTrades.map(t => ({
    id: t.id, title: t.title, category: t.category || 'drugo',
    cost: t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
    daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000)),
  }));
}

/**
 * Build string iz prodajnih kanalov (top 5 po številu prodaj).
 * Logika IDENTIČNA originalu v6.37.
 */
function buildChannelStr(soldTrades: SoldTradeRow[]): string {
  return Object.entries(soldTrades.reduce((acc, t) => {
    const s = t.sellLocation || 'neznan';
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([s, c]) => `${s}: ${c}`)
    .join(', ');
}

/**
 * Build AI prompt za cross-pollination (besedilo IDENTIČNO originalu v6.37).
 */
function buildPrompt(items: Item[], channelStr: string): string {
  const itemsStr = items.slice(0, 15).map(i => `- [${i.id}] ${i.title} | ${i.category} | ${i.estValue}€ | ${i.daysHeld}d`).join('\n');

  return `Si AI cross-pollination strategist za sinergično prodajo čez platforme.
Poveži oglase med platformami tako, da si medsebojno povečujejo izpostavljenost in prodajo.

INVENTAR (${items.length}):
${itemsStr}

PRODAJNI KANALI (zgodovina): ${channelStr || 'neznan'}

Cross-pollination koncepti:
1. CROSS_POST: objavi isti item na več platformah (Bolha + Facebook + Vinted)
   - Bolha: ključne besede za iskanje, formalen opis
   - Facebook: emoji, osebni ton, lokacija
   - Vinted: hashtagi, stanje, brand
2. REFERRAL_CHAIN: v opisu enega oglasa omeni druge oglase ("glej tudi...")
   - Npr. pri avto oglasu: "glej tudi zimske gume v mojem profilu"
3. BUNDLE_CROSS_REF: objavi bundle na eni platformi, posamezne na drugi
   - Bundle na Bolha, posamezni na Facebook (različna publika)
4. PROFILE_LINK: v vseh oglasih omeni "več oglasov v mojem profilu"
5. SEASONAL_CROSS: zimski itemi skupaj na eni platformi, poletni na drugi
6. COMPLEMENTARY_CROSS: telefon na Bolha + slušalke na Vinted z medsebojno referenco

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "synergies": [
    {
      "primary_item_id": "<trade_id>",
      "primary_title": "<naslov>",
      "complementary_item_id": "<trade_id>",
      "complementary_title": "<naslov>",
      "synergy_type": "<cross_post|referral_chain|bundle_cross_ref|profile_link|seasonal_cross|complementary_cross>",
      "description": "<kako povezati, max 100 znakov>",
      "platforms": ["<bolha|facebook|vinted>"],
      "expected_exposure_boost_pct": <number>,
      "expected_sell_time_reduction_days": <number>,
      "reasoning": "<max 80 znakov>"
    }
  ],
  "cross_posts": [
    {
      "item_id": "<trade_id>",
      "title": "<naslov>",
      "platforms": [{"platform": "<bolha|facebook|vinted>", "title_adapted": "<max 80 znakov>", "price_eur": <number>, "description_snippet": "<max 100 znakov>"}],
      "expected_reach_increase_pct": <number>
    }
  ],
  "referral_chain": [
    {"from_item": "<naslov>", "to_item": "<naslov>", "referral_text": "<kaj napisati v opisu, max 100 znakov>", "platform": "<kje>"}
  ],
  "amplification": {
    "total_synergies": <number>,
    "total_cross_posts": <number>,
    "total_referrals": <number>,
    "expected_avg_exposure_boost_pct": <number>,
    "expected_sell_time_reduction_days": <number>,
    "items_benefiting": <number>
  }
}`;
}

/**
 * Transform AI JSON v pollination objekt. Clamp/slice/whitelist logika IDENTIČNA originalu v6.37.
 */
function transformPollination(parsed: any, validIds: Set<string>): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    synergies: (parsed?.synergies || []).filter((s: any) => validIds.has(String(s?.primary_item_id ?? '')) && validIds.has(String(s?.complementary_item_id ?? ''))).slice(0, 10).map((s: any) => ({
      primaryItemId: String(s?.primary_item_id ?? ''),
      primaryTitle: String(s?.primary_title ?? '').slice(0, 100),
      complementaryItemId: String(s?.complementary_item_id ?? ''),
      complementaryTitle: String(s?.complementary_title ?? '').slice(0, 100),
      synergyType: includes(SYNERGY_TYPES, String(s?.synergy_type)) ? String(s.synergy_type) : 'cross_post',
      description: String(s?.description ?? '').slice(0, 200),
      platforms: (s?.platforms || []).slice(0, 4).map((p: any) => String(p).slice(0, 30)),
      expectedExposureBoostPct: Math.round(Number(s?.expected_exposure_boost_pct ?? 0)),
      expectedSellTimeReductionDays: Math.round(Number(s?.expected_sell_time_reduction_days ?? 0)),
      reasoning: String(s?.reasoning ?? '').slice(0, 200),
    })),
    crossPosts: (parsed?.cross_posts || []).filter((c: any) => validIds.has(String(c?.item_id ?? ''))).slice(0, 10).map((c: any) => ({
      itemId: String(c?.item_id ?? ''),
      title: String(c?.title ?? '').slice(0, 100),
      platforms: (c?.platforms || []).slice(0, 4).map((p: any) => ({
        platform: String(p?.platform ?? '').slice(0, 30),
        titleAdapted: String(p?.title_adapted ?? '').slice(0, 150),
        priceEur: Math.max(0, Number(p?.price_eur ?? 0)),
        descriptionSnippet: String(p?.description_snippet ?? '').slice(0, 200),
      })),
      expectedReachIncreasePct: Math.round(Number(c?.expected_reach_increase_pct ?? 0)),
    })),
    referralChain: (parsed?.referral_chain || []).slice(0, 8).map((r: any) => ({
      fromItem: String(r?.from_item ?? '').slice(0, 100),
      toItem: String(r?.to_item ?? '').slice(0, 100),
      referralText: String(r?.referral_text ?? '').slice(0, 200),
      platform: String(r?.platform ?? '').slice(0, 30),
    })),
    amplification: {
      totalSynergies: Math.max(0, Number(parsed?.amplification?.total_synergies ?? 0)),
      totalCrossPosts: Math.max(0, Number(parsed?.amplification?.total_cross_posts ?? 0)),
      totalReferrals: Math.max(0, Number(parsed?.amplification?.total_referrals ?? 0)),
      expectedAvgExposureBoostPct: Math.round(Number(parsed?.amplification?.expected_avg_exposure_boost_pct ?? 0)),
      expectedSellTimeReductionDays: Math.round(Number(parsed?.amplification?.expected_sell_time_reduction_days ?? 0)),
      itemsBenefiting: Math.max(0, Number(parsed?.amplification?.items_benefiting ?? 0)),
    },
  };
}
