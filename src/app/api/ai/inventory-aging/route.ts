// v6.24: AI Inventory Aging Alert System — sledi staranju inventarja in opozarja
// POST /api/ai/inventory-aging
// Body: {}
// Returns: { ok, alerts: [{ tradeId, title, category, daysHeld, agingStage, holdingCost, opportunityCost, action, urgency }], insights, summary }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

// Aging stages (dnevi v skladišču)
const AGING_STAGES = [
  { maxDays: 7, stage: 'fresh', color: 'green', description: 'Svež — optimalno za prodajo' },
  { maxDays: 30, stage: 'normal', color: 'blue', description: 'Normalno — še vedno dober čas' },
  { maxDays: 60, stage: 'aging', color: 'amber', description: 'Stara se — razmisli o akciji' },
  { maxDays: 90, stage: 'stale', color: 'orange', description: 'Zastarel — potrebna akcija' },
  { maxDays: 180, stage: 'critical', color: 'red', description: 'Kritično — močna izguba vrednosti' },
  { maxDays: 365, stage: 'dead', color: 'dark', description: 'Mrtvo skladišče — likvidiraj' },
  { maxDays: 99999, stage: 'zombie', color: 'black', description: 'Zombi — zapiši kot izgubo' },
];

export async function POST(req: NextRequest) {
  try {
    await req.json().catch(() => ({}));

    // 1. Pridobi held trades
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } },
      },
      take: 50,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        alerts: [],
        message: 'Ni held tradeov za analizo staranja.',
      });
    }

    // 2. Pridobi sold trades za izračun povprečnega časa do prodaje per kategorija
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null } },
      select: { category: true, buyDate: true, sellDate: true, buyPrice: true, sellPrice: true },
      take: 200,
    });

    const catAvgDaysToSell: Record<string, number> = {};
    for (const t of soldTrades) {
      const cat = t.category || 'drugo';
      if (!catAvgDaysToSell[cat]) catAvgDaysToSell[cat] = 0;
      if (t.sellDate && t.buyDate) {
        catAvgDaysToSell[cat] += Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      }
    }
    const catCounts: Record<string, number> = {};
    for (const t of soldTrades) {
      const cat = t.category || 'drugo';
      catCounts[cat] = (catCounts[cat] ?? 0) + 1;
    }
    for (const cat of Object.keys(catAvgDaysToSell)) {
      catAvgDaysToSell[cat] = catCounts[cat] > 0 ? Math.round(catAvgDaysToSell[cat] / catCounts[cat]) : 30;
    }

    // 3. Izračunaj aging za vsak item
    const items = heldTrades.map(t => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.2);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      const stage = AGING_STAGES.find(s => daysHeld <= s.maxDays) ?? AGING_STAGES[AGING_STAGES.length - 1];
      const cat = t.category || 'drugo';
      const avgDaysToSell = catAvgDaysToSell[cat] ?? 30;

      // Holding cost: 0.5% na teden od nabavne cene (opportunity cost + storage)
      const holdingCostPerWeek = cost * 0.005;
      const holdingCost = Math.round(holdingCostPerWeek * (daysHeld / 7));

      // Opportunity cost: koliko bi lahko zaslužil z investicijo drugje (5%/leto)
      const opportunityCost = Math.round(cost * 0.05 * (daysHeld / 365));

      // Total cost of holding
      const totalHoldingCost = holdingCost + opportunityCost;

      // Expected profit ob nakupu
      const expectedProfit = estValue - cost;
      // Adjusted profit (ob upoštevanju holding cost)
      const adjustedProfit = expectedProfit - totalHoldingCost;

      // Urgency
      let urgency = 'low';
      if (daysHeld > avgDaysToSell * 2) urgency = 'critical';
      else if (daysHeld > avgDaysToSell * 1.5) urgency = 'high';
      else if (daysHeld > avgDaysToSell) urgency = 'medium';

      return {
        id: t.id,
        title: t.title,
        category: cat,
        cost,
        estValue,
        daysHeld,
        stage: stage.stage,
        stageDescription: stage.description,
        stageColor: stage.color,
        holdingCost,
        opportunityCost,
        totalHoldingCost,
        expectedProfit,
        adjustedProfit,
        avgDaysToSell,
        urgency,
        daysOverdue: Math.max(0, daysHeld - avgDaysToSell),
      };
    });

    // 4. AI analiza in priporočila
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const itemsStr = items.slice(0, 25).map(i =>
      `- [${i.id}] ${i.title} | ${i.category} | ${i.daysHeld}d (povp. ${i.avgDaysToSell}d) | stage: ${i.stage} | nabavna: ${i.cost}€ | est: ${i.estValue}€ | holding cost: ${i.totalHoldingCost}€ | adjusted profit: ${i.adjustedProfit}€ | urgency: ${i.urgency}`
    ).join('\n');

    const prompt = `Si ekspert za upravljanje inventarja in staranja zalog.
Analiziraj staranje inventarja in priporoči konkretne akcije za vsak item.

INVENTAR Z AGING PODATKI:
${itemsStr}

Slovenski kontekst:
- Holding cost: ~0.5%/teden od nabavne cene (storage + opportunity)
- Opportunity cost: 5%/leto (alternativna investicija)
- Povprečni čas do prodaje se razlikuje po kategorijah
- Itemi, ki presežejo 2x povprečni čas, so kritični

Aging strategije:
- "sell_aggressive": močan popust (15-25%) za hitro likvidacijo
- "sell_bundle": bundle z drugim itemom za skupno prodajo
- "sell_auction": dražba na Bolha/Facebook
- "relist": ponovna objava z novimi slikami/opisom
- "refurbish": obnovi in prodaj dražje
- "part_out": razstavi in prodaj kot dele
- "donate": doniraj za davčno olajšavo
- "hold_vintage": obdrži (potencial za rast)
- "write_off": zapiši kot izgubo

Odgovori LE z JSON:
{
  "insights": "<splošne ugotovitve o staranju inventarja, max 250 znakov>",
  "alerts": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "category": "<kategorija>",
      "days_held": <number>,
      "aging_stage": "<fresh|normal|aging|stale|critical|dead|zombie>",
      "holding_cost_eur": <number>,
      "opportunity_cost_eur": <number>,
      "total_holding_cost_eur": <number>,
      "expected_profit_eur": <number>,
      "adjusted_profit_eur": <number>,
      "urgency": "<low|medium|high|critical>",
      "action": "<sell_aggressive|sell_bundle|sell_auction|relist|refurbish|part_out|donate|hold_vintage|write_off>",
      "suggested_discount_pct": <number>,
      "suggested_price_eur": <number>,
      "deadline_days": <number>,
      "reasoning": "<max 120 znakov>"
    }
  ],
  "summary": {
    "total_items": <number>,
    "total_holding_cost_eur": <number>,
    "total_opportunity_cost_eur": <number>,
    "critical_count": <number>,
    "dead_count": <number>,
    "potential_loss_eur": <number>,
    "recommended_action": "<aggressive_liquidation|balanced|patient>"
  }
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
    const validIds = new Set(items.map(i => i.id));
    const itemMap = new Map(items.map(i => [i.id, i]));

    const alerts = (parsed?.alerts || [])
      .filter((a: any) => validIds.has(String(a?.id ?? '')))
      .map((a: any) => {
        const id = String(a.id);
        const orig = itemMap.get(id)!;
        return {
          tradeId: id,
          title: orig.title,
          category: orig.category,
          cost: orig.cost,
          estValue: orig.estValue,
          daysHeld: orig.daysHeld,
          agingStage: ['fresh', 'normal', 'aging', 'stale', 'critical', 'dead', 'zombie'].includes(String(a?.aging_stage))
            ? String(a.aging_stage) : orig.stage,
          stageDescription: orig.stageDescription,
          stageColor: orig.stageColor,
          holdingCostEur: Math.max(0, Number(a?.holding_cost_eur ?? orig.holdingCost)),
          opportunityCostEur: Math.max(0, Number(a?.opportunity_cost_eur ?? orig.opportunityCost)),
          totalHoldingCostEur: Math.max(0, Number(a?.total_holding_cost_eur ?? orig.totalHoldingCost)),
          expectedProfitEur: Math.round(Number(a?.expected_profit_eur ?? orig.expectedProfit)),
          adjustedProfitEur: Math.round(Number(a?.adjusted_profit_eur ?? orig.adjustedProfit)),
          urgency: ['low', 'medium', 'high', 'critical'].includes(String(a?.urgency))
            ? String(a.urgency) : orig.urgency,
          action: ['sell_aggressive', 'sell_bundle', 'sell_auction', 'relist', 'refurbish', 'part_out', 'donate', 'hold_vintage', 'write_off'].includes(String(a?.action))
            ? String(a.action) : 'relist',
          suggestedDiscountPct: Math.max(0, Math.min(50, Number(a?.suggested_discount_pct ?? 0))),
          suggestedPriceEur: Math.max(0, Number(a?.suggested_price_eur ?? orig.estValue)),
          deadlineDays: Math.max(0, Number(a?.deadline_days ?? 7)),
          reasoning: String(a?.reasoning ?? '').slice(0, 250),
        };
      })
      .sort((a, b) => {
        const order = { critical: 0, high: 1, medium: 2, low: 3 };
        return (order[a.urgency as keyof typeof order] ?? 4) - (order[b.urgency as keyof typeof order] ?? 4);
      });

    const summary = {
      totalItems: alerts.length,
      totalHoldingCostEur: alerts.reduce((s, a) => s + a.holdingCostEur, 0),
      totalOpportunityCostEur: alerts.reduce((s, a) => s + a.opportunityCostEur, 0),
      criticalCount: alerts.filter(a => a.urgency === 'critical').length,
      deadCount: alerts.filter(a => a.agingStage === 'dead' || a.agingStage === 'zombie').length,
      potentialLossEur: alerts.filter(a => a.adjustedProfitEur < 0).reduce((s, a) => s + Math.abs(a.adjustedProfitEur), 0),
      recommendedAction: ['aggressive_liquidation', 'balanced', 'patient'].includes(String(parsed?.summary?.recommended_action))
        ? String(parsed.summary.recommended_action) : 'balanced',
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
      insights: String(parsed?.insights ?? '').slice(0, 600),
      alerts,
      summary,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
