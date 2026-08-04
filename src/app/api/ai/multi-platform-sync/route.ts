// v6.42: AI Multi-Platform Sync Engine — sinhronizira oglase čez platforme
// POST /api/ai/multi-platform-sync
// Body: {}
// Returns: { ok, sync: { items: [], platforms, syncPlan, conflicts, optimizations } }

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
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 30,
    });

    if (heldTrades.length === 0) { return NextResponse.json({ ok: true, sync: null, message: 'Ni held tradeov za multi-platform sync.' }); }

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
    }));

    const itemsStr = items.slice(0, 15).map(i => `- [${i.id}] ${i.title} | ${i.category} | est ${i.estValue}€ | ${i.daysHeld}d`).join('\n');

    const prompt = `Si AI multi-platform sync engine. Sinhroniziraj oglase čez platforme za max izpostavljenost.

INVENTAR (${items.length}):
${itemsStr}

Platforme: Bolha, Facebook, Vinted, Avtonet, Kleinanzeigen

Sync strategije:
1. CROSS_POST: isti item na več platformah z različnim opisom/ceno
2. PRICE_SYNC: uskladi cene med platformami (razen kadar testiraš)
3. INVENTORY_SYNC: če prodaš na eni platformi, odstrani z drugih
4. ROTATION_SYNC: rotiraj iteme med platformami vsakih 7d
5. BUNDLE_SYNC: bundle na eni platformi, posamezni na drugi
6. SEASONAL_SYNC: sezonski itemi na ustrezni platformi (smuči → Bolha pozimi)

Sync pravila:
- Bolha: formalen opis, ključne besede, cena po dogovoru možna
- Facebook: emoji, osebni ton, lokacija, cene fiksne
- Vinted: hashtagi, stanje, brand, velikost
- Avtonet: tehnični podatki, letnik, km
- Kleinanzeigen: "Zustand", "Versand", "Abholung"

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "recommended_platforms": ["<bolha|facebook|vinted|avtonet|kleinanzeigen>"],
      "platform_configs": [{"platform": "<ime>", "title_adapted": "<max 80 znakov>", "price_eur": <number>, "description_snippet": "<max 100 znakov>", "posting_frequency_days": <number>}],
      "sync_strategy": "<cross_post|price_sync|rotation_sync|bundle_sync|seasonal_sync>",
      "sync_priority": <number 1-10>,
      "conflict_risk": "<low|medium|high>",
      "reasoning": "<max 80 znakov>"
    }
  ],
  "sync_plan": [
    { "day": "<dan>", "items_to_sync": <number>, "platforms": ["<platforma>"], "action": "<max 80 znakov>" }
  ],
  "conflicts": [
    { "type": "<price_mismatch|double_sale|description_conflict|platform_violation>", "description": "<max 100 znakov>", "resolution": "<max 80 znakov>" }
  ],
  "optimizations": [
    { "optimization": "<max 100 znakov>", "impact": "<high|medium|low>", "expected_reach_increase_pct": <number> }
  ],
  "summary": {
    "total_sync_items": <number>,
    "platforms_utilized": <number>,
    "avg_platforms_per_item": <number>,
    "expected_reach_increase_pct": <number>,
    "sync_efficiency_score": <number 0-100>
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

    const sync = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).map((it: any) => ({
        tradeId: String(it?.id ?? ''), title: String(it?.title ?? '').slice(0, 100),
        recommendedPlatforms: (it?.recommended_platforms || []).slice(0, 5).map((p: any) => String(p).slice(0, 30)),
        platformConfigs: (it?.platform_configs || []).slice(0, 5).map((pc: any) => ({
          platform: String(pc?.platform ?? '').slice(0, 30), titleAdapted: String(pc?.title_adapted ?? '').slice(0, 150),
          priceEur: Math.max(0, Number(pc?.price_eur ?? 0)), descriptionSnippet: String(pc?.description_snippet ?? '').slice(0, 200),
          postingFrequencyDays: Math.max(1, Number(pc?.posting_frequency_days ?? 7)),
        })),
        syncStrategy: ['cross_post', 'price_sync', 'rotation_sync', 'bundle_sync', 'seasonal_sync'].includes(String(it?.sync_strategy)) ? String(it.sync_strategy) : 'cross_post',
        syncPriority: Math.max(1, Math.min(10, Number(it?.sync_priority ?? 5))),
        conflictRisk: ['low', 'medium', 'high'].includes(String(it?.conflict_risk)) ? String(it.conflict_risk) : 'low',
        reasoning: String(it?.reasoning ?? '').slice(0, 200),
      })),
      syncPlan: (parsed?.sync_plan || []).slice(0, 7).map((s: any) => ({
        day: String(s?.day ?? '').slice(0, 30), itemsToSync: Math.max(0, Number(s?.items_to_sync ?? 0)),
        platforms: (s?.platforms || []).slice(0, 5).map((p: any) => String(p).slice(0, 30)),
        action: String(s?.action ?? '').slice(0, 150),
      })),
      conflicts: (parsed?.conflicts || []).slice(0, 6).map((c: any) => ({
        type: String(c?.type ?? '').slice(0, 50), description: String(c?.description ?? '').slice(0, 200),
        resolution: String(c?.resolution ?? '').slice(0, 150),
      })),
      optimizations: (parsed?.optimizations || []).slice(0, 6).map((o: any) => ({
        optimization: String(o?.optimization ?? '').slice(0, 200), impact: ['high', 'medium', 'low'].includes(String(o?.impact)) ? String(o.impact) : 'medium',
        expectedReachIncreasePct: Math.round(Number(o?.expected_reach_increase_pct ?? 0)),
      })),
      summary: {
        totalSyncItems: Math.max(0, Number(parsed?.summary?.total_sync_items ?? 0)),
        platformsUtilized: Math.max(0, Number(parsed?.summary?.platforms_utilized ?? 0)),
        avgPlatformsPerItem: Math.round(Number(parsed?.summary?.avg_platforms_per_item ?? 0) * 10) / 10,
        expectedReachIncreasePct: Math.round(Number(parsed?.summary?.expected_reach_increase_pct ?? 0)),
        syncEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.sync_efficiency_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, sync });
  } catch (e: any) { logger.error("/api/ai/multi-platform-sync", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
