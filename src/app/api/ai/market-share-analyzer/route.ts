// v7.67: AI Market Share Analyzer — AI ocenjuje tvoj market share v
// kategorijah kjer trguješ, glede na volumen oglasov vs total market
// listings. Prikazuje tvojo pozicijo vs konkurenco.
//
// "Elektronika: 12% market share (CHALLENGER). Moda: 2% (NICHE).
//  Priložnost: razširi v avto (velik trg, 0% share)."
//
// Razlika od competitive-landscape-analyzer (ki analizira druge
// prodajalce/konkurente aktivne v tvojih kategorijah) — ta ocenjuje
// TVOJ delež na trgu (market share % per kategorija) in klasifikacijo
// LEADER/CHALLENGER/FOLLOWER/NICHE. Razlika od analytics/market-gap-finder
// (ki išče praznine v trgu) — ta ANALIZIRA tvojo pozicijo in
// growth opportunities. Razlika od analytics/competitor-tracker (ki
// sledi dobaviteljem) — ta gleda TVOJO aktivnost vs celoten trg.
//
// GET+POST /api/ai/market-share-analyzer
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

type CompetitivePosition = 'LEADER' | 'CHALLENGER' | 'FOLLOWER' | 'NICHE';

interface CategoryShareRow {
  category: string;
  yourListingsInteracted: number;
  totalMarketListings: number;
  yourTradesInCategory: number;
  yourSoldInCategory: number;
  estimatedMarketShare: number; // %
  competitivePosition: CompetitivePosition;
  confidenceScore: number; // 0-100
}

interface DominantCategory {
  category: string;
  share: number;
  reasoning: string;
}

interface UntappedCategory {
  category: string;
  marketSize: number;
  reasoning: string;
}

interface GrowthOpportunity {
  category: string;
  potentialShare: number;
  strategy: string;
}

interface AiMarketShareResponse {
  dominantCategories?: unknown;
  untappedCategories?: unknown;
  overallPosition?: unknown;
  growthOpportunity?: unknown;
}

// --- Helpers -------------------------------------------------------------

const VALID_POSITIONS: readonly CompetitivePosition[] = [
  'LEADER',
  'CHALLENGER',
  'FOLLOWER',
  'NICHE',
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

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Deterministic competitive position from market share percentiles
// LEADER = top 25% share, CHALLENGER = next 25%, FOLLOWER = next 25%, NICHE = bottom 25%
function deterministicPosition(
  share: number,
  allShares: number[],
): CompetitivePosition {
  if (allShares.length === 0) return 'NICHE';
  const sorted = [...allShares].sort((a, b) => a - b);
  const p25 = sorted[Math.floor(sorted.length * 0.25)] ?? 0;
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
  if (share >= p75) return 'LEADER';
  if (share >= p50) return 'CHALLENGER';
  if (share >= p25) return 'FOLLOWER';
  return 'NICHE';
}

// Confidence score based on data quality: 10% of listings = sales assumption
// Lower confidence when totalMarketListings is small or your activity is low
function computeConfidence(
  totalMarketListings: number,
  yourTradesInCategory: number,
  yourListingsInteracted: number,
): number {
  let conf = 50; // base
  // More market data = higher confidence
  if (totalMarketListings >= 100) conf += 25;
  else if (totalMarketListings >= 30) conf += 15;
  else if (totalMarketListings >= 10) conf += 5;
  else conf -= 10; // very low market data
  // Your activity level
  if (yourTradesInCategory >= 5) conf += 15;
  else if (yourTradesInCategory >= 2) conf += 5;
  else if (yourTradesInCategory === 0) conf -= 10;
  if (yourListingsInteracted >= 5) conf += 10;
  return Math.max(0, Math.min(100, conf));
}

// --- Deterministic analysis (fallback) -----------------------------------

function buildDeterministicAnalysis(
  rows: CategoryShareRow[],
): {
  dominantCategories: DominantCategory[];
  untappedCategories: UntappedCategory[];
  overallPosition: string;
  growthOpportunity: GrowthOpportunity[];
} {
  // Dominant = top 3 by share (where share > 0)
  const dominantCategories: DominantCategory[] = rows
    .filter(r => r.estimatedMarketShare > 0)
    .sort((a, b) => b.estimatedMarketShare - a.estimatedMarketShare)
    .slice(0, 3)
    .map(r => ({
      category: r.category,
      share: r.estimatedMarketShare,
      reasoning: `${r.yourTradesInCategory} trade-ov v "${r.category}" (trg=${r.totalMarketListings} oglasov) → ${r.estimatedMarketShare}% ocenjeni share. Pozicija: ${r.competitivePosition}.`,
    }));

  // Untapped = categories where market is large (>20 listings) but you're inactive (0 trades)
  const untappedCategories: UntappedCategory[] = rows
    .filter(
      r =>
        r.yourTradesInCategory === 0 && r.totalMarketListings >= 20,
    )
    .sort((a, b) => b.totalMarketListings - a.totalMarketListings)
    .slice(0, 3)
    .map(r => ({
      category: r.category,
      marketSize: r.totalMarketListings,
      reasoning: `"${r.category}" ima ${r.totalMarketListings} oglasov na trgu — velik trg brez tvoje aktivnosti. Potential za širitev.`,
    }));

  // Overall position summary
  const allShares = rows.map(r => r.estimatedMarketShare);
  const avgShare =
    allShares.length > 0
      ? Math.round(
          (allShares.reduce((s, x) => s + x, 0) / allShares.length) * 10,
        ) / 10
      : 0;
  const leaderCount = rows.filter(
    r => r.competitivePosition === 'LEADER',
  ).length;
  const overallPosition =
    rows.length === 0
      ? 'Ni kategorij za analizo — dodaš trades za začetek.'
      : `Aktiven v ${rows.length} kategorij${rows.length === 1 ? 'i' : 'ah'}. LEADER v ${leaderCount}. Avg market share ${avgShare}%. ${
          leaderCount > 0
            ? 'Močna pozicija — vzdržuj in širi.'
            : untappedCategories.length > 0
              ? `Priložnost: razširi v "${untappedCategories[0].category}".`
              : 'Konsolidiraj pozicijo z večjim volumnom.'
        }`;

  // Growth opportunities = untapped + low-share categories with big market
  const growthOpportunity: GrowthOpportunity[] = rows
    .filter(
      r =>
        r.totalMarketListings >= 15 &&
        r.estimatedMarketShare < 10,
    )
    .sort((a, b) => b.totalMarketListings - a.totalMarketListings)
    .slice(0, 3)
    .map(r => {
      // Project potential share if you doubled activity
      const potentialShare = Math.min(
        100,
        Math.round(r.estimatedMarketShare * 2 + 5),
      );
      const strategy =
        r.yourTradesInCategory === 0
          ? `Začni z 2-3 nakupi v "${r.category}" (trg=${r.totalMarketListings} oglasov). Fokusiraj na sweet-spot cenovni razpon.`
          : `Povečaj aktivnost iz ${r.yourTradesInCategory} na ${r.yourTradesInCategory * 2} trade-ov v "${r.category}". Skrajšaj hold time za hitrejši obrat.`;
      return {
        category: r.category,
        potentialShare,
        strategy,
      };
    });

  return {
    dominantCategories,
    untappedCategories,
    overallPosition,
    growthOpportunity,
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleMarketShare(req);
}
export async function POST(req: NextRequest) {
  return handleMarketShare(req);
}

async function handleMarketShare(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-market-share', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    // Parse body (optional, ignored — analysis uses global data)
    try {
      await req.json().catch(() => ({}));
    } catch {
      // GET request — no body, ignore
    }

    const now = Date.now();

    // 1) Query all trades (held + sold) — distinct categories represent YOUR market
    const allTrades = await db.trade.findMany({
      where: {
        status: { in: ['held', 'sold'] },
      },
      select: {
        id: true,
        title: true,
        category: true,
        status: true,
        listingId: true,
        listing: {
          select: {
            id: true,
            monitorId: true,
            monitor: { select: { id: true, name: true } },
          },
        },
      },
      take: 5000,
    });

    // 2) Query all listings you've interacted with (bookmarked OR contacted)
    const interactedListings = await db.listing.findMany({
      where: {
        OR: [
          { isBookmarked: true },
          { contactStatus: { not: 'none' } },
        ],
        isHidden: false,
      },
      select: {
        id: true,
        monitorId: true,
        title: true,
        isBookmarked: true,
        contactStatus: true,
      },
      take: 5000,
    });

    // 3) Empty state — no trades at all
    if (allTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        categories: [],
        analysis: {
          dominantCategories: [],
          untappedCategories: [],
          overallPosition:
            'Ni trade-ov — Market Share analiza ni mogoča. Začni z nakupi in dodajanje trade-ov.',
          growthOpportunity: [],
        },
        summary: {
          totalCategories: 0,
          leaderCategories: 0,
          avgMarketShare: 0,
          advice:
            'Ni trade-ov — dodaš prve trade-e z veljavnim category za začetek Market Share analize.',
        },
        aiUsed: false,
        message:
          'Ni held ali sold trade-ov — Market Share analiza ni mogoča.',
      });
    }

    // 4) Group trades by category — extract category, linked monitorIds
    const categoryData = new Map<
      string,
      {
        yourTradesInCategory: number;
        yourSoldInCategory: number;
        matchingMonitorIds: Set<string>;
      }
    >();

    for (const t of allTrades) {
      const cat = (t.category || 'drugo').trim().toLowerCase() || 'drugo';
      const cur =
        categoryData.get(cat) || {
          yourTradesInCategory: 0,
          yourSoldInCategory: 0,
          matchingMonitorIds: new Set<string>(),
        };
      cur.yourTradesInCategory += 1;
      if (t.status === 'sold') cur.yourSoldInCategory += 1;
      if (t.listing?.monitorId) {
        cur.matchingMonitorIds.add(t.listing.monitorId);
      }
      categoryData.set(cat, cur);
    }

    // 5) For each category — query totalMarketListings + yourListingsInteracted
    // We need to count listings in matching monitors (and global interaction count)
    const interactedByMonitor = new Map<string, number>();
    for (const l of interactedListings) {
      if (!l.monitorId) continue;
      interactedByMonitor.set(
        l.monitorId,
        (interactedByMonitor.get(l.monitorId) ?? 0) + 1,
      );
    }

    const categoryRows: CategoryShareRow[] = [];
    for (const [category, d] of categoryData.entries()) {
      const monitorIds = Array.from(d.matchingMonitorIds);

      let totalMarketListings = 0;
      let yourListingsInteracted = 0;

      if (monitorIds.length > 0) {
        // Count total listings in matching monitors
        try {
          totalMarketListings = await db.listing.count({
            where: {
              monitorId: { in: monitorIds },
              isHidden: false,
            },
          });
        } catch {
          totalMarketListings = 0;
        }
        // Sum interactions across those monitors
        for (const mid of monitorIds) {
          yourListingsInteracted += interactedByMonitor.get(mid) ?? 0;
        }
      }

      // estimatedMarketShare = yourTradesInCategory / (totalMarketListings × 0.1) × 100
      // (assumes ~10% of listings result in a sale)
      const estimatedTotalSales = totalMarketListings * 0.1;
      const estimatedMarketShare =
        estimatedTotalSales > 0
          ? Math.round(
              (d.yourTradesInCategory / estimatedTotalSales) * 1000,
            ) / 10
          : 0;

      categoryRows.push({
        category,
        yourListingsInteracted,
        totalMarketListings,
        yourTradesInCategory: d.yourTradesInCategory,
        yourSoldInCategory: d.yourSoldInCategory,
        estimatedMarketShare: Math.max(0, Math.min(100, estimatedMarketShare)),
        competitivePosition: 'NICHE', // placeholder, set below
        confidenceScore: 0,
      });
    }

    // 6) Compute competitive positions based on share percentiles
    const allShares = categoryRows.map(r => r.estimatedMarketShare);
    for (const row of categoryRows) {
      row.competitivePosition = deterministicPosition(
        row.estimatedMarketShare,
        allShares,
      );
      row.confidenceScore = computeConfidence(
        row.totalMarketListings,
        row.yourTradesInCategory,
        row.yourListingsInteracted,
      );
    }

    // Sort categories by yourTradesInCategory desc (most active first)
    categoryRows.sort(
      (a, b) => b.yourTradesInCategory - a.yourTradesInCategory,
    );

    // 7) Build deterministic analysis as fallback base
    const det = buildDeterministicAnalysis(categoryRows);

    // 8) AI cache — keyed by current month (refreshes monthly)
    const currentMonth = isoDate(new Date(now)).slice(0, 7); // YYYY-MM
    const cacheKey = `market-share-analyzer:${currentMonth}`;
    const cached = getCachedAI<{
      dominantCategories: DominantCategory[];
      untappedCategories: UntappedCategory[];
      overallPosition: string;
      growthOpportunity: GrowthOpportunity[];
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        categories: categoryRows,
        analysis: cached,
        summary: {
          totalCategories: categoryRows.length,
          leaderCategories: categoryRows.filter(
            r => r.competitivePosition === 'LEADER',
          ).length,
          avgMarketShare:
            categoryRows.length > 0
              ? Math.round(
                  (categoryRows.reduce(
                    (s, r) => s + r.estimatedMarketShare,
                    0,
                  ) /
                    categoryRows.length) *
                    10,
                ) / 10
              : 0,
          advice: cached.overallPosition,
        },
        cached: true,
        aiUsed: true,
      });
    }

    // 9) AI prompt with grounding
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '',
      fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // Build context block of category share data
    const categoryBlock = categoryRows
      .slice(0, 15) // top 15 categories
      .map(
        (r, i) =>
          `${i + 1}. ${r.category}: yourTrades=${r.yourTradesInCategory}, sold=${r.yourSoldInCategory}, listingsInteracted=${r.yourListingsInteracted}, totalMarketListings=${r.totalMarketListings}, estimatedShare=${r.estimatedMarketShare}%, position=${r.competitivePosition}, confidence=${r.confidenceScore}`,
      )
      .join('\n');

    const prompt = `Si AI analitik tržnega deleža za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Na podlagi TVOJIH aktivnosti (trades + interakcije z oglasi) in TOTAL MARKET podatkov (vsi oglasi v monitorjih kjer trguješ) oceni tvoj market share per kategorija in priporoči strategijo za rast.

TVOJE KATEGORIJE (top ${Math.min(15, categoryRows.length)} od ${categoryRows.length}):
${categoryBlock}

PRAVILA ZA ANALIZO:
1. dominantCategories: top 2-3 kategorije kjer imaš najvišji market share. Vsaka z reasoning (zakaj dominiraš — npr. "velik volumen nakupov v elektronika ti daje 12% share").
2. untappedCategories: 2-3 kategorije z velikim trgom (>=20 oglasov) kjer nisi aktiven (0 trade-ov). Z reasoning (zakaj je to priložnost).
3. overallPosition: 1-2 povedi slovensko — kakovost tvoje pozicije (koliko kategorij LEADER, avg share, top priložnost).
4. growthOpportunity: 2-3 kategorije kjer lahko rasteš (potentialShare + strategy kako).

OCENJEVANJE:
- Market share je ocenjen glede na predpostavko, da ~10% vseh oglasov rezultira v prodajo.
- Pozicija (LEADER/CHALLENGER/FOLLOWER/NICHE) temelji na percentileih tvojega share-a across kategorije.
- confidenceScore 0-100: višje = bolj zanesljiva ocena (več tržnih podatkov in tvoje aktivnosti).

VRNI LE JSON:
{
  "dominantCategories": [
    { "category": "elektronika", "share": 12.5, "reasoning": "..." }
  ],
  "untappedCategories": [
    { "category": "avto", "marketSize": 145, "reasoning": "..." }
  ],
  "overallPosition": "Aktiven v 5 kategorijah, LEADER v 1. Avg share 8.3%...",
  "growthOpportunity": [
    { "category": "avto", "potentialShare": 8, "strategy": "Začni z 2-3 nakupi..." }
  ]
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;
    let dominantCategories = det.dominantCategories;
    let untappedCategories = det.untappedCategories;
    let overallPosition = det.overallPosition;
    let growthOpportunity = det.growthOpportunity;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as
        | AiMarketShareResponse
        | null;

      if (parsed) {
        // dominantCategories
        const aiDom: DominantCategory[] = [];
        if (Array.isArray(parsed.dominantCategories)) {
          for (const item of parsed.dominantCategories) {
            const a = item as Record<string, unknown> | null;
            if (!a || typeof a !== 'object') continue;
            const category = clampString(a.category, 100, '');
            if (!category) continue;
            aiDom.push({
              category,
              share: clampNumber(a.share, 0, 100, 0),
              reasoning: clampString(
                a.reasoning,
                300,
                'Kategorija z višjim share-om od povprečja.',
              ),
            });
          }
        }
        if (aiDom.length > 0) {
          dominantCategories = aiDom.slice(0, 5);
        }

        // untappedCategories
        const aiUntap: UntappedCategory[] = [];
        if (Array.isArray(parsed.untappedCategories)) {
          for (const item of parsed.untappedCategories) {
            const a = item as Record<string, unknown> | null;
            if (!a || typeof a !== 'object') continue;
            const category = clampString(a.category, 100, '');
            if (!category) continue;
            aiUntap.push({
              category,
              marketSize: clampNumber(a.marketSize, 0, 1_000_000, 0),
              reasoning: clampString(
                a.reasoning,
                300,
                'Velik trg brez tvoje aktivnosti.',
              ),
            });
          }
        }
        if (aiUntap.length > 0) {
          untappedCategories = aiUntap.slice(0, 5);
        }

        // overallPosition
        if (
          typeof parsed.overallPosition === 'string' &&
          parsed.overallPosition.trim().length > 0
        ) {
          overallPosition = clampString(
            parsed.overallPosition,
            500,
            det.overallPosition,
          );
        }

        // growthOpportunity
        const aiGrowth: GrowthOpportunity[] = [];
        if (Array.isArray(parsed.growthOpportunity)) {
          for (const item of parsed.growthOpportunity) {
            const a = item as Record<string, unknown> | null;
            if (!a || typeof a !== 'object') continue;
            const category = clampString(a.category, 100, '');
            if (!category) continue;
            aiGrowth.push({
              category,
              potentialShare: clampNumber(a.potentialShare, 0, 100, 0),
              strategy: clampString(
                a.strategy,
                300,
                'Povečaj aktivnost za višji share.',
              ),
            });
          }
        }
        if (aiGrowth.length > 0) {
          growthOpportunity = aiGrowth.slice(0, 5);
        }

        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/market-share-analyzer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 10) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        dominantCategories,
        untappedCategories,
        overallPosition,
        growthOpportunity,
      });
    }

    // 11) Summary
    const totalCategories = categoryRows.length;
    const leaderCategories = categoryRows.filter(
      r => r.competitivePosition === 'LEADER',
    ).length;
    const avgMarketShare =
      totalCategories > 0
        ? Math.round(
            (categoryRows.reduce(
              (s, r) => s + r.estimatedMarketShare,
              0,
            ) /
              totalCategories) *
              10,
          ) / 10
        : 0;

    let advice: string;
    if (totalCategories === 0) {
      advice =
        'Ni kategorij — dodaš trades z veljavnim category za začetek analize.';
    } else if (leaderCategories > 0) {
      advice = `LEADER v ${leaderCategories} od ${totalCategories} kategorij${leaderCategories === 1 ? '' : 'ah'}. Avg market share ${avgMarketShare}%. ${
        untappedCategories.length > 0
          ? `Priložnost: razširi v "${untappedCategories[0].category}" (${untappedCategories[0].marketSize} oglasov).`
          : 'Vzdržuj pozicijo z doslednim sourcing-om.'
      }`;
    } else {
      advice = `Aktiven v ${totalCategories} kategorij${totalCategories === 1 ? 'i' : 'ah'}, brez LEADER pozicije. Avg share ${avgMarketShare}%. ${
        growthOpportunity.length > 0
          ? `Naslednji korak: ${growthOpportunity[0].strategy}`
          : 'Povečaj volumen za višji market share.'
      }`;
    }

    return NextResponse.json({
      ok: true,
      categories: categoryRows,
      analysis: {
        dominantCategories,
        untappedCategories,
        overallPosition,
        growthOpportunity,
      },
      summary: {
        totalCategories,
        leaderCategories,
        avgMarketShare,
        advice,
      },
      aiUsed,
    });
  } catch (err: any) {
    logger.error('/api/ai/market-share-analyzer', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
