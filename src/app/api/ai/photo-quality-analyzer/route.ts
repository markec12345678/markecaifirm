// v7.46 / v8.94-refactor: AI Photo Quality Analyzer — analiza slik oglasa + nasveti za fotografiranje.
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
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

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface PhotoQualityAnalyzerInput {
  tradeId?: string;
  listingId?: string;
}

export const POST = withAiRoute<PhotoQualityAnalyzerInput>({
  endpoint: '/api/ai/photo-quality-analyzer',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : undefined,
      listingId: body?.listingId ? String(body.listingId) : undefined,
    };
  },

  validateInput: (input) => ((input.tradeId || input.listingId) ? null : 'tradeId ali listingId je obvezen'),

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId, listingId } = input;

    let title = '', category = 'splošno', aiImageAnalysis = '', aiImageVerdict = '';

    if (tradeId) {
      const trade = await db.trade.findUnique({
        where: { id: tradeId },
        select: {
          title: true, category: true,
          listing: { select: { aiImageAnalysis: true, aiImageVerdict: true, description: true, detailDescription: true } },
        },
      });
      if (!trade) throw new ApiRouteError('Trade ne obstaja', 404);
      title = trade.title;
      category = trade.category || 'splošno';
      aiImageAnalysis = trade.listing?.aiImageAnalysis || '';
      aiImageVerdict = trade.listing?.aiImageVerdict || '';
    } else if (listingId) {
      const listing = await db.listing.findUnique({
        where: { id: listingId },
        select: { title: true, aiImageAnalysis: true, aiImageVerdict: true, description: true, detailDescription: true, monitor: { select: { source: true } } },
      });
      if (!listing) throw new ApiRouteError('Listing ne obstaja', 404);
      title = listing.title;
      aiImageAnalysis = listing.aiImageAnalysis || '';
      aiImageVerdict = listing.aiImageVerdict || '';
    }

    const prompt = buildPrompt({ title, category, aiImageAnalysis, aiImageVerdict });

    let raw: string;
    try {
      raw = await callAi(prompt);
    } catch {
      // Fallback: static photo guide (če AI ni na voljo)
      return apiOk(buildFallbackResponse());
    }

    const parsed: any = parseAi(raw);

    return apiOk({
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
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface PromptData {
  title: string;
  category: string;
  aiImageAnalysis: string;
  aiImageVerdict: string;
}

function buildPrompt(d: PromptData): string {
  return `Si ekspert za fotografijo rabljenih dobrin za spletne oglase.

ITEM: ${d.title}
KATEGORIJA: ${d.category || 'splošno'}
AI ANALIZA SLIKE (ob nakupu): ${d.aiImageAnalysis || 'Ni analize'}
AI SLIKA VERDICT: ${d.aiImageVerdict || 'neznan'}

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
}

function buildFallbackResponse() {
  return {
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
  };
}
