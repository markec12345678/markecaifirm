/**
 * @deprecated v8.94 — uporabi `/api/ai/buyer-matchmaker-v2` namesto tega.
 * Zastareli v1 — v2 je najnovejši.
 * Ta endpoint bo odstranjen v v9.0. Glej ENDPOINTS_AUDIT.md za migracijski načrt.
 */
// v6.35 / v8.95.4-batch4: AI Predictive Buyer Matchmaker — najde potencialne kupce za held inventar
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
// logDeprecatedCall() preserved na vrhu handler-ja (Phase 2 deprecation logging).
//
// POST /api/ai/buyer-matchmaker
// Body: {}
// Returns: { ok, matches: [{ tradeId, title, buyerPersonas, channels, outreach, matchScore }], insights, summary }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { logDeprecatedCall } from '@/lib/deprecated-redirect';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface BuyerMatchmakerInput {}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyDate: Date;
  listing: { aiEstimatedValue: number | null; dealScore: number | null; description: string | null } | null;
}

interface SoldTradeRow {
  title: string;
  category: string | null;
  sellPrice: number | null;
  sellLocation: string;
  sellDate: Date | null;
  buyDate: Date;
}

interface ItemRow {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  dealScore: number;
}

export const POST = withAiRoute<BuyerMatchmakerInput>({
  endpoint: '/api/ai/buyer-matchmaker',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  handler: async (_input, ctx: AiRouteContext) => {
    // PRESERVED: Phase 2 deprecation logging — kliče se na VRH handler-ja.
    logDeprecatedCall('/api/ai/buyer-matchmaker', ctx.req, '/api/ai/buyer-matchmaker-v2');

    const { db, callAi, parseAi } = ctx;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, description: true } } },
      take: 30,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: { title: true, category: true, sellPrice: true, sellLocation: true, sellDate: true, buyDate: true },
      take: 200,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, matches: [], message: 'Ni held tradeov za buyer matching.' });
    }

    const items = mapItems(heldTrades);

    // Analiza preteklih kupcev (sellLocation = kanal kupca)
    const buyerChannels = analyzeBuyerChannels(soldTrades);

    const prompt = buildPrompt({ items, buyerChannels });
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const validIds = new Set(items.map(i => i.id));
    const matches = transformMatches(parsed, validIds);

    const avgMatchScore = matches.length > 0 ? Math.round(matches.reduce((s, m) => s + m.matchScore, 0) / matches.length) : 0;

    return apiOk({
      ok: true,
      insights: String(parsed?.insights ?? '').slice(0, 600),
      matches,
      summary: {
        totalMatches: matches.length,
        avgMatchScore,
        bestMatchingItem: String(parsed?.summary?.best_matching_item ?? '').slice(0, 100),
        hardestToSellItem: String(parsed?.summary?.hardest_to_sell_item ?? '').slice(0, 100),
        recommendedOutreachChannels: (parsed?.summary?.recommended_outreach_channels || []).slice(0, 5).map((c: any) => String(c).slice(0, 30)),
        expectedResponseRatePct: Math.max(0, Math.min(100, Number(parsed?.summary?.expected_response_rate_pct ?? 30))),
      },
    });
  },
});

// --- Pomožne funkcione (čiste, testabilne) -------------------------------

function mapItems(heldTrades: HeldTradeRow[]): ItemRow[] {
  return heldTrades.map(t => ({
    id: t.id, title: t.title, category: t.category || 'drugo',
    cost: t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
    daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)),
    dealScore: t.listing?.dealScore ?? 0,
  }));
}

function analyzeBuyerChannels(soldTrades: SoldTradeRow[]): Record<string, { count: number; avgPrice: number }> {
  const buyerChannels: Record<string, { count: number; avgPrice: number }> = {};
  for (const t of soldTrades) {
    const ch = t.sellLocation || 'neznan';
    if (!buyerChannels[ch]) buyerChannels[ch] = { count: 0, avgPrice: 0 };
    buyerChannels[ch].count++;
    buyerChannels[ch].avgPrice += t.sellPrice ?? 0;
  }
  for (const ch of Object.keys(buyerChannels)) {
    buyerChannels[ch].avgPrice = buyerChannels[ch].count > 0 ? Math.round(buyerChannels[ch].avgPrice / buyerChannels[ch].count) : 0;
  }
  return buyerChannels;
}

interface PromptContext {
  items: ItemRow[];
  buyerChannels: Record<string, { count: number; avgPrice: number }>;
}

function buildPrompt(ctx: PromptContext): string {
  const { items, buyerChannels } = ctx;
  const itemsStr = items.slice(0, 15).map(i => `- [${i.id}] ${i.title} | ${i.category} | est: ${i.estValue}€ | ${i.daysHeld}d`).join('\n');
  const buyerStr = Object.entries(buyerChannels).sort(([,a],[,b]) => b.count - a.count).slice(0, 8).map(([ch, d]) => `- ${ch}: ${d.count} nakupov, povp. ${d.avgPrice}€`).join('\n');

  return `Si AI matchmaker za povezovanje inventarja s potencialnimi kupci.
Za vsak held item identificiraj kdo bi ga kupil, kje ga najti in kako pristopiti.

INVENTAR (${items.length}):
${itemsStr}

ZNANI KUPCI (iz preteklih prodaj):
${buyerStr || '- Ni podatkov'}

Slovenski kontekst kupcev:
- Bolha: širok spekter, iskalniki po ključnih besedah, "primeri" ob strani
- Facebook Marketplace: lokalni kupci, pogosto osebni prevzem, vibe check
- Vinted: modno osveščeni, stanje + blagovna znamka pomembna
- Avtonet: avto entuziasti, tehnični podatki ključni
- Telegram skupine: "Bolha alternativa", hitro, neposredno

Buyer persone za matching:
1. "deal_hunter": išče najnižjo ceno, Facebook/Bolha, "kakšna je zadnja cena?"
2. "quality_seeker": išče stanje, Vinted/Bolha, vpraša za stanje/garancijo
3. "collector": redki/vintage itemi, specifične skupine, plača premium
4. "reseller": išče margino, Bolha avtomatično, hitre odgovore
5. "first_time": študenti/začetniki, Facebook, preprosta vprašanja
6. "enthusiast": pozna kategorijo, specifična vprašanja, Avid buyer

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "matches": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "category": "<kategorija>",
      "est_value_eur": <number>,
      "match_score": <number 0-100>,
      "buyer_personas": [
        {
          "type": "<deal_hunter|quality_seeker|collector|reseller|first_time|enthusiast>",
          "likelihood_pct": <number>,
          "max_willing_price_eur": <number>,
          "where_to_find": "<kje najti te kupce, max 80 znakov>",
          "search_terms": "<kaj iščejo, max 80 znakov>"
        }
      ],
      "recommended_channels": ["<bolha|facebook|vinted|avtonet|telegram>"],
      "outreach_strategy": {
        "hook": "<kaj reči v opisu/dogovoru, max 100 znakov>",
        "key_selling_points": ["<točka, max 60 znakov>", "..."],
        "objection_handling": [{"objection": "<max 60 znakov>", "response": "<max 80 znakov>"}],
        "best_contact_time": "<kdaj, max 50 znakov>"
      },
      "complementary_items": ["<kaj še ta kupec morda išče, max 50 znakov>", "..."],
      "reasoning": "<max 100 znakov>"
    }
  ],
  "summary": {
    "total_matches": <number>,
    "avg_match_score": <number>,
    "best_matching_item": "<naslov>",
    "hardest_to_sell_item": "<naslov>",
    "recommended_outreach_channels": ["<kanal>"],
    "expected_response_rate_pct": <number>
  }
}`;
}

function transformMatches(parsed: any, validIds: Set<string>): any[] {
  return (parsed?.matches || []).filter((m: any) => validIds.has(String(m?.id ?? ''))).map((m: any) => ({
    tradeId: String(m?.id ?? ''),
    title: String(m?.title ?? '').slice(0, 150),
    category: String(m?.category ?? '').slice(0, 50),
    estValueEur: Math.max(0, Number(m?.est_value_eur ?? 0)),
    matchScore: Math.max(0, Math.min(100, Number(m?.match_score ?? 50))),
    buyerPersonas: (m?.buyer_personas || []).slice(0, 4).map((p: any) => ({
      type: ['deal_hunter', 'quality_seeker', 'collector', 'reseller', 'first_time', 'enthusiast'].includes(String(p?.type)) ? String(p.type) : 'deal_hunter',
      likelihoodPct: Math.max(0, Math.min(100, Number(p?.likelihood_pct ?? 50))),
      maxWillingPriceEur: Math.max(0, Number(p?.max_willing_price_eur ?? 0)),
      whereToFind: String(p?.where_to_find ?? '').slice(0, 150),
      searchTerms: String(p?.search_terms ?? '').slice(0, 150),
    })),
    recommendedChannels: (m?.recommended_channels || []).slice(0, 5).map((c: any) => String(c).slice(0, 30)),
    outreachStrategy: {
      hook: String(m?.outreach_strategy?.hook ?? '').slice(0, 200),
      keySellingPoints: (m?.outreach_strategy?.key_selling_points || []).slice(0, 4).map((s: any) => String(s).slice(0, 100)),
      objectionHandling: (m?.outreach_strategy?.objection_handling || []).slice(0, 3).map((o: any) => ({
        objection: String(o?.objection ?? '').slice(0, 100),
        response: String(o?.response ?? '').slice(0, 150),
      })),
      bestContactTime: String(m?.outreach_strategy?.best_contact_time ?? '').slice(0, 100),
    },
    complementaryItems: (m?.complementary_items || []).slice(0, 4).map((c: any) => String(c).slice(0, 80)),
    reasoning: String(m?.reasoning ?? '').slice(0, 200),
  }));
}
