// v6.56 / v8.96.2-batch1: AI Seller Negotiation Strategist — strategija za pogajanje kot prodajalec (ne kupec)
// Refaktoriran z withAiRoute helperjem (v8.96.2) + enforceBudget guard.
//
// POST /api/ai/seller-negotiation-strategist
// Body: { tradeId?: string, customerName?: string }
// Returns: { ok, strategist: { items, buyerAnalysis, tactics, scenarios, counterStrategies, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface SellerNegotiationStrategistInput {
  tradeId: string | null;
  customerName: string | null;
}

const SELLER_TACTICS = [
  'anchor_high',           // začni z visoko ceno, potem popusti
  'value_stack',           // dodaj vrednost (brezplačna dostava, garancija)
  'scarcity_urgency',     // omeni drugi zainteresirani, časovna omejitev
  'walk_away',            // pokaži da lahko odideš (counter-intuitive)
  'split_difference',     // razlika med dvema cenama, predlagaj middle
  'condition_concession', // popust za hitro plačilo, prevzem
  'bundle_deal',          // paket z drugim itemom za boljšo ceno
  'payment_terms',        // različne opcije plačila
  'social_proof',         // omeni zadovoljne kupce, hitro prodano
  'authority_leverage',   // poudari ekspertnost, originalnost
  'loss_frame',           // poudari kaj kupec izgubi če ne kupi
  'reciprocity',          // daj majhno koncesijo, pričakuj večjo
] as const;

export const POST = withAiRoute<SellerNegotiationStrategistInput>({
  endpoint: '/api/ai/seller-negotiation-strategist',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : null,
      customerName: body?.customerName ? String(body.customerName).trim() : null,
    };
  },

  // No validateInput — vsi input-i so opcijski

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId, customerName } = input;

    // 1. Pridobi held trades
    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;

    const heldTrades = await db.trade.findMany({
      where,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true, location: true, description: true, detailDescription: true } },
      },
      take: tradeId ? 1 : 20,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, strategist: null, message: 'Ni held tradeov za seller negotiation.' });
    }

    // 2. Pridobi sold trades za buyer analysis
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 300,
      orderBy: { sellDate: 'desc' },
    });

    // 3. Buyer history (če je customerName podan)
    const buyerHistory = computeBuyerHistory(soldTrades, customerName);

    // 4. Build items + prompt
    const items = buildItems(heldTrades);

    const prompt = buildPrompt({ items, buyerHistory });
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const strategist = transformStrategist(parsed, items);

    return apiOk({ ok: true, strategist });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  sellLocation: string | null;
  buyDate: Date;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: {
    aiEstimatedValue: number | null;
    dealScore: number | null;
    aiRisk: number | null;
    location: string | null;
    description: string | null;
    detailDescription: string | null;
  } | null;
}

interface BuyerHistory {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrderValue: number;
  daysSinceLastPurchase: number;
  categories: string[];
  items: string[];
}

interface StrategistItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  minAcceptable: number;
  maxTarget: number;
  description: string;
}

interface PromptData {
  items: StrategistItem[];
  buyerHistory: BuyerHistory | null;
}

function computeBuyerHistory(soldTrades: SoldTradeRow[], customerName: string | null): BuyerHistory | null {
  if (!customerName) return null;
  const buyerSales = soldTrades.filter(t => t.sellLocation === customerName);
  if (buyerSales.length === 0) return null;
  const totalSpent = buyerSales.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
  const avgOrder = Math.round(totalSpent / buyerSales.length);
  const lastPurchase = buyerSales[0].sellDate;
  const daysSinceLast = Math.round((Date.now() - lastPurchase!.getTime()) / (24*60*60*1000));
  const categories = new Set(buyerSales.map(t => t.category).filter(Boolean));
  return {
    name: customerName, purchases: buyerSales.length, totalSpent: Math.round(totalSpent),
    avgOrderValue: avgOrder, daysSinceLastPurchase: daysSinceLast,
    categories: Array.from(categories) as string[], items: buyerSales.map(t => t.title).slice(0, 5),
  };
}

function buildItems(heldTrades: HeldTradeRow[]): StrategistItem[] {
  return heldTrades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));
    const minAcceptable = Math.round(cost * 1.1); // 10% min profit
    const maxTarget = Math.round(estValue * 1.1);
    return {
      id: t.id, title: t.title, category: t.category || 'drugo',
      cost, estValue, daysHeld, minAcceptable, maxTarget,
      description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 300),
    };
  });
}

function buildPrompt(d: PromptData): string {
  const itemsStr = d.items.slice(0, 15).map(i =>
    `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ (min ${i.minAcceptable}€, max ${i.maxTarget}€) | ${i.daysHeld}d`
  ).join('\n');

  return `Si AI seller negotiation strategist za slovenske oglasne platforme.
Ti si PRODAJALEC (ne kupec) - optimiziraj pogajanje z vidika prodajalca.

INVENTAR ZA PRODAJO (${d.items.length}):
${itemsStr}

${d.buyerHistory ? `KUPEC ZA ANALIZO:\n- Ime: ${d.buyerHistory.name}\n- Nakupov: ${d.buyerHistory.purchases}\n- Skupno porabljeno: ${d.buyerHistory.totalSpent}€\n- Povprečni nakup: ${d.buyerHistory.avgOrderValue}€\n- Zadnji nakup: ${d.buyerHistory.daysSinceLastPurchase}d nazaj\n- Kategorije: ${d.buyerHistory.categories.join(', ')}\n- Zadnji itemi: ${d.buyerHistory.items.join(', ')}\n` : ''}12 seller taktik:
1. ANCHOR_HIGH: začni z 20% višjo ceno, potem popusti počasi
2. VALUE_STACK: dodaj bonus (dostava, garancija, dodatki) namesto popust
3. SCARCITY_URGENCY: omeni drugi zainteresirani, "danes je ta cena"
4. WALK_AWAY: pokaži da lahko odideš (visoka Samozavest)
5. SPLIT_DIFFERENCE: če middle med dvema cenama, predlagaj middle
6. CONDITION_CONCESSION: popust za hitro plačilo, prevzem danes
7. BUNDLE_DEAL: paket z drugim itemom za boljšo ceno
8. PAYMENT_TERMS: različne opcije (cash, nakazilo, obroki)
9. SOCIAL_PROOF: omeni zadovoljne kupce, hitro prodano
10. AUTHORITY_LEVERAGE: poudari ekspertnost, originalnost
11. LOSS_FRAME: poudari kaj kupec izgubi če ne kupi zdaj
12. RECIPROCITY: daj majhno koncesijo, pričakuj večjo

Buyer tipi:
- PRICE_SENSITIVE: targa ceno, uporabi value_stack ne popust
- QUALITY_FOCUSED: ceni stanje, poudari specifikacije
- URGENT_BUYER: časovno pritisnjen, uporabi scarcity_urgency
- EXPERIENCED: pozna tržne cene, uporabi authority_leverage
- EMOTIONAL: čustveno vezan, uporabi loss_frame
- BARGAIN_HUNTER: išče deal, uporabi bundle_deal
- REPEAT_CUSTOMER: že kupoval, uporabi reciprocity
- SKEPTICAL: ne zaupa, uporabi social_proof

Counter strategije za buyer taktike:
- LOWBALL_OFFER: ne jezi se, protipredlog z anchor_high
- TAKE_IT_OR_LEAVE_IT: walk_away (pokaži moč)
- BUTTERING_UP: reciprocity (daj koncesijo)
- BUNDLE_PRESSURE: condition_concession
- TIME_PRESSURE: ne pusti se rushed, vzemi čas

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "asking_price_eur": <number>,
      "floor_price_eur": <number>,
      "target_price_eur": <number>,
      "primary_tactic": "<anchor_high|value_stack|scarcity_urgency|walk_away|split_difference|condition_concession|bundle_deal|payment_terms|social_proof|authority_leverage|loss_frame|reciprocity>",
      "tactic_reasoning": "<max 120 znakov>",
      "opening_statement": "<max 200 znakov>",
      "concession_plan": [{"if_buyer_offers_eur": <number>, "counter_eur": <number>, "concession_type": "<price|value_add|bundle|payment>", "reasoning": "<max 80 znakov>"}],
      "walk_away_threshold_eur": <number>,
      "expected_final_price_eur": <number>,
      "expected_profit_eur": <number>,
      "negotiation_difficulty": "<easy|medium|hard|very_hard>"
    }
  ],
  "buyer_analysis": [
    {
      "buyer_type": "<price_sensitive|quality_focused|urgent_buyer|experienced|emotional|bargain_hunter|repeat_customer|skeptical>",
      "description": "<max 100 znakov>",
      "best_tactics": ["<tactic>"],
      "avoid_tactics": ["<tactic>"],
      "expected_resistance": "<low|medium|high>",
      "conversion_probability_pct": <number 0-100>
    }
  ],
  "tactics": [
    { "tactic": "<12 taktik>", "description": "<max 120 znakov>", "best_for_buyer_type": "<buyer_type>", "risk_level": "<low|medium|high>", "expected_uplift_pct": <number>, "implementation_difficulty": "<low|medium|hard>" }
  ],
  "scenarios": [
    { "scenario": "<quick_sale|maximize_profit|bundle_opportunity|stalled_negotiation|walk_away>", "probability_pct": <number>, "expected_price_eur": <number>, "expected_profit_eur": <number>, "time_to_close_days": <number>, "key_action": "<max 100 znakov>" }
  ],
  "counter_strategies": [
    { "buyer_tactic": "<lowball_offer|take_it_or_leave_it|buttering_up|bundle_pressure|time_pressure>", "buyer_intent": "<max 80 znakov>", "your_response": "<max 150 znakov>", "expected_outcome": "<max 100 znakov>", "alternative_response": "<max 150 znakov>" }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_revenue_impact_eur": <number>, "items_affected": <number> }
  ],
  "summary": {
    "total_items_analyzed": <number>,
    "avg_target_price_eur": <number>,
    "avg_floor_price_eur": <number>,
    "total_expected_revenue_eur": <number>,
    "total_expected_profit_eur": <number>,
    "best_tactic_overall": "<max 80 znakov>",
    "biggest_negotiation_challenge": "<max 100 znakov>",
    "quickest_win": "<max 100 znakov>",
    "seller_negotiation_score": <number 0-100>
  }
}`;
}

function transformStrategist(parsed: any, items: StrategistItem[]) {
  const validIds = new Set(items.map(i => i.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    items: (parsed?.items || [])
      .filter((it: any) => validIds.has(String(it?.id ?? '')))
      .slice(0, 20)
      .map((it: any) => {
        const orig = items.find(x => x.id === String(it?.id));
        return {
          tradeId: String(it?.id ?? ''),
          title: String(it?.title ?? orig?.title ?? '').slice(0, 150),
          askingPriceEur: Math.max(0, Math.round(Number(it?.asking_price_eur ?? orig?.maxTarget ?? 0))),
          floorPriceEur: Math.max(0, Math.round(Number(it?.floor_price_eur ?? orig?.minAcceptable ?? 0))),
          targetPriceEur: Math.max(0, Math.round(Number(it?.target_price_eur ?? orig?.estValue ?? 0))),
          primaryTactic: SELLER_TACTICS.includes(String(it?.primary_tactic) as any) ? String(it.primary_tactic) : 'anchor_high',
          tacticReasoning: String(it?.tactic_reasoning ?? '').slice(0, 250),
          openingStatement: String(it?.opening_statement ?? '').slice(0, 400),
          concessionPlan: (it?.concession_plan || []).slice(0, 5).map((c: any) => ({
            ifBuyerOffersEur: Math.max(0, Math.round(Number(c?.if_buyer_offers_eur ?? 0))),
            counterEur: Math.max(0, Math.round(Number(c?.counter_eur ?? 0))),
            concessionType: ['price', 'value_add', 'bundle', 'payment'].includes(String(c?.concession_type)) ? String(c.concession_type) : 'price',
            reasoning: String(c?.reasoning ?? '').slice(0, 150),
          })),
          walkAwayThresholdEur: Math.max(0, Math.round(Number(it?.walk_away_threshold_eur ?? orig?.minAcceptable ?? 0))),
          expectedFinalPriceEur: Math.max(0, Math.round(Number(it?.expected_final_price_eur ?? orig?.estValue ?? 0))),
          expectedProfitEur: Math.round(Number(it?.expected_profit_eur ?? 0)),
          negotiationDifficulty: ['easy', 'medium', 'hard', 'very_hard'].includes(String(it?.negotiation_difficulty)) ? String(it.negotiation_difficulty) : 'medium',
        };
      }),
    buyerAnalysis: (parsed?.buyer_analysis || []).slice(0, 8).map((b: any) => ({
      buyerType: ['price_sensitive', 'quality_focused', 'urgent_buyer', 'experienced', 'emotional', 'bargain_hunter', 'repeat_customer', 'skeptical'].includes(String(b?.buyer_type)) ? String(b.buyer_type) : 'price_sensitive',
      description: String(b?.description ?? '').slice(0, 200),
      bestTactics: (b?.best_tactics || []).slice(0, 5).map((t: any) => SELLER_TACTICS.includes(String(t) as any) ? String(t) : 'anchor_high'),
      avoidTactics: (b?.avoid_tactics || []).slice(0, 5).map((t: any) => SELLER_TACTICS.includes(String(t) as any) ? String(t) : 'anchor_high'),
      expectedResistance: ['low', 'medium', 'high'].includes(String(b?.expected_resistance)) ? String(b.expected_resistance) : 'medium',
      conversionProbabilityPct: Math.max(0, Math.min(100, Number(b?.conversion_probability_pct ?? 50))),
    })),
    tactics: (parsed?.tactics || []).slice(0, 12).map((t: any) => ({
      tactic: SELLER_TACTICS.includes(String(t?.tactic) as any) ? String(t.tactic) : 'anchor_high',
      description: String(t?.description ?? '').slice(0, 250),
      bestForBuyerType: String(t?.best_for_buyer_type ?? '').slice(0, 80),
      riskLevel: ['low', 'medium', 'high'].includes(String(t?.risk_level)) ? String(t.risk_level) : 'medium',
      expectedUpliftPct: Math.round(Number(t?.expected_uplift_pct ?? 0)),
      implementationDifficulty: ['low', 'medium', 'hard'].includes(String(t?.implementation_difficulty)) ? String(t.implementation_difficulty) : 'medium',
    })),
    scenarios: (parsed?.scenarios || []).slice(0, 5).map((s: any) => ({
      scenario: ['quick_sale', 'maximize_profit', 'bundle_opportunity', 'stalled_negotiation', 'walk_away'].includes(String(s?.scenario)) ? String(s.scenario) : 'maximize_profit',
      probabilityPct: Math.max(0, Math.min(100, Number(s?.probability_pct ?? 30))),
      expectedPriceEur: Math.round(Number(s?.expected_price_eur ?? 0)),
      expectedProfitEur: Math.round(Number(s?.expected_profit_eur ?? 0)),
      timeToCloseDays: Math.max(1, Number(s?.time_to_close_days ?? 7)),
      keyAction: String(s?.key_action ?? '').slice(0, 200),
    })),
    counterStrategies: (parsed?.counter_strategies || []).slice(0, 5).map((c: any) => ({
      buyerTactic: ['lowball_offer', 'take_it_or_leave_it', 'buttering_up', 'bundle_pressure', 'time_pressure'].includes(String(c?.buyer_tactic)) ? String(c.buyer_tactic) : 'lowball_offer',
      buyerIntent: String(c?.buyer_intent ?? '').slice(0, 150),
      yourResponse: String(c?.your_response ?? '').slice(0, 300),
      expectedOutcome: String(c?.expected_outcome ?? '').slice(0, 200),
      alternativeResponse: String(c?.alternative_response ?? '').slice(0, 300),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      expectedRevenueImpactEur: Math.round(Number(r?.expected_revenue_impact_eur ?? 0)),
      itemsAffected: Math.max(0, Number(r?.items_affected ?? 0)),
    })),
    summary: {
      totalItemsAnalyzed: items.length,
      avgTargetPriceEur: Math.round(Number(parsed?.summary?.avg_target_price_eur ?? items.reduce((s, i) => s + i.maxTarget, 0) / Math.max(1, items.length))),
      avgFloorPriceEur: Math.round(Number(parsed?.summary?.avg_floor_price_eur ?? items.reduce((s, i) => s + i.minAcceptable, 0) / Math.max(1, items.length))),
      totalExpectedRevenueEur: Math.round(Number(parsed?.summary?.total_expected_revenue_eur ?? 0)),
      totalExpectedProfitEur: Math.round(Number(parsed?.summary?.total_expected_profit_eur ?? 0)),
      bestTacticOverall: SELLER_TACTICS.includes(String(parsed?.summary?.best_tactic_overall) as any) ? String(parsed.summary.best_tactic_overall) : 'anchor_high',
      biggestNegotiationChallenge: String(parsed?.summary?.biggest_negotiation_challenge ?? '').slice(0, 200),
      quickestWin: String(parsed?.summary?.quickest_win ?? '').slice(0, 200),
      sellerNegotiationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.seller_negotiation_score ?? 50))),
    },
  };
}
