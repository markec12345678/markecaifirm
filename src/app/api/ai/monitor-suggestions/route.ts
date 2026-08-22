// v7.45 / v8.94-refactor: AI Monitor Suggestions — "dodaj 3 nove monitorje v kategoriji z 25% ROI"
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// Analizira:
// - Katere kategorije imajo visok ROI a malo monitorjev
// - Katere platforme (Bolha, Avtonet, mobile.de) imajo največ deal-ov
// - Katere keywords prinašajo najboljše deal-e
// → AI predlaga 5 novih monitorjev z URL, keywords, filtri
//
// GET /api/ai/monitor-suggestions

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface MonitorSuggestionsInput {}

export const GET = withAiRoute<MonitorSuggestionsInput>({
  endpoint: '/api/ai/monitor-suggestions',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET',

  parseBody: async () => {
    return {} as MonitorSuggestionsInput;
  },

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    // 1. Get category performance from sold trades
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true, buyFees: true, sellFees: true, title: true },
      take: 100,
    });

    // 2. Get existing monitors
    const monitors = await db.monitor.findMany({
      select: { id: true, name: true, source: true, sourceUrl: true, keywords: true, isActive: true },
    });

    // 3. Get listing stats per source
    const listings = await db.listing.findMany({
      where: { isHidden: false },
      select: { aiVerdict: true, dealScore: true, monitor: { select: { source: true, name: true } } },
      take: 2000,
    });

    const categoryStats = computeCategoryStats(soldTrades);
    const sourceStats = computeSourceStats(listings);

    const prompt = buildPrompt({
      activeMonitors: monitors.filter(m => m.isActive).length,
      totalMonitors: monitors.length,
      soldTradesCount: soldTrades.length,
      categoryStats,
      sourceStats,
      monitors,
    });

    let raw: string;
    try {
      raw = await callAi(prompt);
    } catch {
      // Fallback: simple suggestions based on best ROI category
      return apiOk(buildFallbackResponse(categoryStats, monitors));
    }

    const parsed: any = parseAi(raw);

    return apiOk({
      ok: true,
      currentMonitors: monitors.length,
      activeMonitors: monitors.filter(m => m.isActive).length,
      categoryStats,
      sourceStats,
      suggestions: (parsed?.suggestions || []).slice(0, 5).map((s: any) => ({
        name: String(s?.name ?? '').slice(0, 80),
        source: String(s?.source ?? 'bolha'),
        url: String(s?.url ?? '').slice(0, 500),
        keywords: String(s?.keywords ?? '').slice(0, 200),
        minPrice: Math.max(0, Number(s?.minPrice ?? 0)),
        maxPrice: Math.max(0, Number(s?.maxPrice ?? 1000)),
        reasoning: String(s?.reasoning ?? '').slice(0, 300),
        expectedRoiPct: Math.round(Number(s?.expectedRoiPct ?? 0)),
        priority: ['high', 'medium', 'low'].includes(String(s?.priority)) ? String(s.priority) : 'medium',
      })),
      strategySummary: String(parsed?.strategy_summary ?? '').slice(0, 300),
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface SoldTradeRow {
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  title: string;
}

function computeCategoryStats(soldTrades: SoldTradeRow[]) {
  const catMap = new Map<string, { invested: number; returned: number; count: number; titles: string[] }>();
  for (const t of soldTrades) {
    const cat = t.category || 'drugo';
    const cur = catMap.get(cat) || { invested: 0, returned: 0, count: 0, titles: [] };
    cur.invested += t.buyPrice + (t.buyFees ?? 0);
    cur.returned += (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    cur.count += 1;
    if (cur.titles.length < 5) cur.titles.push(t.title);
    catMap.set(cat, cur);
  }

  return Array.from(catMap.entries()).map(([cat, d]) => ({
    category: cat,
    roi: d.invested > 0 ? Math.round(((d.returned - d.invested) / d.invested) * 100) : 0,
    profit: Math.round(d.returned - d.invested),
    count: d.count,
    sampleTitles: d.titles,
  })).sort((a, b) => b.roi - a.roi);
}

interface ListingRow {
  aiVerdict: string | null;
  dealScore: number | null;
  monitor: { source: string | null; name: string | null } | null;
}

function computeSourceStats(listings: ListingRow[]) {
  const sourceMap = new Map<string, { total: number; deals: number; avgScore: number }>();
  for (const l of listings) {
    const src = l.monitor?.source || 'unknown';
    const cur = sourceMap.get(src) || { total: 0, deals: 0, avgScore: 0 };
    cur.total += 1;
    if (l.aiVerdict === 'PRILIKA') cur.deals += 1;
    if (l.dealScore) cur.avgScore += l.dealScore;
    sourceMap.set(src, cur);
  }
  return Array.from(sourceMap.entries()).map(([source, d]) => ({
    source,
    totalListings: d.total,
    dealCount: d.deals,
    dealRate: d.total > 0 ? Math.round((d.deals / d.total) * 100) : 0,
    avgDealScore: d.deals > 0 ? Math.round(d.avgScore / d.deals) : 0,
  })).sort((a, b) => b.dealRate - a.dealRate);
}

interface MonitorRow {
  id: string;
  name: string;
  source: string | null;
  sourceUrl: string | null;
  keywords: string | null;
  isActive: boolean;
}

interface PromptData {
  activeMonitors: number;
  totalMonitors: number;
  soldTradesCount: number;
  categoryStats: Array<{ category: string; roi: number; count: number; profit: number }>;
  sourceStats: Array<{ source: string; dealCount: number; totalListings: number; dealRate: number }>;
  monitors: MonitorRow[];
}

function buildPrompt(d: PromptData): string {
  return `Si ekspert za iskanje priložnosti na slovenskih in tujih oglasnih platformah.

TRENUTNO STANJE:
- Aktivni monitorji: ${d.activeMonitors}/${d.totalMonitors}
- Prodani trade-i: ${d.soldTradesCount}

KATEGORIJE PO ROI:
${d.categoryStats.map(c => `- ${c.category}: ROI ${c.roi}%, ${c.count} prodaj, profit ${c.profit}€`).join('\n')}

VIRI PO USPEŠNOSTI:
${d.sourceStats.map(s => `- ${s.source}: ${s.dealCount} deal-ov od ${s.totalListings} (${s.dealRate}% deal rate)`).join('\n')}

OBSTOJEČI MONITORJI:
${d.monitors.map(m => `- ${m.name} (${m.source}): ${m.keywords || 'brez keywords'}`).join('\n') || 'Ni monitorjev'}

NALOGA:
Predlagaj 5 novih monitorjev ki bi povečali dobiček. Za vsakega določi:
1. Platformo (bolha, nepremicnine, avtonet, vinted, mobile-de, kleinanzeigen, subito, willhaben)
2. Iskalni URL (realen, delujoč format za to platformo)
3. Keywords (ciljne iskalne besede)
4. Price range (min-max EUR, glede na kategorijo)
5. Zakaj ta monitor (razlog: visok ROI kategorija, nizek volumen monitorjev, etc.)
6. Pričakovan ROI (%)

PRAVILA:
- Ne predlagaj monitorjev ki že obstajajo (podobne keywords)
- Fokusiraj se na kategorije z visokim ROI
- Vključi 1-2 tuji trge (mobile.de, Kleinanzeigen) za cross-border arbitražo
- Bodiji specifičen (ne "iPhone" ampak "iPhone 13 Pro 128GB")

Odgovori LE z JSON:
{
  "suggestions": [
    {
      "name": "<ime monitorja>",
      "source": "<bolha|avtonet|vinted|mobile-de|kleinanzeigen|subito|willhaben|nepremicnine>",
      "url": "<realen search URL>",
      "keywords": "<comma-separated>",
      "minPrice": <number>,
      "maxPrice": <number>,
      "reasoning": "<1-2 stavka zakaj>",
      "expectedRoiPct": <number>,
      "priority": "<high|medium|low>"
    }
  ],
  "strategy_summary": "<1 stavek: kaj fokusirati>"
}`;
}

function buildFallbackResponse(categoryStats: Array<{ category: string; roi: number }>, monitors: MonitorRow[]) {
  const bestCat = categoryStats[0];
  return {
    ok: true,
    currentMonitors: monitors.length,
    activeMonitors: monitors.filter(m => m.isActive).length,
    categoryStats,
    sourceStats: [],
    suggestions: bestCat ? [{
      name: `${bestCat.category} — Bolha`,
      source: 'bolha',
      url: `https://www.bolha.com/iskanje?q=${encodeURIComponent(bestCat.category)}`,
      keywords: bestCat.category,
      minPrice: 50,
      maxPrice: 500,
      reasoning: `Kategorija z najvišjim ROI (${bestCat.roi}%)`,
      expectedRoiPct: bestCat.roi,
      priority: 'high',
    }] : [],
    strategySummary: 'AI ni na voljo — predlog iz lokalne zgodovine.',
  };
}
