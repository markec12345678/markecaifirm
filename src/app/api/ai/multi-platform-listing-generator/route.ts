// v7.60: Multi-Platform Listing Generator — AI generira optimizirano vsebino
// za 5 platform hkrati (Bolha, Vinted, Facebook Marketplace, mobile.de,
// Kleinanzeigen). Vsaka platforma ima drugačne SEO zahteve, omejitve dolžine
// naslova, sistem tag-ov in ton občinstva.
//
// "PS5 → Bolha: 'PS5 Digital 2024 + 2 controllerja' (380€, SEO 92),
//  Vinted: 'PlayStation 5 Digital' (320€, SEO 88)"
//
// GET+POST /api/ai/multi-platform-listing-generator
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

// --- Platform specs -----------------------------------------------------

interface PlatformSpec {
  key: 'bolha' | 'vinted' | 'facebook' | 'mobilede' | 'kleinanzeigen';
  label: string;
  maxTitleChars: number;
  maxTags: number;
  language: string;
  tone: string;
  descTargetWords: number;
}

const PLATFORMS: PlatformSpec[] = [
  { key: 'bolha', label: 'Bolha', maxTitleChars: 60, maxTags: 10, language: 'slovenian', tone: 'prijateljski', descTargetWords: 60 },
  { key: 'vinted', label: 'Vinted', maxTitleChars: 80, maxTags: 5, language: 'slovenian/english', tone: 'modno usmerjen', descTargetWords: 50 },
  { key: 'facebook', label: 'Facebook Marketplace', maxTitleChars: 100, maxTags: 6, language: 'slovenian', tone: 'lahkotnež, emoji OK, poudarek lokalno', descTargetWords: 70 },
  { key: 'mobilede', label: 'mobile.de', maxTitleChars: 50, maxTags: 8, language: 'german', tone: 'tehničen, profesionalen', descTargetWords: 80 },
  { key: 'kleinanzeigen', label: 'Kleinanzeigen', maxTitleChars: 70, maxTags: 6, language: 'german', tone: 'podroben, transakcijski', descTargetWords: 90 },
];

// --- Types ---------------------------------------------------------------

interface PlatformListing {
  title: string;
  description: string;
  tags: string[];
  suggestedPrice: number;
  seoScore: number;
}

interface HeldItemData {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  aiEstimatedValue: number;
  imageUrl: string | null;
}

interface MultiListing {
  tradeId: string;
  originalTitle: string;
  category: string;
  buyPrice: number;
  aiEstimatedValue: number;
  platforms: {
    bolha: PlatformListing;
    vinted: PlatformListing;
    facebook: PlatformListing;
    mobilede: PlatformListing;
    kleinanzeigen: PlatformListing;
  };
  bestPlatform: string;
  reasoning: string;
}

interface AiPlatformEntry {
  title?: unknown;
  description?: unknown;
  tags?: unknown;
  suggestedPrice?: unknown;
  seoScore?: unknown;
}

interface AiItemEntry {
  tradeId?: unknown;
  platforms?: Record<string, AiPlatformEntry>;
  reasoning?: unknown;
}

interface AiListingResponse {
  listings?: AiItemEntry[];
}

// --- Helpers -------------------------------------------------------------

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

function clampTags(raw: unknown, max: number, fallback: string[]): string[] {
  let arr: string[] = [];
  if (Array.isArray(raw)) {
    for (const t of raw) {
      if (typeof t === 'string' && t.trim()) arr.push(t.trim().slice(0, 30));
    }
  }
  if (arr.length === 0) arr = fallback.slice(0, max);
  return arr.slice(0, max);
}

function clampSeoScore(raw: unknown): number {
  let n = Number(raw);
  if (!Number.isFinite(n)) n = 60;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Anti-hallucination: clamp suggestedPrice to [0.7×, 1.2×] aiEstimatedValue
function clampPrice(raw: unknown, estValue: number, platform: PlatformSpec): number {
  const min = Math.round(estValue * 0.7);
  const max = Math.round(estValue * 1.2);
  let price = Number(raw);
  if (!Number.isFinite(price)) {
    // Fallback by platform: Vinted lower, mobilede standard, FB lower
    const platformFactor: Record<PlatformSpec['key'], number> = {
      bolha: 0.95,
      vinted: 0.88,
      facebook: 0.90,
      mobilede: 0.98,
      kleinanzeigen: 0.92,
    };
    price = Math.round(estValue * platformFactor[platform.key]);
  }
  return Math.max(min, Math.min(max, Math.round(price)));
}

// Deterministic platform listing — used as fallback
function deterministicPlatformListing(item: HeldItemData, spec: PlatformSpec): PlatformListing {
  const baseTitle = item.title || 'Item';
  // Truncate to platform max
  const title = baseTitle.slice(0, spec.maxTitleChars);
  const platformFactor: Record<PlatformSpec['key'], number> = {
    bolha: 0.95,
    vinted: 0.88,
    facebook: 0.90,
    mobilede: 0.98,
    kleinanzeigen: 0.92,
  };
  const suggestedPrice = clampPrice(null, item.aiEstimatedValue, spec);

  // Build description
  const descParts: string[] = [];
  if (spec.key === 'mobilede') {
    descParts.push(`${baseTitle}. Zustand: gebraucht, funktionsfähig.`);
    descParts.push(`Preis: ${suggestedPrice}€.`);
    descParts.push(`Bei Interesse bitte kontaktieren.`);
  } else if (spec.key === 'kleinanzeigen') {
    descParts.push(`${baseTitle}. Guter Zustand.`);
    descParts.push(`Preis: ${suggestedPrice}€ (VB).`);
    descParts.push(`Abholung oder Versand möglich.`);
  } else if (spec.key === 'vinted') {
    descParts.push(`${baseTitle}.`);
    descParts.push(`Stanje: dobro, ready za novo priložnost.`);
    descParts.push(`Cena: ${suggestedPrice}€ (vključno poštnino po dogovoru).`);
  } else if (spec.key === 'facebook') {
    descParts.push(`${baseTitle} 🏷️ ${item.category}.`);
    descParts.push(`Lokalno prevzemanje možno 📍. Cena ${suggestedPrice}€.`);
    descParts.push(`Piši v PM za več info!`);
  } else {
    // Bolha default
    descParts.push(`${baseTitle}. Stanje: dobro.`);
    descParts.push(`Kategorija: ${item.category}.`);
    descParts.push(`Cena: ${suggestedPrice}€. Pošiljanje ali osebni prevzem.`);
  }
  const description = descParts.join(' ').slice(0, spec.descTargetWords * 8);

  // Tags
  const tagSeeds = [item.category, 'rabljeno', 'dobro stanje', 'ugodno'];
  if (spec.key === 'mobilede' || spec.key === 'kleinanzeigen') {
    tagSeeds.push('gebraucht', 'guter Zustand');
  }
  if (spec.key === 'vinted') tagSeeds.push('vinted', 'moda');
  const tags = clampTags(tagSeeds, spec.maxTags, tagSeeds);

  return {
    title,
    description,
    tags,
    suggestedPrice,
    seoScore: 60, // deterministic fallback score
  };
}

function validatePlatformEntry(
  raw: AiPlatformEntry | undefined,
  spec: PlatformSpec,
  item: HeldItemData,
): PlatformListing {
  if (!raw) return deterministicPlatformListing(item, spec);

  const title = clampString(raw.title, spec.maxTitleChars, item.title || 'Item');
  const description = clampString(raw.description, spec.descTargetWords * 8, item.title || 'Item');
  const tags = clampTags(raw.tags, spec.maxTags, [item.category, 'rabljeno', 'dobro stanje']);
  const suggestedPrice = clampPrice(raw.suggestedPrice, item.aiEstimatedValue, spec);
  const seoScore = clampSeoScore(raw.seoScore);

  return { title, description, tags, suggestedPrice, seoScore };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleMultiPlatformListing(req);
}
export async function POST(req: NextRequest) {
  return handleMultiPlatformListing(req);
}

async function handleMultiPlatformListing(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-multi-platform-listing-generator', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    // Parse body for optional tradeId filter
    let requestedTradeId: string | null = null;
    try {
      const body = await req.json().catch(() => ({}));
      if (body && typeof body === 'object' && typeof body.tradeId === 'string' && body.tradeId.trim()) {
        requestedTradeId = body.tradeId.trim();
      }
    } catch {
      // GET request — no body, ignore
    }

    // 1) HELD trades with linked Listing
    const heldTrades = await db.trade.findMany({
      where: {
        status: 'held',
        ...(requestedTradeId ? { id: requestedTradeId } : {}),
      },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        listing: {
          select: {
            aiEstimatedValue: true,
            imageUrl: true,
            dealScore: true,
          },
        },
      },
      take: requestedTradeId ? 1 : 100,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        listings: [],
        summary: {
          totalItems: 0,
          listingsGenerated: 0,
          avgSeoScore: 0,
          bestPlatformOverall: '',
        },
        aiUsed: false,
        message: 'Ni held inventarja — ni item-ov za generiranje oglasov.',
      });
    }

    const items: HeldItemData[] = heldTrades.map(t => {
      const estValue =
        t.listing?.aiEstimatedValue && t.listing.aiEstimatedValue > 0
          ? t.listing.aiEstimatedValue
          : Math.round(t.buyPrice * 1.2);
      return {
        tradeId: t.id,
        title: t.title,
        category: (t.category || 'drugo').trim().toLowerCase(),
        buyPrice: t.buyPrice,
        aiEstimatedValue: estValue,
        imageUrl: t.listing?.imageUrl ?? null,
      };
    });

    // 2) AI cache
    const sortedIds = items.map(i => i.tradeId).sort().join(',');
    const cacheKey = `multi-platform-listing:${JSON.stringify(sortedIds)}`;
    const cached = getCachedAI<{
      listings: MultiListing[];
      summary: {
        totalItems: number;
        listingsGenerated: number;
        avgSeoScore: number;
        bestPlatformOverall: string;
      };
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        ...cached,
        cached: true,
        aiUsed: true,
      });
    }

    // 3) Build AI prompt
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

    // Cap to 30 items for AI (to keep prompt size manageable)
    const aiSlice = items.slice(0, 30);

    const itemsBlock = aiSlice
      .map(
        (i, idx) =>
          `${idx + 1}. tradeId=${i.tradeId} | naslov="${i.title}" | kategorija=${i.category} | nabava=${i.buyPrice}€ | estValue=${i.aiEstimatedValue}€ | slika=${i.imageUrl ? 'da' : 'ne'}`,
      )
      .join('\n');

    const platformSpecs = PLATFORMS.map(
      p =>
        `- ${p.label} (${p.key}): max naslov ${p.maxTitleChars} znakov, ${p.maxTags} tag-ov, jezik=${p.language}, ton=${p.tone}`,
    ).join('\n');

    const prompt = `Si SEO specialist za oglasne platforme. Generiraj optimizirano vsebino za 5 platform hkrati.

HELD INVENTAR (${aiSlice.length} item-ov):
${itemsBlock}

PLATFORM SPECIFIKACIJE:
${platformSpecs}

PRAVILA ZA GENERIRANJE:
1. Naslov mora biti kratek, ključne besede spredaj, znotraj omejitve znakov.
2. Opis naj vsebuje ključne besede, stanje, ceno, način prevzema.
3. Tag-i naj bodo iskalne besede, ki jih kupci dejansko iščejo.
4. suggestedPrice naj bo znotraj [0.7×, 1.2×] estValue (Vinted nižja, Bolha standardna, mobile.de višja).
5. seoScore 0-100 (višje = boljša optimizacija za iskalnik te platforme).
6. Za mobile.de in kleinanzeigen vse NEMŠKO. Za bolha in FB SLOVENSKO. Za Vinted slovensko ali angleško.

Odgovori LE z JSON:
{
  "listings": [
    {
      "tradeId": "<id>",
      "platforms": {
        "bolha": { "title": "...", "description": "...", "tags": ["..."], "suggestedPrice": <eur>, "seoScore": <0-100> },
        "vinted": { "title": "...", "description": "...", "tags": ["..."], "suggestedPrice": <eur>, "seoScore": <0-100> },
        "facebook": { "title": "...", "description": "...", "tags": ["..."], "suggestedPrice": <eur>, "seoScore": <0-100> },
        "mobilede": { "title": "...", "description": "...", "tags": ["..."], "suggestedPrice": <eur>, "seoScore": <0-100> },
        "kleinanzeigen": { "title": "...", "description": "...", "tags": ["..."], "suggestedPrice": <eur>, "seoScore": <0-100> }
      },
      "reasoning": "<1 stavek — katere platforme so najboljše za ta item>"
    }
  ]
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;
    const listings: MultiListing[] = [];
    const itemById = new Map<string, HeldItemData>(aiSlice.map(i => [i.tradeId, i]));
    let bestPlatformCounts: Record<string, number> = {};

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiListingResponse | null;
      if (parsed && Array.isArray(parsed.listings)) {
        for (const rawItem of parsed.listings) {
          const tid = String(rawItem.tradeId || '').trim();
          const matched = itemById.get(tid);
          if (!matched) continue;

          const platformsMap = rawItem.platforms || {};
          const platforms: MultiListing['platforms'] = {
            bolha: validatePlatformEntry(platformsMap.bolha, PLATFORMS[0], matched),
            vinted: validatePlatformEntry(platformsMap.vinted, PLATFORMS[1], matched),
            facebook: validatePlatformEntry(platformsMap.facebook, PLATFORMS[2], matched),
            mobilede: validatePlatformEntry(platformsMap.mobilede, PLATFORMS[3], matched),
            kleinanzeigen: validatePlatformEntry(platformsMap.kleinanzeigen, PLATFORMS[4], matched),
          };

          // bestPlatform = highest seoScore
          let best = 'bolha';
          let bestScore = -1;
          (Object.keys(platforms) as Array<keyof MultiListing['platforms']>).forEach(k => {
            if (platforms[k].seoScore > bestScore) {
              bestScore = platforms[k].seoScore;
              best = k;
            }
          });

          const reasoning = clampString(rawItem.reasoning, 280, `${matched.title.slice(0, 40)} — najboljša platforma: ${best}.`);

          listings.push({
            tradeId: matched.tradeId,
            originalTitle: matched.title,
            category: matched.category,
            buyPrice: Math.round(matched.buyPrice),
            aiEstimatedValue: Math.round(matched.aiEstimatedValue),
            platforms,
            bestPlatform: best,
            reasoning,
          });
          bestPlatformCounts[best] = (bestPlatformCounts[best] || 0) + 1;
        }
        if (listings.length > 0) aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/multi-platform-listing-generator',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 4) Deterministic fallback for any items AI didn't cover
    const seenIds = new Set(listings.map(l => l.tradeId));
    for (const item of aiSlice) {
      if (!seenIds.has(item.tradeId)) {
        const platforms: MultiListing['platforms'] = {
          bolha: deterministicPlatformListing(item, PLATFORMS[0]),
          vinted: deterministicPlatformListing(item, PLATFORMS[1]),
          facebook: deterministicPlatformListing(item, PLATFORMS[2]),
          mobilede: deterministicPlatformListing(item, PLATFORMS[3]),
          kleinanzeigen: deterministicPlatformListing(item, PLATFORMS[4]),
        };
        let best = 'bolha';
        let bestScore = -1;
        (Object.keys(platforms) as Array<keyof MultiListing['platforms']>).forEach(k => {
          if (platforms[k].seoScore > bestScore) {
            bestScore = platforms[k].seoScore;
            best = k;
          }
        });
        listings.push({
          tradeId: item.tradeId,
          originalTitle: item.title,
          category: item.category,
          buyPrice: Math.round(item.buyPrice),
          aiEstimatedValue: Math.round(item.aiEstimatedValue),
          platforms,
          bestPlatform: best,
          reasoning: `${item.title.slice(0, 40)} — generirano z deterministic fallback (brez AI).`,
        });
        bestPlatformCounts[best] = (bestPlatformCounts[best] || 0) + 1;
      }
    }

    // 5) Compute summary
    let totalSeo = 0;
    for (const l of listings) {
      totalSeo += (l.platforms.bolha.seoScore + l.platforms.vinted.seoScore + l.platforms.facebook.seoScore + l.platforms.mobilede.seoScore + l.platforms.kleinanzeigen.seoScore) / 5;
    }
    const avgSeoScore = listings.length > 0 ? Math.round(totalSeo / listings.length) : 0;
    const bestPlatformOverall = Object.entries(bestPlatformCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

    const summary = {
      totalItems: items.length,
      listingsGenerated: listings.length,
      avgSeoScore,
      bestPlatformOverall,
    };

    // 6) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { listings, summary });
    }

    return NextResponse.json({
      ok: true,
      listings,
      summary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error('/api/ai/multi-platform-listing-generator', 'handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
