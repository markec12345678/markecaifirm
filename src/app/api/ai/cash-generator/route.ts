// v6.43: AI Inventory Cash Generator — generira cash iz inventarja z minimalno izgubo
// POST /api/ai/cash-generator
// Body: { targetCash?: number }
// Returns: { ok, generator: { cashPlan, items: [], strategies, projected, summary } }

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
    const targetCash = Math.max(0, Number(body?.targetCash) || 0);

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 50,
    });

    if (heldTrades.length === 0) { return NextResponse.json({ ok: true, generator: null, message: 'Ni held tradeov za cash generation.' }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const items = heldTrades.map(t => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));
      const profitIfSold = estValue - cost;
      const profitPct = cost > 0 ? Math.round((profitIfSold / cost) * 100) : 0;
      return { id: t.id, title: t.title, category: t.category || 'drugo', cost, estValue, daysHeld, profitIfSold, profitPct };
    });

    const totalValue = items.reduce((s, i) => s + i.estValue, 0);
    const totalCost = items.reduce((s, i) => s + i.cost, 0);

    const itemsStr = items.slice(0, 20).map(i => `- [${i.id}] ${i.title} | ${i.category} | cost ${i.cost}€ | est ${i.estValue}€ | profit ${i.profitIfSold}€ (${i.profitPct}%) | ${i.daysHeld}d`).join('\n');

    const prompt = `Si AI cash generation strategist. Generiraj cash iz inventarja z minimalno izgubo dobička.

CILJ: ${targetCash > 0 ? `generiraj ${targetCash}€ cash` : 'maksimiziraj cash brez izgube dobička'}
SKUPna vrednost inventarja: ${Math.round(totalValue)}€ (nabavna ${Math.round(totalCost)}€)

INVENTAR:
${itemsStr}

Cash generation strategije:
1. FAST_SALE: prodaj visokovredne iteme z 5-10% popustom za hiter cash
2. BUNDLE_LIQUIDATION: bundle stalled iteme z 10-15% popustom
3. FLASH_SALE: 24-48h akcija na izbrane iteme (urgentnost)
4. PARTIAL_SELL: prodaj del inventarja, obdrži profitabilne
5. STAGED_SALE: prodaj v 3 valovih (danes, 7d, 14d)
6. RESERVE_SALE: prodaj samo items ki imajo > 20% profit marže
7. PANIC_SALE: likvidiraj vse z minimalnim popustom (samo če nujno)
8. SELECTIVE_LIQUIDATION: prodaj samo stalled/dead iteme, obdrži fresh

Prioriteta: minimalna izguba dobička pri maksimiranju cash flow.

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "cash_plan": [
    {
      "wave": <number 1-3>,
      "timing": "<max 50 znakov>",
      "items_to_sell": <number>,
      "expected_cash_eur": <number>,
      "avg_discount_pct": <number>,
      "profit_retained_pct": <number>,
      "items": [{"id": "<trade_id>", "title": "<naslov>", "sell_price_eur": <number>, "discount_pct": <number>, "profit_eur": <number>, "reason": "<max 60 znakov>"}]
    }
  ],
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "current_est_value_eur": <number>,
      "recommended_sell_price_eur": <number>,
      "discount_pct": <number>,
      "cash_generated_eur": <number>,
      "profit_retained_eur": <number>,
      "urgency": "<high|medium|low>",
      "strategy": "<fast_sale|bundle|flash|partial|staged|reserve|panic|selective>",
      "reasoning": "<max 80 znakov>"
    }
  ],
  "strategies": [
    { "strategy": "<ime>", "description": "<max 100 znakov>", "cash_generated_eur": <number>, "profit_lost_eur": <number>, "time_to_execute_days": <number>, "recommended": <boolean> }
  ],
  "projected": {
    "total_cash_generatable_eur": <number>,
    "total_profit_retained_eur": <number>,
    "total_profit_lost_eur": <number>,
    "profit_retention_pct": <number>,
    "items_remaining_after": <number>,
    "time_to_generate_cash_days": <number>
  },
  "summary": {
    "cash_generation_efficiency": <number 0-100>,
    "best_strategy": "<ime>",
    "fastest_cash_option_eur": <number>,
    "highest_profit_option_eur": <number>,
    "recommended_balance_eur": <number>
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
    const validIds = new Set(items.map(i => i.id));

    const generator = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      cashPlan: (parsed?.cash_plan || []).slice(0, 3).map((w: any) => ({
        wave: Math.max(1, Number(w?.wave ?? 1)), timing: String(w?.timing ?? '').slice(0, 80),
        itemsToSell: Math.max(0, Number(w?.items_to_sell ?? 0)),
        expectedCashEur: Math.round(Number(w?.expected_cash_eur ?? 0)),
        avgDiscountPct: Math.round(Number(w?.avg_discount_pct ?? 0)),
        profitRetainedPct: Math.round(Number(w?.profit_retained_pct ?? 0)),
        items: (w?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).slice(0, 10).map((it: any) => ({
          id: String(it?.id ?? ''), title: String(it?.title ?? '').slice(0, 100),
          sellPriceEur: Math.max(0, Number(it?.sell_price_eur ?? 0)),
          discountPct: Math.round(Number(it?.discount_pct ?? 0)),
          profitEur: Math.round(Number(it?.profit_eur ?? 0)),
          reason: String(it?.reason ?? '').slice(0, 100),
        })),
      })),
      items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).map((it: any) => ({
        tradeId: String(it?.id ?? ''), title: String(it?.title ?? '').slice(0, 100),
        currentEstValueEur: Math.max(0, Number(it?.current_est_value_eur ?? 0)),
        recommendedSellPriceEur: Math.max(0, Number(it?.recommended_sell_price_eur ?? 0)),
        discountPct: Math.round(Number(it?.discount_pct ?? 0)),
        cashGeneratedEur: Math.round(Number(it?.cash_generated_eur ?? 0)),
        profitRetainedEur: Math.round(Number(it?.profit_retained_eur ?? 0)),
        urgency: ['high', 'medium', 'low'].includes(String(it?.urgency)) ? String(it.urgency) : 'medium',
        strategy: ['fast_sale', 'bundle', 'flash', 'partial', 'staged', 'reserve', 'panic', 'selective'].includes(String(it?.strategy)) ? String(it.strategy) : 'fast_sale',
        reasoning: String(it?.reasoning ?? '').slice(0, 200),
      })),
      strategies: (parsed?.strategies || []).slice(0, 6).map((s: any) => ({
        strategy: String(s?.strategy ?? '').slice(0, 80), description: String(s?.description ?? '').slice(0, 200),
        cashGeneratedEur: Math.round(Number(s?.cash_generated_eur ?? 0)),
        profitLostEur: Math.round(Number(s?.profit_lost_eur ?? 0)),
        timeToExecuteDays: Math.max(0, Number(s?.time_to_execute_days ?? 0)),
        recommended: Boolean(s?.recommended ?? false),
      })),
      projected: {
        totalCashGeneratableEur: Math.round(Number(parsed?.projected?.total_cash_generatable_eur ?? 0)),
        totalProfitRetainedEur: Math.round(Number(parsed?.projected?.total_profit_retained_eur ?? 0)),
        totalProfitLostEur: Math.round(Number(parsed?.projected?.total_profit_lost_eur ?? 0)),
        profitRetentionPct: Math.round(Number(parsed?.projected?.profit_retention_pct ?? 0)),
        itemsRemainingAfter: Math.max(0, Number(parsed?.projected?.items_remaining_after ?? 0)),
        timeToGenerateCashDays: Math.max(0, Number(parsed?.projected?.time_to_generate_cash_days ?? 0)),
      },
      summary: {
        cashGenerationEfficiency: Math.max(0, Math.min(100, Number(parsed?.summary?.cash_generation_efficiency ?? 50))),
        bestStrategy: String(parsed?.summary?.best_strategy ?? '').slice(0, 80),
        fastestCashOptionEur: Math.round(Number(parsed?.summary?.fastest_cash_option_eur ?? 0)),
        highestProfitOptionEur: Math.round(Number(parsed?.summary?.highest_profit_option_eur ?? 0)),
        recommendedBalanceEur: Math.round(Number(parsed?.summary?.recommended_balance_eur ?? 0)),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, generator, targetCash });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
