// v7.53 / v8.94-refactor: Batch Deal Evaluator — oceni 50 oglasov v enem AI klicu.
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// Problem: 50 novih oglasov = 50 AI klicev = 50x strošek + 50x čas.
// Rešitev: 1 AI klic z 50 oglasi v enem promptu → 10x ceneje + 10x hitreje.
//
// POST /api/ai/batch-deal-evaluator
// Body: { monitorId?: string, limit?: number }
// Returns: { ok, evaluated: number, skipped: number, results: [...] }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';
import { filterForEvaluation } from '@/lib/ai-cache';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 120;

const MAX_BATCH_SIZE = 50; // max listings per AI call

interface BatchDealEvaluatorInput {
  monitorId?: string;
  limit: number;
}

interface BatchListing {
  id: string;
  title: string;
  price: number | null;
  priceText: string;
  description: string | null;
  location: string | null;
  monitor: { source: string | null; name: string | null } | null;
}

export const POST = withAiRoute<BatchDealEvaluatorInput>({
  endpoint: '/api/ai/batch-deal-evaluator',
  maxDuration: 120,
  enforceBudget: true, // AI klic — preveri budget + zabeleži AI call

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      monitorId: body?.monitorId ? String(body.monitorId) : undefined,
      limit: Math.min(Math.max(Number(body?.limit) || 50, 1), MAX_BATCH_SIZE),
    };
  },

  // No validateInput — vsi input-i imajo defaults

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;
    const { monitorId, limit } = input;

    // 1. Find un-evaluated listings (or stale cache)
    const candidates = await db.listing.findMany({
      where: {
        isHidden: false,
        ...(monitorId ? { monitorId } : {}),
        OR: [
          { aiEvaluatedAt: null },
          { aiEvaluatedAt: { lt: new Date(Date.now() - 6 * 60 * 60 * 1000) } },
        ],
      },
      select: {
        id: true, title: true, price: true, priceText: true, description: true,
        location: true, url: true, firstSeenAt: true,
        monitor: { select: { source: true, name: true } },
      },
      orderBy: { firstSeenAt: 'desc' },
      take: limit * 2, // fetch more, then filter
    });

    if (candidates.length === 0) {
      return apiOk({ ok: true, evaluated: 0, skipped: 0, message: 'Vsi oglasi so že ocenjeni.' });
    }

    // 2. Filter via cache — skip recently evaluated
    const { toEvaluate, savedCalls } = await filterForEvaluation(
      candidates.map(l => ({ id: l.id, price: l.price, title: l.title })),
    );

    if (toEvaluate.length === 0) {
      return apiOk({
        ok: true, evaluated: 0, skipped: savedCalls,
        message: `Vsi ${savedCalls} oglasov so v cache-u — 0 AI klicev.`,
      });
    }

    // 3. Take only MAX_BATCH_SIZE
    const batch = toEvaluate.slice(0, MAX_BATCH_SIZE);
    const batchListings: BatchListing[] = candidates.filter(l => batch.some(b => b.id === l.id));

    // 4. Build batch prompt + call AI
    const prompt = buildBatchPrompt(batchListings);
    const raw = await callAi(prompt);
    const parsed: unknown = parseAi(raw);
    const evaluations = extractEvaluations(parsed);

    // 5. Save results to DB
    let savedCount = 0;
    for (const ev of evaluations) {
      const updateData = sanitizeEvaluationForDb(ev, batchListings);
      if (!updateData) continue;
      try {
        await db.listing.update({ where: { id: String(ev.id) }, data: updateData });
        savedCount += 1;
      } catch {
        // Skip individual save errors
      }
    }

    logger.info('/api/ai/batch-deal-evaluator', `Batch: ${savedCount} evaluated, ${savedCalls} cached, 1 AI call`);

    return apiOk({
      ok: true,
      evaluated: savedCount,
      skipped: savedCalls,
      totalProcessed: savedCount + savedCalls,
      aiCallsMade: 1, // just 1 call for entire batch!
      costSavingVsIndividual: savedCount, // saved N-1 API calls
      results: evaluations.map((e) => sanitizeResult(e)),
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

/** Extract evaluations array from parsed AI response (loose shape). */
function extractEvaluations(parsed: unknown): Array<Record<string, unknown>> {
  if (!parsed || typeof parsed !== 'object') return [];
  const obj = parsed as { evaluations?: unknown };
  if (!Array.isArray(obj.evaluations)) return [];
  return obj.evaluations.filter((e): e is Record<string, unknown> =>
    !!e && typeof e === 'object' && !!(e as Record<string, unknown>)?.id,
  );
}

/** Build batch prompt za AI evalvacijo N oglasov hkrati. */
function buildBatchPrompt(batchListings: BatchListing[]): string {
  const listingsText = batchListings.map((l, i) =>
    `${i + 1}. [ID:${l.id}] ${l.title} | ${l.priceText} | ${l.location || '?'} | ${l.monitor?.source || '?'} | ${(l.description || '').slice(0, 100)}`
  ).join('\n');

  return `Si AI analitik slovenskega trga rabljenih dobrin. Oceni te oglase hkrati.

OGLASI (${batchListings.length}):
${listingsText}

Za vsak oglas določi:
1. deal_score (0-100) — 100 = izjemna priložnost, 0 = ne zanimivo
2. verdict — PRILIKA / SUMNJIVO / NEZANIMIVO
3. estimated_value_eur — realna tržna vrednost (EUR)
4. risk_level (1-10) — 1 = varno, 10 = prevara
5. one_line_reason — kratek razlog v slovenščini (max 100 znakov)

PRAVILA:
- deal_score >= 70 + risk <= 3 = PRILIKA
- risk >= 6 = SUMNJIVO
- Ostalo = NEZANIMIVO
- estimated_value = null če ne moreš oceniti
- Bodii konzervativen — raje podceni kot preceni

Odgovori LE z JSON:
{
  "evaluations": [
    { "id": "<listing_id>", "deal_score": <number>, "verdict": "<string>", "estimated_value_eur": <number|null>, "risk_level": <number>, "reason": "<string>" }
  ]
}${GROUNDING_PROMPT_SUFFIX}`;
}

/** Prisma update data za eno AI evalvacijo (z anti-hallucination clamp-i). */
interface ListingAiUpdate {
  dealScore: number;
  dealScoreReason: string;
  dealScoreComputedAt: Date;
  aiScore: number;
  aiRisk: number;
  aiVerdict: string;
  aiReason: string;
  aiEstimatedValue: number | null;
  aiEvaluatedAt: Date;
}

/**
 * Sanitize AI evaluation output for DB write.
 * Returns Prisma update data ali null če id manjka.
 * Anti-hallucination: clamp estValue na 3x asking price max, 0.3x min.
 */
function sanitizeEvaluationForDb(
  ev: Record<string, unknown>,
  batchListings: BatchListing[],
): ListingAiUpdate | null {
  if (!ev?.id) return null;

  const dealScore = Math.max(0, Math.min(100, Math.round(Number(ev.deal_score ?? 0))));
  const risk = Math.max(1, Math.min(10, Math.round(Number(ev.risk_level ?? 5))));
  const verdict = ['PRILIKA', 'SUMNJIVO', 'NEZANIMIVO'].includes(String(ev.verdict))
    ? String(ev.verdict) : 'NEZANIMIVO';
  const estValue = ev.estimated_value_eur != null
    ? Math.max(0, Math.round(Number(ev.estimated_value_eur))) : null;

  // Anti-hallucination: clamp estValue to 3x asking price max
  const listing = batchListings.find(l => l.id === ev.id);
  let finalEstValue = estValue;
  if (finalEstValue != null && listing?.price && listing.price > 0) {
    if (finalEstValue > listing.price * 3) finalEstValue = Math.round(listing.price * 2);
    if (finalEstValue < listing.price * 0.3) finalEstValue = Math.round(listing.price * 0.5);
  }

  return {
    dealScore,
    dealScoreReason: String(ev.reason ?? '').slice(0, 200),
    dealScoreComputedAt: new Date(),
    aiScore: Math.max(1, Math.min(10, Math.round(dealScore / 10))),
    aiRisk: risk,
    aiVerdict: verdict,
    aiReason: String(ev.reason ?? '').slice(0, 600),
    aiEstimatedValue: finalEstValue,
    aiEvaluatedAt: new Date(),
  };
}

/** Transform parsed AI evaluation v response result object. */
function sanitizeResult(e: Record<string, unknown>): {
  id: string;
  dealScore: number;
  verdict: string;
  estimatedValue: number | null;
  risk: number;
  reason: string;
} {
  return {
    id: String(e.id ?? ''),
    dealScore: Math.max(0, Math.min(100, Math.round(Number(e.deal_score ?? 0)))),
    verdict: String(e.verdict ?? 'NEZANIMIVO'),
    estimatedValue: e.estimated_value_eur != null ? Math.round(Number(e.estimated_value_eur)) : null,
    risk: Math.max(1, Math.min(10, Math.round(Number(e.risk_level ?? 5)))),
    reason: String(e.reason ?? '').slice(0, 100),
  };
}