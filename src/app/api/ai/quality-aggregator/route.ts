// v6.27 / v8.95.8-other1: AI Listing Quality Score Aggregator — agregira vse AI ocene v eno skupno.
// Refaktoriran z withAiRoute helperjem (v8.95.8-other1) + enforceBudget guard.
//
// POST /api/ai/quality-aggregator
// Body: { listingId?: string }
// Returns: { ok, aggregate: { overallScore, breakdown, strengths, weaknesses, comparisonToSimilar, priceAnalysis, recommendation, actionItems, reasoning }, listing }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface QualityAggregatorInput {
  listingId: string;
}

interface SimilarRow {
  dealScore: number | null;
  aiScore: number | null;
  aiRisk: number | null;
  aiVerdict: string | null;
  price: number | null;
}

interface SimilarStats {
  avgDealScore: number;
  avgAiScore: number;
  avgAiRisk: number;
  opportunityPct: number;
}

interface ListingRow {
  id: string;
  title: string;
  price: number | null;
  priceText: string | null;
  description: string | null;
  detailDescription: string | null;
  imageUrl: string | null;
  location: string | null;
  aiScore: number | null;
  aiRisk: number | null;
  aiVerdict: string | null;
  aiReason: string | null;
  aiEstimatedValue: number | null;
  aiImageAnalysis: string | null;
  aiImageVerdict: string | null;
  dealScore: number | null;
  dealScoreReason: string | null;
  sellerName: string | null;
  sellerListingCount: number | null;
  postedAt: Date | null;
  firstSeenAt: Date | null;
  previousPrice: number | null;
  priceDroppedAt: Date | null;
  monitor: { source: string | null; name: string | null } | null;
}

export const POST = withAiRoute<QualityAggregatorInput>({
  endpoint: '/api/ai/quality-aggregator',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { listingId: String(body?.listingId ?? '') };
  },

  validateInput: (input) => (input.listingId ? null : 'listingId je obvezen'),

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { listingId } = input;

    // 1. Load listing
    const listing = await db.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true, title: true, price: true, priceText: true, description: true,
        detailDescription: true, imageUrl: true, location: true,
        aiScore: true, aiRisk: true, aiVerdict: true, aiReason: true,
        aiEstimatedValue: true, aiImageAnalysis: true, aiImageVerdict: true,
        dealScore: true, dealScoreReason: true,
        sellerName: true, sellerListingCount: true,
        postedAt: true, firstSeenAt: true, previousPrice: true, priceDroppedAt: true,
        monitor: { select: { source: true, name: true } },
      },
    });
    if (!listing) throw new ApiRouteError('Listing ne obstaja', 404);

    // 2. Podobni listingi za benchmark
    const similar = await db.listing.findMany({
      where: {
        price: { gte: Math.floor((listing.price ?? 100) * 0.7), lte: Math.ceil((listing.price ?? 100) * 1.3) },
        isHidden: false,
        id: { not: listing.id },
      },
      select: { dealScore: true, aiScore: true, aiRisk: true, price: true, aiVerdict: true },
      take: 30,
    });

    const stats = computeSimilarStats(similar);

    // 3. Build prompt + call AI
    const prompt = buildPrompt(listing, stats);
    const raw = await callAi(prompt);

    // 4. Parse + transform
    const parsed: any = parseAi(raw);
    const aggregate = transformAggregate(parsed, listing);

    return apiOk({
      ok: true,
      aggregate,
      listing: { id: listing.id, title: listing.title, price: listing.price },
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function computeSimilarStats(similar: SimilarRow[]): SimilarStats {
  const avgDealScore = similar.length > 0 ? Math.round(similar.reduce((s, l) => s + (l.dealScore ?? 0), 0) / similar.length) : 50;
  const avgAiScore = similar.length > 0 ? Math.round(similar.reduce((s, l) => s + (l.aiScore ?? 0), 0) / similar.length) : 5;
  const avgAiRisk = similar.length > 0 ? Math.round(similar.reduce((s, l) => s + (l.aiRisk ?? 0), 0) / similar.length) : 5;
  const opportunityPct = similar.length > 0 ? Math.round(similar.filter(l => l.aiVerdict === 'PRILIKA').length / similar.length * 100) : 0;
  return { avgDealScore, avgAiScore, avgAiRisk, opportunityPct };
}

function buildPrompt(l: ListingRow, stats: SimilarStats): string {
  return `Si ekspert za agregacijo AI ocen in vrednotenje kakovosti oglasov.
Združi vse AI ocene tega oglasa v eno skupno oceno kakovosti.

NASLOV: ${l.title}
CENA: ${l.priceText || (l.price + ' EUR')}
LOKACIJA: ${l.location}
VIR: ${l.monitor?.source || 'neznan'}
STAROST: ${l.postedAt ? Math.round((Date.now() - l.postedAt.getTime()) / (24*60*60*1000)) : 0} dni

AI OCENE:
- AI Score (1-10): ${l.aiScore ?? 'neznan'}
- AI Risk (1-10): ${l.aiRisk ?? 'neznan'}
- AI Verdict: ${l.aiVerdict ?? 'neznan'}
- AI Reason: ${l.aiReason ?? 'neznan'}
- AI Est. Value: ${l.aiEstimatedValue ?? 'neznan'}€
- Deal Score (0-100): ${l.dealScore ?? 'neznan'}
- Deal Score Reason: ${l.dealScoreReason ?? 'neznan'}
- Image Verdict: ${l.aiImageVerdict ?? 'neznan'}
- Image Analysis: ${l.aiImageAnalysis ?? 'neznan'}

PRODAJALEC:
- Ime: ${l.sellerName ?? 'neznan'}
- Število oglasov: ${l.sellerListingCount}

BENCHMARK (podobni oglasi):
- Povp. deal score: ${stats.avgDealScore}/100
- Povp. AI score: ${stats.avgAiScore}/10
- Povp. AI risk: ${stats.avgAiRisk}/10
- % priložnosti: ${stats.opportunityPct}%

${l.previousPrice ? `CENA PADLA: ${l.previousPrice}€ → ${l.price}€` : 'Brez padca cene'}

Izračunaj skupno oceno (0-100) kot ponderirano povprečje:
- Deal Score: 35% utež
- AI Score (×10): 20% utež
- AI Risk (inverzno, (11-risk)×10): 15% utež
- Image quality: 10% utež
- Seller reputation: 10% utež
- Price vs est. value: 10% utež

Odgovori LE z JSON:
{
  "overall_score": <number 0-100>,
  "grade": "<A+|A|B+|B|C+|C|D|F>",
  "breakdown": [
    { "factor": "<deal_score|ai_score|ai_risk|image_quality|seller_reputation|price_value>", "score": <number 0-100>, "weight_pct": <number>, "contribution": <number> }
  ],
  "strengths": ["<prednost, max 80 znakov>", "..."],
  "weaknesses": ["<šibkost, max 80 znakov>", "..."],
  "comparison_to_similar": {
    "percentile": <number 0-100>,
    "better_than_pct": <number>,
    "worse_than_pct": <number>,
    "ranking": "<top_5|top_10|top_25|average|bottom_25|bottom_10>"
  },
  "price_analysis": {
    "list_price_eur": <number>,
    "estimated_value_eur": <number>,
    "discount_pct": <number>,
    "is_good_deal": <boolean>,
    "fair_price_eur": <number>
  },
  "recommendation": "<buy_now|buy_with_caution|monitor|wait|avoid>",
  "action_items": ["<konkretno dejanje, max 100 znakov>", "..."],
  "reasoning": "<max 200 znakov>"
}`;
}

function transformAggregate(parsed: any, l: ListingRow): {
  overallScore: number;
  grade: string;
  breakdown: any[];
  strengths: string[];
  weaknesses: string[];
  comparisonToSimilar: any;
  priceAnalysis: any;
  recommendation: string;
  actionItems: string[];
  reasoning: string;
} {
  return {
    overallScore: Math.max(0, Math.min(100, Number(parsed?.overall_score ?? 50))),
    grade: ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F'].includes(String(parsed?.grade)) ? String(parsed.grade) : 'C',
    breakdown: (parsed?.breakdown || []).slice(0, 8).map((b: any) => ({
      factor: String(b?.factor ?? '').slice(0, 50),
      score: Math.max(0, Math.min(100, Number(b?.score ?? 50))),
      weightPct: Math.max(0, Math.min(100, Number(b?.weight_pct ?? 0))),
      contribution: Math.round(Number(b?.contribution ?? 0)),
    })),
    strengths: (parsed?.strengths || []).slice(0, 5).map((s: any) => String(s).slice(0, 150)),
    weaknesses: (parsed?.weaknesses || []).slice(0, 5).map((w: any) => String(w).slice(0, 150)),
    comparisonToSimilar: {
      percentile: Math.max(0, Math.min(100, Number(parsed?.comparison_to_similar?.percentile ?? 50))),
      betterThanPct: Math.max(0, Math.min(100, Number(parsed?.comparison_to_similar?.better_than_pct ?? 50))),
      worseThanPct: Math.max(0, Math.min(100, Number(parsed?.comparison_to_similar?.worse_than_pct ?? 50))),
      ranking: ['top_5', 'top_10', 'top_25', 'average', 'bottom_25', 'bottom_10'].includes(String(parsed?.comparison_to_similar?.ranking))
        ? String(parsed.comparison_to_similar.ranking) : 'average',
    },
    priceAnalysis: {
      listPriceEur: Math.max(0, Number(parsed?.price_analysis?.list_price_eur ?? l.price ?? 0)),
      estimatedValueEur: Math.max(0, Number(parsed?.price_analysis?.estimated_value_eur ?? l.aiEstimatedValue ?? 0)),
      discountPct: Math.round(Number(parsed?.price_analysis?.discount_pct ?? 0)),
      isGoodDeal: Boolean(parsed?.price_analysis?.is_good_deal ?? false),
      fairPriceEur: Math.max(0, Number(parsed?.price_analysis?.fair_price_eur ?? 0)),
    },
    recommendation: ['buy_now', 'buy_with_caution', 'monitor', 'wait', 'avoid'].includes(String(parsed?.recommendation))
      ? String(parsed.recommendation) : 'monitor',
    actionItems: (parsed?.action_items || []).slice(0, 5).map((a: any) => String(a).slice(0, 200)),
    reasoning: String(parsed?.reasoning ?? '').slice(0, 400),
  };
}
