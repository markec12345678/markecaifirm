// v6.59 / v8.96.3-batch2: AI Buyer Behavior Pattern Detector — ML detection of behavioral patterns z anomaly detection
// Refaktoriran z withAiRoute helperjem (v8.96.3) + enforceBudget guard.
//
// POST /api/ai/buyer-behavior-pattern-detector
// Body: { customerName?: string, anomalyThreshold?: number }
// Returns: { ok, detector: { buyers, patterns, anomalies, mlModels, interventions, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const PATTERN_TYPES = [
  'loyal_repeat',        // redni povratnik z consistent purchasing
  'seasonal_buyer',      // kupuje v določenih mesecih
  'impulse_buyer',       // hitri odzivi, hitri nakupi
  'deliberate_researcher', // dolgo razmišlja, primerja
  'bargain_hunter',      // čaka na popuste, nizka cena
  'premium_seeker',      // visoka cena, premium items
  'collector_enthusiast',// redki items, vintage
  'reseller_flipper',    // visoka frekvenca, hitra prodaja
  'occasional_buyer',    // redki nakupi, casual
  'price_sensitive',     // občutljiv na ceno
  'brand_loyal',         // vedno isti brand
  'category_specialist', // specializiran za 1-2 kategoriji
] as const;

const ANOMALY_TYPES = [
  'sudden_high_value_purchase',  //nenadna visoka nakup
  'unusual_frequency_spike',     //nenadna visoka frekvenca
  'category_switch',             //nenadna sprememba kategorije
  'price_range_deviation',       //odstopanje od price range
  'location_change',             //sprememba lokacije
  'response_time_degradation',   //počasnejši odgovori
  'purchase_pattern_break',      //prekinitev patterna
  'volume_anomaly',              //nenavaden volumen
] as const;

interface BuyerBehaviorPatternDetectorInput {
  customerName: string | null;
  anomalyThreshold: number;
}

export const POST = withAiRoute<BuyerBehaviorPatternDetectorInput>({
  endpoint: '/api/ai/buyer-behavior-pattern-detector',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      customerName: body?.customerName ? String(body.customerName).trim() : null,
      anomalyThreshold: Math.max(50, Math.min(95, Number(body?.anomalyThreshold ?? 75))),
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { customerName, anomalyThreshold } = input;

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, detector: null, message: 'Ni prodaj za pattern detection.' });
    }

    // Aggregation
    const buyerMap = new Map<string, {
      name: string;
      purchases: number;
      totalSpent: number;
      avgOrderValue: number;
      purchaseDates: Date[];
      categories: Set<string>;
      items: string[];
      prices: number[];
      firstPurchase: Date | null;
      lastPurchase: Date | null;
      intervals: number[]; // days between purchases
    }>();

    const now = Date.now();
    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2 || !t.sellDate) continue;
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);

      if (!buyerMap.has(name)) {
        buyerMap.set(name, {
          name, purchases: 0, totalSpent: 0, avgOrderValue: 0,
          purchaseDates: [], categories: new Set(), items: [], prices: [],
          firstPurchase: t.sellDate, lastPurchase: t.sellDate, intervals: [],
        });
      }
      const b = buyerMap.get(name)!;
      b.purchases += 1;
      b.totalSpent += revenue;
      b.purchaseDates.push(t.sellDate);
      if (t.category) b.categories.add(t.category);
      b.items.push(t.title);
      b.prices.push(revenue);
      if (t.sellDate < (b.firstPurchase as Date)) b.firstPurchase = t.sellDate;
      if (t.sellDate > b.lastPurchase!) b.lastPurchase = t.sellDate;
    }

    // Compute behavioral metrics
    const buyers = Array.from(buyerMap.values()).map(b => {
      b.avgOrderValue = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0;
      // Sort dates and compute intervals
      const sortedDates = b.purchaseDates.sort((a, b) => a.getTime() - b.getTime());
      b.intervals = [];
      for (let i = 1; i < sortedDates.length; i++) {
        b.intervals.push(Math.round((sortedDates[i].getTime() - sortedDates[i-1].getTime()) / (24*60*60*1000)));
      }
      const avgInterval = b.intervals.length > 0 ? b.intervals.reduce((a, x) => a + x, 0) / b.intervals.length : 0;
      const variance = b.intervals.length > 1 ? b.intervals.reduce((s, x) => s + Math.pow(x - avgInterval, 2), 0) / b.intervals.length : 0;
      const cv = avgInterval > 0 ? Math.sqrt(variance) / avgInterval : 1;

      // Price stats
      const avgPrice = b.prices.reduce((a, x) => a + x, 0) / b.prices.length;
      const priceStd = b.prices.length > 1 ? Math.sqrt(b.prices.reduce((s, x) => s + Math.pow(x - avgPrice, 2), 0) / b.prices.length) : 0;
      const priceCv = avgPrice > 0 ? priceStd / avgPrice : 0;

      return {
        ...b,
        daysAsCustomer: b.firstPurchase ? Math.round((now - b.firstPurchase.getTime()) / (24*60*60*1000)) : 0,
        daysSinceLastPurchase: b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / (24*60*60*1000)) : 0,
        avgIntervalDays: Math.round(avgInterval),
        intervalCv: Math.round(cv * 100) / 100,
        avgPrice: Math.round(avgPrice),
        priceCv: Math.round(priceCv * 100) / 100,
        categoriesCount: b.categories.size,
      };
    });

    if (customerName) {
      const filtered = buyers.filter(b => b.name === customerName);
      if (filtered.length === 0) {
        return apiOk({ ok: true, detector: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);

    const buyersStr = targetBuyers.slice(0, 15).map(b =>
      `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrderValue}€ povp | ${b.daysAsCustomer}d | ${b.daysSinceLastPurchase}d zadnji | povp interval ${b.avgIntervalDays}d (cv ${b.intervalCv}) | ${b.categoriesCount} kat | price cv ${b.priceCv}`
    ).join('\n');

    const prompt = buildPrompt(targetBuyers, buyersStr, anomalyThreshold);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const detector = transformDetector(parsed, targetBuyers, anomalyThreshold);

    return apiOk({ ok: true, detector });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface BuyerInfo {
  name: string;
  purchases: number;
  totalSpent: number;
  daysAsCustomer: number;
  daysSinceLastPurchase: number;
  avgIntervalDays: number;
  intervalCv: number;
  avgPrice: number;
  priceCv: number;
  categoriesCount: number;
}

function buildPrompt(targetBuyers: BuyerInfo[], buyersStr: string, anomalyThreshold: number): string {
  return `Si AI buyer behavior pattern detector z ML anomaly detection.
Odkrij behavioral pattern in anomalije za vsakega kupca.

KUPCI (${targetBuyers.length}):
${buyersStr}

ANOMALY THRESHOLD: ${anomalyThreshold}% (samo anomalije nad to verjetnostjo)

12 pattern tipov:
1. LOYAL_REPEAT: redni povratnik z consistent purchasing (cv < 0.5, purchases >= 3)
2. SEASONAL_BUYER: kupuje v določenih mesecih (4+ v istih mesecih)
3. IMPULSE_BUYER: hitri odzivi, hitri nakupi (kratki intervali, visok volume)
4. DELIBERATE_RESEARCHER: dolgo razmišlja, primerja (dolgi intervali, 1-2 nakupa)
5. BARGAIN_HUNTER: čaka na popuste, nizka cena (low avg price)
6. PREMIUM_SEEKER: visoka cena, premium items (high avg price)
7. COLLECTOR_ENTHUSIAST: redki items, vintage (specialized categories)
8. RESELLER_FLIPPER: visoka frekvenca, hitra prodaja (3+ purchases/mesec)
9. OCCASIONAL_BUYER: redki nakupi, casual (1-2 purchases/year)
10. PRICE_SENSITIVE: občutljiv na ceno (high price cv)
11. BRAND_LOYAL: vedno isti brand (consistent items)
12. CATEGORY_SPECIALIST: specializiran za 1-2 kategoriji

8 anomaly tipov:
1. SUDDEN_HIGH_VALUE_PURCHASE: nenadna visoka nakup (deviation > 2σ od avg)
2. UNUSUAL_FREQUENCY_SPIKE: nenadna visoka frekvenca (3x normal)
3. CATEGORY_SWITCH: nenadna sprememba kategorije (nova kategorija po 5+ nakupih)
4. PRICE_RANGE_DEVIATION: odstopanje od price range (>50% deviation)
5. LOCATION_CHANGE: sprememba lokacije
6. RESPONSE_TIME_DEGRADATION: počasnejši odgovori
7. PURCHASE_PATTERN_BREAK: prekinitev patterna (long gap after regular)
8. VOLUME_ANOMALY: nenavaden volumen (massive spike)

ML modeli:
- ISOLATION_FOREST: anomaly detection
- K-MEANS: pattern clustering
- DBSCAN: density-based clustering
- AUTOENCODER: neural anomaly detection
- STATISTICAL: z-score, IQR based detection

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    {
      "name": "<ime>",
      "detected_patterns": [
        {
          "pattern": "<12 pattern tipov>",
          "confidence_pct": <number 0-100>,
          "evidence": ["<max 80 znakov>"],
          "pattern_strength": "<strong|moderate|weak>"
        }
      ],
      "primary_pattern": "<12 pattern tipov>",
      "anomalies": [
        {
          "type": "<8 anomaly tipov>",
          "severity": "<low|medium|high|critical>",
          "probability_pct": <number 0-100>,
          "description": "<max 120 znakov>",
          "detected_by": "<isolation_forest|k-means|dbscan|autoencoder|statistical>",
          "recommended_action": "<monitor|investigate|contact|block>"
        }
      ],
      "behavioral_consistency_score": <number 0-100>,
      "anomaly_risk_score": <number 0-100>,
      "predicted_next_action": "<max 100 znakov>",
      "ml_cluster_id": <number>,
      "cluster_description": "<max 100 znakov>"
    }
  ],
  "patterns": [
    {
      "pattern": "<12 pattern tipov>",
      "buyer_count": <number>,
      "avg_spent_eur": <number>,
      "avg_frequency_days": <number>,
      "retention_rate_pct": <number>,
      "value_to_business": "<high|medium|low>",
      "best_strategy": "<max 120 znakov>"
    }
  ],
  "anomalies": [
    {
      "anomaly_type": "<8 anomaly tipov>",
      "buyer_count": <number>,
      "avg_severity": "<low|medium|high|critical>",
      "total_anomaly_value_eur": <number>,
      "investigation_priority": "<high|medium|low>",
      "recommended_investigation": "<max 150 znakov>"
    }
  ],
  "ml_models": [
    {
      "model": "<isolation_forest|k-means|dbscan|autoencoder|statistical>",
      "purpose": "<pattern_detection|anomaly_detection|clustering>",
      "accuracy_pct": <number 0-100>,
      "patterns_detected": <number>,
      "anomalies_detected": <number>,
      "false_positive_rate_pct": <number 0-100>,
      "best_for": "<max 80 znakov>"
    }
  ],
  "interventions": [
    {
      "intervention_type": "<personalized_outreach|loyalty_reward|anomaly_investigation|win_back|prevention>",
      "target_buyers": ["<ime>"],
      "description": "<max 120 znakov>",
      "expected_impact_eur": <number>,
      "priority": "<high|medium|low>",
      "timeframe_days": <number>
    }
  ],
  "summary": {
    "total_buyers_analyzed": <number>,
    "total_patterns_detected": <number>,
    "total_anomalies_detected": <number>,
    "avg_behavioral_consistency_score": <number>,
    "avg_anomaly_risk_score": <number>,
    "most_common_pattern": "<max 80 znakov>",
    "biggest_anomaly_threat": "<max 100 znakov>",
    "biggest_pattern_opportunity": "<max 100 znakov>",
    "pattern_detection_score": <number 0-100>
  }
}`;
}

function transformDetector(parsed: any, targetBuyers: BuyerInfo[], anomalyThreshold: number): any {
  const validNames = new Set(targetBuyers.map(b => b.name));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    buyers: (parsed?.buyers || [])
      .filter((b: any) => validNames.has(String(b?.name ?? '')))
      .slice(0, 25)
      .map((b: any) => ({
        name: String(b?.name ?? '').slice(0, 100),
        detectedPatterns: (b?.detected_patterns || []).slice(0, 4).map((p: any) => ({
          pattern: PATTERN_TYPES.includes(String(p?.pattern) as any) ? String(p.pattern) : 'occasional_buyer',
          confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 50))),
          evidence: (p?.evidence || []).slice(0, 4).map((e: any) => String(e).slice(0, 150)),
          patternStrength: ['strong', 'moderate', 'weak'].includes(String(p?.pattern_strength)) ? String(p.pattern_strength) : 'moderate',
        })),
        primaryPattern: PATTERN_TYPES.includes(String(b?.primary_pattern) as any) ? String(b.primary_pattern) : 'occasional_buyer',
        anomalies: (b?.anomalies || []).filter((a: any) => Number(a?.probability_pct ?? 0) >= anomalyThreshold).slice(0, 4).map((a: any) => ({
          type: ANOMALY_TYPES.includes(String(a?.type) as any) ? String(a.type) : 'purchase_pattern_break',
          severity: ['low', 'medium', 'high', 'critical'].includes(String(a?.severity)) ? String(a.severity) : 'medium',
          probabilityPct: Math.max(0, Math.min(100, Number(a?.probability_pct ?? 50))),
          description: String(a?.description ?? '').slice(0, 250),
          detectedBy: ['isolation_forest', 'k-means', 'dbscan', 'autoencoder', 'statistical'].includes(String(a?.detected_by)) ? String(a.detected_by) : 'statistical',
          recommendedAction: ['monitor', 'investigate', 'contact', 'block'].includes(String(a?.recommended_action)) ? String(a.recommended_action) : 'monitor',
        })),
        behavioralConsistencyScore: Math.max(0, Math.min(100, Number(b?.behavioral_consistency_score ?? 50))),
        anomalyRiskScore: Math.max(0, Math.min(100, Number(b?.anomaly_risk_score ?? 30))),
        predictedNextAction: String(b?.predicted_next_action ?? '').slice(0, 200),
        mlClusterId: Math.max(0, Number(b?.ml_cluster_id ?? 0)),
        clusterDescription: String(b?.cluster_description ?? '').slice(0, 200),
      })),
    patterns: (parsed?.patterns || []).slice(0, 12).map((p: any) => ({
      pattern: PATTERN_TYPES.includes(String(p?.pattern) as any) ? String(p.pattern) : 'occasional_buyer',
      buyerCount: Math.max(0, Number(p?.buyer_count ?? 0)),
      avgSpentEur: Math.round(Number(p?.avg_spent_eur ?? 0)),
      avgFrequencyDays: Math.round(Number(p?.avg_frequency_days ?? 0)),
      retentionRatePct: Math.max(0, Math.min(100, Number(p?.retention_rate_pct ?? 50))),
      valueToBusiness: ['high', 'medium', 'low'].includes(String(p?.value_to_business)) ? String(p.value_to_business) : 'medium',
      bestStrategy: String(p?.best_strategy ?? '').slice(0, 250),
    })),
    anomalies: (parsed?.anomalies || []).slice(0, 8).map((a: any) => ({
      anomalyType: ANOMALY_TYPES.includes(String(a?.anomaly_type) as any) ? String(a.anomaly_type) : 'purchase_pattern_break',
      buyerCount: Math.max(0, Number(a?.buyer_count ?? 0)),
      avgSeverity: ['low', 'medium', 'high', 'critical'].includes(String(a?.avg_severity)) ? String(a.avg_severity) : 'medium',
      totalAnomalyValueEur: Math.round(Number(a?.total_anomaly_value_eur ?? 0)),
      investigationPriority: ['high', 'medium', 'low'].includes(String(a?.investigation_priority)) ? String(a.investigation_priority) : 'medium',
      recommendedInvestigation: String(a?.recommended_investigation ?? '').slice(0, 300),
    })),
    mlModels: (parsed?.ml_models || []).slice(0, 5).map((m: any) => ({
      model: ['isolation_forest', 'k-means', 'dbscan', 'autoencoder', 'statistical'].includes(String(m?.model)) ? String(m.model) : 'statistical',
      purpose: ['pattern_detection', 'anomaly_detection', 'clustering'].includes(String(m?.purpose)) ? String(m.purpose) : 'pattern_detection',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))),
      patternsDetected: Math.max(0, Number(m?.patterns_detected ?? 0)),
      anomaliesDetected: Math.max(0, Number(m?.anomalies_detected ?? 0)),
      falsePositiveRatePct: Math.max(0, Math.min(100, Number(m?.false_positive_rate_pct ?? 10))),
      bestFor: String(m?.best_for ?? '').slice(0, 150),
    })),
    interventions: (parsed?.interventions || []).slice(0, 6).map((i: any) => ({
      interventionType: ['personalized_outreach', 'loyalty_reward', 'anomaly_investigation', 'win_back', 'prevention'].includes(String(i?.intervention_type)) ? String(i.intervention_type) : 'personalized_outreach',
      targetBuyers: (i?.target_buyers || []).filter((n: any) => validNames.has(String(n))).slice(0, 5).map((n: any) => String(n).slice(0, 100)),
      description: String(i?.description ?? '').slice(0, 250),
      expectedImpactEur: Math.round(Number(i?.expected_impact_eur ?? 0)),
      priority: ['high', 'medium', 'low'].includes(String(i?.priority)) ? String(i.priority) : 'medium',
      timeframeDays: Math.max(1, Number(i?.timeframe_days ?? 7)),
    })),
    summary: {
      totalBuyersAnalyzed: targetBuyers.length,
      totalPatternsDetected: Math.max(0, Number(parsed?.summary?.total_patterns_detected ?? 0)),
      totalAnomaliesDetected: Math.max(0, Number(parsed?.summary?.total_anomalies_detected ?? 0)),
      avgBehavioralConsistencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_behavioral_consistency_score ?? 50))),
      avgAnomalyRiskScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_anomaly_risk_score ?? 30))),
      mostCommonPattern: PATTERN_TYPES.includes(String(parsed?.summary?.most_common_pattern) as any) ? String(parsed.summary.most_common_pattern) : 'occasional_buyer',
      biggestAnomalyThreat: String(parsed?.summary?.biggest_anomaly_threat ?? '').slice(0, 200),
      biggestPatternOpportunity: String(parsed?.summary?.biggest_pattern_opportunity ?? '').slice(0, 200),
      patternDetectionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.pattern_detection_score ?? 60))),
    },
  };
}
