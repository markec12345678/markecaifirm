// v7.39: AI Cross-Platform Listing Generator — generira prodajne oglase za 3 platforme.
//
// Ko si pripravljen prodati item, AI generira:
// - Bolha oglas (slovenski, podroben, SEO optimiziran)
// - Vinted oglas (krajši, moda-style, hashtags)
// - Facebook Marketplace (direkten, cenejsi tone, local pickup)
//
// Vsak oglas je optimiziran za platformo: dolzina, ton, kljucne besede, format.
//
// POST /api/ai/cross-platform-listing-generator
// Body: { tradeId: string }
// Returns: { ok, listings: { bolha, vinted, facebook }, pricing, photos }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { tradeId } = body;
    if (!tradeId) return NextResponse.json({ error: 'tradeId je obvezen' }, { status: 400 });

    const trade = await db.trade.findUnique({
      where: { id: String(tradeId) },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true,
        imageUrl: true, url: true, notes: true,
        listing: { select: { description: true, aiEstimatedValue: true, detailDescription: true, aiImageAnalysis: true } },
      },
    });
    if (!trade) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });

    const totalCost = trade.buyPrice + (trade.buyFees ?? 0);
    const estValue = trade.listing?.aiEstimatedValue ?? Math.round(totalCost * 1.25);
    const description = trade.listing?.detailDescription || trade.listing?.description || trade.notes || '';

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za pisanje prodajnih oglasov na slovenskih oglasnih platformah.

Generiraj 3 razlicne oglase za ta item — vsak optimiziran za drugo platformo.

ITEM:
- Naslov: ${trade.title}
- Kategorija: ${trade.category || 'splosno'}
- Nabavna cena: ${totalCost}€
- AI ocenjena vrednost: ${estValue}€
- Opis/artikel: ${description.slice(0, 500) || 'Ni dodatnega opisa'}
${trade.listing?.aiImageAnalysis ? `- AI analiza slike: ${trade.listing.aiImageAnalysis}` : ''}

CENOVNA STRATEGIJA:
- Nabavna: ${totalCost}€
- Predlagana prodajna cena: ${estValue}€ (margin: ${estValue - totalCost}€)
- Hitra prodaja (7 dni): ${Math.round(estValue * 0.9)}€
- Premium (30 dni): ${Math.round(estValue * 1.1)}€

PRAVILA ZA PLATFORMO:

1. BOLHA.COM:
- Dolzina: 200-400 besed
- Ton: podroben, informativen, profesionalen
- Struktura: naslov → stanje → specifikacije → dodaten paket → prevzem
- SEO: naravno vkljuci iskalne besede
- Obvezno omeni: stanje (novo/rabljeno), starost, dodatki, garancija
- Format: Markdown (bold naslovi, bullet tocke)

2. VINTED:
- Dolzina: 50-100 besed (krajse!)
- Ton: lazji, bolj osbnostni, emoji dovoljen
- Struktura: kratek opis → stanje → meri/velikost → postnina
- Tags: #hashtag style na koncu
- Fokus na: stanje, brend, velikost/meritve

3. FACEBOOK MARKETPLACE:
- Dolzina: 80-150 besed
- Ton: direkten, konkreten, lokalno
- Struktura: kaj je → stanje → cena → prevzem/posiljanje
- Fokus na: cena (poudari popust), lokacija, hitra prevzem
- POMEMBNO: omeni da si zasebna oseba (ne dealer)

Odgovori LE z JSON:
{
  "pricing": {
    "bolha": <number>,
    "vinted": <number>,
    "facebook": <number>,
    "reasoning": "<zakaj razlicne cene>"
  },
  "listings": {
    "bolha": {
      "title": "<max 80 znakov>",
      "description": "<full markdown>",
      "price": <number>
    },
    "vinted": {
      "title": "<max 80 znakov>",
      "description": "<kratek tekst>",
      "tags": ["#tag1", "#tag2", "..."],
      "price": <number>
    },
    "facebook": {
      "title": "<max 80 znakov>",
      "description": "<direkten tekst>",
      "price": <number>,
      "location_hint": "<npr. Ljubljana center>"
    }
  },
  "photo_tips": ["<nasvet za fotografijo 1>", "..."],
  "listing_strategy": "<1 stavek: katero platformo prvo in zakaj>"
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else {
        return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);

    return NextResponse.json({
      ok: true,
      trade: { id: trade.id, title: trade.title, buyPrice: totalCost, estValue },
      pricing: {
        bolha: Math.round(Number(parsed?.pricing?.bolha ?? estValue)),
        vinted: Math.round(Number(parsed?.pricing?.vinted ?? estValue * 0.95)),
        facebook: Math.round(Number(parsed?.pricing?.facebook ?? estValue * 0.9)),
        reasoning: String(parsed?.pricing?.reasoning ?? '').slice(0, 200),
      },
      listings: {
        bolha: {
          title: String(parsed?.listings?.bolha?.title ?? trade.title).slice(0, 80),
          description: String(parsed?.listings?.bolha?.description ?? '').slice(0, 2000),
          price: Math.round(Number(parsed?.listings?.bolha?.price ?? estValue)),
        },
        vinted: {
          title: String(parsed?.listings?.vinted?.title ?? trade.title).slice(0, 80),
          description: String(parsed?.listings?.vinted?.description ?? '').slice(0, 500),
          tags: (parsed?.listings?.vinted?.tags || []).slice(0, 10).map((t: any) => String(t).slice(0, 30)),
          price: Math.round(Number(parsed?.listings?.vinted?.price ?? estValue * 0.95)),
        },
        facebook: {
          title: String(parsed?.listings?.facebook?.title ?? trade.title).slice(0, 80),
          description: String(parsed?.listings?.facebook?.description ?? '').slice(0, 1000),
          price: Math.round(Number(parsed?.listings?.facebook?.price ?? estValue * 0.9)),
          locationHint: String(parsed?.listings?.facebook?.location_hint ?? 'Ljubljana').slice(0, 50),
        },
      },
      photoTips: (parsed?.photo_tips || []).slice(0, 5).map((t: any) => String(t).slice(0, 200)),
      listingStrategy: String(parsed?.listing_strategy ?? '').slice(0, 300),
    });
  } catch (err: any) {
    logger.error('/api/ai/cross-platform-listing-generator', 'POST handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
