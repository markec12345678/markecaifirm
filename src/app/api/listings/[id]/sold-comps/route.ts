// v9.70: Sold Comps — "Za koliko so se podobni artikli dejansko prodali?"
//
// Najbolj dobičkonosna funkcija: uporabnik VE dejansko prodajno ceno
// podobnih artiklov (iz naše baze sold trades), ne samo AI guess.
//
// Logika:
// 1. Vzemi listing (title, category, price)
// 2. Najdi vse sold trades v isti kategoriji
// 3. Filtriraj po podobnosti naslova (fuzzy matching)
// 4. Razvrsti po datumu prodaje (najnovejši prvi)
// 5. Vrni: soldPrice, profit, ROI, daysHeld, title, datum prodaje
//
// Uporaba:
// - Listing detail modal: "Sold Comps" sekcija
// - AI lahko uporabi za boljšo aiEstimatedValue
// - Deal Score lahko upošteva comps

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

interface SoldComp {
  id: string;
  title: string;
  buyPrice: number;
  sellPrice: number;
  profit: number;
  roi: number;
  daysHeld: number;
  category: string;
  sellDate: string;
  source: string;
  similarity: number; // 0-100 how similar to target listing
}

interface SoldCompsResponse {
  ok: true;
  listing: {
    id: string;
    title: string;
    price: number | null;
    category: string;
  };
  comps: SoldComp[];
  summary: {
    totalComps: number;
    avgSellPrice: number;
    avgProfit: number;
    avgRoi: number;
    avgDaysHeld: number;
    winRate: number;
    priceRange: { min: number; max: number };
  };
  recommendation: string;
}

/**
 * Fuzzy similarity score (0-100) between two titles.
 * Uporablja token-based Jaccard similarity + keyword overlap.
 */
function titleSimilarity(title1: string, title2: string): number {
  const normalize = (s: string) => s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const words1 = new Set(normalize(title1));
  const words2 = new Set(normalize(title2));

  if (words1.size === 0 || words2.size === 0) return 0;

  // Jaccard similarity
  const intersection = new Set([...words1].filter((w) => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  const jaccard = intersection.size / union.size;

  // Keyword overlap (weighted — bolj pomembne besede)
  const keywords1 = normalize(title1).filter((w) => w.length > 4);
  const keywords2 = new Set(normalize(title2).filter((w) => w.length > 4));
  const keywordOverlap = keywords1.filter((w) => keywords2.has(w)).length;
  const keywordScore = keywords1.length > 0 ? keywordOverlap / keywords1.length : 0;

  // Weighted combination
  return Math.round((jaccard * 0.4 + keywordScore * 0.6) * 100);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Fetch the listing
    const listing = await db.listing.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        price: true,
        priceText: true,
        monitorId: true,
        monitor: { select: { source: true } },
      },
    });

    if (!listing) {
      return NextResponse.json(
        { ok: false, error: 'Listing ni najden' },
        { status: 404 }
      );
    }

    // Fetch all sold trades (for comp matching)
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
      },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        buyDate: true,
        sellDate: true,
        buyLocation: true,
      },
      orderBy: { sellDate: 'desc' },
      take: 200, // omejitev za performance
    });

    // Calculate comps with similarity
    const comps: SoldComp[] = soldTrades
      .map((trade) => {
        const similarity = titleSimilarity(listing.title, trade.title);
        const cost = trade.buyPrice + (trade.buyFees ?? 0);
        const revenue = (trade.sellPrice ?? 0) - (trade.sellFees ?? 0);
        const profit = revenue - cost;
        const roi = cost > 0 ? Math.round((profit / cost) * 100) : 0;
        const daysHeld = trade.sellDate && trade.buyDate
          ? Math.floor((new Date(trade.sellDate).getTime() - new Date(trade.buyDate).getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        return {
          id: trade.id,
          title: trade.title,
          buyPrice: trade.buyPrice,
          sellPrice: trade.sellPrice ?? 0,
          profit: Math.round(profit),
          roi,
          daysHeld,
          category: trade.category,
          sellDate: trade.sellDate?.toISOString() ?? new Date().toISOString(),
          source: trade.buyLocation || 'Bolha',
          similarity,
        };
      })
      // Samo comps z vsaj 20% podobnosti (prepreči nepovezane rezultate)
      .filter((c) => c.similarity >= 20)
      // Sort: najprej po podobnosti, potem po datumu
      .sort((a, b) => {
        if (b.similarity !== a.similarity) return b.similarity - a.similarity;
        return new Date(b.sellDate).getTime() - new Date(a.sellDate).getTime();
      })
      .slice(0, 10); // top 10 comps

    // Calculate summary
    let summary = {
      totalComps: comps.length,
      avgSellPrice: 0,
      avgProfit: 0,
      avgRoi: 0,
      avgDaysHeld: 0,
      winRate: 0,
      priceRange: { min: 0, max: 0 },
    };

    if (comps.length > 0) {
      const sellPrices = comps.map((c) => c.sellPrice);
      summary = {
        totalComps: comps.length,
        avgSellPrice: Math.round(comps.reduce((s, c) => s + c.sellPrice, 0) / comps.length),
        avgProfit: Math.round(comps.reduce((s, c) => s + c.profit, 0) / comps.length),
        avgRoi: Math.round(comps.reduce((s, c) => s + c.roi, 0) / comps.length),
        avgDaysHeld: Math.round(comps.reduce((s, c) => s + c.daysHeld, 0) / comps.length),
        winRate: Math.round((comps.filter((c) => c.profit > 0).length / comps.length) * 100),
        priceRange: {
          min: Math.min(...sellPrices),
          max: Math.max(...sellPrices),
        },
      };
    }

    // Generate recommendation
    let recommendation = '';
    if (comps.length === 0) {
      recommendation = 'Ni dovolj podatkov o prodajah podobnih artiklov. Dodaj več trgovin za boljše comps.';
    } else if (listing.price && summary.avgSellPrice > 0) {
      const potentialProfit = summary.avgSellPrice - listing.price;
      const potentialRoi = listing.price > 0 ? Math.round((potentialProfit / listing.price) * 100) : 0;

      if (potentialProfit > 50 && potentialRoi > 30) {
        recommendation = `🎯 DOBRA PRILOŽNOST: Povprečna prodajna cena je ${summary.avgSellPrice}€. Če kupiš za ${listing.price}€, projekcija je +${potentialProfit}€ dobička (ROI ${potentialRoi}%).`;
      } else if (potentialProfit > 0) {
        recommendation = `△ MARGINALNA: Povprečna prodajna cena je ${summary.avgSellPrice}€. Projekcija +${potentialProfit}€ dobička (ROI ${potentialRoi}%).`;
      } else {
        recommendation = `✗ PREDRAGO: Povprečna prodajna cena je ${summary.avgSellPrice}€, ampak ta oglas stane ${listing.price}€. Verjetno izguba.`;
      }
    } else {
      recommendation = `Na voljo ${comps.length} comps. Povprečna prodajna cena: ${summary.avgSellPrice}€.`;
    }

    const response: SoldCompsResponse = {
      ok: true,
      listing: {
        id: listing.id,
        title: listing.title,
        price: listing.price,
        category: listing.monitor?.source || 'drugo',
      },
      comps,
      summary,
      recommendation,
    };

    return NextResponse.json(response);
  } catch (err: any) {
    logger.error('/api/listings/[id]/sold-comps', 'GET failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka pri pridobivanju sold comps' },
      { status: 500 }
    );
  }
}
