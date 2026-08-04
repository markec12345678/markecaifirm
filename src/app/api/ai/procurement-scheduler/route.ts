// v6.39: AI Smart Procurement Scheduler — načrtuje optimalen čas za nakupovanje
// POST /api/ai/procurement-scheduler
// Body: { budget?: number }
// Returns: { ok, schedule: { calendar, items: [], budgetPlan, timing, alerts } }

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
    const budget = Math.max(0, Number(body?.budget) || 0);

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 40,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null }, sellPrice: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true, buyLocation: true },
      take: 300,
    });

    const recentListings = await db.listing.findMany({
      where: { isHidden: false, firstSeenAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        OR: [{ aiVerdict: 'PRILIKA' }, { dealScore: { gte: 70 } }] },
      select: { title: true, price: true, dealScore: true, firstSeenAt: true,
        monitor: { select: { source: true, name: true } } },
      take: 30,
      orderBy: { dealScore: 'desc' },
    });

    if (soldTrades.length === 0 && recentListings.length === 0) {
      return NextResponse.json({ ok: true, schedule: null, message: 'Ni podatkov za procurement scheduling.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // Analiza best buy timing per kategorija
    const catData: Record<string, { count: number; avgRoi: number; avgDays: number }> = {};
    for (const t of soldTrades) {
      const c = t.category || 'drugo';
      if (!catData[c]) catData[c] = { count: 0, avgRoi: 0, avgDays: 0 };
      catData[c].count++;
      catData[c].avgRoi += t.buyPrice > 0 ? (((t.sellPrice ?? 0) - t.buyPrice) / t.buyPrice) * 100 : 0;
      if (t.sellDate && t.buyDate) catData[c].avgDays += Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000));
    }
    for (const c of Object.keys(catData)) { catData[c].avgRoi = Math.round(catData[c].avgRoi / catData[c].count); catData[c].avgDays = Math.round(catData[c].avgDays / catData[c].count); }

    const heldStr = heldTrades.slice(0, 10).map(t => `- ${t.title} | ${t.category} | ${Math.round((Date.now()-t.buyDate.getTime())/(24*60*60*1000))}d`).join('\n');
    const recentStr = recentListings.slice(0, 10).map(l => `- ${l.title} | ${l.price}€ | deal ${l.dealScore}/100 | ${l.monitor?.source}`).join('\n');
    const catStr = Object.entries(catData).sort(([,a],[,b]) => b.avgRoi - a.avgRoi).slice(0, 8).map(([cat, d]) => `- ${cat}: ${d.count} prodaj, ${d.avgRoi}% ROI, ${d.avgDays}d`).join('\n');

    const prompt = `Si AI procurement scheduler za optimalno načrtovanje nakupov.
Določi KDAJ, KAJ in KJE kupovati v naslednjih 30 dneh za max dobiček.

TRENUTNI INVENTAR: ${heldTrades.length} itemov
${heldStr || '- Prazno'}

${budget > 0 ? `BUDGET: ${budget}€` : 'BUDGET: neomejen'}

NEDEAVNE PRILIŽNOSTI (7d):
${recentStr || '- Ni novih'}

KATEGORIJSKI PODATKI:
${catStr || '- Ni podatkov'}

Procurement timing faktorji:
1. SEASONAL: smuči pozimi ceneje, kolesa poleti dražje → kupuj PRED sezono
2. PAYDAY CYCLE: 1. in 15. v mesecu = več oglasov (ljudje prodajajo) → več izbire
3. WEEKEND: sobota/nedelja = več novih oglasov → boljša izbira
4. MONTH_END: konec meseca = "nujna prodaja" oglasi → nižje cene
5. HOLIDAY: pred prazniki = dražje, po praznikih = ceneje (returns)
6. MARKET_CYCLE: veliko podobnih oglasov = buyer's market (ceneje)
7. STOCKOUT: če za kategorijo 0 held → urgentno kupi
8. CASH_FLOW: čakaj na prodavo pred novim nakupom (razen urgentno)

Scheduling strategije:
- "bulk_buy": kupi več naenkrat (nižji shipping, boljša izbira)
- "staggered": razporedi nakupe čez teden (spremljaj nove oglase)
- "opportunistic": čakaj na "deal of the week" (deal score >= 85)
- "just_in_time": kupuj samo ko je stockout nevarnost

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "calendar": [
    {
      "week": <number>,
      "best_buy_days": ["<dan>"],
      "best_buy_time": "<max 50 znakov>",
      "categories_to_buy": [{"category": "<kat>", "reason": "<max 60 znakov>", "urgency": "<high|medium|low>"}],
      "expected_deal_quality": "<high|medium|low>",
      "budget_allocation_eur": <number>
    }
  ],
  "items": [
    {
      "category": "<kat>",
      "item_to_buy": "<max 80 znakov>",
      "source": "<vir>",
      "search_keywords": "<max 80 znakov>",
      "max_buy_price_eur": <number>,
      "expected_sell_price_eur": <number>,
      "expected_roi_pct": <number>,
      "best_time_to_buy": "<kdaj, max 80 znakov>",
      "monitor_setup": {"keywords": "<max 80 znakov>", "alert_threshold": <number>, "interval_minutes": <number>},
      "reasoning": "<max 80 znakov>"
    }
  ],
  "budget_plan": [
    { "week": <number>, "spend_eur": <number>, "expected_return_eur": <number>, "cumulative_spend_eur": <number>, "cumulative_return_eur": <number> }
  ],
  "timing": {
    "best_overall_buy_window": "<max 80 znakov>",
    "avoid_periods": ["<max 60 znakov>", "..."],
    "payday_alerts": [<number>, <number>],
    "seasonal_deadlines": [{"category": "<kat>", "deadline": "<max 50 znakov>", "reason": "<max 60 znakov>"}]
  },
  "alerts": [
    { "type": "<stockout|seasonal|price_drop|opportunity>", "message": "<max 100 znakov>", "action": "<max 80 znakov>", "priority": "<high|medium|low>" }
  ],
  "summary": {
    "total_budget_planned_eur": <number>,
    "total_expected_profit_eur": <number>,
    "avg_expected_roi_pct": <number>,
    "items_planned": <number>,
    "best_week": <number>,
    "procurement_efficiency_score": <number 0-100>
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

    const schedule = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      calendar: (parsed?.calendar || []).slice(0, 4).map((c: any) => ({
        week: Math.max(1, Number(c?.week ?? 1)),
        bestBuyDays: (c?.best_buy_days || []).slice(0, 5).map((d: any) => String(d).slice(0, 20)),
        bestBuyTime: String(c?.best_buy_time ?? '').slice(0, 100),
        categoriesToBuy: (c?.categories_to_buy || []).slice(0, 4).map((cat: any) => ({
          category: String(cat?.category ?? '').slice(0, 50), reason: String(cat?.reason ?? '').slice(0, 100),
          urgency: ['high', 'medium', 'low'].includes(String(cat?.urgency)) ? String(cat.urgency) : 'medium',
        })),
        expectedDealQuality: ['high', 'medium', 'low'].includes(String(c?.expected_deal_quality)) ? String(c.expected_deal_quality) : 'medium',
        budgetAllocationEur: Math.max(0, Number(c?.budget_allocation_eur ?? 0)),
      })),
      items: (parsed?.items || []).slice(0, 12).map((i: any) => ({
        category: String(i?.category ?? '').slice(0, 50), itemToBuy: String(i?.item_to_buy ?? '').slice(0, 150),
        source: String(i?.source ?? '').slice(0, 30), searchKeywords: String(i?.search_keywords ?? '').slice(0, 150),
        maxBuyPriceEur: Math.max(0, Number(i?.max_buy_price_eur ?? 0)), expectedSellPriceEur: Math.max(0, Number(i?.expected_sell_price_eur ?? 0)),
        expectedRoiPct: Math.round(Number(i?.expected_roi_pct ?? 0)), bestTimeToBuy: String(i?.best_time_to_buy ?? '').slice(0, 150),
        monitorSetup: { keywords: String(i?.monitor_setup?.keywords ?? '').slice(0, 150),
          alertThreshold: Math.max(0, Math.min(100, Number(i?.monitor_setup?.alert_threshold ?? 70))),
          intervalMinutes: Math.max(5, Number(i?.monitor_setup?.interval_minutes ?? 30)) },
        reasoning: String(i?.reasoning ?? '').slice(0, 150),
      })),
      budgetPlan: (parsed?.budget_plan || []).slice(0, 4).map((b: any) => ({
        week: Math.max(1, Number(b?.week ?? 1)), spendEur: Math.round(Number(b?.spend_eur ?? 0)),
        expectedReturnEur: Math.round(Number(b?.expected_return_eur ?? 0)),
        cumulativeSpendEur: Math.round(Number(b?.cumulative_spend_eur ?? 0)),
        cumulativeReturnEur: Math.round(Number(b?.cumulative_return_eur ?? 0)),
      })),
      timing: {
        bestOverallBuyWindow: String(parsed?.timing?.best_overall_buy_window ?? '').slice(0, 150),
        avoidPeriods: (parsed?.timing?.avoid_periods || []).slice(0, 4).map((a: any) => String(a).slice(0, 100)),
        paydayAlerts: (parsed?.timing?.payday_alerts || []).slice(0, 4).map((p: any) => Number(p) ?? 0),
        seasonalDeadlines: (parsed?.timing?.seasonal_deadlines || []).slice(0, 4).map((s: any) => ({
          category: String(s?.category ?? '').slice(0, 50), deadline: String(s?.deadline ?? '').slice(0, 80),
          reason: String(s?.reason ?? '').slice(0, 100),
        })),
      },
      alerts: (parsed?.alerts || []).slice(0, 6).map((a: any) => ({
        type: String(a?.type ?? '').slice(0, 50), message: String(a?.message ?? '').slice(0, 200),
        action: String(a?.action ?? '').slice(0, 150), priority: ['high', 'medium', 'low'].includes(String(a?.priority)) ? String(a.priority) : 'medium',
      })),
      summary: {
        totalBudgetPlannedEur: Math.round(Number(parsed?.summary?.total_budget_planned_eur ?? 0)),
        totalExpectedProfitEur: Math.round(Number(parsed?.summary?.total_expected_profit_eur ?? 0)),
        avgExpectedRoiPct: Math.round(Number(parsed?.summary?.avg_expected_roi_pct ?? 0)),
        itemsPlanned: Math.max(0, Number(parsed?.summary?.items_planned ?? 0)),
        bestWeek: Math.max(1, Number(parsed?.summary?.best_week ?? 1)),
        procurementEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.procurement_efficiency_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, schedule, budget });
  } catch (e: any) { logger.error("/api/ai/procurement-scheduler", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
