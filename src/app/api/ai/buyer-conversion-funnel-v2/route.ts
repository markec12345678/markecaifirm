// v6.57 / v8.95.9-buyer-medium: AI Buyer Conversion Funnel v2 — advanced funnel z ML stage analysis in optimization
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-conversion-funnel-v2
// Body: { customerName?: string, days?: number }
// Returns: { ok, funnel: { stages, dropoffs, mlAnalysis, optimizations, experiments, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BuyerConversionFunnelV2Input {
  customerName: string | null;
  days: number;
}

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  sellLocation: string;
  buyDate: Date | null;
  listing: {
    contactStatus: string | null;
    contactedAt: Date | null;
    sellerResponse: string | null;
    dealScore: number | null;
    aiScore: number | null;
    aiRisk: number | null;
    firstSeenAt: Date | null;
  } | null;
}

interface ContactedListingRow {
  id: string;
  title: string;
  contactStatus: string | null;
  contactedAt: Date | null;
  sellerResponse: string | null;
  aiScore: number | null;
  dealScore: number | null;
  firstSeenAt: Date | null;
}

interface FunnelCounts {
  totalImpressions: number;
  totalViews: number;
  totalEngagement: number;
  totalInquiries: number;
  totalQualification: number;
  totalConsideration: number;
  totalNegotiation: number;
  totalCommitment: number;
  totalPayment: number;
  totalCompletion: number;
}

const FUNNEL_STAGES = [
  'impression',     // listing viden v search
  'view',           // klik in ogled oglasa
  'engagement',     // like, share, save
  'inquiry',        // pošlje sporočilo
  'qualification',  // preveri stanje, lokacijo
  'consideration',  // razmišlja, primerja
  'negotiation',    // pogaja se o ceni
  'commitment',     // obljubi nakup
  'payment',        // plača
  'completion',     // prevzame item
] as const;

const OPTIMIZATION_TYPES = [
  'title_improvement', 'description_improvement', 'price_adjustment',
  'response_speed', 'trust_building', 'urgency_injection',
  'follow_up', 'payment_options',
] as const;

const ML_METRICS = [
  'stage_conversion_rate', 'drop_off_probability',
  'time_in_stage', 'optimization_potential',
] as const;

const EXPERIMENT_METRICS = ['conversion_rate', 'drop_off_rate', 'time_in_stage'] as const;
const TRENDS = ['improving', 'declining', 'stable'] as const;
const EFFORTS = ['low', 'medium', 'high'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;

export const POST = withAiRoute<BuyerConversionFunnelV2Input>({
  endpoint: '/api/ai/buyer-conversion-funnel-v2',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      customerName: body?.customerName ? String(body.customerName).trim() : null,
      days: Math.max(7, Math.min(365, Number(body?.days ?? 90))),
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { customerName, days } = input;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const soldTrades: SoldTradeRow[] = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null, gte: since } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true,
        listing: { select: { contactStatus: true, contactedAt: true, sellerResponse: true, dealScore: true, aiScore: true, aiRisk: true, firstSeenAt: true } } },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    // Pridobi tudi listings z contact status (za funnel analysis)
    const contactedListings: ContactedListingRow[] = await db.listing.findMany({
      where: { contactStatus: { not: 'none' }, firstSeenAt: { gte: since } },
      select: { id: true, title: true, contactStatus: true, contactedAt: true, sellerResponse: true, aiScore: true, dealScore: true, firstSeenAt: true },
      take: 500,
      orderBy: { firstSeenAt: 'desc' },
    });

    if (soldTrades.length === 0 && contactedListings.length === 0) {
      return apiOk({ ok: true, funnel: null, message: 'Ni podatkov za funnel analizo.' });
    }

    const counts = computeFunnelCounts(soldTrades.length, contactedListings);
    const prompt = buildPrompt(counts, soldTrades.length, contactedListings.length, days, customerName);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const funnel = transformFunnel(parsed, counts);

    return apiOk({ ok: true, funnel });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function computeFunnelCounts(soldTradesCount: number, contactedListings: ContactedListingRow[]): FunnelCounts {
  const totalImpressions = contactedListings.length + soldTradesCount; // approximate
  const totalViews = Math.round(totalImpressions * 0.3); // 30% click rate
  const totalEngagement = Math.round(totalViews * 0.15); // 15% engagement
  const totalInquiries = contactedListings.length;
  const totalQualification = contactedListings.filter(l => l.sellerResponse).length;
  const totalConsideration = Math.round(totalQualification * 0.7);
  const totalNegotiation = soldTradesCount;
  const totalCommitment = Math.round(totalNegotiation * 0.85);
  const totalPayment = soldTradesCount;
  const totalCompletion = soldTradesCount;
  return {
    totalImpressions, totalViews, totalEngagement, totalInquiries,
    totalQualification, totalConsideration, totalNegotiation,
    totalCommitment, totalPayment, totalCompletion,
  };
}

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function buildPrompt(counts: FunnelCounts, soldTradesCount: number, contactedListingsCount: number, days: number, customerName: string | null): string {
  return `Si AI buyer conversion funnel v2 z ML stage analysis.
Analiziraj 10-fazni conversion funnel z dropoff reasons in optimization strategijami.

FUNNEL PODATKI (zadnjih ${days} dni):
- Impressions (oglasi videni): ${counts.totalImpressions}
- Views (klik in ogled): ${counts.totalViews}
- Engagement (like/share/save): ${counts.totalEngagement}
- Inquiries (sporočila poslana): ${counts.totalInquiries}
- Qualification (response prejet): ${counts.totalQualification}
- Consideration (razmišlja): ${counts.totalConsideration}
- Negotiation (pogaja se): ${counts.totalNegotiation}
- Commitment (obljubi nakup): ${counts.totalCommitment}
- Payment (plača): ${counts.totalPayment}
- Completion (prevzame): ${counts.totalCompletion}

Skupno prodano: ${soldTradesCount}
Skupno kontaktiranih listingov: ${contactedListingsCount}

${customerName ? `SPECIFIČEN KUPEC: ${customerName}` : 'Vsi kupci'}

10-fazni funnel:
1. IMPRESSION: oglas viden v search results
2. VIEW: kupec klikne in si ogleda oglas
3. ENGAGEMENT: like, share, save, scroll
4. INQUIRY: pošlje sporočilo vendar še ne kupi
5. QUALIFICATION: preveri stanje, lokacijo, pogoje
6. CONSIDERATION: razmišlja, primerja z drugimi
7. NEGOTIATION: pogaja se o ceni
8. COMMITMENT: obljubi nakup (dogovor)
9. PAYMENT: plača (depozit ali celotno)
10. COMPLETION: prevzame item, transakcija končana

Dropoff reasons per stage:
- IMPRESSION→VIEW: slab naslov, slaba slika, nizka pozicija v search
- VIEW→ENGAGEMENT: dolg opis, slaba slika, nejasna cena
- ENGAGEMENT→INQUIRY: visoka cena, slava negotovost, konkurenca
- INQUIRY→QUALIFICATION: počasen response, nejasni pogoji
- QUALIFICATION→CONSIDERATION: slaba komunikacija, nezaupanje
- CONSIDERATION→NEGOTIATION: cena previsoka, najde ceneje
- NEGOTIATION→COMMITMENT: neprilagodljivost, časovni pritisk
- COMMITMENT→PAYMENT: payment issues, drugi misli
- PAYMENT→COMPLETION: logistika, meetup problemi

ML analiza:
- STAGE_CONVERSION_RATE: % ki preide v naslednjo fazo
- DROP_OFF_PROBABILITY: verjetnost da kupec odide
- TIME_IN_STAGE: povprečen čas v vsaki fazi
- STAGE_OPTIMIZATION_POTENTIAL: koliko lahko izboljšamo

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "stages": [
    {
      "stage": "<10 faz>",
      "count": <number>,
      "conversion_rate_to_next_pct": <number 0-100>,
      "drop_off_count": <number>,
      "drop_off_pct": <number 0-100>,
      "avg_time_in_stage_hours": <number>,
      "ml_predictions": {
        "stage_conversion_probability_pct": <number 0-100>,
        "drop_off_probability_pct": <number 0-100>,
        "optimization_potential_pct": <number 0-100>
      },
      "biggest_drop_reason": "<max 100 znakov>",
      "improvement_action": "<max 150 znakov>"
    }
  ],
  "dropoffs": [
    {
      "from_stage": "<10 faz>",
      "to_stage": "<10 faz>",
      "drop_off_count": <number>,
      "drop_off_pct": <number 0-100>,
      "primary_reason": "<max 100 znakov>",
      "secondary_reasons": ["<max 80 znakov>"],
      "recoverable_pct": <number 0-100>,
      "recovery_strategy": "<max 150 znakov>"
    }
  ],
  "ml_analysis": [
    {
      "metric": "<stage_conversion_rate|drop_off_probability|time_in_stage|optimization_potential>",
      "avg_value": <number>,
      "min_value": <number>,
      "max_value": <number>,
      "best_performing_stage": "<10 faz>",
      "worst_performing_stage": "<10 faz>",
      "trend": "<improving|declining|stable>",
      "confidence_pct": <number 0-100>
    }
  ],
  "optimizations": [
    {
      "stage": "<10 faz>",
      "optimization_type": "<title_improvement|description_improvement|price_adjustment|response_speed|trust_building|urgency_injection|follow_up|payment_options>",
      "description": "<max 120 znakov>",
      "expected_conversion_lift_pct": <number>,
      "implementation_effort": "<low|medium|high>",
      "expected_revenue_impact_eur": <number>,
      "priority": "<high|medium|low>"
    }
  ],
  "experiments": [
    {
      "experiment_name": "<max 80 znakov>",
      "stage_targeted": "<10 faz>",
      "hypothesis": "<max 150 znakov>",
      "variant_a": "<max 100 znakov>",
      "variant_b": "<max 100 znakov>",
      "primary_metric": "<conversion_rate|drop_off_rate|time_in_stage>",
      "expected_lift_pct": <number>,
      "test_duration_days": <number>,
      "sample_size_needed": <number>
    }
  ],
  "summary": {
    "total_impressions": <number>,
    "total_completions": <number>,
    "overall_conversion_rate_pct": <number>,
    "biggest_dropoff_stage": "<max 80 znakov>",
    "biggest_dropoff_pct": <number>,
    "best_performing_stage": "<max 80 znakov>",
    "total_recoverable_conversions": <number>,
    "total_recoverable_revenue_eur": <number>,
    "avg_time_to_completion_days": <number>,
    "funnel_efficiency_score": <number 0-100>
  }
}`;
}

function transformFunnel(parsed: any, counts: FunnelCounts): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    stages: (parsed?.stages || []).slice(0, 10).map((s: any) => ({
      stage: includes(FUNNEL_STAGES, String(s?.stage)) ? String(s.stage) : 'impression',
      count: Math.max(0, Number(s?.count ?? 0)),
      conversionRateToNextPct: Math.max(0, Math.min(100, Number(s?.conversion_rate_to_next_pct ?? 50))),
      dropOffCount: Math.max(0, Number(s?.drop_off_count ?? 0)),
      dropOffPct: Math.max(0, Math.min(100, Number(s?.drop_off_pct ?? 50))),
      avgTimeInStageHours: Math.round(Number(s?.avg_time_in_stage_hours ?? 0) * 10) / 10,
      mlPredictions: {
        stageConversionProbabilityPct: Math.max(0, Math.min(100, Number(s?.ml_predictions?.stage_conversion_probability_pct ?? 50))),
        dropOffProbabilityPct: Math.max(0, Math.min(100, Number(s?.ml_predictions?.drop_off_probability_pct ?? 50))),
        optimizationPotentialPct: Math.max(0, Math.min(100, Number(s?.ml_predictions?.optimization_potential_pct ?? 30))),
      },
      biggestDropReason: String(s?.biggest_drop_reason ?? '').slice(0, 200),
      improvementAction: String(s?.improvement_action ?? '').slice(0, 300),
    })),
    dropoffs: (parsed?.dropoffs || []).slice(0, 9).map((d: any) => ({
      fromStage: includes(FUNNEL_STAGES, String(d?.from_stage)) ? String(d.from_stage) : 'impression',
      toStage: includes(FUNNEL_STAGES, String(d?.to_stage)) ? String(d.to_stage) : 'view',
      dropOffCount: Math.max(0, Number(d?.drop_off_count ?? 0)),
      dropOffPct: Math.max(0, Math.min(100, Number(d?.drop_off_pct ?? 30))),
      primaryReason: String(d?.primary_reason ?? '').slice(0, 200),
      secondaryReasons: (d?.secondary_reasons || []).slice(0, 4).map((r: any) => String(r).slice(0, 150)),
      recoverablePct: Math.max(0, Math.min(100, Number(d?.recoverable_pct ?? 30))),
      recoveryStrategy: String(d?.recovery_strategy ?? '').slice(0, 300),
    })),
    mlAnalysis: (parsed?.ml_analysis || []).slice(0, 4).map((m: any) => ({
      metric: includes(ML_METRICS, String(m?.metric)) ? String(m.metric) : 'stage_conversion_rate',
      avgValue: Math.round(Number(m?.avg_value ?? 0) * 100) / 100,
      minValue: Math.round(Number(m?.min_value ?? 0) * 100) / 100,
      maxValue: Math.round(Number(m?.max_value ?? 0) * 100) / 100,
      bestPerformingStage: includes(FUNNEL_STAGES, String(m?.best_performing_stage)) ? String(m.best_performing_stage) : 'impression',
      worstPerformingStage: includes(FUNNEL_STAGES, String(m?.worst_performing_stage)) ? String(m.worst_performing_stage) : 'impression',
      trend: includes(TRENDS, String(m?.trend)) ? String(m.trend) : 'stable',
      confidencePct: Math.max(0, Math.min(100, Number(m?.confidence_pct ?? 50))),
    })),
    optimizations: (parsed?.optimizations || []).slice(0, 10).map((o: any) => ({
      stage: includes(FUNNEL_STAGES, String(o?.stage)) ? String(o.stage) : 'impression',
      optimizationType: includes(OPTIMIZATION_TYPES, String(o?.optimization_type)) ? String(o.optimization_type) : 'title_improvement',
      description: String(o?.description ?? '').slice(0, 250),
      expectedConversionLiftPct: Math.round(Number(o?.expected_conversion_lift_pct ?? 0)),
      implementationEffort: includes(EFFORTS, String(o?.implementation_effort)) ? String(o.implementation_effort) : 'medium',
      expectedRevenueImpactEur: Math.round(Number(o?.expected_revenue_impact_eur ?? 0)),
      priority: includes(PRIORITIES, String(o?.priority)) ? String(o.priority) : 'medium',
    })),
    experiments: (parsed?.experiments || []).slice(0, 6).map((e: any) => ({
      experimentName: String(e?.experiment_name ?? '').slice(0, 150),
      stageTargeted: includes(FUNNEL_STAGES, String(e?.stage_targeted)) ? String(e.stage_targeted) : 'impression',
      hypothesis: String(e?.hypothesis ?? '').slice(0, 300),
      variantA: String(e?.variant_a ?? '').slice(0, 200),
      variantB: String(e?.variant_b ?? '').slice(0, 200),
      primaryMetric: includes(EXPERIMENT_METRICS, String(e?.primary_metric)) ? String(e.primary_metric) : 'conversion_rate',
      expectedLiftPct: Math.round(Number(e?.expected_lift_pct ?? 0)),
      testDurationDays: Math.max(1, Number(e?.test_duration_days ?? 7)),
      sampleSizeNeeded: Math.max(30, Number(e?.sample_size_needed ?? 100)),
    })),
    summary: {
      totalImpressions: Math.max(0, Number(parsed?.summary?.total_impressions ?? counts.totalImpressions)),
      totalCompletions: Math.max(0, Number(parsed?.summary?.total_completions ?? counts.totalCompletion)),
      overallConversionRatePct: Math.max(0, Math.min(100, Number(parsed?.summary?.overall_conversion_rate_pct ?? (counts.totalImpressions > 0 ? Math.round((counts.totalCompletion / counts.totalImpressions) * 1000) / 10 : 0)))),
      biggestDropoffStage: includes(FUNNEL_STAGES, String(parsed?.summary?.biggest_dropoff_stage)) ? String(parsed.summary.biggest_dropoff_stage) : 'impression',
      biggestDropoffPct: Math.round(Number(parsed?.summary?.biggest_dropoff_pct ?? 0) * 10) / 10,
      bestPerformingStage: includes(FUNNEL_STAGES, String(parsed?.summary?.best_performing_stage)) ? String(parsed.summary.best_performing_stage) : 'impression',
      totalRecoverableConversions: Math.max(0, Number(parsed?.summary?.total_recoverable_conversions ?? 0)),
      totalRecoverableRevenueEur: Math.round(Number(parsed?.summary?.total_recoverable_revenue_eur ?? 0)),
      avgTimeToCompletionDays: Math.round(Number(parsed?.summary?.avg_time_to_completion_days ?? 14)),
      funnelEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.funnel_efficiency_score ?? 50))),
    },
  };
}
