// v6.20: Smart Negotiation Chatbot — več-turn pogovor z avtomatskim odgovarjanjem
// POST /api/ai/negotiation-chatbot
// Body: { listingId?: string, messages: [{ role: 'user'|'seller', text }], myGoal?: { maxPrice, mustInclude }, strategy?: 'aggressive'|'firm'|'patient' }
// Returns: { ok, reply: { text, suggestedPrice, tone, nextStep, confidence, alternatives }, conversationState }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ChatMessage {
  role: 'user' | 'seller';
  text: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId } = body;
    const messages: ChatMessage[] = Array.isArray(body?.messages) ? body.messages : [];
    const myGoal: { maxPrice?: number; mustInclude?: string[] } = body?.myGoal ?? {};
    const strategy = ['aggressive', 'firm', 'patient'].includes(String(body?.strategy))
      ? String(body.strategy) : 'firm';

    if (messages.length === 0) {
      return NextResponse.json({ error: 'messages array ne sme biti prazen' }, { status: 400 });
    }

    let listingContext = '';
    if (listingId) {
      const listing = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: {
          title: true, price: true, priceText: true, location: true,
          description: true, detailDescription: true, aiEstimatedValue: true,
          aiRisk: true, aiVerdict: true, postedAt: true, sellerName: true,
          previousPrice: true, priceDroppedAt: true,
        },
      });
      if (listing) {
        const daysPosted = listing.postedAt
          ? Math.round((Date.now() - listing.postedAt.getTime()) / (24 * 60 * 60 * 1000))
          : 0;
        listingContext = `OGLAS: ${listing.title}
Cena: ${listing.priceText || (listing.price + ' EUR')}
Lokacija: ${listing.location}
AI est. vrednost: ${listing.aiEstimatedValue ?? 'neznan'}€
Starost oglasa: ${daysPosted} dni
${listing.previousPrice ? `Prejšnja cena: ${listing.previousPrice}€ (padla!)` : ''}
Opis: ${(listing.detailDescription || listing.description || '').slice(0, 400)}`;
      }
    }

    // 1. AI chatbot
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const messagesStr = messages.map((m, i) => {
      const speaker = m.role === 'user' ? 'JAZ (kupec)' : 'PRODAJALEC';
      return `[#${i + 1}] ${speaker}: ${m.text}`;
    }).join('\n');

    const goalStr = myGoal.maxPrice
      ? `Moja max cena: ${myGoal.maxPrice}€`
      : 'Cilj cena: ni specifična — minimiziraj';
    const mustIncludeStr = myGoal.mustInclude?.length
      ? `Pogoji: ${myGoal.mustInclude.join(', ')}`
      : '';

    const prompt = `Si AI pogajalski asistent, ki mi pomaga pri nakupu rabljene dobrine.
Na podlagi dosedanjega pogovora in konteksta oglasa generiraj moj naslednji odgovor prodajalcu.

${listingContext ? listingContext + '\n\n' : ''}MOJA STRATEGIJA: ${strategy}
${goalStr}
${mustIncludeStr}

DOSLEDENJI POGOVOR:
${messagesStr}

Pravila za odgovor:
1. Besedilo naj bo v slovenščini, naravno in osebno (ne robotsko)
2. Ohranjaj ${strategy} ton:
   - aggressive: 15-25% pod tržno, firm maš prednosti
   - firm: 10-15% pod tržno, argumenti
   - patient: sprašuj več, čakaj na padec
3. Sklicuj se na prejšnje prodajalčeve izjave
4. Postavi vprašanje ali naredi konkretno ponudbo
5. Če prodajalec preveč pritiska, omeni alternative ( konkurenčni oglasi)
6. Nikoli ne razkrij mojega max budgeta
7. Ohrani odgovor 50-150 besed (kratek in jedrnat)

Odgovori LE z JSON:
{
  "text": "<moj odgovor prodajalcu, 50-150 besed v slovenščini>",
  "suggested_price_eur": <number | null>,
  "tone": "<aggressive|firm|friendly|patient|questioning>",
  "next_step": "<kaj storiti če prodajalec odgovori, max 100 znakov>",
  "confidence_pct": <number 0-100>,
  "alternatives": ["<alternativni odgovor, max 100 znakov>", "..."],
  "conversation_state": "<opening|discovery|offer|counter|closing|stuck>",
  "warning": "<opozorilo če nekaj gre narobe, max 100 znakov | null>"
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = {
          provider: aiSettings.fallbackProvider,
          baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '',
          model: aiSettings.fallbackModel,
        };
        raw = await callProviderForRaw(fb, prompt);
      } else {
        return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);

    const reply = {
      text: String(parsed?.text ?? '').slice(0, 1500),
      suggestedPriceEur: parsed?.suggested_price_eur != null
        ? Math.max(0, Number(parsed.suggested_price_eur)) : null,
      tone: ['aggressive', 'firm', 'friendly', 'patient', 'questioning'].includes(String(parsed?.tone))
        ? String(parsed.tone) : strategy,
      nextStep: String(parsed?.next_step ?? '').slice(0, 200),
      confidencePct: Math.max(0, Math.min(100, Number(parsed?.confidence_pct ?? 60))),
      alternatives: (parsed?.alternatives || []).slice(0, 3).map((a: any) => String(a).slice(0, 200)),
      conversationState: ['opening', 'discovery', 'offer', 'counter', 'closing', 'stuck'].includes(String(parsed?.conversation_state))
        ? String(parsed.conversation_state) : 'opening',
      warning: parsed?.warning && parsed.warning !== 'null'
        ? String(parsed.warning).slice(0, 200) : null,
    };

    // Increment AI usage
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      reply,
      messageCount: messages.length,
      strategy,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
