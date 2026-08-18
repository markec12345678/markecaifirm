// v6.50 / v8.94-refactor: AI Listing Virality Predictor — napove viral potential oglasa z ML faktorji
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/listing-virality-predictor
// Body: { tradeId?: string, listingId?: string }
// Returns: { ok, predictor: { listings, viralityFactors, shareTriggers, contentStrategy, predictions, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface ListingViralityInput {
  tradeId: string | null;
  listingId: string | null;
}

interface TargetListing {
  id: string;
  title: string;
  price: number;
  description: string;
  estValue: number;
  category: string;
  imageUrl: string;
  source: string;
}

interface ViralityFactors {
  scarcity: number;
  emotional: number;
  controversy: number;
  utility: number;
  socialProof: number;
  priceAnchor: number;
  timeliness: number;
  uniqueness: number;
  overall: number;
  discountPct: number;
}

interface ListingWithFactors extends TargetListing {
  factors: ViralityFactors;
}

export const POST = withAiRoute<ListingViralityInput>({
  endpoint: '/api/ai/listing-virality-predictor',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : null,
      listingId: body?.listingId ? String(body.listingId) : null,
    };
  },

  // No validateInput — oba input-a sta opcijska (default path = top PRILIKA listings)

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    // 1. Pridobi target listings (tradeId | listingId | default top PRILIKA)
    const targetListings = await resolveTargetListings(input, db);
    if (targetListings.length === 0) {
      return apiOk({ ok: true, predictor: null, message: 'Ni listingov za virality analizo.' });
    }

    // 2. Izračunaj hevristične virality faktorje
    const itemsWithFactors: ListingWithFactors[] = targetListings.map(l => ({
      ...l,
      factors: calculateViralityFactors(l.title, l.description, l.price, l.estValue),
    }));

    // 3. AI klic
    const prompt = buildViralityPrompt(itemsWithFactors);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    // 4. Transformacija rezultatov
    const predictor = transformViralityPredictor(parsed, itemsWithFactors);

    return apiOk({ ok: true, predictor });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

async function resolveTargetListings(
  input: ListingViralityInput,
  db: AiRouteContext['db']
): Promise<TargetListing[]> {
  if (input.tradeId) {
    const t = await db.trade.findUnique({
      where: { id: input.tradeId },
      select: {
        id: true, title: true, category: true, buyPrice: true,
        listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true, price: true } },
      },
    });
    if (!t) {
      throw new ApiRouteError('Trade ne obstaja', 404);
    }
    return [{
      id: t.id, title: t.title,
      price: t.listing?.price ?? Math.round(t.buyPrice * 1.25),
      description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 500),
      estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      category: t.category || 'drugo',
      imageUrl: t.listing?.imageUrl ?? '',
      source: 'bolha',
    }];
  }

  if (input.listingId) {
    const l = await db.listing.findUnique({
      where: { id: input.listingId },
      select: { id: true, title: true, price: true, description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true,
        monitor: { select: { source: true } } },
    });
    if (!l) {
      throw new ApiRouteError('Listing ne obstaja', 404);
    }
    return [{
      id: l.id, title: l.title,
      price: l.price ?? 0,
      description: (l.detailDescription || l.description || '').slice(0, 500),
      estValue: l.aiEstimatedValue ?? l.price ?? 0,
      category: '', imageUrl: l.imageUrl ?? '',
      source: l.monitor?.source || 'bolha',
    }];
  }

  // Default: zadnje PRILIKA listings z najvišjim dealScore
  const listings = await db.listing.findMany({
    where: { aiVerdict: 'PRILIKA', aiScore: { gte: 7 }, isHidden: false, price: { not: null } },
    orderBy: { dealScore: 'desc' },
    take: 15,
    select: { id: true, title: true, price: true, description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true,
      monitor: { select: { source: true } } },
  });
  return listings.map(l => ({
    id: l.id, title: l.title, price: l.price ?? 0,
    description: (l.detailDescription || l.description || '').slice(0, 500),
    estValue: l.aiEstimatedValue ?? l.price ?? 0,
    category: '', imageUrl: l.imageUrl ?? '',
    source: l.monitor?.source || 'bolha',
  }));
}

function buildViralityPrompt(itemsWithFactors: ListingWithFactors[]): string {
  const itemsStr = itemsWithFactors.slice(0, 15).map(l =>
    `- [${l.id}] "${l.title}" | ${l.price}€ (estValue ${l.estValue}€, -${l.factors.discountPct}%) | viral ${l.factors.overall}/100 | scarcity ${l.factors.scarcity} emotional ${l.factors.emotional} controversy ${l.factors.controversy} utility ${l.factors.utility} social ${l.factors.socialProof} price ${l.factors.priceAnchor} timely ${l.factors.timeliness} unique ${l.factors.uniqueness}`
  ).join('\n');

  return `Si AI listing virality predictor za slovenske oglasne platforme.
Napove viral potential oglasa — kako verjetno je da bo deljen, pogosto gledan in hitro prodan.

OGLASI ZA ANALIZO (${itemsWithFactors.length}):
${itemsStr}

8 virality faktorjev (0-100 vsak):
1. SCARCITY (redkost) — limited edition, vintage, redko
2. EMOTIONAL (čustveni trigger) — darilo, spomin, nostalgija
3. CONTROVERSY (kontroverznost) — provocative naslovi
4. UTILITY (uporabnost) — popust, deal, bundle
5. SOCIAL_PROOF (socialno dokazilo) — bestseller, top, priljubljeno
6. PRICE_ANCHOR (cena) — visok discount, cena kot trigger
7. TIMELINESS (aktualnost) — novo, latest, trend
8. UNIQUENESS (edinstvenost) — edinstveno, original, handmade

Viral share triggerji:
- EMOTIONAL_SHARE: čustvena povezava (npr. darilo za domačega)
- UTILITY_SHARE: koristno za prijatelje (popust, deal)
- STATUS_SHARE: prestižni item (luxury, collector)
- CONTROVERSY_SHARE: debate-spawning (predrago, alternative)
- HUMOR_SHARE: smešno, nenavadno
- IDENTITY_SHARE: izraža identiteto kupca

Content strategy za virality:
- TITLE_OPT: ključne besede spredaj, numbers, brackets, emojis
- DESC_HOOK: prva poved mora biti attention-grabbing
- IMAGE_VIRAL: kontrast, nepričakovano, storytelling
- CALL_SHARE: eksplicitna prošnja za deljenje
- URGENCY: časovno omejena ponudba

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "id": "<listing_id>",
      "title": "<naslov>",
      "viral_score": <number 0-100>,
      "viral_tier": "<low|medium|high|viral|super_viral>",
      "share_probability_pct": <number 0-100>,
      "expected_shares": <number>,
      "expected_views_multiplier": <number>,
      "primary_trigger": "<emotional_share|utility_share|status_share|controversy_share|humor_share|identity_share>",
      "viral_strengths": ["<max 80 znakov>"],
      "viral_weaknesses": ["<max 80 znakov>"],
      "viral_optimization_potential_pct": <number>,
      "optimized_title": "<max 100 znakov>",
      "optimized_description_hook": "<max 200 znakov>",
      "expected_views_increase_pct": <number>,
      "expected_sell_speedup_days": <number>
    }
  ],
  "virality_factors": [
    { "factor": "<scarcity|emotional|controversy|utility|social_proof|price_anchor|timeliness|uniqueness>", "weight": <number 0-100>, "description": "<max 100 znakov>", "avg_score": <number 0-100>, "high_score_examples": ["<max 80 znakov>"] }
  ],
  "share_triggers": [
    { "trigger": "<emotional_share|utility_share|status_share|controversy_share|humor_share|identity_share>", "description": "<max 100 znakov>", "best_for_category": "<max 80 znakov>", "example_message": "<max 200 znakov>", "expected_share_rate_pct": <number> }
  ],
  "content_strategy": [
    { "strategy": "<title_opt|desc_hook|image_viral|call_share|urgency>", "description": "<max 120 znakov>", "implementation": "<max 200 znakov>", "expected_viral_lift_pct": <number>, "effort": "<low|medium|high>" }
  ],
  "predictions": [
    { "timeframe": "<24h|7d|30d>", "expected_views": <number>, "expected_inquiries": <number>, "expected_shares": <number>, "expected_sale_probability_pct": <number> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_viral_increase_pct": <number>, "listings_affected": <number> }
  ],
  "summary": {
    "total_listings": <number>,
    "avg_viral_score": <number>,
    "viral_count": <number>,
    "super_viral_count": <number>,
    "low_viral_count": <number>,
    "biggest_viral_opportunity_id": "<listing_id>",
    "biggest_viral_blocker": "<max 100 znakov>",
    "quickest_viral_win": "<max 100 znakov>",
    "virality_efficiency_score": <number 0-100>,
    "expected_total_views_increase_pct": <number>
  }
}`;
}

function transformViralityPredictor(parsed: any, itemsWithFactors: ListingWithFactors[]): any {
  const validIds = new Set(itemsWithFactors.map(i => i.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listings: (parsed?.listings || [])
      .filter((l: any) => validIds.has(String(l?.id ?? '')))
      .slice(0, 15)
      .map((l: any) => {
        const orig = itemsWithFactors.find(x => x.id === String(l?.id));
        return {
          listingId: String(l?.id ?? ''),
          title: String(l?.title ?? orig?.title ?? '').slice(0, 150),
          viralScore: Math.max(0, Math.min(100, Number(l?.viral_score ?? orig?.factors.overall ?? 50))),
          viralTier: ['low', 'medium', 'high', 'viral', 'super_viral'].includes(String(l?.viral_tier)) ? String(l.viral_tier) : 'medium',
          shareProbabilityPct: Math.max(0, Math.min(100, Number(l?.share_probability_pct ?? 30))),
          expectedShares: Math.max(0, Math.round(Number(l?.expected_shares ?? 0))),
          expectedViewsMultiplier: Math.round(Number(l?.expected_views_multiplier ?? 1) * 10) / 10,
          primaryTrigger: ['emotional_share', 'utility_share', 'status_share', 'controversy_share', 'humor_share', 'identity_share'].includes(String(l?.primary_trigger)) ? String(l.primary_trigger) : 'utility_share',
          viralStrengths: (l?.viral_strengths || []).slice(0, 5).map((s: any) => String(s).slice(0, 150)),
          viralWeaknesses: (l?.viral_weaknesses || []).slice(0, 5).map((w: any) => String(w).slice(0, 150)),
          viralOptimizationPotentialPct: Math.max(0, Math.min(100, Number(l?.viral_optimization_potential_pct ?? 30))),
          optimizedTitle: String(l?.optimized_title ?? '').slice(0, 150),
          optimizedDescriptionHook: String(l?.optimized_description_hook ?? '').slice(0, 400),
          expectedViewsIncreasePct: Math.round(Number(l?.expected_views_increase_pct ?? 30)),
          expectedSellSpeedupDays: Math.round(Number(l?.expected_sell_speedup_days ?? 3)),
        };
      }),
    viralityFactors: (parsed?.virality_factors || []).slice(0, 8).map((f: any) => ({
      factor: ['scarcity', 'emotional', 'controversy', 'utility', 'social_proof', 'price_anchor', 'timeliness', 'uniqueness'].includes(String(f?.factor)) ? String(f.factor) : 'emotional',
      weight: Math.max(0, Math.min(100, Number(f?.weight ?? 50))),
      description: String(f?.description ?? '').slice(0, 200),
      avgScore: Math.max(0, Math.min(100, Number(f?.avg_score ?? 50))),
      highScoreExamples: (f?.high_score_examples || []).slice(0, 4).map((e: any) => String(e).slice(0, 150)),
    })),
    shareTriggers: (parsed?.share_triggers || []).slice(0, 6).map((t: any) => ({
      trigger: ['emotional_share', 'utility_share', 'status_share', 'controversy_share', 'humor_share', 'identity_share'].includes(String(t?.trigger)) ? String(t.trigger) : 'utility_share',
      description: String(t?.description ?? '').slice(0, 200),
      bestForCategory: String(t?.best_for_category ?? '').slice(0, 150),
      exampleMessage: String(t?.example_message ?? '').slice(0, 400),
      expectedShareRatePct: Math.max(0, Math.min(100, Number(t?.expected_share_rate_pct ?? 20))),
    })),
    contentStrategy: (parsed?.content_strategy || []).slice(0, 5).map((c: any) => ({
      strategy: ['title_opt', 'desc_hook', 'image_viral', 'call_share', 'urgency'].includes(String(c?.strategy)) ? String(c.strategy) : 'title_opt',
      description: String(c?.description ?? '').slice(0, 250),
      implementation: String(c?.implementation ?? '').slice(0, 400),
      expectedViralLiftPct: Math.round(Number(c?.expected_viral_lift_pct ?? 20)),
      effort: ['low', 'medium', 'high'].includes(String(c?.effort)) ? String(c.effort) : 'medium',
    })),
    predictions: (parsed?.predictions || []).slice(0, 3).map((p: any) => ({
      timeframe: ['24h', '7d', '30d'].includes(String(p?.timeframe)) ? String(p.timeframe) : '7d',
      expectedViews: Math.max(0, Math.round(Number(p?.expected_views ?? 0))),
      expectedInquiries: Math.max(0, Math.round(Number(p?.expected_inquiries ?? 0))),
      expectedShares: Math.max(0, Math.round(Number(p?.expected_shares ?? 0))),
      expectedSaleProbabilityPct: Math.max(0, Math.min(100, Number(p?.expected_sale_probability_pct ?? 30))),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      expectedViralIncreasePct: Math.round(Number(r?.expected_viral_increase_pct ?? 0)),
      listingsAffected: Math.max(0, Number(r?.listings_affected ?? 0)),
    })),
    summary: {
      totalListings: itemsWithFactors.length,
      avgViralScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_viral_score ?? Math.round(itemsWithFactors.reduce((s, i) => s + i.factors.overall, 0) / Math.max(1, itemsWithFactors.length))))),
      viralCount: Math.max(0, Number(parsed?.summary?.viral_count ?? 0)),
      superViralCount: Math.max(0, Number(parsed?.summary?.super_viral_count ?? 0)),
      lowViralCount: Math.max(0, Number(parsed?.summary?.low_viral_count ?? 0)),
      biggestViralOpportunityId: String(parsed?.summary?.biggest_viral_opportunity_id ?? '').slice(0, 50),
      biggestViralBlocker: String(parsed?.summary?.biggest_viral_blocker ?? '').slice(0, 200),
      quickestViralWin: String(parsed?.summary?.quickest_viral_win ?? '').slice(0, 200),
      viralityEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.virality_efficiency_score ?? 50))),
      expectedTotalViewsIncreasePct: Math.round(Number(parsed?.summary?.expected_total_views_increase_pct ?? 30)),
    },
  };
}

// --- Hevristični virality faktorji (čista funkcija) ----------------------

function calculateViralityFactors(title: string, description: string, price: number, estValue: number): ViralityFactors {
  const titleLower = title.toLowerCase();
  const descLower = description.toLowerCase();

  // 1. SCARCITY (redkost) — limited edition, rare, vintage
  const scarcitySignals = ['redko', 'rare', 'limited', 'vintage', 'collectible', 'editions', 'special'];
  const scarcityScore = scarcitySignals.some(s => titleLower.includes(s) || descLower.includes(s)) ? 80 : 30;

  // 2. EMOTIONAL (čustveni trigger) — emotional keywords
  const emotionalSignals = ['darilo', 'gift', 'perfect', 'novo', 'new', 'original', 'spomin', 'memory'];
  const emotionalScore = emotionalSignals.filter(s => titleLower.includes(s) || descLower.includes(s)).length;
  const emotionalScoreNorm = Math.min(100, emotionalScore * 25);

  // 3. CONTROVERSY (kontroverznost) — topics that spark discussion
  const controversySignals = ['predrago', 'dražje', 'alternative', 'boljše od', 'namesto'];
  const controversyScore = controversySignals.some(s => titleLower.includes(s) || descLower.includes(s)) ? 70 : 20;

  // 4. UTILITY (uporabnost) — practical value
  const utilitySignals = ['popust', 'akcija', 'ceneje', 'save', 'deal', 'bundle'];
  const utilityScore = utilitySignals.some(s => titleLower.includes(s) || descLower.includes(s)) ? 65 : 35;

  // 5. SOCIAL_PROOF (socialno dokazilo)
  const socialSignals = ['popularno', 'bestseller', 'top', 'priljubljeno', 'zahtevano'];
  const socialScore = socialSignals.some(s => titleLower.includes(s) || descLower.includes(s)) ? 75 : 25;

  // 6. PRICE_ANCHOR (cena kot trigger)
  const discountPct = estValue > 0 ? Math.round(((estValue - price) / estValue) * 100) : 0;
  const priceAnchorScore = discountPct >= 50 ? 90 : discountPct >= 30 ? 75 : discountPct >= 15 ? 60 : 30;

  // 7. TIMELINESS (aktualnost) — current events, trends
  const timelySignals = ['novo', '2024', '2025', '2026', 'latest', 'zadnji', 'trend'];
  const timelinessScore = timelySignals.some(s => titleLower.includes(s) || descLower.includes(s)) ? 70 : 30;

  // 8. UNIQUENESS (edinstvenost)
  const uniqueSignals = ['edinstveno', 'unique', 'edini', 'original', 'handmade'];
  const uniquenessScore = uniqueSignals.some(s => titleLower.includes(s) || descLower.includes(s)) ? 80 : 35;

  // Skupni viral score
  const viralScore = Math.round(
    (scarcityScore * 0.15) +
    (emotionalScoreNorm * 0.15) +
    (controversyScore * 0.10) +
    (utilityScore * 0.10) +
    (socialScore * 0.10) +
    (priceAnchorScore * 0.15) +
    (timelinessScore * 0.10) +
    (uniquenessScore * 0.15)
  );

  return {
    scarcity: scarcityScore,
    emotional: emotionalScoreNorm,
    controversy: controversyScore,
    utility: utilityScore,
    socialProof: socialScore,
    priceAnchor: priceAnchorScore,
    timeliness: timelinessScore,
    uniqueness: uniquenessScore,
    overall: viralScore,
    discountPct,
  };
}
