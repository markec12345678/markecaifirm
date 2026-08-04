// v5.4: Portfolio AI — globlja analiza Skladišča z AI priporočili (kdaj prodati, kdaj držati)
// GET /api/trades/portfolio-ai
// Returns: { ok, recommendations: Array<{ trade, action, reasoning, suggestedSellPrice?, urgency }>, portfolioSummary }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  try {
    // Get all held trades (items in inventory)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      include: {
        listing: {
          select: {
            id: true, title: true, price: true, url: true,
            aiVerdict: true, aiScore: true, aiRisk: true,
            aiEstimatedValue: true, dealScore: true,
            firstSeenAt: true, priceDroppedAt: true, previousPrice: true,
            monitor: { select: { source: true } },
          },
        },
      },
      orderBy: { buyDate: 'desc' },
      take: 50,
    });

    // Get sold trades for history/metrics
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: {
        buyPrice: true, buyFees: true, sellPrice: true, sellFees: true,
        buyDate: true, sellDate: true, category: true, title: true,
      },
      take: 100,
    });

    // Calculate portfolio metrics
    const totalInvested = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalHeld = heldTrades.length;
    const realizedProfit = soldTrades.reduce((s, t) =>
      s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);

    // Category breakdown
    const byCategory: Record<string, { count: number; invested: number; avgDays: number }> = {};
    for (const t of heldTrades) {
      const cat = t.category || 'brez kategorije';
      if (!byCategory[cat]) byCategory[cat] = { count: 0, invested: 0, avgDays: 0 };
      byCategory[cat].count++;
      byCategory[cat].invested += t.buyPrice + (t.buyFees ?? 0);
    }

    // Days held for each trade
    const now = new Date();
    const tradesWithMetrics = heldTrades.map(t => {
      const daysHeld = Math.round((now.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      const totalCost = t.buyPrice + (t.buyFees ?? 0);
      return { ...t, daysHeld, totalCost };
    });

    if (tradesWithMetrics.length === 0) {
      return NextResponse.json({
        ok: true,
        recommendations: [],
        portfolioSummary: {
          totalInvested: 0,
          totalHeld: 0,
          realizedProfit,
          avgDaysHeld: 0,
          byCategory: {},
        },
        message: 'Ni tradeov v skladišču. Dodaj trade v Skladišče zavihku.',
      });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '',
      fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // Build AI prompt for portfolio analysis
    const prompt = buildPortfolioPrompt(tradesWithMetrics, soldTrades, {
      totalInvested,
      totalHeld,
      realizedProfit,
      byCategory,
    });

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fallbackSettings: AiSettings = {
          provider: aiSettings.fallbackProvider,
          baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '',
          model: aiSettings.fallbackModel,
        };
        raw = await callProviderForRaw(fallbackSettings, prompt);
      } else {
        throw primaryError;
      }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const recommendations = (parsed?.recommendations || []).map((r: any, i: number) => ({
      tradeId: tradesWithMetrics[i]?.id ?? '',
      title: tradesWithMetrics[i]?.title ?? '',
      action: r?.action ?? 'hold', // sell | hold | reduce | monitor
      reasoning: String(r?.reasoning ?? '').slice(0, 500),
      suggestedSellPrice: r?.suggested_sell_price ?? null,
      urgency: r?.urgency ?? 'low', // high | medium | low
      daysHeld: tradesWithMetrics[i]?.daysHeld ?? 0,
      buyPrice: tradesWithMetrics[i]?.buyPrice ?? 0,
    }));

    const portfolioSummary = {
      totalInvested,
      totalHeld,
      realizedProfit,
      avgDaysHeld: Math.round(tradesWithMetrics.reduce((s, t) => s + t.daysHeld, 0) / tradesWithMetrics.length),
      byCategory,
      aiOverview: String(parsed?.portfolio_overview ?? '').slice(0, 1000),
      aiStrategy: String(parsed?.strategy_recommendation ?? '').slice(0, 500),
    };

    // Increment AI usage counter
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({
        where: { id: 'singleton' },
        data: { aiCallsDate: today, aiCallsToday: 1 },
      });
    } else {
      await db.settings.update({
        where: { id: 'singleton' },
        data: { aiCallsToday: { increment: 1 } },
      });
    }

    return NextResponse.json({
      ok: true,
      recommendations,
      portfolioSummary,
      generatedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    logger.error("/api/trades/portfolio-ai", "GET handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka pri AI analizi portfolia' }, { status: 500 });
  }
}

function buildPortfolioPrompt(heldTrades: any[], soldTrades: any[], metrics: any): string {
  const lines: string[] = [
    'Si ekspert za upravljanje portfolia (skladišča) kupljenih oglasov na slovenskih spletnih oglasih.',
    'Analiziraj vsak trade v skladišču in predlagaj akcijo: sell (prodaj), hold (drži), reduce (znižaj ceno), monitor (spremljaj).',
    '',
    `*Skupna investicija:* ${metrics.totalInvested}€`,
    `*Tradeov v skladišču:* ${metrics.totalHeld}`,
    `*Realizirani dobiček:* ${metrics.realizedProfit}€`,
    `*Prodanov v preteklosti:* ${soldTrades.length}`,
    '',
    '*Tradei v skladišču:*',
  ];

  heldTrades.forEach((t, i) => {
    lines.push(`--- Trade #${i + 1} ---`);
    lines.push(`Naslov: ${t.title}`);
    lines.push(`Kupna cena: ${t.buyPrice}€ (skupaj ${t.totalCost}€ s pristojbinami)`);
    lines.push(`Kategorija: ${t.category || 'brez'}`);
    lines.push(`Kupljeno: ${t.buyDate.toLocaleDateString('sl-SI')} (${t.daysHeld} dni nazaj)`);
    if (t.listing?.aiEstimatedValue) {
      lines.push(`AI tržna vrednost: ${t.listing.aiEstimatedValue}€`);
    }
    if (t.listing?.aiVerdict) {
      lines.push(`AI verdikt ob nakupu: ${t.listing.aiVerdict}`);
    }
    if (t.listing?.dealScore) {
      lines.push(`Deal score: ${t.listing.dealScore}/100`);
    }
    if (t.listing?.priceDroppedAt) {
      lines.push(`Cena je po nakupu še padla`);
    }
    lines.push('');
  });

  lines.push('Pravila za analizo:');
  lines.push('1. Trade star > 60 dni = povečana nujnost prodaje (stari inventar)');
  lines.push('2. Če AI tržna vrednost > kupna cena + 20% = predlagaj prodajo');
  lines.push('3. Če AI tržna vrednost < kupna cena = predlagaj hold ali reduce');
  lines.push('4. Trade star < 14 dni = verjetno hold (prehitro za prodajo)');
  lines.push('5. Predlagaj konkretne prodajne cene (suggested_sell_price)');
  lines.push('6. Urgency: high (prodaj čimprej), medium (v naslednjih 2 tednih), low (drži)');
  lines.push('', 'Odgovori LE z JSON:');
  lines.push('{');
  lines.push('  "portfolio_overview": "<1-2 stavka o stanju portfolia>",');
  lines.push('  "strategy_recommendation": "<splošna strategija: agresivno prodajaj / drži / mix>",');
  lines.push('  "recommendations": [');
  lines.push('    {');
  lines.push('      "action": "<sell|hold|reduce|monitor>",');
  lines.push('      "reasoning": "<kratek razlog, max 200 znakov>",');
  lines.push('      "suggested_sell_price": <number EUR ali null>,');
  lines.push('      "urgency": "<high|medium|low>"');
  lines.push('    }');
  lines.push('    ... (za vsak trade v istem vrstnem redu)');
  lines.push('  ]');
  lines.push('}');

  return lines.join('\n');
}
