// v7.66: AI Competitive Landscape Analyzer — AI analizira konkurenčno krajino,
// identificira druge flipper-je/prodajalce aktivne v tvojih kategorijah,
// njihove cenovne strategije, frekvenco oglasov in market share.
//
// "Top konkurent: Elektro Marjan (15 oglasov, BUDGET strategy, 25% market share).
//  Tvoja prednost: boljše slike. Specializacija: elektronika. Threat: HIGH."
//
// Razlika od competitor-price-tracker (ki spremlja cene posameznih
// konkurenčnih oglasov) — ta ANALIZIRA prodajalce kot celoto (njihove strategije,
// frekvence, market share). Razlika od analytics/competitor-tracker (ki sledi
// supplier-jem) — ta gleda AKTIVNE PRODAJALCE v tvojih kategorijah in njihovo
// grožnjo. Razlika od analytics/supplier-crm (ki CRM-upravlja dobavitelje) — ta
// gleda KONKURENCO (ljudje ki prodajajo podobne item-e kot ti).
//
// GET+POST /api/ai/competitive-landscape-analyzer
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

type PricingStrategy = 'PREMIUM' | 'MID_MARKET' | 'BUDGET';
type ThreatLevel = 'LOW' | 'MEDIUM' | 'HIGH';
type YourPosition = 'BELOW_MARKET' | 'AT_MARKET' | 'ABOVE_MARKET';
type Priority = 'HIGH' | 'MEDIUM' | 'LOW';

interface CompetitorRow {
  sellerName: string;
  totalListings: number;
  categories: string[];
  avgPrice: number;
  priceRange: { min: number; max: number };
  listingFrequency: number; // listings per week
  avgDealScore: number;
  marketShare: number; // %
  firstSeen: string;
  lastSeen: string;
}

interface CompetitorAnalysis {
  sellerName: string;
  pricingStrategy: PricingStrategy;
  specialization: string;
  threatLevel: ThreatLevel;
  yourAdvantage: string;
  recommendedAction: string;
}

interface MarketPosition {
  yourAvgPrice: number;
  competitorAvgPrice: number;
  yourPosition: YourPosition;
  positioningAdvice: string;
}

interface CompetitiveAction {
  action: string;
  priority: Priority;
  expectedImpact: string;
}

interface DifferentiationOpportunity {
  niche: string;
  reasoning: string;
  potentialProfit: number;
}

interface AiCompetitiveResponse {
  analysis?: unknown;
  marketPosition?: unknown;
  competitiveActions?: unknown;
  differentiationOpportunity?: unknown;
  summary?: unknown;
}

// --- Helpers -------------------------------------------------------------

const VALID_PRICING: readonly PricingStrategy[] = [
  'PREMIUM',
  'MID_MARKET',
  'BUDGET',
] as const;
const VALID_THREAT: readonly ThreatLevel[] = ['LOW', 'MEDIUM', 'HIGH'] as const;
const VALID_POSITION: readonly YourPosition[] = [
  'BELOW_MARKET',
  'AT_MARKET',
  'ABOVE_MARKET',
] as const;
const VALID_PRIORITY: readonly Priority[] = ['HIGH', 'MEDIUM', 'LOW'] as const;

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

// Deterministic pricing strategy from avgPrice percentiles (fallback when AI unavailable)
function deterministicPricingStrategy(
  avgPrice: number,
  allAvgPrices: number[],
): PricingStrategy {
  if (allAvgPrices.length === 0) return 'MID_MARKET';
  const sorted = [...allAvgPrices].sort((a, b) => a - b);
  const p33 = sorted[Math.floor(sorted.length * 0.33)];
  const p67 = sorted[Math.floor(sorted.length * 0.67)];
  if (avgPrice <= p33) return 'BUDGET';
  if (avgPrice >= p67) return 'PREMIUM';
  return 'MID_MARKET';
}

function deterministicThreatLevel(
  marketShare: number,
  totalListings: number,
  avgDealScore: number,
): ThreatLevel {
  // High threat: large market share OR many listings OR high deal quality
  let score = 0;
  if (marketShare >= 30) score += 3;
  else if (marketShare >= 15) score += 2;
  else if (marketShare >= 5) score += 1;
  if (totalListings >= 15) score += 2;
  else if (totalListings >= 7) score += 1;
  if (avgDealScore >= 70) score += 2;
  else if (avgDealScore >= 55) score += 1;
  if (score >= 5) return 'HIGH';
  if (score >= 3) return 'MEDIUM';
  return 'LOW';
}

// --- Deterministic analysis (fallback) -----------------------------------

function buildDeterministicAnalysis(
  competitors: CompetitorRow[],
  yourAvgPrice: number,
): {
  analysis: CompetitorAnalysis[];
  marketPosition: MarketPosition;
  competitiveActions: CompetitiveAction[];
  differentiationOpportunity: DifferentiationOpportunity[];
  summary: string;
} {
  const allAvgPrices = competitors.map(c => c.avgPrice);
  const competitorAvgPrice =
    allAvgPrices.length > 0
      ? Math.round(allAvgPrices.reduce((s, p) => s + p, 0) / allAvgPrices.length)
      : 0;

  const analysis: CompetitorAnalysis[] = competitors.map(c => {
    const pricingStrategy = deterministicPricingStrategy(c.avgPrice, allAvgPrices);
    const threatLevel = deterministicThreatLevel(
      c.marketShare,
      c.totalListings,
      c.avgDealScore,
    );
    const specialization =
      c.categories.length > 0
        ? c.categories.slice(0, 3).join(', ')
        : 'mešan asortiman';
    const yourAdvantage =
      yourAvgPrice > 0 && yourAvgPrice < c.avgPrice
        ? `Tvoja povprečna cena ${yourAvgPrice}€ je nižja od ${c.sellerName} (${c.avgPrice}€) — bolj konkurenčno.`
        : yourAvgPrice > 0 && yourAvgPrice > c.avgPrice
          ? `Tvoja povprečna cena ${yourAvgPrice}€ je višja — konkurenca z boljšo kvaliteto slik in podrobnim opisom.`
          : `Tvoja prednost: personaliziran pristop in hitro odgovarjanje na povpraševanja.`;
    const recommendedAction =
      threatLevel === 'HIGH'
        ? `Spremljaj nove oglase ${c.sellerName} in se izogibaj direktni cenovni vojni — razlikuj se z opisi/slikami.`
        : threatLevel === 'MEDIUM'
          ? `Periodično spremljaj ${c.sellerName} (${c.marketShare}% share) in prilagodi cene če se premakne.`
          : `${c.sellerName} ima nizko grožnjo — ostani aktiven v njegovih kategorijah (${c.categories.slice(0, 2).join(', ')}).`;
    return {
      sellerName: c.sellerName,
      pricingStrategy,
      specialization,
      threatLevel,
      yourAdvantage,
      recommendedAction,
    };
  });

  // Market position
  let yourPosition: YourPosition = 'AT_MARKET';
  if (yourAvgPrice > 0 && competitorAvgPrice > 0) {
    const diff = ((yourAvgPrice - competitorAvgPrice) / competitorAvgPrice) * 100;
    if (diff <= -10) yourPosition = 'BELOW_MARKET';
    else if (diff >= 10) yourPosition = 'ABOVE_MARKET';
    else yourPosition = 'AT_MARKET';
  }
  const positioningAdvice =
    yourAvgPrice === 0
      ? 'Ni tvojih oglasov — dodaj cene na svoje Trade-e za primerjavo.'
      : yourPosition === 'BELOW_MARKET'
        ? `Tvoja cena ${yourAvgPrice}€ je pod tržno (${competitorAvgPrice}€) — dober prostor za dvig ali hitro prodajo.`
        : yourPosition === 'ABOVE_MARKET'
          ? `Tvoja cena ${yourAvgPrice}€ je nad tržno (${competitorAvgPrice}€) — poudari kvaliteto/ugodnosti da utemeljiš premijo.`
          : `Tvoja cena ${yourAvgPrice}€ je v liniji s tržno (${competitorAvgPrice}€) — vzdržuj ali dodaj diferenciacijo.`;

  const marketPosition: MarketPosition = {
    yourAvgPrice,
    competitorAvgPrice,
    yourPosition,
    positioningAdvice,
  };

  // Competitive actions
  const competitiveActions: CompetitiveAction[] = [];
  if (analysis.length > 0) {
    const topThreat = [...analysis].sort((a, b) => {
      const order: Record<ThreatLevel, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      return order[b.threatLevel] - order[a.threatLevel];
    })[0];
    if (topThreat) {
      competitiveActions.push({
        action: `Spremljaj nove oglase ${topThreat.sellerName} dnevno in prilagodi cene svojih aktivnih oglasov če se premakne.`,
        priority: 'HIGH',
        expectedImpact: `Zmanjša izgubo povpraševanja na ${topThreat.sellerName}.`,
      });
    }
    if (yourPosition === 'ABOVE_MARKET') {
      competitiveActions.push({
        action: 'Premisli cene za 5-10% navzdol za najbolj zastarele item-e da tekmuješ direktno.',
        priority: 'MEDIUM',
        expectedImpact: 'Poveča hitrost prodaje.',
      });
    } else if (yourPosition === 'BELOW_MARKET') {
      competitiveActions.push({
        action: 'Dvigni cene za 5-10% na hitro prodajajočih se item-ih da povečaš margin.',
        priority: 'MEDIUM',
        expectedImpact: 'Poveča margin brez izgube prodaje.',
      });
    }
    competitiveActions.push({
      action: 'Izboljšaj naslove in slike na svojih oglasih da se razlikuješ od cenevne konkurence.',
      priority: 'LOW',
      expectedImpact: 'Poveča CTR in konverzijo neodvisno od cene.',
    });
  }

  // Differentiation opportunity — find underserved categories
  const catCounts = new Map<string, number>();
  for (const c of competitors) {
    for (const cat of c.categories) {
      catCounts.set(cat, (catCounts.get(cat) ?? 0) + c.totalListings);
    }
  }
  const differentiationOpportunity: DifferentiationOpportunity[] = Array.from(
    catCounts.entries(),
  )
    .sort((a, b) => a[1] - b[1]) // ascending — less crowded = opportunity
    .slice(0, 3)
    .map(([niche, count]) => ({
      niche,
      reasoning: `Samo ${count} oglasov od konkurence v "${niche}" — manjša konkurenca = boljša priložnost.`,
      potentialProfit: Math.round(Math.max(50, 500 - count * 5)),
    }));

  const topComp = competitors[0];
  const summary = competitors.length === 0
    ? 'Ni zaznanih konkurentov — dodaš več oglasov za boljšo analizo.'
    : `Zaznanih ${competitors.length} aktivnih konkurentov. Top: ${topComp.sellerName} (${topComp.totalListings} oglasov, ${topComp.marketShare}% share, ${analysis[0]?.pricingStrategy ?? 'MID_MARKET'} strategija, ${analysis[0]?.threatLevel ?? 'LOW'} grožnja). ${yourAvgPrice > 0 ? `Tvoja povprečna cena ${yourAvgPrice}€ je ${yourPosition === 'BELOW_MARKET' ? 'pod' : yourPosition === 'ABOVE_MARKET' ? 'nad' : 'v'} tržno.` : ''}`;

  return {
    analysis,
    marketPosition,
    competitiveActions,
    differentiationOpportunity,
    summary,
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleCompetitiveLandscape(req);
}
export async function POST(req: NextRequest) {
  return handleCompetitiveLandscape(req);
}

async function handleCompetitiveLandscape(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-competitive-landscape', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    // Parse body (optional, ignored — analysis uses global listing data)
    try {
      await req.json().catch(() => ({}));
    } catch {
      // GET request — no body, ignore
    }

    const now = Date.now();
    const dayMs = 86_400_000;
    const cutoff = new Date(now - 30 * dayMs);

    // 1) Query all listings from last 30 days with sellerName populated
    const listings = await db.listing.findMany({
      where: {
        isHidden: false,
        firstSeenAt: { gte: cutoff },
        sellerName: { not: null },
      },
      select: {
        id: true,
        title: true,
        price: true,
        firstSeenAt: true,
        sellerName: true,
        dealScore: true,
        monitor: { select: { name: true, source: true } },
      },
      take: 10000,
    });

    // Empty state — return gracefully
    if (listings.length === 0) {
      return NextResponse.json({
        ok: true,
        competitors: [],
        analysis: [],
        marketPosition: {
          yourAvgPrice: 0,
          competitorAvgPrice: 0,
          yourPosition: 'AT_MARKET',
          positioningAdvice:
            'Ni oglasov v zadnjih 30 dneh — Competitive Landscape analiza ni mogoča. Začni z dodajanjem oglasov z sellerName.',
        },
        competitiveActions: [],
        differentiationOpportunity: [],
        summary:
          'Ni oglasov z sellerName v zadnjih 30 dneh — potrebuješ vsaj nekaj oglasov z identificiranimi prodajalci.',
        aiUsed: false,
        message:
          'Ni oglasov z sellerName v zadnjih 30 dneh — Competitive Landscape potrebuje vsaj nekaj oglasov z znanimi prodajalci.',
      });
    }

    // 2) Group by sellerName — find recurring sellers (3+ listings = potential competitor)
    const sellerAgg = new Map<
      string,
      {
        listings: Array<{
          id: string;
          title: string;
          price: number | null;
          firstSeenAt: Date;
          dealScore: number | null;
          monitorName: string;
        }>;
      }
    >();
    for (const l of listings) {
      const seller = (l.sellerName ?? '').trim();
      if (!seller) continue;
      const price = l.price ?? null;
      const entry = sellerAgg.get(seller) || { listings: [] };
      entry.listings.push({
        id: l.id,
        title: l.title,
        price,
        firstSeenAt: l.firstSeenAt,
        dealScore: l.dealScore,
        monitorName: l.monitor?.name ?? 'drugo',
      });
      sellerAgg.set(seller, entry);
    }

    // 3) Build competitor rows (only sellers with 3+ listings)
    const totalListingsCount = listings.length;
    const competitors: CompetitorRow[] = [];
    for (const [sellerName, agg] of sellerAgg.entries()) {
      if (agg.listings.length < 3) continue;
      const prices = agg.listings
        .map(l => l.price)
        .filter((p): p is number => p != null && p > 0);
      const dealScores = agg.listings
        .map(l => l.dealScore)
        .filter((d): d is number => d != null);
      const firstSeen = agg.listings.reduce(
        (min, l) => (l.firstSeenAt < min ? l.firstSeenAt : min),
        agg.listings[0].firstSeenAt,
      );
      const lastSeen = agg.listings.reduce(
        (max, l) => (l.firstSeenAt > max ? l.firstSeenAt : max),
        agg.listings[0].firstSeenAt,
      );
      // Activity window in days
      const windowDays = Math.max(
        1,
        Math.round((lastSeen.getTime() - firstSeen.getTime()) / dayMs),
      );
      const listingFrequency = Number(
        ((agg.listings.length / windowDays) * 7).toFixed(2),
      );
      // Distinct categories (monitor names = search niches)
      const catSet = new Set<string>();
      for (const l of agg.listings) {
        catSet.add(l.monitorName || 'drugo');
      }
      const categories = Array.from(catSet).sort();
      const avgPrice =
        prices.length > 0
          ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length)
          : 0;
      const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
      const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
      // Market share = their listings / total listings in their categories × 100
      const catTotalListings = listings.filter(l => {
        const cat = l.monitor?.name ?? 'drugo';
        return categories.includes(cat);
      }).length;
      const marketShare =
        catTotalListings > 0
          ? Math.round((agg.listings.length / catTotalListings) * 100)
          : 0;
      const avgDealScore =
        dealScores.length > 0
          ? Math.round(
              dealScores.reduce((s, d) => s + d, 0) / dealScores.length,
            )
          : 0;
      competitors.push({
        sellerName,
        totalListings: agg.listings.length,
        categories,
        avgPrice,
        priceRange: { min: minPrice, max: maxPrice },
        listingFrequency,
        avgDealScore,
        marketShare: Math.min(100, Math.max(0, marketShare)),
        firstSeen: isoDate(firstSeen),
        lastSeen: isoDate(lastSeen),
      });
    }

    // Sort by totalListings desc, take top 20
    competitors.sort((a, b) => b.totalListings - a.totalListings);
    const topCompetitors = competitors.slice(0, 20);

    if (topCompetitors.length === 0) {
      return NextResponse.json({
        ok: true,
        competitors: [],
        analysis: [],
        marketPosition: {
          yourAvgPrice: 0,
          competitorAvgPrice: 0,
          yourPosition: 'AT_MARKET',
          positioningAdvice:
            'Ni konkurentov z 3+ oglasi — vsi prodajalci imajo manj kot 3 oglase v zadnjih 30 dneh.',
        },
        competitiveActions: [],
        differentiationOpportunity: [],
        summary:
          'Ni ponavljajočih se prodajalcev (3+ oglasov) v zadnjih 30 dneh — potrebuješ več oglasov za smiselno analizo konkurence.',
        aiUsed: false,
      });
    }

    // 4) Get user's own avg price (from HELD trades buyPrice, as proxy for their pricing)
    const yourTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { buyPrice: true },
      take: 1000,
    });
    const yourAvgPrice =
      yourTrades.length > 0
        ? Math.round(
            yourTrades.reduce((s, t) => s + t.buyPrice, 0) / yourTrades.length,
          )
        : 0;

    // 5) Build deterministic analysis as fallback base
    const det = buildDeterministicAnalysis(topCompetitors, yourAvgPrice);

    // 6) AI cache — keyed by current month (refreshes monthly)
    const currentMonth = isoDate(new Date(now)).slice(0, 7); // YYYY-MM
    const cacheKey = `competitive-landscape:${currentMonth}`;
    const cached = getCachedAI<{
      analysis: CompetitorAnalysis[];
      marketPosition: MarketPosition;
      competitiveActions: CompetitiveAction[];
      differentiationOpportunity: DifferentiationOpportunity[];
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        competitors: topCompetitors,
        analysis: cached.analysis,
        marketPosition: cached.marketPosition,
        competitiveActions: cached.competitiveActions,
        differentiationOpportunity: cached.differentiationOpportunity,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 7) AI prompt with grounding
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

    // Compute market-wide bounds for anti-hallucination
    const allPrices = topCompetitors.flatMap(c => [
      c.priceRange.min,
      c.priceRange.max,
    ]);
    const marketMinPrice = allPrices.length > 0 ? Math.min(...allPrices) : 0;
    const marketMaxPrice = allPrices.length > 0 ? Math.max(...allPrices) : 0;
    const marketAvgPrice =
      topCompetitors.length > 0
        ? Math.round(
            topCompetitors.reduce((s, c) => s + c.avgPrice, 0) /
              topCompetitors.length,
          )
        : 0;

    const competitorBlock = topCompetitors
      .slice(0, 10) // top 10 for AI prompt
      .map(
        (c, i) =>
          `${i + 1}. ${c.sellerName}: ${c.totalListings} oglasov, kategorije=${c.categories.join('/')}, avgPrice=${c.avgPrice}€, range=[${c.priceRange.min}-${c.priceRange.max}]€, freq=${c.listingFrequency}/teden, avgDealScore=${c.avgDealScore}, marketShare=${c.marketShare}%, aktivnost=${c.firstSeen}→${c.lastSeen}`,
      )
      .join('\n');

    const prompt = `Si AI analitik konkurenčne krajine za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Na podlagi ZGODOVINSKIH podatkov o aktivnih prodajalcih v zadnjih 30 dneh analiziraj konkurenčno krajino in identificiraj njihove strategije ter tvoje prednosti.

DETEKTIRANI KONKURENTI (top ${Math.min(10, topCompetitors.length)} od ${topCompetitors.length} skupno, ${totalListingsCount} oglasov v 30 dneh):
${competitorBlock}

TVOJA POVPREČNA CENA (iz held inventarja): ${yourAvgPrice}€
TRŽNA POVPREČNA CENA: ${marketAvgPrice}€ (range ${marketMinPrice}-${marketMaxPrice}€)

DETERMINISTIČNA OSNOVA (uporabi kot referenco, AI lahko prilagodi):
- Top konkurent: ${topCompetitors[0]?.sellerName ?? '—'} (${topCompetitors[0]?.totalListings ?? 0} oglasov, ${det.analysis[0]?.pricingStrategy ?? 'MID_MARKET'} strategija, ${det.analysis[0]?.threatLevel ?? 'LOW'} grožnja)
- Tvoja pozicija: ${det.marketPosition.yourPosition} (${yourAvgPrice}€ vs tržno ${marketAvgPrice}€)

PRAVILA ZA ANALIZO:
1. Za vsakega od top konkurentov določi:
   - pricingStrategy: PREMIUM (višje od tržnega avg), MID_MARKET (v ±10% tržnega), BUDGET (nižje)
   - specialization: glavna kategorija/niša (npr. "elektronika - iPhone")
   - threatLevel: HIGH (marketShare >= 15% in 7+ oglasov), MEDIUM (5-15% ali 3-7 oglasov), LOW (manj)
   - yourAdvantage: kje imaš prednost (cena, kvalitetne slike, hitrost odgovora, opisi)
   - recommendedAction: specifična akcija za ta konkurent (1 stavek)
2. marketPosition: yourPosition (BELOW_MARKET/AT_MARKET/ABOVE_MARKET glede na +-10% tržnega avg) in positioningAdvice (slovensko).
3. competitiveActions: 3-5 specifičnih akcij z priority (HIGH/MEDIUM/LOW) in expectedImpact (kaj prinese).
4. differentiationOpportunity: 2-3 manj zasedene niše (kategorije z malo konkurenčnih oglasov) z reasoning in potentialProfit (EUR).
5. summary: 1-2 povedi slovensko z najpomembnejšimi ugotovitvami.

VRNI LE JSON:
{
  "analysis": [
    { "sellerName": "Elektro Marjan", "pricingStrategy": "BUDGET", "specialization": "elektronika", "threatLevel": "HIGH", "yourAdvantage": "...", "recommendedAction": "..." }
  ],
  "marketPosition": { "yourAvgPrice": ${yourAvgPrice}, "competitorAvgPrice": ${marketAvgPrice}, "yourPosition": "AT_MARKET", "positioningAdvice": "..." },
  "competitiveActions": [ { "action": "...", "priority": "HIGH", "expectedImpact": "..." } ],
  "differentiationOpportunity": [ { "niche": "...", "reasoning": "...", "potentialProfit": 200 } ],
  "summary": "..."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;
    let analysis = det.analysis;
    let marketPosition = det.marketPosition;
    let competitiveActions = det.competitiveActions;
    let differentiationOpportunity = det.differentiationOpportunity;
    let summary = det.summary;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiCompetitiveResponse | null;

      if (parsed) {
        // Parse AI analysis array
        const aiAnalysis: CompetitorAnalysis[] = [];
        if (Array.isArray(parsed.analysis)) {
          for (const item of parsed.analysis) {
            const a = item as Record<string, unknown> | null;
            if (!a || typeof a !== 'object') continue;
            const sellerName = clampString(a.sellerName, 100, '');
            if (!sellerName) continue;
            // Validate sellerName exists in our competitors list
            const comp = topCompetitors.find(c => c.sellerName === sellerName);
            if (!comp) continue;
            aiAnalysis.push({
              sellerName,
              pricingStrategy: clampEnum(
                a.pricingStrategy,
                VALID_PRICING,
                deterministicPricingStrategy(comp.avgPrice, topCompetitors.map(c => c.avgPrice)),
              ),
              specialization: clampString(a.specialization, 200, comp.categories.slice(0, 3).join(', ')),
              threatLevel: clampEnum(
                a.threatLevel,
                VALID_THREAT,
                deterministicThreatLevel(comp.marketShare, comp.totalListings, comp.avgDealScore),
              ),
              yourAdvantage: clampString(a.yourAdvantage, 300, 'Ostani aktiven in personaliziran.'),
              recommendedAction: clampString(a.recommendedAction, 300, 'Spremljaj nove oglase tega prodajalca.'),
            });
          }
        }
        if (aiAnalysis.length > 0) {
          analysis = aiAnalysis;
        }

        // marketPosition
        if (parsed.marketPosition && typeof parsed.marketPosition === 'object') {
          const mp = parsed.marketPosition as Record<string, unknown>;
          const yourAvg = clampNumber(mp.yourAvgPrice, 0, 1_000_000, yourAvgPrice);
          const compAvg = clampNumber(mp.competitorAvgPrice, 0, 1_000_000, marketAvgPrice);
          marketPosition = {
            yourAvgPrice: yourAvg,
            competitorAvgPrice: compAvg,
            yourPosition: clampEnum(
              mp.yourPosition,
              VALID_POSITION,
              det.marketPosition.yourPosition,
            ),
            positioningAdvice: clampString(mp.positioningAdvice, 400, det.marketPosition.positioningAdvice),
          };
        }

        // competitiveActions
        const aiActions: CompetitiveAction[] = [];
        if (Array.isArray(parsed.competitiveActions)) {
          for (const item of parsed.competitiveActions) {
            const a = item as Record<string, unknown> | null;
            if (!a || typeof a !== 'object') continue;
            const action = clampString(a.action, 300, '');
            if (!action) continue;
            aiActions.push({
              action,
              priority: clampEnum(a.priority, VALID_PRIORITY, 'MEDIUM'),
              expectedImpact: clampString(a.expectedImpact, 200, 'Boljša pozicija na trgu.'),
            });
          }
        }
        if (aiActions.length > 0) {
          competitiveActions = aiActions.slice(0, 5);
        }

        // differentiationOpportunity
        const aiDiff: DifferentiationOpportunity[] = [];
        if (Array.isArray(parsed.differentiationOpportunity)) {
          for (const item of parsed.differentiationOpportunity) {
            const a = item as Record<string, unknown> | null;
            if (!a || typeof a !== 'object') continue;
            const niche = clampString(a.niche, 100, '');
            if (!niche) continue;
            aiDiff.push({
              niche,
              reasoning: clampString(a.reasoning, 300, 'Manj zasedena niša.'),
              potentialProfit: clampNumber(a.potentialProfit, 0, 100_000, 200),
            });
          }
        }
        if (aiDiff.length > 0) {
          differentiationOpportunity = aiDiff.slice(0, 5);
        }

        summary = clampString(parsed.summary, 500, det.summary);
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/competitive-landscape-analyzer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        analysis,
        marketPosition,
        competitiveActions,
        differentiationOpportunity,
        summary,
      });
    }

    return NextResponse.json({
      ok: true,
      competitors: topCompetitors,
      analysis,
      marketPosition,
      competitiveActions,
      differentiationOpportunity,
      summary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error('/api/ai/competitive-landscape-analyzer', 'handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
