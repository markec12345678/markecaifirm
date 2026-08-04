// v6.32: AI Smart Alert Router — inteligentno usmerja alerte glede na prioriteto in kontekst
// POST /api/ai/smart-alert-router
// Body: {}
// Returns: { ok, routing: { rules, channels, priorities, quietHours, escalation, examples } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    await req.json().catch(() => ({}));

    const monitors = await db.monitor.findMany({
      where: { isActive: true },
      select: { id: true, name: true, source: true, intervalMinutes: true, tags: true },
      take: 30,
    });

    const recentAlerts = await db.alert.findMany({
      take: 50,
      orderBy: { createdAt: 'desc' },
      select: { title: true, aiScore: true, aiRisk: true, aiVerdict: true, createdAt: true,
        monitor: { select: { name: true, source: true } } },
    });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const monitorStr = monitors.map(m => `- ${m.name} | ${m.source} | vsakih ${m.intervalMinutes}min | tags: ${m.tags || 'brez'}`).join('\n');
    const alertStr = recentAlerts.slice(0, 15).map(a => `- ${a.title} | score: ${a.aiScore ?? '?'}/10 | risk: ${a.aiRisk ?? '?'}/10 | verdict: ${a.aiVerdict ?? '?'}`).join('\n');

    const prompt = `Si AI alert routing architect za inteligentno usmerjanje obvestil.
Ustvari pametni routing sistem za alerte glede na prioriteto, kontekst in kanal.

AKTIVNI MONITORJI (${monitors.length}):
${monitorStr || '- Brez monitorjev'}

ZADNJI ALERTI (${recentAlerts.length}):
${alertStr || '- Brez alertov'}

TRENUTNE NASTAVITVE:
- Quiet hours: ${settings.quietHoursEnabled ? `${settings.quietStartHour}h-${settings.quietEndHour}h` : 'izklopljene'}
- Digest mode: ${settings.digestMode}
- Telegram: ${settings.telegramEnabled ? 'vklopljen' : 'izklopljen'}
- Discord: ${settings.discordEnabled ? 'vklopljen' : 'izklopljen'}
- Push: ${settings.pushEnabled ? 'vklopljen' : 'izklopljen'}

Routing pravila:
1. CRITICAL (deal score >= 90 + AI verdict PRILIKA + risk <= 3): instant vseh kanalov, tudi v quiet hours
2. HIGH (deal score >= 80 + AI verdict PRILIKA): instant Telegram + Push, ne v quiet hours
3. MEDIUM (deal score >= 70): digest mode (zbirka ob 20h)
4. LOW (deal score >= 60): samo dashboard, brez push
5. INFO (price drop, new listing): samo log

Kontekstni faktorji:
- Kategorija: elektronika → instant (hitro mine), pohištvo → digest
- Čas: 6-23h → instant, 23-6h → quiet (razen critical)
- Dan: vikend → manj agresivno
- Stališče: stalled item alert → visoka prioriteta (ne zamudi)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "routing_rules": [
    {
      "priority": "<critical|high|medium|low|info>",
      "conditions": ["<pogoj, max 80 znakov>", "..."],
      "channels": ["<telegram|discord|push|email|dashboard|log>"],
      "timing": "<instant|delayed|digest|quiet_hours_override>",
      "max_per_hour": <number>,
      "cooldown_minutes": <number>
    }
  ],
  "channel_priorities": [
    {
      "channel": "<telegram|discord|push|email|dashboard>",
      "best_for": "<max 80 znakov>",
      "response_time_minutes": <number>,
      "noise_level": "<high|medium|low>"
    }
  ],
  "quiet_hours_config": {
    "enabled": <boolean>,
    "start_hour": <number>,
    "end_hour": <number>,
    "critical_override": <boolean>,
    "weekend_mode": "<same|extended|disabled>"
  },
  "escalation": {
    "rules": [
      {
        "trigger": "<max 80 znakov>",
        "escalate_to": "<kateri kanal>",
        "delay_minutes": <number>,
        "condition": "<max 80 znakov>"
      }
    ]
  },
  "smart_filters": [
    {
      "name": "<ime filtra>",
      "condition": "<max 100 znakov>",
      "action": "<suppress|delay|priority_boost|priority_reduce>",
      "reasoning": "<max 80 znakov>"
    }
  ],
  "expected_improvements": {
    "alert_fatigue_reduction_pct": <number>,
    "response_time_improvement_pct": <number>,
    "missed_critical_reduction_pct": <number>,
    "notification_satisfaction_pct": <number>
  },
  "recommendations": ["<max 150 znakov>", "..."]
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

    const routing = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      routingRules: (parsed?.routing_rules || []).slice(0, 6).map((r: any) => ({
        priority: ['critical', 'high', 'medium', 'low', 'info'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        conditions: (r?.conditions || []).slice(0, 4).map((c: any) => String(c).slice(0, 150)),
        channels: (r?.channels || []).slice(0, 5).map((c: any) => String(c).slice(0, 30)),
        timing: ['instant', 'delayed', 'digest', 'quiet_hours_override'].includes(String(r?.timing)) ? String(r.timing) : 'instant',
        maxPerHour: Math.max(0, Number(r?.max_per_hour ?? 10)),
        cooldownMinutes: Math.max(0, Number(r?.cooldown_minutes ?? 0)),
      })),
      channelPriorities: (parsed?.channel_priorities || []).slice(0, 5).map((c: any) => ({
        channel: String(c?.channel ?? '').slice(0, 30),
        bestFor: String(c?.best_for ?? '').slice(0, 150),
        responseTimeMinutes: Math.max(0, Number(c?.response_time_minutes ?? 60)),
        noiseLevel: ['high', 'medium', 'low'].includes(String(c?.noise_level)) ? String(c.noise_level) : 'medium',
      })),
      quietHoursConfig: {
        enabled: Boolean(parsed?.quiet_hours_config?.enabled ?? settings.quietHoursEnabled),
        startHour: Math.max(0, Math.min(23, Number(parsed?.quiet_hours_config?.start_hour ?? settings.quietStartHour))),
        endHour: Math.max(0, Math.min(23, Number(parsed?.quiet_hours_config?.end_hour ?? settings.quietEndHour))),
        criticalOverride: Boolean(parsed?.quiet_hours_config?.critical_override ?? true),
        weekendMode: ['same', 'extended', 'disabled'].includes(String(parsed?.quiet_hours_config?.weekend_mode)) ? String(parsed.quiet_hours_config.weekend_mode) : 'same',
      },
      escalation: {
        rules: (parsed?.escalation?.rules || []).slice(0, 4).map((r: any) => ({
          trigger: String(r?.trigger ?? '').slice(0, 150),
          escalateTo: String(r?.escalate_to ?? '').slice(0, 30),
          delayMinutes: Math.max(0, Number(r?.delay_minutes ?? 30)),
          condition: String(r?.condition ?? '').slice(0, 150),
        })),
      },
      smartFilters: (parsed?.smart_filters || []).slice(0, 6).map((f: any) => ({
        name: String(f?.name ?? '').slice(0, 80),
        condition: String(f?.condition ?? '').slice(0, 200),
        action: ['suppress', 'delay', 'priority_boost', 'priority_reduce'].includes(String(f?.action)) ? String(f.action) : 'delay',
        reasoning: String(f?.reasoning ?? '').slice(0, 150),
      })),
      expectedImprovements: {
        alertFatigueReductionPct: Math.round(Number(parsed?.expected_improvements?.alert_fatigue_reduction_pct ?? 0)),
        responseTimeImprovementPct: Math.round(Number(parsed?.expected_improvements?.response_time_improvement_pct ?? 0)),
        missedCriticalReductionPct: Math.round(Number(parsed?.expected_improvements?.missed_critical_reduction_pct ?? 0)),
        notificationSatisfactionPct: Math.round(Number(parsed?.expected_improvements?.notification_satisfaction_pct ?? 0)),
      },
      recommendations: (parsed?.recommendations || []).slice(0, 5).map((r: any) => String(r).slice(0, 300)),
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, routing });
  } catch (e: any) {
    logger.error("/api/ai/smart-alert-router", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
