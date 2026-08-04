// v6.68: AI Buyer Review Generator — generira review-e z ML in sentiment optimization
// POST /api/ai/buyer-review-generator
// Body: { customerName?: string, reviewType?: string }
// Returns: { ok, generator: { reviews, sentiments, templates, mlScoring, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const REVIEW_TYPES = ['seller_review', 'buyer_feedback', 'post_sale_review', 'testimonial', 'referral_message', 'social_proof_quote'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;
    const reviewType: string = REVIEW_TYPES.includes(String(body?.reviewType) as any) ? String(body.reviewType) : 'seller_review';

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true, buyPrice: true, buyFees: true },
      take: 300, orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) return NextResponse.json({ ok: true, generator: null, message: 'Ni prodaj za review generacijo.' });

    const buyerMap = new Map<string, { name: string; purchases: number; totalSpent: number; avgOrder: number; daysSinceLast: number; lastPurchase: Date | null; categories: Set<string>; items: string[] }>();
    const now = Date.now();
    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2 || !t.sellDate) continue;
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, daysSinceLast: 0, lastPurchase: t.sellDate, categories: new Set(), items: [] });
      const b = buyerMap.get(name)!; b.purchases += 1; b.totalSpent += revenue;
      if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
      if (t.category) b.categories.add(t.category); b.items.push(t.title);
    }
    const buyers = Array.from(buyerMap.values()).map(b => { b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0; b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / (24*60*60*1000)) : 999; return b; });
    if (customerName) { const f = buyers.filter(b => b.name === customerName); if (f.length === 0) return NextResponse.json({ ok: true, generator: null, message: `Kupec "${customerName}" ni najden.` }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 20);
    const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d | items: ${b.items.slice(0, 3).join(', ')}`).join('\n');

    const prompt = `Si AI buyer review generator z ML sentiment optimization.
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

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);
    const validNames = new Set(targetBuyers.map(b => b.name));

    const generator = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      reviews: (parsed?.reviews || []).filter((r: any) => validNames.has(String(r?.buyer_name ?? ''))).slice(0, 15).map((r: any) => ({
        buyerName: String(r?.buyer_name ?? '').slice(0, 100),
        reviewType: REVIEW_TYPES.includes(String(r?.review_type) as any) ? String(r.review_type) : 'seller_review',
        reviewText: String(r?.review_text ?? '').slice(0, 600),
        rating: Math.max(1, Math.min(5, Number(r?.rating ?? 5))),
        sentiment: ['very_positive', 'positive', 'neutral', 'negative'].includes(String(r?.sentiment)) ? String(r.sentiment) : 'positive',
        keyPoints: (r?.key_points || []).slice(0, 5).map((p: any) => String(p).slice(0, 150)),
        suggestedPlatform: ['bolha', 'facebook', 'vinted', 'website', 'email'].includes(String(r?.suggested_platform)) ? String(r.suggested_platform) : 'bolha',
        expectedImpact: String(r?.expected_impact ?? '').slice(0, 200),
        personalizationTokens: (r?.personalization_tokens || []).slice(0, 5).map((t: any) => String(t).slice(0, 100)),
      })),
      sentiments: (parsed?.sentiments || []).slice(0, 4).map((s: any) => ({
        sentiment: ['very_positive', 'positive', 'neutral', 'negative'].includes(String(s?.sentiment)) ? String(s.sentiment) : 'positive',
        buyerCount: Math.max(0, Number(s?.buyer_count ?? 0)), avgRating: Math.max(1, Math.min(5, Number(s?.avg_rating ?? 5))),
        reviewCount: Math.max(0, Number(s?.review_count ?? 0)), description: String(s?.description ?? '').slice(0, 250),
        bestUseCase: String(s?.best_use_case ?? '').slice(0, 200),
      })),
      templates: (parsed?.templates || []).slice(0, 6).map((t: any) => ({
        templateName: String(t?.template_name ?? '').slice(0, 150),
        reviewType: REVIEW_TYPES.includes(String(t?.review_type) as any) ? String(t.review_type) : 'seller_review',
        templateText: String(t?.template_text ?? '').slice(0, 500),
        fillInBlanks: (t?.fill_in_blanks || []).slice(0, 5).map((b: any) => String(b).slice(0, 100)),
        bestForSentiment: ['very_positive', 'positive', 'neutral', 'negative'].includes(String(t?.best_for_sentiment)) ? String(t.best_for_sentiment) : 'positive',
        ratingRange: String(t?.rating_range ?? '').slice(0, 50),
      })),
      mlScoring: (parsed?.mlScoring || []).slice(0, 5).map((m: any) => ({
        metric: ['sentiment_accuracy', 'authenticity', 'persuasiveness', 'relevance', 'readability'].includes(String(m?.metric)) ? String(m.metric) : 'sentiment_accuracy',
        weight: Math.max(0, Math.min(100, Number(m?.weight ?? 20))), avgScore: Math.max(0, Math.min(100, Number(m?.avg_score ?? 60))),
        benchmark: Math.max(0, Math.min(100, Number(m?.benchmark ?? 60))),
      })),
      summary: {
        totalReviewsGenerated: Math.max(0, Number(parsed?.summary?.total_reviews_generated ?? targetBuyers.length)),
        avgRating: Math.max(1, Math.min(5, Number(parsed?.summary?.avg_rating ?? 4.5))),
        positiveSentimentPct: Math.max(0, Math.min(100, Number(parsed?.summary?.positive_sentiment_pct ?? 70))),
        bestReviewType: REVIEW_TYPES.includes(String(parsed?.summary?.best_review_type) as any) ? String(parsed.summary.best_review_type) : 'seller_review',
        bestSentiment: ['very_positive', 'positive', 'neutral', 'negative'].includes(String(parsed?.summary?.best_sentiment)) ? String(parsed.summary.best_sentiment) : 'very_positive',
        biggestReviewOpportunity: String(parsed?.summary?.biggest_review_opportunity ?? '').slice(0, 200),
        reviewGenerationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.review_generation_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, generator });
  } catch (e: any) { logger.error("/api/ai/buyer-review-generator", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
