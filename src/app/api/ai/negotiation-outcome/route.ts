// v6.14: AI Negotiation Outcome Predictor — napove verjetnost uspeha ponudbe
// POST /api/ai/negotiation-outcome
// Body: { listingId?: string, offerPrice?: number, message?: string, listing?: {...} }
// Returns: { ok, prediction: { successProbability, expectedCounterOffer, suggestedOffer, factors, scenarios, warnings, optimalStrategy } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

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
  sellerName?: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId, offerPrice, message } = body;
    let listingInput: ListingInput | null = body?.listing ?? null;
    const userOffer = Number(offerPrice) || 0;
    const userMessage = String(message || '').trim();

    // 1. Pridobi listing
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
        sellerName: listing.sellerName,
      };
    }

    if (!listingInput) {
      return NextResponse.json({ error: 'listingId ali listing objekt je obvezen' }, { status: 400 });
    }

    const listPrice = Number(listingInput.price) || 0;
    const estValue = listPrice * 1.2; // približek če ni na voljo AI estimated
    const userOfferFinal = userOffer > 0 ? userOffer : Math.round(listPrice * 0.85);
    const discountRequested = listPrice > 0 ? Math.round(((listPrice - userOfferFinal) / listPrice) * 100) : 0;

    // 2. Pridobi kontekst — prodajalčeva zgodovina in podobni oglasi
    let sellerHistory = '';
    let marketContext = '';

    if (listingInput.sellerName) {
      const sellerListings = await db.listing.findMany({
        where: { sellerName: listingInput.sellerName, isHidden: false },
        select: { price: true, previousPrice: true, priceDroppedAt: true, firstSeenAt: true, title: true },
        take: 30,
      });
      const droppedCount = sellerListings.filter(l => l.priceDroppedAt).length;
      const dropRate = sellerListings.length > 0 ? Math.round((droppedCount / sellerListings.length) * 100) : 0;
      const avgDaysListed = sellerListings.length > 0
        ? Math.round(sellerListings.reduce((s, l) => s + (Date.now() - l.firstSeenAt.getTime()) / (24 * 60 * 60 * 1000), 0) / sellerListings.length)
        : 0;
      sellerHistory = `${sellerListings.length} oglasov, ${dropRate}% je znižalo ceno, povp. ${avgDaysListed}d na trgu`;
    }

    if (listPrice > 0) {
      const similar = await db.listing.findMany({
        where: { price: { gte: Math.floor(listPrice * 0.7), lte: Math.ceil(listPrice * 1.3) }, isHidden: false },
        select: { price: true, firstSeenAt: true },
        take: 20,
      });
      const prices = similar.map(l => l.price!).filter(Boolean);
      if (prices.length > 0) {
        const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
        marketContext = `Tržno povprečje: ${avg}€ (range ${Math.min(...prices)}-${Math.max(...prices)}€)`;
      }
    }

    // 3. AI prediction
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const daysSincePosted = listingInput.postedAt
      ? Math.round((Date.now() - new Date(listingInput.postedAt).getTime()) / (24 * 60 * 60 * 1000))
      : 0;

    const prompt = `Si ekspert za napovedovanje izida pogajanj pri nakupu rabljenih dobrin.
Predvidi uspešnost ponudbe uporabnika za ta oglas.

OGLAS:
Naslov: ${listingInput.title}
Cena: ${listingInput.priceText || (listPrice + ' EUR')}
Lokacija: ${listingInput.location || 'neznan'}
VIR: ${listingInput.source || 'neznan'}
Starost oglasa: ${daysSincePosted} dni
Opis: ${(listingInput.description || '').slice(0, 500)}

PRODAJALEC:
${sellerHistory || '- Ni podatkov'}

TRŽNI KONTEKST:
${marketContext || '- Ni podatkov'}

UPORABNIKOVA PONUDBA:
- Ponujena cena: ${userOfferFinal}€ (popust ${discountRequested}% glede na zahtevano)
- Sporočilo: ${userMessage || '(brez sporočila — samo cena)'}

Pravila za napoved:
1. Verjetnost uspeha (0-100%) glede na:
   - Razlika med ponudbo in tržno vrednostjo
   - Starost oglasa (starejši = bolj motiviran prodajalec)
   - Prodajalčeva zgodovina (zniževal ali ne)
   - Konkurenca (koliko podobnih oglasov)
   - Kvaliteta sporočila (ali kaže resno zanimanje)

2. Predvideni proti-predlog prodajalca (counter-offer)

3. Optimalna strategija:
   - če je popust <15%: high probability, pošlji direktno
   - če je popust 15-25%: medium probability, pristni argumenti
   - če je popust >25%: low probability, rabi močne argumente ali čakaj na cenovni padec

4. Scenariji (3 možni izidi z verjetnostmi)

5. Opozorila (kdaj ne ponuditi)

Odgovori LE z JSON:
{
  "success_probability_pct": <number 0-100>,
  "confidence": <number 0-100>,
  "expected_counter_offer_eur": <number>,
  "suggested_optimal_offer_eur": <number>,
  "factors": [
    {
      "factor": "<faktor, npr. 'Cena pod tržno'>",
      "impact": "<positive|negative|neutral>",
      "weight": <number 1-10>,
      "explanation": "<max 80 znakov>"
    }
  ],
  "scenarios": [
    {
      "name": "<ime scenarija>",
      "probability_pct": <number>,
      "outcome": "<opis izida, max 100 znakov>",
      "final_price_eur": <number>
    }
  ],
  "warnings": ["<opozorilo, max 100 znakov>", "..."],
  "optimal_strategy": {
    "approach": "<direct_offer|build_rapport|wait_for_drop|bundle_offer|walk_away>",
    "timing": "<kdaj ponuditi, max 80 znakov>",
    "message_tips": ["<nasvet za sporočilo, max 100 znakov>", "..."]
  },
  "reasoning": "<celotna razlaga, max 300 znakov>"
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

    const prediction = {
      successProbabilityPct: Math.max(0, Math.min(100, Number(parsed?.success_probability_pct ?? 50))),
      confidence: Math.max(0, Math.min(100, Number(parsed?.confidence ?? 50))),
      expectedCounterOfferEur: Math.max(0, Number(parsed?.expected_counter_offer_eur ?? Math.round((userOfferFinal + listPrice) / 2))),
      suggestedOptimalOfferEur: Math.max(0, Number(parsed?.suggested_optimal_offer_eur ?? userOfferFinal)),
      factors: (parsed?.factors || []).slice(0, 8).map((f: any) => ({
        factor: String(f?.factor ?? '').slice(0, 100),
        impact: ['positive', 'negative', 'neutral'].includes(String(f?.impact)) ? String(f.impact) : 'neutral',
        weight: Math.max(1, Math.min(10, Number(f?.weight ?? 5))),
        explanation: String(f?.explanation ?? '').slice(0, 150),
      })),
      scenarios: (parsed?.scenarios || []).slice(0, 4).map((s: any) => ({
        name: String(s?.name ?? '').slice(0, 80),
        probabilityPct: Math.max(0, Math.min(100, Number(s?.probability_pct ?? 0))),
        outcome: String(s?.outcome ?? '').slice(0, 200),
        finalPriceEur: Math.max(0, Number(s?.final_price_eur ?? 0)),
      })),
      warnings: (parsed?.warnings || []).slice(0, 5).map((w: any) => String(w).slice(0, 200)),
      optimalStrategy: {
        approach: ['direct_offer', 'build_rapport', 'wait_for_drop', 'bundle_offer', 'walk_away'].includes(String(parsed?.optimal_strategy?.approach))
          ? String(parsed.optimal_strategy.approach) : 'direct_offer',
        timing: String(parsed?.optimal_strategy?.timing ?? '').slice(0, 200),
        messageTips: Array.isArray(parsed?.optimal_strategy?.message_tips)
          ? parsed.optimal_strategy.message_tips.slice(0, 5).map((t: any) => String(t).slice(0, 200))
          : [],
      },
      reasoning: String(parsed?.reasoning ?? '').slice(0, 500),
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
      prediction,
      listing: listingInput,
      userOffer: userOfferFinal,
      discountRequested,
      marketContext,
      sellerHistory,
      daysSincePosted,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
