// v6.56: AI Inventory Lifecycle Optimizer v2 — advanced lifecycle z ML stage transitions
// POST /api/ai/inventory-lifecycle-optimizer-v2
// Body: { tradeId?: string }
// Returns: { ok, optimizer: { items, stages, transitions, mlPredictions, optimalActions, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const LIFECYCLE_STAGES = [
  'acquisition',     // odkrivanje in nakup
  'intake',          // sprejem, cleaning, inspection
  'preparation',     // fotografiranje, listing generacija
  'launch',          // prva objava
  'active_marketing',// aktivno trženje
  'inquiry_phase',   // povpraševanja, pogajanja
  'negotiation',     // aktivno pogajanje
  'closing',         // blizu prodaje
  'sold',            // prodano
  'post_sale',       // follow-up, review, upsell
  'failed',          // neuspela prodaja
  'returned',        // vrnjen item
] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId) : null;

    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;

    const heldTrades = await db.trade.findMany({
      where,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true, location: true, imageUrl: true, firstSeenAt: true, contactStatus: true } },
      },
      take: tradeId ? 1 : 30,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, optimizer: null, message: 'Ni held tradeov za lifecycle analizo.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // Determine current lifecycle stage hevristically
    const now = Date.now();
    const items = heldTrades.map(t => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.round((now - t.buyDate.getTime()) / (24*60*60*1000));
      const contactStatus = t.listing?.contactStatus ?? 'none';

      // Hevristična določitev trenutne faze
      let currentStage: typeof LIFECYCLE_STAGES[number] = 'active_marketing';
      if (daysHeld <= 1) currentStage = 'acquisition';
      else if (daysHeld <= 3) currentStage = 'intake';
      else if (daysHeld <= 7) currentStage = 'preparation';
      else if (daysHeld <= 14) currentStage = 'launch';
      else if (daysHeld <= 30) currentStage = 'active_marketing';
      else if (daysHeld <= 60) currentStage = 'inquiry_phase';
      else if (contactStatus === 'contacted' || contactStatus === 'responded') currentStage = 'negotiation';
      else if (daysHeld > 90) currentStage = 'failed';

      return {
        id: t.id, title: t.title, category: t.category || 'drugo',
        cost, estValue, daysHeld, currentStage,
        contactStatus, dealScore: t.listing?.dealScore ?? 50,
        aiRisk: t.listing?.aiRisk ?? 5,
      };
    });

    const itemsStr = items.slice(0, 20).map(i =>
      `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d | stage: ${i.currentStage} | contact: ${i.contactStatus} | deal ${i.dealScore}/100`
    ).join('\n');

    const prompt = `Si AI inventory lifecycle optimizer v2 z ML stage transition modelom.
Optimizira vsako fazo inventory lifecycle za maksimalno profit in hitrost prodaje.

INVENTAR (${items.length}):
${itemsStr}

12 lifecycle faz:
1. ACQUISITION (1d): odkrivanje in nakup — hitra odločitev
2. INTAKE (1-3d): sprejem, cleaning, inspection — minimalno čakanje
3. PREPARATION (3-7d): fotografiranje, listing generacija — kvalitetne slike
4. LAUNCH (7-14d): prva objava — optimalen timing
5. ACTIVE_MARKETING (14-30d): aktivno trženje — refresh, cross-post
6. INQUIRY_PHASE (30-60d): povpraševanja, pogajanja — hitri odgovori
7. NEGOTIATION: aktivno pogajanje — multiple rounds
8. CLOSING: blizu prodaje — payment, meetup
9. SOLD: prodano — completed
10. POST_SALE: follow-up, review, upsell — relationship building
11. FAILED: neuspela prodaja — diagnosis, learn
12. RETURNED: vrnjen item — re-list ali refund

Stage transition pravila:
- ACQUISITION → INTAKE: takoj, hitra analiza
- INTAKE → PREPARATION: po cleaning in inspection
- PREPARATION → LAUNCH: po quality fotografijah in AI listing
- LAUNCH → ACTIVE_MARKETING: po 7d brez prodaje, refresh
- ACTIVE_MARKETING → INQUIRY_PHASE: ko pride povpraševanje
- INQUIRY_PHASE → NEGOTIATION: ko se kupec zanima za ceno
- NEGOTIATION → CLOSING: ko dogovorjeni pogoji
- CLOSING → SOLD: ko plačilo prejeto
- FAILED → ACQUISITION: re-list ali likvidacija

Optimization pravila per faza:
- ACQUISITION: hitra AI analiza, buy box
- INTAKE: parallel processing, batch cleaning
- PREPARATION: AI listing generation, VLM analiza slik
- LAUNCH: optimal dan v tednu, optimal ura
- ACTIVE_MARKETING: cross-posting, refresh koledar
- INQUIRY_PHASE: response time < 2h
- NEGOTIATION: structured playbook
- CLOSING: payment options, secure meetup
- POST_SALE: follow-up v 3 dneh, review request
- FAILED: root cause analysis, adjust strategijo

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "current_stage": "<12 faz>",
      "days_in_current_stage": <number>,
      "next_optimal_stage": "<12 faz>",
      "stage_transition_readiness_pct": <number 0-100>,
      "ml_predictions": {
        "predicted_days_to_next_stage": <number>,
        "predicted_final_stage": "<sold|failed|returned>",
        "predicted_sale_probability_pct": <number 0-100>,
        "predicted_sale_price_eur": <number>,
        "stage_efficiency_score": <number 0-100>
      },
      "optimal_action": "<max 120 znakov>",
      "action_priority": "<high|medium|low>",
      "expected_impact_eur": <number>,
      "bottleneck": "<max 100 znakov>",
      "acceleration_opportunity": "<max 120 znakov>"
    }
  ],
  "stages": [
    {
      "stage": "<12 faz>",
      "item_count": <number>,
      "avg_days_in_stage": <number>,
      "optimal_days_in_stage": <number>,
      "efficiency_pct": <number 0-100>,
      "bottleneck_description": "<max 120 znakov>",
      "improvement_action": "<max 150 znakov>",
      "expected_time_savings_days": <number>
    }
  ],
  "transitions": [
    {
      "from_stage": "<12 faz>",
      "to_stage": "<12 faz>",
      "avg_transition_days": <number>,
      "optimal_transition_days": <number>,
      "transition_probability_pct": <number 0-100>,
      "blockers": ["<max 80 znakov>"],
      "accelerators": ["<max 80 znakov>"]
    }
  ],
  "ml_predictions": [
    {
      "metric": "<days_to_next_stage|final_stage|sale_probability|sale_price|stage_efficiency>",
      "avg_value": <number>,
      "min_value": <number>,
      "max_value": <number>,
      "confidence_pct": <number 0-100>,
      "trend": "<improving|declining|stable>"
    }
  ],
  "optimal_actions": [
    {
      "action": "<max 150 znakov>",
      "stage_targeted": "<12 faz ali all>",
      "priority": "<high|medium|low>",
      "expected_time_savings_days": <number>,
      "expected_revenue_impact_eur": <number>,
      "implementation_effort": "<low|medium|high>"
    }
  ],
  "summary": {
    "total_items_analyzed": <number>,
    "avg_stage_efficiency_pct": <number>,
    "bottleneck_stage": "<max 80 znakov>",
    "best_performing_stage": "<max 80 znakov>",
    "total_expected_time_savings_days": <number>,
    "total_expected_revenue_impact_eur": <number>,
    "lifecycle_optimization_score": <number 0-100>,
    "biggest_opportunity": "<max 100 znakov>"
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
    const validIds = new Set(items.map(i => i.id));

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      items: (parsed?.items || [])
        .filter((it: any) => validIds.has(String(it?.id ?? '')))
        .slice(0, 30)
        .map((it: any) => {
          const orig = items.find(x => x.id === String(it?.id));
          return {
            tradeId: String(it?.id ?? ''),
            title: String(it?.title ?? orig?.title ?? '').slice(0, 150),
            currentStage: LIFECYCLE_STAGES.includes(String(it?.current_stage) as any) ? String(it.current_stage) : (orig?.currentStage ?? 'active_marketing'),
            daysInCurrentStage: Math.max(0, Number(it?.days_in_current_stage ?? orig?.daysHeld ?? 0)),
            nextOptimalStage: LIFECYCLE_STAGES.includes(String(it?.next_optimal_stage) as any) ? String(it.next_optimal_stage) : 'active_marketing',
            stageTransitionReadinessPct: Math.max(0, Math.min(100, Number(it?.stage_transition_readiness_pct ?? 50))),
            mlPredictions: {
              predictedDaysToNextStage: Math.max(0, Math.round(Number(it?.ml_predictions?.predicted_days_to_next_stage ?? 7))),
              predictedFinalStage: ['sold', 'failed', 'returned'].includes(String(it?.ml_predictions?.predicted_final_stage)) ? String(it.ml_predictions.predicted_final_stage) : 'sold',
              predictedSaleProbabilityPct: Math.max(0, Math.min(100, Number(it?.ml_predictions?.predicted_sale_probability_pct ?? 50))),
              predictedSalePriceEur: Math.max(0, Math.round(Number(it?.ml_predictions?.predicted_sale_price_eur ?? orig?.estValue ?? 0))),
              stageEfficiencyScore: Math.max(0, Math.min(100, Number(it?.ml_predictions?.stage_efficiency_score ?? 60))),
            },
            optimalAction: String(it?.optimal_action ?? '').slice(0, 250),
            actionPriority: ['high', 'medium', 'low'].includes(String(it?.action_priority)) ? String(it.action_priority) : 'medium',
            expectedImpactEur: Math.round(Number(it?.expected_impact_eur ?? 0)),
            bottleneck: String(it?.bottleneck ?? '').slice(0, 200),
            accelerationOpportunity: String(it?.acceleration_opportunity ?? '').slice(0, 250),
          };
        }),
      stages: (parsed?.stages || []).slice(0, 12).map((s: any) => ({
        stage: LIFECYCLE_STAGES.includes(String(s?.stage) as any) ? String(s.stage) : 'active_marketing',
        itemCount: Math.max(0, Number(s?.item_count ?? 0)),
        avgDaysInStage: Math.max(0, Number(s?.avg_days_in_stage ?? 0)),
        optimalDaysInStage: Math.max(0, Number(s?.optimal_days_in_stage ?? 0)),
        efficiencyPct: Math.max(0, Math.min(100, Number(s?.efficiency_pct ?? 50))),
        bottleneckDescription: String(s?.bottleneck_description ?? '').slice(0, 250),
        improvementAction: String(s?.improvement_action ?? '').slice(0, 300),
        expectedTimeSavingsDays: Math.max(0, Number(s?.expected_time_savings_days ?? 0)),
      })),
      transitions: (parsed?.transitions || []).slice(0, 11).map((t: any) => ({
        fromStage: LIFECYCLE_STAGES.includes(String(t?.from_stage) as any) ? String(t.from_stage) : 'acquisition',
        toStage: LIFECYCLE_STAGES.includes(String(t?.to_stage) as any) ? String(t.to_stage) : 'intake',
        avgTransitionDays: Math.max(0, Number(t?.avg_transition_days ?? 0)),
        optimalTransitionDays: Math.max(0, Number(t?.optimal_transition_days ?? 0)),
        transitionProbabilityPct: Math.max(0, Math.min(100, Number(t?.transition_probability_pct ?? 50))),
        blockers: (t?.blockers || []).slice(0, 4).map((b: any) => String(b).slice(0, 150)),
        accelerators: (t?.accelerators || []).slice(0, 4).map((a: any) => String(a).slice(0, 150)),
      })),
      mlPredictions: (parsed?.ml_predictions || []).slice(0, 5).map((m: any) => ({
        metric: ['days_to_next_stage', 'final_stage', 'sale_probability', 'sale_price', 'stage_efficiency'].includes(String(m?.metric)) ? String(m.metric) : 'sale_probability',
        avgValue: Math.round(Number(m?.avg_value ?? 0) * 100) / 100,
        minValue: Math.round(Number(m?.min_value ?? 0) * 100) / 100,
        maxValue: Math.round(Number(m?.max_value ?? 0) * 100) / 100,
        confidencePct: Math.max(0, Math.min(100, Number(m?.confidence_pct ?? 50))),
        trend: ['improving', 'declining', 'stable'].includes(String(m?.trend)) ? String(m.trend) : 'stable',
      })),
      optimalActions: (parsed?.optimal_actions || []).slice(0, 8).map((a: any) => ({
        action: String(a?.action ?? '').slice(0, 300),
        stageTargeted: String(a?.stage_targeted ?? 'all').slice(0, 30),
        priority: ['high', 'medium', 'low'].includes(String(a?.priority)) ? String(a.priority) : 'medium',
        expectedTimeSavingsDays: Math.max(0, Number(a?.expected_time_savings_days ?? 0)),
        expectedRevenueImpactEur: Math.round(Number(a?.expected_revenue_impact_eur ?? 0)),
        implementationEffort: ['low', 'medium', 'high'].includes(String(a?.implementation_effort)) ? String(a.implementation_effort) : 'medium',
      })),
      summary: {
        totalItemsAnalyzed: items.length,
        avgStageEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_stage_efficiency_pct ?? 50))),
        bottleneckStage: String(parsed?.summary?.bottleneck_stage ?? '').slice(0, 150),
        bestPerformingStage: String(parsed?.summary?.best_performing_stage ?? '').slice(0, 150),
        totalExpectedTimeSavingsDays: Math.max(0, Number(parsed?.summary?.total_expected_time_savings_days ?? 0)),
        totalExpectedRevenueImpactEur: Math.round(Number(parsed?.summary?.total_expected_revenue_impact_eur ?? 0)),
        lifecycleOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.lifecycle_optimization_score ?? 50))),
        biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 200),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
