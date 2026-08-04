// v6.13: Predictive Fraud Detection — hevristična + AI analiza sumljivih oglasov
// POST /api/ai/fraud-detection
// Body: { listingId?: string, listing?: { title, price, priceText, location, description, source, imageUrl, sellerName, postedAt } }
// Returns: { ok, analysis: { fraudScore, riskLevel, redFlags, mlSignals, aiAssessment, recommendations, similarFraudPatterns } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ListingInput {
  title: string;
  price?: number | null;
  priceText?: string;
  location?: string;
  description?: string;
  source?: string;
  imageUrl?: string | null;
  sellerName?: string | null;
  postedAt?: string | null;
}

// Hevristični sumljivi vzorci (pravi ML pattern matching)
const FRAUD_PATTERNS = {
  paymentRedFlags: [
    { pattern: /pošiljam\s+samo|pošiljam\s+tudi|pošiljam\s+po\s+svetu/i, weight: 25, label: 'Pošiljanje samo (klasična prevara)' },
    { pattern: /paysafecard|paysafe\s+card/i, weight: 30, label: 'Paysafecard (anonimno plačilo)' },
    { pattern: /western\s+union|moneygram/i, weight: 35, label: 'Western Union / MoneyGram' },
    { pattern: /predračun|predračunu|nakazilo\s+pred/i, weight: 25, label: 'Predračun pred prevzemom' },
    { pattern: /paypal\s+friends|paypal\s+family/i, weight: 20, label: 'PayPal Friends&Family (brez zaščite)' },
    { pattern: /gotovina\s+predhodno|predhodno\s+plačilo/i, weight: 25, label: 'Predhodno plačilo' },
    { pattern: /bitcoin|btc|kripto/i, weight: 20, label: 'Kripto plačilo' },
  ],
  urgencyRedFlags: [
    { pattern: /nujna\s+prodaja|nujno\s+prodajam|moram\s+prodati/i, weight: 15, label: 'Nujna prodaja (pritisk)' },
    { pattern: /selim\s+se|selitev|odselim/i, weight: 12, label: 'Selitev (klasičen izgovor)' },
    { pattern: /dedovanje|podedoval|od\s+deda|od\s+babice/i, weight: 10, label: 'Dedovanje (težko preverljivo)' },
    { pattern: /razvod|ločitev|ex\s+partner/i, weight: 12, label: 'Razvod (čustvena manipulacija)' },
    { pattern: /zdaj\s+ali\s+nikoli|samo\s+danes|samo\s+ta\s+teden/i, weight: 18, label: 'Time pressure' },
  ],
  descriptionRedFlags: [
    { pattern: /^[\s\S]{0,30}$/, weight: 15, label: 'Zelo kratek opis (<30 znakov)' },
    { pattern: /kontaktiraj\s+me\s+na|piši\s+mi\s+na\s+whatsapp|kontakt\s+mail/i, weight: 12, label: 'Direktni kontakt izven platforme' },
    { pattern: /nov\s+nov\s+nov|novo\s+novo|neodprto|neodprt/i, weight: 8, label: 'Preveč poudarja "novo"' },
    { pattern: /garancija\s+\d+\s+let|garancija\s+do/i, weight: 5, label: 'Garancija (lahko lažna)' },
  ],
  priceRedFlags: [
    { pattern: /po\s+dogovoru|po\s+dogovoru\s+cena/i, weight: 8, label: 'Cena "po dogovoru" (sumljivo)' },
    { pattern: /zelo\s+ugodno|super\s+cena|akcijska\s+cena|super\s+ugodno/i, weight: 12, label: 'Agregatno ugodno (pritisnk)' },
  ],
  sellerRedFlags: [
    { pattern: /(?:telefon|mobitel|mob)\s*[:.]?\s*\+?\d{3,}/i, weight: 10, label: 'Telefon v naslovu (sumnjivo)' },
  ],
};

const STOCK_PHOTO_KEYWORDS = ['stock', 'photo', 'shutterstock', 'getty', 'unsplash', 'pexels', 'pixabay'];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId } = body;
    let listingInput: ListingInput | null = body?.listing ?? null;

    // 1. Če je podan listingId, pridobi iz baze
    if (listingId && !listingInput) {
      const listing = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: {
          title: true, price: true, priceText: true, location: true, description: true,
          detailDescription: true, url: true, imageUrl: true, aiEstimatedValue: true,
          aiRisk: true, aiVerdict: true, aiReason: true, dealScore: true,
          sellerName: true, sellerListingCount: true, postedAt: true, firstSeenAt: true,
          aiImageAnalysis: true, aiImageVerdict: true,
          monitor: { select: { source: true, name: true } },
        },
      });
      if (!listing) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      listingInput = {
        title: listing.title,
        price: listing.price,
        priceText: listing.priceText,
        location: listing.location,
        description: listing.detailDescription || listing.description,
        source: listing.monitor?.source,
        imageUrl: listing.imageUrl,
        sellerName: listing.sellerName,
        postedAt: listing.postedAt?.toISOString() ?? null,
      };
    }

    if (!listingInput) {
      return NextResponse.json({ error: 'listingId ali listing objekt je obvezen' }, { status: 400 });
    }

    // 2. ML hevristična analiza — pattern matching
    const fullText = `${listingInput.title} ${listingInput.description || ''} ${listingInput.priceText || ''} ${listingInput.location || ''}`;
    const redFlags: Array<{ category: string; pattern: string; weight: number; matched: string }> = [];

    let totalWeight = 0;
    for (const [category, patterns] of Object.entries(FRAUD_PATTERNS)) {
      for (const p of patterns) {
        const match = fullText.match(p.pattern);
        if (match) {
          redFlags.push({
            category,
            pattern: p.label,
            weight: p.weight,
            matched: match[0].slice(0, 50),
          });
          totalWeight += p.weight;
        }
      }
    }

    // 3. ML signali — analiza značilnosti
    const mlSignals: Array<{ signal: string; value: any; riskContribution: number }> = [];

    // Price vs estimated value
    const price = Number(listingInput.price) || 0;
    const listing = await db.listing.findUnique({
      where: { id: String(body?.listingId ?? '') },
      select: { aiEstimatedValue: true, sellerListingCount: true, aiImageVerdict: true },
    }).catch(() => null);
    const estValue = listing?.aiEstimatedValue ?? 0;

    if (price > 0 && estValue > 0) {
      const discount = Math.round(((estValue - price) / estValue) * 100);
      if (discount > 50) {
        mlSignals.push({ signal: 'Cena preveč pod tržno (>{50}%)', value: `${discount}% pod est.`, riskContribution: 25 });
        totalWeight += 25;
      } else if (discount > 30) {
        mlSignals.push({ signal: 'Cena močno pod tržno', value: `${discount}% pod est.`, riskContribution: 12 });
        totalWeight += 12;
      }
    }

    // Seller listing count
    const sellerCount = listing?.sellerListingCount ?? 0;
    if (sellerCount === 0) {
      mlSignals.push({ signal: 'Nov prodajalec (0 oglasov)', value: 0, riskContribution: 8 });
      totalWeight += 8;
    } else if (sellerCount > 50) {
      mlSignals.push({ signal: 'Množični prodajalec (>50 oglasov)', value: sellerCount, riskContribution: 5 });
      totalWeight += 5;
    }

    // Image verdict
    const imgVerdict = listing?.aiImageVerdict ?? null;
    if (imgVerdict === 'STOCK_PHOTO') {
      mlSignals.push({ signal: 'Stock fotografija namesto realne', value: 'STOCK_PHOTO', riskContribution: 20 });
      totalWeight += 20;
    } else if (imgVerdict === 'SUSPICIOUS') {
      mlSignals.push({ signal: 'AI označil sliko kot sumljivo', value: 'SUSPICIOUS', riskContribution: 15 });
      totalWeight += 15;
    }

    // Description length
    const descLen = (listingInput.description || '').length;
    if (descLen < 50) {
      mlSignals.push({ signal: 'Zelo kratek opis (<50 znakov)', value: descLen, riskContribution: 10 });
      totalWeight += 10;
    }

    // Posted recently + low price (suspicious combo)
    if (listingInput.postedAt) {
      const hoursAgo = (Date.now() - new Date(listingInput.postedAt).getTime()) / (60 * 60 * 1000);
      if (hoursAgo < 6 && price > 0 && estValue > 0 && price < estValue * 0.6) {
        mlSignals.push({ signal: 'Nov oglas (<6h) + izjemno nizka cena', value: `${Math.round(hoursAgo)}h`, riskContribution: 18 });
        totalWeight += 18;
      }
    }

    // Image URL stock check
    if (listingInput.imageUrl && STOCK_PHOTO_KEYWORDS.some(k => listingInput.imageUrl!.toLowerCase().includes(k))) {
      mlSignals.push({ signal: 'URL slike vsebuje stock photo keyword', value: listingInput.imageUrl.slice(0, 50), riskContribution: 22 });
      totalWeight += 22;
    }

    // Cap at 100
    const hevristicScore = Math.min(100, totalWeight);

    // 4. AI analiza konteksta
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si forenzik za odkrivanje prevar pri spletnih oglasih rabljenih dobrin.
Analiziraj oglas in potrdi/odpovej hevristično oceno tveganja.

OGLAS:
NASLOV: ${listingInput.title}
CENA: ${listingInput.priceText || (price + ' EUR')}
LOKACIJA: ${listingInput.location || 'neznan'}
PRODAJALEC: ${listingInput.sellerName || 'neznan'} (${sellerCount} oglasov)
OPIS: ${(listingInput.description || '').slice(0, 1000)}
${imgVerdict ? `SLIKA: ${imgVerdict}` : ''}

HEVRISTIČNA ANALIZA:
- Score: ${hevristicScore}/100
- Red flags: ${redFlags.length > 0 ? redFlags.map(r => r.pattern).join('; ') : 'brez'}
- ML signali: ${mlSignals.length > 0 ? mlSignals.map(s => `${s.signal} (+${s.riskContribution})`).join('; ') : 'brez'}

Pravila:
1. Predpostavi, da je hevristična analiza natančna v 70% primerov
2. Preveri kombinacije znakov (npr. nujna prodaja + pošiljanje samo + nov prodajalec = skoraj gotovo prevara)
3. Opozori tudi na subtilne znake ki jih hevristika ne najde
4. Razlikuj med "resnično prevara" in "sumnjivo a morda legitimno"
5. Priporoči konkretno dejanje (pogajaj prek platforme / zahtevaj osebni prevzem / ne nakupuj / itd.)

Odgovori LE z JSON:
{
  "ai_assessment": "<glavna ugotovitev, max 200 znakov>",
  "fraud_probability_pct": <number 0-100>,
  "scam_type": "<classic_scam|phishing|advance_fee|fake_item|non_delivery|legitimate|suspicious>",
  "additional_red_flags": ["<subtilen znak, max 80 znakov>", "..."],
  "verification_steps": ["<korak za preverjanje, max 100 znakov>", "..."],
  "recommendation": "<buy_with_caution|verify_first|avoid|report>",
  "reasoning": "<zakaj ta ocena, max 200 znakov>"
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = {
          provider: aiSettings.fallbackProvider,
          baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '',
          model: aiSettings.fallbackModel,
        };
        raw = await callProviderForRaw(fb, prompt);
      } else {
        return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);

    // Kombiniraj hevristiko + AI
    const aiFraudProb = Math.max(0, Math.min(100, Number(parsed?.fraud_probability_pct ?? hevristicScore)));
    const combinedScore = Math.round(hevristicScore * 0.6 + aiFraudProb * 0.4);
    const riskLevel = combinedScore >= 70 ? 'critical' :
                      combinedScore >= 40 ? 'high' :
                      combinedScore >= 20 ? 'medium' : 'low';

    // 5. Poišči podobne sumljive oglase v bazi (similar fraud patterns)
    let similarFraudPatterns: Array<{ id: string; title: string; price: number | null; sellerName: string | null; matchReason: string }> = [];
    if (redFlags.length > 0) {
      const topPattern = redFlags[0].pattern;
      const similar = await db.listing.findMany({
        where: {
          id: { not: String(body?.listingId ?? '') },
          isHidden: false,
          OR: [
            { description: { contains: topPattern.slice(0, 20) } },
            { detailDescription: { contains: topPattern.slice(0, 20) } },
            { title: { contains: topPattern.slice(0, 20) } },
          ],
        },
        select: { id: true, title: true, price: true, sellerName: true, firstSeenAt: true },
        take: 5,
      });
      similarFraudPatterns = similar.map(s => ({
        id: s.id, title: s.title, price: s.price, sellerName: s.sellerName,
        matchReason: `Podoben vzorec: ${topPattern.slice(0, 50)}`,
      }));
    }

    // Increment AI usage
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      analysis: {
        fraudScore: combinedScore,
        riskLevel,
        hevristicScore,
        aiScore: aiFraudProb,
        scamType: ['classic_scam', 'phishing', 'advance_fee', 'fake_item', 'non_delivery', 'legitimate', 'suspicious'].includes(String(parsed?.scam_type))
          ? String(parsed.scam_type) : 'suspicious',
        aiAssessment: String(parsed?.ai_assessment ?? '').slice(0, 400),
        reasoning: String(parsed?.reasoning ?? '').slice(0, 400),
        redFlags: redFlags.sort((a, b) => b.weight - a.weight),
        mlSignals,
        additionalRedFlags: Array.isArray(parsed?.additional_red_flags)
          ? parsed.additional_red_flags.slice(0, 6).map((r: any) => String(r).slice(0, 200))
          : [],
        verificationSteps: Array.isArray(parsed?.verification_steps)
          ? parsed.verification_steps.slice(0, 6).map((s: any) => String(s).slice(0, 250))
          : [],
        recommendation: ['buy_with_caution', 'verify_first', 'avoid', 'report'].includes(String(parsed?.recommendation))
          ? String(parsed.recommendation) : 'verify_first',
        similarFraudPatterns,
      },
    });
  } catch (e: any) {
    logger.error("/api/ai/fraud-detection", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
