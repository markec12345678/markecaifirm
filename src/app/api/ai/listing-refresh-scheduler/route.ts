// v7.56 / v8.96.3-batch3: Listing Refresh Scheduler — za HELD inventar (status='held') priporoči
// KDAJ in KAKO osvežiti/ponovno objaviti vsak item na vsaki platformi za max vidnost.
//
// "PS5 na Bolhi 12 dni brez osvežitve — osveži z novim naslovom
//  'PS5 Digital 2024 + 2 controllerja'"
//
// GET+POST /api/ai/listing-refresh-scheduler
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
// (AI-enhanced z groundingom + anti-hallucination validacijo + 6h cache)

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

const DAY_MS = 86_400_000;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ListingRefreshSchedulerInput {}

interface FlipChecklistStep {
  step?: string;
  completedAt?: string;
  completed?: boolean;
}

interface HeldItemComputed {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  estValue: number;
  daysHeld: number;
  lastRefreshDay: number;
  platformsListed: string[];
  urgency: 'OVERDUE' | 'DUE_SOON' | 'OK';
}

interface ScheduleItem extends HeldItemComputed {
  nextRefreshDate: string;
  platform: string;
  action: 'REFRESH' | 'RELIST' | 'PRICE_DROP_AND_REFRESH' | 'CROSS_POST';
  newTitleSuggestion?: string;
  priceSuggestionEur?: number | null;
  reasoning: string;
}

interface AiRefreshPlan {
  tradeId?: string;
  action?: string;
  platform?: string;
  nextRefreshDate?: string;
  newTitleSuggestion?: string;
  priceSuggestionEur?: unknown;
  reasoning?: string;
}

const VALID_ACTIONS = new Set([
  'REFRESH',
  'RELIST',
  'PRICE_DROP_AND_REFRESH',
  'CROSS_POST',
]);
const KNOWN_PLATFORMS = new Set(['Bolha', 'Vinted', 'Facebook']);

// --- Pure helpers (extracted OUTSIDE handler) ----------------------------

/** Parse flipChecklist JSON and return list of platforms where item is already listed. */
function parsePlatformsListed(flipChecklist: string | null | undefined): string[] {
  if (!flipChecklist) return [];
  try {
    const arr = JSON.parse(flipChecklist) as FlipChecklistStep[];
    if (!Array.isArray(arr)) return [];
    const platforms: string[] = [];
    for (const s of arr) {
      const step = (s?.step ?? '').toLowerCase();
      // Steps: received, cleaned, photographed, described,
      //        listed_bolha, listed_vinted, listed_other,
      //        price_review_7d, price_drop_14d, price_drop_30d
      if (!step.startsWith('listed_')) continue;
      const ok = s?.completed === true || !!s?.completedAt;
      if (!ok) continue;
      if (step.includes('bolha')) platforms.push('Bolha');
      else if (step.includes('vinted')) platforms.push('Vinted');
      else if (step.includes('other')) platforms.push('Facebook');
    }
    return Array.from(new Set(platforms));
  } catch {
    return [];
  }
}

/** Deterministic fallback plan: if AI is unavailable, compute a sensible refresh plan. */
function deterministicPlan(item: HeldItemComputed): {
  nextRefreshDate: string;
  platform: string;
  action: 'REFRESH' | 'RELIST' | 'PRICE_DROP_AND_REFRESH' | 'CROSS_POST';
  newTitleSuggestion?: string;
  reasoning: string;
} {
  const platform = item.platformsListed[0] ?? 'Bolha';
  const tomorrow = new Date(Date.now() + DAY_MS);
  const inThreeDays = new Date(Date.now() + 3 * DAY_MS);

  // If listed on only 1 platform + held long → cross-post
  if (item.platformsListed.length <= 1 && item.daysHeld >= 7) {
    const secondPlatform = item.platformsListed.includes('Bolha') ? 'Vinted' : 'Bolha';
    return {
      nextRefreshDate: tomorrow.toISOString(),
      platform: secondPlatform,
      action: 'CROSS_POST',
      newTitleSuggestion: item.title.slice(0, 60),
      reasoning: `${item.daysHeld}d v zalogi in samo na ${platform} — razširi na ${secondPlatform}.`,
    };
  }

  // If 14+ days held → price drop + refresh
  if (item.daysHeld >= 14) {
    return {
      nextRefreshDate: tomorrow.toISOString(),
      platform,
      action: 'PRICE_DROP_AND_REFRESH',
      newTitleSuggestion: item.title.slice(0, 60),
      reasoning: `${item.daysHeld}d brez prodaje — znižaj ceno za 10-15% in osveži oglas.`,
    };
  }

  // If OVERDUE on refresh (>14d no refresh) → just refresh
  if (item.urgency === 'OVERDUE') {
    return {
      nextRefreshDate: tomorrow.toISOString(),
      platform,
      action: 'REFRESH',
      newTitleSuggestion: item.title.slice(0, 60),
      reasoning: `${item.lastRefreshDay}d brez osvežitve — osveži za višjo pozicijo v rezultatih.`,
    };
  }

  // DUE_SOON — schedule within 3 days
  if (item.urgency === 'DUE_SOON') {
    return {
      nextRefreshDate: inThreeDays.toISOString(),
      platform,
      action: 'REFRESH',
      newTitleSuggestion: item.title.slice(0, 60),
      reasoning: `Osvežitev zarana (${item.lastRefreshDay}d) — načrtuj za 3 dni.`,
    };
  }

  // OK — schedule for next week
  const inAWeek = new Date(Date.now() + 7 * DAY_MS);
  return {
    nextRefreshDate: inAWeek.toISOString(),
    platform,
    action: 'REFRESH',
    reasoning: `Sveže (${item.lastRefreshDay}d) — osveži čez teden dni.`,
  };
}

/** Validate AI-suggested price (if present) — clamp to [0.5×, 2×] of buyPrice. */
function clampPriceSuggestion(price: unknown, buyPrice: number): number | null {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return null;
  const min = buyPrice * 0.5;
  const max = buyPrice * 2;
  return Math.round(Math.max(min, Math.min(max, n)));
}

/** Compute per-item deterministic metrics from raw trade rows. */
function computeHeldItems(
  heldTrades: Array<{
    id: string;
    title: string;
    category: string | null;
    buyPrice: number;
    buyDate: Date;
    flipChecklist: string | null;
    listing: {
      aiEstimatedValue: number | null;
      firstSeenAt: Date | null;
      priceDroppedAt: Date | null;
      url: string | null;
    } | null;
  }>,
  now: number,
): HeldItemComputed[] {
  return heldTrades.map(t => {
    const daysHeld = Math.max(
      0,
      Math.floor((now - new Date(t.buyDate).getTime()) / DAY_MS),
    );
    // Najnovejša znana aktivnost = cena je padla (priceDroppedAt) ali prvi ogled (firstSeenAt).
    // Če listing manjka, uporabimo buyDate kot "zadnjo osvežitev".
    const lastSeenAt =
      t.listing?.priceDroppedAt ?? t.listing?.firstSeenAt ?? t.buyDate;
    const lastRefreshDay = Math.max(
      0,
      Math.floor((now - new Date(lastSeenAt).getTime()) / DAY_MS),
    );
    const platformsListed = parsePlatformsListed(t.flipChecklist);
    const estValue =
      t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.2);
    const urgency: 'OVERDUE' | 'DUE_SOON' | 'OK' =
      lastRefreshDay > 14 ? 'OVERDUE' : lastRefreshDay >= 7 ? 'DUE_SOON' : 'OK';
    return {
      tradeId: t.id,
      title: t.title,
      category: t.category || 'drugo',
      buyPrice: Math.round(t.buyPrice),
      estValue,
      daysHeld,
      lastRefreshDay,
      platformsListed,
      urgency,
    };
  });
}

/** Merge deterministic fallback with AI-suggested plans (with anti-hallucination validation). */
function mergeSchedule(
  items: HeldItemComputed[],
  plansByTradeId: Map<string, AiRefreshPlan>,
  now: number,
): ScheduleItem[] {
  return items.map(item => {
    const ai = plansByTradeId.get(item.tradeId);
    const fallback = deterministicPlan(item);

    let action: 'REFRESH' | 'RELIST' | 'PRICE_DROP_AND_REFRESH' | 'CROSS_POST' = fallback.action;
    if (ai?.action && VALID_ACTIONS.has(String(ai.action).toUpperCase())) {
      action = String(ai.action).toUpperCase() as typeof action;
    }

    let platform = fallback.platform;
    if (ai?.platform && KNOWN_PLATFORMS.has(String(ai.platform))) {
      platform = String(ai.platform);
    }

    // Validate nextRefreshDate
    let nextRefreshDate = fallback.nextRefreshDate;
    if (ai?.nextRefreshDate) {
      const d = new Date(ai.nextRefreshDate);
      if (!isNaN(d.getTime()) && d.getTime() >= now - DAY_MS) {
        // Allow today or future (small backwards tolerance)
        nextRefreshDate = d.toISOString();
      }
    }

    // Title suggestion — cap at 70 chars
    let newTitleSuggestion = fallback.newTitleSuggestion;
    if (ai?.newTitleSuggestion != null && typeof ai.newTitleSuggestion === 'string') {
      const trimmed = ai.newTitleSuggestion.trim();
      if (trimmed.length > 0) {
        newTitleSuggestion = trimmed.slice(0, 70);
      }
    }

    // Price suggestion — clamp to [0.5×, 2×] buyPrice
    const clampedPrice = ai?.priceSuggestionEur != null
      ? clampPriceSuggestion(ai.priceSuggestionEur, item.buyPrice)
      : null;

    const reasoning = (ai?.reasoning && typeof ai.reasoning === 'string' && ai.reasoning.trim().length > 0)
      ? ai.reasoning.trim().slice(0, 240)
      : fallback.reasoning;

    return {
      tradeId: item.tradeId,
      title: item.title,
      category: item.category,
      buyPrice: item.buyPrice,
      estValue: item.estValue,
      daysHeld: item.daysHeld,
      lastRefreshDay: item.lastRefreshDay,
      platformsListed: item.platformsListed,
      urgency: item.urgency,
      nextRefreshDate,
      platform,
      action,
      newTitleSuggestion,
      priceSuggestionEur: clampedPrice,
      reasoning,
    };
  });
}

/** Build items block for the AI prompt. */
function buildItemsBlock(items: HeldItemComputed[]): string {
  return items
    .map((i, idx) => {
      return `#${idx + 1}
- tradeId: ${i.tradeId}
- naslov: ${i.title}
- kategorija: ${i.category}
- nabavna cena: ${i.buyPrice}€
- est. vrednost: ${i.estValue}€
- dni v zalogi: ${i.daysHeld}
- dni od zadnje osvežitve: ${i.lastRefreshDay}
- objavljeno na: ${i.platformsListed.length > 0 ? i.platformsListed.join(', ') : 'nobena'}
- urgency: ${i.urgency}`;
    })
    .join('\n\n');
}

/** Build the AI prompt with grounding suffix. */
function buildPrompt(itemsBlock: string): string {
  return `Si ekspert za optimizacijo oglasov na slovenskih platformah (Bolha, Vinted, Facebook Marketplace).

ZA vsak HELD item spodaj določi:
1. nextRefreshDate (ISO datum — kdaj osvežiti)
2. platform (Bolha | Vinted | Facebook)
3. action (REFRESH | RELIST | PRICE_DROP_AND_REFRESH | CROSS_POST)
4. newTitleSuggestion (kratek SEO-optimiziran naslov, max 70 znakov — ali null)
5. priceSuggestionEur (če je action=PRICE_DROP_AND_REFRESH, predlagaj novo ceno v EUR znotraj [50%, 200%] nabavne cene; sicer null)
6. reasoning (1 stavek — zakaj ta akcija)

PRAVILA ZA AKCIJO:
- REFRESH: item je bil naveden nedavno, samo potisni gor v rezultatih (nova objava z enakim naslovom)
- RELIST: item ni bil osvežen >14 dni, briši in ponovno objavi z novim naslovom (boljši SEO)
- PRICE_DROP_AND_REFRESH: če je item 14+ dni v zalogi, znižaj ceno za 10-15% in osveži
- CROSS_POST: če je objavljen samo na 1 platformi in je 7+ dni v zalogi, razširi na drugo platformo

URGENCY:
- OVERDUE (>14d od osvežitve) → osveži DANES
- DUE_SOON (7-14d) → osveži v 3 dneh
- OK (<7d) → osveži čez 7 dni

ITEMS:
${itemsBlock}

Odgovori LE z JSON:
{
  "plans": [
    {
      "tradeId": "<id>",
      "nextRefreshDate": "<ISO>",
      "platform": "Bolha|Vinted|Facebook",
      "action": "REFRESH|RELIST|PRICE_DROP_AND_REFRESH|CROSS_POST",
      "newTitleSuggestion": "<string ali null>",
      "priceSuggestionEur": "<number ali null>",
      "reasoning": "<1 stavek>"
    }
  ]
}${GROUNDING_PROMPT_SUFFIX}`;
}

/** Parse AI plans response into a Map keyed by tradeId. */
function parseAiPlans(parsed: unknown): Map<string, AiRefreshPlan> {
  const out = new Map<string, AiRefreshPlan>();
  const obj = parsed as { plans?: AiRefreshPlan[] } | null;
  if (obj?.plans && Array.isArray(obj.plans)) {
    for (const p of obj.plans) {
      if (p?.tradeId) out.set(String(p.tradeId), p);
    }
  }
  return out;
}

/** Sort schedule by urgency (OVERDUE → DUE_SOON → OK). */
function sortSchedule(schedule: ScheduleItem[]): ScheduleItem[] {
  const urgencyRank = { OVERDUE: 0, DUE_SOON: 1, OK: 2 } as const;
  return schedule.sort(
    (a, b) =>
      urgencyRank[a.urgency] - urgencyRank[b.urgency] ||
      b.lastRefreshDay - a.lastRefreshDay,
  );
}

/** Compute summary from the sorted schedule. */
function computeSummary(schedule: ScheduleItem[]): {
  total: number;
  overdue: number;
  dueSoon: number;
  estimatedRevenueBoost: number;
} {
  const overdue = schedule.filter(s => s.urgency === 'OVERDUE').length;
  const dueSoon = schedule.filter(s => s.urgency === 'DUE_SOON').length;
  // Rough revenue boost estimate: refreshed items sell ~10% faster, so we save 10% of carrying cost
  // + price drop items contribute the price drop delta. Conservative estimate.
  const carryingCostPerDay = 0.5;
  const estimatedRevenueBoost = Math.round(
    schedule.reduce((s, i) => {
      if (i.urgency === 'OVERDUE') return s + carryingCostPerDay * 7;
      if (i.urgency === 'DUE_SOON') return s + carryingCostPerDay * 3;
      return s;
    }, 0),
  );
  return {
    total: schedule.length,
    overdue,
    dueSoon,
    estimatedRevenueBoost,
  };
}

// --- Handler -------------------------------------------------------------

const listingRefreshSchedulerHandler = withAiRoute<ListingRefreshSchedulerInput>({
  endpoint: '/api/ai/listing-refresh-scheduler',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => {
    // v7.56: POST handler — AI Hub runner always sends POST with JSON body.
    // Body is ignored (this endpoint takes no input) — logic is identical to GET.
    await req.json().catch(() => ({}));
    return {};
  },

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    const now = Date.now();

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyDate: true,
        flipChecklist: true,
        listing: {
          select: {
            id: true,
            aiEstimatedValue: true,
            // v7.56: schema nima lastSeenAt — uporabimo priceDroppedAt (recent activity)
            // ali firstSeenAt kot proxy za "zadnjo osvežitev oglasa".
            firstSeenAt: true,
            priceDroppedAt: true,
            url: true,
          },
        },
      },
      orderBy: { buyDate: 'asc' },
      take: 200,
    });

    if (heldTrades.length === 0) {
      return apiOk({
        ok: true,
        schedule: [],
        summary: { total: 0, overdue: 0, dueSoon: 0, estimatedRevenueBoost: 0 },
        message: 'Ni held inventarja — nič za osvežiti.',
      });
    }

    // 1) Compute deterministic per-item metrics
    const items = computeHeldItems(heldTrades, now);

    // 2) Check AI cache
    const heldItemIds = items.map(i => i.tradeId).join(',');
    const cacheKey = `listing-refresh-scheduler:${heldItemIds}`;
    const cached = getCachedAI<{
      schedule: ScheduleItem[];
      summary: { total: number; overdue: number; dueSoon: number; estimatedRevenueBoost: number };
    }>(cacheKey);

    if (cached) {
      return apiOk({ ok: true, ...cached, cached: true });
    }

    // 3) Build AI prompt with grounding
    const itemsBlock = buildItemsBlock(items);
    const prompt = buildPrompt(itemsBlock);

    // 4) Call AI (with try/catch — fallback to deterministic plans)
    const plansByTradeId = new Map<string, AiRefreshPlan>();
    let aiUsed = false;
    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw);
      const plans = parseAiPlans(parsed);
      for (const [tid, p] of plans) plansByTradeId.set(tid, p);
      aiUsed = plansByTradeId.size > 0;
    } catch (err) {
      logger.warn(
        '/api/ai/listing-refresh-scheduler',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Merge computed + AI plans (with anti-hallucination validation)
    const schedule = sortSchedule(mergeSchedule(items, plansByTradeId, now));
    const summary = computeSummary(schedule);

    const response = { ok: true, schedule, summary, aiUsed };

    // 6) Cache the response (6h TTL)
    setCachedAI(cacheKey, { schedule, summary });

    return apiOk(response);
  },
});

export const GET = listingRefreshSchedulerHandler;
export const POST = listingRefreshSchedulerHandler;
