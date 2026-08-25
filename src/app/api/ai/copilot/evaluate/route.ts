// v9.63: Trigger outcome evaluation for executed Copilot suggestions.
//
// POST /api/ai/copilot/evaluate
// Evaluates all executed suggestions that don't have outcomes yet.
// Called when a trade is sold, or by cron (daily).
//
// Also can be triggered manually from UI ("Preveri outcome" button).

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { evaluatePendingOutcomes } from '@/lib/copilot/outcome-evaluator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(_req: NextRequest) {
  try {
    const result = await evaluatePendingOutcomes();

    logger.info('/api/ai/copilot/evaluate', `Checked ${result.checked}, evaluated ${result.evaluated}, correct ${result.correct}, incorrect ${result.incorrect}`);

    return NextResponse.json({
      ok: true,
      ...result,
      message: result.evaluated > 0
        ? `Evalvirano ${result.evaluated} od ${result.checked} predlogov. ${result.correct} pravilnih, ${result.incorrect} napačnih.`
        : `Preverjenih ${result.checked} predlogov — noben še nima končnega izida (trades še niso prodani).`,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error('/api/ai/copilot/evaluate', 'POST failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka pri evalvaciji' },
      { status: 500 }
    );
  }
}
