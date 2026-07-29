// v6.80: AI Listing Seasonality Optimizer — ML optimizacija oglasov glede na sezonskost
// POST /api/ai/listing-seasonality-optimizer
// Body: { tradeId?: string, monthsAhead?: number }
// Returns: { ok, optimizer: { listing, seasonalityProfile, peakWindows, recommendations, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const SEASON_TYPES = ['holiday', 'back_to_school', 'summer', 'winter', 'spring_cleaning', 'black_friday', 'christmas', 'easter', 'tax_season', 'wedding_season'] as const;
const DEMAND_LEVELS = ['peak', 'high', 'medium', 'low', 'off_season'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId).trim() : null;
    const monthsAhead = Math.max(1, Math.min(12, Number(body?.monthsAhead ?? 3)));

    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyDate: true, buyLocation: true, notes: true, listingId: true }, take: 200, orderBy: { buyDate: 'desc' } });
    if (heldTrades.length === 0) return NextResponse.json({ ok: true, optimizer: null, message: 'Ni aktivnih oglasov za sezonsko analizo.' });

    const target = heldTrades.find(t => t.id === tradeId) ?? heldTrades[0];
    const targetListing = target.listingId ? await db.listing.findUnique({ where: { id: target.listingId }, select: { aiEstimatedValue: true, aiRisk: true, url: true } }) : null;
    const suggestedPrice = targetListing?.aiEstimatedValue ?? Math.round(target.buyPrice * 1.25);

    // Historical sold trades for seasonality context
    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellDate: true }, take: 500, orderBy: { sellDate: 'desc' } });
    const now = new Date();
    const currentMonth = now.getMonth() + 1;

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const categoryHistory = soldTrades.filter(t => t.category === target.category).slice(0, 10).map(t => `- ${t.title} | ${t.sellPrice}€ | ${t.sellDate?.toISOString().slice(0, 7)}`).join('\n');

    const prompt = `Si AI listing seasonality optimizer z ML in time series forecasting.
Analizira sezonskost oglasov in predlaga optimalen čas za prodajo.

CILJNI OGLAS:
- Naslov: ${target.title}
- Kategorija: ${target.category}
- Nabavna cena: ${target.buyPrice}€
- Predlagana cena: ${suggestedPrice}€
- Kupljeno: ${target.buyDate.toISOString().slice(0, 10)}
- Trenutni mesec: ${currentMonth} (naprej ${monthsAhead} mesecev)

ZGODOVINA PRODAJ V KATEGORIJI:
${categoryHistory || 'brez'}

10 tipov sezon:
1. HOLIDAY: prazniki
2. BACK_TO_SCHOOL: šolsko leto
3. SUMMER: poletje
4. WINTER: zima
5. SPRING_CLEANING: pomladno čiščenje
6. BLACK_FRIDAY: black friday/cyber monday
7. CHRISTMAS: božič
8. EASTER: velika noč
9. TAX_SEASON: davčna sezona
10. WEDDING_SEASON: poročna sezona

5 nivojev povpraševanja: peak, high, medium, low, off_season

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listing": { "title": "<string>", "category": "<string>", "current_price_eur": <number>, "peak_season_price_eur": <number>, "off_season_price_eur": <number>, "seasonality_score": <number 0-100>, "optimal_sell_window": "<YYYY-MM>", "seasonality_grade": "<A|B|C|D|F>" },
  "seasonalityProfile": [
    { "month": <1-12>, "month_name": "<jan|feb|...>", "demand_level": "<${DEMAND_LEVELS.join('|')}>", "demand_pct": <number 0-100>, "avg_price_multiplier": <number 0.5-2.0>, "competition_level": "<high|medium|low>", "recommended_action": "<sell_now|hold|list|delist>" }
  ],
  "peakWindows": [
    { "season_type": "<${SEASON_TYPES.join('|')}>", "start_month": <1-12>, "end_month": <1-12>, "peak_month": <1-12>, "expected_demand_lift_pct": <number 0-100>, "expected_price_lift_pct": <number 0-50>, "days_until_peak": <number>, "preparation_days": <number> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "timing": "<immediate|within_7d|within_30d|within_90d>", "expected_revenue_lift_eur": <number>, "confidence_pct": <number 0-100>, "rationale": "<max 120 znakov>" }
  ],
  "mlModels": [
    { "model": "<prophet|lstm|arima|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<demand_forecast|price_forecast|seasonality_detection|trend_analysis>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "seasonality_optimization_score": <number 0-100>, "seasonality_grade": "<A|B|C|D|F>", "current_demand_level": "<${DEMAND_LEVELS.join('|')}>",
    "optimal_sell_month": "<YYYY-MM>", "expected_revenue_lift_eur": <number>,
    "biggest_seasonality_risk": "<max 100 znakov>", "biggest_seasonality_opportunity": "<max 100 znakov>",
    "quickest_seasonality_win": "<max 100 znakov>", "seasonality_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      listing: { title: String(parsed?.listing?.title ?? target.title).slice(0, 200), category: String(parsed?.listing?.category ?? target.category).slice(0, 50), currentPriceEur: Math.round(Number(parsed?.listing?.current_price_eur ?? target.buyPrice)), peakSeasonPriceEur: Math.round(Number(parsed?.listing?.peak_season_price_eur ?? suggestedPrice * 1.2)), offSeasonPriceEur: Math.round(Number(parsed?.listing?.off_season_price_eur ?? suggestedPrice * 0.85)), seasonalityScore: Math.max(0, Math.min(100, Number(parsed?.listing?.seasonality_score ?? 50))), optimalSellWindow: String(parsed?.listing?.optimal_sell_window ?? '').slice(0, 7), seasonalityGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.listing?.seasonality_grade)) ? String(parsed.listing.seasonality_grade) : 'C' },
      seasonalityProfile: (parsed?.seasonalityProfile || []).slice(0, 12).map((s: any) => ({ month: Math.max(1, Math.min(12, Number(s?.month ?? 1))), monthName: String(s?.month_name ?? '').slice(0, 3), demandLevel: (DEMAND_LEVELS as readonly string[]).includes(String(s?.demand_level)) ? String(s.demand_level) : 'medium', demandPct: Math.max(0, Math.min(100, Number(s?.demand_pct ?? 50))), avgPriceMultiplier: Math.max(0.5, Math.min(2.0, Number(s?.avg_price_multiplier ?? 1.0))), competitionLevel: ['high', 'medium', 'low'].includes(String(s?.competition_level)) ? String(s.competition_level) : 'medium', recommendedAction: ['sell_now', 'hold', 'list', 'delist'].includes(String(s?.recommended_action)) ? String(s.recommended_action) : 'hold' })),
      peakWindows: (parsed?.peakWindows || []).slice(0, 8).map((w: any) => ({ seasonType: (SEASON_TYPES as readonly string[]).includes(String(w?.season_type)) ? String(w.season_type) : 'holiday', startMonth: Math.max(1, Math.min(12, Number(w?.start_month ?? 1))), endMonth: Math.max(1, Math.min(12, Number(w?.end_month ?? 1))), peakMonth: Math.max(1, Math.min(12, Number(w?.peak_month ?? 1))), expectedDemandLiftPct: Math.max(0, Math.min(100, Number(w?.expected_demand_lift_pct ?? 20))), expectedPriceLiftPct: Math.max(0, Math.min(50, Number(w?.expected_price_lift_pct ?? 10))), daysUntilPeak: Math.max(0, Number(w?.days_until_peak ?? 30)), preparationDays: Math.max(1, Number(w?.preparation_days ?? 7)) })),
      recommendations: (parsed?.recommendations || []).slice(0, 8).map((r: any) => ({ action: String(r?.action ?? '').slice(0, 300), timing: ['immediate', 'within_7d', 'within_30d', 'within_90d'].includes(String(r?.timing)) ? String(r.timing) : 'within_30d', expectedRevenueLiftEur: Math.round(Number(r?.expected_revenue_lift_eur ?? 0)), confidencePct: Math.max(0, Math.min(100, Number(r?.confidence_pct ?? 60))), rationale: String(r?.rationale ?? '').slice(0, 250) })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['prophet', 'lstm', 'arima', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['demand_forecast', 'price_forecast', 'seasonality_detection', 'trend_analysis'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'demand_forecast', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { seasonalityOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.seasonality_optimization_score ?? 50))), seasonalityGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.seasonality_grade)) ? String(parsed.summary.seasonality_grade) : 'C', currentDemandLevel: (DEMAND_LEVELS as readonly string[]).includes(String(parsed?.summary?.current_demand_level)) ? String(parsed.summary.current_demand_level) : 'medium', optimalSellMonth: String(parsed?.summary?.optimal_sell_month ?? '').slice(0, 7), expectedRevenueLiftEur: Math.round(Number(parsed?.summary?.expected_revenue_lift_eur ?? 0)), biggestSeasonalityRisk: String(parsed?.summary?.biggest_seasonality_risk ?? '').slice(0, 200), biggestSeasonalityOpportunity: String(parsed?.summary?.biggest_seasonality_opportunity ?? '').slice(0, 200), quickestSeasonalityWin: String(parsed?.summary?.quickest_seasonality_win ?? '').slice(0, 200), seasonalityAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.seasonality_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
