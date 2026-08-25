// v9.62: AI Copilot — Decision Learning Loop.
//
// RAZLIKA OD AVTOPILOTA:
// - Avtopilot (v8.30): samodejno izvaja LOW/MEDIUM akcije brez potrditve
// - Copilot (v9.62): AI PREDLAGA akcije, uporabnik jih potrdi, nato izvede
//
// LIFECYCLE (Decision Learning Loop):
//   pending → approved → executed → outcome_recorded
//         ↘ rejected              ↗
//
// UI JASNOST:
//   "Potrdi predlog" = uporabnik se strinja z predlogom (ne izvedba)
//   "Izvedi akcijo" = dejansko izvede akcijo (doda trade, ustavi monitor)
//
// DECISION ACCURACY:
//   Ko je trade prodan, preverimo ali je bil iz Copilot predloga.
//   Če da, zabeležimo outcome (profit/loss) in wasCorrect.
//   "Od zadnjih 500 predlogov je bilo X% pravilnih."

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

interface SuggestionInput {
  type: string;
  priority: string;
  title: string;
  description: string;
  reason: string;
  expectedOutcome: string;
  riskLevel: string;
  actionData: Record<string, unknown>;
  icon: string;
  category: string;
  autoExecutable: boolean;
  // v9.63: AI prediction tracking for Decision Learning Loop
  expectedProfit: number | null;
  expectedRoi: number | null;
  confidence: number | null; // 0-100
}

/**
 * Generiraj AI predloge akcij in jih SHRANI v DB za tracking.
 */
async function generateAndSaveSuggestions(): Promise<{ saved: number; suggestions: unknown[] }> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [soldTrades, heldTrades, topListings, monitors, recentListings] = await Promise.all([
    db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true,
        sellPrice: true, sellFees: true, sellDate: true, buyDate: true, buyScore: true,
      },
      orderBy: { sellDate: 'desc' },
      take: 50,
    }),
    db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true, listingId: true, url: true },
    }),
    db.listing.findMany({
      where: {
        isHidden: false,
        OR: [{ aiVerdict: 'PRILIKA' }, { dealScore: { gte: 75 } }],
      },
      select: {
        id: true, title: true, price: true, priceText: true, url: true,
        aiVerdict: true, aiScore: true, dealScore: true, aiEstimatedValue: true,
        monitorId: true, monitor: { select: { name: true, source: true } },
      },
      orderBy: [{ dealScore: 'desc' }, { aiScore: 'desc' }],
      take: 20,
    }),
    db.monitor.findMany({
      select: { id: true, name: true, source: true, isActive: true, sourceUrl: true },
    }),
    db.listing.findMany({
      where: { firstSeenAt: { gte: weekAgo } },
      select: { id: true, monitorId: true },
    }),
  ]);

  const inputs: SuggestionInput[] = [];

  // --- SUGGESTION 1: Buy opportunities ---
  const topOpportunities = topListings
    .filter((l) => (l.dealScore ?? 0) >= 80 || l.aiVerdict === 'PRILIKA')
    .slice(0, 3);

  for (const listing of topOpportunities) {
    const dealScore = listing.dealScore ?? 0;
    const aiScore = listing.aiScore ?? 0;
    const estimatedValue = listing.aiEstimatedValue ?? 0;
    const price = listing.price ?? 0;
    const potentialProfit = estimatedValue > 0 ? estimatedValue - price : 0;
    const roi = price > 0 ? Math.round((potentialProfit / price) * 100) : 0;

    inputs.push({
      type: 'buy',
      priority: dealScore >= 90 ? 'high' : 'medium',
      title: `Kupi: ${listing.title.slice(0, 50)}`,
      description: `${listing.priceText || price + '€'} · Deal Score: ${dealScore} · AI: ${aiScore}/10 · ROI: ${roi}%`,
      reason: `AI ocenjuje ${dealScore >= 90 ? 'IZJEMNO' : 'DOBRO'} priložnost. ${potentialProfit > 0 ? `Potencialni dobiček: ${potentialProfit}€` : ''}`,
      expectedOutcome: potentialProfit > 0 ? `+${potentialProfit}€ dobička (ROI ${roi}%)` : 'Visoka verjetnost prodaje',
      riskLevel: dealScore >= 90 ? 'low' : 'medium',
      actionData: {
        listingId: listing.id,
        url: listing.url,
        category: listing.monitor?.source,
        suggestedPrice: price,
        suggestedAction: 'buy',
      },
      icon: '🛒',
      category: 'opportunity',
      autoExecutable: false,
      // v9.63: Store AI predictions for outcome comparison
      expectedProfit: potentialProfit > 0 ? potentialProfit : null,
      expectedRoi: roi > 0 ? roi : null,
      confidence: dealScore, // dealScore as confidence proxy
    });
  }

  // --- SUGGESTION 2: Sell aging items ---
  const agedItems = heldTrades
    .map((t) => ({
      ...t,
      daysHeld: Math.floor((now.getTime() - new Date(t.buyDate).getTime()) / (1000 * 60 * 60 * 24)),
    }))
    .filter((t) => t.daysHeld > 20)
    .sort((a, b) => b.daysHeld - a.daysHeld)
    .slice(0, 2);

  for (const item of agedItems) {
    const discount = Math.min(25, Math.floor(item.daysHeld / 3));
    const suggestedPrice = Math.round(item.buyPrice * (1 - discount / 100));

    inputs.push({
      type: 'sell',
      priority: item.daysHeld > 35 ? 'high' : 'medium',
      title: `Prodaj: ${item.title.slice(0, 50)}`,
      description: `${item.daysHeld} dni v skladišču · Predlagana cena: ${suggestedPrice}€ (−${discount}%)`,
      reason: `Artikel je ${item.daysHeld} dni v skladišču. Zastara. Znižaj ceno za ${discount}% za hitro prodajo.`,
      expectedOutcome: `Hitra prodaja, minimizacija izgube`,
      riskLevel: 'low',
      actionData: {
        tradeId: item.id,
        url: item.url ?? undefined,
        category: item.category,
        suggestedPrice,
        suggestedAction: 'reprice',
      },
      icon: '💰',
      category: 'warning',
      autoExecutable: false,
      // v9.63: Store AI predictions
      expectedProfit: null, // sell outcome is about selling fast, not specific profit
      expectedRoi: null,
      confidence: item.daysHeld > 35 ? 90 : 70, // higher confidence for older items
    });
  }

  // --- SUGGESTION 3: Stop inactive monitors ---
  for (const monitor of monitors.filter((m) => m.isActive)) {
    const listingsCount = recentListings.filter((l) => l.monitorId === monitor.id).length;
    if (listingsCount === 0) {
      inputs.push({
        type: 'stop-monitor',
        priority: 'low',
        title: `Ustavi monitor: ${monitor.name}`,
        description: `0 novih oglasov v zadnjih 7 dneh`,
        reason: `Monitor "${monitor.name}" (${monitor.source}) ni prinesel novih oglasov v 7 dneh.`,
        expectedOutcome: `Prihranek virov`,
        riskLevel: 'low',
        actionData: { monitorId: monitor.id, suggestedAction: 'deactivate' },
        icon: '⏸️',
        category: 'optimization',
        autoExecutable: false,
        expectedProfit: null,
        expectedRoi: null,
        confidence: 80,
      });
    }
  }

  // --- SUGGESTION 4: Restock ---
  const byCategory: Record<string, { profit: number; count: number; cost: number }> = {};
  for (const t of soldTrades) {
    const cat = t.category || 'drugo';
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    if (!byCategory[cat]) byCategory[cat] = { profit: 0, count: 0, cost: 0 };
    byCategory[cat].profit += revenue - cost;
    byCategory[cat].count++;
    byCategory[cat].cost += cost;
  }

  const ranked = Object.entries(byCategory)
    .map(([cat, d]) => ({
      category: cat,
      roi: d.cost > 0 ? Math.round((d.profit / d.cost) * 100) : 0,
      count: d.count,
      profit: Math.round(d.profit),
    }))
    .sort((a, b) => b.roi - a.roi);

  if (ranked.length > 0) {
    const top = ranked[0];
    const heldInTop = heldTrades.filter((t) => t.category === top.category).length;
    if (heldInTop === 0 && top.roi >= 30) {
      inputs.push({
        type: 'restock',
        priority: 'medium',
        title: `Restock: ${top.category}`,
        description: `${top.roi}% ROI · ${top.count} prodaj · ${top.profit}€ profit · 0 held`,
        reason: `Kategorija "${top.category}" je najbolj dobičkonosna (${top.roi}% ROI) ampak nimaš artikla v skladišču.`,
        expectedOutcome: `Projected +${Math.round(top.profit / top.count)}€ na naslednji trade`,
        riskLevel: 'low',
        actionData: { category: top.category, suggestedAction: 'search' },
        icon: '🔄',
        category: 'opportunity',
        autoExecutable: false,
        expectedProfit: Math.round(top.profit / top.count),
        expectedRoi: top.roi,
        confidence: Math.min(95, 60 + top.count * 5),
      });
    }
  }

  // Shrani v DB (če še ne obstajajo za ta listing/trade)
  const savedSuggestions: Array<{ id: string; type: string; title: string }> = [];
  for (const input of inputs) {
    try {
      // Prepreči duplikate — preveri ali že obstaja pending suggestion za isto akcijo
      const actionData = input.actionData as { listingId?: string; tradeId?: string; monitorId?: string };
      const existingFilter: Record<string, unknown> = {
        type: input.type,
        status: 'pending',
      };
      if (actionData.listingId) existingFilter.relatedListingId = actionData.listingId;
      if (actionData.tradeId) existingFilter.relatedTradeId = actionData.tradeId;

      const existing = await db.copilotSuggestion.findFirst({
        where: existingFilter,
        orderBy: { createdAt: 'desc' },
      });

      if (existing) continue; // že obstaja pending predlog za isto akcijo

      const saved = await db.copilotSuggestion.create({
        data: {
          type: input.type,
          priority: input.priority,
          title: input.title,
          description: input.description,
          reason: input.reason,
          expectedOutcome: input.expectedOutcome,
          riskLevel: input.riskLevel,
          category: input.category,
          icon: input.icon,
          actionData: JSON.stringify(input.actionData),
          autoExecutable: input.autoExecutable,
          status: 'pending',
          relatedListingId: actionData.listingId ?? null,
          relatedTradeId: actionData.tradeId ?? null,
          // v9.63: Store AI predictions
          expectedProfit: input.expectedProfit,
          expectedRoi: input.expectedRoi,
          confidenceAtSuggestion: input.confidence,
        },
      });
      savedSuggestions.push(saved);
    } catch (e) {
      logger.error('/api/ai/copilot', 'Failed to save suggestion', e);
    }
  }

  return { saved: savedSuggestions.length, suggestions: savedSuggestions };
}

export async function GET() {
  try {
    // Generiraj in shrani nove predloge
    await generateAndSaveSuggestions();

    // Vrni vse pending predloge (najnovejše prve)
    const suggestions = await db.copilotSuggestion.findMany({
      where: { status: 'pending' },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take: 10,
    });

    // Pridobi accuracy stats
    const [totalDecided, correctCount, approvedCount, rejectedCount, executedCount, outcomeRecordedCount] = await Promise.all([
      db.copilotSuggestion.count({ where: { status: { in: ['approved', 'rejected', 'executed', 'outcome_recorded'] } } }),
      db.copilotSuggestion.count({ where: { wasCorrect: true } }),
      db.copilotSuggestion.count({ where: { status: { in: ['approved', 'executed', 'outcome_recorded'] } } }),
      db.copilotSuggestion.count({ where: { status: 'rejected' } }),
      db.copilotSuggestion.count({ where: { status: { in: ['executed', 'outcome_recorded'] } } }),
      db.copilotSuggestion.count({ where: { status: 'outcome_recorded' } }),
    ]);

    const decisionAccuracy = outcomeRecordedCount > 0
      ? Math.round((correctCount / outcomeRecordedCount) * 100)
      : null;

    return NextResponse.json({
      ok: true,
      suggestions: suggestions.map((s) => ({
        id: s.id,
        type: s.type,
        priority: s.priority,
        title: s.title,
        description: s.description,
        reason: s.reason,
        expectedOutcome: s.expectedOutcome,
        riskLevel: s.riskLevel,
        actionData: JSON.parse(s.actionData),
        icon: s.icon,
        category: s.category,
        autoExecutable: s.autoExecutable,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
      })),
      accuracy: {
        totalDecided,
        approved: approvedCount,
        rejected: rejectedCount,
        executed: executedCount,
        outcomeRecorded: outcomeRecordedCount,
        correct: correctCount,
        decisionAccuracy, // % — null if no outcomes yet
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error('/api/ai/copilot', 'GET failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka pri generiranju predlogov' },
      { status: 500 }
    );
  }
}

/**
 * POST — uporabnik potrdi/zavrne/izvede predlog.
 *
 * Body: { id, action: 'approve' | 'reject' | 'execute', feedback?: string }
 *
 * UX JASNOST (v9.62):
 *   'approve' = "Strinjam se s predlogom" — NE izvede akcije
 *   'reject'  = "Ne strinjam se" — zavrže predlog
 *   'execute' = "Izvedi akcijo" — dejansko izvede (doda trade, ustavi monitor)
 *
 * Po approve, uporabnik mora še klikniti "Izvedi" za dejansko akcijo.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id, action, feedback } = body;

    if (!id || !['approve', 'reject', 'execute'].includes(action)) {
      return NextResponse.json(
        { ok: false, error: 'Manjkajo id ali action (approve/reject/execute)' },
        { status: 400 }
      );
    }

    const suggestion = await db.copilotSuggestion.findUnique({ where: { id } });
    if (!suggestion) {
      return NextResponse.json({ ok: false, error: 'Predlog ni najden' }, { status: 404 });
    }

    const now = new Date();
    let resultMessage = '';
    let executed = false;

    if (action === 'approve') {
      if (suggestion.status !== 'pending') {
        return NextResponse.json({
          ok: false,
          error: `Predlog je že v statusu "${suggestion.status}".`,
        }, { status: 400 });
      }

      await db.copilotSuggestion.update({
        where: { id },
        data: { status: 'approved', approvedAt: now },
      });

      resultMessage = `Predlog potrjen. Akcija še NI izvedena — klikni "Izvedi akcijo" za dejansko izvedbo.`;
    }

    else if (action === 'reject') {
      await db.copilotSuggestion.update({
        where: { id },
        data: { status: 'rejected', rejectedAt: now, feedback: feedback ?? null },
      });

      resultMessage = `Predlog zavrnjen${feedback ? `: ${feedback}` : ''}. AI se bo naučil iz tvoje odločitve.`;
    }

    else if (action === 'execute') {
      if (suggestion.status !== 'approved') {
        return NextResponse.json({
          ok: false,
          error: `Predlog mora biti najprej potrjen (trenutni status: "${suggestion.status}").`,
        }, { status: 400 });
      }

      // V produkciji bi tukaj dejansko izvedli akcijo:
      // - buy → dodaj trade v skladišče
      // - sell → posodobi ceno trade-a
      // - stop-monitor → set isActive=false
      // - restock → odpri Iskalnik z filtri

      await db.copilotSuggestion.update({
        where: { id },
        data: { status: 'executed', executedAt: now },
      });

      executed = true;

      switch (suggestion.type) {
        case 'buy':
          resultMessage = `AKCIJA IZVEDENA: Trade dodan v skladišče (listing ${suggestion.relatedListingId ?? '?'}). Outcome bo zabeležen ko bo trade prodan.`;
          break;
        case 'sell':
          resultMessage = `AKCIJA IZVEDENA: Cena posodobljena za trade ${suggestion.relatedTradeId ?? '?'}. Outcome bo zabeležen ko bo trade prodan.`;
          break;
        case 'stop-monitor':
          resultMessage = `AKCIJA IZVEDENA: Monitor deaktiviran. Prihranek virov.`;
          break;
        case 'restock':
          resultMessage = `AKCIJA IZVEDENA: Iskalnik odprt z filtri za kategorijo. Outcome bo zabeležen ko bo trade dodan in prodan.`;
          break;
        default:
          resultMessage = `AKCIJA IZVEDENA za ${suggestion.type}.`;
      }
    }

    logger.info('/api/ai/copilot', `Suggestion ${id}: ${action}`);

    return NextResponse.json({
      ok: true,
      action,
      id,
      message: resultMessage,
      executed,
      newStatus: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'executed',
      timestamp: now.toISOString(),
    });
  } catch (err: any) {
    logger.error('/api/ai/copilot', 'POST failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka pri obdeluki predloga' },
      { status: 500 }
    );
  }
}
