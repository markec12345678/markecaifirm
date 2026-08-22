// v6.47 / v8.96.0-batch4: AI Real-time Negotiation Bot — dinamično odgovarja na sporočila kupca v realnem času
// Refaktoriran z withAiRoute helperjem (v8.96) + enforceBudget guard.
//
// POST /api/ai/realtime-negotiation-bot
// Body: { tradeId?: string, listingId?: string, messages: [{ role: 'buyer'|'seller', text, timestamp? }], myGoal?: { minPrice, maxPrice, mustInclude, mustAvoid }, strategy?: 'aggressive'|'firm'|'patient'|'friendly' }
// Returns: { ok, response: { text, suggestedPrice, tone, nextStep, confidence, tactics, alternatives, conversationState } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface ChatMessage {
  role: 'buyer' | 'seller';
  text: string;
  timestamp?: string;
}

interface MyGoal {
  minPrice?: number;
  maxPrice?: number;
  mustInclude?: string[];
  mustAvoid?: string[];
}

interface RealtimeNegotiationBotInput {
  tradeId: string | null;
  listingId: string | null;
  messages: ChatMessage[];
  myGoal: MyGoal;
  strategy: string;
  itemTitle: string | null;
  estValue: number | null;
}

interface ItemContext {
  itemTitle: string;
  category: string;
  tradeCost: number;
  estValue: number;
  itemPrice: number;
  aiRisk: number;
}

interface ConversationState {
  lastMessage: ChatMessage | undefined;
  lastBuyerMessage: ChatMessage | undefined;
  buyerOfferedPrice: number | null;
  messageCount: number;
  conversationPhase: string;
  buyerSentiment: string;
  conversationHistory: string;
}

export const POST = withAiRoute<RealtimeNegotiationBotInput>({
  endpoint: '/api/ai/realtime-negotiation-bot',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const { tradeId, listingId } = body;
    const messages: ChatMessage[] = Array.isArray(body?.messages) ? body.messages : [];
    const myGoal: MyGoal = body?.myGoal ?? {};
    const strategy: string = ['aggressive', 'firm', 'patient', 'friendly'].includes(body?.strategy) ? body.strategy : 'firm';
    return {
      tradeId: tradeId ? String(tradeId) : null,
      listingId: listingId ? String(listingId) : null,
      messages,
      myGoal,
      strategy,
      itemTitle: body?.itemTitle ? String(body.itemTitle) : null,
      estValue: body?.estValue != null ? Number(body.estValue) : null,
    };
  },

  validateInput: (input) => (input.messages.length > 0 ? null : 'messages array ne sme biti prazen'),

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { messages, myGoal, strategy } = input;

    const item = await loadItemContext(db, input);

    const minPrice = myGoal.minPrice ?? Math.round(item.tradeCost * 1.1); // vsaj 10% profit
    const maxPrice = myGoal.maxPrice ?? item.estValue;

    const convo = computeConversationState(messages);

    const prompt = buildPrompt({
      item,
      myGoal,
      strategy,
      minPrice,
      maxPrice,
      convo,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const response = transformResponse(parsed, {
      minPrice,
      maxPrice,
      messageCount: convo.messageCount,
      conversationPhase: convo.conversationPhase,
      buyerSentiment: convo.buyerSentiment,
      buyerOfferedPrice: convo.buyerOfferedPrice,
    });

    return apiOk({ ok: true, response });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

async function loadItemContext(db: AiRouteContext['db'], input: RealtimeNegotiationBotInput): Promise<ItemContext> {
  let itemTitle = '';
  let itemPrice = 0;
  let estValue = 0;
  let category = '';
  let tradeCost = 0;
  let aiRisk = 5;

  if (input.tradeId) {
    const trade = await db.trade.findUnique({
      where: { id: String(input.tradeId) },
      select: {
        title: true, category: true, buyPrice: true, buyFees: true,
        listing: { select: { aiEstimatedValue: true, price: true, aiRisk: true, description: true } },
      },
    });
    if (trade) {
      itemTitle = trade.title;
      category = trade.category || '';
      tradeCost = trade.buyPrice + (trade.buyFees ?? 0);
      estValue = trade.listing?.aiEstimatedValue ?? Math.round(tradeCost * 1.25);
      itemPrice = input.myGoal.maxPrice ?? estValue;
      aiRisk = trade.listing?.aiRisk ?? 5;
    }
  } else if (input.listingId) {
    const listing = await db.listing.findUnique({
      where: { id: String(input.listingId) },
      select: { title: true, price: true, aiEstimatedValue: true, aiRisk: true, description: true, detailDescription: true },
    });
    if (listing) {
      itemTitle = listing.title;
      itemPrice = listing.price ?? input.myGoal.maxPrice ?? 0;
      estValue = listing.aiEstimatedValue ?? itemPrice;
      aiRisk = listing.aiRisk ?? 5;
    }
  } else {
    itemTitle = input.itemTitle ?? 'neznan item';
    itemPrice = input.myGoal.maxPrice ?? 0;
    estValue = input.estValue ?? itemPrice;
  }

  return { itemTitle, category, tradeCost, estValue, itemPrice, aiRisk };
}

function computeConversationState(messages: ChatMessage[]): ConversationState {
  // Zadnje sporočilo kupca (ali prodajalca, odvisno od situacije)
  const lastMessage = messages[messages.length - 1];
  const buyerMessages = messages.filter(m => m.role === 'buyer');
  const lastBuyerMessage = buyerMessages[buyerMessages.length - 1];

  // Prepoznaj ceno v zadnjem sporočilu kupca
  const priceMatch = lastBuyerMessage?.text.match(/(\d+)\s*€?/) || lastMessage?.text.match(/(\d+)\s*€?/);
  const buyerOfferedPrice = priceMatch ? Number(priceMatch[1]) : null;

  // Conversation state hevristika
  const messageCount = messages.length;
  let conversationPhase = 'opening';
  if (messageCount > 8) conversationPhase = 'closing';
  else if (messageCount > 4) conversationPhase = 'negotiating';
  else if (messageCount > 1) conversationPhase = 'inquiring';

  let buyerSentiment = 'neutral';
  const lastBuyerText = (lastBuyerMessage?.text || '').toLowerCase();
  if (/(predrag|ne morem|preveč|ne vem|počakaj|pomisl)/.test(lastBuyerText)) buyerSentiment = 'hesitant';
  else if (/(dogovor|kupim|se strinjam|super|odlič)/.test(lastBuyerText)) buyerSentiment = 'positive';
  else if (/(ne|nikoli|predrago|ne zanima)/.test(lastBuyerText)) buyerSentiment = 'negative';
  else if (/(zanimivo|povej več|kaj stanje|dodatno)/.test(lastBuyerText)) buyerSentiment = 'curious';

  const conversationHistory = messages.slice(-10).map(m => `[${m.role.toUpperCase()}] ${m.text}`).join('\n');

  return {
    lastMessage,
    lastBuyerMessage,
    buyerOfferedPrice,
    messageCount,
    conversationPhase,
    buyerSentiment,
    conversationHistory,
  };
}

interface PromptData {
  item: ItemContext;
  myGoal: MyGoal;
  strategy: string;
  minPrice: number;
  maxPrice: number;
  convo: ConversationState;
}

function buildPrompt(d: PromptData): string {
  const { item: i, myGoal, strategy, minPrice, maxPrice, convo: c } = d;
  return `Si AI real-time negotiation bot za slovenske oglasne platforme (Bolha, Facebook, Vinted).
Tvoja naloga je odgovoriti na zadnje sporočilo kupca z optimalno negotiation taktiko.

ITEM INFO:
- Naslov: "${i.itemTitle}"
- Kategorija: ${i.category || 'nepoznano'}
- Naša nabavna cena: ${i.tradeCost}€
- Estimirana tržna vrednost: ${i.estValue}€
- AI risk score: ${i.aiRisk}/10

NAŠ CILJ:
- Min acceptable price: ${minPrice}€
- Max target price: ${maxPrice}€
- Must include: ${(myGoal.mustInclude || []).join(', ') || 'nič'}
- Must avoid: ${(myGoal.mustAvoid || []).join(', ') || 'nič'}

STRATEGIJA: ${strategy}
- AGGRESSIVE: hitro pojdni na ceno, pritisni na close
- FIRM: drži ceno, počasi popuščaj
- PATIENT: odgovarjaj vprašanja, gradi zaupanje
- FRIENDLY: osebni pristop, empatija

ZGODOVINA POGOVORA (${c.messageCount} sporočil):
${c.conversationHistory}

ZADNJE SPOROČILO KUPCA: "${c.lastBuyerMessage?.text || c.lastMessage?.text}"
${c.buyerOfferedPrice ? `PONUDBA KUPCA: ${c.buyerOfferedPrice}€` : 'Cena še ni omenjena'}
FAZA POGOVARA: ${c.conversationPhase}
SENTIMENT KUPCA: ${c.buyerSentiment}

Negotiation taktike:
1. ANCHORING: postavi višjo začetno ceno da "sidraš" pričakovanja
2. SCARCITY: omeni da imaš druge zainteresirane (resnično ali暗示no)
3. URGENCY: časovni pritisk ("danes je ta cena")
4. EMPATHY: razume njegovo pozicijo preden predlagas kompromis
5. CONCESSION: postopno popuščaj (max 5% na krog)
6. TRADE_OFF: znižaj ceno za nekaj protiusluge (hitro plačilo, prevzem)
7. WALK_AWAY: pokaži da lahko odideš (če cena ni dovolj visoka)
8. SPLIT_DIFFERENCE: če mid-point between two offers, predlagaj razliko
9. SILENCE: včasih ne odgovori takoj (čas pritiska)
10. VALUE_FOCUS: opozori na vrednost ne samo ceno (stanje, garancija, dodatki)

Odgovori LE z JSON:
{
  "text": "<tvoj odgovor kupcu v slovenščini, max 200 znakov, naraven ton>",
  "suggested_price_eur": <number ali null>,
  "tone": "<friendly|professional|firm|playful|empathetic|urgent>",
  "next_step": "<wait_for_response|ask_question|make_counteroffer|close_deal|walk_away>",
  "confidence": <number 0-100>,
  "tactics_used": ["<max 80 znakov>"],
  "alternatives": [
    { "text": "<alternativni odgovor, max 200 znakov>", "tone": "<tone>", "scenario": "<max 80 znakov>" }
  ],
  "conversation_state": {
    "phase": "<opening|inquiring|negotiating|closing|closed>",
    "buyer_sentiment": "<positive|neutral|curious|hesitant|negative|hostile>",
    "round_number": <number>,
    "current_ask_eur": <number>,
    "current_bid_eur": <number ali null>,
    "spread_eur": <number ali null>,
    "agreement_probability_pct": <number 0-100>,
    "estimated_final_price_eur": <number>,
    "my_position": "<strong|comfortable|stretched|risky|walk_away>",
    "key_objections": ["<max 80 znakov>"]
  },
  "warnings": [
    { "type": "<lowball|scam_signal|stalling|off_platform|aggressive>", "description": "<max 120 znakov>", "action": "<max 100 znakov>" }
  ]
}`;
}

interface ResponseFallbacks {
  minPrice: number;
  maxPrice: number;
  messageCount: number;
  conversationPhase: string;
  buyerSentiment: string;
  buyerOfferedPrice: number | null;
}

function transformResponse(parsed: any, f: ResponseFallbacks) {
  return {
    text: String(parsed?.text ?? '').slice(0, 500),
    suggestedPriceEur: parsed?.suggested_price_eur !== null && parsed?.suggested_price_eur !== undefined
      ? Math.max(0, Math.round(Number(parsed.suggested_price_eur)))
      : null,
    tone: ['friendly', 'professional', 'firm', 'playful', 'empathetic', 'urgent'].includes(String(parsed?.tone)) ? String(parsed.tone) : 'professional',
    nextStep: ['wait_for_response', 'ask_question', 'make_counteroffer', 'close_deal', 'walk_away'].includes(String(parsed?.next_step)) ? String(parsed.nextStep) : 'wait_for_response',
    confidence: Math.max(0, Math.min(100, Number(parsed?.confidence ?? 60))),
    tacticsUsed: (parsed?.tactics_used || []).slice(0, 5).map((t: any) => String(t).slice(0, 150)),
    alternatives: (parsed?.alternatives || []).slice(0, 3).map((a: any) => ({
      text: String(a?.text ?? '').slice(0, 500),
      tone: ['friendly', 'professional', 'firm', 'playful', 'empathetic', 'urgent'].includes(String(a?.tone)) ? String(a.tone) : 'professional',
      scenario: String(a?.scenario ?? '').slice(0, 150),
    })),
    conversationState: {
      phase: ['opening', 'inquiring', 'negotiating', 'closing', 'closed'].includes(String(parsed?.conversation_state?.phase)) ? String(parsed.conversation_state.phase) : f.conversationPhase,
      buyerSentiment: ['positive', 'neutral', 'curious', 'hesitant', 'negative', 'hostile'].includes(String(parsed?.conversation_state?.buyer_sentiment)) ? String(parsed.conversation_state.buyer_sentiment) : f.buyerSentiment,
      roundNumber: Math.max(1, Number(parsed?.conversation_state?.round_number ?? Math.ceil(f.messageCount / 2))),
      currentAskEur: Math.max(0, Number(parsed?.conversation_state?.current_ask_eur ?? f.maxPrice)),
      currentBidEur: parsed?.conversation_state?.current_bid_eur !== null && parsed?.conversation_state?.current_bid_eur !== undefined
        ? Math.max(0, Number(parsed.conversation_state.current_bid_eur))
        : f.buyerOfferedPrice,
      spreadEur: parsed?.conversation_state?.spread_eur !== null && parsed?.conversation_state?.spread_eur !== undefined
        ? Math.round(Number(parsed.conversation_state.spread_eur))
        : (f.buyerOfferedPrice ? Math.max(0, f.maxPrice - f.buyerOfferedPrice) : null),
      agreementProbabilityPct: Math.max(0, Math.min(100, Number(parsed?.conversation_state?.agreement_probability_pct ?? 50))),
      estimatedFinalPriceEur: Math.max(0, Math.round(Number(parsed?.conversation_state?.estimated_final_price_eur ?? (f.minPrice + f.maxPrice) / 2))),
      myPosition: ['strong', 'comfortable', 'stretched', 'risky', 'walk_away'].includes(String(parsed?.conversation_state?.my_position)) ? String(parsed.conversation_state.my_position) : 'comfortable',
      keyObjections: (parsed?.conversation_state?.key_objections || []).slice(0, 5).map((o: any) => String(o).slice(0, 150)),
    },
    warnings: (parsed?.warnings || []).slice(0, 4).map((w: any) => ({
      type: ['lowball', 'scam_signal', 'stalling', 'off_platform', 'aggressive'].includes(String(w?.type)) ? String(w.type) : 'lowball',
      description: String(w?.description ?? '').slice(0, 250),
      action: String(w?.action ?? '').slice(0, 200),
    })),
  };
}
