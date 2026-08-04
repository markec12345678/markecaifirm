// v6.25: AI Multi-Asset Risk Parity — optimalna alokacija portfolia glede na tveganje/dobiček
// POST /api/ai/risk-parity
// Body: {}
// Returns: { ok, parity: { currentAllocation, riskAdjustedReturns, optimalAllocation, riskMetrics, rebalancing } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

// Sharpe ratio formula: (return - riskFreeRate) / volatility
function sharpeRatio(avgReturn: number, volatility: number, riskFreeRate = 0.05): number {
  if (volatility === 0) return 0;
  return (avgReturn - riskFreeRate) / volatility;
}

export async function POST(req: NextRequest) {
  try {
    await req.json().catch(() => ({}));

    // 1. Pridobi sold trades za izračun return/volatility per kategorija
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { gte: oneYearAgo }, sellPrice: { not: null } },
      select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true,
        buyDate: true, sellDate: true },
      take: 300,
    });

    // 2. Pridobi held trades za trenutno alokacijo
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true } } },
    });

    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return NextResponse.json({ ok: true, parity: null, message: 'Ni podatkov za risk parity analizo.' });
    }

    // 3. Izračunaj return in volatility per kategorija
    const catReturns: Record<string, { returns: number[]; avgReturn: number; volatility: number; sharpe: number; count: number }> = {};
    for (const t of soldTrades) {
      const cat = t.category || 'drugo';
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const returnPct = cost > 0 ? (revenue - cost) / cost : 0;
      if (!catReturns[cat]) catReturns[cat] = { returns: [], avgReturn: 0, volatility: 0, sharpe: 0, count: 0 };
      catReturns[cat].returns.push(returnPct);
      catReturns[cat].count++;
    }

    for (const cat of Object.keys(catReturns)) {
      const c = catReturns[cat];
      c.avgReturn = c.returns.reduce((a, b) => a + b, 0) / c.returns.length;
      const variance = c.returns.reduce((s, r) => s + Math.pow(r - c.avgReturn, 2), 0) / c.returns.length;
      c.volatility = Math.sqrt(variance);
      c.sharpe = sharpeRatio(c.avgReturn, c.volatility);
    }

    // 4. Trenutna alokacija
    const currentAllocation: Record<string, { invested: number; pct: number; count: number }> = {};
    let totalInvested = 0;
    for (const t of heldTrades) {
      const cat = t.category || 'drugo';
      const cost = t.buyPrice + (t.buyFees ?? 0);
      if (!currentAllocation[cat]) currentAllocation[cat] = { invested: 0, pct: 0, count: 0 };
      currentAllocation[cat].invested += cost;
      currentAllocation[cat].count++;
      totalInvested += cost;
    }
    for (const cat of Object.keys(currentAllocation)) {
      currentAllocation[cat].pct = totalInvested > 0 ? Math.round((currentAllocation[cat].invested / totalInvested) * 100) : 0;
    }

    // 5. AI risk parity analiza
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const catPerfStr = Object.entries(catReturns)
      .sort(([, a], [, b]) => b.sharpe - a.sharpe)
      .map(([cat, c]) => `- ${cat}: povp. return ${(c.avgReturn * 100).toFixed(1)}%, volatility ${(c.volatility * 100).toFixed(1)}%, Sharpe ${c.sharpe.toFixed(2)}, ${c.count} prodaj`)
      .join('\n');

    const currentAllocStr = Object.entries(currentAllocation)
      .sort(([, a], [, b]) => b.invested - a.invested)
      .map(([cat, a]) => `- ${cat}: ${a.invested}€ (${a.pct}%), ${a.count} itemov`)
      .join('\n');

    const prompt = `Si ekspert za portfolio management in risk parity strategije.
Optimiziraj alokacijo portfolia glede na tveganje in dobiček (risk-adjusted returns).

ZGODOVINSKI PODATKI PO KATEGORIJAH (Sharpe ratio = (return - 5%) / volatility):
${catPerfStr || '- Ni podatkov'}

TRENUTNA ALOKACIJA (skupaj ${totalInvested}€):
${currentAllocStr || '- Prazno'}

Risk parity pravila:
1. Kategorije z višjim Sharpe ratio → povečaj alokacijo
2. Kategorije z visoko volatility → zmanjšaj (tveganje)
3. Nobena kategorija naj ne preseže 40% portfolia (diverzifikacija)
4. Rezerviraj 15% za nove priložnosti (cash reserve)
5. Upoštevaj korelacije med kategorijami (npr. elektronika + telefoni so korelirani)

Strategije:
- "equal_risk": enako tveganje per kategorija (ne enako investicija!)
- "sharpe_optimized": maksimiziraj Sharpe ratio portfolia
- "min_volatility": minimiziraj skupno tveganje
- "max_return": maksimiziraj pričakovan return (visoko tveganje)

Odgovori LE z JSON:
{
  "strategy": "<equal_risk|sharpe_optimized|min_volatility|max_return>",
  "reasoning": "<max 200 znakov>",
  "optimal_allocation": [
    {
      "category": "<kategorija>",
      "current_pct": <number>,
      "optimal_pct": <number>,
      "change_pct": <number>,
      "action": "<buy_more|reduce|hold|exit|initiate>",
      "amount_eur": <number>,
      "expected_return_pct": <number>,
      "expected_volatility_pct": <number>,
      "sharpe_ratio": <number>,
      "reasoning": "<max 100 znakov>"
    }
  ],
  "risk_metrics": {
    "portfolio_sharpe": <number>,
    "portfolio_volatility_pct": <number>,
    "portfolio_expected_return_pct": <number>,
    "diversification_ratio": <number>,
    "max_concentration_pct": <number>,
    "risk_level": "<low|medium|high>"
  },
  "rebalancing": {
    "total_rebalance_eur": <number>,
    "buys": [{"category": "<cat>", "amount_eur": <number>}],
    "sells": [{"category": "<cat>", "amount_eur": <number>}],
    "cash_reserve_eur": <number>,
    "deadline_days": <number>
  },
  "correlation_warnings": ["<opozorilo o korelaciji, max 100 znakov>", "..."],
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

    const parity = {
      strategy: ['equal_risk', 'sharpe_optimized', 'min_volatility', 'max_return'].includes(String(parsed?.strategy))
        ? String(parsed.strategy) : 'sharpe_optimized',
      reasoning: String(parsed?.reasoning ?? '').slice(0, 400),
      optimalAllocation: (parsed?.optimal_allocation || []).slice(0, 12).map((a: any) => ({
        category: String(a?.category ?? '').slice(0, 50),
        currentPct: Math.max(0, Number(a?.current_pct ?? 0)),
        optimalPct: Math.max(0, Math.min(100, Number(a?.optimal_pct ?? 0))),
        changePct: Math.round(Number(a?.change_pct ?? 0)),
        action: ['buy_more', 'reduce', 'hold', 'exit', 'initiate'].includes(String(a?.action)) ? String(a.action) : 'hold',
        amountEur: Math.max(0, Number(a?.amount_eur ?? 0)),
        expectedReturnPct: Math.round((Number(a?.expected_return_pct ?? 0)) * 10) / 10,
        expectedVolatilityPct: Math.round((Number(a?.expected_volatility_pct ?? 0)) * 10) / 10,
        sharpeRatio: Math.round(Number(a?.sharpe_ratio ?? 0) * 100) / 100,
        reasoning: String(a?.reasoning ?? '').slice(0, 200),
      })),
      riskMetrics: {
        portfolioSharpe: Math.round(Number(parsed?.risk_metrics?.portfolio_sharpe ?? 0) * 100) / 100,
        portfolioVolatilityPct: Math.round(Number(parsed?.risk_metrics?.portfolio_volatility_pct ?? 0)),
        portfolioExpectedReturnPct: Math.round(Number(parsed?.risk_metrics?.portfolio_expected_return_pct ?? 0)),
        diversificationRatio: Math.round(Number(parsed?.risk_metrics?.diversification_ratio ?? 0) * 100) / 100,
        maxConcentrationPct: Math.round(Number(parsed?.risk_metrics?.max_concentration_pct ?? 0)),
        riskLevel: ['low', 'medium', 'high'].includes(String(parsed?.risk_metrics?.risk_level)) ? String(parsed.risk_metrics.risk_level) : 'medium',
      },
      rebalancing: {
        totalRebalanceEur: Math.max(0, Number(parsed?.rebalancing?.total_rebalance_eur ?? 0)),
        buys: (parsed?.rebalancing?.buys || []).slice(0, 6).map((b: any) => ({
          category: String(b?.category ?? '').slice(0, 50),
          amountEur: Math.max(0, Number(b?.amount_eur ?? 0)),
        })),
        sells: (parsed?.rebalancing?.sells || []).slice(0, 6).map((s: any) => ({
          category: String(s?.category ?? '').slice(0, 50),
          amountEur: Math.max(0, Number(s?.amount_eur ?? 0)),
        })),
        cashReserveEur: Math.max(0, Number(parsed?.rebalancing?.cash_reserve_eur ?? 0)),
        deadlineDays: Math.max(0, Number(parsed?.rebalancing?.deadline_days ?? 30)),
      },
      correlationWarnings: (parsed?.correlation_warnings || []).slice(0, 4).map((w: any) => String(w).slice(0, 200)),
      insights: String(parsed?.insights ?? '').slice(0, 500),
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      parity,
      currentAllocation: Object.entries(currentAllocation).map(([cat, a]) => ({ category: cat, ...a })),
      historicalData: {
        categoriesAnalyzed: Object.keys(catReturns).length,
        totalSales: soldTrades.length,
        totalHeld: heldTrades.length,
        totalInvested,
      },
    });
  } catch (e: any) {
    logger.error("/api/ai/risk-parity", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
