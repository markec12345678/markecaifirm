// v6.28: AI Auction Timing Optimizer — optimalni čas za bid na dražbah
// POST /api/ai/auction-timing
// Body: { listingId?: string, auctionEnd?: string, currentBid?: number }
// Returns: { ok, timing: { optimalBidTime, maxBid, strategy, bidSequence, competitors, signals } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId } = body;
    const auctionEnd = body?.auctionEnd ? new Date(body.auctionEnd) : null;
    const currentBid = Number(body?.currentBid) || 0;

    let title = '', price = 0, description = '', location = '';
    if (listingId) {
      const listing = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: { title: true, price: true, description: true, detailDescription: true,
          location: true, postedAt: true, aiEstimatedValue: true, dealScore: true,
          monitor: { select: { source: true } } },
      });
      if (!listing) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      title = listing.title;
      price = listing.price ?? currentBid;
      description = listing.detailDescription || listing.description;
      location = listing.location;
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const now = new Date();
    const hoursToEnd = auctionEnd ? Math.round((auctionEnd.getTime() - now.getTime()) / (60 * 60 * 1000)) : 0;

    const prompt = `Si ekspert za strategije bidding na spletnih dražbah (eBay, Bolha, Avtonet).
Optimiziraj timing in višino ponudbe za to dražbo.

NASLOV: ${title}
TRENUTNA PONUDBA: ${currentBid || price}€
${auctionEnd ? `KONEC DRAŽBE: ${auctionEnd.toISOString()} (čez ${hoursToEnd}h)` : 'KONEC DRAŽBE: neznan'}
LOKACIJA: ${location}
OPIS: ${description.slice(0, 500)}

Strategije bidding:
- "snipe_last_second": ponudi 3s pred koncom (prepreči bid wars)
- "early_high": visoka ponudba zgodaj (odvrne konkurenco)
- "incremental": postopno povišuj (testira konkurenco)
- "wait_and_snipe": čakaj do zadnje minute, nato snipe
- "proxy_bid": nastavi max bid in pusti sistem

Pravila:
1. Določi maxBid (tvoj absolutni limit) glede na tržno vrednost
2. Optimalen čas za bid: 5-60s pred koncom (snipe)
3. Upoštevaj konkurenco (več bidderjev = višji maxBid ne, prej snipe)
4. Bid sekvenca: kdaj in koliko ponuditi (1-3 koraki)

Odgovori LE z JSON:
{
  "optimal_bid_time": "<kdaj bidati, max 100 znakov>",
  "seconds_before_end": <number>,
  "max_bid_eur": <number>,
  "suggested_bid_eur": <number>,
  "strategy": "<snipe_last_second|early_high|incremental|wait_and_snipe|proxy_bid>",
  "bid_sequence": [
    { "step": <number>, "timing": "<kdaj, max 50 znakov>", "amount_eur": <number>, "condition": "<max 80 znakov>" }
  ],
  "competitor_analysis": {
    "estimated_bidders": <number>,
    "competition_level": "<low|medium|high>",
    "likely_max_competitor_bid_eur": <number>
  },
  "signals": ["<tržni signal, max 80 znakov>", "..."],
  "risk_factors": ["<tveganje, max 80 znakov>", "..."],
  "recommendation": "<bid_now|wait|set_proxy|skip>",
  "reasoning": "<max 200 znakov>"
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);

    const timing = {
      optimalBidTime: String(parsed?.optimal_bid_time ?? '').slice(0, 200),
      secondsBeforeEnd: Math.max(0, Math.min(300, Number(parsed?.seconds_before_end ?? 5))),
      maxBidEur: Math.max(0, Number(parsed?.max_bid_eur ?? 0)),
      suggestedBidEur: Math.max(0, Number(parsed?.suggested_bid_eur ?? 0)),
      strategy: ['snipe_last_second', 'early_high', 'incremental', 'wait_and_snipe', 'proxy_bid'].includes(String(parsed?.strategy))
        ? String(parsed.strategy) : 'snipe_last_second',
      bidSequence: (parsed?.bid_sequence || []).slice(0, 4).map((b: any) => ({
        step: Math.max(1, Number(b?.step ?? 1)),
        timing: String(b?.timing ?? '').slice(0, 100),
        amountEur: Math.max(0, Number(b?.amount_eur ?? 0)),
        condition: String(b?.condition ?? '').slice(0, 150),
      })),
      competitorAnalysis: {
        estimatedBidders: Math.max(0, Number(parsed?.competitor_analysis?.estimated_bidders ?? 0)),
        competitionLevel: ['low', 'medium', 'high'].includes(String(parsed?.competitor_analysis?.competition_level))
          ? String(parsed.competitor_analysis.competition_level) : 'medium',
        likelyMaxCompetitorBidEur: Math.max(0, Number(parsed?.competitor_analysis?.likely_max_competitor_bid_eur ?? 0)),
      },
      signals: (parsed?.signals || []).slice(0, 5).map((s: any) => String(s).slice(0, 150)),
      riskFactors: (parsed?.risk_factors || []).slice(0, 5).map((r: any) => String(r).slice(0, 150)),
      recommendation: ['bid_now', 'wait', 'set_proxy', 'skip'].includes(String(parsed?.recommendation))
        ? String(parsed.recommendation) : 'wait',
      reasoning: String(parsed?.reasoning ?? '').slice(0, 400),
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, timing, hoursToEnd });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
