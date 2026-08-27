// v9.80: Fast Outcome Capture — ročni vnos dejanskega rezultata.
//
// Problem (po predlogu uporabnika):
//   Da se AI res meri na rezultatih, mora uporabnik lahko hitro (10-20s)
//   zabeležiti kaj se je dejansko zgodilo z Copilot predlogom.
//
// Pred tem: outcomes so se avtomatsko evalvirali samo ko je trade postal 'sold'
// (kar se redko zgodi v demo okolju). Realni podatki so bili skoraj nikoli zbrani.
//
// Zdaj: uporabnik izbere enega od 4 izidov in vnese realne številke.
//
// IZIDI:
//   sold             → uporabnik je kupil in prodal. Vnese cene → wasCorrect = dobiček >= 0
//   not_bought       → uporabnik se odločil ne kupiti. wasCorrect = null (ne preverjeno)
//   not_executed     → uporabnik nikoli izvedel akcije. wasCorrect = null
//   wrong_prediction → uporabnik eksplicitno označil napoved kot napačno. wasCorrect = false
//
// EFFECT ON DECISION ACCURACY:
//   - "sold" in "wrong_prediction" se štejejo v imenovalec (in numerator če pravilni)
//   - "not_bought" in "not_executed" se NE štejejo (wasCorrect=null) — ne vplivajo na %
//
// TILOVANJE Z EXISTING EVALUATORjem:
//   - Ta endpoint NE klice outcome-evaluator.ts (ki zahteva Trade v DB)
//   - Ta endpoint direktno zapiše outcome polja v CopilotSuggestion
//   - wasCorrectRule = "manual_entry_sold" | "manual_no_action" | "manual_wrong_prediction"

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const VALID_OUTCOME_TYPES = ['sold', 'not_bought', 'not_executed', 'wrong_prediction'] as const;
type OutcomeType = typeof VALID_OUTCOME_TYPES[number];

interface OutcomeBody {
  outcomeType: OutcomeType;
  // samo za 'sold':
  actualBuyPrice?: number | string;
  actualSellPrice?: number | string;
  actualCosts?: number | string;
  referencePoint?: string;
  // splošno:
  note?: string;
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as OutcomeBody;
    const { outcomeType } = body;

    if (!outcomeType || !VALID_OUTCOME_TYPES.includes(outcomeType)) {
      return NextResponse.json(
        { ok: false, error: `Manjka outcomeType. Možnosti: ${VALID_OUTCOME_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    const suggestion = await db.copilotSuggestion.findUnique({ where: { id } });
    if (!suggestion) {
      return NextResponse.json({ ok: false, error: 'Predlog ni najden' }, { status: 404 });
    }

    // Ne dovoli dvojnega zapisovanja izida
    if (suggestion.status === 'outcome_recorded') {
      return NextResponse.json({
        ok: false,
        error: 'Izid je že zabeležen za ta predlog.',
      }, { status: 400 });
    }

    // Ne dovoli za rejected predloge (že odločeno)
    if (suggestion.status === 'rejected') {
      return NextResponse.json({
        ok: false,
        error: 'Predlog je bil zavrnjen — izid se ne more več zabeležiti.',
      }, { status: 400 });
    }

    const now = new Date();
    const note = (body.note ?? '').trim();
    const referencePoint = (body.referencePoint ?? '').trim() || null;

    // Izračunaj wasCorrect, outcome, actualProfit, actualRoi glede na tip
    let wasCorrect: boolean | null = null;
    let outcome: 'profit' | 'loss' | 'neutral' = 'neutral';
    let actualProfit: number | null = null;
    let actualRoi: number | null = null;
    let wasCorrectRule = '';
    let wasCorrectReason = '';
    let actualBuyPrice: number | null = null;
    let actualSellPrice: number | null = null;
    let actualCosts: number | null = null;

    if (outcomeType === 'sold') {
      actualBuyPrice = toNum(body.actualBuyPrice);
      actualSellPrice = toNum(body.actualSellPrice);
      actualCosts = toNum(body.actualCosts) ?? 0;

      if (actualBuyPrice == null || actualSellPrice == null) {
        return NextResponse.json({
          ok: false,
          error: 'Za "Uspešno prodano" moraš vnesti kupno in prodajno ceno.',
        }, { status: 400 });
      }

      const cost = actualBuyPrice + actualCosts;
      const revenue = actualSellPrice;
      actualProfit = Math.round((revenue - cost) * 100) / 100;
      actualRoi = cost > 0 ? Math.round((actualProfit / cost) * 1000) / 10 : 0; // 1 decimal
      wasCorrect = actualProfit >= 0; // 0€ = še vedno "pravilno" (vsaj nominalno)
      outcome = actualProfit > 0 ? 'profit' : actualProfit < 0 ? 'loss' : 'neutral';

      wasCorrectRule = 'manual_entry_sold';
      wasCorrectReason = `Dejansko: kupljeno ${actualBuyPrice}€, prodano ${actualSellPrice}€, stroški ${actualCosts}€. ` +
        `Dobiček: ${actualProfit >= 0 ? '+' : ''}${actualProfit}€ (ROI ${actualRoi}%).`;
      if (suggestion.expectedProfit && suggestion.expectedProfit > 0) {
        const diff = actualProfit - suggestion.expectedProfit;
        if (diff >= 0) {
          wasCorrectReason += ` AI je napovedal +${suggestion.expectedProfit}€ — realnost je presegla napoved za +${Math.round(diff)}€.`;
        } else {
          wasCorrectReason += ` AI je napovedal +${suggestion.expectedProfit}€ — realnost je bila za ${Math.round(Math.abs(diff))}€ pod napovedjo.`;
        }
      }
      if (referencePoint) {
        wasCorrectReason += ` Referenca: ${referencePoint}.`;
      }
    } else if (outcomeType === 'not_bought') {
      wasCorrect = null;
      outcome = 'neutral';
      wasCorrectRule = 'manual_no_action';
      wasCorrectReason = note
        ? `Uporabnik se ni odločil kupiti. Razlog: ${note}`
        : 'Uporabnik se ni odločil kupiti — napoved ni bila preverjena.';
    } else if (outcomeType === 'not_executed') {
      wasCorrect = null;
      outcome = 'neutral';
      wasCorrectRule = 'manual_no_action';
      wasCorrectReason = note
        ? `Uporabnik ni nikoli izvedel akcije. Razlog: ${note}`
        : 'Uporabnik ni nikoli izvedel akcije — napoved ni bila preverjena.';
    } else if (outcomeType === 'wrong_prediction') {
      wasCorrect = false;
      outcome = 'loss';
      wasCorrectRule = 'manual_wrong_prediction';
      wasCorrectReason = note
        ? `Uporabnik označil napoved kot NAPAČNO. Razlog: ${note}`
        : 'Uporabnik je eksplicitno označil napoved AI-ja kot napačno.';
    }

    // Čas od ustvarjanja predloga do zabeležitve izida
    const timeToOutcomeDays = suggestion.createdAt
      ? Math.max(0, Math.floor((now.getTime() - suggestion.createdAt.getTime()) / (1000 * 60 * 60 * 24)))
      : null;

    await db.copilotSuggestion.update({
      where: { id },
      data: {
        status: 'outcome_recorded',
        outcomeRecordedAt: now,
        outcomeType,
        outcome,
        actualProfit,
        actualRoi,
        profitAmount: actualProfit, // legacy
        wasCorrect,
        wasCorrectReason,
        wasCorrectRule,
        timeToOutcomeDays,
        actualBuyPrice,
        actualSellPrice,
        actualCosts,
        referencePoint,
        // če ima note, shrani kot feedback (če ni že)
        feedback: note || suggestion.feedback,
        // če je bil pending/approved in user direktno zabeleži izid, mark executedAt tudi
        executedAt: suggestion.executedAt ?? now,
      },
    });

    logger.info('/api/ai/copilot/[id]/outcome', `Suggestion ${id}: outcomeType=${outcomeType}, wasCorrect=${wasCorrect}`);

    return NextResponse.json({
      ok: true,
      id,
      outcomeType,
      wasCorrect,
      outcome,
      actualProfit,
      actualRoi,
      timeToOutcomeDays,
      timestamp: now.toISOString(),
    });
  } catch (err: any) {
    logger.error('/api/ai/copilot/[id]/outcome', 'POST failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka pri zapisu izida' },
      { status: 500 }
    );
  }
}
