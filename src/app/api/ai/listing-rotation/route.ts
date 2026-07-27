// v6.26: AI Listing Rotation Scheduler — optimizira časovni razpored objav oglasov
// POST /api/ai/listing-rotation
// Body: {}
// Returns: { ok, schedule: [{ tradeId, title, platform, day, hour, frequency, duration, priority }], insights, summary }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const DAYS = ['ponedeljek', 'torek', 'sreda', 'četrtek', 'petek', 'sobota', 'nedelja'];

export async function POST(req: NextRequest) {
  try {
    await req.json().catch(() => ({}));

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 30,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, schedule: [], message: 'Ni held tradeov za razpored.' });
    }

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null } },
      select: { sellDate: true, buyDate: true, sellPrice: true, buyPrice: true, category: true },
      take: 200,
    });

    // Analiza prodaj po dnevih in urah
    const salesByDay: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const salesByHour: Record<number, number> = {};
    for (let i = 0; i < 24; i++) salesByHour[i] = 0;
    for (const t of soldTrades) {
      if (t.sellDate) {
        salesByDay[(t.sellDate.getDay() + 6) % 7]++;
        salesByHour[t.sellDate.getHours()]++;
      }
    }
    const bestDay = Object.entries(salesByDay).sort(([, a], [, b]) => b - a)[0]?.[0] ?? '5';
    const bestHour = Object.entries(salesByHour).sort(([, a], [, b]) => b - a)[0]?.[0] ?? '19';

    const items = heldTrades.map(t => ({
      id: t.id, title: t.title, category: t.category || 'drugo',
      cost: t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000)),
      dealScore: t.listing?.dealScore ?? 0,
    }));

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const itemsStr = items.map(i => `- [${i.id}] ${i.title} | ${i.category} | ${i.daysHeld}d | est. ${i.estValue}€ | deal: ${i.dealScore}`).join('\n');
    const dayStr = DAYS.map((d, i) => `${d}: ${salesByDay[i]}`).join(', ');
    const hourStr = Object.entries(salesByHour).filter(([_, c]) => c > 0).sort(([, a], [, b]) => b - a).slice(0, 5).map(([h, c]) => `${h}:00 (${c})`).join(', ');

    const prompt = `Si ekspert za optimizacijo razporeda objav oglasov.
Za vsak held item ustvari optimalen razpored objav za maksimalno izpostavljenost in prodajo.

INVENTAR (${items.length} itemov):
${itemsStr}

ZGODOVINSKI PODATKI:
- Najboljši dan za prodajo: ${DAYS[Number(bestDay)]}
- Top ure: ${hourStr}
- Prodaje po dnevih: ${dayStr}

Pravila:
1. Razporedi oglase čez teden (ne vsi na isti dan)
2. Vsak item 1-3 platforme hkrati (Bolha, Facebook, Vinted, ...)
3. Čas objave: 18-22h (večerna aktivnost) ali 8-10h (jutranji brskalci)
4. Frekvenca ponovne objave: vsakih 3-7 dni (algoritem favorizira sveže oglase)
5. Stalled itemi (>30d): bolj agresiven razpored (vsak 2. dan)
6. Premium itemi (>500€): vikend objava (več časa za razmislek)

Strategije:
- "staggered": razporedi čez teden (1-2 na dan)
- "concentrated": vsi skupaj v 1-2 dneh (bundle učinek)
- "rolling": nov oglas vsak dan (stalna prisotnost)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "schedule": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "platforms": ["<bolha|facebook|vinted|avtonet>", "..."],
      "primary_day": "<dan>",
      "primary_hour": <number 0-23>,
      "frequency_days": <number, vsakih koliko dni ponovno>,
      "duration_days": <number, koliko dni aktiven>,
      "strategy": "<staggered|concentrated|rolling>",
      "priority": "<high|medium|low>",
      "reasoning": "<max 80 znakov>"
    }
  ],
  "weekly_calendar": [
    {
      "day": "<dan>",
      "slots": [{"hour": <number>, "items": <number>, "platform": "<platforma>"}]
    }
  ],
  "summary": {
    "total_scheduled": <number>,
    "best_day": "<dan>",
    "best_hour": <number>,
    "strategy": "<staggered|concentrated|rolling>",
    "estimated_sell_through_rate_pct": <number>
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

    const schedule = (parsed?.schedule || []).filter((s: any) => validIds.has(String(s?.id ?? ''))).map((s: any) => ({
      tradeId: String(s?.id ?? ''),
      title: String(s?.title ?? '').slice(0, 150),
      platforms: (s?.platforms || []).slice(0, 4).map((p: any) => String(p).slice(0, 20)),
      primaryDay: String(s?.primary_day ?? 'sobota').slice(0, 20),
      primaryHour: Math.max(0, Math.min(23, Number(s?.primary_hour ?? 19))),
      frequencyDays: Math.max(1, Math.min(30, Number(s?.frequency_days ?? 5))),
      durationDays: Math.max(1, Math.min(60, Number(s?.duration_days ?? 14))),
      strategy: ['staggered', 'concentrated', 'rolling'].includes(String(s?.strategy)) ? String(s.strategy) : 'staggered',
      priority: ['high', 'medium', 'low'].includes(String(s?.priority)) ? String(s.priority) : 'medium',
      reasoning: String(s?.reasoning ?? '').slice(0, 200),
    }));

    const weeklyCalendar = (parsed?.weekly_calendar || []).slice(0, 7).map((d: any) => ({
      day: String(d?.day ?? '').slice(0, 20),
      slots: (d?.slots || []).slice(0, 4).map((s: any) => ({
        hour: Math.max(0, Math.min(23, Number(s?.hour ?? 19))),
        items: Math.max(0, Number(s?.items ?? 0)),
        platform: String(s?.platform ?? '').slice(0, 20),
      })),
    }));

    const summary = {
      totalScheduled: schedule.length,
      bestDay: String(parsed?.summary?.best_day ?? '').slice(0, 20),
      bestHour: Math.max(0, Math.min(23, Number(parsed?.summary?.best_hour ?? 19))),
      strategy: ['staggered', 'concentrated', 'rolling'].includes(String(parsed?.summary?.strategy)) ? String(parsed.summary.strategy) : 'staggered',
      estimatedSellThroughRatePct: Math.max(0, Math.min(100, Number(parsed?.summary?.estimated_sell_through_rate_pct ?? 50))),
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      insights: String(parsed?.insights ?? '').slice(0, 500),
      schedule,
      weeklyCalendar,
      summary,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
