// v6.38: AI Inventory Rotation Engine — optimizira rotacijo inventarja za max cash flow
// POST /api/ai/rotation-engine
// Body: {}
// Returns: { ok, rotation: { currentCycle, items: [], rotationPlan, cashFlowImpact, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    await req.json().catch(() => ({}));

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 50,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null }, sellPrice: { not: null } },
      select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, buyDate: true, sellDate: true },
      take: 300,
    });

    if (heldTrades.length === 0) { return NextResponse.json({ ok: true, rotation: null, message: 'Ni held tradeov za rotation engine.' }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const totalHeldValue = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalRealized = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0), 0);
    const avgDaysToSell = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => { if (t.sellDate && t.buyDate) return s + (t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000); return s; }, 0) / soldTrades.length) : 30;
    const currentTurnover = heldTrades.length > 0 ? soldTrades.length / heldTrades.length : 0;

    const items = heldTrades.map(t => ({
      id: t.id, title: t.title, category: t.category || 'drugo',
      cost: t.buyPrice + (t.buyFees ?? 0), estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)), dealScore: t.listing?.dealScore ?? 0,
    }));

    const itemsStr = items.slice(0, 20).map(i => `- [${i.id}] ${i.title} | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d | deal ${i.dealScore}`).join('\n');

    const prompt = `Si AI inventory rotation engine za optimizacijo obrtnosti inventarja.
Cilj: maksimizirati cash flow z optimalno rotacijo (prodaja + reinvestiranje).

TRENUTNO STANJE:
- Held: ${heldTrades.length} itemov (${Math.round(totalHeldValue)}€)
- Realizirano: ${Math.round(totalRealized)}€
- Povp. dni do prodaje: ${avgDaysToSell}
- Turnover ratio: ${currentTurnover.toFixed(2)}

INVENTAR:
${itemsStr}

Rotation principi:
1. FAST ROTATION: prodaj hitro-prodajne iteme → cash → reinvestiraj v nove
2. SLOW ROTATION: drži počasne iteme, a ne pretirano (opportunity cost)
3. DEAD ROTATION: likvidiraj mrtve iteme → sproščen cash za boljše investicije
4. REPLACEMENT: zamenjaj stalled item z boljšo investicijo
5. ACCELERATION: pospeši prodajo z refresh/popust/bundle
6. STAGNATION_AVOIDANCE: prepreči da item postane stalled

Rotation cikel:
- ACQUIRE (dan 0): kupi item
- LIST (dan 1-3): objavi oglas
- SELL (dan 3-30): aktivna prodaja
- REINVEST (dan 30): cash iz prodaje → novi nakup
- Če ni prodano do dan 30 → ACCELERATE (refresh, popust)
- Če ni prodano do dan 60 → LIQUIDATE (deep discount, bundle, part_out)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current_cycle": {
    "rotation_phase": "<acquire|list|sell|reinvest|accelerate|liquidate>",
    "cycle_efficiency_pct": <number>,
    "cash_locked_eur": <number>,
    "cash_available_eur": <number>,
    "rotation_speed": "<fast|normal|slow|stalled>"
  },
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "rotation_phase": "<acquire|list|sell|reinvest|accelerate|liquidate>",
      "days_in_phase": <number>,
      "rotation_action": "<sell_now|refresh|discount|bundle|hold|liquidate|reinvest_proceeds>",
      "action_detail": "<max 100 znakov>",
      "cash_impact_eur": <number>,
      "rotation_priority": <number 1-10>,
      "reinvestment_target": "<kaj kupiti s tem cash-om, max 80 znakov>",
      "reasoning": "<max 80 znakov>"
    }
  ],
  "rotation_plan": [
    { "week": <number>, "items_to_sell": <number>, "expected_cash_in_eur": <number>, "items_to_buy": <number>, "cash_out_eur": <number>, "net_cash_flow_eur": <number> }
  ],
  "cash_flow_impact": {
    "cash_freed_from_liquidation_eur": <number>,
    "cash_from_fast_sales_eur": <number>,
    "total_cash_available_eur": <number>,
    "reinvestment_budget_eur": <number>,
    "projected_profit_from_reinvestment_eur": <number>
  },
  "summary": {
    "current_rotation_efficiency_pct": <number>,
    "target_rotation_efficiency_pct": <number>,
    "items_to_rotate_now": <number>,
    "items_to_liquidate": <number>,
    "expected_cash_flow_improvement_eur": <number>,
    "projected_monthly_rotation_cycles": <number>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const validIds = new Set(items.map(i => i.id));

    const rotation = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      currentCycle: {
        rotationPhase: ['acquire', 'list', 'sell', 'reinvest', 'accelerate', 'liquidate'].includes(String(parsed?.current_cycle?.rotation_phase)) ? String(parsed.current_cycle.rotation_phase) : 'sell',
        cycleEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.current_cycle?.cycle_efficiency_pct ?? 50))),
        cashLockedEur: Math.round(Number(parsed?.current_cycle?.cash_locked_eur ?? totalHeldValue)),
        cashAvailableEur: Math.round(Number(parsed?.current_cycle?.cash_available_eur ?? 0)),
        rotationSpeed: ['fast', 'normal', 'slow', 'stalled'].includes(String(parsed?.current_cycle?.rotation_speed)) ? String(parsed.current_cycle.rotation_speed) : 'normal',
      },
      items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).map((it: any) => ({
        tradeId: String(it?.id ?? ''), title: String(it?.title ?? '').slice(0, 150),
        rotationPhase: ['acquire', 'list', 'sell', 'reinvest', 'accelerate', 'liquidate'].includes(String(it?.rotation_phase)) ? String(it.rotation_phase) : 'sell',
        daysInPhase: Math.max(0, Number(it?.days_in_phase ?? 0)),
        rotationAction: ['sell_now', 'refresh', 'discount', 'bundle', 'hold', 'liquidate', 'reinvest_proceeds'].includes(String(it?.rotation_action)) ? String(it.rotation_action) : 'hold',
        actionDetail: String(it?.action_detail ?? '').slice(0, 200),
        cashImpactEur: Math.round(Number(it?.cash_impact_eur ?? 0)),
        rotationPriority: Math.max(1, Math.min(10, Number(it?.rotation_priority ?? 5))),
        reinvestmentTarget: String(it?.reinvestment_target ?? '').slice(0, 150),
        reasoning: String(it?.reasoning ?? '').slice(0, 200),
      })),
      rotationPlan: (parsed?.rotation_plan || []).slice(0, 4).map((p: any) => ({
        week: Math.max(1, Number(p?.week ?? 1)), itemsToSell: Math.max(0, Number(p?.items_to_sell ?? 0)),
        expectedCashInEur: Math.round(Number(p?.expected_cash_in_eur ?? 0)),
        itemsToBuy: Math.max(0, Number(p?.items_to_buy ?? 0)), cashOutEur: Math.round(Number(p?.cash_out_eur ?? 0)),
        netCashFlowEur: Math.round(Number(p?.net_cash_flow_eur ?? 0)),
      })),
      cashFlowImpact: {
        cashFreedFromLiquidationEur: Math.round(Number(parsed?.cash_flow_impact?.cash_freed_from_liquidation_eur ?? 0)),
        cashFromFastSalesEur: Math.round(Number(parsed?.cash_flow_impact?.cash_from_fast_sales_eur ?? 0)),
        totalCashAvailableEur: Math.round(Number(parsed?.cash_flow_impact?.total_cash_available_eur ?? 0)),
        reinvestmentBudgetEur: Math.round(Number(parsed?.cash_flow_impact?.reinvestment_budget_eur ?? 0)),
        projectedProfitFromReinvestmentEur: Math.round(Number(parsed?.cash_flow_impact?.projected_profit_from_reinvestment_eur ?? 0)),
      },
      summary: {
        currentRotationEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.summary?.current_rotation_efficiency_pct ?? 50))),
        targetRotationEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.summary?.target_rotation_efficiency_pct ?? 70))),
        itemsToRotateNow: Math.max(0, Number(parsed?.summary?.items_to_rotate_now ?? 0)),
        itemsToLiquidate: Math.max(0, Number(parsed?.summary?.items_to_liquidate ?? 0)),
        expectedCashFlowImprovementEur: Math.round(Number(parsed?.summary?.expected_cash_flow_improvement_eur ?? 0)),
        projectedMonthlyRotationCycles: Math.round(Number(parsed?.summary?.projected_monthly_rotation_cycles ?? 0) * 10) / 10,
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, rotation });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
