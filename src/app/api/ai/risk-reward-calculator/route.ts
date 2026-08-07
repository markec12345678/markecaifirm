// v7.68: AI Risk Reward Calculator — AI izračuna risk-adjusted reward za
// potencialne trade-e. Za vsak held item ali listing izračuna potentialReward
// (upside), potentialLoss (max 30% downside), rewardToRiskRatio,
// probabilityOfProfit (iz dealScore), expectedValue. AI generira
// riskLevel/rewardLevel/riskRewardGrade (A+ do F), keyRiskFactors,
// mitigationStrategies, finalRecommendation (STRONG_BUY..STRONG_SELL).
//
// "PS5: ratio 2.5 (A grade), EV +85€, STRONG_BUY. Jakna: ratio 0.8 (C),
//  EV -10€, HOLD."
//
// Razlika od risk-spread-calculator (ki gleda PORTFELJ diverzifikacijo) —
// ta gleda POSAMEZNE item-e z risk-reward analizo in EV. Razlika od
// portfolio-stress-test (ki simulira scenarije -10/-25/-40%) — ta ocenjuje
// AKTUALNO tveganje vs nagrado za vsak item danes. Razlika od
// portfolio-concentration-risk (ki gleda Pareto + Herfindahl koncentracijo)
// — ta gleda POSAMEZEN item risk-reward.
//
// GET+POST /api/ai/risk-reward-calculator
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import {
  callProviderForRaw,
  parseJsonLooseExported,
  type AiProviderType,
  type AiSettings,
} from '@/lib/ai';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
type RewardLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
type Grade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
type FinalRecommendation =
  | 'STRONG_BUY'
  | 'BUY'
  | 'HOLD'
  | 'AVOID'
  | 'STRONG_SELL';

interface ItemAssessment {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  aiEstimatedValue: number;
  potentialReward: number;
  potentialLoss: number;
  rewardToRiskRatio: number;
  probabilityOfProfit: number; // %
  expectedValue: number; // €
  riskLevel: RiskLevel;
  rewardLevel: RewardLevel;
  riskRewardGrade: Grade;
  confidenceInAssessment: number; // 0-100
  keyRiskFactors: string[];
  mitigationStrategies: string[];
  finalRecommendation: FinalRecommendation;
}

interface AiRiskRewardResponse {
  items?: unknown;
}

// --- Helpers -------------------------------------------------------------

const VALID_RISK: readonly RiskLevel[] = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'VERY_HIGH',
] as const;
const VALID_REWARD: readonly RewardLevel[] = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'VERY_HIGH',
] as const;
const VALID_GRADE: readonly Grade[] = [
  'A+',
  'A',
  'B',
  'C',
  'D',
  'F',
] as const;
const VALID_REC: readonly FinalRecommendation[] = [
  'STRONG_BUY',
  'BUY',
  'HOLD',
  'AVOID',
  'STRONG_SELL',
] as const;

function clampNumber(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw == null) return Math.max(min, Math.min(max, fallback));
  const v = Number(raw);
  if (!Number.isFinite(v)) return Math.max(min, Math.min(max, fallback));
  return Math.max(min, Math.min(max, v));
}

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

function clampEnum<T extends string>(
  raw: unknown,
  valid: readonly T[],
  fallback: T,
): T {
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '_');
  for (const v of valid) {
    if (s === v.toUpperCase()) return v;
  }
  // Special-case for A+ which has +
  if (s === 'A+') return 'A+' as T;
  return fallback;
}

function round1(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 10) / 10;
}

// --- Deterministic analysis (fallback) -----------------------------------

// riskLevel from rewardToRiskRatio (lower ratio = higher risk)
function deterministicRiskLevel(ratio: number): RiskLevel {
  if (ratio >= 3) return 'LOW';
  if (ratio >= 2) return 'LOW';
  if (ratio >= 1) return 'MEDIUM';
  if (ratio >= 0.5) return 'HIGH';
  return 'VERY_HIGH';
}

// rewardLevel from potentialReward relative to buyPrice
function deterministicRewardLevel(
  potentialReward: number,
  buyPrice: number,
): RewardLevel {
  if (buyPrice <= 0) return 'LOW';
  const rewardPct = (potentialReward / buyPrice) * 100;
  if (rewardPct >= 50) return 'VERY_HIGH';
  if (rewardPct >= 30) return 'HIGH';
  if (rewardPct >= 15) return 'MEDIUM';
  return 'LOW';
}

// grade from ratio: >3=A+, 2-3=A, 1-2=B, 0.5-1=C, 0.25-0.5=D, <0.25=F
function deterministicGrade(ratio: number): Grade {
  if (ratio >= 3) return 'A+';
  if (ratio >= 2) return 'A';
  if (ratio >= 1) return 'B';
  if (ratio >= 0.5) return 'C';
  if (ratio >= 0.25) return 'D';
  return 'F';
}

function deterministicRecommendation(
  ratio: number,
  ev: number,
): FinalRecommendation {
  if (ratio >= 3 && ev > 0) return 'STRONG_BUY';
  if (ratio >= 2 && ev > 0) return 'BUY';
  if (ratio >= 1 && ev >= 0) return 'HOLD';
  if (ratio >= 0.5) return 'HOLD';
  if (ratio > 0 && ev < 0) return 'AVOID';
  return 'STRONG_SELL';
}

// --- Portfolio summary builder ------------------------------------------

function buildPortfolioSummary(items: ItemAssessment[]) {
  const totalItems = items.length;
  if (totalItems === 0) {
    return {
      totalItems: 0,
      avgRiskLevel: 'N/A',
      avgRewardLevel: 'N/A',
      portfolioGrade: 'N/A',
      strongBuyCount: 0,
      avoidCount: 0,
      totalExpectedValue: 0,
      portfolioRecommendation:
        'Ni held trade-ov za analizo — dodaš trades za začetek.',
    };
  }

  // Average risk level — map to numeric (LOW=1, MEDIUM=2, HIGH=3, VERY_HIGH=4)
  const riskMap: Record<RiskLevel, number> = {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
    VERY_HIGH: 4,
  };
  const rewardMap: Record<RewardLevel, number> = {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
    VERY_HIGH: 4,
  };
  const gradeMap: Record<Grade, number> = {
    'A+': 6,
    A: 5,
    B: 4,
    C: 3,
    D: 2,
    F: 1,
  };
  const reverseRisk: Record<number, RiskLevel> = {
    1: 'LOW',
    2: 'MEDIUM',
    3: 'HIGH',
    4: 'VERY_HIGH',
  };
  const reverseReward: Record<number, RewardLevel> = {
    1: 'LOW',
    2: 'MEDIUM',
    3: 'HIGH',
    4: 'VERY_HIGH',
  };
  const reverseGrade: Record<number, Grade> = {
    1: 'F',
    2: 'D',
    3: 'C',
    4: 'B',
    5: 'A',
    6: 'A+',
  };

  const avgRiskNum =
    items.reduce((s, i) => s + riskMap[i.riskLevel], 0) / totalItems;
  const avgRewardNum =
    items.reduce((s, i) => s + rewardMap[i.rewardLevel], 0) / totalItems;
  const avgGradeNum =
    items.reduce((s, i) => s + gradeMap[i.riskRewardGrade], 0) / totalItems;

  const avgRiskLevel = reverseRisk[Math.round(avgRiskNum)] ?? 'MEDIUM';
  const avgRewardLevel = reverseReward[Math.round(avgRewardNum)] ?? 'MEDIUM';
  const portfolioGrade = reverseGrade[Math.round(avgGradeNum)] ?? 'C';

  const strongBuyCount = items.filter(
    i => i.finalRecommendation === 'STRONG_BUY',
  ).length;
  const avoidCount = items.filter(
    i =>
      i.finalRecommendation === 'AVOID' ||
      i.finalRecommendation === 'STRONG_SELL',
  ).length;

  const totalExpectedValue = Math.round(
    items.reduce((s, i) => s + i.expectedValue, 0),
  );

  let portfolioRecommendation: string;
  if (strongBuyCount >= totalItems * 0.5 && totalExpectedValue > 0) {
    portfolioRecommendation = `Portfelj je MOČAN — ${strongBuyCount} od ${totalItems} item-ov STRONG_BUY. Skupni EV +${totalExpectedValue}€. Vzdržuj in povečaj volumen v podobnih kategorijah.`;
  } else if (avoidCount >= totalItems * 0.4 || totalExpectedValue < 0) {
    portfolioRecommendation = `Portfelj je ŠIBAK — ${avoidCount} od ${totalItems} item-ov AVOID/STRONG_SELL. Skupni EV ${totalExpectedValue}€. Razmisli o izstopu iz slabih pozicij.`;
  } else {
    portfolioRecommendation = `Portfelj je MEŠAN — ${strongBuyCount} STRONG_BUY, ${avoidCount} AVOID od ${totalItems} item-ov. Skupni EV ${totalExpectedValue}€. Optimiziraj šibke pozicije z mitigation strategijami.`;
  }

  return {
    totalItems,
    avgRiskLevel,
    avgRewardLevel,
    portfolioGrade,
    strongBuyCount,
    avoidCount,
    totalExpectedValue,
    portfolioRecommendation,
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleRiskReward(req);
}
export async function POST(req: NextRequest) {
  return handleRiskReward(req);
}

async function handleRiskReward(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-risk-reward', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    // Parse body — optional listingId or tradeId
    let body: { listingId?: string; tradeId?: string } = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === 'object') {
        body = parsed as { listingId?: string; tradeId?: string };
      }
    } catch {
      // GET request — no body, analyze all held trades
    }

    // 1) Determine which trades to analyze
    const statuses: ('held' | 'sold')[] = ['held', 'sold'];
    const where = body.tradeId
      ? { id: body.tradeId, status: { in: statuses } }
      : body.listingId
        ? {
            listingId: body.listingId,
            status: { in: statuses },
          }
        : { status: 'held' as const };

    const trades = await db.trade.findMany({
      where,
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        listing: {
          select: {
            id: true,
            aiEstimatedValue: true,
            aiScore: true,
            aiRisk: true,
            dealScore: true,
          },
        },
      },
      take: 500,
    });

    // Empty state
    if (trades.length === 0) {
      return NextResponse.json({
        ok: true,
        items: [],
        portfolioRiskSummary: {
          totalItems: 0,
          avgRiskLevel: 'N/A',
          avgRewardLevel: 'N/A',
          portfolioGrade: 'N/A',
          strongBuyCount: 0,
          avoidCount: 0,
          totalExpectedValue: 0,
          portfolioRecommendation:
            'Ni held trade-ov za analizo — dodaš trades za začetek Risk/Reward analize.',
        },
        aiUsed: false,
        message:
          'Ni held trade-ov — Risk/Reward analiza ni mogoča. Dodaš trades z veljavnim buyPrice za začetek.',
      });
    }

    // 2) Compute deterministic metrics per item
    const itemIds = trades.map(t => t.id).sort();
    type BaseItem = {
      tradeId: string;
      title: string;
      category: string;
      buyPrice: number;
      aiEstimatedValue: number;
      potentialReward: number;
      potentialLoss: number;
      rewardToRiskRatio: number;
      probabilityOfProfit: number;
      expectedValue: number;
      dealScore: number;
      aiRisk: number;
    };

    const baseItems: BaseItem[] = [];
    for (const t of trades) {
      const buyPrice = t.buyPrice ?? 0;
      const aiEstimatedValue = t.listing?.aiEstimatedValue ?? buyPrice;
      const potentialReward = Math.max(0, aiEstimatedValue - buyPrice);
      const potentialLoss = buyPrice * 0.3; // assume max 30% downside
      const rewardToRiskRatio =
        potentialLoss > 0 ? round1(potentialReward / potentialLoss) : 0;

      // probabilityOfProfit: based on dealScore (0-100 → 0-95%)
      const dealScore = t.listing?.dealScore ?? 0;
      const probabilityOfProfit = Math.max(
        5,
        Math.min(95, Math.round(dealScore * 0.95)),
      );

      // expectedValue = (p_win × reward) - (p_loss × loss)
      const pWin = probabilityOfProfit / 100;
      const pLoss = 1 - pWin;
      const expectedValue = Math.round(
        pWin * potentialReward - pLoss * potentialLoss,
      );

      baseItems.push({
        tradeId: t.id,
        title: t.title,
        category: t.category || 'drugo',
        buyPrice,
        aiEstimatedValue,
        potentialReward,
        potentialLoss,
        rewardToRiskRatio,
        probabilityOfProfit,
        expectedValue,
        dealScore,
        aiRisk: t.listing?.aiRisk ?? 0,
      });
    }

    // 3) AI cache — keyed by sorted item IDs
    const cacheKey = `risk-reward-calc:${JSON.stringify(itemIds)}`;
    const cached = getCachedAI<{ items: ItemAssessment[] }>(cacheKey);
    if (cached && Array.isArray(cached.items) && cached.items.length > 0) {
      // Merge cached AI fields with fresh DB numbers (in case buyPrice changed)
      const merged: ItemAssessment[] = baseItems.map(base => {
        const c = cached.items.find(x => x.tradeId === base.tradeId);
        if (!c) {
          // No cache for this item — build deterministic
          return buildDeterministicItem(base);
        }
        return {
          tradeId: base.tradeId,
          title: base.title,
          category: base.category,
          buyPrice: base.buyPrice,
          aiEstimatedValue: base.aiEstimatedValue,
          potentialReward: base.potentialReward,
          potentialLoss: base.potentialLoss,
          rewardToRiskRatio: base.rewardToRiskRatio,
          probabilityOfProfit: base.probabilityOfProfit,
          expectedValue: base.expectedValue,
          riskLevel: clampEnum(c.riskLevel, VALID_RISK, deterministicRiskLevel(base.rewardToRiskRatio)),
          rewardLevel: clampEnum(c.rewardLevel, VALID_REWARD, deterministicRewardLevel(base.potentialReward, base.buyPrice)),
          riskRewardGrade: clampEnum(c.riskRewardGrade, VALID_GRADE, deterministicGrade(base.rewardToRiskRatio)),
          confidenceInAssessment: clampNumber(c.confidenceInAssessment, 0, 100, 60),
          keyRiskFactors: sanitizeStringArray(c.keyRiskFactors, 5),
          mitigationStrategies: sanitizeStringArray(c.mitigationStrategies, 5),
          finalRecommendation: clampEnum(
            c.finalRecommendation,
            VALID_REC,
            deterministicRecommendation(base.rewardToRiskRatio, base.expectedValue),
          ),
        };
      });
      return NextResponse.json({
        ok: true,
        items: merged,
        portfolioRiskSummary: buildPortfolioSummary(merged),
        cached: true,
        aiUsed: true,
      });
    }

    // 4) Build AI prompt with grounding
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as
        | AiProviderType
        | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '',
      fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const itemBlock = baseItems
      .slice(0, 20)
      .map(
        (it, i) =>
          `${i + 1}. tradeId=${it.tradeId}, title="${it.title}", category="${it.category}", buyPrice=${it.buyPrice}€, aiEstimatedValue=${it.aiEstimatedValue}€, potentialReward=${it.potentialReward}€, potentialLoss=${it.potentialLoss}€, rewardToRiskRatio=${it.rewardToRiskRatio}, probabilityOfProfit=${it.probabilityOfProfit}%, expectedValue=${it.expectedValue}€, dealScore=${it.dealScore}, aiRisk=${it.aiRisk}/10`,
      )
      .join('\n');

    const prompt = `Si AI analitik tveganja in nagrajevanja za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Za vsak trade izračunaj riskLevel, rewardLevel, riskRewardGrade (A+ do F), confidenceInAssessment (0-100), keyRiskFactors (2-5), mitigationStrategies (2-5) in finalRecommendation (STRONG_BUY..STRONG_SELL).

ITEM-I (${Math.min(20, baseItems.length)} od ${baseItems.length}):
${itemBlock}

PRAVILA ZA ANALIZO:
1. riskLevel: LOW (ratio >=2, aiRisk <4), MEDIUM (ratio 1-2, aiRisk 4-6), HIGH (ratio 0.5-1, aiRisk 6-8), VERY_HIGH (ratio <0.5, aiRisk >=8)
2. rewardLevel: LOW (rewardPct <15%), MEDIUM (15-30%), HIGH (30-50%), VERY_HIGH (>50%)
3. riskRewardGrade: A+ (ratio >=3 + EV>0), A (ratio 2-3 + EV>0), B (ratio 1-2 + EV>=0), C (ratio 0.5-1), D (ratio 0.25-0.5), F (ratio <0.25 ali EV<0)
4. confidenceInAssessment: višji = bolj zanesljiva ocena (glede na dealScore kvaliteto podatkov in aiRisk konsistentnost)
5. keyRiskFactors: 2-5 konkretnih tveganj (npr. "visoka koncentracija v eni kategoriji", "stari listing", "nizka ocena kakovosti", "visoka cena glede na trg")
6. mitigationStrategies: 2-5 konkretnih nasvetov (npr. "znižaj ceno za 10% za hitro prodajo", "izboljšaj slike", "ponovno oceni trg", "čakaj na boljši čas")
7. finalRecommendation:
   - STRONG_BUY: ratio >=3, EV>0, grade A+
   - BUY: ratio 2-3, EV>0, grade A
   - HOLD: ratio 1-2, EV>=0, grade B
   - AVOID: ratio 0.25-1 ali EV<0
   - STRONG_SELL: ratio <0.25, zelo negativen EV

VRNI LE JSON:
{
  "items": [
    {
      "tradeId": "abc123",
      "riskLevel": "LOW",
      "rewardLevel": "HIGH",
      "riskRewardGrade": "A",
      "confidenceInAssessment": 80,
      "keyRiskFactors": ["..."],
      "mitigationStrategies": ["..."],
      "finalRecommendation": "BUY"
    }
  ]
}${GROUNDING_PROMPT_SUFFIX}`;

    // Start with deterministic baseline items
    const items: ItemAssessment[] = baseItems.map(b => buildDeterministicItem(b));

    let aiUsed = false;
    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as
        | AiRiskRewardResponse
        | null;

      if (parsed && Array.isArray(parsed.items)) {
        const aiMap = new Map<string, ItemAssessment>();
        for (const it of parsed.items) {
          const a = it as Record<string, unknown> | null;
          if (!a || typeof a !== 'object') continue;
          const tradeId = clampString(a.tradeId, 100, '');
          if (!tradeId) continue;
          aiMap.set(tradeId, {
            tradeId,
            title: '',
            category: '',
            buyPrice: 0,
            aiEstimatedValue: 0,
            potentialReward: 0,
            potentialLoss: 0,
            rewardToRiskRatio: 0,
            probabilityOfProfit: 0,
            expectedValue: 0,
            riskLevel: clampEnum(a.riskLevel, VALID_RISK, 'MEDIUM'),
            rewardLevel: clampEnum(a.rewardLevel, VALID_REWARD, 'MEDIUM'),
            riskRewardGrade: clampEnum(a.riskRewardGrade, VALID_GRADE, 'C'),
            confidenceInAssessment: clampNumber(
              a.confidenceInAssessment,
              0,
              100,
              60,
            ),
            keyRiskFactors: sanitizeStringArray(a.keyRiskFactors, 5),
            mitigationStrategies: sanitizeStringArray(
              a.mitigationStrategies,
              5,
            ),
            finalRecommendation: clampEnum(
              a.finalRecommendation,
              VALID_REC,
              'HOLD',
            ),
          });
        }

        // Merge AI fields back into items (preserve DB numbers)
        if (aiMap.size > 0) {
          for (const item of items) {
            const ai = aiMap.get(item.tradeId);
            if (!ai) continue;
            item.riskLevel = ai.riskLevel;
            item.rewardLevel = ai.rewardLevel;
            item.riskRewardGrade = ai.riskRewardGrade;
            item.confidenceInAssessment = ai.confidenceInAssessment;
            if (ai.keyRiskFactors.length > 0) item.keyRiskFactors = ai.keyRiskFactors;
            if (ai.mitigationStrategies.length > 0) item.mitigationStrategies = ai.mitigationStrategies;
            item.finalRecommendation = ai.finalRecommendation;
          }
          aiUsed = true;
        }
      }
    } catch (err) {
      logger.warn(
        '/api/ai/risk-reward-calculator',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { items });
    }

    // 6) Portfolio summary
    const portfolioRiskSummary = buildPortfolioSummary(items);

    return NextResponse.json({
      ok: true,
      items,
      portfolioRiskSummary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error('/api/ai/risk-reward-calculator', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

// --- Helper: build deterministic item assessment -------------------------

function buildDeterministicItem(base: {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  aiEstimatedValue: number;
  potentialReward: number;
  potentialLoss: number;
  rewardToRiskRatio: number;
  probabilityOfProfit: number;
  expectedValue: number;
  dealScore: number;
  aiRisk: number;
}): ItemAssessment {
  const ratio = base.rewardToRiskRatio;
  const riskLevel = deterministicRiskLevel(ratio);
  const rewardLevel = deterministicRewardLevel(
    base.potentialReward,
    base.buyPrice,
  );
  const grade = deterministicGrade(ratio);
  const rec = deterministicRecommendation(ratio, base.expectedValue);

  // Confidence: higher with higher dealScore + lower aiRisk
  let conf = 50;
  if (base.dealScore >= 70) conf += 20;
  else if (base.dealScore >= 50) conf += 10;
  else if (base.dealScore < 30) conf -= 10;
  if (base.aiRisk > 0 && base.aiRisk <= 3) conf += 15;
  else if (base.aiRisk > 0 && base.aiRisk <= 5) conf += 5;
  else if (base.aiRisk >= 7) conf -= 10;
  conf = Math.max(10, Math.min(100, conf));

  // Deterministic risk factors based on data
  const risks: string[] = [];
  if (ratio < 1) risks.push('Nizko razmerje reward/risk (<1) — visoka izpostavljenost tveganju.');
  if (base.expectedValue < 0) risks.push(`Negativni expected value (${base.expectedValue}€) — povprečno pričakovanje je izguba.`);
  if (base.aiRisk >= 6) risks.push(`Visok AI risk (${base.aiRisk}/10) — kvaliteta item-a vprašljiva.`);
  if (base.dealScore < 30) risks.push(`Nizka ocena deal-a (${base.dealScore}/100) — slaba priložnost.`);
  if (base.potentialReward === 0) risks.push('Ni potencialnega reward-a (aiEstimatedValue <= buyPrice).');
  if (risks.length === 0) risks.push('Brez posebnih tveganj — dobro razmerje reward/risk.');

  // Deterministic mitigation strategies
  const mitigations: string[] = [];
  if (ratio < 1) mitigations.push('Zmanjšaj buyPrice z negotiation ali počakaj na ceno drop.');
  if (base.dealScore < 50) mitigations.push('Ponovno evaluiraj deal — preveri alternative.');
  if (base.aiRisk >= 6) mitigations.push('Preveri stanje item-a (slike, opis) pred nakupom/prodajo.');
  mitigations.push('Diverzificiraj — ne investiraj več kot 20% kapitala v en item.');
  if (base.potentialReward > base.buyPrice * 0.3) {
    mitigations.push('Razmisli o hitri prodaji pri dosegu aiEstimatedValue za锁定 profit.');
  }

  return {
    tradeId: base.tradeId,
    title: base.title,
    category: base.category,
    buyPrice: Math.round(base.buyPrice),
    aiEstimatedValue: Math.round(base.aiEstimatedValue),
    potentialReward: Math.round(base.potentialReward),
    potentialLoss: Math.round(base.potentialLoss),
    rewardToRiskRatio: base.rewardToRiskRatio,
    probabilityOfProfit: base.probabilityOfProfit,
    expectedValue: base.expectedValue,
    riskLevel,
    rewardLevel,
    riskRewardGrade: grade,
    confidenceInAssessment: conf,
    keyRiskFactors: risks.slice(0, 5),
    mitigationStrategies: mitigations.slice(0, 5),
    finalRecommendation: rec,
  };
}

// --- Helper: sanitize string array from AI ------------------------------

function sanitizeStringArray(raw: unknown, maxItems: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (s.length === 0) continue;
    out.push(s.slice(0, 200));
    if (out.length >= maxItems) break;
  }
  return out;
}
