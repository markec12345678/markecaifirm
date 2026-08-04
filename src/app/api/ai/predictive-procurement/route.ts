// v6.30 MILESTONE: AI Predictive Procurement System — napove kaj/kdaj/kje kupiti z avtomatizacijo
// POST /api/ai/predictive-procurement
// Body: { budget?: number, riskTolerance?: 'low'|'medium'|'high' }
// Returns: { ok, procurement: { plan: [], budgetAllocation, timeline, automationLevel, expectedOutcomes } }

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
    const riskTolerance = ['low', 'medium', 'high'].includes(String(body?.riskTolerance)) ? String(body.riskTolerance) : 'medium';

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) } },
      select: { category: true, buyPrice: true, sellPrice: true, buyLocation: true, buyDate: true, sellDate: true },
      take: 300,
    });

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { category: true, buyPrice: true },
    });

    const recentListings = await db.listing.findMany({
      where: { isHidden: false, firstSeenAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        OR: [{ aiVerdict: 'PRILIKA' }, { dealScore: { gte: 70 } }] },
      select: { title: true, price: true, dealScore: true, firstSeenAt: true,
        monitor: { select: { source: true, name: true } } },
      take: 50,
      orderBy: { dealScore: 'desc' },
    });

    if (soldTrades.length === 0 && recentListings.length === 0) {
      return NextResponse.json({ ok: true, procurement: null, message: 'Ni podatkov za procurement.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const soldStr = soldTrades.slice(0, 20).map(t => `- ${t.category} | ${t.buyPrice}€ → ${t.sellPrice}€ | ${t.buyLocation}`).join('\n');
    const recentStr = recentListings.slice(0, 15).map(l => `- ${l.title} | ${l.price}€ | deal: ${l.dealScore}/100 | ${l.monitor?.source}`).join('\n');
    const heldCats = heldTrades.reduce((acc, t) => { acc[t.category || 'drugo'] = (acc[t.category || 'drugo'] ?? 0) + 1; return acc; }, {} as Record<string, number>);

    const prompt = `Si AI procurement sistem za avtomatizirano nakupovanje pri preprodaji.
Ustvari celovit nakupovalni načrt (procurement plan) za naslednje 30 dni.

RIZIK TOLERANCA: ${riskTolerance}
${budget > 0 ? `BUDGET: ${budget}€` : 'BUDGET: neomejen'}

ZGODOVINSKE PRODAJE (180d):
${soldStr || '- Ni podatkov'}

TRENUTNE PRILIŽNOSTI (14d, deal score >= 70):
${recentStr || '- Ni novih priložnosti'}

TRENUTNI STOCK: ${JSON.stringify(heldCats)}

Procurement pravila:
1. Prioritiziraj kategorije z dokazanim ROI > 25%
2. Izogibaj se kategorijam z >60d povprečno prodajo (razen če ROI > 50%)
3. Diverzifikacija: max 30% budgeta v eno kategorijo
4. Risk tolerance:
   - low: samo "safe" nakupe (ROI > 20%, known categories)
   - medium: mix safe + speculative
   - high: vključi speculative flips (unknown categories, refurb items)
5. Za vsak nakup: konkreten item, vir, iskalne ključne besede, max cena
6. Avtomatizacija: kaj lahko avtomatiziraš (monitor setup, alert nastavitve)

Odgovori LE z JSON:
{
  "plan": [
    {
      "priority": <number 1-10>,
      "category": "<kategorija>",
      "item_description": "<konkreten item za iskanje, max 100 znakov>",
      "source": "<bolha|vinted|avtonet|mobile-de|kleinanzeigen|subito|willhaben|facebook>",
      "search_keywords": "<ključne besede, max 80 znakov>",
      "max_buy_price_eur": <number>,
      "expected_sell_price_eur": <number>,
      "expected_roi_pct": <number>,
      "expected_days_to_sell": <number>,
      "risk_level": "<low|medium|high>",
      "automation": {
        "monitor_setup": "<kakšen monitor nastaviti, max 100 znakov>",
        "alert_threshold_score": <number 0-100>,
        "max_price_filter_eur": <number>,
        "keywords_filter": "<ključne besede za filter>",
        "auto_alert": <boolean>
      },
      "reasoning": "<max 80 znakov>"
    }
  ],
  "budget_allocation": [
    { "category": "<kat>", "amount_eur": <number>, "pct": <number>, "item_count": <number> }
  ],
  "timeline": [
    { "week": <number>, "action": "<max 100 znakov>", "items_to_buy": <number>, "budget_eur": <number> }
  ],
  "automation_level": "<full|semi|manual>",
  "expected_outcomes": {
    "total_investment_eur": <number>,
    "expected_revenue_eur": <number>,
    "expected_profit_eur": <number>,
    "expected_roi_pct": <number>,
    "expected_avg_days_to_sell": <number>,
    "projected_monthly_profit_eur": <number>
  },
  "insights": "<max 250 znakov>"
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

    const procurement = {
      plan: (parsed?.plan || []).slice(0, 12).map((p: any) => ({
        priority: Math.max(1, Math.min(10, Number(p?.priority ?? 5))),
        category: String(p?.category ?? '').slice(0, 50),
        itemDescription: String(p?.item_description ?? '').slice(0, 200),
        source: String(p?.source ?? 'bolha').slice(0, 30),
        searchKeywords: String(p?.search_keywords ?? '').slice(0, 150),
        maxBuyPriceEur: Math.max(0, Number(p?.max_buy_price_eur ?? 0)),
        expectedSellPriceEur: Math.max(0, Number(p?.expected_sell_price_eur ?? 0)),
        expectedRoiPct: Math.round(Number(p?.expected_roi_pct ?? 0)),
        expectedDaysToSell: Math.max(0, Number(p?.expected_days_to_sell ?? 0)),
        riskLevel: ['low', 'medium', 'high'].includes(String(p?.risk_level)) ? String(p.risk_level) : 'medium',
        automation: {
          monitorSetup: String(p?.automation?.monitor_setup ?? '').slice(0, 200),
          alertThresholdScore: Math.max(0, Math.min(100, Number(p?.automation?.alert_threshold_score ?? 70))),
          maxPriceFilterEur: Math.max(0, Number(p?.automation?.max_price_filter_eur ?? 0)),
          keywordsFilter: String(p?.automation?.keywords_filter ?? '').slice(0, 150),
          autoAlert: Boolean(p?.automation?.auto_alert ?? true),
        },
        reasoning: String(p?.reasoning ?? '').slice(0, 150),
      })),
      budgetAllocation: (parsed?.budget_allocation || []).slice(0, 8).map((a: any) => ({
        category: String(a?.category ?? '').slice(0, 50),
        amountEur: Math.max(0, Number(a?.amount_eur ?? 0)),
        pct: Math.max(0, Math.min(100, Number(a?.pct ?? 0))),
        itemCount: Math.max(0, Number(a?.item_count ?? 0)),
      })),
      timeline: (parsed?.timeline || []).slice(0, 4).map((t: any) => ({
        week: Math.max(1, Number(t?.week ?? 1)),
        action: String(t?.action ?? '').slice(0, 200),
        itemsToBuy: Math.max(0, Number(t?.items_to_buy ?? 0)),
        budgetEur: Math.max(0, Number(t?.budget_eur ?? 0)),
      })),
      automationLevel: ['full', 'semi', 'manual'].includes(String(parsed?.automation_level)) ? String(parsed.automation_level) : 'semi',
      expectedOutcomes: {
        totalInvestmentEur: Math.round(Number(parsed?.expected_outcomes?.total_investment_eur ?? 0)),
        expectedRevenueEur: Math.round(Number(parsed?.expected_outcomes?.expected_revenue_eur ?? 0)),
        expectedProfitEur: Math.round(Number(parsed?.expected_outcomes?.expected_profit_eur ?? 0)),
        expectedRoiPct: Math.round(Number(parsed?.expected_outcomes?.expected_roi_pct ?? 0)),
        expectedAvgDaysToSell: Math.round(Number(parsed?.expected_outcomes?.expected_avg_days_to_sell ?? 0)),
        projectedMonthlyProfitEur: Math.round(Number(parsed?.expected_outcomes?.projected_monthly_profit_eur ?? 0)),
      },
      insights: String(parsed?.insights ?? '').slice(0, 600),
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, procurement, riskTolerance, budget });
  } catch (e: any) {
    logger.error("/api/ai/predictive-procurement", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
