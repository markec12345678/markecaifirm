// v6.0 / v8.96.0-batch4: AI Trend Predictions — AI napove tržne trende za kategorije
// Refaktoriran z withAiRoute helperjem (v8.96) + enforceBudget guard.
//
// POST /api/ai/trend-predictions
// Body: { days?: number (default 30), category?: string }
// Returns: { ok, predictions: Array<{ category, trend, predictedPriceChange, reasoning, confidence, dataPoints }> }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 120;

interface TrendPredictionsInput {
  days: number;
  category: string | null;
}

interface ListingRow {
  id: string;
  title: string;
  price: number | null;
  firstSeenAt: Date;
  aiVerdict: string | null;
  aiScore: number | null;
  dealScore: number | null;
  priceDroppedAt: Date | null;
  previousPrice: number | null;
  monitor: { source: string | null; name: string | null } | null;
}

interface CategoryStats {
  category: string;
  count: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  priceChangePct: number;
  avgDropPct: number;
  droppedCount: number;
  prilikaCount: number;
  sumnjivoCount: number;
  sources: string[];
}

export const POST = withAiRoute<TrendPredictionsInput>({
  endpoint: '/api/ai/trend-predictions',
  maxDuration: 120,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const daysRaw = typeof body?.days === 'number' ? body.days : Number(body?.days);
    const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(7, daysRaw)) : 30;
    return {
      days,
      category: body?.category ? String(body.category) : null,
    };
  },

  // No validateInput — days has default 30, category is optional
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { days, category } = input;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Gather all listings with prices in the time window
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: since },
        price: { not: null },
        isHidden: false,
      },
      select: {
        id: true, title: true, price: true, firstSeenAt: true,
        aiVerdict: true, aiScore: true, dealScore: true,
        priceDroppedAt: true, previousPrice: true,
        monitor: { select: { source: true, name: true } },
      },
      take: 5000,
    });

    // Group by "category" (extract from title keywords)
    const categoryMap: Record<string, ListingRow[]> = {};
    for (const l of listings) {
      const cat = extractCategory(l.title, l.monitor?.source ?? undefined);
      if (category && cat !== category) continue;
      if (!categoryMap[cat]) categoryMap[cat] = [];
      categoryMap[cat].push(l);
    }

    if (Object.keys(categoryMap).length === 0) {
      return apiOk({ ok: true, predictions: [], message: 'Ni dovolj podatkov za napoved.' });
    }

    const categoryStats = computeCategoryStats(categoryMap);

    if (categoryStats.length === 0) {
      return apiOk({ ok: true, predictions: [], message: 'Premalo podatkov (manj kot 3 na kategorijo).' });
    }

    const prompt = buildTrendPrompt(categoryStats, days);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const predictions = (parsed?.predictions || []).map((p: any, i: number) => ({
      category: categoryStats[i]?.category || String(p?.category || ''),
      trend: String(p?.trend ?? 'stable'),
      predictedPriceChange: clampInt(p?.predicted_price_change ?? p?.predictedPriceChange, -80, 80) ?? 0,
      reasoning: String(p?.reasoning ?? '').slice(0, 500),
      confidence: clampInt(p?.confidence, 0, 100) ?? 50,
      dataPoints: categoryStats[i]?.count ?? 0,
      currentAvgPrice: categoryStats[i]?.avgPrice ?? 0,
      recentPriceChangePct: categoryStats[i]?.priceChangePct ?? 0,
      recommendation: String(p?.recommendation ?? '').slice(0, 200),
    }));

    return apiOk({
      ok: true,
      predictions,
      analyzedAt: new Date().toISOString(),
      analyzedDays: days,
      totalListings: listings.length,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function computeCategoryStats(categoryMap: Record<string, ListingRow[]>): CategoryStats[] {
  return Object.entries(categoryMap).map(([cat, items]) => {
    const prices = items.map(l => l.price!).filter(Boolean);
    const avgPrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

    // Price drops
    const dropped = items.filter(l => l.priceDroppedAt != null && l.previousPrice != null);
    const avgDropPct = dropped.length > 0
      ? dropped.reduce((s, l) => s + ((l.previousPrice! - l.price!) / l.previousPrice!) * 100, 0) / dropped.length
      : 0;

    // Trend: compare first half vs second half by avg price
    const sorted = [...items].sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime());
    const midPoint = Math.floor(sorted.length / 2);
    const firstHalf = sorted.slice(0, midPoint);
    const secondHalf = sorted.slice(midPoint);
    const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((s, l) => s + l.price!, 0) / firstHalf.length : 0;
    const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((s, l) => s + l.price!, 0) / secondHalf.length : 0;
    const priceChangePct = firstAvg > 0 ? Math.round(((secondAvg - firstAvg) / firstAvg) * 100) : 0;

    // AI verdicts
    const prilika = items.filter(l => l.aiVerdict === 'PRILIKA').length;
    const sumnjivo = items.filter(l => l.aiVerdict === 'SUMNJIVO').length;

    return {
      category: cat,
      count: items.length,
      avgPrice,
      minPrice,
      maxPrice,
      priceChangePct,
      avgDropPct: Math.round(avgDropPct * 10) / 10,
      droppedCount: dropped.length,
      prilikaCount: prilika,
      sumnjivoCount: sumnjivo,
      sources: Array.from(new Set(
        items.map(l => l.monitor?.source).filter((s): s is string => typeof s === 'string')
      )),
    };
  }).filter(s => s.count >= 3); // Need at least 3 listings
}

function buildTrendPrompt(stats: CategoryStats[], days: number): string {
  const lines: string[] = [
    'Si ekspert za analizo tržnih trendov na slovenskih spletnih oglasih.',
    `Na podlagi podatkov iz zadnjih ${days} dni napovej trend za vsako kategorijo.`,
    '',
    'Podatki po kategorijah:',
  ];

  stats.forEach((s, i) => {
    lines.push(`--- Kategorija #${i + 1}: ${s.category} ---`);
    lines.push(`Število oglasov: ${s.count}`);
    lines.push(`Povprečna cena: ${s.avgPrice}€ (min ${s.minPrice}€, max ${s.maxPrice}€)`);
    lines.push(`Sprememba cene (prva polovica vs druga polovica): ${s.priceChangePct}%`);
    lines.push(`Povprečni padec cene: ${s.avgDropPct}% (${s.droppedCount} padcev)`);
    lines.push(`AI PRILIKA: ${s.prilikaCount}, SUMNJIVO: ${s.sumnjivoCount}`);
    lines.push(`Viri: ${s.sources.join(', ')}`);
    lines.push('');
  });

  lines.push('Za vsako kategorijo določi:');
  lines.push('1. Trend: rising (cene rastejo), stable (stabilno), declining (cene padajo)');
  lines.push('2. Predvidena sprememba cene v naslednjih 30 dneh (%)');
  lines.push('3. Razlog za napoved');
  lines.push('4. Confidence (0-100)');
  lines.push('5. Priporočilo (kupi zdaj / čakaj / prodaj)');
  lines.push('', 'Odgovori LE z JSON:');
  lines.push('{');
  lines.push('  "predictions": [');
  lines.push('    {');
  lines.push('      "trend": "<rising|stable|declining>",');
  lines.push('      "predicted_price_change": <number %>,');
  lines.push('      "reasoning": "<kratek razlog, max 200 znakov>",');
  lines.push('      "confidence": <0-100>,');
  lines.push('      "recommendation": "<kupi zdaj | čakaj | prodaj>"');
  lines.push('    }');
  lines.push(`    ... (${stats.length} kategorij, v istem vrstnem redu)`);
  lines.push('  ]');
  lines.push('}');

  return lines.join('\n');
}

function extractCategory(title: string, source?: string): string {
  const t = title.toLowerCase();
  if (/(iphone|samsung|telefon|laptop|macbook|pc|računalnik|konzola|ps5|xbox|tv|monitor|slušalke|predalnik)/.test(t)) return 'elektronika';
  if (/(avto|vozilo|golf|audi|bmw|toyota|renault|peugeot|citroen|ford|opel|skoda|vw|honda|mazda|yamaha)/.test(t)) return 'avto';
  if (/(stanovanje|hiša|hisa|zemljišče|garaža|nepremičnin)/.test(t)) return 'nepremicnine';
  if (/(orodje|bosch|makita|dewalt|vijačnik|bušilka|brusilka|kombinirka)/.test(t)) return 'orodje';
  if (/(hlače|majica|jakna|čevlji|oblačila|nike|adidas|levis|jack|jones)/.test(t)) return 'moda';
  if (/(smuči|kolo|fitnes|žoga|tenis|kolesar|rolka|board)/.test(t)) return 'sport';
  if (/(miza|stol|omara|postelja|pohištvo|telerik|sofa)/.test(t)) return 'pohistvo';
  if (/(knjiga|revija|ucbenik|strip)/.test(t)) return 'knjige';
  if (/(kitara|klavir|bobni|vinilka|gramofon|avdio|zvocnik)/.test(t)) return 'glasba';
  if (/(kovanec|znamka|starine|umetnina|antikvitet)/.test(t)) return 'zbirateljstvo';
  return 'drugo';
}

function clampInt(v: any, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
}
