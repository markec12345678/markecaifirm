// v4.5: AI Daily Summary — generate a Slovenian summary of the best opportunities in last 24h.
// POST /api/digest/ai-summary
// Body: { hours?: number (default 24), limit?: number (default 20) }
// Returns: { ok, summary, stats, generatedAt }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const hoursRaw = typeof body.hours === 'number' ? body.hours : Number(body.hours);
    const hours = Number.isFinite(hoursRaw) ? Math.min(168, Math.max(1, hoursRaw)) : 24;
    const limitRaw = typeof body.limit === 'number' ? body.limit : Number(body.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(5, limitRaw)) : 20;

    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Get top opportunities (by aiScore desc, then dealScore desc) from last N hours
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: since },
        isHidden: false,
        OR: [
          { aiVerdict: 'PRILIKA' },
          { dealScore: { gte: 60 } },
        ],
      },
      orderBy: [
        { aiScore: 'desc' },
        { dealScore: 'desc' },
      ],
      take: limit,
      select: {
        id: true,
        title: true,
        price: true,
        priceText: true,
        location: true,
        url: true,
        aiVerdict: true,
        aiScore: true,
        aiRisk: true,
        aiReason: true,
        aiEstimatedValue: true,
        dealScore: true,
        dealScoreReason: true,
        targetPrice: true,
        monitor: { select: { name: true, source: true } },
      },
    });

    // Stats
    const totalAlerts = await db.alert.count({
      where: { createdAt: { gte: since } },
    });
    const totalNewListings = await db.listing.count({
      where: { firstSeenAt: { gte: since } },
    });
    const totalBookmarked = await db.listing.count({
      where: { isBookmarked: true, firstSeenAt: { gte: since } },
    });

    if (listings.length === 0) {
      return NextResponse.json({
        ok: true,
        summary: `V zadnjih ${hours} urah ni bilo novih priložnosti, ki bi zadoščale kriterijem (PRILIKA ali dealScore ≥ 60). Skupaj novih oglasov: ${totalNewListings}, alertov: ${totalAlerts}.`,
        listings: [],
        stats: { hours, totalNewListings, totalAlerts, totalBookmarked, opportunitiesFound: 0 },
        generatedAt: new Date().toISOString(),
      });
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

    const prompt = buildSummaryPrompt(listings, {
      hours,
      totalNewListings,
      totalAlerts,
      totalBookmarked,
    });

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
    const summary = String(parsed?.summary ?? parsed?.povzetek ?? raw ?? '').slice(0, 5000);
    const topPick: string | null = parsed?.top_pick ?? parsed?.topPick ?? null;
    const recommendation: string | null = parsed?.recommendation ?? parsed?.priporocilo ?? null;

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
      summary,
      topPick,
      recommendation,
      listings: listings.map(l => ({
        id: l.id,
        title: l.title,
        price: l.price,
        priceText: l.priceText,
        location: l.location,
        url: l.url,
        aiVerdict: l.aiVerdict,
        aiScore: l.aiScore,
        dealScore: l.dealScore,
        dealScoreReason: l.dealScoreReason,
        monitor: l.monitor,
      })),
      stats: {
        hours,
        totalNewListings,
        totalAlerts,
        totalBookmarked,
        opportunitiesFound: listings.length,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'AI summary failed' }, { status: 500 });
  }
}

function buildSummaryPrompt(listings: any[], stats: any): string {
  const lines: string[] = [
    'Si pomočnik za analizo priložnosti na slovenskih spletnih oglasih.',
    `Na podlagi spodnjih ${listings.length} oglasov iz zadnjih ${stats.hours} ur napiši jedrnat POVZETEK v slovenščini.`,
    '',
    `Statistika: novih oglasov ${stats.totalNewListings}, alertov ${stats.totalAlerts}, shranjenih ${stats.totalBookmarked}, priložnosti v povzetku ${listings.length}.`,
    '',
    'Oglasi (urejeni po AI oceni priložnosti):',
    '',
  ];

  listings.forEach((l, i) => {
    lines.push(`--- Oglas #${i + 1} ---`);
    lines.push(`Naslov: ${l.title}`);
    lines.push(`Cena: ${l.priceText}${l.price ? ` (${l.price}€)` : ''}`);
    if (l.location) lines.push(`Lokacija: ${l.location}`);
    if (l.aiVerdict) lines.push(`AI verdikt: ${l.aiVerdict}`);
    if (l.aiScore != null) lines.push(`AI ocena prilike: ${l.aiScore}/10`);
    if (l.aiRisk != null) lines.push(`AI tveganje: ${l.aiRisk}/10`);
    if (l.dealScore != null) lines.push(`Deal Score: ${l.dealScore}/100`);
    if (l.dealScoreReason) lines.push(`Razlog: ${l.dealScoreReason}`);
    if (l.aiReason) lines.push(`AI razlog: ${l.aiReason}`);
    if (l.aiEstimatedValue != null) lines.push(`AI tržna vrednost: ${l.aiEstimatedValue}€`);
    if (l.targetPrice != null) lines.push(`Uporabnikova ciljna cena: ${l.targetPrice}€`);
    if (l.monitor?.name) lines.push(`Monitor: ${l.monitor.name} (${l.monitor.source})`);
    lines.push('');
  });

  lines.push('Navodila za povzetek:');
  lines.push('1. Začenji s kratkim pregledom (1-2 stavka) o tem, kaj se je zgodilo v zadnjih urah.');
  lines.push('2. Izpostavi TOP 3 najbolj zanimive oglase (poimenuj jih "TOP #1", "TOP #2", "TOP #3") s kratkim razlogom zakaj so zanimivi.');
  lines.push('3. Omeni morebitne trende (npr. "več telefonov kot običajno", "cene padajo").');
  lines.push('4. Na koncu dodaj praktično priporočilo za uporabnika (kaj naj stori).');
  lines.push('5. Skupna dolžina: 200-500 besed. Slovenščina, neposredno in jedrnato.');
  lines.push('');
  lines.push('Odgovori LE z JSON v tej obliki:');
  lines.push('{"summary": "<celoten povzetek v markdown formatu>", "top_pick": "<naslov najboljšega oglasa ali null>", "recommendation": "<kratko priporočilo>"}');
  return lines.join('\n');
}
