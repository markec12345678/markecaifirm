// v5.7 / v8.96.0-batch3: AI Monthly Report — comprehensive monthly analysis with AI
// Refaktoriran z withAiRoute helperjem (v8.96) + enforceBudget guard.
//
// POST /api/ai/monthly-report
// Body: { month?: string (YYYY-MM, default current), sendEmail?: boolean, sendTelegram?: boolean }
// Returns: { ok, report, stats, sentTo }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { getSettingsRow } from '@/lib/pipeline';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 120;

interface MonthlyReportInput {
  month: string;
  sendEmail: boolean;
  sendTelegram: boolean;
}

export const POST = withAiRoute<MonthlyReportInput>({
  endpoint: '/api/ai/monthly-report',
  maxDuration: 120,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      month: body?.month || new Date().toISOString().slice(0, 7),
      sendEmail: body?.sendEmail === true,
      sendTelegram: body?.sendTelegram === true,
    };
  },

  // No validateInput — month je default-an
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { month: monthStr, sendEmail, sendTelegram } = input;

    const monthStart = new Date(monthStr + '-01T00:00:00.000Z');
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);

    // Gather all data for the month
    const [listings, alerts, trades, soldTrades, runLogs] = await Promise.all([
      db.listing.findMany({
        where: { firstSeenAt: { gte: monthStart, lt: monthEnd } },
        select: { id: true, title: true, price: true, aiVerdict: true, aiScore: true, dealScore: true, aiEstimatedValue: true, monitor: { select: { name: true, source: true } } },
        take: 500,
      }),
      db.alert.count({ where: { createdAt: { gte: monthStart, lt: monthEnd } } }),
      db.trade.findMany({
        where: { buyDate: { gte: monthStart, lt: monthEnd } },
        select: { id: true, title: true, buyPrice: true, sellPrice: true, status: true, category: true, buyDate: true, sellDate: true },
        take: 100,
      }),
      db.trade.findMany({
        where: { status: 'sold', sellDate: { gte: monthStart, lt: monthEnd } },
        select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, title: true, category: true },
        take: 100,
      }),
      db.runLog.findMany({
        where: { startedAt: { gte: monthStart, lt: monthEnd } },
        select: { status: true, newListings: true, alertsSent: true, durationMs: true },
        take: 500,
      }),
    ]);

    // Calculate metrics
    const realizedProfit = soldTrades.reduce((s, t) =>
      s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
    const totalInvested = trades.filter(t => t.status === 'held').reduce((s, t) => s + t.buyPrice, 0);
    const avgRoi = soldTrades.length > 0
      ? Math.round(soldTrades.reduce((s, t) => {
          const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
          const cost = t.buyPrice + (t.buyFees ?? 0);
          return s + (cost > 0 ? profit / cost : 0);
        }, 0) / soldTrades.length * 100)
      : 0;

    const prilikaCount = listings.filter(l => l.aiVerdict === 'PRILIKA').length;
    const sumnjivoCount = listings.filter(l => l.aiVerdict === 'SUMNJIVO').length;
    const successRate = runLogs.length > 0 ? Math.round(runLogs.filter(r => r.status === 'ok').length / runLogs.length * 100) : 0;

    // Category breakdown
    const byCategory = computeByCategory(soldTrades);

    const monthLabel = monthStart.toLocaleDateString('sl-SI', { month: 'long', year: 'numeric' });

    // If no data, return early
    if (listings.length === 0 && trades.length === 0 && alerts === 0) {
      const emptyReport = `📊 *MESEČNO POROČILO — ${monthLabel}*\n\nV tem mesecu ni bilo aktivnosti.`;
      return apiOk({
        ok: true,
        report: emptyReport,
        stats: { month: monthStr, listings: 0, alerts: 0, trades: 0, soldTrades: 0, realizedProfit: 0 },
        sentTo: { telegram: false, email: false },
      });
    }

    const prompt = buildPrompt({
      monthLabel, listingsCount: listings.length, alerts, tradesCount: trades.length,
      soldTradesCount: soldTrades.length, realizedProfit, avgRoi, totalInvested,
      prilikaCount, sumnjivoCount, successRate, runLogsCount: runLogs.length,
      byCategoryStr: formatByCategory(byCategory),
      topListingsStr: formatTopListings(listings),
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const report = String(parsed?.report ?? raw).slice(0, 5000);

    // Send to Telegram / Email (load settings conditionally)
    const settings = await getSettingsRow();

    // Send to Telegram
    let telegramSent = false;
    if (sendTelegram && settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
      try {
        const { sendTelegramMessage } = await import('@/lib/telegram');
        await sendTelegramMessage(
          { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
          report
        );
        telegramSent = true;
      } catch { /* ignore */ }
    }

    // Send to Email
    let emailSent = false;
    if (sendEmail && settings.emailEnabled && settings.emailSmtpHost && settings.emailTo) {
      try {
        const { sendEmail } = await import('@/lib/email');
        const html = report.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/\n/g, '<br>');
        await sendEmail({
          smtpHost: settings.emailSmtpHost,
          smtpPort: settings.emailSmtpPort,
          smtpUser: settings.emailSmtpUser,
          smtpPassword: settings.emailSmtpPassword,
          from: settings.emailFrom,
          to: settings.emailTo,
        }, `📊 Markec AI — Mesečno poročilo (${monthLabel})`, `<div style="font-family: monospace; padding: 16px;">${html}</div>`);
        emailSent = true;
      } catch { /* ignore */ }
    }

    return apiOk({
      ok: true,
      report,
      stats: {
        month: monthStr,
        monthLabel,
        listings: listings.length,
        alerts,
        trades: trades.length,
        soldTrades: soldTrades.length,
        realizedProfit,
        avgRoi,
        totalInvested,
        prilikaCount,
        sumnjivoCount,
        successRate,
        runLogs: runLogs.length,
        byCategory,
      },
      sentTo: { telegram: telegramSent, email: emailSent },
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface SoldTradeRow {
  buyPrice: number; buyFees: number | null; sellPrice: number | null; sellFees: number | null;
  title: string; category: string | null;
}

function computeByCategory(soldTrades: SoldTradeRow[]): Record<string, { count: number; profit: number }> {
  const byCategory: Record<string, { count: number; profit: number }> = {};
  for (const t of soldTrades) {
    const cat = t.category || 'brez';
    if (!byCategory[cat]) byCategory[cat] = { count: 0, profit: 0 };
    byCategory[cat].count++;
    byCategory[cat].profit += (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
  }
  return byCategory;
}

function formatByCategory(byCategory: Record<string, { count: number; profit: number }>): string {
  return Object.entries(byCategory).map(([cat, v]) => `- ${cat}: ${v.count} prodaj, ${v.profit.toFixed(0)}€ dobička`).join('\n');
}

interface ListingRow {
  title: string; price: number | null; dealScore: number | null;
}

function formatTopListings(listings: ListingRow[]): string {
  return listings.filter(l => l.dealScore != null).sort((a, b) => b.dealScore! - a.dealScore!).slice(0, 5).map((l, i) => `${i + 1}. ${l.title} (${l.price}€, 🎯${l.dealScore})`).join('\n') || 'Ni podatkov';
}

interface PromptData {
  monthLabel: string;
  listingsCount: number;
  alerts: number;
  tradesCount: number;
  soldTradesCount: number;
  realizedProfit: number;
  avgRoi: number;
  totalInvested: number;
  prilikaCount: number;
  sumnjivoCount: number;
  successRate: number;
  runLogsCount: number;
  byCategoryStr: string;
  topListingsStr: string;
}

function buildPrompt(d: PromptData): string {
  return `Si pomočnik za mesečna poročila o aktivnosti na slovenskih spletnih oglasih.
Napiši jedrnato mesečno poročilo za ${d.monthLabel} v slovenščini, primerno za Telegram/Email (Markdown format).

Statistika za ${d.monthLabel}:
- Novih oglasov: ${d.listingsCount}
- Alertov: ${d.alerts}
- Novih tradeov: ${d.tradesCount}
- Prodanih tradeov: ${d.soldTradesCount}
- Realizirani dobiček: ${d.realizedProfit}€
- Povprečni ROI: ${d.avgRoi}%
- V investiciji (held): ${d.totalInvested}€
- AI PRILIKA: ${d.prilikaCount}, SUMNJIVO: ${d.sumnjivoCount}
- Success rate monitorjev: ${d.successRate}%
- Skupaj poganjanj: ${d.runLogsCount}

Kategorije prodanih:
${d.byCategoryStr}

Top 5 oglasov z najvišjim deal score:
${d.topListingsStr}

Strukturaj poročilo:
1. Naslov z mesecem
2. Executive summary (1-2 stavka)
3. Ključne številke (bullet list)
4. TOP 3 najboljše priložnosti
5. Analiza dobička
6. Priporočila za naslednji mesec

Dolžina: 300-600 besed. Markdown format z *bold* in _italic_.

Odgovori LE z JSON: {"report": "<celotno poročilo v markdown>"}`;
}
