// v7.63: Listing Exposure Score — oceni kako dobro je vsak HELD inventar
// "izpostavljen" kupcem (listing age, price competitiveness, contact activity,
// platform factors). Identificira item-e ki potrebujejo pozornost (stari listing-i,
// nekontaktirani, nekonkurenčne cene).
//
// Razlika od margin-guardian-pro (ki gleda margin-健康) — ta gleda EXPOSURE
// (bolj komercialna vidika). Razlika od listing-ctr-optimizer (ki gleda naslove
// in slike) — ta gleda celotno sliko: starost + cena + kontakt + deal score.
//
// "PS5 exposure 45/100 (AVERAGE) — listing 18d, price -5%, no contacts.
//  Action: add photos, drop 10%"
//
// Pure DB analytics (NO AI). GET /api/analytics/listing-exposure-score

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ExposureClass =
  | 'EXCELLENT'
  | 'GOOD'
  | 'AVERAGE'
  | 'POOR'
  | 'CRITICAL';

interface ExposureFactors {
  listingAgeDays: number;
  ageScore: number;
  priceCompetitiveness: number; // %
  priceScore: number;
  contactActivity: number; // 0 | 1 | 2
  activityScore: number;
  dealScore: number | null;
  dealScorePoints: number;
  hasImage: boolean;
  imageScore: number;
  titleLength: number;
  titleScore: number;
}

interface ExposureItem {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  aiEstimatedValue: number | null;
  exposureScore: number; // 0-100
  classification: ExposureClass;
  factors: ExposureFactors;
  recommendedActions: string[];
}

function classifyExposure(score: number): ExposureClass {
  if (score >= 80) return 'EXCELLENT';
  if (score >= 60) return 'GOOD';
  if (score >= 40) return 'AVERAGE';
  if (score >= 20) return 'POOR';
  return 'CRITICAL';
}

function ageScore(ageDays: number): number {
  if (ageDays < 7) return 30;
  if (ageDays < 14) return 25;
  if (ageDays < 30) return 15;
  if (ageDays < 60) return 5;
  return 0;
}

function priceScore(competitiveness: number): number {
  // competitiveness > 20% → 25, 10-20% → 20, 0-10% → 10, <0% → 5
  if (competitiveness > 20) return 25;
  if (competitiveness > 10) return 20;
  if (competitiveness > 0) return 10;
  return 5;
}

function activityScore(activity: number): number {
  if (activity >= 2) return 15;
  if (activity === 1) return 10;
  return 5;
}

function dealScorePoints(dealScore: number | null): number {
  if (dealScore == null) return 5; // neutral if missing
  if (dealScore > 70) return 15;
  if (dealScore >= 50) return 10;
  return 5;
}

function titlePoints(titleLength: number): number {
  if (titleLength >= 50 && titleLength <= 100) return 7;
  return 3;
}

export async function GET() {
  try {
    // 1) HELD trades with linked Listing
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyDate: true,
        imageUrl: true,
        listing: {
          select: {
            firstSeenAt: true,
            price: true,
            aiEstimatedValue: true,
            dealScore: true,
            isBookmarked: true,
            contactStatus: true,
            imageUrl: true,
            title: true,
          },
        },
      },
      take: 1000,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        items: [],
        summary: {
          totalItems: 0,
          excellent: 0,
          good: 0,
          average: 0,
          poor: 0,
          critical: 0,
          avgExposureScore: 0,
          needsAttention: 0,
        },
        message: 'Ni held inventarja — Exposure Score analiza ni mogoča.',
      });
    }

    const now = Date.now();
    const items: ExposureItem[] = heldTrades.map(t => {
      const listing = t.listing;
      // listingAgeDays: days since firstSeenAt (or buyDate fallback)
      const refDate = listing?.firstSeenAt ?? t.buyDate;
      const listingAgeDays = Math.max(
        0,
        Math.floor((now - new Date(refDate).getTime()) / 86_400_000),
      );

      // priceCompetitiveness: (aiEstimatedValue - price) / aiEstimatedValue × 100
      // Use trade buyPrice as the listed price proxy if listing.price is missing.
      const aiEstimatedValue =
        listing?.aiEstimatedValue && listing.aiEstimatedValue > 0
          ? listing.aiEstimatedValue
          : null;
      const listedPrice = listing?.price ?? t.buyPrice;
      const priceCompetitiveness =
        aiEstimatedValue && aiEstimatedValue > 0
          ? Math.round(((aiEstimatedValue - listedPrice) / aiEstimatedValue) * 1000) / 10
          : 0;

      // contactActivity: 2 (bookmarked) | 1 (contacted) | 0 (none)
      const isBookmarked = !!listing?.isBookmarked;
      const contactStatus = listing?.contactStatus ?? 'none';
      let contactActivity = 0;
      if (isBookmarked) contactActivity = 2;
      else if (contactStatus && contactStatus !== 'none') contactActivity = 1;

      const dealScore = listing?.dealScore ?? null;

      // hasImage: prefer trade.imageUrl, fall back to listing.imageUrl
      const hasImage = !!(t.imageUrl || listing?.imageUrl);

      // titleQuality: use trade.title length (most reliable)
      const titleLength = (t.title || '').length;

      const aScore = ageScore(listingAgeDays);
      const pScore = priceScore(priceCompetitiveness);
      const actScore = activityScore(contactActivity);
      const dPoints = dealScorePoints(dealScore);
      const imgScore = hasImage ? 8 : 0;
      const tScore = titlePoints(titleLength);

      const exposureScore = Math.max(
        0,
        Math.min(
          100,
          aScore + pScore + actScore + dPoints + imgScore + tScore,
        ),
      );

      const classification = classifyExposure(exposureScore);

      // recommendedActions — concrete improvements
      const recommendedActions: string[] = [];
      if (listingAgeDays >= 30) {
        recommendedActions.push(
          `Listing star ${listingAgeDays} dni — razmisli o osvežitvi (nova glava, nove slike).`,
        );
      } else if (listingAgeDays >= 14) {
        recommendedActions.push(
          `Listing star ${listingAgeDays} dni — dodaj slike ali znižaj ceno za 5-10%.`,
        );
      }
      if (priceCompetitiveness < 0 && aiEstimatedValue) {
        const dropPct = Math.min(20, Math.round(Math.abs(priceCompetitiveness)));
        recommendedActions.push(
          `Cena ${priceCompetitiveness}% nad estValue — znižaj za ${dropPct}%.`,
        );
      } else if (priceCompetitiveness >= 0 && priceCompetitiveness < 10) {
        recommendedActions.push(
          `Cena v redu (${priceCompetitiveness}% pod estValue) — majhna izpostavljenost zaradi drugih faktorjev.`,
        );
      }
      if (contactActivity === 0) {
        recommendedActions.push(
          'Ni kontaktov — kontaktiraj prodajalce/kupe prek platforme.',
        );
      }
      if (!hasImage) {
        recommendedActions.push('Dodaj fotografije — poveča CTR za ~30%.');
      }
      if (titleLength < 50 || titleLength > 100) {
        recommendedActions.push(
          `Kvalitetna dolžina naslova (50-100 znakov) — trenutno ${titleLength}.`,
        );
      }
      if (dealScore != null && dealScore < 50) {
        recommendedActions.push(
          `Deal Score ${dealScore}/100 — izboljšaj opis ali ceno.`,
        );
      }
      if (recommendedActions.length === 0) {
        recommendedActions.push('Listing je dobro izpostavljen — ohrani trenutni tempo.');
      }

      return {
        tradeId: t.id,
        title: t.title,
        category: (t.category || 'drugo').trim().toLowerCase() || 'drugo',
        buyPrice: Math.round(t.buyPrice),
        aiEstimatedValue,
        exposureScore,
        classification,
        factors: {
          listingAgeDays,
          ageScore: aScore,
          priceCompetitiveness,
          priceScore: pScore,
          contactActivity,
          activityScore: actScore,
          dealScore,
          dealScorePoints: dPoints,
          hasImage,
          imageScore: imgScore,
          titleLength,
          titleScore: tScore,
        },
        recommendedActions: recommendedActions.slice(0, 5),
      };
    });

    // Sort by exposureScore ASC (lowest first — needs most attention)
    items.sort((a, b) => a.exposureScore - b.exposureScore);

    // Summary
    const excellent = items.filter(i => i.classification === 'EXCELLENT').length;
    const good = items.filter(i => i.classification === 'GOOD').length;
    const average = items.filter(i => i.classification === 'AVERAGE').length;
    const poor = items.filter(i => i.classification === 'POOR').length;
    const critical = items.filter(i => i.classification === 'CRITICAL').length;
    const avgExposureScore =
      items.length > 0
        ? Math.round(items.reduce((s, i) => s + i.exposureScore, 0) / items.length)
        : 0;
    const needsAttention = poor + critical;

    return NextResponse.json({
      ok: true,
      items,
      summary: {
        totalItems: items.length,
        excellent,
        good,
        average,
        poor,
        critical,
        avgExposureScore,
        needsAttention,
      },
    });
  } catch (err: any) {
    logger.error('/api/analytics/listing-exposure-score', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
