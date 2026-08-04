// v6.14: AI Multi-Modal Listing Generator — generira celovit listing za prodajo
// POST /api/ai/multimodal-listing
// Body: { tradeId?: string, trade?: { title, category, buyPrice, description }, targetPlatform?: 'bolha'|'vinted'|'facebook'|'avtonet', language?: 'sl'|'en' }
// Returns: { ok, listing: { title, description, price, platforms: [{ name, titleAdapted, priceAdapted, descriptionAdapted }], imageStrategy, tags, keywords, seo } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

interface TradeInput {
  title: string;
  category?: string;
  buyPrice?: number;
  buyFees?: number;
  description?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { tradeId, targetPlatform, language } = body;
    let tradeInput: TradeInput | null = body?.trade ?? null;
    const lang = language === 'en' ? 'en' : 'sl';
    const platform = ['bolha', 'vinted', 'facebook', 'avtonet'].includes(String(targetPlatform))
      ? String(targetPlatform) : 'bolha';

    // 1. Pridobi trade iz baze
    if (tradeId && !tradeInput) {
      const trade = await db.trade.findUnique({
        where: { id: String(tradeId) },
        select: {
          title: true, category: true, buyPrice: true, buyFees: true,
          notes: true, listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true, dealScore: true } },
        },
      });
      if (!trade) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
      tradeInput = {
        title: trade.title,
        category: trade.category,
        buyPrice: trade.buyPrice,
        buyFees: trade.buyFees,
        description: trade.notes || trade.listing?.detailDescription || trade.listing?.description,
      };
    }

    if (!tradeInput) {
      return NextResponse.json({ error: 'tradeId ali trade objekt je obvezen' }, { status: 400 });
    }

    // 2. Pridobi kontekst — podobni aktivni oglasi za benchmark
    const cost = (tradeInput.buyPrice ?? 0) + (tradeInput.buyFees ?? 0);
    let marketBenchmark = '';

    if (cost > 0) {
      const similar = await db.listing.findMany({
        where: {
          price: { gte: Math.floor(cost * 0.7), lte: Math.ceil(cost * 1.5) },
          isHidden: false,
        },
        select: { price: true, title: true, firstSeenAt: true, monitor: { select: { source: true } } },
        take: 20,
      });
      const prices = similar.map(l => l.price!).filter(Boolean);
      if (prices.length > 0) {
        const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        marketBenchmark = `Tržno povprečje podobnih: ${avg}€ (min ${min}€, max ${max}€, ${prices.length} oglasov)`;
      }
    }

    // 3. AI multi-modal listing generation
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za copywriting in marketing pri prodaji rabljenih dobrin.
Generiraj celovit listing za prodajo tega artikla, optimiziran za ${platform}.

ARTIKEL:
Naslov: ${tradeInput.title}
Kategorija: ${tradeInput.category || 'neznan'}
Nabavna cena: ${cost}€
Opis: ${(tradeInput.description || '').slice(0, 800)}

${marketBenchmark ? `TRŽNI BENCHMARK:\n${marketBenchmark}\n` : ''}
Ciljna platforma: ${platform}
Jezik: ${lang === 'sl' ? 'slovenščina' : 'angleščina'}

Pravila za vsako platformo:
- Bolha: dovoljen naslov 60 znakov, opis 2000 znakov, poudari stanje in kontakt
- Vinted: naslov 80 znakov, opis 500 znakov, fokus na stanje/brend/size, hash tags
- Facebook Marketplace: naslov 100 znakov, opis 5000 znakov, emoji, fokus na ceno in lokacijo
- Avtonet: naslov 50 znakov, opis 1000 znakov, tehnični podatki, letnik, km

Slikovna strategija:
- glavna slika: dobra osvetlitev, čisto ozadje, celotni item viden
- detalj: pokaži brand/oznako, morebitne poškodbe
- kontekst: item v uporabi (npr. telefon v roki, kolo na cesti)
- video: 360° vrtenje za dragocene iteme (>500€)

SEO ključne besede: 5-10 relevantnih iskalnih besed, ki jih kupec išče

Odgovori LE z JSON:
{
  "title": "<optimiziran naslov za ${platform}, max 100 znakov>",
  "price_recommendation": <number>,
  "price_strategy": "<premium|fair|aggressive>",
  "main_description": "<glavni opis v ${lang === 'sl' ? 'slovenščini' : 'angleščini'}, 800-1500 znakov>",
  "platforms_adaptations": [
    {
      "platform": "bolha",
      "title": "<naslov prilagojen za bolha, max 60 znakov>",
      "price": <number>,
      "description_short": "<krajši opis za bolha, max 500 znakov>"
    },
    {
      "platform": "facebook",
      "title": "<naslov za FB, max 100 znakov, z emoji>",
      "price": <number>,
      "description_short": "<opis za FB z emoji, max 800 znakov>"
    },
    {
      "platform": "vinted",
      "title": "<naslov za Vinted, max 80 znakov>",
      "price": <number>,
      "description_short": "<opis za Vinted s hashtagi, max 400 znakov>"
    }
  ],
  "image_strategy": {
    "main_shot": "<opis glavne slike, max 100 znakov>",
    "detail_shots": ["<detalj 1, max 80 znakov>", "<detalj 2>", "<detalj 3>"],
    "context_shot": "<kontekstna slika, max 100 znakov>",
    "video_recommended": <boolean>,
    "video_description": "<kakšen video, max 100 znakov>"
  },
  "tags_keywords": ["<ključna beseda 1>", "..."],
  "seo": {
    "primary_keyword": "<glavna ključna beseda>",
    "search_terms": ["<izraz ki ga kupec išče>", "..."]
  },
  "call_to_action": "<CTA na koncu opisa, max 80 znakov>",
  "highlight_features": ["<feature 1, max 50 znakov>", "..."],
  "honest_disclosures": ["<pošteno povedano o stanju, max 80 znakov>", "..."]
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

    const listing = {
      title: String(parsed?.title ?? tradeInput.title).slice(0, 200),
      priceRecommendation: Math.max(0, Number(parsed?.price_recommendation ?? Math.round(cost * 1.25))),
      priceStrategy: ['premium', 'fair', 'aggressive'].includes(String(parsed?.price_strategy))
        ? String(parsed.price_strategy) : 'fair',
      mainDescription: String(parsed?.main_description ?? '').slice(0, 3000),
      platformsAdaptations: (parsed?.platforms_adaptations || []).slice(0, 4).map((p: any) => ({
        platform: ['bolha', 'vinted', 'facebook', 'avtonet'].includes(String(p?.platform))
          ? String(p.platform) : 'bolha',
        title: String(p?.title ?? '').slice(0, 200),
        price: Math.max(0, Number(p?.price ?? 0)),
        descriptionShort: String(p?.description_short ?? '').slice(0, 1500),
      })),
      imageStrategy: {
        mainShot: String(parsed?.image_strategy?.main_shot ?? '').slice(0, 200),
        detailShots: Array.isArray(parsed?.image_strategy?.detail_shots)
          ? parsed.image_strategy.detail_shots.slice(0, 5).map((s: any) => String(s).slice(0, 150))
          : [],
        contextShot: String(parsed?.image_strategy?.context_shot ?? '').slice(0, 200),
        videoRecommended: Boolean(parsed?.image_strategy?.video_recommended ?? false),
        videoDescription: String(parsed?.image_strategy?.video_description ?? '').slice(0, 200),
      },
      tagsKeywords: Array.isArray(parsed?.tags_keywords)
        ? parsed.tags_keywords.slice(0, 12).map((t: any) => String(t).slice(0, 50))
        : [],
      seo: {
        primaryKeyword: String(parsed?.seo?.primary_keyword ?? '').slice(0, 80),
        searchTerms: Array.isArray(parsed?.seo?.search_terms)
          ? parsed.seo.search_terms.slice(0, 8).map((s: any) => String(s).slice(0, 80))
          : [],
      },
      callToAction: String(parsed?.call_to_action ?? '').slice(0, 200),
      highlightFeatures: Array.isArray(parsed?.highlight_features)
        ? parsed.highlight_features.slice(0, 6).map((f: any) => String(f).slice(0, 100))
        : [],
      honestDisclosures: Array.isArray(parsed?.honest_disclosures)
        ? parsed.honest_disclosures.slice(0, 4).map((d: any) => String(d).slice(0, 200))
        : [],
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
      listing,
      trade: { ...tradeInput, cost },
      marketBenchmark,
      platform,
      language: lang,
    });
  } catch (e: any) {
    logger.error("/api/ai/multimodal-listing", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
