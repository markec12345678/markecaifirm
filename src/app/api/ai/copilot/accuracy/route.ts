// v9.63: Copilot Decision Accuracy — Financial Impact + breakdown.
//
// Endpoint: GET /api/ai/copilot/accuracy
// Returns: Decision Accuracy %, Financial Impact, breakdown by type, time to outcome
//
// Ne prikazuje izmišljenih številk — če ni dovolj podatkov, vrne null.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET() {
  try {
    // Fetch all suggestions with outcomes recorded
    const withOutcome = await db.copilotSuggestion.findMany({
      where: { status: 'outcome_recorded', wasCorrect: { not: null } },
      select: {
        id: true,
        type: true,
        priority: true,
        wasCorrect: true,
        wasCorrectRule: true,
        wasCorrectReason: true,
        actualProfit: true,
        actualRoi: true,
        expectedProfit: true,
        expectedRoi: true,
        confidenceAtSuggestion: true,
        timeToOutcomeDays: true,
        executedAt: true,
        outcomeRecordedAt: true,
      },
    });

    const total = withOutcome.length;
    const correct = withOutcome.filter((s) => s.wasCorrect === true).length;
    const incorrect = total - correct;
    const decisionAccuracy = total > 0 ? Math.round((correct / total) * 100) : null;

    // Financial Impact = sum of actualProfit for correct - sum of |actualProfit| for incorrect
    const financialImpact = withOutcome.reduce((sum, s) => {
      const profit = s.actualProfit ?? 0;
      return sum + profit;
    }, 0);

    // Breakdown by type
    const byType: Record<string, { total: number; correct: number; incorrect: number; avgProfit: number; avgRoi: number }> = {};
    for (const s of withOutcome) {
      if (!byType[s.type]) byType[s.type] = { total: 0, correct: 0, incorrect: 0, avgProfit: 0, avgRoi: 0 };
      byType[s.type].total++;
      if (s.wasCorrect) byType[s.type].correct++;
      else byType[s.type].incorrect++;
      byType[s.type].avgProfit += s.actualProfit ?? 0;
      byType[s.type].avgRoi += s.actualRoi ?? 0;
    }

    // Convert averages
    for (const type of Object.keys(byType)) {
      const t = byType[type];
      t.avgProfit = t.total > 0 ? Math.round(t.avgProfit / t.total) : 0;
      t.avgRoi = t.total > 0 ? Math.round(t.avgRoi / t.total) : 0;
    }

    // Average time to outcome
    const timesToOutcome = withOutcome
      .filter((s) => s.timeToOutcomeDays !== null)
      .map((s) => s.timeToOutcomeDays as number);
    const avgTimeToOutcome = timesToOutcome.length > 0
      ? Math.round(timesToOutcome.reduce((a, b) => a + b, 0) / timesToOutcome.length)
      : null;

    // Confidence vs actual accuracy (correlation)
    const withConfidence = withOutcome.filter((s) => s.confidenceAtSuggestion !== null);
    const avgConfidence = withConfidence.length > 0
      ? Math.round(withConfidence.reduce((sum, s) => sum + (s.confidenceAtSuggestion ?? 0), 0) / withConfidence.length)
      : null;

    // Rules used
    const rulesUsed: Record<string, number> = {};
    for (const s of withOutcome) {
      const rule = s.wasCorrectRule ?? 'unknown';
      rulesUsed[rule] = (rulesUsed[rule] ?? 0) + 1;
    }

    // Recent outcomes (zadnjih 10)
    const recent = withOutcome
      .sort((a, b) => (b.outcomeRecordedAt?.getTime() ?? 0) - (a.outcomeRecordedAt?.getTime() ?? 0))
      .slice(0, 10)
      .map((s) => ({
        type: s.type,
        wasCorrect: s.wasCorrect,
        actualProfit: s.actualProfit,
        actualRoi: s.actualRoi,
        timeToOutcomeDays: s.timeToOutcomeDays,
        wasCorrectRule: s.wasCorrectRule,
        reason: s.wasCorrectReason,
      }));

    return NextResponse.json({
      ok: true,
      // Core metrics
      totalOutcomes: total,
      correct,
      incorrect,
      decisionAccuracy, // % — null if no outcomes
      financialImpact: Math.round(financialImpact), // EUR — sum of all actualProfit
      // Additional metrics
      avgTimeToOutcomeDays: avgTimeToOutcome,
      avgConfidenceAtSuggestion: avgConfidence,
      // Breakdown
      byType,
      rulesUsed,
      recentOutcomes: recent,
      // Status
      hasEnoughData: total >= 10, // priporočamo vsaj 10 outcomes za smiselno statistiko
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error('/api/ai/copilot/accuracy', 'GET failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka pri pridobivanju accuracy' },
      { status: 500 }
    );
  }
}
