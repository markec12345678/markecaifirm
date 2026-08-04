// v6.30 MILESTONE: AI Full Automation Orchestrator — koordinira avtomatsko nakupovanje + prodajanje
// POST /api/ai/full-automation
// Body: { mode?: 'advisory'|'semi_auto'|'full_auto' }
// Returns: { ok, automation: { mode, buyPipeline, sellPipeline, monitoring, alerts, safeguards, workflow } }

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
    const mode = ['advisory', 'semi_auto', 'full_auto'].includes(String(body?.mode)) ? String(body.mode) : 'advisory';

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 50,
    });

    const monitors = await db.monitor.findMany({
      where: { isActive: true },
      select: { id: true, name: true, source: true, intervalMinutes: true, lastRunAt: true, lastStatus: true },
      take: 30,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true },
      take: 100,
    });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const heldStr = heldTrades.slice(0, 10).map(t => `- ${t.title} | ${Math.round((Date.now()-t.buyDate.getTime())/(24*60*60*1000))}d | est. ${t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice*1.25)}€`).join('\n');
    const monitorStr = monitors.map(m => `- ${m.name} | ${m.source} | vsakih ${m.intervalMinutes}min | ${m.lastStatus ?? 'neznan'}`).join('\n');
    const soldCount = soldTrades.length;

    const prompt = `Si AI automation architect za avtomatizacijo preprodajnega posla.
Ustvari celovit avtomacijski načrt ki povezuje nakupovanje, monitoring in prodajo.

AVTOMACIJSKI NAČIN: ${mode}
- advisory: samo priporočila (človek odloča)
- semi_auto: avtomatski monitoring + alerti, človek potrdi nakup/prodajo
- full_auto: avtomatski nakup (do limita) + avtomatska objava oglasov

TRENUTNI INVENTAR (${heldTrades.length}):
${heldStr || '- Prazno'}

AKTIVNI MONITORJI (${monitors.length}):
${monitorStr || '- Brez monitorjev'}

ZGODOVINSKE PRODAJE: ${soldCount}

Avtomacijska pipelines:
1. BUY PIPELINE: monitoring → AI evalvacija → alert → (avtomatski nakup?) → trade entry
2. SELL PIPELINE: held item → AI optimal price → listing generation → (avtomatska objava?) → sale tracking
3. MONITORING: cron jobs → scraping → dedup → AI scoring → alert routing
4. ALERTS: Telegram/Discord/Push/Email z prioritetami
5. SAFEGUARDS: budget limits, max trades per day, risk score threshold, human override

Odgovori LE z JSON:
{
  "mode": "${mode}",
  "buy_pipeline": [
    { "step": <number>, "name": "<ime koraka>", "action": "<max 100 znakov>", "automated": <boolean>, "trigger": "<max 80 znakov>", "tool": "<kateri AI modul, max 50 znakov>" }
  ],
  "sell_pipeline": [
    { "step": <number>, "name": "<ime koraka>", "action": "<max 100 znakov>", "automated": <boolean>, "trigger": "<max 80 znakov>", "tool": "<kateri AI modul, max 50 znakov>" }
  ],
  "monitoring": {
    "active_monitors": <number>,
    "recommended_monitors": [
      { "name": "<ime>", "source": "<vir>", "keywords": "<ključne besede>", "interval_minutes": <number>, "alert_threshold": <number 0-100> }
    ],
    "scraping_schedule": "<max 100 znakov>"
  },
  "alerts": {
    "channels": ["<telegram|discord|push|email|webhook>"],
    "priority_routing": [
      { "priority": "<critical|high|medium|low>", "channels": ["<kanal>"], "response_time_minutes": <number> }
    ]
  },
  "safeguards": [
    { "name": "<ime zaščite>", "rule": "<max 100 znakov>", "threshold": "<max 80 znakov>", "action": "<max 80 znakov>" }
  ],
  "workflow": {
    "daily_automation": ["<dnevno avtomatsko dejanje, max 100 znakov>", "..."],
    "weekly_automation": ["<tedensko, max 100 znakov>", "..."],
    "monthly_automation": ["<mesečno, max 100 znakov>", "..."]
  },
  "expected_improvements": {
    "time_saved_hours_per_week": <number>,
    "profit_increase_pct": <number>,
    "response_time_improvement_pct": <number>,
    "missed_opportunities_reduction_pct": <number>
  },
  "insights": "<max 250 znakov>"
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

    const automation = {
      mode,
      buyPipeline: (parsed?.buy_pipeline || []).slice(0, 8).map((s: any) => ({
        step: Math.max(1, Number(s?.step ?? 1)),
        name: String(s?.name ?? '').slice(0, 80),
        action: String(s?.action ?? '').slice(0, 200),
        automated: Boolean(s?.automated ?? false),
        trigger: String(s?.trigger ?? '').slice(0, 150),
        tool: String(s?.tool ?? '').slice(0, 80),
      })),
      sellPipeline: (parsed?.sell_pipeline || []).slice(0, 8).map((s: any) => ({
        step: Math.max(1, Number(s?.step ?? 1)),
        name: String(s?.name ?? '').slice(0, 80),
        action: String(s?.action ?? '').slice(0, 200),
        automated: Boolean(s?.automated ?? false),
        trigger: String(s?.trigger ?? '').slice(0, 150),
        tool: String(s?.tool ?? '').slice(0, 80),
      })),
      monitoring: {
        activeMonitors: Math.max(0, Number(parsed?.monitoring?.active_monitors ?? monitors.length)),
        recommendedMonitors: (parsed?.monitoring?.recommended_monitors || []).slice(0, 6).map((m: any) => ({
          name: String(m?.name ?? '').slice(0, 80),
          source: String(m?.source ?? '').slice(0, 30),
          keywords: String(m?.keywords ?? '').slice(0, 150),
          intervalMinutes: Math.max(5, Number(m?.interval_minutes ?? 30)),
          alertThreshold: Math.max(0, Math.min(100, Number(m?.alert_threshold ?? 70))),
        })),
        scrapingSchedule: String(parsed?.monitoring?.scraping_schedule ?? '').slice(0, 200),
      },
      alerts: {
        channels: (parsed?.alerts?.channels || []).slice(0, 5).map((c: any) => String(c).slice(0, 30)),
        priorityRouting: (parsed?.alerts?.priority_routing || []).slice(0, 4).map((p: any) => ({
          priority: ['critical', 'high', 'medium', 'low'].includes(String(p?.priority)) ? String(p.priority) : 'medium',
          channels: (p?.channels || []).slice(0, 4).map((c: any) => String(c).slice(0, 30)),
          responseTimeMinutes: Math.max(0, Number(p?.response_time_minutes ?? 60)),
        })),
      },
      safeguards: (parsed?.safeguards || []).slice(0, 8).map((s: any) => ({
        name: String(s?.name ?? '').slice(0, 80),
        rule: String(s?.rule ?? '').slice(0, 200),
        threshold: String(s?.threshold ?? '').slice(0, 150),
        action: String(s?.action ?? '').slice(0, 150),
      })),
      workflow: {
        dailyAutomation: (parsed?.workflow?.daily_automation || []).slice(0, 6).map((d: any) => String(d).slice(0, 200)),
        weeklyAutomation: (parsed?.workflow?.weekly_automation || []).slice(0, 4).map((w: any) => String(w).slice(0, 200)),
        monthlyAutomation: (parsed?.workflow?.monthly_automation || []).slice(0, 4).map((m: any) => String(m).slice(0, 200)),
      },
      expectedImprovements: {
        timeSavedHoursPerWeek: Math.round(Number(parsed?.expected_improvements?.time_saved_hours_per_week ?? 0)),
        profitIncreasePct: Math.round(Number(parsed?.expected_improvements?.profit_increase_pct ?? 0)),
        responseTimeImprovementPct: Math.round(Number(parsed?.expected_improvements?.response_time_improvement_pct ?? 0)),
        missedOpportunitiesReductionPct: Math.round(Number(parsed?.expected_improvements?.missed_opportunities_reduction_pct ?? 0)),
      },
      insights: String(parsed?.insights ?? '').slice(0, 600),
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, automation, version: 'v6.30.0 MILESTONE' });
  } catch (e: any) {
    logger.error("/api/ai/full-automation", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
