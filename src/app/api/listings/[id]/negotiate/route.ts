import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { evaluateListing, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/listings/:id/negotiate
 * Generates AI negotiation message for contacting the seller.
 *
 * Body: { type: 'initial' | 'low_offer' | 'polite_decline', lang?: 'sl' | 'en' | 'de' | 'it' | 'hr' }
 *
 * Returns: { message: string, suggestedPrice?: number, lang: string, type: string }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const type: string = body?.type ?? 'initial';
  // v4.6: Multi-language support
  const lang: string = ['sl', 'en', 'de', 'it', 'hr'].includes(body?.lang) ? body.lang : 'sl';

  const listing = await db.listing.findUnique({
    where: { id },
    select: {
      id: true, title: true, price: true, priceText: true, url: true,
      location: true, description: true, aiScore: true, aiRisk: true,
      aiVerdict: true, aiReason: true, aiEstimatedValue: true,
      monitor: { select: { name: true, source: true } },
    },
  });
  if (!listing) return NextResponse.json({ error: 'Ne najdem' }, { status: 404 });

  const settings = await getSettingsRow();
  const aiSettings: AiSettings = {
    provider: settings.aiProvider as AiSettings['provider'],
    baseUrl: settings.aiBaseUrl,
    apiKey: settings.aiApiKey,
    model: settings.aiModel,
  };

  // Determine suggested price based on AI estimate and market data
  let suggestedPrice: number | null = null;
  if (listing.aiEstimatedValue && listing.aiEstimatedValue < (listing.price ?? 0)) {
    // AI thinks it's worth less than asking price — suggest AI estimate
    suggestedPrice = listing.aiEstimatedValue;
  } else if (listing.aiEstimatedValue && listing.price) {
    // AI thinks it's worth more — suggest 10-15% below asking
    suggestedPrice = Math.round(listing.price * 0.85);
  } else if (listing.price) {
    // No AI estimate — suggest 10% below asking
    suggestedPrice = Math.round(listing.price * 0.9);
  }

  const typeLabels: Record<string, string> = {
    initial: 'začetno sporočilo (povpraševanje)',
    low_offer: 'nizko ponudbo (pogajanje)',
    polite_decline: 'vljudno zavrnitev',
  };

  // v4.6: Multi-language support
  const langConfig: Record<string, { name: string; instructions: string }> = {
    sl: {
      name: 'slovenščini',
      instructions: 'Vedno v slovenščini. Naravno, vljudno, tipično za slovenske oglase (Bolha, Avtonet, Nepremičnine, Vinted).',
    },
    en: {
      name: 'English',
      instructions: 'Always in English. Natural, polite, suitable for international marketplaces (eBay, Facebook Marketplace).',
    },
    de: {
      name: 'Deutsch',
      instructions: 'Immer auf Deutsch. Natürlich, höflich, typisch für deutsche Kleinanzeigen (Kleinanzeigen.de, willhaben.at).',
    },
    it: {
      name: 'Italiano',
      instructions: 'Sempre in italiano. Naturale, cortese, adatto per siti italiani (Subito.it, eBay Italia).',
    },
    hr: {
      name: 'Hrvatski',
      instructions: 'Uvijek na hrvatskom. Prirodno, pristojno, tipično za hrvatske oglase (Njuškalo, Index Oglasi).',
    },
  };
  const langInfo = langConfig[lang] ?? langConfig.sl;

  const promptType = typeLabels[type] ?? typeLabels.initial;

  const systemPrompt = `Si pomočnik za pogajanje na spletnih oglasnih mestih.
Tvoja naloga je napisati kratko, vljudno in naravno sporočilo prodajalcu v ${langInfo.name}.

Pravila:
- Sporočilo naj bo kratko (2-4 stavki)
- Naravno in prijazno, ne roboto
- Vključi specifično povpraševanje (stanje, dodatki, možnost ogleda)
- Če je nizka ponudba, utemelji zakaj (nižja tržna vrednost, poškodbe, starost)
- Ne omenjaj AI-ja ali da si bot — piši kot da si pravi kupec
- ${langInfo.instructions}`;

  let userPrompt = `Napiši ${promptType} za naslednji oglas:

Naslov: ${listing.title}
Cena: ${listing.priceText}${listing.price ? ` (${listing.price} €)` : ''}
AI ocena tržne vrednosti: ${listing.aiEstimatedValue ?? 'ni ocene'} €
AI ocena prilike: ${listing.aiScore ?? '?'}/10
AI ocena tveganja: ${listing.aiRisk ?? '?'}/10
Lokacija: ${listing.location || 'ni podatka'}
Vir: ${listing.monitor.source}
Opis: ${(listing.description || '(brez opisa)').slice(0, 300)}`;

  if (type === 'initial') {
    userPrompt += `\n\nPredlagana ponudba: ${suggestedPrice ?? 'brez ponudbe, samo povpraševanje'} €
Napiši začetno sporočilo: povprašaj o stanju, vprašaj ali je še na voljo, in če primerno predlagi srečanje za ogled. Ne predlagaj cene še — samo pokaži zanimanje.`;
  } else if (type === 'low_offer') {
    userPrompt += `\n\nPredlagana ponudba: ${suggestedPrice ?? '?'} € (to je ${listing.price ? Math.round((1 - (suggestedPrice ?? 0) / listing.price) * 100) : 0}% pod asking ceno)
Napiši nizko ponudbo: vljudno predlagaj ceno, utemelji zakaj (primerjava z drugimi oglasi, stanje, morebitne pomanjkljosti). Bodi direkten ampak prijazen.`;
  } else if (type === 'polite_decline') {
    userPrompt += `\n\nNapiši vljudno zavrnitev: zahvali se za odgovor, ampak povej da ne ustreza (predrago, našel drugo, itd.). Pusti vrata odprta za prihodnje oglase.`;
  }

  userPrompt += `\n\nJezik: ${langInfo.name}. Vrni SAMO sporočilo (brez uvoda, brez oznak, brez "Tukaj je sporočilo:"). Samo besedilo sporočila.`;

  try {
    // Use the AI provider to generate the message
    // We'll use a simple chat completion (not the structured JSON mode)
    let message = '';

    if (aiSettings.provider === 'ollama') {
      const res = await fetch(`${aiSettings.baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: aiSettings.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream: false,
          options: { temperature: 0.7 },
        }),
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json();
      message = data?.message?.content ?? '';
    } else if (aiSettings.provider === 'anthropic') {
      const baseUrl = aiSettings.baseUrl.replace(/\/$/, '') || 'https://api.anthropic.com';
      const url = baseUrl.endsWith('/v1/messages') ? baseUrl : baseUrl + '/v1/messages';
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': aiSettings.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: aiSettings.model,
          max_tokens: 500,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
          temperature: 0.7,
        }),
      });
      if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
      const data = await res.json();
      const blocks: Array<{ type: string; text?: string }> = data?.content ?? [];
      message = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n');
    } else {
      // OpenAI-compatible
      const baseUrl = aiSettings.baseUrl.replace(/\/$/, '');
      const url = baseUrl.endsWith('/v1') || baseUrl.endsWith('/chat/completions')
        ? (baseUrl.endsWith('/chat/completions') ? baseUrl : baseUrl + '/chat/completions')
        : baseUrl + '/v1/chat/completions';
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(aiSettings.apiKey ? { Authorization: `Bearer ${aiSettings.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: aiSettings.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
      });
      if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
      const data = await res.json();
      message = data?.choices?.[0]?.message?.content ?? '';
    }

    // Clean up the message
    message = message.trim();
    // Remove common AI prefixes
    message = message.replace(/^(Tukaj je sporočilo:|Sporočilo:|Pozdravljeni,?\s*)/i, '');
    message = message.replace(/^["']|["']$/g, '');

    return NextResponse.json({
      ok: true,
      message,
      suggestedPrice,
      type,
      lang,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.message ?? 'Napaka pri generiranju sporočila',
      lang,
      type,
    }, { status: 200 });
  }
}
