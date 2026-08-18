/**
 * @deprecated v8.94 — uporabi `/api/ai/profit-maximizer-pro` namesto tega.
 * Ta endpoint bo odstranjen v v9.0. Glej ENDPOINTS_AUDIT.md za migracijski načrt.
 */
// v7.35: Profit Maximizer — optimal sell price for held inventory.
//
// For each held trade, AI calculates:
// - 3 pricing scenarios (fast / balanced / premium)
// - Sell probability per scenario (based on category history)
// - Expected profit (price × probability - holding cost)
// - Recommended price + listing strategy
//
// Body: { tradeId: string } — analyze single held trade
// Returns: { ok, analysis: { scenarios, recommendation, urgency } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';
import { logDeprecatedCall } from '@/lib/deprecated-redirect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

interface PricingScenario {
  strategy: 'fast' | 'balanced' | 'premium';
  priceEur: number;
  sellProbability7d: number;
  sellProbability30d: number;
  expectedProfitEur: number;
  holdingCostEur: number;
  netProfitEur: number;
  reasoning: string;
}

export async function POST(req: NextRequest) {
  logDeprecatedCall('/api/ai/profit-maximizer', req, '/api/ai/profit-maximizer-pro');
  try {
    const body = await req.json().catch(() => ({}));
    const { tradeId } = body;

    if (!tradeId) {
      return NextResponse.json({ error: 'tradeId je obvezen' }, { status: 400 });
    }

    const trade = await db.trade.findUnique({
      where: { id: String(tradeId) },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true,
        buyDate: true, status: true, imageUrl: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, description: true } },
      },
    });

    if (!trade) {
      return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
    }

    if (trade.status !== 'held') {
      return NextResponse.json({ error: 'Trade ni v statusu "held" — ni potrebe po ceni prodaje' }, { status: 400 });
    }

    // Days held
    const daysHeld = Math.floor((Date.now() - new Date(trade.buyDate).getTime()) / 86400000);
    const totalCost = trade.buyPrice + (trade.buyFees ?? 0);

    // Get category history for probability estimation
    const soldInCategory = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        sellDate: { not: null },
        category: trade.category || undefined,
      },
      select: { buyPrice: true, sellPrice: true, buyDate: true, sellDate: true },
      take: 50,
    });

    // AI analysis
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const categoryStats = soldInCategory.length > 0 ? {
      count: soldInCategory.length,
      avgMarkupPct: Math.round((soldInCategory.reduce((s, t) => s + ((t.sellPrice ?? 0) - t.buyPrice) / t.buyPrice, 0) / soldInCategory.length) * 100),
      avgHoldDays: Math.round(soldInCategory.reduce((s, t) => s + (new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / 86400000, 0) / soldInCategory.length),
      priceRange: {
        min: Math.min(...soldInCategory.map(t => t.sellPrice!)),
        max: Math.max(...soldInCategory.map(t => t.sellPrice!)),
      },
    } : null;

    const estValue = trade.listing?.aiEstimatedValue ?? Math.round(trade.buyPrice * 1.25);

    const prompt = `Si ekspert za določanje optimalnih cen za prodajo rabljenih dobrin na slovenskih oglasnih platformah (Bolha, Vinted).

Analiziraj ta held item in določi 3 cenovne strategije:

ITEM:
- Naslov: ${trade.title}
- Kategorija: ${trade.category || 'neznan'}
- Nabavna cena: ${totalCost}€ (vključno s fees)
- AI ocenjena vrednost: ${estValue}€
- Dni v inventarju: ${daysHeld}
- Deal score: ${trade.listing?.dealScore ?? 'N/A'}

${categoryStats ? `ZGODOVINA KATEGORIJE (${categoryStats.count} prodaj):
- Povprečni markup: ${categoryStats.avgMarkupPct}%
- Povprečni hold čas: ${categoryStats.avgHoldDays} dni
- Razpon cen: ${categoryStats.priceRange.min}€ - ${categoryStats.priceRange.max}€
` : 'ZGODOVINA KATEGORIJE: Ni podatkov (prva prodaja v tej kategoriji).'}

CILJ: Maksimiziraj NET profit = (prodajna cena - nabavna cena - holding cost) × verjetnost prodaje

Holding cost = 0.50€/dan (capital cost + depreciation) × dni od nakupa

Tri strategije:
1. FAST: hitra prodaja v 7 dneh (nizka cena, visoka verjetnost)
2. BALANCED: prodaja v 14-21 dneh (srednja cena, srednja verjetnost)
3. PREMIUM: maksimalni profit, prodaja lahko traja 30+ dni (visoka cena, nižja verjetnost)

Za vsako strategijo določi:
- price_eur: predlagana cena (EUR)
- sell_probability_7d: verjetnost prodaje v 7 dneh (0-100%)
- sell_probability_30d: verjetnost prodaje v 30 dneh (0-100%)
- expected_profit_eur: (cena - nabavna - holding) × verjetnost_30d
- reasoning: 1 stavek zakaj ta cena

Nato določi:
- recommended_strategy: katera strategija maksimizira expected profit
- urgency: 'sell_fast' | 'sell_balanced' | 'hold' | 'cut_losses'

Odgovori LE z JSON:
{
  "scenarios": [
    { "strategy": "fast", "price_eur": <number>, "sell_probability_7d": <number>, "sell_probability_30d": <number>, "expected_profit_eur": <number>, "reasoning": "<string>" },
    { "strategy": "balanced", "price_eur": <number>, "sell_probability_7d": <number>, "sell_probability_30d": <number>, "expected_profit_eur": <number>, "reasoning": "<string>" },
    { "strategy": "premium", "price_eur": <number>, "sell_probability_7d": <number>, "sell_probability_30d": <number>, "expected_profit_eur": <number>, "reasoning": "<string>" }
  ],
  "recommended_strategy": "<fast|balanced|premium>",
  "urgency": "<sell_fast|sell_balanced|hold|cut_losses>",
  "summary": "<1-2 stavka povzetek>"
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

    const holdingCostEur = Math.round(0.50 * daysHeld * 100) / 100;

    const scenarios: PricingScenario[] = (parsed?.scenarios || []).map((s: any) => {
      const priceEur = Math.max(1, Math.round(Number(s?.price_eur ?? 0)));
      const sellProb7d = Math.max(0, Math.min(100, Number(s?.sell_probability_7d ?? 50)));
      const sellProb30d = Math.max(0, Math.min(100, Number(s?.sell_probability_30d ?? 70)));
      const expectedProfitEur = Math.round((priceEur - totalCost - holdingCostEur) * (sellProb30d / 100) * 100) / 100;
      const netProfitEur = Math.round((priceEur - totalCost - holdingCostEur) * 100) / 100;

      return {
        strategy: s?.strategy === 'fast' ? 'fast' : s?.strategy === 'premium' ? 'premium' : 'balanced',
        priceEur,
        sellProbability7d: sellProb7d,
        sellProbability30d: sellProb30d,
        expectedProfitEur,
        holdingCostEur,
        netProfitEur,
        reasoning: String(s?.reasoning ?? '').slice(0, 200),
      };
    });

    if (scenarios.length < 3) {
      // Fallback: generate 3 scenarios based on estValue
      const fast = Math.round(estValue * 0.85);
      const balanced = Math.round(estValue * 1.00);
      const premium = Math.round(estValue * 1.15);
      scenarios.splice(0, scenarios.length);
      for (const [strat, price] of [['fast', fast], ['balanced', balanced], ['premium', premium]] as const) {
        const prob30 = strat === 'fast' ? 90 : strat === 'balanced' ? 65 : 35;
        scenarios.push({
          strategy: strat,
          priceEur: price,
          sellProbability7d: strat === 'fast' ? 70 : strat === 'balanced' ? 30 : 10,
          sellProbability30d: prob30,
          expectedProfitEur: Math.round((price - totalCost - holdingCostEur) * (prob30 / 100) * 100) / 100,
          holdingCostEur,
          netProfitEur: Math.round((price - totalCost - holdingCostEur) * 100) / 100,
          reasoning: `${strat === 'fast' ? 'Hitra prodaja' : strat === 'balanced' ? 'Balansirano' : 'Premium cena'} — ${price}€`,
        });
      }
    }

    const recommendedStrategy = ['fast', 'balanced', 'premium'].includes(String(parsed?.recommended_strategy))
      ? String(parsed.recommended_strategy) : 'balanced';
    const urgency = ['sell_fast', 'sell_balanced', 'hold', 'cut_losses'].includes(String(parsed?.urgency))
      ? String(parsed.urgency) : 'sell_balanced';

    return NextResponse.json({
      ok: true,
      analysis: {
        trade: {
          id: trade.id,
          title: trade.title,
          category: trade.category,
          buyPrice: trade.buyPrice,
          totalCost,
          daysHeld,
          holdingCostEur,
          estValue,
        },
        scenarios,
        recommendedStrategy,
        urgency,
        summary: String(parsed?.summary ?? '').slice(0, 300),
      },
    });
  } catch (err: any) {
    logger.error('/api/ai/profit-maximizer', 'POST handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
