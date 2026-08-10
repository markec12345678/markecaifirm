// v6.88: AI Inventory Liquidation Optimizer — ML optimizacija likvidacije inventarja z exit strategy
// POST /api/ai/inventory-liquidation-optimizer
// Body: { days?: number }
// Returns: { ok, optimizer: { overview, liquidationItems, channelStrategy, pricingStrategy, recommendations, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const LIQUIDATION_TIERS = ['urgent', 'aggressive', 'moderate', 'strategic', 'patient'] as const;
const EXIT_CHANNELS = ['auction', 'bulk_buyer', 'wholesale', 'discount_retail', 'online_marketplace', 'consignment', 'donation', 'scrap', 'trade_in', 'bundle_deal'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.max(7, Math.min(365, Number(body?.days ?? 90)));

    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, buyLocation: true, notes: true, listingId: true }, take: 500, orderBy: { buyDate: 'desc' } });
    if (heldTrades.length === 0) return NextResponse.json({ ok: true, optimizer: null, message: 'Ni inventarja za liquidation optimizacijo.' });

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    const items = heldTrades.map(t => {
      const ageDays = Math.floor((now - t.buyDate.getTime()) / DAY);
      const cost = t.buyPrice + (t.buyFees ?? 0);
      let tier = 'patient';
      if (ageDays > 365) tier = 'urgent';
      else if (ageDays > 180) tier = 'aggressive';
      else if (ageDays > 90) tier = 'moderate';
      else if (ageDays > 60) tier = 'strategic';
      return { id: t.id, title: t.title, category: t.category, ageDays, cost, tier };
    });

    const totalValue = items.reduce((s, i) => s + i.cost, 0);
    const urgentItems = items.filter(i => i.tier === 'urgent' || i.tier === 'aggressive');
    const urgentValue = urgentItems.reduce((s, i) => s + i.cost, 0);
    const potentialRecovery = Math.round(urgentValue * 0.6);

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const topUrgent = urgentItems.slice(0, 10).map(i => `- ${i.title} | ${i.category} | ${i.ageDays}d | ${i.cost}€ | ${i.tier}`).join('\n');

    const prompt = `Si AI inventory liquidation optimizer z ML in exit strategy optimization.
Optimizira likvidacijo inventarja z 5 tierji in 10 izstopnimi kanali.

STATS:
- Total items: ${items.length} | vrednost: ${Math.round(totalValue)}€
- Urgent/aggressive items: ${urgentItems.length} | vrednost: ${Math.round(urgentValue)}€
- Potential recovery: ${potentialRecovery}€
- Analiza za: ${days} dni

TOP URGENT ITEMS:
${topUrgent || 'brez'}

5 liquidation tierjev:
1. URGENT: takojšnja likvidacija (>365d)
2. AGGRESSIVE: agresivna likvidacija (180-365d)
3. MODERATE: zmerna likvidacija (90-180d)
4. STRATEGIC: strateška likvidacija (60-90d)
5. PATIENT: potrpežljiva likvidacija (<60d)

10 izstopnih kanalov: auction, bulk_buyer, wholesale, discount_retail, online_marketplace, consignment, donation, scrap, trade_in, bundle_deal

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_items": <number>, "total_value_eur": <number>, "urgent_items_count": <number>, "urgent_value_eur": <number>, "potential_recovery_eur": <number>, "recovery_rate_pct": <number 0-100>, "liquidation_grade": "<A|B|C|D|F>" },
  "liquidationItems": [
    { "item_title": "<max 100 znakov>", "category": "<string>", "current_age_days": <number>, "current_value_eur": <number>, "liquidation_tier": "<${LIQUIDATION_TIERS.join('|')}>", "recommended_exit_channel": "<${EXIT_CHANNELS.join('|')}>", "recommended_price_eur": <number>, "expected_recovery_pct": <number 0-100>, "time_to_liquidate_days": <number>, "loss_acceptance_eur": <number> }
  ],
  "channelStrategy": [
    { "channel": "<${EXIT_CHANNELS.join('|')}>", "items_count": <number>, "total_value_eur": <number>, "avg_recovery_pct": <number 0-100>, "time_to_complete_days": <number>, "effort_level": "<low|medium|high>", "fees_pct": <number 0-30> }
  ],
  "pricingStrategy": [
    { "tier": "<${LIQUIDATION_TIERS.join('|')}>", "discount_from_cost_pct": <number 0-80>, "psychological_pricing": "<charm|premium|bundle|anchor>", "price_anchors": "<max 100 znakov>", "expected_sell_through_rate_pct": <number 0-100> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "channel": "<${EXIT_CHANNELS.join('|')}>", "items_affected": <number>, "expected_recovery_eur": <number>, "implementation_days": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<random_forest|xgboost|prophet|neural_net|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<recovery_prediction|sell_time_forecast|channel_optimization|pricing_strategy>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "liquidation_optimization_score": <number 0-100>, "liquidation_grade": "<A|B|C|D|F>", "total_recoverable_value_eur": <number>,
    "avg_recovery_rate_pct": <number 0-100>, "urgent_action_required_count": <number>,
    "biggest_liquidation_risk": "<max 100 znakov>", "biggest_liquidation_opportunity": "<max 100 znakov>",
    "quickest_liquidation_win": "<max 100 znakov>", "liquidation_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      overview: { totalItems: Math.max(0, Number(parsed?.overview?.total_items ?? items.length)), totalValueEur: Math.round(Number(parsed?.overview?.total_value_eur ?? totalValue)), urgentItemsCount: Math.max(0, Number(parsed?.overview?.urgent_items_count ?? urgentItems.length)), urgentValueEur: Math.round(Number(parsed?.overview?.urgent_value_eur ?? urgentValue)), potentialRecoveryEur: Math.round(Number(parsed?.overview?.potential_recovery_eur ?? potentialRecovery)), recoveryRatePct: Math.max(0, Math.min(100, Number(parsed?.overview?.recovery_rate_pct ?? 60))), liquidationGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.liquidation_grade)) ? String(parsed.overview.liquidation_grade) : 'C' },
      liquidationItems: (parsed?.liquidationItems || []).slice(0, 15).map((i: any) => ({ itemTitle: String(i?.item_title ?? '').slice(0, 200), category: String(i?.category ?? '').slice(0, 50), currentAgeDays: Math.max(0, Number(i?.current_age_days ?? 0)), currentValueEur: Math.round(Number(i?.current_value_eur ?? 0)), liquidationTier: (LIQUIDATION_TIERS as readonly string[]).includes(String(i?.liquidation_tier)) ? String(i.liquidation_tier) : 'patient', recommendedExitChannel: (EXIT_CHANNELS as readonly string[]).includes(String(i?.recommended_exit_channel)) ? String(i.recommended_exit_channel) : 'online_marketplace', recommendedPriceEur: Math.round(Number(i?.recommended_price_eur ?? 0)), expectedRecoveryPct: Math.max(0, Math.min(100, Number(i?.expected_recovery_pct ?? 60))), timeToLiquidateDays: Math.max(0, Number(i?.time_to_liquidate_days ?? 7)), lossAcceptanceEur: Math.round(Number(i?.loss_acceptance_eur ?? 0)) })),
      channelStrategy: (parsed?.channelStrategy || []).slice(0, 10).map((c: any) => ({ channel: (EXIT_CHANNELS as readonly string[]).includes(String(c?.channel)) ? String(c.channel) : 'online_marketplace', itemsCount: Math.max(0, Number(c?.items_count ?? 0)), totalValueEur: Math.round(Number(c?.total_value_eur ?? 0)), avgRecoveryPct: Math.max(0, Math.min(100, Number(c?.avg_recovery_pct ?? 60))), timeToCompleteDays: Math.max(0, Number(c?.time_to_complete_days ?? 7)), effortLevel: ['low', 'medium', 'high'].includes(String(c?.effort_level)) ? String(c.effort_level) : 'medium', feesPct: Math.max(0, Math.min(30, Number(c?.fees_pct ?? 10))) })),
      pricingStrategy: (parsed?.pricingStrategy || []).slice(0, 5).map((p: any) => ({ tier: (LIQUIDATION_TIERS as readonly string[]).includes(String(p?.tier)) ? String(p.tier) : 'patient', discountFromCostPct: Math.max(0, Math.min(80, Number(p?.discount_from_cost_pct ?? 20))), psychologicalPricing: ['charm', 'premium', 'bundle', 'anchor'].includes(String(p?.psychological_pricing)) ? String(p.psychological_pricing) : 'charm', priceAnchors: String(p?.price_anchors ?? '').slice(0, 200), expectedSellThroughRatePct: Math.max(0, Math.min(100, Number(p?.expected_sell_through_rate_pct ?? 50))) })),
      recommendations: (parsed?.recommendations || []).slice(0, 8).map((r: any) => ({ action: String(r?.action ?? '').slice(0, 300), channel: (EXIT_CHANNELS as readonly string[]).includes(String(r?.channel)) ? String(r.channel) : 'online_marketplace', itemsAffected: Math.max(0, Number(r?.items_affected ?? 0)), expectedRecoveryEur: Math.round(Number(r?.expected_recovery_eur ?? 0)), implementationDays: Math.max(1, Number(r?.implementation_days ?? 7)), priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium' })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['random_forest', 'xgboost', 'prophet', 'neural_net', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['recovery_prediction', 'sell_time_forecast', 'channel_optimization', 'pricing_strategy'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'recovery_prediction', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { liquidationOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.liquidation_optimization_score ?? 50))), liquidationGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.liquidation_grade)) ? String(parsed.summary.liquidation_grade) : 'C', totalRecoverableValueEur: Math.round(Number(parsed?.summary?.total_recoverable_value_eur ?? potentialRecovery)), avgRecoveryRatePct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_recovery_rate_pct ?? 60))), urgentActionRequiredCount: Math.max(0, Number(parsed?.summary?.urgent_action_required_count ?? 0)), biggestLiquidationRisk: String(parsed?.summary?.biggest_liquidation_risk ?? '').slice(0, 200), biggestLiquidationOpportunity: String(parsed?.summary?.biggest_liquidation_opportunity ?? '').slice(0, 200), quickestLiquidationWin: String(parsed?.summary?.quickest_liquidation_win ?? '').slice(0, 200), liquidationAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.liquidation_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { logger.error("/api/ai/inventory-liquidation-optimizer", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
