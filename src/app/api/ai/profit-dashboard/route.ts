// v6.30 MILESTONE: AI Profit Maximization Dashboard — agregira vse AI metrike v eno
// POST /api/ai/profit-dashboard
// Body: {}
// Returns: { ok, dashboard: { kpis, portfolio, opportunities, risks, actions, projections } }

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

    // Pridobi VSE podatke za dashboard
    const [heldTrades, soldTrades, recentListings] = await Promise.all([
      db.trade.findMany({
        where: { status: 'held' },
        select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
          listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true } } },
        take: 100,
      }),
      db.trade.findMany({
        where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
        select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true,
          buyDate: true, sellDate: true, buyLocation: true },
        take: 500,
      }),
      db.listing.findMany({
        where: { isHidden: false, firstSeenAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        select: { price: true, aiVerdict: true, dealScore: true,
          monitor: { select: { source: true } } },
        take: 500,
      }),
    ]);

    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return NextResponse.json({ ok: true, dashboard: null, message: 'Ni podatkov za dashboard.' });
    }

    // KPI izračuni
    const totalInvestedHeld = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalRealized = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0), 0);
    const totalRevenue = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0), 0);
    const avgRoi = soldTrades.length > 0
      ? Math.round(soldTrades.reduce((s, t) => {
          const cost = t.buyPrice + (t.buyFees ?? 0);
          return s + (cost > 0 ? (((t.sellPrice ?? 0) - (t.sellFees ?? 0) - cost) / cost) * 100 : 0);
        }, 0) / soldTrades.length) : 0;
    const avgDaysToSell = soldTrades.length > 0
      ? Math.round(soldTrades.reduce((s, t) => {
          if (t.sellDate && t.buyDate) return s + (t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000);
          return s;
        }, 0) / soldTrades.length) : 0;

    // Stalled items
    const stalled = heldTrades.filter(t => {
      const days = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));
      return days > 30;
    });

    // Recent opportunities
    const opportunities = recentListings.filter(l => l.aiVerdict === 'PRILIKA' || (l.dealScore ?? 0) >= 70);
    const opportunityRate = recentListings.length > 0 ? Math.round((opportunities.length / recentListings.length) * 100) : 0;

    // Category breakdown
    const catProfit: Record<string, number> = {};
    for (const t of soldTrades) {
      const cat = t.category || 'drugo';
      catProfit[cat] = (catProfit[cat] ?? 0) + (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
    }

    // AI dashboard
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const catStr = Object.entries(catProfit).sort(([,a],[,b]) => b - a).slice(0, 8).map(([cat, profit]) => `- ${cat}: ${Math.round(profit)}€`).join('\n');
    const heldStr = heldTrades.slice(0, 15).map(t => `- ${t.title} | ${t.category} | ${Math.round((Date.now()-t.buyDate.getTime())/(24*60*60*1000))}d | ${t.buyPrice}€`).join('\n');

    const prompt = `Si vrhovni AI poslovni svetovalec za preprodajo rabljenih dobrin.
Ustvari celovit profit maximization dashboard z vsemi ključnimi metrikami in priporočili.

KPI PODATKI:
- Realizirani dobiček: ${Math.round(totalRealized)}€
- Vezano v inventarju: ${Math.round(totalInvestedHeld)}€ (${heldTrades.length} itemov)
- Povp. ROI: ${avgRoi}%
- Povp. čas do prodaje: ${avgDaysToSell}d
- Stalled itemi (>30d): ${stalled.length}
- Nove priložnosti (7d): ${opportunities.length} od ${recentListings.length} (${opportunityRate}%)
- Skupni prihodek: ${Math.round(totalRevenue)}€

DOBIČEK PO KATEGORIJAH:
${catStr}

TRENUTNI INVENTAR:
${heldStr}

Ustvari dashboard z:
1. KPI summary (8 ključnih metrik)
2. Portfolio health score (0-100)
3. Top 5 priložnosti (kaj kupiti)
4. Top 5 tveganj (kaj prodati/likvidirati)
5. Priporočene akcije (prioritizirane)
6. 3-mesečna projekcija dobička

Odgovori LE z JSON:
{
  "kpis": {
    "realized_profit_eur": <number>,
    "invested_held_eur": <number>,
    "avg_roi_pct": <number>,
    "avg_days_to_sell": <number>,
    "stalled_count": <number>,
    "opportunity_count": <number>,
    "opportunity_rate_pct": <number>,
    "total_revenue_eur": <number>
  },
  "portfolio_health_score": <number 0-100>,
  "portfolio_health_grade": "<A+|A|B+|B|C|D|F>",
  "health_factors": [
    { "factor": "<ime>", "score": <number 0-100>, "status": "<good|warning|critical>", "note": "<max 80 znakov>" }
  ],
  "top_opportunities": [
    { "category": "<kat>", "action": "<kaj kupiti>", "expected_roi_pct": <number>, "urgency": "<high|medium|low>", "source": "<kje>", "reasoning": "<max 80 znakov>" }
  ],
  "top_risks": [
    { "item": "<naslov ali kategorija>", "risk_type": "<stalled|depreciation|low_demand|overconcentrated>", "severity": "<high|medium|low>", "action": "<max 80 znakov>", "potential_loss_eur": <number> }
  ],
  "recommended_actions": [
    { "action": "<max 100 znakov>", "priority": "<critical|high|medium|low>", "expected_impact_eur": <number>, "deadline_days": <number> }
  ],
  "projections": [
    { "month": <number>, "projected_revenue_eur": <number>, "projected_profit_eur": <number>, "projected_invested_eur": <number>, "cash_flow_eur": <number> }
  ],
  "overall_assessment": "<max 300 znakov>"
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

    const dashboard = {
      kpis: {
        realizedProfitEur: Math.round(Number(parsed?.kpis?.realized_profit_eur ?? totalRealized)),
        investedHeldEur: Math.round(Number(parsed?.kpis?.invested_held_eur ?? totalInvestedHeld)),
        avgRoiPct: Math.round(Number(parsed?.kpis?.avg_roi_pct ?? avgRoi)),
        avgDaysToSell: Math.round(Number(parsed?.kpis?.avg_days_to_sell ?? avgDaysToSell)),
        stalledCount: Math.max(0, Number(parsed?.kpis?.stalled_count ?? stalled.length)),
        opportunityCount: Math.max(0, Number(parsed?.kpis?.opportunity_count ?? opportunities.length)),
        opportunityRatePct: Math.round(Number(parsed?.kpis?.opportunity_rate_pct ?? opportunityRate)),
        totalRevenueEur: Math.round(Number(parsed?.kpis?.total_revenue_eur ?? totalRevenue)),
      },
      portfolioHealthScore: Math.max(0, Math.min(100, Number(parsed?.portfolio_health_score ?? 50))),
      portfolioHealthGrade: ['A+', 'A', 'B+', 'B', 'C', 'D', 'F'].includes(String(parsed?.portfolio_health_grade)) ? String(parsed.portfolio_health_grade) : 'C',
      healthFactors: (parsed?.health_factors || []).slice(0, 8).map((f: any) => ({
        factor: String(f?.factor ?? '').slice(0, 80),
        score: Math.max(0, Math.min(100, Number(f?.score ?? 50))),
        status: ['good', 'warning', 'critical'].includes(String(f?.status)) ? String(f.status) : 'good',
        note: String(f?.note ?? '').slice(0, 150),
      })),
      topOpportunities: (parsed?.top_opportunities || []).slice(0, 5).map((o: any) => ({
        category: String(o?.category ?? '').slice(0, 50),
        action: String(o?.action ?? '').slice(0, 200),
        expectedRoiPct: Math.round(Number(o?.expected_roi_pct ?? 0)),
        urgency: ['high', 'medium', 'low'].includes(String(o?.urgency)) ? String(o.urgency) : 'medium',
        source: String(o?.source ?? '').slice(0, 50),
        reasoning: String(o?.reasoning ?? '').slice(0, 150),
      })),
      topRisks: (parsed?.top_risks || []).slice(0, 5).map((r: any) => ({
        item: String(r?.item ?? '').slice(0, 100),
        riskType: String(r?.risk_type ?? '').slice(0, 50),
        severity: ['high', 'medium', 'low'].includes(String(r?.severity)) ? String(r.severity) : 'medium',
        action: String(r?.action ?? '').slice(0, 200),
        potentialLossEur: Math.round(Number(r?.potential_loss_eur ?? 0)),
      })),
      recommendedActions: (parsed?.recommended_actions || []).slice(0, 8).map((a: any) => ({
        action: String(a?.action ?? '').slice(0, 250),
        priority: ['critical', 'high', 'medium', 'low'].includes(String(a?.priority)) ? String(a.priority) : 'medium',
        expectedImpactEur: Math.round(Number(a?.expected_impact_eur ?? 0)),
        deadlineDays: Math.max(0, Number(a?.deadline_days ?? 7)),
      })),
      projections: (parsed?.projections || []).slice(0, 3).map((p: any) => ({
        month: Math.max(1, Number(p?.month ?? 1)),
        projectedRevenueEur: Math.round(Number(p?.projected_revenue_eur ?? 0)),
        projectedProfitEur: Math.round(Number(p?.projected_profit_eur ?? 0)),
        projectedInvestedEur: Math.round(Number(p?.projected_invested_eur ?? 0)),
        cashFlowEur: Math.round(Number(p?.cash_flow_eur ?? 0)),
      })),
      overallAssessment: String(parsed?.overall_assessment ?? '').slice(0, 600),
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, dashboard, version: 'v6.30.0 MILESTONE' });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
