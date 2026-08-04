// v6.9: AI Portfolio Rebalancing — AI predlaga kako prerazporediti investicije
// POST /api/ai/rebalance
// Body: { totalBudget?: number }
// Returns: { ok, actions: Array<{ action, category, current, suggested, reason }>, strategy }

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
    const body = await req.json().catch(() => ({}));
    const totalBudget = Number(body?.totalBudget) || 0;

    // Get current portfolio state
    const [heldTrades, soldTrades] = await Promise.all([
      db.trade.findMany({
        where: { status: 'held' },
        select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
          listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      }),
      db.trade.findMany({
        where: { status: 'sold', sellPrice: { not: null } },
        select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      }),
    ]);

    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return NextResponse.json({ ok: true, actions: [], message: 'Ni tradeov za analizo.' });
    }

    // Current allocation
    const currentByCat: Record<string, { invested: number; count: number }> = {};
    for (const t of heldTrades) {
      const cat = t.category || 'drugo';
      if (!currentByCat[cat]) currentByCat[cat] = { invested: 0, count: 0 };
      currentByCat[cat].invested += t.buyPrice + (t.buyFees ?? 0);
      currentByCat[cat].count++;
    }

    // Performance by category
    const perfByCat: Record<string, { sold: number; profit: number; roi: number; avgDays: number }> = {};
    for (const t of soldTrades) {
      const cat = t.category || 'drugo';
      if (!perfByCat[cat]) perfByCat[cat] = { sold: 0, profit: 0, roi: 0, avgDays: 0 };
      perfByCat[cat].sold++;
      const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
      perfByCat[cat].profit += profit;
      if (t.sellDate && t.buyDate) {
        perfByCat[cat].avgDays += Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      }
    }
    for (const cat of Object.keys(perfByCat)) {
      const s = perfByCat[cat];
      const totalCost = soldTrades.filter(t => (t.category || 'drugo') === cat).reduce((sum, t) => sum + t.buyPrice + (t.buyFees ?? 0), 0);
      s.roi = totalCost > 0 ? Math.round((s.profit / totalCost) * 100) : 0;
      s.avgDays = s.sold > 0 ? Math.round(s.avgDays / s.sold) : 0;
    }

    const totalInvested = Object.values(currentByCat).reduce((s, c) => s + c.invested, 0);

    // AI rebalancing
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za upravljanje portfolia pri preprodaji na slovenskih oglasih.
Predlagaj rebalancing portfolia za maksimalni dobiček in zmanjšanje tveganja.

Trenutna alokacija (held):
${Object.entries(currentByCat).map(([cat, c]) => `- ${cat}: ${c.invested}€ (${c.count} itemov, ${Math.round((c.invested / Math.max(1, totalInvested)) * 100)}%)`).join('\n')}

Zgodovinska uspešnost (sold):
${Object.entries(perfByCat).map(([cat, p]) => `- ${cat}: ${p.sold} prodaj, ${p.profit}€ dobička, ${p.roi}% ROI, ${p.avgDays}d povp. prodaja`).join('\n')}

Skupna investicija: ${totalInvested}€
${totalBudget > 0 ? `Na voljo novih sredstev: ${totalBudget}€` : ''}

Pravila:
1. Kategorije z ROI > 30% — povečaj alokacijo
2. Kategorije z ROI < 0% — zmanjšaj ali zapusti
3. Kategorije z > 30d povp. prodaja — zmanjšaj (nizka likvidnost)
4. Diverzifikacija: nobena kategorija naj ne presega 50% portfolia
5. Rezerviraj 15% za nove priložnosti

Za vsako kategorijo predlagaj: action (buy_more/reduce/hold/exit), target allocation %, reason.

Odgovori LE z JSON:
{
  "strategy": "<splošna strategija, max 200 znakov>",
  "actions": [
    {
      "category": "<kategorija>",
      "action": "<buy_more|reduce|hold|exit>",
      "current_pct": <number>,
      "suggested_pct": <number>,
      "reason": "<kratek razlog, max 100 znakov>"
    }
  ]
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const actions = (parsed?.actions || []).map((a: any) => ({
      category: String(a?.category ?? ''),
      action: String(a?.action ?? 'hold'),
      currentPct: Number(a?.current_pct ?? 0),
      suggestedPct: Number(a?.suggested_pct ?? 0),
      reason: String(a?.reason ?? '').slice(0, 200),
    }));

    // Increment AI usage
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      actions,
      strategy: String(parsed?.strategy ?? '').slice(0, 500),
      currentAllocation: Object.entries(currentByCat).map(([cat, c]) => ({
        category: cat, invested: c.invested, count: c.count, pct: Math.round((c.invested / Math.max(1, totalInvested)) * 100),
      })),
      performance: Object.entries(perfByCat).map(([cat, p]) => ({ category: cat, ...p })),
      totalInvested,
      totalBudget,
    });
  } catch (e: any) {
    logger.error("/api/ai/rebalance", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
