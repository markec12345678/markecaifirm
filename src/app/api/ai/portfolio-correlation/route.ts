// v6.12 / v8.96.1-batch3: AI Multi-Asset Portfolio Correlation — analiza korelacij med kategorijami
// Refaktoriran z withAiRoute helperjem (v8.96.1-batch3) + enforceBudget guard.
//
// POST /api/ai/portfolio-correlation
// Body: {}
// Returns: { ok, correlations: Array<{ catA, catB, correlation, relationship, insight }>,
//            clusters: Array<{ name, categories, characteristic }>,
//            diversification: { score, concentrationRisk, suggestions },
//            insights }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface PortfolioCorrelationInput {}

// Pearson correlation coefficient
function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const sumX = x.slice(0, n).reduce((a, b) => a + b, 0);
  const sumY = y.slice(0, n).reduce((a, b) => a + b, 0);
  const sumXY = x.slice(0, n).reduce((a, _, i) => a + x[i] * y[i], 0);
  const sumX2 = x.slice(0, n).reduce((a, b) => a + b * b, 0);
  const sumY2 = y.slice(0, n).reduce((a, b) => a + b * b, 0);
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (den === 0) return 0;
  return num / den;
}

export const POST = withAiRoute<PortfolioCorrelationInput>({
  endpoint: '/api/ai/portfolio-correlation',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {} as PortfolioCorrelationInput;
  },

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    // 1. Pridobi vse sold tradeove
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: {
        title: true, category: true, buyPrice: true, sellPrice: true,
        buyDate: true, sellDate: true, sellFees: true, buyFees: true,
      },
      take: 500,
    });

    // 2. Pridobi held trades za trenutno alokacijo
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true },
    });

    if (soldTrades.length < 5 && heldTrades.length < 3) {
      return apiOk({
        ok: true,
        correlations: [],
        message: 'Ni dovolj podatkov za analizo korelacij (potrebnih vsaj 5 prodaj ali 3 aktivni itemi).',
      });
    }

    // 3. Časovne serije profitov po kategorijah (mesečni)
    const now = new Date();
    const monthsBack = 12;
    const categoryMonthlyProfit: Record<string, number[]> = {};
    const categoriesSet = new Set<string>();

    for (const t of soldTrades) {
      const cat = t.category || 'drugo';
      categoriesSet.add(cat);
      if (!categoryMonthlyProfit[cat]) {
        categoryMonthlyProfit[cat] = new Array(monthsBack).fill(0);
      }
      if (t.sellDate) {
        const monthsAgo = (now.getFullYear() - t.sellDate.getFullYear()) * 12 + (now.getMonth() - t.sellDate.getMonth());
        if (monthsAgo >= 0 && monthsAgo < monthsBack) {
          const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
          categoryMonthlyProfit[cat][monthsBack - 1 - monthsAgo] += profit;
        }
      }
    }

    // 4. Trenutna alokacija
    const currentAllocation: Record<string, { invested: number; count: number }> = {};
    for (const t of heldTrades) {
      const cat = t.category || 'drugo';
      if (!currentAllocation[cat]) currentAllocation[cat] = { invested: 0, count: 0 };
      currentAllocation[cat].invested += t.buyPrice + (t.buyFees ?? 0);
      currentAllocation[cat].count++;
    }
    const totalInvested = Object.values(currentAllocation).reduce((s, c) => s + c.invested, 0);

    // 5. Izračun korelacij med kategorijami
    const categories = Object.keys(categoryMonthlyProfit);
    const correlations: Array<{ catA: string; catB: string; correlation: number }> = [];
    for (let i = 0; i < categories.length; i++) {
      for (let j = i + 1; j < categories.length; j++) {
        const corr = pearson(categoryMonthlyProfit[categories[i]], categoryMonthlyProfit[categories[j]]);
        if (!Number.isNaN(corr)) {
          correlations.push({ catA: categories[i], catB: categories[j], correlation: Math.round(corr * 100) / 100 });
        }
      }
    }
    correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

    // 6. Koncentracijski risk (Herfindahl-Hirschman index)
    const hhi = totalInvested > 0
      ? Object.values(currentAllocation).reduce((s, c) => s + Math.pow((c.invested / totalInvested) * 100, 2), 0)
      : 0;
    const concentrationRisk = hhi > 2500 ? 'high' : hhi > 1500 ? 'medium' : 'low';
    const topCatPct = totalInvested > 0
      ? Math.max(...Object.values(currentAllocation).map(c => (c.invested / totalInvested) * 100))
      : 0;

    // 7. AI analiza
    const topCorrelations = correlations.slice(0, 15).map(c =>
      `- ${c.catA} ↔ ${c.catB}: ${c.correlation > 0 ? '+' : ''}${c.correlation} (${c.correlation > 0.5 ? 'močno pozitivna' : c.correlation > 0.2 ? 'šibko pozitivna' : c.correlation < -0.5 ? 'močno negativna' : c.correlation < -0.2 ? 'šibko negativna' : 'neznačilna'})`
    ).join('\n');

    const allocationStr = Object.entries(currentAllocation)
      .sort(([, a], [, b]) => b.invested - a.invested)
      .map(([cat, c]) => `- ${cat}: ${c.invested}€ (${c.count} itemov, ${Math.round((c.invested / Math.max(1, totalInvested)) * 100)}%)`)
      .join('\n');

    const prompt = buildPrompt(allocationStr, totalInvested, hhi, concentrationRisk, topCatPct, topCorrelations);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    return apiOk(transformResponse(
      parsed, correlations, concentrationRisk, categories,
      totalInvested, hhi, topCatPct, heldTrades.length, soldTrades.length,
    ));
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildPrompt(
  allocationStr: string,
  totalInvested: number,
  hhi: number,
  concentrationRisk: string,
  topCatPct: number,
  topCorrelations: string
): string {
  return `Si ekspert za portfolio management in analizo korelacij med razreda sredstev.
Analiziraj korelacije med kategorijami v portfoliu in predlagaj diverzifikacijo.

TRENUTNA ALOKACIJA:
${allocationStr || '- Ni podatkov'}
Skupna investicija: ${totalInvested}€
Koncentracijski indeks (HHI): ${Math.round(hhi)} (${concentrationRisk} risk)
Največja kategorija: ${Math.round(topCatPct)}% portfolia

KORELACIJE MEDI KATEGORIJAMI (mesečni profit, zadnjih 12m):
${topCorrelations || '- Ni dovolj podatkov'}

Pravila za interpretacijo:
- Korelacija > 0.5: kategoriji se gibljeta skupaj (sinhrono) — slaba diverzifikacija
- Korelacija 0.2 do 0.5: šibko povezane
- Korelacija -0.2 do 0.2: neodvisne — dobra diverzifikacija
- Korelacija < -0.2: nasprotno gibejoče — odlična diverzifikacija (hedging)

Identificiraj:
1. Clusters: skupine kategorij ki so močno korelirane (>0.5) — sinhrone rizike
2. Hedging opportunities: parke z negativno korelacijo
3. Diverzifikacijski predlogi: katere kategorije dodati za boljši mix
4. Koncentracijska tveganja: katere kategorije preveč dominirajo

Odgovori LE z JSON:
{
  "insights": "<splošne ugotovitve o portfoliu, max 300 znakov>",
  "clusters": [
    {
      "name": "<ime clusterja, npr. 'Tech bundle'>",
      "categories": ["<cat1>", "<cat2>"],
      "characteristic": "<skupna značilnost, max 100 znakov>",
      "risk": "<high|medium|low>"
    }
  ],
  "diversification": {
    "score": <number 0-100>,
    "concentration_risk": "<low|medium|high>",
    "top_risks": ["<tveganje, max 100 znakov>", "..."],
    "suggestions": ["<predlog diverzifikacije, max 150 znakov>", "..."]
  },
  "hedging_opportunities": [
    {
      "category": "<kategorija za dodajanje>",
      "hedges_against": "<katero kategorijo>",
      "expected_correlation": <number -1 do 1>,
      "reasoning": "<max 100 znakov>"
    }
  ]
}`;
}

function transformResponse(
  parsed: any,
  correlations: Array<{ catA: string; catB: string; correlation: number }>,
  concentrationRisk: string,
  categories: string[],
  totalInvested: number,
  hhi: number,
  topCatPct: number,
  heldItemsCount: number,
  soldTradesAnalyzedCount: number
): any {
  const clusters = (parsed?.clusters || []).slice(0, 6).map((c: any) => ({
    name: String(c?.name ?? '').slice(0, 80),
    categories: Array.isArray(c?.categories) ? c.categories.slice(0, 6).map((cat: any) => String(cat).slice(0, 50)) : [],
    characteristic: String(c?.characteristic ?? '').slice(0, 200),
    risk: ['low', 'medium', 'high'].includes(String(c?.risk)) ? String(c.risk) : 'medium',
  }));

  const diversification = {
    score: Math.max(0, Math.min(100, Number(parsed?.diversification?.score ?? 50))),
    concentrationRisk: ['low', 'medium', 'high'].includes(String(parsed?.diversification?.concentration_risk))
      ? String(parsed.diversification.concentration_risk) : concentrationRisk,
    topRisks: Array.isArray(parsed?.diversification?.top_risks)
      ? parsed.diversification.top_risks.slice(0, 5).map((r: any) => String(r).slice(0, 200))
      : [],
    suggestions: Array.isArray(parsed?.diversification?.suggestions)
      ? parsed.diversification.suggestions.slice(0, 6).map((s: any) => String(s).slice(0, 250))
      : [],
  };

  const hedgingOpportunities = (parsed?.hedging_opportunities || []).slice(0, 5).map((h: any) => ({
    category: String(h?.category ?? '').slice(0, 50),
    hedgesAgainst: String(h?.hedges_against ?? '').slice(0, 50),
    expectedCorrelation: Math.max(-1, Math.min(1, Number(h?.expected_correlation ?? 0))),
    reasoning: String(h?.reasoning ?? '').slice(0, 200),
  }));

  // Top correlations z oznakami
  const topCorrAnnotated = correlations.slice(0, 10).map(c => ({
    ...c,
    strength: c.correlation > 0.5 ? 'strong_positive' :
              c.correlation > 0.2 ? 'weak_positive' :
              c.correlation < -0.5 ? 'strong_negative' :
              c.correlation < -0.2 ? 'weak_negative' : 'neutral',
  }));

  return {
    ok: true,
    insights: String(parsed?.insights ?? '').slice(0, 600),
    correlations: topCorrAnnotated,
    clusters,
    diversification,
    hedgingOpportunities,
    summary: {
      totalCategories: categories.length,
      totalCorrelations: correlations.length,
      totalInvested,
      hhi: Math.round(hhi),
      topCatPct: Math.round(topCatPct),
      heldItems: heldItemsCount,
      soldTradesAnalyzed: soldTradesAnalyzedCount,
    },
  };
}
