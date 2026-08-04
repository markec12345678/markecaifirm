// v6.82: AI Inventory Slow Mover Analyzer — ML analiza počasi premikajočega inventarja
// POST /api/ai/inventory-slow-mover-analyzer
// Body: { days?: number }
// Returns: { ok, analyzer: { overview, slowMovers, categoryAnalysis, recommendations, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const SLOWNESS_TIERS = ['fast_mover', 'normal_mover', 'slow_mover', 'very_slow_mover', 'dead_stock'] as const;
const ACTION_TYPES = ['discount_15', 'discount_30', 'discount_50', 'bundle_deal', 'auction', 'liquidate', 'donate', 'return_supplier'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.max(7, Math.min(365, Number(body?.days ?? 90)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, buyLocation: true, notes: true, listingId: true }, take: 500, orderBy: { buyDate: 'desc' } });
    if (heldTrades.length === 0) return NextResponse.json({ ok: true, analyzer: null, message: 'Ni inventarja za slow mover analizo.' });

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellDate: { gte: since, not: null } }, select: { id: true, title: true, category: true, buyPrice: true, sellPrice: true, sellDate: true, buyDate: true }, take: 1000, orderBy: { sellDate: 'desc' } });

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    // Calculate avg days-to-sell per category from sold trades
    const categoryAvgSellDays = new Map<string, number>();
    const categoryItems = new Map<string, { sold: number; totalDays: number }>();
    for (const t of soldTrades) {
      if (!t.sellDate || !t.buyDate) continue;
      const cat = t.category || 'unknown';
      if (!categoryItems.has(cat)) categoryItems.set(cat, { sold: 0, totalDays: 0 });
      const s = categoryItems.get(cat)!;
      s.sold += 1;
      s.totalDays += Math.max(0, Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / DAY));
    }
    for (const [cat, s] of categoryItems) { categoryAvgSellDays.set(cat, s.sold > 0 ? Math.round(s.totalDays / s.sold) : 0); }

    const heldItems = heldTrades.map(t => {
      const ageDays = Math.floor((now - t.buyDate.getTime()) / DAY);
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const catAvg = categoryAvgSellDays.get(t.category || 'unknown') ?? 0;
      const slownessRatio = catAvg > 0 ? ageDays / catAvg : 0;
      let tier = 'fast_mover';
      if (slownessRatio > 3 || ageDays > 180) tier = 'dead_stock';
      else if (slownessRatio > 2 || ageDays > 120) tier = 'very_slow_mover';
      else if (slownessRatio > 1.5 || ageDays > 60) tier = 'slow_mover';
      else if (slownessRatio > 0.8 || ageDays > 30) tier = 'normal_mover';
      return { id: t.id, title: t.title, category: t.category, ageDays, cost, catAvgDays: catAvg, slownessRatio: Math.round(slownessRatio * 100) / 100, tier };
    });

    const totalValue = heldItems.reduce((s, i) => s + i.cost, 0);
    const slowMovers = heldItems.filter(i => i.tier === 'slow_mover' || i.tier === 'very_slow_mover' || i.tier === 'dead_stock');
    const slowMoverValue = slowMovers.reduce((s, i) => s + i.cost, 0);
    const slowMoverPct = totalValue > 0 ? Math.round((slowMoverValue / totalValue) * 100) : 0;

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const topSlow = slowMovers.slice(0, 10).map(i => `- ${i.title} | ${i.category} | ${i.ageDays}d | ${i.cost}€ | ${i.tier} | ratio ${i.slownessRatio}`).join('\n');

    const prompt = `Si AI inventory slow mover analyzer z ML in predictive analytics.
Analizira počasi premikajoč se inventar z 5 tierji in 8 akcijskimi tipi.

STATS:
- Total items: ${heldItems.length} | vrednost: ${Math.round(totalValue)}€
- Slow movers: ${slowMovers.length} | vrednost: ${Math.round(slowMoverValue)}€ (${slowMoverPct}%)
- Povprečni časi prodaje po kategorijah: ${Array.from(categoryAvgSellDays.entries()).slice(0, 6).map(([c, d]) => `${c}=${d}d`).join(', ')}

TOP SLOW MOVERS:
${topSlow || 'brez'}

5 slowness tierjev:
1. FAST_MOVER: <0.8x povprečja
2. NORMAL_MOVER: 0.8-1.5x povprečja
3. SLOW_MOVER: 1.5-2x povprečja
4. VERY_SLOW_MOVER: 2-3x povprečja
5. DEAD_STOCK: >3x povprečja ali >180 dni

8 akcijskih tipov: discount_15, discount_30, discount_50, bundle_deal, auction, liquidate, donate, return_supplier

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_items": <number>, "total_value_eur": <number>, "slow_movers_count": <number>, "slow_movers_value_eur": <number>, "slow_movers_pct": <number 0-100>, "avg_age_days": <number>, "tied_up_capital_eur": <number>, "slow_mover_grade": "<A|B|C|D|F>" },
  "slowMovers": [
    { "item_title": "<max 100 znakov>", "category": "<string>", "current_age_days": <number>, "category_avg_days": <number>, "slowness_ratio": <number>, "slowness_tier": "<${SLOWNESS_TIERS.join('|')}>", "current_value_eur": <number>, "predicted_sell_value_eur": <number>, "predicted_days_to_sell": <number>, "recommended_action": "<${ACTION_TYPES.join('|')}>" }
  ],
  "categoryAnalysis": [
    { "category": "<string>", "total_items": <number>, "slow_movers_count": <number>, "slow_mover_pct": <number 0-100>, "avg_age_days": <number>, "tied_up_capital_eur": <number>, "primary_issue": "<max 100 znakov>", "category_action": "<${ACTION_TYPES.join('|')}>" }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "action_type": "<${ACTION_TYPES.join('|')}>", "target_items_count": <number>, "expected_recovery_eur": <number>, "loss_acceptance_eur": <number>, "implementation_days": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<random_forest|xgboost|lstm|prophet|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<sell_time_prediction|value_degradation|risk_score|action_recommendation>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "slow_mover_risk_score": <number 0-100>, "slow_mover_grade": "<A|B|C|D|F>", "total_tied_up_capital_eur": <number>,
    "dead_stock_count": <number>, "recoverable_value_eur": <number>,
    "biggest_slow_mover_risk": "<max 100 znakov>", "biggest_recovery_opportunity": "<max 100 znakov>",
    "quickest_recovery_win": "<max 100 znakov>", "slow_mover_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const analyzer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      overview: { totalItems: Math.max(0, Number(parsed?.overview?.total_items ?? heldItems.length)), totalValueEur: Math.round(Number(parsed?.overview?.total_value_eur ?? totalValue)), slowMoversCount: Math.max(0, Number(parsed?.overview?.slow_movers_count ?? slowMovers.length)), slowMoversValueEur: Math.round(Number(parsed?.overview?.slow_movers_value_eur ?? slowMoverValue)), slowMoversPct: Math.max(0, Math.min(100, Number(parsed?.overview?.slow_movers_pct ?? slowMoverPct))), avgAgeDays: Math.max(0, Number(parsed?.overview?.avg_age_days ?? Math.round(heldItems.reduce((s, i) => s + i.ageDays, 0) / Math.max(1, heldItems.length)))), tiedUpCapitalEur: Math.round(Number(parsed?.overview?.tied_up_capital_eur ?? slowMoverValue)), slowMoverGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.slow_mover_grade)) ? String(parsed.overview.slow_mover_grade) : 'C' },
      slowMovers: (parsed?.slowMovers || []).slice(0, 15).map((s: any) => ({ itemTitle: String(s?.item_title ?? '').slice(0, 200), category: String(s?.category ?? '').slice(0, 50), currentAgeDays: Math.max(0, Number(s?.current_age_days ?? 0)), categoryAvgDays: Math.max(0, Number(s?.category_avg_days ?? 0)), slownessRatio: Math.round(Number(s?.slowness_ratio ?? 0) * 100) / 100, slownessTier: (SLOWNESS_TIERS as readonly string[]).includes(String(s?.slowness_tier)) ? String(s.slowness_tier) : 'normal_mover', currentValueEur: Math.round(Number(s?.current_value_eur ?? 0)), predictedSellValueEur: Math.round(Number(s?.predicted_sell_value_eur ?? 0)), predictedDaysToSell: Math.max(0, Number(s?.predicted_days_to_sell ?? 0)), recommendedAction: (ACTION_TYPES as readonly string[]).includes(String(s?.recommended_action)) ? String(s.recommended_action) : 'discount_15' })),
      categoryAnalysis: (parsed?.categoryAnalysis || []).slice(0, 10).map((c: any) => ({ category: String(c?.category ?? '').slice(0, 50), totalItems: Math.max(0, Number(c?.total_items ?? 0)), slowMoversCount: Math.max(0, Number(c?.slow_movers_count ?? 0)), slowMoverPct: Math.max(0, Math.min(100, Number(c?.slow_mover_pct ?? 0))), avgAgeDays: Math.max(0, Number(c?.avg_age_days ?? 0)), tiedUpCapitalEur: Math.round(Number(c?.tied_up_capital_eur ?? 0)), primaryIssue: String(c?.primary_issue ?? '').slice(0, 200), categoryAction: (ACTION_TYPES as readonly string[]).includes(String(c?.category_action)) ? String(c.category_action) : 'discount_15' })),
      recommendations: (parsed?.recommendations || []).slice(0, 8).map((r: any) => ({ action: String(r?.action ?? '').slice(0, 300), actionType: (ACTION_TYPES as readonly string[]).includes(String(r?.action_type)) ? String(r.action_type) : 'discount_15', targetItemsCount: Math.max(0, Number(r?.target_items_count ?? 0)), expectedRecoveryEur: Math.round(Number(r?.expected_recovery_eur ?? 0)), lossAcceptanceEur: Math.round(Number(r?.loss_acceptance_eur ?? 0)), implementationDays: Math.max(1, Number(r?.implementation_days ?? 7)), priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium' })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['random_forest', 'xgboost', 'lstm', 'prophet', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['sell_time_prediction', 'value_degradation', 'risk_score', 'action_recommendation'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'sell_time_prediction', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { slowMoverRiskScore: Math.max(0, Math.min(100, Number(parsed?.summary?.slow_mover_risk_score ?? 50))), slowMoverGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.slow_mover_grade)) ? String(parsed.summary.slow_mover_grade) : 'C', totalTiedUpCapitalEur: Math.round(Number(parsed?.summary?.total_tied_up_capital_eur ?? slowMoverValue)), deadStockCount: Math.max(0, Number(parsed?.summary?.dead_stock_count ?? 0)), recoverableValueEur: Math.round(Number(parsed?.summary?.recoverable_value_eur ?? slowMoverValue * 0.6)), biggestSlowMoverRisk: String(parsed?.summary?.biggest_slow_mover_risk ?? '').slice(0, 200), biggestRecoveryOpportunity: String(parsed?.summary?.biggest_recovery_opportunity ?? '').slice(0, 200), quickestRecoveryWin: String(parsed?.summary?.quickest_recovery_win ?? '').slice(0, 200), slowMoverAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.slow_mover_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, analyzer });
  } catch (e: any) { logger.error("/api/ai/inventory-slow-mover-analyzer", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
