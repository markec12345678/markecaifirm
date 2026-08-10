// v7.67: Portfolio Health Dashboard — celovit health score (0-100) za
// trenutni portfelj glede na diverzifikacijo, likvidnost, tveganja, aging
// in profitni potencial. Čist analytics brez AI.
//
// "Portfolio health 72/100 (GOOD). Likvidnost 40/100 (POOR — avg hold
//  52d). Prodi starejše item-e za izboljšanje."
//
// Razlika od portfolio-concentration-risk (ki gleda PARETO + HERFINDAHL
// koncentracijsko tveganje) — ta gleda 5 DIMENZIJ zdravja portfelja
// (diverzifikacija, likvidnost, tveganje, aging, profit potential) z
// weighted-score 0-100 in klasifikacijo EXCELLENT/GOOD/AVERAGE/POOR/CRITICAL.
// Razlika od inventory-health-monitor-v2 (ki AI-analizira inventar)
// — ta je pure DB analytics z eksplicitnimi health dimensions in
// severity-tagged issues. Razlika od portfolio-stress-test (ki simulira
// -10/-25/-40% scenarije) — ta gleda AKTUALNO zdravje portfelja danes.
//
// Pure DB analytics (NO AI). GET /api/analytics/portfolio-health-dashboard

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type HealthClassification =
  | 'EXCELLENT'
  | 'GOOD'
  | 'AVERAGE'
  | 'POOR'
  | 'CRITICAL';

type IssueSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

interface DimensionScore {
  score: number; // 0-100
  status: string;
  detail: string;
}

interface PortfolioSummary {
  totalItems: number;
  totalCapital: number;
  totalEstValue: number;
  unrealizedProfit: number;
  avgHoldDays: number;
  avgRisk: number;
  freshItemsPct: number; // % held <30 days
}

interface HealthIssue {
  dimension: string;
  severity: IssueSeverity;
  issue: string;
  recommendation: string;
}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;
const FRESH_THRESHOLD_DAYS = 30;

function round1(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 10) / 10;
}

function classifyHealth(score: number): HealthClassification {
  if (score >= 80) return 'EXCELLENT';
  if (score >= 60) return 'GOOD';
  if (score >= 40) return 'AVERAGE';
  if (score >= 20) return 'POOR';
  return 'CRITICAL';
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    // 1) Query all HELD trades + their linked listings (for aiRisk + aiEstimatedValue)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyDate: true,
        listing: {
          select: {
            aiRisk: true,
            aiEstimatedValue: true,
            aiScore: true,
          },
        },
      },
      take: 2000,
    });

    // 2) Query all SOLD trades for historical avg hold days reference
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null },
      },
      select: {
        id: true,
        buyDate: true,
        sellDate: true,
      },
      take: 5000,
    });

    // Empty state — no portfolio at all
    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        overallHealth: {
          score: 0,
          classification: 'CRITICAL' as HealthClassification,
          summary:
            'Ni held trade-ov — portfelj je prazen. Začni z nakupi za health analizo.',
        },
        dimensions: {
          diversification: {
            score: 0,
            status: 'N/A',
            detail: 'Ni held inventarja — diverzifikacija ni merljiva.',
          },
          liquidity: {
            score: 0,
            status: 'N/A',
            detail: 'Ni held inventarja — likvidnost ni merljiva.',
          },
          riskExposure: {
            score: 0,
            status: 'N/A',
            detail: 'Ni held inventarja — tveganja niso merljiva.',
          },
          aging: {
            score: 0,
            status: 'N/A',
            detail: 'Ni held inventarja — aging ni merljiv.',
          },
          profitPotential: {
            score: 0,
            status: 'N/A',
            detail: 'Ni held inventarja — profitni potencial ni merljiv.',
          },
        },
        portfolio: {
          totalItems: 0,
          totalCapital: 0,
          totalEstValue: 0,
          unrealizedProfit: 0,
          avgHoldDays: 0,
          avgRisk: 0,
          freshItemsPct: 0,
        },
        issues: [],
        recommendations: [
          'Dodaj prve held trade-e za začetek Portfolio Health analize.',
        ],
        message:
          'Ni held trade-ov — Portfolio Health analiza ni mogoča.',
      });
    }

    // 3) Portfolio summary
    const now = Date.now();
    const totalItems = heldTrades.length;
    const totalCapital = heldTrades.reduce(
      (s, t) => s + t.buyPrice,
      0,
    );
    const totalEstValue = heldTrades.reduce(
      (s, t) => s + (t.listing?.aiEstimatedValue ?? t.buyPrice),
      0,
    );
    const unrealizedProfit = totalEstValue - totalCapital;

    // Avg hold days for held items (now - buyDate)
    const holdDaysPerItem = heldTrades
      .map(t => (t.buyDate ? (now - new Date(t.buyDate).getTime()) / DAY_MS : 0))
      .filter(d => Number.isFinite(d) && d >= 0);
    const avgHoldDays =
      holdDaysPerItem.length > 0
        ? holdDaysPerItem.reduce((s, d) => s + d, 0) / holdDaysPerItem.length
        : 0;

    // Avg aiRisk from linked listings
    const riskScores = heldTrades
      .map(t => t.listing?.aiRisk)
      .filter((r): r is number => typeof r === 'number' && r > 0);
    const avgRisk =
      riskScores.length > 0
        ? riskScores.reduce((s, r) => s + r, 0) / riskScores.length
        : 0;

    // Fresh items = held <30 days
    const freshCount = holdDaysPerItem.filter(d => d < FRESH_THRESHOLD_DAYS).length;
    const freshItemsPct =
      holdDaysPerItem.length > 0
        ? Math.round((freshCount / holdDaysPerItem.length) * 100)
        : 0;

    const portfolio: PortfolioSummary = {
      totalItems,
      totalCapital: Math.round(totalCapital),
      totalEstValue: Math.round(totalEstValue),
      unrealizedProfit: Math.round(unrealizedProfit),
      avgHoldDays: round1(avgHoldDays),
      avgRisk: round1(avgRisk),
      freshItemsPct,
    };

    // 4) Health dimensions

    // 4a) Diversification — based on Herfindahl index of category distribution
    const catMap = new Map<string, number>();
    for (const t of heldTrades) {
      const cat = (t.category || 'drugo').trim().toLowerCase() || 'drugo';
      catMap.set(cat, (catMap.get(cat) ?? 0) + 1);
    }
    const catShares = Array.from(catMap.values()).map(
      c => c / totalItems,
    );
    // HHI = sum of squared market shares, scaled 0-1
    const herfindahl = catShares.reduce((s, x) => s + x * x, 0);
    let divScore: number;
    let divStatus: string;
    if (herfindahl < 0.2) {
      divScore = 100;
      divStatus = 'DIVERZIFICIRANO';
    } else if (herfindahl < 0.4) {
      divScore = 80;
      divStatus = 'DOBRO';
    } else if (herfindahl < 0.6) {
      divScore = 60;
      divStatus = 'ZMERNJO';
    } else {
      divScore = 30;
      divStatus = 'KONCENTRIRANO';
    }
    const topCat = Array.from(catMap.entries()).sort(
      (a, b) => b[1] - a[1],
    )[0];
    const diversification: DimensionScore = {
      score: divScore,
      status: divStatus,
      detail: `HHI=${(herfindahl * 1000).toFixed(0)}, ${catMap.size} kategorij, top="${topCat?.[0] ?? '—'}" (${Math.round(((topCat?.[1] ?? 0) / totalItems) * 100)}% kapitala).`,
    };

    // 4b) Liquidity — based on avg hold days of HELD items (faster turnover = healthier)
    let liqScore: number;
    let liqStatus: string;
    if (avgHoldDays < 15) {
      liqScore = 100;
      liqStatus = 'ODLIČNA';
    } else if (avgHoldDays < 30) {
      liqScore = 80;
      liqStatus = 'DOBRA';
    } else if (avgHoldDays < 45) {
      liqScore = 60;
      liqStatus = 'ZMERNA';
    } else if (avgHoldDays < 60) {
      liqScore = 40;
      liqStatus = 'POOR';
    } else {
      liqScore = 20;
      liqStatus = 'KRITIČNA';
    }
    const liquidity: DimensionScore = {
      score: liqScore,
      status: liqStatus,
      detail: `Avg hold ${round1(avgHoldDays)} dni (held inventar). Fresh <30d: ${freshItemsPct}%.`,
    };

    // 4c) Risk Exposure — based on avg aiRisk score of held listings
    let riskScoreVal: number;
    let riskStatus: string;
    if (avgRisk === 0) {
      // No listings with aiRisk — neutral
      riskScoreVal = 60;
      riskStatus = 'NEZNANO';
    } else if (avgRisk < 3) {
      riskScoreVal = 100;
      riskStatus = 'NIZKO';
    } else if (avgRisk < 5) {
      riskScoreVal = 80;
      riskStatus = 'ZMERNJO';
    } else if (avgRisk < 7) {
      riskScoreVal = 60;
      riskStatus = 'POVIŠANO';
    } else {
      riskScoreVal = 30;
      riskStatus = 'VISOKO';
    }
    const riskExposure: DimensionScore = {
      score: riskScoreVal,
      status: riskStatus,
      detail:
        avgRisk === 0
          ? `Ni AI risk podatkov za held listings — poveži trade-e z listing-i in zaženi AI evaluacijo.`
          : `Avg aiRisk=${round1(avgRisk)}/10 (${riskScores.length} od ${totalItems} held povezanih z listing-i).`,
    };

    // 4d) Aging — % of items held <30 days (fresh = healthy)
    let ageScore: number;
    let ageStatus: string;
    if (freshItemsPct > 80) {
      ageScore = 100;
      ageStatus = 'FRESH';
    } else if (freshItemsPct > 60) {
      ageScore = 80;
      ageStatus = 'DOBRO';
    } else if (freshItemsPct > 40) {
      ageScore = 60;
      ageStatus = 'ZMERNJO';
    } else {
      ageScore = 30;
      ageStatus = 'STAR';
    }
    const aging: DimensionScore = {
      score: ageScore,
      status: ageStatus,
      detail: `${freshItemsPct}% held <30d (fresh). ${100 - freshItemsPct}% zastarelo — premisli prodajo ali reprice.`,
    };

    // 4e) Profit Potential — based on unrealized profit / invested
    const profitPct =
      totalCapital > 0 ? (unrealizedProfit / totalCapital) * 100 : 0;
    let profScore: number;
    let profStatus: string;
    if (profitPct > 30) {
      profScore = 100;
      profStatus = 'ODLIČEN';
    } else if (profitPct > 20) {
      profScore = 80;
      profStatus = 'DOBRO';
    } else if (profitPct > 10) {
      profScore = 60;
      profStatus = 'ZMEREN';
    } else if (profitPct > 0) {
      profScore = 40;
      profStatus = 'NIZKO';
    } else {
      profScore = 30;
      profStatus = 'NEGATIVNO';
    }
    const profitPotential: DimensionScore = {
      score: profScore,
      status: profStatus,
      detail: `Unrealized profit ${Math.round(unrealizedProfit)}€ (${round1(profitPct)}% nad buyPrice). EstValue=${Math.round(totalEstValue)}€ vs Capital=${Math.round(totalCapital)}€.`,
    };

    const dimensions = {
      diversification,
      liquidity,
      riskExposure,
      aging,
      profitPotential,
    };

    // 5) Overall health — weighted average
    // Diversification 20%, Liquidity 25%, Risk 20%, Aging 15%, Profit Potential 20%
    const overallScore = Math.round(
      divScore * 0.2 +
        liqScore * 0.25 +
        riskScoreVal * 0.2 +
        ageScore * 0.15 +
        profScore * 0.2,
    );
    const classification = classifyHealth(overallScore);

    // 6) Generate issues (severity-tagged) and recommendations
    const issues: HealthIssue[] = [];
    const recommendations: string[] = [];

    if (divScore < 60) {
      const sev: IssueSeverity = divScore < 40 ? 'HIGH' : 'MEDIUM';
      issues.push({
        dimension: 'diversification',
        severity: sev,
        issue: `Portfelj je preveč koncentriran v "${topCat?.[0] ?? '—'}" (${Math.round(((topCat?.[1] ?? 0) / totalItems) * 100)}% kapitala, HHI=${(herfindahl * 1000).toFixed(0)}).`,
        recommendation: `Diverzificiraj v 2-3 druge kategorije — zmanjšaj top kategorijo pod 40% v naslednjih 3-5 kupih.`,
      });
      recommendations.push(
        `Diverzifikacija: zmanjšaj "${topCat?.[0] ?? '—'}" pod 40% in razširi v 2-3 nove kategorije.`,
      );
    }

    if (liqScore < 60) {
      const sev: IssueSeverity = liqScore < 30 ? 'HIGH' : 'MEDIUM';
      issues.push({
        dimension: 'liquidity',
        severity: sev,
        issue: `Likvidnost nizka — avg hold ${round1(avgHoldDays)} dni ( ideal <30d). ${100 - freshItemsPct}% inventarja je starejše od 30 dni.`,
        recommendation: `Pospeši prodajo zastarelih item-ov z 5-10% price drop ali boljšo prezentacijo.`,
      });
      recommendations.push(
        `Likvidnost: prodaj zastarele item-e (avg hold ${round1(avgHoldDays)}d) z aggressive pricing-om.`,
      );
    }

    if (riskScoreVal < 60 && avgRisk > 0) {
      const sev: IssueSeverity = avgRisk >= 7 ? 'HIGH' : 'MEDIUM';
      issues.push({
        dimension: 'riskExposure',
        severity: sev,
        issue: `Avg AI risk=${round1(avgRisk)}/10 — visoko tveganje v inventarju (${riskScores.length} od ${totalItems} held povezanih).`,
        recommendation: `Preglej high-risk item-e in razmisli o hitri prodaji ali zamenjavi z nižje-tveganimi.`,
      });
      recommendations.push(
        `Tveganje: zmanjšaj povprečni AI risk iz ${round1(avgRisk)}/10 pod 5/10.`,
      );
    }

    if (ageScore < 60) {
      const sev: IssueSeverity = ageScore < 30 ? 'HIGH' : 'MEDIUM';
      issues.push({
        dimension: 'aging',
        severity: sev,
        issue: `Samo ${freshItemsPct}% held inventarja je mlajšega od 30 dni — visok delež zastarelega inventarja.`,
        recommendation: `Fokusiraj prodajo starejših item-ov (>30 dni held) ali premakni kapital v nove, hitreje obrnjive nakupe.`,
      });
      recommendations.push(
        `Aging: prodaj ${100 - freshItemsPct}% zastarelih item-ov (>30 dni) v naslednjih 2-4 tednih.`,
      );
    }

    if (profScore < 60) {
      const sev: IssueSeverity = profScore < 30 ? 'HIGH' : 'MEDIUM';
      issues.push({
        dimension: 'profitPotential',
        severity: sev,
        issue: `Profitni potencial nizko — unrealized ${Math.round(unrealizedProfit)}€ (${round1(profitPct)}% nad buyPrice).`,
        recommendation: `Ponovno ovrednoti cene (reprice za +10-20%) ali dodaj boljše AI-evalvirane nakupe z večjim upside potential.`,
      });
      recommendations.push(
        `Profit potential: dvigni unrealized profit iz ${round1(profitPct)}% nad 20% z better sourcing-om in repricing-om.`,
      );
    }

    // Overall summary
    let summary: string;
    const cls = classification;
    if (cls === 'EXCELLENT') {
      summary = `Portfolio health ${overallScore}/100 (EXCELLENT). Vse dimenzije zdrave — vzdržuj tempo in povečaj volumen.`;
    } else if (cls === 'GOOD') {
      summary = `Portfolio health ${overallScore}/100 (GOOD). ${issues.length} manjših težav — optimiziraj ${issues[0]?.dimension ?? 'najšibkejšo dimenzijo'} za +10 točk.`;
    } else if (cls === 'AVERAGE') {
      summary = `Portfolio health ${overallScore}/100 (AVERAGE). ${issues.length} težav — naslovite ${issues[0]?.dimension ?? 'likvidnost'} in ${issues[1]?.dimension ?? 'aging'} za +20 točk.`;
    } else if (cls === 'POOR') {
      summary = `Portfolio health ${overallScore}/100 (POOR). ${issues.length} kritičnih težav — takoj ukrepaj na ${issues[0]?.dimension ?? 'najšibkejši dimenziji'}.`;
    } else {
      summary = `Portfolio health ${overallScore}/100 (CRITICAL). Portfelj zahteva takojšnjo pozornost — ${issues.length} kritičnih težav čez več dimenzij.`;
    }

    if (recommendations.length === 0) {
      recommendations.push(
        'Vse dimenzije zdrave — vzdržuj trenutno strukturo in monitoring.',
      );
    }

    return NextResponse.json({
      ok: true,
      overallHealth: {
        score: overallScore,
        classification,
        summary,
      },
      dimensions,
      portfolio,
      issues,
      recommendations,
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/portfolio-health-dashboard',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
