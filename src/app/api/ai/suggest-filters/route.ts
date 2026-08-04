// v5.2: Smart Filters — AI predlaga keywords/excludeKeywords glede na pretekle rezultate
// POST /api/ai/suggest-filters
// Body: { monitorId: string } — analiza existing listings za ta monitor
// Body: { source: string, sourceUrl: string, currentKeywords?: string, currentExcludeKeywords?: string } — analiza brez monitorja
// Returns: { ok, suggestions: { keywords, excludeKeywords, reasoning, confidence, sampleBadListings, sampleGoodListings } }

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
    const body = await req.json();
    const monitorId = body?.monitorId;
    const source = body?.source;
    const sourceUrl = body?.sourceUrl;
    const currentKeywords = body?.currentKeywords ?? '';
    const currentExcludeKeywords = body?.currentExcludeKeywords ?? '';

    // Gather existing listings for analysis
    let listings: any[] = [];
    let monitorInfo: any = null;

    if (monitorId) {
      const monitor = await db.monitor.findUnique({ where: { id: monitorId } });
      if (!monitor) {
        return NextResponse.json({ error: 'Monitor ne obstaja' }, { status: 404 });
      }
      monitorInfo = monitor;
      listings = await db.listing.findMany({
        where: { monitorId },
        orderBy: { firstSeenAt: 'desc' },
        take: 100,
        select: {
          id: true,
          title: true,
          price: true,
          priceText: true,
          location: true,
          description: true,
          aiVerdict: true,
          aiScore: true,
          aiRisk: true,
          aiReason: true,
          aiEstimatedValue: true,
          dealScore: true,
          isBookmarked: true,
          isHidden: true,
          firstSeenAt: true,
        },
      });
    } else if (source && sourceUrl) {
      // No monitor yet — use URL/source as context
      monitorInfo = { source, sourceUrl, name: 'Nov monitor', keywords: currentKeywords, excludeKeywords: currentExcludeKeywords };
    } else {
      return NextResponse.json({ error: 'Potreben je monitorId ali (source + sourceUrl)' }, { status: 400 });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '',
      fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // Categorize listings by quality
    const goodListings = listings.filter(l =>
      l.aiVerdict === 'PRILIKA' || (l.dealScore != null && l.dealScore >= 60) || l.isBookmarked
    ).slice(0, 15);
    const badListings = listings.filter(l =>
      l.aiVerdict === 'SUMNJIVO' || (l.aiRisk != null && l.aiRisk >= 7) || l.isHidden
    ).slice(0, 15);
    const neutralListings = listings.filter(l =>
      l.aiVerdict === 'NEZANIMIVO' || (l.aiScore != null && l.aiScore < 5)
    ).slice(0, 10);

    const prompt = buildFilterPrompt(monitorInfo, listings, goodListings, badListings, neutralListings);

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fallbackSettings: AiSettings = {
          provider: aiSettings.fallbackProvider,
          baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '',
          model: aiSettings.fallbackModel,
        };
        raw = await callProviderForRaw(fallbackSettings, prompt);
      } else {
        throw primaryError;
      }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const suggestions = {
      keywords: String(parsed?.keywords ?? parsed?.kljucne_besede ?? '').slice(0, 500),
      excludeKeywords: String(parsed?.exclude_keywords ?? parsed?.excludeKeywords ?? parsed?.izkljucene_besede ?? '').slice(0, 500),
      reasoning: String(parsed?.reasoning ?? parsed?.razlog ?? '').slice(0, 1500),
      confidence: clampInt(parsed?.confidence, 0, 100) ?? 50,
      sampleBadListings: parsed?.sample_bad ?? parsed?.slabi_primeri ?? [],
      sampleGoodListings: parsed?.sample_good ?? parsed?.dobri_primeri ?? [],
    };

    // Increment AI usage counter
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({
        where: { id: 'singleton' },
        data: { aiCallsDate: today, aiCallsToday: 1 },
      });
    } else {
      await db.settings.update({
        where: { id: 'singleton' },
        data: { aiCallsToday: { increment: 1 } },
      });
    }

    return NextResponse.json({
      ok: true,
      suggestions,
      currentKeywords: monitorInfo?.keywords ?? currentKeywords,
      currentExcludeKeywords: monitorInfo?.excludeKeywords ?? currentExcludeKeywords,
      analyzedListings: listings.length,
      analyzedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    logger.error("/api/ai/suggest-filters", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka pri AI analizi filtrov' }, { status: 500 });
  }
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

function clampInt(v: any, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
}
