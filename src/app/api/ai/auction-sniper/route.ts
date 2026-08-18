/**
 * @deprecated v8.94 — uporabi `/api/ai/auction-sniper-v2` namesto tega.
 * Zastareli v1 — v2 je najnovejši.
 * Ta endpoint bo odstranjen v v9.0. Glej ENDPOINTS_AUDIT.md za migracijski načrt.
 */
// v6.12: AI Auction Sniper — strategija za last-minute bidding / čakanje na cenovni padec
// POST /api/ai/auction-sniper
// Body: { listingId?: string, listing?: { title, price, location, description, source, postedAt } }
// Returns: { ok, strategy: { mode, action, timing: { wait, bid, deadline }, maxBid, snipeTime, reasoning, signals, contingencies } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';
import { logDeprecatedCall } from '@/lib/deprecated-redirect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ListingInput {
  title: string;
  price?: number | null;
  priceText?: string;
  location?: string;
  description?: string;
  source?: string;
  postedAt?: string | null;
}

export async function POST(req: NextRequest) {
  logDeprecatedCall('/api/ai/auction-sniper', req, '/api/ai/auction-sniper-v2');
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId } = body;
    let listingInput: ListingInput | null = body?.listing ?? null;

    // 1. Če je podan listingId, pridobi iz baze
    if (listingId && !listingInput) {
      const listing = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: {
          title: true, price: true, priceText: true, location: true, description: true,
          detailDescription: true, url: true, aiEstimatedValue: true, aiRisk: true,
          aiVerdict: true, aiReason: true, dealScore: true, postedAt: true,
          sellerName: true, sellerListingCount: true, previousPrice: true, priceDroppedAt: true,
          firstSeenAt: true, monitor: { select: { source: true, name: true } },
        },
      });
      if (!listing) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      listingInput = {
        title: listing.title,
        price: listing.price,
        priceText: listing.priceText,
        location: listing.location,
        description: listing.detailDescription || listing.description,
        source: listing.monitor?.source,
        postedAt: listing.postedAt?.toISOString() ?? null,
      };
    }

    if (!listingInput) {
      return NextResponse.json({ error: 'listingId ali listing objekt je obvezen' }, { status: 400 });
    }

    // 2. Pridobi kontekst — price drop patterns in seller history
    const listingPrice = Number(listingInput.price) || 0;
    let marketSignals: string[] = [];

    if (listingPrice > 0) {
      // Podobni oglasi in njihova starost
      const similar = await db.listing.findMany({
        where: {
          price: { gte: Math.floor(listingPrice * 0.7), lte: Math.ceil(listingPrice * 1.3) },
          isHidden: false,
        },
        select: { price: true, firstSeenAt: true, previousPrice: true, priceDroppedAt: true, title: true },
        take: 30,
      });
      const droppedCount = similar.filter(l => l.priceDroppedAt).length;
      const dropRate = similar.length > 0 ? Math.round((droppedCount / similar.length) * 100) : 0;
      if (dropRate > 30) {
        marketSignals.push(`${dropRate}% podobnih oglasov je že znižalo ceno — verjetno bo tudi ta`);
      }
      // Povprečna starost oglasov
      const avgAgeDays = similar.length > 0
        ? Math.round(similar.reduce((s, l) => s + (Date.now() - l.firstSeenAt.getTime()) / (24 * 60 * 60 * 1000), 0) / similar.length)
        : 0;
      if (avgAgeDays > 14) {
        marketSignals.push(`Podobni oglasi so v povprečju stari ${avgAgeDays}d — prodajalci so morda bolj motivirani`);
      }
    }

    // 3. AI auction sniper analiza
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const postedAtStr = listingInput.postedAt
      ? new Date(listingInput.postedAt).toISOString()
      : 'neznan';
    const daysSincePosted = listingInput.postedAt
      ? Math.round((Date.now() - new Date(listingInput.postedAt).getTime()) / (24 * 60 * 60 * 1000))
      : 0;

    const prompt = `Si ekspert za "auction sniping" strategijo pri nakupu rabljenih dobrin.
Analiziraj oglas in predlagaj optimalno strategijo: kdaj kontaktirati, koliko ponuditi, kdaj čakati.

OGLAS:
NASLOV: ${listingInput.title}
CENA: ${listingInput.priceText || (listingPrice + ' EUR')}
LOKACIJA: ${listingInput.location || 'neznan'}
VIR: ${listingInput.source || 'neznan'}
DODAN: ${postedAtStr} (${daysSincePosted}d nazaj)
OPIS: ${(listingInput.description || '').slice(0, 600)}

TRŽNI SIGNALI:
${marketSignals.length > 0 ? marketSignals.map(s => `- ${s}`).join('\n') : '- Ni posebnih signalov'}

Strategije (mode):
- "wait_drop": čakaj na cenovni padec (primerno ko prodajalci tipično znižujejo)
- "snipe_now": kontaktiraj takoj z nižjo ponudbo (redki itemi, visoka konkurenca)
- "last_minute": kontaktiraj ob koncu tedna/dneva ko prodajalci popuščajo
- "patient_hold": ne kontaktiraj še, počakaj 7-14d na večji padec
- "aggressive_bid": takojšnja agresivna ponudba (80% cene) — za redke/high-demand iteme

Za vsako strategijo določi:
- maxBid: maksimalna ponudba v EUR
- snipeTime: kdaj točno kontaktirati (datum/uro ali "v X dneh")
- wait: koliko dni čakati od zdaj
- bid: kdaj staviti (urov v dnevu)
- deadline: do kdaj velja ponudba
- signals: ključni signali ki podpirajo strategijo (3-5)
- contingencies: kaj narediti če prodajalec ne odgovori/zavrne (2-3)

Odgovori LE z JSON:
{
  "mode": "<wait_drop|snipe_now|last_minute|patient_hold|aggressive_bid>",
  "action": "<konkretno dejanje, max 150 znakov>",
  "maxBid": <number>,
  "timing": {
    "wait": <number, koliko dni čakati>,
    "bid": "<urov/dan za kontakt, max 80 znakov>",
    "deadline": "<do kdaj velja, max 80 znakov>"
  },
  "snipeTime": "<natančen opis kdaj, max 150 znakov>",
  "reasoning": "<zakaj ta strategija, max 200 znakov>",
  "signals": ["<signal, max 100 znakov>", "..."],
  "contingencies": ["<kaj če, max 100 znakov>", "..."],
  "priceDropProbability": <number 0-100>,
  "competitionLevel": "<low|medium|high>",
  "estimatedDealScore": <number 0-100>
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

    const strategy = {
      mode: ['wait_drop', 'snipe_now', 'last_minute', 'patient_hold', 'aggressive_bid'].includes(String(parsed?.mode))
        ? String(parsed.mode) : 'wait_drop',
      action: String(parsed?.action ?? '').slice(0, 250),
      maxBid: Math.max(0, Number(parsed?.maxBid ?? Math.round(listingPrice * 0.85))),
      timing: {
        wait: Math.max(0, Math.min(60, Number(parsed?.timing?.wait ?? 0))),
        bid: String(parsed?.timing?.bid ?? '').slice(0, 150),
        deadline: String(parsed?.timing?.deadline ?? '').slice(0, 150),
      },
      snipeTime: String(parsed?.snipeTime ?? '').slice(0, 250),
      reasoning: String(parsed?.reasoning ?? '').slice(0, 300),
      signals: Array.isArray(parsed?.signals)
        ? parsed.signals.slice(0, 6).map((s: any) => String(s).slice(0, 200))
        : [],
      contingencies: Array.isArray(parsed?.contingencies)
        ? parsed.contingencies.slice(0, 4).map((c: any) => String(c).slice(0, 200))
        : [],
      priceDropProbability: Math.max(0, Math.min(100, Number(parsed?.priceDropProbability ?? 50))),
      competitionLevel: ['low', 'medium', 'high'].includes(String(parsed?.competitionLevel))
        ? String(parsed.competitionLevel) : 'medium',
      estimatedDealScore: Math.max(0, Math.min(100, Number(parsed?.estimatedDealScore ?? 50))),
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
      strategy,
      listing: listingInput,
      marketSignals,
      daysSincePosted,
    });
  } catch (e: any) {
    logger.error("/api/ai/auction-sniper", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
