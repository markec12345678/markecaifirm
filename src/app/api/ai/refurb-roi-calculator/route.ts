// v7.46: Refurbishment ROI Calculator — ali se splača obnoviti item pred prodajo?
//
// "Čiščenje: +15€ vrednosti, nova baterija: +30€, strošek 10€ = net +35€ profit"
// "Popravljen zaslon: +80€ vrednosti, strošek 40€ = net +40€ profit"
//
// POST /api/ai/refurb-roi-calculator
// Body: { tradeId: string }
// Returns: { ok, analysis: { currentValue, refurbOptions, recommendation } }

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
        notes: true, imageUrl: true,
        listing: { select: { aiEstimatedValue: true, description: true, aiImageAnalysis: true, detailDescription: true } },
      },
    });
    if (!trade) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });

    const totalCost = trade.buyPrice + (trade.buyFees ?? 0);
    const estValue = trade.listing?.aiEstimatedValue ?? Math.round(totalCost * 1.2);
    const description = trade.listing?.detailDescription || trade.listing?.description || trade.notes || '';
    const imageAnalysis = trade.listing?.aiImageAnalysis || '';

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za preprodajo rabljenih dobrin in ocenjevanje vrednosti obnov (refurbishment).

ITEM:
- Naslov: ${trade.title}
- Kategorija: ${trade.category || 'splošno'}
- Nabavna cena: ${totalCost}€
- Trenutna ocenjena vrednost: ${estValue}€
- Opis: ${description.slice(0, 500) || 'Ni opisa'}
${imageAnalysis ? `- AI analiza slike: ${imageAnalysis}` : ''}

NALOGA:
Oceni ali se splača obnoviti (refurbish) ta item pred prodajo.

Za vsako možno obnovo določi:
1. Vrsta obnove (čiščenje, popravilo, nadomestitev dela)
2. Strošek (EUR — material + čas)
3. Povečanje vrednosti (EUR — za koliko se dvigne prodajna cena)
4. Net ROI (povečanje - strošek)
5. Težavnost (easy/medium/hard)
6. Čas (ure)

Mogoče obnove (odvisno od kategorije):
- Elektronika: čiščenje, nova baterija, popravljen zaslon, reset, nova zaščitna folija
- Oblačila: pranje, kemična čistilnica, popravilo šiva, odstranjevanje madežev
- Avto: čiščenje notranjosti, poliranje, olje, filtri
- Pohištvo: brusenje, lak, čiščenje, novi nogice
- Orođje: brusenje, mazanje, kalibracija

Pravila:
- Net ROI > 10€ = "se splača"
- Net ROI 0-10€ = "neobvezno"
- Net ROI < 0€ = "se ne splača"

Odgovori LE z JSON:
{
  "current_estimated_value_eur": <number>,
  "refurb_options": [
    {
      "action": "<vrsta obnove>",
      "cost_eur": <number>,
      "value_increase_eur": <number>,
      "net_roi_eur": <number>,
      "difficulty": "<easy|medium|hard>",
      "time_hours": <number>,
      "worth_it": <boolean>,
      "reasoning": "<1 stavek>"
    }
  ],
  "best_combo": {
    "actions": ["<action1>", "<action2>"],
    "total_cost_eur": <number>,
    "total_value_increase_eur": <number>,
    "total_net_roi_eur": <number>,
    "new_estimated_value_eur": <number>,
    "total_time_hours": <number>
  },
  "recommendation": "<1-2 stavki: ali obnavljati ali prodati kakor je>",
  "sell_as_is_vs_refurb": {
    "sell_as_is_price_eur": <number>,
    "sell_after_refurb_price_eur": <number>,
    "refurb_profit_advantage_eur": <number>
  }
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
          analysis: {
            currentValue: estValue,
            refurbOptions: [{
              action: 'Profesionalno čiščenje',
              costEur: 5, valueIncreaseEur: 15, netRoiEur: 10,
              difficulty: 'easy', timeHours: 1, worthIt: true,
              reasoning: 'Čiščenje vedno poveča vrednost za 10-20€.',
            }],
            recommendation: 'AI ni na voljo — priporočam vsaj čiščenje pred prodajo.',
          },
        });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);

    return NextResponse.json({
      ok: true,
      analysis: {
        currentValue: Math.round(Number(parsed?.current_estimated_value_eur ?? estValue)),
        refurbOptions: (parsed?.refurb_options || []).slice(0, 8).map((r: any) => ({
          action: String(r?.action ?? '').slice(0, 100),
          costEur: Math.round(Number(r?.cost_eur ?? 0)),
          valueIncreaseEur: Math.round(Number(r?.value_increase_eur ?? 0)),
          netRoiEur: Math.round(Number(r?.net_roi_eur ?? 0)),
          difficulty: ['easy', 'medium', 'hard'].includes(String(r?.difficulty)) ? String(r.difficulty) : 'easy',
          timeHours: Math.max(0, Number(r?.time_hours ?? 1)),
          worthIt: Boolean(r?.worth_it ?? false),
          reasoning: String(r?.reasoning ?? '').slice(0, 200),
        })),
        bestCombo: parsed?.best_combo ? {
          actions: (parsed.best_combo.actions || []).map((a: any) => String(a).slice(0, 100)),
          totalCostEur: Math.round(Number(parsed.best_combo.total_cost_eur ?? 0)),
          totalValueIncreaseEur: Math.round(Number(parsed.best_combo.total_value_increase_eur ?? 0)),
          totalNetRoiEur: Math.round(Number(parsed.best_combo.total_net_roi_eur ?? 0)),
          newEstimatedValueEur: Math.round(Number(parsed.best_combo.new_estimated_value_eur ?? estValue)),
          totalTimeHours: Number(parsed.best_combo.total_time_hours ?? 0),
        } : null,
        recommendation: String(parsed?.recommendation ?? '').slice(0, 300),
        sellAsIsVsRefurb: parsed?.sell_as_is_vs_refurb ? {
          sellAsIsPriceEur: Math.round(Number(parsed.sell_as_is_vs_refurb.sell_as_is_price_eur ?? estValue)),
          sellAfterRefurbPriceEur: Math.round(Number(parsed.sell_as_is_vs_refurb.sell_after_refurb_price_eur ?? estValue)),
          refurbProfitAdvantageEur: Math.round(Number(parsed.sell_as_is_vs_refurb.refurb_profit_advantage_eur ?? 0)),
        } : null,
      },
    });
  } catch (err: any) {
    logger.error('/api/ai/refurb-roi-calculator', 'POST handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
