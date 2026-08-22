// v6.68 / v8.95.4-batch3: AI Buyer Review Generator — generira review-e z ML in sentiment optimization
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-review-generator
// Body: { customerName?: string, reviewType?: string }
// Returns: { ok, generator: { reviews, sentiments, templates, mlScoring, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BuyerReviewGeneratorInput {
  customerName: string | null;
  reviewType: string;
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
  buyPrice: number | null;
  buyFees: number | null;
}

interface BuyerRow {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrder: number;
  daysSinceLast: number;
  lastPurchase: Date | null;
  categories: Set<string>;
  items: string[];
}

const REVIEW_TYPES = ['seller_review', 'buyer_feedback', 'post_sale_review', 'testimonial', 'referral_message', 'social_proof_quote'] as const;
const SENTIMENTS = ['very_positive', 'positive', 'neutral', 'negative'] as const;
const PLATFORMS = ['bolha', 'facebook', 'vinted', 'website', 'email'] as const;
const ML_METRICS = ['sentiment_accuracy', 'authenticity', 'persuasiveness', 'relevance', 'readability'] as const;

export const POST = withAiRoute<BuyerReviewGeneratorInput>({
  endpoint: '/api/ai/buyer-review-generator',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      customerName: body?.customerName ? String(body.customerName).trim() : null,
      reviewType: includes(REVIEW_TYPES, String(body?.reviewType)) ? String(body.reviewType) : 'seller_review',
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { customerName, reviewType } = input;

    const soldTrades: SoldTradeRow[] = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true, buyPrice: true, buyFees: true },
      take: 300, orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, generator: null, message: 'Ni prodaj za review generacijo.' });
    }

    const buyers = buildBuyers(soldTrades);

    if (customerName) {
      const f = buyers.filter(b => b.name === customerName);
      if (f.length === 0) {
        return apiOk({ ok: true, generator: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 20);
    const prompt = buildPrompt(targetBuyers, reviewType);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const generator = transformGenerator(parsed, targetBuyers);

    return apiOk({ ok: true, generator });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildBuyers(soldTrades: SoldTradeRow[]): BuyerRow[] {
  const buyerMap = new Map<string, BuyerRow>();
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  for (const t of soldTrades) {
    const name = (t.sellLocation || '').trim();
    if (!name || name.length < 2 || !t.sellDate) continue;
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    if (!buyerMap.has(name)) {
      buyerMap.set(name, {
        name, purchases: 0, totalSpent: 0, avgOrder: 0, daysSinceLast: 0,
        lastPurchase: t.sellDate, categories: new Set(), items: [],
      });
    }
    const b = buyerMap.get(name)!;
    b.purchases += 1;
    b.totalSpent += revenue;
    if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
    if (t.category) b.categories.add(t.category);
    b.items.push(t.title);
  }
  const buyers = Array.from(buyerMap.values());
  for (const b of buyers) {
    b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0;
    b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / DAY) : 999;
  }
  return buyers;
}

function buildPrompt(targetBuyers: BuyerRow[], reviewType: string): string {
  const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d | items: ${b.items.slice(0, 3).join(', ')}`).join('\n');

  return `Si AI buyer review generator z ML sentiment optimization.
Generira review-e za prodajalca na podlagi zadovoljstva kupcev.

KUPCI (${targetBuyers.length}):
${buyersStr}

REVIEW TYPE: ${reviewType}

6 review tipov:
1. SELLER_REVIEW: review prodajalca (kot kupec)
2. BUYER_FEEDBACK: feedback o kupcu (kot prodajalec)
3. POST_SALE_REVIEW: review po nakupu
4. TESTIMONIAL: testimonial za marketing
5. REFERRAL_MESSAGE: sporočilo za priporočilo
6. SOCIAL_PROOF_QUOTE: quote za social proof

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "reviews": [
    {
      "buyer_name": "<ime>", "review_type": "<6 tipov>", "review_text": "<max 400 znakov>", "rating": <number 1-5>, "sentiment": "<very_positive|positive|neutral|negative>", "key_points": ["<max 80 znakov>"], "suggested_platform": "<bolha|facebook|vinted|website|email>", "expected_impact": "<max 100 znakov>", "personalization_tokens": ["<max 60 znakov>"]
    }
  ],
  "sentiments": [
    { "sentiment": "<very_positive|positive|neutral|negative>", "buyer_count": <number>, "avg_rating": <number 1-5>, "review_count": <number>, "description": "<max 120 znakov>", "best_use_case": "<max 100 znakov>" }
  ],
  "templates": [
    { "template_name": "<max 80 znakov>", "review_type": "<6 tipov>", "template_text": "<max 300 znakov>", "fill_in_blanks": ["<max 60 znakov>"], "best_for_sentiment": "<4 sentimenti>", "rating_range": "<max 30 znakov>" }
  ],
  "mlScoring": [
    { "metric": "<sentiment_accuracy|authenticity|persuasiveness|relevance|readability>", "weight": <number 0-100>, "avg_score": <number 0-100>, "benchmark": <number 0-100> }
  ],
  "summary": {
    "total_reviews_generated": <number>, "avg_rating": <number 1-5>, "positive_sentiment_pct": <number 0-100>,
    "best_review_type": "<6 tipov>", "best_sentiment": "<4 sentimenti>",
    "biggest_review_opportunity": "<max 100 znakov>", "review_generation_score": <number 0-100>
  }
}`;
}

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function transformGenerator(parsed: any, targetBuyers: BuyerRow[]): any {
  const validNames = new Set(targetBuyers.map(b => b.name));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    reviews: (parsed?.reviews || []).filter((r: any) => validNames.has(String(r?.buyer_name ?? ''))).slice(0, 15).map((r: any) => ({
      buyerName: String(r?.buyer_name ?? '').slice(0, 100),
      reviewType: includes(REVIEW_TYPES, String(r?.review_type)) ? String(r.review_type) : 'seller_review',
      reviewText: String(r?.review_text ?? '').slice(0, 600),
      rating: clamp(Number(r?.rating ?? 5), 1, 5),
      sentiment: includes(SENTIMENTS, String(r?.sentiment)) ? String(r.sentiment) : 'positive',
      keyPoints: (r?.key_points || []).slice(0, 5).map((p: any) => String(p).slice(0, 150)),
      suggestedPlatform: includes(PLATFORMS, String(r?.suggested_platform)) ? String(r.suggested_platform) : 'bolha',
      expectedImpact: String(r?.expected_impact ?? '').slice(0, 200),
      personalizationTokens: (r?.personalization_tokens || []).slice(0, 5).map((t: any) => String(t).slice(0, 100)),
    })),
    sentiments: (parsed?.sentiments || []).slice(0, 4).map((s: any) => ({
      sentiment: includes(SENTIMENTS, String(s?.sentiment)) ? String(s.sentiment) : 'positive',
      buyerCount: Math.max(0, Number(s?.buyer_count ?? 0)),
      avgRating: clamp(Number(s?.avg_rating ?? 5), 1, 5),
      reviewCount: Math.max(0, Number(s?.review_count ?? 0)),
      description: String(s?.description ?? '').slice(0, 250),
      bestUseCase: String(s?.best_use_case ?? '').slice(0, 200),
    })),
    templates: (parsed?.templates || []).slice(0, 6).map((t: any) => ({
      templateName: String(t?.template_name ?? '').slice(0, 150),
      reviewType: includes(REVIEW_TYPES, String(t?.review_type)) ? String(t.review_type) : 'seller_review',
      templateText: String(t?.template_text ?? '').slice(0, 500),
      fillInBlanks: (t?.fill_in_blanks || []).slice(0, 5).map((b: any) => String(b).slice(0, 100)),
      bestForSentiment: includes(SENTIMENTS, String(t?.best_for_sentiment)) ? String(t.best_for_sentiment) : 'positive',
      ratingRange: String(t?.rating_range ?? '').slice(0, 50),
    })),
    mlScoring: (parsed?.mlScoring || []).slice(0, 5).map((m: any) => ({
      metric: includes(ML_METRICS, String(m?.metric)) ? String(m.metric) : 'sentiment_accuracy',
      weight: clamp(Number(m?.weight ?? 20), 0, 100),
      avgScore: clamp(Number(m?.avg_score ?? 60), 0, 100),
      benchmark: clamp(Number(m?.benchmark ?? 60), 0, 100),
    })),
    summary: {
      totalReviewsGenerated: Math.max(0, Number(parsed?.summary?.total_reviews_generated ?? targetBuyers.length)),
      avgRating: clamp(Number(parsed?.summary?.avg_rating ?? 4.5), 1, 5),
      positiveSentimentPct: clamp(Number(parsed?.summary?.positive_sentiment_pct ?? 70), 0, 100),
      bestReviewType: includes(REVIEW_TYPES, String(parsed?.summary?.best_review_type)) ? String(parsed.summary.best_review_type) : 'seller_review',
      bestSentiment: includes(SENTIMENTS, String(parsed?.summary?.best_sentiment)) ? String(parsed.summary.best_sentiment) : 'very_positive',
      biggestReviewOpportunity: String(parsed?.summary?.biggest_review_opportunity ?? '').slice(0, 200),
      reviewGenerationScore: clamp(Number(parsed?.summary?.review_generation_score ?? 60), 0, 100),
    },
  };
}
