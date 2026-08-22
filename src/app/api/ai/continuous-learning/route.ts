// v6.32 / v8.95.9-refactor: AI Continuous Learning System — se uči iz prodajnih rezultatov za izboljšanje priporočil
// Refaktoriran z withAiRoute helperjem (v8.95.9) + enforceBudget guard.
//
// POST /api/ai/continuous-learning
// Body: {}
// Returns: { ok, learning: { patterns, accuracyMetrics, modelImprovements, feedbackLoop, recommendations } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ContinuousLearningInput {}

export const POST = withAiRoute<ContinuousLearningInput>({
  endpoint: '/api/ai/continuous-learning',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — body je prazen

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    // Pridobi VSE sold trades z AI ocenami za primerjavo napovedi vs dejanskih rezultatov
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true,
        sellPrice: true, sellFees: true, buyDate: true, sellDate: true,
        buyLocation: true, sellLocation: true,
        listing: { select: { aiScore: true, aiRisk: true, aiVerdict: true,
          aiEstimatedValue: true, dealScore: true, dealScoreReason: true } } },
      take: 200,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, learning: null, message: 'Ni prodaj za učenje.' });
    }

    // Analiza AI napovedi vs dejanski rezultati
    const accuracy = computeAccuracyStats(soldTrades);
    const catPerf = computeCategoryPerformance(soldTrades);
    const prompt = buildPrompt({
      soldCount: soldTrades.length,
      accuracy,
      catPerfStr: formatCategoryPerformance(catPerf),
      positiveCount: soldTrades.filter(t => (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0) > 0).length,
      negativeCount: soldTrades.filter(t => (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0) <= 0).length,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const learning = transformLearning(parsed, accuracy, soldTrades);

    return apiOk({ ok: true, learning });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface AccuracyStats {
  aiScoreAccuracy: number;
  aiScoreCorrect: number;
  aiScoreTotal: number;
  dealScoreAccuracy: number;
  dealScoreCorrect: number;
  dealScoreTotal: number;
  verdictAccuracy: number;
  verdictCorrect: number;
  verdictTotal: number;
  estValueAvgAccuracy: number;
}

function computeAccuracyStats(soldTrades: Array<{
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  listing: { aiScore: number | null; dealScore: number | null; aiVerdict: string | null; aiEstimatedValue: number | null } | null;
}>): AccuracyStats {
  let aiScoreCorrect = 0, aiScoreTotal = 0;
  let dealScoreCorrect = 0, dealScoreTotal = 0;
  let estValueAccuracy: number[] = [];
  let verdictCorrect = 0, verdictTotal = 0;

  for (const t of soldTrades) {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    const profit = revenue - cost;
    const wasProfitable = profit > 0;

    // AI Score accuracy (score >= 7 → should be profitable)
    if (t.listing?.aiScore != null) {
      aiScoreTotal++;
      if ((t.listing.aiScore >= 7 && wasProfitable) || (t.listing.aiScore < 5 && !wasProfitable)) {
        aiScoreCorrect++;
      }
    }

    // Deal Score accuracy (score >= 70 → should be profitable)
    if (t.listing?.dealScore != null) {
      dealScoreTotal++;
      if ((t.listing.dealScore >= 70 && wasProfitable) || (t.listing.dealScore < 40 && !wasProfitable)) {
        dealScoreCorrect++;
      }
    }

    // AI Verdict accuracy
    if (t.listing?.aiVerdict) {
      verdictTotal++;
      if ((t.listing.aiVerdict === 'PRILIKA' && wasProfitable) ||
          (t.listing.aiVerdict === 'NEZANIMIVO' && !wasProfitable)) {
        verdictCorrect++;
      }
    }

    // Estimated value accuracy
    if (t.listing?.aiEstimatedValue != null && revenue > 0) {
      const accuracy = 100 - Math.abs((t.listing.aiEstimatedValue - revenue) / Math.max(1, revenue) * 100);
      estValueAccuracy.push(Math.max(0, accuracy));
    }
  }

  return {
    aiScoreAccuracy: aiScoreTotal > 0 ? Math.round((aiScoreCorrect / aiScoreTotal) * 100) : 0,
    aiScoreCorrect, aiScoreTotal,
    dealScoreAccuracy: dealScoreTotal > 0 ? Math.round((dealScoreCorrect / dealScoreTotal) * 100) : 0,
    dealScoreCorrect, dealScoreTotal,
    verdictAccuracy: verdictTotal > 0 ? Math.round((verdictCorrect / verdictTotal) * 100) : 0,
    verdictCorrect, verdictTotal,
    estValueAvgAccuracy: estValueAccuracy.length > 0
      ? Math.round(estValueAccuracy.reduce((a, b) => a + b, 0) / estValueAccuracy.length) : 0,
  };
}

interface CategoryPerformance {
  count: number;
  profit: number;
  avgRoi: number;
  avgDays: number;
}

function computeCategoryPerformance(soldTrades: Array<{
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  buyDate: Date;
  sellDate: Date | null;
}>): Record<string, CategoryPerformance> {
  const catPerf: Record<string, CategoryPerformance> = {};
  for (const t of soldTrades) {
    const cat = t.category || 'drugo';
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - cost;
    if (!catPerf[cat]) catPerf[cat] = { count: 0, profit: 0, avgRoi: 0, avgDays: 0 };
    catPerf[cat].count++;
    catPerf[cat].profit += profit;
    catPerf[cat].avgRoi += cost > 0 ? (profit / cost) * 100 : 0;
    if (t.sellDate && t.buyDate) {
      catPerf[cat].avgDays += Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000));
    }
  }
  for (const cat of Object.keys(catPerf)) {
    catPerf[cat].avgRoi = Math.round(catPerf[cat].avgRoi / catPerf[cat].count);
    catPerf[cat].avgDays = Math.round(catPerf[cat].avgDays / catPerf[cat].count);
  }
  return catPerf;
}

function formatCategoryPerformance(catPerf: Record<string, CategoryPerformance>): string {
  return Object.entries(catPerf).sort(([,a],[,b]) => b.profit - a.profit).slice(0, 10)
    .map(([cat, d]) => `- ${cat}: ${d.count} prodaj, ${d.profit}€, ${d.avgRoi}% ROI, ${d.avgDays}d`).join('\n');
}

interface PromptData {
  soldCount: number;
  accuracy: AccuracyStats;
  catPerfStr: string;
  positiveCount: number;
  negativeCount: number;
}

function buildPrompt(d: PromptData): string {
  const a = d.accuracy;
  return `Si AI sistem za kontinuirano učenje iz prodajnih rezultatov.
Analiziraj točnost AI napovedi in priporoči izboljšave za prihodnje ocenjevanje.

AI NAPROVEDI VS DEJANSKI REZULTATI (${d.soldCount} prodaj):
- AI Score accuracy: ${a.aiScoreAccuracy}% (${a.aiScoreCorrect}/${a.aiScoreTotal} pravilnih)
- Deal Score accuracy: ${a.dealScoreAccuracy}% (${a.dealScoreCorrect}/${a.dealScoreTotal})
- AI Verdict accuracy: ${a.verdictAccuracy}% (${a.verdictCorrect}/${a.verdictTotal})
- Est. Value accuracy: ${a.estValueAvgAccuracy}% (povp. odstopanje od dejanske cene)

DOBIČEK PO KATEGORIJAH:
${d.catPerfStr}

Učna pravila:
1. Kategorije kjer AI Score > 7 a je bil profit < 0 → LAŽNO POSITIVNI (znižaj threshold)
2. Kategorije kjer AI Score < 5 a je bil profit > 0 → LAŽNO NEGATIVNI (dvigni threshold)
3. Kategorije z est. value odstopanjem > 30% → recalibriraj est. value za to kategorijo
4. Viri z visoko AI accuracy → daj večjo težo prihodnjim ocenam
5. Sezonski vpliv na accuracy (pozimi boljše napovedi za grelnike, itd.)

Odgovori LE z JSON:
{
  "insights": "<max 250 znakov>",
  "accuracy_metrics": {
    "ai_score_accuracy_pct": <number>,
    "deal_score_accuracy_pct": <number>,
    "verdict_accuracy_pct": <number>,
    "est_value_accuracy_pct": <number>,
    "overall_accuracy_pct": <number>,
    "trend": "<improving|stable|declining>"
  },
  "learned_patterns": [
    {
      "pattern": "<ime vzorca, max 80 znakov>",
      "confidence": <number 0-100>,
      "evidence_count": <number>,
      "implication": "<max 100 znakov>",
      "action": "<kaj spremeniti v AI ocenjevanju, max 100 znakov>"
    }
  ],
  "model_improvements": [
    {
      "area": "<ai_score|deal_score|est_value|verdict|risk_assessment>",
      "current_issue": "<max 80 znakov>",
      "recommended_fix": "<max 120 znakov>",
      "expected_improvement_pct": <number>,
      "priority": "<high|medium|low>"
    }
  ],
  "category_thresholds": [
    {
      "category": "<kategorija>",
      "current_ai_score_threshold": <number>,
      "recommended_threshold": <number>,
      "reasoning": "<max 80 znakov>"
    }
  ],
  "feedback_loop": {
    "positive_examples": <number>,
    "negative_examples": <number>,
    "false_positives": <number>,
    "false_negatives": <number>,
    "training_data_quality": "<high|medium|low>"
  },
  "recommendations": ["<priporočilo za izboljšanje, max 150 znakov>", "..."]
}`;
}

function transformLearning(parsed: any, accuracy: AccuracyStats, soldTrades: Array<{
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
}>): {
  insights: string;
  accuracyMetrics: any;
  learnedPatterns: any[];
  modelImprovements: any[];
  categoryThresholds: any[];
  feedbackLoop: any;
  recommendations: string[];
} {
  const positiveCount = soldTrades.filter(t => (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0) > 0).length;
  const negativeCount = soldTrades.filter(t => (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0) <= 0).length;

  return {
    insights: String(parsed?.insights ?? '').slice(0, 600),
    accuracyMetrics: {
      aiScoreAccuracyPct: Math.max(0, Math.min(100, Number(parsed?.accuracy_metrics?.ai_score_accuracy_pct ?? accuracy.aiScoreAccuracy))),
      dealScoreAccuracyPct: Math.max(0, Math.min(100, Number(parsed?.accuracy_metrics?.deal_score_accuracy_pct ?? accuracy.dealScoreAccuracy))),
      verdictAccuracyPct: Math.max(0, Math.min(100, Number(parsed?.accuracy_metrics?.verdict_accuracy_pct ?? accuracy.verdictAccuracy))),
      estValueAccuracyPct: Math.max(0, Math.min(100, Number(parsed?.accuracy_metrics?.est_value_accuracy_pct ?? accuracy.estValueAvgAccuracy))),
      overallAccuracyPct: Math.max(0, Math.min(100, Number(parsed?.accuracy_metrics?.overall_accuracy_pct ?? Math.round((accuracy.aiScoreAccuracy + accuracy.dealScoreAccuracy + accuracy.verdictAccuracy + accuracy.estValueAvgAccuracy) / 4)))),
      trend: ['improving', 'stable', 'declining'].includes(String(parsed?.accuracy_metrics?.trend)) ? String(parsed.accuracy_metrics.trend) : 'stable',
    },
    learnedPatterns: (parsed?.learned_patterns || []).slice(0, 8).map((p: any) => ({
      pattern: String(p?.pattern ?? '').slice(0, 150),
      confidence: Math.max(0, Math.min(100, Number(p?.confidence ?? 50))),
      evidenceCount: Math.max(0, Number(p?.evidence_count ?? 0)),
      implication: String(p?.implication ?? '').slice(0, 200),
      action: String(p?.action ?? '').slice(0, 200),
    })),
    modelImprovements: (parsed?.model_improvements || []).slice(0, 6).map((m: any) => ({
      area: String(m?.area ?? '').slice(0, 50),
      currentIssue: String(m?.current_issue ?? '').slice(0, 150),
      recommendedFix: String(m?.recommended_fix ?? '').slice(0, 250),
      expectedImprovementPct: Math.round(Number(m?.expected_improvement_pct ?? 0)),
      priority: ['high', 'medium', 'low'].includes(String(m?.priority)) ? String(m.priority) : 'medium',
    })),
    categoryThresholds: (parsed?.category_thresholds || []).slice(0, 8).map((c: any) => ({
      category: String(c?.category ?? '').slice(0, 50),
      currentAiScoreThreshold: Math.max(1, Math.min(10, Number(c?.current_ai_score_threshold ?? 7))),
      recommendedThreshold: Math.max(1, Math.min(10, Number(c?.recommended_threshold ?? 7))),
      reasoning: String(c?.reasoning ?? '').slice(0, 200),
    })),
    feedbackLoop: {
      positiveExamples: Math.max(0, Number(parsed?.feedback_loop?.positive_examples ?? positiveCount)),
      negativeExamples: Math.max(0, Number(parsed?.feedback_loop?.negative_examples ?? negativeCount)),
      falsePositives: Math.max(0, Number(parsed?.feedback_loop?.false_positives ?? 0)),
      falseNegatives: Math.max(0, Number(parsed?.feedback_loop?.false_negatives ?? 0)),
      trainingDataQuality: ['high', 'medium', 'low'].includes(String(parsed?.feedback_loop?.training_data_quality)) ? String(parsed.feedback_loop.training_data_quality) : 'medium',
    },
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => String(r).slice(0, 300)),
  };
}
