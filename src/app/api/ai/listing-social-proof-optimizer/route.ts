// v6.77: AI Listing Social Proof Optimizer — ML optimizacija social proof elementov z trust building
// POST /api/ai/listing-social-proof-optimizer
// Body: { tradeId?: string }
// Returns: { ok, optimizer: { listings, proofElements, trustSignals, optimizations, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const PROOF_TYPES = ['testimonials', 'review_count', 'seller_rating', 'sales_history', 'social_mentions', 'view_count', 'saved_count', 'shared_count', 'repeat_buyers', 'certification_badges'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades = await db.trade.findMany({ where, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, price: true, description: true, detailDescription: true, sellerName: true, sellerListingCount: true, location: true } } }, take: tradeId ? 1 : 15 });
    if (heldTrades.length === 0) return NextResponse.json({ ok: true, optimizer: null, message: 'Ni held tradeov za social proof optimizacijo.' });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const items = heldTrades.map(t => ({ id: t.id, title: t.title, category: t.category || 'drugo', price: t.listing?.price ?? Math.round(t.buyPrice * 1.25), sellerName: t.listing?.sellerName ?? '', sellerListingCount: t.listing?.sellerListingCount ?? 0, description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 200) }));
    const itemsStr = items.slice(0, 15).map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.price}€ | seller: ${i.sellerName || 'nepoznan'} (${i.sellerListingCount} listingov)`).join('\n');

    const prompt = `Si AI listing social proof optimizer z ML in trust building.
Optimizira social proof elemente za večje zaupanje in konverzijo.

OGLASI (${items.length}):
${itemsStr}

10 social proof tipov:
1. TESTIMONIALS: pričevanja zadovoljnih kupcev
2. REVIEW_COUNT: število review-ov
3. SELLER_RATING: rating prodajalca
4. SALES_HISTORY: zgodovina prodaj
5. SOCIAL_MENTIONS: omenjanja na socialnih medijih
6. VIEW_COUNT: število ogledov
7. SAVED_COUNT: število shranitev
8. SHARED_COUNT: število deljenj
9. REPEAT_BUYERS: ponavljajoči kupci
10. CERTIFICATION_BADGES: certifikati in značke

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    { "id": "<trade_id>", "title": "<naslov>", "current_social_proof_score": <number 0-100>, "optimized_social_proof_score": <number 0-100>, "proof_elements": [{"proof_type": "<10 tipov>", "current_score": <number 0-100>, "optimized_score": <number 0-100>, "available": <boolean>, "implementation": "<max 120 znakov>"}], "trust_level": "<low|medium|high|very_high>", "recommended_proof_additions": ["<max 100 znakov>"], "expected_trust_increase_pct": <number>, "expected_conversion_increase_pct": <number>, "priority": "<high|medium|low>" }
  ],
  "proofElements": [
    { "proof_type": "<10 tipov>", "weight": <number 0-100>, "avg_score": <number 0-100>, "benchmark": <number 0-100>, "implementation_difficulty": "<low|medium|high>", "best_practice": "<max 120 znakov>", "example_implementation": "<max 150 znakov>" }
  ],
  "trustSignals": [
    { "signal": "<max 80 znakov>", "signal_type": "<authority|consensus|scarcity|reciprocity|commitment|liking>", "impact_on_trust_pct": <number 0-100>, "implementation_cost_eur": <number>, "expected_conversion_lift_pct": <number>, "priority": "<high|medium|low>" }
  ],
  "optimizations": [
    { "optimization_type": "<testimonial_addition|review_request|badge_display|history_highlight|social_integration|view_counter|save_prompt|share_incentive|loyalty_display|certification_showcase>", "description": "<max 120 znakov>", "expected_trust_lift_pct": <number>, "expected_conversion_lift_pct": <number>, "implementation_effort": "<low|medium|high>", "timeframe_hours": <number> }
  ],
  "mlModels": [
    { "model": "<gradient_boosting|neural_network|random_forest|deep_learning|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<trust_score|conversion_probability|engagement_lift|proof_effectiveness>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_listings_analyzed": <number>, "avg_current_proof_score": <number>, "avg_optimized_proof_score": <number>,
    "biggest_proof_gap": "<max 100 znakov>", "quickest_proof_win": "<max 100 znakov>",
    "best_proof_type": "<10 tipov>", "social_proof_optimization_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);
    const validIds = new Set(items.map(i => i.id));

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      listings: (parsed?.listings || []).filter((l: any) => validIds.has(String(l?.id ?? ''))).slice(0, 15).map((l: any) => ({ tradeId: String(l?.id ?? ''), title: String(l?.title ?? '').slice(0, 150), currentSocialProofScore: Math.max(0, Math.min(100, Number(l?.current_social_proof_score ?? 30))), optimizedSocialProofScore: Math.max(0, Math.min(100, Number(l?.optimized_social_proof_score ?? 65))), proofElements: (l?.proof_elements || []).slice(0, 10).map((p: any) => ({ proofType: PROOF_TYPES.includes(String(p?.proof_type) as any) ? String(p.proof_type) : 'testimonials', currentScore: Math.max(0, Math.min(100, Number(p?.current_score ?? 30))), optimizedScore: Math.max(0, Math.min(100, Number(p?.optimized_score ?? 60))), available: Boolean(p?.available ?? false), implementation: String(p?.implementation ?? '').slice(0, 250) })), trustLevel: ['low', 'medium', 'high', 'very_high'].includes(String(l?.trust_level)) ? String(l.trust_level) : 'medium', recommendedProofAdditions: (l?.recommended_proof_additions || []).slice(0, 5).map((r: any) => String(r).slice(0, 200)), expectedTrustIncreasePct: Math.round(Number(l?.expected_trust_increase_pct ?? 0) * 10) / 10, expectedConversionIncreasePct: Math.round(Number(l?.expected_conversion_increase_pct ?? 0) * 10) / 10, priority: ['high', 'medium', 'low'].includes(String(l?.priority)) ? String(l.priority) : 'medium' })),
      proofElements: (parsed?.proofElements || []).slice(0, 10).map((p: any) => ({ proofType: PROOF_TYPES.includes(String(p?.proof_type) as any) ? String(p.proof_type) : 'testimonials', weight: Math.max(0, Math.min(100, Number(p?.weight ?? 10))), avgScore: Math.max(0, Math.min(100, Number(p?.avg_score ?? 30))), benchmark: Math.max(0, Math.min(100, Number(p?.benchmark ?? 50))), implementationDifficulty: ['low', 'medium', 'high'].includes(String(p?.implementation_difficulty)) ? String(p.implementation_difficulty) : 'medium', bestPractice: String(p?.best_practice ?? '').slice(0, 250), exampleImplementation: String(p?.example_implementation ?? '').slice(0, 300) })),
      trustSignals: (parsed?.trustSignals || []).slice(0, 10).map((t: any) => ({ signal: String(t?.signal ?? '').slice(0, 150), signalType: ['authority', 'consensus', 'scarcity', 'reciprocity', 'commitment', 'liking'].includes(String(t?.signal_type)) ? String(t.signal_type) : 'authority', impactOnTrustPct: Math.max(0, Math.min(100, Number(t?.impact_on_trust_pct ?? 50))), implementationCostEur: Math.round(Number(t?.implementation_cost_eur ?? 0)), expectedConversionLiftPct: Math.round(Number(t?.expected_conversion_lift_pct ?? 0) * 10) / 10, priority: ['high', 'medium', 'low'].includes(String(t?.priority)) ? String(t.priority) : 'medium' })),
      optimizations: (parsed?.optimizations || []).slice(0, 10).map((o: any) => ({ optimizationType: ['testimonial_addition', 'review_request', 'badge_display', 'history_highlight', 'social_integration', 'view_counter', 'save_prompt', 'share_incentive', 'loyalty_display', 'certification_showcase'].includes(String(o?.optimization_type)) ? String(o.optimization_type) : 'testimonial_addition', description: String(o?.description ?? '').slice(0, 250), expectedTrustLiftPct: Math.round(Number(o?.expected_trust_lift_pct ?? 0) * 10) / 10, expectedConversionLiftPct: Math.round(Number(o?.expected_conversion_lift_pct ?? 0) * 10) / 10, implementationEffort: ['low', 'medium', 'high'].includes(String(o?.implementation_effort)) ? String(o.implementation_effort) : 'low', timeframeHours: Math.max(0.5, Number(o?.timeframe_hours ?? 1)) })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['gradient_boosting', 'neural_network', 'random_forest', 'deep_learning', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['trust_score', 'conversion_probability', 'engagement_lift', 'proof_effectiveness'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'trust_score', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { totalListingsAnalyzed: items.length, avgCurrentProofScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_current_proof_score ?? 30))), avgOptimizedProofScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_optimized_proof_score ?? 65))), biggestProofGap: String(parsed?.summary?.biggest_proof_gap ?? '').slice(0, 200), quickestProofWin: String(parsed?.summary?.quickest_proof_win ?? '').slice(0, 200), bestProofType: PROOF_TYPES.includes(String(parsed?.summary?.best_proof_type) as any) ? String(parsed.summary.best_proof_type) : 'testimonials', socialProofOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.social_proof_optimization_score ?? 60))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
