// v6.52: AI Buyer Behavior Predictor — napove naslednji nakup kupca in behavioral pattern
// POST /api/ai/buyer-behavior-predictor
// Body: { customerName?: string, daysAhead?: number }
// Returns: { ok, predictor: { buyers, patterns, predictions, triggers, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

interface BuyerBehavior {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrderValue: number;
  firstPurchase: Date | null;
  lastPurchase: Date | null;
  daysAsCustomer: number;
  daysSinceLastPurchase: number;
  categories: Set<string>;
  items: string[];
  purchaseDates: Date[];
  purchasePattern: 'regular' | 'irregular' | 'seasonal' | 'burst' | 'one_time';
  avgDaysBetweenPurchases: number;
  preferredDayOfWeek: number; // 0-6
  preferredHour: number; // 0-23
  categoryAffinity: Map<string, number>; // category -> score 0-100
  priceRangePreference: { min: number; max: number };
  nextPurchaseProbability: number; // 0-100 within daysAhead
  predictedNextPurchaseDays: number;
  predictedNextCategory: string;
  predictedNextPriceRange: { min: number; max: number };
  lifetimeValueEur: number;
  behaviorScore: number; // 0-100
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;
    const daysAhead = Math.max(7, Math.min(365, Number(body?.daysAhead ?? 90)));

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return NextResponse.json({ ok: true, predictor: null, message: 'Ni prodaj za behavior analizo.' });
    }

    const buyerMap = new Map<string, BuyerBehavior>();
    const now = Date.now();

    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2 || !t.sellDate) continue;
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);

      if (!buyerMap.has(name)) {
        buyerMap.set(name, {
          name, purchases: 0, totalSpent: 0, avgOrderValue: 0,
          firstPurchase: t.sellDate, lastPurchase: t.sellDate,
          daysAsCustomer: 0, daysSinceLastPurchase: 0,
          categories: new Set<string>(), items: [], purchaseDates: [],
          purchasePattern: 'one_time', avgDaysBetweenPurchases: 0,
          preferredDayOfWeek: -1, preferredHour: -1,
          categoryAffinity: new Map<string, number>(),
          priceRangePreference: { min: revenue, max: revenue },
          nextPurchaseProbability: 0, predictedNextPurchaseDays: 0,
          predictedNextCategory: '', predictedNextPriceRange: { min: 0, max: 0 },
          lifetimeValueEur: 0, behaviorScore: 0,
        });
      }
      const b = buyerMap.get(name)!;
      b.purchases += 1;
      b.totalSpent += revenue;
      if (t.sellDate < (b.firstPurchase as Date)) b.firstPurchase = t.sellDate;
      if (t.sellDate > (b.lastPurchase!)) b.lastPurchase = t.sellDate;
      if (t.category) {
        b.categories.add(t.category);
        b.categoryAffinity.set(t.category, (b.categoryAffinity.get(t.category) ?? 0) + 1);
      }
      b.items.push(t.title);
      b.purchaseDates.push(t.sellDate);
      if (revenue < b.priceRangePreference.min) b.priceRangePreference.min = revenue;
      if (revenue > b.priceRangePreference.max) b.priceRangePreference.max = revenue;
    }

    // Compute behavioral metrics
    const buyers = Array.from(buyerMap.values()).map(b => {
      if (b.firstPurchase && b.lastPurchase) {
        b.daysAsCustomer = Math.max(1, Math.round((now - b.firstPurchase.getTime()) / (24*60*60*1000)));
        b.daysSinceLastPurchase = Math.round((now - b.lastPurchase.getTime()) / (24*60*60*1000));
      }
      b.avgOrderValue = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0;

      // Purchase pattern detection
      if (b.purchases === 1) b.purchasePattern = 'one_time';
      else if (b.purchaseDates.length >= 3) {
        const intervals: number[] = [];
        for (let i = 1; i < b.purchaseDates.length; i++) {
          intervals.push(Math.round((b.purchaseDates[i].getTime() - b.purchaseDates[i-1].getTime()) / (24*60*60*1000)));
        }
        const avg = intervals.reduce((a, x) => a + x, 0) / intervals.length;
        b.avgDaysBetweenPurchases = Math.round(avg);
        const variance = intervals.reduce((s, x) => s + Math.pow(x - avg, 2), 0) / intervals.length;
        const stdDev = Math.sqrt(variance);
        const cv = avg > 0 ? stdDev / avg : 1; // coefficient of variation
        if (cv < 0.3) b.purchasePattern = 'regular';
        else if (cv > 1.0) b.purchasePattern = 'burst';
        else b.purchasePattern = 'irregular';

        // Check seasonality (purchase dates cluster in same months)
        const months = new Set(b.purchaseDates.map(d => d.getMonth()));
        if (b.purchaseDates.length >= 4 && months.size <= 2) b.purchasePattern = 'seasonal';
      }

      // Preferred day of week and hour
      if (b.purchaseDates.length > 0) {
        const dayCounts = new Array(7).fill(0);
        b.purchaseDates.forEach(d => dayCounts[d.getDay()]++);
        b.preferredDayOfWeek = dayCounts.indexOf(Math.max(...dayCounts));
      }

      // Category affinity (normalize to 0-100)
      const maxCount = Math.max(...Array.from(b.categoryAffinity.values()), 1);
      b.categoryAffinity.forEach((v, k) => b.categoryAffinity.set(k, Math.round((v / maxCount) * 100)));

      // Next purchase probability (hevristika)
      const recencyFactor = Math.max(0, 1 - b.daysSinceLastPurchase / 365);
      const frequencyFactor = Math.min(1, b.purchases / 10);
      const patternFactor = b.purchasePattern === 'regular' ? 0.9 : b.purchasePattern === 'seasonal' ? 0.7 : b.purchasePattern === 'burst' ? 0.5 : 0.3;
      b.nextPurchaseProbability = Math.round(recencyFactor * frequencyFactor * patternFactor * 100);

      // Predicted next purchase days
      if (b.avgDaysBetweenPurchases > 0 && b.purchasePattern !== 'one_time') {
        b.predictedNextPurchaseDays = Math.max(1, b.avgDaysBetweenPurchases - b.daysSinceLastPurchase);
      } else if (b.purchases === 1) {
        b.predictedNextPurchaseDays = 60; // hevristika za novi kupci
      } else {
        b.predictedNextPurchaseDays = 90;
      }

      // Predicted next category (highest affinity)
      const sortedCats = Array.from(b.categoryAffinity.entries()).sort((a, b) => b[1] - a[1]);
      b.predictedNextCategory = sortedCats.length > 0 ? sortedCats[0][0] : 'drugo';

      // Predicted next price range (based on history ± 20%)
      b.predictedNextPriceRange = {
        min: Math.round(b.priceRangePreference.min * 0.8),
        max: Math.round(b.priceRangePreference.max * 1.2),
      };

      // LTV projection
      const recencyScore = Math.max(0.1, 1 - b.daysSinceLastPurchase / 365);
      b.lifetimeValueEur = Math.round(b.totalSpent * recencyScore * (b.purchases >= 3 ? 2.5 : 1.5));

      // Behavior score (overall engagement)
      b.behaviorScore = Math.min(100, Math.round(
        (b.nextPurchaseProbability * 0.4) +
        (Math.min(100, b.purchases * 10) * 0.3) +
        (Math.min(100, b.totalSpent / 50) * 0.2) +
        (b.purchasePattern !== 'one_time' ? 10 : 0)
      ));

      return b;
    });

    if (customerName) {
      const filtered = buyers.filter(b => b.name === customerName);
      if (filtered.length === 0) {
        return NextResponse.json({ ok: true, predictor: null, message: `Kupec "${customerName}" ni najden.` });
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
      `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.daysAsCustomer}d | ${b.daysSinceLastPurchase}d zadnji | pattern: ${b.purchasePattern} | povp ${b.avgDaysBetweenPurchases}d med nakupi | dan: ${b.preferredDayOfWeek} | naslednja verjetnost ${b.nextPurchaseProbability}% | predicted ${b.predictedNextPurchaseDays}d | next cat: ${b.predictedNextCategory}`
    ).join('\n');

    const prompt = `Si AI buyer behavior predictor za slovenske oglasne platforme.
Napove naslednji nakup kupca, behavioral pattern in najboljše outreach strategije.

KUPCI ZA ANALIZO (${targetBuyers.length}):
${buyersStr}

Behavioral patterns:
1. REGULAR: kupuje enakomerno (cv < 0.3) — predvidljiv, vreden ohranjanja
2. IRREGULAR: nakupi z neko varianco (0.3-1.0) — nekaj predvidljivosti
3. SEASONAL: kupuje v specifičnih mesecih — seasonal triggers
4. BURST: kupi več v kratkem času, potem dolgo nič — impulziven
5. ONE_TIME: samo 1 nakup, verjetno neha

Behavior triggerji (kaj sproži naslednji nakup):
- SEASONAL_TRIGGER: letni čas, prazniki (božič, velika noč)
- LIFE_EVENT: selitev, rojstvo, novo službo
- REPLACEMENT: nadomestitev prejšnjega nakupa (telefon pade, avto se pokvari)
- UPGRADE: nadgradnja (novi iPhone, večje kolo)
- COMPLEMENTARY: dopolnitev (kolo + čelada, telefon + etui)
- IMPULSE: spontani nakup ob dobri ceni
- NEED_BASED: praktična potreba (študentu laptop za šolo)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    {
      "name": "<ime>",
      "behavior_pattern": "<regular|irregular|seasonal|burst|one_time>",
      "next_purchase_probability_pct": <number 0-100>,
      "predicted_next_purchase_days": <number>,
      "predicted_next_category": "<max 50 znakov>",
      "predicted_next_price_range_eur": {"min": <number>, "max": <number>},
      "primary_trigger": "<seasonal_trigger|life_event|replacement|upgrade|complementary|impulse|need_based>",
      "trigger_reasoning": "<max 120 znakov>",
      "preferred_contact_day": "<pon|tor|sre|cet|pet|sob|ned>",
      "preferred_contact_hour": <number 0-23>,
      "best_outreach_window": "<max 80 znakov>",
      "predicted_annual_spend_eur": <number>,
      "behavior_segment": "<high_value_loyal|medium_value_regular|low_value_occasional|at_risk|new_potential>"
    }
  ],
  "patterns": [
    { "pattern": "<regular|irregular|seasonal|burst|one_time>", "buyer_count": <number>, "avg_spend_eur": <number>, "avg_frequency_days": <number>, "retention_rate_pct": <number>, "best_strategy": "<max 120 znakov>" }
  ],
  "predictions": [
    { "buyer_name": "<ime>", "predicted_purchase_date": "<YYYY-MM-DD>", "predicted_category": "<kategorija>", "predicted_price_eur": <number>, "confidence_pct": <number 0-100>, "trigger": "<max 80 znakov>" }
  ],
  "triggers": [
    { "trigger": "<seasonal_trigger|life_event|replacement|upgrade|complementary|impulse|need_based>", "description": "<max 100 znakov>", "buyer_count": <number>, "best_outreach_time": "<max 80 znakov>", "expected_conversion_pct": <number> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "target_segment": "<max 50 znakov>", "expected_revenue_eur": <number>, "buyers_affected": <number> }
  ],
  "summary": {
    "total_buyers_analyzed": <number>,
    "regular_count": <number>,
    "irregular_count": <number>,
    "seasonal_count": <number>,
    "burst_count": <number>,
    "one_time_count": <number>,
    "avg_next_purchase_probability_pct": <number>,
    "total_predicted_annual_spend_eur": <number>,
    "most_common_trigger": "<max 80 znakov>",
    "best_outreach_segment": "<max 80 znakov>",
    "behavior_prediction_score": <number 0-100>
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

    const predictor = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      buyers: (parsed?.buyers || [])
        .filter((b: any) => validNames.has(String(b?.name ?? '')))
        .slice(0, 25)
        .map((b: any) => {
          const orig = targetBuyers.find(x => x.name === String(b?.name));
          return {
            name: String(b?.name ?? '').slice(0, 100),
            behaviorPattern: ['regular', 'irregular', 'seasonal', 'burst', 'one_time'].includes(String(b?.behavior_pattern)) ? String(b.behavior_pattern) : (orig?.purchasePattern ?? 'one_time'),
            nextPurchaseProbabilityPct: Math.max(0, Math.min(100, Number(b?.next_purchase_probability_pct ?? orig?.nextPurchaseProbability ?? 0))),
            predictedNextPurchaseDays: Math.max(0, Number(b?.predicted_next_purchase_days ?? orig?.predictedNextPurchaseDays ?? 0)),
            predictedNextCategory: String(b?.predicted_next_category ?? orig?.predictedNextCategory ?? '').slice(0, 80),
            predictedNextPriceRangeEur: {
              min: Math.max(0, Math.round(Number(b?.predicted_next_price_range_eur?.min ?? orig?.predictedNextPriceRange.min ?? 0))),
              max: Math.max(0, Math.round(Number(b?.predicted_next_price_range_eur?.max ?? orig?.predictedNextPriceRange.max ?? 0))),
            },
            primaryTrigger: ['seasonal_trigger', 'life_event', 'replacement', 'upgrade', 'complementary', 'impulse', 'need_based'].includes(String(b?.primary_trigger)) ? String(b.primary_trigger) : 'need_based',
            triggerReasoning: String(b?.trigger_reasoning ?? '').slice(0, 250),
            preferredContactDay: ['pon', 'tor', 'sre', 'cet', 'pet', 'sob', 'ned'].includes(String(b?.preferred_contact_day)) ? String(b.preferred_contact_day) : 'pet',
            preferredContactHour: Math.max(0, Math.min(23, Number(b?.preferred_contact_hour ?? 18))),
            bestOutreachWindow: String(b?.best_outreach_window ?? '').slice(0, 150),
            predictedAnnualSpendEur: Math.round(Number(b?.predicted_annual_spend_eur ?? orig?.lifetimeValueEur ?? 0)),
            behaviorSegment: ['high_value_loyal', 'medium_value_regular', 'low_value_occasional', 'at_risk', 'new_potential'].includes(String(b?.behavior_segment)) ? String(b.behavior_segment) : 'medium_value_regular',
          };
        }),
      patterns: (parsed?.patterns || []).slice(0, 5).map((p: any) => ({
        pattern: ['regular', 'irregular', 'seasonal', 'burst', 'one_time'].includes(String(p?.pattern)) ? String(p.pattern) : 'one_time',
        buyerCount: Math.max(0, Number(p?.buyer_count ?? 0)),
        avgSpendEur: Math.round(Number(p?.avg_spend_eur ?? 0)),
        avgFrequencyDays: Math.round(Number(p?.avg_frequency_days ?? 0)),
        retentionRatePct: Math.max(0, Math.min(100, Number(p?.retention_rate_pct ?? 50))),
        bestStrategy: String(p?.best_strategy ?? '').slice(0, 250),
      })),
      predictions: (parsed?.predictions || [])
        .filter((p: any) => validNames.has(String(p?.buyer_name ?? '')))
        .slice(0, 15)
        .map((p: any) => ({
          buyerName: String(p?.buyer_name ?? '').slice(0, 100),
          predictedPurchaseDate: String(p?.predicted_purchase_date ?? '').slice(0, 20),
          predictedCategory: String(p?.predicted_category ?? '').slice(0, 80),
          predictedPriceEur: Math.max(0, Math.round(Number(p?.predicted_price_eur ?? 0))),
          confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 50))),
          trigger: String(p?.trigger ?? '').slice(0, 150),
        })),
      triggers: (parsed?.triggers || []).slice(0, 7).map((t: any) => ({
        trigger: ['seasonal_trigger', 'life_event', 'replacement', 'upgrade', 'complementary', 'impulse', 'need_based'].includes(String(t?.trigger)) ? String(t.trigger) : 'need_based',
        description: String(t?.description ?? '').slice(0, 200),
        buyerCount: Math.max(0, Number(t?.buyer_count ?? 0)),
        bestOutreachTime: String(t?.best_outreach_time ?? '').slice(0, 150),
        expectedConversionPct: Math.max(0, Math.min(100, Number(t?.expected_conversion_pct ?? 30))),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        targetSegment: String(r?.target_segment ?? 'all').slice(0, 80),
        expectedRevenueEur: Math.round(Number(r?.expected_revenue_eur ?? 0)),
        buyersAffected: Math.max(0, Number(r?.buyers_affected ?? 0)),
      })),
      summary: {
        totalBuyersAnalyzed: targetBuyers.length,
        regularCount: Math.max(0, Number(parsed?.summary?.regular_count ?? targetBuyers.filter(b => b.purchasePattern === 'regular').length)),
        irregularCount: Math.max(0, Number(parsed?.summary?.irregular_count ?? targetBuyers.filter(b => b.purchasePattern === 'irregular').length)),
        seasonalCount: Math.max(0, Number(parsed?.summary?.seasonal_count ?? targetBuyers.filter(b => b.purchasePattern === 'seasonal').length)),
        burstCount: Math.max(0, Number(parsed?.summary?.burst_count ?? targetBuyers.filter(b => b.purchasePattern === 'burst').length)),
        oneTimeCount: Math.max(0, Number(parsed?.summary?.one_time_count ?? targetBuyers.filter(b => b.purchasePattern === 'one_time').length)),
        avgNextPurchaseProbabilityPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_next_purchase_probability_pct ?? Math.round(targetBuyers.reduce((s, b) => s + b.nextPurchaseProbability, 0) / Math.max(1, targetBuyers.length))))),
        totalPredictedAnnualSpendEur: Math.round(Number(parsed?.summary?.total_predicted_annual_spend_eur ?? targetBuyers.reduce((s, b) => s + b.lifetimeValueEur, 0))),
        mostCommonTrigger: String(parsed?.summary?.most_common_trigger ?? '').slice(0, 150),
        bestOutreachSegment: String(parsed?.summary?.best_outreach_segment ?? '').slice(0, 150),
        behaviorPredictionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.behavior_prediction_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, predictor });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
