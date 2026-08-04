// v6.34: AI Inventory Lifecycle Manager — upravlja celoten življenjski cikel inventarja
// POST /api/ai/inventory-lifecycle
// Body: {}
// Returns: { ok, lifecycle: { stages, transitions, items: [], timeline, actions } }

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
    await req.json().catch(() => ({}));

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true } } },
      take: 50,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null }, sellPrice: { not: null } },
      select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true,
        buyDate: true, sellDate: true },
      take: 300,
    });

    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return NextResponse.json({ ok: true, lifecycle: null, message: 'Ni podatkov za lifecycle analizo.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const items = heldTrades.map(t => ({
      id: t.id, title: t.title, category: t.category || 'drugo',
      cost: t.buyPrice + (t.buyFees ?? 0),
      estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)),
      dealScore: t.listing?.dealScore ?? 0, aiRisk: t.listing?.aiRisk ?? 5,
    }));

    const totalProfit = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0), 0);
    const avgDays = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => {
      if (t.sellDate && t.buyDate) return s + (t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000);
      return s;
    }, 0) / soldTrades.length) : 30;

    const itemsStr = items.slice(0, 20).map(i =>
      `- [${i.id}] ${i.title} | ${i.category} | ${i.daysHeld}d | ${i.cost}€→${i.estValue}€ | deal: ${i.dealScore} | risk: ${i.aiRisk}`
    ).join('\n');

    const prompt = `Si ekspert za upravljanje življenjskega cikla inventarja (inventory lifecycle).
Za vsak held item določi v kateri fazi lifecycle je in kaj storiti.

INVENTAR (${items.length}):
${itemsStr}

ZGODOVINA: ${soldTrades.length} prodaj, ${Math.round(totalProfit)}€ dobička, povp. ${avgDays}d prodaja.

Lifecycle faze:
1. ACQUISITION (dan 0-3): sveže kupljeno, visoka vrednost, še ne za prodajo
2. LISTING (dan 3-7): objavi oglas, max izpostavljenost
3. ACTIVE (dan 7-21): aktivna prodaja, monitoring povpraševanja
4. STALE (dan 21-45): padec izpostavljenosti, potreben refresh
5. STALLED (dan 45-90): nizko povpraševanje, agresivna akcija
6. DEAD (dan 90-180): kritično, likvidacija potrebna
7. WRITE_OFF (dan 180+): zapiši izgubo, doniraj ali razstavi

Transitions (kdaj preiti v naslednjo fazo):
- Optimalni čas v LISTING fazi: 7 dni
- Optimalni čas v ACTIVE fazi: 14 dni
- STALE → refresh ali price drop
- STALLED → bundle, auction, ali deep discount
- DEAD → likvidacija (part_out, donate, write_off)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "current_stage": "<acquisition|listing|active|stale|stalled|dead|write_off>",
      "days_in_stage": <number>,
      "optimal_days_in_stage": <number>,
      "next_stage": "<naslednja faza>",
      "transition_trigger": "<kdaj preči, max 80 znakov>",
      "action_now": "<kaj storiti zdaj, max 100 znakov>",
      "value_retention_pct": <number 0-100>,
      "recommended_price_eur": <number>,
      "urgency": "<high|medium|low>",
      "reasoning": "<max 100 znakov>"
    }
  ],
  "stage_distribution": [
    { "stage": "<faza>", "count": <number>, "total_value_eur": <number>, "avg_days": <number> }
  ],
  "lifecycle_timeline": [
    { "day_range": "<max 30 znakov>", "stage": "<faza>", "action": "<max 80 znakov>", "success_probability_pct": <number> }
  ],
  "actions": [
    { "action": "<max 100 znakov>", "priority": "<critical|high|medium|low>", "items_affected": <number>, "expected_value_recovery_eur": <number> }
  ],
  "summary": {
    "healthy_items": <number>,
    "at_risk_items": <number>,
    "critical_items": <number>,
    "total_value_at_risk_eur": <number>,
    "avg_lifecycle_efficiency_pct": <number>
  }
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const validIds = new Set(items.map(i => i.id));

    const lifecycle = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).map((it: any) => ({
        tradeId: String(it?.id ?? ''),
        title: String(it?.title ?? '').slice(0, 150),
        currentStage: ['acquisition', 'listing', 'active', 'stale', 'stalled', 'dead', 'write_off'].includes(String(it?.current_stage))
          ? String(it.current_stage) : 'active',
        daysInStage: Math.max(0, Number(it?.days_in_stage ?? 0)),
        optimalDaysInStage: Math.max(0, Number(it?.optimal_days_in_stage ?? 7)),
        nextStage: String(it?.next_stage ?? '').slice(0, 30),
        transitionTrigger: String(it?.transition_trigger ?? '').slice(0, 150),
        actionNow: String(it?.action_now ?? '').slice(0, 200),
        valueRetentionPct: Math.max(0, Math.min(100, Number(it?.value_retention_pct ?? 80))),
        recommendedPriceEur: Math.max(0, Number(it?.recommended_price_eur ?? 0)),
        urgency: ['high', 'medium', 'low'].includes(String(it?.urgency)) ? String(it.urgency) : 'medium',
        reasoning: String(it?.reasoning ?? '').slice(0, 200),
      })),
      stageDistribution: (parsed?.stage_distribution || []).slice(0, 7).map((s: any) => ({
        stage: String(s?.stage ?? '').slice(0, 30),
        count: Math.max(0, Number(s?.count ?? 0)),
        totalValueEur: Math.round(Number(s?.total_value_eur ?? 0)),
        avgDays: Math.max(0, Number(s?.avg_days ?? 0)),
      })),
      lifecycleTimeline: (parsed?.lifecycle_timeline || []).slice(0, 8).map((t: any) => ({
        dayRange: String(t?.day_range ?? '').slice(0, 50),
        stage: String(t?.stage ?? '').slice(0, 30),
        action: String(t?.action ?? '').slice(0, 150),
        successProbabilityPct: Math.max(0, Math.min(100, Number(t?.success_probability_pct ?? 50))),
      })),
      actions: (parsed?.actions || []).slice(0, 6).map((a: any) => ({
        action: String(a?.action ?? '').slice(0, 200),
        priority: ['critical', 'high', 'medium', 'low'].includes(String(a?.priority)) ? String(a.priority) : 'medium',
        itemsAffected: Math.max(0, Number(a?.items_affected ?? 0)),
        expectedValueRecoveryEur: Math.round(Number(a?.expected_value_recovery_eur ?? 0)),
      })),
      summary: {
        healthyItems: Math.max(0, Number(parsed?.summary?.healthy_items ?? 0)),
        atRiskItems: Math.max(0, Number(parsed?.summary?.at_risk_items ?? 0)),
        criticalItems: Math.max(0, Number(parsed?.summary?.critical_items ?? 0)),
        totalValueAtRiskEur: Math.round(Number(parsed?.summary?.total_value_at_risk_eur ?? 0)),
        avgLifecycleEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_lifecycle_efficiency_pct ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, lifecycle });
  } catch (e: any) {
    logger.error("/api/ai/inventory-lifecycle", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
