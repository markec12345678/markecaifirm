// v6.16: AI Email Campaign Generator — generira e-poštne kampanje za outreach
// POST /api/ai/email-campaign
// Body: { campaignType?: 'win_back'|'new_buyers'|'bundle_offer'|'clearance'|'seasonal'|'newsletter',
//         targetCategory?: string, seasonality?: string }
// Returns: { ok, campaign: { type, subject, previewText, body, cta, segments, subjectVariants, sendStrategy, followUp }, insights }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const campaignType = ['win_back', 'new_buyers', 'bundle_offer', 'clearance', 'seasonal', 'newsletter'].includes(String(body?.campaignType))
      ? String(body.campaignType) : 'newsletter';
    const targetCategory = String(body?.targetCategory || '').trim();
    const seasonality = String(body?.seasonality || '').trim();

    // 1. Pridobi sold trades za kontekst — kaj se je dobro prodajalo
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { gte: threeMonthsAgo } },
      select: { title: true, category: true, sellPrice: true, buyPrice: true, sellLocation: true, buyLocation: true },
      take: 50,
    });

    // 2. Pridobi held trades za inventory
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true } } },
    });

    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        campaign: null,
        message: 'Ni dovolj podatkov za generiranje kampanje.',
      });
    }

    // 3. Analiza prodaj
    const byCategory: Record<string, { count: number; profit: number; revenue: number; avgPrice: number }> = {};
    for (const t of soldTrades) {
      const cat = t.category || 'drugo';
      if (targetCategory && cat !== targetCategory) continue;
      if (!byCategory[cat]) byCategory[cat] = { count: 0, profit: 0, revenue: 0, avgPrice: 0 };
      byCategory[cat].count++;
      byCategory[cat].revenue += t.sellPrice ?? 0;
      byCategory[cat].profit += (t.sellPrice ?? 0) - t.buyPrice;
      byCategory[cat].avgPrice += t.sellPrice ?? 0;
    }
    for (const cat of Object.keys(byCategory)) {
      byCategory[cat].avgPrice = byCategory[cat].count > 0
        ? Math.round(byCategory[cat].avgPrice / byCategory[cat].count) : 0;
    }

    // 4. Inventory za bundle/clearance
    const inventoryForCampaign = heldTrades.slice(0, 15).map(t => ({
      title: t.title,
      category: t.category || 'drugo',
      estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      daysHeld: Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000)),
    }));

    // 5. AI generiranje kampanje
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const soldStr = Object.entries(byCategory).map(([cat, s]) =>
      `- ${cat}: ${s.count} prodaj, ${s.revenue}€ prihodka, ${s.profit}€ dobička, ${s.avgPrice}€ povp. cena`
    ).join('\n');

    const inventoryStr = inventoryForCampaign.map(i =>
      `- ${i.title} | ${i.category} | ${i.estValue}€ | ${i.daysHeld}d v skladišču`
    ).join('\n');

    const prompt = `Si ekspert za email marketing pri preprodaji rabljenih dobrin.
Generiraj celovito email kampanjo za outreach kupcem.

TIP KAMPANJE: ${campaignType}
${targetCategory ? `CILJNA KATEGORIJA: ${targetCategory}` : 'BREZ KATEGORIJE — splošna'}
${seasonality ? `SEZONSKOST: ${seasonality}` : ''}

ZGODOVINA PRODAJ (zadnji 3 meseci):
${soldStr || '- Ni prodaj'}

INVENTAR V SKLADIŠČU:
${inventoryStr || '- Ni inventarja'}

Slovenski kontekst:
- Email naj bo v slovenščini
- Osebni, neposredni ton (ne "spoštovani gospod")
- Concrete prednosti za kupca (cena, kakovost, redkost)
- CTA naj bo jasen (klikni, odgovori, pokliči)
- Subject line naj bo <60 znakov za mobile
- Body naj bo 150-300 besed (ne predolg)

Tipi kampanj:
- "win_back": ponovno pridobi pretekle kupce (npr. "imamo novo ponudbo za vas")
- "new_buyers": pridobi nove kupce (npr. "priporočila, akcija za prvi nakup")
- "bundle_offer": ponudi bundle 2+ itemov z diskontom
- "clearance": prodaja stalled inventarja z močnim popustom
- "seasonal": sezonska akcija (poletje/kampa, zima/grelniki)
- "newsletter": redne novice iz skladišča

Odgovori LE z JSON:
{
  "campaign": {
    "type": "${campaignType}",
    "subject": "<subject line, max 60 znakov>",
    "preview_text": "<preview text v inboxu, max 100 znakov>",
    "body": "<celoten email body v slovenščini, 150-300 besed>",
    "cta": "<call to action, max 50 znakov>",
    "subject_variants": ["<variant A, max 60 znakov>", "<variant B>", "<variant C>"],
    "segments": [
      {
        "name": "<ime segmenta, npr. 'Pretekli kupci elektronike'>",
        "criteria": "<kriterij, max 80 znakov>",
        "estimated_reach": <number>,
        "expected_open_rate": <number 0-100>,
        "expected_click_rate": <number 0-100>
      }
    ],
    "send_strategy": {
      "best_day": "<dan v tednu>",
      "best_time": "<urov, npr. '10:00'>",
      "frequency": "<how often, max 50 znakov>",
      "reasoning": "<max 100 znakov>"
    },
    "follow_up": {
      "wait_days": <number>,
      "subject": "<follow-up subject, max 60 znakov>",
      "body": "<follow-up body, max 200 besed>"
    },
    "featured_items": ["<item title iz skladišča, max 80 znakov>", "..."]
  },
  "insights": "<splošne ugotovitve o kampanji, max 200 znakov>"
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
    const c = parsed?.campaign ?? {};

    const campaign = {
      type: campaignType,
      subject: String(c?.subject ?? '').slice(0, 120),
      previewText: String(c?.preview_text ?? '').slice(0, 200),
      body: String(c?.body ?? '').slice(0, 4000),
      cta: String(c?.cta ?? '').slice(0, 100),
      subjectVariants: Array.isArray(c?.subject_variants)
        ? c.subject_variants.slice(0, 4).map((s: any) => String(s).slice(0, 120))
        : [],
      segments: (Array.isArray(c?.segments) ? c.segments : []).slice(0, 5).map((s: any) => ({
        name: String(s?.name ?? '').slice(0, 100),
        criteria: String(s?.criteria ?? '').slice(0, 200),
        estimatedReach: Math.max(0, Number(s?.estimated_reach ?? 0)),
        expectedOpenRate: Math.max(0, Math.min(100, Number(s?.expected_open_rate ?? 0))),
        expectedClickRate: Math.max(0, Math.min(100, Number(s?.expected_click_rate ?? 0))),
      })),
      sendStrategy: {
        bestDay: String(c?.send_strategy?.best_day ?? '').slice(0, 30),
        bestTime: String(c?.send_strategy?.best_time ?? '').slice(0, 20),
        frequency: String(c?.send_strategy?.frequency ?? '').slice(0, 100),
        reasoning: String(c?.send_strategy?.reasoning ?? '').slice(0, 200),
      },
      followUp: {
        waitDays: Math.max(0, Math.min(30, Number(c?.follow_up?.wait_days ?? 3))),
        subject: String(c?.follow_up?.subject ?? '').slice(0, 120),
        body: String(c?.follow_up?.body ?? '').slice(0, 2000),
      },
      featuredItems: Array.isArray(c?.featured_items)
        ? c.featured_items.slice(0, 8).map((i: any) => String(i).slice(0, 150))
        : [],
    };

    // Increment AI usage
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      campaign,
      insights: String(parsed?.insights ?? '').slice(0, 500),
      stats: {
        soldTradesAnalyzed: soldTrades.length,
        inventoryItems: heldTrades.length,
        categoriesAnalyzed: Object.keys(byCategory).length,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
