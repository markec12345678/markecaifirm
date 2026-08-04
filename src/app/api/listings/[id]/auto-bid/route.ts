// v5.0: AI auto-bidding — generate bid strategy + message to seller
// POST /api/listings/:id/auto-bid
// Body: {
//   strategy: 'aggressive' | 'moderate' | 'conservative',
//   maxBudget?: number, // EUR cap (optional)
//   sendToTelegram?: boolean, // send result to Telegram for review
// }
// Returns: { ok, bid: { suggestedPrice, strategy, reasoning, message, expectedResponse } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface BidRequest {
  strategy: 'aggressive' | 'moderate' | 'conservative';
  maxBudget?: number;
  sendToTelegram?: boolean;
}

interface BidResult {
  suggestedPrice: number;
  strategy: string;
  reasoning: string;
  message: string;
  expectedResponse: string;
  confidence: number; // 0-100
  marketPosition: string; // 'below_market' | 'at_market' | 'above_market'
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body: BidRequest = await req.json();
    const strategy = body.strategy ?? 'moderate';

    if (!['aggressive', 'moderate', 'conservative'].includes(strategy)) {
      return NextResponse.json({ error: 'Strategija mora biti aggressive/moderate/conservative' }, { status: 400 });
    }

    const listing = await db.listing.findUnique({
      where: { id },
      include: {
        monitor: { select: { name: true, source: true } },
        priceHistory: {
          orderBy: { seenAt: 'asc' },
          select: { price: true, priceText: true, seenAt: true },
          take: 20,
        },
      },
    });
    if (!listing) {
      return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
    }

    // Get market data (similar listings)
    let marketData: any = null;
    if (listing.price != null) {
      const min = Math.floor(listing.price * 0.7);
      const max = Math.ceil(listing.price * 1.3);
      const similar = await db.listing.findMany({
        where: {
          monitorId: listing.monitorId,
          id: { not: listing.id },
          price: { gte: min, lte: max },
          isHidden: false,
        },
        select: { price: true, aiVerdict: true, aiScore: true, dealScore: true, firstSeenAt: true },
        take: 50,
      });
      if (similar.length > 0) {
        const prices = similar.map(s => s.price!).filter(Boolean);
        marketData = {
          count: similar.length,
          average: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
          min: Math.min(...prices),
          max: Math.max(...prices),
          median: prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)],
        };
      }
    }

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

    const prompt = buildBidPrompt(listing, strategy, body.maxBudget, marketData);

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fallbackSettings: AiSettings = {
          provider: aiSettings.fallbackProvider,
          baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '',
          model: aiSettings.fallbackModel,
        };
        try {
          raw = await callProviderForRaw(fallbackSettings, prompt);
        } catch (fallbackError: any) {
          return NextResponse.json(
            { error: `Primary: ${primaryError?.message ?? 'failed'} | Fallback: ${fallbackError?.message ?? 'failed'}` },
            { status: 500 }
          );
        }
      } else {
        return NextResponse.json({ error: primaryError?.message ?? 'AI call failed' }, { status: 500 });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const bid: BidResult = {
      suggestedPrice: clampInt(parsed?.suggested_price ?? parsed?.suggestedPrice ?? parsed?.price, 0, 1_000_000) ?? (listing.price ?? 0),
      strategy,
      reasoning: String(parsed?.reasoning ?? parsed?.razlog ?? '').slice(0, 1000),
      message: String(parsed?.message ?? parsed?.sporocilo ?? '').slice(0, 2000),
      expectedResponse: String(parsed?.expected_response ?? parsed?.pričakovan_odgovor ?? parsed?.expectedResponse ?? '').slice(0, 500),
      confidence: clampInt(parsed?.confidence ?? parsed?.zaupanje, 0, 100) ?? 50,
      marketPosition: String(parsed?.market_position ?? parsed?.trg_pozicija ?? 'at_market'),
    };

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

    // Optional: send to Telegram for review
    if (body.sendToTelegram && settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
      try {
        const { sendTelegramMessage } = await import('@/lib/telegram');
      const msg = `🤖 *AI Auto-Bid predlog*

*${listing.title}*
Cena: ${listing.priceText}
Strategija: ${strategy}

💡 *Predlagana ponudba:* ${bid.suggestedPrice}€
📊 Pozicija: ${bid.marketPosition}
🎯 Zaupanje: ${bid.confidence}/100

*Razlog:*
${bid.reasoning}

*Sporočilo prodajalcu:*
${bid.message}

⚠️ Preglej in prilagodi pred pošiljanjem!`;

        await sendTelegramMessage(
          { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
          msg
        );
      } catch { /* ignore telegram errors */ }
    }

    return NextResponse.json({ ok: true, bid, marketData });

  } catch (err) {
    logger.error("/api/listings/[id]/auto-bid", "POST handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}

function buildBidPrompt(l: any, strategy: string, maxBudget: number | null | undefined, marketData: any): string {
  const strategyConfig: Record<string, { name: string; pct; desc: string }> = {
    aggressive: { name: 'Agresivna', pct: 0.75, desc: 'Cilj je 20-30% pod tržno ceno. Visoko tveganje zavrnitve, ampak velik dobiček.' },
    moderate: { name: 'Zmerna', pct: 0.85, desc: 'Cilj je 10-15% pod tržno ceno. Realna ponudba, dobra možnost sprejema.' },
    conservative: { name: 'Konzervativna', pct: 0.95, desc: 'Cilj je 5% pod tržno ceno. Visoka možnost sprejema, manjši dobiček.' },
  };
  const cfg = strategyConfig[strategy];

  const parts: string[] = [
    'Si ekspert za pogajanje na slovenskih spletnih oglasih.',
    `Strategija: ${cfg.name} — ${cfg.desc}`,
    '',
    `Naslov: ${l.title}`,
    `Cena: ${l.priceText}${l.price ? ` (${l.price} EUR)` : ''}`,
    `Lokacija: ${l.location || 'ni podatka'}`,
    `Vir: ${l.monitor?.source ?? 'neznan'}`,
    `Opis: ${(l.detailDescription || l.description || '').slice(0, 1500)}`,
  ];

  if (l.aiEstimatedValue) {
    parts.push(`AI ocenjena tržna vrednost: ${l.aiEstimatedValue} EUR`);
  }
  if (l.aiScore != null) parts.push(`AI ocena prilike: ${l.aiScore}/10`);
  if (l.aiRisk != null) parts.push(`AI ocena tveganja: ${l.aiRisk}/10`);
  if (l.dealScore != null) parts.push(`Deal Score: ${l.dealScore}/100`);

  if (marketData) {
    parts.push('');
    parts.push(`Tržni podatki (${marketData.count} podobnih oglasov):`);
    parts.push(`  Povprečje: ${marketData.average}€`);
    parts.push(`  Mediana: ${marketData.median}€`);
    parts.push(`  Min-Max: ${marketData.min}-${marketData.max}€`);
  }

  if (l.priceHistory && l.priceHistory.length > 1) {
    parts.push('');
    parts.push(`Zgodovina cene (${l.priceHistory.length} zapisov):`);
    const oldest = l.priceHistory[0];
    const newest = l.priceHistory[l.priceHistory.length - 1];
    parts.push(`  Prva: ${oldest.priceText} (${oldest.seenAt ? new Date(oldest.seenAt).toLocaleDateString('sl-SI') : '?'})`);
    parts.push(`  Zadnja: ${newest.priceText}`);
  }

  if (maxBudget != null) {
    parts.push('');
    parts.push(`⚠️ MOJ PRORAČUN: ${maxBudget}€ (ne presegi!)`);
  }

  parts.push('', 'Odgovori LE z JSON v tej obliki:');
  parts.push('{');
  parts.push('  "suggested_price": <number EUR>,');
  parts.push('  "reasoning": "<kratek razlog zakaj ta cena, max 300 znakov>",');
  parts.push('  "message": "<sporočilo prodajalcu v slovenščini, 2-4 stavki, vljudno in naravno>",');
  parts.push('  "expected_response": "<kaj pričakujem od prodajalca (sprejme/zavrne/pogaja), 1 stavek>",');
  parts.push('  "confidence": <0-100, kako verjetno je da bo sprejeto>,');
  parts.push('  "market_position": "<below_market | at_market | above_market>"');
  parts.push('}');

  return parts.join('\n');
}

function clampInt(v: any, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
}
