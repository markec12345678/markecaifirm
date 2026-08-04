// v6.32: AI Continuous Learning System — se uči iz prodajnih rezultatov za izboljšanje priporočil
// POST /api/ai/continuous-learning
// Body: {}
// Returns: { ok, learning: { patterns, accuracyMetrics, modelImprovements, feedbackLoop, recommendations } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    await req.json().catch(() => ({}));

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
      return NextResponse.json({ ok: true, learning: null, message: 'Ni prodaj za učenje.' });
    }

    // Analiza AI napovedi vs dejanski rezultati
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

    const aiScoreAccuracy = aiScoreTotal > 0 ? Math.round((aiScoreCorrect / aiScoreTotal) * 100) : 0;
    const dealScoreAccuracy = dealScoreTotal > 0 ? Math.round((dealScoreCorrect / dealScoreTotal) * 100) : 0;
    const verdictAccuracy = verdictTotal > 0 ? Math.round((verdictCorrect / verdictTotal) * 100) : 0;
    const estValueAvgAccuracy = estValueAccuracy.length > 0
      ? Math.round(estValueAccuracy.reduce((a, b) => a + b, 0) / estValueAccuracy.length) : 0;

    // Category performance za učenje
    const catPerf: Record<string, { count: number; profit: number; avgRoi: number; avgDays: number }> = {};
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

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const catStr = Object.entries(catPerf).sort(([,a],[,b]) => b.profit - a.profit).slice(0, 10)
      .map(([cat, d]) => `- ${cat}: ${d.count} prodaj, ${d.profit}€, ${d.avgRoi}% ROI, ${d.avgDays}d`).join('\n');

    const prompt = `Si AI sistem za kontinuirano učenje iz prodajnih rezultatov.
Analiziraj točnost AI napovedi in priporoči izboljšave za prihodnje ocenjevanje.

AI NAPROVEDI VS DEJANSKI REZULTATI (${soldTrades.length} prodaj):
- AI Score accuracy: ${aiScoreAccuracy}% (${aiScoreCorrect}/${aiScoreTotal} pravilnih)
- Deal Score accuracy: ${dealScoreAccuracy}% (${dealScoreCorrect}/${dealScoreTotal})
- AI Verdict accuracy: ${verdictAccuracy}% (${verdictCorrect}/${verdictTotal})
- Est. Value accuracy: ${estValueAvgAccuracy}% (povp. odstopanje od dejanske cene)

DOBIČEK PO KATEGORIJAH:
${catStr}

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

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);

    const learning = {
      insights: String(parsed?.insights ?? '').slice(0, 600),
      accuracyMetrics: {
        aiScoreAccuracyPct: Math.max(0, Math.min(100, Number(parsed?.accuracy_metrics?.ai_score_accuracy_pct ?? aiScoreAccuracy))),
        dealScoreAccuracyPct: Math.max(0, Math.min(100, Number(parsed?.accuracy_metrics?.deal_score_accuracy_pct ?? dealScoreAccuracy))),
        verdictAccuracyPct: Math.max(0, Math.min(100, Number(parsed?.accuracy_metrics?.verdict_accuracy_pct ?? verdictAccuracy))),
        estValueAccuracyPct: Math.max(0, Math.min(100, Number(parsed?.accuracy_metrics?.est_value_accuracy_pct ?? estValueAvgAccuracy))),
        overallAccuracyPct: Math.max(0, Math.min(100, Number(parsed?.accuracy_metrics?.overall_accuracy_pct ?? Math.round((aiScoreAccuracy + dealScoreAccuracy + verdictAccuracy + estValueAvgAccuracy) / 4)))),
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
        positiveExamples: Math.max(0, Number(parsed?.feedback_loop?.positive_examples ?? soldTrades.filter(t => (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0) > 0).length)),
        negativeExamples: Math.max(0, Number(parsed?.feedback_loop?.negative_examples ?? soldTrades.filter(t => (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0) <= 0).length)),
        falsePositives: Math.max(0, Number(parsed?.feedback_loop?.false_positives ?? 0)),
        falseNegatives: Math.max(0, Number(parsed?.feedback_loop?.false_negatives ?? 0)),
        trainingDataQuality: ['high', 'medium', 'low'].includes(String(parsed?.feedback_loop?.training_data_quality)) ? String(parsed.feedback_loop.training_data_quality) : 'medium',
      },
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => String(r).slice(0, 300)),
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, learning });
  } catch (e: any) {
    logger.error("/api/ai/continuous-learning", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
