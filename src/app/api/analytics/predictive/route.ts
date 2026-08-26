// v9.60: Predictive Analytics & Anomaly Detection — proaktivno opozarjanje.
//
// Navdih: Zendesk AI, Bold BI, ERP Suites (2026 trend).
//
// Endpoint: GET /api/analytics/predictive
// Returns: { ok, anomalies, predictions, insights, alerts }
//
// Analizira:
// 1. ANOMALIES — nenavadni vzorci ki zahtevajo pozornost:
//    - Win rate padec (če padel za >10% v zadnjem tednu)
//    - Held inventory aging (artikli > 30 dni)
//    - Profit drop (če padel za >20% MoM)
//    - Category decline (ROI padec v kategoriji)
//    - Unusual activity (preveč/few akcij)
//
// 2. PREDICTIONS — napovedi za naslednji teden/mesec:
//    - Projected profit (glede na hitrost)
//    - Recommended actions (kaj kupiti/prodati)
//    - Risk warnings (kategorije v padcu)
//
// 3. INSIGHTS — AI-generirani vpogledi v slovenščini

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

interface Anomaly {
  id: string;
  type: 'win-rate-drop' | 'inventory-aging' | 'profit-drop' | 'category-decline' | 'unusual-activity' | 'low-activity';
  severity: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  metric: string;
  currentValue: number;
  expectedValue: number;
  deviation: number; // % odstopanje
  affectedItems?: Array<{ name: string; value?: number }>;
  recommendation: string;
  actionUrl?: string;
}

interface Prediction {
  id: string;
  type: 'profit-forecast' | 'category-trend' | 'inventory-action' | 'opportunity';
  title: string;
  description: string;
  metric: string;
  predictedValue: number;
  confidence: number; // 0-100
  timeframe: string;
  recommendation: string;
  actionUrl?: string;
}

interface Insight {
  id: string;
  icon: string;
  text: string;
  category: 'positive' | 'warning' | 'opportunity';
}

export async function GET() {
  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Fetch all data needed
    const [allSold, soldThisWeek, soldLastWeek, heldTrades, thisMonthSold, lastMonthSold] = await Promise.all([
      db.trade.findMany({
        where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
        select: {
          id: true, title: true, category: true, buyPrice: true, buyFees: true,
          sellPrice: true, sellFees: true, sellDate: true, buyDate: true,
        },
      }),
      db.trade.findMany({
        where: {
          status: 'sold', sellPrice: { not: null }, sellDate: { gte: weekAgo },
        },
        select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, category: true },
      }),
      db.trade.findMany({
        where: {
          status: 'sold', sellPrice: { not: null },
          sellDate: { gte: twoWeeksAgo, lt: weekAgo },
        },
        select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
      }),
      db.trade.findMany({
        where: { status: 'held' },
        select: { id: true, title: true, category: true, buyPrice: true, buyDate: true },
      }),
      db.trade.findMany({
        where: {
          status: 'sold', sellPrice: { not: null }, sellDate: { gte: thisMonthStart },
        },
        select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, category: true },
      }),
      db.trade.findMany({
        where: {
          status: 'sold', sellPrice: { not: null },
          sellDate: { gte: lastMonthStart, lte: lastMonthEnd },
        },
        select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, category: true },
      }),
    ]);

    const calcProfit = (t: { buyPrice: number; buyFees: number | null; sellPrice: number | null; sellFees: number | null }) => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      return revenue - cost;
    };

    const calcWinRate = (trades: Array<{ buyPrice: number; buyFees: number | null; sellPrice: number | null; sellFees: number | null }>) => {
      if (trades.length === 0) return 0;
      const profitable = trades.filter((t) => calcProfit(t) > 0).length;
      return Math.round((profitable / trades.length) * 100);
    };

    const anomalies: Anomaly[] = [];
    const predictions: Prediction[] = [];
    const insights: Insight[] = [];

    // --- ANOMALY 1: Win rate drop ---
    const winRateThisWeek = calcWinRate(soldThisWeek);
    const winRateLastWeek = calcWinRate(soldLastWeek);
    if (soldThisWeek.length >= 3 && soldLastWeek.length >= 3 && winRateLastWeek - winRateThisWeek >= 10) {
      anomalies.push({
        id: 'win-rate-drop',
        type: 'win-rate-drop',
        severity: winRateLastWeek - winRateThisWeek >= 20 ? 'high' : 'medium',
        title: '📉 Win rate je padel',
        description: `Win rate je padel iz ${winRateLastWeek}% na ${winRateThisWeek}% v zadnjem tednu.`,
        metric: 'Win rate',
        currentValue: winRateThisWeek,
        expectedValue: winRateLastWeek,
        deviation: winRateLastWeek - winRateThisWeek,
        recommendation: 'Preveri nove trade-e za vzroke izgub. Morda predrago nakup ali slab timing.',
        actionUrl: '/?view=trades',
      });
    }

    // --- ANOMALY 2: Inventory aging ---
    const agedItems = heldTrades
      .map((t) => ({
        ...t,
        daysHeld: Math.floor((now.getTime() - new Date(t.buyDate).getTime()) / (1000 * 60 * 60 * 24)),
      }))
      .filter((t) => t.daysHeld > 30);

    if (agedItems.length > 0) {
      const totalValue = agedItems.reduce((sum, t) => sum + t.buyPrice, 0);
      anomalies.push({
        id: 'inventory-aging',
        type: 'inventory-aging',
        severity: agedItems.length >= 3 ? 'high' : 'medium',
        title: `⏰ ${agedItems.length} artiklov zastara v skladišču`,
        description: `${agedItems.length} artiklov je v skladišču več kot 30 dni. Skupna vrednost: ${Math.round(totalValue)}€.`,
        metric: 'Held days',
        currentValue: agedItems.length,
        expectedValue: 0,
        deviation: 100,
        affectedItems: agedItems.map((t) => ({ name: t.title, value: t.daysHeld })),
        recommendation: 'Znižaj cene za 15-20% in prodaj hitro. Vsak dan več pomeni večjo izgubo.',
        actionUrl: '/?view=trades',
      });
    }

    // --- ANOMALY 3: Profit drop MoM ---
    const thisMonthProfit = thisMonthSold.reduce((sum, t) => sum + calcProfit(t), 0);
    const lastMonthProfit = lastMonthSold.reduce((sum, t) => sum + calcProfit(t), 0);
    if (lastMonthProfit > 0 && thisMonthProfit > 0) {
      const profitChange = ((thisMonthProfit - lastMonthProfit) / lastMonthProfit) * 100;
      if (profitChange <= -20) {
        anomalies.push({
          id: 'profit-drop',
          type: 'profit-drop',
          severity: profitChange <= -40 ? 'high' : 'medium',
          title: '📉 Dobiček je padel',
          description: `Dobiček ta mesec (${Math.round(thisMonthProfit)}€) je ${Math.abs(Math.round(profitChange))}% nižji od prejšnjega meseca (${Math.round(lastMonthProfit)}€).`,
          metric: 'Profit MoM',
          currentValue: Math.round(thisMonthProfit),
          expectedValue: Math.round(lastMonthProfit),
          deviation: Math.abs(Math.round(profitChange)),
          recommendation: 'Analiziraj kaj se je spremenilo — manj prodaj, nižja donosnost, ali več fees?',
          actionUrl: '/?view=analytics',
        });
      }
    }

    // --- ANOMALY 4: Category decline ---
    const byCatThisMonth: Record<string, { profit: number; count: number }> = {};
    const byCatLastMonth: Record<string, { profit: number; count: number }> = {};

    for (const t of thisMonthSold) {
      const cat = t.category || 'drugo';
      if (!byCatThisMonth[cat]) byCatThisMonth[cat] = { profit: 0, count: 0 };
      byCatThisMonth[cat].profit += calcProfit(t);
      byCatThisMonth[cat].count++;
    }
    for (const t of lastMonthSold) {
      const cat = t.category || 'drugo';
      if (!byCatLastMonth[cat]) byCatLastMonth[cat] = { profit: 0, count: 0 };
      byCatLastMonth[cat].profit += calcProfit(t);
      byCatLastMonth[cat].count++;
    }

    for (const cat of Object.keys(byCatThisMonth)) {
      const thisMonth = byCatThisMonth[cat];
      const lastMonth = byCatLastMonth[cat];
      if (lastMonth && lastMonth.profit > 0 && thisMonth.profit < lastMonth.profit) {
        const drop = ((lastMonth.profit - thisMonth.profit) / lastMonth.profit) * 100;
        if (drop >= 30) {
          anomalies.push({
            id: `category-decline-${cat}`,
            type: 'category-decline',
            severity: drop >= 50 ? 'high' : 'medium',
            title: `🏷️ Kategorija "${cat}" v padcu`,
            description: `Donosnost v kategoriji ${cat} je padla za ${Math.round(drop)}% (z ${Math.round(lastMonth.profit)}€ na ${Math.round(thisMonth.profit)}€).`,
            metric: `Profit ${cat}`,
            currentValue: Math.round(thisMonth.profit),
            expectedValue: Math.round(lastMonth.profit),
            deviation: Math.round(drop),
            recommendation: `Razmisli o zmanjšanju investicij v "${cat}" ali spremembi strategije.`,
            actionUrl: '/?view=analytics',
          });
        }
      }
    }

    // --- ANOMALY 5: Unusual activity ---
    if (soldThisWeek.length === 0 && allSold.length > 0) {
      anomalies.push({
        id: 'low-activity',
        type: 'low-activity',
        severity: 'medium',
        title: '⚠️ Nizka aktivnost',
        description: 'V zadnjem tednu ni bilo nobene prodaje. Morda je čas za akcijo.',
        metric: 'Sold this week',
        currentValue: 0,
        expectedValue: 1,
        deviation: 100,
        recommendation: 'Poženi monitorje, dodaj nove trade-e, ali znižaj cene obstoječim.',
        actionUrl: '/?view=monitors',
      });
    }

    // --- PREDICTION 1: Profit forecast ---
    const avgDailyProfit = thisMonthProfit / now.getDate();
    const daysRemainingInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
    const projectedMonthEnd = thisMonthProfit + (avgDailyProfit * daysRemainingInMonth);

    predictions.push({
      id: 'profit-forecast',
      type: 'profit-forecast',
      title: '💰 Napoved dobička do konca meseca',
      description: `Pri trenutni hitrosti (${Math.round(avgDailyProfit)}€/dan) boš končal mesec z ~${Math.round(projectedMonthEnd)}€.`,
      metric: 'Projected profit',
      predictedValue: Math.round(projectedMonthEnd),
      confidence: soldThisWeek.length >= 2 ? 75 : 50,
      timeframe: `${daysRemainingInMonth} dni do konca meseca`,
      recommendation: projectedMonthEnd > lastMonthProfit
        ? 'Trajekt na rast — ohrani trenutno strategijo.'
        : 'Trajekt na padec — povečaj volume ali znižaj cene.',
    });

    // --- PREDICTION 2: Best category to restock ---
    const categoryRoi: Record<string, { profit: number; count: number; totalCost: number }> = {};
    for (const t of allSold) {
      const cat = t.category || 'drugo';
      const profit = calcProfit(t);
      const cost = t.buyPrice + (t.buyFees ?? 0);
      if (!categoryRoi[cat]) categoryRoi[cat] = { profit: 0, count: 0, totalCost: 0 };
      categoryRoi[cat].profit += profit;
      categoryRoi[cat].count++;
      categoryRoi[cat].totalCost += cost;
    }

    const categoryRanking = Object.entries(categoryRoi)
      .map(([cat, d]) => ({
        category: cat,
        roi: d.totalCost > 0 ? Math.round((d.profit / d.totalCost) * 100) : 0,
        count: d.count,
        profit: Math.round(d.profit),
      }))
      .sort((a, b) => b.roi - a.roi);

    if (categoryRanking.length > 0) {
      const top = categoryRanking[0];
      const heldInTop = heldTrades.filter((t) => t.category === top.category).length;
      if (heldInTop === 0) {
        predictions.push({
          id: 'restock-top',
          type: 'inventory-action',
          title: `🟢 Kupi več: ${top.category}`,
          description: `Kategorija ${top.category} ima ${top.roi}% donosnost v ${top.count} uspešnih prodajah, trenutno pa nimaš nobenega artikla.`,
          metric: 'Donosnost',
          predictedValue: top.roi,
          confidence: 80,
          timeframe: 'Naslednji nakup',
          recommendation: `Išči artikle v kategoriji "${top.category}" z budget do 200€.`,
          actionUrl: '/?view=iskalnik',
        });
      }
    }

    // --- PREDICTION 3: Sell warning ---
    const itemsToSellUrgently = heldTrades
      .map((t) => ({
        ...t,
        daysHeld: Math.floor((now.getTime() - new Date(t.buyDate).getTime()) / (1000 * 60 * 60 * 24)),
      }))
      .filter((t) => t.daysHeld > 20)
      .sort((a, b) => b.daysHeld - a.daysHeld)
      .slice(0, 3);

    if (itemsToSellUrgently.length > 0) {
      predictions.push({
        id: 'sell-warning',
        type: 'inventory-action',
        title: '⚡ Prodaj nujno',
        description: `${itemsToSellUrgently.length} artikli zastarajo. Top: "${itemsToSellUrgently[0].title}" (${itemsToSellUrgently[0].daysHeld} dni).`,
        metric: 'Dni v skladišču',
        predictedValue: itemsToSellUrgently[0].daysHeld,
        confidence: 90,
        timeframe: 'Takoj',
        recommendation: 'Znižaj ceno za 15% in objavi čim prej.',
        actionUrl: '/?view=trades',
      });
    }

    // --- INSIGHTS ---
    if (winRateThisWeek >= 90 && soldThisWeek.length >= 3) {
      insights.push({
        id: 'win-rate-good',
        icon: '🎯',
        text: `Odličen win rate ${winRateThisWeek}% ta teden — ohrani strategijo.`,
        category: 'positive',
      });
    }
    if (projectedMonthEnd > lastMonthProfit * 1.1) {
      insights.push({
        id: 'growth',
        icon: '📈',
        text: `Projiciran dobiček ${Math.round(projectedMonthEnd)}€ presega prejšnji mesec za ${Math.round(((projectedMonthEnd - lastMonthProfit) / lastMonthProfit) * 100)}%.`,
        category: 'positive',
      });
    }
    if (agedItems.length === 0 && heldTrades.length > 0) {
      insights.push({
        id: 'fresh-inventory',
        icon: '✨',
        text: 'Vsi artikli v skladišču so sveži (manj kot 30 dni). Odlično upravljanje.',
        category: 'positive',
      });
    }
    if (anomalies.length === 0) {
      insights.push({
        id: 'no-anomalies',
        icon: '✅',
        text: 'Ni anomalij ali težav. Sistem deluje normalno.',
        category: 'positive',
      });
    }

    return NextResponse.json({
      ok: true,
      anomalies: anomalies.sort((a, b) => {
        const severityOrder = { high: 0, medium: 1, low: 2 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      }),
      predictions,
      insights,
      summary: {
        totalAnomalies: anomalies.length,
        highSeverity: anomalies.filter((a) => a.severity === 'high').length,
        totalPredictions: predictions.length,
        winRateThisWeek,
        winRateLastWeek,
        thisMonthProfit: Math.round(thisMonthProfit),
        lastMonthProfit: Math.round(lastMonthProfit),
        projectedMonthEnd: Math.round(projectedMonthEnd),
        agedItemsCount: agedItems.length,
      },
      timestamp: now.toISOString(),
    });
  } catch (err: any) {
    logger.error('/api/analytics/predictive', 'GET failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka pri analizi' },
      { status: 500 }
    );
  }
}
