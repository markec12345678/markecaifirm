// v8.72: Result Comparison API — multi-listing side-by-side comparison + AI best-value pick.
// POST /api/search/compare { listingIds: string[] }
// Returns: comparison table data + winner (best value) + per-listing verdict.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { computeBuyScore } from '@/lib/trades/buy-opportunity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { listingIds } = body as { listingIds: string[] };
    if (!Array.isArray(listingIds) || listingIds.length < 2) {
      return NextResponse.json({ ok: false, error: 'Potrebna vsaj 2 listings za primerjavo' }, { status: 400 });
    }
    if (listingIds.length > 6) {
      return NextResponse.json({ ok: false, error: 'Največ 6 listings na primerjavo' }, { status: 400 });
    }

    const listings = await db.listing.findMany({
      where: { id: { in: listingIds } },
      select: {
        id: true, title: true, price: true, priceText: true, url: true,
        location: true, description: true, detailDescription: true, imageUrl: true,
        postedAt: true, firstSeenAt: true,
        aiScore: true, aiRisk: true, aiVerdict: true, aiReason: true, aiEstimatedValue: true,
        aiImageVerdict: true, previousPrice: true, priceDroppedAt: true,
        sellerName: true, sellerListingCount: true,
        monitor: { select: { name: true, source: true, tags: true } },
      },
    });

    if (listings.length < 2) {
      return NextResponse.json({ ok: false, error: 'Ne najdem dovolj listings' }, { status: 404 });
    }

    // Fetch category context for buy scores
    const categorySet = new Set<string>();
    listings.forEach(l => {
      const tags = (l.monitor?.tags || '').split(',').map(t => t.trim()).filter(Boolean);
      categorySet.add(tags[0] || 'drugo');
    });

    const allSold = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
    });
    const categoryContext: Record<string, { avgSell: number | null; avgROI: number | null; count: number; verdict: string | null }> = {};
    for (const cat of Array.from(categorySet)) {
      const sold = allSold.filter(t => (t.category || 'drugo') === cat);
      if (sold.length > 0) {
        const sellPrices = sold.map(t => t.sellPrice ?? 0);
        const rois = sold.map(t => {
          const c = t.buyPrice + (t.buyFees ?? 0);
          const r = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
          return c > 0 ? ((r - c) / c) * 100 : 0;
        });
        const avgROI = rois.reduce((s, r) => s + r, 0) / rois.length;
        const winRate = (sold.filter((t, i) => rois[i] > 0).length / sold.length) * 100;
        let verdict: string | null = null;
        if (sold.length >= 3) {
          if (avgROI >= 30 && winRate >= 70) verdict = 'STAR';
          else if (avgROI >= 15 && winRate >= 60) verdict = 'SOLID';
          else if (avgROI >= 0) verdict = 'MIXED';
          else verdict = 'UNDERPERFORMER';
        }
        categoryContext[cat] = {
          avgSell: sellPrices.reduce((s, p) => s + p, 0) / sold.length,
          avgROI,
          count: sold.length,
          verdict,
        };
      } else {
        categoryContext[cat] = { avgSell: null, avgROI: null, count: 0, verdict: 'INSUFFICIENT_DATA' };
      }
    }

    // Compute buy scores
    const compared = listings.map(l => {
      const tags = (l.monitor?.tags || '').split(',').map(t => t.trim()).filter(Boolean);
      const cat = tags[0] || 'drugo';
      const ctx = categoryContext[cat] || { avgSell: null, avgROI: null, count: 0, verdict: null };
      const buyScore = computeBuyScore(
        {
          id: l.id, title: l.title, price: l.price, priceText: l.priceText,
          aiScore: l.aiScore, aiRisk: l.aiRisk, aiVerdict: l.aiVerdict,
          aiEstimatedValue: l.aiEstimatedValue, previousPrice: l.previousPrice,
          priceDroppedAt: l.priceDroppedAt,
        },
        {
          category: cat,
          marketAvgSellPrice: ctx.avgSell,
          marketAvgROI: ctx.avgROI,
          comparableCount: ctx.count,
          categoryVerdict: ctx.verdict as any,
        }
      );
      return {
        id: l.id,
        title: l.title,
        price: l.price,
        priceText: l.priceText,
        url: l.url,
        location: l.location,
        imageUrl: l.imageUrl,
        description: l.detailDescription || l.description || '',
        firstSeenAt: l.firstSeenAt,
        aiScore: l.aiScore,
        aiRisk: l.aiRisk,
        aiVerdict: l.aiVerdict,
        aiReason: l.aiReason,
        aiEstimatedValue: l.aiEstimatedValue,
        aiImageVerdict: l.aiImageVerdict,
        previousPrice: l.previousPrice,
        priceDroppedAt: l.priceDroppedAt,
        sellerName: l.sellerName,
        sellerListingCount: l.sellerListingCount,
        monitor: l.monitor,
        category: cat,
        // Extract year from title/description
        year: extractYear(`${l.title} ${l.description} ${l.detailDescription ?? ''}`),
        // Computed
        buyScore: buyScore.score,
        buyVerdict: buyScore.verdict,
        expectedROI: buyScore.expectedROI,
        expectedProfit: buyScore.expectedProfit,
        suggestedMaxBuyPrice: buyScore.suggestedMaxBuyPrice,
        discountPercent: buyScore.discountPercent,
        confidence: buyScore.confidence,
        confidenceLabel: buyScore.confidenceLabel,
        reasoning: buyScore.reasoning,
        recommendation: buyScore.recommendation,
      };
    });

    // Determine winner — best value (highest buyScore, with tiebreaker on price)
    const sorted = [...compared].sort((a, b) => {
      if (b.buyScore !== a.buyScore) return b.buyScore - a.buyScore;
      return (a.price ?? Infinity) - (b.price ?? Infinity);
    });
    const winner = sorted[0];
    const cheapest = [...compared].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0];
    const bestAI = compared.filter(c => c.aiScore != null).sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0))[0];

    // AI advisor explanation
    const advisorInsights: string[] = [];
    if (winner) {
      advisorInsights.push(`🏆 Najboljša vrednost: "${winner.title}" — buy score ${winner.buyScore}/100 (${winner.buyVerdict}).`);
    }
    if (cheapest && cheapest.id !== winner?.id) {
      advisorInsights.push(`💰 Najcenejši: "${cheapest.title}" (${cheapest.price}€) — ${((winner?.price ?? 0) - (cheapest.price ?? 0)).toFixed(0)}€ razlike od najboljše vrednosti.`);
    }
    if (bestAI && bestAI.id !== winner?.id && bestAI.aiScore != null) {
      advisorInsights.push(`⭐ Najvišja AI ocena: "${bestAI.title}" (${bestAI.aiScore}/10) — višje zaupanje v kvaliteto artikla.`);
    }
    if (winner?.discountPercent != null && winner.discountPercent > 0) {
      advisorInsights.push(`📉 ${winner.discountPercent.toFixed(0)}% pod AI oceno vrednosti — dober deal.`);
    }
    if (winner?.expectedROI != null && winner.expectedROI > 0) {
      advisorInsights.push(`📈 Pričakovan ROI: +${winner.expectedROI.toFixed(0)}% (+${winner.expectedProfit?.toFixed(0)}€) če prodaš po tržnem povprečju.`);
    }
    // Risk warning
    const risky = compared.filter(c => c.aiRisk != null && c.aiRisk >= 6);
    if (risky.length > 0) {
      advisorInsights.push(`⚠️ ${risky.length} ${risky.length === 1 ? 'listing ima' : 'listinga imata'} visoko tveganje (≥6/10) — preveri podrobno pred nakupom.`);
    }
    // Price drop advantage
    const withDrop = compared.filter(c => c.priceDroppedAt != null);
    if (withDrop.length > 0) {
      advisorInsights.push(`📉 ${withDrop.length} ${withDrop.length === 1 ? 'listing ima' : 'listinga imata'} padec cene — prodajalec je motiviran.`);
    }
    if (advisorInsights.length === 0) {
      advisorInsights.push('Vsi primerjani listings so podobne vrednosti — izberi glede na osebno preferenco.');
    }

    return NextResponse.json({
      ok: true,
      compared,
      winner,
      cheapest,
      bestAI,
      advisorInsights,
      summary: {
        count: compared.length,
        priceRange: {
          min: Math.min(...compared.map(c => c.price ?? Infinity)),
          max: Math.max(...compared.map(c => c.price ?? 0)),
        },
        avgPrice: compared.reduce((s, c) => s + (c.price ?? 0), 0) / compared.length,
        avgBuyScore: compared.reduce((s, c) => s + c.buyScore, 0) / compared.length,
      },
      source: 'v8.72-compare',
    });

  } catch (err) {
    logger.error('/api/search/compare', 'POST failed', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}

function extractYear(text: string): number | null {
  const matches = text.match(/\b(19|20)\d{2}\b/g);
  if (!matches || matches.length === 0) return null;
  const years = matches.map(y => parseInt(y, 10)).filter(y => y >= 1990 && y <= new Date().getFullYear() + 1);
  return years.length > 0 ? Math.max(...years) : null;
}
