// v6.55: AI Buyer Engagement Optimizer — optimizira engagement kupcev z personalization
// POST /api/ai/buyer-engagement-optimizer
// Body: { customerName?: string }
// Returns: { ok, optimizer: { buyers, engagementFactors, personalization, campaigns, channels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return NextResponse.json({ ok: true, optimizer: null, message: 'Ni prodaj za engagement analizo.' });
    }

    const buyerMap = new Map<string, EngagementData>();
    const now = Date.now();

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

    const buyers = Array.from(buyerMap.values()).map(b => {
      b.avgOrderValue = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0;
      const daysSinceLast = Math.round((now - (soldTrades.find(t => t.sellLocation === b.name)?.sellDate!.getTime() ?? now)) / (24*60*60*1000));
      b.daysSinceLastPurchase = daysSinceLast;
      b.daysAsCustomer = Math.max(1, Math.round(daysSinceLast / b.purchases));
      const recencyScore = Math.max(0, 100 - Math.round(daysSinceLast / 3));
      const frequencyScore = Math.min(100, b.purchases * 15);
      const monetaryScore = Math.min(100, Math.round(b.totalSpent / 50));
      const diversityScore = Math.min(100, b.categories.size * 20);
      b.engagementScore = Math.min(100, Math.round((recencyScore * 0.3 + frequencyScore * 0.3 + monetaryScore * 0.2 + diversityScore * 0.2)));
      return b;
    });

    if (customerName) {
      const filtered = buyers.filter(b => b.name === customerName);
      if (filtered.length === 0) {
        return NextResponse.json({ ok: true, optimizer: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const targetBuyers = customerName
      ? buyers.filter(b => b.name === customerName)
      : buyers.slice(0, 25);

    const buyersStr = targetBuyers.map(b =>
      `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | engagement ${b.engagementScore}/100 | ${b.daysSinceLastPurchase}d zadnji | kategorije: ${Array.from(b.categories).slice(0, 3).join(',')}`
    ).join('\n');

    const prompt = `Si AI buyer engagement optimizer za slovenske oglasne platforme.
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

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const validNames = new Set(targetBuyers.map(b => b.name));

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      buyers: (parsed?.buyers || [])
        .filter((b: any) => validNames.has(String(b?.name ?? '')))
        .slice(0, 25)
        .map((b: any) => ({
          name: String(b?.name ?? '').slice(0, 100),
          engagementScore: Math.max(0, Math.min(100, Number(b?.engagement_score ?? 50))),
          engagementTier: ['champion', 'engaged', 'casual', 'dormant', 'lost'].includes(String(b?.engagement_tier)) ? String(b.engagement_tier) : 'casual',
          personalizationStrategy: ['category_targeted', 'price_based', 'cross_sell', 'upsell', 'repeat_buy', 'seasonal', 'trending', 'exclusive', 'winback', 'referral'].includes(String(b?.personalization_strategy)) ? String(b.personalization_strategy) : 'category_targeted',
          personalizationReasoning: String(b?.personalization_reasoning ?? '').slice(0, 250),
          recommendedCampaign: ['welcome', 'loyalty', 'reactivation', 'vip', 'seasonal', 'birthday', 'new_arrival', 'exclusive_preview'].includes(String(b?.recommended_campaign)) ? String(b.recommended_campaign) : 'loyalty',
          preferredChannel: ['email', 'sms', 'telegram', 'in_person', 'social'].includes(String(b?.preferred_channel)) ? String(b.preferred_channel) : 'email',
          preferredTiming: String(b?.preferred_timing ?? '').slice(0, 150),
          personalizedMessage: String(b?.personalized_message ?? '').slice(0, 500),
          recommendedOffers: (b?.recommended_offers || []).slice(0, 4).map((o: any) => String(o).slice(0, 200)),
          expectedEngagementUpliftPct: Math.round(Number(b?.expected_engagement_uplift_pct ?? 0)),
          expectedRevenueEur: Math.round(Number(b?.expected_revenue_eur ?? 0)),
          priority: ['high', 'medium', 'low'].includes(String(b?.priority)) ? String(b.priority) : 'medium',
        })),
      engagementFactors: (parsed?.engagement_factors || []).slice(0, 8).map((f: any) => ({
        factor: ['recency', 'frequency', 'monetary', 'diversity', 'responsiveness', 'advocacy', 'loyalty', 'satisfaction'].includes(String(f?.factor)) ? String(f.factor) : 'recency',
        weight: Math.max(0, Math.min(100, Number(f?.weight ?? 50))),
        avgScore: Math.max(0, Math.min(100, Number(f?.avg_score ?? 50))),
        benchmark: Math.max(0, Math.min(100, Number(f?.benchmark ?? 50))),
        improvementAction: String(f?.improvement_action ?? '').slice(0, 250),
      })),
      personalization: (parsed?.personalization || []).slice(0, 10).map((p: any) => ({
        strategy: ['category_targeted', 'price_based', 'cross_sell', 'upsell', 'repeat_buy', 'seasonal', 'trending', 'exclusive', 'winback', 'referral'].includes(String(p?.strategy)) ? String(p.strategy) : 'category_targeted',
        description: String(p?.description ?? '').slice(0, 250),
        bestForTier: ['champion', 'engaged', 'casual', 'dormant', 'lost'].includes(String(p?.best_for_tier)) ? String(p.best_for_tier) : 'casual',
        expectedEngagementUpliftPct: Math.round(Number(p?.expected_engagement_uplift_pct ?? 0)),
        implementationDifficulty: ['low', 'medium', 'high'].includes(String(p?.implementation_difficulty)) ? String(p.implementation_difficulty) : 'medium',
      })),
      campaigns: (parsed?.campaigns || []).slice(0, 8).map((c: any) => ({
        campaign: ['welcome', 'loyalty', 'reactivation', 'vip', 'seasonal', 'birthday', 'new_arrival', 'exclusive_preview'].includes(String(c?.campaign)) ? String(c.campaign) : 'loyalty',
        targetSegment: String(c?.target_segment ?? '').slice(0, 150),
        buyerCount: Math.max(0, Number(c?.buyer_count ?? 0)),
        channel: ['email', 'sms', 'telegram', 'in_person', 'social'].includes(String(c?.channel)) ? String(c.channel) : 'email',
        frequency: ['once', 'weekly', 'monthly', 'triggered'].includes(String(c?.frequency)) ? String(c.frequency) : 'triggered',
        expectedConversionPct: Math.max(0, Math.min(100, Number(c?.expected_conversion_pct ?? 30))),
        expectedRevenueEur: Math.round(Number(c?.expected_revenue_eur ?? 0)),
      })),
      channels: (parsed?.channels || []).slice(0, 5).map((c: any) => ({
        channel: ['email', 'sms', 'telegram', 'in_person', 'social'].includes(String(c?.channel)) ? String(c.channel) : 'email',
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
        bestPersonalizationStrategy: ['category_targeted', 'price_based', 'cross_sell', 'upsell', 'repeat_buy', 'seasonal', 'trending', 'exclusive', 'winback', 'referral'].includes(String(parsed?.summary?.best_personalization_strategy)) ? String(parsed.summary.best_personalization_strategy) : 'category_targeted',
        bestChannelOverall: ['email', 'sms', 'telegram', 'in_person', 'social'].includes(String(parsed?.summary?.best_channel_overall)) ? String(parsed.summary.best_channel_overall) : 'email',
        biggestEngagementOpportunity: String(parsed?.summary?.biggest_engagement_opportunity ?? '').slice(0, 200),
        engagementOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.engagement_optimization_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { logger.error("/api/ai/buyer-engagement-optimizer", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
