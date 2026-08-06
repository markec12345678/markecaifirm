// v7.56: Market Gap Finder — poišče prazne/underserved niše kjer je povpraševanje
// visoko (veliko oglasov) ampak ponudba (prodani item-i) nizka — gap = priložnost.
//
// "iPhone 13: 50 oglasov, samo 2 prodani — gapScore 25. Visoka priložnost!"
//
// Čista DB analitika — BREZ AI klica.
// GET /api/analytics/market-gap-finder

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Slovenian + English stopwords — besede, ki jih ignoriramo pri keyword extraction.
const STOPWORDS = new Set<string>([
  // Slovenian
  'in', 'na', 'za', 'de', 'po', 'do', 'od', 'je', 'so', 'ali', 'tudi', 'ker', 'ko',
  'da', 'se', 'ni', 'bil', 'bila', 'bolo', 'bol', 'kateri', 'katere', 'katera', 'to',
  'ta', 'tega', 'tej', 'tem', 'tisto', 'tisti', 'tista', 'z', 's', 'v', 'pri', 'o',
  // English
  'the', 'a', 'an', 'of', 'to', 'is', 'are', 'for', 'and', 'or', 'with', 'on', 'in',
  'at', 'by', 'from', 'as', 'be', 'this', 'that', 'it', 'its',
  // Generic filler tokens
  'nov', 'novo', 'nova', 'rabljen', 'rabljeno', 'rabljena', 'uporabljen', 'dober', 'dobro',
  'dobra', 'stanje', 'prodajam', 'prodam', 'kupim', 'cena', 'eur', 'brez',
]);

// Kategorija ekstrahirana iz naslova — prva znana blagovna znamka/segment
const KNOWN_CATEGORIES: Array<{ key: string; matchers: string[] }> = [
  { key: 'iphone', matchers: ['iphone'] },
  { key: 'samsung', matchers: ['samsung', 'galaxy'] },
  { key: 'playstation', matchers: ['playstation', 'ps4', 'ps5'] },
  { key: 'xbox', matchers: ['xbox'] },
  { key: 'nintendo', matchers: ['nintendo', 'switch'] },
  { key: 'avto', matchers: ['avto', 'avtomobil', 'vozilo'] },
  { key: 'kolo', matchers: ['kolo', 'bicikel', 'bike'] },
  { key: 'pohistvo', matchers: ['omara', 'miza', 'stol', 'postelja', 'pohištvo', 'pohistvo'] },
  { key: 'orodje', matchers: ['orodje', 'vijačnik', 'sekira', 'žaga'] },
  { key: 'racunalnik', matchers: ['laptop', 'prenosnik', 'pc', 'racunalnik', 'računalnik'] },
  { key: 'telefon', matchers: ['telefon', 'mobilnik', 'pametni'] },
  { key: 'televizor', matchers: ['televizor', 'oled', 'qled'] },
  { key: 'kamera', matchers: ['kamera', 'objektiv', 'canon', 'nikon'] },
  { key: 'ura', matchers: ['ura', 'smartwatch'] },
  { key: 'oblecilo', matchers: ['jakna', 'hlače', 'majica', 'oblačilo', 'čevlji'] },
  { key: 'sport', matchers: ['fitnes', 'dumbbell', 'tekalna'] },
  { key: 'instrument', matchers: ['kitara', 'klavir', 'bobni', 'mikrofon'] },
  { key: 'knjige', matchers: ['knjiga', 'knjige', 'roman', 'strip'] },
  { key: 'igrace', matchers: ['lego', 'igrača', 'puzzle'] },
  { key: 'lepilo', matchers: ['parfum', 'kreme', 'ličila'] },
];

/** Map a free-form title (and optional monitor source) to a coarse category key. */
function classifyCategory(title: string, monitorSource?: string | null): string {
  const lower = title.toLowerCase();
  for (const cat of KNOWN_CATEGORIES) {
    if (cat.matchers.some(m => lower.includes(m))) return cat.key;
  }
  // Fallback: monitor source (bolha, vinted, avtonet …)
  if (monitorSource) return monitorSource.toLowerCase().replace(/[^a-z0-9]/g, '');
  // Fallback: first non-stopword token
  const first = title
    .toLowerCase()
    .split(/\s+/)
    .find(t => t.length > 2 && !STOPWORDS.has(t));
  return first ?? 'drugo';
}

/** Extract top-N keywords from a list of titles (excludes stopwords). */
function topKeywords(titles: string[], limit = 10): string[] {
  const freq = new Map<string, number>();
  for (const raw of titles) {
    const tokens = raw
      .toLowerCase()
      .split(/[^a-z0-9čšžđć]+/i)
      .map(t => t.trim())
      .filter(t => t.length > 2 && !STOPWORDS.has(t));
    for (const t of tokens) {
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w);
}

export async function GET() {
  try {
    // 1) Vsi listings — povpraševanje
    const listings = await db.listing.findMany({
      where: { isHidden: false },
      select: {
        id: true,
        title: true,
        price: true,
        monitor: { select: { source: true } },
      },
      take: 5000,
    });

    // 2) Vsi SOLD trades — dejanska ponudba (konkurenca)
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold' },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        sellPrice: true,
      },
      take: 5000,
    });

    if (listings.length === 0 && soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        gaps: [],
        summary: { totalCategories: 0, highGapCount: 0, bestOpportunity: null },
        message: 'Ni dovolj podatkov za analizo tržnih vrzeli.',
      });
    }

    // 3) Group listings by category
    const catListings = new Map<
      string,
      { count: number; sumPrice: number; priceSamples: number; titles: string[] }
    >();
    for (const l of listings) {
      const cat = classifyCategory(l.title, l.monitor?.source);
      const cur = catListings.get(cat) ?? { count: 0, sumPrice: 0, priceSamples: 0, titles: [] };
      cur.count += 1;
      if (l.price != null && l.price > 0) {
        cur.sumPrice += l.price;
        cur.priceSamples += 1;
      }
      cur.titles.push(l.title);
      catListings.set(cat, cur);
    }

    // 4) Group SOLD trades by same category
    const catSold = new Map<string, { count: number; titles: string[] }>();
    for (const t of soldTrades) {
      const cat = t.category?.trim()
        ? t.category.trim().toLowerCase()
        : classifyCategory(t.title);
      const cur = catSold.get(cat) ?? { count: 0, titles: [] };
      cur.count += 1;
      cur.titles.push(t.title);
      catSold.set(cat, cur);
    }

    // 5) Compute gap per category
    const gapRows = Array.from(catListings.entries()).map(([cat, l]) => {
      const sold = catSold.get(cat)?.count ?? 0;
      const demandScore = l.count;
      const supplyScore = sold;
      const gapScore = Math.round((demandScore / (supplyScore + 1)) * 100) / 100;
      const avgPrice = l.priceSamples > 0 ? Math.round(l.sumPrice / l.priceSamples) : 0;
      const opportunity: 'HIGH_GAP' | 'BALANCED' | 'SATURATED' =
        gapScore >= 5 ? 'HIGH_GAP' : gapScore >= 1.5 ? 'BALANCED' : 'SATURATED';
      const recommendation =
        opportunity === 'HIGH_GAP'
          ? `Veliko iskanj (${l.count}), malo prodaj (${sold}) — priložnost za vstop`
          : opportunity === 'BALANCED'
          ? `Zmerno ravnovesje: ${l.count} oglasov, ${sold} prodaj — nadaljuj previdno`
          : `Nasičen trg: ${l.count} oglasov, ${sold} prodaj — visoka konkurenca`;
      // Add sold titles to the keyword pool
      const allTitles = [...l.titles, ...(catSold.get(cat)?.titles ?? [])];
      const topKw = topKeywords(allTitles, 10);
      return {
        category: cat,
        listingsFound: l.count,
        soldCount: sold,
        demandScore,
        supplyScore,
        gapScore,
        opportunity,
        avgPrice,
        topKeywords: topKw,
        recommendation,
      };
    });

    // Sort by gapScore desc, then by listingsFound desc
    gapRows.sort((a, b) => b.gapScore - a.gapScore || b.listingsFound - a.listingsFound);
    const topGaps = gapRows.slice(0, 10);

    const highGapCount = gapRows.filter(g => g.opportunity === 'HIGH_GAP').length;
    const bestOpportunity = topGaps[0]?.category ?? null;

    return NextResponse.json({
      ok: true,
      gaps: topGaps,
      summary: {
        totalCategories: gapRows.length,
        highGapCount,
        bestOpportunity,
        totalListings: listings.length,
        totalSold: soldTrades.length,
      },
      recommendation:
        topGaps[0] != null
          ? `🎯 Najboljša priložnost: kategorija "${topGaps[0].category}" (${topGaps[0].listingsFound} oglasov, ${topGaps[0].soldCount} prodaj, gapScore ${topGaps[0].gapScore}). ${topGaps[0].recommendation}.`
          : 'Ni dovolj podatkov za priporočilo.',
    });
  } catch (err: any) {
    logger.error('/api/analytics/market-gap-finder', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
