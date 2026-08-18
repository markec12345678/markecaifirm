/**
 * @deprecated v8.94 — uporabi `/api/ai/inventory-health-monitor-v2` namesto tega.
 * Zastareli v1 — v2 je najnovejši.
 * Ta endpoint bo odstranjen v v9.0. Glej ENDPOINTS_AUDIT.md za migracijski načrt.
 */
// v6.36: AI Inventory Health Monitor — kontinuirano spremlja zdravje inventarja
// POST /api/ai/inventory-health-monitor
// Body: {}
// Returns: { ok, health: { overallScore, vitals, items: [], alerts, trends, recommendations } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';
import { logDeprecatedCall } from '@/lib/deprecated-redirect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  logDeprecatedCall('/api/ai/inventory-health-monitor', req, '/api/ai/inventory-health-monitor-v2');
  try {
    await req.json().catch(() => ({}));

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true, aiVerdict: true } } },
      take: 60,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, buyDate: true, sellDate: true },
      take: 300,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, health: null, message: 'Ni held tradeov za health monitoring.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // Vital signs calculation
    const totalValue = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalEstValue = heldTrades.reduce((s, t) => s + (t.listing?.aiEstimatedValue ?? t.buyPrice * 1.25), 0);
    const stalled = heldTrades.filter(t => Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)) > 30).length;
    const critical = heldTrades.filter(t => Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)) > 60).length;
    const dead = heldTrades.filter(t => Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)) > 90).length;
    const highRisk = heldTrades.filter(t => (t.listing?.aiRisk ?? 0) >= 7).length;
    const categories = new Set(heldTrades.map(t => t.category || 'drugo')).size;
    const topCatValue = Object.entries(heldTrades.reduce((acc, t) => { const c = t.category || 'drugo'; acc[c] = (acc[c] ?? 0) + t.buyPrice; return acc; }, {} as Record<string, number>)).sort(([,a],[,b]) => b - a)[0];
    const concentrationPct = topCatValue ? Math.round((topCatValue[1] / totalValue) * 100) : 0;
    const avgRoi = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => { const c = t.buyPrice + (t.buyFees ?? 0); return s + (c > 0 ? (((t.sellPrice ?? 0) - (t.sellFees ?? 0) - c) / c) * 100 : 0); }, 0) / soldTrades.length) : 0;
    const avgDays = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => { if (t.sellDate && t.buyDate) return s + (t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000); return s; }, 0) / soldTrades.length) : 0;
    const successRate = soldTrades.length > 0 ? Math.round(soldTrades.filter(t => (t.sellPrice ?? 0) - (t.sellFees ?? 0) > t.buyPrice + (t.buyFees ?? 0)).length / soldTrades.length * 100) : 0;

    const items = heldTrades.map(t => ({
      id: t.id, title: t.title, category: t.category || 'drugo',
      cost: t.buyPrice + (t.buyFees ?? 0),
      estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)),
      dealScore: t.listing?.dealScore ?? 0, aiRisk: t.listing?.aiRisk ?? 5,
    }));

    const itemsStr = items.slice(0, 20).map(i => `- [${i.id}] ${i.title} | ${i.category} | ${i.daysHeld}d | ${i.cost}€→${i.estValue}€ | risk: ${i.aiRisk}/10 | deal: ${i.dealScore}`).join('\n');

    const prompt = `Si AI health monitoring sistem za inventar.
Spremljaj "vital signs" inventarja in zaznaj morebitne težave preden postanejo kritične.

INVENTAR VITAL SIGNS:
- Skupna vrednost: ${Math.round(totalValue)}€ (est. ${Math.round(totalEstValue)}€)
- Itemov: ${heldTrades.length} v ${categories} kategorijah
- Stalled (>30d): ${stalled} (${Math.round(stalled/heldTrades.length*100)}%)
- Critical (>60d): ${critical}
- Dead (>90d): ${dead}
- High risk (AI risk >=7): ${highRisk}
- Koncentracija top kategorije: ${concentrationPct}%
- Povp. ROI (zgodovina): ${avgRoi}%
- Povp. dni do prodaje: ${avgDays}
- Success rate: ${successRate}%

INVENTAR:
${itemsStr}

Health vitals (kot pri bolniku):
1. HEART RATE = turnover ratio (koliko hitro se obrača)
2. BLOOD PRESSURE = concentration risk (ali je preveč v eni kategoriji)
3. TEMPERATURE = stalled % (višji = bolj "vnetje")
4. CHOLESTEROL = dead inventory % (blokira cash flow)
5. IMMUNE SYSTEM = diversification (več kategorij = bolj odporen)
6. BONE DENSITY = avg deal score (kakovost nakupov)
7. VISION = AI accuracy (ali AI pravilno ocenjuje)
8. STAMINA = avg ROI (dobičkonosnost)

Health alert nivoji:
- GREEN: vsi vitali normalni, nadaljuj
- YELLOW: 1-2 vitali izven norme, spremljaj
- ORANGE: 3+ vitali izven norme, ukrepaj
- RED: kritični vitali, takojšnja akcija

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overall_health_score": <number 0-100>,
  "health_status": "<green|yellow|orange|red>",
  "vitals": [
    { "name": "<heart_rate|blood_pressure|temperature|cholesterol|immune|bone_density|vision|stamina>", "label": "<človeku berljivo ime>", "value": <number>, "unit": "<max 10 znakov>", "status": "<normal|warning|critical>", "benchmark": <number>, "note": "<max 80 znakov>" }
  ],
  "items_health": [
    { "id": "<trade_id>", "title": "<naslov>", "health_score": <number 0-100>, "status": "<healthy|warning|critical|dead>", "primary_issue": "<max 80 znakov>", "recommended_action": "<max 100 znakov>", "urgency": "<high|medium|low>" }
  ],
  "alerts": [
    { "type": "<stalled|concentration|dead_inventory|high_risk|low_diversification|margin_erosion>", "severity": "<critical|high|medium|low>", "message": "<max 120 znakov>", "affected_count": <number>, "action": "<max 100 znakov>" }
  ],
  "trends": [
    { "metric": "<ime>", "current": <number>, "previous": <number>, "change_pct": <number>, "direction": "<improving|stable|declining>" }
  ],
  "recommendations": [
    { "action": "<max 120 znakov>", "priority": "<critical|high|medium|low>", "vitals_improved": ["<ime vitala>"], "expected_impact": "<max 80 znakov>" }
  ],
  "summary": {
    "healthy_items": <number>,
    "warning_items": <number>,
    "critical_items": <number>,
    "dead_items": <number>,
    "value_at_risk_eur": <number>,
    "projected_recovery_eur": <number>
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
    const validIds = new Set(items.map(i => i.id));

    const health = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      overallHealthScore: Math.max(0, Math.min(100, Number(parsed?.overall_health_score ?? 50))),
      healthStatus: ['green', 'yellow', 'orange', 'red'].includes(String(parsed?.health_status)) ? String(parsed.health_status) : 'yellow',
      vitals: (parsed?.vitals || []).slice(0, 8).map((v: any) => ({
        name: String(v?.name ?? '').slice(0, 30),
        label: String(v?.label ?? '').slice(0, 50),
        value: Math.round(Number(v?.value ?? 0)),
        unit: String(v?.unit ?? '').slice(0, 20),
        status: ['normal', 'warning', 'critical'].includes(String(v?.status)) ? String(v.status) : 'normal',
        benchmark: Math.round(Number(v?.benchmark ?? 0)),
        note: String(v?.note ?? '').slice(0, 150),
      })),
      itemsHealth: (parsed?.items_health || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).map((it: any) => ({
        tradeId: String(it?.id ?? ''),
        title: String(it?.title ?? '').slice(0, 150),
        healthScore: Math.max(0, Math.min(100, Number(it?.health_score ?? 50))),
        status: ['healthy', 'warning', 'critical', 'dead'].includes(String(it?.status)) ? String(it.status) : 'warning',
        primaryIssue: String(it?.primary_issue ?? '').slice(0, 150),
        recommendedAction: String(it?.recommended_action ?? '').slice(0, 200),
        urgency: ['high', 'medium', 'low'].includes(String(it?.urgency)) ? String(it.urgency) : 'medium',
      })),
      alerts: (parsed?.alerts || []).slice(0, 6).map((a: any) => ({
        type: String(a?.type ?? '').slice(0, 50),
        severity: ['critical', 'high', 'medium', 'low'].includes(String(a?.severity)) ? String(a.severity) : 'medium',
        message: String(a?.message ?? '').slice(0, 250),
        affectedCount: Math.max(0, Number(a?.affected_count ?? 0)),
        action: String(a?.action ?? '').slice(0, 200),
      })),
      trends: (parsed?.trends || []).slice(0, 5).map((t: any) => ({
        metric: String(t?.metric ?? '').slice(0, 50),
        current: Math.round(Number(t?.current ?? 0)),
        previous: Math.round(Number(t?.previous ?? 0)),
        changePct: Math.round(Number(t?.change_pct ?? 0)),
        direction: ['improving', 'stable', 'declining'].includes(String(t?.direction)) ? String(t.direction) : 'stable',
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 250),
        priority: ['critical', 'high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        vitalsImproved: (r?.vitals_improved || []).slice(0, 4).map((v: any) => String(v).slice(0, 30)),
        expectedImpact: String(r?.expected_impact ?? '').slice(0, 150),
      })),
      summary: {
        healthyItems: Math.max(0, Number(parsed?.summary?.healthy_items ?? 0)),
        warningItems: Math.max(0, Number(parsed?.summary?.warning_items ?? 0)),
        criticalItems: Math.max(0, Number(parsed?.summary?.critical_items ?? 0)),
        deadItems: Math.max(0, Number(parsed?.summary?.dead_items ?? 0)),
        valueAtRiskEur: Math.round(Number(parsed?.summary?.value_at_risk_eur ?? 0)),
        projectedRecoveryEur: Math.round(Number(parsed?.summary?.projected_recovery_eur ?? 0)),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, health });
  } catch (e: any) {
    logger.error("/api/ai/inventory-health-monitor", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
