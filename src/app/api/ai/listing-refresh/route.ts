// v6.33: AI Predictive Listing Refresh — napove kdaj osvežiti oglase za max izpostavljenost
// POST /api/ai/listing-refresh
// Body: {}
// Returns: { ok, refresh: { items: [], strategy, schedule, expectedImpact } }

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
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, priceDroppedAt: true, firstSeenAt: true } } },
      take: 50,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, refresh: null, message: 'Ni held tradeov za refresh analizo.' });
    }

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null }, sellPrice: { not: null } },
      select: { category: true, buyDate: true, sellDate: true, buyPrice: true, sellPrice: true },
      take: 200,
    });

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
      cost: t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)),
      dealScore: t.listing?.dealScore ?? 0,
      lastPriceDrop: t.listing?.priceDroppedAt ? Math.round((Date.now() - t.listing.priceDroppedAt.getTime()) / (24*60*60*1000)) : null,
    }));

    const itemsStr = items.slice(0, 20).map(i =>
      `- [${i.id}] ${i.title} | ${i.category} | ${i.daysHeld}d | est. ${i.estValue}€ | deal: ${i.dealScore}${i.lastPriceDrop ? ` | zadnji padec: ${i.lastPriceDrop}d` : ''}`
    ).join('\n');

    const prompt = `Si ekspert za optimizacijo oglasov in algoritmično izpostavljenost.
Za vsak held item določi KDAJ in KAKO osvežiti oglas za maksimalno izpostavljenost.

INVENTAR (${items.length}):
${itemsStr}

Algoritmi refresh pravila (Bolha/Vinted/Facebook):
1. Algoritem favorizira SVEŽE oglase (prvih 3-7 dni = največja izpostavljenost)
2. Po 7 dneh izpostavljenost pade 50%, po 14 dneh 80%, po 30 dneh 95%
3. Refresh = nova objava (nov ID) z izboljšanim naslovom/sliko/ceno
4. Vsak refresh mora imeti vsaj eno spremembo (algoritem zazna duplicate)
5. Optimalni refresh cikel: vsakih 5-10 dni za stalled iteme

Refresh strategije:
- "relist_fresh": popolnoma nova objava (nov naslov, slika, opis)
- "price_adjust": znižanje cene 5-10% + nova objava
- "title_swap": sprememba naslova z novimi ključnimi besedami
- "image_refresh": nove slike z drugačnim kotom/osvetlitvijo
- "platform_switch": prestavi na drugo platformo
- "bundle_refresh": objavi kot del bundla
- "hold": ne osvežuj še (še vedno dovolj izpostavljenosti)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "days_held": <number>,
      "current_exposure_pct": <number 0-100>,
      "refresh_strategy": "<relist_fresh|price_adjust|title_swap|image_refresh|platform_switch|bundle_refresh|hold>",
      "refresh_in_days": <number, kdaj osvežiti>,
      "changes_needed": ["<kaj spremeniti, max 80 znakov>", "..."],
      "suggested_title": "<nov naslov, max 100 znakov>",
      "suggested_price_eur": <number>,
      "expected_exposure_boost_pct": <number>,
      "priority": "<high|medium|low>",
      "reasoning": "<max 100 znakov>"
    }
  ],
  "schedule": [
    { "day": "<dan v tednu>", "items_to_refresh": <number>, "platforms": ["<platforma>"], "time_window": "<max 50 znakov>" }
  ],
  "expected_impact": {
    "avg_exposure_increase_pct": <number>,
    "expected_inquiries_increase_pct": <number>,
    "expected_sell_time_reduction_days": <number>,
    "items_needing_immediate_refresh": <number>
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

    const refresh = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).map((it: any) => ({
        tradeId: String(it?.id ?? ''),
        title: String(it?.title ?? '').slice(0, 150),
        daysHeld: Math.max(0, Number(it?.days_held ?? 0)),
        currentExposurePct: Math.max(0, Math.min(100, Number(it?.current_exposure_pct ?? 50))),
        refreshStrategy: ['relist_fresh', 'price_adjust', 'title_swap', 'image_refresh', 'platform_switch', 'bundle_refresh', 'hold'].includes(String(it?.refresh_strategy))
          ? String(it.refresh_strategy) : 'hold',
        refreshInDays: Math.max(0, Number(it?.refresh_in_days ?? 0)),
        changesNeeded: (it?.changes_needed || []).slice(0, 4).map((c: any) => String(c).slice(0, 150)),
        suggestedTitle: String(it?.suggested_title ?? '').slice(0, 200),
        suggestedPriceEur: Math.max(0, Number(it?.suggested_price_eur ?? 0)),
        expectedExposureBoostPct: Math.round(Number(it?.expected_exposure_boost_pct ?? 0)),
        priority: ['high', 'medium', 'low'].includes(String(it?.priority)) ? String(it.priority) : 'medium',
        reasoning: String(it?.reasoning ?? '').slice(0, 200),
      })),
      schedule: (parsed?.schedule || []).slice(0, 7).map((s: any) => ({
        day: String(s?.day ?? '').slice(0, 30),
        itemsToRefresh: Math.max(0, Number(s?.items_to_refresh ?? 0)),
        platforms: (s?.platforms || []).slice(0, 4).map((p: any) => String(p).slice(0, 30)),
        timeWindow: String(s?.time_window ?? '').slice(0, 100),
      })),
      expectedImpact: {
        avgExposureIncreasePct: Math.round(Number(parsed?.expected_impact?.avg_exposure_increase_pct ?? 0)),
        expectedInquiriesIncreasePct: Math.round(Number(parsed?.expected_impact?.expected_inquiries_increase_pct ?? 0)),
        expectedSellTimeReductionDays: Math.round(Number(parsed?.expected_impact?.expected_sell_time_reduction_days ?? 0)),
        itemsNeedingImmediateRefresh: Math.max(0, Number(parsed?.expected_impact?.items_needing_immediate_refresh ?? 0)),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, refresh });
  } catch (e: any) {
    logger.error("/api/ai/listing-refresh", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
