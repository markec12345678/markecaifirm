// v6.42: AI Predictive Risk Hedging — hedža tveganja z diverzifikacijo in zavarovanjem
// POST /api/ai/risk-hedging
// Body: {}
// Returns: { ok, hedging: { risks, hedges, strategies, coverage, recommendations } }

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
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true } } },
      take: 50,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true },
      take: 200,
    });

    if (heldTrades.length === 0) { return NextResponse.json({ ok: true, hedging: null, message: 'Ni held tradeov za risk hedging.' }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const totalValue = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const byCat: Record<string, { count: number; value: number }> = {};
    for (const t of heldTrades) { const c = t.category || 'drugo'; if (!byCat[c]) byCat[c] = { count: 0, value: 0 }; byCat[c].count++; byCat[c].value += t.buyPrice; }
    const topCat = Object.entries(byCat).sort(([,a],[,b]) => b.value - a.value)[0];
    const concentrationPct = topCat ? Math.round((topCat[1].value / totalValue) * 100) : 0;
    const highRiskItems = heldTrades.filter(t => (t.listing?.aiRisk ?? 0) >= 7).length;
    const stalled = heldTrades.filter(t => Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)) > 30).length;

    const itemsStr = heldTrades.slice(0, 15).map(t => `- ${t.title} | ${t.category} | ${t.buyPrice}€ | risk ${t.listing?.aiRisk ?? 5}/10 | ${Math.round((Date.now()-t.buyDate.getTime())/(24*60*60*1000))}d`).join('\n');

    const prompt = `Si AI risk hedging strategist. Hedžaj tveganja portfolia z diverzifikacijo in protistrategijami.

PORTFOLIO: ${heldTrades.length} itemov, ${Math.round(totalValue)}€
- Koncentracija top kategorije: ${concentrationPct}%
- High risk itemi: ${highRiskItems}
- Stalled (>30d): ${stalled}

INVENTAR:
${itemsStr}

Risk hedging strategije:
1. DIVERSIFICATION: razprši tveganje čez kategorije (max 30% per kategorija)
2. COUNTERWEIGHT: za vsako tvegano kategorijo imaj "safe" kategorijo
3. LIQUIDITY_HEDGE: vedno imej 20% cash reserve za priložnosti
4. SEASONAL_HEDGE: zimski itemi + poletni itemi (uravnoteženo)
5. PRICE_HEDGE: visokorizični itemi + nizkorizični (deal score 90+ + 60+)
6. TIME_HEDGE: hitro-prodajni (≤14d) + počasni (>45d) itemi
7. CATEGORY_HEDGE: elektronika + pohištvo (nekorelirana)
8. PLATFORM_HEDGE: ne objavljaj vse na eni platformi

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "risks": [
    { "type": "<concentration|market|seasonal|liquidity|price|time|platform|category>", "severity": "<high|medium|low>", "description": "<max 80 znakov>", "current_exposure_pct": <number>, "recommended_max_pct": <number>, "action": "<max 80 znakov>" }
  ],
  "hedges": [
    { "risk_addressed": "<tip tveganja>", "hedge_strategy": "<max 80 znakov>", "implementation": "<max 100 znakov>", "cost_eur": <number>, "expected_risk_reduction_pct": <number> }
  ],
  "strategies": [
    { "name": "<ime strategije>", "description": "<max 100 znakov>", "items_affected": <number>, "risk_reduction_pct": <number>, "profit_impact_pct": <number> }
  ],
  "coverage": {
    "diversification_score": <number 0-100>,
    "liquidity_coverage_pct": <number>,
    "seasonal_balance_pct": <number>,
    "price_risk_coverage_pct": <number>,
    "overall_hedge_coverage_pct": <number>
  },
  "recommendations": [
    { "action": "<max 120 znakov>", "priority": "<high|medium|low>", "risk_reduced": "<max 50 znakov>", "expected_impact_eur": <number> }
  ],
  "summary": {
    "current_risk_score": <number 0-100>,
    "hedged_risk_score": <number 0-100>,
    "risk_reduction_pct": <number>,
    "biggest_unhedged_risk": "<max 80 znakov>",
    "hedging_efficiency_score": <number 0-100>
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

    const hedging = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      risks: (parsed?.risks || []).slice(0, 8).map((r: any) => ({
        type: String(r?.type ?? '').slice(0, 50), severity: ['high', 'medium', 'low'].includes(String(r?.severity)) ? String(r.severity) : 'medium',
        description: String(r?.description ?? '').slice(0, 150), currentExposurePct: Math.round(Number(r?.current_exposure_pct ?? 0)),
        recommendedMaxPct: Math.round(Number(r?.recommended_max_pct ?? 0)), action: String(r?.action ?? '').slice(0, 150),
      })),
      hedges: (parsed?.hedges || []).slice(0, 8).map((h: any) => ({
        riskAddressed: String(h?.risk_addressed ?? '').slice(0, 50), hedgeStrategy: String(h?.hedge_strategy ?? '').slice(0, 150),
        implementation: String(h?.implementation ?? '').slice(0, 200), costEur: Math.round(Number(h?.cost_eur ?? 0)),
        expectedRiskReductionPct: Math.round(Number(h?.expected_risk_reduction_pct ?? 0)),
      })),
      strategies: (parsed?.strategies || []).slice(0, 6).map((s: any) => ({
        name: String(s?.name ?? '').slice(0, 80), description: String(s?.description ?? '').slice(0, 200),
        itemsAffected: Math.max(0, Number(s?.items_affected ?? 0)), riskReductionPct: Math.round(Number(s?.risk_reduction_pct ?? 0)),
        profitImpactPct: Math.round(Number(s?.profit_impact_pct ?? 0)),
      })),
      coverage: {
        diversificationScore: Math.max(0, Math.min(100, Number(parsed?.coverage?.diversification_score ?? 50))),
        liquidityCoveragePct: Math.round(Number(parsed?.coverage?.liquidity_coverage_pct ?? 0)),
        seasonalBalancePct: Math.round(Number(parsed?.coverage?.seasonal_balance_pct ?? 0)),
        priceRiskCoveragePct: Math.round(Number(parsed?.coverage?.price_risk_coverage_pct ?? 0)),
        overallHedgeCoveragePct: Math.round(Number(parsed?.coverage?.overall_hedge_coverage_pct ?? 0)),
      },
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 250), priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        riskReduced: String(r?.risk_reduced ?? '').slice(0, 80), expectedImpactEur: Math.round(Number(r?.expected_impact_eur ?? 0)),
      })),
      summary: {
        currentRiskScore: Math.max(0, Math.min(100, Number(parsed?.summary?.current_risk_score ?? 50))),
        hedgedRiskScore: Math.max(0, Math.min(100, Number(parsed?.summary?.hedged_risk_score ?? 30))),
        riskReductionPct: Math.round(Number(parsed?.summary?.risk_reduction_pct ?? 0)),
        biggestUnhedgedRisk: String(parsed?.summary?.biggest_unhedged_risk ?? '').slice(0, 150),
        hedgingEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.hedging_efficiency_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, hedging });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
