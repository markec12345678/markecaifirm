// v7.46 / v8.95.8-refactor: Refurbishment ROI Calculator — ali se splača obnoviti item pred prodajo?
//
// "Čiščenje: +15€ vrednosti, nova baterija: +30€, strošek 10€ = net +35€ profit"
// "Popravljen zaslon: +80€ vrednosti, strošek 40€ = net +40€ profit"
//
// POST /api/ai/refurb-roi-calculator
// Body: { tradeId: string }
// Returns: { ok, analysis: { currentValue, refurbOptions, recommendation } }
// Refaktoriran z withAiRoute helperjem (v8.95.8) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface RefurbRoiCalculatorInput {
  tradeId: string;
}

export const POST = withAiRoute<RefurbRoiCalculatorInput>({
  endpoint: '/api/ai/refurb-roi-calculator',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { tradeId: String(body?.tradeId ?? '') };
  },

  validateInput: (input) => (input.tradeId ? null : 'tradeId je obvezen'),

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId } = input;

    const trade = await db.trade.findUnique({
      where: { id: tradeId },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true,
        notes: true, imageUrl: true,
        listing: { select: { aiEstimatedValue: true, description: true, aiImageAnalysis: true, detailDescription: true } },
      },
    });
    if (!trade) throw new ApiRouteError('Trade ne obstaja', 404);

    const totalCost = trade.buyPrice + (trade.buyFees ?? 0);
    const estValue = trade.listing?.aiEstimatedValue ?? Math.round(totalCost * 1.2);
    const description = trade.listing?.detailDescription || trade.listing?.description || trade.notes || '';
    const imageAnalysis = trade.listing?.aiImageAnalysis || '';

    const prompt = buildPrompt({
      title: trade.title,
      category: trade.category || 'splošno',
      totalCost,
      estValue,
      description,
      imageAnalysis,
    });

    let raw: string;
    try {
      raw = await callAi(prompt);
    } catch {
      // Lokalni fallback ko AI (primary + fallback) ni na voljo — IDENTIČNO originalu
      return apiOk({
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

    const parsed: any = parseAi(raw);
    const analysis = transformAnalysis(parsed, estValue);

    return apiOk({ ok: true, analysis });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface PromptData {
  title: string;
  category: string;
  totalCost: number;
  estValue: number;
  description: string;
  imageAnalysis: string;
}

function buildPrompt(d: PromptData): string {
  return `Si ekspert za preprodajo rabljenih dobrin in ocenjevanje vrednosti obnov (refurbishment).

ITEM:
- Naslov: ${d.title}
- Kategorija: ${d.category}
- Nabavna cena: ${d.totalCost}€
- Trenutna ocenjena vrednost: ${d.estValue}€
- Opis: ${d.description.slice(0, 500) || 'Ni opisa'}
${d.imageAnalysis ? `- AI analiza slike: ${d.imageAnalysis}` : ''}

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
}

function transformAnalysis(parsed: any, estValue: number): {
  currentValue: number;
  refurbOptions: any[];
  bestCombo: any | null;
  recommendation: string;
  sellAsIsVsRefurb: any | null;
} {
  return {
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
  };
}
