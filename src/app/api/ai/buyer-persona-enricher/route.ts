// v6.83 / v8.95.4-batch2: AI Buyer Persona Enricher — ML obogatitev buyer personas z demographics in behavior
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-persona-enricher
// Body: { customerName?: string }
// Returns: { ok, enricher: { buyers, personas, demographicProfile, behaviorPatterns, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BuyerPersonaEnricherInput {
  customerName: string | null;
}

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  sellLocation: string;
  buyDate: Date | null;
}

interface BuyerInfo {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrder: number;
  firstPurchase: Date | null;
  lastPurchase: Date | null;
  categories: Set<string>;
  titles: string[];
  daysSinceLast: number;
}

const PERSONA_TYPES = ['bargain_hunter', 'quality_seeker', 'collector', 'reseller', 'first_time_buyer', 'business_buyer', 'gift_buyer', 'enthusiast', 'casual_browser', 'power_buyer'] as const;
const DEMOGRAPHIC_TIERS = ['gen_z', 'millennial', 'gen_x', 'boomer', 'unknown'] as const;
const ML_MODELS = ['bert', 'gpt', 'roberta', 'distilbert', 'ensemble'] as const;
const ML_PREDICTION_TYPES = ['persona_classification', 'demographic_inference', 'behavior_prediction', 'motivation_analysis'] as const;
const SPENDING_POWER = ['low', 'medium', 'high', 'premium'] as const;
const COMM_PREFS = ['formal', 'friendly', 'casual', 'technical'] as const;
const PURCHASE_FREQ = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;

export const POST = withAiRoute<BuyerPersonaEnricherInput>({
  endpoint: '/api/ai/buyer-persona-enricher',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { customerName: body?.customerName ? String(body.customerName).trim() : null };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { customerName } = input;

    const soldTrades: SoldTradeRow[] = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, enricher: null, message: 'Ni prodaj za persona enrichment.' });
    }

    const buyers = buildBuyerMap(soldTrades);
    if (customerName) {
      const f = buyers.filter(b => b.name === customerName);
      if (f.length === 0) {
        return apiOk({ ok: true, enricher: null, message: `Kupec "${customerName}" ni najden.` });
      }
    }

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const prompt = buildPrompt(targetBuyers);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const enricher = transformEnricher(parsed, targetBuyers);
    return apiOk({ ok: true, enricher });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildBuyerMap(soldTrades: SoldTradeRow[]): BuyerInfo[] {
  const buyerMap = new Map<string, BuyerInfo>();
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  for (const t of soldTrades) {
    const name = (t.sellLocation || '').trim();
    if (!name || name.length < 2 || !t.sellDate) continue;
    const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    if (!buyerMap.has(name)) {
      buyerMap.set(name, {
        name, purchases: 0, totalSpent: 0, avgOrder: 0,
        firstPurchase: t.sellDate, lastPurchase: t.sellDate,
        categories: new Set(), titles: [], daysSinceLast: 0,
      });
    }
    const b = buyerMap.get(name)!;
    b.purchases += 1;
    b.totalSpent += rev;
    if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate;
    if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
    if (t.category) b.categories.add(t.category);
    if (b.titles.length < 5) b.titles.push(t.title);
  }
  return Array.from(buyerMap.values()).map(b => {
    b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0;
    b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / DAY) : 999;
    return b;
  });
}

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function buildPrompt(targetBuyers: BuyerInfo[]): string {
  const buyersStr = targetBuyers.slice(0, 10).map(b =>
    `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d | kat: ${Array.from(b.categories).slice(0, 3).join(',')} | zadnje: ${b.titles.slice(0, 2).join('; ')}`
  ).join('\n');

  return `Si AI buyer persona enricher z ML in demographic inference.
Obogati buyer personas z 10 tipi in 5 demographic tierji.

KUPCI (${targetBuyers.length}):
${buyersStr}

10 tipov personas:
1. BARGAIN_HUNTER: išče ugodne cene
2. QUALITY_SEEKER: išče kakovost
3. COLLECTOR: zbiratelj
4. RESELLER: preprodajalec
5. FIRST_TIME_BUYER: prvi nakup
6. BUSINESS_BUYER: poslovni kupec
7. GIFT_BUYER: nakup za darilo
8. ENTHUSIAST: navdušenec
9. CASUAL_BROWSER: naključni kupec
10. POWER_BUYER: velik kupec

5 demographic tierjev: gen_z, millennial, gen_x, boomer, unknown

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    { "name": "<string>", "persona_type": "<${PERSONA_TYPES.join('|')}>", "persona_confidence_pct": <number 0-100>, "demographic_tier": "<${DEMOGRAPHIC_TIERS.join('|')}>", "estimated_age_range": "<max 20 znakov>", "spending_power": "<low|medium|high|premium>", "purchase_motivation": "<max 100 znakov>", "preferred_categories": "<max 100 znakov>", "communication_preference": "<formal|friendly|casual|technical>", "persona_score": <number 0-100> }
  ],
  "personas": [
    { "persona_type": "<${PERSONA_TYPES.join('|')}>", "buyer_count": <number>, "buyer_pct": <number 0-100>, "avg_order_value_eur": <number>, "total_revenue_eur": <number>, "retention_rate_pct": <number 0-100>, "lifetime_value_eur": <number>, "primary_motivation": "<max 100 znakov>", "best_channel": "<max 50 znakov>" }
  ],
  "demographicProfile": [
    { "tier": "<${DEMOGRAPHIC_TIERS.join('|')}>", "buyer_count": <number>, "buyer_pct": <number 0-100>, "preferred_categories": "<max 100 znakov>", "avg_order_value_eur": <number>, "purchase_frequency": "<daily|weekly|monthly|quarterly|yearly>", "tech_savviness_pct": <number 0-100>, "price_sensitivity_pct": <number 0-100> }
  ],
  "behaviorPatterns": [
    { "pattern": "<max 100 znakov>", "frequency_pct": <number 0-100>, "avg_revenue_per_occurrence_eur": <number>, "affected_buyer_count": <number>, "trigger": "<max 100 znakov>", "opportunity": "<max 100 znakov>" }
  ],
  "mlModels": [
    { "model": "<bert|gpt|roberta|distilbert|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<persona_classification|demographic_inference|behavior_prediction|motivation_analysis>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "persona_enrichment_score": <number 0-100>, "persona_grade": "<A|B|C|D|F>", "total_buyers_analyzed": <number>,
    "primary_persona_type": "<${PERSONA_TYPES.join('|')}>", "avg_persona_confidence_pct": <number 0-100>,
    "biggest_persona_risk": "<max 100 znakov>", "biggest_persona_opportunity": "<max 100 znakov>",
    "quickest_persona_win": "<max 100 znakov>", "persona_analysis_score": <number 0-100>
  }
}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function transformEnricher(parsed: any, targetBuyers: BuyerInfo[]): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    buyers: (parsed?.buyers || []).slice(0, 25).map((b: any) => ({
      name: String(b?.name ?? '').slice(0, 100),
      personaType: includes(PERSONA_TYPES, String(b?.persona_type)) ? String(b.persona_type) : 'casual_browser',
      personaConfidencePct: clamp(Number(b?.persona_confidence_pct ?? 60), 0, 100),
      demographicTier: includes(DEMOGRAPHIC_TIERS, String(b?.demographic_tier)) ? String(b.demographic_tier) : 'unknown',
      estimatedAgeRange: String(b?.estimated_age_range ?? '').slice(0, 40),
      spendingPower: includes(SPENDING_POWER, String(b?.spending_power)) ? String(b.spending_power) : 'medium',
      purchaseMotivation: String(b?.purchase_motivation ?? '').slice(0, 200),
      preferredCategories: String(b?.preferred_categories ?? '').slice(0, 200),
      communicationPreference: includes(COMM_PREFS, String(b?.communication_preference)) ? String(b.communication_preference) : 'friendly',
      personaScore: clamp(Number(b?.persona_score ?? 50), 0, 100),
    })),
    personas: (parsed?.personas || []).slice(0, 10).map((p: any) => ({
      personaType: includes(PERSONA_TYPES, String(p?.persona_type)) ? String(p.persona_type) : 'casual_browser',
      buyerCount: Math.max(0, Number(p?.buyer_count ?? 0)),
      buyerPct: clamp(Number(p?.buyer_pct ?? 0), 0, 100),
      avgOrderValueEur: Math.round(Number(p?.avg_order_value_eur ?? 0)),
      totalRevenueEur: Math.round(Number(p?.total_revenue_eur ?? 0)),
      retentionRatePct: clamp(Number(p?.retention_rate_pct ?? 50), 0, 100),
      lifetimeValueEur: Math.round(Number(p?.lifetime_value_eur ?? 0)),
      primaryMotivation: String(p?.primary_motivation ?? '').slice(0, 200),
      bestChannel: String(p?.best_channel ?? '').slice(0, 100),
    })),
    demographicProfile: (parsed?.demographicProfile || []).slice(0, 5).map((d: any) => ({
      tier: includes(DEMOGRAPHIC_TIERS, String(d?.tier)) ? String(d.tier) : 'unknown',
      buyerCount: Math.max(0, Number(d?.buyer_count ?? 0)),
      buyerPct: clamp(Number(d?.buyer_pct ?? 0), 0, 100),
      preferredCategories: String(d?.preferred_categories ?? '').slice(0, 200),
      avgOrderValueEur: Math.round(Number(d?.avg_order_value_eur ?? 0)),
      purchaseFrequency: includes(PURCHASE_FREQ, String(d?.purchase_frequency)) ? String(d.purchase_frequency) : 'monthly',
      techSavvinessPct: clamp(Number(d?.tech_savviness_pct ?? 50), 0, 100),
      priceSensitivityPct: clamp(Number(d?.price_sensitivity_pct ?? 50), 0, 100),
    })),
    behaviorPatterns: (parsed?.behaviorPatterns || []).slice(0, 8).map((p: any) => ({
      pattern: String(p?.pattern ?? '').slice(0, 200),
      frequencyPct: clamp(Number(p?.frequency_pct ?? 0), 0, 100),
      avgRevenuePerOccurrenceEur: Math.round(Number(p?.avg_revenue_per_occurrence_eur ?? 0)),
      affectedBuyerCount: Math.max(0, Number(p?.affected_buyer_count ?? 0)),
      trigger: String(p?.trigger ?? '').slice(0, 200),
      opportunity: String(p?.opportunity ?? '').slice(0, 200),
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: includes(ML_MODELS, String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: clamp(Number(m?.accuracy_pct ?? 75), 0, 100),
      predictionType: includes(ML_PREDICTION_TYPES, String(m?.prediction_type)) ? String(m.prediction_type) : 'persona_classification',
      weightInEnsemble: clamp(Number(m?.weight_in_ensemble ?? 20), 0, 100),
    })),
    summary: {
      personaEnrichmentScore: clamp(Number(parsed?.summary?.persona_enrichment_score ?? 50), 0, 100),
      personaGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.persona_grade)) ? String(parsed.summary.persona_grade) : 'C',
      totalBuyersAnalyzed: Math.max(0, Number(parsed?.summary?.total_buyers_analyzed ?? targetBuyers.length)),
      primaryPersonaType: includes(PERSONA_TYPES, String(parsed?.summary?.primary_persona_type)) ? String(parsed.summary.primary_persona_type) : 'casual_browser',
      avgPersonaConfidencePct: clamp(Number(parsed?.summary?.avg_persona_confidence_pct ?? 60), 0, 100),
      biggestPersonaRisk: String(parsed?.summary?.biggest_persona_risk ?? '').slice(0, 200),
      biggestPersonaOpportunity: String(parsed?.summary?.biggest_persona_opportunity ?? '').slice(0, 200),
      quickestPersonaWin: String(parsed?.summary?.quickest_persona_win ?? '').slice(0, 200),
      personaAnalysisScore: clamp(Number(parsed?.summary?.persona_analysis_score ?? 50), 0, 100),
    },
  };
}
