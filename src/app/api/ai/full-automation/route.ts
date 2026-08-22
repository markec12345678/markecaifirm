// v6.30 MILESTONE / v8.95.8-other1: AI Full Automation Orchestrator — koordinira avtomatsko nakupovanje + prodajanje.
// Refaktoriran z withAiRoute helperjem (v8.95.8-other1) + enforceBudget guard.
//
// POST /api/ai/full-automation
// Body: { mode?: 'advisory'|'semi_auto'|'full_auto' }
// Returns: { ok, automation: { mode, buyPipeline, sellPipeline, monitoring, alerts, safeguards, workflow }, version }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface FullAutomationInput {
  mode: 'advisory' | 'semi_auto' | 'full_auto';
}

const MODES = ['advisory', 'semi_auto', 'full_auto'] as const;

interface PromptData {
  mode: string;
  heldCount: number;
  heldStr: string;
  monitorCount: number;
  monitorStr: string;
  soldCount: number;
}

export const POST = withAiRoute<FullAutomationInput>({
  endpoint: '/api/ai/full-automation',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const modeRaw = String(body?.mode);
    const mode: FullAutomationInput['mode'] = (MODES as readonly string[]).includes(modeRaw)
      ? (modeRaw as FullAutomationInput['mode'])
      : 'advisory';
    return { mode };
  },

  // No validateInput — mode has default

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { mode } = input;

    // 1. Load held trades
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 50,
    });

    // 2. Load monitors
    const monitors = await db.monitor.findMany({
      where: { isActive: true },
      select: { id: true, name: true, source: true, intervalMinutes: true, lastRunAt: true, lastStatus: true },
      take: 30,
    });

    // 3. Load sold trades count
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true },
      take: 100,
    });

    // 4. Build prompt
    const heldStr = heldTrades.slice(0, 10).map(t => `- ${t.title} | ${Math.round((Date.now()-t.buyDate.getTime())/(24*60*60*1000))}d | est. ${t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice*1.25)}€`).join('\n');
    const monitorStr = monitors.map(m => `- ${m.name} | ${m.source} | vsakih ${m.intervalMinutes}min | ${m.lastStatus ?? 'neznan'}`).join('\n');
    const soldCount = soldTrades.length;

    const prompt = buildPrompt({
      mode, heldCount: heldTrades.length, heldStr,
      monitorCount: monitors.length, monitorStr, soldCount,
    });
    const raw = await callAi(prompt);

    // 5. Parse + transform
    const parsed: any = parseAi(raw);
    const automation = transformAutomation(parsed, monitors.length, mode);

    return apiOk({ ok: true, automation, version: 'v6.30.0 MILESTONE' });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildPrompt(d: PromptData): string {
  return `Si AI automation architect za avtomatizacijo preprodajnega posla.
Ustvari celovit avtomacijski načrt ki povezuje nakupovanje, monitoring in prodajo.

AVTOMACIJSKI NAČIN: ${d.mode}
- advisory: samo priporočila (človek odloča)
- semi_auto: avtomatski monitoring + alerti, človek potrdi nakup/prodajo
- full_auto: avtomatski nakup (do limita) + avtomatska objava oglasov

TRENUTNI INVENTAR (${d.heldCount}):
${d.heldStr || '- Prazno'}

AKTIVNI MONITORJI (${d.monitorCount}):
${d.monitorStr || '- Brez monitorjev'}

ZGODOVINSKE PRODAJE: ${d.soldCount}

Avtomacijska pipelines:
1. BUY PIPELINE: monitoring → AI evalvacija → alert → (avtomatski nakup?) → trade entry
2. SELL PIPELINE: held item → AI optimal price → listing generation → (avtomatska objava?) → sale tracking
3. MONITORING: cron jobs → scraping → dedup → AI scoring → alert routing
4. ALERTS: Telegram/Discord/Push/Email z prioritetami
5. SAFEGUARDS: budget limits, max trades per day, risk score threshold, human override

Odgovori LE z JSON:
{
  "mode": "${d.mode}",
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
}

function transformAutomation(parsed: any, monitorCount: number, mode: string): {
  mode: string;
  buyPipeline: any[];
  sellPipeline: any[];
  monitoring: any;
  alerts: any;
  safeguards: any[];
  workflow: any;
  expectedImprovements: any;
  insights: string;
} {
  return {
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
      activeMonitors: Math.max(0, Number(parsed?.monitoring?.active_monitors ?? monitorCount)),
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
}
