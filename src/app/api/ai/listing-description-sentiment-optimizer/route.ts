// v6.53: AI Listing Description Sentiment Optimizer — optimizira opise za max emotional response
// POST /api/ai/listing-description-sentiment-optimizer
// Body: { tradeId?: string, listingId?: string }
// Returns: { ok, optimizer: { listings, sentimentAnalysis, optimizations, abTestPlan, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

interface SentimentFactor {
  trust: number;
  urgency: number;
  excitement: number;
  scarcity: number;
  socialProof: number;
  emotional: number;
  professional: number;
  persuasive: number;
}

// Hevristika za sentiment analizo besedila
function analyzeSentiment(text: string): SentimentFactor {
  const t = text.toLowerCase();

  // Trust keywords
  const trustWords = ['zaupanje', 'garancija', 'original', 'preverjeno', 'redno', 'zanesljiv', 'kvalitetno'];
  const trustScore = Math.min(100, trustWords.filter(w => t.includes(w)).length * 20);

  // Urgency keywords
  const urgencyWords = ['danes', 'zdaj', 'nujno', 'hitro', 'takoj', 'omejeno', 'samo še', 'edini'];
  const urgencyScore = Math.min(100, urgencyWords.filter(w => t.includes(w)).length * 25);

  // Excitement keywords
  const excitementWords = ['neverjetno', 'super', 'odlično', 'fenomenalno', 'prefino', 'wow', 'edinstveno', 'redko'];
  const excitementScore = Math.min(100, excitementWords.filter(w => t.includes(w)).length * 20);

  // Scarcity keywords
  const scarcityWords = ['redko', 'limited', 'edinstveno', 'zadnji', 'edini', 'original', 'vintage'];
  const scarcityScore = Math.min(100, scarcityWords.filter(w => t.includes(w)).length * 20);

  // Social proof keywords
  const socialWords = ['popularno', 'bestseller', 'top', 'priljubljeno', 'zahtevano', 'priporočeno'];
  const socialScore = Math.min(100, socialWords.filter(w => t.includes(w)).length * 25);

  // Emotional keywords
  const emotionalWords = ['darilo', 'spomin', 'ljubezen', 'družina', 'otrok', 'nostalgija', 'sanje', 'sreča'];
  const emotionalScore = Math.min(100, emotionalWords.filter(w => t.includes(w)).length * 20);

  // Professional keywords
  const profWords = ['specifikacije', 'dimenzije', 'stanje', 'leto', 'model', 'garancija', 'certifikat'];
  const professionalScore = Math.min(100, profWords.filter(w => t.includes(w)).length * 15);

  // Persuasive keywords
  const persuWords = ['prihranek', 'popust', 'ceneje', 'ugodno', 'priložnost', 'deal', 'akcija'];
  const persuasiveScore = Math.min(100, persuWords.filter(w => t.includes(w)).length * 20);

  return {
    trust: trustScore, urgency: urgencyScore, excitement: excitementScore,
    scarcity: scarcityScore, socialProof: socialScore, emotional: emotionalScore,
    professional: professionalScore, persuasive: persuasiveScore,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const listingId = body?.listingId ? String(body.listingId) : null;

    let targetListings: Array<{
      id: string; title: string; description: string; category: string;
      price: number; estValue: number; imageUrl: string;
    }> = [];

    if (tradeId) {
      const t = await db.trade.findUnique({
        where: { id: tradeId },
        select: {
          id: true, title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true, price: true } },
        },
      });
      if (!t) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
      targetListings = [{
        id: t.id, title: t.title, category: t.category || 'drugo',
        description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 800),
        price: t.listing?.price ?? Math.round(t.buyPrice * 1.25),
        estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
        imageUrl: t.listing?.imageUrl ?? '',
      }];
    } else if (listingId) {
      const l = await db.listing.findUnique({
        where: { id: listingId },
        select: { id: true, title: true, description: true, detailDescription: true, price: true, imageUrl: true, aiEstimatedValue: true },
      });
      if (!l) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      targetListings = [{
        id: l.id, title: l.title, category: '',
        description: (l.detailDescription || l.description || '').slice(0, 800),
        price: l.price ?? 0, estValue: l.aiEstimatedValue ?? l.price ?? 0,
        imageUrl: l.imageUrl ?? '',
      }];
    } else {
      // Pridobi held trades z opisi
      const heldTrades = await db.trade.findMany({
        where: { status: 'held' },
        select: {
          id: true, title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true, price: true } },
        },
        take: 15,
        orderBy: { buyDate: 'desc' },
      });
      targetListings = heldTrades.map(t => ({
        id: t.id, title: t.title, category: t.category || 'drugo',
        description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 800),
        price: t.listing?.price ?? Math.round(t.buyPrice * 1.25),
        estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
        imageUrl: t.listing?.imageUrl ?? '',
      }));
    }

    if (targetListings.length === 0) {
      return NextResponse.json({ ok: true, optimizer: null, message: 'Ni listingov za sentiment analizo.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // Sentiment analiza za vsak listing
    const itemsWithSentiment = targetListings.map(l => {
      const sentiment = analyzeSentiment(l.description);
      const overallScore = Math.round(
        (sentiment.trust * 0.15) + (sentiment.urgency * 0.10) + (sentiment.excitement * 0.15) +
        (sentiment.scarcity * 0.10) + (sentiment.socialProof * 0.10) + (sentiment.emotional * 0.15) +
        (sentiment.professional * 0.15) + (sentiment.persuasive * 0.10)
      );
      return { ...l, sentiment, overallScore };
    });

    const itemsStr = itemsWithSentiment.slice(0, 15).map(i =>
      `- [${i.id}] "${i.title}" | ${i.category} | ${i.price}€ | trust ${i.sentiment.trust}/100 urgency ${i.sentiment.urgency}/100 excitement ${i.sentiment.excitement}/100 scarcity ${i.sentiment.scarcity}/100 social ${i.sentiment.socialProof}/100 emotional ${i.sentiment.emotional}/100 prof ${i.sentiment.professional}/100 persu ${i.sentiment.persuasive}/100 | overall ${i.overallScore}/100\n  OPIS: ${i.description.slice(0, 200)}...`
    ).join('\n');

    const prompt = `Si AI listing description sentiment optimizer za slovenske oglasne platforme.
Analiziraj sentiment opisov in predlagaj optimizacije za maksimalen emotional response.

OGLASI ZA ANALIZO (${itemsWithSentiment.length}):
${itemsStr}

8 sentiment faktorjev (0-100):
1. TRUST — zaupanje (garancija, original, preverjeno)
2. URGENCY — nujnost (danes, zdaj, omejeno)
3. EXCITEMENT — navdušenje (super, odlično, neverjetno)
4. SCARCITY — redkost (redko, edinstveno, zadnji)
5. SOCIAL_PROOF — socialno dokazilo (popularno, bestseller, top)
6. EMOTIONAL — čustvena povezava (darilo, spomin, družina)
7. PROFESSIONAL — profesionalnost (specifikacije, stanje, model)
8. PERSUASIVE — prepričljivost (popust, prihranek, deal)

Optimizacijske strategije:
1. ADD_TRUST: dodaj garancijo, certifikat, odkrito komunikacijo
2. ADD_URGENCY: časovna omejitev, "danes ugodneje"
3. ADD_EXCITEMENT: superlativi, čustvene besede
4. ADD_SCARCITY: omeni redkost, limited edition
5. ADD_SOCIAL_PROOF: omeni popularnost, povpraševanje
6. ADD_EMOTIONAL: poveži z darilom, spominom, družino
7. ADD_PROFESSIONAL: dodaj specifikacije, tehnične podrobnosti
8. ADD_PERSUASIVE: omeni popust, prihranek, value
9. RESTRUCTURE: boljša struktura (hook, body, CTA)
10. REMOVE_NEGATIVE: odstrani negotovne besede (morda, verjetno, mislim)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "id": "<listing_id>",
      "title": "<naslov>",
      "current_sentiment": {
        "trust": <number>, "urgency": <number>, "excitement": <number>,
        "scarcity": <number>, "social_proof": <number>, "emotional": <number>,
        "professional": <number>, "persuasive": <number>, "overall": <number>
      },
      "optimized_sentiment": {
        "trust": <number>, "urgency": <number>, "excitement": <number>,
        "scarcity": <number>, "social_proof": <number>, "emotional": <number>,
        "professional": <number>, "persuasive": <number>, "overall": <number>
      },
      "improvement_pct": <number>,
      "current_description": "<max 500 znakov>",
      "optimized_description": "<max 800 znakov>",
      "key_changes": ["<max 100 znakov>"],
      "expected_engagement_increase_pct": <number>,
      "expected_conversion_increase_pct": <number>,
      "buyer_emotional_response": "<curious|excited|trusted|urgent|indifferent|skeptical>"
    }
  ],
  "sentiment_analysis": [
    { "factor": "<trust|urgency|excitement|scarcity|social_proof|emotional|professional|persuasive>", "avg_score": <number 0-100>, "benchmark": <number 0-100>, "gap_pct": <number>, "improvement_potential": "<high|medium|low>", "tactic": "<max 120 znakov>" }
  ],
  "optimizations": [
    { "strategy": "<add_trust|add_urgency|add_excitement|add_scarcity|add_social_proof|add_emotional|add_professional|add_persuasive|restructure|remove_negative>", "description": "<max 120 znakov>", "best_for_factor": "<factor>", "expected_lift_pct": <number>, "implementation_effort": "<low|medium|high>", "example_phrase": "<max 150 znakov>" }
  ],
  "ab_test_plan": [
    {
      "listing_id": "<id>",
      "variant_a_description": "<original ali modified>",
      "variant_a_focus": "<factor>",
      "variant_b_description": "<modified>",
      "variant_b_focus": "<factor>",
      "test_duration_days": <number>,
      "primary_metric": "<views|inquiries|conversion_rate|time_to_sell>",
      "expected_winner": "<a|b>",
      "success_threshold_pct": <number>
    }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "factor_targeted": "<factor|all>", "expected_conversion_lift_pct": <number>, "listings_affected": <number> }
  ],
  "summary": {
    "total_listings_analyzed": <number>,
    "avg_current_overall_score": <number>,
    "avg_optimized_overall_score": <number>,
    "avg_improvement_pct": <number>,
    "weakest_factor": "<max 80 znakov>",
    "strongest_factor": "<max 80 znakov>",
    "biggest_opportunity_factor": "<max 80 znakov>",
    "avg_expected_conversion_increase_pct": <number>,
    "sentiment_optimization_score": <number 0-100>
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
    const validIds = new Set(itemsWithSentiment.map(i => i.id));

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      listings: (parsed?.listings || [])
        .filter((l: any) => validIds.has(String(l?.id ?? '')))
        .slice(0, 15)
        .map((l: any) => {
          const orig = itemsWithSentiment.find(x => x.id === String(l?.id));
          return {
            listingId: String(l?.id ?? ''),
            title: String(l?.title ?? orig?.title ?? '').slice(0, 150),
            currentSentiment: {
              trust: Math.max(0, Math.min(100, Number(l?.current_sentiment?.trust ?? orig?.sentiment.trust ?? 0))),
              urgency: Math.max(0, Math.min(100, Number(l?.current_sentiment?.urgency ?? orig?.sentiment.urgency ?? 0))),
              excitement: Math.max(0, Math.min(100, Number(l?.current_sentiment?.excitement ?? orig?.sentiment.excitement ?? 0))),
              scarcity: Math.max(0, Math.min(100, Number(l?.current_sentiment?.scarcity ?? orig?.sentiment.scarcity ?? 0))),
              socialProof: Math.max(0, Math.min(100, Number(l?.current_sentiment?.social_proof ?? orig?.sentiment.socialProof ?? 0))),
              emotional: Math.max(0, Math.min(100, Number(l?.current_sentiment?.emotional ?? orig?.sentiment.emotional ?? 0))),
              professional: Math.max(0, Math.min(100, Number(l?.current_sentiment?.professional ?? orig?.sentiment.professional ?? 0))),
              persuasive: Math.max(0, Math.min(100, Number(l?.current_sentiment?.persuasive ?? orig?.sentiment.persuasive ?? 0))),
              overall: Math.max(0, Math.min(100, Number(l?.current_sentiment?.overall ?? orig?.overallScore ?? 0))),
            },
            optimizedSentiment: {
              trust: Math.max(0, Math.min(100, Number(l?.optimized_sentiment?.trust ?? 0))),
              urgency: Math.max(0, Math.min(100, Number(l?.optimized_sentiment?.urgency ?? 0))),
              excitement: Math.max(0, Math.min(100, Number(l?.optimized_sentiment?.excitement ?? 0))),
              scarcity: Math.max(0, Math.min(100, Number(l?.optimized_sentiment?.scarcity ?? 0))),
              socialProof: Math.max(0, Math.min(100, Number(l?.optimized_sentiment?.social_proof ?? 0))),
              emotional: Math.max(0, Math.min(100, Number(l?.optimized_sentiment?.emotional ?? 0))),
              professional: Math.max(0, Math.min(100, Number(l?.optimized_sentiment?.professional ?? 0))),
              persuasive: Math.max(0, Math.min(100, Number(l?.optimized_sentiment?.persuasive ?? 0))),
              overall: Math.max(0, Math.min(100, Number(l?.optimized_sentiment?.overall ?? 0))),
            },
            improvementPct: Math.round(Number(l?.improvement_pct ?? 0) * 10) / 10,
            currentDescription: String(l?.current_description ?? orig?.description ?? '').slice(0, 800),
            optimizedDescription: String(l?.optimized_description ?? '').slice(0, 1200),
            keyChanges: (l?.key_changes || []).slice(0, 6).map((c: any) => String(c).slice(0, 200)),
            expectedEngagementIncreasePct: Math.round(Number(l?.expected_engagement_increase_pct ?? 0)),
            expectedConversionIncreasePct: Math.round(Number(l?.expected_conversion_increase_pct ?? 0)),
            buyerEmotionalResponse: ['curious', 'excited', 'trusted', 'urgent', 'indifferent', 'skeptical'].includes(String(l?.buyer_emotional_response)) ? String(l.buyer_emotional_response) : 'curious',
          };
        }),
      sentimentAnalysis: (parsed?.sentiment_analysis || []).slice(0, 8).map((s: any) => ({
        factor: ['trust', 'urgency', 'excitement', 'scarcity', 'social_proof', 'emotional', 'professional', 'persuasive'].includes(String(s?.factor)) ? String(s.factor) : 'trust',
        avgScore: Math.max(0, Math.min(100, Number(s?.avg_score ?? 0))),
        benchmark: Math.max(0, Math.min(100, Number(s?.benchmark ?? 50))),
        gapPct: Math.round(Number(s?.gap_pct ?? 0) * 10) / 10,
        improvementPotential: ['high', 'medium', 'low'].includes(String(s?.improvement_potential)) ? String(s.improvement_potential) : 'medium',
        tactic: String(s?.tactic ?? '').slice(0, 250),
      })),
      optimizations: (parsed?.optimizations || []).slice(0, 10).map((o: any) => ({
        strategy: ['add_trust', 'add_urgency', 'add_excitement', 'add_scarcity', 'add_social_proof', 'add_emotional', 'add_professional', 'add_persuasive', 'restructure', 'remove_negative'].includes(String(o?.strategy)) ? String(o.strategy) : 'add_trust',
        description: String(o?.description ?? '').slice(0, 250),
        bestForFactor: String(o?.best_for_factor ?? '').slice(0, 50),
        expectedLiftPct: Math.round(Number(o?.expected_lift_pct ?? 0)),
        implementationEffort: ['low', 'medium', 'high'].includes(String(o?.implementation_effort)) ? String(o.implementation_effort) : 'low',
        examplePhrase: String(o?.example_phrase ?? '').slice(0, 300),
      })),
      abTestPlan: (parsed?.ab_test_plan || [])
        .filter((t: any) => validIds.has(String(t?.listing_id ?? '')))
        .slice(0, 15)
        .map((t: any) => ({
          listingId: String(t?.listing_id ?? '').slice(0, 50),
          variantADescription: String(t?.variant_a_description ?? '').slice(0, 800),
          variantAFocus: String(t?.variant_a_focus ?? '').slice(0, 50),
          variantBDescription: String(t?.variant_b_description ?? '').slice(0, 800),
          variantBFocus: String(t?.variant_b_focus ?? '').slice(0, 50),
          testDurationDays: Math.max(1, Math.min(30, Number(t?.test_duration_days ?? 7))),
          primaryMetric: ['views', 'inquiries', 'conversion_rate', 'time_to_sell'].includes(String(t?.primary_metric)) ? String(t.primary_metric) : 'conversion_rate',
          expectedWinner: ['a', 'b'].includes(String(t?.expected_winner)) ? String(t.expected_winner) : 'b',
          successThresholdPct: Math.round(Number(t?.success_threshold_pct ?? 5)),
        })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        factorTargeted: String(r?.factor_targeted ?? 'all').slice(0, 50),
        expectedConversionLiftPct: Math.round(Number(r?.expected_conversion_lift_pct ?? 0)),
        listingsAffected: Math.max(0, Number(r?.listings_affected ?? 0)),
      })),
      summary: {
        totalListingsAnalyzed: itemsWithSentiment.length,
        avgCurrentOverallScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_current_overall_score ?? Math.round(itemsWithSentiment.reduce((s, i) => s + i.overallScore, 0) / Math.max(1, itemsWithSentiment.length))))),
        avgOptimizedOverallScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_optimized_overall_score ?? 0))),
        avgImprovementPct: Math.round(Number(parsed?.summary?.avg_improvement_pct ?? 0) * 10) / 10,
        weakestFactor: String(parsed?.summary?.weakest_factor ?? '').slice(0, 150),
        strongestFactor: String(parsed?.summary?.strongest_factor ?? '').slice(0, 150),
        biggestOpportunityFactor: String(parsed?.summary?.biggest_opportunity_factor ?? '').slice(0, 150),
        avgExpectedConversionIncreasePct: Math.round(Number(parsed?.summary?.avg_expected_conversion_increase_pct ?? 0)),
        sentimentOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.sentiment_optimization_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
