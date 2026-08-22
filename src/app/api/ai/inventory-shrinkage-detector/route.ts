// v6.79 / v8.94-refactor: AI Inventory Shrinkage Detector — ML detekcija izgub inventarja (krađa, škoda, izguba)
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-shrinkage-detector
// Body: { days?: number }
// Returns: { ok, detector: { overview, shrinkageEvents, categoryAnalysis, riskItems, recommendations, mlModels, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const SHRINKAGE_TYPES = ['theft', 'damage', 'misplacement', 'administrative_error', 'spoilage', 'obsolescence', 'loss_in_transit', 'unrecorded_sale'] as const;
const SEVERITY_LEVELS = ['critical', 'high', 'medium', 'low'] as const;

interface ShrinkageDetectorInput {
  days: number;
}

export const POST = withAiRoute<ShrinkageDetectorInput>({
  endpoint: '/api/ai/inventory-shrinkage-detector',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget + avtomatsko recordAiCall po uspehu

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      days: Math.max(7, Math.min(365, Number(body?.days ?? 90))),
    };
  },

  // No validateInput — days ima default 90 z clamp 7-365

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { days } = input;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const allTrades = await db.trade.findMany({
      where: { OR: [{ status: 'held' }, { status: 'sold', sellDate: { gte: since } }, { status: 'cancelled' }] },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, buyLocation: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, status: true, notes: true, listingId: true },
      take: 1000,
      orderBy: { buyDate: 'desc' },
    });
    if (allTrades.length === 0) {
      return apiOk({ ok: true, detector: null, message: 'Ni podatkov za shrinkage analizo.' });
    }

    const heldTrades = allTrades.filter(t => t.status === 'held');
    const soldTrades = allTrades.filter(t => t.status === 'sold' && t.sellDate);
    const cancelledTrades = allTrades.filter(t => t.status === 'cancelled');

    const stats = computeShrinkageStats(heldTrades, soldTrades, cancelledTrades);

    const topCancelled = cancelledTrades.slice(0, 5).map(t => `- ${t.title} | ${t.category} | ${t.buyPrice}€ | ${t.buyLocation}`).join('\n');
    const topHeld = heldTrades.slice(0, 8).map(t => `- ${t.title} | ${t.category} | ${t.buyPrice}€ | ${(t.notes || '').slice(0, 50) || 'brez opomb'}`).join('\n');

    const prompt = buildShrinkagePrompt({
      stats,
      days,
      heldCount: heldTrades.length,
      soldCount: soldTrades.length,
      cancelledCount: cancelledTrades.length,
      topCancelled,
      topHeld,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const detector = transformShrinkageDetector(parsed, stats);

    return apiOk({ ok: true, detector });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface ShrinkageTradeRow {
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
}

interface ShrinkageStats {
  totalInventoryValue: number;
  cancelledValue: number;
  expectedRevenue: number;
  actualRevenue: number;
  revenueGap: number;
  shrinkagePct: number;
}

function computeShrinkageStats(
  heldTrades: ShrinkageTradeRow[],
  soldTrades: ShrinkageTradeRow[],
  cancelledTrades: ShrinkageTradeRow[]
): ShrinkageStats {
  const totalInventoryValue = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
  const cancelledValue = cancelledTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
  const expectedRevenue = soldTrades.reduce((s, t) => s + (t.buyPrice * 1.2), 0);
  const actualRevenue = soldTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
  const revenueGap = expectedRevenue - actualRevenue;
  const shrinkagePct = totalInventoryValue > 0 ? Math.round((cancelledValue / totalInventoryValue) * 1000) / 10 : 0;
  return { totalInventoryValue, cancelledValue, expectedRevenue, actualRevenue, revenueGap, shrinkagePct };
}

interface ShrinkagePromptInput {
  stats: ShrinkageStats;
  days: number;
  heldCount: number;
  soldCount: number;
  cancelledCount: number;
  topCancelled: string;
  topHeld: string;
}

function buildShrinkagePrompt(input: ShrinkagePromptInput): string {
  const { stats, days, heldCount, soldCount, cancelledCount, topCancelled, topHeld } = input;
  return `Si AI inventory shrinkage detector z ML in anomaly detection.
Detektira izgube inventarja: krađo, škodo, izgubo, administrativne napake, pokvarljivost, zastarelost.

STATS (zadnjih ${days} dni):
- Held items: ${heldCount} | vrednost: ${Math.round(stats.totalInventoryValue)}€
- Sold items: ${soldCount}
- Cancelled items: ${cancelledCount} | izgubljena vrednost: ${Math.round(stats.cancelledValue)}€
- Pričakovani revenue: ${Math.round(stats.expectedRevenue)}€ | dejanski: ${Math.round(stats.actualRevenue)}€
- Revenue gap: ${Math.round(stats.revenueGap)}€
- Shrinkage %: ${stats.shrinkagePct}%

TOP CANCELLED (izgube):
${topCancelled || 'brez'}

TOP HELD (trenutni inventar):
${topHeld}

8 tipov shrinkage:
1. THEFT: krađa
2. DAMAGE: fizična škoda
3. MISPLACEMENT: napačna lokacija/skladišče
4. ADMINISTRATIVE_ERROR: administrativna napaka
5. SPOILAGE: pokvarljivost
6. OBSOLESCENCE: zastarelost
7. LOSS_IN_TRANSIT: izguba pri transportu
8. UNRECORDED_SALE: neregistrirana prodaja

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_inventory_value_eur": <number>, "total_shrinkage_value_eur": <number>, "shrinkage_pct": <number 0-100>, "expected_revenue_eur": <number>, "actual_revenue_eur": <number>, "revenue_gap_eur": <number>, "shrinkage_trend": "<increasing|decreasing|stable>", "shrinkage_grade": "<A|B|C|D|F>" },
  "shrinkageEvents": [
    { "event_type": "<${SHRINKAGE_TYPES.join('|')}>", "item_title": "<max 100 znakov>", "category": "<string>", "lost_value_eur": <number>, "severity": "<${SEVERITY_LEVELS.join('|')}>", "date_detected": "<YYYY-MM-DD>", "root_cause": "<max 150 znakov>", "preventive_action": "<max 150 znakov>" }
  ],
  "categoryAnalysis": [
    { "category": "<string>", "total_items": <number>, "shrinkage_value_eur": <number>, "shrinkage_pct": <number 0-100>, "primary_shrinkage_type": "<${SHRINKAGE_TYPES.join('|')}>", "trend": "<increasing|decreasing|stable>", "risk_level": "<critical|high|medium|low>" }
  ],
  "riskItems": [
    { "item_title": "<max 100 znakov>", "category": "<string>", "value_eur": <number>, "shrinkage_risk_pct": <number 0-100>, "risk_factors": "<max 150 znakov>", "recommended_action": "<inspect|secure|relocate|sell_fast|audit>", "priority": "<critical|high|medium|low>" }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "category": "<process|security|audit|insurance|training>", "expected_savings_eur": <number>, "implementation_days": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<isolation_forest|autoencoder|lstm|gradient_boosting|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<anomaly_detection|risk_forecast|pattern_recognition|trend_analysis>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "shrinkage_risk_score": <number 0-100>, "shrinkage_grade": "<A|B|C|D|F>", "total_shrinkage_value_eur": <number>,
    "critical_events_count": <number>, "primary_shrinkage_type": "<${SHRINKAGE_TYPES.join('|')}>",
    "biggest_shrinkage_risk": "<max 100 znakov>", "biggest_prevention_opportunity": "<max 100 znakov>",
    "quickest_prevention_win": "<max 100 znakov>", "shrinkage_detection_score": <number 0-100>
  }
}`;
}

function transformShrinkageDetector(parsed: any, stats: ShrinkageStats) {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    overview: {
      totalInventoryValueEur: Math.round(Number(parsed?.overview?.total_inventory_value_eur ?? stats.totalInventoryValue)),
      totalShrinkageValueEur: Math.round(Number(parsed?.overview?.total_shrinkage_value_eur ?? stats.cancelledValue)),
      shrinkagePct: Math.max(0, Math.min(100, Number(parsed?.overview?.shrinkage_pct ?? stats.shrinkagePct))),
      expectedRevenueEur: Math.round(Number(parsed?.overview?.expected_revenue_eur ?? stats.expectedRevenue)),
      actualRevenueEur: Math.round(Number(parsed?.overview?.actual_revenue_eur ?? stats.actualRevenue)),
      revenueGapEur: Math.round(Number(parsed?.overview?.revenue_gap_eur ?? stats.revenueGap)),
      shrinkageTrend: ['increasing', 'decreasing', 'stable'].includes(String(parsed?.overview?.shrinkage_trend)) ? String(parsed.overview.shrinkage_trend) : 'stable',
      shrinkageGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.shrinkage_grade)) ? String(parsed.overview.shrinkage_grade) : 'C',
    },
    shrinkageEvents: (parsed?.shrinkageEvents || []).slice(0, 10).map((e: any) => ({
      eventType: (SHRINKAGE_TYPES as readonly string[]).includes(String(e?.event_type)) ? String(e.event_type) : 'damage',
      itemTitle: String(e?.item_title ?? '').slice(0, 200),
      category: String(e?.category ?? '').slice(0, 50),
      lostValueEur: Math.round(Number(e?.lost_value_eur ?? 0)),
      severity: (SEVERITY_LEVELS as readonly string[]).includes(String(e?.severity)) ? String(e.severity) : 'medium',
      dateDetected: String(e?.date_detected ?? '').slice(0, 10),
      rootCause: String(e?.root_cause ?? '').slice(0, 300),
      preventiveAction: String(e?.preventive_action ?? '').slice(0, 300),
    })),
    categoryAnalysis: (parsed?.categoryAnalysis || []).slice(0, 10).map((c: any) => ({
      category: String(c?.category ?? '').slice(0, 50),
      totalItems: Math.max(0, Number(c?.total_items ?? 0)),
      shrinkageValueEur: Math.round(Number(c?.shrinkage_value_eur ?? 0)),
      shrinkagePct: Math.max(0, Math.min(100, Number(c?.shrinkage_pct ?? 0))),
      primaryShrinkageType: (SHRINKAGE_TYPES as readonly string[]).includes(String(c?.primary_shrinkage_type)) ? String(c.primary_shrinkage_type) : 'damage',
      trend: ['increasing', 'decreasing', 'stable'].includes(String(c?.trend)) ? String(c.trend) : 'stable',
      riskLevel: ['critical', 'high', 'medium', 'low'].includes(String(c?.risk_level)) ? String(c.risk_level) : 'medium',
    })),
    riskItems: (parsed?.riskItems || []).slice(0, 12).map((r: any) => ({
      itemTitle: String(r?.item_title ?? '').slice(0, 200),
      category: String(r?.category ?? '').slice(0, 50),
      valueEur: Math.round(Number(r?.value_eur ?? 0)),
      shrinkageRiskPct: Math.max(0, Math.min(100, Number(r?.shrinkage_risk_pct ?? 30))),
      riskFactors: String(r?.risk_factors ?? '').slice(0, 300),
      recommendedAction: ['inspect', 'secure', 'relocate', 'sell_fast', 'audit'].includes(String(r?.recommended_action)) ? String(r.recommended_action) : 'inspect',
      priority: ['critical', 'high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 8).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      category: ['process', 'security', 'audit', 'insurance', 'training'].includes(String(r?.category)) ? String(r.category) : 'process',
      expectedSavingsEur: Math.round(Number(r?.expected_savings_eur ?? 0)),
      implementationDays: Math.max(1, Number(r?.implementation_days ?? 7)),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['isolation_forest', 'autoencoder', 'lstm', 'gradient_boosting', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: ['anomaly_detection', 'risk_forecast', 'pattern_recognition', 'trend_analysis'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'anomaly_detection',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      shrinkageRiskScore: Math.max(0, Math.min(100, Number(parsed?.summary?.shrinkage_risk_score ?? 50))),
      shrinkageGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.shrinkage_grade)) ? String(parsed.summary.shrinkage_grade) : 'C',
      totalShrinkageValueEur: Math.round(Number(parsed?.summary?.total_shrinkage_value_eur ?? stats.cancelledValue)),
      criticalEventsCount: Math.max(0, Number(parsed?.summary?.critical_events_count ?? 0)),
      primaryShrinkageType: (SHRINKAGE_TYPES as readonly string[]).includes(String(parsed?.summary?.primary_shrinkage_type)) ? String(parsed.summary.primary_shrinkage_type) : 'damage',
      biggestShrinkageRisk: String(parsed?.summary?.biggest_shrinkage_risk ?? '').slice(0, 200),
      biggestPreventionOpportunity: String(parsed?.summary?.biggest_prevention_opportunity ?? '').slice(0, 200),
      quickestPreventionWin: String(parsed?.summary?.quickest_prevention_win ?? '').slice(0, 200),
      shrinkageDetectionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.shrinkage_detection_score ?? 50))),
    },
  };
}
