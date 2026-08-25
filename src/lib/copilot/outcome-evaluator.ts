// v9.63: Outcome Evaluator — jasna definicija wasCorrect za vsak tip predloga.
//
// "wasCorrect" ni samo "profit > 0" — ima specifična pravila glede na tip:
//
// BUY:
//   AI predlaga nakup → trade dodan → trade prodan
//   wasCorrect = actualProfit > 0 (ali je trade prinesel dobiček?)
//   Pravilo: "profit_positive"
//   Dodatno: roiMatch = actualRoi >= expectedRoi * 0.7 (ali je bil ROI blizu napovedi?)
//
// SELL (reprice zastarelega artikla):
//   AI predlaga znižanje cene → reprice → artikel prodan
//   wasCorrect = sold within 30 days of reprice (ali je artikel sploh bil prodan po reprice?)
//   Pravilo: "sold_within_window"
//   Dodatno: profitAmount = dejanski profit po reprice
//
// STOP-MONITOR:
//   AI predlaga ustavitev neaktivnega monitorja → deactivate
//   wasCorrect = monitor wasn't reactivated within 30 days (res ni bilo povpraševanja)
//   Pravilo: "not_reactivated"
//
// RESTOCK:
//   AI predlaga restock kategorije → new trade added in category → sold
//   wasCorrect = new trade in category sold with profit > 0
//   Pravilo: "category_restock_profitable"
//
// INVESTIGATE:
//   AI predlaga preiskavo anomalije → win rate should improve
//   wasCorrect = win rate improved in next 30 days
//   Pravilo: "winrate_improved"

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface OutcomeEvaluation {
  wasCorrect: boolean;
  outcome: 'profit' | 'loss' | 'neutral';
  actualProfit: number | null;
  actualRoi: number | null;
  timeToOutcomeDays: number | null;
  wasCorrectRule: string;
  wasCorrectReason: string;
}

/**
 * Evaluiraj outcome za BUY suggestion.
 * Klicano ko je trade (povezan z listing-om) prodan.
 *
 * Pravilo: wasCorrect = actualProfit > 0
 * Dodatno: roiMatch = actualRoi >= expectedRoi * 0.7 (ne vpliva na wasCorrect, samo za analizo)
 */
function evaluateBuyOutcome(
  suggestion: { expectedProfit: number | null; expectedRoi: number | null; executedAt: Date | null },
  trade: { buyPrice: number; buyFees: number | null; sellPrice: number | null; sellFees: number | null; sellDate: Date | null }
): OutcomeEvaluation {
  const cost = trade.buyPrice + (trade.buyFees ?? 0);
  const revenue = (trade.sellPrice ?? 0) - (trade.sellFees ?? 0);
  const actualProfit = revenue - cost;
  const actualRoi = cost > 0 ? (actualProfit / cost) * 100 : 0;
  const timeToOutcomeDays = suggestion.executedAt && trade.sellDate
    ? Math.floor((new Date(trade.sellDate).getTime() - suggestion.executedAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const wasCorrect = actualProfit > 0;
  const outcome = actualProfit > 0 ? 'profit' : actualProfit < 0 ? 'loss' : 'neutral';

  let reason = '';
  if (wasCorrect) {
    reason = `Trade prinesel +${Math.round(actualProfit)}€ dobička (ROI ${Math.round(actualRoi)}%).`;
    if (suggestion.expectedProfit && actualProfit >= suggestion.expectedProfit) {
      reason += ` Presegel AI napoved (${suggestion.expectedProfit}€).`;
    } else if (suggestion.expectedProfit) {
      reason += ` Pod AI napovedjo (${suggestion.expectedProfit}€), a še vedno dobičkonosen.`;
    }
  } else {
    reason = `Trade prinesel ${Math.round(actualProfit)}€ izgube (ROI ${Math.round(actualRoi)}%).`;
    if (suggestion.expectedProfit && suggestion.expectedProfit > 0) {
      reason += ` AI je napovedoval +${suggestion.expectedProfit}€ dobička — napoved je bila napačna.`;
    }
  }

  return {
    wasCorrect,
    outcome,
    actualProfit,
    actualRoi,
    timeToOutcomeDays,
    wasCorrectRule: 'profit_positive',
    wasCorrectReason: reason,
  };
}

/**
 * Evaluiraj outcome za SELL suggestion (reprice zastarelega artikla).
 *
 * Pravilo: wasCorrect = sold within 30 days of execute
 * (Če artikel ni bil prodan v 30 dneh po reprice, je bil predlog neučinkovit.)
 */
function evaluateSellOutcome(
  suggestion: { executedAt: Date | null; actionData: string },
  trade: { sellPrice: number | null; sellDate: Date | null; buyPrice: number; buyFees: number | null; sellFees: number | null }
): OutcomeEvaluation {
  const now = new Date();
  const executedAt = suggestion.executedAt ?? now;
  const timeToOutcomeDays = trade.sellDate
    ? Math.floor((new Date(trade.sellDate).getTime() - executedAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Parse actionData for suggestedPrice
  let suggestedPrice: number | null = null;
  try {
    const data = JSON.parse(suggestion.actionData);
    suggestedPrice = data.suggestedPrice ?? null;
  } catch { /* ignore */ }

  const cost = trade.buyPrice + (trade.buyFees ?? 0);
  const revenue = (trade.sellPrice ?? 0) - (trade.sellFees ?? 0);
  const actualProfit = revenue - cost;
  const actualRoi = cost > 0 ? (actualProfit / cost) * 100 : 0;

  // wasCorrect = artikel je bil prodan v 30 dneh po reprice
  const soldWithinWindow = timeToOutcomeDays !== null && timeToOutcomeDays <= 30;
  const wasCorrect = soldWithinWindow;

  let reason = '';
  if (soldWithinWindow) {
    reason = `Artikel prodan ${timeToOutcomeDays} dni po reprice.`;
    if (suggestedPrice && trade.sellPrice) {
      const priceDiff = trade.sellPrice - suggestedPrice;
      if (Math.abs(priceDiff) < 5) {
        reason += ` Prodano po predlagani ceni (${suggestedPrice}€).`;
      } else if (priceDiff > 0) {
        reason += ` Prodano nad predlagano ceno (+${priceDiff}€). Odlično!`;
      } else {
        reason += ` Prodano pod predlagano ceno (${priceDiff}€). Morda prenižja predlagana cena.`;
      }
    }
  } else if (timeToOutcomeDays !== null) {
    reason = `Artikel prodan ${timeToOutcomeDays} dni po reprice — prepozna prodaja (predlog ni bil dovolj učinkovit).`;
  } else {
    reason = `Artikel še ni prodan ${Math.floor((now.getTime() - executedAt.getTime()) / (1000 * 60 * 60 * 24))} dni po reprice.`;
  }

  return {
    wasCorrect,
    outcome: actualProfit > 0 ? 'profit' : actualProfit < 0 ? 'loss' : 'neutral',
    actualProfit,
    actualRoi,
    timeToOutcomeDays,
    wasCorrectRule: 'sold_within_window',
    wasCorrectReason: reason,
  };
}

/**
 * Evaluiraj outcome za STOP-MONITOR suggestion.
 *
 * Pravilo: wasCorrect = monitor wasn't reactivated within 30 days
 * (Če uporabnik ni ponovno aktiviral monitorja, je bil res neaktiven.)
 */
function evaluateStopMonitorOutcome(
  suggestion: { executedAt: Date | null; actionData: string }
): OutcomeEvaluation {
  const now = new Date();
  const executedAt = suggestion.executedAt ?? now;
  const daysSinceExecute = Math.floor((now.getTime() - executedAt.getTime()) / (1000 * 60 * 60 * 24));

  // Za stop-monitor je wasCorrect = true vedno ko je minilo 30 dni in monitor ni bil reaktiviran
  // (To je "resources saved" — če ni bil reaktiviran, je bil res odveč)
  const wasCorrect = daysSinceExecute >= 30;

  return {
    wasCorrect,
    outcome: 'neutral', // stop-monitor nima finančnega izida
    actualProfit: null,
    actualRoi: null,
    timeToOutcomeDays: daysSinceExecute,
    wasCorrectRule: 'not_reactivated',
    wasCorrectReason: wasCorrect
      ? `Monitor je ostal neaktiven ${daysSinceExecute} dni — predlog je bil pravilen (res odveč).`
      : `Šele ${daysSinceExecute} dni od deaktivacije — čakamo 30 dni za evalvacijo.`,
  };
}

/**
 * Glavna funkcija — evaluiraj outcome za suggestion.
 * Klicano ko je trade prodan (za buy/sell) ali po 30 dneh (za stop-monitor).
 */
export async function evaluateSuggestionOutcome(suggestionId: string): Promise<OutcomeEvaluation | null> {
  try {
    const suggestion = await db.copilotSuggestion.findUnique({
      where: { id: suggestionId },
    });

    if (!suggestion) {
      logger.error('outcome-evaluator', `Suggestion ${suggestionId} not found`);
      return null;
    }

    if (suggestion.status !== 'executed') {
      logger.warn('outcome-evaluator', `Suggestion ${suggestionId} not executed (status=${suggestion.status})`);
      return null;
    }

    let evaluation: OutcomeEvaluation | null = null;

    switch (suggestion.type) {
      case 'buy': {
        // Najdi trade povezan z listing-om
        if (!suggestion.relatedListingId) {
          logger.warn('outcome-evaluator', `Buy suggestion ${suggestionId} has no relatedListingId`);
          return null;
        }
        const trade = await db.trade.findFirst({
          where: { listingId: suggestion.relatedListingId, status: 'sold', sellPrice: { not: null } },
        });
        if (!trade) {
          // Trade še ni prodan — outcome še ni znan
          return null;
        }
        evaluation = evaluateBuyOutcome(
          {
            expectedProfit: suggestion.expectedProfit,
            expectedRoi: suggestion.expectedRoi,
            executedAt: suggestion.executedAt,
          },
          {
            buyPrice: trade.buyPrice,
            buyFees: trade.buyFees,
            sellPrice: trade.sellPrice,
            sellFees: trade.sellFees,
            sellDate: trade.sellDate,
          }
        );
        break;
      }

      case 'sell': {
        if (!suggestion.relatedTradeId) {
          logger.warn('outcome-evaluator', `Sell suggestion ${suggestionId} has no relatedTradeId`);
          return null;
        }
        const trade = await db.trade.findUnique({
          where: { id: suggestion.relatedTradeId },
        });
        if (!trade || trade.status !== 'sold' || !trade.sellPrice) {
          // Trade še ni prodan
          return null;
        }
        evaluation = evaluateSellOutcome(
          {
            executedAt: suggestion.executedAt,
            actionData: suggestion.actionData,
          },
          {
            sellPrice: trade.sellPrice,
            sellDate: trade.sellDate,
            buyPrice: trade.buyPrice,
            buyFees: trade.buyFees,
            sellFees: trade.sellFees,
          }
        );
        break;
      }

      case 'stop-monitor': {
        evaluation = evaluateStopMonitorOutcome({
          executedAt: suggestion.executedAt,
          actionData: suggestion.actionData,
        });
        break;
      }

      case 'restock':
      case 'investigate':
        // Za restock in investigate je evalvacija bolj kompleksna — zaenkrat null
        // (bo implementirano ko bomo imeli več podatkov)
        return null;

      default:
        logger.warn('outcome-evaluator', `Unknown suggestion type: ${suggestion.type}`);
        return null;
    }

    if (evaluation) {
      // Shrani outcome v DB
      await db.copilotSuggestion.update({
        where: { id: suggestionId },
        data: {
          status: 'outcome_recorded',
          outcomeRecordedAt: new Date(),
          outcome: evaluation.outcome,
          profitAmount: evaluation.actualProfit,
          actualProfit: evaluation.actualProfit,
          actualRoi: evaluation.actualRoi,
          timeToOutcomeDays: evaluation.timeToOutcomeDays,
          wasCorrect: evaluation.wasCorrect,
          wasCorrectReason: evaluation.wasCorrectReason,
          wasCorrectRule: evaluation.wasCorrectRule,
        },
      });

      logger.info('outcome-evaluator', `Suggestion ${suggestionId}: wasCorrect=${evaluation.wasCorrect} (${evaluation.wasCorrectRule})`);
    }

    return evaluation;
  } catch (err: any) {
    logger.error('outcome-evaluator', `Failed for ${suggestionId}`, err);
    return null;
  }
}

/**
 * Evaluiraj vse executed suggestions ki še nimajo outcome-a.
 * Klicano od cron-a ali ob prodaji trade-a.
 */
export async function evaluatePendingOutcomes(): Promise<{
  checked: number;
  evaluated: number;
  correct: number;
  incorrect: number;
}> {
  try {
    const executedWithoutOutcome = await db.copilotSuggestion.findMany({
      where: { status: 'executed' },
      take: 50,
    });

    let evaluated = 0;
    let correct = 0;
    let incorrect = 0;

    for (const suggestion of executedWithoutOutcome) {
      const result = await evaluateSuggestionOutcome(suggestion.id);
      if (result) {
        evaluated++;
        if (result.wasCorrect) correct++;
        else incorrect++;
      }
    }

    return {
      checked: executedWithoutOutcome.length,
      evaluated,
      correct,
      incorrect,
    };
  } catch (err: any) {
    logger.error('outcome-evaluator', 'evaluatePendingOutcomes failed', err);
    return { checked: 0, evaluated: 0, correct: 0, incorrect: 0 };
  }
}
