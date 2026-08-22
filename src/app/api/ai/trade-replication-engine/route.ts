// v7.62 / v8.96.3-batch4: Trade Replication Engine — AI analizira tvoje najbolj USPEŠNE past
// trades (highest ROI) in predlaga NOVE search monitorje, ki bi replicirali
// te winning pattern-e. "PS5 35% ROI → Bolha monitor 'PS5 Digital < 300€'".
//
// Razlika od reinvestment-advisor (ki svetuje KATEGORIJE) — ta konkretno
// predlaga monitor konfiguracije (platform, keywords, price range) za vsak
// winner.
//
// GET+POST /api/ai/trade-replication-engine
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.3) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface TradeReplicationInput {
  limit: number;
}

// --- Types ---------------------------------------------------------------

interface WinnerTrade {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  sellPrice: number;
  profit: number;
  roi: number; // percent
  holdDays: number;
  source: string;
  keywords: string[];
}

interface ReplicationSuggestion {
  basedOnTradeId: string;
  monitorName: string;
  platform: string;
  searchKeywords: string[];
  priceMin: number;
  priceMax: number;
  expectedROI: number; // percent
  expectedProfit: number; // EUR
  categoryFocus: string;
  confidenceScore: number; // 0-100
  reasoning: string;
}

interface AiSuggestionEntry {
  basedOnTradeId?: unknown;
  monitorName?: unknown;
  platform?: unknown;
  searchKeywords?: unknown;
  priceMin?: unknown;
  priceMax?: unknown;
  expectedROI?: unknown;
  expectedProfit?: unknown;
  categoryFocus?: unknown;
  confidenceScore?: unknown;
  reasoning?: unknown;
}

interface AiReplicationResponse {
  suggestions?: AiSuggestionEntry[];
}

// --- Helpers -------------------------------------------------------------

const KNOWN_BRANDS = [
  'apple', 'iphone', 'samsung', 'galaxy', 'huawei', 'xiaomi', 'sony',
  'playstation', 'ps5', 'ps4', 'ps3', 'xbox', 'nintendo', 'switch',
  'lg', 'bosch', 'makita', 'dewalt', 'ikea', 'lego', 'nike', 'adidas',
  'vw', 'volkswagen', 'audi', 'bmw', 'mercedes', 'ford', 'renault',
  'peugeot', 'opel', 'citroen', 'fiat', 'toyota', 'mazda', 'honda',
  'yamaha', 'kawasaki', 'canon', 'nikon', 'fujifilm', 'gopro',
  'dyson', 'philips', 'braun', 'roomba', 'irobot', 'kindle', 'amazon',
];

const STOP_WORDS = new Set([
  'in', 'na', 'za', 'ali', 'ali', 'do', 'od', 'po', 'z', 's', 'v', 'k',
  'the', 'and', 'for', 'to', 'of', 'with', 'from', 'on', 'a', 'an',
  'rabljeno', 'novo', 'polovno', 'uporabljeno', 'dobro', 'stanje',
  'berlin', 'ljubljana', 'maribor', 'prodaja', 'kupim', 'ponujam',
]);

// Extract keywords from title — brand + model + key terms (3-5 keywords)
function extractKeywords(title: string): string[] {
  const clean = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];

  const words = clean.split(' ').filter(w => w.length >= 2 && !STOP_WORDS.has(w));
  const keywords: string[] = [];
  const seen = new Set<string>();

  // 1) Add known brands first (max 2)
  for (const brand of KNOWN_BRANDS) {
    if (clean.includes(brand) && !seen.has(brand)) {
      keywords.push(brand);
      seen.add(brand);
      if (keywords.length >= 2) break;
    }
  }

  // 2) Add other significant words (model / variant / spec)
  for (const w of words) {
    if (seen.has(w)) continue;
    // Skip pure numbers unless they look like model numbers (e.g. "13", "5", "s22")
    if (/^\d+$/.test(w) && w.length > 3) continue;
    keywords.push(w);
    seen.add(w);
    if (keywords.length >= 5) break;
  }

  return keywords.slice(0, 5);
}

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

function clampNumber(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw == null) return Math.max(min, Math.min(max, fallback));
  let v = Number(raw);
  if (!Number.isFinite(v)) v = fallback;
  v = Math.round(v);
  return Math.max(min, Math.min(max, v));
}

function validateKeywords(raw: unknown, fallback: string[]): string[] {
  let arr: string[] = [];
  if (Array.isArray(raw)) {
    for (const t of raw) {
      if (typeof t === 'string' && t.trim()) arr.push(t.trim().slice(0, 40));
      if (arr.length >= 5) break;
    }
  }
  if (arr.length === 0) arr = fallback.slice(0, 5);
  return arr;
}

function validatePlatform(raw: unknown, fallback: string): string {
  const s = String(raw).toLowerCase().trim();
  // Acceptable platform names (case-insensitive)
  const valid = [
    'bolha', 'vinted', 'facebook', 'mobile.de', 'mobilede',
    'kleinanzeigen', 'avtonet', 'salomon', 'nepremicnine',
    'subito', 'willhaben',
  ];
  if (valid.includes(s)) {
    if (s === 'mobilede') return 'mobile.de';
    return s;
  }
  return fallback;
}

// Build deterministic monitor name (used as fallback)
function buildMonitorName(winner: WinnerTrade, platform: string): string {
  const keywords = winner.keywords.length > 0 ? winner.keywords.slice(0, 2) : [winner.title.split(' ')[0] || 'Item'];
  const maxPrice = Math.round(winner.buyPrice * 1.1);
  return `${keywords.join(' ')} ${platform} < ${maxPrice}€`.slice(0, 80);
}

// Pick a platform based on winner's source or category
function pickPlatform(winner: WinnerTrade): string {
  const src = (winner.source || '').toLowerCase();
  if (src.includes('vinted')) return 'vinted';
  if (src.includes('mobile') || src.includes('mobile-de')) return 'mobile.de';
  if (src.includes('kleinanzeigen')) return 'kleinanzeigen';
  if (src.includes('facebook') || src.includes('fb')) return 'facebook';
  if (src.includes('avtonet') || winner.category === 'avto') return 'avtonet';
  if (src.includes('salomon')) return 'salomon';
  // Default by category
  if (winner.category === 'moda' || winner.category === 'oblačila') return 'vinted';
  if (winner.category === 'avto') return 'mobile.de';
  return 'bolha';
}

// Deterministic suggestion — used as fallback when AI unavailable
function deterministicSuggestion(winner: WinnerTrade): ReplicationSuggestion {
  const platform = pickPlatform(winner);
  const monitorName = buildMonitorName(winner, platform);
  const keywords = winner.keywords.length > 0 ? winner.keywords : [winner.title.split(' ')[0] || 'item'];

  const priceMin = Math.max(1, Math.round(winner.buyPrice * 0.7));
  const priceMax = Math.round(winner.buyPrice * 1.1);

  // Anti-hallucination: clamp expectedROI to [5%, 80%] based on historical ROI
  const historicalROI = winner.roi;
  let expectedROI = Math.round(historicalROI * 0.85); // slightly conservative
  expectedROI = Math.max(5, Math.min(80, expectedROI));

  // expectedProfit = buyPrice × expectedROI / 100, clamped to [0, historical profit × 2]
  const expectedProfitRaw = Math.round(priceMin * (expectedROI / 100));
  const maxProfit = winner.profit * 2;
  const expectedProfit = Math.max(0, Math.min(maxProfit, expectedProfitRaw));

  // confidenceScore based on number of historical samples (we don't have count
  // per winner here, so use ROI magnitude — higher ROI = more signal)
  const confidence = Math.max(40, Math.min(85, Math.round(40 + Math.min(45, historicalROI / 2))));

  return {
    basedOnTradeId: winner.tradeId,
    monitorName,
    platform,
    searchKeywords: keywords,
    priceMin,
    priceMax,
    expectedROI,
    expectedProfit,
    categoryFocus: winner.category || 'drugo',
    confidenceScore: confidence,
    reasoning: `Replikacija zmagovalnega trade-a "${winner.title.slice(0, 40)}" (${winner.roi}% ROI, ${winner.holdDays} dni hold) → iskanje podobnih na ${platform} v cenovnem razponu ${priceMin}-${priceMax}€. Pričakovan ROI ${expectedROI}% in profit ~${expectedProfit}€ (konservativno glede na zgodovinski winner).`,
  };
}

function validateAiSuggestion(
  raw: AiSuggestionEntry,
  winner: WinnerTrade,
): ReplicationSuggestion | null {
  const tid = String(raw.basedOnTradeId || '').trim();
  if (tid !== winner.tradeId) {
    // AI might have misnamed the tradeId — match by index caller will handle
    return null;
  }

  const fallback = deterministicSuggestion(winner);
  const platform = validatePlatform(raw.platform, fallback.platform);

  const priceMin = clampNumber(raw.priceMin, 1, winner.buyPrice * 1.5, fallback.priceMin);
  const priceMax = clampNumber(
    raw.priceMax,
    priceMin,
    winner.buyPrice * 2,
    Math.max(priceMin + 10, fallback.priceMax),
  );

  // Anti-hallucination: expectedROI clamped to [5%, 80%]
  const expectedROI = clampNumber(raw.expectedROI, 5, 80, fallback.expectedROI);

  // Anti-hallucination: expectedProfit clamped to [0, historical profit × 2]
  const expectedProfit = clampNumber(
    raw.expectedProfit,
    0,
    winner.profit * 2,
    fallback.expectedProfit,
  );

  const keywords = validateKeywords(raw.searchKeywords, fallback.searchKeywords);
  const monitorName = clampString(raw.monitorName, 80, fallback.monitorName);
  const categoryFocus = clampString(
    raw.categoryFocus,
    40,
    winner.category || 'drugo',
  ).toLowerCase();
  const confidenceScore = clampNumber(raw.confidenceScore, 0, 100, fallback.confidenceScore);

  const reasoning = clampString(raw.reasoning, 360, fallback.reasoning);

  return {
    basedOnTradeId: winner.tradeId,
    monitorName,
    platform,
    searchKeywords: keywords,
    priceMin,
    priceMax,
    expectedROI,
    expectedProfit,
    categoryFocus,
    confidenceScore,
    reasoning,
  };
}

// --- Prompt builder + summary (čisti helperji) --------------------------

function buildPrompt(winners: WinnerTrade[]): string {
  const winnersBlock = winners
    .map(
      (w, idx) =>
        `${idx + 1}. tradeId=${w.tradeId} | naslov="${w.title}" | kategorija=${w.category} | ` +
        `nabava=${w.buyPrice}€ | prodaja=${w.sellPrice}€ | profit=${w.profit}€ | ` +
        `ROI=${w.roi}% | holdDays=${w.holdDays} | source=${w.source} | keywords=[${w.keywords.join(', ')}]`,
    )
    .join('\n');

  return `Si AI strategist za preprodajo na slovenskih in srednjeevropskih oglasnih platformah.
Analiziral si zgodovino NAJBOLJŠIH trade-ov in predlagaš NOVE search monitorje, ki bi replicirali te winning pattern-e.

TOP ${winners.length} ZMAGOVALNIH TRADE-OV (sortirano po ROI desc):
${winnersBlock}

PRAVILA ZA REPLICIRANJE:
1. Za vsak winner generiraj 1-2 novih monitor konfiguracij (če je winner zelo obetaven, lahko 2 — različne platforme/razponi).
2. monitorName: kratek, opisen (npr. "PS5 Digital Bolha < 300€"), max 80 znakov.
3. platform: bolha | vinted | facebook | mobile.de | kleinanzeigen | avtonet (uporabi winner.source ali kategorijo za izbiro).
4. searchKeywords: 2-5 ključnih besed iz winner.title (brand + model + variant).
5. priceMin: ~70% winner.buyPrice (koliko naj boš pripravljen plačati).
6. priceMax: ~110% winner.buyPrice (zgornja meja za nakup).
7. expectedROI: realističen pričakovan ROI, baziran na winner.roi (lahko nekoliko nižji zaradi tržnih sprememb), CLAMP na [5, 80] %.
8. expectedProfit: pričakovan profit v EUR = priceMin × expectedROI/100, CLAMP na [0, ${Math.round(winners[0].profit * 2)}].
9. categoryFocus: kategorija iz winner.category.
10. confidenceScore: 0-100 (višje = bolj verjetno da se bo pattern ponovil — upoštevaj ROI, holdDays, popularnost kategorije).
11. reasoning: 1-2 stavka — ZAKAJ ta monitor replicira winner in kaj iskati.

VRNI LE JSON:
{
  "suggestions": [
    {
      "basedOnTradeId": "<id>",
      "monitorName": "...",
      "platform": "bolha|vinted|...",
      "searchKeywords": ["..."],
      "priceMin": <eur>,
      "priceMax": <eur>,
      "expectedROI": <5-80>,
      "expectedProfit": <eur>,
      "categoryFocus": "...",
      "confidenceScore": <0-100>,
      "reasoning": "<slovensko, 1-2 stavka>"
    }
  ]
}${GROUNDING_PROMPT_SUFFIX}`;
}

function parseAiSuggestions(
  parsed: unknown,
  winners: WinnerTrade[],
): { suggestions: ReplicationSuggestion[]; aiUsed: boolean } {
  const raw = parsed as AiReplicationResponse | null;
  const suggestions: ReplicationSuggestion[] = [];
  if (!raw || !Array.isArray(raw.suggestions)) {
    return { suggestions, aiUsed: false };
  }

  // Build a lookup: tradeId → winner (so AI can return suggestions in any order)
  const winnerById = new Map(winners.map(w => [w.tradeId, w]));
  const seenTradeIds = new Set<string>();
  for (const rawS of raw.suggestions) {
    const tid = String(rawS.basedOnTradeId || '').trim();
    const winner = winnerById.get(tid);
    if (!winner) continue;
    // Allow up to 2 suggestions per winner
    if (seenTradeIds.has(tid)) {
      // 2nd suggestion for same trade — still validate
      const s = validateAiSuggestion(rawS, winner);
      if (s) {
        // Slightly differentiate the monitor name to avoid duplicate
        s.monitorName = s.monitorName.slice(0, 70) + ' (2)';
        suggestions.push(s);
      }
      continue;
    }
    seenTradeIds.add(tid);
    const s = validateAiSuggestion(rawS, winner);
    if (s) suggestions.push(s);
    if (suggestions.length >= winners.length * 2) break;
  }
  return { suggestions, aiUsed: suggestions.length > 0 };
}

function buildSummary(
  winners: WinnerTrade[],
  suggestions: ReplicationSuggestion[],
) {
  const totalWinners = winners.length;
  const totalSuggestions = suggestions.length;
  const best = suggestions[0] ?? null;
  const bestOpportunity = best
    ? `${best.monitorName} (${best.platform}, ${best.expectedROI}% ROI, ~${best.expectedProfit}€)`
    : null;

  // estimatedMonthlyProfit: assume we catch 1 deal per week (4/month) at avg expectedProfit
  const avgProfit =
    suggestions.length > 0
      ? suggestions.reduce((s, x) => s + x.expectedProfit, 0) / suggestions.length
      : 0;
  const estimatedMonthlyProfit = Math.round(avgProfit * 4);

  return {
    totalWinners,
    totalSuggestions,
    bestOpportunity,
    estimatedMonthlyProfit,
  };
}

// --- Handler -------------------------------------------------------------

const tradeReplicationHandler = withAiRoute<TradeReplicationInput>({
  endpoint: '/api/ai/trade-replication-engine',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    let requestedLimit = 10;
    if (body && typeof body === 'object') {
      if (typeof body.limit === 'number' && body.limit >= 1 && body.limit <= 50) {
        requestedLimit = Math.floor(body.limit);
      }
    }
    return { limit: requestedLimit };
  },

  // No validateInput — limit has safe default
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;
    const requestedLimit = input.limit;

    // 1) Query SOLD trades with profit > 0, sorted by ROI desc, take top winners
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        sellDate: { not: null },
        buyPrice: { gt: 0 },
      },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyDate: true,
        buyLocation: true,
        buyFees: true,
        sellPrice: true,
        sellDate: true,
        sellFees: true,
        listing: {
          select: {
            monitor: { select: { source: true } },
          },
        },
      },
      take: 500,
    });

    if (soldTrades.length === 0) {
      return apiOk({
        ok: true,
        winners: [],
        suggestions: [],
        summary: {
          totalWinners: 0,
          totalSuggestions: 0,
          bestOpportunity: null,
          estimatedMonthlyProfit: 0,
        },
        aiUsed: false,
        message: 'Ni prodanih trade-ov — najprej prodi kak item da zgeneriraš replication suggestions.',
      });
    }

    // Compute profit + ROI per trade, filter profit > 0, sort by ROI desc
    const winners: WinnerTrade[] = soldTrades
      .map(t => {
        const buy = t.buyPrice + (t.buyFees ?? 0);
        const sell = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
        const profit = sell - buy;
        const roi = buy > 0 ? (profit / buy) * 100 : 0;
        const holdDays =
          t.sellDate && t.buyDate
            ? Math.max(
                0,
                Math.round(
                  (new Date(t.sellDate).getTime() - new Date(t.buyDate).getTime()) / 86_400_000,
                ),
              )
            : 0;
        const source =
          t.listing?.monitor?.source || t.buyLocation || 'bolha';
        return {
          tradeId: t.id,
          title: t.title,
          category: (t.category || 'drugo').trim().toLowerCase(),
          buyPrice: Math.round(t.buyPrice),
          sellPrice: Math.round(t.sellPrice ?? 0),
          profit: Math.round(profit),
          roi: Math.round(roi * 10) / 10,
          holdDays,
          source: source.toLowerCase().trim(),
          keywords: extractKeywords(t.title),
        };
      })
      .filter(w => w.profit > 0)
      .sort((a, b) => b.roi - a.roi)
      .slice(0, requestedLimit);

    if (winners.length === 0) {
      return apiOk({
        ok: true,
        winners: [],
        suggestions: [],
        summary: {
          totalWinners: 0,
          totalSuggestions: 0,
          bestOpportunity: null,
          estimatedMonthlyProfit: 0,
        },
        aiUsed: false,
        message: 'Ni dobičkonosnih trade-ov — reproducirati je mogoče le winner pattern-e (profit > 0).',
      });
    }

    // 2) AI cache — keyed by sorted winner trade IDs
    const cacheKey = `trade-replication:${JSON.stringify(winners.map(w => w.tradeId).sort())}`;
    const cached = getCachedAI<{
      suggestions: ReplicationSuggestion[];
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        winners,
        suggestions: cached.suggestions,
        summary: buildSummary(winners, cached.suggestions),
        cached: true,
        aiUsed: true,
      });
    }

    // 3) Build AI prompt with grounding + call AI (try/catch z graceful fallback)
    const prompt = buildPrompt(winners);

    let aiUsed = false;
    let suggestions: ReplicationSuggestion[] = [];

    try {
      const raw = await callAi(prompt);
      const result = parseAiSuggestions(parseAi(raw), winners);
      suggestions = result.suggestions;
      aiUsed = result.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/trade-replication-engine',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 4) Deterministic fallback for any winners AI didn't cover
    const seenTradeIds = new Set(suggestions.map(s => s.basedOnTradeId));
    for (const winner of winners) {
      if (!seenTradeIds.has(winner.tradeId)) {
        suggestions.push(deterministicSuggestion(winner));
      }
    }

    // 5) Rank by expectedProfit desc
    suggestions.sort((a, b) => b.expectedProfit - a.expectedProfit);

    const summary = buildSummary(winners, suggestions);

    // 6) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { suggestions });
    }

    return apiOk({
      ok: true,
      winners,
      suggestions,
      summary,
      aiUsed,
    });
  },
});

export const GET = tradeReplicationHandler;
export const POST = tradeReplicationHandler;
