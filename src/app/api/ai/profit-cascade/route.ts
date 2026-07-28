// v6.34: AI Profit Cascade Optimizer — kaskadno optimizira dobiček skozi celotno verigo
// POST /api/ai/profit-cascade
// Body: {}
// Returns: { ok, cascade: { levels, optimizations, totalGain, waterfall } }

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
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 40,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true,
        buyLocation: true, sellLocation: true },
      take: 200,
    });

    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return NextResponse.json({ ok: true, cascade: null, message: 'Ni podatkov za cascade analizo.' });
    }

    const currentProfit = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0), 0);
    const totalHeldValue = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za kaskadno optimizacijo dobička skozi celotno preprodajno verigo.
Analiziraj vsako stopnjo verige in identificiraj kumulativne izboljšave.

TRENUTNO STANJE:
- Realizirani dobiček: ${Math.round(currentProfit)}€
- Vezano v inventarju: ${Math.round(totalHeldValue)}€ (${heldTrades.length} itemov)
- Prodaj: ${soldTrades.length}

KASKADNE STOPINJE (vsaka stopnja vpliva na naslednjo):
1. SOURCING (kje kupovati): boljši vir = nižja nabavna cena → +5-15% dobička
2. NEGOTIATION (cena pri nakupu): -5-10% nabavne cene → +10-20% ROI
3. AI EVALUATION (boljše ocenjevanje): manj slabih nakupov → +5-10% uspešnost
4. HOLDING (optimalen čas držanja): manj holding cost → +3-8% dobička
5. PRICING (optimalna prodajna cena): +5-15% prodajne cene
6. PLATFORM (najboljša platforma): nižje pristojbine → +3-10% neto
7. BUNDLING (bundle strategija): +10-25% na bundle prodaji
8. TIMING (sezonski timing): +5-20% v sezonskem vrhu
9. REFURB (obnova pred prodajo): +15-40% vrednosti za ustrezne iteme
10. REINVESTMENT (pametno reinvestiranje): +10-30% sestavljeni dobiček

Za vsako stopnjo:
1. Trenutna učinkovitost (0-100%)
2. Optimizacijski potencial (€)
3. Konkretna akcija
4. Kumulativni vpliv na dobiček

Odgovori LE z JSON:
{
  "insights": "<max 250 znakov>",
  "levels": [
    {
      "level": <number 1-10>,
      "name": "<ime stopnje>",
      "current_efficiency_pct": <number 0-100>,
      "current_contribution_eur": <number>,
      "optimized_contribution_eur": <number>,
      "gain_eur": <number>,
      "gain_pct": <number>,
      "action": "<max 120 znakov>",
      "tool": "<kateri AI modul uporabiti, max 50 znakov>",
      "difficulty": "<easy|medium|hard>",
      "priority": "<high|medium|low>"
    }
  ],
  "waterfall": [
    { "step": "<ime>", "current_eur": <number>, "optimized_eur": <number>, "cumulative_eur": <number> }
  ],
  "cumulative_gain": {
    "current_total_profit_eur": <number>,
    "optimized_total_profit_eur": <number>,
    "total_gain_eur": <number>,
    "total_gain_pct": <number>
  },
  "quick_wins": [
    { "action": "<max 100 znakov>", "gain_eur": <number>, "effort": "<low|medium|high>", "timeline_days": <number> }
  ],
  "summary": {
    "overall_efficiency_pct": <number>,
    "biggest_opportunity": "<ime stopnje>",
    "total_optimization_potential_eur": <number>,
    "projected_roi_improvement_pct": <number>
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

    const cascade = {
      insights: String(parsed?.insights ?? '').slice(0, 600),
      levels: (parsed?.levels || []).slice(0, 10).map((l: any) => ({
        level: Math.max(1, Math.min(10, Number(l?.level ?? 1))),
        name: String(l?.name ?? '').slice(0, 80),
        currentEfficiencyPct: Math.max(0, Math.min(100, Number(l?.current_efficiency_pct ?? 50))),
        currentContributionEur: Math.round(Number(l?.current_contribution_eur ?? 0)),
        optimizedContributionEur: Math.round(Number(l?.optimized_contribution_eur ?? 0)),
        gainEur: Math.round(Number(l?.gain_eur ?? 0)),
        gainPct: Math.round(Number(l?.gain_pct ?? 0)),
        action: String(l?.action ?? '').slice(0, 250),
        tool: String(l?.tool ?? '').slice(0, 80),
        difficulty: ['easy', 'medium', 'hard'].includes(String(l?.difficulty)) ? String(l.difficulty) : 'medium',
        priority: ['high', 'medium', 'low'].includes(String(l?.priority)) ? String(l.priority) : 'medium',
      })),
      waterfall: (parsed?.waterfall || []).slice(0, 10).map((w: any) => ({
        step: String(w?.step ?? '').slice(0, 80),
        currentEur: Math.round(Number(w?.current_eur ?? 0)),
        optimizedEur: Math.round(Number(w?.optimized_eur ?? 0)),
        cumulativeEur: Math.round(Number(w?.cumulative_eur ?? 0)),
      })),
      cumulativeGain: {
        currentTotalProfitEur: Math.round(Number(parsed?.cumulative_gain?.current_total_profit_eur ?? currentProfit)),
        optimizedTotalProfitEur: Math.round(Number(parsed?.cumulative_gain?.optimized_total_profit_eur ?? 0)),
        totalGainEur: Math.round(Number(parsed?.cumulative_gain?.total_gain_eur ?? 0)),
        totalGainPct: Math.round(Number(parsed?.cumulative_gain?.total_gain_pct ?? 0)),
      },
      quickWins: (parsed?.quick_wins || []).slice(0, 5).map((q: any) => ({
        action: String(q?.action ?? '').slice(0, 200),
        gainEur: Math.round(Number(q?.gain_eur ?? 0)),
        effort: ['low', 'medium', 'high'].includes(String(q?.effort)) ? String(q.effort) : 'medium',
        timelineDays: Math.max(0, Number(q?.timeline_days ?? 7)),
      })),
      summary: {
        overallEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.summary?.overall_efficiency_pct ?? 50))),
        biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 80),
        totalOptimizationPotentialEur: Math.round(Number(parsed?.summary?.total_optimization_potential_eur ?? 0)),
        projectedRoiImprovementPct: Math.round(Number(parsed?.summary?.projected_roi_improvement_pct ?? 0)),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, cascade });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
