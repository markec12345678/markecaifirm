// v7.48: Auto-Listing Draft Creator — generira pripravljen Bolha oglas za copy-paste.
//
// Razlika od Cross-Platform Listing Generator: ta je FOKUSIRAN na Bolho,
// z vsemi obveznimi polji ki jih Bolha zahteva (kategorija, stanje, lokacija).
// Generira TEXT ki ga direkt copy-paste-aš v Bolha obrazec.
//
// POST /api/ai/auto-listing-draft
// Body: { tradeId: string, platform?: 'bolha' | 'vinted' | 'facebook' }
// Returns: { ok, draft: { title, category, condition, price, description, tags, location } }

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
    const { tradeId, platform = 'bolha' } = body;
    if (!tradeId) return NextResponse.json({ error: 'tradeId je obvezen' }, { status: 400 });

    const trade = await db.trade.findUnique({
      where: { id: String(tradeId) },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true,
        notes: true, imageUrl: true,
        listing: { select: { aiEstimatedValue: true, description: true, detailDescription: true, aiImageAnalysis: true, aiImageVerdict: true, price: true } },
      },
    });
    if (!trade) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });

    const totalCost = trade.buyPrice + (trade.buyFees ?? 0);
    const estValue = trade.listing?.aiEstimatedValue ?? Math.round(totalCost * 1.2);
    const originalDesc = trade.listing?.detailDescription || trade.listing?.description || '';
    const imageAnalysis = trade.listing?.aiImageAnalysis || '';

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const platformRules: Record<string, string> = {
      bolha: `BOLHA.COM PRAVILA:
- Naslov: max 80 znakov, vključi brand + model + ključno specifikacijo
- Kategorija: izberi iz Bolha kategorij (npr. "Elektronika > Telefoni in pametne ure")
- Stanje: novo / rabljeno - odlično / rabljeno - dobro / rabljeno - zadovoljivo
- Opis: 200-400 besed, Markdown dovoljen
- Obvezno: stanje, starost, dodatki, garancija, prevzem/pošiljanje
- Cena: realna (ne predrago, ne pod ceno)`,
      vinted: `VINTED PRAVILA:
- Naslov: max 80 znakov, vključi brand + velikost
- Opis: 50-150 besed, emoji dovoljen
- Obvezno: stanje, brand, velikost/meritve
- Tags: #hashtag format`,
      facebook: `FACEBOOK MARKETPLACE PRAVILA:
- Naslov: max 80 znakov, direktno
- Opis: 80-150 besed, pogovorno
- Obvezno: cena, lokacija, prevzem
- Poudari: da si zasebna oseba (ne dealer)`,
    };

    const prompt = `Si ekspert za pisanje prodajnih oglasov na slovenskih platformah.

Generiraj POPOLN OGLAS za ${platform.toUpperCase()} ki ga lahko direkt copy-paste.

ITEM:
- Naslov: ${trade.title}
- Kategorija: ${trade.category || 'splošno'}
- Nabavna cena: ${totalCost}€
- AI ocena vrednosti: ${estValue}€
- Originalni opis: ${originalDesc.slice(0, 500) || 'Ni opisa'}
${imageAnalysis ? `- AI analiza slike: ${imageAnalysis}` : ''}

${platformRules[platform] || platformRules.bolha}

CENA: Določi optimalno prodajno ceno (cilj: hitra prodaja v 14 dneh z max profitom).
- Nabava: ${totalCost}€
- Pričakovan dobiček: ${estValue - totalCost}€
- Priporočena cena: ${Math.round(estValue * 0.95)}€ (5% pod est. za hitro prodajo)

Odgovori LE z JSON:
{
  "title": "<max 80 znakov, SEO optimiziran>",
  "category": "<Bolha kategorija pot>",
  "condition": "<novo|rabajeno-odlicno|rabajeno-dobro|rabajeno-zadovoljivo>",
  "price_eur": <number>,
  "description": "<full opis, Markdown formatiran, 200-400 besed>",
  "tags": ["<tag1>", "<tag2>", "..."],
  "location": "<mesto>",
  "shipping": "<pošiljanje možnosti>",
  "payment": "<plačilo možnosti>",
  "listing_tips": ["<nasvet za Bolha objavo>", "..."],
  "expected_sell_time_days": <number>,
  "expected_profit_eur": <number>
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else {
        return NextResponse.json({
          ok: true,
          draft: {
            title: trade.title.slice(0, 80),
            category: trade.category || 'Splošno',
            condition: 'rabajeno-dobro',
            price: Math.round(estValue * 0.95),
            description: `${trade.title}\n\nStanje: rabljeno, dobro ohranjeno.\n\nPrevzem: osebno, po dogovoru.\nPošiljanje: Pošta Slovenije.`,
            tags: [],
            listingTips: ['Dodaj 6+ fotografij', 'Odgovarjaj hitro na sporočila'],
            expectedSellTimeDays: 14,
            expectedProfitEur: Math.round(estValue * 0.95 - totalCost),
          },
          note: 'AI ni na voljo — osnovni predlog.',
        });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);

    return NextResponse.json({
      ok: true,
      draft: {
        title: String(parsed?.title ?? trade.title).slice(0, 80),
        category: String(parsed?.category ?? trade.category ?? 'Splošno').slice(0, 100),
        condition: String(parsed?.condition ?? 'rabajeno-dobro').slice(0, 30),
        price: Math.round(Number(parsed?.price_eur ?? estValue * 0.95)),
        description: String(parsed?.description ?? '').slice(0, 2000),
        tags: (parsed?.tags || []).slice(0, 10).map((t: any) => String(t).slice(0, 30)),
        location: String(parsed?.location ?? 'Ljubljana').slice(0, 50),
        shipping: String(parsed?.shipping ?? 'Pošta Slovenije, osebni prevzem').slice(0, 100),
        payment: String(parsed?.payment ?? 'Gotovina, nakazilo').slice(0, 100),
        listingTips: (parsed?.listing_tips || []).slice(0, 5).map((t: any) => String(t).slice(0, 200)),
        expectedSellTimeDays: Math.max(1, Math.min(60, Number(parsed?.expected_sell_time_days ?? 14))),
        expectedProfitEur: Math.round(Number(parsed?.expected_profit_eur ?? (estValue * 0.95 - totalCost))),
      },
      trade: { id: trade.id, title: trade.title, buyPrice: totalCost, estValue },
    });
  } catch (err: any) {
    logger.error('/api/ai/auto-listing-draft', 'POST handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
