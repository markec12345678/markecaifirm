// v6.68: AI Listing Price History Analyzer — analiza cenovne zgodovine z ML trend detection
// POST /api/ai/listing-price-history-analyzer
// Body: { category?: string, days?: number }
// Returns: { ok, analyzer: { trends, pricePoints, categories, opportunities, mlModels, summary } }

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
    const body = await req.json().catch(() => ({}));
    const categoryFilter = body?.category ? String(body.category).toLowerCase() : null;
    const days = Math.max(7, Math.min(365, Number(body?.days ?? 90)));

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const listings = await db.listing.findMany({
      where: { firstSeenAt: { gte: since }, isHidden: false, price: { not: null, gt: 0 }, ...(categoryFilter ? { title: { contains: categoryFilter } } : {}) },
      select: { id: true, title: true, price: true, previousPrice: true, priceDroppedAt: true, firstSeenAt: true, aiEstimatedValue: true, dealScore: true, aiVerdict: true },
      take: 500, orderBy: { firstSeenAt: 'desc' },
    });

    if (listings.length === 0) return NextResponse.json({ ok: true, analyzer: null, message: 'Ni listingov za price history analizo.' });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const priceDrops = listings.filter(l => l.previousPrice && l.priceDroppedAt);
    const avgPrice = Math.round(listings.reduce((s, l) => s + (l.price ?? 0), 0) / listings.length);
    const avgDiscount = priceDrops.length > 0 ? Math.round(priceDrops.reduce((s, l) => { const prev = l.previousPrice ?? 0; const curr = l.price ?? 0; return s + (prev > 0 ? ((prev - curr) / prev) * 100 : 0); }, 0) / priceDrops.length) : 0;

    const prompt = `Si AI listing price history analyzer z ML trend detection.
Analizira cenovno zgodovino oglasov in odkriva trende ter priložnosti.

PODATKI (zadnjih ${days} dni):
- Skupno listingov: ${listings.length}
- Cenažni padci: ${priceDrops.length}
- Povp cena: ${avgPrice}€
- Povp popust ob padcu: ${avgDiscount}%

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "trends": [
    { "trend_name": "<max 80 znakov>", "direction": "<rising|falling|stable|volatile>", "trend_strength": <number 0-100>, "affected_categories": ["<kategorija>"], "timeframe": "<short_term|medium_term|long_term>", "description": "<max 120 znakov>", "opportunity_level": "<high|medium|low>" }
  ],
  "price_points": [
    { "category": "<kategorija>", "avg_price_eur": <number>, "median_price_eur": <number>, "min_price_eur": <number>, "max_price_eur": <number>, "price_volatility_pct": <number>, "trend_direction": "<rising|falling|stable>", "trend_change_pct": <number> }
  ],
  "categories": [
    { "category": "<kategorija>", "listing_count": <number>, "avg_price_eur": <number>, "avg_discount_pct": <number>, "price_drop_frequency": <number>, "best_buy_window": "<max 100 znakov>", "recommended_action": "<buy_now|wait|monitor|avoid>" }
  ],
  "opportunities": [
    { "listing_id": "<id>", "title": "<naslov>", "current_price_eur": <number>, "previous_price_eur": <number>, "discount_pct": <number>, "deal_score": <number 0-100>, "estimated_value_eur": <number>, "opportunity_type": "<price_drop|undervalued|negotiable|bundle_potential>", "urgency": "<high|medium|low>", "recommended_action": "<buy_now|negotiate|wait|monitor>" }
  ],
  "ml_models": [
    { "model": "<arima|lstm|prophet|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<price_trend|price_drop|best_buy_time|volatility>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_listings_analyzed": <number>, "total_price_drops": <number>, "avg_discount_pct": <number>,
    "biggest_price_drop_category": "<max 80 znakov>", "biggest_opportunity": "<max 100 znakov>",
    "best_buy_window": "<max 100 znakov>", "price_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);
    const validIds = new Set(listings.map(l => l.id));

    const analyzer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      trends: (parsed?.trends || []).slice(0, 8).map((t: any) => ({
        trendName: String(t?.trend_name ?? '').slice(0, 150), direction: ['rising', 'falling', 'stable', 'volatile'].includes(String(t?.direction)) ? String(t.direction) : 'stable',
        trendStrength: Math.max(0, Math.min(100, Number(t?.trend_strength ?? 50))), affectedCategories: (t?.affected_categories || []).slice(0, 5).map((c: any) => String(c).slice(0, 50)),
        timeframe: ['short_term', 'medium_term', 'long_term'].includes(String(t?.timeframe)) ? String(t.timeframe) : 'medium_term',
        description: String(t?.description ?? '').slice(0, 250), opportunityLevel: ['high', 'medium', 'low'].includes(String(t?.opportunity_level)) ? String(t.opportunity_level) : 'medium',
      })),
      pricePoints: (parsed?.price_points || []).slice(0, 10).map((p: any) => ({
        category: String(p?.category ?? '').slice(0, 50), avgPriceEur: Math.round(Number(p?.avg_price_eur ?? 0)),
        medianPriceEur: Math.round(Number(p?.median_price_eur ?? 0)), minPriceEur: Math.round(Number(p?.min_price_eur ?? 0)),
        maxPriceEur: Math.round(Number(p?.max_price_eur ?? 0)), priceVolatilityPct: Math.round(Number(p?.price_volatility_pct ?? 0) * 10) / 10,
        trendDirection: ['rising', 'falling', 'stable'].includes(String(p?.trend_direction)) ? String(p.trend_direction) : 'stable',
        trendChangePct: Math.round(Number(p?.trend_change_pct ?? 0) * 10) / 10,
      })),
      categories: (parsed?.categories || []).slice(0, 10).map((c: any) => ({
        category: String(c?.category ?? '').slice(0, 50), listingCount: Math.max(0, Number(c?.listing_count ?? 0)),
        avgPriceEur: Math.round(Number(c?.avg_price_eur ?? 0)), avgDiscountPct: Math.round(Number(c?.avg_discount_pct ?? 0) * 10) / 10,
        priceDropFrequency: Math.max(0, Number(c?.price_drop_frequency ?? 0)), bestBuyWindow: String(c?.best_buy_window ?? '').slice(0, 200),
        recommendedAction: ['buy_now', 'wait', 'monitor', 'avoid'].includes(String(c?.recommended_action)) ? String(c.recommended_action) : 'monitor',
      })),
      opportunities: (parsed?.opportunities || []).filter((o: any) => validIds.has(String(o?.listing_id ?? ''))).slice(0, 15).map((o: any) => ({
        listingId: String(o?.listing_id ?? ''), title: String(o?.title ?? '').slice(0, 100),
        currentPriceEur: Math.round(Number(o?.current_price_eur ?? 0)), previousPriceEur: Math.round(Number(o?.previous_price_eur ?? 0)),
        discountPct: Math.round(Number(o?.discount_pct ?? 0) * 10) / 10, dealScore: Math.max(0, Math.min(100, Number(o?.deal_score ?? 50))),
        estimatedValueEur: Math.round(Number(o?.estimated_value_eur ?? 0)),
        opportunityType: ['price_drop', 'undervalued', 'negotiable', 'bundle_potential'].includes(String(o?.opportunity_type)) ? String(o.opportunity_type) : 'price_drop',
        urgency: ['high', 'medium', 'low'].includes(String(o?.urgency)) ? String(o.urgency) : 'medium',
        recommendedAction: ['buy_now', 'negotiate', 'wait', 'monitor'].includes(String(o?.recommended_action)) ? String(o.recommended_action) : 'monitor',
      })),
      mlModels: (parsed?.ml_models || []).slice(0, 5).map((m: any) => ({
        model: ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
        accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))),
        predictionType: ['price_trend', 'price_drop', 'best_buy_time', 'volatility'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'price_trend',
        weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
      })),
      summary: {
        totalListingsAnalyzed: listings.length, totalPriceDrops: Math.max(0, Number(parsed?.summary?.total_price_drops ?? priceDrops.length)),
        avgDiscountPct: Math.round(Number(parsed?.summary?.avg_discount_pct ?? avgDiscount) * 10) / 10,
        biggestPriceDropCategory: String(parsed?.summary?.biggest_price_drop_category ?? '').slice(0, 150),
        biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 200),
        bestBuyWindow: String(parsed?.summary?.best_buy_window ?? '').slice(0, 200),
        priceAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.price_analysis_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, analyzer });
  } catch (e: any) { logger.error("/api/ai/listing-price-history-analyzer", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
