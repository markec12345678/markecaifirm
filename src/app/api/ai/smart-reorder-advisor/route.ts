// v7.74 / v8.96.4-batch2: AI Smart Reorder Advisor — AI svetuje KDAJ in
// KOLIKO naročiti za vsako kategorijo na podlagi sell-through rate,
// trenutne zaloge in demand forecast. "Elektronika: 5 prodaj/mesec, 2 na
// zalogi → REORDER_NOW, 3 item-i, 900€ budget."
//
// Razlika od inventory-reorder-point (ki izračuna matematični reorder point)
// — ta AI svetuje STRATEGIJO naročanja (timing, količina, budget, strategija).
// Razlika od smart-restock (ki priporoča kaj restockati) — ta gleda celotno
// kategorijo in allocate budget čez kategorije. Razlika od restock (ki
// restock-a posamezne item-e) — ta gleda kategorijo-level reorder plan.
// Razlika od inventory-cash-flow-optimizer (ki optimizira cash flow) — ta
// gleda KDAJ/ZAKAJ reorder. Razlika od cash-flow-forecast (ki napove cash flow)
// — ta priporoča akcijo (reorder).
//
// Refaktoriran z withAiRoute helperjem (v8.96.4) + enforceBudget guard.
//
// GET+POST /api/ai/smart-reorder-advisor
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type ReorderStatus =
  | 'REORDER_NOW'
  | 'REORDER_SOON'
  | 'ADEQUATE_STOCK'
  | 'OVERSTOCKED';

type ReorderStrategy =
  | 'SINGLE_BUY'
  | 'BATCH_BUY'
  | 'WAIT_FOR_DEALS';

interface CategoryReorder {
  category: string;
  avgMonthlySales: number;
  currentStock: number;
  weeksOfSupply: number;
  reorderPoint: number;
  optimalReorderQuantity: number;
  reorderStatus: ReorderStatus;
  recommendedQuantity: number;
  recommendedTiming: number; // days until reorder
  expectedStockoutDate: string | null;
  reorderStrategy: ReorderStrategy;
  budgetAllocation: number;
  reasoning: string;
}

interface Summary {
  totalCategories: number;
  reorderNowCount: number;
  adequateStockCount: number;
  overstockedCount: number;
  totalBudgetNeeded: number;
  advice: string;
}

interface AiReorderResponse {
  categories?: unknown;
  summary?: unknown;
}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;

function clampNumber(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw == null) return Math.max(min, Math.min(max, fallback));
  const v = Number(raw);
  if (!Number.isFinite(v)) return Math.max(min, Math.min(max, fallback));
  return Math.max(min, Math.min(max, v));
}

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

const VALID_REORDER_STATUS: readonly ReorderStatus[] = [
  'REORDER_NOW',
  'REORDER_SOON',
  'ADEQUATE_STOCK',
  'OVERSTOCKED',
];

const VALID_REORDER_STRATEGY: readonly ReorderStrategy[] = [
  'SINGLE_BUY',
  'BATCH_BUY',
  'WAIT_FOR_DEALS',
];

function clampEnum<T extends string>(
  raw: unknown,
  valid: readonly T[],
  fallback: T,
): T {
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '_');
  for (const v of valid) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
}

// Compute deterministic reorder status from weeks of supply
function deterministicReorderStatus(weeksOfSupply: number): ReorderStatus {
  if (weeksOfSupply < 1) return 'REORDER_NOW';
  if (weeksOfSupply < 2) return 'REORDER_SOON';
  if (weeksOfSupply <= 8) return 'ADEQUATE_STOCK';
  return 'OVERSTOCKED';
}

// Compute deterministic reorder strategy from status + sales volume
function deterministicStrategy(
  status: ReorderStatus,
  avgMonthlySales: number,
): ReorderStrategy {
  if (status === 'OVERSTOCKED') return 'WAIT_FOR_DEALS';
  if (avgMonthlySales >= 10) return 'BATCH_BUY'; // High-volume → batch for efficiency
  if (status === 'REORDER_NOW' || status === 'REORDER_SOON') return 'SINGLE_BUY';
  return 'SINGLE_BUY';
}

// Compute deterministic recommended quantity
function deterministicRecommendedQuantity(
  status: ReorderStatus,
  avgMonthlySales: number,
  currentStock: number,
): number {
  if (status === 'OVERSTOCKED') return 0;
  if (status === 'ADEQUATE_STOCK') return 0;
  // REORDER_NOW or REORDER_SOON
  // Optimal quantity = 1 month supply, minus what's already in stock
  const target = Math.max(1, Math.round(avgMonthlySales));
  const needed = Math.max(0, target - currentStock);
  return Math.max(1, needed);
}

// Compute deterministic budget allocation
function deterministicBudget(
  recommendedQuantity: number,
  avgBuyPrice: number,
): number {
  return Math.round(recommendedQuantity * avgBuyPrice);
}

// Build deterministic reasoning text in Slovenian
function buildReasoning(
  category: string,
  status: ReorderStatus,
  avgMonthlySales: number,
  currentStock: number,
  weeksOfSupply: number,
  recommendedQuantity: number,
  recommendedTiming: number,
  strategy: ReorderStrategy,
): string {
  const timingTxt =
    recommendedTiming <= 0
      ? 'takoj'
      : recommendedTiming <= 7
        ? `v ${recommendedTiming} dneh`
        : `čez ${Math.round(recommendedTiming / 7)} tednov`;
  switch (status) {
    case 'REORDER_NOW':
      return `Kategorija "${category}": ${avgMonthlySales.toFixed(1)} prodaj/mesec, ${currentStock} na zalogi (${weeksOfSupply.toFixed(1)} tednov zaloge). Naroči ${recommendedQuantity} item-e ${timingTxt} (${strategy}).`;
    case 'REORDER_SOON':
      return `Kategorija "${category}": ${avgMonthlySales.toFixed(1)} prodaj/mesec, ${currentStock} na zalogi (${weeksOfSupply.toFixed(1)} tednov). Načrtuj naročilo ${recommendedQuantity} item-ov ${timingTxt}.`;
    case 'ADEQUATE_STOCK':
      return `Kategorija "${category}": zaloga ustrezna (${currentStock} item-ov, ${weeksOfSupply.toFixed(1)} tednov). Ni treba naročiti — počakaj na zmanjšanje zaloge.`;
    case 'OVERSTOCKED':
      return `Kategorija "${category}": prekomerna zaloga (${currentStock} item-ov, ${weeksOfSupply.toFixed(1)} tednov). Počakaj na ugodne pogoje (WAIT_FOR_DEALS) pred novo nabavo.`;
  }
}

// --- Handler -------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface SmartReorderAdvisorInput {}

const smartReorderAdvisorHandler = withAiRoute<SmartReorderAdvisorInput>({
  endpoint: '/api/ai/smart-reorder-advisor',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async () => ({}),

  // No validateInput — endpoint ne sprejema inputa

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    // 1) Query SOLD trades from last 90 days grouped by category
    const soldCutoff = new Date(Date.now() - 90 * DAY_MS);
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: soldCutoff },
        buyPrice: { gt: 0 },
        sellPrice: { not: null },
      },
      select: {
        id: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        buyDate: true,
        sellDate: true,
      },
      take: 20000,
    });

    // 2) Query current HELD trades for stock per category
    const heldTrades = await db.trade.findMany({
      where: {
        status: 'held',
        buyPrice: { gt: 0 },
      },
      select: {
        id: true,
        category: true,
        buyPrice: true,
        buyDate: true,
      },
      take: 5000,
    });

    // Empty state — no data at all
    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return apiOk({
        ok: true,
        categories: [],
        summary: {
          totalCategories: 0,
          reorderNowCount: 0,
          adequateStockCount: 0,
          overstockedCount: 0,
          totalBudgetNeeded: 0,
          advice:
            'Ni podatkov o prodajah ali zalogi — dodaj trade-e (status "sold" ali "held") za AI reorder nasvet.',
        },
        aiUsed: false,
        message: 'Ni SOLD ali HELD trade-ov — Smart Reorder Advisor ni mogoč.',
      });
    }

    // 3) Aggregate sold trades by category
    interface SoldAgg {
      count: number;
      totalBuyPrice: number;
      totalSellPrice: number;
      cycleDays: number;
    }
    const soldAggByCat = new Map<string, SoldAgg>();
    for (const t of soldTrades) {
      const cat = (t.category || '').trim().toLowerCase() || 'neznan';
      const sellMs = t.sellDate
        ? new Date(t.sellDate as unknown as Date | string).getTime()
        : 0;
      const buyMs = new Date(t.buyDate as unknown as Date | string).getTime();
      const cycleDays = sellMs > 0 && buyMs > 0 ? Math.max(0, (sellMs - buyMs) / DAY_MS) : 0;
      const existing = soldAggByCat.get(cat) || {
        count: 0,
        totalBuyPrice: 0,
        totalSellPrice: 0,
        cycleDays: 0,
      };
      existing.count += 1;
      existing.totalBuyPrice += t.buyPrice;
      existing.totalSellPrice += t.sellPrice ?? 0;
      existing.cycleDays += cycleDays;
      soldAggByCat.set(cat, existing);
    }

    // 4) Aggregate HELD trades by category (current stock)
    const heldByCat = new Map<string, { count: number; totalBuyPrice: number }>();
    for (const t of heldTrades) {
      const cat = (t.category || '').trim().toLowerCase() || 'neznan';
      const existing = heldByCat.get(cat) || { count: 0, totalBuyPrice: 0 };
      existing.count += 1;
      existing.totalBuyPrice += t.buyPrice;
      heldByCat.set(cat, existing);
    }

    // 5) For each category compute reorder plan
    const now = Date.now();
    const baselineCategories: CategoryReorder[] = [];

    // Union of all categories (sold + held)
    const allCats = new Set<string>([
      ...soldAggByCat.keys(),
      ...heldByCat.keys(),
    ]);

    for (const cat of allCats) {
      const soldAgg = soldAggByCat.get(cat);
      const heldAgg = heldByCat.get(cat);

      const soldCount = soldAgg?.count ?? 0;
      const currentStock = heldAgg?.count ?? 0;

      // avgMonthlySales = sold / 3 (90 days = 3 months)
      const avgMonthlySales = soldCount / 3;
      const avgBuyPrice = soldAgg
        ? soldAgg.totalBuyPrice / soldAgg.count
        : heldAgg
          ? heldAgg.totalBuyPrice / heldAgg.count
          : 0;

      // weeksOfSupply = currentStock / (avgMonthlySales / 4)
      // (if avgMonthlySales = 0, weeksOfSupply = Infinity if stock > 0)
      let weeksOfSupply: number;
      if (avgMonthlySales > 0) {
        weeksOfSupply = currentStock / (avgMonthlySales / 4);
      } else {
        weeksOfSupply = currentStock > 0 ? 99 : 0;
      }

      // reorderPoint = when stock drops below 1 week of supply
      const reorderPoint = Math.max(1, Math.ceil(avgMonthlySales / 4));

      // optimalReorderQuantity = 1 month supply
      const optimalReorderQuantity = Math.max(1, Math.round(avgMonthlySales));

      // Status
      const reorderStatus = deterministicReorderStatus(weeksOfSupply);

      // Recommended quantity (deterministic baseline)
      const recommendedQuantity = deterministicRecommendedQuantity(
        reorderStatus,
        avgMonthlySales,
        currentStock,
      );

      // Recommended timing (days until reorder)
      let recommendedTiming: number;
      if (reorderStatus === 'REORDER_NOW') {
        recommendedTiming = 0;
      } else if (reorderStatus === 'REORDER_SOON') {
        // Days until stockout - 7 days buffer
        const daysUntilStockout =
          avgMonthlySales > 0
            ? (currentStock / avgMonthlySales) * 30
            : 30;
        recommendedTiming = Math.max(1, Math.min(14, Math.round(daysUntilStockout - 7)));
      } else if (reorderStatus === 'OVERSTOCKED') {
        // No reorder — long timing
        recommendedTiming = Math.round(weeksOfSupply * 7);
      } else {
        // ADEQUATE_STOCK — reorder in ~3 weeks
        recommendedTiming = Math.round(weeksOfSupply * 7 * 0.6);
      }

      // Expected stockout date (only if sales > 0 and stock > 0)
      let expectedStockoutDate: string | null = null;
      if (avgMonthlySales > 0 && currentStock > 0) {
        const daysUntilStockout = (currentStock / avgMonthlySales) * 30;
        if (daysUntilStockout <= 365) {
          expectedStockoutDate = new Date(now + daysUntilStockout * DAY_MS)
            .toISOString()
            .slice(0, 10);
        }
      }

      // Strategy
      const reorderStrategy = deterministicStrategy(reorderStatus, avgMonthlySales);

      // Budget allocation (deterministic)
      const budgetAllocation = deterministicBudget(recommendedQuantity, avgBuyPrice);

      // Reasoning
      const reasoning = buildReasoning(
        cat,
        reorderStatus,
        avgMonthlySales,
        currentStock,
        weeksOfSupply,
        recommendedQuantity,
        recommendedTiming,
        reorderStrategy,
      );

      baselineCategories.push({
        category: cat,
        avgMonthlySales: Math.round(avgMonthlySales * 10) / 10,
        currentStock,
        weeksOfSupply: Math.round(weeksOfSupply * 10) / 10,
        reorderPoint,
        optimalReorderQuantity,
        reorderStatus,
        recommendedQuantity,
        recommendedTiming,
        expectedStockoutDate,
        reorderStrategy,
        budgetAllocation,
        reasoning,
      });
    }

    // Sort by urgency: REORDER_NOW first, then REORDER_SOON, then ADEQUATE, then OVERSTOCKED
    const statusOrder: Record<ReorderStatus, number> = {
      REORDER_NOW: 0,
      REORDER_SOON: 1,
      ADEQUATE_STOCK: 2,
      OVERSTOCKED: 3,
    };
    baselineCategories.sort((a, b) => {
      const so = statusOrder[a.reorderStatus] - statusOrder[b.reorderStatus];
      if (so !== 0) return so;
      return b.avgMonthlySales - a.avgMonthlySales;
    });

    // 6) Compute available capital (estimate from recent buy spending)
    // Available capital estimate = total spent in last 30 days × 2 (rough assumption)
    // OR if no recent buys, total buyPrice of HELD × 0.3 (30% cash reserve rule)
    const recentBuysCutoff = new Date(Date.now() - 30 * DAY_MS);
    const recentBuys = await db.trade.findMany({
      where: {
        buyDate: { gte: recentBuysCutoff },
        buyPrice: { gt: 0 },
      },
      select: { buyPrice: true, buyFees: true },
      take: 5000,
    });
    const recentSpend = recentBuys.reduce(
      (s, t) => s + t.buyPrice + (t.buyFees ?? 0),
      0,
    );
    const heldCapital = heldTrades.reduce((s, t) => s + t.buyPrice, 0);
    const availableCapital = Math.max(
      recentSpend * 2,
      heldCapital * 0.3,
      1000, // minimum 1000€ assumption if no data
    );

    // 7) Compute summary
    const totalCategories = baselineCategories.length;
    const reorderNowCount = baselineCategories.filter(
      (c) => c.reorderStatus === 'REORDER_NOW',
    ).length;
    const adequateStockCount = baselineCategories.filter(
      (c) => c.reorderStatus === 'ADEQUATE_STOCK',
    ).length;
    const overstockedCount = baselineCategories.filter(
      (c) => c.reorderStatus === 'OVERSTOCKED',
    ).length;
    const totalBudgetNeeded = baselineCategories.reduce(
      (s, c) => s + c.budgetAllocation,
      0,
    );

    let advice: string;
    if (reorderNowCount > 0) {
      advice = `${reorderNowCount} kategorij${reorderNowCount > 1 ? 'e' : 'a'} zahteva takojšnje naročilo (REORDER_NOW). Skupni budget: ${totalBudgetNeeded}€. `;
      if (overstockedCount > 0) {
        advice += `${overstockedCount} kategorij${overstockedCount > 1 ? 'e' : 'a'} je prekomero založenih — preusmeri budget iz teh v REORDER_NOW kategorije.`;
      } else {
        advice += `Razporedi budget po prioriteti (REORDER_NOW > REORDER_SOON > ADEQUATE).`;
      }
    } else if (overstockedCount > 0) {
      advice = `Ni nujnih naročil, vendar ${overstockedCount} kategorij${overstockedCount > 1 ? 'e' : 'a'} je prekomero založenih. Počakaj na zmanjšanje zaloge pred novo nabavo (WAIT_FOR_DEALS).`;
    } else {
      advice = `Zaloga je ustrezna v vseh kategorijah. Načrtuj preventivno nabavo za naslednji mesec (BATCH_BUY za visoko-prodajne kategorije).`;
    }

    const baselineSummary: Summary = {
      totalCategories,
      reorderNowCount,
      adequateStockCount,
      overstockedCount,
      totalBudgetNeeded,
      advice,
    };

    // 8) AI cache check (6h TTL) — key by ISO week (so sales data is stable within a week)
    const tmpDate = new Date(now);
    tmpDate.setHours(0, 0, 0, 0);
    const dayOfWeek = (tmpDate.getDay() + 6) % 7; // Mon=0
    const weekThursday = new Date(tmpDate);
    weekThursday.setDate(tmpDate.getDate() - dayOfWeek + 3);
    const yearStart = new Date(weekThursday.getFullYear(), 0, 4);
    const weekNum = Math.ceil(
      ((weekThursday.getTime() - yearStart.getTime()) / DAY_MS +
        yearStart.getDay() +
        1) /
        7,
    );
    const isoWeek = `${weekThursday.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
    const cacheKey = `smart-reorder-advisor:${isoWeek}`;

    const cached = getCachedAI<{
      categories: CategoryReorder[];
      summary: Summary;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        categories: cached.categories,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 9) AI prompt with grounding
    const catsForPrompt = baselineCategories.slice(0, 30).map((c) => ({
      category: c.category,
      avgMonthlySales: c.avgMonthlySales,
      currentStock: c.currentStock,
      weeksOfSupply: c.weeksOfSupply,
      reorderPoint: c.reorderPoint,
      optimalReorderQuantity: c.optimalReorderQuantity,
      deterministicStatus: c.reorderStatus,
      deterministicStrategy: c.reorderStrategy,
      deterministicRecommendedQuantity: c.recommendedQuantity,
      deterministicTiming: c.recommendedTiming,
      deterministicBudget: c.budgetAllocation,
    }));

    const prompt = buildPrompt({
      catsForPrompt,
      availableCapital: Math.round(availableCapital),
    });

    let finalCategories = baselineCategories;
    let summary = baselineSummary;
    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiReorderResponse | null;

      if (parsed && typeof parsed === 'object') {
        const transformed = transformReorder(
          parsed,
          baselineCategories,
          baselineSummary,
          availableCapital,
          statusOrder,
        );
        if (transformed.finalCategories !== baselineCategories) {
          finalCategories = transformed.finalCategories;
        }
        summary = transformed.summary;
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/smart-reorder-advisor',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 10) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        categories: finalCategories,
        summary,
      });
    }

    return apiOk({
      ok: true,
      categories: finalCategories,
      summary,
      aiUsed,
    });
  },
});

// AI Hub runner compatibility — body is ignored, identical logic.
export const GET = smartReorderAdvisorHandler;
export const POST = smartReorderAdvisorHandler;

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface PromptParams {
  catsForPrompt: Array<{
    category: string;
    avgMonthlySales: number;
    currentStock: number;
    weeksOfSupply: number;
    reorderPoint: number;
    optimalReorderQuantity: number;
    deterministicStatus: ReorderStatus;
    deterministicStrategy: ReorderStrategy;
    deterministicRecommendedQuantity: number;
    deterministicTiming: number;
    deterministicBudget: number;
  }>;
  availableCapital: number;
}

function buildPrompt(p: PromptParams): string {
  return `Si AI "Smart Reorder Advisor" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Svetuj KDAJ in KOLIKO naročiti (reorder) za vsako kategorijo na podlagi sell-through rate in trenutne zaloge.

KATEGORIJE S PODATKI (deterministično izračunano):
${JSON.stringify(p.catsForPrompt, null, 2)}

POZNEJNI KONTEKST:
- Sold trades zadnjih 90 dni (3 mesece) = avgMonthlySales × 3
- Trenutna zaloga (HELD trades) = currentStock
- weeksOfSupply = currentStock / (avgMonthlySales / 4)
- availableCapital (ocenjen) = ${p.availableCapital}€

PRAVILA ZA AI ODGOVOR:
1. categories: array (sprejmi obstoječe category-je, posodobi reorderStatus, recommendedQuantity, recommendedTiming, expectedStockoutDate, reorderStrategy, budgetAllocation, reasoning)
   - reorderStatus: REORDER_NOW / REORDER_SOON / ADEQUATE_STOCK / OVERSTOCKED
   - recommendedQuantity: 1 do (avgMonthlySales × 2), celo število (anti-hallucination clamp)
   - recommendedTiming: 0-90 dni (kdaj naročiti)
   - expectedStockoutDate: "YYYY-MM-DD" ali null (če OVERSTOCKED ali ADEQUATE)
   - reorderStrategy: SINGLE_BUY / BATCH_BUY / WAIT_FOR_DEALS
   - budgetAllocation: 0 do ${p.availableCapital}€ (anti-hallucination clamp)
   - reasoning: kratek slovenski opis (max 300 znakov)
2. summary: totalCategories, reorderNowCount, adequateStockCount, overstockedCount, totalBudgetNeeded, advice v slovenščini

VRNI LE JSON:
{
  "categories": [
    { "category": "...", "reorderStatus": "REORDER_NOW", "recommendedQuantity": 0, "recommendedTiming": 0, "expectedStockoutDate": "YYYY-MM-DD", "reorderStrategy": "SINGLE_BUY", "budgetAllocation": 0, "reasoning": "..." }
  ],
  "summary": { "totalCategories": 0, "reorderNowCount": 0, "adequateStockCount": 0, "overstockedCount": 0, "totalBudgetNeeded": 0, "advice": "..." }
}${GROUNDING_PROMPT_SUFFIX}`;
}

function transformReorder(
  parsed: AiReorderResponse,
  baselineCategories: CategoryReorder[],
  baselineSummary: Summary,
  availableCapital: number,
  statusOrder: Record<ReorderStatus, number>,
): {
  finalCategories: CategoryReorder[];
  summary: Summary;
} {
  let finalCategories = baselineCategories;
  let summary = baselineSummary;

  // Parse categories — apply anti-hallucination clamps
  if (Array.isArray(parsed.categories)) {
    const updated: CategoryReorder[] = [];
    for (const c of parsed.categories) {
      const r = c as Record<string, unknown>;
      if (!r || typeof r !== 'object') continue;
      const category = String(r.category || '').trim().toLowerCase();
      const existing = baselineCategories.find((bc) => bc.category === category);
      if (!existing) continue;

      const reorderStatus = clampEnum(
        r.reorderStatus,
        VALID_REORDER_STATUS,
        existing.reorderStatus,
      );

      // recommendedQuantity clamped to [1, avgMonthlySales × 2] for active reorder, [0, 0] for OVERSTOCKED/ADEQUATE
      const qtyMin = reorderStatus === 'OVERSTOCKED' || reorderStatus === 'ADEQUATE_STOCK' ? 0 : 1;
      const qtyMax = Math.max(1, Math.round(existing.avgMonthlySales * 2));
      const recommendedQuantity = clampNumber(
        r.recommendedQuantity,
        qtyMin,
        qtyMax,
        existing.recommendedQuantity,
      );

      const recommendedTiming = clampNumber(
        r.recommendedTiming,
        0,
        90,
        existing.recommendedTiming,
      );

      // expectedStockoutDate
      let expectedStockoutDate: string | null = null;
      if (
        reorderStatus === 'REORDER_NOW' ||
        reorderStatus === 'REORDER_SOON'
      ) {
        if (
          typeof r.expectedStockoutDate === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(r.expectedStockoutDate.slice(0, 10))
        ) {
          expectedStockoutDate = r.expectedStockoutDate.slice(0, 10);
        } else {
          expectedStockoutDate = existing.expectedStockoutDate;
        }
      }

      const reorderStrategy = clampEnum(
        r.reorderStrategy,
        VALID_REORDER_STRATEGY,
        existing.reorderStrategy,
      );

      // budgetAllocation clamped to [0, availableCapital]
      const budgetAllocation = clampNumber(
        r.budgetAllocation,
        0,
        availableCapital,
        existing.budgetAllocation,
      );

      const reasoning = clampString(r.reasoning, 300, existing.reasoning);

      updated.push({
        ...existing,
        reorderStatus,
        recommendedQuantity: Math.round(recommendedQuantity),
        recommendedTiming: Math.round(recommendedTiming),
        expectedStockoutDate,
        reorderStrategy,
        budgetAllocation: Math.round(budgetAllocation),
        reasoning,
      });
    }
    if (updated.length > 0) {
      // Re-sort by urgency
      updated.sort((a, b) => {
        const so = statusOrder[a.reorderStatus] - statusOrder[b.reorderStatus];
        if (so !== 0) return so;
        return b.avgMonthlySales - a.avgMonthlySales;
      });
      finalCategories = updated;
    }
  }

  // Parse summary
  if (parsed.summary && typeof parsed.summary === 'object') {
    const s = parsed.summary as Record<string, unknown>;
    const totalBudgetNeededClamped = clampNumber(
      s.totalBudgetNeeded,
      0,
      availableCapital * 5, // sane upper bound (5 categories × availableCapital)
      finalCategories.reduce((sum, c) => sum + c.budgetAllocation, 0),
    );
    summary = {
      totalCategories: finalCategories.length,
      reorderNowCount: finalCategories.filter((c) => c.reorderStatus === 'REORDER_NOW').length,
      adequateStockCount: finalCategories.filter((c) => c.reorderStatus === 'ADEQUATE_STOCK').length,
      overstockedCount: finalCategories.filter((c) => c.reorderStatus === 'OVERSTOCKED').length,
      totalBudgetNeeded: Math.round(totalBudgetNeededClamped),
      advice: clampString(s.advice, 800, baselineSummary.advice),
    };
  }

  return { finalCategories, summary };
}
