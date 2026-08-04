// v6.22: AI Buyer Persona Generator — ustvari profile kupcev za ciljano trženje
// POST /api/ai/buyer-persona
// Body: { tradeId?: string, category?: string, priceRange?: { min, max } }
// Returns: { ok, personas: [{ name, ageRange, location, occupation, income, motivations, painPoints, channels, messaging, willingnessToPay }], marketingStrategy }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { tradeId, customerName } = body;
    let category: string = body?.category ?? '';
    let priceMin: number = body?.priceRange?.min ?? 0;
    let priceMax: number = body?.priceRange?.max ?? 0;
    let title = '';
    let description = '';

    // v7.32: Frontend BuyersView sends { customerName } (derived from sellLocation).
    // Resolve it to the buyer's most common category + actual spend range.
    if (!tradeId && !category && customerName) {
      const buyerTrades = await db.trade.findMany({
        where: { sellLocation: String(customerName), status: 'sold', sellPrice: { not: null } },
        select: { title: true, category: true, sellPrice: true, sellDate: true },
        take: 30,
        orderBy: { sellDate: 'desc' },
      });
      if (buyerTrades.length === 0) {
        return NextResponse.json({ error: `Za kupca "${customerName}" ni prodaj v zgodovini.` }, { status: 404 });
      }
      const catCounts: Record<string, number> = {};
      for (const t of buyerTrades) { const c = (t.category || 'drugo').trim(); catCounts[c] = (catCounts[c] || 0) + 1; }
      category = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0][0];
      const prices = buyerTrades.map(t => t.sellPrice ?? 0).filter(p => p > 0).sort((a, b) => a - b);
      if (prices.length) {
        priceMin = Math.min(priceMin || prices[0], prices[0]);
        priceMax = Math.max(priceMax || prices[prices.length - 1], prices[prices.length - 1]);
      }
      title = `${customerName} — ${buyerTrades.length} nakupov`;
      description = `Zadnji nakupi: ` + buyerTrades.slice(0, 5).map(t => `${t.title} (${t.sellPrice}€)`).join(', ');
    }

    if (tradeId) {
      const trade = await db.trade.findUnique({
        where: { id: String(tradeId) },
        select: {
          title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, aiEstimatedValue: true } },
        },
      });
      if (!trade) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
      title = trade.title;
      category = category || trade.category || '';
      priceMin = priceMin || Math.round(trade.buyPrice * 0.9);
      priceMax = priceMax || Math.round((trade.listing?.aiEstimatedValue ?? trade.buyPrice * 1.25) * 1.1);
      description = trade.listing?.detailDescription || trade.listing?.description || '';
    }

    if (!category && !tradeId && !customerName) {
      return NextResponse.json({ error: 'category, tradeId ali customerName je obvezen' }, { status: 400 });
    }

    // 1. Pridobi sold trades za kontekst kupcev
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, category: category || undefined },
      select: { title: true, category: true, sellPrice: true, sellLocation: true, sellDate: true },
      take: 30,
    });

    // 2. AI generiranje person
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const soldStr = soldTrades.slice(0, 10).map(t =>
      `- ${t.title} | ${(t.sellLocation || 'neznan')} | ${t.sellPrice}€`
    ).join('\n');

    const prompt = `Si ekspert za buyer persona development in ciljano trženje.
Za kategorijo "${category}" ustvari 3 različne buyer persone za optimalno trženje.

${title ? `NASLOV ITEM-A: ${title}` : ''}
CENOVNI RAZPON: ${priceMin}€ - ${priceMax}€
${description ? `OPIS: ${description.slice(0, 300)}` : ''}

ZGODOVINSKE PRODAJE V KATEGORIJI:
${soldStr || '- Ni podatkov'}

Slovenski kontekst:
- Prebivalstvo: 2.1M, povprečna plača ~1300€ neto
- Regije: Ljubljana (bogatejši), Maribor (cenejši), Primorska (premium)
- Starostne skupine: 18-25 (študenti, nizek budget), 25-40 (družine, srednji budget), 40-60 (ugr. kariere, visok budget)
- Slovenski kupci: previdni, raziščejo pred nakupom, radi vidijo/pregledajo

Strategije person:
1. BUDGET_CONSCIOUS: študenti/začetniki, nizka cena primarna
2. QUALITY_SEEKER: družine, kakovost primarna
3. PREMIUM Buyer: visok dohodek, redkost/znamka primarna
4. COLLECTOR: zbiratelji, redkost primarna
5. FLIPPER: preprodajalci, marža primarna

Odgovori LE z JSON:
{
  "personas": [
    {
      "name": "<ime persone, npr. 'Študent Tomaž'>",
      "type": "<BUDGET_CONSCIOUS|QUALITY_SEEKER|PREMIUM|COLLECTOR|FLIPPER>",
      "age_range": "<18-25|25-40|40-60|60+>",
      "location": "<Ljubljana|Maribor|Primorska|Štajerska|Gorenjska|Dolenjska|vsi>",
      "occupation": "<opis, max 50 znakov>",
      "income_range_eur": "<npr. '800-1200'>",
      "motivations": ["<zakaj bi kupil, max 80 znakov>", "..."],
      "pain_points": ["<skrbi, max 80 znakov>", "..."],
      "preferred_channels": ["<Bolha|Facebook|Vinted|prijatelji|...>", "..."],
      "willingness_to_pay_eur": <number>,
      "decision_time_days": <number>,
      "messaging": {
        "hook": "<kaj pritegne, max 100 znakov>",
        "tone": "<prijateljski|poslovni|emergentni|...>",
        "key_arguments": ["<argument, max 80 znakov>", "..."],
        "call_to_action": "<CTA, max 80 znakov>"
      },
      "price_sensitivity": "<high|medium|low>",
      "trust_factors": ["<kaj prepriča, max 80 znakov>", "..."],
      "objection_handling": [
        {
          "objection": "<pritožba, max 80 znakov>",
          "response": "<odgovor, max 100 znakov>"
        }
      ]
    }
  ],
  "marketing_strategy": {
    "primary_persona": "<ime glavne persone>",
    "secondary_persona": "<ime sekundarne persone>",
    "recommended_platform": "<bolha|vinted|facebook|avtonet>",
    "optimal_timing": "<kdaj objaviti, max 80 znakov>",
    "listing_tone": "<kakšen ton opisa, max 80 znakov>",
    "must_include_in_listing": ["<kaj mora biti v opisu, max 80 znakov>", "..."],
    "avoid_in_listing": ["<čemu se izogibati, max 80 znakov>", "..."]
  },
  "insights": "<splošne ugotovitve o trgu, max 200 znakov>"
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

    const personas = (parsed?.personas || []).slice(0, 4).map((p: any) => ({
      name: String(p?.name ?? '').slice(0, 80),
      type: ['BUDGET_CONSCIOUS', 'QUALITY_SEEKER', 'PREMIUM', 'COLLECTOR', 'FLIPPER'].includes(String(p?.type))
        ? String(p.type) : 'BUDGET_CONSCIOUS',
      ageRange: String(p?.age_range ?? '').slice(0, 30),
      location: String(p?.location ?? '').slice(0, 50),
      occupation: String(p?.occupation ?? '').slice(0, 100),
      incomeRangeEur: String(p?.income_range_eur ?? '').slice(0, 30),
      motivations: (p?.motivations || []).slice(0, 5).map((m: any) => String(m).slice(0, 150)),
      painPoints: (p?.pain_points || []).slice(0, 5).map((pp: any) => String(pp).slice(0, 150)),
      preferredChannels: (p?.preferred_channels || []).slice(0, 5).map((c: any) => String(c).slice(0, 50)),
      willingnessToPayEur: Math.max(0, Number(p?.willingness_to_pay_eur ?? 0)),
      decisionTimeDays: Math.max(0, Number(p?.decision_time_days ?? 7)),
      messaging: {
        hook: String(p?.messaging?.hook ?? '').slice(0, 200),
        tone: String(p?.messaging?.tone ?? '').slice(0, 50),
        keyArguments: (p?.messaging?.key_arguments || []).slice(0, 5).map((a: any) => String(a).slice(0, 150)),
        callToAction: String(p?.messaging?.call_to_action ?? '').slice(0, 150),
      },
      priceSensitivity: ['high', 'medium', 'low'].includes(String(p?.price_sensitivity)) ? String(p.price_sensitivity) : 'medium',
      trustFactors: (p?.trust_factors || []).slice(0, 5).map((t: any) => String(t).slice(0, 150)),
      objectionHandling: (p?.objection_handling || []).slice(0, 4).map((o: any) => ({
        objection: String(o?.objection ?? '').slice(0, 150),
        response: String(o?.response ?? '').slice(0, 200),
      })),
    }));

    const marketingStrategy = {
      primaryPersona: String(parsed?.marketing_strategy?.primary_persona ?? '').slice(0, 80),
      secondaryPersona: String(parsed?.marketing_strategy?.secondary_persona ?? '').slice(0, 80),
      recommendedPlatform: ['bolha', 'vinted', 'facebook', 'avtonet'].includes(String(parsed?.marketing_strategy?.recommended_platform))
        ? String(parsed.marketing_strategy.recommended_platform) : 'bolha',
      optimalTiming: String(parsed?.marketing_strategy?.optimal_timing ?? '').slice(0, 200),
      listingTone: String(parsed?.marketing_strategy?.listing_tone ?? '').slice(0, 200),
      mustIncludeInListing: (parsed?.marketing_strategy?.must_include_in_listing || []).slice(0, 6).map((m: any) => String(m).slice(0, 150)),
      avoidInListing: (parsed?.marketing_strategy?.avoid_in_listing || []).slice(0, 4).map((a: any) => String(a).slice(0, 150)),
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
      personas,
      marketingStrategy,
      insights: String(parsed?.insights ?? '').slice(0, 500),
      category,
      priceRange: { min: priceMin, max: priceMax },
    });
  } catch (e: any) {
    logger.error("/api/ai/buyer-persona", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
