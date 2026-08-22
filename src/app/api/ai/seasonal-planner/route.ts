// v6.26 / v8.95.8-refactor: AI Seasonal Inventory Planner — načrtuje sezonske nakupe in prodaje
// POST /api/ai/seasonal-planner
// Body: { monthsAhead?: number }
// Returns: { ok, calendar: [{ month, season, buyCategories, sellCategories, actions }], insights, summary }
// Refaktoriran z withAiRoute helperjem (v8.95.8) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Avg', 'Sep', 'Okt', 'Nov', 'Dec'];
const SEASONS = ['Zima', 'Zima', 'Pomlad', 'Pomlad', 'Pomlad', 'Poletje', 'Poletje', 'Poletje', 'Jesen', 'Jesen', 'Zima', 'Zima'];

interface SeasonalPlannerInput {
  monthsAhead: number;
}

export const POST = withAiRoute<SeasonalPlannerInput>({
  endpoint: '/api/ai/seasonal-planner',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { monthsAhead: Math.max(1, Math.min(12, Number(body?.monthsAhead) || 6)) };
  },

  // No validateInput — monthsAhead ima default

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { monthsAhead } = input;

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true, sellFees: true, buyFees: true,
        buyDate: true, sellDate: true },
      take: 300,
    });

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true } } },
    });

    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return apiOk({ ok: true, calendar: [], message: 'Ni podatkov za sezonsko načrtovanje.' });
    }

    // Analiza mesečnih prodaj po kategorijah
    const monthlyByCat = computeMonthlyByCat(soldTrades);

    const currentMonth = new Date().getMonth();
    const heldStr = heldTrades.slice(0, 15).map(t => `- ${t.title} | ${t.category} | ${Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000))}d v skladišču`).join('\n');

    const prompt = buildPrompt({
      monthsAhead,
      currentMonth,
      heldStr,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const validIds = new Set(heldTrades.map(t => t.id));

    const calendar = transformCalendar(parsed, monthsAhead, currentMonth, validIds);
    const summary = transformSummary(parsed);

    return apiOk({
      ok: true,
      insights: String(parsed?.insights ?? '').slice(0, 600),
      calendar,
      summary,
      monthsAhead,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function computeMonthlyByCat(
  soldTrades: Array<{ category: string | null; buyPrice: number; sellPrice: number | null; sellFees: number | null; buyFees: number | null; sellDate: Date | null }>
): Record<string, Record<number, { count: number; profit: number; avgPrice: number }>> {
  const monthlyByCat: Record<string, Record<number, { count: number; profit: number; avgPrice: number }>> = {};
  for (const t of soldTrades) {
    const cat = t.category || 'drugo';
    if (t.sellDate) {
      const month = t.sellDate.getMonth();
      if (!monthlyByCat[cat]) monthlyByCat[cat] = {};
      if (!monthlyByCat[cat][month]) monthlyByCat[cat][month] = { count: 0, profit: 0, avgPrice: 0 };
      monthlyByCat[cat][month].count++;
      const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
      monthlyByCat[cat][month].profit += profit;
      monthlyByCat[cat][month].avgPrice += t.sellPrice ?? 0;
    }
  }
  for (const cat of Object.keys(monthlyByCat)) {
    for (const m of Object.keys(monthlyByCat[cat])) {
      const d = monthlyByCat[cat][Number(m)];
      d.avgPrice = d.count > 0 ? Math.round(d.avgPrice / d.count) : 0;
    }
  }
  return monthlyByCat;
}

interface PromptData {
  monthsAhead: number;
  currentMonth: number;
  heldStr: string;
}

function buildPrompt(d: PromptData): string {
  return `Si ekspert za sezonsko načrtovanje pri preprodaji.
Ustvari koledar za naslednjih ${d.monthsAhead} mesecev z sezonskimi priporočili.

TRENUTNI MESEC: ${MONTHS[d.currentMonth]} (${SEASONS[d.currentMonth]})

TRENUTNI INVENTAR:
${d.heldStr || '- Prazno'}

Slovenska sezonska logika:
- ZIMA (Dec-Feb): grelniki, zimske gume, smuči, peči, kresovi, božična darila
- POMLAD (Mar-Maj): kolesa, vrtna oprema, motokulturke, kabrioleti, pohištvo
- POLETJE (Jun-Avg): kamp oprema, čolni, klima, avto oprema, vrtna garnitura
- JESEN (Sep-Nov): šolska oprema, športna oprema, ogrevanje, zimske gume, hladilniki

Pravila:
1. Za vsak mesec določi: KAJ kupiti (sezonsko ugodno), KAJ prodati (visoko povpraševanje)
2. Upoštevaj 1-2 mesece pred sezonskim vrhom za nakup (npr. smuči v oktobru, ne decembru)
3. Upoštevaj 1 mesec pred sezonskim padom za prodajo (npr. kolesa v avgustu, ne oktobru)
4. Identificiraj "shoulder season" priložnosti (med sezonami — nižje cene, dober nakup)
5. Za held items določi optimalen mesec za prodajo

Odgovori LE z JSON:
{
  "insights": "<splošne ugotovitve o sezonskih trendih, max 250 znakov>",
  "calendar": [
    {
      "month": "<mesec>",
      "season": "<Zima|Pomlad|Poletje|Jesen>",
      "buy_categories": [{"category": "<kat>", "reason": "<max 80 znakov>", "expected_discount_pct": <number>}],
      "sell_categories": [{"category": "<kat>", "reason": "<max 80 znakov>", "expected_premium_pct": <number>}],
      "held_items_to_sell": [{"id": "<trade_id>", "title": "<naslov>", "reason": "<max 80 znakov>"}],
      "actions": ["<konkretno dejanje za ta mesec, max 100 znakov>", "..."],
      "priority": "<high|medium|low>"
    }
  ],
  "summary": {
    "best_buy_month": "<mesec>",
    "best_sell_month": "<mesec>",
    "total_seasonal_opportunities": <number>,
    "expected_seasonal_profit_eur": <number>
  }
}`;
}

function transformCalendar(
  parsed: any,
  monthsAhead: number,
  currentMonth: number,
  validIds: Set<string>
): any[] {
  return (parsed?.calendar || []).slice(0, monthsAhead).map((c: any, i: number) => ({
    month: String(c?.month ?? MONTHS[(currentMonth + i) % 12]).slice(0, 30),
    season: String(c?.season ?? SEASONS[(currentMonth + i) % 12]).slice(0, 20),
    buyCategories: (c?.buy_categories || []).slice(0, 4).map((b: any) => ({
      category: String(b?.category ?? '').slice(0, 50),
      reason: String(b?.reason ?? '').slice(0, 150),
      expectedDiscountPct: Math.max(0, Math.min(50, Number(b?.expected_discount_pct ?? 0))),
    })),
    sellCategories: (c?.sell_categories || []).slice(0, 4).map((s: any) => ({
      category: String(s?.category ?? '').slice(0, 50),
      reason: String(s?.reason ?? '').slice(0, 150),
      expectedPremiumPct: Math.max(0, Math.min(50, Number(s?.expected_premium_pct ?? 0))),
    })),
    heldItemsToSell: (c?.held_items_to_sell || []).filter((h: any) => validIds.has(String(h?.id ?? ''))).map((h: any) => ({
      id: String(h?.id ?? ''),
      title: String(h?.title ?? '').slice(0, 100),
      reason: String(h?.reason ?? '').slice(0, 150),
    })),
    actions: (c?.actions || []).slice(0, 4).map((a: any) => String(a).slice(0, 200)),
    priority: ['high', 'medium', 'low'].includes(String(c?.priority)) ? String(c.priority) : 'medium',
  }));
}

function transformSummary(parsed: any): {
  bestBuyMonth: string;
  bestSellMonth: string;
  totalSeasonalOpportunities: number;
  expectedSeasonalProfitEur: number;
} {
  return {
    bestBuyMonth: String(parsed?.summary?.best_buy_month ?? '').slice(0, 30),
    bestSellMonth: String(parsed?.summary?.best_sell_month ?? '').slice(0, 30),
    totalSeasonalOpportunities: Math.max(0, Number(parsed?.summary?.total_seasonal_opportunities ?? 0)),
    expectedSeasonalProfitEur: Math.max(0, Number(parsed?.summary?.expected_seasonal_profit_eur ?? 0)),
  };
}
