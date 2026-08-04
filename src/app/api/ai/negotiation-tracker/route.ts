// v6.39: AI Negotiation Outcome Tracker — sledi izidom pogajanj in izboljša strategijo
// POST /api/ai/negotiation-tracker
// Body: {}
// Returns: { ok, tracker: { history, patterns, winRate, strategies, improvements } }

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

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true,
        sellPrice: true, sellFees: true, buyDate: true, sellDate: true,
        buyLocation: true, sellLocation: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiScore: true, aiRisk: true } } },
      take: 200,
      orderBy: { sellDate: 'desc' },
    });

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 30,
    });

    if (soldTrades.length === 0) { return NextResponse.json({ ok: true, tracker: null, message: 'Ni prodaj za negotiation tracking.' }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // Analiza negotiation outcomes
    const negotiations = soldTrades.map(t => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = revenue - cost;
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const achievedVsEst = estValue > 0 ? Math.round((revenue / estValue) * 100) : 100;
      const days = t.sellDate && t.buyDate ? Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000)) : 0;
      return { id: t.id, title: t.title, category: t.category || 'drugo', cost, revenue, profit, estValue, achievedVsEst, days,
        buyLocation: t.buyLocation || 'neznan', sellLocation: t.sellLocation || 'neznan',
        aiScore: t.listing?.aiScore ?? 5, dealScore: t.listing?.dealScore ?? 50 };
    });

    const wonCount = negotiations.filter(n => n.profit > 0).length;
    const winRate = negotiations.length > 0 ? Math.round((wonCount / negotiations.length) * 100) : 0;
    const avgAchievedVsEst = negotiations.length > 0 ? Math.round(negotiations.reduce((s, n) => s + n.achievedVsEst, 0) / negotiations.length) : 100;
    const aboveEstCount = negotiations.filter(n => n.achievedVsEst > 100).length;

    const negStr = negotiations.slice(0, 15).map(n => `- ${n.title} | cost ${n.cost}€ → sell ${n.revenue}€ | profit ${n.profit}€ | est ${n.estValue}€ (${n.achievedVsEst}%) | ${n.days}d | buy: ${n.buyLocation} → sell: ${n.sellLocation}`).join('\n');

    const prompt = `Si AI negotiation outcome tracker. Analiziraj rezultate pogajanj in izboljšaj strategijo.
Sledi kako uspešna so bila tvoja pogajanja (ali si dobil ceno ki si si jo želel).

NEGOTIATION OUTCOMES (${negotiations.length}):
${negStr}

METRIKE:
- Win rate (profit > 0): ${winRate}%
- Povp. dosežena cena vs est. vrednost: ${avgAchievedVsEst}%
- Nad est. vrednostjo: ${aboveEstCount}/${negotiations.length}

Analiziraj:
1. Pri katerih kategorijah si dobil boljše cene (achievedVsEst > 100)?
2. Pri katerih virih nakupa je bila marža večja?
3. Ali so AI score/deal score korelirali s končnim dobičkom?
4. Kateri prodajni kanali so prinesli višje cene?
5. Kateri patterni pogajanja so delovali (visoka začetna cena → končna nižja a še vedno dobičkonosna)?

Negotiation outcome kategorije:
- "big_win": achievedVsEst > 110% (izjemno dobro pogajanje)
- "win": achievedVsEst 90-110% (pošteno)
- "small_loss": achievedVsEst 75-90% (nekoliko pod est.)
- "big_loss": achievedVsEst < 75% (slabo pogajanje ali prevelik popust)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "win_rate_pct": <number>,
  "avg_achieved_vs_est_pct": <number>,
  "outcome_distribution": [
    { "outcome": "<big_win|win|small_loss|big_loss>", "count": <number>, "pct": <number> }
  ],
  "patterns": [
    {
      "pattern": "<ime vzorca, max 80 znakov>",
      "frequency": <number>,
      "avg_outcome_pct": <number>,
      "best_for": "<kategorija ali vir, max 50 znakov>",
      "recommendation": "<max 100 znakov>"
    }
  ],
  "category_performance": [
    { "category": "<kat>", "negotiations": <number>, "win_rate_pct": <number>, "avg_achieved_pct": <number>, "best_strategy": "<max 80 znakov>" }
  ],
  "source_performance": [
    { "source": "<vir nakupa>", "negotiations": <number>, "avg_profit_eur": <number>, "best_sell_channel": "<kje prodati>", "negotiation_tip": "<max 80 znakov>" }
  ],
  "strategies": [
    {
      "strategy": "<ime strategije>",
      "success_rate_pct": <number>,
      "avg_profit_eur": <number>,
      "when_to_use": "<max 80 znakov>",
      "example": "<max 100 znakov>"
    }
  ],
  "improvements": [
    { "area": "<ime področja>", "current_issue": "<max 80 znakov>", "recommended_fix": "<max 120 znakov>", "expected_improvement_pct": <number> }
  ],
  "held_items_forecast": [
    { "id": "<trade_id>", "title": "<naslov>", "predicted_negotiation_outcome_pct": <number>, "recommended_strategy": "<max 80 znakov>", "predicted_final_price_eur": <number> }
  ],
  "summary": {
    "overall_negotiation_score": <number 0-100>,
    "best_negotiation_category": "<kat>",
    "worst_negotiation_category": "<kat>",
    "biggest_improvement_opportunity": "<max 100 znakov>",
    "projected_profit_increase_pct": <number>
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
    const validHeldIds = new Set(heldTrades.map(t => t.id));

    const tracker = {
      insights: String(parsed?.insights ?? '').slice(0, 600),
      winRatePct: Math.max(0, Math.min(100, Number(parsed?.win_rate_pct ?? winRate))),
      avgAchievedVsEstPct: Math.round(Number(parsed?.avg_achieved_vs_est_pct ?? avgAchievedVsEst)),
      outcomeDistribution: (parsed?.outcome_distribution || []).slice(0, 4).map((o: any) => ({
        outcome: ['big_win', 'win', 'small_loss', 'big_loss'].includes(String(o?.outcome)) ? String(o.outcome) : 'win',
        count: Math.max(0, Number(o?.count ?? 0)), pct: Math.max(0, Math.min(100, Number(o?.pct ?? 0))),
      })),
      patterns: (parsed?.patterns || []).slice(0, 8).map((p: any) => ({
        pattern: String(p?.pattern ?? '').slice(0, 150), frequency: Math.max(0, Number(p?.frequency ?? 0)),
        avgOutcomePct: Math.round(Number(p?.avg_outcome_pct ?? 0)), bestFor: String(p?.best_for ?? '').slice(0, 80),
        recommendation: String(p?.recommendation ?? '').slice(0, 200),
      })),
      categoryPerformance: (parsed?.category_performance || []).slice(0, 10).map((c: any) => ({
        category: String(c?.category ?? '').slice(0, 50), negotiations: Math.max(0, Number(c?.negotiations ?? 0)),
        winRatePct: Math.round(Number(c?.win_rate_pct ?? 0)), avgAchievedPct: Math.round(Number(c?.avg_achieved_pct ?? 0)),
        bestStrategy: String(c?.best_strategy ?? '').slice(0, 150),
      })),
      sourcePerformance: (parsed?.source_performance || []).slice(0, 8).map((s: any) => ({
        source: String(s?.source ?? '').slice(0, 50), negotiations: Math.max(0, Number(s?.negotiations ?? 0)),
        avgProfitEur: Math.round(Number(s?.avg_profit_eur ?? 0)), bestSellChannel: String(s?.best_sell_channel ?? '').slice(0, 50),
        negotiationTip: String(s?.negotiation_tip ?? '').slice(0, 150),
      })),
      strategies: (parsed?.strategies || []).slice(0, 6).map((s: any) => ({
        strategy: String(s?.strategy ?? '').slice(0, 80), successRatePct: Math.round(Number(s?.success_rate_pct ?? 0)),
        avgProfitEur: Math.round(Number(s?.avg_profit_eur ?? 0)), whenToUse: String(s?.when_to_use ?? '').slice(0, 150),
        example: String(s?.example ?? '').slice(0, 200),
      })),
      improvements: (parsed?.improvements || []).slice(0, 6).map((im: any) => ({
        area: String(im?.area ?? '').slice(0, 80), currentIssue: String(im?.current_issue ?? '').slice(0, 150),
        recommendedFix: String(im?.recommended_fix ?? '').slice(0, 250), expectedImprovementPct: Math.round(Number(im?.expected_improvement_pct ?? 0)),
      })),
      heldItemsForecast: (parsed?.held_items_forecast || []).filter((h: any) => validHeldIds.has(String(h?.id ?? ''))).slice(0, 10).map((h: any) => ({
        tradeId: String(h?.id ?? ''), title: String(h?.title ?? '').slice(0, 100),
        predictedNegotiationOutcomePct: Math.round(Number(h?.predicted_negotiation_outcome_pct ?? 0)),
        recommendedStrategy: String(h?.recommended_strategy ?? '').slice(0, 150),
        predictedFinalPriceEur: Math.max(0, Number(h?.predicted_final_price_eur ?? 0)),
      })),
      summary: {
        overallNegotiationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.overall_negotiation_score ?? 50))),
        bestNegotiationCategory: String(parsed?.summary?.best_negotiation_category ?? '').slice(0, 50),
        worstNegotiationCategory: String(parsed?.summary?.worst_negotiation_category ?? '').slice(0, 50),
        biggestImprovementOpportunity: String(parsed?.summary?.biggest_improvement_opportunity ?? '').slice(0, 200),
        projectedProfitIncreasePct: Math.round(Number(parsed?.summary?.projected_profit_increase_pct ?? 0)),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, tracker });
  } catch (e: any) { logger.error("/api/ai/negotiation-tracker", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
