// v6.27: AI Listing Quality Score Aggregator — agregira vse AI ocene v eno skupno
// POST /api/ai/quality-aggregator
// Body: { listingId?: string }
// Returns: { ok, aggregate: { overallScore, breakdown: [], strengths, weaknesses, comparisonToSimilar, recommendation } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId } = body;

    if (!listingId) {
      return NextResponse.json({ error: 'listingId je obvezen' }, { status: 400 });
    }

    const listing = await db.listing.findUnique({
      where: { id: String(listingId) },
      select: {
        id: true, title: true, price: true, priceText: true, description: true,
        detailDescription: true, imageUrl: true, location: true,
        aiScore: true, aiRisk: true, aiVerdict: true, aiReason: true,
        aiEstimatedValue: true, aiImageAnalysis: true, aiImageVerdict: true,
        dealScore: true, dealScoreReason: true,
        sellerName: true, sellerListingCount: true,
        postedAt: true, firstSeenAt: true, previousPrice: true, priceDroppedAt: true,
        monitor: { select: { source: true, name: true } },
      },
    });

    if (!listing) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });

    // 1. Podobni listingi za benchmark
    const similar = await db.listing.findMany({
      where: {
        price: { gte: Math.floor((listing.price ?? 100) * 0.7), lte: Math.ceil((listing.price ?? 100) * 1.3) },
        isHidden: false,
        id: { not: listing.id },
      },
      select: { dealScore: true, aiScore: true, aiRisk: true, price: true, aiVerdict: true },
      take: 30,
    });

    const avgDealScore = similar.length > 0 ? Math.round(similar.reduce((s, l) => s + (l.dealScore ?? 0), 0) / similar.length) : 50;
    const avgAiScore = similar.length > 0 ? Math.round(similar.reduce((s, l) => s + (l.aiScore ?? 0), 0) / similar.length) : 5;
    const avgAiRisk = similar.length > 0 ? Math.round(similar.reduce((s, l) => s + (l.aiRisk ?? 0), 0) / similar.length) : 5;
    const opportunityPct = similar.length > 0 ? Math.round(similar.filter(l => l.aiVerdict === 'PRILIKA').length / similar.length * 100) : 0;

    // 2. AI agregacija vseh ocen
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za agregacijo AI ocen in vrednotenje kakovosti oglasov.
Združi vse AI ocene tega oglasa v eno skupno oceno kakovosti.

NASLOV: ${listing.title}
CENA: ${listing.priceText || (listing.price + ' EUR')}
LOKACIJA: ${listing.location}
VIR: ${listing.monitor?.source || 'neznan'}
STAROST: ${listing.postedAt ? Math.round((Date.now() - listing.postedAt.getTime()) / (24*60*60*1000)) : 0} dni

AI OCENE:
- AI Score (1-10): ${listing.aiScore ?? 'neznan'}
- AI Risk (1-10): ${listing.aiRisk ?? 'neznan'}
- AI Verdict: ${listing.aiVerdict ?? 'neznan'}
- AI Reason: ${listing.aiReason ?? 'neznan'}
- AI Est. Value: ${listing.aiEstimatedValue ?? 'neznan'}€
- Deal Score (0-100): ${listing.dealScore ?? 'neznan'}
- Deal Score Reason: ${listing.dealScoreReason ?? 'neznan'}
- Image Verdict: ${listing.aiImageVerdict ?? 'neznan'}
- Image Analysis: ${listing.aiImageAnalysis ?? 'neznan'}

PRODAJALEC:
- Ime: ${listing.sellerName ?? 'neznan'}
- Število oglasov: ${listing.sellerListingCount}

BENCHMARK (podobni oglasi):
- Povp. deal score: ${avgDealScore}/100
- Povp. AI score: ${avgAiScore}/10
- Povp. AI risk: ${avgAiRisk}/10
- % priložnosti: ${opportunityPct}%

${listing.previousPrice ? `CENA PADLA: ${listing.previousPrice}€ → ${listing.price}€` : 'Brez padca cene'}

Izračunaj skupno oceno (0-100) kot ponderirano povprečje:
- Deal Score: 35% utež
- AI Score (×10): 20% utež
- AI Risk (inverzno, (11-risk)×10): 15% utež
- Image quality: 10% utež
- Seller reputation: 10% utež
- Price vs est. value: 10% utež

Odgovori LE z JSON:
{
  "overall_score": <number 0-100>,
  "grade": "<A+|A|B+|B|C+|C|D|F>",
  "breakdown": [
    { "factor": "<deal_score|ai_score|ai_risk|image_quality|seller_reputation|price_value>", "score": <number 0-100>, "weight_pct": <number>, "contribution": <number> }
  ],
  "strengths": ["<prednost, max 80 znakov>", "..."],
  "weaknesses": ["<šibkost, max 80 znakov>", "..."],
  "comparison_to_similar": {
    "percentile": <number 0-100>,
    "better_than_pct": <number>,
    "worse_than_pct": <number>,
    "ranking": "<top_5|top_10|top_25|average|bottom_25|bottom_10>"
  },
  "price_analysis": {
    "list_price_eur": <number>,
    "estimated_value_eur": <number>,
    "discount_pct": <number>,
    "is_good_deal": <boolean>,
    "fair_price_eur": <number>
  },
  "recommendation": "<buy_now|buy_with_caution|monitor|wait|avoid>",
  "action_items": ["<konkretno dejanje, max 100 znakov>", "..."],
  "reasoning": "<max 200 znakov>"
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);

    const aggregate = {
      overallScore: Math.max(0, Math.min(100, Number(parsed?.overall_score ?? 50))),
      grade: ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F'].includes(String(parsed?.grade)) ? String(parsed.grade) : 'C',
      breakdown: (parsed?.breakdown || []).slice(0, 8).map((b: any) => ({
        factor: String(b?.factor ?? '').slice(0, 50),
        score: Math.max(0, Math.min(100, Number(b?.score ?? 50))),
        weightPct: Math.max(0, Math.min(100, Number(b?.weight_pct ?? 0))),
        contribution: Math.round(Number(b?.contribution ?? 0)),
      })),
      strengths: (parsed?.strengths || []).slice(0, 5).map((s: any) => String(s).slice(0, 150)),
      weaknesses: (parsed?.weaknesses || []).slice(0, 5).map((w: any) => String(w).slice(0, 150)),
      comparisonToSimilar: {
        percentile: Math.max(0, Math.min(100, Number(parsed?.comparison_to_similar?.percentile ?? 50))),
        betterThanPct: Math.max(0, Math.min(100, Number(parsed?.comparison_to_similar?.better_than_pct ?? 50))),
        worseThanPct: Math.max(0, Math.min(100, Number(parsed?.comparison_to_similar?.worse_than_pct ?? 50))),
        ranking: ['top_5', 'top_10', 'top_25', 'average', 'bottom_25', 'bottom_10'].includes(String(parsed?.comparison_to_similar?.ranking))
          ? String(parsed.comparison_to_similar.ranking) : 'average',
      },
      priceAnalysis: {
        listPriceEur: Math.max(0, Number(parsed?.price_analysis?.list_price_eur ?? listing.price ?? 0)),
        estimatedValueEur: Math.max(0, Number(parsed?.price_analysis?.estimated_value_eur ?? listing.aiEstimatedValue ?? 0)),
        discountPct: Math.round(Number(parsed?.price_analysis?.discount_pct ?? 0)),
        isGoodDeal: Boolean(parsed?.price_analysis?.is_good_deal ?? false),
        fairPriceEur: Math.max(0, Number(parsed?.price_analysis?.fair_price_eur ?? 0)),
      },
      recommendation: ['buy_now', 'buy_with_caution', 'monitor', 'wait', 'avoid'].includes(String(parsed?.recommendation))
        ? String(parsed.recommendation) : 'monitor',
      actionItems: (parsed?.action_items || []).slice(0, 5).map((a: any) => String(a).slice(0, 200)),
      reasoning: String(parsed?.reasoning ?? '').slice(0, 400),
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, aggregate, listing: { id: listing.id, title: listing.title, price: listing.price } });
  } catch (e: any) {
    logger.error("/api/ai/quality-aggregator", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
