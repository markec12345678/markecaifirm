// v6.29 / v8.94-refactor: AI A/B Test Results Analyzer — analizira rezultate A/B testov naslovov in opisov
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/abtest-results
// Body: {}
// Returns: { ok, analysis: { tests: [], patterns, winners, insights }, summary }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Input {}

interface SoldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  buyDate: Date | null;
  sellDate: Date | null;
  buyLocation: string | null;
  sellLocation: string | null;
}

interface PatternStats {
  count: number;
  avgProfit: number;
  avgDays: number;
  avgRoi: number;
}

const TITLE_PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> = [
  { name: 'includes_brand', regex: /\b(iphone|samsung|apple|sony|nike|adidas|bosch|bosch|bmw|audi|vw|mercedes)\b/i },
  { name: 'includes_condition', regex: /\b(novo|nov|kot novo|odlično|brez napak|rabljeno|poškodovano)\b/i },
  { name: 'includes_urgency', regex: /\b(nujno|hitro|akcija|cena padla|zadnji)\b/i },
  { name: 'includes_guarantee', regex: /\b(garancija|račun|faktura|original|embalaža)\b/i },
  { name: 'short_title', regex: /^.{1,30}$/ },
  { name: 'long_title', regex: /^.{50,}$/ },
  { name: 'includes_number', regex: /\d/ },
  { name: 'includes_size', regex: /\b(velikost|M|L|XL|XXL|42|43|44|45)\b/i },
];

export const POST = withAiRoute<Input>({
  endpoint: '/api/ai/abtest-results',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async () => ({}),

  // No validateInput — body ni uporabljen
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    // 1. Pridobi sold trades za analizo A/B vzorcev
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true,
        sellPrice: true, sellFees: true, buyDate: true, sellDate: true,
        buyLocation: true, sellLocation: true },
      take: 200,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, analysis: null, message: 'Ni prodaj za A/B analizo.' });
    }

    // 2. Analiziraj vzorce v naslovih in kategorijah
    const titlePatterns = analyzeTitlePatterns(soldTrades);

    // 3. AI analiza
    const patternStr = formatPatternStr(titlePatterns);
    const topSales = formatTopSales(soldTrades);
    const prompt = buildAbTestPrompt(patternStr, topSales);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const analysis = transformAbTestResult(parsed);

    return apiOk({ ok: true, analysis });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function analyzeTitlePatterns(soldTrades: SoldTradeRow[]): Record<string, PatternStats> {
  const titlePatterns: Record<string, PatternStats> = {};
  for (const t of soldTrades) {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    const profit = revenue - cost;
    const roi = cost > 0 ? (profit / cost) * 100 : 0;
    const days = t.sellDate && t.buyDate ? Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000)) : 30;
    for (const p of TITLE_PATTERNS) {
      if (p.regex.test(t.title)) {
        if (!titlePatterns[p.name]) titlePatterns[p.name] = { count: 0, avgProfit: 0, avgDays: 0, avgRoi: 0 };
        titlePatterns[p.name].count++;
        titlePatterns[p.name].avgProfit += profit;
        titlePatterns[p.name].avgDays += days;
        titlePatterns[p.name].avgRoi += roi;
      }
    }
  }
  for (const p of Object.keys(titlePatterns)) {
    titlePatterns[p].avgProfit = Math.round(titlePatterns[p].avgProfit / titlePatterns[p].count);
    titlePatterns[p].avgDays = Math.round(titlePatterns[p].avgDays / titlePatterns[p].count);
    titlePatterns[p].avgRoi = Math.round(titlePatterns[p].avgRoi / titlePatterns[p].count);
  }
  return titlePatterns;
}

function formatPatternStr(titlePatterns: Record<string, PatternStats>): string {
  return Object.entries(titlePatterns)
    .sort(([, a], [, b]) => b.avgProfit - a.avgProfit)
    .map(([name, d]) => `- ${name}: ${d.count} prodaj, povp. ${d.avgProfit}€ dobička, ${d.avgRoi}% ROI, ${d.avgDays}d`)
    .join('\n');
}

function formatTopSales(soldTrades: SoldTradeRow[]): string {
  return [...soldTrades].sort((a, b) => {
    const pa = (b.sellPrice ?? 0) - (b.sellFees ?? 0) - b.buyPrice - (b.buyFees ?? 0);
    const pb = (a.sellPrice ?? 0) - (a.sellFees ?? 0) - a.buyPrice - (a.buyFees ?? 0);
    return pa - pb;
  }).slice(0, 10).map(t => `- "${t.title}" | ${t.category} | ${(t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)}€ | ${t.buyLocation} → ${t.sellLocation}`).join('\n');
}

function buildAbTestPrompt(patternStr: string, topSales: string): string {
  return `Si ekspert za A/B test analizo in optimizacijo oglasov.
Analiziraj rezultate preteklih prodaj in identificiraj vzorce uspeha.

VZORCI V NASLOVIH (A/B rezultati):
${patternStr}

TOP 10 PRODAJ:
${topSales}

Pravila analize:
1. Kateri vzorci v naslovih prinašajo največ dobička?
2. Kateri vzorci skrajšajo čas do prodaje?
3. Kateri viri nakupa (buyLocation) so najbolj profitabilni?
4. Kateri prodajni kanali (sellLocation) prinašajo najvišje cene?
5. Identificiraj "winning formula" za naslove

Odgovori LE z JSON:
{
  "insights": "<max 250 znakov>",
  "pattern_analysis": [
    {
      "pattern": "<ime vzorca>",
      "count": <number>,
      "avg_profit_eur": <number>,
      "avg_roi_pct": <number>,
      "avg_days_to_sell": <number>,
      "performance": "<above_average|average|below_average>",
      "recommendation": "<always_include|sometimes_include|avoid|neutral>",
      "reasoning": "<max 80 znakov>"
    }
  ],
  "winning_formula": {
    "title_structure": "<kakšna struktura naslova dela najbolje, max 150 znakov>",
    "must_include": ["<element, max 50 znakov>", "..."],
    "must_avoid": ["<element, max 50 znakov>", "..."],
    "optimal_length": "<kratki<srednji|dolgi>",
    "example_title": "<primer optimalnega naslova, max 100 znakov>"
  },
  "source_channel_analysis": [
    {
      "source": "<vir nakupa>",
      "avg_profit_eur": <number>,
      "count": <number>,
      "best_sell_channel": "<kje najbolje prodati>",
      "reasoning": "<max 80 znakov>"
    }
  ],
  "summary": {
    "best_pattern": "<vzorec>",
    "worst_pattern": "<vzorec>",
    "total_patterns_analyzed": <number>,
    "winning_formula_confidence_pct": <number>,
    "expected_improvement_pct": <number>
  }
`;
}

function transformAbTestResult(parsed: any) {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 600),
    patternAnalysis: (parsed?.pattern_analysis || []).slice(0, 10).map((p: any) => ({
      pattern: String(p?.pattern ?? '').slice(0, 50),
      count: Math.max(0, Number(p?.count ?? 0)),
      avgProfitEur: Math.round(Number(p?.avg_profit_eur ?? 0)),
      avgRoiPct: Math.round(Number(p?.avg_roi_pct ?? 0)),
      avgDaysToSell: Math.max(0, Number(p?.avg_days_to_sell ?? 0)),
      performance: ['above_average', 'average', 'below_average'].includes(String(p?.performance)) ? String(p.performance) : 'average',
      recommendation: ['always_include', 'sometimes_include', 'avoid', 'neutral'].includes(String(p?.recommendation)) ? String(p.recommendation) : 'neutral',
      reasoning: String(p?.reasoning ?? '').slice(0, 150),
    })),
    winningFormula: {
      titleStructure: String(parsed?.winning_formula?.title_structure ?? '').slice(0, 300),
      mustInclude: (parsed?.winning_formula?.must_include || []).slice(0, 5).map((m: any) => String(m).slice(0, 100)),
      mustAvoid: (parsed?.winning_formula?.must_avoid || []).slice(0, 4).map((m: any) => String(m).slice(0, 100)),
      optimalLength: ['kratki', 'srednji', 'dolgi'].includes(String(parsed?.winning_formula?.optimal_length)) ? String(parsed.winning_formula.optimal_length) : 'srednji',
      exampleTitle: String(parsed?.winning_formula?.example_title ?? '').slice(0, 200),
    },
    sourceChannelAnalysis: (parsed?.source_channel_analysis || []).slice(0, 8).map((s: any) => ({
      source: String(s?.source ?? '').slice(0, 50),
      avgProfitEur: Math.round(Number(s?.avg_profit_eur ?? 0)),
      count: Math.max(0, Number(s?.count ?? 0)),
      bestSellChannel: String(s?.best_sell_channel ?? '').slice(0, 50),
      reasoning: String(s?.reasoning ?? '').slice(0, 200),
    })),
    summary: {
      bestPattern: String(parsed?.summary?.best_pattern ?? '').slice(0, 50),
      worstPattern: String(parsed?.summary?.worst_pattern ?? '').slice(0, 50),
      totalPatternsAnalyzed: Math.max(0, Number(parsed?.summary?.total_patterns_analyzed ?? 0)),
      winningFormulaConfidencePct: Math.max(0, Math.min(100, Number(parsed?.summary?.winning_formula_confidence_pct ?? 50))),
      expectedImprovementPct: Math.round(Number(parsed?.summary?.expected_improvement_pct ?? 0)),
    },
  };
}
