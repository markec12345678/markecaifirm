// v6.32 / v8.96.0-refactor: AI Smart Alert Router — inteligentno usmerja alerte glede na prioriteto in kontekst
// Refaktoriran z withAiRoute helperjem (v8.96.0) + enforceBudget guard.
//
// POST /api/ai/smart-alert-router
// Body: {}
// Returns: { ok, routing: { rules, channels, priorities, quietHours, escalation, examples } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { getSettingsRow } from '@/lib/pipeline';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface SmartAlertRouterInput {}

export const POST = withAiRoute<SmartAlertRouterInput>({
  endpoint: '/api/ai/smart-alert-router',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — telo zahtevka je prazno

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

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

    // Settings za prompt — AiSettings ne vključuje quiet hours / channel fields
    const settings = await getSettingsRow();

    const prompt = buildPrompt(monitors, recentAlerts, settings);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const routing = transformRouting(parsed, settings);

    return apiOk({ ok: true, routing });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface MonitorRow {
  name: string;
  source: string;
  intervalMinutes: number;
  tags: string | null;
}

interface AlertRow {
  title: string;
  aiScore: number | null;
  aiRisk: number | null;
  aiVerdict: string | null;
  createdAt: Date;
  monitor: { name: string; source: string } | null;
}

interface SettingsRow {
  quietHoursEnabled: boolean;
  quietStartHour: number;
  quietEndHour: number;
  digestMode: boolean | string;
  telegramEnabled: boolean;
  discordEnabled: boolean;
  pushEnabled: boolean;
}

function buildPrompt(monitors: MonitorRow[], recentAlerts: AlertRow[], settings: SettingsRow): string {
  const monitorStr = monitors.map(m => `- ${m.name} | ${m.source} | vsakih ${m.intervalMinutes}min | tags: ${m.tags || 'brez'}`).join('\n');
  const alertStr = recentAlerts.slice(0, 15).map(a => `- ${a.title} | score: ${a.aiScore ?? '?'}/10 | risk: ${a.aiRisk ?? '?'}/10 | verdict: ${a.aiVerdict ?? '?'}`).join('\n');

  return `Si AI alert routing architect za inteligentno usmerjanje obvestil.
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
}

function transformRouting(parsed: any, settings: SettingsRow) {
  return {
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
}
