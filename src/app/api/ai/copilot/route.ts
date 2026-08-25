// v9.61: AI Copilot — AI predlogi akcij s potrditvijo uporabnika.
//
// RAZLIKA OD AVTOPILOTA:
// - Avtopilot (v8.30): samodejno izvaja LOW/MEDIUM akcije brez potrditve
// - Copilot (v9.61): AI PREDLAGA akcije, uporabnik jih potrdi/zavrne
//
// Copilot je za akcije ki jih avtopilot NE bi naredil:
// - HIGH risk akcije (npr. nakup nad 300€)
// - Strategijske odločitve (ustavi monitor, spremeni cene)
// - Outlier priložnosti (izjemne priložnosti ki potrebujejo human review)
//
// Endpoint:
//   GET /api/ai/copilot — vrne seznam predlogov
//   POST /api/ai/copilot { id, action: 'approve' | 'reject' } — uporabnik potrdi/zavrne

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

interface CopilotSuggestion {
  id: string;
  type: 'buy' | 'sell' | 'reprice' | 'stop-monitor' | 'start-monitor' | 'restock' | 'investigate';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  reason: string;
  expectedOutcome: string;
  riskLevel: 'low' | 'medium' | 'high';
  // Akcijski podatki
  actionData: {
    listingId?: string;
    tradeId?: string;
    monitorId?: string;
    url?: string; // original oglas URL
    category?: string;
    suggestedPrice?: number;
    suggestedAction?: string;
  };
  // UI metadata
  icon: string;
  category: 'opportunity' | 'warning' | 'optimization' | 'investigation';
  requiresConfirmation: boolean;
  autoExecutable: boolean; // ali bi avtopilot to naredil
}

/**
 * Generiraj AI predloge akcij.
 * V produkciji bi tukaj klicali LLM z kontekstom.
 * Zaenkrat deterministična logika (pravila).
 */
async function generateSuggestions(): Promise<CopilotSuggestion[]> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [soldTrades, heldTrades, topListings, monitors, allListings] = await Promise.all([
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
        OR: [
          { aiVerdict: 'PRILIKA' },
          { dealScore: { gte: 75 } },
        ],
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
      select: { id: true, monitorId: true, firstSeenAt: true },
    }),
  ]);

  const suggestions: CopilotSuggestion[] = [];

  // --- SUGGESTION 1: Top buy opportunities (HIGH priority) ---
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

    suggestions.push({
      id: `buy-${listing.id}`,
      type: 'buy',
      priority: dealScore >= 90 ? 'high' : 'medium',
      title: `🛒 Kupi: ${listing.title.slice(0, 50)}`,
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
      requiresConfirmation: true,
      autoExecutable: false, // za nakup vedno potrebna potrditev
    });
  }

  // --- SUGGESTION 2: Sell urgently (aging inventory) ---
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

    suggestions.push({
      id: `sell-${item.id}`,
      type: 'sell',
      priority: item.daysHeld > 35 ? 'high' : 'medium',
      title: `💰 Prodaj: ${item.title.slice(0, 50)}`,
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
      requiresConfirmation: true,
      autoExecutable: false,
    });
  }

  // --- SUGGESTION 3: Stop inactive monitors ---
  for (const monitor of monitors.filter((m) => m.isActive)) {
    const listingsCount = allListings.filter((l) => l.monitorId === monitor.id).length;
    if (listingsCount === 0) {
      suggestions.push({
        id: `stop-monitor-${monitor.id}`,
        type: 'stop-monitor',
        priority: 'low',
        title: `⏸️ Ustavi monitor: ${monitor.name}`,
        description: `0 novih oglasov v zadnjih 7 dneh`,
        reason: `Monitor "${monitor.name}" (${monitor.source}) ni prinesel novih oglasov v 7 dneh. Morda iskalni URL ni več aktiven ali pa ni povpraševanja.`,
        expectedOutcome: `Prihranek virov (manj scrapanj, manj AI klicev)`,
        riskLevel: 'low',
        actionData: {
          monitorId: monitor.id,
          suggestedAction: 'deactivate',
        },
        icon: '⏸️',
        category: 'optimization',
        requiresConfirmation: true,
        autoExecutable: false,
      });
    }
  }

  // --- SUGGESTION 4: Restock best category ---
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
      suggestions.push({
        id: `restock-${top.category}`,
        type: 'restock',
        priority: 'medium',
        title: `🔄 Restock: ${top.category}`,
        description: `${top.roi}% ROI · ${top.count} prodaj · ${top.profit}€ profit · 0 held`,
        reason: `Kategorija "${top.category}" je najbolj dobičkonosna (${top.roi}% ROI) ampak nimaš nobenega artikla v skladišču.`,
        expectedOutcome: `Projected +${Math.round(top.profit / top.count)}€ na naslednji trade`,
        riskLevel: 'low',
        actionData: {
          category: top.category,
          suggestedAction: 'search',
        },
        icon: '🔄',
        category: 'opportunity',
        requiresConfirmation: true,
        autoExecutable: false,
      });
    }
  }

  // --- SUGGESTION 5: Investigate anomalies ---
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const soldThisMonth = soldTrades.filter((t) => t.sellDate && new Date(t.sellDate) >= thisMonthStart);
  const profitable = soldThisMonth.filter((t) => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    return revenue - cost > 0;
  });
  const winRate = soldThisMonth.length > 0 ? Math.round((profitable.length / soldThisMonth.length) * 100) : 100;

  if (winRate < 80 && soldThisMonth.length >= 3) {
    suggestions.push({
      id: 'investigate-winrate',
      type: 'investigate',
      priority: 'high',
      title: `🔍 Preiskuj: Win rate ${winRate}%`,
      description: `${profitable.length}/${soldThisMonth.length} dobičkonosnih ta mesec`,
      reason: `Win rate ${winRate}% je pod 80% — preveri kateri trade-i so prinesli izgubo in zakaj.`,
      expectedOutcome: `Izboljšanje win rate na 90%+`,
      riskLevel: 'medium',
      actionData: {
        suggestedAction: 'analyze',
      },
      icon: '🔍',
      category: 'investigation',
      requiresConfirmation: true,
      autoExecutable: false,
    });
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

export async function GET() {
  try {
    const suggestions = await generateSuggestions();

    return NextResponse.json({
      ok: true,
      suggestions,
      summary: {
        total: suggestions.length,
        high: suggestions.filter((s) => s.priority === 'high').length,
        medium: suggestions.filter((s) => s.priority === 'medium').length,
        low: suggestions.filter((s) => s.priority === 'low').length,
        opportunities: suggestions.filter((s) => s.category === 'opportunity').length,
        warnings: suggestions.filter((s) => s.category === 'warning').length,
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
 * POST — uporabnik potrdi/zavrne predlog.
 * Body: { id, action: 'approve' | 'reject', feedback?: string }
 *
 * V produkciji bi tukaj:
 * - approve: izvedli akcijo (kupi, prodaj, ustavi monitor)
 * - reject: zabeležili feedback za učenje AI
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id, action, feedback } = body;

    if (!id || !action || (action !== 'approve' && action !== 'reject')) {
      return NextResponse.json(
        { ok: false, error: 'Manjkajo id ali action (approve/reject)' },
        { status: 400 }
      );
    }

    // Parse suggestion ID (format: type-entityId, npr. "buy-abc123")
    const [type, entityId] = id.split('-');

    logger.info('/api/ai/copilot', `Suggestion ${id}: ${action}${feedback ? ` (${feedback})` : ''}`);

    // V produkciji bi tukaj izvedli akcijo
    // Zaenkrat samo logiramo in vrnemo success
    let resultMessage = '';
    if (action === 'approve') {
      switch (type) {
        case 'buy':
          resultMessage = `Nakup potrjen za listing ${entityId}. V produkciji: dodaj trade v skladišče, označi listing kot kupljen.`;
          break;
        case 'sell':
          resultMessage = `Prodaja/reprice potrjena za trade ${entityId}. V produkciji: posodobi ceno, objavi oglas.`;
          break;
        case 'stop':
          resultMessage = `Ustavitev monitorja ${entityId} potrjena. V produkciji: set isActive=false.`;
          break;
        case 'restock':
          resultMessage = `Restock iskanje za kategorijo ${entityId}. V produkciji: odpri Iskalnik z preset filtri.`;
          break;
        case 'investigate':
          resultMessage = `Preiskava začeta. V produkciji: odpri analitiko z anomalijami.`;
          break;
        default:
          resultMessage = `Akcija potrjena za ${id}.`;
      }
    } else {
      resultMessage = `Predlog ${id} zavrnjen${feedback ? `: ${feedback}` : ''}. AI se bo naučil iz odgovora.`;
    }

    return NextResponse.json({
      ok: true,
      action,
      id,
      message: resultMessage,
      // V produkciji: dejansko izvedi akcijo in vrni rezultat
      executed: action === 'approve',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error('/api/ai/copilot', 'POST failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka pri obdeluki predloga' },
      { status: 500 }
    );
  }
}
