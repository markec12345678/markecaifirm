// v6.53: AI Buyer Networking Strategist — identificira povezave med kupci za network effects
// POST /api/ai/buyer-networking-strategist
// Body: { customerName?: string }
// Returns: { ok, strategist: { networks, clusters, referralOpportunities, networkEffects, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

interface BuyerNode {
  name: string;
  purchases: number;
  totalSpent: number;
  categories: Set<string>;
  items: string[];
  location: string;
  lastPurchase: Date | null;
  networkScore: number; // 0-100
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return NextResponse.json({ ok: true, strategist: null, message: 'Ni prodaj za networking analizo.' });
    }

    // Buyer aggregation
    const buyerMap = new Map<string, BuyerNode>();
    const now = Date.now();

    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2) continue;
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);

      if (!buyerMap.has(name)) {
        buyerMap.set(name, {
          name, purchases: 0, totalSpent: 0, categories: new Set<string>(),
          items: [], location: name, lastPurchase: null, networkScore: 0,
        });
      }
      const b = buyerMap.get(name)!;
      b.purchases += 1;
      b.totalSpent += revenue;
      if (t.category) b.categories.add(t.category);
      b.items.push(t.title);
      if (t.sellDate && (!b.lastPurchase || t.sellDate > b.lastPurchase)) b.lastPurchase = t.sellDate;
    }

    // Network analysis: find buyers with shared categories (potential connections)
    const buyers = Array.from(buyerMap.values()).filter(b => b.purchases >= 1);

    // Compute network connections (shared categories)
    const connections: Array<{ a: string; b: string; sharedCategories: string[]; strength: number }> = [];
    for (let i = 0; i < buyers.length; i++) {
      for (let j = i + 1; j < buyers.length; j++) {
        const a = buyers[i];
        const b = buyers[j];
        const sharedCats = Array.from(a.categories).filter(c => b.categories.has(c));
        if (sharedCats.length > 0) {
          const strength = Math.min(100, sharedCats.length * 25 + Math.min(50, (a.purchases + b.purchases) * 5));
          connections.push({ a: a.name, b: b.name, sharedCategories: sharedCats, strength });
        }
      }
    }

    // Compute network score per buyer (number + strength of connections)
    buyers.forEach(b => {
      const buyerConnections = connections.filter(c => c.a === b.name || c.b === b.name);
      const totalStrength = buyerConnections.reduce((s, c) => s + c.strength, 0);
      b.networkScore = Math.min(100, Math.round((buyerConnections.length * 10 + totalStrength / 5) / Math.max(1, buyerConnections.length)));
    });

    // Sort by network score
    buyers.sort((a, b) => b.networkScore - a.networkScore);

    if (customerName) {
      const filtered = buyers.filter(b => b.name === customerName);
      if (filtered.length === 0) {
        return NextResponse.json({ ok: true, strategist: null, message: `Kupec "${customerName}" ni najden.` });
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

    const buyersStr = targetBuyers.slice(0, 15).map(b =>
      `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | kategorije: ${Array.from(b.categories).slice(0, 3).join(',')} | network score ${b.networkScore}/100`
    ).join('\n');

    const topConnections = connections
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 15)
      .map(c => `- ${c.a} ↔ ${c.b} | shared: ${c.sharedCategories.join(',')} | strength ${c.strength}/100`)
      .join('\n');

    const prompt = `Si AI buyer networking strategist za slovenske oglasne platforme.
Identificiraj povezave med kupci in predlagaj network effects strategije.

KUPCI (${targetBuyers.length}):
${buyersStr}

TOP POVEZAVE (shared kategorije):
${topConnections}

Network strategije:
1. REFERRAL_PROGRAM: kupci priporočajo drug drugega za popust
2. COMMUNITY_BUILDING: ustvari skupnost kupcev z istimi interesi
3. CROSS_INTRODUCTION: predstavi kupce z istimi interesi drug drugemu
4. BUNDLE_SPLIT: dva kupca kupita skupaj bundle (npr. 2x telefon)
5. GROUP_DISCOUNT: 3+ kupci kupijo skupaj za skupinski popust
6. CATEGORY_AMBASSADOR: najaktivnejši kupec v kategoriji postane "ambasador"
7. LOCAL_NETWORK: poveži kupce iz iste regije za local pickup
8. SEASONAL_NETWORK: poveži sezonske kupce (smučarji poleti, kolesarji pozimi)
9. FAMILY_NETWORK: poveži družine z istimi potrebami (šolarji, novorojenčki)
10. COLLECTOR_NETWORK: poveži collectorje istih itemov

Network effects:
- DIRECT: 1 kupca direktno poveže drugega (npr. referral)
- INDIRECT: 1 kupca v skupini povzroči network value za vse
- TWO_SIDED: kupci in prodajalci si medsebojno koristijo
- DATA: več kupcev = boljši AI predikciji za vse
- PLATFORM: network value raste z vsakim novim kupcem

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "networks": [
    {
      "network_name": "<max 80 znakov>",
      "type": "<referral_program|community_building|cross_introduction|bundle_split|group_discount|category_ambassador|local_network|seasonal_network|family_network|collector_network>",
      "members": ["<ime kupca>"],
      "shared_interest": "<max 80 znakov>",
      "network_strength_score": <number 0-100>,
      "potential_revenue_eur": <number>,
      "implementation_difficulty": "<low|medium|high>",
      "expected_participation_rate_pct": <number>
    }
  ],
  "clusters": [
    {
      "cluster_name": "<max 80 znakov>",
      "category_focus": "<max 80 znakov>",
      "member_count": <number>,
      "total_spent_eur": <number>,
      "avg_spent_per_member_eur": <number>,
      "key_members": ["<ime>"],
      "cluster_strength": <number 0-100>,
      "growth_potential": "<high|medium|low>"
    }
  ],
  "referral_opportunities": [
    {
      "referrer": "<ime>",
      "potential_referrals": ["<ime>"],
      "shared_category": "<max 50 znakov>",
      "referral_incentive_eur": <number>,
      "expected_conversion_rate_pct": <number>,
      "potential_revenue_eur": <number>,
      "best_channel": "<email|sms|in_person|social>"
    }
  ],
  "network_effects": [
    {
      "effect_type": "<direct|indirect|two_sided|data|platform>",
      "description": "<max 120 znakov>",
      "current_strength": <number 0-100>,
      "potential_strength": <number 0-100>,
      "improvement_action": "<max 150 znakov>",
      "expected_revenue_impact_eur": <number>
    }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "network_type": "<max 50 znakov>", "expected_revenue_impact_eur": <number>, "implementation_timeline_days": <number> }
  ],
  "summary": {
    "total_buyers_analyzed": <number>,
    "total_connections_found": <number>,
    "avg_network_score": <number>,
    "strongest_network": "<max 100 znakov>",
    "biggest_network_opportunity": "<max 100 znakov>",
    "potential_network_revenue_eur": <number>,
    "referral_conversion_rate_pct": <number>,
    "networking_efficiency_score": <number 0-100>
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

    const strategist = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      networks: (parsed?.networks || [])
        .filter((n: any) => (n?.members || []).some((m: any) => validNames.has(String(m))))
        .slice(0, 10)
        .map((n: any) => ({
          networkName: String(n?.network_name ?? '').slice(0, 150),
          type: ['referral_program', 'community_building', 'cross_introduction', 'bundle_split', 'group_discount', 'category_ambassador', 'local_network', 'seasonal_network', 'family_network', 'collector_network'].includes(String(n?.type)) ? String(n.type) : 'referral_program',
          members: (n?.members || []).filter((m: any) => validNames.has(String(m))).slice(0, 10).map((m: any) => String(m).slice(0, 100)),
          sharedInterest: String(n?.shared_interest ?? '').slice(0, 150),
          networkStrengthScore: Math.max(0, Math.min(100, Number(n?.network_strength_score ?? 50))),
          potentialRevenueEur: Math.round(Number(n?.potential_revenue_eur ?? 0)),
          implementationDifficulty: ['low', 'medium', 'high'].includes(String(n?.implementation_difficulty)) ? String(n.implementation_difficulty) : 'medium',
          expectedParticipationRatePct: Math.max(0, Math.min(100, Number(n?.expected_participation_rate_pct ?? 30))),
        })),
      clusters: (parsed?.clusters || []).slice(0, 8).map((c: any) => ({
        clusterName: String(c?.cluster_name ?? '').slice(0, 150),
        categoryFocus: String(c?.category_focus ?? '').slice(0, 150),
        memberCount: Math.max(0, Number(c?.member_count ?? 0)),
        totalSpentEur: Math.round(Number(c?.total_spent_eur ?? 0)),
        avgSpentPerMemberEur: Math.round(Number(c?.avg_spent_per_member_eur ?? 0)),
        keyMembers: (c?.key_members || []).slice(0, 5).map((m: any) => String(m).slice(0, 100)),
        clusterStrength: Math.max(0, Math.min(100, Number(c?.cluster_strength ?? 50))),
        growthPotential: ['high', 'medium', 'low'].includes(String(c?.growth_potential)) ? String(c.growth_potential) : 'medium',
      })),
      referralOpportunities: (parsed?.referral_opportunities || [])
        .filter((r: any) => validNames.has(String(r?.referrer ?? '')))
        .slice(0, 10)
        .map((r: any) => ({
          referrer: String(r?.referrer ?? '').slice(0, 100),
          potentialReferrals: (r?.potential_referrals || []).filter((m: any) => validNames.has(String(m))).slice(0, 5).map((m: any) => String(m).slice(0, 100)),
          sharedCategory: String(r?.shared_category ?? '').slice(0, 100),
          referralIncentiveEur: Math.max(0, Math.round(Number(r?.referral_incentive_eur ?? 0))),
          expectedConversionRatePct: Math.max(0, Math.min(100, Number(r?.expected_conversion_rate_pct ?? 20))),
          potentialRevenueEur: Math.round(Number(r?.potential_revenue_eur ?? 0)),
          bestChannel: ['email', 'sms', 'in_person', 'social'].includes(String(r?.best_channel)) ? String(r.best_channel) : 'email',
        })),
      networkEffects: (parsed?.network_effects || []).slice(0, 5).map((e: any) => ({
        effectType: ['direct', 'indirect', 'two_sided', 'data', 'platform'].includes(String(e?.effect_type)) ? String(e.effect_type) : 'direct',
        description: String(e?.description ?? '').slice(0, 250),
        currentStrength: Math.max(0, Math.min(100, Number(e?.current_strength ?? 30))),
        potentialStrength: Math.max(0, Math.min(100, Number(e?.potential_strength ?? 60))),
        improvementAction: String(e?.improvement_action ?? '').slice(0, 300),
        expectedRevenueImpactEur: Math.round(Number(e?.expected_revenue_impact_eur ?? 0)),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        networkType: String(r?.network_type ?? 'all').slice(0, 80),
        expectedRevenueImpactEur: Math.round(Number(r?.expected_revenue_impact_eur ?? 0)),
        implementationTimelineDays: Math.max(1, Number(r?.implementation_timeline_days ?? 7)),
      })),
      summary: {
        totalBuyersAnalyzed: targetBuyers.length,
        totalConnectionsFound: Math.max(0, Number(parsed?.summary?.total_connections_found ?? connections.length)),
        avgNetworkScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_network_score ?? Math.round(targetBuyers.reduce((s, b) => s + b.networkScore, 0) / Math.max(1, targetBuyers.length))))),
        strongestNetwork: String(parsed?.summary?.strongest_network ?? '').slice(0, 200),
        biggestNetworkOpportunity: String(parsed?.summary?.biggest_network_opportunity ?? '').slice(0, 200),
        potentialNetworkRevenueEur: Math.round(Number(parsed?.summary?.potential_network_revenue_eur ?? 0)),
        referralConversionRatePct: Math.max(0, Math.min(100, Number(parsed?.summary?.referral_conversion_rate_pct ?? 20))),
        networkingEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.networking_efficiency_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, strategist });
  } catch (e: any) { logger.error("/api/ai/buyer-networking-strategist", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
