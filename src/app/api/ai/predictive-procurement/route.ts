// v6.30 MILESTONE / v8.95.8-other1: AI Predictive Procurement System — napove kaj/kdaj/kje kupiti z avtomatizacijo.
// Refaktoriran z withAiRoute helperjem (v8.95.8-other1) + enforceBudget guard.
//
// POST /api/ai/predictive-procurement
// Body: { budget?: number, riskTolerance?: 'low'|'medium'|'high' }
// Returns: { ok, procurement: { plan, budgetAllocation, timeline, automationLevel, expectedOutcomes } | null, riskTolerance, budget }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface PredictiveProcurementInput {
  budget: number;
  riskTolerance: 'low' | 'medium' | 'high';
}

const RISK_TOLERANCES = ['low', 'medium', 'high'] as const;

interface PromptData {
  riskTolerance: string;
  budget: number;
  soldStr: string;
  recentStr: string;
  heldCatsJson: string;
}

export const POST = withAiRoute<PredictiveProcurementInput>({
  endpoint: '/api/ai/predictive-procurement',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const budget = Math.max(0, Number(body?.budget) || 0);
    const rtRaw = String(body?.riskTolerance);
    const riskTolerance: PredictiveProcurementInput['riskTolerance'] = (RISK_TOLERANCES as readonly string[]).includes(rtRaw)
      ? (rtRaw as PredictiveProcurementInput['riskTolerance'])
      : 'medium';
    return { budget, riskTolerance };
  },

  // No validateInput — both fields have defaults

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { budget, riskTolerance } = input;

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) } },
      select: { category: true, buyPrice: true, sellPrice: true, buyLocation: true, buyDate: true, sellDate: true },
      take: 300,
    });

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { category: true, buyPrice: true },
    });

    const recentListings = await db.listing.findMany({
      where: { isHidden: false, firstSeenAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        OR: [{ aiVerdict: 'PRILIKA' }, { dealScore: { gte: 70 } }] },
      select: { title: true, price: true, dealScore: true, firstSeenAt: true,
        monitor: { select: { source: true, name: true } } },
      take: 50,
      orderBy: { dealScore: 'desc' },
    });

    if (soldTrades.length === 0 && recentListings.length === 0) {
      return apiOk({ ok: true, procurement: null, message: 'Ni podatkov za procurement.' });
    }

    const soldStr = soldTrades.slice(0, 20).map(t => `- ${t.category} | ${t.buyPrice}€ → ${t.sellPrice}€ | ${t.buyLocation}`).join('\n');
    const recentStr = recentListings.slice(0, 15).map(l => `- ${l.title} | ${l.price}€ | deal: ${l.dealScore}/100 | ${l.monitor?.source}`).join('\n');
    const heldCats = heldTrades.reduce((acc, t) => { acc[t.category || 'drugo'] = (acc[t.category || 'drugo'] ?? 0) + 1; return acc; }, {} as Record<string, number>);

    const prompt = buildPrompt({
      riskTolerance, budget, soldStr, recentStr, heldCatsJson: JSON.stringify(heldCats),
    });
    const raw = await callAi(prompt);

    const parsed: any = parseAi(raw);
    const procurement = transformProcurement(parsed);

    return apiOk({ ok: true, procurement, riskTolerance, budget });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildPrompt(d: PromptData): string {
  return `Si AI procurement sistem za avtomatizirano nakupovanje pri preprodaji.
Ustvari celovit nakupovalni načrt (procurement plan) za naslednje 30 dni.

RIZIK TOLERANCA: ${d.riskTolerance}
${d.budget > 0 ? `BUDGET: ${d.budget}€` : 'BUDGET: neomejen'}

ZGODOVINSKE PRODAJE (180d):
${d.soldStr || '- Ni podatkov'}

TRENUTNE PRILIŽNOSTI (14d, deal score >= 70):
${d.recentStr || '- Ni novih priložnosti'}

TRENUTNI STOCK: ${d.heldCatsJson}

Procurement pravila:
1. Prioritiziraj kategorije z dokazanim ROI > 25%
2. Izogibaj se kategorijam z >60d povprečno prodajo (razen če ROI > 50%)
3. Diverzifikacija: max 30% budgeta v eno kategorijo
4. Risk tolerance:
   - low: samo "safe" nakupe (ROI > 20%, known categories)
   - medium: mix safe + speculative
   - high: vključi speculative flips (unknown categories, refurb items)
5. Za vsak nakup: konkreten item, vir, iskalne ključne besede, max cena
6. Avtomatizacija: kaj lahko avtomatiziraš (monitor setup, alert nastavitve)

Odgovori LE z JSON:
{
  "plan": [
    {
      "priority": <number 1-10>,
      "category": "<kategorija>",
      "item_description": "<konkreten item za iskanje, max 100 znakov>",
      "source": "<bolha|vinted|avtonet|mobile-de|kleinanzeigen|subito|willhaben|facebook>",
      "search_keywords": "<ključne besede, max 80 znakov>",
      "max_buy_price_eur": <number>,
      "expected_sell_price_eur": <number>,
      "expected_roi_pct": <number>,
      "expected_days_to_sell": <number>,
      "risk_level": "<low|medium|high>",
      "automation": {
        "monitor_setup": "<kakšen monitor nastaviti, max 100 znakov>",
        "alert_threshold_score": <number 0-100>,
        "max_price_filter_eur": <number>,
        "keywords_filter": "<ključne besede za filter>",
        "auto_alert": <boolean>
      },
      "reasoning": "<max 80 znakov>"
    }
  ],
  "budget_allocation": [
    { "category": "<kat>", "amount_eur": <number>, "pct": <number>, "item_count": <number> }
  ],
  "timeline": [
    { "week": <number>, "action": "<max 100 znakov>", "items_to_buy": <number>, "budget_eur": <number> }
  ],
  "automation_level": "<full|semi|manual>",
  "expected_outcomes": {
    "total_investment_eur": <number>,
    "expected_revenue_eur": <number>,
    "expected_profit_eur": <number>,
    "expected_roi_pct": <number>,
    "expected_avg_days_to_sell": <number>,
    "projected_monthly_profit_eur": <number>
  },
  "insights": "<max 250 znakov>"
}`;
}

function transformProcurement(parsed: any): {
  plan: any[];
  budgetAllocation: any[];
  timeline: any[];
  automationLevel: string;
  expectedOutcomes: any;
  insights: string;
} {
  return {
    plan: (parsed?.plan || []).slice(0, 12).map((p: any) => ({
      priority: Math.max(1, Math.min(10, Number(p?.priority ?? 5))),
      category: String(p?.category ?? '').slice(0, 50),
      itemDescription: String(p?.item_description ?? '').slice(0, 200),
      source: String(p?.source ?? 'bolha').slice(0, 30),
      searchKeywords: String(p?.search_keywords ?? '').slice(0, 150),
      maxBuyPriceEur: Math.max(0, Number(p?.max_buy_price_eur ?? 0)),
      expectedSellPriceEur: Math.max(0, Number(p?.expected_sell_price_eur ?? 0)),
      expectedRoiPct: Math.round(Number(p?.expected_roi_pct ?? 0)),
      expectedDaysToSell: Math.max(0, Number(p?.expected_days_to_sell ?? 0)),
      riskLevel: ['low', 'medium', 'high'].includes(String(p?.risk_level)) ? String(p.risk_level) : 'medium',
      automation: {
        monitorSetup: String(p?.automation?.monitor_setup ?? '').slice(0, 200),
        alertThresholdScore: Math.max(0, Math.min(100, Number(p?.automation?.alert_threshold_score ?? 70))),
        maxPriceFilterEur: Math.max(0, Number(p?.automation?.max_price_filter_eur ?? 0)),
        keywordsFilter: String(p?.automation?.keywords_filter ?? '').slice(0, 150),
        autoAlert: Boolean(p?.automation?.auto_alert ?? true),
      },
      reasoning: String(p?.reasoning ?? '').slice(0, 150),
    })),
    budgetAllocation: (parsed?.budget_allocation || []).slice(0, 8).map((a: any) => ({
      category: String(a?.category ?? '').slice(0, 50),
      amountEur: Math.max(0, Number(a?.amount_eur ?? 0)),
      pct: Math.max(0, Math.min(100, Number(a?.pct ?? 0))),
      itemCount: Math.max(0, Number(a?.item_count ?? 0)),
    })),
    timeline: (parsed?.timeline || []).slice(0, 4).map((t: any) => ({
      week: Math.max(1, Number(t?.week ?? 1)),
      action: String(t?.action ?? '').slice(0, 200),
      itemsToBuy: Math.max(0, Number(t?.items_to_buy ?? 0)),
      budgetEur: Math.max(0, Number(t?.budget_eur ?? 0)),
    })),
    automationLevel: ['full', 'semi', 'manual'].includes(String(parsed?.automation_level)) ? String(parsed.automation_level) : 'semi',
    expectedOutcomes: {
      totalInvestmentEur: Math.round(Number(parsed?.expected_outcomes?.total_investment_eur ?? 0)),
      expectedRevenueEur: Math.round(Number(parsed?.expected_outcomes?.expected_revenue_eur ?? 0)),
      expectedProfitEur: Math.round(Number(parsed?.expected_outcomes?.expected_profit_eur ?? 0)),
      expectedRoiPct: Math.round(Number(parsed?.expected_outcomes?.expected_roi_pct ?? 0)),
      expectedAvgDaysToSell: Math.round(Number(parsed?.expected_outcomes?.expected_avg_days_to_sell ?? 0)),
      projectedMonthlyProfitEur: Math.round(Number(parsed?.expected_outcomes?.projected_monthly_profit_eur ?? 0)),
    },
    insights: String(parsed?.insights ?? '').slice(0, 600),
  };
}
