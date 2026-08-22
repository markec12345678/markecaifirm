// v7.64 / v8.96.5-batch1: Seasonal Timing Optimizer — AI analizira sezonske
// vzorce in priporoči OPTIMALNI timing za nakup in prodajo specifičnih
// kategorij. Razlika od seasonal-calendar (ki statično prikaže najboljši mesec)
// — ta upošteva TRENUTNI datum, held inventar in predvidi najboljše 2-tedensko
// okno za vsako akcijo (buy/sell). Refaktoriran z withAiRoute helperjem
// (v8.96) + enforceBudget guard.
//
// Razlika od seasonal-planner (ki načrtuje mesece za buy/sell kategorije) —
// ta gleda posamezne HELD item-e in da per-item timing (kateri item prodati
// ZDAJ in kateremu čakati na vrh). Razlika od seasonal-pricing (ki prilagodi
// cene) — ta optimira TIMING (kdaj prodati) ne ceno.
//
// "PS5: WAIT_FOR_PEAK (Nov-Dec), +12% price uplift, 45 days to wait.
//  Moda: BUY_NOW (off-season, -15%)"
//
// GET+POST /api/ai/seasonal-timing-optimizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface SeasonalTimingOptimizerInput {}

// --- Types ---------------------------------------------------------------

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Maj',
  'Jun',
  'Jul',
  'Avg',
  'Sep',
  'Okt',
  'Nov',
  'Dec',
];

interface MonthlyAgg {
  sellPriceSum: number;
  count: number;
  buyPriceSum: number;
}

interface CategorySeasonal {
  category: string;
  bestSellingMonths: string[];
  worstSellingMonths: string[];
  pricePremium: number; // % diff between best and worst month
  currentMonthScore: number; // 0-100
  recommendation:
    | 'GOOD_TIME_TO_SELL'
    | 'WAIT'
    | 'GOOD_TIME_TO_BUY'
    | 'NEUTRAL';
  monthlyAvgPrices: Array<{ month: string; avgPrice: number; count: number }>;
}

interface SellTiming {
  tradeId: string;
  title: string;
  category: string;
  action: 'SELL_NOW' | 'WAIT_FOR_PEAK' | 'HOLD_THEN_SELL';
  optimalSellWindow: { startMonth: string; endMonth: string };
  daysToWait: number;
  expectedPriceUplift: number; // %
  reasoning: string;
}

interface BuyTiming {
  category: string;
  recommendation: 'BUY_NOW' | 'WAIT' | 'AVOID';
  reasoning: string;
  expectedDiscount: number; // % off-peak price
}

interface SeasonalSummary {
  itemsToSellNow: number;
  itemsToWait: number;
  bestCategoryToBuyNow: string | null;
  bestCategoryToSellNow: string | null;
  advice: string;
}

interface AiSellEntry {
  tradeId?: unknown;
  action?: unknown;
  optimalSellWindow?: unknown;
  daysToWait?: unknown;
  expectedPriceUplift?: unknown;
  reasoning?: unknown;
}

interface AiBuyEntry {
  category?: unknown;
  recommendation?: unknown;
  reasoning?: unknown;
  expectedDiscount?: unknown;
}

interface AiSeasonalResponse {
  sellTiming?: AiSellEntry[];
  buyTiming?: AiBuyEntry[];
  advice?: unknown;
}

// --- Helpers -------------------------------------------------------------

function clampNumber(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw == null) return Math.max(min, Math.min(max, fallback));
  const v = Number(raw);
  if (!Number.isFinite(v)) return Math.max(min, Math.min(max, fallback));
  return Math.max(min, Math.min(max, Math.round(v)));
}

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

function clampEnum<T extends string>(
  raw: unknown,
  valid: readonly T[],
  fallback: T,
): T {
  const s = String(raw).trim().toUpperCase();
  for (const v of valid) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
}

// Compute days from current date to the start of a target month (in current or next year)
function daysUntilMonth(targetMonthIdx: number, now: Date): number {
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  let year = currentYear;
  let month = targetMonthIdx;
  if (month < currentMonth) {
    // Target month is earlier in year — wait until next year
    year = currentYear + 1;
  }
  const targetDate = new Date(year, month, 1);
  const diffMs = targetDate.getTime() - now.getTime();
  return Math.max(0, Math.round(diffMs / 86_400_000));
}

// Convert month name (Jan/Feb/...) to month index (0-11)
function monthNameToIdx(name: string): number | null {
  const idx = MONTHS.indexOf(name);
  return idx >= 0 ? idx : null;
}

// Compute the optimal sell window for a category based on monthly averages
function computeOptimalSellWindow(
  category: CategorySeasonal,
): { startMonth: string; endMonth: string } | null {
  if (category.monthlyAvgPrices.length === 0) return null;
  // Sort by avgPrice desc, take top month
  const sorted = [...category.monthlyAvgPrices].sort(
    (a, b) => b.avgPrice - a.avgPrice,
  );
  const bestMonth = sorted[0];
  const bestIdx = monthNameToIdx(bestMonth.month);
  if (bestIdx == null) return null;
  // End month = best month, start month = 1 month before (or same if Jan)
  const startIdx = bestIdx === 0 ? 11 : bestIdx - 1;
  return {
    startMonth: MONTHS[startIdx],
    endMonth: MONTHS[bestIdx],
  };
}

// --- Deterministic fallback ---------------------------------------------

// Build deterministic sell timing for a held item based on seasonal patterns
function deterministicSellTiming(
  tradeId: string,
  title: string,
  category: string,
  buyPrice: number,
  seasonalMap: Map<string, CategorySeasonal>,
  now: Date,
): SellTiming {
  const seasonal = seasonalMap.get(category);
  if (!seasonal) {
    return {
      tradeId,
      title,
      category,
      action: 'SELL_NOW',
      optimalSellWindow: { startMonth: MONTHS[now.getMonth()], endMonth: MONTHS[now.getMonth()] },
      daysToWait: 0,
      expectedPriceUplift: 0,
      reasoning: `Ni sezonskih podatkov za "${category}" — prodaj po trenutni tržni ceni (${buyPrice}€ osnova).`,
    };
  }

  const optimalWindow = computeOptimalSellWindow(seasonal);
  if (!optimalWindow) {
    return {
      tradeId,
      title,
      category,
      action: 'SELL_NOW',
      optimalSellWindow: { startMonth: MONTHS[now.getMonth()], endMonth: MONTHS[now.getMonth()] },
      daysToWait: 0,
      expectedPriceUplift: 0,
      reasoning: `Premalo sezonskih podatkov za "${category}" — prodaj po trenutni ceni.`,
    };
  }

  const startIdx = monthNameToIdx(optimalWindow.startMonth);
  const endIdx = monthNameToIdx(optimalWindow.endMonth);
  if (startIdx == null || endIdx == null) {
    return {
      tradeId,
      title,
      category,
      action: 'SELL_NOW',
      optimalSellWindow: optimalWindow,
      daysToWait: 0,
      expectedPriceUplift: 0,
      reasoning: `Sezonski podatki nepopolni — prodaj po trenutni ceni.`,
    };
  }

  const currentMonth = now.getMonth();
  const daysToWait = daysUntilMonth(startIdx, now);

  // Compute expected price uplift — difference between current month avg and best month avg
  const currentMonthData = seasonal.monthlyAvgPrices.find(
    m => monthNameToIdx(m.month) === currentMonth,
  );
  const bestMonthData = seasonal.monthlyAvgPrices.find(
    m => monthNameToIdx(m.month) === endIdx,
  );
  let expectedPriceUplift = 0;
  if (currentMonthData && bestMonthData && currentMonthData.avgPrice > 0) {
    expectedPriceUplift = Math.round(
      ((bestMonthData.avgPrice - currentMonthData.avgPrice) /
        currentMonthData.avgPrice) *
        100,
    );
  }

  // Anti-hallucination: clamp to [0%, 30%]
  expectedPriceUplift = Math.max(0, Math.min(30, expectedPriceUplift));

  // Action: SELL_NOW if daysToWait < 14 (we're in/near peak), else WAIT_FOR_PEAK
  let action: SellTiming['action'];
  if (daysToWait < 14) {
    action = 'SELL_NOW';
  } else if (daysToWait < 90 && expectedPriceUplift >= 5) {
    action = 'WAIT_FOR_PEAK';
  } else if (expectedPriceUplift >= 3) {
    action = 'HOLD_THEN_SELL';
  } else {
    action = 'SELL_NOW';
  }

  const reasoning = `"${title.slice(0, 40)}" (${category}) — vrh sezone ${optimalWindow.startMonth}-${optimalWindow.endMonth}, pričakovan uplift +${expectedPriceUplift}% če prodaš v vrhu, ${daysToWait} dni do okna.`;

  return {
    tradeId,
    title,
    category,
    action,
    optimalSellWindow: optimalWindow,
    daysToWait: Math.min(180, daysToWait), // anti-hallucination clamp [0, 180]
    expectedPriceUplift,
    reasoning,
  };
}

function deterministicBuyTiming(
  seasonal: CategorySeasonal,
  now: Date,
): BuyTiming {
  const currentMonth = now.getMonth();
  const currentMonthData = seasonal.monthlyAvgPrices.find(
    m => monthNameToIdx(m.month) === currentMonth,
  );
  if (!currentMonthData || seasonal.monthlyAvgPrices.length === 0) {
    return {
      category: seasonal.category,
      recommendation: 'WAIT',
      reasoning: `Premalo sezonskih podatkov za "${seasonal.category}".`,
      expectedDiscount: 0,
    };
  }

  // Find max avg price (peak) for this category
  const peak = Math.max(
    ...seasonal.monthlyAvgPrices.map(m => m.avgPrice),
  );
  let expectedDiscount = 0;
  if (peak > 0 && currentMonthData.avgPrice < peak) {
    expectedDiscount = Math.round(
      ((peak - currentMonthData.avgPrice) / peak) * 100,
    );
  }
  expectedDiscount = Math.max(0, Math.min(30, expectedDiscount));

  let recommendation: BuyTiming['recommendation'];
  if (expectedDiscount >= 10) {
    recommendation = 'BUY_NOW';
  } else if (expectedDiscount >= 5) {
    recommendation = 'WAIT';
  } else {
    recommendation = 'AVOID';
  }

  const reasoning = `"${seasonal.category}" je trenutno ${expectedDiscount}% pod vrhom sezone (${peak}€) — ${recommendation === 'BUY_NOW' ? 'kupuj zdaj (off-season popust)' : recommendation === 'WAIT' ? 'počakaj na boljši popust' : 'cena blizu vrha — ne kupuj'}.`;

  return {
    category: seasonal.category,
    recommendation,
    reasoning,
    expectedDiscount,
  };
}

function buildSummary(
  sellTiming: SellTiming[],
  buyTiming: BuyTiming[],
  seasonalPatterns: CategorySeasonal[],
): SeasonalSummary {
  const itemsToSellNow = sellTiming.filter(s => s.action === 'SELL_NOW').length;
  const itemsToWait = sellTiming.filter(
    s => s.action === 'WAIT_FOR_PEAK' || s.action === 'HOLD_THEN_SELL',
  ).length;

  // Best category to BUY now (highest expected discount with BUY_NOW recommendation)
  const buyNowOptions = buyTiming.filter(b => b.recommendation === 'BUY_NOW');
  const bestBuy =
    buyNowOptions.length > 0
      ? [...buyNowOptions].sort((a, b) => b.expectedDiscount - a.expectedDiscount)[0]
          ?.category ?? null
      : null;

  // Best category to SELL now (highest currentMonthScore with GOOD_TIME_TO_SELL)
  const sellNowOptions = seasonalPatterns.filter(
    s => s.recommendation === 'GOOD_TIME_TO_SELL',
  );
  const bestSell =
    sellNowOptions.length > 0
      ? [...sellNowOptions].sort(
          (a, b) => b.currentMonthScore - a.currentMonthScore,
        )[0]?.category ?? null
      : null;

  let advice: string;
  if (itemsToSellNow > 0 && bestBuy) {
    advice = `${itemsToSellNow} item-ov prodaj zdaj, ${itemsToWait} čaka na vrh. "${bestBuy}" kupuj zdaj (off-season popust).`;
  } else if (itemsToSellNow > 0) {
    advice = `${itemsToSellNow} item-ov prodaj zdaj, ${itemsToWait} čaka na vrh sezone. Trenutno ni kategorije za off-season nakup.`;
  } else if (bestBuy) {
    advice = `Ni nujnih prodaj. "${bestBuy}" kupuj zdaj (off-season popust). Ostali inventar čaka na vrh sezone.`;
  } else {
    advice = `Trenutno brez held inventarja. Premalo sezonskih podatkov za buy nasvet.`;
  }

  return {
    itemsToSellNow,
    itemsToWait,
    bestCategoryToBuyNow: bestBuy,
    bestCategoryToSellNow: bestSell,
    advice,
  };
}

// --- AI prompt + merge helpers (pure, extracted OUTSIDE handler) ----------

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyDate: Date | null;
}

function buildSeasonalBlock(seasonalPatterns: CategorySeasonal[], currentMonthIdx: number): string {
  return seasonalPatterns
    .slice(0, 8)
    .map(s => {
      const monthly = s.monthlyAvgPrices
        .map(m => `${m.month}:${m.avgPrice}€ (${m.count})`)
        .join(', ');
      return `- ${s.category}: vrh [${s.bestSellingMonths.join(',')}], nizko [${s.worstSellingMonths.join(',')}], premium ${s.pricePremium}%, trenutni mesec ${MONTHS[currentMonthIdx]} score ${s.currentMonthScore}/100. Mesečno: ${monthly}`;
    })
    .join('\n');
}

function buildHeldBlock(heldTrades: HeldTradeRow[]): string {
  return heldTrades
    .slice(0, 30)
    .map(
      (t, idx) =>
        `${idx + 1}. tradeId=${t.id} | naslov="${t.title}" | kategorija=${(t.category || 'drugo').trim().toLowerCase()} | buyPrice=${t.buyPrice}€ | buyDate=${t.buyDate?.toISOString().split('T')[0] ?? '—'}`,
    )
    .join('\n');
}

function buildPrompt(
  now: Date,
  currentMonthIdx: number,
  seasonalBlock: string,
  heldBlock: string,
): string {
  return `Si AI strategist za sezonsko optimizacijo na slovenskih in srednjeevropskih oglasnih platformah.
Analiziral si 24-mesečno zgodovino prodaj in določil OPTIMALNI timing za nakup in prodajo.

TRENUTNI DATUM: ${now.toISOString().split('T')[0]} (mesec: ${MONTHS[currentMonthIdx]})

SEZONSKI VZORCI PO KATEGORIJAH (zgodovina 24 mesecev):
${seasonalBlock || '- Ni zgodovine prodaj'}

TRENUTNO HELD INVENTAR (treba prodati):
${heldBlock || '- Ni held inventarja'}

PRAVILA ZA SELL TIMING (per held item):
1. Za vsak held item določi action: SELL_NOW | WAIT_FOR_PEAK | HOLD_THEN_SELL.
2. SELL_NOW: če smo v ali blizu vrhu sezone (daysToWait < 14).
3. WAIT_FOR_PEAK: če pričakovan price uplift >= 5% in daysToWait < 90.
4. HOLD_THEN_SELL: če je uplift manjši a vredno čakati (daysToWait 90-180).
5. optimalSellWindow: { startMonth, endMonth } v formatu "Nov", "Dec" (slovenske kratke oznake).
6. daysToWait: dni od danes do začetka okna (CLAMP [0, 180]).
7. expectedPriceUplift: % višja cena v vrhu vs trenutni mesec (CLAMP [0, 30] %).
8. reasoning: 1 stavek slovensko z utemeljitvijo.

PRAVILA ZA BUY TIMING (per kategorija):
1. Priporočilo: BUY_NOW (off-season popust >= 10%) | WAIT (popust 5-10%) | AVOID (cena blizu vrha).
2. expectedDiscount: % popust od vrha sezone (CLAMP [0, 30] %).
3. reasoning: 1 stavek slovensko.

VRNI LE JSON:
{
  "sellTiming": [
    {
      "tradeId": "<id>",
      "action": "SELL_NOW|WAIT_FOR_PEAK|HOLD_THEN_SELL",
      "optimalSellWindow": { "startMonth": "...", "endMonth": "..." },
      "daysToWait": <0-180>,
      "expectedPriceUplift": <0-30>,
      "reasoning": "<slovensko, 1 stavek>"
    }
  ],
  "buyTiming": [
    {
      "category": "<kategorija>",
      "recommendation": "BUY_NOW|WAIT|AVOID",
      "reasoning": "<slovensko, 1 stavek>",
      "expectedDiscount": <0-30>
    }
  ],
  "advice": "<1-2 povedi slovensko, overall timing nasvet>"
}${GROUNDING_PROMPT_SUFFIX}`;
}

interface MergeResult {
  sellTiming: SellTiming[];
  buyTiming: BuyTiming[];
  advice: string;
  aiUsed: boolean;
}

function mergeAiIntoSeasonalTiming(
  parsed: AiSeasonalResponse | null,
  heldTrades: HeldTradeRow[],
  seasonalMap: Map<string, CategorySeasonal>,
  seasonalPatterns: CategorySeasonal[],
  now: Date,
): MergeResult {
  let sellTiming: SellTiming[] = [];
  let buyTiming: BuyTiming[] = [];
  let advice = '';
  let aiUsed = false;

  if (parsed) {
    // Build held trades lookup by ID
    const heldById = new Map(heldTrades.map(t => [t.id, t]));

    // Validate sellTiming entries
    if (Array.isArray(parsed.sellTiming)) {
      const seenIds = new Set<string>();
      for (const rawS of parsed.sellTiming) {
        const tid = String(rawS.tradeId || '').trim();
        const held = heldById.get(tid);
        if (!held) continue;
        if (seenIds.has(tid)) continue;
        seenIds.add(tid);

        const cat = (held.category || 'drugo').trim().toLowerCase();
        const det = deterministicSellTiming(
          held.id,
          held.title,
          cat,
          held.buyPrice,
          seasonalMap,
          now,
        );

        const action = clampEnum(
          rawS.action,
          ['SELL_NOW', 'WAIT_FOR_PEAK', 'HOLD_THEN_SELL'] as const,
          det.action,
        );

        // Validate optimalSellWindow — must contain valid month names
        const windowRaw = rawS.optimalSellWindow;
        let startMonth = det.optimalSellWindow.startMonth;
        let endMonth = det.optimalSellWindow.endMonth;
        if (
          windowRaw &&
          typeof windowRaw === 'object' &&
          'startMonth' in windowRaw &&
          'endMonth' in windowRaw
        ) {
          const sm = String((windowRaw as any).startMonth || '').trim();
          const em = String((windowRaw as any).endMonth || '').trim();
          if (MONTHS.includes(sm)) startMonth = sm;
          if (MONTHS.includes(em)) endMonth = em;
        }

        // Anti-hallucination: daysToWait clamped [0, 180]
        const daysToWait = clampNumber(rawS.daysToWait, 0, 180, det.daysToWait);
        // Anti-hallucination: expectedPriceUplift clamped [0, 30]
        const expectedPriceUplift = clampNumber(
          rawS.expectedPriceUplift,
          0,
          30,
          det.expectedPriceUplift,
        );
        const reasoning = clampString(
          rawS.reasoning,
          240,
          det.reasoning,
        );

        sellTiming.push({
          tradeId: held.id,
          title: held.title,
          category: cat,
          action,
          optimalSellWindow: { startMonth, endMonth },
          daysToWait,
          expectedPriceUplift,
          reasoning,
        });
      }
    }
    // Fill in any held items AI didn't cover
    const seenIds = new Set(sellTiming.map(s => s.tradeId));
    for (const held of heldTrades) {
      if (!seenIds.has(held.id)) {
        const cat = (held.category || 'drugo').trim().toLowerCase();
        sellTiming.push(
          deterministicSellTiming(
            held.id,
            held.title,
            cat,
            held.buyPrice,
            seasonalMap,
            now,
          ),
        );
      }
    }

    // Validate buyTiming entries
    if (Array.isArray(parsed.buyTiming)) {
      const seenCats = new Set<string>();
      for (const rawB of parsed.buyTiming) {
        const cat = String(rawB.category || '').trim().toLowerCase();
        if (!cat || seenCats.has(cat)) continue;
        const seasonal = seasonalMap.get(cat);
        if (!seasonal) continue; // skip categories with no history
        seenCats.add(cat);

        const det = deterministicBuyTiming(seasonal, now);
        const recommendation = clampEnum(
          rawB.recommendation,
          ['BUY_NOW', 'WAIT', 'AVOID'] as const,
          det.recommendation,
        );
        const expectedDiscount = clampNumber(
          rawB.expectedDiscount,
          0,
          30,
          det.expectedDiscount,
        );
        const reasoning = clampString(rawB.reasoning, 240, det.reasoning);
        buyTiming.push({
          category: cat,
          recommendation,
          reasoning,
          expectedDiscount,
        });
      }
    }
    // Fill in any seasonal categories AI didn't cover
    const seenCats = new Set(buyTiming.map(b => b.category));
    for (const seasonal of seasonalPatterns) {
      if (!seenCats.has(seasonal.category)) {
        buyTiming.push(deterministicBuyTiming(seasonal, now));
      }
    }

    advice = clampString(parsed.advice, 400, '');
    aiUsed = sellTiming.length > 0 || buyTiming.length > 0;
  }

  return { sellTiming, buyTiming, advice, aiUsed };
}

// --- Handler -------------------------------------------------------------

const seasonalTimingHandler = withAiRoute<SeasonalTimingOptimizerInput>({
  endpoint: '/api/ai/seasonal-timing-optimizer',
  maxDuration: 60,
  enforceBudget: true,
  method: 'GET',

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;
    const now = new Date();
    const currentMonthIdx = now.getMonth();

    // 1) Query SOLD trades from last 24 months grouped by month + category
    const cutoff24m = new Date(now.getTime() - 24 * 30 * 86_400_000);
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff24m },
        sellPrice: { not: null },
        buyPrice: { gt: 0 },
      },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        sellPrice: true,
        sellDate: true,
      },
      take: 5000,
    });

    // 2) Query HELD trades (current inventory that needs selling)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyDate: true,
      },
      take: 200,
    }) as unknown as HeldTradeRow[];

    // 3) Compute per-category seasonal patterns (group by category × month)
    const catMonthMap = new Map<string, Map<number, MonthlyAgg>>();
    for (const t of soldTrades) {
      const cat = (t.category || 'drugo').trim().toLowerCase() || 'drugo';
      const sellDate = t.sellDate ? new Date(t.sellDate) : null;
      if (!sellDate) continue;
      const month = sellDate.getMonth();
      if (!catMonthMap.has(cat)) catMonthMap.set(cat, new Map());
      const monthMap = catMonthMap.get(cat)!;
      const cur = monthMap.get(month) || {
        sellPriceSum: 0,
        count: 0,
        buyPriceSum: 0,
      };
      cur.sellPriceSum += t.sellPrice ?? 0;
      cur.buyPriceSum += t.buyPrice;
      cur.count += 1;
      monthMap.set(month, cur);
    }

    // Build CategorySeasonal entries
    const seasonalPatterns: CategorySeasonal[] = [];
    const seasonalMap = new Map<string, CategorySeasonal>();
    for (const [category, monthMap] of catMonthMap.entries()) {
      const monthlyAvgPrices = Array.from(monthMap.entries()).map(
        ([monthIdx, agg]) => ({
          month: MONTHS[monthIdx],
          avgPrice: agg.count > 0 ? Math.round(agg.sellPriceSum / agg.count) : 0,
          count: agg.count,
        }),
      );

      // Sort by avgPrice desc for best/worst
      const sortedByPrice = [...monthlyAvgPrices].sort(
        (a, b) => b.avgPrice - a.avgPrice,
      );
      const bestSellingMonths = sortedByPrice
        .slice(0, Math.min(3, sortedByPrice.length))
        .map(m => m.month);
      const worstSellingMonths = sortedByPrice
        .slice(-Math.min(3, sortedByPrice.length))
        .map(m => m.month)
        .reverse();

      // pricePremium: % diff between best and worst month avg price
      const best = sortedByPrice[0]?.avgPrice ?? 0;
      const worst = sortedByPrice[sortedByPrice.length - 1]?.avgPrice ?? 0;
      const pricePremium =
        worst > 0 ? Math.round(((best - worst) / worst) * 100) : 0;

      // currentMonthScore: how good is current month for this category (0-100)
      const currentMonthData = monthMap.get(currentMonthIdx);
      const maxPrice = Math.max(
        ...Array.from(monthMap.values()).map(
          a => (a.count > 0 ? a.sellPriceSum / a.count : 0),
        ),
        0,
      );
      const minPrice = Array.from(monthMap.values()).some(a => a.count > 0)
        ? Math.min(
            ...Array.from(monthMap.values())
              .filter(a => a.count > 0)
              .map(a => a.sellPriceSum / a.count),
          )
        : 0;
      let currentMonthScore = 50; // neutral default
      if (currentMonthData && currentMonthData.count > 0 && maxPrice > minPrice) {
        const currentAvg = currentMonthData.sellPriceSum / currentMonthData.count;
        currentMonthScore = Math.round(
          ((currentAvg - minPrice) / (maxPrice - minPrice)) * 100,
        );
      } else if (maxPrice === minPrice && currentMonthData && currentMonthData.count > 0) {
        currentMonthScore = 50;
      }

      // Recommendation: based on currentMonthScore
      let recommendation: CategorySeasonal['recommendation'];
      if (currentMonthScore >= 70) recommendation = 'GOOD_TIME_TO_SELL';
      else if (currentMonthScore >= 40) recommendation = 'NEUTRAL';
      else if (currentMonthScore <= 20) recommendation = 'GOOD_TIME_TO_BUY';
      else recommendation = 'WAIT';

      const entry: CategorySeasonal = {
        category,
        bestSellingMonths,
        worstSellingMonths,
        pricePremium,
        currentMonthScore,
        recommendation,
        monthlyAvgPrices,
      };
      seasonalPatterns.push(entry);
      seasonalMap.set(category, entry);
    }

    // Sort seasonal patterns by trade count desc
    seasonalPatterns.sort((a, b) => {
      const aCount = a.monthlyAvgPrices.reduce((s, m) => s + m.count, 0);
      const bCount = b.monthlyAvgPrices.reduce((s, m) => s + m.count, 0);
      return bCount - aCount;
    });

    // 4) AI cache — keyed by current month (refreshes daily/monthly)
    const cacheKey = `seasonal-timing:${currentMonthIdx}`;
    const cached = getCachedAI<{
      sellTiming: SellTiming[];
      buyTiming: BuyTiming[];
      advice: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        seasonalPatterns,
        sellTiming: cached.sellTiming,
        buyTiming: cached.buyTiming,
        summary: buildSummary(
          cached.sellTiming,
          cached.buyTiming,
          seasonalPatterns,
        ),
        cached: true,
        aiUsed: true,
      });
    }

    // 5) Build AI prompt with grounding (seasonal data + held inventory)
    const seasonalBlock = buildSeasonalBlock(seasonalPatterns, currentMonthIdx);
    const heldBlock = buildHeldBlock(heldTrades);
    const prompt = buildPrompt(now, currentMonthIdx, seasonalBlock, heldBlock);

    let aiUsed = false;
    let sellTiming: SellTiming[] = [];
    let buyTiming: BuyTiming[] = [];
    let advice = '';

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiSeasonalResponse | null;

      const merged = mergeAiIntoSeasonalTiming(
        parsed,
        heldTrades,
        seasonalMap,
        seasonalPatterns,
        now,
      );
      sellTiming = merged.sellTiming;
      buyTiming = merged.buyTiming;
      advice = merged.advice;
      aiUsed = merged.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/seasonal-timing-optimizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 6) Deterministic fallback for sellTiming
    if (sellTiming.length === 0) {
      for (const held of heldTrades) {
        const cat = (held.category || 'drugo').trim().toLowerCase();
        sellTiming.push(
          deterministicSellTiming(
            held.id,
            held.title,
            cat,
            held.buyPrice,
            seasonalMap,
            now,
          ),
        );
      }
    }
    // Deterministic fallback for buyTiming
    if (buyTiming.length === 0) {
      for (const seasonal of seasonalPatterns) {
        buyTiming.push(deterministicBuyTiming(seasonal, now));
      }
    }
    if (!advice) {
      const itemsToSellNow = sellTiming.filter(s => s.action === 'SELL_NOW').length;
      const itemsToWait = sellTiming.filter(s => s.action === 'WAIT_FOR_PEAK').length;
      advice = `${itemsToSellNow} item-ov prodaj zdaj, ${itemsToWait} čaka na vrh sezone. Trenutni mesec ${MONTHS[currentMonthIdx]} — analiziraj per kategorija za optimalni buy/sell timing.`;
    }

    const summary = buildSummary(sellTiming, buyTiming, seasonalPatterns);

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { sellTiming, buyTiming, advice });
    }

    return apiOk({
      ok: true,
      seasonalPatterns,
      sellTiming,
      buyTiming,
      summary,
      aiUsed,
    });
  },
});

export const GET = seasonalTimingHandler;
export const POST = seasonalTimingHandler;
