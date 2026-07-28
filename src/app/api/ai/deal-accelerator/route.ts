// v6.42: AI Deal Velocity Accelerator — pospeši hitrost poslov od odkritja do prodaje
// POST /api/ai/deal-accelerator
// Body: {}
// Returns: { ok, accelerator: { bottlenecks, accelerators, items: [], projectedSpeedup, workflow } }

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
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 40,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null }, sellPrice: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true },
      take: 200,
    });

    if (heldTrades.length === 0 && soldTrades.length === 0) { return NextResponse.json({ ok: true, accelerator: null, message: 'Ni podatkov za deal accelerator.' }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const avgDays = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => { if (t.sellDate && t.buyDate) return s + (t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000); return s; }, 0) / soldTrades.length) : 30;
    const items = heldTrades.map(t => ({ id: t.id, title: t.title, category: t.category || 'drugo', cost: t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25), daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)), dealScore: t.listing?.dealScore ?? 0 }));
    const itemsStr = items.slice(0, 15).map(i => `- [${i.id}] ${i.title} | ${i.category} | ${i.daysHeld}d | est ${i.estValue}€ | deal ${i.dealScore}`).join('\n');

    const prompt = `Si AI deal velocity accelerator. Pospeši hitrost poslov od odkritja do prodaje.

TRENUTNO: povp. ${avgDays}d do prodaje, ${heldTrades.length} held, ${soldTrades.length} sold

INVENTAR:
${itemsStr}

Deal velocity = čas od odkritja priložnosti do realizacije dobička.
Faze: DISCOVERY → EVALUATION → ACQUISITION → LISTING → INTEREST → NEGOTIATION → SALE

Bottleneck analiza (kje izgubljaš čas):
1. DISCOVERY: kako hitro najdeš priložnost? (monitorji, alerti)
2. EVALUATION: kako hitro AI oceni oglas? (AI processing time)
3. ACQUISITION: kako hitro kontaktiraš/kupiš? (response time)
4. LISTING: kako hitro objaviš oglas? (listing generation time)
5. INTEREST: kako hitro dobiš prvo povpraševanje? (exposure time)
6. NEGOTIATION: kako hitro se dogovoriš? (negotiation rounds)
7. SALE: kako hitro se zaključi transakcija? (payment + handover)

Accelerator strategije:
- "instant_alert": real-time SSE alerti za deal score >= 85
- "auto_evaluate": AI takoj oceni nov oglas brez čakanja
- "template_response": predpripravljena sporočila za hiter kontakt
- "auto_listing": AI generira listing takoj po nakupu
- "price_optimization": optimalna cena za hitro prvo povpraševanje
- "quick_close": strategija za hitro zaključitev pogajanja
- "instant_payment": PayPal/Naložba za takojšnjo transakcijo

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "bottlenecks": [
    { "phase": "<discovery|evaluation|acquisition|listing|interest|negotiation|sale>", "current_avg_hours": <number>, "benchmark_hours": <number>, "delay_pct": <number>, "cause": "<max 80 znakov>", "fix": "<max 100 znakov>" }
  ],
  "accelerators": [
    { "name": "<ime>", "phase": "<faza>", "current_time_hours": <number>, "accelerated_time_hours": <number>, "time_saved_hours": <number>, "implementation": "<max 100 znakov>", "difficulty": "<easy|medium|hard>" }
  ],
  "items": [
    { "id": "<trade_id>", "title": "<naslov>", "current_velocity_score": <number 0-100>, "bottleneck_phase": "<faza>", "acceleration_action": "<max 100 znakov>", "expected_time_saved_days": <number>, "priority": "<high|medium|low>" }
  ],
  "projected_speedup": {
    "current_avg_days_to_sell": <number>,
    "projected_avg_days_to_sell": <number>,
    "speedup_pct": <number>,
    "time_saved_per_deal_days": <number>,
    "extra_deals_per_month": <number>,
    "extra_profit_per_month_eur": <number>
  },
  "workflow": [
    { "step": <number>, "action": "<max 100 znakov>", "tool": "<AI modul>", "time_hours": <number>, "accelerated": <boolean> }
  ],
  "summary": {
    "current_velocity_score": <number 0-100>,
    "projected_velocity_score": <number 0-100>,
    "biggest_bottleneck": "<max 80 znakov>",
    "quickest_acceleration": "<max 80 znakov>",
    "expected_monthly_profit_increase_eur": <number>
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

    const accelerator = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      bottlenecks: (parsed?.bottlenecks || []).slice(0, 7).map((b: any) => ({
        phase: String(b?.phase ?? '').slice(0, 30), currentAvgHours: Math.round(Number(b?.current_avg_hours ?? 0)),
        benchmarkHours: Math.round(Number(b?.benchmark_hours ?? 0)), delayPct: Math.round(Number(b?.delay_pct ?? 0)),
        cause: String(b?.cause ?? '').slice(0, 150), fix: String(b?.fix ?? '').slice(0, 200),
      })),
      accelerators: (parsed?.accelerators || []).slice(0, 8).map((a: any) => ({
        name: String(a?.name ?? '').slice(0, 80), phase: String(a?.phase ?? '').slice(0, 30),
        currentTimeHours: Math.round(Number(a?.current_time_hours ?? 0)), acceleratedTimeHours: Math.round(Number(a?.accelerated_time_hours ?? 0)),
        timeSavedHours: Math.round(Number(a?.time_saved_hours ?? 0)), implementation: String(a?.implementation ?? '').slice(0, 200),
        difficulty: ['easy', 'medium', 'hard'].includes(String(a?.difficulty)) ? String(a.difficulty) : 'medium',
      })),
      items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).map((it: any) => ({
        tradeId: String(it?.id ?? ''), title: String(it?.title ?? '').slice(0, 100),
        currentVelocityScore: Math.max(0, Math.min(100, Number(it?.current_velocity_score ?? 50))),
        bottleneckPhase: String(it?.bottleneck_phase ?? '').slice(0, 30),
        accelerationAction: String(it?.acceleration_action ?? '').slice(0, 200),
        expectedTimeSavedDays: Math.round(Number(it?.expected_time_saved_days ?? 0)),
        priority: ['high', 'medium', 'low'].includes(String(it?.priority)) ? String(it.priority) : 'medium',
      })),
      projectedSpeedup: {
        currentAvgDaysToSell: Math.round(Number(parsed?.projected_speedup?.current_avg_days_to_sell ?? avgDays)),
        projectedAvgDaysToSell: Math.round(Number(parsed?.projected_speedup?.projected_avg_days_to_sell ?? avgDays * 0.7)),
        speedupPct: Math.round(Number(parsed?.projected_speedup?.speedup_pct ?? 30)),
        timeSavedPerDealDays: Math.round(Number(parsed?.projected_speedup?.time_saved_per_deal_days ?? 0)),
        extraDealsPerMonth: Math.round(Number(parsed?.projected_speedup?.extra_deals_per_month ?? 0)),
        extraProfitPerMonthEur: Math.round(Number(parsed?.projected_speedup?.extra_profit_per_month_eur ?? 0)),
      },
      workflow: (parsed?.workflow || []).slice(0, 8).map((w: any) => ({
        step: Math.max(1, Number(w?.step ?? 1)), action: String(w?.action ?? '').slice(0, 200),
        tool: String(w?.tool ?? '').slice(0, 80), timeHours: Math.round(Number(w?.time_hours ?? 0)),
        accelerated: Boolean(w?.accelerated ?? false),
      })),
      summary: {
        currentVelocityScore: Math.max(0, Math.min(100, Number(parsed?.summary?.current_velocity_score ?? 50))),
        projectedVelocityScore: Math.max(0, Math.min(100, Number(parsed?.summary?.projected_velocity_score ?? 70))),
        biggestBottleneck: String(parsed?.summary?.biggest_bottleneck ?? '').slice(0, 150),
        quickestAcceleration: String(parsed?.summary?.quickest_acceleration ?? '').slice(0, 150),
        expectedMonthlyProfitIncreaseEur: Math.round(Number(parsed?.summary?.expected_monthly_profit_increase_eur ?? 0)),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, accelerator });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
