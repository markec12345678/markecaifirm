// v6.37: AI Listing Cross-Pollination — povezuje oglase med platformami za sinergično prodajo
// POST /api/ai/cross-pollination
// Body: {}
// Returns: { ok, pollination: { synergies, crossPosts, referralChains, amplification } }

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
        listing: { select: { aiEstimatedValue: true, dealScore: true, url: true } } },
      take: 30,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { category: true, buyLocation: true, sellLocation: true, sellPrice: true, buyPrice: true },
      take: 100,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, pollination: null, message: 'Ni held tradeov za cross-pollination.' });
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
      cost: t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)),
    }));

    const itemsStr = items.slice(0, 15).map(i => `- [${i.id}] ${i.title} | ${i.category} | ${i.estValue}€ | ${i.daysHeld}d`).join('\n');
    const channelStr = Object.entries(soldTrades.reduce((acc, t) => { const s = t.sellLocation || 'neznan'; acc[s] = (acc[s] ?? 0) + 1; return acc; }, {} as Record<string, number>)).sort(([,a],[,b]) => b - a).slice(0, 5).map(([s, c]) => `${s}: ${c}`).join(', ');

    const prompt = `Si AI cross-pollination strategist za sinergično prodajo čez platforme.
Poveži oglase med platformami tako, da si medsebojno povečujejo izpostavljenost in prodajo.

INVENTAR (${items.length}):
${itemsStr}

PRODAJNI KANALI (zgodovina): ${channelStr || 'neznan'}

Cross-pollination koncepti:
1. CROSS_POST: objavi isti item na več platformah (Bolha + Facebook + Vinted)
   - Bolha: ključne besede za iskanje, formalen opis
   - Facebook: emoji, osebni ton, lokacija
   - Vinted: hashtagi, stanje, brand
2. REFERRAL_CHAIN: v opisu enega oglasa omeni druge oglase ("glej tudi...")
   - Npr. pri avto oglasu: "glej tudi zimske gume v mojem profilu"
3. BUNDLE_CROSS_REF: objavi bundle na eni platformi, posamezne na drugi
   - Bundle na Bolha, posamezni na Facebook (različna publika)
4. PROFILE_LINK: v vseh oglasih omeni "več oglasov v mojem profilu"
5. SEASONAL_CROSS: zimski itemi skupaj na eni platformi, poletni na drugi
6. COMPLEMENTARY_CROSS: telefon na Bolha + slušalke na Vinted z medsebojno referenco

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "synergies": [
    {
      "primary_item_id": "<trade_id>",
      "primary_title": "<naslov>",
      "complementary_item_id": "<trade_id>",
      "complementary_title": "<naslov>",
      "synergy_type": "<cross_post|referral_chain|bundle_cross_ref|profile_link|seasonal_cross|complementary_cross>",
      "description": "<kako povezati, max 100 znakov>",
      "platforms": ["<bolha|facebook|vinted>"],
      "expected_exposure_boost_pct": <number>,
      "expected_sell_time_reduction_days": <number>,
      "reasoning": "<max 80 znakov>"
    }
  ],
  "cross_posts": [
    {
      "item_id": "<trade_id>",
      "title": "<naslov>",
      "platforms": [{"platform": "<bolha|facebook|vinted>", "title_adapted": "<max 80 znakov>", "price_eur": <number>, "description_snippet": "<max 100 znakov>"}],
      "expected_reach_increase_pct": <number>
    }
  ],
  "referral_chain": [
    {"from_item": "<naslov>", "to_item": "<naslov>", "referral_text": "<kaj napisati v opisu, max 100 znakov>", "platform": "<kje>"}
  ],
  "amplification": {
    "total_synergies": <number>,
    "total_cross_posts": <number>,
    "total_referrals": <number>,
    "expected_avg_exposure_boost_pct": <number>,
    "expected_sell_time_reduction_days": <number>,
    "items_benefiting": <number>
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

    const pollination = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      synergies: (parsed?.synergies || []).filter((s: any) => validIds.has(String(s?.primary_item_id ?? '')) && validIds.has(String(s?.complementary_item_id ?? ''))).slice(0, 10).map((s: any) => ({
        primaryItemId: String(s?.primary_item_id ?? ''),
        primaryTitle: String(s?.primary_title ?? '').slice(0, 100),
        complementaryItemId: String(s?.complementary_item_id ?? ''),
        complementaryTitle: String(s?.complementary_title ?? '').slice(0, 100),
        synergyType: ['cross_post', 'referral_chain', 'bundle_cross_ref', 'profile_link', 'seasonal_cross', 'complementary_cross'].includes(String(s?.synergy_type)) ? String(s.synergy_type) : 'cross_post',
        description: String(s?.description ?? '').slice(0, 200),
        platforms: (s?.platforms || []).slice(0, 4).map((p: any) => String(p).slice(0, 30)),
        expectedExposureBoostPct: Math.round(Number(s?.expected_exposure_boost_pct ?? 0)),
        expectedSellTimeReductionDays: Math.round(Number(s?.expected_sell_time_reduction_days ?? 0)),
        reasoning: String(s?.reasoning ?? '').slice(0, 200),
      })),
      crossPosts: (parsed?.cross_posts || []).filter((c: any) => validIds.has(String(c?.item_id ?? ''))).slice(0, 10).map((c: any) => ({
        itemId: String(c?.item_id ?? ''),
        title: String(c?.title ?? '').slice(0, 100),
        platforms: (c?.platforms || []).slice(0, 4).map((p: any) => ({
          platform: String(p?.platform ?? '').slice(0, 30),
          titleAdapted: String(p?.title_adapted ?? '').slice(0, 150),
          priceEur: Math.max(0, Number(p?.price_eur ?? 0)),
          descriptionSnippet: String(p?.description_snippet ?? '').slice(0, 200),
        })),
        expectedReachIncreasePct: Math.round(Number(c?.expected_reach_increase_pct ?? 0)),
      })),
      referralChain: (parsed?.referral_chain || []).slice(0, 8).map((r: any) => ({
        fromItem: String(r?.from_item ?? '').slice(0, 100),
        toItem: String(r?.to_item ?? '').slice(0, 100),
        referralText: String(r?.referral_text ?? '').slice(0, 200),
        platform: String(r?.platform ?? '').slice(0, 30),
      })),
      amplification: {
        totalSynergies: Math.max(0, Number(parsed?.amplification?.total_synergies ?? 0)),
        totalCrossPosts: Math.max(0, Number(parsed?.amplification?.total_cross_posts ?? 0)),
        totalReferrals: Math.max(0, Number(parsed?.amplification?.total_referrals ?? 0)),
        expectedAvgExposureBoostPct: Math.round(Number(parsed?.amplification?.expected_avg_exposure_boost_pct ?? 0)),
        expectedSellTimeReductionDays: Math.round(Number(parsed?.amplification?.expected_sell_time_reduction_days ?? 0)),
        itemsBenefiting: Math.max(0, Number(parsed?.amplification?.items_benefiting ?? 0)),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, pollination });
  } catch (e: any) { logger.error("/api/ai/cross-pollination", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
