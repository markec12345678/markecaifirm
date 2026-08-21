// v6.89 / v8.95.3-batch2: AI Buyer Engagement Predictor v2 — ML napoved engagementa kupcev z multi-channel scoring
// Refaktoriran z withAiRoute helperjem (v8.95.3-batch2) + enforceBudget guard.
//
// POST /api/ai/buyer-engagement-predictor-v2
// Body: { customerName?: string }
// Returns: { ok, predictor: { overview, buyers, engagementChannels, engagementDrivers, recommendations, mlModels, summary } | null, message? }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const ENGAGEMENT_LEVELS = ['highly_engaged', 'engaged', 'moderately_engaged', 'low_engagement', 'disengaged', 'dormant'] as const;
const ENGAGEMENT_DRIVERS = ['purchase_recency', 'purchase_frequency', 'browsing_activity', 'email_open_rate', 'message_response_time', 'review_activity', 'wishlist_adds', 'price_alert_engagement', 'social_shares', 'community_participation'] as const;

interface BuyerEngagementPredictorV2Input {
  customerName: string | null;
}

interface BuyerRow {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrder: number;
  firstPurchase: Date | null;
  lastPurchase: Date | null;
  categories: Set<string>;
  daysSinceLast: number;
  lifetimeDays: number;
}

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  sellLocation: string | null;
  buyDate: Date | null;
}

export const POST = withAiRoute<BuyerEngagementPredictorV2Input>({
  endpoint: '/api/ai/buyer-engagement-predictor-v2',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      customerName: body?.customerName ? String(body.customerName).trim() : null,
    };
  },

  // No validateInput — vsi input-i imajo defaults (customerName=null)

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { customerName } = input;

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, predictor: null, message: 'Ni prodaj za engagement analizo.' });
    }

    const buyers = buildBuyers(soldTrades);

    if (customerName) {
      const filtered = buyers.filter(b => b.name === customerName);
      if (filtered.length === 0) {
        return apiOk({ ok: true, predictor: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);

    const prompt = buildPrompt(targetBuyers);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const predictor = transformPredictor(parsed, targetBuyers);

    return apiOk({ ok: true, predictor });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildBuyers(soldTrades: SoldTradeRow[]): BuyerRow[] {
  const buyerMap = new Map<string, BuyerRow>();
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  for (const t of soldTrades) {
    const name = (t.sellLocation || '').trim();
    if (!name || name.length < 2 || !t.sellDate) continue;
    const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, firstPurchase: t.sellDate, lastPurchase: t.sellDate, categories: new Set(), daysSinceLast: 0, lifetimeDays: 0 });
    const b = buyerMap.get(name)!;
    b.purchases += 1; b.totalSpent += rev;
    if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate;
    if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
    if (t.category) b.categories.add(t.category);
  }
  return Array.from(buyerMap.values()).map(b => { b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0; b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / DAY) : 999; b.lifetimeDays = b.firstPurchase ? Math.round((now - b.firstPurchase.getTime()) / DAY) : 0; return b; });
}

function buildPrompt(targetBuyers: BuyerRow[]): string {
  const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d | ${b.lifetimeDays}d | ${b.categories.size} kat`).join('\n');

  return `Si AI buyer engagement predictor v2 z ML in multi-channel scoring.
Napoveduje engagement kupcev z 6 nivoji in 10 dejavniki.

KUPCI (${targetBuyers.length}):
${buyersStr}

6 nivojev engagementa:
1. HIGHLY_ENGAGED: zelo angažiran (85-100%)
2. ENGAGED: angažiran (70-84%)
3. MODERATELY_ENGAGED: zmerno (50-69%)
4. LOW_ENGAGEMENT: nizko (30-49%)
5. DISENGAGED: neangažiran (10-29%)
6. DORMANT: neaktiven (<10%)

10 dejavnikov engagementa: purchase_recency, purchase_frequency, browsing_activity, email_open_rate, message_response_time, review_activity, wishlist_adds, price_alert_engagement, social_shares, community_participation

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_buyers": <number>, "avg_engagement_score": <number 0-100>, "highly_engaged_count": <number>, "dormant_count": <number>, "engagement_trend": "<improving|stable|declining>", "engagement_grade": "<A|B|C|D|F>" },
  "buyers": [
    { "name": "<string>", "engagement_score": <number 0-100>, "engagement_level": "<${ENGAGEMENT_LEVELS.join('|')}>", "predicted_engagement_30d_pct": <number 0-100>, "predicted_engagement_90d_pct": <number 0-100>, "engagement_trend": "<improving|stable|declining>", "primary_driver": "<${ENGAGEMENT_DRIVERS.join('|')}>", "risk_of_disengagement_pct": <number 0-100>, "recommended_action": "<maintain|boost|reactivate|win_back|monitor>" }
  ],
  "engagementChannels": [
    { "channel": "<email|sms|whatsapp|push_notification|social_media|in_app|phone|direct_mail>", "avg_engagement_rate_pct": <number 0-100>, "best_segment": "<${ENGAGEMENT_LEVELS.join('|')}>", "optimal_frequency": "<daily|weekly|bi_weekly|monthly>", "preferred_content_type": "<promotional|educational|transactional|community>", "roi_pct": <number> }
  ],
  "engagementDrivers": [
    { "driver": "<${ENGAGEMENT_DRIVERS.join('|')}>", "avg_score": <number 0-100>, "weight_pct": <number 0-100>, "impact_on_engagement": "<high|medium|low>", "improvement_potential_pct": <number 0-50>, "improvement_strategy": "<max 120 znakov>" }
  ],
  "recommendations": [
    { "buyer_name": "<string>", "action": "<max 150 znakov>", "channel": "<email|sms|whatsapp|push_notification|social_media|in_app|phone|direct_mail>", "expected_engagement_lift_pct": <number 0-30>, "implementation_days": <number>, "priority": "<high|medium|low>", "personalization_factor": "<max 100 znakov>" }
  ],
  "mlModels": [
    { "model": "<random_forest|xgboost|neural_net|lstm|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<engagement_prediction|churn_risk|channel_optimization|content_personalization>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "engagement_prediction_score": <number 0-100>, "engagement_grade": "<A|B|C|D|F>", "avg_engagement_score": <number 0-100>,
    "highly_engaged_count": <number>, "dormant_count": <number>,
    "biggest_engagement_risk": "<max 100 znakov>", "biggest_engagement_opportunity": "<max 100 znakov>",
    "quickest_engagement_win": "<max 100 znakov>", "engagement_analysis_score": <number 0-100>
  }
}`;
}

function transformPredictor(parsed: any, targetBuyers: BuyerRow[]): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    overview: { totalBuyers: Math.max(0, Number(parsed?.overview?.total_buyers ?? targetBuyers.length)), avgEngagementScore: Math.max(0, Math.min(100, Number(parsed?.overview?.avg_engagement_score ?? 55))), highlyEngagedCount: Math.max(0, Number(parsed?.overview?.highly_engaged_count ?? 0)), dormantCount: Math.max(0, Number(parsed?.overview?.dormant_count ?? 0)), engagementTrend: ['improving', 'stable', 'declining'].includes(String(parsed?.overview?.engagement_trend)) ? String(parsed.overview.engagement_trend) : 'stable', engagementGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.engagement_grade)) ? String(parsed.overview.engagement_grade) : 'C' },
    buyers: (parsed?.buyers || []).slice(0, 25).map((b: any) => ({ name: String(b?.name ?? '').slice(0, 100), engagementScore: Math.max(0, Math.min(100, Number(b?.engagement_score ?? 55))), engagementLevel: (ENGAGEMENT_LEVELS as readonly string[]).includes(String(b?.engagement_level)) ? String(b.engagement_level) : 'moderately_engaged', predictedEngagement30dPct: Math.max(0, Math.min(100, Number(b?.predicted_engagement_30d_pct ?? 55))), predictedEngagement90dPct: Math.max(0, Math.min(100, Number(b?.predicted_engagement_90d_pct ?? 50))), engagementTrend: ['improving', 'stable', 'declining'].includes(String(b?.engagement_trend)) ? String(b.engagement_trend) : 'stable', primaryDriver: (ENGAGEMENT_DRIVERS as readonly string[]).includes(String(b?.primary_driver)) ? String(b.primary_driver) : 'purchase_recency', riskOfDisengagementPct: Math.max(0, Math.min(100, Number(b?.risk_of_disengagement_pct ?? 25))), recommendedAction: ['maintain', 'boost', 'reactivate', 'win_back', 'monitor'].includes(String(b?.recommended_action)) ? String(b.recommended_action) : 'maintain' })),
    engagementChannels: (parsed?.engagementChannels || []).slice(0, 8).map((c: any) => ({ channel: ['email', 'sms', 'whatsapp', 'push_notification', 'social_media', 'in_app', 'phone', 'direct_mail'].includes(String(c?.channel)) ? String(c.channel) : 'email', avgEngagementRatePct: Math.max(0, Math.min(100, Number(c?.avg_engagement_rate_pct ?? 30))), bestSegment: (ENGAGEMENT_LEVELS as readonly string[]).includes(String(c?.best_segment)) ? String(c.best_segment) : 'engaged', optimalFrequency: ['daily', 'weekly', 'bi_weekly', 'monthly'].includes(String(c?.optimal_frequency)) ? String(c.optimal_frequency) : 'weekly', preferredContentType: ['promotional', 'educational', 'transactional', 'community'].includes(String(c?.preferred_content_type)) ? String(c.preferred_content_type) : 'promotional', roiPct: Math.round(Number(c?.roi_pct ?? 0) * 10) / 10 })),
    engagementDrivers: (parsed?.engagementDrivers || []).slice(0, 10).map((d: any) => ({ driver: (ENGAGEMENT_DRIVERS as readonly string[]).includes(String(d?.driver)) ? String(d.driver) : 'purchase_recency', avgScore: Math.max(0, Math.min(100, Number(d?.avg_score ?? 50))), weightPct: Math.max(0, Math.min(100, Number(d?.weight_pct ?? 10))), impactOnEngagement: ['high', 'medium', 'low'].includes(String(d?.impact_on_engagement)) ? String(d.impact_on_engagement) : 'medium', improvementPotentialPct: Math.max(0, Math.min(50, Number(d?.improvement_potential_pct ?? 15))), improvementStrategy: String(d?.improvement_strategy ?? '').slice(0, 250) })),
    recommendations: (parsed?.recommendations || []).slice(0, 10).map((r: any) => ({ buyerName: String(r?.buyer_name ?? '').slice(0, 100), action: String(r?.action ?? '').slice(0, 300), channel: ['email', 'sms', 'whatsapp', 'push_notification', 'social_media', 'in_app', 'phone', 'direct_mail'].includes(String(r?.channel)) ? String(r.channel) : 'email', expectedEngagementLiftPct: Math.max(0, Math.min(30, Number(r?.expected_engagement_lift_pct ?? 10))), implementationDays: Math.max(1, Number(r?.implementation_days ?? 7)), priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium', personalizationFactor: String(r?.personalization_factor ?? '').slice(0, 200) })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['random_forest', 'xgboost', 'neural_net', 'lstm', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['engagement_prediction', 'churn_risk', 'channel_optimization', 'content_personalization'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'engagement_prediction', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
    summary: { engagementPredictionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.engagement_prediction_score ?? 50))), engagementGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.engagement_grade)) ? String(parsed.summary.engagement_grade) : 'C', avgEngagementScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_engagement_score ?? 55))), highlyEngagedCount: Math.max(0, Number(parsed?.summary?.highly_engaged_count ?? 0)), dormantCount: Math.max(0, Number(parsed?.summary?.dormant_count ?? 0)), biggestEngagementRisk: String(parsed?.summary?.biggest_engagement_risk ?? '').slice(0, 200), biggestEngagementOpportunity: String(parsed?.summary?.biggest_engagement_opportunity ?? '').slice(0, 200), quickestEngagementWin: String(parsed?.summary?.quickest_engagement_win ?? '').slice(0, 200), engagementAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.engagement_analysis_score ?? 50))) },
  };
}
