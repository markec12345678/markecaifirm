// v7.57: Reinvestment Advisor — kAMO reinvestirati dobiček?
//
// "Samsung 35% ROI, Apple 12% → reinvestiraj 800€ v Samsung, 0€ v Apple"
//
// Glede na ROI leaderboard + razpoložljiv kapital, AI priporoči:
// - katere kategorije / brande / cenovne razpone tarčati naslednje
// - koliko kapitala reinvestirati
// - kako diverzificirati (zmanjšati overexposure)
//
// GET /api/ai/reinvestment-advisor
// (AI-enhanced priporočilo + grounding + anti-hallucination + 6h cache)

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
const MIN_TRADES_FOR_LEADERBOARD = 3;
const OVEREXPOSURE_THRESHOLD_PCT = 30; // >30% of portfolio = overexposed
const TOP_PERFORMER_LIMIT = 5;
const TOP_UNDERPERFORMER_LIMIT = 5;
const MAX_COMPETITORS_RETURNED = 20;

const KNOWN_BRANDS = [
  'apple', 'iphone', 'samsung', 'galaxy', 'huawei', 'xiaomi', 'sony',
  'playstation', 'xbox', 'nintendo', 'lg', 'bosch', 'makita', 'dewalt',
  'ikea', 'lego', 'nike', 'adidas', 'canon', 'nikon', 'dyson', 'bosch',
];

function extractBrand(title: string): string {
  const lower = title.toLowerCase();
  return KNOWN_BRANDS.find(b => lower.includes(b)) || 'drugo';
}

interface TopPerformer {
  brand: string;
  trades: number;
  avgROI: number;
  avgProfit: number;
}

interface Underperformer {
  brand: string;
  trades: number;
  avgROI: number;
  avgLoss: number;
}

interface BestPriceRange {
  min: number;
  max: number;
  avgROI: number;
}

interface CurrentAllocation {
  category: string;
  percentage: number;
  capital: number;
}

interface RecCategory {
  name: string;
  expectedROI: number;
  reasoning: string;
}

interface RecBrand {
  brand: string;
  confidence: number;
  reason: string;
}

interface AiAdvice {
  reinvestAmount?: unknown;
  recommendedCategories?: unknown;
  recommendedBrands?: unknown;
  priceRangeTarget?: unknown;
  diversificationAdvice?: string;
  avoidList?: unknown;
  reasoning?: string;
  confidence?: unknown;
}

export async function GET(req: NextRequest) {
  return handleReinvestmentAdvisor(req);
}

// v7.57: POST handler — AI Hub runner always sends POST with JSON body.
// Body is ignored (this endpoint takes no input) — logic is identical to GET.
export async function POST(req: NextRequest) {
  return handleReinvestmentAdvisor(req);
}

async function handleReinvestmentAdvisor(req: NextRequest) {
  try {
    // v7.32: AI rate limit (20/min/IP)
    const rl = checkRateLimit(req, 'ai-reinvestment-advisor', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    // 1) Historical SOLD trades for ROI analysis
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        sellDate: { not: null },
      },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        buyDate: true,
        sellDate: true,
      },
      orderBy: { sellDate: 'desc' },
      take: 1000,
    });

    // 2) Recent SOLD trades (last 30d) — available capital from recent sales
    const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);
    const recentSold = soldTrades.filter(t => new Date(t.sellDate!) >= thirtyDaysAgo);
    const cashAvailable = recentSold.reduce(
      (s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)),
      0,
    );

    // 3) Currently HELD trades — current allocation
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true },
      take: 500,
    });
    const heldCapital = heldTrades.reduce((s, t) => s + t.buyPrice, 0);
    const totalCapital = cashAvailable + heldCapital;

    // 4) ROI analysis grouped by brand
    const brandMap = new Map<
      string,
      { trades: number; profit: number; invested: number }
    >();
    for (const t of soldTrades) {
      const brand = extractBrand(t.title);
      const cur = brandMap.get(brand) || { trades: 0, profit: 0, invested: 0 };
      const buy = t.buyPrice + (t.buyFees ?? 0);
      const sell = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      cur.trades += 1;
      cur.profit += sell - buy;
      cur.invested += buy;
      brandMap.set(brand, cur);
    }

    const topPerformers: TopPerformer[] = Array.from(brandMap.entries())
      .filter(([, d]) => d.trades >= MIN_TRADES_FOR_LEADERBOARD)
      .map(([brand, d]) => ({
        brand,
        trades: d.trades,
        avgROI: d.invested > 0 ? Math.round((d.profit / d.invested) * 1000) / 10 : 0,
        avgProfit: d.trades > 0 ? Math.round(d.profit / d.trades) : 0,
      }))
      .sort((a, b) => b.avgROI - a.avgROI)
      .slice(0, TOP_PERFORMER_LIMIT);

    const underperformers: Underperformer[] = Array.from(brandMap.entries())
      .filter(([, d]) => d.trades >= MIN_TRADES_FOR_LEADERBOARD && d.profit < 0)
      .map(([brand, d]) => ({
        brand,
        trades: d.trades,
        avgROI: d.invested > 0 ? Math.round((d.profit / d.invested) * 1000) / 10 : 0,
        avgLoss: d.trades > 0 ? Math.round(Math.abs(d.profit) / d.trades) : 0,
      }))
      .sort((a, b) => a.avgROI - b.avgROI)
      .slice(0, TOP_UNDERPERFORMER_LIMIT);

    // 5) Best price range analysis (bucketize by buy price into 5 buckets)
    const priceBuckets = new Map<string, { trades: number; profit: number; invested: number }>();
    for (const t of soldTrades) {
      const buy = t.buyPrice + (t.buyFees ?? 0);
      const sell = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const bucketKey = buy < 100 ? '0-100'
        : buy < 300 ? '100-300'
        : buy < 700 ? '300-700'
        : buy < 1500 ? '700-1500'
        : '1500+';
      const cur = priceBuckets.get(bucketKey) || { trades: 0, profit: 0, invested: 0 };
      cur.trades += 1;
      cur.profit += sell - buy;
      cur.invested += buy;
      priceBuckets.set(bucketKey, cur);
    }

    let bestPriceRange: BestPriceRange = { min: 0, max: 500, avgROI: 0 };
    let bestROIBucket = -Infinity;
    for (const [key, d] of priceBuckets) {
      if (d.trades < 2) continue;
      const roi = d.invested > 0 ? (d.profit / d.invested) * 100 : 0;
      if (roi > bestROIBucket) {
        bestROIBucket = roi;
        const [minStr, maxStr] = key.split('-');
        bestPriceRange = {
          min: parseInt(minStr, 10) || 0,
          max: maxStr === '+' ? 9999 : (parseInt(maxStr, 10) || 500),
          avgROI: Math.round(roi * 10) / 10,
        };
      }
    }

    // 6) Current allocation per category (held trades)
    const catMap = new Map<string, number>();
    for (const t of heldTrades) {
      const cat = (t.category || 'drugo').trim();
      catMap.set(cat, (catMap.get(cat) || 0) + t.buyPrice);
    }
    const totalHeldCapital = heldCapital || 1; // avoid /0
    const currentAllocation: CurrentAllocation[] = Array.from(catMap.entries())
      .map(([category, capital]) => ({
        category,
        capital: Math.round(capital),
        percentage: Math.round((capital / totalHeldCapital) * 1000) / 10,
      }))
      .sort((a, b) => b.capital - a.capital);

    const overexposedCategories = currentAllocation.filter(
      c => c.percentage > OVEREXPOSURE_THRESHOLD_PCT,
    );

    // 7) Build context block
    const performanceBlock = {
      topPerformers,
      underperformers,
      bestPriceRange,
      totalHistoricalTrades: soldTrades.length,
    };
    const allocationBlock = {
      currentAllocation,
      overexposedCategories,
      heldCapital: Math.round(heldCapital),
    };
    const availabilityBlock = {
      cashAvailable: Math.round(cashAvailable),
      heldCapital: Math.round(heldCapital),
      totalCapital: Math.round(totalCapital),
    };

    // 8) If insufficient data, return graceful fallback
    if (soldTrades.length < MIN_TRADES_FOR_LEADERBOARD) {
      return NextResponse.json({
        ok: true,
        available: availabilityBlock,
        performance: performanceBlock,
        currentAllocation,
        recommendations: {
          reinvestAmount: Math.round(cashAvailable),
          recommendedCategories: [],
          recommendedBrands: [],
          priceRangeTarget: bestPriceRange,
          diversificationAdvice:
            'Nezadostno zgodovinskih podatkov za AI priporočilo. Zberite vsaj 3 prodaje za smiselno analizo.',
          avoidList: [],
        },
        reasoning:
          'Premalo prodaj za analizo ROI po brandu — reinvestirajte previdno v kategorije, ki jih poznate.',
        confidence: 0,
        message: 'Ni dovolj zgodovinskih podatkov.',
      });
    }

    // 9) Check AI cache
    const cacheKey = `reinvestment-advisor:${Math.round(cashAvailable)}`;
    const cached = getCachedAI<{
      recommendations: {
        reinvestAmount: number;
        recommendedCategories: RecCategory[];
        recommendedBrands: RecBrand[];
        priceRangeTarget: { min: number; max: number };
        diversificationAdvice: string;
        avoidList: string[];
      };
      reasoning: string;
      confidence: number;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        available: availabilityBlock,
        performance: performanceBlock,
        currentAllocation,
        ...cached,
        cached: true,
      });
    }

    // 10) AI prompt
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

    const prompt = `Si finančni svetovalec za preprodajalne rabljenih dobrin na slovenskih/evropskih oglasnih ploščadkah (Bolha, Vinted, Avtonet, mobile.de).

RAZPOLOŽLJIV KAPITAL:
- Cash (zadnjih 30d prodaje): ${Math.round(cashAvailable)}€
- Vezano v held inventar: ${Math.round(heldCapital)}€
- Skupaj kapital: ${Math.round(totalCapital)}€

ZGODOVINSKI REZULTATI (top performeri):
${topPerformers.map(p => `- ${p.brand}: ${p.trades} prodaj, ${p.avgROI}% ROI, ${p.avgProfit}€ povprečni profit`).join('\n') || '- (ni podatkov)'}

SLABI REZULTATI (underperformers):
${underperformers.map(p => `- ${p.brand}: ${p.trades} prodaj, ${p.avgROI}% ROI, ${p.avgLoss}€ povprečna izguba`).join('\n') || '- (ni podatkov)'}

NAJBOLJŠI CENOVNI RAZPON: ${bestPriceRange.min}€-${bestPriceRange.max}€ (${bestPriceRange.avgROI}% ROI)

TRENUTNA ALOKACIJA (held inventar):
${currentAllocation.map(c => `- ${c.category}: ${c.capital}€ (${c.percentage}%)`).join('\n') || '- (prazno)'}

OVEREXPOSED KATEGORIJE (>30%):
${overexposedCategories.map(c => `- ${c.category}: ${c.percentage}%`).join('\n') || '- (nobena)'}

Odgovori LE z JSON:
{
  "reinvestAmount": <number — koliko € od ${Math.round(cashAvailable)}€ reinvestirati>,
  "recommendedCategories": [
    { "name": "<kategorija>", "expectedROI": <number %>, "reasoning": "<1 stavek>" }
  ],
  "recommendedBrands": [
    { "brand": "<brand>", "confidence": <0-100>, "reason": "<1 stavek>" }
  ],
  "priceRangeTarget": { "min": <number>, "max": <number> },
  "diversificationAdvice": "<1-2 stavka>",
  "avoidList": ["<brand ali kategorija ki se ji izogibaj>"],
  "reasoning": "<skupni povzetek 1-2 stavka>",
  "confidence": <number 0-100>
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiAdvice: AiAdvice | null = null;
    let aiUsed = false;
    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiAdvice | null;
      if (parsed && typeof parsed === 'object') {
        aiAdvice = parsed;
        aiUsed = true;
      }
    } catch (err) {
      logger.warn('/api/ai/reinvestment-advisor', 'AI call failed — using deterministic fallback', err);
    }

    // 11) Build recommendations with deterministic fallback + anti-hallucination
    // reinvestAmount: clamp to [0, cashAvailable]
    let reinvestAmount = Math.round(cashAvailable * 0.8); // deterministic default: 80% of cash
    if (aiAdvice?.reinvestAmount != null) {
      const n = Number(aiAdvice.reinvestAmount);
      if (Number.isFinite(n)) {
        reinvestAmount = Math.max(0, Math.min(Math.round(cashAvailable), Math.round(n)));
      }
    }

    // recommendedCategories: top-3 by historical ROI (deterministic fallback)
    const recommendedCategories: RecCategory[] = [];
    if (aiAdvice?.recommendedCategories && Array.isArray(aiAdvice.recommendedCategories)) {
      for (const r of aiAdvice.recommendedCategories.slice(0, 3)) {
        if (r && typeof r === 'object' && typeof (r as RecCategory).name === 'string') {
          const item = r as RecCategory;
          recommendedCategories.push({
            name: String(item.name).slice(0, 60),
            expectedROI: Math.max(0, Math.min(500, Math.round(Number(item.expectedROI) || 0))),
            reasoning: typeof item.reasoning === 'string' ? item.reasoning.slice(0, 240) : '',
          });
        }
      }
    }
    if (recommendedCategories.length === 0 && topPerformers.length > 0) {
      // Deterministic fallback: use top performers' brands as categories
      for (const p of topPerformers.slice(0, 3)) {
        recommendedCategories.push({
          name: p.brand,
          expectedROI: p.avgROI,
          reasoning: `Zgodovinski ROI ${p.avgROI}% čez ${p.trades} prodaj.`,
        });
      }
    }

    // recommendedBrands: validate against KNOWN_BRANDS or historical brand list
    const historicalBrands = new Set(Array.from(brandMap.keys()));
    const recommendedBrands: RecBrand[] = [];
    if (aiAdvice?.recommendedBrands && Array.isArray(aiAdvice.recommendedBrands)) {
      for (const r of aiAdvice.recommendedBrands.slice(0, 5)) {
        if (r && typeof r === 'object' && typeof (r as RecBrand).brand === 'string') {
          const item = r as RecBrand;
          const brand = String(item.brand).toLowerCase().slice(0, 40);
          // Anti-hallucination: only accept brands that exist in our history
          if (historicalBrands.has(brand) || KNOWN_BRANDS.includes(brand)) {
            recommendedBrands.push({
              brand,
              confidence: Math.max(0, Math.min(100, Math.round(Number(item.confidence) || 0))),
              reason: typeof item.reason === 'string' ? item.reason.slice(0, 240) : '',
            });
          }
        }
      }
    }
    if (recommendedBrands.length === 0) {
      // Deterministic fallback: use top 3 performers
      for (const p of topPerformers.slice(0, 3)) {
        recommendedBrands.push({
          brand: p.brand,
          confidence: Math.min(100, 40 + p.trades * 5),
          reason: `${p.avgROI}% ROI čez ${p.trades} prodaj.`,
        });
      }
    }

    // priceRangeTarget: validate min/max sane
    let priceRangeTarget = { min: bestPriceRange.min, max: bestPriceRange.max };
    if (aiAdvice?.priceRangeTarget && typeof aiAdvice.priceRangeTarget === 'object') {
      const ptr = aiAdvice.priceRangeTarget as { min?: unknown; max?: unknown };
      const min = Number(ptr.min);
      const max = Number(ptr.max);
      if (Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max > min && max <= 100000) {
        priceRangeTarget = { min: Math.round(min), max: Math.round(max) };
      }
    }

    // diversificationAdvice
    let diversificationAdvice: string;
    if (aiAdvice?.diversificationAdvice && typeof aiAdvice.diversificationAdvice === 'string') {
      diversificationAdvice = aiAdvice.diversificationAdvice.slice(0, 400);
    } else {
      // Deterministic: based on overexposure
      if (overexposedCategories.length > 0) {
        diversificationAdvice = `Preveč izpostavljeni: ${overexposedCategories.map(c => `${c.category} (${c.percentage}%)`).join(', ')}. Zmanjšajte delež v teh kategorijah in diverzificirajte v druge.`;
      } else {
        diversificationAdvice = 'Portfolio je dobro diverzificiran — ohranjajte trenutno alokacijo in reinvestirajte v top performerje.';
      }
    }

    // avoidList: validate against historical data (avoid fabrication)
    const avoidList: string[] = [];
    if (aiAdvice?.avoidList && Array.isArray(aiAdvice.avoidList)) {
      for (const item of aiAdvice.avoidList.slice(0, 10)) {
        if (typeof item === 'string') {
          const lower = item.toLowerCase().slice(0, 40);
          // Accept only if it matches a known historical brand or category
          if (historicalBrands.has(lower) || KNOWN_BRANDS.includes(lower) || catMap.has(lower)) {
            avoidList.push(lower);
          }
        }
      }
    }
    // Deterministic fallback: avoid underperformers
    if (avoidList.length === 0) {
      for (const u of underperformers.slice(0, 3)) {
        avoidList.push(u.brand);
      }
    }

    // reasoning
    let reasoning: string;
    if (aiAdvice?.reasoning && typeof aiAdvice.reasoning === 'string') {
      reasoning = aiAdvice.reasoning.slice(0, 600);
    } else {
      const bestBrand = topPerformers[0]?.brand || 'neznan';
      const bestROI = topPerformers[0]?.avgROI ?? 0;
      reasoning = `Na podlagi ${soldTrades.length} prodaj je najboljši brand ${bestBrand} (${bestROI}% ROI). Reinvestiraj ${reinvestAmount}€ v ${bestBrand} in sorodne kategorije.`;
    }

    // confidence: clamp 0-100
    let confidence = 50;
    if (aiAdvice?.confidence != null) {
      const n = Number(aiAdvice.confidence);
      if (Number.isFinite(n)) {
        confidence = Math.max(0, Math.min(100, Math.round(n)));
      }
    } else {
      // Deterministic confidence: based on sample size
      const sampleFactor = Math.min(1, soldTrades.length / 30);
      confidence = Math.round(40 + sampleFactor * 50);
    }

    const recommendations = {
      reinvestAmount,
      recommendedCategories,
      recommendedBrands,
      priceRangeTarget,
      diversificationAdvice,
      avoidList,
    };

    const response = {
      ok: true,
      available: availabilityBlock,
      performance: performanceBlock,
      currentAllocation,
      recommendations,
      reasoning,
      confidence,
      aiUsed,
    };

    // 12) Cache (6h TTL)
    setCachedAI(cacheKey, {
      recommendations,
      reasoning,
      confidence,
    });

    return NextResponse.json(response);
  } catch (err: any) {
    logger.error('/api/ai/reinvestment-advisor', 'handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
