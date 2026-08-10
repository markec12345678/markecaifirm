// v7.58: Auto-Relisting Scheduler — AI-poganjan načrt za PONOVNO OBJAVO
// held inventarja na različnih platformah. Razlika od listing-refresh-scheduler:
// ta generira FULL načrt (nov naslov, optimalna ura, cross-platform strategija),
// medtem ko listing-refresh-scheduler samo predlaga KDAJ osvežiti.
//
// "PS5 21 dni brez prodaje → ponovna objava na Bolhi
//  'PS5 Digital 2024 + 2 controllerja, novo stanje' za 380€ (Saturday 10:00)"
//
// GET /api/ai/auto-relisting-scheduler  (cached 6h)
// POST /api/ai/auto-relisting-scheduler (AI Hub runner — body ignored)
//
// Anti-hallucination: newPrice clamped [0.5×, 1.2×] buyPrice,
//                      expectedSellTimeDays clamped [1, 60].
// Deterministic fallback when AI unavailable.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DAY_MS = 86_400_000;

const SOURCE_TO_PLATFORM: Record<string, string> = {
  bolha: 'Bolha',
  vinted: 'Vinted',
  facebook: 'Facebook',
  avtonet: 'Avtonet',
  mobilede: 'mobile.de',
  'mobile-de': 'mobile.de',
  kleinanzeigen: 'Kleinanzeigen',
  subito: 'Subito',
  willhaben: 'Willhaben',
  nepremicnine: 'Nepremičnine',
  salomon: 'Salomon',
  'custom-rss': 'Custom RSS',
};

const KNOWN_PLATFORMS = new Set(['Bolha', 'Vinted', 'Facebook']);
const VALID_STRATEGIES = new Set([
  'FRESH_LISTING',
  'CROSS_POST',
  'PRICE_DROP_RELIST',
  'BUNDLE_WITH_OTHER',
]);
const VALID_URGENCIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM']);
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface FlipChecklistStep {
  step?: string;
  completedAt?: string;
  completed?: boolean;
}

/** Parse flipChecklist to count how many platforms the item is already listed on. */
function parsePlatformsListed(flipChecklist: string | null | undefined): string[] {
  if (!flipChecklist) return [];
  try {
    const arr = JSON.parse(flipChecklist) as FlipChecklistStep[];
    if (!Array.isArray(arr)) return [];
    const platforms: string[] = [];
    for (const s of arr) {
      const step = (s?.step ?? '').toLowerCase();
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

interface HeldItemComputed {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  daysHeld: number;
  currentPlatform: string;
  urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  listingPerformance: { contacts: number; bookmarks: number; priceDrops: number };
}

interface AiRelistPlan {
  tradeId?: string;
  recommendedPlatform?: string;
  newTitle?: string;
  newPrice?: unknown;
  bestDayOfWeek?: string;
  bestHour?: unknown;
  listingStrategy?: string;
  expectedSellTimeDays?: unknown;
  reasoning?: string;
}

interface ScheduleItem {
  tradeId: string;
  title: string;
  currentTitle: string;
  daysHeld: number;
  currentPlatform: string;
  urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  listingPerformance: { contacts: number; bookmarks: number; priceDrops: number };
  recommendedPlatform: string;
  newTitle: string;
  newPrice: number;
  bestTimeToList: { dayOfWeek: string; hour: number };
  listingStrategy: 'FRESH_LISTING' | 'CROSS_POST' | 'PRICE_DROP_RELIST' | 'BUNDLE_WITH_OTHER';
  expectedSellTimeDays: number;
  reasoning: string;
}

interface CachedPayload {
  schedule: ScheduleItem[];
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    estimatedRevenueIfRelisted: number;
    estimatedDaysToClear: number;
  };
  aiUsed: boolean;
}

/** Clamp AI-suggested price to [0.5×, 1.2×] buyPrice (per spec). */
function clampPrice(price: unknown, buyPrice: number): number | null {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return null;
  const min = buyPrice * 0.5;
  const max = buyPrice * 1.2;
  return Math.round(Math.max(min, Math.min(max, n)));
}

/** Clamp expected sell time to [1, 60] days. */
function clampExpectedDays(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.min(60, Math.round(n)));
}

/** Normalize free-form platform string to one of KNOWN_PLATFORMS. */
function normalizePlatform(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const p = raw.trim();
  if (KNOWN_PLATFORMS.has(p)) return p;
  const lower = p.toLowerCase();
  if (lower.includes('bolha')) return 'Bolha';
  if (lower.includes('vinted')) return 'Vinted';
  if (lower.includes('face') || lower === 'fb' || lower.includes('marketplace')) return 'Facebook';
  return null;
}

/** Deterministic fallback plan if AI fails or returns invalid output. */
function deterministicPlan(item: HeldItemComputed): {
  recommendedPlatform: string;
  newTitle: string;
  newPrice: number;
  bestDayOfWeek: string;
  bestHour: number;
  listingStrategy: 'FRESH_LISTING' | 'CROSS_POST' | 'PRICE_DROP_RELIST' | 'BUNDLE_WITH_OTHER';
  expectedSellTimeDays: number;
  reasoning: string;
} {
  // Price: 10% discount for quick sale, clamped within [0.5×, 1.2×]
  const newPrice = Math.round(Math.max(item.buyPrice * 0.5, Math.min(item.buyPrice * 1.2, item.buyPrice * 0.9)));

  // Platform: prefer cross-posting to a different platform if currently single-platform
  let platform = 'Bolha';
  let strategy: 'FRESH_LISTING' | 'CROSS_POST' | 'PRICE_DROP_RELIST' | 'BUNDLE_WITH_OTHER' = 'FRESH_LISTING';
  if (item.currentPlatform === 'Bolha') {
    platform = 'Vinted';
    strategy = 'CROSS_POST';
  } else if (item.currentPlatform === 'Vinted') {
    platform = 'Bolha';
    strategy = 'CROSS_POST';
  } else if (item.currentPlatform === 'Facebook') {
    platform = 'Bolha';
    strategy = 'CROSS_POST';
  }
  // Critical urgency → fresh relist with price drop on same platform
  if (item.urgency === 'CRITICAL') {
    platform = item.currentPlatform;
    strategy = 'PRICE_DROP_RELIST';
  }

  // Title: append a slight SEO suffix (cheap heuristic)
  const baseTitle = item.title.slice(0, 55);
  const seoSuffix = item.category && item.category !== 'drugo' ? ` | ${item.category}` : '';
  const newTitle = `${baseTitle}${seoSuffix}`.slice(0, 70);

  // Best time: Saturday 10:00 (peak traffic for Slovenian classifieds)
  const bestDayOfWeek = 'Saturday';
  const bestHour = 10;

  // Expected sell time: estimate based on urgency
  let expectedSellTimeDays = 21;
  if (item.urgency === 'CRITICAL') expectedSellTimeDays = 14;
  else if (item.urgency === 'HIGH') expectedSellTimeDays = 18;
  else if (item.urgency === 'MEDIUM') expectedSellTimeDays = 25;

  const reasoning = `${item.daysHeld}d v zalogi, urgency=${item.urgency} → ${strategy} na ${platform} z ${newPrice}€.`;

  return {
    recommendedPlatform: platform,
    newTitle,
    newPrice,
    bestDayOfWeek,
    bestHour,
    listingStrategy: strategy,
    expectedSellTimeDays,
    reasoning,
  };
}

export async function GET(req: NextRequest) {
  return handleAutoRelistingScheduler(req);
}

// AI Hub runner compatibility — body is ignored, identical logic.
export async function POST(req: NextRequest) {
  return handleAutoRelistingScheduler(req);
}

async function handleAutoRelistingScheduler(req: NextRequest) {
  try {
    // v7.32: AI rate limit (20/min/IP)
    const rl = checkRateLimit(req, 'ai-auto-relisting-scheduler', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();

    // 1) Query HELD trades with linked Listing (for title, category, imageUrl, dealScore)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyDate: true,
        buyLocation: true,
        flipChecklist: true,
        listing: {
          select: {
            id: true,
            contactStatus: true,
            isBookmarked: true,
            priceDroppedAt: true,
            dealScore: true,
            firstSeenAt: true,
            monitor: {
              select: { source: true },
            },
          },
        },
      },
      orderBy: { buyDate: 'asc' },
      take: 200,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        schedule: [],
        summary: {
          total: 0,
          critical: 0,
          high: 0,
          medium: 0,
          estimatedRevenueIfRelisted: 0,
          estimatedDaysToClear: 0,
        },
        aiUsed: false,
        message: 'Ni held inventarja — nič za ponovno objaviti.',
      });
    }

    // 2) Filter to items needing relisting:
    //    daysHeld > 14 OR priceDroppedAt set OR contactStatus indicates no interest
    const itemsNeedingRelist: HeldItemComputed[] = [];

    for (const t of heldTrades) {
      const buyDateMs = new Date(t.buyDate).getTime();
      const daysHeld = Math.max(0, Math.floor((now - buyDateMs) / DAY_MS));

      const priceDroppedAt = t.listing?.priceDroppedAt ?? null;
      const hasPriceDrop = priceDroppedAt !== null;
      const hasNoInterest = !t.listing || t.listing.contactStatus === 'none' || t.listing.contactStatus == null;

      const needsRelist = daysHeld > 14 || hasPriceDrop || (daysHeld >= 7 && hasNoInterest);
      if (!needsRelist) continue;

      // Compute current platform
      const monitorSource = t.listing?.monitor?.source;
      let currentPlatform = 'Bolha';
      if (monitorSource && monitorSource.trim() !== '') {
        const mapped = SOURCE_TO_PLATFORM[monitorSource.trim().toLowerCase()];
        if (mapped) currentPlatform = mapped;
      } else {
        const buyLocNorm = normalizePlatform(t.buyLocation);
        if (buyLocNorm) currentPlatform = buyLocNorm;
      }

      // Urgency
      let urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM';
      if (daysHeld > 30) urgency = 'CRITICAL';
      else if (daysHeld >= 14) urgency = 'HIGH';
      else urgency = 'MEDIUM';

      // Listing performance
      const contacts = (t.listing && t.listing.contactStatus && t.listing.contactStatus !== 'none') ? 1 : 0;
      const bookmarks = (t.listing?.isBookmarked ?? false) ? 1 : 0;
      const priceDrops = hasPriceDrop ? 1 : 0;

      itemsNeedingRelist.push({
        tradeId: t.id,
        title: t.title,
        category: (t.category && t.category.trim() !== '') ? t.category.trim() : 'drugo',
        buyPrice: Math.round(t.buyPrice),
        daysHeld,
        currentPlatform,
        urgency,
        listingPerformance: { contacts, bookmarks, priceDrops },
      });
    }

    if (itemsNeedingRelist.length === 0) {
      return NextResponse.json({
        ok: true,
        schedule: [],
        summary: {
          total: 0,
          critical: 0,
          high: 0,
          medium: 0,
          estimatedRevenueIfRelisted: 0,
          estimatedDaysToClear: 0,
        },
        aiUsed: false,
        message: 'Noben held item ne potrebuje ponovne objave (vsi <14d brez padca cene).',
      });
    }

    // 3) Check AI cache
    const heldItemIds = itemsNeedingRelist.map(i => i.tradeId);
    const cacheKey = `auto-relisting-scheduler:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<CachedPayload>(cacheKey);
    if (cached) {
      return NextResponse.json({ ok: true, ...cached, cached: true });
    }

    // 4) Build AI prompt with grounding
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

    const itemsBlock = itemsNeedingRelist
      .map((i, idx) => {
        return `#${idx + 1}
- tradeId: ${i.tradeId}
- naslov: ${i.title}
- kategorija: ${i.category}
- nabavna cena: ${i.buyPrice}€
- dni v zalogi: ${i.daysHeld}
- trenutna platforma: ${i.currentPlatform}
- urgency: ${i.urgency}
- kontakti: ${i.listingPerformance.contacts}
- zaznamki: ${i.listingPerformance.bookmarks}
- padci cene: ${i.listingPerformance.priceDrops}`;
      })
      .join('\n\n');

    const prompt = `Si ekspert za optimizacijo prodaje na slovenskih in evropskih oglasnih platformah (Bolha, Vinted, Facebook Marketplace).

Za vsak HELD item spodaj (ki potrebuje ponovno objavo) določi:
1. recommendedPlatform (Bolha | Vinted | Facebook) — kam ponovno objaviti (lahko druga platforma kot trenutna za cross-post)
2. newTitle (kratek SEO-optimiziran naslov, max 70 znakov — drugačen od trenutnega)
3. newPrice (EUR — znižana za hitro prodajo; ZNOTREJ [50%, 120%] nabavne cene)
4. bestDayOfWeek (dan v tednu: Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)
5. bestHour (0-23 — ura v dnevu, lokalno)
6. listingStrategy (FRESH_LISTING | CROSS_POST | PRICE_DROP_RELIST | BUNDLE_WITH_OTHER)
7. expectedSellTimeDays (1-60 — napoved dni do prodaje)
8. reasoning (1 stavek — zakaj ta strategija)

PRAVILA ZA STRATEGIJO:
- FRESH_LISTING: popolnoma nova objava z novim naslovom na isti ali drugi platformi
- CROSS_POST: objavi še na dodatni platformi (če je samo na 1)
- PRICE_DROP_RELIST: znižaj ceno + nov naslov za hitro prodajo (urgentni item-i)
- BUNDLE_WITH_OTHER: poveži s podobnim item-om v paket (če je nizka vrednost <100€)

URGENCY:
- CRITICAL (>30d) → PRICE_DROP_RELIST ali BUNDLE_WITH_OTHER
- HIGH (14-30d) → FRESH_LISTING ali CROSS_POST
- MEDIUM (7-14d brez zanimanja) → CROSS_POST

BEST TIME:
- Vikendi (Saturday, Sunday) 9-12h = peak traffic za Bolha/Vinted
- Delavnik 18-21h = after-work traffic

ITEMS:
${itemsBlock}

Odgovori LE z JSON:
{
  "plans": [
    {
      "tradeId": "<id>",
      "recommendedPlatform": "Bolha|Vinted|Facebook",
      "newTitle": "<string, max 70 chars>",
      "newPrice": <number>,
      "bestDayOfWeek": "Monday|...|Sunday",
      "bestHour": <0-23>,
      "listingStrategy": "FRESH_LISTING|CROSS_POST|PRICE_DROP_RELIST|BUNDLE_WITH_OTHER",
      "expectedSellTimeDays": <1-60>,
      "reasoning": "<1 stavek>"
    }
  ]
}${GROUNDING_PROMPT_SUFFIX}`;

    // 5) Call AI (with try/catch — fallback to deterministic plans)
    const plansByTradeId = new Map<string, AiRelistPlan>();
    let aiUsed = false;
    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as { plans?: AiRelistPlan[] } | null;
      if (parsed?.plans && Array.isArray(parsed.plans)) {
        for (const p of parsed.plans) {
          if (p?.tradeId) plansByTradeId.set(String(p.tradeId), p);
        }
        aiUsed = plansByTradeId.size > 0;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/auto-relisting-scheduler',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 6) Merge AI + deterministic plans with anti-hallucination validation
    const schedule: ScheduleItem[] = itemsNeedingRelist.map(item => {
      const ai = plansByTradeId.get(item.tradeId);
      const fallback = deterministicPlan(item);

      // Platform
      let recommendedPlatform = fallback.recommendedPlatform;
      const aiPlatformNorm = normalizePlatform(ai?.recommendedPlatform);
      if (aiPlatformNorm) recommendedPlatform = aiPlatformNorm;

      // Title — cap at 70 chars
      let newTitle = fallback.newTitle;
      if (ai?.newTitle && typeof ai.newTitle === 'string') {
        const trimmed = ai.newTitle.trim();
        if (trimmed.length > 0) {
          newTitle = trimmed.slice(0, 70);
        }
      }

      // Price — clamp to [0.5×, 1.2×] buyPrice
      const aiPriceClamped = ai?.newPrice != null ? clampPrice(ai.newPrice, item.buyPrice) : null;
      const newPrice = aiPriceClamped ?? fallback.newPrice;

      // Day of week
      let bestDayOfWeek = fallback.bestDayOfWeek;
      if (ai?.bestDayOfWeek && typeof ai.bestDayOfWeek === 'string') {
        const day = ai.bestDayOfWeek.trim();
        // Normalize: capitalize first letter
        const cap = day.charAt(0).toUpperCase() + day.slice(1).toLowerCase();
        if (DAYS_OF_WEEK.includes(cap)) bestDayOfWeek = cap;
      }

      // Hour
      let bestHour = fallback.bestHour;
      if (ai?.bestHour != null) {
        const h = Number(ai.bestHour);
        if (Number.isFinite(h) && h >= 0 && h <= 23) {
          bestHour = Math.round(h);
        }
      }

      // Strategy
      let listingStrategy = fallback.listingStrategy;
      if (ai?.listingStrategy && typeof ai.listingStrategy === 'string') {
        const s = ai.listingStrategy.toUpperCase();
        if (VALID_STRATEGIES.has(s)) listingStrategy = s as typeof listingStrategy;
      }

      // Expected sell time
      const aiExpClamped = ai?.expectedSellTimeDays != null ? clampExpectedDays(ai.expectedSellTimeDays) : null;
      const expectedSellTimeDays = aiExpClamped ?? fallback.expectedSellTimeDays;

      // Reasoning
      const reasoning = (ai?.reasoning && typeof ai.reasoning === 'string' && ai.reasoning.trim().length > 0)
        ? ai.reasoning.trim().slice(0, 240)
        : fallback.reasoning;

      return {
        tradeId: item.tradeId,
        title: item.title,
        currentTitle: item.title,
        daysHeld: item.daysHeld,
        currentPlatform: item.currentPlatform,
        urgency: item.urgency,
        listingPerformance: item.listingPerformance,
        recommendedPlatform,
        newTitle,
        newPrice,
        bestTimeToList: { dayOfWeek: bestDayOfWeek, hour: bestHour },
        listingStrategy,
        expectedSellTimeDays,
        reasoning,
      };
    });

    // 7) Sort by urgency (CRITICAL → HIGH → MEDIUM)
    const urgencyRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 } as const;
    schedule.sort(
      (a, b) =>
        urgencyRank[a.urgency] - urgencyRank[b.urgency] || b.daysHeld - a.daysHeld,
    );

    // 8) Summary
    const critical = schedule.filter(s => s.urgency === 'CRITICAL').length;
    const high = schedule.filter(s => s.urgency === 'HIGH').length;
    const medium = schedule.filter(s => s.urgency === 'MEDIUM').length;
    const estimatedRevenueIfRelisted = Math.round(
      schedule.reduce((s, i) => s + i.newPrice, 0),
    );
    // Estimated days to clear all items: max of expectedSellTimeDays (longest pole in tent)
    const estimatedDaysToClear = schedule.length > 0
      ? Math.max(...schedule.map(s => s.expectedSellTimeDays))
      : 0;

    const summary = {
      total: schedule.length,
      critical,
      high,
      medium,
      estimatedRevenueIfRelisted,
      estimatedDaysToClear,
    };

    const payload: CachedPayload = { schedule, summary, aiUsed };

    // 9) Cache the response (6h TTL)
    setCachedAI(cacheKey, payload);

    return NextResponse.json({ ok: true, ...payload });
  } catch (err: any) {
    logger.error('/api/ai/auto-relisting-scheduler', 'handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
