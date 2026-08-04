// v6.36: AI Inventory Health Monitor — celovito spremlja zdravje inventarja
// POST /api/ai/inventory-health
// Body: {}
// Returns: { ok, health: { overallScore, vitals, items: [], diagnosis, treatment } }

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
    await req.json().catch(() => ({}));

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true, aiScore: true } } },
      take: 100,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: { buyPrice: true, sellPrice: true, buyDate: true, sellDate: true, category: true },
      take: 300,
    });

    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return NextResponse.json({ ok: true, health: null, message: 'Ni podatkov za health monitor.' });
    }

    const totalInvested = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalRealized = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - t.buyPrice, 0);
    const stalled = heldTrades.filter(t => Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)) > 30);
    const dead = heldTrades.filter(t => Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)) > 90);
    const fresh = heldTrades.filter(t => Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000)) <= 7);

    // Vital signs
    const turnoverRatio = heldTrades.length > 0 ? soldTrades.length / heldTrades.length : 0;
    const stalledPct = heldTrades.length > 0 ? Math.round((stalled.length / heldTrades.length) * 100) : 0;
    const deadPct = heldTrades.length > 0 ? Math.round((dead.length / heldTrades.length) * 100) : 0;
    const freshPct = heldTrades.length > 0 ? Math.round((fresh.length / heldTrades.length) * 100) : 0;
    const avgDaysHeld = heldTrades.length > 0 ? Math.round(heldTrades.reduce((s, t) => s + (Date.now() - t.buyDate.getTime()) / (24*60*60*1000), 0) / heldTrades.length) : 0;
    const categories = [...new Set(heldTrades.map(t => t.category || 'drugo'))].length;
    const concentrationRisk = heldTrades.length > 0 ? Math.max(...Object.values(heldTrades.reduce((acc, t) => { const c = t.category || 'drugo'; acc[c] = (acc[c] ?? 0) + 1; return acc; }, {} as Record<string, number>))) / heldTrades.length * 100 : 0;

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const heldStr = heldTrades.slice(0, 20).map(t => {
      const d = Math.round((Date.now()-t.buyDate.getTime())/(24*60*60*1000));
      return `- [${t.id}] ${t.title} | ${t.category} | ${d}d | ${t.buyPrice}€ | AI: ${t.listing?.aiScore ?? '?'}/10 | risk: ${t.listing?.aiRisk ?? '?'}/10`;
    }).join('\n');

    const prompt = `Si AI zdravstveni monitor za inventar (inventory health).
Oceni zdravje portfolia kot zdravnik oceni pacienta — z vital signs, diagnozo in zdravljenjem.

VITAL SIGNS:
- Skupni inventar: ${heldTrades.length} itemov (${Math.round(totalInvested)}€)
- Realizirani dobiček: ${Math.round(totalRealized)}€
- Stalled (>30d): ${stalled.length} (${stalledPct}%)
- Dead (>90d): ${dead.length} (${deadPct}%)
- Fresh (≤7d): ${fresh.length} (${freshPct}%)
- Povp. dni v skladišču: ${avgDaysHeld}
- Kategorij: ${categories}
- Koncentracijsko tveganje: ${Math.round(concentrationRisk)}%
- Turnover ratio: ${turnoverRatio.toFixed(2)}

INVENTAR:
${heldStr}

Health vital signs (kot pri zdravniku):
1. PULSE (turnover ratio): 4-8 = zdravo, <2 = šibek, >10 = prehitro
2. TEMPERATURE (stalled %): <20% = normalno, 20-40% = vroče, >40% = vročica
3. BLOOD PRESSURE (concentration): <30% = normalno, 30-50% = visoko, >50% = kritično
4. OXYGEN (fresh %): >30% = dobro, 10-30% = nizko, <10% = kritično
5. CHOLESTEROL (dead %): <5% = zdravo, 5-15% = visoko, >15% = nevarno
6. BMI (avg days held): <30 = fit, 30-60 = pretežko, >60 = debelo

Diagnoza: kaj je narobe z inventarjem?
Zdravljenje: kaj storiti za izboljšanje?

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overall_health_score": <number 0-100>,
  "health_grade": "<excellent|good|fair|poor|critical>",
  "vitals": [
    {
      "name": "<pulse|temperature|blood_pressure|oxygen|cholesterol|bmi>",
      "value": <number>,
      "unit": "<max 10 znakov>",
      "status": "<healthy|warning|critical>",
      "benchmark": "<max 30 znakov>",
      "interpretation": "<max 80 znakov>"
    }
  ],
  "diagnosis": [
    {
      "condition": "<ime stanja, max 80 znakov>",
      "severity": "<mild|moderate|severe>",
      "affected_items": <number>,
      "symptoms": ["<simptom, max 60 znakov>", "..."],
      "cause": "<max 100 znakov>"
    }
  ],
  "treatment": [
    {
      "treatment": "<ime zdravljenja, max 80 znakov>",
      "target_condition": "<max 50 znakov>",
      "action": "<kaj storiti, max 120 znakov>",
      "medication": "<kateri AI modul uporabiti, max 50 znakov>",
      "dosage": "<koliko/kdaj, max 80 znakov>",
      "expected_recovery_days": <number>,
      "priority": "<urgent|high|medium|low>"
    }
  ],
  "items_health": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "health_score": <number 0-100>,
      "status": "<healthy|at_risk|critical|terminal>",
      "primary_issue": "<max 80 znakov>",
      "recommended_treatment": "<max 100 znakov>",
      "urgency": "<high|medium|low>"
    }
  ],
  "summary": {
    "healthy_items": <number>,
    "at_risk_items": <number>,
    "critical_items": <number>,
    "terminal_items": <number>,
    "overall_prognosis": "<improving|stable|declining>",
    "recovery_plan_days": <number>
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
    const validIds = new Set(heldTrades.map(t => t.id));

    const health = {
      insights: String(parsed?.insights ?? '').slice(0, 600),
      overallHealthScore: Math.max(0, Math.min(100, Number(parsed?.overall_health_score ?? 50))),
      healthGrade: ['excellent', 'good', 'fair', 'poor', 'critical'].includes(String(parsed?.health_grade)) ? String(parsed.health_grade) : 'fair',
      vitals: (parsed?.vitals || []).slice(0, 6).map((v: any) => ({
        name: String(v?.name ?? '').slice(0, 50),
        value: Math.round(Number(v?.value ?? 0) * 100) / 100,
        unit: String(v?.unit ?? '').slice(0, 20),
        status: ['healthy', 'warning', 'critical'].includes(String(v?.status)) ? String(v.status) : 'healthy',
        benchmark: String(v?.benchmark ?? '').slice(0, 50),
        interpretation: String(v?.interpretation ?? '').slice(0, 150),
      })),
      diagnosis: (parsed?.diagnosis || []).slice(0, 5).map((d: any) => ({
        condition: String(d?.condition ?? '').slice(0, 150),
        severity: ['mild', 'moderate', 'severe'].includes(String(d?.severity)) ? String(d.severity) : 'mild',
        affectedItems: Math.max(0, Number(d?.affected_items ?? 0)),
        symptoms: (d?.symptoms || []).slice(0, 4).map((s: any) => String(s).slice(0, 100)),
        cause: String(d?.cause ?? '').slice(0, 200),
      })),
      treatment: (parsed?.treatment || []).slice(0, 6).map((t: any) => ({
        treatment: String(t?.treatment ?? '').slice(0, 150),
        targetCondition: String(t?.target_condition ?? '').slice(0, 80),
        action: String(t?.action ?? '').slice(0, 250),
        medication: String(t?.medication ?? '').slice(0, 80),
        dosage: String(t?.dosage ?? '').slice(0, 150),
        expectedRecoveryDays: Math.max(0, Number(t?.expected_recovery_days ?? 7)),
        priority: ['urgent', 'high', 'medium', 'low'].includes(String(t?.priority)) ? String(t.priority) : 'medium',
      })),
      itemsHealth: (parsed?.items_health || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).slice(0, 20).map((it: any) => ({
        tradeId: String(it?.id ?? ''),
        title: String(it?.title ?? '').slice(0, 100),
        healthScore: Math.max(0, Math.min(100, Number(it?.health_score ?? 50))),
        status: ['healthy', 'at_risk', 'critical', 'terminal'].includes(String(it?.status)) ? String(it.status) : 'healthy',
        primaryIssue: String(it?.primary_issue ?? '').slice(0, 150),
        recommendedTreatment: String(it?.recommended_treatment ?? '').slice(0, 200),
        urgency: ['high', 'medium', 'low'].includes(String(it?.urgency)) ? String(it.urgency) : 'medium',
      })),
      summary: {
        healthyItems: Math.max(0, Number(parsed?.summary?.healthy_items ?? 0)),
        atRiskItems: Math.max(0, Number(parsed?.summary?.at_risk_items ?? 0)),
        criticalItems: Math.max(0, Number(parsed?.summary?.critical_items ?? 0)),
        terminalItems: Math.max(0, Number(parsed?.summary?.terminal_items ?? 0)),
        overallPrognosis: ['improving', 'stable', 'declining'].includes(String(parsed?.summary?.overall_prognosis)) ? String(parsed.summary.overall_prognosis) : 'stable',
        recoveryPlanDays: Math.max(0, Number(parsed?.summary?.recovery_plan_days ?? 30)),
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
    logger.error("/api/ai/inventory-health", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
