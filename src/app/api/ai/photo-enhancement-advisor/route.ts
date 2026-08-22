// v7.61 / v8.96.3-batch3: AI Photo Enhancement Advisor — za HELD inventar s slikami (imageUrl)
// AI svetuje izboljšave fotografij za večjo verjetnost prodaje: osvetlitev,
// ozadje, kot, kompozicija, staging, ali naj se ponovno poslika. Za vsak
// item generira: currentPhotoScore 0-100, improvements[] (aspect/issue/suggestion/impact),
// recommendedShots[], expectedSaleTimeReduction (dni), estimatedPriceUplift (€).
//
// "PS5 photo score 45/100 — slaba osvetlitev, dodaj naravno svetlobo.
//  Popravek: +15% šansa prodaje, +25€ višja cena"
//
// GET+POST /api/ai/photo-enhancement-advisor
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface PhotoEnhancementAdvisorInput {}

// --- Types ---------------------------------------------------------------

type PhotoAspect = 'LIGHTING' | 'BACKGROUND' | 'ANGLE' | 'COMPOSITION' | 'STAGING' | 'RETAKE';
type Impact = 'LOW' | 'MEDIUM' | 'HIGH';

interface Improvement {
  aspect: PhotoAspect;
  issue: string;
  suggestion: string;
  impact: Impact;
}

interface RecommendedShot {
  type: string;
  description: string;
}

interface PhotoAdviceItem {
  tradeId: string;
  title: string;
  category: string;
  imageUrl: string;
  buyPrice: number;
  aiEstimatedValue: number;
  currentPhotoScore: number;
  improvements: Improvement[];
  recommendedShots: RecommendedShot[];
  expectedSaleTimeReduction: number;
  estimatedPriceUplift: number;
  overallAdvice: string;
}

interface PhotoAdviceSummary {
  totalItems: number;
  itemsNeedingPhotos: number;
  avgPhotoScore: number;
  totalEstimatedUplift: number;
  bestPhotoTip: string;
}

interface HeldItemData {
  tradeId: string;
  title: string;
  category: string;
  imageUrl: string;
  buyPrice: number;
  aiEstimatedValue: number;
}

// AI response shape (loose)
interface AiImprovementRaw {
  aspect?: unknown;
  issue?: unknown;
  suggestion?: unknown;
  impact?: unknown;
}

interface AiShotRaw {
  type?: unknown;
  description?: unknown;
}

interface AiItemEntry {
  tradeId?: unknown;
  currentPhotoScore?: unknown;
  improvements?: unknown;
  recommendedShots?: unknown;
  expectedSaleTimeReduction?: unknown;
  estimatedPriceUplift?: unknown;
  overallAdvice?: unknown;
}

interface AiAdvisorResponse {
  items?: AiItemEntry[];
}

// --- Pure helpers (extracted OUTSIDE handler) ----------------------------

const VALID_ASPECTS: PhotoAspect[] = [
  'LIGHTING',
  'BACKGROUND',
  'ANGLE',
  'COMPOSITION',
  'STAGING',
  'RETAKE',
];
const VALID_IMPACTS: Impact[] = ['LOW', 'MEDIUM', 'HIGH'];

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

function clampScore(n: unknown, fallback: number): number {
  if (n == null) return Math.max(0, Math.min(100, fallback));
  let v = Number(n);
  if (!Number.isFinite(v)) v = fallback;
  v = Math.round(v);
  return Math.max(0, Math.min(100, v));
}

// Anti-hallucination: expectedSaleTimeReduction clamped to [0, 30]
function clampReduction(n: unknown, fallback: number): number {
  if (n == null) return Math.max(0, Math.min(30, fallback));
  let v = Number(n);
  if (!Number.isFinite(v)) v = fallback;
  v = Math.round(v);
  return Math.max(0, Math.min(30, v));
}

// Anti-hallucination: estimatedPriceUplift clamped to [0, estValue × 0.15]
function clampUplift(n: unknown, estValue: number, fallback: number): number {
  const max = Math.round(estValue * 0.15);
  if (n == null) return Math.max(0, Math.min(max, fallback));
  let v = Number(n);
  if (!Number.isFinite(v)) v = fallback;
  v = Math.round(v);
  return Math.max(0, Math.min(max, v));
}

function clampAspect(raw: unknown): PhotoAspect {
  const s = String(raw).toUpperCase().trim();
  if (VALID_ASPECTS.includes(s as PhotoAspect)) return s as PhotoAspect;
  return 'LIGHTING';
}

function clampImpact(raw: unknown): Impact {
  const s = String(raw).toUpperCase().trim();
  if (VALID_IMPACTS.includes(s as Impact)) return s as Impact;
  return 'MEDIUM';
}

function validateImprovements(raw: unknown): Improvement[] {
  if (!Array.isArray(raw)) return [];
  const out: Improvement[] = [];
  for (const r of raw) {
    if (r && typeof r === 'object') {
      const obj = r as AiImprovementRaw;
      const aspect = clampAspect(obj.aspect);
      const issue = clampString(obj.issue, 200, 'Slaba kakovost fotografije.');
      const suggestion = clampString(obj.suggestion, 240, 'Posnemi znova z boljšo osvetlitvijo.');
      const impact = clampImpact(obj.impact);
      out.push({ aspect, issue, suggestion, impact });
    }
    if (out.length >= 6) break;
  }
  return out;
}

function validateShots(raw: unknown): RecommendedShot[] {
  if (!Array.isArray(raw)) return [];
  const out: RecommendedShot[] = [];
  for (const r of raw) {
    if (r && typeof r === 'object') {
      const obj = r as AiShotRaw;
      const type = clampString(obj.type, 60, 'Glavna');
      const description = clampString(obj.description, 200, 'Glavna fotografija item-a.');
      out.push({ type, description });
    }
    if (out.length >= 5) break;
  }
  return out;
}

// Deterministic fallback for an item (when AI fails or didn't cover it)
function deterministicAdvice(item: HeldItemData): PhotoAdviceItem {
  // Generic advice — varies slightly by category
  const improvements: Improvement[] = [
    {
      aspect: 'LIGHTING',
      issue: 'Slaba osvetlitev — foto je predvsem temno ali preveč kontrastno.',
      suggestion: 'Posnemi ob dnevnem nagi ob veliki okni — naravna svetloba da najboljše rezultate.',
      impact: 'HIGH',
    },
    {
      aspect: 'BACKGROUND',
      issue: 'Neredno ali moteče ozadje odvrača od item-a.',
      suggestion: 'Uporabi čisto belo ali nevtralno ozadje (krpa ali bel list papirja).',
      impact: 'MEDIUM',
    },
    {
      aspect: 'ANGLE',
      issue: 'En sam kot ne pokaže celotnega item-a.',
      suggestion: 'Posnemi 3-5 kotov: spredaj, stransko, zadaj, od zgoraj, detail blizu.',
      impact: 'MEDIUM',
    },
  ];

  // Electronics → also suggest detail shot for serial/ports
  if (item.category === 'elektronika') {
    improvements.push({
      aspect: 'COMPOSITION',
      issue: 'Manjkajo detail posnetki priključkov, stanja ali serijske številke.',
      suggestion: 'Dodaj detail shot priključkov (USB/HDMI), stanja (prask) in paketa.',
      impact: 'HIGH',
    });
  }

  // Fashion → also suggest staging on body or hanger
  if (item.category === 'moda') {
    improvements.push({
      aspect: 'STAGING',
      issue: 'Item leži na mizi — kupec ne vidi kako izgleda nošena.',
      suggestion: 'Posnemi na modelu ali obešena na obešalniku za boljši prikaz.',
      impact: 'HIGH',
    });
  }

  // Score: deterministic 55 (slightly below average — improvement possible)
  const photoScore = 55;
  const uplift = clampUplift(null, item.aiEstimatedValue, Math.round(item.aiEstimatedValue * 0.08));

  return {
    tradeId: item.tradeId,
    title: item.title,
    category: item.category,
    imageUrl: item.imageUrl,
    buyPrice: Math.round(item.buyPrice),
    aiEstimatedValue: Math.round(item.aiEstimatedValue),
    currentPhotoScore: photoScore,
    improvements,
    recommendedShots: [
      { type: 'MAIN', description: 'Glavni posnetek — item centriran, dobra osvetlitev.' },
      { type: 'DETAIL', description: 'Detail posnetek stanja (prask, znaki uporabe).' },
      { type: 'SCALE', description: 'Posnetek z referenco velikosti (rokica, kovanec).' },
      { type: 'CONTEXT', description: 'Item v uporabi ali s paketom/priborom.' },
    ],
    expectedSaleTimeReduction: 7, // 1 week faster
    estimatedPriceUplift: uplift,
    overallAdvice: `Sedanja foto kakovost je zmerna (${photoScore}/100). Z boljšo osvetlitvijo, čistim ozadjem in dodatnimi koti lahko skrajšaš čas prodaje za ~7 dni in dvigneš ceno za ~${uplift}€.`,
  };
}

// Validate AI item entry — clamp all numeric fields, validate enums
function validateAiItem(
  raw: AiItemEntry | undefined,
  item: HeldItemData,
): PhotoAdviceItem {
  if (!raw) return deterministicAdvice(item);

  const fallback = deterministicAdvice(item);

  const currentPhotoScore = clampScore(raw.currentPhotoScore, 55);
  const improvements = validateImprovements(raw.improvements);
  const shots = validateShots(raw.recommendedShots);

  return {
    tradeId: item.tradeId,
    title: item.title,
    category: item.category,
    imageUrl: item.imageUrl,
    buyPrice: Math.round(item.buyPrice),
    aiEstimatedValue: Math.round(item.aiEstimatedValue),
    currentPhotoScore,
    improvements: improvements.length > 0 ? improvements : fallback.improvements,
    recommendedShots: shots.length > 0 ? shots : fallback.recommendedShots,
    expectedSaleTimeReduction: clampReduction(
      raw.expectedSaleTimeReduction,
      fallback.expectedSaleTimeReduction,
    ),
    estimatedPriceUplift: clampUplift(
      raw.estimatedPriceUplift,
      item.aiEstimatedValue,
      fallback.estimatedPriceUplift,
    ),
    overallAdvice: clampString(raw.overallAdvice, 360, fallback.overallAdvice),
  };
}

/** Map raw trade rows to HeldItemData items (with fallback estValue + imageUrl). */
function computeHeldItems(
  heldTrades: Array<{
    id: string;
    title: string;
    category: string | null;
    buyPrice: number;
    imageUrl: string | null;
    listing: { aiEstimatedValue: number | null; imageUrl: string | null } | null;
  }>,
): HeldItemData[] {
  return heldTrades.map(t => {
    const estValue =
      t.listing?.aiEstimatedValue && t.listing.aiEstimatedValue > 0
        ? t.listing.aiEstimatedValue
        : Math.round(t.buyPrice * 1.2);
    const imageUrl = (t.imageUrl || t.listing?.imageUrl || '').trim();
    return {
      tradeId: t.id,
      title: t.title,
      category: (t.category || 'drugo').trim().toLowerCase(),
      buyPrice: t.buyPrice,
      aiEstimatedValue: estValue,
      imageUrl,
    };
  });
}

/** Build items block for the AI prompt from aiSlice. */
function buildItemsBlock(aiSlice: HeldItemData[]): string {
  return aiSlice
    .map(
      (i, idx) =>
        `${idx + 1}. tradeId=${i.tradeId} | naslov="${i.title}" | kategorija=${i.category} | nabava=${i.buyPrice}€ | estValue=${i.aiEstimatedValue}€ | imageUrl=${i.imageUrl}`,
    )
    .join('\n');
}

/** Build the AI prompt with grounding suffix. */
function buildPrompt(aiSlice: HeldItemData[], itemsBlock: string, firstEstValue: number): string {
  return `Si profesionalni fotograf in e-commerce vizualni svetovalec za slovenske oglasne platforme (Bolha, Vinted, mobile.de, Kleinanzeigen).
Predlagaj izboljšave fotografij za naslednje HELD item-e da povečaš verjetnost in ceno prodaje.

HELD ITEMI S SLIKAMI (${aiSlice.length}):
${itemsBlock}

NALOGA:
Za vsak item določi:
1. currentPhotoScore: 0-100 — tvoja ocena kakovosti obstoječe slike (na podlagi kategorije inimageUrl konteksta — višje če je naslov določen, nižje če je naslov generičen)
2. improvements[]: 2-5 konkretnih izboljšanj:
   - aspect: LIGHTING | BACKGROUND | ANGLE | COMPOSITION | STAGING | RETAKE
   - issue: kaj je narobe (1 stavek)
   - suggestion: kako popraviti (1-2 stavka v slovenščini)
   - impact: LOW | MEDIUM | HIGH (koliko bo izboljšal verjetnost prodaje)
3. recommendedShots[]: 3-5 dodatnih posnetkov za optimalen oglas (MAIN, DETAIL, SCALE, CONTEXT, ...)
4. expectedSaleTimeReduction: število dni hitrejše prodaje (0-30)
5. estimatedPriceUplift: EUR — za koliko se bo dvignila cena (0 do ${Math.round(firstEstValue * 0.15)}€, max estValue × 0.15)
6. overallAdvice: 1-2 stavka povzetka v slovenščini

PRAVILA:
- NE izmišljaj cene ali prodaj, ki jih ni v kontekstu.
- expectedSaleTimeReduction mora biti med 0 in 30 dni.
- estimatedPriceUplift mora biti med 0 in estValue × 0.15 (realen dobiček od boljših foto).
- Vsak improvement mora biti specifičen za kategorijo (moda → staging na modelu; elektronika → detail priključkov; avto → več kotov).
- currentPhotoScore 0-100, ne pretiravaj z nizkimi/nizkimi ocenami brez razloga.

Odgovori LE z JSON:
{
  "items": [
    {
      "tradeId": "<id>",
      "currentPhotoScore": <0-100>,
      "improvements": [
        { "aspect": "LIGHTING", "issue": "...", "suggestion": "...", "impact": "HIGH" }
      ],
      "recommendedShots": [
        { "type": "MAIN", "description": "..." }
      ],
      "expectedSaleTimeReduction": <0-30>,
      "estimatedPriceUplift": <eur>,
      "overallAdvice": "<1-2 stavka>"
    }
  ]
}${GROUNDING_PROMPT_SUFFIX}`;
}

/** Compute summary from advice items. */
function computeSummary(advices: PhotoAdviceItem[]): PhotoAdviceSummary {
  let totalScore = 0;
  let totalUplift = 0;
  let itemsNeedingPhotos = 0;
  for (const a of advices) {
    totalScore += a.currentPhotoScore;
    totalUplift += a.estimatedPriceUplift;
    // Items needing photos = score < 70 (below average)
    if (a.currentPhotoScore < 70) itemsNeedingPhotos += 1;
  }
  const avgPhotoScore = advices.length > 0 ? Math.round(totalScore / advices.length) : 0;

  // bestPhotoTip: pick the most common improvement aspect across all items
  const aspectCount: Record<string, number> = {};
  for (const a of advices) {
    for (const imp of a.improvements) {
      aspectCount[imp.aspect] = (aspectCount[imp.aspect] || 0) + 1;
    }
  }
  const bestAspect = Object.entries(aspectCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'LIGHTING';
  const bestPhotoTip =
    bestAspect === 'LIGHTING'
      ? 'Za vse item-e: posnemi ob dnevnem nagi ob veliki okni — naravna svetloba da najboljše rezultate.'
      : bestAspect === 'BACKGROUND'
        ? 'Za vse item-e: uporabi čisto belo ali nevtralno ozadje (krpa ali bel list papirja).'
        : bestAspect === 'ANGLE'
          ? 'Za vse item-e: posnemi 3-5 kotov — spredaj, stransko, zadaj, od zgoraj, detail blizu.'
          : bestAspect === 'COMPOSITION'
            ? 'Za vse item-e: item naj bo centriran in zasedaj vsaj 60% slike.'
            : bestAspect === 'STAGING'
              ? 'Za vse item-e: prikaži item v realni uporabi ali s paketom za boljši prikaz.'
              : 'Za vse item-e: ponovno posnetje z boljšo osvetlitvijo in ozadjem priporočeno.';

  return {
    totalItems: advices.length,
    itemsNeedingPhotos,
    avgPhotoScore,
    totalEstimatedUplift: Math.round(totalUplift),
    bestPhotoTip,
  };
}

// --- Handler -------------------------------------------------------------

const photoEnhancementAdvisorHandler = withAiRoute<PhotoEnhancementAdvisorInput>({
  endpoint: '/api/ai/photo-enhancement-advisor',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    // 1) HELD trades with linked Listing (only items WITH imageUrl)
    const heldTrades = await db.trade.findMany({
      where: {
        status: 'held',
        OR: [
          { imageUrl: { not: null } },
          { listing: { imageUrl: { not: null } } },
        ],
      },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        imageUrl: true,
        listing: {
          select: {
            aiEstimatedValue: true,
            imageUrl: true,
          },
        },
      },
      take: 100,
    });

    // Graceful: no held items with images
    if (heldTrades.length === 0) {
      return apiOk({
        ok: true,
        items: [],
        summary: {
          totalItems: 0,
          itemsNeedingPhotos: 0,
          avgPhotoScore: 0,
          totalEstimatedUplift: 0,
          bestPhotoTip: '',
        },
        aiUsed: false,
        message: 'Ni held item-ov s slikami — najprej dodaj slike k item-om.',
      });
    }

    const items = computeHeldItems(heldTrades);

    // 2) AI cache — keyed by held item IDs (deterministic per portfolio)
    const sortedIds = items.map(i => i.tradeId).sort().join(',');
    const cacheKey = `photo-enhancement-advisor:${JSON.stringify(sortedIds)}`;
    const cached = getCachedAI<{ items: PhotoAdviceItem[]; summary: PhotoAdviceSummary }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        ...cached,
        cached: true,
        aiUsed: true,
      });
    }

    // 3) Build AI prompt with grounding
    // Cap to 30 items for AI prompt (deterministic fallback for the rest)
    const aiSlice = items.slice(0, 30);
    const itemsBlock = buildItemsBlock(aiSlice);
    const firstEstValue = items[0]?.aiEstimatedValue ?? 0;
    const prompt = buildPrompt(aiSlice, itemsBlock, firstEstValue);

    let aiUsed = false;
    const advices: PhotoAdviceItem[] = [];
    const itemById = new Map<string, HeldItemData>(aiSlice.map(i => [i.tradeId, i]));

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiAdvisorResponse | null;
      if (parsed && Array.isArray(parsed.items)) {
        for (const rawItem of parsed.items) {
          const tid = String(rawItem.tradeId || '').trim();
          const matched = itemById.get(tid);
          if (!matched) continue;
          advices.push(validateAiItem(rawItem, matched));
        }
        if (advices.length > 0) aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/photo-enhancement-advisor',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 4) Deterministic fallback for items AI didn't cover (including items beyond aiSlice)
    const seenIds = new Set(advices.map(a => a.tradeId));
    for (const item of items) {
      if (!seenIds.has(item.tradeId)) {
        advices.push(deterministicAdvice(item));
      }
    }

    // 5) Compute summary
    const summary = computeSummary(advices);

    // 6) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { items: advices, summary });
    }

    return apiOk({
      ok: true,
      items: advices,
      summary,
      aiUsed,
    });
  },
});

export const GET = photoEnhancementAdvisorHandler;
export const POST = photoEnhancementAdvisorHandler;
