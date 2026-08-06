// v7.53: Batch Deal Evaluator — oceni 50 oglasov v enem AI klicu.
//
// Problem: 50 novih oglasov = 50 AI klicev = 50x strošek + 50x čas.
// Rešitev: 1 AI klic z 50 oglasi v enem promptu → 10x ceneje + 10x hitreje.
//
// POST /api/ai/batch-deal-evaluator
// Body: { monitorId?: string, limit?: number }
// Returns: { ok, evaluated: number, skipped: number, results: [...] }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { filterForEvaluation } from '@/lib/ai-cache';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_BATCH_SIZE = 50; // max listings per AI call

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const monitorId = body?.monitorId;
    const limit = Math.min(Math.max(Number(body?.limit) || 50, 1), MAX_BATCH_SIZE);

    // Find un-evaluated listings (or stale cache)
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
      return NextResponse.json({ ok: true, evaluated: 0, skipped: 0, message: 'Vsi oglasi so že ocenjeni.' });
    }

    // Filter via cache — skip recently evaluated
    const { toEvaluate, cached, savedCalls } = await filterForEvaluation(
      candidates.map(l => ({ id: l.id, price: l.price, title: l.title })),
    );

    if (toEvaluate.length === 0) {
      return NextResponse.json({
        ok: true, evaluated: 0, skipped: savedCalls,
        message: `Vsi ${savedCalls} oglasov so v cache-u — 0 AI klicev.`,
      });
    }

    // Take only MAX_BATCH_SIZE
    const batch = toEvaluate.slice(0, MAX_BATCH_SIZE);
    const batchListings = candidates.filter(l => batch.some(b => b.id === l.id));

    // Build batch prompt
    const listingsText = batchListings.map((l, i) =>
      `${i + 1}. [ID:${l.id}] ${l.title} | ${l.priceText} | ${l.location || '?'} | ${l.monitor?.source || '?'} | ${(l.description || '').slice(0, 100)}`
    ).join('\n');

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si AI analitik slovenskega trga rabljenih dobrin. Oceni te oglase hkrati.

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

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else {
        return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const evaluations = (parsed?.evaluations || []).filter((e: any) => e?.id);

    // Save results to DB
    let savedCount = 0;
    for (const ev of evaluations) {
      try {
        const dealScore = Math.max(0, Math.min(100, Math.round(Number(ev.deal_score ?? 0))));
        const risk = Math.max(1, Math.min(10, Math.round(Number(ev.risk_level ?? 5))));
        const verdict = ['PRILIKA', 'SUMNJIVO', 'NEZANIMIVO'].includes(String(ev.verdict)) ? String(ev.verdict) : 'NEZANIMIVO';
        const estValue = ev.estimated_value_eur != null ? Math.max(0, Math.round(Number(ev.estimated_value_eur))) : null;

        // Anti-hallucination: clamp estValue to 3x asking price max
        const listing = batchListings.find(l => l.id === ev.id);
        let finalEstValue = estValue;
        if (finalEstValue && listing?.price && listing.price > 0) {
          if (finalEstValue > listing.price * 3) finalEstValue = Math.round(listing.price * 2);
          if (finalEstValue < listing.price * 0.3) finalEstValue = Math.round(listing.price * 0.5);
        }

        await db.listing.update({
          where: { id: String(ev.id) },
          data: {
            dealScore,
            dealScoreReason: String(ev.reason ?? '').slice(0, 200),
            dealScoreComputedAt: new Date(),
            aiScore: Math.max(1, Math.min(10, Math.round(dealScore / 10))),
            aiRisk: risk,
            aiVerdict: verdict,
            aiReason: String(ev.reason ?? '').slice(0, 600),
            aiEstimatedValue: finalEstValue,
            aiEvaluatedAt: new Date(),
          },
        });
        savedCount += 1;
      } catch (e) {
        // Skip individual save errors
      }
    }

    // Track AI call
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    logger.info('/api/ai/batch-deal-evaluator', `Batch: ${savedCount} evaluated, ${savedCalls} cached, 1 AI call`);

    return NextResponse.json({
      ok: true,
      evaluated: savedCount,
      skipped: savedCalls,
      totalProcessed: savedCount + savedCalls,
      aiCallsMade: 1, // just 1 call for entire batch!
      costSavingVsIndividual: savedCount, // saved N-1 API calls
      results: evaluations.map((e: any) => ({
        id: String(e.id ?? ''),
        dealScore: Math.max(0, Math.min(100, Math.round(Number(e.deal_score ?? 0)))),
        verdict: String(e.verdict ?? 'NEZANIMIVO'),
        estimatedValue: e.estimated_value_eur != null ? Math.round(Number(e.estimated_value_eur)) : null,
        risk: Math.max(1, Math.min(10, Math.round(Number(e.risk_level ?? 5)))),
        reason: String(e.reason ?? '').slice(0, 100),
      })),
    });
  } catch (err: any) {
    logger.error('/api/ai/batch-deal-evaluator', 'POST handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
