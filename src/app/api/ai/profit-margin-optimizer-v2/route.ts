// v6.50: AI Profit Margin Optimizer v2 — ML cross-category analiza z rebalancing priporočili
// POST /api/ai/profit-margin-optimizer-v2
// Body: { category?: string }
// Returns: { ok, optimizer: { items, optimizations, crossCategory, rebalancing, scenarios, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

interface CategoryStats {
  category: string;
  count: number;
  totalCost: number;
  totalRevenue: number;
  totalProfit: number;
  avgMarginPct: number;
  avgDaysToSell: number;
  liquidityScore: number; // 0-100
  riskScore: number; // 0-100
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const categoryFilter = body?.category ? String(body.category).toLowerCase() : null;

    // 1. Pridobi held trades (inventar)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true, location: true } },
      },
      take: 50,
    });

    // 2. Pridobi sold trades za margin analizo
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: {
        id: true, title: true, category: true,
        buyPrice: true, buyFees: true, sellPrice: true, sellFees: true,
        buyDate: true, sellDate: true, sellLocation: true,
      },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return NextResponse.json({ ok: true, optimizer: null, message: 'Ni podatkov za margin analizo.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // 3. Agregacija per kategorija
    const catStatsMap = new Map<string, CategoryStats>();
    for (const t of soldTrades) {
      const cat = (t.category || 'drugo').toLowerCase();
      if (categoryFilter && !cat.includes(categoryFilter)) continue;
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = revenue - cost;
      const marginPct = cost > 0 ? (profit / cost) * 100 : 0;
      const daysToSell = Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000));

      if (!catStatsMap.has(cat)) {
        catStatsMap.set(cat, {
          category: cat,
          count: 0,
          totalCost: 0,
          totalRevenue: 0,
          totalProfit: 0,
          avgMarginPct: 0,
          avgDaysToSell: 0,
          liquidityScore: 0,
          riskScore: 0,
        });
      }
      const s = catStatsMap.get(cat)!;
      s.count += 1;
      s.totalCost += cost;
      s.totalRevenue += revenue;
      s.totalProfit += profit;
      s.avgMarginPct += marginPct;
      s.avgDaysToSell += daysToSell;
    }

    const categoryStats = Array.from(catStatsMap.values()).map(s => {
      if (s.count > 0) {
        s.avgMarginPct = Math.round((s.avgMarginPct / s.count) * 10) / 10;
        s.avgDaysToSell = Math.round(s.avgDaysToSell / s.count);
      }
      // Hevristika: liquidityScore (manjši daysToSell = višji score)
      s.liquidityScore = Math.max(10, Math.min(100, 100 - s.avgDaysToSell));
      // Risk score (višji margin = višji risk? ali nižji — odvisno)
      s.riskScore = Math.max(10, Math.min(100, Math.round(50 + s.avgMarginPct / 4)));
      return s;
    });

    // 4. Held items z margin potential
    const heldItems = heldTrades.map(t => {
      const cat = (t.category || 'drugo').toLowerCase();
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const currentMarginPct = cost > 0 ? Math.round(((estValue - cost) / cost) * 1000) / 10 : 0;
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));
      return {
        id: t.id, title: t.title, category: cat, cost, estValue, currentMarginPct, daysHeld,
        dealScore: t.listing?.dealScore ?? 50, aiRisk: t.listing?.aiRisk ?? 5,
      };
    });

    const itemsStr = heldItems.slice(0, 20).map(i =>
      `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ (margin ${i.currentMarginPct}%) | ${i.daysHeld}d | deal ${i.dealScore}/100 risk ${i.aiRisk}/10`
    ).join('\n');

    const catStr = categoryStats.slice(0, 8).map(c =>
      `- ${c.category} | ${c.count}x prodano | cost ${c.totalCost}€ → revenue ${c.totalRevenue}€ (profit ${c.totalProfit}€) | povp margin ${c.avgMarginPct}% | povp ${c.avgDaysToSell}d do prodaje | liquidity ${c.liquidityScore}/100 risk ${c.riskScore}/100`
    ).join('\n');

    const prompt = `Si AI profit margin optimizer v2 z ML cross-category analizo.
Optimiziraj dobiček preko cross-category rebalancing in per-item margin izboljšav.

KATEGORIJE ZGODOVINSKO (${categoryStats.length}):
${catStr}

TRENUTNI INVENTAR (${heldItems.length}):
${itemsStr}

Optimizacijske strategije:
1. PRICE_INCREASE: zvišaj ceno za items z visoko dealScore in low risk
2. PRICE_DECREASE: znižaj ceno za stalled items (več kot 30d)
3. BUNDLE_OPTIMIZATION: kombiniraj nizko-margin z visoko-margin items
4. CROSS_CATEGORY_REBALANCE: premakni kapital iz low-margin v high-margin kategorije
5. FEE_OPTIMIZATION: minimiziraj platform fees z optimalno izbiro platforme
6. SHIPPING_OPT: optimiziraj shipping costs
7. TIMING_OPT: prodaj v optimalnem času (sezona, dan v tednu)
8. RENOVATION_OPT: investiraj v renovation za višji margin
9. LIQUIDATION_OPT: likvidiraj dead inventory za sprostitev kapitala
10. SPECIALIZATION: specializiraj se v 1-2 visoko-margin kategorijah

ML cross-category analiza:
- Korrelacija med kategorijami (positive/negative)
- Risk-adjusted return per kategorija
- Capital efficiency ratio
- Time-value of money (kateri kategorija drži kapital najkrajše)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>",
      "current_margin_pct": <number>,
      "optimized_margin_pct": <number>,
      "optimization_strategy": "<price_increase|price_decrease|bundle_optimization|fee_optimization|shipping_opt|timing_opt|renovation_opt|liquidation_opt>",
      "current_price_eur": <number>,
      "optimized_price_eur": <number>,
      "expected_profit_increase_eur": <number>,
      "implementation_steps": ["<max 100 znakov>"],
      "priority": "<high|medium|low>"
    }
  ],
  "optimizations": [
    { "strategy": "<price_increase|price_decrease|bundle_optimization|cross_category_rebalance|fee_optimization|shipping_opt|timing_opt|renovation_opt|liquidation_opt|specialization>", "description": "<max 120 znakov>", "items_affected": <number>, "expected_profit_uplift_eur": <number>, "implementation_effort": "<low|medium|high>", "risk_level": "<low|medium|high>" }
  ],
  "cross_category": [
    {
      "category_a": "<kategorija>",
      "category_b": "<kategorija>",
      "correlation": "<positive|negative|neutral>",
      "correlation_strength": <number 0-100>,
      "insight": "<max 120 znakov>",
      "recommendation": "<max 150 znakov>"
    }
  ],
  "rebalancing": [
    {
      "from_category": "<kategorija>",
      "to_category": "<kategorija>",
      "amount_eur": <number>,
      "current_margin_pct": <number>,
      "target_margin_pct": <number>,
      "expected_profit_uplift_eur": <number>,
      "reasoning": "<max 150 znakov>",
      "timeframe_days": <number>
    }
  ],
  "scenarios": [
    { "scenario": "<current|optimized|aggressive|conservative>", "total_profit_eur": <number>, "avg_margin_pct": <number>, "total_revenue_eur": <number>, "capital_efficiency_pct": <number> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_impact_eur": <number>, "categories_affected": <number> }
  ],
  "summary": {
    "total_items_analyzed": <number>,
    "total_categories_analyzed": <number>,
    "current_total_profit_eur": <number>,
    "optimized_total_profit_eur": <number>,
    "expected_profit_uplift_eur": <number>,
    "expected_profit_uplift_pct": <number>,
    "avg_current_margin_pct": <number>,
    "avg_optimized_margin_pct": <number>,
    "best_category": "<max 80 znakov>",
    "worst_category": "<max 80 znakov>",
    "biggest_opportunity": "<max 100 znakov>",
    "quickest_win": "<max 100 znakov>",
    "margin_optimization_score": <number 0-100>
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
    const validIds = new Set(heldItems.map(i => i.id));
    const validCategories = new Set(categoryStats.map(c => c.category));

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      items: (parsed?.items || [])
        .filter((it: any) => validIds.has(String(it?.id ?? '')))
        .slice(0, 30)
        .map((it: any) => {
          const orig = heldItems.find(x => x.id === String(it?.id));
          return {
            tradeId: String(it?.id ?? ''),
            currentMarginPct: Math.round(Number(it?.current_margin_pct ?? orig?.currentMarginPct ?? 0) * 10) / 10,
            optimizedMarginPct: Math.round(Number(it?.optimized_margin_pct ?? orig?.currentMarginPct ?? 0) * 10) / 10,
            optimizationStrategy: ['price_increase', 'price_decrease', 'bundle_optimization', 'fee_optimization', 'shipping_opt', 'timing_opt', 'renovation_opt', 'liquidation_opt'].includes(String(it?.optimization_strategy)) ? String(it.optimization_strategy) : 'price_increase',
            currentPriceEur: Math.max(0, Math.round(Number(it?.current_price_eur ?? orig?.estValue ?? 0))),
            optimizedPriceEur: Math.max(0, Math.round(Number(it?.optimized_price_eur ?? orig?.estValue ?? 0))),
            expectedProfitIncreaseEur: Math.round(Number(it?.expected_profit_increase_eur ?? 0)),
            implementationSteps: (it?.implementation_steps || []).slice(0, 5).map((s: any) => String(s).slice(0, 200)),
            priority: ['high', 'medium', 'low'].includes(String(it?.priority)) ? String(it.priority) : 'medium',
          };
        }),
      optimizations: (parsed?.optimizations || []).slice(0, 10).map((o: any) => ({
        strategy: ['price_increase', 'price_decrease', 'bundle_optimization', 'cross_category_rebalance', 'fee_optimization', 'shipping_opt', 'timing_opt', 'renovation_opt', 'liquidation_opt', 'specialization'].includes(String(o?.strategy)) ? String(o.strategy) : 'price_increase',
        description: String(o?.description ?? '').slice(0, 250),
        itemsAffected: Math.max(0, Number(o?.items_affected ?? 0)),
        expectedProfitUpliftEur: Math.round(Number(o?.expected_profit_uplift_eur ?? 0)),
        implementationEffort: ['low', 'medium', 'high'].includes(String(o?.implementation_effort)) ? String(o.implementation_effort) : 'medium',
        riskLevel: ['low', 'medium', 'high'].includes(String(o?.risk_level)) ? String(o.risk_level) : 'medium',
      })),
      crossCategory: (parsed?.cross_category || [])
        .filter((c: any) => validCategories.has(String(c?.category_a ?? '')) || validCategories.has(String(c?.category_b ?? '')))
        .slice(0, 10)
        .map((c: any) => ({
          categoryA: String(c?.category_a ?? '').slice(0, 50),
          categoryB: String(c?.category_b ?? '').slice(0, 50),
          correlation: ['positive', 'negative', 'neutral'].includes(String(c?.correlation)) ? String(c.correlation) : 'neutral',
          correlationStrength: Math.max(0, Math.min(100, Number(c?.correlation_strength ?? 50))),
          insight: String(c?.insight ?? '').slice(0, 250),
          recommendation: String(c?.recommendation ?? '').slice(0, 300),
        })),
      rebalancing: (parsed?.rebalancing || []).slice(0, 6).map((r: any) => ({
        fromCategory: String(r?.from_category ?? '').slice(0, 50),
        toCategory: String(r?.to_category ?? '').slice(0, 50),
        amountEur: Math.max(0, Math.round(Number(r?.amount_eur ?? 0))),
        currentMarginPct: Math.round(Number(r?.current_margin_pct ?? 0)),
        targetMarginPct: Math.round(Number(r?.target_margin_pct ?? 0)),
        expectedProfitUpliftEur: Math.round(Number(r?.expected_profit_uplift_eur ?? 0)),
        reasoning: String(r?.reasoning ?? '').slice(0, 300),
        timeframeDays: Math.max(1, Number(r?.timeframe_days ?? 30)),
      })),
      scenarios: (parsed?.scenarios || []).slice(0, 4).map((s: any) => ({
        scenario: ['current', 'optimized', 'aggressive', 'conservative'].includes(String(s?.scenario)) ? String(s.scenario) : 'current',
        totalProfitEur: Math.round(Number(s?.total_profit_eur ?? 0)),
        avgMarginPct: Math.round(Number(s?.avg_margin_pct ?? 0)),
        totalRevenueEur: Math.round(Number(s?.total_revenue_eur ?? 0)),
        capitalEfficiencyPct: Math.round(Number(s?.capital_efficiency_pct ?? 0)),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        expectedImpactEur: Math.round(Number(r?.expected_impact_eur ?? 0)),
        categoriesAffected: Math.max(0, Number(r?.categories_affected ?? 0)),
      })),
      summary: {
        totalItemsAnalyzed: heldItems.length,
        totalCategoriesAnalyzed: categoryStats.length,
        currentTotalProfitEur: Math.round(Number(parsed?.summary?.current_total_profit_eur ?? categoryStats.reduce((s, c) => s + c.totalProfit, 0))),
        optimizedTotalProfitEur: Math.round(Number(parsed?.summary?.optimized_total_profit_eur ?? 0)),
        expectedProfitUpliftEur: Math.round(Number(parsed?.summary?.expected_profit_uplift_eur ?? 0)),
        expectedProfitUpliftPct: Math.round(Number(parsed?.summary?.expected_profit_uplift_pct ?? 0)),
        avgCurrentMarginPct: Math.round(Number(parsed?.summary?.avg_current_margin_pct ?? categoryStats.length > 0 ? categoryStats.reduce((s, c) => s + c.avgMarginPct, 0) / categoryStats.length : 0) * 10) / 10,
        avgOptimizedMarginPct: Math.round(Number(parsed?.summary?.avg_optimized_margin_pct ?? 0) * 10) / 10,
        bestCategory: String(parsed?.summary?.best_category ?? '').slice(0, 150),
        worstCategory: String(parsed?.summary?.worst_category ?? '').slice(0, 150),
        biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 200),
        quickestWin: String(parsed?.summary?.quickest_win ?? '').slice(0, 200),
        marginOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.margin_optimization_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
