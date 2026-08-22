// v6.68 / v8.95.7-inv1: AI Inventory Opportunity Scanner — skenira inventar za priložnosti z ML
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/inventory-opportunity-scanner
// Body: { tradeId?: string }
// Returns: { ok, scanner: { opportunities, categories, mlScoring, actionPlan, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const OPPORTUNITY_TYPES = ['undervalued_listing', 'price_mismatch', 'bundle_potential', 'cross_sell', 'upsell', 'seasonal_opportunity', 'market_gap', 'arbitrage', 'renovation_flip', 'bulk_discount'] as const;
const ML_METRICS = ['opportunity_score', 'uplift_potential', 'time_sensitivity', 'feasibility', 'roi'] as const;
const TRENDS = ['rising', 'stable', 'falling'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;

interface OpportunityScannerInput {
  tradeId: string | null;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: { aiEstimatedValue: number | null; dealScore: number | null; aiScore: number | null; aiRisk: number | null; location: string | null; description: string | null } | null;
}

interface ScannerItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  dealScore: number;
  aiScore: number;
  aiRisk: number;
}

export const POST = withAiRoute<OpportunityScannerInput>({
  endpoint: '/api/ai/inventory-opportunity-scanner',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget + avtomatsko recordAiCall po uspehu

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { tradeId: body?.tradeId ? String(body.tradeId) : null };
  },

  // No validateInput — tradeId opcijski (null = vsi held, max 50)

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId } = input;

    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades: HeldTradeRow[] = await db.trade.findMany({
      where,
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true, aiScore: true, aiRisk: true, location: true, description: true } } },
      take: tradeId ? 1 : 50,
    });

    // Sold trades (zadnjih 90 dni) — ohranjeno iz originala za konsistentnost podatkovnega modela.
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null, gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 300,
      orderBy: { sellDate: 'desc' },
    });
    void soldTrades;

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, scanner: null, message: 'Ni held tradeov za opportunity scanning.' });
    }

    const items = buildScannerItems(heldTrades);

    const prompt = buildScannerPrompt(items);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const scanner = transformScanner(parsed, items);

    return apiOk({ ok: true, scanner });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildScannerItems(heldTrades: HeldTradeRow[]): ScannerItem[] {
  const now = Date.now();
  return heldTrades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    const daysHeld = Math.round((now - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
    return { id: t.id, title: t.title, category: (t.category || 'drugo').toLowerCase(), cost, estValue, daysHeld, dealScore: t.listing?.dealScore ?? 50, aiScore: t.listing?.aiScore ?? 5, aiRisk: t.listing?.aiRisk ?? 5 };
  });
}

function buildScannerPrompt(items: ScannerItem[]): string {
  const itemsStr = items.slice(0, 25).map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d | deal ${i.dealScore}/100`).join('\n');
  return `Si AI inventory opportunity scanner z ML za odkrivanje skritih priložnosti.
Skenira inventar in identificira 10 tipov priložnosti.

INVENTAR (${items.length}):
${itemsStr}

10 opportunity tipov:
1. UNDERVALUED_LISTING: item je podcenjen (estValue >> cost)
2. PRICE_MISMATCH: cena ne ustreza tržni vrednosti
3. BUNDLE_POTENTIAL: item je primeren za bundle z drugim
4. CROSS_SELL: item omogoča cross-sell priložnost
5. UPSELL: item je primeren za upgrade pred prodajo
6. SEASONAL_OPPORTUNITY: item ustreza trenutni sezoni
7. MARKET_GAP: item zapolnjuje tržno vrzel
8. ARBITRAGE: cena razlika med platformami
9. RENOVATION_FLIP: item je primeren za obnovo in preprodajo
10. BULK_DISCOUNT: item je primeren za bulk nakup

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "opportunities": [
    { "trade_id": "<id>", "title": "<naslov>", "opportunity_type": "<10 tipov>", "opportunity_score": <number 0-100>, "estimated_uplift_eur": <number>, "description": "<max 150 znakov>", "recommended_action": "<max 120 znakov>", "timeframe_days": <number>, "priority": "<high|medium|low>" }
  ],
  "categories": [
    { "category": "<kategorija>", "opportunity_count": <number>, "avg_opportunity_score": <number 0-100>, "total_uplift_eur": <number>, "best_opportunity_type": "<10 tipov>", "trend": "<rising|stable|falling>" }
  ],
  "mlScoring": [
    { "metric": "<opportunity_score|uplift_potential|time_sensitivity|feasibility|roi>", "weight": <number 0-100>, "description": "<max 100 znakov>", "benchmark": <number 0-100> }
  ],
  "actionPlan": [
    { "step": <number>, "action": "<max 120 znakov>", "opportunity_targeted": "<10 tipov>", "expected_impact_eur": <number>, "timeframe_days": <number>, "priority": "<high|medium|low>" }
  ],
  "summary": {
    "total_opportunities_found": <number>, "total_estimated_uplift_eur": <number>,
    "avg_opportunity_score": <number>, "best_opportunity_type": "<10 tipov>",
    "biggest_opportunity": "<max 100 znakov>", "quickest_opportunity_win": "<max 100 znakov>",
    "opportunity_scanning_score": <number 0-100>
  }
}`;
}

function transformScanner(parsed: any, items: ScannerItem[]): any {
  const validIds = new Set(items.map(i => i.id));
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    opportunities: (parsed?.opportunities || []).filter((o: any) => validIds.has(String(o?.trade_id ?? ''))).slice(0, 25).map((o: any) => ({
      tradeId: String(o?.trade_id ?? ''), title: String(o?.title ?? '').slice(0, 100),
      opportunityType: (OPPORTUNITY_TYPES as readonly string[]).includes(String(o?.opportunity_type)) ? String(o.opportunity_type) : 'undervalued_listing',
      opportunityScore: Math.max(0, Math.min(100, Number(o?.opportunity_score ?? 50))),
      estimatedUpliftEur: Math.round(Number(o?.estimated_uplift_eur ?? 0)),
      description: String(o?.description ?? '').slice(0, 300), recommendedAction: String(o?.recommended_action ?? '').slice(0, 250),
      timeframeDays: Math.max(1, Number(o?.timeframe_days ?? 7)), priority: (PRIORITIES as readonly string[]).includes(String(o?.priority)) ? String(o.priority) : 'medium',
    })),
    categories: (parsed?.categories || []).slice(0, 10).map((c: any) => ({
      category: String(c?.category ?? '').slice(0, 50), opportunityCount: Math.max(0, Number(c?.opportunity_count ?? 0)),
      avgOpportunityScore: Math.max(0, Math.min(100, Number(c?.avg_opportunity_score ?? 50))),
      totalUpliftEur: Math.round(Number(c?.total_uplift_eur ?? 0)),
      bestOpportunityType: (OPPORTUNITY_TYPES as readonly string[]).includes(String(c?.best_opportunity_type)) ? String(c.best_opportunity_type) : 'undervalued_listing',
      trend: (TRENDS as readonly string[]).includes(String(c?.trend)) ? String(c.trend) : 'stable',
    })),
    mlScoring: (parsed?.mlScoring || []).slice(0, 5).map((m: any) => ({
      metric: (ML_METRICS as readonly string[]).includes(String(m?.metric)) ? String(m.metric) : 'opportunity_score',
      weight: Math.max(0, Math.min(100, Number(m?.weight ?? 20))), description: String(m?.description ?? '').slice(0, 200), benchmark: Math.max(0, Math.min(100, Number(m?.benchmark ?? 50))),
    })),
    actionPlan: (parsed?.actionPlan || []).slice(0, 8).map((a: any) => ({
      step: Math.max(1, Number(a?.step ?? 1)), action: String(a?.action ?? '').slice(0, 250),
      opportunityTargeted: (OPPORTUNITY_TYPES as readonly string[]).includes(String(a?.opportunity_targeted)) ? String(a.opportunity_targeted) : 'undervalued_listing',
      expectedImpactEur: Math.round(Number(a?.expected_impact_eur ?? 0)), timeframeDays: Math.max(1, Number(a?.timeframe_days ?? 7)),
      priority: (PRIORITIES as readonly string[]).includes(String(a?.priority)) ? String(a.priority) : 'medium',
    })),
    summary: {
      totalOpportunitiesFound: Math.max(0, Number(parsed?.summary?.total_opportunities_found ?? 0)),
      totalEstimatedUpliftEur: Math.round(Number(parsed?.summary?.total_estimated_uplift_eur ?? 0)),
      avgOpportunityScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_opportunity_score ?? 50))),
      bestOpportunityType: (OPPORTUNITY_TYPES as readonly string[]).includes(String(parsed?.summary?.best_opportunity_type)) ? String(parsed.summary.best_opportunity_type) : 'undervalued_listing',
      biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 200),
      quickestOpportunityWin: String(parsed?.summary?.quickest_opportunity_win ?? '').slice(0, 200),
      opportunityScanningScore: Math.max(0, Math.min(100, Number(parsed?.summary?.opportunity_scanning_score ?? 60))),
    },
  };
}
