/**
 * @deprecated v8.94 — uporabi `/api/ai/profit-margin-predictor-v3` namesto tega.
 * Zastareli v1 — v3 je najnovejši.
 * Ta endpoint bo odstranjen v v9.0. Glej ENDPOINTS_AUDIT.md za migracijski načrt.
 */
// v6.47: AI Profit Margin Predictor — pred-nakupna ocena dobička za potencialne investicije
// POST /api/ai/profit-margin-predictor
// Body: { listingId?: string, listing?: { title, price, location, description, source, category? }, budget?: number }
// Returns: { ok, predictor: { listings, profitability, scenarios, riskFactors, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

// Kategorijski povprečni dobički in časi prodaje (bazirano na realnih podatkih)
const CATEGORY_PROFILES: Record<string, {
  avgMarginPct: number;
  avgDaysToSell: number;
  riskLevel: 'low' | 'medium' | 'high';
  liquidityScore: number; // 0-100
  demandStability: number; // 0-100
  seasonalityImpact: number; // 0-100
}> = {
  'elektronika':  { avgMarginPct: 25, avgDaysToSell: 14, riskLevel: 'medium', liquidityScore: 75, demandStability: 70, seasonalityImpact: 30 },
  'telefoni':     { avgMarginPct: 18, avgDaysToSell: 10, riskLevel: 'high',   liquidityScore: 85, demandStability: 60, seasonalityImpact: 20 },
  'avto':         { avgMarginPct: 12, avgDaysToSell: 30, riskLevel: 'medium', liquidityScore: 50, demandStability: 80, seasonalityImpact: 15 },
  'nepremicnine': { avgMarginPct: 8,  avgDaysToSell: 90, riskLevel: 'low',    liquidityScore: 25, demandStability: 90, seasonalityImpact: 10 },
  'kolesa':       { avgMarginPct: 30, avgDaysToSell: 21, riskLevel: 'medium', liquidityScore: 60, demandStability: 65, seasonalityImpact: 70 },
  'pohištvo':     { avgMarginPct: 35, avgDaysToSell: 45, riskLevel: 'medium', liquidityScore: 40, demandStability: 60, seasonalityImpact: 20 },
  'drugo':        { avgMarginPct: 22, avgDaysToSell: 21, riskLevel: 'medium', liquidityScore: 55, demandStability: 65, seasonalityImpact: 30 },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId } = body;
    const listingInput = body?.listing;
    const userBudget = Number(body?.budget ?? 0);

    let targetListings: Array<{
      id: string;
      title: string;
      price: number;
      location: string;
      description: string;
      source: string;
      category: string;
      aiScore: number;
      aiRisk: number;
      dealScore: number;
      aiEstimatedValue: number | null;
      postedAt: Date | null;
    }> = [];

    if (listingId) {
      const l = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: {
          id: true, title: true, price: true, priceText: true, location: true,
          description: true, detailDescription: true, postedAt: true, firstSeenAt: true,
          aiScore: true, aiRisk: true, dealScore: true, aiEstimatedValue: true, aiVerdict: true,
          monitor: { select: { source: true, name: true } },
        },
      });
      if (!l) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      targetListings = [{
        id: l.id, title: l.title, price: l.price ?? 0, location: l.location,
        description: (l.detailDescription || l.description || '').slice(0, 500),
        source: l.monitor?.source || 'bolha',
        category: '', // določi AI
        aiScore: l.aiScore ?? 5, aiRisk: l.aiRisk ?? 5, dealScore: l.dealScore ?? 50,
        aiEstimatedValue: l.aiEstimatedValue, postedAt: l.postedAt ?? l.firstSeenAt,
      }];
    } else if (listingInput) {
      targetListings = [{
        id: 'input-1', title: listingInput.title, price: Number(listingInput.price ?? 0),
        location: listingInput.location || '', description: listingInput.description || '',
        source: listingInput.source || 'bolha', category: listingInput.category || '',
        aiScore: 5, aiRisk: 5, dealScore: 50, aiEstimatedValue: null,
        postedAt: listingInput.postedAt ? new Date(listingInput.postedAt) : null,
      }];
    } else {
      // Pridobi zadnje PRILIKA listinge
      const listings = await db.listing.findMany({
        where: { aiVerdict: 'PRILIKA', aiScore: { gte: 7 }, isHidden: false, price: { not: null } },
        orderBy: { firstSeenAt: 'desc' },
        take: 20,
        select: {
          id: true, title: true, price: true, priceText: true, location: true,
          description: true, detailDescription: true, postedAt: true, firstSeenAt: true,
          aiScore: true, aiRisk: true, dealScore: true, aiEstimatedValue: true,
          monitor: { select: { source: true, name: true } },
        },
      });
      targetListings = listings.map(l => ({
        id: l.id, title: l.title, price: l.price ?? 0, location: l.location,
        description: (l.detailDescription || l.description || '').slice(0, 500),
        source: l.monitor?.source || 'bolha', category: '',
        aiScore: l.aiScore ?? 5, aiRisk: l.aiRisk ?? 5, dealScore: l.dealScore ?? 50,
        aiEstimatedValue: l.aiEstimatedValue, postedAt: l.postedAt ?? l.firstSeenAt,
      }));
    }

    if (targetListings.length === 0) {
      return NextResponse.json({ ok: true, predictor: null, message: 'Ni listingov za profit margin analizo.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const listingsStr = targetListings.slice(0, 15).map(l => {
      const ageHours = l.postedAt ? Math.round((Date.now() - l.postedAt.getTime()) / (60*60*1000)) : 0;
      return `- [${l.id}] "${l.title}" | ${l.price}€ | ${l.location || 'nepoznano'} | ${l.source} | AI score ${l.aiScore}/10 risk ${l.aiRisk}/10 | deal ${l.dealScore}/100 | estValue ${l.aiEstimatedValue ?? 'nepoznano'}€ | starost ${ageHours}h`;
    }).join('\n');

    const prompt = `Si AI profit margin predictor za slovenske oglasne platforme.
Pred-nakupna analiza dobička za vsak listing — oceni profitability pred investicijo.

LISTINGI ZA ANALIZO (${targetListings.length}):
${listingsStr}

${userBudget > 0 ? `BUDGET: ${userBudget}€` : 'BUDGET: neomejen'}

Profit margin formula:
- BUY_PRICE + BUY_FEES (shipping, transport, pristojbine)
- + HOLDING_COSTS (storage, depreciation, opportunity cost)
- + SELLING_FEES (platform fee 0-10%, payment fee 2-4%, shipping)
- = TOTAL_COST
- SELL_PRICE - TOTAL_COST = PROFIT
- PROFIT / TOTAL_COST * 100 = MARGIN %

Profitability faktorji:
1. AI_ESTIMATED_VALUE vs ASKING_PRICE: večji discount = višji margin
2. CATEGORY_LIQUIDITY: hitrost prodaje (elektronika=hitra, nepremičnine=počasna)
3. DEMAND_STABILITY: ali bo cena padla čez čas (telefoni=padajo, nepremičnine=rastejo)
4. SEASONALITY: kategorijska sezonskost (kolesa poleti, smuči pozimi)
5. RISK_FACTORS: scam risk, shipping damage, returns
6. OPPORTUNITY_COST: koliko časa se kapital veže (razmerje profit/dni)
7. RENOVATION_NEEDED: če item potrebuje popravilo/cleaning
8. RESELLING_COMPLEXITY: težavnost ponovne prodaje

Profitability tiers:
- EXCELLENT: >40% margin, <14 dni prodaja, low risk
- GOOD: 25-40% margin, <30 dni prodaja, medium risk
- AVERAGE: 15-25% margin, <60 dni prodaja, medium risk
- POOR: <15% margin, >60 dni prodaja, high risk
- LOSS: negativen margin (pogosto zaradi fees ali depreciation)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "id": "<listing_id>",
      "title": "<naslov>",
      "category": "<kategorija>",
      "buy_price_eur": <number>,
      "estimated_sell_price_eur": <number>,
      "buy_fees_eur": <number>,
      "selling_fees_eur": <number>,
      "holding_costs_eur": <number>,
      "total_cost_eur": <number>,
      "expected_profit_eur": <number>,
      "margin_pct": <number>,
      "roi_pct": <number>,
      "expected_days_to_sell": <number>,
      "daily_profit_eur": <number>,
      "profitability_tier": "<excellent|good|average|poor|loss>",
      "recommendation": "<strong_buy|buy|consider|avoid|strong_avoid>",
      "reasoning": "<max 150 znakov>",
      "best_selling_platform": "<bolha|facebook|vinted|ebay|kleinanzeigen>",
      "renovation_needed": "<none|cleaning|minor_repair|major_repair|professional>",
      "renovation_cost_eur": <number>
    }
  ],
  "profitability": [
    { "tier": "<excellent|good|average|poor|loss>", "count": <number>, "total_profit_eur": <number>, "avg_margin_pct": <number>, "avg_days_to_sell": <number> }
  ],
  "scenarios": [
    { "scenario": "<best_case|expected_case|worst_case>", "probability_pct": <number>, "total_profit_eur": <number>, "avg_margin_pct": <number>, "total_investment_eur": <number> }
  ],
  "risk_factors": [
    { "factor": "<max 80 znakov>", "impact_eur": <number>, "probability_pct": <number>, "mitigation": "<max 120 znakov>" }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_impact_eur": <number>, "listings_affected": <number> }
  ],
  "summary": {
    "total_listings": <number>,
    "total_investment_eur": <number>,
    "expected_total_profit_eur": <number>,
    "avg_margin_pct": <number>,
    "avg_roi_pct": <number>,
    "expected_avg_days_to_sell": <number>,
    "best_opportunity_id": "<listing_id>",
    "worst_opportunity_id": "<listing_id>",
    "profitability_score": <number 0-100>,
    "biggest_risk": "<max 100 znakov>",
    "quickest_win": "<max 100 znakov>",
    "budget_recommendation": "<max 150 znakov>"
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
    const validIds = new Set(targetListings.map(l => l.id));

    const predictor = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      listings: (parsed?.listings || [])
        .filter((l: any) => validIds.has(String(l?.id ?? '')))
        .slice(0, 15)
        .map((l: any) => {
          const orig = targetListings.find(x => x.id === String(l?.id));
          const buyPrice = Math.max(0, Number(l?.buy_price_eur ?? orig?.price ?? 0));
          const estSell = Math.max(0, Number(l?.estimated_sell_price_eur ?? orig?.aiEstimatedValue ?? buyPrice * 1.25));
          const buyFees = Math.max(0, Number(l?.buy_fees_eur ?? 0));
          const sellingFees = Math.max(0, Number(l?.selling_fees_eur ?? Math.round(estSell * 0.05)));
          const holdingCosts = Math.max(0, Number(l?.holding_costs_eur ?? 0));
          const totalCost = buyPrice + buyFees + sellingFees + holdingCosts;
          const profit = estSell - totalCost;
          const marginPct = totalCost > 0 ? Math.round((profit / totalCost) * 1000) / 10 : 0;
          const roiPct = buyPrice > 0 ? Math.round((profit / buyPrice) * 1000) / 10 : 0;
          const daysToSell = Math.max(1, Number(l?.expected_days_to_sell ?? 14));
          return {
            listingId: String(l?.id ?? ''),
            title: String(l?.title ?? orig?.title ?? '').slice(0, 150),
            category: String(l?.category ?? '').slice(0, 50),
            buyPriceEur: buyPrice,
            estimatedSellPriceEur: estSell,
            buyFeesEur: buyFees,
            sellingFeesEur: sellingFees,
            holdingCostsEur: holdingCosts,
            totalCostEur: totalCost,
            expectedProfitEur: Math.round(profit),
            marginPct,
            roiPct,
            expectedDaysToSell: daysToSell,
            dailyProfitEur: Math.round((profit / daysToSell) * 100) / 100,
            profitabilityTier: ['excellent', 'good', 'average', 'poor', 'loss'].includes(String(l?.profitability_tier)) ? String(l.profitability_tier) : 'average',
            recommendation: ['strong_buy', 'buy', 'consider', 'avoid', 'strong_avoid'].includes(String(l?.recommendation)) ? String(l.recommendation) : 'consider',
            reasoning: String(l?.reasoning ?? '').slice(0, 300),
            bestSellingPlatform: ['bolha', 'facebook', 'vinted', 'ebay', 'kleinanzeigen'].includes(String(l?.best_selling_platform)) ? String(l.best_selling_platform) : 'bolha',
            renovationNeeded: ['none', 'cleaning', 'minor_repair', 'major_repair', 'professional'].includes(String(l?.renovation_needed)) ? String(l.renovation_needed) : 'none',
            renovationCostEur: Math.max(0, Number(l?.renovation_cost_eur ?? 0)),
          };
        }),
      profitability: (parsed?.profitability || []).slice(0, 5).map((p: any) => ({
        tier: ['excellent', 'good', 'average', 'poor', 'loss'].includes(String(p?.tier)) ? String(p.tier) : 'average',
        count: Math.max(0, Number(p?.count ?? 0)),
        totalProfitEur: Math.round(Number(p?.total_profit_eur ?? 0)),
        avgMarginPct: Math.round(Number(p?.avg_margin_pct ?? 0)),
        avgDaysToSell: Math.max(0, Number(p?.avg_days_to_sell ?? 0)),
      })),
      scenarios: (parsed?.scenarios || []).slice(0, 3).map((s: any) => ({
        scenario: ['best_case', 'expected_case', 'worst_case'].includes(String(s?.scenario)) ? String(s.scenario) : 'expected_case',
        probabilityPct: Math.max(0, Math.min(100, Number(s?.probability_pct ?? 50))),
        totalProfitEur: Math.round(Number(s?.total_profit_eur ?? 0)),
        avgMarginPct: Math.round(Number(s?.avg_margin_pct ?? 0)),
        totalInvestmentEur: Math.round(Number(s?.total_investment_eur ?? 0)),
      })),
      riskFactors: (parsed?.risk_factors || []).slice(0, 6).map((r: any) => ({
        factor: String(r?.factor ?? '').slice(0, 150),
        impactEur: Math.round(Number(r?.impact_eur ?? 0)),
        probabilityPct: Math.max(0, Math.min(100, Number(r?.probability_pct ?? 50))),
        mitigation: String(r?.mitigation ?? '').slice(0, 250),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        expectedImpactEur: Math.round(Number(r?.expected_impact_eur ?? 0)),
        listingsAffected: Math.max(0, Number(r?.listings_affected ?? 0)),
      })),
      summary: {
        totalListings: targetListings.length,
        totalInvestmentEur: Math.round(Number(parsed?.summary?.total_investment_eur ?? 0)),
        expectedTotalProfitEur: Math.round(Number(parsed?.summary?.expected_total_profit_eur ?? 0)),
        avgMarginPct: Math.round(Number(parsed?.summary?.avg_margin_pct ?? 0)),
        avgRoiPct: Math.round(Number(parsed?.summary?.avg_roi_pct ?? 0)),
        expectedAvgDaysToSell: Math.round(Number(parsed?.summary?.expected_avg_days_to_sell ?? 14)),
        bestOpportunityId: String(parsed?.summary?.best_opportunity_id ?? '').slice(0, 50),
        worstOpportunityId: String(parsed?.summary?.worst_opportunity_id ?? '').slice(0, 50),
        profitabilityScore: Math.max(0, Math.min(100, Number(parsed?.summary?.profitability_score ?? 60))),
        biggestRisk: String(parsed?.summary?.biggest_risk ?? '').slice(0, 200),
        quickestWin: String(parsed?.summary?.quickest_win ?? '').slice(0, 200),
        budgetRecommendation: String(parsed?.summary?.budget_recommendation ?? '').slice(0, 300),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, predictor });
  } catch (e: any) { logger.error("/api/ai/profit-margin-predictor", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
