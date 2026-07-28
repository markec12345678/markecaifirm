// v6.52: AI Pricing Psychology Optimizer — psihološke cene (99€, 199€, anchor, decoy, charm pricing)
// POST /api/ai/pricing-psychology-optimizer
// Body: { tradeId?: string }
// Returns: { ok, optimizer: { items, techniques, anchorAnalysis, abTestPlan, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

// Pricing psychology techniques
const PRICING_TECHNIQUES = [
  'charm_pricing',     // 99€ namesto 100€
  'round_number',      // 200€ za "premium" feel
  'price_anchoring',   // visoka referenčna cena zraven
  'decoy_pricing',     // drago sidro da drugi izgleda ugodno
  'bundle_pricing',    // paket ceneje kot individualno
  'penetration',       // nizka začetna cena za hitro prodajo
  'premium_pricing',   // višja cena za prestiž
  'psychological_threshold', // 99/199/299/499/999 pragovi
  'odd_even_pricing',  // lihe cene za "deal", sode za "premium"
  'loss_leader',       // pod cost da privabi kupca
  'dynamic_pricing',   // prilagodljiva cena glede na demand
  'tiered_pricing',    // bronze/silver/gold paketi
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
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true, location: true, description: true } },
      },
      take: tradeId ? 1 : 25,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, optimizer: null, message: 'Ni held tradeov za pricing psychology analizo.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const items = heldTrades.map(t => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));
      const currentMarginPct = cost > 0 ? Math.round(((estValue - cost) / cost) * 100) : 0;
      return {
        id: t.id, title: t.title, category: t.category || 'drugo',
        cost, estValue, daysHeld, currentMarginPct,
        dealScore: t.listing?.dealScore ?? 50, aiRisk: t.listing?.aiRisk ?? 5,
      };
    });

    const itemsStr = items.map(i =>
      `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ (margin ${i.currentMarginPct}%) | ${i.daysHeld}d | deal ${i.dealScore}/100`
    ).join('\n');

    const prompt = `Si AI pricing psychology optimizer za slovenske oglasne platforme.
Optimiziraj cene z uporabo psiholoških tehnik za maksimalno konverzijo in profit.

INVENTAR (${items.length}):
${itemsStr}

12 psiholoških tehnik:
1. CHARM_PRICING: cene se končajo na 9 (99€, 199€, 299€) — perceived cheaper
2. ROUND_NUMBER: okrogle cene (200€, 500€) za "premium" feel
3. PRICE_ANCHORING: visoka referenčna cena zraven ("prej 350€, sedaj 199€")
4. DECOY_PRICING: drago sidro (500€) da srednja (250€) izgleda ugodno
5. BUNDLE_PRICING: paket ceneje kot posamezno ("3 za 50€ namesto 20€/1")
6. PENETRATION: nizka začetna cena za hitro prodajo in reviews
7. PREMIUM_PRICING: višja cena za prestiž in quality signaling
8. PSYCHOLOGICAL_THRESHOLD: 99/199/299/499/999 pragovi (pod 200 izgleda ceneje)
9. ODD_EVEN: lihe cene (199€) za deal feel, sode (200€) za premium
10. LOSS_LEADER: pod cost da privabi kupca za druge iteme
11. DYNAMIC_PRICING: prilagodi glede na demand, čas, konkurenco
12. TIERED_PRICING: bronze/silver/gold paketi z razliko v value

Threshold pragi (psihološke meje):
- 99€ (pod 100) — "povoljno"
- 199€ (pod 200) — "razumno"
- 299€ (pod 300) — "investicija"
- 499€ (pod 500) — "premium"
- 999€ (pod 1000) — "luxury entry"
- 1999€ (pod 2000) — "high-end"

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "current_price_eur": <number>,
      "recommended_technique": "<charm_pricing|round_number|price_anchoring|decoy_pricing|bundle_pricing|penetration|premium_pricing|psychological_threshold|odd_even_pricing|loss_leader|dynamic_pricing|tiered_pricing>",
      "recommended_price_eur": <number>,
      "anchor_price_eur": <number ali null>,
      "psychological_savings_eur": <number>,
      "expected_conversion_lift_pct": <number>,
      "expected_profit_eur": <number>,
      "buyer_perception": "<cheap|fair|premium|luxury|deal|overpriced>",
      "reasoning": "<max 150 znakov>"
    }
  ],
  "techniques": [
    {
      "technique": "<charm_pricing|round_number|price_anchoring|decoy_pricing|bundle_pricing|penetration|premium_pricing|psychological_threshold|odd_even_pricing|loss_leader|dynamic_pricing|tiered_pricing>",
      "description": "<max 120 znakov>",
      "best_for": "<max 100 znakov>",
      "example": "<max 80 znakov>",
      "expected_conversion_lift_pct": <number>,
      "implementation_difficulty": "<low|medium|high>"
    }
  ],
  "anchor_analysis": [
    {
      "item_id": "<trade_id>",
      "current_price_eur": <number>,
      "proposed_anchor_eur": <number>,
      "anchor_type": "<high_reference|comparable|bundle|original_msrp>",
      "savings_display_eur": <number>,
      "savings_display_pct": <number>,
      "expected_perceived_value_eur": <number>,
      "psychological_impact": "<max 100 znakov>"
    }
  ],
  "ab_test_plan": [
    {
      "item_id": "<trade_id>",
      "variant_a_price_eur": <number>,
      "variant_a_technique": "<technique>",
      "variant_b_price_eur": <number>,
      "variant_b_technique": "<technique>",
      "test_duration_days": <number>,
      "primary_metric": "<conversion_rate|revenue|time_to_sell>",
      "expected_winner": "<a|b>",
      "confidence_threshold_pct": <number>
    }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_revenue_lift_eur": <number>, "items_affected": <number> }
  ],
  "summary": {
    "total_items_analyzed": <number>,
    "avg_current_price_eur": <number>,
    "avg_recommended_price_eur": <number>,
    "total_expected_revenue_lift_eur": <number>,
    "avg_expected_conversion_lift_pct": <number>,
    "best_technique_overall": "<max 80 znakov>",
    "best_technique_avg_lift_pct": <number>,
    "items_below_threshold": <number>,
    "pricing_psychology_score": <number 0-100>
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
        .slice(0, 25)
        .map((it: any) => {
          const orig = items.find(x => x.id === String(it?.id));
          return {
            tradeId: String(it?.id ?? ''),
            title: String(it?.title ?? orig?.title ?? '').slice(0, 150),
            currentPriceEur: Math.max(0, Math.round(Number(it?.current_price_eur ?? orig?.estValue ?? 0))),
            recommendedTechnique: PRICING_TECHNIQUES.includes(String(it?.recommended_technique) as any) ? String(it.recommended_technique) : 'charm_pricing',
            recommendedPriceEur: Math.max(0, Math.round(Number(it?.recommended_price_eur ?? orig?.estValue ?? 0))),
            anchorPriceEur: it?.anchor_price_eur !== null && it?.anchor_price_eur !== undefined ? Math.max(0, Math.round(Number(it.anchor_price_eur))) : null,
            psychologicalSavingsEur: Math.round(Number(it?.psychological_savings_eur ?? 0)),
            expectedConversionLiftPct: Math.round(Number(it?.expected_conversion_lift_pct ?? 0)),
            expectedProfitEur: Math.round(Number(it?.expected_profit_eur ?? 0)),
            buyerPerception: ['cheap', 'fair', 'premium', 'luxury', 'deal', 'overpriced'].includes(String(it?.buyer_perception)) ? String(it.buyer_perception) : 'fair',
            reasoning: String(it?.reasoning ?? '').slice(0, 300),
          };
        }),
      techniques: (parsed?.techniques || []).slice(0, 12).map((t: any) => ({
        technique: PRICING_TECHNIQUES.includes(String(t?.technique) as any) ? String(t.technique) : 'charm_pricing',
        description: String(t?.description ?? '').slice(0, 250),
        bestFor: String(t?.best_for ?? '').slice(0, 200),
        example: String(t?.example ?? '').slice(0, 150),
        expectedConversionLiftPct: Math.round(Number(t?.expected_conversion_lift_pct ?? 0)),
        implementationDifficulty: ['low', 'medium', 'high'].includes(String(t?.implementation_difficulty)) ? String(t.implementation_difficulty) : 'low',
      })),
      anchorAnalysis: (parsed?.anchor_analysis || [])
        .filter((a: any) => validIds.has(String(a?.item_id ?? '')))
        .slice(0, 15)
        .map((a: any) => {
          const orig = items.find(x => x.id === String(a?.item_id));
          return {
            tradeId: String(a?.item_id ?? ''),
            currentPriceEur: Math.max(0, Math.round(Number(a?.current_price_eur ?? orig?.estValue ?? 0))),
            proposedAnchorEur: Math.max(0, Math.round(Number(a?.proposed_anchor_eur ?? 0))),
            anchorType: ['high_reference', 'comparable', 'bundle', 'original_msrp'].includes(String(a?.anchor_type)) ? String(a.anchor_type) : 'high_reference',
            savingsDisplayEur: Math.round(Number(a?.savings_display_eur ?? 0)),
            savingsDisplayPct: Math.round(Number(a?.savings_display_pct ?? 0)),
            expectedPerceivedValueEur: Math.round(Number(a?.expected_perceived_value_eur ?? 0)),
            psychologicalImpact: String(a?.psychological_impact ?? '').slice(0, 200),
          };
        }),
      abTestPlan: (parsed?.ab_test_plan || [])
        .filter((t: any) => validIds.has(String(t?.item_id ?? '')))
        .slice(0, 15)
        .map((t: any) => ({
          tradeId: String(t?.item_id ?? ''),
          variantAPriceEur: Math.max(0, Math.round(Number(t?.variant_a_price_eur ?? 0))),
          variantATechnique: PRICING_TECHNIQUES.includes(String(t?.variant_a_technique) as any) ? String(t.variant_a_technique) : 'charm_pricing',
          variantBPriceEur: Math.max(0, Math.round(Number(t?.variant_b_price_eur ?? 0))),
          variantBTechnique: PRICING_TECHNIQUES.includes(String(t?.variant_b_technique) as any) ? String(t.variant_b_technique) : 'round_number',
          testDurationDays: Math.max(1, Math.min(30, Number(t?.test_duration_days ?? 7))),
          primaryMetric: ['conversion_rate', 'revenue', 'time_to_sell'].includes(String(t?.primary_metric)) ? String(t.primary_metric) : 'conversion_rate',
          expectedWinner: ['a', 'b'].includes(String(t?.expected_winner)) ? String(t.expected_winner) : 'a',
          confidenceThresholdPct: Math.round(Number(t?.confidence_threshold_pct ?? 95)),
        })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        expectedRevenueLiftEur: Math.round(Number(r?.expected_revenue_lift_eur ?? 0)),
        itemsAffected: Math.max(0, Number(r?.items_affected ?? 0)),
      })),
      summary: {
        totalItemsAnalyzed: items.length,
        avgCurrentPriceEur: Math.round(Number(parsed?.summary?.avg_current_price_eur ?? items.reduce((s, i) => s + i.estValue, 0) / Math.max(1, items.length))),
        avgRecommendedPriceEur: Math.round(Number(parsed?.summary?.avg_recommended_price_eur ?? items.reduce((s, i) => s + i.estValue, 0) / Math.max(1, items.length))),
        totalExpectedRevenueLiftEur: Math.round(Number(parsed?.summary?.total_expected_revenue_lift_eur ?? 0)),
        avgExpectedConversionLiftPct: Math.round(Number(parsed?.summary?.avg_expected_conversion_lift_pct ?? 0)),
        bestTechniqueOverall: PRICING_TECHNIQUES.includes(String(parsed?.summary?.best_technique_overall) as any) ? String(parsed.summary.best_technique_overall) : 'charm_pricing',
        bestTechniqueAvgLiftPct: Math.round(Number(parsed?.summary?.best_technique_avg_lift_pct ?? 0)),
        itemsBelowThreshold: Math.max(0, Number(parsed?.summary?.items_below_threshold ?? 0)),
        pricingPsychologyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.pricing_psychology_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
