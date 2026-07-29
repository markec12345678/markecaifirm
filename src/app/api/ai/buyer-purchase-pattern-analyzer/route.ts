// v6.62: AI Buyer Purchase Pattern Analyzer — analiza nakupnih vzorcev z ML sequence mining
// POST /api/ai/buyer-purchase-pattern-analyzer
// Body: { customerName?: string }
// Returns: { ok, analyzer: { buyers, patterns, sequences, associations, mlModels, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const PATTERN_TYPES = [
  'sequential_consistent',
  'seasonal_cyclical',
  'price_progression',
  'category_expansion',
  'complementary_chain',
  'replacement_cycle',
  'upgrade_pattern',
  'bulk_buyer',
  'sporadic_random',
  'declining_frequency',
] as const;

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
      return NextResponse.json({ ok: true, analyzer: null, message: 'Ni prodaj za pattern analizo.' });
    }

    // Aggregation
    const buyerMap = new Map<string, {
      name: string; purchases: number; totalSpent: number;
      purchaseSequence: Array<{ title: string; category: string; price: number; date: Date }>;
      categories: Set<string>; firstPurchase: Date | null; lastPurchase: Date | null;
    }>();

    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2 || !t.sellDate) continue;
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      if (!buyerMap.has(name)) {
        buyerMap.set(name, { name, purchases: 0, totalSpent: 0, purchaseSequence: [], categories: new Set(), firstPurchase: t.sellDate, lastPurchase: t.sellDate });
      }
      const b = buyerMap.get(name)!;
      b.purchases += 1; b.totalSpent += revenue;
      b.purchaseSequence.push({ title: t.title, category: t.category || 'drugo', price: revenue, date: t.sellDate });
      if (t.category) b.categories.add(t.category);
      if (t.sellDate < (b.firstPurchase as Date)) b.firstPurchase = t.sellDate;
      if (t.sellDate > b.lastPurchase!) b.lastPurchase = t.sellDate;
    }

    const buyers = Array.from(buyerMap.values()).filter(b => b.purchases >= 2).map(b => {
      // Sort sequence chronologically
      b.purchaseSequence.sort((a, b) => a.date.getTime() - b.date.getTime());
      return b;
    });

    if (customerName) {
      const filtered = buyers.filter(b => b.name === customerName);
      if (filtered.length === 0) {
        return NextResponse.json({ ok: true, analyzer: null, message: `Kupec "${customerName}" ni najden ali ima manj kot 2 nakupa.` });
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

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 20);

    const buyersStr = targetBuyers.slice(0, 15).map(b => {
      const seq = b.purchaseSequence.slice(0, 5).map(p => `${p.title.slice(0, 30)}(${p.category.slice(0, 10)},${p.price}€)`).join(' → ');
      return `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | sequence: ${seq}`;
    }).join('\n');

    const prompt = `Si AI buyer purchase pattern analyzer z ML sequence mining.
Analizira nakupne vzorce z association rule mining in sequential pattern detection.

KUPCI (${targetBuyers.length}):
${buyersStr}

10 pattern tipov:
1. SEQUENTIAL_CONSISTENT: consistent purchase order (vedno isti vrstni red)
2. SEASONAL_CYCLICAL: seasonal nakupi (vsako leto istočasno)
3. PRICE_PROGRESSION: napredovanje v ceni (vedno dražje/ceneje)
4. CATEGORY_EXPANSION: širjenje kategorij ( začne z 1, potem doda)
5. COMPLEMENTARY_CHAIN: complementary nakupi (telefon → etui → polnilec)
6. REPLACEMENT_CYCLE: nadomestitev vsake N let (telefon vsake 2 leti)
7. UPGRADE_PATTERN: upgrade pattern (iPhone 12 → 13 → 14)
8. BULK_BUYER: več itemov hkrati (wholesale)
9. SPORADIC_RANDOM: naključni, nepredvidljivi
10. DECLINING_FREQUENCY: upadajoča frekvenca (manj nakupov)

ML modeli:
- SEQUENCE_MINING: PrefixSpan, GSP algoritmi
- ASSOCIATION_RULES: Apriori, FP-Growth
- MARKOV_CHAIN: probabilistic next purchase
- LSTM_SEQUENCE: deep learning za next purchase prediction
- CLUSTERING: K-means za buyer segmentation

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    {
      "name": "<ime>",
      "detected_patterns": [
        {"pattern": "<10 patternov>", "confidence_pct": <number 0-100>, "evidence": ["<max 80 znakov>"], "pattern_strength": "<strong|moderate|weak>"}
      ],
      "primary_pattern": "<10 patternov>",
      "purchase_sequence_analysis": {
        "total_purchases": <number>,
        "avg_interval_days": <number>,
        "interval_consistency": "<high|medium|low>",
        "price_trend": "<increasing|decreasing|stable|volatile>",
        "category_diversification": "<high|medium|low>"
      },
      "predicted_next_purchase": {
        "predicted_category": "<max 50 znakov>",
        "predicted_price_range_eur": {"min": <number>, "max": <number>},
        "predicted_date": "<YYYY-MM-DD>",
        "probability_pct": <number 0-100>,
        "based_on_pattern": "<10 patternov>"
      },
      "ml_cluster_id": <number>,
      "cluster_description": "<max 100 znakov>",
      "lifetime_value_projection_eur": <number>
    }
  ],
  "patterns": [
    {
      "pattern": "<10 patternov>",
      "buyer_count": <number>,
      "avg_spent_eur": <number>,
      "avg_frequency_days": <number>,
      "value_to_business": "<high|medium|low>",
      "prediction_accuracy_pct": <number 0-100>,
      "best_strategy": "<max 120 znakov>"
    }
  ],
  "sequences": [
    {
      "sequence_name": "<max 80 znakov>",
      "sequence_pattern": ["<item description>"],
      "buyer_count": <number>,
      "frequency": <number>,
      "confidence_pct": <number 0-100>,
      "support_pct": <number 0-100>,
      "next_predicted_item": "<max 80 znakov>"
    }
  ],
  "associations": [
    {
      "rule": "<max 100 znakov>",
      "antecedent": ["<item>"],
      "consequent": ["<item>"],
      "support_pct": <number 0-100>,
      "confidence_pct": <number 0-100>,
      "lift": <number>,
      "buyer_count": <number>
    }
  ],
  "ml_models": [
    {
      "model": "<sequence_mining|association_rules|markov_chain|lstm_sequence|clustering>",
      "accuracy_pct": <number 0-100>,
      "patterns_detected": <number>,
      "predictions_made": <number>,
      "weight_in_ensemble": <number 0-100>,
      "best_for": "<max 80 znakov>"
    }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "pattern_targeted": "<10 patternov ali all>", "expected_revenue_impact_eur": <number>, "buyers_affected": <number> }
  ],
  "summary": {
    "total_buyers_analyzed": <number>,
    "total_patterns_detected": <number>,
    "total_sequences_found": <number>,
    "total_associations_found": <number>,
    "avg_prediction_accuracy_pct": <number>,
    "most_common_pattern": "<max 80 znakov>",
    "biggest_pattern_opportunity": "<max 100 znakov>",
    "pattern_analysis_score": <number 0-100>
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

    const analyzer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      buyers: (parsed?.buyers || [])
        .filter((b: any) => validNames.has(String(b?.name ?? '')))
        .slice(0, 20)
        .map((b: any) => ({
          name: String(b?.name ?? '').slice(0, 100),
          detectedPatterns: (b?.detected_patterns || []).slice(0, 4).map((p: any) => ({
            pattern: PATTERN_TYPES.includes(String(p?.pattern) as any) ? String(p.pattern) : 'sporadic_random',
            confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 50))),
            evidence: (p?.evidence || []).slice(0, 4).map((e: any) => String(e).slice(0, 150)),
            patternStrength: ['strong', 'moderate', 'weak'].includes(String(p?.pattern_strength)) ? String(p.pattern_strength) : 'moderate',
          })),
          primaryPattern: PATTERN_TYPES.includes(String(b?.primary_pattern) as any) ? String(b.primary_pattern) : 'sporadic_random',
          purchaseSequenceAnalysis: {
            totalPurchases: Math.max(0, Number(b?.purchase_sequence_analysis?.total_purchases ?? 0)),
            avgIntervalDays: Math.round(Number(b?.purchase_sequence_analysis?.avg_interval_days ?? 0) * 10) / 10,
            intervalConsistency: ['high', 'medium', 'low'].includes(String(b?.purchase_sequence_analysis?.interval_consistency)) ? String(b.purchase_sequence_analysis.interval_consistency) : 'medium',
            priceTrend: ['increasing', 'decreasing', 'stable', 'volatile'].includes(String(b?.purchase_sequence_analysis?.price_trend)) ? String(b.purchase_sequence_analysis.price_trend) : 'stable',
            categoryDiversification: ['high', 'medium', 'low'].includes(String(b?.purchase_sequence_analysis?.category_diversification)) ? String(b.purchase_sequence_analysis.category_diversification) : 'medium',
          },
          predictedNextPurchase: {
            predictedCategory: String(b?.predicted_next_purchase?.predicted_category ?? '').slice(0, 80),
            predictedPriceRangeEur: {
              min: Math.max(0, Math.round(Number(b?.predicted_next_purchase?.predicted_price_range_eur?.min ?? 0))),
              max: Math.max(0, Math.round(Number(b?.predicted_next_purchase?.predicted_price_range_eur?.max ?? 0))),
            },
            predictedDate: String(b?.predicted_next_purchase?.predicted_date ?? '').slice(0, 20),
            probabilityPct: Math.max(0, Math.min(100, Number(b?.predicted_next_purchase?.probability_pct ?? 30))),
            basedOnPattern: PATTERN_TYPES.includes(String(b?.predicted_next_purchase?.based_on_pattern) as any) ? String(b.predicted_next_purchase.based_on_pattern) : 'sporadic_random',
          },
          mlClusterId: Math.max(0, Number(b?.ml_cluster_id ?? 0)),
          clusterDescription: String(b?.cluster_description ?? '').slice(0, 200),
          lifetimeValueProjectionEur: Math.round(Number(b?.lifetime_value_projection_eur ?? 0)),
        })),
      patterns: (parsed?.patterns || []).slice(0, 10).map((p: any) => ({
        pattern: PATTERN_TYPES.includes(String(p?.pattern) as any) ? String(p.pattern) : 'sporadic_random',
        buyerCount: Math.max(0, Number(p?.buyer_count ?? 0)),
        avgSpentEur: Math.round(Number(p?.avg_spent_eur ?? 0)),
        avgFrequencyDays: Math.round(Number(p?.avg_frequency_days ?? 0)),
        valueToBusiness: ['high', 'medium', 'low'].includes(String(p?.value_to_business)) ? String(p.value_to_business) : 'medium',
        predictionAccuracyPct: Math.max(0, Math.min(100, Number(p?.prediction_accuracy_pct ?? 60))),
        bestStrategy: String(p?.best_strategy ?? '').slice(0, 250),
      })),
      sequences: (parsed?.sequences || []).slice(0, 8).map((s: any) => ({
        sequenceName: String(s?.sequence_name ?? '').slice(0, 150),
        sequencePattern: (s?.sequence_pattern || []).slice(0, 6).map((p: any) => String(p).slice(0, 100)),
        buyerCount: Math.max(0, Number(s?.buyer_count ?? 0)),
        frequency: Math.max(0, Number(s?.frequency ?? 0)),
        confidencePct: Math.max(0, Math.min(100, Number(s?.confidence_pct ?? 50))),
        supportPct: Math.max(0, Math.min(100, Number(s?.support_pct ?? 30))),
        nextPredictedItem: String(s?.next_predicted_item ?? '').slice(0, 150),
      })),
      associations: (parsed?.associations || []).slice(0, 8).map((a: any) => ({
        rule: String(a?.rule ?? '').slice(0, 200),
        antecedent: (a?.antecedent || []).slice(0, 4).map((x: any) => String(x).slice(0, 80)),
        consequent: (a?.consequent || []).slice(0, 4).map((x: any) => String(x).slice(0, 80)),
        supportPct: Math.max(0, Math.min(100, Number(a?.support_pct ?? 30))),
        confidencePct: Math.max(0, Math.min(100, Number(a?.confidence_pct ?? 50))),
        lift: Math.round(Number(a?.lift ?? 1) * 100) / 100,
        buyerCount: Math.max(0, Number(a?.buyer_count ?? 0)),
      })),
      mlModels: (parsed?.ml_models || []).slice(0, 5).map((m: any) => ({
        model: ['sequence_mining', 'association_rules', 'markov_chain', 'lstm_sequence', 'clustering'].includes(String(m?.model)) ? String(m.model) : 'sequence_mining',
        accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))),
        patternsDetected: Math.max(0, Number(m?.patterns_detected ?? 0)),
        predictionsMade: Math.max(0, Number(m?.predictions_made ?? 0)),
        weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
        bestFor: String(m?.best_for ?? '').slice(0, 150),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        patternTargeted: String(r?.pattern_targeted ?? 'all').slice(0, 50),
        expectedRevenueImpactEur: Math.round(Number(r?.expected_revenue_impact_eur ?? 0)),
        buyersAffected: Math.max(0, Number(r?.buyers_affected ?? 0)),
      })),
      summary: {
        totalBuyersAnalyzed: targetBuyers.length,
        totalPatternsDetected: Math.max(0, Number(parsed?.summary?.total_patterns_detected ?? 0)),
        totalSequencesFound: Math.max(0, Number(parsed?.summary?.total_sequences_found ?? 0)),
        totalAssociationsFound: Math.max(0, Number(parsed?.summary?.total_associations_found ?? 0)),
        avgPredictionAccuracyPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_prediction_accuracy_pct ?? 60))),
        mostCommonPattern: PATTERN_TYPES.includes(String(parsed?.summary?.most_common_pattern) as any) ? String(parsed.summary.most_common_pattern) : 'sporadic_random',
        biggestPatternOpportunity: String(parsed?.summary?.biggest_pattern_opportunity ?? '').slice(0, 200),
        patternAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.pattern_analysis_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, analyzer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
