// v6.40 MILESTONE / v8.95.6-profit: AI Profit Maximization Playbook — kombinira vse AI funkcije v optimiziran workflow
// Refaktoriran z withAiRoute helperjem (v8.95.6-profit) + enforceBudget guard.
//
// POST /api/ai/profit-playbook
// Body: {}
// Returns: { ok, playbook: { phases, workflow, checklist, milestones, kpis, expectedOutcome } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitPlaybookInput {}

export const POST = withAiRoute<ProfitPlaybookInput>({
  endpoint: '/api/ai/profit-playbook',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {} as ProfitPlaybookInput;
  },

  // No validateInput — brez polj
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    const [heldTrades, soldTrades] = await Promise.all([
      db.trade.findMany({
        where: { status: 'held' },
        select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
          listing: { select: { aiEstimatedValue: true, dealScore: true } } },
        take: 50,
      }),
      db.trade.findMany({
        where: { status: 'sold', sellPrice: { not: null } },
        select: { category: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true },
        take: 200,
      }),
    ]);

    const totalRealized = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - t.buyPrice, 0);
    const totalHeld = heldTrades.reduce((s, t) => s + t.buyPrice, 0);
    const avgRoi = soldTrades.length > 0
      ? Math.round(soldTrades.reduce((s, t) => s + (t.buyPrice > 0 ? ((t.sellPrice ?? 0) - t.buyPrice) / t.buyPrice * 100 : 0), 0) / soldTrades.length)
      : 0;

    const prompt = buildPrompt(heldTrades.length, totalHeld, soldTrades.length, totalRealized, avgRoi);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const playbook = transformPlaybook(parsed, avgRoi);

    return apiOk({ ok: true, playbook, version: 'v6.40.0 MILESTONE' });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'per_item'] as const;
const AUTOMATION_LEVELS = ['full', 'semi', 'manual'] as const;
const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

/**
 * Build AI prompt za profit playbook (besedilo IDENTIČNO originalu v6.40 MILESTONE).
 */
function buildPrompt(
  heldCount: number,
  totalHeld: number,
  soldCount: number,
  totalRealized: number,
  avgRoi: number,
): string {
  return `Si vrhovni AI strategist za profit maximization. Ustvari celovit PLAYBOOK
ki kombinira vseh 160+ AI funkcij aplikacije v optimiziran, zaporeden workflow.

TRENUTNO STANJE:
- Held: ${heldCount} (${Math.round(totalHeld)}€)
- Sold: ${soldCount} (${Math.round(totalRealized)}€ dobička)
- Povp. ROI: ${avgRoi}%

Playbook mora pokrivati CELOTEN lifecycle od sourcing do reinvestment:
1. SOURCING (iskanje priložnosti)
2. EVALUATION (AI ocenjevanje)
3. ACQUISITION (nakup + pogajanje)
4. HOLDING (monitoring + optimizacija)
5. PRICING (določitev cene)
6. LISTING (objava + marketing)
7. SELLING (pogajanje + prodaja)
8. POST-SALE (analiza + reinvestment)

Za vsako fazo:
- Kateri AI moduli se uporabijo (od 160+)
- Kakšna je optimalna akcija
- KPI-ji za to fazo
- Checklist
- Expected impact

Odgovori LE z JSON:
{
  "insights": "<max 250 znakov>",
  "phases": [
    {
      "phase": <number 1-8>,
      "name": "<sourcing|evaluation|acquisition|holding|pricing|listing|selling|post_sale>",
      "description": "<max 100 znakov>",
      "ai_modules": ["<ime AI modula, max 50 znakov>", "..."],
      "actions": [
        { "action": "<max 100 znakov>", "tool": "<AI modul>", "frequency": "<daily|weekly|monthly|per_item>", "expected_impact_eur": <number> }
      ],
      "kpis": [{"name": "<max 50 znakov>", "target": "<max 50 znakov>", "current": "<max 50 znakov>"}],
      "checklist": ["<max 80 znakov>", "..."],
      "time_required_minutes": <number>,
      "automation_level": "<full|semi|manual>"
    }
  ],
  "workflow": {
    "daily": ["<dnevno dejanje, max 100 znakov>", "..."],
    "weekly": ["<tedensko, max 100 znakov>", "..."],
    "monthly": ["<mesečno, max 100 znakov>", "..."],
    "per_new_listing": ["<ob novem oglasu, max 100 znakov>", "..."],
    "per_sale": ["<ob prodaji, max 100 znakov>", "..."]
  },
  "checklist": [
    { "item": "<max 80 znakov>", "phase": <number>, "priority": "<critical|high|medium|low>", "done": <boolean>, "impact_eur": <number> }
  ],
  "milestones": [
    { "milestone": "<max 80 znakov>", "target_date": "<max 30 znakov>", "metric": "<max 50 znakov>", "target_value": "<max 50 znakov>", "current_value": "<max 50 znakov>" }
  ],
  "kpis": [
    { "name": "<max 50 znakov>", "current": <number>, "target": <number>, "unit": "<max 10 znakov>", "deadline": "<max 30 znakov>" }
  ],
  "expected_outcome": {
    "current_monthly_profit_eur": <number>,
    "projected_monthly_profit_eur": <number>,
    "improvement_pct": <number>,
    "current_roi_pct": <number>,
    "projected_roi_pct": <number>,
    "time_investment_hours_week": <number>,
    "time_saved_hours_week": <number>,
    "net_time_change_hours_week": <number>
  },
  "summary": {
    "playbook_score": <number 0-100>,
    "biggest_opportunity": "<max 100 znakov>",
    "quickest_win": "<max 100 znakov>",
    "long_term_strategy": "<max 150 znakov>",
    "expected_90d_profit_eur": <number>
  }
}`;
}

/**
 * Transform AI JSON v playbook rezultat. Clamp/slice logika IDENTIČNA originalu v6.40 MILESTONE.
 */
function transformPlaybook(parsed: any, avgRoi: number): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 600),
    phases: (parsed?.phases || []).slice(0, 8).map((p: any) => ({
      phase: Math.max(1, Math.min(8, Number(p?.phase ?? 1))),
      name: String(p?.name ?? '').slice(0, 50),
      description: String(p?.description ?? '').slice(0, 200),
      aiModules: (p?.ai_modules || []).slice(0, 8).map((m: any) => String(m).slice(0, 80)),
      actions: (p?.actions || []).slice(0, 5).map((a: any) => ({
        action: String(a?.action ?? '').slice(0, 200), tool: String(a?.tool ?? '').slice(0, 80),
        frequency: includes(FREQUENCIES, String(a?.frequency)) ? String(a.frequency) : 'daily',
        expectedImpactEur: Math.round(Number(a?.expected_impact_eur ?? 0)),
      })),
      kpis: (p?.kpis || []).slice(0, 4).map((k: any) => ({
        name: String(k?.name ?? '').slice(0, 80), target: String(k?.target ?? '').slice(0, 80),
        current: String(k?.current ?? '').slice(0, 80),
      })),
      checklist: (p?.checklist || []).slice(0, 6).map((c: any) => String(c).slice(0, 150)),
      timeRequiredMinutes: Math.max(0, Number(p?.time_required_minutes ?? 0)),
      automationLevel: includes(AUTOMATION_LEVELS, String(p?.automation_level)) ? String(p.automation_level) : 'semi',
    })),
    workflow: {
      daily: (parsed?.workflow?.daily || []).slice(0, 8).map((d: any) => String(d).slice(0, 200)),
      weekly: (parsed?.workflow?.weekly || []).slice(0, 6).map((w: any) => String(w).slice(0, 200)),
      monthly: (parsed?.workflow?.monthly || []).slice(0, 4).map((m: any) => String(m).slice(0, 200)),
      perNewListing: (parsed?.workflow?.per_new_listing || []).slice(0, 6).map((p: any) => String(p).slice(0, 200)),
      perSale: (parsed?.workflow?.per_sale || []).slice(0, 6).map((p: any) => String(p).slice(0, 200)),
    },
    checklist: (parsed?.checklist || []).slice(0, 15).map((c: any) => ({
      item: String(c?.item ?? '').slice(0, 150), phase: Math.max(1, Number(c?.phase ?? 1)),
      priority: includes(PRIORITIES, String(c?.priority)) ? String(c.priority) : 'medium',
      done: Boolean(c?.done ?? false), impactEur: Math.round(Number(c?.impact_eur ?? 0)),
    })),
    milestones: (parsed?.milestones || []).slice(0, 6).map((m: any) => ({
      milestone: String(m?.milestone ?? '').slice(0, 150), targetDate: String(m?.target_date ?? '').slice(0, 50),
      metric: String(m?.metric ?? '').slice(0, 80), targetValue: String(m?.target_value ?? '').slice(0, 80),
      currentValue: String(m?.current_value ?? '').slice(0, 80),
    })),
    kpis: (parsed?.kpis || []).slice(0, 8).map((k: any) => ({
      name: String(k?.name ?? '').slice(0, 80), current: Math.round(Number(k?.current ?? 0)),
      target: Math.round(Number(k?.target ?? 0)), unit: String(k?.unit ?? '').slice(0, 20),
      deadline: String(k?.deadline ?? '').slice(0, 50),
    })),
    expectedOutcome: {
      currentMonthlyProfitEur: Math.round(Number(parsed?.expected_outcome?.current_monthly_profit_eur ?? 0)),
      projectedMonthlyProfitEur: Math.round(Number(parsed?.expected_outcome?.projected_monthly_profit_eur ?? 0)),
      improvementPct: Math.round(Number(parsed?.expected_outcome?.improvement_pct ?? 0)),
      currentRoiPct: Math.round(Number(parsed?.expected_outcome?.current_roi_pct ?? avgRoi)),
      projectedRoiPct: Math.round(Number(parsed?.expected_outcome?.projected_roi_pct ?? 0)),
      timeInvestmentHoursWeek: Math.round(Number(parsed?.expected_outcome?.time_investment_hours_week ?? 0)),
      timeSavedHoursWeek: Math.round(Number(parsed?.expected_outcome?.time_saved_hours_week ?? 0)),
      netTimeChangeHoursWeek: Math.round(Number(parsed?.expected_outcome?.net_time_change_hours_week ?? 0)),
    },
    summary: {
      playbookScore: Math.max(0, Math.min(100, Number(parsed?.summary?.playbook_score ?? 50))),
      biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 200),
      quickestWin: String(parsed?.summary?.quickest_win ?? '').slice(0, 200),
      longTermStrategy: String(parsed?.summary?.long_term_strategy ?? '').slice(0, 300),
      expected90dProfitEur: Math.round(Number(parsed?.summary?.expected_90d_profit_eur ?? 0)),
    },
  };
}
