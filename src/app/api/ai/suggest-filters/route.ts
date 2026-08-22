// v5.2 / v8.94-refactor: Smart Filters — AI predlaga keywords/excludeKeywords
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/suggest-filters
// Body: { monitorId: string } — analiza existing listings za ta monitor
// Body: { source: string, sourceUrl: string, currentKeywords?: string, currentExcludeKeywords?: string } — analiza brez monitorja
// Returns: { ok, suggestions: { keywords, excludeKeywords, reasoning, confidence, ... } }

import { NextResponse } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface SuggestFiltersInput {
  monitorId?: string;
  source?: string;
  sourceUrl?: string;
  currentKeywords?: string;
  currentExcludeKeywords?: string;
}

export const POST = withAiRoute<SuggestFiltersInput>({
  endpoint: '/api/ai/suggest-filters',
  maxDuration: 60,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      monitorId: body?.monitorId ? String(body.monitorId) : undefined,
      source: body?.source ? String(body.source) : undefined,
      sourceUrl: body?.sourceUrl ? String(body.sourceUrl) : undefined,
      currentKeywords: body?.currentKeywords ? String(body.currentKeywords) : '',
      currentExcludeKeywords: body?.currentExcludeKeywords ? String(body.currentExcludeKeywords) : '',
    };
  },

  validateInput: (input) => {
    if (!input.monitorId && !(input.source && input.sourceUrl)) {
      return 'Potreben je monitorId ali (source + sourceUrl)';
    }
    return null;
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    // 1. Pridobi monitor in listings
    const { monitor, listings } = await resolveMonitorAndListings(input, db);

    // 2. Kategoriziraj listings po kakovosti
    const goodListings = listings.filter(l =>
      l.aiVerdict === 'PRILIKA' || (l.dealScore != null && l.dealScore >= 60) || l.isBookmarked
    ).slice(0, 15);
    const badListings = listings.filter(l =>
      l.aiVerdict === 'SUMNJIVO' || (l.aiRisk != null && l.aiRisk >= 7) || l.isHidden
    ).slice(0, 15);
    const neutralListings = listings.filter(l =>
      l.aiVerdict === 'NEZANIMIVO' || (l.aiScore != null && l.aiScore < 5)
    ).slice(0, 10);

    // 3. AI klic
    const prompt = buildFilterPrompt(monitor, listings, goodListings, badListings, neutralListings);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    // 4. Transformacija rezultata
    const suggestions = {
      keywords: String(parsed?.keywords ?? parsed?.kljucne_besede ?? '').slice(0, 500),
      excludeKeywords: String(parsed?.exclude_keywords ?? parsed?.excludeKeywords ?? parsed?.izkljucene_besede ?? '').slice(0, 500),
      reasoning: String(parsed?.reasoning ?? parsed?.razlog ?? '').slice(0, 1500),
      confidence: clampInt(parsed?.confidence, 0, 100) ?? 50,
      sampleBadListings: parsed?.sample_bad ?? parsed?.slabi_primeri ?? [],
      sampleGoodListings: parsed?.sample_good ?? parsed?.dobri_primeri ?? [],
    };

    return apiOk({
      suggestions,
      currentKeywords: monitor.keywords ?? input.currentKeywords ?? '',
      currentExcludeKeywords: monitor.excludeKeywords ?? input.currentExcludeKeywords ?? '',
      analyzedListings: listings.length,
      analyzedAt: new Date().toISOString(),
    });
  },
});

// --- Pomožne funkcije -----------------------------------------------------

async function resolveMonitorAndListings(
  input: SuggestFiltersInput,
  db: AiRouteContext['db']
): Promise<{ monitor: any; listings: any[] }> {
  if (input.monitorId) {
    const monitor = await db.monitor.findUnique({ where: { id: input.monitorId } });
    if (!monitor) {
      throw new ApiRouteError('Monitor ne obstaja', 404);
    }
    const listings = await db.listing.findMany({
      where: { monitorId: input.monitorId },
      orderBy: { firstSeenAt: 'desc' },
      take: 100,
      select: {
        id: true, title: true, price: true, priceText: true,
        location: true, description: true,
        aiVerdict: true, aiScore: true, aiRisk: true, aiReason: true,
        aiEstimatedValue: true, dealScore: true,
        isBookmarked: true, isHidden: true, firstSeenAt: true,
      },
    });
    return { monitor, listings };
  }

  // Direct mode (brez monitorja)
  return {
    monitor: {
      source: input.source,
      sourceUrl: input.sourceUrl,
      name: 'Nov monitor',
      keywords: input.currentKeywords,
      excludeKeywords: input.currentExcludeKeywords,
    },
    listings: [],
  };
}

function buildFilterPrompt(monitor: any, allListings: any[], good: any[], bad: any[], neutral: any[]): string {
  const parts: string[] = [
    'Si ekspert za optimizacijo iskalnih filtrov za slovenske spletne oglase.',
    'Na podlagi preteklih oglasov in AI ocen predlagaj boljše filtre (keywords + excludeKeywords).',
    '',
    `*Monitor:* ${monitor.name}`,
    `*Vir:* ${monitor.source}`,
    `*URL:* ${monitor.sourceUrl}`,
    `*Trenutni keywords:* "${monitor.keywords ?? ''}"`,
    `*Trenutni excludeKeywords:* "${monitor.excludeKeywords ?? ''}"`,
    '',
    `*Skupaj oglasov v bazi:* ${allListings.length}`,
  ];

  if (good.length > 0) {
    parts.push('', `*Dobri oglasi (${good.length}, AI PRILIKA ali dealScore≥60):*`);
    good.slice(0, 10).forEach((l, i) => {
      parts.push(`${i + 1}. ${l.title} (${l.priceText}) — verdict:${l.aiVerdict ?? '?'}, score:${l.aiScore ?? '?'}, deal:${l.dealScore ?? '?'}`);
    });
  }

  if (bad.length > 0) {
    parts.push('', `*Slabi oglasi (${bad.length}, SUMNJIVO ali hidden):*`);
    bad.slice(0, 10).forEach((l, i) => {
      parts.push(`${i + 1}. ${l.title} (${l.priceText}) — verdict:${l.aiVerdict ?? '?'}, risk:${l.aiRisk ?? '?'}`);
    });
  }

  if (neutral.length > 0) {
    parts.push('', `*Nezanimivi oglasi (${neutral.length}):*`);
    neutral.slice(0, 5).forEach((l, i) => {
      parts.push(`${i + 1}. ${l.title} (${l.priceText}) — score:${l.aiScore ?? '?'}`);
    });
  }

  parts.push('', 'Analiziraj:');
  parts.push('1. Katere besede se pogosto pojavljajo v DOBRIH oglasih? (te naj bi keywords ujeli)');
  parts.push('2. Katere besede se pojavljajo v SLABIH/NEZANIMIVIH oglasih? (te naj bi excludeKeywords izločili)');
  parts.push('3. Predlagaj boljše keywords (več specifičnosti, manj šuma)');
  parts.push('4. Predlagaj excludeKeywords (npr. "case", "maska", "rezervni" za telefone)');
  parts.push('5. Keywords naj bodo splošne besede (ne številk, ne dolgih fraz)');
  parts.push('', 'Odgovori LE z JSON v tej obliki:');
  parts.push('{');
  parts.push('  "keywords": "<comma-separated, max 10 ključnih besed>",');
  parts.push('  "exclude_keywords": "<comma-separated, max 15 izključitev>",');
  parts.push('  "reasoning": "<kratek razlog v slovenščini, max 400 znakov>",');
  parts.push('  "confidence": <0-100>,');
  parts.push('  "sample_good": ["<naslovi 3 dobrih oglasov ki bi jih ujeli novi filtri>"],');
  parts.push('  "sample_bad": ["<naslovi 3 slabih oglasov ki bi jih izločili novi filtri>"]');
  parts.push('}');

  return parts.join('\n');
}

function clampInt(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
}
