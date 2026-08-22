// v6.6 / v8.94-refactor: AI Deal Alert Prioritization — rangiraj alerte po profitnem potencialu
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/prioritize-alerts
// Body: { limit?: number (default 20) }
// Returns: { ok, prioritized: Array<{ alertId, title, url, profitScore, flipPotential, reason, action }> }

import { NextResponse } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 120;

interface PrioritizeAlertsInput {
  limit: number;
}

export const POST = withAiRoute<PrioritizeAlertsInput>({
  endpoint: '/api/ai/prioritize-alerts',
  maxDuration: 120,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { limit: Math.min(50, Math.max(5, Number(body?.limit ?? 20))) };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, aiSettings } = ctx;
    const { limit } = input;

    // 1. Pridobi neprebrane alerte z listing podatki
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
      return apiOk({ prioritized: [], message: 'Ni neprebranih alertov.' });
    }

    // 2. Heuristično rangiranje (brez AI — hitro)
    const ranked = alerts.map(a => rankAlert(a)).sort((a, b) => b.profitScore - a.profitScore);

    // 3. AI enhancement za top 10 (samo če je AI konfiguriran)
    if (aiSettings.provider && ranked.length > 0) {
      try {
        await enhanceWithAi(ranked, callAi, parseAi);
      } catch {
        // AI failure je non-critical — heuristic ranking je dovolj
      }
    }

    return apiOk({
      prioritized: ranked.slice(0, limit),
      totalAlerts: alerts.length,
      highPriority: ranked.filter(a => a.profitScore >= 75).length,
      mediumPriority: ranked.filter(a => a.profitScore >= 55 && a.profitScore < 75).length,
      lowPriority: ranked.filter(a => a.profitScore < 55).length,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface RankedAlert {
  alertId: string;
  title: string;
  url: string;
  price: number | null;
  priceText: string;
  aiVerdict: string | null;
  dealScore: number | null;
  aiEstimatedValue: number | null;
  profitScore: number;
  flipPotential: 'high' | 'medium' | 'low';
  reasons: string;
  action: string;
  monitorName?: string;
  source?: string;
  createdAt: Date;
  aiPriority?: number;
  aiReason?: string;
  suggestedAction?: string;
}

function rankAlert(a: {
  id: string; title: string; url: string; aiVerdict: string | null; createdAt: Date;
  listing: {
    price: number | null; priceText: string; dealScore: number | null;
    aiEstimatedValue: number | null; aiScore: number | null; isBookmarked: boolean;
    targetPrice: number | null;
  } | null;
  monitor: { name: string; source: string } | null;
}): RankedAlert {
  const l = a.listing;
  let profitScore = 50;
  const reasons: string[] = [];

  if (a.aiVerdict === 'PRILIKA') { profitScore += 20; reasons.push('AI PRILIKA'); }
  else if (a.aiVerdict === 'SUMNJIVO') { profitScore -= 20; reasons.push('AI SUMNJIVO'); }

  if (l?.dealScore != null) {
    if (l.dealScore >= 80) { profitScore += 15; reasons.push(`Deal Score ${l.dealScore}`); }
    else if (l.dealScore >= 60) { profitScore += 8; }
  }

  if (l?.aiEstimatedValue && l?.price) {
    const margin = l.aiEstimatedValue - l.price;
    const marginPct = Math.round((margin / l.price) * 100);
    if (marginPct > 30) { profitScore += 15; reasons.push(`${marginPct}% pod tržno`); }
    else if (marginPct > 15) { profitScore += 8; }
    else if (marginPct < 0) { profitScore -= 10; }
  }

  if (l?.aiScore != null) {
    if (l.aiScore >= 8) profitScore += 10;
    else if (l.aiScore <= 3) profitScore -= 10;
  }

  if (l?.isBookmarked) { profitScore += 5; reasons.push('shranjeno'); }

  if (l?.targetPrice && l?.price && l.price <= l.targetPrice) {
    profitScore += 10; reasons.push('ciljna cena dosežena');
  }

  profitScore = Math.max(0, Math.min(100, profitScore));

  let flipPotential: 'high' | 'medium' | 'low' = 'low';
  if (profitScore >= 75) flipPotential = 'high';
  else if (profitScore >= 55) flipPotential = 'medium';

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
}

async function enhanceWithAi(
  ranked: RankedAlert[],
  callAi: AiRouteContext['callAi'],
  parseAi: AiRouteContext['parseAi']
): Promise<void> {
  const top10 = ranked.slice(0, Math.min(10, ranked.length));
  const prompt = `Si ekspert za preprodajo na slovenskih oglasih. Za vsak alert določi prioritetno akcijo.

Alerti (urejeni po profitnem potencialu):
${top10.map((a, i) => `${i + 1}. ${a.title} — ${a.priceText} (profit score: ${a.profitScore}, ${a.reasons})`).join('\n')}

Za vsak alert določi:
1. priority (1-5, kjer je 5 najvišja)
2. reason (kratek razlog v slovenščini, max 100 znakov)
3. suggested_action (kupi/spremljaj/preskoci)

Odgovori LE z JSON: {"alerts": [{"priority": <1-5>, "reason": "<razlog>", "suggested_action": "<kupi|spremljaj|preskoci>"}]}`;

  const raw = await callAi(prompt);
  const parsed: any = parseAi(raw);
  const aiResults = parsed?.alerts || [];

  top10.forEach((a, i) => {
    if (aiResults[i]) {
      a.aiPriority = aiResults[i].priority;
      a.aiReason = String(aiResults[i].reason || '').slice(0, 200);
      a.suggestedAction = String(aiResults[i].suggested_action || '').slice(0, 50);
    }
  });
}
