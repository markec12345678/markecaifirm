// v6.6: AI Deal Alert Prioritization — rangiraj alerte po profitnem potencialu
// POST /api/ai/prioritize-alerts
// Body: { limit?: number (default 20) }
// Returns: { ok, prioritized: Array<{ alertId, title, url, profitScore, flipPotential, reason, action }> }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(50, Math.max(5, body?.limit ?? 20));

    // Get recent unread alerts with listing data
    const alerts = await db.alert.findMany({
      where: { isRead: false, isArchived: false },
      include: {
        listing: {
          select: {
            id: true, title: true, price: true, priceText: true, url: true,
            aiVerdict: true, aiScore: true, aiRisk: true, aiEstimatedValue: true,
            dealScore: true, targetPrice: true, isBookmarked: true, sellerName: true,
            monitor: { select: { source: true, name: true } },
          },
        },
        monitor: { select: { name: true, source: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit * 2,
    });

    if (alerts.length === 0) {
      return NextResponse.json({ ok: true, prioritized: [], message: 'Ni neprebranih alertov.' });
    }

    // Pre-rank with heuristic (no AI needed for speed)
    const ranked: any[] = alerts.map(a => {
      const l = a.listing;
      let profitScore = 50;
      let reasons: string[] = [];

      // AI verdict bonus
      if (a.aiVerdict === 'PRILIKA') { profitScore += 20; reasons.push('AI PRILIKA'); }
      else if (a.aiVerdict === 'SUMNJIVO') { profitScore -= 20; reasons.push('AI SUMNJIVO'); }

      // Deal score bonus
      if (l?.dealScore != null) {
        if (l.dealScore >= 80) { profitScore += 15; reasons.push(`Deal Score ${l.dealScore}`); }
        else if (l.dealScore >= 60) { profitScore += 8; }
      }

      // AI estimated value vs price
      if (l?.aiEstimatedValue && l?.price) {
        const margin = l.aiEstimatedValue - l.price;
        const marginPct = Math.round((margin / l.price) * 100);
        if (marginPct > 30) { profitScore += 15; reasons.push(`${marginPct}% pod tržno`); }
        else if (marginPct > 15) { profitScore += 8; }
        else if (marginPct < 0) { profitScore -= 10; }
      }

      // AI score
      if (l?.aiScore != null) {
        if (l.aiScore >= 8) profitScore += 10;
        else if (l.aiScore <= 3) profitScore -= 10;
      }

      // Bookmarked = high interest
      if (l?.isBookmarked) { profitScore += 5; reasons.push('shranjeno'); }

      // Target price hit
      if (l?.targetPrice && l?.price && l.price <= l.targetPrice) {
        profitScore += 10; reasons.push('ciljna cena dosežena');
      }

      profitScore = Math.max(0, Math.min(100, profitScore));

      // Flip potential
      let flipPotential: 'high' | 'medium' | 'low' = 'low';
      if (profitScore >= 75) flipPotential = 'high';
      else if (profitScore >= 55) flipPotential = 'medium';

      // Action recommendation
      let action: string;
      if (profitScore >= 80) action = '🟢 USTREPI TAKOJ — visok profitni potencial';
      else if (profitScore >= 60) action = '🟡 Razmisli — zmerni potencial';
      else if (profitScore >= 40) action = '⚪ Nizka prioriteta';
      else action = '🔴 Preskoči — nizek potencial';

      return {
        alertId: a.id,
        title: a.title,
        url: a.url,
        price: l?.price ?? null,
        priceText: l?.priceText ?? '',
        aiVerdict: a.aiVerdict,
        dealScore: l?.dealScore ?? null,
        aiEstimatedValue: l?.aiEstimatedValue ?? null,
        profitScore,
        flipPotential,
        reasons: reasons.join(', '),
        action,
        monitorName: a.monitor?.name,
        source: a.monitor?.source,
        createdAt: a.createdAt,
      };
    }).sort((a, b) => b.profitScore - a.profitScore);

    // AI enhancement: get AI reasoning for top 10
    const settings = await getSettingsRow();
    if (settings.aiProvider && ranked.length > 0) {
      try {
        const aiSettings: AiSettings = {
          provider: settings.aiProvider as AiProviderType,
          baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
          fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
          fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
          fallbackModel: settings.fallbackModel || '',
        };

        const top10 = ranked.slice(0, Math.min(10, ranked.length));
        const prompt = `Si ekspert za preprodajo na slovenskih oglasih. Za vsak alert določi prioritetno akcijo.

Alerti (urejeni po profitnem potencialu):
${top10.map((a, i) => `${i + 1}. ${a.title} — ${a.priceText} (profit score: ${a.profitScore}, ${a.reasons})`).join('\n')}

Za vsak alert določi:
1. priority (1-5, kjer je 5 najvišja)
2. reason (kratek razlog v slovenščini, max 100 znakov)
3. suggested_action (kupi/spremljaj/preskoci)

Odgovori LE z JSON: {"alerts": [{"priority": <1-5>, "reason": "<razlog>", "suggested_action": "<kupi|spremljaj|preskoci>"}]}`;

        const raw = await callProviderForRaw(aiSettings, prompt);
        const parsed: any = parseJsonLooseExported(raw);
        const aiResults = parsed?.alerts || [];

        // Merge AI results
        top10.forEach((a, i) => {
          if (aiResults[i]) {
            a.aiPriority = aiResults[i].priority;
            a.aiReason = String(aiResults[i].reason || '').slice(0, 200);
            a.suggestedAction = String(aiResults[i].suggested_action || '').slice(0, 50);
          }
        });

        // Increment AI usage
        const today = new Date().toISOString().slice(0, 10);
        if (settings.aiCallsDate !== today) {
          await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
        } else {
          await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
        }
      } catch { /* AI failure is non-critical */ }
    }

    return NextResponse.json({
      ok: true,
      prioritized: ranked.slice(0, limit),
      totalAlerts: alerts.length,
      highPriority: ranked.filter(a => a.profitScore >= 75).length,
      mediumPriority: ranked.filter(a => a.profitScore >= 55 && a.profitScore < 75).length,
      lowPriority: ranked.filter(a => a.profitScore < 55).length,
    });
  } catch (e: any) {
    logger.error("/api/ai/prioritize-alerts", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
