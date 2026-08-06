// v7.46: AI Photo Quality Analyzer — analiza slik oglasa + nasveti za fotografiranje.
//
// Analizira AI image analysis (že shranjena v listing.aiImageAnalysis) in:
// 1. Oceni kakovost slik (AUTHENTIC / SUSPICIOUS / STOCK_PHOTO)
// 2. Predlaga katere slike posneti za prodajo (6+ slik iz različnih kotov)
// 3. Določi "photo score" 1-10 za prodajni potencial
//
// POST /api/ai/photo-quality-analyzer
// Body: { tradeId: string } — za held trade (za prodajo)
//   ALI { listingId: string } — za listing (pri nakupu)
// Returns: { ok, analysis: { currentScore, issues, sellPhotoGuide, recommendation } }

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
    const body = await req.json().catch(() => ({}));
    const { tradeId, listingId } = body;

    let title = '', category = '', aiImageAnalysis = '', aiImageVerdict = '', description = '';

    if (tradeId) {
      const trade = await db.trade.findUnique({
        where: { id: String(tradeId) },
        select: {
          title: true, category: true,
          listing: { select: { aiImageAnalysis: true, aiImageVerdict: true, description: true, detailDescription: true } },
        },
      });
      if (!trade) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
      title = trade.title;
      category = trade.category || 'splošno';
      aiImageAnalysis = trade.listing?.aiImageAnalysis || '';
      aiImageVerdict = trade.listing?.aiImageVerdict || '';
      description = trade.listing?.detailDescription || trade.listing?.description || '';
    } else if (listingId) {
      const listing = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: { title: true, aiImageAnalysis: true, aiImageVerdict: true, description: true, detailDescription: true, monitor: { select: { source: true } } },
      });
      if (!listing) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      title = listing.title;
      aiImageAnalysis = listing.aiImageAnalysis || '';
      aiImageVerdict = listing.aiImageVerdict || '';
      description = listing.detailDescription || listing.description || '';
    } else {
      return NextResponse.json({ error: 'tradeId ali listingId je obvezen' }, { status: 400 });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si ekspert za fotografijo rabljenih dobrin za spletne oglase.

ITEM: ${title}
KATEGORIJA: ${category || 'splošno'}
AI ANALIZA SLIKE (ob nakupu): ${aiImageAnalysis || 'Ni analize'}
AI SLIKA VERDICT: ${aiImageVerdict || 'neznan'}

NALOGA:
1. Oceni kakovost trenutnih slik (če so na voljo)
2. Predlagaj KATERE SLIKE posneti za prodajo (za Bolha/Vinted oglas)
3. Daj "photo score" 1-10 za prodajni potencial
4. Identificiraj težave na slikah (slaba svetloba, nejasno, premalo kotov)

PRAVILA ZA DOBRE PRODAJNE SLIKE:
- Minimum 6 slik (spredaj, zadaj, stranski, od zgoraj, detail, v uporabi)
- Dobra osvetlitev (naravna svetloba, ne bliskavica direktno)
- Čisto ozadje (brez nereda)
- Detail poškodb/habanja (kupci zaupajo iskrenim prodajalcem)
- V kontekstu (item v uporabi = boljša predstavitev)

Odgovori LE z JSON:
{
  "current_photo_score": <number 1-10>,
  "current_issues": ["<težava1>", "<težava2>"],
  "sell_photo_guide": [
    { "shot": "<vrsta posnetka>", "description": "<kaj pokazati>", "priority": "<high|medium|low>" }
  ],
  "photo_tips": ["<nasvet1>", "<nasvet2>"],
  "estimated_sell_improvement_pct": <number>,
  "recommendation": "<1-2 stavki>"
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else {
        return NextResponse.json({
          ok: true,
          analysis: {
            currentPhotoScore: 5,
            currentIssues: ['AI ni na voljo — preveri ročno'],
            sellPhotoGuide: [
              { shot: 'Spredaj', description: 'Jasen posnetek sprednje strani', priority: 'high' },
              { shot: 'Zadaj', description: 'Zadnja stran z vsemi priključki', priority: 'high' },
              { shot: 'Stranski', description: 'Bočni profil', priority: 'medium' },
              { shot: 'Detail poškodbe', description: 'Pokaži habanje/poškodbe iskreno', priority: 'high' },
              { shot: 'V uporabi', description: 'Item v funkciji/kontekstu', priority: 'medium' },
              { shot: 'Pribor', description: 'Vsi dodatki (polnilnik, etui, itd.)', priority: 'low' },
            ],
            photoTips: [
              'Uporabi naravno svetlobo (blizu okna)',
              'Čisto ozadje brez nereda',
              'Minimum 6 slik iz različnih kotov',
              'Pokaži poškodbe iskreno — kupci zaupajo',
            ],
            estimatedSellImprovementPct: 20,
            recommendation: 'Dobre fotografije povečajo prodajno ceno za 15-25% in skrajšajo čas prodaje.',
          },
        });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);

    return NextResponse.json({
      ok: true,
      analysis: {
        currentPhotoScore: Math.max(1, Math.min(10, Number(parsed?.current_photo_score ?? 5))),
        currentIssues: (parsed?.current_issues || []).slice(0, 5).map((i: any) => String(i).slice(0, 200)),
        sellPhotoGuide: (parsed?.sell_photo_guide || []).slice(0, 8).map((g: any) => ({
          shot: String(g?.shot ?? '').slice(0, 80),
          description: String(g?.description ?? '').slice(0, 200),
          priority: ['high', 'medium', 'low'].includes(String(g?.priority)) ? String(g.priority) : 'medium',
        })),
        photoTips: (parsed?.photo_tips || []).slice(0, 6).map((t: any) => String(t).slice(0, 200)),
        estimatedSellImprovementPct: Math.max(0, Math.min(50, Number(parsed?.estimated_sell_improvement_pct ?? 15))),
        recommendation: String(parsed?.recommendation ?? '').slice(0, 300),
      },
    });
  } catch (err: any) {
    logger.error('/api/ai/photo-quality-analyzer', 'POST handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
