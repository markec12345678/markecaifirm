// v5.4: Negotiation messages — sledi pogajanjem z vsakim prodajalcem
// GET /api/listings/:id/negotiations — list all messages for listing
// POST /api/listings/:id/negotiations — add new message + AI suggest next step
//   Body: { direction: 'sent'|'received', text, isAiGenerated?, suggestedPrice?, status? }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const messages = await db.negotiationMessage.findMany({
    where: { listingId: id },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  if (!body?.direction || !['sent', 'received'].includes(body.direction)) {
    return NextResponse.json({ error: 'Direction mora biti sent ali received' }, { status: 400 });
  }
  if (!body?.text || typeof body.text !== 'string') {
    return NextResponse.json({ error: 'Text je obvezen' }, { status: 400 });
  }

  const listing = await db.listing.findUnique({
    where: { id },
    select: {
      id: true, title: true, price: true, priceText: true, url: true,
      aiVerdict: true, aiScore: true, aiRisk: true, aiEstimatedValue: true,
      aiReason: true, dealScore: true, targetPrice: true,
    },
  });
  if (!listing) {
    return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
  }

  // Get previous messages for context
  const previousMessages = await db.negotiationMessage.findMany({
    where: { listingId: id },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  // Determine status
  let status = body.status ?? 'initial';
  if (body.direction === 'sent') {
    if (body.suggestedPrice != null) {
      status = 'offer_sent';
    } else if (previousMessages.length === 0) {
      status = 'initial';
    }
  } else if (body.direction === 'received') {
    if (previousMessages.some(m => m.direction === 'sent' && m.suggestedPrice != null)) {
      status = 'counter_received';
    }
  }

  // Create message
  const message = await db.negotiationMessage.create({
    data: {
      listingId: id,
      direction: body.direction,
      text: body.text,
      isAiGenerated: body.isAiGenerated === true,
      status,
      suggestedPrice: body.suggestedPrice ?? null,
    },
  });

  // AI suggest next step
  let aiNextStep: string | null = null;
  try {
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '',
      fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = buildNextStepPrompt(listing, [...previousMessages, message]);
    const raw = await callProviderForRaw(aiSettings, prompt);
    const parsed: any = parseJsonLooseExported(raw);
    aiNextStep = String(parsed?.next_step ?? parsed?.naslednji_korak ?? '').slice(0, 1000);

    // Update message with AI next step
    if (aiNextStep) {
      await db.negotiationMessage.update({
        where: { id: message.id },
        data: { aiNextStep },
      });
    }

    // Increment AI usage counter
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({
        where: { id: 'singleton' },
        data: { aiCallsDate: today, aiCallsToday: 1 },
      });
    } else {
      await db.settings.update({
        where: { id: 'singleton' },
        data: { aiCallsToday: { increment: 1 } },
      });
    }
  } catch (e) {
    // AI failure is non-critical
    console.error('AI next step failed:', e);
  }

  return NextResponse.json({
    ok: true,
    message: { ...message, aiNextStep },
  });
}

function buildNextStepPrompt(listing: any, messages: any[]): string {
  const parts: string[] = [
    'Si ekspert za pogajanje na slovenskih spletnih oglasih.',
    'Na podlagi dosedanjih sporočil in podatkov o oglasu predlagaj NASLEDNJI KORAK v pogajanju.',
    '',
    `Oglas: ${listing.title}`,
    `Cena: ${listing.priceText}${listing.price ? ` (${listing.price}€)` : ''}`,
    `AI tržna vrednost: ${listing.aiEstimatedValue ?? '?'}€`,
    `AI verdikt: ${listing.aiVerdict ?? '?'}`,
    `Deal score: ${listing.dealScore ?? '?'}/100`,
    `Ciljna cena: ${listing.targetPrice ?? '?'}€`,
    '',
    'Zgodovina pogajanja:',
  ];

  messages.forEach((m, i) => {
    const dir = m.direction === 'sent' ? '➡️ JAZ' : '⬅️ PRODAJALEC';
    const price = m.suggestedPrice ? ` (ponudba: ${m.suggestedPrice}€)` : '';
    parts.push(`${i + 1}. ${dir}${price}: ${m.text}`);
  });

  parts.push('', 'Analiziraj:');
  parts.push('1. Ali je prodajalec pripravljen na pogajanje?');
  parts.push('2. Kakšno ceno naj ponudim naslednjo?');
  parts.push('3. Ali naj počakam, pošljem sporočilo, ali končam pogajanje?');
  parts.push('4. Kaksen naj bo ton in pristop?');
  parts.push('', 'Odgovori LE z JSON: {"next_step": "<kratek naslednji korak v slovenščini, max 300 znakov>"}');

  return parts.join('\n');
}
