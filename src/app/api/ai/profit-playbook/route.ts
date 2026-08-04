// v6.40 MILESTONE: AI Profit Maximization Playbook — kombinira vse AI funkcije v optimiziran workflow
// POST /api/ai/profit-playbook
// Body: {}
// Returns: { ok, playbook: { phases, workflow, checklist, milestones, kpis, expectedOutcome } }

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

    const [heldTrades, soldTrades] = await Promise.all([
      db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true } } }, take: 50 }),
      db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null } }, select: { category: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true }, take: 200 }),
    ]);

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const totalRealized = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - t.buyPrice, 0);
    const totalHeld = heldTrades.reduce((s, t) => s + t.buyPrice, 0);
    const avgRoi = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => s + (t.buyPrice > 0 ? ((t.sellPrice ?? 0) - t.buyPrice) / t.buyPrice * 100 : 0), 0) / soldTrades.length) : 0;

    const prompt = `Si vrhovni AI strategist za profit maximization. Ustvari celovit PLAYBOOK
ki kombinira vseh 160+ AI funkcij aplikacije v optimiziran, zaporeden workflow.

TRENUTNO STANJE:
- Held: ${heldTrades.length} (${Math.round(totalHeld)}€)
- Sold: ${soldTrades.length} (${Math.round(totalRealized)}€ dobička)
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

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);

    const playbook = {
      insights: String(parsed?.insights ?? '').slice(0, 600),
      phases: (parsed?.phases || []).slice(0, 8).map((p: any) => ({
        phase: Math.max(1, Math.min(8, Number(p?.phase ?? 1))),
        name: String(p?.name ?? '').slice(0, 50),
        description: String(p?.description ?? '').slice(0, 200),
        aiModules: (p?.ai_modules || []).slice(0, 8).map((m: any) => String(m).slice(0, 80)),
        actions: (p?.actions || []).slice(0, 5).map((a: any) => ({
          action: String(a?.action ?? '').slice(0, 200), tool: String(a?.tool ?? '').slice(0, 80),
          frequency: ['daily', 'weekly', 'monthly', 'per_item'].includes(String(a?.frequency)) ? String(a.frequency) : 'daily',
          expectedImpactEur: Math.round(Number(a?.expected_impact_eur ?? 0)),
        })),
        kpis: (p?.kpis || []).slice(0, 4).map((k: any) => ({
          name: String(k?.name ?? '').slice(0, 80), target: String(k?.target ?? '').slice(0, 80),
          current: String(k?.current ?? '').slice(0, 80),
        })),
        checklist: (p?.checklist || []).slice(0, 6).map((c: any) => String(c).slice(0, 150)),
        timeRequiredMinutes: Math.max(0, Number(p?.time_required_minutes ?? 0)),
        automationLevel: ['full', 'semi', 'manual'].includes(String(p?.automation_level)) ? String(p.automation_level) : 'semi',
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
        priority: ['critical', 'high', 'medium', 'low'].includes(String(c?.priority)) ? String(c.priority) : 'medium',
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

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, playbook, version: 'v6.40.0 MILESTONE' });
  } catch (e: any) { logger.error("/api/ai/profit-playbook", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
