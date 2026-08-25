// v9.55: AI Assistant — Natural Language Query interface.
// "Vprašaj AI" — uporabnik vnese naravno vprašanje, AI odgovori z analizo podatkov.
//
// Navdih: Tableau AI, Metabase AI, Databricks AI/BI (2026 trend).
// Konkurenca (BuyBotPro, Sellerboard) tega NIMA — diferenciacija.
//
// Endpoint: POST /api/ai/assistant
// Body: { query: string, history?: Array<{role, content}> }
// Returns: { ok, answer, data, suggestedActions, sources }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AssistantResponse {
  ok: true;
  answer: string;
  data: Record<string, unknown>;
  suggestedActions: string[];
  sources: string[];
  query: string;
  timestamp: string;
}

async function gatherContext(): Promise<string> {
  const [soldTrades, heldTrades, monitors, listings, alerts, stats] = await Promise.all([
    db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: {
        id: true, title: true, category: true, tags: true,
        buyPrice: true, buyFees: true, buyDate: true,
        sellPrice: true, sellFees: true, sellDate: true,
        buyScore: true, buyVerdict: true,
      },
      orderBy: { sellDate: 'desc' },
      take: 50,
    }),
    db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyDate: true, tags: true,
      },
      orderBy: { buyDate: 'desc' },
    }),
    db.monitor.findMany({
      select: { id: true, name: true, source: true, isActive: true, url: true },
    }),
    db.listing.findMany({
      where: { isHidden: false },
      select: {
        id: true, title: true, price: true, aiVerdict: true, aiScore: true, dealScore: true,
        monitor: { select: { name: true, source: true } },
      },
      orderBy: { firstSeenAt: 'desc' },
      take: 30,
    }),
    db.alert.findMany({
      where: { isArchived: false },
      select: { id: true, title: true, aiVerdict: true, aiScore: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, category: true },
    }),
  ]);

  const totalProfit = stats.reduce((sum, t) => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    return sum + (revenue - cost);
  }, 0);

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const thisMonthProfit = stats
    .filter((t) => t.sellDate && new Date(t.sellDate) >= thisMonthStart)
    .reduce((sum, t) => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      return sum + (revenue - cost);
    }, 0);

  const lastMonthProfit = stats
    .filter((t) => t.sellDate && new Date(t.sellDate) >= lastMonthStart && new Date(t.sellDate) <= lastMonthEnd)
    .reduce((sum, t) => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      return sum + (revenue - cost);
    }, 0);

  const profitable = stats.filter((t) => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    return revenue - cost > 0;
  }).length;
  const winRate = stats.length > 0 ? Math.round((profitable / stats.length) * 100) : 0;

  const byCategory: Record<string, { profit: number; count: number; roi: number }> = {};
  for (const t of stats) {
    const cat = t.category || 'drugo';
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    const profit = revenue - cost;
    if (!byCategory[cat]) byCategory[cat] = { profit: 0, count: 0, roi: 0 };
    byCategory[cat].profit += profit;
    byCategory[cat].count += 1;
    byCategory[cat].roi += cost > 0 ? (profit / cost) * 100 : 0;
  }
  const categoryStats = Object.entries(byCategory).map(([cat, d]) => ({
    kategorija: cat,
    profit: Math.round(d.profit),
    stevilo: d.count,
    roi: Math.round(d.roi / d.count),
  }));

  const heldAging = heldTrades.map((t) => {
    const days = Math.floor((now.getTime() - new Date(t.buyDate).getTime()) / (1000 * 60 * 60 * 24));
    return { naslov: t.title, kategorija: t.category, dni_v_skladiscu: days, nabavna_cena: t.buyPrice };
  });

  const topOpportunities = listings
    .filter((l) => l.aiVerdict === 'PRILIKA' || (l.dealScore ?? 0) >= 70)
    .slice(0, 10)
    .map((l) => ({
      naslov: l.title,
      cena: l.price,
      ai_verdikt: l.aiVerdict,
      deal_score: l.dealScore,
      vir: l.monitor?.source,
    }));

  return `KONTEKST O UPORABNIKOVEM POSLOVANJU (Markec AI Firm):

📊 GLAVNE METRIKE:
- Skupni profit (vse prodaje): ${Math.round(totalProfit)}€
- Profit ta mesec: ${Math.round(thisMonthProfit)}€
- Profit prejšnji mesec: ${Math.round(lastMonthProfit)}€
- Skupno prodanih trade-ov: ${stats.length}
- Trenutno v skladišču (held): ${heldTrades.length}
- Win rate: ${winRate}%

📈 ROI PO KATEGIJAH:
${JSON.stringify(categoryStats, null, 2)}

🛒 SKLADIŠČE (held inventory z aging):
${JSON.stringify(heldAging, null, 2)}

🎯 TOP PRILOŽNOSTI (iz zadnjih oglasov):
${JSON.stringify(topOpportunities, null, 2)}

🔔 AKTIVNI ALERTI: ${alerts.length}
📋 AKTIVNI MONITORJI: ${monitors.filter((m) => m.isActive).length} od ${monitors.length}

Čas: ${now.toLocaleString('sl-SI')}`;
}

function buildSystemPrompt(): string {
  return `Si AI asistent za aplikacijo "Markec AI Firm" — AI lovec priložnosti za slovenske in evropske portale (Bolha, Vinted, Avtonet, mobile.de, itd.).

TVOJA VLOGA:
- Pomočnik uporabniku pri sprejemanju odločitev o nakupu/prodaji artiklov (flipping)
- Analitik trgovin — odgovarjaš na vprašanja o dobičku, ROI, kategorijah
- Svetovalec — priporočaš naslednje korake glede na podatke

PRAVILA:
1. Odgovarjaj V SLOVENŠČINI, jasno in strukturirano (uporabi emoji-je za berljivost)
2. Vedno sklicuj se na DEJANSKE PODATKE iz konteksta (ne izmišljaj)
3. Če podatki niso dovolj za odgovor, reci to in predlagaj kaj bi rabil
4. Bodisi konkreten — daj številke, procenti, primeri
5. Na koncu dodaj 2-3 predlagane akcije (kaj uporabnik lahko stori)

FORMAT ODGOVORA:
💰 Kratko odgovor (1-2 stavka)

📊 Podrobnosti (bullets s številkami)

🎯 Priporočene akcije:
1. ...
2. ...
3. ...

PODATKI O UPORABNIKU SO V KONTEKSTU ZGORAJ. Uporabi jih za odgovor.`;
}

function extractSuggestedActions(answer: string): string[] {
  const actions: string[] = [];
  const lines = answer.split('\n');
  let inActions = false;
  for (const line of lines) {
    if (/priporočene akcije|predlagane akcije|🎯/i.test(line)) {
      inActions = true;
      continue;
    }
    if (inActions) {
      const match = line.match(/^\s*\d+\.\s+(.+)/);
      if (match) {
        actions.push(match[1].trim());
      }
    }
  }
  return actions.slice(0, 5);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    const history: ChatMessage[] = Array.isArray(body.history) ? body.history.slice(-10) : [];

    if (!query) {
      return NextResponse.json({ ok: false, error: 'Manjka vprašanje' }, { status: 400 });
    }
    if (query.length > 500) {
      return NextResponse.json({ ok: false, error: 'Vprašanje je predolgo (max 500 znakov)' }, { status: 400 });
    }

    const settingsRow = await getSettingsRow();
    if (!settingsRow || !settingsRow.aiApiKey) {
      return NextResponse.json({
        ok: false,
        error: 'AI provider ni konfiguriran. Pojdi v Nastavitve → AI in nastavi provider (Ollama, OpenAI, ali Anthropic).',
      }, { status: 400 });
    }

    const aiSettings: AiSettings = {
      provider: settingsRow.aiProvider as AiSettings['provider'],
      baseUrl: settingsRow.aiBaseUrl ?? undefined,
      apiKey: settingsRow.aiApiKey ?? undefined,
      model: settingsRow.aiModel ?? undefined,
    };

    const context = await gatherContext();
    const systemPrompt = buildSystemPrompt();
    const fullPrompt = `${systemPrompt}\n\n${context}\n\nVPRAŠANJE UPORABNIKA: ${query}`;

    let conversationPrompt = fullPrompt;
    if (history.length > 0) {
      const historyText = history
        .map((m) => `${m.role === 'user' ? 'UPORABNIK' : 'ASISTENT'}: ${m.content}`)
        .join('\n\n');
      conversationPrompt = `${fullPrompt}\n\n\nPREJŠNJI POGOVOR:\n${historyText}\n\nVPRAŠANJE UPORABNIKA: ${query}`;
    }

    logger.info('/api/ai/assistant', `Query: "${query.slice(0, 80)}"`);

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, conversationPrompt);
    } catch (e) {
      if (settingsRow.fallbackApiKey) {
        const fallback: AiSettings = {
          provider: settingsRow.fallbackProvider as AiSettings['provider'],
          baseUrl: settingsRow.fallbackBaseUrl ?? undefined,
          apiKey: settingsRow.fallbackApiKey ?? undefined,
          model: settingsRow.fallbackModel ?? undefined,
        };
        try {
          raw = await callProviderForRaw(fallback, conversationPrompt);
        } catch (e2) {
          throw new Error(`AI provider napaka: ${(e as Error).message}. Fallback napaka: ${(e2 as Error).message}`);
        }
      } else {
        throw e;
      }
    }

    if (!raw || raw.trim().length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'AI ni vrnil odgovora. Preveri AI provider nastavitve.',
      }, { status: 500 });
    }

    const suggestedActions = extractSuggestedActions(raw);

    const response: AssistantResponse = {
      ok: true,
      answer: raw.trim(),
      data: { query, profitContext: true, tradesAnalyzed: true },
      suggestedActions,
      sources: ['trades', 'listings', 'monitors', 'alerts'],
      query,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (err: any) {
    logger.error('/api/ai/assistant', 'POST failed', err);
    return NextResponse.json({
      ok: false,
      error: err?.message ?? 'Napaka pri obdelavi vprašanja',
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    suggestedQueries: [
      { icon: '💰', text: 'Koliko profit sem naredil ta mesec?' },
      { icon: '🎯', text: 'Kaj naj kupim naslednje?' },
      { icon: '📊', text: 'Katere kategorije so najbolj dobičkonosne?' },
      { icon: '🛒', text: 'Pokaži mi starejše artikle v skladišču' },
      { icon: '📈', text: 'Zakaj je moj win rate padel?' },
      { icon: '🔥', text: 'Katere so moje top 3 priložnosti trenutno?' },
      { icon: '⏱️', text: 'Kateri vir ima najvišji ROI?' },
      { icon: '💡', text: 'Daj mi 3 nasvete za izboljšanje dobička' },
    ],
  });
}
