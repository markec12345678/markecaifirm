// v6.68: AI Listing Price History Analyzer — analiza zgodovine cen z ML trend detection
// POST /api/ai/listing-price-history-analyzer
// Body: { category?: string, days?: number }
// Returns: { ok, analyzer: { trends, priceHistory, insights, predictions, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

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
      where: { firstSeenAt: { gte: since }, isHidden: false, price: { not: null, gt: 0 },
        ...(categoryFilter ? { title: { contains: categoryFilter } } : {}) },
      select: { id: true, title: true, price: true, previousPrice: true, priceDroppedAt: true, firstSeenAt: true, aiEstimatedValue: true, aiScore: true, dealScore: true },
      take: 500, orderBy: { firstSeenAt: 'desc' },
    });

    if (listings.length === 0) return NextResponse.json({ ok: true, analyzer: null, message: 'Ni listingov za price history analizo.' });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const priceDrops = listings.filter(l => l.previousPrice && l.priceDroppedAt);
    const avgPrice = listings.length > 0 ? Math.round(listings.reduce((s, l) => s + (l.price ?? 0), 0) / listings.length) : 0;
    const avgDropPct = priceDrops.length > 0 ? Math.round(priceDrops.reduce((s, l) => { const prev = l.previousPrice ?? 0; const curr = l.price ?? 0; return s + (prev > 0 ? ((prev - curr) / prev) * 100 : 0); }, 0) / priceDrops.length * 10) / 10 : 0;

    const prompt = `Si AI listing price history analyzer z ML trend detection.
Analizira ${listings.length} listingov v zadnjih ${days} dneh (${priceDrops.length} znižanj, povp padec ${avgDropPct}%, povp cena ${avgPrice}€).

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "trends": [
    { "trend_name": "<max 80 znakov>", "direction": "<rising|falling|stable|volatile>", "magnitude_pct": <number>, "category": "<max 50 znakov>", "duration_days": <number>, "confidence_pct": <number 0-100>, "description": "<max 120 znakov>" }
  ],
  "price_history": [
    { "period": "<max 30 znakov>", "avg_price_eur": <number>, "median_price_eur": <number>, "min_price_eur": <number>, "max_price_eur": <number>, "price_drop_count": <number>, "avg_drop_pct": <number>, "listing_count": <number> }
  ],
  "predictions": [
    { "timeframe": "<7d|30d|90d>", "predicted_avg_price_eur": <number>, "predicted_trend": "<rising|falling|stable>", "confidence_pct": <number 0-100>, "key_factors": ["<max 80 znakov>"] }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_impact_eur": <number>, "timeframe_days": <number> }
  ],
  "summary": {
    "total_listings_analyzed": <number>, "total_price_drops": <number>, "avg_drop_pct": <number>,
    "current_avg_price_eur": <number>, "predicted_30d_trend": "<rising|falling|stable>",
    "biggest_price_opportunity": "<max 100 znakov>", "biggest_price_risk": "<max 100 znakov>",
    "price_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);
    const analyzer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      trends: (parsed?.trends || []).slice(0, 8).map((t: any) => ({
        trendName: String(t?.trend_name ?? '').slice(0, 150),
        direction: ['rising', 'falling', 'stable', 'volatile'].includes(String(t?.direction)) ? String(t.direction) : 'stable',
        magnitudePct: Math.round(Number(t?.magnitude_pct ?? 0) * 10) / 10,
        category: String(t?.category ?? '').slice(0, 80),
        durationDays: Math.max(0, Number(t?.duration_days ?? 0)),
        confidencePct: Math.max(0, Math.min(100, Number(t?.confidence_pct ?? 50))),
        description: String(t?.description ?? '').slice(0, 250),
      })),
      priceHistory: (parsed?.price_history || []).slice(0, 6).map((p: any) => ({
        period: String(p?.period ?? '').slice(0, 50), avgPriceEur: Math.round(Number(p?.avg_price_eur ?? 0)),
        medianPriceEur: Math.round(Number(p?.median_price_eur ?? 0)), minPriceEur: Math.round(Number(p?.min_price_eur ?? 0)),
        maxPriceEur: Math.round(Number(p?.max_price_eur ?? 0)), priceDropCount: Math.max(0, Number(p?.price_drop_count ?? 0)),
        avgDropPct: Math.round(Number(p?.avg_drop_pct ?? 0) * 10) / 10, listingCount: Math.max(0, Number(p?.listing_count ?? 0)),
      })),
      predictions: (parsed?.predictions || []).slice(0, 3).map((p: any) => ({
        timeframe: ['7d', '30d', '90d'].includes(String(p?.timeframe)) ? String(p.timeframe) : '30d',
        predictedAvgPriceEur: Math.round(Number(p?.predicted_avg_price_eur ?? 0)),
        predictedTrend: ['rising', 'falling', 'stable'].includes(String(p?.predicted_trend)) ? String(p.predicted_trend) : 'stable',
        confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 50))),
        keyFactors: (p?.key_factors || []).slice(0, 4).map((f: any) => String(f).slice(0, 150)),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300), priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        expectedImpactEur: Math.round(Number(r?.expected_impact_eur ?? 0)), timeframeDays: Math.max(1, Number(r?.timeframe_days ?? 7)),
      })),
      summary: {
        totalListingsAnalyzed: listings.length, totalPriceDrops: priceDrops.length, avgDropPct,
        currentAvgPriceEur: avgPrice, predicted30dTrend: ['rising', 'falling', 'stable'].includes(String(parsed?.summary?.predicted_30d_trend)) ? String(parsed.summary.predicted_30d_trend) : 'stable',
        biggestPriceOpportunity: String(parsed?.summary?.biggest_price_opportunity ?? '').slice(0, 200),
        biggestPriceRisk: String(parsed?.summary?.biggest_price_risk ?? '').slice(0, 200),
        priceAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.price_analysis_score ?? 60))),
      },
    };
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }
    return NextResponse.json({ ok: true, analyzer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
