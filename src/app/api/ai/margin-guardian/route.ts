// v6.37: AI Profit Margin Guardian — kontinuirano ščiti dobičkovno maržo pred erozijo
// POST /api/ai/margin-guardian
// Body: {}
// Returns: { ok, guardian: { currentMargins, threats, protections, items: [], actions, summary } }

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
        listing: { select: { aiEstimatedValue: true, dealScore: true, previousPrice: true, priceDroppedAt: true } } },
      take: 40,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, buyDate: true, sellDate: true },
      take: 300,
    });

    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return NextResponse.json({ ok: true, guardian: null, message: 'Ni podatkov za margin guardian.' });
    }

    // Izračunaj marže
    const heldWithMargins = heldTrades.map(t => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const margin = estValue - cost;
      const marginPct = cost > 0 ? Math.round((margin / estValue) * 100) : 0;
      const roiPct = cost > 0 ? Math.round((margin / cost) * 100) : 0;
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));
      return { id: t.id, title: t.title, category: t.category || 'drugo', cost, estValue, margin, marginPct, roiPct, daysHeld,
        hasPriceDropped: !!t.listing?.priceDroppedAt, prevPrice: t.listing?.previousPrice };
    });

    const avgMarginPct = heldWithMargins.length > 0 ? Math.round(heldWithMargins.reduce((s, i) => s + i.marginPct, 0) / heldWithMargins.length) : 0;
    const lowMarginCount = heldWithMargins.filter(i => i.marginPct < 15).length;
    const negativeMarginCount = heldWithMargins.filter(i => i.margin <= 0).length;

    const soldAvgMargin = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => {
      const cost = t.buyPrice + (t.buyFees ?? 0); const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      return s + (rev > 0 ? ((rev - cost) / rev) * 100 : 0);
    }, 0) / soldTrades.length) : 0;

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const itemsStr = heldWithMargins.slice(0, 15).map(i => `- [${i.id}] ${i.title} | ${i.category} | cost ${i.cost}€ → est ${i.estValue}€ | margin ${i.marginPct}% (${i.margin}€) | ROI ${i.roiPct}% | ${i.daysHeld}d${i.hasPriceDropped ? ` | padec: ${i.prevPrice}€` : ''}`).join('\n');

    const prompt = `Si AI profit margin guardian — ščiti dobičkovno maržo pred erozijo.
Analiziraj marže vseh held itemov in identificiraj tveganja za zmanjšanje dobička.

TRENUTNO STANJE:
- Povp. marža held: ${avgMarginPct}%
- Nizka marža (<15%): ${lowMarginCount} itemov
- Negativna marža: ${negativeMarginCount} itemov
- Povp. marža prodanih: ${soldAvgMargin}%

INVENTAR Z MARŽAMI:
${itemsStr}

Margin erosion faktorji:
1. HOLDING_COST: 0.5%/teden → po 60d = 4% marže poje
2. PRICE_DROP: vsak padec cene 5% = 5% manj marže
3. PLATFORM_FEES: Bolha 0%, Vinted 5%, eBay 10% → direktno iz marže
4. SHIPPING: 10-20€ na item → če ne vključeno v ceno
5. DEPRECIATION: elektronika 2.5%/mesec → cenejši vsak mesec
6. COMPETITION: konkurenca podre ceno → tudi moraš
7. SEASONAL: izven sezone → cene nižje
8. NEGOTIATION: kupec zahteva popust → -5-15% marže

Marža nivoji:
- HEALTHY: >30% — odlično, vzdržuj
- OK: 15-30% — spremljaj
- THIN: 5-15% — tveganje, ukrepaj
- NEGATIVE: <5% — kritično, takoj ukrepaj

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current_margins": {
    "avg_margin_pct": <number>,
    "avg_roi_pct": <number>,
    "healthy_count": <number>,
    "ok_count": <number>,
    "thin_count": <number>,
    "negative_count": <number>,
    "total_margin_at_risk_eur": <number>
  },
  "threats": [
    {
      "type": "<holding_cost|price_drop|platform_fees|shipping|depreciation|competition|seasonal|negotiation>",
      "severity": "<critical|high|medium|low>",
      "affected_items": <number>,
      "estimated_margin_erosion_pct": <number>,
      "estimated_loss_eur": <number>,
      "mitigation": "<max 100 znakov>"
    }
  ],
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "current_margin_pct": <number>,
      "margin_status": "<healthy|ok|thin|negative>",
      "projected_margin_30d_pct": <number>,
      "projected_margin_60d_pct": <number>,
      "main_threat": "<max 80 znakov>",
      "protection_action": "<max 100 znakov>",
      "min_acceptable_price_eur": <number>,
      "reasoning": "<max 80 znakov>"
    }
  ],
  "protections": [
    { "strategy": "<max 100 znakov>", "margin_saved_pct": <number>, "items_protected": <number>, "implementation": "<max 80 znakov>" }
  ],
  "actions": [
    { "action": "<max 120 znakov>", "priority": "<critical|high|medium|low>", "margin_impact_pct": <number>, "items_affected": <number> }
  ],
  "summary": {
    "overall_margin_health": "<healthy|ok|at_risk|critical>",
    "margin_protection_score": <number 0-100>,
    "biggest_threat": "<max 50 znakov>",
    "total_projected_erosion_30d_eur": <number>,
    "total_protectable_margin_eur": <number>
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
    const validIds = new Set(heldWithMargins.map(i => i.id));

    const guardian = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      currentMargins: {
        avgMarginPct: Math.round(Number(parsed?.current_margins?.avg_margin_pct ?? avgMarginPct)),
        avgRoiPct: Math.round(Number(parsed?.current_margins?.avg_roi_pct ?? 0)),
        healthyCount: Math.max(0, Number(parsed?.current_margins?.healthy_count ?? 0)),
        okCount: Math.max(0, Number(parsed?.current_margins?.ok_count ?? 0)),
        thinCount: Math.max(0, Number(parsed?.current_margins?.thin_count ?? 0)),
        negativeCount: Math.max(0, Number(parsed?.current_margins?.negative_count ?? 0)),
        totalMarginAtRiskEur: Math.round(Number(parsed?.current_margins?.total_margin_at_risk_eur ?? 0)),
      },
      threats: (parsed?.threats || []).slice(0, 8).map((t: any) => ({
        type: String(t?.type ?? '').slice(0, 50),
        severity: ['critical', 'high', 'medium', 'low'].includes(String(t?.severity)) ? String(t.severity) : 'medium',
        affectedItems: Math.max(0, Number(t?.affected_items ?? 0)),
        estimatedMarginErosionPct: Math.round(Number(t?.estimated_margin_erosion_pct ?? 0)),
        estimatedLossEur: Math.round(Number(t?.estimated_loss_eur ?? 0)),
        mitigation: String(t?.mitigation ?? '').slice(0, 200),
      })),
      items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).map((it: any) => ({
        tradeId: String(it?.id ?? ''),
        title: String(it?.title ?? '').slice(0, 150),
        currentMarginPct: Math.round(Number(it?.current_margin_pct ?? 0)),
        marginStatus: ['healthy', 'ok', 'thin', 'negative'].includes(String(it?.margin_status)) ? String(it.margin_status) : 'ok',
        projectedMargin30dPct: Math.round(Number(it?.projected_margin_30d_pct ?? 0)),
        projectedMargin60dPct: Math.round(Number(it?.projected_margin_60d_pct ?? 0)),
        mainThreat: String(it?.main_threat ?? '').slice(0, 150),
        protectionAction: String(it?.protection_action ?? '').slice(0, 200),
        minAcceptablePriceEur: Math.max(0, Number(it?.min_acceptable_price_eur ?? 0)),
        reasoning: String(it?.reasoning ?? '').slice(0, 200),
      })),
      protections: (parsed?.protections || []).slice(0, 6).map((p: any) => ({
        strategy: String(p?.strategy ?? '').slice(0, 200),
        marginSavedPct: Math.round(Number(p?.margin_saved_pct ?? 0)),
        itemsProtected: Math.max(0, Number(p?.items_protected ?? 0)),
        implementation: String(p?.implementation ?? '').slice(0, 150),
      })),
      actions: (parsed?.actions || []).slice(0, 6).map((a: any) => ({
        action: String(a?.action ?? '').slice(0, 250),
        priority: ['critical', 'high', 'medium', 'low'].includes(String(a?.priority)) ? String(a.priority) : 'medium',
        marginImpactPct: Math.round(Number(a?.margin_impact_pct ?? 0)),
        itemsAffected: Math.max(0, Number(a?.items_affected ?? 0)),
      })),
      summary: {
        overallMarginHealth: ['healthy', 'ok', 'at_risk', 'critical'].includes(String(parsed?.summary?.overall_margin_health)) ? String(parsed.summary.overall_margin_health) : 'ok',
        marginProtectionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.margin_protection_score ?? 50))),
        biggestThreat: String(parsed?.summary?.biggest_threat ?? '').slice(0, 80),
        totalProjectedErosion30dEur: Math.round(Number(parsed?.summary?.total_projected_erosion_30d_eur ?? 0)),
        totalProtectableMarginEur: Math.round(Number(parsed?.summary?.total_protectable_margin_eur ?? 0)),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, guardian });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
