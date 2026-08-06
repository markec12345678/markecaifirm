// v7.45: Loss Recovery Playbook — ko izgubiš denar, AI analizira zakaj.
//
// Analizira vse losing trades (profit < 0) in identificira vzorce:
// - Preveč plačano (buyPrice > estValue)?
// - Predolgo držano (depreciation)?
// - Slaba kategorija (nizek ROI)?
// - Slab prodajalec (high risk)?
// → AI predlaga kako se izogniti podobnim izgubam
//
// GET /api/ai/loss-recovery-playbook

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function GET() {
  try {
    // Get all losing trades
    const losingTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: {
        id: true, title: true, category: true,
        buyPrice: true, buyFees: true, sellPrice: true, sellFees: true,
        buyDate: true, sellDate: true, notes: true,
        listing: {
          select: {
            aiVerdict: true, aiScore: true, aiRisk: true,
            aiEstimatedValue: true, dealScore: true, sellerName: true,
          },
        },
      },
      take: 200,
    });

    // Filter to only losses
    const losses = losingTrades.map(t => {
      const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
      return { ...t, profit };
    }).filter(t => t.profit < 0);

    if (losses.length === 0) {
      return NextResponse.json({
        ok: true,
        losses: [],
        message: '🎉 Nobenih izgub! Vsi prodani trade-i so bili profitable.',
      });
    }

    // Compute patterns
    const totalLoss = losses.reduce((s, t) => s + t.profit, 0);
    const avgLoss = Math.round(totalLoss / losses.length);

    // Pattern 1: Overpaid (buyPrice > estValue)
    const overpaid = losses.filter(t => t.listing?.aiEstimatedValue && t.buyPrice > t.listing.aiEstimatedValue);

    // Pattern 2: Held too long (sell - buy > 45 days)
    const heldTooLong = losses.filter(t => {
      if (!t.sellDate) return false;
      const days = (new Date(t.sellDate).getTime() - new Date(t.buyDate).getTime()) / 86400000;
      return days > 45;
    });

    // Pattern 3: High risk listings (aiRisk >= 6)
    const highRisk = losses.filter(t => (t.listing?.aiRisk ?? 0) >= 6);

    // Pattern 4: Category concentration
    const lossByCategory = new Map<string, { count: number; loss: number }>();
    for (const t of losses) {
      const cat = t.category || 'drugo';
      const cur = lossByCategory.get(cat) || { count: 0, loss: 0 };
      cur.count += 1;
      cur.loss += t.profit;
      lossByCategory.set(cat, cur);
    }
    const worstCategories = Array.from(lossByCategory.entries())
      .map(([cat, d]) => ({ category: cat, count: d.count, totalLoss: Math.round(d.loss), avgLoss: Math.round(d.loss / d.count) }))
      .sort((a, b) => a.totalLoss - b.totalLoss);

    // Pattern 5: Seller recurrence
    const lossBySeller = new Map<string, { count: number; loss: number }>();
    for (const t of losses) {
      const seller = t.listing?.sellerName;
      if (!seller) continue;
      const cur = lossBySeller.get(seller) || { count: 0, loss: 0 };
      cur.count += 1;
      cur.loss += t.profit;
      lossBySeller.set(seller, cur);
    }
    const worstSellers = Array.from(lossBySeller.entries())
      .map(([seller, d]) => ({ seller, count: d.count, totalLoss: Math.round(d.loss) }))
      .sort((a, b) => a.totalLoss - b.totalLoss)
      .slice(0, 5);

    // AI analysis
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za analizo izgub pri preprodaji rabljenih dobrin.

Analiziraj te IZGUBNE trade-e in identificiraj vzorce:

IZGUBNI TRADE-I (${losses.length}):
${losses.map(t => `- ${t.title} | nabava ${t.buyPrice}€ | prodaja ${t.sellPrice}€ | izguba ${t.profit}€ | kategorija ${t.category} | AI risk ${t.listing?.aiRisk ?? '?'}/10 | est. vrednost ${t.listing?.aiEstimatedValue ?? '?'}€ | deal score ${t.listing?.dealScore ?? '?'}`).join('\n')}

VZORCI:
- Preveč plačano (buyPrice > estValue): ${overpaid.length} od ${losses.length}
- Predolgo držano (>45 dni): ${heldTooLong.length} od ${losses.length}
- Visoko tveganje (aiRisk >= 6): ${highRisk.length} od ${losses.length}
- Najslabše kategorije: ${worstCategories.slice(0, 3).map(c => `${c.category} (${c.totalLoss}€)`).join(', ')}
- Najslabši prodajalci: ${worstSellers.map(s => `${s.seller} (${s.totalLoss}€)`).join(', ')}

NALOGA:
1. Identificiraj TOP 3 vzroke izgub
2. Za vsak vzrok daj konkretno preprečevalno akcijo
3. Predlagaj pravila za preprečevanje v prihodnje

Odgovori LE z JSON:
{
  "top_causes": [
    { "cause": "<vzrok>", "frequency": "<pogost>", "impact_eur": <number>, "prevention": "<kako preprečiti>" }
  ],
  "rules": [
    "<pravilo 1 za preprečevanje>",
    "<pravilo 2>",
    "<pravilo 3>"
  ],
  "summary": "<2 stavka povzetek>"
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else {
        return NextResponse.json({
          ok: true,
          losses: losses.map(l => ({ title: l.title, loss: l.profit, category: l.category })),
          totalLoss: Math.round(totalLoss),
          avgLoss,
          patterns: { overpaid: overpaid.length, heldTooLong: heldTooLong.length, highRisk: highRisk.length },
          worstCategories,
          worstSellers,
          topCauses: [],
          rules: [
            'Preverjaj Sold Comps pred nakupom — ne plačuj več kot fair market value',
            'Ne drži item-ov >45 dni — znižaj ceno ali likvidiraj',
            'Ne kupuj od prodajalcev z aiRisk >= 6',
          ],
          summary: 'AI ni na voljo — priporočila iz vzorcev izgub.',
        });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);

    return NextResponse.json({
      ok: true,
      totalLosses: losses.length,
      totalLossEur: Math.round(totalLoss),
      avgLossEur: avgLoss,
      patterns: {
        overpaid: overpaid.length,
        heldTooLong: heldTooLong.length,
        highRisk: highRisk.length,
        overpaidPct: Math.round((overpaid.length / losses.length) * 100),
        heldTooLongPct: Math.round((heldTooLong.length / losses.length) * 100),
        highRiskPct: Math.round((highRisk.length / losses.length) * 100),
      },
      worstCategories,
      worstSellers,
      topCauses: (parsed?.top_causes || []).slice(0, 5).map((c: any) => ({
        cause: String(c?.cause ?? '').slice(0, 200),
        frequency: String(c?.frequency ?? '').slice(0, 50),
        impactEur: Math.round(Number(c?.impact_eur ?? 0)),
        prevention: String(c?.prevention ?? '').slice(0, 300),
      })),
      rules: (parsed?.rules || []).slice(0, 10).map((r: any) => String(r).slice(0, 300)),
      summary: String(parsed?.summary ?? '').slice(0, 400),
      losingTrades: losses.slice(0, 10).map(l => ({
        title: l.title,
        category: l.category,
        buyPrice: l.buyPrice,
        sellPrice: l.sellPrice,
        loss: Math.round(l.profit),
        aiRisk: l.listing?.aiRisk,
        estValue: l.listing?.aiEstimatedValue,
      })),
    });
  } catch (err: any) {
    logger.error('/api/ai/loss-recovery-playbook', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
