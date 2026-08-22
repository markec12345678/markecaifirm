// v7.66 / v8.96.3-batch4: FOMO/Scarcity Trigger Generator — AI generira FOMO (Fear Of Missing Out)
// in scarcity messaging za held inventar listings da poveča konverzijo.
// Ustvari urgency-driven listing text additions (slovensko).
//
// "PS5 (redko) → 'Redko najdenje! Samo 3 podobni oglasi na Bolhi.' Critical
//  urgency, +25% conversion lift, scarcity=RARE_FIND."
//
// Razlika od listing-emotional-trigger (ki generira čustvene sprožilce za
// POSAMEZEN oglas za vse listeče) — ta je specifično za HELD inventar in
// vključuje expectedConversionLift (%) in scarcityType klasifikacijo.
// Razlika od listing-conversion-optimizer (ki optimira konverzijo z A/B
// testiranjem naslovov) — ta dodaja SCARCITY/FOMO besedilo specifično za
// urgency. Razlika od listing-velocity (ki analizira hitrost prodaje) — ta
// GENERIRA akcijsko besedilo za pospešitev prodaje.
//
// GET+POST /api/ai/fomo-scarcity-generator
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.3) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface FomoScarcityInput {}

// --- Types ---------------------------------------------------------------

type UrgencyLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type ScarcityType =
  | 'TIME_LIMITED'
  | 'QUANTITY_LIMITED'
  | 'SEASONAL'
  | 'RARE_FIND';

interface FomoItem {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  daysHeld: number;
  urgencyLevel: UrgencyLevel;
  scarcityType: ScarcityType;
  fomoPhrases: string[];
  listingAddition: string;
  callToAction: string;
  psychologicalHook: string;
  expectedConversionLift: number; // %
}

interface AiFomoItemResponse {
  sellerName?: string;
  title?: string;
  tradeId?: string;
  urgencyLevel?: unknown;
  scarcityType?: unknown;
  fomoPhrases?: unknown;
  listingAddition?: unknown;
  callToAction?: unknown;
  psychologicalHook?: unknown;
  expectedConversionLift?: unknown;
}

interface AiFomoResponse {
  items?: unknown;
  summary?: unknown;
  bestPractices?: unknown;
}

interface TradeMeta {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  daysHeld: number;
  similarListingsCount: number;
  isSeasonal: boolean;
  isRare: boolean;
  estValue: number;
}

// --- Helpers -------------------------------------------------------------

const VALID_URGENCY: readonly UrgencyLevel[] = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const;
const VALID_SCARCITY: readonly ScarcityType[] = [
  'TIME_LIMITED',
  'QUANTITY_LIMITED',
  'SEASONAL',
  'RARE_FIND',
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

function clampStringArray(
  raw: unknown,
  maxItems: number,
  maxItemLen: number,
  fallback: string[],
): string[] {
  if (!Array.isArray(raw)) return fallback.slice(0, maxItems);
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim().length > 0) {
      out.push(item.trim().slice(0, maxItemLen));
      if (out.length >= maxItems) break;
    }
  }
  return out.length > 0 ? out : fallback.slice(0, maxItems);
}

// --- Deterministic fallback -----------------------------------------------

const GENERIC_FOMO_PHRASES_LOW = [
  'Zanimiv kos — poglej si ga!',
  'Dobro ohranjeno, pripravljeno za nov lastnik.',
];
const GENERIC_FOMO_PHRASES_MEDIUM = [
  'Oglasi podobnih item-ov izginjajo hitro!',
  'Ne zamudi priložnosti — poglej danes.',
];
const GENERIC_FOMO_PHRASES_HIGH = [
  'Zadnji na zalogi! Ne čakaj — piši zdaj.',
  'Samo še danes na tem naslovu — kontaktiraj takoj.',
];
const GENERIC_FOMO_PHRASES_CRITICAL = [
  'ZADNJI KOS! Samo še danes razpoložljiv.',
  'Redko najdenje — ne ponovi se kmalu. Piši zdaj!',
  'Samo 24 ur od objave — kontaktiraj takoj, drugače zamudiš.',
];

function deterministicUrgency(
  daysHeld: number,
  similarListingsCount: number,
  isSeasonal: boolean,
  isRare: boolean,
): UrgencyLevel {
  // Critical: rare find OR held >60 days (need urgent sale) OR no competition
  if (isRare || daysHeld > 60) return 'CRITICAL';
  // High: held >30 days OR very few similar listings OR seasonal peak
  if (daysHeld > 30 || (similarListingsCount > 0 && similarListingsCount <= 2) || isSeasonal) {
    return 'HIGH';
  }
  // Medium: held >14 days or moderate competition
  if (daysHeld > 14) return 'MEDIUM';
  return 'LOW';
}

function deterministicScarcityType(
  daysHeld: number,
  similarListingsCount: number,
  isSeasonal: boolean,
  isRare: boolean,
): ScarcityType {
  if (isRare) return 'RARE_FIND';
  if (isSeasonal) return 'SEASONAL';
  if (daysHeld > 45) return 'TIME_LIMITED'; // urgent sale
  if (similarListingsCount > 0 && similarListingsCount <= 3) {
    return 'QUANTITY_LIMITED';
  }
  return 'TIME_LIMITED';
}

function deterministicExpectedLift(urgency: UrgencyLevel): number {
  switch (urgency) {
    case 'CRITICAL':
      return 35;
    case 'HIGH':
      return 22;
    case 'MEDIUM':
      return 12;
    case 'LOW':
    default:
      return 5;
  }
}

function deterministicListingAddition(
  title: string,
  urgency: UrgencyLevel,
  scarcityType: ScarcityType,
  similarListingsCount: number,
): string {
  const parts: string[] = [];
  if (scarcityType === 'RARE_FIND') {
    parts.push(
      `${title} je redko najdenje na trgu — podobnih oglasov je trenutno samo ${similarListingsCount}.`,
    );
  } else if (scarcityType === 'QUANTITY_LIMITED') {
    parts.push(
      `Na voljo je samo ta en kos — podobnih oglasov je le ${similarListingsCount}.`,
    );
  } else if (scarcityType === 'SEASONAL') {
    parts.push('Sezonska priložnost — cene se običajno dvignejo v naslednjem obdobju.');
  } else {
    parts.push('Oglas je aktiven omejen čas — kontaktiraj čim prej.');
  }
  if (urgency === 'CRITICAL') {
    parts.push('Zadnji kos — ne zamudi priložnosti!');
  } else if (urgency === 'HIGH') {
    parts.push('Hitro se odloči — podobni oglasi izginejo hitro.');
  }
  return parts.join(' ');
}

function deterministicCallToAction(urgency: UrgencyLevel): string {
  switch (urgency) {
    case 'CRITICAL':
      return 'Piši zdaj, preden je prepozno!';
    case 'HIGH':
      return 'Kontaktiraj danes — količina je omejena.';
    case 'MEDIUM':
      return 'Pošlji sporočilo za več info.';
    case 'LOW':
    default:
      return 'Zanimiv te? Pošlji sporočilo.';
  }
}

function deterministicPsychologicalHook(
  scarcityType: ScarcityType,
  urgency: UrgencyLevel,
): string {
  if (scarcityType === 'RARE_FIND') return 'Redkost (scarcity principle)';
  if (scarcityType === 'QUANTITY_LIMITED') return 'Omejena količina (scarcity)';
  if (scarcityType === 'SEASONAL') return 'Sezonska urgentnost (timing)';
  if (urgency === 'CRITICAL') return 'Time-limited urgency (loss aversion)';
  return 'Mehka urgentnost (curiosity)';
}

function buildDeterministicFomo(
  tradeId: string,
  title: string,
  category: string,
  buyPrice: number,
  daysHeld: number,
  similarListingsCount: number,
  isSeasonal: boolean,
  isRare: boolean,
): FomoItem {
  const urgency = deterministicUrgency(daysHeld, similarListingsCount, isSeasonal, isRare);
  const scarcityType = deterministicScarcityType(
    daysHeld,
    similarListingsCount,
    isSeasonal,
    isRare,
  );
  let fomoPhrases: string[];
  if (urgency === 'CRITICAL') fomoPhrases = GENERIC_FOMO_PHRASES_CRITICAL;
  else if (urgency === 'HIGH') fomoPhrases = GENERIC_FOMO_PHRASES_HIGH;
  else if (urgency === 'MEDIUM') fomoPhrases = GENERIC_FOMO_PHRASES_MEDIUM;
  else fomoPhrases = GENERIC_FOMO_PHRASES_LOW;
  return {
    tradeId,
    title,
    category,
    buyPrice,
    daysHeld,
    urgencyLevel: urgency,
    scarcityType,
    fomoPhrases,
    listingAddition: deterministicListingAddition(
      title,
      urgency,
      scarcityType,
      similarListingsCount,
    ),
    callToAction: deterministicCallToAction(urgency),
    psychologicalHook: deterministicPsychologicalHook(scarcityType, urgency),
    expectedConversionLift: deterministicExpectedLift(urgency),
  };
}

// --- Similar listings counter (čisti helper) ----------------------------

interface RecentListingRow {
  id: string;
  title: string;
  price: number | null;
  monitor: { name: string | null } | null;
}

function countSimilarListings(
  recentListings: RecentListingRow[],
  tradeTitle: string,
  tradeMonitorName: string,
  estValue: number,
): number {
  const lowerBound = estValue * 0.7;
  const upperBound = estValue * 1.3;
  const tradeTitleLower = tradeTitle.toLowerCase().slice(0, 10);
  return recentListings.filter(l => {
    const lMonitor = l.monitor?.name ?? 'drugo';
    if (lMonitor !== tradeMonitorName && l.title.toLowerCase().indexOf(tradeTitleLower) === -1) {
      return false;
    }
    if (l.price == null) return false;
    return l.price >= lowerBound && l.price <= upperBound;
  }).length;
}

// --- Prompt builder + summary (čisti helperji) --------------------------

function buildPrompt(tradeMeta: TradeMeta[]): string {
  const itemsForAi = tradeMeta.slice(0, 50);
  const itemBlock = itemsForAi
    .map(
      (m, i) =>
        `${i + 1}. id=${m.tradeId} | "${m.title}" | kategorija=${m.category} | buyPrice=${m.buyPrice}€ | estValue=${m.estValue}€ | daysHeld=${m.daysHeld} | similarListings=${m.similarListingsCount} | seasonal=${m.isSeasonal} | rare=${m.isRare}`,
    )
    .join('\n');

  return `Si AI copywriter za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Generiraj FOMO (Fear Of Missing Out) in scarcity messaging za HELD inventar da povečaš konverzijo (inquiry rate).
Za vsak item glede na dejansko redkost, dve dni na zalogi in konkurenco na trgu določi urgency in generiraj slovensko besedilo.

HELD INVENTAR (${itemsForAi.length} item-ov):
${itemBlock}

PRAVILA ZA FOMO MESSAGING:
1. Za vsak item določi:
   - urgencyLevel: LOW (sveže/običajno), MEDIUM (zadržan >14 dni ali malo konkurence), HIGH (>30 dni ali redko), CRITICAL (>60 dni ali RARE_FIND)
   - scarcityType: RARE_FIND (≤3 podobni oglasi), QUANTITY_LIMITED (1 kos na voljo), SEASONAL (v sezoni), TIME_LIMITED (urgentna prodaja)
   - fomoPhrases: 3-5 slovenskih fraz ki ustvarijo urgentnost (npr. "Zadnji na zalogi!", "Samo 2 dneva do konca akcije", "Redko najdenje!")
   - listingAddition: 1-2 povedi slovensko, dodane k obstoječemu opisu oglasa (max 200 znakov)
   - callToAction: specifičen CTA (npr. "Piši zdaj, preden je prepozno!")
   - psychologicalHook: glavni psihološki sprožilec (scarcity, urgency, social proof, loss aversion)
   - expectedConversionLift: 0-50% (koliko se bo povpraševanje povečalo)
2. Sporočila morajo biti resnična in utemeljena z dejanskimi podatki (similarListings count, daysHeld).
3. NE izmišljaj ponarejenih nizkih zalog ali lažnih časovnih omejitev — utemelji na dejanski redkosti.

VRNI LE JSON:
{
  "items": [
    { "tradeId": "abc", "urgencyLevel": "HIGH", "scarcityType": "RARE_FIND", "fomoPhrases": ["Redko najdenje!", "Samo 3 podobni oglasi"], "listingAddition": "...", "callToAction": "Piši zdaj!", "psychologicalHook": "Scarcity principle", "expectedConversionLift": 25 }
  ],
  "summary": { "bestPractices": ["Uporabi konkretne številke...", "NI pretiravanja — lažna redkost zmanjša zaupanje"] }
}${GROUNDING_PROMPT_SUFFIX}`;
}

interface FomoSummary {
  totalItems: number;
  criticalCount: number;
  highUrgencyCount: number;
  avgExpectedLift: number;
  bestPractices: string[];
}

const DEFAULT_BEST_PRACTICES: string[] = [
  'FOMO messaging deluje najbolje z dejanskimi številkami (npr. "samo 3 podobni oglasi" namesto "redko").',
  'Nikoli ne pretiravaj redkosti — kupci prepoznajo lažno urgentnost in izgubijo zaupanje.',
  'Kombiniraj time-limited in quantity-limited sporočila za maksimalen učinek.',
  'Testiraj različne CTA-je — Piši zdaj deluje bolje kot Kontakt.',
];

function buildSummary(items: FomoItem[], bestPractices: string[]): FomoSummary {
  const criticalCount = items.filter(i => i.urgencyLevel === 'CRITICAL').length;
  const highUrgencyCount = items.filter(i => i.urgencyLevel === 'HIGH').length;
  const avgExpectedLift =
    items.length > 0
      ? Math.round(
          items.reduce((s, i) => s + i.expectedConversionLift, 0) /
            items.length,
        )
      : 0;
  return {
    totalItems: items.length,
    criticalCount,
    highUrgencyCount,
    avgExpectedLift,
    bestPractices,
  };
}

// --- Merge AI items over deterministic ones (čisti helper) ----------------

function mergeAiIntoFomoItems(
  detItems: FomoItem[],
  tradeMeta: TradeMeta[],
  parsed: unknown,
): { items: FomoItem[]; bestPractices: string[]; aiUsed: boolean } {
  const raw = parsed as AiFomoResponse | null;
  if (!raw) {
    return { items: detItems, bestPractices: DEFAULT_BEST_PRACTICES, aiUsed: false };
  }

  let bestPractices = DEFAULT_BEST_PRACTICES;
  let aiUsed = false;

  // Parse AI items — map by tradeId
  const aiItemsMap = new Map<string, AiFomoItemResponse>();
  if (Array.isArray(raw.items)) {
    for (const item of raw.items) {
      const a = item as AiFomoItemResponse;
      if (a && typeof a === 'object' && typeof a.tradeId !== 'undefined') {
        const id = String(a.tradeId ?? '').trim();
        if (id) aiItemsMap.set(id, a);
      }
    }
  }

  // Merge AI items over deterministic ones (preserving order)
  const merged: FomoItem[] = [];
  for (const det of detItems) {
    const ai = aiItemsMap.get(det.tradeId);
    if (ai) {
      // Use AI values, validated + clamped
      const detForItem = detItems.find(d => d.tradeId === det.tradeId)!;
      const meta = tradeMeta.find(m => m.tradeId === det.tradeId)!;
      const detUrgency = deterministicUrgency(meta.daysHeld, meta.similarListingsCount, meta.isSeasonal, meta.isRare);
      const detScarcity = deterministicScarcityType(meta.daysHeld, meta.similarListingsCount, meta.isSeasonal, meta.isRare);
      merged.push({
        tradeId: det.tradeId,
        title: det.title,
        category: det.category,
        buyPrice: det.buyPrice,
        daysHeld: det.daysHeld,
        urgencyLevel: clampEnum(ai.urgencyLevel, VALID_URGENCY, detUrgency),
        scarcityType: clampEnum(ai.scarcityType, VALID_SCARCITY, detScarcity),
        fomoPhrases: clampStringArray(ai.fomoPhrases, 5, 120, detForItem.fomoPhrases),
        listingAddition: clampString(ai.listingAddition, 200, detForItem.listingAddition),
        callToAction: clampString(ai.callToAction, 120, detForItem.callToAction),
        psychologicalHook: clampString(ai.psychologicalHook, 120, detForItem.psychologicalHook),
        expectedConversionLift: clampNumber(
          ai.expectedConversionLift,
          0,
          50,
          deterministicExpectedLift(detUrgency),
        ),
      });
    } else {
      merged.push(det);
    }
  }

  // Parse best practices from AI summary
  if (raw.summary && typeof raw.summary === 'object') {
    const s = raw.summary as Record<string, unknown>;
    if (Array.isArray(s.bestPractices)) {
      const aiBp = s.bestPractices
        .filter((bp): bp is string => typeof bp === 'string' && bp.trim().length > 0)
        .map(bp => bp.trim().slice(0, 200))
        .slice(0, 5);
      if (aiBp.length > 0) bestPractices = aiBp;
    }
  }

  aiUsed = true;
  return { items: merged, bestPractices, aiUsed };
}

// --- Handler -------------------------------------------------------------

const fomoScarcityHandler = withAiRoute<FomoScarcityInput>({
  endpoint: '/api/ai/fomo-scarcity-generator',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — body ignored
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    const now = Date.now();
    const dayMs = 86_400_000;

    // 1) Query all HELD trades with their linked Listing (for title, category, price)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyDate: true,
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            monitor: { select: { name: true, source: true } },
          },
        },
      },
      take: 500,
    });

    // Empty state
    if (heldTrades.length === 0) {
      return apiOk({
        ok: true,
        items: [],
        summary: {
          totalItems: 0,
          criticalCount: 0,
          highUrgencyCount: 0,
          avgExpectedLift: 0,
          bestPractices: [
            'FOMO/scarcity messaging se generira ko imaš held inventar — dodaj svoj prvi trade.',
            'Splošno pravilo: bolj ko je item redčen ali dlje časa na zalogi, višja urgency.',
          ],
        },
        aiUsed: false,
        message:
          'Ni held trade-ov — FOMO/Scarcity Generator potrebuje held inventar za generiranje messaging-a.',
      });
    }

    // 2) For each held trade, gather market context: count similar listings
    // (in same monitor/category, last 30 days, similar title keywords)
    const cutoff = new Date(now - 30 * dayMs);
    // Get all listings in last 30 days to compute similarity counts
    const recentListings = await db.listing.findMany({
      where: {
        isHidden: false,
        firstSeenAt: { gte: cutoff },
      },
      select: {
        id: true,
        title: true,
        price: true,
        monitor: { select: { name: true } },
      },
      take: 10000,
    });

    // Compute similarity count per trade: listings in same monitor + price range ±30%
    const detItems: FomoItem[] = [];
    const tradeMeta: TradeMeta[] = [];

    // Seasonal check: simple heuristic — current month peak seasons
    const month = new Date(now).getMonth(); // 0-11
    const seasonalCategories = new Set(['elektronika', 'moda', 'sport', 'igrače', 'avto']);
    const peakSeasonalMonths = new Set([10, 11, 0]); // Nov, Dec, Jan (gift season)

    for (const t of heldTrades) {
      const daysHeld = Math.max(
        0,
        Math.round((now - t.buyDate.getTime()) / dayMs),
      );
      const monitorName = t.listing?.monitor?.name ?? 'drugo';
      const category = (t.category || monitorName || 'drugo').trim().toLowerCase() || 'drugo';
      // Estimated value = use linked listing.price if available, else buyPrice × 1.3 (assume 30% markup target)
      const estValue = t.listing?.price ?? Math.round(t.buyPrice * 1.3);

      // Count similar listings: same monitor, price within ±30% of estValue
      const similarListingsCount = countSimilarListings(
        recentListings as RecentListingRow[],
        t.title,
        monitorName,
        estValue,
      );

      // Seasonal: current month is peak season AND category is seasonal
      const isSeasonal =
        peakSeasonalMonths.has(month) && seasonalCategories.has(category);

      // Rare: very few similar listings (≤ 3)
      const isRare = similarListingsCount <= 3;

      const det = buildDeterministicFomo(
        t.id,
        t.title,
        category,
        t.buyPrice,
        daysHeld,
        similarListingsCount,
        isSeasonal,
        isRare,
      );
      detItems.push(det);
      tradeMeta.push({
        tradeId: t.id,
        title: t.title,
        category,
        buyPrice: t.buyPrice,
        daysHeld,
        similarListingsCount,
        isSeasonal,
        isRare,
        estValue,
      });
    }

    // 3) AI cache — keyed by held item ids
    const heldItemIds = heldTrades.map(t => t.id).sort();
    const cacheKey = `fomo-scarcity:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<{
      items: FomoItem[];
      summary: FomoSummary;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        items: cached.items,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 4) AI prompt with grounding + call AI (try/catch z graceful fallback)
    const prompt = buildPrompt(tradeMeta);

    let items: FomoItem[] = detItems;
    let bestPractices: string[] = DEFAULT_BEST_PRACTICES;
    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const result = mergeAiIntoFomoItems(detItems, tradeMeta, parseAi(raw));
      items = result.items;
      bestPractices = result.bestPractices;
      aiUsed = result.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/fomo-scarcity-generator',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Compute summary
    const summary = buildSummary(items, bestPractices);

    // 6) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { items, summary });
    }

    return apiOk({
      ok: true,
      items,
      summary,
      aiUsed,
    });
  },
});

export const GET = fomoScarcityHandler;
export const POST = fomoScarcityHandler;
