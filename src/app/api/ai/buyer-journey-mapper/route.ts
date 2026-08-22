// v6.50 / v8.95.9-buyer-medium: AI Buyer Journey Mapper — maps kupčevo pot od awareness do purchase z 5 fazami
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-journey-mapper
// Body: { tradeId?: string, customerName?: string }
// Returns: { ok, mapper: { journeys, stages, touchpoints, optimizations, recommendations, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BuyerJourneyMapperInput {
  tradeId: string | null;
  customerName: string | null;
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
}

interface TargetTradeInfo {
  title: string;
  category: string;
  price: number;
}

interface BuyerJourney {
  buyerName: string;
  purchases: number;
  totalSpent: number;
  firstPurchase: Date | null;
  lastPurchase: Date | null;
  daysAsCustomer: number;
  daysSinceLastPurchase: number;
  categories: Set<string>;
  items: string[];
  stages: {
    awareness: number; // 0-100 probability buyer is in this stage
    consideration: number;
    decision: number;
    retention: number;
    advocacy: number;
  };
}

const JOURNEY_STAGES = ['awareness', 'consideration', 'decision', 'retention', 'advocacy'] as const;
const NEXT_STAGES = ['awareness', 'consideration', 'decision', 'retention', 'advocacy', 'completed'] as const;
const CHANNELS = ['bolha', 'facebook', 'vinted', 'email', 'sms', 'social', 'in_person'] as const;
const EFFORTS = ['low', 'medium', 'high'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;
const DAY = 24 * 60 * 60 * 1000;

export const POST = withAiRoute<BuyerJourneyMapperInput>({
  endpoint: '/api/ai/buyer-journey-mapper',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : null,
      customerName: body?.customerName ? String(body.customerName).trim() : null,
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId, customerName } = input;

    // 1. Pridobi sold trades za buyer journey
    const soldTrades: SoldTradeRow[] = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, mapper: null, message: 'Ni prodaj za buyer journey analizo.' });
    }

    // 2. Pridobi held trades za item context (če je tradeId podan)
    const targetTrade = tradeId ? await loadTargetTrade(db, tradeId) : null;

    // 3. Agregacija po buyer-ju
    const now = Date.now();
    const buyers = buildBuyers(soldTrades, now, DAY);

    if (customerName) {
      const filtered = buyers.filter(b => b.buyerName === customerName);
      if (filtered.length === 0) {
        return apiOk({ ok: true, mapper: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    const targetBuyers = customerName
      ? buyers.filter(b => b.buyerName === customerName)
      : buyers.slice(0, 20);

    const prompt = buildPrompt(targetBuyers, targetTrade);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const mapper = transformMapper(parsed, targetBuyers);

    return apiOk({ ok: true, mapper });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

async function loadTargetTrade(db: AiRouteContext['db'], tradeId: string): Promise<TargetTradeInfo | null> {
  const t = await db.trade.findUnique({
    where: { id: tradeId },
    select: { title: true, category: true, buyPrice: true, listing: { select: { aiEstimatedValue: true } } },
  });
  if (!t) return null;
  return {
    title: t.title,
    category: t.category || '',
    price: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
  };
}

function buildBuyers(soldTrades: SoldTradeRow[], now: number, DAY: number): BuyerJourney[] {
  const buyerMap = new Map<string, BuyerJourney>();
  for (const t of soldTrades) {
    const name = (t.sellLocation || '').trim();
    if (!name || name.length < 2 || !t.sellDate) continue;
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);

    if (!buyerMap.has(name)) {
      buyerMap.set(name, {
        buyerName: name,
        purchases: 0,
        totalSpent: 0,
        firstPurchase: t.sellDate,
        lastPurchase: t.sellDate,
        daysAsCustomer: 0,
        daysSinceLastPurchase: 0,
        categories: new Set<string>(),
        items: [],
        stages: { awareness: 0, consideration: 0, decision: 0, retention: 0, advocacy: 0 },
      });
    }
    const b = buyerMap.get(name)!;
    b.purchases += 1;
    b.totalSpent += revenue;
    if (t.sellDate < (b.firstPurchase as Date)) b.firstPurchase = t.sellDate;
    if (t.sellDate > b.lastPurchase!) b.lastPurchase = t.sellDate;
    if (t.category) b.categories.add(t.category);
    b.items.push(t.title);
  }

  // 4. Hevristika za stage detection
  return Array.from(buyerMap.values()).map(b => {
    if (b.firstPurchase && b.lastPurchase) {
      b.daysAsCustomer = Math.max(1, Math.round((now - b.firstPurchase.getTime()) / DAY));
      b.daysSinceLastPurchase = Math.round((now - b.lastPurchase.getTime()) / DAY);
    }

    // Awareness: nov kupec z 1 nakupom v zadnjih 30 dneh
    b.stages.awareness = b.purchases === 1 && b.daysSinceLastPurchase <= 30 ? 80 : 20;
    // Consideration: 1-2 nakupa, nedavni
    b.stages.consideration = b.purchases <= 2 && b.daysSinceLastPurchase <= 60 ? 70 : 30;
    // Decision: 2+ nakupa, high value
    b.stages.decision = b.purchases >= 2 && b.totalSpent > 200 ? 80 : 40;
    // Retention: repeat buyer, nedavno
    b.stages.retention = b.purchases >= 2 && b.daysSinceLastPurchase <= 90 ? 75 : 25;
    // Advocacy: 3+ nakupa, long-term
    b.stages.advocacy = b.purchases >= 3 && b.daysAsCustomer > 90 ? 70 : 20;

    return b;
  });
}

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function buildPrompt(targetBuyers: BuyerJourney[], targetTrade: TargetTradeInfo | null): string {
  const buyersStr = targetBuyers.map(b =>
    `- ${b.buyerName} | ${b.purchases}x | ${b.totalSpent}€ | ${b.daysAsCustomer}d kot kupec | ${b.daysSinceLastPurchase}d od zadnjega | kategorije: ${Array.from(b.categories).slice(0, 3).join(',')} | A:${b.stages.awareness} C:${b.stages.consideration} D:${b.stages.decision} R:${b.stages.retention} Ad:${b.stages.advocacy}`
  ).join('\n');

  const targetStr = targetTrade ? `CILJNI ITEM: "${targetTrade.title}" | ${targetTrade.category} | ${targetTrade.price}€\n` : '';

  return `Si AI buyer journey mapper za slovenske oglasne platforme.
Analiziraj kupčevo pot od awareness do advocacy in predlagaj touchpointe za vsako fazo.

${targetStr}KUPCI ZA ANALIZO (${targetBuyers.length}):
${buyersStr}

5 faz buyer journey:
1. AWARENESS (zavedanje) — kupec spozna da problem/želeno obstaja
2. CONSIDERATION (razmislek) — kupec raziskuje opcije, primerja
3. DECISION (odločitev) — kupec izbere in kupi
4. RETENTION (zadržanje) — kupec ponovno kupi, postaja loyal
5. ADVOCACY (zagovorništvo) — kupec priporoča drugim

Touchpoint-i per fazo:
- AWARENESS: Bolha search, social media ads, word-of-mouth, Google
- CONSIDERATION: Listing details, photos, comparison shopping, reviews
- DECISION: Price negotiation, condition check, location/meetup, payment
- RETENTION: Follow-up email, special offers, bundle deals, cross-sell
- ADVOCACY: Referral program, review request, social share incentive

Optimizacijske taktike per fazo:
- AWARENESS: SEO listing, social media presence, content marketing
- CONSIDERATION: Detailed description, multiple photos, comparison chart
- DECISION: Price match guarantee, fast response, secure payment
- RETENTION: Loyalty program, repeat discount, early access to new items
- ADVOCACY: Referral bonus, public testimonials, community building

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "journeys": [
    {
      "buyer_name": "<ime>",
      "current_stage": "<awareness|consideration|decision|retention|advocacy>",
      "stage_probabilities": {
        "awareness": <number 0-100>,
        "consideration": <number 0-100>,
        "decision": <number 0-100>,
        "retention": <number 0-100>,
        "advocacy": <number 0-100>
      },
      "stage_progression_pct": <number 0-100>,
      "next_stage": "<awareness|consideration|decision|retention|advocacy|completed>",
      "time_in_current_stage_days": <number>,
      "stage_conversion_probability_pct": <number 0-100>,
      "blockers": ["<max 80 znakov>"],
      "accelerators": ["<max 80 znakov>"]
    }
  ],
  "stages": [
    {
      "stage": "<awareness|consideration|decision|retention|advocacy>",
      "description": "<max 100 znakov>",
      "buyer_count": <number>,
      "avg_time_in_stage_days": <number>,
      "conversion_rate_to_next_pct": <number>,
      "key_actions": ["<max 80 znakov>"],
      "common_blockers": ["<max 80 znakov>"]
    }
  ],
  "touchpoints": [
    {
      "stage": "<awareness|consideration|decision|retention|advocacy>",
      "touchpoint": "<max 80 znakov>",
      "channel": "<bolha|facebook|vinted|email|sms|social|in_person>",
      "timing": "<max 80 znakov>",
      "message_template": "<max 200 znakov>",
      "expected_engagement_pct": <number>,
      "conversion_lift_pct": <number>
    }
  ],
  "optimizations": [
    {
      "stage": "<awareness|consideration|decision|retention|advocacy>",
      "current_conversion_pct": <number>,
      "optimized_conversion_pct": <number>,
      "improvement_action": "<max 150 znakov>",
      "expected_revenue_uplift_eur": <number>,
      "implementation_effort": "<low|medium|high>"
    }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "stage_affected": "<stage|all>", "expected_impact_eur": <number>, "buyers_affected": <number> }
  ],
  "summary": {
    "total_buyers_analyzed": <number>,
    "avg_stage_progression_pct": <number>,
    "awareness_count": <number>,
    "consideration_count": <number>,
    "decision_count": <number>,
    "retention_count": <number>,
    "advocacy_count": <number>,
    "biggest_stage_bottleneck": "<max 100 znakov>",
    "biggest_opportunity": "<max 100 znakov>",
    "journey_efficiency_score": <number 0-100>,
    "expected_total_revenue_uplift_eur": <number>
  }
}`;
}

function transformMapper(parsed: any, targetBuyers: BuyerJourney[]): any {
  const validNames = new Set(targetBuyers.map(b => b.buyerName));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    journeys: (parsed?.journeys || [])
      .filter((j: any) => validNames.has(String(j?.buyer_name ?? '')))
      .slice(0, 20)
      .map((j: any) => {
        const orig = targetBuyers.find(b => b.buyerName === String(j?.buyer_name));
        return {
          buyerName: String(j?.buyer_name ?? '').slice(0, 100),
          currentStage: includes(JOURNEY_STAGES, String(j?.current_stage)) ? String(j.current_stage) : 'consideration',
          stageProbabilities: {
            awareness: Math.max(0, Math.min(100, Number(j?.stage_probabilities?.awareness ?? orig?.stages.awareness ?? 20))),
            consideration: Math.max(0, Math.min(100, Number(j?.stage_probabilities?.consideration ?? orig?.stages.consideration ?? 30))),
            decision: Math.max(0, Math.min(100, Number(j?.stage_probabilities?.decision ?? orig?.stages.decision ?? 40))),
            retention: Math.max(0, Math.min(100, Number(j?.stage_probabilities?.retention ?? orig?.stages.retention ?? 25))),
            advocacy: Math.max(0, Math.min(100, Number(j?.stage_probabilities?.advocacy ?? orig?.stages.advocacy ?? 20))),
          },
          stageProgressionPct: Math.max(0, Math.min(100, Number(j?.stage_progression_pct ?? 50))),
          nextStage: includes(NEXT_STAGES, String(j?.next_stage)) ? String(j.next_stage) : 'decision',
          timeInCurrentStageDays: Math.max(0, Number(j?.time_in_current_stage_days ?? orig?.daysSinceLastPurchase ?? 0)),
          stageConversionProbabilityPct: Math.max(0, Math.min(100, Number(j?.stage_conversion_probability_pct ?? 50))),
          blockers: (j?.blockers || []).slice(0, 5).map((b: any) => String(b).slice(0, 150)),
          accelerators: (j?.accelerators || []).slice(0, 5).map((a: any) => String(a).slice(0, 150)),
        };
      }),
    stages: (parsed?.stages || []).slice(0, 5).map((s: any) => ({
      stage: includes(JOURNEY_STAGES, String(s?.stage)) ? String(s.stage) : 'awareness',
      description: String(s?.description ?? '').slice(0, 200),
      buyerCount: Math.max(0, Number(s?.buyer_count ?? 0)),
      avgTimeInStageDays: Math.max(0, Number(s?.avg_time_in_stage_days ?? 0)),
      conversionRateToNextPct: Math.max(0, Math.min(100, Number(s?.conversion_rate_to_next_pct ?? 50))),
      keyActions: (s?.key_actions || []).slice(0, 5).map((a: any) => String(a).slice(0, 150)),
      commonBlockers: (s?.common_blockers || []).slice(0, 5).map((b: any) => String(b).slice(0, 150)),
    })),
    touchpoints: (parsed?.touchpoints || []).slice(0, 15).map((t: any) => ({
      stage: includes(JOURNEY_STAGES, String(t?.stage)) ? String(t.stage) : 'awareness',
      touchpoint: String(t?.touchpoint ?? '').slice(0, 150),
      channel: includes(CHANNELS, String(t?.channel)) ? String(t.channel) : 'email',
      timing: String(t?.timing ?? '').slice(0, 150),
      messageTemplate: String(t?.message_template ?? '').slice(0, 400),
      expectedEngagementPct: Math.max(0, Math.min(100, Number(t?.expected_engagement_pct ?? 30))),
      conversionLiftPct: Math.round(Number(t?.conversion_lift_pct ?? 0)),
    })),
    optimizations: (parsed?.optimizations || []).slice(0, 5).map((o: any) => ({
      stage: includes(JOURNEY_STAGES, String(o?.stage)) ? String(o.stage) : 'consideration',
      currentConversionPct: Math.max(0, Math.min(100, Number(o?.current_conversion_pct ?? 30))),
      optimizedConversionPct: Math.max(0, Math.min(100, Number(o?.optimized_conversion_pct ?? 50))),
      improvementAction: String(o?.improvement_action ?? '').slice(0, 300),
      expectedRevenueUpliftEur: Math.round(Number(o?.expected_revenue_uplift_eur ?? 0)),
      implementationEffort: includes(EFFORTS, String(o?.implementation_effort)) ? String(o.implementation_effort) : 'medium',
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      priority: includes(PRIORITIES, String(r?.priority)) ? String(r.priority) : 'medium',
      stageAffected: String(r?.stage_affected ?? 'all').slice(0, 30),
      expectedImpactEur: Math.round(Number(r?.expected_impact_eur ?? 0)),
      buyersAffected: Math.max(0, Number(r?.buyers_affected ?? 0)),
    })),
    summary: {
      totalBuyersAnalyzed: targetBuyers.length,
      avgStageProgressionPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_stage_progression_pct ?? 50))),
      awarenessCount: Math.max(0, Number(parsed?.summary?.awareness_count ?? 0)),
      considerationCount: Math.max(0, Number(parsed?.summary?.consideration_count ?? 0)),
      decisionCount: Math.max(0, Number(parsed?.summary?.decision_count ?? 0)),
      retentionCount: Math.max(0, Number(parsed?.summary?.retention_count ?? 0)),
      advocacyCount: Math.max(0, Number(parsed?.summary?.advocacy_count ?? 0)),
      biggestStageBottleneck: String(parsed?.summary?.biggest_stage_bottleneck ?? '').slice(0, 200),
      biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 200),
      journeyEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.journey_efficiency_score ?? 50))),
      expectedTotalRevenueUpliftEur: Math.round(Number(parsed?.summary?.expected_total_revenue_uplift_eur ?? 0)),
    },
  };
}
