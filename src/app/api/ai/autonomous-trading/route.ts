// v6.40 MILESTONE: AI Autonomous Trading Mode — avtomatski nakup + prodaja z AI odločanjem
// POST /api/ai/autonomous-trading
// Body: { mode?: 'paper'|'live', maxBudget?: number, maxTradesPerDay?: number }
// Returns: { ok, autonomous: { mode, config, buyRules, sellRules, safeguards, status, projected } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const mode = ['paper', 'live'].includes(String(body?.mode)) ? String(body.mode) : 'paper';
    const maxBudget = Math.max(0, Number(body?.maxBudget) || 1000);
    const maxTradesPerDay = Math.max(1, Math.min(20, Number(body?.maxTradesPerDay) || 5));

    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true } } }, take: 50 });
    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } }, select: { category: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true }, take: 200 });
    const monitors = await db.monitor.findMany({ where: { isActive: true }, select: { id: true, name: true, source: true, intervalMinutes: true }, take: 20 });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const totalRealized = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - t.buyPrice, 0);
    const avgRoi = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => s + (t.buyPrice > 0 ? ((t.sellPrice ?? 0) - t.buyPrice) / t.buyPrice * 100 : 0), 0) / soldTrades.length) : 0;

    const prompt = `Si AI autonomous trading sistem za avtomatsko preprodajo.
Konfiguriraj avtonomni način, ki samodejno kupuje in prodaja z AI odločanjem.

NAČIN: ${mode} (${mode === 'paper' ? 'simulacija brez pravih nakupov' : 'pravi nakupi z realnim denarjem'})
MAX BUDGET: ${maxBudget}€
MAX TRADES/DAN: ${maxTradesPerDay}

TRENUTNO: ${heldTrades.length} held, ${soldTrades.length} sold, ${Math.round(totalRealized)}€ dobička, ${avgRoi}% ROI
MONITORJI: ${monitors.length} aktivnih

Autonomous trading pravila:

BUY RULES (kdaj AI samodejno kupi):
1. Deal score >= 80 AND AI verdict = PRILIKA AND AI risk <= 3
2. Est. value >= 1.3x nabavna cena (30%+ potencialni dobiček)
3. Cena <= 10% budgeta (ne preveč v en item)
4. Kategorija z dokazanim ROI > 20%
5. Manj kot maxTradesPerDay trades že danes
6. Cash available >= buy price + 20% reserve

SELL RULES (kdaj AI samodejno prodaja):
1. Held > 30d AND profit > 0 → prodaj po est. value
2. Held > 60d → prodaj s 10% popustom
3. Held > 90d → prodaj s 20% popustom (likvidacija)
4. Deal score se je poslabšal → prodaj hitro
5. Konkurenca podrla cene za > 15% → prodaj pred padcem
6. Sezonski vrh → prodaj premium

SAFEGUARDS (varnostni ventili):
1. Max 1 nakup na uro (prepreči impulzivne nakupe)
2. Max 20% budgeta v eno kategorijo (diverzifikacija)
3. Dnevni loss limit: če 3 zaporedne izgube → pavza 24h
4. Weekly loss limit: če -10% tedensko → pavza 7d
5. Human override: vedno možen "kill switch"
6. Paper mode: vse transakcije simulated (brez realnega denarja)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "mode": "${mode}",
  "config": {
    "max_budget_eur": <number>,
    "max_trades_per_day": <number>,
    "max_buy_price_eur": <number>,
    "reserve_pct": <number>,
    "kill_switch_enabled": <boolean>,
    "paper_mode": <boolean>
  },
  "buy_rules": [
    { "rule": "<max 100 znakov>", "condition": "<max 80 znakov>", "threshold": "<max 50 znakov>", "enabled": <boolean> }
  ],
  "sell_rules": [
    { "rule": "<max 100 znakov>", "condition": "<max 80 znakov>", "threshold": "<max 50 znakov>", "enabled": <boolean> }
  ],
  "safeguards": [
    { "name": "<max 60 znakov>", "trigger": "<max 80 znakov>", "action": "<max 80 znakov>", "cooldown_hours": <number> }
  ],
  "status": {
    "current_mode": "<paper|live>",
    "trades_today": <number>,
    "trades_this_week": <number>,
    "profit_today_eur": <number>,
    "profit_this_week_eur": <number>,
    "consecutive_losses": <number>,
    "is_paused": <boolean>,
    "pause_reason": "<max 80 znakov | null>"
  },
  "projected": {
    "expected_monthly_trades": <number>,
    "expected_monthly_profit_eur": <number>,
    "expected_monthly_roi_pct": <number>,
    "expected_time_saved_hours": <number>,
    "success_probability_pct": <number>
  },
  "next_actions": [
    { "action": "<max 100 znakov>", "type": "<buy|sell|monitor|wait>", "priority": "<high|medium|low>", "auto_execute": <boolean> }
  ],
  "summary": {
    "autonomous_readiness_score": <number 0-100>,
    "recommended_mode": "<paper|live>",
    "biggest_risk": "<max 80 znakov>",
    "expected_monthly_profit_if_live_eur": <number>,
    "confidence_pct": <number>
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

    const autonomous = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      mode,
      config: {
        maxBudgetEur: Math.max(0, Number(parsed?.config?.max_budget_eur ?? maxBudget)),
        maxTradesPerDay: Math.max(1, Number(parsed?.config?.max_trades_per_day ?? maxTradesPerDay)),
        maxBuyPriceEur: Math.max(0, Number(parsed?.config?.max_buy_price_eur ?? Math.round(maxBudget * 0.1))),
        reservePct: Math.max(0, Math.min(100, Number(parsed?.config?.reserve_pct ?? 20))),
        killSwitchEnabled: Boolean(parsed?.config?.kill_switch_enabled ?? true),
        paperMode: mode === 'paper',
      },
      buyRules: (parsed?.buy_rules || []).slice(0, 8).map((r: any) => ({
        rule: String(r?.rule ?? '').slice(0, 200), condition: String(r?.condition ?? '').slice(0, 150),
        threshold: String(r?.threshold ?? '').slice(0, 100), enabled: Boolean(r?.enabled ?? true),
      })),
      sellRules: (parsed?.sell_rules || []).slice(0, 8).map((r: any) => ({
        rule: String(r?.rule ?? '').slice(0, 200), condition: String(r?.condition ?? '').slice(0, 150),
        threshold: String(r?.threshold ?? '').slice(0, 100), enabled: Boolean(r?.enabled ?? true),
      })),
      safeguards: (parsed?.safeguards || []).slice(0, 8).map((s: any) => ({
        name: String(s?.name ?? '').slice(0, 100), trigger: String(s?.trigger ?? '').slice(0, 150),
        action: String(s?.action ?? '').slice(0, 150), cooldownHours: Math.max(0, Number(s?.cooldown_hours ?? 0)),
      })),
      status: {
        currentMode: mode,
        tradesToday: Math.max(0, Number(parsed?.status?.trades_today ?? 0)),
        tradesThisWeek: Math.max(0, Number(parsed?.status?.trades_this_week ?? 0)),
        profitTodayEur: Math.round(Number(parsed?.status?.profit_today_eur ?? 0)),
        profitThisWeekEur: Math.round(Number(parsed?.status?.profit_this_week_eur ?? 0)),
        consecutiveLosses: Math.max(0, Number(parsed?.status?.consecutive_losses ?? 0)),
        isPaused: Boolean(parsed?.status?.is_paused ?? false),
        pauseReason: parsed?.status?.pause_reason ? String(parsed.status.pause_reason).slice(0, 150) : null,
      },
      projected: {
        expectedMonthlyTrades: Math.max(0, Number(parsed?.projected?.expected_monthly_trades ?? 0)),
        expectedMonthlyProfitEur: Math.round(Number(parsed?.projected?.expected_monthly_profit_eur ?? 0)),
        expectedMonthlyRoiPct: Math.round(Number(parsed?.projected?.expected_monthly_roi_pct ?? 0)),
        expectedTimeSavedHours: Math.round(Number(parsed?.projected?.expected_time_saved_hours ?? 0)),
        successProbabilityPct: Math.max(0, Math.min(100, Number(parsed?.projected?.success_probability_pct ?? 50))),
      },
      nextActions: (parsed?.next_actions || []).slice(0, 6).map((a: any) => ({
        action: String(a?.action ?? '').slice(0, 200),
        type: ['buy', 'sell', 'monitor', 'wait'].includes(String(a?.type)) ? String(a.type) : 'wait',
        priority: ['high', 'medium', 'low'].includes(String(a?.priority)) ? String(a.priority) : 'medium',
        autoExecuteEligible: Boolean(a?.auto_execute ?? false),
        requiresHumanApproval: true,
      })),
      summary: {
        autonomousReadinessScore: Math.max(0, Math.min(100, Number(parsed?.summary?.autonomous_readiness_score ?? 50))),
        recommendedMode: ['paper', 'live'].includes(String(parsed?.summary?.recommended_mode)) ? String(parsed.summary.recommended_mode) : 'paper',
        biggestRisk: String(parsed?.summary?.biggest_risk ?? '').slice(0, 150),
        expectedMonthlyProfitIfLiveEur: Math.round(Number(parsed?.summary?.expected_monthly_profit_if_live_eur ?? 0)),
        confidencePct: Math.max(0, Math.min(100, Number(parsed?.summary?.confidence_pct ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, autonomous, version: 'v6.40.0 MILESTONE' });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
