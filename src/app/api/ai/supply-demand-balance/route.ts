// v7.68: AI Supply Demand Balance Analyzer — AI analizira razmerje med
// ponudbo (supply = aktivni oglasi) in povpraševanjem (demand = bookmarked /
// contacted / prodani) per kategorija. Identificira SELLER_MARKET (demand >
// 70% supply) vs BUYER_MARKET (<40%).
//
// "Elektronika: SELLER_MARKET (75% sell-through, demand 90/100). Avto:
//  BUYER_MARKET (25%). Prodi elektroniko zdaj."
//
// Razlika od market-saturation (ki gleda volumen oglasov per kategorija
// brez demand podatkov) — ta gleda RAZMERJE med supply in demand
// (sell-through rate, demandStrength, supplyPressure, priceOutlook,
// recommendedAction SELL_AGGRESSIVELY/HOLD/BUY_AGGRESSIVELY). Razlika od
// market-momentum (ki gleda BULLISH/BEARISH trend v 7 dneh) — ta gleda
// STRUKTURNO stanje supply/demand per kategorija danes. Razlika od
// market-trend (ki gleda rising/falling cene) — ta gleda balance in
// predlaga akcijo.
//
// GET+POST /api/ai/supply-demand-balance
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import {
  callProviderForRaw,
  parseJsonLooseExported,
  type AiProviderType,
  type AiSettings,
} from '@/lib/ai';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type BalanceStatus = 'SELLER_MARKET' | 'BALANCED' | 'BUYER_MARKET';
type PriceOutlook = 'RISING' | 'STABLE' | 'FALLING';
type RecommendedAction =
  | 'SELL_AGGRESSIVELY'
  | 'SELL_NORMAL'
  | 'HOLD'
  | 'BUY_AGGRESSIVELY';

interface CategoryBalanceRow {
  category: string;
  supply: number;
  demand: number;
  sellThroughRate: number; // %
  avgDaysListed: number;
  priceStability: number; // %
  balanceStatus: BalanceStatus;
  demandStrength: number; // 0-100
  supplyPressure: number; // 0-100 (higher = oversupplied)
  priceOutlook: PriceOutlook;
  recommendedAction: RecommendedAction;
  reasoning: string;
}

interface AiSupplyDemandResponse {
  categories?: unknown;
  overall?: unknown;
}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;

const VALID_BALANCE: readonly BalanceStatus[] = [
  'SELLER_MARKET',
  'BALANCED',
  'BUYER_MARKET',
] as const;
const VALID_OUTLOOK: readonly PriceOutlook[] = [
  'RISING',
  'STABLE',
  'FALLING',
] as const;
const VALID_ACTION: readonly RecommendedAction[] = [
  'SELL_AGGRESSIVELY',
  'SELL_NORMAL',
  'HOLD',
  'BUY_AGGRESSIVELY',
] as const;

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

function round1(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 10) / 10;
}

// --- Deterministic analysis (fallback) -----------------------------------

function deterministicBalance(sellThroughRate: number): BalanceStatus {
  if (sellThroughRate >= 70) return 'SELLER_MARKET';
  if (sellThroughRate >= 40) return 'BALANCED';
  return 'BUYER_MARKET';
}

function deterministicOutlook(balance: BalanceStatus): PriceOutlook {
  if (balance === 'SELLER_MARKET') return 'RISING';
  if (balance === 'BUYER_MARKET') return 'FALLING';
  return 'STABLE';
}

function deterministicAction(balance: BalanceStatus): RecommendedAction {
  if (balance === 'SELLER_MARKET') return 'SELL_AGGRESSIVELY';
  if (balance === 'BUYER_MARKET') return 'BUY_AGGRESSIVELY';
  return 'HOLD';
}

// demandStrength: sellThroughRate scaled to 0-100 + bonus for absolute demand volume
function computeDemandStrength(
  sellThroughRate: number,
  demand: number,
): number {
  let score = sellThroughRate;
  if (demand >= 20) score += 10;
  else if (demand >= 10) score += 5;
  else if (demand >= 5) score += 2;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// supplyPressure: 100 - sellThroughRate + bonus for high supply
function computeSupplyPressure(
  sellThroughRate: number,
  supply: number,
): number {
  let score = 100 - sellThroughRate;
  if (supply >= 100) score += 10;
  else if (supply >= 50) score += 5;
  else if (supply >= 20) score += 2;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function deterministicReasoning(
  category: string,
  row: {
    supply: number;
    demand: number;
    sellThroughRate: number;
    balanceStatus: BalanceStatus;
  },
): string {
  const pct = round1(row.sellThroughRate);
  if (row.balanceStatus === 'SELLER_MARKET') {
    return `"${category}": SELLER_MARKET — sell-through ${pct}% (${row.demand}/${row.supply}). Povpraševanje presega ponudbo — cene rastejo, prodaj zdaj.`;
  }
  if (row.balanceStatus === 'BUYER_MARKET') {
    return `"${category}": BUYER_MARKET — sell-through ${pct}% (${row.demand}/${row.supply}). Presežek ponudbe — kupcu ugodno, čakaj s prodajo.`;
  }
  return `"${category}": BALANCED — sell-through ${pct}% (${row.demand}/${row.supply}). Ponudba in povpraševanje v ravnovesju — normalno trguj.`;
}

// --- Overall summary builder --------------------------------------------

function buildOverall(rows: CategoryBalanceRow[]) {
  const total = rows.length;
  if (total === 0) {
    return {
      avgSellThroughRate: 0,
      sellerMarketCategories: 0,
      buyerMarketCategories: 0,
      bestCategoryToSell: null,
      bestCategoryToBuy: null,
      marketBalance: 'Ni kategorij za analizo.',
    };
  }

  const avgSellThroughRate = round1(
    rows.reduce((s, r) => s + r.sellThroughRate, 0) / total,
  );
  const sellerMarketCategories = rows.filter(
    r => r.balanceStatus === 'SELLER_MARKET',
  ).length;
  const buyerMarketCategories = rows.filter(
    r => r.balanceStatus === 'BUYER_MARKET',
  ).length;

  const bestToSell = [...rows]
    .filter(r => r.supply > 0)
    .sort((a, b) => b.demandStrength - a.demandStrength)[0];
  const bestToBuy = [...rows]
    .filter(r => r.supply > 0)
    .sort((a, b) => b.supplyPressure - a.supplyPressure)[0];

  let marketBalance: string;
  if (sellerMarketCategories > buyerMarketCategories) {
    marketBalance = `Trg naklonjen PRODAJALCEM — ${sellerMarketCategories} od ${total} kategorij v SELLER_MARKET. Avg sell-through ${avgSellThroughRate}%. Prodi zdaj.`;
  } else if (buyerMarketCategories > sellerMarketCategories) {
    marketBalance = `Trg naklonjen KUPCEM — ${buyerMarketCategories} od ${total} kategorij v BUYER_MARKET. Avg sell-through ${avgSellThroughRate}%. Ugoden čas za nakup.`;
  } else {
    marketBalance = `Trg v RAVNOVESJU — ${sellerMarketCategories} SELLER, ${buyerMarketCategories} BUYER od ${total} kategorij. Avg sell-through ${avgSellThroughRate}%. Normalno trguj.`;
  }

  return {
    avgSellThroughRate,
    sellerMarketCategories,
    buyerMarketCategories,
    bestCategoryToSell: bestToSell?.category ?? null,
    bestCategoryToBuy: bestToBuy?.category ?? null,
    marketBalance,
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleSupplyDemand(req);
}
export async function POST(req: NextRequest) {
  return handleSupplyDemand(req);
}

async function handleSupplyDemand(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-supply-demand', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    // Parse body (optional — analysis uses global data)
    try {
      await req.json().catch(() => ({}));
    } catch {
      // GET request — no body, ignore
    }

    const now = Date.now();
    const thirtyDaysAgo = new Date(now - 30 * DAY_MS);

    // 1) Query all listings from last 30 days (with category + price + status)
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: thirtyDaysAgo },
        isHidden: false,
      },
      select: {
        id: true,
        firstSeenAt: true,
        isBookmarked: true,
        contactStatus: true,
        priceDroppedAt: true,
        price: true,
        monitor: { select: { tags: true } },
        trades: {
          select: { id: true, status: true },
          take: 5,
        },
      },
      take: 10000,
    });

    // 2) Empty state
    if (listings.length === 0) {
      return NextResponse.json({
        ok: true,
        categories: [],
        overall: {
          avgSellThroughRate: 0,
          sellerMarketCategories: 0,
          buyerMarketCategories: 0,
          bestCategoryToSell: null,
          bestCategoryToBuy: null,
          marketBalance: 'Ni podatkov o oglasih v zadnjih 30 dneh.',
        },
        aiUsed: false,
        message:
          'Ni oglasov v zadnjih 30 dneh — Supply/Demand analiza ni mogoča.',
      });
    }

    // 3) Group listings by category (from monitor.tags or default "drugo")
    const categoryData = new Map<
      string,
      {
        supply: number;
        demand: number;
        totalDaysListed: number;
        listedCount: number;
        priceDropCount: number;
      }
    >();

    for (const l of listings) {
      const tagsRaw = (l.monitor?.tags as string | undefined) || '';
      const firstTag = tagsRaw
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)[0];
      const cat = (firstTag || 'drugo').trim() || 'drugo';

      const cur =
        categoryData.get(cat) || {
          supply: 0,
          demand: 0,
          totalDaysListed: 0,
          listedCount: 0,
          priceDropCount: 0,
        };

      const hasSoldTrade = (l.trades || []).some(t => t.status === 'sold');
      if (!hasSoldTrade) cur.supply += 1;

      const isDemanded =
        l.isBookmarked ||
        (l.contactStatus && l.contactStatus !== 'none') ||
        hasSoldTrade;
      if (isDemanded) cur.demand += 1;

      const firstSeen = l.firstSeenAt ? new Date(l.firstSeenAt).getTime() : now;
      const daysListed = Math.max(0, (now - firstSeen) / DAY_MS);
      cur.totalDaysListed += daysListed;
      cur.listedCount += 1;

      if (l.priceDroppedAt) cur.priceDropCount += 1;

      categoryData.set(cat, cur);
    }

    // 4) Build category rows with deterministic analysis
    const categoryRows: CategoryBalanceRow[] = [];
    for (const [category, d] of categoryData.entries()) {
      const sellThroughRate =
        d.supply > 0
          ? Math.round((d.demand / d.supply) * 1000) / 10
          : d.demand > 0
            ? 100
            : 0;
      const avgDaysListed =
        d.listedCount > 0
          ? round1(d.totalDaysListed / d.listedCount)
          : 0;
      const priceStability =
        d.listedCount > 0
          ? Math.round(
              ((d.listedCount - d.priceDropCount) / d.listedCount) * 100,
            )
          : 100;

      const balanceStatus = deterministicBalance(sellThroughRate);
      const demandStrength = computeDemandStrength(sellThroughRate, d.demand);
      const supplyPressure = computeSupplyPressure(sellThroughRate, d.supply);
      const priceOutlook = deterministicOutlook(balanceStatus);
      const recommendedAction = deterministicAction(balanceStatus);

      categoryRows.push({
        category,
        supply: d.supply,
        demand: d.demand,
        sellThroughRate,
        avgDaysListed,
        priceStability,
        balanceStatus,
        demandStrength,
        supplyPressure,
        priceOutlook,
        recommendedAction,
        reasoning: '',
      });
    }

    categoryRows.sort((a, b) => b.demandStrength - a.demandStrength);

    // 5) AI cache — keyed by current week (refreshes weekly)
    const currentDay = new Date(now).toISOString().slice(0, 10);
    const weekKey = `${currentDay.slice(0, 4)}-W${Math.ceil(
      Number(currentDay.slice(8, 10)) / 7,
    )}`;
    const cacheKey = `supply-demand-balance:${weekKey}`;
    const cached = getCachedAI<{ rows: CategoryBalanceRow[] }>(cacheKey);
    if (cached && Array.isArray(cached.rows) && cached.rows.length > 0) {
      const merged = categoryRows.map(r => {
        const c = cached.rows.find(x => x.category === r.category);
        if (!c) return r;
        return {
          ...r,
          balanceStatus: clampEnum(c.balanceStatus, VALID_BALANCE, r.balanceStatus),
          priceOutlook: clampEnum(c.priceOutlook, VALID_OUTLOOK, r.priceOutlook),
          recommendedAction: clampEnum(
            c.recommendedAction,
            VALID_ACTION,
            r.recommendedAction,
          ),
          demandStrength: clampNumber(
            c.demandStrength,
            0,
            100,
            r.demandStrength,
          ),
          supplyPressure: clampNumber(
            c.supplyPressure,
            0,
            100,
            r.supplyPressure,
          ),
          reasoning: clampString(c.reasoning, 400, r.reasoning),
        };
      });

      return NextResponse.json({
        ok: true,
        categories: merged,
        overall: buildOverall(merged),
        cached: true,
        aiUsed: true,
      });
    }

    // 6) Build AI prompt with grounding
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as
        | AiProviderType
        | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '',
      fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const categoryBlock = categoryRows
      .slice(0, 15)
      .map(
        (r, i) =>
          `${i + 1}. ${r.category}: supply=${r.supply}, demand=${r.demand}, sellThroughRate=${r.sellThroughRate}%, avgDaysListed=${r.avgDaysListed}, priceStability=${r.priceStability}%`,
      )
      .join('\n');

    const prompt = `Si AI analitik ponudbe in povpraševanja za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Na podlagi podatkov o supply (aktivni oglasi) in demand (bookmarked / contacted / sold) per kategorija, oceni balance, demandStrength, supplyPressure, priceOutlook in recommendedAction.

KATEGORIJE (top ${Math.min(15, categoryRows.length)} od ${categoryRows.length}):
${categoryBlock}

PRAVILA ZA ANALIZO:
1. balanceStatus per kategorija:
   - SELLER_MARKET: sellThroughRate >= 70 (demand > 70% supply — povpraševanje presega ponudbo, cene rastejo)
   - BALANCED: 40-70% (ravnovesje)
   - BUYER_MARKET: < 40% (presežek ponudbe, kupcu ugodno)
2. demandStrength 0-100: višji = več povpraševanja (uporabi sellThroughRate kot osnovo + bonus za velik demand volumen)
3. supplyPressure 0-100: višji = večja presežek ponudbe (100 - sellThroughRate + bonus za velik supply volumen)
4. priceOutlook: RISING (SELLER_MARKET), STABLE (BALANCED), FALLING (BUYER_MARKET)
5. recommendedAction:
   - SELL_AGGRESSIVELY: SELLER_MARKET — prodi zdaj ko cene visoke
   - SELL_NORMAL: BALANCED z dobrim demandStrength (>50)
   - HOLD: BALANCED z nizkim demandStrength (<50)
   - BUY_AGGRESSIVELY: BUYER_MARKET — kupi zdaj ko so cene nizke
6. reasoning: 1-2 povedi slovensko — zakaj ta ocena, kaj pomeni za uporabnika.

VRNI LE JSON:
{
  "categories": [
    {
      "category": "elektronika",
      "balanceStatus": "SELLER_MARKET",
      "demandStrength": 85,
      "supplyPressure": 15,
      "priceOutlook": "RISING",
      "recommendedAction": "SELL_AGGRESSIVELY",
      "reasoning": "Povpraševanje presega ponudbo (75% sell-through). Prodi elektroniko zdaj — cene rastejo."
    }
  ]
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;
    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as
        | AiSupplyDemandResponse
        | null;

      if (parsed && Array.isArray(parsed.categories)) {
        const aiCatMap = new Map<string, CategoryBalanceRow>();
        for (const item of parsed.categories) {
          const a = item as Record<string, unknown> | null;
          if (!a || typeof a !== 'object') continue;
          const category = clampString(a.category, 100, '');
          if (!category) continue;
          aiCatMap.set(category, {
            category,
            supply: 0,
            demand: 0,
            sellThroughRate: 0,
            avgDaysListed: 0,
            priceStability: 0,
            balanceStatus: clampEnum(a.balanceStatus, VALID_BALANCE, 'BALANCED'),
            demandStrength: clampNumber(a.demandStrength, 0, 100, 0),
            supplyPressure: clampNumber(a.supplyPressure, 0, 100, 0),
            priceOutlook: clampEnum(a.priceOutlook, VALID_OUTLOOK, 'STABLE'),
            recommendedAction: clampEnum(a.recommendedAction, VALID_ACTION, 'HOLD'),
            reasoning: clampString(a.reasoning, 400, ''),
          });
        }

        if (aiCatMap.size > 0) {
          for (const row of categoryRows) {
            const ai = aiCatMap.get(row.category);
            if (!ai) {
              row.reasoning = deterministicReasoning(row.category, row);
              continue;
            }
            row.balanceStatus = ai.balanceStatus;
            row.priceOutlook = ai.priceOutlook;
            row.recommendedAction = ai.recommendedAction;
            row.demandStrength = ai.demandStrength;
            row.supplyPressure = ai.supplyPressure;
            row.reasoning = ai.reasoning || deterministicReasoning(row.category, row);
          }
          aiUsed = true;
        }
      }
    } catch (err) {
      logger.warn(
        '/api/ai/supply-demand-balance',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) If AI not used, fill deterministic reasoning for all rows
    if (!aiUsed) {
      for (const row of categoryRows) {
        if (!row.reasoning) {
          row.reasoning = deterministicReasoning(row.category, row);
        }
      }
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { rows: categoryRows });
    }

    // 9) Overall summary
    const overall = buildOverall(categoryRows);

    return NextResponse.json({
      ok: true,
      categories: categoryRows,
      overall,
      aiUsed,
    });
  } catch (err: any) {
    logger.error('/api/ai/supply-demand-balance', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
