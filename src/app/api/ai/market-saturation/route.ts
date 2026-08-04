// v6.34: AI Market Saturation Detector — zazna nasičenost trga po kategorijah
// POST /api/ai/market-saturation
// Body: {}
// Returns: { ok, saturation: { categories: [], trends, recommendations } }

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

    // Pridobi vse listinge za analizo nasičenosti
    const allListings = await db.listing.findMany({
      where: { isHidden: false, price: { gt: 0 } },
      select: { price: true, aiVerdict: true, dealScore: true, firstSeenAt: true,
        monitor: { select: { source: true, name: true } } },
      take: 1000,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true },
      take: 200,
    });

    if (allListings.length === 0) {
      return NextResponse.json({ ok: true, saturation: null, message: 'Ni oglasov za analizo nasičenosti.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // Analiza po virih (proxy za kategorije)
    const bySource: Record<string, { total: number; opportunities: number; avgPrice: number; avgDealScore: number; priceRange: [number, number] }> = {};
    for (const l of allListings) {
      const src = l.monitor?.source || 'neznan';
      if (!bySource[src]) bySource[src] = { total: 0, opportunities: 0, avgPrice: 0, avgDealScore: 0, priceRange: [Infinity, 0] };
      bySource[src].total++;
      if (l.aiVerdict === 'PRILIKA' || (l.dealScore ?? 0) >= 70) bySource[src].opportunities++;
      bySource[src].avgPrice += l.price ?? 0;
      bySource[src].avgDealScore += l.dealScore ?? 0;
      bySource[src].priceRange[0] = Math.min(bySource[src].priceRange[0], l.price ?? 0);
      bySource[src].priceRange[1] = Math.max(bySource[src].priceRange[1], l.price ?? 0);
    }
    for (const src of Object.keys(bySource)) {
      bySource[src].avgPrice = bySource[src].total > 0 ? Math.round(bySource[src].avgPrice / bySource[src].total) : 0;
      bySource[src].avgDealScore = bySource[src].total > 0 ? Math.round(bySource[src].avgDealScore / bySource[src].total) : 0;
    }

    // Recent listings (7d) vs older (30d) za trend
    const now = Date.now();
    const recent7d = allListings.filter(l => l.firstSeenAt.getTime() > now - 7 * 24 * 60 * 60 * 1000).length;
    const recent30d = allListings.filter(l => l.firstSeenAt.getTime() > now - 30 * 24 * 60 * 60 * 1000).length;
    const opportunityRate = allListings.length > 0
      ? Math.round(allListings.filter(l => l.aiVerdict === 'PRILIKA' || (l.dealScore ?? 0) >= 70).length / allListings.length * 100) : 0;

    const sourceStr = Object.entries(bySource).sort(([,a],[,b]) => b.total - a.total).map(([src, d]) =>
      `- ${src}: ${d.total} oglasov, ${d.opportunities} priložnosti (${Math.round(d.opportunities/d.total*100)}%), povp. ${d.avgPrice}€, deal ${d.avgDealScore}/100`
    ).join('\n');

    const prompt = `Si ekspert za analizo nasičenosti trga.
Analiziraj ali je trg preasičen za določene kategorije in identificiraj priložnosti.

SKUPno: ${allListings.length} oglasov
- Zadnjih 7 dni: ${recent7d} novih
- Zadnjih 30 dni: ${recent30d} novih
- Stopnja priložnosti: ${opportunityRate}%

PODATKI PO VIRIH:
${sourceStr}

ZGODOVINSKE PRODAJE: ${soldTrades.length}

Nasičenost trga:
- SATURATED: veliko oglasov, nizka stopnja priložnosti (<10%), padajoče cene → izogibaj
- COMPETITIVE: srednje oglasov, sprejemljiva priložnost (10-20%) → bodi previden
- BALANCED: normalno število, dobra priložnost (20-30%) → nadaljuj normalno
- OPPORTUNITY: malo oglasov, visoka priložnost (>30%) → povečaj nabavo
- BLUE OCEAN: zelo malo oglasov, visoko povpraševanje → fokusiraj se

Indikatorji nasičenosti:
1. Listing volume trend (raste/pada/stabilen)
2. Opportunity rate (kakovost oglasov)
3. Price trend (padajoče = nasičenost, rastoče = priložnost)
4. Deal score trend (nižji = več slabih oglasov = nasičenost)
5. Time on market (daljši = nasičenost)

Odgovori LE z JSON:
{
  "insights": "<max 250 znakov>",
  "categories": [
    {
      "source": "<vir>",
      "total_listings": <number>,
      "opportunity_rate_pct": <number>,
      "saturation_level": "<saturated|competitive|balanced|opportunity|blue_ocean>",
      "saturation_score": <number 0-100, višje = bolj nasičeno>,
      "price_trend": "<rising|falling|stable>",
      "opportunity_trend": "<increasing|decreasing|stable>",
      "listing_velocity_per_week": <number>,
      "avg_deal_score": <number>,
      "action": "<increase_buying|maintain|reduce|exit|enter>",
      "reasoning": "<max 100 znakov>"
    }
  ],
  "market_signals": [
    {
      "signal": "<ime signala, max 80 znakov>",
      "type": "<positive|negative|neutral>",
      "impact": "<high|medium|low>",
      "description": "<max 100 znakov>"
    }
  ],
  "recommendations": [
    {
      "action": "<max 120 znakov>",
      "target_source": "<vir>",
      "priority": "<high|medium|low>",
      "expected_impact": "<max 80 znakov>"
    }
  ],
  "summary": {
    "overall_saturation_score": <number 0-100>,
    "overall_market_state": "<saturated|competitive|balanced|opportunity|blue_ocean>",
    "best_opportunity_source": "<vir>",
    "most_saturated_source": "<vir>",
    "recommended_portfolio_shift": "<max 150 znakov>"
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

    const saturation = {
      insights: String(parsed?.insights ?? '').slice(0, 600),
      categories: (parsed?.categories || []).slice(0, 10).map((c: any) => ({
        source: String(c?.source ?? '').slice(0, 50),
        totalListings: Math.max(0, Number(c?.total_listings ?? 0)),
        opportunityRatePct: Math.max(0, Math.min(100, Number(c?.opportunity_rate_pct ?? 0))),
        saturationLevel: ['saturated', 'competitive', 'balanced', 'opportunity', 'blue_ocean'].includes(String(c?.saturation_level))
          ? String(c.saturation_level) : 'balanced',
        saturationScore: Math.max(0, Math.min(100, Number(c?.saturation_score ?? 50))),
        priceTrend: ['rising', 'falling', 'stable'].includes(String(c?.price_trend)) ? String(c.priceTrend) : 'stable',
        opportunityTrend: ['increasing', 'decreasing', 'stable'].includes(String(c?.opportunity_trend)) ? String(c.opportunityTrend) : 'stable',
        listingVelocityPerWeek: Math.max(0, Number(c?.listing_velocity_per_week ?? 0)),
        avgDealScore: Math.max(0, Math.min(100, Number(c?.avg_deal_score ?? 0))),
        action: ['increase_buying', 'maintain', 'reduce', 'exit', 'enter'].includes(String(c?.action)) ? String(c.action) : 'maintain',
        reasoning: String(c?.reasoning ?? '').slice(0, 200),
      })),
      marketSignals: (parsed?.market_signals || []).slice(0, 6).map((s: any) => ({
        signal: String(s?.signal ?? '').slice(0, 150),
        type: ['positive', 'negative', 'neutral'].includes(String(s?.type)) ? String(s.type) : 'neutral',
        impact: ['high', 'medium', 'low'].includes(String(s?.impact)) ? String(s.impact) : 'medium',
        description: String(s?.description ?? '').slice(0, 200),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 250),
        targetSource: String(r?.target_source ?? '').slice(0, 50),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        expectedImpact: String(r?.expected_impact ?? '').slice(0, 150),
      })),
      summary: {
        overallSaturationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.overall_saturation_score ?? 50))),
        overallMarketState: ['saturated', 'competitive', 'balanced', 'opportunity', 'blue_ocean'].includes(String(parsed?.summary?.overall_market_state))
          ? String(parsed.summary.overall_market_state) : 'balanced',
        bestOpportunitySource: String(parsed?.summary?.best_opportunity_source ?? '').slice(0, 50),
        mostSaturatedSource: String(parsed?.summary?.most_saturated_source ?? '').slice(0, 50),
        recommendedPortfolioShift: String(parsed?.summary?.recommended_portfolio_shift ?? '').slice(0, 300),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, saturation });
  } catch (e: any) {
    logger.error("/api/ai/market-saturation", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
