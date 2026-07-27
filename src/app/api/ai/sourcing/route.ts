// v6.10: AI Sourcing Recommendations — AI predlaga kje/kdaj/kako najti profitne inventarje
// POST /api/ai/sourcing
// Body: { budget?: number, category?: string }
// Returns: { ok, recommendations: Array<{ source, category, timing, expectedROI, risk, action, reason }>, insights }

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
    const budget = Number(body?.budget) || 0;
    const categoryFilter = String(body?.category || '').trim();

    // 1. Pridobi vse sold tradeove za analizo profitabilnosti po viru/kategoriji
    const [soldTrades, heldTrades, recentListings] = await Promise.all([
      db.trade.findMany({
        where: { status: 'sold', sellPrice: { not: null } },
        select: {
          title: true, category: true, buyPrice: true, buyFees: true,
          sellPrice: true, sellFees: true, sellDate: true, buyDate: true,
          buyLocation: true, sellLocation: true,
        },
      }),
      db.trade.findMany({
        where: { status: 'held' },
        select: { title: true, category: true, buyPrice: true, buyLocation: true, buyDate: true },
      }),
      db.listing.findMany({
        where: {
          isHidden: false,
          firstSeenAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        },
        select: {
          title: true, price: true, aiVerdict: true, aiScore: true,
          dealScore: true, firstSeenAt: true, monitor: { select: { source: true } },
        },
        take: 500,
        orderBy: { firstSeenAt: 'desc' },
      }),
    ]);

    if (soldTrades.length === 0 && recentListings.length === 0) {
      return NextResponse.json({
        ok: true,
        recommendations: [],
        message: 'Ni dovolj podatkov za analizo (potrebne vsaj nekatere prodaje ali nedavne oglase).',
      });
    }

    // 2. Analiza po viru nakupa
    const bySource: Record<string, { count: number; profit: number; cost: number; avgDays: number }> = {};
    for (const t of soldTrades) {
      const src = (t.buyLocation || 'neznan').toLowerCase();
      if (!bySource[src]) bySource[src] = { count: 0, profit: 0, cost: 0, avgDays: 0 };
      bySource[src].count++;
      bySource[src].profit += (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
      bySource[src].cost += t.buyPrice + (t.buyFees ?? 0);
      if (t.sellDate && t.buyDate) {
        bySource[src].avgDays += Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      }
    }
    for (const s of Object.keys(bySource)) {
      bySource[s].avgDays = bySource[s].count > 0 ? Math.round(bySource[s].avgDays / bySource[s].count) : 0;
    }

    // 3. Analiza po kategoriji
    const byCategory: Record<string, { count: number; profit: number; cost: number; avgDays: number; held: number }> = {};
    for (const t of soldTrades) {
      const cat = t.category || 'drugo';
      if (categoryFilter && cat !== categoryFilter) continue;
      if (!byCategory[cat]) byCategory[cat] = { count: 0, profit: 0, cost: 0, avgDays: 0, held: 0 };
      byCategory[cat].count++;
      byCategory[cat].profit += (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
      byCategory[cat].cost += t.buyPrice + (t.buyFees ?? 0);
      if (t.sellDate && t.buyDate) {
        byCategory[cat].avgDays += Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      }
    }
    for (const t of heldTrades) {
      const cat = t.category || 'drugo';
      if (categoryFilter && cat !== categoryFilter) continue;
      if (!byCategory[cat]) byCategory[cat] = { count: 0, profit: 0, cost: 0, avgDays: 0, held: 0 };
      byCategory[cat].held++;
    }
    for (const c of Object.keys(byCategory)) {
      byCategory[c].avgDays = byCategory[c].count > 0 ? Math.round(byCategory[c].avgDays / byCategory[c].count) : 0;
    }

    // 4. Analiza nedavnih oglasov — kje so se pojavile priložnosti
    const recentBySource: Record<string, { total: number; opportunities: number; avgPrice: number; avgScore: number }> = {};
    for (const l of recentListings) {
      const src = l.monitor?.source || 'neznan';
      if (!recentBySource[src]) recentBySource[src] = { total: 0, opportunities: 0, avgPrice: 0, avgScore: 0 };
      recentBySource[src].total++;
      if (l.aiVerdict === 'PRILIKA' || (l.dealScore ?? 0) >= 70) recentBySource[src].opportunities++;
      recentBySource[src].avgPrice += l.price ?? 0;
      recentBySource[src].avgScore += l.dealScore ?? l.aiScore ?? 0;
    }
    for (const s of Object.keys(recentBySource)) {
      const r = recentBySource[s];
      r.avgPrice = r.total > 0 ? Math.round(r.avgPrice / r.total) : 0;
      r.avgScore = r.total > 0 ? Math.round(r.avgScore / r.total) : 0;
    }

    // 5. AI analiza
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za sourcing inventarja za preprodajo na slovenskem trgu.
Predlagaj, KJE, KDAJ in KAJ kupovati za maksimalni dobiček.

Zgodovinska uspešnost po viru nakupa:
${Object.entries(bySource).map(([src, s]) => {
  const roi = s.cost > 0 ? Math.round((s.profit / s.cost) * 100) : 0;
  return `- ${src}: ${s.count} prodaj, ${s.profit}€ dobička, ${roi}% ROI, ${s.avgDays}d povp. držanja`;
}).join('\n')}

Zgodovinska uspešnost po kategoriji:
${Object.entries(byCategory).map(([cat, c]) => {
  const roi = c.cost > 0 ? Math.round((c.profit / c.cost) * 100) : 0;
  return `- ${cat}: ${c.count} prodaj, ${c.profit}€ dobička, ${roi}% ROI, ${c.avgDays}d prodaja, ${c.held} v skladišču`;
}).join('\n')}

Nedavne priložnosti (zadnjih 14 dni):
${Object.entries(recentBySource).map(([src, r]) => {
  const rate = r.total > 0 ? Math.round((r.opportunities / r.total) * 100) : 0;
  return `- ${src}: ${r.total} oglasov, ${r.opportunities} priložnosti (${rate}%), ${r.avgPrice}€ povp. cena, ${r.avgScore}/100 povp. deal score`;
}).join('\n')}

${budget > 0 ? `Na voljo budget: ${budget}€` : 'Budget ni specificiran.'}
${categoryFilter ? `Filter kategorije: ${categoryFilter}` : ''}

Pravila:
1. Priporočaj vire z najvišjim ROI in hitro prodajo
2. Identificiraj časovna okna (urov/dneve/mesece) kdaj se pojavijo najboljše priložnosti
3. Opozori na kategorije z nizko likvidnostjo (>30 dni prodaja)
4. Predlagaj kategorije za diverzifikacijo
5. Upoštevaj trend priložnosti v zadnjih 14 dneh

Za vsako priporočilo podaj:
- source: kje iskati (bolha/nepremicnine/avtonet/vinted/fb/...)
- category: kaj iskati
- timing: kdaj iskati (urov/dan/teden/mesec)
- expectedROI: pričakovan ROI %
- risk: 1-10 (1=varno, 10=tvegano)
- action: konkretno dejanje (npr. "postavi monitor s ključnimi besedami X vsak dan ob 7h")
- reason: kratek razlog

Odgovori LE z JSON:
{
  "insights": "<splošne ugotovitve, max 300 znakov>",
  "recommendations": [
    {
      "source": "<vir>",
      "category": "<kategorija>",
      "timing": "<kdaj>",
      "expected_roi": <number>,
      "risk": <number>,
      "action": "<konkretno dejanje, max 150 znakov>",
      "reason": "<razlog, max 100 znakov>"
    }
  ]
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = {
          provider: aiSettings.fallbackProvider,
          baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '',
          model: aiSettings.fallbackModel,
        };
        raw = await callProviderForRaw(fb, prompt);
      } else {
        return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const recommendations = (parsed?.recommendations || []).map((r: any) => ({
      source: String(r?.source ?? '').slice(0, 50),
      category: String(r?.category ?? '').slice(0, 50),
      timing: String(r?.timing ?? '').slice(0, 100),
      expectedROI: Math.max(0, Math.min(500, Number(r?.expected_roi ?? 0))),
      risk: Math.max(1, Math.min(10, Number(r?.risk ?? 5))),
      action: String(r?.action ?? '').slice(0, 200),
      reason: String(r?.reason ?? '').slice(0, 200),
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
      insights: String(parsed?.insights ?? '').slice(0, 500),
      recommendations,
      stats: {
        bySource: Object.entries(bySource).map(([src, s]) => ({
          source: src, count: s.count, profit: Math.round(s.profit),
          roi: s.cost > 0 ? Math.round((s.profit / s.cost) * 100) : 0,
          avgDays: s.avgDays,
        })),
        byCategory: Object.entries(byCategory).map(([cat, c]) => ({
          category: cat, count: c.count, profit: Math.round(c.profit),
          roi: c.cost > 0 ? Math.round((c.profit / c.cost) * 100) : 0,
          avgDays: c.avgDays, held: c.held,
        })),
        recentOpportunities: Object.entries(recentBySource).map(([src, r]) => ({
          source: src, total: r.total, opportunities: r.opportunities,
          rate: r.total > 0 ? Math.round((r.opportunities / r.total) * 100) : 0,
          avgPrice: r.avgPrice, avgScore: r.avgScore,
        })),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
