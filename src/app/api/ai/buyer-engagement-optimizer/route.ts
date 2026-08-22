// v6.55 / v8.94-refactor: AI Buyer Engagement Optimizer — optimizira engagement kupcev z personalization
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-engagement-optimizer
// Body: { customerName?: string }
// Returns: { ok, optimizer: { buyers, engagementFactors, personalization, campaigns, channels, summary } | null, message? }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const ENGAGEMENT_TIERS = ['champion', 'engaged', 'casual', 'dormant', 'lost'] as const;
const PERSONALIZATION_STRATEGIES = [
  'category_targeted', 'price_based', 'cross_sell', 'upsell',
  'repeat_buy', 'seasonal', 'trending', 'exclusive', 'winback', 'referral',
] as const;
const CAMPAIGNS = [
  'welcome', 'loyalty', 'reactivation', 'vip', 'seasonal',
  'birthday', 'new_arrival', 'exclusive_preview',
] as const;
const CHANNELS = ['email', 'sms', 'telegram', 'in_person', 'social'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;
const ENGAGEMENT_FACTORS = [
  'recency', 'frequency', 'monetary', 'diversity',
  'responsiveness', 'advocacy', 'loyalty', 'satisfaction',
] as const;
const FREQUENCIES = ['once', 'weekly', 'monthly', 'triggered'] as const;
const EFFORTS = ['low', 'medium', 'high'] as const;

interface EngagementData {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrderValue: number;
  daysAsCustomer: number;
  daysSinceLastPurchase: number;
  categories: Set<string>;
  items: string[];
  engagementScore: number; // 0-100
  preferredChannel: string;
  preferredTime: string;
}

interface BuyerEngagementInput {
  customerName: string | null;
}

export const POST = withAiRoute<BuyerEngagementInput>({
  endpoint: '/api/ai/buyer-engagement-optimizer',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget + avtomatsko recordAiCall po uspehu

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

    // 1. Pridobi sold trades
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, optimizer: null, message: 'Ni prodaj za engagement analizo.' });
    }

    // 2. Zgradi engagement analizo kupcev (RFM-style)
    const now = Date.now();
    const buyers = computeBuyerEngagement(soldTrades, now);

    // 3. Filter po customerName če podan
    if (customerName) {
      const filtered = buyers.filter(b => b.name === customerName);
      if (filtered.length === 0) {
        return apiOk({ ok: true, optimizer: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    // 4. Pripravi targetBuyers
    const targetBuyers = customerName
      ? buyers.filter(b => b.name === customerName)
      : buyers.slice(0, 25);

    // 5. AI klic
    const prompt = buildPrompt(targetBuyers);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    // 6. Transformacija rezultatov
    const optimizer = transformOptimizer(parsed, targetBuyers);

    return apiOk({ ok: true, optimizer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  sellLocation: string | null;
}

/**
 * Zgridi engagement analizo iz sold trades.
 * Group-a po sellLocation (ime kupca) in izračuna engagement score (0-100)
 * z RFM-style utežmi: recency 0.3, frequency 0.3, monetary 0.2, diversity 0.2.
 * Logika IDENTIČNA originalu (v6.55).
 */
function computeBuyerEngagement(soldTrades: SoldTradeRow[], now: number): EngagementData[] {
  const buyerMap = new Map<string, EngagementData>();

  for (const t of soldTrades) {
    const name = (t.sellLocation || '').trim();
    if (!name || name.length < 2 || !t.sellDate) continue;
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);

    if (!buyerMap.has(name)) {
      buyerMap.set(name, {
        name, purchases: 0, totalSpent: 0, avgOrderValue: 0,
        daysAsCustomer: 0, daysSinceLastPurchase: 0,
        categories: new Set<string>(), items: [],
        engagementScore: 0, preferredChannel: 'email', preferredTime: 'evening',
      });
    }
    const b = buyerMap.get(name)!;
    b.purchases += 1;
    b.totalSpent += revenue;
    if (t.category) b.categories.add(t.category);
    b.items.push(t.title);
  }

  return Array.from(buyerMap.values()).map(b => {
    b.avgOrderValue = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0;
    const daysSinceLast = Math.round((now - (soldTrades.find(t => t.sellLocation === b.name)?.sellDate!.getTime() ?? now)) / (24 * 60 * 60 * 1000));
    b.daysSinceLastPurchase = daysSinceLast;
    b.daysAsCustomer = Math.max(1, Math.round(daysSinceLast / b.purchases));
    const recencyScore = Math.max(0, 100 - Math.round(daysSinceLast / 3));
    const frequencyScore = Math.min(100, b.purchases * 15);
    const monetaryScore = Math.min(100, Math.round(b.totalSpent / 50));
    const diversityScore = Math.min(100, b.categories.size * 20);
    b.engagementScore = Math.min(100, Math.round((recencyScore * 0.3 + frequencyScore * 0.3 + monetaryScore * 0.2 + diversityScore * 0.2)));
    return b;
  });
}

/**
 * Zgradi AI prompt za buyer engagement optimizer.
 * Besedilo IDENTIČNO originalu (v6.55).
 */
function buildPrompt(targetBuyers: EngagementData[]): string {
  const buyersStr = targetBuyers.map(b =>
    `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | engagement ${b.engagementScore}/100 | ${b.daysSinceLastPurchase}d zadnji | kategorije: ${Array.from(b.categories).slice(0, 3).join(',')}`
  ).join('\n');

  return `Si AI buyer engagement optimizer za slovenske oglasne platforme.
Optimizira engagement kupcev z personalization in multi-channel kampanjami.

KUPCI (${targetBuyers.length}):
${buyersStr}

Engagement faktorji (0-100):
1. RECENCY: kako nedavno je kupec aktiven
2. FREQUENCY: kako pogosto kupuje
3. MONETARY: koliko porabi
4. DIVERSITY: raznolikost kategorij
5. RESPONSIVENESS: kako odziven je na outreach
6. ADVOCACY: ali priporoča drugim
7. LOYALTY: zvestoba brandu
8. SATISFACTION: zadovoljstvo (težko izmeriti direktno)

Personalization strategije:
1. CATEGORY_TARGETED: ponudi iteme iz buyerjevih preferred kategorij
2. PRICE_BASED: ponudi iteme v buyerjevem price range
3. CROSS_SELL: ponudi complementary iteme
4. UPSELL: ponudi dražjo verzijo
5. REPEAT_BUY: ponudi nadomestilo za prejšnji nakup
6. SEASONAL: ponudi sezonske iteme
7. TRENDING: ponudi trending iteme
8. EXCLUSIVE: ekskluzivna ponudba za loyal kupce
9. WINBACK: specifična ponudba za dormant kupce
10. REFERRAL: prošnja za priporočilo

Engagement kampanje:
- WELCOME: za nove kupce (1. nakup)
- LOYALTY: za repeat kupce (3+ nakupi)
- REACTIVATION: za dormant kupce (>90d)
- VIP: za high-value kupce (>500€ total)
- SEASONAL: za sezonske kupce
- BIRTHDAY: rojstni dan kupca (če poznan)
- NEW_ARRIVAL: ob novem inventarju
- EXCLUSIVE_PREVIEW: predhodni dostop za VIP

Multi-channel outreach:
- EMAIL: za detailed ponudbe z negotiable pricing
- SMS: za urgent limited-time offers
- TELEGRAM: za instant notifications
- IN_PERSON: za high-value local kupce
- SOCIAL: za social-savvy kupce

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    {
      "name": "<ime>",
      "engagement_score": <number 0-100>,
      "engagement_tier": "<champion|engaged|casual|dormant|lost>",
      "personalization_strategy": "<category_targeted|price_based|cross_sell|upsell|repeat_buy|seasonal|trending|exclusive|winback|referral>",
      "personalization_reasoning": "<max 120 znakov>",
      "recommended_campaign": "<welcome|loyalty|reactivation|vip|seasonal|birthday|new_arrival|exclusive_preview>",
      "preferred_channel": "<email|sms|telegram|in_person|social>",
      "preferred_timing": "<max 80 znakov>",
      "personalized_message": "<max 250 znakov>",
      "recommended_offers": ["<max 100 znakov>"],
      "expected_engagement_uplift_pct": <number>,
      "expected_revenue_eur": <number>,
      "priority": "<high|medium|low>"
    }
  ],
  "engagement_factors": [
    { "factor": "<recency|frequency|monetary|diversity|responsiveness|advocacy|loyalty|satisfaction>", "weight": <number 0-100>, "avg_score": <number 0-100>, "benchmark": <number 0-100>, "improvement_action": "<max 120 znakov>" }
  ],
  "personalization": [
    { "strategy": "<10 strategij>", "description": "<max 120 znakov>", "best_for_tier": "<champion|engaged|casual|dormant|lost>", "expected_engagement_uplift_pct": <number>, "implementation_difficulty": "<low|medium|high>" }
  ],
  "campaigns": [
    { "campaign": "<welcome|loyalty|reactivation|vip|seasonal|birthday|new_arrival|exclusive_preview>", "target_segment": "<max 80 znakov>", "buyer_count": <number>, "channel": "<email|sms|telegram|in_person|social>", "frequency": "<once|weekly|monthly|triggered>", "expected_conversion_pct": <number>, "expected_revenue_eur": <number> }
  ],
  "channels": [
    { "channel": "<email|sms|telegram|in_person|social>", "buyer_count": <number>, "avg_engagement_rate_pct": <number>, "avg_response_time_hours": <number>, "best_for_campaign": "<max 80 znakov>", "cost_per_message_eur": <number> }
  ],
  "summary": {
    "total_buyers_analyzed": <number>,
    "avg_engagement_score": <number>,
    "champion_count": <number>,
    "engaged_count": <number>,
    "casual_count": <number>,
    "dormant_count": <number>,
    "lost_count": <number>,
    "best_personalization_strategy": "<max 80 znakov>",
    "best_channel_overall": "<max 80 znakov>",
    "biggest_engagement_opportunity": "<max 100 znakov>",
    "engagement_optimization_score": <number 0-100>
  }
}`;
}

/**
 * Transformiraj AI JSON v optimizer objekt z vsemi clamp-i in whitelist-i.
 * Logika IDENTIČNA originalu (v6.55).
 */
function transformOptimizer(parsed: any, targetBuyers: EngagementData[]): any {
  const validNames = new Set(targetBuyers.map(b => b.name));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    buyers: (parsed?.buyers || [])
      .filter((b: any) => validNames.has(String(b?.name ?? '')))
      .slice(0, 25)
      .map((b: any) => ({
        name: String(b?.name ?? '').slice(0, 100),
        engagementScore: Math.max(0, Math.min(100, Number(b?.engagement_score ?? 50))),
        engagementTier: (ENGAGEMENT_TIERS as readonly string[]).includes(String(b?.engagement_tier)) ? String(b.engagement_tier) : 'casual',
        personalizationStrategy: (PERSONALIZATION_STRATEGIES as readonly string[]).includes(String(b?.personalization_strategy)) ? String(b.personalization_strategy) : 'category_targeted',
        personalizationReasoning: String(b?.personalization_reasoning ?? '').slice(0, 250),
        recommendedCampaign: (CAMPAIGNS as readonly string[]).includes(String(b?.recommended_campaign)) ? String(b.recommended_campaign) : 'loyalty',
        preferredChannel: (CHANNELS as readonly string[]).includes(String(b?.preferred_channel)) ? String(b.preferred_channel) : 'email',
        preferredTiming: String(b?.preferred_timing ?? '').slice(0, 150),
        personalizedMessage: String(b?.personalized_message ?? '').slice(0, 500),
        recommendedOffers: (b?.recommended_offers || []).slice(0, 4).map((o: any) => String(o).slice(0, 200)),
        expectedEngagementUpliftPct: Math.round(Number(b?.expected_engagement_uplift_pct ?? 0)),
        expectedRevenueEur: Math.round(Number(b?.expected_revenue_eur ?? 0)),
        priority: (PRIORITIES as readonly string[]).includes(String(b?.priority)) ? String(b.priority) : 'medium',
      })),
    engagementFactors: (parsed?.engagement_factors || []).slice(0, 8).map((f: any) => ({
      factor: (ENGAGEMENT_FACTORS as readonly string[]).includes(String(f?.factor)) ? String(f.factor) : 'recency',
      weight: Math.max(0, Math.min(100, Number(f?.weight ?? 50))),
      avgScore: Math.max(0, Math.min(100, Number(f?.avg_score ?? 50))),
      benchmark: Math.max(0, Math.min(100, Number(f?.benchmark ?? 50))),
      improvementAction: String(f?.improvement_action ?? '').slice(0, 250),
    })),
    personalization: (parsed?.personalization || []).slice(0, 10).map((p: any) => ({
      strategy: (PERSONALIZATION_STRATEGIES as readonly string[]).includes(String(p?.strategy)) ? String(p.strategy) : 'category_targeted',
      description: String(p?.description ?? '').slice(0, 250),
      bestForTier: (ENGAGEMENT_TIERS as readonly string[]).includes(String(p?.best_for_tier)) ? String(p.best_for_tier) : 'casual',
      expectedEngagementUpliftPct: Math.round(Number(p?.expected_engagement_uplift_pct ?? 0)),
      implementationDifficulty: (EFFORTS as readonly string[]).includes(String(p?.implementation_difficulty)) ? String(p.implementation_difficulty) : 'medium',
    })),
    campaigns: (parsed?.campaigns || []).slice(0, 8).map((c: any) => ({
      campaign: (CAMPAIGNS as readonly string[]).includes(String(c?.campaign)) ? String(c.campaign) : 'loyalty',
      targetSegment: String(c?.target_segment ?? '').slice(0, 150),
      buyerCount: Math.max(0, Number(c?.buyer_count ?? 0)),
      channel: (CHANNELS as readonly string[]).includes(String(c?.channel)) ? String(c.channel) : 'email',
      frequency: (FREQUENCIES as readonly string[]).includes(String(c?.frequency)) ? String(c.frequency) : 'triggered',
      expectedConversionPct: Math.max(0, Math.min(100, Number(c?.expected_conversion_pct ?? 30))),
      expectedRevenueEur: Math.round(Number(c?.expected_revenue_eur ?? 0)),
    })),
    channels: (parsed?.channels || []).slice(0, 5).map((c: any) => ({
      channel: (CHANNELS as readonly string[]).includes(String(c?.channel)) ? String(c.channel) : 'email',
      buyerCount: Math.max(0, Number(c?.buyer_count ?? 0)),
      avgEngagementRatePct: Math.max(0, Math.min(100, Number(c?.avg_engagement_rate_pct ?? 30))),
      avgResponseTimeHours: Math.round(Number(c?.avg_response_time_hours ?? 24)),
      bestForCampaign: String(c?.best_for_campaign ?? '').slice(0, 150),
      costPerMessageEur: Math.round(Number(c?.cost_per_message_eur ?? 0) * 100) / 100,
    })),
    summary: {
      totalBuyersAnalyzed: targetBuyers.length,
      avgEngagementScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_engagement_score ?? Math.round(targetBuyers.reduce((s, b) => s + b.engagementScore, 0) / Math.max(1, targetBuyers.length))))),
      championCount: Math.max(0, Number(parsed?.summary?.champion_count ?? 0)),
      engagedCount: Math.max(0, Number(parsed?.summary?.engaged_count ?? 0)),
      casualCount: Math.max(0, Number(parsed?.summary?.casual_count ?? 0)),
      dormantCount: Math.max(0, Number(parsed?.summary?.dormant_count ?? 0)),
      lostCount: Math.max(0, Number(parsed?.summary?.lost_count ?? 0)),
      bestPersonalizationStrategy: (PERSONALIZATION_STRATEGIES as readonly string[]).includes(String(parsed?.summary?.best_personalization_strategy)) ? String(parsed.summary.best_personalization_strategy) : 'category_targeted',
      bestChannelOverall: (CHANNELS as readonly string[]).includes(String(parsed?.summary?.best_channel_overall)) ? String(parsed.summary.best_channel_overall) : 'email',
      biggestEngagementOpportunity: String(parsed?.summary?.biggest_engagement_opportunity ?? '').slice(0, 200),
      engagementOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.engagement_optimization_score ?? 50))),
    },
  };
}
