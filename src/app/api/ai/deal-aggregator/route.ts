// v6.44: AI Multi-Source Deal Aggregator — agregira najboljše priložnosti iz vseh virov
// POST /api/ai/deal-aggregator
// Body: { minDealScore?: number, maxPrice?: number, category?: string }
// Returns: { ok, aggregator: { deals: [], bySource, topPicks, trending, summary } }

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
    const minDealScore = Math.max(0, Math.min(100, Number(body?.minDealScore) || 60));
    const maxPrice = Number(body?.maxPrice) || 0;
    const categoryFilter = String(body?.category || '').trim();

    const recentListings = await db.listing.findMany({
      where: {
        isHidden: false,
        firstSeenAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        dealScore: { gte: minDealScore },
        ...(maxPrice > 0 ? { price: { lte: maxPrice } } : {}),
      },
      select: { id: true, title: true, price: true, aiVerdict: true, aiScore: true, aiRisk: true,
        dealScore: true, dealScoreReason: true, aiEstimatedValue: true, firstSeenAt: true, location: true,
        monitor: { select: { source: true, name: true } } },
      take: 200,
      orderBy: { dealScore: 'desc' },
    });

    if (recentListings.length === 0) { return NextResponse.json({ ok: true, aggregator: null, message: 'Ni priložnosti z deal score >= ' + minDealScore }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // Group by source
    const bySource: Record<string, any[]> = {};
    for (const l of recentListings) { const s = l.monitor?.source || 'neznan'; if (!bySource[s]) bySource[s] = []; bySource[s].push(l); }

    const dealsStr = recentListings.slice(0, 30).map(l => {
      const discount = l.aiEstimatedValue && l.price ? Math.round(((l.aiEstimatedValue - l.price) / l.aiEstimatedValue) * 100) : 0;
      return `- [${l.id}] ${l.title} | ${l.monitor?.source} | ${l.price}€ (est ${l.aiEstimatedValue ?? '?'}€, -${discount}%) | deal ${l.dealScore}/100 | risk ${l.aiRisk ?? '?'}/10 | ${l.location}`;
    }).join('\n');

    const sourceStr = Object.entries(bySource).map(([src, items]) => `- ${src}: ${items.length} priložnosti, povp. deal ${Math.round(items.reduce((s, i) => s + (i.dealScore ?? 0), 0) / items.length)}`).join('\n');

    const prompt = `Si AI multi-source deal aggregator. Agregiraj in rangiraj najboljše priložnosti iz vseh virov.

SKUPno: ${recentListings.length} priložnosti (deal score >= ${minDealScore})

PODATKI PO VIRIH:
${sourceStr}

TOP 30 PRILIŽNOSTI:
${dealsStr}

Agregacijska pravila:
1. RANGIRAJ po: deal score, discount %, AI risk (inverzno), est. profit
2. FILTRIRAJ: AI risk <= 5, verdict = PRILIKA
3. GRUPIRAJ po kategorijah za diverzifikacijo
4. IDENTIFICIRAJ "deal of the day" (najvišji deal score)
5. TRENDING: kategorije z več priložnostmi = trend

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "deals": [
    {
      "id": "<listing_id>",
      "title": "<naslov>",
      "source": "<vir>",
      "price_eur": <number>,
      "est_value_eur": <number>,
      "discount_pct": <number>,
      "deal_score": <number>,
      "ai_risk": <number>,
      "ai_verdict": "<string>",
      "location": "<string>",
      "potential_profit_eur": <number>,
      "potential_roi_pct": <number>,
      "rank": <number>,
      "category": "<max 50 znakov>",
      "deal_of_day": <boolean>,
      "reasoning": "<max 80 znakov>"
    }
  ],
  "by_source": [
    { "source": "<vir>", "count": <number>, "avg_deal_score": <number>, "avg_discount_pct": <number>, "best_deal_title": "<max 80 znakov>", "opportunity_rate": "<high|medium|low>" }
  ],
  "top_picks": [
    { "rank": <number>, "title": "<naslov>", "source": "<vir>", "price_eur": <number>, "potential_profit_eur": <number>, "why": "<max 80 znakov>", "urgency": "<high|medium|low>" }
  ],
  "trending": [
    { "category": "<kat>", "listing_count": <number>, "avg_deal_score": <number>, "trend": "<rising|stable|falling>", "action": "<buy_more|monitor|avoid>" }
  ],
  "summary": {
    "total_deals": <number>,
    "deal_of_day": "<naslov>",
    "best_source": "<vir>",
    "avg_deal_score": <number>,
    "avg_discount_pct": <number>,
    "total_potential_profit_eur": <number>,
    "aggregator_efficiency_score": <number 0-100>
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
    const validIds = new Set(recentListings.map(l => l.id));

    const aggregator = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      deals: (parsed?.deals || []).filter((d: any) => validIds.has(String(d?.id ?? ''))).slice(0, 30).map((d: any) => ({
        id: String(d?.id ?? ''), title: String(d?.title ?? '').slice(0, 150),
        source: String(d?.source ?? '').slice(0, 30), priceEur: Math.max(0, Number(d?.price_eur ?? 0)),
        estValueEur: Math.max(0, Number(d?.est_value_eur ?? 0)), discountPct: Math.round(Number(d?.discount_pct ?? 0)),
        dealScore: Math.max(0, Math.min(100, Number(d?.deal_score ?? 0))), aiRisk: Math.max(0, Number(d?.ai_risk ?? 5)),
        aiVerdict: String(d?.ai_verdict ?? '').slice(0, 20), location: String(d?.location ?? '').slice(0, 50),
        potentialProfitEur: Math.round(Number(d?.potential_profit_eur ?? 0)), potentialRoiPct: Math.round(Number(d?.potential_roi_pct ?? 0)),
        rank: Math.max(1, Number(d?.rank ?? 1)), category: String(d?.category ?? '').slice(0, 50),
        dealOfDay: Boolean(d?.deal_of_day ?? false), reasoning: String(d?.reasoning ?? '').slice(0, 150),
      })),
      bySource: (parsed?.by_source || []).slice(0, 10).map((s: any) => ({
        source: String(s?.source ?? '').slice(0, 50), count: Math.max(0, Number(s?.count ?? 0)),
        avgDealScore: Math.round(Number(s?.avg_deal_score ?? 0)), avgDiscountPct: Math.round(Number(s?.avg_discount_pct ?? 0)),
        bestDealTitle: String(s?.best_deal_title ?? '').slice(0, 100),
        opportunityRate: ['high', 'medium', 'low'].includes(String(s?.opportunity_rate)) ? String(s.opportunity_rate) : 'medium',
      })),
      topPicks: (parsed?.top_picks || []).slice(0, 10).map((p: any) => ({
        rank: Math.max(1, Number(p?.rank ?? 1)), title: String(p?.title ?? '').slice(0, 100),
        source: String(p?.source ?? '').slice(0, 30), priceEur: Math.max(0, Number(p?.price_eur ?? 0)),
        potentialProfitEur: Math.round(Number(p?.potential_profit_eur ?? 0)),
        why: String(p?.why ?? '').slice(0, 150),
        urgency: ['high', 'medium', 'low'].includes(String(p?.urgency)) ? String(p.urgency) : 'medium',
      })),
      trending: (parsed?.trending || []).slice(0, 8).map((t: any) => ({
        category: String(t?.category ?? '').slice(0, 50), listingCount: Math.max(0, Number(t?.listing_count ?? 0)),
        avgDealScore: Math.round(Number(t?.avg_deal_score ?? 0)),
        trend: ['rising', 'stable', 'falling'].includes(String(t?.trend)) ? String(t.trend) : 'stable',
        action: ['buy_more', 'monitor', 'avoid'].includes(String(t?.action)) ? String(t.action) : 'monitor',
      })),
      summary: {
        totalDeals: Math.max(0, Number(parsed?.summary?.total_deals ?? 0)),
        dealOfDay: String(parsed?.summary?.deal_of_day ?? '').slice(0, 100),
        bestSource: String(parsed?.summary?.best_source ?? '').slice(0, 50),
        avgDealScore: Math.round(Number(parsed?.summary?.avg_deal_score ?? 0)),
        avgDiscountPct: Math.round(Number(parsed?.summary?.avg_discount_pct ?? 0)),
        totalPotentialProfitEur: Math.round(Number(parsed?.summary?.total_potential_profit_eur ?? 0)),
        aggregatorEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.aggregator_efficiency_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, aggregator, minDealScore });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
