// v5.3: AI Insights — AI sam odkriva trende in anomalije v tvojih oglasih
// GET /api/ai/insights
// Query: ?days=30 (analiza obdobja)
// Returns: { ok, insights: Array<{ type, severity, title, description, data, actionable }>, stats }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type InsightType = 'trend' | 'anomaly' | 'opportunity' | 'warning' | 'info';
type Severity = 'high' | 'medium' | 'low';

interface Insight {
  type: InsightType;
  severity: Severity;
  title: string;
  description: string;
  data: any;
  actionable?: string;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') ?? '30', 10) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const since1d = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const insights: Insight[] = [];

    // ===== 1. Price trends by category/source =====
    const allListings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: since },
        price: { not: null },
        isHidden: false,
      },
      select: {
        id: true,
        title: true,
        price: true,
        priceText: true,
        firstSeenAt: true,
        aiVerdict: true,
        aiScore: true,
        dealScore: true,
        aiEstimatedValue: true,
        priceDroppedAt: true,
        previousPrice: true,
        monitor: { select: { name: true, source: true, id: true } },
      },
      take: 5000,
    });

    // Group by source
    const bySource: Record<string, { listings: any[]; avgPrice: number; count: number }> = {};
    for (const l of allListings) {
      const src = l.monitor?.source ?? 'neznan';
      if (!bySource[src]) bySource[src] = { listings: [], avgPrice: 0, count: 0 };
      bySource[src].listings.push(l);
    }
    for (const src of Object.keys(bySource)) {
      const prices = bySource[src].listings.map(l => l.price!).filter(Boolean);
      bySource[src].avgPrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
      bySource[src].count = prices.length;
    }

    // ===== 2. Price drop trend =====
    const priceDrops = allListings.filter(l => l.priceDroppedAt != null && l.previousPrice != null);
    if (priceDrops.length > 0) {
      const avgDropPct = priceDrops.reduce((s, l) => {
        if (l.price && l.previousPrice) {
          return s + ((l.previousPrice - l.price) / l.previousPrice) * 100;
        }
        return s;
      }, 0) / priceDrops.length;

      const recentDrops = priceDrops.filter(l => l.priceDroppedAt! >= since7d).length;
      const olderDrops = priceDrops.length - recentDrops;

      insights.push({
        type: 'trend',
        severity: avgDropPct > 10 ? 'high' : avgDropPct > 5 ? 'medium' : 'low',
        title: `📈 Trend padcev cen (${days} dni)`,
        description: `V zadnjih ${days} dneh je bilo ${priceDrops.length} padcev cen. Povprečni padec: ${avgDropPct.toFixed(1)}%.${recentDrops > olderDrops ? ' Padci se pospešujejo v zadnjem tednu.' : ' Padci se upočasnjujejo v zadnjem tednu.'}`,
        data: {
          totalDrops: priceDrops.length,
          avgDropPct: Math.round(avgDropPct * 10) / 10,
          recentDrops,
          olderDrops,
          trend: recentDrops > olderDrops ? 'accelerating' : 'decelerating',
        },
        actionable: avgDropPct > 10 ? '💡 Morda je dober čas za nakup — cene padajo.' : undefined,
      });
    }

    // ===== 3. Best performing monitor =====
    const monitorStats: any[] = [];
    const monitorMap = new Map<string, { listings: any[]; alerts: number; name: string; source: string }>();
    for (const l of allListings) {
      if (!l.monitor) continue;
      const key = l.monitor.id;
      if (!monitorMap.has(key)) {
        monitorMap.set(key, { listings: [], alerts: 0, name: l.monitor.name, source: l.monitor.source });
      }
      monitorMap.get(key)!.listings.push(l);
    }

    for (const [id, data] of monitorMap.entries()) {
      const listings = data.listings;
      const prilikaCount = listings.filter(l => l.aiVerdict === 'PRILIKA').length;
      const avgDealScore = listings.filter(l => l.dealScore != null).length > 0
        ? Math.round(listings.filter(l => l.dealScore != null).reduce((s, l) => s + l.dealScore!, 0) / listings.filter(l => l.dealScore != null).length)
        : 0;
      const priceDrops = listings.filter(l => l.priceDroppedAt != null).length;
      monitorStats.push({
        id,
        name: data.name,
        source: data.source,
        listingsCount: listings.length,
        prilikaCount,
        prilikaPct: listings.length > 0 ? Math.round((prilikaCount / listings.length) * 100) : 0,
        avgDealScore,
        priceDrops,
      });
    }

    if (monitorStats.length > 0) {
      // Best monitor by prilika %
      const bestByPrilika = [...monitorStats].sort((a, b) => b.prilikaPct - a.prilikaPct)[0];
      if (bestByPrilika.prilikaPct > 0) {
        insights.push({
          type: 'opportunity',
          severity: bestByPrilika.prilikaPct > 30 ? 'high' : 'medium',
          title: `🏆 Najboljši monitor: ${bestByPrilika.name}`,
          description: `Monitor "${bestByPrilika.name}" (${bestByPrilika.source}) ima ${bestByPrilika.prilikaPct}% oglasov ocenjenih kot PRILIKA (${bestByPrilika.prilikaCount} od ${bestByPrilika.listingsCount}). Povprečni deal score: ${bestByPrilika.avgDealScore}/100.`,
          data: bestByPrilika,
          actionable: '💡 Razmisli o povečanju frekvence tega monitorja ali zaostritvi filtrov za še boljše rezultate.',
        });
      }

      // Worst monitor (lots of listings, few prilika)
      const worstByPrilika = [...monitorStats]
        .filter(m => m.listingsCount >= 5)
        .sort((a, b) => a.prilikaPct - b.prilikaPct)[0];
      if (worstByPrilika && worstByPrilika.prilikaPct < 10) {
        insights.push({
          type: 'warning',
          severity: 'medium',
          title: `⚠️ Slab monitor: ${worstByPrilika.name}`,
          description: `Monitor "${worstByPrilika.name}" ima samo ${worstByPrilika.prilikaPct}% PRILIKA oglasov (${worstByPrilika.prilikaCount} od ${worstByPrilika.listingsCount}). Morda potrebuje boljše filtre ali AI navodila.`,
          data: worstByPrilika,
          actionable: '💡 Uporabi "AI filtri" v monitor formi za optimizacijo filtrov.',
        });
      }
    }

    // ===== 4. Anomaly: sudden spike in listings =====
    const last24h = allListings.filter(l => l.firstSeenAt >= since1d).length;
    const previousDays = allListings.filter(l => l.firstSeenAt < since1d).length;
    const avgPerDay = previousDays / Math.max(1, days - 1);
    if (avgPerDay > 0 && last24h > avgPerDay * 2) {
      insights.push({
        type: 'anomaly',
        severity: 'high',
        title: `🔥 Anomalija: naraščanje oglasov (${last24h} v 24h)`,
        description: `V zadnjih 24 urah je bilo ${last24h} novih oglasov, kar je ${Math.round((last24h / avgPerDay) * 100)}% nad povprečjem (${avgPerDay.toFixed(1)}/dan).`,
        data: {
          last24h,
          avgPerDay: Math.round(avgPerDay * 10) / 10,
          spike: Math.round((last24h / avgPerDay) * 100),
        },
        actionable: '💡 Preveri ali je na voljo več priložnosti kot običajno.',
      });
    }

    // ===== 5. AI accuracy insight =====
    const aiEvaluated = allListings.filter(l => l.aiVerdict != null && l.aiEstimatedValue != null);
    if (aiEvaluated.length >= 10) {
      const undervalued = aiEvaluated.filter(l => l.aiEstimatedValue! > (l.price ?? 0) * 1.1);
      const undervaluedPct = Math.round((undervalued.length / aiEvaluated.length) * 100);
      if (undervaluedPct > 30) {
        insights.push({
          type: 'opportunity',
          severity: 'high',
          title: `💰 ${undervaluedPct}% oglasov je podcenjenih`,
          description: `AI ocenjuje, da je ${undervalued.length} od ${aiEvaluated.length} oglasov (${undervaluedPct}%) podcenjenih za več kot 10%. To so potencialne priložnosti za nakup in prodajo.`,
          data: {
            total: aiEvaluated.length,
            undervalued: undervalued.length,
            undervaluedPct,
          },
          actionable: '💡 Preveri Watchlist za podcenjene oglase z visokim deal score.',
        });
      }
    }

    // ===== 6. Source comparison =====
    const sourceStats = Object.entries(bySource).map(([src, data]) => ({
      source: src,
      count: data.count,
      avgPrice: data.avgPrice,
    })).sort((a, b) => b.count - a.count);

    if (sourceStats.length >= 2) {
      const cheapest = [...sourceStats].sort((a, b) => a.avgPrice - b.avgPrice)[0];
      const mostExpensive = [...sourceStats].sort((a, b) => b.avgPrice - a.avgPrice)[0];
      if (cheapest.avgPrice > 0 && mostExpensive.avgPrice > 0 && cheapest.source !== mostExpensive.source) {
        const diffPct = Math.round(((mostExpensive.avgPrice - cheapest.avgPrice) / cheapest.avgPrice) * 100);
        if (diffPct > 20) {
          insights.push({
            type: 'info',
            severity: 'medium',
            title: `💱 Cene se razlikujejo po virih (${diffPct}%)`,
            description: `${cheapest.source} ima povprečno ceno ${cheapest.avgPrice}€, ${mostExpensive.source} pa ${mostExpensive.avgPrice}€. Razlika: ${diffPct}%.`,
            data: { cheapest, mostExpensive, diffPct },
            actionable: '💡 Preveri cross-portal arbitražo v Analitika zavihku.',
          });
        }
      }
    }

    // ===== 7. Watchlist insight =====
    const watchlistListings = await db.listing.findMany({
      where: {
        OR: [
          { isBookmarked: true },
          { targetPrice: { not: null } },
        ],
        isHidden: false,
      },
      select: { id: true, price: true, targetPrice: true, title: true, firstSeenAt: true },
      take: 500,
    });
    const withTarget = watchlistListings.filter(l => l.targetPrice != null && l.price != null);
    const closeToTarget = withTarget.filter(l => l.price! <= l.targetPrice! * 1.1 && l.price! > l.targetPrice!);
    if (closeToTarget.length > 0) {
      insights.push({
        type: 'opportunity',
        severity: 'high',
        title: `🎯 ${closeToTarget.length} oglasov blizu ciljne cene`,
        description: `${closeToTarget.length} oglasov v watchlistu je znotraj 10% nad ciljno ceno. Morda bodo kmalu padli na cilj.`,
        data: { count: closeToTarget.length },
        actionable: '💡 Preveri Watchlist za te oglase — morda jih lahko kontaktiraš proaktivno.',
      });
    }

    // ===== 8. Recent activity insight =====
    const recentAlerts = await db.alert.count({ where: { createdAt: { gte: since7d } } });
    const olderAlerts = await db.alert.count({
      where: {
        createdAt: { gte: since, lt: since7d },
      },
    });
    if (recentAlerts > 0 || olderAlerts > 0) {
      const avgAlertsPerDayRecent = recentAlerts / 7;
      const avgAlertsPerDayOlder = olderAlerts / Math.max(1, days - 7);
      if (avgAlertsPerDayOlder > 0) {
        const change = Math.round(((avgAlertsPerDayRecent - avgAlertsPerDayOlder) / avgAlertsPerDayOlder) * 100);
        if (Math.abs(change) > 20) {
          insights.push({
            type: 'trend',
            severity: change > 0 ? 'medium' : 'low',
            title: `🔔 Alerti ${change > 0 ? 'narasli' : 'padli'} za ${Math.abs(change)}%`,
            description: `V zadnjem tednu: ${recentAlerts} alertov (${avgAlertsPerDayRecent.toFixed(1)}/dan). Prejšnje obdobje: ${olderAlerts} (${avgAlertsPerDayOlder.toFixed(1)}/dan).`,
            data: {
              recentAlerts,
              olderAlerts,
              avgRecent: Math.round(avgAlertsPerDayRecent * 10) / 10,
              avgOlder: Math.round(avgAlertsPerDayOlder * 10) / 10,
              change,
            },
          });
        }
      }
    }

    // Sort by severity
    const severityOrder = { high: 0, medium: 1, low: 2 };
    insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return NextResponse.json({
      ok: true,
      insights,
      stats: {
        days,
        totalListings: allListings.length,
        totalSources: Object.keys(bySource).length,
        totalMonitors: monitorStats.length,
        sourceStats,
        monitorStats: monitorStats.sort((a, b) => b.listingsCount - a.listingsCount),
      },
      generatedAt: new Date().toISOString(),
    });

  } catch (err) {
    logger.error("/api/ai/insights", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
