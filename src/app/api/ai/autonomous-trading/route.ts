// v6.40 MILESTONE / v8.94-refactor: AI Autonomous Trading Mode — avtomatski nakup + prodaja z AI odločanjem
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/autonomous-trading
// Body: { mode?: 'paper'|'live', maxBudget?: number, maxTradesPerDay?: number }
// Returns: { ok, autonomous: { mode, config, buyRules, sellRules, safeguards, status, projected, nextActions, summary }, version }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface AutonomousTradingInput {
  mode: 'paper' | 'live';
  maxBudget: number;
  maxTradesPerDay: number;
}

export const POST = withAiRoute<AutonomousTradingInput>({
  endpoint: '/api/ai/autonomous-trading',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const mode: 'paper' | 'live' = ['paper', 'live'].includes(String(body?.mode))
      ? (String(body.mode) as 'paper' | 'live')
      : 'paper';
    return {
      mode,
      maxBudget: Math.max(0, Number(body?.maxBudget) || 1000),
      maxTradesPerDay: Math.max(1, Math.min(20, Number(body?.maxTradesPerDay) || 5)),
    };
  },

  // No validateInput — vsi input-i imajo defaults
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { mode, maxBudget, maxTradesPerDay } = input;

    // 1. Pridobi held + sold trades ter aktivne monitorje
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 50,
    });
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true },
      take: 200,
    });
    const monitors = await db.monitor.findMany({
      where: { isActive: true },
      select: { id: true, name: true, source: true, intervalMinutes: true },
      take: 20,
    });

    // 2. Izračunaj stats iz sold trades
    const { totalRealized, avgRoi } = computeTradeStats(soldTrades);

    // 3. AI klic
    const prompt = buildPrompt({
      mode, maxBudget, maxTradesPerDay,
      heldCount: heldTrades.length, soldCount: soldTrades.length,
      totalRealized, avgRoi, monitorCount: monitors.length,
    });
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    // 4. Transformacija rezultatov
    const autonomous = transformAutonomous(parsed, mode, maxBudget, maxTradesPerDay);

    return apiOk({ ok: true, autonomous, version: 'v6.40.0 MILESTONE' });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface SoldTradeRow {
  category: string | null;
  buyPrice: number;
  sellPrice: number | null;
  buyDate: Date | null;
  sellDate: Date | null;
}

function computeTradeStats(soldTrades: SoldTradeRow[]): { totalRealized: number; avgRoi: number } {
  const totalRealized = soldTrades.reduce(
    (s, t) => s + (t.sellPrice ?? 0) - t.buyPrice,
    0
  );
  const avgRoi = soldTrades.length > 0
    ? Math.round(
        soldTrades.reduce(
          (s, t) => s + (t.buyPrice > 0 ? ((t.sellPrice ?? 0) - t.buyPrice) / t.buyPrice * 100 : 0),
          0
        ) / soldTrades.length
      )
    : 0;
  return { totalRealized, avgRoi };
}

interface PromptParams {
  mode: 'paper' | 'live';
  maxBudget: number;
  maxTradesPerDay: number;
  heldCount: number;
  soldCount: number;
  totalRealized: number;
  avgRoi: number;
  monitorCount: number;
}

function buildPrompt(p: PromptParams): string {
  return `Si AI autonomous trading sistem za avtomatsko preprodajo.
Konfiguriraj avtonomni način, ki samodejno kupuje in prodaja z AI odločanjem.

NAČIN: ${p.mode} (${p.mode === 'paper' ? 'simulacija brez pravih nakupov' : 'pravi nakupi z realnim denarjem'})
MAX BUDGET: ${p.maxBudget}€
MAX TRADES/DAN: ${p.maxTradesPerDay}

TRENUTNO: ${p.heldCount} held, ${p.soldCount} sold, ${Math.round(p.totalRealized)}€ dobička, ${p.avgRoi}% ROI
MONITORJI: ${p.monitorCount} aktivnih

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
  "mode": "${p.mode}",
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
}

function transformAutonomous(
  parsed: any,
  mode: 'paper' | 'live',
  maxBudget: number,
  maxTradesPerDay: number
): any {
  return {
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
}

